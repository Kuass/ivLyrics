import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const sourceFile = process.env.IVLYRICS_MODAL_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_MODAL_SOURCE_DIR, 'OptionsMenu.js')
  : new URL('../OptionsMenu.js', import.meta.url);
const source = readFileSync(sourceFile, 'utf8');
const extract = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `extract ${startMarker}`);
  return source.slice(start, end);
};
// Complete, unchanged actual host, React wrapper, options modal, local selector,
// and LRCLIB modal. Only DOM/React and unrelated rendering collaborators are inert.
// No browser, storage, player, provider, network, or credential operations occur.
const production = [
  extract('function createFluentModalHost(', 'function resolveFirstLanguagePromptMountNode('),
  extract('function openFluentReactModal(', 'function ensureFluentModalStyles('),
  extract('function openOptionsModal(', 'const FIRST_LANGUAGE_PROMPT_STORAGE_PREFIX = '),
  extract('const formatLrclibCandidateDuration = ', 'const TranslationMenu = '),
  extract('const LyricsProviderSelectButton = react.memo(', 'function openRegenerateTranslationChoiceModal('),
].join('\n');

function harness({ reducedMotion = false } = {}) {
  const frames = new Map(), timers = new Map(), roots = [], focuses = [];
  let callbackId = 0;
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
      this.attributes = {}; this.listeners = new Map(); this.className = '';
      this.classList = {
        add: name => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), name])].join(' '); },
        remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
        contains: name => this.className.split(' ').includes(name),
      };
    }
    get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    remove() {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector) {
      if (selector.startsWith('button:not(')) return this.descendants().filter(node =>
        (['button', 'input', 'select', 'textarea'].includes(node.tag) && !node.disabled)
        || (node.tag === 'a' && node.attributes.href)
        || (node.tabIndex !== undefined && node.tabIndex !== -1));
      return this.descendants().filter(node => selector.split(', ').some(part =>
        part === node.tag || (part.startsWith('.') && node.classList.contains(part.slice(1)))
        || (part.startsWith('[tabindex]') && node.tabIndex !== undefined && node.tabIndex !== -1)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() {
      // A detached DOM element cannot take focus in a browser. Preserve this
      // protection so queued callbacks cannot manufacture a false positive.
      if (!this.isConnected || this.disabled) return;
      document.activeElement = this; focuses.push(this);
    }
  }
  const listeners = new Map();
  const document = {
    body: new Element('body'), activeElement: null,
    createElement: name => new Element(name),
    getElementById(id) { return [this.body, ...this.body.descendants()].find(node => node.id === id) || null; },
    contains(node) { return this.body.contains(node); },
    addEventListener(name, callback, capture) {
      const entries = listeners.get(name) || [];
      entries.push({ callback, capture }); listeners.set(name, entries);
    },
    removeEventListener(name, callback, capture) {
      listeners.set(name, (listeners.get(name) || []).filter(entry => entry.callback !== callback || entry.capture !== capture));
    },
  };
  document.activeElement = document.body;
  const react = {
    Fragment: Symbol('fragment'), memo: callback => callback,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useMemo: callback => callback(), useCallback: callback => callback,
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: initial => ({ current: initial }), useEffect() {}, useLayoutEffect() {},
  };
  const optionLists = [];
  const IvOptionList = props => {
    optionLists.push(props);
    // Keep the real selector's callbacks intact and give them focusable buttons.
    return react.createElement('div', {}, props.items.filter(item => item.onChange).map(item =>
      react.createElement('button', { id: item.key, onClick: item.onChange })));
  };
  const mount = (node, parent) => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(child => mount(child, parent)); return; }
    if (node.type === react.Fragment) { node.children.forEach(child => mount(child, parent)); return; }
    if (typeof node.type === 'function') { mount(node.type(node.props), parent); return; }
    const element = document.createElement(node.type);
    for (const [key, value] of Object.entries(node.props)) element[key] = value;
    parent.appendChild(element); node.children.forEach(child => mount(child, element));
  };
  const reactDom = {
    render(tree, shell) { roots.push({ tree, shell, unmounts: 0 }); mount(tree, shell); },
    unmountComponentAtNode(shell) {
      roots.find(root => root.shell === shell).unmounts++;
      for (const child of [...shell.children]) child.remove();
    },
  };
  const context = {
    react, document, HTMLElement: Element,
    window: {
      ReactDOM: reactDom, LyricsAddonManager: { getEnabledProviders: () => [] },
      setTimeout(callback, delay) { timers.set(++callbackId, { callback, delay }); return callbackId; },
      clearTimeout(id) { timers.delete(id); }, matchMedia: () => ({ matches: reducedMotion }),
    },
    requestAnimationFrame(callback) { frames.set(++callbackId, callback); return callbackId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    resolveOptionsReactDom: () => reactDom, ensureFluentModalStyles() {}, getSettingsSurfaceTheme: () => 'dark',
    getOptionsText: (_key, fallback) => fallback, I18n: { t: key => key },
    IvOptionList, IvConfigButton: 'config-button', SettingRowDescription: 'description', ICONS: {},
    IvLyricsTooltip: 'tooltip', IvLyricsToolbarIcon: 'toolbar-icon',
  };
  vm.runInNewContext(`${production}\nglobalThis.api = { createFluentModalHost, openFluentReactModal, openLocalLyricsLrclibSearchModal, LyricsProviderSelectButton };`, context);
  const trigger = document.body.appendChild(new Element('button'));
  trigger.id = 'local-tools-trigger'; trigger.focus();
  const h = {
    document, trigger, frames, timers, roots, focuses, api: context.api,
    runFrames() {
      const batch = [...frames];
      batch.forEach(([id]) => frames.delete(id));
      batch.forEach(([, callback]) => callback());
    },
    finishClose() {
      const entry = [...timers].find(([, timer]) => timer.delay === 180);
      assert.ok(entry, 'a pending 180 ms close'); timers.delete(entry[0]); entry[1].callback();
    },
    key(key, extra = {}) {
      const event = { key, target: document.activeElement, ...extra,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; },
      };
      for (const { callback } of [...(listeners.get('keydown') || [])]) {
        callback(event);
        if (event.immediatePropagationStopped) break;
      }
      return event;
    },
    listenerCount() { return (listeners.get('keydown') || []).length; },
    openHost(id = 'test-modal', options = {}) {
      const host = context.api.createFluentModalHost({ overlayId: id, ...options });
      host.button = host.shell.appendChild(new Element('button'));
      return host;
    },
    openLocalTools() {
      const tree = context.api.LyricsProviderSelectButton({ isLocalTrack: true,
        trackInfo: { uri: 'spotify:local:Artist:Album:Title:120', title: 'Song', artist: 'Artist' } });
      tree.children[0].props.onClick();
      const overlay = document.getElementById('ivLyrics-options-overlay');
      return { overlay, shell: overlay.children[0], selectSearch() {
        const button = document.getElementById('local-lyrics-lrclib-search');
        button.focus(); button.onClick();
        const search = document.getElementById('ivLyrics-local-lyrics-lrclib-overlay');
        assert.ok(search, 'actual local-tools action created the LRCLIB search modal');
        return { overlay: search, shell: search.children[0] };
      } };
    },
  };
  return h;
}

