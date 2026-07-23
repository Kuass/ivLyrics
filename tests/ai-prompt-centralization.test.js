const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PROVIDER_FILES = [
    'Addon_AI_ChatGPT.js',
    'Addon_AI_Claude.js',
    'Addon_AI_Gemini.js',
    'Addon_AI_Groq.js',
    'Addon_AI_OpenRouter.js',
    'Addon_AI_Paxsenix.js',
    'Addon_AI_Perplexity.js',
    'Addon_AI_Pollinations.js'
];

function loadManager() {
    const storage = new Map();
    const localStorage = {
        get length() {
            return storage.size;
        },
        getItem: (key) => storage.get(key) ?? null,
        key: (index) => [...storage.keys()][index] ?? null,
        removeItem: (key) => storage.delete(key),
        setItem: (key, value) => storage.set(key, String(value))
    };
    const context = {
        console: { log() {}, warn() {}, error() {}, debug() {}, info() {} },
        localStorage,
        setTimeout() {
            return 0;
        },
        Spicetify: {
            LocalStorage: {
                get: (key) => storage.get(key) ?? null,
                set: (key, value) => storage.set(key, String(value))
            }
        },
        window: {}
    };
    const source = fs.readFileSync(path.join(ROOT, 'AIAddonManager.js'), 'utf8')
        .replace('    initWhenReady();', '    // Initialization is disabled by the prompt test harness.');

    vm.runInNewContext(source, context, { filename: 'AIAddonManager.js' });
    return context.window.AIAddonManager;
}

function createCapturingProvider(captures) {
    return {
        id: 'test-provider',
        name: 'Test Provider',
        author: 'ivLyrics tests',
        description: 'Captures manager request parameters.',
        version: '1.0.0',
        supports: {
            translate: true,
            metadata: true,
            tmi: true,
            lyricsStudy: true,
            characterPronunciation: true
        },
        getSettingsUI() {},
        async translateLyrics(params) {
            captures.lyrics.push(params);
            const lines = String(params.text).split('\n').map(() => 'result');
            return params.wantSmartPhonetic
                ? { phonetic: lines }
                : { translation: lines };
        },
        async translateMetadata(params) {
            captures.metadata = params;
            return {};
        },
        async generateTMI(params) {
            captures.tmi = params;
            return {};
        },
        async generateLyricsStudy(params) {
            captures.study = params;
            return {};
        },
        async generateCharacterPronunciation(params) {
            captures.character.push(params);
            return {
                l: params.lines.map((line, index) => ({
                    i: index,
                    p: Array.from(line).map(() => 'x')
                }))
            };
        }
    };
}

