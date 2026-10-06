import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const sourceFile = process.env.IVLYRICS_SEARCH_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_SEARCH_SOURCE_DIR, 'OptionsMenu.js')
  : new URL('../OptionsMenu.js', import.meta.url);
const source = readFileSync(sourceFile, 'utf8');
const extract = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `extract ${startMarker}`);
  return source.slice(start, end);
};
const production = [
  extract('function createFluentModalHost(', 'function resolveFirstLanguagePromptMountNode('),
  extract('function openFluentReactModal(', 'function ensureFluentModalStyles('),
  extract('const formatLrclibCandidateDuration = ', 'const TranslationMenu = '),
].join('\n');
const normalize = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
const candidates = text => [{ id: text, candidateKey: text, trackName: text, plainLyrics: text }];

// Execute the complete production component, render/event handlers, modal host,
// and wrapper unchanged. Only React/DOM, translation, and provider collaborators
// are inert. Hook dependencies and cleanup are honored. State setters belonging
// to an unmounted root are ignored, as React does; attempted calls are recorded.
// No browser, provider, network, credentials, storage, or UI clicks are used.
function harness() {
  const pending = [], roots = [], timers = new Map(), errors = [], applies = [], toasts = [];
  let activeRoot, timerId = 0, providerAvailable = true;
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
      this.attributes = {}; this.listeners = new Map(); this.classes = new Set();
      this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
    }
    get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(item => item !== this);
      this.parentNode = null;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name) { this.listeners.delete(name); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() { document.activeElement = this; }
  }
  const document = {
    body: new Element('body'), activeElement: null, listeners: new Map(),
    createElement: name => new Element(name),
    getElementById(id) {
      const find = node => node.id === id ? node : node.children.map(find).find(Boolean);
      return find(this.body) || null;
    },
    contains(node) { return this.body.contains(node); },
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); },
  };
  const sameDependencies = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const slot = (kind, initialize) => {
    const root = activeRoot;
    const index = root.cursor++;
    if (!root.hooks[index]) root.hooks[index] = Object.assign(initialize(root), { kind });
    assert.equal(root.hooks[index].kind, kind, `stable hook order at ${index}`);
    return root.hooks[index];
  };
  const react = {
    Fragment: Symbol('fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const hook = slot('state', root => {
        const result = { value: typeof initial === 'function' ? initial() : initial };
        result.set = value => {
          if (!root.mounted) { root.retiredWrites.push(value); return; }
          result.value = typeof value === 'function' ? value(result.value) : value;
          root.dirty = true;
        };
        return result;
      });
      return [hook.value, hook.set];
    },
    useRef(initial) { return slot('ref', () => ({ value: { current: initial } })).value; },
    useMemo(callback, dependencies) {
      const hook = slot('memo', () => ({}));
      if (!sameDependencies(hook.dependencies, dependencies)) {
        hook.value = callback(); hook.dependencies = dependencies;
      }
      return hook.value;
    },
    useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) {
      const hook = slot('effect', () => ({}));
      if (!sameDependencies(hook.dependencies, dependencies)) {
        activeRoot.effects.push(() => { hook.cleanup?.(); hook.cleanup = callback(); });
        hook.dependencies = dependencies;
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const renderRoot = root => {
    if (!root.mounted) return;
    activeRoot = root; root.cursor = 0; root.effects = []; root.dirty = false;
    root.tree = root.element.type(root.element.props);
    activeRoot = null;
    root.effects.forEach(run => run());
  };
  const reactDom = {
    render(element, shell) {
      const root = { element, shell, mounted: true, hooks: [], retiredWrites: [] };
      roots.push(root); renderRoot(root);
    },
    unmountComponentAtNode(shell) {
      const root = roots.find(item => item.shell === shell);
      assert.ok(root);
      root.mounted = false;
      root.hooks.forEach(hook => { if (hook.kind === 'effect') hook.cleanup?.(); });
    },
  };
  const addon = { searchCandidatesByQuery(query, info) {
    const task = { ...deferred(), query, info: normalize(info) }; pending.push(task); return task.promise;
  } };
  const context = {
    react, document, HTMLElement: Element, AbortController,
    window: { ReactDOM: reactDom,
      LyricsAddonManager: { getAddon: () => providerAvailable ? addon : null, getAddons: () => [] },
      setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
      clearTimeout(id) { timers.delete(id); }, matchMedia: () => ({ matches: false }),
    },
    resolveOptionsReactDom: () => reactDom, ensureFluentModalStyles() {}, getSettingsSurfaceTheme: () => 'dark',
    requestAnimationFrame(callback) { callback(); },
    getOptionsText: (_key, fallback) => fallback,
    console: { error(...args) { errors.push(args); } },
    Toast: { error(text) { toasts.push(text); } },
  };
  vm.runInNewContext(`${production}\nglobalThis.open = openLocalLyricsLrclibSearchModal;`, context);
  const allNodes = node => node && typeof node === 'object'
    ? [node, ...(node.children || []).flat(Infinity).flatMap(allNodes)] : [];
  const refresh = root => { if (root.dirty) renderRoot(root); return root; };
  const input = root => allNodes(refresh(root).tree).find(node => node.type === 'input');
  const searchButton = root => allNodes(refresh(root).tree).find(node => node.type === 'button' && typeof node.props.disabled === 'boolean' && !node.props.style?.alignSelf);
  const state = root => {
    refresh(root);
    const [query, results, status, searching, applyingKey] = root.hooks.filter(hook => hook.kind === 'state').map(hook => hook.value);
    return normalize({ query, results, status, searching, applyingKey });
  };
  return {
    pending, roots, timers, errors, applies, toasts, state, input, searchButton,
    open(trackInfo = { uri: 'spotify:local:Artist:Album:Title:120', title: 'Initial song', artist: 'Artist', lyricsTransitionSeq: 4 }) {
      const close = context.open({ trackInfo, onApplyLocalLyrics: async (...args) => applies.push(normalize(args)) });
      return { root: roots.at(-1), close };
    },
    setQuery(root, value) { input(root).props.onChange({ target: { value } }); refresh(root); },
    clickSearch(root) {
      const button = searchButton(root);
      if (button.props.disabled) return false;
      button.props.onClick(); refresh(root); return true;
    },
    enter(root) { let prevented = false; input(root).props.onKeyDown({ key: 'Enter', preventDefault() { prevented = true; } }); refresh(root); return prevented; },
    apply(root) {
      const button = allNodes(refresh(root).tree).find(node => node.type === 'button' && node.props.style?.alignSelf === 'start');
      assert.ok(button); button.props.onClick();
    },
    setProviderAvailable(value) { providerAvailable = value; },
    finishClose() {
      const entry = [...timers].find(([, timer]) => timer.delay === 180); assert.ok(entry);
      timers.delete(entry[0]); entry[1].callback();
    },
    async complete(index, value) { pending[index].resolve(value); await flush(); roots.forEach(refresh); },
    async fail(index, error) { pending[index].reject(error); await flush(); roots.forEach(refresh); },
  };
}

test('control: a normal search forwards the trimmed query and captured track, then renders candidates', async () => {
  const h = harness(); const { root } = h.open();
  h.setQuery(root, '  first query  '); assert.equal(h.clickSearch(root), true);
  assert.equal(h.pending[0].query, 'first query');
  assert.equal(h.pending[0].info.lyricsTransitionSeq, 4);
  assert.equal(h.state(root).searching, true);
  await h.complete(0, { candidates: candidates('First result') });
  assert.equal(h.state(root).results[0].id, 'First result');
  assert.equal(h.state(root).status, '1개 결과');
  assert.equal(h.state(root).searching, false);
});

test('control: disabled search button suppresses a second button activation, but Enter remains reachable', () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root);
  assert.equal(h.searchButton(root).props.disabled, true);
  assert.equal(h.clickSearch(root), false);
  assert.equal(h.pending.length, 1);
  assert.notEqual(h.input(root).props.disabled, true);
  h.setQuery(root, 'Second query');
  assert.equal(h.enter(root), true);
  assert.equal(h.pending.length, 2);
  assert.equal(h.pending[1].query, 'Second query');
});

