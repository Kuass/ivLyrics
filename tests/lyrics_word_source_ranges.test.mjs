import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Run the same assertions against an unchanged checkout with IVLYRICS_SOURCE_DIR.
// Only the segmenter and exact consumer helper slices execute, with no app,
// provider, network, storage, or installer initialization.
const sourceDir = resolve(process.env.IVLYRICS_SOURCE_DIR
  || fileURLToPath(new URL('../', import.meta.url)));
const read = name => readFileSync(resolve(sourceDir, name), 'utf8');
const slice = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Missing source helper: ${from}`);
  return source.slice(start, end);
};
const plain = value => JSON.parse(JSON.stringify(value));
const context = vm.createContext({ window: {}, console, navigator: { language: 'en' } });
vm.runInContext(`${read('TinySegmenter.js')}\n${read('LyricsWordSegmenter.js')}`, context);
context.window.LyricsWordSegmenter = context.LyricsWordSegmenter;
vm.runInContext([
  'const SYNC_CREATOR_GRANULARITIES = new Set(["line", "word", "character"]);',
  'const SYNC_CREATOR_DEFAULT_GRANULARITY = "character";',
  slice(read('SyncDataCreator.js'), 'const isFiniteSyncCreatorTime =', 'const normalizeSyncCreatorTimeSequence ='),
  slice(read('Pages.js'), 'const KARAOKE_WHITESPACE_CHAR_REGEX =', 'const getKaraokeInlineStylePresentation ='),
  'globalThis.consumer = { getSyncCreatorWordRanges, collapseSyncCreatorTimesByGranularity,',
  'encodeSyncCreatorCompactTiming, decodeSyncCreatorCompactTiming, assignKaraokeWordIndexes };',
  'globalThis.utils = {',
  slice(read('Utils.js'), '  PRONUNCIATION_SEGMENT_SEPARATOR:', '  rubyTextToHTML(s) {'),
  '};',
].join('\n'), context);
const api = context.LyricsWordSegmenter;
const consumer = context.consumer;
const utils = context.utils;

const fixtures = [
  ['first word punctuation', 'hello ! world', 'en', ['hello !', 'world']],
  ['middle word punctuation', 'one two ! three four', 'en', ['one', 'two !', 'three', 'four']],
  ['last word punctuation', 'one two three !', 'en', ['one', 'two', 'three !']],
  ['all words have punctuation', 'hello ! world ?', 'en', ['hello !', 'world ?']],
  ['repeated words', 'hello ! hello! world', 'en', ['hello !', 'hello!', 'world']],
  ['repeated attached words', 'hello ! hello ! hello!', 'en', ['hello !', 'hello !', 'hello!']],
  ['spaced opening punctuation', '( hello ) world', 'en', ['( hello )', 'world']],
  ['opening after a word', 'say ( hello ) now', 'en', ['say', '( hello )', 'now']],
  ['pending opener before punctuation', 'foo ( ! bar', 'en', ['foo', '( ! bar']],
  ['empty cluster before a word', 'hello () world', 'en', ['hello', '() world']],
  ['empty leading cluster', '() world', 'en', ['() world']],
  ['nested cluster', 'hello (( ! yes ) ) world', 'en', ['hello', '(( ! yes ) )', 'world']],
  ['adjacent cluster', 'hello (,yes) world', 'en', ['hello', '(,yes)', 'world']],
  ['dangling opener', 'hello (', 'en', ['hello (']],
  ['dangling empty cluster', 'hello ()', 'en', ['hello ()']],
  ['dangling pending punctuation', 'hello ( !', 'en', ['hello ( !']],
  ['punctuation only', '!?', 'en', ['!?']],
  ['spaced punctuation only', ' ! ? ', 'en', ['! ?']],
  ['pending punctuation only', '( ! )', 'en', ['( ! )']],
  ['nested punctuation only', '(( ))', 'en', ['(( ))']],
  ['spaced curly quotes', 'say “ hello ” now', 'en', ['say', '“ hello ”', 'now']],
  ['adjacent curly quotes', 'say “hello” now', 'en', ['say', '“hello”', 'now']],
  ['adjacent parentheses', '(hello) world', 'en', ['(hello)', 'world']],
  ['contraction and repeated spaces', "Hello,  don't go away!", 'en', ['Hello,', "don't", 'go', 'away!']],
  ['curly apostrophe', 'don’t go', 'en', ['don’t', 'go']],
  ['spaced dash', 'hello - world', 'en', ['hello -', 'world']],
  ['lexical hyphen coverage', 'sing-along forever', 'en', ['sing-', 'along', 'forever']],
  ['embedded ZWJ coverage', 'hi👨‍👩‍👧‍👦world', 'en', ['hi👨‍👩‍👧‍👦', 'world']],
  ['leading ZWJ coverage', '👨‍👩‍👧‍👦hello world', 'en', ['👨‍👩‍👧‍👦hello', 'world']],
  ['trailing ZWJ coverage', 'hello👨‍👩‍👧‍👦 world', 'en', ['hello👨‍👩‍👧‍👦', 'world']],
  ['standalone ZWJ', 'hi 👨‍👩‍👧‍👦 world', 'en', ['hi', '👨‍👩‍👧‍👦', 'world']],
  ['ZWJ spaced punctuation', 'hi 👨‍👩‍👧‍👦 ! world', 'en', ['hi', '👨‍👩‍👧‍👦 !', 'world']],
  ['astral symbol boundaries', 'hi😀world', 'en', ['hi', '😀', 'world']],
  ['pending prefix before symbol', 'hello ( + world', 'en', ['hello', '( +', 'world']],
  ['decomposed accent', 'cafe\u0301 world', 'fr', ['cafe\u0301', 'world']],
  ['decomposed accent punctuation', 'cafe\u0301 ! world', 'fr', ['cafe\u0301 !', 'world']],
  ['astral Han punctuation', '𠀀 ！ 世界', 'zh', ['𠀀 ！', '世界']],
  ['Chinese adjacent punctuation', '你好，世界！再见', 'zh', ['你', '好，', '世界！', '再见']],
  ['Chinese spaced punctuation', '你好 ， 世界', 'zh', ['你', '好 ，', '世界']],
  ['Chinese aspect and protected words', '我们一起唱过歌了', 'zh', ['我们', '一起', '唱', '过', '歌', '了']],
  ['Chinese repeated and localizer words', '看看我的心里面', 'zh', ['看', '看', '我', '的', '心', '里面']],
  ['Japanese morphology', '夢ならばどれほどよかったでしょう', 'ja', ['夢', 'なら', 'ばどれ', 'ほど', 'よかった', 'でしょ', 'う']],
  ['Japanese suffix', '私は歌っている', 'ja', ['私', 'は', '歌って', 'いる']],
  ['Japanese mixed scripts', 'カタカナABC123の歌', 'ja', ['カタカナ', 'ABC123', 'の', '歌']],
  ['Japanese adjacent punctuation', '「こんにちは」世界', 'ja', ['「こん', 'にち', 'は」', '世界']],
  ['Japanese spaced punctuation', '「 こんにちは 」 世界', 'ja', ['「 こん', 'にち', 'は 」', '世界']],
  ['Japanese astral grapheme cuts', '𠀀の世界', 'ja', ['𠀀', 'の', '世界']],
  ['Japanese ZWJ grapheme cuts', '👨‍👩‍👧‍👦', 'ja', ['👨‍👩‍👧‍👦']],
  ['Chinese symbol-only lexical run', '👨‍👩‍👧‍👦', 'zh', ['👨‍👩‍👧‍👦']],
  ['Thai words', 'สวัสดีชาวโลก', 'th', ['สวัสดี', 'ชาว', 'โลก']],
  ['Korean punctuation', '안녕 ! 세상아', 'ko', ['안녕 !', '세상아']],
  ['Arabic punctuation', 'مرحبا ، عالم', 'ar', ['مرحبا ،', 'عالم']],
  ['repeated whitespace', '  hello  world\t again  ', 'en', ['hello', 'world', 'again']],
  ['no text', '', 'en', []],
  ['only whitespace', '  \t ', 'en', []],
  ...[['ASCII space', ' '], ['NBSP', '\u00a0'], ['narrow NBSP', '\u202f']].map(([label, gap]) => [
    `French ${label}`, `Bonjour${gap}! Comment ça va${gap}?`, 'fr', [`Bonjour${gap}!`, 'Comment', 'ça', `va${gap}?`],
  ]),
];

function expectedRanges(text, words) {
  let cursor = 0;
  return words.map(word => {
    const start = text.indexOf(word, cursor);
    assert.ok(start >= cursor, `Invalid fixture word: ${word}`);
    cursor = start + word.length;
    return { start, end: cursor, text: word };
  });
}

for (const [label, text, locale, words] of fixtures) {
  const expected = expectedRanges(text, words);
  const graphemes = [...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)];
  const boundaries = new Set([text.length, ...graphemes.map(item => item.index)]);

  test(`${label}: exact ordered source ranges cover whole graphemes`, () => {
    const ranges = plain(api.segmentRanges(text, locale));
    assert.deepEqual(ranges, expected);
    assert.deepEqual(plain(api.segmentLyrics(text, locale)), ranges.map(range => range.text));
    let cursor = 0;
    let reconstructed = '';
    for (const range of ranges) {
      assert.ok(Number.isInteger(range.start) && Number.isInteger(range.end));
      assert.ok(cursor <= range.start && range.start < range.end && range.end <= text.length);
      assert.ok(boundaries.has(range.start) && boundaries.has(range.end));
      assert.equal(range.text, text.slice(range.start, range.end));
      assert.match(text.slice(cursor, range.start), /^\s*$/u);
      reconstructed += text.slice(cursor, range.start) + range.text;
      cursor = range.end;
    }
    assert.match(text.slice(cursor), /^\s*$/u);
    assert.equal(reconstructed + text.slice(cursor), text);
    for (const item of graphemes.filter(item => /\S/u.test(item.segment))) {
      assert.equal(ranges.filter(range => range.start <= item.index
        && item.index + item.segment.length <= range.end).length, 1);
    }
  });

  test(`${label}: actual Pages word indexes retain every source glyph`, () => {
    const timed = graphemes.map((item, index) => ({
      char: item.segment, startTime: index * 100, endTime: (index + 1) * 100,
      karaokeUnitIndex: Math.floor(index / 2),
    }));
    const expectedIndexes = graphemes.map(item => {
      const index = expected.findIndex(range => item.index >= range.start && item.index < range.end);
      return index < 0 ? null : index;
    });
    assert.deepEqual(plain(consumer.assignKaraokeWordIndexes(timed, false, locale)),
      timed.map((char, index) => ({ ...char, karaokeWordIndex: expectedIndexes[index] })));
  });

  test(`${label}: actual creator keeps word timing through compact encode/decode`, () => {
    const chars = Array.from(text);
    const starts = expected.map(range => Array.from(text.slice(0, range.start)).length);
    const expectedCreator = starts.length ? starts.map((start, index) => ({
      start: index === 0 ? 0 : start,
      end: index + 1 < starts.length ? starts[index + 1] - 1 : chars.length - 1,
    })) : chars.length ? [{ start: 0, end: chars.length - 1 }] : [];
    const times = chars.map((_, index) => index + 1);
    const expectedTimes = [...times];
    expectedCreator.forEach(range => expectedTimes.fill(times[range.start], range.start, range.end + 1));
    const encoded = consumer.encodeSyncCreatorCompactTiming({ granularity: 'word', chars: times }, chars, locale);
    const decoded = consumer.decodeSyncCreatorCompactTiming(encoded, chars.length);
    const actual = {
      ranges: consumer.getSyncCreatorWordRanges(chars, locale),
      collapsed: consumer.collapseSyncCreatorTimesByGranularity(times, chars, 'word', locale),
      encoded,
      decoded,
    };
    const expectedEncoded = { granularity: 'word', timing: expectedCreator.map(range => [range.end, times[range.start]]) };
    assert.deepEqual(plain(actual), {
      ranges: expectedCreator, collapsed: expectedTimes, encoded: expectedEncoded,
      decoded: chars.length ? { granularity: 'word', chars: expectedTimes } : expectedEncoded,
    });
    assert.equal(expectedCreator.map(range => chars.slice(range.start, range.end + 1).join('')).join(''), text);
  });

  test(`${label}: actual Utils reconstruction and pronunciation request retain source`, () => {
    const segments = plain(utils.segmentTextForPronunciation(text));
    const reconstruction = segments.map(segment => segment.text + segment.gap).join('');
    const request = utils.buildPronunciationRequestText(text);
    assert.deepEqual({ reconstruction, request, words: segments.map(segment => segment.text) }, {
      reconstruction: text.trim(), request: words.length < 2 ? text.trim() : words.join('｜'), words,
    });
    let cursor = 0;
    for (const segment of segments) {
      assert.equal(text.trim().slice(cursor, cursor + segment.text.length), segment.text);
      cursor += segment.text.length;
      assert.equal(text.trim().slice(cursor, cursor + segment.gap.length), segment.gap);
      cursor += segment.gap.length;
    }
  });
}

test('French pronunciation reply keeps complete validated inline alignment', () => {
  const text = 'Bonjour ! Comment ça va ?';
  const result = utils.splitInlinePronunciation(text, 'bonjour｜comment｜ça｜va');
  assert.equal(result.text, 'bonjour comment ça va');
  assert.deepEqual(plain(result.segments), [
    { text: 'Bonjour !', gap: ' ', pronunciation: 'bonjour' },
    { text: 'Comment', gap: ' ', pronunciation: 'comment' },
    { text: 'ça', gap: ' ', pronunciation: 'ça' },
    { text: 'va ?', gap: '', pronunciation: 'va' },
  ]);
  assert.deepEqual(plain(utils.getInlinePronunciationSegments(text, result.text, result.segments)), plain(result.segments));
  assert.equal(utils.splitInlinePronunciation(text, 'bonjour｜va').segments, null);
});

test('explicit source-word units still bypass lexical segmentation in Pages', () => {
  const timed = [
    { char: 'Bonjour', startTime: 1, karaokeUnitIndex: 10 },
    { char: ' ', startTime: 2, karaokeUnitIndex: 10 },
    { char: '!', startTime: 3, karaokeUnitIndex: 10 },
    { char: '世界', startTime: 4, karaokeUnitIndex: 20 },
  ];
  const segmentRanges = context.window.LyricsWordSegmenter.segmentRanges;
  context.window.LyricsWordSegmenter = { segmentRanges: () => { throw new Error('Unexpected segmentation'); } };
  try {
    assert.deepEqual(plain(consumer.assignKaraokeWordIndexes(timed, true, 'fr')),
      timed.map((char, index) => ({ ...char, karaokeWordIndex: [0, null, 0, 1][index] })));
  } finally {
    context.window.LyricsWordSegmenter = { ...api, segmentRanges };
  }
});

test('valid Japanese tokenizer seam retains morphology across spaced punctuation', () => {
  const segmenter = api.createLyricsSegmenter({ locale: 'ja', tokenizer: {
    tokenize(text) {
      assert.equal(text, '歌った');
      return [{ surface: '歌', pos: 'verb' }, { surface: 'った', pos: 'auxiliary' }];
    },
  } });
  assert.deepEqual(plain(segmenter.segmentLyrics('「 歌った 」')), ['「 歌った 」']);
  assert.deepEqual(plain(segmenter.segmentRanges('「 歌った 」')), [{ start: 0, end: 7, text: '「 歌った 」' }]);
});
