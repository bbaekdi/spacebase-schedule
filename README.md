# SPACEBASE 워크스페이스 (주간 스케줄 + 캘린더)

회사 주간 스케줄 엑셀과 데스크톱 앱 "회사 밴드 캘린더"를 대신하는 사내용 웹사이트입니다 (네이버웍스 같은 모양).
PC, 태블릿, 휴대폰에서 같은 주소로 씁니다.

- 사이트: https://bbaekdi.github.io/spacebase-schedule/ (GitHub Pages + Firebase, 회사 PC 없이 동작)
  - 홈 `/` (`public/portal.html`), 주간 스케줄 `schedule.html` (원본 `public/index.html`), 캘린더 `calendar.html`
  - 팀원용 안내서 `guide.html` (로그인 → 밴드 확장 설치 → 구글 연결), 확장 설치 안내 `band-extension.html`, 개인정보 처리방침 `privacy.html`
- 로그인(웹): 주간 스케줄과 같은 "회사 비밀번호 + 이름". 비밀번호를 아는 사람만 볼 수 있습니다.

## 사용 기술
- 화면: vanilla JS + HTML/CSS (빌드 도구 없음). 공통 화면 `public/ws.css`, `public/ws-common.js`.
- 데이터(웹): Firebase Realtime Database (`public/firebase-config.js`, `public/vendor/firebase-*-compat.js`).
- 서버 방식(회사 PC): Node 18+, Express + WebSocket(`ws`), `server.js`. 데이터 `DATA_DIR/db.json`.
- 데스크톱 앱: Electron + electron-builder (`desktop/`). 회사 PC 1대는 "서버 모드", 나머지는 "접속 모드"(같은 네트워크에서 UDP 41234 로 자동 찾기).
- 중계 서버: Cloudflare Workers (`worker/`), GitHub Actions 로 배포.
- 밴드 일정 읽기: iCal 구독 + `public/vendor/ical.min.js`, 공용 파서 `public/band-ics.js` (서버 `calendar.js` 와 브라우저가 같이 씀).
- 밴드 일정 쓰기: 크롬 확장 프로그램(MV3, `extension/`).
- 배포: GitHub Actions (`.github/workflows/`).

## 구조
- `server.js`: Express + WebSocket 서버. `/` → portal.html, `/schedule` → index.html. 데이터 `DATA_DIR/db.json` (회사 PC: 문서\SPACEBASE 스케줄 데이터).
- `public/ops.js`: 스케줄 변경 로직 (서버/브라우저 공용). `public/app.js`, `public/app.css`: 주간 스케줄 표.
  - 웹사이트로 열면 `index.html` 이 홈·캘린더와 같은 상단 메뉴(`.wsnav`)를 붙인다. 데스크톱 앱(file:)에서는 안 붙임.
  - 화면 표: 칸 크기는 0.5pt 키운 비율(날짜칸 53px, `--row-h: 27.5px`), 글씨는 원래 크기(표 13px, 날짜칸 12px). 창 너비에 맞춰 자동 축소(`fitScreen`). 인쇄용 크기는 `body.printing` 규칙에 따로 있다.
- `calendar.js`: 서버 방식 캘린더 (밴드 iCal `BAND_ICAL_URL` 을 10분마다 읽음, 직접 추가한 일정 `DATA_DIR/calendar.json`).
- `public/ws-common.js`: 상단 탭(Home / Weekly Schedule / Calendar)과 휴대폰 아래 메뉴, 로그인, 일정 데이터, 일정 상세 팝업, 구글 연동, TO DO LIST 위젯(`WS.todoWidget`), 확장 설치 안내 띠.
  서버가 없으면(GitHub Pages) Firebase 방식으로 동작한다:
  - 로그인: 주간 스케줄과 같은 회사 비밀번호 + 이름 (localStorage `sb_cred`). 데이터는 `spaces/<비밀번호 해시>/...`.
  - 직접 추가한 일정: `spaces/<해시>/calendar/items`.
  - 밴드 일정: 화면을 열 때마다 브라우저가 `worker/band-relay.js` 의 `/ics` 에서 최신 iCal 을 받아 바꾸고 `spaces/<해시>/band` 에도 저장. 예비로 `band-calendar.yml` 이 `tools/sync-band.js` 를 돌림 (GitHub 예약 실행은 실제로 약 1시간 간격).
