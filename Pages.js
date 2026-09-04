function normalizeContributorEntry(contributor, options = {}) {
	const anonymousLabel = typeof options.anonymousLabel === "string" && options.anonymousLabel.trim()
		? options.anonymousLabel.trim()
		: "Anonymous";
	const sequenceKey = Number.isInteger(options.sequenceKey) ? options.sequenceKey : 0;

	if (!contributor) {
		return null;
	}

	if (typeof contributor === "string") {
		const rawName = contributor.trim() || "Anonymous";
		const isAnonymous = rawName.toLowerCase() === "anonymous";
		const name = isAnonymous ? anonymousLabel : rawName;
		return {
			key: `name:${name.toLowerCase()}`,
			userHash: null,
			name,
			anonymous: isAnonymous,
			isPrivate: false
		};
	}

	if (typeof contributor !== "object") {
		return null;
	}

	const isPrivate = contributor.isPrivate === true || contributor.profilePublic === false;
	const identityRedacted = contributor.identityRedacted === true;
	const identityHidden = isPrivate || identityRedacted || contributor.anonymous === true;
	const rawName = String(contributor.name || contributor.nickname || contributor.displayName || "Anonymous").trim() || "Anonymous";
	const isAnonymous = identityHidden || rawName.toLowerCase() === "anonymous";
	const name = isAnonymous ? anonymousLabel : rawName;
	const userHash = !identityHidden && typeof contributor.userHash === "string" && contributor.userHash.trim()
		? contributor.userHash.trim()
		: null;

	return {
		key: isPrivate || identityRedacted
			? `${isPrivate ? "private" : "redacted"}:${sequenceKey}`
			: (userHash || `name:${name.toLowerCase()}`),
		userHash,
		name,
		anonymous: isAnonymous,
		isPrivate,
		identityRedacted
	};
}

function getDisplayContributors(contributors, limit = 3, anonymousLabel = "Anonymous") {
	if (!Array.isArray(contributors) || contributors.length === 0) {
		return [];
	}

	const result = [];
	const seen = new Set();
	let anonymousAdded = false;

	for (let contributorIndex = 0; contributorIndex < contributors.length; contributorIndex += 1) {
		const rawContributor = contributors[contributorIndex];
		const contributor = normalizeContributorEntry(rawContributor, {
			anonymousLabel,
			sequenceKey: contributorIndex
		});
		if (!contributor) {
			continue;
		}

		if (contributor.isPrivate || contributor.identityRedacted) {
			result.push(contributor);
		} else if (contributor.anonymous) {
			if (anonymousAdded) {
				continue;
			}
			anonymousAdded = true;
			result.push(contributor);
		} else {
			const key = contributor.userHash || contributor.key;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			result.push(contributor);
		}

		if (limit > 0 && result.length >= limit) {
			break;
		}
	}

	return result;
}

// CreditFooter implementing provider and contributor display
const CreditFooter = react.memo(({ provider, contributors }) => {
	const anonymousLabel = I18n.t("creatorProfile.anonymous") || "Anonymous";
	const visibleContributors = useMemo(
		() => getDisplayContributors(contributors, 3, anonymousLabel),
		[contributors, anonymousLabel]
	);

	if (!provider) {
		return null;
	}

	return react.createElement(
		"div",
		{
			className: "lyrics-credit-footer",
			style: {
				position: "absolute",
				bottom: "40px",
				left: "50%",
				transform: "translateX(-50%)",
				width: "max-content",
				maxWidth: "min(92%, 980px)",
				fontSize: "12px",
				color: "var(--lyrics-color-inactive)",
				opacity: 0.7,
				textAlign: "center",
				zIndex: 200,
				textShadow: "0 0 10px rgba(0,0,0,0.5)",
				pointerEvents: "auto"
			}
		},
		react.createElement(
			"div",
			{
				className: "lyrics-credit-footer-content",
				onPointerDown: (event) => event.stopPropagation(),
				onClick: (event) => event.stopPropagation(),
				onMouseDown: (event) => event.stopPropagation()
			},
			react.createElement(
				"span",
				{ className: "lyrics-credit-footer-group" },
				react.createElement(
					"span",
					{ className: "lyrics-credit-footer-label" },
					I18n.t("misc.lyricsProvider") || "Lyrics Provider"
				),
				react.createElement(
					"span",
					{ className: "lyrics-credit-footer-value" },
					provider
				)
			),
			visibleContributors.length > 0 && react.createElement(
				react.Fragment,
				null,
				react.createElement("span", { className: "lyrics-credit-footer-divider", "aria-hidden": "true" }, "•"),
				react.createElement(
					"span",
					{ className: "lyrics-credit-footer-group" },
					react.createElement(
						"span",
						{ className: "lyrics-credit-footer-label" },
						I18n.t("misc.syncContributor") || "Sync Contributor"
					),
					react.createElement(
						"span",
						{ className: "lyrics-credit-footer-value lyrics-credit-footer-contributors" },
						...visibleContributors.flatMap((contributor, index) => {
							const node = react.createElement(
								"span",
								{ key: contributor.key, className: "lyrics-credit-footer-name" },
								contributor.name
							);

							return index < visibleContributors.length - 1
								? [node, react.createElement("span", { key: `${contributor.key}:comma`, className: "lyrics-credit-footer-separator" }, ", ")]
								: [node];
						})
					)
				)
			)
		)
	);
});
window.CreditFooter = CreditFooter;

const IdlingIndicator = react.memo(({ isActive = false, delay = 0, durationMs = 0, settingsRevision = 0, lineRef = null }) => {
	const className = useMemo(() =>
		`lyrics-idling-indicator ${!isActive ? "lyrics-idling-indicator-hidden" : ""} lyrics-lyricsContainer-LyricsLine ${isActive ? "lyrics-lyricsContainer-LyricsLine-active" : ""} lyrics-lyricsContainer-LyricsLine-interlude`,
		[isActive]
	);

	const style = useMemo(() => ({
		"--position-index": 0,
		"--animation-index": 1,
		"--indicator-delay": `${delay}ms`,
	}), [delay]);

	if (durationMs <= INTERLUDE_MIN_DURATION_MS) {
		return null;
	}

	return react.createElement(
		"div",
		{ className, style, ref: lineRef },
		react.createElement(
			"p",
			{ className: "lyrics-lyricsContainer-LyricsLine-interludeMain" },
			react.createElement(InterludeIndicator, {
				durationMs,
				kind: "prelude",
				settingsRevision,
			})
		)
	);
});

const emptyLine = {
	startTime: 0,
	endTime: 0,
	text: [],
};

// Safe text renderer that handles objects, null, and undefined
const safeRenderText = (value) => {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "object") {
		// Handle React elements
		if (value && typeof value === 'object' && value.$$typeof) {
			return value; // React element, return as-is
		}
		// Handle line objects for karaoke
		if (value.text) return value.text;
		if (value.syllables) return value;
		if (value.vocals) return value;
		// Fallback: return empty string for other objects
		return "";
	}
	return String(value);
};

// Unified function to handle lyrics display mode logic
const getLyricsDisplayMode = (
	isKara,
	line,
	text,
	originalText,
	text2,
	{ preserveOriginalMain = false } = {}
) => {
	const displayMode = CONFIG.visual["translate:display-mode"];
	const showTranslatedBelow = displayMode === "below" || preserveOriginalMain;
	const replaceOriginal = displayMode === "replace";

	let mainText, subText, subText2;

	if (isKara) {
		// Pronunciation is carried in explicit fields by the presentation pipeline.
		// Do not infer it from `text`: provider lines commonly keep the original in
		// both `text` and `originalText`, and small normalization differences can
		// otherwise duplicate the original in the pronunciation row.
		const karaokePhoneticText = line?.phoneticText
			|| line?.phonetic;
		const karaokeTranslationText = line?.translationText || line?.translation || text2;
		mainText = line; // Keep as object for KaraokeLine component
		subText = karaokePhoneticText ? safeRenderText(karaokePhoneticText) : null;
		subText2 = safeRenderText(karaokeTranslationText);
	} else {
		// Default: show original text
		// originalText is the actual original lyric, while `text` and `text2`
		// are typed pronunciation and translation supplements respectively.

		if (showTranslatedBelow) {
			// Show original as main, translations below
			// Apply furigana to original text if enabled
			const processedOriginalText = safeRenderText(originalText);
			mainText = typeof processedOriginalText === 'string' ?
				Utils.applyFuriganaIfEnabled(processedOriginalText) : processedOriginalText;
			subText = text ? safeRenderText(text) : null;
			subText2 = text2 ? safeRenderText(text2) : null;
		} else if (replaceOriginal && (text || text2)) {
			// Preserve the legacy replacement order (pronunciation first when both
			// exist), but allow a translation-only result to replace the original.
			// A translation must never be placed in the pronunciation row merely
			// because its paired pronunciation is empty.
			mainText = safeRenderText(text || text2);
			subText = text && text2 ? safeRenderText(text2) : null;
			subText2 = null;
		} else {
			// Default: just show original with furigana if enabled
			const processedOriginalText = safeRenderText(originalText);
			mainText = typeof processedOriginalText === 'string' ?
				Utils.applyFuriganaIfEnabled(processedOriginalText) : processedOriginalText;
			subText = null;
			subText2 = null;
		}
	}

	return { mainText, subText, subText2 };
};

const getFirstTrimmedString = (...values) => {
	for (const value of values) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	return "";
};

const getEmbeddedAuxiliaryDisplayValues = (line) => {
	const phoneticText = getFirstTrimmedString(
		line?.phoneticText,
		line?.phonetic,
		line?.pronunciationText,
		line?.pronText
	);
	const translationText = getFirstTrimmedString(
		line?.translationText,
		line?.translation,
		line?.transText
	);
	const displayTranslationText = typeof line?.text2 === "string" && line.text2.trim()
		? line.text2.trim()
		: translationText;
	if (!phoneticText && !translationText) {
		const hasExplicitOriginalText = line?.originalText !== null && line?.originalText !== undefined;
		return {
			// A raw provider may supply both fields with the same original lyric.
			// Generic `text` is not a typed pronunciation value, so never promote it
			// into the pronunciation slot when no explicit supplement exists.
			text: null,
			originalText: hasExplicitOriginalText ? line?.originalText : line?.text,
			text2: line?.text2,
		};
	}

	return {
		// Keep the two semantic slots independent. Promoting a translation into
		// `text` makes the shared line renderer display it as pronunciation.
		text: phoneticText || null,
		originalText: line?.originalText || line?.text || "",
		text2: displayTranslationText || null,
	};
};

function renderLyricsUnavailable(message = I18n.t("messages.noLyrics"), messageClassName = "") {
	const messageClass = [
		"lyrics-lyricsContainer-LyricsUnavailableMessage",
		messageClassName,
	].filter(Boolean).join(" ");

	return react.createElement(
		"div",
		{ className: "lyrics-lyricsContainer-LyricsUnavailablePage" },
		react.createElement(
			"span",
			{ className: messageClass },
			message
		)
	);
}

const getCurrentTrackUri = () => Spicetify.Player?.data?.item?.uri || "";

const useTrackOffsetState = () => {
	const [trackOffset, setTrackOffset] = useState(0);
	const trackUri = getCurrentTrackUri();

	useEffect(() => {
		let cancelled = false;

		const loadOffset = async () => {
			const offset = (await Utils.getTrackSyncOffset(trackUri)) || 0;
			if (!cancelled) {
				setTrackOffset(offset);
			}
		};

		loadOffset();

		const handleOffsetChange = (event) => {
			if (event.detail.trackUri === trackUri) {
				setTrackOffset(event.detail.offset);
			}
		};

		window.addEventListener('ivLyrics:offset-changed', handleOffsetChange);
		return () => {
			cancelled = true;
			window.removeEventListener('ivLyrics:offset-changed', handleOffsetChange);
		};
	}, [trackUri]);

	return trackOffset;
};

const getGlobalSyncOffsetValue = () => {
	if (typeof Utils !== "undefined" && typeof Utils.getGlobalSyncOffset === "function") {
		return Utils.getGlobalSyncOffset();
	}
	const numericValue = Number(CONFIG?.visual?.["global-sync-offset"] ?? 0);
	return Number.isFinite(numericValue) ? numericValue : 0;
};

const useGlobalSyncOffsetState = () => {
	const [globalOffset, setGlobalOffset] = useState(getGlobalSyncOffsetValue);

	useEffect(() => {
		const handleGlobalOffsetChange = (event) => {
			const nextOffset = Number(event.detail?.offset ?? 0);
			setGlobalOffset(Number.isFinite(nextOffset) ? nextOffset : 0);
		};

		window.addEventListener("ivLyrics:global-offset-changed", handleGlobalOffsetChange);
		return () => window.removeEventListener("ivLyrics:global-offset-changed", handleGlobalOffsetChange);
	}, []);

	return globalOffset;
};

// Quantize playback position so identical values within a step don't trigger
// setState. Karaoke fill and active-line calculations consume `position`, so
// updates beyond the configured display rate only create redundant React work.
const DEFAULT_TRACK_POSITION_FPS = 60;
const MIN_TRACK_POSITION_FPS = 10;
const MAX_TRACK_POSITION_FPS = 240;

const getTrackPositionFPS = () => {
	const configuredFPS = Number(CONFIG?.visual?.["performance-frame-rate"]);
	if (!Number.isFinite(configuredFPS)) return DEFAULT_TRACK_POSITION_FPS;
	return Math.max(
		MIN_TRACK_POSITION_FPS,
		Math.min(MAX_TRACK_POSITION_FPS, Math.round(configuredFPS))
	);
};

const getPositionQuantizeMs = () => Math.max(1, Math.round(1000 / getTrackPositionFPS()));

const getCurrentLyricsPlaybackPosition = (trackOffset = 0, globalOffset = getGlobalSyncOffsetValue()) => {
	const newPos = window.Utils?.getSafePlayerProgress?.()
		?? (Spicetify.Player?.getProgress?.() || 0);
	const delay = CONFIG.visual.delay + trackOffset + globalOffset;
	const quantizeMs = getPositionQuantizeMs();
	return Math.round((newPos + delay) / quantizeMs) * quantizeMs;
};

const useLyricsPlaybackPosition = () => {
	const trackOffset = useTrackOffsetState();
	const globalOffset = useGlobalSyncOffsetState();
	const [position, setPosition] = useState(() => getCurrentLyricsPlaybackPosition(0, getGlobalSyncOffsetValue()));

	useEffect(() => {
		const next = getCurrentLyricsPlaybackPosition(trackOffset, globalOffset);
		setPosition((prev) => (prev === next ? prev : next));
	}, [trackOffset, globalOffset]);

	useTrackPosition(() => {
		const next = getCurrentLyricsPlaybackPosition(trackOffset, globalOffset);
		setPosition((prev) => (prev === next ? prev : next));
	});

	return position;
};

const useScrollActivity = (containerRef, deps = []) => {
	const [isScrolling, setIsScrolling] = useState(false);
	const scrollTimeout = useRef(null);
	const manualScrollIntentUntilRef = useRef(0);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let scrollbarPointerId = null;

		const extendManualScroll = () => {
			cancelSyncedLyricsScrollAnimation(container);
			setIsScrolling(true);
			if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
			scrollTimeout.current = setTimeout(() => {
				setIsScrolling(false);
			}, 3000);
		};
		const markManualScrollIntent = () => {
			manualScrollIntentUntilRef.current = Date.now() + 500;
		};
		const handleWheel = () => {
			markManualScrollIntent();
			extendManualScroll();
		};
		const handleScroll = () => {
			if (scrollbarPointerId !== null || Date.now() <= manualScrollIntentUntilRef.current) extendManualScroll();
		};
		const handlePointerDown = (event) => {
			if (event.target !== container) return;
			const rect = container.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const verticalGutterWidth = Math.max(0, container.offsetWidth - container.clientWidth);
			const horizontalGutterHeight = Math.max(0, container.offsetHeight - container.clientHeight);
			const isInVerticalScrollbar = verticalGutterWidth > 0 && (
				x < verticalGutterWidth || x >= container.clientWidth
			);
			const isInHorizontalScrollbar = horizontalGutterHeight > 0 && y >= container.clientHeight;
			if (isInVerticalScrollbar || isInHorizontalScrollbar) {
				scrollbarPointerId = event.pointerId;
				markManualScrollIntent();
			}
		};
		const handlePointerRelease = (event) => {
			if (scrollbarPointerId === null || event.pointerId !== scrollbarPointerId) return;
			scrollbarPointerId = null;
			manualScrollIntentUntilRef.current = 0;
			extendManualScroll();
		};
		const handleKeyDown = (event) => {
			if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"].includes(event.key)) return;
			if (event.defaultPrevented) return;
			const interactiveTarget = event.target?.closest?.(
				'button, a[href], input, select, textarea, [role="button"], [contenteditable="true"]'
			);
			if (interactiveTarget && interactiveTarget !== container) return;
			markManualScrollIntent();
			extendManualScroll();
		};

		container.addEventListener("wheel", handleWheel, { passive: true });
		container.addEventListener("touchmove", handleWheel, { passive: true });
		container.addEventListener("scroll", handleScroll, { passive: true });
		container.addEventListener("pointerdown", handlePointerDown, { passive: true });
		container.addEventListener("keydown", handleKeyDown);
		window.addEventListener("pointerup", handlePointerRelease, { passive: true });
		window.addEventListener("pointercancel", handlePointerRelease, { passive: true });

		return () => {
			container.removeEventListener("wheel", handleWheel);
			container.removeEventListener("touchmove", handleWheel);
			container.removeEventListener("scroll", handleScroll);
			container.removeEventListener("pointerdown", handlePointerDown);
			container.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("pointerup", handlePointerRelease);
			window.removeEventListener("pointercancel", handlePointerRelease);
			cancelSyncedLyricsScrollAnimation(container);
			if (scrollTimeout.current) {
				clearTimeout(scrollTimeout.current);
				scrollTimeout.current = null;
			}
		};
	}, deps);

	const handleContainerClick = useCallback(() => {
		if (!isScrolling) return;
		setIsScrolling(false);
		if (scrollTimeout.current) {
			clearTimeout(scrollTimeout.current);
			scrollTimeout.current = null;
		}
	}, [isScrolling]);

	return { isScrolling, handleContainerClick };
};

const normalizeDisplayedCulturalAnnotations = (value) => {
	const values = Array.isArray(value) ? value : value ? [value] : [];
	return values
		.map((annotation, index) => {
			if (typeof annotation === "string") {
				const note = annotation.trim();
				return note ? { marker: index + 1, expression: "", note } : null;
			}

			const marker = Number(annotation?.marker);
			const expression = String(annotation?.expression || "").trim();
			const note = String(annotation?.note || "").trim();
			if (!Number.isInteger(marker) || marker < 1 || !note) return null;
			return { marker, expression, note };
		})
		.filter(Boolean)
		.sort((a, b) => a.marker - b.marker);
};

const getRubySourceText = (value) => String(value || "")
	.replace(/<rt>[\s\S]*?<\/rt>/gi, "")
	.replace(/<rp>[\s\S]*?<\/rp>/gi, "")
	.replace(/<\/?ruby>/gi, "");

const getCulturalMarkerHTML = (marker) =>
	`<sup class="lyrics-cultural-marker">[${marker}]</sup>`;

const getCulturalMarkerRawOffset = (text, annotation) => {
	const expression = annotation?.expression;
	const sourceText = getRubySourceText(text);
	const expressionStart = expression ? sourceText.indexOf(expression) : -1;
	if (expressionStart < 0) return text.length;

	const sourceEnd = expressionStart + expression.length;
	let sourceOffset = 0;
	let rawOffset = text.length;
	let skipUntil = "";
	for (let index = 0; index < text.length; index += 1) {
		const remaining = text.slice(index).toLowerCase();
		if (skipUntil) {
			const closingIndex = remaining.indexOf(skipUntil);
			if (closingIndex < 0) break;
			index += closingIndex + skipUntil.length - 1;
			skipUntil = "";
			continue;
		}
		if (remaining.startsWith("<rt>")) {
			skipUntil = "</rt>";
			index += 3;
			continue;
		}
		if (remaining.startsWith("<rp>")) {
			skipUntil = "</rp>";
			index += 3;
			continue;
		}
		if (text[index] === "<") {
			const tagEnd = text.indexOf(">", index);
			if (tagEnd >= 0) {
				index = tagEnd;
				continue;
			}
		}

		sourceOffset += 1;
		if (sourceOffset === sourceEnd) {
			rawOffset = index + 1;
			break;
		}
	}

	const openRubyIndex = text.lastIndexOf("<ruby>", rawOffset);
	const closedRubyIndex = text.lastIndexOf("</ruby>", rawOffset);
	if (openRubyIndex > closedRubyIndex) {
		const rubyEnd = text.indexOf("</ruby>", rawOffset);
		if (rubyEnd >= 0) rawOffset = rubyEnd + "</ruby>".length;
	}
	return rawOffset;
};

const renderAnnotatedLyricHTML = (text, annotations = []) => {
	const normalizedText = String(text || "");
	if (!Array.isArray(annotations) || annotations.length === 0) {
		return Utils.rubyTextToHTML(normalizedText);
	}

	const markerInsertions = annotations
		.map((annotation) => ({
			annotation,
			rawOffset: getCulturalMarkerRawOffset(normalizedText, annotation),
			token: `\uE000iv-cultural-${annotation.marker}\uE001`,
		}))
		.sort((a, b) => b.rawOffset - a.rawOffset || b.annotation.marker - a.annotation.marker);
	let markedText = normalizedText;
	for (const insertion of markerInsertions) {
		markedText =
			`${markedText.slice(0, insertion.rawOffset)}` +
			`${insertion.token}${markedText.slice(insertion.rawOffset)}`;
	}

	let html = Utils.rubyTextToHTML(markedText);
	for (const insertion of markerInsertions) {
		html = html.replace(
			insertion.token,
			getCulturalMarkerHTML(insertion.annotation.marker)
		);
	}
	return html;
};

const renderLyricSubLine = (
	className,
	text,
	onContextMenu = null,
	culturalAnnotations = [],
	key = null
) => {
	if (!text) return null;
	const props = {
		className,
		style: { "--sub-lyric-color": CONFIG.visual["inactive-color"] },
	};
	if (key) props.key = key;
	if (onContextMenu) {
		props.onContextMenu = onContextMenu;
	}

	if (typeof text === "string" && text) {
		props.dangerouslySetInnerHTML = { __html: renderAnnotatedLyricHTML(text, culturalAnnotations) };
		return react.createElement("p", props);
	}

	return react.createElement("p", props, safeRenderText(text));
};

const renderLyricMainContent = ({
  isKara = false,
  karaokeRenderGranularity = null,
  mainText,
  line,
  position,
	isActive,
	isEffectFocused = isActive,
	isEffectLive = isActive || isEffectFocused,
	settingsRevision = 0,
	globalCharOffset = 0,
  activeGlobalCharIndex = -1,
  subText = null,
  subText2 = null,
  culturalAnnotations = [],
}) => {
	if (isKara) {
          return react.createElement(KaraokeLine, {
                  line,
			// Future rows are already pinned to 0 by the playback window. Completed
			// rows receive one stable position past their final glyph so the painted
			// progress remains visible without returning to the per-frame update path.
			position,
			isActive,
			isEffectFocused,
			isEffectLive,
			settingsRevision,
			globalCharOffset,
                  activeGlobalCharIndex,
                  phonetic: subText,
                  translation: subText2,
                  culturalAnnotations,
                  renderGranularity: karaokeRenderGranularity,
          });
  }

	if (typeof mainText === "string") {
		return null;
	}

	return safeRenderText(mainText);
};

const normalizeUnsyncedLyrics = (lyrics) => {
	if (!lyrics) {
		return [];
	}
	if (Array.isArray(lyrics)) {
		return lyrics.filter(item => item !== null && item !== undefined);
	}
	if (typeof lyrics === "string") {
		return lyrics.split("\n").map((text, index) => ({ text, index }));
	}
	return [];
};

const getUnsyncedLineRenderData = (lyrics, text, originalText, text2) => {
	const { mainText: lineText, subText, subText2: showMode2Translation } =
		getLyricsDisplayMode(false, null, text, originalText, text2);

	const belowOrigin = (typeof originalText === "object"
		? originalText?.props?.children?.[0]
		: originalText)?.replace(/\s+/g, "");
	const belowTxt = (typeof text === "object"
		? text?.props?.children?.[0]
		: text)?.replace(/\s+/g, "");

	const displayMode = CONFIG.visual["translate:display-mode"];
	const showTranslatedBelow = displayMode === "below";
	const replaceOriginal = displayMode === "replace";
	const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;
	const showMode2 = !!showMode2Translation && (showTranslatedBelow || replaceOriginal);

	return {
		lineText,
		subText,
		showMode2Translation,
		belowMode,
		showMode2,
	};
};

const buildLyricDisplayState = (isKara, line, text, originalText, text2) => {
	const { mainText, subText, subText2 } = getLyricsDisplayMode(
		isKara,
		line,
		text,
		originalText,
		text2,
		{
			// Karaoke already preserves its source glyphs as the main line. Keep
			// line-synced rendering consistent so a global "replace" preference
			// cannot promote a translation into the timed lyric body.
			preserveOriginalMain: !isKara,
		}
	);

	return {
		mainText,
		subText,
		subText2,
		hasSubLine: !!subText || !!subText2 || !!line?.culturalNote,
		originalText,
	};
};

