import assert from "node:assert/strict";
import test from "node:test";
import {
  harness,
  A,
  B,
  track,
  lines,
  clone,
} from "./helpers/regeneration_retirement_harness.mjs";
import { installConsumers } from "./helpers/regeneration_retirement_consumers.mjs";
const active = new Set();
const make = (options) => {
  const h = harness(options);
  active.add(h);
  return h;
};
const select = (h, target = "all") => {
  if (h.click()) h.choose(target);
};
const mark = (h) => ({
  calls: h.providerCalls.length,
  writes: h.persistentWrites.length,
  toasts: h.toasts.length,
  progress: h.progress.length,
  timers: h.timerTrace.length,
});
const calls = (h, start) =>
  h.providerCalls.slice(start).map((q) => clone(q.options));
const inspect = async (h, view) => {
  h.button();
  await h.settle();
  return {
    state: h.snapshot(),
    renderKey: h.c.lastProcessedMode,
    processedUri: h.c.lastProcessedUri,
    raw: {
      karaoke: clone(h.c.state.karaoke),
      synced: clone(h.c.state.synced),
      unsynced: clone(h.c.state.unsynced),
    },
    view: view(),
  };
};
const ui = (value) => ({
  lyricsCount: value.state.lyrics?.length || 0,
  indicators: value.view.indicators.map((n) => n.text),
});
async function initial(h) {
  await h.load(track(A));
  await h.completeInitial();
}
async function unresolved(h) {
  await h.load(track(B, false), track(A));
  assert.equal(h.c.currentTrackUri, A);
  assert.equal(h.c.state.uri, A);
  assert.equal(h.clock.getSnapshot().uri, B);
  assert.equal(h.c.state.isLoading, true);
  assert.equal(h.c.state.currentLyrics.length, 0);
  assert.ok(h.c._playbackTrackResolutionTimer);
}
async function recoverViaRetry(h) {
  h.setPlayback(track(B), track(B));
  await h.advance(100);
  assert.equal(h.c.currentTrackUri, B);
  h.button();
  await h.settle();
}
async function settleExcept(h, held) {
  for (let i = 0; i < 8; i++) {
    for (const q of h.providerCalls)
      if (!q.settled && !held.has(q)) q.resolve(h.result(q));
    await h.settle();
    await h.advance(60);
  }
}
function timerIntegrity(h) {
  const live = new Set();
  for (const e of h.timerTrace) {
    if (e.event === "schedule") live.add(e.id);
    else if (e.event === "cancel") live.delete(e.id);
    else {
      assert.ok(live.has(e.id), `timer ${e.id} was live when fired`);
      live.delete(e.id);
    }
  }
  assert.equal(live.size, 0);
}
async function finish(h) {
  await h.drain();
  timerIntegrity(h);
  h.close();
  active.delete(h);
}
test.afterEach(async () => {
  for (const h of active) await finish(h);
});

