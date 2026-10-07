import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, flush, A, B, DJ, track } from './helpers/language_selection_harness.mjs';

const chosen = value => value === 'auto' ? null : value;
const mark = h => {
  h.c._dmResults = { sentinel: 'preserve' };
  h.c.lastProcessedUri = h.c.currentTrackUri;
  h.c.lastProcessedMode = 'ready';
};
const publication = h => ({
  override: h.c.trackLanguageOverride,
  results: JSON.parse(JSON.stringify(h.c._dmResults)),
  uri: h.c.lastProcessedUri, mode: h.c.lastProcessedMode,
  renders: h.renders.length, updates: h.visualUpdates.length,
});
const load = async (accepted = track(A), publicItem = accepted) => {
  const h = harness(); await h.play(accepted, publicItem); await h.finish(false); return h;
};

for (const language of ['fr', 'ko', null]) test(`menu default reflects loaded same-track override ${language}`, async () => {
  const h = harness({ seed: language ? [[A, language]] : [] });
  await h.play(track(A)); await h.finish(false); const menu = h.openMenu(); await h.finish();
  const row = menu.items[0].items.find(item => item.key === 'track-language-override');
  assert.equal(row.defaultValue.key, language || 'auto');
  assert.equal(h.requests.filter(q => q.operation !== 'get').length, 0);
  assert.deepEqual(h.snapshotsCleared, []);
});

