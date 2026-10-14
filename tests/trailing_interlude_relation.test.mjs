import assert from "node:assert/strict";
import test from "node:test";
import { createTrailingRelationHarness } from "./helpers/trailing_interlude_relation_harness.mjs";

const lyric = (startTime, endTime, text) => ({
	startTime, endTime, text, originalText: text,
	syllables: [{ startTime, endTime, text }],
});
const makeLyrics = (kind) => kind === "postlude"
	? [lyric(1000, 2000, "Alpha")]
	: kind === "explicit"
		? [lyric(1000, 2000, "Alpha"), lyric(4500, 8000, "♪"), lyric(8000, 9000, "Beta")]
		: [lyric(1000, 2000, "Alpha"), lyric(8000, 9000, "Beta")];

// Expectations come from the retained virtual-anchor contract, independently
// of activity and the normal source row's visibility-relative index.
const states = {
	absent: { present: false },
	preview: { present: true, relation: "current", active: false, index: 0, precentered: true, anchor: true },
	active: { present: true, relation: "current", active: true, index: 0, precentered: false, anchor: true },
	outgoing: { present: true, relation: "before", active: true, index: -1, precentered: false, anchor: false },
	explicit: { present: true, relation: "current", active: true },
};
const ordinary = [
	["before", "S", -301, "absent"],
	["preview", "S", -300, "preview"],
	["preview-repeat", "S", -284, "preview", "stable"],
	["active", "S", 0, "active", "phase-change"],
	["active-repeat", "S", 16, "active", "stable"],
	["outgoing", "E", -300, "outgoing", "handoff"],
	["outgoing-repeat", "E", -284, "outgoing", "stable"],
	["outgoing-last", "E", -1, "outgoing", "stable"],
	["next-boundary", "E", 0, "absent"],
	["next-repeat", "E", 16, "absent"],
];
const disabled = [
	["preview-position", "S", -300, "absent"],
	["active-position", "S", 0, "absent"],
	["outgoing-position", "E", -300, "absent"],
	["next-boundary", "E", 0, "absent"],
	["next-repeat", "E", 16, "absent"],
];
const cases = [
	...["character", "word"].flatMap((granularity) => [
		{ name: `ordinary-${granularity}`, granularity, frames: ordinary },
		{ name: `direct-active-${granularity}`, granularity, frames: [["entry", "S", 32, "active"]] },
		{ name: `direct-outgoing-${granularity}`, granularity, frames: [["entry", "E", -200, "outgoing"]] },
	]),
	{ name: "auto-detect-off", settings: { "instrumental-break-auto-detect": false }, frames: disabled },
	{ name: "plain", isKara: false, frames: disabled },
	{ name: "transition-off", settings: { "karaoke-line-transition": false }, frames: [
		["preview-position", "S", -300, "absent"],
		["before-active", "S", -1, "absent"],
		["active", "S", 0, "active"],
		["active-repeat", "S", 16, "active", "stable"],
		["last", "E", -1, "active", "stable"],
		["next-boundary", "E", 0, "absent"],
	] },
	{ name: "postlude", kind: "postlude", frames: [
		["active", "S", 0, "active"],
		["active-repeat", "S", 16, "active", "stable"],
		["bounded-last", "E", -1, "active", "stable"],
	] },
	{ name: "explicit-consumer", kind: "explicit", settings: { "instrumental-break-auto-detect": false }, frames: [
		["active", "absolute", 4600, "explicit"],
		["active-repeat", "absolute", 4616, "explicit", "stable"],
		["outgoing", "absolute", 7800, "explicit"],
		["next-boundary", "absolute", 8000, "absent"],
	] },
];

const countSpans = (node) => !node || typeof node !== "object" ? 0
	: Array.isArray(node) ? node.reduce((n, child) => n + countSpans(child), 0)
		: (node.tag === "span" ? 1 : 0) + (node.children || []).reduce((n, child) => n + countSpans(child), 0);

