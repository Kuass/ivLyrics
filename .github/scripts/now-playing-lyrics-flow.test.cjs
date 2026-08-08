const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const repoRoot = resolve(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'manifest.json'), 'utf8'));
const panelSource = readFileSync(resolve(repoRoot, 'NowPlayingPanelLyrics.js'), 'utf8');

test('Now Playing keeps its renderer inside the global extension boundary', () => {
  assert.ok(manifest.subfiles.includes('Pages.js'));
  assert.ok(manifest.subfiles_extension.includes('NowPlayingPanelLyrics.js'));
  assert.doesNotMatch(panelSource, /window\.LyricsPageRenderer|window\.ivLyricsShared/);
});

test('Now Playing advances a persistent line stack without per-row FLIP animations', () => {
  assert.match(panelSource, /const panelLines = useMemo\(\(\) => \{/);
  assert.match(panelSource, /return displayableLyrics\.map\(\(entry, displayIndex\) => \{/);
  assert.match(panelSource, /updatePanelStackPosition\(wrapper\)/);
  assert.doesNotMatch(panelSource, /pendingLineTransitionRef|lineTransitionAnimationsRef|cell\.animate\(/);
});

test('active and inactive panel lines keep the same text layout metrics', () => {
  assert.match(
    panelSource,
    /\.ivlyrics-panel-current-line \.ivlyrics-panel-line \{[\s\S]*?min-height: 0 !important;[\s\S]*?height: auto !important;/
  );
  assert.match(
    panelSource,
    /\.ivlyrics-panel-line\.active \.ivlyrics-panel-line-text \{[\s\S]*?font-weight: 700 !important;/
  );
  assert.match(panelSource, /react\.createElement\("p", \{\s*className: "ivlyrics-panel-line-text"/);
  assert.match(panelSource, /\.ivlyrics-panel-line-cell \.ivlyrics-panel-line-text,[\s\S]*?-webkit-line-clamp: unset !important;/);
});

test('presentation height corrections do not reuse the playback transition', () => {
  assert.match(panelSource, /const lyricsLayoutChanged = previousLyricsLayoutRef\.current !== lyrics;/);
  assert.match(panelSource, /suppressLayoutShiftRef\.current = suppressTransition;/);
  assert.match(panelSource, /stack\.style\.setProperty\('transition', 'none', 'important'\);/);
});

test('panel edges fade lyric rows in and out without masking the card', () => {
  const wrapperStart = panelSource.indexOf('.ivlyrics-panel-lyrics-wrapper {');
  const wrapperEnd = panelSource.indexOf('\n}', wrapperStart);
  const wrapperStyles = panelSource.slice(wrapperStart, wrapperEnd);

  assert.match(wrapperStyles, /mask-image: linear-gradient\(/);
  assert.match(wrapperStyles, /transparent 0%/);
  assert.match(wrapperStyles, /#000 14%/);
  assert.match(wrapperStyles, /#000 86%/);
  assert.match(wrapperStyles, /transparent 100%/);
});
