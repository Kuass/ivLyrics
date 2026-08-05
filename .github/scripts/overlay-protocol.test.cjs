const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");
const {
    normalizeProgressTiming,
    toUnsignedMilliseconds
} = require(path.join(repositoryRoot, "OverlayProtocol.js"));

test("normalizes precise playback clock values for the Rust overlay contract", () => {
    const timing = normalizeProgressTiming(1250.1085590485484, 240000.4);

    assert.deepEqual(timing, {
        position: 1250,
        duration: 240000,
        remaining: 238.75
    });
    assert.equal(Number.isInteger(timing.position), true);
    assert.equal(Number.isInteger(timing.duration), true);
});

test("keeps invalid or negative millisecond values inside the unsigned contract", () => {
    assert.equal(toUnsignedMilliseconds(-0.6), 0);
    assert.equal(toUnsignedMilliseconds(Number.NaN), 0);
    assert.equal(toUnsignedMilliseconds(Number.POSITIVE_INFINITY), 0);
    assert.equal(toUnsignedMilliseconds("42.7"), 43);
});

test("applies the progress contract to both desktop sender paths", () => {
    const lyricsService = fs.readFileSync(
        path.join(repositoryRoot, "LyricsService.js"),
        "utf8"
    );
    const calls = lyricsService.match(/normalizeOverlayProgressTiming\s*\(/g) || [];

    assert.equal(calls.length, 2, "expected both desktop sender paths to normalize progress");
});
