import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sources = Object.fromEntries(['index.js', 'Utils.js', 'SyncDataCreator.js', 'Pages.js']
    .map(file => [file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')]));
function section(file, start, end) {
    const source = sources[file];
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `${file}: source boundaries exist`);
    return source.slice(from, to);
}
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const converterSource = section('index.js', 'const FuriganaConverter = (() => {', '\nconst initializeFuriganaConverter =');
const mapperSource = section('Utils.js', '  parseFuriganaMapping(processedText) {', '\n  // Store detected language globally');
const creatorSource = [
    ['const SYNC_CREATOR_KANJI_REGEX =', '\nconst SYNC_CREATOR_JAPANESE_ATTACH_KANA_REGEX'],
    ['\tconst lyricsLines = useMemo(() => {', '\tconst lyricsFullTextChars ='],
    ['\tconst currentLineStart = lineCharOffsets', '\tconst currentExistingLineData ='],
    ['\tconst currentFullLineChars = useMemo(() => {', '\tconst getAutoMergeSplitPointsForLine ='],
    ['\tconst currentLineCharRefs = useMemo(() => {', '\tscoreInputContextRef.current ='],
    ['\tconst currentLineText = currentLineChars.join', '\tconst currentLineDirection ='],
    ['\tconst shouldShowSyncCreatorFurigana =', '\tconst getSyncCreatorFuriganaReact ='],
    ['\tconst currentLineFuriganaMap =', '\tconst currentLineCharacterPronunciationData ='],
    ['\tconst renderCharacterSpan =', '\tconst renderPronunciationUnit ='],
    ['\tconst renderCurrentLineCharacters =', '\tconst renderParallelPartLine ='],
].map(([start, end]) => section('SyncDataCreator.js', start, end)).join('\n');

const plain = surface_form => ({ surface_form });
const rubyToken = (surface_form, reading) => ({ surface_form, reading });
const cat = () => rubyToken('猫', 'ネコ');
const dog = () => rubyToken('犬', 'イヌ');
const ruby = (base, reading) => `<ruby>${base}<rt>${reading}</rt></ruby>`;

// Execute the real converter, creator cell preparation, mapper/caller and renderer.
// Token surfaces/readings and React/hooks are inert fixtures, not native Kuromoji
// generation or browser validation. No dictionary, network, storage or app startup.
async function renderCreator({ raw, tokens = [], ready = true, language = 'ja' }) {
    const tokenizations = [];
    const requests = [];
    class InertXHR {
        open(...args) { requests.push(args); throw new Error('Network prohibited'); }
    }
    const window = {
        kuromoji: { builder: () => ({ build: callback => callback(null, {
            tokenize: text => { tokenizations.push(text); return tokens; },
        }) }) },
        dispatchEvent() { throw new Error('Unexpected event dispatch'); },
    };
    const context = vm.createContext({
        window, XMLHttpRequest: InertXHR, setTimeout: () => 0,
        useMemo: fn => fn(), useCallback: fn => fn,
        lyricsText: raw, lyricsLanguage: language, furiganaRevision: 0,
        currentLineIndex: 0, lineCharOffsets: [0], currentLineMergedWithNext: false,
        currentMergedLineIndexes: [], activeParallelPart: null,
        currentLineStyleRanges: [], normalizeSyncCreatorKind: value => value,
        isCharSynced: () => false, getCharSyncTime: () => null,
        currentRecordingCharIndex: -1, mode: 'edit', isRecordingLockArmed: false,
        recordingLockIndex: -1, currentLockedPlaybackIndex: null, currentLinePreviewIndex: -1,
        currentLineCharacterPronunciationMap: new Map(), usePrimaryCharacterPronunciation: false,
        useFixedPrimaryCharacterCells: false, currentLineRenderedPronunciationUnits: [],
        currentLineRenderedPronunciationUnitByStart: new Map(),
        currentLineRenderedPronunciationCoveredIndexes: new Set(),
        currentWordBoundaryStartIndexes: new Set(), currentSpeakerTextColor: 'black',
        currentSpeakerMutedColor: 'gray', charElementsRef: { current: [] },
        syncGranularity: 'character', useCurrentLineTextRun: false,
        s: { charFuriganaWrap: { role: 'base' }, charFuriganaText: { role: 'reading' } },
        react: { createElement: (tag, props, ...children) => ({ tag, props, children }) },
    });
    vm.runInContext(`${converterSource}\nglobalThis.Utils = {\n${mapperSource}\n};`, context);
    if (ready) await window.FuriganaConverter.init();
    vm.runInContext(`${creatorSource}\nglobalThis.result = {
        chars: currentLineChars, text: currentLineText, map: [...currentLineFuriganaMap],
        nodes: renderCurrentLineCharacters()
    };`, context);
    const result = context.result;
    // A second conversion is cached, and exposes the real converter's HTML for
    // assertions without replacing the converter used by the creator caller.
    result.converted = tokenizations.length ? window.FuriganaConverter.convertToFurigana(result.text) : null;
    if (tokenizations.length) {
        assert.equal(tokens.map(token => token.surface_form).join(''), result.text, 'fixture surfaces preserve the normalized input');
    }
    assert.deepEqual(requests, [], 'no dictionary or network requests');
    return { ...result, tokenizations };
}

const cases = [
    { name: 'BMP baseline', raw: '猫は', tokens: [cat(), plain('は')], html: `${ruby('猫', 'ねこ')}は`, expected: [[0, 'ねこ']] },
    { name: 'BMP kana prefix', raw: 'あ猫は', tokens: [plain('あ'), cat(), plain('は')], html: `あ${ruby('猫', 'ねこ')}は`, expected: [[1, 'ねこ']] },
    { name: 'ASCII prefix', raw: 'A猫は', tokens: [plain('A'), cat(), plain('は')], html: `A${ruby('猫', 'ねこ')}は`, expected: [[1, 'ねこ']] },
    { name: 'emoji prefix keeps the reading on 猫, not は', raw: '😀猫は', tokens: [plain('😀'), cat(), plain('は')], html: `😀${ruby('猫', 'ねこ')}は`, expected: [[1, 'ねこ']] },
    { name: 'emoji prefix keeps the final reading visible', raw: '😀猫', tokens: [plain('😀'), cat()], html: `😀${ruby('猫', 'ねこ')}`, expected: [[1, 'ねこ']] },
    { name: 'two emoji prefixes', raw: '😀😀猫はね', tokens: [plain('😀😀'), cat(), plain('はね')], html: `😀😀${ruby('猫', 'ねこ')}はね`, expected: [[2, 'ねこ']] },
    { name: 'non-emoji astral prefix', raw: '𝄞猫は', tokens: [plain('𝄞'), cat(), plain('は')], html: `𝄞${ruby('猫', 'ねこ')}は`, expected: [[1, 'ねこ']] },
    { name: 'two ruby spans after emoji', raw: '😀猫は犬が', tokens: [plain('😀'), cat(), plain('は'), dog(), plain('が')], html: `😀${ruby('猫', 'ねこ')}は${ruby('犬', 'いぬ')}が`, expected: [[1, 'ねこ'], [3, 'いぬ']] },
    { name: 'emoji between ruby spans', raw: '猫😀犬が', tokens: [cat(), plain('😀'), dog(), plain('が')], html: `${ruby('猫', 'ねこ')}😀${ruby('犬', 'いぬ')}が`, expected: [[0, 'ねこ'], [2, 'いぬ']] },
    { name: 'multi-kanji span after emoji', raw: '😀東京へ', tokens: [plain('😀'), rubyToken('東京', 'トウキョウ'), plain('へ')], html: `😀${ruby('東京', 'とうきょう')}へ`, expected: [[1, 'とう'], [2, 'きょう']] },
    { name: 'BMP 東京 split', raw: '東京へ', tokens: [rubyToken('東京', 'トウキョウ'), plain('へ')], html: `${ruby('東京', 'とうきょう')}へ`, expected: [[0, 'とう'], [1, 'きょう']] },
    { name: 'BMP prefix and 東京/大阪 spans', raw: 'あ東京と大阪へ', tokens: [plain('あ'), rubyToken('東京', 'トウキョウ'), plain('と'), rubyToken('大阪', 'オオサカ'), plain('へ')], html: `あ${ruby('東京', 'とうきょう')}と${ruby('大阪', 'おおさか')}へ`, expected: [[1, 'とう'], [2, 'きょう'], [4, 'おお'], [5, 'さか']] },
    { name: '今日 keeps the existing uneven reading split', raw: '今日かな', tokens: [rubyToken('今日', 'キョウ'), plain('かな')], html: `${ruby('今日', 'きょう')}かな`, expected: [[0, 'き'], [1, 'ょう']] },
    { name: 'two BMP ruby spans', raw: '猫は犬が', tokens: [cat(), plain('は'), dog(), plain('が')], html: `${ruby('猫', 'ねこ')}は${ruby('犬', 'いぬ')}が`, expected: [[0, 'ねこ'], [2, 'いぬ']] },
    { name: 'emoji suffix', raw: '猫は😀', tokens: [cat(), plain('は😀')], html: `${ruby('猫', 'ねこ')}は😀`, expected: [[0, 'ねこ']] },
    { name: 'NFD accent composes before indexing', raw: 'e\u0301猫は', tokens: [plain('é'), cat(), plain('は')], html: `é${ruby('猫', 'ねこ')}は`, expected: [[1, 'ねこ']] },
    { name: 'NFD kana composes before indexing', raw: 'か\u3099猫は', tokens: [plain('が'), cat(), plain('は')], html: `が${ruby('猫', 'ねこ')}は`, expected: [[1, 'ねこ']] },
    { name: 'uncomposed combining mark takes its own creator cell', raw: 'q\u0301猫は', tokens: [plain('q\u0301'), cat(), plain('は')], html: `q\u0301${ruby('猫', 'ねこ')}は`, expected: [[2, 'ねこ']] },
    { name: 'BMP variation selector takes its own creator cell', raw: '✈️猫は', tokens: [plain('✈️'), cat(), plain('は')], html: `✈️${ruby('猫', 'ねこ')}は`, expected: [[2, 'ねこ']] },
    { name: 'ZWJ emoji takes three creator cells', raw: '👩‍🎤猫はね', tokens: [plain('👩‍🎤'), cat(), plain('はね')], html: `👩‍🎤${ruby('猫', 'ねこ')}はね`, expected: [[3, 'ねこ']] },
    { name: 'astral variation selector takes one creator cell', raw: '葛\u{E0100}猫は', tokens: [plain('葛\u{E0100}'), cat(), plain('は')], html: `葛\u{E0100}${ruby('猫', 'ねこ')}は`, expected: [[2, 'ねこ']] },
    { name: 'converter unavailable', raw: '😀猫は', ready: false, html: null, expected: [] },
    { name: 'valid non-Japanese locale', raw: '😀猫は', language: 'en', html: null, expected: [] },
    { name: 'no kanji', raw: '😀あ', html: null, expected: [] },
    { name: 'kanji without a reading produces no ruby', raw: '😀猫は', tokens: [plain('😀猫は')], html: '😀猫は', expected: [] },
    { name: 'empty input', raw: '', html: null, expected: [] },
];

for (const fixture of cases) {
    test(`creator furigana: ${fixture.name}`, async () => {
        const result = await renderCreator(fixture);
        assert.equal(result.converted, fixture.html);
        assert.deepEqual(result.tokenizations, fixture.html === null ? [] : [fixture.raw.normalize('NFC')]);
        const chars = Array.from(fixture.raw.normalize('NFC'));
        same(result.chars, chars, 'real cell preparation uses NFC code points');
        const cells = result.nodes.map(node => {
            const original = node.children[0];
            const hasReading = typeof original !== 'string';
            if (hasReading) {
                assert.equal(original.props.style.role, 'base');
                assert.equal(original.children[1].props.style.role, 'reading');
            }
            return {
                index: node.props['data-char-index'],
                char: hasReading ? original.children[0] : original,
                reading: hasReading ? original.children[1].children[0] : null,
            };
        });
        same(cells, chars.map((char, index) => ({
            index, char, reading: fixture.expected.find(([position]) => position === index)?.[1] ?? null,
        })), 'every actual rendered node retains its own expected reading');
        same(result.map, fixture.expected, 'caller forwards code-point-indexed readings');
    });
}

// Direct helper inputs also cover ruby runs containing astral code points. These
// are a mapper contract, not a claim that the current BMP-only tokenizer emits them.
const mapperContext = vm.createContext({});
vm.runInContext(`globalThis.utils = {\n${mapperSource}\n};`, mapperContext);
const map = html => [...mapperContext.utils.parseFuriganaMapping(html)];
for (const fixture of [
    { name: 'single astral base advances one position', html: `${ruby('𠮷', 'よし')}${ruby('猫', 'ねこ')}`, expected: [[0, 'よし'], [1, 'ねこ']] },
    { name: 'mixed astral/BMP ruby preserves splitting and following positions', html: `😀${ruby('𠮷野', 'よしの')}は${ruby('猫', 'ねこ')}`, expected: [[1, 'よ'], [2, 'しの'], [4, 'ねこ']] },
    { name: 'reading split counts code points', html: `${ruby('東京', 'あ😀い')}${ruby('猫', 'ねこ')}`, expected: [[0, 'あ'], [1, '😀い'], [2, 'ねこ']] },
    { name: 'short reading preserves empty earlier allocations', html: ruby('東京', 'と'), expected: [[0, ''], [1, 'と']] },
    { name: 'plain markup strips tags before counting code points', html: `<span>😀</span>${ruby('猫', 'ねこ')}`, expected: [[1, 'ねこ']] },
]) {
    test(`creator mapping helper: ${fixture.name}`, () => same(map(fixture.html), fixture.expected));
}
test('creator mapping helper: empty, non-string and no-ruby inputs stay empty', () => {
    for (const input of ['', null, undefined, 0, {}, '😀猫は', '<span>猫</span>']) same(map(input), []);
});

const pagesContext = vm.createContext({ window: {} });
vm.runInContext([
    section('Pages.js', 'const KARAOKE_COMBINING_MARK_REGEX =', 'const coalesceKaraokeTimedGraphemes ='),
    section('Pages.js', 'const buildKaraokeFuriganaMap =', 'const buildKaraokeTimedChars ='),
    'globalThis.map = buildKaraokeFuriganaMap;',
].join('\n'), pagesContext);
for (const [prefix, creatorIndex] of [['q\u0301', 2], ['✈️', 2], ['👩‍🎤', 3]]) {
    test(`Pages keeps its separate grapheme indexing for ${prefix}`, () => {
        const html = `${prefix}${ruby('猫', 'ねこ')}は`;
        same(map(html), [[creatorIndex, 'ねこ']]);
        same([...pagesContext.map(html)], [[1, 'ねこ']]);
    });
}
