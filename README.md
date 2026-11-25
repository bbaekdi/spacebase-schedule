# SPACEBASE 워크스페이스 (주간 스케줄 + 홈 + 캘린더)

> 2026-11-24 정리. 최신 앱 버전 **1.0.42**. 작업 규칙은 `CLAUDE.md`, 할 일과 계획은 `Doc/` 에 있다.

회사(SPACEBASE)가 매주 엑셀로 관리하던 **주간 스케줄표**를 대체하는 사내 프로그램으로 시작해,
지금은 홈·회사 캘린더·할 일까지 있는 **워크스페이스**(네이버웍스 같은 모양)가 되었다.
PC, 태블릿, 휴대폰에서 같은 주소로 쓰고, 여러 직원이 동시에 고치며 다른 사람이 선택한 칸이 이름표와 함께 보인다.

- 사이트: https://bbaekdi.github.io/spacebase-schedule/ (GitHub Pages + Firebase, 켜 둘 회사 PC 필요 없음)
  - 홈 `/` (`public/portal.html`), 주간 스케줄 `schedule.html` (원본 `public/index.html`), 캘린더 `calendar.html`
  - 팀원용 안내서 `guide.html`, 확장 설치 안내 `band-extension.html`, 개인정보 처리방침 `privacy.html`
- 로그인: 지금은 **회사 비밀번호 + 이름** (localStorage `sb_cred` 에 기억).
  - 새 방식(시험 중): **구글 로그인 + 관리자가 받아 준 사람만** (`public/auth.js`, 회원 관리 `members.html`). 전 직원 초대 뒤 `auth.js` 의 `SB_GOOGLE_AUTH = true` 로 켠다. 시험은 주소 뒤 `?login=google` (끄기 `?login=password`), 초대 링크 `?invite=코드` 로 열면 자동으로 켜짐.
  - 데스크톱 앱(file:)은 계속 회사 비밀번호 (나중에 안 쓸 예정).
- 지금 직원들은 주로 **설치한 데스크톱 앱**으로 주간 스케줄을 열고, 앞으로 **웹사이트로 옮길 예정** (`Doc/Todo`).
- 별도 프로그램: 회사 공유 폴더에 있던 데스크톱 앱 **"회사 밴드 캘린더"**(다른 사람이 만든 것, 코드는 이 저장소에 없음)를 아직 쓰고 있다. 그 기능(밴드 게시글 수집, 사진 글자 인식 등)을 웹으로 옮기는 것이 할 일에 있다.

## 1. 사용 기술
| 영역 | 기술 |
|---|---|
| 화면 | vanilla JS + HTML/CSS (빌드 도구 없음). `public/` |
| 데이터(실사용) | Firebase Realtime Database (프로젝트 `spacebase-schedule`, 지역 asia-southeast1). 웹 설정은 공개용이라 `public/firebase-config.js` 에 있음 |
| 데이터(예전 서버 방식) | Node 18+, Express + WebSocket(`ws`), `server.js`, `DATA_DIR/db.json` |
| 데스크톱 앱 | Electron 33 (`desktop/`), electron-builder 25 + NSIS 설치 파일 |
| 웹 배포 | GitHub Pages (`.github/workflows/pages.yml`) |
| 중계 서버 | Cloudflare Workers (`worker/`): 밴드 iCal 중계, 구글 OAuth, 네이버웍스 메일 |
| 확장 프로그램 | 크롬·엣지·웨일 확장 MV3 (`extension/`): 밴드 '일정 만들기' 자동 입력 |
| 기타 | `public/vendor/ical.min.js` + 공용 파서 `public/band-ics.js`, 공휴일 표 `public/holidays.js` (2025–2028) |

