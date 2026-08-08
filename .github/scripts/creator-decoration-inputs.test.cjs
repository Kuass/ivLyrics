const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const pagesSource = readFileSync(resolve(__dirname, '..', '..', 'Pages.js'), 'utf8');
const utilsSource = readFileSync(resolve(__dirname, '..', '..', 'Utils.js'), 'utf8');
const stylesSource = readFileSync(resolve(__dirname, '..', '..', 'style.css'), 'utf8');

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

test('creator decorations come from sync contributors without an extra Worker request', () => {
  assert.match(
    pagesSource,
    /decoration: !identityHidden && contributor\.decoration/,
    'sync contributor decorations must survive display normalization'
  );
  assert.match(
    pagesSource,
    /decoration: contributor\?\.decoration \|\| null/,
    'support presentation must use the embedded contributor decoration'
  );
  assert.doesNotMatch(pagesSource, /fetchCreatorDecorations/);
  assert.doesNotMatch(utilsSource, /creator-decorations/);
  assert.match(utilsSource, /discord\.ivl\.is\/v1\/user/);
  assert.match(utilsSource, /expiresAt: now \+ 60 \* 60 \* 1000/);
});

test('nickname style editor is collapsed behind an accessible profile settings button', () => {
  assert.match(
    pagesSource,
    /const \[isDecorationEditorOpen, setIsDecorationEditorOpen\] = react\.useState\(false\)/,
    'nickname styling must start collapsed'
  );
  assert.match(pagesSource, /className: `lyrics-creator-profile-decoration-toggle/);
  assert.match(pagesSource, /"aria-expanded": isDecorationEditorOpen/);
  assert.match(pagesSource, /"aria-controls": "lyrics-creator-decoration-panel"/);
  assert.match(pagesSource, /hidden: !isDecorationEditorOpen/);
  assert.match(stylesSource, /\.lyrics-creator-decoration-panel\[hidden\]\s*\{\s*display: none;/);
  assert.match(stylesSource, /\.lyrics-creator-profile-decoration-toggle[\s\S]*?width: 40px;[\s\S]*?height: 40px;/);
});
