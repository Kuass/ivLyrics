import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = resolve(process.env.IVLYRICS_SOURCE_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const outputRoot = pathToFileURL(resolve(process.env.IVLYRICS_ASSESSMENT_OUTPUT || fileURLToPath(new URL('.', import.meta.url))) + '/');
const output = new URL('./extracted/', outputRoot);
const writeEvidence = process.env.IVLYRICS_WRITE_EVIDENCE === '1';
if (writeEvidence) mkdirSync(output, { recursive: true });
export const providers = ['OpenRouter', 'Groq', 'Perplexity', 'Claude', 'Gemini', 'Pollinations'];
const manifest = [];
const extracted = new Map(providers.map(provider => {
    const filename = `Addon_AI_${provider}.js`;
    const source = readFileSync(`${repo}/${filename}`, 'utf8');
    const start = source.indexOf('        getSettingsUI() {');
    const end = source.indexOf('\n        },', start) + '\n        }'.length;
    assert.ok(start >= 0 && end > start);
    const method = source.slice(start, end);
    // No transformation of callbacks, effects, controls, or helper parser.
    const keyStart = source.indexOf('    function getApiKeys() {');
    const keyEnd = source.indexOf('\n    }', keyStart) + '\n    }'.length;
    const keys = source.slice(keyStart, keyEnd);
    if (writeEvidence) {
        writeFileSync(new URL(`${provider}.getSettingsUI.js`, output), method);
        writeFileSync(new URL(`${provider}.getApiKeys.js`, output), keys);
    }
    manifest.push({ filename, sha256: createHash('sha256').update(source).digest('hex'), methodLine: source.slice(0,start).split('\n').length, methodEndLine: source.slice(0,end).split('\n').length });
    return [provider, {method, keys}];
}));
if (writeEvidence) writeFileSync(new URL('./source-manifest.json', outputRoot), JSON.stringify(manifest, null, 2) + '\n');

const model = id => [{ id, name: id }];
const flush = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree, predicate) {
    if (!tree || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap(child => nodes(child, predicate))];
}

