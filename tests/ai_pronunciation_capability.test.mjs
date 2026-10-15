import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Evaluate complete owned manager/I18n sources with inert storage and providers.
// An optional baseline root changes only source bytes. Every assertion requires
// the new feature contract, so an unadapted baseline exposes intentional gaps.
const baselineRoot = process.env.IVLYRICS_CAPABILITY_BASELINE_ROOT;
const root = baselineRoot ? pathToFileURL(resolve(baselineRoot) + '/') : new URL('../', import.meta.url);
const variant = baselineRoot ? 'baseline' : 'candidate';
const read = path => readFileSync(new URL(path, root));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.parse(JSON.stringify(value));
const key = (id, capability) => `ivLyrics:ai:addon:${id}:capability:${capability}`;
const constants = {
  noProviders: 'No AI providers enabled. Please enable at least one provider in settings.',
  noPronunciation: 'No enabled AI provider can generate pronunciation. Turn on Pronunciation for an AI provider in AI Providers settings.',
};
const matrix = [
  ...[null, true, false].map(t => ({ id: `legacy-${t ?? 'unset'}`, kind: 'legacy', t })),
  ...[null, true, false].flatMap(t => [true, false].map(p => ({ id: `independent-${t ?? 'unset'}-${p}`, kind: 'independent', t, p }))),
  ...[null, true, false].map(t => ({ id: `pin-${t ?? 'unset'}`, kind: 'pin', t, next: t === false })),
  { id: 'pin-explicit-false', kind: 'pinExplicit', t: true, p: false, next: false },
  { id: 'pin-explicit-true', kind: 'pinExplicit', t: false, p: true, next: true },
  { id: 'legacy-registration', kind: 'registration' },
  { id: 'translation-only-opt-outs', kind: 'optOuts' },
  { id: 'fallback-translation', kind: 'fallback', phonetic: false },
  { id: 'fallback-pronunciation', kind: 'fallback', phonetic: true },
  { id: 'absent-en', kind: 'absent', language: 'en' },
  { id: 'absent-ko', kind: 'absent', language: 'ko' },
  { id: 'absent-empty-i18n', kind: 'absent', language: 'empty' },
  { id: 'provider-disabled', kind: 'disabled' },
];
assert.equal(matrix.length, 22);


// Only flat boolean supports metadata is read from actual provider sources.
// No provider file is compiled or evaluated, including either ChatGPT file.
const optOuts = [
  ['bing-translate', 'Addon_AI_BingTranslate.js'],
  ['google-translate', 'Addon_AI_GoogleTranslate.js'],
  ['deepl', 'Addon_AI_DeepL.js'],
].map(([id, file]) => {
  const source = read(file).toString();
  assert.ok(source.includes(`id: '${id}'`) || source.includes(`const ID = '${id}';`), `source metadata ID: ${file}`);
  const match = /supports:\s*\{([^}]+)\}/.exec(source);
  assert.ok(match, `supports block: ${file}`);
  const entries = match[1].split(',').map(s => s.trim()).filter(Boolean);
  const supports = Object.fromEntries(entries.map(entry => {
    const pair = /^([A-Za-z][A-Za-z0-9]*):\s*(true|false)$/.exec(entry);
    assert.ok(pair, `only boolean supports metadata: ${file}`);
    return [pair[1], pair[2] === 'true'];
  }));
  assert.equal(supports.translate, true);
  assert.equal(supports.pronunciation, false);
  return { id, file, sha256: digest(Buffer.from(source)), supports, sourceLine: source.slice(0, match.index).split('\n').length };
});

const allResults = [];
const executedSources = new Set();
let moduleLoads = 0;
let requestCount = 0;
let providerAttempts = 0;
let timersScheduled = 0;
let networkAttempts = 0;

