const test = require("node:test");
const assert = require("node:assert/strict");

const { KaraokeWordTiming: timing } = require("../LyricsService.js");

const timedChars = (text, starts, ends) => Array.from(text).map((char, index) => ({
	char,
	startTime: starts[index],
	endTime: ends[index],
}));

test("merges a Latin word and punctuation into one continuous time range", () => {
	const segments = timing.buildTimedSegments(timedChars(
		"Uh, ",
		[104867, 104929, 104965, 105660],
		[104929, 104965, 105660, 106100]
	));

	assert.deepEqual(segments, [
		{ type: "text", startIndex: 0, text: "Uh,", startTime: 104867, endTime: 105660 },
		{ type: "space", startIndex: 3, text: " ", startTime: 105660, endTime: 106100 },
	]);
});

test("keeps apostrophes inside a Latin word", () => {
	const segments = timing.buildTimedSegments(timedChars(
		"I'm",
		[106715, 106726, 106743],
		[106726, 106743, 107042]
	));

	assert.equal(segments.length, 1);
	assert.deepEqual(segments[0], {
		type: "text",
		startIndex: 0,
		text: "I'm",
		startTime: 106715,
		endTime: 107042,
	});
});

test("keeps CJK characters independently timed", () => {
	const segments = timing.buildTimedSegments(timedChars(
		"世界",
		[0, 100],
		[100, 200]
	));

	assert.deepEqual(segments.map((segment) => segment.text), ["世", "界"]);
	assert.deepEqual(segments.map((segment) => [segment.startTime, segment.endTime]), [[0, 100], [100, 200]]);
});

test("groups only the Latin word in a mixed line", () => {
	const text = "歌 hello 世界";
	const chars = Array.from(text).map((char, index) => ({
		char,
		startTime: index * 100,
		endTime: (index + 1) * 100,
	}));
	const segments = timing.buildTimedSegments(chars);

	assert.deepEqual(segments.map((segment) => segment.text), ["歌", " ", "hello", " ", "世", "界"]);
});

test("preserves continuous joining-script words", () => {
	const text = "مرحبا بك";
	const chars = Array.from(text).map((char, index) => ({
		char,
		startTime: index * 100,
		endTime: (index + 1) * 100,
	}));

	assert.deepEqual(timing.buildTimedSegments(chars).map((segment) => segment.text), ["مرحبا", " ", "بك"]);
});

test("redistributes only the fill timing while preserving original per-character sync data", () => {
	const chars = timedChars(
		"Uh, ",
		[104867, 104929, 104965, 105660],
		[104929, 104965, 105660, 106100]
	);
	const adjusted = timing.applyLatinWordFillTiming(chars, {
		getText: (item) => item.char,
		getStartTime: (item) => item.startTime,
		getEndTime: (item) => item.endTime,
	});

	assert.deepEqual(adjusted.map((item) => [item.startTime, item.endTime]), chars.map((item) => [item.startTime, item.endTime]));
	assert.equal(adjusted[0].karaokeFillStartTime, 104867);
	assert.ok(Math.abs(adjusted[0].karaokeFillEndTime - 105131.33333333333) < 0.001);
	assert.ok(Math.abs(adjusted[1].karaokeFillStartTime - 105131.33333333333) < 0.001);
	assert.ok(Math.abs(adjusted[1].karaokeFillEndTime - 105395.66666666667) < 0.001);
	assert.ok(Math.abs(adjusted[2].karaokeFillStartTime - 105395.66666666667) < 0.001);
	assert.equal(adjusted[2].karaokeFillEndTime, 105660);
	assert.equal(adjusted[3].karaokeFillStartTime, undefined);
});
