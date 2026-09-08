import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../LyricsAddonManager.js', import.meta.url), 'utf8');
const track = { uri: 'spotify:track:fixture', title: '순정', artist: 'KOYOTE', duration: 116000 };
const plain = text => ({ unsynced: [{ text }] });
const han = plain('哪里扑鼻还搜 农历萨拉还搜');
const korean = plain('테스트용 한국어 가사입니다');
const roman = plain('geudaeneun nal dugo tteonaganeunde idaero tteonajima amu mareobsi nal saranghandamyeon neoneun nae sarang');
const timedHan = { karaokeGranularity: 'character', karaoke: [0, 4000, 8000].map(startTime => ({
    startTime, endTime: startTime + 3000,
    syllables: [{ text: '测试文字', startTime, endTime: startTime + 3000 }],
})) };

function load(results, typeFirst, cached = false) {
    const calls = [];
    const window = { LyricsService: {
        extractTrackId: () => 'fixture',
        getCachedLyrics: async (_id, provider) => cached ? { ...results[provider], provider } : null,
    } };
    vm.runInNewContext(source, { window, Spicetify: {}, setTimeout() {},
        console: { info() {}, warn() {}, error() {} } },
        { filename: new URL('../LyricsAddonManager.js', import.meta.url).pathname });
    const manager = window.LyricsAddonManager;
    manager.getEnabledProviders = () => Object.keys(results).map(id => ({
        id, name: id, supports: { karaoke: true, synced: true, unsynced: true },
        getLyrics: async () => { calls.push(id); return { ...results[id], provider: id }; },
    }));
    manager.isPreferLyricsTypeOverProviderOrderEnabled = () => typeFirst;
    manager.isPreferSyncDataProviderEnabled = () => false;
    manager._prioritizeProvidersWithSyncData = async providers => providers;
    manager._getProviderTypeSettings = () => ({ character: true, word: true, synced: true, unsynced: true });
    return { manager, calls };
}

for (const typeFirst of [false, true]) {
    const policy = typeFirst ? 'type first' : 'provider first';
    test(`${policy}: Korean plain lyrics beat Han lyrics, even with character timing`, async () => {
        for (const result of [han, timedHan]) {
            const h = load({ first: result, second: korean }, typeFirst);
            assert.equal((await h.manager.getLyrics(track)).provider, 'second');
            assert.deepEqual(h.calls, ['first', 'second']);
        }
    });
    test(`${policy}: cached Han lyrics are also deferred`, async () => {
        const h = load({ first: han, second: korean }, typeFirst, true);
        assert.equal((await h.manager.getLyrics(track)).provider, 'second');
        assert.deepEqual(h.calls, []);
    });
    test(`${policy}: romanized Korean beats Han regardless of provider order`, async () => {
        for (const results of [{ han, roman }, { roman, han }]) {
            const h = load(results, typeFirst);
            assert.equal((await h.manager.getLyrics(track)).provider, 'roman');
        }
    });
    test(`${policy}: retains Han as the last available fallback`, async () => {
        const h = load({ first: han, second: { error: 'No lyrics' } }, typeFirst);
        assert.equal((await h.manager.getLyrics(track)).provider, 'first');
        assert.deepEqual(h.calls, ['first', 'second']);
    });
    test(`${policy}: does not penalize Chinese titles or unknown language from Korean artists`, async () => {
        for (const title of ['月光', 'Moonlight', '']) {
            const h = load({ first: han, second: korean }, typeFirst);
            assert.equal((await h.manager.getLyrics({ ...track, title, artist: '한국 가수' })).provider, 'first');
        }
    });
    test(`${policy}: preserves mixed Korean and Japanese text`, async () => {
        for (const text of ['한국어 가사와 漢字', '君の声が聞こえる']) {
            const h = load({ first: plain(text), second: korean }, typeFirst);
            assert.equal((await h.manager.getLyrics(track)).provider, 'first');
        }
    });
}

test('an explicit provider remains selected even when its lyrics use Han', async () => {
    const h = load({ first: han, second: korean }, true);
    assert.equal((await h.manager.getLyrics(track, 'first')).provider, 'first');
    assert.deepEqual(h.calls, ['first']);
});
