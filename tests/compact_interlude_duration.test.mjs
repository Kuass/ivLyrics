import assert from "node:assert/strict";
import test from "node:test";
import { createCompactInterludeFixture, lyric, explicitLyrics, preludeLyrics, sourceRow, marker, prelude } from "./helpers/compact_interlude_harness.mjs";

const fadeKey = "--lyrics-interlude-fade-duration";
const departing = consumer => /lyrics-interlude-departing/.test(consumer?.outer?.props.className || "");
const expectExplicitDuration = (consumer, duration) => {
	assert.ok(consumer);
	assert.equal(consumer.item.style[fadeKey], `${duration}ms`, "engine item duration");
	assert.equal(consumer.element.props.style[fadeKey], `${duration}ms`, "forwarded duration");
	assert.equal(consumer.outer.props.style[fadeKey], `${duration}ms`, "actual line outer duration");
	assert.equal(consumer.outer.props.style, consumer.item.style);
};
const expectPreludeDuration = (consumer, duration) => {
	assert.ok(consumer);
	assert.equal(consumer.item.fadeDurationMs, duration, "numeric engine item duration");
	assert.equal(consumer.element.props.fadeDurationMs, duration, "numeric indicator prop duration");
	assert.equal(consumer.outer.props.style[fadeKey], `${duration}ms`, "actual indicator outer duration");
};
const expectNoDuration = consumer => {
	if (!consumer) return;
	assert.equal(consumer.item.fadeDurationMs, undefined);
	assert.equal(consumer.element.props.fadeDurationMs, undefined);
	assert.equal(consumer.outer?.props.style?.[fadeKey], undefined);
};
const expectFuture = (frame, text) => {
	const row = sourceRow(frame, text);
	assert.ok(row, text);
	assert.equal(row.props.isActive, false);
	assert.equal(row.props.position, 0);
};

// These assertions are intentionally identical when Pages.js is switched to
// the owned baseline. Baseline failures identify selected declaration gaps;
// no helper shim or source rewriting substitutes for the real consumer path.
for (const isKara of [false, true]) {
	test(`compact explicit ${isKara ? "karaoke" : "plain"} declares and freezes late-entry duration`, () => {
		const fixture = createCompactInterludeFixture(), lyrics = explicitLyrics();
		const render = (position, settingsRevision = 0) => fixture.render(lyrics, position, { isKara, settingsRevision });
		const before = marker(render(11600));
		assert.equal(departing(before), false);
		expectNoDuration(before);
		const entry = render(11800), entered = marker(entry);
		assert.equal(departing(entered), true);
		expectExplicitDuration(entered, 184);
		expectFuture(entry, "Next");
		for (const position of [11816, 11900, 11999]) {
			const frame = render(position), next = marker(frame);
			expectExplicitDuration(next, 184);
			assert.equal(next.item, entered.item);
			assert.equal(next.element, entered.element, "item renderer cache retains static elements");
			assert.equal(next.item.line, entered.item.line);
			assert.equal(next.outer.props.style, entered.outer.props.style);
			expectFuture(frame, "Next");
		}
		const revised = marker(render(11999, 1));
		assert.notEqual(revised.item.style, entered.item.style, "settings revision invalidates presentation");
		expectExplicitDuration(revised, 184);
		assert.equal(marker(render(11999, 1)).item.style, revised.item.style);
		const boundary = render(12000, 1);
		assert.equal(departing(marker(boundary)), false);
		assert.equal(sourceRow(boundary, "Next").props.isActive, true);
		assert.equal(sourceRow(boundary, "Next").props.position, isKara ? 12000 : 0);
		assert.equal(fixture.effects.executed, 0);
	});

	test(`compact prelude ${isKara ? "karaoke" : "plain"} forwards numeric entry duration and retains styles`, () => {
		const fixture = createCompactInterludeFixture(), lyrics = preludeLyrics();
		const render = (position, settingsRevision = 0) => fixture.render(lyrics, position, { isKara, settingsRevision });
		expectNoDuration(prelude(render(650)));
		const entry = render(800), entered = prelude(entry);
		assert.equal(departing(entered), true);
		expectPreludeDuration(entered, 184);
		expectFuture(entry, "First");
		let previous = entered;
		for (const position of [816, 900, 999]) {
			const frame = render(position), next = prelude(frame);
			expectPreludeDuration(next, 184);
			// The owned karaoke preparation boundary refreshes the item at 900.
			// Preserve that boundary; duration and actual consumer style stay frozen.
			if (isKara && position === 900) {
				assert.notEqual(next.item, previous.item);
				assert.notEqual(next.element, previous.element);
			} else {
				assert.equal(next.item, previous.item);
				assert.equal(next.element, previous.element);
			}
			assert.equal(next.outer.props.style, entered.outer.props.style);
			expectFuture(frame, "First");
			previous = next;
		}
		const revised = prelude(render(999, 1));
		assert.notEqual(revised.element, entered.element, "settings revision invalidates item renderer cache");
		expectPreludeDuration(revised, 184);
		assert.equal(revised.outer.props.style, entered.outer.props.style, "unchanged indicator timing retains its style");
		const boundary = render(1000, 1);
		assert.equal(prelude(boundary), undefined);
		assert.equal(sourceRow(boundary, "First").props.isActive, true);
		assert.equal(sourceRow(boundary, "First").props.position, isKara ? 1000 : 0);
	});
}

