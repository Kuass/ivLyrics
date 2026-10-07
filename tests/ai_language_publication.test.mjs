import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import {
  harness,
  A,
  B,
  track,
  flush,
  uncertainLines,
  certainLines,
  drains,
} from "./helpers/ai_language_harness.mjs";

const answer = { language: "ko", confidence: 0.99 };
const asPlain = (value) => JSON.parse(JSON.stringify(value));
const ready = (h, uri, language) => {
  assert.equal(h.c.currentTrackUri, uri);
  assert.equal(h.c.state.uri, uri);
  assert.equal(h.c.state.lyricsDisplayUri, uri);
  assert.equal(h.c.state.isLoading, false);
  assert.equal(h.c.provideLanguageCode(h.c.state.currentLyrics), language);
};
async function beginA(options) {
  const h = harness(options);
  h.enablePresentation();
  await h.play(track(A));
  ready(h, A, "en");
  assert.equal(
    h.aiCalls.length,
    1,
    "actual fetch admits one automatic detector request",
  );
  assert.equal(h.context.window.AIAddonManager.hasJsonProvider(), true);
  assert.equal(h.aiCalls[0].options.type, "languageDetection");
  assert.ok(h.aiCalls[0].prompt.userPrompt.includes("Song: Track A"));
  for (const line of uncertainLines)
    assert.ok(h.aiCalls[0].prompt.userPrompt.includes(line.text));
  return h;
}
async function acknowledge(h) {
  const write = h.write();
  assert.equal(write.key, A);
  write.resolve();
  await flush();
  return write;
}
function currentContract(h) {
  return {
    current: h.c.currentTrackUri,
    stateUri: h.c.state.uri,
    displayUri: h.c.state.lyricsDisplayUri,
    language: h.c.provideLanguageCode(h.c.state.currentLyrics),
    override: h.c.trackLanguageOverride,
    consumerLanguages: h.translationCalls
      .filter((call) => call.trackId === B.slice(14))
      .map((call) => call.sourceLang),
  };
}
// Preserve identity as well as contents: clearing display caches or forcing a
// render for the origin must not publish into the replacement container.
function capturePublication(h) {
  return {
    results: h.c._dmResults,
    resultsValue: asPlain(h.c._dmResults),
    uri: h.c.lastProcessedUri,
    mode: h.c.lastProcessedMode,
    renders: h.renders.length,
  };
}
function assertPublicationUnchanged(h, before) {
  assert.equal(h.c._dmResults, before.results);
  assert.deepEqual(asPlain(h.c._dmResults), before.resultsValue);
  assert.equal(h.c.lastProcessedUri, before.uri);
  assert.equal(h.c.lastProcessedMode, before.mode);
  assert.equal(h.renders.length, before.renders);
}

function checkContract(h, route, expectedOverride) {
  assert.equal(
    h.debugLogs.filter((message) =>
      message.startsWith("[ivLyrics] AI language detection:"),
    ).length,
    1,
    "origin acknowledgement is retained",
  );
  const actual = currentContract(h);
  assert.deepEqual(
    actual,
    {
      current: B,
      stateUri: B,
      displayUri: B,
      language: "ja",
      override: expectedOverride,
      consumerLanguages: [],
    },
    `${route}: a ready B retains its own language`,
  );
}

