import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { createHarness, extractionManifest, section, method, A, B, L1, L2, track, plain } from './helpers/prefetch_origin_harness.mjs';

// Ordinary callers exercise the real queue, infoFromTrack, lyric provider manager,
// service wrapper, prefetcher, Translator, cache methods and source-hash protection.
// Seeded reuse/display boundaries below are deliberately classified separately:
// they preserve already-existing work and do not claim that new local AI work succeeds.
const observations = [];
const currentId = A.split(':')[2];
const nextId = B.split(':')[2];
const ai = h => h.trace.filter(e => e.event === 'ai-request');
const flush = () => new Promise(resolve => setImmediate(resolve));
const scenarios = [
  { name: 'local queued translation under stable Spotify', nextUri: L1 },
  { name: 'local nextUp translation under stable Spotify', nextUri: L1, useNextUp: true },
  { name: 'local queued phonetic under stable Spotify', nextUri: L1, visual: { 'translation-mode:english': 'gemini_romaji' } },
  { name: 'local nextUp phonetic under stable Spotify', nextUri: L1, useNextUp: true, visual: { 'translation-mode:english': 'gemini_romaji' } },
  { name: 'local combined translation and phonetic under stable Spotify', nextUri: L1, visual: { 'translation-mode-2:english': 'gemini_romaji' } },
  { name: 'local under stable local playback', nextUri: L1, currentUri: L2 },
  { name: 'local without current playback', nextUri: L1, currentUri: null },
  { name: 'local translation prefetch disabled', nextUri: L1, visual: { 'prefetch-enabled': false } },
  { name: 'local display modes disabled', nextUri: L1, visual: { 'translation-mode:english': 'none' } },
  { name: 'local without local-capable lyric provider', nextUri: L1, localProvider: false },
  { name: 'Spotify under stable Spotify playback', nextUri: B, supported: true },
  { name: 'Spotify under stable local playback', nextUri: B, currentUri: L1, supported: true },
  { name: 'Spotify without current playback', nextUri: B, currentUri: null, supported: true },
  { name: 'Spotify combined modes under local playback', nextUri: B, currentUri: L1, supported: true, both: true, visual: { 'translation-mode-2:english': 'gemini_romaji' } },
  { name: 'Spotify prefetch disabled', nextUri: B, visual: { 'prefetch-enabled': false } },
  { name: 'Spotify display modes disabled', nextUri: B, visual: { 'translation-mode:english': 'none' } },
];

