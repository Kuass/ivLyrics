// LP mode active lyric surface.
//
// Kept separate from Pages.js so fullscreen vinyl presentation can evolve
// independently while still using the regular renderer's proven primitives.
const VinylActiveLyricRenderer = (() => {
    const react = Spicetify.React;
    const { useLayoutEffect, useMemo, useRef } = react;
    const primitives = window.ivLyricsLyricRendererPrimitives;

    const SCROLL_EDGE_HOLD_MS = 1050;
    const SCROLL_MIN_MOVE_MS = 1800;
    const SCROLL_MAX_MOVE_MS = 5600;
    const SCROLL_SPEED_PX_PER_SECOND = 46;
    const SCROLL_OVERFLOW_THRESHOLD_PX = 1;
    const SCROLL_EASING = "cubic-bezier(0.333333, 0, 0.666667, 1)";

    const getScrollMotion = (travelValue, direction = "ltr") => {
        const travel = Math.max(0, Number(travelValue) || 0);
        const moveDurationMs = Math.min(
            SCROLL_MAX_MOVE_MS,
            Math.max(
                SCROLL_MIN_MOVE_MS,
                Math.round((travel / SCROLL_SPEED_PX_PER_SECOND) * 1000)
            )
        );
        const durationMs = (SCROLL_EDGE_HOLD_MS + moveDurationMs) * 2;
        const endOffset = direction === "rtl" ? travel : -travel;
        const firstHoldOffset = SCROLL_EDGE_HOLD_MS / durationMs;
        const farEdgeOffset = (SCROLL_EDGE_HOLD_MS + moveDurationMs) / durationMs;
        const secondHoldOffset = (SCROLL_EDGE_HOLD_MS * 2 + moveDurationMs) / durationMs;
        const startTransform = "translate3d(0px, 0, 0)";
        const endTransform = `translate3d(${endOffset}px, 0, 0)`;

        return {
            travel,
            moveDurationMs,
            durationMs,
            keyframes: [
                { transform: startTransform, offset: 0 },
                { transform: startTransform, offset: firstHoldOffset, easing: SCROLL_EASING },
                { transform: endTransform, offset: farEdgeOffset },
                { transform: endTransform, offset: secondHoldOffset, easing: SCROLL_EASING },
                { transform: startTransform, offset: 1 },
            ],
        };
    };

    const useOverflowAutoScroll = (rootRef, resetKey, motionEnabled) => {
        useLayoutEffect(() => {
            const root = rootRef.current;
            if (!root) return undefined;

            const animations = new Map();
            const motionPreference = typeof window.matchMedia === "function"
                ? window.matchMedia("(prefers-reduced-motion: reduce)")
                : null;
            let resizeObserver = null;
            let mutationObserver = null;
            let measureFrame = null;
            let disposed = false;

            const clearAnimations = () => {
                animations.forEach((animation) => animation.cancel());
                animations.clear();
            };

            const measure = () => {
                measureFrame = null;
                if (disposed || !root.isConnected) return;

                clearAnimations();
                const reduceMotion = !motionEnabled || motionPreference?.matches === true;
                const viewports = root.querySelectorAll(".ivlyrics-vinyl-lyric-scroll-viewport");

                viewports.forEach((viewport) => {
                    const content = viewport.querySelector(":scope > .ivlyrics-vinyl-lyric-scroll-content");
                    viewport.classList.remove("is-vinyl-lyric-overflowing");
                    if (!content) return;

                    const viewportWidth = viewport.clientWidth;
                    const naturalContentWidth = Math.max(
                        content.scrollWidth,
                        content.getBoundingClientRect().width
                    );
                    const naturalTravel = naturalContentWidth - viewportWidth;

                    if (viewportWidth <= 0 || naturalTravel <= SCROLL_OVERFLOW_THRESHOLD_PX) {
                        return;
                    }

                    viewport.classList.add("is-vinyl-lyric-overflowing");
                    const paddedContentWidth = Math.max(
                        content.scrollWidth,
                        content.getBoundingClientRect().width
                    );
                    const travel = Math.max(0, Math.ceil(paddedContentWidth - viewportWidth));

                    if (reduceMotion || travel <= SCROLL_OVERFLOW_THRESHOLD_PX || typeof content.animate !== "function") {
                        return;
                    }

                    const direction = window.getComputedStyle(viewport).direction === "rtl" ? "rtl" : "ltr";
                    const motion = getScrollMotion(travel, direction);
                    const animation = content.animate(motion.keyframes, {
                        duration: motion.durationMs,
                        iterations: Infinity,
                        easing: "linear",
                    });
                    animations.set(content, animation);
                });
            };

            const scheduleMeasure = () => {
                if (disposed || measureFrame !== null) return;
                measureFrame = window.requestAnimationFrame(measure);
            };

            scheduleMeasure();

            if (typeof window.ResizeObserver === "function") {
                resizeObserver = new window.ResizeObserver(scheduleMeasure);
                resizeObserver.observe(root);
            } else {
                window.addEventListener("resize", scheduleMeasure);
            }

            if (typeof window.MutationObserver === "function") {
                mutationObserver = new window.MutationObserver(scheduleMeasure);
                mutationObserver.observe(root, { childList: true, characterData: true, subtree: true });
            }

            motionPreference?.addEventListener?.("change", scheduleMeasure);
            document.fonts?.ready?.then(scheduleMeasure).catch(() => undefined);
            document.fonts?.addEventListener?.("loadingdone", scheduleMeasure);

            return () => {
                disposed = true;
                if (measureFrame !== null) window.cancelAnimationFrame(measureFrame);
                clearAnimations();
                resizeObserver?.disconnect();
                mutationObserver?.disconnect();
                if (!resizeObserver) window.removeEventListener("resize", scheduleMeasure);
                motionPreference?.removeEventListener?.("change", scheduleMeasure);
                document.fonts?.removeEventListener?.("loadingdone", scheduleMeasure);
            };
        }, [rootRef, resetKey, motionEnabled]);
    };

    if (!primitives) {
        console.warn("[VinylActiveLyricRenderer] Lyrics renderer primitives are unavailable.");
        return null;
    }

    const {
        LyricsLineBlock,
        IdlingIndicator,
        useLyricsPlaybackPosition,
        getPseudoKaraokeRenderAdvance,
        prepareGlobalCharTimeline,
        queryGlobalCharTimeline,
        EMPTY_GLOBAL_CHAR_STATE,
        getInterludeInfo,
        createActiveTrailingKaraokeInterludeLine,
        getEmbeddedAuxiliaryDisplayValues,
        buildLyricDisplayState,
        getKaraokeLineMetaClass,
        getKaraokeSpeakerStyle,
    } = primitives;

    return react.memo(({
        lyrics = [],
        activeLineIndex = 0,
        isKara = false,
        karaokeSource = null,
        settingsRevision = 0,
        positionOverride = null,
        motionEnabled = true,
    }) => {
        const rootRef = useRef(null);
        const playbackPosition = useLyricsPlaybackPosition();
        const numericPositionOverride = Number(positionOverride);
        const position = positionOverride !== null
            && positionOverride !== undefined
            && Number.isFinite(numericPositionOverride)
            ? numericPositionOverride
            : playbackPosition;
        const renderPosition = isKara
            ? position + getPseudoKaraokeRenderAdvance(karaokeSource)
            : position;
        const safeLineIndex = Math.min(
            Math.max(Number(activeLineIndex) || 0, 0),
            Math.max(lyrics.length - 1, 0)
        );
        const sourceLine = Array.isArray(lyrics) ? lyrics[safeLineIndex] : null;
        const scrollResetKey = `${safeLineIndex}:${sourceLine?.startTime || 0}:${isKara ? 1 : 0}:${settingsRevision}`;
        useOverflowAutoScroll(rootRef, scrollResetKey, motionEnabled);
        const globalCharTimeline = useMemo(
            () => isKara && Array.isArray(lyrics) ? prepareGlobalCharTimeline(lyrics) : null,
            [lyrics, isKara]
        );
        const { globalCharOffsets, activeGlobalCharIndex } = useMemo(
            () => globalCharTimeline
                ? queryGlobalCharTimeline(globalCharTimeline, renderPosition)
                : EMPTY_GLOBAL_CHAR_STATE,
            [globalCharTimeline, renderPosition]
        );

        const firstLyricStartTime = Number(lyrics?.[0]?.startTime) || 1;
        const isLeadingPrelude = renderPosition < firstLyricStartTime;

        if (isLeadingPrelude) {
            return react.createElement(
                "div",
                {
                    className: `ivlyrics-active-lyric-renderer${isKara ? " is-karaoke" : ""}`,
                    ref: rootRef,
                },
                react.createElement(IdlingIndicator, {
                    isActive: true,
                    delay: firstLyricStartTime / 3,
                    durationMs: firstLyricStartTime,
                    settingsRevision,
                })
            );
        }

        if (!sourceLine) return null;

        const sourceInterludeInfo = getInterludeInfo(
            sourceLine,
            lyrics[safeLineIndex + 1],
            safeLineIndex,
            lyrics.length
        );
        const preparedSourceLine = sourceInterludeInfo.isInterlude
            ? { ...sourceLine, interludeInfo: sourceInterludeInfo }
            : sourceLine;
        const trailingInterludeLine = isKara
            ? createActiveTrailingKaraokeInterludeLine({
                line: preparedSourceLine,
                nextLine: lyrics[safeLineIndex + 1],
                lineIndex: safeLineIndex,
                lineCount: lyrics.length,
                position: renderPosition,
                isActiveLine: true,
                isKara,
            })
            : null;
        const displayLine = trailingInterludeLine || preparedSourceLine;
        const { text, originalText, text2 } = getEmbeddedAuxiliaryDisplayValues(displayLine);
        const { mainText, subText, subText2, hasSubLine } = buildLyricDisplayState(
            isKara,
            displayLine,
            text,
            originalText,
            text2
        );
        const lineClassName = [
            "lyrics-lyricsContainer-LyricsLine",
            "lyrics-lyricsContainer-LyricsLine-active",
            getKaraokeLineMetaClass(displayLine),
            hasSubLine ? "lyrics-lyricsContainer-LyricsLine-hasSubLine" : "",
        ].filter(Boolean).join(" ");

        return react.createElement(
            "div",
            {
                className: `ivlyrics-active-lyric-renderer${isKara ? " is-karaoke" : ""}`,
                ref: rootRef,
            },
            react.createElement(LyricsLineBlock, {
                key: `active-lyric-${safeLineIndex}-${displayLine?.startTime || 0}`,
                className: lineClassName,
                style: getKaraokeSpeakerStyle(
                    displayLine?.speaker,
                    displayLine?.["speaker-color"],
                    displayLine?.["speaker-fallback"]
                ),
                dir: "auto",
                mainText,
                subText,
                subText2,
                originalText,
                isKara,
                line: displayLine,
                position: trailingInterludeLine || !isKara ? 0 : renderPosition,
                isActive: isKara && !trailingInterludeLine,
                isCurrentLine: true,
                settingsRevision,
                globalCharOffset: globalCharOffsets[safeLineIndex] || 0,
                activeGlobalCharIndex: isKara && !trailingInterludeLine
                    ? activeGlobalCharIndex
                    : -1,
                singleLineScroll: true,
            })
        );
    });
})();

if (VinylActiveLyricRenderer) {
    window.ivLyricsActiveLyricLineRenderer = VinylActiveLyricRenderer;
}
