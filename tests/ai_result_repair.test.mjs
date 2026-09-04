import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../AIAddonManager.js", import.meta.url), "utf8");
const start = source.indexOf("    const repairLyricsResultLines = ");
const end = source.indexOf("    const validateLyricsTranslationResult = ");
assert.ok(start > 0 && end > start, "repair helpers must stay together in AIAddonManager.js");

const context = vm.createContext({ window: {} });
vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.__repair = { repairLyricsResultLines, fillMissingLyricsResultLines };`,
    context
);
const { repairLyricsResultLines, fillMissingLyricsResultLines } = context.__repair;
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

test("keeps a result whose line count already matches", () => {
    const lines = ["a", "b"];
    assert.equal(repairLyricsResultLines(lines, ["x", "y"]), lines);
});

test("drops stray blank lines the model added before or after the lyrics", () => {
    same(repairLyricsResultLines(["", "a", "b", ""], ["x", "y"]), ["a", "b"]);
});

test("reinserts blank lines the model skipped", () => {
    same(repairLyricsResultLines(["a", "b", "c"], ["x", "", "y", "", "z"]), ["a", "", "b", "", "c"]);
});

test("gives up when the number of content lines differs", () => {
    assert.equal(repairLyricsResultLines(["a", "b"], ["x", "y", "z"]), null);
    assert.equal(repairLyricsResultLines(["a", "b", "c", "d"], ["x", "y", "z"]), null);
});

test("gives up when the reply has its own blank lines in different places", () => {
    // 빈 줄 위치가 다르면 어느 줄이 합쳐졌는지 알 수 없으므로 재배치하지 않는다.
    assert.equal(repairLyricsResultLines(["a", "", "b"], ["x", "y", "", "z"]), null);
});

test("fills an empty result line with the original so only that line loses its supplement", () => {
    same(fillMissingLyricsResultLines(["a", "", ""], ["x", "y", ""]), ["a", "y", ""]);
});
