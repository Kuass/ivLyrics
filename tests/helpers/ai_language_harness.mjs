// Executes production source bodies for automatic language refinement, actual
// detection, provider availability, override readers/writers and playback/fetch.
// External transport, state scheduling and rendering remain inert boundaries.
// The store adapter is an ordering witness, not native IndexedDB execution.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const index = readFileSync(new URL("../../index.js", import.meta.url), "utf8");
const utilsSource = readFileSync(
  new URL("../../Utils.js", import.meta.url),
  "utf8",
);
const managerSource = readFileSync(
  new URL("../../AIAddonManager.js", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../../LyricsService.js", import.meta.url),
  "utf8",
);
const clockApi = createRequire(import.meta.url)("../../PlaybackClock.js");
const plain = (value) =>
  value == null ? value : JSON.parse(JSON.stringify(value));
const cut = (source, from, to) => {
  const a = source.indexOf(from),
    b = source.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `missing exact section ${from}`);
  return source.slice(a, b);
};
const method = (source, name, indent = "  ") => {
  const a = source.search(new RegExp(`^${indent}(?:async )?${name}\\(`, "m"));
  assert.ok(a >= 0, `missing ${name}`);
  const tail = source.slice(a),
    end = tail.search(new RegExp(`^${indent}\\}[,]?\\s*$`, "m"));
  assert.ok(end > 0, `missing end ${name}`);
  return tail.slice(0, end) + tail.slice(end).split("\n")[0];
};
export const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
export const A = "spotify:track:AAAAAAAAAAAAAAAAAAAAAA";
export const B = "spotify:track:BBBBBBBBBBBBBBBBBBBBBB";
export const DJ = "spotify:media:fixture-narration";
export const track = (uri, title = uri === A ? "Track A" : "Track B") => ({
  uri,
  type: "track",
  metadata: {
    title,
    artist_name: "Fixture artist",
    duration: "200000",
    image_url: "fixture-cover",
  },
});
const methods = [
  "infoFromTrack",
  "getLyricsLayoutHasLyrics",
  "getLoadingLyricsState",
  "isPlaybackUriCurrent",
  "beginPlaybackTrackTransition",
  "clearPlaybackTrackResolutionTimer",
  "schedulePlaybackTrackResolution",
  "commitResolvedPlaybackTrack",
  "commitDjNarrationTrack",
  "fetchLyrics",
  "resolveLyricsForMode",
  "provideLanguageCode",
  "lyricsSource",
  "getGeminiTranslation",
  "isCurrentLyricsUri",
  "isCurrentLyricsState",
  "refineLanguageWithAI",
];
const renderSource = cut(
  index,
  "    let showTranslationButton;",
  "    // 번역 재생성 버튼 활성화 조건 확인",
);
const active = new Set();
export const drains = [];
test.afterEach(async () => {
  for (const h of active) await h.finish();
});