for (const scenario of cases) {
	test(`trailing relation: ${scenario.name}`, async (t) => {
		const kind = scenario.kind || "gap";
		const lyrics = makeLyrics(kind);
		const isKara = scenario.isKara ?? true;
		const granularity = scenario.granularity || "character";
		const controls = { settings: scenario.settings || {} };
		const reference = createTrailingRelationHarness();
		const referenceLyrics = kind === "explicit" ? makeLyrics("gap") : lyrics;
		const prepared = reference.api.buildPreparedSyncedLyrics(referenceLyrics, true);
		const cumulative = reference.api.buildKaraokeCumulativeEndTimes(prepared);
		const interval = reference.api.getTrailingKaraokeInterludeInfo(
			prepared[0], prepared[1], 0, prepared.length, cumulative[0],
		);
		assert.equal(interval.isInterlude, true);
		assert.equal(reference.api.LYRICS_CENTERING_LEAD_MS, 300);
		const anchors = { S: interval.startTime, E: interval.endTime, absolute: 0 };
		let fixture = createTrailingRelationHarness(controls);
		let previous = null;
		for (const [name, anchor, offset, state, identity] of scenario.frames) {
			await t.test(name, () => {
				const expected = states[state];
				const position = anchors[anchor] + offset;
				const actual = fixture.render(lyrics, position, { isKara, karaokeRenderGranularity: granularity });
				// A failure discards all hooks, refs and caches. Later planned frames
				// still execute from a fresh fixture; failed state is never reused.
				if (actual.status !== "complete") {
					fixture = createTrailingRelationHarness(controls);
					previous = null;
				}
				assert.equal(actual.status, "complete", actual.error?.message);
				assert.equal(fixture.effects.executed, 0);
				assert.equal(actual.consumers.length, actual.result.renderItems.length);
				for (const consumer of actual.consumers) {
					const item = actual.result.renderItems.find((item) => item.key === consumer.key);
					assert.equal(consumer.isLine, true);
					assert.equal(consumer.element.props.lineRelation, item.lineRelation);
					assert.equal(consumer.outer.tag, "div");
					assert.equal(consumer.outer.props["data-line-relation"], item.lineRelation);
					assert.equal(consumer.element.props.isCurrentLine, item.isActiveLine);
					assert.equal(consumer.element.props.karaokeRenderGranularity, granularity);
					assert.equal(consumer.element.props.line, item.line);
					assert.equal(consumer.element.props.style, item.style);
					assert.equal(consumer.outer.props.style, item.style);
				}
				const selected = actual.result.renderItems.filter((item) => kind === "explicit"
					? item.line?.interludeInfo?.isInterlude && !item.line?.isVirtualTrailingInterlude
					: item.line?.isVirtualTrailingInterlude);
				assert.equal(selected.length, expected.present ? 1 : 0);
				if (!expected.present) {
					previous = null;
					return;
				}
				const item = selected[0];
				const consumer = actual.consumers.find((row) => row.key === item.key);
				assert.equal(item.lineRelation, expected.relation);
				assert.equal(consumer.element.props.lineRelation, expected.relation);
				assert.equal(consumer.outer.props["data-line-relation"], expected.relation);
				assert.equal(item.isActiveLine, expected.active);
				assert.equal(consumer.element.props.isCurrentLine, expected.active);
				assert.equal(/(?:^|\s)lyrics-lyricsContainer-LyricsLine-active(?:\s|$)/.test(consumer.outer.props.className), expected.active);
				assert.equal(consumer.outer.children[0].children[0] === "\u00A0", !expected.active);
				assert.equal(consumer.indicators.length, expected.active ? 1 : 0);
				if (expected.active) {
					const indicator = consumer.indicators[0].outer;
					assert.equal(indicator.props.className, `lyrics-break-indicator lyrics-break-kind-${kind === "postlude" ? "postlude" : "break"}`);
					assert.equal(indicator.children[0].props.className, "lyrics-break-icon lyrics-break-icon-equalizer");
					assert.equal(countSpans(indicator.children[0]) - 1, 4);
				}
				if (kind !== "explicit") {
					assert.notEqual(item.lineRelation, "after");
					assert.equal(item.style["--position-index"], expected.index);
					assert.equal(item.style["--animation-index"], Math.abs(expected.index) + 1);
					assert.equal(item.line.isPrecentered, expected.precentered);
					assert.equal(item.trackLineRef, expected.anchor);
					assert.equal(item.key, `trailing-interlude-2-${anchors.S}`);
					assert.equal(item.startTime, anchors.S);
					assert.equal(item.line.endTime, anchors.E);
					for (const flag of ["canSeek", "karaokeActive", "effectFocused", "effectLive"]) assert.equal(item[flag], false);
					assert.equal(item.globalCharOffset, 0);
					assert.equal(item.activeGlobalCharIndex, -1);
					const source = actual.result.renderItems.find((row) => row.line?.originalText === "Alpha");
					assert.ok(source);
					assert.equal(source.lineRelation, "current");
				} else if (name === "outgoing") {
					// Explicit source rows retain their separate visibility relation.
					assert.equal(item.style["--position-index"], -1);
					assert.equal(item.lineRelation, "current");
				}
				if (identity) {
					assert.ok(previous, "identity requires the preceding completed frame");
					assert.equal(item.key, previous.key);
					assert.equal(item.line === previous.line, identity !== "phase-change");
					assert.equal(item.style === previous.style, !["phase-change", "handoff"].includes(identity));
				}
				previous = item;
			});
		}
	});
}