test('control: normal host opens, Escape closes, cleanup restores its trigger once', () => {
  const h = harness(); let cleanups = 0;
  const host = h.openHost('normal', { onBeforeClose: () => cleanups++ });
  h.runFrames(); assert.equal(h.document.activeElement, host.button);
  const escape = h.key('Escape'); assert.equal(escape.defaultPrevented, true);
  assert.equal(host.overlay.getAttribute('aria-hidden'), 'true');
  h.finishClose(); assert.equal(h.document.activeElement, h.trigger);
  assert.equal(h.listenerCount(), 0); assert.equal(cleanups, 1);
  host.closeModal(); host.closeModal(true); assert.equal(cleanups, 1);
});

test('the actual local-tools to LRCLIB transition keeps search focus at old close finalization', () => {
  const h = harness(); const old = h.openLocalTools(); h.runFrames();
  const current = old.selectSearch(); h.runFrames();
  const input = current.shell.querySelector('input'); input.focus();
  assert.equal(current.shell.contains(h.document.activeElement), true);
  h.finishClose();
  assert.equal(old.overlay.isConnected, false);
  assert.equal(current.overlay.isConnected, true);
  assert.equal(h.document.activeElement, input);
  assert.equal(current.shell.contains(h.document.activeElement), true);
  h.key('Escape'); h.finishClose();
  assert.equal(h.document.activeElement, h.trigger, 'closing the replacement returns to the original toolbar');
  assert.equal(h.roots[0].unmounts, 1); assert.equal(h.roots[1].unmounts, 1);
});

