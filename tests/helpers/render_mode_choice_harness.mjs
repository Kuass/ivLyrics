import vm from "node:vm";
import { createHash } from "node:crypto";

// These are controlled state/callback adapters, not native React schedules.
// Only source bytes are variable. Every case and expectation applies unchanged.
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const modes = [0, 3, 1, 2];
const keys = { 0: "character", 3: "word", 1: "synced", 2: "unsynced" };
const lyricNames = { 0: "karaoke", 3: "karaoke", 1: "synced", 2: "unsynced" };

function bindSource(source) {
  const sections = [];
  function extract(id, start, end, includeEnd = false) {
    const a = source.indexOf(start);
    if (a < 0 || source.indexOf(start, a + start.length) !== -1) throw new Error(`nonunique ${id}`);
    const endStart = source.indexOf(end, a + start.length);
    if (endStart < 0) throw new Error(`missing end ${id}`);
    const b = endStart + (includeEnd ? end.length : 0);
    const text = source.slice(a, b);
    sections.push({ id, startUTF16: a, endUTF16: b,
      startByte: Buffer.byteLength(source.slice(0, a)), endByte: Buffer.byteLength(source.slice(0, b)),
      startLine: source.slice(0, a).split("\n").length, sha256: hash(text), text });
    return text;
  }
  const helpers = extract("helpers", "const KARAOKE = 0;", "  return normalizedMode;\n};", true);
  const resolver = extract("resolver", "  resolveLyricsForMode(lyricsState, mode) {", "  lyricsSource(lyricsState, mode) {");
  const selectors = extract("selectors", "  isModeAvailable(mode, lyricsState = this.state) {", "  render() {");
  const choose = extract("switchTo", "  switchTo(mode) {", "  toggleModeLock(mode, event = null) {");
  const toggle = extract("toggleModeLock", "  toggleModeLock(mode, event = null) {", "\n}\n\n// 초기화 시 저장된 Google Fonts 로드");
  const buttons = extract("computeModeButtons", "    const computeModeButtons = () => {", "    const modeButtons = computeModeButtons();");
  const bundle = `${helpers}\nclass ActualMethods {\n${resolver}${selectors}${choose}${toggle}
    buttons() { const mode = this.getCurrentMode(); ${buttons} return computeModeButtons(); }
  }
  globalThis.bound = {ActualMethods, normalizeLyricsRenderModeLock,
    getRememberedLyricsRenderModeLock, rememberLyricsRenderModeLock};`;
  const script = new vm.Script(bundle, { filename: "actual-render-mode-methods.js" });
  return { script, sections, bundleSHA256: hash(bundle) };
}

