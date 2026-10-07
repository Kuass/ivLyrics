// Complete production page/overlay components and complete container consumer
// closures execute unchanged. Element creation and React hooks are inert;
// no effects or nested nonessential UI components mount, and no frames are claimed.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const root = new URL("../../", import.meta.url);
const files = Object.fromEntries(
  ["index.js", "Pages.js", "FullscreenOverlay.js"].map((p) => [
    p,
    readFileSync(new URL(p, root), "utf8"),
  ]),
);
function cut(file, from, to) {
  const s = files[file],
    a = s.indexOf(from),
    b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, from);
  const out = s.slice(a, b);
  return out;
}
const page = cut(
  "Pages.js",
  "const LyricsPageRenderer =",
  "window.ivLyricsLyricRendererPrimitives",
);
const overlay = cut(
  "FullscreenOverlay.js",
  "    const Overlay =",
  "    return Overlay;",
);
const progress = cut(
  "FullscreenOverlay.js",
  "    const LyricsProgress =",
  "    const renderQueueItem =",
);
const identities = cut(
  "FullscreenOverlay.js",
  "    const getFirstSpotifyUri =",
  "    // These fields are read",
);
const source = `(() => {
  const {react}=globalThis;
  const useState=initial=>[typeof initial==='function'?initial():initial,()=>{}];
  const useRef=initial=>({current:initial});
  const useMemo=fn=>fn(); const useCallback=fn=>fn; const useEffect=()=>{};
  const hasResearchTokenConsent=()=>false;
  const SyncedLyricsPage='SyncedLyricsPage',SyncedExpandedLyricsPage='SyncedExpandedLyricsPage',UnsyncedLyricsPage='UnsyncedLyricsPage',LyricsUnavailableView='LyricsUnavailableView',CreditFooter='CreditFooter';
  const Clock='Clock',NextTrackPreview='NextTrackPreview',ContextInfo='ContextInfo',QueuePanel='QueuePanel',CrossfadeAlbumImage='CrossfadeAlbumImage',ProgressBar='ProgressBar',PlayerControls='PlayerControls';
  ${cut("FullscreenOverlay.js", "    const FULLSCREEN_TITLE_COMFORTABLE_WIDTH =", "    const isUnknownTrackMetadata =")}
  ${cut("FullscreenOverlay.js", "    const getNonEmptyString =", "    const createQueueTrackInfo =")}
  ${identities}
  ${progress}
  ${page}
  ${overlay}
  window.FullscreenOverlay=Overlay;
  globalThis.ConsumerLyricsProgress=LyricsProgress;
  globalThis.consumerView=function(){
    const mode=this.getCurrentMode();
    const isSyncCreatorActive=false, syncCreatorPlainPage=null, syncCreatorPlainLyrics=[];
    ${cut("index.js", "    const renderedCurrentLyrics =", "    const computeSyncCreatorPlainPage =")}
    ${cut("index.js", "    const computeActiveLyricsPage =", "    // Tab bar removed")}
    ${cut("index.js", "    const hasLyrics = [this.state.karaoke", "    const shouldReduceMotion = this.shouldReduceMotion();")}
    ${cut("index.js", "    const renderFullscreenOverlayChild =", "    const renderStaticGradientBackground =")}
    return {mode,suppressStaleLyricsPage,shouldHideFullscreenLyrics,page:activeLyricsPage,overlay:renderFullscreenOverlayChild()};
  };
})();`;
export function installConsumers(
  h,
  { fullscreen = true, progress = true, tv = false, hidden = false } = {},
) {
  // Existing user configuration/state, not playback identity or lyric content.
  Object.assign(h.config.visual, {
    "fullscreen-show-lyrics-progress": progress,
    "fullscreen-tv-mode": tv,
    "fullscreen-two-column": false,
    "fullscreen-show-album": false,
    "fullscreen-show-info": false,
    "fullscreen-show-controls": false,
    "fullscreen-show-progress": false,
    "fullscreen-tv-show-controls": false,
    "fullscreen-tv-show-progress": false,
  });
  h.c.setState({
    isFullscreen: fullscreen,
    fullscreenLyricsHidden: hidden,
    currentLyricIndex: 0,
  });
  vm.runInContext(source, h.context);
  const walk = (node, fn) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, fn);
      return;
    }
    fn(node);
    for (const child of node.children || []) walk(child, fn);
  };
  const text = (node) => {
    if (node == null || node === false) return "";
    if (typeof node === "string" || typeof node === "number")
      return String(node);
    return (Array.isArray(node) ? node : node.children || [])
      .map(text)
      .join("");
  };
  return () => {
    const view = h.context.consumerView.call(h.c);
    const pageTree = h.window.LyricsPageRenderer(view.page.props);
    const pageContent = pageTree.children[0];
    const overlayTree = view.overlay
      ? h.window.FullscreenOverlay(view.overlay.props)
      : null;
    const indicators = [];
    walk(overlayTree, (node) => {
      if (node.tag === h.context.ConsumerLyricsProgress) {
        const tree = h.context.ConsumerLyricsProgress(node.props);
        if (tree)
          indicators.push({
            props: node.props,
            text: text(tree),
            className: tree.props.className,
          });
      }
    });
    return JSON.parse(
      JSON.stringify({
        mode: view.mode,
        suppressed: view.suppressStaleLyricsPage,
        hidden: view.shouldHideFullscreenLyrics,
        page: { tag: pageContent.tag, props: pageContent.props },
        overlayProps: view.overlay?.props || null,
        indicators,
      }),
    );
  };
}
