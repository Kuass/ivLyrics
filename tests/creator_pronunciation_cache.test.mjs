import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test, after } from 'node:test';
import {
  harness, runCase, sourceManifest, A, B, AResult, BResult, makeResult, plain,
} from './helpers/creator_pronunciation_cache_harness.mjs';

const observations = [];
after(() => {
  if (process.env.IVLYRICS_PRONUNCIATION_REPORT) {
    writeFileSync(process.env.IVLYRICS_PRONUNCIATION_REPORT,
      JSON.stringify({ sources: sourceManifest(), observations }, null, 2) + '\n');
  }
});
const retiredHits = [
  { name: 'target-change-hit-to-miss', change: 'target' },
  { name: 'source-change-hit-to-miss', change: 'source' },
  { name: 'source-and-target-change-hit-to-miss', change: 'both' },
  { name: 'target-change-open-completed', change: 'target', openBeforeActions: true },
  { name: 'source-change-open-completed', change: 'source', openBeforeActions: true },
];
const cases = [
  { name: 'stable-current-hit' },
  ...retiredHits,
  { name: 'target-change-auto-only', change: 'target', manual: false },
  { name: 'source-change-auto-only', change: 'source', manual: false },
  { name: 'target-change-current-hit', change: 'target', newHit: true },
  { name: 'source-change-current-hit', change: 'source', newHit: true },
  { name: 'stable-current-cache-miss', oldHit: false },
  { name: 'stable-current-incompatible-cache', invalidOld: true },
  { name: 'same-language-target-change', change: 'target', translationLanguage: 'en' },
  { name: 'target-change-old-miss-current-miss', change: 'target', oldHit: false },
  { name: 'source-change-old-miss-current-miss', change: 'source', oldHit: false },
  { name: 'target-change-old-miss-current-hit', change: 'target', oldHit: false, newHit: true },
  { name: 'source-change-old-miss-current-hit', change: 'source', oldHit: false, newHit: true },
  { name: 'same-source-overlapping-hit-toggles', manualCount: 2 },
  { name: 'same-source-overlapping-miss-toggles', manualCount: 2, oldHit: false },
  { name: 'target-A-B-A-return', change: 'target-roundtrip' },
  { name: 'source-A-B-A-return', change: 'source-roundtrip' },
];

function common(result, { consent = false, readings = [], providerChecks = 0 } = {}) {
  assert.equal(result.final.generating, false);
  assert.equal(result.final.consent, consent);
  assert.equal(result.final.buttonDisabled, false);
  assert.equal(result.final.selectorDisabled, false);
  assert.deepEqual(result.toasts, []);
  assert.equal(result.trace.filter(event => event.event === 'provider-availability').length, providerChecks);
  assert.equal(result.final.visible, readings.length > 0);
  assert.deepEqual(result.final.renderedReadings, readings);
  assert.equal(result.final.buttonLabel, readings.length ? 'Hide Pronunciation' : 'AI Character Pronunciation');
}

for (const args of cases) {
  test(`[ordinary] ${args.name}`, async () => {
    // Every storage success, promise continuation, and transaction completion
    // drains before acceptance assertions, including on an unchanged baseline.
    const result = await runCase(args);
    observations.push(result);
    assert.equal(result.initial.buttonDisabled, false);
    assert.equal(result.afterChange.selectorDisabled, false);
    const isRetiredHit = retiredHits.some(item => item.name === args.name);
    if (isRetiredHit) {
      assert.equal(result.afterChange.visible, false);
      assert.equal(result.stages[0].visible, false, 'retired automatic read stays cancelled');
      common(result);
      assert.equal(result.final.payload, null);
      assert.deepEqual(result.stages[1].renderedReadings, [], 'foreign cached manual hit never reaches the renderer');
      if (args.change === 'source') assert.deepEqual(result.final.renderedGlyphs, ['天', '气']);
    } else if (args.manual === false) {
      common(result);
      assert.equal(result.final.payload, null);
    } else if (args.oldHit === false || args.invalidOld) {
      const readings = args.newHit ? (args.change === 'target' ? ['니', '하오'] : ['tian', 'qi']) : [];
      common(result, { consent: true, readings, providerChecks: args.manualCount || 1 });
      assert.equal(result.stages[0].consent, false);
      assert.equal(result.stages[1].consent, true, 'cache miss retains provider/consent continuation');
    } else if (args.newHit) {
      common(result, { readings: args.change === 'target' ? ['니', '하오'] : ['tian', 'qi'] });
      assert.equal(result.stages[0].visible, false);
      assert.deepEqual(result.stages[1].renderedReadings, [], 'old hit must not transiently replace current readings');
      assert.equal(result.final.compatibility, true);
    } else {
      common(result, { readings: ['ni', 'hao'] });
      assert.equal(result.final.compatibility, true);
      if (args.change?.endsWith('roundtrip')) {
        assert.equal(result.admitted.length, 4);
        assert.equal(result.stages[0].visible, false, 'original automatic A stays retired after return');
        assert.equal(result.stages[1].visible, true, 'original manual A is valid when A is current again');
      }
      if (args.name === 'same-language-target-change') assert.equal(result.admitted.length, 2);
    }
    if (args.manualCount === 2) assert.equal(result.admitted.length, 3);
  });
}

