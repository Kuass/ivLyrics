import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(process.env.IVLYRICS_IMPORT_ARBITRATION_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_IMPORT_ARBITRATION_SOURCE_DIR, "index.js")
  : new URL("../index.js", import.meta.url), "utf8");
const { resolveStablePlayerItem } = createRequire(import.meta.url)("../PlaybackClock.js");
const extractMethod = (name) => {
  const start = source.search(new RegExp(`^  (?:async )?${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/^  (?:async )?\w+\(/m);
  assert.ok(next >= 0, `end of ${name}`);
  return source.slice(start, start + 1 + next);
};
const names = [
  "createLocalLyricsRequest", "isCurrentLocalLyricsRequest", "getParsedLocalLyricsTypes", "applyLocalLyrics",
  "isCurrentLyricsUri", "isCurrentLyricsState", "getLyricsLayoutHasLyrics",
  "getLoadingLyricsState", "fetchLyrics", "resolveLyricsForMode",
  "isPlaybackUriCurrent", "beginPlaybackTrackTransition",
  "clearPlaybackTrackResolutionTimer", "schedulePlaybackTrackResolution", "commitResolvedPlaybackTrack",
];
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const track = (id) => ({ uri: `spotify:track:${id}`, title: id, artist: "Artist" });
const lines = (text) => [{ text, startTime: 1000 }];

// Execute the production state/fetch methods. Collaborators model delayed
// provider requests, shared snapshots and playback identity independently.
const createHarness = () => {
  const requests = [];
  const snapshots = new Map();
  const publications = [];
  const presentations = [];
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  let currentTrack = track("old");
  let stableTrack;
  const emptyState = vm.runInNewContext(`(${source.match(/const emptyState = (\{[\s\S]*?\n\});/)[1]})`);
  const config = { modes: ["karaoke", "synced", "unsynced"], visual: {} };
  const context = vm.createContext({
    console, emptyState, CONFIG: config, SYNCED: 1, CACHE: {},
    Utils: { extractTrackId: uri => uri?.split(":").at(-1), detectLanguage: () => "en" },
    Spicetify: { Player: { data: { item: currentTrack } } },
    getLyricsDataMode: mode => mode,
    getLyricsModeTypeKey: mode => config.modes[mode],
    isLyricsRenderCacheCurrent: () => true,
    hasInstrumentalMarker: lyrics => lyrics.some(line => line.text === "Instrumental"),
    getCurrentTranslationTargetLanguage: () => "ko",
    getCurrentLyricsPronunciationNotation: () => "translation",
    getNonSectionLyricsText: lyrics => lyrics.map(line => line.text).join("\n"),
    TrackBackgroundDB: { getOverride: async () => null },
    Date: { now: () => now },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    window: {
      Translator: { clearInflightRequests() {} },
      Utils: {
        getPlayerPlaybackSnapshot: () => ({ uri: currentTrack.uri }),
        resolveStablePlaybackTrack: (candidate, snapshot) => stableTrack !== undefined
          ? stableTrack
          : resolveStablePlayerItem(context.Spicetify.Player.data, snapshot, candidate),
      },
      ivLyricsPresentationPublisher: { publishLyricsReady: detail => presentations.push(detail) },
      LyricsService: {
        getTrackLanguageOverride: async () => null,
        getTrackLyricsProviderOverride: async () => null,
        getLyricsSnapshot: uri => snapshots.get(uri),
        publishLyricsSnapshot: snapshot => publications.push(snapshot),
        getLyricsFromProviders(info) {
          const pending = deferred();
          requests.push({ info, ...pending });
          return pending.promise;
        },
      },
    },
  });
  vm.runInContext(`class Container {\n${names.map(extractMethod).join("\n")}\n}\nglobalThis.Container = Container;`, context);
  const container = new context.Container();
  Object.assign(container, {
    state: {
      ...emptyState, ...currentTrack, synced: lines("Old lyric"),
      currentLyrics: lines("Old lyric"), lyricsDisplayUri: currentTrack.uri,
      isLoading: false, lyricsStatus: "ready", lockedMode: -1, explicitMode: -1,
    },
    currentTrackUri: currentTrack.uri,
    _lyricsFetchSeq: 0, _activeLyricsFetchSeq: 0, _lyricsTransitionSeq: 0,
    _playbackTrackResolutionSeq: 0, _isComponentMounted: true,
    setState(patch, callback) { this.state = { ...this.state, ...patch }; callback?.(); },
    infoFromTrack: value => value,
    clearPendingLyricsUpdates() {}, closeLyricsEditModal() {},
    lyricsSaved: () => false,
    fetchMetadataTranslation() {}, fetchColors() {}, fetchTempo() {}, resetDelay() {},
    loadSavedVideoForTrack() {},
    startLyricsLoading: () => 1, clearLyricsLoading() {},
    getCurrentMode: () => 1,
    isModeAvailable: () => false,
    getAutomaticMode: state => state.karaoke?.length ? 0 : state.synced?.length ? 1 : state.unsynced?.length ? 2 : -1,
    applyTranslationStates: () => ({}),
    refineLanguageWithAI() {},
    getTranslationTargetLanguage: () => "ko",
  });
  return {
    container, context, requests, snapshots, publications, presentations, timers,
    play(nextTrack) { currentTrack = nextTrack; stableTrack = undefined; context.Spicetify.Player.data.item = nextTrack; },
    updateSnapshot(nextTrack) { currentTrack = nextTrack; stableTrack = undefined; },
    resolvePlayback(value) { stableTrack = value; },
    advance(ms) { now += ms; const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
};


function importHarness() {
  const h = createHarness();
  const saves = [], toasts = [], clears = [];
  h.context.Toast = { success: value => toasts.push(value), error() {} };
  h.context.CacheManager = { clearByUri() {} };
  h.context.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  h.context.window.dispatchEvent = () => {};
  Object.assign(h.container, {
    _localLyricsImportGeneration: 0,
    getText: (_key, fallback) => fallback,
    lyricsSource() {},
    saveLocalLyrics(uri, value) { saves.push({ uri, value }); },
    clearLyricsLoading(...args) { clears.push(args); },
  });
  return { ...h, saves, toasts, clears,
    apply(text = "Imported lyric") { return h.container.applyLocalLyrics({ synced: lines(text) }); },
  };
}

for (const failed of [false, true]) {
  test(`older provider ${failed ? "failure" : "success"} cannot overwrite an accepted local import`, async () => {
    const h = importHarness(); const c = h.container;
    const pending = c.fetchLyrics(track("old")); await flush();
    assert.equal(h.requests.length, 1);
    assert.equal(await h.apply(), true);
    const imported = h.context.CACHE[track("old").uri];
    if (failed) h.requests[0].reject(new Error("retired provider error"));
    else h.requests[0].resolve({ uri: track("old").uri, provider: "network", synced: lines("Late network lyric") });
    await pending;
    assert.equal(c.state.synced[0].text, "Imported lyric");
    assert.equal(c.state.provider, "local");
    assert.equal(c.state.error, null);
    assert.equal(h.context.CACHE[track("old").uri], imported);
    assert.equal(h.publications.at(-1).provider, "local");
    assert.equal(c.isCurrentLyricsState(c.state), true);
    assert.equal(h.saves.length, 1);
  });
}

test("an old provider response cannot overwrite imported cache after playback moves away", async () => {
  const h = importHarness(); const c = h.container;
  const pending = c.fetchLyrics(track("old")); await flush();
  await h.apply();
  const imported = h.context.CACHE[track("old").uri];
  h.play(track("next")); c.beginPlaybackTrackTransition(track("next")); c.currentTrackUri = track("next").uri;
  h.requests[0].resolve({ uri: track("old").uri, provider: "network", synced: lines("Late network lyric") });
  await pending;
  assert.equal(h.context.CACHE[track("old").uri], imported);
  assert.equal(h.publications.at(-1).provider, "local");
});

test("accepted import retires the old request before asynchronous track overrides finish", async () => {
  const h = importHarness(); const metadata = deferred();
  h.context.window.LyricsService.getTrackLanguageOverride = () => metadata.promise;
  const pending = h.container.fetchLyrics(track("old"));
  await h.apply();
  const imported = h.context.CACHE[track("old").uri];
  metadata.resolve("ko"); await pending;
  assert.equal(h.requests.length, 0);
  assert.equal(h.container.state.provider, "local");
  assert.equal(h.context.CACHE[track("old").uri], imported);
  assert.equal(h.publications.length, 1);
});

test("an old saved-local normalization cannot replace a newer manual import", async () => {
  const h = importHarness();
  h.context.Utils.extractTrackId = () => null;
  h.container.getSavedLocalLyrics = () => ({ synced: lines("Old saved lyric"), provider: "local" });
  const oldNormalization = deferred();
  h.context.window.PseudoKaraokeService = { applyToResult: () => oldNormalization.promise };
  const pending = h.container.fetchLyrics(track("old")); await flush();
  h.context.window.PseudoKaraokeService = null;
  await h.apply();
  const imported = h.context.CACHE[track("old").uri];
  oldNormalization.resolve(); await pending;
  assert.equal(h.context.CACHE[track("old").uri], imported);
  assert.equal(h.container.state.synced[0].text, "Imported lyric");
});

test("a later deliberate refresh may replace imported lyrics normally", async () => {
  const h = importHarness();
  await h.apply();
  const pending = h.container.fetchLyrics(track("old"), -1, true); await flush();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ uri: track("old").uri, provider: "network", synced: lines("Fresh selection") });
  await pending;
  assert.equal(h.container.state.synced[0].text, "Fresh selection");
  assert.equal(h.context.CACHE[track("old").uri].provider, "network");
});

test("ordinary track changes still allow a retired provider to warm its own track cache", async () => {
  const h = importHarness();
  const pending = h.container.fetchLyrics(track("old")); await flush();
  h.play(track("next")); h.container.beginPlaybackTrackTransition(track("next")); h.container.currentTrackUri = track("next").uri;
  h.requests[0].resolve({ uri: track("old").uri, provider: "network", synced: lines("Cached old lyric") });
  await pending;
  assert.equal(h.context.CACHE[track("old").uri].synced[0].text, "Cached old lyric");
  assert.equal(h.publications.length, 0);
});

test("invalid manual input does not retire a valid provider request", async () => {
  const h = importHarness();
  const pending = h.container.fetchLyrics(track("old")); await flush();
  assert.equal(await h.container.applyLocalLyrics({}), false);
  h.requests[0].resolve({ uri: track("old").uri, provider: "network", synced: lines("Provider lyric") });
  await pending;
  assert.equal(h.container.state.synced[0].text, "Provider lyric");
});

test("a reentrant newer import during loading cleanup retains its cache and state", async () => {
  const h = importHarness();
  let newer;
  h.container.clearLyricsLoading = () => {
    if (!newer) {
      newer = true;
      newer = h.apply("Newer import");
    }
  };
  assert.equal(await h.apply("Retired import"), false);
  await newer;
  assert.equal(h.context.CACHE[track("old").uri].synced[0].text, "Newer import");
  assert.equal(h.container.state.synced[0].text, "Newer import");
  assert.equal(h.saves.length, 1);
});
