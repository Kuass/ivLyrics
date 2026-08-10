const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const providerFiles = [
  'Addon_AI_ChatGPT.js',
  'Addon_AI_Claude.js',
  'Addon_AI_Gemini.js',
  'Addon_AI_Groq.js',
  'Addon_AI_OpenRouter.js',
  'Addon_AI_Paxsenix.js',
  'Addon_AI_Perplexity.js',
  'Addon_AI_Pollinations.js',
];

test('bounded AI fetch helper loads before every affected provider', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const entries = manifest.subfiles_extension;
  const helperIndex = entries.indexOf('AIRequest.js');
  assert.ok(helperIndex >= 0);
  for (const file of providerFiles) assert.ok(helperIndex < entries.indexOf(file), file);
});

test('AI providers use the bounded fetch helper for every network call', () => {
  for (const file of providerFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /(?<![\w.])fetch\(/, file);
    assert.match(source, /window\.ivLyricsFetch\(/, file);
  }
});

test('provider operations have a whole-operation timeout and stale stream guard', () => {
  const source = fs.readFileSync(path.join(root, 'AIAddonManager.js'), 'utf8');
  assert.match(source, /PROVIDER_OPERATION_TIMEOUT_MS/);
  assert.match(source, /Promise\.race\(\[operation, timeout\]\)/);
  assert.match(source, /if \(!providerActive\) return/);
});