const getCopyableText = (value) => {
	if (value === null || value === undefined) {
		return "";
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (typeof value === "object") {
		if (Array.isArray(value)) {
			return value.map(getCopyableText).join("");
		}

		if (value.props?.children !== undefined) {
			return getCopyableText(value.props.children);
		}

		if (typeof value.text === "string") {
			return value.text;
		}
	}

	return safeRenderText(value) || "";
};

const INTERLUDE_MIN_DURATION_MS = 500;
const INTERLUDE_NOTE_CHARACTER_REGEX = /[\u2669-\u266F\u{1D100}-\u{1D1FF}\u{1F3B5}-\u{1F3BC}]/u;
const INTERLUDE_MARKER_REGEX = /^[\s\u00A0\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFE0E\uFE0F\uFEFF\u2669-\u266F\u{1D100}-\u{1D1FF}\u{1F3B5}-\u{1F3BC}]+$/u;
const INSTRUMENTAL_BREAK_ICON_DESIGNS = new Set([
	"equalizer",
	"dotWave",
	"ripples",
	"orbit",
	"diamonds",
	"scan",
	"arcs",
	"signal",
	"pulseDot",
	"stack",
	"spark",
	"splitBars",
	"metronome",
	"vinyl",
	"beat",
	"reels",
	"triangle",
	"morph",
	"strings",
	"piano",
	"bloom",
	"speaker",
	"crossfade",
]);

const getInstrumentalBreakSettings = () => {
	const configuredIcon = CONFIG?.visual?.["instrumental-break-icon"] || "equalizer";
	const speed = Number(CONFIG?.visual?.["instrumental-break-animation-speed"] ?? 100);
	const safeSpeed = Number.isFinite(speed) ? Math.max(50, Math.min(200, speed)) : 100;
	const duration = Math.round(1100 * (100 / safeSpeed));
	const labelFontFamily = CONFIG?.visual?.["instrumental-break-label-font-family"] ||
		CONFIG?.visual?.["original-font-family"] ||
		"var(--lyrics-original-font-family, var(--font-family))";
	const getLabelNumber = (settingKey, fallback, min, max) => {
		const settingValue = CONFIG?.visual?.[settingKey];
		const fallbackValue = settingValue !== undefined && settingValue !== null && settingValue !== ""
			? settingValue
			: fallback;
		const numericValue = Number(fallbackValue);
		const safeValue = Number.isFinite(numericValue) ? numericValue : fallback;

		return Math.max(min, Math.min(max, safeValue));
	};

	return {
		icon: INSTRUMENTAL_BREAK_ICON_DESIGNS.has(configuredIcon) ? configuredIcon : "equalizer",
		showLabel: CONFIG?.visual?.["instrumental-break-show-label"] === true,
		style: {
			"--break-duration": `${duration}ms`,
			"--break-duration-fast": `${Math.round(duration * 0.72)}ms`,
			"--break-duration-slow": `${Math.round(duration * 1.65)}ms`,
			"--break-duration-xslow": `${Math.round(duration * 3.8)}ms`,
			"--break-label-font-family": labelFontFamily,
			"--break-label-font-size": `${getLabelNumber("instrumental-break-label-font-size", 20, 12, 128)}px`,
			"--break-label-font-weight": getLabelNumber("instrumental-break-label-font-weight", 200, 100, 900),
			"--break-label-opacity": getLabelNumber("instrumental-break-label-opacity", 65, 0, 100) / 100,
			"--break-label-outline-shadow": createOutsideTextOutlineShadow(
				getLabelNumber("instrumental-break-label-outline-width", 0, 0, 10),
				CONFIG?.visual?.["instrumental-break-label-outline-color"]
			),
		},
	};
};

const getInstrumentalBreakKind = (lineIndex, lineCount) => {
	if (lineIndex === 0) {
		return "prelude";
	}
	if (lineIndex === Math.max(0, lineCount - 1)) {
		return "postlude";
	}
	return "break";
};

const getInstrumentalBreakLabel = (kind) => {
	const key = kind === "prelude"
		? "settingsAdvanced.instrumentalBreak.labels.prelude"
		: kind === "postlude"
			? "settingsAdvanced.instrumentalBreak.labels.postlude"
			: "settingsAdvanced.instrumentalBreak.labels.break";

	return I18n.t(key) || (kind === "prelude" ? "Intro" : kind === "postlude" ? "Outro" : "Break");
};

const getPlainLyricText = (value) => {
	if (value === null || value === undefined) {
		return "";
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (Array.isArray(value)) {
		return value.map(getPlainLyricText).join("");
	}

	if (typeof value === "object") {
		if (value.props?.children !== undefined) {
			return getPlainLyricText(value.props.children);
		}

		if (typeof value.originalText === "string") {
			return value.originalText;
		}

		if (typeof value.text === "string") {
			return value.text;
		}

		if (typeof value.word === "string") {
			return value.word;
		}

		if (Array.isArray(value.syllables)) {
			return value.syllables.map(getPlainLyricText).join("");
		}

		if (Array.isArray(value.vocals?.lead?.syllables)) {
			const lead = value.vocals.lead.syllables.map(getPlainLyricText).join("");
			const background = Array.isArray(value.vocals.background)
				? value.vocals.background
					.flatMap((entry) => Array.isArray(entry?.syllables) ? entry.syllables : [])
					.map(getPlainLyricText)
					.join("")
				: "";
			return lead || background;
		}
	}

	return "";
};

const getInterludeCandidateText = (line) => {
	if (!line) {
		return "";
	}

	if (line.originalText !== undefined) {
		const originalText = getPlainLyricText(line.originalText);
		if (originalText.trim()) {
			return originalText;
		}
	}

	if (line.text !== undefined) {
		return getPlainLyricText(line.text);
	}

	return getPlainLyricText(line);
};

const isInterludeMarkerText = (text) => {
	if (window.ivLyricsInstrumentalBreaks?.isMarkerText?.(text)) {
		return true;
	}

	const normalized = String(text ?? "")
		.replace(/&nbsp;/gi, " ")
		.replace(/<[^>]+>/g, "")
		.trim();

	return !normalized || INTERLUDE_MARKER_REGEX.test(normalized);
};

const isMusicNoteInterludeMarkerText = (text) => {
	if (window.ivLyricsInstrumentalBreaks?.isMarkerText?.(text)) {
		return true;
	}

	const normalized = String(text ?? "")
		.replace(/&nbsp;/gi, " ")
		.replace(/<[^>]+>/g, "")
		.trim();

	return INTERLUDE_NOTE_CHARACTER_REGEX.test(normalized)
		&& INTERLUDE_MARKER_REGEX.test(normalized);
};

const toFiniteTime = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : null;
};

const getFiniteLyricsStyleNumber = (value, fallback) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

// Build a crisp outline from copies of the completed glyph silhouette. Unlike
// -webkit-text-stroke, these layers sit behind the fill and never consume the
// inside of thin glyphs. Multiple rings keep large configured widths solid.
const createOutsideTextOutlineShadow = (widthValue, colorValue = "#000000") => {
	const width = Math.max(0, Math.min(10, Number(widthValue) || 0));
	if (width <= 0) return "0 0 0 transparent";

	const color = String(colorValue || "#000000");
	const ringCount = Math.max(1, Math.min(4, Math.ceil(width * 2)));
	const directionCount = width <= 0.5 ? 8 : width <= 1 ? 12 : 16;
	const layers = [];
	const formatOffset = (value) => {
		const rounded = Math.abs(value) < 0.0005 ? 0 : value;
		return `${rounded.toFixed(3)}px`;
	};

	for (let ring = 1; ring <= ringCount; ring += 1) {
		const radius = width * (ring / ringCount);
		for (let direction = 0; direction < directionCount; direction += 1) {
			const angle = (Math.PI * 2 * direction) / directionCount;
			layers.push(
				`${formatOffset(Math.cos(angle) * radius)} ${formatOffset(Math.sin(angle) * radius)} 0 ${color}`
			);
		}
	}

	return layers.join(", ");
};

// A full-density outline becomes visually much heavier after the surrounding
// lyric line is blurred. Keep the configured geometry but render a sparse,
// low-opacity variant so its width still tracks the setting without flooding
// the glyph interior.
const getBlurredLineOutlineWidth = (widthValue) => Math.min(
	10,
	Math.max(0, Number(widthValue) || 0)
);

const createBlurredLineOutlineShadow = (widthValue, colorValue = "#000000") => {
	const width = getBlurredLineOutlineWidth(widthValue);
	if (width <= 0) return "0 0 0 transparent";

	const color = String(colorValue || "#000000");
	const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
	const mutedColor = hexMatch
		? `rgba(${parseInt(hexMatch[1], 16)}, ${parseInt(hexMatch[2], 16)}, ${parseInt(hexMatch[3], 16)}, 0.03)`
		: `color-mix(in srgb, ${color} 3%, transparent)`;
	const formatOffset = (value) => `${(Math.abs(value) < 0.0005 ? 0 : value).toFixed(3)}px`;

	return Array.from({ length: 16 }, (_, direction) => direction)
		.map((direction) => {
			const angle = (Math.PI * 2 * direction) / 16;
			return `${formatOffset(Math.cos(angle) * width)} ${formatOffset(Math.sin(angle) * width)} 0 ${mutedColor}`;
		})
		.join(", ");
};

// Keep the settings preview and the playback renderer on one typography contract.
// Container geometry and playback transforms stay local to each surface, but every
// glyph, ruby and auxiliary-line metric comes from this shared variable set.
const getLyricsTypographyStyleVariables = (visual = CONFIG?.visual || {}) => {
	const alignment = ["left", "center", "right"].includes(visual.alignment)
		? visual.alignment
		: "center";
	const culturalNoteMargins = alignment === "left"
		? { left: "0", right: "auto" }
		: alignment === "right"
			? { left: "auto", right: "0" }
			: { left: "auto", right: "auto" };
	const baseFontFamily = visual["font-family"] || "var(--font-family)";
	const shadowColor = visual["text-shadow-color"] || "#000000";
	const shadowOpacity = getFiniteLyricsStyleNumber(visual["text-shadow-opacity"], 50);
	const shadowBlur = getFiniteLyricsStyleNumber(visual["text-shadow-blur"], 2);
	const colorMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(shadowColor);
	const resolvedShadowColor = colorMatch
		? `rgba(${parseInt(colorMatch[1], 16)}, ${parseInt(colorMatch[2], 16)}, ${parseInt(colorMatch[3], 16)}, ${shadowOpacity / 100})`
		: shadowColor;
	const textShadow = visual["text-shadow-enabled"]
		? `0 0 ${shadowBlur}px ${resolvedShadowColor}`
		: "0 0 0 transparent";

	return {
		"--lyrics-align-text": alignment,
		"--lyrics-font-size": `${getFiniteLyricsStyleNumber(visual["font-size"], 32)}px`,
		"--lyrics-font-family": baseFontFamily,
		"--lyrics-original-font-family": visual["original-font-family"] || baseFontFamily,
		"--lyrics-original-font-size": `${getFiniteLyricsStyleNumber(visual["original-font-size"], 44)}px`,
		"--lyrics-original-font-weight": getFiniteLyricsStyleNumber(visual["original-font-weight"], 600),
		"--lyrics-original-opacity": getFiniteLyricsStyleNumber(visual["original-opacity"], 95) / 100,
		"--lyrics-original-letter-spacing": `${getFiniteLyricsStyleNumber(visual["original-letter-spacing"], 0)}px`,
		"--lyrics-original-outline-shadow": createOutsideTextOutlineShadow(
			visual["original-outline-width"],
			visual["original-outline-color"]
		),
		"--lyrics-original-outline-blurred-shadow": createBlurredLineOutlineShadow(
			visual["original-outline-width"],
			visual["original-outline-color"]
		),
		"--lyrics-original-outline-stroke-width": `${getFiniteLyricsStyleNumber(visual["original-outline-width"], 0) * 2}px`,
		"--lyrics-original-outline-blurred-stroke-width": `${getBlurredLineOutlineWidth(visual["original-outline-width"]) * 2}px`,
		"--lyrics-original-outline-blurred-stroke-color": `color-mix(in srgb, ${visual["original-outline-color"] || "#000000"} 8%, transparent)`,
		"--lyrics-original-outline-stroke-color": visual["original-outline-color"] || "#000000",
		"--lyrics-phonetic-font-family": visual["phonetic-font-family"] || baseFontFamily,
		"--lyrics-phonetic-font-size": `${getFiniteLyricsStyleNumber(visual["phonetic-font-size"], 16)}px`,
		"--lyrics-phonetic-font-weight": getFiniteLyricsStyleNumber(visual["phonetic-font-weight"], 100),
		"--lyrics-phonetic-opacity": getFiniteLyricsStyleNumber(visual["phonetic-opacity"], 70) / 100,
		"--lyrics-phonetic-spacing": `${getFiniteLyricsStyleNumber(visual["phonetic-spacing"], -1)}px`,
		"--lyrics-phonetic-letter-spacing": `${getFiniteLyricsStyleNumber(visual["phonetic-letter-spacing"], 0)}px`,
		"--lyrics-phonetic-outline-shadow": createOutsideTextOutlineShadow(
			visual["phonetic-outline-width"],
			visual["phonetic-outline-color"]
		),
		"--lyrics-phonetic-outline-blurred-shadow": createBlurredLineOutlineShadow(
			visual["phonetic-outline-width"],
			visual["phonetic-outline-color"]
		),
		"--lyrics-translation-font-family": visual["translation-font-family"] || baseFontFamily,
		"--lyrics-translation-font-size": `${getFiniteLyricsStyleNumber(visual["translation-font-size"], 22)}px`,
		"--lyrics-translation-font-weight": getFiniteLyricsStyleNumber(visual["translation-font-weight"], 300),
		"--lyrics-translation-opacity": getFiniteLyricsStyleNumber(visual["translation-opacity"], 85) / 100,
		"--lyrics-translation-spacing": `${getFiniteLyricsStyleNumber(visual["translation-spacing"], 0)}px`,
		"--lyrics-translation-letter-spacing": `${getFiniteLyricsStyleNumber(visual["translation-letter-spacing"], 0)}px`,
		"--lyrics-translation-outline-shadow": createOutsideTextOutlineShadow(
			visual["translation-outline-width"],
			visual["translation-outline-color"]
		),
		"--lyrics-translation-outline-blurred-shadow": createBlurredLineOutlineShadow(
			visual["translation-outline-width"],
			visual["translation-outline-color"]
		),
		"--lyrics-cultural-note-font-family": visual["cultural-annotations-font-family"] || visual["translation-font-family"] || baseFontFamily,
		"--lyrics-cultural-note-font-size": `${getFiniteLyricsStyleNumber(visual["cultural-annotations-font-size"], 14)}px`,
		"--lyrics-cultural-note-font-weight": getFiniteLyricsStyleNumber(visual["cultural-annotations-font-weight"], 300),
		"--lyrics-cultural-note-opacity": getFiniteLyricsStyleNumber(visual["cultural-annotations-opacity"], 60) / 100,
		"--lyrics-cultural-note-outline-shadow": createOutsideTextOutlineShadow(
			visual["cultural-annotations-outline-width"],
			visual["cultural-annotations-outline-color"]
		),
		"--lyrics-cultural-note-outline-blurred-shadow": createBlurredLineOutlineShadow(
			visual["cultural-annotations-outline-width"],
			visual["cultural-annotations-outline-color"]
		),
		"--lyrics-cultural-note-margin-left": culturalNoteMargins.left,
		"--lyrics-cultural-note-margin-right": culturalNoteMargins.right,
		"--lyrics-furigana-font-size": `${getFiniteLyricsStyleNumber(visual["furigana-font-size"], 14)}px`,
		"--lyrics-furigana-font-weight": getFiniteLyricsStyleNumber(visual["furigana-font-weight"], 300),
		"--lyrics-furigana-opacity": getFiniteLyricsStyleNumber(visual["furigana-opacity"], 80) / 100,
		"--lyrics-furigana-spacing": `${getFiniteLyricsStyleNumber(visual["furigana-spacing"], 2)}px`,
		"--lyrics-furigana-outline-shadow": createOutsideTextOutlineShadow(
			visual["furigana-outline-width"],
			visual["furigana-outline-color"]
		),
		"--lyrics-furigana-outline-blurred-shadow": createBlurredLineOutlineShadow(
			visual["furigana-outline-width"],
			visual["furigana-outline-color"]
		),
		"--lyrics-line-spacing": `${getFiniteLyricsStyleNumber(visual["line-spacing"], 8)}px`,
		"--fullscreen-title-outline-shadow": createOutsideTextOutlineShadow(
			visual["fullscreen-title-outline-width"],
			visual["fullscreen-title-outline-color"]
		),
		"--fullscreen-artist-outline-shadow": createOutsideTextOutlineShadow(
			visual["fullscreen-artist-outline-width"],
			visual["fullscreen-artist-outline-color"]
		),
		"--fullscreen-clock-outline-shadow": createOutsideTextOutlineShadow(
			visual["fullscreen-clock-outline-width"],
			visual["fullscreen-clock-outline-color"]
		),
		"--fullscreen-tmi-outline-shadow": createOutsideTextOutlineShadow(
			visual["fullscreen-tmi-outline-width"],
			visual["fullscreen-tmi-outline-color"]
		),
		"--lyrics-text-shadow": textShadow,
		"--lyrics-text-drop-shadow": visual["text-shadow-enabled"]
			? `drop-shadow(0 0 ${shadowBlur}px ${resolvedShadowColor})`
			: "none",
	};
};

const getCurrentTrackDurationMs = () => {
	if (typeof Spicetify === "undefined") {
		return null;
	}

	return toFiniteTime(
		Spicetify.Player?.data?.item?.duration?.milliseconds
		?? Spicetify.Player?.data?.item?.metadata?.duration
	);
};

const KARAOKE_TRAILING_INTERLUDE_DELAY_MS = 2500;
const isAutoInstrumentalBreakEnabled = () => {
	const value = CONFIG?.visual?.["instrumental-break-auto-detect"];
	if (typeof value === "boolean") return value;
	return !["false", "0", "off", "no"].includes(String(value ?? true).trim().toLowerCase());
};

const getTimedSyllablesFromLine = (line) => {
	const syllables = [];
	const appendSyllables = (items) => {
		if (Array.isArray(items)) {
			syllables.push(...items);
		}
	};

	appendSyllables(line?.syllables);
	appendSyllables(line?.vocals?.lead?.syllables);

	if (Array.isArray(line?.vocals?.background)) {
		line.vocals.background.forEach((entry) => appendSyllables(entry?.syllables));
	}

	return syllables;
};

const getKaraokeSpeakerPresentation = (speaker, speakerColor = "", speakerFallback = "") => {
	const presentation = window.ivLyricsSpeakerColors?.getPresentation?.(speaker, speakerColor, speakerFallback);
	if (presentation) return presentation;
	const normalized = String(speaker || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase();
	const normalizedFallback = String(speakerFallback || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase();
	const effectiveSpeaker = normalized === "CUSTOM"
		? (["MALE 1", "FEMALE 1", "DUET 1"].includes(normalizedFallback) ? normalizedFallback : "MALE 1")
		: ({
		"MALE CUSTOM": "MALE 1",
		"FEMALE CUSTOM": "FEMALE 1",
		"DUET CUSTOM": "DUET 1",
	}[normalized] || normalized);
	const normalizedColor = /^#[0-9a-f]{6}$/i.test(String(speakerColor || "").trim())
		? String(speakerColor).trim().toLowerCase()
		: "";
	const creatorColorEnabled = CONFIG?.visual?.["sync-data-custom-speaker-colors-enabled"] !== false;
	return {
		speakerClass: String(effectiveSpeaker || "").trim().toLowerCase().replace(/[_\s]+/g, "-").replace(/[^a-z0-9-]/g, ""),
		creatorColor: (normalized === "CUSTOM" || normalized.endsWith(" CUSTOM")) && creatorColorEnabled ? normalizedColor : "",
	};
};

const PAGES_IV_LYRICS_SPEAKER_CLASS_CONTRACT = Symbol.for("ivLyrics.speakerColors.classNameContract");

const normalizeKaraokeSpeakerClass = (speaker, speakerColor = "", speakerFallback = "") => {
	const helper = window.ivLyricsSpeakerColors;
	const contract = helper?.[PAGES_IV_LYRICS_SPEAKER_CLASS_CONTRACT];
	const hasReferenceInput = (speaker !== null && (typeof speaker === "object" || typeof speaker === "function"))
		|| (speakerColor !== null && (typeof speakerColor === "object" || typeof speakerColor === "function"))
		|| (speakerFallback !== null && (typeof speakerFallback === "object" || typeof speakerFallback === "function"));
	if (!hasReferenceInput
		&& contract?.getPresentation === helper?.getPresentation
		&& typeof contract?.getClassName === "function") {
		return contract.getClassName(speaker, speakerFallback);
	}
	return getKaraokeSpeakerPresentation(speaker, speakerColor, speakerFallback).speakerClass;
};

const getKaraokeSpeakerStyle = (speaker, speakerColor = "", speakerFallback = "") => {
	const creatorColor = getKaraokeSpeakerPresentation(speaker, speakerColor, speakerFallback).creatorColor;
	return creatorColor ? {
		"--lyrics-color-active": creatorColor,
		"--lyrics-color-inactive": `color-mix(in srgb, ${creatorColor} 50%, transparent)`,
	} : {};
};

const KARAOKE_TEXT_EFFECT_KIND_CLASSES = new Set([
	"effect",
	"adlib",
	"pulse",
	"wave",
	"sparkle",
	"echo",
	"whisper",
	"bounce",
	"sway",
	"glow",
	"glitch",
	"flicker",
	"float",
	"blur",
	"pop",
]);

const areKaraokeTextEffectsEnabled = () => (
	CONFIG?.visual?.["karaoke-text-effects"] !== false && !prefersReducedLyricsMotion()
);

const getKaraokeKindClassParts = (kind) => {
	const kindClass = String(kind || "").trim().toLowerCase();
	if (!kindClass || (kindClass !== "vocal" && !KARAOKE_TEXT_EFFECT_KIND_CLASSES.has(kindClass))) {
		return [];
	}

	const classes = [kindClass];
	if (KARAOKE_TEXT_EFFECT_KIND_CLASSES.has(kindClass) && !areKaraokeTextEffectsEnabled()) {
		classes.push("text-effects-disabled");
	}
	return classes;
};

const getKaraokeLineMetaClass = (line) => {
	const classes = [];
	const speakerClass = normalizeKaraokeSpeakerClass(line?.speaker, line?.['speaker-color'], line?.['speaker-fallback']);
	if (speakerClass) classes.push(`speaker-${speakerClass}`);
	const hasInlineEffects = Array.isArray(line?.syllables)
		&& line.syllables.some(syllable => (
			syllable?.inlineStyle === true
			&& KARAOKE_TEXT_EFFECT_KIND_CLASSES.has(String(syllable?.styleKind || "").trim().toLowerCase())
		));
	if (line?.kind && !hasInlineEffects) classes.push(...getKaraokeKindClassParts(line.kind));
	return classes.join(" ");
};

const splitRenderableKaraokeSyllables = (syllables) => {
	if (!Array.isArray(syllables) || syllables.length === 0) {
		return [];
	}

	return syllables.flatMap((syllable) => {
		const text = syllable?.text || "";
		if (!text || !/\s/.test(text) || text.trim() === "") {
			return syllable;
		}

		return text
			.split(/(\s+)/)
			.filter((part) => part !== "")
			.map((part) => ({
				...syllable,
				text: part,
			}));
	});
};

const KARAOKE_COMBINING_MARK_REGEX = /\p{M}/u;
const KARAOKE_VARIATION_OR_MODIFIER_REGEX = /[\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0100}-\u{E01EF}]/u;

const intlSegmenterCache = new Map();
const getCachedIntlSegmenter = (locale) => {
	const key = locale || "default";
	let segmenter = intlSegmenterCache.get(key);
	if (!segmenter) {
		const requestedLocale = locale && locale !== "auto" ? locale : undefined;
		segmenter = new Intl.Segmenter(requestedLocale, { granularity: "grapheme" });
		intlSegmenterCache.set(key, segmenter);
	}
	return segmenter;
};

const splitKaraokeGraphemes = (value, locale = "auto") => {
	const text = String(value || "");
	if (!text) return [];

	if (window.LyricsWordSegmenter?.segmentGraphemes) {
		try {
			return window.LyricsWordSegmenter.segmentGraphemes(text, locale);
		} catch (error) {
			console.warn("[ivLyrics] Shared grapheme segmenter failed; using local fallback", error);
		}
	}

	if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
		try {
			const segmenter = getCachedIntlSegmenter(locale);
			return Array.from(segmenter.segment(text), (segment) => segment.segment);
		} catch (error) {
			console.warn("[ivLyrics] Intl grapheme segmentation failed; using Unicode fallback", error);
		}
	}

	const clusters = [];
	for (const codePoint of Array.from(text)) {
		const previous = clusters[clusters.length - 1] || "";
		const joinsPrevious = clusters.length > 0 && (
			KARAOKE_COMBINING_MARK_REGEX.test(codePoint)
			|| KARAOKE_VARIATION_OR_MODIFIER_REGEX.test(codePoint)
			|| codePoint === "\u200D"
			|| previous.endsWith("\u200D")
		);
		if (joinsPrevious) {
			clusters[clusters.length - 1] += codePoint;
		} else {
			clusters.push(codePoint);
		}
	}
	return clusters;
};

const coalesceKaraokeTimedGraphemes = (timedChars, locale = "auto") => {
	if (!Array.isArray(timedChars) || timedChars.length === 0) return [];

	const text = timedChars.map((charInfo) => String(charInfo?.char || "")).join("");
	const graphemes = splitKaraokeGraphemes(text, locale);
	if (graphemes.length === timedChars.length
		&& graphemes.every((grapheme, index) => grapheme === String(timedChars[index]?.char || ""))) {
		return timedChars;
	}

	const sourceRanges = [];
	let sourceOffset = 0;
	timedChars.forEach((charInfo) => {
		const char = String(charInfo?.char || "");
		sourceRanges.push({
			charInfo,
			start: sourceOffset,
			end: sourceOffset + char.length,
		});
		sourceOffset += char.length;
	});

	let graphemeOffset = 0;
	let sourceIndex = 0;
	return graphemes.map((grapheme) => {
		const graphemeStart = graphemeOffset;
		const graphemeEnd = graphemeStart + grapheme.length;
		graphemeOffset = graphemeEnd;

		while (sourceIndex < sourceRanges.length && sourceRanges[sourceIndex].end <= graphemeStart) {
			sourceIndex += 1;
		}
		const contributors = [];
		for (let index = sourceIndex; index < sourceRanges.length; index += 1) {
			const range = sourceRanges[index];
			if (range.start >= graphemeEnd) break;
			if (range.end > graphemeStart) contributors.push(range.charInfo);
		}

		const first = contributors[0] || {};
		const startTimes = contributors
			.map((charInfo) => charInfo?.startTime)
			.filter(Number.isFinite);
		const endTimes = contributors
			.map((charInfo) => charInfo?.endTime)
			.filter(Number.isFinite);
		return {
			...first,
			char: grapheme,
			startTime: startTimes.length > 0 ? Math.min(...startTimes) : (first.startTime || 0),
			endTime: endTimes.length > 0 ? Math.max(...endTimes) : (first.endTime || first.startTime || 0),
		};
	});
};

const getKaraokeSyllableCharCount = (syllables) => (
	Array.isArray(syllables)
		? splitKaraokeGraphemes(syllables.map((syllable) => syllable?.text || "").join("")).length
		: 0
);

const getKaraokeVocalRows = (line) => {
	if (!Array.isArray(line?.vocals?.lead?.syllables) || line.vocals.lead.syllables.length === 0) {
		return null;
	}

	const rows = [{
		key: line.vocals.lead.id || "lead",
		role: line.vocals.lead.role || "lead",
		speaker: line.vocals.lead.speaker || "",
		speakerColor: line.vocals.lead['speaker-color'] || "",
		speakerFallback: line.vocals.lead['speaker-fallback'] || "",
		kind: line.vocals.lead.kind || "vocal",
		speakerClass: normalizeKaraokeSpeakerClass(line.vocals.lead.speaker, line.vocals.lead['speaker-color'], line.vocals.lead['speaker-fallback']),
		speakerStyle: getKaraokeSpeakerStyle(line.vocals.lead.speaker, line.vocals.lead['speaker-color'], line.vocals.lead['speaker-fallback']),
		phonetic: line.vocals.lead.phonetic || "",
		translation: line.vocals.lead.translation || "",
		text: line.vocals.lead.text || "",
		syllables: splitRenderableKaraokeSyllables(line.vocals.lead.syllables),
	}];

	if (Array.isArray(line.vocals.background)) {
		line.vocals.background.forEach((part, index) => {
			if (!Array.isArray(part?.syllables) || part.syllables.length === 0) {
				return;
			}

			rows.push({
				key: part.id || `background-${index}`,
				role: part.role || "background",
				speaker: part.speaker || "",
				speakerColor: part['speaker-color'] || "",
				speakerFallback: part['speaker-fallback'] || "",
				kind: part.kind || "vocal",
				speakerClass: normalizeKaraokeSpeakerClass(part.speaker, part['speaker-color'], part['speaker-fallback']),
				speakerStyle: getKaraokeSpeakerStyle(part.speaker, part['speaker-color'], part['speaker-fallback']),
				phonetic: part.phonetic || "",
				translation: part.translation || "",
				text: part.text || "",
				syllables: splitRenderableKaraokeSyllables(part.syllables),
			});
		});
	}

	return rows.length > 1 ? rows : null;
};

const hasKaraokeVocalRows = (line) => Array.isArray(getKaraokeVocalRows(line));

const splitLineByParallelShape = (text, rowCount) => {
	const value = typeof text === "string" ? text.trim() : "";
	if (!value || rowCount <= 1) {
		return [];
	}

	const separatorParts = value.split(/\s*[\/|／｜]\s*/).filter(Boolean);
	if (separatorParts.length === rowCount) {
		return separatorParts;
	}

	const chars = Array.from(value);
	const lead = [];
	const background = [];
	let depth = 0;
	let firstLeadIndex = Number.POSITIVE_INFINITY;
	let firstBackgroundIndex = Number.POSITIVE_INFINITY;

	chars.forEach((char, index) => {
		if (char === "(" || char === "（") {
			depth++;
			return;
		}
		if (char === ")" || char === "）") {
			depth = Math.max(0, depth - 1);
			return;
		}
		if (depth > 0) {
			firstBackgroundIndex = Math.min(firstBackgroundIndex, index);
			background.push(char);
		} else {
			if (!/\s/u.test(char)) {
				firstLeadIndex = Math.min(firstLeadIndex, index);
			}
			lead.push(char);
		}
	});

	if (rowCount === 2 && background.join("").trim()) {
		const leadText = lead.join("").trim();
		const backgroundText = background.join("").trim();
		return firstBackgroundIndex < firstLeadIndex
			? [backgroundText, leadText]
			: [leadText, backgroundText];
	}

	return [];
};

const isKaraokeParenthesisOpen = (char) => char === "(" || char === "\uFF08";
const isKaraokeParenthesisClose = (char) => char === ")" || char === "\uFF09";

const isStandaloneParentheticalText = (text) => {
	const chars = Array.from(String(text || "").trim());
	if (chars.length < 2 || !isKaraokeParenthesisOpen(chars[0])) return false;

	let depth = 0;
	for (let index = 0; index < chars.length; index++) {
		const char = chars[index];
		if (isKaraokeParenthesisOpen(char)) {
			depth++;
			continue;
		}
		if (isKaraokeParenthesisClose(char)) {
			depth--;
			if (depth === 0 && index !== chars.length - 1) return false;
			if (depth < 0) return false;
		}
	}
	return depth === 0 && isKaraokeParenthesisClose(chars[chars.length - 1]);
};

const stripStandaloneParentheticalText = (text) => {
	let value = String(text || "").trim();
	while (isStandaloneParentheticalText(value)) {
		value = Array.from(value).slice(1, -1).join("").trim();
	}
	return value;
};

const splitLineByVocalRowShape = (text, rows) => {
	const value = typeof text === "string" ? text.trim() : "";
	const rowCount = Array.isArray(rows) ? rows.length : 0;
	if (!value || rowCount <= 1) return [];

	const simpleParts = splitLineByParallelShape(value, rowCount);
	if (simpleParts.length === rowCount) return simpleParts;

	const segments = [];
	let buffer = [];
	let depth = 0;
	let parenthetical = false;
	const flush = () => {
		const segmentText = buffer.join("").trim();
		if (segmentText) {
			segments.push({
				parenthetical,
				text: parenthetical ? stripStandaloneParentheticalText(segmentText) : segmentText
			});
		}
		buffer = [];
		parenthetical = depth > 0;
	};

	Array.from(value).forEach((char) => {
		if (isKaraokeParenthesisOpen(char)) {
			if (depth === 0) {
				flush();
				parenthetical = true;
			}
			depth++;
			buffer.push(char);
			return;
		}

		if (isKaraokeParenthesisClose(char)) {
			buffer.push(char);
			if (depth > 0) depth--;
			if (depth === 0 && parenthetical) flush();
			return;
		}

		buffer.push(char);
	});
	flush();

	if (segments.length === rowCount) {
		return segments.map(segment => segment.text);
	}

	const remaining = [...segments];
	const rowShapeParts = rows.map((row) => {
		const rowIsParenthetical = isStandaloneParentheticalText(row?.text);
		const segmentIndex = remaining.findIndex(segment => segment.parenthetical === rowIsParenthetical);
		if (segmentIndex < 0) return "";
		const [segment] = remaining.splice(segmentIndex, 1);
		return segment.text;
	});

	return rowShapeParts.every(Boolean) && remaining.length === 0 ? rowShapeParts : [];
};

const getLastSyllableEndTime = (line) => {
	let lastEndTime = null;
	const lineEndTime = toFiniteTime(line?.endTime);

	getTimedSyllablesFromLine(line).forEach((syllable) => {
		const syllableStart = toFiniteTime(syllable?.startTime);
		const syllableEnd = toFiniteTime(syllable?.endTime)
			?? (lineEndTime !== null && syllableStart !== null && lineEndTime >= syllableStart ? lineEndTime : null)
			?? syllableStart;

		if (syllableEnd !== null) {
			lastEndTime = lastEndTime === null ? syllableEnd : Math.max(lastEndTime, syllableEnd);
		}
	});

	return lastEndTime;
};

const getKaraokeLineFillEndTime = (line) => {
	const timedChars = applyKaraokeWhitespaceCompensation(buildKaraokeTimedChars(line));
	const timedCharEndTime = timedChars.reduce((maxEndTime, charInfo) => {
		const endTime = toFiniteTime(charInfo?.endTime);
		return endTime === null ? maxEndTime : Math.max(maxEndTime, endTime);
	}, -Infinity);

	if (Number.isFinite(timedCharEndTime)) {
		return timedCharEndTime;
	}

	const lineBounds = getKaraokeLineBounds(line);
	return toFiniteTime(lineBounds.endTime) ?? getLastSyllableEndTime(line);
};

const getInterludeInfo = (line, nextLine = null, lineIndex = -1, lineCount = 0) => {
	const startTime = toFiniteTime(line?.startTime);
	const markerText = getInterludeCandidateText(line);
	if (startTime === null || !isInterludeMarkerText(markerText)) {
		return { isInterlude: false, durationMs: 0 };
	}

	const directEndTime = toFiniteTime(line?.endTime);
	const nextStartTime = toFiniteTime(nextLine?.startTime);
	const trackEndTime = lineIndex === Math.max(0, lineCount - 1) ? getCurrentTrackDurationMs() : null;
	const endTime = nextStartTime !== null && nextStartTime > startTime
		? nextStartTime
		: (directEndTime !== null && directEndTime > startTime
			? directEndTime
			: (trackEndTime !== null && trackEndTime > startTime ? trackEndTime : null));
	const durationMs = endTime !== null ? endTime - startTime : 0;
	const minimumDurationMs = isMusicNoteInterludeMarkerText(markerText)
		? 0
		: INTERLUDE_MIN_DURATION_MS;

	return {
		isInterlude: durationMs > minimumDurationMs,
		durationMs,
		kind: getInstrumentalBreakKind(lineIndex, lineCount),
	};
};

const getTrailingKaraokeInterludeInfo = (line, nextLine = null, lineIndex = -1, lineCount = 0) => {
	if (!isAutoInstrumentalBreakEnabled()) {
		return { isInterlude: false, durationMs: 0, source: "karaoke-trailing-gap" };
	}

	const nextStartTime = toFiniteTime(nextLine?.startTime);
	if (
		nextStartTime !== null
		&& isInterludeMarkerText(getInterludeCandidateText(nextLine))
	) {
		return { isInterlude: false, durationMs: 0, source: "karaoke-trailing-gap" };
	}

	const fillEndTime = getKaraokeLineFillEndTime(line);
	const startTime = fillEndTime !== null ? fillEndTime + KARAOKE_TRAILING_INTERLUDE_DELAY_MS : null;
	const trackEndTime = lineIndex === Math.max(0, lineCount - 1) ? getCurrentTrackDurationMs() : null;
	const endTime = nextStartTime ?? trackEndTime;
	const durationMs = startTime !== null && endTime !== null && endTime > startTime
		? endTime - startTime
		: 0;

	return {
		isInterlude: durationMs > INTERLUDE_MIN_DURATION_MS,
		durationMs,
		startTime,
		endTime,
		kind: lineIndex >= Math.max(0, lineCount - 1) ? "postlude" : "break",
		source: "karaoke-trailing-gap",
	};
};

const isTrailingKaraokeInterludePositionActive = (interludeInfo, position) => {
	if (position < interludeInfo.startTime) {
		return false;
	}

	// A postlude has no following lyric line to take over. Spotify can report a
	// position equal to or slightly beyond the track duration while handing off
	// to the next song, so keep an already-reached outro marker visible until the
	// new track resets the playback position.
	return interludeInfo.kind === "postlude" || position < interludeInfo.endTime;
};

const createActiveTrailingKaraokeInterludeLine = ({
	line,
	nextLine = null,
	lineIndex = -1,
	lineCount = 0,
	position = 0,
	isActiveLine = false,
	isKara = false,
	activationAdvanceMs = 0,
}) => {
	if (!isKara || !isActiveLine || line?.interludeInfo?.isInterlude) {
		return null;
	}

	const interludeInfo = getTrailingKaraokeInterludeInfo(line, nextLine, lineIndex, lineCount);
	const previewStartTime = interludeInfo.startTime !== null
		? interludeInfo.startTime - Math.max(0, activationAdvanceMs)
		: null;
	if (
		!interludeInfo.isInterlude ||
		interludeInfo.startTime === null ||
		interludeInfo.endTime === null ||
		previewStartTime === null ||
		position < previewStartTime ||
		(interludeInfo.kind !== "postlude" && position >= interludeInfo.endTime)
	) {
		return null;
	}

	return {
		startTime: interludeInfo.startTime,
		endTime: interludeInfo.endTime,
		text: "",
		originalText: "",
		text2: "",
		interludeInfo,
		isVirtualTrailingInterlude: true,
		isPrecentered: !isTrailingKaraokeInterludePositionActive(interludeInfo, position),
	};
};

const createBreakIconChildren = (icon) => {
	const span = (key, props = {}) => react.createElement("span", { key, ...props });

	switch (icon) {
		case "dotWave":
			return [0, 1, 2, 3, 4].map((index) => span(index));
		case "ripples":
		case "orbit":
		case "vinyl":
			return span("main");
		case "diamonds":
		case "stack":
			return [0, 1, 2].map((index) => span(index));
		case "signal":
			return react.createElement(
				"svg",
				{ viewBox: "0 0 112 32", "aria-hidden": "true" },
				react.createElement("path", {
					d: "M2 18 H20 L26 9 L34 25 L43 14 L50 18 H68 L74 9 L82 25 L91 14 L98 18 H110",
				})
			);
		case "spark":
			return [0, 1, 2, 3, 4, 5, 6, 7].map((index) => span(index, { style: { "--i": index } }));
		case "splitBars":
		case "strings":
			return [0, 1, 2, 3].map((index) => span(index));
		case "reels":
			return [0, 1].map((index) => span(index));
		case "piano":
			return [0, 1, 2, 3, 4].map((index) => span(index));
		case "bloom":
			return [0, 1, 2, 3].map((index) => span(index));
		case "scan":
		case "arcs":
		case "pulseDot":
		case "metronome":
		case "beat":
		case "triangle":
		case "morph":
		case "speaker":
		case "crossfade":
			return null;
		case "equalizer":
		default:
			return [0, 1, 2, 3].map((index) => span(index));
	}
};

const InterludeIndicator = react.memo(({ durationMs = 0, kind = "break", settingsRevision = 0 }) => {
	const settings = getInstrumentalBreakSettings();
	const label = getInstrumentalBreakLabel(kind);

	return react.createElement(
		"span",
		{
			className: `lyrics-break-indicator lyrics-break-kind-${kind}`,
			"aria-label": settings.showLabel ? label : undefined,
			"aria-hidden": settings.showLabel ? undefined : "true",
			style: settings.style,
		},
		react.createElement(
			"span",
			{ className: `lyrics-break-icon lyrics-break-icon-${settings.icon}` },
			createBreakIconChildren(settings.icon)
		),
		settings.showLabel && react.createElement("span", { className: "lyrics-break-label" }, label)
	);
});

const copyLyricText = (text, successMessageKey, failureMessageKey) => {
	const copyText = getCopyableText(text);
	if (!copyText) {
		Toast.error(I18n.t(failureMessageKey));
		return;
	}

	Spicetify.Platform.ClipboardAPI.copy(copyText)
		.then(() => Toast.success(I18n.t(successMessageKey)))
		.catch(() => Toast.error(I18n.t(failureMessageKey)));
};

const createCopyHandler = (text, successMessageKey, failureMessageKey) => (event) => {
	event.preventDefault();
	copyLyricText(text, successMessageKey, failureMessageKey);
};

let cachedAnchorRatio = 0.5;
let cachedAnchorRatioContainer = null;
let cachedAnchorRatioTime = 0;

const getLyricsAnchorRatio = (container) => {
  if (!container) return 0.5;
  const now = Date.now();
  if (container === cachedAnchorRatioContainer && now - cachedAnchorRatioTime < 3000) {
    return cachedAnchorRatio;
  }
  const raw = (container.style?.getPropertyValue?.("--ivfs-lyrics-anchor-ratio") || "").trim();
  if (raw) {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      cachedAnchorRatio = Math.min(0.95, Math.max(0.05, parsed));
      cachedAnchorRatioContainer = container;
      cachedAnchorRatioTime = now;
      return cachedAnchorRatio;
    }
  }
  cachedAnchorRatio = 0.5;
  cachedAnchorRatioContainer = container;
  cachedAnchorRatioTime = now;
  return 0.5;
};

