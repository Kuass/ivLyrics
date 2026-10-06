import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(process.env.IVLYRICS_RESEARCH_CONTEXT_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_RESEARCH_CONTEXT_SOURCE_DIR, 'SongInfoTicker.js')
    : new URL('../SongInfoTicker.js', import.meta.url), 'utf8');
const normalize = value => JSON.parse(JSON.stringify(value));
const item = id => ({ uri: `spotify:track:${id}`, name: `Song ${id}`, artists: [{ name: `Artist ${id}` }],
    album: { name: `Album ${id}` }, metadata: { release_date: `release-${id}`, isrc: `isrc-${id}` } });
const snapshot = id => ({ trackUri: `spotify:track:${id}`, trackInfo: { uri: `spotify:track:${id}`, title: `Saved song ${id}`, artist: `Saved artist ${id}` },
    rawResult: { unsynced: [{ text: `Lyrics ${id}` }] } });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness(current = 'A', snapshots = new Map([['spotify:track:A', snapshot('A')], ['spotify:track:B', snapshot('B')]])) {
    const requests = [], snapshotReads = [];
    const player = { data: { item: current ? item(current) : null } };
    let handler = async input => ({ metadata: { title: input.title }, lyrics: input.lyrics });
    const service = {
        getLyricsSnapshot(uri) { snapshotReads.push(uri); return snapshots.get(uri) || null; },
        getResearch(input) { requests.push(input); return handler(input); },
    };
    const window = { LyricsService: service };
    vm.runInNewContext(source, {
        window, Spicetify: { React: { memo: value => value }, Player: player },
        CONFIG: { visual: { 'translate:target-language': 'en' } },
        console: { warn() {} },
    }, { filename: 'SongInfoTicker.js' });
    return { research: window.SongResearch, window, player, requests, snapshots, snapshotReads, service,
        respond(value) { handler = value; } };
}

test('research for A never reads current B lyrics or borrows B metadata', async () => {
    const h = harness('B');
    await h.research.fetchResearch('A');
    const request = h.requests[0];
    assert.deepEqual(h.snapshotReads, ['spotify:track:A']);
    assert.equal(request.trackId, 'A');
    assert.equal(request.title, 'Saved song A');
    assert.equal(request.artist, 'Saved artist A');
    assert.deepEqual(normalize(request.lyrics), [{ text: 'Lyrics A' }]);
    for (const field of ['album', 'releaseDate', 'isrc']) assert.equal(request[field], '', `${field} cannot come from B`);
    assert.equal(request.spotifyUrl, 'https://open.spotify.com/track/A');
});

test('without saved A context, unrelated player metadata stays empty', async () => {
    const h = harness('B', new Map());
    await h.research.fetchResearch('A');
    const request = h.requests[0];
    for (const field of ['title', 'artist', 'album', 'releaseDate', 'isrc']) assert.equal(request[field], '');
    assert.deepEqual(normalize(request.lyrics), []);
    assert.deepEqual(h.snapshotReads, ['spotify:track:A']);
});

test('explicit A title and artist cannot be paired with B lyrics or album', async () => {
    const h = harness('B');
    await h.research.fetchResearch('A', false, { title: 'Explicit A', artist: 'Explicit artist A' });
    assert.equal(h.requests[0].title, 'Explicit A');
    assert.equal(h.requests[0].artist, 'Explicit artist A');
    assert.equal(h.requests[0].album, '');
    assert.deepEqual(normalize(h.requests[0].lyrics), [{ text: 'Lyrics A' }]);
});

test('a synchronous track switch after invocation cannot change the captured research context', async () => {
    const h = harness();
    const pending = h.research.fetchResearch('A');
    h.player.data.item = item('B');
    h.snapshots.set('spotify:track:A', snapshot('replacement'));
    await pending;
    const request = h.requests[0];
    assert.equal(request.title, 'Song A');
    assert.equal(request.artist, 'Artist A');
    assert.equal(request.album, 'Album A');
    assert.equal(request.isrc, 'isrc-A');
    assert.deepEqual(normalize(request.lyrics), [{ text: 'Lyrics A' }]);
});

