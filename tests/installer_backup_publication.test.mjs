import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  readlinkSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import test from 'node:test';

// Runs only extracted function definitions, never the installer entrypoint.
// To validate a candidate: IVLYRICS_SOURCE_DIR=/path/to/candidate node --test <this file>
// Every filesystem operation stays inside an owned temporary fixture.
const sourceDir = resolve(process.env.IVLYRICS_SOURCE_DIR
  || fileURLToPath(new URL('../', import.meta.url)));
const source = readFileSync(join(sourceDir, 'scripts/ivlyrics'), 'utf8');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const functionSource = name => {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `Missing function ${name}`);
  return source.slice(start, end + 2);
};
const bodies = [
  'item_is_relocated', 'protection_state', 'snapshot_source_dir',
  'cmd_backup', 'prune_snapshots', 'list_snapshots',
  'cmd_guard', 'cmd_protect', 'cmd_update', 'cmd_restore', 'cleanup_work_tmp',
].map(functionSource).join('\n\n');
// Guard against silently testing a different calling pattern in a future source.
for (const name of ['cmd_guard', 'cmd_protect', 'cmd_update', 'cmd_restore']) {
  assert.match(functionSource(name), /cmd_backup(?: "\$\{snapshot\}")? \|\| true/);
}

function fixture(t, caller, scenario) {
  // macOS resolves /var through /private/var when cmd_restore pins a path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), `ivlyrics-backup-${caller}-${scenario}-`)));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backups = join(root, 'backups');
  const cache = join(root, 'cache');
  const oldest = join(backups, '20200101-000000');
  const previous = join(backups, '20210101-000000');
  for (const directory of [backups, cache, join(root, 'safe'), join(root, 'tmp'), join(root, 'download')]) {
    mkdirSync(directory, { recursive: true });
  }
  for (const snapshot of [oldest, previous]) {
    for (const item of ['Local Storage', 'IndexedDB']) {
      mkdirSync(join(snapshot, item), { recursive: true });
      writeFileSync(join(snapshot, item, 'saved.record'), `${snapshot}:${item}`);
    }
  }
  symlinkSync(previous, join(backups, 'latest'));
  if (scenario !== 'empty') {
    for (const item of ['Local Storage', 'IndexedDB']) {
      if (scenario === 'missing-second-source' && item === 'IndexedDB') continue;
      mkdirSync(join(cache, item));
      writeFileSync(join(cache, item, 'first.record'), `current:${item}:first`);
      writeFileSync(join(cache, item, 'second.record'), `current:${item}:second`);
    }
  }
  if (scenario === 'name-collision') mkdirSync(join(backups, '20300101-000000'));
  const invocation = caller === 'restore'
    ? 'cmd_restore "$BACKUP_ROOT/latest"'
    : `cmd_${caller}`;
  const script = `set -euo pipefail
FIXTURE_ROOT=${quote(root)}
BACKUP_ROOT="$FIXTURE_ROOT/backups"
SPOTIFY_CACHE_PROFILE="$FIXTURE_ROOT/cache"
SAFE_PROFILE="$FIXTURE_ROOT/safe"
TMPDIR="$FIXTURE_ROOT/tmp"
APP_DIR="$FIXTURE_ROOT/app"
APP_NAME=fixture
REF=fixture
WORK_TMP=""
KEEP_SNAPSHOTS=2
PROTECTED_ITEMS=("Local Storage" "IndexedDB")
FAIL_COPY=${scenario === 'first-copy-failure' ? 1 : ['second-copy-failure', 'second-copy-interruption'].includes(scenario) ? 2 : 0}
FAIL_MODE=${scenario === 'second-copy-interruption' ? 'interrupt' : 'return'}
COPY_COUNT=0
${bodies}

# Inert collaborators. No original HOME, user profile, Spotify, spicetify,
# launchctl, installer entrypoint, provider or network call is reachable here.
date() { printf '%s\\n' '20300101-000000'; }
require_command() { case "$1" in rsync|spicetify) return 0;; *) return 99;; esac; }
require_macos() { :; }
spotify_is_running() { return ${['running', 'marker-failure'].includes(scenario) ? 0 : 1}; }
spotify_quit() { :; }
spotify_launch_now_if_owed() { :; }
heal_links() { :; }
move_item_to_safe_profile() { :; }
install_guard_agent() { :; }
notify() { :; }
notify_once_per_day() { :; }
installed_version() { printf '%s' 'fixture'; }
download_source() { printf '%s/download' "$FIXTURE_ROOT"; }
sync_app_dir() { :; }
apply_spicetify() { :; }
log() { printf 'log:%s\\n' "$*" >> "$FIXTURE_ROOT/events"; }
warn() { printf 'warn:%s\\n' "$*" >> "$FIXTURE_ROOT/events"; }
die() { printf 'die:%s\\n' "$*" >> "$FIXTURE_ROOT/events"; exit 1; }
rsync() {
  local args=("$@")
  local count="$#"
  local source_path="\${args[$((count - 2))]}"
  local target_path="\${args[$((count - 1))]}"
  case "$source_path" in "$FIXTURE_ROOT"/*) ;; *) return 98;; esac
  case "$target_path" in "$FIXTURE_ROOT"/*) ;; *) return 98;; esac
  COPY_COUNT=$((COPY_COUNT + 1))
  printf 'copy:%s:%s:%s\\n' "$COPY_COUNT" "$source_path" "$target_path" >> "$FIXTURE_ROOT/events"
  if [ "$COPY_COUNT" -eq "$FAIL_COPY" ]; then
    mkdir -p "$target_path"
    cp "$source_path/first.record" "$target_path/first.record"
    printf 'copy-failed:23\\n' >> "$FIXTURE_ROOT/events"
    if [ "$FAIL_MODE" = interrupt ]; then kill -TERM "$$"; fi
    return 23
  fi
  if [ "$2" = '--delete' ]; then
    rm -rf -- "$target_path"
  fi
  mkdir -p "$target_path"
  cp -a "$source_path/." "$target_path/"
  if [ "${scenario}" = marker-failure ] && [ "$COPY_COUNT" -eq 2 ]; then
    mkdir "$target_path/../.taken-while-running"
  fi
}
${scenario === 'directory-failure' ? 'mkdir() { return 29; }' : ''}
${scenario === 'latest-failure' ? 'ln() { return 27; }' : ''}

${invocation}
`;
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { PATH: '/usr/bin:/bin', TMPDIR: join(root, 'tmp'), LC_ALL: 'C' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  const events = existsSync(join(root, 'events')) ? readFileSync(join(root, 'events'), 'utf8') : '';
  const latest = readlinkSync(join(backups, 'latest'));
  const snapshots = readdirSync(backups).filter(name => lstatSync(join(backups, name)).isDirectory()).sort();
  const listing = spawnSync('bash', ['--noprofile', '--norc', '-c',
    `set -euo pipefail\nBACKUP_ROOT=${quote(backups)}\n${functionSource('list_snapshots')}\nlist_snapshots\n`], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
  });
  assert.equal(listing.status, 0, listing.stderr);
  const listedSnapshots = listing.stdout.trim().split('\n').filter(Boolean);
  const newSnapshot = snapshots.find(name => name.startsWith('20300101'));
  const observation = {
    sourceDir, caller, scenario, exitStatus: result.status, signal: result.signal, latest,
    listedSnapshots, defaultRestoreChoice: listedSnapshots[0] || null,
    snapshots, oldestRetained: existsSync(oldest), previousRetained: existsSync(previous),
    newSnapshotHasLocalStorage: !!newSnapshot && existsSync(join(backups, newSnapshot, 'Local Storage', 'second.record')),
    newSnapshotHasIndexedDBFirst: !!newSnapshot && existsSync(join(backups, newSnapshot, 'IndexedDB', 'first.record')),
    newSnapshotHasIndexedDBSecond: !!newSnapshot && existsSync(join(backups, newSnapshot, 'IndexedDB', 'second.record')),
    newSnapshotRunningMarker: !!newSnapshot && existsSync(join(backups, newSnapshot, '.taken-while-running')),
    events, stderr: result.stderr,
  };
  return { ...observation, root, backups, previous, oldest,
    scriptPrelude: script.slice(0, script.lastIndexOf(invocation)), cache };
}

