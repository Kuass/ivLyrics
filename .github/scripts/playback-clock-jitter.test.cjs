const assert = require("node:assert/strict");
const test = require("node:test");

const { createPlaybackClock } = require("../../PlaybackClock.js");

const createHarness = ({ position = 0 } = {}) => {
  const uri = "spotify:track:aaaaaaaaaaaaaaaaaaaaaa";
  const playbackId = "playback-a";
  const item = {
    uri,
    type: "track",
    provider: "context",
    duration: { milliseconds: 240000 },
    metadata: {}
  };
  let monotonicNow = 1000;
  let epochNow = 1000000;
  let publicProgress = position;
  let playerState = {
    item,
    playbackId,
    positionAsOfTimestamp: position,
    timestamp: epochNow,
    duration: 240000,
    speed: 1,
    isPaused: false,
    restrictions: {},
    context: { metadata: {} }
  };

  const clock = createPlaybackClock({
    autoStart: false,
    now: () => monotonicNow,
    wallNow: () => epochNow,
    getPlayerData: () => ({ item, playbackId, isPaused: false }),
    getPlayerState: () => playerState,
    getPublicProgress: () => publicProgress,
    getDuration: () => 240000,
    isPlaying: () => true,
    isLocalPlayback: () => false
  });

  return {
    clock,
    advance(milliseconds) {
      monotonicNow += milliseconds;
      epochNow += milliseconds;
      publicProgress += milliseconds;
    },
    setProgress(nextPosition, nextPublicProgress, timestamp = epochNow) {
      playerState = {
        ...playerState,
        positionAsOfTimestamp: nextPosition,
        timestamp
      };
      publicProgress = nextPublicProgress;
    }
  };
};

test("guards transient same-track progress jumps at 240 fps", () => {
  const harness = createHarness({ position: 10000 });
  assert.equal(Math.round(harness.clock.getProgress()), 10000);

  harness.advance(4);
  harness.setProgress(12000, 10004);
  const guarded = harness.clock.getSnapshot();
  assert.equal(Math.round(guarded.position), 10004);
  assert.equal(guarded.source, "guarded-player-state");

  harness.advance(4);
  harness.setProgress(12004, 10008);
  assert.equal(Math.round(harness.clock.getProgress()), 10008);

  harness.setProgress(10008, 10008);
  const recovered = harness.clock.getSnapshot();
  assert.equal(Math.round(recovered.position), 10008);
  assert.equal(recovered.source, "player-state");
});

test("accepts a persistent uncorroborated seek after the confirmation window", () => {
  const harness = createHarness({ position: 30000 });
  harness.clock.getSnapshot();

  harness.setProgress(50000, 30000);
  assert.equal(Math.round(harness.clock.getProgress()), 30000);

  harness.advance(120);
  harness.setProgress(50120, 30120);
  assert.equal(Math.round(harness.clock.getProgress()), 50120);
});

test("applies an explicitly invalidated seek immediately", () => {
  const harness = createHarness({ position: 60000 });
  harness.clock.getSnapshot();

  harness.clock.invalidate();
  harness.setProgress(5000, 60000);
  assert.equal(Math.round(harness.clock.getProgress()), 5000);
});
