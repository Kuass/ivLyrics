const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// LyricsService.js cannot be loaded whole in a sandbox -- module-scope work
// blocks forever. Instead slice out the `const Utils = { ... };` literal and
// evaluate only that, so these tests still exercise the shipped implementation.
const UTILS_START = '    const Utils = {';
const UTILS_END = '    };';
// Utils.detectLanguage calls this module-scope helper, so the slice has to
// carry it too or the sandbox differs from how the file actually loads.
const HASH_START = '    const getLyricsTextCacheHash = (text) => {';
const HASH_END = '    };';

function sliceBlock(lines, startLine, endLine, label) {
    const startIndex = lines.indexOf(startLine);
    assert.ok(startIndex >= 0, `LyricsService.js is missing ${label}`);
    const endIndex = lines.findIndex((line, index) => index > startIndex && line === endLine);
    assert.ok(endIndex > startIndex, `LyricsService.js has an unterminated ${label}`);
    return lines.slice(startIndex, endIndex + 1).join('\n');
}

function extractUtilsSource() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'LyricsService.js'), 'utf8');
    const lines = source.split('\n');

    return [
        sliceBlock(lines, HASH_START, HASH_END, 'the getLyricsTextCacheHash helper'),
        sliceBlock(lines, UTILS_START, UTILS_END, 'the Utils object literal')
    ].join('\n\n');
}

function createUtils({ hansThreshold = 40, jaThreshold = 40 } = {}) {
    const settings = new Map([
        ['ivLyrics:visual:hans-detect-threshold', String(hansThreshold)],
        ['ivLyrics:visual:ja-detect-threshold', String(jaThreshold)]
    ]);

    const context = {
        Spicetify: {
            LocalStorage: {
                get: (key) => (settings.has(key) ? settings.get(key) : null),
                set: (key, value) => settings.set(key, String(value))
            }
        },
        console: { log() {}, warn() {}, error() {}, debug() {}, info() {} },
        window: {}
    };

    vm.runInNewContext(`${extractUtilsSource()}\nglobalThis.__ivLyricsUtils = Utils;`, context, {
        filename: 'LyricsService.js#Utils'
    });

    const Utils = context.__ivLyricsUtils;
    assert.equal(typeof Utils?.detectLanguage, 'function', 'extracted Utils is missing detectLanguage');
    return Utils;
}

// detectLanguage consumes lyric line objects, not raw strings.
const toLyricLines = (text) => String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ text: line }));

