import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, A, B, L, track, lines, clone } from './helpers/regeneration_request_harness.mjs';

const aid = A.split(':').at(-1);
const bid = B.split(':').at(-1);
const targets = [
  ['gemini_ko', 'none', 'translation'],
  ['gemini_romaji', 'none', 'phonetic'],
  ['gemini_romaji', 'gemini_ko', 'all'],
];
const active = new Set();
const make = options => { const h = harness(options); active.add(h); return h; };
test.afterEach(async () => {
  for (const h of active) {
    try { await h.drain(); } finally { h.close(); active.delete(h); }
  }
});
const params = h => h.providerCalls.map(q => clone(q.options));
const mark = h => ({ calls: h.providerCalls.length, writes: h.persistentWrites.length,
  clears: h.invalidationCalls.length, memory: h.cacheWrites.length, toasts: h.toasts.length });
const select = (h, target) => { if (h.click()) h.choose(target); };
const read = (h, trackId, text, isPhonetic) => h.context.cacheHelpers.getCachedTranslationForText({
  trackId, text, isPhonetic, lang: 'en', provider: 'fixture-lyrics',
});
async function settleExcept(h, held) {
  for (let i = 0; i < 8; i++) {
    for (const q of h.providerCalls) if (!q.settled && !held.has(q)) q.resolve(h.result(q));
    await h.settle(); await h.advance(60);
  }
}
async function finishRegeneration(h, start) {
  for (let i = 0; i < 3; i++) {
    for (const q of h.providerCalls.slice(start)) if (!q.settled) q.resolve(h.result(q, 'regenerated'));
    await h.settle();
  }
  await h.drain();
}