function harness(provider, initial = {}) {
    const settings = new Map(Object.entries({'api-keys': 'fixture-key-A', 'model':'saved-custom-model', 'custom-model':'saved-custom-model', 'base-url':'https://fixture-a.invalid/v1beta', ...initial}));
    const states = [], effects = [], pending = new Map(), refs = [], callbacks = [];
    const stateWrites = [], metadataWrites = [], requests = [], errors = [];
    let stateIndex = 0, effectIndex = 0, refIndex = 0, callbackIndex = 0, mounted = true, dirty = true, tree;
    const React = {
        useState(initialValue) {
            const index = stateIndex++;
            if (!(index in states)) states[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
            return [states[index], next => {
                const value = typeof next === 'function' ? next(states[index]) : next;
                stateWrites.push({index, value, mounted});
                // An unmounted React setter is ignored. Record attempted publication, but
                // do not claim a new instance actually receives the old state.
                if (!mounted) return;
                if (!Object.is(states[index], value)) dirty = true;
                states[index] = value;
            }];
        },
        useRef(initialValue) { const index = refIndex++; return refs[index] ||= {current: initialValue}; },
        useCallback(fn, deps) {
            const index = callbackIndex++;
            if (!callbacks[index] || deps.some((dep, i) => !Object.is(dep, callbacks[index].deps[i]))) {
                callbacks[index] = {fn, deps};
            }
            return callbacks[index].fn;
        },
        useEffect(fn, deps) {
            const index = effectIndex++;
            if (!effects[index] || deps.some((dep, i) => !Object.is(dep, effects[index].deps[i]))) {
                pending.set(index, {deps, fn});
            } else {
                pending.delete(index);
            }
        },
        createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity).filter(child => child !== false && child !== null && child !== undefined)}),
    };
    const getSetting = (key, fallback = null) => settings.get(key) ?? fallback;
    const setSetting = (key, value) => settings.set(key, value);
    const metadata = new Proxy({models: []}, {set(target, name, value) {metadataWrites.push({name, value, mounted}); target[name] = value; return true;}});
    const addon = new Proxy({models: []}, {set(target, name, value) {metadataWrites.push({name:`addon.${name}`, value, mounted}); target[name] = value; return true;}});
    let context;
    const fetchAvailableModels = (key = context.getPrimaryApiKey()) => {
        let resolve, reject;
        const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
        requests.push({key, baseUrl:getSetting('base-url'), resolve, reject});
        return promise;
    };
    const forbidden = () => {throw new Error('Unexpected auth, connection, or real provider request');};
    context = vm.createContext({
        Spicetify:{React}, ADDON_INFO:metadata, PollinationsAddon:addon,
        getSetting, setSetting, fetchAvailableModels,
        getSelectedModel: () => getSetting('model', 'openai'),
        fetchApiKeyInfo: async () => null,
        aiText: (_id, fallback) => fallback,
        maskKey: () => 'fixture-only', DEFAULT_MODEL:'openai',
        DEFAULT_MAX_OUTPUT_TOKENS:32768,
        window: {open: forbidden, ivLyricsFetch:forbidden, __ivLyricsDebugLog:(...args) => errors.push(args)},
        console:{error:(...args) => errors.push(args)},
        requestDeviceCode:forbidden, pollDeviceToken:forbidden,
        disconnectPollinationsAuth:forbidden, storePollinationsAccessToken:forbidden,
        callOpenRouterAPIRaw:forbidden, callGroqAPIRaw:forbidden,
        callPerplexityAPIRaw:forbidden, callClaudeAPIRaw:forbidden,
        callGeminiAPIRaw:forbidden, callPollinationsAPIRaw:forbidden,
    });
    vm.runInContext(extracted.get(provider).keys, context);
    context.getPrimaryApiKey = () => context.getApiKeys()[0] || '';
    context.getModels = () => fetchAvailableModels(context.getPrimaryApiKey());
    const Component = vm.runInContext(`({${extracted.get(provider).method}}).getSettingsUI()`, context);
    function render(flushEffects = true) {
        assert.equal(mounted, true);
        let runs = 0;
        do {
            assert.ok(++runs < 20, 'Render did not settle');
            dirty = false; stateIndex = 0; effectIndex = 0; refIndex = 0; callbackIndex = 0;
            tree = Component();
            if (flushEffects) {
                const ready = Array.from(pending); pending.clear();
                for (const [index, effect] of ready) {
                    effects[index]?.cleanup?.();
                    effects[index] = {deps:effect.deps, cleanup:effect.fn()};
                }
            }
        } while (dirty);
        return tree;
    }
    function keyInput() {
        if (provider === 'Pollinations' && !nodes(tree, item => item.type === 'input' && item.props.type === 'password').length) {
            const toggle = nodes(tree, item => item.type === 'div' && item.props.onClick && item.children.some(child => child.type === 'label' && child.children.includes('API Key')))[0];
            assert.ok(toggle); toggle.props.onClick(); render();
        }
        return nodes(tree, item => item.type === 'input' && /multiple|sk_/.test(item.props.placeholder || ''))[0];
    }
    const api = {
        settings, requests, stateWrites, metadataWrites, metadata, addon, errors, render,
        key(value, flushEffects = true) {const input = keyInput(); assert.ok(input); assert.ok(!input.props.disabled, 'Key input must remain reachable during loading'); input.props.onChange({target:{value}}); render(flushEffects);},
        baseUrl(value, flushEffects = true) {const input = nodes(tree, item => item.type === 'input' && item.props.placeholder === 'https://generativelanguage.googleapis.com/v1beta')[0]; assert.ok(input); assert.ok(!input.props.disabled); input.props.onChange({target:{value}}); render(flushEffects);},
        select() {return nodes(tree, item => item.type === 'select')[0];},
        options() {return nodes(api.select(), item => item.type === 'option').map(item => item.props.value);},
        refreshButton() {return nodes(tree, item => item.props.title === 'Refresh model list')[0];},
        refresh() {const button = api.refreshButton(); assert.ok(button); assert.equal(Boolean(button.props.disabled), false); button.props.onClick(); render();},
        unmount() {mounted = false; effects.forEach(effect => effect?.cleanup?.());},
        async resolve(index, id, flushEffects = true) {requests[index].resolve(typeof id === 'string' ? model(id) : id); await flush(); if (mounted) render(flushEffects);},
        async reject(index) {requests[index].reject(new Error('fixture rejection')); await flush(); if (mounted) render();},
    };
    render();
    return api;
}

