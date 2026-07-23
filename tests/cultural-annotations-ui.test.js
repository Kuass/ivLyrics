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

    assert.match(
        indexSource,
        /"cultural-annotations-enabled": StorageManager\.get\(\s*"ivLyrics:visual:cultural-annotations-enabled",\s*false\s*\)/
    );
    assert.match(indexSource, /Translator\.generateCulturalAnnotations/);
    assert.match(indexSource, /applyCulturalAnnotations\(processedLyrics, this\.state\.uri\)/);
    assert.match(pagesSource, /LyricsLine-culturalNote/);
    assert.match(pagesSource, /`↳ \$\{displayedCulturalNote\}`/);
    assert.match(settingsSource, /key: "cultural-annotations-enabled"/);
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
        assert.ok(language?.settings?.aiProviders?.supports?.culturalAnnotations, file);
        assert.ok(language?.generationStatus?.culturalAnnotations, file);
        assert.ok(language?.generationStatus?.culturalAnnotationsLoading, file);
        assert.ok(language?.notifications?.culturalAnnotationsFailed, file);
    }
});
