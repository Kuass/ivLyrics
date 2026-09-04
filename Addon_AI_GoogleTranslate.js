/**
 * Google Translate Addon for ivLyrics
 * Uses the public web translation endpoint as an experimental, keyless
 * translation-only provider.
 *
 * @author default
 * @version 1.0.0
 */

(() => {
    'use strict';

    const ADDON_INFO = {
        id: 'google-translate',
        name: 'Google Translate',
        author: 'default',
        description: {
            ko: 'Google 번역 웹 엔드포인트를 사용하는 실험적 번역 전용 제공자 (API 키 불필요)',
            en: 'Experimental translation-only provider using the Google Translate web endpoint (no API key required)',
            ja: 'Google 翻訳のウェブエンドポイントを使用する試験的な翻訳専用プロバイダー（API キー不要）',
            'zh-CN': '使用 Google 翻译网页端点的实验性纯翻译提供商（无需 API 密钥）',
            'zh-TW': '使用 Google 翻譯網頁端點的實驗性純翻譯供應商（不需要 API 金鑰）',
            hi: 'Google Translate वेब एंडपॉइंट का उपयोग करने वाला प्रयोगात्मक, केवल-अनुवाद प्रदाता (API कुंजी आवश्यक नहीं)',
            es: 'Proveedor experimental solo para traducción que usa el endpoint web de Google Translate (no requiere clave de API)',
            fr: 'Fournisseur expérimental dédié à la traduction utilisant le point d’accès web Google Translate (aucune clé API requise)',
            ar: 'موفّر تجريبي مخصّص للترجمة يستخدم نقطة نهاية Google Translate على الويب (لا يتطلب مفتاح API)',
            fa: 'ارائه‌دهنده آزمایشی مخصوص ترجمه با استفاده از نقطه پایانی وب Google Translate (بدون نیاز به کلید API)',
            de: 'Experimenteller Anbieter nur für Übersetzungen über den Google-Translate-Webendpunkt (kein API-Schlüssel erforderlich)',
            ru: 'Экспериментальный провайдер только для перевода через веб-эндпоинт Google Translate (API-ключ не требуется)',
            sv: 'Experimentell leverantör endast för översättning via Google Translates webbslutpunkt (ingen API-nyckel krävs)',
            pt: 'Provedor experimental exclusivo para tradução usando o endpoint web do Google Translate (não requer chave de API)',
            bn: 'Google Translate ওয়েব এন্ডপয়েন্ট ব্যবহারকারী পরীক্ষামূলক, শুধু-অনুবাদ প্রদানকারী (API কী প্রয়োজন নেই)',
            cs: 'Experimentální poskytovatel pouze pro překlad využívající webový endpoint Google Translate (bez klíče API)',
            it: 'Provider sperimentale dedicato alla traduzione che usa l’endpoint web di Google Translate (non richiede una chiave API)',
            th: 'ผู้ให้บริการแปลอย่างเดียวแบบทดลองที่ใช้เว็บเอนด์พอยต์ของ Google Translate (ไม่ต้องใช้คีย์ API)',
            vi: 'Nhà cung cấp thử nghiệm chỉ dành cho dịch thuật, sử dụng điểm cuối web Google Translate (không cần khóa API)',
            id: 'Penyedia eksperimental khusus terjemahan yang menggunakan endpoint web Google Translate (tanpa kunci API)',
            ms: 'Penyedia percubaan khusus untuk terjemahan yang menggunakan titik akhir web Google Translate (tidak memerlukan kunci API)',
            tr: 'Google Translate web uç noktasını kullanan deneysel, yalnızca çeviri sağlayıcısı (API anahtarı gerekmez)'
        },
        version: '1.0.0',
        supports: {
            translate: true,
            pronunciation: false,
            metadata: true,
            tmi: false,
            characterPronunciation: false,
            culturalAnnotations: false
        }
    };

    // Keep service routes out of plain-text bundles. This is intentionally a
    // tiny runtime unpacker rather than Base64; network destinations are still
    // observable in DevTools once a request is made.
    function unpackRuntimeString(seed, length, words) {
        let value = '';
        for (let index = 0; index < length; index++) {
            const packed = words[index >> 1];
            const masked = (packed >>> (index % 2 === 0 ? 8 : 0)) & 0xff;
            const lane = (seed ^ Math.imul(index + 1, 0x5d) ^ (index << 1)) & 0xff;
            value += String.fromCharCode(masked ^ lane);
        }
        return value;
    }

    const ENDPOINT = unpackRuntimeString(0x47, 51, [
        0x728b, 0x2045, 0xed59, 0xef8e, 0x6685, 0xcd63, 0x9527,
        0x49fd, 0x2fc1, 0xe34a, 0xa1f4, 0x5cb4, 0x0377, 0xd52e,
        0xd8f8, 0x57b4, 0xd52b, 0xc674, 0x10b0, 0x4ce0, 0x8632,
        0xd38c, 0x69d8, 0x6107, 0x8d63, 0xc100
    ]);
    const REQUEST_TIMEOUT_MS = 15000;
    const MAX_REQUEST_ATTEMPTS = 2;
    const MAX_CHUNK_CHARACTERS = 3500;
    const MAX_CHUNK_LINES = 40;
    const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
    const RETRYABLE_ERROR_NAMES = new Set(['AbortError', 'TypeError', 'SyntaxError']);
    const PROTECTED_LINE_PATTERN = /^\s*(?:♪+|\[[^\]\r\n]+\]|\([^()\r\n]+\))\s*$/u;
    const TARGET_LANGUAGE_MAP = Object.freeze({
        'zh-cn': 'zh-CN',
        'zh-tw': 'zh-TW'
    });

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    function normalizeTargetLanguage(lang) {
        const normalized = String(lang || 'en').trim().replace(/_/g, '-').toLowerCase();
        return TARGET_LANGUAGE_MAP[normalized] || normalized.split('-')[0] || 'en';
    }

    function createHttpError(response) {
        const error = new Error(`[Google Translate] Request failed (${response.status})`);
        error.status = response.status;
        error.retryable = RETRYABLE_STATUS_CODES.has(response.status);
        return error;
    }

    function parseTranslatedText(payload) {
        if (!Array.isArray(payload?.[0])) {
            throw new Error('[Google Translate] Invalid response format');
        }

        const translatedText = payload[0]
            .map(segment => Array.isArray(segment) ? String(segment[0] ?? '') : '')
            .join('')
            .replace(/\r\n?/g, '\n');

        if (!translatedText && payload[0].length > 0) {
            throw new Error('[Google Translate] Empty translation response');
        }
        return translatedText;
    }

    async function requestTranslation(text, targetLanguage) {
        let lastError = null;

        for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

            try {
                const body = new URLSearchParams({
                    client: 'gtx',
                    sl: 'auto',
                    tl: targetLanguage,
                    dt: 't',
                    q: text
                });
                const response = await fetch(ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                    },
                    body: body.toString(),
                    signal: controller.signal
                });

                if (!response.ok) {
                    throw createHttpError(response);
                }

                return parseTranslatedText(await response.json());
            } catch (error) {
                const normalizedError = error?.name === 'AbortError'
                    ? new Error('[Google Translate] Request timed out')
                    : error;
                normalizedError.retryable = RETRYABLE_ERROR_NAMES.has(error?.name) || error?.retryable === true;
                lastError = normalizedError;

                if (!normalizedError.retryable || attempt + 1 >= MAX_REQUEST_ATTEMPTS) {
                    break;
                }
                await delay(400 * (attempt + 1));
            } finally {
                clearTimeout(timeout);
            }
        }

        throw lastError || new Error('[Google Translate] Request failed');
    }

    function buildLineChunks(lines) {
        const chunks = [];
        let start = 0;

        while (start < lines.length) {
            let end = start;
            let characterCount = 0;

            while (end < lines.length && end - start < MAX_CHUNK_LINES) {
                const nextLength = lines[end].length + (end > start ? 1 : 0);
                if (end > start && characterCount + nextLength > MAX_CHUNK_CHARACTERS) {
                    break;
                }
                characterCount += nextLength;
                end++;
            }

            chunks.push({ start, lines: lines.slice(start, end) });
            start = end;
        }

        return chunks;
    }

    function splitTranslatedLines(translatedText, expectedLineCount) {
        const lines = translatedText.split('\n');
        if (lines.length === expectedLineCount) {
            return lines;
        }

        if (lines.length === expectedLineCount + 1 && lines.at(-1) === '') {
            return lines.slice(0, -1);
        }
        return null;
    }

    async function translateMetadataFields(fields, targetLanguage) {
        const translatedText = await requestTranslation(fields.join('\n'), targetLanguage);
        const translatedFields = splitTranslatedLines(translatedText, fields.length);
        if (translatedFields) return translatedFields;
        return Promise.all(fields.map(field => requestTranslation(field, targetLanguage)));
    }

    async function translateChunk(lines, targetLanguage) {
        if (lines.length === 0) return [];
        if (lines.every(line => !line.trim())) return lines.map(() => '');

        const translatedText = await requestTranslation(lines.join('\n'), targetLanguage);
        const translatedLines = splitTranslatedLines(translatedText, lines.length);
        if (translatedLines) {
            return translatedLines.map((line, index) => {
                if (!lines[index].trim()) return '';
                if (PROTECTED_LINE_PATTERN.test(lines[index])) return lines[index];
                return line;
            });
        }

        if (lines.length === 1) {
            throw new Error('[Google Translate] Could not preserve lyric line alignment');
        }

        const middle = Math.ceil(lines.length / 2);
        const left = await translateChunk(lines.slice(0, middle), targetLanguage);
        const right = await translateChunk(lines.slice(middle), targetLanguage);
        return [...left, ...right];
    }

    async function repairSimultaneousVocalParts(sourceLine, translatedLine, targetLanguage) {
        const sourceParts = sourceLine.split(' / ');
        if (sourceParts.length <= 1 || translatedLine.split(' / ').length === sourceParts.length) {
            return translatedLine;
        }

        const translatedParts = [];
        for (const part of sourceParts) {
            translatedParts.push(await requestTranslation(part, targetLanguage));
        }
        return translatedParts.join(' / ');
    }

    async function translateLyricsLines(text, targetLanguage, onLine) {
        const sourceLines = String(text).replace(/\r\n?/g, '\n').split('\n');
        const outputLines = new Array(sourceLines.length).fill('');

        for (const chunk of buildLineChunks(sourceLines)) {
            const translatedLines = await translateChunk(chunk.lines, targetLanguage);

            for (let offset = 0; offset < translatedLines.length; offset++) {
                const lineIndex = chunk.start + offset;
                const translatedLine = await repairSimultaneousVocalParts(
                    sourceLines[lineIndex],
                    translatedLines[offset],
                    targetLanguage
                );
                outputLines[lineIndex] = translatedLine;
                if (typeof onLine === 'function') {
                    onLine(lineIndex, translatedLine, { provider: ADDON_INFO.id, final: true });
                }
            }
        }

        return outputLines;
    }

    const addon = {
        ...ADDON_INFO,

        async init() {
            window.__ivLyricsDebugLog?.(`[Google Translate Addon] Initialized (v${ADDON_INFO.version})`);
        },

        getSettingsUI() {
            return null;
        },

        async testConnection() {
            const result = await requestTranslation('こんにちは', 'en');
            if (!result.trim()) {
                throw new Error('[Google Translate] Connection test returned no text');
            }
            return true;
        },

        async translateLyrics({ text, lang, wantSmartPhonetic, onLine }) {
            if (wantSmartPhonetic) {
                throw new Error('[Google Translate] Pronunciation generation is not supported');
            }
            if (!text?.trim()) {
                throw new Error('[Google Translate] No text provided');
            }

            const targetLanguage = normalizeTargetLanguage(lang);
            const translation = await translateLyricsLines(text, targetLanguage, onLine);
            return { translation };
        },

        async translateMetadata({ title, artist, lang }) {
            if (!title?.trim() || !artist?.trim()) {
                throw new Error('[Google Translate] Title and artist are required');
            }

            const targetLanguage = normalizeTargetLanguage(lang);
            const translation = await translateMetadataFields(
                [title.trim(), artist.trim()],
                targetLanguage
            );
            if (!Array.isArray(translation) || translation.length !== 2) {
                throw new Error('[Google Translate] Invalid metadata translation response');
            }

            return {
                translated: {
                    title: translation[0]?.trim() || title.trim(),
                    artist: translation[1]?.trim() || artist.trim()
                },
                romanized: {
                    title: title.trim(),
                    artist: artist.trim()
                }
            };
        }
    };

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(addon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();
})();