for (const caller of ['backup', 'guard', 'protect', 'update', 'restore']) {
  test(`${caller}: normal two-source copy publishes and retains the two newest snapshots`, t => {
    const o = fixture(t, caller, 'normal');
    assert.equal(o.exitStatus, 0, o.stderr);
    assert.equal(o.latest, join(o.backups, '20300101-000000'));
    assert.deepEqual(o.snapshots, ['20210101-000000', '20300101-000000']);
    assert.equal(o.newSnapshotHasLocalStorage, true);
    assert.equal(o.newSnapshotHasIndexedDBSecond, true);
    assert.match(o.events, /log:Snapshot saved:/);
  });

  test(`${caller}: absent sources preserve latest and all existing snapshots`, t => {
    const o = fixture(t, caller, 'empty');
    assert.equal(o.exitStatus, caller === 'backup' ? 1 : 0, o.stderr);
    assert.equal(o.latest, o.previous);
    assert.deepEqual(o.snapshots, ['20200101-000000', '20210101-000000']);
    assert.match(o.events, /warn:nothing to back up:/);
    assert.doesNotMatch(o.events, /log:Snapshot saved:/);
  });

  test(`${caller}: one absent source still permits the other source to be backed up`, t => {
    const o = fixture(t, caller, 'missing-second-source');
    assert.equal(o.exitStatus, 0, o.stderr);
    assert.equal(o.latest, join(o.backups, '20300101-000000'));
    assert.equal(o.newSnapshotHasLocalStorage, true);
    assert.equal(o.newSnapshotHasIndexedDBFirst, false);
    assert.match(o.events, /log:Snapshot saved:/);
    assert.doesNotMatch(o.events, /copy-failed:/);
  });

  test(`${caller}: a present source failing on copy two must not publish or prune`, t => {
    const o = fixture(t, caller, 'second-copy-failure');
    assert.equal(caller === 'backup' ? o.exitStatus !== 0 : o.exitStatus === 0, true, o.stderr);
    assert.match(o.events, /copy-failed:23/);
    assert.equal(o.latest, o.previous, 'failed copy replaced the last complete latest snapshot');
    assert.equal(o.oldestRetained, true, 'failed copy triggered retention and deleted a complete snapshot');
    assert.equal(o.previousRetained, true);
    assert.doesNotMatch(o.events, /log:Snapshot saved:/, 'failed copy emitted a success log');
    assert.equal(o.defaultRestoreChoice, o.previous, 'default restore can select the incomplete snapshot');
  });
}

