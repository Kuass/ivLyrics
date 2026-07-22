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

function extractUtilsSource() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'LyricsService.js'), 'utf8');
    const lines = source.split('\n');

    const startIndex = lines.indexOf(UTILS_START);
    assert.ok(startIndex >= 0, 'LyricsService.js is missing the Utils object literal');

    const endIndex = lines.findIndex((line, index) => index > startIndex && line === UTILS_END);
    assert.ok(endIndex > startIndex, 'LyricsService.js has an unterminated Utils object literal');

    return lines.slice(startIndex, endIndex + 1).join('\n');
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
