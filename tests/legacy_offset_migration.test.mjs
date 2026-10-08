// Actual startup, normalizer and DB transactions; synthetic FIFO storage only.
// This checks application contracts, not native IndexedDB/browser conformance.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import vm from 'node:vm';
import nodeTest, { after } from 'node:test';
import { environment, runtime, slices, source, persistence, managedCode, sha256,
  clone, KEY, SAME, NEW, OLD, records } from './helpers/track_sync_storage_harness.mjs';

after(async () => {
  // Every case is drained even when a baseline acceptance assertion fails.
  for (const h of records) await h.drain();
  if (process.env.IVLYRICS_OFFSET_AUDIT) writeFileSync(process.env.IVLYRICS_OFFSET_AUDIT,
    JSON.stringify({ indexSHA256: sha256(source), persistenceSHA256: sha256(persistence),
      slices, traces: records.map(h => ({ scenario: h.scenario, events: h.trace })) }, null, 2) + '\n');
});
function test(name, fn) {
  nodeTest(name, async () => {
    const start = records.length;
    try { await fn(); }
    finally {
      for (const h of records.slice(start)) {
        h.scenario = name;
        await h.drain();
      }
    }
  });
}

const seeded = { [SAME]: 900, [NEW]: -321 };
const legacyMap = { [SAME]: '12.5', [OLD]: -400 };
const normalizedLegacy = { [SAME]: 13, [OLD]: -400 };