for (const value of ['ja', 'auto']) {
  test(`accepted B/public A ${value}: selection persists and publishes B`, async () => {
    const h = await load(track(B), track(A)); mark(h);
    h.choose(value); await h.finish();
    assert.equal(h.storage.get(A), 'fr'); assert.equal(h.storage.get(B) ?? null, chosen(value));
    assert.deepEqual(h.snapshotsCleared, [B]); assert.equal(h.c.trackLanguageOverride, chosen(value));
    assert.deepEqual(Object.keys(h.c._dmResults), []); assert.equal(h.c.lastProcessedUri, null);
    assert.equal(h.c.lastProcessedMode, null);
  });

  test(`menu opened on A, selected after accepted B/public A ${value}: current selection origin wins`, async () => {
    const h = await load(); const menu = h.openMenu();
    await h.play(track(B), track(A)); await h.finish(false);
    h.choose(value, menu); await h.finish();
    assert.equal(h.storage.get(A), 'fr'); assert.equal(h.storage.get(B) ?? null, chosen(value));
    assert.deepEqual(h.snapshotsCleared, [B]); assert.equal(h.c.trackLanguageOverride, chosen(value));
  });

  test(`A write exists before B read ${value}: no publication while B awaits storage`, async () => {
    const h = await load(); h.choose(value); await flush(); const write = h.write();
    assert.ok(write.tx.started); h.holdOther(); await h.play(track(B));
    const read = h.requests.find(q => q.operation === 'get' && q.key === B);
    assert.equal(read.tx.started, false, 'earlier overlapping write blocks B read');
    mark(h); const before = publication(h); write.resolve(); await flush(); const after = publication(h);
    const beforeCommit = { readStarted: read.tx.started, writeFinished: write.tx.finished };
    write.tx.complete(); await flush(); const afterCommit = { readSettled: read.settled, loading: h.c.state.isLoading };
    await h.finish();
    assert.deepEqual(after, before, 'all current-container effects belong to B');
    assert.deepEqual(beforeCommit, { readStarted: false, writeFinished: false });
    assert.deepEqual(afterCommit, { readSettled: true, loading: true });
    assert.equal(h.c.trackLanguageOverride, 'ko'); assert.equal(h.storage.get(A) ?? null, chosen(value));
    assert.equal(h.storage.get(B), 'ko'); assert.deepEqual(h.snapshotsCleared, [A]);
  });

  test(`cold A helper open ${value}: completed B keeps its override and render markers`, async () => {
    const h = await load(); assert.equal(h.opens.length, 1, 'ordinary fetch warms service connection only');
    h.holdOpens(); h.choose(value); await flush();
    assert.equal(h.opens.filter(q => !q.settled).length, 1); assert.equal(h.write(), undefined);
    await h.play(track(B)); assert.equal(h.c.state.isLoading, false);
    const read = h.requests.find(q => q.operation === 'get' && q.key === B);
    assert.equal(read.tx.finished, true); mark(h); const before = publication(h);
    await h.finish();
    const write = h.requests.find(q => q.operation !== 'get');
    assert.ok(read.tx.id < write.tx.id, 'B read precedes A write transaction creation');
    assert.deepEqual(publication(h), before); assert.equal(h.storage.get(A) ?? null, chosen(value));
    assert.equal(h.storage.get(B), 'ko'); assert.deepEqual(h.snapshotsCleared, [A]);
  });

  test(`late A ${value}: B keeps Korean settings through actual translation methods`, async () => {
    const h = await load(); h.holdOpens(); h.choose(value); await flush();
    assert.equal(h.opens[1].settled, false); assert.equal(h.write(), undefined);
    await h.play(track(B)); assert.equal(h.opens.length, 2, 'B reuses open service connection');
    assert.equal(h.c.state.isLoading, false); h.enablePresentation(); await flush();
    assert.equal(h.translationCalls.length, 0, 'Korean fixture settings disable translation');
    await h.finish();
    assert.equal(h.c.state.uri, B); assert.equal(h.c.trackLanguageOverride, 'ko');
    assert.equal(h.translationCalls.length, 0);
    assert.equal(h.c.state.currentLyrics?.[0]?.translationText || null, null);
    assert.equal(h.storage.get(A) ?? null, chosen(value)); assert.equal(h.storage.get(B), 'ko');
  });

  test(`same-track ${value}: request success publishes before commit and before origin clear`, async () => {
    const h = await load(); h.choose(value); await flush(); const write = h.write();
    const pending = { override: h.c.trackLanguageOverride, cleared: [...h.snapshotsCleared] };
    await h.play(track(A, 'Changed title')); write.resolve(); await flush();
    const success = { override: h.c.trackLanguageOverride, committed: write.tx.finished, stored: h.storage.get(A) };
    const clear = { ...h.snapshotEvents[0] };
    await h.finish();
    assert.deepEqual(pending, { override: 'fr', cleared: [] });
    assert.deepEqual(success, { override: chosen(value), committed: false, stored: 'fr' });
    assert.equal(clear.override, chosen(value), 'assign override before clearing origin snapshot');
    assert.equal(clear.uri, A); assert.equal(h.c.trackLanguageOverride, chosen(value));
    assert.equal(h.storage.get(A) ?? null, chosen(value));
  });

  test(`same-track ${value}: actual translation uses chosen source language`, async () => {
    const h = await load(track(B)); h.enablePresentation(); await flush(); h.choose(value); await h.finish();
    assert.deepEqual(h.translationCalls.map(call => ({ trackId: call.trackId, sourceLang: call.sourceLang, title: call.title })),
      [{ trackId: B.slice(14), sourceLang: value === 'auto' ? 'en' : 'ja', title: 'Track B' }]);
    assert.equal(h.c.state.currentLyrics[0].translationText, `Inert translation with ${value === 'auto' ? 'en' : 'ja'}`);
  });

  test(`A to B to A ${value}: returning URI still owns completion`, async () => {
    const h = await load(); h.choose(value); await flush(); const write = h.write();
    await h.play(track(B)); await h.play(track(A)); write.resolve(); await flush();
    const atSuccess = h.c.trackLanguageOverride; await h.finish();
    assert.equal(atSuccess, chosen(value)); assert.equal(h.c.currentTrackUri, A);
    assert.equal(h.c.trackLanguageOverride, chosen(value)); assert.equal(h.storage.get(A) ?? null, chosen(value));
  });

  test(`menu opened A, selected aligned B ${value}: menu identity is not frozen`, async () => {
    const h = await load(); const menu = h.openMenu(); await h.play(track(B));
    h.choose(value, menu); await h.finish();
    assert.equal(h.storage.get(A), 'fr'); assert.equal(h.storage.get(B) ?? null, chosen(value));
    assert.equal(h.c.trackLanguageOverride, chosen(value)); assert.deepEqual(h.snapshotsCleared, [B]);
  });

  test(`URI-only snapshot B/public A ${value}: persist B without publishing into container A`, async () => {
    const h = await load(); await h.play({ uri: B }, track(A));
    assert.equal(h.context.window.Utils.getPlayerPlaybackSnapshot().uri, B);
    assert.equal(h.context.window.Utils.resolveStablePlaybackTrack(), null);
    assert.equal(h.c.currentTrackUri, A); mark(h); const before = publication(h);
    h.choose(value); await flush(); h.write().resolve(); await flush(); const after = publication(h);
    await h.finish();
    assert.deepEqual(after, before); assert.equal(h.storage.get(A), 'fr');
    assert.equal(h.storage.get(B) ?? null, chosen(value)); assert.deepEqual(h.snapshotsCleared, [B]);
  });

  test(`pending resolver snapshot B/container A ${value}: matching container alone cannot publish A`, async () => {
    const h = await load(); h.choose(value); await flush(); const write = h.write();
    await h.play({ uri: B }, track(A)); assert.equal(h.c.currentTrackUri, A);
    assert.equal(h.context.window.Utils.getPlayerPlaybackSnapshot().uri, B);
    mark(h); const before = publication(h); write.resolve(); await flush(); const after = publication(h);
    await h.finish();
    assert.deepEqual(after, before); assert.equal(h.storage.get(A) ?? null, chosen(value));
    assert.equal(h.storage.get(B), 'ko'); assert.deepEqual(h.snapshotsCleared, [A]);
    assert.equal(h.translationCalls.length, 0);
  });

  test(`accepted A/container B ${value}: matching playback alone cannot publish A`, async () => {
    const h = await load(); h.holdOpens(); h.choose(value); await flush(); await h.play(track(B));
    // Playback changes before the songchange/queue handler runs; no production method is replaced.
    h.spicetify.Player.data.item = track(A);
    h.spicetify.Platform.PlayerAPI._state = { item: track(A), playbackId: 'return-A', isPaused: false };
    assert.equal(h.context.window.Utils.getPlayerPlaybackSnapshot().uri, A);
    assert.equal(h.c.currentTrackUri, B); mark(h); const before = publication(h);
    await h.finish();
    assert.deepEqual(publication(h), before); assert.equal(h.storage.get(A) ?? null, chosen(value));
    assert.deepEqual(h.snapshotsCleared, [A]);
  });

  for (const moved of [false, true]) {
    test(`open failure ${value}, moved=${moved}: preserve swallowed failure and origin clear`, async () => {
      const h = await load(); h.expectErrors(2); h.holdOpens(); h.choose(value); await flush();
      if (moved) await h.play(track(B)); mark(h); const before = publication(h);
      h.opens.find(q => !q.settled).reject(); await flush(); await h.finish();
      assert.equal(h.storage.get(A), 'fr'); assert.equal(h.storage.get(B), 'ko');
      assert.deepEqual(h.snapshotsCleared, [A]); assert.equal(h.menuTasks[0].error, undefined);
      assert.equal(h.errors.length, 2); assert.match(h.errors[1][0], /Failed to (set|clear) language override/);
      if (moved) assert.deepEqual(publication(h), before);
      else assert.equal(h.c.trackLanguageOverride, chosen(value));
    });

    test(`request error ${value}, moved=${moved}: reject without snapshot clear or local publication`, async () => {
      const h = await load(); h.expectRejections(1); h.choose(value); await flush(); const write = h.write();
      if (moved) { h.holdOther(); await h.play(track(B)); }
      mark(h); const before = publication(h);
      write.reject(); await flush(); const after = publication(h); await h.finish();
      assert.deepEqual(after, before); assert.equal(h.storage.get(A), 'fr'); assert.equal(h.storage.get(B), 'ko');
      assert.deepEqual(h.snapshotsCleared, []); assert.match(h.menuTasks[0].error.message, /inert request failure/);
    });
  }

  test(`abort after request success ${value}: existing publication does not imply durable commit`, async () => {
    const h = await load(); h.choose(value); await flush(); const write = h.write();
    write.resolve(); await flush(); const atSuccess = h.c.trackLanguageOverride;
    write.tx.abort(); await h.finish();
    assert.equal(atSuccess, chosen(value)); assert.equal(h.c.trackLanguageOverride, chosen(value));
    assert.equal(h.storage.get(A), 'fr'); assert.equal(write.tx.aborted, true);
    assert.deepEqual(h.snapshotsCleared, [A]); assert.equal(h.menuTasks[0].error, undefined);
  });

  test(`new dependency policy ${value}: selection snapshot exception rejects without foreign fallback`, async () => {
    const h = await load(track(B), track(A)); h.expectRejections(1); mark(h); const before = publication(h);
    const error = Error('inert snapshot failure'); h.failSnapshot(error); h.choose(value); await flush();
    h.failSnapshot(null); await h.finish();
    assert.equal(h.menuTasks[0].error, error); assert.equal(h.requests.filter(q => q.operation !== 'get').length, 0);
    assert.equal(h.storage.get(A), 'fr'); assert.equal(h.storage.get(B), 'ko');
    assert.deepEqual(h.snapshotsCleared, []); assert.deepEqual(publication(h), before);
  });

  test(`new dependency policy ${value}: completion snapshot exception clears origin then rejects`, async () => {
    const h = await load(); h.expectRejections(1); h.choose(value); await flush(); const write = h.write();
    mark(h); const before = publication(h); const error = Error('inert snapshot failure');
    h.failSnapshot(error); write.resolve(); await flush(); const after = publication(h);
    h.failSnapshot(null); await h.finish();
    assert.equal(h.menuTasks[0].error, error); assert.deepEqual(after, before);
    assert.equal(h.storage.get(A) ?? null, chosen(value)); assert.equal(h.storage.get(B), 'ko');
    assert.deepEqual(h.snapshotsCleared, [A]);
  });
}

