import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { extraction, runConfigSliderCase } from './helpers/config_slider_event_harness.mjs';

// Fixed source-independent schedules and normal-control/event-time oracles.
// Every assertion below runs against whichever actual Settings.js is present.
const matrix = JSON.parse(readFileSync(new URL('./helpers/config_slider_event_cases.json', import.meta.url)));
const observations = [];

for (const spec of matrix.cases) {
  test(`ConfigSlider: ${spec.id} (${spec.class})`, t => {
    const result = runConfigSliderCase(spec);
    observations.push(result);
    const failures = result.checks.filter(check => !check.pass);

    // Every delivered enabled click is a separate event, even when its value
    // repeats. Native disabled suppression and both source guards stay silent.
    for (let i = 0; i < result.trace.length; i++) {
      const entry = result.trace[i];
      if (entry.kind !== 'step' || entry.op !== 'click') continue;
      const next = result.trace.findIndex((item, index) => index > i && item.kind === 'step');
      const eventTrace = result.trace.slice(i, next < 0 ? undefined : next);
      const calls = eventTrace.filter(item => item.kind === 'callback');
      const expected = spec.disabled ? 0 : 1;
      if (calls.length !== expected) failures.push({ category: 'enabled-input-boundary', phase: entry.phase, expected, actual: calls.length });
      for (const call of calls) {
        // The callback observes the event-time ref and already queued value,
        // including before an injected callback/storage/dispatch exception.
        if (call.ref !== call.value || call.pending.at(-1)?.updateType !== 'value' || call.pending.at(-1)?.value !== call.value) {
          failures.push({ category: 'ref-and-value-queued-before-callback', phase: call.phase, value: call.value, ref: call.ref, pending: call.pending });
        }
      }
    }
    for (const entry of result.trace) {
      if (entry.kind === 'callback' && entry.phase.endsWith(':evaluate')) {
        failures.push({ category: 'no-callback-during-updater-evaluation', phase: entry.phase, value: entry.value });
      }
    }
    if (spec.throwAt) {
      // Error identity remains exact. Queue retention and the later next-click
      // continuation are explicitly synthetic, not a React error boundary.
      const boundary = result.observations.find(item => item.label === 'after-handler-boundary');
      const actual = { phase: result.errors[0]?.operation, active: boundary.active, ref: boundary.ref, pending: boundary.pendingSliderCount };
      const expected = { phase: 'click', active: false, ref: true, pending: 1 };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ category: 'chosen-throw-boundary', expected, actual });
    }
    t.diagnostic(`${result.checks.length} fixed field checks; enabled input and updater-phase checks are unconditional`);
    assert.deepEqual(failures, [], `${spec.id}: event-time persistence contract`);
  });
}

after(() => {
  // Optional evidence output changes no schedules, source or expectations.
  if (process.env.IVLYRICS_SLIDER_OBSERVATIONS) {
    writeFileSync(process.env.IVLYRICS_SLIDER_OBSERVATIONS, JSON.stringify({ extraction, observations }, null, 2) + '\n');
  }
});
