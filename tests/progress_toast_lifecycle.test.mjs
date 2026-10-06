import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const file = process.env.IVLYRICS_TOAST_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_TOAST_SOURCE_DIR, 'Utils.js')
  : new URL('../Utils.js', import.meta.url);
const source = readFileSync(file, 'utf8');
const start = source.indexOf('const Toast = {');
const end = source.indexOf('\nwindow.Toast = Toast;', start);
assert.ok(start >= 0 && end > start);
class Element {
  constructor() {
    this.children = []; this.parentNode = null; this.dataset = {}; this.style = {}; this.className = '';
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim(); },
      remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); },
    };
  }
  appendChild(child) { child.parentNode?.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { assert.equal(child.parentNode, this); this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; }
  contains(child) { return this === child || this.children.some(item => item.contains(child)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.classList.contains(selector.slice(1))) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}
function harness() {
  const body = new Element(), timers = new Map(), frames = new Map(); let nextId = 0;
  const window = {};
  vm.runInNewContext(`${source.slice(start, end)}\nwindow.Toast = Toast;`, {
    window, document: { body, createElement: () => new Element() }, console: { debug() {} },
    setTimeout(fn, delay) { timers.set(++nextId, { fn, delay }); return nextId; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.set(++nextId, fn); return nextId; },
    setInterval() { throw new Error('No background interval expected'); },
  });
  const fire = (id, records = timers) => { const job = records.get(id); assert.ok(job); records.delete(id); (typeof job === 'function' ? job : job.fn)(); };
  const runDelay = delay => { for (const [id, item] of [...timers]) if (item.delay === delay) fire(id); };
  const flushFrames = () => { for (const [id] of [...frames]) fire(id, frames); };
  return { toast: window.Toast, body, timers, frames, fire, runDelay, flushFrames };
}

test('a progress update during dismissal creates a fresh active toast', () => {
  const h = harness(); const first = h.toast.progress('first', 10); const old = h.toast._progressToast;
  h.toast.dismissProgress(); const next = h.toast.progress('second', 20);
  assert.notEqual(next, first); assert.notEqual(h.toast._progressToast.element, old.element);
  assert.equal(h.toast._progressToast.element.querySelector('.ivlyrics-toast-message').textContent, 'second');
  h.runDelay(300);
  assert.equal(h.body.contains(old.element), false); assert.equal(h.toast._progressToast.id, next);
  assert.equal(h.body.contains(h.toast._progressToast.element), true);
});
test('dismissal releases ownership immediately and duplicate dismiss is inert', () => {
  const h = harness(); h.toast.progress('first'); h.toast.dismissProgress();
  assert.equal(h.toast._progressToast, null); const count = h.timers.size; h.toast.dismissProgress();
  assert.equal(h.timers.size, count); assert.equal([...h.timers.values()].filter(t => t.delay === 300).length, 1);
});
test('an old removal callback cannot forget a replacement created after DOM detachment', () => {
  const h = harness(); h.toast.progress('first'); const old = h.toast._progressToast;
  h.toast.dismissProgress(); old.element.parentNode.removeChild(old.element);
  const next = h.toast.progress('next'); h.runDelay(300);
  assert.equal(h.toast._progressToast?.id, next); assert.equal(h.body.contains(h.toast._progressToast.element), true);
});
test('a queued old auto-dismiss callback cannot close the replacement', () => {
  const h = harness(); h.toast.progress('first'); const expire = h.timers.get(h.toast._progressToast.timeout).fn;
  h.toast.dismissProgress(); h.runDelay(300); const id = h.toast.progress('next'); expire();
  assert.equal(h.toast._progressToast?.id, id);
  assert.equal(h.toast._progressToast.element.classList.contains('ivlyrics-toast-hide'), false);
});
test('a queued auto-dismiss from an updated old toast cannot close the replacement', () => {
  const h = harness(); h.toast.progress('first'); h.toast.progress('updated');
  const expire = h.timers.get(h.toast._progressToast.timeout).fn;
  h.toast.dismissProgress(); h.runDelay(300); const id = h.toast.progress('next'); expire();
  assert.equal(h.toast._progressToast?.id, id);
  assert.equal(h.toast._progressToast.element.classList.contains('ivlyrics-toast-hide'), false);
});
test('a retiring toast close button cannot dismiss the new active toast', () => {
  const h = harness(); h.toast.progress('first'); const close = h.toast._progressToast.element.querySelector('.ivlyrics-toast-close');
  h.toast.dismissProgress(); h.runDelay(300); const id = h.toast.progress('next'); let stopped = 0;
  close.onclick({ stopPropagation() { stopped++; } });
  assert.equal(stopped, 1); assert.equal(h.toast._progressToast?.id, id);
  assert.equal(h.toast._progressToast.element.classList.contains('ivlyrics-toast-hide'), false);
});
test('retired animation frame cannot show a toast already being dismissed', () => {
  const h = harness(); h.toast.progress('first'); const old = h.toast._progressToast.element;
  h.toast.dismissProgress(); h.flushFrames();
  assert.equal(old.classList.contains('ivlyrics-toast-hide'), true);
  assert.equal(old.classList.contains('ivlyrics-toast-show'), false);
});
test('active progress reuses the element, clamps percent and extends its timeout', () => {
  const h = harness(); const id = h.toast.progress('first', -10); const first = h.toast._progressToast;
  const timeout = first.timeout; assert.equal(first.element.querySelector('.ivlyrics-toast-progress-bar').style.width, '0%');
  assert.equal(h.toast.progress('updated', 150), id); assert.equal(h.toast._progressToast, first);
  assert.equal(first.element.querySelector('.ivlyrics-toast-progress-bar').style.width, '100%');
  assert.equal(first.element.querySelector('.ivlyrics-toast-message').textContent, 'updated');
  assert.equal(h.timers.has(timeout), false); assert.notEqual(first.timeout, timeout);
  assert.equal(h.timers.get(first.timeout).delay, 60000); h.flushFrames();
  assert.equal(first.element.classList.contains('ivlyrics-toast-show'), true);
});
test('active close button dismisses only progress and removes it after animation', () => {
  const h = harness(); h.toast.show('ordinary', false, 0); h.toast.progress('active'); const active = h.toast._progressToast;
  active.element.querySelector('.ivlyrics-toast-close').onclick({ stopPropagation() {} }); h.runDelay(300);
  assert.equal(h.body.contains(active.element), false); assert.equal(h.toast._progressToast, null);
  assert.equal(h.toast._toasts.length, 1); assert.equal(h.body.contains(h.toast._toasts[0].element), true);
});
test('active idle timeout dismisses progress with the existing animation delay', () => {
  const h = harness(); h.toast.progress('active'); const active = h.toast._progressToast;
  h.fire(active.timeout); assert.equal(active.element.classList.contains('ivlyrics-toast-hide'), true);
  assert.equal(h.body.contains(active.element), true); h.runDelay(300); assert.equal(h.body.contains(active.element), false);
});
test('success and error notifications retain independent tracked lifecycle', () => {
  const h = harness(); const good = h.toast.success('good'); const bad = h.toast.error('bad', 1000);
  assert.notEqual(good, bad); assert.equal(h.toast._toasts.length, 2);
  assert.equal(h.toast._toasts[0].element.querySelector('.ivlyrics-toast-message').textContent, 'good');
  assert.equal(h.toast._toasts[1].element.classList.contains('ivlyrics-toast-error'), true);
  h.toast.dismiss(good); h.runDelay(300); assert.equal(h.toast._toasts.length, 1);
  h.toast.dismissAll(); h.runDelay(300); assert.equal(h.toast._toasts.length, 0);
});
test('rapid progress replacements retain the last owner after every old removal', () => {
  const h = harness(); const old = [];
  for (let index = 0; index < 30; index++) {
    h.toast.progress(`work ${index}`); old.push(h.toast._progressToast.element); h.toast.dismissProgress();
  }
  const id = h.toast.progress('last'); h.runDelay(300); h.flushFrames();
  assert.equal(h.toast._progressToast?.id, id); assert.equal(h.body.querySelectorAll('.ivlyrics-toast-progress').length, 1);
  assert.ok(old.every(element => !h.body.contains(element)));
});