for (const queuedState of [false, true]) for (const [mode1, mode2, target] of targets) {
  test(`aligned B regenerates selected fields: ${target}; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1, mode2 });
    await h.load(track(B)); await h.completeInitial();
    const before = mark(h);
    select(h, target);
    const synchronous = params(h).slice(before.calls);
    await finishRegeneration(h, before.calls);
    const requests = params(h).slice(before.calls);
    const writes = h.persistentWrites.slice(before.writes);
    assert.equal(synchronous.length, 1);
    assert.equal(requests.length, target === 'all' ? 2 : 1);
    assert.ok(requests.every(r => r.trackId === bid && r.artist === 'Artist B' &&
      r.title === 'Track B' && r.text === lines(B)[0].text));
    assert.equal(writes.length, requests.length * 2, 'Translator and outer helper both persist');
    assert.ok(writes.every(r => r.trackId === bid));
    assert.equal(h.toasts.filter(t => t.kind === 'error').length, 0);
    assert.equal(h.c.state.uri, B);
  });

  test(`loaded B/public A keeps request, retry scope and persistent identity B: ${target}; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1, mode2 });
    // Real playback acceptance and fetch methods establish B; no state URI is assigned here.
    await h.load(track(A)); await h.completeInitial();
    await h.load(track(B), track(A)); await h.completeInitial();
    const admission = h.snapshot();
    const fields = target === 'all' ? [true, false] : [target === 'phonetic'];
    const prior = [];
    for (const isPhonetic of fields) prior.push({ isPhonetic,
      a: clone(await read(h, aid, lines(A)[0].text, isPhonetic)),
      b: clone(await read(h, bid, lines(B)[0].text, isPhonetic)),
    });
    await h.drain();
    h.window.pendingRetries.set(`${aid}:fixture`, { origin: 'A' });
    h.window.pendingRetries.set(`${bid}:fixture`, { origin: 'B' });
    const before = mark(h);
    select(h, target);
    const synchronous = params(h).slice(before.calls);
    const retriesAfter = [...h.window.pendingRetries.keys()];
    await finishRegeneration(h, before.calls);
    const requests = params(h).slice(before.calls);
    const writes = h.persistentWrites.slice(before.writes);
    const readbacks = [];
    for (const p of prior) readbacks.push({ ...p,
      afterA: clone(await read(h, aid, lines(A)[0].text, p.isPhonetic)),
      afterB: clone(await read(h, bid, lines(B)[0].text, p.isPhonetic)),
      wrongNamespace: clone(await read(h, aid, lines(B)[0].text, p.isPhonetic)),
    });
    // Drain before desired assertions so baseline failures cannot leave suspended work.
    await h.drain();
    assert.equal(admission.uri, B); assert.equal(admission.currentUri, B);
    assert.equal(admission.snapshotUri, B); assert.equal(admission.publicUri, A);
    assert.equal(synchronous.length, 1, 'first request is admitted before provider suspension');
    assert.equal(requests.length, target === 'all' ? 2 : 1);
    assert.ok(requests.every(r => r.trackId === bid), 'selected B lyrics own every request ID');
    assert.ok(requests.every(r => r.title === 'Track B' && r.artist === 'Artist B' &&
      r.text === lines(B)[0].text && r.provider === 'fixture-lyrics'));
    assert.deepEqual(h.invalidationCalls.slice(before.clears), [bid]);
    assert.deepEqual(retriesAfter, [`${aid}:fixture`]);
    assert.equal(writes.length, requests.length * 2);
    assert.ok(writes.every(r => r.trackId === bid && r.sourceHash.includes('src-rxhyg8-9')));
    for (const r of readbacks) {
      assert.ok(r.a); assert.ok(r.b);
      assert.deepEqual(r.afterA, r.a, 'A plus original A text stays untouched');
      assert.notDeepEqual(r.afterB, r.b, 'B plus B text receives the regenerated value');
      const field = r.isPhonetic ? 'phonetic' : 'translation';
      assert.deepEqual(r.afterB[field], [`regenerated ${field} ${lines(B)[0].text}`]);
      assert.equal(r.wrongNamespace, null, 'no A plus B text entry is created');
    }
    assert.equal(h.c.state.uri, B);
    assert.ok(h.c.state.currentLyrics.some(l => (l.translationText || l.phoneticText || '').startsWith('regenerated')));
    assert.ok(h.cacheWrites.slice(before.memory).every(w => w.key.startsWith(`${B}:`)));
    assert.equal(h.toasts.filter(t => t.kind === 'error').length, 0);
    assert.equal(h.toasts.filter(t => t.kind === 'success').length, 1);
  });

  test(`provider error restores the selected display and clears loading: ${target}; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1, mode2 });
    await h.load(track(B), track(A)); await h.completeInitial();
    const previous = clone(h.c.state.currentLyrics);
    const before = mark(h);
    select(h, target);
    const request = h.providerCalls.at(-1);
    request.options.onLine(0, 'provisional result');
    await h.advance(60);
    request.reject(Error('inert provider failure'));
    await h.drain();
    assert.equal(h.providerCalls.length, before.calls + 1, 'failed first mode does not start the second');
    assert.deepEqual(clone(h.c.state.currentLyrics), previous);
    assert.equal(h.persistentWrites.length, before.writes);
    assert.equal(h.toasts.filter(t => t.kind === 'success').length, 0);
    assert.equal(h.toasts.filter(t => t.kind === 'error' && t.message.includes('inert provider failure')).length, 1);
    assert.equal(h.c._activePhoneticLoadingTokens.size, 0);
    assert.equal(h.c._activeTranslationLoadingTokens.size, 0);
  });
}

for (const queuedState of [false, true]) {
  for (const publicLag of [false, true]) test(`modal opened A selects current B; lag=${publicLag}; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1: 'gemini_romaji', mode2: 'gemini_ko' });
    await h.load(track(A)); await h.completeInitial(); h.click();
    await h.load(track(B), track(publicLag ? A : B)); await h.completeInitial();
    const before = mark(h);
    h.choose('translation');
    const requests = params(h).slice(before.calls);
    await h.drain();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].text, lines(B)[0].text);
    assert.equal(requests[0].trackId, bid);
    assert.equal(requests[0].wantSmartPhonetic, false);
    assert.equal(h.modalCloses, 1);
  });

  // These explicit boundaries follow the loaded-state contract; they are separate
  // from the six proved full-B/public-A mismatches above.
  for (const kind of ['missing', 'local', 'uri-only-aligned', 'uri-only-lag']) test(`loaded Spotify B regenerates with public ${kind}; queued=${queuedState}`, async () => {
    const publicItem = kind === 'missing' ? null : kind === 'local' ? track(L) : track(kind === 'uri-only-aligned' ? B : A, false);
    const h = make({ queuedState });
    await h.load(track(B), publicItem); await h.completeInitial();
    const admission = h.snapshot(); const before = mark(h);
    h.click(); const requests = params(h).slice(before.calls);
    await h.drain();
    assert.equal(admission.snapshotUri, B); assert.equal(admission.uri, B);
    assert.equal(requests.length, 1); assert.equal(requests[0].trackId, bid);
    assert.equal(requests[0].text, lines(B)[0].text);
    assert.equal(h.toasts.slice(before.toasts).filter(t => t.kind === 'error').length, 0);
  });

  for (const publicItem of [track(A), null]) test(`URI-only B has no loaded lyrics to regenerate; public=${publicItem ? 'A' : 'missing'}; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1: 'gemini_romaji', mode2: 'gemini_ko' });
    await h.load(track(A)); await h.completeInitial(); h.click();
    const before = mark(h);
    await h.load(track(B, false), publicItem);
    const transition = h.snapshot(); const disabled = h.button().props.disabled;
    h.choose('translation'); await h.drain();
    assert.equal(disabled, !publicItem);
    assert.equal(h.providerCalls.length, before.calls);
    assert.ok(h.toasts.some(t => t.message === 'notifications.noLyricsLoaded'));
    assert.equal(transition.lyrics.length, 0);
    assert.equal(transition.uri, publicItem ? A : B);
  });

  for (const kind of ['aligned-local', 'stale-spotify', 'missing']) test(`local origin never borrows public Spotify identity: ${kind}; queued=${queuedState}`, async () => {
    const publicItem = kind === 'aligned-local' ? track(L) : kind === 'stale-spotify' ? track(A) : null;
    const h = make({ queuedState });
    // Existing automatic-translation failures remain characterized, not changed.
    h.expectedRejectedTasks = kind === 'stale-spotify' ? 0 : 1;
    await h.load(track(L), publicItem); await h.drain();
    const disabled = h.button().props.disabled;
    if (kind !== 'stale-spotify') h.expectedRejectedTasks = 2;
    const before = mark(h);
    if (!disabled) h.click();
    await h.drain();
    assert.equal(h.c.state.uri, L);
    assert.equal(disabled, kind !== 'stale-spotify');
    assert.equal(h.providerCalls.length, before.calls, 'explicit local regeneration cannot use A');
    if (kind === 'stale-spotify') assert.deepEqual(h.toasts.slice(before.toasts), [{ kind: 'error', message: 'notifications.noTrackPlaying' }]);
    else {
      assert.equal(h.providerCalls.length, 0);
      assert.ok(h.toasts.some(t => t.message.includes('No track ID available')));
    }
  });

  for (const changed of ['provider-none', 'modes-none', 'translation-only']) test(`modal rechecks current provider/modes: ${changed}; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1: 'gemini_romaji', mode2: 'gemini_ko' });
    await h.load(track(A)); await h.completeInitial(); h.click();
    const before = mark(h);
    if (changed === 'provider-none') h.config.visual['translate:translated-lyrics-source'] = 'none';
    else {
      h.config.visual['translation-mode:japanese'] = changed === 'translation-only' ? 'gemini_ko' : 'none';
      h.config.visual['translation-mode-2:japanese'] = 'none';
    }
    h.choose(changed === 'translation-only' ? 'phonetic' : 'all'); await h.drain();
    assert.equal(h.providerCalls.length, before.calls);
    assert.equal(h.persistentWrites.length, before.writes);
  });

  test(`legitimate A-to-B transition retires old publication but permits admitted A cache warming; queued=${queuedState}`, async () => {
    const h = make({ queuedState, mode1: 'gemini_romaji', mode2: 'gemini_ko' });
    await h.load(track(A)); await h.completeInitial();
    const before = mark(h); select(h, 'all');
    const old = h.providerCalls.at(-1);
    await h.load(track(B)); await settleExcept(h, new Set([old]));
    const beforeLate = h.snapshot(); const streamCount = h.progress.length;
    old.options.onLine(0, 'retired stream'); await h.advance(60);
    const afterLate = h.snapshot();
    old.resolve(h.result(old, 'retired')); await h.drain();
    const requests = params(h).slice(before.calls);
    const writes = h.persistentWrites.slice(before.writes);
    assert.deepEqual(afterLate.lyrics, beforeLate.lyrics);
    assert.equal(h.progress.length, streamCount);
    assert.equal(requests.filter(q => q.trackId === aid).length, 1);
    assert.equal(writes.filter(w => w.trackId === aid).length, 1, 'only Translator warms A; the outer write retires');
    assert.equal(h.c.state.uri, B);
    assert.equal(h.toasts.filter(t => t.kind === 'success').length, 0);
  });
}