for (const [remaining, duration] of [[300, 220], [200, 184], [17, 1], [16, 0], [1, 0]]) {
	test(`compact explicit first entry with ${remaining}ms remaining declares ${duration}ms`, () => {
		const fixture = createCompactInterludeFixture();
		const frame = fixture.render(explicitLyrics(), 12000 - remaining);
		assert.equal(departing(marker(frame)), true);
		expectExplicitDuration(marker(frame), duration);
		expectFuture(frame, "Next");
	});
	test(`compact prelude first entry with ${remaining}ms remaining forwards ${duration}ms`, () => {
		const fixture = createCompactInterludeFixture();
		const frame = fixture.render(preludeLyrics(), 1000 - remaining);
		assert.equal(departing(prelude(frame)), true);
		expectPreludeDuration(prelude(frame), duration);
		expectFuture(frame, "First");
	});
}

test("short explicit interval admits its inclusive half-interval edge and keeps source boundaries", () => {
	const fixture = createCompactInterludeFixture();
	const lyrics = [lyric(500, 900, "Earlier"), lyric(1000, 1100, "♪"), lyric(1200, 2000, "Next")];
	expectNoDuration(marker(fixture.render(lyrics, 1099)));
	const entry = marker(fixture.render(lyrics, 1100));
	expectExplicitDuration(entry, 80);
	for (const position of [1116, 1199]) {
		const frame = fixture.render(lyrics, position);
		expectExplicitDuration(marker(frame), 80);
		assert.equal(marker(frame).outer.props.style, entry.outer.props.style);
		expectFuture(frame, "Next");
	}
	assert.equal(departing(marker(fixture.render(lyrics, 1200))), false);
});

test("prelude retains the 500ms consumer threshold while 501ms gets a numeric duration", () => {
	const hidden = createCompactInterludeFixture().render(preludeLyrics(500), 400);
	assert.equal(prelude(hidden).outer, null);
	const visible = createCompactInterludeFixture().render(preludeLyrics(501), 401);
	expectPreludeDuration(prelude(visible), 84);
});

test("departure duration refreshes when compact explicit interval endpoints change", () => {
	const fixture = createCompactInterludeFixture();
	expectExplicitDuration(marker(fixture.render(explicitLyrics(), 11800)), 184);
	const changedStart = [lyric(1000, 3000, "Earlier"), lyric(11800, 11850, "♪"), lyric(12000, 13300, "Next")];
	expectExplicitDuration(marker(fixture.render(changedStart, 11900)), 80);
	const changedEnd = [lyric(1000, 3000, "Earlier"), lyric(10500, 11400, "♪"), lyric(12100, 13300, "Next")];
	expectExplicitDuration(marker(fixture.render(changedEnd, 11950)), 134);
});

test("prelude duration refreshes on its source endpoint change", () => {
	const fixture = createCompactInterludeFixture();
	expectPreludeDuration(prelude(fixture.render(preludeLyrics(), 800)), 184);
	expectPreludeDuration(prelude(fixture.render(preludeLyrics(1100), 950)), 134);
});

for (const [name, controls] of [
	["reduced motion", { reduced: true }],
	["karaoke transition disabled", { settings: { "karaoke-line-transition": false } }],
	["layout suppression", { suppressed: true }],
]) {
	test(`${name} preserves compact motion guards and inactive source lyrics`, () => {
		for (const [lyrics, position, select, nextText] of [
			[explicitLyrics(), 11800, marker, "Next"], [preludeLyrics(), 800, prelude, "First"],
		]) {
			const frame = createCompactInterludeFixture(controls).render(lyrics, position);
			assert.equal(departing(select(frame)), false);
			expectNoDuration(select(frame));
			expectFuture(frame, nextText);
		}
	});
}