test('latest ownership: older success cannot replace a newer completed result', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); h.setQuery(root, 'New query'); h.enter(root);
  await h.complete(1, { candidates: candidates('New result') });
  const latest = h.state(root);
  await h.complete(0, { candidates: [...candidates('Old result'), ...candidates('Old second result')] });
  assert.deepEqual(h.state(root), latest);
});

test('latest ownership: older provider error cannot erase a newer completed result/status', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); h.setQuery(root, 'New query'); h.enter(root);
  await h.complete(1, { candidates: candidates('New result') });
  const latest = h.state(root);
  await h.complete(0, { candidates: [], error: 'Old request failed' });
  assert.deepEqual(h.state(root), latest);
});

test('latest ownership: older rejection cannot erase a newer completed result/status', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); h.setQuery(root, 'New query'); h.enter(root);
  await h.complete(1, { candidates: candidates('New result') });
  const latest = h.state(root);
  await h.fail(0, new Error('Old rejection'));
  assert.deepEqual(h.state(root), latest);
});

test('latest ownership: older completion cannot clear the busy flag of a newer pending request', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); h.setQuery(root, 'New query'); h.enter(root);
  await h.complete(0, { candidates: candidates('Old result') });
  const stillBusy = h.state(root).searching;
  const buttonDisabled = h.searchButton(root).props.disabled;
  await h.complete(1, { candidates: candidates('New result') });
  assert.equal(stillBusy, true);
  assert.equal(buttonDisabled, true);
  assert.equal(h.state(root).results[0].id, 'New result');
});

