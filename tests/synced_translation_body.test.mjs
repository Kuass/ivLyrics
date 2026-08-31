import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Pages.js", import.meta.url), "utf8");
const helperStart = source.indexOf("const safeRenderText");
const helperEnd = source.indexOf("const getFirstTrimmedString", helperStart);
const stateStart = source.indexOf("const buildLyricDisplayState");
const stateEnd = source.indexOf("const getCopyableText", stateStart);
assert.ok(helperStart > 0 && helperEnd > helperStart, "lyric display-mode helper must remain testable");
assert.ok(stateStart > 0 && stateEnd > stateStart, "synced display-state builder must remain testable");

const context = vm.createContext({
    CONFIG: { visual: { "translate:display-mode": "replace" } },
    Utils: { applyFuriganaIfEnabled: (text) => text },
});
vm.runInContext(
    `${source.slice(helperStart, helperEnd)}\n${source.slice(stateStart, stateEnd)}\n` +
    "globalThis.__displayModeTest = { getLyricsDisplayMode, buildLyricDisplayState };",
    context
);

const { getLyricsDisplayMode, buildLyricDisplayState } = context.__displayModeTest;

test("line-synced rendering keeps the original body when translations are enabled", () => {
    const result = buildLyricDisplayState(
        false,
        null,
        null,
        "Rap God",
        "랩 갓"
    );

    assert.equal(result.mainText, "Rap God");
    assert.equal(result.subText, null);
    assert.equal(result.subText2, "랩 갓");
});

test("plain replace mode keeps its existing replacement behavior", () => {
    const result = getLyricsDisplayMode(false, null, null, "Rap God", "랩 갓");

    assert.equal(result.mainText, "랩 갓");
    assert.equal(result.subText, null);
    assert.equal(result.subText2, null);
});
