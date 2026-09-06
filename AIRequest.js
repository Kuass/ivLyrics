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
            ? Math.min(2_147_483_647, Math.max(1_000, Math.floor(Number(timeoutMs))))
            : DEFAULT_TIMEOUT_MS;
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            return AbortSignal.timeout(boundedTimeout);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException('AI request timed out', 'TimeoutError')), boundedTimeout);
        timer?.unref?.();
        return controller.signal;
    }

    function combineSignals(first, second) {
        const signals = [first, second].filter(Boolean);
        if (signals.length <= 1) return signals[0];
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
            return AbortSignal.any(signals);
        }
        const controller = new AbortController();
        const cleanup = () => {
            for (const signal of signals) signal.removeEventListener('abort', abort);
        };
        const abort = event => {
            controller.abort(event?.target?.reason);
            cleanup();
        };
        for (const signal of signals) {
            if (signal.aborted) {
                controller.abort(signal.reason);
                cleanup();
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
