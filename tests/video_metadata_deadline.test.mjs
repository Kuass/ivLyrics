import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const file = process.env.IVLYRICS_VIDEO_METADATA_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_VIDEO_METADATA_SOURCE_DIR, 'Utils.js')
  : new URL('../Utils.js', import.meta.url);
const source = readFileSync(file, 'utf8');
const extract = name => {
  const start = source.indexOf(`  async ${name}(`);
  if (start < 0) return '';
  const end = source.indexOf('\n  },', start);
  assert.ok(end > start, name);
  return source.slice(start, end + 5);
};
const code = ['getYouTubeVideoTitle', 'validateYouTubeVideo'].map(extract).join('\n');
const helperStart = source.indexOf('async function fetchVideoMetadataWithDeadline(');
const helper = helperStart < 0 ? '' : source.slice(helperStart, source.indexOf('\n}\n', helperStart) + 3);
const id = 'abcdefghijk';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const ok = title => ({ ok: true, status: 200, json: async () => ({ title }) });
function harness(steps) {
  const timers = new Map(), calls = [], errors = []; let timerId = 0;
  const utils = vm.runInNewContext(`${helper}\n({${code}})`, {
    AbortController, window: {}, console: { error: (...args) => errors.push(args) },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(key) { timers.delete(key); },
    fetch(url, init) {
      const step = steps[calls.length]; assert.ok(step, `unexpected request ${url}`);
      calls.push({ url, init }); return step(init?.signal);
    },
  });
  const advance = () => { for (const [key, timer] of [...timers]) { timers.delete(key); assert.equal(timer.delay, 15000); timer.fn(); } };
  return { utils, timers, calls, errors, advance };
}
const stalled = signal => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
const track = promise => { const result = { settled: false }; promise.then(value => Object.assign(result, { settled: true, value }), error => Object.assign(result, { settled: true, error })); return result; };
const normalized = value => JSON.parse(JSON.stringify(value));
for (const phase of ['headers', 'body']) {
  test(`primary title ${phase} timeout advances to the existing fallback`, async () => {
    const h = harness([signal => phase === 'headers' ? stalled(signal) : { ok: true, status: 200, json: () => stalled(signal) }, () => ok('Backup title')]);
    const result = track(h.utils.getYouTubeVideoTitle(id)); await flush(); h.advance(); await flush();
    assert.equal(result.settled, true); assert.equal(result.value, 'Backup title'); assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].init.signal.aborted, true); assert.equal(h.timers.size, 0);
  });
  test(`backup title ${phase} timeout settles as the existing null result`, async () => {
    const h = harness([() => { throw new TypeError('primary offline'); }, signal => phase === 'headers' ? stalled(signal) : { ok: true, status: 200, json: () => stalled(signal) }]);
    const result = track(h.utils.getYouTubeVideoTitle(id)); await flush(); h.advance(); await flush();
    assert.equal(result.settled, true); assert.equal(result.value, null); assert.equal(h.calls.length, 2); assert.equal(h.timers.size, 0);
  });
  test(`validation ${phase} timeout preserves networkError and clears its timer`, async () => {
    const h = harness([signal => phase === 'headers' ? stalled(signal) : { ok: true, status: 200, json: () => stalled(signal) }]);
    const result = track(h.utils.validateYouTubeVideo(id)); await flush(); h.advance(); await flush();
    assert.equal(result.settled, true); assert.deepEqual(normalized(result.value), { valid: false, title: null, error: 'networkError' });
    assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
  });
}
test('separate primary and fallback deadlines leave no timers after both stalls', async () => {
  const h = harness([stalled, stalled]); const result = track(h.utils.getYouTubeVideoTitle(id));
  await flush(); h.advance(); await flush(); assert.equal(h.calls.length, 2); assert.equal(result.settled, false);
  assert.equal(h.timers.size, 1); assert.notEqual(h.calls[0].init.signal, h.calls[1].init.signal);
  h.advance(); await flush(); assert.equal(result.settled, true); assert.equal(result.value, null); assert.equal(h.timers.size, 0);
});
test('ordinary successful titles preserve URLs and do not invoke backup', async () => {
  const h = harness([() => ok('  제목 🎵  ')]); assert.equal(await h.utils.getYouTubeVideoTitle(id), '  제목 🎵  ');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`); assert.equal(h.timers.size, 0);
});
for (const status of [401, 404]) {
  test(`title HTTP ${status} returns null without a body read or fallback`, async () => {
    let canceled = 0; const h = harness([() => ({ ok: false, status, json() { throw new Error('must not parse rejected response'); }, body: { cancel() { canceled++; return Promise.resolve(); } } })]);
    assert.equal(await h.utils.getYouTubeVideoTitle(id), null); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0); assert.equal(canceled, 1);
  });
}
test('other primary HTTP failures still use the existing backup endpoint', async () => {
  const h = harness([() => ({ ok: false, status: 503 }), () => ok('Backup')]);
  assert.equal(await h.utils.getYouTubeVideoTitle(id), 'Backup'); assert.equal(h.calls[1].url, `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`); assert.equal(h.timers.size, 0);
});
test('primary malformed JSON still falls back and backup error payload returns null', async () => {
  const h = harness([() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }), () => ({ ok: true, status: 200, json: async () => ({ error: 'missing', title: 'ignored' }) })]);
  assert.equal(await h.utils.getYouTubeVideoTitle(id), null); assert.equal(h.calls.length, 2); assert.equal(h.timers.size, 0);
});
for (const [status, error] of [[401, 'private'], [404, 'notFound'], [503, 'httpError']]) {
  test(`validation HTTP ${status} preserves ${error}`, async () => {
    const h = harness([() => ({ ok: false, status })]);
    assert.deepEqual(normalized(await h.utils.validateYouTubeVideo(id)), { valid: false, title: null, error }); assert.equal(h.timers.size, 0);
  });
}
test('validation success and missing title keep their existing result shape', async () => {
  for (const title of ['Fixture', null]) {
    const h = harness([() => ok(title)]);
    assert.deepEqual(normalized(await h.utils.validateYouTubeVideo(id)), { valid: !!title, title, error: title ? null : 'noTitle' }); assert.equal(h.timers.size, 0);
  }
});
test('invalid input produces no requests or timers', async () => {
  const h = harness([]); assert.equal(await h.utils.getYouTubeVideoTitle(''), null);
  assert.equal((await h.utils.validateYouTubeVideo('')).error, 'invalidId'); assert.equal((await h.utils.validateYouTubeVideo('short')).error, 'invalidFormat');
  assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
});
for (const kind of ['throw', 'reject']) {
  test(`discarded-body cancel ${kind} cannot replace HTTP classification`, async () => {
    const h = harness([() => ({ ok: false, status: 401, body: { cancel() { if (kind === 'throw') throw new Error('cancel failed'); return Promise.reject(new Error('cancel failed')); } } })]);
    assert.deepEqual(normalized(await h.utils.validateYouTubeVideo(id)), { valid: false, title: null, error: 'private' }); await flush(); assert.equal(h.timers.size, 0);
  });
}
test('a non-settling discarded-body cancellation cannot stall HTTP handling', async () => {
  let canceled = 0; const h = harness([() => ({ ok: false, status: 404, body: { cancel() { canceled++; return new Promise(() => {}); } } })]);
  const result = track(h.utils.validateYouTubeVideo(id)); await flush();
  assert.equal(result.settled, true); assert.equal(result.value.error, 'notFound'); assert.equal(canceled, 1); assert.equal(h.timers.size, 0);
});
test('public metadata functions remain usable without an object receiver', async () => {
  const h = harness([() => ok('Title'), () => ok('Validated')]);
  const title = h.utils.getYouTubeVideoTitle; const validate = h.utils.validateYouTubeVideo;
  assert.equal(await title(id), 'Title'); assert.equal((await validate(id)).title, 'Validated'); assert.equal(h.timers.size, 0);
});