const targets = [
  ["gemini_ko", "none", "translation"],
  ["gemini_romaji", "none", "phonetic"],
  ["gemini_romaji", "gemini_ko", "all"],
];
for (const queuedState of [false, true])
  for (const [mode1, mode2, target] of targets) {
    const name = `post-transition ${target} stream keeps outgoing fullscreen progress cleared; queued=${queuedState}`;
    test(name, async () => {
      const h = make({ queuedState, mode1, mode2 });
      await initial(h);
      const view = installConsumers(h);
      await h.settle();
      const before = mark(h);
      select(h, target);
      const old = h.providerCalls.at(-1);
      assert.equal(h.providerCalls.length, before.calls + 1);
      const admitted = await inspect(h, view);
      await unresolved(h);
      const cleared = await inspect(h, view);
      const timersBefore = new Set(h.timers.keys());
      old.options.onLine(0, `late A ${target}`);
      const freshTimer = h.c.streamingApplyTimer;
      assert.ok(freshTimer && !timersBefore.has(freshTimer));
      await h.advance(49);
      assert.equal(h.c.state.currentLyrics.length, 0);
      await h.advance(1);
      const late = await inspect(h, view);
      assert.equal(late.state.snapshotUri, B);
      assert.equal(late.state.currentUri, A);
      assert.equal(late.state.isLoading, true);
      assert.deepEqual(late.raw, {
        karaoke: null,
        synced: null,
        unsynced: null,
      });
      assert.deepEqual(late.view.page, {
        tag: "LyricsUnavailableView",
        props: { isLoading: true },
      });
      assert.equal(late.view.mode, -1);
      assert.equal(late.view.suppressed, false);
      await recoverViaRetry(h);
      old.resolve(h.result(old, "retired after B commit"));
      await finish(h);
      const repaired = await inspect(h, view);
      assert.equal(repaired.state.uri, B);
      assert.equal(repaired.state.isLoading, false);
      assert.equal(repaired.state.lyrics[0].originalText, lines(B)[0].text);
      assert.equal(
        calls(h, before.calls).filter((q) => q.trackId === A.split(":").at(-1))
          .length,
        1,
        "committed B suppresses A second mode",
      );
      assert.equal(
        h.persistentWrites
          .slice(before.writes)
          .filter((w) => w.trackId === A.split(":").at(-1)).length,
        1,
        "only admitted Translator warms A after B commit",
      );

      assert.deepEqual(
        ui(late),
        { lyricsCount: 0, indicators: [] },
        "unresolved handoff must keep outgoing publication retired",
      );
    });
  }