for (const scenario of scenarios) {
  test(`ordinary queue: ${scenario.name}`, async t => {
    const currentUri = Object.hasOwn(scenario, 'currentUri') ? scenario.currentUri : A;
    const h = createHarness(scenario);
    await h.seed(currentId, 'The current song', 'lrclib');
    const seeded = plain([...h.translationStore.values()]);
    await h.queue(scenario.nextUri, scenario.useNextUp);
    await h.drain();
    const own = await h.observedReads(A, 'The current song', 'lrclib');
    const foreignText = await h.observedReads(A, 'The queued local song', 'lrclib');
    const origin = await h.observedReads(scenario.nextUri, 'The queued local song');
    const row = { kind: 'ordinary-queue', scenario, own, foreignText, origin, ...h.snapshot() };
    observations.push(row);
    await t.test('all work drained and current identity stayed fixed', () => {
      assert.ok(Object.values(row.drained).every(n => n === 0));
      assert.equal(row.finalCurrentUri, currentUri);
      assert.equal(h.context.container.currentTrackUri, currentUri);
      assert.ok(row.trace.every(e => e.currentUri === currentUri));
    });
    await t.test('current different-text cache remains intact', () => {
      assert.deepEqual(own.result, { translation: ['Existing current-track translation'] });
      assert.deepEqual(plain(h.translationStore.get(seeded[0].cacheKey)), seeded[0]);
    });
    await t.test('queued text cannot be read under an unrelated current identity', () => {
      assert.equal(foreignText.result, null, 'queued text must not be stored under current Spotify identity');
    });
    await t.test('lyric provider admission and full origin cache are preserved', () => {
      const providers = row.trace.filter(e => e.event === 'lyrics-provider');
      if (scenario.localProvider === false) {
        assert.equal(providers.length, 0);
        assert.deepEqual(row.lyricsCacheKeys, []);
      } else {
        const local = scenario.nextUri.startsWith('spotify:local:');
        assert.deepEqual(providers.map(e => [e.provider, e.info.uri]), [[local ? 'lrclib' : 'spotify', scenario.nextUri]]);
        assert.equal(providers[0].info.title, 'Queued song');
        assert.equal(providers[0].info.artist, 'Fixture artist');
        assert.deepEqual(row.lyricsCacheKeys, [local ? `local-uri:${scenario.nextUri}:lrclib` : `${nextId}:spotify`]);
      }
    });
    await t.test('new AI dispatch uses only a supported origin', () => {
      assert.deepEqual(ai(h).map(e => e.options.trackId), scenario.supported ? Array(scenario.both ? 2 : 1).fill(nextId) : []);
      for (const call of ai(h)) {
        assert.equal(call.options.title, 'Queued song');
        assert.equal(call.options.artist, 'Fixture artist');
        assert.ok(call.options.text.includes('queued'));
      }
      if (scenario.both) assert.deepEqual(ai(h).map(e => e.options.wantSmartPhonetic), [true, false]);
    });
    await t.test('persistent writes retain the supported origin and source hash', () => {
      const newRecords = row.translationRecords.filter(r => r.cacheKey !== seeded[0].cacheKey);
      assert.equal(newRecords.length, scenario.supported ? (scenario.both ? 2 : 1) : 0);
      for (const r of newRecords) {
        assert.equal(r.trackId, nextId);
        assert.ok(r.cacheKey.startsWith(`${nextId}:ko:`));
        assert.ok(r.cacheKey.includes(':spotify:src-'));
      }
      if (scenario.supported) assert.deepEqual(origin.result, { translation: ['fixture translation'] });
      else assert.equal(origin.result, null);
    });
    await t.test('selected admission consequence: no new local display result or completion marker', () => {
      assert.equal(row.displayCache.length, scenario.supported ? (scenario.both ? 2 : 1) : 0);
      for (const [key] of row.displayCache) assert.ok(key.startsWith(`${scenario.nextUri}:spotify:`));
      if (scenario.nextUri.startsWith('spotify:local:')) assert.equal(h.context.prefetch._prefetchCache.size, 0);
    });
    await t.test('selected admission consequence: no unsupported-origin Translator warning', () => {
      assert.equal(row.warnings.length, scenario.localProvider === false ? 1 : 0);
      if (scenario.localProvider === false) assert.ok(row.warnings[0].includes('No lyrics providers enabled'));
    });
  });
}

test('ordinary queue: distinct local URIs retain independent lyric caches without AI aliasing', async () => {
  const h = createHarness();
  await h.queue(L1); await h.drain();
  await h.queue(L2); await h.drain();
  const row = h.snapshot();
  observations.push({ kind: 'ordinary-queue', name: 'two local URIs with equal text and duration', ...row });
  assert.deepEqual(row.lyricsCacheKeys, [`local-uri:${L1}:lrclib`, `local-uri:${L2}:lrclib`]);
  assert.equal(ai(h).length, 0);
  assert.deepEqual(row.translationRecords, []);
  assert.deepEqual(row.displayCache, []);
});

test('ordinary queue gates: queued priority, duplicate suppression and missing metadata', async () => {
  const h = createHarness();
  await h.context.container.onQueueChange({ data: { current: track(A), queued: [track(B)], nextUp: [track(L1)] } });
  await h.drain();
  await h.queue(B); await h.drain();
  await h.queue({ uri: L1 }); await h.drain();
  await h.queue(null); await h.drain();
  observations.push({ kind: 'ordinary-queue', name: 'queue gates', ...h.snapshot() });
  assert.deepEqual(h.trace.filter(e => e.event === 'lyrics-provider').map(e => e.info.uri), [B]);
  assert.deepEqual(ai(h).map(e => e.options.trackId), [nextId]);
  assert.equal(h.context.container.nextTrackUri, B);
});