const getElementOffsetTopWithin = (element, container) => {
  if (!element || !container) {
          return 0;
  }

  let top = 0;
  let node = element;
  while (node && node !== container) {
          top += Number(node.offsetTop) || 0;
          node = node.offsetParent;
  }

  if (node === container) {
          return top;
  }

  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return (elementRect.top - containerRect.top) + (container.scrollTop || 0);
};

const LYRICS_CENTERING_DURATION_MS = 300;
const LYRICS_CENTERING_LEAD_MS = LYRICS_CENTERING_DURATION_MS;
const LYRICS_CENTERING_STAGGER_MS = 28;
const LYRICS_CENTERING_MAX_STAGGER_MS = 112;
const LYRICS_CENTERING_SETTLE_RESERVE_MS = 24;
const LYRICS_CENTERING_MIN_TOTAL_MS = 80;
const LYRICS_CENTERING_BEZIER = [0.42, 0, 0.58, 1];
const LYRICS_CENTERING_EASING_CSS = "cubic-bezier(0.42, 0, 0.58, 1)";
const KARAOKE_RELEASE_WINDOW_MS = 820;
const KARAOKE_COMPLETION_POSITION_OFFSET_MS = 900;
const syncedLyricsScrollAnimations = new WeakMap();

const getTransformTranslateY = (transform) => {
	if (!transform || transform === "none") return 0;

	try {
		if (typeof DOMMatrixReadOnly === "function") {
			return new DOMMatrixReadOnly(transform).m42;
		}
	} catch (_) {
		// Fall through to the matrix parser below.
	}

	const matrixMatch = String(transform).match(/^matrix\(([^)]+)\)$/);
	if (!matrixMatch) return null;
	const values = matrixMatch[1].split(",").map(Number);
	return Number.isFinite(values[5]) ? values[5] : null;
};

const offsetTransformVertically = (transform, offsetY) => {
	if (!Number.isFinite(offsetY) || Math.abs(offsetY) < 0.01) {
		return transform;
	}

	try {
		if (typeof DOMMatrix === "function") {
			const matrix = new DOMMatrix(transform && transform !== "none" ? transform : undefined);
			matrix.m42 += offsetY;
			return matrix.toString();
		}
	} catch (_) {
		// A translate prefix is safe here because lyric rows only use vertical transforms.
	}

	return `translateY(${offsetY}px)${transform && transform !== "none" ? ` ${transform}` : ""}`;
};

const getMedian = (values) => {
	if (!Array.isArray(values) || values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
};

const getAdaptiveLyricsCenteringTiming = (transitionWindowMs) => {
	const defaultTotalMs = LYRICS_CENTERING_DURATION_MS + LYRICS_CENTERING_MAX_STAGGER_MS;
	if (!Number.isFinite(transitionWindowMs) || transitionWindowMs <= 0) {
		return {
			durationMs: LYRICS_CENTERING_DURATION_MS,
			staggerMs: LYRICS_CENTERING_STAGGER_MS,
			maxStaggerMs: LYRICS_CENTERING_MAX_STAGGER_MS,
		};
	}

	// A rapid vocal stack can advance again before the previous 300 ms movement
	// (plus its stagger) has settled. Scale the whole motion budget together so
	// every visible row reaches its destination just before the next row starts.
	const availableMs = Math.max(
		LYRICS_CENTERING_MIN_TOTAL_MS,
		transitionWindowMs - LYRICS_CENTERING_SETTLE_RESERVE_MS
	);
	const timingScale = Math.min(1, availableMs / defaultTotalMs);
	return {
		durationMs: Math.max(1, Math.round(LYRICS_CENTERING_DURATION_MS * timingScale)),
		staggerMs: Math.max(0, Math.round(LYRICS_CENTERING_STAGGER_MS * timingScale)),
		maxStaggerMs: Math.max(0, Math.round(LYRICS_CENTERING_MAX_STAGGER_MS * timingScale)),
	};
};

const cubicBezierCoordinate = (t, first, second) => {
	const inverse = 1 - t;
	return (3 * inverse * inverse * t * first)
		+ (3 * inverse * t * t * second)
		+ (t * t * t);
};

const cubicBezierDerivative = (t, first, second) => {
	const inverse = 1 - t;
	return (3 * inverse * inverse * first)
		+ (6 * inverse * t * (second - first))
		+ (3 * t * t * (1 - second));
};

const getLyricsCenteringProgress = (progress) => {
	const clamped = Math.max(0, Math.min(1, progress));
	const [x1, y1, x2, y2] = LYRICS_CENTERING_BEZIER;
	let parameter = clamped;

	for (let iteration = 0; iteration < 5; iteration++) {
		const difference = cubicBezierCoordinate(parameter, x1, x2) - clamped;
		const derivative = cubicBezierDerivative(parameter, x1, x2);
		if (Math.abs(difference) < 0.0001 || Math.abs(derivative) < 0.0001) break;
		parameter = Math.max(0, Math.min(1, parameter - difference / derivative));
	}

	return cubicBezierCoordinate(parameter, y1, y2);
};

const cancelSyncedLyricsScrollAnimation = (container) => {
	const animation = container ? syncedLyricsScrollAnimations.get(container) : null;
	if (!animation) return;

	animation.cancelFrame(animation.frameId);
	syncedLyricsScrollAnimations.delete(container);
};

const prefersReducedLyricsMotion = () => (
	CONFIG?.visual?.["reduce-motion"] === true
	|| (
		typeof window !== "undefined"
		&& typeof window.matchMedia === "function"
		&& window.matchMedia("(prefers-reduced-motion: reduce)").matches
	)
);

const animateSyncedLyricsScroll = (container, targetTop) => {
	cancelSyncedLyricsScrollAnimation(container);

	const startTop = Number(container.scrollTop) || 0;
	if (Math.abs(targetTop - startTop) < 0.5 || prefersReducedLyricsMotion()) {
		container.scrollTop = targetTop;
		return;
	}

	const now = typeof performance !== "undefined" && typeof performance.now === "function"
		? () => performance.now()
		: () => Date.now();
	const requestFrame = typeof window.requestAnimationFrame === "function"
		? window.requestAnimationFrame.bind(window)
		: (callback) => setTimeout(() => callback(now()), 16);
	const cancelFrame = typeof window.cancelAnimationFrame === "function"
		? window.cancelAnimationFrame.bind(window)
		: clearTimeout;
	const animation = {
		frameId: null,
		cancelFrame,
		startTop,
		targetTop,
		startTime: now(),
	};

	const frame = (timestamp) => {
		if (syncedLyricsScrollAnimations.get(container) !== animation) return;

		const elapsed = Math.max(0, timestamp - animation.startTime);
		const progress = Math.min(1, elapsed / LYRICS_CENTERING_DURATION_MS);
		const eased = getLyricsCenteringProgress(progress);
		container.scrollTop = animation.startTop
			+ ((animation.targetTop - animation.startTop) * eased);

		if (progress < 1) {
			animation.frameId = requestFrame(frame);
			return;
		}

		container.scrollTop = animation.targetTop;
		syncedLyricsScrollAnimations.delete(container);
	};

	syncedLyricsScrollAnimations.set(container, animation);
	animation.frameId = requestFrame(frame);
};

const scrollSyncedContainerToActiveLine = (container, activeLine, behavior = "smooth") => {
  if (!container || !activeLine) return;

  const anchorRatio = getLyricsAnchorRatio(container);
  const containerHeight = container.clientHeight || 0;
  const lineAnchorCenter = getActiveLineAnchorCenter(activeLine);
  const activeLineTop = getElementOffsetTopWithin(activeLine, container);
  const targetTop = activeLineTop - (containerHeight * anchorRatio - lineAnchorCenter);
	const maxScrollTop = Math.max(0, container.scrollHeight - containerHeight);
	const nextTop = Math.max(0, Math.min(targetTop, maxScrollTop));

	if (behavior === "smooth") {
		animateSyncedLyricsScroll(container, nextTop);
		return;
	}

	if (behavior === "sync" && syncedLyricsScrollAnimations.has(container)) {
		syncedLyricsScrollAnimations.get(container).targetTop = nextTop;
		return;
	}

	cancelSyncedLyricsScrollAnimation(container);
	container.scrollTop = nextTop;
};

const getKaraokeVocalAnchorCenterWithinLine = (activeLine) => {
	if (!activeLine || typeof activeLine.querySelector !== "function") {
		return null;
	}

	const stack = activeLine.querySelector(".lyrics-karaoke-stack[data-karaoke-vocal-row-count]");
	const rowCount = Number(stack?.getAttribute("data-karaoke-vocal-row-count"));
	const rawAnchorPosition = stack?.getAttribute("data-karaoke-vocal-anchor-position");
	// Before the first vocal row starts, the playback anchor is intentionally absent.
	// Still center the first row so a multi-vocal block does not get centered as a
	// whole and then jump upward as soon as that first row becomes active.
	const anchorPosition = rawAnchorPosition === null ? 0 : Number(rawAnchorPosition);
	if (
		!stack
		|| !Number.isFinite(anchorPosition)
		|| !Number.isFinite(rowCount)
		|| rowCount < KARAOKE_VOCAL_STACK_CENTER_THRESHOLD
	) {
		return null;
	}

	const rows = Array.from(stack.querySelectorAll("[data-karaoke-vocal-row-index]"));
	if (rows.length === 0) {
		return null;
	}

	const rowByIndex = new Map(rows.map((row) => [
		Number(row.getAttribute("data-karaoke-vocal-row-index")),
		row,
	]));
	const lowerIndex = Math.max(0, Math.min(rowCount - 1, Math.floor(anchorPosition)));
	const upperIndex = Math.max(0, Math.min(rowCount - 1, Math.ceil(anchorPosition)));
	const lowerRow = rowByIndex.get(lowerIndex);
	const upperRow = rowByIndex.get(upperIndex) || lowerRow;
	if (!lowerRow || !upperRow) {
		return null;
	}

	const lineRect = activeLine.getBoundingClientRect();
	const rowCenter = (row) => {
		const rect = row.getBoundingClientRect();
		return rect.top - lineRect.top + rect.height / 2;
	};
	const lowerCenter = rowCenter(lowerRow);
	const upperCenter = rowCenter(upperRow);
	const progress = Math.max(0, Math.min(1, anchorPosition - lowerIndex));
	return lowerCenter + (upperCenter - lowerCenter) * progress;
};

const COMPACT_LINE_LAYOUT_CACHE = new WeakMap();
const COMPACT_CONTAINER_LAYOUT_CACHE = new WeakMap();

const getCachedLineLayoutMetrics = (element) => {
	if (!element) {
		return { height: 0, offsetTop: 0 };
	}
	return COMPACT_LINE_LAYOUT_CACHE.get(element) || { height: 0, offsetTop: 0 };
};

const rememberCompactLineLayout = (element) => {
	if (!element) {
		return;
	}
	COMPACT_LINE_LAYOUT_CACHE.set(element, {
		height: Number(element.offsetHeight) || 0,
		offsetTop: Number(element.offsetTop) || 0,
	});
};

const rememberCompactContainerLayout = (container) => {
	if (!container) {
		return 0;
	}
	const height = Number(container.clientHeight) || 0;
	COMPACT_CONTAINER_LAYOUT_CACHE.set(container, height);
	return height;
};

const getCachedContainerHeight = (container) => {
	if (!container) {
		return 0;
	}
	const cached = COMPACT_CONTAINER_LAYOUT_CACHE.get(container);
	return Number.isFinite(cached) && cached > 0 ? cached : 0;
};

const getActiveLineAnchorCenter = (activeLine) => {
	const cachedHeight = getCachedLineLayoutMetrics(activeLine).height;
	if (cachedHeight > 0) {
		return cachedHeight / 2;
	}
	const vocalAnchorCenter = getKaraokeVocalAnchorCenterWithinLine(activeLine);
	if (vocalAnchorCenter !== null) {
		return vocalAnchorCenter;
	}
	return 0;
};

const getCompactLineDocumentTop = (element) => getCachedLineLayoutMetrics(element).offsetTop;

const getCompactSyncedOffset = (container, activeLine, isScrolling, predictedLine = null, allowMeasure = false) => {
	if (!container || isScrolling) {
		return 0;
	}

	const targetLine = predictedLine || activeLine;
	if (!targetLine) {
		return Number.isFinite(container?._ivCompactOffset) ? container._ivCompactOffset : 0;
	}

	if (allowMeasure) {
		rememberCompactContainerLayout(container);
		rememberCompactLineLayout(targetLine);
	}

	const cachedMetrics = getCachedLineLayoutMetrics(targetLine);
	const containerHeight = getCachedContainerHeight(container);
	if (cachedMetrics.height > 0 && containerHeight > 0) {
		const anchorRatio = getLyricsAnchorRatio(container);
		return containerHeight * anchorRatio - (cachedMetrics.offsetTop + cachedMetrics.height / 2);
	}

	if (!allowMeasure) {
		return Number.isFinite(container?._ivCompactOffset) ? container._ivCompactOffset : 0;
	}

	const anchorRatio = getLyricsAnchorRatio(container);
	const anchorOffset = (Number(container.clientHeight) || 0) * anchorRatio;
	const lineTop = getElementOffsetTopWithin(targetLine, container);
	const lineHeight = Number(targetLine.offsetHeight) || 0;
	return anchorOffset - (lineTop + lineHeight / 2);
};

const useSyncedLayoutEffect = react.useLayoutEffect || useEffect;

const prepareGlobalCharTimeline = (lyrics) => {
	const offsets = new Array(lyrics.length);
	const chars = [];
	const entries = [];
	let totalChars = 0;

	for (let i = 0; i < lyrics.length; i++) {
		const line = lyrics[i];
		offsets[i] = totalChars;

		const backgroundVocals = line?.vocals?.background;
		const backgroundVocalCount = Array.isArray(backgroundVocals) ? backgroundVocals.length : 0;
		const sourceCount = 2 + backgroundVocalCount;
		for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex++) {
			const syllables = sourceIndex === 0
				? line?.syllables
				: sourceIndex === 1
					? line?.vocals?.lead?.syllables
					: backgroundVocals[sourceIndex - 2]?.syllables;
			if (!Array.isArray(syllables) || syllables.length === 0) continue;

			const sourceChars = [];
			const syllableCount = syllables.length;
			for (let syllableIndex = 0; syllableIndex < syllableCount; syllableIndex++) {
				const syllable = syllables[syllableIndex];
				if (!syllable || !syllable.text) continue;

				const charArray = splitKaraokeGraphemes(syllable.text);
				const charCount = charArray.length;
				if (charCount === 0) continue;
				const syllableStart = syllable.startTime || 0;
				const syllableEnd = syllable.endTime || syllableStart + 500;

				for (let charIdx = 0; charIdx < charCount; charIdx++) {
					const charDuration = (syllableEnd - syllableStart) / charCount;
					const charStart = syllableStart + (charIdx * charDuration);
					const charEnd = charStart + charDuration;

					sourceChars.push({
						char: charArray[charIdx],
						startTime: charStart,
						endTime: charEnd,
					});
				}
			}

			coalesceKaraokeTimedGraphemes(sourceChars).forEach((charInfo) => {
				const charStart = charInfo.startTime;
				const charEnd = charInfo.endTime;
				const charDuration = Math.max(1, charEnd - charStart);
				chars.push(charStart, charEnd, charDuration);
				entries.push({
					startTime: charStart,
					endTime: charEnd,
					duration: charDuration,
					charIndex: totalChars,
				});
				totalChars++;
			});
		}
	}

	const activeEntries = [...entries].sort((first, second) => (
		first.startTime - second.startTime
		|| first.charIndex - second.charIndex
	));
	const activePrefixMaxEnd = new Float64Array(activeEntries.length);
	let maximumEndTime = -Infinity;
	for (let index = 0; index < activeEntries.length; index += 1) {
		maximumEndTime = Math.max(maximumEndTime, activeEntries[index].endTime);
		activePrefixMaxEnd[index] = maximumEndTime;
	}
	// For equal end times, place the lower source index last. The old linear scan
	// kept the first matching character when multiple vocal rows ended together.
	const passedEntries = [...entries].sort((first, second) => (
		first.endTime - second.endTime
		|| second.charIndex - first.charIndex
	));

	return {
		globalCharOffsets: offsets,
		chars,
		activeEntries,
		activePrefixMaxEnd,
		passedEntries,
	};
};

