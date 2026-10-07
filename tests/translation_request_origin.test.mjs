import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../LyricsService.js', import.meta.url), 'utf8');
const utilsSource = readFileSync(new URL('../Utils.js', import.meta.url), 'utf8');
function between(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `missing exact section ${from}`);
  return source.slice(start, end);
}
function method(source, name, indent = 2, staticMethod = false) {
  const lead = ' '.repeat(indent);
  const start = source.search(new RegExp(`^${lead}${staticMethod ? 'static ' : ''}(?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, `missing method ${name}`);
  const next = source.slice(start + 1).search(new RegExp(`^${lead}(?:static )?(?:async )?\\w+\\(`, 'm'));
  assert.ok(next >= 0, `missing method end ${name}`);
  return source.slice(start, start + 1 + next);
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const noop = () => {};
const clone = value => JSON.parse(JSON.stringify(value));
const aid = 'AAAAAAAAAAAAAAAAAAAAAA', bid = 'BBBBBBBBBBBBBBBBBBBBBB';
const auri = `spotify:track:${aid}`, buri = `spotify:track:${bid}`;
const oldLines = [{ text: 'わたしのうた', startTime: 1000 }];
const newLines = [{ text: '나의 새로운 노래', startTime: 1000 }];
const track = (uri, title, artist) => ({ uri, metadata: { title, artist_name: artist, duration: '200000' } });
const oldTrack = track(auri, 'Old title', 'Old artist');
const newTrack = track(buri, 'New title', 'New artist');
const oldState = { uri: auri, title: 'Old title', artist: 'Old artist', synced: oldLines, provider: 'local', language: null, lyricsRequestSeq: 1, isLoading: false };

function harness({ oldUri = auri, mode = 'gemini_korean', override = null, language = null } = {}) {
  const cacheReads = [], persistentWrites = [], providerCalls = [], cacheWrites = [], presentations = [], errors = [], stateWrites = [], pendingRequests = [], progress = [], languageWrites = [], metadataCalls = [], ancillary = [];
  const memory = new Map(), translationFlights = new Map();
  const config = { modes: ['karaoke', 'synced', 'unsynced'], visual: {
    'translate:target-language': 'en', 'translate:detect-language-override': 'off',
    'translate:ai-language-detection': false, 'cultural-annotations-enabled': false,
    'translation-mode:japanese': mode, 'translation-mode-2:japanese': 'none',
    'translation-mode:korean': 'none', 'translation-mode-2:korean': 'none',
    'translation-mode:french': 'none', 'translation-mode-2:french': 'none',
    'translate:pronunciation-notation': 'latin',
  } };
  const storage = { getItem: () => null, getPersisted: () => null };
  const playback = { data: { item: { ...oldTrack, uri: oldUri } } };
  const window = { CONFIG: config, StorageManager: storage };
  const cache = {
    getTranslation(...args) {
      const gate = deferred();
      cacheReads.push({ args, ...gate });
      return gate.promise;
    },
    async setTranslation(...args) { persistentWrites.push(args); },
  };
  window.LyricsCache = cache;
  window.AIAddonManager = {
    getTranslationStyle: () => 'natural', getTranslationInstruction: () => '',
    translateLyrics(options) {
      const gate = deferred(); providerCalls.push({ options, ...gate }); return gate.promise;
    },
  };
  const context = vm.createContext({
    window, console: { log: noop, warn: (...x) => errors.push(x), error: (...x) => errors.push(x) },
    Spicetify: { Player: playback, LocalStorage: { get: () => null } }, CONFIG: config, APP_NAME: 'ivLyrics',
    localStorage: storage, StorageManager: storage, LyricsCache: cache,
    CACHE: {}, TrackBackgroundDB: { getOverride: async () => null },
    ivLyricsDebug: noop, serviceDebug: noop, I18n: { t: key => key },
    Toast: { error: error => errors.push(error) },
    RateLimiter: { canMakeCall: () => true },
    CacheManager: {
      get: key => memory.get(key), set: (key, value) => { memory.set(key, value); cacheWrites.push({ key, value }); },
      clearByUri: uri => { for (const key of memory.keys()) if (key.startsWith(`${uri}:`)) memory.delete(key); },
    },
    setTimeout: () => 1, clearTimeout: noop, GENERATION_PILL_TIMING: { loadingDelayMs: 1000 },
    fetch: () => assert.fail('network forbidden'), indexedDB: new Proxy({}, { get: () => assert.fail('IndexedDB forbidden') }),
  });
  // Service identity parser, language detector and Translator run unchanged in
  // their own lexical scope. Only cache, settings, playback and AI transport are inert.
  vm.runInContext(`(() => {
    ${between(serviceSource, '    const TrackIdentity = (() => {', '    const MODULE_KEY =')}
    ${between(serviceSource, '    const getLyricsTextCacheHash =', '    const cleanupWorker =')}
    ${between(serviceSource, '    const Utils = {', '    const ApiTracker =')}
    ${between(serviceSource, '    const _translatorInflightRequests =', '    // I18n이 로드되기')}
    const getStorageItem = key => window.StorageManager.getItem(key);
    ${between(serviceSource, '    function getCurrentLanguage()', '    class Translator {')}
    class Translator {
      ${method(serviceSource, 'clearInflightRequests', 8, true)}
      ${method(serviceSource, 'callGemini', 8, true)}
    }
    window.Translator = Translator;
    window.ServiceUtils = Utils;
    window.LyricsService = {
      detectLanguage: lyrics => Utils.detectLanguage(lyrics),
      extractTrackId: uri => Utils.extractTrackId(uri),
      isSpotifyTrackId: value => Utils.isSpotifyTrackId(value),
    };
  })();`, context);
  Object.assign(window.LyricsService, {
    getTrackLanguageOverride: async uri => uri === oldUri ? override : null,
    getTrackLyricsProviderOverride: async () => null,
    getLyricsFromProviders: async info => ({ uri: info.uri, provider: 'local', synced: newLines }),
    publishLyricsSnapshot: value => presentations.push(clone(value)),
  });
  const utilityNames = ['isSectionHeader', 'detectLanguage', 'setDetectedLanguage', 'getDetectedLanguage', 'isSpotifyTrackId', 'extractTrackId', 'splitInlinePronunciation'];
  const names = [
    'getGeminiTranslation', 'provideLanguageCode', 'lyricsSource', 'resolveLyricsForMode',
    'isCurrentLyricsUri', 'isCurrentLyricsState', 'getTranslationTargetLanguage',
    'getLyricsLayoutHasLyrics', 'getLoadingLyricsState', 'infoFromTrack',
    'clearPendingLyricsUpdates', 'fetchLyrics', 'commitResolvedPlaybackTrack',
    'applyTranslationStates', 'refineLanguageWithAI', 'isPlaybackUriCurrent',
    'isModeAvailable', 'getAutomaticMode', 'getCurrentMode', 'optimizeTranslations',
    'applyCulturalAnnotations', 'isCulturalAnnotationsEnabled', 'requestCulturalAnnotations',
    'startGenerationRequestLoading', 'clearGenerationRequestLoading',
    'startLyricsLoading', 'clearLyricsLoading', 'startTranslationLoading', 'clearTranslationLoading',
    'startPhoneticLoading', 'clearPhoneticLoading', 'clearCulturalAnnotationsLoading',
  ];
  vm.runInContext(`
    ${between(utilsSource, 'const IV_LYRICS_COMPARISON_APOSTROPHE_REGEX', 'const IV_LYRICS_DEFAULT_SPEAKER_TEXT_COLORS')}
    const Utils = { PRONUNCIATION_SEGMENT_SEPARATOR: '｜', ${utilityNames.map(name => method(utilsSource, name)).join('\n')} };
    window.Utils = Utils;
    ${between(source, 'const getCurrentTranslationTargetLanguage =', 'const getUpdateBannerTheme =')}
    ${between(source, 'const KARAOKE =', 'const normalizeLyricsRenderModeLock =')}
    ${between(source, 'const emptyState =', '// Enhanced cache system')}
    ${between(source, 'const GENERATION_REQUEST_PILL_CONFIG =', '// Enhanced FAD container detection')}
    ${between(source, 'const isTranslationNoteLine =', 'class LyricsContainer extends')}
    class Container { ${names.map(name => method(source, name)).join('\n')} }
    globalThis.Container = Container;
    globalThis.newRegistry = () => new InflightRequestRegistry();
  `, context);
  const c = new context.Container();
  Object.assign(c, {
    state: { ...oldState, uri: oldUri, language }, currentTrackUri: oldUri,
    trackLanguageOverride: override, _activeLyricsFetchSeq: 1, _lyricsFetchSeq: 1,
    _lyricsTransitionSeq: 0, _lyricsPresentationSeq: 0, _localLyricsImportGeneration: 0,
    _isComponentMounted: true, _inflightGemini: context.newRegistry(), _inflightTrad: context.newRegistry(),
    _dmResults: {}, _sharedPresentationKeys: new Map(), _culturalAnnotationResults: new Map(),
    _generationRequestDetails: new Map(), _visibleGenerationPills: new Set(),
    _activeLyricsLoadingTokens: new Set(), _activeTranslationLoadingTokens: new Set(),
    _activePhoneticLoadingTokens: new Set(), _activeCulturalAnnotationsLoadingTokens: new Set(),
    _lyricsLoadingSeq: 0, _translationLoadingSeq: 0, _phoneticLoadingSeq: 0, _culturalAnnotationsLoadingSeq: 0,
    setState(patch, callback) {
      const next = typeof patch === 'function' ? patch(this.state) : patch;
      this.state = { ...this.state, ...next }; stateWrites.push(clone(next)); callback?.();
    },
    // Unrelated transport/cache and UI timer endpoints are inert. No real
    // provider, IndexedDB, DOM, Spotify or auth object is present in this VM.
    fetchMetadataTranslation: (...x) => metadataCalls.push(x),
    fetchColors: uri => ancillary.push(['colors', uri]),
    fetchTempo: uri => ancillary.push(['tempo', uri]),
    loadSavedVideoForTrack: uri => ancillary.push(['video', uri]),
    resetDelay: noop, lyricsSaved: () => false, getSavedLocalLyrics: () => null,
    showGenerationPillLoading: noop, clearGenerationPillTimers: noop,
    hideGenerationPill: noop, completeGenerationPill: noop,
    applyStreamingTranslation: value => progress.push(clone(value)),
  });
  const actualGet = c.getGeminiTranslation;
  c.getGeminiTranslation = function(...args) {
    const promise = actualGet.apply(this, args);
    pendingRequests.push({ args, promise });
    promise.catch(noop);
    return promise;
  };
  const actualFetch = c.fetchLyrics;
  let fetched = null;
  c.fetchLyrics = function(...args) { fetched = actualFetch.apply(this, args); return fetched; };
  const actualSetDetected = window.Utils.setDetectedLanguage;
  window.Utils.setDetectedLanguage = function(lang) { languageWrites.push(lang); actualSetDetected.call(this, lang); };
  return {
    context, c, window, cacheReads, persistentWrites, providerCalls, cacheWrites,
    errors, stateWrites, pendingRequests, progress, languageWrites, memory, config,
    present() { c.lyricsSource(c.state, 1); },
    async switchTo(next = newTrack, { present = true, language: nextLanguage, override: nextOverride } = {}) {
      playback.data.item = next;
      c.commitResolvedPlaybackTrack(next, {});
      await fetched;
      assert.ok(!c.state.error, `unexpected fetch error: ${c.state.error}`);
      if (nextLanguage !== undefined) c.state = { ...c.state, language: nextLanguage };
      if (nextOverride !== undefined) c.trackLanguageOverride = nextOverride;
      if (present) this.present();
    },
    settleProvider(index = 0) {
      providerCalls[index].resolve({ translation: ['translated fixture'], phonetic: ['phonetic fixture'] });
    },
  };
}

async function releaseCacheMisses(h, startingAt = 0) {
  for (let index = startingAt; index < 3; index++) {
    await flush();
    assert.ok(h.cacheReads[index], `missing cache call ${index}`);
    h.cacheReads[index].resolve(null);
  }
  await flush();
}

test('unchanged-track control uses one coherent context and applies the result', async () => {
  const h = harness(); h.present();
  assert.equal(h.pendingRequests.length, 1);
  assert.equal(h.cacheReads[0].args[0], aid);
  await releaseCacheMisses(h);
  assert.equal(h.providerCalls.length, 1);
  const request = h.providerCalls[0].options;
  assert.deepEqual([request.trackId, request.artist, request.title, request.sourceLang, request.text],
    [aid, 'Old artist', 'Old title', 'ja', oldLines[0].text]);
  h.settleProvider(); await h.pendingRequests[0].promise; await flush();
  assert.equal(h.persistentWrites[0][0], aid);
  assert.equal(h.cacheWrites.length, 1);
  assert.equal(h.c.state.currentLyrics[0].translationText, 'translated fixture');
  assert.equal(h.c._activeTranslationLoadingTokens.size, 0);
});

for (const pauseAt of [0, 1]) {
  test(`track switch while ${pauseAt === 0 ? 'current' : 'legacy'} cache is pending retains origin metadata and identity without changing the new display language`, async () => {
    const h = harness(); h.present();
    if (pauseAt === 1) { h.cacheReads[0].resolve(null); await flush(); }
    assert.equal(h.cacheReads.length, pauseAt + 1);
    await h.switchTo();
    assert.equal(h.c.state.language, null, 'actual fetch retains null language after its loading-state URI assignment');
    assert.equal(h.window.Utils.getDetectedLanguage(), 'ko');
    assert.equal(h.c._inflightGemini._entries.size, 0, 'actual next-track presentation retires old ownership');
    await releaseCacheMisses(h, pauseAt);
    assert.equal(h.providerCalls.length, 1);
    const request = h.providerCalls[0].options;
    assert.deepEqual([request.trackId, request.artist, request.title, request.sourceLang, request.text],
      [aid, 'Old artist', 'Old title', 'ja', oldLines[0].text]);
    assert.equal(h.cacheReads[0].args[0], aid);
    assert.equal(h.cacheReads[1].args[0], aid);
    assert.equal(h.cacheReads[2].args[0], aid);
    assert.equal(h.window.Utils.getDetectedLanguage(), 'ko');
    request.onLine(0, 'stale stream'); request.onStreamReset({ reason: 'test' });
    assert.equal(h.progress.length, 0);
    h.settleProvider(); await h.pendingRequests[0].promise; await flush();
    assert.equal(h.persistentWrites[0][0], aid);
    assert.equal(h.cacheWrites.length, 0);
    assert.equal(h.c.state.currentLyrics[0].originalText, newLines[0].text);
    assert.equal(h.c.state.currentLyrics[0].translationText, null);
  });
}

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy' : 'current'} persistent-cache hit after retirement does not call Translator or rewrite detected language`, async () => {
    const h = harness(); h.present();
    if (legacy) { h.cacheReads[0].resolve(null); await flush(); }
    await h.switchTo();
    const languageWriteCount = h.languageWrites.length;
    h.cacheReads[legacy ? 1 : 0].resolve({ translation: ['cached result'] });
    const result = await h.pendingRequests[0].promise; await flush();
    assert.equal(result[0].text, 'cached result');
    assert.equal(h.providerCalls.length, 0);
    assert.equal(h.persistentWrites.length, 0);
    assert.equal(h.cacheWrites.length, 0);
    assert.equal(h.window.Utils.getDetectedLanguage(), 'ko');
    assert.equal(h.languageWrites.length, languageWriteCount);
    assert.equal(h.c.state.currentLyrics[0].originalText, newLines[0].text);
  });
}

test('memory-cache hit bypasses persistent cache and transport', async () => {
  const h = harness();
  const keyFor = vm.runInContext('getDisplayModeCacheKey', h.context);
  const cached = [{ text: 'memory result', originalText: oldLines[0].text }];
  h.memory.set(keyFor(h.c.state, 'gemini_korean'), cached);
  h.present();
  assert.strictEqual(await h.pendingRequests[0].promise, cached);
  await flush();
  assert.equal(h.cacheReads.length, 0);
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.c.state.currentLyrics[0].translationText, 'memory result');
});

for (const source of ['state', 'track override']) {
  test(`new-track ${source} does not replace the admitted request source language or rewrite display language`, async () => {
    const h = harness(); h.present();
    await h.switchTo(newTrack, source === 'state' ? { language: 'ko' } : { override: 'ko' });
    assert.equal(h.window.Utils.getDetectedLanguage(), 'ko');
    const languageWriteCount = h.languageWrites.length;
    await releaseCacheMisses(h);
    const request = h.providerCalls[0].options;
    assert.deepEqual([request.trackId, request.artist, request.title, request.sourceLang, request.text],
      [aid, 'Old artist', 'Old title', 'ja', oldLines[0].text]);
    assert.equal(h.window.Utils.getDetectedLanguage(), 'ko');
    assert.equal(h.languageWrites.length, languageWriteCount);
    h.settleProvider(); await h.pendingRequests[0].promise;
  });
}

test('origin track override remains with an admitted phonetic request', async () => {
  const h = harness({ mode: 'gemini_romaji', override: 'ja' }); h.present();
  await h.switchTo(newTrack, { override: 'ko' });
  await releaseCacheMisses(h);
  assert.equal(h.providerCalls[0].options.wantSmartPhonetic, true);
  assert.equal(h.providerCalls[0].options.sourceLang, 'ja');
  assert.equal(h.providerCalls[0].options.trackId, aid);
  h.settleProvider(); await h.pendingRequests[0].promise;
  assert.equal(h.persistentWrites[0][2], true);
  assert.equal(h.c._activePhoneticLoadingTokens.size, 0);
});

test('disposal preserves settlement of admitted work while blocking new work and all page cache/progress writes', async () => {
  const h = harness(); h.present();
  const admitted = h.pendingRequests[0].promise;
  h.c._inflightGemini.dispose();
  await releaseCacheMisses(h);
  assert.equal(h.providerCalls.length, 1, 'admitted operation continues by the documented registry contract');
  h.providerCalls[0].options.onLine(0, 'late progress');
  h.providerCalls[0].options.onStreamReset();
  assert.equal(h.progress.length, 0);
  h.settleProvider(); await admitted;
  assert.equal(h.cacheWrites.length, 0);
  assert.equal(h.persistentWrites.length, 1, 'Translator cache warming is independent of page ownership');
  await assert.rejects(h.c.getGeminiTranslation(h.c.state, oldLines, 'gemini_korean'), /disposed/);
  assert.equal(h.providerCalls.length, 1);
});

test('duplicate admissions retain one request before the cache settles', async () => {
  const h = harness(); h.present();
  const duplicate = h.c.getGeminiTranslation(h.c.state, oldLines, 'gemini_korean');
  assert.equal(h.cacheReads.length, 1);
  await releaseCacheMisses(h);
  assert.equal(h.providerCalls.length, 1);
  h.settleProvider();
  const [first, second] = await Promise.all([h.pendingRequests[0].promise, duplicate]);
  assert.strictEqual(first, second);
  assert.equal(h.cacheWrites.length, 1);
});

test('switching from a Spotify origin to local playback preserves admitted Spotify work', async () => {
  const h = harness(); h.present();
  const local = track('spotify:local:NewArtist:Album:Song:200', 'Local title', 'Local artist');
  await h.switchTo(local);
  await releaseCacheMisses(h);
  assert.equal(h.providerCalls.length, 1);
  assert.equal(h.cacheReads.length, 3);
  assert.deepEqual([h.providerCalls[0].options.trackId, h.providerCalls[0].options.artist, h.providerCalls[0].options.title], [aid, 'Old artist', 'Old title']);
  h.settleProvider(); await h.pendingRequests[0].promise; await flush();
  assert.equal(h.persistentWrites[0][0], aid);
  assert.equal(h.c.state.uri, local.uri);
  assert.equal(h.c.state.currentLyrics[0].originalText, newLines[0].text);
});

test('local-origin control records the pre-existing unsupported wrapper path without assigning it a new policy', async () => {
  const h = harness({ oldUri: 'spotify:local:OldArtist:Album:Song:200' }); h.present();
  await assert.rejects(h.pendingRequests[0].promise, /No track ID available/);
  assert.equal(h.cacheReads.length, 0);
  assert.equal(h.providerCalls.length, 0);
});

test('actual Translator accepts explicit origin identities independently of current playback, including local full URIs', async () => {
  for (const trackId of [aid, 'spotify:local:OldArtist:Album:Song:200']) {
    const h = harness(); await h.switchTo(newTrack, { present: false });
    const promise = h.window.Translator.callGemini({ trackId, artist: 'Old artist', title: 'Old title', text: oldLines[0].text, sourceLang: 'ja', provider: 'local' });
    assert.equal(h.cacheReads[0].args[0], trackId);
    h.cacheReads[0].resolve(null); await flush();
    assert.equal(h.providerCalls[0].options.trackId, trackId);
    h.settleProvider(); await promise;
    assert.equal(h.persistentWrites[0][0], trackId);
  }
});

test('actual identity parser extracts the origin ID from full Spotify URI and web URL; local URI has no Spotify ID', () => {
  const h = harness();
  for (const value of [aid, auri, `${auri}?fixture=1`, `https://open.spotify.com/track/${aid}?si=fixture`]) {
    assert.equal(h.window.Utils.extractTrackId(value), aid);
  }
  assert.equal(h.window.Utils.extractTrackId('spotify:local:OldArtist:Album:Song:200'), null);
});

test('retired cache misses cannot rewrite the current presentation language', async () => {
  const h = harness(); h.present();
  await h.switchTo();
  const languageWriteCount = h.languageWrites.length;
  await releaseCacheMisses(h);
  assert.equal(h.window.Utils.getDetectedLanguage(), 'ko');
  assert.equal(h.languageWrites.length, languageWriteCount);
  h.settleProvider(); await h.pendingRequests[0].promise;
});

test('a retired completed translation is persisted only under its admitted track identity', async () => {
  const h = harness(); h.present();
  await h.switchTo();
  await releaseCacheMisses(h);
  h.settleProvider(); await h.pendingRequests[0].promise;
  assert.equal(h.persistentWrites.length, 1);
  assert.equal(h.persistentWrites[0][0], aid);
  assert.equal(h.cacheWrites.length, 0);
});

test('current admission keeps existing late metadata and source-language edits', async () => {
  const h = harness(); h.present();
  h.c.state = { ...h.c.state, artist: 'Edited artist', title: 'Edited title', language: 'ko' };
  h.c.trackLanguageOverride = 'ko';
  await releaseCacheMisses(h);
  const request = h.providerCalls[0].options;
  assert.deepEqual([request.trackId, request.artist, request.title, request.sourceLang],
    [aid, 'Edited artist', 'Edited title', 'ko']);
  h.settleProvider(); await h.pendingRequests[0].promise;
});

test('real Translator rejection releases the shared admission and allows a later retry', async () => {
  const h = harness(); h.present();
  await releaseCacheMisses(h);
  const failure = new Error('inert provider failure');
  h.providerCalls[0].reject(failure);
  await assert.rejects(h.pendingRequests[0].promise, error => error === failure);
  await flush();
  assert.equal(h.c._inflightGemini._entries.size, 0);
  assert.equal(h.c._activeTranslationLoadingTokens.size, 0);
  assert.equal(h.persistentWrites.length, 0);
  const retry = h.c.getGeminiTranslation(h.c.state, oldLines, 'gemini_korean');
  for (let index = 3; index < 6; index++) {
    await flush();
    assert.ok(h.cacheReads[index]);
    h.cacheReads[index].resolve(null);
  }
  await flush();
  assert.equal(h.providerCalls.length, 2);
  assert.equal(h.providerCalls[1].options.trackId, aid);
  h.settleProvider(1); await retry;
  assert.equal(h.persistentWrites[0][0], aid);
});

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy' : 'current'} wrapper-cache hit retains the existing display-language write count`, async () => {
    const h = harness(); h.present();
    assert.equal(h.languageWrites.length, 1, 'only lyricsSource publishes detected language');
    if (legacy) { h.cacheReads[0].resolve(null); await flush(); }
    h.cacheReads[legacy ? 1 : 0].resolve({ translation: ['cached result'] });
    await h.pendingRequests[0].promise; await flush();
    assert.equal(h.languageWrites.length, 1);
    assert.equal(h.providerCalls.length, 0);
    assert.equal(h.persistentWrites.length, 0);
  });
}