for (const queuedState of [false, true]) {
  test(`TV consumer receives same late progress; queued=${queuedState}`, async () => {
    const h = make({ queuedState });
    await initial(h);
    const view = installConsumers(h, { tv: true });
    await h.settle();
    h.click();
    const old = h.providerCalls.at(-1);
    await unresolved(h);
    const cleared = await inspect(h, view);
    old.options.onLine(0, "late TV");
    await h.advance(50);
    const late = await inspect(h, view);
    await recoverViaRetry(h);
    await finish(h);
    assert.deepEqual(ui(late), { lyricsCount: 0, indicators: [] });
  });

  test(`pre-transition pending timer is canceled without delivery; queued=${queuedState}`, async () => {
    const h = make({ queuedState });
    await initial(h);
    const view = installConsumers(h);
    await h.settle();
    h.click();
    const old = h.providerCalls.at(-1);
    old.options.onLine(0, "before handoff");
    const canceled = h.c.streamingApplyTimer;
    await unresolved(h);
    assert.equal(h.timers.has(canceled), false);
    await h.advance(50);
    const after = await inspect(h, view);
    assert.deepEqual(ui(after), { lyricsCount: 0, indicators: [] });
    await recoverViaRetry(h);
    await finish(h);
    assert.ok(
      !h.timerTrace.some((e) => e.event === "fire" && e.id === canceled),
    );
  });

  test(`full B commit cancels newly queued A timer; queued=${queuedState}`, async () => {
    const h = make({ queuedState });
    await initial(h);
    const view = installConsumers(h);
    await h.settle();
    h.click();
    const old = h.providerCalls.at(-1);
    await unresolved(h);
    old.options.onLine(0, "late but canceled by B");
    const canceled = h.c.streamingApplyTimer;
    await h.load(track(B));
    await settleExcept(h, new Set([old]));
    const before = await inspect(h, view);
    old.options.onLine(0, "after B commit");
    await h.advance(50);
    const after = await inspect(h, view);
    assert.deepEqual(after.state.lyrics, before.state.lyrics);
    assert.equal(h.timers.has(canceled), false);
    await finish(h);
    assert.ok(
      !h.timerTrace.some((e) => e.event === "fire" && e.id === canceled),
    );
  });

  test(`ordinary committed A to B retires stream and second request; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1: "gemini_romaji", mode2: "gemini_ko" });
    await initial(h);
    const view = installConsumers(h);
    await h.settle();
    const before = mark(h);
    select(h);
    const old = h.providerCalls.at(-1);
    await h.load(track(B));
    await settleExcept(h, new Set([old]));
    const committed = await inspect(h, view);
    const count = h.progress.length;
    old.options.onLine(0, "stale A after committed B");
    await h.advance(50);
    assert.equal(h.progress.length, count);
    assert.deepEqual(clone(h.c.state.currentLyrics), committed.state.lyrics);
    await finish(h);
    const requests = calls(h, before.calls);
    const writes = h.persistentWrites.slice(before.writes);
    assert.equal(
      requests.filter((q) => q.trackId === A.split(":").at(-1)).length,
      1,
    );
    assert.equal(
      writes.filter((q) => q.trackId === A.split(":").at(-1)).length,
      1,
    );
    assert.equal(
      h.toasts.slice(before.toasts).filter((t) => t.kind === "success").length,
      0,
    );
  });

  test(`new regeneration choice during unresolved B rejects cleared lyrics; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1: "gemini_romaji", mode2: "gemini_ko" });
    await initial(h);
    const view = installConsumers(h);
    await h.settle();
    h.click();
    const before = mark(h);
    await unresolved(h);
    const cleared = await inspect(h, view);
    h.choose("all");
    await h.settle();
    assert.equal(h.providerCalls.length, before.calls);
    assert.ok(
      h.toasts
        .slice(before.toasts)
        .some((q) => q.message === "notifications.noLyricsLoaded"),
    );
    await recoverViaRetry(h);
    await finish(h);
  });

  test(`both-mode completion while unresolved keeps existing second dispatch and success behavior; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1: "gemini_romaji", mode2: "gemini_ko" });
    await initial(h);
    const view = installConsumers(h);
    await h.settle();
    const before = mark(h);
    select(h);
    const old = h.providerCalls.at(-1);
    await unresolved(h);
    old.resolve(h.result(old, "first completes unresolved"));
    await h.settle();
    const second = h.providerCalls.at(-1);
    assert.notStrictEqual(second, old);
    const secondAdmission = await inspect(h, view);
    assert.equal(second.options.trackId, A.split(":").at(-1));
    second.resolve(h.result(second, "second completes unresolved"));
    await h.settle();
    const completed = await inspect(h, view);
    assert.equal(h.providerCalls.length, before.calls + 2);
    assert.equal(completed.state.isLoading, true);
    assert.deepEqual(ui(completed), { lyricsCount: 0, indicators: [] });
    assert.equal(
      h.toasts.slice(before.toasts).filter((t) => t.kind === "success").length,
      1,
    );
    const writes = clone(h.persistentWrites.slice(before.writes));
    assert.equal(writes.length, 4);
    await recoverViaRetry(h);
    await finish(h);
  });

  test(`bounded unresolved terminal path clears streamed state; queued=${queuedState}`, async () => {
    const h = make({ queuedState });
    await initial(h);
    const view = installConsumers(h);
    await h.settle();
    h.click();
    const old = h.providerCalls.at(-1);
    await unresolved(h);
    old.options.onLine(0, "before terminal deadline");
    await h.advance(50);
    const late = await inspect(h, view);
    old.resolve(h.result(old, "completed before terminal"));
    await h.settle();
    await h.advance(3950);
    await finish(h);
    const terminal = await inspect(h, view);
    assert.equal(terminal.state.error, "Playback transition unresolved");
    assert.equal(terminal.state.isLoading, false);
    assert.deepEqual(ui(terminal), { lyricsCount: 0, indicators: [] });
  });

  test(`automatic A presentation already has request-state retirement; queued=${queuedState}`, async () => {
    const h = make({ queuedState });
    await h.load(track(A));
    const old = h.providerCalls.at(-1);
    assert.ok(old && !old.settled);
    const view = installConsumers(h);
    await h.settle();
    await unresolved(h);
    const before = mark(h);
    old.options.onLine(0, "retired automatic A");
    await h.advance(50);
    const after = await inspect(h, view);
    assert.equal(h.progress.length, before.progress);
    assert.deepEqual(ui(after), { lyricsCount: 0, indicators: [] });
    await recoverViaRetry(h);
    await finish(h);
  });

  for (const path of ["same-uri", "ABA"])
    test(`existing ${path} acceptance is characterized unchanged; queued=${queuedState}`, async () => {
      const h = make({
        queuedState,
        mode1: "gemini_romaji",
        mode2: "gemini_ko",
      });
      await initial(h);
      const view = installConsumers(h);
      await h.settle();
      select(h);
      const old = h.providerCalls.at(-1);
      if (path === "same-uri") {
        await h.refresh(track(A));
        await settleExcept(h, new Set([old]));
      } else {
        await h.load(track(B));
        await settleExcept(h, new Set([old]));
        await h.load(track(A));
        await settleExcept(h, new Set([old]));
      }
      const before = mark(h);
      old.options.onLine(0, `accepted ${path}`);
      await h.advance(50);
      const late = await inspect(h, view);
      assert.equal(late.state.currentUri, A);
      assert.ok(
        late.state.lyrics.some((l) => l.phoneticText === `accepted ${path}`),
      );
      old.resolve(h.result(old, `${path} first`));
      await h.settle();
      assert.equal(h.providerCalls.length, before.calls + 1);
      assert.equal(h.providerCalls.at(-1).options.wantSmartPhonetic, false);
      await finish(h);
    });
}

for (const option of ["progress-off", "lyrics-hidden", "not-fullscreen"])
  test(`consumer suppression control: ${option}`, async () => {
    const h = make();
    await initial(h);
    const view = installConsumers(h, {
      progress: option !== "progress-off",
      hidden: option === "lyrics-hidden",
      fullscreen: option !== "not-fullscreen",
    });
    await h.settle();
    h.click();
    const old = h.providerCalls.at(-1);
    await unresolved(h);
    old.options.onLine(0, "late hidden A");
    await h.advance(50);
    const late = await inspect(h, view);
    assert.equal(late.state.lyrics.length, 0);
    assert.deepEqual(late.view.indicators, []);
    await recoverViaRetry(h);
    await finish(h);
  });

for (const queuedState of [false, true])
  for (const [mode1, mode2, target] of targets) {
    for (const stage of ["without-stream", "after-stream"])
      test(`failure restoration ${target} ${stage} preserves the transition clear; queued=${queuedState}`, async () => {
        const h = make({ queuedState, mode1, mode2 });
        await initial(h);
        const view = installConsumers(h);
        await h.settle();
        const before = mark(h);
        select(h, target);
        const old = h.providerCalls.at(-1);
        await unresolved(h);
        const cleared = await inspect(h, view);
        let partial = null;
        if (stage === "after-stream") {
          old.options.onLine(0, "discarded provisional A");
          await h.advance(50);
          partial = await inspect(h, view);
        }
        assert.ok(h.c.streamingApplyTimer == null);
        old.reject(Error("inert regeneration failure"));
        await h.settle();
        const restorationTimer = h.c.streamingApplyTimer;
        assert.ok(restorationTimer);
        await h.advance(50);
        const restored = await inspect(h, view);
        assert.equal(restored.state.isLoading, true);
        assert.deepEqual(restored.raw, {
          karaoke: null,
          synced: null,
          unsynced: null,
        });
        assert.deepEqual(restored.view.page, {
          tag: "LyricsUnavailableView",
          props: { isLoading: true },
        });
        assert.deepEqual(
          restored.state.lyrics,
          [],
          "catch must retain the cleared display",
        );
        assert.equal(h.providerCalls.length, before.calls + 1);
        assert.equal(h.persistentWrites.length, before.writes);
        assert.equal(
          h.toasts.slice(before.toasts).filter((t) => t.kind === "error")
            .length,
          1,
        );
        assert.equal(
          h.toasts.slice(before.toasts).filter((t) => t.kind === "success")
            .length,
          0,
        );
        await recoverViaRetry(h);
        await finish(h);
        assert.deepEqual(
          ui(restored),
          { lyricsCount: 0, indicators: [] },
          "failure restoration must not republish retired A data during B handoff",
        );
      });
    if (target !== "all")
      test(`successful ${target} completion without stream does not republish while unresolved; queued=${queuedState}`, async () => {
        const h = make({ queuedState, mode1, mode2 });
        await initial(h);
        const view = installConsumers(h);
        await h.settle();
        const before = mark(h);
        select(h, target);
        const old = h.providerCalls.at(-1);
        await unresolved(h);
        old.resolve(h.result(old, "unstreamed completion"));
        await h.settle();
        const completed = await inspect(h, view);
        assert.equal(h.progress.length, before.progress);
        assert.deepEqual(ui(completed), { lyricsCount: 0, indicators: [] });
        assert.equal(completed.state.isLoading, true);
        assert.equal(
          h.toasts.slice(before.toasts).filter((t) => t.kind === "success")
            .length,
          1,
        );
        assert.equal(h.persistentWrites.length, before.writes + 2);
        await recoverViaRetry(h);
        await finish(h);
      });
  }

for (const queuedState of [false, true])
  test(`second-mode failure restoration preserves unresolved transition clear; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1: "gemini_romaji", mode2: "gemini_ko" });
    await initial(h);
    const view = installConsumers(h);
    await h.settle();
    const before = mark(h);
    select(h);
    const old = h.providerCalls.at(-1);
    await unresolved(h);
    old.resolve(h.result(old, "first mode completed"));
    await h.settle();
    const second = h.providerCalls.at(-1);
    assert.notStrictEqual(second, old);
    second.reject(Error("inert second mode failure"));
    await h.settle();
    const restorationTimer = h.c.streamingApplyTimer;
    assert.ok(restorationTimer);
    await h.advance(50);
    const restored = await inspect(h, view);
    assert.deepEqual(restored.state.lyrics, []);
    assert.equal(restored.state.isLoading, true);
    assert.equal(h.providerCalls.length, before.calls + 2);
    assert.equal(
      h.persistentWrites.length,
      before.writes + 1,
      "only admitted first Translator has persisted",
    );
    await recoverViaRetry(h);
    await finish(h);
    assert.deepEqual(ui(restored), { lyricsCount: 0, indicators: [] });
  });

