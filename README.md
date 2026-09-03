# ivLyrics (Kuass fork)

[ivLis-Studio/ivLyrics](https://github.com/ivLis-Studio/ivLyrics)를 개인 용도로 다듬은 포크입니다. Spicetify용 가사 앱이며, 번역과 발음 표기, 노래방 스타일 가사, 전체 화면 모드 같은 핵심 기능은 그대로 두고, 운영 서버에 묶인 부가 기능과 쓰지 않는 모드를 걷어냈습니다. 그리고 원본에서 겪었던 "업데이트하면 설정이 전부 사라지는" 문제를 앱 바깥에서 막아 주는 관리 도구를 함께 제공합니다.

> macOS 전용입니다. Spicetify가 이미 설치되어 있어야 합니다.

## 원본과 달라진 점

제거한 기능입니다.

- 공지 시스템, 마켓플레이스(애드온 스토어), 초기 설정 마법사
- Discord 로그인과 후원자 등급 장식, 크리에이터 프로필, 유료 클라우드 설정 동기화
- 학습 모드, LP 플레이어 모드, 가사 이미지 공유
- 외부 오버레이 서비스(별도 헬퍼 앱 연동)
- 한국어와 영어를 제외한 언어 팩
- 원본의 설치 스크립트와 `ivlyrics-updater://` 프로토콜 핸들러

유지한 기능입니다.

- 가사 표시(동기화·비동기화·노래방), 번역과 발음 표기, 후리가나
- 전체 화면 모드, 우측 "지금 재생 중" 패널 가사, 재생 막대 버튼, 전역 단축키
- 모든 AI 번역 제공자(Bing, Google, Gemini, ChatGPT, Claude, Groq, OpenRouter, Perplexity, Pollinations, Paxsenix)와 가사 소스(LRCLIB, Spotify, LyricsPlus, Unison, Paxsenix, 커뮤니티 싱크 데이터)
- 커뮤니티 뮤직비디오 배경, 곡 정보 리서치 리더, 싱크 데이터 제작기
- 곡별 싱크 오프셋과 언어 오버라이드, 설정 내보내기·가져오기

동작을 바꾼 부분입니다.

- 우측 "지금 재생 중" 패널 가사는 Spotify가 그 곡의 가사를 직접 보여 주지 않을 때만 표시됩니다. 설정의 "패널 가사" 탭에 있는 "Spotify 기본 가사가 없을 때만 표시"로 끌 수 있습니다.
- 동영상 배경은 전체 화면에서만 재생됩니다. 가사 페이지에서는 앨범 색을 뽑은 블러 그라데이션 배경을 쓰고, 다음 곡 영상 미리 받기도 전체 화면일 때만 합니다. 설정의 "동영상 배경" 아래 "전체 화면에서만 동영상 배경"으로 끌 수 있습니다.
- 앱 안의 업데이트 알림은 이 저장소의 `main` 브랜치를 기준으로 표시되고, 갱신은 `ivlyrics update`로 합니다.
- 영상 배경은 아티스트 공식 채널의 뮤직비디오를 우선합니다. 원본은 서버가 제목만 보고 골라서 팬 업로드가 자주 뽑혔습니다(예: Lady Gaga - Bloody Mary는 "Official Music Video"라는 제목의 팬 채널 영상). 이제 oEmbed로 채널을 확인하고, 공식 채널이 아니면 검색해서 공식 뮤직비디오로 바꿉니다. 무대 영상, 안무 영상, 티저, 가사 영상, 공식 오디오(정지 화면)는 고르지 않으며, 공식 뮤직비디오가 없는 곡은 기존 영상을 그대로 둡니다. 설정의 "아티스트 공식 채널 영상 우선"으로 끌 수 있고, 검색에는 CORS를 허용하는 공개 Piped 인스턴스를 사용합니다.

성능을 위해 손본 부분입니다. Spotify 전체 메모리는 약 1GB이고 그중 약 850MB는 ivLyrics를 빼도 남는 Spotify 자체의 몫이므로, 여기서 줄인 것은 ivLyrics가 더 쓰는 부분입니다.

- YouTube 광고 차단 계층은 원본에서 시작과 동시에 Spotify 전체의 `fetch`, `XMLHttpRequest`, `createElement`, `WebSocket` 등을 가로챘습니다. 이제 YouTube 플레이어가 살아 있는 동안만 켜지고, 플레이어가 사라지면 원래 함수로 돌아갑니다.
- 후리가나용 kuromoji 라이브러리는 후리가나를 켰을 때만 내려받습니다.
- 패널 가사의 DOM 감시는 body 전체가 아니라 우측 사이드바 컨테이너만 대상으로 하고, Spotify가 직접 가사를 보여 주는 동안은 멈춥니다.
- 가사 캐시의 IndexedDB 상한을 10GiB에서 1GiB로 낮췄습니다.
- 위 변경으로 홈 화면 기준 JS 힙이 약 138MB에서 103MB로 줄었고, 가사 페이지에서 YouTube iframe이 사라졌습니다.
- YouTube 플레이어 준비 제한 시간을 15초에서 30초로 늘렸습니다. 영상은 정상적으로 뜨는데도 "오류가 발생했습니다" 알림만 뜨는 일이 있었습니다.

원본 6.6.3에 있던 버그도 두 가지 고쳤습니다. 우측 패널의 노래방 렌더링에서 `segmentSpeakerPresentation` 참조 오류가 나던 문제와, 헬퍼 앱 연결 설정이 비어 있을 때 켜진 것으로 간주해 로컬 포트로 계속 접속을 시도하던 문제입니다.

## 설정이 사라지던 이유와 해결 방식

ivLyrics의 설정은 Spotify 화면(xpui)의 localStorage에 저장되고, Spotify는 그 파일을 `~/Library/Caches/com.spotify.client/Browser/` 아래에 둡니다. 이 폴더는 이름 그대로 캐시라서 Spotify의 "캐시 지우기", 정리 도구, 프로필 손상 복구 같은 계기로 통째로 비워질 수 있고, 그때 설정과 IndexedDB 백업까지 한 번에 사라집니다. 확장 프로그램이 이 폴더 바깥에 데이터를 쓸 수 있는 Spotify API는 없기 때문에(prefs API는 정해진 키만 허용합니다), 보호는 앱 바깥의 도구가 맡습니다.

`ivlyrics protect`는 다음 세 가지를 수행합니다.

1. `Local Storage`와 `IndexedDB` 폴더를 `~/Library/Application Support/Spotify/xpui-profile/`로 옮기고, 원래 자리에는 심볼릭 링크를 둡니다. 캐시가 지워지면 링크만 사라지고 데이터는 남습니다.
2. launchd 에이전트(`com.kuass.ivlyrics.guard`)가 매시간 링크가 끊겼는지 확인해 복구하고, `~/.config/spicetify/ivLyrics/storage-backups/`에 스냅샷을 14개까지 보관합니다.
3. 업데이트는 Spotify를 강제 종료(`pkill`)하지 않고 정상 종료한 뒤 진행해서, 저장소가 디스크에 온전히 기록된 상태에서 파일을 바꿉니다.

## 설치

```bash
curl -fsSL https://raw.githubusercontent.com/Kuass/ivLyrics/main/scripts/ivlyrics | bash -s install
```

설치가 끝나면 `~/.config/spicetify/ivLyrics/bin/ivlyrics`에 명령이 놓이고, `~/.local/bin`이 있으면 그곳에도 링크가 생깁니다. 설치 과정에서 Spotify가 한 번 재시작됩니다.

## 업데이트

```bash
ivlyrics update
```

앱 안의 업데이트 알림은 이 저장소의 `main` 브랜치를 기준으로 표시되며, 알림의 버튼은 이 문서로 연결됩니다. 실제 갱신은 위 명령으로 합니다.

## 명령어

| 명령 | 설명 |
| --- | --- |
| `ivlyrics install` | 앱을 설치하거나 갱신한 뒤 설정 보호까지 켭니다. |
| `ivlyrics update [--ref <branch\|tag>]` | 스냅샷을 남기고 Spotify를 정상 종료한 뒤 앱을 갱신합니다. |
| `ivlyrics protect` / `unprotect` | 설정 보호를 켜거나 끕니다. 끄면 폴더를 원래 자리로 되돌립니다. |
| `ivlyrics backup` | 지금 상태를 스냅샷으로 남깁니다. |
| `ivlyrics restore [snapshot]` | 최신(또는 지정한) 스냅샷을 되살립니다. 되살리기 전에 현재 상태도 스냅샷으로 남깁니다. |
| `ivlyrics status` | 설치 버전, 보호 상태, 스냅샷 수, 에이전트 상태를 보여 줍니다. |
| `ivlyrics uninstall` | 앱과 에이전트를 제거합니다. 설정 데이터와 스냅샷은 남겨 둡니다. |

로그는 `~/.config/spicetify/ivLyrics/ivlyrics.log`에 쌓입니다.

## 설정이 비어 보일 때

1. `ivlyrics status`로 보호 상태를 확인합니다. `broken`이면 Spotify를 종료한 뒤 `ivlyrics update`나 `ivlyrics guard`를 실행하면 링크가 복구됩니다.
2. 그래도 비어 있으면 `ivlyrics restore`로 최신 스냅샷을 되살립니다.

## 개발

저장소를 그대로 `~/.config/spicetify/CustomApps/ivLyrics`에 두지 않아도 됩니다. 수정 후에는 `ivlyrics update --ref <브랜치>`로 설치하거나, 로컬에서 `rsync`로 복사한 뒤 `spicetify apply`를 실행합니다. 단위 테스트는 `node --test tests/`로 실행합니다.

## 크레딧과 라이선스

원저작은 [ivLis STUDIO](https://github.com/ivLis-Studio)의 ivLyrics이며, 그 뿌리는 spicetify의 [Lyrics-Plus](https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus)입니다. 이 포크는 원본과 같은 LGPL-2.1 라이선스를 따릅니다. 이 프로젝트는 Spotify와 아무 관계가 없는 비공식 확장 프로그램이며, 사용에 따른 책임은 사용자에게 있습니다.