## 2. 구조
```
server.js            Express + WebSocket 서버 (예전 서버 방식). / → portal.html, /schedule → index.html
calendar.js          서버 방식 캘린더 (BAND_ICAL_URL 10분마다, 직접 추가 일정 DATA_DIR/calendar.json)
seed.js / seed-data.json  빈 양식 (구분 3개, 카테고리 8개)
public/
  index.html, app.js, app.css   주간 스케줄 화면. app.js 가 핵심
  ops.js             스케줄 변경(op) 로직 (서버/브라우저 공용)
  default-data.js, holidays.js
  portal.html        홈
  calendar.html      회사 캘린더
  auth.js            구글 로그인 + 회원 확인 (승인 대기, 초대 링크, 관리자 비밀번호, 카톡 안 브라우저 안내)
  band.html, band.js, band.css  Band 회사 게시판 (구글 로그인 회원만): 게시판 4개, 글·댓글·찾기. Firebase board/posts, board/comments
  members.html       회원 관리 (관리자: 승인/거절, 초대 링크, 이름 연결, 관리자 지정, 내보내기)
  ws.css, ws-common.js  워크스페이스 공통 (상단 탭, 휴대폰 아래 메뉴, 로그인, 일정 데이터, 구글 연동, TO DO 위젯, 확장 안내 띠)
  band-config.js     SB_BAND_API(밴드 중계 주소), SB_GOOGLE_LOGIN
  mail-config.js     SB_MAIL_API (비어 있음 → 메일 카드 숨김)
  band-ics.js, band-extension.html, guide.html, privacy.html, login.html
desktop/             Electron (main.js, preload.js, preview.html=인쇄 미리보기, setup.html)
worker/              band-relay.js, google.js, naverworks-mail.js (+ band.toml, wrangler.toml)
extension/           band-fill.js, bandform.js, site-bridge.js
tools/sync-band.js   예비 밴드 동기화 (band-calendar.yml)
firebase/            Firebase 규칙(database.rules.json) + 규칙 시험(rules.test.mjs). firebase-rules.yml 이 실제 Firebase 에 올림
tools/test-rules.sh  규칙 시험 (연습용 Firebase), tools/fb-setup.mjs 규칙 올리기·회원 설정 (Actions 전용)
tools/test/          화면 시험 (연습용 Firebase + 브라우저): emu-seed.mjs, e2e-auth.cjs(로그인), e2e-band.cjs(Band)
tools/check.sh       배포 전 검토 (JS 문법, 비밀 값 의심 문자열, 버전↔릴리즈 노트)
RELEASE-NOTES.md     바뀐 내용 기록 (최신이 위)
build/               installer.nsi, release.sh, seticon.mjs
.github/workflows/   pages.yml, release.yml, band-worker.yml, band-calendar.yml, mail-worker.yml
Doc/                 기획서·계획 일정표 (Todo / Doing / Done, 기획서-양식.md)
```

### 클라우드 모드 (실사용, Firebase)
- 데이터 경로: `spaces/<sha256('spacebase:'+비밀번호)>/data`. 캘린더 `spaces/<해시>/calendar/items`, 밴드 일정 `spaces/<해시>/band`.
- Firebase 규칙: `firebase/database.rules.json` (저장소에서 관리, `firebase-rules.yml` 이 시험 통과 후 자동 반영). `spaces/$k` 는 데스크톱 앱 때문에 아직 열려 있음(전환 뒤 잠금).
- 회원(구글 로그인): `ws/members/<uid>` {name, email, joinedAt, via}, `ws/admins/<uid>`, `ws/pending/<uid>`(가입 신청), `ws/invites/<코드>` {name, expires, usedBy}, `ws/config/space`(회원에게만 알려 주는 스케줄 자리), `ws/adminKeys`(관리자 비밀번호 해시, 아무도 못 읽음).
- 메모는 키별로 저장(`memo/<k>`), 실제로 타이핑했을 때만(`_dirty`), 값이 그대로면 저장 안 함(`_orig`).
- 데스크톱 앱은 `firebase-config.js` 에 apiKey 가 있으면 `public/index.html` 을 로컬(file:)로 띄우고 바로 Firebase 에 저장한다. 예전 서버 PC 데이터(db.json)는 첫 실행 때 옮겨 온다.
- 웹사이트로 열면 `index.html` 이 홈·캘린더와 같은 상단 메뉴(`.wsnav`)를 붙인다. 데스크톱 앱(file:)에서는 안 붙임.

