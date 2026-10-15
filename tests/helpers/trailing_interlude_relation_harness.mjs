import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Keep complete production sections, including both relation expressions and
// the actual outer LyricsLineBlock / retained InterludeIndicator consumers.
// Only the export assignment is added; no source substitution is permitted.
const source = readFileSync(new URL("../../Pages.js", import.meta.url), "utf8");
const sections = [
	[
		"const IdlingIndicator =",
		"function renderLyricsUnavailable"
	],
	[
		"const normalizeDisplayedCulturalAnnotations =",
		"const normalizeUnsyncedLyrics ="
	],
	[
		"const buildLyricDisplayState =",
		"const getFiniteLyricsStyleNumber ="
	],
	[
		"const createOutsideTextOutlineShadow =",
		"// A full-density outline"
	],
	[
		"const getCurrentTrackDurationMs =",
		"const copyLyricText ="
	],
	[
		"const createCopyHandler =",
		"const getLyricsAnchorRatio ="
	],
	[
		"const getLyricsAnchorRatio =",
		"const KARAOKE_FILL_CORRECTION_DEFAULT_POINTS ="
	],
	[
		"const getKaraokeLineBounds =",
		"const KARAOKE_FILL_STEPS ="
	],
	[
		"const buildPreparedSyncedLyrics =",
		"// Global animation manager"
	]
].map(([startMarker, endMarker]) => {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(start >= 0 && end > start, `missing trailing relation section: ${startMarker}`);
	return source.slice(start, end);
});
const bundle = sections.join("\n") + `

globalThis.engineApi = {
	useSyncedLyricsEngine, renderLyricsItems, LyricsLineBlock, IdlingIndicator,
	InterludeIndicator, buildPreparedSyncedLyrics, buildKaraokeCumulativeEndTimes,
	getTrailingKaraokeInterludeInfo, LYRICS_CENTERING_LEAD_MS,
};
`;

