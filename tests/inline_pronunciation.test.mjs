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