// Every sample below is ORIGINAL text written for this corpus in the register of
// pop lyrics. No real song lyrics are included: the project does not host lyrics
// or translations, so the test corpus must not embed copyrighted text either.
const CORPUS = [
    // ---------- single-language ----------
    { id: 'en', expected: 'en', text: `I remember when the summer ended
you said my name like it was ours
and I keep it in my pocket now
oh oh oh, I keep it now` },
    { id: 'ko', expected: 'ko', text: `너의 이름을 부르면
내 마음이 자꾸 흔들려
밤이 오면 더 선명해져
그대로 있어줘` },
    { id: 'ja', expected: 'ja', text: `君の名前を呼んだら
心が揺れてしまうよ
夜が来ればもっと鮮明に
そのままでいて` },
    { id: 'zh-hans', expected: 'zh-hans', text: `当我叫你的名字
我的心又开始摇晃
夜来了就更清楚
请你留在这里` },
    { id: 'zh-hant', expected: 'zh-hant', text: `當我叫你的名字
我的心又開始搖晃
夜來了就更清楚
請你留在這裡` },
    { id: 'es', expected: 'es', text: `cuando llega la noche
te busco en la ciudad vacía
no sé cómo olvidarte
quédate un poco más` },
    { id: 'fr', expected: 'fr', text: `quand la nuit tombe enfin
je te cherche dans les rues vides
je ne sais pas t'oublier
reste encore un peu` },
    { id: 'de', expected: 'de', text: `wenn die Nacht endlich fällt
suche ich dich in leeren Straßen
ich weiß nicht wie ich dich vergesse
bleib noch ein bisschen hier` },
    { id: 'pt', expected: 'pt', text: `quando a noite finalmente cai
procuro você nas ruas vazias
não sei como te esquecer
fica mais um pouco` },
    // Carries accents because real Italian transcriptions always do: across the
    // Italian songs sampled from a live lyrics provider, every one contained
    // accented characters. An accent-free sample was not representative.
    { id: 'it', expected: 'it', text: `quando la notte finalmente scende
ti cerco nelle strade vuote
non so più come dimenticarti
resta ancora un po' con me perché
è così che finisce sempre` },
    { id: 'ru', expected: 'ru', text: `когда наступает ночь
я ищу тебя на пустых улицах
я не знаю как забыть тебя
останься еще немного` },
    { id: 'ar', expected: 'ar', text: `عندما يأتي الليل
أبحث عنك في الشوارع الفارغة
لا أعرف كيف أنساك
ابق قليلا بعد` },
    { id: 'th', expected: 'th', text: `เมื่อค่ำคืนมาถึง
ฉันตามหาเธอบนถนนที่ว่างเปล่า
ฉันไม่รู้ว่าจะลืมเธอยังไง
อยู่ต่ออีกสักหน่อย` },
    { id: 'hi', expected: 'hi', text: `जब रात आती है
मैं तुम्हें खाली सड़कों पर ढूंढता हूँ
मुझे नहीं पता तुम्हें कैसे भूलूँ
थोड़ा और रुक जाओ` },
    { id: 'vi', expected: 'vi', text: `khi màn đêm buông xuống
anh tìm em trên những con phố vắng
anh không biết làm sao quên em
ở lại thêm một chút nữa` },
    { id: 'tr', expected: 'tr', text: `gece sonunda çöktüğünde
seni boş sokaklarda arıyorum
seni nasıl unutacağımı bilmiyorum
biraz daha kal yanımda` },
    { id: 'sv', expected: 'sv', text: `när natten äntligen faller
söker jag dig på tomma gator
jag vet inte hur jag glömmer dig
stanna kvar en liten stund` },
    { id: 'pl', expected: 'pl', text: `kiedy noc wreszcie zapada
szukam cię na pustych ulicach
nie wiem jak cię zapomnieć
zostań jeszcze chwilę` },
    { id: 'cs', expected: 'cs', text: `když konečně padne noc
hledám tě v prázdných ulicích
nevím jak na tebe zapomenout
zůstaň ještě chvíli` },
    { id: 'nl', expected: 'nl', text: `als de nacht eindelijk valt
zoek ik je in lege straten
ik weet niet hoe ik je vergeet
blijf nog even hier` },
    // Uses Indonesian-only vocabulary (bisa, ingin, karena); a sample built
    // only from words Indonesian and Malay share is genuinely undecidable.
    { id: 'id', expected: 'id', text: `ketika malam akhirnya tiba
aku ingin mencarimu di jalan yang kosong
aku tidak bisa melupakanmu
karena cinta ini masih ada` },
    { id: 'ms', expected: 'ms', text: `apabila malam akhirnya tiba
aku mencari awak di jalan yang kosong
aku tidak tahu cara melupakan awak
tinggallah sebentar lagi` },

    // Persian uses Arabic script but is a distinct shipped UI language.
    { id: 'fa', expected: 'fa', text: `وقتی شب می‌رسد
تو را در خیابان‌های خالی می‌جویم
نمی‌دانم چگونه فراموشت کنم
کمی بیشتر بمان` },
    // Bengali (U+0980-U+09FF) is outside the Devanagari range used for Hindi.
    { id: 'bn', expected: 'bn', text: `যখন রাত নেমে আসে
আমি তোমাকে খালি রাস্তায় খুঁজি
আমি জানি না কীভাবে তোমাকে ভুলব
আরও কিছুক্ষণ থাকো` }
];

