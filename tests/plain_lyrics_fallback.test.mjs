import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Pages.js", import.meta.url), "utf8");
const rendererStart = source.indexOf("const LyricsUnavailableView");
const rendererEnd = source.indexOf("window.ivLyricsLyricRendererPrimitives", rendererStart);
assert.ok(rendererStart > 0 && rendererEnd > rendererStart, "lyrics page renderer must remain testable");

const element = (component, props, ...children) => ({ component, props, children });
const context = vm.createContext({
    CONFIG: { visual: { "synced-compact": true } },
    CreditFooter: "CreditFooter",
    MarketplacePage: "MarketplacePage",
    SyncedExpandedLyricsPage: "SyncedExpandedLyricsPage",
    SyncedLyricsPage: "SyncedLyricsPage",
    UnsyncedLyricsPage: "UnsyncedLyricsPage",
    react: {
        Fragment: "Fragment",
        createElement: element,
        memo: (component) => component,
    },
    useMemo: (factory) => factory(),
    window: {
        ivLyricsDataUtils: {
            hasLyricsContent: (lyrics) => Array.isArray(lyrics) && lyrics.length > 0,
        },
    },
});

vm.runInContext(source.slice(rendererStart, rendererEnd), context);

test("plain mode renders the current lyric fallback when no unsynced payload exists", () => {
    const currentLyrics = [{ originalText: "Rap God", text2: "랩 갓" }];
    const rendered = context.window.LyricsPageRenderer({
        mode: 2,
        unsyncedMode: 2,
        currentLyrics,
        synced: currentLyrics,
        unsynced: [],
    });
    const plainPage = rendered.children[0];

    assert.equal(plainPage.component, "UnsyncedLyricsPage");
    assert.equal(plainPage.props.lyrics, currentLyrics);
});
