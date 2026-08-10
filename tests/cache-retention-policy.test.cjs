const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const lyricsService = fs.readFileSync(path.join(root, 'LyricsService.js'), 'utf8');
const utils = fs.readFileSync(path.join(root, 'Utils.js'), 'utf8');

test('persistent lyric caches retain entries for one year with a 10 GiB cap', () => {
    assert.match(lyricsService, /MAX_TOTAL_BYTES:\s*10 \* 1024 \* 1024 \* 1024/);
    for (const type of ['lyrics', 'translation', 'phonetic', 'cultural', 'metadata', 'sync', 'youtube', 'tmi']) {
        assert.match(lyricsService, new RegExp(`${type}:\\s*365`));
    }
    assert.match(lyricsService, /entries\.sort\(\(a, b\) => a\.cachedAt - b\.cachedAt\)/);
    assert.match(lyricsService, /storage\.persist\(\)/);
});

test('selected community videos use the same one-year retention window', () => {
    assert.match(utils, /365 \* 24 \* 60 \* 60 \* 1000/);
});
