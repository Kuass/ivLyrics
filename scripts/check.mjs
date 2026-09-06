// Dependency-free local and CI quality gate. No application code is executed.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const bundledFiles = ['index.js', ...manifest.subfiles, ...manifest.subfiles_extension];
assert.equal(new Set(bundledFiles).size, bundledFiles.length, 'Duplicate bundled scripts');
for (const path of [...bundledFiles, 'style.css', manifest.preview]) {
  assert.ok(typeof path === 'string' && !path.startsWith('/') && !path.split('/').includes('..'), `Unsafe bundle path: ${path}`);
  assert.ok(statSync(resolve(root, path)).isFile(), `Missing bundled file: ${path}`);
}
let checked = 0;
for (const directory of ['', 'langs']) {
  for (const entry of readdirSync(resolve(root, directory))) {
    if (!entry.endsWith('.js')) continue;
    const filename = resolve(root, directory, entry);
    new vm.Script(readFileSync(filename, 'utf8'), { filename: relative(root, filename) });
    checked++;
  }
}
// Parse the actual concatenated surfaces too: valid individual scripts may
// still redeclare a top-level binding when Spicetify bundles them together.
new vm.Script(bundledFiles.slice(0, 1 + manifest.subfiles.length)
  .map(path => readFileSync(resolve(root, path), 'utf8')).join('\n;\n'), { filename: 'custom-app-bundle.js' });
console.log(`Parsed ${checked} JavaScript files and validated the custom app bundle and manifest.`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('bash', ['-n', 'scripts/ivlyrics']);
run('python3', ['.github/scripts/set_release_version.py', 'check']);
run(process.execPath, ['--test', ...readdirSync(resolve(root, 'tests'))
  .filter(path => path.endsWith('.test.mjs')).sort().map(path => `tests/${path}`)]);
