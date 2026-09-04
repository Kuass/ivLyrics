import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../LyricsAddonManager.js", import.meta.url), "utf8");
const start = source.indexOf("    function toFiniteLyricsTime(value) {");
const end = source.indexOf("    function normalizeInstrumentalBreakSyllables(");
assert.ok(start > 0 && end > start, "timing helpers must stay together in LyricsAddonManager.js");

const context = vm.createContext({
    LYRICS_TYPES: { KARAOKE: "karaoke", SYNCED: "synced", UNSYNCED: "unsynced" },
});
vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.__timing = { hasUsableLineTiming, dropBrokenLineTiming };`,
    context
);
const { hasUsableLineTiming, dropBrokenLineTiming } = context.__timing;

const lines = (...times) => times.map((startTime, index) => ({ startTime, text: `line ${index}` }));

test("accepts ordinary synced lyrics", () => {
    assert.equal(hasUsableLineTiming(lines(1200, 5400, 9800, 14000, 21000, 40000), 200_000), true);
    assert.equal(hasUsableLineTiming(lines(0, 3000, 7000, 12000, 33000)), true);
});

test("rejects lyrics whose timestamps are all zero or identical", () => {
    assert.equal(hasUsableLineTiming(lines(0, 0, 0, 0), 200_000), false);
    assert.equal(hasUsableLineTiming(lines(5000, 5000, 5000), 200_000), false);
    assert.equal(hasUsableLineTiming(lines(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1000, 2000)), false);
});

test("rejects seconds mistaken for milliseconds and timestamps beyond the track", () => {
    assert.equal(hasUsableLineTiming(lines(12, 17, 21, 30, 44, 60), 200_000), false);
    assert.equal(hasUsableLineTiming(lines(300_000, 310_000, 320_000), 200_000), false);
});

test("rejects mostly unordered timestamps but tolerates a stray one", () => {
    assert.equal(hasUsableLineTiming(lines(40000, 30000, 20000, 10000, 5000), 200_000), false);
    assert.equal(hasUsableLineTiming(lines(1000, 5000, 4000, 9000, 15000, 40000), 200_000), true);
});

test("keeps single-line and short interlude lyrics", () => {
    assert.equal(hasUsableLineTiming(lines(0)), true);
    assert.equal(hasUsableLineTiming(lines(1000, 9000), 40_000), true);
});

test("drops broken synced timing and keeps the text as unsynced lyrics", () => {
    const result = { synced: lines(0, 0, 0), karaoke: null, unsynced: null, provider: "x" };
    const { result: cleaned, dropped } = dropBrokenLineTiming(result, { duration: 200_000 });
    assert.deepEqual([...dropped], ["synced"]);
    assert.equal(cleaned.synced, null);
    assert.deepEqual(cleaned.unsynced.map((line) => line.text), ["line 0", "line 1", "line 2"]);
    assert.equal(result.synced.length, 3, "the original result must not be mutated");
});

test("leaves healthy results untouched", () => {
    const result = { synced: lines(0, 4000, 9000, 40000), karaoke: null, unsynced: null };
    const { result: same, dropped } = dropBrokenLineTiming(result, { duration: 200_000 });
    assert.equal(same, result);
    assert.equal(dropped.length, 0);
});