test('latest ownership: a newer empty submission retains its validation feedback', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); h.setQuery(root, '   '); h.enter(root);
  assert.equal(h.pending.length, 1);
  const validationStatus = h.state(root).status;
  assert.equal(validationStatus, '검색어를 입력해 주세요.');
  await h.complete(0, { candidates: candidates('Old result') });
  assert.equal(h.state(root).status, validationStatus);
  assert.deepEqual(h.state(root).results, []);
});

test('latest ownership: unavailable provider submission retains its feedback', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); h.setProviderAvailable(false); h.setQuery(root, 'New query'); h.enter(root);
  assert.equal(h.pending.length, 1);
  const unavailableStatus = h.state(root).status;
  assert.equal(unavailableStatus, 'LRCLIB provider를 사용할 수 없습니다.');
  await h.complete(0, { candidates: candidates('Old result') });
  assert.equal(h.state(root).status, unavailableStatus);
  assert.deepEqual(h.state(root).results, []);
});

test('retirement ownership: unmounted searches do not attempt state updates', async () => {
  const h = harness(); const { root, close } = h.open();
  h.clickSearch(root); close(true); assert.equal(root.mounted, false);
  await h.complete(0, { candidates: candidates('Retired result') });
  assert.equal(root.retiredWrites.length, 0);
});

test('control: replacing the modal unmounts its own root and old completion cannot touch the new modal', async () => {
  const h = harness(); const old = h.open(); h.clickSearch(old.root);
  const current = h.open(); assert.equal(old.root.mounted, false);
  h.setQuery(current.root, 'Current modal query'); h.clickSearch(current.root);
  await h.complete(1, { candidates: candidates('Current modal result') });
  const snapshot = h.state(current.root);
  await h.complete(0, { candidates: candidates('Retired modal result') });
  assert.deepEqual(h.state(current.root), snapshot);
  assert.deepEqual(h.applies, []); assert.deepEqual(h.toasts, []);
});

test('control: animated close/reopen keeps separate roots during the 180ms close interval', async () => {
  const h = harness(); const old = h.open(); h.clickSearch(old.root); old.close();
  assert.equal(old.root.mounted, true);
  assert.equal(old.root.shell.parentNode.getAttribute('aria-hidden'), 'true');
  const current = h.open(); h.setQuery(current.root, 'Current query'); h.clickSearch(current.root);
  const snapshot = h.state(current.root);
  await h.complete(0, { candidates: candidates('Closing modal result') });
  assert.deepEqual(h.state(current.root), snapshot);
  h.finishClose(); assert.equal(old.root.mounted, false); assert.equal(current.root.mounted, true);
  await h.complete(1, { candidates: candidates('Current result') });
  assert.equal(h.state(current.root).results[0].id, 'Current result');
});