test('a completed A result is cached under A without importing B content', async () => {
    const h = harness('B');
    const result = await h.research.fetchResearch('A');
    assert.equal(result.metadata.title, 'Saved song A');
    assert.equal(await h.research.fetchResearch('A'), result);
    assert.equal(h.requests.length, 1);
    const b = await h.research.fetchResearch('B');
    assert.equal(b.metadata.title, 'Song B');
    assert.equal(h.requests.length, 2);
});

test('saved track metadata is usable when playback is unavailable', async () => {
    const h = harness(null);
    await h.research.fetchResearch('A');
    assert.equal(h.requests[0].title, 'Saved song A');
    assert.equal(h.requests[0].artist, 'Saved artist A');
    assert.deepEqual(normalize(h.requests[0].lyrics), [{ text: 'Lyrics A' }]);
});

test('matching playback preserves complete metadata and requested language', async () => {
    const h = harness();
    await h.research.fetchResearch('A');
    const request = h.requests[0];
    assert.equal(request.title, 'Song A');
    assert.equal(request.artist, 'Artist A');
    assert.equal(request.album, 'Album A');
    assert.equal(request.releaseDate, 'release-A');
    assert.equal(request.isrc, 'isrc-A');
    assert.equal(request.lang, 'en');
    assert.equal(request.ignoreCache, false);
    assert.deepEqual(normalize(request.lyrics), [{ text: 'Lyrics A' }]);
});

test('explicit caller context retains precedence and the compatibility alias', async () => {
    const h = harness();
    const context = { title: 'Explicit title', artist: 'Explicit artist', album: 'Explicit album',
        releaseDate: 'Explicit date', isrc: 'Explicit ISRC', spotifyUrl: 'https://example.test/track', lyrics: [{ text: 'Explicit lyrics' }] };
    await h.research.fetchSongInfo('A', true, context);
    for (const [key, value] of Object.entries(context)) assert.deepEqual(normalize(h.requests[0][key]), value);
    assert.equal(h.requests[0].ignoreCache, true);
});

test('same-track concurrent calls share work and replay progress without replacing captured input', async () => {
    const h = harness();
    let resolve;
    h.respond(input => { input.onProgress({ marker: 'active draft' }, { stage: 1 }); return new Promise(done => { resolve = done; }); });
    const firstProgress = [], secondProgress = [];
    const first = h.research.fetchResearch('A', false, { onProgress: (...args) => firstProgress.push(normalize(args)) });
    await flush();
    h.player.data.item = item('B');
    const second = h.research.fetchResearch('A', false, { onProgress: (...args) => secondProgress.push(normalize(args)) });
    await flush();
    assert.equal(h.requests.length, 1);
    assert.deepEqual(firstProgress, secondProgress);
    assert.equal(h.requests[0].title, 'Song A');
    resolve({ marker: 'accepted final' });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
});

test('context lookup failures remain recoverable error results and never enter the cache', async () => {
    const h = harness();
    h.service.getLyricsSnapshot = () => { throw new Error('synthetic snapshot failure'); };
    const result = await h.research.fetchResearch('A');
    assert.deepEqual(normalize(result), { error: true, message: 'synthetic snapshot failure' });
    assert.equal(h.requests.length, 0);
    assert.equal(h.research.researchCache.size, 0);
    h.service.getLyricsSnapshot = () => snapshot('A');
    assert.equal((await h.research.fetchResearch('A')).metadata.title, 'Song A');
});

test('absent service and failed generation preserve error handling and later retries', async () => {
    const h = harness();
    h.window.LyricsService = null;
    assert.equal((await h.research.fetchResearch('A')).error, true);
    h.window.LyricsService = h.service;
    h.respond(() => { throw new Error('synthetic generation failure'); });
    assert.equal((await h.research.fetchResearch('A')).message, 'synthetic generation failure');
    h.respond(async input => ({ metadata: { title: input.title } }));
    assert.equal((await h.research.fetchResearch('A')).metadata.title, 'Song A');
});

test('a reentrant snapshot lookup joins the registered request instead of duplicating generation', async () => {
    const h = harness();
    let joined;
    h.service.getLyricsSnapshot = () => {
        joined = h.research.fetchResearch('A');
        return snapshot('A');
    };
    const first = h.research.fetchResearch('A');
    await flush();
    const [a, b] = await Promise.all([first, joined]);
    assert.equal(h.requests.length, 1);
    assert.equal(a, b);
});

