const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'SyncDataCreator.js'), 'utf8');
const componentStart = source.indexOf('const SyncDataCreator =');
assert.notEqual(componentStart, -1, 'SyncDataCreator component should exist');

const sandbox = { Map, Set };
vm.runInNewContext(`${source.slice(0, componentStart)}
this.__syncCreatorSplitTiming = {
  findSyncCreatorParallelSourcePart,
  getSyncCreatorPersistedParallelSplitPoints,
  inheritSyncCreatorParallelPartChars,
  resolveSyncCreatorManualSplitState,
  resolveSyncCreatorParallelTemplateParts
};`, sandbox);

const {
  findSyncCreatorParallelSourcePart,
  getSyncCreatorPersistedParallelSplitPoints,
  inheritSyncCreatorParallelPartChars,
  resolveSyncCreatorManualSplitState,
  resolveSyncCreatorParallelTemplateParts
} = sandbox.__syncCreatorSplitTiming;

const originalTimes = Array.from({ length: 24 }, (_, index) => Number((10 + index * 0.125).toFixed(3)));
const existingLine = {
  start: 0,
  end: 23,
  chars: originalTimes,
  parallel: {
    parts: [
      {
        id: 'a',
        role: 'lead',
        speaker: 'FEMALE 1',
        kind: 'vocal',
        ranges: [{ start: 0, end: 16 }],
        chars: originalTimes.slice(0, 17)
      },
      {
        id: 'b',
        role: 'background',
        speaker: 'FEMALE 2',
        kind: 'effect',
        ranges: [{ start: 18, end: 23 }],
        chars: originalTimes.slice(18, 24)
      }
    ]
  }
};

test('inherits original character timestamps when a synced vocal part is split', () => {
  const splitParts = [
    { id: 'a', ranges: [{ start: 0, end: 5 }] },
    { id: 'b', ranges: [{ start: 7, end: 16 }] },
    { id: 'c', ranges: [{ start: 18, end: 23 }] }
  ];

  assert.deepEqual(
    Array.from(inheritSyncCreatorParallelPartChars(splitParts[0], existingLine)),
    originalTimes.slice(0, 6)
  );
  assert.deepEqual(
    Array.from(inheritSyncCreatorParallelPartChars(splitParts[1], existingLine)),
    originalTimes.slice(7, 17)
  );
  assert.deepEqual(
    Array.from(inheritSyncCreatorParallelPartChars(splitParts[2], existingLine)),
    originalTimes.slice(18, 24)
  );
});

test('inherits vocal metadata from the source range instead of the shifted part id', () => {
  const sourceParts = existingLine.parallel.parts;
  const middleSplit = { id: 'b', ranges: [{ start: 7, end: 16 }] };
  const finalSplit = { id: 'c', ranges: [{ start: 18, end: 23 }] };

  assert.equal(findSyncCreatorParallelSourcePart(middleSplit, sourceParts).id, 'a');
  assert.equal(findSyncCreatorParallelSourcePart(finalSplit, sourceParts).id, 'b');
});

test('resolves a complete re-split template from the already synced line', () => {
  const templateParts = [
    { id: 'a', ranges: [{ start: 0, end: 5 }] },
    { id: 'b', ranges: [{ start: 7, end: 16 }] },
    { id: 'c', ranges: [{ start: 18, end: 23 }] }
  ];
  const resolved = resolveSyncCreatorParallelTemplateParts(templateParts, existingLine);

  assert.deepEqual(Array.from(resolved, item => item.sourcePart.id), ['a', 'a', 'b']);
  assert.deepEqual(Array.from(resolved[0].chars), originalTimes.slice(0, 6));
  assert.deepEqual(Array.from(resolved[1].chars), originalTimes.slice(7, 17));
  assert.deepEqual(Array.from(resolved[2].chars), originalTimes.slice(18, 24));
});

test('restores saved single-range vocal boundaries when an edited song is loaded again', () => {
  assert.deepEqual(
    Array.from(getSyncCreatorPersistedParallelSplitPoints(existingLine.parallel, 0, 24)),
    [18]
  );
});

test('keeps restored boundaries while adding a new split and supports explicit unsplitting', () => {
  const restored = resolveSyncCreatorManualSplitState({}, 0, 24, existingLine.parallel);
  const newlySplit = resolveSyncCreatorManualSplitState({ 0: [6, 18] }, 0, 24, existingLine.parallel);
  const explicitlyCollapsed = resolveSyncCreatorManualSplitState({ 0: [] }, 0, 24, existingLine.parallel);

  assert.equal(restored.hasManualDraft, false);
  assert.deepEqual(Array.from(restored.splitPoints), [18]);
  assert.equal(newlySplit.hasManualDraft, true);
  assert.deepEqual(Array.from(newlySplit.splitPoints), [6, 18]);
  assert.equal(explicitlyCollapsed.hasManualDraft, true);
  assert.deepEqual(Array.from(explicitlyCollapsed.splitPoints), []);
});

test('keeps mandatory merged-line boundaries alongside manual split drafts', () => {
  const state = resolveSyncCreatorManualSplitState({ 0: [6] }, 0, 24, existingLine.parallel, [18]);
  assert.deepEqual(Array.from(state.splitPoints), [6, 18]);
});

test('does not reinterpret grouped or overlapping ranges as manual split points', () => {
  assert.deepEqual(
    Array.from(getSyncCreatorPersistedParallelSplitPoints({
      parts: [
        { id: 'a', ranges: [{ start: 0, end: 3 }, { start: 8, end: 10 }] },
        { id: 'b', ranges: [{ start: 4, end: 7 }] }
      ]
    }, 0, 11)),
    []
  );
  assert.deepEqual(
    Array.from(getSyncCreatorPersistedParallelSplitPoints({
      parts: [
        { id: 'a', ranges: [{ start: 0, end: 5 }] },
        { id: 'b', ranges: [{ start: 5, end: 10 }] }
      ]
    }, 0, 11)),
    []
  );
});

test('falls back to full-line timing when splitting a previously unsplit synced line', () => {
  const unsplitLine = {
    start: 40,
    end: 45,
    chars: [20, 20.1, 20.2, 20.3, 20.4, 20.5]
  };
  const newPart = { id: 'b', ranges: [{ start: 43, end: 45 }] };

  assert.deepEqual(
    Array.from(inheritSyncCreatorParallelPartChars(newPart, unsplitLine)),
    [20.3, 20.4, 20.5]
  );
});

test('does not invent timestamps for character positions that were never synced', () => {
  const partialLine = {
    start: 0,
    end: 5,
    parallel: {
      parts: [{ id: 'a', ranges: [{ start: 0, end: 2 }], chars: [1, 1.1, 1.2] }]
    }
  };

  assert.equal(
    inheritSyncCreatorParallelPartChars({ id: 'b', ranges: [{ start: 3, end: 5 }] }, partialLine),
    undefined
  );
});
