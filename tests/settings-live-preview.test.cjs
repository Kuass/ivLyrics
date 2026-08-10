const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const settings = fs.readFileSync(path.join(root, "Settings.js"), "utf8");

test("live preview uses a separate flow spacer so its sticky surface reaches the viewport edge", () => {
  assert.match(
    settings,
    /className: "settings-live-preview-spacer",[\s\S]*?className: "settings-live-preview-sticky"/
  );
  assert.match(
    settings,
    /\.settings-live-preview-sticky \{[\s\S]*?position: sticky;[\s\S]*?top: calc\(-1 \* var\(--settings-content-top-padding, 46px\)\);[\s\S]*?margin: 0 -12px;[\s\S]*?background: var\(--settings-page\);/
  );
  assert.match(settings, /--settings-content-top-padding: 46px;[\s\S]*?padding: 46px 54px 64px !important;/);
  assert.doesNotMatch(
    settings,
    /\.settings-live-preview-sticky \{[^}]*margin:\s*30px 0 0;/
  );
});

test("live preview header and stage read as one deliberate panel", () => {
  assert.match(
    settings,
    /\.settings-live-preview-sticky > \.section-title \{[\s\S]*?border-bottom: 0 !important;[\s\S]*?border-radius: 9px 9px 0 0 !important;/
  );
  assert.match(
    settings,
    /\.settings-live-preview-sticky \.font-preview-container \{[\s\S]*?border-top: 0\.5px solid var\(--settings-divider\) !important;[\s\S]*?border-radius: 0 0 9px 9px !important;/
  );
  assert.match(
    settings,
    /\.settings-live-preview-sticky > \.section-title::before \{[\s\S]*?background: var\(--accent-primary\);/
  );
});
