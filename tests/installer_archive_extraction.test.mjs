import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceDir = process.env.IVLYRICS_SOURCE_ROOT
  ? resolve(process.env.IVLYRICS_SOURCE_ROOT)
  : fileURLToPath(new URL('../', import.meta.url));
const helper = fileURLToPath(new URL('./helpers/installer_archive_fixture.py', import.meta.url));
// Real tar sees only archives generated inside the helper's owned temp fixture.
// Curl, app installation, Spotify and all update effects are inert collaborators.
const run = spawnSync('python3', [helper, '--source-root', sourceDir], {
  encoding: 'utf8', timeout: 60_000,
});
assert.equal(run.error, undefined, run.error?.message);
assert.ok([0, 1].includes(run.status), run.stderr);
const report = JSON.parse(run.stdout);
assert.equal(report.results.length, 10);
for (const result of report.results) {
  test(`${result.mode}: ${result.case} archive respects extraction outcome before app effects`, () => {
    assert.equal(result.tar_statuses.length, 1);
    if (result.case === 'truncated') {
      assert.notEqual(result.tar_statuses[0], 0, 'native tar must reject the truncated synthetic archive');
    }
    assert.equal(result.safety_passed, true, JSON.stringify(result, null, 2));
  });
}