const queryGlobalCharTimeline = (timeline, position) => {
	let activeCharIndex = -1;
	let lastPassedCharIndex = -1;
	let lastPassedCharEndTime = 0;
	let lastPassedCharDuration = 100;
	const activeEntries = timeline.activeEntries;
	const activePrefixMaxEnd = timeline.activePrefixMaxEnd;
	const passedEntries = timeline.passedEntries;

	if (Array.isArray(activeEntries) && activePrefixMaxEnd?.length === activeEntries.length) {
		let lower = 0;
		let upper = activeEntries.length;
		while (lower < upper) {
			const middle = (lower + upper) >> 1;
			if (activeEntries[middle].startTime <= position) lower = middle + 1;
			else upper = middle;
		}

		for (let index = lower - 1; index >= 0 && activePrefixMaxEnd[index] > position; index -= 1) {
			const entry = activeEntries[index];
			if (position < entry.endTime) {
				activeCharIndex = Math.max(activeCharIndex, entry.charIndex);
			}
		}
	}

	if (Array.isArray(passedEntries) && passedEntries.length > 0) {
		let lower = 0;
		let upper = passedEntries.length;
		while (lower < upper) {
			const middle = (lower + upper) >> 1;
			if (passedEntries[middle].endTime <= position) lower = middle + 1;
			else upper = middle;
		}

		const entry = passedEntries[lower - 1];
		if (entry && entry.endTime > 0) {
			lastPassedCharEndTime = entry.endTime;
			lastPassedCharIndex = entry.charIndex;
			lastPassedCharDuration = entry.duration || 100;
		}
	} else {
		// Keep the exported helper compatible with timelines created by an older
		// ivLyrics runtime during hot reloads.
		for (let valueIndex = 0, charIndex = 0; valueIndex < timeline.chars.length; valueIndex += 3, charIndex++) {
			const charStart = timeline.chars[valueIndex];
			const charEnd = timeline.chars[valueIndex + 1];
			const charDuration = timeline.chars[valueIndex + 2];
			if (position >= charStart && position < charEnd) {
				activeCharIndex = charIndex;
			}
			if (position >= charEnd && charEnd > lastPassedCharEndTime) {
				lastPassedCharEndTime = charEnd;
				lastPassedCharIndex = charIndex;
				lastPassedCharDuration = charDuration || 100;
			}
		}
	}

	if (activeCharIndex === -1 && lastPassedCharIndex !== -1) {
		const timeDiff = position - lastPassedCharEndTime;
		const simulateDuration = Math.max(40, lastPassedCharDuration * 0.01);
		const virtualProgress = Math.floor(timeDiff / simulateDuration);

		if (timeDiff < 2000) {
			activeCharIndex = lastPassedCharIndex + 1 + virtualProgress;
		}
	}

	return {
		globalCharOffsets: timeline.globalCharOffsets,
		activeGlobalCharIndex: activeCharIndex,
	};
};

const EMPTY_GLOBAL_CHAR_STATE = {
	globalCharOffsets: [],
	activeGlobalCharIndex: -1,
};

const KARAOKE_PRE_SPACE_MIN_DURATION_MS = 40;
const KARAOKE_PRE_SPACE_NEXT_CHAR_RATIO = 0.35;
const KARAOKE_PRE_SPACE_MAX_DURATION_MS = 60;
const KARAOKE_FILL_CORRECTION_DEFAULT_POINTS = [
	{ x: 0, y: 0 },
	{ x: 0.25, y: 0.25 },
	{ x: 0.5, y: 0.5 },
	{ x: 0.75, y: 0.75 },
	{ x: 1, y: 1 },
];
const PSEUDO_KARAOKE_SOURCES = new Set(["audio-analysis-pseudo", "spotify-audio-analysis", "line-timing-pseudo"]);
const KARAOKE_RTL_STRONG_CHAR_REGEX = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/u;
const KARAOKE_LTR_STRONG_CHAR_REGEX = /[A-Za-z\u00C0-\u02AF\u0370-\u052F\u1E00-\u1EFF]/u;
const KARAOKE_JOINING_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/u;
const KARAOKE_COMPLEX_GRAPHEME_REGEX = /[\p{M}\u200C\u200D]/u;

const getKaraokeTextDirection = (text) => {
	const normalizedText = typeof text === "string" ? text : "";
	let rtlCount = 0;
	let ltrCount = 0;

	for (const char of Array.from(normalizedText)) {
		if (KARAOKE_RTL_STRONG_CHAR_REGEX.test(char)) {
			rtlCount++;
			continue;
		}
		if (KARAOKE_LTR_STRONG_CHAR_REGEX.test(char)) {
			ltrCount++;
		}
	}

	return rtlCount > ltrCount ? "rtl" : "ltr";
};

const shouldUseKaraokeTextRun = (text) => {
	const normalizedText = typeof text === "string" ? text : "";
	return KARAOKE_RTL_STRONG_CHAR_REGEX.test(normalizedText) ||
		KARAOKE_JOINING_SCRIPT_REGEX.test(normalizedText) ||
		KARAOKE_COMPLEX_GRAPHEME_REGEX.test(normalizedText);
};

const shouldWrapKaraokeByWord = (text) => {
	const normalizedText = typeof text === "string" ? text : "";
	return /\S\s+\S/u.test(normalizedText);
};

// 라틴 문자가 지배적인 긴 텍스트(영어 등)를 Text Run 경로로 전환하여
// 글자별 span 대신 세그먼트(단어) 단위 span으로 렌더링합니다.
// 이를 통해 DOM 요소 수가 50~80개에서 10~15개로 줄어 레이아웃 비용이 대폭 감소합니다.
const KARAOKE_LATIN_TEXT_RUN_MIN_GRAPHEMES = 20;
const KARAOKE_LATIN_TEXT_RUN_MIN_RATIO = 0.4;
const KARAOKE_LATIN_CHAR_REGEX = /[A-Za-z\u00C0-\u02AF\u0370-\u052F\u1E00-\u1EFF\u0400-\u04FF]/u;

const shouldUseKaraokeTextRunForLatin = (text) => {
	const normalizedText = typeof text === "string" ? text : "";
	if (!normalizedText) return false;
	// CJK 문자가 포함된 경우에는 기존 char 경로 유지 (일본어/중국어/한국어 글자별 fill 보존)
	if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/u.test(normalizedText)) {
		return false;
	}
	const nonWhitespaceChars = normalizedText.replace(/\s/gu, "");
	if (nonWhitespaceChars.length < KARAOKE_LATIN_TEXT_RUN_MIN_GRAPHEMES) return false;
	const latinCount = Array.from(nonWhitespaceChars).filter(ch => KARAOKE_LATIN_CHAR_REGEX.test(ch)).length;
	return latinCount / nonWhitespaceChars.length >= KARAOKE_LATIN_TEXT_RUN_MIN_RATIO;
};

const clampKaraokeFillCurveValue = (value, fallback = 0) => {
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) {
		return fallback;
	}
	return Math.max(0, Math.min(1, numberValue));
};

const normalizeKaraokeFillCorrectionPoints = (value) => {
	let parsed = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch {
			parsed = null;
		}
	}

	const points = KARAOKE_FILL_CORRECTION_DEFAULT_POINTS.map((defaultPoint, index) => {
		const source = Array.isArray(parsed) ? parsed[index] : null;
		const sourceY = Array.isArray(source) ? source[1] : source?.y;
		return {
			x: defaultPoint.x,
			y: clampKaraokeFillCurveValue(sourceY, defaultPoint.y),
		};
	});

	points[0].y = 0;
	points[points.length - 1].y = 1;
	for (let index = 1; index < points.length - 1; index += 1) {
		points[index].y = Math.max(points[index - 1].y, points[index].y);
	}
	for (let index = points.length - 2; index > 0; index -= 1) {
		points[index].y = Math.min(points[index + 1].y, points[index].y);
	}

	return points;
};

let karaokeFillCorrectionCurveCacheKey = null;
let karaokeFillCorrectionCurveCachePoints = KARAOKE_FILL_CORRECTION_DEFAULT_POINTS;

const getKaraokeFillCorrectionPoints = () => {
	const configuredValue = CONFIG?.visual?.["karaoke-fill-correction-curve"] ||
		"[[0,0],[0.25,0.25],[0.5,0.5],[0.75,0.75],[1,1]]";
	if (configuredValue === karaokeFillCorrectionCurveCacheKey) {
		return karaokeFillCorrectionCurveCachePoints;
	}

	karaokeFillCorrectionCurveCacheKey = configuredValue;
	karaokeFillCorrectionCurveCachePoints = normalizeKaraokeFillCorrectionPoints(configuredValue);
	return karaokeFillCorrectionCurveCachePoints;
};

const applyKaraokeFillCorrectionCurve = (value) => {
	const normalizedValue = clampKaraokeFillCurveValue(value);
	if (normalizedValue <= 0) return 0;
	if (normalizedValue >= 1) return 1;

	const points = getKaraokeFillCorrectionPoints();
	if (points.every((point) => Math.abs(point.y - point.x) < 0.000001)) {
		return normalizedValue;
	}
	let segmentIndex = 0;
	for (let index = 0; index < points.length - 1; index += 1) {
		if (normalizedValue >= points[index].x && normalizedValue <= points[index + 1].x) {
			segmentIndex = index;
			break;
		}
	}

	const p0 = points[Math.max(0, segmentIndex - 1)];
	const p1 = points[segmentIndex];
	const p2 = points[segmentIndex + 1];
	const p3 = points[Math.min(points.length - 1, segmentIndex + 2)];
	const localProgress = (normalizedValue - p1.x) / Math.max(0.0001, p2.x - p1.x);
	const rawControlY = (p1.y + p2.y) / 2 + (p2.y - p0.y + p3.y - p1.y) / 8;
	// Keep every quadratic segment monotonic. Without this clamp, equal adjacent
	// values can produce an overshooting control point (for example 0.5 ->
	// 0.59375 -> 0.5), making the karaoke fill advance and then visibly retreat.
	const controlY = Math.max(p1.y, Math.min(p2.y, rawControlY));
	const oneMinusProgress = 1 - localProgress;
	const correctedValue =
		oneMinusProgress * oneMinusProgress * p1.y +
		2 * oneMinusProgress * localProgress * controlY +
		localProgress * localProgress * p2.y;

	return clampKaraokeFillCurveValue(correctedValue);
};

const KARAOKE_CHAR_STATE_CLASS_NAMES = {
	pending: [
		"lyrics-karaoke-char lyrics-karaoke-char--pending",
		"lyrics-karaoke-char lyrics-karaoke-char--pending is-complete",
		"lyrics-karaoke-char lyrics-karaoke-char--pending is-bouncing",
		"lyrics-karaoke-char lyrics-karaoke-char--pending is-bouncing is-complete",
	],
	active: [
		"lyrics-karaoke-char lyrics-karaoke-char--active",
		"lyrics-karaoke-char lyrics-karaoke-char--active is-complete",
		"lyrics-karaoke-char lyrics-karaoke-char--active is-bouncing",
		"lyrics-karaoke-char lyrics-karaoke-char--active is-bouncing is-complete",
	],
	done: [
		"lyrics-karaoke-char lyrics-karaoke-char--done",
		"lyrics-karaoke-char lyrics-karaoke-char--done is-complete",
		"lyrics-karaoke-char lyrics-karaoke-char--done is-bouncing",
		"lyrics-karaoke-char lyrics-karaoke-char--done is-bouncing is-complete",
	],
};

const KARAOKE_TEXT_RUN_STATE_CLASS_NAMES = {
	pending: [
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--pending",
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--pending is-complete",
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--pending is-bouncing",
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--pending is-bouncing is-complete",
	],
	active: [
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--active",
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--active is-complete",
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--active is-bouncing",
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--active is-bouncing is-complete",
	],
	done: [
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--done",
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--done is-complete",
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--done is-bouncing",
		"lyrics-karaoke-text-run-segment lyrics-karaoke-text-run-segment--done is-bouncing is-complete",
	],
};

const KARAOKE_WHITESPACE_CHAR_REGEX = /\s/u;

const getCachedKaraokeStateClassName = (classNames, state, isBouncing, isComplete) => (
	classNames[state][(isBouncing ? 2 : 0) + (isComplete ? 1 : 0)]
);

const assignKaraokeWordIndexes = (timedChars, preferSourceUnits = false, locale = "auto") => {
	if (!Array.isArray(timedChars) || timedChars.length === 0) {
		return timedChars;
	}

	const wordIndexes = new Array(timedChars.length).fill(null);
	const assignFromSourceUnits = () => {
		const unitWordIndexes = new Map();
		let nextWordIndex = 0;
		timedChars.forEach((charInfo, index) => {
			const char = String(charInfo?.char || "");
			if (!char || KARAOKE_WHITESPACE_CHAR_REGEX.test(char)) return;
			const unitIndex = Number.isInteger(charInfo?.karaokeUnitIndex)
				? charInfo.karaokeUnitIndex
				: index;
			if (!unitWordIndexes.has(unitIndex)) {
				unitWordIndexes.set(unitIndex, nextWordIndex++);
			}
			wordIndexes[index] = unitWordIndexes.get(unitIndex);
		});
	};

	if (preferSourceUnits) {
		assignFromSourceUnits();
	} else if (window.LyricsWordSegmenter?.segmentRanges) {
		const text = timedChars.map((charInfo) => String(charInfo?.char || "")).join("");
		const charUtf16Offsets = [];
		let utf16Offset = 0;
		timedChars.forEach((charInfo) => {
			charUtf16Offsets.push(utf16Offset);
			utf16Offset += String(charInfo?.char || "").length;
		});

		window.LyricsWordSegmenter.segmentRanges(text, locale).forEach((segment, nextWordIndex) => {
			for (let index = 0; index < charUtf16Offsets.length; index += 1) {
				const charStart = charUtf16Offsets[index];
				if (charStart >= segment.start && charStart < segment.end) {
					wordIndexes[index] = nextWordIndex;
				}
			}
		});
	} else if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
		const text = timedChars.map((charInfo) => String(charInfo?.char || "")).join("");
		const charUtf16Offsets = [];
		let utf16Offset = 0;
		timedChars.forEach((charInfo) => {
			charUtf16Offsets.push(utf16Offset);
			utf16Offset += String(charInfo?.char || "").length;
		});

		let nextWordIndex = 0;
		for (const segment of new Intl.Segmenter(locale === "auto" ? undefined : locale, { granularity: "word" }).segment(text)) {
			if (!segment.segment || /^\s+$/u.test(segment.segment)) continue;
			const segmentStart = segment.index;
			const segmentEnd = segmentStart + segment.segment.length;
			for (let index = 0; index < charUtf16Offsets.length; index += 1) {
				const charStart = charUtf16Offsets[index];
				if (charStart >= segmentStart && charStart < segmentEnd) {
					wordIndexes[index] = nextWordIndex;
				}
			}
			nextWordIndex += 1;
		}
	} else {
		assignFromSourceUnits();
	}

	return timedChars.map((charInfo, index) => ({
		...charInfo,
		karaokeWordIndex: wordIndexes[index],
	}));
};

const getKaraokeInlineStylePresentation = (charInfo) => {
	if (charInfo?.inlineStyle !== true) return null;

	const kind = String(charInfo?.styleKind || "").trim().toLowerCase();
	const kindClasses = getKaraokeKindClassParts(kind);
	const speakerClass = normalizeKaraokeSpeakerClass(
		charInfo?.styleSpeaker,
		charInfo?.styleSpeakerColor,
		charInfo?.styleSpeakerFallback
	);
	if (kindClasses.length === 0 && !speakerClass) return null;

	return {
		key: [
			kindClasses.join(" "),
			speakerClass,
			String(charInfo?.styleSpeakerColor || "").trim().toLowerCase(),
			String(charInfo?.styleSpeakerFallback || "").trim().toUpperCase(),
		].join("|"),
		className: [
			"ivlyrics-karaoke-range-style",
			...kindClasses,
			speakerClass ? `speaker-${speakerClass}` : "",
		].filter(Boolean).join(" "),
		style: getKaraokeSpeakerStyle(
			charInfo?.styleSpeaker,
			charInfo?.styleSpeakerColor,
			charInfo?.styleSpeakerFallback
		),
	};
};

const KARAOKE_INLINE_STYLE_MAX_RUN_LENGTH = 12;

const wrapKaraokeInlineStyleRuns = (
	timedChars,
	elements,
	{ keyPrefix = "karaoke-inline-style", sourceIndexOffset = 0 } = {}
) => {
	if (!Array.isArray(timedChars)
		|| !Array.isArray(elements)
		|| timedChars.length !== elements.length
		|| timedChars.length === 0) {
		return elements;
	}

	const result = [];
	let run = null;
	const flush = () => {
		if (!run) return;
		if (!run.presentation) {
			result.push(...run.elements);
		} else {
			result.push(react.createElement(
				"span",
				{
					className: run.presentation.className,
					style: {
						...run.presentation.style,
						"--ivlyrics-range-index": sourceIndexOffset + run.startIndex,
					},
					key: `${keyPrefix}-${sourceIndexOffset + run.startIndex}`,
				},
				run.elements
			));
		}
		run = null;
	};

	for (let index = 0; index < timedChars.length; index += 1) {
		const presentation = getKaraokeInlineStylePresentation(timedChars[index]);
		const styleKey = presentation?.key || "";
		if (!run
			|| run.styleKey !== styleKey
			|| run.elements.length >= KARAOKE_INLINE_STYLE_MAX_RUN_LENGTH) {
			flush();
			run = {
				styleKey,
				presentation,
				startIndex: index,
				elements: [],
			};
		}
		run.elements.push(elements[index]);
	}
	flush();
	return result;
};

const buildKaraokeWordElements = (
	timedChars,
	charElements,
	{ position = 0, isActive = false, isComplete = false, globalCharOffset = 0, activeGlobalCharIndex = -1, wordTimed = false } = {}
) => {
	if (!Array.isArray(timedChars) || !Array.isArray(charElements) || timedChars.length !== charElements.length) {
		return charElements;
	}

	const wordElements = [];
	let currentWord = [];
	let currentWordStart = 0;
	let currentWordUnit = null;
	const timedCharCount = timedChars.length;
	const flushWord = () => {
		if (currentWord.length === 0) return;
		const wordChars = timedChars.slice(currentWordStart, currentWordStart + currentWord.length);
		const startTime = wordChars.reduce((minimum, charInfo) => {
			const value = Number.isFinite(charInfo?.karaokeFillStartTime)
				? charInfo.karaokeFillStartTime
				: charInfo?.startTime;
			return Number.isFinite(value) ? Math.min(minimum, value) : minimum;
		}, Infinity);
		const endTime = wordChars.reduce((maximum, charInfo) => {
			const value = Number.isFinite(charInfo?.karaokeFillEndTime)
				? charInfo.karaokeFillEndTime
				: charInfo?.endTime;
			return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
		}, -Infinity);
		const bounce = wordTimed && Number.isFinite(startTime) && Number.isFinite(endTime)
			? getKaraokeWordBounceValues(position, isActive, startTime, endTime)
			: { active: false };
		const style = bounce.active ? {
			"--karaoke-bounce-y": `${bounce.offsetY}px`,
			"--karaoke-bounce-scale": bounce.scale,
		} : undefined;
		const styledWordElements = wrapKaraokeInlineStyleRuns(wordChars, currentWord, {
			keyPrefix: "karaoke-word-inline-style",
			sourceIndexOffset: currentWordStart,
		});
		wordElements.push(react.createElement(
			"span",
			{
				className: `lyrics-karaoke-word${wordTimed ? " is-word-timed" : ""}${bounce.active ? " is-bouncing" : ""}${isComplete ? " is-complete" : ""}`,
				style,
				key: `karaoke-word-${currentWordStart}`,
			},
			styledWordElements
		));
		currentWord = [];
		currentWordUnit = null;
	};

	for (let index = 0; index < timedCharCount; index++) {
		if (!(index in timedChars)) {
			continue;
		}

		const charInfo = timedChars[index];
		const char = charInfo?.char || "";
		const element = charElements[index];
		const isWhitespace = KARAOKE_WHITESPACE_CHAR_REGEX.test(char);
		const unitIndex = Number.isInteger(charInfo?.karaokeWordIndex)
			? charInfo.karaokeWordIndex
			: null;
		const unitChanged = wordTimed
			&& currentWord.length > 0
			&& unitIndex !== null
			&& currentWordUnit !== null
			&& unitIndex !== currentWordUnit;

		if (unitChanged) {
			flushWord();
		}

		if (!isWhitespace && currentWord.length === 0) {
			currentWordStart = index;
			currentWordUnit = unitIndex;
		}

		if (isWhitespace) {
			flushWord();
			wordElements.push(...wrapKaraokeInlineStyleRuns([charInfo], [element], {
				keyPrefix: "karaoke-space-inline-style",
				sourceIndexOffset: index,
			}));
			continue;
		}

		currentWord.push(element);
	}

	flushWord();
	return wordElements;
};

const getKaraokeSegmentFill = (segment, position, isActive, isComplete) => {
	if (isComplete) {
		return 100;
	}
	if (!segment) {
		return 0;
	}

	const startTime = Number.isFinite(segment.startTime) ? segment.startTime : 0;
	const endTime = Number.isFinite(segment.endTime) ? segment.endTime : startTime;
	if (position <= startTime) {
		return 0;
	}
	if (position >= endTime) {
		return 100;
	}

	const raw = Math.max(0, Math.min(1, (position - startTime) / Math.max(1, endTime - startTime)));
	const corrected = applyKaraokeFillCorrectionCurve(raw) * 100;
	return Math.round(corrected / 4) * 4;
};

const getKaraokeInstantWordFill = (segment, position, isActive, isComplete) => {
	if (isComplete) return 100;
	if (!segment) return 0;
	const startTime = Number.isFinite(segment.startTime) ? segment.startTime : 0;
	return position >= startTime ? 100 : 0;
};

const buildKaraokeTextRunSegments = (timedChars, wordTimed = false, preserveInlineStyles = true) => {
	if (!Array.isArray(timedChars) || timedChars.length === 0) {
		return [];
	}
	const hasInlineStyles = preserveInlineStyles
		&& timedChars.some(charInfo => charInfo?.inlineStyle === true);
	const sharedSegments = !wordTimed && !hasInlineStyles && window.LyricsService?.buildKaraokeWordSegments?.(timedChars, {
		getText: (charInfo) => charInfo?.char || "",
		getStartTime: (charInfo) => charInfo?.startTime,
		getEndTime: (charInfo) => charInfo?.endTime,
	});
	if (Array.isArray(sharedSegments)) {
		return sharedSegments;
	}

	const segments = [];
	let currentSegment = null;
	const timedCharCount = timedChars.length;

	for (let index = 0; index < timedCharCount; index++) {
		if (!(index in timedChars)) {
			continue;
		}

		const charInfo = timedChars[index];
		const char = charInfo?.char || "";
		const type = KARAOKE_WHITESPACE_CHAR_REGEX.test(char) ? "space" : "text";
		const unitIndex = Number.isInteger(charInfo?.karaokeWordIndex)
			? charInfo.karaokeWordIndex
			: null;
		const unitChanged = wordTimed
			&& type === "text"
			&& currentSegment?.type === "text"
			&& unitIndex !== null
			&& currentSegment.unitIndex !== null
			&& currentSegment.unitIndex !== unitIndex;
		const hasInlineStyle = preserveInlineStyles && charInfo?.inlineStyle === true;
		const styleKind = hasInlineStyle ? String(charInfo?.styleKind || '') : '';
		const styleSpeaker = hasInlineStyle ? String(charInfo?.styleSpeaker || '') : '';
		const styleSpeakerColor = hasInlineStyle ? String(charInfo?.styleSpeakerColor || '') : '';
		const styleSpeakerFallback = hasInlineStyle ? String(charInfo?.styleSpeakerFallback || '') : '';
		const styleChanged = currentSegment
			&& (
				currentSegment.styleKind !== styleKind
				|| currentSegment.styleSpeaker !== styleSpeaker
				|| currentSegment.styleSpeakerColor !== styleSpeakerColor
				|| currentSegment.styleSpeakerFallback !== styleSpeakerFallback
			);
		if (!currentSegment || currentSegment.type !== type || unitChanged || styleChanged) {
			if (currentSegment?.text.length > 0) {
				segments.push(currentSegment);
			}
			currentSegment = {
				type,
				unitIndex,
				startIndex: index,
				charCount: 0,
				text: "",
				startTime: Number.isFinite(charInfo?.startTime) ? charInfo.startTime : 0,
				endTime: Number.isFinite(charInfo?.endTime) ? charInfo.endTime : 0,
				styleKind,
				styleSpeaker,
				styleSpeakerColor,
				styleSpeakerFallback,
			};
		}

		currentSegment.text += char;
		currentSegment.charCount += 1;
		if (Number.isFinite(charInfo?.endTime)) {
			currentSegment.endTime = Math.max(currentSegment.endTime, charInfo.endTime);
		}
	}

	if (currentSegment?.text.length > 0) {
		segments.push(currentSegment);
	}
	return segments;
};