for (const queuedState of [false, true])
  for (const path of ["stream", "failure"])
    test(`post-timeout ${path} stays retired until B commits; queued=${queuedState}`, async () => {
      const h = make({ queuedState });
      await initial(h);
      const view = installConsumers(h);
      await h.settle();
      h.click();
      const old = h.providerCalls.at(-1);
      await unresolved(h);
      await h.advance(4000);
      h.button();
      await h.settle();
      const terminal = await inspect(h, view);
      assert.equal(terminal.state.isLoading, false);
      assert.equal(terminal.state.error, "Playback transition unresolved");
      assert.deepEqual(ui(terminal), { lyricsCount: 0, indicators: [] });
      assert.equal(h.c._playbackTrackResolutionTimer, null);
      if (path === "stream")
        old.options.onLine(0, "fresh callback after timeout");
      else old.reject(Error("fresh rejection after timeout"));
      await h.settle();
      await h.advance(50);
      h.button();
      await h.settle();
      const late = await inspect(h, view);
      assert.equal(late.state.snapshotUri, B);
      assert.equal(late.state.currentUri, A);
      assert.equal(late.state.isLoading, false);
      assert.equal(late.view.page.tag, "LyricsUnavailableView");
      assert.equal(terminal.renderKey, "-1_gemini_ko_none_culture-off");
      assert.equal(late.renderKey, terminal.renderKey);
      // The bounded retry has ended. A real new full-item notification commits B.
      await h.load(track(B));
      await finish(h);
      assert.deepEqual(ui(late), { lyricsCount: 0, indicators: [] });
    });