test('Escape closes the new LRCLIB dialog while old options is still fading', () => {
  const h = harness(); const old = h.openLocalTools(); h.runFrames();
  const current = old.selectSearch(); h.runFrames();
  assert.equal(h.listenerCount(), 1);
  const event = h.key('Escape');
  assert.equal(event.immediatePropagationStopped, true);
  assert.equal(old.overlay.classList.contains('is-closing'), true);
  assert.equal(current.overlay.classList.contains('is-closing'), true);
  assert.equal(h.timers.size, 2);
  assert.equal(h.listenerCount(), 0);
  h.finishClose();
  h.finishClose(); assert.equal(current.overlay.isConnected, false);
});

test('control: reduced motion completes the old actual options modal before LRCLIB opens', () => {
  const h = harness({ reducedMotion: true }); const old = h.openLocalTools(); h.runFrames();
  const current = old.selectSearch(); h.runFrames();
  assert.equal(old.overlay.isConnected, false); assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 1); assert.equal(current.shell.contains(h.document.activeElement), true);
  h.key('Escape'); assert.equal(current.overlay.isConnected, false);
  assert.equal(h.document.activeElement, h.trigger);
});

test('control: same-ID replacement of an open host removes its old listener before new focus', () => {
  const h = harness(); const old = h.openHost(); h.runFrames();
  const current = h.openHost(); h.runFrames();
  assert.equal(old.overlay.isConnected, false); assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 1); assert.equal(h.document.activeElement, current.button);
  h.key('Escape'); assert.equal(current.overlay.classList.contains('is-closing'), true);
});

test('same-ID replacement of a fading host owns the keyboard and focus', () => {
  const h = harness(); const old = h.openHost(); h.runFrames(); old.closeModal();
  const current = h.openHost(); h.runFrames();
  assert.equal(old.overlay.isConnected, true); assert.equal(h.listenerCount(), 1);
  assert.equal(h.document.activeElement, current.button);
  h.finishClose(); assert.equal(h.document.activeElement, current.button);
  h.key('Escape'); assert.equal(current.overlay.classList.contains('is-closing'), true);
  h.finishClose(); assert.equal(h.document.activeElement, h.trigger);
});

test('control: queued RAF from an immediately replaced host cannot focus its disconnected controls', () => {
  const h = harness(); const old = h.openHost(); const current = h.openHost();
  assert.equal(old.overlay.isConnected, false);
  h.runFrames();
  assert.equal(h.document.activeElement, current.button);
  assert.equal(h.focuses.includes(old.button), false);
});

test('control: FIFO queued old/new opening frames leave focus in the new current host', () => {
  const h = harness(); const old = h.openHost('old'); old.closeModal();
  const current = h.openHost('new'); h.runFrames();
  assert.equal(h.document.activeElement, current.button);
  assert.equal(h.focuses.includes(old.button), false, 'a closed host cannot regain focus from its queued opening frame');
});

test('control: removed return-focus target cannot steal focus at finalization', () => {
  const h = harness(); const old = h.openHost('old'); h.runFrames(); old.closeModal();
  const current = h.openHost('new'); h.runFrames(); h.trigger.remove(); h.finishClose();
  assert.equal(h.document.activeElement, current.button);
});

