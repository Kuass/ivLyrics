// Actual queue, prefetcher, manager, translation dispatch/cache methods and display readers.
// Inert boundaries: timers, settings, provider/AI endpoints, storage backing and React state.
// Network, DOM, native IndexedDB and intervals throw. Drain never depends on an expected
// provider count or request identity; all jobs finish before behavioral assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const sourceRoot = new URL('../../', import.meta.url);
export const extractionManifest = [];
const sources = new Map();
const read = file => {
  if (!sources.has(file)) sources.set(file, readFileSync(new URL(file, sourceRoot), 'utf8'));
  return sources.get(file);
};
function record(file, label, start, end) {
  const source = read(file), text = source.slice(start, end);
  if (!extractionManifest.some(x => x.file === file && x.label === label)) {
    extractionManifest.push({ file, label, startLine: source.slice(0, start).split('\n').length,
      endLine: source.slice(0, end).split('\n').length,
      sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) });
  }
  return text;
}
export function section(file, from, to) {
  const source = read(file), start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `missing complete section ${file}:${from}`);
  return record(file, from, start, end);
}
export function method(file, name, indent = 2, staticMethod = false) {
  const source = read(file), lead = ' '.repeat(indent);
  const start = source.search(new RegExp(`^${lead}${staticMethod ? 'static ' : ''}(?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, `missing method ${file}:${name}`);
  const tail = source.slice(start), closing = tail.search(new RegExp(`^${lead}\\},?\\s*$`, 'm'));
  assert.ok(closing > 0, `missing method close ${file}:${name}`);
  const end = start + closing + tail.slice(closing).split('\n')[0].length;
  return record(file, name, start, end);
}
const full = file => record(file, 'complete file', 0, read(file).length);
export const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
export const A = 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA';
export const B = 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB';
export const L1 = 'spotify:local:FixtureArtist:FixtureAlbum:Local%20One:180';
export const L2 = 'spotify:local:FixtureArtist:FixtureAlbum:Local%20Two:180';
export const track = (uri, title = 'Queued song') => ({ uri, type: 'track',
  metadata: { title, artist_name: 'Fixture artist', album_title: 'Fixture album', duration: '180000' } });
const flush = () => new Promise(resolve => setImmediate(resolve));
const noop = () => {};

export function createHarness({ currentUri = A, visual = {}, localProvider = true, lyricText = 'The queued local song' } = {}) {
  const trace = [], warnings = [], timerQueue = new Map(), jobs = [], providerGates = [];
  const translationStore = new Map(), lyricsStore = new Map(), displayStore = new Map(), snapshots = new Map();
  const storage = new Map();
  let nextTimer = 0;
  const CONFIG = { visual: { 'prefetch-enabled': true, 'video-background': false,
    'translation-mode:english': 'gemini_korean', 'translation-mode-2:english': 'none',
    'translate:target-language': 'ko', 'translate:pronunciation-notation': 'latin',
    'prefer-sync-data-provider': false, ...visual } };
  const playback = { data: { item: currentUri ? track(currentUri, 'Current song') : null } };
  const forbid = name => () => { throw Error(`forbidden boundary: ${name}`); };
  const log = (event, detail = {}) => trace.push({ event, currentUri: playback.data.item?.uri ?? null, ...plain(detail) });
  const window = { CONFIG, dispatchEvent: noop, addEventListener: noop,
    StorageManager: { getItem: key => storage.get(key) ?? null },
    AIAddonManager: { getTranslationStyle: () => 'natural', getTranslationInstruction: () => '',
      translateLyrics(options) {
        log('ai-request', { options });
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        providerGates.push({ options, settled: false, resolve, promise });
        return promise;
      } } };
  const context = vm.createContext({
    window, CONFIG, CACHE: {}, console: { log: noop, info: noop, warn: (...args) => warnings.push(plain(args)), error: (...args) => warnings.push(plain(args)) },
    Spicetify: { Player: playback, LocalStorage: { get: key => storage.get(key) ?? null, set: (key, value) => storage.set(key, value) } },
    localStorage: { getItem: key => storage.get(key) ?? null },
    serviceDebug: noop, ivLyricsDebug: noop, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    fetch: forbid('network'), XMLHttpRequest: forbid('network'), document: new Proxy({}, { get: forbid('DOM') }),
    indexedDB: new Proxy({}, { get: forbid('native IndexedDB') }),
    setTimeout(callback, delay) { const id = ++nextTimer; timerQueue.set(id, { callback, delay }); return id; },
    clearTimeout: id => timerQueue.delete(id), setInterval: forbid('interval'),
    awaitIdbRequest: async value => value, awaitIdbTransaction: async () => {},
    CacheManager: { get: key => displayStore.get(key) ?? null, set(key, value) { displayStore.set(key, value); log('display-write', { key, value }); } },
  });
  const cache = vm.runInContext(`({ ${['_getTranslationKey', 'getTranslation', 'setTranslation'].map(name => method('LyricsService.js', name, 8)).join('\n')} })`, context);
  Object.assign(cache, {
    _openDB: async () => ({ transaction(name, mode) {
      assert.equal(name, 'translations');
      return { objectStore() { return {
        get(key) { log('translation-read', { key }); return translationStore.get(key) ?? null; },
        put(value) { assert.equal(mode, 'readwrite'); translationStore.set(value.cacheKey, plain(value)); log('translation-write', { value }); },
      }; } };
    } }),
    _isExpired: () => false, _withSize: value => value, _scheduleSizeEnforcement: noop,
  });
  window.LyricsCache = cache;
  context.LyricsCache = cache;
  vm.runInContext(`(() => {
    ${section('LyricsService.js', '    const TrackIdentity = (() => {', '    const MODULE_KEY =')}
    ${section('LyricsService.js', '    const getLyricsTextCacheHash =', '    const cleanupWorker =')}
    ${section('LyricsService.js', '    const Utils = {', '    const ApiTracker =')}
    ${section('LyricsService.js', '    const _translatorInflightRequests =', '    // I18n이 로드되기')}
    ${section('LyricsService.js', '    function getTranslatorErrorMessage(', '    function shouldHideOverlayForIvLyricsFullscreen(')}
    ${section('LyricsService.js', '    function getCurrentLanguage()', '    class Translator {')}
    class Translator { ${method('LyricsService.js', 'callGemini', 8, true)} }
    window.Translator = Translator;
    window.serviceUtils = Utils;
    window.translatorFlights = _translatorInflightRequests;
    let lyricsProviderRequestGeneration = 0;
    const lyricsProviderInflightRequests = new Map();
    window.lyricsProviderFlights = lyricsProviderInflightRequests;
    window.LyricsService = { ${method('LyricsService.js', 'getLyricsFromProviders', 8)} };
  })();`, context);
  Object.assign(window.LyricsService, {
    extractTrackId: uri => window.ivLyricsTrackIdentity.extractTrackId(uri),
    detectLanguage: lines => window.serviceUtils.detectLanguage(lines),
    getLyricsSnapshot: uri => snapshots.get(uri) ?? null,
    publishLyricsSnapshot: value => { snapshots.set(value.trackUri, value); log('snapshot', { value }); },
    getCachedLyrics: async (id, provider) => { log('lyrics-read', { id, provider }); return lyricsStore.get(`${id}:${provider}`) ?? null; },
    cacheLyrics: async (id, provider, value) => { lyricsStore.set(`${id}:${provider}`, plain(value)); log('lyrics-write', { id, provider }); return true; },
  });
  context.LyricsService = window.LyricsService;
  vm.runInContext(full('LyricsAddonManager.js'), context);
  const manager = window.LyricsAddonManager;
  const addon = (id, supportsLocalTracks) => ({ id, name: id, author: 'Inert fixture', description: 'Inert provider boundary', version: '1',
    supports: { karaoke: false, synced: false, unsynced: true }, supportsLocalTracks,
    getLyrics: async info => {
      log('lyrics-provider', { provider: id, info });
      return { uri: info.uri, provider: id, unsynced: [{ text: lyricText }] };
    } });
  assert.match(read('Addon_Lyrics_Lrclib.js'), /supportsLocalTracks: true/);
  assert.equal(manager.register(addon('spotify', false)), true);
  if (localProvider) assert.equal(manager.register(addon('lrclib', true)), true);
  vm.runInContext(`
    ${section('Utils.js', 'const IV_LYRICS_COMPARISON_APOSTROPHE_REGEX', 'const IV_LYRICS_DEFAULT_SPEAKER_TEXT_COLORS')}
    const Utils = { ${section('Utils.js', '  PRONUNCIATION_SEGMENT_SEPARATOR:', '  segmentTextForPronunciation(')}
      ${['isSpotifyTrackId', 'extractTrackId', 'isSectionHeader', 'detectLanguage', 'splitInlinePronunciation', 'segmentTextForPronunciation', 'buildPronunciationRequestText'].map(name => method('Utils.js', name)).join('\n')} };
    window.Utils = Utils;
    ${section('index.js', 'const getCurrentTranslationTargetLanguage =', 'const getUpdateBannerTheme =')}
    ${section('index.js', 'const emptyState =', '// Enhanced cache system')}
    ${section('index.js', 'const Prefetcher = {', '// 주기적으로 오래된 프리페치 캐시 정리')}
    globalThis.prefetch = Prefetcher;
    globalThis.readCached = getCachedTranslationForText;
    globalThis.sourceHash = getTranslationResultCacheHash;
    globalThis.displayKey = getDisplayModeCacheKey;
    globalThis.prefetchKey = lyrics => "prefetch:translation:" + lyrics.uri + ":" + getSyncDataRendererCacheVersion(lyrics) + ":pronunciation=" + getCurrentLyricsPronunciationNotation();
    globalThis.container = { state: { explicitMode: -1 }, currentTrackUri: ${JSON.stringify(currentUri)},
      ${method('index.js', 'infoFromTrack')},
      schedulePlaybackTrackResolution() { throw Error('fixture current track must remain stable'); }
    };
    (function () { ${section('index.js', '    this.onQueueChange = async ({ data: queue }) => {', '    this.handlePlaybackSongChange =')} }).call(container);
  `, context);
  const observedReads = async (originUri, text, provider = null) => {
    const originId = window.ivLyricsTrackIdentity.extractTrackId(originUri);
    const result = await context.readCached({ trackId: originId, lang: 'ko', provider: provider || (originId ? 'spotify' : 'lrclib'), text });
    return { originId, result: plain(result) };
  };
  return { trace, warnings, timerQueue, jobs, providerGates, context, cache, playback, window, displayStore, translationStore, lyricsStore,
    async queue(uri, useNextUp = false) {
      log('queue', { originUri: uri });
      await context.container.onQueueChange({ data: { current: currentUri ? track(currentUri) : null, [useNextUp ? 'nextUp' : 'queued']: [typeof uri === 'string' ? track(uri) : uri] } });
    },
    async seed(id, text, provider = 'spotify') {
      await cache.setTranslation(id, 'ko', false, { translation: ['Existing current-track translation'] }, provider, context.sourceHash(text, false));
    },
    observedReads,
    async drain() {
      for (let iteration = 0; iteration < 100; iteration++) {
        for (const [id, entry] of [...timerQueue]) {
          timerQueue.delete(id);
          log('timer-run', { delay: entry.delay });
          const job = { settled: false };
          job.promise = Promise.resolve().then(entry.callback).then(value => { job.settled = true; job.result = value; }, error => { job.settled = true; job.error = error.message; });
          jobs.push(job);
        }
        await flush();
        for (const gate of providerGates.filter(g => !g.settled)) {
          gate.settled = true;
          gate.resolve(gate.options.wantSmartPhonetic ? { phonetic: ['fixture reading'] } : { translation: ['fixture translation'] });
        }
        await flush();
        if (timerQueue.size === 0 && jobs.every(j => j.settled) && providerGates.every(g => g.settled)) break;
      }
      assert.equal(timerQueue.size, 0, 'neutral timer drain');
      assert.ok(jobs.every(j => j.settled), 'neutral job drain');
      assert.ok(providerGates.every(g => g.settled), 'neutral provider drain');
      assert.ok(jobs.every(j => !j.error), `unexpected fixture job error: ${JSON.stringify(jobs)}`);
      assert.equal(context.prefetch._inflightRequests.size, 0, 'neutral prefetch registry drain');
      assert.equal(window.translatorFlights.size, 0, 'neutral Translator registry drain');
      assert.equal(window.lyricsProviderFlights.size, 0, 'neutral lyric-service registry drain');
      await Promise.all(jobs.map(j => j.promise));
    },
    snapshot() { return plain({ trace, warnings, translationRecords: [...translationStore.values()],
      lyricsCacheKeys: [...lyricsStore.keys()], displayCache: [...displayStore],
      prefetchCache: [...context.prefetch._prefetchCache],
      finalCurrentUri: playback.data.item?.uri ?? null,
      drained: { timers: timerQueue.size, jobs: jobs.filter(j => !j.settled).length,
        providers: providerGates.filter(g => !g.settled).length, prefetch: context.prefetch._inflightRequests.size,
        translator: window.translatorFlights.size, lyricService: window.lyricsProviderFlights.size } }); },
  };
}