for (const provider of providers) {
    test(`${provider}: current response and refresh preserve chosen/custom model`, async () => {
        const h = harness(provider);
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].key, 'fixture-key-A');
        assert.equal(h.refreshButton().props.disabled, true);
        await h.resolve(0, 'current-model');
        assert.ok(h.options().includes('current-model'));
        assert.equal(h.select().props.disabled, false);
        assert.equal(h.settings.get('model'), 'saved-custom-model');
        assert.equal(h.settings.get('custom-model'), 'saved-custom-model');
        h.refresh(); assert.equal(h.requests.length, 2);
        await h.resolve(1, 'refreshed-model');
        assert.ok(h.options().includes('refreshed-model'));
        assert.equal(h.settings.get('model'), 'saved-custom-model');
        assert.equal(h.settings.get('base-url'), 'https://fixture-a.invalid/v1beta');
        h.unmount();
    });

    test(`${provider}: old account cannot overwrite newer completed model list`, async () => {
        const h = harness(provider);
        h.key('fixture-key-B');
        assert.equal(h.requests[1].key, 'fixture-key-B');
        await h.resolve(1, 'new-account-model');
        await h.resolve(0, 'old-account-model');
        assert.ok(h.options().includes('new-account-model'), JSON.stringify(h.options()));
        assert.ok(!h.options().includes('old-account-model'));
        h.unmount();
    });

    test(`${provider}: old completion cannot finish newer loading indicator`, async () => {
        const h = harness(provider);
        h.key('fixture-key-B');
        await h.resolve(0, 'old-account-model');
        assert.equal(h.refreshButton().props.disabled, true, 'New account request is still pending');
        assert.equal(h.select().props.disabled, true);
        await h.resolve(1, 'new-account-model'); h.unmount();
    });

    test(`${provider}: old account cannot repopulate picker after key clear`, async () => {
        const h = harness(provider);
        h.key('');
        assert.equal(h.settings.get('api-keys'), '');
        // Pollinations intentionally supports a public, anonymous catalog.
        if (provider === 'Pollinations') await h.resolve(1, 'public-model');
        await h.resolve(0, 'old-account-model');
        assert.ok(!h.options().includes('old-account-model'), JSON.stringify(h.options()));
        if (provider === 'Pollinations') assert.ok(h.options().includes('public-model'));
        else assert.equal(h.requests.length, 1);
        h.unmount();
    });

    test(`${provider}: late model result performs no component state writes after unmount`, async () => {
        const h = harness(provider);
        await flush(); // Settle the inert Pollinations key-info collaborator first.
        h.unmount();
        const previous = h.stateWrites.length;
        await h.resolve(0, 'unmounted-model');
        assert.equal(h.stateWrites.length, previous, JSON.stringify(h.stateWrites.slice(previous)));
    });
}

for (const provider of providers.filter(name => name !== 'Pollinations')) {
    test(`${provider}: clearing the only key ends loading without awaiting old provider`, () => {
        const h = harness(provider);
        h.key('');
        assert.ok(!nodes(h.select(), item => item.type === 'option').some(item => item.children.includes('Loading models...')));
        h.unmount();
    });
    test(`${provider}: empty newest result cannot be replaced by older success`, async () => {
        const h = harness(provider);
        h.key('fixture-key-B');
        await h.resolve(1, []);
        await h.resolve(0, 'old-account-model');
        assert.ok(!h.options().includes('old-account-model'));
        h.unmount();
    });
    test(`${provider}: manual refresh obeys subsequent key change`, async () => {
        const h = harness(provider);
        await h.resolve(0, 'initial-model');
        h.refresh();
        h.key('fixture-key-B');
        await h.resolve(2, 'new-account-model');
        await h.resolve(1, 'stale-refresh-model');
        assert.ok(h.options().includes('new-account-model'), JSON.stringify(h.options()));
        assert.ok(!h.options().includes('stale-refresh-model'));
        h.unmount();
    });
    test(`${provider}: no key issues no request; JSON rotation selects first key`, async () => {
        const empty = harness(provider, {'api-keys':'', 'api-key':''});
        assert.equal(empty.requests.length, 0); empty.unmount();
        const h = harness(provider, {'api-keys':'[" first-fixture-key ", "second-fixture-key"]'});
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].key, 'first-fixture-key');
        await h.resolve(0, []);
        assert.equal(h.settings.get('model'), 'saved-custom-model'); h.unmount();
    });
}

