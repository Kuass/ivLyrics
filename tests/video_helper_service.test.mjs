import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../VideoHelperService.js', import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
function harness(fetch) {
  const timers = new Map();
  let nextId = 0;
  const window = {};
  vm.runInNewContext(source, {
    window, fetch, AbortController, TextDecoder, URL, console: { error() {} },
    setTimeout(fn) { timers.set(++nextId, fn); return nextId; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { service: window.VideoHelperService, timers };
}

test('concurrent health checks share one request and clear their timer on failure', async () => {
  let calls = 0;
  let fail;
  const { service, timers } = harness(() => {
    calls++;
    return new Promise((resolve, reject) => { fail = reject; });
  });
  const checks = [service.checkHealth(), service.isHelperAvailable(), service.checkHealth()];
  assert.equal(calls, 1);
  fail(new Error('offline'));
  assert.deepEqual(await Promise.all(checks), [false, false, false]);
  assert.equal(timers.size, 0);
  assert.equal(await service.isHelperAvailable(), false);
  assert.equal(calls, 1);
});

test('health timeout covers the response body and status rejects HTTP errors', async () => {
  const { service, timers } = harness(async (_url, { signal }) => ({
    ok: true,
    text: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  }));
  const pending = service.checkHealth();
  await tick();
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(await pending, false);
  assert.equal(timers.size, 0);
  const other = harness(async () => ({ ok: false, status: 500, json: async () => ({ success: true, url: 'bad' }) }));
  assert.equal((await other.service.getVideoStatus('test')).success, false);
  assert.equal(other.timers.size, 0);
});

function streamHarness(chunks, { keepOpen = false } = {}) {
  let canceled = 0;
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      if (!keepOpen) controller.close();
    },
    cancel() { canceled++; },
  });
  const state = harness(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  const progress = [], completed = [], errors = [];
  const abort = state.service.requestVideo('abcdefghijk', {
    onProgress: value => progress.push(value), onComplete: value => completed.push(value), onError: value => errors.push(value),
  });
  return { ...state, body, progress, completed, errors, abort, get canceled() { return canceled; } };
}

for (const order of ['standard', 'legacy']) {
  test(`SSE supports ${order} field order, split UTF-8, CRLF and one terminal callback`, async () => {
    const event = (type, data) => order === 'standard'
      ? `event: ${type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`
      : `data: ${JSON.stringify(data)}\r\nevent: ${type}\r\n\r\n`;
    const payload = new TextEncoder().encode(event('progress', { percent: 25, message: '다운로드' })
      + event('complete', { status: 'completed', url: 'http://localhost:15123/video.webm' })
      + event('error', { message: 'too late' }));
    const state = streamHarness(Array.from(payload, byte => Uint8Array.of(byte)), { keepOpen: true });
    for (let i = 0; i < 20 && !state.completed.length; i++) await tick();
    assert.equal(state.progress[0]?.message, '다운로드');
    assert.deepEqual(state.completed, ['http://localhost:15123/video.webm']);
    assert.deepEqual(state.errors, []);
    assert.equal(state.canceled, 1);
    assert.equal(state.body.locked, false);
    assert.equal(state.timers.size, 0);
  });
}

test('SSE multiline JSON and final unterminated event are delivered', async () => {
  const state = streamHarness(['event: complete\ndata: {"status":"completed",\ndata: "url":"https://example.com/video"}']);
  await tick();
  assert.deepEqual(state.completed, ['https://example.com/video']);
  assert.equal(state.body.locked, false);
});

test('early EOF reports an error instead of leaving the download pending', async () => {
  const state = streamHarness(['event: progress\ndata: {"percent":1}\n\n']);
  await tick();
  assert.equal(state.errors.length, 1);
  assert.equal(state.completed.length, 0);
  assert.equal(state.body.locked, false);
});

test('cancel suppresses queued callbacks and releases the stream', async () => {
  const state = streamHarness(['event: complete\ndata: {"status":"completed","url":"https://example.com/video"}\n\n']);
  state.abort();
  await tick();
  assert.deepEqual(state.completed, []);
  assert.deepEqual(state.errors, []);
  assert.equal(state.body.locked, false);
});

test('idle downloads time out and cancel their reader', async () => {
  const state = streamHarness([], { keepOpen: true });
  await tick();
  assert.equal(state.timers.size, 1);
  [...state.timers.values()][0]();
  await tick();
  assert.equal(state.errors.length, 1);
  assert.equal(state.canceled, 1);
  assert.equal(state.body.locked, false);
});

test('oversized unterminated SSE events fail with bounded buffering', async () => {
  const state = streamHarness(['data: ' + 'x'.repeat(1024 * 1024 + 1)]);
  await tick();
  assert.equal(state.errors.length, 1);
  assert.equal(state.body.locked, false);
});
