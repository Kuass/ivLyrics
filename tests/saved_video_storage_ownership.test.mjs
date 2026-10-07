import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const utils = readFileSync(new URL('../Utils.js', import.meta.url), 'utf8');
const background = readFileSync(new URL('../VideoBackground.js', import.meta.url), 'utf8');
const cut = (source, from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a, from);
  return source.slice(a, b);
};
const method = (source, name) => {
  const a = source.search(new RegExp(`^  (?:async )?${name}\\(`, 'm'));
  assert.ok(a >= 0, name);
  const b = source.slice(a + 1).search(/^  (?:async )?\w+\(/m);
  assert.ok(b >= 0, `end ${name}`);
  return source.slice(a, a + 1 + b);
};
const methods = [
  'loadSavedVideoForTrack', 'getLyricsLayoutHasLyrics', 'getLoadingLyricsState',
  'beginPlaybackTrackTransition', 'clearPlaybackTrackResolutionTimer',
  'commitResolvedPlaybackTrack', 'schedulePlaybackTrackResolution',
  'fetchLyrics',
];
const helpers = [
  'isSpotifyTrackId', 'extractTrackId', 'normalizeVideoSkipSegments',
  'getCommunityVideoIdentity', 'getCommunityVideos',
  'getCommunityVideoSelectionInfo', 'resolveHiddenCommunityVideo',
  'saveSelectedVideo', 'getSelectedVideo', 'removeSelectedVideo',
];
const render = cut(index, '    const renderVideoBackgroundChild = () => (', '    const renderFloatingToolbar =');
// This is the exact synchronous prefix of the production lifecycle effect.
// It ends only after both external-selection branches return. The remainder
// (automatic matching, cache, player/provider I/O) is never executed.
const effectPrefix = cut(background, '        const useRandomCommunityVideo =', '        // 곡이 바뀌면 이전 플레이어는');
const A = 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA';
const B = 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB';
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const saved = (id = 'A-saved', extra = {}) => ({
  youtubeVideoId: id, youtubeTitle: `Title ${id}`, communityEntryId: `${id}-entry`,
  captionStartTime: 2, skipSegments: [{ start: 3.04, end: 5.02 }], ...extra,
});
const rows = (withReplacement = true) => [
  { id: 'A-saved-entry', youtubeVideoId: 'A-saved', userVote: -1 },
  ...(withReplacement ? [{ id: 'A-replacement-entry', youtubeVideoId: 'A-replacement',
    youtubeTitle: 'Replacement A', startTime: 7.25, skipSegments: [{ start: 4.01, end: 6.01 }], userVote: 1 }] : []),
];

function harness({ hide = true, random = false, initial = [[A, saved()]], actualLyrics = false, queuedCallbacks = false } = {}) {
  const records = new Map(initial.map(([key, value]) => [key, plain(value)]));
  const reads = [], writes = [], fetches = [], errors = [], publications = [], loads = [], trace = [];
  let playing = null, nextTimer = 0;
  const timers = new Map();
  const callbacks = [];
  const config = { visual: { 'community-video-hide-disliked': hide, 'community-video-random': random } };
  const context = vm.createContext({
    CONFIG: config, URL, console: { error: (...args) => errors.push(args) },
    TrackBackgroundDB: { getOverride: () => new Promise(() => {}) },
    ivLyricsDebug() {},
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      const gate = deferred(), jsonGate = deferred();
      fetches.push({ url, options, ...gate, jsonGate });
      trace.push(['community-request', new URL(url).searchParams.get('trackId')]);
      return gate.promise;
    },
    window: {
      Translator: { clearInflightRequests: id => trace.push(['retire-lyrics', id]) },
      SpotifyDataHelper: { extractSpotifyData: () => ({ name: 'Synthetic track', artists: ['Synthetic artist'] }) },
      SyncDataService: { resolveTrackIsrc: async id => `synthetic-${id}` },
      Utils: {
        getPlayerPlaybackSnapshot: () => ({ uri: playing?.uri }),
        resolveStablePlaybackTrack: () => playing,
      },
      VideoBackground: 'inert-video-component',
      LyricsService: {
        getTrackLanguageOverride: () => new Promise(() => {}),
        getTrackLyricsProviderOverride: () => new Promise(() => {}),
      },
    },
  });
  vm.runInContext(`const Utils = {\n${helpers.map(name => method(utils, name)).join('\n')}\n};\nglobalThis.Utils = Utils;`, context);
  Object.assign(context.Utils, {
    getUserHash: () => 'synthetic-user',
    getApiHeaders: value => value,
    _cleanupOldSelectedVideos: async () => { trace.push(['inert-cleanup']); },
    _openSelectedVideoDB: async () => ({
      transaction(name, mode) {
        assert.equal(name, 'selectedVideos');
        const tx = {
          objectStore(storeName) {
            assert.equal(storeName, 'selectedVideos');
            return {
              get(uri) {
                assert.equal(mode, 'readonly');
                const request = {};
                reads.push({ uri, request });
                trace.push(['read', uri]);
                return request;
              },
              put(value) {
                assert.equal(mode, 'readwrite');
                writes.push({ kind: 'save', uri: value.trackUri, value: plain(value), tx });
                trace.push(['save-start', value.trackUri]);
              },
              delete(uri) {
                assert.equal(mode, 'readwrite');
                const request = {};
                writes.push({ kind: 'remove', uri, request, tx });
                trace.push(['remove-start', uri]);
                return request;
              },
            };
          },
        };
        return tx;
      },
      close() { trace.push(['close']); },
    }),
  });
  vm.runInContext(`${cut(index, 'const emptyState = {', '\nconst getPlainLyricsLineText')}\nclass Container {\n${methods.map(name => method(index, name)).join('\n')}\n}\nglobalThis.Container = Container;`, context);
  const c = new context.Container();
  Object.assign(c, {
    state: { uri: '', videoInfo: null, currentLyrics: [], isLyricsEditModalOpen: false }, currentTrackUri: '',
    _lyricsFetchSeq: 0, _activeLyricsFetchSeq: 0, _lyricsTransitionSeq: 0,
    _playbackTrackResolutionSeq: 0, _isComponentMounted: true,
    clearPendingLyricsUpdates() {},
    infoFromTrack: value => ({ ...value, title: value.uri, artist: 'Synthetic artist' }),
    fetchLyrics: track => trace.push(['inert-lyrics-fetch', track.uri]),
    setState(patch, callback) {
      this.state = { ...this.state, ...patch };
      if ('videoInfo' in patch) publications.push({ current: this.currentTrackUri, stateUri: this.state.uri, value: plain(patch.videoInfo) });
      if (callback) {
        if (queuedCallbacks) callbacks.push(callback);
        else callback();
      }
    },
  });
  if (actualLyrics) c.fetchLyrics = context.Container.prototype.fetchLyrics;
  const counters = () => ({ lyricsFetch: c._lyricsFetchSeq, activeLyricsFetch: c._activeLyricsFetchSeq,
    transition: c._lyricsTransitionSeq, playbackResolution: c._playbackTrackResolutionSeq });
  const originalLoad = c.loadSavedVideoForTrack;
  c.loadSavedVideoForTrack = function(uri) {
    const promise = originalLoad.call(this, uri);
    loads.push({ uri, promise, countersAtStart: counters() });
    return promise;
  };
  const h = {
    c, context, records, config, reads, writes, fetches, errors, publications, loads, trace, timers, callbacks, counters,
    async flushCallbacks() { for (const callback of callbacks.splice(0)) callback(); await tick(); },
    async play(uri) {
      playing = { uri };
      c.schedulePlaybackTrackResolution(playing);
      await tick();
      assert.equal(c.currentTrackUri, uri);
      assert.equal(c.state.uri, uri);
      assert.equal(timers.size, 0, 'stable playback commits without a live timer');
    },
    async read(i, { error = false, value } = {}) {
      const read = reads[i]; assert.ok(read, `read ${i}`);
      if (error) { read.request.error = new Error('synthetic storage read rejection'); read.request.onerror(); }
      else { read.request.result = plain(value === undefined ? records.get(read.uri) : value); read.request.onsuccess(); }
      await tick();
    },
    async community(i, videos, { transportError = false, jsonError = false } = {}) {
      const request = fetches[i]; assert.ok(request, `fetch ${i}`);
      if (transportError) request.reject(new Error('synthetic transport rejection'));
      else {
        request.resolve({ json: () => request.jsonGate.promise });
        await tick();
        if (jsonError) request.jsonGate.reject(new Error('synthetic json rejection'));
        else request.jsonGate.resolve({ success: true, data: { videos } });
      }
      await tick();
    },
    async write(i, { error = false } = {}) {
      const write = writes[i]; assert.ok(write, `write ${i}`);
      trace.push([`${write.kind}-${error ? 'error' : 'complete'}`, write.uri]);
      if (write.kind === 'save') {
        if (error) { write.tx.error = new Error('synthetic transaction rejection'); write.tx.onerror(); }
        else { records.set(write.uri, plain(write.value)); write.tx.oncomplete(); }
      } else if (error) {
        write.request.error = new Error('synthetic deletion request rejection'); write.request.onerror();
      } else {
        records.delete(write.uri); write.request.onsuccess();
      }
      await tick();
    },
    renderProps() {
      return vm.runInNewContext(`(function(){${render}\nreturn renderVideoBackgroundChild();}).call(container)`, {
        container: c, shouldUseVideoBackground: true, window: context.window,
        react: { createElement: (_component, props) => props },
        isVideoStagePresentation: false, CONFIG: config,
        getAlbumAmbientColors: () => null, buildAmbientGradientColorVars: () => ({}),
      });
    },
    consumeExternal(initialVideo = saved('B-automatic', { communityEntryId: null })) {
      const props = this.renderProps();
      const result = { video: plain(initialVideo), ready: true, destroyed: 0, statuses: [] };
      const playerRef = { current: { destroy() { result.destroyed++; } } };
      vm.runInNewContext(`(function(){${effectPrefix}\nthrow new Error('External branch did not handle fixture');})()`, {
        CONFIG: config, trackUri: props.trackUri, externalVideoInfo: props.externalVideoInfo, playerRef,
        setVideoInfo: value => { result.video = plain(value); },
        setIsPlayerReady: value => { result.ready = value; },
        reportVideoBackgroundStatus: value => result.statuses.push(value),
      });
      return result;
    },
  };
  return h;
}

