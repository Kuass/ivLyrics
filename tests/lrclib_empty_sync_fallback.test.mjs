import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Addon_Lyrics_Lrclib.js", import.meta.url), "utf8");
const helperStart = source.indexOf("const hasLyricsContent");
const helperEnd = source.indexOf("const ADDON_LOCALIZATION", helperStart);
const functionStart = source.indexOf("function applyCandidateLyricsToResult");
const functionEnd = source.indexOf("function buildPreviewCandidateList", functionStart);
assert.ok(helperStart > 0 && helperEnd > helperStart, "LRCLIB content helper must be available");
assert.ok(functionStart > 0 && functionEnd > functionStart, "LRCLIB candidate application must be testable");

const context = vm.createContext({
    buildLrclibSyncSource: () => null,
    parseLRC: () => ({ synced: [], unsynced: [] }),
    parsePlainLyrics: (text) => [{ text }],
    applyLyricsfileKaraokeToResult: () => {},
});
vm.runInContext(
    `${source.slice(helperStart, helperEnd)}\n${source.slice(functionStart, functionEnd)}\n` +
    "globalThis.__lrclibFallbackTest = { applyCandidateLyricsToResult };",
    context
);

const { applyCandidateLyricsToResult } = context.__lrclibFallbackTest;

test("falls back to LRCLIB plain lyrics when a synced payload parses to no lines", () => {
    const result = { karaoke: null, synced: null, unsynced: null };
    const applied = applyCandidateLyricsToResult(result, {
        id: 42,
        syncedLyrics: "[metadata only]",
        plainLyrics: "plain fallback",
    });

    assert.equal(applied, true);
    assert.deepEqual([...result.synced], []);
    assert.deepEqual(result.unsynced.map((line) => ({ ...line })), [{ text: "plain fallback" }]);
});
