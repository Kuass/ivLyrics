const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const repoRoot = resolve(__dirname, "..", "..");
const selectorSource = readFileSync(resolve(repoRoot, "CommunityVideoSelector.js"), "utf8");
const stylesSource = readFileSync(resolve(repoRoot, "style.css"), "utf8");

test("video editing hydrates existing skipped sections into the shared editor", () => {
  assert.match(
    selectorSource,
    /setSubmitSkipSegments\(Utils\.normalizeVideoSkipSegments\(video\?\.skipSegments\)\)/
  );
  assert.match(selectorSource, /const \[editingSkipSegmentIndex, setEditingSkipSegmentIndex\]/);
  assert.match(selectorSource, /setEditingSkipSegmentIndex\(index\)/);
  assert.match(selectorSource, /setSkipSegmentStart\(String\(segment\.start\)\)/);
  assert.match(selectorSource, /setSkipSegmentEnd\(String\(segment\.end\)\)/);
});

test("saving an edited skipped section replaces it instead of requiring removal", () => {
  assert.match(
    selectorSource,
    /index === editingSkipSegmentIndex \? \{ start, end \} : segment/
  );
  assert.match(
    selectorSource,
    /editingSkipSegmentIndex === null[\s\S]*?COMMUNITY_VIDEO_MAX_SKIP_SEGMENTS/
  );
  assert.match(selectorSource, /setEditingSkipSegmentIndex\(null\)/);
});

test("skipped section rows expose accessible edit, update, and cancel controls", () => {
  assert.match(selectorSource, /className: `community-video-skip-edit/);
  assert.match(selectorSource, /"aria-label": `\$\{I18n\.t\("communityVideo\.edit"\)\}:/);
  assert.match(selectorSource, /I18n\.t\("communityVideo\.updateAction"\)/);
  assert.match(selectorSource, /className: "community-video-skip-cancel"/);
  assert.match(stylesSource, /\.community-video-skip-edit:focus-visible/);
  assert.match(stylesSource, /\.community-video-skip-cancel:focus-visible/);
});

test("every locale already provides the reused edit and update labels", () => {
  const localeFiles = readdirSync(resolve(repoRoot, "langs"))
    .filter((file) => /^Lang.+\.js$/.test(file));

  assert.equal(localeFiles.length, 22);
  for (const localeFile of localeFiles) {
    const localeSource = readFileSync(resolve(repoRoot, "langs", localeFile), "utf8");
    const communityVideoStart = localeSource.indexOf('"communityVideo": {');
    assert.notEqual(communityVideoStart, -1, `${localeFile} has no communityVideo section`);
    const communityVideoSection = localeSource.slice(communityVideoStart);
    assert.match(communityVideoSection, /"edit"\s*:/, `${localeFile} is missing communityVideo.edit`);
    assert.match(
      communityVideoSection,
      /"updateAction"\s*:/,
      `${localeFile} is missing communityVideo.updateAction`
    );
  }
});