test('control: current empty result, provider failure and rejection keep normal feedback', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); await h.complete(0, { candidates: [] });
  assert.equal(h.state(root).status, '검색 결과가 없습니다.');
  assert.equal(h.state(root).searching, false);
  h.clickSearch(root); await h.complete(1, { candidates: [], error: 'Current provider failure' });
  assert.equal(h.state(root).status, 'Current provider failure');
  h.clickSearch(root); await h.fail(2, new Error('Current rejection'));
  assert.equal(h.state(root).status, 'Current rejection');
  assert.equal(h.state(root).searching, false);
});

test('control: invalid query and unavailable provider make no request', () => {
  const h = harness(); const { root } = h.open();
  h.setQuery(root, ''); h.enter(root);
  assert.equal(h.state(root).status, '검색어를 입력해 주세요.');
  h.setQuery(root, 'Query'); h.setProviderAvailable(false); h.enter(root);
  assert.equal(h.state(root).status, 'LRCLIB provider를 사용할 수 없습니다.');
  assert.equal(h.pending.length, 0);
});

test('control: apply retains the existing query, original track URI and transition identity contract', async () => {
  const h = harness(); const { root } = h.open();
  h.setQuery(root, 'Application query'); h.clickSearch(root);
  await h.complete(0, { candidates: candidates('Choice') }); h.apply(root); await flush();
  assert.deepEqual(h.applies[0][1], {
    source: 'lrclib-local-search', query: 'Application query',
    trackUri: 'spotify:local:Artist:Album:Title:120', transitionSeq: 4,
  });
  assert.equal(h.applies[0][0].id, 'Choice');
});


test('retired rejection is silent after unmount', async () => {
  const h = harness(); const { root, close } = h.open();
  h.clickSearch(root); close(true);
  await h.fail(0, new Error('Retired failure'));
  assert.equal(root.retiredWrites.length, 0);
  assert.equal(h.errors.length, 0);
});

test('a queued Enter callback after unmount cannot start another request', () => {
  const h = harness(); const { root, close } = h.open();
  const keyDown = h.input(root).props.onKeyDown;
  close(true);
  keyDown({ key: 'Enter', preventDefault() {} });
  assert.equal(h.pending.length, 0);
  assert.equal(root.retiredWrites.length, 0);
});

test('a superseded rejection leaves the newer pending request busy and unreported', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); h.setQuery(root, 'New query'); h.enter(root);
  await h.fail(0, new Error('Superseded failure'));
  assert.equal(h.state(root).searching, true);
  assert.equal(h.state(root).status, '');
  assert.equal(h.errors.length, 0);
  await h.complete(1, { candidates: candidates('New result') });
  assert.equal(h.state(root).results[0].id, 'New result');
});

test('empty submission ends searching immediately and preserves the already displayed choices', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); await h.complete(0, { candidates: candidates('Existing result') });
  h.setQuery(root, 'Pending query'); h.enter(root);
  h.setQuery(root, '  '); h.enter(root);
  assert.equal(h.state(root).searching, false);
  assert.equal(h.state(root).results[0].id, 'Existing result');
  await h.complete(1, { candidates: candidates('Retired result') });
  assert.equal(h.state(root).results[0].id, 'Existing result');
  assert.equal(h.state(root).status, '검색어를 입력해 주세요.');
});

test('unavailable replacement ends searching immediately and removes the displayed choices', async () => {
  const h = harness(); const { root } = h.open();
  h.clickSearch(root); await h.complete(0, { candidates: candidates('Existing result') });
  h.setQuery(root, 'Pending query'); h.enter(root);
  h.setProviderAvailable(false); h.enter(root);
  assert.equal(h.state(root).searching, false);
  assert.deepEqual(h.state(root).results, []);
  await h.fail(1, new Error('Retired failure'));
  assert.equal(h.state(root).status, 'LRCLIB provider를 사용할 수 없습니다.');
  assert.equal(h.errors.length, 0);
});

test('repeated same-query submissions still give only the latest request ownership', async () => {
  const h = harness(); const { root } = h.open();
  h.enter(root); h.enter(root); h.enter(root);
  assert.equal(new Set(h.pending.map(request => request.query)).size, 1);
  await h.complete(2, { candidates: candidates('Newest result') });
  await h.complete(0, null);
  await h.fail(1, new Error('Older failure'));
  assert.equal(h.state(root).results[0].id, 'Newest result');
  assert.equal(h.state(root).searching, false);
  assert.equal(h.errors.length, 0);
});