test('retry cleanup retains actual admitted A and B provider promises', async () => {
  const h = make(); await h.load(track(B), track(A)); await h.completeInitial();
  const admitted = [aid, bid].map(trackId => h.window.Translator.callGemini({
    trackId, artist: 'Fixture', title: 'Admitted request', text: `independent ${trackId}`,
    provider: 'fixture-lyrics',
  }));
  await h.settle();
  const flights = [...h.window.translationFlights];
  h.window.pendingRetries.set(`${aid}:fixture`, {});
  h.window.pendingRetries.set(`${bid}:fixture`, {});
  h.click();
  const retained = flights.map(([key, promise]) => h.window.translationFlights.get(key) === promise);
  const retries = [...h.window.pendingRetries.keys()];
  await h.drain(); await Promise.all(admitted); await h.drain();
  assert.equal(flights.length, 2);
  assert.deepEqual(retained, [true, true], 'scoped retry cleanup does not cancel admitted promises');
  assert.deepEqual(retries, [`${aid}:fixture`]);
  assert.equal(h.window.translationFlights.size, 0, 'settlement retires admitted promises');
});

test('ABA return retains the existing URI-only ownership policy', async () => {
  const h = make({ mode1: 'gemini_romaji', mode2: 'gemini_ko' });
  await h.load(track(A)); await h.completeInitial(); select(h, 'all');
  const old = h.providerCalls.at(-1);
  await h.load(track(B)); await settleExcept(h, new Set([old]));
  await h.load(track(A)); await settleExcept(h, new Set([old]));
  const returned = h.snapshot(); const streamBefore = h.progress.length;
  old.options.onLine(0, 'ABA stream'); await h.advance(60);
  old.resolve(h.result(old, 'ABA')); await h.drain();
  assert.equal(returned.uri, A); assert.ok(h.progress.length > streamBefore);
  assert.equal(h.c.state.uri, A);
  assert.equal(h.toasts.filter(t => t.kind === 'success').length, 1);
});

