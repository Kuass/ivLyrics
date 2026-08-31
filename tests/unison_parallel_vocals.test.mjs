import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Addon_Lyrics_Unison.js", import.meta.url), "utf8");
const context = vm.createContext({
    window: {
        LyricsAddonManager: { register() {} },
    },
    console,
    setTimeout,
    clearTimeout,
    URL,
    AbortController,
    fetch: async () => { throw new Error("network must not be used in parser tests"); },
});
vm.runInContext(source, context);

const { groupParallelVocalLines } = context.window.__ivLyricsUnisonDebug;

const line = (key, sourceIndex, startTime, endTime) => ({
    unisonLineKey: key,
    sourceIndex,
    startTime,
    endTime,
    text: key,
    unisonAgent: key,
    syllables: [{ text: key, startTime, endTime }],
});

test("does not transitively merge a relay of overlapping vocals", () => {
    const grouped = groupParallelVocalLines([
        line("A", 0, 0, 1000),
        line("B", 1, 900, 1900),
        line("C", 2, 1800, 2800),
    ]);

    assert.equal(grouped.length, 2);
    assert.deepEqual([...grouped[0].unisonLineKeys], ["A", "B"]);
    assert.equal(grouped[1].unisonLineKey, "C");
});

test("keeps three vocals together when all share a simultaneous window", () => {
    const grouped = groupParallelVocalLines([
        line("A", 0, 0, 1000),
        line("B", 1, 300, 1200),
        line("C", 2, 500, 900),
    ]);

    assert.equal(grouped.length, 1);
    assert.deepEqual([...grouped[0].unisonLineKeys], ["A", "B", "C"]);
});

test("leaves separated vocal lines untouched", () => {
    const grouped = groupParallelVocalLines([
        line("A", 0, 0, 1000),
        line("B", 1, 1200, 2000),
    ]);

    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].unisonLineKey, "A");
    assert.equal(grouped[1].unisonLineKey, "B");
});