// This adapter is deliberately inert: effects never run, refs stay null, and
// React memo is an identity wrapper. Per-component typed hook slots preserve
// useMemo/useCallback dependencies between completed frames. Glyph children
// are opaque; engine, item renderer, line and interlude consumers are real.
// There is no React reconciliation, DOM, animation, layout or paint coverage.
export function createTrailingRelationHarness(controls = {}) {
	const lanes = new Map();
	let currentLane = null;
	let cursor = 0;
	const effects = { registered: 0, executed: 0 };
	const calls = { engine: 0, itemRenderer: 0, lineConsumer: 0, idlingConsumer: 0, interludeConsumer: 0 };
	const memo = { hits: 0, builds: 0 };
	function slot(type) {
		const lane = lanes.get(currentLane);
		if (!lane) throw Error("hook outside component lane");
		const index = cursor++;
		const previous = lane[index];
		if (previous && previous.type !== type) throw Error(`hook type changed at ${currentLane}:${index}`);
		return { lane, index, previous };
	}
	const same = (a, b) => Array.isArray(a) && Array.isArray(b)
		&& a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
	function memoHook(type, build, dependencies) {
		const { lane, index, previous } = slot(type);
		if (previous && same(dependencies, previous.dependencies)) {
			memo.hits++;
			return previous.value;
		}
		const value = build();
		memo.builds++;
		lane[index] = { type, value, dependencies: dependencies?.slice() };
		return value;
	}
	const useMemo = (build, dependencies) => memoHook("memo", build, dependencies);
	const useCallback = (callback, dependencies) => memoHook("callback", () => callback, dependencies);
	const useRef = (initial) => {
		const { lane, index, previous } = slot("ref");
		if (previous) return previous.value;
		const value = { current: initial };
		lane[index] = { type: "ref", value };
		return value;
	};
	const useState = (initial) => {
		const { lane, index, previous } = slot("state");
		const state = previous || { type: "state", value: typeof initial === "function" ? initial() : initial };
		if (!previous) {
			state.set = (next) => { state.value = typeof next === "function" ? next(state.value) : next; };
			lane[index] = state;
		}
		return [state.value, state.set];
	};
	const effectHook = (type) => (_callback, dependencies) => {
		const { lane, index } = slot(type);
		effects.registered++;
		lane[index] = { type, dependencies: dependencies?.slice() };
	};
	const react = {
		memo: (component) => component,
		useMemo, useCallback, useRef, useState,
		useEffect: effectHook("effect"),
		useLayoutEffect: effectHook("layoutEffect"),
		createElement: (tag, props, ...children) => {
			const { key = null, ...rest } = props || {};
			return { tag, key, props: rest, children };
		},
	};
	const CONFIG = { visual: {
		"lines-before": 2,
		"lines-after": 2,
		"karaoke-bounce": false,
		"karaoke-line-transition": true,
		"karaoke-text-effects": true,
		"sync-data-custom-speaker-colors-enabled": true,
		"translate:display-mode": "below",
		"furigana-enabled": false,
		"pronunciation-inline": false,
		"instrumental-break-icon": "equalizer",
		...controls.settings,
	} };
	const Utils = {
		getDetectedLanguage: () => "en",
		applyFuriganaIfEnabled: (text) => text,
		formatLyricLineToCopy: () => "",
		rubyTextToHTML: (text) => String(text),
	};
	const window = {
		Utils,
		FuriganaConverter: { isAvailable: () => false },
		matchMedia: () => ({ matches: false }),
		LyricsWordSegmenter: {
			segmentGraphemes: (text, language) => Array.from(new Intl.Segmenter(
				language === "auto" ? undefined : language, { granularity: "grapheme" },
			).segment(text), (entry) => entry.segment),
		},
	};
	const unavailable = (label) => () => { throw Error(`unexpected non-inert call: ${label}`); };
	const context = vm.createContext({
		console, CONFIG, Utils, window, react, ...react,
		I18n: { t: (key) => key },
		KaraokeLine: "opaque:KaraokeLine",
		Spicetify: { Player: { data: { item: { duration: { milliseconds: 14000 } } }, seek: unavailable("seek") } },
		Element: class Element { animate() { throw Error("unexpected animate"); } },
		useScrollActivity: () => ({ isScrolling: false, handleContainerClick: null }),
	});
	new vm.Script(bundle, { filename: "trailing-relation-source.js" }).runInContext(context);
	const api = context.engineApi;
	const containerRef = { current: null };
	const activeLineRef = { current: null };
	const renderCache = { elementsByItem: new WeakMap() };
	const inLane = (key, callback) => {
		if (!lanes.has(key)) lanes.set(key, []);
		currentLane = key;
		cursor = 0;
		try { return callback(); } finally { currentLane = null; }
	};
	function render(lyrics, position, options = {}) {
		const props = {
			lyrics, position, compact: true, isKara: true, containerRef, activeLineRef,
			lyricsId: "trailing-inert-fixture", settingsRevision: 0, ...options,
		};
		let stage = "engine";
		let result = null;
		let elements = null;
		const consumers = [];
		try {
			calls.engine++;
			result = inLane("engine", () => api.useSyncedLyricsEngine(props));
			stage = "item-renderer";
			calls.itemRenderer++;
			elements = api.renderLyricsItems({
				items: result.renderItems, isKara: props.isKara, position, activeLineRef,
				settingsRevision: props.settingsRevision,
				karaokeRenderGranularity: options.karaokeRenderGranularity ?? "character", cache: renderCache,
			});
			stage = "line-consumers";
			for (const element of elements) {
				const isLine = element.tag === api.LyricsLineBlock;
				if (!isLine && element.tag !== api.IdlingIndicator) throw Error("unexpected item consumer");
				calls[isLine ? "lineConsumer" : "idlingConsumer"]++;
				const lane = `consumer:${isLine ? "line" : "idling"}:${element.key}`;
				const outer = inLane(lane, () => element.tag(element.props));
				const indicators = [];
				const resolve = (node) => {
					if (!node || typeof node !== "object") return node;
					if (Array.isArray(node)) return node.map(resolve);
					if (node.tag === api.InterludeIndicator) {
						calls.interludeConsumer++;
						const actual = inLane(`indicator:${lane}`, () => node.tag(node.props));
						indicators.push({ props: node.props, outer: actual });
						return resolve(actual);
					}
					return { ...node, children: node.children?.map(resolve) };
				};
				const resolved = resolve(outer);
				consumers.push({ key: element.key, isLine, element, outer, resolved, indicators });
			}
			return { status: "complete", stage: "complete", props, result, elements, consumers };
		} catch (error) {
			return {
				status: "error", stage, error: { name: error.name, message: error.message, stack: error.stack },
				props, result, elements, consumers,
			};
		}
	}
	return { api, CONFIG, effects, calls, memo, render };
}