async function load(variant, scenario, ordinal) {
  const stored = {};
  if (scenario.t !== undefined && scenario.t !== null) stored[key('model', 'translate')] = String(scenario.t);
  if (scenario.kind === 'pinExplicit') stored[key('model', 'pronunciation')] = String(scenario.p);
  if (scenario.language && scenario.language !== 'empty') stored['ivLyrics:visual:language'] = scenario.language;
  const storage = new Map(Object.entries(stored));
  const reads = [], writes = [], logs = [], timerEvents = [], calls = [], requestResults = [], events = [];
  const activeTimers = new Map();
  const storageMode = ordinal % 2 ? 'persistence' : 'Spicetify';
  const get = k => { reads.push(k); return storage.get(k) ?? null; };
  const set = (k, v) => { assert.equal(typeof v, 'string'); writes.push([k, v]); storage.set(k, v); };
  const blocked = name => (..._args) => { networkAttempts++; throw new Error(`Forbidden boundary: ${name}`); };
  const window = {};
  if (storageMode === 'persistence') window.ivLyricsStoragePersistence = { getItem: get, setItem: set };
  const context = vm.createContext({
    window,
    Spicetify: { LocalStorage: { get, set } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push([level, ...args.map(String)])])),
    fetch: blocked('fetch'), XMLHttpRequest: blocked('XMLHttpRequest'), WebSocket: blocked('WebSocket'),
    setTimeout(callback, delay) {
      assert.equal(delay, 95000, 'only normal provider timeout is allowed');
      assert.equal(typeof callback, 'function');
      const token = ++timersScheduled;
      activeTimers.set(token, callback);
      timerEvents.push({ action: 'set', token, delay });
      return token;
    },
    clearTimeout(token) {
      assert.equal(activeTimers.delete(token), true, 'known timeout cleared');
      timerEvents.push({ action: 'clear', token });
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  const run = path => {
    const bytes = read(path);
    executedSources.add(path);
    new vm.Script(bytes.toString(), { filename: path }).runInContext(context, { timeout: 1000 });
  };
  if (scenario.language === 'empty') window.I18n = { t: () => '' };
  else if (scenario.language) {
    // The new qualified error key works with the unchanged owned I18n engine.
    run('langs/LangEn.js');
    run('langs/LangKo.js');
    run('I18n.js');
    assert.equal(window.I18n.getCurrentLanguage(), scenario.language);
    assert.equal(window.I18n.t('aiProviders.noEnabledProviders'), '');
  }
  run('AIAddonManager.js');
  moduleLoads++;
  const manager = window.AIAddonManager;
  await manager._initPromise;
  assert.equal(manager._initialized, true);
  const h = { variant, scenario, manager, window, storage, reads, writes, logs, timerEvents, calls, requestResults, events, activeTimers, storageMode, rawResults: [], callbacks: [] };
  for (const name of ['ai:request:start', 'ai:request:success', 'ai:request:error']) {
    manager.on(name, value => events.push([name, json(value)]));
  }
  h.register = (id, supports, behavior = 'success', hasMethod = true) => {
    const addon = { id, name: id, author: 'inert-proof', description: 'Inert compatibility fixture', version: '1.0.0', getSettingsUI() {} };
    if (supports !== null) addon.supports = { ...supports };
    if (hasMethod) addon.translateLyrics = async params => {
      providerAttempts++;
      const mode = params.wantSmartPhonetic ? 'pronunciation' : 'translate';
      const ordinal = calls.length;
      const observed = {
        id, mode, text: params.text, lang: params.lang, sourceLang: params.sourceLang,
        trackId: params.trackId, artist: params.artist, title: params.title,
        notation: params.pronunciationNotation, translationStyle: params.translationStyle,
        translationPrompt: typeof params.translationPrompt?.systemPrompt === 'string' && params.translationPrompt.systemPrompt.length > 0,
        phoneticPrompt: typeof params.phoneticPrompt?.systemPrompt === 'string' && params.phoneticPrompt.systemPrompt.length > 0,
      };
      calls.push(observed);
      assert.equal(params.text, 'hello\nworld');
      assert.equal(params.lang, 'en');
      assert.equal(params.sourceLang, 'en');
      assert.equal(params.trackId, 'inert-track');
      assert.equal(params.title, 'Inert Song');
      assert.equal(params.artist, 'Inert Artist');
      assert.equal(params.pronunciationNotation, 'translation');
      assert.equal(params.translationStyle, 'natural');
      assert.equal(observed.phoneticPrompt, params.wantSmartPhonetic);
      assert.equal(observed.translationPrompt, !params.wantSmartPhonetic);
      assert.equal(params.wantSmartPhonetic ? params.translationPrompt : params.phoneticPrompt, null);
      const activePrompt = params.wantSmartPhonetic ? params.phoneticPrompt : params.translationPrompt;
      assert.equal(activePrompt.lineCount, 2);
      assert.ok(activePrompt.userPrompt.includes(params.text));
      const values = params.wantSmartPhonetic ? ['heh-loh', 'wurld'] : ['greetings', 'earth'];
      const detail = { provider: id, fixture: true };
      h.callbacks.push(params.onLine);
      params.onLine(0, behavior === 'fail' ? 'provisional' : values[0], detail);
      if (behavior === 'fail') throw new Error(`inert failure: ${id}`);
      params.onLine(1, values[1], detail);
      const result = { [params.wantSmartPhonetic ? 'phonetic' : 'translation']: values, provider: id, retained: { ordinal } };
      h.rawResults.push(result);
      return result;
    };
    else addon.translateMetadata = async () => ({ title: 'inert' });
    assert.equal(manager.register(addon), true);
    manager.setProviderEnabled(id, true);
    return addon;
  };
  h.request = async (phonetic, expectedIds) => {
    requestCount++;
    const callsAt = calls.length, timersAt = timerEvents.length, eventsAt = events.length;
    const lines = [], resets = [];
    let result, error;
    try {
      result = await manager.translateLyrics({
        trackId: 'inert-track', artist: 'Inert Artist', title: 'Inert Song', text: 'hello\nworld',
        lang: 'en', sourceLang: 'en', pronunciationNotation: 'translation', wantSmartPhonetic: phonetic,
        onLine: (...args) => lines.push(json(args)), onStreamReset: value => resets.push(json(value)),
      });
    } catch (caught) { error = caught.message; }
    const invoked = calls.slice(callsAt).map(value => value.id);
    assert.deepEqual(invoked, expectedIds);
    assert.equal(activeTimers.size, 0);
    assert.equal(timerEvents.length - timersAt, expectedIds.length * 2);
    if (expectedIds.length) {
      assert.equal(error, undefined);
      assert.strictEqual(result, h.rawResults.at(-1), 'normal result identity is retained');
      assert.equal(result.provider, expectedIds.at(-1));
      const values = phonetic ? ['heh-loh', 'wurld'] : ['greetings', 'earth'];
      assert.deepEqual(result[phonetic ? 'phonetic' : 'translation'], values);
      assert.deepEqual(lines.slice(-2).map(([index, text]) => [index, text]), [[0, values[0]], [1, values[1]]]);
      assert.deepEqual(lines.slice(-2).map(([, , detail]) => detail), [{ provider: expectedIds.at(-1), fixture: true }, { provider: expectedIds.at(-1), fixture: true }]);
      assert.equal(events.at(-1)[0], 'ai:request:success');
      assert.equal(events.at(-1)[1].provider, expectedIds.at(-1));
    } else {
      assert.equal(typeof error, 'string');
      assert.equal(lines.length, 0);
      assert.equal(resets.length, 0);
      assert.equal(events.length, eventsAt, 'no request start emitted without an eligible provider');
    }
    const callbackCount = lines.length;
    for (const callback of h.callbacks.slice(callsAt)) callback(99, 'late ignored', { late: true });
    assert.equal(lines.length, callbackCount, 'settled provider cannot add late callback output');
    const observation = { mode: phonetic ? 'pronunciation' : 'translate', invoked, result: result ? json(result) : null, resultIdentityPreserved: Boolean(result), error: error ?? null, lines, resets, events: events.slice(eventsAt) };
    requestResults.push(observation);
    return observation;
  };
  return h;
}

async function exercise(variant, scenario, ordinal) {
  const h = await load(variant, scenario, ordinal);
  const { manager, storage, writes } = h;
  const ordinary = { translate: true, pronunciation: true };
  if (['legacy', 'independent', 'pin', 'pinExplicit'].includes(scenario.kind)) {
    h.register('model', ordinary);
    manager.setProviderOrder(['model']);
    const writesAt = writes.length;
    let expectedT = scenario.t !== false;
    let expectedP = expectedT;
    if (scenario.kind === 'independent') {
      manager.setCapabilityEnabled('model', 'pronunciation', scenario.p);
      assert.equal(storage.get(key('model', 'pronunciation')), String(scenario.p));
      expectedP = scenario.p;
      assert.equal(manager.isCapabilityEnabled('model', 'translate'), expectedT);
    } else if (['pin', 'pinExplicit'].includes(scenario.kind)) {
      manager.setCapabilityEnabled('model', 'translate', scenario.next);
      expectedT = scenario.next;
      expectedP = scenario.kind === 'pinExplicit' ? scenario.p : scenario.t !== false;
      {
        assert.equal(storage.get(key('model', 'pronunciation')), String(expectedP));
        const expectedWrites = scenario.kind === 'pin'
          ? [[key('model', 'pronunciation'), String(expectedP)], [key('model', 'translate'), String(expectedT)]]
          : [[key('model', 'translate'), String(expectedT)]];
        assert.deepEqual(writes.slice(writesAt), expectedWrites);
      }
    }
    assert.equal(manager.isCapabilityEnabled('model', 'translate'), expectedT);
    assert.equal(manager.isCapabilityEnabled('model', 'pronunciation'), expectedP);
    await h.request(false, expectedT ? ['model'] : []);
    await h.request(true, expectedP ? ['model'] : []);
    if (scenario.kind === 'legacy') {
      assert.deepEqual(writes.slice(writesAt), [], 'loading and using untouched legacy capability settings writes nothing');
      assert.equal(storage.has(key('model', 'pronunciation')), false);
    }
  } else if (scenario.kind === 'registration') {
    const legacy = h.register('legacy-declared', { translate: true });
    const bare = h.register('legacy-no-supports', null);
    const metadata = h.register('metadata-only', { metadata: true }, 'success', false);
    const missing = h.register('missing-method', { translate: true }, 'success', false);
    const explicit = h.register('explicit-false', { translate: true, pronunciation: false });
    assert.equal(legacy.supports.pronunciation, true);
    assert.equal(bare.supports.pronunciation, true);
    assert.equal(metadata.supports.pronunciation, undefined);
    assert.equal(missing.supports.pronunciation, undefined);
    assert.equal(explicit.supports.pronunciation, false);
    manager.setProviderOrder(['missing-method', 'metadata-only', 'legacy-declared', 'legacy-no-supports', 'explicit-false']);
    await h.request(false, ['legacy-declared']);
    await h.request(true, ['legacy-declared']);
    manager.setProviderEnabled('legacy-declared', false);
    await h.request(false, ['legacy-no-supports']);
    await h.request(true, ['legacy-no-supports']);
    h.registration = [legacy, bare, metadata, missing, explicit].map(addon => ({ id: addon.id, supports: json(addon.supports) }));
  } else if (scenario.kind === 'optOuts') {
    for (const metadata of optOuts) {
      const addon = h.register(metadata.id, metadata.supports);
      assert.equal(addon.supports.pronunciation, false);
    }
    h.register('model', ordinary);
    manager.setProviderOrder([...optOuts.map(p => p.id), 'model']);
    assert.deepEqual(Array.from(manager.getEnabledProvidersFor('translate'), p => p.id), ['bing-translate', 'google-translate', 'deepl', 'model']);
    for (let i = 0; i < optOuts.length; i++) {
      await h.request(false, [optOuts[i].id]);
      await h.request(true, ['model']);
      manager.setProviderEnabled(optOuts[i].id, false);
    }
  } else if (scenario.kind === 'fallback') {
    h.register('never-used', ordinary);
    h.register('next-ok', ordinary);
    h.register('preferred-fail', ordinary, 'fail');
    h.register('disabled', ordinary);
    manager.setProviderEnabled('disabled', false);
    manager.setProviderOrder(['disabled', 'preferred-fail', 'next-ok', 'never-used']);
    const result = await h.request(scenario.phonetic, ['preferred-fail', 'next-ok']);
    assert.deepEqual(result.resets, [{ provider: 'preferred-fail', reason: 'provider-fallback', error: 'inert failure: preferred-fail' }]);
    assert.deepEqual(result.lines[0], [0, 'provisional', { provider: 'preferred-fail', fixture: true }]);
    assert.deepEqual(result.events[0][1].providers, ['preferred-fail', 'next-ok', 'never-used']);
  } else if (scenario.kind === 'absent') {
    const translation = await h.request(false, []);
    const pronunciation = await h.request(true, []);
    const expectedT = constants.noProviders; // Existing generic lookup remains unchanged.
    const expectedP = scenario.language === 'ko'
      ? "발음을 생성할 수 있는 AI 제공자가 켜져 있지 않습니다. AI 제공자 설정에서 제공자의 '발음' 기능을 켜 주세요."
      : constants.noPronunciation;
    assert.ok(expectedT);
    assert.ok(expectedP);
    assert.equal(translation.error, expectedT);
    assert.equal(pronunciation.error, expectedP);
    if (scenario.language !== 'empty') h.locale = {
      engine: 'I18n.js', tables: variant, language: scenario.language,
      bareKey: h.window.I18n.t('aiProviders.noEnabledProviders'),
      namespacedExisting: h.window.I18n.t('settings.aiProviders.noEnabledProviders'),
      namespacedNew: h.window.I18n.t('settings.aiProviders.noPronunciationProviders'),
    };
  } else if (scenario.kind === 'disabled') {
    h.register('model', ordinary);
    manager.setCapabilityEnabled('model', 'translate', true);
    manager.setCapabilityEnabled('model', 'pronunciation', true);
    manager.setProviderEnabled('model', false);
    await h.request(false, []);
    await h.request(true, []);
  } else throw new Error(`unaccounted scenario: ${scenario.id}`);
  assert.equal(h.activeTimers.size, 0);
  return { id: scenario.id, variant, storageMode: h.storageMode, status: 'pass', requests: h.requestResults, calls: h.calls, storage: Object.fromEntries(storage), writes, timers: h.timerEvents, logs: h.logs, registration: h.registration ?? null, locale: h.locale ?? null };
}

for (const [ordinal, scenario] of matrix.entries()) {
  await test(`${variant} provider capability: ${scenario.id}`, async () => {
    allResults.push(await exercise(variant, scenario, ordinal));
  });
}
assert.equal(networkAttempts, 0);
if (process.env.IVLYRICS_CAPABILITY_RESULT) {
  writeFileSync(process.env.IVLYRICS_CAPABILITY_RESULT, JSON.stringify({
    variant, scenarios: matrix, results: allResults,
    summary: { scenarioRuns: allResults.length, managerModulesLoaded: moduleLoads, managerRequests: requestCount, inertProviderAttempts: providerAttempts, inertTimeoutsScheduled: timersScheduled, networkAttempts },
    sourceHashes: [...executedSources].sort().map(path => ({ path, sha256: digest(read(path)) })),
  }, null, 2) + '\n');
}
