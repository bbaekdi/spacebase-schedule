# SPACEBASE 주간 스케줄

회사 주간 스케줄 엑셀을 대체하는 사내용 프로그램. 사용자(회사)는 한국어로 소통한다.

- `server.js`: Express + WebSocket 서버. 데이터는 `DATA_DIR/db.json` (회사 PC: 문서\SPACEBASE 스케줄 데이터).
- `public/`: 스케줄 화면 (vanilla JS). `public/ops.js` 는 서버/브라우저 공용 변경 로직.
- 워크스페이스(웹): `/` 홈(`public/portal.html`), `/schedule` 주간 스케줄(`public/index.html`), `/calendar` 회사 캘린더(`public/calendar.html`).
  캘린더 서버 로직은 `calendar.js` (밴드 iCal 구독 주소 `BAND_ICAL_URL` 을 10분마다 읽음, 직접 추가한 일정은 `DATA_DIR/calendar.json`). 공통 화면은 `public/ws.css`, `public/ws-common.js`.
  서버 없이(GitHub Pages, `.github/workflows/pages.yml`) 열면 `ws-common.js` 가 Firebase 방식으로 바뀐다: 로그인은 주간 스케줄과 같은 회사 비밀번호+이름(localStorage `sb_cred`), 일정은 `spaces/<해시>/calendar/items`, 밴드 일정은 `band-calendar.yml` 이 5분마다 `tools/sync-band.js` 로 `spaces/<해시>/band` 에 넣는다 (Secrets: BAND_ICAL_URL, SB_CODE).
  밴드는 바깥에서 캘린더에 일정을 써넣는 API 가 없다. 사이트에서 추가한 일정은 "밴드에도 등록" 창(내용 복사 + 밴드 열기, Secret BAND_URL)으로 사람이 붙여넣고, 밴드에 들어온 뒤 같은 날·같은 제목의 사이트 일정은 숨긴다.
  네이버웍스 메일: `worker/naverworks-mail.js` (Cloudflare Workers 중계, DB 없음, refresh token 은 암호화해 브라우저 localStorage `nw_mail_token`), `mail-worker.yml` 로 배포 (Secrets CF_API_TOKEN, CF_ACCOUNT_ID, NW_CLIENT_ID, NW_CLIENT_SECRET), 사이트는 `public/mail-config.js` 의 SB_MAIL_API 주소를 씀.
  원본은 별도 데스크톱 앱 "회사 밴드 캘린더"(Electron). 밴드 게시글 수집/사진 글자 인식/구글 캘린더 연동은 아직 웹으로 옮기지 않았다.
- `desktop/`: Electron 앱. 회사 PC 1대는 "서버 모드", 나머지는 "접속 모드"(같은 네트워크에서 UDP 41234 로 자동 찾기).
- 로그인: 기본은 이름만 1회 입력(로그인 없음). 고급 설정에서 회사 비밀번호(ACCESS_CODE) 또는 밴드 OAuth(BAND_CLIENT_ID/SECRET) 를 켤 수 있다.

## 배포 (자동 업데이트)
1. `package.json` 의 `version` 을 올린다.
2. main 에 커밋/푸시 → GitHub Actions(`.github/workflows/release.yml`)가 Windows 에서 설치 파일을 만들어 Release `vX.Y.Z` 를 올린다
   (같은 버전 Release 가 이미 있으면 건너뜀). 로컬 빌드만 필요하면 `build/release.sh`.
3. 회사 PC 앱이 1시간마다 최신 Release 를 확인해 조용히 설치(/S)하고, 직원 PC는 회사 PC의 `/update/setup.exe` 를 받아 따라 업데이트된다.

주의: 이 저장소는 공개(public)다. 실제 스케줄 데이터, 직원 이름, 공지 내용 등 회사 정보는 절대 커밋하지 않는다 (`seed-data.json` 은 빈 양식만).
리눅스에서 빌드할 때 wine 은 필요 없다 (electron-builder `--win dir` + resedit 아이콘 + makensis).
