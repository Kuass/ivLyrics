/**
 * Shared bounded fetch for AI providers.
 * The timeout signal intentionally remains attached to the response body so a
 * stalled streaming reader is aborted as well as a stalled connection.
 */
(() => {
    'use strict';

    const DEFAULT_TIMEOUT_MS = 90_000;

    function timeoutSignal(timeoutMs) {
        const boundedTimeout = Number.isFinite(Number(timeoutMs))
            ? Math.max(1_000, Number(timeoutMs))
            : DEFAULT_TIMEOUT_MS;
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            return AbortSignal.timeout(boundedTimeout);
        }
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException('AI request timed out', 'TimeoutError')), boundedTimeout);
        return controller.signal;
    }

    function combineSignals(first, second) {
        const signals = [first, second].filter(Boolean);
        if (signals.length <= 1) return signals[0];
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
            return AbortSignal.any(signals);
        }
        const controller = new AbortController();
        const abort = event => controller.abort(event?.target?.reason);
        for (const signal of signals) {
            if (signal.aborted) {
                controller.abort(signal.reason);
                break;
            }
            signal.addEventListener('abort', abort, { once: true });
        }
        return controller.signal;
    }

    window.ivLyricsFetch = (input, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
        const signal = combineSignals(init?.signal, timeoutSignal(timeoutMs));
        return window.fetch(input, { ...init, signal });
    };
    window.ivLyricsFetch.DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
})();
