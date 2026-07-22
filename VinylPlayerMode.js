// Focused fullscreen LP player mode.
//
// FullscreenOverlay owns only the entry gesture and supplies playback data.
// This module owns the vinyl scene, tonearm interaction, lyric surface, and
// track-to-track transition so the regular fullscreen layout stays isolated.
const VinylPlayerMode = (() => {
    const react = Spicetify.React;
    const { useState, useEffect, useCallback, useRef } = react;

    const formatTime = (ms) => {
        if (!ms || ms < 0) return "0:00";
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };

    const VINYL_PLAY_PHASES = [
        ["unsleeving", 0],
        ["cover-turning", 460],
        ["lifting", 780],
        ["settling", 1000],
        ["dropping", 1560],
        ["playing", 2280]
    ];

    const VINYL_PAUSE_PHASES = [
        ["pausing", 0],
        ["clearing", 720],
        ["sleeving", 1180],
        ["sleeved", 1250],
        ["paused", 2030]
    ];

    const TRACK_ALBUM_ARRIVE_MS = 700;
    const TRACK_RECORD_EMERGE_MS = 720;
    const TRACK_RECORD_RAISE_MS = 360;
    const TRACK_HANDOFF_MS = 96;
    const TRACK_COVER_PRELOAD_MAX_MS = 320;
    const TRACK_LYRIC_CROSSFADE_MS = 420;

    const clampVinylProgress = (value) => Math.min(Math.max(value, 0), 1);
    const VINYL_TONEARM_MIN_ANGLE = -5.4;
    const VINYL_TONEARM_MAX_ANGLE = 18;
    const VINYL_TONEARM_EJECT_ANGLE = -8.2;
    const VINYL_TONEARM_REST_ANGLE = -14;
    const VINYL_TONEARM_CUE_PLAY_ANGLE = -7.2;
    const VINYL_POINTER_RELEASE_GRACE_MS = 90;

    const VinylDisc = react.memo(({
        title,
        artist,
        album,
        idPrefix
    }) => {
        const albumCopySource = String(album || "ivLyrics").trim();
        const albumCopy = albumCopySource.length > 42
            ? `${albumCopySource.slice(0, 39)}…`
            : albumCopySource;
        const topArcId = `${idPrefix}-arc-top`;
        const bottomArcId = `${idPrefix}-arc-bottom`;

        return react.createElement("span", { className: "ivlyrics-vinyl-record" },
            react.createElement("span", { className: "ivlyrics-vinyl-motion" }),
            react.createElement("span", { className: "ivlyrics-vinyl-label" },
                react.createElement("span", { className: "ivlyrics-vinyl-label-ring" }),
                react.createElement("svg", {
                    className: "ivlyrics-vinyl-label-copy",
                    viewBox: "0 0 320 320",
                    "aria-hidden": "true"
                },
                    react.createElement("defs", null,
                        react.createElement("path", {
                            id: topArcId,
                            d: "M 45 154 A 116 116 0 0 1 275 154"
                        }),
                        react.createElement("path", {
                            id: bottomArcId,
                            d: "M 45 178 A 116 116 0 0 0 275 178"
                        })
                    ),
                    react.createElement("text", { className: "ivlyrics-vinyl-label-arc-text" },
                        react.createElement("textPath", {
                            href: `#${topArcId}`,
                            startOffset: "50%",
                            textAnchor: "middle"
                        }, albumCopy)
                    ),
                    react.createElement("text", { className: "ivlyrics-vinyl-label-arc-text" },
                        react.createElement("textPath", {
                            href: `#${bottomArcId}`,
                            startOffset: "50%",
                            textAnchor: "middle"
                        }, albumCopy)
                    )
                ),
                react.createElement("span", { className: "ivlyrics-vinyl-label-title" }, title || "LP"),
                react.createElement("span", { className: "ivlyrics-vinyl-label-artist" }, artist || ""),
                react.createElement("span", { className: "ivlyrics-vinyl-label-spindle" })
            )
        );
    });

    const VinylPlayer = react.memo(({
        coverUrl,
        title,
        artist,
        album,
        incomingTrack = null,
        isPlaying,
        position,
        duration,
        onSeek,
        onStopPlayback,
        onTogglePlayback,
        animationsEnabled = true,
        interactionProps = {},
        className = "",
        style = {}
    }) => {
        const [phase, setPhase] = useState("paused");
        const [scrubPosition, setScrubPosition] = useState(null);
        const [dragTonearmAngle, setDragTonearmAngle] = useState(null);
        const [cueReady, setCueReady] = useState(false);
        const [optimisticPosition, setOptimisticPosition] = useState(null);
        const phaseRef = useRef("paused");
        const tonearmRef = useRef(null);
        const activePointerRef = useRef(null);
        const interactionModeRef = useRef(null);
        const scrubPositionRef = useRef(null);
        const dragStateRef = useRef(null);
        const dragAngleOffsetRef = useRef(0);
        const pointerReleaseTimerRef = useRef(null);
        const optimisticSeekTimerRef = useRef(null);
        const cancelTonearmInteractionRef = useRef(null);
        const finishTonearmInteractionRef = useRef(null);
        const moveTonearmRef = useRef(null);

        const setVisualPhase = useCallback((nextPhase) => {
            phaseRef.current = nextPhase;
            setPhase(nextPhase);
        }, []);

        const clearPointerReleaseTimer = useCallback(() => {
            if (!pointerReleaseTimerRef.current) return;
            window.clearTimeout(pointerReleaseTimerRef.current);
            pointerReleaseTimerRef.current = null;
        }, []);

        const setTonearmPreview = useCallback((dragState, interactionMode = interactionModeRef.current) => {
            dragStateRef.current = dragState;
            setDragTonearmAngle(dragState.angle);
            if (interactionMode === "seek") {
                scrubPositionRef.current = dragState.position;
                setScrubPosition(dragState.position);
            } else {
                setCueReady(!!dragState.shouldPlay);
            }
        }, []);

        const clearTonearmPreview = useCallback(() => {
            scrubPositionRef.current = null;
            dragStateRef.current = null;
            setScrubPosition(null);
            setDragTonearmAngle(null);
            setCueReady(false);
        }, []);

        const releaseTonearmPointer = useCallback((pointerId) => {
            clearPointerReleaseTimer();
            activePointerRef.current = null;
            interactionModeRef.current = null;
            if (pointerId === null || pointerId === undefined) return;

            try {
                if (tonearmRef.current?.hasPointerCapture?.(pointerId)) {
                    tonearmRef.current.releasePointerCapture(pointerId);
                }
            } catch (_) {
                // Pointer capture may already have been released by the browser.
            }
        }, [clearPointerReleaseTimer]);

        const cancelTonearmInteraction = useCallback((pointerId = activePointerRef.current) => {
            if (activePointerRef.current === null) return;
            releaseTonearmPointer(pointerId);
            clearTonearmPreview();
        }, [clearTonearmPreview, releaseTonearmPointer]);
        cancelTonearmInteractionRef.current = cancelTonearmInteraction;

        useEffect(() => {
            const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            const finalPhase = isPlaying ? "playing" : "paused";

            if (!animationsEnabled || reducedMotion) {
                setVisualPhase(finalPhase);
                return undefined;
            }

            if (phaseRef.current === finalPhase) return undefined;
            if (!isPlaying && phaseRef.current === "paused") return undefined;

            const phaseSequence = isPlaying ? VINYL_PLAY_PHASES : VINYL_PAUSE_PHASES;
            const timers = [];
            const frameId = window.requestAnimationFrame(() => {
                phaseSequence.forEach(([nextPhase, delay]) => {
                    if (delay === 0) {
                        setVisualPhase(nextPhase);
                        return;
                    }
                    timers.push(window.setTimeout(() => setVisualPhase(nextPhase), delay));
                });
            });

            return () => {
                window.cancelAnimationFrame(frameId);
                timers.forEach((timer) => window.clearTimeout(timer));
            };
        }, [animationsEnabled, isPlaying, setVisualPhase]);

        useEffect(() => {
            if (!isPlaying) {
                cancelTonearmInteraction();
                clearTonearmPreview();
                setOptimisticPosition(null);
                if (optimisticSeekTimerRef.current) {
                    window.clearTimeout(optimisticSeekTimerRef.current);
                    optimisticSeekTimerRef.current = null;
                }
            }
        }, [cancelTonearmInteraction, clearTonearmPreview, isPlaying]);

        useEffect(() => {
            if (optimisticPosition === null) return;
            const externalPosition = Math.max(Number(position) || 0, 0);
            if (Math.abs(externalPosition - optimisticPosition) <= 1500) {
                if (optimisticSeekTimerRef.current) {
                    window.clearTimeout(optimisticSeekTimerRef.current);
                    optimisticSeekTimerRef.current = null;
                }
                setOptimisticPosition(null);
            }
        }, [optimisticPosition, position]);

        useEffect(() => () => {
            clearPointerReleaseTimer();
            if (optimisticSeekTimerRef.current) {
                window.clearTimeout(optimisticSeekTimerRef.current);
            }
        }, [clearPointerReleaseTimer]);

        const safeDuration = Math.max(Number(duration) || 0, 0);
        const safePosition = Math.min(
            Math.max(Number(scrubPosition ?? optimisticPosition ?? position) || 0, 0),
            safeDuration || Infinity
        );
        const playbackProgress = safeDuration > 0 ? clampVinylProgress(safePosition / safeDuration) : 0;
        const tonearmRange = VINYL_TONEARM_MAX_ANGLE - VINYL_TONEARM_MIN_ANGLE;
        const playbackTonearmAngle = VINYL_TONEARM_MIN_ANGLE + playbackProgress * tonearmRange;
        const tonearmAngle = dragTonearmAngle ?? playbackTonearmAngle;
        const canScrub = isPlaying && phase === "playing" && safeDuration > 0;
        const canCuePlay = !isPlaying && (phase === "paused" || phase === "sleeved");
        const canControlTonearm = canScrub || canCuePlay;

        const getPointerAngle = useCallback((event) => {
            const bounds = tonearmRef.current?.getBoundingClientRect();
            if (!bounds) return 0;
            const pivotX = bounds.left + (183 / 260) * bounds.width;
            const pivotY = bounds.top + (64 / 620) * bounds.height;
            return Math.atan2(event.clientY - pivotY, event.clientX - pivotX) * 180 / Math.PI;
        }, []);

        const getTonearmDragState = useCallback((event, interactionMode = interactionModeRef.current) => {
            const rawAngle = getPointerAngle(event) + dragAngleOffsetRef.current;
            if (interactionMode === "cue-play") {
                const cueAngle = Math.min(
                    Math.max(rawAngle, VINYL_TONEARM_REST_ANGLE),
                    VINYL_TONEARM_MIN_ANGLE
                );
                return {
                    angle: cueAngle,
                    isOutside: false,
                    shouldPlay: cueAngle >= VINYL_TONEARM_CUE_PLAY_ANGLE,
                    position: null
                };
            }

            const seekAngle = Math.min(
                Math.max(rawAngle, VINYL_TONEARM_MIN_ANGLE),
                VINYL_TONEARM_MAX_ANGLE
            );
            const displayAngle = Math.min(
                Math.max(rawAngle, VINYL_TONEARM_REST_ANGLE),
                VINYL_TONEARM_MAX_ANGLE
            );
            const nextProgress = (seekAngle - VINYL_TONEARM_MIN_ANGLE) / tonearmRange;
            return {
                angle: displayAngle,
                isOutside: rawAngle <= VINYL_TONEARM_EJECT_ANGLE,
                shouldPlay: false,
                position: clampVinylProgress(nextProgress) * safeDuration
            };
        }, [getPointerAngle, safeDuration, tonearmRange]);

        const commitSeek = useCallback((nextPosition) => {
            const clampedPosition = Math.min(Math.max(nextPosition, 0), safeDuration);
            clearTonearmPreview();
            setOptimisticPosition(clampedPosition);
            onSeek?.(clampedPosition);

            if (optimisticSeekTimerRef.current) {
                window.clearTimeout(optimisticSeekTimerRef.current);
            }
            optimisticSeekTimerRef.current = window.setTimeout(() => {
                optimisticSeekTimerRef.current = null;
                setOptimisticPosition(null);
            }, 1600);
        }, [clearTonearmPreview, onSeek, safeDuration]);

        const stopFromTonearm = useCallback((pointerId) => {
            releaseTonearmPointer(pointerId);
            clearTonearmPreview();
            setOptimisticPosition(null);
            setVisualPhase("pausing");
            onStopPlayback?.();
        }, [clearTonearmPreview, onStopPlayback, releaseTonearmPointer, setVisualPhase]);

        const beginTonearmInteraction = useCallback((event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!canControlTonearm || event.isPrimary === false || (event.button ?? 0) !== 0) return;

            if (optimisticSeekTimerRef.current) {
                window.clearTimeout(optimisticSeekTimerRef.current);
                optimisticSeekTimerRef.current = null;
            }
            clearPointerReleaseTimer();
            setOptimisticPosition(null);
            const interactionMode = canScrub ? "seek" : "cue-play";
            activePointerRef.current = event.pointerId;
            interactionModeRef.current = interactionMode;
            const initialAngle = interactionMode === "seek"
                ? playbackTonearmAngle
                : VINYL_TONEARM_REST_ANGLE;
            dragAngleOffsetRef.current = initialAngle - getPointerAngle(event);
            try {
                tonearmRef.current?.setPointerCapture?.(event.pointerId);
            } catch (_) {
                // Window-level pointer listeners continue the gesture if capture is unavailable.
            }
            setTonearmPreview(
                getTonearmDragState(event, interactionMode),
                interactionMode
            );
        }, [
            canControlTonearm,
            canScrub,
            clearPointerReleaseTimer,
            getPointerAngle,
            getTonearmDragState,
            playbackTonearmAngle,
            setTonearmPreview
        ]);

        const finishTonearmInteraction = useCallback((event, shouldCommit = true, useLastPreview = false) => {
            if (activePointerRef.current !== event.pointerId) return;
            clearPointerReleaseTimer();
            event.preventDefault?.();
            event.stopPropagation?.();
            const interactionMode = interactionModeRef.current;

            if (!shouldCommit) {
                releaseTonearmPointer(event.pointerId);
                clearTonearmPreview();
                return;
            }

            const dragState = useLastPreview
                ? dragStateRef.current
                : getTonearmDragState(event, interactionMode);
            if (!dragState) {
                releaseTonearmPointer(event.pointerId);
                clearTonearmPreview();
                return;
            }

            if (interactionMode === "cue-play") {
                const shouldStartPlayback = !!dragState.shouldPlay;
                releaseTonearmPointer(event.pointerId);
                clearTonearmPreview();
                if (shouldStartPlayback) onTogglePlayback?.();
                return;
            }

            if (dragState.isOutside) {
                stopFromTonearm(event.pointerId);
                return;
            }

            releaseTonearmPointer(event.pointerId);
            commitSeek(dragState.position);
        }, [
            clearPointerReleaseTimer,
            clearTonearmPreview,
            commitSeek,
            getTonearmDragState,
            onTogglePlayback,
            releaseTonearmPointer,
            stopFromTonearm
        ]);
        finishTonearmInteractionRef.current = finishTonearmInteraction;

        const schedulePointerReleaseFallback = useCallback((pointerId) => {
            if (pointerReleaseTimerRef.current) return;
            pointerReleaseTimerRef.current = window.setTimeout(() => {
                pointerReleaseTimerRef.current = null;
                if (activePointerRef.current !== pointerId) return;
                finishTonearmInteraction({
                    pointerId,
                    preventDefault: () => undefined,
                    stopPropagation: () => undefined
                }, true, true);
            }, VINYL_POINTER_RELEASE_GRACE_MS);
        }, [finishTonearmInteraction]);

        const moveTonearm = useCallback((event) => {
            if (activePointerRef.current !== event.pointerId) return;

            const isTransientMouseReleaseFrame = event.pointerType === "mouse"
                && (Number(event.buttons) & 1) !== 1;
            if (isTransientMouseReleaseFrame) {
                schedulePointerReleaseFallback(event.pointerId);
                return;
            }

            clearPointerReleaseTimer();
            event.preventDefault();
            event.stopPropagation();
            const interactionMode = interactionModeRef.current;
            setTonearmPreview(
                getTonearmDragState(event, interactionMode),
                interactionMode
            );
        }, [
            clearPointerReleaseTimer,
            getTonearmDragState,
            schedulePointerReleaseFallback,
            setTonearmPreview
        ]);
        moveTonearmRef.current = moveTonearm;

        const handleLostPointerCapture = useCallback((event) => {
            if (activePointerRef.current !== event.pointerId) return;
            // Do not end the interaction here. Electron can transiently lose
            // capture during a drag; window pointermove/up listeners take over.
        }, []);

        useEffect(() => {
            const handleWindowPointerMove = (event) => moveTonearmRef.current?.(event);
            const handleWindowPointerUp = (event) => finishTonearmInteractionRef.current?.(event, true);
            const handleWindowPointerCancel = (event) => finishTonearmInteractionRef.current?.(event, false);
            const handleInteractionInterrupted = () => cancelTonearmInteractionRef.current?.();
            const pointerMoveOptions = { capture: true, passive: false };
            const handleVisibilityChange = () => {
                if (document.visibilityState === "hidden") cancelTonearmInteractionRef.current?.();
            };

            // Capture-phase listeners keep ownership even when another Spotify
            // surface stops propagation after pointer capture is lost.
            window.addEventListener("pointermove", handleWindowPointerMove, pointerMoveOptions);
            window.addEventListener("pointerup", handleWindowPointerUp, true);
            window.addEventListener("pointercancel", handleWindowPointerCancel, true);
            window.addEventListener("blur", handleInteractionInterrupted);
            document.addEventListener("visibilitychange", handleVisibilityChange);

            return () => {
                window.removeEventListener("pointermove", handleWindowPointerMove, pointerMoveOptions);
                window.removeEventListener("pointerup", handleWindowPointerUp, true);
                window.removeEventListener("pointercancel", handleWindowPointerCancel, true);
                window.removeEventListener("blur", handleInteractionInterrupted);
                document.removeEventListener("visibilitychange", handleVisibilityChange);
                const pointerId = activePointerRef.current;
                activePointerRef.current = null;
                interactionModeRef.current = null;
                scrubPositionRef.current = null;
                dragStateRef.current = null;
                clearPointerReleaseTimer();
                if (pointerId !== null && tonearmRef.current?.hasPointerCapture?.(pointerId)) {
                    try {
                        tonearmRef.current.releasePointerCapture(pointerId);
                    } catch (_) { }
                }
            };
        }, [clearPointerReleaseTimer]);

        const handleTonearmKeyDown = useCallback((event) => {
            if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                onTogglePlayback?.();
                return;
            }
            if (!canScrub) return;

            let nextPosition = null;
            if (event.key === "ArrowLeft") nextPosition = safePosition - 5000;
            if (event.key === "ArrowRight") nextPosition = safePosition + 5000;
            if (event.key === "Home") nextPosition = 0;
            if (event.key === "End") nextPosition = safeDuration;
            if (nextPosition === null) return;

            event.preventDefault();
            commitSeek(nextPosition);
        }, [canScrub, commitSeek, onTogglePlayback, safeDuration, safePosition]);

        const playLabel = I18n.t(isPlaying ? "fullscreen.controls.pause" : "fullscreen.controls.play");
        const vinylModeLabel = I18n.t("vinyl.mode") || "LP";
        const albumLabel = I18n.t("vinyl.closeHint")
            || I18n.t("fullscreen.backgroundOptions.albumArt");
        const tonearmLabel = I18n.t("vinyl.tonearmHint") || vinylModeLabel;
        const isCueingTonearm = dragTonearmAngle !== null
            && interactionModeRef.current === "cue-play";
        const isEjectingTonearm = dragTonearmAngle !== null
            && interactionModeRef.current === "seek"
            && !!dragStateRef.current?.isOutside;
        const rootClassName = [
            "ivlyrics-vinyl-player",
            `is-${phase}`,
            scrubPosition !== null ? "is-scrubbing" : "",
            isCueingTonearm ? "is-cueing" : "",
            cueReady ? "is-cue-ready" : "",
            isEjectingTonearm ? "is-ejecting" : "",
            className
        ].filter(Boolean).join(" ");

        return react.createElement("div", {
            className: rootClassName,
            style: {
                ...style,
                "--iv-vinyl-tonearm-angle": `${tonearmAngle.toFixed(3)}deg`
            },
            role: "group",
            "aria-label": vinylModeLabel
        },
            react.createElement("div", { className: "ivlyrics-vinyl-visual-group" },
                react.createElement("button", {
                    type: "button",
                    className: "ivlyrics-vinyl-record-shell",
                    "aria-label": playLabel,
                    onPointerDown: (event) => event.stopPropagation(),
                    onClick: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onTogglePlayback?.();
                    }
                },
                    react.createElement(VinylDisc, {
                        title,
                        artist,
                        album,
                        idPrefix: "ivlyrics-vinyl-current"
                    })
                ),
                react.createElement("button", {
                    ...interactionProps,
                    type: "button",
                    className: "ivlyrics-vinyl-sleeve ivlyrics-fullscreen-shared-album",
                    "aria-label": albumLabel
                },
                    react.createElement("img", {
                        src: coverUrl,
                        alt: "",
                        draggable: false
                    })
                ),
                incomingTrack && react.createElement("span", {
                    className: "ivlyrics-vinyl-incoming-sleeve",
                    "aria-hidden": "true",
                    style: { "--iv-vinyl-flight-radius": `${style["--iv-vinyl-album-radius"] || "2.4%"}` }
                },
                    react.createElement("img", {
                        src: incomingTrack.coverUrl,
                        alt: "",
                        draggable: false
                    }),
                    react.createElement("span", { className: "ivlyrics-vinyl-track-flight-shine" })
                ),
                incomingTrack && react.createElement("span", {
                    className: "ivlyrics-vinyl-incoming-record-shell",
                    "aria-hidden": "true",
                    style: incomingTrack.accent
                        ? { "--iv-vinyl-accent": incomingTrack.accent }
                        : undefined
                },
                    react.createElement(VinylDisc, {
                        title: incomingTrack.title,
                        artist: incomingTrack.artist,
                        album: incomingTrack.album,
                        idPrefix: "ivlyrics-vinyl-incoming"
                    })
                )
            ),
            react.createElement("svg", {
                ref: tonearmRef,
                className: "ivlyrics-vinyl-tonearm",
                viewBox: "0 0 260 620",
                role: "slider",
                tabIndex: 0,
                "aria-label": tonearmLabel,
                "aria-valuemin": 0,
                "aria-valuemax": Math.round(safeDuration),
                "aria-valuenow": Math.round(safePosition),
                "aria-valuetext": cueReady
                    ? playLabel
                    : `${formatTime(safePosition)} / ${formatTime(safeDuration)}`,
                "aria-disabled": !canControlTonearm,
                onPointerDown: beginTonearmInteraction,
                onPointerMove: moveTonearm,
                onPointerUp: (event) => finishTonearmInteraction(event, true),
                onPointerCancel: (event) => finishTonearmInteraction(event, false),
                onLostPointerCapture: handleLostPointerCapture,
                onClick: (event) => event.stopPropagation(),
                onKeyDown: handleTonearmKeyDown
            },
                react.createElement("title", null, "Tonearm"),
                react.createElement("defs", null,
                    react.createElement("radialGradient", { id: "ivlyrics-vinyl-tonearm-base", cx: "42%", cy: "34%", r: "72%" },
                        react.createElement("stop", { offset: "0", stopColor: "#fff", stopOpacity: ".88" }),
                        react.createElement("stop", { offset: ".58", stopColor: "#fbfbfb", stopOpacity: ".62" }),
                        react.createElement("stop", { offset: "1", stopColor: "#eee", stopOpacity: ".34" })
                    ),
                    react.createElement("linearGradient", { id: "ivlyrics-vinyl-tonearm-tube", x1: "0", x2: "1" },
                        react.createElement("stop", { offset: "0", stopColor: "#aaa" }),
                        react.createElement("stop", { offset: ".24", stopColor: "#fafafa" }),
                        react.createElement("stop", { offset: ".55", stopColor: "#fff" }),
                        react.createElement("stop", { offset: "1", stopColor: "#bbb" })
                    )
                ),
                react.createElement("circle", { className: "ivlyrics-vinyl-tonearm-base", cx: "183", cy: "64", r: "66" }),
                react.createElement("circle", { className: "ivlyrics-vinyl-tonearm-base-edge", cx: "183", cy: "64", r: "66" }),
                react.createElement("g", { className: "ivlyrics-vinyl-tonearm-moving" },
                    react.createElement("path", { className: "ivlyrics-vinyl-tonearm-shadow", d: "M 189 75 C 184 172 151 330 78 474 L 58 513" }),
                    react.createElement("path", { className: "ivlyrics-vinyl-tonearm-tube", d: "M 189 75 C 184 172 151 330 78 474 L 58 513" }),
                    react.createElement("path", { className: "ivlyrics-vinyl-tonearm-highlight", d: "M 184 79 C 178 179 145 330 74 469" }),
                    react.createElement("path", { className: "ivlyrics-vinyl-pivot-housing", d: "M 151 35 L 200 39 L 215 66 L 207 109 L 170 111 L 151 91 L 144 61 Z" }),
                    react.createElement("path", { className: "ivlyrics-vinyl-pivot-highlight", d: "M 158 42 L 194 45 L 207 65 L 202 91" }),
                    react.createElement("path", { className: "ivlyrics-vinyl-headshell", d: "M 47 490 L 75 508 L 54 546 L 30 540 L 17 522 L 24 506 Z" }),
                    react.createElement("path", { className: "ivlyrics-vinyl-headshell-highlight", d: "M 28 509 L 66 517 L 49 539" }),
                    react.createElement("path", { className: "ivlyrics-vinyl-needle", d: "M 35 539 L 33 555 M 48 542 L 53 557" })
                )
            )
        );
    });

    const areSameTrackVisuals = (left, right) => left?.coverUrl === right?.coverUrl
        && left?.title === right?.title
        && left?.artist === right?.artist
        && left?.album === right?.album;

    const getTrackVisualKey = (track) => [
        track?.uri,
        track?.coverUrl,
        track?.title,
        track?.artist,
        track?.album
    ].map((value) => String(value || "")).join("\u0001");

    const Mode = react.memo(({
        track = {},
        albumRadius = 0,
        isClosing = false,
        isPortraitLayout = false,
        isPlaying = false,
        position = 0,
        duration = 0,
        interactionProps = {},
        activeLyric = "",
        activeLyrics = [],
        activeLineIndex = 0,
        activeLyricsKaraoke = false,
        karaokeSource = null,
        lyricsSettingsRevision = 0,
        vinylSettings = {},
        onSeek,
        onStopPlayback,
        onTogglePlayback
    }) => {
        const animationsEnabled = vinylSettings.animations !== false;
        const centerRotationEnabled = vinylSettings.centerRotation !== false;
        const lyricsEnabled = vinylSettings.lyricsEnabled !== false;
        const albumScale = Math.min(1.4, Math.max(0.7, (Number(vinylSettings.albumSize) || 100) / 100));
        const recordScale = Math.min(1.4, Math.max(0.7, (Number(vinylSettings.recordSize) || 100) / 100));
        const safeScaleFactor = 1 / Math.max(1, albumScale, recordScale);
        const liveTrack = {
            uri: track.uri || `${track.title || "LP"}\u0000${track.artist || ""}`,
            coverUrl: track.coverUrl || "",
            title: track.title || "LP",
            artist: track.artist || "",
            album: track.album || track.title || "ivLyrics",
            accent: String(track.accent || "").trim()
        };
        const liveTrackRef = useRef(liveTrack);
        liveTrackRef.current = liveTrack;
        const [displayedTrack, setDisplayedTrack] = useState(() => liveTrack);
        const displayedTrackRef = useRef(liveTrack);
        const [incomingTrack, setIncomingTrack] = useState(null);
        const [trackTransition, setTrackTransition] = useState("idle");
        const requestedTrackKeyRef = useRef("");
        const trackTransitionRevisionRef = useRef(0);
        const trackPreloadTimerRef = useRef(null);
        const trackAlbumTimerRef = useRef(null);
        const trackRecordTimerRef = useRef(null);
        const trackRaiseTimerRef = useRef(null);
        const trackHandoffTimerRef = useRef(null);
        const lyricHandoffTimerRef = useRef(null);
        const lyricSnapshotsByTrackRef = useRef(new Map());
        const [outgoingLyric, setOutgoingLyric] = useState(null);

        const clearTrackTimers = useCallback(() => {
            if (trackPreloadTimerRef.current) {
                window.clearTimeout(trackPreloadTimerRef.current);
                trackPreloadTimerRef.current = null;
            }
            if (trackAlbumTimerRef.current) {
                window.clearTimeout(trackAlbumTimerRef.current);
                trackAlbumTimerRef.current = null;
            }
            if (trackRecordTimerRef.current) {
                window.clearTimeout(trackRecordTimerRef.current);
                trackRecordTimerRef.current = null;
            }
            if (trackRaiseTimerRef.current) {
                window.clearTimeout(trackRaiseTimerRef.current);
                trackRaiseTimerRef.current = null;
            }
            if (trackHandoffTimerRef.current) {
                window.clearTimeout(trackHandoffTimerRef.current);
                trackHandoffTimerRef.current = null;
            }
            if (lyricHandoffTimerRef.current) {
                window.clearTimeout(lyricHandoffTimerRef.current);
                lyricHandoffTimerRef.current = null;
            }
        }, []);

        useEffect(() => {
            const shownTrack = displayedTrackRef.current;
            if (areSameTrackVisuals(shownTrack, liveTrack)) {
                return;
            }

            const nextTrackKey = getTrackVisualKey(liveTrack);
            if (requestedTrackKeyRef.current === nextTrackKey) return;

            const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            const revision = trackTransitionRevisionRef.current + 1;
            trackTransitionRevisionRef.current = revision;
            requestedTrackKeyRef.current = nextTrackKey;
            clearTrackTimers();
            setOutgoingLyric(null);

            if (!shownTrack?.uri || !animationsEnabled || reducedMotion) {
                if (shownTrack?.uri && shownTrack.uri !== liveTrack.uri) {
                    lyricSnapshotsByTrackRef.current.delete(shownTrack.uri);
                }
                displayedTrackRef.current = liveTrack;
                setDisplayedTrack(liveTrack);
                setIncomingTrack(null);
                setTrackTransition("idle");
                return;
            }

            setIncomingTrack(liveTrack);
            setTrackTransition("preparing");

            let preloadImage = null;
            let flightStarted = false;
            const beginFlight = () => {
                if (flightStarted || trackTransitionRevisionRef.current !== revision) return;
                flightStarted = true;
                if (trackPreloadTimerRef.current) {
                    window.clearTimeout(trackPreloadTimerRef.current);
                    trackPreloadTimerRef.current = null;
                }
                setTrackTransition("album-arriving");
                trackAlbumTimerRef.current = window.setTimeout(() => {
                    if (trackTransitionRevisionRef.current !== revision) return;
                    trackAlbumTimerRef.current = null;
                    setTrackTransition("record-emerging");
                    trackRecordTimerRef.current = window.setTimeout(() => {
                        if (trackTransitionRevisionRef.current !== revision) return;
                        trackRecordTimerRef.current = null;
                        setTrackTransition("record-raised");
                        trackRaiseTimerRef.current = window.setTimeout(() => {
                            if (trackTransitionRevisionRef.current !== revision) return;
                            trackRaiseTimerRef.current = null;
                            const committedTrack = liveTrackRef.current?.uri === liveTrack.uri
                                ? liveTrackRef.current
                                : liveTrack;
                            const outgoingLyricSnapshot = lyricSnapshotsByTrackRef.current.get(shownTrack.uri) || null;
                            if (outgoingLyricSnapshot) {
                                setOutgoingLyric(outgoingLyricSnapshot);
                                lyricHandoffTimerRef.current = window.setTimeout(() => {
                                    if (trackTransitionRevisionRef.current !== revision) return;
                                    lyricHandoffTimerRef.current = null;
                                    setOutgoingLyric(null);
                                    lyricSnapshotsByTrackRef.current.delete(shownTrack.uri);
                                }, TRACK_LYRIC_CROSSFADE_MS);
                            }
                            displayedTrackRef.current = committedTrack;
                            setDisplayedTrack(committedTrack);
                            setTrackTransition("handoff");
                            trackHandoffTimerRef.current = window.setTimeout(() => {
                                if (trackTransitionRevisionRef.current !== revision) return;
                                trackHandoffTimerRef.current = null;
                                setIncomingTrack(null);
                                setTrackTransition("idle");
                            }, TRACK_HANDOFF_MS);
                        }, TRACK_RECORD_RAISE_MS);
                    }, TRACK_RECORD_EMERGE_MS);
                }, TRACK_ALBUM_ARRIVE_MS);
            };

            trackPreloadTimerRef.current = window.setTimeout(
                beginFlight,
                TRACK_COVER_PRELOAD_MAX_MS
            );

            if (liveTrack.coverUrl && typeof window.Image === "function") {
                preloadImage = new window.Image();
                preloadImage.decoding = "async";
                preloadImage.onload = beginFlight;
                preloadImage.onerror = beginFlight;
                preloadImage.src = liveTrack.coverUrl;
                if (preloadImage.complete) beginFlight();
            } else {
                beginFlight();
            }

            return () => {
                if (preloadImage) {
                    preloadImage.onload = null;
                    preloadImage.onerror = null;
                }
            };
        }, [
            liveTrack.uri,
            liveTrack.coverUrl,
            liveTrack.title,
            liveTrack.artist,
            liveTrack.album,
            animationsEnabled,
            clearTrackTimers
        ]);

        useEffect(() => () => {
            trackTransitionRevisionRef.current += 1;
            clearTrackTimers();
        }, [clearTrackTimers]);

        // Color extraction may finish after the track-change animation starts.
        // Update only the matching visual snapshot instead of recoloring both LPs.
        useEffect(() => {
            if (!liveTrack.accent) return;

            setIncomingTrack((current) => {
                if (!current || current.uri !== liveTrack.uri || current.accent === liveTrack.accent) {
                    return current;
                }
                return { ...current, accent: liveTrack.accent };
            });

            const shownTrack = displayedTrackRef.current;
            if (shownTrack?.uri === liveTrack.uri && shownTrack.accent !== liveTrack.accent) {
                const updatedTrack = { ...shownTrack, accent: liveTrack.accent };
                displayedTrackRef.current = updatedTrack;
                setDisplayedTrack(updatedTrack);
            }
        }, [liveTrack.uri, liveTrack.accent]);

        const activeVinylLyric = String(activeLyric || "")
            .replace(/\s+/g, " ")
            .trim();
        const ActiveLyricRenderer = window.ivLyricsActiveLyricLineRenderer;
        const canRenderRichActiveLyric = !!ActiveLyricRenderer
            && Array.isArray(activeLyrics)
            && activeLyrics.length > 0;
        const hasActiveLyric = canRenderRichActiveLyric || !!activeVinylLyric;
        const liveLyricSnapshot = hasActiveLyric
            ? {
                trackUri: liveTrack.uri,
                plainText: activeVinylLyric,
                lyrics: activeLyrics,
                activeLineIndex,
                isKara: activeLyricsKaraoke,
                karaokeSource,
                settingsRevision: lyricsSettingsRevision,
                position: Math.max(Number(position) || 0, 0)
            }
            : null;

        // Keep the latest usable line for each visual track. The main lyrics
        // state is intentionally cleared as soon as Spotify changes tracks, so
        // retaining this snapshot prevents the outgoing LP's lyric from being
        // unmounted halfway through its own replacement animation.
        if (liveLyricSnapshot) {
            lyricSnapshotsByTrackRef.current.set(liveTrack.uri, liveLyricSnapshot);
        }

        const transitionClass = trackTransition !== "idle" ? `is-track-${trackTransition}` : "";
        const displayedLyric = displayedTrack.uri === liveTrack.uri
            ? liveLyricSnapshot || lyricSnapshotsByTrackRef.current.get(displayedTrack.uri) || null
            : lyricSnapshotsByTrackRef.current.get(displayedTrack.uri) || null;
        const isDisplayedLyricFrozen = displayedTrack.uri !== liveTrack.uri;
        const hasVisibleLyric = lyricsEnabled && (!!displayedLyric || !!outgoingLyric);

        const renderLyricLayer = (snapshot, { outgoing = false, frozen = false } = {}) => {
            if (!snapshot) return null;
            const renderableLyrics = Array.isArray(snapshot.lyrics) && snapshot.lyrics.length > 0
                ? snapshot.lyrics
                : snapshot.plainText
                    ? [{ text: snapshot.plainText, startTime: 0 }]
                    : [];
            const canRenderSnapshotRichly = !!ActiveLyricRenderer && renderableLyrics.length > 0;
            const layerRole = outgoing ? "outgoing" : "current";

            return react.createElement("div", {
                key: `vinyl-active-lyric-${layerRole}-${snapshot.trackUri}-${snapshot.activeLineIndex}`,
                className: `fullscreen-vinyl-active-lyric is-${layerRole}`,
                dir: "auto",
                "aria-hidden": outgoing ? "true" : undefined
            }, canRenderSnapshotRichly
                ? react.createElement(ActiveLyricRenderer, {
                    lyrics: renderableLyrics,
                    activeLineIndex: renderableLyrics === snapshot.lyrics ? snapshot.activeLineIndex : 0,
                    isKara: renderableLyrics === snapshot.lyrics && snapshot.isKara,
                    karaokeSource: snapshot.karaokeSource,
                    settingsRevision: snapshot.settingsRevision,
                    positionOverride: frozen ? snapshot.position : null,
                    motionEnabled: animationsEnabled
                })
                : snapshot.plainText);
        };

        return react.createElement("div", {
            className: [
                "fullscreen-vinyl-overlay",
                isClosing ? "is-closing" : "is-open",
                isPortraitLayout ? "is-portrait-layout" : "is-landscape-layout",
                animationsEnabled ? "" : "is-motion-disabled",
                transitionClass,
                lyricsEnabled ? "has-lyric-slot" : "",
                hasVisibleLyric ? "has-active-lyric" : ""
            ].filter(Boolean).join(" "),
            role: "dialog",
            "aria-modal": "true",
            "aria-label": I18n.t("vinyl.mode") || "LP",
            style: {
                "--iv-vinyl-original-font-family": `'${String(vinylSettings.originalFontFamily || "Pretendard Variable").replace(/'/g, "\\'")}'`,
                "--iv-vinyl-original-font-size": `${Number(vinylSettings.originalFontSize) || 31}px`,
                "--iv-vinyl-original-font-weight": Number(vinylSettings.originalFontWeight) || 600,
                "--iv-vinyl-original-opacity": Math.min(1, Math.max(0, (Number(vinylSettings.originalOpacity) || 95) / 100)),
                "--iv-vinyl-original-letter-spacing": `${Number(vinylSettings.originalLetterSpacing) || 0}px`,
                "--iv-vinyl-phonetic-font-family": `'${String(vinylSettings.phoneticFontFamily || "Pretendard Variable").replace(/'/g, "\\'")}'`,
                "--iv-vinyl-phonetic-font-size": `${Number(vinylSettings.phoneticFontSize) || 11}px`,
                "--iv-vinyl-phonetic-font-weight": Number(vinylSettings.phoneticFontWeight) || 100,
                "--iv-vinyl-phonetic-opacity": Math.min(1, Math.max(0, (Number(vinylSettings.phoneticOpacity) || 70) / 100)),
                "--iv-vinyl-phonetic-spacing": `${Number.isFinite(Number(vinylSettings.phoneticSpacing)) ? Number(vinylSettings.phoneticSpacing) : -1}px`,
                "--iv-vinyl-phonetic-letter-spacing": `${Number(vinylSettings.phoneticLetterSpacing) || 0}px`,
                "--iv-vinyl-translation-font-family": `'${String(vinylSettings.translationFontFamily || "Pretendard Variable").replace(/'/g, "\\'")}'`,
                "--iv-vinyl-translation-font-size": `${Number(vinylSettings.translationFontSize) || 15}px`,
                "--iv-vinyl-translation-font-weight": Number(vinylSettings.translationFontWeight) || 300,
                "--iv-vinyl-translation-opacity": Math.min(1, Math.max(0, (Number(vinylSettings.translationOpacity) || 85) / 100)),
                "--iv-vinyl-translation-spacing": `${Number(vinylSettings.translationSpacing) || 0}px`,
                "--iv-vinyl-translation-letter-spacing": `${Number(vinylSettings.translationLetterSpacing) || 0}px`
            }
        },
            react.createElement(VinylPlayer, {
                className: [
                    "ivlyrics-vinyl-player--immersive",
                    isPortraitLayout ? "ivlyrics-vinyl-player--portrait-layout" : "",
                    centerRotationEnabled ? "is-center-rotation-enabled" : "",
                    transitionClass
                ].filter(Boolean).join(" "),
                style: {
                    "--iv-vinyl-album-radius": `${albumRadius}px`,
                    "--iv-vinyl-album-scale": albumScale,
                    "--iv-vinyl-record-scale": recordScale,
                    "--iv-vinyl-safe-scale-factor": safeScaleFactor,
                    "--iv-vinyl-original-font-family": `'${String(vinylSettings.originalFontFamily || "Pretendard Variable").replace(/'/g, "\\'")}'`,
                    "--iv-vinyl-original-font-size": `${Number(vinylSettings.originalFontSize) || 31}px`,
                    "--iv-vinyl-original-font-weight": Number(vinylSettings.originalFontWeight) || 600,
                    "--iv-vinyl-original-opacity": Math.min(1, Math.max(0, (Number(vinylSettings.originalOpacity) || 95) / 100)),
                    "--iv-vinyl-original-letter-spacing": `${Number(vinylSettings.originalLetterSpacing) || 0}px`,
                    "--iv-vinyl-phonetic-font-family": `'${String(vinylSettings.phoneticFontFamily || "Pretendard Variable").replace(/'/g, "\\'")}'`,
                    "--iv-vinyl-phonetic-font-size": `${Number(vinylSettings.phoneticFontSize) || 11}px`,
                    "--iv-vinyl-phonetic-font-weight": Number(vinylSettings.phoneticFontWeight) || 100,
                    "--iv-vinyl-phonetic-opacity": Math.min(1, Math.max(0, (Number(vinylSettings.phoneticOpacity) || 70) / 100)),
                    "--iv-vinyl-phonetic-spacing": `${Number.isFinite(Number(vinylSettings.phoneticSpacing)) ? Number(vinylSettings.phoneticSpacing) : -1}px`,
                    "--iv-vinyl-phonetic-letter-spacing": `${Number(vinylSettings.phoneticLetterSpacing) || 0}px`,
                    "--iv-vinyl-translation-font-family": `'${String(vinylSettings.translationFontFamily || "Pretendard Variable").replace(/'/g, "\\'")}'`,
                    "--iv-vinyl-translation-font-size": `${Number(vinylSettings.translationFontSize) || 15}px`,
                    "--iv-vinyl-translation-font-weight": Number(vinylSettings.translationFontWeight) || 300,
                    "--iv-vinyl-translation-opacity": Math.min(1, Math.max(0, (Number(vinylSettings.translationOpacity) || 85) / 100)),
                    "--iv-vinyl-translation-spacing": `${Number(vinylSettings.translationSpacing) || 0}px`,
                    "--iv-vinyl-translation-letter-spacing": `${Number(vinylSettings.translationLetterSpacing) || 0}px`,
                    ...(displayedTrack.accent ? { "--iv-vinyl-accent": displayedTrack.accent } : {})
                },
                coverUrl: displayedTrack.coverUrl,
                title: displayedTrack.title,
                artist: displayedTrack.artist,
                album: displayedTrack.album,
                incomingTrack,
                isPlaying,
                position,
                duration,
                animationsEnabled,
                interactionProps,
                onSeek,
                onStopPlayback,
                onTogglePlayback
            }),
            lyricsEnabled ? react.createElement("div", {
                className: `fullscreen-vinyl-lyric-stage${hasVisibleLyric ? "" : " is-empty"}`,
                "aria-live": "polite",
                "aria-atomic": "true",
                "aria-busy": trackTransition !== "idle" && !displayedLyric ? "true" : undefined
            },
                renderLyricLayer(displayedLyric, { frozen: isDisplayedLyricFrozen }),
                renderLyricLayer(outgoingLyric, { outgoing: true, frozen: true })
            ) : null
        );
    });

    return Mode;
})();

window.ivLyricsVinylPlayerMode = VinylPlayerMode;
