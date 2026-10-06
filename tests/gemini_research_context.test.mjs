import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const assessmentRoot = fileURLToPath(new URL('../', import.meta.url));
const root = process.env.IVLYRICS_SOURCE_ROOT || assessmentRoot;
const source = readFileSync(resolve(root, 'Addon_AI_Gemini.js'), 'utf8');
const A = 'https://fixture-a.invalid/v1beta';
const B = 'https://fixture-b.invalid/v1beta';
const FLASH = 'gemini-2.5-flash';
const LITE = 'gemini-3.1-flash-lite';
const OTHER = 'gemini-2.0-flash';
const normalize = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const catalog = entries => ({ models: entries.map(([id, outputTokenLimit]) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'], outputTokenLimit })) });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const defaultDocument = { metadata: { title: 'Inert fixture song' }, fixture: true };

function sseResponse(document = defaultDocument, finishReason = 'STOP') {
    const payloads = [
        { candidates: [{ content: { parts: [{ text: JSON.stringify(document) }] } }] },
        { candidates: [{ finishReason, content: { parts: [] } }] }
    ];
    const chunks = payloads.map(payload => new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
    let index = 0;
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true } }) } };
}
function errorResponse(message, status = 400) {
    return { ok: false, status, json: async () => ({ error: { message } }) };
}

function harness(initial = {}, postHandler = () => sseResponse()) {
    const settings = new Map(Object.entries({
        'api-keys': ['synthetic-A1', 'synthetic-A2'],
        'base-url': A,
        model: FLASH,
        'adv-maxOutputTokens-enabled': true,
        'adv-maxOutputTokens-value': 4096,
        'adv-thinking-enabled': false,
        'adv-thinking-budget': 1024,
        ...initial
    }));
    const requests = [], timerCalls = [], progress = [];
    let addon;
    const fakeFetch = (url, options = {}, timeoutMs) => {
        // The complete provider source executes, but every network boundary is inert.
        if (options.method === 'POST') {
            const request = { kind: 'stream', url, body: JSON.parse(options.body), timeoutMs };
            requests.push(request);
            return Promise.resolve(postHandler(request, requests.filter(r => r.kind === 'stream').length));
        }
        assert.match(url, /^https:\/\/fixture-[ab]\.invalid\/v1beta\/models\?key=/);
        const response = deferred(), body = deferred();
        const request = { kind: 'models', url, response, body };
        requests.push(request);
        return response.promise;
    };
    const window = { ivLyricsFetch: fakeFetch, AIAddonManager: {
        register(value) { addon = value; },
        getAddonSetting(_id, key, fallback) { return settings.get(key) ?? fallback; },
        setAddonSetting(_id, key, value) { settings.set(key, value); },
        getProviderRequestAttempts() { return 2; },
        createResearchStreamProgressParser(callback) { return { push(chunk) { callback({ raw: chunk }); } }; }
    } };
    vm.runInNewContext(source, {
        window, TextDecoder, TextEncoder,
        console: { log() {}, warn() {}, error() {} },
        setTimeout(callback, delay) { timerCalls.push(delay); queueMicrotask(callback); return timerCalls.length; }
    }, { filename: 'complete-Addon_AI_Gemini.js' });
    const research = extra => addon.generateTMI({ title: 'Inert fixture song', artist: 'Inert fixture artist', tmiPrompt: { systemPrompt: 'Fixture system', userPrompt: 'Fixture user' }, webSearch: false, requestTimeoutMs: 4567, onResearchProgress: (...args) => progress.push(normalize(args)), ...extra });
    const models = () => requests.filter(r => r.kind === 'models');
    const streams = () => requests.filter(r => r.kind === 'stream');
    const respondHeaders = index => models()[index].response.resolve({ ok: true, status: 200, json: () => models()[index].body.promise });
    const respondBody = (index, entries) => models()[index].body.resolve(catalog(entries));
    const respond = (index, entries) => { respondHeaders(index); respondBody(index, entries); };
    return { addon, settings, requests, research, models, streams, respondHeaders, respondBody, respond, progress, timerCalls };
}
const lastStream = h => h.streams().at(-1);
const endpointAndModel = request => { const url = new URL(request.url); const [, model] = url.pathname.match(/\/models\/(.+):streamGenerateContent$/); return { endpoint: `${url.origin}${url.pathname.split('/models/')[0]}`, model }; };