test('same-URI refresh preserves original text but reads refreshed metadata for the second dispatch', async () => {
  const rawLyrics = {};
  const h = make({ mode1: 'gemini_romaji', mode2: 'gemini_ko', rawLyrics });
  await h.load(track(A)); await h.completeInitial();
  const before = mark(h); select(h, 'all'); const old = h.providerCalls.at(-1);
  rawLyrics[A] = [{ text: '同じ曲の新しいかし', startTime: 1000 }];
  const replacement = track(A);
  replacement.metadata.title = 'Updated A title'; replacement.metadata.artist_name = 'Updated A artist';
  await h.refresh(replacement); await settleExcept(h, new Set([old]));
  old.resolve(h.result(old, 'before refresh')); await h.drain();
  const second = params(h).slice(before.calls).find(r => !r.wantSmartPhonetic && r.text === lines(A)[0].text);
  assert.ok(second); assert.equal(second.title, 'Updated A title');
  assert.equal(second.artist, 'Updated A artist'); assert.equal(second.trackId, aid);
});

test('target-language timing is unchanged across the two admitted calls and outer writes', async () => {
  const h = make({ mode1: 'gemini_romaji', mode2: 'gemini_ko' });
  await h.load(track(A)); await h.completeInitial();
  const before = mark(h); select(h, 'all'); const first = h.providerCalls.at(-1);
  h.config.visual['translate:target-language'] = 'ko';
  first.resolve(h.result(first, 'first en')); await h.settle();
  const second = h.providerCalls.at(-1);
  assert.notStrictEqual(second, first);
  second.resolve(h.result(second, 'second ko')); await h.drain();
  assert.deepEqual(params(h).slice(before.calls).map(r => r.lang), ['en', 'ko']);
  assert.deepEqual(h.persistentWrites.slice(before.writes).map(w => w.lang), ['en', 'ko', 'ko', 'ko']);
});

test('source-language override affects phonetic while translation detects selected text', async () => {
  const h = make({ mode1: 'gemini_romaji', mode2: 'gemini_ko', overrides: { [B]: 'fr' } });
  await h.load(track(B)); await h.completeInitial();
  const before = mark(h); select(h, 'all'); await h.drain();
  const requests = params(h).slice(before.calls);
  assert.deepEqual(requests.map(r => r.sourceLang), ['fr', 'ja']);
  assert.ok(requests.every(r => r.trackId === bid));
});