test("cold helper open: A completion preserves fully read B and its consumer language", async () => {
  const h = await beginA();
  h.context.presentationSnapshots.set(A, { marker: "A snapshot" });
  h.context.presentationSnapshots.set(B, { marker: "B snapshot" });
  h.holdOpens();
  h.aiCalls[0].resolve(answer);
  await flush();
  assert.equal(h.detectorOverrides.length, 1);
  assert.equal(h.detectorOverrides[0].current, A);
  assert.equal(h.opens.length, 2);
  assert.equal(h.opens[1].settled, false);
  assert.equal(
    h.requests.some((q) => q.operation === "put"),
    false,
    "no A transaction exists yet",
  );
  await h.play(track(B));
  ready(h, B, "ja");
  assert.equal(h.c.trackLanguageOverride, "ja");
  const readB = h.requests.find((q) => q.operation === "get" && q.key === B);
  assert.equal(readB.tx.finished, true);
  const before = capturePublication(h);
  h.opens[1].resolve();
  await flush();
  const write = await acknowledge(h);
  assert.equal(h.opens.length, 2, "B reused the service connection");
  assert.deepEqual(
    h.trace
      .filter((event) => event.kind === "transaction-create")
      .map((event) => [event.connection, event.mode]),
    [
      [1, "readonly"],
      [1, "readonly"],
      [2, "readwrite"],
    ],
  );
  assert.ok(readB.tx.id < write.tx.id, "B read is created before the A write");
  assert.equal(
    write.tx.finished,
    false,
    "request success and transaction completion remain separate",
  );
  assert.equal(h.storage.has(A), false);
  assert.equal(h.storage.get(B), "ja");
  assert.deepEqual(h.snapshotsCleared, [A]);
  assert.equal(h.context.presentationSnapshots.has(A), false);
  assert.equal(h.context.presentationSnapshots.has(B), true);
  assert.equal(h.context.providerGeneration(), 1);
  write.tx.complete();
  await flush();
  assert.equal(h.storage.get(A), "ko");
  assert.equal(h.storage.get(B), "ja");
  await h.finish();
  checkContract(h, "post-await cold-helper-open", "ja");
  assertPublicationUnchanged(h, before);
});

test("stale public A: admitted A refinement preserves ready unoverridden B", async () => {
  const h = await beginA({ seed: [] });
  await h.play(track(B), track(A));
  ready(h, B, "ja");
  assert.equal(h.c.trackLanguageOverride, null);
  assert.equal(h.clock.getSnapshot().uri, B);
  assert.equal(h.spicetify.Player.data.item.uri, A);
  assert.deepEqual(
    asPlain(
      h.context.window.LyricsService.detectLanguageDetailed(certainLines),
    ),
    { language: "ja", uncertain: false },
  );
  assert.equal(h.aiCalls.length, 1, "certain B never requested AI assistance");
  const before = capturePublication(h);
  const readB = h.requests.find((q) => q.operation === "get" && q.key === B);
  assert.equal(readB.tx.finished, true);
  h.aiCalls[0].resolve(answer);
  await flush();
  assert.equal(
    h.detectorOverrides[0].current,
    B,
    "admission occurs after B already owns the container",
  );
  const write = await acknowledge(h);
  assert.ok(readB.tx.id < write.tx.id);
  write.tx.complete();
  await h.finish();
  assert.equal(h.storage.get(A), "ko");
  assert.equal(h.storage.has(B), false);
  assert.deepEqual(h.snapshotsCleared, [A]);
  checkContract(h, "pre-await stale-public-admission", null);
  assertPublicationUnchanged(h, before);
});

test("actual detector marks both A source lines uncertain and B certain", async () => {
  const h = harness();
  for (const lines of [
    uncertainLines,
    [uncertainLines[0]],
    [uncertainLines[1]],
  ]) {
    assert.deepEqual(
      asPlain(h.context.window.LyricsService.detectLanguageDetailed(lines)),
      { language: "en", uncertain: true },
    );
  }
  assert.deepEqual(
    asPlain(
      h.context.window.LyricsService.detectLanguageDetailed(certainLines),
    ),
    { language: "ja", uncertain: false },
  );
  await h.finish();
});

test("actual CONFIG initializer defaults AI language detection to true", () => {
  const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const initializer = source.match(
    /"translate:ai-language-detection": StorageManager\.get\([\s\S]*?\n    \),/,
  )[0];
  const settings = vm.runInNewContext(`({${initializer}})`, {
    StorageManager: { get: (key, fallback) => fallback },
  });
  assert.equal(settings["translate:ai-language-detection"], true);
});

for (const [name, options] of [
  ["disabled provider", { providerEnabled: false }],
  ["disabled translation capability", { capabilityEnabled: false }],
  ["unsupported translation capability", { supportsTranslate: false }],
  ["no JSON method", { jsonMethod: false }],
]) {
  test(`actual provider availability rejects ${name}`, async () => {
    const h = harness(options);
    assert.equal(h.context.window.AIAddonManager.hasJsonProvider(), false);
    await h.play(track(A));
    assert.equal(h.aiCalls.length, 0);
    await h.finish();
  });
}

test("feature false prevents automatic refinement", async () => {
  const h = harness();
  h.config.visual["translate:ai-language-detection"] = false;
  await h.play(track(A));
  assert.equal(h.aiCalls.length, 0);
  await h.finish();
});