test('control: non-modal host ignores Escape when focus belongs to another host', () => {
  const h = harness(); const nonModal = h.openHost('non-modal', { modal: false }); h.runFrames();
  const current = h.openHost('modal'); h.runFrames(); h.key('Escape');
  assert.equal(nonModal.overlay.classList.contains('is-closing'), false);
  assert.equal(current.overlay.classList.contains('is-closing'), true);
});

test('logical close releases focus and keys while keeping the exit animation and unmount delay', () => {
  const h = harness(); let cleanups = 0;
  const host = h.openHost('normal', { onBeforeClose: () => cleanups++ }); h.runFrames();
  host.closeModal();
  assert.equal(h.document.activeElement, h.trigger);
  assert.equal(h.listenerCount(), 0);
  assert.equal(host.overlay.isConnected, true);
  assert.equal(host.overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(cleanups, 0);
  assert.equal([...h.timers.values()][0].delay, 180);
  h.finishClose(); assert.equal(cleanups, 1); assert.equal(host.overlay.isConnected, false);
});

test('closing before the opening frame cannot focus or reopen the hidden dialog', () => {
  const h = harness(); const host = h.openHost();
  host.closeModal(); h.runFrames();
  assert.equal(h.document.activeElement, h.trigger);
  assert.equal(host.overlay.classList.contains('is-open'), false);
  assert.equal(host.overlay.classList.contains('is-closing'), true);
  h.finishClose(); assert.equal(h.document.activeElement, h.trigger);
});

test('closing an inactive dialog preserves a newer external focus target', () => {
  const h = harness(); const host = h.openHost(); h.runFrames();
  const other = h.document.body.appendChild(h.document.createElement('button')); other.focus();
  host.closeModal(); assert.equal(h.document.activeElement, other);
  h.finishClose(); assert.equal(h.document.activeElement, other);
});

test('the current dialog owns Tab wrapping while the old options dialog is fading', () => {
  const h = harness(); const old = h.openLocalTools(); h.runFrames();
  const current = old.selectSearch(); h.runFrames();
  const buttons = current.shell.querySelectorAll('button:not([disabled])');
  const first = buttons[0], last = buttons.at(-1);
  first.focus(); const backward = h.key('Tab', { shiftKey: true });
  assert.equal(backward.defaultPrevented, true); assert.equal(h.document.activeElement, last);
  last.focus(); const forward = h.key('Tab');
  assert.equal(forward.defaultPrevented, true); assert.equal(h.document.activeElement, first);
  h.finishClose(); assert.equal(h.document.activeElement, first);
});

test('cleanup that opens a replacement cannot have its focus overwritten by the retiring host', () => {
  const h = harness(); let current;
  const old = h.openHost('old', { onBeforeClose() { current = h.openHost('new'); h.runFrames(); } });
  h.runFrames(); old.closeModal(); h.finishClose();
  assert.equal(h.document.activeElement, current.button);
  assert.equal(h.listenerCount(), 1);
  h.key('Escape'); h.finishClose(); assert.equal(h.document.activeElement, h.trigger);
});

test('a chain of modal handoffs keeps the original return target and independent cleanup', () => {
  const h = harness(); const first = h.openHost('first'); h.runFrames(); first.closeModal();
  const second = h.openHost('second'); h.runFrames(); second.closeModal();
  const third = h.openHost('third'); h.runFrames();
  const retiring = [...h.timers]; h.timers.clear();
  retiring.reverse().forEach(([, timer]) => timer.callback());
  assert.equal(h.document.activeElement, third.button);
  assert.equal(first.overlay.isConnected, false); assert.equal(second.overlay.isConnected, false);
  assert.equal(h.listenerCount(), 1);
  third.closeModal(); h.finishClose(); assert.equal(h.document.activeElement, h.trigger);
});

test('removing the return target before closing preserves the current dialog until cleanup', () => {
  const h = harness(); const host = h.openHost(); h.runFrames(); h.trigger.remove();
  assert.doesNotThrow(() => host.closeModal());
  assert.equal(h.document.activeElement, host.button);
  h.finishClose(); assert.equal(h.document.activeElement, h.document.body);
  assert.equal(h.listenerCount(), 0);
});