const buildKaraokeTextRunElements = (
	timedChars,
	position,
	isActive,
	isComplete,
	textDirection,
	globalCharOffset = 0,
	activeGlobalCharIndex = -1,
	wordTimed = false,
	preserveInlineStyles = true
) => {
	const segments = buildKaraokeTextRunSegments(timedChars, wordTimed, preserveInlineStyles);
	const renderSegments = textDirection === "rtl" ? [...segments].reverse() : segments;

	return renderSegments.map((segment) => {
		if (segment.type === "space") {
			return react.createElement(
				"span",
				{
					className: "lyrics-karaoke-text-run-space",
					key: `karaoke-text-run-space-${segment.startIndex}`,
				},
				segment.text
			);
		}

		const fillValue = wordTimed
			? getKaraokeInstantWordFill(segment, position, isActive, isComplete)
			: getKaraokeSegmentFill(segment, position, isActive, isComplete);
		const segmentDirection = getKaraokeTextDirection(segment.text) || textDirection;
		const gradientDirection = segmentDirection === "rtl" ? "to left" : "to right";
		const segmentState = fillValue <= 0 ? "pending" : fillValue >= 100 ? "done" : "active";
		const segmentCharCount = Number.isFinite(segment.charCount)
			? segment.charCount
			: splitKaraokeGraphemes(segment.text).length;
		const segmentCenterIndex = globalCharOffset + segment.startIndex + Math.max(0, segmentCharCount - 1) / 2;
		const bounceAttenuation = wordTimed
			? 1
			: getKaraokeBounceAttenuation(segmentCenterIndex, activeGlobalCharIndex);
		const bounce = wordTimed
			? getKaraokeWordBounceValues(position, isActive, segment.startTime, segment.endTime, bounceAttenuation)
			: getKaraokeBounceValues(position, isActive, segment.startTime, segment.endTime, bounceAttenuation);
		const segmentStyle = {};
		if (segmentState === "active") {
			const softEdge = 10;
			segmentStyle["--karaoke-gradient-direction"] = gradientDirection;
			segmentStyle["--karaoke-char-fill"] = `${fillValue}%`;
			segmentStyle["--karaoke-char-fill-soft-start"] = `${Math.max(0, fillValue - softEdge)}%`;
			segmentStyle["--karaoke-char-fill-soft-end"] = `${Math.min(100, fillValue + softEdge)}%`;
		}
		if (bounce.active) {
			segmentStyle["--karaoke-bounce-y"] = `${bounce.offsetY}px`;
			segmentStyle["--karaoke-bounce-scale"] = bounce.scale;
		}

		let segmentClassName = getCachedKaraokeStateClassName(
			KARAOKE_TEXT_RUN_STATE_CLASS_NAMES,
			segmentState,
			bounce.active,
			isComplete
		);
		if (wordTimed) segmentClassName += " is-word-timed";
		if (segment.styleKind || segment.styleSpeaker) {
			const kindClasses = getKaraokeKindClassParts(segment.styleKind);
			segmentClassName += ` ivlyrics-karaoke-range-style${kindClasses.length ? ` ${kindClasses.join(' ')}` : ''}`;
			const speakerClass = normalizeKaraokeSpeakerClass(
				segment.styleSpeaker,
				segment.styleSpeakerColor,
				segment.styleSpeakerFallback
			);
			if (speakerClass) segmentClassName += ` speaker-${speakerClass}`;
			Object.assign(segmentStyle, getKaraokeSpeakerStyle(
				segment.styleSpeaker,
				segment.styleSpeakerColor,
				segment.styleSpeakerFallback
			));
		}
		segmentStyle['--ivlyrics-range-index'] = segment.startIndex;

		return react.createElement(
			"span",
			{
				className: segmentClassName,
				dir: segmentDirection,
				style: segmentStyle,
				"data-outline-text": segment.text,
				key: `karaoke-text-run-segment-${segment.startIndex}`,
			},
			react.createElement(
				"span",
				{ className: "lyrics-karaoke-glyph-fill" },
				segment.text
			)
		);
	});
};

const getPseudoKaraokeRenderAdvance = (karaokeSource) => {
	if (!PSEUDO_KARAOKE_SOURCES.has(karaokeSource)) {
		return 0;
	}

	const configuredAdvance = Number(CONFIG.visual["pseudo-karaoke-render-advance"] ?? 0);
	return Number.isFinite(configuredAdvance) ? configuredAdvance : 0;
};

const buildPreparedSyncedLyrics = (lyrics, isKara) =>
	lyrics.map((line, index, allLines) => {
		const displayValues = getEmbeddedAuxiliaryDisplayValues(line);
		return {
			...line,
			interludeInfo: getInterludeInfo(line, allLines[index + 1], index, allLines.length),
			...buildLyricDisplayState(
				isKara,
				line,
				displayValues.text,
				displayValues.originalText,
				displayValues.text2
			),
		};
	});

const buildPaddedSyncedLyrics = (lyrics, leadingEmptyLines) =>
	Array.from({ length: leadingEmptyLines }, () => emptyLine)
		.concat(lyrics)
		.map((line, lineNumber) => ({
			...line,
			lineNumber,
		}));

const shouldIncludeSyncedLineInCompactView = (line, activeLineIndex, visualLineIndex = activeLineIndex) =>
	!line?.interludeInfo?.isInterlude
	|| line.lineNumber === activeLineIndex
	|| line.lineNumber === visualLineIndex;

const getActiveTimedLineIndex = (lines, position) => {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line && position >= (line.startTime || 0)) {
			return i;
		}
	}

	return 0;
};

const getPrecenteredTimedLineIndex = (lines, position, activeLineIndex, advanceMs) => {
	if (!Array.isArray(lines) || lines.length === 0 || advanceMs <= 0) {
		return activeLineIndex;
	}

	const advancedLineIndex = getActiveTimedLineIndex(lines, position + advanceMs);
	// A very short lyric can put multiple starts inside the pre-centering window.
	// Advance by at most one row so an intermediate line is never skipped visually.
	return Math.min(
		lines.length - 1,
		activeLineIndex + 1,
		Math.max(activeLineIndex, advancedLineIndex)
	);
};

const buildSyncedLinePlaybackWindows = (lines, isKara) => {
	const safeLines = Array.isArray(lines) ? lines : [];
	return safeLines.map((line, index) => {
		const startTime = toFiniteTime(line?.startTime) ?? 0;
		const nextStartTime = toFiniteTime(safeLines[index + 1]?.startTime);
		const directEndTime = toFiniteTime(line?.endTime);
		let contentEndTime = directEndTime;

		if (isKara) {
			const boundsEndTime = toFiniteTime(getKaraokeLineBounds(line).endTime);
			const fillEndTime = getKaraokeLineFillEndTime(line);
			const candidates = [contentEndTime, boundsEndTime, fillEndTime]
				.filter((value) => value !== null && value >= startTime);
			contentEndTime = candidates.length > 0 ? Math.max(...candidates) : null;
		}

		if (contentEndTime === null || contentEndTime <= startTime) {
			contentEndTime = nextStartTime !== null && nextStartTime > startTime
				? nextStartTime
				: startTime;
		}

		const holdEndTime = nextStartTime !== null
			? Math.max(contentEndTime, nextStartTime)
			: contentEndTime;

		return {
			startTime,
			contentEndTime,
			holdEndTime,
			completionPosition: contentEndTime + KARAOKE_COMPLETION_POSITION_OFFSET_MS,
		};
	});
};

const getSyncedLinePlaybackState = (window, position) => {
	if (!window || !Number.isFinite(position) || position < window.startTime) {
		return {
			isHighlighted: false,
			isSinging: false,
			isAnimating: false,
			renderPosition: 0,
		};
	}

	const isSinging = position < window.contentEndTime;
	const isSettling = position < window.contentEndTime + KARAOKE_RELEASE_WINDOW_MS;
	return {
		isHighlighted: position < window.holdEndTime,
		isSinging,
		isAnimating: isSinging || isSettling,
		renderPosition: isSinging || isSettling
			? position
			: window.completionPosition,
	};
};