async function pendingHidden(withReplacement = true, options) {
  const h = harness(options);
  await h.play(A);
  await h.read(0);
  await h.community(0, rows(withReplacement));
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].uri, A);
  assert.equal(h.c.state.videoInfo, null);
  return h;
}


for (const replacement of [true, false]) {
  const branch = replacement ? 'replacement' : 'removal';
  test(`${branch}: old storage completion cannot publish on committed B`, async () => {
    const h = await pendingHidden(replacement);
    await h.play(B);
    const publicationCount = h.publications.length;
    assert.equal(h.reads[1].uri, B);
    // A's write settles before B's read; no same-store overtaking is needed.
    await h.write(0);
    assert.equal(h.publications.length, publicationCount);
    await h.read(1);
    assert.equal(h.c.state.videoInfo, null);
    assert.deepEqual(h.writes.map(w => w.uri), [A]);
    assert.equal(h.records.has(B), false);
    assert.equal(h.records.has(A), replacement);
    const props = h.renderProps();
    assert.equal(props.trackUri, B);
    assert.equal(props.externalVideoInfo, null, 'B receives no stale external selection or suppression');
    assert.equal(h.errors.length, 0);
    await Promise.all(h.loads.map(l => l.promise));
  });

  test(`${branch}: same-track success preserves metadata, persistence and actual external video consumption`, async () => {
    const h = await pendingHidden(replacement);
    await h.write(0);
    if (replacement) {
      assert.deepEqual(plain(h.c.state.videoInfo), {
        youtubeVideoId: 'A-replacement', youtubeTitle: 'Replacement A',
        captionStartTime: 7.25, skipSegments: [{ start: 4, end: 6 }],
        communityEntryId: 'A-replacement-entry', isAutoGenerated: false,
      });
      assert.equal(h.records.get(A).youtubeVideoId, 'A-replacement');
    } else {
      assert.deepEqual(plain(h.c.state.videoInfo), { suppressVideoBackground: true, reason: 'no-visible-community-video' });
      assert.equal(h.records.has(A), false);
    }
    assert.equal(h.publications.at(-1).current, A);
    assert.equal(h.renderProps().trackUri, A);
    const consumed = h.consumeExternal(saved('A-automatic', { communityEntryId: null }));
    if (replacement) {
      assert.equal(consumed.video.youtubeVideoId, 'A-replacement');
      assert.equal(consumed.destroyed, 0);
    } else {
      assert.equal(consumed.video, null);
      assert.equal(consumed.destroyed, 1);
      assert.deepEqual(consumed.statuses, ['idle']);
    }
  });

  test(`${branch}: a swallowed storage failure cannot publish on committed B`, async () => {
    const h = await pendingHidden(replacement);
    await h.play(B);
    const publicationCount = h.publications.length;
    await h.write(0, { error: true });
    assert.equal(h.publications.length, publicationCount);
    await h.read(1);
    assert.equal(h.errors.length, 1);
    assert.equal(h.records.get(A).youtubeVideoId, 'A-saved');
    assert.equal(h.c.state.videoInfo, null);
    assert.equal(h.renderProps().externalVideoInfo, null);
  });

  test(`${branch}: same-track storage failure retains existing display behavior`, async () => {
    const h = await pendingHidden(replacement);
    await h.write(0, { error: true });
    assert.equal(h.errors.length, 1);
    assert.equal(h.records.get(A).youtubeVideoId, 'A-saved');
    assert.equal(h.publications.at(-1).current, A);
    assert.equal(replacement ? h.c.state.videoInfo.youtubeVideoId : h.c.state.videoInfo.suppressVideoBackground,
      replacement ? 'A-replacement' : true);
  });

  test(`${branch}: returning to A keeps the existing current-URI publication rule`, async () => {
    const h = await pendingHidden(replacement);
    await h.play(B);
    await h.play(A);
    await h.write(0);
    assert.equal(h.publications.at(-1).current, A);
    assert.equal(replacement ? h.c.state.videoInfo.youtubeVideoId : h.c.state.videoInfo.suppressVideoBackground,
      replacement ? 'A-replacement' : true);
    await h.read(1);
    await h.read(2);
    if (replacement) await h.community(1, [{ id: 'A-replacement-entry', youtubeVideoId: 'A-replacement', userVote: 1 }]);
    await Promise.all(h.loads.map(l => l.promise));
    assert.equal(h.errors.length, 0);
  });

  test(`${branch}: B's own saved selection publishes after A persistence without an intervening A selection`, async () => {
    const h = await pendingHidden(replacement, { initial: [[A, saved()], [B, saved('B-manual', { communityEntryId: null })]] });
    await h.play(B);
    const publicationCount = h.publications.length;
    await h.write(0);
    assert.equal(h.publications.length, publicationCount);
    await h.read(1);
    assert.equal(h.c.state.videoInfo.youtubeVideoId, 'B-manual');
  });
}