- `public/portal.html` (홈): 프로필 카드(로고, 주간 스케줄 구성원 표에서 직급·팀), 앱 카드, 오늘 일정, 다가오는 일정(7일), TO DO LIST, Quick Links, (메일 카드: `SB_MAIL_API` 가 있을 때만 보임).
  - Quick Links: NAVER WORKS(`https://auth.worksmobile.com/` — works.worksmobile.com 은 없는 주소), NAVER BAND(Secret BAND_URL 에서 밴드 번호를 뽑아 게시글 화면으로), NAVER BAND A/S(Secret BAND2_URL), NAVER BAND PROJECT(Secret BAND3_URL), SPACEBASE Website, Blog, Instagram. 아이콘은 선 그림 SVG.
  - BAND2_URL/BAND3_URL 은 `pages.yml` 이 빌드할 때 `_site/band-config.js` 에 `window.SB_BAND2_URL` 등으로 덧붙인다 (형식 검사 후). Secret 을 바꾸면 `gh workflow run pages.yml` 로 다시 배포.
- `public/calendar.html`: 월/주/목록 보기, "+N개" 누르면 그 날 펼치기, 밴드 일정 보기 / 구글 캘린더 보기 켜고 끄기(`ws_cal_show`), TO DO LIST(넓은 화면에서 3번째 칸), "내 구글 캘린더" 창.
- 개인 구글 캘린더 + 할 일(Tasks): `worker/google.js` (OAuth, 범위 openid email profile calendar.readonly tasks). refresh token 은 GOOGLE_CLIENT_SECRET 으로 만든 키로 AES-GCM 암호화해 **브라우저 localStorage 에만** (`sb_google:<이름>`). 일정·할 일은 브라우저가 Google API 를 직접 부른다. 캘린더 선택 `sb_gsel:<이름>`, 할 일 목록 선택 `sb_tlist:<이름>`. 본인 화면에만 보임(초록색). `public/band-config.js` 의 `SB_GOOGLE_LOGIN = true` 로 켬. Google Cloud 프로젝트 "SPACEBASE" 는 게시(production) 상태, 개인정보 처리방침은 `privacy.html`.
  - TO DO LIST: 오늘/내일/‹ › 로 날짜를 옮기고, 보이는 날짜로 할 일을 추가. 체크=완료, ✕=삭제(구글에서도 삭제).
  - 예전 방식(iCal 비공개 주소, `sb_gcal:<이름>`, 중계 POST /gcal)도 코드에 남아 있다.
- 밴드 자동 입력: `extension/` (크롬·엣지·웨일, MV3). 사이트가 `band.us/band/<id>/event#sbe=<base64 JSON>` 을 열면 `band-fill.js` 가 원래 데스크톱 앱의 `bandform.js` 로 '일정 만들기' 창을 채운다 (**완료는 사람이 누름**). 사이트는 `data-sbe-ext` 표시(`site-bridge.js`)로 설치 여부를 안다. zip 은 `pages.yml` 이 만든다. PC 크롬 계열에서 미설치면 아래에 설치 안내 띠가 뜨고 "나중에"=7일 숨김(`sbe_ext_later`).
- 네이버웍스 메일: `worker/naverworks-mail.js` (중계, DB 없음, refresh token 은 암호화해 localStorage `nw_mail_token`), `mail-worker.yml` 로 배포 완료. 사이트는 `public/mail-config.js` 의 `SB_MAIL_API` 를 씀 (지금은 비어 있어 메일 카드 숨김).
- `desktop/`: Electron 앱 (main.js, preload.js, setup.html).

## Cloudflare Workers
- sbe-band: https://sbe-band.smbaek-1c4.workers.dev (`worker/band-relay.js` + `worker/google.js`, `worker/band.toml`, `band-worker.yml`)
  - `/ics` (헤더 `X-SB-Key` = sha256('spacebase:' + SB_CODE)), POST `/gcal`, `/google/login|callback|token|revoke`. 캐시 없이(`no-store`) 읽음.
- sbe-mail: https://sbe-mail.smbaek-1c4.workers.dev (`worker/naverworks-mail.js`, `worker/wrangler.toml`, `mail-worker.yml`), 콜백 `/callback`.

## GitHub Secrets (이름만)
BAND_ICAL_URL, SB_CODE, BAND_URL, BAND2_URL, BAND3_URL, CF_API_TOKEN, CF_ACCOUNT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. (아직 없음: NW_CLIENT_ID, NW_CLIENT_SECRET)

## 배포 (웹사이트·중계·데스크톱 앱)
- 웹사이트: main 에 푸시하면 `pages.yml` 이 `public` → `_site` (index↔portal 바꿈, 확장 zip, 파일 주소 뒤 `?v=<커밋>` 붙임) 후 GitHub Pages 로 배포. 사용자는 Ctrl+F5 로 새로고침.
  `pages.yml` 은 build/deploy 두 작업으로 나눠 둘 것 (한 작업으로 하면 'No artifacts named github-pages' 실패).