// A short foreign hook must not capture a song that is overwhelmingly in
// another language. This is the single most common real-world failure: pop
// songs routinely drop one line of another language into a chorus.
const CODE_SWITCHING = [
    {
        id: 'korean song with english hook',
        expected: 'ko',
        text: `너의 이름을 부르면
내 마음이 자꾸 흔들려
baby I don't wanna let you go
oh oh, don't let me go
밤이 오면 더 선명해져
그대로 있어줘`
    },
    {
        id: 'japanese song with english hook',
        expected: 'ja',
        text: `君の名前を呼んだら
心が揺れてしまうよ
I don't wanna say goodbye
never say goodbye
夜が来ればもっと鮮明に`
    },
    {
        id: 'spanish song with english hook',
        expected: 'es',
        text: `cuando llega la noche
te busco en la ciudad vacía
baby I can't let you go tonight
no sé cómo olvidarte
quédate un poco más`
    },
    {
        id: 'english song with a single korean line',
        expected: 'en',
        text: `I remember when the summer ended
you said my name like it was ours
and I keep it in my pocket now
I keep it, I keep it now
사랑해
and I keep it now`
    }
];

test('detects each supported language from lyric-length input', () => {
    const Utils = createUtils();
    const failures = [];

    for (const { id, expected, text } of CORPUS) {
        const detected = Utils.detectLanguage(toLyricLines(text));
        if (detected !== expected) {
            failures.push(`${id}: expected ${expected}, got ${detected}`);
        }
    }

    assert.deepEqual(failures, [], `language detection regressions:\n  ${failures.join('\n  ')}`);
});

test('a short foreign hook does not capture the whole song', () => {
    const Utils = createUtils();
    const failures = [];

    for (const { id, expected, text } of CODE_SWITCHING) {
        const detected = Utils.detectLanguage(toLyricLines(text));
        if (detected !== expected) {
            failures.push(`${id}: expected ${expected}, got ${detected}`);
        }
    }

    assert.deepEqual(failures, [], `code-switching regressions:\n  ${failures.join('\n  ')}`);
});

test('an undecidable close pair resolves within the pair, not to English', () => {
    const Utils = createUtils();

    // Every word here is shared between Indonesian and Malay, so the two tie.
    // Either answer is defensible; English is not, because it never scored.
    const detected = Utils.detectLanguage(toLyricLines(`ketika malam akhirnya tiba
aku mencarimu di jalan yang kosong
aku tidak tahu cara melupakanmu
tinggallah sebentar lagi`));

    assert.ok(
        detected === 'id' || detected === 'ms',
        `expected the tie to resolve to id or ms, got ${detected}`
    );
});

test('an ordinary-length foreign line does not outvote the rest of the lyric', () => {
    const Utils = createUtils();

    // The Bengali line is 12.3% of the non-whitespace characters, so a gate
    // that only asked whether a script was "present enough" let one line
    // relabel the whole lyric. Latin has to be part of the comparison.
    assert.equal(Utils.detectLanguage(toLyricLines(`I remember when the summer ended
you said my name like it was ours
and I keep it in my pocket now
oh oh oh, I keep it now
যখন রাত নেমে আসে`)), 'en');
});

test('a majority language survives a hook in another Latin language', () => {
    const Utils = createUtils();

    // Four French lines against one German line. The French text carries no
    // accent, so an unconditional no-diacritic penalty halved it and handed
    // the lyric to the single German line.
    assert.equal(Utils.detectLanguage(toLyricLines(`quand la nuit tombe enfin
je te cherche dans les rues vides
je ne sais pas t'oublier
reste encore un peu
wenn die Nacht endlich fällt`)), 'fr');
});

test('traditional Chinese is not masked by characters shared with simplified', () => {
    const Utils = createUtils();

    // More than half of each character class also appears in the other, so
    // counting a glyph that matches both as evidence for both made shared
    // characters look like distinguishing evidence. Only exclusive matches
    // carry information.
    assert.equal(Utils.detectLanguage(toLyricLines('聽見你的聲音')), 'zh-hant');
});

test('short fragments still resolve to the right language', () => {
    const Utils = createUtils();

    assert.equal(Utils.detectLanguage(toLyricLines('사랑해')), 'ko');
    assert.equal(Utils.detectLanguage(toLyricLines('愛してる')), 'ja');
    assert.equal(Utils.detectLanguage(toLyricLines('te quiero')), 'es');
    assert.equal(Utils.detectLanguage(toLyricLines('oh oh oh\nyeah')), 'en');
});

