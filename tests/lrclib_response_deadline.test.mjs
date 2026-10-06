import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(process.env.IVLYRICS_LRCLIB_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_LRCLIB_SOURCE_DIR, 'Addon_Lyrics_Lrclib.js')
    : new URL('../Addon_Lyrics_Lrclib.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const info = { uri: 'spotify:track:fixture', title: 'Fixture song', artist: 'Fixture artist', album: 'Fixture album', duration: 120000 };
const candidate = () => ({ id: 123, trackName: info.title, artistName: info.artist, albumName: info.album, duration: 120,
    plainLyrics: '첫 번째 가사\n두 번째 가사', syncedLyrics: '[00:01.00]첫 번째 가사\n[00:05.00]두 번째 가사' });
const successBody = request => JSON.stringify(request.url.includes('/get/') ? candidate() : [candidate()]);

// Native Response/ReadableStream model body completion and abort, while the real
// addon runs unchanged. No network, credentials, Spotify, or browser UI is used.
function harness(respond = successBody, direct = false) {
    let addon, timerId = 0;
    const timers = new Map(), requests = [], bodies = [];
    const fetch = async (url, options) => {
        const request = { url, ...options, index: requests.length };
        requests.push(request);
        const spec = await respond(request);
        if (spec instanceof Error) throw spec;
        const body = { started: false, done: false, request };
        const stream = new ReadableStream({
            start(controller) {
                body.controller = controller;
                options.signal.addEventListener('abort', () => {
                    if (!body.done) { body.done = true; controller.error(options.signal.reason); }
                }, { once: true });
                if (spec !== null && spec?.stall !== true) {
                    controller.enqueue(new TextEncoder().encode(typeof spec === 'string' ? spec : spec?.text || ''));
                    controller.close(); body.done = true;
                }
            },
        });
        body.finish = text => {
            body.controller.enqueue(new TextEncoder().encode(text));
            body.controller.close(); body.done = true;
        };
        body.fail = error => { body.controller.error(error); body.done = true; };
        const response = new Response(stream, { status: spec?.status || 200 });
        const read = response.json.bind(response);
        response.json = () => { body.started = true; return read(); };
        bodies.push(body);
        return response;
    };
    const window = {
        fetch,
        LyricsAddonManager: { register(value) { addon = value; }, getAddonSetting(_id, _key, fallback) { return fallback; } },
        LyricsService: { extractTrackId: () => 'fixture' },
        SyncDataService: direct ? { getSyncData: async () => ({ source: { provider: 'lrclib', lrclibId: 123 } }) } : {},
    };
    vm.runInNewContext(source, {
        window, fetch, AbortController, URLSearchParams, performance,
        Spicetify: { Config: { version: 'fixture' }, LocalStorage: { get() { return null; } } },
        console: { log() {}, warn() {}, error() {} },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
    }, { filename: 'Addon_Lyrics_Lrclib.js' });
    return {
        addon, timers, requests, bodies,
        start(path) { return path === 'manual' ? addon.searchCandidatesByQuery('Fixture query', info) : addon.searchCandidates(info); },
        count(delay) { return [...timers.values()].filter(timer => timer.delay === delay).length; },
        fire(delay) {
            const next = [...timers].find(([, timer]) => timer.delay === delay);
            assert.ok(next, `expected active ${delay}ms timer`);
            timers.delete(next[0]); next[1].callback();
        },
    };
}

for (const path of ['manual', 'structured', 'direct']) {
    test(`${path}: successful response keeps its deadline while JSON body is pending`, async () => {
        const h = harness(() => null, path === 'direct');
        const pending = h.start(path);
        await flush();
        assert.equal(h.bodies[0].started, true);
        assert.equal(h.count(35000), 1, 'headers must not clear the body deadline');
        h.bodies[0].finish(successBody(h.requests[0]));
        const result = await pending;
        assert.equal(result.success, true);
        assert.equal(result.candidates[0].id, 123);
        assert.equal(h.requests.length, 1);
        assert.equal(h.timers.size, 0);
    });

    test(`${path}: stalled body aborts and recovers on the one allowed retry`, async () => {
        const h = harness(request => request.index === 0 ? null : successBody(request), path === 'direct');
        const pending = h.start(path);
        await flush();
        h.fire(35000); await flush();
        assert.equal(h.requests[0].signal.aborted, true);
        assert.equal(h.count(35000), 0);
        h.fire(500);
        const result = await pending;
        assert.equal(result.success, true);
        assert.equal(h.requests.length, 2);
        assert.equal(h.requests[0].url, h.requests[1].url);
        assert.equal(h.timers.size, 0);
    });

    test(`${path}: body transport error uses a fresh request and clears the first deadline`, async () => {
        const h = harness(request => request.index === 0 ? null : successBody(request), path === 'direct');
        const pending = h.start(path);
        await flush();
        h.bodies[0].fail(new TypeError('synthetic connection lost'));
        await flush();
        assert.equal(h.count(35000), 0);
        h.fire(500);
        assert.equal((await pending).success, true);
        assert.equal(h.requests.length, 2);
        assert.equal(h.timers.size, 0);
    });
}

for (const path of ['manual', 'structured']) {
    test(`${path}: repeated body timeout stops after two attempts`, async () => {
        const h = harness(() => null);
        const pending = h.start(path);
        await flush(); h.fire(35000); await flush(); h.fire(500); await flush(); h.fire(35000);
        const result = await pending;
        assert.equal(result.success, false);
        assert.equal(result.error, 'Network request failed');
        assert.equal(h.requests.length, 2);
        assert.equal(h.timers.size, 0);
    });
}

test('exhausted direct lookup can continue to a successful structured search', async () => {
    const h = harness(request => request.url.includes('/get/') ? null : successBody(request), true);
    const pending = h.start('direct');
    await flush(); h.fire(35000); await flush(); h.fire(500); await flush(); h.fire(35000);
    assert.equal((await pending).success, true);
    assert.equal(h.requests.length, 3);
    assert.match(h.requests[2].url, /\/search\?/);
    assert.equal(h.timers.size, 0);
});

test('getLyrics uses the same bounded direct lookup without altering lyric timing', async () => {
    const h = harness(request => request.index === 0 ? null : successBody(request), true);
    const pending = h.addon.getLyrics(info);
    await flush(); h.fire(35000); await flush(); h.fire(500);
    const result = await pending;
    assert.equal(result.error, null);
    assert.deepEqual(JSON.parse(JSON.stringify(result.synced)), [
        { startTime: 1000, text: '첫 번째 가사' }, { startTime: 5000, text: '두 번째 가사' },
    ]);
    assert.equal(h.requests.length, 2);
    assert.equal(h.timers.size, 0);
});

for (const status of [404, 429, 500]) {
    test(`HTTP ${status} remains immediate and does not read or retry an error body`, async () => {
        const h = harness(() => ({ status, stall: true }));
        const result = await h.start('manual');
        assert.equal(result.success, false);
        assert.equal(result.error, status === 404 ? 'No lyrics found' : `API error: ${status}`);
        assert.equal(h.bodies[0].started, false);
        assert.equal(h.requests.length, 1);
        assert.equal(h.timers.size, 0);
    });
}

test('malformed JSON preserves its parsing error without transport retries', async () => {
    const h = harness(() => '{');
    const result = await h.start('manual');
    assert.equal(result.success, false);
    assert.match(result.error, /JSON|property name/);
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
});

test('valid but unusable JSON keeps the existing validation failure', async () => {
    const h = harness(() => '{}');
    const result = await h.start('manual');
    assert.equal(result.success, false);
    assert.equal(result.error, 'Invalid LRCLIB response');
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
});

test('header transport errors still retry once and preserve query and headers', async () => {
    const h = harness(request => request.index === 0 ? new TypeError('synthetic network failure') : successBody(request));
    const pending = h.start('manual');
    await flush(); h.fire(500);
    assert.equal((await pending).success, true);
    assert.equal(h.requests.length, 2);
    assert.equal(new URL(h.requests[1].url).searchParams.get('q'), 'Fixture query');
    assert.equal(h.requests[1].headers['x-user-agent'], 'spicetify vfixture');
    assert.equal(h.timers.size, 0);
});
