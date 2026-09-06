import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/ivlyrics', import.meta.url), 'utf8');
const functionSource = name => {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 2);
};
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

for (const alias of [false, true]) {
  test(`restore pins and protects its ${alias ? 'latest alias' : 'oldest snapshot'} before making a backup`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'ivlyrics restore-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const oldest = join(dir, '20200101-000000');
    const newer = join(dir, '20210101-000000');
    const newest = join(dir, '20220101-000000');
    for (const path of [oldest, newer, newest]) mkdirSync(join(path, 'Local Storage'), { recursive: true });
    symlinkSync(oldest, join(dir, 'latest'));
    const script = `set -euo pipefail
BACKUP_ROOT=${quote(dir)}
KEEP_SNAPSHOTS=2
PROTECTED_ITEMS=("Local Storage" "IndexedDB")
${functionSource('list_snapshots')}
${functionSource('prune_snapshots')}
${functionSource('cmd_restore')}
require_command() { :; }
die() { printf '%s\\n' "$*" >&2; exit 1; }
spotify_quit() { :; }
heal_links() { :; }
spotify_launch_now_if_owed() { :; }
log() { :; }
snapshot_source_dir() { printf '%s/live' "$BACKUP_ROOT"; }
cmd_backup() {
  ln -sfn ${quote(newest)} "$BACKUP_ROOT/latest"
  prune_snapshots "$1"
}
rsync() {
  [ -d "$3" ] || exit 9
  printf '%s\\n' "$3"
}
cmd_restore ${quote(alias ? join(dir, 'latest') : oldest)}
`;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    // macOS resolves /var to /private/var through pwd -P.
    assert.ok(result.stdout.trim().endsWith(`${oldest.split('/').slice(-2).join('/')}/Local Storage/`), result.stdout);
  });
}

test('invalid snapshots fail before Spotify is stopped or storage is changed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ivlyrics empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = spawnSync('bash', ['-c', `set -euo pipefail
${functionSource('cmd_restore')}
require_command() { :; }
die() { printf '%s' "$*" >&2; exit 1; }
spotify_quit() { printf 'UNEXPECTED'; }
cmd_restore ${quote(dir)}
`], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /no Spotify storage/);
});