test('retired initial storage read cannot resolve, mutate, or publish for A', async () => {
  const h = harness(); await h.play(A); await h.play(B);
  await h.read(0); await h.read(1);
  assert.equal(h.fetches.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.c.state.videoInfo, null);
});

for (const replacement of [true, false]) test(`retired community resolution cannot start ${replacement ? 'save' : 'remove'}`, async () => {
  const h = harness(); await h.play(A); await h.read(0); await h.play(B);
  await h.community(0, rows(replacement)); await h.read(1);
  assert.equal(h.writes.length, 0); assert.equal(h.c.state.videoInfo, null);
});

test('random mode and missing URI avoid all storage and transport', async () => {
  const h = harness({ random: true }); await h.play(A); await h.c.loadSavedVideoForTrack('');
  assert.equal(h.reads.length, 0); assert.equal(h.fetches.length, 0); assert.equal(h.writes.length, 0);
});

test('disabled hide-disliked displays saved selection without revalidation or writes', async () => {
  const h = harness({ hide: false }); await h.play(A); await h.read(0);
  assert.equal(h.c.state.videoInfo.youtubeVideoId, 'A-saved');
  assert.equal(h.fetches.length, 0); assert.equal(h.writes.length, 0);
});

test('non-community saved video displays directly', async () => {
  const h = harness({ initial: [[A, saved('A-manual', { communityEntryId: null })]] });
  await h.play(A); await h.read(0);
  assert.equal(h.c.state.videoInfo.youtubeVideoId, 'A-manual');
  assert.equal(h.fetches.length, 0); assert.equal(h.writes.length, 0);
});

