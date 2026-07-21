const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPaths = [
    'updater/install.ps1',
    'updater/uninstall.ps1',
    'updater/windows/updater-path-utils.ps1'
];

function readScript(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function extractUtf8Wrapper(source, relativePath) {
    const marker = 'function Invoke-IvLyricsSpicetifyCommand {';
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${relativePath} is missing the Spicetify UTF-8 wrapper`);

    const end = source.indexOf('\nfunction ', start + marker.length);
    assert.ok(end > start, `${relativePath} has an incomplete Spicetify UTF-8 wrapper`);
    return source.slice(start, end);
}

test('every Windows Spicetify entry point scopes native calls to UTF-8', () => {
    for (const relativePath of scriptPaths) {
        const source = readScript(relativePath);
        const wrapper = extractUtf8Wrapper(source, relativePath);

        assert.match(wrapper, /\[Text\.UTF8Encoding\]::new\(\$false\)/);
        assert.match(wrapper, /\[Console\]::InputEncoding = \$utf8Encoding/);
        assert.match(wrapper, /\[Console\]::OutputEncoding = \$utf8Encoding/);
        assert.match(wrapper, /\$OutputEncoding = \$utf8Encoding/);
        assert.match(wrapper, /finally \{/);
        assert.match(wrapper, /\$OutputEncoding = \$previousOutputEncoding/);
        assert.match(wrapper, /\[Console\]::InputEncoding = \$previousInputEncoding/);
        assert.match(wrapper, /\[Console\]::OutputEncoding = \$previousConsoleOutputEncoding/);
        assert.match(wrapper, /@\(& spicetify @Arguments 2>&1\)/);

        const sourceWithoutWrapper = source.slice(0, source.indexOf(wrapper)) +
            source.slice(source.indexOf(wrapper) + wrapper.length);
        assert.doesNotMatch(
            sourceWithoutWrapper,
            /^\s*\$\w+Output\s*=\s*@\((?:&\s+)?spicetify\b/m,
            `${relativePath} must not bypass the UTF-8 wrapper`
        );
    }
});

test('install, uninstall, and updater path resolution use the UTF-8 wrapper', () => {
    const installer = readScript('updater/install.ps1');
    assert.match(installer, /-Arguments @\("-c"\)/);
    assert.match(installer, /-Arguments @\("config", "custom_apps", "ivLyrics"\)/);
    assert.match(installer, /-Arguments @\("apply"\)/);

    const uninstaller = readScript('updater/uninstall.ps1');
    assert.match(uninstaller, /-Arguments @\("-c"\)/);
    assert.match(uninstaller, /-Arguments @\("config", "custom_apps", "ivLyrics-"\)/);
    assert.match(uninstaller, /-Arguments @\("apply"\)/);
    assert.match(uninstaller, /-Arguments @\("restore"\)/);

    const pathUtils = readScript('updater/windows/updater-path-utils.ps1');
    assert.match(pathUtils, /-Arguments @\("-c"\)/);
});
