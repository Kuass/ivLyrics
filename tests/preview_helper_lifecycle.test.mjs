import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const file = process.env.IVLYRICS_PREVIEW_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_PREVIEW_SOURCE_DIR, 'CommunityVideoSelector.js')
  : new URL('../CommunityVideoSelector.js', import.meta.url);
const source = readFileSync(file, 'utf8');
const start = source.indexOf('const startPreviewHelperVideoDownload = ');
const end = source.indexOf('\nconst SyncedVideoPreview = ', start);
assert.ok(start >= 0 && end > start);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness({ sharedHealth = null, missing = false } = {}) {
  const health = [], requests = [], toasts = [], urls = [], errors = [], unavailable = [];
  const timers = new Map();
  let nextTimer = 0, now = 1000;
  const context = vm.createContext({
    console,
    Date: { now: () => now },
    I18n: { t: (key, params) => params ? `${key}:${params.percent}` : key },
    Toast: Object.fromEntries(['progress', 'error', 'success', 'dismissProgress'].map(name => [name, (...args) => toasts.push([name, ...args])])),
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  if (!missing) context.VideoHelperService = {
    isHelperAvailable() { const pending = sharedHealth || deferred(); health.push(pending); return pending.promise; },
    requestVideo(videoId, callbacks) {
      const request = { videoId, callbacks, aborted: 0, onAbort: null };
      request.abort = () => { request.aborted++; request.onAbort?.(); };
      requests.push(request);
      context.onRequest?.(request);
      return request.abort;
    },
  };
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.begin = startPreviewHelperVideoDownload;`, context);
  const begin = (videoId = 'A', abortRef = { current: null }) => {
    const cleanup = context.begin({ videoId, abortRef,
      setHelperVideoUrl: url => urls.push([videoId, url]),
      onUnavailable: () => unavailable.push(videoId),
      onError: message => errors.push([videoId, message]),
    });
    return { cleanup, abortRef };
  };
  return { context, begin, health, requests, toasts, timers, urls, errors, unavailable, advance: ms => { now += ms; } };
}

test('cleanup during health check prevents an obsolete download from starting', async () => {
  const h = harness(); const a = h.begin();
  a.cleanup(); h.health[0].resolve(true); await flush();
  assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0);
});
test('retired unavailable health result has no error or unavailable callback', async () => {
  const h = harness(); const a = h.begin(); a.cleanup();
  const before = h.toasts.length; h.health[0].resolve(false); await flush();
  assert.deepEqual(h.unavailable, []); assert.equal(h.toasts.length, before);
});
test('shared pending health result starts only the latest preview', async () => {
  const pending = deferred(); const h = harness({ sharedHealth: pending });
  const ref = { current: null }; h.begin('A', ref).cleanup(); const b = h.begin('B', ref);
  pending.resolve(true); await flush();
  assert.deepEqual(h.requests.map(r => r.videoId), ['B']);
  assert.equal(ref.current, h.requests[0].abort); b.cleanup();
});
test('late old health result cannot replace the newer abort handle', async () => {
  const h = harness(); const ref = { current: null };
  h.begin('A', ref).cleanup(); const b = h.begin('B', ref);
  h.health[1].resolve(true); await flush(); const current = ref.current;
  h.health[0].resolve(true); await flush();
  assert.equal(ref.current, current); assert.deepEqual(h.requests.map(r => r.videoId), ['B']); b.cleanup();
});
test('cleanup aborts its active download and releases its own ref', async () => {
  const h = harness(); const a = h.begin(); h.health[0].resolve(true); await flush(); a.cleanup();
  assert.equal(h.requests[0].aborted, 1); assert.equal(a.abortRef.current, null); assert.equal(h.timers.size, 0);
});
test('repeated stale cleanup does not abort or dismiss the newer preview', async () => {
  const h = harness(); const ref = { current: null }; const a = h.begin('A', ref);
  h.health[0].resolve(true); await flush(); a.cleanup();
  const b = h.begin('B', ref); h.health[1].resolve(true); await flush();
  const before = h.toasts.length; a.cleanup();
  assert.equal(h.requests[1].aborted, 0); assert.equal(ref.current, h.requests[1].abort);
  assert.equal(h.toasts.length, before); b.cleanup();
});
test('cleanup cancels only its owned handle even if another request owns the ref', async () => {
  const h = harness(); const ref = { current: null }; const a = h.begin('A', ref);
  h.health[0].resolve(true); await flush();
  const b = h.begin('B', ref); h.health[1].resolve(true); await flush(); a.cleanup();
  assert.equal(h.requests[0].aborted, 1); assert.equal(h.requests[1].aborted, 0);
  assert.equal(ref.current, h.requests[1].abort); b.cleanup();
});
for (const kind of ['onProgress', 'onComplete', 'onError']) {
  test(`retired ${kind} cannot change state or toast output`, async () => {
    const h = harness(); const a = h.begin(); h.health[0].resolve(true); await flush(); a.cleanup();
    const before = h.toasts.length; h.requests[0].callbacks[kind](kind === 'onProgress' ? { status: 'downloading', percent: 50 } : 'fixture');
    assert.deepEqual(h.urls, []); assert.deepEqual(h.errors, []); assert.equal(h.toasts.length, before);
  });
}
test('already-queued preparing timer is inert after cleanup', () => {
  const h = harness(); const a = h.begin(); const timer = [...h.timers.values()][0]; a.cleanup();
  const before = h.toasts.length; timer.fn(); assert.equal(h.toasts.length, before);
});
test('active progress preserves rounded download and checking messages', async () => {
  const h = harness(); const a = h.begin(); h.health[0].resolve(true); await flush();
  h.requests[0].callbacks.onProgress({ status: 'downloading', percent: 12.6 });
  h.requests[0].callbacks.onProgress({ status: 'checking' });
  assert.deepEqual(h.toasts, [['progress', 'videoBackground.downloading:13', 13], ['progress', 'videoBackground.checking', 0]]);
  assert.equal(h.timers.size, 0); a.cleanup();
});
for (const elapsed of [500, 2000]) {
  test(`active completion at ${elapsed} ms preserves URL and success-toast timing`, async () => {
    const h = harness(); const a = h.begin(); h.health[0].resolve(true); await flush(); h.advance(elapsed);
    h.requests[0].callbacks.onComplete('https://fixture.invalid/video');
    assert.deepEqual(h.urls, [['A', 'https://fixture.invalid/video']]);
    assert.equal(h.toasts.filter(t => t[0] === 'success').length, elapsed > 1500 ? 1 : 0);
    assert.equal(h.timers.size, 0); a.cleanup();
  });
}
test('active errors retain optional callback and translated message', async () => {
  const h = harness(); const a = h.begin(); h.health[0].resolve(true); await flush();
  h.requests[0].callbacks.onError('fixture error');
  assert.deepEqual(h.errors, [['A', 'fixture error']]);
  assert.deepEqual(h.toasts, [['dismissProgress'], ['error', 'videoBackground.helperError']]); a.cleanup();
});
test('active unavailable result retains notification and clears preparing timer', async () => {
  const h = harness(); const a = h.begin(); h.health[0].resolve(false); await flush();
  assert.deepEqual(h.unavailable, ['A']); assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0);
  assert.deepEqual(h.toasts, [['error', 'videoBackground.helperNotConnected']]); a.cleanup();
});
test('abort reentrancy cannot clear a replacement abort handle', async () => {
  const h = harness(); const a = h.begin(); h.health[0].resolve(true); await flush();
  const replacement = () => {}; h.requests[0].onAbort = () => { a.abortRef.current = replacement; };
  a.cleanup(); assert.equal(a.abortRef.current, replacement);
});
test('cleanup during synchronous request setup immediately aborts the returned handle', async () => {
  const h = harness(); const a = h.begin(); h.context.onRequest = () => a.cleanup();
  h.health[0].resolve(true); await flush();
  assert.equal(h.requests[0].aborted, 1); assert.equal(a.abortRef.current, null); assert.equal(h.timers.size, 0);
});
test('missing helper does not leave a preparing toast scheduled', async () => {
  const h = harness({ missing: true }); const a = h.begin(); await flush();
  assert.equal(h.timers.size, 0); assert.deepEqual(h.toasts, []); a.cleanup();
});
for (const [index, component] of ['SyncedVideoPreview', 'SimpleVideoPreview'].entries()) {
  test(`${component} actual effect returns the guarded shared cleanup`, async () => {
    const effects = [...source.matchAll(/useEffect\(\(\) => \{\n    if \(!useHelper \|\| !videoId\) return;[\s\S]*?\n  \}, \[useHelper, videoId\]\);/g)];
    assert.equal(effects.length, 2);
    const h = harness(); let cleanup;
    Object.assign(h.context, { useHelper: true, videoId: component, abortRef: { current: null },
      setHelperVideoUrl() {}, setIsReady() {}, useEffect: callback => { cleanup = callback(); } });
    vm.runInContext(effects[index][0], h.context); assert.equal(typeof cleanup, 'function'); cleanup();
    h.health[0].resolve(true); await flush(); assert.equal(h.requests.length, 0);
  });
}
