import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const file = process.env.IVLYRICS_TITLE_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_TITLE_SOURCE_DIR, 'CommunityVideoSelector.js')
  : new URL('../CommunityVideoSelector.js', import.meta.url);
const source = readFileSync(file, 'utf8');
const start = source.indexOf('  // URL 변경 시 YouTube 제목 자동 가져오기');
const end = source.indexOf('\n  useEffect(() => {\n    if (!hideDislikedVideos', start);
assert.ok(start >= 0 && end > start);
const effect = source.slice(start, end);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness() {
  const requests = [], writes = [], errors = [], timers = new Map(), titleFetchTimeout = { current: null };
  const state = { title: '', preview: null, loading: false }; let timerId = 0;
  const hooks = {};
  const write = key => value => { state[key] = value; writes.push([key, value]); hooks[key]?.(value); };
  const render = (submitUrl, editingVideo = null) => {
    let cleanup;
    vm.runInNewContext(effect, {
      submitUrl, editingVideo, titleFetchTimeout,
      setSubmitVideoTitle: write('title'), setFormPreviewVideoId: write('preview'), setIsLoadingTitle: write('loading'),
      Utils: {
        extractYouTubeVideoId: value => value.startsWith('video:') ? value.slice(6) : null,
        getYouTubeVideoTitle(videoId) { const pending = deferred(); requests.push({ ...pending, videoId }); return pending.promise; },
      },
      console: { error: (...args) => errors.push(args) },
      setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
      clearTimeout(id) { timers.delete(id); },
      useEffect(fn, deps) { assert.deepEqual(Array.from(deps), [editingVideo, submitUrl]); cleanup = fn(); },
    });
    return () => cleanup?.();
  };
  const fire = id => { const timer = timers.get(id); assert.ok(timer); timers.delete(id); return timer.fn(); };
  const fireCurrent = () => fire(titleFetchTimeout.current);
  return { requests, writes, errors, timers, titleFetchTimeout, state, hooks, render, fire, fireCurrent };
}

