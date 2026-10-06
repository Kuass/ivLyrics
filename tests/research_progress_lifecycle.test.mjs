import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the complete production manager with synthetic addons, never live
// providers. The override also runs these regressions against an unchanged base.
const source = readFileSync(process.env.IVLYRICS_RESEARCH_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_RESEARCH_SOURCE_DIR, 'AIAddonManager.js')
    : new URL('../AIAddonManager.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const normalize = value => JSON.parse(JSON.stringify(value));
const document = text => ({ editorial_thesis: { one_sentence: text } });
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

async function harness(methods = ['generateResearch', 'generateTMI']) {
    const timers = new Map();
    const storage = new Map();
    const calls = [];
    const events = [];
    let timerId = 0;
    const window = {};
    vm.runInNewContext(source, {
        window,
        Spicetify: { LocalStorage: { get: key => storage.get(key), set: (key, value) => storage.set(key, value) } },
        console: { log() {}, warn() {}, error() {} },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
    }, { filename: 'AIAddonManager.js' });
    const manager = window.AIAddonManager;
    await manager._initPromise;
    for (const [index, method] of methods.entries()) {
        const addon = {
            id: `custom-${index}`, name: `Custom ${index}`, author: 'fixture', description: 'fixture', version: '1.0',
            supports: { research: true, tmi: true },
            getSettingsUI() {},
            [method](params) {
                assert.equal(this, addon, 'keep custom addon method binding');
                const pending = deferred();
                calls.push({ ...pending, params, id: addon.id });
                return pending.promise;
            },
        };
        assert.equal(manager.register(addon), true);
        manager.setProviderEnabled(addon.id, true);
    }
    manager.setProviderOrder(methods.map((_, index) => `custom-${index}`));
    for (const name of ['start', 'success', 'error']) {
        manager.on(`ai:request:${name}`, detail => events.push([name, normalize(detail)]));
    }
    return {
        manager, calls, events, timers,
        start(onProgress, extra = {}, method = 'generateResearch') {
            return manager[method]({ title: 'Fixture song', artist: 'Fixture artist', lang: 'en', onProgress, ...extra });
        },
        timeout() {
            const next = [...timers].find(([, timer]) => timer.delay === 600_000);
            assert.ok(next, 'the active research call must own a deadline');
            timers.delete(next[0]); next[1].callback();
        },
    };
}
const collect = progress => (partial, details) => progress.push(normalize({ partial, details }));
const sendLate = call => {
    call.params.onResearchProgress(document('stale draft'));
    call.params.onResearchProgress(null, { reset: true });
    call.params.onResearchProgress(document('stale final'), { complete: true });
};

for (const method of ['generateResearch', 'generateTMI']) {
    for (const failure of ['reject', 'timeout']) {
        test(`${method}: ${failure} closes old progress before the next provider starts`, async () => {
            const h = await harness([method, method]);
            const progress = [];
            const pending = h.start(collect(progress));
            await flush();
            const first = h.calls[0];
            first.params.onResearchProgress(document('first draft'));
            assert.equal(progress.at(-1).partial._research.provider, first.id);
            if (failure === 'reject') first.reject(new Error('synthetic provider failure'));
            else h.timeout();
            await flush();
            assert.equal(h.calls.length, 2);
            const second = h.calls[1];
            second.params.onResearchProgress(document('replacement draft'));
            const before = normalize(progress);
            sendLate(first);
            assert.deepEqual(progress, before, 'retired progress must not overwrite or reset the replacement');
            first.resolve(document('late result'));
            await flush();
            assert.deepEqual(progress, before);
            second.resolve(document('replacement final'));
            const result = await pending;
            assert.equal(result.editorial_thesis.one_sentence, 'replacement final');
            assert.equal(result._research.provider, second.id);
            assert.equal(progress.at(-1).details.complete, true);
            assert.deepEqual(h.events.map(([name]) => name), ['start', 'success']);
            assert.equal(h.timers.size, 0);
        });
    }

    test(`${method}: web-search retry isolates the two attempts of the same provider`, async () => {
        const h = await harness([method]);
        const progress = [];
        const extensionData = { preserve: true };
        const pending = h.start(collect(progress), { extensionData });
        await flush();
        const first = h.calls[0];
        first.reject(Object.assign(new Error('synthetic search failure'), { code: 'RESEARCH_WEB_SEARCH_FAILED' }));
        await flush();
        assert.equal(h.calls.length, 2);
        const retry = h.calls[1];
        assert.equal(first.params.webSearch, true);
        assert.equal(retry.params.webSearch, false);
        assert.equal(retry.params.requestTimeoutMs, 480_000);
        assert.equal(retry.params.researchPrompt, first.params.researchPrompt);
        assert.equal(retry.params.tmiPrompt, retry.params.researchPrompt);
        assert.equal(retry.params.extensionData, extensionData);
        retry.params.onResearchProgress(document('fallback draft'));
        assert.equal(progress.at(-1).partial._research.web_search, 'fallback');
        const before = normalize(progress);
        sendLate(first);
        assert.deepEqual(progress, before);
        retry.resolve(document('fallback final'));
        const result = await pending;
        assert.equal(result._research.web_search, 'fallback');
        assert.equal(progress.at(-1).details.complete, true);
        assert.equal(progress.at(-1).details.webSearchStatus, 'fallback');
        assert.equal(h.timers.size, 0);
    });

    test(`${method}: successful completion retires the provider callback`, async () => {
        const h = await harness([method]);
        const progress = [];
        const pending = h.start(collect(progress), {}, 'generateTMI');
        await flush();
        const call = h.calls[0];
        call.params.onResearchProgress(document('active draft'), { step: 1 });
        assert.equal(progress.at(-1).partial._research.streaming, true);
        assert.equal(progress.at(-1).details.step, 1);
        call.resolve(document('accepted final'));
        const result = await pending;
        assert.equal(result.editorial_thesis.one_sentence, 'accepted final');
        assert.equal(result._research.streaming, false);
        const before = normalize(progress);
        sendLate(call);
        assert.deepEqual(progress, before, 'late callbacks must not turn a completed article back into a draft');
        assert.equal(h.timers.size, 0);
    });
}

test('all-provider failure retires every callback and emits only one terminal error', async () => {
    const h = await harness();
    const progress = [];
    const pending = h.start(collect(progress));
    const rejected = assert.rejects(pending, /last failure/);
    await flush();
    h.calls[0].reject(new Error('first failure'));
    await flush();
    h.calls[1].reject(new Error('last failure'));
    await rejected;
    assert.equal(progress.at(-1).details.error, 'last failure');
    const before = normalize(progress);
    h.calls.forEach(sendLate);
    assert.deepEqual(progress, before);
    assert.deepEqual(h.events.map(([name]) => name), ['start', 'error']);
    assert.equal(h.timers.size, 0);
});

test('concurrent research requests keep independent progress lifetimes', async () => {
    const h = await harness(['generateResearch']);
    const firstProgress = [];
    const secondProgress = [];
    const first = h.start(collect(firstProgress), { title: 'First song' });
    const second = h.start(collect(secondProgress), { title: 'Second song' });
    await flush();
    h.calls[0].resolve(document('first final'));
    await first;
    const completed = normalize(firstProgress);
    sendLate(h.calls[0]);
    assert.deepEqual(firstProgress, completed);
    h.calls[1].params.onResearchProgress(document('still active'));
    assert.equal(secondProgress.at(-1).partial.editorial_thesis.one_sentence, 'still active');
    h.calls[1].resolve(document('second final'));
    assert.equal((await second).metadata.title, 'Second song');
    assert.equal(h.timers.size, 0);
});

test('synchronous progress and a synchronous result retain their ordering', async () => {
    const h = await harness(['generateResearch']);
    const progress = [];
    h.manager.getAddon('custom-0').generateResearch = params => {
        params.onResearchProgress(document('synchronous draft'));
        return document('synchronous final');
    };
    const result = await h.start(collect(progress));
    assert.equal(result.editorial_thesis.one_sentence, 'synchronous final');
    assert.equal(progress.length, 3);
    assert.equal(progress[0].details.reset, true);
    assert.equal(progress[1].partial.editorial_thesis.one_sentence, 'synchronous draft');
    assert.equal(progress[2].details.complete, true);
    assert.equal(h.timers.size, 0);
});

test('a throwing UI progress callback does not fail the provider or trigger fallback', async () => {
    const h = await harness();
    const pending = h.start(() => { throw new Error('synthetic UI failure'); });
    await flush();
    assert.doesNotThrow(() => h.calls[0].params.onResearchProgress(document('active draft')));
    h.calls[0].resolve(document('accepted final'));
    assert.equal((await pending).editorial_thesis.one_sentence, 'accepted final');
    assert.equal(h.calls.length, 1);
    assert.equal(h.timers.size, 0);
});

for (const message of ['MAX_TOKENS', 'synthetic generation failure']) {
    test(`${message} preserves next-provider fallback without a search retry`, async () => {
        const h = await harness();
        const progress = [];
        const pending = h.start(collect(progress));
        await flush();
        h.calls[0].reject(new Error(message));
        await flush();
        assert.deepEqual(h.calls.map(call => call.id), ['custom-0', 'custom-1']);
        assert.ok(h.calls.every(call => call.params.webSearch === true));
        h.calls[1].resolve(document('accepted final'));
        assert.equal((await pending)._research.web_search, 'used');
        assert.equal(h.timers.size, 0);
    });
}