test('populated store: startup preserves conflicting and distinct offsets and backup', async () => {
  const h = environment({ initial: seeded, legacy: JSON.stringify(legacyMap) }); const r = runtime(h);
  assert.equal((await h.settle(r.startup())).status, 'fulfilled');
  assert.deepEqual(h.contents(), seeded); assert.equal(h.local.get(KEY), JSON.stringify(legacyMap));
  assert.ok(!h.trace.some(x => x.type === 'request:queued' && ['put', 'clear'].includes(x.op)));
  assert.ok(h.trace.some(x => x.type === 'debug' && x.args[0].includes('Existing track offsets preserved')));
  assert.ok(!h.trace.some(x => ['console:error', 'console:warn'].includes(x.type)));
  return { before: seeded, legacy: legacyMap, after: h.contents(), trace: h.trace };
});
test('populated store plus empty legacy object: startup preserves the entire store', async () => {
  const h = environment({ initial: seeded, legacy: '{}' }); const r = runtime(h);
  await h.settle(r.startup()); assert.deepEqual(h.contents(), seeded); assert.equal(h.local.get(KEY), '{}');
  return { before: seeded, after: h.contents(), trace: h.trace };
});
test('empty new database: actual upgrade, migration and numeric/identifier normalization', async () => {
  const input = { [SAME]: '12.5', 'spotify:track:abcdef0123456789012345': -1.5,
    'spotify:local:Artist:Album:Title:123': ' -10001 ', 'spotify:anything': 10001,
    'SPOTIFY:track:Case': 33, bad: 40, 'spotify:track:boolean': true,
    'spotify:track:blank': '  ', 'spotify:track:infinity': 'Infinity' };
  const expected = { [SAME]: 13, 'spotify:track:abcdef0123456789012345': -1,
    'spotify:local:Artist:Album:Title:123': -10000, 'spotify:anything': 10000 };
  const h = environment({ exists: false, legacy: JSON.stringify(input) }); const r = runtime(h);
  await h.settle(r.startup()); assert.deepEqual(h.contents(), expected); assert.equal(h.local.has(KEY), false);
  const types = h.trace.map((x) => x.type);
  assert.ok(types.indexOf('open:upgrade') < types.indexOf('open:upgrade-complete'));
  assert.ok(types.indexOf('open:upgrade-complete') < types.indexOf('open:success'));
  return { input, after: h.contents(), trace: h.trace };
});
for (const [label, legacy] of [['absent', undefined], ['empty string', ''], ['invalid JSON', '{broken'],
  ['null', 'null'], ['array', '[]'], ['scalar', '5'], ['all invalid', '{"bad":4,"spotify:track:a":false}']]) {
  test(`startup ${label}: no IndexedDB open and legacy unchanged`, async () => {
    const h = environment({ initial: seeded, legacy }); const r = runtime(h);
    await h.settle(r.startup()); assert.deepEqual(h.contents(), seeded);
    assert.equal(h.local.get(KEY), legacy); assert.ok(!h.trace.some((x) => x.type === 'open:called'));
    return { trace: h.trace };
  });
}
test('empty existing store and empty legacy object: successful empty migration', async () => {
  const h = environment({ legacy: '{}' }); const r = runtime(h); await h.settle(r.startup());
  assert.deepEqual(h.contents(), {}); assert.equal(h.local.has(KEY), false); return { trace: h.trace };
});
test('startup reads only current legacy key, not the pre-rebrand key', async () => {
  const raw = JSON.stringify(legacyMap); const h = environment({ initial: seeded });
  h.local.set('lyrics-plus:track-sync-offsets', raw); const r = runtime(h);
  await h.settle(r.startup()); assert.deepEqual(h.contents(), seeded);
  assert.equal(h.local.get('lyrics-plus:track-sync-offsets'), raw);
  assert.ok(!h.trace.some((x) => x.type === 'open:called')); return { trace: h.trace };
});
test('localStorage read exception: caught before opening database', async () => {
  const h = environment({ initial: seeded, legacy: JSON.stringify(legacyMap), getFailures: 1 }); const r = runtime(h);
  await h.settle(r.startup()); assert.deepEqual(h.contents(), seeded); assert.ok(h.local.has(KEY));
  assert.ok(!h.trace.some((x) => x.type === 'open:called')); return { trace: h.trace };
});
for (const fault of [{ stage: 'open:throw' }, { stage: 'open:error' }, { stage: 'transaction:throw' },
  { stage: 'objectStore:throw' }, { stage: 'clear:throw' }, { stage: 'clear:error' },
  { stage: 'put:throw', nth: 2 }, { stage: 'put:error', nth: 2 }, { stage: 'commit:error' }, { stage: 'commit:abort' }]) {
  test(`startup failure ${fault.stage}${fault.nth ? ':second' : ''}: rollback and keep backup`, async () => {
    const raw = JSON.stringify(legacyMap); const h = environment({ legacy: raw, faults: [fault] }); const r = runtime(h);
    await h.settle(r.startup()); assert.deepEqual(h.contents(), {}); assert.equal(h.local.get(KEY), raw);
    assert.ok(h.trace.some((x) => x.type === 'fault' && x.stage === fault.stage));
    assert.ok(!h.trace.some((x) => x.type === 'local:remove-attempt')); return { after: h.contents(), trace: h.trace };
  });
}
test('startup removal occurs only after import transaction completion', async () => {
  const h = environment({ legacy: JSON.stringify(legacyMap) }); const r = runtime(h);
  const outcome = h.observe(r.startup());
  await h.until(() => h.trace.filter((x) => x.type === 'request:success' && x.op === 'put').length === 2);
  assert.equal(outcome.status, 'pending'); assert.deepEqual(h.contents(), {}); assert.ok(h.local.has(KEY));
  assert.ok(!h.trace.some((x) => x.type === 'local:remove-attempt'));
  await h.drain(); assert.equal(outcome.status, 'fulfilled'); assert.deepEqual(h.contents(), normalizedLegacy);
  const complete = h.trace.findIndex((x) => x.type === 'transaction:complete');
  const remove = h.trace.findIndex((x) => x.type === 'local:remove-attempt'); assert.ok(complete < remove);
  return { trace: h.trace };
});
test('removal failure, newer normal writes, fresh startup: legacy is retried', async () => {
  const raw = JSON.stringify(legacyMap); const h = environment({ legacy: raw, removeFailures: 1 }); let r = runtime(h);
  await h.settle(r.startup()); assert.deepEqual(h.contents(), normalizedLegacy); assert.equal(h.local.get(KEY), raw);
  assert.equal((await h.settle(r.call('setOffset', SAME, 777))).value, true);
  assert.equal((await h.settle(r.call('setOffset', NEW, 222))).value, true);
  const beforeRetry = h.contents(); h.event('test:fresh-startup'); r = runtime(h);
  await h.settle(r.startup()); assert.deepEqual(h.contents(), beforeRetry); assert.equal(h.local.get(KEY), raw);
  assert.equal(h.trace.filter(x => x.type === 'local:remove-attempt').length, 1);
  return { beforeRetry, afterRetry: h.contents(), trace: h.trace };
});
for (const stage of ['open:throw', 'open:error', 'getAllKeys:error', 'getAll:error', 'transaction:throw']) {
  test(`getAllOffsets ${stage}: exact fallback/rejection boundary`, async () => {
    const h = environment({ initial: seeded, faults: [{ stage }] }); const r = runtime(h);
    const outcome = await h.settle(r.call('getAllOffsets'));
    if (stage.startsWith('open:')) assert.deepEqual(outcome, { status: 'fulfilled', value: {} });
    else assert.equal(outcome.status, 'rejected');
    assert.deepEqual(h.contents(), seeded); return { outcome, trace: h.trace };
  });
}
test('separate read then import: FIFO writer can commit between transactions', async () => {
  const h = environment(); const r = runtime(h);
  const read = h.observe(r.call('getAllOffsets'));
  await h.until(() => read.status === 'fulfilled'); assert.deepEqual(read.value, {});
  // These are direct actual API calls illustrating the transaction boundary.
  // This is not a candidate migration policy or replacement startup IIFE.
  const writer = h.observe(r.call('setOffset', NEW, 777));
  const importer = h.observe(r.call('importOffsets', legacyMap));
  await h.drain(); assert.equal(writer.value, true); assert.equal(importer.value, true);
  const commits = h.trace.filter((x) => x.type === 'transaction:complete');
  assert.equal(commits[1].committed[NEW], 777); assert.deepEqual(h.contents(), normalizedLegacy);
  return { readOutcome: read, after: h.contents(), trace: h.trace };
});
test('concurrent opens of a new database: upgrade finishes first and writes serialize', async () => {
  const h = environment({ exists: false }); const r = runtime(h);
  const importer = h.observe(r.call('importOffsets', legacyMap));
  const writer = h.observe(r.call('setOffset', NEW, 777));
  await h.drain(); assert.equal(importer.value, true); assert.equal(writer.value, true);
  assert.deepEqual(h.contents(), { ...normalizedLegacy, [NEW]: 777 });
  const firstComplete = h.trace.findIndex((x) => x.type === 'transaction:complete');
  const secondStart = h.trace.findIndex((x) => x.type === 'transaction:start' && x.tx === 2);
  assert.ok(firstComplete < secondStart);
  assert.equal(h.trace.filter((x) => x.type === 'open:upgrade').length, 1);
  const upgradeComplete = h.trace.findIndex((x) => x.type === 'open:upgrade-complete');
  assert.ok(h.trace.every((x, i) => x.type !== 'open:success' || i > upgradeComplete));
  return { trace: h.trace };
});
for (const [label, input, expected] of [['valid map', legacyMap, normalizedLegacy], ['empty object', {}, {}]]) {
  test(`explicit import ${label}: replacement contract retained`, async () => {
    const h = environment({ initial: seeded }); const r = runtime(h);
    const outcome = await h.settle(r.call('importOffsets', input)); assert.equal(outcome.value, true);
    assert.deepEqual(h.contents(), expected); return { after: h.contents(), trace: h.trace };
  });
}
test('strict explicit import rejects any invalid entry before database access', async () => {
  const h = environment({ initial: seeded }); const r = runtime(h);
  assert.equal((await h.settle(r.call('importOffsets', { [SAME]: 3, bad: 4 }))).value, false);
  assert.deepEqual(h.contents(), seeded); assert.ok(!h.trace.some((x) => x.type === 'open:called'));
  return { trace: h.trace };
});
test('normalizer preserves identity/case and strict versus permissive object rules', async () => {
  const h = environment(); const r = runtime(h);
  assert.equal(r.evaluate(`Object.is(normalizeTrackSyncOffsets({'spotify:a': -0.1})['spotify:a'], -0)`), true);
  assert.equal(r.evaluate(`Object.getPrototypeOf(normalizeTrackSyncOffsets({})) === null`), true);
  assert.throws(() => r.evaluate('normalizeTrackSyncOffsets(new Date())'), /Invalid track/);
  assert.deepEqual(clone(r.evaluate('normalizeTrackSyncOffsets(Object.create(null))')), {});
  const exact = r.evaluate(`normalizeTrackSyncOffsets({'spotify:track:AbC': 2, 'spotify:track:abc': 3})`);
  assert.deepEqual(clone(exact), { 'spotify:track:AbC': 2, 'spotify:track:abc': 3 });
  return { trace: h.trace };
});
for (const [label, configKey, value] of [['string', KEY, JSON.stringify(legacyMap)], ['object', KEY, legacyMap],
  ['pre-rebrand key', 'lyrics-plus:track-sync-offsets', JSON.stringify(legacyMap)]]) {
  test(`actual importConfig ${label}: replace offsets and exclude key from settings writes`, async () => {
    const h = environment({ initial: seeded }); const r = runtime(h, { settings: true });
    const outcome = await h.settle(r.settings('importConfig', { [configKey]: value, 'ivLyrics:visual:test-fixture': 'value' }));
    assert.equal(outcome.status, 'fulfilled'); assert.deepEqual(h.contents(), normalizedLegacy);
    assert.equal(h.local.has(KEY), false); assert.equal(h.local.has(configKey), false);
    assert.equal(h.local.get('ivLyrics:visual:test-fixture'), 'value');
    assert.ok(!h.trace.some((x) => x.type === 'local:set' && [KEY, configKey].includes(x.key)));
    return { trace: h.trace };
  });
}
test('actual exportConfig reads IndexedDB and excludes stale legacy localStorage value', async () => {
  const h = environment({ initial: seeded, legacy: JSON.stringify(legacyMap) }); const r = runtime(h, { settings: true });
  const outcome = await h.settle(r.settings('exportConfig')); assert.equal(outcome.status, 'fulfilled');
  assert.deepEqual(JSON.parse(outcome.value[KEY]), seeded); assert.deepEqual(h.contents(), seeded);
  assert.equal(h.local.get(KEY), JSON.stringify(legacyMap));
  assert.ok(!h.trace.some((x) => x.type === 'transaction:created' && x.mode === 'readwrite'));
  return { export: outcome.value, trace: h.trace };
});
test('actual importConfig removes its input field but does not remove an existing legacy storage key', async () => {
  const raw = JSON.stringify({ [SAME]: 1 });
  const h = environment({ initial: seeded, legacy: raw }); const r = runtime(h, { settings: true });
  const outcome = await h.settle(r.settings('importConfig', { [KEY]: JSON.stringify(legacyMap) }));
  assert.equal(outcome.status, 'fulfilled'); assert.deepEqual(h.contents(), normalizedLegacy);
  assert.equal(h.local.get(KEY), raw);
  assert.ok(!h.trace.some((x) => ['local:set', 'local:remove-attempt'].includes(x.type) && x.key === KEY));
  return { trace: h.trace };
});
test('actual importConfig failure preserves offsets and does not write ordinary settings', async () => {
  const h = environment({ initial: seeded }); const r = runtime(h, { settings: true });
  const outcome = await h.settle(r.settings('importConfig', { [KEY]: { [SAME]: 3, bad: 7 }, 'ivLyrics:visual:test-fixture': 'value' }));
  assert.equal(outcome.status, 'rejected'); assert.deepEqual(h.contents(), seeded);
  assert.equal(h.local.has(KEY), false); assert.equal(h.local.has('ivLyrics:visual:test-fixture'), false);
  return { trace: h.trace };
});
test('actual StoragePersistence classifier excludes legacy track offset key', async () => {
  const context = vm.createContext({}); vm.runInContext(managedCode, context);
  assert.equal(vm.runInContext(`isManagedKey(${JSON.stringify(KEY)})`, context), false);
  const actual = vm.runInContext(`normalizeSettings({${JSON.stringify(KEY)}:'stale','ivLyrics:visual:theme':'dark'})`, context);
  assert.deepEqual(clone(actual), { 'ivLyrics:visual:theme': 'dark' });
  return { normalizedSettings: clone(actual) };
});


