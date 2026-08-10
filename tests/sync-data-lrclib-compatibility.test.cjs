const assert = require('node:assert/strict');
const test = require('node:test');

const { SyncDataSourceCompatibility } = require('../LyricsService.js');

const source = {
    provider: 'lrclib',
    lrclibId: '36819514'
};

test('allows a changed LRCLIB fingerprint only for the same source ID and exact line shape', () => {
    assert.equal(SyncDataSourceCompatibility.canApplyLrclibFingerprintFallback({
        syncSource: source,
        currentProvider: 'lrclib',
        currentLrclibId: 36819514,
        hasExactLineShape: true
    }), true);
});

test('rejects the compatibility fallback when the current LRCLIB ID differs', () => {
    assert.equal(SyncDataSourceCompatibility.canApplyLrclibFingerprintFallback({
        syncSource: source,
        currentProvider: 'lrclib',
        currentLrclibId: '99999999',
        hasExactLineShape: true
    }), false);
});

test('rejects the compatibility fallback when the line shape differs', () => {
    assert.equal(SyncDataSourceCompatibility.canApplyLrclibFingerprintFallback({
        syncSource: source,
        currentProvider: 'lrclib',
        currentLrclibId: '36819514',
        hasExactLineShape: false
    }), false);
});

test('rejects non-LRCLIB provider results even if the ID and line shape match', () => {
    assert.equal(SyncDataSourceCompatibility.canApplyLrclibFingerprintFallback({
        syncSource: source,
        currentProvider: 'spotify',
        currentLrclibId: '36819514',
        hasExactLineShape: true
    }), false);
});