test('returns null rather than guessing when there is nothing to go on', () => {
    const Utils = createUtils();

    assert.equal(Utils.detectLanguage([]), null);
    assert.equal(Utils.detectLanguage(null), null);
    assert.equal(Utils.detectLanguage(toLyricLines('   ')), null);
    assert.equal(Utils.detectLanguage(toLyricLines('♪ ♪ ♪')), null);
});

test('already-romanized lyrics are reported as Latin text', () => {
    const Utils = createUtils();

    // Romaji/romaja are genuinely ambiguous -- they are Latin script and carry
    // no reliable signal of the underlying language. Reporting 'en' keeps the
    // romanization UI from offering to romanize text that is already romanized.
    assert.equal(Utils.detectLanguage(toLyricLines(`kimi no namae wo yondara
kokoro ga yurete shimau yo
yoru ga kureba motto senmei ni`)), 'en');
});

test('detection results are cached per lyric set', () => {
    const Utils = createUtils();
    const lines = toLyricLines(CORPUS[0].text);

    assert.equal(Utils.detectLanguage(lines), 'en');
    assert.ok(Utils._langDetectCache.size > 0, 'expected the detection result to be cached');
    assert.equal(Utils.detectLanguage(lines), 'en');
});

test('two lyrics sharing an opening are not served the same cached verdict', () => {
    const Utils = createUtils();

    // The cache key used to be the first 200 characters of the lyric, so a
    // shared intro made one song inherit the other's language.
    const sharedOpening = 'la la la la la '.repeat(14);
    const korean = Utils.detectLanguage(toLyricLines(
        `${sharedOpening}\n너의 이름을 부르면 내 마음이 자꾸 흔들려 밤이 오면 더 선명해져 그대로 있어줘`
    ));
    const japanese = Utils.detectLanguage(toLyricLines(
        `${sharedOpening}\n君の名前を呼んだら心が揺れてしまうよ夜が来ればもっと鮮明にそのままでいて`
    ));

    assert.equal(korean, 'ko');
    assert.equal(japanese, 'ja');
});

test('a cached verdict matches what a fresh detector computes', () => {
    const samples = ['ko', 'ja', 'fr', 'ru', 'ar'].map(
        (id) => CORPUS.find((entry) => entry.id === id)
    );

    for (const { id, text } of samples) {
        const fresh = createUtils().detectLanguage(toLyricLines(text));

        const warmed = createUtils();
        warmed.detectLanguage(toLyricLines(text));
        const cached = warmed.detectLanguage(toLyricLines(text));

        assert.equal(cached, fresh, `${id}: cached verdict differs from a fresh computation`);
    }
});

test('malformed line shapes never throw and never return a foreign type', () => {
    const Utils = createUtils();
    const inputs = [
        null, undefined, [], {}, 'not-an-array', 42, true,
        [null], [undefined], [{}], [{ text: null }], [{ text: 42 }], [{ text: {} }],
        [{ text: [] }], [{ originalText: null, text: undefined }],
        [{ $$typeof: Symbol.for('react.element'), text: 'hola qué tal' }],
        ['a bare string line'], [['a nested array']], [0], [false], [NaN]
    ];

    for (const input of inputs) {
        const result = Utils.detectLanguage(input);
        assert.ok(
            result === null || typeof result === 'string',
            `input ${JSON.stringify(input)} returned ${Object.prototype.toString.call(result)}`
        );
    }
});

test('content that carries no language returns null', () => {
    const Utils = createUtils();

    for (const sample of ['♪ ♪ ♪', '123 456 789', '...', '🎵🎶🎵', '- - -', '   ', '\t\n']) {
        assert.equal(
            Utils.detectLanguage(toLyricLines(sample)),
            null,
            `expected null for ${JSON.stringify(sample)}`
        );
    }
});

test('decomposed and precomposed input agree', () => {
    // Providers do not normalise consistently, and the diacritic rules would
    // silently stop matching if a lyric arrived decomposed.
    for (const id of ['vi', 'es', 'fr', 'pt', 'cs', 'tr']) {
        const { text } = CORPUS.find((entry) => entry.id === id);
        const precomposed = createUtils().detectLanguage(toLyricLines(text.normalize('NFC')));
        const decomposed = createUtils().detectLanguage(toLyricLines(text.normalize('NFD')));

        assert.equal(decomposed, precomposed, `${id}: NFD input disagreed with NFC input`);
    }
});

