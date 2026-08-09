const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const LANG_DIR = path.join(__dirname, "..", "langs");
const LANG_FILES = fs.readdirSync(LANG_DIR)
  .filter((name) => /^Lang.*\.js$/.test(name))
  .sort();

function loadLanguage(fileName) {
  const context = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(LANG_DIR, fileName), "utf8"),
    context,
    { filename: fileName },
  );
  return Object.values(context.window)[0];
}

function flatten(value, prefix = "", output = {}) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, fullKey, output);
    } else {
      output[fullKey] = String(child);
    }
  }
  return output;
}

function placeholders(value) {
  return [...value.matchAll(/\{[^{}]+\}|%(?:\d+\$)?[@dfs]|\\n/g)]
    .map((match) => match[0])
    .sort();
}

const korean = flatten(loadLanguage("LangKo.js"));
const english = flatten(loadLanguage("LangEn.js"));
const expectedKeys = Object.keys(korean).sort();

const allowedEnglishKeys = [
  /^meta\./,
  /settingsAdvanced\.instrumentalBreak\.icon\.options\./,
  /settingsAdvanced\.cacheManagement\.openDb\.versionSummary/,
  /settingsAdvanced\.livePreview\.sampleTextPhonetic/,
  /settingsAdvanced\.pronunciationStyle\.hyphenReplace\.options\.keep/,
  /settings\.lyricsProviders\.supports\.ivLyricsSync/,
  /marketplace\.directUrl(?:Label|Placeholder)/,
  /(?:bing|google|microsoft|spotify|gemini|openai|claude|pollinations|lrclib|musixmatch|netease|youtube|discord|github|tmi|romaji|hiragana|katakana|furigana|karaoke)/i,
];

function isAllowedEnglish(key) {
  return allowedEnglishKeys.some((pattern) => pattern.test(key));
}

test("every PC locale has the Korean key set and compatible placeholders", () => {
  for (const fileName of LANG_FILES) {
    const table = flatten(loadLanguage(fileName));
    assert.deepEqual(Object.keys(table).sort(), expectedKeys, `${fileName}: key set`);

    for (const key of expectedKeys) {
      assert.deepEqual(
        placeholders(table[key]),
        placeholders(korean[key]),
        `${fileName}: placeholders for ${key}`,
      );
    }
  }
});

test("non-Korean PC locales contain no leaked Korean copy", () => {
  for (const fileName of LANG_FILES) {
    if (fileName === "LangKo.js") continue;
    const table = flatten(loadLanguage(fileName));
    const leaked = Object.entries(table)
      .filter(([, value]) => /[가-힣]/.test(value))
      .map(([key]) => key);
    assert.deepEqual(leaked, [], `${fileName}: Korean text leaked into locale`);
  }
});

test("translated PC UI sentences do not silently fall back to English", () => {
  for (const fileName of LANG_FILES) {
    if (fileName === "LangKo.js" || fileName === "LangEn.js") continue;
    const table = flatten(loadLanguage(fileName));
    const untranslated = expectedKeys.filter((key) => {
      const value = english[key];
      return table[key] === value
        && value.length > 8
        && /[A-Za-z]{3}/.test(value)
        && (/\s/.test(value) || /[.!?]/.test(value))
        && !isAllowedEnglish(key);
    });
    assert.deepEqual(untranslated, [], `${fileName}: untranslated English UI copy`);
  }
});
