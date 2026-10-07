// Explicit invalid-input policy, separate from known caller regressions and
// unchanged compatibility controls. Passing/failing these on the base does not
// classify every selected-policy difference as a preexisting product defect.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, A, B, track, snap, seed, unavailable, plain } from './helpers/reload_harness.mjs';

for (const queuedState of [false, true]) for (const kind of ['missing', 'uri-only', 'foreign-null']) {
  test(`POLICY own ready loader ends with only No track info on ${kind}; queued=${queuedState}`, async () => {
    const h = await ready({ queuedState });
    try {
      const reload = h.c.reloadLyrics(true); await h.settle();
      const admitted = snap(h), beforeState = plain(h.c.state);
      unavailable(h, kind); h.clears[0].resolve(); await reload; await h.settle();
      const after = snap(h), afterState = plain(h.c.state), calls = h.fetches.length;
      await h.finish();
      assert.deepEqual(after, { ...admitted, error: 'No track info', loading: false });
      assert.deepEqual(afterState, { ...beforeState, error: 'No track info', isLoading: false });
      assert.equal(calls, 0, 'invalid fetch is not used to terminate a loader');
      assert.deepEqual(h.toasts, []);
    } finally { await h.finish(); }
  });
}
for (const clearCache of [false, true]) for (const kind of ['missing', 'uri-only', 'foreign-null']) {
  test(`POLICY no ready origin retains an existing loader and allowed cache work: ${kind}, clear=${clearCache}`, async () => {
    const h = await ready({ queuedState: true });
    try {
      h.hold('language', A); h.c.fetchLyrics(track(A), -1, true); await h.settle();
      const held = snap(h); seed(h); unavailable(h, kind);
      const reload = h.c.reloadLyrics(clearCache); await h.settle();
      const pending = snap(h);
      if (h.clears.length) h.clears[0].resolve();
      await reload; await h.settle();
      const after = snap(h), dm = plain(h.c._dmResults), calls = h.fetches.length;
      const clearedAll = h.context.CACHE.unrelated === undefined;
      await h.finish();
      assert.deepEqual(pending, held); assert.deepEqual(after, held); assert.equal(calls, 1);
      assert.equal(clearedAll, true);
      assert.deepEqual(h.cacheInvalidations, kind === 'uri-only' ? [A] : []);
      assert.deepEqual(dm, kind === 'uri-only' ? { [B]: {} } : {});
      assert.equal(h.clears.length, clearCache && kind === 'uri-only' ? 1 : 0);
      if (clearCache && kind === 'uri-only') {
        assert.equal(h.clears[0].id, A.slice(14));
        assert.equal(h.trace.find(entry => entry.event === 'sync-id').meta.item.uri, A);
        assert.equal(h.trace.filter(entry => entry.event === 'translator-memory').length, 1);
      }
      assert.equal(h.c._activeLyricsFetchSeq, held.seq); assert.equal(h.c.state.isLoading, false);
      assert.equal(h.c.state.error, null);
    } finally { await h.finish(); }
  });
}
for (const current of [A, B]) {
  test(`POLICY URI-only origin keeps scoped clear then refreshes newly ready ${current === A ? 'A' : 'B'}`, async () => {
    const h = await ready({ queuedState: true });
    try {
      unavailable(h, 'uri-only'); seed(h); const before = snap(h);
      const reload = h.c.reloadLyrics(true); await h.settle(); const pending = snap(h);
      h.playInput(track(current)); h.clears[0].resolve(); await reload; await h.finish();
      assert.deepEqual(pending, before); assert.deepEqual(h.cacheInvalidations, [A]);
      assert.equal(h.clears[0].id, A.slice(14)); assert.equal(h.fetches.length, 1);
      assert.equal(h.fetches[0][0].uri, current); assert.equal(h.fetches[0][2], true);
      assert.equal(h.c.state.isLoading, false);
      assert.equal(h.trace.find(entry => entry.event === 'sync-id').meta.item.uri, A);
    } finally { await h.finish(); }
  });
}
for (const uri of [A, B]) {
  test(`POLICY final rejection preserves newer ready fetch ownership: ${uri === A ? 'same' : 'different'} URI`, async () => {
    const h = await ready({ queuedState: true });
    try {
      const reload = h.c.reloadLyrics(true); await h.settle();
      h.hold('language', uri); h.playInput(track(uri)); h.c.fetchLyrics(track(uri), -1, true); await h.settle();
      const held = snap(h); unavailable(h, 'foreign-null', uri);
      h.clears[0].resolve(); await reload; await h.settle(); const after = snap(h);
      await h.finish();
      assert.deepEqual(after, held); assert.equal(h.c.state.error, null); assert.equal(h.c.state.isLoading, false);
    } finally { await h.finish(); }
  });
}
test('POLICY actual new playback transition keeps its loader and existing resolution deadline', async () => {
  const h = await ready({ queuedState: true });
  try {
    const reload = h.c.reloadLyrics(true); await h.settle(); const origin = snap(h);
    h.playInput({ uri: B }, null); h.c.schedulePlaybackTrackResolution(null); await h.settle();
    const pending = snap(h), timer = h.c._playbackTrackResolutionTimer;
    h.clears[0].resolve(); await reload; await h.settle();
    const after = snap(h), sameTimer = h.c._playbackTrackResolutionTimer === timer;
    await h.finish();
    assert.ok(pending.seq > origin.seq); assert.deepEqual(after, pending); assert.equal(sameTimer, true);
    assert.equal(h.c.state.error, 'Playback transition unresolved'); assert.equal(h.c.state.isLoading, false);
  } finally { await h.finish(); }
});
for (const starts of ['before-reload', 'after-reload']) {
  test(`POLICY same-URI observation ${starts} does not become a UI owner or lose its timer`, async () => {
    const h = await ready({ queuedState: true });
    try {
      if (starts === 'before-reload') h.c.schedulePlaybackTrackResolution(track(A));
      const reload = h.c.reloadLyrics(true); await h.settle(); const origin = snap(h);
      unavailable(h, 'foreign-null');
      if (starts === 'after-reload') h.c.schedulePlaybackTrackResolution({ uri: A });
      await h.settle(); const pending = snap(h), timer = h.c._playbackTrackResolutionTimer;
      h.clears[0].resolve(); await reload; await h.settle();
      const after = snap(h), sameTimer = h.c._playbackTrackResolutionTimer === timer;
      await h.finish();
      assert.equal(pending.seq, origin.seq); assert.equal(sameTimer, true);
      assert.deepEqual(after, { ...pending, loading: false, error: 'No track info' });
      assert.deepEqual(snap(h), after, 'neutral deadline neither restarts nor completes another request');
      assert.equal(h.fetches.length, 0);
    } finally { await h.finish(); }
  });
}
for (const intervention of ['same-uri-fetch', 'new-uri-fetch', 'same-uri-resolution', 'authoritative-uri-change', 'unmount']) {
  test(`POLICY queued completion rechecks commit-time ownership: ${intervention}`, async () => {
    const h = await ready({ queuedState: true });
    try {
      const reload = h.c.reloadLyrics(true); await h.settle(); unavailable(h, 'uri-only');
      h.clears[0].resolve(); await reload;
      const queueLength = h.stateQueue.length;
      if (intervention === 'unmount') h.c.componentWillUnmount();
      else if (intervention === 'authoritative-uri-change') h.playInput({ uri: B }, null);
      else if (intervention === 'same-uri-resolution') h.c.schedulePlaybackTrackResolution({ uri: A });
      else {
        const uri = intervention === 'same-uri-fetch' ? A : B;
        h.hold('language', uri); h.playInput(track(uri)); h.c.fetchLyrics(track(uri), -1, true);
      }
      const before = snap(h); h.stateQueue.shift()(); const after = snap(h);
      await h.finish();
      assert.equal(queueLength, 1, 'one completion is queued before the intervention');
      assert.deepEqual(after, intervention === 'same-uri-resolution'
        ? { ...before, loading: false, error: 'No track info' } : before);
    } finally { await h.finish(); }
  });
}
for (const field of ['lyricsRequestSeq', 'uri', 'isLoading']) {
  test(`POLICY queued completion checks committed state's ${field}`, async () => {
    const h = await ready({ queuedState: true });
    try {
      const reload = h.c.reloadLyrics(true); await h.settle(); unavailable(h, 'uri-only');
      h.clears[0].resolve(); await reload;
      h.c.state[field] = field === 'lyricsRequestSeq' ? h.c._activeLyricsFetchSeq + 1 : field === 'uri' ? B : false;
      const before = plain(h.c.state); h.stateQueue.shift()(); const after = plain(h.c.state);
      await h.finish(); assert.deepEqual(after, before);
    } finally { await h.finish(); }
  });
}
for (const later of ['same-uri-ready', 'new-uri-ready', 'new-uri-unready']) {
  test(`POLICY retained resolver can later observe ${later} using its existing rules`, async () => {
    const h = await ready({ queuedState: true });
    try {
      const reload = h.c.reloadLyrics(true); await h.settle(); unavailable(h, 'foreign-null');
      h.c.schedulePlaybackTrackResolution({ uri: A }); await h.settle();
      const timer = h.c._playbackTrackResolutionTimer, resolution = h.c._playbackTrackResolutionSeq;
      h.clears[0].resolve(); await reload; await h.settle(); const terminal = snap(h);
      const laterUri = later === 'same-uri-ready' ? A : B;
      h.playInput(later === 'new-uri-unready' ? { uri: B } : track(laterUri),
        later === 'new-uri-unready' ? null : track(laterUri));
      const callback = h.timers.get(timer); h.timers.delete(timer); callback(); await h.settle();
      const observed = snap(h);
      await h.finish();
      assert.equal(terminal.loading, false); assert.equal(terminal.error, 'No track info');
      assert.equal(observed.resolution, resolution);
      if (later === 'same-uri-ready') {
        assert.equal(observed.seq, terminal.seq); assert.equal(observed.error, 'No track info');
        assert.equal(h.fetches.length, 0, 'no new automatic same-URI metadata retry is introduced');
      } else {
        assert.ok(observed.seq > terminal.seq);
        if (later === 'new-uri-ready') {
          assert.equal(observed.current, B); assert.equal(observed.loading, false); assert.equal(observed.error, null);
        } else {
          assert.equal(observed.loading, true);
          assert.equal(h.c.state.error, 'Playback transition unresolved');
        }
      }
    } finally { await h.finish(); }
  });
}
for (const rejected of [false, true]) {
  test(`POLICY actual teardown skips resumed visual/loading publication; rejected=${rejected}`, async () => {
    const h = await ready({ queuedState: true });
    try {
      const reload = h.c.reloadLyrics(true); await h.settle(); if (rejected) unavailable(h, 'foreign-null');
      h.c.componentWillUnmount(); const before = snap(h), jobs = h.stateJobs.length, renders = h.renders.length;
      h.clears[0].resolve(); await reload; await h.settle();
      const after = snap(h), afterJobs = h.stateJobs.length, afterRenders = h.renders.length;
      await h.finish();
      assert.deepEqual(after, before); assert.equal(afterJobs, jobs); assert.equal(afterRenders, renders);
      assert.equal(h.fetches.length, 0);
      assert.equal(h.trace.filter(entry => entry.event === 'translator-memory').length, 1);
    } finally { await h.finish(); }
  });
}
test('POLICY accepted B already blocks old A completion before component transition catches up', async () => {
  const h = await ready({ queuedState: true });
  try {
    const reload = h.c.reloadLyrics(true); await h.settle(); const admitted = snap(h);
    h.playInput({ uri: B }, null); h.clears[0].resolve(); await reload; await h.settle(); const after = snap(h);
    h.c.schedulePlaybackTrackResolution(null); await h.finish();
    assert.deepEqual(after, admitted); assert.equal(h.fetches.length, 0);
    assert.equal(h.c.state.error, 'Playback transition unresolved');
  } finally { await h.finish(); }
});
test('POLICY missing resolver does not authorize foreign public metadata against the snapshot', async () => {
  const h = await ready({}, track(B));
  try {
    delete h.context.window.Utils.resolveStablePlaybackTrack; seed(h); const before = snap(h);
    await h.c.reloadLyrics(false); await h.settle(); const after = snap(h); await h.finish();
    assert.deepEqual(after, before); assert.equal(h.fetches.length, 0);
    assert.deepEqual(h.cacheInvalidations, []); assert.deepEqual(plain(h.c._dmResults), {});
  } finally { await h.finish(); }
});
test('POLICY resolver receives its owning Utils receiver and no stale candidate', async () => {
  const h = await ready();
  try {
    const owner = h.context.window.Utils, resolve = owner.resolveStablePlaybackTrack, calls = [];
    owner.resolveStablePlaybackTrack = function(candidate, snapshot) {
      calls.push({ receiver: this, candidate, uri: snapshot?.uri });
      return resolve.call(this, candidate, snapshot);
    };
    await h.c.reloadLyrics(false); await h.finish();
    assert.equal(calls.length, 2); assert.ok(calls.every(call => call.receiver === owner && call.candidate === null && call.uri === A));
  } finally { await h.finish(); }
});
test('POLICY overlapping invalid reload completion belongs only to the last loader', async () => {
  const h = await ready({ queuedState: true });
  try {
    const first = h.c.reloadLyrics(true), second = h.c.reloadLyrics(true); await h.settle(); const owner = snap(h);
    unavailable(h, 'foreign-null'); h.clears[0].resolve(); await first; await h.settle(); const afterFirst = snap(h);
    h.clears[1].resolve(); await second; await h.settle(); const afterSecond = snap(h);
    await h.finish();
    assert.deepEqual(afterFirst, owner);
    assert.deepEqual(afterSecond, { ...owner, loading: false, error: 'No track info' });
    assert.equal(h.fetches.length, 0);
  } finally { await h.finish(); }
});
