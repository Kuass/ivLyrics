import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// Execute the actual checkout's complete openConfig and its two motion helpers.
// This is an inert DOM/renderer/timer model. ConfigModal and the close button are
// not rendered; no real React, browser focus reset, or application cleanup is modeled.
const settings = fs.readFileSync(new URL('../../Settings.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const from = settings.indexOf(start);
  assert(from >= 0 && settings.indexOf(start, from + start.length) === -1, `Unique source start: ${start}`);
  const to = settings.indexOf(end, from + start.length);
  assert(to > from, `Source end: ${end}`);
  return settings.slice(from, to);
};
const source = section('function openConfig(', '\nfunction queueReloadIntoIvLyrics(');
const helpers = section('const getEffectiveReducedMotionPreference =', 'const getSettingsText =');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const extraction = {
  settingsSha256: hash(settings), openConfigSha256: hash(source), motionHelpersSha256: hash(helpers)
};

const STAGES = ['overlay.remove', 'html.visibility', 'body.visibility', 'visibility.dispatchMethod', 'main.removeListener', 'handle.clear', 'focus.contains', 'focus.restore'];
let totalOpens = 0;
let totalCallbacks = 0;

export function runSettingsOverlayScenario(spec) {
  const checks = [], trace = [], errors = [], visibility = [], renders = [], timers = new Map(), rafs = [];
  const unmountError = new Error(`injected-unmount:${spec.id}`);
  const stageError = new Error(`injected-stage:${spec.id}:${spec.fault}`);
  let now = 0, nextTimer = 1, closePhase = false, faultsEnabled = true, unmountCount = 0, focusRestoreCount = 0, globalHandle = null, frameCount = 0;
  let overlay, shell, mainListener, savedClose;
  const foreignHandle = () => { throw new Error('Foreign handle must never be called'); };
  const check = (name, actual, expected) => checks.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  const stage = (name) => {
    if (!closePhase) return;
    trace.push(name);
    if (faultsEnabled && spec.fault === name) throw stageError;
  };
  const classifyError = (e, origin) => ({ identity: e === unmountError ? 'same-unmount-object' : e === stageError ? 'same-stage-object' : 'unexpected', origin, message: e.message });
  const invoke = (fn, origin, ...args) => {
    assert(++totalCallbacks <= 1500, 'fixed callback bound');
    try { return fn(...args); } catch (e) { errors.push(classifyError(e, origin)); }
  };
  class Events {
    constructor() { this.listeners = []; }
    addEventListener(type, fn, capture = false) {
      if (!this.listeners.some(x => x.type === type && x.fn === fn && x.capture === !!capture)) this.listeners.push({type, fn, capture: !!capture});
    }
    removeEventListener(type, fn, capture = false) {
      if (fn === mainListener && type === 'keydown') stage('main.removeListener');
      this.listeners = this.listeners.filter(x => !(x.type === type && x.fn === fn && x.capture === !!capture));
    }
    emit(event) {
      event.preventDefault = () => { event.defaultPrevented = true; };
      event.stopPropagation = () => { event.propagationStopped = true; };
      event.stopImmediatePropagation = () => { event.immediateStopped = true; };
      for (const x of [...this.listeners]) {
        if (x.type !== event.type || !this.listeners.includes(x)) continue;
        invoke(x.fn, 'native-like-listener-report', event);
        if (event.immediateStopped) break;
      }
      return !event.defaultPrevented;
    }
  }
  class Element extends Events {
    constructor(tag) {
      super(); this.tag = tag; this.parentNode = null; this.children = []; this.attrs = {}; this.classes = new Set(); this.id = ''; this.hidden = false;
      this.classList = {
        add: (...xs) => xs.forEach(x => this.classes.add(x)),
        remove: (...xs) => xs.forEach(x => this.classes.delete(x)),
        contains: x => this.classes.has(x),
        toggle: (x, force) => {
          if (x === 'ivlyrics-settings-open' && force === false) stage(this === doc.documentElement ? 'html.visibility' : 'body.visibility');
          const next = force === undefined ? !this.classes.has(x) : force;
          next ? this.classes.add(x) : this.classes.delete(x); return next;
        }
      };
    }
    set className(s) { this.classes = new Set(s.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.children.push(child); return child; }
    // Native activeElement reset after removal is intentionally not modeled.
    removeChild(child) { this.children = this.children.filter(x => x !== child); child.parentNode = null; return child; }
    remove() { if (this === overlay) stage('overlay.remove'); this.parentNode?.removeChild(this); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return null; }
    focus() {
      if (this === previous && closePhase) { stage('focus.restore'); focusRestoreCount++; }
      // Explicit inert focus contract: detached nodes ignore focus requests.
      if (contains(this)) doc.activeElement = this;
    }
  }
  const doc = {
    documentElement: new Element('html'), body: new Element('body'), activeElement: null,
    createElement: tag => new Element(tag),
    getElementById: id => walk(doc.documentElement).find(x => x.id === id) ?? null,
    contains: node => { if (node === previous) stage('focus.contains'); return contains(node); }
  };
  const walk = node => [node, ...node.children.flatMap(walk)];
  const contains = node => walk(doc.documentElement).includes(node);
  doc.documentElement.appendChild(doc.body);
  const previous = new Element('button'); doc.body.appendChild(previous); doc.activeElement = previous;
  const win = new Events();
  Object.defineProperty(win, 'ivLyricsCloseConfig', {
    get: () => globalHandle,
    set: value => { if (value === null) stage('handle.clear'); globalHandle = value; }
  });
  win.dispatchEvent = event => {
    if (event.type === 'ivLyrics:settings-visibility') {
      if (event.detail.open === false) stage('visibility.dispatchMethod');
      visibility.push(event.detail.open);
    }
    return win.emit(event);
  };
  win.setTimeout = (fn, delay) => { assert(timers.size < 8); const id = nextTimer++; timers.set(id, {fn, at: now + delay, delay}); return id; };
  win.clearTimeout = id => timers.delete(id);
  win.requestAnimationFrame = fn => { assert(rafs.length < 4); rafs.push(fn); return rafs.length; };
  const drainFrames = () => { while (rafs.length) { assert(++frameCount <= 4); invoke(rafs.shift(), 'entry-animation-frame', now); } };
  const advance = target => {
    assert(target >= now && target <= 2000);
    for (;;) {
      const next = [...timers].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; invoke(next[1].fn, `timer:${next[1].delay}ms`);
    }
    now = target;
  };
  const ConfigModal = () => { throw new Error('Full ConfigModal must not execute'); };
  const renderer = {
    render: (element, container) => { assert.equal(element.type, ConfigModal); assert.equal(typeof element.props.onRequestClose, 'function'); renders.push({element, container}); },
    unmountComponentAtNode: container => {
      assert.equal(container, shell); unmountCount++; trace.push('unmount');
      if (faultsEnabled && spec.unmountThrows) throw unmountError;
      return spec.unmount === 'false' ? false : true;
    }
  };
  if (spec.unmount === 'absent') delete renderer.unmountComponentAtNode;
  win.ivLyricsEnsureReactDOM = () => spec.noRenderer ? null : renderer;
  const context = vm.createContext({window: win, document: doc, HTMLElement: Element, CONFIG: {visual: {'reduce-motion': !!spec.reduced}}, react: {createElement: (type, props) => ({type, props})}, ConfigModal, CustomEvent: class {constructor(type, init) { this.type = type; this.detail = init.detail; }}}, {codeGeneration: {strings: false, wasm: false}});
  vm.runInContext(`${helpers}\n${source}\nthis.runOpen = openConfig; this.readMotion = () => [getEffectiveReducedMotionPreference(), getSettingsMotionDurationMs()];`, context, {timeout: 1000});
  check('exact motion helpers', Array.from(context.readMotion()), spec.reduced ? [true, 24] : [false, 280]);
  const open = () => { assert(++totalOpens <= 180); closePhase = false; invoke(context.runOpen, 'open-caller'); closePhase = true; };
  open();
  if (spec.noRenderer) {
    check('renderer admission', {renders: renders.length, attached: !!doc.getElementById('ivLyrics-settings-overlay'), listeners: win.listeners.length, visibility, frames: rafs.length, handle: globalHandle}, {renders: 0, attached: false, listeners: 0, visibility: [], frames: 0, handle: null});
    return {id: spec.id, checks, trace, errors, allErrors: errors};
  }
  overlay = doc.getElementById('ivLyrics-settings-overlay'); shell = renders[0].container; mainListener = win.listeners.find(x => x.type === 'keydown').fn; savedClose = renders[0].element.props.onRequestClose;
  const snapshot = () => ({overlayAttached: contains(overlay), htmlOpen: doc.documentElement.classes.has('ivlyrics-settings-open'), bodyOpen: doc.body.classes.has('ivlyrics-settings-open'), visibility: [...visibility], mainListener: win.listeners.filter(x => x.fn === mainListener).length, guardKeydown: win.listeners.filter(x => x.type === 'keydown' && x.fn !== mainListener).length, guardKeyup: win.listeners.filter(x => x.type === 'keyup').length, handle: globalHandle === savedClose ? 'owned' : globalHandle === foreignHandle ? 'foreign' : globalHandle === null ? 'null' : 'new', active: doc.activeElement === previous ? 'previous' : doc.activeElement === shell ? 'shell' : 'other', unmountCount, focusRestoreCount});
  check('render props and close handle', {initialTab: renders[0].element.props.initialTab, initialSettingKey: renders[0].element.props.initialSettingKey, handleIsCaptured: globalHandle === savedClose, shellParent: shell.parentNode === overlay}, {initialTab: 'general', initialSettingKey: null, handleIsCaptured: true, shellParent: true});
  check('ordinary admitted open state', snapshot(), {overlayAttached: true, htmlOpen: true, bodyOpen: true, visibility: [true], mainListener: 1, guardKeydown: 0, guardKeyup: 0, handle: 'owned', active: 'previous', unmountCount: 0, focusRestoreCount: 0});
  check('reduced class matches exact helper', overlay.classes.has('motion-reduced'), !!spec.reduced);
  const openSnapshot = snapshot(); open();
  check('double open refuses second overlay', {renders: renders.length, state: snapshot(), frames: rafs.length}, {renders: 1, state: openSnapshot, frames: 1});
  if (!spec.quick) drainFrames();
  if (spec.detachedFocus) doc.body.removeChild(previous);
  if (spec.foreignHandle) win.ivLyricsCloseConfig = foreignHandle;
  trace.length = 0;
  const beforeClose = snapshot();
  if (spec.route === 'backdrop') {
    overlay.emit({type: 'click', target: shell});
    check('backdrop child ignored', {state: snapshot(), timers: timers.size}, {state: beforeClose, timers: 0});
    overlay.emit({type: 'click', target: overlay});
  } else if (spec.route === 'escape') {
    const event = {type: 'keydown', key: 'Escape', target: shell};
    win.emit(event);
    check('normal Escape consumed', [event.defaultPrevented, event.propagationStopped, event.immediateStopped], [true, true, true]);
  } else {
    const arg = spec.route === 'immediate' ? true : spec.route === 'truthy' ? 'true' : {type: 'click', target: shell};
    invoke(savedClose, 'captured-close-caller', arg);
  }
  const delayed = !spec.reduced && spec.route !== 'immediate' && spec.route !== 'escape';
  check('closing class transition', [overlay.classes.has('is-open'), overlay.classes.has('is-entering'), overlay.classes.has('is-closing')], [false, false, true]);
  if (delayed) {
    check('normal timer is exactly 280ms', [...timers.values()].map(x => x.delay), [280]);
    const pendingSnapshot = snapshot();
    invoke(savedClose, 'pending-close-repeat', true);
    check('pending close cannot accelerate', {state: snapshot(), trace: [...trace], errors: [...errors]}, {state: pendingSnapshot, trace: [], errors: []});
    advance(279);
    check('no finalization before 280ms', {state: snapshot(), trace: [...trace]}, {state: pendingSnapshot, trace: []});
    advance(280);
  } else {
    check('immediate or reduced bypasses close timer', [...timers.values()].map(x => x.delay), spec.route === 'escape' ? [1500] : []);
  }
  // Desired oracle: cleanup is entered after optional unmount regardless of its result.
  // A later operation fault stops at that stage and overrides a prior unmount error.
  const stages = STAGES.filter(x => !(x === 'handle.clear' && spec.foreignHandle) && !(x === 'focus.restore' && spec.detachedFocus));
  const failedAt = spec.fault ? stages.indexOf(spec.fault) : -1;
  assert(!spec.fault || failedAt >= 0);
  const attemptedStages = failedAt < 0 ? stages : stages.slice(0, failedAt + 1);
  const completed = new Set(failedAt < 0 ? stages : stages.slice(0, failedAt));
  const expectedTrace = [...(spec.unmount === 'absent' ? [] : ['unmount']), ...attemptedStages];
  const expectedState = {
    overlayAttached: !completed.has('overlay.remove'), htmlOpen: !completed.has('html.visibility'), bodyOpen: !completed.has('body.visibility'), visibility: completed.has('visibility.dispatchMethod') ? [true, false] : [true], mainListener: completed.has('main.removeListener') ? 0 : 1,
    guardKeydown: spec.route === 'escape' ? 1 : 0, guardKeyup: spec.route === 'escape' ? 1 : 0,
    handle: spec.foreignHandle ? 'foreign' : completed.has('handle.clear') ? 'null' : 'owned', active: completed.has('focus.restore') ? 'previous' : beforeClose.active,
    unmountCount: spec.unmount === 'absent' ? 0 : 1, focusRestoreCount: completed.has('focus.restore') ? 1 : 0
  };
  const expectedError = spec.fault ? 'same-stage-object' : spec.unmountThrows ? 'same-unmount-object' : null;
  const expectedOrigin = delayed ? 'timer:280ms' : spec.route === 'escape' ? 'native-like-listener-report' : 'captured-close-caller';
  check('sequential cleanup ordering and short circuit', [...trace], expectedTrace);
  check('conditional cleanup state', snapshot(), expectedState);
  check('exception identity and channel', errors.map(({identity, origin}) => ({identity, origin})), expectedError ? [{identity: expectedError, origin: expectedOrigin}] : []);
  // Repeat calls must preserve the observed state, even when the desired cleanup failed.
  const finalizedSnapshot = snapshot(), finalizedTrace = [...trace], finalizedErrors = [...errors];
  invoke(savedClose, 'saved-close-after-finalization', true);
  invoke(savedClose, 'saved-close-after-finalization-click', {type: 'click'});
  check('repeated close remains inert after finalization', {state: snapshot(), trace: [...trace], errors: [...errors]}, {state: finalizedSnapshot, trace: finalizedTrace, errors: finalizedErrors});
  if (spec.quick) {
    const pendingFrames = rafs.length; drainFrames();
    check('entry RAF stays queued until explicitly drained', pendingFrames, 1);
    check('detached entry RAF has no modeled connected focus effect', snapshot(), expectedState);
    check('uncancelled RAF still changes detached classes', [overlay.classes.has('is-open'), overlay.classes.has('is-closing')], [true, true]);
  }
  if (spec.route === 'escape') {
    if (spec.release === 'keyup') {
      const release = {type: 'keyup', key: 'Escape', target: shell}; win.emit(release);
      check('natural keyup guard consumes Escape', [release.defaultPrevented, release.immediateStopped], [true, true]);
    } else {
      advance(1499);
      check('guard persists before fallback', [snapshot().guardKeydown, snapshot().guardKeyup], [1, 1]);
      advance(1500);
    }
    check('only separate Escape guard is naturally removed', {keydown: snapshot().guardKeydown, keyup: snapshot().guardKeyup, timers: timers.size}, {keydown: 0, keyup: 0, timers: 0});
  }
  const finalBeforeReopen = snapshot();
  let reopening = null;
  if (!spec.fault) {
    faultsEnabled = false;
    const renderedBefore = renders.length; open();
    const didReopen = renders.length === renderedBefore + 1;
    check('reopening admitted after cleanup', didReopen, true);
    if (didReopen) {
      const newClose = renders.at(-1).element.props.onRequestClose;
      overlay = doc.getElementById('ivLyrics-settings-overlay'); shell = renders.at(-1).container;
      const newMain = win.listeners.find(x => x.fn.name === 'handleModalKeydown').fn;
      const captureNew = () => ({attached: contains(overlay), handle: globalHandle === newClose, listeners: win.listeners.length, visibility: [...visibility], renders: renders.length, timers: timers.size, trace: [...trace]});
      const newSnapshot = captureNew(); invoke(savedClose, 'old-close-after-reopen', true);
      check('saved old close cannot affect reopened overlay', {status: 'observed', unchanged: JSON.stringify(captureNew()) === JSON.stringify(newSnapshot)}, {status: 'observed', unchanged: true});
      drainFrames(); mainListener = newMain;
      invoke(newClose, 'reopened-close-caller', true);
      reopening = {admitted: true, closed: !doc.getElementById('ivLyrics-settings-overlay'), handleCleared: globalHandle === null, mainRemoved: !win.listeners.some(x => x.fn === newMain), timers: timers.size};
      check('reopened instance closes normally', {status: 'observed', ...reopening}, {status: 'observed', admitted: true, closed: true, handleCleared: true, mainRemoved: true, timers: 0});
    } else {
      reopening = {admitted: false, oldCloseControl: 'not-reached', newCloseControl: 'not-reached', reason: 'No new render capture; existing-overlay admission blocked reopening'};
      check('saved old close cannot affect reopened overlay', {status: 'not-reached', unchanged: null}, {status: 'observed', unchanged: true});
      check('reopened instance closes normally', {status: 'not-reached', admitted: false}, {status: 'observed', admitted: true, closed: true, handleCleared: true, mainRemoved: true, timers: 0});
    }
  }
  return {id: spec.id, checks, firstCloseTrace: finalizedTrace, firstCloseErrors: finalizedErrors, firstCloseState: finalizedSnapshot, finalBeforeReopen, reopening, allTrace: trace, allErrors: errors};
}

export function completeScenario(result) {
  const unexpected = result.allErrors.filter(error => error.identity === 'unexpected');
  result.checks.push({ name: 'no unexpected exception identities across entire scenario', pass: unexpected.length === 0, actual: unexpected, expected: [] });
  return result;
}

export const callbackCounts = () => ({ totalOpens, totalCallbacks });
