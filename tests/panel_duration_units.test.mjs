import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const sourceFile = name => process.env.IVLYRICS_PANEL_DURATION_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_PANEL_DURATION_SOURCE_DIR, name)
  : new URL(`../${name}`, import.meta.url);
const panel = readFileSync(sourceFile('NowPlayingPanelLyrics.js'), 'utf8');
const service = readFileSync(sourceFile('LyricsService.js'), 'utf8');
const begin = panel.indexOf('        const loadLyricsFromExtension = useCallback(');
const end = panel.indexOf('        }, [loadTrackOffset]);', begin);
assert.ok(begin >= 0 && end > begin);
const loadSource = panel.slice(begin, end + '        }, [loadTrackOffset]);'.length);
const currentBegin = service.indexOf('        getCurrentTrackInfo() {');
const currentEnd = service.indexOf('\n        },', currentBegin);
assert.ok(currentBegin >= 0 && currentEnd > currentBegin);
const currentSource = service.slice(currentBegin, currentEnd + 11);
const trackId = uri => uri?.startsWith('spotify:track:') ? uri.split(':')[2] : null;
const track = (duration, metadata = {}) => ({ uri: 'spotify:track:fixture', name: 'Fixture', artists: [{ name: 'First' }, { name: 'Second' }], album: { name: 'Album' }, duration: { milliseconds: duration }, metadata });
async function fromPanel(item) {
  const requests = [];
  const loadingRef = { current: false }, loadSeqRef = { current: 0 }, lastTrackUri = { current: null };
  const context = vm.createContext({
    Spicetify: { Player: { data: { item } } }, getPanelTrackId: trackId,
    loadingRef, loadSeqRef, lastTrackUri, getSavedPanelLocalLyrics: () => null, panelDebug() {},
    useCallback: fn => fn, loadTrackOffset: async () => {}, currentLyricsState: {},
    isActiveLoad: (seq, uri) => loadSeqRef.current === seq && item?.uri === uri,
    setLyrics() {}, setKaraokeSource() {}, console,
    setTimeout() { throw new Error('Service is available; no retry timer expected'); },
    window: { LyricsService: {
      getTrackLyricsProviderOverride: async () => null,
      getTrackLanguageOverride: async () => null,
      getLyricsFromProviders: async info => { requests.push(info); return { error: 'Fixture stops after capture' }; },
    } },
  });
  vm.runInContext(`${loadSource}\nglobalThis.load = loadLyricsFromExtension;`, context);
  await context.load();
  return { info: requests[0] || null, loading: loadingRef.current, calls: requests.length };
}
function fromService(item, snapshot = {}) {
  let resolved;
  const api = vm.runInNewContext(`({${currentSource}})`, { Utils: {
    getPlayerPlaybackSnapshot: () => snapshot,
    resolveStablePlaybackTrack: (candidate, actualSnapshot) => { assert.equal(candidate, null); assert.equal(actualSnapshot, snapshot); resolved = true; return item; },
    extractTrackId: trackId,
  } });
  const info = api.getCurrentTrackInfo(); assert.equal(resolved, true); return info;
}
function queryDurations(info) {
  const window = { LyricsAddonManager: { register() {} } };
  const context = vm.createContext({ window, URL, atob, console, setTimeout() { throw new Error('No network or registration polling expected'); } });
  for (const name of ['Unison', 'LyricsPlus', 'Paxsenix']) {
    vm.runInContext(readFileSync(sourceFile(`Addon_Lyrics_${name}.js`), 'utf8'), context);
  }
  return {
    unison: window.__ivLyricsUnisonDebug.buildLyricsUrl(info).searchParams.get('duration'),
    lyricsPlus: window.__ivLyricsPlusDebug.buildLyricsUrl('https://fixture.invalid', info, '').searchParams.get('duration'),
    paxsenix: window.__ivLyricsPaxsenixDebug.normalizeDurationMilliseconds(info),
  };
}
const assertDuration = (info, ms) => {
  assert.deepEqual(queryDurations(info), {
    unison: Math.round(ms / 1000) > 0 ? String(Math.round(ms / 1000)) : null,
    lyricsPlus: ms > 0 ? String(ms / 1000) : null,
    paxsenix: ms,
  });
};
for (const duration of [500, 5000, 10000, 190000]) {
  test(`panel retains ${duration} ms through provider lookup`, async () => {
    const { info, calls, loading } = await fromPanel(track(duration));
    assertDuration(info, duration); assert.equal(calls, 1); assert.equal(loading, false);
  });
  test(`service snapshot retains ${duration} ms through provider lookup`, () => {
    assertDuration(fromService(track(250000), { duration }), duration);
  });
}
test('panel metadata duration fallback is explicitly milliseconds', async () => {
  const item = track(undefined, { duration: '5000' });
  const { info } = await fromPanel(item); assert.equal(info.duration, 5000); assert.equal(info.durationMs, 5000); assertDuration(info, 5000);
});
test('local panel tracks carry their full URI and the same millisecond units', async () => {
  const item = { ...track(5000), uri: 'spotify:local:Artist:Album:Clip:5' };
  const { info } = await fromPanel(item); assert.equal(info.uri, item.uri); assert.equal(info.trackId, null); assertDuration(info, 5000);
});
test('service zero snapshot falls back to the existing item duration source', () => {
  const info = fromService(track(5000), { duration: 0, playbackId: 'playback' });
  assert.equal(info.duration, 5000); assert.equal(info.playbackId, 'playback'); assertDuration(info, 5000);
});
test('panel preserves legacy fields and reads item duration only once', async () => {
  const item = track(5000); let reads = 0; Object.defineProperty(item.duration, 'milliseconds', { get() { reads++; return '5000'; } });
  const frozen = Object.freeze(item); const { info } = await fromPanel(frozen);
  assert.deepEqual(JSON.parse(JSON.stringify(info)), { uri: item.uri, title: 'Fixture', artist: 'First, Second', album: 'Album', duration: '5000', durationMs: '5000', trackId: 'fixture', languageOverride: null });
  assert.equal(reads, 1); assertDuration(info, 5000);
});
test('service preserves legacy fields and reads snapshot duration only once', () => {
  const item = Object.freeze(track(5000)); let reads = 0;
  const snapshot = { playbackId: 'playback', get duration() { reads++; return '5000'; } };
  const info = fromService(item, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(info)), { uri: item.uri, title: 'Fixture', artist: 'First, Second', album: 'Album', duration: '5000', durationMs: '5000', playbackId: 'playback', trackId: 'fixture' });
  assert.equal(reads, 1); assertDuration(info, 5000);
});
test('missing track and unavailable duration retain existing empty behavior', async () => {
  assert.equal((await fromPanel(null)).info, null); assert.equal(fromService(null), null);
  assertDuration((await fromPanel(track(undefined))).info, 0); assertDuration(fromService(track(undefined)), 0);
});
test('invalid panel metadata duration stays unusable without changing its legacy value', async () => {
  const { info } = await fromPanel(track(undefined, { duration: 'invalid' }));
  assert.equal(Number.isNaN(info.duration), true); assert.deepEqual(queryDurations(info), { unison: null, lyricsPlus: null, paxsenix: 0 });
});