test('actual zero offset entry is populated data and retains the legacy backup', async () => {
  const raw = JSON.stringify(legacyMap);
  const h = environment({ legacy: raw }); const r = runtime(h);
  assert.equal((await h.settle(r.call('setOffset', SAME, 0))).value, true);
  await h.settle(r.startup());
  assert.deepEqual(h.contents(), { [SAME]: 0 }); assert.equal(h.local.get(KEY), raw);
});

test('actual intentional clear with a survivor does not resurrect a missing legacy key', async () => {
  const raw = JSON.stringify(legacyMap);
  const h = environment({ initial: seeded, legacy: raw }); const r = runtime(h);
  await h.settle(r.call('clearOffset', SAME));
  assert.deepEqual(h.contents(), { [NEW]: -321 });
  await h.settle(r.startup());
  assert.deepEqual(h.contents(), { [NEW]: -321 }); assert.equal(h.local.get(KEY), raw);
});

test('actual clear of the sole entry preserves the existing empty-store migration boundary', async () => {
  const h = environment({ initial: { [SAME]: 9 }, legacy: JSON.stringify(legacyMap) }); const r = runtime(h);
  await h.settle(r.call('clearOffset', SAME)); assert.deepEqual(h.contents(), {});
  await h.settle(r.startup());
  assert.deepEqual(h.contents(), normalizedLegacy); assert.equal(h.local.has(KEY), false);
});

