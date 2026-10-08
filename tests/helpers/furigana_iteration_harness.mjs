import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const sources = Object.fromEntries(['index.js', 'Utils.js', 'Pages.js'].map(file =>
  [file, readFileSync(new URL(file, root), 'utf8')]));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const gitBlob = value => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex');
const manifest = [];
function part(file, start, end) {
  const source = sources[file], from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `complete source boundary: ${file}: ${start}`);
  assert.equal(source.indexOf(start, from + start.length), -1, `unique start: ${file}: ${start}`);
  const code = source.slice(from, to);
  manifest.push({ file, start, end, from, to, startLine: source.slice(0, from).split('\n').length,
    endLine: source.slice(0, to - 1).split('\n').length,
    byteStart: Buffer.byteLength(source.slice(0, from)), byteEnd: Buffer.byteLength(source.slice(0, to)),
    sha256: sha256(code), gitBlob: gitBlob(code), length: Buffer.byteLength(code) });
  return code;
}
const converter = part('index.js', 'const FuriganaConverter = (() => {', '\nconst initializeFuriganaConverter =');
const kanjiGate = part('Utils.js', 'const KANJI_CHARACTER_REGEX =', '\nconst CLEAN_HTML_RT_REGEX =');
const utilsMembers = [
  part('Utils.js', '  PRONUNCIATION_SEGMENT_SEPARATOR:', '\n  escapeHtml(value)'),
  part('Utils.js', '  _currentDetectedLanguage: null,', '\n  formatTime(timestamp)'),
].join('\n');
const pageHelpers = [
  part('Pages.js', 'const safeRenderText =', '\nconst getFirstTrimmedString ='),
  part('Pages.js', 'const renderAnnotatedLyricHTML =', '\nconst normalizeUnsyncedLyrics ='),
  part('Pages.js', 'const getUnsyncedLineRenderData =', '\nconst getCopyableText ='),
  part('Pages.js', 'const LyricsLineBlock =', '\nconst renderLyricsItems ='),
].join('\n');
// Manual fixtures matching the official kuromoji 0.1.2 IpadicFormatter shape:
// https://github.com/takuyaa/kuromoji.js/blob/d0357c1427acb912815fc8ab59f284dd08bad0fa/src/util/IpadicFormatter.js
// Whole-token reading/pronunciation are supplied inputs, not native dictionary
// evidence or per-character pronunciation alignment. No tokenizer is downloaded.
export const token = (surface, reading, pronunciation = reading, position = 1) => ({
  word_id: 0, word_type: 'KNOWN', word_position: position, surface_form: surface,
  pos: '*', pos_detail_1: '*', pos_detail_2: '*', pos_detail_3: '*',
  conjugated_type: '*', conjugated_form: '*', basic_form: surface, reading, pronunciation,
});
export const unknown = surface => ({
  word_id: 0, word_type: 'UNKNOWN', word_position: 1, surface_form: surface,
  pos: undefined, pos_detail_1: undefined, pos_detail_2: undefined, pos_detail_3: undefined,
  conjugated_type: undefined, conjugated_form: undefined, basic_form: undefined,
});
export const ruby = (surface, reading) => `<ruby>${surface}<rt>${reading}</rt></ruby>`;
export function runtime({ enabled = true, language = 'ja', tokens = [], failBuild = false, failTokenize = false, visual = {} } = {}) {
  const requests = [], timers = [], events = [], tokenizations = [], builds = [], unexpectedCalls = [];
  let tokenizerFailure = failTokenize;
  class InertXHR {
    open(...args) { requests.push(args); throw new Error('Network is prohibited'); }
    send() { throw new Error('Network is prohibited'); }
  }
  const window = {
    kuromoji: { builder: options => { builds.push(options); return { build: callback => callback(
      failBuild ? new Error('inert dictionary failure') : null,
      { tokenize: text => { tokenizations.push(text); if (tokenizerFailure) throw new Error('inert tokenizer failure');
        assert.equal(tokens.map(entry => entry.surface_form).join(''), text, 'fixture surfaces reconstruct source exactly');
        return tokens;
      } }) }; } },
    dispatchEvent: event => { events.push(event.type); return true; },
  };
  const CONFIG = { visual: { 'furigana-enabled': enabled, 'translate:display-mode': 'original',
    'pronunciation-inline': true, 'inactive-color': '#999', ...visual } };
  const forbid = label => () => { unexpectedCalls.push(label); throw new Error(`unexpected collaborator: ${label}`); };
  const context = vm.createContext({
    window, CONFIG, XMLHttpRequest: InertXHR,
    fetch: forbid('fetch'), localStorage: { getItem: forbid('storage read'), setItem: forbid('storage write') },
    indexedDB: { open: forbid('IndexedDB') },
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    useMemo: make => make(), useCallback: callback => callback,
    react: { memo: component => component, createElement: (type, props, ...children) => ({ type, props, children }) },
    normalizeDisplayedCulturalAnnotations: value => { assert.ok(!value, 'no cultural annotation fixture'); return []; },
    getCulturalMarkerRawOffset: forbid('cultural marker'), getCulturalMarkerHTML: forbid('cultural marker HTML'),
    getRubySourceText: forbid('cultural source match'), hasKaraokeVocalRows: () => false,
    getInterludeInfo: () => ({ isInterlude: false }), createCopyHandler: () => forbid('copy event'),
    InterludeIndicator: 'inert-interlude', KaraokeLine: 'inert-karaoke',
  });
  vm.runInContext(`${converter}\n${kanjiGate}\nglobalThis.Utils = {${utilsMembers}};
    Utils.formatLyricLineToCopy = () => '';
    window.Utils = Utils;
    ${pageHelpers}
    globalThis.parts = { getLyricsDisplayMode, getUnsyncedLineRenderData, buildLyricDisplayState, LyricsLineBlock };`, context);
  context.Utils.setDetectedLanguage(language);
  return {
    context, service: window.FuriganaConverter, CONFIG,
    stats() { return { requests: [...requests], tokenizations: [...tokenizations], builds: structuredClone(builds),
      pendingTimers: timers.length, events: [...events], unexpectedCalls: [...unexpectedCalls] }; },
    failTokenization(value) { tokenizerFailure = value; },
    render(text, { mode = 'original', phonetic = null, translation = null, line = {}, unsynced = false } = {}) {
      CONFIG.visual['translate:display-mode'] = mode;
      const display = unsynced
        ? context.parts.getUnsyncedLineRenderData([], phonetic, text, translation, line)
        : context.parts.buildLyricDisplayState(false, line, phonetic, text, translation);
      const mainText = unsynced ? display.lineText : display.mainText;
      const element = context.parts.LyricsLineBlock({ mainText, originalText: text, mainCopyText: text,
        subText: display.subText, subText2: unsynced ? display.showMode2Translation : display.subText2, line });
      return { display: structuredClone(display), html: element.children[0].props.dangerouslySetInnerHTML?.__html ?? null,
        element: JSON.parse(JSON.stringify(element)) };
    },
    drain() { while (timers.length) { const task = timers.shift(); assert.equal(task.delay, 100); task.callback(); }
      assert.deepEqual(requests, []); assert.deepEqual(unexpectedCalls, []); return this.stats(); },
  };
}
export const extractionManifest = {
  sources: Object.fromEntries(Object.entries(sources).map(([file, code]) =>
    [file, { sha256: sha256(code), gitBlob: gitBlob(code), bytes: Buffer.byteLength(code) }])),
  helpers: manifest,
  tokenProvenance: 'Manual official-formatter-shaped tokens. These fixtures do not establish native dictionary incidence.',
  collaborators: 'Inert tokenizer/build callback; XHR/fetch/storage fail closed; readiness timers drained; immediate hooks and React element records. No live network, native DOM, playback, providers or storage.',
};
