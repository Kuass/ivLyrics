import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../NowPlayingPanelLyrics.js", import.meta.url), "utf8");
const start = source.indexOf("const shouldWaitForPanelTrackMetadata");
const end = source.indexOf("const getSavedPanelLocalLyrics", start);
assert.ok(start > 0 && end > start, "panel song-change helper must remain independently testable");

const context = vm.createContext({});
vm.runInContext(
    `${source.slice(start, end)}\n` +
    "globalThis.__panelSongChangeTest = { shouldWaitForPanelTrackMetadata, isIvLyricsRouteActive };",
    context
);

const { shouldWaitForPanelTrackMetadata, isIvLyricsRouteActive } = context.__panelSongChangeTest;

test("waits while songchange still exposes the previous track URI", () => {
    assert.equal(shouldWaitForPanelTrackMetadata("spotify:track:old", "spotify:track:old", 0), true);
    assert.equal(shouldWaitForPanelTrackMetadata(null, "spotify:track:old", 3), true);
});

test("loads as soon as the new track metadata is visible", () => {
    assert.equal(shouldWaitForPanelTrackMetadata("spotify:track:new", "spotify:track:old", 1), false);
});

test("eventually permits same-track reloads instead of polling forever", () => {
    assert.equal(shouldWaitForPanelTrackMetadata("spotify:track:same", "spotify:track:same", 6), false);
});

test("a real Spotify pathname wins over a stale cached ivLyrics page node", () => {
    assert.equal(isIvLyricsRouteActive("/", true), false);
    assert.equal(isIvLyricsRouteActive("/search", true), false);
    assert.equal(isIvLyricsRouteActive("/ivLyrics", false), true);
    assert.equal(isIvLyricsRouteActive("/ivLyrics/settings", false), true);
});

test("the visible page node is only a fallback while history is unavailable", () => {
    assert.equal(isIvLyricsRouteActive("", true), true);
    assert.equal(isIvLyricsRouteActive(null, false), false);
});
