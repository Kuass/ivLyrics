import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(process.env.IVLYRICS_PREFETCH_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_PREFETCH_SOURCE_DIR, name)
  : new URL(`../${name}`, import.meta.url), 'utf8');
const indexSource = read('index.js');
const utilsSource = read('Utils.js');
const pagesSource = read('Pages.js');
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source boundary: ${start}`);
  return source.slice(from, to);
};
const normalize = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const track = suffix => ({ uri: `spotify:track:${suffix.repeat(22)}`, title: `Track ${suffix}`, artist: 'Fixture' });
const lyrics = (info, text = 'Next line') => ({ uri: info.uri, provider: 'fixture', synced: [{ text, startTime: 1000 }] });

// Execute the complete Prefetcher object, actual queue callback, active-language
// owner, Utils furigana gate, and page presentation helpers. Provider/detection,
// persistence, timers and hook scheduling are inert; no player or browser runs.
function harness({ active = 'ja', next = 'en', visual = {} } = {}) {
  const timers = new Map(), providerCalls = [], translationCalls = [], detections = [];
  const conversions = [], warnings = [], cacheWrites = [];
  let nextTimer = 1, cacheResult = null;
  let getLyrics = async info => lyrics(info);
  let translate = async request => request.wantSmartPhonetic ? { phonetic: ['reading'] } : { translation: ['translated'] };
  let memo;
  const CONFIG = { visual: { 'furigana-enabled': true, 'translate:display-mode': 'below',
    'pronunciation-inline': false, 'translate:detect-language-override': 'off', ...visual } };
  const CACHE = {};
  const service = {
    detectLanguage(value) { detections.push(value); return next; },
    getLyricsFromProviders(info) { providerCalls.push(info); return getLyrics(info); },
  };
  const window = { LyricsService: service, FuriganaConverter: {
    isAvailable: () => true,
    convertToFurigana(text) { conversions.push(text); return `<ruby>${text}<rt>reading</rt></ruby>`; },
  }, Translator: { callGemini(request) { translationCalls.push(request); return translate(request); } } };
  const context = vm.createContext({
    window, CONFIG, CACHE, LyricsService: service, Intl,
    KANJI_CHARACTER_REGEX: /[\u4E00-\u9FAF\u3400-\u4DBF]/,
    console: { warn: (...args) => warnings.push(args) }, ivLyricsDebug() {},
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    getSyncDataRendererCacheVersion: () => 'fixture-version',
    getCurrentLyricsPronunciationNotation: () => 'fixture-notation',
    getCurrentTranslationTargetLanguage: () => 'ko',
    getNonSectionLyricsText: rows => rows.map(row => row.text).join('\n'),
    getLegacyNonSectionLyricsText: rows => rows.map(row => row.text).join('\n'),
    getPronunciationRequestText: rows => rows.map(row => row.text).join('\n'),
    getCachedTranslationForText: async () => cacheResult,
    getTranslationOutputFromCache: (cached, phonetic) => cached?.[phonetic ? 'phonetic' : 'translation'],
    normalizeTranslationOutputLines: value => value,
    mapTranslationLinesToLyrics: (rows, output, options) => rows.map((row, i) => ({ ...row, [options.targetField]: output[i] })),
    getDisplayModeCacheKey: (value, mode) => `${value.uri}:${mode}`,
    CacheManager: { set: (...args) => cacheWrites.push(args) },
    getInterludeInfo: () => ({ isInterlude: false }), getCurrentTrackDurationMs: () => 60000,
    useMemo(factory, dependencies) {
      if (!memo || dependencies.some((value, i) => !Object.is(value, memo.dependencies[i]))) {
        memo = { value: factory(), dependencies };
      }
      return memo.value;
    },
  });
  vm.runInContext(`globalThis.Utils = {
    ${section(utilsSource, '  _currentDetectedLanguage: null,', '  formatTime(timestamp) {')}
  };`, context);
  const Utils = context.Utils;
  Utils.extractTrackId = uri => uri?.split(':')[2] || null;
  Utils.detectLanguage = value => service.detectLanguage(value);
  window.Utils = Utils;
  Utils.setDetectedLanguage(active);
  vm.runInContext([
    section(indexSource, 'const Prefetcher = {', '// 주기적으로 오래된 프리페치 캐시 정리'),
    `globalThis.Prefetcher = Prefetcher;`,
    `globalThis.container = { state: { explicitMode: -1, language: ${JSON.stringify(active)} },
      currentTrackUri: ${JSON.stringify(track('A').uri)}, infoFromTrack: value => value,
      schedulePlaybackTrackResolution() { throw new Error('current track did not change'); },
      ${section(indexSource, '  provideLanguageCode(', '  async translateLyrics(')}
    };`,
    `(function () { ${section(indexSource, '    this.onQueueChange = async ({ data: queue }) => {', '    this.handlePlaybackSongChange =')} }).call(container);`,
    section(pagesSource, 'const safeRenderText =', 'function renderLyricsUnavailable'),
    section(pagesSource, 'const buildLyricDisplayState =', 'const getCopyableText ='),
    section(pagesSource, 'const buildPreparedSyncedLyrics =', 'const buildPaddedSyncedLyrics ='),
    section(pagesSource, 'const usePreparedSyncedLyrics =', 'const useLyricIndexNotification ='),
    'globalThis.prepare = usePreparedSyncedLyrics;',
  ].join('\n'), context);
  return { CONFIG, CACHE, window, Utils, service, providerCalls, translationCalls, detections,
    conversions, warnings, cacheWrites, timers, prefetch: context.Prefetcher, container: context.container,
    render: rows => context.prepare(rows, false),
    setProvider(fn) { getLyrics = fn; }, setTranslator(fn) { translate = fn; },
    setCached(value) { cacheResult = value; },
    async queue(info, useNextUp = false) {
      await context.container.onQueueChange({ data: { current: track('A'), [useNextUp ? 'nextUp' : 'queued']: [info] } });
    },
    runTimer() {
      assert.equal(timers.size, 1);
      const [id, timer] = timers.entries().next().value;
      timers.delete(id); assert.equal(timer.delay, 1500);
      return timer.callback();
    },
  };
}

test('queued English lyrics do not replace the current Japanese display language even without translation modes', async () => {
  const h = harness();
  await h.queue(track('B')); await h.runTimer();
  assert.equal(h.providerCalls.length, 1); assert.equal(h.detections.length, 1);
  assert.equal(h.translationCalls.length, 0);
  assert.equal(h.Utils.getDetectedLanguage(), 'ja');
});

test('nextUp Japanese prefetch does not enable furigana for the current Chinese lyrics', async () => {
  const h = harness({ active: 'zh-hans', next: 'ja' });
  const rows = [{ text: '星空', startTime: 1000 }];
  assert.equal(h.render(rows)[0].mainText, '星空');
  await h.queue(track('B'), true); await h.runTimer();
  assert.equal(h.render(rows)[0].mainText, '星空');
  assert.equal(h.conversions.length, 0);
});

test('a page presentation pass keeps current Japanese furigana after next-track prefetch', async () => {
  const h = harness();
  const rows = [{ text: '星空', startTime: 1000 }];
  const first = h.render(rows);
  assert.equal(first[0].mainText, '<ruby>星空<rt>reading</rt></ruby>');
  await h.queue(track('B')); await h.runTimer();
  const after = h.render(rows);
  assert.equal(after[0].mainText, first[0].mainText);
  assert.equal(after, first, 'unrelated prefetch must not invalidate current-language presentation');
});

test('a later active language change wins while next-track lyrics are still pending', async () => {
  const h = harness(); const pending = deferred();
  h.setProvider(() => pending.promise);
  await h.queue(track('B')); const work = h.runTimer();
  h.container.state.language = 'ko'; h.container.provideLanguageCode([{ text: '현재' }]);
  pending.resolve(lyrics(track('B'))); await work;
  assert.equal(h.Utils.getDetectedLanguage(), 'ko');
});

test('prefetch leaves an unset active language unset', async () => {
  const h = harness({ active: null });
  await h.queue(track('B')); await h.runTimer();
  assert.equal(h.Utils.getDetectedLanguage(), null);
});

test('prefetch uses the upcoming language for its mode and phonetic request', async () => {
  const h = harness({ visual: { 'translation-mode:english': 'gemini_romaji' } });
  await h.queue(track('B')); await h.runTimer();
  assert.equal(h.translationCalls.length, 1);
  assert.deepEqual(normalize(h.translationCalls[0]), {
    trackId: 'B'.repeat(22), artist: 'Fixture', title: 'Track B', text: 'Next line',
    wantSmartPhonetic: true, sourceLang: 'en', provider: 'fixture', ignoreCache: false,
  });
  assert.equal(h.cacheWrites[0][0], `${track('B').uri}:gemini_romaji`);
  assert.equal(h.cacheWrites[0][1][0].phonetic, 'reading');
});

test('both configured prefetch results keep their existing request and cache destinations', async () => {
  const h = harness({ visual: { 'translation-mode:english': 'gemini_romaji', 'translation-mode-2:english': 'gemini_ko' } });
  await h.queue(track('B')); await h.runTimer();
  assert.deepEqual(h.translationCalls.map(request => request.wantSmartPhonetic), [true, false]);
  assert.deepEqual(h.cacheWrites.map(([key]) => key), [`${track('B').uri}:gemini_romaji`, `${track('B').uri}:gemini_ko`]);
  assert.equal(h.prefetch._prefetchCache.size, 1);
  assert.equal(h.prefetch._inflightRequests.size, 0);
});

test('existing translated cache still avoids provider work', async () => {
  const h = harness({ visual: { 'translation-mode:english': 'gemini_ko' } });
  h.setCached({ translation: ['saved'] });
  await h.queue(track('B')); await h.runTimer();
  assert.equal(h.translationCalls.length, 0);
  assert.equal(h.cacheWrites[0][1][0].translation, 'saved');
});

test('phonetic failure still permits translation and never publishes the next language', async () => {
  const h = harness({ visual: { 'translation-mode:english': 'gemini_romaji', 'translation-mode-2:english': 'gemini_ko' } });
  h.setTranslator(async request => { if (request.wantSmartPhonetic) throw new Error('fixture'); return { translation: ['ok'] }; });
  await h.queue(track('B')); await h.runTimer();
  assert.equal(h.translationCalls.length, 2); assert.equal(h.cacheWrites.length, 1);
  assert.equal(h.warnings.length, 1); assert.equal(h.Utils.getDetectedLanguage(), 'ja');
});

test('disabling translation prefetch still loads lyrics without detecting another language', async () => {
  const h = harness({ visual: { 'prefetch-enabled': false } });
  await h.queue(track('B')); await h.runTimer();
  assert.equal(h.providerCalls.length, 1); assert.equal(h.detections.length, 0);
  assert.equal(h.Utils.getDetectedLanguage(), 'ja');
});

test('missing lyrics and undetected languages retain their existing early returns', async () => {
  for (const missing of [true, false]) {
    const h = harness({ next: null });
    if (missing) h.setProvider(async () => ({ provider: 'fixture', uri: track('B').uri }));
    await h.queue(track('B')); await h.runTimer();
    assert.equal(h.detections.length, missing ? 0 : 1);
    assert.equal(h.translationCalls.length, 0); assert.equal(h.Utils.getDetectedLanguage(), 'ja');
  }
});

test('queue replacement keeps the existing debounce and repeated-next-track suppression', async () => {
  const h = harness();
  await h.queue(track('B')); await h.queue(track('C')); await h.queue(track('C'));
  assert.equal(h.timers.size, 1); await h.runTimer();
  assert.equal(h.providerCalls.length, 1); assert.equal(h.providerCalls[0].uri, track('C').uri);
});

test('prefetched lyrics cache still avoids a second lyrics request', async () => {
  const h = harness(); h.CACHE[track('B').uri] = lyrics(track('B'));
  await h.queue(track('B')); await h.runTimer();
  assert.equal(h.providerCalls.length, 0); assert.equal(h.detections.length, 1);
});

test('active language ownership still honors track override, configured override, state and fresh detection', () => {
  const h = harness({ next: 'en' });
  h.container.trackLanguageOverride = 'ko';
  assert.equal(h.container.provideLanguageCode([]), 'ko'); assert.equal(h.Utils.getDetectedLanguage(), 'ko');
  h.container.trackLanguageOverride = null; h.CONFIG.visual['translate:detect-language-override'] = 'zh-hant';
  assert.equal(h.container.provideLanguageCode([]), 'zh-hant'); assert.equal(h.Utils.getDetectedLanguage(), 'zh-hant');
  h.CONFIG.visual['translate:detect-language-override'] = 'off';
  assert.equal(h.container.provideLanguageCode([]), 'ja'); assert.equal(h.Utils.getDetectedLanguage(), 'ja');
  h.container.state.language = null;
  assert.equal(h.container.provideLanguageCode([]), 'en'); assert.equal(h.Utils.getDetectedLanguage(), 'en');
});

test('same-language prefetch and disabled furigana retain ordinary presentation', async () => {
  const h = harness({ next: 'ja', visual: { 'furigana-enabled': false } });
  const rows = [{ text: '星空', startTime: 1000 }];
  const first = h.render(rows);
  await h.queue(track('B')); await h.runTimer();
  assert.equal(h.render(rows), first); assert.equal(first[0].mainText, '星空');
});