for (const queuedState of [false, true])
  test(`post-timeout different fallback mode retains the clear; queued=${queuedState}`, async () => {
    const h = make({ queuedState });
    // Valid existing per-language settings: untranslated fallback, translated A.
    // No processed marker is assigned; both keys are produced by real render code.
    h.config.visual["translation-mode:gemini"] = "none";
    await initial(h);
    const view = installConsumers(h);
    await h.settle();
    h.click();
    const old = h.providerCalls.at(-1);
    await unresolved(h);
    await h.advance(4000);
    const terminal = await inspect(h, view);
    assert.equal(terminal.renderKey, "-1_none_none_culture-off");
    old.options.onLine(0, "late source with a different render key");
    await h.advance(50);
    const beforeRender = h.snapshot();
    assert.equal(beforeRender.lyrics.length, 0);
    const repairedByMode = await inspect(h, view);
    assert.equal(repairedByMode.renderKey, terminal.renderKey);
    assert.deepEqual(ui(repairedByMode), { lyricsCount: 0, indicators: [] });
    const settledView = await inspect(h, view);
    assert.equal(settledView.renderKey, terminal.renderKey);
    assert.deepEqual(ui(settledView), { lyricsCount: 0, indicators: [] });
    await h.load(track(B));
    await finish(h);
  });

