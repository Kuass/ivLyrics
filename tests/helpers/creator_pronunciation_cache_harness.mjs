import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Execute the current checkout's production callbacks, store, and renderer.
// IVLYRICS_SOURCE_ROOT is only a read-only source-root override for baseline runs.
// Boundaries below simulate React commits, element objects, and FIFO IndexedDB
// requests. No native React, browser, IndexedDB, or provider is invoked.
const sourceRoot = process.env.IVLYRICS_SOURCE_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(`${sourceRoot}/SyncDataCreator.js`, 'utf8');
const storeSource = readFileSync(`${sourceRoot}/SyncCreatorDraftStore.js`, 'utf8');
const i18nSource = readFileSync(`${sourceRoot}/I18n.js`, 'utf8');
const enSource = readFileSync(`${sourceRoot}/langs/LangEn.js`, 'utf8');
const manifest = [];
export function sourceManifest() {
  return { sourceRoot, files: ['SyncDataCreator.js', 'SyncCreatorDraftStore.js', 'I18n.js', 'langs/LangEn.js'].map(file => ({ file, sha256: createHash('sha256').update(readFileSync(`${sourceRoot}/${file}`)).digest('hex') })), extraction: manifest };
}
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `source boundaries ${start}`);
  const text = source.slice(from, to);
  manifest.push({ start, end, firstLine: source.slice(0, from).split('\n').length,
    lastLine: source.slice(0, to).split('\n').length - 1,
    sha256: createHash('sha256').update(text).digest('hex') });
  return text;
}
const helpers = section('const SYNC_CREATOR_RTL_STRONG_CHAR_REGEX', 'const SyncDataCreator =');
const sourceCallbacks = [
  ['\tconst setProviderValue =', '\tconst setRecordingLockIndexValue ='],
  ['\tconst stripLrclibTimestamp =', '\tconst clearLrclibCandidateState ='],
  ['\tconst isCurrentSyncCreatorSourceChange =', '\t// Reset the editor to a clean'],
  ['\tconst resetSyncCreatorLyricsLoadingState =', '\tconst buildLrclibIdCandidate ='],
].map(args => section(...args)).join('\n');
const derive = [
  ['\tconst lyricsLines =', '\tconst lyricsFullTextChars ='],
  ['\tconst lineCharOffsets =', '\tconst lineIndexByStart ='],
  ['\tconst sessionTrackKey =', '\tconst activeSessionDraftKey ='],
  ['\tconst currentLineStart = lineCharOffsets', '\tconst currentExistingLineData ='],
  ['\tconst currentFullLineChars =', '\tconst getAutoMergeSplitPointsForLine ='],
  ['\tconst currentLineCharRefs =', '\tscoreInputContextRef.current ='],
  ['\tconst currentLineText = currentLineChars.join', '\tconst currentLineDirection ='],
  ['\tconst lyricsLanguage =', '\tconst currentGranularityRanges ='],
  ['\tconst currentLineCharacterPronunciationData =', '\tconst completedLines ='],
  ['\tconst handleCharacterPronunciationToggle =', '\t// Visibility Observer'],
].map(args => section(...args)).join('\n');
const renderers = [
  ['\tconst getLrclibCandidateId =', '\tconst copyLrclibCandidateId ='],
  ['\tconst formatSeconds =', '\tconst syncLinesByStart ='],
  ['\tconst renderCharacterSpan =', '\tconst renderParallelPartLine ='],
  ['\tconst renderCharacterPronunciationTargetControl =', '\tconst renderSourcePanel ='],
].map(args => section(...args)).join('\n');
const toggleButton = section("\t\t\tlyricsLines.length > 0 && react.createElement('button', {\n\t\t\t\tstyle: {", '\t\t\tcharacterPronunciations && react.createElement').trim().replace(/,$/, '');
const sourceButtonStart = source.indexOf("\t\t\t\t\t\t\treact.createElement('button', {\n\t\t\t\t\t\t\t\ttype: 'button',\n\t\t\t\t\t\t\t\tstyle: { ...s.secondaryBtn, opacity: selectedLrclibCandidateKey");
assert.ok(sourceButtonStart > 0);
const sourceButtonEnd = source.indexOf("\n\t\t\t\t\t\t)", sourceButtonStart);
const sourceButton = source.slice(sourceButtonStart, sourceButtonEnd).trim();
const candidateButtons = section('\t\t\tlrclibCandidates.map((candidate, index) => {',
  "\n\t\t),\n\t\tshowLrclibCandidates && react.createElement('div', { style: s.candidatePreview }").trim();
