const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const sh = fs.readFileSync(path.join(root, 'updater/install.sh'), 'utf8');
const ps = fs.readFileSync(path.join(root, 'updater/install.ps1'), 'utf8');

test('Unix updater normalizes release tag prefixes before comparison', () => {
  assert.match(sh, /normalize_version\(\)/);
  assert.match(sh, /CURRENT_VERSION_NORMALIZED[^\n]*normalize_version/);
  assert.match(sh, /CURRENT_VERSION_NORMALIZED" = "\$LATEST_VERSION_NORMALIZED/);
});

test('Windows updater normalizes release tag prefixes before comparison', () => {
  assert.match(ps, /function Get-NormalizedVersion/);
  assert.match(ps, /currentVersionNormalized = Get-NormalizedVersion/);
  assert.match(ps, /currentVersionNormalized -eq \$latestVersionNormalized/);
});