// 전체 화면에서는 지나간 줄을 더 남겨 두도록 별도 설정을 쓴다.
const getSyncedLinesBefore = () => {
	const fullscreen = window.lyricContainer?.state?.isFullscreen === true;
	const value = fullscreen ? CONFIG.visual["fullscreen-lines-before"] : CONFIG.visual["lines-before"];
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

const getSyncedLinesAfter = () => {
	const fullscreen = window.lyricContainer?.state?.isFullscreen === true;
	const value = fullscreen ? CONFIG.visual["fullscreen-lines-after"] : CONFIG.visual["lines-after"];
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

const getSyncedAnimationIndex = ({ compact, isScrolling, activeLineIndex, lineNumber, visibleIndex }) => {
	if (compact && isScrolling) {
		return 0;
	}

	const sourceIndex = compact && !isScrolling ? visibleIndex : lineNumber;

	if (activeLineIndex <= getSyncedLinesBefore()) {
		return sourceIndex - activeLineIndex;
	}

	return sourceIndex - getSyncedLinesBefore();
};

const shouldHideSyncedLine = ({ compact, isScrolling, animationIndex }) => {
	if (compact && isScrolling) {
		return false;
	}

	return (
		(animationIndex < 0 && -animationIndex > getSyncedLinesBefore()) ||
		animationIndex > getSyncedLinesAfter()
	);
};

const LyricsLineContent = react.memo(({
	mainText,
	subText = null,
	subText2 = null,
	originalText = null,
	isKara = false,
	karaokeRenderGranularity = null,
	line = null,
	position = 0,
	isActive = false,
	isCurrentLine = isActive,
	isEffectFocused = isCurrentLine,
	isEffectLive = isActive || isEffectFocused,
	settingsRevision = 0,
	globalCharOffset = 0,
	activeGlobalCharIndex = -1,
	mainCopyText = null,
	mainCopySuccessKey = "notifications.lyricsCopied",
	mainCopyFailureKey = "notifications.lyricsCopyFailed",
	subCopyText = null,
	subCopySuccessKey = "notifications.translationCopied",
	subCopyFailureKey = "notifications.translationCopyFailed",
	subText2CopyText = null,
	subText2CopySuccessKey = "notifications.secondTranslationCopied",
	subText2CopyFailureKey = "notifications.secondTranslationCopyFailed",
	culturalNote = null,
	hiddenFromAccessibility = false,
}) => {
	const mainLine = line || (typeof mainText === "object" ? mainText : {
		text: mainText,
		originalText,
		text2: subText2,
	});
	const displayedCulturalAnnotations = normalizeDisplayedCulturalAnnotations(
		culturalNote || mainLine?.culturalNote
	);
	const culturalAnnotationsByTarget = {
		main: [],
		sub: [],
		sub2: [],
	};
	if (!isKara && !hiddenFromAccessibility) {
		for (const annotation of displayedCulturalAnnotations) {
			const expressionMatches = (value) =>
				typeof value === "string" &&
				annotation.expression &&
				getRubySourceText(value).includes(annotation.expression);
			const target = expressionMatches(mainText)
				? "main"
				: expressionMatches(subText)
					? "sub"
					: expressionMatches(subText2)
						? "sub2"
						: "main";
			culturalAnnotationsByTarget[target].push(annotation);
		}
	}
	const hasParallelKaraokeRows = isKara && hasKaraokeVocalRows(mainLine);
	const interludeInfo = mainLine?.interludeInfo || getInterludeInfo(mainLine);
	const shouldRenderInterlude = interludeInfo.isInterlude;
	const shouldShowInterlude = shouldRenderInterlude && isCurrentLine;

	const mainProps = {
		onContextMenu: createCopyHandler(
			mainCopyText || Utils.formatLyricLineToCopy(mainText, subText, subText2, originalText),
			mainCopySuccessKey,
			mainCopyFailureKey
		),
	};

	const mainHtml = !shouldRenderInterlude && typeof mainText === "string" && !isKara && mainText
		? renderAnnotatedLyricHTML(
			mainText,
			culturalAnnotationsByTarget.main
		)
		: null;

	if (shouldRenderInterlude) {
		mainProps.className = "lyrics-lyricsContainer-LyricsLine-interludeMain";
	} else if (mainHtml) {
		mainProps.dangerouslySetInnerHTML = { __html: mainHtml };
	}

	const mainContent = shouldRenderInterlude
		? (shouldShowInterlude ? react.createElement(InterludeIndicator, {
			durationMs: interludeInfo.durationMs,
			kind: interludeInfo.kind || "break",
			settingsRevision,
		}) : "\u00A0")
		: renderLyricMainContent({
			isKara,
			karaokeRenderGranularity,
			mainText,
			line: mainLine,
			position: isKara ? position : 0,
			isActive,
			isEffectFocused,
			isEffectLive,
			settingsRevision,
			globalCharOffset,
			activeGlobalCharIndex,
			subText,
			subText2,
			culturalAnnotations: displayedCulturalAnnotations,
		});
	return react.createElement(
		react.Fragment,
		null,
		react.createElement(
			"p",
			mainProps,
			mainContent
		),
		!shouldRenderInterlude && !hasParallelKaraokeRows && renderLyricSubLine(
			"lyrics-lyricsContainer-LyricsLine-phonetic",
			subText,
			subCopyText
				? createCopyHandler(subCopyText, subCopySuccessKey, subCopyFailureKey)
				: null,
			culturalAnnotationsByTarget.sub
		),
		!shouldRenderInterlude && !hasParallelKaraokeRows && renderLyricSubLine(
			"lyrics-lyricsContainer-LyricsLine-translation",
			subText2,
			subText2CopyText
				? createCopyHandler(subText2CopyText, subText2CopySuccessKey, subText2CopyFailureKey)
				: null,
			culturalAnnotationsByTarget.sub2
		),
		!shouldRenderInterlude &&
			displayedCulturalAnnotations.map((annotation) => {
				const noteText = `${annotation.marker}. ${annotation.note}`;
				return renderLyricSubLine(
					"lyrics-lyricsContainer-LyricsLine-culturalNote",
					noteText,
					createCopyHandler(
						noteText,
						"notifications.translationCopied",
						"notifications.translationCopyFailed"
					),
					[],
					`cultural-note-${annotation.marker}`
				);
			})
	);
});

const areLyricsLineWrappersEqual = (prev, next) => (
	prev.className === next.className
	&& prev.dir === next.dir
	&& prev.seekTime === next.seekTime
	&& prev.isCurrentLine === next.isCurrentLine
	&& prev.hiddenFromAccessibility === next.hiddenFromAccessibility
	&& prev.isVisualAnchor === next.isVisualAnchor
	&& prev.isVirtualTrailingInterlude === next.isVirtualTrailingInterlude
	&& prev.lineNumber === next.lineNumber
	&& prev.lineRef === next.lineRef
	&& prev.children === next.children
);

const LyricsLineBlock = react.memo(({ className, style, lineRef, dir, seekTime, isCurrentLine, hiddenFromAccessibility, isVisualAnchor, isVirtualTrailingInterlude, lineNumber, children }) => {
	const wrapperRef = useRef(null);
	const assignLineRef = useCallback((node) => {
		wrapperRef.current = node;
		if (typeof lineRef === "function") {
			lineRef(node);
			return;
		}
		if (lineRef) {
			lineRef.current = node;
		}
	}, [lineRef]);
	useEffect(() => {
		const frame = requestAnimationFrame(() => rememberCompactLineLayout(wrapperRef.current));
		return () => cancelAnimationFrame(frame);
	}, [className, isCurrentLine, hiddenFromAccessibility]);

	const handleClick = useCallback(() => {
		if (Number.isFinite(seekTime)) {
			window.Utils?.clearSafePlayerProgressCorrection?.();
			Spicetify.Player.seek(seekTime);
		}
	}, [seekTime]);
	const handleKeyDown = useCallback((event) => {
		if (!Number.isFinite(seekTime) || !["Enter", " ", "Spacebar"].includes(event.key)) return;
		event.preventDefault();
		handleClick();
	}, [handleClick, seekTime]);

	return react.createElement(
		"div",
		{
			className,
			dir,
			ref: assignLineRef,
			"aria-hidden": hiddenFromAccessibility ? true : undefined,
			"data-visual-anchor": isVisualAnchor ? "true" : undefined,
			"data-virtual-trailing-interlude": isVirtualTrailingInterlude ? "true" : undefined,
			"data-line-number": Number.isFinite(lineNumber) ? lineNumber : undefined,
			onClick: !hiddenFromAccessibility && Number.isFinite(seekTime) ? handleClick : null,
			...(!hiddenFromAccessibility && Number.isFinite(seekTime) ? {
				role: "button",
				tabIndex: 0,
				"aria-label": `Seek to ${Math.max(0, Math.round(seekTime / 1000))} seconds`,
				onKeyDown: handleKeyDown,
			} : {}),
		},
		children
	);
}, areLyricsLineWrappersEqual);

const SyncedLyricsLine = react.memo((props) => {
	const {
		className,
		style,
		lineRef = null,
		dir = "auto",
		seekTime = null,
		isCurrentLine = false,
		hiddenFromAccessibility = false,
		isVisualAnchor = false,
		isVirtualTrailingInterlude = false,
		lineNumber = null,
	} = props;
	const mainLine = props.line || (typeof props.mainText === "object" ? props.mainText : {
		text: props.mainText,
		originalText: props.originalText,
		text2: props.subText2,
	});
	const interludeInfo = mainLine?.interludeInfo || getInterludeInfo(mainLine);
	const shouldRenderInterlude = interludeInfo.isInterlude;
	const lineClassName = shouldRenderInterlude
		? `${className} lyrics-lyricsContainer-LyricsLine-interlude`
		: className;

	return react.createElement(
		LyricsLineBlock,
		{
			className: lineClassName,
			lineRef,
			dir,
			seekTime,
			isCurrentLine,
			hiddenFromAccessibility,
			isVisualAnchor,
			isVirtualTrailingInterlude,
			lineNumber,
		},
		react.createElement(LyricsLineContent, props)
	);
});

const renderLyricsItems = ({ items, isKara, karaokeRenderGranularity = null, position = 0, playbackWindows = null, activeGlobalCharIndex = -1, activeLineRef = null, settingsRevision = 0 }) => {

	return items.map((item) => {
		if (item.type === "indicator") {
			return react.createElement(IdlingIndicator, {
				key: item.key,
				isActive: item.isActive,
				delay: item.delay,
				durationMs: item.durationMs,
				settingsRevision,
				lineRef: item.isActive ? activeLineRef : null,
			});
		}

		// position-dependent 값들을 실시간 계산.
		// 비활성 라인은 안정적인 값(completionPosition 또는 0)을 받으므로
		// LyricsLineBlock의 react.memo가 자동으로 리렌더를 스킵합니다.
		let karaokeActive = false;
		let karaokePosition = 0;
		let effectLive = item.effectLiveBase || false;
		let itemActiveGlobalCharIndex = -1;

		if (playbackWindows && item.playbackWindowIndex != null) {
			const playbackState = getSyncedLinePlaybackState(
				playbackWindows[item.playbackWindowIndex],
				position
			);
			const isAnimatingLine = isKara ? playbackState.isAnimating : (item.isAnchorLine || false);
			karaokeActive = isAnimatingLine;
			karaokePosition = isKara ? playbackState.renderPosition : 0;
			effectLive = item.effectLiveBase || (
				!item.effectLiveBase && isAnimatingLine
				&& item.effectFocused !== undefined
			);
			// effectLive 정확한 계산: effectLiveBase(position-independent) OR isAnimatingLine
			// effectLiveBase가 false여도 isAnimatingLine이 true면 effectLive는 true
			effectLive = (item.effectLiveBase || false) || isAnimatingLine;
			// visualAnchorUsesTrailingInterlude가 true인 경우 effectLiveBase는 항상 false이므로
			// isAnimatingLine도 차단되어야 합니다. effectLiveBase가 false이고
			// effectFocused도 false인 경우(= visualAnchorUsesTrailingInterlude가 true)에는
			// isAnimatingLine도 무시합니다.
			if (item.effectFocused === false && !item.effectLiveBase && !item.isAnchorLine) {
				// 일반적인 비활성 라인 — effectLive는 isAnimatingLine에만 의존
				effectLive = isAnimatingLine;
			}
			itemActiveGlobalCharIndex = isAnimatingLine ? activeGlobalCharIndex : -1;
		} else if (item.karaokeActive !== undefined) {
			// 스크롤 모드 등 이전 호환: item에 직접 값이 있는 경우
			karaokeActive = item.karaokeActive || false;
			karaokePosition = item.karaokePosition || 0;
			effectLive = item.effectLive || false;
			itemActiveGlobalCharIndex = item.activeGlobalCharIndex ?? -1;
		}

		return react.createElement(SyncedLyricsLine, {
			key: item.key,
			className: item.className,
			style: item.style,
			lineRef: item.trackLineRef ? activeLineRef : null,
			seekTime: item.canSeek ? item.startTime : null,
			mainText: item.mainText,
			subText: item.subText,
			subText2: item.subText2,
			culturalNote: item.culturalNote,
			originalText: item.originalText,
			isKara,
			karaokeRenderGranularity,
			line: item.line,
			// 비활성 라인: completionPosition(고정값) 또는 0 → react.memo 스킵
			// 활성 라인: live position → 매 프레임 리렌더
			position: karaokePosition,
			isActive: karaokeActive,
			isCurrentLine: item.isActiveLine,
			isEffectFocused: item.effectFocused,
			isEffectLive: effectLive,
			settingsRevision,
			globalCharOffset: item.globalCharOffset,
			activeGlobalCharIndex: itemActiveGlobalCharIndex,
				hiddenFromAccessibility: item.hiddenFromAccessibility === true,
				isVisualAnchor: item.isVisualAnchor === true || item.trackLineRef === true,
				isVirtualTrailingInterlude: item.line?.isVirtualTrailingInterlude === true,
				lineNumber: Number.isFinite(item.line?.lineNumber) ? item.line.lineNumber : item.playbackWindowIndex,
		});
	});
};

const SyncedLyricsScrollView = react.memo(({
	lyrics = [],
	position = 0,
	activeLyricIndex = 0,
	isKara = false,
	activeLineRef = null,
	settingsRevision = 0,
	globalCharOffsets = [],
	activeGlobalCharIndex = -1,
}) => {
	const playbackWindows = useMemo(
		() => buildSyncedLinePlaybackWindows(lyrics, isKara),
		[lyrics, isKara]
	);

	if (!Array.isArray(lyrics) || lyrics.length === 0) {
		return null;
	}

	return react.createElement(
		"div",
		{
			className: `lyrics-lyricsContainer-SyncedScrollView ${isKara ? "is-karaoke" : "is-synced"}`,
		},
		...lyrics.flatMap((line, index) => {
			const { startTime } = line;
			const { text, originalText, text2 } = getEmbeddedAuxiliaryDisplayValues(line);
			const interludeInfo = getInterludeInfo(line, lyrics[index + 1], index, lyrics.length);
			const renderLine = interludeInfo.isInterlude ? { ...line, interludeInfo } : line;
			const isAnchorLine = index === activeLyricIndex;
			const playbackState = getSyncedLinePlaybackState(playbackWindows[index], position);
			const isHighlightedLine = isKara ? playbackState.isHighlighted : isAnchorLine;
			const isAnimatingLine = isKara ? playbackState.isAnimating : isAnchorLine;
			const { mainText, subText, subText2, hasSubLine } = buildLyricDisplayState(
				isKara,
				renderLine,
				text,
				originalText,
				text2
			);

			const trailingInterludeLine = createActiveTrailingKaraokeInterludeLine({
				line: renderLine,
				nextLine: lyrics[index + 1],
				lineIndex: index,
				lineCount: lyrics.length,
				position,
				isActiveLine: isAnchorLine,
				isKara,
			});
			const isOriginalCurrentLine = isHighlightedLine
				&& !(isAnchorLine && trailingInterludeLine);
			const tracksAnchor = isAnchorLine && !trailingInterludeLine;
			const lineNode = react.createElement(LyricsLineBlock, {
				key: `scroll-line-${startTime ?? index}-${index}`,
				className: `lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-scrollView ${getKaraokeLineMetaClass(line)}${hasSubLine ? " lyrics-lyricsContainer-LyricsLine-hasSubLine" : ""}${isOriginalCurrentLine ? " lyrics-lyricsContainer-LyricsLine-active" : ""}${tracksAnchor ? " lyrics-lyricsContainer-LyricsLine-scrollCurrent" : ""}`,
				style: {
					cursor: Number.isFinite(startTime) ? "pointer" : "default",
					...getKaraokeSpeakerStyle(line?.speaker, line?.['speaker-color'], line?.['speaker-fallback']),
				},
				lineRef: tracksAnchor ? activeLineRef : null,
				seekTime: Number.isFinite(startTime) ? startTime : null,
				mainText,
				subText,
				subText2,
				culturalNote: renderLine?.culturalNote,
				originalText,
				isKara,
				line: renderLine,
				position: isKara ? playbackState.renderPosition : 0,
				isActive: isAnimatingLine,
				isCurrentLine: isOriginalCurrentLine,
				isEffectFocused: isOriginalCurrentLine,
				isEffectLive: isAnimatingLine || isOriginalCurrentLine,
				settingsRevision,
				globalCharOffset: globalCharOffsets[index] || 0,
				activeGlobalCharIndex: isAnimatingLine ? activeGlobalCharIndex : -1,
			});

			if (!trailingInterludeLine) {
				return [lineNode];
			}

			return [
				lineNode,
				react.createElement(LyricsLineBlock, {
					key: `scroll-line-trailing-interlude-${index}-${trailingInterludeLine.startTime}`,
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-scrollView lyrics-lyricsContainer-LyricsLine-active",
					style: { cursor: "default" },
					mainText: "",
					subText: null,
					subText2: null,
					originalText: "",
					isKara,
					line: trailingInterludeLine,
					position: 0,
					isActive: false,
					isCurrentLine: true,
					lineRef: activeLineRef,
					settingsRevision,
				})
			];
		})
	);
});

const useSyncedLyricsEngine = ({
	lyrics,
	position,
	compact = false,
	isKara = false,
	containerRef,
  activeLineRef,
  lyricsId,
  settingsRevision = 0,
}) => {
	const leadingEmptyLines = compact ? 2 : 1;
	const { isScrolling, handleContainerClick } = useScrollActivity(
		containerRef,
		[lyricsId]
	);

	const preparedLyrics = useMemo(
		() => buildPreparedSyncedLyrics(lyrics, isKara),
		[lyrics, isKara]
	);

	const paddedLyrics = useMemo(
		() => buildPaddedSyncedLyrics(preparedLyrics, leadingEmptyLines),
		[preparedLyrics, leadingEmptyLines]
	);
	const playbackWindows = useMemo(
		() => buildSyncedLinePlaybackWindows(paddedLyrics, isKara),
		[paddedLyrics, isKara]
	);

	const activeLineIndex = useMemo(
		() => getActiveTimedLineIndex(paddedLyrics, position),
		[paddedLyrics, position]
	);
	const shouldPrecenterKaraokeTransitions = isKara
		&& !isScrolling
		&& CONFIG.visual["karaoke-line-transition"]
		&& !prefersReducedLyricsMotion();
	const visualLineIndex = useMemo(() => {
		return shouldPrecenterKaraokeTransitions
			? getPrecenteredTimedLineIndex(
				paddedLyrics,
				position,
				activeLineIndex,
				LYRICS_CENTERING_LEAD_MS
			)
			: activeLineIndex;
	}, [paddedLyrics, position, activeLineIndex, shouldPrecenterKaraokeTransitions, settingsRevision]);

	const compactDisplayLines = useMemo(() => {
		if (!compact || isScrolling) {
			return paddedLyrics;
		}

		return paddedLyrics
			.filter((line) => shouldIncludeSyncedLineInCompactView(line, activeLineIndex, activeLineIndex))
			.map((line, displayLineNumber) => ({
				...line,
				displayLineNumber,
			}));
	}, [compact, isScrolling, paddedLyrics, activeLineIndex]);

	const activeDisplayLineIndex = useMemo(() => {
		if (!compact || isScrolling) {
			return activeLineIndex;
		}

		const index = compactDisplayLines.findIndex((line) => line.lineNumber === activeLineIndex);
		return index >= 0 ? index : Math.min(activeLineIndex, Math.max(0, compactDisplayLines.length - 1));
	}, [compact, isScrolling, compactDisplayLines, activeLineIndex]);

	const visualDisplayLineIndex = useMemo(() => {
		if (!compact || isScrolling) {
			return visualLineIndex;
		}

		const index = compactDisplayLines.findIndex((line) => line.lineNumber === visualLineIndex);
		return index >= 0 ? index : Math.min(visualLineIndex, Math.max(0, compactDisplayLines.length - 1));
	}, [compact, isScrolling, compactDisplayLines, visualLineIndex]);

	const compactWindowStartIndex = useMemo(() => {
		if (!compact) {
			return 0;
		}

		return Math.max(activeDisplayLineIndex - getSyncedLinesBefore(), 0);
	}, [compact, activeDisplayLineIndex]);

	const linesToRender = useMemo(() => {
		if (!compact || isScrolling) {
			return paddedLyrics;
		}

		return compactDisplayLines;
	}, [compact, isScrolling, paddedLyrics, compactDisplayLines]);
	const visualAnchorLineNumber = activeLineIndex;

	const globalCharTimeline = useMemo(() => {
		if (!isKara || CONFIG.visual["karaoke-bounce"] !== true) {
			return null;
		}

		return prepareGlobalCharTimeline(lyrics);
	}, [lyrics, isKara, CONFIG.visual["karaoke-bounce"], settingsRevision]);

	// globalCharOffsets는 곡 전체에 걸쳐 고정된 값(라인별 누적 글자 수)이므로
	// position과 분리하여 참조 안정성을 확보합니다.
	const globalCharOffsets = useMemo(() => (
		globalCharTimeline ? globalCharTimeline.globalCharOffsets : []
	), [globalCharTimeline]);

	// activeGlobalCharIndex만 position에 따라 매 프레임 변동합니다.
	const activeGlobalCharIndex = useMemo(() => (
		globalCharTimeline
			? queryGlobalCharTimeline(globalCharTimeline, position).activeGlobalCharIndex
			: -1
	), [globalCharTimeline, position]);

	const activeSourceLineIndex = activeLineIndex - leadingEmptyLines;
	const trailingInterludeLine = useMemo(() => (
		activeSourceLineIndex >= 0
			? createActiveTrailingKaraokeInterludeLine({
				line: preparedLyrics[activeSourceLineIndex],
				nextLine: preparedLyrics[activeSourceLineIndex + 1],
				lineIndex: activeSourceLineIndex,
				lineCount: preparedLyrics.length,
				position,
				isActiveLine: true,
				isKara,
				activationAdvanceMs: 0,
			})
			: null
	), [activeSourceLineIndex, preparedLyrics, position, isKara]);
	const isTrailingInterludeActive = !!trailingInterludeLine
		&& trailingInterludeLine.isPrecentered !== true;
	const trailingInterludeKey = trailingInterludeLine
		? `${trailingInterludeLine.startTime}:${trailingInterludeLine.endTime}:${isTrailingInterludeActive ? "active" : "preview"}`
		: "";
	const visualAnchorUsesTrailingInterlude = !!trailingInterludeLine
		&& visualLineIndex === activeLineIndex;

	// Was invoked inline on every render — and position updates trigger a render every
	// frame, so this layout read fired 60 times/sec and forced a synchronous reflow
	// each time. Now scoped to the events that can actually change the offset:
	// active line shifts, scrolling state flips, compact mode toggles.
	const compactOffsetRef = useRef(0);
	const [suppressLayoutShiftAnimation, setSuppressLayoutShiftAnimation] = useState(false);
	const previousPreparedLyricsRef = useRef(preparedLyrics);
	const layoutShiftAnimationFramesRef = useRef({ first: null, second: null });
	const applyCompactOffset = useCallback((nextOffset) => {
		if (!Number.isFinite(nextOffset)) {
			return;
		}
		if (Math.abs(compactOffsetRef.current - nextOffset) < 0.5) {
			return;
		}
		const container = containerRef.current;
		const lineRoot = container?.querySelector?.(".lyrics-lyricsContainer-SyncedLyrics");
		if (lineRoot) {
			lineRoot.style.setProperty("--offset", `${nextOffset}px`);
		}
		if (container) {
			container._ivCompactOffset = nextOffset;
		}
		compactOffsetRef.current = nextOffset;
	}, [containerRef]);
	const syncCompactOffset = useCallback((allowMeasure = false) => {
		if (!compact) {
			applyCompactOffset(0);
			return;
		}

		const container = containerRef.current;
		const activeLine = activeLineRef.current;
		if (!container || !activeLine) return;

		if (allowMeasure) {
			rememberCompactContainerLayout(container);
			container.querySelectorAll?.(".lyrics-lyricsContainer-LyricsLine").forEach(rememberCompactLineLayout);
		}

		const predictedLine = visualAnchorUsesTrailingInterlude
			? activeLine
			: (container.querySelector?.(".lyrics-lyricsContainer-LyricsLine[data-visual-anchor=\"true\"]") || activeLine);
		const nextOffset = getCompactSyncedOffset(container, activeLine, isScrolling, predictedLine, allowMeasure);
		applyCompactOffset(nextOffset);
	}, [applyCompactOffset, compact, containerRef, activeLineRef, isScrolling, visualAnchorUsesTrailingInterlude]);

	useSyncedLayoutEffect(() => {
		const previousPreparedLyrics = previousPreparedLyricsRef.current;
		previousPreparedLyricsRef.current = preparedLyrics;

		const frames = layoutShiftAnimationFramesRef.current;
		const cancelFrame = typeof cancelAnimationFrame === "function"
			? cancelAnimationFrame
			: clearTimeout;
		if (frames.first !== null) cancelFrame(frames.first);
		if (frames.second !== null) cancelFrame(frames.second);
		frames.first = null;
		frames.second = null;

		if (!compact || isScrolling || previousPreparedLyrics === preparedLyrics) {
			setSuppressLayoutShiftAnimation(false);
			return undefined;
		}

		setSuppressLayoutShiftAnimation(true);
		const requestFrame = typeof requestAnimationFrame === "function"
			? requestAnimationFrame
			: (callback) => setTimeout(callback, 0);
		frames.first = requestFrame(() => {
			frames.first = null;
			frames.second = requestFrame(() => {
				frames.second = null;
				setSuppressLayoutShiftAnimation(false);
			});
		});

		return () => {
			if (frames.first !== null) cancelFrame(frames.first);
			if (frames.second !== null) cancelFrame(frames.second);
			frames.first = null;
			frames.second = null;
		};
	}, [compact, isScrolling, preparedLyrics]);

	useEffect(() => {
		if (isScrolling) {
			return undefined;
		}
		const container = containerRef.current;
		const lineRoot = container?.querySelector?.(".lyrics-lyricsContainer-SyncedLyrics");
		if (!lineRoot) {
			return undefined;
		}
		const visualIndex = compact ? visualDisplayLineIndex : visualLineIndex;
		const windowStart = compact
			? Math.max(visualIndex - getSyncedLinesBefore(), 0)
			: 0;
		const hasTrailingInterlude = !!trailingInterludeLine;
		const duration = suppressLayoutShiftAnimation
			? "0s"
			: "var(--iv-lyrics-centering-duration, 300ms)";
		const predictedLine = compact
			? (lineRoot.querySelector(`[data-line-number="${visualLineIndex}"]`)
				|| lineRoot.querySelector(".lyrics-lyricsContainer-LyricsLine[data-visual-anchor=\"true\"]")
				|| activeLineRef.current)
			: activeLineRef.current;
		// Measure the destination line now and apply --offset in the same turn as
		// --position-index. Splitting those writes is what caused the small bump,
		// freeze, then teleport.
		const nextOffset = compact
			? getCompactSyncedOffset(container, activeLineRef.current, false, predictedLine, true)
			: 0;
		const offsetValue = `${nextOffset}px`;
		lineRoot.querySelectorAll(":scope > .lyrics-lyricsContainer-LyricsLine").forEach((lineEl, visibleIndex) => {
			const isVirtualTrailingInterlude = lineEl.dataset.virtualTrailingInterlude === "true";
			const lineNumber = Number(lineEl.dataset.lineNumber);
			const sourceIndex = Number.isFinite(lineNumber) ? lineNumber : visibleIndex;
			const compactVisibleIndex = sourceIndex - windowStart;
			let animationIndex;
			if (isVirtualTrailingInterlude) {
				animationIndex = visualAnchorUsesTrailingInterlude ? 0 : -1;
			} else {
				animationIndex = getSyncedAnimationIndex({
					compact,
					isScrolling,
					activeLineIndex: visualIndex,
					lineNumber: sourceIndex,
					visibleIndex: compactVisibleIndex,
				});
				if (hasTrailingInterlude && Number.isFinite(lineNumber) && lineNumber <= activeLineIndex) {
					animationIndex -= 1;
				}
			}
			const positionValue = String(animationIndex);
			if (lineEl.style.getPropertyValue("--position-index") !== positionValue) {
				lineEl.style.setProperty("--position-index", positionValue);
				lineEl.style.setProperty("--animation-index", String(Math.abs(animationIndex) + 1));
				lineEl.style.setProperty("--blur-index", String(Math.min(Math.abs(animationIndex), 3)));
				// 전체 화면 CSS가 이전 줄과 다음 줄을 다르게 그릴 수 있도록 상대 위치를 남긴다.
				lineEl.dataset.lineRelation = animationIndex < 0 ? "before" : (animationIndex > 0 ? "after" : "current");
			}
			if (lineEl.style.getPropertyValue("--offset") !== offsetValue) {
				lineEl.style.setProperty("--offset", offsetValue);
			}
			if (lineEl.style.getPropertyValue("--line-shift-duration") !== duration) {
				lineEl.style.setProperty("--line-shift-duration", duration);
			}
		});
		if (compact) {
			applyCompactOffset(nextOffset);
		}
		return undefined;
	}, [compact, isScrolling, visualLineIndex, visualDisplayLineIndex, activeLineIndex, trailingInterludeKey, suppressLayoutShiftAnimation, containerRef, activeLineRef, applyCompactOffset]);

	useEffect(() => {
		if (!compact || isScrolling) {
			return undefined;
		}
		const container = containerRef.current;
		if (!container || typeof ResizeObserver === "undefined") {
			return undefined;
		}
		const raf = typeof requestAnimationFrame === "function"
			? requestAnimationFrame
			: (callback) => setTimeout(callback, 0);
		const cancelRaf = typeof cancelAnimationFrame === "function"
			? cancelAnimationFrame
			: clearTimeout;
		let frameId = null;
		const scheduleOffsetSync = () => {
			if (frameId !== null) {
				cancelRaf(frameId);
			}
			frameId = raf(() => {
				frameId = null;
				syncCompactOffset(true);
			});
		};
		const observer = new ResizeObserver(scheduleOffsetSync);
		observer.observe(container);
		return () => {
			observer.disconnect();
			if (frameId !== null) {
				cancelRaf(frameId);
			}
		};
	}, [compact, isScrolling, lyricsId, preparedLyrics, settingsRevision, syncCompactOffset]);

	useEffect(() => {
		const actualIndex = Math.max(0, activeLineIndex - leadingEmptyLines);
		window.dispatchEvent(new CustomEvent("ivLyrics:lyric-index-changed", {
			detail: { index: actualIndex, total: lyrics.length }
		}));
	}, [activeLineIndex, leadingEmptyLines, lyrics.length]);

	const hasAutoScrolledRef = useRef(false);
	useEffect(() => {
		hasAutoScrolledRef.current = false;
	}, [lyricsId]);

	useEffect(() => {
		if (compact) {
			return undefined;
		}

		const container = containerRef.current;
		const activeLine = activeLineRef.current;
		if (!container || !activeLine || isScrolling) {
			return undefined;
		}

		if (!hasAutoScrolledRef.current || isInViewport(activeLine)) {
			scrollSyncedContainerToActiveLine(container, activeLine, hasAutoScrolledRef.current ? "smooth" : "auto");
			hasAutoScrolledRef.current = true;
		}

		return undefined;
	}, [compact, visualLineIndex, isScrolling, containerRef, activeLineRef, trailingInterludeKey, preparedLyrics]);

	useEffect(() => {
		if (compact || !isScrolling || !activeLineRef.current) {
			return undefined;
		}

		const timeoutId = setTimeout(() => {
			scrollSyncedContainerToActiveLine(containerRef.current, activeLineRef.current, "auto");
		}, 0);

		return () => clearTimeout(timeoutId);
	}, [compact, activeLineIndex, isScrolling, containerRef, activeLineRef, trailingInterludeKey, preparedLyrics]);

	useEffect(() => {
		if (compact || isScrolling || typeof ResizeObserver === "undefined") {
			return undefined;
		}

		const container = containerRef.current;
		const activeLine = activeLineRef.current;
		if (!container || !activeLine) {
			return undefined;
		}

		const raf = typeof requestAnimationFrame === "function"
			? requestAnimationFrame
			: (callback) => setTimeout(callback, 0);
		const cancelRaf = typeof cancelAnimationFrame === "function"
			? cancelAnimationFrame
			: clearTimeout;
		let frameId = null;
		const scheduleScrollSync = () => {
			if (frameId !== null) {
				cancelRaf(frameId);
			}
			frameId = raf(() => {
				frameId = null;
				scrollSyncedContainerToActiveLine(containerRef.current, activeLineRef.current, "sync");
			});
		};

		const observer = new ResizeObserver(scheduleScrollSync);
		observer.observe(activeLine);
		observer.observe(container);
		let mutationObserver = null;
		if (typeof MutationObserver !== "undefined") {
			mutationObserver = new MutationObserver(scheduleScrollSync);
			mutationObserver.observe(activeLine, {
				attributes: true,
				attributeFilter: [
					"data-karaoke-vocal-anchor-position",
					"data-karaoke-vocal-anchor-window-ms",
				],
				subtree: true,
			});
		}

		return () => {
			observer.disconnect();
			if (mutationObserver) {
				mutationObserver.disconnect();
			}
			if (frameId !== null) {
				cancelRaf(frameId);
			}
		};
	}, [compact, isScrolling, visualLineIndex, trailingInterludeKey, containerRef, activeLineRef, preparedLyrics]);

	const stableLineStyles = useMemo(() => {
		if (compact && isScrolling) {
			return null;
		}

		const hasTrailingInterlude = !!trailingInterludeLine;
		return linesToRender.map((line, visibleIndex) => {
			const {
				lineNumber = visibleIndex,
				displayLineNumber = lineNumber,
			} = line;
			const compactVisibleIndex = compact
				? displayLineNumber - compactWindowStartIndex
				: visibleIndex;
			let animationIndex = getSyncedAnimationIndex({
				compact,
				isScrolling,
				activeLineIndex: compact && !isScrolling ? activeDisplayLineIndex : activeLineIndex,
				lineNumber: compact && !isScrolling ? displayLineNumber : lineNumber,
				visibleIndex: compactVisibleIndex,
			});
			if (hasTrailingInterlude && lineNumber <= activeLineIndex) {
				animationIndex -= 1;
			}

			return {
				cursor: "pointer",
				...getKaraokeSpeakerStyle(line?.speaker, line?.['speaker-color'], line?.['speaker-fallback']),
			};
		});
	}, [
		linesToRender,
		compact,
		isScrolling,
		activeLineIndex,
		compactWindowStartIndex,
		trailingInterludeKey,
		suppressLayoutShiftAnimation,
		settingsRevision,
	]);
	const renderItems = useMemo(() => {
		if (compact && isScrolling) {
			const activePreparedIndex = Math.max(0, activeLineIndex - leadingEmptyLines);

			return preparedLyrics
				.map((line, index) => ({ line, index }))
				.filter(({ line, index }) => !line?.interludeInfo?.isInterlude || index === activePreparedIndex)
				.flatMap(({ line, index }) => {
					const { startTime, originalText, mainText, subText, subText2, hasSubLine } = line;
					const isAnchorLine = index === activePreparedIndex;
					const tracksAnchor = isAnchorLine && !trailingInterludeLine;
					const item = {
						type: "line",
						key: `scroll-inline-${startTime ?? index}-${index}`,
						className: `lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-scrollView ${getKaraokeLineMetaClass(line)}${hasSubLine ? " lyrics-lyricsContainer-LyricsLine-hasSubLine" : ""}${isAnchorLine ? " lyrics-lyricsContainer-LyricsLine-active" : ""}${tracksAnchor ? " lyrics-lyricsContainer-LyricsLine-scrollCurrent" : ""}`,
						style: {
							cursor: Number.isFinite(startTime) ? "pointer" : "default",
							...getKaraokeSpeakerStyle(line?.speaker, line?.['speaker-color'], line?.['speaker-fallback']),
						},
						line,
						startTime,
						originalText,
						mainText,
						subText,
						subText2,
						isActiveLine: isAnchorLine,
						trackLineRef: tracksAnchor,
						canSeek: Number.isFinite(startTime),
						playbackWindowIndex: index + leadingEmptyLines,
						isAnchorLine,
						effectFocused: isAnchorLine,
						effectLiveBase: isAnchorLine,
						globalCharOffset: globalCharOffsets[index] || 0,
					};

					if (!trailingInterludeLine || !isAnchorLine) {
						return [item];
					}

					return [
						item,
						{
							type: "line",
							key: `scroll-inline-trailing-interlude-${index}-${trailingInterludeLine.startTime}`,
							className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-scrollView lyrics-lyricsContainer-LyricsLine-active",
							style: { cursor: "default" },
							line: trailingInterludeLine,
							startTime: trailingInterludeLine.startTime,
							originalText: "",
							mainText: "",
							subText: null,
							subText2: null,
							isActiveLine: true,
							trackLineRef: visualAnchorUsesTrailingInterlude,
							canSeek: false,
							karaokeActive: false,
							effectFocused: false,
							effectLive: false,
							globalCharOffset: 0,
							activeGlobalCharIndex: -1,
						}
					];
				});
		}

		return linesToRender.flatMap((line, visibleIndex) => {
			const {
				lineNumber = visibleIndex,
				displayLineNumber = lineNumber,
				startTime,
				originalText,
				mainText,
				subText,
				subText2,
			} = line;
			const compactVisibleIndex = compact
				? displayLineNumber - compactWindowStartIndex
				: visibleIndex;

			if (compact && lineNumber === 1 && activeLineIndex <= leadingEmptyLines) {
				const firstLyricStartTime = lyrics[0]?.startTime || 1;
				if (position < firstLyricStartTime) {
					return {
						type: "indicator",
						key: `compact-idling-${lineNumber}`,
						delay: firstLyricStartTime / 3,
						durationMs: firstLyricStartTime,
						isActive: true,
					};
				}
			}

			if (!compact && lineNumber === 0) {
				const nextStartTime = paddedLyrics[1]?.startTime || 1;
				return {
					type: "indicator",
					key: `expanded-idling-${lineNumber}`,
					delay: nextStartTime / 3,
					durationMs: nextStartTime,
					isActive: activeLineIndex === 0,
				};
			}

			const isAnchorLine = lineNumber === activeLineIndex;
			let animationIndex = getSyncedAnimationIndex({
				compact,
				isScrolling,
				activeLineIndex: compact && !isScrolling ? activeDisplayLineIndex : activeLineIndex,
				lineNumber: compact && !isScrolling ? displayLineNumber : lineNumber,
				visibleIndex: compactVisibleIndex,
			});
			if (trailingInterludeLine && lineNumber <= activeLineIndex) {
				animationIndex -= 1;
			}
			const visibilityAnimationIndex = compact && !isScrolling
				? displayLineNumber - activeDisplayLineIndex
				: lineNumber - activeLineIndex;
			let className = `lyrics-lyricsContainer-LyricsLine ${getKaraokeLineMetaClass(line)}`;
			// activeLineIndex 기반으로 하이라이트 결정 (position-independent).
			// activeLineIndex는 라인 전환 시에만 변경되므로 renderItems의 안정성 확보.
			const isCurrentRenderedLine = isAnchorLine
				&& !(isAnchorLine && isTrailingInterludeActive);
			if (isCurrentRenderedLine) {
				className += " lyrics-lyricsContainer-LyricsLine-active";
			}
			const isOutsideVisibleRange = !isAnchorLine
				&& lineNumber !== visualAnchorLineNumber
				&& shouldHideSyncedLine({
					compact,
					isScrolling,
					animationIndex: visibilityAnimationIndex,
				});
			if (isOutsideVisibleRange) {
				className += " lyrics-lyricsContainer-LyricsLine-paddingLine";
				className += visibilityAnimationIndex < 0
					? " lyrics-lyricsContainer-LyricsLine-paddingBefore"
					: " lyrics-lyricsContainer-LyricsLine-paddingAfter";
			}

			const item = {
				type: "line",
				key: lineNumber,
				className,
				style: stableLineStyles[visibleIndex],
				line,
				startTime,
				originalText,
				mainText,
				subText,
				subText2,
				isActiveLine: isCurrentRenderedLine,
				trackLineRef: !visualAnchorUsesTrailingInterlude && lineNumber === visualAnchorLineNumber,
                isVisualAnchor: !visualAnchorUsesTrailingInterlude && lineNumber === visualAnchorLineNumber,
				canSeek: lineNumber >= leadingEmptyLines && Number.isFinite(startTime),
				// position-dependent 필드들은 renderLyricsItems에서 실시간 계산.
				// playbackWindowIndex로 해당 라인의 playbackWindow를 참조합니다.
				playbackWindowIndex: lineNumber,
				isAnchorLine,
				effectFocused: !visualAnchorUsesTrailingInterlude
					&& lineNumber === visualAnchorLineNumber,
				// effectLive의 position-independent 부분만 미리 계산
				effectLiveBase: !visualAnchorUsesTrailingInterlude
					&& (lineNumber === activeLineIndex || lineNumber === visualAnchorLineNumber),
				globalCharOffset: lineNumber >= leadingEmptyLines && lineNumber - leadingEmptyLines < globalCharOffsets.length
					? globalCharOffsets[lineNumber - leadingEmptyLines]
					: 0,
				hiddenFromAccessibility: isOutsideVisibleRange,
			};

			if (!trailingInterludeLine || lineNumber !== activeLineIndex) {
				return [item];
			}

			const virtualAnimationIndex = visualAnchorUsesTrailingInterlude ? 0 : -1;
			return [
				item,
				{
					type: "line",
					key: `trailing-interlude-${lineNumber}-${trailingInterludeLine.startTime}`,
					className: `lyrics-lyricsContainer-LyricsLine${isTrailingInterludeActive ? " lyrics-lyricsContainer-LyricsLine-active" : ""}`,
					style: {
						cursor: "default",
					},
					line: trailingInterludeLine,
					startTime: trailingInterludeLine.startTime,
					originalText: "",
					mainText: "",
					subText: null,
					subText2: null,
					isActiveLine: isTrailingInterludeActive,
					trackLineRef: visualAnchorUsesTrailingInterlude,
					canSeek: false,
					karaokeActive: false,
					effectFocused: false,
					effectLive: false,
					globalCharOffset: 0,
					activeGlobalCharIndex: -1,
				}
			];
		});
	}, [
		linesToRender,
		compact,
		activeLineIndex,
		leadingEmptyLines,
		lyrics,
		preparedLyrics,
		paddedLyrics,
		playbackWindows,
		// position은 의존성에서 제거 — position-dependent 계산은 renderLyricsItems에서 수행.
		// 이를 통해 renderItems는 activeLineIndex 전환 시에만 재생성됩니다.
		isScrolling,
		isKara,
		activeDisplayLineIndex,
		compactWindowStartIndex,
		visualAnchorLineNumber,
		visualAnchorUsesTrailingInterlude,
		trailingInterludeKey,
		isTrailingInterludeActive,
		globalCharOffsets,
		stableLineStyles,
		suppressLayoutShiftAnimation,
		settingsRevision,
	]);

	return {
		isScrolling,
		handleContainerClick,
		renderItems,
		playbackWindows,
		activeLineIndex,
		activeLyricIndex: Math.max(0, activeLineIndex - leadingEmptyLines),
		globalCharOffsets,
		activeGlobalCharIndex,
	};
};

// Global animation manager to prevent multiple instances
const AnimationManager = {
	active: false,
	frameId: null,
	timerId: null,
	callbacks: new Set(),
	lastTime: 0,
	targetFPS: DEFAULT_TRACK_POSITION_FPS,
	boundAnimate: null,

	updateFrameInterval() {
		this.targetFPS = getTrackPositionFPS();
		this.frameInterval = 1000 / this.targetFPS;
	},

	start() {
		if (this.active) return;
		this.active = true;
		this.lastTime = 0;
		this.updateFrameInterval();
		// bind를 한 번만 수행하여 메모리 효율성 개선
		if (!this.boundAnimate) {
			this.boundAnimate = this.animate.bind(this);
		}
		this.scheduleNext(false);
	},

	scheduleNext(settingsOpen) {
		if (!this.active) return;

		if (!document.hidden && !settingsOpen && typeof requestAnimationFrame === "function") {
			this.frameId = requestAnimationFrame(this.boundAnimate);
			return;
		}

		this.timerId = setTimeout(
			this.boundAnimate,
			document.hidden || settingsOpen ? 250 : this.frameInterval
		);
	},

	stop() {
		if (this.frameId !== null) {
			cancelAnimationFrame(this.frameId);
			this.frameId = null;
		}
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
		this.active = false;
		this.lastTime = 0;
	},

	addCallback(callback) {
		this.callbacks.add(callback);
		this.start();
	},

	removeCallback(callback) {
		this.callbacks.delete(callback);
		if (this.callbacks.size === 0) {
			this.stop();
		}
	},

	animate(timestamp) {
		if (!this.active) return;
		this.frameId = null;
		this.timerId = null;

		const settingsOpen = document.documentElement.classList.contains("ivlyrics-settings-open")
			|| document.body?.classList.contains("ivlyrics-settings-open");
		this.updateFrameInterval();
		if (document.hidden || settingsOpen) {
			this.lastTime = 0;
			this.scheduleNext(settingsOpen);
			return;
		}

		const now = Number.isFinite(timestamp) ? timestamp : performance.now();
		const elapsed = this.lastTime > 0 ? now - this.lastTime : Infinity;
		// requestAnimationFrame timestamps can land a fraction below the nominal
		// interval (16.666 ms vs 16.667 ms). A small tolerance prevents an
		// accidental drop from 60 to 30 fps while still honoring lower FPS limits.
		if (elapsed >= this.frameInterval - 1) {
			for (const callback of this.callbacks) {
				try {
					callback();
				} catch (error) {
					// Error ignored
				}
			}

			this.lastTime = elapsed >= this.frameInterval && Number.isFinite(elapsed)
				? now - (elapsed % this.frameInterval)
				: now;
		}
		this.scheduleNext(false);
	}
};

// Enhanced visibility change manager to prevent duplicate listeners (최적화 #8 - 메모리 누수 수정)
const VisibilityManager = {
	listeners: new Set(),
	isListening: false,
	boundHandler: null,

	init() {
		// bind()로 생성된 함수 참조를 저장하여 제거 가능하게 함
		this.boundHandler = this.handleVisibilityChange.bind(this);
	},

	addListener(callback) {
		if (!this.boundHandler) this.init();

		this.listeners.add(callback);
		if (!this.isListening) {
			document.addEventListener('visibilitychange', this.boundHandler);
			this.isListening = true;
		}
	},

	removeListener(callback) {
		this.listeners.delete(callback);
		if (this.listeners.size === 0 && this.isListening) {
			document.removeEventListener('visibilitychange', this.boundHandler);
			this.isListening = false;
		}
	},

	handleVisibilityChange() {
		const isVisible = !document.hidden;
		this.listeners.forEach(callback => {
			try {
				callback(isVisible);
			} catch (error) {
				// Error ignored
			}
		});
	}
};

// Expose managers globally for performance monitoring
if (typeof window !== 'undefined') {
	window.AnimationManager = AnimationManager;
	window.VisibilityManager = VisibilityManager;
}

const useTrackPosition = (callback) => {
	const callbackRef = useRef();
	const mountedRef = useRef(true);
	const isActiveRef = useRef(true);

	callbackRef.current = callback;

	useEffect(() => {
		// Component mounted
		mountedRef.current = true;
		isActiveRef.current = true;

		const wrappedCallback = () => {
			if (mountedRef.current && isActiveRef.current && callbackRef.current) {
				callbackRef.current();
			}
		};

		// Add to global animation manager
		AnimationManager.addCallback(wrappedCallback);
		wrappedCallback();

		// Add visibility listener
		const visibilityCallback = (isVisible) => {
			if (mountedRef.current) {
				isActiveRef.current = isVisible;
			}
		};
		VisibilityManager.addListener(visibilityCallback);

		return () => {
			// Component unmounting
			mountedRef.current = false;
			isActiveRef.current = false;
			AnimationManager.removeCallback(wrappedCallback);
			VisibilityManager.removeListener(visibilityCallback);
		};
	}, []);
};

const getKaraokeLineBounds = (line) => {
	const syllables = getTimedSyllablesFromLine(line);
	if (syllables.length === 0) {
		const startTime = Number.isFinite(line?.startTime) ? line.startTime : 0;
		const endTime = Number.isFinite(line?.endTime) ? line.endTime : startTime;
		return { startTime, endTime };
	}

	let startTime = Infinity;
	let endTime = -Infinity;

	for (const syllable of syllables) {
		if (!syllable) continue;
		const syllableStart = Number.isFinite(syllable.startTime) ? syllable.startTime : null;
		const syllableEnd = Number.isFinite(syllable.endTime) ? syllable.endTime : syllableStart;

		if (syllableStart !== null) {
			startTime = Math.min(startTime, syllableStart);
			endTime = Math.max(endTime, syllableEnd ?? syllableStart);
		}
	}

	if (!Number.isFinite(startTime)) {
		startTime = Number.isFinite(line?.startTime) ? line.startTime : 0;
	}
	if (!Number.isFinite(endTime)) {
		endTime = Number.isFinite(line?.endTime) ? line.endTime : startTime;
	}

	return { startTime, endTime };
};

const buildKaraokeFuriganaMap = (processedText) => {
	const furiganaMap = new Map();
	if (typeof processedText !== "string" || !processedText.includes("<ruby>")) {
		return furiganaMap;
	}

	const rubyRegex = /<ruby>([^<]+)<rt>([^<]+)<\/rt><\/ruby>/g;
	let currentPos = 0;
	let lastMatchEnd = 0;
	let match;

	rubyRegex.lastIndex = 0;

	while ((match = rubyRegex.exec(processedText)) !== null) {
		const kanjiSequence = match[1];
		const reading = match[2];
		const beforeMatch = processedText.substring(lastMatchEnd, match.index);
		const plainTextBefore = beforeMatch.replace(/<[^>]+>/g, "");
		currentPos += splitKaraokeGraphemes(plainTextBefore, "ja").length;

		const kanjiChars = splitKaraokeGraphemes(kanjiSequence, "ja");
		if (kanjiChars.length === 1) {
			furiganaMap.set(currentPos, reading);
		} else {
			const readingChars = splitKaraokeGraphemes(reading, "ja");
			const charsPerKanji = Math.max(1, Math.floor(readingChars.length / kanjiChars.length));
			kanjiChars.forEach((_, idx) => {
				const nextReading = idx === kanjiChars.length - 1
					? readingChars.slice(idx * charsPerKanji).join("")
					: readingChars.slice(idx * charsPerKanji, (idx + 1) * charsPerKanji).join("");
				furiganaMap.set(currentPos + idx, nextReading);
			});
		}

		currentPos += kanjiChars.length;
		lastMatchEnd = match.index + match[0].length;
	}

	return furiganaMap;
};

const buildKaraokeTimedChars = (line) => {
	const timedChars = [];
	const sourceSyllables = getTimedSyllablesFromLine(line);
	const lyricsLocale = String(window.Utils?.getDetectedLanguage?.() || "auto");

	if (sourceSyllables.length > 0) {
		sourceSyllables.forEach((syllable, karaokeUnitIndex) => {
			if (!syllable || !syllable.text) return;

			const charArray = splitKaraokeGraphemes(syllable.text || "", lyricsLocale);
			const syllableStart = Number.isFinite(syllable.startTime) ? syllable.startTime : (line.startTime || 0);
			const syllableEnd = Number.isFinite(syllable.endTime) ? syllable.endTime : syllableStart + 500;
			const charDuration = Math.max(1, (syllableEnd - syllableStart) / Math.max(1, charArray.length));

			charArray.forEach((char, charIndex) => {
				const charStart = syllableStart + (charIndex * charDuration);
				timedChars.push({
					char,
					startTime: charStart,
					endTime: charStart + charDuration,
					karaokeUnitIndex,
					...(syllable.inlineStyle === true ? {
						inlineStyle: true,
						styleKind: syllable.styleKind || '',
						styleSpeaker: syllable.styleSpeaker || '',
						styleSpeakerColor: syllable.styleSpeakerColor || '',
						styleSpeakerFallback: syllable.styleSpeakerFallback || ''
					} : null),
				});
			});
		});
	}

	if (timedChars.length > 0) {
		// Some providers emit a base letter and its combining mark as separate
		// timed syllables. Re-segment the complete line so those boundaries cannot
		// detach Arabic harakat, Thai tone marks, Indic vowel signs, or ZWJ emoji.
		return coalesceKaraokeTimedGraphemes(timedChars, lyricsLocale);
	}

	const fallbackChars = splitKaraokeGraphemes(getCopyableText(line?.text) || "", lyricsLocale);
	const { startTime, endTime } = getKaraokeLineBounds(line);
	const totalDuration = Math.max(1, endTime - startTime || 500);
	const charDuration = Math.max(1, totalDuration / Math.max(1, fallbackChars.length || 1));

	return fallbackChars.map((char, index) => ({
		char,
		startTime: startTime + (index * charDuration),
		endTime: startTime + ((index + 1) * charDuration),
		karaokeUnitIndex: index,
	}));
};

const applyKaraokeWhitespaceCompensation = (timedChars) => {
	if (!Array.isArray(timedChars) || timedChars.length < 2) {
		return timedChars;
	}

	let didChange = false;
	const compensatedChars = timedChars.map((charInfo, index) => {
		const nextCharInfo = timedChars[index + 1];
		if (!nextCharInfo) {
			return charInfo;
		}

		const currentChar = charInfo?.char || "";
		const nextChar = nextCharInfo?.char || "";
		const duration = Math.max(0, (charInfo?.endTime || 0) - (charInfo?.startTime || 0));
		const nextCharDuration = Math.max(0, (nextCharInfo?.endTime || 0) - (nextCharInfo?.startTime || 0));
		const isPreWhitespaceChar = currentChar && !/\s/u.test(currentChar) && /\s/u.test(nextChar);

		if (!isPreWhitespaceChar || duration >= KARAOKE_PRE_SPACE_MIN_DURATION_MS) {
			return charInfo;
		}

		const compensatedDuration = Math.max(
			KARAOKE_PRE_SPACE_MIN_DURATION_MS,
			Math.min(
				KARAOKE_PRE_SPACE_MAX_DURATION_MS,
				nextCharDuration * KARAOKE_PRE_SPACE_NEXT_CHAR_RATIO
			)
		);

		didChange = true;
		return {
			...charInfo,
			endTime: charInfo.startTime + compensatedDuration,
		};
	});

	return didChange ? compensatedChars : timedChars;
};

const getActiveKaraokeTimedCharIndex = (timedChars, position) => {
  if (!Array.isArray(timedChars) || timedChars.length === 0) {
          return -1;
  }

	let activeCharIndex = -1;
	let lastPassedCharIndex = -1;
	let lastPassedCharEndTime = 0;
	let lastPassedCharDuration = 100;
	const timedCharCount = timedChars.length;

	for (let index = 0; index < timedCharCount; index++) {
		const charInfo = timedChars[index];
		const charStart = Number.isFinite(charInfo?.karaokeFillStartTime)
			? charInfo.karaokeFillStartTime
			: (Number.isFinite(charInfo?.startTime) ? charInfo.startTime : 0);
		const charEnd = Number.isFinite(charInfo?.karaokeFillEndTime)
			? charInfo.karaokeFillEndTime
			: (Number.isFinite(charInfo?.endTime) ? charInfo.endTime : charStart);

		if (position >= charStart && position < charEnd) {
			activeCharIndex = index;
		}

		if (position >= charEnd && charEnd > lastPassedCharEndTime) {
			lastPassedCharEndTime = charEnd;
			lastPassedCharIndex = index;
			lastPassedCharDuration = Math.max(1, charEnd - charStart) || 100;
		}
	}

	if (activeCharIndex === -1 && lastPassedCharIndex !== -1) {
		const timeDiff = position - lastPassedCharEndTime;
		const simulateDuration = Math.max(40, lastPassedCharDuration * 0.01);
		const virtualProgress = Math.floor(timeDiff / simulateDuration);

		if (timeDiff < 2000) {
			activeCharIndex = lastPassedCharIndex + 1 + virtualProgress;
		}
	}

  return activeCharIndex;
};

const KARAOKE_VOCAL_STACK_CENTER_THRESHOLD = 4;

const buildKaraokeVocalRowLine = (line, row) => ({
  ...line,
  text: row.text,
  originalText: row.text,
  syllables: row.syllables,
  vocals: undefined,
  speaker: row.speaker,
  'speaker-color': row.speakerColor,
  'speaker-fallback': row.speakerFallback,
  kind: row.kind,
});

const buildKaraokeVocalRowRenderData = (line, row, includeBounds) => {
	const rowLine = buildKaraokeVocalRowLine(line, row);
	const timedChars = applyKaraokeWhitespaceCompensation(buildKaraokeTimedChars(rowLine));
	return {
		line: rowLine,
		timedChars,
		bounds: includeBounds ? getKaraokeLineBounds(rowLine) : null,
	};
};

const getKaraokeVocalAnchorLineKey = (line) => [
  line?.startTime ?? "",
  line?.endTime ?? "",
  getCopyableText(line?.originalText ?? line?.text ?? ""),
].join("|");

const getKaraokeVocalAnchorPosition = (vocalRowRenderData, position) => {
  if (!Array.isArray(vocalRowRenderData) || vocalRowRenderData.length === 0 || !Number.isFinite(position)) {
          return -1;
  }

  let firstActiveRowIndex = -1;
  let lastActiveRowIndex = -1;

  for (let rowIndex = 0; rowIndex < vocalRowRenderData.length; rowIndex++) {
          const { timedChars: rowTimedChars, bounds } = vocalRowRenderData[rowIndex];
          const activeCharIndex = getActiveKaraokeTimedCharIndex(rowTimedChars, position);
          const { startTime, endTime } = bounds;
          const rowActive = (activeCharIndex >= 0 && activeCharIndex < rowTimedChars.length)
                  || (position >= startTime && position <= endTime);

          if (rowActive) {
                  if (firstActiveRowIndex < 0) {
                          firstActiveRowIndex = rowIndex;
                  }
                  lastActiveRowIndex = rowIndex;
          }
  }

  if (firstActiveRowIndex >= 0 && lastActiveRowIndex >= 0) {
          return Math.ceil((firstActiveRowIndex + lastActiveRowIndex) / 2);
  }

  return -1;
};

const getKaraokeVocalAnchorWindowMs = (vocalRowRenderData, anchorPosition) => {
	if (
		!Array.isArray(vocalRowRenderData)
		|| vocalRowRenderData.length < 2
		|| !Number.isFinite(anchorPosition)
		|| anchorPosition < 0
	) {
		return null;
	}

	const anchorIndex = Math.max(
		0,
		Math.min(vocalRowRenderData.length - 1, Math.round(anchorPosition))
	);
	const anchorStartTime = toFiniteTime(vocalRowRenderData[anchorIndex]?.bounds?.startTime);
	if (anchorStartTime === null) {
		return null;
	}

	for (let rowIndex = anchorIndex + 1; rowIndex < vocalRowRenderData.length; rowIndex++) {
		const nextStartTime = toFiniteTime(vocalRowRenderData[rowIndex]?.bounds?.startTime);
		if (nextStartTime !== null && nextStartTime > anchorStartTime) {
			return nextStartTime - anchorStartTime;
		}
	}

	return null;
};

const getStableKaraokeVocalAnchorPosition = (stateRef, line, position, nextAnchorPosition) => {
  if (!stateRef?.current) {
          return nextAnchorPosition;
  }

  const lineKey = getKaraokeVocalAnchorLineKey(line);
  const state = stateRef.current;
  const positionWentBack = Number.isFinite(state.lastPlaybackPosition)
          && Number.isFinite(position)
          && position < state.lastPlaybackPosition - 250;

  if (state.lineKey !== lineKey || positionWentBack) {
          state.lineKey = lineKey;
          state.anchorPosition = nextAnchorPosition;
          state.lastPlaybackPosition = position;
          return nextAnchorPosition;
  }

  state.lastPlaybackPosition = position;
  if (!Number.isFinite(nextAnchorPosition) || nextAnchorPosition < 0) {
          return Number.isFinite(state.anchorPosition) ? state.anchorPosition : -1;
  }

  state.anchorPosition = Math.max(
          Number.isFinite(state.anchorPosition) ? state.anchorPosition : nextAnchorPosition,
          nextAnchorPosition
  );
  return state.anchorPosition;
};

const KARAOKE_FILL_STEPS = 25;
const KARAOKE_BOUNCE_IDLE = { offsetY: 0, scale: 1, active: false };
const KARAOKE_BOUNCE_MAX_CHAR_DISTANCE = 3;
const easeOutSine = (value) => Math.sin(Math.max(0, Math.min(1, value)) * Math.PI / 2);
const easeSoftRelease = (value) => (
	0.5 + 0.5 * Math.cos(Math.max(0, Math.min(1, value)) * Math.PI)
);

const getKaraokeBounceAttenuation = (globalCharIndex, activeGlobalCharIndex) => {
	if (!Number.isFinite(globalCharIndex) || !Number.isFinite(activeGlobalCharIndex) || activeGlobalCharIndex < 0) {
		return 1;
	}

	const distance = Math.abs(globalCharIndex - activeGlobalCharIndex);
	if (distance > KARAOKE_BOUNCE_MAX_CHAR_DISTANCE) {
		return 0;
	}

	return Math.max(0.22, 1 - distance * 0.23);
};

const getKaraokeCharFill = (position, isActive, startTime, endTime, isComplete = false) => {
	if (isComplete) {
		return 1;
	}
	if (position <= startTime) {
		return 0;
	}
	if (position >= endTime) {
		return 1;
	}
	const raw = Math.max(0, Math.min(1, (position - startTime) / Math.max(1, endTime - startTime)));
	const corrected = applyKaraokeFillCorrectionCurve(raw);
	// Quantize to 4% steps so per-frame inline-style updates collapse to ~12 changes/sec
	// instead of 60. React skips DOM writes when the resulting CSS variable string is
	// unchanged, which removes the matching style recalc + layerize cascade.
	return Math.round(corrected * KARAOKE_FILL_STEPS) / KARAOKE_FILL_STEPS;
};

const getKaraokeBounceValues = (position, isActive, startTime, endTime, attenuation = 1) => {
	if (!CONFIG.visual["karaoke-bounce"] || !isActive || attenuation <= 0) {
		return KARAOKE_BOUNCE_IDLE;
	}

	const duration = Math.max(1, endTime - startTime);
	const riseDuration = Math.max(180, Math.min(280, duration * 0.9));
	const releaseDuration = Math.max(420, Math.min(820, duration * 2.4));
	const totalWindow = riseDuration + releaseDuration;
	const elapsed = position - startTime;

	if (elapsed < 0 || elapsed > totalWindow) {
		return KARAOKE_BOUNCE_IDLE;
	}

	let waveStrength;

	if (elapsed <= riseDuration) {
		const riseProgress = elapsed / riseDuration;
		waveStrength = easeOutSine(riseProgress);
	} else {
		const fallProgress = Math.min(1, (elapsed - riseDuration) / Math.max(1, totalWindow - riseDuration));
		waveStrength = easeSoftRelease(fallProgress);
	}

	if (waveStrength < 0.025) {
		return KARAOKE_BOUNCE_IDLE;
	}

	waveStrength *= Math.max(0, Math.min(1, attenuation));

	const offsetY = Math.round((-6 * waveStrength) * 4) / 4;
	const scale = Math.round((1 + 0.055 * waveStrength) * 200) / 200;

	return {
		offsetY,
		scale,
		active: offsetY !== 0 || scale !== 1,
	};
};

const getKaraokeWordBounceValues = (position, isActive, startTime, endTime, attenuation = 1) => {
	if (!CONFIG.visual["karaoke-bounce"] || attenuation <= 0) {
		return KARAOKE_BOUNCE_IDLE;
	}

	const duration = Math.max(1, endTime - startTime);
	const riseDuration = Math.min(180, Math.max(60, duration * 0.38));
	const releaseDuration = Math.min(280, Math.max(180, duration * 0.45));
	const peakTime = Math.min(endTime, startTime + riseDuration);
	const animationEndTime = endTime + releaseDuration;
	if (position < startTime || position >= animationEndTime) {
		return KARAOKE_BOUNCE_IDLE;
	}

	let waveStrength;
	if (position <= peakTime) {
		const riseProgress = Math.max(
			0,
			Math.min(1, (position - startTime) / Math.max(1, peakTime - startTime))
		);
		waveStrength = easeOutSine(riseProgress);
	} else if (position <= endTime) {
		// Keep the word lifted for its full playback window. The following word can
		// rise while this one is still up, which avoids the stop-and-go motion.
		waveStrength = 1;
	} else {
		const releaseProgress = Math.max(
			0,
			Math.min(1, (position - endTime) / Math.max(1, releaseDuration))
		);
		waveStrength = easeSoftRelease(releaseProgress);
	}

	waveStrength *= Math.max(0, Math.min(1, attenuation));
	if (waveStrength < 0.025) {
		return KARAOKE_BOUNCE_IDLE;
	}

	const offsetY = Math.round((-6 * waveStrength) * 4) / 4;
	const scale = Math.round((1 + 0.055 * waveStrength) * 200) / 200;
	return {
		offsetY,
		scale,
		active: offsetY !== 0 || scale !== 1,
	};
};

const KaraokeLine = react.memo(({ line, position, isActive, isEffectFocused = isActive, isEffectLive = isActive || isEffectFocused, settingsRevision = 0, globalCharOffset = 0, activeGlobalCharIndex = -1, phonetic = null, translation = null, furiganaMapOverride = null, culturalAnnotations = [], renderGranularity = null }) => {
  if (!line) {
          return "";
  }

  const wordTimed = renderGranularity
	? renderGranularity === "word"
	: line.karaokeGranularity === "word";

  const vocalRows = useMemo(() => getKaraokeVocalRows(line), [line]);
  const shouldUseVocalRowAnchor = isActive
          && Array.isArray(vocalRows)
          && vocalRows.length >= KARAOKE_VOCAL_STACK_CENTER_THRESHOLD;
  const vocalRowRenderData = useMemo(() => (
	Array.isArray(vocalRows)
		? vocalRows.map((row) => buildKaraokeVocalRowRenderData(line, row, shouldUseVocalRowAnchor))
		: null
  ), [line, vocalRows, shouldUseVocalRowAnchor]);
  const vocalAnchorStateRef = useRef({ lineKey: null, anchorPosition: -1, lastPlaybackPosition: NaN });
  const nextVocalAnchorPosition = shouldUseVocalRowAnchor
          ? getKaraokeVocalAnchorPosition(vocalRowRenderData, position)
          : -1;
  const activeVocalAnchorPosition = shouldUseVocalRowAnchor
          ? getStableKaraokeVocalAnchorPosition(vocalAnchorStateRef, line, position, nextVocalAnchorPosition)
          : -1;
  const activeVocalRowIndex = Number.isFinite(activeVocalAnchorPosition) && activeVocalAnchorPosition >= 0
          ? Math.round(activeVocalAnchorPosition)
          : -1;
  const activeVocalAnchorWindowMs = shouldUseVocalRowAnchor
          ? getKaraokeVocalAnchorWindowMs(vocalRowRenderData, activeVocalAnchorPosition)
          : null;

  const { rowPhonetics, rowTranslations, stackPhonetic, stackTranslation, culturalAnnotationsByRow } = useMemo(() => {
	if (!vocalRows) return {};
	const rPhonetics = splitLineByVocalRowShape(phonetic, vocalRows);
	const rTranslations = splitLineByVocalRowShape(translation, vocalRows);
	const hasRowPhon = vocalRows.some((row, rowIndex) => row.phonetic || rPhonetics[rowIndex]);
	const hasRowTrans = vocalRows.some((row, rowIndex) => row.translation || rTranslations[rowIndex]);
	const sPhon = !hasRowPhon && typeof phonetic === "string" ? phonetic.trim() : "";
	const sTrans = !hasRowTrans && typeof translation === "string" ? translation.trim() : "";
	const cByRow = vocalRows.map(() => []);
	if (vocalRowRenderData) {
		for (const annotation of culturalAnnotations) {
			const matchingRowIndex = vocalRowRenderData.findIndex(({ line: rowLine }) =>
				annotation.expression &&
				getCopyableText(rowLine.originalText || rowLine.text).includes(annotation.expression)
			);
			const rowIndex = matchingRowIndex >= 0 ? matchingRowIndex : vocalRows.length - 1;
			cByRow[rowIndex].push(annotation);
		}
	}
	return {
		rowPhonetics: rPhonetics,
		rowTranslations: rTranslations,
		stackPhonetic: sPhon,
		stackTranslation: sTrans,
		culturalAnnotationsByRow: cByRow,
	};
  }, [vocalRows, phonetic, translation, culturalAnnotations, vocalRowRenderData]);

  if (vocalRows) {
          let rowGlobalCharOffset = globalCharOffset;
		  const stackChildren = vocalRows.map((row, rowIndex) => {
                  const rowRenderData = vocalRowRenderData[rowIndex];
			const rowLine = rowRenderData.line;
			const rowHasInlineEffects = Array.isArray(row.syllables)
				&& row.syllables.some(syllable => (
					syllable?.inlineStyle === true
					&& KARAOKE_TEXT_EFFECT_KIND_CLASSES.has(String(syllable?.styleKind || "").trim().toLowerCase())
				));
                  const classParts = [
                          "lyrics-karaoke-part",
                          row.role === "background" ? "background" : "lead",
						  ...(rowHasInlineEffects ? [] : getKaraokeKindClassParts(row.kind || "vocal")),
                          shouldUseVocalRowAnchor && rowIndex === activeVocalRowIndex ? "active-vocal-row" : "",
                          row.speakerClass ? `speaker-${row.speakerClass}` : "",
                  ].filter(Boolean);
                  const currentOffset = rowGlobalCharOffset;
                  rowGlobalCharOffset += getKaraokeSyllableCharCount(row.syllables);
			const rowTimedChars = rowRenderData.timedChars;
			const rowActiveCharIndex = getActiveKaraokeTimedCharIndex(rowTimedChars, position);
			const rowActiveGlobalCharIndex = rowActiveCharIndex >= 0 ? currentOffset + rowActiveCharIndex : -1;
			const rowPhonetic = row.phonetic || rowPhonetics[rowIndex] || "";
			const rowTranslation = row.translation || rowTranslations[rowIndex] || "";

			return react.createElement(
                          "span",
                          {
                                  key: row.key || rowIndex,
                                  className: classParts.join(" "),
                                  style: row.speakerStyle,
                                  "data-karaoke-vocal-row-index": rowIndex,
                          },
                          react.createElement(KaraokeLine, {
                                  line: rowLine,
                                  position,
					isActive,
					isEffectFocused,
					isEffectLive,
					settingsRevision,
					globalCharOffset: currentOffset,
					activeGlobalCharIndex: rowActiveGlobalCharIndex,
					culturalAnnotations: culturalAnnotationsByRow[rowIndex],
					renderGranularity,
				}),
				rowPhonetic && react.createElement(
					"span",
					{ className: "lyrics-lyricsContainer-LyricsLine-phonetic lyrics-karaoke-part-subline" },
					rowPhonetic
				),
				rowTranslation && react.createElement(
					"span",
					{ className: "lyrics-lyricsContainer-LyricsLine-translation lyrics-karaoke-part-subline" },
					rowTranslation
				)
			);
		});

		if (stackPhonetic) {
			stackChildren.push(react.createElement(
				"span",
				{ key: "stack-phonetic", className: "lyrics-lyricsContainer-LyricsLine-phonetic lyrics-karaoke-part-subline lyrics-karaoke-stack-subline" },
				stackPhonetic
			));
		}

		if (stackTranslation) {
			stackChildren.push(react.createElement(
				"span",
				{ key: "stack-translation", className: "lyrics-lyricsContainer-LyricsLine-translation lyrics-karaoke-part-subline lyrics-karaoke-stack-subline" },
				stackTranslation
			));
		}

          return react.createElement(
                  "span",
                  {
                          className: "lyrics-karaoke-stack",
                          "data-karaoke-vocal-row-count": vocalRows.length,
                          "data-karaoke-vocal-anchor-position": shouldUseVocalRowAnchor && activeVocalAnchorPosition >= 0
                                  ? activeVocalAnchorPosition
                                  : undefined,
                          "data-karaoke-vocal-anchor-window-ms": Number.isFinite(activeVocalAnchorWindowMs)
                                  ? Math.round(activeVocalAnchorWindowMs)
                                  : undefined,
                          "data-active-karaoke-vocal-row-index": shouldUseVocalRowAnchor ? activeVocalRowIndex : undefined,
                  },
                  stackChildren
          );
  }

	const furiganaEnabled = CONFIG?.visual?.["furigana-enabled"] === true;
	const furiganaReady = window.FuriganaConverter?.isAvailable?.() === true;
	const lyricsLocale = String(window.Utils?.getDetectedLanguage?.() || "auto");

	const { furiganaMap, timedChars, endTime, wrapByWord, textDirection, useTextRun, preserveInlineStyles, wordStartTimes, culturalMarkersByCharIndex, fallbackCulturalAnnotations } = useMemo(() => {
		const sourceSyllables = Array.isArray(line.syllables) && line.syllables.length > 0
			? line.syllables
			: getTimedSyllablesFromLine(line);
		const rawLineText = sourceSyllables.map((syllable) => syllable?.text || "").join("")
			|| getCopyableText(line.text)
			|| "";
		const processedText = furiganaMapOverride instanceof Map
			? ""
			: Utils.applyFuriganaIfEnabled(rawLineText);
		const compensatedTimedChars = applyKaraokeWhitespaceCompensation(buildKaraokeTimedChars(line));
		const detectedTextDirection = getKaraokeTextDirection(rawLineText);

		const renderTimedChars = wordTimed
			? assignKaraokeWordIndexes(compensatedTimedChars, line.karaokeGranularity === "word", lyricsLocale)
			: compensatedTimedChars;
		const timedText = renderTimedChars.map(charInfo => String(charInfo?.char || "")).join("");
		const wordStartTimes = new Map();
		if (wordTimed) {
			renderTimedChars.forEach((charInfo) => {
				const wordIndex = Number.isInteger(charInfo?.karaokeWordIndex)
					? charInfo.karaokeWordIndex
					: null;
				if (wordIndex === null) return;
				const startTime = Number.isFinite(charInfo?.karaokeFillStartTime)
					? charInfo.karaokeFillStartTime
					: charInfo?.startTime;
				if (!Number.isFinite(startTime)) return;
				wordStartTimes.set(
					wordIndex,
					Math.min(wordStartTimes.get(wordIndex) ?? Infinity, startTime)
				);
			});
		}
		const culturalMarkersByCharIndex = new Map();
		const fallbackCulturalAnnotations = [];
		const useTextRun = shouldUseKaraokeTextRun(rawLineText) || shouldUseKaraokeTextRunForLatin(rawLineText);
		for (const annotation of culturalAnnotations) {
			const expressionStart = annotation.expression
				? timedText.indexOf(annotation.expression)
				: -1;
			if (useTextRun || expressionStart < 0) {
				fallbackCulturalAnnotations.push(annotation);
				continue;
			}
			const expressionEnd = expressionStart + annotation.expression.length;
			let textOffset = 0;
			let markerCharIndex = -1;
			for (let index = 0; index < renderTimedChars.length; index += 1) {
				textOffset += String(renderTimedChars[index]?.char || "").length;
				if (textOffset >= expressionEnd) {
					markerCharIndex = index;
					break;
				}
			}
			if (markerCharIndex < 0) {
				fallbackCulturalAnnotations.push(annotation);
				continue;
			}
			const markers = culturalMarkersByCharIndex.get(markerCharIndex) || [];
			markers.push(annotation);
			culturalMarkersByCharIndex.set(markerCharIndex, markers);
		}

		return {
			furiganaMap: furiganaMapOverride instanceof Map
				? furiganaMapOverride
				: buildKaraokeFuriganaMap(processedText),
			timedChars: renderTimedChars,
			endTime: compensatedTimedChars.reduce(
				(maxEndTime, charInfo) => Math.max(maxEndTime, Number.isFinite(charInfo?.endTime) ? charInfo.endTime : 0),
				getKaraokeLineBounds(line).endTime
			),
			wrapByWord: shouldWrapKaraokeByWord(rawLineText),
			textDirection: detectedTextDirection,
			useTextRun,
			preserveInlineStyles: !KARAOKE_JOINING_SCRIPT_REGEX.test(rawLineText),
			wordStartTimes,
			culturalMarkersByCharIndex,
			fallbackCulturalAnnotations,
		};
	}, [line, furiganaEnabled, furiganaReady, furiganaMapOverride, wordTimed, lyricsLocale, culturalAnnotations]);
	// Keep completed glyphs on the active paint path while the parent line fades
	// out. Gating this by isActive made the fill disappear in a single frame at
	// every line hand-off.
	const isComplete = endTime > 0 && position >= endTime;

	const charElements = useTextRun ? [] : timedChars.map((charInfo, index) => {
		const wordIndex = Number.isInteger(charInfo?.karaokeWordIndex)
			? charInfo.karaokeWordIndex
			: null;
		const wordStartTime = wordIndex === null ? null : wordStartTimes.get(wordIndex);
		const fillRatio = wordTimed
			? getKaraokeInstantWordFill(
				{ startTime: Number.isFinite(wordStartTime) ? wordStartTime : charInfo?.startTime },
				position,
				isActive,
				isComplete
			) / 100
			: getKaraokeCharFill(
				position,
				isActive,
				Number.isFinite(charInfo?.karaokeFillStartTime) ? charInfo.karaokeFillStartTime : charInfo.startTime,
				Number.isFinite(charInfo?.karaokeFillEndTime) ? charInfo.karaokeFillEndTime : charInfo.endTime,
				isComplete
			);
		const charState = fillRatio <= 0 ? "pending" : fillRatio >= 1 ? "done" : "active";
		const globalCharIndex = globalCharOffset + index;
		const bounceAttenuation = getKaraokeBounceAttenuation(globalCharIndex, activeGlobalCharIndex);
		const bounce = wordTimed ? KARAOKE_BOUNCE_IDLE : getKaraokeBounceValues(
			position,
			isActive,
			Number.isFinite(charInfo?.karaokeFillStartTime) ? charInfo.karaokeFillStartTime : charInfo.startTime,
			Number.isFinite(charInfo?.karaokeFillEndTime) ? charInfo.karaokeFillEndTime : charInfo.endTime,
			bounceAttenuation
		);
		const karaokeStyle = {};
		if (charState === "active") {
			const fillValue = Math.max(0, Math.min(100, fillRatio * 100));
			const softEdge = 16;
			karaokeStyle["--karaoke-char-fill"] = `${fillValue}%`;
			karaokeStyle["--karaoke-char-fill-soft-start"] = `${Math.max(0, fillValue - softEdge)}%`;
			karaokeStyle["--karaoke-char-fill-soft-end"] = `${Math.min(100, fillValue + softEdge)}%`;
		}
		if (bounce.active) {
			karaokeStyle["--karaoke-bounce-y"] = `${bounce.offsetY}px`;
			karaokeStyle["--karaoke-bounce-scale"] = bounce.scale;
		}
		const className = getCachedKaraokeStateClassName(
			KARAOKE_CHAR_STATE_CLASS_NAMES,
			charState,
			bounce.active,
			isComplete
		);
		const charNode = react.createElement(
			"span",
			{
				className,
				style: karaokeStyle,
				"data-outline-text": charInfo.char,
				key: `karaoke-char-${index}`,
			},
			react.createElement(
				"span",
				{ className: "lyrics-karaoke-glyph-fill" },
				charInfo.char
			)
		);
		const reading = furiganaMap.get(index);

		let renderedCharNode = reading
			? react.createElement(
				"ruby",
				{
					className: `lyrics-karaoke-ruby lyrics-karaoke-ruby--${charState}`,
					style: karaokeStyle,
					key: `karaoke-ruby-${index}`,
				},
				charNode,
				react.createElement("rt", null, reading)
			)
			: charNode;
		const culturalMarkers = culturalMarkersByCharIndex.get(index) || [];
		if (culturalMarkers.length === 0) {
			return renderedCharNode;
		}

		return react.createElement(
			react.Fragment,
			{ key: `karaoke-cultural-marker-${index}` },
			renderedCharNode,
			culturalMarkers.map((annotation) => react.createElement(
				"sup",
				{
					key: `karaoke-cultural-marker-${index}-${annotation.marker}`,
					className: "lyrics-cultural-marker",
				},
				`[${annotation.marker}]`
			))
		);
	});
	const lineChildren = useTextRun
		? buildKaraokeTextRunElements(
			timedChars,
			position,
			isActive,
			isComplete,
			textDirection,
			globalCharOffset,
			activeGlobalCharIndex,
			wordTimed,
			preserveInlineStyles
		)
		: (wrapByWord || wordTimed)
		? buildKaraokeWordElements(timedChars, charElements, {
			position,
			isActive,
			isComplete,
			globalCharOffset,
			activeGlobalCharIndex,
			wordTimed,
		})
		: wrapKaraokeInlineStyleRuns(timedChars, charElements);

	return react.createElement(
		"span",
		{
			className: `lyrics-karaoke-line${wrapByWord || wordTimed || useTextRun ? " has-word-wrap" : ""}${wordTimed ? " is-word-timed" : ""}${useTextRun ? " is-text-run" : ""}${textDirection === "rtl" ? " is-rtl" : ""}${isActive ? " is-active" : ""}${isEffectLive ? " is-effect-live" : ""}${isEffectFocused ? " is-effect-focused" : ""}${isComplete ? " is-complete" : ""}`,
			dir: useTextRun ? (textDirection === "rtl" ? "ltr" : textDirection) : undefined,
		},
		lineChildren,
		fallbackCulturalAnnotations.map((annotation) => react.createElement(
				"sup",
				{
					key: `karaoke-cultural-fallback-${annotation.marker}`,
					className: "lyrics-cultural-marker",
				},
				`[${annotation.marker}]`
			))
	);
});

const SyncedLyricsPage = react.memo(({ lyrics = [], provider, contributors, copyright, isKara, karaokeSource = null, karaokeRenderGranularity = null, reRenderLyricsPage = null }) => {
	const position = useLyricsPlaybackPosition();
	const karaokePosition = isKara ? position + getPseudoKaraokeRenderAdvance(karaokeSource) : position;
	const karaokeLineTransitionClass = isKara && CONFIG.visual["karaoke-line-transition"]
		? " karaoke-line-transition-enabled"
		: "";
  const compactActiveLineEle = useRef();
  const lyricContainerEle = useRef();
  const lyricsId = useMemo(() => lyrics[0]?.text || "no-lyrics", [lyrics]);

  const setCompactActiveLineAnchor = useCallback((node) => {
          compactActiveLineEle.current = node;
  }, []);

  const containerRefCallback = useCallback((node) => {
          lyricContainerEle.current = node;
	}, []);
	const {
		isScrolling,
		handleContainerClick,
		renderItems,
		playbackWindows,
		activeLyricIndex,
		globalCharOffsets,
		activeGlobalCharIndex,
	} = useSyncedLyricsEngine({
		lyrics,
		position: karaokePosition,
		compact: true,
		isKara,
		containerRef: lyricContainerEle,
		activeLineRef: compactActiveLineEle,
          lyricsId,
          settingsRevision: reRenderLyricsPage,
  });

	const prevScrollModeRef = useRef(false);
	useEffect(() => {
		if (!isScrolling) {
			if (prevScrollModeRef.current && lyricContainerEle.current) {
				lyricContainerEle.current.scrollTop = 0;
			}
			prevScrollModeRef.current = false;
			return undefined;
		}

		if (prevScrollModeRef.current) {
			return undefined;
		}

		const raf = typeof requestAnimationFrame === "function"
			? requestAnimationFrame
			: (callback) => setTimeout(callback, 0);
		const cancelRaf = typeof cancelAnimationFrame === "function"
			? cancelAnimationFrame
			: clearTimeout;
		let nestedFrameId = null;
		const frameId = raf(() => {
			nestedFrameId = raf(() => {
				scrollSyncedContainerToActiveLine(
					lyricContainerEle.current,
					compactActiveLineEle.current,
					"auto"
				);
			});
		});

		prevScrollModeRef.current = isScrolling;
		return () => {
			cancelRaf(frameId);
			if (nestedFrameId !== null) {
				cancelRaf(nestedFrameId);
			}
		};
	}, [isScrolling, lyricsId]);

	if (!Array.isArray(lyrics) || lyrics.length === 0) {
		return react.createElement("div", { className: "lyrics-lyricsContainer-SyncedLyricsPage" }, renderLyricsUnavailable(I18n.t("messages.noLyrics")));
	}

	return react.createElement(
		"div",
		{
			className: `lyrics-lyricsContainer-SyncedLyricsPage${isKara ? " is-karaoke" : ""}${karaokeLineTransitionClass}${isScrolling ? " scrolling-active" : ""}`,
			ref: containerRefCallback,
			onClick: handleContainerClick,
			tabIndex: 0,
			role: "region",
			"aria-label": I18n.t("lyricsTitle") || "Synced lyrics",
		},
		react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-SyncedLyrics",
				key: lyricsId,
			},
			...renderLyricsItems({
                          items: renderItems,
                          isKara,
                          karaokeRenderGranularity,
                          position: karaokePosition,
                          playbackWindows,
                          activeGlobalCharIndex,
                          activeLineRef: setCompactActiveLineAnchor,
                          settingsRevision: reRenderLyricsPage,
                  })
          )
	);
});

