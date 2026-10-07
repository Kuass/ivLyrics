// Execute actual reload, Settings controls, playback resolver, transition and fetch
// bodies. UI scheduling, storage, provider, translation and color I/O are inert.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

export const root = process.env.RELOAD_SOURCE_ROOT
  ? pathToFileURL(`${process.env.RELOAD_SOURCE_ROOT}/`)
  : new URL('../../', import.meta.url);
export const source = name => readFileSync(new URL(name, root), 'utf8');
const index = source('index.js');
const service = source('LyricsService.js');
const playback = createRequire(import.meta.url)(new URL('PlaybackClock.js', root).pathname);
export const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
export const cut = (text, start, end) => {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `source boundary: ${start}`);
  return text.slice(a, b);
};
const method = (text, name, indent = '  ') => {
  const start = text.search(new RegExp(`^${indent}(?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, `method: ${name}`);
  const tail = text.slice(start);
  const end = tail.search(new RegExp(`^${indent}\\}[,]?\\s*$`, 'm'));
  assert.ok(end > 0, `method end: ${name}`);
  return tail.slice(0, end) + tail.slice(end).split('\n')[0];
};
export const A = 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA';
export const B = 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB';
export const track = uri => ({ uri, type: 'track', metadata: {
  title: uri === A ? 'Track A' : 'Track B', artist_name: 'Fixture artist',
  album_title: 'Fixture album', duration: '200000', image_url: 'fixture-cover',
} });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const methods = [
  'getLyricsLayoutHasLyrics', 'getLoadingLyricsState', 'infoFromTrack', 'fetchLyrics',
  'resolveLyricsForMode', 'isPlaybackUriCurrent', 'beginPlaybackTrackTransition',
  'clearPlaybackTrackResolutionTimer', 'schedulePlaybackTrackResolution',
  'commitResolvedPlaybackTrack', 'commitDjNarrationTrack', 'componentWillUnmount',
  'updateVisualOnConfigChange',
];
export function harness({ queuedState = false } = {}) {
  const tasks = [], reads = [], clears = [], trace = [], fetches = [], reloads = [];
  const stateQueue = [], stateJobs = [], timers = new Map(), events = [], toasts = [];
  const cacheInvalidations = [], renders = [], errors = [], heldReads = new Set();
  let now = 0, timerId = 0;
  const observe = (promise, kind) => {
    const task = { promise, kind, done: false };
    tasks.push(task);
    promise.then(() => { task.done = true; }, error => { task.done = true; task.error = error; });
    return promise;
  };
  const read = (kind, uri) => {
    let resolve;
    const entry = { kind, uri, settled: false, promise: new Promise(done => { resolve = done; }) };
    entry.resolve = () => { assert.equal(entry.settled, false); entry.settled = true; resolve(null); };
    reads.push(entry);
    if (!heldReads.has(`${kind}:${uri}`)) entry.resolve();
    return entry.promise;
  };
  const clear = kind => id => {
    let resolve;
    const entry = { kind, id, settled: false, promise: new Promise(done => { resolve = done; }) };
    entry.resolve = (value = true) => {
      assert.equal(entry.settled, false);
      assert.ok(clears.slice(0, clears.indexOf(entry)).every(q => q.settled), 'clear completion retains issue order');
      entry.settled = true;
      trace.push({ event: 'clear-complete', kind, id, value });
      resolve(value);
    };
    clears.push(entry);
    trace.push({ event: 'clear-start', kind, id });
    return entry.promise;
  };
  const record = event => (...args) => trace.push({ event, args: plain(args) });
  const spicetify = { Player: { data: { item: null } }, Platform: { PlayerAPI: { _state: {} } } };
  const clock = playback.createSpotifyPlaybackClock(spicetify, {
    autoStart: false, now: () => now, wallNow: () => now,
    schedule() { throw Error('unexpected playback clock timer'); }, cancel() {},
  });
  const config = { modes: ['karaoke', 'synced', 'unsynced'], visual: {} };
  const context = vm.createContext({
    Spicetify: spicetify, CONFIG: config, CACHE: {}, SYNCED: 1,
    console: { warn() {}, error: (...args) => errors.push(args) },
    ivLyricsDebug() {}, getLyricsTypographyStyleVariables: () => ({}),
    getLyricsDataMode: mode => mode, getLyricsModeTypeKey: mode => config.modes[mode],
    isLyricsRenderCacheCurrent: () => true, hasInstrumentalMarker: () => false,
    getCurrentTranslationTargetLanguage: () => 'ko', getCurrentLyricsPronunciationNotation: () => 'translation',
    getNonSectionLyricsText: lyrics => lyrics.map(line => line.text).join('\n'),
    TrackBackgroundDB: { getOverride: uri => read('background', uri) },
    LyricsCache: { clearTrack: clear('track'), clearAll: clear('all'), getStats: async () => ({ lyrics: 1 }) },
    I18n: { t: key => key }, Toast: { success: recordToast('success'), error: recordToast('error') },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    document: { body: { classList: { remove() {} } } }, lyricContainerUpdate() {},
    Date: { now: () => now },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    ensurePlaybackProgressGuard: () => ({ getSnapshot: () => clock.getSnapshot(), clearCorrection: () => clock.invalidate() }),
    window: {
      ivLyricsPlaybackClock: playback,
      addEventListener: (name, fn) => events.push({ name, fn }), removeEventListener() {},
      dispatchEvent(event) { for (const entry of events.filter(entry => entry.name === event.type)) entry.fn(event); },
      Translator: { clearMemoryCache: record('translator-memory'), clearInflightRequests: record('translator-inflight'),
        clearAllMemoryCache: record('translator-all-memory'), clearAllInflightRequests: record('translator-all-inflight') },
      SyncDataService: {
        getTrackIsrc(id, meta) { trace.push({ event: 'sync-id', id, meta: plain(meta) }); return `isrc-${id}`; },
        clearCache: record('sync-clear'), getOpenDbCacheInfo: () => null,
      },
      LyricsService: {
        getTrackLanguageOverride: uri => read('language', uri),
        getTrackLyricsProviderOverride: uri => read('provider', uri),
        clearLyricsSnapshot: record('snapshot-clear'), publishLyricsSnapshot() {},
        async getLyricsFromProviders(info) {
          return { uri: info.uri, provider: 'inert', synced: [{ text: `Lyric ${info.title}`, startTime: 0 }] };
        },
      },
    },
  });
  function recordToast(kind) { return message => toasts.push({ kind, message }); }
  vm.runInContext([
    `const Utils={extractTrackId:uri=>uri?.startsWith('spotify:track:')?uri.slice(14):null,detectLanguage:()=> 'en',removeQueueListener(){}};globalThis.Utils=Utils;`,
    `window.Utils={${['getPlayerPlaybackSnapshot', 'resolveStablePlaybackTrack', 'clearSafePlayerProgressCorrection'].map(name => method(service, name, '        ')).join('\n')}};`,
    `const CacheManager={_cache:new Map(),clear(){this._cache.clear();},${method(index, 'clearByUri')}};globalThis.CacheManager=CacheManager;`,
    cut(index, 'const readFiniteNumber =', 'const readNumericSetting ='),
    cut(index, 'const emptyState = {', '\nconst getPlainLyricsLineText'),
    `class Container {${methods.map(name => method(index, name)).join('\n')}};globalThis.Container=Container;globalThis.empty=emptyState;`,
    'globalThis.installReload=function(){let reloadLyrics,lyricContainerUpdate;',
    cut(index, '    lyricContainerUpdate = () => {', '    // Expose reloadLyrics for external calls'),
    'this.reloadLyrics=reloadLyrics;};',
  ].join('\n'), context);
  const c = new context.Container();
  Object.assign(c, {
    state: { ...context.empty, uri: '', currentLyrics: [], lyricsDisplayUri: null, explicitMode: -1, lockedMode: -1, isLoading: false, error: null },
    currentTrackUri: '', _lyricsFetchSeq: 0, _activeLyricsFetchSeq: 0, _lyricsTransitionSeq: 0,
    _playbackTrackResolutionSeq: 0, _isComponentMounted: true, _localLyricsImportGeneration: 0, _dmResults: {},
    _lyricsEditRequestSeq: 0, containerRef: { current: null }, _visibleGenerationPills: new Set(), _generationRequestDetails: new Map(),
    clearPendingLyricsUpdates: record('pending-clear'), closeLyricsEditModal() {},
    lyricsSaved: () => false, getSavedLocalLyrics: () => null,
    fetchMetadataTranslation() {}, fetchColors() {}, fetchTempo() {}, resetDelay() {}, loadSavedVideoForTrack() {},
    startLyricsLoading: () => 1, clearLyricsLoading() {}, getCurrentMode: () => 1,
    isModeAvailable: () => false, getAutomaticMode: () => 1, applyTranslationStates: () => ({}), refineLanguageWithAI() {},
    clearCulturalAnnotationsForTrack: record('cultural-track'), clearAllCulturalAnnotations: record('cultural-all'),
    forceUpdate: () => renders.push(true),
    setState(patch, callback) {
      const job = { functional: typeof patch === 'function', applied: false, result: null };
      stateJobs.push(job);
      const apply = () => {
        const result = typeof patch === 'function' ? patch(this.state) : patch;
        job.applied = true; job.result = plain(result);
        if (result == null) return;
        this.state = { ...this.state, ...result };
        callback?.();
      };
      if (queuedState) stateQueue.push(apply); else apply();
    },
  });
  for (const name of ['clearFloatingMenuCloseTimer', 'clearPhoneticLoading', 'clearTranslationLoading',
    'clearCulturalAnnotationsLoading', 'clearVideoBackgroundLoadingDelay', 'clearGenerationPillTimers']) c[name] = () => {};
  for (const key of ['_inflightGemini', '_inflightTrad']) c[key] = {
    invalidate: predicate => trace.push({ event: key, selected: [A, B, `${A}More`].filter(uri => !predicate || predicate(`${uri}:fixture`)) }), dispose() {},
  };
  context.window.CACHE = context.CACHE;
  context.window.CacheManager = context.CacheManager;
  context.window.lyricContainer = c;
  const actualClear = context.CacheManager.clearByUri;
  context.CacheManager.clearByUri = function(uri) { cacheInvalidations.push(uri); return actualClear.call(this, uri); };
  const actualFetch = c.fetchLyrics;
  c.fetchLyrics = (...args) => { fetches.push(plain(args)); return observe(actualFetch.apply(c, args), 'fetch'); };
  context.installReload.call(c);
  const actualReload = c.reloadLyrics;
  c.reloadLyrics = (...args) => {
    const promise = observe(actualReload(...args), 'reload');
    reloads.push({ args: plain(args), promise });
    return promise;
  };
  const h = {
    c, context, spicetify, clock, tasks, reads, clears, trace, fetches, reloads,
    stateQueue, stateJobs, timers, toasts, cacheInvalidations, renders, errors, config,
    playInput(accepted, publicItem = accepted) {
      spicetify.Player.data.item = publicItem;
      spicetify.Platform.PlayerAPI._state = { item: accepted, isPaused: false };
    },
    hold(kind, uri) { heldReads.add(`${kind}:${uri}`); },
    async settle() { for (let i = 0; i < 6; i++) { while (stateQueue.length) stateQueue.shift()(); await flush(); } },
    async play(accepted, publicItem = accepted) {
      this.playInput(accepted, publicItem);
      c.schedulePlaybackTrackResolution(accepted);
      await this.settle();
    },
    expire() { now += 5000; const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    async finish({ expectedReloadRejections = 0 } = {}) {
      for (let i = 0; i < 10; i++) {
        for (const entry of clears.filter(q => !q.settled)) entry.resolve();
        for (const entry of reads.filter(q => !q.settled)) entry.resolve();
        if (timers.size) this.expire();
        await this.settle();
        if (tasks.every(task => task.done) && reads.every(q => q.settled) && clears.every(q => q.settled) && !timers.size) break;
      }
      assert.ok(tasks.every(task => task.done), 'all actual-method promises drain');
      assert.equal(tasks.filter(task => task.error && task.kind === 'reload').length, expectedReloadRejections);
      assert.ok(tasks.filter(task => task.kind !== 'reload').every(task => !task.error));
      assert.ok(reads.every(q => q.settled), 'all inert reads drain');
      assert.ok(clears.every(q => q.settled), 'all ordered clears drain');
      assert.equal(stateQueue.length, 0); assert.equal(timers.size, 0); assert.equal(errors.length, 0);
      clock.destroy();
    },
  };
  return h;
}
export async function ready(options = {}, publicItem = track(A)) {
  const h = harness(options);
  await h.play(track(A), publicItem);
  assert.equal(h.c.state.isLoading, false);
  assert.equal(h.c.state.lyricsDisplayUri, A);
  h.fetches.length = 0;
  h.trace.length = 0;
  return h;
}
export const snap = h => plain({
  current: h.c.currentTrackUri, uri: h.c.state.uri, display: h.c.state.lyricsDisplayUri,
  loading: h.c.state.isLoading, error: h.c.state.error, seq: h.c._activeLyricsFetchSeq,
  stateSeq: h.c.state.lyricsRequestSeq, resolution: h.c._playbackTrackResolutionSeq,
});
export function unavailable(h, kind, uri = A) {
  h.playInput(kind === 'missing' ? null : { uri },
    kind === 'missing' ? null : kind === 'uri-only' ? { uri } : track(uri === A ? B : A));
}
export function seed(h) {
  h.context.CACHE.unrelated = {};
  h.c._dmResults[A] = {}; h.c._dmResults[B] = {};
  h.context.CacheManager._cache.set(`translation:${A}`, {});
  h.context.CacheManager._cache.set(`translation:${B}`, {});
}
