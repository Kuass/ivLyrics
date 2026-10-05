import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

// Run the actual adapter without provider access. Override only to demonstrate
// the regressions against a saved source revision.
const filename = process.env.IVLYRICS_BING_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_BING_SOURCE_DIR, 'Addon_AI_BingTranslate.js')
    : new URL('../Addon_AI_BingTranslate.js', import.meta.url);
const source = readFileSync(filename, 'utf8');
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const normalize = value => JSON.parse(JSON.stringify(value));
const configHtml = () => `IG:"synthetic-ig" data-iid="synthetic-iid" params_AbusePreventionHelper = [${Date.now()},"synthetic-token",3600000]`;
const translation = text => JSON.stringify([{ translations: [{ text }] }]);

function harness(respond = request => request.method === 'GET' ? configHtml() : translation('translated')) {
    let addon;
    let timerId = 0;
    const timers = new Map();
    const requests = [];
    const bodies = [];
    const window = {
        AIAddonManager: { register(value) { addon = value; } },
        localStorage: { getItem() { return null; }, setItem() {} },
    };
    const fetch = async (url, options) => {
        const request = { url, ...options, index: requests.length };
        requests.push(request);
        const spec = await respond(request);
        if (spec instanceof Error) throw spec;
        const body = { request, started: false, controller: null, done: false };
        const stream = new ReadableStream({
            start(controller) {
                body.controller = controller;
                options.signal.addEventListener('abort', () => {
                    if (!body.done) { body.done = true; controller.error(options.signal.reason); }
                }, { once: true });
                if (spec !== null && typeof spec?.body !== 'function') {
                    controller.enqueue(new TextEncoder().encode(typeof spec === 'string' ? spec : spec.text || ''));
                    controller.close();
                    body.done = true;
                }
            },
        });
        body.finish = text => {
            body.controller.enqueue(new TextEncoder().encode(text));
            body.controller.close();
            body.done = true;
        };
        body.fail = error => { body.controller.error(error); body.done = true; };
        bodies.push(body);
        const response = new Response(stream, { status: spec?.status || 200 });
        const read = response.text.bind(response);
        response.text = () => {
            body.started = true;
            return typeof spec?.body === 'function' ? spec.body() : read();
        };
        return response;
    };
    vm.runInNewContext(source, {
        window, console, fetch, URL, URLSearchParams, AbortController, Uint16Array,
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
    }, { filename: 'Addon_AI_BingTranslate.js' });
    return {
        addon, requests, bodies, timers,
        fire(delay) {
            const found = [...timers].find(([, timer]) => timer.delay === delay);
            assert.ok(found, `expected an active ${delay} ms timer`);
            timers.delete(found[0]); found[1].callback();
        },
        count(delay) { return [...timers.values()].filter(timer => timer.delay === delay).length; },
    };
}

for (const stage of ['configuration', 'translation']) {
    test(`${stage} response keeps its deadline until the body finishes`, async () => {
        const h = harness(request => stage === 'configuration' || request.method === 'POST' ? null : configHtml());
        const pending = h.addon.testConnection();
        // Baseline failures may reject before a retry assertion; observe them too.
        pending.catch(() => {});
        await flush();
        assert.equal(h.bodies.at(-1).started, true);
        assert.equal(h.count(15000), 1, 'headers must not remove the response body timeout');
        h.bodies.at(-1).finish(stage === 'configuration' ? configHtml() : translation('translated'));
        await flush();
        if (stage === 'configuration') h.bodies.at(-1).finish(translation('translated'));
        assert.equal(await pending, true);
        assert.equal(h.timers.size, 0);
    });

    test(`${stage} body timeout aborts the response and recovers on the bounded retry`, async () => {
        let stalled = false;
        const h = harness(request => {
            if (!stalled && (stage === 'configuration' || request.method === 'POST')) { stalled = true; return null; }
            return request.method === 'GET' ? configHtml() : translation('recovered');
        });
        const pending = h.addon.testConnection();
        // Baseline failures may reject before a retry assertion; observe them too.
        pending.catch(() => {});
        await flush();
        const firstBody = h.bodies.at(-1);
        assert.equal(h.count(15000), 1);
        h.fire(15000);
        await flush();
        assert.equal(firstBody.request.signal.aborted, true);
        assert.equal(h.count(15000), 0);
        h.fire(400);
        assert.equal(await pending, true);
        assert.equal(h.requests.filter(request => request.method === 'GET').length, stage === 'configuration' ? 2 : 1);
        assert.equal(h.requests.filter(request => request.method === 'POST').length, stage === 'configuration' ? 1 : 2);
        assert.equal(h.timers.size, 0);
    });

    test(`${stage} body timeouts stop after two attempts with a useful error`, async () => {
        const h = harness(request => stage === 'configuration' || request.method === 'POST' ? null : configHtml());
        const pending = h.addon.testConnection();
        // Baseline failures may reject before a retry assertion; observe them too.
        pending.catch(() => {});
        const rejected = assert.rejects(pending, /\[Bing Translate\] Request timed out/);
        await flush();
        h.fire(15000); await flush(); h.fire(400); await flush(); h.fire(15000);
        await rejected;
        assert.equal(h.timers.size, 0);
        assert.equal(h.requests.length, stage === 'configuration' ? 2 : 3);
    });

    test(`${stage} body transport failure is retryable and clears the old timer`, async () => {
        let failed = false;
        const h = harness(request => {
            if (!failed && (stage === 'configuration' || request.method === 'POST')) { failed = true; return null; }
            return request.method === 'GET' ? configHtml() : translation('recovered');
        });
        const pending = h.addon.testConnection();
        // Baseline failures may reject before a retry assertion; observe them too.
        pending.catch(() => {});
        await flush();
        h.bodies.at(-1).fail(new TypeError('synthetic connection lost'));
        await flush();
        assert.equal(h.count(15000), 0);
        h.fire(400);
        assert.equal(await pending, true);
        assert.equal(h.timers.size, 0);
    });
}

