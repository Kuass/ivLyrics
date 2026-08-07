const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const pagesSource = readFileSync(resolve(__dirname, '..', '..', 'Pages.js'), 'utf8');

function getDecorationEditorSource() {
  const start = pagesSource.indexOf('const CreatorDecorationEditor');
  const end = pagesSource.indexOf('const SyncCreatorProfileModal', start);
  assert.notEqual(start, -1, 'creator decoration editor must exist');
  assert.notEqual(end, -1, 'creator decoration editor boundary must exist');
  return pagesSource.slice(start, end);
}

test('creator decoration inputs snapshot DOM values before functional state updates', () => {
  const source = getDecorationEditorSource();

  assert.match(source, /const nextColor = event\.currentTarget\.value\.toUpperCase\(\);/);
  assert.match(source, /\[key\]: nextColor/);
  assert.match(source, /const nextAngle = Number\(event\.currentTarget\.value\);/);
  assert.match(source, /gradientAngle: nextAngle/);
  assert.doesNotMatch(
    source,
    /setDraft\(\(current\) => \([^)]*event\.currentTarget/s,
    'React event objects must not be read from deferred state updater callbacks'
  );
});
