import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const sourcePath = process.env.PANEL_PLACEMENT_SOURCE || new URL('../../NowPlayingPanelLyrics.js', import.meta.url);
const source = readFileSync(sourcePath, 'utf8');
const segments = [];
function exact(first, last, label) {
  const start = source.indexOf(first);
  assert.ok(start >= 0 && source.indexOf(first, start + first.length) < 0, `unique start: ${label}`);
  const end = last === null ? source.indexOf('\n', start) : source.indexOf(last, start + first.length);
  assert.ok(end > start, `end: ${label}`);
  const text = source.slice(start, end);
  segments.push({ label, startByte: Buffer.byteLength(source.slice(0, start)), endByteExclusive: Buffer.byteLength(source.slice(0, end)), startLine: source.slice(0, start).split('\n').length, endLine: source.slice(0, end).split('\n').length, sha256: sha256(text), text });
  return text;
}
const parts = [];
for (const name of ['STORAGE_KEY', 'DEFAULT_ENABLED', 'PANEL_CONTAINER_CLASS', 'PANEL_SECTION_CLASS', 'NOWPLAYING_BAR_CONTAINER_CLASS']) parts.push(exact(`    const ${name} =`, null, name));
for (const name of ['panelObserver', 'lyricsRoot', 'starryNightBarRoot', 'insertTimer']) parts.push(exact(`    let ${name} =`, null, name));
parts.push(exact('    const clearInsertTimer = () => {', '    const setPanelActiveState =', 'clearInsertTimer'));
parts.push(exact('    const getCurrentPathname = () => {', '    // ============================================\n    // 유틸리티 함수', 'route and insertion timer functions'));
parts.push(exact('    const getStorageValue = (key, defaultValue) => {', '    const getVisualSetting =', 'getStorageValue'));
parts.push(exact('    const ONLY_WHEN_SPOTIFY_MISSING_KEY =', '    const setStorageValue =', 'native gate with complete request/cache helpers'));
parts.push(exact('    const findNowPlayingPanel = () => {', '    // ============================================\n    // 가사 데이터 수신 및 전달', 'complete placement and observer region'));
// The wrapper exposes target functions and state only. No target body is rewritten.
const prefix = '"use strict";\n';
const suffix = `\nglobalThis.target = {
  findNowPlayingPanel, insertPanelLyrics, removePanelLyrics, setupObserver, ensureObserverRoot,
  syncObserverToNativeLyrics, teardownObserver, clearInsertTimer, scheduleInsertPanelLyrics,
  getNativeLyricsGateState, isIvLyricsPageActive,
  snapshot: () => ({ panelObserver, lyricsRoot, starryNightBarRoot, insertTimer, nativePending: nativeLyricsPending.size }),
  seedNative: (uri, value) => nativeLyricsCache.set(uri, value),
  pendingNative: () => [...nativeLyricsPending.values()]
};\n`;
export const compiledSource = prefix + parts.join('\n') + suffix;
export const extraction = { sourceBlob: gitBlob(Buffer.from(source)), sourceSHA256: sha256(source), compiledSHA256: sha256(compiledSource), prefix, suffix, segments: segments.map(({ text, ...rest }) => rest) };