test('all shared prompt builders are exposed by AIAddonManager', () => {
    const manager = loadManager();

    const translation = manager.buildLyricsTranslationPrompt({
        text: 'first\nsecond',
        lang: 'ko',
        translationStyle: 'literal'
    });
    assert.match(translation.systemPrompt, /exactly 2 lines/i);
    assert.match(translation.systemPrompt, /Korean \(한국어\)/);

    const customLanguageTranslation = manager.buildLyricsTranslationPrompt({
        text: 'first',
        lang: 'custom-language'
    });
    assert.match(customLanguageTranslation.systemPrompt, /custom-language \(custom-language\)/);

    const phonetic = manager.buildLyricsPhoneticPrompt({
        text: 'hello\r\nworld',
        lang: 'ko'
    });
    assert.match(phonetic, /EXACTLY 2 lines/);
    assert.match(phonetic, /Korean Hangul pronunciation/);
    assert.doesNotMatch(phonetic, /\r/);

    const unknownLanguagePhonetic = manager.buildLyricsPhoneticPrompt({
        text: 'hello',
        lang: 'custom-language'
    });
    assert.match(unknownLanguagePhonetic, /English speakers/);

    const personalStudyPhonetic = manager.buildLyricsPhoneticPrompt({
        text: 'hello',
        lang: 'en',
        providerId: 'perplexity'
    });
    assert.ok(personalStudyPhonetic.startsWith('This request is only for personal study.'));

    const character = manager.buildCharacterPronunciationPrompt({
        lines: ['夜'],
        lang: 'ko',
        sourceLang: 'ja',
        unitMode: 'char'
    });
    assert.match(character, /\"a\":\[\"夜\"\]/);
    assert.match(character, /Pronunciation unit mode: char/);

    const metadata = manager.buildMetadataTranslationPrompt({
        title: 'Title',
        artist: 'Artist',
        lang: 'ko'
    });
    assert.match(metadata, /translatedTitle/);

    const geminiMetadata = manager.buildMetadataTranslationPrompt({
        title: 'Title',
        artist: 'Artist',
        lang: 'ko',
        providerId: 'gemini'
    });
    assert.match(geminiMetadata, /Output MUST be valid JSON/);
    assert.match(geminiMetadata, /Do NOT use markdown code blocks/);

    const perplexityMetadata = manager.buildMetadataTranslationPrompt({
        title: 'Title',
        artist: 'Artist',
        lang: 'ko',
        providerId: 'perplexity'
    });
    assert.ok(perplexityMetadata.startsWith('This request is only for personal study.'));

    const tmi = manager.buildTMIPrompt({ title: 'Title', artist: 'Artist', lang: 'ja' });
    assert.match(tmi, /Japanese \(日本語\)/);

    const study = manager.buildLyricsStudyPrompt({
        title: 'Title',
        artist: 'Artist',
        targetLang: 'ko',
        lines: [{ index: 0, text: 'hello' }]
    });
    assert.match(study, /Target explanation language: Korean \(한국어\)/);
    assert.match(study, /\"text\":\"hello\"/);
});

test('manager injects central prompts into every provider capability', async () => {
    const manager = loadManager();
    const captures = {
        lyrics: [],
        metadata: null,
        tmi: null,
        study: null,
        character: []
    };
    const provider = createCapturingProvider(captures);

    assert.equal(manager.register(provider), true);
    manager.setProviderEnabled(provider.id, true);

    await manager.translateLyrics({
        text: 'first\nsecond',
        lang: 'ko',
        wantSmartPhonetic: false
    });
    await manager.translateLyrics({
        text: 'hello',
        lang: 'en',
        wantSmartPhonetic: true
    });
    await manager.translateMetadata({ title: 'Title', artist: 'Artist', lang: 'ko' });
    await manager.generateTMI({ title: 'Title', artist: 'Artist', lang: 'ko' });
    await manager.generateLyricsStudy({
        title: 'Title',
        artist: 'Artist',
        targetLang: 'ko',
        lines: [{ index: 0, text: 'hello' }]
    });
    await manager.generateCharacterPronunciation({
        lines: ['ab'],
        lang: 'ko',
        sourceLang: 'en',
        unitMode: 'char'
    });

    assert.match(captures.lyrics[0].translationPrompt.systemPrompt, /lyrics translation system/);
    assert.equal(captures.lyrics[0].phoneticPrompt, null);
    assert.equal(captures.lyrics[1].translationPrompt, null);
    assert.match(captures.lyrics[1].phoneticPrompt, /pronunciation converter/);
    assert.match(captures.metadata.metadataPrompt, /translatedTitle/);
    assert.match(captures.tmi.tmiPrompt, /music knowledge expert/);
    assert.match(captures.study.lyricsStudyPrompt, /language learning tutor/);
    assert.match(captures.character[0].characterPronunciationPrompt, /pronunciation aligner/);
});

test('built-in providers contain transport code but no prompt builders or language tables', () => {
    for (const file of PROVIDER_FILES) {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        assert.doesNotMatch(source, /\bLANGUAGE_DATA\b/, file);
        assert.doesNotMatch(source, /function build(?:Phonetic|CharacterPronunciation|Metadata|TMI|LyricsStudy)Prompt/, file);
        assert.match(source, /translationPrompt/, file);
        assert.match(source, /phoneticPrompt/, file);
        assert.match(source, /characterPronunciationPrompt/, file);
        assert.match(source, /metadataPrompt/, file);
        assert.match(source, /tmiPrompt/, file);
        assert.match(source, /lyricsStudyPrompt/, file);
    }
});
