import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// vm 컨텍스트에서 만든 배열은 프로토타입이 달라 deepEqual이 실패하므로 JSON으로 비교한다.
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const utilsSource = read("Utils.js");
const start = utilsSource.indexOf("  PRONUNCIATION_SEGMENT_SEPARATOR:");
const end = utilsSource.indexOf("  rubyTextToHTML(s) {");
assert.ok(start > 0 && end > start, "pronunciation helpers must stay together in Utils.js");

const context = vm.createContext({ window: {}, globalThis: undefined, module: undefined });
context.globalThis = context;
vm.runInContext(`${read("TinySegmenter.js")}\n${read("LyricsWordSegmenter.js")}`, context);
context.window.LyricsWordSegmenter = context.LyricsWordSegmenter;
vm.runInContext(`globalThis.__utils = {\n${utilsSource.slice(start, end)}\n};`, context);
const utils = context.__utils;

test("splits a Korean line into words for the request and keeps the gaps for rendering", () => {
    const segments = utils.segmentTextForPronunciation("떠나버린 너는  이미 옆에 없는데");
    same(segments.map((s) => s.text), ["떠나버린", "너는", "이미", "옆에", "없는데"]);
    same(segments.map((s) => s.gap), [" ", "  ", " ", " ", ""]);
    assert.equal(utils.buildPronunciationRequestText("떠나버린 너는 이미"), "떠나버린｜너는｜이미");
});

test("pairs separator-delimited pronunciation with the original segments", () => {
    const result = utils.splitInlinePronunciation("떠나버린 너는 이미", "tteonabeorin ｜ neoneun ｜ imi");
    assert.equal(result.text, "tteonabeorin neoneun imi");
    same(result.segments.map((s) => [s.text, s.pronunciation]), [
        ["떠나버린", "tteonabeorin"], ["너는", "neoneun"], ["이미", "imi"],
    ]);
    const html = utils.buildInlinePronunciationHTML(result.segments);
    assert.equal(html, '<ruby class="lyrics-pronunciation-ruby">떠나버린<rt>tteonabeorin</rt></ruby> '
        + '<ruby class="lyrics-pronunciation-ruby">너는<rt>neoneun</rt></ruby> '
        + '<ruby class="lyrics-pronunciation-ruby">이미<rt>imi</rt></ruby>');
});

test("falls back to a plain line when the chunk count does not match", () => {
    const result = utils.splitInlinePronunciation("떠나버린 너는 이미", "tteonabeorin neoneun｜imi");
    assert.equal(result.text, "tteonabeorin neoneun imi");
    assert.equal(result.segments, null);
    const plain = utils.splitInlinePronunciation("떠나버린", "tteonabeorin");
    assert.equal(plain.text, "tteonabeorin");
    assert.equal(plain.segments, null);
});

test("segments Japanese text without spaces and reassembles it", () => {
    const original = "夢ならばどれほどよかったでしょう";
    const segments = utils.segmentTextForPronunciation(original);
    assert.ok(segments.length >= 2);
    assert.equal(segments.map((s) => s.text + s.gap).join(""), original);
});

test("aligns legacy English pronunciation without losing punctuation or repeated spaces", () => {
    const result = utils.splitInlinePronunciation("Hello,  don't go away!", "헬로 돈트 고 어웨이");
    same(result.segments.map(s => [s.text, s.pronunciation, s.gap]), [
        ["Hello,", "헬로", "  "], ["don't", "돈트", " "], ["go", "고", " "], ["away!", "어웨이", ""],
    ]);
    assert.equal(utils.splitInlinePronunciation("I love you", "아이 러브유").segments, null);
    assert.equal(utils.splitInlinePronunciation("Hello world", "").segments, null);
});

test("rejects stale alignment and recovers matching legacy readings", () => {
    const segments = utils.getInlinePronunciationSegments("Hello world", "헬로 월드", [{ text: "wrong", pronunciation: "잘못" }]);
    same(segments.map(s => s.text), ["Hello", "world"]);
});

test("karaoke wraps timed glyphs with pronunciation and preserves every glyph node", () => {
    const pages = read("Pages.js");
    const from = pages.indexOf("const buildKaraokePronunciationElements =");
    const to = pages.indexOf("const KaraokeLine =", from);
    const karaokeContext = vm.createContext({
        react: { createElement: (tag, props, ...children) => ({ tag, props, children }) },
        buildKaraokeWordElements: (chars, elements) => elements,
    });
    vm.runInContext(`${pages.slice(from, to)};globalThis.render = buildKaraokePronunciationElements`, karaokeContext);
    const text = "  Hello world  ";
    const chars = Array.from(text, (char, i) => ({ char, startTime: i * 100 }));
    const nodes = chars.map((c, i) => ({ glyph: c.char, index: i }));
    const segments = utils.getInlinePronunciationSegments(text, "헬로 월드");
    const rendered = karaokeContext.render(chars, nodes, segments, { globalCharOffset: 0 });
    const rubies = rendered.filter(n => n?.tag === "ruby");
    assert.equal(rubies.length, 2);
    same(rubies.map(n => n.children[1].children[0]), ["헬로", "월드"]);
    const flattenGlyphs = n => Array.isArray(n) ? n.flatMap(flattenGlyphs)
        : n?.glyph ? [n] : n?.tag === "ruby" ? flattenGlyphs(n.children[0]) : [];
    const glyphs = flattenGlyphs(rendered);
    assert.equal(glyphs.map(n => n.glyph).join(""), text);
    glyphs.forEach((node, i) => assert.strictEqual(node, nodes[i]));
});

test("plain lyrics put pronunciation inline while leaving translation below", () => {
    const pages = read("Pages.js");
    const from = pages.indexOf("const safeRenderText =");
    const to = pages.indexOf("const getFirstTrimmedString =", from);
    const config = { visual: { "translate:display-mode": "below" } };
    const ctx = vm.createContext({ CONFIG: config, Utils: { ...utils, applyFuriganaIfEnabled: text => text } });
    vm.runInContext(`${pages.slice(from, to)};globalThis.display = getLyricsDisplayMode`, ctx);
    const result = ctx.display(false, {}, "헬로 월드", "Hello world", "안녕 세상");
    assert.match(result.mainText, /<rt>헬로<\/rt>/);
    assert.equal(result.subText, null);
    assert.equal(result.subText2, "안녕 세상");
    config.visual["pronunciation-inline"] = false;
    assert.equal(ctx.display(false, {}, "헬로 월드", "Hello world", "안녕 세상").subText, "헬로 월드");
});
