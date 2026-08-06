const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const repoRoot = resolve(__dirname, '..', '..');
const pagesSource = readFileSync(resolve(repoRoot, 'Pages.js'), 'utf8');
const settingsSource = readFileSync(resolve(repoRoot, 'Settings.js'), 'utf8');
const indexSource = readFileSync(resolve(repoRoot, 'index.js'), 'utf8');

function readIntegerConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = (\\d+);`));
  assert.ok(match, `${name} must be declared as an integer constant`);
  return Number(match[1]);
}

function getFrameRateSliderBlock() {
  const settingIndex = settingsSource.lastIndexOf('key: "performance-frame-rate"');
  assert.notEqual(settingIndex, -1, 'performance frame-rate slider must exist');
  return settingsSource.slice(settingIndex, settingIndex + 500);
}

function createFrameRateResolver() {
  const functionMatch = pagesSource.match(/const getTrackPositionFPS = \(\) => \{[\s\S]*?\n\};/);
  assert.ok(functionMatch, 'getTrackPositionFPS implementation must exist');
  const defaultFPS = readIntegerConstant(pagesSource, 'DEFAULT_TRACK_POSITION_FPS');
  const minFPS = readIntegerConstant(pagesSource, 'MIN_TRACK_POSITION_FPS');
  const maxFPS = readIntegerConstant(pagesSource, 'MAX_TRACK_POSITION_FPS');

  return (configuredValue) => Function(
    'CONFIG',
    `const DEFAULT_TRACK_POSITION_FPS = ${defaultFPS};\n`
      + `const MIN_TRACK_POSITION_FPS = ${minFPS};\n`
      + `const MAX_TRACK_POSITION_FPS = ${maxFPS};\n`
      + `${functionMatch[0]}\n`
      + 'return getTrackPositionFPS();'
  )({ visual: { 'performance-frame-rate': configuredValue } });
}

test('performance slider offers up to 240 FPS while keeping 60 FPS as the default', () => {
  const sliderBlock = getFrameRateSliderBlock();

  assert.match(sliderBlock, /defaultValue: Number\(CONFIG\.visual\["performance-frame-rate"\] \?\? 60\)/);
  assert.match(sliderBlock, /min: 10/);
  assert.match(sliderBlock, /max: 240/);
  assert.match(sliderBlock, /step: 1/);

  const configIndex = indexSource.indexOf('"performance-frame-rate":');
  assert.notEqual(configIndex, -1, 'performance frame-rate config must exist');
  assert.match(indexSource.slice(configIndex, configIndex + 180), /\|\|\s*60/);
});

test('lyrics rendering accepts high-refresh values and clamps only above 240 FPS', () => {
  const resolveFrameRate = createFrameRateResolver();

  assert.equal(resolveFrameRate(undefined), 60);
  assert.equal(resolveFrameRate(10), 10);
  assert.equal(resolveFrameRate(60), 60);
  assert.equal(resolveFrameRate(144), 144);
  assert.equal(resolveFrameRate(240), 240);
  assert.equal(resolveFrameRate(360), 240);
  assert.equal(resolveFrameRate(5), 10);
});