// Timer sampling and payload replacement are helper contracts. They do not
// assert that a platform notification always arrives at either boundary.
for (const queuedState of [false, true]) {
  for (const returnsToA of [false, true])
    test(`sample playback at apply; returnsToA=${returnsToA}; queued=${queuedState}`, async () => {
      const h = make({ queuedState });
      await initial(h);
      h.click();
      const old = h.providerCalls.at(-1);
      await unresolved(h);
      h.setPlayback(
        track(returnsToA ? B : A, false),
        track(returnsToA ? A : B),
      );
      old.options.onLine(0, "apply-time sample");
      await h.advance(49);
      assert.equal(h.c.state.currentLyrics.length, 0);
      h.setPlayback(
        track(returnsToA ? A : B, false),
        track(returnsToA ? B : A),
      );
      await h.advance(1);
      const published = clone(h.c.state.currentLyrics);
      await recoverViaRetry(h);
      await finish(h);
      assert.equal(published.length, returnsToA ? 1 : 0);
      if (returnsToA)
        assert.ok(JSON.stringify(published).includes("apply-time sample"));
    });

  for (const lastTagged of [false, true])
    test(`latest coalesced payload owns the guard; lastTagged=${lastTagged}; queued=${queuedState}`, async () => {
      const h = make({ queuedState });
      await initial(h);
      h.click();
      const old = h.providerCalls.at(-1);
      await unresolved(h);
      old.options.onLine(0, "tagged explicit result");
      const tagged = h.progress.at(-1);
      const untagged = { ...tagged, lyricsMode1: ["untagged replacement"] };
      delete untagged.requirePlaybackUri;
      const timer = h.c.streamingApplyTimer;
      h.c.applyStreamingTranslation(untagged);
      if (lastTagged) h.c.applyStreamingTranslation(tagged);
      assert.equal(h.c.streamingApplyTimer, timer);
      await h.advance(50);
      const published = clone(h.c.state.currentLyrics);
      assert.equal(h.c.pendingStreamingPayload, null);
      assert.equal(h.c.streamingApplyTimer, null);
      await recoverViaRetry(h);
      await finish(h);
      assert.equal(published.length, lastTagged ? 0 : 1);
      if (!lastTagged)
        assert.ok(JSON.stringify(published).includes("untagged replacement"));
    });

  test(`reader exception retires only tagged display and permits later recovery; queued=${queuedState}`, async () => {
    const h = make({ queuedState });
    await initial(h);
    h.click();
    const old = h.providerCalls.at(-1);
    await unresolved(h);
    old.options.onLine(0, "must not publish on read failure");
    const original = h.window.Utils.getPlayerPlaybackSnapshot;
    let reads = 0;
    h.window.Utils.getPlayerPlaybackSnapshot = () => {
      reads++;
      throw Error("inert playback read failure");
    };
    try {
      await h.advance(50);
    } finally {
      h.window.Utils.getPlayerPlaybackSnapshot = original;
    }
    const rejected = clone(h.c.state.currentLyrics);
    assert.equal(h.c.pendingStreamingPayload, null);
    assert.equal(h.c.streamingApplyTimer, null);
    // No resolver notification: retain the existing URI-only return-to-A policy.
    h.setPlayback(track(A, false), track(B));
    old.options.onLine(0, "valid later payload");
    await h.advance(50);
    const recovered = clone(h.c.state.currentLyrics);
    await recoverViaRetry(h);
    await finish(h);
    assert.equal(reads, 1);
    assert.deepEqual(rejected, []);
    assert.ok(JSON.stringify(recovered).includes("valid later payload"));
  });

  test(`untagged payload never consults the new reader or inherits a prior guard; queued=${queuedState}`, async () => {
    const h = make({ queuedState });
    await initial(h);
    h.click();
    const old = h.providerCalls.at(-1);
    // Isolate this helper call from the independent resolution-retry timer.
    h.setPlayback(track(B, false), track(A));
    old.options.onLine(0, "retired tagged result");
    const untagged = {
      ...h.progress.at(-1),
      lyricsMode1: ["default caller result"],
    };
    delete untagged.requirePlaybackUri;
    await h.advance(50);
    const original = h.window.Utils.getPlayerPlaybackSnapshot;
    let reads = 0;
    h.window.Utils.getPlayerPlaybackSnapshot = () => {
      reads++;
      throw Error("must not consult reader");
    };
    h.c.applyStreamingTranslation(untagged);
    try {
      await h.advance(50);
    } finally {
      h.window.Utils.getPlayerPlaybackSnapshot = original;
    }
    const published = clone(h.c.state.currentLyrics);
    await h.load(track(B));
    await finish(h);
    assert.equal(reads, 0);
    assert.ok(JSON.stringify(published).includes("default caller result"));
  });
}

