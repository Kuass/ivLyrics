const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('PC cloud snapshots exclude credentials and device-specific settings', () => {
  const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const policyStart = source.indexOf('const CLOUD_SYNC_FORBIDDEN_KEY_PATTERN');
  const policyEnd = source.indexOf('const isCloudSyncSettingKey', policyStart);
  assert.ok(policyStart >= 0 && policyEnd > policyStart, 'cloud credential policy is missing');
  const policy = source.slice(policyStart, policyEnd);
  const sandbox = {};
  vm.runInNewContext(`${policy}\nthis.checkCloudKey = isCloudSyncCredentialLikeKey;`, sandbox);

  assert.equal(sandbox.checkCloudKey('ivLyrics:ai:addon:groq:adv-maxTokens-value'), false);
  assert.equal(sandbox.checkCloudKey('ivLyrics:ai:addon:gemini:adv-maxOutputTokens-enabled'), false);
  assert.equal(sandbox.checkCloudKey('ivLyrics:ai:addon:chatgpt:api-keys'), true);
  assert.equal(sandbox.checkCloudKey('ivLyrics:ai:addon:test:accessTokenMaxTokens'), true);
  assert.match(source, /CLOUD_SYNC_EXCLUDED_STORAGE_KEYS[\s\S]*TRACK_SYNC_OFFSETS_STORAGE_KEY/);
  assert.match(source, /CLOUD_SYNC_EXCLUDED_STORAGE_KEYS[\s\S]*settings-presets/);
  assert.match(source, /PRIVATE_OR_TRANSIENT_STORAGE_KEYS[\s\S]*cloud-save-device-id/);
  assert.match(source, /exportCloudConfig\(\)/);
  assert.match(source, /importCloudConfig\(config\)/);
});

test('cloud client checks supporter status lazily and permits deletion after support expiry', () => {
  const utils = fs.readFileSync(path.join(root, 'Utils.js'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'Settings.js'), 'utf8');
  const cloudComponent = settings.slice(
    settings.indexOf('const ConfigCloudSync = () => {'),
    settings.indexOf('const VideoHelperToggle =')
  );
  assert.match(utils, /"X-ivLyrics-Client-Version": this\.currentVersion/);
  assert.match(utils, /appVersion: this\.currentVersion/);
  assert.match(utils, /requestCloudSaveCapability\(method === "DELETE" \? "delete" : "sync"\)/);
  assert.match(utils, /cached\?\.sessionToken === sessionToken/);
  assert.match(cloudComponent, /const ensureMonthlySupporter = useCallback\(async \(\) => \{[\s\S]*fetchDiscordSupportTier\(discordId, \{ forceRefresh: true \}\)/);
  assert.doesNotMatch(cloudComponent, /getCachedDiscordSupportTier\(discordId\)/);
  assert.match(cloudComponent, /Toast\?\.error\?\.\(monthlyMessage\)/);
  assert.doesNotMatch(cloudComponent, /useEffect\(/);
  assert.match(cloudComponent, /getCloudSyncText\("monthlyRequired", "Cloud sync is available to Monthly Supporters only\."\)/);
  assert.match(cloudComponent, /const deleteDisabled = disabled \|\| !Utils\.getAuthToken\(\)/);
  assert.match(cloudComponent, /disabled: deleteDisabled,\s*onClick: remove/);
  assert.doesNotMatch(settings, /disabled: disabled \|\| !cloud\.exists,\s*onClick: remove/);
  assert.doesNotMatch(settings, /useEffect\(\(\) => \{\s*refresh\(\);/);
});

test('all bundled PC locales include the complete cloud sync UI', () => {
  const expectedKeys = [
    'title', 'subtitle', 'platform', 'checking', 'loginRequired', 'monthlyRequired',
    'empty', 'remoteFound', 'notSaved', 'updatedAt', 'upload', 'uploading', 'uploaded',
    'download', 'downloading', 'downloaded', 'refresh', 'delete', 'deleting', 'deleted',
    'confirmDownload', 'confirmDelete', 'conflict', 'failed', 'excluded',
  ];
  const files = fs.readdirSync(path.join(root, 'langs')).filter((name) => /^Lang.*\.js$/.test(name));
  assert.equal(files.length, 22);
  for (const file of files) {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'langs', file), 'utf8'), { window });
    const table = Object.values(window)[0]?.settingsAdvanced?.cloudSync;
    assert.ok(table, `${file} is missing settingsAdvanced.cloudSync`);
    assert.deepEqual(Object.keys(table).sort(), [...expectedKeys].sort(), `${file} has an incomplete cloud sync table`);
    for (const key of expectedKeys) {
      assert.ok(String(table[key] || '').trim(), `${file} has an empty ${key}`);
    }
  }
});
