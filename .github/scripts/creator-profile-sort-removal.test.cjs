const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const repoRoot = resolve(__dirname, '..', '..');
const pagesSource = readFileSync(resolve(repoRoot, 'Pages.js'), 'utf8');
const utilsSource = readFileSync(resolve(repoRoot, 'Utils.js'), 'utf8');
const stylesSource = readFileSync(resolve(repoRoot, 'style.css'), 'utf8');

function getSyncCreatorProfileRequestSource() {
  const start = utilsSource.indexOf('async fetchSyncCreatorProfile');
  const end = utilsSource.indexOf('async fetchSyncCreatorPrivacy', start);
  assert.notEqual(start, -1, 'creator profile request helper must exist');
  assert.notEqual(end, -1, 'creator profile request helper boundary must exist');
  return utilsSource.slice(start, end);
}

test('creator profiles no longer expose recent or popular sorting controls', () => {
  for (const removedToken of [
    'profileSort',
    'handleSortChange',
    'activeSortMode',
    'onSortChange',
    'sortRecent',
    'sortPopular',
    'lyrics-creator-profile-sort-controls',
    'lyrics-creator-profile-sort-btn'
  ]) {
    assert.doesNotMatch(pagesSource, new RegExp(removedToken));
    assert.doesNotMatch(stylesSource, new RegExp(removedToken));
  }
});

test('creator profile requests keep pagination and artist filtering without a sort parameter', () => {
  const requestSource = getSyncCreatorProfileRequestSource();

  assert.doesNotMatch(requestSource, /options\.sort|params\.set\(["']sort["']/);
  assert.match(requestSource, /params\.set\("limit"/);
  assert.match(requestSource, /params\.set\("offset"/);
  assert.match(requestSource, /params\.set\("artist"/);
});

test('creator profile sort translations are removed from every locale', () => {
  const langsDir = resolve(repoRoot, 'langs');
  const localeFiles = readdirSync(langsDir).filter((file) => /^Lang.+\.js$/.test(file));
  assert.ok(localeFiles.length > 0, 'locale files must exist');

  for (const localeFile of localeFiles) {
    const localeSource = readFileSync(resolve(langsDir, localeFile), 'utf8');
    assert.doesNotMatch(localeSource, /"sort(?:Label|Recent|Popular|Title|Artist)"\s*:/, localeFile);
  }
});
