import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

// Execute exact slices of current Settings.js. No alternate implementation or
// source-dependent expected values are used. The rest of Settings never runs.
const settings = fs.readFileSync(new URL('../../Settings.js', import.meta.url), 'utf8');
const spans = [];
function section(name, start, end) {
  const from = settings.indexOf(start);
  assert.ok(from >= 0 && settings.indexOf(start, from + start.length) < 0, `Unique ${name} start`);
  const until = settings.indexOf(end, from + start.length);
  assert.ok(until > from, `Missing ${name} end`);
  const text = settings.slice(from, until);
  spans.push({ name, from, until, sha256: crypto.createHash('sha256').update(text).digest('hex') });
  return text;
}
const buttonSource = section('ButtonSVG', 'const ButtonSVG = react.memo(', 'function buildOrderedProviderList(');
const sliderSource = section('ConfigSlider', 'const ConfigSlider = react.memo(', 'const ConfigSliderRange =');
const optionSource = section('OptionList', 'const OptionList = ({ type, items, onChange }) => {', 'const getEffectiveReducedMotionPreference =');
const dispatchSource = section('dispatchVisualUpdate', '    const dispatchVisualUpdate = (name, value) => {', '    const applyMode =');
const callbackSource = section('handleVisualChange', '    const handleVisualChange = (name, value) => {', '    react.useEffect(() => {');
const callerSource = section('NoiseCaller', '      react.createElement(OptionList, {\n        items: [\n          {\n            desc: I18n.t("settings.alignment.label"),', '      modeSpecificItems.length > 0 &&');
const inert = ['ConfigButton', 'ConfigInput', 'ConfigHotkey', 'ConfigWarning', 'ConfigInfo', 'ConfigKeyList', 'ConfigFontSelector', 'ConfigInstrumentalBreakIconPicker', 'ConfigKaraokeFillCurveEditor', 'VideoHelperToggle', 'LyricsHelperToggle', 'ConfigSelection'];
const source = "'use strict';\n" + inert.map(name => `const ${name} = () => { throw new Error('Uninvoked placeholder: ${name}'); };`).join('\n') + '\n'
  + buttonSource + sliderSource + optionSource + dispatchSource + callbackSource
  + '\nfunction makeCaller(isFadActive) { return [\n' + callerSource + '][0]; }\n({ ConfigSlider, ButtonSVG, OptionList, makeCaller });\n';
export const extraction = {
  settingsSha256: crypto.createHash('sha256').update(settings).digest('hex'),
  programSha256: crypto.createHash('sha256').update(source).digest('hex'), spans,
};
const json = value => JSON.parse(JSON.stringify(value, (_, x) => x === undefined ? '<undefined>' : typeof x === 'function' ? `<function:${x.name || 'anonymous'}>` : x));