for (const change of ['none', 'target', 'source']) {
  test(`[ordinary] ${change} cache miss retains missing-provider branch`, async () => {
    const result = await runCase({ name: `missing-provider-${change}`, change, oldHit: false, providerAvailable: false });
    observations.push(result);
    assert.equal(result.final.consent, false);
    assert.equal(result.final.visible, false);
    assert.equal(result.final.generating, false);
    assert.equal(result.trace.filter(event => event.event === 'provider-availability').length, 1);
    assert.deepEqual(result.toasts, [{ name: 'error', args: ['No AI provider supports character pronunciation.'] }]);
  });
}

test('[ordinary] a current cached hit does not require a provider', async () => {
  const result = await runCase({ name: 'current-hit-without-provider', providerAvailable: false });
  observations.push(result);
  common(result, { readings: ['ni', 'hao'] });
});

test('[ordinary] already visible compatible pronunciation toggles without another cache read', async () => {
  const h = harness();
  await h.load(A);
  h.seed(h.output.characterPronunciationCacheOptions, AResult);
  await h.open();
  await h.completeNext();
  assert.equal(h.snapshot().visible, true);
  await h.click();
  const hidden = h.snapshot();
  await h.click();
  const final = await h.drain();
  observations.push({ name: 'in-memory-visibility-toggle', hidden, final, trace: h.trace });
  assert.equal(h.reads.length, 1);
  assert.equal(hidden.visible, false);
  assert.equal(final.visible, true);
  assert.deepEqual(final.renderedReadings, ['ni', 'hao']);
  assert.deepEqual(h.toasts, []);
  assert.equal(h.trace.filter(event => event.event === 'provider-availability').length, 0);
});

async function replacementCase({ name, origin = A.plainLyrics, replacement = B.plainLyrics, helper = false, inputs = null }) {
  const a = { ...A, plainLyrics: origin };
  const b = { ...B, plainLyrics: replacement };
  const h = harness({ candidates: [a, b] });
  await h.load(a);
  const capturedOptions = plain(h.output.characterPronunciationCacheOptions);
  h.seed(capturedOptions, makeResult(h.output.lyricsLines[0], ['first', 'second']));
  const pending = h.click();
  if (inputs) h.updateInputs(inputs);
  else if (helper) await h.applySourceAtHelperBoundary(replacement);
  else await h.load(b);
  const currentOptions = plain(h.output.characterPronunciationCacheOptions);
  const currentLines = plain(h.output.lyricsLines);
  await h.open();
  const stages = [];
  while (h.reads.some(q => !q.done)) stages.push(await h.completeNext());
  await pending;
  const final = await h.drain();
  const result = { name, capturedOptions, currentOptions, currentLines, stages, final, trace: h.trace, toasts: h.toasts };
  observations.push(result);
  return result;
}

for (const [name, origin, replacement] of [
  ['NFC-equivalent reload', 'é好', 'e\u0301好'],
  ['LRCLIB load trims outer whitespace', '你好', ' 你好 '],
  ['different LRCLIB candidate with identical lyrics', '你好', '你好'],
]) {
  test(`[compatibility] ${name} preserves a current cached hit`, async () => {
    const result = await replacementCase({ name, origin, replacement });
    assert.deepEqual(result.capturedOptions, result.currentOptions);
    assert.deepEqual(result.currentLines, [origin]);
    assert.equal(result.stages[1].visible, true);
    assert.equal(result.final.compatibility, true);
    common(result, { readings: ['first', 'second'] });
  });
}

test('[helper-boundary] equal fingerprint and options still reject exact-line incompatibility', async () => {
  // applyLoadedLyricsResult preserves spaces; ordinary LRCLIB Load trims them.
  // This verifies the helper boundary, not another ordinary LRCLIB click defect.
  const result = await replacementCase({ name: 'helper-preserved-whitespace', replacement: ' 你好 ', helper: true });
  assert.deepEqual(result.capturedOptions, result.currentOptions);
  assert.deepEqual(result.currentLines, [' 你好 ']);
  common(result);
  assert.equal(result.final.payload, null);
  assert.deepEqual(result.stages[1].renderedReadings, []);
});

for (const [field, inputs] of [
  ['trackKey', { trackId: 'replacement-track' }],
  ['sourceLang', { sourceLanguage: 'ja', trackName: 'Replacement metadata' }],
]) {
  test(`[helper-boundary] current ${field} rejects an otherwise text-compatible old hit`, async () => {
    const result = await replacementCase({ name: `current-${field}`, inputs });
    assert.notEqual(result.capturedOptions[field], result.currentOptions[field]);
    for (const key of Object.keys(result.capturedOptions).filter(key => key !== field)) {
      assert.equal(result.capturedOptions[key], result.currentOptions[key]);
    }
    assert.deepEqual(result.currentLines, [A.plainLyrics]);
    common(result);
    assert.equal(result.final.payload, null);
  });
}

for (const [name, result] of [
  ['wrong glyphs', BResult],
  ['wrong character indexes', { lines: [{ index: 0, chars: [{ i: 1, char: '你', pronunciation: 'ni' }, { i: 0, char: '好', pronunciation: 'hao' }] }] }],
  ['wrong character count', makeResult('你', ['ni'])],
  ['wrong line count', { lines: [...AResult.lines, ...AResult.lines] }],
]) {
  test(`[compatibility] incompatible stored payload: ${name} retains consent path`, async () => {
    const h = harness();
    await h.load(A);
    h.seed(h.output.characterPronunciationCacheOptions, result);
    const pending = h.click();
    await h.open();
    const final = await h.drain();
    await pending;
    const observation = { name: `incompatible-${name}`, final, trace: h.trace, toasts: h.toasts };
    observations.push(observation);
    common(observation, { consent: true, providerChecks: 1 });
    assert.equal(final.payload, null);
  });
}
