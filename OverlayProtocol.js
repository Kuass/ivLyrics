(function initializeIvLyricsOverlayProtocol(root, factory) {
    "use strict";

    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ivLyricsOverlayProtocol = api;
    }
})(typeof window !== "undefined" ? window : globalThis, function createOverlayProtocolApi() {
    "use strict";

    const toUnsignedMilliseconds = (value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, Math.round(numeric));
    };

    const normalizeProgressTiming = (position, duration) => {
        const normalizedPosition = toUnsignedMilliseconds(position);
        const normalizedDuration = toUnsignedMilliseconds(duration);

        return {
            position: normalizedPosition,
            duration: normalizedDuration,
            remaining: (normalizedDuration - normalizedPosition) / 1000
        };
    };

    return {
        toUnsignedMilliseconds,
        normalizeProgressTiming
    };
});
