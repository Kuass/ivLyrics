import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { extraction, runSettingsOverlayScenario, completeScenario, callbackCounts } from './helpers/settings_overlay_lifecycle.mjs';

const cases = JSON.parse(readFileSync(new URL('./helpers/settings_overlay_cases.json', import.meta.url), 'utf8'));
const observations = [];

// Fixed desired lifecycle checks apply to every checkout. Observed residue is
// kept separately, including not-reached reopen controls when admission fails.
// Repeated-close checks are relational to each scenario's observed prior state.
for (const spec of cases) {
  test(`settings overlay lifecycle: ${spec.id}`, t => {
    const result = completeScenario(runSettingsOverlayScenario(spec));
    observations.push(result);
    t.diagnostic(`${result.checks.length} unconditional lifecycle checks`);
    assert.deepEqual(result.checks.filter(check => !check.pass), [], `${spec.id}: desired cleanup contract`);
  });
}

after(() => {
  // Optional neutral evidence does not change source, schedules or expectations.
  // Releasing these local fixture records is not complete application cleanup:
  // faults may leave residue, and entry RAF remains uncancelled until drained.
  const checks = observations.flatMap(result => result.checks);
  const summary = {
    scenarios: observations.length, checks: checks.length,
    passed: checks.filter(check => check.pass).length,
    failed: checks.filter(check => !check.pass).length,
    notReached: checks.filter(check => check.actual?.status === 'not-reached').length,
    ...callbackCounts()
  };
  if (process.env.IVLYRICS_OVERLAY_OBSERVATIONS) {
    writeFileSync(process.env.IVLYRICS_OVERLAY_OBSERVATIONS, JSON.stringify({ extraction, summary, observations }, null, 2) + '\n');
  }
  assert.equal(observations.length, 38, 'all fixed lifecycle scenarios ran');
  assert.equal(checks.length, 540, 'all desired checks, including not-reached controls, were recorded');
});