test("global configured override prevents caller admission", async () => {
  const h = harness();
  h.config.visual["translate:detect-language-override"] = "fr";
  await h.play(track(A));
  assert.equal(h.aiCalls.length, 0);
  ready(h, A, "fr");
  await h.finish();
});

test("actual stored A override prevents caller admission", async () => {
  const h = harness({
    seed: [
      [A, "fr"],
      [B, "ja"],
    ],
  });
  await h.play(track(A));
  assert.equal(h.aiCalls.length, 0);
  ready(h, A, "fr");
  assert.equal(h.requests[0].key, A);
  await h.finish();
});

for (const [name, sourceLines] of [
  ["certain source", certainLines],
  ["only one uncertain line", [uncertainLines[0]]],
]) {
  test(`${name} is not admitted`, async () => {
    const h = harness({ sourceLines });
    await h.play(track(A));
    assert.equal(h.aiCalls.length, 0);
    await h.finish();
  });
}

test("same source refresh retains one AI check per session", async () => {
  const h = await beginA();
  await h.c.fetchLyrics(track(A), -1, true);
  await flush();
  assert.equal(h.aiCalls.length, 1);
  assert.equal(h.c._aiLanguageChecks.size, 1);
  await h.finish();
});

for (const [name, response] of [
  ["same heuristic language", { language: "en", confidence: 0.99 }],
  ["low confidence", { language: "ko", confidence: 0.2 }],
  ["invalid code", { language: "not a code", confidence: 0.99 }],
  ["empty answer", null],
]) {
  test(`${name} leaves language and storage unchanged`, async () => {
    const h = await beginA();
    h.aiCalls[0].resolve(response);
    await flush();
    assert.equal(h.detectorOverrides.length, 0);
    assert.equal(
      h.requests.some((q) => q.operation === "put"),
      false,
    );
    ready(h, A, "en");
    await h.finish();
  });
}

test("AI transport rejection is contained without a write", async () => {
  const h = await beginA();
  h.expectWarnings(1);
  h.aiCalls[0].reject(Error("inert AI rejection"));
  await flush();
  assert.equal(h.detectorOverrides.length, 0);
  assert.equal(h.write(), undefined);
  ready(h, A, "en");
  await h.finish();
});

test("fresh public B rejects late A before detector cache and storage", async () => {
  const h = await beginA({ seed: [] });
  await h.play(track(B));
  h.aiCalls[0].resolve(answer);
  await flush();
  assert.equal(h.detectorOverrides.length, 0);
  assert.equal(h.write(), undefined);
  ready(h, B, "ja");
  await h.finish();
});

test("stored-ja B rejects stale-public-A admission through the existing local-override check", async () => {
  const h = await beginA();
  await h.play(track(B), track(A));
  h.aiCalls[0].resolve(answer);
  await flush();
  assert.equal(h.detectorOverrides.length, 0);
  assert.equal(h.write(), undefined);
  ready(h, B, "ja");
  await h.finish();
});

test("same-track successful request publishes before transaction commit", async () => {
  const h = await beginA();
  h.aiCalls[0].resolve(answer);
  await flush();
  const write = await acknowledge(h);
  ready(h, A, "ko");
  assert.equal(h.snapshotEvents[0].override, "ko");
  assert.ok(h.snapshotEvents[0].renders < h.renders.length);
  assert.equal(h.storage.has(A), false);
  assert.equal(write.tx.finished, false);
  assert.equal(h.translationCalls[0].sourceLang, "ko");
  write.tx.complete();
  await h.finish();
  assert.equal(h.storage.get(A), "ko");
});

test("a created A write blocks the later B read until commit, then B repairs normally", async () => {
  const h = await beginA();
  h.aiCalls[0].resolve(answer);
  await flush();
  const write = h.write();
  await h.play(track(B));
  const readB = h.requests.find((q) => q.operation === "get" && q.key === B);
  assert.ok(write.tx.id < readB.tx.id);
  assert.equal(readB.tx.started, false);
  assert.equal(readB.settled, false);
  assert.equal(h.c.state.isLoading, true);
  write.resolve();
  await flush();
  assert.equal(readB.tx.started, false);
  assert.equal(
    h.translationCalls.some((call) => call.trackId === B.slice(14)),
    false,
  );
  write.tx.complete();
  await flush();
  ready(h, B, "ja");
  assert.equal(readB.tx.finished, true);
  await h.finish();
});

