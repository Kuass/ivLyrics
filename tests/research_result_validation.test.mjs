import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(process.env.IVLYRICS_RESEARCH_RESULT_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_RESEARCH_RESULT_SOURCE_DIR, 'AIAddonManager.js')
    : new URL('../AIAddonManager.js', import.meta.url), 'utf8');
const normalize = value => JSON.parse(JSON.stringify(value));
const document = { editorial_thesis: { one_sentence: 'Useful research' }, introduction: { paragraphs: ['A useful introduction'] } };
const invalidResults = [
    ['null', null], ['undefined', undefined], ['empty string', ''], ['whitespace', '  '], ['invalid JSON', '{'],
    ['non-JSON prose', 'No structured result'], ['false', false], ['number', 42], ['array', []],
    ['nonempty array', [document]], ['JSON null', 'null'], ['JSON array', '[]'], ['JSON empty object', '{}'],
    ['empty object', {}], ['empty research wrapper', { research: {} }], ['empty legacy wrapper', { track: {} }],
    ['nested empty wrappers', { research: { track: {} } }],
];

async function harness(values, method = 'generateResearch') {
    const storage = new Map(), calls = [], events = [], progress = [], timers = new Set();
    const window = {};
    vm.runInNewContext(source, {
        window, Spicetify: { LocalStorage: { get: key => storage.get(key), set: (key, value) => storage.set(key, value) } },
        console: { log() {}, warn() {}, error() {} },
        setTimeout(callback) { timers.add(callback); return callback; }, clearTimeout(callback) { timers.delete(callback); },
    }, { filename: 'AIAddonManager.js' });
    const manager = window.AIAddonManager;
    await manager._initPromise;
    for (const [index, value] of values.entries()) {
        const addon = { id: `custom-${index}`, name: `Custom ${index}`, description: 'fixture', author: 'fixture', version: '1',
            supports: { research: true, tmi: true }, getSettingsUI() {},
            async [method](params) {
                assert.equal(this, addon);
                calls.push({ id: addon.id, webSearch: params.webSearch });
                // Partial empty documents remain legal while the result builds.
                params.onResearchProgress({}, { chunk: true });
                return typeof value === 'function' ? value(params) : value;
            },
        };
        assert.equal(manager.register(addon), true);
        manager.setProviderEnabled(addon.id, true);
    }
    manager.setProviderOrder(values.map((_, index) => `custom-${index}`));
    for (const name of ['start', 'success', 'error']) manager.on(`ai:request:${name}`, details => events.push([name, normalize(details)]));
    return { manager, calls, events, progress, timers,
        run() { return manager.generateResearch({ title: 'Fixture song', artist: 'Fixture artist', lang: 'en',
            onProgress: (partial, details) => progress.push(normalize({ partial, details })) }); } };
}

for (const method of ['generateResearch', 'generateTMI']) {
    for (const [name, value] of invalidResults) {
        test(`${method}: ${name} is rejected before success and advances to the next provider`, async () => {
            const h = await harness([value, document], method);
            const result = await h.run();
            assert.deepEqual(h.calls, [{ id: 'custom-0', webSearch: true }, { id: 'custom-1', webSearch: true }]);
            assert.equal(result._research.provider, 'custom-1');
            assert.equal(result.editorial_thesis.one_sentence, 'Useful research');
            assert.deepEqual(h.events.map(([name]) => name), ['start', 'success']);
            assert.equal(h.events.at(-1)[1].provider, 'custom-1');
            assert.ok(h.progress.some(entry => entry.details.provider === 'custom-0' && entry.details.reset && entry.details.error));
            assert.equal(h.progress.filter(entry => entry.details.complete).length, 1);
            assert.equal(h.timers.size, 0);
        });
    }
}

for (const [name, value] of [
    ['document object', document], ['JSON document', JSON.stringify(document)],
    ['fenced JSON', `\`\`\`json\n${JSON.stringify(document)}\n\`\`\``], ['research wrapper', { research: document }],
    ['legacy TMI', { track: { description: 'Useful research', trivia: ['A legacy fact'] } }],
    ['wrapped legacy TMI', { research: { track: { description: 'Useful research' } } }],
]) {
    test(`${name} retains existing normalization and does not call fallback`, async () => {
        const h = await harness([value, null]);
        const expected = normalize(h.manager.normalizeResearchResult(value, { title: 'Fixture song', artist: 'Fixture artist', lang: 'en' }));
        const result = normalize(await h.run()); delete result._research; delete expected._research;
        assert.deepEqual(result, expected);
        assert.equal(h.calls.length, 1);
        assert.equal(h.events.at(-1)[1].provider, 'custom-0');
        assert.ok(h.progress.some(entry => entry.details.chunk && entry.partial._research.streaming));
        assert.equal(h.timers.size, 0);
    });
}

test('all invalid final results fail once without a completed document or success event', async () => {
    const h = await harness([null, '{}']);
    await assert.rejects(h.run(), /Research provider returned an (?:empty or )?invalid document/);
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.events.map(([name]) => name), ['start', 'error']);
    assert.equal(h.progress.some(entry => entry.details.complete), false);
    assert.equal(h.timers.size, 0);
});

test('invalid no-search retry result advances providers without repeating search attempts', async () => {
    const h = await harness([params => {
        if (params.webSearch) throw Object.assign(new Error('synthetic search failure'), { code: 'RESEARCH_WEB_SEARCH_FAILED' });
        return {};
    }, document]);
    const result = await h.run();
    assert.deepEqual(h.calls, [{ id: 'custom-0', webSearch: true }, { id: 'custom-0', webSearch: false }, { id: 'custom-1', webSearch: true }]);
    assert.equal(result._research.provider, 'custom-1');
    assert.equal(result._research.web_search, 'used');
    assert.equal(h.timers.size, 0);
});

test('the public partial normalizer stays permissive and no-provider behavior stays null', async () => {
    const h = await harness([]);
    assert.equal(h.manager.normalizeResearchResult(null, { title: 'Context' }).metadata.title, 'Context');
    assert.equal(await h.run(), null);
    assert.equal(h.events.length, 0);
    assert.equal(h.timers.size, 0);
});
