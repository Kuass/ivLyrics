import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(process.env.IVLYRICS_COMPACT_DURATION_SOURCE
	|| new URL("../../Pages.js", import.meta.url), "utf8");
const sections = [
	["const IdlingIndicator =", "function renderLyricsUnavailable"],
	["const normalizeDisplayedCulturalAnnotations =", "const normalizeUnsyncedLyrics ="],
	["const buildLyricDisplayState =", "const getFiniteLyricsStyleNumber ="],
	["const createOutsideTextOutlineShadow =", "// A full-density outline"],
	["const getCurrentTrackDurationMs =", "const copyLyricText ="],
	["const createCopyHandler =", "const getLyricsAnchorRatio ="],
	["const getLyricsAnchorRatio =", "const KARAOKE_FILL_CORRECTION_DEFAULT_POINTS ="],
	["const getKaraokeLineBounds =", "const KARAOKE_FILL_STEPS ="],
	["const buildPreparedSyncedLyrics =", "// Global animation manager"],
];
const bundle = sections.map(([start, end]) => {
	const from = source.indexOf(start);
	const to = source.indexOf(end, from + start.length);
	assert.ok(from >= 0 && to > from, `missing exact renderer section: ${start}`);
	return source.slice(from, to);
}).join("\n") + "\nglobalThis.api = { useSyncedLyricsEngine, renderLyricsItems, LyricsLineBlock, IdlingIndicator, InterludeIndicator };";

// Complete source substrings, including lineRelation, are never rewritten.
// Hook slots and item caches persist; effects, refs, React reconciliation, glyph
// children and browser animation are outside this inert declaration fixture.
export function createCompactInterludeFixture(controls = {}) {
	const lanes = new Map();
	let lane, hookIndex = 0, stateIndex = 0, scrolling = false;
	const effects = { registered: 0, executed: 0 };
	const CONFIG = { visual: {
		"lines-before": 2, "lines-after": 2, "karaoke-bounce": false,
		"karaoke-line-transition": true, "karaoke-text-effects": true,
		"sync-data-custom-speaker-colors-enabled": true, "translate:display-mode": "below",
		"furigana-enabled": false, "instrumental-break-auto-detect": false,
		"pronunciation-inline": false, "instrumental-break-icon": "equalizer", ...controls.settings,
	} };
	const motionPreference = { matches: controls.reduced === true };
	const useMemo = (build, dependencies) => {
		const hooks = lanes.get(lane), index = hookIndex++, previous = hooks[index];
		if (previous && dependencies && previous.dependencies
			&& dependencies.length === previous.dependencies.length
			&& dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return previous.value;
		const value = build();
		hooks[index] = { value, dependencies };
		return value;
	};
	const useRef = initial => useMemo(() => ({ current: initial }), []);
	const useState = initial => {
		const index = stateIndex++;
		const state = useRef(typeof initial === "function" ? initial() : initial);
		return [lane === "engine" && index === 1 && controls.suppressed !== undefined
			? controls.suppressed : state.current,
			next => { state.current = typeof next === "function" ? next(state.current) : next; }];
	};
	const effect = () => { effects.registered++; };
	const react = { memo: component => component, useMemo, useRef, useState,
		useCallback: (callback, dependencies) => useMemo(() => callback, dependencies),
		useEffect: effect, useLayoutEffect: effect,
		createElement: (tag, props, ...children) => ({ tag, props, children }) };
	const Utils = { getDetectedLanguage: () => "en", applyFuriganaIfEnabled: text => text,
		formatLyricLineToCopy: () => "", rubyTextToHTML: text => String(text) };
	const window = { Utils, FuriganaConverter: { isAvailable: () => false },
		matchMedia: () => motionPreference,
		LyricsWordSegmenter: { segmentGraphemes: (text, language) => Array.from(
			new Intl.Segmenter(language === "auto" ? undefined : language,
				{ granularity: "grapheme" }).segment(text), entry => entry.segment) } };
	const context = vm.createContext({ console, CONFIG, Utils, window, react, ...react,
		I18n: { t: () => "" }, KaraokeLine: "opaque:KaraokeLine",
		Spicetify: { Player: { data: { item: { duration: { milliseconds: 18000 } } },
			seek: () => { throw new Error("unexpected seek in inert fixture"); } } },
		Element: class Element { animate() { throw new Error("unexpected browser animation"); } },
		useScrollActivity: () => ({ isScrolling: scrolling, handleContainerClick: null }) });
	new vm.Script(bundle, { filename: "exact-compact-interlude-source.js" }).runInContext(context);
	const api = context.api, containerRef = { current: null }, activeLineRef = { current: null };
	const cache = { elementsByItem: new WeakMap() };
	const inLane = (key, run) => {
		if (!lanes.has(key)) lanes.set(key, []);
		lane = key; hookIndex = 0; stateIndex = 0;
		return run();
	};
	return { CONFIG, effects, motionPreference, setScrolling: value => { scrolling = value; },
		idling: props => inLane("direct-idling", () => api.IdlingIndicator(props)),
		render(lyrics, position, options = {}) {
			const props = { lyrics, position, compact: true, isKara: true, containerRef, activeLineRef,
				lyricsId: "compact-interlude-fixture", settingsRevision: 0, ...options };
			const result = inLane("engine", () => api.useSyncedLyricsEngine(props));
			const elements = api.renderLyricsItems({ items: result.renderItems, isKara: props.isKara,
				position, activeLineRef, settingsRevision: props.settingsRevision,
				karaokeRenderGranularity: "character", cache });
			const consumers = elements.filter(element => element.tag === api.IdlingIndicator
				|| element.props.line?.interludeInfo?.isInterlude).map(element => {
				const outer = inLane(`consumer:${element.props.key}`, () => element.tag(element.props));
				const resolve = node => {
					if (!node || typeof node !== "object") return node;
					if (Array.isArray(node)) return node.map(resolve);
					if (node.tag === api.InterludeIndicator) return inLane(`interlude:${element.props.key}`,
						() => resolve(node.tag(node.props)));
					return { ...node, children: node.children?.map(resolve) };
				};
				return { item: result.renderItems.find(item => item.key === element.props.key),
					element, outer, resolved: resolve(outer) };
			});
			return { result, elements, consumers };
		},
	};
}

export const lyric = (startTime, endTime, text) => ({ startTime, endTime, text, originalText: text,
	syllables: [{ text, startTime, endTime }] });
export const explicitLyrics = () => [lyric(1000, 3000, "Earlier"), lyric(10500, 11400, "♪"), lyric(12000, 13300, "Next")];
export const preludeLyrics = (start = 1000) => [lyric(start, 2400, "First"), lyric(3000, 4400, "Second")];
export const sourceRow = (frame, text) => frame.elements.find(element => element.props.line?.text === text);
export const marker = frame => frame.consumers.find(consumer => consumer.item.line?.text === "♪");
export const prelude = frame => frame.consumers.find(consumer => consumer.item.type === "indicator");
