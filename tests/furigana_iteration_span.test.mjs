import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtime, token, unknown, ruby, extractionManifest } from './helpers/furigana_iteration_harness.mjs';

// Manual whole-token readings exercise real converter/Utils/Pages code, not a
// native tokenizer, dictionary or browser. U+3005 continues an already-started
// supported kanji base within one token; admission gates remain independent.
const observations = [];
const fixture = (name, source, tokens, html, options = {}, tokenizations = 1, category = 'compatibility') =>
  ({ name, source, tokens, html, options, tokenizations, category });
const cases = [
  fixture('times', '時々', [token('時々', 'トキドキ')], ruby('時々', 'ときどき'), {}, 1, 'selected-witness'),
  fixture('days', '日々', [token('日々', 'ヒビ')], ruby('日々', 'ひび'), {}, 1, 'selected-witness'),
  fixture('people', '人々', [token('人々', 'ヒトビト')], ruby('人々', 'ひとびと'), {}, 1, 'selected-witness'),
  fixture('mountains', '山々', [token('山々', 'ヤマヤマ')], ruby('山々', 'やまやま'), {}, 1, 'selected-witness'),
  fixture('context-below', 'あ時々に', [unknown('あ'), token('時々', 'トキドキ'), unknown('に')], `あ${ruby('時々', 'ときどき')}に`, { mode: 'below', translation: 'sometimes' }, 1, 'selected-witness'),
  fixture('context-unsynced', '時々は', [token('時々', 'トキドキ'), unknown('は')], `${ruby('時々', 'ときどき')}は`, { unsynced: true }, 1, 'selected-witness'),
  fixture('ordinary whole ruby', '東京', [token('東京', 'トウキョウ')], ruby('東京', 'とうきょう')),
  fixture('ordinary okurigana', '食べる', [token('食べる', 'タベル')], `${ruby('食', 'た')}べる`),
  fixture('ordinary mixed runs', '取り戻す', [token('取り戻す', 'トリモドス')], `${ruby('取', 'と')}り${ruby('戻', 'もど')}す`),
  fixture('repeated base followed by kana in one token', '仄々と', [token('仄々と', 'ホノボノト')], `${ruby('仄々', 'ほのぼの')}と`),
  fixture('separate kana token', '猫は', [token('猫', 'ネコ'), token('は', 'ハ', 'ワ')], `${ruby('猫', 'ねこ')}は`),
  fixture('adjacent repeated words stay separate', '時々人々', [token('時々', 'トキドキ'), token('人々', 'ヒトビト')], `${ruby('時々', 'ときどき')}${ruby('人々', 'ひとびと')}`),
  fixture('iteration token cannot extend prior token', '時々', [token('時', 'トキ'), token('々', 'ドキ')], `${ruby('時', 'とき')}々`),
  fixture('unknown token without reading', '時々', [unknown('時々')], '時々'),
  fixture('known token without reading or pronunciation', '時々', [token('時々', undefined)], '時々'),
  fixture('reading wins over pronunciation', '猫', [token('猫', 'ネコ', 'ニャン')], ruby('猫', 'ねこ')),
  fixture('pronunciation fallback', '猫', [token('猫', undefined, 'ネコ')], ruby('猫', 'ねこ')),
  fixture('whole repeated base with pronunciation fallback', '時々', [token('時々', '', 'トキドキ')], ruby('時々', 'ときどき')),
  fixture('ordinary kana', 'ひらがな', [token('ひらがな', 'ヒラガナ')], 'ひらがな', {}, 0),
  fixture('ascii', 'hello', [unknown('hello')], 'hello', {}, 0),
  fixture('hiragana iteration remains outside admission', 'いすゞ', [token('いすゞ', 'イスズ')], 'いすゞ', {}, 0),
  fixture('katakana iteration remains outside admission', 'イヽ', [token('イヽ', 'イイ')], 'イヽ', {}, 0),
  fixture('mark only remains outside admission', '々', [token('々', 'ドウ')], '々', {}, 0),
  fixture('astral base plus mark remains outside admission', '𠮷々', [token('𠮷々', 'ヨシヨシ')], '𠮷々', {}, 0),
  fixture('vertical mark is a diagnostic control', '時〻', [token('時〻', 'トキドキ')], `${ruby('時', 'ときどき')}〻`, {}, 1, 'diagnostic-only'),
  fixture('sanitization retains ruby while escaping other markup', '<b>時々</b>', [unknown('<b>'), token('時々', 'トキドキ'), unknown('</b>')], `&lt;b&gt;${ruby('時々', 'ときどき')}&lt;/b&gt;`),
  fixture('feature disabled', '時々', [token('時々', 'トキドキ')], '時々', { enabled: false }, 0),
  ...['zh-hans', 'zh-hant', 'en', 'ko', 'ja-JP', '', null].map(language =>
    fixture(`language gate ${String(language)}`, '時々', [token('時々', 'トキドキ')], '時々', { language }, 0)),
  fixture('translation replacement bypasses conversion', '時々', [token('時々', 'トキドキ')], 'sometimes', { mode: 'replace', translation: 'sometimes' }, 0),
  fixture('pronunciation replacement bypasses conversion', '時々', [token('時々', 'トキドキ')], 'custom', { mode: 'replace', phonetic: 'custom' }, 0),
  fixture('replacement without supplements falls back to original', '時々', [token('時々', 'トキドキ')], ruby('時々', 'ときどき'), { mode: 'replace' }),
  fixture('explicit inline pronunciation wins', '時々', [token('時々', 'トキドキ')], '<ruby class="lyrics-pronunciation-ruby">時々<rt>custom</rt></ruby>',
    { mode: 'below', phonetic: 'custom', line: { phoneticSegments: [{ text: '時々', pronunciation: 'custom', gap: '' }] } }, 0),
  fixture('disabled inline pronunciation restores automatic furigana', '時々', [token('時々', 'トキドキ')], ruby('時々', 'ときどき'),
    { mode: 'below', phonetic: 'custom', visual: { 'pronunciation-inline': false }, line: { phoneticSegments: [{ text: '時々', pronunciation: 'custom', gap: '' }] } }),
  // Deliberately malformed boundaries: diagnostic controls, not linguistic oracles.
  fixture('leading mark cannot start a ruby base', '々時', [token('々時', 'カトキ')], `々${ruby('時', 'とき')}`, {}, 1, 'diagnostic-only'),
  fixture('mark after kana cannot start a ruby base', '時あ々', [token('時あ々', 'トキアカ')], `${ruby('時', 'ときあか')}あ々`, {}, 1, 'diagnostic-only'),
  fixture('astral token stays raw beside admitted BMP token', '猫𠮷々', [token('猫', 'ネコ'), token('𠮷々', 'ヨシヨシ')], `${ruby('猫', 'ねこ')}𠮷々`, {}, 1, 'diagnostic-only'),
];
function recordRun(t, name, run, extra = {}) {
  const row = { name, ...extra }; observations.push(row);
  t.after(() => { row.stats = run.drain(); assert.equal(row.stats.pendingTimers, 0); });
  return row;
}
for (const entry of cases) {
  test(`consumer: ${entry.name}`, async t => {
    const run = runtime({ ...entry.options, tokens: entry.tokens });
    const row = recordRun(t, entry.name, run, { category: entry.category, source: entry.source, tokens: entry.tokens, expected: entry.html });
    await run.service.init();
    row.rendered = run.render(entry.source, entry.options); row.repeated = run.render(entry.source, entry.options);
    assert.equal(run.stats().tokenizations.length, entry.tokenizations, 'cache or bypass tokenization count');
    assert.equal(row.rendered.html, entry.html); assert.equal(row.repeated.html, entry.html);
  });
}
for (const source of ['々', '〻', 'ゝ', 'ゞ', 'ヽ', 'ヾ', '𠮷々']) {
  test(`direct admission remains false: ${source}`, async t => {
    const run = runtime({ tokens: [token(source, 'カナ')] }); recordRun(t, `direct admission ${source}`, run);
    await run.service.init();
    assert.equal(run.service.containsKanji(source), false);
    assert.equal(run.service.convertToFurigana(source), source);
    assert.equal(run.context.Utils.applyFuriganaIfEnabled(source), source);
    assert.equal(run.stats().tokenizations.length, 0);
  });
}
for (const mark of ['〻', 'ゝ', 'ゞ', 'ヽ', 'ヾ']) {
  test(`diagnostic: supported base does not absorb ${mark}`, async t => {
    const source = `時${mark}`, run = runtime({ tokens: [token(source, 'トキドキ')] });
    const row = recordRun(t, `other-mark diagnostic ${mark}`, run, { category: 'diagnostic-only' });
    await run.service.init(); row.actual = run.service.convertToFurigana(source);
    assert.equal(row.actual, `${ruby('時', 'ときどき')}${mark}`);
  });
}

