/**
 * AI Addon Manager
 * AI 제공자(Gemini, ChatGPT 등) Addon들을 관리하는 중앙 시스템
 * 
 * @author ivLis STUDIO
 * @description 번역, 발음, TMI 생성을 위한 AI Addon 등록 및 관리
 */

(() => {
    'use strict';

    // ============================================
    // Constants
    // ============================================

    const STORAGE_PREFIX = 'ivLyrics:ai:';
    const getStoredValue = (key) => window.ivLyricsStoragePersistence
        ? window.ivLyricsStoragePersistence.getItem(key)
        : Spicetify.LocalStorage.get(key);
    const setStoredValue = (key, value) => window.ivLyricsStoragePersistence
        ? window.ivLyricsStoragePersistence.setItem(key, value)
        : Spicetify.LocalStorage.set(key, value);

    // 기능 유형
    const AI_CAPABILITIES = {
        TRANSLATE: 'translate',    // 가사 번역/발음
        METADATA: 'metadata',      // 메타데이터 번역
        TMI: 'tmi',                // TMI 생성
        LYRICS_STUDY: 'lyricsStudy', // 가사 기반 학습 모드 생성
        CHARACTER_PRONUNCIATION: 'characterPronunciation', // 문자별 발음
        CULTURAL_ANNOTATIONS: 'culturalAnnotations' // 번역만으로 전달되지 않는 문화적 배경 설명
    };

    const TRANSLATION_STYLES = Object.freeze({
        NATURAL: 'natural',
        LITERAL: 'literal',
        ADAPTIVE: 'adaptive'
    });
    const DEFAULT_TRANSLATION_STYLE = TRANSLATION_STYLES.NATURAL;
    const TRANSLATION_STYLE_STORAGE_KEY = `${STORAGE_PREFIX}translation-style`;
    const VALID_TRANSLATION_STYLES = new Set(Object.values(TRANSLATION_STYLES));
    const PROMPT_LANGUAGE_DATA = {
        ko: { name: 'Korean', native: '한국어', phoneticDesc: 'Korean Hangul pronunciation (e.g., こんにちは → 콘니치와)' },
        en: { name: 'English', native: 'English', phoneticDesc: 'English romanization (e.g., こんにちは → konnichiwa)' },
        'zh-cn': { name: 'Simplified Chinese', native: '简体中文', phoneticDesc: 'Chinese characters for pronunciation' },
        'zh-tw': { name: 'Traditional Chinese', native: '繁體中文', phoneticDesc: 'Chinese characters for pronunciation' },
        ja: { name: 'Japanese', native: '日本語', phoneticDesc: 'Japanese Katakana pronunciation' },
        hi: { name: 'Hindi', native: 'हिन्दी', phoneticDesc: 'Hindi Devanagari pronunciation' },
        es: { name: 'Spanish', native: 'Español', phoneticDesc: 'Spanish phonetic spelling' },
        fr: { name: 'French', native: 'Français', phoneticDesc: 'French phonetic spelling' },
        ar: { name: 'Arabic', native: 'العربية', phoneticDesc: 'Arabic script pronunciation' },
        fa: { name: 'Persian', native: 'فارسی', phoneticDesc: 'Persian script pronunciation' },
        de: { name: 'German', native: 'Deutsch', phoneticDesc: 'German phonetic spelling' },
        ru: { name: 'Russian', native: 'Русский', phoneticDesc: 'Russian Cyrillic pronunciation' },
        sv: { name: 'Swedish', native: 'Svenska', phoneticDesc: 'Swedish phonetic spelling' },
        pt: { name: 'Portuguese', native: 'Português', phoneticDesc: 'Portuguese phonetic spelling' },
        bn: { name: 'Bengali', native: 'বাংলা', phoneticDesc: 'Bengali script pronunciation' },
        cs: { name: 'Czech', native: 'Čeština', phoneticDesc: 'Czech phonetic spelling' },
        it: { name: 'Italian', native: 'Italiano', phoneticDesc: 'Italian phonetic spelling' },
        th: { name: 'Thai', native: 'ไทย', phoneticDesc: 'Thai script pronunciation' },
        tr: { name: 'Turkish', native: 'Türkçe', phoneticDesc: 'Turkish phonetic spelling' },
        vi: { name: 'Vietnamese', native: 'Tiếng Việt', phoneticDesc: 'Vietnamese phonetic spelling' },
        id: { name: 'Indonesian', native: 'Bahasa Indonesia', phoneticDesc: 'Indonesian phonetic spelling' },
        ms: { name: 'Malay', native: 'Bahasa Melayu', phoneticDesc: 'Malay phonetic spelling' }
    };

    const normalizeTranslationStyle = (style) => {
        const normalized = String(style || '').trim().toLowerCase();
        return VALID_TRANSLATION_STYLES.has(normalized)
            ? normalized
            : DEFAULT_TRANSLATION_STYLE;
    };

    const getTranslationLanguageInfo = (lang) => {
        const normalized = String(lang || 'en').trim().replace(/_/g, '-').toLowerCase();
        const shortLang = normalized.split('-')[0];
        return PROMPT_LANGUAGE_DATA[normalized]
            || PROMPT_LANGUAGE_DATA[shortLang]
            || { name: String(lang || 'English'), native: String(lang || 'English') };
    };

    const getProviderPromptLanguageInfo = (lang) => {
        const normalized = String(lang || 'en').trim().replace(/_/g, '-').toLowerCase();
        const shortLang = normalized.split('-')[0];
        return PROMPT_LANGUAGE_DATA[normalized]
            || PROMPT_LANGUAGE_DATA[shortLang]
            || PROMPT_LANGUAGE_DATA.en;
    };

    const getTranslationStyleInstruction = (style) => {
        switch (normalizeTranslationStyle(style)) {
            case TRANSLATION_STYLES.LITERAL:
                return 'Stay close to the original wording, word order, imagery, metaphors, and ambiguity. Change only what is necessary for grammatical, understandable target-language text.';
            case TRANSLATION_STYLES.ADAPTIVE:
                return 'Use nearby lines as context so the lyrics read as one smooth, connected passage. You may lightly reshape idioms and phrasing for fluency, but do not add, omit, or move meaning between lines.';
            case TRANSLATION_STYLES.NATURAL:
            default:
                return 'Use natural, idiomatic phrasing while preserving each line\'s meaning, tone, imagery, and level of formality. Do not add, omit, or move meaning between lines.';
        }
    };

    // 기본 활성화 Addon (모든 AI Addon은 API 키 설정 후 활성화 권장)
    const DEFAULT_ENABLED_ADDONS = [];
    const PROVIDERS_WITHOUT_PHONETIC_DESCRIPTION = new Set([
        'claude',
        'groq',
        'openrouter',
        'paxsenix',
        'perplexity'
    ]);
    const CHARACTER_PRONUNCIATION_CJK_LANG_RE = /^(ja|jp|ko|kr|zh|zh-cn|zh-tw|cn|tw|yue|cmn)$/i;
    const CHARACTER_PRONUNCIATION_CJK_SCRIPT_RE = /[\u3040-\u30ff\uff66-\uff9f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u;
    const CHARACTER_PRONUNCIATION_WORD_TEXT_RE = /[\p{L}\p{N}]/u;

    const validateLyricsTranslationResult = (result, params, providerId) => {
        const field = params?.wantSmartPhonetic ? 'phonetic' : 'translation';
        const value = field === 'translation'
            ? (result?.translation ?? result?.vi)
            : result?.phonetic;
        const lines = Array.isArray(value)
            ? value.map(line => String(line ?? ''))
            : (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').split('\n') : null);
        const sourceLines = String(params?.text ?? '').replace(/\r\n?/g, '\n').split('\n');
        const providerLabel = String(providerId || 'unknown');

        if (!lines) {
            throw new Error(`[AIAddonManager] Provider ${providerLabel} returned an invalid ${field} result`);
        }
        if (lines.length !== sourceLines.length) {
            throw new Error(`[AIAddonManager] Provider ${providerLabel} returned ${lines.length} lines; expected ${sourceLines.length}`);
        }
        if (lines.every(line => !line.trim())) {
            throw new Error(`[AIAddonManager] Provider ${providerLabel} returned an empty ${field} result`);
        }

        const missingLineIndex = lines.findIndex((line, index) => sourceLines[index].trim() && !line.trim());
        if (missingLineIndex >= 0) {
            throw new Error(`[AIAddonManager] Provider ${providerLabel} returned an empty line at index ${missingLineIndex + 1}`);
        }

        return result;
    };

    // ============================================
    // Shared Prompt Builders
    // ============================================

    function buildLyricsPhoneticPrompt({ text, lang, providerId } = {}) {
        const normalizedText = String(text ?? '').replace(/\r\n?/g, '\n');
        const langInfo = getProviderPromptLanguageInfo(lang);
        const lineCount = normalizedText.split('\n').length;
        const isEnglish = lang === 'en';
        const personalStudyPrefix = providerId === 'perplexity'
            ? 'This request is only for personal study. '
            : '';
        const phoneticDescription = PROVIDERS_WITHOUT_PHONETIC_DESCRIPTION.has(providerId)
            ? ''
            : langInfo.phoneticDesc || '';
        const scriptInstruction = isEnglish
            ? 'Use Latin alphabet only (romanization). Example: こんにちは → konnichiwa, 안녕하세요 → annyeonghaseyo'
            : `Write pronunciation in ${langInfo.native} script. ${phoneticDescription}`;

        return `${personalStudyPrefix}You are a pronunciation converter. Convert these ${lineCount} lines of lyrics into how they SOUND (pronunciation) for ${langInfo.name} speakers.
${scriptInstruction}

CRITICAL RULES:
- This is a PRONUNCIATION task, NOT a translation task
- Output how each line SOUNDS when spoken aloud, written in ${isEnglish ? 'Latin alphabet' : langInfo.native + ' script'}
- Do NOT translate the meaning of the lyrics
- Do NOT output the original lyrics unchanged
- Output EXACTLY ${lineCount} lines, one pronunciation per line
- If an input line contains " / " between simultaneous vocal parts, preserve " / " and convert each part separately
- Keep empty lines as empty
- Keep ♪ symbols and markers like [Chorus], (Yeah) as-is
- Do NOT add line numbers, prefixes, or explanations
- Do NOT use JSON or code blocks
- Just output the pronunciations, nothing else

INPUT:
${normalizedText}

OUTPUT (${lineCount} lines of pronunciation only):`;
    }

    function buildCharacterPronunciationPrompt({ lines, lang = 'ko', sourceLang = 'auto', unitMode = 'char' } = {}) {
        const safeLines = (Array.isArray(lines) ? lines : []).map(line => String(line ?? ''));
        const langInfo = getProviderPromptLanguageInfo(lang);
        const isWordMode = unitMode === 'word';
        const payload = safeLines.map((text, index) => {
            const chars = Array.from(text);
            return isWordMode
                ? { i: index, t: text, n: chars.length }
                : { i: index, a: chars, n: chars.length };
        });
        const outputRules = isWordMode
            ? `- Output compact JSON only: top key l; each line has i and u; each pronunciation item has s=start character index, e=end character index, and p=whole word pronunciation.
- Split each line by whitespace into word/token ranges. Do not split alphabetic words into letters.
- Omit whitespace and punctuation-only tokens from u to save tokens.
- p must be one natural spoken pronunciation for the whole word/token in ${langInfo.native}.`
            : `- Output compact JSON only: top key l; each line has i and p.
- p must be an array of exactly n strings, one per input character a[index].
- If n is 12, p must contain exactly 12 strings. An array with 11 or 13 strings is invalid even if the pronunciation sounds correct.
- Use an empty string for characters with no separate pronunciation. Do not omit array slots.
- Each p[index] must be short and readable in ${langInfo.native}.`;
        const alignmentRules = isWordMode
            ? `- For alphabetic and whitespace-separated languages, convert each whole word to spoken pronunciation once. Do not assign syllables to individual letters.
- Example: English "hello" should be one unit like {"s":0,"e":4,"p":"??"}, not h=?/e=?/l=?.
- For contractions, liaison, vowel reduction, doubled consonants, and connected-speech effects, prefer natural sung pronunciation over literal spelling.`
            : `- For alphabetic languages, do not spell letters one by one. Convert words to spoken pronunciation first, then place that sound into the matching source character slots.
- For digraphs or combined letters (sh, ch, th, ph, qu, ll, etc.), put the combined sound in one source character slot and leave helper slots empty if needed.
- For silent letters, use an empty string in that source character slot.
- For contractions, liaison, vowel reduction, doubled consonants, and other connected-speech effects, prefer natural sung pronunciation over literal spelling.`;
        const outputShape = isWordMode
            ? '{"l":[{"i":0,"u":[{"s":0,"e":4,"p":"??"}]}]}'
            : '{"l":[{"i":0,"p":["?"]}]}';

        return `You are a multilingual lyrics pronunciation aligner for karaoke sync editing.

Task:
- Read each full lyric line first, infer the natural pronunciation in context for the input source language (${sourceLang}), then align that sound back onto the original lyric text for karaoke timing.
- Return ${isWordMode ? 'word-level' : 'character-level'} pronunciation hints in ${langInfo.name} (${langInfo.native}), not a meaning translation.
- Do NOT pronounce each character in isolation. The output must sound natural when the character hints are read in sequence.

Rules:
- Return ONLY valid JSON. No markdown, no code fences, no explanations.
- The first response character must be { and the last response character must be }. Never wrap JSON in markdown fences.
- Preserve every line index.
- Input uses compact keys: i=line index and n=character count. In character mode, a is the exact source character array and output p must align to a by array position. In word mode, t is the line text.
- In character mode, never output c or index-numbered pronunciation items. Output p as exactly n strings. p[k] is the pronunciation for source character a[k], and may contain multiple target syllables or be empty.
${outputRules}
${alignmentRules}
- For syllabic scripts, align by natural syllable sound while keeping exactly one p array slot per source character.
- For logographic scripts such as hanzi/kanji/hanja, infer the common reading from the word and put each source character's reading in that character's p slot. If a character has no separate sound, use an empty string.
- For mixed writing systems, keep pronounced suffix/helper characters aligned to their own source characters. Do not hide a following character's sound inside the previous base character.
- For Japanese specifically, handle kanji, okurigana, small kana, and sound changes naturally:
  - Never shift readings after small kana or ん. Each p array slot is tied to the exact original source character at the same array position.
  - In character mode, keep timing alignment per source character. Do not merge ordinary kana/okurigana into the previous kanji.
  - For okurigana, put its spoken sound on that kana. Example: 高く => 高=타카, く=쿠; 急ぎ => 急=이소, ぎ=기; 懐かしい => 懐=나츠, か=카, し=시, い=이.
  - Do not compress several source characters into one p slot. Example for a=["耐","え","難","い"]: p=["타","에","가타","이"], not ["타에","","가","타이"].
  - small っ should be a geminated consonant or brief stop, not つ. Example: のって => の=노, っ=ㅅ, て=데.
  - small ゃ/ゅ/ょ should combine with the previous kana; leave the small kana itself empty/omitted unless the target writing system truly needs a separate mark.
  - ん should use the context-sensitive nasal sound at the ん character itself. Do not put the next character's pronunciation on ん.
  - Correct Korean-target p array example for a=["爺","ち","ゃ","ん","婆","ち","ゃ","ん","久","し","ぶ","り"]: p=["지이","챠","","안","바","챠","","안","히","사","부","리"].
  - long vowels and vowel sequences such as ー, おう, えい, ああ should preserve length naturally.
  - particles は, へ, を should use the particle pronunciation when clearly used as particles.
Korean target examples:
${isWordMode ? '- In word mode, return English examples as whole u items per word, never as character-level p arrays.' : ''}
- English "night" should sound like "나이트", not "엔 아이 지 에이치 티". Example split: n=나, i=이, t=트; omit silent g/h.
- English "the" should sound like "더", not "티 에이치 이". Example split: t=더; omit helper h/e.
- のって should be close to "노ㅅ데" or "노옷데", not "노 츠 테". Example split: の=노, っ=ㅅ, て=데.
- 爺ちゃん should be close to "지이챠안", not "지 치 야 응". Example split: 爺=지이, ち=챠, ん=안; omit helper ゃ.

Return this compact JSON shape:
${outputShape}

Input source language: ${sourceLang}
Pronunciation unit mode: ${unitMode}
Input lines:
${JSON.stringify(payload)}`;
    }

    function buildMetadataTranslationPrompt({ title, artist, lang, providerId } = {}) {
        const langInfo = getProviderPromptLanguageInfo(lang);
        const personalStudyPrefix = providerId === 'perplexity'
            ? 'This request is only for personal study. '
            : '';

        if (providerId === 'gemini') {
            return `You are a translation API. Translate the song title and artist name to ${langInfo.name} (${langInfo.native}).

**Input**:
- Title: ${title}
- Artist: ${artist}

**Output MUST be valid JSON**:
{
  "translatedTitle": "translated title in ${langInfo.native}",
  "translatedArtist": "translated artist name in ${langInfo.native}",
  "romanizedTitle": "romanized title (Latin alphabet)",
  "romanizedArtist": "romanized artist name (Latin alphabet)"
}

**Rules**:
1. If the title/artist is already in ${langInfo.name}, keep it as-is
2. romanized fields should use Latin alphabet only
3. Do NOT use markdown code blocks`;
        }

        return `${personalStudyPrefix}Translate the song title and artist name to ${langInfo.name} (${langInfo.native}).

**Input**:
- Title: ${title}
- Artist: ${artist}

**Output valid JSON**:
{
  "translatedTitle": "translated title",
  "translatedArtist": "translated artist",
  "romanizedTitle": "romanized in Latin alphabet",
  "romanizedArtist": "romanized in Latin alphabet"
}`;
    }

    function buildTMIPrompt({ title, artist, lang } = {}) {
        const langInfo = getProviderPromptLanguageInfo(lang);

        return `You are a music knowledge expert. Generate interesting facts and trivia about the song "${title}" by "${artist}".

LANGUAGE REQUIREMENT - FOLLOW STRICTLY:
- Write ALL human-readable content in ${langInfo.name} (${langInfo.native})
- This includes track.description and every string inside track.trivia
- Do NOT write explanatory sentences in English unless the target language itself is English
- Even if the song title, artist name, album, or source pages are English, your explanation sentences must still be in ${langInfo.native}
- The only text that may remain non-${langInfo.native} is:
  1. JSON keys
  2. URLs
  3. Proper nouns, official song titles, artist names, album names, and short quoted lyric fragments
  4. reliability.confidence enum values: "very_high", "high", "medium", "low", "none"

Before returning, silently verify:
- track.description is fully written in ${langInfo.native}
- every item in track.trivia is fully written in ${langInfo.native}
- if any sentence is mostly English, rewrite it into natural ${langInfo.native} before returning

Return ONLY valid JSON. Do not add any text before or after the JSON.

**Output JSON Structure**:
{
  "track": {
    "description": "2-3 sentence description in ${langInfo.native}",
    "trivia": [
      "Fact 1 in ${langInfo.native}",
      "Fact 2 in ${langInfo.native}",
      "Fact 3 in ${langInfo.native}"
    ],
    "sources": {
      "verified": [],
      "related": [],
      "other": []
    },
    "reliability": {
      "confidence": "medium",
      "has_verified_sources": false,
      "verified_source_count": 0,
      "related_source_count": 0,
      "total_source_count": 0
    }
  }
}

**Rules**:
1. description: write 2-3 natural sentences in ${langInfo.native}
2. trivia: include 3-5 concise facts, each written in ${langInfo.native}
3. Prefer natural ${langInfo.native} wording, not mixed-language fragments
4. Be accurate - if you're not sure about a fact, mark confidence as "low"
5. Do NOT use markdown code blocks
6. Do NOT add any explanation outside the JSON`;
    }

    function buildLyricsStudyPrompt({ title, artist, targetLang, sourceLang = 'auto', lines = [], category = 'lines', difficulty = 'normal', chunkIndex = 1, chunkTotal = 1 } = {}) {
        const langInfo = getProviderPromptLanguageInfo(targetLang || 'ko');
        const normalizedDifficulty = ['easy', 'normal', 'hard', 'native'].includes(String(difficulty || '').toLowerCase()) ? String(difficulty || '').toLowerCase() : 'normal';
        const difficultyMap = {
            easy: {
                label: 'Easy',
                guidance: 'Assume a beginner or lower-intermediate learner. Use short explanations, define common words, avoid jargon, and make quiz distractors clearly distinguishable.'
            },
            normal: {
                label: 'Normal',
                guidance: 'Assume an intermediate learner. Balance natural meaning, useful grammar, vocabulary nuance, and practical examples.'
            },
            hard: {
                label: 'Hard',
                guidance: 'Assume an advanced learner. Include finer nuance, grammar contrasts, register, collocation, and more challenging quiz distractors.'
            },
            native: {
                label: 'Native-level',
                guidance: 'Assume a near-native learner. Explain subtle tone, implication, idiom, literary compression, rhythm, and natural alternatives without simplifying too much.'
            }
        };
        const difficultyInfo = difficultyMap[normalizedDifficulty] || difficultyMap.normal;
        const pronunciationGuide = [
            `Use one pronunciation style across every chunk: IPA-style phonetic transcription in Latin/IPA symbols.`,
            `Wrap it in /.../ for phonemic pronunciation or [...] for close phonetic detail.`,
            `Do not write pronunciation in the target language script, and do not use ad-hoc syllable romanization.`,
            `For example, write "like ships in the night" as "/laɪk ʃɪps ɪn ðə naɪt/", not "라이크 쉽스 인 나이트" and not "lie-ku ships in nightu".`,
            `For Japanese lyrics, keep kana/furigana only in "reading"; use IPA-style Latin/IPA symbols in "pronunciation".`
        ].join(" ");
        const payload = lines.map((line) => ({
            index: Number(line.index),
            text: String(line.text || '')
        })).filter((line) => Number.isFinite(line.index) && line.text.trim());
        const normalizedCategory = ['summary', 'lines', 'expressions', 'quiz'].includes(category) ? category : 'lines';
        const categoryRules = {
            summary: `Create only a compact learning-focused song summary. Explain the emotional situation, speaker attitude, and 2-3 language-learning takeaways. Do not create line notes, expressions, or quiz items.`,
            lines: `Create line-level learning cards for every provided lyric line. Keep each explanation short but specific. Include reading and pronunciation when useful. Include 1-2 grammar/pattern notes for each line that has a reusable structure; each note must explain how the pattern works in this lyric.`,
            expressions: `Create only 1-2 vocabulary expansion cards from words or short phrases that actually appear in the provided lyrics. Prefer practical items where learners benefit from alternatives, related words, or forms such as tense, base form, past participle, polite/casual form, particles, or collocations. Do not list many key phrases.`,
            quiz: `Create only 2-4 choice-based quiz items from the provided lyrics. Mix formats using the type field: meaning, blank, usage, rewrite, and grammar. Include fill-in-the-blank items where the question contains ____ and the choices are candidate words or short phrases. Include practical transfer items that ask how a lyric expression would be used or rephrased in everyday conversation, work email, meeting, or other non-lyric context. Do not make every question a literal lyric translation. Distractors must be plausible. Each question must include a lineIndex and should show the actual lyric phrase instead of referring to a line number. Include reading and pronunciation if the question quotes a lyric.`
        };
        const outputShapes = {
            summary: `{
  "summary": "2-3 sentence learning-focused summary in ${langInfo.native}"
}`,
            lines: `{
  "lines": [
    {
      "index": 0,
      "reading": "hiragana/kana reading if the lyric is Japanese; otherwise optional reading aid",
      "pronunciation": "IPA-style pronunciation if useful, e.g. /laɪk ʃɪps/; no local-script or ad-hoc romanization",
      "translation": "natural meaning in ${langInfo.native}",
      "explanation": "line-level explanation in ${langInfo.native}",
      "grammar": [{ "pattern": "reusable structure or grammar point", "explanation": "how it works in this lyric in ${langInfo.native}", "note": "short nuance or usage note in ${langInfo.native}" }],
      "vocabulary": [{ "term": "word", "reading": "hiragana/kana reading if Japanese", "pronunciation": "IPA-style pronunciation if useful", "meaning": "meaning in ${langInfo.native}", "note": "optional note in ${langInfo.native}" }]
    }
  ]
}`,
            expressions: `{
  "keyExpressions": [
    { "expression": "word or short phrase from the lyric", "reading": "hiragana/kana reading if Japanese", "pronunciation": "IPA-style pronunciation if useful", "meaning": "meaning in ${langInfo.native}", "note": "practical learner note in ${langInfo.native}", "alternatives": ["substitutable expression"], "forms": ["base/past/past participle or other useful forms"], "relatedWords": ["similar or related word"], "lineIndexes": [0] }
  ]
}`,
            quiz: `{
  "quiz": [
    { "type": "meaning|blank|usage|rewrite|grammar", "question": "question in ${langInfo.native}; for blank type include ____ where the missing word/phrase goes", "choices": ["A", "B", "C", "D"], "answerIndex": 0, "explanation": "why in ${langInfo.native}", "lineIndex": 0, "reading": "optional", "pronunciation": "optional" }
  ]
}`
        };

        return `You are a language learning tutor inside a lyrics app. Build one category of a compact study pack from the provided song lyrics.

Target explanation language: ${langInfo.name} (${langInfo.native})
Detected/source language: ${sourceLang}
Song: ${title || ''}
Artist: ${artist || ''}
Category: ${normalizedCategory}
Difficulty: ${difficultyInfo.label}
Difficulty guidance: ${difficultyInfo.guidance}
Chunk: ${chunkIndex}/${chunkTotal}

Rules:
- Return ONLY valid JSON. No markdown, no code fences, no extra text.
- Write every human-readable explanation, meaning, question, and quiz explanation in ${langInfo.native}.
- Match the selected difficulty. Easy should be simpler and more scaffolded; hard/native-level should include deeper nuance and more demanding quiz distractors.
- Keep original lyric fragments short. Do not quote long lyric passages.
- Preserve original line indexes exactly.
- Do not refer to "line 3", "3rd line", "N번째 줄", or similar labels. Show the actual lyric phrase when a specific lyric matters.
- ${pronunciationGuide}
- Add "pronunciation" only when it helps; when present, it must follow the pronunciation style above.
- If the source lyric is Japanese or contains kanji, add "reading" as hiragana/kana reading. Do not put an explanation in "reading"; only the reading text.
- Explain useful vocabulary, grammar, idioms, tone, and natural meaning.
- Use the "grammar" array for reusable patterns, particles, verb forms, sentence endings, tense/aspect, omitted subjects, or word order. Do not leave grammar as only a label; include a concrete explanation tied to the lyric.
- Avoid generic filler such as "this is poetic" unless you explain the exact language cue. Prefer one practical learner insight over broad textbook summaries.
- When a word or phrase has nuance, explain the contrast with the literal meaning or a more common alternative.
- For the expressions category, output expansion cards, not a long list of key phrases. Base each item on a lyric word or short phrase and include alternatives/forms/relatedWords only when useful.
- For quiz items, vary answerIndex. Do not place every correct answer at choices[0].
- For quiz items, vary the type field. Do not make all items meaning questions; use blank, usage, rewrite, and grammar when the lyric supports them.
- For blank type, put ____ directly in the question and make choices short words or phrases that fit the blank.
- For blank type, include enough context in the question itself because the full original lyric line may be hidden while the learner answers.
- For quiz items, include some practical transfer questions when possible: how to say the idea naturally in everyday speech, how to soften it, or how to adapt it for workplace/formal writing.
- Repeated lyric phrases should produce at most one quiz item across the whole pack. If the same sentence or chorus line appears again, skip it and choose a different lyric phrase.
- If a line is too simple, keep its explanation short.
- Generate only the requested category. Omit unrelated top-level keys.

Task:
${categoryRules[normalizedCategory]}

Output JSON shape:
${outputShapes[normalizedCategory]}

Input lines:
${JSON.stringify(payload)}`;
    }

    function buildCulturalAnnotationsPrompt({ sourceLang = 'auto', targetLang = 'ko', lines = [] } = {}) {
        const targetLangInfo = getProviderPromptLanguageInfo(targetLang || 'ko');
        const payload = (Array.isArray(lines) ? lines : [])
            .map((line, fallbackIndex) => ({
                lineIndex: Number.isInteger(Number(line?.lineIndex ?? line?.index))
                    ? Number(line?.lineIndex ?? line?.index)
                    : fallbackIndex,
                text: String(line?.text ?? '')
            }));

        return `You analyze song lyrics for cultural context that ordinary translation cannot fully convey.

Input source language code: ${sourceLang || 'auto'}
Explanation language: ${targetLangInfo.name} (${targetLangInfo.native})

GOAL:
Identify only expressions whose meaning depends on cultural background that a reader from another culture is likely to miss. This is not a translation, vocabulary, grammar, slang, or general lyric explanation task.

ANNOTATE ONLY WHEN SEPARATE CULTURAL KNOWLEDGE IS REQUIRED:
- country- or region-specific school life and education systems
- traditional or widely known local children's games
- local customs involving broadcasting, transport, housing, festivals, or daily life
- historical, religious, or social institutions and their cultural implications
- clear quotations or parodies from films, television, animation, comics, games, literature, advertising, or songs
- expressions with a special established meaning in a particular culture
- cases where translation conveys the surface meaning but loses an important cultural implication

DO NOT ANNOTATE:
- ordinary words or sentences
- onomatopoeia or mimetic words that translate naturally
- ordinary metaphors, exaggeration, slang, or colloquial speech
- expressions understandable from context
- anything adequately conveyed by literal or natural translation
- grammar or word formation unless it is directly necessary for the cultural explanation

STRICT JUDGMENT RULES:
- When uncertain, omit the annotation. Accuracy matters more than quantity.
- Mention a quotation or parody only when the evidence is strong. Do not speculate.
- Do not infer a country or culture from the source language alone. Use internal textual evidence. If the culture is unclear, omit it.
- Explain a repeated cultural expression in detail only at its first occurrence.
- Do not translate the full lyrics.
- Every note must be written naturally in ${targetLangInfo.native}.
- When explaining an original expression, include its natural ${targetLangInfo.native} translation in this exact conceptual format: 「original expression」(natural translation). Use locally natural quotation marks if 「」 is inappropriate.
- Keep each note concise but complete, normally one or two sentences.

OUTPUT CONTRACT:
- Return ONLY valid JSON, without Markdown or code fences.
- Return sparse annotations only. An empty annotations array is a correct result when no cultural explanation is needed.
- Use only lineIndex values present in the input.
- Each annotated line may appear at most once.
- Put the complete display-ready explanation in note. Do not prefix note with ↳; the app adds it.

Output shape:
{
  "annotations": [
    {
      "lineIndex": 0,
      "note": "Explanation in ${targetLangInfo.native}, including 「original expression」(natural translation)."
    }
  ]
}

Input lines:
${JSON.stringify(payload)}`;
    }

    function normalizeCulturalAnnotationsResult(result, lines, providerId) {
        const validIndexes = new Set(
            (Array.isArray(lines) ? lines : [])
                .map((line, fallbackIndex) => Number(line?.lineIndex ?? line?.index ?? fallbackIndex))
                .filter(Number.isInteger)
        );
        if (!result || !Array.isArray(result.annotations)) {
            throw new Error(`[AIAddonManager] Provider ${providerId || 'unknown'} returned an invalid cultural annotations result`);
        }

        const seenIndexes = new Set();
        const annotations = [];
        for (const item of result.annotations) {
            const lineIndex = Number(item?.lineIndex);
            const note = String(item?.note ?? '').trim();
            if (!Number.isInteger(lineIndex) || !validIndexes.has(lineIndex) || !note || seenIndexes.has(lineIndex)) {
                continue;
            }
            seenIndexes.add(lineIndex);
            annotations.push({ lineIndex, note });
        }

        annotations.sort((a, b) => a.lineIndex - b.lineIndex);
        return { annotations, provider: providerId || result.provider || null };
    }

    // ============================================
    // AIAddonManager Class
    // ============================================

    class AIAddonManager {
        constructor() {
            this._addons = new Map();
            this._initialized = false;
            this._initPromise = null;

            // EventEmitter 믹스인
            this._events = new Map();
            this._onceEvents = new Map();
            this._marketplaceAddons = new Set(); // 마켓플레이스에서 설치된 에드온 추적
        }

        // ============================================
        // Helpers
        // ============================================

        _t(key, fallback) {
            if (window.I18n && typeof window.I18n.t === 'function') {
                return window.I18n.t(key) || fallback;
            }
            return fallback;
        }

        /**
         * 가사 번역 스타일 저장
         * @param {'natural'|'literal'|'adaptive'} style
         * @returns {string} 정규화된 스타일
         */
        setTranslationStyle(style) {
            const normalized = normalizeTranslationStyle(style);
            const previous = this.getTranslationStyle();
            setStoredValue(TRANSLATION_STYLE_STORAGE_KEY, normalized);

            if (previous !== normalized) {
                this.emit('translation:style:changed', { style: normalized, previous });
            }
            return normalized;
        }

        /**
         * 현재 가사 번역 스타일 가져오기
         * @returns {'natural'|'literal'|'adaptive'}
         */
        getTranslationStyle() {
            return normalizeTranslationStyle(getStoredValue(TRANSLATION_STYLE_STORAGE_KEY));
        }

        /**
         * 모든 AI 제공자가 공유하는 가사 번역 시스템 프롬프트 생성
         * @param {Object} params - { text, lang, translationStyle }
         * @returns {{systemPrompt: string, userPrompt: string, style: string, lineCount: number}}
         */
        buildLyricsTranslationPrompt({ text, lang, translationStyle } = {}) {
            const normalizedText = String(text ?? '').replace(/\r\n?/g, '\n');
            const lineCount = normalizedText.split('\n').length;
            const style = normalizeTranslationStyle(translationStyle || this.getTranslationStyle());
            const langInfo = getTranslationLanguageInfo(lang);
            const styleInstruction = getTranslationStyleInstruction(style);

            const systemPrompt = `You are the lyrics translation system for ivLyrics.

Translate song lyrics into ${langInfo.name} (${langInfo.native}).

TRANSLATION STYLE:
${styleInstruction}

CRITICAL OUTPUT CONTRACT:
- This is a translation task. Translate the meaning of every non-empty lyric line.
- Write the translated lyrics in ${langInfo.name} (${langInfo.native}) only.
- Never return the original lyrics unchanged, romanization, or pronunciation instead of a translation.
- Return exactly ${lineCount} lines, with one output line for each input line in the same order.
- Never merge multiple input lines or split one input line into multiple output lines.
- You may use surrounding lines only to understand context; output line N must still represent input line N.
- Preserve " / " between simultaneous vocal parts and translate each part separately.
- Preserve empty lines as empty lines.
- Preserve music symbols and structural markers such as ♪, [Chorus], and (Yeah).
- Do not add line numbers, prefixes, explanations, JSON, Markdown, or code fences.
- Return only the translated lyric lines.`;

            const userPrompt = `Translate the following ${lineCount} lyric lines. Return exactly ${lineCount} lines and nothing else.

<lyrics>
${normalizedText}
</lyrics>`;

            return { systemPrompt, userPrompt, style, lineCount };
        }

        buildLyricsPhoneticPrompt(params = {}) {
            return buildLyricsPhoneticPrompt(params);
        }

        buildCharacterPronunciationPrompt(params = {}) {
            return buildCharacterPronunciationPrompt(params);
        }

        buildMetadataTranslationPrompt(params = {}) {
            return buildMetadataTranslationPrompt(params);
        }

        buildTMIPrompt(params = {}) {
            return buildTMIPrompt(params);
        }

        buildLyricsStudyPrompt(params = {}) {
            return buildLyricsStudyPrompt(params);
        }

        buildCulturalAnnotationsPrompt(params = {}) {
            return buildCulturalAnnotationsPrompt(params);
        }

        // ============================================
        // EventEmitter Methods
        // ============================================

        /**
         * 이벤트 리스너 등록
         * @param {string} event - 이벤트 이름
         * @param {Function} listener - 콜백 함수
         * @returns {Function} unsubscribe 함수
         */
        on(event, listener) {
            if (!this._events.has(event)) {
                this._events.set(event, new Set());
            }
            this._events.get(event).add(listener);
            return () => this.off(event, listener);
        }

        /**
         * 일회성 이벤트 리스너 등록
         */
        once(event, listener) {
            if (!this._onceEvents.has(event)) {
                this._onceEvents.set(event, new Set());
            }
            this._onceEvents.get(event).add(listener);
        }

        /**
         * 이벤트 리스너 제거
         */
        off(event, listener) {
            if (this._events.has(event)) {
                this._events.get(event).delete(listener);
            }
            if (this._onceEvents.has(event)) {
                this._onceEvents.get(event).delete(listener);
            }
        }

        /**
         * 이벤트 발생
         */
        emit(event, ...args) {
            // 디버그 로깅
            if (window.AddonDebug?.isEnabled()) {
                window.AddonDebug.log('events', `AIAddonManager.emit: ${event}`, args[0]);
            }

            if (this._events.has(event)) {
                for (const listener of this._events.get(event)) {
                    try {
                        listener(...args);
                    } catch (e) {
                        console.error(`[AIAddonManager] Error in listener for "${event}":`, e);
                    }
                }
            }

            if (this._onceEvents.has(event)) {
                const onceListeners = this._onceEvents.get(event);
                this._onceEvents.delete(event);
                for (const listener of onceListeners) {
                    try {
                        listener(...args);
                    } catch (e) {
                        console.error(`[AIAddonManager] Error in once listener for "${event}":`, e);
                    }
                }
            }
        }

        /**
         * 초기화
         */
        async init() {
            if (this._initialized) return;
            if (this._initPromise) return this._initPromise;

            this._initPromise = (async () => {
                window.__ivLyricsDebugLog?.('[AIAddonManager] Initializing...');

                // 등록된 모든 Addon 초기화
                for (const [id, addon] of this._addons) {
                    try {
                        if (typeof addon.init === 'function') {
                            await addon.init();
                        }
                        window.__ivLyricsDebugLog?.(`[AIAddonManager] Addon "${id}" initialized`);
                    } catch (e) {
                        console.error(`[AIAddonManager] Failed to initialize addon "${id}":`, e);
                    }
                }

                this._initialized = true;
                window.__ivLyricsDebugLog?.('[AIAddonManager] Initialization complete');
            })();

            return this._initPromise;
        }

        /**
         * Addon 등록
         * @param {Object} addon - Addon 객체
         * 
         * 필수 필드:
         * - id: string (고유 ID)
         * - name: string (표시 이름)
         * - author: string (제작자)
         * - description: string | { en: string, ko: string, ... } (설명)
         * - version: string (버전)
         * - supports: { translate: boolean, metadata: boolean, tmi: boolean, lyricsStudy: boolean, characterPronunciation: boolean, culturalAnnotations: boolean } (지원 기능)
         * 
         * 필수 메서드:
         * - getSettingsUI(): React.Component (설정 UI)
         * 
         * 기능별 메서드:
         * - translateLyrics(params): Promise<Object> (supports.translate = true인 경우)
         * - translateMetadata(params): Promise<Object> (supports.metadata = true인 경우)
         * - generateTMI(params): Promise<Object> (supports.tmi = true인 경우)
         * - generateLyricsStudy(params): Promise<Object> (supports.lyricsStudy = true인 경우)
         * - generateCharacterPronunciation(params): Promise<Object> (supports.characterPronunciation = true인 경우)
         * - generateCulturalAnnotations(params): Promise<Object> (supports.culturalAnnotations = true인 경우)
         */
        register(addon) {
            if (!addon || !addon.id) {
                console.error('[AIAddonManager] Invalid addon: missing id');
                return false;
            }

            // 필수 필드 검증
            const requiredFields = ['id', 'name', 'author', 'description', 'version'];
            for (const field of requiredFields) {
                if (!addon[field]) {
                    console.error(`[AIAddonManager] Invalid addon "${addon.id}": missing ${field}`);
                    return false;
                }
            }

            // supports 필드 기본값 설정 (기존 Addon 호환성)
            if (!addon.supports) {
                addon.supports = {
                    translate: typeof addon.translateLyrics === 'function',
                    metadata: typeof addon.translateMetadata === 'function',
                    tmi: typeof addon.generateTMI === 'function',
                    lyricsStudy: typeof addon.generateLyricsStudy === 'function',
                    characterPronunciation: typeof addon.generateCharacterPronunciation === 'function',
                    culturalAnnotations: typeof addon.generateCulturalAnnotations === 'function'
                };
            }

            // 필수 메서드 검증
            const requiredMethods = ['getSettingsUI'];
            for (const method of requiredMethods) {
                if (typeof addon[method] !== 'function') {
                    console.error(`[AIAddonManager] Invalid addon "${addon.id}": missing ${method}()`);
                    return false;
                }
            }

            this._addons.set(addon.id, addon);
            window.__ivLyricsDebugLog?.(`[AIAddonManager] Registered addon: ${addon.id} (${addon.name})`);
            window.__ivLyricsDebugLog?.(`[AIAddonManager] Supports: translate=${addon.supports.translate}, metadata=${addon.supports.metadata}, tmi=${addon.supports.tmi}, lyricsStudy=${addon.supports.lyricsStudy}, characterPronunciation=${addon.supports.characterPronunciation}, culturalAnnotations=${addon.supports.culturalAnnotations}`);

            // 이미 초기화 완료된 경우, 새 Addon도 초기화
            if (this._initialized && typeof addon.init === 'function') {
                addon.init().catch(e => {
                    console.error(`[AIAddonManager] Failed to late-init addon "${addon.id}":`, e);
                });
            }

            // 이벤트 발생
            this.emit('addon:registered', { id: addon.id, name: addon.name, type: 'ai' });

            return true;
        }

        /**
         * Addon 등록 검증 (상세 에러 메시지)
         * @param {Object} addon - 검증할 Addon 객체
         * @returns {{ valid: boolean, errors: string[] }}
         */
        validate(addon) {
            const errors = [];

            if (!addon) {
                errors.push('Addon object is null or undefined');
                return { valid: false, errors };
            }

            // 필수 필드 검증
            const requiredFields = ['id', 'name', 'author', 'description', 'version'];
            for (const field of requiredFields) {
                if (!addon[field]) {
                    errors.push(`Missing required field: "${field}"`);
                }
            }

            // 필수 메서드 검증
            if (typeof addon.getSettingsUI !== 'function') {
                errors.push('Missing required method: getSettingsUI()');
            }

            // 기능 메서드 중 최소 하나는 있어야 함
            const featureMethods = ['translateLyrics', 'translateMetadata', 'generateTMI', 'generateLyricsStudy', 'generateCharacterPronunciation', 'generateCulturalAnnotations'];
            const hasAnyFeature = featureMethods.some(m => typeof addon[m] === 'function');
            if (!hasAnyFeature) {
                errors.push(`Must implement at least one of: ${featureMethods.join(', ')}`);
            }

            // 선택 메서드 타입 검증
            if (addon.init && typeof addon.init !== 'function') {
                errors.push('Field "init" must be a function if provided');
            }
            if (addon.testConnection && typeof addon.testConnection !== 'function') {
                errors.push('Field "testConnection" must be a function if provided');
            }

            return { valid: errors.length === 0, errors };
        }

        /**
         * Addon 해제
         * @param {string} addonId - Addon ID
         */
        unregister(addonId) {
            if (this._addons.has(addonId)) {
                const addon = this._addons.get(addonId);
                this._addons.delete(addonId);
                this._marketplaceAddons.delete(addonId);
                window.__ivLyricsDebugLog?.(`[AIAddonManager] Unregistered addon: ${addonId}`);

                // 이벤트 발생
                this.emit('addon:unregistered', { id: addonId, name: addon?.name });

                return true;
            }
            return false;
        }

        /**
         * 마켓플레이스 에드온으로 표시
         * @param {string} addonId - Addon ID
         */
        markAsMarketplaceAddon(addonId) {
            this._marketplaceAddons.add(addonId);
        }

        /**
         * 마켓플레이스 에드온 여부 확인
         * @param {string} addonId - Addon ID
         * @returns {boolean}
         */
        isMarketplaceAddon(addonId) {
            return this._marketplaceAddons.has(addonId);
        }

        /**
         * Addon 가져오기
         * @param {string} addonId - Addon ID
         * @returns {Object|null}
         */
        getAddon(addonId) {
            return this._addons.get(addonId) || null;
        }

        /**
         * 모든 Addon 목록 가져오기
         * @returns {Object[]}
         */
        getAddons() {
            return Array.from(this._addons.values());
        }

        /**
         * Addon ID 목록 가져오기
         * @returns {string[]}
         */
        getAddonIds() {
            return Array.from(this._addons.keys());
        }

        // ============================================
        // Provider Order Management
        // ============================================

        /**
         * Provider 순서 저장
         * @param {string[]} order - Provider ID 순서
         */
        setProviderOrder(order) {
            setStoredValue(STORAGE_PREFIX + 'provider-order', JSON.stringify(order));
            window.__ivLyricsDebugLog?.('[AIAddonManager] Provider order saved:', order);

            // 이벤트 발생
            this.emit('provider:order:changed', { order });
        }

        /**
         * Provider 순서 가져오기
         * @returns {string[]}
         */
        getProviderOrder() {
            const stored = getStoredValue(STORAGE_PREFIX + 'provider-order');
            let order = [];

            if (stored) {
                try {
                    order = JSON.parse(stored);
                } catch {
                    // Fall through to default
                }
            }

            const allIds = this.getAddonIds();

            // 저장된 순서가 없으면 기본 순서 반환
            if (!order || order.length === 0) {
                return allIds;
            }

            // 1. 저장된 순서 중 현재 존재하는 Addon만 유지 (삭제된 Addon 제거)
            // 2. 저장된 순서에 없는 새로운 Addon을 뒤에 추가
            const validAttributes = new Set(allIds);
            const filteredOrder = order.filter(id => validAttributes.has(id));
            const orderedIds = new Set(order);
            const newIds = allIds.filter(id => !orderedIds.has(id));

            return [...filteredOrder, ...newIds];
        }

        /**
         * Provider 활성화/비활성화
         * @param {string} addonId - Addon ID
         * @param {boolean} enabled - 활성화 여부
         */
        setProviderEnabled(addonId, enabled) {
            setStoredValue(STORAGE_PREFIX + `enabled:${addonId}`, enabled ? 'true' : 'false');

            // 이벤트 발생
            this.emit('provider:enabled:changed', { id: addonId, enabled });
        }

        /**
         * Provider 활성화 여부 확인
         * @param {string} addonId - Addon ID
         * @returns {boolean}
         */
        isProviderEnabled(addonId) {
            const stored = getStoredValue(STORAGE_PREFIX + `enabled:${addonId}`);
            // 저장된 값이 없으면 기본값 확인 (Pollinations만 기본 활성화)
            if (stored === null || stored === undefined) {
                return DEFAULT_ENABLED_ADDONS.includes(addonId);
            }
            return stored === 'true';
        }

        /**
         * 활성화된 Provider 목록 (순서대로)
         * @returns {Object[]}
         */
        getEnabledProviders() {
            const order = this.getProviderOrder();
            return order
                .filter(id => this.isProviderEnabled(id) && this._addons.has(id))
                .map(id => this._addons.get(id));
        }

        /**
         * 특정 기능을 지원하는 활성화된 Provider 목록 (순서대로)
         * @param {'translate'|'metadata'|'tmi'|'lyricsStudy'|'characterPronunciation'|'culturalAnnotations'} capability - 기능 유형
         * @returns {Object[]}
         */
        getEnabledProvidersFor(capability) {
            const allProviders = this.getEnabledProviders();
            // console.log(`[AIAddonManager] Checking providers for ${capability}. Enabled total: ${allProviders.length}`);

            return allProviders.filter(addon => {
                // 1. Addon 자체가 해당 기능을 지원하는지 확인
                if (!addon.supports || addon.supports[capability] !== true) {
                    // console.log(`[AIAddonManager] Filtered out ${addon.id}: does not support ${capability}`);
                    return false;
                }
                // 2. 사용자가 해당 기능을 활성화했는지 확인 (기본값 true)
                // 메서드가 존재하지 않는 경우(구버전 캐시 등) 안전하게 true 처리
                if (typeof this.isCapabilityEnabled !== 'function') {
                    return true;
                }

                const isEnabled = this.isCapabilityEnabled(addon.id, capability);
                if (!isEnabled) {
                    // console.log(`[AIAddonManager] Filtered out ${addon.id}: capability ${capability} disabled by user setting`);
                    return false;
                }
                return true;
            });
        }

        /**
         * 특정 Addon의 특정 기능 활성화 여부 확인
         */
        isCapabilityEnabled(addonId, capability) {
            return this.getAddonSetting(addonId, `capability:${capability}`, true);
        }

        /**
         * 특정 Addon의 특정 기능 활성화 설정 저장
         */
        setCapabilityEnabled(addonId, capability, enabled) {
            this.setAddonSetting(addonId, `capability:${capability}`, enabled);
        }


        // ============================================
        // Addon Settings Storage
        // ============================================

        /**
         * Addon 설정 저장
         * @param {string} addonId - Addon ID
         * @param {string} key - 설정 키
         * @param {*} value - 설정 값
         */
        setAddonSetting(addonId, key, value) {
            const storageKey = `${STORAGE_PREFIX}addon:${addonId}:${key}`;
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            setStoredValue(storageKey, serialized);
        }

        /**
         * Addon 설정 가져오기
         * @param {string} addonId - Addon ID
         * @param {string} key - 설정 키
         * @param {*} defaultValue - 기본값
         * @returns {*}
         */
        getAddonSetting(addonId, key, defaultValue = null) {
            const storageKey = `${STORAGE_PREFIX}addon:${addonId}:${key}`;
            const value = getStoredValue(storageKey);

            if (value === null || value === undefined) {
                return defaultValue;
            }

            // JSON 파싱 시도
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        }

        /**
         * Addon의 모든 설정 가져오기
         * @param {string} addonId - Addon ID
         * @returns {Object}
         */
        getAddonSettings(addonId) {
            const prefix = `${STORAGE_PREFIX}addon:${addonId}:`;
            const settings = {};

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(prefix)) {
                    const settingKey = key.substring(prefix.length);
                    settings[settingKey] = this.getAddonSetting(addonId, settingKey);
                }
            }

            return settings;
        }

        // ============================================
        // API Methods (Priority-based Fallback)
        // ============================================

        /**
         * 메타데이터 번역 (활성화된 Provider 순서대로 시도)
         * @param {Object} params - { trackId, title, artist, lang }
         * @returns {Promise<Object|null>}
         */
        async translateMetadata(params) {
            const providers = this.getEnabledProvidersFor('metadata');

            if (providers.length === 0) {
                console.warn('[AIAddonManager] No metadata providers enabled');
                throw new Error(this._t('aiProviders.noEnabledProviders', 'No AI providers enabled. Please enable at least one provider in settings.'));
            }

            // 디버그 로깅
            if (window.AddonDebug?.isEnabled()) {
                window.AddonDebug.log('ai', 'translateMetadata called', {
                    providers: providers.map(p => p.id),
                    ...params
                });
                window.AddonDebug.time('ai', 'translateMetadata');
            }

            // 이벤트 발생
            this.emit('ai:request:start', { type: 'metadata', providers: providers.map(p => p.id), params });

            let lastError = null;

            for (const addon of providers) {
                if (typeof addon.translateMetadata !== 'function') continue;

                try {
                    window.__ivLyricsDebugLog?.(`[AIAddonManager] Trying metadata provider: ${addon.id}`);
                    const result = await addon.translateMetadata({
                        ...params,
                        metadataPrompt: this.buildMetadataTranslationPrompt({
                            ...params,
                            providerId: addon.id
                        })
                    });

                    // 디버그 타이머 종료
                    if (window.AddonDebug?.isEnabled()) {
                        window.AddonDebug.timeEnd('ai', 'translateMetadata');
                    }

                    // 이벤트 발생
                    this.emit('ai:request:success', { type: 'metadata', provider: addon.id });

                    return result;
                } catch (e) {
                    console.warn(`[AIAddonManager] Provider ${addon.id} failed for translateMetadata:`, e.message);
                    lastError = e;

                    // 다음 provider 시도
                    continue;
                }
            }

            // 모든 provider 실패
            console.error('[AIAddonManager] All metadata providers failed');

            if (window.AddonDebug?.isEnabled()) {
                window.AddonDebug.timeEnd('ai', 'translateMetadata');
                window.AddonDebug.error('ai', 'translateMetadata all providers failed');
            }

            const errorMsg = lastError?.message || this._t('aiProviders.allProvidersFailed', 'All AI providers failed to process the request.');
            this.emit('ai:request:error', { type: 'metadata', error: errorMsg });
            throw new Error(errorMsg);
        }

        /**
         * 가사 번역/발음 생성 (활성화된 Provider 순서대로 시도)
         * @param {Object} params - { trackId, artist, title, text, lang, wantSmartPhonetic }
         * @returns {Promise<Object|null>}
         */
        async translateLyrics(params) {
            const providers = this.getEnabledProvidersFor('translate');

            if (providers.length === 0) {
                console.warn('[AIAddonManager] No translate providers enabled');
                throw new Error(this._t('aiProviders.noEnabledProviders', 'No AI providers enabled. Please enable at least one provider in settings.'));
            }

            const translationStyle = this.getTranslationStyle();
            const translationPrompt = params.wantSmartPhonetic
                ? null
                : this.buildLyricsTranslationPrompt({
                    text: params.text,
                    lang: params.lang,
                    translationStyle
                });

            // 디버그 로깅
            if (window.AddonDebug?.isEnabled()) {
                window.AddonDebug.log('ai', 'translateLyrics called', {
                    providers: providers.map(p => p.id),
                    lang: params.lang,
                    wantSmartPhonetic: params.wantSmartPhonetic,
                    translationStyle: params.wantSmartPhonetic ? null : translationStyle,
                    lineCount: params.text?.split('\n').length
                });
                window.AddonDebug.time('ai', 'translateLyrics');
            }

            // 이벤트 발생
            this.emit('ai:request:start', { type: 'translate', providers: providers.map(p => p.id), params: { ...params, text: '[...]' } });

            let lastError = null;

            for (const addon of providers) {
                if (typeof addon.translateLyrics !== 'function') continue;

                let hasProvisionalOutput = false;
                let maxProvisionalLineIndex = -1;
                const resetProvisionalOutput = (detail = {}) => {
                    if (!hasProvisionalOutput) return;

                    try {
                        if (typeof params.onStreamReset === 'function') {
                            params.onStreamReset({ provider: addon.id, ...detail });
                        } else if (typeof params.onLine === 'function') {
                            for (let index = 0; index <= maxProvisionalLineIndex; index++) {
                                params.onLine(index, '');
                            }
                        }
                    } catch (resetError) {
                        window.__ivLyricsDebugLog?.(`[AIAddonManager] Failed to reset ${addon.id} stream:`, resetError?.message);
                    }

                    hasProvisionalOutput = false;
                    maxProvisionalLineIndex = -1;
                };
                const providerParams = {
                    ...params,
                    translationStyle,
                    translationPrompt,
                    phoneticPrompt: params.wantSmartPhonetic
                        ? this.buildLyricsPhoneticPrompt({
                            text: params.text,
                            lang: params.lang,
                            providerId: addon.id
                        })
                        : null,
                    onLine: typeof params.onLine === 'function'
                        ? (lineIndex, lineText, detail) => {
                            hasProvisionalOutput = true;
                            if (Number.isInteger(lineIndex) && lineIndex >= 0) {
                                maxProvisionalLineIndex = Math.max(maxProvisionalLineIndex, lineIndex);
                            }
                            params.onLine(lineIndex, lineText, detail);
                        }
                        : null,
                    onStreamReset: detail => resetProvisionalOutput(detail),
                };

                try {
                    window.__ivLyricsDebugLog?.(`[AIAddonManager] Trying translate provider: ${addon.id}`);
                    const result = validateLyricsTranslationResult(
                        await addon.translateLyrics(providerParams),
                        params,
                        addon.id
                    );

                    // 디버그 타이머 종료
                    if (window.AddonDebug?.isEnabled()) {
                        window.AddonDebug.timeEnd('ai', 'translateLyrics');
                    }

                    // 이벤트 발생
                    this.emit('ai:request:success', { type: 'translate', provider: addon.id });

                    return result;
                } catch (e) {
                    console.warn(`[AIAddonManager] Provider ${addon.id} failed for translateLyrics:`, e.message);
                    lastError = e;
                    resetProvisionalOutput({ reason: 'provider-fallback', error: e?.message || null });

                    // 다음 provider 시도
                    continue;
                }
            }

            // 모든 provider 실패
            console.error('[AIAddonManager] All translate providers failed');

            if (window.AddonDebug?.isEnabled()) {
                window.AddonDebug.timeEnd('ai', 'translateLyrics');
                window.AddonDebug.error('ai', 'translateLyrics all providers failed');
            }

            const errorMsg = lastError?.message || this._t('aiProviders.allProvidersFailed', 'All AI providers failed to process the request.');
            this.emit('ai:request:error', { type: 'translate', error: errorMsg });
            throw new Error(errorMsg);
        }

        _getCharacterPronunciationUnitMode(params, lines) {
            const requested = params?.unitMode || params?.characterPronunciationUnitMode;
            if (requested === 'word' || requested === 'char') {
                return requested;
            }

            const sourceLang = String(params?.sourceLang || '').toLowerCase();
            if (CHARACTER_PRONUNCIATION_CJK_LANG_RE.test(sourceLang)) {
                return 'char';
            }

            const joinedLines = (Array.isArray(lines) ? lines : []).join('\n');
            return CHARACTER_PRONUNCIATION_CJK_SCRIPT_RE.test(joinedLines) ? 'char' : 'word';
        }

        _buildWordPronunciationUnits(text) {
            const chars = Array.from(String(text ?? ''));
            const units = [];
            let index = 0;

            while (index < chars.length) {
                while (index < chars.length && /\s/u.test(chars[index])) {
                    index++;
                }
                if (index >= chars.length) break;

                const start = index;
                while (index < chars.length && !/\s/u.test(chars[index])) {
                    index++;
                }
                const end = index - 1;
                const token = chars.slice(start, end + 1).join('');
                if (CHARACTER_PRONUNCIATION_WORD_TEXT_RE.test(token)) {
                    units.push({ start, end, text: token, pronunciation: '' });
                }
            }

            return units;
        }

        _normalizeCharacterPronunciationResult(result, lines, options = {}) {
            const sourceLines = (Array.isArray(lines) ? lines : [])
                .map(line => String(line ?? ''));
            const unitMode = options.unitMode === 'word' ? 'word' : 'char';
            const resultLines = Array.isArray(result?.l)
                ? result.l
                : (Array.isArray(result?.lines) ? result.lines : []);
            const resultLinesByIndex = new Map();
            resultLines.forEach((line) => {
                const lineIndex = Number(line?.i ?? line?.index);
                if (!resultLinesByIndex.has(lineIndex)) {
                    resultLinesByIndex.set(lineIndex, line);
                }
            });

            return {
                lines: sourceLines.map((text, lineIndex) => {
                    const sourceChars = Array.from(text);
                    const resultLine = resultLinesByIndex.get(lineIndex) || resultLines[lineIndex] || {};
                    const resultChars = Array.isArray(resultLine?.c)
                        ? resultLine.c
                        : (Array.isArray(resultLine?.chars) ? resultLine.chars : []);
                    const hasResultPronunciationArray = Array.isArray(resultLine?.p) || Array.isArray(resultLine?.pronunciations);
                    const resultPronunciations = Array.isArray(resultLine?.p)
                        ? resultLine.p
                        : (Array.isArray(resultLine?.pronunciations) ? resultLine.pronunciations : []);
                    const resultUnits = Array.isArray(resultLine?.u)
                        ? resultLine.u
                        : (Array.isArray(resultLine?.units) ? resultLine.units : []);
                    const byIndex = new Map();

                    if (unitMode === 'char' && hasResultPronunciationArray) {
                        if (resultPronunciations.length !== sourceChars.length) {
                            throw new Error(`Character pronunciation response line ${lineIndex} returned ${resultPronunciations.length} slots, expected ${sourceChars.length}.`);
                        }

                        resultPronunciations.forEach((value, index) => {
                            const pronunciation = typeof value === 'string' ? value.trim() : '';
                            if (pronunciation) {
                                byIndex.set(index, { p: pronunciation });
                            }
                        });
                    } else {
                        if (unitMode === 'char') {
                            throw new Error(`Character pronunciation response line ${lineIndex} missing p array.`);
                        }
                        resultChars.forEach((item, fallbackIndex) => {
                            const index = Number.isInteger(Number(item?.i)) ? Number(item.i) : fallbackIndex;
                            const rawPronunciation = item?.p ?? item?.pronunciation;
                            const pronunciation = typeof rawPronunciation === 'string' ? rawPronunciation.trim() : '';
                            if (index < 0 || index >= sourceChars.length) {
                                if (unitMode === 'char' && pronunciation) {
                                    throw new Error(`Character pronunciation response used index ${index} outside line ${lineIndex} length ${sourceChars.length}.`);
                                }
                                return;
                            }
                            if (unitMode === 'char' && byIndex.has(index)) {
                                const existingPronunciation = byIndex.get(index)?.p ?? byIndex.get(index)?.pronunciation;
                                const existingText = typeof existingPronunciation === 'string' ? existingPronunciation.trim() : '';
                                if (pronunciation && existingText) {
                                    throw new Error(`Character pronunciation response duplicated index ${index} on line ${lineIndex}.`);
                                }
                                if (!pronunciation && existingText) return;
                            }
                            byIndex.set(index, item);
                        });
                    }

                    const sourceUnits = unitMode === 'word'
                        ? this._buildWordPronunciationUnits(text)
                        : [];
                    const normalizedUnits = [];
                    if (unitMode === 'word') {
                        resultUnits.forEach((item, fallbackIndex) => {
                            const unitIndex = Number.isInteger(Number(item?.i)) ? Number(item.i) : fallbackIndex;
                            const sourceUnit = sourceUnits[unitIndex] || null;
                            const start = Number.isInteger(Number(item?.s ?? item?.start))
                                ? Number(item?.s ?? item?.start)
                                : sourceUnit?.start;
                            const end = Number.isInteger(Number(item?.e ?? item?.end))
                                ? Number(item?.e ?? item?.end)
                                : sourceUnit?.end;
                            const pronunciation = typeof (item?.p ?? item?.pronunciation) === 'string'
                                ? (item.p ?? item.pronunciation).trim()
                                : '';

                            if (!pronunciation || !Number.isInteger(start) || !Number.isInteger(end)) return;
                            if (start < 0 || end < start || end >= sourceChars.length) return;
                            normalizedUnits.push({
                                start,
                                end,
                                text: sourceChars.slice(start, end + 1).join(''),
                                pronunciation
                            });
                        });
                        if (!normalizedUnits.length && byIndex.size > 0) {
                            sourceUnits.forEach(unit => {
                                const pronunciation = [];
                                for (let i = unit.start; i <= unit.end; i++) {
                                    const item = byIndex.get(i);
                                    const rawPronunciation = item?.p ?? item?.pronunciation;
                                    if (typeof rawPronunciation === 'string' && rawPronunciation.trim()) {
                                        pronunciation.push(rawPronunciation.trim());
                                    }
                                }
                                if (pronunciation.length) {
                                    normalizedUnits.push({
                                        ...unit,
                                        pronunciation: pronunciation.join('')
                                    });
                                }
                            });
                        }
                    }

                    return {
                        index: lineIndex,
                        unitMode,
                        units: normalizedUnits,
                        chars: sourceChars.map((char, charIndex) => {
                            const item = byIndex.get(charIndex) || {};
                            const rawPronunciation = item.p ?? item.pronunciation;
                            const pronunciation = unitMode === 'word'
                                ? ''
                                : (typeof rawPronunciation === 'string'
                                ? rawPronunciation.trim()
                                : '');

                            return {
                                i: charIndex,
                                char,
                                pronunciation
                            };
                        })
                    };
                })
            };
        }

        _isCharacterPronunciationTruncationError(error) {
            return /JSON response was truncated|output token limit|Unexpected end|unterminated/i.test(error?.message || '');
        }

        _isCharacterPronunciationFormatError(error) {
            return /Character pronunciation response .*returned \d+ slots, expected|Character pronunciation response .*outside line|Character pronunciation response duplicated index|Character pronunciation response .*missing p array/i.test(error?.message || '');
        }

        _isCharacterPronunciationRetryableError(error) {
            return this._isCharacterPronunciationTruncationError(error) || this._isCharacterPronunciationFormatError(error);
        }

        _notifyCharacterPronunciationProgress(params, progress) {
            if (typeof params?.onProgress !== 'function') return;
            try {
                params.onProgress(progress);
            } catch (e) {
                console.warn('[AIAddonManager] Character pronunciation progress callback failed:', e);
            }
        }

        _buildCharacterPronunciationChunks(lines, options = {}) {
            options = options || {};
            const unitMode = options.unitMode === 'word' ? 'word' : 'char';
            const sourceLines = (Array.isArray(lines) ? lines : [])
                .map(line => String(line ?? ''));
            const defaultMaxLines = unitMode === 'char' ? 4 : 16;
            const defaultMaxChars = unitMode === 'char' ? 240 : 1040;
            const defaultMaxSegmentChars = unitMode === 'char' ? 240 : 640;
            const maxChunkLines = Math.max(1, Number(options.maxLines) || defaultMaxLines);
            const maxChunkChars = Math.max(unitMode === 'char' ? 40 : 320, Number(options.maxChars) || defaultMaxChars);
            const maxSegmentChars = Math.max(unitMode === 'char' ? 40 : 160, Number(options.maxSegmentChars) || defaultMaxSegmentChars);
            const segments = [];

            sourceLines.forEach((text, sourceLineIndex) => {
                const chars = Array.from(text);
                if (chars.length <= maxSegmentChars) {
                    segments.push({ sourceLineIndex, charOffset: 0, text, charCount: chars.length });
                    return;
                }

                for (let offset = 0; offset < chars.length; offset += maxSegmentChars) {
                    const partChars = chars.slice(offset, offset + maxSegmentChars);
                    const part = partChars.join('');
                    segments.push({ sourceLineIndex, charOffset: offset, text: part, charCount: partChars.length });
                }
            });

            const chunks = [];
            let current = { segments: [], charCount: 0 };
            const pushCurrent = () => {
                if (!current.segments.length) return;
                chunks.push(current);
                current = { segments: [], charCount: 0 };
            };

            segments.forEach(segment => {
                const wouldExceedLines = current.segments.length >= maxChunkLines;
                const wouldExceedChars = current.segments.length > 0 && current.charCount + segment.charCount > maxChunkChars;
                if (wouldExceedLines || wouldExceedChars) {
                    pushCurrent();
                }
                current.segments.push(segment);
                current.charCount += segment.charCount;
            });
            pushCurrent();

            return chunks;
        }

        async _generateCharacterPronunciationChunk(addon, params, chunk) {
            try {
                const chunkLines = chunk.segments.map(segment => segment.text);
                const {
                    onProgress,
                    _characterPronunciationProgress,
                    chunking,
                    characterPronunciationChunking,
                    characterPronunciationUnitMode,
                    unitMode,
                    ...providerParams
                } = params || {};
                const result = await addon.generateCharacterPronunciation({
                    ...providerParams,
                    unitMode: unitMode || characterPronunciationUnitMode || 'char',
                    lines: chunkLines,
                    characterPronunciationPrompt: this.buildCharacterPronunciationPrompt({
                        ...providerParams,
                        lines: chunkLines,
                        unitMode: unitMode || characterPronunciationUnitMode || 'char',
                        providerId: addon.id
                    })
                });
                const normalized = this._normalizeCharacterPronunciationResult(result, chunkLines, {
                    unitMode: unitMode || characterPronunciationUnitMode || 'char'
                });
                return normalized.lines.map((line, index) => ({
                    segment: chunk.segments[index],
                    line
                }));
            } catch (error) {
                if (!this._isCharacterPronunciationRetryableError(error)) {
                    throw error;
                }

                this._notifyCharacterPronunciationProgress(params, {
                    ...(params?._characterPronunciationProgress || {}),
                    phase: 'retry-split',
                    retry: true,
                    reason: this._isCharacterPronunciationFormatError(error) ? 'format' : 'truncation',
                    error: error?.message || String(error),
                    percent: Math.max(1, Number(params?._characterPronunciationProgress?.percent) || 0)
                });

                if (chunk.segments.length > 1) {
                    const mid = Math.ceil(chunk.segments.length / 2);
                    const left = {
                        segments: chunk.segments.slice(0, mid),
                        charCount: chunk.segments.slice(0, mid).reduce((sum, segment) => sum + segment.charCount, 0)
                    };
                    const right = {
                        segments: chunk.segments.slice(mid),
                        charCount: chunk.segments.slice(mid).reduce((sum, segment) => sum + segment.charCount, 0)
                    };
                    const leftResult = await this._generateCharacterPronunciationChunk(addon, params, left);
                    const rightResult = await this._generateCharacterPronunciationChunk(addon, params, right);
                    return [...leftResult, ...rightResult];
                }

                const [segment] = chunk.segments;
                const chars = Array.from(segment?.text || '');
                const splitThreshold = this._isCharacterPronunciationFormatError(error) ? 40 : 160;
                if (chars.length > splitThreshold) {
                    const mid = Math.ceil(chars.length / 2);
                    const leftSegment = {
                        sourceLineIndex: segment.sourceLineIndex,
                        charOffset: segment.charOffset,
                        text: chars.slice(0, mid).join(''),
                        charCount: mid
                    };
                    const rightText = chars.slice(mid).join('');
                    const rightSegment = {
                        sourceLineIndex: segment.sourceLineIndex,
                        charOffset: segment.charOffset + mid,
                        text: rightText,
                        charCount: Array.from(rightText).length
                    };
                    const leftResult = await this._generateCharacterPronunciationChunk(addon, params, { segments: [leftSegment], charCount: leftSegment.charCount });
                    const rightResult = await this._generateCharacterPronunciationChunk(addon, params, { segments: [rightSegment], charCount: rightSegment.charCount });
                    return [...leftResult, ...rightResult];
                }

                throw error;
            }
        }

        _mergeCharacterPronunciationChunkResult(mergedLines, chunkResult, unitMode) {
            chunkResult.forEach(({ segment, line }) => {
                if (!segment || !line || !Array.isArray(line.chars)) return;
                const targetLine = mergedLines[segment.sourceLineIndex];
                if (!targetLine) return;

                if (unitMode === 'word' && Array.isArray(line.units)) {
                    line.units.forEach(unit => {
                        const pronunciation = typeof unit?.pronunciation === 'string' ? unit.pronunciation.trim() : '';
                        if (!pronunciation) return;

                        const start = segment.charOffset + Number(unit.start);
                        const end = segment.charOffset + Number(unit.end);
                        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= targetLine.chars.length) return;

                        const existingUnit = targetLine.units.find(item => item.start === start && item.end === end);
                        if (existingUnit) {
                            existingUnit.pronunciation = pronunciation;
                        } else {
                            targetLine.units.push({
                                start,
                                end,
                                text: targetLine.chars.slice(start, end + 1).map(item => item.char).join(''),
                                pronunciation
                            });
                        }
                    });
                    return;
                }

                line.chars.forEach(item => {
                    if (!item?.pronunciation) return;
                    const itemIndex = Number(item.i ?? 0);
                    if (!Number.isInteger(itemIndex)) return;
                    const targetIndex = segment.charOffset + itemIndex;
                    if (targetIndex < 0 || targetIndex >= targetLine.chars.length) return;
                    targetLine.chars[targetIndex].pronunciation = item.pronunciation;
                });
            });
        }

        async _generateCharacterPronunciationChunks(addon, params, chunks, unitMode, mergedLines, progressContext = {}) {
            const total = chunks.length;
            const concurrency = Math.min(
                Math.max(1, total || 1),
                Math.max(1, Math.min(6, Number(progressContext.concurrency) || 3))
            );
            let nextChunkIndex = 0;
            let completedChunks = 0;
            let fatalChunkError = null;

            const createProgressBase = (chunkIndex) => ({
                provider: progressContext.provider,
                providerIndex: progressContext.providerIndex,
                providerTotal: progressContext.providerTotal,
                total,
                current: total > 0 ? Math.max(1, Math.min(total, completedChunks + 1)) : 0,
                completed: completedChunks,
                remaining: Math.max(0, total - completedChunks),
                percent: total > 0 ? Math.round((completedChunks / total) * 100) : 0,
                concurrency,
                chunkIndex: chunkIndex + 1
            });

            const runChunkWorker = async () => {
                while (!fatalChunkError) {
                    const chunkIndex = nextChunkIndex++;
                    if (chunkIndex >= total) {
                        return;
                    }

                    window.__ivLyricsDebugLog?.(`[AIAddonManager] Character pronunciation chunk ${chunkIndex + 1}/${total} via ${addon.id}`);
                    const progressBase = createProgressBase(chunkIndex);
                    this._notifyCharacterPronunciationProgress(params, {
                        ...progressBase,
                        phase: 'chunk-start',
                        percent: total > 0 ? Math.max(1, progressBase.percent) : progressBase.percent
                    });

                    try {
                        const chunkResult = await this._generateCharacterPronunciationChunk(addon, {
                            ...params,
                            unitMode,
                            _characterPronunciationProgress: progressBase
                        }, chunks[chunkIndex]);
                        this._mergeCharacterPronunciationChunkResult(mergedLines, chunkResult, unitMode);
                        completedChunks++;
                        this._notifyCharacterPronunciationProgress(params, {
                            ...createProgressBase(chunkIndex),
                            phase: 'chunk-complete',
                            current: completedChunks,
                            completed: completedChunks,
                            remaining: Math.max(0, total - completedChunks),
                            percent: total > 0 ? Math.round((completedChunks / total) * 100) : 100
                        });
                    } catch (error) {
                        this._notifyCharacterPronunciationProgress(params, {
                            ...createProgressBase(chunkIndex),
                            phase: 'chunk-error',
                            error: error?.message || String(error),
                            percent: total > 0 ? Math.max(1, Math.round((completedChunks / total) * 100)) : 0
                        });
                        fatalChunkError = error;
                        return;
                    }
                }
            };

            const workers = Array.from(
                { length: Math.min(concurrency, total) },
                () => runChunkWorker()
            );
            await Promise.all(workers);
            if (fatalChunkError) {
                throw fatalChunkError;
            }
        }

        async generateCharacterPronunciation(params) {
            const providers = this.getEnabledProvidersFor('characterPronunciation');

            if (providers.length === 0) {
                console.warn('[AIAddonManager] No character pronunciation providers enabled');
                throw new Error(this._t('aiProviders.noEnabledProviders', 'No AI providers enabled. Please enable at least one provider in settings.'));
            }

            const {
                onProgress,
                _characterPronunciationProgress,
                ...eventParams
            } = params || {};

            this.emit('ai:request:start', {
                type: 'characterPronunciation',
                providers: providers.map(p => p.id),
                params: { ...eventParams, lines: '[...]' }
            });

            let lastError = null;
            let truncationError = null;
            const sourceLines = (Array.isArray(params?.lines) ? params.lines : [])
                .map(line => String(line ?? ''));
            const unitMode = this._getCharacterPronunciationUnitMode(params, sourceLines);
            const chunkingOptions = params?.chunking || params?.characterPronunciationChunking || {};
            const effectiveChunkingOptions = { ...chunkingOptions, unitMode };
            const chunks = this._buildCharacterPronunciationChunks(sourceLines, effectiveChunkingOptions);
            const defaultChunkConcurrency = unitMode === 'char' ? 4 : 3;
            const chunkConcurrency = Math.min(
                Math.max(1, chunks.length || 1),
                Math.max(1, Math.min(6, Number(chunkingOptions.concurrency) || defaultChunkConcurrency))
            );

            this._notifyCharacterPronunciationProgress(params, {
                phase: 'prepared',
                providerTotal: providers.length,
                total: chunks.length,
                current: 0,
                completed: 0,
                remaining: chunks.length,
                percent: 0
            });

            for (let providerIndex = 0; providerIndex < providers.length; providerIndex++) {
                const addon = providers[providerIndex];
                if (typeof addon.generateCharacterPronunciation !== 'function') continue;

                try {
                    window.__ivLyricsDebugLog?.(`[AIAddonManager] Trying character pronunciation provider: ${addon.id}`);
                    window.__ivLyricsDebugLog?.(`[AIAddonManager] Character pronunciation chunks: ${chunks.length}, concurrency: ${chunkConcurrency}`);
                    this._notifyCharacterPronunciationProgress(params, {
                        phase: 'provider-start',
                        provider: addon.id,
                        providerIndex: providerIndex + 1,
                        providerTotal: providers.length,
                        total: chunks.length,
                        current: 0,
                        completed: 0,
                        remaining: chunks.length,
                        percent: 0
                    });

                    const mergedLines = sourceLines.map((text, lineIndex) => ({
                        index: lineIndex,
                        unitMode,
                        units: unitMode === 'word'
                            ? this._buildWordPronunciationUnits(text)
                            : [],
                        chars: Array.from(text).map((char, charIndex) => ({
                            i: charIndex,
                            char,
                            pronunciation: ''
                        }))
                    }));

                    await this._generateCharacterPronunciationChunks(addon, params, chunks, unitMode, mergedLines, {
                        provider: addon.id,
                        providerIndex: providerIndex + 1,
                        providerTotal: providers.length,
                        concurrency: chunkConcurrency
                    });

                    this._notifyCharacterPronunciationProgress(params, {
                        phase: 'complete',
                        provider: addon.id,
                        providerIndex: providerIndex + 1,
                        providerTotal: providers.length,
                        total: chunks.length,
                        current: chunks.length,
                        completed: chunks.length,
                        remaining: 0,
                        percent: 100
                    });
                    this.emit('ai:request:success', { type: 'characterPronunciation', provider: addon.id });
                    return { lines: mergedLines, provider: addon.id };
                } catch (e) {
                    console.warn(`[AIAddonManager] Provider ${addon.id} failed for generateCharacterPronunciation:`, e.message);
                    this._notifyCharacterPronunciationProgress(params, {
                        phase: 'provider-error',
                        provider: addon.id,
                        providerIndex: providerIndex + 1,
                        providerTotal: providers.length,
                        total: chunks.length,
                        error: e?.message || String(e)
                    });
                    lastError = e;
                    if (!truncationError && this._isCharacterPronunciationTruncationError(e)) {
                        truncationError = e;
                    }
                    continue;
                }
            }

            const errorMsg = truncationError?.message || lastError?.message || this._t('aiProviders.allProvidersFailed', 'All AI providers failed to process the request.');
            this.emit('ai:request:error', { type: 'characterPronunciation', error: errorMsg });
            throw new Error(errorMsg);
        }

        /**
         * 가사 학습 모드 생성 (활성화된 Provider 순서대로 시도)
         * @param {Object} params - { trackId, title, artist, targetLang, sourceLang, lines }
         * @returns {Promise<Object>}
         */
        async generateLyricsStudy(params) {
            const providers = this.getEnabledProvidersFor('lyricsStudy');

            if (providers.length === 0) {
                console.warn('[AIAddonManager] No lyrics study providers enabled');
                throw new Error(this._t('aiProviders.noEnabledProviders', 'No AI providers enabled. Please enable at least one provider in settings.'));
            }

            if (window.AddonDebug?.isEnabled()) {
                window.AddonDebug.log('ai', 'generateLyricsStudy called', {
                    providers: providers.map(p => p.id),
                    targetLang: params.targetLang,
                    sourceLang: params.sourceLang,
                    lineCount: Array.isArray(params.lines) ? params.lines.length : 0
                });
                window.AddonDebug.time('ai', 'generateLyricsStudy');
            }

            this.emit('ai:request:start', {
                type: 'lyricsStudy',
                providers: providers.map(p => p.id),
                params: { ...params, lines: '[...]' }
            });

            let lastError = null;

            for (const addon of providers) {
                if (typeof addon.generateLyricsStudy !== 'function') continue;

                try {
                    window.__ivLyricsDebugLog?.(`[AIAddonManager] Trying lyrics study provider: ${addon.id}`);
                    const result = await addon.generateLyricsStudy({
                        ...params,
                        lyricsStudyPrompt: this.buildLyricsStudyPrompt(params)
                    });

                    if (window.AddonDebug?.isEnabled()) {
                        window.AddonDebug.timeEnd('ai', 'generateLyricsStudy');
                    }

                    this.emit('ai:request:success', { type: 'lyricsStudy', provider: addon.id });
                    return result;
                } catch (e) {
                    console.warn(`[AIAddonManager] Provider ${addon.id} failed for generateLyricsStudy:`, e.message);
                    lastError = e;
                    continue;
                }
            }

            if (window.AddonDebug?.isEnabled()) {
                window.AddonDebug.timeEnd('ai', 'generateLyricsStudy');
                window.AddonDebug.error('ai', 'generateLyricsStudy all providers failed');
            }

            const errorMsg = lastError?.message || this._t('aiProviders.allProvidersFailed', 'All AI providers failed to process the request.');
            this.emit('ai:request:error', { type: 'lyricsStudy', error: errorMsg });
            throw new Error(errorMsg);
        }

        /**
         * 번역만으로 전달되지 않는 줄별 문화적 배경 설명 생성
         * @param {Object} params - { trackId, title, artist, targetLang, sourceLang, lines, provider, onProviderLoading }
         * @returns {Promise<{annotations: Array<{lineIndex: number, note: string}>, provider: string|null}>}
         */
        async generateCulturalAnnotations(params) {
            let providers = this.getEnabledProvidersFor('culturalAnnotations');
            if (params?.provider) {
                providers = providers.filter(addon => addon.id === params.provider);
            }

            if (providers.length === 0) {
                console.warn('[AIAddonManager] No cultural annotation providers enabled');
                throw new Error(this._t('aiProviders.noEnabledProviders', 'No AI providers enabled. Please enable at least one provider in settings.'));
            }

            this.emit('ai:request:start', {
                type: 'culturalAnnotations',
                providers: providers.map(provider => provider.id),
                params: { ...params, lines: '[...]' }
            });

            let lastError = null;
            for (const addon of providers) {
                if (typeof addon.generateCulturalAnnotations !== 'function') continue;

                try {
                    if (typeof params?.onProviderLoading === 'function') {
                        params.onProviderLoading({
                            providerId: addon.id,
                            providerName: addon.name || addon.id
                        });
                    }
                    window.__ivLyricsDebugLog?.(`[AIAddonManager] Trying cultural annotations provider: ${addon.id}`);
                    const result = normalizeCulturalAnnotationsResult(
                        await addon.generateCulturalAnnotations({
                            ...params,
                            culturalAnnotationsPrompt: this.buildCulturalAnnotationsPrompt({
                                ...params,
                                providerId: addon.id
                            })
                        }),
                        params?.lines,
                        addon.id
                    );

                    this.emit('ai:request:success', { type: 'culturalAnnotations', provider: addon.id });
                    return result;
                } catch (error) {
                    console.warn(`[AIAddonManager] Provider ${addon.id} failed for generateCulturalAnnotations:`, error.message);
                    lastError = error;
                }
            }

            const errorMsg = lastError?.message || this._t('aiProviders.allProvidersFailed', 'All AI providers failed to process the request.');
            this.emit('ai:request:error', { type: 'culturalAnnotations', error: errorMsg });
            throw new Error(errorMsg);
        }

        /**
         * TMI 생성 (활성화된 Provider 순서대로 시도)
         * @param {Object} params - { trackId, title, artist, lang }
         * @returns {Promise<Object|null>}
         */
        async generateTMI(params) {
            const providers = this.getEnabledProvidersFor('tmi');

            if (providers.length === 0) {
                console.warn('[AIAddonManager] No TMI providers enabled');
                return null;
            }

            // 디버그 로깅
            if (window.AddonDebug?.isEnabled()) {
                window.AddonDebug.log('ai', 'generateTMI called', {
                    providers: providers.map(p => p.id),
                    ...params
                });
                window.AddonDebug.time('ai', 'generateTMI');
            }

            // 이벤트 발생
            this.emit('ai:request:start', { type: 'tmi', providers: providers.map(p => p.id), params });

            let lastError = null;

            for (const addon of providers) {
                if (typeof addon.generateTMI !== 'function') continue;

                try {
                    window.__ivLyricsDebugLog?.(`[AIAddonManager] Trying TMI provider: ${addon.id}`);
                    const result = await addon.generateTMI({
                        ...params,
                        tmiPrompt: this.buildTMIPrompt(params)
                    });

                    // 디버그 타이머 종료
                    if (window.AddonDebug?.isEnabled()) {
                        window.AddonDebug.timeEnd('ai', 'generateTMI');
                    }

                    // 이벤트 발생
                    this.emit('ai:request:success', { type: 'tmi', provider: addon.id });

                    return result;
                } catch (e) {
                    console.warn(`[AIAddonManager] Provider ${addon.id} failed for generateTMI:`, e.message);
                    lastError = e;

                    // 다음 provider 시도
                    continue;
                }
            }

            // 모든 provider 실패
            console.error('[AIAddonManager] All TMI providers failed');

            if (window.AddonDebug?.isEnabled()) {
                window.AddonDebug.timeEnd('ai', 'generateTMI');
                window.AddonDebug.error('ai', 'generateTMI all providers failed');
            }

            const errorMsg = lastError?.message || 'All providers failed';
            this.emit('ai:request:error', { type: 'tmi', error: errorMsg });
            return null;  // TMI는 실패해도 null 반환 (중요도 낮음)
        }

        // ============================================
        // Utility Methods
        // ============================================

        /**
         * Addon이 특정 기능을 지원하는지 확인
         * @param {string} addonId - Addon ID
         * @param {'translate'|'metadata'|'tmi'} capability - 기능 유형
         * @returns {boolean}
         */
        supportsCapability(addonId, capability) {
            const addon = this.getAddon(addonId);
            return addon?.supports?.[capability] === true;
        }

        /**
         * 특정 기능을 지원하는 Addon 목록 가져오기
         * @param {'translate'|'metadata'|'tmi'} capability - 기능 유형
         * @returns {Object[]}
         */
        getAddonsWithCapability(capability) {
            return this.getAddons().filter(addon =>
                addon.supports && addon.supports[capability] === true
            );
        }

        /**
         * 기능 상수
         */
        get CAPABILITIES() {
            return AI_CAPABILITIES;
        }

        get TRANSLATION_STYLES() {
            return TRANSLATION_STYLES;
        }
    }

    // ============================================
    // Global Registration
    // ============================================

    const manager = new AIAddonManager();
    window.AIAddonManager = manager;

    // Spicetify가 준비되면 초기화
    const initWhenReady = () => {
        if (Spicetify?.LocalStorage) {
            manager.init().catch(e => {
                console.error('[AIAddonManager] Init failed:', e);
            });
        } else {
            setTimeout(initWhenReady, 100);
        }
    };

    initWhenReady();

    window.__ivLyricsDebugLog?.('[AIAddonManager] Module loaded');
})();