test('cleanup before debounce prevents a title request', () => {
  const h = harness(); const cleanup = h.render('video:A'); assert.equal([...h.timers.values()][0].delay, 500);
  cleanup(); assert.equal(h.timers.size, 0); assert.equal(h.requests.length, 0);
});
test('a queued debounce callback is inert after cleanup', async () => {
  const h = harness(); const cleanup = h.render('video:A'); const callback = [...h.timers.values()][0].fn;
  cleanup(); callback(); await flush(); assert.equal(h.requests.length, 0); assert.deepEqual(h.writes, []);
});
test('retired success cannot overwrite a newer title or preview', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.fireCurrent(); cleanup(); h.render('video:B'); h.fireCurrent();
  h.requests[1].resolve('Title B'); await flush(); const before = h.writes.length;
  h.requests[0].resolve('Title A'); await flush();
  assert.deepEqual(h.state, { title: 'Title B', preview: 'B', loading: false }); assert.equal(h.writes.length, before);
});
test('old completion cannot clear loading while the new lookup is pending', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.fireCurrent(); cleanup(); h.render('video:B'); h.fireCurrent();
  h.requests[0].resolve('Title A'); await flush(); assert.equal(h.state.loading, true); assert.equal(h.state.title, '');
  h.requests[1].resolve('Title B'); await flush(); assert.equal(h.state.loading, false);
});
test('retired rejection has no error or state side effects', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.fireCurrent(); cleanup(); h.render('video:B'); h.fireCurrent();
  const before = h.writes.length; h.requests[0].reject(new Error('old failure')); await flush();
  assert.equal(h.writes.length, before); assert.equal(h.errors.length, 0); assert.equal(h.state.loading, true);
  h.requests[1].resolve('Title B'); await flush();
});
test('invalid replacement input resets loading and rejects the old result', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.fireCurrent(); cleanup(); h.render('invalid');
  assert.deepEqual(h.state, { title: '', preview: null, loading: false });
  h.requests[0].resolve('Title A'); await flush(); assert.deepEqual(h.state, { title: '', preview: null, loading: false });
});
test('cleared form input remains cleared after an old result', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.fireCurrent(); cleanup(); h.render('');
  h.requests[0].resolve('Title A'); await flush(); assert.deepEqual(h.state, { title: '', preview: null, loading: false });
});
test('editing an existing video retains its saved title after an old lookup resolves', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.fireCurrent(); cleanup(); h.render('', { youtubeVideoId: 'saved', youtubeTitle: 'Saved title' });
  h.requests[0].resolve('Title A'); await flush(); assert.deepEqual(h.state, { title: 'Saved title', preview: 'saved', loading: false });
});
test('unmount during a lookup retires success state writes', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.fireCurrent(); cleanup(); const before = h.writes.length;
  h.requests[0].resolve('Title A'); await flush(); assert.equal(h.writes.length, before);
});
test('unmount during a lookup retires rejection logging and state writes', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.fireCurrent(); cleanup(); const before = h.writes.length;
  h.requests[0].reject(new Error('retired')); await flush(); assert.equal(h.writes.length, before); assert.equal(h.errors.length, 0);
});
test('active success retains title, video identity and loading lifecycle', async () => {
  const h = harness(); h.render('video:A'); h.fireCurrent(); assert.equal(h.state.loading, true);
  h.requests[0].resolve('Title A'); await flush(); assert.deepEqual(h.state, { title: 'Title A', preview: 'A', loading: false });
});
test('active failure retains error reporting and clears loading', async () => {
  const h = harness(); h.render('video:A'); h.fireCurrent(); const failure = new Error('active');
  h.requests[0].reject(failure); await flush(); assert.equal(h.errors.length, 1); assert.equal(h.errors[0][1], failure);
  assert.equal(h.state.title, ''); assert.equal(h.state.loading, false);
});
for (const title of ['', null]) {
  test(`active ${String(title)} title preserves existing empty-title behavior`, async () => {
    const h = harness(); h.render('video:A'); h.fireCurrent(); h.requests[0].resolve(title); await flush();
    assert.deepEqual(h.state, { title: '', preview: 'A', loading: false });
  });
}
test('editing video identity takes precedence over a typed URL', async () => {
  const h = harness(); h.render('video:typed', { youtubeVideoId: 'editing', youtubeTitle: 'Old title' }); h.fireCurrent();
  assert.equal(h.requests[0].videoId, 'editing'); h.requests[0].resolve('Edited title'); await flush();
  assert.deepEqual(h.state, { title: 'Edited title', preview: 'editing', loading: false });
});
test('repeated stale cleanup cannot cancel a replacement debounce', async () => {
  const h = harness(); const cleanup = h.render('video:A'); cleanup(); h.render('video:B'); const timer = h.titleFetchTimeout.current;
  cleanup(); assert.equal(h.timers.has(timer), true); assert.equal(h.titleFetchTimeout.current, timer);
  h.fire(timer); assert.equal(h.requests[0].videoId, 'B'); h.requests[0].resolve('Title B'); await flush();
});
test('retirement from a title setter prevents later preview and loading writes', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.fireCurrent(); h.hooks.title = () => cleanup();
  h.requests[0].resolve('Title A'); await flush(); assert.equal(h.state.preview, null); assert.equal(h.state.loading, true);
});
test('current lookup still succeeds after several retired generations finish out of order', async () => {
  const h = harness(); const cleanups = [];
  for (const id of ['A', 'B', 'C']) { cleanups.at(-1)?.(); cleanups.push(h.render(`video:${id}`)); h.fireCurrent(); }
  h.requests[1].resolve('Title B'); h.requests[0].reject(new Error('old A')); await flush();
  assert.equal(h.state.loading, true); h.requests[2].resolve('Title C'); await flush();
  assert.deepEqual(h.state, { title: 'Title C', preview: 'C', loading: false }); assert.equal(h.errors.length, 0);
});
test('retirement from loading state does not start an obsolete lookup', async () => {
  const h = harness(); const cleanup = h.render('video:A'); h.hooks.loading = value => { if (value) cleanup(); };
  h.fireCurrent(); await flush(); assert.equal(h.requests.length, 0);
});