test('physical store occupancy is preserved even for an unrecognized current key', async () => {
  const initial = { 'unrecognized-existing-key': 0 };
  const raw = JSON.stringify(legacyMap);
  const h = environment({ initial, legacy: raw }); const r = runtime(h);
  await h.settle(r.startup());
  assert.deepEqual(h.contents(), initial); assert.equal(h.local.get(KEY), raw);
});

test('empty-only skip has a distinct null result only after transaction completion', async () => {
  const h = environment({ initial: seeded }); const r = runtime(h);
  const outcome = h.observe(r.call('importOffsets', legacyMap, { onlyIfEmpty: true }));
  await h.until(() => h.trace.some(x => x.type === 'request:success'));
  const beforeCommit = { outcome: clone(outcome), store: h.contents() };
  await h.drain();
  assert.deepEqual(beforeCommit, { outcome: { status: 'pending' }, store: seeded });
  assert.deepEqual(outcome, { status: 'fulfilled', value: null });
  assert.deepEqual(h.contents(), seeded);
  assert.deepEqual(h.trace.filter(x => x.type === 'request:queued').map(x => x.op), ['count']);
  assert.equal(h.trace.filter(x => x.type === 'transaction:complete').length, 1);
});

test('empty-only success remains pending until its writes commit', async () => {
  const h = environment(); const r = runtime(h);
  const outcome = h.observe(r.call('importOffsets', legacyMap, { onlyIfEmpty: true }));
  await h.until(() => h.trace.filter(x => x.type === 'request:success' && x.op === 'put').length === 2);
  const beforeCommit = { outcome: clone(outcome), store: h.contents() };
  await h.drain();
  assert.deepEqual(beforeCommit, { outcome: { status: 'pending' }, store: {} });
  assert.deepEqual(outcome, { status: 'fulfilled', value: true });
  assert.deepEqual(h.contents(), normalizedLegacy);
  assert.deepEqual(h.trace.filter(x => x.type === 'request:queued').map(x => x.op), ['count', 'clear', 'put', 'put']);
  assert.equal(new Set(h.trace.filter(x => x.type === 'request:queued').map(x => x.tx)).size, 1);
});

