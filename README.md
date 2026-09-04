# ivLyrics (Kuass fork)

[ivLis-Studio/ivLyrics](https://github.com/ivLis-Studio/ivLyrics)를 개인 용도로 다듬은 포크입니다. Spicetify용 가사 앱이며, 번역·발음 표기·노래방 가사·전체 화면 같은 핵심 기능은 그대로 두고, 운영 서버에 묶인 부가 기능과 쓰지 않는 모드를 걷어냈습니다. 원본에서 겪었던 "업데이트하면 설정이 전부 사라지는" 문제를 앱 바깥에서 막아 주는 관리 도구도 함께 제공합니다.

A personal fork of [ivLis-Studio/ivLyrics](https://github.com/ivLis-Studio/ivLyrics), a lyrics app for Spicetify. Core features such as translation, pronunciation, karaoke lyrics and fullscreen mode are kept; features tied to the upstream server and unused modes are removed. It also ships a management tool that prevents the upstream problem of settings being wiped on update.

> macOS 전용이며 Spicetify가 먼저 설치되어 있어야 합니다.\
> macOS only. Spicetify must already be installed.

## 목차 / Contents

1. [원본과 달라진 점 / Differences from upstream](#1-원본과-달라진-점--differences-from-upstream)
2. [추가하거나 바꾼 동작 / Added and changed behavior](#2-추가하거나-바꾼-동작--added-and-changed-behavior)
3. [성능 / Performance](#3-성능--performance)
4. [설정 보호 / Settings protection](#4-설정-보호--settings-protection)
5. [설치와 명령어 / Install and commands](#5-설치와-명령어--install-and-commands)
6. [개발 / Development](#6-개발--development)
7. [크레딧과 라이선스 / Credits and license](#7-크레딧과-라이선스--credits-and-license)

## 1. 원본과 달라진 점 / Differences from upstream

### 제거한 기능 / Removed

- 공지 시스템, 마켓플레이스, 초기 설정 마법사\
  Announcements, marketplace (addon store), first-run wizard
- Discord 로그인, 후원자 등급 장식, 크리에이터 프로필, 유료 클라우드 설정 동기화\
  Discord login, supporter badges, creator profiles, paid cloud settings sync
- 학습 모드, LP 플레이어 모드, 가사 이미지 공유\
  Study mode, LP player mode, lyric image sharing
- 외부 오버레이 서비스와 별도 헬퍼 앱 연동\
  External overlay service and the helper-app integration
- 한국어와 영어를 제외한 언어 팩\
  Language packs other than Korean and English
- 원본 설치 스크립트와 `ivlyrics-updater://` 프로토콜 핸들러\
  Upstream installer and the `ivlyrics-updater://` protocol handler

### 유지한 기능 / Kept

- 가사 표시(동기화·비동기화·노래방), 번역과 발음 표기, 후리가나\
  Synced, unsynced and karaoke lyrics; translation, pronunciation, furigana
- 전체 화면 모드, 우측 "지금 재생 중" 패널 가사, 재생 막대 버튼, 전역 단축키\
  Fullscreen mode, Now Playing panel lyrics, playbar button, global shortcuts
- 모든 AI 제공자(Bing, Google, Gemini, ChatGPT, Claude, Groq, OpenRouter, Perplexity, Pollinations, Paxsenix)와 가사 소스(LRCLIB, Spotify, LyricsPlus, Unison, Paxsenix, 커뮤니티 싱크 데이터)\
  Every AI provider (Bing, Google, Gemini, ChatGPT, Claude, Groq, OpenRouter, Perplexity, Pollinations, Paxsenix) and lyrics source (LRCLIB, Spotify, LyricsPlus, Unison, Paxsenix, community sync data)
- 커뮤니티 뮤직비디오 배경, 곡 정보 리서치 리더, 싱크 데이터 제작기\
  Community music-video background, song research reader, sync data creator
- 곡별 싱크 오프셋과 언어 오버라이드, 설정 내보내기·가져오기\
  Per-track sync offset and language override, settings export and import

### 버그 수정 / Bug fixes (upstream 6.6.3)

- 우측 패널의 노래방 렌더링에서 `segmentSpeakerPresentation` 참조 오류가 나던 문제\
  A `segmentSpeakerPresentation` reference error in the panel's karaoke renderer
- 헬퍼 앱 연결 설정이 비어 있을 때 켜진 것으로 간주해 로컬 포트에 계속 접속을 시도하던 문제\
  An empty helper-app setting being treated as enabled, causing endless local-port connection attempts

## 2. 추가하거나 바꾼 동작 / Added and changed behavior

### 가사 / Lyrics

- **망가진 타임스탬프 필터링**: 타임스탬프가 전부 같은 값이거나, 초 단위를 밀리초로 잘못 읽었거나, 순서가 뒤섞인 결과는 동기화 가사로 쓰지 않고 다음 제공자로 넘어갑니다. 다른 제공자도 없으면 같은 텍스트를 비동기 가사로 보여 줍니다. 원본에서는 이런 가사가 걸리면 재생 시작과 함께 마지막 줄만 보였습니다.\
  **Broken timestamp filtering**: synced results whose timestamps are all identical, in seconds instead of milliseconds, or mostly out of order are rejected and the next provider is tried. With no other provider, the same text is shown as unsynced lyrics. Upstream showed only the last line from the start in these cases.
- **패널 가사 표시 조건**: 우측 패널 가사는 Spotify가 그 곡의 가사를 직접 보여 주지 않을 때만 표시됩니다. 설정 "패널 가사" 탭의 "Spotify 기본 가사가 없을 때만 표시"로 끕니다.\
  **Panel lyrics condition**: the Now Playing panel shows lyrics only when Spotify itself does not. Toggle: Settings > Panel lyrics > "Only when Spotify has no lyrics".

### AI / AI features

모든 AI 기능은 LLM 계열 제공자가 하나 이상 켜져 있을 때만 동작하며, 각각 설정에서 끌 수 있습니다.\
Every AI feature runs only when at least one LLM provider is enabled, and each has its own setting.

- **번역 맥락과 사용자 지침**: 번역 프롬프트에 곡 제목과 아티스트를 함께 보내 화자와 장르에 맞는 어투를 잡게 합니다. 설정 "AI 제공자" 탭의 "AI 번역 추가 지침"에 "반말로", "멤버 이름은 원문 유지" 같은 취향을 적으면 모든 LLM 제공자에 적용되고, 지침이 바뀌면 이전 번역 캐시는 쓰지 않습니다.\
  **Translation context and user instructions**: the translation prompt includes the song title and artist so the model picks a register that fits the narrator and genre. Settings > AI providers > "Extra instructions for AI translation" is appended to every LLM request; changing it invalidates cached translations.
- **언어 감지 AI 보조**: 규칙 기반 감지기가 확신하지 못한 곡(로마자 표기, 여러 언어 혼용, 스페인어와 포르투갈어처럼 비슷한 라틴 문자 언어)만 LLM 제공자에게 묻습니다. 답이 다르면 그 곡의 언어 오버라이드로 저장하므로 옵션 메뉴에서 바로 확인하고 고칠 수 있습니다. 설정: "언어 감지가 애매하면 AI에게 확인".\
  **AI-assisted language detection**: only songs the rule-based detector is unsure about (romanized lyrics, mixed languages, similar Latin-script languages) are sent to an LLM. A differing answer is stored as that track's language override, visible and editable in the options menu. Setting: "Ask AI when language detection is unsure".
- **화자 제안**: 싱크 데이터 제작기의 "AI 화자 제안" 버튼이 줄마다 화자 초안을 배정합니다. 결과는 기존 화자 편집 도구로 고칩니다.\
  **Speaker suggestion**: the "AI speaker suggestion" button in the sync data creator drafts a speaker for every line, editable with the existing tools.
- **공식 영상 AI 판정**: 채널과 제목 규칙이 확답하지 못할 때만 검색 상위 후보의 제목·채널·길이를 보내 공식 뮤직비디오를 고르게 합니다. 오디오 전용 업로드는 후보에서 뺍니다. 설정: "애매한 공식 영상 판정은 AI에게".\
  **AI judge for official videos**: when channel and title rules cannot decide, the top search results (title, channel, length) are sent to an LLM to pick the official music video. Audio-only uploads are excluded. Setting: "Let AI settle ambiguous official-video matches".

### 영상 배경 / Video background

- **전체 화면에서만 재생**: 가사 페이지는 앨범 색을 뽑은 블러 그라데이션 배경을 쓰고, 다음 곡 영상 미리 받기도 전체 화면일 때만 합니다. 설정: "전체 화면에서만 동영상 배경".\
  **Fullscreen only**: the lyrics page uses a blurred gradient from the album colors, and prefetching of the next video happens only in fullscreen. Setting: "Video background only in fullscreen".
- **공식 채널 우선**: 서버가 고른 영상의 채널을 oEmbed로 확인하고, 공식 채널이 아니면 공개 Piped 인스턴스 세 곳을 동시에 검색해 공식 뮤직비디오로 바꿉니다. 무대·안무·티저·가사 영상과 공식 오디오는 고르지 않고, 공식 뮤직비디오가 없으면 원래 영상을 둡니다. 서버 영상을 먼저 띄운 뒤 뒤에서 확인하므로 배경이 늦게 뜨지 않으며, 결과는 곡별로 캐시됩니다. 곡 제목과 아티스트 이름이 YouTube와 해당 인스턴스로 전달됩니다. 설정: "아티스트 공식 채널 영상 우선".\
  **Prefer the official channel**: the server-picked video's channel is verified via oEmbed; fan uploads are replaced with the official music video found by querying three public Piped instances in parallel. Stage, dance-practice, teaser, lyric and audio-only videos are skipped; without an official video the original is kept. The server video is shown first and verified in the background; results are cached per track. Title and artist are sent to YouTube and the Piped instances. Setting: "Prefer the artist's official channel".
- **자막 기준점으로 싱크 맞추기**: 교체한 영상은 서버가 준 자막 시작 시각이 없어 인트로만큼 어긋났습니다. 이제 Piped가 노출하는 YouTube 자막(자동 생성 우선)의 첫 큐를 읽어 첫 가사와 맞추는 기준점으로 쓰고, 인트로로 볼 수 없는 간격이면 쓰지 않습니다. 기준점은 Piped 인스턴스가 응답할 때만 채워집니다.\
  **Caption-anchored sync**: replaced videos had no caption start time and drifted by the length of the intro. The first cue of the video's YouTube captions (auto-generated preferred) exposed by Piped now anchors the first lyric; implausible offsets are ignored. The anchor is filled only when a Piped instance responds.
- **되감기 보정**: 0.5초 넘게 어긋날 때만 되감던 것에 더해, 작은 오차가 한 방향으로 1초 이상 이어지면 한 번 더 맞추고, 되감기 직후 남는 지연을 측정해 다음 목표에 미리 더합니다.\
  **Seek correction**: besides seeking on drift above 0.5 s, a small drift that persists in one direction for a second triggers one more correction, and the residual latency after each seek is measured and pre-added to the next target.

### 전체 화면 / Fullscreen

- **곡 전환**: 이전 영상 플레이어를 배경이 어두워지는 0.5초 동안 남겨 둔 뒤 정리하고, 앨범 아트 배경은 이전 이미지 위로 페이드인하며, 제목과 아티스트 글자는 짧게 떠오르며 바뀝니다.\
  **Track transitions**: the previous player is kept through the 0.5 s fade-out before disposal, the album-art fallback cross-fades over the previous image, and title and artist text animate in.
- **제목 자동 축소**: 긴 제목은 글자 크기가 자동으로 줄어듭니다. 한글·한자·가나는 라틴 문자보다 넓게 계산하고, 설정 크기의 55% 아래로는 내려가지 않습니다.\
  **Title auto-fit**: long titles shrink automatically. CJK glyphs count as wider than Latin letters; the size never drops below 55 % of the configured value.
- **줄 전환**: 줄이 바뀔 때의 이동을 620ms의 완만한 곡선으로 늘리고, 색·불투명도·크기 변화도 같은 시간에 걸쳐 함께 바뀝니다. 노래방 모드의 줄 전환 애니메이션 설정이 꺼져 있어도 전체 화면에서는 이동을 애니메이션합니다.\
  **Line transitions**: line movement takes 620 ms on a gentle curve, and color, opacity and scale changes animate over the same time. In fullscreen the movement is animated even when the karaoke line-transition setting is off.
- **추천곡 숨기기**: Spotify가 추천곡을 재생할 때 재생 막대에 띄우는 "숨기기" 스위치를 전체 화면의 좋아요 버튼 옆에서 그대로 누를 수 있습니다. Spotify가 그 스위치를 보여 주는 곡에서만 나타나고, 상태도 Spotify 값을 따릅니다.\
  **Hide recommended tracks**: the "Hide" switch Spotify shows in the playbar for recommended tracks can be pressed next to the fullscreen like button. It appears only when Spotify shows its own switch and mirrors its state.
- **가사 배치**: 전체 화면 스타일 설정에서 따로 조절하며, 가사 페이지의 배치는 그대로입니다. 이전 줄은 불투명도를 낮추고 다음 줄은 현재 줄 색을 섞어, 다음 줄이 이전 줄보다 잘 보입니다.\
  **Lyric layout**: adjusted in the fullscreen style settings; the lyrics page keeps its own layout. Past lines are dimmed and upcoming lines are blended toward the current color, so the next line reads more clearly than the previous one.

  | 설정 / Setting | 기본값 / Default | 설명 / Description |
  | --- | --- | --- |
  | 지나간 가사 표시 줄 수 / Past lines kept on screen | 1 | 이미 부른 줄을 현재 줄 위에 남깁니다. / Already-sung lines stay above the current line. |
  | 다음 가사 표시 줄 수 / Upcoming lines shown | 1 | 앞으로 부를 줄을 현재 줄 아래에 보여 줍니다. / Upcoming lines shown below the current line. |
  | 다음 가사 선명도 / Visibility of upcoming lines | 45% | 다음 줄 색을 현재 줄 색과 이만큼 섞습니다. / Blends upcoming lines toward the current line's color. |
  | 이전 가사 불투명도 / Opacity of past lines | 75% | 이미 부른 줄을 이 불투명도로 눌러 둡니다. / Already-sung lines are dimmed to this opacity. |
  | 가사 줄 사이 추가 간격 / Extra space between lines | 28px | 글자 크기만큼 벌어지던 줄 간격을 대신합니다. / Replaces the font-size-wide gap between lines. |
  | 현재 줄에서 멀어질 때 축소 비율 / Shrink per line away from the current one | 8% | 한 줄 멀어질 때마다 그만큼 작게, 최대 세 줄까지 적용합니다. / Each line farther is scaled down by this much, up to three lines. |

### 설정 창 / Settings window

- **좁은 창 배치**: 원본은 창 너비 1100px과 900px 아래에서 한 열로 접으면서 사이드바를 220px 높이 상자로 줄여 메뉴가 잘렸습니다. 두 열 배치를 860px까지 유지하고, 접힌 뒤의 사이드바 높이를 화면의 42%(최대 380px)로 늘렸습니다.\
  **Narrow-window layout**: upstream collapsed to one column below 1100 px and 900 px, shrinking the sidebar to a 220 px box that clipped the menu. The two-column layout now holds down to 860 px, and the collapsed sidebar grows to 42 % of the viewport (max 380 px).
- **가독성**: 설정 창의 글자 크기와 두께를 한 단계 올리고 보조 텍스트의 대비를 높였습니다. 글꼴 순서는 Pretendard와 macOS 시스템 글꼴을 앞에 둡니다.\
  **Legibility**: font sizes and weights are one step larger and secondary text has more contrast. Pretendard and the macOS system font come first in the font stack.
- **원저자 후원 버튼**: 헤더의 후원 버튼을 "원저자 후원"으로 이름을 바꾸고 작게 줄였습니다.\
  **Support the original author**: the header donate button is renamed and made smaller.

### 업데이트 알림 / Update notice

앱 안의 업데이트 알림은 이 저장소의 `main` 브랜치를 기준으로 표시되고, 실제 갱신은 `ivlyrics update`로 합니다.\
The in-app update notice tracks this repository's `main` branch; the actual update is done with `ivlyrics update`.

## 3. 성능 / Performance

Spotify 전체 메모리 약 1GB 중 약 850MB는 ivLyrics를 빼도 남는 Spotify의 몫이므로, 여기서 줄인 것은 ivLyrics가 더 쓰는 부분입니다.\
Of Spotify's roughly 1 GB, about 850 MB remains without ivLyrics, so the savings below are ivLyrics' own share.

- YouTube 광고 차단 계층은 YouTube 플레이어가 살아 있는 동안만 `fetch`, `XMLHttpRequest`, `createElement`, `WebSocket`을 가로채고, 플레이어가 사라지면 원래 함수로 돌아갑니다. 원본은 시작과 동시에 Spotify 전체에서 가로챘습니다.\
  The YouTube ad-block layer hooks `fetch`, `XMLHttpRequest`, `createElement` and `WebSocket` only while a player exists and restores them afterwards; upstream hooked them app-wide at startup.
- 후리가나용 kuromoji는 후리가나를 켰을 때만 내려받습니다.\
  The kuromoji library loads only when furigana is enabled.
- 패널 가사의 DOM 감시는 우측 사이드바 컨테이너만 대상으로 하고, Spotify가 직접 가사를 보여 주는 동안은 멈춥니다.\
  The panel's DOM observer watches only the right sidebar and pauses while Spotify shows its own lyrics.
- 가사 캐시의 IndexedDB 상한을 10GiB에서 1GiB로 낮췄습니다.\
  The lyrics cache's IndexedDB limit dropped from 10 GiB to 1 GiB.
- 제거한 기능이 남긴 CSS 규칙 619개(약 130KB)와 번역 문구 522개를 지웠습니다.\
  619 CSS rules (about 130 KB) and 522 translation strings left by removed features were deleted.
- YouTube 플레이어 준비 제한 시간을 15초에서 30초로 늘려, 영상은 뜨는데 오류 알림만 뜨던 일을 없앴습니다.\
  The YouTube player-ready deadline grew from 15 s to 30 s, removing false error toasts.

결과: 홈 화면 기준 JS 힙이 약 138MB에서 103MB로 줄었고, 가사 페이지에서 YouTube iframe이 사라졌습니다.\
Result: the JS heap on the home screen fell from about 138 MB to 103 MB, and the lyrics page no longer hosts a YouTube iframe.

## 4. 설정 보호 / Settings protection

### 원인 / Cause

ivLyrics의 설정은 Spotify 화면(xpui)의 localStorage에 저장되고, Spotify는 그 파일을 `~/Library/Caches/com.spotify.client/Browser/` 아래에 둡니다. 캐시 폴더라서 "캐시 지우기", 정리 도구, 프로필 복구 등으로 통째로 비워질 수 있고, 그때 설정과 IndexedDB 백업이 함께 사라집니다. 확장 프로그램이 이 폴더 바깥에 쓸 수 있는 Spotify API가 없으므로 보호는 앱 바깥의 도구가 맡습니다.

Settings live in the xpui localStorage, which Spotify stores under `~/Library/Caches/com.spotify.client/Browser/`. Being a cache, it can be wiped by "Clear cache", cleanup tools or profile recovery, taking settings and IndexedDB backups with it. No Spotify API lets an extension write outside this folder, so protection is handled by an external tool.

### 해결 / Solution: `ivlyrics protect`

1. `Local Storage`와 `IndexedDB` 폴더를 `~/Library/Application Support/Spotify/xpui-profile/`로 옮기고 원래 자리에 심볼릭 링크를 둡니다. 캐시가 지워지면 링크만 사라지고 데이터는 남습니다.\
   Moves `Local Storage` and `IndexedDB` to `~/Library/Application Support/Spotify/xpui-profile/` and leaves symlinks behind; a cache wipe removes only the links.
2. launchd 에이전트 `com.kuass.ivlyrics.guard`가 매시간 끊긴 링크를 복구하고, `~/.config/spicetify/ivLyrics/storage-backups/`에 스냅샷을 14개까지 보관합니다.\
   The launchd agent `com.kuass.ivlyrics.guard` repairs broken links hourly and keeps up to 14 snapshots in `~/.config/spicetify/ivLyrics/storage-backups/`.
3. 업데이트는 Spotify를 강제 종료하지 않고 정상 종료한 뒤 진행해, 저장소가 디스크에 온전히 기록된 상태에서 파일을 바꿉니다.\
   Updates quit Spotify gracefully instead of killing it, so storage is fully flushed before files change.

## 5. 설치와 명령어 / Install and commands

### 설치 / Install

```bash
curl -fsSL https://raw.githubusercontent.com/Kuass/ivLyrics/main/scripts/ivlyrics | bash -s install
```

명령은 `~/.config/spicetify/ivLyrics/bin/ivlyrics`에 놓이고, `~/.local/bin`이 있으면 그곳에도 링크가 생깁니다. 설치 중 Spotify가 한 번 재시작됩니다.\
The command is installed at `~/.config/spicetify/ivLyrics/bin/ivlyrics`, with a link in `~/.local/bin` when that directory exists. Spotify restarts once during installation.

### 업데이트 / Update

```bash
ivlyrics update
```

### 명령어 / Commands

| 명령 / Command | 설명 / Description |
| --- | --- |
| `ivlyrics install` | 앱을 설치하거나 갱신한 뒤 설정 보호를 켭니다. / Installs or updates the app and enables protection. |
| `ivlyrics update [--ref <branch\|tag>]` | 스냅샷을 남기고 Spotify를 정상 종료한 뒤 갱신합니다. / Snapshots, quits Spotify gracefully, then updates. |
| `ivlyrics protect` / `unprotect` | 설정 보호를 켜거나 끕니다. 끄면 폴더를 되돌립니다. / Enables or disables protection; disabling moves the folders back. |
| `ivlyrics backup` | 지금 상태를 스냅샷으로 남깁니다. / Takes a snapshot now. |
| `ivlyrics restore [snapshot]` | 최신 또는 지정한 스냅샷을 되살립니다. 그 전에 현재 상태도 저장합니다. / Restores the latest or given snapshot after saving the current state. |
| `ivlyrics status` | 버전, 보호 상태, 스냅샷 수, 에이전트 상태를 보여 줍니다. / Shows version, protection, snapshot count and agent status. |
| `ivlyrics uninstall` | 앱과 에이전트를 제거합니다. 설정과 스냅샷은 남깁니다. / Removes the app and agent, keeping settings and snapshots. |

로그: `~/.config/spicetify/ivLyrics/ivlyrics.log`\
Log file: `~/.config/spicetify/ivLyrics/ivlyrics.log`

### 설정이 비어 보일 때 / When settings look empty

1. `ivlyrics status`로 보호 상태를 확인합니다. `broken`이면 Spotify를 종료한 뒤 `ivlyrics update` 또는 `ivlyrics guard`로 링크를 복구합니다.\
   Check `ivlyrics status`. If it says `broken`, quit Spotify and run `ivlyrics update` or `ivlyrics guard` to repair the links.
2. 그래도 비어 있으면 `ivlyrics restore`로 최신 스냅샷을 되살립니다.\
   If still empty, run `ivlyrics restore` to bring back the latest snapshot.

## 6. 개발 / Development

단위 테스트는 `node --test tests/`로 실행합니다.\
Run unit tests with `node --test tests/`.

| 테스트 / Test | 대상 / Covers |
| --- | --- |
| `tests/official_video_preference.test.mjs` | 영상 채점, 자막 기준점 파서, AI 판정 경로 / video scoring, caption-cue parser, AI judge path |
| `tests/broken_sync_timing.test.mjs` | 깨진 타임스탬프 판별 / broken timestamp detection |
| `tests/video_background_sync.test.mjs` | 영상 되감기 보정 / video seek correction |

저장소를 `~/.config/spicetify/CustomApps/ivLyrics`에 두지 않아도 됩니다. 수정 후에는 `ivlyrics update --ref <branch>`로 설치하거나, `rsync`로 복사한 뒤 `spicetify apply`를 실행합니다.\
The repository does not need to live in `~/.config/spicetify/CustomApps/ivLyrics`. After changes, install with `ivlyrics update --ref <branch>`, or copy with `rsync` and run `spicetify apply`.

## 7. 크레딧과 라이선스 / Credits and license

원저작은 [ivLis STUDIO](https://github.com/ivLis-Studio)의 ivLyrics이며, 그 뿌리는 spicetify의 [Lyrics-Plus](https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus)입니다. 이 포크는 원본과 같은 LGPL-2.1 라이선스를 따릅니다. Spotify와 무관한 비공식 확장 프로그램이며, 사용에 따른 책임은 사용자에게 있습니다.

The original work is ivLyrics by [ivLis STUDIO](https://github.com/ivLis-Studio), itself descended from spicetify's [Lyrics-Plus](https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus). This fork keeps the upstream LGPL-2.1 license. It is an unofficial extension unaffiliated with Spotify; use at your own risk.