// Actual persistence helpers run unchanged. This is an inert
// transaction event model, not IndexedDB or browser execution. Transactions on
// overlapping stores in one database cannot overtake an earlier write, including
// when they use separate connections. Request success and commit are separate.
// Opens for this single storage key are delivered in database-name queue order.
// https://w3c.github.io/IndexedDB/#connection-queue
export const uncertainLines = [
  { text: "saranghae neol gidarilge", startTime: 0 },
  { text: "byeolbichi nareul bichune", startTime: 1000 },
];
export const certainLines = [
  { text: "あなたの新しいうた", startTime: 0 },
  { text: "わたしのこころにひびく", startTime: 1000 },
];
export function harness({
  seed = [[B, "ja"]],
  sourceLines = uncertainLines,
  providerEnabled = true,
  supportsTranslate = true,
  jsonMethod = true,
  capabilityEnabled = true,
} = {}) {
  const storageWrites = [],
    snapshotEvents = [],
    visualUpdates = [];
  const aiCalls = [],
    aiTasks = [],
    detectorOverrides = [],
    fetchInputs = [];
  const settings = new Map([
    ["ivLyrics:ai:enabled:fixture-json", String(providerEnabled)],
    [
      "ivLyrics:ai:addon:fixture-json:capability:translate",
      String(capabilityEnabled),
    ],
  ]);
  const storage = new Map(seed),
    opens = [],
    transactions = [],
    requests = [],
    trace = [];
  const lyricTasks = [],
    snapshotsCleared = [],
    renders = [],
    warnings = [],
    errors = [],
    debugLogs = [],
    timers = new Map();
  const providerReads = [],
    backgroundReads = [],
    stateWrites = [],
    detections = [],
    translationCalls = [],
    translationTasks = [],
    pageCache = new Map();
  let nextId = 0,
    nextTimer = 0,
    now = 0,
    holdOpens = false,
    holdOther = false;
  let expectedWarnings = 0,
    expectedErrors = 0,
    snapshotFailure = null,
    emptySnapshot = false;
  const eligible = (tx) =>
    !transactions.some(
      (prior) =>
        prior.id < tx.id &&
        !prior.finished &&
        prior.db === tx.db &&
        prior.stores.some((store) => tx.stores.includes(store)) &&
        (prior.mode === "readwrite" || tx.mode === "readwrite"),
    );
  const pump = () => {
    for (const tx of transactions)
      if (!tx.started && !tx.finished && eligible(tx)) {
        tx.started = true;
        trace.push({ kind: "transaction-start", id: tx.id });
        for (const q of tx.requests) q.start();
      }
  };
  const indexedDB = {
    open(db, version) {
      const request = {},
        op = { db, version, settled: false };
      opens.push(op);
      trace.push({ kind: "open", db });
      const settleOpen = () => {
        assert.equal(op.settled, false);
        assert.equal(
          op,
          opens.find((entry) => entry.db === db && !entry.settled),
          "same-database opens must settle in request order",
        );
        op.settled = true;
      };
      op.resolve = () => {
        settleOpen();
        request.result = {
          transaction(stores, mode) {
            const tx = {
              id: ++nextId,
              db,
              stores,
              mode,
              started: false,
              finished: false,
              aborted: false,
              requests: [],
            };
            transactions.push(tx);
            trace.push({
              kind: "transaction-create",
              id: tx.id,
              connection: opens.indexOf(op) + 1,
              db,
              mode,
            });
            tx.complete = () => {
              assert.ok(
                tx.started &&
                  !tx.finished &&
                  tx.requests.every((q) => q.settled),
              );
              if (!tx.aborted)
                for (const q of tx.requests) {
                  if (q.operation === "put") storage.set(q.key, q.value);
                  if (q.operation === "delete") storage.delete(q.key);
                }
              tx.finished = true;
              trace.push({
                kind: tx.aborted ? "transaction-abort" : "transaction-complete",
                id: tx.id,
              });
              if (tx.aborted) tx.onabort?.();
              else tx.oncomplete?.();
              pump();
            };
            tx.abort = () => {
              assert.ok(tx.requests.every((q) => q.settled));
              tx.aborted = true;
              tx.complete();
            };
            return Object.assign(tx, {
              objectStore(store) {
                return Object.fromEntries(
                  ["get", "put", "delete"].map((operation) => [
                    operation,
                    (...args) => {
                      const request = {},
                        key = operation === "put" ? args[1] : args[0],
                        value = operation === "put" ? args[0] : undefined;
                      const q = {
                        operation,
                        key,
                        value,
                        tx,
                        store,
                        settled: false,
                        queued: false,
                      };
                      requests.push(q);
                      tx.requests.push(q);
                      q.resolve = () => {
                        assert.ok(
                          tx.started && eligible(tx),
                          "overlapping-store ordering cannot be bypassed",
                        );
                        assert.equal(q.settled, false);
                        q.settled = true;
                        request.result =
                          operation === "get"
                            ? storage.get(key)
                            : operation === "put"
                              ? key
                              : undefined;
                        trace.push({
                          kind: "request-success",
                          id: tx.id,
                          operation,
                          key,
                          result: request.result ?? null,
                        });
                        request.onsuccess();
                        if (operation === "get")
                          Promise.resolve().then(tx.complete);
                      };
                      q.reject = () => {
                        assert.ok(tx.started && eligible(tx));
                        assert.equal(q.settled, false);
                        q.settled = true;
                        tx.aborted = true;
                        request.error = Error("inert request failure");
                        trace.push({
                          kind: "request-error",
                          id: tx.id,
                          operation,
                          key,
                        });
                        request.onerror();
                        Promise.resolve().then(tx.complete);
                      };
                      q.start = () => {
                        if (operation === "get" && !q.queued) {
                          q.queued = true;
                          Promise.resolve().then(q.resolve);
                        }
                      };
                      pump();
                      if (tx.started) q.start();
                      return request;
                    },
                  ]),
                );
              },
            });
          },
        };
        trace.push({ kind: "open-success", db });
        request.onsuccess();
      };
      op.reject = () => {
        settleOpen();
        request.error = Error("inert open failure");
        request.onerror();
      };
      if (!holdOpens)
        Promise.resolve().then(() => {
          if (!op.settled) op.resolve();
        });
      return request;
    },
  };
  const otherRead = (list, uri) => {
    let resolve;
    const q = {
      uri,
      settled: false,
      promise: new Promise((yes) => (resolve = yes)),
    };
    q.resolve = () => {
      assert.equal(q.settled, false);
      q.settled = true;
      resolve(null);
    };
    list.push(q);
    if (!holdOther) q.resolve();
    return q.promise;
  };
  const config = {
    modes: ["karaoke", "synced", "unsynced"],
    visual: {
      "translate:display-mode": "below",
      "translate:detect-language-override": "off",
    },
  };
  const spicetify = {
    LocalStorage: {
      get: (key) => settings.get(key) ?? null,
      set: (key, value) => settings.set(key, value),
    },
    Player: { data: { item: null } },
    Platform: { PlayerAPI: { _state: {} } },
    ReactDOM: { createPortal: (value) => value },
  };
  const clock = clockApi.createSpotifyPlaybackClock(spicetify, {
    autoStart: false,
    now: () => now,
    wallNow: () => now,
    schedule() {
      throw Error("unexpected clock timer");
    },
    cancel() {},
  });
  const react = {};
  const context = vm.createContext({
    indexedDB,
    react,
    Spicetify: spicetify,
    CONFIG: config,
    CACHE: {},
    SYNCED: 1,
    UNSYNCED: 2,
    APP_NAME: "ivLyrics",
    StorageManager: {
      getItem: () => null,
      getPersisted: () => null,
      setItem: (...args) => storageWrites.push(args),
    },
    document: { body: {} },
    Intl,
    console: {
      warn: (...v) => warnings.push(v),
      error: (...v) => errors.push(v),
    },
    ivLyricsDebug() {},
    I18n: { t: (key) => key, getCurrentLanguage: () => "en" },
    SettingRowDescription: "description",
    ICONS: {},
    ConfigSlider: "slider",
    ConfigButton: "button",
    IvConfigSlider: "slider",
    IvConfigButton: "button",
    IvLyricsTooltip: "tooltip",
    IvLyricsToolbarIcon: "icon",
    getSettingsSurfaceTheme: () => "dark",
    isKaraokeRenderMode: (mode) => mode === 0,
    getLyricsDataMode: (mode) => mode,
    getLyricsModeTypeKey: (mode) => config.modes[mode],
    isLyricsRenderCacheCurrent: () => true,
    hasInstrumentalMarker: () => false,
    getCurrentTranslationTargetLanguage: () => "en",
    getCurrentLyricsPronunciationNotation: () => "translation",
    getNonSectionLyricsText: (rows) => rows.map((row) => row.text).join("\n"),
    getLegacyNonSectionLyricsText: (rows) =>
      rows.map((row) => row.text).join("\n"),
    getSyncDataRendererCacheVersion: () => "fixture-version",
    getLyricsProcessingShapeSignature: (rows) =>
      rows.map((row) => row.text).join("\n"),
    getDisplayModeCacheKey: (state, mode) => `${state.uri}:${mode}`,
    getCachedTranslationForText: async () => null,
    getTranslationOutputFromCache: () => null,
    mapTranslationLinesToLyrics: (rows, output) =>
      rows.map((row, i) => ({ ...row, text: output[i] })),
    CacheManager: {
      get: (key) => pageCache.get(key),
      set: (key, value) => pageCache.set(key, value),
    },
    RateLimiter: { canMakeCall: () => true },
    Toast: { error: (message) => errors.push(message) },
    TrackBackgroundDB: {
      getOverride: (uri) => otherRead(backgroundReads, uri),
    },
    Date: { now: () => now },
    setTimeout(fn) {
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
    ensurePlaybackProgressGuard: () => ({
      getSnapshot: () => {
        if (snapshotFailure) throw snapshotFailure;
        return emptySnapshot ? {} : clock.getSnapshot();
      },
      clearCorrection: () => clock.invalidate(),
    }),
    fetch() {
      throw Error("network forbidden");
    },
    window: {
      __ivLyricsDebugLog: (message) => debugLogs.push(message),
      innerWidth: 1000,
      scrollX: 0,
      scrollY: 0,
      ivLyricsPlaybackClock: clockApi,
      Translator: {
        clearInflightRequests() {},
        async callGemini(request) {
          translationCalls.push(plain(request));
          return {
            translation: request.text
              .split("\n")
              .map(
                (line, i) => `Inert ${request.sourceLang} translation ${i + 1}`,
              ),
          };
        },
      },
      LyricsService: {
        getTrackLyricsProviderOverride: (uri) => otherRead(providerReads, uri),
        getLyricsFromProviders: async (info) => {
          fetchInputs.push(plain(info));
          return {
            uri: info.uri,
            provider: "inert",
            synced: plain(info.uri === A ? sourceLines : certainLines),
          };
        },
        publishLyricsSnapshot() {},
        clearLyricsSnapshot: (uri) => {
          snapshotsCleared.push(uri);
          snapshotEvents.push({
            uri,
            override: c.trackLanguageOverride,
            renders: renders.length,
          });
        },
      },
    },
  });
  // Service and custom-app Utils intentionally occupy separate scopes, as shipped.
  vm.runInContext(
    `(() => {
    ${cut(service, "    const getLyricsTextCacheHash =", "    const isCachedTranslationStructurallyValid =")}
    ${cut(service, "    const Utils = {", "    // window.Utils로 노출")}
    window.Utils = Utils;
    Object.assign(window.LyricsService, {
      ${["detectLanguage", "detectLanguageDetailed", "overrideDetectedLanguage"].map((name) => method(service.slice(service.indexOf("        // 언어 감지 (Extension 내 Utils")), name, "        ")).join("\n")}
    });
  })();
  const Utils = {extractTrackId: uri => uri?.startsWith('spotify:track:') ? uri.slice(14) : null,
    setDetectedLanguage: value => globalThis.detected(value),
    ${["detectLanguage", "isSectionHeader"].map((name) => method(utilsSource, name)).join("\n")}
  };
  globalThis.Utils = Utils;
  ${cut(index, "const getTranslationSourceCacheHash =", "const getTranslationResultCacheHash =")}
    ${cut(index, "const createTrackOverrideDB = (", "const TrackLyricsProviderDB =")}
    window.TrackLanguageDB=TrackLanguageDB;
    const trackOverrideDatabases=new Map();
    const lyricsPresentationSnapshots = new Map();
    let lyricsProviderRequestGeneration = 0;
    globalThis.presentationSnapshots = lyricsPresentationSnapshots;
    globalThis.providerGeneration = () => lyricsProviderRequestGeneration;
    ${cut(service, "    const openTrackOverrideDatabase =", "    const sendLyricsToConsumers =")}
    Object.assign(window.LyricsService,{${["getTrackLanguageOverride", "clearLyricsPresentationSnapshot", "clearLyricsSnapshot"].map((name) => method(service, name, "        ")).join("\n")}});
    ${cut(index, "const emptyState = {", "\nconst getPlainLyricsLineText")}
    ${cut(index, "class InflightRequestRegistry {", "// Enhanced cache system")}
    globalThis.newRegistry=()=>new InflightRequestRegistry();
    class Container {${methods.map((name) => method(index, name)).join("\n")}}
    globalThis.Container=Container; globalThis.emptyState=emptyState;
    globalThis.renderAdmission=function(){ let showTranslationButton;const mode=this.getCurrentMode();
      ${cut(renderSource, "    const originalLanguage = this.provideLanguageCode(this.state.currentLyrics);", "    // For Gemini mode, use generic keys if no specific language detected")}
      ${renderSource.slice(renderSource.indexOf("    const potentialMode ="))}
      return {showTranslationButton,originalLanguage,friendlyLanguage};};
    globalThis.renderPresentation=function(){const mode=this.getCurrentMode(),isSyncCreatorActive=false;${renderSource}return {showTranslationButton,originalLanguage,friendlyLanguage};};
  `,
    context,
  );
  context.completeJsonTransport = (prompt, options) => {
    let yes, no;
    const q = {
      prompt: plain(prompt),
      options: plain(options),
      settled: false,
      promise: new Promise((resolve, reject) => {
        yes = resolve;
        no = reject;
      }),
    };
    q.resolve = (value) => {
      assert.equal(q.settled, false);
      q.settled = true;
      yes(value);
    };
    q.reject = (error) => {
      assert.equal(q.settled, false);
      q.settled = true;
      no(error);
    };
    aiCalls.push(q);
    return q.promise;
  };
  vm.runInContext(
    `(() => {
    ${cut(managerSource, "    const STORAGE_PREFIX =", "    // 기능 유형")}
    ${managerSource.match(/^    const DEFAULT_ENABLED_ADDONS = .+;$/m)[0]}
    ${cut(managerSource, "    function buildLanguageDetectionPrompt(", "    function buildSpeakerSuggestionPrompt(")}
    class Manager {
      ${["getProviderOrder", "getAddonIds", "isProviderEnabled", "getEnabledProviders", "getEnabledProvidersFor", "isCapabilityEnabled", "getAddonSetting", "hasJsonProvider", "detectLyricsLanguage"].map((name) => method(managerSource, name, "        ")).join("\n")}
    }
    window.AIAddonManager = new Manager();
    window.AIAddonManager.completeJson = globalThis.completeJsonTransport;
  })();`,
    context,
  );
  context.window.AIAddonManager._addons = new Map([
    [
      "fixture-json",
      {
        id: "fixture-json",
        supports: { translate: supportsTranslate },
        ...(jsonMethod
          ? {
              completeJson() {
                throw Error("direct provider execution forbidden");
              },
            }
          : {}),
      },
    ],
  ]);
  const clearSnapshot = context.window.LyricsService.clearLyricsSnapshot;
  context.window.LyricsService.clearLyricsSnapshot = function (uri) {
    snapshotsCleared.push(uri);
    snapshotEvents.push({
      uri,
      override: c.trackLanguageOverride,
      renders: renders.length,
    });
    return clearSnapshot.call(this, uri);
  };
  const detectorOverride =
    context.window.LyricsService.overrideDetectedLanguage;
  context.window.LyricsService.overrideDetectedLanguage = function (
    lyrics,
    language,
  ) {
    detectorOverrides.push({
      lyrics: plain(lyrics),
      language,
      current: c.currentTrackUri,
    });
    return detectorOverride.call(this, lyrics, language);
  };
  const detectLyricsLanguage =
    context.window.AIAddonManager.detectLyricsLanguage;
  context.window.AIAddonManager.detectLyricsLanguage = function (...args) {
    const q = { promise: detectLyricsLanguage.apply(this, args), done: false };
    aiTasks.push(q);
    q.promise.then(
      () => (q.done = true),
      (error) => {
        q.done = true;
        q.error = error;
      },
    );
    return q.promise;
  };
  context.detected = (value) =>
    detections.push({ uri: c.currentTrackUri, language: value });
  const c = new context.Container();
  Object.assign(c, {
    state: {
      ...context.emptyState,
      uri: "",
      currentLyrics: [],
      lyricsDisplayUri: null,
    },
    currentTrackUri: "",
    _lyricsFetchSeq: 0,
    _lyricsTransitionSeq: 0,
    _activeLyricsFetchSeq: 0,
    _localLyricsImportGeneration: 0,
    _playbackTrackResolutionSeq: 0,
    _isComponentMounted: true,
    _dmResults: {},
    trackLanguageOverride: null,
    _lyricsPresentationSeq: 0,
    _sharedPresentationKeys: new Map(),
    _inflightGemini: context.newRegistry(),
    _inflightTrad: context.newRegistry(),
    clearPendingLyricsUpdates() {},
    closeLyricsEditModal() {},
    lyricsSaved: () => false,
    getSavedLocalLyrics: () => null,
    fetchMetadataTranslation() {},
    fetchColors() {},
    fetchTempo() {},
    resetDelay() {},
    loadSavedVideoForTrack() {},
    updateVisualOnConfigChange() {
      visualUpdates.push(c.currentTrackUri);
    },
    startLyricsLoading: () => 1,
    clearLyricsLoading() {},
    getCurrentMode() {
      return this.state.synced?.length ? 1 : -1;
    },
    startPhoneticLoading: () => 1,
    startTranslationLoading: () => 1,
    clearPhoneticLoading() {},
    clearTranslationLoading() {},
    isCulturalAnnotationsEnabled: () => false,
    getTranslationTargetLanguage: () => "en",
    requestCulturalAnnotations() {},
    optimizeTranslations(rows, mode1, mode2) {
      return rows.map((row, i) => ({
        ...row,
        translationText: mode1?.[i]?.text || mode2?.[i]?.text || null,
      }));
    },
    isModeAvailable: () => false,
    getAutomaticMode: () => 1,
    applyTranslationStates: () => ({}),
    setState(patch, callback) {
      this.state = { ...this.state, ...patch };
      stateWrites.push(plain(patch));
      this.forceUpdate();
      callback?.();
    },
    forceUpdate() {
      renders.push({
        uri: this.currentTrackUri,
        loading: this.state.isLoading,
        override: this.trackLanguageOverride,
        ...plain(
          (this.processPresentation
            ? context.renderPresentation
            : context.renderAdmission
          ).call(this),
        ),
      });
    },
  });
  context.window.lyricContainer = c;
  const originalFetch = c.fetchLyrics;
  c.fetchLyrics = function (...args) {
    const q = {
      promise: originalFetch.apply(this, args),
      done: false,
      uri: args[0]?.uri,
    };
    lyricTasks.push(q);
    q.promise.then(
      () => (q.done = true),
      (error) => {
        q.done = true;
        q.error = error;
      },
    );
    return q.promise;
  };
  const originalTranslation = c.getGeminiTranslation;
  c.getGeminiTranslation = function (...args) {
    const q = { promise: originalTranslation.apply(this, args), done: false };
    translationTasks.push(q);
    q.promise.then(
      () => (q.done = true),
      (error) => {
        q.done = true;
        q.error = error;
      },
    );
    return q.promise;
  };
  const h = {
    c,
    context,
    config,
    aiCalls,
    aiTasks,
    detectorOverrides,
    fetchInputs,
    storageWrites,
    snapshotEvents,
    visualUpdates,
    storage,
    opens,
    transactions,
    requests,
    trace,
    snapshotsCleared,
    renders,
    detections,
    lyricTasks,
    providerReads,
    backgroundReads,
    clock,
    spicetify,
    warnings,
    errors,
    debugLogs,
    timers,
    translationCalls,
    translationTasks,
    expectErrors(count) {
      expectedErrors = count;
    },
    expectWarnings(count) {
      expectedWarnings = count;
    },
    failSnapshot(error) {
      snapshotFailure = error;
    },
    emptySnapshot(value = true) {
      emptySnapshot = value;
    },
    enablePresentation() {
      config.visual["translation-mode:japanese"] = "none";
      config.visual["translation-mode:korean"] = "gemini_en";
      config.visual["translation-mode:english"] = "none";
      c.processPresentation = true;
      c.lastProcessedUri = null;
      c.lastProcessedMode = null;
      c.forceUpdate();
    },
    async play(accepted, publicItem = accepted) {
      spicetify.Player.data.item = publicItem;
      spicetify.Platform.PlayerAPI._state = {
        item: accepted,
        playbackId: `play-${++now}`,
        isPaused: false,
      };
      c.schedulePlaybackTrackResolution(accepted);
      await flush();
    },
    async publicOnly(item) {
      spicetify.Player.data.item = item;
      await flush();
    },
    holdOpens(value = true) {
      holdOpens = value;
    },
    holdOther(value = true) {
      holdOther = value;
    },
    snapshot() {
      return plain({
        current: c.currentTrackUri,
        stateUri: c.state.uri,
        displayUri: c.state.lyricsDisplayUri,
        loading: c.state.isLoading,
        override: c.trackLanguageOverride,
        sourceLanguage: c.provideLanguageCode(c.state.currentLyrics, {
          updateDetectedLanguage: false,
        }),
        currentLyrics: c.state.currentLyrics,
        storage: [...storage],
        snapshotsCleared,
        lastProcessedUri: c.lastProcessedUri,
        lastProcessedMode: c.lastProcessedMode,
        dmResults: c._dmResults,
        renders,
        trace,
        translationCalls,
      });
    },
    write() {
      return requests.find((q) => q.operation !== "get" && !q.settled);
    },
    async finish(deactivate = true) {
      holdOpens = false;
      holdOther = false;
      for (const q of aiCalls.filter((q) => !q.settled)) q.resolve(null);
      await flush();
      for (let pass = 0; pass < 30; pass++) {
        for (const op of opens.filter((op) => !op.settled)) {
          op.resolve();
          await flush();
        }
        for (const q of [...providerReads, ...backgroundReads].filter(
          (q) => !q.settled,
        ))
          q.resolve();
        for (const tx of transactions.filter(
          (tx) => tx.started && !tx.finished && tx.mode === "readwrite",
        )) {
          for (const q of tx.requests.filter((q) => !q.settled)) q.resolve();
          if (tx.requests.every((q) => q.settled)) tx.complete();
        }
        if (timers.size) {
          now += 5000;
          const jobs = [...timers.values()];
          timers.clear();
          jobs.forEach((fn) => fn());
        }
        await flush();
        if (
          opens.every((q) => q.settled) &&
          transactions.every((q) => q.finished) &&
          [...lyricTasks, ...translationTasks].every((q) => q.done)
        )
          break;
      }
      assert.ok(
        opens.every((q) => q.settled),
        "all opens drained",
      );
      assert.ok(
        transactions.every((q) => q.finished),
        "all transactions drained",
      );
      assert.ok(
        requests.every((q) => q.settled),
        "all storage requests drained",
      );
      assert.ok(
        [...providerReads, ...backgroundReads].every((q) => q.settled),
        "all other reads drained",
      );
      assert.ok(
        lyricTasks.every((q) => q.done),
        "all actual-method promises drained",
      );
      assert.ok(
        translationTasks.every((q) => q.done),
        "all translation promises drained",
      );
      assert.equal(c._inflightGemini._entries.size, 0);
      await Promise.allSettled(
        [...lyricTasks, ...translationTasks].map((q) => q.promise),
      );
      await flush();
      if (deactivate) {
        clock.destroy();
        active.delete(this);
      }
      assert.equal(
        [...lyricTasks, ...translationTasks].filter((q) => q.error).length,
        0,
        "no fetch/translation rejection",
      );
      assert.ok(
        aiCalls.every((q) => q.settled),
        "all AI transports settled",
      );
      assert.ok(
        aiTasks.every((q) => q.done),
        "all actual AI wrappers settled",
      );
      assert.equal(timers.size, 0);
      assert.equal(warnings.length, expectedWarnings);
      assert.equal(
        errors.length,
        expectedErrors,
        "expected storage open logs only",
      );
      if (deactivate)
        drains.push({
          opens: opens.length,
          transactions: transactions.length,
          requests: requests.length,
          aiTransports: aiCalls.length,
          aiWrappers: aiTasks.length,
          fetches: lyricTasks.length,
          translations: translationTasks.length,
          pendingOpens: opens.filter((q) => !q.settled).length,
          pendingTransactions: transactions.filter((q) => !q.finished).length,
          pendingRequests: requests.filter((q) => !q.settled).length,
          pendingAI:
            aiCalls.filter((q) => !q.settled).length +
            aiTasks.filter((q) => !q.done).length,
          pendingMethods: [...lyricTasks, ...translationTasks].filter(
            (q) => !q.done,
          ).length,
          pendingTimers: timers.size,
        });
    },
  };
  active.add(h);
  return h;
}