manifest.push({ firstLine: source.slice(0, sourceButtonStart).split('\n').length,
  lastLine: source.slice(0, sourceButtonEnd).split('\n').length,
  kind: 'source-apply-button-expression', sha256: createHash('sha256').update(sourceButton).digest('hex') });

const pronunciationRefs = section('\tconst characterPronunciationCacheRequestRef =', '\tconst scoreTrackerRef =');

const stateNames = ['lyricsText', 'currentLineIndex', 'provider', 'addonId', 'lyrics', 'isLoading', 'error',
  'pendingMultiVocalDecision', 'selectedLrclibCandidateKey', 'previewLrclibCandidateKey', 'mode'];
const stateSource = stateNames.map(name => {
  const line = source.split('\n').find(line => line.startsWith(`\tconst [${name}, `));
  assert.ok(line?.includes('useState('));
  manifest.push({ kind: 'state-declaration', name, sha256: createHash('sha256').update(line).digest('hex') });
  return line;
}).join('\n') + '\n' + section('\tconst [characterPronunciations,', "\tconst [mode, setMode]");
const stateSetters = new Set([...stateSource.matchAll(/const \[\w+, (\w+)\]/g)].map(m => m[1]));
const extraSetters = [...new Set([...sourceCallbacks.matchAll(/\b(set[A-Z]\w*)\(/g)].map(m => m[1]))]
  .filter(name => !stateSetters.has(name) && !['setProviderValue', 'setSelectedLrclibSourceValue'].includes(name));

export const A = { id: 101, candidateKey: 'fixture-A', preferredLyricsSource: 'plain', plainLyrics: '你好', duration: 180 };
export const B = { id: 102, candidateKey: 'fixture-B', preferredLyricsSource: 'plain', plainLyrics: '天气', duration: 180 };
export const makeResult = (text, readings) => ({ lines: [{ index: 0, chars: Array.from(text, (char, i) => ({ i, char, pronunciation: readings[i] })) }] });
export const AResult = makeResult('你好', ['ni', 'hao']);
export const AKoreanResult = makeResult('你好', ['니', '하오']);
export const BResult = makeResult('天气', ['tian', 'qi']);
export const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));