- 중계: `worker/**` 가 바뀌면 `band-worker.yml` / `mail-worker.yml` 이 Cloudflare 에 배포.
- 데스크톱 앱 (자동 업데이트):
  1. `package.json` 의 `version` 을 올린다.
  2. main 에 푸시 → `release.yml` 이 Windows 설치 파일을 만들어 Release `vX.Y.Z` 를 올린다 (같은 버전이 있으면 건너뜀). 로컬 빌드만 필요하면 `build/release.sh`.
  3. 회사 PC 앱이 1시간마다 최신 Release 를 확인해 조용히 설치(/S)하고, 직원 PC는 회사 PC의 `/update/setup.exe` 를 받아 따라 업데이트된다.
  리눅스에서 빌드할 때 wine 은 필요 없다 (electron-builder `--win dir` + resedit 아이콘 + makensis).

## 지금까지 결정한 것
- 호스팅: 회사 PC 서버 대신 **GitHub Pages + Firebase** (서버 없이). 서버 방식(`server.js`)과 데스크톱 앱도 계속 동작하게 유지.
- 작은 화면 수정은 PR 없이 **main 에 바로 푸시** (사용자가 PR 누르는 걸 원치 않음). 다른 작업이 PR 로 합쳐지기도 하니 푸시 전에 `git pull --rebase`.
- 메뉴·제목은 영어: Home / Weekly Schedule / Calendar, Quick Links. 설명 문장은 한국어.
- 브랜드: 노란색 #f1bf52, 노란 바탕 위 글씨 #1d1d1b. 로고 `public/logo.svg`, 프로필 원 안 로고 `public/logo-mark.svg`.
- 밴드는 바깥에서 캘린더에 일정을 써넣는 API 가 없다 → 사이트에서 쓴 일정은 **확장 프로그램이 밴드 '일정 만들기' 창을 채우고 사람이 완료**를 누르는 방식으로 결정. 휴대폰은 밴드 앱에서 직접 추가. 밴드에 들어온 뒤 같은 날·같은 제목의 사이트 일정은 숨김.
- 밴드 일정 반영 지연은 대부분 밴드 쪽 iCal 갱신 시간이다 (중계는 캐시 없이 읽음).
- 밴드 일정은 모두에게 공유, 구글 캘린더·할 일은 **각자 본인에게만** (브라우저에만 저장, Firebase·서버에 안 올림). 기기마다 한 번씩 연결.
- 구글 연동은 iCal 주소 붙여넣기 대신 "구글 계정으로 연결"(OAuth)로 바꿈.

## 남은 할 일
- 네이버웍스 메일: 회사 네이버웍스 **관리자**가 Developer Console 에서 앱 등록 (Redirect URL `https://sbe-mail.smbaek-1c4.workers.dev/callback`, 범위 `mail.read`) → Secrets NW_CLIENT_ID / NW_CLIENT_SECRET → `public/mail-config.js` 에 `SB_MAIL_API` 넣기 (그러면 홈 메일 카드가 자동으로 보임). 사용자는 관리자가 아니라 보류 중.
- 밴드 자동 입력 확장 프로그램을 실제 밴드에서 사용자가 시험해 보기. 나중에 크롬 웹 스토어 등록을 검토 (지금은 zip + 개발자 모드 설치).
- TO DO LIST 내일/다른 날짜 추가가 실제 구글 할 일에 잘 들어가는지 사용자 확인.
- 화면 표 글씨를 원래 크기로 돌린 변경(1.0.41)을 사용자가 유지할지 확인 대기.
- 원래 데스크톱 앱 "회사 밴드 캘린더"에서 아직 웹으로 안 옮긴 것: 밴드 게시글 수집, 사진 글자 인식(OCR), 위젯/배경화면 기능.