test('visible saved community selection does not write storage', async () => {
  const h = harness(); await h.play(A); await h.read(0);
  await h.community(0, [{ id: 'A-saved-entry', youtubeVideoId: 'A-saved', userVote: 1 }]);
  assert.equal(h.c.state.videoInfo.youtubeVideoId, 'A-saved'); assert.equal(h.writes.length, 0);
});

test('actual initial read failure returns null and leaves display empty', async () => {
  const h = harness(); await h.play(A); await h.read(0, { error: true });
  assert.equal(h.c.state.videoInfo, null); assert.equal(h.errors.length, 1); assert.equal(h.fetches.length, 0);
});

for (const failure of ['transportError', 'jsonError']) test(`${failure}: same-track actual community fallback keeps saved selection`, async () => {
  const h = harness(); await h.play(A); await h.read(0);
  await h.community(0, [], { [failure]: true });
  assert.equal(h.c.state.videoInfo.youtubeVideoId, 'A-saved'); assert.equal(h.writes.length, 0); assert.equal(h.errors.length, 1);
});

test('identity rejection propagates to actual loader catch and has no publication', async () => {
  const h = harness();
  h.context.window.SyncDataService.resolveTrackIsrc = async () => { throw new Error('synthetic identity rejection'); };
  await h.play(A); await h.read(0);
  assert.equal(h.c.state.videoInfo, null); assert.equal(h.fetches.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.errors.length, 1);
});