export function harness({ translationLanguage = 'ko', candidates = [A, B], providerAvailable = true } = {}) {
  const trace = [], records = new Map(), reads = [], opens = [], toasts = [], local = new Map([['ivLyrics:visual:language', 'en']]);
  const slots = [], stateSlots = [], effectSlots = [], refSlots = [];
  let hookCursor = 0, stateCursor = 0, effectCursor = 0, refCursor = 0, effects = [], dirty = false, output, closed = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const useMemo = (fn, deps) => {
    const index = hookCursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, value: fn() };
    return slots[index].value;
  };
  const useState = initial => {
    const index = stateCursor++;
    if (!stateSlots[index]) stateSlots[index] = {
      value: typeof initial === 'function' ? initial() : initial,
      set(value) {
        const next = typeof value === 'function' ? value(stateSlots[index].value) : value;
        if (!Object.is(next, stateSlots[index].value)) { stateSlots[index].value = next; dirty = true; }
      },
    };
    return [stateSlots[index].value, stateSlots[index].set];
  };
  const useRef = initial => {
    const index = refCursor++;
    return refSlots[index] ||= { current: initial };
  };
  const useEffect = (fn, deps) => {
    const index = effectCursor++;
    if (!effectSlots[index] || !same(effectSlots[index].deps, deps)) effects.push({ index, fn, deps });
  };
  let context;
  const db = {
    transaction(name, mode) {
      assert.equal(name, 'characterPronunciations');
      assert.equal(mode, 'readonly', 'write transactions prohibited');
      const tx = { id: reads.length + 1, name, mode };
      trace.push({ event: 'transaction', id: tx.id, mode });
      tx.objectStore = store => {
        assert.equal(store, name);
        return { get(key) {
          const request = {}, q = { id: tx.id, key, request, tx, done: false };
          reads.push(q); trace.push({ event: 'get', id: q.id, key });
          return request;
        } };
      };
      return tx;
    },
    close() { closed = true; trace.push({ event: 'close' }); },
  };
  const window = {
    CONFIG: { visual: { 'translate:target-language': translationLanguage } },
    indexedDB: { open(name, version) {
      assert.equal(name, 'ivLyricsSyncCreatorDrafts'); assert.equal(version, 3);
      const request = {}; opens.push(request); trace.push({ event: 'open', name, version });
      return request;
    } },
    AIAddonManager: { get generateCharacterPronunciation() {
      trace.push({ event: 'provider-availability' });
      return providerAvailable ? () => assert.fail('provider invocation prohibited') : undefined;
    } },
    SyncDataService: { async getSyncData() { trace.push({ event: 'inert-sync-data-read' }); return null; } },
  };
  const base = {
    window, useMemo, useState, useRef, useCallback: (fn, deps) => useMemo(() => fn, deps), useEffect,
    localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => { local.set(key, String(value)); trace.push({ event: 'local-setting', key, value }); } },
    console: { warn: (...args) => trace.push({ event: 'warn', message: args.join(' ') }), error: (...args) => { throw new Error(args.join(' ')); } },
    sourceLanguage: 'zh',
    Utils: { getDetectedLanguage: () => context.sourceLanguage },
    trackId: 'fixture-track', trackIsrc: '', trackUri: 'spotify:track:fixture-track', trackName: 'Fixture', artistName: 'Artist', albumName: '',
    lrclibCandidates: candidates,
    activeParallelPart: null, currentLineMergedWithNext: false, currentMergedLineIndexes: [],
    currentLineSyllableSegments: [], currentLineStyleRanges: [], currentLineFuriganaMap: new Map(),
    currentWordBoundaryStartIndexes: new Set(), currentSpeakerTextColor: 'black',
    isCharSynced: () => false, getCharSyncTime: () => null, currentRecordingCharIndex: -1,
    isRecordingLockArmed: false, recordingLockIndex: -1, currentLockedPlaybackIndex: null,
    currentLinePreviewIndex: -1, syncGranularity: 'character', useCurrentLineTextRun: false,
    TOSS_BLUE: 'blue', TOSS_BLUE_SOFT: 'lightblue',
    s: { secondaryBtn: {}, charPronunciation: { role: 'pronunciation' }, charWordPronunciation: { role: 'pronunciation' } },
    react: { createElement: (tag, props, ...children) => ({ tag, props, children }) },
    Toast: Object.fromEntries(['error','success','warning','progress','dismissProgress'].map(name => [name, (...args) => toasts.push({ name, args })])),
    clearTimeout() { assert.fail('unexpected timer'); },
  };
  for (const [, name] of (sourceCallbacks + derive + renderers).matchAll(/\b(\w+Ref)\.current/g)) base[name] ??= { current: 0 };
  Object.assign(base, { latestSessionRecordRef: { current: null }, sessionAutosaveEnabledRef: { current: false },
    sessionAutosaveTimerRef: { current: null }, scorePendingEffectsRef: { current: new Set() }, charElementsRef: { current: [] } });
  for (const name of extraSetters) base[name] = value => { trace.push({ event: 'other-setter', name }); };
  context = vm.createContext(base);
  vm.runInContext(enSource, context, { filename: 'shipping-LangEn.js' });
  vm.runInContext(i18nSource, context, { filename: 'shipping-I18n.js' });
  context.I18n = window.I18n;
  vm.runInContext(storeSource, context, { filename: 'shipping-SyncCreatorDraftStore.js' });
  context.syncCreatorDraftStore = window.SyncCreatorDraftStore;
  vm.runInContext(helpers, context, { filename: 'shipping-SyncDataCreator-helpers.js' });
  vm.runInContext(`globalThis.renderShippingSections = () => {
    ${stateSource}
    ${pronunciationRefs}
    ${sourceCallbacks}
    ${derive}
    ${renderers}
    return {
      button: (${toggleButton}), target: renderCharacterPronunciationTargetControl(),
      sourceButton: (${sourceButton}), candidates: (${candidateButtons}), cells: renderCurrentLineCharacters(),
      characterPronunciations, showCharacterPronunciations, isGeneratingCharacterPronunciations,
      showCharacterPronunciationConsent, characterPronunciationTargetMode, characterPronunciationCacheOptions,
      lyricsText, lyricsLines, currentLineChars, error, isLoading, selectedLrclibCandidateKey,
      lineData: currentLineCharacterPronunciationData,
      compatibility: isSyncCreatorCharacterPronunciationCompatible(characterPronunciations, lyricsLines),
      sourceCallbacks: { applySelectedLrclibCandidate, applyLoadedLyricsResult, beginSyncCreatorSourceChange },
    };
  };`, context, { filename: 'extracted-shipping-component-sections.js' });
  function render() {
    let turns = 0;
    do {
      assert.ok(++turns < 15, 'finite commits'); dirty = false;
      hookCursor = stateCursor = effectCursor = refCursor = 0; effects = [];
      output = context.renderShippingSections();
      for (const { index, fn, deps } of effects) {
        effectSlots[index]?.cleanup?.();
        effectSlots[index] = { deps, cleanup: fn() };
      }
    } while (dirty);
    return output;
  }
  async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); render(); }
  function snapshot() {
    const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.children)] : [];
    const all = walk(output.cells);
    return plain({ lyrics: output.lyricsText, target: output.characterPronunciationTargetMode,
      targetLanguage: output.characterPronunciationCacheOptions.targetLang,
      cacheOptions: output.characterPronunciationCacheOptions,
      visible: output.showCharacterPronunciations, compatibility: output.compatibility,
      generating: output.isGeneratingCharacterPronunciations, consent: output.showCharacterPronunciationConsent,
      buttonLabel: output.button?.children[0], buttonDisabled: output.button?.props.disabled,
      selectorDisabled: output.target.children[1].props.disabled,
      renderedGlyphs: all.filter(n => n.props?.['data-char-index'] !== undefined).map(n => n.children[0]),
      renderedReadings: all.filter(n => n.props?.style?.role === 'pronunciation').map(n => n.children[0]),
      payload: output.characterPronunciations,
    });
  }
  function seed(options, result) {
    const cacheKey = window.SyncCreatorDraftStore.createCharacterPronunciationCacheKey(options);
    records.set(cacheKey, { cacheVersion: 2, cacheKey, ...plain(options), createdAt: 100, updatedAt: 100, result: plain(result) });
    return cacheKey;
  }
  async function open() {
    await flush(); assert.equal(opens.length, 1, 'shipping store shares one open');
    opens[0].result = db; opens[0].onsuccess(); await flush();
  }
  async function completeNext() {
    const q = reads.find(q => !q.done); assert.ok(q, 'pending FIFO read');
    q.done = true;
    // IDB structured clone crosses into the VM's realm; preserve plain-object validation.
    context.fixtureJson = JSON.stringify(records.get(q.key) ?? null);
    q.request.result = vm.runInContext('JSON.parse(fixtureJson)', context);
    trace.push({ event: 'success', id: q.id, hit: q.request.result !== null });
    q.request.onsuccess();
    // Let promise continuations/commits run after success before the later inert
    // transaction-complete event; finish that transaction before the next read.
    await flush();
    q.tx.oncomplete?.(); trace.push({ event: 'transaction-complete', id: q.id });
    await flush(); return snapshot();
  }
  function click() { assert.equal(output.button.props.disabled, false); const promise = output.button.props.onClick({ type: 'click' }); render(); return promise; }
  function choose(mode) { const selector = output.target.children[1]; assert.equal(selector.props.disabled, false); selector.props.onChange({ target: { value: mode } }); render(); }
  async function load(candidate) {
    const candidateButton = output.candidates.find(node => node.props.key === candidate.candidateKey);
    assert.ok(candidateButton); assert.notEqual(candidateButton.props.disabled, true);
    candidateButton.props.onClick(); render(); assert.equal(output.sourceButton.props.disabled, false);
    const pending = output.sourceButton.props.onClick(); render(); await pending; await flush();
    assert.equal(output.error, null); assert.equal(output.lyricsText, candidate.plainLyrics.trim().normalize('NFC'));
  }
  async function drain() {
    while (reads.some(q => !q.done)) await completeNext();
    await flush();
    assert.equal(reads.filter(q => !q.done).length, 0);
    assert.deepEqual(trace.filter(x => x.event === 'get').map(x => x.id), trace.filter(x => x.event === 'success').map(x => x.id), 'FIFO preserved');
    assert.equal(opens.length, 1);
    assert.equal(trace.filter(x => x.event === 'transaction-complete').length, reads.length);
    const result = snapshot();
    for (const slot of effectSlots) slot?.cleanup?.();
    db.close(); assert.equal(closed, true);
    return result;
  }
  render();
  return { context, trace, reads, toasts, seed, open,
    updateInputs(values) { Object.assign(context, values); render(); },
    async applySourceAtHelperBoundary(text) {
      const callbacks = output.sourceCallbacks;
      await callbacks.applyLoadedLyricsResult({ provider: 'fixture-existing-provider', unsynced: [{ originalText: text, text }] },
        'fixture-existing-provider', callbacks.beginSyncCreatorSourceChange());
      await flush();
    }, completeNext, click, choose, load, flush, drain, snapshot,
    get output() { return output; } };
}

