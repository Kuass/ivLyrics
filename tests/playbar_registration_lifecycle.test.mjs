import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const file = process.env.IVLYRICS_PLAYBAR_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_PLAYBAR_SOURCE_DIR, 'PlaybarButton.js')
  : new URL('../PlaybarButton.js', import.meta.url);
const source = readFileSync(file, 'utf8');
const names = ['playbar-button', 'fullscreen-button'];
function harness({ enabled = [], autoVisible = true, retainDom = false, legacy = false, unavailable = false } = {}) {
  const timers = new Map(), widgets = [], styles = new Set(), listeners = [], queries = [], warnings = [], navigation = [], events = [];
  let timerId = 0;
  const hooks = {};
  const history = { location: { pathname: '/home' }, listen(fn) { history.listener = fn; }, push(path) { navigation.push(['push', path]); }, goBack() { navigation.push(['back']); } };
  class Widget {
    constructor(...args) { this.args = args; this.index = widgets.length; this.registered = 0; this.deregistered = 0; this.visible = false; this.classes = new Set(); this.element = { classList: { add: name => this.classes.add(name) } }; widgets.push(this); }
    register() { this.registered++; if (autoVisible) this.visible = true; hooks.register?.(this); }
    deregister() { this.deregistered++; if (!retainDom) this.visible = false; hooks.deregister?.(this); }
  }
  const emit = (name, value) => { for (const listener of [...listeners]) listener({ detail: { name, value } }); };
  const window = {
    I18n: { t: key => key },
    addEventListener(name, callback) { assert.equal(name, 'ivLyrics'); listeners.push(callback); },
    dispatchEvent(event) { events.push(event); },
  };
  vm.runInNewContext(source, {
    window, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    console: { warn: (...args) => warnings.push(args) },
    Spicetify: { Platform: { History: history }, Playbar: unavailable ? {} : legacy ? { Widget } : { Button: Widget }, LocalStorage: { get: key => enabled.includes(key.split(':').at(-1)) ? 'true' : 'false' } },
    document: {
      createElement(type) { assert.equal(type, 'style'); const element = { classes: new Set(), remove() { styles.delete(element); } }; element.classList = { add: name => element.classes.add(name) }; return element; },
      head: { appendChild(element) { styles.add(element); } },
      querySelector(selector) {
        const index = selector.includes('M13.426') ? 0 : 1;
        queries.push(index); const visible = widgets[index].visible; hooks.query?.(widgets[index]); return visible ? {} : null;
      },
      querySelectorAll() { return []; },
    },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const fire = id => { const timer = timers.get(id); assert.ok(timer, `timer ${id}`); timers.delete(id); timer.fn(); };
  const next = delay => { const entry = [...timers].find(([,timer]) => timer.delay === delay); assert.ok(entry, `timer delay ${delay}`); fire(entry[0]); };
  const hasStyle = index => [...styles].some(style => style.classes.has(`ivLyrics:visual:${names[index]}`));
  return { timers, widgets, styles, listeners, queries, warnings, navigation, events, history, hooks, emit, fire, next, hasStyle };
}
for (const [index, name] of names.entries()) {
  test(`${name}: disable cancels pending registration checks`, () => {
    const h = harness({ autoVisible: false }); h.emit(name, true); assert.equal(h.timers.size, 1); h.emit(name, false);
    assert.equal(h.timers.size, 0); assert.equal(h.widgets[index].deregistered, 1); assert.equal(h.hasStyle(index), false);
  });
  test(`${name}: a queued success after disable cannot hide the native control`, () => {
    const h = harness({ retainDom: true }); h.emit(name, true); const callback = [...h.timers.values()][0].fn; h.emit(name, false);
    callback(); assert.equal(h.hasStyle(index), false); assert.equal(h.timers.size, 0); assert.equal(h.queries.length, 0);
  });
  test(`${name}: a retired failure cannot deregister a newer activation`, () => {
    const h = harness({ autoVisible: false }); h.emit(name, true); for (let i = 0; i < 5; i++) h.next(200);
    const stale = [...h.timers.values()][0].fn; h.emit(name, false); h.emit(name, true); stale();
    assert.equal(h.widgets[index].registered, 2); assert.equal(h.widgets[index].deregistered, 1);
    h.widgets[index].visible = true; h.next(200); assert.equal(h.hasStyle(index), true);
  });
  test(`${name}: repeated enable retires the prior verification chain`, () => {
    const h = harness({ autoVisible: false }); h.emit(name, true); const stale = [...h.timers.values()][0].fn; h.emit(name, true);
    stale(); assert.equal(h.timers.size, 1); assert.equal(h.queries.length, 0); assert.equal(h.widgets[index].registered, 2);
  });
  test(`${name}: a current verification keeps the six-attempt fallback behavior`, () => {
    const h = harness({ autoVisible: false }); h.emit(name, true);
    for (let attempt = 0; attempt < 6; attempt++) h.next(200);
    assert.equal(h.queries.length, 6); assert.equal(h.widgets[index].deregistered, 1); assert.equal(h.hasStyle(index), false); assert.equal(h.timers.size, 0);
  });
  test(`${name}: registration that synchronously disables itself leaves no verifier`, () => {
    const h = harness(); h.hooks.register = widget => { if (widget.index === index) h.emit(name, false); }; h.emit(name, true);
    assert.equal(h.timers.size, 0); assert.equal(h.widgets[index].deregistered, 1); assert.equal(h.hasStyle(index), false);
  });
  test(`${name}: cleanup while querying prevents stale style installation`, () => {
    const h = harness(); h.emit(name, true); h.hooks.query = widget => { if (widget.index === index) h.emit(name, false); }; h.next(200);
    assert.equal(h.hasStyle(index), false); assert.equal(h.timers.size, 0);
  });
  test(`${name}: active success installs and disable removes only its style`, () => {
    const h = harness(); h.emit(name, true); h.next(200); assert.equal(h.hasStyle(index), true);
    h.emit(name, false); assert.equal(h.hasStyle(index), false); assert.equal(h.widgets[index].deregistered, 1);
  });
}
test('fullscreen disable retires the delayed positioning callback', () => {
  const h = harness(); h.emit('fullscreen-button', true); h.next(200); const late = [...h.timers.values()][0].fn;
  h.emit('fullscreen-button', false); late(); assert.equal(h.timers.size, 0); assert.equal(h.widgets[1].classes.has('ivlyrics-fullscreen-btn'), false);
});
test('active fullscreen positioning retains its unique class', () => {
  const h = harness(); h.emit('fullscreen-button', true); h.next(200); h.next(100);
  assert.equal(h.widgets[1].classes.has('ivlyrics-fullscreen-btn'), true); assert.equal(h.hasStyle(1), true);
});
test('lyrics and fullscreen verification ownership is independent', () => {
  const h = harness(); h.emit('playbar-button', true); h.emit('fullscreen-button', true); h.emit('playbar-button', false);
  assert.equal(h.timers.size, 1); h.next(200); h.next(100);
  assert.equal(h.hasStyle(0), false); assert.equal(h.hasStyle(1), true); assert.equal(h.widgets[1].deregistered, 0);
});
test('saved preferences and Widget fallback keep both buttons and click actions', () => {
  const h = harness({ enabled: names, legacy: true }); h.next(200); h.next(200); h.next(100);
  assert.equal(h.styles.size, 2); assert.equal(h.widgets[0].args[0], 'playbarButton.label'); assert.equal(h.widgets[1].args.at(-1), true);
  h.widgets[0].args[2](); h.history.location.pathname = '/ivLyrics'; h.widgets[0].args[2](); h.widgets[1].args[2]();
  assert.deepEqual(h.navigation, [['push', '/ivLyrics'], ['back']]); assert.equal(h.events[0].detail.type, 'fullscreen-toggle');
  h.history.listener({ pathname: '/ivLyrics' }); assert.equal(h.widgets[0].active, true);
});
test('missing playbar API leaves native controls and no timers', () => {
  const h = harness({ unavailable: true, enabled: names }); assert.equal(h.widgets.length, 0); assert.equal(h.styles.size, 0); assert.equal(h.timers.size, 0);
});
for (const [index, name] of names.entries()) {
  test(`${name}: failed re-registration restores the native control after an earlier success`, () => {
    const h = harness(); h.emit(name, true); h.next(200); if (index === 1) h.next(100);
    assert.equal(h.hasStyle(index), true);
    h.hooks.register = widget => { if (widget.index === index) widget.visible = false; };
    h.emit(name, true); for (let attempt = 0; attempt < 6; attempt++) h.next(200);
    assert.equal(h.hasStyle(index), false); assert.equal(h.widgets[index].deregistered, 1); assert.equal(h.timers.size, 0);
  });
}