for (const availability of ['helper-absent', 'utils-absent', 'snapshot-uri-absent']) {
  test(`${availability}: public URI-only fallback preserves same-track selection`, async () => {
    const h = await load(track(B)); await h.publicOnly({ uri: B });
    if (availability === 'helper-absent') delete h.context.window.Utils.getPlayerPlaybackSnapshot;
    else if (availability === 'utils-absent') delete h.context.window.Utils;
    else h.emptySnapshot();
    h.choose('ja'); await h.finish();
    assert.equal(h.storage.get(B), 'ja'); assert.equal(h.c.trackLanguageOverride, 'ja');
    assert.deepEqual(h.snapshotsCleared, [B]);
  });
}

test('no snapshot URI or public URI: no persistence, invalidation or publication', async () => {
  const h = await load(); h.emptySnapshot(); await h.publicOnly(null); mark(h); const before = publication(h);
  h.choose('ja'); await h.finish();
  assert.equal(h.requests.filter(q => q.operation !== 'get').length, 0);
  assert.deepEqual(h.snapshotsCleared, []); assert.deepEqual(publication(h), before);
});

for (const value of ['ja', 'auto']) test(`missing storage helper ${value}: retain same-track optional-helper behavior`, async () => {
  const h = await load(); delete h.context.window.TrackLanguageDB; h.choose(value); await h.finish();
  assert.equal(h.storage.get(A), 'fr'); assert.equal(h.c.trackLanguageOverride, chosen(value));
  assert.deepEqual(h.snapshotsCleared, [A]);
});