## 주간 스케줄 주요 기능
- **날짜 자동**: 지난주·이번주·다음주 3주가 달력에서 자동으로 채워지고, 이번 주는 빨간 점선 박스로 표시됩니다. ◀ ▶ 로 주를 넘길 수 있습니다.
- **카테고리 색**: 칸을 클릭하면 일정 입력창과 카테고리 목록이 뜹니다. 고르면 그 색으로 칠해집니다. 여러 칸을 드래그해서 한 번에 칠할 수도 있습니다(공사기간 막대 등).
- **행 추가/삭제/이동**: 행에 마우스를 올리면 왼쪽에 ＋ ▲ ▼ ✕ 버튼이 나옵니다. 오른쪽 클릭 메뉴도 있습니다. 구분(PROJECT / 수주 전 / AS/부분)도 추가·이름변경·삭제할 수 있습니다.
- **공사금액 숫자 서식**: 숫자를 입력하면 자동으로 1,234,567 처럼 쉼표가 붙습니다. "2억-3억" 같은 글자도 그대로 적을 수 있습니다. 면적은 "230.0 PY" 형식으로 표시됩니다.
- **메모**: 기존 MEMO(주간회의/공지사항/공무업무)와 별도의 "기타 메모" 칸.
- **범례·담당자표**: 카테고리 이름과 색, 담당자 목록도 화면에서 바로 수정합니다.
- 엑셀처럼 방향키 이동, Enter 편집, Delete 지우기, Ctrl+C / Ctrl+V 복사·붙여넣기(색 포함) 가능.
- 다른 사람이 선택한 칸이 이름표와 함께 보입니다.
- 인쇄 버튼으로 A3 가로 인쇄, "백업" 버튼으로 전체 데이터 다운로드.

## 데스크톱 앱 (윈도우 설치 프로그램)
`SPACEBASE-Schedule-Setup-1.0.0.exe` 하나로 모든 PC에 설치합니다.

1. **회사 PC(서버, 1대)**: 설치 → 실행 → "이 PC를 서버로 사용" 선택 → 밴드 Client ID/Secret 입력 → 저장.
   - 처음 실행 때 Windows 방화벽 창이 뜨면 "개인 네트워크" 허용.
   - 창을 닫아도 트레이(시계 옆)에서 계속 실행되고, Windows가 켜질 때 자동으로 시작됩니다.
   - 데이터: `문서\SPACEBASE 스케줄 데이터` (매일 자동 백업). 이 PC는 절전 모드로 들어가지 않게 해 주세요.
2. **다른 직원 PC**: 설치 → 실행 → "회사 서버에 접속" → "자동으로 찾기" → 저장 → "네이버 밴드로 로그인".
   - 설치 없이 크롬 주소창에 `서버주소:3000` 을 넣어도 똑같이 쓸 수 있습니다.
3. 메뉴 "파일 → 접속 설정…" 에서 언제든 설정을 바꿀 수 있습니다.

새 버전 배포: `package.json` 버전을 올려 main 에 푸시 → GitHub Actions 가 설치 파일을 만들어 Release 에 올리고, 회사 PC가 1시간 안에 자동 설치, 직원 PC는 회사 PC를 따라 업데이트됩니다.

## 서버로 직접 돌리는 방법
Render, Railway, Fly.io 같은 곳이나 회사 PC(Cloudflare Tunnel)에서 `server.js` 를 돌릴 수도 있습니다. `Dockerfile` 이 있고, 데이터용 영구 디스크를 `/data` 에 붙여야 합니다.
이때는 서버 설정(.env)에 `BAND_ICAL_URL` 을 넣고, 인터넷에 공개하면 **회사 비밀번호(`ACCESS_CODE`)나 밴드 로그인을 꼭 켜세요.**


## 서버만 직접 실행 (개발/리눅스 서버)
```bash
npm install
cp .env.example .env   # 값 채우기
npm start              # http://localhost:3000
```
`BAND_CLIENT_ID` 가 비어 있으면 이름만 입력하는 **테스트 로그인**으로 동작합니다.

## 네이버 밴드 로그인 설정
1. https://developers.band.us 에 로그인 → 내 서비스 → 서비스 등록
2. Redirect URI 에 `https://<서버주소>/auth/band/callback` 입력
3. 발급된 Client ID / Client Secret 을 `.env` 의 `BAND_CLIENT_ID`, `BAND_CLIENT_SECRET` 에 입력
4. (선택) 회사 밴드 멤버만 허용하려면 `BAND_KEY` 에 회사 밴드의 band_key 를 입력

## 데이터
- `data/db.json` 에 저장되고, 하루에 한 번 `data/backups/` 에 백업이 남습니다.
- 처음 실행하면 빈 양식(구분 3개, 카테고리 8개)으로 시작합니다.

## 서버 배포 (직접 돌릴 때)
Node.js 18 이상이 되는 서버면 어디든 됩니다. `Dockerfile` 이 포함되어 있습니다.
데이터가 파일로 저장되므로 **영구 디스크(볼륨)** 가 있는 곳에 올려야 합니다 (`DATA_DIR`).
