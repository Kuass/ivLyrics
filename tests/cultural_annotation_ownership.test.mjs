import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { harness, U, V, words, manifest } from './helpers/cultural_annotation_harness.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const oldNote = ['1. Meaning of Old river proverb'];
const newNote = ['1. Meaning of New city image'];
const otherNote = ['1. Meaning of Other track image'];
const notes = stage => stage.html
  .filter(row => row.className?.includes('culturalNote')).map(row => row.html);
const evidence = [];

// Optional external evidence only; ordinary node --test runs write no files.
after(() => {
  const directory = process.env.IVLYRICS_CULTURAL_EVIDENCE;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'observations.json'), JSON.stringify(evidence, null, 2) + '\n');
  writeFileSync(resolve(directory, 'source-extractions.json'), JSON.stringify(manifest, null, 2) + '\n');
});

test('cultural harness executes complete source units and exact render slices', () => {
  assert.equal(manifest.length, 108);
  for (const unit of manifest) {
    const source = readFileSync(new URL(`../${unit.file}`, import.meta.url), 'utf8');
    assert.ok(unit.end > unit.start, unit.label);
    assert.equal(createHash('sha256').update(source.slice(unit.start, unit.end)).digest('hex'), unit.sha256);
  }
  for (const label of ['selectLyricsProviderForCurrentTrack', 'fetchLyrics', 'lyricsSource',
    'optimizeTranslations', 'requestCulturalAnnotations', 'applyCulturalAnnotations',
    'generateCulturalAnnotations', 'getLyricsFromProviders', 'LyricsProviderSelectButton',
    'LyricsPageRenderer', 'UnsyncedLyricsPage', 'LyricsLineBlock']) {
    assert.ok(manifest.some(unit => unit.label === label), label);
  }
  assert.equal(manifest.filter(unit => unit.kind.startsWith('exact') &&
    !unit.kind.startsWith('exact constructor')).length, 4);
});

function assertDrained(h, final) {
  assert.deepEqual(h.errors, [], 'no captured runtime warnings/errors');
  assert.ok(final.requests.every(request => request.settled), 'all provider work settled');
  assert.deepEqual(final.pendingKeys, [], 'component pending work drained');
  assert.deepEqual(final.inflightKeys, [], 'Translator pending work drained');
  assert.deepEqual(final.lyricsProviderKeys, [], 'lyrics provider pending work drained');
}

// Observe to quiescence before checking expectations. A failed historical witness
// must not skip promise/timer draining or hide its later snapshots and controls.
async function observe(scenario, queued) {
  const h = harness({ queued, enabled: scenario !== 'feature-disabled' });
  const stages = [];
  const capture = label => stages.push(h.snap(label));
  await h.play();
  const initialRequest = [...h.c._culturalAnnotationRequests.values()][0];
  capture('old-source-admitted');
  if (scenario === 'feature-disabled') {
    await h.choose('new');
    capture('new-source-admitted');
  } else if (scenario === 'cached-carry') {
    await h.resolve(0);
    capture('old-source-completed');
    await h.choose('new');
    capture('new-source-pending');
  } else if (scenario === 'same-source') {
    h.c.lastProcessedUri = null;
    await h.rerender();
    capture('same-source-repeated');
    await h.resolve(0);
    h.c.lastProcessedUri = null;
    await h.rerender();
    capture('same-source-cached-repeat');
  } else if (scenario === 'same-source-provider-change') {
    h.context.window.LyricsAddonManager.getLyrics = async (info, override) => {
      h.lyricCalls.push({ uri: info.uri, override, source: 'old' });
      return { uri: info.uri, provider: override, unsynced: words.old.map(text => ({ text })) };
    };
    await h.choose('new');
    capture('new-provider-identical-lines');
    await h.resolve(0);
  } else if (scenario === 'cross-track') {
    await h.play(V);
    capture('other-track-admitted');
    await h.resolve(1);
    await h.resolve(0);
    capture('other-track-after-old-completion');
    await h.play(U);
    capture('original-track-return');
  } else if (scenario.endsWith('reentry')) {
    if (scenario === 'cached-reentry') {
      await h.resolve(0);
      capture('old-source-completed');
    }
    await h.choose('new');
    capture('new-source-admitted');
    await h.choose('old');
    capture('old-source-return');
    await h.resolve(1);
    capture('new-source-completed-after-return');
    if (scenario === 'pending-reentry') {
      await h.resolve(0);
      capture('old-source-completed-after-return');
    }
  } else {
    await h.choose('new');
    capture('new-source-admitted');
    if (scenario === 'track-clear' || scenario === 'all-clear') {
      if (scenario === 'track-clear') h.c.clearCulturalAnnotationsForTrack(U, { updateState: true });
      else h.c.clearAllCulturalAnnotations({ updateState: true });
      await h.settle();
      capture('epoch-cleared');
    }
    if (scenario === 'normal') {
      await h.resolve(0);
      capture('old-first-completed');
      await h.resolve(1);
    } else {
      await h.resolve(1);
      capture('new-first-completed');
      await h.resolve(0);
    }
    capture('both-initial-requests-completed');
  }
  await h.finish();
  capture('fully-drained');
  if (scenario === 'reverse-then-reselect') {
    await h.choose('new');
    await h.finish();
    capture('same-provider-reselected');
  }
  await h.rerender();
  capture('ordinary-rerender-after-drain');
  await h.finish();
  capture('final-drain');
  const initialReturn = await initialRequest;
  const observation = { scenario, queued, stages, initialReturn, events: h.events,
    lyricCalls: h.lyricCalls, cacheReads: h.cacheReads, cacheWrites: h.cacheWrites, errors: h.errors };
  evidence.push(observation);
  return { h, stages, initialReturn, at: label => {
    const stage = stages.find(stage => stage.label === label);
    assert.ok(stage, label);
    return stage;
  } };
}

