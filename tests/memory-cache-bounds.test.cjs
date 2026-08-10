const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

test('TMI memory cache evicts least-recently-used entries', () => {
  const source = fs.readFileSync(path.join(root, 'SongInfoTicker.js'), 'utf8');
  assert.match(source, /MAX_TMI_CACHE_ENTRIES\s*=\s*100/);
  assert.match(source, /while \(tmiCache\.size > MAX_TMI_CACHE_ENTRIES\)/);
  assert.match(source, /tmiCache\.delete\(tmiCache\.keys\(\)\.next\(\)\.value\)/);
});

test('metadata translation memory cache uses bounded LRU storage', () => {
  const source = fs.readFileSync(path.join(root, 'LyricsService.js'), 'utf8');
  assert.match(source, /static _metadataCache = new LRUCache\(200\)/);
  assert.match(source, /\*keys\(\)/);
  assert.match(source, /delete\(key\)/);
});