for (const uri of [L1, B]) {
  test(`ordinary queue video admission is unchanged for ${uri}`, async () => {
    const h = createHarness({ visual: { 'video-background': true, 'prefetch-enabled': false } });
    const video = [];
    h.context.SpotifyDataHelper = { extractSpotifyData: value => ({ name: 'Queued video song', artists: ['Fixture artist'] }) };
    h.window.SyncDataService = { resolveTrackIsrc: async (id, metadata) => { video.push({ id, metadata }); return 'FIXTUREISRC'; } };
    h.context.prefetch._prefetchCache.set('prefetch:video:FIXTUREISRC', { data: {} });
    await h.queue(uri); await h.drain();
    observations.push({ kind: 'ordinary-queue', name: 'video cached boundary', uri, video, ...h.snapshot() });
    assert.deepEqual(video.filter(e => e.metadata.trackName === 'Queued video song').map(e => e.id), uri === B ? [nextId] : []);
    assert.ok(video.every(e => e.id === nextId));
    assert.equal(h.trace.filter(e => e.event === 'lyrics-provider').length, 1);
    assert.equal(ai(h).length, 0);
    assert.equal(h.warnings.length, 0);
  });
}

// Boundary-only fixtures: these maps stand for results/work already present before
// this admission decision. They are not evidence that an ordinary local queue can
// still create a fresh translation or that a running request can be cancelled.
for (const uri of [L1, B]) {
  test(`injected completed-prefetch boundary: ${uri}`, async () => {
    const h = createHarness();
    const info = h.context.container.infoFromTrack(track(uri));
    const lyrics = await h.window.LyricsService.getLyricsFromProviders(info);
    const key = h.context.prefetchKey(lyrics);
    const existing = { timestamp: 123, marker: 'existing completion' };
    h.context.prefetch._prefetchCache.set(key, existing);
    const completedLookups = [];
    const has = h.context.prefetch._prefetchCache.has.bind(h.context.prefetch._prefetchCache);
    h.context.prefetch._prefetchCache.has = value => { completedLookups.push(value); return has(value); };
    const result = await h.context.prefetch._prefetchTranslations(info, lyrics);
    await h.drain();
    observations.push({ kind: 'injected-completed-reuse', uri, key, completedLookups, ...h.snapshot() });
    assert.deepEqual(completedLookups, [key], 'completed-cache lookup runs before unsupported new-work rejection');
    assert.equal(result, undefined);
    assert.equal(h.context.prefetch._prefetchCache.get(key), existing);
    assert.equal(ai(h).length, 0);
    assert.equal(h.translationStore.size, 0);
  });
  test(`injected inflight-prefetch boundary: ${uri}`, async () => {
    const h = createHarness();
    const info = h.context.container.infoFromTrack(track(uri));
    const lyrics = await h.window.LyricsService.getLyricsFromProviders(info);
    const key = h.context.prefetchKey(lyrics);
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    h.context.prefetch._inflightRequests.set(key, pending);
    let settled = false;
    const joined = h.context.prefetch._prefetchTranslations(info, lyrics).then(value => { settled = true; return value; });
    await flush();
    const settledBeforeOwner = settled;
    const sentinel = { existing: 'owner result' };
    finish(sentinel);
    const result = await joined;
    h.context.prefetch._inflightRequests.delete(key); // Inert owner retires its injected registry entry.
    await h.drain();
    observations.push({ kind: 'injected-inflight-reuse', uri, key, settledBeforeOwner, result, ...h.snapshot() });
    assert.equal(settledBeforeOwner, false, 'join remains pending until the existing owner settles');
    assert.equal(result, sentinel, 'existing work result is retained');
    assert.equal(ai(h).length, 0);
    assert.equal(h.translationStore.size, 0);
  });
}

