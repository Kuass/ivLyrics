import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const sourceFile = process.env.IVLYRICS_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_SOURCE_DIR, 'scripts/ivlyrics')
  : new URL('../scripts/ivlyrics', import.meta.url);
const source = readFileSync(sourceFile, 'utf8');
const functionSource = name => {
  const start = source.indexOf(`${name}() {`), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end + 2);
};
const bodies = ['on_exit', 'spotify_launch_flags', 'spotify_quit', 'spotify_launch_now_if_owed', 'spotify_launch'].map(functionSource).join('\n');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
// Only extracted functions execute. All app, log, cleanup and process-control
// collaborators are inert; no installer entrypoint, profile or app is accessed.
function run(t, { command = 'spotify_launch_now_if_owed', owed = true, failures = 0, status = 42, flags = '', extra = '', guarded = false, exitTrap = true, logFails = false, warnFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ivlyrics-launch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = `set -euo pipefail
RELAUNCH_SPOTIFY=${owed}
ATTEMPTS=0
IVLYRICS_SPOTIFY_ARGS=${quote(extra)}
${bodies}
cleanup_work_tmp() { printf 'cleanup\\n'; }
release_lock() { printf 'release\\n'; }
log() { printf 'log:%s\\n' "$*"; return ${logFails ? 24 : 0}; }
warn() { printf 'warn:%s\\n' "$*"; return ${warnFails ? 25 : 0}; }
spicetify() { [ "$1" = config ] && [ "$2" = spotify_launch_flags ] || return 99; printf '%s\\r\\n' ${quote(flags)}; }
spotify_is_running() { return 1; }
osascript() { printf 'UNEXPECTED_OSASCRIPT\\n'; return 99; }
pkill() { printf 'UNEXPECTED_PKILL\\n'; return 99; }
sleep() { printf 'UNEXPECTED_SLEEP\\n'; return 99; }
open() {
  ATTEMPTS=$((ATTEMPTS + 1))
  printf 'attempt:%s\\n' "$ATTEMPTS"
  printf 'arg:%s\\n' "$@"
  if [ "$ATTEMPTS" -le ${failures} ]; then return ${status}; fi
}
${exitTrap ? `trap 'on_exit; printf "final-debt:%s\\n" "$RELAUNCH_SPOTIFY"' EXIT` : ''}
${guarded ? `result=0\n${command} || result=$?\nprintf 'result:%s\\n' "$result"` : command}
printf 'body-debt:%s\\n' "$RELAUNCH_SPOTIFY"
`;
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script], {
    cwd: dir, encoding: 'utf8', timeout: 5000,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TMPDIR: dir },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.doesNotMatch(result.stdout, /UNEXPECTED_/, result.stdout);
  return { ...result, attempts: (result.stdout.match(/^attempt:/gm) || []).length,
    launches: (result.stdout.match(/^log:Spotify launched\.$/gm) || []).length,
    warnings: (result.stdout.match(/^warn:/gm) || []).length,
    args: result.stdout.split('\n').filter(line => line.startsWith('arg:')).map(line => line.slice(4)),
  };
}

test('successful owed launch settles once before the exit trap', t => {
  const r=run(t);assert.equal(r.status,0,r.stdout);assert.equal(r.attempts,1);assert.equal(r.launches,1);assert.match(r.stdout,/body-debt:false/);
});
test('no launch debt does not open an already-closed app', t => {
  const r=run(t,{owed:false});assert.equal(r.status,0,r.stdout);assert.equal(r.attempts,0);assert.equal(r.launches,0);
});
test('quitting an already-closed app creates no launch debt or app calls', t => {
  const r=run(t,{owed:false,command:'spotify_quit; spotify_launch_now_if_owed'});assert.equal(r.status,0,r.stdout);assert.equal(r.attempts,0);
});
test('a failed owed launch leaves the exit trap able to retry once', t => {
  const r=run(t,{failures:1});assert.equal(r.status,42,r.stdout);assert.equal(r.attempts,2,r.stdout);assert.equal(r.launches,1);assert.equal(r.warnings,1);
});
test('permanent launch failure remains bounded and never logs success', t => {
  const r=run(t,{failures:9});assert.equal(r.status,42,r.stdout);assert.equal(r.attempts,2,r.stdout);assert.equal(r.launches,0);assert.equal(r.warnings,2);
});
test('a guarded failed launch returns the native status and warns instead of logging success', t => {
  const r=run(t,{command:'spotify_launch',failures:1,guarded:true,exitTrap:false});assert.equal(r.status,0,r.stdout);assert.match(r.stdout,/result:42/);assert.equal(r.launches,0);assert.equal(r.warnings,1);
});
test('exit-trap launch failure preserves the original command exit status and reports failure', t => {
  const r=run(t,{command:'exit 17',failures:1});assert.equal(r.status,17,r.stdout);assert.equal(r.attempts,1);assert.equal(r.launches,0,r.stdout);assert.equal(r.warnings,1);
});
test('successful exit-trap launch preserves the original command exit status', t => {
  const r=run(t,{command:'exit 17'});assert.equal(r.status,17,r.stdout);assert.equal(r.attempts,1);assert.equal(r.launches,1);
});
test('native failure status is not replaced by a generic error', t => {
  const r=run(t,{command:'spotify_launch',failures:1,status:63,guarded:true,exitTrap:false});assert.match(r.stdout,/result:63/);assert.equal(r.launches,0);
});
test('empty launch flags preserve the existing open invocation', t => {
  const r=run(t);assert.deepEqual(r.args,['-a','Spotify']);
});
test('configured and extra launch flags keep their existing word splitting and CR cleanup', t => {
  const r=run(t,{flags:'--disable-gpu --force-device-scale-factor=1.25',extra:'--window-size=1200,800'});
  assert.deepEqual(r.args,['-a','Spotify','--args','--disable-gpu','--force-device-scale-factor=1.25','--window-size=1200,800']);
});
test('extra-only launch flags do not add an empty argument', t => {
  const r=run(t,{extra:'--disable-gpu'});assert.deepEqual(r.args,['-a','Spotify','--args','--disable-gpu']);
});
test('a log failure after native launch success does not create an extra launch', t => {
  const r=run(t,{logFails:true});assert.equal(r.status,24,r.stdout);assert.equal(r.attempts,1,r.stdout);
});

test('warning failure cannot replace the native launch error or prevent its owed retry', t => {
  const r=run(t,{failures:1,status:63,warnFails:true});
  assert.equal(r.status,63,r.stdout);assert.equal(r.attempts,2,r.stdout);assert.equal(r.launches,1);assert.equal(r.warnings,1);
});