function fixture(script, options = {}) {
  const checks = [], events = [], frames = [], queue = [], callbacks = [];
  const named = new Map(), names = new Map();
  const makeArray = (name, empty = false) => {
    const value = empty ? [] : [{ text: name }];
    named.set(name, value); names.set(value, name); return value;
  };
  const lock = options.lock ?? 0;
  let persisted = String(options.persisted ?? lock), phase = "admission";
  const error = new Error("inert storage failure");
  const config = { modes: ["karaoke", "synced", "unsynced"], visual: { "karaoke-mode-enabled": options.enabled ?? true } };
  const context = vm.createContext({ CONFIG: config,
    StorageManager: {
      getItem(key) { events.push({ type: "read", key, phase }); if (options.readFails) throw error; return persisted; },
      setItem(key, value) {
        events.push({ type: "write", key, value, phase, fails: !!options.writeFails });
        if (options.writeFails) throw error;
        persisted = value;
      },
    },
    ivLyricsDebug(message, caught) { events.push({ type: "error-log", message, sameError: caught === error }); },
    react: { createElement(type, props, ...children) { return { type, props, children }; } },
    IvLyricsTooltip: "InertTooltip", I18n: { t: (key) => key },
    renderFloatingToolbarIcon: (name) => ({ inertIcon: name }),
  });
  script.runInContext(context);
  const bound = context.bound, c = new bound.ActualMethods();
  c.state = { lockedMode: lock, explicitMode: -1,
    karaoke: options.karaoke === false ? null : makeArray("karaoke", options.empty),
    synced: options.synced === false ? null : makeArray("synced", options.empty),
    unsynced: options.unsynced === false ? null : makeArray("unsynced", options.empty),
    currentLyrics: makeArray("initial") };
  c.lastProcessedMode = "initial-marker";
  const check = (id, actual, expected) => checks.push({ id, actual, expected,
    pass: JSON.stringify(actual) === JSON.stringify(expected) });
  const writes = () => events.filter((event) => event.type === "write");
  const name = (value) => value == null ? null : names.get(value) ?? "unregistered-array";
  const small = () => ({ lock: c.state.lockedMode, explicit: c.state.explicitMode,
    current: name(c.state.currentLyrics), resolved: c.getCurrentMode(), persisted });
  const snapshot = (label) => {
    const frame = { label, ...small(), pendingUpdates: queue.length, pendingCallbacks: callbacks.length,
      buttons: c.buttons().map((wrapper) => ({ key: wrapper.props.key, ...Object.fromEntries(
        ["aria-pressed", "data-mode-locked", "className", "aria-label"].map((key) => [key, wrapper.children[0].props[key]])) })) };
    frames.push(frame); return frame;
  };
  function evaluate(item, prevState = c.state) {
    const beforeWrites = writes().length, oldPhase = phase;
    phase = "evaluation";
    const patch = typeof item.update === "function" ? item.update(prevState) : item.update;
    phase = oldPhase;
    check("evaluation has no storage writes", writes().length, beforeWrites);
    events.push({ type: "evaluate", prevLock: prevState.lockedMode, patchLock: patch?.lockedMode ?? "omitted",
      current: name(patch?.currentLyrics) });
    return patch;
  }
  function invoke(callback) {
    const oldPhase = phase; phase = "callback";
    events.push({ type: "callback", state: small() }); callback(); phase = oldPhase;
  }
  function apply(item, prevState = c.state, delayCallback = false) {
    const patch = evaluate(item, prevState);
    c.state = { ...prevState, ...patch };
    events.push({ type: "commit", state: small() });
    if (item.callback) {
      if (delayCallback) callbacks.push(item.callback);
      else invoke(item.callback);
    }
  }
  c.setState = (update, callback) => {
    events.push({ type: "enqueue", state: small() });
    const item = { update, callback };
    if (options.deferred) queue.push(item); else apply(item);
  };
  c.lyricsSource = (state, mode) => events.push({ type: "lyricsSource", sameState: state === c.state,
    mode, lyrics: name(c.resolveLyricsForMode(state, mode)) });
  const button = (mode) => {
    const wrapper = c.buttons().find((entry) => entry.props.key === keys[mode]);
    if (!wrapper) throw new Error(`actual button unavailable at admission: ${mode}`);
    return wrapper.children[0];
  };
  const click = (mode) => { events.push({ type: "click", mode }); button(mode).props.onClick(); };
  const right = (mode) => {
    events.push({ type: "right-click", mode });
    button(mode).props.onContextMenu({
      preventDefault() { events.push({ type: "preventDefault" }); },
      stopPropagation() { events.push({ type: "stopPropagation" }); },
    });
  };
  const drainCallbacks = () => { while (callbacks.length) invoke(callbacks.shift()); };
  const drain = (schedule) => {
    while (queue.length) apply(queue.shift(), c.state, schedule === "batch-before-callbacks");
    drainCallbacks();
  };
  const expect = (expected, label = "state") => {
    snapshot(label);
    for (const key of ["lock", "explicit", "resolved", "persisted"]) {
      check(`${label}: ${key}`, small()[key], key === "persisted" ? String(expected[key]) : expected[key]);
    }
    check(`${label}: current lyric identity`, c.state.currentLyrics === named.get(expected.current), true);
    if (expected.resolvedLyrics !== null) {
      check(`${label}: resolved lyric identity`, c.resolveLyricsForMode(c.state, c.getCurrentMode()) === named.get(expected.resolvedLyrics), true);
    } else check(`${label}: resolved lyrics absent`, c.resolveLyricsForMode(c.state, c.getCurrentMode()), null);
    const actualButtons = c.buttons();
    if (expected.buttons) check(`${label}: available buttons`, actualButtons.map((x) => x.props.key), expected.buttons.map((x) => keys[x]));
    check(`${label}: active buttons`, actualButtons.filter((x) => x.children[0].props["aria-pressed"]).map((x) => x.props.key),
      expected.resolved === -1 ? [] : [keys[expected.resolved]]);
    for (const wrapper of actualButtons) {
      const mode = modes.find((value) => keys[value] === wrapper.props.key), props = wrapper.children[0].props;
      check(`${label}: ${wrapper.props.key} lock attribute`, props["data-mode-locked"], mode === expected.lock);
      check(`${label}: ${wrapper.props.key} active class`, props.className.split(/\s+/).includes("active"), mode === expected.resolved);
      check(`${label}: ${wrapper.props.key} lock class`, props.className.split(/\s+/).includes("mode-locked"), mode === expected.lock);
      check(`${label}: ${wrapper.props.key} accessible label`, props["aria-label"],
        `modes.${keys[mode]} · modes.rightClickTo${mode === expected.lock ? "Unlock" : "Lock"}`);
    }
  };
  const expectWrites = (values) => check("exact applicable writes", writes().map((event) => Number(event.value)), values);
  const external = (patch, saved) => {
    c.state = { ...c.state, ...patch };
    if (saved !== undefined) persisted = String(saved);
    events.push({ type: "external-state", state: small(), changesStorage: saved !== undefined });
  };
  return { c, bound, config, events, checks, frames, queue, callbacks, makeArray, named, check, snapshot,
    evaluate, apply, drainCallbacks, drain, click, right, expect, expectWrites, external, writes };
}