function installDisplayConsumer(h, lyricsState) {
  h.playback.data.item = track(lyricsState.uri);
  h.context.StorageManager = { getPersisted: () => null };
  h.window.Utils.setDetectedLanguage = () => {};
  h.context.consumerState = lyricsState;
  vm.runInContext(`
    ${section('index.js', 'const KARAOKE = 0;', 'const normalizeLyricsRenderModeLock =')}
    ${section('index.js', 'const isTranslationNoteLine =', 'class LyricsContainer extends')}
    const APP_NAME = 'ivLyrics';
    globalThis.consumer = {
      state: consumerState, currentTrackUri: consumerState.uri,
      _lyricsPresentationSeq: 0, _activeLyricsFetchSeq: 0,
      _dmResults: {}, _sharedPresentationKeys: new Map(), updates: [],
      _inflightGemini: { invalidate() {}, run() { throw Error('unexpected cold translation path'); } },
      _inflightTrad: { invalidate() {} },
      setState(update) { this.updates.push(update); this.state = { ...this.state, ...update }; },
      requestCulturalAnnotations() {}, applyCulturalAnnotations(lines) { return lines; },
      ${['isCurrentLyricsUri', 'isCurrentLyricsState', 'resolveLyricsForMode', 'lyricsSource',
        'optimizeTranslations', 'getGeminiTranslation', 'provideLanguageCode', 'getTranslationTargetLanguage'].map(name => method('index.js', name)).join(',\n')}
    };
  `, h.context);
  return h.context.consumer;
}
for (const [uri, mode, injected] of [[L1, 'gemini_korean', true], [L1, 'gemini_romaji', true], [B, 'gemini_korean', false]]) {
  test(`${injected ? 'injected existing display-cache boundary' : 'ordinary Spotify prefetched display consumer'}: ${mode}`, async () => {
    const h = createHarness({ visual: { 'translation-mode:english': mode, 'translate:detect-language-override': 'off' } });
    // Existing local memory is injected independently of the forbidden new-prefetch
    // route. Spotify display data is produced by the ordinary queue above.
    const info = h.context.container.infoFromTrack(track(uri));
    let lyricsState;
    if (injected) {
      lyricsState = await h.window.LyricsService.getLyricsFromProviders(info);
      h.displayStore.set(h.context.displayKey(lyricsState, mode), [{ text: mode === 'gemini_romaji' ? 'fixture reading' : 'fixture translation', originalText: 'The queued local song' }]);
      await h.drain();
    } else {
      await h.queue(uri); await h.drain();
      lyricsState = await h.window.LyricsService.getLyricsFromProviders(info);
    }
    const before = ai(h).length;
    const consumer = installDisplayConsumer(h, lyricsState);
    // Track actual getGeminiTranslation promises so consumption fully settles.
    const requests = [];
    const get = consumer.getGeminiTranslation;
    consumer.getGeminiTranslation = function (...args) { const p = get.apply(this, args); requests.push(p); return p; };
    vm.runInContext('consumer.lyricsSource(consumerState, UNSYNCED);', h.context);
    await Promise.all(requests);
    await flush();
    await h.drain();
    const line = plain(consumer.state.currentLyrics[0]);
    observations.push({ kind: injected ? 'injected-display-consumer' : 'ordinary-display-consumer', uri, mode, line, callsBeforeDisplay: before, ...h.snapshot() });
    assert.equal(requests.length, 1, 'actual lyricsSource invokes actual getGeminiTranslation');
    assert.equal(mode === 'gemini_romaji' ? line.phoneticText : line.translationText, mode === 'gemini_romaji' ? 'fixture reading' : 'fixture translation');
    assert.equal(ai(h).length, before, 'actual display cache reader makes no additional AI request');
    assert.equal(before, injected ? 0 : 1, 'injected local memory needs no AI request; ordinary Spotify prefetch uses one');
    assert.equal(consumer.state.uri, uri);
    assert.equal(h.playback.data.item.uri, uri);
    assert.ok([...h.displayStore.keys()].every(key => key.startsWith(`${uri}:`)));
  });
}

after(() => {
  if (!process.env.IVLYRICS_ORIGIN_EVIDENCE_DIR) return;
  const directory = resolve(process.env.IVLYRICS_ORIGIN_EVIDENCE_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'observations.json'), JSON.stringify(observations, null, 2) + '\n');
  writeFileSync(resolve(directory, 'extraction-manifest.json'), JSON.stringify(extractionManifest, null, 2) + '\n');
});
