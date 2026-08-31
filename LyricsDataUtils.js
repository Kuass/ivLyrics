// Shared lyric-array selection helpers.
// Keep every presentation surface from treating an empty provider array as a
// usable mode and masking a populated fallback mode.
(() => {
    "use strict";

    const hasLyricsContent = (lyrics) => Array.isArray(lyrics) && lyrics.length > 0;

    const firstLyricsContent = (...candidates) => (
        candidates.find(hasLyricsContent) || null
    );

    const resolveLyricsForMode = (lyricsState, preferredModeKey = null) => {
        if (!lyricsState) return null;
        return firstLyricsContent(
            preferredModeKey ? lyricsState[preferredModeKey] : null,
            lyricsState.karaoke,
            lyricsState.synced,
            lyricsState.unsynced
        );
    };

    window.ivLyricsDataUtils = Object.freeze({
        hasLyricsContent,
        firstLyricsContent,
        resolveLyricsForMode
    });
})();