test('zero-width characters do not change the verdict', () => {
    const { text } = CORPUS.find((entry) => entry.id === 'ko');
    const clean = createUtils().detectLanguage(toLyricLines(text));
    const padded = createUtils().detectLanguage(toLyricLines(text.replace(/ /g, '​ ')));

    assert.equal(padded, clean);
});

test('threshold settings that are missing or nonsensical still yield a verdict', () => {
    const { text } = CORPUS.find((entry) => entry.id === 'ja');
    const stores = [
        {},
        { hansThreshold: 0 }, { hansThreshold: 100 },
        { jaThreshold: 0 }, { jaThreshold: 100 },
        { jaThreshold: -5 }, { jaThreshold: 'not-a-number' }
    ];

    for (const store of stores) {
        const result = createUtils(store).detectLanguage(toLyricLines(text));
        assert.ok(
            result === null || typeof result === 'string',
            `settings ${JSON.stringify(store)} produced ${result}`
        );
    }
});

test('a lone foreign line never captures a lyric of four lines or more', () => {
    const Utils = createUtils();
    const foreign = { ko: '너의 이름을 부르면', ja: '君の名前を呼んだら', bn: 'যখন রাত নেমে আসে', ru: 'когда наступает ночь' };
    const english = 'I keep it in my pocket now';

    for (const [lang, line] of Object.entries(foreign)) {
        for (let total = 4; total <= 8; total++) {
            const lyric = [line, ...Array(total - 1).fill(english)].join('\n');
            assert.notEqual(
                Utils.detectLanguage(toLyricLines(lyric)),
                lang,
                `one ${lang} line captured a ${total}-line English lyric`
            );
        }
    }
});

test('a language present throughout still wins despite more English lines', () => {
    const Utils = createUtils();

    // Korean pop routinely carries more English lines than Korean ones. The
    // Korean is present throughout rather than as a single borrowed hook.
    const lyric = `너의 이름을 부르면
baby I don't wanna let you go
내 마음이 자꾸 흔들려
oh oh, don't let me go
밤이 오면 더 선명해져
I keep it in my pocket now
그대로 있어줘
and I keep it now`;

    assert.equal(Utils.detectLanguage(toLyricLines(lyric)), 'ko');
});

test('a single-line lyric in a non-Latin script is that language', () => {
    const Utils = createUtils();

    // The hook floor must not apply when there are too few lines for anything
    // to be a hook.
    assert.equal(Utils.detectLanguage(toLyricLines('너의 이름을 부르면')), 'ko');
    assert.equal(Utils.detectLanguage(toLyricLines('君の名前を呼んだら')), 'ja');
    assert.equal(Utils.detectLanguage(toLyricLines('когда наступает ночь')), 'ru');
    assert.equal(Utils.detectLanguage(toLyricLines('যখন রাত নেমে আসে')), 'bn');
});

test('every verdict is a label the rest of the app understands', () => {
    // index.js branches on these strings and injectExternals switches on the
    // two-letter codes; an unexpected value would silently disable conversion.
    const SUPPORTED = new Set([
        'ar', 'bn', 'cs', 'de', 'en', 'es', 'fa', 'fr', 'hi', 'id', 'it', 'ja',
        'ko', 'ms', 'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'vi',
        'zh-hans', 'zh-hant'
    ]);
    const Utils = createUtils();

    for (const { id, text } of CORPUS) {
        const result = Utils.detectLanguage(toLyricLines(text));
        assert.ok(result === null || SUPPORTED.has(result), `${id} produced unsupported label ${result}`);
    }
});

test('a long lyric is handled without error or excessive delay', () => {
    const Utils = createUtils();
    const { text } = CORPUS.find((entry) => entry.id === 'ko');
    const long = Array(2000).fill(text).join('\n');

    const startedAt = Date.now();
    const result = Utils.detectLanguage(toLyricLines(long));
    const elapsed = Date.now() - startedAt;

    assert.equal(result, 'ko');
    assert.ok(elapsed < 5000, `detection took ${elapsed}ms`);
});