export async function runCase({ name, change = 'none', manual = true, manualCount = 1, oldHit = true, newHit = false, translationLanguage = 'ko', invalidOld = false, openBeforeActions = false, providerAvailable = true }) {
  const h = harness({ translationLanguage, providerAvailable });
  await h.load(A);
  const aKey = h.context.syncCreatorDraftStore.createCharacterPronunciationCacheKey(h.output.characterPronunciationCacheOptions);
  if (oldHit) h.seed(h.output.characterPronunciationCacheOptions, invalidOld ? BResult : AResult);
  if (openBeforeActions) await h.open();
  const initial = h.snapshot();
  const pendingManual = manual ? Array.from({ length: manualCount }, () => h.click()) : [];
  if (change === 'target' || change === 'both') h.choose('translation');
  if (change === 'source' || change === 'both') await h.load(B);
  if (change === 'target-roundtrip') { h.choose('translation'); h.choose('latin'); }
  if (change === 'source-roundtrip') { await h.load(B); await h.load(A); }
  const afterChange = h.snapshot();
  const bOptions = plain(h.output.characterPronunciationCacheOptions);
  if (newHit && change !== 'none') h.seed(bOptions, change === 'target' ? AKoreanResult : BResult);
  if (!openBeforeActions) await h.open();
  else await h.flush();
  const admitted = h.reads.map(({ id, key }) => ({ id, key }));
  const stages = [];
  while (h.reads.some(q => !q.done)) stages.push(await h.completeNext());
  await Promise.all(pendingManual);
  const final = await h.drain();
  return { name, initial, afterChange, aKey, bOptions, admitted, stages, final, trace: h.trace, toasts: h.toasts };
}
