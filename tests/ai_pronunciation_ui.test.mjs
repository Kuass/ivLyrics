import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

// Run actual card render/click functions and first-language prompt DOM code.
// Hooks and DOM are bounded adapters, not React/browser or Spotify integration.
const baselineRoot = process.env.IVLYRICS_CAPABILITY_BASELINE_ROOT;
const root = baselineRoot ? pathToFileURL(resolve(baselineRoot) + '/') : new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const settings = read('Settings.js');
const options = read('OptionsMenu.js');
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};
const results = [];
const capKey = (id, cap) => `ivLyrics:ai:addon:${id}:capability:${cap}`;
const normalize = value => JSON.parse(JSON.stringify(value));
const elements = node => Array.isArray(node) ? node.flatMap(elements)
  : node && typeof node === 'object' && 'type' in node ? [node, ...elements(node.props.children)] : [];

async function load(initial = {}) {
  const storage = new Map(Object.entries(initial)), writes = [];
  const get = key => storage.get(key) ?? null;
  const set = (key, value) => { writes.push([key, value]); storage.set(key, value); };
  const context = vm.createContext({
    window: {}, Spicetify: { LocalStorage: { get, set } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(read('AIAddonManager.js'), context);
  await context.window.AIAddonManager._initPromise;
  const manager = context.window.AIAddonManager;
  const register = (id, supports = { translate: true }) => {
    const addon = { id, name: id, author: 'fixture', version: '1', description: 'fixture', supports: { ...supports },
      getSettingsUI() {}, async translateLyrics() { throw new Error('UI must not request AI'); } };
    assert.equal(manager.register(addon), true);
    manager.setProviderEnabled(id, true);
    return addon;
  };
  return { context, manager, register, storage, writes, get, set };
}

function cardHarness(h, addon) {
  const slots = [], effects = [];
  let cursor = 0;
  const memo = (fn, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { value: fn(), deps };
    return slots[index].value;
  };
  const useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  };
  const useEffect = (fn, deps) => memo(() => { effects.push(fn); }, deps);
  Object.assign(h.context, { useState, useMemo: memo, useEffect,
    react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    I18n: { t: key => key, getCurrentLanguage: () => 'en' },
  });
  vm.runInContext(section(settings, 'const SETTINGS_OUTLINE_ICONS =', '// AI Addon 개별 카드 컴포넌트')
    + section(settings, 'const AddonSettingsCard =', 'const getLyricsProviderGranularitySupport =')
    + '\nglobalThis.card = AddonSettingsCard;', h.context);
  return () => {
    const render = () => { cursor = 0; return h.context.card({ addon, isEnabled: true, isExpanded: true, onToggle() {}, onExpandToggle() {} }); };
    let tree = render();
    if (effects.length) { effects.splice(0).forEach(fn => fn()); tree = render(); }
    return tree;
  };
}

for (const legacy of [null, true, false]) {
  await test(`actual settings controls preserve inherited pronunciation: ${legacy ?? 'unset'}`, async () => {
    const h = await load(legacy === null ? {} : { [capKey('model', 'translate')]: String(legacy) });
    const addon = h.register('model', { tmi: true, customFirst: true, translate: true, metadata: true, customSecond: true });
    const render = cardHarness(h, addon);
    const chips = tree => elements(tree).filter(e => e.props.className?.startsWith('ai-addon-cap-chip '));
    const find = cap => chips(render()).find(e => e.props.key === cap);
    const initial = chips(render()).map(e => e.props.key);
    assert.deepEqual(initial, ['pronunciation', 'translate', 'metadata', 'tmi', 'customFirst', 'customSecond']);
    const before = h.writes.length;
    find('translate').props.onClick();
    const previous = legacy !== false;
    assert.equal(h.manager.isCapabilityEnabled('model', 'translate'), !previous);
    assert.deepEqual(h.writes.slice(before),
      [[capKey('model', 'pronunciation'), String(previous)], [capKey('model', 'translate'), String(!previous)]]);
    {
      assert.equal(find('pronunciation').props.className.includes('active'), previous);
      find('pronunciation').props.onClick();
      assert.equal(h.manager.isCapabilityEnabled('model', 'pronunciation'), !previous);
      assert.equal(h.manager.isCapabilityEnabled('model', 'translate'), !previous);
      find('translate').props.onClick();
      assert.equal(h.manager.isCapabilityEnabled('model', 'pronunciation'), !previous);
      assert.equal(h.manager.isCapabilityEnabled('model', 'translate'), previous);
      const badge = elements(render()).find(e => e.props.type === 'pronunciation');
      assert.equal(badge.props.label, 'settings.aiProviders.supports.pronunciation');
      const icon = vm.runInContext('SETTINGS_OUTLINE_ICONS.pronunciation', h.context);
      assert.ok(typeof icon === 'string' && icon.startsWith('M11'));
    }
    results.push({ kind: 'settings', legacy, order: initial, writes: h.writes.slice(before) });
  });
}

function node(tag) {
  const result = { tag, children: [], attrs: {}, events: {}, hidden: false,
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(name, callback) { this.events[name] = callback; },
    click() { this.events.click?.(); },
    classList: { toggle() {} },
  };
  return result;
}
const nodes = item => [item, ...item.children.flatMap(nodes)];
function promptHarness(h) {
  let host;
  const prompts = [];
  Object.assign(h.context, {
    APP_NAME: 'ivLyrics', CONFIG: { visual: {} },
    I18n: { t: key => key, getCurrentLanguage: () => 'en' },
    StorageManager: { setItem: h.set }, localStorage: { getItem: h.get, setItem: h.set },
    document: { createElement: node }, resolveFirstLanguagePromptMountNode: () => null,
    createFluentModalHost(config) { host = { shell: node('shell'), closeModal: () => config.onBeforeClose() }; prompts.push(host); return host; },
  });
  vm.runInContext(section(options, 'const FIRST_LANGUAGE_PROMPT_STORAGE_PREFIX =', 'const formatLrclibCandidateDuration ='), h.context);
  return { open: () => h.context.window.ivLyricsFirstLanguagePrompt.maybePrompt({ sourceLang: 'ja', targetLang: 'en', modeKey: 'ja' }),
    host: () => host, prompts };
}

const hintCases = [
  { id: 'keyless-only', keyless: true, initial: 'firstLanguagePrompt.aiProviderHint', selected: 'firstLanguagePrompt.pronunciationAiProviderHint' },
  { id: 'keyless-with-pronunciation', keyless: true, model: true, t: false, p: true, initial: 'firstLanguagePrompt.aiProviderHint', selected: 'firstLanguagePrompt.aiProviderHint' },
  { id: 'disabled-pronunciation', model: true, t: true, p: false, initial: null, selected: 'settings.aiProviders.noPronunciationProviders' },
  { id: 'no-provider', initial: null, selected: 'firstLanguagePrompt.pronunciationAiProviderHint' },
  { id: 'enabled-model', model: true, t: true, p: true, initial: null, selected: null },
  { id: 'keyless-translation-disabled', keyless: true, keylessOff: true, initial: null, selected: 'firstLanguagePrompt.pronunciationAiProviderHint' },
];
for (const scenario of hintCases) {
  await test(`actual first-language hint and hidden state: ${scenario.id}`, async () => {
    const h = await load();
    if (scenario.keyless) {
      h.register('bing-translate', { translate: true, pronunciation: false });
      if (scenario.keylessOff) h.manager.setCapabilityEnabled('bing-translate', 'translate', false);
    }
    if (scenario.model) {
      h.register('model');
      h.manager.setCapabilityEnabled('model', 'translate', scenario.t);
      h.manager.setCapabilityEnabled('model', 'pronunciation', scenario.p);
    }
    const prompt = promptHarness(h), before = h.writes.length;
    const pending = prompt.open();
    assert.ok(pending);
    assert.strictEqual(prompt.open(), pending, 'repeated admission keeps one prompt');
    assert.equal(prompt.prompts.length, 1);
    const shell = prompt.host().shell;
    const hint = nodes(shell).find(n => n.id === 'ivLyrics-first-language-provider-hint');
    const rows = nodes(shell).filter(n => n.attrs.role === 'switch');
    assert.equal(rows.length, 2);
    const view = () => hint && !hint.hidden ? hint.children[1].textContent : null;
    const expectedInitial = scenario.initial;
    assert.equal(view(), expectedInitial);
    const described = () => shell.attrs['aria-describedby'];
    assert.equal(described().includes('ivLyrics-first-language-provider-hint'), Boolean(expectedInitial));
    rows[0].click();
    const expectedSelected = scenario.selected;
    assert.equal(view(), expectedSelected);
    assert.equal(described().includes('ivLyrics-first-language-provider-hint'), Boolean(expectedSelected));
    assert.equal(rows[0].attrs['aria-checked'], 'true');
    rows[0].click();
    assert.equal(view(), expectedInitial);
    assert.equal(rows[0].attrs['aria-checked'], 'false');
    prompt.host().closeModal();
    assert.equal(await pending, 'dismissed');
    assert.equal(prompt.open(), null, 'dismissal remains recorded');
    assert.ok(h.writes.slice(before).every(([key]) => key === 'ivLyrics:first-language-prompted:v1:ja'));
    results.push({ kind: 'hint', id: scenario.id, initial: expectedInitial, selected: expectedSelected, dismissed: true });
  });
}

await test('actual first-language apply keeps saved choices and existing admission rules', async () => {
  const h = await load(); h.register('model');
  const prompt = promptHarness(h), pending = prompt.open();
  const all = nodes(prompt.host().shell);
  all.filter(n => n.attrs.role === 'switch').forEach(row => row.click());
  all.find(n => n.className === 'ivlyrics-first-language-action').click();
  assert.equal(await pending, 'configured');
  assert.equal(h.storage.get('ivLyrics:visual:translation-mode:ja'), 'gemini_romaji');
  assert.equal(h.storage.get('ivLyrics:visual:translation-mode-2:ja'), 'gemini_ko');
  assert.equal(prompt.open(), null);
  const saved = await load({ 'ivLyrics:visual:translation-mode:ja': 'none' });
  const savedPrompt = promptHarness(saved);
  assert.equal(savedPrompt.open(), null);
  assert.equal(savedPrompt.prompts.length, 0);
  results.push({ kind: 'apply', modes: normalize(h.context.CONFIG.visual), admissionPreserved: true });
});

await test('pronunciation styling covers active settings chips and hidden hint DOM', () => {
  const style = read('SettingsStyles.js');
  const hiddenRule = /\.ivlyrics-first-language-provider-hint\[hidden\]\s*\{\s*display:\s*none;\s*\}/.test(options);
  assert.equal(hiddenRule, true);
  assert.equal(style.includes('.ai-addon-cap-chip.cap-pronunciation.active'), true);
});
if (process.env.IVLYRICS_CAPABILITY_UI_RESULT) writeFileSync(process.env.IVLYRICS_CAPABILITY_UI_RESULT,
  JSON.stringify({ variant: baselineRoot ? 'baseline' : 'candidate', results }, null, 2) + '\n');