const scenarios = [
  'reverse', 'reverse-then-reselect', 'normal', 'cached-carry',
  'same-source', 'same-source-provider-change', 'cross-track',
  'track-clear', 'all-clear', 'feature-disabled', 'pending-reentry', 'cached-reentry',
];

for (const queued of [false, true]) {
  for (const scenario of scenarios) {
    test(`cultural source ownership: ${scenario} (${queued ? 'queued' : 'immediate'} state)`, async t => {
      const { h, stages, initialReturn, at } = await observe(scenario, queued);
      const final = stages.at(-1);
      const cleared = scenario === 'track-clear' || scenario === 'all-clear';
      const disabled = scenario === 'feature-disabled';
      const reentry = scenario.endsWith('reentry');
      const same = scenario.startsWith('same-source');
      const finalNote = cleared || disabled ? [] : same || reentry || scenario === 'cross-track' ? oldNote : newNote;
      const expected = {
        'old-source-admitted': [],
        'old-source-completed': oldNote,
        'new-source-admitted': [],
        'new-source-pending': [],
        'old-first-completed': [],
        'new-first-completed': cleared ? [] : newNote,
        'both-initial-requests-completed': cleared ? [] : newNote,
        'same-source-repeated': [],
        'same-source-cached-repeat': oldNote,
        'new-provider-identical-lines': [],
        'other-track-admitted': [],
        'other-track-after-old-completion': otherNote,
        'original-track-return': oldNote,
        'epoch-cleared': [],
        'old-source-return': scenario === 'cached-reentry' ? oldNote : [],
        'new-source-completed-after-return': scenario === 'cached-reentry' ? oldNote : [],
        'old-source-completed-after-return': oldNote,
        'fully-drained': finalNote,
        'same-provider-reselected': newNote,
        'ordinary-rerender-after-drain': finalNote,
        'final-drain': finalNote,
      };

      // Keep ordinary defect assertions separate from preservation controls.
      await t.test('preserves admission, source-specific cache warming and neutral drains', () => {
        assertDrained(h, final);
        assert.equal(final.requests.length, disabled ? 0 : same ? 1 : 2);
        assert.equal(final.epoch, cleared ? 1 : 0);
        assert.equal(h.cacheWrites.length, disabled ? 0 : same ? 1 : 2);
        if (!disabled) {
          if (cleared) assert.equal(initialReturn, null, 'epoch-cleared requests keep their null return');
          else assert.equal(initialReturn.annotations[0].note, 'Meaning of Old river proverb',
            'successful superseded source work still returns its original provider result');
        }
        if (!same && !disabled && scenario !== 'cross-track') {
          assert.equal(new Set(h.cacheWrites.map(write => write.key.at(-1))).size, 2);
        }
        if (scenario === 'reverse') {
          assert.deepEqual(h.events.filter(event => event.event === 'provider-button')
            .map(event => [event.disabled, event.culturalLoading]), [[false, true]]);
          assert.equal(at('new-source-admitted').requests.length, 2);
        }
        if (cleared) assert.deepEqual(final.resultEntries, []);
        if (scenario === 'cross-track') assert.equal(final.resultEntries.length, 2);
        if (same || scenario === 'cross-track' || scenario === 'pending-reentry' ||
          scenario === 'reverse-then-reselect' || cleared || disabled) {
          assert.deepEqual(notes(final), finalNote,
            'matching reuse, explicit refresh and clear/disabled behavior remain available');
        }
      });

      await t.test('every observed stage decorates only its matching source', () => {
        for (const stage of stages) {
          assert.ok(Object.hasOwn(expected, stage.label), stage.label);
          assert.deepEqual(notes(stage), expected[stage.label], stage.label);
          assert.equal(stage.html.filter(row => row.html?.includes('lyrics-cultural-marker')).length,
            expected[stage.label].length, `${stage.label}: marker count`);
          assert.deepEqual(stage.current.flatMap(line => (line?.culturalNote || []).map(note =>
            `${note.marker}. ${note.note}`)), expected[stage.label], `${stage.label}: component lines`);
        }
        if (scenario === 'reverse' || scenario === 'reverse-then-reselect') {
          assert.deepEqual(at('both-initial-requests-completed').resultEntries,
            at('new-first-completed').resultEntries, 'late old result must not evict the accepted new result');
        }
        if (scenario === 'cached-reentry') {
          assert.deepEqual(at('new-source-completed-after-return').resultEntries,
            at('old-source-return').resultEntries, 'late B must not evict the cached A result');
        }
      });
    });
  }
}

