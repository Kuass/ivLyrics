import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const sourceFile = name => process.env.IVLYRICS_PANEL_MARKUP_SOURCE_DIR
  ? resolve(process.env.IVLYRICS_PANEL_MARKUP_SOURCE_DIR, name)
  : new URL(`../${name}`, import.meta.url);
const source = readFileSync(sourceFile('NowPlayingPanelLyrics.js'), 'utf8');
const utils = readFileSync(sourceFile('Utils.js'), 'utf8');
const section = (text, first, last) => {
  const a = text.indexOf(first), b = text.indexOf(last, a);
  assert.ok(a >= 0 && b > a, first); return text.slice(a, b);
};
const mainRubyMethod = section(utils, '  rubyTextToHTML(s) {', '\n  /**');
const mainFormatter = vm.runInNewContext(`({${mainRubyMethod}})`).rubyTextToHTML;
const normalStart = source.indexOf('    const renderPanelLyricHTML = ');
const renderSource = section(source, normalStart >= 0 ? '    const renderPanelLyricHTML = ' : '    const NormalLine = memo(', '    const getPanelStackTranslateY = ');
const savedSource = section(source, '    const getSavedPanelLocalLyrics = ', '    const DEFAULT_ORIGINAL_SIZE = ');
const plain = value => JSON.parse(JSON.stringify(value));
function renderer(saved = {}) {
  const style = { '--fixture-color': 'red' };
  const context = vm.createContext({
    // No Utils global: the panel is an extension and must keep this boundary standalone.
    console, localStorage: { getItem: key => key === 'ivLyrics:local-lyrics' ? JSON.stringify(saved) : null },
    memo: fn => fn, useMemo: fn => fn(),
    getVocalRowsFromLine: () => [], getSyllablesFromLine: line => line.syllables || [],
    getPanelSpeakerPresentation: () => ({ speakerClass: 'fixture' }), getPanelSpeakerStyle: () => style,
    getTextEffectKindClassParts: () => [], TEXT_EFFECT_KIND_CLASSES: new Set(), getInterludeInfo: () => ({ isInterlude: false }),
    KaraokeLine: 'karaoke', InterludeLine: 'interlude',
    react: { createElement: (tag, props, ...children) => typeof tag === 'function' ? tag(props) : ({ tag, props, children }) },
  });
  vm.runInContext(`${savedSource}\n${renderSource}\nglobalThis.renderNormal = NormalLine; globalThis.renderLine = LyricLine; globalThis.getSaved = getSavedPanelLocalLyrics;`, context);
  return {
    normal: (displayText, extra = {}) => context.renderNormal({ displayText, lineClass: 'line fixture', lineStyle: style, ...extra }),
    line: (line, extra = {}) => context.renderLine({ line, lineIndex: 0, lineCount: 1, isActive: true, ...extra }),
    saved: uri => context.getSaved(uri), style,
  };
}
const html = tree => tree.children[0].props.dangerouslySetInnerHTML?.__html;
const unsafe = [
  '<img src="fixture" onerror="fixture()">',
  '<svg onload="fixture()"><circle /></svg>',
  '<style>body { display:none }</style>',
  '<iframe src="https://fixture.invalid"></iframe>',
  '<a href="javascript:fixture()">link</a>',
  '<ruby onclick="fixture()">base<rt>reading</rt></ruby>',
  '<rt class="unexpected">reading</rt>',
  '<!-- hidden --> <br> tail',
  '<img src="unfinished"',
];
for (const [index, text] of unsafe.entries()) {
  test(`normal lyrics escape non-ruby markup case ${index + 1}`, () => {
    const output = html(renderer().normal(text));
    assert.equal(output, mainFormatter(text));
    assert.equal(/<(?!\/?(?:ruby|rt|rp)>|ruby class="lyrics-pronunciation-ruby">)/.test(output), false);
    assert.ok(output.includes('&lt;'));
  });
}
for (const text of [
  '<ruby>漢<rt>かん</rt></ruby>',
  '<ruby class="lyrics-pronunciation-ruby">한글<rt>hangul</rt></ruby>',
  '<ruby>字<rp>(</rp><rt>じ</rt><rp>)</rp></ruby>',
  'plain <ruby>字<rt>じ</rt></ruby> and <img src="fixture">',
]) {
  test(`supported ruby survives alongside escaped surrounding text: ${text.slice(0, 35)}`, () => {
    assert.equal(html(renderer().normal(text)), mainFormatter(text));
  });
}
test('plain Unicode, entities, punctuation and whitespace retain their existing text representation', () => {
  for (const text of ['사랑 🎵 مرحبا', 'A &amp; B &lt;literal&gt; &gt;', '"quotes" and \'apostrophes\'', '  spaces\nnext\tline  ', '  ']) {
    assert.equal(html(renderer().normal(text)), text);
  }
});
test('empty normal lyrics keep the blank placeholder and unchanged presentation props', () => {
  const r = renderer(); const tree = r.normal('');
  assert.equal(tree.props.className, 'line fixture'); assert.equal(tree.props.style, r.style);
  assert.equal(tree.children[0].props.dangerouslySetInnerHTML, undefined); assert.deepEqual(plain(tree.children[0].children), [' ']);
});
test('phonetic and translated supplements remain React text children', () => {
  const text = '<img src="fixture">'; const tree = renderer().normal('original', { phonetic: text, translation: text });
  assert.deepEqual(plain(tree.children.slice(1).map(node => node.children)), [[text], [text]]);
  assert.ok(tree.children.slice(1).every(node => node.props.dangerouslySetInnerHTML === undefined));
});
test('the actual lyric-row component escapes originalText and fallback text', () => {
  const r = renderer(); const text = '<img src="fixture" onerror="fixture()">';
  assert.equal(html(r.line({ originalText: text, text: 'fallback' })), mainFormatter(text));
  assert.equal(html(r.line({ text })), mainFormatter(text));
});
test('stored local lyrics reach the same escaped normal-line boundary', () => {
  const uri = 'spotify:local:Artist:Album:Fixture:5'; const text = '<svg onload="fixture()">local</svg>';
  const r = renderer({ [uri]: { synced: [{ startTime: 1000, text }] } });
  const saved = r.saved(uri); assert.equal(saved.provider, 'local'); assert.equal(saved.uri, uri);
  assert.equal(saved.synced[0].text, text); assert.equal(html(r.line(saved.synced[0])), mainFormatter(text));
});
test('actual provider LRC parsing retains raw lyric text until the panel escapes it', () => {
  const text = '<img src="fixture" onerror="fixture()">';
  const window = { LyricsAddonManager: { register() {} } };
  vm.runInNewContext(readFileSync(sourceFile('Addon_Lyrics_Unison.js'), 'utf8'), { window, URL, atob, console, setTimeout() { throw new Error('No request expected'); } });
  const parsed = window.__ivLyricsUnisonDebug.parseLrcLyrics(`[00:01.00]${text}`, 5000);
  assert.equal(parsed.synced[0].text, text); assert.equal(html(renderer().line(parsed.synced[0])), mainFormatter(text));
});
