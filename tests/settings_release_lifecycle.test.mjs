import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Settings.js', import.meta.url), 'utf8');
const start = source.indexOf('  // 패치노트 불러오기');
const end = source.indexOf('  const renderHeaderSection', start);
assert.ok(start >= 0 && end > start);
function harness(fetch) {
  const timers = new Map();
  let id = 0;
  let cleanup;
  const container = { style: {}, innerHTML: 'original' };
  vm.runInNewContext(source.slice(start, end), {
    activeTab: 'about', uiTheme: 'dark', FORK_REPO: 'Kuass/ivLyrics',
    useEffect: effect => { cleanup = effect(); },
    setTimeout(callback, delay) { timers.set(++id, { callback, delay }); return id; },
    clearTimeout(timerId) { timers.delete(timerId); },
    AbortController, fetch, document: { getElementById: () => container },
    console: { error() {} }, I18n: { t: key => key },
    escapeSettingsReleaseHtml: value => String(value),
    escapeSettingsReleaseAttribute: value => String(value),
    sanitizeSettingsReleaseUrl: () => '',
    renderSettingsReleaseMarkdown: value => value,
  });
  const runTimer = delay => {
    const entry = [...timers].find(([, value]) => value.delay === delay);
    assert.ok(entry, `Expected ${delay}ms timer`);
    timers.delete(entry[0]);
    return entry[1].callback();
  };
  return { cleanup, timers, container, runTimer };
}

test('leaving About before its delayed load cancels the request', () => {
  let requests = 0;
  const state = harness(() => { requests++; });
  state.cleanup();
  assert.equal(state.timers.size, 0);
  assert.equal(requests, 0);
});

test('a stale release response cannot mutate the screen after effect cleanup', async () => {
  let finish;
  let signal;
  const state = harness((_url, init) => {
    signal = init.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = state.runTimer(100);
  state.cleanup();
  assert.equal(signal.aborted, true);
  finish({ ok: true, json: async () => ({ tag_name: 'v1', body: 'stale' }) });
  await pending;
  assert.equal(state.container.innerHTML, 'original');
  assert.equal(state.timers.size, 0);
});

test('release timeout remains active during body consumption and renders recovery text', async () => {
  const state = harness(async (_url, { signal }) => ({
    ok: true,
    json: () => signal.aborted ? Promise.reject(signal.reason)
      : new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  }));
  const pending = state.runTimer(100);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  state.runTimer(15000);
  await pending;
  assert.match(state.container.innerHTML, /patchNotesLoadFailed/);
  assert.equal(state.timers.size, 0);
});

test('successful release notes render and release their deadline', async () => {
  const state = harness(async () => ({ ok: true, json: async () => ({ tag_name: 'v6.6.10', body: 'release notes' }) }));
  await state.runTimer(100);
  assert.match(state.container.innerHTML, /v6.6.10/);
  assert.match(state.container.innerHTML, /release notes/);
  assert.equal(state.timers.size, 0);
});
