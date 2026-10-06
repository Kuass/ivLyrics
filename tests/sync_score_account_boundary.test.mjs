import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(process.env.IVLYRICS_SCORE_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_SCORE_SOURCE_DIR, 'SyncCreatorScoreTracker.js')
    : new URL('../SyncCreatorScoreTracker.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const initial = { version: 5, source: { provider: 'lrclib', lrclibId: 'fixture' }, lines: [] };
const edited = { ...initial, lines: [{ start: 0, end: 1, chars: [0, 0.5] }] };
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

// Actual queue, synthetic identities and controlled storage/request functions.
// No authentication tokens, IndexedDB instance or server calls are involved.
function harness({ save, request, load } = {}) {
    let authorized = true, serial = 0;
    const requests = [], saves = [];
    const window = { crypto: { randomUUID: () => `fixture-event-${++serial}` } };
    vm.runInNewContext(source, { window }, { filename: 'SyncCreatorScoreTracker.js' });
    const tracker = window.SyncCreatorScoreTracker.create({
        accountId: 'fixture-owner', isrc: 'FIXTURE', initialSyncData: initial, setInterval: false,
        now: () => 0, isActive: () => true, isAuthorized: () => authorized,
        storage: {
            getScoreWork: () => load ? load() : null,
            saveScoreWork(scope, state) {
                const snapshot = { scope, state: copy(state) }; saves.push(snapshot);
                return save?.(snapshot.state, saves.length);
            },
        },
        request(payload) {
            const entry = { authorized, payload: copy(payload) }; requests.push(entry);
            return request ? request(payload, requests.length)
                : { success: true, sessionId: 'fixture-session', sequence: payload.sequence };
        },
    });
    return { tracker, requests, saves, authorize(value) { authorized = value; },
        stop() { authorized = false; tracker.stop(); } };
}

for (const action of ['start', 'record']) {
    test(`${action}: account changes during pre-send persistence cannot transmit queued work`, async t => {
        const gate = deferred(); let held = false;
        const h = harness({ save(state, number) {
            if (!held && ((action === 'start' && number === 2) || (action === 'record' && state.queue[0]?.action === 'record'))) {
                held = true; return gate.promise;
            }
        } });
        t.after(() => h.stop());
        if (action === 'record') {
            await h.tracker.flush();
            h.tracker.enqueue('record', edited, { start: 0, end: 1, inputCount: 2 });
        }
        await flush(); assert.equal(held, true);
        const before = copy(h.tracker.__test.getState());
        const pending = h.tracker.flush();
        const rejected = assert.rejects(pending, /account changed/);
        h.authorize(false); gate.resolve(); await rejected;
        assert.ok(h.requests.every(entry => entry.authorized));
        assert.equal(h.requests.length, action === 'start' ? 0 : 1);
        assert.deepEqual(copy(h.tracker.__test.getState().queue), before.queue);
        h.authorize(true); await h.tracker.flush();
        assert.equal(h.requests.at(-1).payload.eventId, before.queue[0].eventId);
        assert.equal(h.requests.at(-1).payload.action, action);
        assert.equal(h.tracker.__test.getState().queue.length, 0);
    });
}

test('a late conflict cannot start a resume request under a different account', async t => {
    const response = deferred();
    const h = harness({ request(payload, number) {
        if (number === 1) return response.promise;
        if (payload.action === 'resume') return { success: true, sessionId: 'fixture-session', sequence: 0,
            syncData: initial, lastEventId: 'unacknowledged', sameSession: true };
        return { success: true, sessionId: 'fixture-session', sequence: payload.sequence };
    } });
    t.after(() => h.stop());
    await flush(); assert.equal(h.requests.length, 1);
    const eventId = h.requests[0].payload.eventId;
    const pending = h.tracker.flush(); const rejected = assert.rejects(pending, /account changed/);
    h.authorize(false); response.reject(Object.assign(new Error('synthetic conflict'), { status: 409 }));
    await rejected;
    assert.equal(h.requests.length, 1, 'resume must not use a different account');
    assert.equal(h.tracker.__test.getState().queue[0].eventId, eventId);
    h.authorize(true); await h.tracker.flush();
    assert.equal(h.requests.at(-1).payload.eventId, eventId);
    assert.equal(h.tracker.__test.getState().queue.length, 0);
});

test('submission cannot return an old-account receipt after an in-flight acknowledgement', async t => {
    const response = deferred();
    const h = harness({ request(payload) {
        if (payload.action === 'checkpoint') return response.promise;
        return { success: true, sessionId: 'fixture-session', sequence: payload.sequence };
    } });
    t.after(() => h.stop());
    await h.tracker.flush();
    const pending = h.tracker.submission(edited); const rejected = assert.rejects(pending, /account changed/);
    await flush(); assert.equal(h.requests.at(-1).payload.action, 'checkpoint');
    h.authorize(false); response.resolve({ success: true, sessionId: 'fixture-session', sequence: 1 });
    await rejected;
    assert.ok(h.requests.every(entry => entry.authorized));
    assert.equal(h.tracker.__test.getState().queue.length, 0, 'keep the valid old-account acknowledgement to avoid replay');
    assert.equal(h.tracker.__test.getState().sequence, 1);
});

test('submission rechecks identity after the acknowledged receipt is persisted', async t => {
    const gate = deferred(); let held = false;
    const h = harness({ save(state) {
        if (!held && state.sequence === 1 && state.queue.length === 0) { held = true; return gate.promise; }
    } });
    t.after(() => h.stop());
    await h.tracker.flush();
    const pending = h.tracker.submission(edited); const rejected = assert.rejects(pending, /account changed/);
    await flush(); assert.equal(held, true);
    h.authorize(false); gate.resolve(); await rejected;
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every(entry => entry.authorized));
    assert.equal(h.tracker.__test.getState().queue.length, 0);
});