test('successful lyric and metadata paths preserve output, requests, callbacks and cached configuration', async () => {
    const h = harness(request => request.method === 'GET' ? configHtml()
        : translation(new URLSearchParams(request.body).get('text').split('\n').map(line => `T:${line}`).join('\n')));
    const lines = [];
    const result = await h.addon.translateLyrics({ text: 'one\ntwo', lang: 'ko', onLine: (...args) => lines.push(normalize(args)) });
    assert.deepEqual(normalize(result), { translation: ['T:one', 'T:two'] });
    assert.deepEqual(lines, [[0, 'T:one', { provider: 'bing-translate', final: true }], [1, 'T:two', { provider: 'bing-translate', final: true }]]);
    assert.deepEqual(normalize(await h.addon.translateMetadata({ title: 'Title', artist: 'Artist', lang: 'en' })), {
        translated: { title: 'T:Title', artist: 'T:Artist' }, romanized: { title: 'Title', artist: 'Artist' },
    });
    assert.equal(h.requests.filter(request => request.method === 'GET').length, 1);
    assert.equal(h.requests.filter(request => request.method === 'POST').length, 2);
    assert.equal(new URLSearchParams(h.requests[1].body).get('to'), 'ko');
    assert.ok(h.requests[1].url.endsWith('&SFX=1&ref=TThis&edgepdftranslator=1'));
    assert.ok(h.requests[2].url.endsWith('&SFX=2&ref=TThis&edgepdftranslator=1'));
    assert.equal(h.timers.size, 0);
});

test('a connection failure retries once and clears its timer', async () => {
    const h = harness(request => request.index === 0 ? new TypeError('synthetic fetch failure')
        : request.method === 'GET' ? configHtml() : translation('recovered'));
    const pending = h.addon.testConnection();
    // Baseline failures may reject before a retry assertion; observe them too.
    pending.catch(() => {});
    await flush();
    assert.equal(h.count(15000), 0); h.fire(400);
    assert.equal(await pending, true);
    assert.equal(h.timers.size, 0);
});

test('a nonretryable configuration HTTP error stays immediate and does not read its body', async () => {
    const h = harness(() => ({ status: 404, body() { throw new Error('must not read this body'); } }));
    await assert.rejects(h.addon.testConnection(), /Failed to load translator \(404\)/);
    assert.equal(h.bodies[0].started, false);
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
});

for (const [name, payload, pattern] of [
    ['captcha', JSON.stringify({ ShowCaptcha: true }), /requested a captcha/],
    ['invalid shape', JSON.stringify({}), /Invalid translation response format/],
]) {
    test(`${name} stops without a retry and releases all deadlines`, async () => {
        const h = harness(request => request.method === 'GET' ? configHtml() : payload);
        await assert.rejects(h.addon.testConnection(), pattern);
        assert.equal(h.requests.length, 2);
        assert.equal(h.timers.size, 0);
    });
}

test('invalid JSON still retries without unnecessarily refreshing configuration', async () => {
    const h = harness(request => request.method === 'GET' ? configHtml() : request.index === 1 ? '{' : translation('recovered'));
    const pending = h.addon.testConnection();
    // Baseline failures may reject before a retry assertion; observe them too.
    pending.catch(() => {});
    await flush(); h.fire(400);
    assert.equal(await pending, true);
    assert.equal(h.requests.length, 3);
    assert.equal(h.timers.size, 0);
});

test('HTTP 401 still refreshes configuration before retrying', async () => {
    const h = harness(request => request.method === 'GET' ? configHtml()
        : request.index === 1 ? { status: 401, text: '{}' } : translation('recovered'));
    const pending = h.addon.testConnection();
    // Baseline failures may reject before a retry assertion; observe them too.
    pending.catch(() => {});
    await flush(); h.fire(400);
    assert.equal(await pending, true);
    assert.deepEqual(h.requests.map(request => request.method), ['GET', 'POST', 'GET', 'POST']);
    assert.equal(h.timers.size, 0);
});