test('an unavailable generation service with a throwing snapshot lookup returns its existing availability error', async () => {
    const h = harness();
    h.window.LyricsService = { getLyricsSnapshot() { throw new Error('synthetic lookup failure'); } };
    const result = await h.research.fetchResearch('A');
    assert.deepEqual(normalize(result), { error: true, message: 'LyricsService.getResearch is not available.' });
    assert.equal(h.research.researchCache.size, 0);
});

const localUri = title => `spotify:local:Shared%20artist:Album:${title}:120`;
const localItem = title => ({ ...item(title), uri: localUri(title), artists: [{ name: 'Shared artist' }] });
const localSnapshot = title => ({ ...snapshot(title), trackUri: localUri(title),
    trackInfo: { uri: localUri(title), title: `Saved ${title}`, artist: 'Shared artist' } });

test('local research retains its exact URI and metadata without inventing a Spotify track URL', async () => {
    const h = harness(null, new Map([[localUri('First'), localSnapshot('First')]]));
    h.player.data.item = localItem('First');
    await h.research.fetchResearch(localUri('First'));
    const request = h.requests[0];
    assert.equal(request.trackId, localUri('First'));
    assert.equal(request.title, 'Song First');
    assert.equal(request.artist, 'Shared artist');
    assert.equal(request.spotifyUrl, '');
    assert.deepEqual(h.snapshotReads, [localUri('First')]);
    assert.deepEqual(normalize(request.lyrics), [{ text: 'Lyrics First' }]);
});

test('local tracks by the same artist retain separate context, in-flight requests and cached results', async () => {
    const snapshots = new Map(['First', 'Second'].map(title => [localUri(title), localSnapshot(title)]));
    const h = harness(null, snapshots);
    h.player.data.item = localItem('Second');
    const [first, second] = await Promise.all([
        h.research.fetchResearch(localUri('First')), h.research.fetchResearch(localUri('Second')),
    ]);
    assert.equal(h.requests.length, 2);
    assert.equal(first.metadata.title, 'Saved First');
    assert.equal(second.metadata.title, 'Song Second');
    assert.equal(await h.research.fetchResearch(localUri('First')), first);
    assert.equal(await h.research.fetchResearch(localUri('Second')), second);
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.snapshotReads, [localUri('First'), localUri('Second')]);
});

const overlaySource = readFileSync(process.env.IVLYRICS_RESEARCH_CONTEXT_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_RESEARCH_CONTEXT_SOURCE_DIR, 'FullscreenOverlay.js')
    : new URL('../FullscreenOverlay.js', import.meta.url), 'utf8');
function overlayCallback(name, trackUri) {
    const endMarker = name === 'beginResearch'
        ? '}, [enableResearchPlaybackGuard, loadResearch, tmiMode, trackUri]);'
        : '}, [loadResearch, trackUri]);';
    const start = overlaySource.indexOf(`        const ${name} = useCallback(`);
    const end = overlaySource.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `missing actual overlay callback ${name}`);
    const calls = [];
    const context = { trackUri, tmiMode: false, tmiOpeningRef: { current: false },
        useCallback: callback => callback, enableResearchPlaybackGuard() {}, setTmiMode() {},
        async loadResearch(...args) { calls.push(args); } };
    vm.runInNewContext(`${overlaySource.slice(start, end + endMarker.length)}\nglobalThis.callback = ${name};`, context);
    return { callback: context.callback, calls };
}

for (const name of ['beginResearch', 'handleRegenerate']) {
    test(`${name}: actual fullscreen callback passes distinct full local identities`, async () => {
        for (const title of ['First', 'Second']) {
            const h = overlayCallback(name, localUri(title));
            await h.callback();
            assert.equal(h.calls[0][0], localUri(title));
            if (name === 'handleRegenerate') assert.equal(h.calls[0][1], true);
        }
    });
    test(`${name}: ordinary Spotify IDs and missing-track guards are unchanged`, async () => {
        const h = overlayCallback(name, 'spotify:track:0123456789ABCDEFGHIJKL');
        await h.callback();
        assert.equal(h.calls[0][0], '0123456789ABCDEFGHIJKL');
        const empty = overlayCallback(name, null);
        await empty.callback();
        assert.equal(empty.calls.length, 0);
    });
}
