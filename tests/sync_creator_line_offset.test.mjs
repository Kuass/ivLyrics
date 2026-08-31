import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../SyncDataCreator.js", import.meta.url), "utf8");
const start = source.indexOf("const shiftSyncCreatorFiniteTimes");
const end = source.indexOf("const SyncDataCreator", start);
assert.ok(start > 0 && end > start, "line offset helpers must remain independently testable");

const context = vm.createContext({
    roundSyncCreatorTime: (value) => Math.round(value * 1000) / 1000,
});
vm.runInContext(
    `${source.slice(start, end)}\n` +
    "globalThis.__offsetHelpers = { shiftSyncCreatorFiniteTimes, shiftSyncCreatorLineTiming };",
    context
);

const { shiftSyncCreatorFiniteTimes, shiftSyncCreatorLineTiming } = context.__offsetHelpers;

test("moves the main line and every parallel sub-line by the same offset", () => {
    const shifted = shiftSyncCreatorLineTiming({
        start: 12,
        chars: [1, 1.5, null],
        parallel: {
            parts: [
                { id: "lead", chars: [1.1, 1.6] },
                { id: "backing", chars: [1.2, 1.7] },
            ],
        },
    }, 0.25);

    assert.deepEqual([...shifted.chars], [1.25, 1.75, null]);
    assert.deepEqual([...shifted.parallel.parts[0].chars], [1.35, 1.85]);
    assert.deepEqual([...shifted.parallel.parts[1].chars], [1.45, 1.95]);
});

test("preserves non-numeric in-progress slots and clamps negative time at zero", () => {
    assert.deepEqual(
        [...shiftSyncCreatorFiniteTimes([0.1, undefined, "pending"], -0.5)],
        [0, undefined, "pending"]
    );
});

test("the line-offset control no longer clears the active sync input", () => {
    const functionStart = source.indexOf("const adjustCurrentLineOffset");
    const functionEnd = source.indexOf("const resetFromStart", functionStart);
    const implementation = source.slice(functionStart, functionEnd);
    assert.equal(implementation.includes("resetCurrentSyncInput()"), false);
});