export function observeModeChoices(source) {
  const binding = bindSource(source), cases = [];
  function scenario(id, options, run) {
    const f = fixture(binding.script, options);
    try {
      f.snapshot("before"); run(f);
      f.check("all updates drained", f.queue.length, 0);
      f.check("all callbacks drained", f.callbacks.length, 0);
      f.check("no storage write in updater evaluation", f.writes().some((x) => x.phase === "evaluation"), false);
      f.check("all persistence uses the established key", f.writes().every((x) => x.key === "ivLyrics:visual:render-mode-lock"), true);
      f.snapshot("final");
    } catch (error) {
      f.check("scenario completed without runtime error", { name: error.name, message: error.message, stack: error.stack }, null);
    }
    cases.push({ id, checks: f.checks, frames: f.frames, events: f.events });
  }
  const chosen = (mode, lock = mode, saved = lock, current = lyricNames[mode]) =>
    ({ lock, explicit: mode, resolved: mode, current, resolvedLyrics: current, persisted: saved, buttons: modes });

  for (const lock of modes) for (const choose of modes) {
    scenario(`available-${lock}-to-${choose}`, { lock }, (f) => {
      f.click(choose); f.expect(chosen(choose));
      f.check("processed marker invalidated", f.c.lastProcessedMode, null);
      f.expectWrites(lock === choose ? [] : [choose]);
      f.check("ordinary click does not invoke lyricsSource", f.events.filter((x) => x.type === "lyricsSource").length, 0);
    });
  }
  for (const mode of modes) scenario(`unlocked-${mode}`, { lock: -1 }, (f) => {
    f.click(mode); f.expect(chosen(mode, -1)); f.expectWrites([]);
  });
  for (const kind of ["unavailable", "disabled"]) for (const lock of [0, 3]) for (const choose of [1, 2]) {
    scenario(`${kind}-${lock}-to-${choose}`, { lock, karaoke: kind === "unavailable" ? false : undefined,
      enabled: kind === "disabled" ? false : undefined }, (f) => {
      f.click(choose); f.expect({ ...chosen(choose, lock), buttons: [1, 2] }); f.expectWrites([]);
    });
  }
  scenario("empty-arrays-are-available", { empty: true }, (f) => {
    f.click(1); f.expect(chosen(1)); f.expectWrites([1]); f.check("empty lyric identity", f.c.state.synced.length, 0);
  });
  scenario("repeated-committed-choice", {}, (f) => {
    f.click(1); f.expect(chosen(1), "first"); f.click(1); f.expect(chosen(1), "repeat"); f.expectWrites([1]);
  });
  scenario("right-click-lock-and-unlock", { lock: -1 }, (f) => {
    f.right(3); f.expect(chosen(3), "locked");
    f.right(3); f.expect({ lock: -1, explicit: -1, resolved: 0, current: "karaoke", resolvedLyrics: "karaoke", persisted: -1, buttons: modes }, "unlocked");
    f.expectWrites([3, -1]);
    for (const type of ["preventDefault", "stopPropagation", "lyricsSource"]) f.check(`two ${type}`, f.events.filter((x) => x.type === type).length, 2);
    f.check("right-click callbacks have current state", f.events.filter((x) => x.type === "lyricsSource").every((x) => x.sameState), true);
    f.check("right-click callback modes", f.events.filter((x) => x.type === "lyricsSource").map((x) => x.mode), [3, 0]);
    f.check("right-click invalidates marker", f.c.lastProcessedMode, null);
  });
  scenario("normalization", {}, (f) => {
    const inputs = [null, undefined, "", "0", "3", "1", "2", -1, "garbage", 4, false, true, "  "];
    const expected = [-1, -1, -1, 0, 3, 1, 2, -1, -1, -1, 0, 1, 0];
    inputs.forEach((value, i) => f.check(`normalization-${i}`, f.bound.normalizeLyricsRenderModeLock(value), expected[i]));
    f.expectWrites([]);
  });
  scenario("storage-read-failure", { readFails: true }, (f) => {
    f.check("read failure is unlocked", f.bound.getRememberedLyricsRenderModeLock(), -1); f.expectWrites([]);
  });
  for (const action of ["click", "right"]) scenario(`${action}-storage-write-failure-and-reload`, { writeFails: true }, (f) => {
    f[action](1); f.expect(chosen(1, 1, 0), "committed despite failed storage"); f.expectWrites([1]);
    f.check("exact swallowed error", f.events.filter((x) => x.type === "error-log").map((x) => x.sameError), [true]);
    f.check("old persisted lock retained", f.bound.getRememberedLyricsRenderModeLock(), 0);
    f.external({ lockedMode: f.bound.getRememberedLyricsRenderModeLock(), explicitMode: -1 });
    f.expect({ lock: 0, explicit: -1, resolved: 0, current: "synced", resolvedLyrics: "karaoke", persisted: 0, buttons: modes }, "modeled reload");
  });
  scenario("successful-storage-reload", {}, (f) => {
    f.click(1); f.external({ lockedMode: f.bound.getRememberedLyricsRenderModeLock(), explicitMode: -1 });
    f.expect({ ...chosen(1), explicit: -1 }, "modeled reload"); f.expectWrites([1]);
  });
  scenario("unavailable-lock-resumes-after-modeled-track-change", { karaoke: false }, (f) => {
    f.click(1); f.expect({ ...chosen(1, 0), buttons: [1, 2] }, "first track");
    f.external({ explicitMode: -1, karaoke: null, synced: null, unsynced: null, currentLyrics: f.makeArray("loading", true) });
    f.expect({ lock: 0, explicit: -1, resolved: -1, current: "loading", resolvedLyrics: null, persisted: 0, buttons: [] }, "modeled loading");
    f.external({ karaoke: f.makeArray("next-karaoke"), synced: f.makeArray("next-synced"), unsynced: f.makeArray("next-unsynced") });
    f.expect({ lock: 0, explicit: -1, resolved: 0, current: "loading", resolvedLyrics: "next-karaoke", persisted: 0, buttons: modes }, "next track"); f.expectWrites([]);
  });
  scenario("automatic-order", { lock: -1 }, (f) => {
    f.check("karaoke first", f.c.getCurrentMode(), 0); f.external({ karaoke: null });
    f.check("synced next", f.c.getCurrentMode(), 1); f.external({ synced: null });
    f.check("plain next", f.c.getCurrentMode(), 2); f.external({ unsynced: null });
    f.check("none available", f.c.getCurrentMode(), -1); f.expectWrites([]);
  });

  for (const schedule of ["per-update-callbacks", "batch-before-callbacks"]) {
    const queueCase = (id, options, run) => scenario(`${schedule}/${id}`, { deferred: true, ...options }, (f) => run(f, schedule));
    const finish = (f, expected, perWrites, batchWrites = perWrites) => {
      f.check("no write before queued evaluation", f.writes().length, 0);
      f.drain(schedule); f.expect(expected); f.expectWrites(schedule === "per-update-callbacks" ? perWrites : batchWrites);
    };
    queueCase("return-to-original", {}, (f) => { f.click(1); f.click(0); finish(f, chosen(0), [1, 0], [0]); });
    queueCase("two-different-choices", {}, (f) => { f.click(1); f.click(2); finish(f, chosen(2), [1, 2], [2]); });
    queueCase("click-then-unlock", {}, (f) => {
      f.click(1); f.right(0);
      finish(f, { lock: -1, explicit: -1, resolved: 0, current: "synced", resolvedLyrics: "karaoke", persisted: -1, buttons: modes }, [1, -1], [-1]);
      f.check("unlock callback retained", f.events.filter((x) => x.type === "lyricsSource").map((x) => x.mode), [0]);
    });
    queueCase("unlock-then-click", {}, (f) => { f.right(0); f.click(1); finish(f, chosen(1, -1), [-1]); });
    queueCase("repeated-clicks", {}, (f) => { f.click(1); f.click(1); f.click(1); finish(f, chosen(1), [1]); });
    queueCase("repeated-right-unlock-admission", {}, (f) => {
      f.right(0); f.right(0);
      finish(f, { lock: -1, explicit: -1, resolved: 0, current: "initial", resolvedLyrics: "karaoke", persisted: -1, buttons: modes }, [-1, -1]);
      for (const type of ["preventDefault", "stopPropagation", "lyricsSource"]) f.check(`two ${type}`, f.events.filter((x) => x.type === type).length, 2);
    });
    queueCase("repeated-right-lock-admission", { lock: -1 }, (f) => {
      f.right(3); f.right(3); finish(f, chosen(3), [3, 3]);
      f.check("two lock callbacks", f.events.filter((x) => x.type === "lyricsSource").length, 2);
    });
    queueCase("different-right-locks", {}, (f) => {
      f.right(1); f.right(2); finish(f, chosen(2), [1, 2], [2]);
      f.check("both callbacks delivered", f.events.filter((x) => x.type === "lyricsSource").map((x) => x.mode), schedule === "per-update-callbacks" ? [1, 2] : [2, 2]);
    });
    queueCase("external-lock-before-evaluation", {}, (f) => { f.click(1); f.external({ lockedMode: 2 }); finish(f, chosen(1), [1]); });
    queueCase("external-unlock-before-evaluation", {}, (f) => { f.click(1); f.external({ lockedMode: -1 }); finish(f, chosen(1, -1, 0), []); });
    queueCase("external-data-before-evaluation", {}, (f) => {
      f.click(1); f.external({ karaoke: null, synced: f.makeArray("new-synced"), unsynced: f.makeArray("new-unsynced") });
      finish(f, { ...chosen(1, 0, 0, "new-synced"), buttons: [1, 2] }, []);
    });
    queueCase("configuration-before-evaluation", {}, (f) => {
      f.click(1); f.config.visual["karaoke-mode-enabled"] = false;
      finish(f, { ...chosen(1, 0), buttons: [1, 2] }, []);
    });
    queueCase("target-data-disappears-no-new-admission-policy", {}, (f) => {
      f.click(1); f.external({ synced: null });
      finish(f, { lock: 1, explicit: 1, resolved: 0, current: "karaoke", resolvedLyrics: "karaoke", persisted: 1, buttons: [0, 3, 2] }, [1]);
    });
    queueCase("all-data-disappears-keeps-current-fallback", {}, (f) => {
      f.click(1); f.external({ karaoke: null, synced: null, unsynced: null });
      finish(f, { lock: 0, explicit: 1, resolved: -1, current: "initial", resolvedLyrics: null, persisted: 0, buttons: [] }, []);
    });
    for (const action of ["click", "right"]) queueCase(`stale-${action}-callback`, {}, (f) => {
      f[action](1); f.check("no admission persistence", f.writes().length, 0);
      f.apply(f.queue.shift(), f.c.state, true);
      f.external({ lockedMode: 2 }, 2); f.drainCallbacks(); f.drain(schedule);
      f.expect({ lock: 2, explicit: 1, resolved: 2, current: "synced", resolvedLyrics: "unsynced", persisted: 2, buttons: modes }); f.expectWrites([]);
      f.check("stale callback delivery preserved", f.events.filter((x) => x.type === "lyricsSource").map((x) => x.mode), action === "right" ? [2] : []);
    });
    queueCase("repeated-updater-evaluation", {}, (f) => {
      f.click(1); const item = f.queue.shift();
      f.evaluate(item); f.evaluate(item); f.apply(item, f.c.state, schedule === "batch-before-callbacks"); f.drain(schedule);
      f.expect(chosen(1)); f.expectWrites([1]);
    });
    queueCase("discarded-update-no-commit-no-callback", {}, (f) => {
      f.click(1); f.evaluate(f.queue.shift()); f.drain(schedule);
      f.expect({ lock: 0, explicit: -1, resolved: 0, current: "initial", resolvedLyrics: "karaoke", persisted: 0, buttons: modes }); f.expectWrites([]);
    });
    queueCase("discarded-migration-then-same-lock-rebase", {}, (f) => {
      f.click(1); const item = f.queue.shift(); f.evaluate(item);
      const prev = { ...f.c.state, lockedMode: 1 };
      f.apply(item, prev, schedule === "batch-before-callbacks"); f.drain(schedule);
      f.expect(chosen(1, 1, 0)); f.expectWrites([]);
    });
    queueCase("discarded-nonmigration-then-migrating-rebase", {}, (f) => {
      f.click(1); const item = f.queue.shift(); f.evaluate(item, { ...f.c.state, lockedMode: 1 });
      f.apply(item, f.c.state, schedule === "batch-before-callbacks"); f.drain(schedule);
      f.expect(chosen(1)); f.expectWrites([1]);
    });
    queueCase("rebase-availability-and-lyrics-use-same-prevState", {}, (f) => {
      f.click(1); const item = f.queue.shift(); f.evaluate(item);
      const prev = { ...f.c.state, lockedMode: 3, karaoke: null, synced: f.makeArray("rebased-synced") };
      f.apply(item, prev, schedule === "batch-before-callbacks"); f.drain(schedule);
      f.expect({ ...chosen(1, 3, 0, "rebased-synced"), buttons: [1, 2] }); f.expectWrites([]);
    });
    queueCase("rebased-right-unlock-keeps-admission-decision", {}, (f) => {
      f.right(0); const item = f.queue.shift(); f.evaluate(item);
      const prev = { ...f.c.state, lockedMode: 2, currentLyrics: f.makeArray("rebased-current") };
      f.apply(item, prev, schedule === "batch-before-callbacks"); f.drain(schedule);
      f.expect({ lock: -1, explicit: -1, resolved: 0, current: "rebased-current", resolvedLyrics: "karaoke", persisted: -1, buttons: modes }); f.expectWrites([-1]);
      f.check("one rebased right callback", f.events.filter((x) => x.type === "lyricsSource").map((x) => x.mode), [0]);
    });
  }
  const checks = cases.flatMap((item) => item.checks);
  return { sourceSHA256: hash(source), bundleSHA256: binding.bundleSHA256, sections: binding.sections,
    summary: { cases: cases.length, checks: checks.length, failures: checks.filter((item) => !item.pass).length,
      failedCases: cases.filter((item) => item.checks.some((check) => !check.pass)).length }, cases };
}