test("plain compact mode retains its enabled motion gate when karaoke transitions are off", () => {
	const controls = { settings: { "karaoke-line-transition": false } };
	expectExplicitDuration(marker(createCompactInterludeFixture(controls).render(explicitLyrics(), 11800, { isKara: false })), 184);
	expectPreludeDuration(prelude(createCompactInterludeFixture(controls).render(preludeLyrics(), 800, { isKara: false })), 184);
});

test("scrolling preserves the owned layout clock rather than taking live playback as entry", () => {
	for (const [lyrics, before, live, boundary, select, nextText] of [
		[explicitLyrics(), 11600, 11800, 12000, marker, "Next"],
		[preludeLyrics(), 650, 800, 1000, prelude, "First"],
	]) {
		const fixture = createCompactInterludeFixture();
		fixture.render(lyrics, before);
		fixture.setScrolling(true);
		for (const position of [live, live + 16]) {
			const frame = fixture.render(lyrics, position);
			assert.equal(departing(select(frame)), false);
			expectNoDuration(select(frame));
			expectFuture(frame, nextText);
		}
		fixture.setScrolling(false);
		assert.equal(sourceRow(fixture.render(lyrics, boundary), nextText).props.isActive, true);
	}
});

test("expanded explicit declaration and prelude forwarding stay unchanged", () => {
	for (const isKara of [false, true]) {
		const explicit = createCompactInterludeFixture().render(explicitLyrics(), 11800, { compact: false, isKara });
		expectExplicitDuration(marker(explicit), 220);
		expectFuture(explicit, "Next");
		const first = createCompactInterludeFixture().render(preludeLyrics(), 800, { compact: false, isKara });
		const consumer = prelude(first);
		assert.equal(Object.hasOwn(consumer.item, "fadeDurationMs"), false);
		assert.equal(Object.hasOwn(consumer.element.props, "fadeDurationMs"), false);
		expectNoDuration(consumer);
		expectFuture(first, "First");
	}
});

test("indicator excludes nonnumeric and nonfinite overrides while accepting finite zero", () => {
	const fixture = createCompactInterludeFixture();
	for (const fadeDurationMs of [undefined, null, NaN, Infinity, -Infinity, "0", "184"]) {
		assert.equal(fixture.idling({ durationMs: 1000, fadeDurationMs }).props.style[fadeKey], undefined);
	}
	assert.equal(fixture.idling({ durationMs: 1000, fadeDurationMs: 0 }).props.style[fadeKey], "0ms");
});

test("missing or malformed next source and marker times never acquire a duration override", () => {
	for (const lyrics of [
		[lyric(1000, 2000, "Earlier"), lyric(10500, 12000, "♪")],
		[lyric(1000, 2000, "Earlier"), lyric(NaN, 11400, "♪"), lyric(12000, 13300, "Next")],
		[lyric(1000, 2000, "Earlier"), lyric(10500, 11400, "♪"), lyric(NaN, 13300, "Next")],
		[lyric(1000, 2000, "Earlier"), lyric(10500, 10600, ""), lyric(11000, 12000, "Next")],
	]) {
		const frame = createCompactInterludeFixture().render(lyrics, 11800);
		for (const consumer of frame.consumers) expectNoDuration(consumer);
	}
});

for (const startTime of ["10500", null]) {
	for (const isKara of [false, true]) {
		test(`owned-admitted ${startTime === null ? "null" : "numeric-string"} marker start keeps a finite legacy duration in ${isKara ? "karaoke" : "plain"} mode`, () => {
			const fixture = createCompactInterludeFixture();
			const lyrics = [lyric(1000, 3000, "Earlier"), lyric(startTime, 11400, "♪"), lyric(12000, 13300, "Next")];
			const render = position => fixture.render(lyrics, position, { isKara });
			const entry = render(11800), entered = marker(entry);
			assert.equal(departing(entered), true, "preserve owned admission through toFiniteTime");
			expectExplicitDuration(entered, 220);
			assert.equal(entered.item.line.startTime, startTime, "do not normalize the raw source timestamp");
			assert.equal(entered.item.startTime, startTime);
			expectFuture(entry, "Next");
			for (const position of [11816, 11900, 11999]) {
				const frame = render(position), next = marker(frame);
				expectExplicitDuration(next, 220);
				assert.equal(next.outer.props.style, entered.outer.props.style);
				assert.equal(next.item.line, entered.item.line);
				expectFuture(frame, "Next");
			}
			const boundary = render(12000);
			assert.equal(departing(marker(boundary)), false);
			assert.equal(sourceRow(boundary, "Next").props.isActive, true);
			assert.equal(sourceRow(boundary, "Next").props.position, isKara ? 12000 : 0);
			assert.equal(lyrics[1].startTime, startTime);
		});
	}
}