### 주간 스케줄 화면
- 날짜 21칸(지난주·이번주·다음주) 자동, 이번 주는 빨간 점선 박스. ◀ ▶ 로 주 이동. 일요일·공휴일 빨간색.
- 구분(PROJECT / 수주 전 / AS·부분) 추가·이름변경·삭제. 행 추가/삭제/이동(＋ ▲ ▼ ✕, 오른쪽 클릭 메뉴).
- 칸 클릭 → 일정 입력 + 카테고리 색, 드래그로 여러 칸.
- 엑셀식 키보드(방향키, Enter, Delete, Ctrl+C/V 색 포함, Ctrl+Z/Y).
- 공사금액 쉼표 서식("2억-3억" 같은 글자도 가능), 면적 "230.0 PY".
- 공사기간: 달력(시작일·종료일)으로 선택, 표기 "12.05-01.22". 시작일만 → "12.05-". 구분 이름에 "AS", "A/S", "부분"이 있으면 달력 없이 글자 입력.
- 회색 구분(`groups[].shade`)은 **공사기간 안의 날짜만 회색**. 못 읽는 값("미정")은 전부 회색.
- 설계/시공 담당 약어 선택창, 직원표(db.mteams/members/ranks), 범례·담당자표 화면에서 수정.
- MEMO(주간회의/공지사항/공무업무) + 기타 메모.
- **A4 가로 한 장 인쇄** + 앱 안 인쇄 미리보기(printToPDF), 엑셀식 머리글/바닥글, "백업" 버튼(전체 데이터 다운로드).
- 화면 표: 칸은 0.5pt 키운 비율(날짜칸 53px, `--row-h: 27.5px`), 글씨는 원래 크기(표 13px, 날짜칸 12px). 창 너비에 맞춰 자동 축소(`fitScreen`). 인쇄용 크기는 `body.printing` 규칙.
- 참고 함수: 공사기간 `periodRange`, `isPeriodDates`, `fmtPeriod`, 달력 창 `openPerPop`/`savePeriod`, 인쇄 `fitPrint`/`unfitPrint`.

### 홈 (`public/portal.html`)
- 프로필 카드(로고, 직원표의 직급·팀), 앱 카드, 오늘 일정, 다가오는 일정(7일), TO DO LIST, Quick Links, 메일 카드(`SB_MAIL_API` 가 있을 때만).
- Quick Links: NAVER WORKS(`https://auth.worksmobile.com/`), NAVER BAND(Secret BAND_URL), NAVER BAND A/S(BAND2_URL), NAVER BAND PROJECT(BAND3_URL), SPACEBASE Website, Blog, Instagram. 아이콘은 선 그림 SVG.
- BAND2_URL/BAND3_URL 은 `pages.yml` 이 빌드할 때 `_site/band-config.js` 에 `window.SB_BAND2_URL` 등으로 덧붙인다.

