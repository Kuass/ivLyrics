const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadUtils() {
    const context = {
        console,
        window: {
            LyricsCache: {},
            ApiTracker: {}
        },
        document: {
            documentElement: {
                style: {
                    setProperty() {}
                }
            }
        },
        localStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        navigator: {},
        setTimeout() { return 0; },
        clearTimeout() {},
        URL,
        Blob
    };
    context.globalThis = context;

    const source = fs.readFileSync(path.join(__dirname, '..', 'Utils.js'), 'utf8');
    vm.runInNewContext(`${source}\n;globalThis.__utils = Utils;`, context, {
        filename: 'Utils.js'
    });
    return context.__utils;
}

test('sync export filename follows the track-artist example', () => {
    const utils = loadUtils();
    const creatorSource = fs.readFileSync(
        path.join(__dirname, '..', 'SyncDataCreator.js'),
        'utf8'
    );

    assert.equal(
        `${utils.sanitizeFileName('Raven-kenshi Yonezu', 'sync-track-id')}.json`,
        'Raven-kenshi Yonezu.json'
    );
    assert.match(
        creatorSource,
        /const exportBaseName = \[trackName, artistName\][\s\S]*?\.join\('-'\)/
    );
});

test('sync export filename removes characters rejected by save dialogs', () => {
    const utils = loadUtils();

    assert.equal(
        utils.sanitizeFileName('AC/DC: Live? - Artist|Name'),
        'AC-DC-Live-Artist-Name'
    );
    assert.equal(utils.sanitizeFileName('  ...  ', 'sync-track-id'), 'sync-track-id');
    assert.equal(utils.sanitizeFileName('CON'), '_CON');
});

test('sync export filename truncates by UTF-8 bytes without splitting characters', () => {
    const utils = loadUtils();
    const fileName = utils.sanitizeFileName('가'.repeat(100), 'sync-track-id', 12);

    assert.equal(fileName, '가'.repeat(4));
    assert.ok(Buffer.byteLength(fileName, 'utf8') <= 12);
});
