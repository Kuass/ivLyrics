import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const repo = resolve(process.env.IVLYRICS_SOURCE_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const outputRoot = pathToFileURL(resolve(process.env.IVLYRICS_ASSESSMENT_OUTPUT || fileURLToPath(new URL('.', import.meta.url))) + '/');
const writeEvidence = process.env.IVLYRICS_WRITE_EVIDENCE === '1';
if (writeEvidence) mkdirSync(new URL('./extracted/', outputRoot), {recursive:true});
const cacheNames = {OpenRouter:'openRouterModelCapabilities', Groq:'groqModelCapabilities', Claude:'claudeModelCapabilities', Gemini:'geminiModelCapabilities'};
for (const [provider, cacheName] of Object.entries(cacheNames)) {
    test(`${provider}: model helper retains token metadata independently of UI ownership`, async () => {
        const source = readFileSync(`${repo}/Addon_AI_${provider}.js`, 'utf8');
        const start = source.indexOf('    async function fetchAvailableModels(');
        const end = source.indexOf('\n    }', start) + '\n    }'.length;
        const helper = source.slice(start, end);
        if (writeEvidence) writeFileSync(new URL(`./extracted/${provider}.fetchAvailableModels.js`, outputRoot), helper);
        const requests = [], cache = new Map([['sentinel-unrelated-model', {max_tokens:123}]]);
        const context = vm.createContext({
            BASE_URL:'https://fixture-provider.invalid/v1',
            [cacheName]:cache,
            asPositiveInteger(value) {const parsed = Number.parseInt(value,10); return Number.isFinite(parsed) && parsed > 0 ? parsed : null;},
            window:{ivLyricsFetch(url, options) {
                let resolve;
                const promise = new Promise(yes => {resolve = yes;});
                requests.push({url, options, resolve}); return promise;
            }}
        });
        const keyStart = source.indexOf('    const modelCapabilitiesKey =');
        if (keyStart >= 0) {
            // Include the actual helper dependency when the cache has endpoint keys.
            vm.runInContext(source.slice(keyStart, source.indexOf('\n\n', keyStart)), context);
        }
        vm.runInContext(helper, context);
        const getFixture = (suffix, limit) => provider === 'Gemini'
            ? {models:[{name:`models/gemini-${suffix}`, displayName:suffix, supportedGenerationMethods:['generateContent'], outputTokenLimit:limit, inputTokenLimit:10000}]}
            : {data:[{id:`model-${suffix}`, type:'model', display_name:suffix, context_window:10000, context_length:10000, max_tokens:limit, max_completion_tokens:limit, top_provider:{max_completion_tokens:limit}}]};
        const old = context.fetchAvailableModels('inert-key-A', 'https://fixture-a.invalid/custom');
        const current = context.fetchAvailableModels('inert-key-B', 'https://fixture-b.invalid/custom');
        assert.equal(requests.length, 2);
        requests[1].resolve({ok:true, json:async () => getFixture('current', 2048)});
        const currentModels = await current;
        requests[0].resolve({ok:true, json:async () => getFixture('old', 1024)});
        const oldModels = await old;
        assert.equal(currentModels.length, 1); assert.equal(oldModels.length,1);
        const currentRecord = Array.from(cache.values()).find(value => value.id === currentModels[0].id);
        const oldRecord = Array.from(cache.values()).find(value => value.id === oldModels[0].id);
        assert.equal(currentRecord, currentModels[0]);
        assert.equal(oldRecord, oldModels[0]);
        assert.equal(cache.get('sentinel-unrelated-model').max_tokens, 123);
        const limitField = provider === 'Claude' ? 'max_tokens' : provider === 'Gemini' ? 'max_output_tokens' : 'max_completion_tokens';
        assert.equal(currentRecord[limitField], 2048);
        assert.equal(oldRecord[limitField], 1024);
        if (provider === 'Gemini') {
            assert.ok(requests[0].url.startsWith('https://fixture-a.invalid/custom/models?'));
            assert.ok(requests[1].url.startsWith('https://fixture-b.invalid/custom/models?'));
        }
    });
}