test('missing snapshot-clear method preserves owned publication', async () => {
  const h = await load(); delete h.context.window.LyricsService.clearLyricsSnapshot;
  h.choose('ja'); await h.finish();
  assert.equal(h.storage.get(A), 'ja'); assert.equal(h.c.trackLanguageOverride, 'ja');
  assert.equal(h.visualUpdates.length, 1);
});

for (const second of ['ko', 'auto']) test(`same-URI overlap ja then ${second}: queued opens preserve both publications and store order`, async () => {
  const h = await load(); h.holdOpens(); h.choose('ja'); h.choose(second); await flush();
  const pending = h.opens.filter(op => !op.settled); assert.equal(pending.length, 2);
  // These attempts are rejected before delivering any event or changing state.
  assert.throws(() => pending[1].resolve(), /same-database opens must settle in request order/);
  assert.throws(() => pending[1].reject(), /same-database opens must settle in request order/);
  assert.equal(pending[1].settled, false);
  pending[0].resolve(); await flush(); const firstWrite = h.write();
  pending[1].resolve(); await flush();
  const secondWrite = h.requests.find(q => q.operation !== 'get' && q !== firstWrite);
  assert.equal(secondWrite.tx.started, false, 'earlier overlapping write blocks the second transaction');
  firstWrite.resolve(); await flush();
  const firstSuccess = { override: h.c.trackLanguageOverride, stored: h.storage.get(A), committed: firstWrite.tx.finished };
  firstWrite.tx.complete(); await flush(); secondWrite.resolve(); await flush();
  const afterSecond = h.c.trackLanguageOverride; await h.finish();
  assert.deepEqual(firstSuccess, { override: 'ja', stored: 'fr', committed: false },
    'the first completion still publishes even though a second choice already exists');
  assert.equal(afterSecond, chosen(second)); assert.ok(firstWrite.tx.id < secondWrite.tx.id);
  assert.equal(h.storage.get(A) ?? null, chosen(second)); assert.equal(h.c.trackLanguageOverride, chosen(second));
  assert.deepEqual(h.snapshotsCleared, [A, A]);
});

