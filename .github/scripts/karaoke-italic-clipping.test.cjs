const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const styles = fs.readFileSync(path.join(root, "style.css"), "utf8");

const cssBlock = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `Missing CSS block for ${selector}`);
  return match[1];
};

const cssBlocks = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(styles.matchAll(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "g")))
    .map((match) => match[1]);
};

test("italic karaoke paint bleed does not change inline advance width", () => {
  const fill = cssBlock(".lyrics-karaoke-glyph-fill");

  assert.match(fill, /display:\s*inline-block/);
  assert.match(fill, /padding-inline:\s*var\(--karaoke-glyph-bleed-x, 0\.16em\)/);
  assert.match(fill, /margin-inline:\s*calc\(var\(--karaoke-glyph-bleed-x, 0\.16em\) \* -1\)/);
  assert.match(fill, /overflow:\s*visible/);
});

test("translated effect rows use one stacking context instead of one per glyph", () => {
  const lineBlocks = cssBlocks(".lyrics-karaoke-line");
  const glyphs = cssBlock(".lyrics-karaoke-char,\n.lyrics-karaoke-text-run-segment");
  const outline = cssBlock(".lyrics-karaoke-char::before,\n.lyrics-karaoke-text-run-segment::before");

  assert.ok(lineBlocks.some((block) => /isolation:\s*isolate/.test(block)));
  assert.doesNotMatch(glyphs, /isolation:\s*isolate/);
  assert.doesNotMatch(glyphs, /z-index:\s*0/);
  assert.match(outline, /z-index:\s*-1/);
  assert.match(outline, /text-shadow:\s*none !important/);
  assert.match(outline, /filter:\s*none !important/);
});
