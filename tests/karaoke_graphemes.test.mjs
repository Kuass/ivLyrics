import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Pages.js", import.meta.url), "utf8");
const start = source.indexOf("const KARAOKE_COMBINING_MARK_REGEX");
const end = source.indexOf("const getKaraokeSyllableCharCount", start);
assert.ok(start > 0 && end > start, "karaoke grapheme helpers must remain independently testable");

const context = vm.createContext({
    window: {},
    console,
    Intl,
});
vm.runInContext(
    `${source.slice(start, end)}\n` +
    "globalThis.__graphemeTest = { splitKaraokeGraphemes, coalesceKaraokeTimedGraphemes };",
    context
);

const { splitKaraokeGraphemes, coalesceKaraokeTimedGraphemes } = context.__graphemeTest;

test("keeps a Thai base letter and tone mark in one rendered glyph", () => {
    const merged = coalesceKaraokeTimedGraphemes([
        { char: "ก", startTime: 100, endTime: 180 },
        { char: "้", startTime: 180, endTime: 240 },
    ], "th");

    assert.equal(merged.length, 1);
    assert.equal(merged[0].char, "ก้");
    assert.equal(merged[0].startTime, 100);
    assert.equal(merged[0].endTime, 240);
});

test("keeps emoji ZWJ sequences in one karaoke timing unit", () => {
    assert.deepEqual(
        [...splitKaraokeGraphemes("👩‍🎤", "auto")],
        ["👩‍🎤"]
    );
});
