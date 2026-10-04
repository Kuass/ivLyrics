/**
 * Shared mechanics for Groq/OpenRouter's line-delimited JSON data streams.
 * This is not a general SSE parser: each data line is one JSON payload.
 * Providers own payload validation, finish policy, retries and output repair.
 */
(() => {
    'use strict';

    function emitLines(text, onLine, state, flush = false) {
        if (!onLine) return;

        if (flush) {
            if (state.offset >= text.length) return;
            onLine(state.index, text.slice(state.offset));
            state.index += 1;
            state.offset = text.length;
            return;
        }

        let newlineIndex = text.indexOf('\n', state.offset);
        if (newlineIndex === -1) return;

        const completedLines = [];
        let lineStart = state.offset;
        while (newlineIndex !== -1) {
            completedLines.push(text.slice(lineStart, newlineIndex));
            lineStart = newlineIndex + 1;
            newlineIndex = text.indexOf('\n', lineStart);
        }

        for (const line of completedLines) {
            onLine(state.index, line);
            state.index += 1;
            state.offset += line.length + 1;
        }
    }

    window.ivLyricsReadAIStream = async (body, { readChunk, onText, onLine, onLinesEmitted }) => {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', text = '', finishReason = '';
        const lineState = { index: 0, offset: 0 };

        const processLine = (line) => {
            const trimmedLine = String(line || '').trim();
            if (!trimmedLine.startsWith('data:')) return;

            const payload = trimmedLine.slice(5).trimStart();
            if (!payload || payload === '[DONE]') return;

            const chunk = readChunk(JSON.parse(payload));
            if (chunk.text) {
                text += chunk.text;
                if (typeof onText === 'function') onText(chunk.text);
            }
            if (chunk.finishReason) finishReason = chunk.finishReason;
        };

        const drainBuffer = (flush = false) => {
            const parts = buffer.split(/\r?\n/);
            if (flush) {
                buffer = '';
            } else {
                buffer = parts.pop() || '';
            }
            for (const line of parts) processLine(line);
        };

        const emit = (flush = false) => {
            const beforeCount = lineState.index;
            emitLines(text, onLine, lineState, flush);
            if (lineState.index > beforeCount && typeof onLinesEmitted === 'function') {
                onLinesEmitted(lineState.index);
            }
        };

        let reachedEOF = false;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    reachedEOF = true;
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                drainBuffer();
                emit();
            }

            buffer += decoder.decode();
            drainBuffer(true);
            // Keep the existing EOF callback boundary: the remaining text is emitted
            // together, even when a final unterminated data frame adds more newlines.
            emit(true);
            return { text, finishReason };
        } finally {
            if (!reachedEOF) {
                // A parse/provider/callback error must stop the discarded response.
                // Do not delay a retry or replace its error if cancellation stalls
                // or rejects (including cancellation of an already-errored stream).
                reader.cancel().catch(() => {});
            }
            reader.releaseLock();
        }
    };
})();
