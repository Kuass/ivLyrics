const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

test('newly generated lyrics invalidate only the shared presentation snapshot', () => {
    const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    const lyricsServiceSource = fs.readFileSync(path.join(ROOT, 'LyricsService.js'), 'utf8');

    assert.match(
        lyricsServiceSource,
        /clearLyricsPresentationSnapshot\(trackUri\)\s*\{[\s\S]*?lyricsPresentationSnapshots\.delete\(trackUri\)/
    );
    assert.match(
        lyricsServiceSource,
        /clearLyricsSnapshot\(trackUri\)\s*\{\s*lyricsProviderRequestGeneration \+= 1;\s*return this\.clearLyricsPresentationSnapshot\(trackUri\);/
    );
    assert.match(
        indexSource,
        /refreshLyricsAfterCacheEdit\(\)[\s\S]*?this\.invalidateSharedLyricsPresentation\(trackUri\);[\s\S]*?this\.lyricsSource\(/
    );
    assert.match(
        indexSource,
        /this\.invalidateSharedLyricsPresentation\(currentUri\);\s*\/\/ lyricsSource를 다시 호출[\s\S]*?this\.lyricsSource\(this\.state, currentMode\);/
    );
});

test('overlay sender maps generated pronunciation and translation fields', () => {
    const source = fs.readFileSync(path.join(ROOT, 'LyricsService.js'), 'utf8');
    const start = source.indexOf('const mapLyricsForSender = ');
    const end = source.indexOf('\n    const LYRICS_SEND_RETRY_DELAYS', start);

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const context = {};
    vm.runInNewContext(
        `${source.slice(start, end)}\nthis.mapLyricsForSender = mapLyricsForSender;`,
        context
    );

    const mapped = context.mapLyricsForSender([
        {
            startTime: 1000.4,
            endTime: 2499.6,
            originalText: '原文',
            phoneticText: 'genbun',
            translationText: '원문',
        },
        {
            startTime: 3000,
            text: 'Original',
            pronText: 'Pronunciation',
            transText: 'Translation',
        },
    ], 100);

    assert.deepEqual(
        JSON.parse(JSON.stringify(mapped)),
        [
            {
                startTime: 1100,
                endTime: 2600,
                text: '原文',
                pronText: 'genbun',
                transText: '원문',
            },
            {
                startTime: 3100,
                endTime: null,
                text: 'Original',
                pronText: 'Pronunciation',
                transText: 'Translation',
            },
        ]
    );
});