// Global SearchBar manager to prevent duplicate instances
const SearchBarManager = {
	instance: null,
	bindings: new Set(),

	register(instance) {
		// Clean up previous instance
		if (this.instance) {
			this.cleanup();
		}
		this.instance = instance;
	},

	unregister(instance) {
		if (this.instance === instance) {
			this.cleanup();
			this.instance = null;
		}
	},

	bind(key, callback) {
		const bindingKey = `${key}-${callback.name}`;
		if (this.bindings.has(bindingKey)) {
			return; // Already bound
		}
		Spicetify.Mousetrap().bind(key, callback);
		this.bindings.add(bindingKey);
	},

	bindToContainer(container, key, callback) {
		const bindingKey = `container-${key}-${callback.name}`;
		if (this.bindings.has(bindingKey)) {
			return; // Already bound
		}
		Spicetify.Mousetrap(container).bind(key, callback);
		this.bindings.add(bindingKey);
	},

	cleanup() {
		this.bindings.forEach(bindingKey => {
			const [type, key] = bindingKey.split('-');
			if (type === 'container' && this.instance?.container) {
				try {
					Spicetify.Mousetrap(this.instance.container).unbind(key);
				} catch (e) {
					// Container might be null
				}
			} else {
				try {
					Spicetify.Mousetrap().unbind(key);
				} catch (e) {
					// Mousetrap might not be available
				}
			}
		});
		this.bindings.clear();
	}
};

