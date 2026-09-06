import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../AIRequest.js', import.meta.url), 'utf8');
function harness({ native = false, fetch = async (_input, init) => init } = {}) {
  const timers = [];
  const window = { fetch };
  vm.runInNewContext(source, {
    window, AbortController, AbortSignal: native ? AbortSignal : {}, DOMException,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return 1; },
  });
  return { request: window.ivLyricsFetch, timers };
}

test('timeout values are safe integers for native signals and fallback timers', async () => {
  const { request, timers } = harness();
  for (const timeout of [1000.9, -1, Infinity, 'not-a-number', Number.MAX_VALUE]) await request('url', {}, timeout);
  assert.deepEqual(timers.map(timer => timer.delay), [1000, 1000, 90000, 90000, 2147483647]);
  const native = harness({ native: true });
  const result = await native.request('url', {}, 1234.5);
  assert.equal(result.signal.aborted, false);
});

test('fallback removes source listeners and preserves the caller abort reason', async () => {
  const { request } = harness();
  const controller = new AbortController();
  const result = await request('url', { signal: controller.signal, method: 'POST', body: 'lyrics' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort('track changed');
  assert.equal(result.signal.reason, 'track changed');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(result.method, 'POST');
  assert.equal(result.body, 'lyrics');
});

test('timeout still aborts the response body after headers have resolved', async () => {
  const controller = new AbortController();
  const { request, timers } = harness({ fetch: async (_input, { signal }) => ({
    text: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  }) });
  const response = await request('url', { signal: controller.signal });
  const body = response.text();
  timers[0].callback();
  await assert.rejects(body, { name: 'TimeoutError' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('already canceled requests retain their reason without adding listeners', async () => {
  const { request } = harness();
  const controller = new AbortController();
  controller.abort('canceled');
  const result = await request('url', { signal: controller.signal });
  assert.equal(result.signal.reason, 'canceled');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
