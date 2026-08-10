const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'OverlayService.js'),
    'utf8'
);

function createHarness({
    connected = true,
    pathname = '/',
    presentationOwner = false,
    snapshot = null,
    pendingFullLyrics = false
} = {}) {
    let now = 0;
    let nextTimerId = 0;
    const timers = new Map();
    const listeners = new Map();
    const playerListeners = new Map();
    const fullLyricsCalls = [];
    const snapshotSends = [];
    const pendingResolvers = [];
    const current = {
        uri: 'spotify:track:a',
        title: 'Track A',
        artist: 'Artist A'
    };

    const setTimeout = (callback, delay = 0) => {
        const id = ++nextTimerId;
        timers.set(id, { id, at: now + Number(delay || 0), callback });
        return id;
    };
    const clearTimeout = id => timers.delete(id);

    const runUntil = async targetTime => {
        while (true) {
            const next = [...timers.values()]
                .filter(timer => timer.at <= targetTime)
                .sort((a, b) => a.at - b.at || a.id - b.id)[0];
            if (!next) break;
            timers.delete(next.id);
            now = next.at;
            await next.callback();
            await Promise.resolve();
        }
        now = targetTime;
        await Promise.resolve();
    };

    class FakeDate extends Date {
        static now() {
            return now;
        }
    }

    const addWindowListener = (name, callback) => {
        const callbacks = listeners.get(name) || new Set();
        callbacks.add(callback);
        listeners.set(name, callbacks);
    };
    const removeWindowListener = (name, callback) => listeners.get(name)?.delete(callback);
    const dispatchWindowEvent = event => {
        for (const callback of listeners.get(event.type) || []) {
            callback(event);
        }
    };

    const overlaySender = {
        enabled: true,
        isConnected: connected,
        lastDeliveredUri: null,
        sendLyrics: async () => true
    };
    const helperSender = {
        enabled: false,
        isConnected: false,
        lastDeliveredUri: null,
        sendLyrics: async () => true
    };

    const LyricsService = {
        getLyricsSnapshot: () => snapshot,
        sendLyricsSnapshotToConsumers: async (trackInfo, currentSnapshot, options) => {
            snapshotSends.push({ trackInfo, snapshot: currentSnapshot, options });
            return true;
        },
        getFullLyrics: (trackInfo, options) => {
            fullLyricsCalls.push({ trackInfo: { ...trackInfo }, options: { ...options } });
            if (!pendingFullLyrics) return Promise.resolve({ lyrics: [] });
            return new Promise(resolve => pendingResolvers.push(resolve));
        }
    };

    const Player = {
        data: { item: { uri: current.uri } },
        getDuration: () => 180000,
        addEventListener: (name, callback) => playerListeners.set(name, callback),
        removeEventListener: name => playerListeners.delete(name)
    };
    const Spicetify = {
        Player,
        Platform: { History: { location: { pathname } } }
    };
    const Utils = {
        getPlayerPlaybackSnapshot: () => ({
            uri: current.uri,
            duration: 180000,
            playbackId: current.uri,
            djNarration: false
        }),
        resolveStablePlaybackTrack: () => ({
            uri: current.uri,
            name: current.title,
            metadata: {
                title: current.title,
                artist_name: current.artist
            }
        })
    };
    const document = {
        body: {
            classList: {
                contains: className => presentationOwner
                    && className === 'ivlyrics-panel-lyrics-active'
            }
        }
    };
    const window = {
        Spicetify,
        Utils,
        LyricsService,
        OverlaySender: overlaySender,
        lyricsHelperSender: helperSender,
        addEventListener: addWindowListener,
        removeEventListener: removeWindowListener,
        dispatchEvent: dispatchWindowEvent
    };

    vm.runInNewContext(source, {
        window,
        document,
        Spicetify,
        Promise,
        Date: FakeDate,
        Map,
        console,
        setTimeout,
        clearTimeout
    }, { filename: 'OverlayService.js' });

    return {
        window,
        current,
        fullLyricsCalls,
        snapshotSends,
        pendingResolvers,
        runUntil,
        songChange() {
            Player.data.item.uri = current.uri;
            playerListeners.get('songchange')?.();
        },
        dispatchSnapshot(detail) {
            dispatchWindowEvent({ type: 'ivLyrics:shared-lyrics-updated', detail });
        }
    };
}

test('does not generate fallback translations while no consumer is connected', async () => {
    const harness = createHarness({ connected: false });

    await harness.runUntil(1500);

    assert.equal(harness.fullLyricsCalls.length, 0);
});

test('forwards shared page or panel presentations to overlay consumers', async () => {
    const harness = createHarness();
    const snapshot = {
        trackUri: harness.current.uri,
        displayLyrics: [{ text: 'original', translation: 'translated' }],
        presentationComplete: true,
        source: 'now-playing-panel'
    };

    harness.dispatchSnapshot(snapshot);
    await Promise.resolve();

    assert.equal(harness.snapshotSends.length, 1);
    assert.equal(harness.snapshotSends[0].trackInfo.uri, harness.current.uri);
    assert.equal(harness.snapshotSends[0].options.sendReason, 'shared-snapshot-update');
});

test('starts the latest track without waiting for an older fallback request', async () => {
    const harness = createHarness({ pendingFullLyrics: true });

    await harness.runUntil(1200);
    assert.deepEqual(harness.fullLyricsCalls.map(call => call.trackInfo.uri), [
        'spotify:track:a'
    ]);

    harness.current.uri = 'spotify:track:b';
    harness.current.title = 'Track B';
    harness.songChange();
    await harness.runUntil(1350);

    assert.deepEqual(harness.fullLyricsCalls.map(call => call.trackInfo.uri), [
        'spotify:track:a',
        'spotify:track:b'
    ]);

    for (const resolve of harness.pendingResolvers) resolve({ lyrics: [] });
    await Promise.resolve();
});

test('uses an original-only fallback while another presentation owner is active', async () => {
    const harness = createHarness({ pathname: '/ivLyrics' });

    await harness.runUntil(9500);

    assert.equal(harness.fullLyricsCalls.length, 1);
    assert.equal(harness.fullLyricsCalls[0].options.skipTranslation, true);
});

test('reuses an existing shared presentation instead of starting another translation', async () => {
    const shared = {
        trackUri: 'spotify:track:a',
        displayLyrics: [{ text: 'same source', translation: 'canonical result' }],
        presentationComplete: true
    };
    const harness = createHarness({ snapshot: shared });

    await harness.runUntil(1200);

    assert.equal(harness.fullLyricsCalls.length, 0);
    assert.equal(harness.snapshotSends.length, 1);
});
