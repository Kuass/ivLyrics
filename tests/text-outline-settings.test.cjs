const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const outlinePrefixes = [
  "original",
  "phonetic",
  "translation",
  "furigana",
  "cultural-annotations",
  "cultural-annotations-vinyl",
  "instrumental-break-label",
  "fullscreen-vinyl-original",
  "fullscreen-vinyl-phonetic",
  "fullscreen-vinyl-translation",
  "fullscreen-title",
  "fullscreen-artist",
  "fullscreen-clock",
  "fullscreen-tmi",
  "panel-lyrics-original",
  "panel-lyrics-phonetic",
  "panel-lyrics-translation",
];

test("every exposed typography role has persisted outline settings", () => {
  const settings = read("Settings.js");
  const config = read("index.js");

  for (const prefix of outlinePrefixes) {
    assert.match(settings, new RegExp(`createTextOutlineSettingItems\\(\\"${prefix}\\"`));
    assert.match(config, new RegExp(`ivLyrics:visual:${prefix}-outline-width`));
    assert.match(config, new RegExp(`ivLyrics:visual:${prefix}-outline-color`));
  }
});

test("outline defaults and outside-only shadow rendering are present", () => {
  const settings = read("Settings.js");
  const styles = read("style.css");
  const pages = read("Pages.js");
  const panel = read("NowPlayingPanelLyrics.js");
  const outlineStyles = styles.slice(styles.indexOf("/* Configurable outside-only text outlines."));

  assert.match(settings, /defaultValue: Number\(CONFIG\.visual\[`\$\{settingPrefix\}-outline-width`\] \?\? 0\)/);
  assert.match(settings, /defaultValue: CONFIG\.visual\[`\$\{settingPrefix\}-outline-color`\] \|\| "#000000"/);
  assert.match(pages, /const createOutsideTextOutlineShadow =/);
  assert.match(pages, /layers\.join\(", "\)/);
  assert.match(pages, /"--lyrics-original-outline-shadow": createOutsideTextOutlineShadow/);
  assert.match(settings, /textShadow: createOutsideTextOutlineShadow\(originalOutlineWidth, originalOutlineColor\)/);
  assert.match(panel, /const createPanelOutsideTextOutlineShadow =/);
  assert.match(panel, /--ivlyrics-panel-original-outline-shadow:/);
  assert.match(pages, /const createBlurredLineOutlineShadow =/);
  assert.match(pages, /rgba\([^`]+0\.03\)/);
  assert.match(pages, /"--lyrics-original-outline-blurred-shadow": createBlurredLineOutlineShadow/);
  assert.match(outlineStyles, /var\(--lyrics-original-outline-shadow, 0 0 0 transparent\)/);
  assert.match(pages, /className,[\s\S]*"data-outline-text": charInfo\.char/);
  assert.match(pages, /className: segmentClassName,[\s\S]*"data-outline-text": segment\.text/);
  assert.match(outlineStyles, /\.lyrics-karaoke-char::before,[\s\S]*\.lyrics-karaoke-text-run-segment::before\s*\{[\s\S]*-webkit-text-stroke-width:/);
  assert.match(outlineStyles, /blur-enabled[\s\S]*var\(--lyrics-original-outline-blurred-shadow/);
  assert.match(outlineStyles, /blur-enabled[\s\S]*lyrics-karaoke-char::before,[\s\S]*lyrics-karaoke-text-run-segment::before[\s\S]*var\(--lyrics-original-outline-blurred-stroke-width/);
  assert.doesNotMatch(outlineStyles, /\.lyrics-lyricsContainer-LyricsLine\s*\{[^}]*-webkit-text-stroke/);
});

test("karaoke effects keep the outline pseudo-layer isolated from fill paint", () => {
  const styles = read("style.css");
  const outlineStyles = styles.slice(styles.indexOf("/* Configurable outside-only text outlines."));

  assert.match(
    outlineStyles,
    /\.lyrics-karaoke-char::before,[\s\S]*?\.lyrics-karaoke-text-run-segment::before\s*\{[\s\S]*?-webkit-text-fill-color: transparent;[\s\S]*?text-shadow: none !important;[\s\S]*?filter: none !important;/
  );
  assert.match(
    outlineStyles,
    /\.lyrics-karaoke-glyph-fill\s*\{[\s\S]*?position: relative;[\s\S]*?overflow: visible;/
  );
  assert.match(
    outlineStyles,
    /\.lyrics-karaoke-char--active > \.lyrics-karaoke-glyph-fill,[\s\S]*?background-image: linear-gradient[\s\S]*?-webkit-text-fill-color: transparent;/
  );

  for (const effect of ["sparkle", "echo", "pop", "glow"]) {
    assert.match(
      styles,
      new RegExp(`\\.lyrics-karaoke-part\\.${effect} \\.lyrics-karaoke-line\\.is-active \\.lyrics-karaoke-char,[\\s\\S]*?animation: ivlyrics-kind-${effect}`)
    );
  }

  for (const effect of ["effect", "adlib", "bounce", "sway", "float", "blur", "glow", "glitch", "flicker"]) {
    assert.match(
      styles,
      new RegExp(`LyricsLine\\.${effect}\\.lyrics-lyricsContainer-LyricsLine-active > p`)
    );
  }

  for (const effect of ["pulse", "flicker"]) {
    assert.match(styles, new RegExp(`@keyframes ivlyrics-kind-${effect}`));
    assert.match(
      styles,
      new RegExp(`\\.lyrics-karaoke-part\\.${effect} \\.lyrics-karaoke-line\\.is-active,[\\s\\S]*?animation: ivlyrics-kind-${effect}`)
    );
  }

  assert.match(styles, /@keyframes ivlyrics-kind-glitch/);
  assert.match(
    styles,
    /\.lyrics-karaoke-part\.glitch \.lyrics-karaoke-line\.is-active,[\s\S]*?animation: ivlyrics-kind-glitch/
  );
});

test("all bundled languages include text outline labels", () => {
  const languageFiles = fs.readdirSync(path.join(root, "langs"))
    .filter((file) => /^Lang.*\.js$/.test(file));

  assert.equal(languageFiles.length, 22);
  for (const file of languageFiles) {
    const source = read(path.join("langs", file));
    assert.match(source, /"textOutline": \{/);
    assert.match(source, /"width": \{/);
    assert.match(source, /"color": \{/);
  }
});