const change = h => {
    h.settings.set('base-url', B);
    h.settings.set('model', LITE);
    h.settings.set('api-keys', ['synthetic-B1']);
    h.settings.set('adv-thinking-enabled', true);
    h.settings.set('adv-maxOutputTokens-value', 64000);
};
const assertOriginal = (request, limit = 65536) => {
    assert.deepEqual(endpointAndModel(request), { endpoint: A, model: FLASH });
    assert.match(new URL(request.url).searchParams.get('key'), /^synthetic-A[12]$/);
    assert.equal(request.body.generationConfig.maxOutputTokens, limit);
    assert.deepEqual(request.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
};

for (const phase of ['headers', 'body']) {
    test(`research retains one context when settings change before metadata ${phase}`, async () => {
        const h = harness(), pending = h.research();
        if (phase === 'body') { h.respondHeaders(0); await flush(); }
        change(h);
        h.respond(0, [[FLASH, 65536], [LITE, 1024]]);
        assert.equal((await pending).fixture, true);
        assertOriginal(lastStream(h));
        assert.equal(new URL(h.models()[0].url).searchParams.get('key'), 'synthetic-A1');
    });
}
for (const field of ['base-url', 'model', 'api-keys']) {
    test(`an isolated ${field} edit during metadata cannot split the accepted context`, async () => {
        const h = harness(), pending = h.research();
        h.settings.set(field, { 'base-url': B, model: LITE, 'api-keys': ['synthetic-B1'] }[field]);
        h.respond(0, [[FLASH, 65536], [LITE, 1024]]); await pending;
        assertOriginal(lastStream(h));
    });
}
test('a cache-hit await retains the same context after synchronous settings edits', async () => {
    const h = harness(), warm = h.research(); h.respond(0, [[FLASH, 65536]]); await warm;
    const pending = h.research(); change(h); await pending;
    assert.equal(h.models().length, 1); assertOriginal(lastStream(h));
});
test('the next research invocation uses the new endpoint, keys, model and thinking fields', async () => {
    const h = harness(), first = h.research(); change(h); h.respond(0, [[FLASH, 65536]]); await first;
    const next = h.research(); assert.equal(h.models().length, 2);
    h.respond(1, [[LITE, 1024]]); await next;
    const request = lastStream(h);
    assert.deepEqual(endpointAndModel(request), { endpoint: B, model: LITE });
    assert.equal(new URL(request.url).searchParams.get('key'), 'synthetic-B1');
    assert.equal(request.body.generationConfig.maxOutputTokens, 1024);
    assert.deepEqual(request.body.generationConfig.thinkingConfig, { thinkingLevel: 'high' });
});
for (const status of [403, 429]) {
    test(`research ${status} key fallback retains the pre-metadata context`, async () => {
        const h = harness({}, (_request, index) => index === 1 ? errorResponse('Inert quota failure', status) : sseResponse());
        const pending = h.research(); change(h); h.respond(0, [[FLASH, 65536]]); await pending;
        assert.equal(h.streams().length, 2); h.streams().forEach(request => assertOriginal(request));
        assert.deepEqual(h.streams().map(request => new URL(request.url).searchParams.get('key')), ['synthetic-A1', 'synthetic-A2']);
        assert.equal(h.timerCalls.length, 0);
    });
}
test('post-dispatch settings edits preserve the same research key fallback', async () => {
    const first = deferred(), h = harness({}, (_request, index) => index === 1 ? first.promise : sseResponse());
    const pending = h.research(); h.respond(0, [[FLASH, 65536]]); await flush(); change(h);
    first.resolve(errorResponse('Inert quota failure', 429)); await pending;
    h.streams().forEach(request => assertOriginal(request));
});
for (const kind of ['missing', 'failed']) {
    test(`${kind} metadata retains the configured/default fallback and original model`, async () => {
        const h = harness(), pending = h.research(); change(h);
        if (kind === 'missing') h.respond(0, []);
        else h.models()[0].response.reject(new Error('Inert metadata failure'));
        await pending; assertOriginal(lastStream(h), 32768);
    });
}
for (const configured of [4096, 64000]) {
    test(`unchanged missing metadata preserves fallback policy (${configured})`, async () => {
        const h = harness({ 'adv-maxOutputTokens-value': configured }), pending = h.research();
        h.respond(0, []); await pending;
        assert.equal(lastStream(h).body.generationConfig.maxOutputTokens, Math.max(configured, 32768));
    });
}
test('ordinary research preserves real SSE parsing, progress, prompt, timeout and web search', async () => {
    const h = harness(), pending = h.research({ webSearch: true }); h.respond(0, [[FLASH, 65536]]);
    assert.equal((await pending).metadata.title, 'Inert fixture song');
    const request = lastStream(h); assertOriginal(request);
    assert.deepEqual(request.body.tools, [{ google_search: {} }]);
    assert.deepEqual(request.body.systemInstruction, { parts: [{ text: 'Fixture system' }] });
    assert.equal(request.body.contents[0].parts[0].text, 'Fixture user');
    assert.equal(request.timeoutMs, 4567);
    assert.ok(h.progress.some(([partial]) => partial?.raw?.includes('Inert fixture song')));
});
test('unchanged warm calls reuse metadata and omit disabled web search', async () => {
    const h = harness(), first = h.research(); h.respond(0, [[FLASH, 65536]]); await first; await h.research();
    assert.equal(h.models().length, 1); assertOriginal(lastStream(h)); assert.equal(lastStream(h).body.tools, undefined);
});
test('missing key still takes precedence over a missing model without dispatch', async () => {
    const h = harness({ 'api-keys': [], model: '' });
    await assert.rejects(h.research(), /API key is required/);
    assert.equal(h.requests.length, 0);
});
for (const field of ['api-keys', 'model']) {
    test(`missing initial ${field} is still validated after metadata preparation`, async () => {
        const h = harness({ [field]: field === 'api-keys' ? [] : '' });
        const pending = h.research(), rejection = assert.rejects(pending, field === 'api-keys' ? /API key is required/ : /Model is not selected/);
        assert.equal(h.models().length, field === 'api-keys' ? 0 : 1); assert.equal(h.streams().length, 0);
        if (field === 'model') h.respond(0, []);
        await rejection; assert.equal(h.streams().length, 0);
    });
    test(`filling an initially missing ${field} does not change the accepted call`, async () => {
        const h = harness({ [field]: field === 'api-keys' ? [] : '' });
        const pending = h.research(), rejection = assert.rejects(pending, field === 'api-keys' ? /API key is required/ : /Model is not selected/);
        h.settings.set(field, field === 'api-keys' ? ['synthetic-B1'] : LITE);
        if (field === 'model') h.respond(0, [[LITE, 1024]]);
        await rejection; assert.equal(h.streams().length, 0);
    });
    test(`clearing ${field} after admission affects the next call`, async () => {
        const h = harness(), pending = h.research(); h.settings.set(field, field === 'api-keys' ? [] : '');
        h.respond(0, [[FLASH, 65536]]); await pending; assertOriginal(lastStream(h));
        const next = h.research(), rejection = assert.rejects(next, field === 'api-keys' ? /API key is required/ : /Model is not selected/);
        if (h.models().length > 1) h.respond(1, []);
        await rejection; assert.equal(h.streams().length, 1);
    });
}
for (const field of ['title', 'artist', 'tmiPrompt']) {
    test(`missing ${field} still fails before metadata or stream work`, async () => {
        const h = harness(); await assert.rejects(h.research({ [field]: '' })); assert.equal(h.requests.length, 0);
    });
}
test('MAX_TOKENS still resets progress and remains outside web-search error marking', async () => {
    const h = harness({}, () => sseResponse(defaultDocument, 'MAX_TOKENS'));
    const pending = h.research({ webSearch: true }), rejection = assert.rejects(pending, error => error.reason === 'MAX_TOKENS' && !error.researchWebSearchFailed);
    h.respond(0, [[FLASH, 65536]]); await rejection;
    assert.ok(h.progress.some(([partial, details]) => partial === null && details?.reset));
});
