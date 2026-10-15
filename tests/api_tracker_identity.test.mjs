import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../LyricsService.js', import.meta.url), 'utf8');
const sections = [...source.matchAll(/    const ApiTracker = \{[\s\S]*?\n    \};/g)];
assert.equal(sections.length, 1, 'Extract the actual complete tracker exactly once');
assert.match(source.slice(sections[0].index + sections[0][0].length),
    /^\n\n    \/\/ 전역 접근 가능하도록 window에 등록\n    window\.ApiTracker = ApiTracker;/);

// Only the complete tracker object runs: no surrounding providers or module setup.
// Time stays fixed throughout each operation, including all its Date.now reads.
function fixture() {
    let now = 1000;
    const tracker = vm.runInNewContext(`${sections[0][0]}\nApiTracker;`, {
        Date: { now: () => now },
        Math: { random: () => 0.25 }
    }, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
    return { tracker, at: time => { now = time; } };
}
const plain = value => JSON.parse(JSON.stringify(value));
const endpoints = tracker => Array.from(tracker.getLogs(), row => row.endpoint);

for (const kinds of ['request/request', 'request/cache', 'cache/cache']) {
    test(`same-time/random ${kinds} allocations have distinct IDs`, () => {
        const { tracker: t } = fixture();
        for (const [i, kind] of kinds.split('/').entries()) {
            if (kind === 'request') t.logRequest('video', `row-${i}`);
            else assert.equal(t.logCacheHit('video', `row-${i}`, {}), undefined);
        }
        const [first, second] = t.getLogs();
        assert.notEqual(first.id, second.id);
    });
}

test('request completion owns its original row when a newer request shares the clock', () => {
    const { tracker: t, at } = fixture();
    const request = { label: 'A-request' }, response = { label: 'A-response' };
    const id = t.logRequest('video', 'A', request);
    t.logRequest('lyrics', 'B');
    at(1100);
    assert.equal(t.logResponse(id, response), undefined);
    const [a, b] = t.getLogs();
    assert.equal(a.response, response);
    assert.equal(a.request, request);
    assert.equal(a.status, 'success');
    assert.equal(a.duration, 100);
    assert.equal(b.response, null);
    assert.equal(b.status, 'pending');
    assert.deepEqual(endpoints(t), ['A', 'B']);
});

test('request completion leaves the newer cache row and its data intact', () => {
    const { tracker: t, at } = fixture();
    const id = t.logRequest('video', 'A'), cached = { label: 'cache' };
    t.logCacheHit('lyrics', 'B', cached);
    const before = plain(t.getLogs()[1]), response = { label: 'failure' };
    at(1150);
    t.logResponse(id, response, 'error', 'failed', false);
    const [a, b] = t.getLogs();
    assert.equal(a.response, response);
    assert.equal(a.status, 'error');
    assert.equal(a.error, 'failed');
    assert.equal(a.duration, 150);
    assert.equal(b.response, cached);
    assert.deepEqual(plain(b), before);
});

// Direct public-method controls, not an observed UI lifecycle or cancellation test.
for (const reset of ['clear', 'changed track']) {
    test(`a stale completion after direct ${reset} cannot own the replacement row`, () => {
        const { tracker: t, at } = fixture();
        const oldId = t.logRequest('video', 'old');
        let notifications = 0;
        t.addListener(() => notifications++);
        if (reset === 'clear') assert.equal(t.clear(), undefined);
        else assert.equal(t.setCurrentTrack('new-track'), undefined);
        assert.equal(t.getLogs().length, 0);
        assert.equal(notifications, 1);
        t.logCacheHit('video', 'replacement', { label: 'kept' });
        const before = plain(t.getLogs());
        if (reset === 'changed track') {
            const row = t.getLogs()[0];
            t.setCurrentTrack('new-track');
            assert.equal(t.getLogs()[0], row);
            assert.equal(notifications, 2);
        }
        at(1200);
        t.logResponse(oldId, { label: 'stale' });
        assert.deepEqual(plain(t.getLogs()), before);
        assert.equal(notifications, 2);
        assert.notEqual(t.getLogs()[0].id, oldId);
    });
}

test('shared request/cache sequence survives direct clear, changed track and FIFO eviction', () => {
    const { tracker: t } = fixture();
    assert.equal(t.logRequest('video', 'first'), 1);
    t.logCacheHit('video', 'second', {});
    assert.equal(t.getLogs()[1].id, 2);
    t.clear();
    assert.equal(t.logRequest('video', 'third'), 3);
    t.setCurrentTrack('next');
    for (let i = 4; i <= 104; i++) t.logCacheHit('video', `cache-${i}`, {});
    assert.equal(t.getLogs().length, 100);
    assert.equal(t.getLogs()[0].id, 5);
    assert.equal(t.logRequest('video', 'last'), 105);
    assert.equal(t.getLogs()[0].id, 6);
});

test('FIFO retains exactly 100 rows; retained responses work and evicted/unmatched responses stay silent', () => {
    const { tracker: t, at } = fixture();
    const ids = new Map();
    for (let i = 0; i < 103; i++) {
        at(2000 + i);
        const label = `F${String(i).padStart(3, '0')}`;
        if (i % 2 === 0) ids.set(i, t.logRequest('video', label));
        else t.logCacheHit('video', label, { label });
    }
    const expected = Array.from({ length: 100 }, (_, n) => {
        const i = n + 3, label = `F${String(i).padStart(3, '0')}`;
        return i % 2 ? `[CACHE] ${label}` : label;
    });
    assert.deepEqual(endpoints(t), expected);
    let notifications = 0;
    t.addListener(() => notifications++);
    const before = plain(t.getLogs());
    at(2300);
    t.logResponse(ids.get(0), { label: 'evicted' });
    t.logResponse(-1, { label: 'unmatched' });
    assert.deepEqual(plain(t.getLogs()), before);
    assert.equal(notifications, 0);
    for (const i of [4, 102]) {
        const response = { label: `completed-${i}` };
        t.logResponse(ids.get(i), response);
        const row = t.getLogs().find(row => row.endpoint === `F${String(i).padStart(3, '0')}`);
        assert.equal(row.response, response);
        assert.equal(row.duration, 2300 - (2000 + i));
    }
    assert.equal(notifications, 2);
    assert.deepEqual(plain(t.getSummary()), {
        total: 100, pending: 48, success: 2, error: 0, cached: 50,
        byCategory: { video: { total: 100, success: 2, error: 0, cached: 50 } }
    });
});

test('an evicted same-time request cannot complete a newer retained row', () => {
    const { tracker: t, at } = fixture();
    const evicted = t.logRequest('video', 'evicted');
    for (let i = 0; i < 100; i++) t.logCacheHit('video', `kept-${i}`, { i });
    const before = plain(t.getLogs());
    let notifications = 0;
    t.addListener(() => notifications++);
    at(1300);
    t.logResponse(evicted, { label: 'stale-evicted' });
    assert.deepEqual(plain(t.getLogs()), before);
    assert.equal(notifications, 0);
});

test('ordinary defaults, statuses, summaries and timestamp expressions retain fixed-operation behavior', () => {
    const { tracker: t, at } = fixture();
    at(3000); const success = t.logRequest('video', 'success');
    at(3100); t.logResponse(success, { value: 1 });
    at(3200); const failure = t.logRequest('video', 'failure', { query: 2 });
    at(3300); t.logResponse(failure, null, 'error', 'failed');
    at(3400); const cached = t.logRequest('lyrics', 'cached-response');
    at(3490); t.logResponse(cached, { value: 3 }, 'success', null, true);
    at(3500); t.logCacheHit('video', 'one', { value: 4 });
    at(3600); t.logCacheHit('lyrics', 'two', { value: 5 });
    const rows = t.getLogs();
    assert.deepEqual(Array.from(rows, row => [row.startTime, row.endTime, row.duration]),
        [[3000, 3100, 100], [3200, 3300, 100], [3400, 3490, 90], [3500, 3500, 0], [3600, 3600, 0]]);
    assert.equal(rows[0].request, null);
    assert.equal(rows[0].error, null);
    assert.equal(rows[0].cached, false);
    assert.equal(rows[1].error, 'failed');
    assert.deepEqual(plain(t.getSummary()), {
        total: 5, pending: 0, success: 2, error: 1, cached: 3,
        byCategory: {
            video: { total: 3, success: 1, error: 1, cached: 1 },
            lyrics: { total: 2, success: 1, error: 0, cached: 2 }
        }
    });
    const filtered = t.getLogsByCategory('video');
    assert.notEqual(filtered, rows);
    assert.equal(filtered[0], rows[0]);
    assert.deepEqual(Array.from(filtered, row => row.endpoint), ['success', 'failure', '[CACHE] one']);
    rows.length = 0;
    filtered.length = 0;
    assert.equal(t.getLogs().length, 5);
    assert.deepEqual(Array.from(t.getLogsByCategory('missing')), []);
});

test('listeners preserve order, swallow errors, expose the current array and unsubscribe', () => {
    const { tracker: t } = fixture(), order = [], received = [];
    let notifiedRows;
    const unsubscribe = t.addListener(rows => { order.push('first'); notifiedRows = rows; });
    const stopThrowing = t.addListener(() => { order.push('throw'); throw new Error('fixture'); });
    t.addListener(rows => { order.push('last'); received.push(rows); });
    t.logRequest('video', 'A');
    assert.deepEqual(order, ['first', 'throw', 'last']);
    assert.equal(notifiedRows, t._logs);
    assert.equal(received[0], notifiedRows);
    assert.notEqual(t.getLogs(), notifiedRows);
    assert.equal(t.getLogs()[0], notifiedRows[0]);
    unsubscribe(); stopThrowing();
    order.length = 0;
    t.logRequest('video', 'B');
    assert.deepEqual(order, ['last']);
    assert.equal(received[1], notifiedRows);
});

test('one bounded synchronous listener reentry preserves the original request return', () => {
    const { tracker: t, at } = fixture(), order = [];
    let entered = false, innerId;
    t.addListener(rows => {
        order.push(`first:${rows.at(-1).endpoint}`);
        if (!entered) {
            entered = true;
            at(1001);
            innerId = t.logRequest('video', 'inner');
        }
    });
    t.addListener(rows => order.push(`second:${rows.at(-1).endpoint}`));
    const outerId = t.logRequest('video', 'outer');
    const [outer, inner] = t.getLogs();
    assert.equal(outerId, outer.id);
    assert.equal(innerId, inner.id);
    assert.notEqual(outerId, innerId);
    assert.deepEqual(order, ['first:outer', 'first:inner', 'second:inner', 'second:inner']);
});