test('decoration checks normalized source and indices before another request is admitted', async t => {
  const h = harness();
  t.after(() => h.finish());
  await h.play();
  await h.resolve(0);
  const original = h.c.state.currentLyrics;
  const reused = h.c.applyCulturalAnnotations(original, U);
  assert.strictEqual(reused[0], original[0], 'unchanged annotation preserves line identity');
  const different = words.new.map(text => ({ text, culturalNote: original[0].culturalNote }));
  assert.ok(h.c.applyCulturalAnnotations(different, U).every(line => !line.culturalNote),
    'actual lines are checked even while the previous request remains the admitted owner');
  const moved = [{ text: '[Verse]' }, ...original];
  assert.ok(h.c.applyCulturalAnnotations(moved, U).every(line => !line.culturalNote),
    'indices are part of source identity');
  const normalized = original.map(line => ({ ...line, originalText: `  ${line.originalText}  `,
    text: 'display pronunciation', text2: 'display translation' }));
  assert.strictEqual(h.c.applyCulturalAnnotations(normalized, U)[0].culturalNote, original[0].culturalNote,
    'whitespace and presentation supplements do not create a different source');
  h.CONFIG.visual['cultural-annotations-enabled'] = false;
  assert.ok(h.c.applyCulturalAnnotations(original, U).every(line => !line.culturalNote));
  assert.deepEqual(plain(h.c.applyCulturalAnnotations(null, U)), []);
  assert.equal(h.calls.length, 1, 'decoration never admits provider work');
});

for (const dimension of ['source-language', 'target-language']) {
  test(`defensive identity control: ${dimension} distinguishes same-line requests`, async t => {
    const h = harness();
    t.after(() => h.finish());
    await h.play();
    const firstPromise = [...h.c._culturalAnnotationRequests.values()][0];
    const lines = words.old.map(text => ({ text }));
    if (dimension === 'target-language') h.CONFIG.visual['translate:target-language'] = 'fr';
    const secondPromise = h.c.requestCulturalAnnotations({ lyricsState: h.c.state, lyrics: lines,
      sourceLang: dimension === 'source-language' ? 'fr' : 'en', uri: U });
    await h.settle();
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls.map(call => [call.args.sourceLang, call.args.targetLang]),
      dimension === 'source-language' ? [['en', 'ko'], ['fr', 'ko']] : [['en', 'ko'], ['en', 'fr']]);
    const answer = label => ({ annotations: [{ lineIndex: 0, expression: words.old[0], note: label }], provider: 'inert-ai' });
    await h.resolve(1, answer('Current language'));
    await h.resolve(0, answer('Previous language'));
    assert.equal((await firstPromise).annotations[0].note, 'Previous language', 'successful superseded requests still resolve normally');
    assert.equal((await secondPromise).annotations[0].note, 'Current language');
    await h.finish();
    assertDrained(h, h.snap('final'));
    assert.deepEqual(notes(h.snap('final')), ['1. Current language']);
    assert.match(h.c._culturalAnnotationResults.get(U).key, /^v4:/, 'schema version remains unchanged');
    assert.equal(h.cacheWrites.length, 2);
  });
}

for (const clear of ['track', 'all']) {
  test(`defensive clear control: ${clear} clear permits fresh identical-source admission`, async t => {
    const h = harness({ queued: true });
    t.after(() => h.finish());
    await h.play();
    await h.resolve(0);
    if (clear === 'track') h.c.clearCulturalAnnotationsForTrack(U, { updateState: true });
    else h.c.clearAllCulturalAnnotations({ updateState: true });
    await h.settle();
    assert.deepEqual(notes(h.snap('cleared')), []);
    h.c.lastProcessedUri = null;
    await h.rerender();
    await h.finish();
    assertDrained(h, h.snap('final'));
    assert.deepEqual(notes(h.snap('final')), oldNote, 'fresh request may reuse warmed Translator cache');
    assert.equal(h.calls.length, 1);
  });
}
