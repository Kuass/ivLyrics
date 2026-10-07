// Regressions reproduced through ordinary Settings callers, and separately
// controlled readiness changes. Every assertion below uses actual source bodies.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, A, B, track, snap, seed, plain } from './helpers/reload_harness.mjs';
import { controls } from './helpers/reload_settings.mjs';

for (const queuedState of [false, true]) {
  test(`REGRESSION fake-karaoke toggle refreshes accepted A while public item lags; queued=${queuedState}`, async () => {
    const h = await ready({ queuedState }, track(B));
    try {
      const ui = controls(h); seed(h); ui.language();
      await h.finish();
      assert.deepEqual(ui.saves, [['spotify-fake-karaoke-enabled', true]]);
      assert.deepEqual(h.reloads.map(task => task.args), [[false]]);
      assert.equal(h.c.currentTrackUri, A); assert.equal(h.c.state.uri, A);
      assert.equal(h.c.state.lyricsDisplayUri, A); assert.equal(h.c.state.isLoading, false);
      assert.equal(h.clock.getSnapshot().uri, A);
      assert.deepEqual(h.fetches.map(args => args[0].uri), [A]);
      assert.deepEqual(h.cacheInvalidations, [A]);
      assert.equal(h.context.CACHE.unrelated, undefined); assert.equal(h.clears.length, 0);
    } finally { await h.finish(); }
  });

  test(`REGRESSION typography captures authoritative origin for eager loading and cache clearing; queued=${queuedState}`, async () => {
    const h = await ready({ queuedState }, track(B));
    try {
      const ui = controls(h); seed(h); ui.typography();
      await h.settle();
      const pending = snap(h), dm = plain(h.c._dmResults);
      await h.finish();
      assert.equal(pending.current, A); assert.equal(pending.uri, A); assert.equal(pending.loading, true);
      assert.deepEqual(h.reloads.map(task => task.args), [[]]);
      assert.deepEqual(ui.saves, [['ivLyrics:visual:phonetic-hyphen-replace', 'space']]);
      assert.equal(h.clears[0].id, A.slice(14)); assert.deepEqual(h.cacheInvalidations, [A]);
      assert.deepEqual(dm, { [B]: {} });
      assert.equal(h.trace.find(entry => entry.event === 'sync-id').meta.item.uri, A);
      assert.deepEqual(h.fetches.map(args => args[0].uri), [A]);
      assert.equal(h.c.state.isLoading, false); assert.deepEqual(h.toasts, []);
    } finally { await h.finish(); }
  });

  test(`REGRESSION typography refresh resolves current B after origin A clear; queued=${queuedState}`, async () => {
    const h = await ready({ queuedState });
    try {
      controls(h).typography(); await h.settle();
      await h.play(track(B), track(A));
      const before = snap(h);
      await h.finish();
      assert.equal(before.current, B); assert.equal(before.loading, false);
      assert.equal(h.c.currentTrackUri, B); assert.equal(h.c.state.uri, B);
      assert.equal(h.c.state.lyricsDisplayUri, B); assert.equal(h.c.state.isLoading, false);
      assert.equal(h.clears[0].id, A.slice(14));
      assert.deepEqual(h.fetches.map(args => args[0].uri), [B, B]);
      assert.equal(h.fetches.at(-1)[2], true);
      assert.equal(h.trace.find(entry => entry.event === 'sync-id').meta.item.uri, A);
    } finally { await h.finish(); }
  });

  for (const at of ['origin', 'final']) for (const availability of ['uri-only', 'resolver-null']) {
    test(`REGRESSION ${at} ${availability} leaves a newer B fetch owner intact; queued=${queuedState}`, async () => {
      const h = await ready({ queuedState });
      try {
        if (at === 'final') { h.c.reloadLyrics(true); await h.settle(); }
        h.hold('language', B); await h.play(track(B));
        const held = snap(h);
        h.playInput({ uri: B }, availability === 'uri-only' ? { uri: B } : track(A));
        const resolved = plain(h.context.window.Utils.resolveStablePlaybackTrack());
        seed(h);
        if (at === 'origin') await h.c.reloadLyrics(false);
        else { h.clears[0].resolve(); await h.reloads[0].promise; }
        await h.settle();
        const after = snap(h), calls = h.fetches.length;
        await h.finish();
        assert.equal(resolved?.uri ?? null, availability === 'uri-only' ? B : null);
        assert.deepEqual(after, held, 'rejected input does not supersede or terminate a newer request');
        assert.equal(calls, 1, 'only the real B fetch is dispatched');
        assert.equal(h.c.currentTrackUri, B); assert.equal(h.c.state.isLoading, false);
        assert.equal(h.c.state.error, null); assert.equal(h.c._activeLyricsFetchSeq, held.seq);
        assert.equal(h.clears.length, at === 'origin' ? 0 : 1); assert.deepEqual(h.toasts, []);
      } finally { await h.finish(); }
    });
  }
}