test('queued real fetchLyrics callback changes lyric counters after normal saved-video load starts', async () => {
  const h = harness({ actualLyrics: true, queuedCallbacks: true });
  await h.play(A);
  assert.equal(h.callbacks.length, 1);
  assert.deepEqual(h.loads[0].countersAtStart, { lyricsFetch: 2, activeLyricsFetch: 2, transition: 1, playbackResolution: 1 });
  await h.flushCallbacks();
  assert.deepEqual(h.counters(), { lyricsFetch: 3, activeLyricsFetch: 3, transition: 2, playbackResolution: 1 });
  await h.read(0); await h.community(0, rows()); await h.write(0);
  assert.equal(h.c.currentTrackUri, A);
  assert.equal(h.c.state.videoInfo.youtubeVideoId, 'A-replacement');
  assert.equal(h.errors.length, 0);
});

test('immediate real fetchLyrics callback changes lyric counters before saved-video load starts', async () => {
  const h = harness({ actualLyrics: true });
  await h.play(A);
  assert.deepEqual(h.loads[0].countersAtStart, { lyricsFetch: 3, activeLyricsFetch: 3, transition: 2, playbackResolution: 1 });
  assert.deepEqual(h.counters(), h.loads[0].countersAtStart);
  await h.read(0); await h.community(0, rows()); await h.write(0);
  assert.equal(h.c.state.videoInfo.youtubeVideoId, 'A-replacement');
  assert.equal(h.errors.length, 0);
});
