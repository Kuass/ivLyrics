const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const providerSource = fs.readFileSync(path.join(root, 'Addon_AI_BingTranslate.js'), 'utf8');
const googleProviderSource = fs.readFileSync(path.join(root, 'Addon_AI_GoogleTranslate.js'), 'utf8');
const managerSource = fs.readFileSync(path.join(root, 'AIAddonManager.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'Settings.js'), 'utf8');
const testBingOrigin = ['https://www', 'bing', 'com'].join('.');
const testProxyOrigin = ['https://cors-proxy', 'spicetify', 'app'].join('.');

function createHarness() {
    const calls = [];
    const storage = new Map();
    let addon = null;

    const translateLine = line => {
        const translations = {
            'こんにちは': '안녕하세요',
            '世界': '세계',
            'ありがとう': '고마워요',
            '世界 / ありがとう': '세계와 고마워요',
            '[Chorus]': '[합창]'
        };
        return translations[line] || `번역:${line}`;
    };

    const fetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (options.method === 'GET') {
            const html = [
                '<script>var params_AbusePreventionHelper = ',
                JSON.stringify([Date.now(), 'test-token', 600000]),
                ';</script><div data-iid="translator.5025"></div>',
                '<script>var cfg={IG:"TEST_IG"};</script>'
            ].join('');
            return new Response(html, {
                status: 200,
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'X-Final-Destination': `${testBingOrigin}/translator`,
                    'X-Set-Cookie': 'MUID=test; Path=/; Expires=Fri, 03-Sep-2027 00:00:00 GMT, _EDGE_S=test-edge; Path=/'
                }
            });
        }

        const body = new URLSearchParams(options.body);
        const translatedText = body.get('text')
            .split('\n')
            .map(translateLine)
            .join('\n');
        return new Response(JSON.stringify([{
            detectedLanguage: { language: 'ja' },
            translations: [{ text: translatedText, to: body.get('to') }]
        }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    };

    const window = {
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value))
        },
        AIAddonManager: {
            register: candidate => {
                addon = candidate;
                return true;
            }
        }
    };
    const context = {
        window,
        fetch,
        Response,
        URL,
        URLSearchParams,
        AbortController,
        crypto: crypto.webcrypto,
        console,
        setTimeout,
        clearTimeout,
        Promise,
        Date,
        Math,
        Uint16Array
    };

    vm.runInNewContext(providerSource, context, { filename: 'Addon_AI_BingTranslate.js' });
    return { addon, calls, storage };
}

function readAddonMetadata(source, filename) {
    let addon = null;
    const window = {
        AIAddonManager: {
            register: candidate => {
                addon = candidate;
                return true;
            }
        }
    };
    vm.runInNewContext(source, {
        window,
        fetch: async () => { throw new Error('fetch is not available in metadata tests'); },
        URL,
        URLSearchParams,
        AbortController,
        console,
        setTimeout,
        clearTimeout,
        Promise,
        Date,
        Math,
        Uint16Array
    }, { filename });
    return addon;
}

test('registers as a translation-only provider', () => {
    const { addon } = createHarness();

    assert.equal(addon.id, 'bing-translate');
    assert.equal(addon.supports.translate, true);
    assert.equal(addon.supports.pronunciation, false);
    assert.equal(addon.getSettingsUI(), null);
});

test('localizes provider descriptions and first-language prompts for every supported UI locale', () => {
    const supportedLocales = [
        'ko', 'en', 'zh-CN', 'zh-TW', 'ja', 'hi', 'es', 'fr', 'ar', 'fa', 'de',
        'ru', 'sv', 'pt', 'bn', 'cs', 'it', 'th', 'vi', 'id', 'ms', 'tr'
    ];
    const bingAddon = readAddonMetadata(providerSource, 'Addon_AI_BingTranslate.js');
    const googleAddon = readAddonMetadata(googleProviderSource, 'Addon_AI_GoogleTranslate.js');

    assert.deepEqual(Object.keys(bingAddon.description).sort(), [...supportedLocales].sort());
    assert.deepEqual(Object.keys(googleAddon.description).sort(), [...supportedLocales].sort());
    for (const addon of [bingAddon, googleAddon]) {
        for (const locale of supportedLocales) {
            assert.equal(typeof addon.description[locale], 'string');
            assert.notEqual(addon.description[locale].trim(), '');
        }
    }

    const requiredPromptKeys = [
        'title', 'description', 'original', 'originalDescription', 'pronunciation',
        'pronunciationDescription', 'translation', 'translationDescription', 'both',
        'bothDescription', 'notNow', 'apply'
    ];
    const languageFiles = fs.readdirSync(path.join(root, 'langs'))
        .filter(file => /^Lang.*\.js$/.test(file));
    assert.equal(languageFiles.length, supportedLocales.length);
    for (const file of languageFiles) {
        const sandbox = { window: {} };
        vm.runInNewContext(fs.readFileSync(path.join(root, 'langs', file), 'utf8'), sandbox, { filename: file });
        const languageTable = Object.values(sandbox.window)[0];
        assert.deepEqual(Object.keys(languageTable.firstLanguagePrompt), requiredPromptKeys, file);
        assert.match(languageTable.firstLanguagePrompt.title, /\{language\}/, file);
    }
});