test("request failure keeps origin detector-cache correction but does not publish over ready B", async () => {
  const h = await beginA();
  h.holdOpens();
  h.aiCalls[0].resolve(answer);
  await flush();
  await h.play(track(B));
  h.opens[1].resolve();
  await flush();
  h.expectWarnings(1);
  h.write().reject();
  await flush();
  ready(h, B, "ja");
  assert.deepEqual(
    asPlain(
      h.context.window.LyricsService.detectLanguageDetailed(uncertainLines),
    ),
    { language: "ko", uncertain: false },
  );
  assert.equal(h.storage.has(A), false);
  assert.equal(h.snapshotsCleared.length, 0);
  await h.finish();
});

test("same-track helper open failure retains current success-like fallback behavior", async () => {
  const h = await beginA();
  h.holdOpens();
  h.aiCalls[0].resolve(answer);
  await flush();
  h.expectErrors(2);
  h.opens[1].reject();
  await flush();
  ready(h, A, "ko");
  assert.equal(h.write(), undefined);
  assert.equal(h.storage.has(A), false);
  await h.finish();
});

test("request success followed by transaction abort is an unchanged storage boundary", async () => {
  const h = await beginA();
  h.aiCalls[0].resolve(answer);
  await flush();
  const write = await acknowledge(h);
  write.tx.abort();
  await flush();
  ready(h, A, "ko");
  assert.equal(h.storage.has(A), false);
  await h.finish();
});

test("unresolved URI-only B never becomes a ready B consumer", async () => {
  const h = await beginA();
  h.holdOpens();
  h.aiCalls[0].resolve(answer);
  await flush();
  await h.play({ uri: B }, track(A));
  assert.equal(h.c.currentTrackUri, A);
  assert.equal(h.c.state.isLoading, true);
  assert.equal(
    h.fetchInputs.some((info) => info.uri === B),
    false,
  );
  h.opens[1].resolve();
  await flush();
  const write = await acknowledge(h);
  write.tx.complete();
  await h.finish();
  assert.equal(
    h.translationCalls.some((call) => call.trackId === B.slice(14)),
    false,
  );
  assert.equal(h.c.state.error, "Playback transition unresolved");
});

test("A to B to A preserves the origin refinement without a latest-intent policy", async () => {
  const h = await beginA();
  h.holdOpens();
  h.aiCalls[0].resolve(answer);
  await flush();
  await h.play(track(B));
  ready(h, B, "ja");
  await h.play(track(A));
  assert.equal(h.c.currentTrackUri, A);
  assert.equal(
    h.aiCalls.length,
    1,
    "origin detector cache already has a certain correction",
  );
  h.opens[1].resolve();
  await flush();
  const write = await acknowledge(h);
  write.tx.complete();
  await h.finish();
  ready(h, A, "ko");
  assert.equal(h.storage.get(A), "ko");
});

test("cold helper open failure preserves ready B despite the existing success-like fallback", async () => {
  const h = await beginA();
  h.holdOpens();
  h.aiCalls[0].resolve(answer);
  await flush();
  await h.play(track(B));
  ready(h, B, "ja");
  const before = capturePublication(h);
  h.expectErrors(2);
  h.opens[1].reject();
  await flush();
  assert.equal(h.write(), undefined);
  assert.equal(h.storage.has(A), false);
  assert.equal(h.storage.get(B), "ja");
  assert.deepEqual(h.snapshotsCleared, [A]);
  assert.deepEqual(
    asPlain(
      h.context.window.LyricsService.detectLanguageDetailed(uncertainLines),
    ),
    { language: "ko", uncertain: false },
  );
  await h.finish();
  checkContract(h, "post-await cold-helper-open-failure", "ja");
  assertPublicationUnchanged(h, before);
});

