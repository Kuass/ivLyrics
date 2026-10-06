import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(process.env.IVLYRICS_LOCAL_IMPORT_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_LOCAL_IMPORT_SOURCE_DIR, 'index.js')
    : new URL('../index.js', import.meta.url), 'utf8');
const method = name => {
    const start = source.search(new RegExp(`^  (?:async )?${name}\\(`, 'm'));
    if (start < 0) return '';
    const end = source.slice(start + 1).search(/^  (?:async )?\w+\(/m);
    assert.ok(end >= 0, `end of ${name}`);
    return source.slice(start, start + end + 1);
};
const normalize = value => JSON.parse(JSON.stringify(value));
const lyrics = text => ({ unsynced: [{ text }] });
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

// Execute actual container methods. Only external renderer, cache, player,
// file-reader and normalization collaborators are substituted.
function harness() {
    const pending = [], saves = [], snapshots = [], clears = [], renders = [], toasts = [], events = [];
    const readers = [], inputs = [], callbacks = [];
    const player = { data: { item: { uri: 'spotify:track:A', duration: { milliseconds: 120000 } } } };
    const window = {
        PseudoKaraokeService: { applyToResult(result, info) { const task = deferred(); pending.push({ ...task, result, info }); return task.promise; } },
        LyricsService: { clearLyricsSnapshot(uri) { clears.push(['snapshot', uri]); }, publishLyricsSnapshot(value) { snapshots.push(normalize(value)); } },
        LyricsAddonManager: { normalizeResult(result) { return result; } },
        dispatchEvent(event) { events.push(event); },
    };
    const CACHE = {};
    const context = {
        window, Spicetify: { Player: player }, CACHE,
        CacheManager: { clearByUri(uri) { clears.push(['memory', uri]); } },
        Toast: { success(message) { toasts.push(['success', message]); }, error(message) { toasts.push(['error', message]); } },
        I18n: { t: key => key }, Utils: { parseLocalLyrics: text => lyrics(text) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        FileReader: class {
            constructor() { readers.push(this); }
            readAsText(file) { this.file = file; }
            abort() { this.aborted = true; }
            finish(text) { return this.onload?.({ target: { result: text } }); }
            fail() { return this.onerror?.(); }
        },
        document: { createElement() { const input = { click() {} }; inputs.push(input); return input; } },
    };
    const methods = ['createLocalLyricsRequest', 'isLocalLyricsImportTargetCurrent', 'isCurrentLocalLyricsRequest', 'getParsedLocalLyricsTypes', 'applyLocalLyrics',
        'importLocalLyricsFile', 'applyLocalLyricsFromLrclibCandidate', 'processLyricsFromFile', 'isPlaybackUriCurrent'];
    vm.runInNewContext(`class Container { ${methods.map(method).join('\n')} }; globalThis.Container = Container;`, context);
    const container = new context.Container();
    Object.assign(container, {
        currentTrackUri: 'spotify:track:A', _isComponentMounted: true, _lyricsTransitionSeq: 0, _dmResults: {},
        _lyricsFetchSeq: 0, _activeLyricsFetchSeq: 0, _localLyricsImportGeneration: 0, clearLyricsLoading() {},
        state: { uri: 'spotify:track:A', title: 'Song A', artist: 'Artist A' },
        getText: (_key, fallback) => fallback,
        applyTranslationStates: () => ({}), getCurrentMode: () => 0,
        lyricsSource(value) { renders.push(normalize(value)); },
        saveLocalLyrics(uri, value) { saves.push({ uri, value: normalize(value) }); },
        setState(value, callback) { this.state = { ...this.state, ...value }; if (callback) { if (this.deferCallbacks) callbacks.push(callback); else callback(); } },
    });
    return { container, player, window, pending, saves, snapshots, clears, renders, toasts, events, readers, inputs, callbacks, CACHE,
        switchTrack(id, { liveOnly = false } = {}) {
            player.data.item = { uri: `spotify:track:${id}`, duration: { milliseconds: 240000 } };
            if (!liveOnly) {
                container.currentTrackUri = player.data.item.uri;
                container.state = { uri: player.data.item.uri, title: `Song ${id}`, artist: `Artist ${id}` };
                container._lyricsTransitionSeq++;
            }
        },
        selectFile(size = 10, input = null) {
            const event = { target: { files: [{ size }], value: 'synthetic-file' } };
            if (input) input.onchange(event); else container.processLyricsFromFile(event);
            return readers.at(-1);
        },
    };
}

for (const change of ['track', 'live-player', 'unmount', 'leave-and-return']) {
    test(`${change}: stale normalization cannot change state, caches, snapshots or storage`, async () => {
        const h = harness();
        const work = h.container.applyLocalLyrics(lyrics('Imported A'));
        if (change === 'track') h.switchTrack('B');
        if (change === 'live-player') h.switchTrack('B', { liveOnly: true });
        if (change === 'unmount') h.container._isComponentMounted = false;
        if (change === 'leave-and-return') { h.switchTrack('B'); h.switchTrack('A'); }
        const before = normalize(h.container.state);
        h.pending[0].resolve();
        assert.equal(await work, false);
        assert.deepEqual(normalize(h.container.state), before);
        for (const value of [h.saves, h.snapshots, h.clears, h.renders, h.toasts, h.events]) assert.equal(value.length, 0);
        assert.deepEqual(h.CACHE, {});
    });
}

test('a newer import wins when two normalization requests finish out of order', async () => {
    const h = harness();
    const old = h.container.applyLocalLyrics(lyrics('old'));
    const latest = h.container.applyLocalLyrics(lyrics('latest'));
    h.pending[1].resolve();
    assert.equal(await latest, true);
    h.pending[0].resolve();
    assert.equal(await old, false);
    assert.equal(h.container.state.unsynced[0].text, 'latest');
    assert.equal(h.saves.length, 1);
    assert.equal(h.snapshots.length, 1);
});

test('a delayed file read stays bound to the track selected when reading began', async () => {
    const h = harness();
    const reader = h.selectFile();
    h.switchTrack('B');
    const work = reader.finish('Imported A');
    await flush();
    h.pending.forEach(task => task.resolve());
    await work;
    assert.equal(h.pending.length, 0, 'stale file must not start normalization');
    assert.equal(h.saves.length, 0);
    assert.equal(h.container.state.uri, 'spotify:track:B');
    assert.equal(h.toasts.length, 0);
});

test('a file chosen after playback changes cannot be applied to the newly playing track', async () => {
    const h = harness();
    h.container.importLocalLyricsFile();
    h.switchTrack('B');
    h.selectFile(10, h.inputs[0]);
    const work = h.readers.at(-1)?.finish('Old chooser lyrics');
    await flush(); h.pending.forEach(task => task.resolve()); await work;
    assert.equal(h.pending.length, 0);
    assert.equal(h.saves.length, 0);
    assert.equal(h.container.state.uri, 'spotify:track:B');
});

test('the latest selected file wins even when the older read completes later', async () => {
    const h = harness();
    const old = h.selectFile();
    const latest = h.selectFile();
    const newWork = latest.finish('latest file');
    await flush(); h.pending[0].resolve(); await newWork;
    const oldWork = old.finish('old file');
    await flush(); h.pending.slice(1).forEach(task => task.resolve()); await oldWork;
    assert.equal(h.container.state.unsynced[0].text, 'latest file');
    assert.equal(h.saves.length, 1);
});

test('stale read and normalization failures do not show errors for a different track', async () => {
    const h = harness();
    const reader = h.selectFile();
    const work = reader.finish('Imported A');
    await flush(); h.switchTrack('B'); reader.fail();
    h.pending[0].reject(new Error('synthetic normalization failure'));
    await work;
    assert.equal(h.toasts.length, 0);
});

test('a queued React completion callback cannot save into a newer playback state', async () => {
    const h = harness();
    h.container.deferCallbacks = true;
    const work = h.container.applyLocalLyrics(lyrics('Imported A'));
    h.pending[0].resolve(); await work;
    h.switchTrack('B'); h.callbacks[0]();
    assert.equal(h.saves.length, 0);
    assert.equal(h.events.length, 0);
    assert.equal(h.renders.length, 0);
});

test('successful import preserves source, captured duration, metadata, cache and save behavior', async () => {
    const h = harness();
    const work = h.container.applyLocalLyrics(lyrics('Imported A'), { sourceLabel: 'file', successMessage: 'fixture success' });
    assert.equal(h.pending[0].info.duration, 120000);
    h.pending[0].resolve();
    assert.equal(await work, true);
    assert.equal(h.saves.length, 1);
    assert.equal(h.saves[0].uri, 'spotify:track:A');
    assert.equal(h.container.state.localLyricsSource, 'file');
    assert.equal(h.container.state.lyricsRequestSeq, h.container._activeLyricsFetchSeq);
    assert.ok(Number.isInteger(h.container.state.lyricsRequestSeq));
    assert.deepEqual(h.snapshots[0].trackInfo, { uri: 'spotify:track:A', title: 'Song A', artist: 'Artist A' });
    assert.deepEqual(h.toasts, [['success', 'fixture success']]);
    assert.equal(h.events[0].type, 'ivLyrics:local-lyrics-updated');
});

test('no normalization service still applies valid lyrics immediately', async () => {
    const h = harness();
    h.window.PseudoKaraokeService = null;
    assert.equal(await h.container.applyLocalLyrics(lyrics('direct')), true);
    assert.equal(h.saves.length, 1);
    assert.equal(h.pending.length, 0);
});

test('invalid lyrics, missing track and oversized file retain their existing feedback', async () => {
    const h = harness();
    assert.equal(await h.container.applyLocalLyrics({}), false);
    assert.match(h.toasts.at(-1)[1], /No valid lyrics/);
    h.container.currentTrackUri = ''; h.container.state.uri = '';
    assert.equal(await h.container.applyLocalLyrics(lyrics('text')), false);
    assert.match(h.toasts.at(-1)[1], /No track playing/);
    const oversized = harness(); oversized.selectFile(1024 * 1024 + 1);
    assert.deepEqual(oversized.toasts, [['error', 'notifications.fileTooLarge']]);
    assert.equal(oversized.pending.length, 0);
});

test('a current file read failure and current normalization failure retain error feedback', async () => {
    const h = harness();
    h.selectFile().fail();
    assert.deepEqual(h.toasts, [['error', 'notifications.fileReadFailed']]);
    const reader = h.selectFile(); const work = reader.finish('fixture');
    await flush(); h.pending[0].reject(new Error('synthetic normalization failure')); await work;
    assert.deepEqual(h.toasts.at(-1), ['error', 'notifications.lyricsLoadFailed']);
});

test('superseding a file read aborts it and completed reads release their reader reference', async () => {
    const h = harness();
    const old = h.selectFile(); const oldRequest = h.container._localLyricsRequest;
    const latest = h.selectFile();
    assert.equal(old.aborted, true);
    assert.equal(oldRequest.reader, null);
    const work = latest.finish('latest'); await flush();
    assert.equal(h.container._localLyricsRequest.reader, null);
    h.pending[0].resolve(); await work;
    old.fail(); assert.equal(h.toasts.filter(([type]) => type === 'error').length, 0);
});

test('a file read error releases its reader while preserving the current error message', () => {
    const h = harness(); const reader = h.selectFile(); reader.fail();
    assert.equal(h.container._localLyricsRequest?.reader, null);
    assert.deepEqual(h.toasts, [['error', 'notifications.fileReadFailed']]);
});

test('LRCLIB candidate import keeps its source and feedback on normal completion', async () => {
    const h = harness();
    const work = h.container.applyLocalLyricsFromLrclibCandidate({ plainLyrics: 'Candidate lyric' });
    h.pending[0].resolve(); await work;
    assert.equal(h.saves[0].value.localLyricsSource, 'lrclib');
    assert.equal(h.saves[0].value.unsynced[0].text, 'Candidate lyric');
    assert.equal(h.toasts[0][0], 'success');
});

for (const failed of [false, true]) {
    test(`retired LRCLIB candidate ${failed ? 'failure' : 'completion'} is silent`, async () => {
        const h = harness();
        const work = h.container.applyLocalLyricsFromLrclibCandidate({ plainLyrics: 'Candidate lyric' });
        h.switchTrack('B');
        if (failed) h.pending[0].reject(new Error('retired failure')); else h.pending[0].resolve();
        await work;
        assert.equal(h.saves.length, 0);
        assert.equal(h.snapshots.length, 0);
        assert.equal(h.toasts.length, 0);
    });
}

test('current direct normalization rejection still propagates without saving partial data', async () => {
    const h = harness();
    const work = h.container.applyLocalLyrics(lyrics('fixture'));
    const rejected = assert.rejects(work, /current failure/);
    h.pending[0].reject(new Error('current failure')); await rejected;
    assert.equal(h.saves.length, 0);
    assert.equal(h.snapshots.length, 0);
});

for (const change of ['track', 'live-player', 'leave-and-return', 'unmount']) {
    test(`${change}: a stale selector cannot open a chooser or import a LRCLIB selection`, async () => {
        const h = harness();
        const target = { trackUri: 'spotify:track:A', transitionSeq: 0 };
        if (change === 'track') h.switchTrack('B');
        if (change === 'live-player') h.switchTrack('B', { liveOnly: true });
        if (change === 'leave-and-return') { h.switchTrack('B'); h.switchTrack('A'); }
        if (change === 'unmount') h.container._isComponentMounted = false;
        h.container.importLocalLyricsFile(target);
        const work = h.container.applyLocalLyricsFromLrclibCandidate({ plainLyrics: 'Old selection' }, target);
        await flush(); h.pending.forEach(task => task.resolve()); await work;
        assert.equal(h.inputs.length, 0);
        assert.equal(h.pending.length, 0);
        assert.equal(h.saves.length, 0);
        assert.equal(h.toasts.length, 0);
    });
}

test('a rejected stale selection cannot supersede a newer valid import', async () => {
    const h = harness(); h.switchTrack('B');
    const current = h.container.applyLocalLyrics(lyrics('Current B'));
    const stale = h.container.applyLocalLyricsFromLrclibCandidate({ plainLyrics: 'Old A' }, { trackUri: 'spotify:track:A', transitionSeq: 0 });
    await flush(); h.pending.forEach(task => task.resolve());
    await Promise.all([current, stale]);
    assert.equal(h.saves.length, 1);
    assert.equal(h.container.state.unsynced[0].text, 'Current B');
});

const optionsSource = readFileSync(process.env.IVLYRICS_LOCAL_IMPORT_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_LOCAL_IMPORT_SOURCE_DIR, 'OptionsMenu.js')
    : new URL('../OptionsMenu.js', import.meta.url), 'utf8');

test('the actual LRCLIB modal forwards its original track identity and transition to the container', async () => {
    const start = optionsSource.indexOf('  const applyCandidate = react.useCallback(');
    const end = optionsSource.indexOf('  const handleKeyDown = ', start);
    assert.ok(start >= 0 && end > start);
    const calls = [];
    const context = { react: { useCallback: callback => callback }, applyingKey: null,
        setApplyingKey() {}, onClose() {}, query: 'fixture query',
        trackInfo: { uri: 'spotify:local:Artist:Album:Title:120', lyricsTransitionSeq: 4 },
        async onApplyLocalLyrics(...args) { calls.push(normalize(args)); },
    };
    vm.runInNewContext(`${optionsSource.slice(start, end)}\nglobalThis.apply = applyCandidate;`, context);
    await context.apply({ id: 123 });
    assert.deepEqual(calls[0][1], { source: 'lrclib-local-search', query: 'fixture query',
        trackUri: context.trackInfo.uri, transitionSeq: 4 });
});

test('the actual local tools selector carries its original target into a later file chooser', () => {
    const start = optionsSource.indexOf('const LyricsProviderSelectButton = react.memo(');
    const end = optionsSource.indexOf('function openRegenerateTranslationChoiceModal(', start);
    assert.ok(start >= 0 && end > start);
    const calls = [];
    let menu;
    const context = {
        react: { memo: value => value, createElement: (type, props, ...children) => ({ type, props, children }) },
        window: {}, I18n: { t: key => key }, getOptionsText: (_key, fallback) => fallback,
        ICONS: {}, SettingRowDescription: 'description', IvConfigButton: 'config-button',
        IvLyricsTooltip: 'tooltip', IvLyricsToolbarIcon: 'icon',
        openOptionsModal(_title, items) { menu = items; return () => {}; },
    };
    vm.runInNewContext(`${optionsSource.slice(start, end)}\nglobalThis.Selector = LyricsProviderSelectButton;`, context);
    const tree = context.Selector({ isLocalTrack: true, trackInfo: { uri: 'spotify:local:A:B:C:120', lyricsTransitionSeq: 7 },
        onImportLocalLyricsFile: target => calls.push(normalize(target)) });
    tree.children[0].props.onClick();
    menu[0].items.find(entry => entry.key === 'local-lyrics-import').onChange();
    assert.deepEqual(calls, [{ trackUri: 'spotify:local:A:B:C:120', transitionSeq: 7 }]);
});

test('legacy null LRCLIB options still use the current playback target', async () => {
    const h = harness();
    const work = h.container.applyLocalLyricsFromLrclibCandidate({ plainLyrics: 'Legacy' }, null);
    h.pending[0].resolve(); await work;
    assert.equal(h.saves.length, 1);
});
