import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const sourceFile = name => process.env.IVLYRICS_DURATION_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_DURATION_SOURCE_DIR, name)
  : new URL(`../${name}`, import.meta.url);
const metadata = { title: 'Fixture', artist: 'Artist', album: 'Album', uri: 'spotify:track:fixture' };
const createProviders = (fetch = () => { throw new Error('Unexpected request'); }) => {
  const window = { LyricsAddonManager: { register() {} } };
  const timers = new Set();
  let nextTimer = 0;
  const context = vm.createContext({
    window, console, URL, atob, AbortController, fetch,
    setTimeout() { const timer = ++nextTimer; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  });
  for (const name of ['Unison', 'LyricsPlus', 'Paxsenix']) {
    vm.runInContext(readFileSync(sourceFile(`Addon_Lyrics_${name}.js`), 'utf8'), context);
  }
  return { window, timers };
};
const getDurations = (window, info) => ({
  unison: window.__ivLyricsUnisonDebug.buildLyricsUrl(info).searchParams.get('duration'),
  lyricsPlus: window.__ivLyricsPlusDebug.buildLyricsUrl('https://fixture.invalid', info, '').searchParams.get('duration'),
  paxsenix: window.__ivLyricsPaxsenixDebug.normalizeDurationMilliseconds(info),
});
const assertDurations = (info, milliseconds) => {
  const { window } = createProviders();
  assert.deepEqual(getDurations(window, { ...metadata, ...info }), {
    unison: Math.round(milliseconds / 1000) > 0 ? String(Math.round(milliseconds / 1000)) : null,
    lyricsPlus: milliseconds > 0 ? String(Math.round(milliseconds) / 1000) : null,
    paxsenix: Math.round(milliseconds),
  });
};
const infoFromTrack = track => {
  const source = readFileSync(sourceFile('index.js'), 'utf8');
  const match = source.match(/^  infoFromTrack\(track\) \{[\s\S]*?^  \}/m);
  assert.ok(match, 'actual track-info method must be found');
  const holder = vm.runInNewContext(`({${match[0]}})`);
  return holder.infoFromTrack(track);
};
const track = duration => ({
  uri: metadata.uri,
  metadata: { duration, title: metadata.title, artist_name: metadata.artist, album_title: metadata.album },
  duration: { milliseconds: 9000 },
});

for (const key of ['durationMs', 'duration_ms']) {
  for (const value of [1, 500, 5000, 10000, 10001, '5000']) {
    test(`${key}=${JSON.stringify(value)} remains milliseconds`, () => assertDurations({ [key]: value }, Number(value)));
  }
}
for (const [value, milliseconds] of [[5, 5000], [180, 180000], [10000, 10000000], [10001, 10001], [180000, 180000]]) {
  test(`legacy duration=${value} retains its existing heuristic`, () => assertDurations({ duration: value }, milliseconds));
}
for (const value of [0, -1, '', 'invalid', Infinity, NaN]) {
  test(`invalid or zero explicit value ${String(value)} does not fall back to ambiguous duration`, () => {
    assertDurations({ durationMs: value, duration_ms: 6000, duration: 180 }, 0);
  });
}
test('explicit precedence and nullish fallback retain the existing order', () => {
  assertDurations({ durationMs: 5000, duration_ms: 6000, duration: 180 }, 5000);
  assertDurations({ durationMs: null, duration_ms: 6000, duration: 180 }, 6000);
  assertDurations({ durationMs: undefined, duration_ms: undefined, duration: 180 }, 180000);
});
test('canonical Spotify metadata carries an explicit unit without changing existing duration', () => {
  const info = infoFromTrack(track('5000'));
  assert.equal(info.duration, 5000);
  assert.equal(info.durationMs, 5000);
  assert.equal(info.title, metadata.title);
  assert.equal(info.artist, metadata.artist);
  assert.equal(info.uri, metadata.uri);
  assertDurations(info, 5000);
});
test('canonical track-info keeps missing metadata and invalid duration behavior', () => {
  assert.equal(infoFromTrack(null), null);
  assert.equal(infoFromTrack({ duration: { milliseconds: 5000 } }), null);
  assert.equal(Number.isNaN(infoFromTrack(track('invalid')).duration), true);
  assertDurations(infoFromTrack(track('invalid')), 0);
});
test('Paxsenix ranks the short matching recording ahead of the longer same-title recording', () => {
  const { window } = createProviders();
  const candidates = [
    { ...metadata, id: 'long', durationSeconds: 600 },
    { ...metadata, id: 'short', durationSeconds: 5 },
  ];
  const chosen = window.__ivLyricsPaxsenixDebug.selectBestCandidate(candidates, { ...metadata, durationMs: 5000 });
  assert.equal(chosen.candidate.id, 'short');
});

const success = body => ({ ok: true, status: 200, json: async () => body });
for (const useCanonicalTrack of [false, true]) {
  const description = useCanonicalTrack ? 'canonical metadata' : 'explicit milliseconds';
  test(`Unison public lookup uses five seconds and closes the last LRC line at 5000 ms from ${description}`, async () => {
    const requests = [];
    const { window, timers } = createProviders(async url => {
      requests.push(new URL(url));
      return success({ data: { format: 'lrc', lyrics: '[00:01.00]A fixture line' } });
    });
    const info = useCanonicalTrack ? infoFromTrack(track(5000)) : { ...metadata, duration_ms: 5000 };
    const result = await window.UnisonLyricsAddon.getLyrics(info);
    assert.equal(result.error, null);
    assert.equal(requests[0].searchParams.get('duration'), '5');
    assert.equal(result.synced.at(-1).endTime, 5000);
    assert.equal(timers.size, 0);
  });
  test(`LyricsPlus public lookup uses five seconds from ${description}`, async () => {
    const requests = [];
    const { window, timers } = createProviders(async url => {
      requests.push(new URL(url));
      return success({ type: 'Line', lyrics: [{ text: 'A fixture line', time: 1000 }] });
    });
    const info = useCanonicalTrack ? infoFromTrack(track(5000)) : { ...metadata, durationMs: 5000 };
    const result = await window.LyricsPlusLyricsAddon.getLyrics(info);
    assert.equal(result.error, null);
    assert.equal(requests[0].searchParams.get('duration'), '5');
    assert.equal(result.synced.at(-1).endTime, 5000);
    assert.equal(timers.size, 0);
  });
  test(`Paxsenix public lookup selects and bounds the short recording from ${description}`, async () => {
    const requests = [];
    const { window, timers } = createProviders(async url => {
      const parsed = new URL(url);
      requests.push(parsed);
      if (parsed.hostname === 'itunes.apple.com') return success({ results: [] });
      if (parsed.pathname.endsWith('/search')) return success([
        { hash: 'long', ...metadata, duration: 600 },
        { hash: 'short', ...metadata, duration: 5 },
      ]);
      assert.ok(parsed.pathname.endsWith('/lyrics'));
      return success({ syncType: 'line', lyrics: [{ timestamp: 1000, endtime: 8000, text: 'A fixture line' }] });
    });
    const info = useCanonicalTrack ? infoFromTrack(track(5000)) : { ...metadata, duration_ms: 5000 };
    const result = await window.PaxsenixLyricsAddon.getLyrics(info);
    assert.equal(result.error, null);
    const lyricsRequest = requests.find(url => url.pathname.endsWith('/lyrics'));
    assert.equal(lyricsRequest.searchParams.get('id'), 'short');
    assert.equal(result.synced.at(-1).endTime, 5000);
    assert.equal(timers.size, 0);
  });
}
