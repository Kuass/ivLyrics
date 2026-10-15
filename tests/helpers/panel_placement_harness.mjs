import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compiledSource, extraction } from './panel_placement_source.mjs';

// Explicit bounded DOM, React and scheduler fixtures, not a browser or Spotify runtime.
// Exact complete production functions are compiled once and reused by every scenario.
// Selectors, child-list observation and text/comment sibling ordering cover only exercised paths.
const program = new vm.Script(compiledSource, { filename: 'extracted-panel-placement.js' });
const PANEL = 'ivlyrics-panel-lyrics-container';
const SECTION = 'ivlyrics-panel-lyrics-section';

export function environment({ mapped = true, withHeader = true, withSidebar = true, reactMode = 'modern', emptyRenders = 0, throwRender = false } = {}) {
  const trace = [];
  const observers = new Set();
  const timers = new Map();
  const requests = [];
  const roots = [];
  const storage = new Map();
  let time = 0, sequence = 0, nodeId = 0;
  let renderCount = 0, legacyUnmounts = 0, styleCalls = 0;
  const log = (event, data = {}) => trace.push({ time, event, ...data });
  function mutation(target, addedNodes, removedNodes) {
    for (const observer of observers) {
      if (observer.root && observer.options.childList && (observer.root === target || observer.options.subtree && observer.root.contains(target))) {
        observer.records.push({ type: 'childList', target, addedNodes, removedNodes });
      }
    }
  }
  class Element {
    constructor(name, { classes = [], testId = null, nodeType = 1 } = {}) {
      this.name = name; this.testId = testId; this.classes = new Set(classes); this.childNodes = []; this.nodeType = nodeType; this.parentElement = null; this.nodeId = ++nodeId;
      this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value), contains: value => this.classes.has(value) };
    }
    get children() { return this.childNodes.filter(node => node.nodeType === 1); }
    get className() { return [...this.classes].join(' '); }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get isConnected() { return document.documentElement.contains(this); }
    get nextSibling() { const s = this.parentElement?.childNodes || []; return s[s.indexOf(this) + 1] || null; }
    get nextElementSibling() { let node = this.nextSibling; while (node && node.nodeType !== 1) node = node.nextSibling; return node; }
    get previousElementSibling() { const s = this.parentElement?.children || []; return s[s.indexOf(this) - 1] || null; }
    append(...nodes) { for (const node of nodes) this.appendChild(node); return this; }
    appendChild(node) { return this.insertBefore(node, null); }
    insertBefore(node, reference) {
      if (reference !== null && reference.parentElement !== this) throw new Error('reference is not a child');
      if (reference === node) return node;
      if (node === this || node.contains(this)) throw new Error('hierarchy cycle');
      if (node.parentElement) node.remove();
      this.childNodes.splice(reference === null ? this.childNodes.length : this.childNodes.indexOf(reference), 0, node);
      node.parentElement = this;
      log('dom-insert', { node: node.name, nodeId: node.nodeId, parent: this.name, before: reference?.name || null });
      mutation(this, [node], []); return node;
    }
    remove() {
      if (!this.parentElement) return;
      const parent = this.parentElement; parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentElement = null;
      log('dom-remove', { node: this.name, nodeId: this.nodeId, parent: parent.name }); mutation(parent, [], [this]);
    }
    contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
    matches(selector) {
      if (this.nodeType !== 1) return false;
      return selector.split(',').some(part => {
        const simple = part.trim(); const testId = simple.match(/^\[data-testid="([^"]+)"\]$/);
        if (testId) return this.testId === testId[1];
        if (/^\.[\w-]+$/.test(simple)) return this.classes.has(simple.slice(1));
        throw new Error(`unimplemented selector: ${simple}`);
      });
    }
    querySelector(selector) {
      for (const child of this.children) { if (child.matches(selector)) return child; const result = child.querySelector(selector); if (result) return result; }
      return null;
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  }
  const element = (name, options) => new Element(name, options);
  const textNode = name => element(name, { nodeType: 3 });
  const commentNode = name => element(name, { nodeType: 8 });
  const document = { documentElement: element('html'), body: element('body'), head: element('head'), createElement: name => element(name === 'div' ? 'ivlyrics' : name), querySelector: selector => document.documentElement.querySelector(selector) };
  document.documentElement.append(document.head, document.body);
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.root = null; this.records = []; observers.add(this); }
    observe(root, options) { this.root = root; this.options = { ...options }; log('observe', { root: root.name, options }); }
    disconnect() { log('disconnect', { root: this.root?.name || null }); this.root = null; this.records = []; }
  }
  function deliverObservers() {
    let rounds = 0;
    while ([...observers].some(o => o.root && o.records.length)) {
      if (++rounds > 100) throw new Error('observer delivery did not settle');
      // Snapshot a checkpoint batch; mutations made by callbacks are delivered in a later round.
      const batch = [...observers].filter(o => o.root && o.records.length).map(o => [o, o.records.splice(0)]);
      for (const [observer, records] of batch) if (observer.root) { log('observer-delivery', { records: records.length }); observer.callback(records, observer); }
    }
  }
  const setTimeout = (callback, delay = 0) => { const id = ++sequence; timers.set(id, { callback, at: time + Number(delay) }); log('timer-set', { id, delay }); return id; };
  const clearTimeout = id => { timers.delete(id); log('timer-clear', { id }); };
  function advance(ms) {
    const until = time + ms; let count = 0; deliverObservers();
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > until) break;
      if (++count > 1000) throw new Error('timer loop did not settle');
      time = next[1].at; timers.delete(next[0]); log('timer-fire', { id: next[0] }); next[1].callback(); deliverObservers();
    }
    time = until;
  }
  function drain() {
    deliverObservers(); let count = 0;
    while (timers.size) { if (++count > 1000) throw new Error('drain did not settle'); advance(Math.max(0, Math.min(...[...timers.values()].map(t => t.at)) - time)); }
  }
  function reactRender(container, tree) {
    assert.equal(tree.component, PanelLyrics); renderCount++; log('react-render', { container: container.nodeId, renderCount });
    if (throwRender) throw new Error('fixture render failure');
    if (renderCount <= emptyRenders) return;
    if (!container.querySelector(`.${SECTION}`)) container.appendChild(element('rendered-section', { classes: [SECTION] }));
  }
  const PanelLyrics = function inertPanelLyricsBoundary() { throw new Error('React fixture must not execute the component'); };
  const ReactDOM = {
    render: (tree, container) => reactRender(container, tree),
    unmountComponentAtNode: container => { legacyUnmounts++; log('legacy-unmount', { container: container.nodeId }); for (const child of [...container.children]) child.remove(); }
  };
  if (reactMode === 'modern') ReactDOM.createRoot = container => {
    const root = { container, render: tree => reactRender(container, tree), unmounts: 0, unmount() { this.unmounts++; log('react-unmount', { container: container.nodeId }); for (const child of [...container.children]) child.remove(); } };
    roots.push(root); log('react-createRoot', { container: container.nodeId }); return root;
  };
  const Spicetify = {
    ReactDOM, Player: { data: { item: { uri: 'spotify:track:fixtureA' } } }, Platform: { History: { location: { pathname: '/home' } } },
    LocalStorage: { get: key => storage.get(key) ?? null },
    CosmosAsync: { get: url => new Promise((resolve, reject) => { requests.push({ url, resolve, reject, settled: false }); log('native-request', { url }); }) }
  };
  const moduleState = { panelObserver: null, insertTimer: null };
  const context = vm.createContext({ document, MutationObserver, setTimeout, clearTimeout, Spicetify, moduleState,
    window: { location: { pathname: '/home' } }, localStorage: { getItem: key => storage.get(key) ?? null },
    PanelLyrics, react: { createElement: component => ({ component }) },
    injectStyles: () => { styleCalls++; log('style-boundary'); }, panelDebug: message => log('debug', { message }),
    console: { error: (...args) => log('source-error', { message: args.map(String).join(' ') }) }
  });
  program.runInContext(context);
  const target = context.target;
  target.seedNative(Spicetify.Player.data.item.uri, false);
  const cls = (readable, hashed) => [mapped ? readable : hashed];
  const panel = element('panel', { testId: 'NPV_Panel_OpenDiv' });
  const widget = element('widget', { classes: cls('main-nowPlayingView-nowPlayingWidget', 'pqE5eDSKYuSBxdFtL7LM') });
  const grid = element('grid', { classes: cls('main-nowPlayingView-nowPlayingGrid', 'h7dZG0w8Jk1revePkNbK') });
  const cover = element('cover', { classes: cls('main-nowPlayingView-coverArtContainer', 'dXPcsn9IbcLL88Zvq6iQ') });
  cover.append(element('visual', { testId: 'track-visual-enhancement' })); grid.append(cover); widget.append(grid);
  const aboutArtist = element('aboutArtist', { classes: cls('main-nowPlayingView-section', 'xAHDimZ5EWtt5x3_YMzZ') });
  const queue = element('queue', { classes: cls('main-nowPlayingView-section', 'xAHDimZ5EWtt5x3_YMzZ') }); panel.append(widget, aboutArtist, queue);
  const sidebarParent = element('sidebar-parent'); const sidebar = element('sidebar', { classes: ['Root__right-sidebar'] });
  if (withSidebar) { sidebarParent.append(sidebar); sidebar.append(panel); document.body.append(sidebarParent); } else document.body.append(panel);
  function addHeader({ mapped: headerMapped = mapped } = {}) {
    const info = element('info', { classes: [headerMapped ? 'main-nowPlayingView-contextItemInfo' : 'uR1BMutIFRmR6BBWSAWo'] });
    const minimizedVisual = element('minimizedVisual', { testId: 'minimized-track-visual-enhancement' });
    minimizedVisual.append(element('contextLink')); info.append(minimizedVisual, element('trackInfo'), element('actions')); grid.append(info); return info;
  }
  const info = withHeader ? addHeader() : null;
  const container = () => document.querySelector(`.${PANEL}`);
  const position = (node = container()) => ({ exists: !!node, parent: node?.parentElement?.name || null, previous: node?.previousElementSibling?.name || null, next: node?.nextElementSibling?.name || null, rendered: !!node?.querySelector(`.${SECTION}`) });
  async function resolveNative(index, hasLyrics) {
    const request = requests[index]; assert.ok(request && !request.settled); request.settled = true;
    const waiting = target.pendingNative(); request.resolve({ lyrics: { lines: hasLyrics ? [{ words: 'fixture' }] : [] } });
    await Promise.all(waiting); await Promise.resolve(); deliverObservers();
  }
  function cleanup() {
    target.teardownObserver(); target.clearInsertTimer(); target.removePanelLyrics(); drain();
    assert.equal(timers.size, 0); assert.equal([...observers].filter(o => o.root).length, 0);
    assert.equal(target.snapshot().nativePending, 0); assert.equal(requests.filter(r => !r.settled).length, 0);
    assert.equal(moduleState.panelObserver, null); assert.equal(moduleState.insertTimer, null);
  }
  return { target, document, element, textNode, commentNode, panel, widget, grid, info, aboutArtist, queue, sidebar, sidebarParent, addHeader,
    container, position, deliverObservers, advance, drain, resolveNative, cleanup, roots, requests, trace, storage, moduleState, Spicetify,
    stats: () => ({ time, timers: timers.size, activeObservers: [...observers].filter(o => o.root).length, renderCount, roots: roots.length, legacyUnmounts, styleCalls, nativePending: target.snapshot().nativePending, unresolvedRequests: requests.filter(r => !r.settled).length, moduleObserverCleared: moduleState.panelObserver === null, moduleTimerCleared: moduleState.insertTimer === null, compiledSHA256: extraction.compiledSHA256 }) };
}
