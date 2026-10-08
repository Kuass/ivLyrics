// Read-only assessment of frozen application source; all storage below is inert.
// No browser, IndexedDB implementation, dependency, server, or user data is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
const persistence = readFileSync(new URL('../../StoragePersistence.js', import.meta.url), 'utf8');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const KEY = 'ivLyrics:track-sync-offsets';
const SAME = 'spotify:track:AbCdEf0123456789012345';
const NEW = 'spotify:track:Newer01234567890123456';
const OLD = 'spotify:track:Legacy0123456789012345';
const clone = (value) => value === undefined ? '[undefined]' : JSON.parse(JSON.stringify(value));
const slices = {};
function section(name, text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing actual-source section: ${name}`);
  const code = text.slice(from, to);
  slices[name] = { startLine: text.slice(0, from).split('\n').length,
    endLine: text.slice(0, to).split('\n').length - 1, sha256: sha256(code) };
  return code;
}
const dbCode = section('trackSyncDB', source, '// IndexedDB for track sync offsets', '// Track overrides share storage mechanics');
const startupCode = section('startupIIFE', source, '// Migrate from localStorage to IndexedDB', 'const SettingsPersistence =');
const settingsCode = section('settingsImportExport', source, 'const SettingsPersistence =', 'const getStoredFiniteNumber =');
const managedCode = section('managedKeys', persistence, '  const MANAGED_PREFIXES =', '  const moduleState =')
  + section('isManagedKey', persistence, '  const isManagedKey =', '  const getPlatformStorage =')
  + section('normalizeSettings', persistence, '  const normalizeSettings =', '  const normalizeRecord =');

// Minimal deterministic IDB event/transaction harness, not an IDB conformance
// implementation. Requests and opens run FIFO; transactions on this single scope
// are serialized by creation order. Working copies become visible only on commit.
// Request failure bubbles an error and aborts with rollback. Tests never reorder
// queued tasks, force a request's onsuccess, or replace an application DB method.
const records = [];
function environment({ initial = {}, legacy, exists = true, faults = [], removeFailures = 0, getFailures = 0, countResult } = {}) {
  const trace = [], tasks = [], transactions = [], opens = [];
  const committed = new Map(Object.entries(initial));
  const local = new Map(legacy === undefined ? [] : [[KEY, legacy]]);
  const rules = faults.map((rule) => ({ stage: rule.stage, remaining: rule.nth || 1, used: false }));
  let active = null, activationScheduled = false, nextTx = 0, nextOpen = 0, nextReq = 0;
  let dbExists = exists, storeExists = exists, opening = false;
  const event = (type, details = {}) => trace.push({ step: trace.length + 1, type, ...clone(details) });
  const schedule = (type, fn) => tasks.push({ type, fn });
  const fail = (stage) => {
    const rule = rules.find((item) => !item.used && item.stage === stage);
    if (!rule || --rule.remaining !== 0) return false;
    rule.used = true;
    event('fault', { stage });
    return true;
  };
  const error = (stage) => new Error(`Injected ${stage}`);
  const contents = () => Object.fromEntries([...committed].sort(([a], [b]) => a.localeCompare(b)));
  function activate() {
    if (active || activationScheduled || !transactions.length) return;
    activationScheduled = true;
    schedule('transaction:start', () => {
      activationScheduled = false;
      active = transactions.shift();
      if (active.state !== 'aborting') active.state = 'running';
      active.working = new Map(committed);
      event('transaction:start', { tx: active.id, mode: active.mode });
      pump(active);
    });
  }
  function abort(tx, reason, bubble = false) {
    if (tx.state === 'aborting' || tx.state === 'finished') return;
    tx.state = 'aborting';
    tx.error = reason;
    if (bubble) {
      event('transaction:error', { tx: tx.id, error: reason?.message });
      tx.onerror?.({ target: tx });
    }
    schedule('transaction:abort', () => {
      // Pending requests never affect committed state, even when clear/earlier
      // puts already succeeded. No tested pending request has an error handler.
      for (const pending of tx.pending.splice(0)) {
        pending.request.error = error('AbortError');
        event('request:abort', { tx: tx.id, op: pending.op, request: pending.id });
        pending.request.onerror?.({ target: pending.request });
      }
      tx.state = 'finished';
      event('transaction:abort', { tx: tx.id, committed: contents() });
      tx.onabort?.({ target: tx });
      assert.equal(active, tx);
      active = null;
      activate();
    });
  }
  function pump(tx) {
    if (tx.state !== 'running') return;
    if (tx.pending.length) {
      const work = tx.pending.shift();
      schedule(`request:${work.op}`, () => {
        if (tx.state !== 'running') return;
        if (fail(`${work.op}:error`)) {
          work.request.error = error(`${work.op}:error`);
          event('request:error', { tx: tx.id, request: work.id, op: work.op });
          work.request.onerror?.({ target: work.request });
          abort(tx, work.request.error, true);
          return;
        }
        work.request.result = work.run(tx.working);
        event('request:success', { tx: tx.id, request: work.id, op: work.op, result: clone(work.request.result) });
        work.request.onsuccess?.({ target: work.request });
        pump(tx);
      });
    } else {
      schedule('transaction:complete', () => {
        if (tx.state !== 'running') return;
        if (tx.pending.length) { pump(tx); return; }
        if (fail('commit:error')) { abort(tx, error('commit:error'), true); return; }
        if (fail('commit:abort')) { abort(tx, null); return; }
        if (tx.mode === 'readwrite') {
          committed.clear();
          for (const [key, value] of tx.working) committed.set(key, value);
        }
        tx.state = 'finished';
        event('transaction:complete', { tx: tx.id, committed: contents() });
        tx.oncomplete?.({ target: tx });
        active = null;
        activate();
      });
    }
  }
  const db = {
    objectStoreNames: { contains: (name) => name === 'track-sync-offsets' && storeExists },
    createObjectStore(name) { assert.equal(name, 'track-sync-offsets'); storeExists = true; event('store:create'); },
    transaction(names, mode) {
      assert.deepEqual([...names], ['track-sync-offsets']);
      assert.ok(['readonly', 'readwrite'].includes(mode));
      assert.ok(storeExists);
      if (fail('transaction:throw')) throw error('transaction:throw');
      const tx = { id: ++nextTx, mode, state: 'queued', pending: [], error: null,
        abort() { event('transaction:abort-called', { tx: tx.id }); abort(tx, null); },
        objectStore(name) {
          assert.equal(name, 'track-sync-offsets');
          if (fail('objectStore:throw')) throw error('objectStore:throw');
          const req = (op, args, run) => {
            assert.ok(tx.state === 'queued' || tx.state === 'running', 'transaction is active');
            if (fail(`${op}:throw`)) throw error(`${op}:throw`);
            if (['clear', 'put', 'delete'].includes(op)) assert.equal(mode, 'readwrite');
            const request = {}, id = ++nextReq;
            event('request:queued', { tx: tx.id, request: id, op, args });
            tx.pending.push({ request, id, op, run });
            return request;
          };
          const keys = (map) => [...map.keys()].sort();
          return {
            count: () => req('count', [], (map) => countResult === undefined ? map.size : countResult),
            clear: () => req('clear', [], (map) => { map.clear(); }),
            put: (value, key) => req('put', [value, key], (map) => { map.set(key, value); return key; }),
            delete: (key) => req('delete', [key], (map) => { map.delete(key); }),
            get: (key) => req('get', [key], (map) => map.get(key)),
            getAllKeys: () => req('getAllKeys', [], keys),
            getAll: () => req('getAll', [], (map) => keys(map).map((key) => map.get(key))),
          };
        },
      };
      event('transaction:created', { tx: tx.id, mode });
      transactions.push(tx);
      activate();
      return tx;
    },
  };
  function nextOpening() {
    if (opening || !opens.length) return;
    opening = true;
    const request = opens.shift();
    const finished = () => { opening = false; nextOpening(); };
      schedule('open:request', () => {
        if (fail('open:error')) {
          request.error = error('open:error'); event('open:error'); request.onerror?.({ target: request }); finished(); return;
        }
        request.result = db;
        const success = () => { event('open:success'); request.onsuccess?.({ target: request }); finished(); };
        if (!dbExists) {
          dbExists = true;
          schedule('open:upgrade', () => {
            event('open:upgrade'); request.onupgradeneeded?.({ target: request });
            schedule('open:upgrade-complete', () => { event('open:upgrade-complete'); schedule('open:success', success); });
          });
        } else schedule('open:success', success);
      });
  }
  const indexedDB = {
    open(name, version) {
      assert.equal(name, 'ivLyrics-db'); assert.equal(version, 1);
      event('open:called', { open: ++nextOpen });
      if (fail('open:throw')) throw error('open:throw');
      const request = {};
      opens.push(request);
      nextOpening();
      return request;
    },
  };
  const localStorage = {
    getItem(key) {
      event('local:get', { key });
      if (getFailures-- > 0) throw error('local:get');
      return local.has(key) ? local.get(key) : null;
    },
    setItem(key, value) { event('local:set', { key, value: String(value) }); local.set(key, String(value)); },
    removeItem(key) {
      event('local:remove-attempt', { key, committed: contents() });
      if (removeFailures-- > 0) { event('local:remove-failed'); throw error('local:remove'); }
      local.delete(key); event('local:removed', { key });
    },
  };
  async function microtasks() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  const h = { trace, tasks, local, contents, indexedDB, localStorage, event,
    observe(promise) {
      const result = { status: 'pending' };
      Promise.resolve(promise).then((value) => {
        Object.assign(result, { status: 'fulfilled', value: clone(value) });
      }, (reason) => Object.assign(result, { status: 'rejected', error: reason?.message }));
      return result;
    },
    async step() {
      await microtasks(); assert.ok(tasks.length, 'expected next FIFO event');
      const task = tasks.shift(); task.fn(); await microtasks();
    },
    async until(predicate) {
      for (let i = 0; i < 200; i++) { await microtasks(); if (predicate()) return; await h.step(); }
      assert.fail('inert event queue did not reach boundary');
    },
    async drain() {
      for (let i = 0; i < 200; i++) { await microtasks(); if (!tasks.length) {
        assert.equal(active, null, 'no active transaction remains');
        assert.equal(transactions.length, 0, 'all transactions drained');
        assert.equal(opens.length, 0, 'all opens drained');
        assert.equal(opening, false, 'no open remains active');
        return;
      } await h.step(); }
      assert.fail('inert event queue did not drain');
    },
    async settle(promise) {
      const result = h.observe(promise); await h.drain(); assert.notEqual(result.status, 'pending'); return result;
    },
  };
  records.push(h);
  return h;
}
function runtime(h, { settings = false } = {}) {
  const context = vm.createContext({ indexedDB: h.indexedDB, localStorage: h.localStorage, window: {},
    ivLyricsDebug: (...args) => h.event('debug', { args: args.map(clone) }),
    console: Object.fromEntries(['error', 'warn', 'log'].map((level) => [level,
      (...args) => h.event(`console:${level}`, { args: args.map((x) => x instanceof Error ? x.message : String(x)) })])),
  });
  vm.runInContext(dbCode, context, { filename: 'frozen-index-db.js' });
  if (settings) vm.runInContext('const APP_NAME = "ivLyrics";\n' + settingsCode, context, { filename: 'frozen-index-settings.js' });
  const evaluate = (code) => vm.runInContext(code, context);
  return { evaluate, startup: () => vm.runInContext(startupCode, context, { filename: 'frozen-index-startup.js' }),
    call: (method, ...args) => evaluate(`TrackSyncDB.${method}(${args.map((x) => JSON.stringify(x)).join(',')})`),
    settings: (method, ...args) => evaluate(`StorageManager.${method}(${args.map((x) => JSON.stringify(x)).join(',')})`),
  };
}

export { environment, runtime, slices, source, persistence, managedCode, sha256, clone, KEY, SAME, NEW, OLD, records };
