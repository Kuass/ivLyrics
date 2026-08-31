import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../LyricsDataUtils.js", import.meta.url), "utf8");
const context = vm.createContext({ window: {} });
vm.runInContext(source, context);

const {
    hasLyricsContent,
    firstLyricsContent,
    resolveLyricsForMode,
} = context.window.ivLyricsDataUtils;

test("empty provider arrays are not available lyric modes", () => {
    assert.equal(hasLyricsContent([]), false);
    assert.equal(hasLyricsContent(null), false);
    assert.equal(hasLyricsContent([{ text: "line" }]), true);
});

test("a populated plain-text fallback is not masked by an empty synced array", () => {
    const unsynced = [{ text: "plain lyric" }];
    assert.equal(firstLyricsContent([], unsynced), unsynced);
    assert.equal(resolveLyricsForMode({ synced: [], unsynced }, "synced"), unsynced);
});

test("a populated LRCLib synced result survives an empty transient current mode", () => {
    const synced = [{ text: "timed lyric", startTime: 1000 }];
    assert.equal(resolveLyricsForMode({ karaoke: [], synced, unsynced: [] }, "karaoke"), synced);
});
