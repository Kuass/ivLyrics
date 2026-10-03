import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Use IVLYRICS_REQUEST_TEST_REVISION=df668b77 to reproduce against the pre-fix tree.
const source = process.env.IVLYRICS_REQUEST_TEST_REVISION
  ? execFileSync('git', ['show', `${process.env.IVLYRICS_REQUEST_TEST_REVISION}:index.js`], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  })
  : readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const section = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `missing production section: ${from}`);
  return source.slice(start, end);
};
const method = name => {
  const start = source.search(new RegExp(`^  (?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = source.slice(start + 1).search(/^  (?:async )?\w+\(/m);
  assert.ok(end >= 0, `end of ${name}`);
  return source.slice(start, start + end + 1);
};
const registrySource = source.includes('class InflightRequestRegistry {')
  ? section('class InflightRequestRegistry {', '// Enhanced cache system')
  : '';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const noop = () => {};
const clone = value => JSON.parse(JSON.stringify(value));
const lines = [{ text: 'Hello', startTime: 1000 }];
const state = { uri: 'spotify:track:one', provider: 'fixture', synced: lines };
const makeRegistry = () => vm.runInNewContext(`${registrySource}; new InflightRequestRegistry()`);

// Execute the real request, cache reset, unmount and loading-token methods.
// Only external storage/provider/DOM/pill collaborators are replaced; no network.
function harness() {
  const requests = [], cache = new Map(), cacheWrites = [], progress = [], clears = [], queries = [];
  const window = { removeEventListener: noop, dispatchEvent: noop, Translator: {
    callGemini(options) {
      const pending = deferred();
      requests.push({ kind: 'gemini', options, ...pending });
      return pending.promise;
    },
  } };
  const context = vm.createContext({
    window, console, APP_NAME: 'ivLyrics', CONFIG: { visual: {} },
    document: { body: { classList: { remove: noop } }, removeEventListener: noop },
    Spicetify: { Player: {} }, CustomEvent: class {}, lyricContainerUpdate: noop,
    clearTimeout: noop, setTimeout: () => 1, ivLyricsDebug: noop,
    StorageManager: { getPersisted: noop }, Utils: { extractTrackId: uri => uri.split(':').at(-1), removeQueueListener: noop },
    CacheManager: {
      get: key => cache.get(key),
      set(key, value) { cache.set(key, value); cacheWrites.push({ key, value }); },
      clear: () => cache.clear(),
      clearByUri(uri) { for (const key of cache.keys()) if (key.startsWith(`${uri}:`)) cache.delete(key); return 1; },
    },
    getLyricsProcessingShapeSignature: lyrics => JSON.stringify(lyrics),
    getCurrentLyricsPronunciationNotation: () => 'latin',
    getCurrentTranslationTargetLanguage: () => 'ko',
    getNonSectionLyricsText: lyrics => lyrics.map(line => line.text).join('\n'),
    getLegacyNonSectionLyricsText: () => 'legacy text',
    mapTranslationLinesToLyrics: (lyrics, translated, options) => ({
      [options.targetField]: Array.from(translated), splitVocalParts: options.splitVocalParts,
    }),
    getCachedTranslationForText: async options => { queries.push(options); return context.diskCache(options); },
    getTranslationOutputFromCache: (result, phonetic) => result?.[phonetic ? 'phonetic' : 'translation'],
    RateLimiter: { canMakeCall: () => context.allowRequest },
    I18n: { t: key => key }, Toast: { success: noop },
    diskCache: () => null, allowRequest: true,
    GENERATION_PILL_TIMING: { loadingDelayMs: 1000 },
  });
  const names = ['getGeminiTranslation', 'getTraditionalConversion', 'resetTranslationCache', 'componentWillUnmount',
    'startGenerationRequestLoading', 'clearGenerationRequestLoading', 'startPhoneticLoading', 'clearPhoneticLoading',
    'startTranslationLoading', 'clearTranslationLoading', 'lyricsSource'];
  vm.runInContext([
    registrySource,
    section('const getLyricsTextCacheHash =', registrySource ? '// Tracks ownership only:' : '// Enhanced cache system'),
    section('const GENERATION_REQUEST_PILL_CONFIG =', '// Enhanced FAD container detection'),
    `class Container { ${names.map(method).join('\n')} }`,
    'globalThis.Container = Container;',
    `globalThis.createRegistry = () => new ${registrySource ? 'InflightRequestRegistry' : 'Map'}();`,
  ].join('\n'), context);
  const container = new context.Container();
  Object.assign(container, {
    state: { ...state, artist: 'Artist', title: 'Title' }, _isComponentMounted: true,
    _inflightGemini: context.createRegistry(), _inflightTrad: context.createRegistry(),
    _lyricsEditRequestSeq: 0, _playbackTrackResolutionSeq: 0, _lyricsPresentationSeq: 0,
    containerRef: { current: null }, _visibleGenerationPills: new Set(),
    _generationRequestDetails: new Map(), _dmResults: {},
    _activeTranslationLoadingTokens: new Set(), _activePhoneticLoadingTokens: new Set(),
    _translationLoadingSeq: 0, _phoneticLoadingSeq: 0,
    getTranslationTargetLanguage: () => 'ko', provideLanguageCode: () => 'en',
    isCurrentLyricsState: value => container.state.uri === value.uri,
    setState(value) { this.state = { ...this.state, ...value }; },
    getCurrentMode: () => 0, lyricsSource: noop,
    resolveLyricsForMode: value => value.synced, optimizeTranslations: value => value,
    translateLyrics(language, lyrics, displayMode) {
      const pending = deferred();
      requests.push({ kind: 'traditional', options: { language, lyrics, displayMode }, ...pending });
      return pending.promise;
    },
    clearPlaybackTrackResolutionTimer: noop, clearFloatingMenuCloseTimer: noop,
    clearLyricsLoading: noop, clearCulturalAnnotationsLoading: noop, clearVideoBackgroundLoadingDelay: noop,
    clearGenerationPillTimers: noop, hideGenerationPill: noop, showGenerationPillLoading: noop,
    completeGenerationPill: noop,
  });
  const clearLoading = container.clearGenerationRequestLoading;
  container.clearGenerationRequestLoading = function(kind, token, options) {
    clears.push({ kind, token, ...options });
    return clearLoading.call(this, kind, token, options);
  };
  return {
    container, context, requests, cache, cacheWrites, progress, clears, queries,
    start(kind = 'gemini', mode = 'gemini_korean', lyricsState = state) {
      return kind === 'gemini'
        ? container.getGeminiTranslation(lyricsState, lines, mode, (...args) => progress.push(args))
        : container.getTraditionalConversion(lyricsState, lines, 'zh', 'tw');
    },
    settle(request, text = 'translated') {
      request.resolve(request.kind === 'gemini'
        ? { translation: [text], phonetic: [text] } : [{ text }]);
    },
  };
}

for (const kind of ['gemini', 'traditional']) {
  test(`${kind}: concurrent requests share work/loading and completed results hit cache`, async () => {
    const h = harness();
    const first = h.start(kind), second = h.start(kind);
    await flush();
    assert.equal(h.requests.length, 1);
    assert.equal(h.container._activeTranslationLoadingTokens.size, 1);
    h.settle(h.requests[0]);
    const [a, b] = await Promise.all([first, second]);
    assert.strictEqual(a, b);
    assert.strictEqual(await h.start(kind), a);
    assert.equal(h.requests.length, 1);
    assert.equal(h.cacheWrites.length, 1);
    assert.equal(h.container._activeTranslationLoadingTokens.size, 0);
    assert.equal(h.clears.filter(entry => entry.completed).length, 1);
  });

  for (const fail of [false, true]) {
    test(`${kind}: pending ${fail ? 'rejection' : 'success'} survives actual component teardown`, async () => {
      const h = harness(), pending = h.start(kind);
      await flush();
      const error = new Error('original provider failure');
      const outcome = fail ? assert.rejects(pending, candidate => candidate === error) : pending;
      const registry = h.container[kind === 'gemini' ? '_inflightGemini' : '_inflightTrad'];
      h.container.componentWillUnmount();
      h.container.componentWillUnmount();
      if (fail) h.requests[0].reject(error); else h.settle(h.requests[0]);
      await outcome;
      assert.equal(h.cacheWrites.length, 0, 'late result must not repopulate a disposed cache');
      assert.strictEqual(h.container[kind === 'gemini' ? '_inflightGemini' : '_inflightTrad'], registry);
      assert.equal(h.container._activeTranslationLoadingTokens.size, 0);
      if (kind === 'gemini') {
        h.requests[0].options.onLine(0, 'late');
        h.requests[0].options.onStreamReset({ reason: 'late' });
        assert.equal(h.progress.length, 0);
      }
      await assert.rejects(h.start(kind), /disposed/);
      assert.equal(h.requests.length, 1, 'disposed owners must not start new work');
    });
  }

  test(`${kind}: rejection retains original error and a subsequent call retries`, async () => {
    const h = harness(), pending = h.start(kind), duplicate = h.start(kind);
    await flush();
    const error = new Error('provider unavailable');
    const settled = Promise.allSettled([pending, duplicate]);
    h.requests[0].reject(error);
    for (const result of await settled) assert.strictEqual(result.reason, error);
    assert.equal(h.container._activeTranslationLoadingTokens.size, 0);
    assert.equal(h.cache.size, 0);
    const retry = h.start(kind);
    await flush();
    assert.equal(h.requests.length, 2);
    h.settle(h.requests[1]);
    await retry;
  });

  for (const oldFails of [false, true]) {
    test(`${kind}: invalidated ${oldFails ? 'rejected' : 'resolved'} request cannot remove its same-key replacement`, async () => {
      const h = harness(), old = h.start(kind);
      await flush();
      const oldOutcome = Promise.allSettled([old]);
      h.container.resetTranslationCache(state.uri);
      const replacement = h.start(kind);
      await flush();
      assert.equal(h.requests.length, 2);
      if (oldFails) h.requests[0].reject(new Error('old failure')); else h.settle(h.requests[0], 'old');
      await oldOutcome;
      assert.equal(h.cacheWrites.length, 0);
      assert.equal(h.container._activeTranslationLoadingTokens.size, 1, 'old cleanup keeps the replacement loading token');
      const duplicate = h.start(kind);
      await flush();
      assert.equal(h.requests.length, 2, 'replacement must still own the dedupe entry');
      h.settle(h.requests[1], 'new');
      const [a, b] = await Promise.all([replacement, duplicate]);
      assert.strictEqual(a, b);
      assert.strictEqual(await h.start(kind), a);
      assert.equal(h.cacheWrites.length, 1);
    });
  }

  test(`${kind}: late old success cannot overwrite a completed replacement`, async () => {
    const h = harness(), old = h.start(kind);
    await flush();
    h.container.resetTranslationCache(state.uri);
    const replacement = h.start(kind);
    await flush();
    h.settle(h.requests[1], 'new');
    const current = await replacement;
    h.settle(h.requests[0], 'old');
    await old;
    assert.strictEqual(await h.start(kind), current);
    assert.equal(h.cacheWrites.length, 1);
  });
}

test('Gemini progress/reset ownership changes on invalidation while provider arguments and phonetic loading are preserved', async () => {
  const h = harness(), old = h.start('gemini', 'gemini_romaji');
  await flush();
  assert.equal(h.container._activePhoneticLoadingTokens.size, 1);
  assert.equal(h.container._activeTranslationLoadingTokens.size, 0);
  const options = h.requests[0].options;
  assert.equal(options.wantSmartPhonetic, true);
  assert.equal(options.provider, state.provider);
  assert.equal(options.artist, 'Artist');
  assert.equal(options.title, 'Title');
  assert.equal(options.sourceLang, 'en');
  options.onLine(0, 'valid');
  options.onStreamReset({ reason: 'fallback' });
  assert.equal(h.progress.length, 2);
  assert.deepEqual(clone(h.progress[1]), [null, { reason: 'fallback', reset: true }]);
  h.container.resetTranslationCache(state.uri);
  const current = h.start('gemini', 'gemini_romaji');
  await flush();
  options.onLine(0, 'stale');
  options.onStreamReset();
  assert.equal(h.progress.length, 2);
  h.requests[1].options.onLine(0, 'fresh');
  assert.equal(h.progress.length, 3);
  h.settle(h.requests[0], 'old');
  h.settle(h.requests[1], 'new');
  const result = await current;
  await old;
  assert.deepEqual(clone(result.phonetic), ['new']);
  assert.equal(h.container._activePhoneticLoadingTokens.size, 0);
});

test('Gemini persistent cache and legacy fallback bypass provider/rate limiter', async () => {
  for (const legacy of [false, true]) {
    const h = harness();
    h.context.allowRequest = false;
    h.context.diskCache = options => options.text === (legacy ? 'legacy text' : 'Hello')
      ? { translation: ['cached'] } : null;
    const result = await h.start();
    assert.deepEqual(clone(result.translation), ['cached']);
    assert.equal(result.splitVocalParts, !legacy);
    assert.equal(h.requests.length, 0);
    assert.equal(h.queries.length, legacy ? 2 : 1);
    assert.equal(h.cacheWrites.length, 1);
  }
});

test('synchronous traditional conversion errors still release loading and allow retries', async () => {
  const h = harness(), error = new Error('synchronous conversion error');
  h.container.translateLyrics = () => { throw error; };
  await assert.rejects(h.start('traditional'), candidate => candidate === error);
  assert.equal(h.container._activeTranslationLoadingTokens.size, 0);
  h.container.translateLyrics = () => [{ text: 'sync result' }];
  assert.deepEqual(clone(await h.start('traditional')), [{ text: 'sync result' }]);
});

test('registry reserves ownership before synchronous/reentrant work and shares exact promise', { skip: !registrySource }, async () => {
  const registry = makeRegistry(), pending = deferred();
  let nested;
  const first = registry.run('key', () => {
    nested = registry.run('key', () => assert.fail('must not start twice'));
    return pending.promise;
  });
  assert.strictEqual(first, nested);
  pending.resolve('done');
  assert.equal(await first, 'done');
  assert.equal(await registry.run('key', () => 'retry'), 'retry');
});

test('registry invalidation is scoped, generation-safe and repeatable', { skip: !registrySource }, async () => {
  const registry = makeRegistry(), a = deferred(), b = deferred();
  let isA, isB;
  const pa = registry.run('a', current => { isA = current; return a.promise; });
  const pb = registry.run('b', current => { isB = current; return b.promise; });
  registry.invalidate(key => key === 'a');
  assert.equal(isA(), false);
  assert.equal(isB(), true);
  assert.strictEqual(registry.run('b', noop), pb);
  registry.dispose();
  registry.dispose();
  assert.equal(isB(), false);
  await assert.rejects(registry.run('new', () => assert.fail('disposed start')), /disposed/);
  a.resolve('a'); b.reject(new Error('b'));
  assert.equal(await pa, 'a');
  await assert.rejects(pb, /b/);
});

test('registry synchronous throws settle and release the key', { skip: !registrySource }, async () => {
  const registry = makeRegistry(), error = new Error('sync');
  await assert.rejects(registry.run('key', () => { throw error; }), candidate => candidate === error);
  assert.equal(await registry.run('key', () => 42), 42);
});


test('actual track presentation invalidation cannot let old cleanup remove a returning-track request', async () => {
  const h = harness(), old = h.start();
  await flush();
  // Stop presentation after its real track-reset block, at the external first-language prompt.
  h.context.window.ivLyricsFirstLanguagePrompt = { maybePrompt: () => ({ finally: noop }) };
  const present = next => {
    h.container.state = { ...h.container.state, ...next };
    h.context.Container.prototype.lyricsSource.call(h.container, next, 0);
  };
  present({ ...state, uri: 'spotify:track:two' });
  present(state);
  const current = h.start();
  await flush();
  assert.equal(h.requests.length, 2);
  h.settle(h.requests[0], 'old');
  await old;
  const duplicate = h.start();
  await flush();
  assert.equal(h.requests.length, 2);
  h.settle(h.requests[1], 'new');
  const [a, b] = await Promise.all([current, duplicate]);
  assert.strictEqual(a, b);
  assert.equal(h.cacheWrites.length, 1);
});

test('Gemini dedupe retains provider/mode/track cache-key boundaries and scoped invalidation', async () => {
  const h = harness();
  const pending = [
    h.start(),
    h.start('gemini', 'gemini_romaji'),
    h.start('gemini', 'gemini_korean', { ...state, provider: 'other' }),
    h.start('gemini', 'gemini_korean', { ...state, uri: 'spotify:track:two' }),
  ];
  await flush();
  assert.equal(h.requests.length, 4);
  h.container.resetTranslationCache(state.uri);
  const otherDuplicate = h.start('gemini', 'gemini_korean', { ...state, uri: 'spotify:track:two' });
  await flush();
  assert.equal(h.requests.length, 4, 'reset must not invalidate a different track');
  h.requests.forEach(request => h.settle(request));
  const results = await Promise.all(pending);
  assert.strictEqual(await otherDuplicate, results[3]);
  assert.equal(h.cacheWrites.length, 1, 'only the other track still owns its cache entry');
});


const settingsSource = process.env.IVLYRICS_REQUEST_TEST_REVISION
  ? execFileSync('git', ['show', `${process.env.IVLYRICS_REQUEST_TEST_REVISION}:Settings.js`], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  })
  : readFileSync(new URL('../Settings.js', import.meta.url), 'utf8');

for (const scope of ['All', 'Current']) {
  for (const mounted of [true, false]) {
    test(`settings clear ${scope}: persistent cache, stats and reload work with ${mounted ? 'active' : 'absent'} page`, async () => {
      const h = harness(), calls = [], errors = [];
      const other = { ...state, uri: `${state.uri}More` };
      const pending = mounted ? [
        h.start(), h.start('traditional'),
        h.start('gemini', 'gemini_korean', other), h.start('traditional', '', other),
      ] : [];
      await flush();
      const context = vm.createContext({
        window: {
          lyricContainer: mounted ? h.container : undefined,
          CacheManager: h.context.CacheManager,
          CACHE: { [state.uri]: 'current', [other.uri]: 'other' },
          SyncDataService: { clearCache: (...args) => calls.push(['sync', ...args]) },
        },
        console: { error: (...args) => errors.push(args) },
        useState: initial => [initial, noop], useEffect: noop, getSafeSettingsLocale: () => 'en',
        Spicetify: { Player: { data: { item: { uri: state.uri } } } },
        LyricsCache: {
          clearAll: async () => calls.push(['clearAll']),
          clearTrack: async id => calls.push(['clearTrack', id]),
          getStats: async () => { calls.push(['stats']); return {}; },
        },
        reloadLyrics: value => calls.push(['reload', value]),
        I18n: { t: key => key }, Toast: { success: value => calls.push(['success', value]), error: noop },
      });
      const start = settingsSource.indexOf('const LocalCacheManager = () => {');
      const end = settingsSource.indexOf('  // 통계 문자열 생성', start);
      assert.ok(start >= 0 && end > start);
      vm.runInContext(settingsSource.slice(start, end)
        + '\nreturn { handleClearAll, handleClearCurrent }; }; globalThis.api = LocalCacheManager();', context);
      await context.api[`handleClear${scope}`]();
      assert.deepEqual(errors, [], 'settings handler must not swallow a registry API error');
      assert.deepEqual(calls.slice(1, 4), [
        scope === 'All' ? ['clearAll'] : ['clearTrack', 'one'], ['stats'], ['reload', false],
      ]);
      assert.equal(calls.at(-1)[0], 'success');
      assert.equal(context.window.CACHE[state.uri], undefined);
      assert.equal(context.window.CACHE[other.uri], scope === 'All' ? undefined : 'other');
      if (mounted && scope === 'Current') {
        pending.push(h.start('gemini', 'gemini_korean', other), h.start('traditional', '', other));
        await flush();
        assert.equal(h.requests.length, 4, 'clearing current must retain the other track dedupe entries');
      }
      h.requests.forEach(request => h.settle(request));
      await Promise.all(pending);
      assert.equal(h.cacheWrites.length, mounted && scope === 'Current' ? 2 : 0,
        'invalidated results must not repopulate the cleared cache');
    });
  }
}
