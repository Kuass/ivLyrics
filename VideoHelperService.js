/**
 * VideoHelperService - 로컬 헬퍼 프로그램과 통신하는 서비스
 * 
 * 헬퍼 프로그램은 YouTube 영상을 다운로드하여 로컬에서 제공합니다.
 * API 엔드포인트: localhost:15123
 */

const VideoHelperService = (() => {
  const BASE_URL = "http://localhost:15123";
  const DOWNLOAD_URL = "https://ivlis.kr/ivLyrics/extensions/#helper";

  // 연결 상태
  let isConnected = false;
  let lastHealthCheck = 0;
  let healthCheckPromise = null;
  const HEALTH_CHECK_INTERVAL = 30000; // 30초

  /**
   * 헬퍼 서버 상태 확인
   * @returns {Promise<boolean>} 연결 여부
   */
  const performHealthCheck = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`${BASE_URL}/health`, {
        signal: controller.signal,
      });

      isConnected = response.ok && (await response.text()) === "OK";
      lastHealthCheck = Date.now();
      return isConnected;
    } catch (e) {
      isConnected = false;
      lastHealthCheck = Date.now();
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const checkHealth = () => {
    if (!healthCheckPromise) {
      healthCheckPromise = performHealthCheck().finally(() => { healthCheckPromise = null; });
    }
    return healthCheckPromise;
  };

  /**
   * 캐시된 연결 상태 반환 (일정 시간 이내면 캐시 사용)
   * @returns {Promise<boolean>}
   */
  const isHelperAvailable = async () => {
    if (healthCheckPromise) return healthCheckPromise;
    if (lastHealthCheck && Date.now() - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
      return isConnected;
    }
    return await checkHealth();
  };

  /**
   * 비디오 상태 확인 (단순 조회)
   * @param {string} videoId - YouTube 비디오 ID
   * @returns {Promise<{success: boolean, url: string|null, message: string}>}
   */
  const getVideoStatus = async (videoId) => {
    if (!videoId) {
      return { success: false, url: null, message: "Invalid video ID" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${BASE_URL}/video/status?id=${encodeURIComponent(videoId)}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return {
        success: data.success,
        url: data.url,
        message: data.message,
        videoId: data.video_id,
      };
    } catch (e) {
      return { success: false, url: null, message: "Failed to check video status" };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  /**
   * 비디오 요청 (SSE 스트림으로 다운로드 진행 상황 받기)
   * @param {string} videoId - YouTube 비디오 ID
   * @param {object} callbacks - 콜백 함수들
   * @param {function} callbacks.onProgress - 진행 상황 콜백 (percent, speed, eta, message, status)
   * @param {function} callbacks.onComplete - 완료 콜백 (url)
   * @param {function} callbacks.onError - 에러 콜백 (message)
   * @returns {function} abort 함수
   */
  const requestVideo = (videoId, callbacks = {}) => {
    const { onProgress, onComplete, onError } = callbacks;
    let aborted = false;
    let settled = false;
    let reader = null;
    let idleTimer = null;
    const controller = new AbortController();
    const MAX_EVENT_SIZE = 1024 * 1024;

    const finish = (callback, value) => {
      if (aborted || settled) return;
      settled = true;
      clearTimeout(idleTimer);
      callback?.(value);
    };
    const cancelReader = () => {
      if (reader) reader.cancel().catch(() => {});
    };
    const resetIdleTimeout = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        controller.abort();
        cancelReader();
        finish(onError, "Video request timed out");
      }, 90_000);
    };
    const isVideoUrl = value => {
      if (typeof value !== "string") return false;
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    };

    if (!videoId) {
      finish(onError, "Invalid video ID");
      return () => {};
    }

    const fetchVideo = async () => {
      resetIdleTimeout();
      try {
        const response = await fetch(`${BASE_URL}/video/request?id=${encodeURIComponent(videoId)}`, {
          signal: controller.signal,
        });
        if (aborted || settled) {
          await response.body?.cancel();
          return;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Video request failed (HTTP ${response.status})`);
        }
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (data.success && isVideoUrl(data.url)) finish(onComplete, data.url);
          else finish(onError, data.message || "Video request failed");
          return;
        }
        if (!contentType.includes("text/event-stream") || !response.body) {
          await response.body?.cancel();
          throw new Error("Unexpected video response type");
        }

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventType = "";
        let dataLines = [];
        let eventSize = 0;
        const dispatch = () => {
          const type = eventType;
          const payload = dataLines.join("\n");
          eventType = "";
          dataLines = [];
          eventSize = 0;
          if (!payload || aborted || settled) return;
          let data;
          try { data = JSON.parse(payload); } catch { return; }
          if (!data || typeof data !== "object") return;
          if (type === "progress") {
            onProgress?.({
              percent: data.percent || 0, speed: data.speed, eta: data.eta,
              message: data.message, status: data.status,
            });
          } else if (type === "error") {
            finish(onError, data.message || "Download failed");
          } else if (type === "complete" || (!type && data.status === "completed")) {
            if (data.status === "completed") {
              const videoUrl = data.url || data.message;
              if (isVideoUrl(videoUrl)) finish(onComplete, videoUrl);
            } else if (data.status === "error") {
              const message = String(data.message || "");
              if (!message.startsWith("WARNING")) finish(onError, message || "Download failed");
            }
          }
        };
        const processLine = line => {
          if (!line) { dispatch(); return; }
          eventSize += line.length;
          if (eventSize > MAX_EVENT_SIZE) throw new Error("Video event exceeds size limit");
          if (line.startsWith(":")) return;
          const separator = line.indexOf(":");
          const field = separator < 0 ? line : line.slice(0, separator);
          let value = separator < 0 ? "" : line.slice(separator + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "event") eventType = value;
          else if (field === "data") dataLines.push(value);
        };
        const consume = (final = false) => {
          let start = 0;
          for (let index = 0; index < buffer.length; index++) {
            const character = buffer[index];
            if (character !== "\n" && character !== "\r") continue;
            // Keep a split CRLF pair together until the next network chunk.
            if (character === "\r" && index === buffer.length - 1 && !final) break;
            processLine(buffer.slice(start, index));
            if (character === "\r" && buffer[index + 1] === "\n") index++;
            start = index + 1;
            if (aborted || settled) break;
          }
          buffer = buffer.slice(start);
          if (!settled && !aborted && buffer.length + eventSize > MAX_EVENT_SIZE) {
            throw new Error("Video event exceeds size limit");
          }
          if (final && !settled && !aborted) {
            if (buffer) processLine(buffer);
            buffer = "";
            dispatch();
          }
        };

        while (!aborted && !settled) {
          const { done, value } = await reader.read();
          if (aborted || settled) break;
          if (done) {
            buffer += decoder.decode();
            consume(true);
            break;
          }
          resetIdleTimeout();
          buffer += decoder.decode(value, { stream: true });
          consume();
        }
        finish(onError, "Video stream ended before download completed");
      } catch (error) {
        if (!aborted && !settled) {
          console.error("[VideoHelperService] Request error:", error);
          finish(onError, error.message || "Request failed");
        }
      } finally {
        clearTimeout(idleTimer);
        if (reader) {
          try { await reader.cancel(); } catch {}
          reader.releaseLock();
          reader = null;
        }
      }
    };

    fetchVideo();
    return () => {
      aborted = true;
      clearTimeout(idleTimer);
      controller.abort();
      cancelReader();
    };
  };

  /**
   * 비디오 파일 URL 생성
   * @param {string} videoId - YouTube 비디오 ID
   * @returns {string} 비디오 파일 URL
   */
  const getVideoFileUrl = (videoId) => {
    return `${BASE_URL}/video/files/${encodeURIComponent(videoId)}.webm`;
  };

  /**
   * 헬퍼 프로그램 다운로드 URL 반환
   * @returns {string}
   */
  const getDownloadUrl = () => {
    return DOWNLOAD_URL;
  };

  /**
   * 헬퍼 프로그램 다운로드 페이지 열기
   */
  const openDownloadPage = () => {
    window.open(DOWNLOAD_URL, "_blank");
  };

  /**
   * YouTube 비디오 ID 추출
   * @param {string} url - YouTube URL 또는 비디오 ID
   * @returns {string|null} 비디오 ID
   */
  const extractVideoId = (url) => {
    if (!url) return null;

    // 이미 비디오 ID인 경우 (11자 영숫자+하이픈+언더스코어)
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
      return url;
    }

    // 다양한 YouTube URL 형식 지원
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  };

  // 공개 API
  return {
    checkHealth,
    isHelperAvailable,
    getVideoStatus,
    requestVideo,
    getVideoFileUrl,
    getDownloadUrl,
    openDownloadPage,
    extractVideoId,
    get isConnected() {
      return isConnected;
    },
    BASE_URL,
  };
})();

// 전역으로 노출
window.VideoHelperService = VideoHelperService;