test('authorized submissions retain FIFO event IDs, sequences, snapshots and receipt shape', async t => {
    const h = harness(); t.after(() => h.stop());
    h.tracker.enqueue('record', edited, { start: 0, end: 1, inputCount: 2 });
    const receipt = await h.tracker.submission(edited);
    assert.deepEqual(h.requests.map(entry => entry.payload.action), ['start', 'record', 'checkpoint']);
    assert.deepEqual(h.requests.map(entry => entry.payload.sequence), [0, 1, 2]);
    assert.equal(new Set(h.requests.map(entry => entry.payload.eventId)).size, 3);
    assert.deepEqual(h.requests[1].payload.syncData, edited);
    assert.deepEqual(copy(receipt), { workSessionId: 'fixture-session', workSequence: 2 });
});

test('authorized conflict recovery still resumes and retries the same event', async t => {
    const h = harness({ request(payload, number) {
        if (number === 1) throw Object.assign(new Error('synthetic conflict'), { status: 409 });
        if (payload.action === 'resume') return { success: true, sessionId: 'fixture-session', sequence: 0,
            syncData: initial, lastEventId: 'unacknowledged', sameSession: true };
        return { success: true, sessionId: 'fixture-session', sequence: payload.sequence };
    } });
    t.after(() => h.stop());
    await h.tracker.flush();
    assert.deepEqual(h.requests.map(entry => entry.payload.action), ['start', 'resume', 'start']);
    assert.equal(h.requests[0].payload.eventId, h.requests[2].payload.eventId);
    assert.equal(h.tracker.__test.getState().queue.length, 0);
});

test('identity lost while opening storage already stays blocked without requests', async t => {
    const opening = deferred(); const h = harness({ load: () => opening.promise }); t.after(() => h.stop());
    h.authorize(false); const pending = h.tracker.flush();
    const rejected = assert.rejects(pending, /account changed/);
    opening.resolve(null); await rejected;
    assert.equal(h.requests.length, 0);
    assert.equal(h.tracker.__test.getState().queue[0].action, 'start');
});

test('persistence failure still prevents transmission and preserves the pending event', async t => {
    const h = harness({ save() { return Promise.reject(new Error('synthetic storage failure')); } }); t.after(() => h.stop());
    await assert.rejects(h.tracker.flush(), /synthetic storage failure/);
    assert.equal(h.requests.length, 0);
    assert.equal(h.tracker.__test.getState().queue[0].action, 'start');
});

test('returning to the owning account before persistence finishes permits the original event', async t => {
    const gate = deferred(); let held = false;
    const h = harness({ save(_state, number) { if (number === 2) { held = true; return gate.promise; } } }); t.after(() => h.stop());
    await flush(); assert.equal(held, true);
    const pending = h.tracker.flush();
    h.authorize(false); h.authorize(true); gate.resolve(); await pending;
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].authorized, true);
    assert.equal(h.tracker.__test.getState().queue.length, 0);
});
