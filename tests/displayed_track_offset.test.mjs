import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtime, track, lines, micro, extractionManifest } from './helpers/displayed_track_offset_harness.mjs';

// Ready-admission witnesses are kept separate from the optional argument API
// and directly injected notification compatibility boundaries. All use the same
// desired bytes on baseline and candidate; no historical wrong-output toggle.
const records = [];
const active = snapshot => snapshot.rows.filter(row => row.active).map(row => row.text);
const neutral = { pendingReads: 0, pendingProviders: 0, listeners: 0, animations: 0,
  visibility: 0, hookFibers: 0, classQueue: 0, timers: 0, disposed: true };
function scenario(category, name, options, exercise) {
  test(`${category}: ${name} (${options.stateMode}, ${options.compact === false ? 'expanded' : 'compact'})`, async t => {
    const h = runtime(options);
    const record = { category, name, options, stages: {} };
    records.push(record);
    t.after(async () => {
      record.drain = await h.drain();
      assert.deepEqual(record.drain, neutral, 'drain even after a failed desired assertion');
      assert.equal(h.trace.some(row => row[0] === 'ignored-unmounted-state'), false);
    });
    await exercise(h, record.stages);
  });
}
function assertTiming(snapshot, uri, offset, position, expectedActive) {
  assert.equal(snapshot.reads.at(-1)?.key, uri, 'exact saved offset key');
  assert.equal(snapshot.offset, offset, 'saved offset belongs to displayed lyrics');
  assert.equal(snapshot.position, position, 'safe progress plus displayed offset');
  assert.deepEqual(active(snapshot), expectedActive, 'actual engine/projected active row');
  for (const row of snapshot.rows) {
    assert.equal(row.className.includes('lyrics-lyricsContainer-LyricsLine-active'), row.active);
  }
}
async function admitB(h) {
  await h.settle();
  h.setInternal('B');
  await h.transition('B');
  const loading = h.render(); h.flushEffects();
  assert.equal(loading.isLoading, true);
  assert.equal(loading.rows.length, 0);
  assert.equal(h.c.state.currentLyrics.length, 0);
  await h.ready('B');
  return { loading, ready: await h.settle() };
}
for (const stateMode of ['immediate', 'queued']) for (const compact of [true, false]) {
  const options = { stateMode, compact };
  scenario('admission-witness', 'ready B while public A lags', options, async (h, stages) => {
    stages.initial = await h.settle();
    Object.assign(stages, await admitB(h));
    h.tick(100); stages.persisted = await h.settle();
    h.setPublic('B'); h.tick(100); stages.catchup = await h.settle();
    assert.deepEqual(active(stages.initial), ['A:second']);
    assert.equal(stages.ready.childTrackUri, track('B').uri);
    assert.equal(stages.ready.playback.uri, track('B').uri);
    assert.equal(stages.ready.publicUri, track('A').uri);
    assertTiming(stages.ready, track('B').uri, -1000, 1500, ['B:first']);
    assertTiming(stages.persisted, track('B').uri, -1000, 1600, ['B:first']);
    assertTiming(stages.catchup, track('B').uri, -1000, 1700, ['B:first']);
    assert.equal(stages.ready.events.at(-1).index, 0);
    assert.equal(stages.catchup.reads.length, stages.ready.reads.length, 'public catchup does not change displayed URI effect');
  });
  scenario('admission-witness', 'cancelled skip admits A while public B leads', options, async (h, stages) => {
    await h.settle(); h.setPublic('B'); await h.transition('B');
    stages.loading = h.render(); h.flushEffects();
    assert.equal(stages.loading.isLoading, true); assert.equal(stages.loading.rows.length, 0);
    await h.ready('A'); stages.ready = await h.settle();
    h.setInternal('B'); await h.transition('B'); h.render(); h.flushEffects();
    await h.ready('B'); stages.aligned = await h.settle();
    assert.equal(stages.ready.playback.uri, track('A').uri);
    assert.equal(stages.ready.publicUri, track('B').uri);
    assert.equal(stages.ready.childTrackUri, track('A').uri);
    assertTiming(stages.ready, track('A').uri, 2000, 4500, ['A:second']);
    assertTiming(stages.aligned, track('B').uri, -1000, 1500, ['B:first']);
    assert.equal(stages.ready.events.at(-1).index, 1);
  });
  scenario('argument-contract', 'displayed B accepts B event and ignores public A event', options, async (h, stages) => {
    Object.assign(stages, await admitB(h));
    // Explicit listener boundary after readonly completion, not a toolbar write.
    h.notify('B', -2000); stages.matching = await h.settle();
    h.notify('A', 1000); stages.foreign = await h.settle();
    assertTiming(stages.ready, track('B').uri, -1000, 1500, ['B:first']);
    assertTiming(stages.matching, track('B').uri, -2000, 500, ['B:first']);
    assertTiming(stages.foreign, track('B').uri, -2000, 500, ['B:first']);
  });
  scenario('legacy-effect-boundary', 'read success before deferred cleanup remains permitted', options, async (h, stages) => {
    await h.settlePrimitive([], { releaseReads: false });
    h.setPublic('B'); h.renderPrimitive(); await h.release(0); h.flushStates();
    stages.beforeCleanup = h.snapshot();
    h.flushEffects(); await micro();
    assert.equal(h.reads.length, 2);
    stages.next = await h.settlePrimitive();
    assert.equal(stages.beforeCleanup.offset, 2000);
    assert.equal(stages.next.offset, -1000);
    assert.equal(stages.next.position, 1500);
  });
  scenario('existing-lifecycle', 'loading unmount retires old pending read', options, async (h, stages) => {
    await h.settle({ releaseReads: false });
    h.setInternal('B'); h.setPublic('B'); await h.transition('B');
    stages.loading = h.render(); h.flushEffects(); assert.equal(stages.loading.rows.length, 0);
    await h.ready('B'); await h.settle({ releaseReads: false });
    assert.equal(h.reads.length, 2);
    await h.release(1); stages.correct = await h.settle({ releaseReads: false });
    await h.release(0); stages.late = await h.settle();
    assertTiming(stages.correct, track('B').uri, -1000, 1500, ['B:first']);
    assertTiming(stages.late, track('B').uri, -1000, 1500, ['B:first']);
  });
  scenario('existing-lifecycle', 'same URI refresh remount keeps the saved value', options, async (h, stages) => {
    await h.settle(); const pending = h.c.fetchLyrics(track('A'), -1, true);
    h.flushStates(); await micro(); h.flushStates(); stages.loading = h.render(); h.flushEffects();
    assert.equal(stages.loading.rows.length, 0);
    await h.ready('A'); await pending; stages.ready = await h.settle();
    assertTiming(stages.ready, track('A').uri, 2000, 4500, ['A:second']);
    assert.equal(h.reads.length, 2);
  });
  scenario('existing-lifecycle', 'A B A remounts retire both old reads', options, async (h, stages) => {
    await h.settle({ releaseReads: false });
    for (const id of ['B', 'A']) {
      h.setPublic(id); h.setInternal(id); await h.transition(id);
      h.render(); h.flushEffects(); await h.ready(id); await h.settle({ releaseReads: false });
    }
    assert.equal(h.reads.length, 3);
    await h.release(2); stages.current = await h.settle({ releaseReads: false });
    await h.release(1); await h.release(0); stages.late = await h.settle();
    assertTiming(stages.current, track('A').uri, 2000, 4500, ['A:second']);
    assertTiming(stages.late, track('A').uri, 2000, 4500, ['A:second']);
  });
  scenario('existing-listener', 'matching and foreign events after read, then teardown', options, async (h, stages) => {
    await h.settle({ releaseReads: false }); await h.release(0); await h.settle();
    h.notify('A', -1000); stages.matching = await h.settle();
    h.notify('B', 3000); stages.foreign = await h.settle();
    h.unmount(); h.notify('A', 4000);
    assertTiming(stages.matching, track('A').uri, -1000, 1500, ['A:first']);
    assertTiming(stages.foreign, track('A').uri, -1000, 1500, ['A:first']);
  });
  scenario('legacy-effect-boundary', 'cleanup suppresses late read after public URI changes', options, async (h, stages) => {
    await h.settlePrimitive([], { releaseReads: false }); h.setPublic('B');
    h.renderPrimitive(); h.flushEffects(); await micro(); assert.equal(h.reads.length, 2);
    await h.release(0); h.flushStates(); h.renderPrimitive(); stages.retired = h.snapshot();
    await h.release(1); stages.next = await h.settlePrimitive();
    assert.equal(stages.retired.offset, 0);
    assert.equal(stages.next.offset, -1000);
    assert.equal(stages.next.position, 1500);
  });
  scenario('existing-lifecycle', 'teardown cancels a pending read', options, async h => {
    await h.settle({ releaseReads: false }); h.unmount(); await h.release(0);
    assert.equal(h.trace.some(row => row[0] === 'ignored-unmounted-state'), false);
  });
  scenario('existing-admission', 'missing internal metadata blocks B admission', options, async (h, stages) => {
    await h.settle(); h.setInternal('B', { metadata: false }); await h.transition('B');
    stages.loading = h.render(); h.flushEffects();
    assert.equal(stages.loading.current, track('A').uri);
    assert.equal(stages.loading.status, 'loading');
    assert.equal(stages.loading.rows.length, 0); assert.equal(h.requests.length, 0);
  });
}

