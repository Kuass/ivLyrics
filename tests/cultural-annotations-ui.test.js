const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

test('cultural annotations are default-off and wired into lyrics rendering', () => {
    const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    const pagesSource = fs.readFileSync(path.join(ROOT, 'Pages.js'), 'utf8');
    const settingsSource = fs.readFileSync(path.join(ROOT, 'Settings.js'), 'utf8');
    const optionsMenuSource = fs.readFileSync(path.join(ROOT, 'OptionsMenu.js'), 'utf8');
    const lyricsServiceSource = fs.readFileSync(path.join(ROOT, 'LyricsService.js'), 'utf8');
    const vinylSource = fs.readFileSync(path.join(ROOT, 'VinylActiveLyricRenderer.js'), 'utf8');
    const panelSource = fs.readFileSync(path.join(ROOT, 'NowPlayingPanelLyrics.js'), 'utf8');

    assert.match(
        indexSource,
        /"cultural-annotations-enabled": StorageManager\.get\(\s*"ivLyrics:visual:cultural-annotations-enabled",\s*false\s*\)/
    );
    for (const key of [
        'cultural-annotations-font-family',
        'cultural-annotations-font-size',
        'cultural-annotations-font-weight',
        'cultural-annotations-opacity',
    ]) {
        assert.match(indexSource, new RegExp(`"${key}"`), key);
    }
    assert.match(indexSource, /"cultural-annotations-font-size":\s*StorageManager\.getItem\([\s\S]*?\) \|\|\s*"14"/);
    assert.match(indexSource, /"cultural-annotations-font-weight":\s*StorageManager\.getItem\([\s\S]*?\) \|\|\s*"300"/);
    assert.match(indexSource, /"cultural-annotations-opacity":\s*StorageManager\.getItem\([\s\S]*?\) \|\| "60"/);
    assert.match(indexSource, /Translator\.generateCulturalAnnotations/);
    assert.match(indexSource, /startCulturalAnnotationsLoading\(\{\s*label: culturalAnnotationLabel,\s*description: culturalAnnotationLoadingDescription,/);
    assert.doesNotMatch(indexSource, /label:\s*providerLabel/);
    assert.match(indexSource, /"cultural-annotations": Object\.freeze\(\{[\s\S]*?loadingDelayMs: 0,/);
    assert.match(indexSource, /applyCulturalAnnotations\(processedLyrics, this\.state\.uri\)/);
    assert.match(pagesSource, /LyricsLine-culturalNote/);
    assert.match(pagesSource, /lyrics-cultural-marker/);
    assert.match(pagesSource, /displayedCulturalAnnotations\.map\(\(annotation\) =>/);
    assert.match(pagesSource, /const noteText = `\$\{annotation\.marker\}\. \$\{annotation\.note\}`/);
    assert.doesNotMatch(pagesSource, /`↳ \$\{displayedCulturalNote\}`/);
    assert.match(pagesSource, /!shouldRenderInterlude && !singleLineScroll &&\s*displayedCulturalAnnotations\.map/);
    assert.match(indexSource, /marker: lineAnnotations\.length \+ 1/);
    assert.match(indexSource, /const schemaVersion = 4/);
    assert.match(lyricsServiceSource, /schemaVersion = 4/);
    assert.match(vinylSource, /singleLineScroll: true/);
    assert.doesNotMatch(panelSource, /culturalNote|LyricsLine-culturalNote/);
    assert.match(settingsSource, /key: "cultural-annotations-enabled"/);
    assert.match(optionsMenuSource, /regenerate-cultural-annotations/);
    assert.match(optionsMenuSource, /settings\.culturalAnnotations\.label/);
    assert.match(indexSource, /async regenerateCulturalAnnotations\(\)/);
    assert.match(indexSource, /ignoreCache: true/);
    assert.match(indexSource, /clearCulturalAnnotationsForTrack\(trackUri\)/);
    assert.match(indexSource, /requestEpoch !== this\._culturalAnnotationCacheEpoch/);
    assert.match(indexSource, /this\._culturalAnnotationRequests\.get\(requestKey\) === request/);
    assert.match(settingsSource, /clearAllCulturalAnnotations/);
    assert.match(settingsSource, /clearCulturalAnnotationsForTrack/);
    assert.match(lyricsServiceSource, /async clearCulturalAnnotationsForTrack\(trackId\)/);
    assert.match(lyricsServiceSource, /record\?\.type === 'cultural'/);

    const aiProvidersStart = settingsSource.indexOf('const AIProvidersTab = () =>');
    const aiProvidersEnd = settingsSource.indexOf('const LocalCacheManager = () =>');
    const aiProvidersSource = settingsSource.slice(aiProvidersStart, aiProvidersEnd);
    assert.match(aiProvidersSource, /key: "cultural-annotations-enabled"/);
    assert.match(aiProvidersSource, /key: "cultural-annotations-font-family"/);
    assert.match(aiProvidersSource, /key: "cultural-annotations-font-size"/);
    assert.match(aiProvidersSource, /key: "cultural-annotations-font-weight"/);
    assert.match(aiProvidersSource, /key: "cultural-annotations-opacity"/);
    assert.equal(
        (aiProvidersSource.match(/when: \(\) => areCulturalAnnotationsEnabled\(\)/g) || []).length,
        4
    );

    const generalTabStart = settingsSource.indexOf('data-tab-id": "general"');
    const appearanceTabStart = settingsSource.indexOf('data-tab-id": "appearance"');
    const generalTabSource = settingsSource.slice(generalTabStart, appearanceTabStart);
    assert.doesNotMatch(generalTabSource, /key: "cultural-annotations-enabled"/);
});

test('every bundled language includes cultural annotation settings and status copy', () => {
    const languageFiles = fs.readdirSync(path.join(ROOT, 'langs'))
        .filter(file => /^Lang.*\.js$/.test(file));

    assert.equal(languageFiles.length, 22);
    for (const file of languageFiles) {
        const context = { window: {} };
        vm.runInNewContext(
            fs.readFileSync(path.join(ROOT, 'langs', file), 'utf8'),
            context,
            { filename: file }
        );
        const language = Object.values(context.window)[0];
        assert.ok(language?.settings?.culturalAnnotations?.label, file);
        assert.ok(language?.settings?.culturalAnnotations?.desc, file);
        assert.ok(language.settings.culturalAnnotations.desc.includes('LP'), file);
        for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'opacity']) {
            assert.ok(language.settings.culturalAnnotations[key]?.label, `${file}: ${key} label`);
            assert.ok(language.settings.culturalAnnotations[key]?.desc, `${file}: ${key} description`);
        }
        assert.ok(language?.settings?.aiProviders?.supports?.culturalAnnotations, file);
        assert.ok(language?.generationStatus?.culturalAnnotations, file);
        assert.ok(language?.generationStatus?.culturalAnnotationsLoading, file);
        assert.ok(language?.notifications?.culturalAnnotationsFailed, file);
        assert.ok(language?.notifications?.culturalAnnotationsRegenerated, file);
        assert.ok(language?.notifications?.culturalAnnotationsRegenerateFailed, file);
        assert.ok(language?.menu?.regenerateTranslationOptionsSubtitle, file);
    }
});

test('Korean cultural annotation loading copy uses the generation pill label', () => {
    const context = { window: {} };
    vm.runInNewContext(
        fs.readFileSync(path.join(ROOT, 'langs', 'LangKo.js'), 'utf8'),
        context,
        { filename: 'LangKo.js' }
    );

    assert.equal(context.window.LANG_KO.generationStatus.culturalAnnotations, '문화적 설명');
    assert.equal(
        context.window.LANG_KO.generationStatus.culturalAnnotationsLoading,
        '문화적 설명을 생성하는 중...'
    );
});