// Deterministic hook adapter: setters queue; evaluate/commit/render/passive are
// separate explicit steps. Repeated evaluation, rebasing, discarded queues and
// error continuation are synthetic schedules, not native React lifecycle claims.
export function runConfigSliderCase(spec) {
  let sequence = 0, phase = 'setup', activeFiber = null, hookIndex = 0;
  let callbackId = 'A', throwAt = spec.throwAt ?? null, generation = 0;
  let optionElement, sliderElement, button, lastEvaluation = null;
  const trace = [], observations = [], errors = [], checks = [], callbacks = [], saves = [], dispatches = [];
  const sentinel = Object.freeze({ diagnosticError: spec.id, boundary: spec.throwAt });
  const emit = (kind, data = {}) => trace.push({ sequence: ++sequence, phase, kind, ...json(data) });
  const fibers = new Map();
  const listeners = { window: new Map(), document: new Map() };
  const equalDeps = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const getFiber = name => fibers.get(name);
  const fiber = name => { const f = { name, generation, hooks: [], queue: [], effects: [] }; fibers.set(name, f); return f; };
  function hook(kind, create) {
    if (!activeFiber) throw new Error('Hook outside explicit render');
    const i = hookIndex++;
    let h = activeFiber.hooks[i];
    if (!h) activeFiber.hooks[i] = h = { kind, ...create() };
    if (h.kind !== kind) throw new Error('Hook order mismatch');
    return [h, i, activeFiber];
  }
  const useState = initial => {
    const [h, i, f] = hook('state', () => ({ value: typeof initial === 'function' ? initial() : initial }));
    if (!h.setter) h.setter = update => {
      const q = { id: `${f.name}:${f.generation}:${++f.nextUpdate}`, slot: i, update };
      f.queue.push(q);
      emit('enqueue', { fiber: f.name, id: q.id, slot: i, updateType: typeof update === 'function' ? 'functional' : 'value', value: typeof update === 'function' ? '<function>' : update });
    };
    if (!f.nextUpdate) f.nextUpdate = 0;
    return [h.value, h.setter];
  };
  const useRef = initial => hook('ref', () => ({ object: { current: initial } }))[0].object;
  const useCallback = (callback, deps) => {
    const [h] = hook('callback', () => ({ deps: null }));
    if (!equalDeps(h.deps, deps)) { h.value = callback; h.deps = deps; }
    return h.value;
  };
  const useEffect = (effect, deps) => {
    const [h, slot, f] = hook('effect', () => ({ deps: null, cleanup: null }));
    if (!equalDeps(h.deps, deps)) {
      h.deps = deps;
      f.effects.push({ slot, effect });
      emit('passive-scheduled', { fiber: f.name, slot });
    }
  };
  const react = {
    memo: component => component,
    createElement(type, props, ...children) {
      const p = { ...props };
      const key = p.key == null ? null : String(p.key);
      delete p.key; // Element's reserved-key contract; source's spread/key remains intact.
      return { type, key, props: { ...p, children } };
    }, useState, useRef, useCallback, useEffect,
  };
  const CONFIG = { visual: new Proxy({ noise: spec.initial ?? false }, {
    set(target, key, value) { emit('config-write', { key, value }); target[key] = value; return true; },
  }) };
  const target = name => ({
    addEventListener(type, fn) {
      if (!listeners[name].has(type)) listeners[name].set(type, new Set());
      listeners[name].get(type).add(fn); emit('listen', { target: name, type });
    },
    removeEventListener(type, fn) { listeners[name].get(type)?.delete(fn); emit('unlisten', { target: name, type }); },
    dispatchEvent(event) {
      const entry = { type: event.type, detail: json(event.detail), delivered: false };
      dispatches.push(entry); emit('dispatch-attempt', entry);
      if (throwAt === 'dispatch') { emit('injected-throw', { boundary: 'dispatch' }); throw sentinel; }
      for (const fn of listeners[name].get(event.type) ?? []) fn(event);
      entry.delivered = true; emit('dispatch-success', entry); return true;
    },
  });
  const context = vm.createContext({ react, useState, useRef, useCallback, useEffect, CONFIG,
    StorageManager: { saveConfig(name, value) {
      const entry = { name, value, completed: false }; saves.push(entry); emit('save-attempt', entry);
      if (throwAt === 'storage') { emit('injected-throw', { boundary: 'storage' }); throw sentinel; }
      entry.completed = true; emit('save-success', entry);
    } },
    window: target('window'), document: target('document'),
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    Spicetify: { SVGIcons: { check: '<inert-check-icon>' } },
    I18n: { t: key => { emit('label-lookup', { key }); return key; } },
    lyricContainerUpdate: null,
    syncSettingsLyricsPreviewStyles: () => { throw new Error('Forbidden alignment branch'); },
  }, { codeGeneration: { strings: false, wasm: false } });
  const api = new vm.Script(source, { filename: 'actual-settings-slider.js' }).runInContext(context, { timeout: 1000 });
  const wrappers = new Map();
  function observedCallback(id, original) {
    if (!wrappers.has(id)) wrappers.set(id, (name, value) => {
      callbacks.push({ id, name, value });
      const slider = getFiber('ConfigSlider');
      const ref = slider?.hooks.find(h => h.kind === 'ref');
      emit('callback', { id, name, value, active: slider?.hooks[0]?.value,
        ref: ref ? ref.object.current : '<absent>',
        pending: slider?.queue.map(q => ({ updateType: typeof q.update === 'function' ? 'functional' : 'value', value: typeof q.update === 'function' ? '<function>' : q.update })) ?? [] });
      if (throwAt === 'callback') { emit('injected-throw', { boundary: 'callback' }); throw sentinel; }
      return original(name, value);
    });
    return wrappers.get(id);
  }
  function render(name, fn, props) {
    const f = getFiber(name) ?? fiber(name);
    const previous = activeFiber; activeFiber = f; hookIndex = 0;
    emit('render-start', { fiber: name });
    try { return fn(props); } finally { activeFiber = previous; emit('render-end', { fiber: name }); }
  }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of node.props?.children ?? []) { const match = find(child, predicate); if (match) return match; }
    return null;
  }
  function renderOptionAndSlider() {
    const props = { ...optionElement.props, onChange: observedCallback(callbackId, optionElement.props.onChange) };
    const tree = render('OptionList', api.OptionList, props);
    sliderElement = find(tree, x => x.type === api.ConfigSlider && x.key === 'noise');
    if (!sliderElement) throw new Error('Missing exact owned keyed Noise child');
    renderSlider();
  }
  function renderSlider() {
    const svg = render('ConfigSlider', api.ConfigSlider, sliderElement.props);
    if (svg.type !== api.ButtonSVG) throw new Error('ButtonSVG path mismatch');
    button = render('ButtonSVG', api.ButtonSVG, svg.props);
    if (button.type !== 'button') throw new Error('Native button descriptor missing');
  }
  function flushPassive() {
    for (const f of fibers.values()) {
      const pending = f.effects.splice(0);
      for (const e of pending) {
        emit('passive-start', { fiber: f.name, slot: e.slot });
        f.hooks[e.slot].cleanup?.();
        f.hooks[e.slot].cleanup = e.effect();
        emit('passive-end', { fiber: f.name, slot: e.slot });
      }
    }
  }
  function evaluate(name, override) {
    const f = getFiber(name);
    const states = f.hooks.map(h => h.kind === 'state' ? h.value : undefined);
    if (override !== undefined) states[0] = override;
    const entries = [...f.queue], result = { name, entries, states, complete: false };
    lastEvaluation = result;
    emit('evaluation-start', { fiber: name, override, pending: entries.map(x => x.id), prior: states });
    for (const q of entries) {
      const prior = states[q.slot];
      emit('updater-evaluate', { id: q.id, prior, updateType: typeof q.update === 'function' ? 'functional' : 'value' });
      states[q.slot] = typeof q.update === 'function' ? q.update(prior) : q.update;
      emit('updater-result', { id: q.id, value: states[q.slot] });
    }
    result.complete = true; emit('evaluation-end', { fiber: name, result: states });
  }
  function commitAvailable() {
    const result = lastEvaluation;
    if (!result?.complete) { emit('commit-unavailable'); return; }
    const f = getFiber(result.name);
    result.states.forEach((value, i) => { if (f.hooks[i]?.kind === 'state') f.hooks[i].value = value; });
    const ids = new Set(result.entries.map(x => x.id));
    f.queue = f.queue.filter(x => !ids.has(x.id));
    emit('commit', { fiber: result.name, ids: [...ids], states: result.states }); lastEvaluation = null;
  }
  function mount() {
    optionElement = api.makeCaller(spec.disabled ?? false);
    if (optionElement.type !== api.OptionList) throw new Error('Caller target mismatch');
    renderOptionAndSlider();
  }
  function unmount() {
    for (const f of fibers.values()) {
      for (const h of f.hooks) if (h.kind === 'effect') h.cleanup?.();
      emit('unmount', { fiber: f.name, droppedQueue: f.queue.map(q => q.id), droppedEffects: f.effects.length });
    }
    fibers.clear(); lastEvaluation = null; generation++;
  }
  function snapshot(label) {
    const f = getFiber('ConfigSlider');
    const ref = f?.hooks.find(h => h.kind === 'ref');
    const item = {
      label, sequence, active: f?.hooks[0]?.value, displayedActive: button?.props['aria-checked'],
      ref: ref ? ref.object.current : '<absent>', configNoise: CONFIG.visual.noise,
      defaultProp: sliderElement?.props.defaultValue, disabledProp: sliderElement?.props.disabled,
      nativeDisabled: button?.props.disabled, noiseChildKey: sliderElement?.key,
      callbackValues: callbacks.map(x => x.value), callbackIds: callbacks.map(x => x.id),
      callbackNames: callbacks.map(x => x.name), saveValues: saves.map(x => x.value),
      saveNames: saves.map(x => x.name), dispatchNames: dispatches.map(x => x.detail.name),
      dispatchTypes: dispatches.map(x => x.detail.type),
      saveCompleted: saves.filter(x => x.completed).length,
      dispatchValues: dispatches.map(x => x.detail.value), dispatchDelivered: dispatches.filter(x => x.delivered).length,
      callbacks: callbacks.length, saves: saves.length, dispatches: dispatches.length,
      pendingSliderCount: f?.queue.length ?? 0,
      queues: Object.fromEntries([...fibers].map(([name, x]) => [name, x.queue.map(q => ({ id: q.id, slot: q.slot, updateType: typeof q.update === 'function' ? 'functional' : 'value', value: typeof q.update === 'function' ? '<function>' : q.update }))])),
      pendingEffects: Object.fromEntries([...fibers].map(([name, x]) => [name, x.effects.map(e => e.slot)])),
      lastEvaluation: lastEvaluation && { complete: lastEvaluation.complete, states: lastEvaluation.states, entries: lastEvaluation.entries.map(q => q.id) },
      errorCount: errors.length, errors: json(errors), listenerCounts: Object.fromEntries(Object.entries(listeners).map(([name, types]) => [name, [...types].reduce((sum, [,set]) => sum + set.size, 0)])),
    };
    observations.push(json(item)); return item;
  }
  function assertFields(actual, expected, category, label) {
    for (const [field, value] of Object.entries(expected)) checks.push({ category, label, field, expected: value, actual: json(actual[field]), pass: JSON.stringify(json(actual[field])) === JSON.stringify(value) });
  }
  function step(op, i) {
    phase = `${i}:${op.op}`; emit('step', op);
    try {
      switch (op.op) {
        case 'mount': mount(); break;
        case 'render': renderOptionAndSlider(); break;
        case 'renderSlider': renderSlider(); break;
        case 'passive': flushPassive(); break;
        case 'evaluate': evaluate(op.fiber ?? 'ConfigSlider', op.prior); break;
        case 'commit': commitAvailable(); break;
        case 'discard': emit('discard', { result: lastEvaluation?.states }); lastEvaluation = null; break;
        case 'click':
          if (button.props.disabled && !op.forced) emit('native-disabled-suppression');
          else { emit('handler-start', { forced: !!op.forced }); button.props.onClick(); emit('handler-end'); }
          break;
        case 'optionCallback': sliderElement.props.onChange(op.value); break;
        case 'default': CONFIG.visual.noise = op.value; break;
        case 'callback': callbackId = op.id; break;
        case 'throw': throwAt = op.at; break;
        case 'unmount': unmount(); break;
        case 'snapshot': { const s = snapshot(op.label); assertFields(s, op.expect ?? {}, 'compatibility', op.label); assertFields(s, op.desired ?? {}, 'desired-event-boundary', op.label); break; }
        default: throw new Error(`Unknown operation: ${op.op}`);
      }
    } catch (error) {
      const record = { operation: op.op, phase, primaryIdentity: error === sentinel, errorId: error === sentinel ? spec.id : '<unexpected>', message: error === sentinel ? null : String(error) };
      errors.push(record); emit('caught', record);
      if (error !== sentinel) throw error;
    }
  }
  spec.steps.forEach(step);
  const final = snapshot('final');
  assertFields(final, spec.expect ?? {}, 'compatibility', 'final');
  assertFields(final, spec.desired ?? {}, 'desired-event-boundary', 'final');
  if (spec.throwAt) checks.push({ category: 'boundary-invariant', field: 'exactPrimaryIdentity', expected: true, actual: errors.length === 1 && errors[0].primaryIdentity, pass: errors.length === 1 && errors[0].primaryIdentity });
  return { id: spec.id, class: spec.class, steps: spec.steps, trace, observations, checks, errors, callbacks, saves, dispatches };
}
