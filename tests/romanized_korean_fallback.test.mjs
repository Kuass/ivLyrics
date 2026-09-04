import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../LyricsAddonManager.js", import.meta.url), "utf8");
const helpersStart = source.indexOf("    function getKaraokeLineSyllables(line) {");
const helpersEnd = source.indexOf("    function inferKaraokeGranularity(");
const start = source.indexOf("    const ROMANIZED_KOREAN_MIN_TOKENS");
const end = source.indexOf("    function normalizeInstrumentalBreakSyllables(");
assert.ok(helpersStart > 0 && helpersEnd > helpersStart && start > 0 && end > start);

const context = vm.createContext({
    LYRICS_TYPES: { KARAOKE: "karaoke", SYNCED: "synced", UNSYNCED: "unsynced" },
});
vm.runInContext(
    `${source.slice(helpersStart, helpersEnd)}\n${source.slice(start, end)}\nglobalThis.__romanized = { looksRomanizedKorean };`,
    context
);
const { looksRomanizedKorean } = context.__romanized;

const synced = (...texts) => ({ synced: texts.map((text, index) => ({ startTime: index * 3000, text })) });

test("flags romanized Korean lyrics from Spotify/Musixmatch", () => {
    assert.equal(looksRomanizedKorean(synced(
        "Baby why me geudaeneun nal dugo tteonaganeunde",
        "I Cannot let U go",
        "idaero tteonajima amu mareobsi nal tteonagajima",
        "nal saranghandamyeon",
        "tteonabeorin neoneun imi yeope eomneunde",
        "nameun gieok soge neoege nan oechine"
    )), true);
});

test("keeps Hangul, English and Japanese romaji lyrics", () => {
    assert.equal(looksRomanizedKorean(synced("이대로 떠나지마 아무 말없이 날 떠나가지마", "I can not let you go")), false);
    assert.equal(looksRomanizedKorean(synced(
        "Someone told me people leave the neon city at night",
        "We were young and the video played on every screen",
        "Nobody knows the theory of a broken heart"
    )), false);
    assert.equal(looksRomanizedKorean(synced(
        "kimi no koto ga suki da yo zutto mae kara",
        "kaeru michi de futari aruita yoru no machi",
        "namida wo koraete waratta"
    )), false);
});

test("does not let a repeated English chorus pass as romanized Korean", () => {
    assert.equal(looksRomanizedKorean(synced(
        "Video games, video games, you play video games",
        "Video games, video games, people love video games"
    )), false);
});

test("ignores short or empty results", () => {
    assert.equal(looksRomanizedKorean(synced("neoneun nae sarang")), false);
    assert.equal(looksRomanizedKorean({ synced: [], unsynced: null }), false);
    assert.equal(looksRomanizedKorean(null), false);
});

test("reads karaoke syllables when lines carry no plain text", () => {
    const line = (...parts) => ({ syllables: parts.map((text) => ({ text })) });
    assert.equal(looksRomanizedKorean({ karaoke: [
        line("geu", "dae", "neun ", "nal ", "du", "go ", "tteo", "na", "ga", "neun", "de"),
        line("i", "dae", "ro ", "tteo", "na", "ji", "ma ", "a", "mu ", "ma", "reob", "si"),
    ] }), true);
});