test('lifecycle: pre-init output is not cached; shared init, cache hit and clear', async t => {
  const run = runtime({ tokens: [token('時々', 'トキドキ')] }); const row = recordRun(t, 'ready/cache/clear', run);
  assert.equal(run.service.isAvailable(), false); assert.equal(run.render('時々').html, '時々');
  assert.equal(run.stats().tokenizations.length, 0);
  await Promise.all([run.service.init(), run.service.init()]);
  assert.equal(run.stats().builds.length, 1); assert.equal(run.service.isAvailable(), true);
  row.after = run.render('時々').html; row.cached = run.render('時々').html;
  assert.equal(run.stats().tokenizations.length, 1);
  run.service.clearCache(); row.cleared = run.render('時々').html;
  assert.equal(run.stats().tokenizations.length, 2); assert.deepEqual(run.drain().events, ['furigana-ready']);
  for (const value of [row.after, row.cached, row.cleared]) assert.equal(value, ruby('時々', 'ときどき'));
});
test('lifecycle: tokenizer failure does not cache raw output', async t => {
  const run = runtime({ tokens: [token('時々', 'トキドキ')], failTokenize: true });
  const row = recordRun(t, 'tokenizer retry', run);
  await run.service.init(); assert.equal(run.render('時々').html, '時々');
  run.failTokenization(false); row.after = run.render('時々').html;
  assert.equal(run.stats().tokenizations.length, 2); assert.equal(row.after, ruby('時々', 'ときどき'));
});
test('lifecycle: both dictionary build failures stay unready and emit no event', async t => {
  const run = runtime({ failBuild: true }); recordRun(t, 'dictionary failure', run);
  await assert.rejects(run.service.init(), /inert dictionary failure/);
  assert.equal(run.service.isAvailable(), false); assert.equal(run.render('時々').html, '時々');
  assert.equal(run.stats().builds.length, 2); assert.deepEqual(run.drain().events, []);
});
test('lifecycle: missing library can initialize on a later retry', async t => {
  const run = runtime({ tokens: [token('猫', 'ネコ')] }); recordRun(t, 'library retry', run);
  const kuromoji = run.context.window.kuromoji; delete run.context.window.kuromoji;
  await assert.rejects(run.service.init(), /Kuromoji library not loaded/);
  assert.equal(run.service.isAvailable(), false); run.context.window.kuromoji = kuromoji;
  await run.service.init(); assert.equal(run.render('猫').html, ruby('猫', 'ねこ')); assert.equal(run.stats().builds.length, 1);
});
test('missing converter, non-string and empty inputs stay unchanged', t => {
  const run = runtime(); recordRun(t, 'missing/empty', run); run.context.window.FuriganaConverter = undefined;
  assert.equal(run.render('時々').html, '時々');
  for (const value of [null, undefined, '', 0, false, {}, []]) {
    assert.equal(run.service.convertToFurigana(value), value); assert.equal(run.context.Utils.applyFuriganaIfEnabled(value), value);
  }
  assert.equal(run.stats().tokenizations.length, 0);
});
test('feature and language gates still apply after a successful cached conversion', async t => {
  const run = runtime({ tokens: [token('時々', 'トキドキ')] }); const row = recordRun(t, 'cache does not bypass gates', run);
  await run.service.init(); row.enabled = run.render('時々').html;
  run.CONFIG.visual['furigana-enabled'] = false; assert.equal(run.render('時々').html, '時々');
  run.CONFIG.visual['furigana-enabled'] = true; run.context.Utils.setDetectedLanguage(undefined);
  assert.equal(run.render('時々').html, '時々'); run.context.Utils.setDetectedLanguage('ja'); row.restored = run.render('時々').html;
  assert.equal(run.stats().tokenizations.length, 1);
  assert.equal(row.enabled, ruby('時々', 'ときどき')); assert.equal(row.restored, ruby('時々', 'ときどき'));
});
test('missing visual feature setting bypasses the Utils converter', async t => {
  const run = runtime({ tokens: [token('時々', 'トキドキ')] }); recordRun(t, 'missing visual config', run);
  await run.service.init(); run.CONFIG.visual = undefined;
  assert.equal(run.context.Utils.applyFuriganaIfEnabled('時々'), '時々'); assert.equal(run.stats().tokenizations.length, 0);
});
test('karaoke display-mode gate retains the original line object', async t => {
  const run = runtime({ tokens: [token('時々', 'トキドキ')] }); recordRun(t, 'karaoke display-mode bypass', run);
  await run.service.init(); const line = { text: '時々', phoneticText: 'custom', translationText: 'sometimes' };
  const display = run.context.parts.getLyricsDisplayMode(true, line, null, '時々', null);
  assert.equal(display.mainText, line); assert.equal(display.subText, 'custom'); assert.equal(display.subText2, 'sometimes');
  assert.equal(run.stats().tokenizations.length, 0);
});
after(() => {
  if (!process.env.IVLYRICS_FURIGANA_EVIDENCE_DIR) return;
  const directory = resolve(process.env.IVLYRICS_FURIGANA_EVIDENCE_DIR); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'extraction-manifest.json'), JSON.stringify(extractionManifest, null, 2) + '\n');
  writeFileSync(resolve(directory, 'observations.json'), JSON.stringify(observations, null, 2) + '\n');
});