test('interrupted direct backup cannot leave a partial snapshot selectable by default restore', t => {
  const o = fixture(t, 'backup', 'second-copy-interruption');
  assert.ok(o.signal === 'SIGTERM' || o.exitStatus === 143, 'fixture process must terminate from SIGTERM');
  assert.equal(o.latest, o.previous);
  assert.equal(o.oldestRetained, true);
  assert.doesNotMatch(o.events, /log:Snapshot saved:/);
  assert.equal(o.defaultRestoreChoice, o.previous, 'interrupted snapshot became selectable');
});

test('default restore after failed direct backup selects the existing complete snapshot', t => {
  const o = fixture(t, 'backup', 'second-copy-failure');
  assert.equal(existsSync(join(o.cache, 'IndexedDB', 'second.record')), true);
  const restoreScript = `${o.scriptPrelude}\nFAIL_COPY=0\ncmd_restore\n`;
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', restoreScript], {
    cwd: o.root, encoding: 'utf8', timeout: 10_000,
    env: { PATH: '/usr/bin:/bin', TMPDIR: join(o.root, 'tmp'), LC_ALL: 'C' },
  });
  assert.equal(result.status, 0, result.stderr);
  const restoredFromComplete = existsSync(join(o.cache, 'IndexedDB', 'saved.record'));
  assert.equal(restoredFromComplete, true, 'default restore selected an incomplete numeric snapshot');
});


for (const caller of ['backup', 'guard']) {
  test(`${caller}: first-copy failure leaves complete snapshots and latest untouched`, t => {
    const o = fixture(t, caller, 'first-copy-failure');
    assert.equal(caller === 'backup' ? o.exitStatus !== 0 : o.exitStatus === 0, true, o.stderr);
    assert.equal(o.latest, o.previous);
    assert.equal(o.defaultRestoreChoice, o.previous);
    assert.equal(o.oldestRetained, true);
    assert.doesNotMatch(o.events, /copy:2:/);
    assert.doesNotMatch(o.events, /log:Snapshot saved:/);
  });
}

for (const scenario of ['directory-failure', 'marker-failure']) {
  test(`guard: ${scenario} cannot publish or prune`, t => {
    const o = fixture(t, 'guard', scenario);
    assert.equal(o.exitStatus, 0, o.stderr);
    assert.equal(o.latest, o.previous);
    assert.equal(o.defaultRestoreChoice, o.previous);
    assert.equal(o.oldestRetained, true);
    assert.doesNotMatch(o.events, /log:Snapshot saved:/);
  });
}

test('latest link failure retains the complete new snapshot without pruning old ones', t => {
  const o = fixture(t, 'guard', 'latest-failure');
  assert.equal(o.exitStatus, 0, o.stderr);
  assert.equal(o.latest, o.previous);
  assert.equal(o.newSnapshotHasIndexedDBSecond, true);
  assert.equal(o.oldestRetained, true);
  assert.doesNotMatch(o.events, /log:Snapshot saved:/);
});

test('a backup taken while Spotify runs keeps its advisory marker', t => {
  const o = fixture(t, 'backup', 'running');
  assert.equal(o.exitStatus, 0, o.stderr);
  assert.equal(o.newSnapshotRunningMarker, true);
  assert.equal(o.newSnapshotHasIndexedDBSecond, true);
});

test('a successful same-second backup preserves the existing name and uses a suffix', t => {
  const o = fixture(t, 'backup', 'name-collision');
  assert.equal(o.exitStatus, 0, o.stderr);
  assert.equal(o.latest, join(o.backups, '20300101-000000-2'));
  assert.equal(existsSync(join(o.backups, '20300101-000000')), true);
  assert.equal(existsSync(join(o.latest, 'IndexedDB', 'second.record')), true);
});
