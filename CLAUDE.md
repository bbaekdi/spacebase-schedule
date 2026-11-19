# SPACEBASE 주간 스케줄

회사 주간 스케줄 엑셀을 대체하는 사내용 프로그램. 사용자(회사)는 한국어로 소통한다.

- `server.js`: Express + WebSocket 서버. 데이터는 `DATA_DIR/db.json` (회사 PC: 문서\SPACEBASE 스케줄 데이터).
- `public/`: 스케줄 화면 (vanilla JS). `public/ops.js` 는 서버/브라우저 공용 변경 로직.
- `desktop/`: Electron 앱. 회사 PC 1대는 "서버 모드", 나머지는 "접속 모드"(같은 네트워크에서 UDP 41234 로 자동 찾기).
- 로그인: 기본은 이름만 1회 입력(로그인 없음). 고급 설정에서 회사 비밀번호(ACCESS_CODE) 또는 밴드 OAuth(BAND_CLIENT_ID/SECRET) 를 켤 수 있다.

## 배포 (자동 업데이트)
1. `package.json` 의 `version` 을 올린다.
2. `build/release.sh` 실행 → Windows 설치 파일을 만들고 GitHub Release `vX.Y.Z` 에 올린다.
3. 회사 PC 앱이 1시간마다 최신 Release 를 확인해 조용히 설치(/S)하고, 직원 PC는 회사 PC의 `/update/setup.exe` 를 받아 따라 업데이트된다.

주의: 이 저장소는 공개(public)다. 실제 스케줄 데이터, 직원 이름, 공지 내용 등 회사 정보는 절대 커밋하지 않는다 (`seed-data.json` 은 빈 양식만).
리눅스에서 빌드할 때 wine 은 필요 없다 (electron-builder `--win dir` + resedit 아이콘 + makensis).