for (const provider of ['Claude', 'Gemini', 'Perplexity', 'Pollinations']) {
    test(`${provider}: component metadata publication follows newest account`, async () => {
        const h = harness(provider);
        h.key('fixture-key-B');
        await h.resolve(1, 'new-account-model');
        await h.resolve(0, 'old-account-model');
        assert.equal(h.metadata.models[0]?.id, 'new-account-model');
        h.unmount();
    });
    test(`${provider}: unmounted callback does not publish component metadata`, async () => {
        const h = harness(provider);
        await flush(); h.unmount();
        const count = h.metadataWrites.length;
        await h.resolve(0, 'unmounted-model');
        assert.equal(h.metadataWrites.length, count);
    });
}

test('Gemini: previous base URL cannot overwrite newer endpoint catalog', async () => {
    const h = harness('Gemini');
    h.baseUrl('https://fixture-b.invalid/custom');
    assert.equal(h.requests[1].baseUrl, 'https://fixture-b.invalid/custom');
    await h.resolve(1, 'new-endpoint-model');
    await h.resolve(0, 'old-endpoint-model');
    assert.ok(h.options().includes('new-endpoint-model'), JSON.stringify(h.options()));
    assert.equal(h.settings.get('base-url'), 'https://fixture-b.invalid/custom');
    h.unmount();
});

test('Pollinations: anonymous catalog remains supported after clear', async () => {
    const h = harness('Pollinations'); h.key('');
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].key, '');
    await h.resolve(1, 'public-model');
    await h.resolve(0, 'old-account-model');
    assert.ok(h.options().includes('public-model'));
    assert.ok(!h.options().includes('old-account-model')); h.unmount();
});

for (const provider of providers.filter(name => name !== 'Pollinations')) {
    for (const nextKey of ['fixture-key-B', '']) {
        test(`${provider}: input change retires the old completion before passive effects (${nextKey ? 'replace' : 'clear'})`, async () => {
            const h = harness(provider);
            h.key(nextKey, false);
            assert.equal(h.requests.length, 1);
            const metadataCount = h.metadataWrites.length;
            await h.resolve(0, 'retired-before-effect', false);
            assert.ok(!h.options().includes('retired-before-effect'));
            assert.equal(h.metadataWrites.length, metadataCount);
            h.render();
            if (nextKey) {
                assert.equal(h.requests.length, 2);
                await h.resolve(1, 'new-model');
                assert.ok(h.options().includes('new-model'));
            } else {
                assert.equal(h.requests.length, 1);
                assert.ok(!h.refreshButton().children.includes('...'));
            }
            h.unmount();
        });
    }
    test(`${provider}: repeating the current key value keeps its pending request valid`, async () => {
        const h = harness(provider);
        h.key('fixture-key-B');
        h.key('fixture-key-B');
        assert.equal(h.requests.length, 2);
        await h.resolve(1, 'still-current-model');
        assert.ok(h.options().includes('still-current-model'));
        h.unmount();
        await h.resolve(0, 'retired-model');
    });
}
test('Gemini: base URL input retires the old completion before passive effects', async () => {
    const h = harness('Gemini');
    h.baseUrl('https://fixture-b.invalid/custom', false);
    const metadataCount = h.metadataWrites.length;
    await h.resolve(0, 'retired-endpoint-model', false);
    assert.ok(!h.options().includes('retired-endpoint-model'));
    assert.equal(h.metadataWrites.length, metadataCount);
    h.render(); await h.resolve(1, 'new-endpoint-model');
    assert.ok(h.options().includes('new-endpoint-model')); h.unmount();
});
test('Gemini: repeating the current base URL keeps its pending request valid', async () => {
    const h = harness('Gemini');
    h.baseUrl('https://fixture-b.invalid/custom');
    h.baseUrl('https://fixture-b.invalid/custom');
    assert.equal(h.requests.length, 2);
    await h.resolve(1, 'still-current-endpoint');
    assert.ok(h.options().includes('still-current-endpoint'));
    await h.resolve(0, 'old-endpoint-model'); h.unmount();
});