class SearchBar extends react.Component {
	constructor() {
		super();
		this.state = {
			hidden: true,
			atNode: 0,
			foundNodes: [],
		};
		this.container = null;
		this.instanceId = `searchbar-${Date.now()}-${Math.random()}`;
		this.getNodeFromInput = this.getNodeFromInput.bind(this);
		this.handleInputRef = (node) => {
			this.container = node;
		};
	}

	componentDidMount() {
		// Register with global manager
		SearchBarManager.register(this);

		this.viewPort = document.querySelector(".main-view-container .os-viewport");
		this.mainViewOffsetTop = document.querySelector(".Root__main-view")?.offsetTop || 0;

		this.toggleCallback = () => {
			if (!(Spicetify.Platform.History.location.pathname === "/ivLyrics" && this.container)) return;

			if (this.state.hidden) {
				this.setState({ hidden: false });
				this.container.focus();
			} else {
				this.setState({ hidden: true });
				this.container.blur();
			}
		};
		this.unFocusCallback = () => {
			if (this.container) {
				this.container.blur();
				this.setState({ hidden: true });
			}
		};
		this.loopThroughCallback = (event) => {
			if (!this.state.foundNodes.length) {
				return;
			}

			if (event.key === "Enter") {
				const dir = event.shiftKey ? -1 : 1;
				let atNode = this.state.atNode + dir;
				if (atNode < 0) {
					atNode = this.state.foundNodes.length - 1;
				}
				atNode %= this.state.foundNodes.length;
				const rects = this.state.foundNodes[atNode].getBoundingClientRect();
				if (this.viewPort) {
					this.viewPort.scrollBy(0, rects.y - 100);
				}
				this.setState({ atNode });
			}
		};

		// Use SearchBarManager to prevent duplicate bindings
		SearchBarManager.bind("mod+shift+f", this.toggleCallback);
		if (this.container) {
			SearchBarManager.bindToContainer(this.container, "mod+shift+f", this.toggleCallback);
			SearchBarManager.bindToContainer(this.container, "enter", this.loopThroughCallback);
			SearchBarManager.bindToContainer(this.container, "shift+enter", this.loopThroughCallback);
			SearchBarManager.bindToContainer(this.container, "esc", this.unFocusCallback);
		}
	}

	componentWillUnmount() {
		// Unregister from global manager
		SearchBarManager.unregister(this);
	}

	getNodeFromInput(event) {
		const value = event.target.value.toLowerCase();
		if (!value) {
			this.setState({ foundNodes: [] });
			this.viewPort.scrollTo(0, 0);
			return;
		}

		const lyricsPage = document.querySelector(".lyrics-lyricsContainer-UnsyncedLyricsPage");
		const walker = document.createTreeWalker(
			lyricsPage,
			NodeFilter.SHOW_TEXT,
			(node) => {
				if (node.textContent.toLowerCase().includes(value)) {
					return NodeFilter.FILTER_ACCEPT;
				}
				return NodeFilter.FILTER_REJECT;
			},
			false
		);

		const foundNodes = [];
		while (walker.nextNode()) {
			const range = document.createRange();
			range.selectNodeContents(walker.currentNode);
			foundNodes.push(range);
		}

		if (!foundNodes.length) {
			this.viewPort.scrollBy(0, 0);
		} else {
			const rects = foundNodes[0].getBoundingClientRect();
			this.viewPort.scrollBy(0, rects.y - 100);
		}

		this.setState({ foundNodes, atNode: 0 });
	}

	render() {
		let y = 0;
		let height = 0;
		if (this.state.foundNodes.length) {
			const node = this.state.foundNodes[this.state.atNode];
			const rects = node.getBoundingClientRect();
			y = rects.y + this.viewPort.scrollTop - this.mainViewOffsetTop;
			height = rects.height;
		}
		return react.createElement(
			"div",
			{
				className: `lyrics-Searchbar${this.state.hidden ? " hidden" : ""}`,
			},
						react.createElement("input", {
								ref: this.handleInputRef,
								onChange: this.getNodeFromInput,
						}),
			react.createElement("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "currentColor",
				dangerouslySetInnerHTML: {
					__html: Spicetify.SVGIcons.search,
				},
			}),
			react.createElement(
				"span",
				{
					hidden: this.state.foundNodes.length === 0,
				},
				`${this.state.atNode + 1}/${this.state.foundNodes.length}`
			),
			react.createElement("div", {
				className: "lyrics-Searchbar-highlight",
				style: {
					"--search-highlight-top": `${y}px`,
					"--search-highlight-height": `${height}px`,
				},
			})
		);
	}
}

function isInViewport(element) {
	const rect = element.getBoundingClientRect();
	return (
		rect.top >= 0 &&
		rect.left >= 0 &&
		rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
		rect.right <= (window.innerWidth || document.documentElement.clientWidth)
	);
}

const SyncedExpandedLyricsPage = react.memo(({ lyrics = [], provider, contributors, copyright, isKara, karaokeSource = null, reRenderLyricsPage = null }) => {
	const position = useLyricsPlaybackPosition();
	const karaokePosition = isKara ? position + getPseudoKaraokeRenderAdvance(karaokeSource) : position;
	const karaokeLineTransitionClass = isKara && CONFIG.visual["karaoke-line-transition"]
		? " karaoke-line-transition-enabled"
		: "";
	const activeLineRef = useRef(null);
	const pageRef = useRef(null);
	const lyricsId = useMemo(() => lyrics[0]?.text || "no-lyrics", [lyrics]);
	const {
		handleContainerClick,
		renderItems,
		playbackWindows,
		activeGlobalCharIndex,
	} = useSyncedLyricsEngine({
		lyrics,
		position: karaokePosition,
		compact: false,
		isKara,
		containerRef: pageRef,
		activeLineRef,
		lyricsId,
		settingsRevision: reRenderLyricsPage,
	});

	if (!Array.isArray(lyrics) || lyrics.length === 0) {
		return react.createElement("div", { className: "lyrics-lyricsContainer-UnsyncedLyricsPage" }, renderLyricsUnavailable(I18n.t("messages.noLyrics")));
	}

	return react.createElement(
		"div",
		{
			className: `lyrics-lyricsContainer-UnsyncedLyricsPage${isKara ? " is-karaoke" : ""}${karaokeLineTransitionClass}`,
			key: lyricsId,
			ref: pageRef,
			onClick: handleContainerClick,
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		...renderLyricsItems({
			items: renderItems,
			isKara,
			position: karaokePosition,
			playbackWindows,
			activeGlobalCharIndex,
			activeLineRef,
			settingsRevision: reRenderLyricsPage,
		}),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		react.createElement(SearchBar, null)
	);
});

const UnsyncedLyricsPage = react.memo(({ lyrics = [], provider, contributors, copyright }) => {
	const lyricsArray = useMemo(() => normalizeUnsyncedLyrics(lyrics), [lyrics]);
	const renderItems = useMemo(() => lyricsArray.map((line, index) => {
		const { text, originalText, text2 } = getEmbeddedAuxiliaryDisplayValues(line);
		const {
			lineText,
			subText,
			showMode2Translation,
			belowMode,
			showMode2,
		} = getUnsyncedLineRenderData(lyrics, text, originalText, text2);

		return {
			key: index,
			mainText: lineText,
			subText: belowMode ? subText : null,
			subText2: showMode2 ? showMode2Translation : null,
			culturalNote: line?.culturalNote || null,
			mainCopyText: Utils.formatLyricLineToCopy(
				lineText,
				belowMode ? subText : null,
				showMode2 ? showMode2Translation : null,
				originalText
			),
			subCopyText: belowMode ? subText : null,
			subText2CopyText: showMode2 ? showMode2Translation : null,
			originalText,
		};
	}), [lyricsArray, lyrics]);

	if (lyricsArray.length === 0) {
		return react.createElement("div", { className: "lyrics-lyricsContainer-UnsyncedLyricsPage" }, renderLyricsUnavailable(I18n.t("messages.noLyrics")));
	}

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		...renderItems.map((item) =>
			react.createElement(LyricsLineBlock, {
				key: item.key,
				className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
				mainText: item.mainText,
				subText: item.subText,
				subText2: item.subText2,
				culturalNote: item.culturalNote,
				originalText: item.originalText,
				mainCopyText: item.mainCopyText,
				subCopyText: item.subCopyText,
				subText2CopyText: item.subText2CopyText,
			})
		),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),

		react.createElement(SearchBar, null)
	);
});




const LoadingIcon = react.createElement(
	"svg",
	{
		width: "200px",
		height: "200px",
		viewBox: "0 0 100 100",
		preserveAspectRatio: "xMidYMid",
	},
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "0s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "0s",
		})
	),
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		})
	)
);

const createNoLyricsParticle = (index, cx, radius, x, duration, delay, opacity = 0.75) =>
	react.createElement("circle", {
		key: `particle-${index}`,
		className: `lyrics-noLyricsMotion-particle lyrics-noLyricsMotion-particle-${index}`,
		cx,
		cy: "168",
		r: radius,
		fill: "currentColor",
		style: {
			"--particle-x": `${x}px`,
			"--particle-duration": `${duration}s`,
			"--particle-delay": `${delay}s`,
			"--particle-opacity": opacity,
		},
	});

const NoLyricsAnimation = () => react.createElement(
	"svg",
	{
		className: "lyrics-noLyricsMotion",
		viewBox: "0 0 280 180",
		width: "280",
		height: "180",
		role: "img",
		"aria-label": I18n.t("messages.noLyrics"),
		focusable: "false",
	},
	react.createElement(
		"g",
		{ className: "lyrics-noLyricsMotion-staff", "aria-hidden": "true" },
		[68, 88, 108, 128].map((y) =>
			react.createElement("line", {
				key: y,
				x1: "24",
				y1: y,
				x2: "256",
				y2: y,
				stroke: "currentColor",
				"stroke-width": "1",
				"stroke-linecap": "round",
			})
		)
	),
	react.createElement("path", {
		className: "lyrics-noLyricsMotion-wave lyrics-noLyricsMotion-wave-soft",
		d: "M18 104 C60 72 100 136 142 104 S224 72 262 104",
		fill: "none",
		stroke: "currentColor",
		"stroke-width": "2",
		"stroke-linecap": "round",
	}),
	react.createElement("path", {
		className: "lyrics-noLyricsMotion-wave lyrics-noLyricsMotion-wave-main",
		d: "M18 104 C60 72 100 136 142 104 S224 72 262 104",
		fill: "none",
		stroke: "currentColor",
		"stroke-width": "3",
		"stroke-linecap": "round",
	}),
	react.createElement(
		"g",
		{ className: "lyrics-noLyricsMotion-particles", "aria-hidden": "true" },
		[
			createNoLyricsParticle(1, 42, 2.2, 18, 7.4, -0.8, 0.72),
			createNoLyricsParticle(2, 70, 1.7, -12, 8.8, -4.1, 0.58),
			createNoLyricsParticle(3, 98, 2.8, 24, 7.9, -2.2, 0.86),
			createNoLyricsParticle(4, 128, 1.8, -18, 9.6, -6.4, 0.55),
			createNoLyricsParticle(5, 158, 2.3, 15, 7.1, -1.7, 0.78),
			createNoLyricsParticle(6, 188, 1.6, -14, 8.4, -5.3, 0.56),
			createNoLyricsParticle(7, 216, 2.6, 22, 8.1, -3.2, 0.82),
			createNoLyricsParticle(8, 242, 1.8, -10, 9.2, -7.1, 0.6),
		]
	),
	react.createElement(
		"g",
		{ className: "lyrics-noLyricsMotion-notes", "aria-hidden": "true" },
		react.createElement("path", {
			className: "lyrics-noLyricsMotion-note lyrics-noLyricsMotion-note-1",
			d: "M103 45v36c-3-2-6-3-10-3-8 0-14 5-14 10s6 10 14 10 14-5 14-10V56l26-6V39z",
			fill: "currentColor",
		}),
		react.createElement("path", {
			className: "lyrics-noLyricsMotion-note lyrics-noLyricsMotion-note-2",
			d: "M194 66v30c-2-1-5-2-8-2-7 0-12 4-12 9s5 9 12 9 12-4 12-9V76l23 6v28c-2-1-5-2-8-2-7 0-12 4-12 9s5 9 12 9 12-4 12-9V73z",
			fill: "currentColor",
		})
	)
);

window.ivLyricsNoLyricsAnimation = NoLyricsAnimation;


const LyricsPage = ({ lyricsContainer }) => {
	const modes = CONFIG.modes;
	const activeMode = lyricsContainer.getCurrentMode();

	const topBarProps = {
		links: modes,
		activeLink: modes[activeMode] || modes[0],
		switchCallback: (mode) => {
			const modeIndex = modes.indexOf(mode);
			if (modeIndex !== -1) {
				lyricsContainer.switchTo(modeIndex);
			}
		}
	};

	const topBarContent = typeof TopBarContent === "function"
		? react.createElement(TopBarContent, topBarProps)
		: null;

	return react.createElement(
		"div",
		{
			className: "lyrics-page-wrapper",
			style: { width: "100%", height: "100%", position: "relative" }
		},
		topBarContent,
		lyricsContainer.render(),
		react.createElement(CreditFooter, {
			provider: lyricsContainer.state.provider,
			contributors: lyricsContainer.state.contributors,
			syncType: lyricsContainer.state.syncType,
			syncPoints: lyricsContainer.state.syncPoints
		})
	);
};

const LyricsUnavailableView = react.memo(({ isLoading }) =>
	isLoading
		? renderLyricsUnavailable(LoadingIcon)
		: renderLyricsUnavailable(
			react.createElement(NoLyricsAnimation, null),
			"lyrics-lyricsContainer-LyricsUnavailableMessage--motion"
		)
);

const LyricsPageRenderer = react.memo(({
	mode = -1,
	karaokeMode = 0,
	wordMode = 3,
	syncedMode = 1,
	unsyncedMode = 2,
	trackUri = "",
	currentLyrics = [],
	karaoke = null,
	karaokeSource = null,
	synced = null,
	unsynced = null,
	provider = null,
	contributors = null,
	syncType = null,
	syncPoints = null,
	syncTypeBreakdown = null,
	copyright = null,
	isLoading = false,
	reRenderLyricsPage = null,
}) => {
	const hasLyricsContent = window.ivLyricsDataUtils?.hasLyricsContent
		|| ((lyrics) => Array.isArray(lyrics) && lyrics.length > 0);
	const hasCurrentLyrics = hasLyricsContent(currentLyrics);
	const karaokeLyrics = hasCurrentLyrics
		? currentLyrics
		: (hasLyricsContent(karaoke) ? karaoke : []);
	const syncedLyrics = hasCurrentLyrics
		? currentLyrics
		: (hasLyricsContent(synced) ? synced : []);
	const unsyncedLyrics = hasCurrentLyrics
		? currentLyrics
		: (hasLyricsContent(unsynced) ? unsynced : []);

	const renderDescriptor = useMemo(() => {
		if ((mode === karaokeMode || mode === wordMode) && hasLyricsContent(karaoke)) {
			return {
				component: SyncedLyricsPage,
				props: {
					trackUri,
					lyrics: karaokeLyrics,
					provider,
					contributors,
					copyright,
					isKara: true,
					karaokeSource,
					karaokeRenderGranularity: mode === wordMode ? "word" : "character",
					reRenderLyricsPage,
				},
			};
		}

		if (mode === syncedMode && hasLyricsContent(synced)) {
			return {
				component: CONFIG.visual["synced-compact"]
					? SyncedLyricsPage
					: SyncedExpandedLyricsPage,
				props: {
					trackUri,
					lyrics: syncedLyrics,
					provider,
					contributors,
					copyright,
					reRenderLyricsPage,
				},
			};
		}

		if (mode === unsyncedMode && hasLyricsContent(unsyncedLyrics)) {
			return {
				component: UnsyncedLyricsPage,
				props: {
					trackUri,
					lyrics: unsyncedLyrics,
					provider,
					contributors,
					copyright,
					reRenderLyricsPage,
				},
			};
		}

		return null;
	}, [
		mode,
		karaokeMode,
		wordMode,
		syncedMode,
		unsyncedMode,
		karaoke,
		karaokeSource,
		synced,
		unsynced,
		karaokeLyrics,
		syncedLyrics,
		unsyncedLyrics,
		trackUri,
		provider,
		contributors,
		syncType,
		syncPoints,
		syncTypeBreakdown,
		copyright,
		reRenderLyricsPage,
	]);

	const content = useMemo(() => {
		if (!renderDescriptor) {
			return react.createElement(LyricsUnavailableView, { isLoading });
		}

		return react.createElement(renderDescriptor.component, renderDescriptor.props);
	}, [renderDescriptor, isLoading]);

	return react.createElement(
		react.Fragment,
		null,
		content,
		react.createElement(CreditFooter, {
			provider,
			contributors,
			syncType,
			syncPoints,
		})
	);
});

window.LyricsPageRenderer = LyricsPageRenderer;
window.ivLyricsLyricRendererPrimitives = Object.freeze({
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
});