for (const reader of ["absent", "throws"]) {
  test(`owned completion has no direct dependency on an optional ${reader} playback reader`, async () => {
    const h = await beginA();
    h.aiCalls[0].resolve(answer);
    await flush();
    const write = h.write();
    const originalReader = h.context.window.Utils.getPlayerPlaybackSnapshot;
    const originalRender = h.c.forceUpdate;
    let reads = 0;
    let renderAdmissions = 0;
    // Count completion admission here; the separate consumer tests keep real
    // presentation logic, including its own unrelated playback dependencies.
    h.c.forceUpdate = () => {
      renderAdmissions++;
    };
    h.context.window.Utils.getPlayerPlaybackSnapshot =
      reader === "absent"
        ? undefined
        : () => {
            reads++;
            throw Error("inert optional reader");
          };
    try {
      write.resolve();
      await flush();
      assert.equal(h.c.trackLanguageOverride, "ko");
      assert.equal(reads, 0);
      assert.equal(renderAdmissions, 1);
      assert.deepEqual(h.snapshotsCleared, [A]);
      assert.equal(
        h.snapshotEvents.at(-1).override,
        "ko",
        "owned assignment precedes origin clear",
      );
      write.tx.complete();
    } finally {
      h.c.forceUpdate = originalRender;
      h.context.window.Utils.getPlayerPlaybackSnapshot = originalReader;
      await h.finish();
    }
  });
}

for (const snapshotMethod of ["absent", "throws"]) {
  for (const current of [A, B]) {
    test(`${snapshotMethod} origin snapshot clearer preserves ${current === A ? "owned" : "foreign"} completion semantics`, async () => {
      const h = await beginA();
      h.holdOpens();
      h.aiCalls[0].resolve(answer);
      await flush();
      if (current === B) await h.play(track(B));
      const before = capturePublication(h);
      let snapshotCalls = 0;
      let overrideAtSnapshot;
      h.context.window.LyricsService.clearLyricsSnapshot =
        snapshotMethod === "absent"
          ? undefined
          : (uri) => {
              assert.equal(uri, A);
              snapshotCalls++;
              overrideAtSnapshot = h.c.trackLanguageOverride;
              throw Error("inert snapshot failure");
            };
      if (snapshotMethod === "throws") h.expectWarnings(1);
      h.opens[1].resolve();
      await flush();
      const write = await acknowledge(h);
      write.tx.complete();
      await h.finish();
      assert.equal(h.storage.get(A), "ko");
      assert.equal(h.storage.get(B), "ja");
      assert.equal(h.snapshotEvents.length, 0);
      assert.equal(snapshotCalls, snapshotMethod === "absent" ? 0 : 1);
      assert.equal(
        h.debugLogs.filter((message) =>
          message.startsWith("[ivLyrics] AI language detection:"),
        ).length,
        snapshotMethod === "absent" ? 1 : 0,
        "snapshot failure retains the existing catch and debug boundary",
      );
      ready(h, current, current === A ? "ko" : "ja");
      if (snapshotMethod === "throws") {
        assert.equal(overrideAtSnapshot, current === A ? "ko" : "ja");
        assertPublicationUnchanged(h, before);
        assert.equal(h.translationCalls.length, 0);
      } else if (current === B) {
        assertPublicationUnchanged(h, before);
        assert.equal(h.translationCalls.length, 0);
      } else {
        assert.notEqual(h.c._dmResults, before.results);
        assert.ok(h.renders.length > before.renders);
        assert.equal(h.translationCalls[0].sourceLang, "ko");
      }
    });
  }
}

test("same URI fetched again during the helper open still owns completion", async () => {
  const h = await beginA();
  h.holdOpens();
  h.aiCalls[0].resolve(answer);
  await flush();
  await h.c.fetchLyrics(track(A, "Updated Track A"), -1, true);
  await flush();
  ready(h, A, "ko");
  assert.equal(h.c.trackLanguageOverride, null);
  assert.equal(h.aiCalls.length, 1);
  const before = capturePublication(h);
  h.opens[1].resolve();
  await flush();
  const write = await acknowledge(h);
  assert.equal(h.c.trackLanguageOverride, "ko");
  assert.equal(h.snapshotEvents.at(-1).override, "ko");
  assert.notEqual(h.c._dmResults, before.results);
  assert.ok(h.renders.length > before.renders);
  assert.equal(write.tx.finished, false);
  write.tx.complete();
  await h.finish();
  ready(h, A, "ko");
});

test.after(() => {
  assert.equal(
    drains.length,
    35,
    "every harness, including failure cases, drained",
  );
  for (const drain of drains) {
    for (const [name, count] of Object.entries(drain)) {
      if (name.startsWith("pending")) assert.equal(count, 0, name);
    }
  }
});