for (const helper of ["absent", "null", "empty"])
  for (const publicUri of [A, B, null]) {
    test(`existing URI fallback: helper=${helper}, public=${publicUri}`, async () => {
      const h = make();
      await initial(h);
      h.click();
      const old = h.providerCalls.at(-1);
      await unresolved(h);
      const original = h.window.Utils.getPlayerPlaybackSnapshot;
      h.window.Utils.getPlayerPlaybackSnapshot =
        helper === "absent" ? undefined : () => (helper === "null" ? null : {});
      h.spicetify.Player.data.item = publicUri ? track(publicUri) : null;
      old.options.onLine(0, "fallback compatibility");
      try {
        await h.advance(50);
      } finally {
        h.window.Utils.getPlayerPlaybackSnapshot = original;
      }
      const published = clone(h.c.state.currentLyrics);
      await recoverViaRetry(h);
      await finish(h);
      assert.equal(published.length, publicUri === B ? 0 : 1);
    });
  }

test("the reader catch does not suppress optimizer errors", async () => {
  const h = make();
  await initial(h);
  h.click();
  const old = h.providerCalls.at(-1);
  old.options.onLine(0, "optimizer boundary");
  const original = h.c.optimizeTranslations;
  const failure = Error("inert optimizer error");
  h.c.optimizeTranslations = () => {
    throw failure;
  };
  try {
    await assert.rejects(h.advance(50), (error) => error === failure);
  } finally {
    h.c.optimizeTranslations = original;
  }
  assert.equal(h.c.pendingStreamingPayload, null);
  assert.equal(h.c.streamingApplyTimer, null);
  await finish(h);
});