### 캘린더 (`public/calendar.html`)
- 월/주/목록 보기, "+N개" 펼치기, 밴드/구글 보기 켜고 끄기(`ws_cal_show`), TO DO LIST, "내 구글 캘린더" 창.
- 밴드 일정: 화면을 열 때마다 브라우저가 `worker/band-relay.js` 의 `/ics` 에서 최신 iCal 을 받아 `spaces/<해시>/band` 에도 저장. 예비로 `band-calendar.yml` 이 `tools/sync-band.js` 실행(약 1시간 간격).
- 개인 구글 캘린더 + 할 일(Tasks): `worker/google.js` (OAuth, 범위 openid email profile calendar.readonly tasks). refresh token 은 암호화해 **브라우저 localStorage 에만** (`sb_google:<이름>`). 캘린더 선택 `sb_gsel:<이름>`, 할 일 목록 `sb_tlist:<이름>`. 본인 화면에만 보임(초록색). `SB_GOOGLE_LOGIN = true` 로 켬. Google Cloud 프로젝트는 게시(production) 상태.
  - TO DO LIST: 오늘/내일/‹ › 로 날짜 이동, 보이는 날짜로 추가. 체크=완료, ✕=삭제(구글에서도 삭제).
  - 예전 방식(iCal 비공개 주소 `sb_gcal:<이름>`, 중계 POST /gcal)도 코드에 남아 있다.
- 밴드 자동 입력 확장: 사이트가 `band.us/band/<id>/event#sbe=<base64 JSON>` 을 열면 `band-fill.js` 가 '일정 만들기' 창을 채운다(**완료는 사람이 누름**). 설치 여부는 `data-sbe-ext`(`site-bridge.js`). zip 은 `pages.yml` 이 만든다. 미설치면 안내 띠, "나중에"=7일 숨김(`sbe_ext_later`). **실제 밴드에서 잘 동작 확인됨.**
- 네이버웍스 메일: `worker/naverworks-mail.js` 배포 완료, 하지만 `SB_MAIL_API` 비어 있어 숨김 (관리자 앱 등록 필요 → 보류).

## 3. Cloudflare Workers
- sbe-band: https://sbe-band.smbaek-1c4.workers.dev (`band-relay.js` + `google.js`, `band.toml`, `band-worker.yml`)
  - `/ics` (헤더 `X-SB-Key` = sha256('spacebase:' + SB_CODE)), POST `/gcal`, `/google/login|callback|token|revoke`. 캐시 없이(`no-store`).
- sbe-mail: https://sbe-mail.smbaek-1c4.workers.dev (`naverworks-mail.js`, `wrangler.toml`, `mail-worker.yml`), 콜백 `/callback`.

## 4. GitHub Secrets (이름만)
BAND_ICAL_URL, SB_CODE, BAND_URL, BAND2_URL, BAND3_URL, CF_API_TOKEN, CF_ACCOUNT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FIREBASE_SERVICE_ACCOUNT, ADMIN_CODE. (아직 없음: NW_CLIENT_ID, NW_CLIENT_SECRET)

## 5. 배포
- 웹사이트: main 에 푸시 → `pages.yml` 이 `public` → `_site` (index↔portal 바꿈, 확장 zip, 파일 주소 뒤 `?v=<커밋>`) 후 Pages 배포. build/deploy 두 작업으로 나눠 둘 것.
- Firebase 규칙: `firebase/**` 가 바뀌면 `firebase-rules.yml` 이 연습용 Firebase 에서 시험 → 통과하면 실제 Firebase 에 반영 (바꾸기 전 규칙은 Actions 기록에 남김).
- 중계: `worker/**` 가 바뀌면 `band-worker.yml` / `mail-worker.yml` 이 배포.
- 데스크톱 앱: `package.json` 의 `version` 을 올려 main 에 푸시 → `release.yml`(Windows 러너)이 Release `vX.Y.Z` 생성(같은 버전 있으면 건너뜀) → 앱이 "지금 업데이트 / 나중에"를 묻는다.
  - 리눅스 로컬 빌드: `build/release.sh` (`electron-builder --win dir` + `build/seticon.mjs` + 리눅스 makensis, `-INPUTCHARSET UTF8`). wine 불필요.
  - 직접 줄 때는 zip (마지막으로 직접 준 것: 1.0.31, 이후는 자동 업데이트).

