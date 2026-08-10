const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const shellInstaller = fs.readFileSync(path.join(root, 'updater/install.sh'), 'utf8');
const powershellInstaller = fs.readFileSync(path.join(root, 'updater/install.ps1'), 'utf8');
const releaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/pc-release.yml'), 'utf8');

test('installers use HTTPS-only proxy endpoints', () => {
  assert.doesNotMatch(shellInstaller, /http:\/\/ivlis\.kr/i);
  assert.doesNotMatch(powershellInstaller, /http:\/\/ivlis\.kr/i);
  assert.match(shellInstaller, /--proto '=https'/);
});

test('installers verify release archive SHA-256 before extraction', () => {
  assert.match(shellInstaller, /calculate_sha256/);
  assert.match(shellInstaller, /ACTUAL_SHA256/);
  assert.match(powershellInstaller, /Get-FileHash[^\n]+SHA256/);
  assert.match(powershellInstaller, /Release checksum verification failed/);
});

test('Unix installer uses an unpredictable private temporary directory', () => {
  assert.match(shellInstaller, /mktemp -d/);
  assert.doesNotMatch(shellInstaller, /TEMP_ZIP="\/tmp\/ivLyrics_latest\.zip"/);
});

test('release workflow publishes the archive and checksum consumed by installers', () => {
  assert.match(releaseWorkflow, /git archive[^\n]+ivLyrics\/[^\n]+HEAD/);
  assert.match(releaseWorkflow, /sha256sum ivLyrics\.zip/);
  assert.match(releaseWorkflow, /gh release upload[^\n]+--clobber/);
});