test('DJ remains an empty-lyrics control with no translation', async () => {
  const h = await load(); h.choose('ja'); await flush(); await h.play(track(DJ, 'DJ narration'));
  assert.equal(h.clock.getSnapshot().djNarration, true); mark(h); const before = publication(h);
  await h.finish();
  assert.deepEqual(publication(h), before); assert.equal(h.c.state.error, 'DJ narration');
  assert.equal(h.c.state.currentLyrics?.length || 0, 0); assert.equal(h.translationCalls.length, 0);
  assert.equal(h.lyricTasks.length, 1); assert.equal(h.storage.get(A), 'ja'); assert.equal(h.storage.has(DJ), false);
});

for (const [name, value, expected, updates] of [
  ['translation-mode:french', true, 'gemini_romaji', 1],
  ['translation-mode-2:french', false, 'none', 1],
  ['translate:pronunciation-notation', ' IPA ', 'ipa', 0],
  ['unrelated-option', 'example', 'example', 1],
]) test(`ordinary configuration handler: ${name}`, async () => {
  const h = await load(); const menu = h.openMenu(); const before = h.visualUpdates.length;
  menu.onChange(name, value); await h.finish();
  assert.equal(h.config.visual[name], expected); assert.equal(h.visualUpdates.length - before, updates);
  assert.deepEqual(h.storageWrites.at(-1), [`ivLyrics:visual:${name}`, expected]);
  assert.deepEqual(h.snapshotsCleared, []); assert.equal(h.storage.get(A), 'fr');
});