## 6. 지금까지 결정한 것
- 호스팅: 켜 둬야 하는 PC는 싫음 → NAS 기각 → **무료 Firebase + GitHub Pages** (2026-11-19). 2026-11-20 여러 PC 동시 사용 확인. 서버 방식(`server.js`)과 데스크톱 앱도 계속 동작하게 유지.
- 로그인: 밴드 로그인은 앱 심사 문제로 **보류**. 회사 비밀번호 + 이름.
- 작은 수정은 PR 없이 main 에 바로 푸시.
- 메뉴·제목은 영어(Home / Weekly Schedule / Calendar, Quick Links), 설명 문장은 한국어.
- 브랜드: 노란색 #f1bf52, 노란 바탕 위 글씨 #1d1d1b. 로고 `public/logo.svg`, `public/logo-mark.svg`.
- 밴드는 바깥에서 일정을 써넣는 API 가 없음 → 확장 프로그램이 '일정 만들기' 창을 채우고 사람이 완료. 휴대폰은 밴드 앱에서 직접. 밴드에 들어온 뒤 같은 날·같은 제목의 사이트 일정은 숨김.
- 밴드 일정 반영 지연은 대부분 밴드 쪽 iCal 갱신 시간 (중계는 캐시 없음).
- 밴드 일정은 모두에게 공유, 구글 캘린더·할 일은 **각자 본인에게만** (브라우저에만 저장). 기기마다 한 번씩 연결. iCal 붙여넣기 대신 구글 계정 연결(OAuth).
- 인쇄는 **A4 가로** (2026-11-24 사용자 확인). 1.0.40~1.0.42 인쇄 결과 실제 프린터에서 문제없음 확인. 글씨 원래 크기(1.0.41/1.0.42) 유지.
- 2026-11-24 채팅 개발 → **Claude Code** 로 옮김. 문서 4개를 이 README + CLAUDE.md 로 합치고 `Doc/` 로 할 일 관리 시작.

## 7. 버전 이력 (주간 스케줄 앱)
- 1.0.24 PROJECT 구분 날짜칸 기본 회색(구분 오른쪽 클릭으로 켜고 끔).
- 1.0.26~1.0.30 공지/메모가 사라지던 문제 수정(키별 저장, `_dirty`, `_orig`).
- 1.0.27 넘친 글자 클릭 → 원래 칸 선택. 1.0.29 글자는 왼쪽으로 안 넘치고, 오른쪽이 막히면 글씨를 줄임.
- 1.0.32 인쇄 검은 선 = 안쪽 회색 선의 2배 굵기.
- 1.0.33 회색 구분은 공사기간 안의 날짜만 회색.
- 1.0.34 공사기간 달력 선택. 1.0.35 AS/부분 구분은 글자 입력.
- 1.0.36/1.0.37 칸 확대(화면/인쇄). 1.0.38 창 너비 자동 맞춤.
- 1.0.39/1.0.40 인쇄 시 회색 선이 사라지던 문제 수정.
- 1.0.41/1.0.42 칸 크기는 그대로, 글씨만 원래 크기로 (화면/인쇄).

## 8. 예전 방식 (코드에는 남아 있음)
- **서버 모드**: 회사 PC 1대 "서버 모드", 나머지 "접속 모드"(같은 네트워크 UDP 41234 자동 찾기). 데이터 `문서\SPACEBASE 스케줄 데이터`, 매일 백업. 지금 회사는 클라우드 모드를 쓴다.
- 서버만 직접 실행(개발): `npm install` → `cp .env.example .env` → `npm start` (http://localhost:3000). `BAND_CLIENT_ID` 가 비면 이름만 입력하는 테스트 로그인. 인터넷에 공개하면 `ACCESS_CODE` 를 꼭 켤 것. `Dockerfile` 있음, 데이터용 영구 디스크 `/data`(`DATA_DIR`) 필요.
- 밴드 로그인(보류): developers.band.us 에 서비스 등록, Redirect URI `https://<서버주소>/auth/band/callback`, `.env` 에 `BAND_CLIENT_ID`/`BAND_CLIENT_SECRET`, (선택) `BAND_KEY`.