for (const initial of [{}, seeded]) {
  for (const stage of ['count:throw', 'count:error']) {
    test(`startup ${stage} with ${Object.keys(initial).length ? 'populated' : 'empty'} store: keep all data and backup`, async () => {
      const raw = JSON.stringify(legacyMap);
      const h = environment({ initial, legacy: raw, faults: [{ stage }] }); const r = runtime(h);
      await h.settle(r.startup());
      assert.deepEqual(h.contents(), initial); assert.equal(h.local.get(KEY), raw);
      assert.ok(h.trace.some(x => x.type === 'fault' && x.stage === stage));
      assert.ok(!h.trace.some(x => x.type === 'local:remove-attempt'));
    });
  }
}
for (const countResult of [-1, null, '0', NaN, 0.5]) {
  test(`uncertain count ${String(countResult)} does not authorize migration or backup removal`, async () => {
    const raw = JSON.stringify(legacyMap);
    const h = environment({ legacy: raw, countResult }); const r = runtime(h);
    await h.settle(r.startup());
    assert.deepEqual(h.contents(), {}); assert.equal(h.local.get(KEY), raw);
    assert.ok(h.trace.some(x => x.type === 'transaction:abort'));
    assert.ok(!h.trace.some(x => x.type === 'request:queued' && ['clear', 'put'].includes(x.op)));
  });
}
for (const stage of ['commit:error', 'commit:abort']) {
  test(`populated-store skip ${stage} returns failure rather than successful skip`, async () => {
    const h = environment({ initial: seeded, faults: [{ stage }] }); const r = runtime(h);
    const outcome = await h.settle(r.call('importOffsets', legacyMap, { onlyIfEmpty: true }));
    assert.deepEqual(outcome, { status: 'fulfilled', value: false });
    assert.deepEqual(h.contents(), seeded);
    assert.ok(h.trace.some(x => x.type === 'fault' && x.stage === stage));
    assert.ok(!h.trace.some(x => x.type === 'request:queued' && ['clear', 'put'].includes(x.op)));
  });
}
for (const fault of [{ stage: 'clear:error' }, { stage: 'put:throw', nth: 2 },
  { stage: 'put:error', nth: 2 }, { stage: 'commit:error' }, { stage: 'commit:abort' }]) {
  test(`explicit replacement ${fault.stage}: provisional clear and writes roll back to populated data`, async () => {
    const h = environment({ initial: seeded, faults: [fault] }); const r = runtime(h);
    const outcome = await h.settle(r.call('importOffsets', legacyMap));
    assert.deepEqual(outcome, { status: 'fulfilled', value: false });
    assert.deepEqual(h.contents(), seeded);
    assert.ok(h.trace.some(x => x.type === 'fault' && x.stage === fault.stage));
    assert.ok(!h.trace.some(x => x.type === 'request:queued' && x.op === 'count'));
  });
}
for (const input of [null, [], 5, true, 'text', { [SAME]: ' ' }, { [SAME]: 'Infinity' }]) {
  test(`explicit invalid input ${JSON.stringify(input)} returns false before opening storage`, async () => {
    const h = environment({ initial: seeded }); const r = runtime(h);
    assert.equal((await h.settle(r.call('importOffsets', input))).value, false);
    assert.deepEqual(h.contents(), seeded);
    assert.ok(!h.trace.some(x => x.type === 'open:called'));
  });
}
for (const value of [{}, '{}']) {
  test(`actual importConfig empty ${typeof value} retains intentional replacement behavior`, async () => {
    const h = environment({ initial: seeded }); const r = runtime(h, { settings: true });
    assert.equal((await h.settle(r.settings('importConfig', { [KEY]: value }))).status, 'fulfilled');
    assert.deepEqual(h.contents(), {});
    assert.ok(!h.trace.some(x => x.type === 'request:queued' && x.op === 'count'));
  });
}
for (const exists of [true, false]) {
  test(`writer admitted before startup survives migration with ${exists ? 'existing' : 'new'} database`, async () => {
    const raw = JSON.stringify(legacyMap);
    const h = environment({ exists, legacy: raw }); const r = runtime(h);
    const writer = h.observe(r.call('setOffset', NEW, 777));
    const startup = h.observe(r.startup());
    await h.drain();
    assert.equal(writer.value, true); assert.equal(startup.status, 'fulfilled');
    const commits = h.trace.filter(x => x.type === 'transaction:complete');
    assert.equal(commits.length, 2); assert.deepEqual(commits[0].committed, { [NEW]: 777 });
    assert.deepEqual(h.contents(), { [NEW]: 777 }); assert.equal(h.local.get(KEY), raw);
    assert.ok(!h.trace.some(x => x.type === 'request:queued' && x.op === 'clear'));
  });
}
for (const uri of [SAME, NEW]) {
  test(`writer admitted after migration admission serializes its ${uri === SAME ? 'conflicting' : 'distinct'} write after commit`, async () => {
    const h = environment({ legacy: JSON.stringify(legacyMap) }); const r = runtime(h);
    const startup = h.observe(r.startup());
    await h.until(() => h.trace.some(x => x.type === 'request:success'));
    const writer = h.observe(r.call('setOffset', uri, 777));
    // No event reordering: enqueue writer after the first admission request and
    // drain the same FIFO task queue used by all other cases.
    await h.drain();
    assert.equal(startup.status, 'fulfilled'); assert.equal(writer.value, true);
    assert.deepEqual(h.contents(), { ...normalizedLegacy, [uri]: 777 });
    assert.equal(h.local.has(KEY), false);
    const requests = h.trace.filter(x => x.type === 'request:queued');
    assert.equal(requests[0].op, 'count');
    const firstCommit = h.trace.findIndex(x => x.type === 'transaction:complete' && x.tx === 1);
    const secondStart = h.trace.findIndex(x => x.type === 'transaction:start' && x.tx === 2);
    const secondCreated = h.trace.findIndex(x => x.type === 'transaction:created' && x.tx === 2);
    assert.ok(secondCreated < firstCommit && firstCommit < secondStart);
    const remove = h.trace.findIndex(x => x.type === 'local:remove-attempt');
    assert.ok(remove > firstCommit);
    assert.deepEqual(h.trace[firstCommit].committed, normalizedLegacy);
  });
}