const legacyArguments = [['omitted', []], ['undefined', [undefined]], ['empty', ['']], ['null', [null]]];
const genericUris = ['spotify:local:Artist:Album:Song:123', 'spotify:episode:EEEEEEEEEEEEEEEEEEEEEE', 'custom:opaque:Z', '  custom:opaque:Z  '];
for (const stateMode of ['immediate', 'queued']) {
  for (const [label, args] of legacyArguments) {
    scenario('legacy-argument', `${label} primitive falls back to public item`, { stateMode }, async (h, stages) => {
      stages.ready = await h.settlePrimitive(args);
      assert.equal(stages.ready.position, 4500); assert.equal(h.reads.length, 1);
      assert.equal(h.reads[0].key, track('A').uri);
    });
    for (const compact of [true, false]) {
      scenario('legacy-renderer', `${label} renderer falls back to public item`, { stateMode, compact }, async (h, stages) => {
        const props = { mode: 1, currentLyrics: lines('A'), synced: lines('A') };
        if (args.length) props.trackUri = args[0];
        h.setRendererProps(props); stages.ready = await h.settle();
        assertTiming(stages.ready, track('A').uri, 2000, 4500, ['A:second']);
      });
    }
  }
  scenario('legacy-argument', 'absent public item has no DB read', { stateMode }, async (h, stages) => {
    h.context.Spicetify.Player.data.item = null;
    stages.ready = await h.settlePrimitive();
    assert.equal(stages.ready.position, 2500); assert.equal(h.reads.length, 0);
  });
  for (const compact of [true, false]) {
    scenario('legacy-renderer', 'absent public item has zero offset and no DB read', { stateMode, compact }, async (h, stages) => {
      h.context.Spicetify.Player.data.item = null;
      h.setRendererProps({ mode: 1, currentLyrics: lines('A'), synced: lines('A') });
      stages.ready = await h.settle();
      assert.equal(stages.ready.offset, 0); assert.equal(stages.ready.position, 2500);
      assert.equal(h.reads.length, 0); assert.deepEqual(active(stages.ready), ['A:first']);
    });
  }
  scenario('existing-global-offset', 'actual Utils reader and global notification retain delay arithmetic', { stateMode }, async (h, stages) => {
    h.installGlobalOffsetReader(); h.CONFIG.visual.delay = 100; h.CONFIG.visual['global-sync-offset'] = 300;
    stages.read = await h.settlePrimitive();
    h.notifyGlobal(-500); stages.event = await h.settlePrimitive();
    h.notifyGlobal('invalid'); stages.invalid = await h.settlePrimitive();
    assert.equal(stages.read.position, 4900); assert.equal(stages.event.position, 4100);
    assert.equal(stages.invalid.position, 4600); assert.equal(h.reads.length, 1);
  });
  for (const uri of genericUris) for (const explicit of [false, true]) {
    scenario(explicit ? 'argument-contract' : 'legacy-key', `exact URI ${JSON.stringify(uri)}`, { stateMode, offsets: { [uri]: -500 } }, async (h, stages) => {
      if (!explicit) h.context.Spicetify.Player.data.item = { uri };
      h.CONFIG.visual.delay = 100; h.CONFIG.visual['global-sync-offset'] = 300;
      const args = explicit ? [uri] : [];
      stages.read = await h.settlePrimitive(args);
      h.notifyUri(uri, 100); stages.matching = await h.settlePrimitive(args);
      h.notifyGlobal(500); stages.global = await h.settlePrimitive(args);
      assert.equal(h.reads.length, 1); assert.equal(h.reads[0].key, uri);
      assert.equal(stages.read.position, 2400);
      assert.equal(stages.matching.position, 3000);
      assert.equal(stages.global.position, 3200);
    });
  }
  scenario('argument-contract', 'explicit URI works without a public item', { stateMode }, async (h, stages) => {
    h.context.Spicetify.Player.data.item = null;
    stages.ready = await h.settlePrimitive([track('B').uri]);
    assert.equal(h.reads[0]?.key, track('B').uri); assert.equal(stages.ready.position, 1500);
  });
  scenario('argument-contract', 'public-only change leaves displayed effect and pending read intact', { stateMode }, async (h, stages) => {
    await h.settle({ releaseReads: false }); h.setPublic('B'); h.render(); h.flushEffects(); await micro();
    await h.release(0); stages.ready = await h.settle();
    assert.equal(h.reads.length, 1);
    assertTiming(stages.ready, track('A').uri, 2000, 4500, ['A:second']);
  });
  scenario('argument-effect-boundary', 'explicit URI replacement keeps old value until read completes', { stateMode }, async (h, stages) => {
    await h.settlePrimitive([track('A').uri]);
    stages.pending = await h.settlePrimitive([track('B').uri], { releaseReads: false });
    assert.equal(h.reads.length, 2, 'explicit URI replacement starts its own read');
    await h.release(1); stages.ready = await h.settlePrimitive([track('B').uri]);
    assert.equal(stages.pending.offset, 2000, 'no new immediate reset policy');
    assert.equal(stages.ready.offset, -1000);
  });
  scenario('existing-read-event-policy', 'injected same URI event does not invalidate captured readonly result', { stateMode }, async (h, stages) => {
    await h.settlePrimitive([], { releaseReads: false });
    h.notify('A', 1000); stages.event = await h.settlePrimitive([], { releaseReads: false });
    await h.release(0); stages.read = await h.settlePrimitive();
    assert.equal(stages.event.offset, 1000); assert.equal(stages.read.offset, 2000);
    // Compatibility only: no real write transaction or notification order claim.
  });
  for (const [mode, compact, label] of [[1, true, 'compact synced'], [1, false, 'expanded synced'], [0, true, 'karaoke'], [3, true, 'word karaoke']]) {
    for (const [displayed, publicId] of [['B', 'A'], ['A', 'B']]) {
      scenario('renderer-argument-contract', `${label} routes displayed ${displayed} while public ${publicId}`, { stateMode, compact, publicId, internalId: displayed }, async (h, stages) => {
        const lyrics = lines(displayed);
        h.setRendererProps({ mode, trackUri: track(displayed).uri, currentLyrics: lyrics, synced: lyrics, karaoke: lyrics });
        stages.ready = await h.settle();
        const isKara = mode !== 1, offset = displayed === 'B' ? -1000 : 2000, position = 2500 + offset;
        assertTiming(stages.ready, track(displayed).uri, offset, position, [`${displayed}:${displayed === 'B' ? 'first' : 'second'}`]);
        assert.equal(stages.ready.childComponent, mode === 1 && !compact ? 'SyncedExpandedLyricsPage' : 'SyncedLyricsPage');
        assert.equal(stages.ready.isKara, isKara);
        assert.equal(stages.ready.karaokeGranularity, mode === 3 ? 'word' : mode === 0 ? 'character' : undefined);
        if (isKara) assert.ok(stages.ready.rows.filter(row => row.active).every(row => row.position === position));
      });
    }
  }
}
after(() => {
  if (!process.env.IVLYRICS_OFFSET_EVIDENCE_DIR) return;
  const directory = resolve(process.env.IVLYRICS_OFFSET_EVIDENCE_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'extraction-manifest.json'), JSON.stringify(extractionManifest, null, 2) + '\n');
  writeFileSync(resolve(directory, 'observations.json'), JSON.stringify(records, null, 2) + '\n');
});