test('uses the Bing website token flow while preserving lyric structure', async () => {
    const { addon, calls, storage } = createHarness();
    const progress = [];
    const source = 'こんにちは\n\n[Chorus]\n世界 / ありがとう';

    const result = await addon.translateLyrics({
        text: source,
        lang: 'ko',
        wantSmartPhonetic: false,
        onLine: (index, text, detail) => progress.push({ index, text, detail })
    });

    assert.deepEqual(Array.from(result.translation), [
        '안녕하세요',
        '',
        '[Chorus]',
        '세계 / 고마워요'
    ]);
    assert.deepEqual(progress.map(item => [item.index, item.text]), [
        [0, '안녕하세요'],
        [1, ''],
        [2, '[Chorus]'],
        [3, '세계 / 고마워요']
    ]);
    assert.ok(progress.every(item => item.detail.provider === 'bing-translate' && item.detail.final));

    const getCalls = calls.filter(call => call.options.method === 'GET');
    const postCalls = calls.filter(call => call.options.method === 'POST');
    assert.equal(getCalls.length, 1);
    assert.equal(postCalls.length, 3);
    assert.equal(getCalls[0].url, `${testProxyOrigin}/${testBingOrigin}/translator`);
    assert.equal(getCalls[0].options.headers['X-Origin'], testBingOrigin);

    const proxyAddress = storage.get('ivLyrics:ai:bing-translate:proxy-client-address');
    assert.match(proxyAddress, /^2001:db8(?::[0-9a-f]{1,4}){6}$/i);
    for (const call of postCalls) {
        assert.equal(call.options.headers['X-X-Real-Ip'], proxyAddress);
        assert.equal(call.options.headers['X-Referer'], `${testBingOrigin}/translator`);
        assert.match(call.options.headers['X-Cookie'], /MUID=test/);
        assert.match(call.options.headers['X-Cookie'], /_EDGE_S=test-edge/);
        assert.match(call.url, /ttranslatev3\?isVertical=1/);
        assert.match(call.url, /edgepdftranslator=1/);
    }
});

test('maps ivLyrics Chinese targets and rejects pronunciation requests', async () => {
    const { addon, calls } = createHarness();

    await addon.translateLyrics({
        text: 'こんにちは',
        lang: 'zh-CN',
        wantSmartPhonetic: false
    });
    const translationRequest = calls.find(call => call.options.method === 'POST');
    assert.equal(new URLSearchParams(translationRequest.options.body).get('to'), 'zh-Hans');

    await assert.rejects(
        addon.translateLyrics({ text: 'こんにちは', lang: 'ko', wantSmartPhonetic: true }),
        /Pronunciation generation is not supported/
    );
});

test('is included in the bundled extension manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.ok(manifest.subfiles_extension.includes('Addon_AI_BingTranslate.js'));
});

test('keeps translation and proxy hosts out of provider source literals', () => {
    const forbiddenHosts = [
        ['translate', 'googleapis', 'com'].join('.'),
        ['www', 'bing', 'com'].join('.'),
        ['cors-proxy', 'spicetify', 'app'].join('.')
    ];
    const combinedSource = `${providerSource}\n${googleProviderSource}`;

    for (const host of forbiddenHosts) {
        assert.equal(combinedSource.includes(host), false, `plain-text host leaked: ${host}`);
    }
    assert.equal(/\batob\s*\(|\bbtoa\s*\(/.test(combinedSource), false);
});

test('enables Bing and Google by default without overriding saved choices', () => {
    assert.match(
        managerSource,
        /DEFAULT_ENABLED_ADDONS\s*=\s*\[\s*["']bing-translate["']\s*,\s*["']google-translate["']\s*]/
    );
    assert.match(managerSource, /if \(stored === null \|\| stored === undefined\)[\s\S]*DEFAULT_ENABLED_ADDONS\.includes\(addonId\)/);
    assert.match(managerSource, /return stored === ['"]true['"]/);
});

test('uses drag handles for both provider lists and keeps cultural details collapsed', () => {
    assert.equal((settingsSource.match(/react\.createElement\(ProviderDragHandle/g) || []).length, 2);
    assert.equal(settingsSource.includes('className: "order-btn"'), false);
    assert.match(settingsSource, /useState\(false\);\s*\n\s*const vinylModeLabel/);
    assert.match(settingsSource, /"aria-expanded": culturalDetailsExpanded/);
    assert.match(settingsSource, /onKeyDown:[\s\S]*event\.key !== "ArrowUp"[\s\S]*event\.key !== "ArrowDown"/);
});
