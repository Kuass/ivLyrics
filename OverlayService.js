// ============================================
// ivLyrics Overlay Service Extension
// 현재 페이지와 관계없이 재생 중인 곡을 오버레이/헬퍼에 전달
// ============================================

(function OverlayServiceExtension() {
    "use strict";

    const MODULE_KEY = "__ivLyricsOverlayServiceModule";
    const moduleState = window[MODULE_KEY] || (window[MODULE_KEY] = {
        initialized: false,
        waitTimer: null
    });

    const dependenciesReady = () => (
        !!window.Spicetify?.Player
        && !!window.LyricsService?.getFullLyrics
        && !!window.OverlaySender
        && !!window.lyricsHelperSender
    );

    if (!dependenciesReady()) {
        if (!moduleState.waitTimer) {
            moduleState.waitTimer = setTimeout(() => {
                moduleState.waitTimer = null;
                OverlayServiceExtension();
            }, 300);
        }
        return;
    }

    moduleState.waitTimer = null;
    if (moduleState.initialized) return;
    moduleState.initialized = true;

    const METADATA_WAIT_MS = 4000;
    const PAGE_DELIVERY_GRACE_MS = 8000;
    const RETRY_DELAY_MS = 150;

    let scheduledTimer = null;
    let scheduledChain = null;
    let inFlightChain = null;
    let rerunRequested = null;
    let nextChainId = 0;
    let pageGraceUri = null;
    let pageGraceUntil = 0;
    let lastObservedUri = Spicetify.Player.data?.item?.uri || null;

    const finishChain = (chain) => {
        if (scheduledChain?.id === chain.id) {
            scheduledChain = null;
        }
        if (rerunRequested?.id === chain.id) {
            rerunRequested = null;
        }
    };

    const getCurrentTrack = () => {
        const snapshot = window.Utils?.getPlayerPlaybackSnapshot?.() || null;
        const item = window.Utils?.resolveStablePlaybackTrack?.(null, snapshot) || null;
        if (snapshot?.djNarration === true && snapshot.uri) {
            return {
                uri: snapshot.uri,
                title: item?.metadata?.title || item?.name || "Spotify DJ",
                artist: item?.metadata?.artist_name || "",
                duration: snapshot.duration || 0,
                playbackId: snapshot.playbackId || null,
                isDjNarration: true
            };
        }

        const uri = item?.uri;
        const title = item?.metadata?.title || item?.name || "";
        const artist = item?.metadata?.artist_name
            || item?.artists?.map(artistItem => artistItem.name).filter(Boolean).join(", ")
            || "";

        if (!uri || !title) return null;
        return {
            uri,
            title,
            artist,
            duration: snapshot?.duration || Spicetify.Player.getDuration?.() || 0,
            playbackId: snapshot?.playbackId || null,
            isDjNarration: false
        };
    };

    const sendEmptyLyricsForDjNarration = async (trackInfo) => {
        const deliveries = [];
        if (window.OverlaySender?.enabled) {
            deliveries.push(window.OverlaySender.sendLyrics(
                trackInfo,
                [],
                true,
                "dj-narration"
            ));
        }
        if (window.lyricsHelperSender?.enabled) {
            deliveries.push(window.lyricsHelperSender.sendLyrics(
                trackInfo,
                [],
                true,
                "dj-narration"
            ));
        }
        await Promise.allSettled(deliveries);
    };

    const hasCurrentDelivery = (trackUri) => {
        const overlaySender = window.OverlaySender;
        const helperSender = window.lyricsHelperSender;
        const overlayEnabled = !!overlaySender?.enabled;
        const helperEnabled = !!helperSender?.enabled;

        return {
            anyEnabled: overlayEnabled || helperEnabled,
            complete: (!overlayEnabled || overlaySender.lastDeliveredUri === trackUri)
                && (!helperEnabled || helperSender.lastDeliveredUri === trackUri)
        };
    };

    const schedule = (delay = 1200, previousUri = null, existingChain = null) => {
        let chain = existingChain;
        if (chain) {
            if (chain.id !== scheduledChain?.id && chain.id !== rerunRequested?.id) {
                return;
            }
        } else if (
            scheduledTimer
            && scheduledChain
            && (!previousUri || !scheduledChain.previousUri
                || previousUri === scheduledChain.previousUri)
        ) {
            chain = scheduledChain;
            if (!chain.previousUri && previousUri) {
                chain.previousUri = previousUri;
            }
        } else {
            chain = {
                id: ++nextChainId,
                previousUri: previousUri || null,
                metadataDeadline: Date.now() + METADATA_WAIT_MS
            };
        }

        if (scheduledTimer) {
            clearTimeout(scheduledTimer.handle);
        }

        const timerHandle = setTimeout(async () => {
            if (scheduledTimer?.handle === timerHandle) {
                scheduledTimer = null;
            }
            if (scheduledChain?.id !== chain.id) return;

            if (inFlightChain) {
                if (!rerunRequested || chain.id > rerunRequested.id) {
                    rerunRequested = chain;
                }
                return;
            }

            const trackInfo = getCurrentTrack();
            if (!trackInfo) {
                if (Date.now() < chain.metadataDeadline) {
                    schedule(RETRY_DELAY_MS, null, chain);
                } else {
                    finishChain(chain);
                }
                return;
            }

            if (
                chain.previousUri
                && trackInfo.uri === chain.previousUri
                && Date.now() < chain.metadataDeadline
            ) {
                schedule(RETRY_DELAY_MS, null, chain);
                return;
            }
            lastObservedUri = trackInfo.uri;

            const delivery = hasCurrentDelivery(trackInfo.uri);
            if (!delivery.anyEnabled || delivery.complete) {
                finishChain(chain);
                return;
            }

            if (trackInfo.isDjNarration) {
                inFlightChain = chain;
                try {
                    await sendEmptyLyricsForDjNarration(trackInfo);
                } finally {
                    if (inFlightChain?.id === chain.id) {
                        inFlightChain = null;
                    }
                    finishChain(chain);
                }
                return;
            }

            // ivLyrics 페이지는 렌더링 결과를 lyrics-ready로 곧바로 공유한다.
            // 중복 번역 요청을 피하되, 페이지 쪽 처리가 실패한 경우에는 직접 보충한다.
            const pathname = Spicetify.Platform?.History?.location?.pathname || "";
            if (pathname.includes("/ivLyrics")) {
                if (pageGraceUri !== trackInfo.uri) {
                    pageGraceUri = trackInfo.uri;
                    pageGraceUntil = Date.now() + PAGE_DELIVERY_GRACE_MS;
                }
                if (Date.now() < pageGraceUntil) {
                    schedule(1000, null, chain);
                    return;
                }
            }

            inFlightChain = chain;
            try {
                await window.LyricsService.getFullLyrics(
                    trackInfo,
                    { sendToOverlay: true }
                );
            } catch (error) {
                console.error("[OverlayService] 현재 곡 가사 동기화 실패:", error);
            } finally {
                if (inFlightChain?.id === chain.id) {
                    inFlightChain = null;
                }

                const rerunChain = rerunRequested;
                if (
                    rerunChain
                    && scheduledChain?.id === rerunChain.id
                    && rerunChain.id > chain.id
                ) {
                    rerunRequested = null;
                    schedule(RETRY_DELAY_MS, null, rerunChain);
                } else {
                    if (
                        rerunChain
                        && rerunChain.id < (scheduledChain?.id || chain.id)
                    ) {
                        rerunRequested = null;
                    }
                    finishChain(chain);
                }
            }
        }, Math.max(0, Number(delay) || 0));

        scheduledChain = chain;
        scheduledTimer = { handle: timerHandle, chainId: chain.id };
    };

    const songChangeListener = () => {
        const previousUri = lastObservedUri;
        schedule(RETRY_DELAY_MS, previousUri);
    };

    const destroy = () => {
        if (scheduledTimer) {
            clearTimeout(scheduledTimer.handle);
            scheduledTimer = null;
        }
        Spicetify.Player.removeEventListener("songchange", songChangeListener);
        scheduledChain = null;
        inFlightChain = null;
        rerunRequested = null;
        moduleState.initialized = false;
    };

    const api = {
        schedule,
        syncNow() {
            schedule(0);
        },
        destroy,
        getState() {
            return {
                initialized: moduleState.initialized,
                lastObservedUri,
                scheduledUri: scheduledChain?.previousUri || null,
                inFlight: !!inFlightChain
            };
        }
    };

    window.ivLyricsOverlayService = api;
    Spicetify.Player.addEventListener("songchange", songChangeListener);

    // Extension이 늦게 로드되어 songchange를 놓친 경우에도 현재 곡을 보충한다.
    schedule(1200);
})();
