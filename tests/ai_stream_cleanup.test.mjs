import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('AIStreamReader.js', root), 'utf8');
const encoder = new TextEncoder();
const frame = (text, finishReason = 'stop') => `data: ${JSON.stringify({ text, finishReason })}\n`;
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(chunks, { close = false, cancel = () => {} } = {}) {
  const cancellations = [];
  let controller;
  const body = new ReadableStream({
    start(value) {
      controller = value;
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
    cancel(reason) { cancellations.push(reason); return cancel(reason); },
  });
  const window = {};
  vm.runInNewContext(source, { window, TextDecoder });
  return { body, controller, cancellations,
    read: (options = {}) => window.ivLyricsReadAIStream(body, { readChunk: value => value, ...options }) };
}

for (const ending of ['\n', '']) {
  test(`EOF releases the lock and preserves output with ${ending ? 'terminated' : 'unterminated'} final frame`, async () => {
    const h = harness([frame('한글\nsecond').trimEnd() + ending], { close: true });
    const result = await h.read();
    assert.equal(result.text, '한글\nsecond');
    assert.equal(result.finishReason, 'stop');
    assert.equal(h.body.locked, false);
    assert.equal(h.cancellations.length, 0);
  });
}

test('DONE still waits for transport EOF and does not cancel a healthy stream', async () => {
  const h = harness(['data: [DONE]\n']);
  let settled = false;
  const pending = h.read().finally(() => { settled = true; });
  await tick();
  assert.equal(settled, false);
  assert.equal(h.body.locked, true);
  assert.equal(h.cancellations.length, 0);
  h.controller.enqueue(encoder.encode(frame('after marker')));
  h.controller.close();
  assert.equal((await pending).text, 'after marker');
  assert.equal(h.body.locked, false);
  assert.equal(h.cancellations.length, 0);
});

test('malformed JSON cancels the open stream and releases its lock', async () => {
  const h = harness(['data: invalid\n']);
  await assert.rejects(h.read(), { name: 'SyntaxError' });
  assert.equal(h.cancellations.length, 1);
  assert.equal(h.body.locked, false);
  const reader = h.body.getReader();
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
});

for (const callback of ['readChunk', 'onText', 'onLine', 'onLinesEmitted']) {
  test(`${callback} failure cancels the open stream without replacing the original error`, async () => {
    const failure = new Error(`${callback} failed`);
    const h = harness([frame('first\nsecond')]);
    const options = { onLine() {}, [callback]() { throw failure; } };
    await assert.rejects(h.read(options), error => error === failure);
    assert.equal(h.cancellations.length, 1);
    assert.equal(h.body.locked, false);
  });
}

test('EOF callback failure releases the lock without canceling the exhausted source', async () => {
  const failure = new Error('final callback failed');
  const h = harness([frame('last line')], { close: true });
  await assert.rejects(h.read({ onLine() { throw failure; } }), error => error === failure);
  assert.equal(h.body.locked, false);
  assert.equal(h.cancellations.length, 0);
});

for (const name of ['AbortError', 'TimeoutError']) {
  test(`${name} from an in-flight read releases the lock and preserves error identity`, async () => {
    const h = harness([frame('provisional')]);
    const failure = new DOMException('read failed', name);
    const pending = h.read();
    await tick();
    h.controller.error(failure);
    await assert.rejects(pending, error => error === failure);
    assert.equal(h.body.locked, false);
    assert.equal(h.cancellations.length, 0, 'errored streams do not call the underlying cancel hook');
    await tick(); // Also expose unhandled cancellation rejections to node:test.
  });
}

for (const kind of ['throws', 'rejects', 'never settles']) {
  test(`cancellation that ${kind} cannot mask or delay the parsing failure`, async () => {
    const cleanupFailure = new Error('cleanup failed');
    const cancel = kind === 'throws' ? () => { throw cleanupFailure; }
      : kind === 'rejects' ? () => Promise.reject(cleanupFailure)
        : () => new Promise(() => {});
    const h = harness(['data: invalid\n'], { cancel });
    let outcome;
    h.read().then(() => { outcome = 'unexpected success'; }, error => { outcome = error; });
    await tick();
    assert.equal(outcome?.name, 'SyntaxError');
    assert.equal(h.cancellations.length, 1);
    assert.equal(h.body.locked, false);
    await tick();
  });
}

// Exercise the real provider retry loops as well as the shared reader. No live
// requests or provider credentials are used; each response is a native stream.
for (const provider of ['Groq', 'OpenRouter']) {
  test(`${provider} cancels and unlocks a failed response before requesting its retry`, async () => {
    const failed = harness(['data: invalid\n'], { cancel: () => new Promise(() => {}) });
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: 'retried' }, finish_reason: 'stop' }] })}\n`;
    const success = harness([payload], { close: true });
    let calls = 0;
    const window = {
      AIAddonManager: {
        register() {},
        getAddonSetting(_id, key, fallback) {
          return key === 'api-keys' ? ['fixture-key'] : key === 'model' ? 'fixture-model' : fallback;
        },
      },
      async ivLyricsFetch() {
        calls++;
        assert.ok(calls <= 2, 'unexpected extra provider request');
        if (calls === 2) {
          assert.equal(failed.cancellations.length, 1);
          assert.equal(failed.body.locked, false);
        }
        return { ok: true, status: 200, body: calls === 1 ? failed.body : success.body };
      },
    };
    const context = vm.createContext({ window, TextDecoder, console,
      setTimeout(callback) { callback(); } });
    vm.runInContext(source, context);
    const addon = readFileSync(new URL(`Addon_AI_${provider}.js`, root), 'utf8');
    const marker = '    registerAddon();';
    assert.ok(addon.includes(marker));
    vm.runInContext(addon.replace(marker, `${marker}\n    window.read = call${provider}APIStream;`), context);
    assert.equal(await window.read({ systemPrompt: 'fixture', userPrompt: 'fixture' }, null, null, 2), 'retried');
    assert.equal(calls, 2);
    assert.equal(success.body.locked, false);
    assert.equal(success.cancellations.length, 0);
  });
}
