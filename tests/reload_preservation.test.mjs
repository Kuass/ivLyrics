// Compatibility controls that pass unchanged on the base and candidate.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { ready, harness, source, cut, A, B, track, snap, seed, plain } from './helpers/reload_harness.mjs';
import { controls } from './helpers/reload_settings.mjs';

for (const queuedState of [false, true]) {
  test(`CONTROL matching fake-karaoke toggle keeps false-cache behavior; queued=${queuedState}`, async () => {
    const h = await ready({ queuedState });
    try {
      seed(h); const cache = h.context.CACHE; controls(h).language(); await h.finish();
      assert.equal(h.context.CACHE, cache); assert.equal(cache.unrelated, undefined);
      assert.equal(h.clears.length, 0); assert.deepEqual(h.reloads[0].args, [false]);
      assert.equal(h.c.state.isLoading, false); assert.equal(h.c.currentTrackUri, A);
    } finally { await h.finish(); }
  });
  test(`CONTROL typography clears A with eager loading before refreshing current B; queued=${queuedState}`, async () => {
    const h = await ready({ queuedState });
    try {
      seed(h); const before = snap(h); h.c.lastProcessedUri = A; h.c.lastProcessedMode = 2;
      controls(h).typography(); await h.settle();
      const pending = snap(h), lyrics = h.c.state.currentLyrics;
      const resets = [h.c.lastProcessedUri, h.c.lastProcessedMode];
      const pendingFetches = h.fetches.length;
      const dm = plain(h.c._dmResults), translatedUris = [...h.context.CacheManager._cache.keys()];
      await h.play(track(B)); await h.finish();
      assert.equal(pending.current, A); assert.equal(pending.loading, true); assert.ok(pending.seq > before.seq);
      assert.equal(lyrics.length, 0); assert.deepEqual(resets, [null, null]); assert.equal(pendingFetches, 0);
      assert.equal(h.clears[0].id, A.slice(14)); assert.deepEqual(h.cacheInvalidations, [A]);
      assert.deepEqual(dm, { [B]: {} }); assert.deepEqual(translatedUris, [`translation:${B}`]);
      for (const event of ['_inflightGemini', '_inflightTrad']) {
        assert.deepEqual(h.trace.find(entry => entry.event === event).selected, [A]);
      }
      assert.deepEqual(h.fetches.map(args => args[0].uri), [B, B]);
      assert.equal(h.c.state.isLoading, false); assert.equal(h.c.currentTrackUri, B);
      const sideEffects = h.trace.filter(entry => ['cultural-track', 'clear-start', 'clear-complete', 'translator-memory', 'translator-inflight', 'sync-id', 'sync-clear'].includes(entry.event));
      // Playback itself also clears translator inflight work. Check captured origin
      // ordering from persistent completion onward without hiding that operation.
      const completion = sideEffects.findIndex(entry => entry.event === 'clear-complete');
      assert.deepEqual(sideEffects.slice(0, 2).map(entry => entry.event), ['cultural-track', 'clear-start']);
      assert.deepEqual(sideEffects.slice(completion).map(entry => entry.event),
        ['clear-complete', 'translator-memory', 'translator-inflight', 'sync-id', 'sync-clear']);
      assert.equal(h.trace.find(entry => entry.event === 'sync-id').meta.item.uri, A);
      assert.deepEqual(h.toasts, []);
    } finally { await h.finish(); }
  });
  test(`CONTROL ready B is admitted before component identity catches up; queued=${queuedState}`, async () => {
    const h = await ready({ queuedState });
    try {
      h.playInput(track(B)); const before = h.c.currentTrackUri;
      await h.c.reloadLyrics(false); await h.finish();
      assert.equal(before, A); assert.equal(h.c.currentTrackUri, B); assert.equal(h.c.state.isLoading, false);
    } finally { await h.finish(); }
  });
  test(`CONTROL A to B to A retains the reload's current refresh; queued=${queuedState}`, async () => {
    const h = await ready({ queuedState });
    try {
      h.c.reloadLyrics(true); await h.settle(); await h.play(track(B)); await h.play(track(A));
      const before = snap(h); await h.finish();
      assert.equal(h.fetches.at(-1)[0].uri, A); assert.equal(h.fetches.at(-1)[2], true);
      assert.ok(h.c._activeLyricsFetchSeq > before.seq); assert.equal(h.c.state.isLoading, false);
    } finally { await h.finish(); }
  });
  test(`CONTROL final malformed metadata parsing stays inside fetchLyrics's catch; queued=${queuedState}`, async () => {
    const h = await ready({ queuedState });
    try {
      let parses = 0; const parse = h.c.infoFromTrack;
      h.c.infoFromTrack = function(...args) { parses++; return parse.apply(this, args); };
      const reload = h.c.reloadLyrics(true); await h.settle(); const originSeq = h.c._activeLyricsFetchSeq;
      const originParses = parses;
      h.playInput({ ...track(A), artists: {} });
      h.clears[0].resolve(); await reload; await h.finish();
      assert.equal(originParses, 1); assert.equal(parses, 2);
      assert.equal(h.fetches.length, 1); assert.equal(h.c._activeLyricsFetchSeq, originSeq);
      assert.match(h.c.state.error, /^Failed to fetch lyrics: .*map.*not a function$/);
      assert.equal(h.c.state.isLoading, false); assert.deepEqual(h.toasts, []);
    } finally { await h.finish(); }
  });
}
for (const key of ['karaoke-mode-enabled', 'karaoke-bounce', 'karaoke-line-transition']) {
  test(`CONTROL other language setting retains event behavior: ${key}`, async () => {
    const h = await ready();
    try {
      controls(h).language(key); await h.finish();
      assert.equal(h.reloads.length, 0); assert.equal(h.fetches.length, 0);
      assert.equal(h.c.currentTrackUri, A); assert.equal(h.c.state.isLoading, false);
    } finally { await h.finish(); }
  });
}
for (const scope of ['Current', 'All']) {
  test(`CONTROL local cache ${scope} finishes its own clear before reload(false) and success toast`, async () => {
    const h = await ready();
    try {
      const click = controls(h).cache(scope); await h.settle();
      const beforeReload = h.reloads.length;
      await h.play(track(B)); h.clears[0].resolve(); await click; await h.finish();
      assert.equal(beforeReload, 0); assert.equal(h.clears.length, 1);
      assert.equal(h.clears[0].kind, scope === 'Current' ? 'track' : 'all');
      if (scope === 'Current') assert.equal(h.clears[0].id, A.slice(14));
      assert.deepEqual(h.reloads.map(task => task.args), [[false]]);
      assert.equal(h.fetches.at(-1)[0].uri, B); assert.equal(h.c.state.isLoading, false);
      assert.equal(h.toasts.at(-1).kind, 'success');
    } finally { await h.finish(); }
  });
}
for (const uri of ['spotify:local:Artist:Album:Local:200', 'spotify:episode:CCCCCCCCCCCCCCCCCCCCCC']) {
  test(`CONTROL generic cache identity is preserved for ${uri.split(':')[1]}`, async () => {
    const h = harness();
    try {
      await h.play(track(uri)); h.c.reloadLyrics(true); await h.finish();
      assert.equal(h.clears[0].id, `local-uri:${uri}`); assert.equal(h.c.currentTrackUri, uri);
      assert.equal(h.c.state.isLoading, false);
      assert.equal(h.trace.filter(entry => entry.event === 'sync-id').length, 0);
      assert.equal(h.trace.filter(entry => entry.event === 'translator-memory').length, 0);
    } finally { await h.finish(); }
  });
}
test('CONTROL matching public fallback works only when stable resolver is unavailable', async () => {
  const h = await ready();
  try {
    delete h.context.window.Utils.resolveStablePlaybackTrack;
    await h.c.reloadLyrics(false); await h.finish();
    assert.equal(h.c.currentTrackUri, A); assert.equal(h.c.state.isLoading, false);
  } finally { await h.finish(); }
});
test('CONTROL overlapping clears retain issue order and each current refresh', async () => {
  const h = await ready();
  try {
    const first = h.c.reloadLyrics(true), second = h.c.reloadLyrics(true); await h.settle();
    assert.throws(() => h.clears[1].resolve(), /issue order/);
    h.clears[0].resolve(); await first; await h.settle(); h.clears[1].resolve(); await second;
    await h.finish(); assert.equal(h.fetches.length, 2); assert.equal(h.c.state.isLoading, false);
  } finally { await h.finish(); }
});
test('CONTROL real persistent clear open failure resolves false and reload continues', async () => {
  const h = await ready();
  try {
    const logs = [];
    const cache = vm.runInNewContext('({' + cut(source('LyricsService.js'), '        async clearTrack(trackId) {', '        async clearAll()') + '})',
      { console: { error: (...args) => logs.push(args) } });
    cache._openDB = async () => { throw Error('inert cache open failure'); };
    const result = await cache.clearTrack(A.slice(14));
    const reload = h.c.reloadLyrics(true); h.clears[0].resolve(result); await reload; await h.finish();
    assert.equal(result, false); assert.equal(logs.length, 1); assert.equal(h.fetches.length, 1);
    assert.equal(h.c.state.isLoading, false); assert.deepEqual(h.toasts, []);
  } finally { await h.finish(); }
});
test('CONTROL throwing origin collaborator still rejects after clear without refresh or toast', async () => {
  const h = await ready();
  const expected = { expectedReloadRejections: 1 };
  try {
    h.context.window.SyncDataService.getTrackIsrc = () => { throw Error('inert origin sync failure'); };
    const rejected = assert.rejects(h.c.reloadLyrics(true), /inert origin sync failure/);
    h.clears[0].resolve(); await rejected; await h.finish(expected);
    assert.equal(h.fetches.length, 0); assert.equal(h.c.state.isLoading, true);
    assert.equal(h.trace.filter(entry => entry.event === 'translator-memory').length, 1);
    assert.deepEqual(h.toasts, []);
  } finally { await h.finish(expected); }
});
test('CONTROL reload completion does not await fetch and refresh uses the current explicit mode', async () => {
  const h = await ready();
  try {
    const reload = h.c.reloadLyrics(true); await h.settle();
    await h.play(track(B)); h.c.state.explicitMode = 2; h.hold('language', B);
    h.clears[0].resolve(); await reload;
    const pending = h.tasks.filter(task => task.kind === 'fetch').at(-1).done;
    const fetch = h.fetches.at(-1);
    await h.finish();
    assert.equal(pending, false); assert.equal(fetch[0].uri, B); assert.equal(fetch[1], 2); assert.equal(fetch[2], true);
  } finally { await h.finish(); }
});
