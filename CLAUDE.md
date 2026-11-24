# SPACEBASE 워크스페이스 — 작업 규칙

회사 주간 스케줄 + 홈 + 캘린더 사내 웹사이트 (https://bbaekdi.github.io/spacebase-schedule/) 와 같은 화면의 데스크톱 앱.
- **프로그램 구조, 사용 기술, 결정한 내용은 `README.md`** 에 있다. 작업 전에 먼저 읽는다.
- **할 일과 계획 일정표는 `Doc/`** 에 있다 (`Doc/README.md` 참고). 작업을 시작하면 `Todo` → `Doing`, 끝나면 `Done` 으로 파일을 옮기고 체크한다.

## 소통
- 사용자는 개발자가 아니다. **쉬운 한국어**로, 짧게, 전문 용어는 피한다. 눌러야 할 화면은 링크를 붙여 단계별로.
- 사용자가 원하는 설명 방식: **결과만 짧게 + 스크린샷**. (무엇이 바뀌었는지 + 버전 + "업데이트 후 Ctrl+F5")
- 질문할 일이 있으면 객관식으로 묻는다.
- 사용자의 직함·역할을 짐작해서 부르지 않는다.

## 보안 (가장 중요)
- 이 저장소는 **공개(public)** 다. 실제 스케줄 데이터, 직원 이름, 프로젝트명, 공지 내용, 밴드 구독(iCal) 주소, 밴드 번호, 비밀번호·토큰은 **절대 커밋하지 않는다**. `seed-data.json` 은 빈 양식만. `Doc/` 에도 회사 정보는 쓰지 않는다.
- 비밀 값은 GitHub Secrets 에만 둔다. 사용자가 Secret 화면(Settings → Secrets and variables → Actions)에 직접 넣게 하고, 채팅에 붙여넣지 말라고 안내한다. 새 밴드 주소 같은 것도 Secret 으로 받아 `pages.yml` 이 빌드할 때 넣는다.
  (`public/firebase-config.js` 의 Firebase 웹 설정은 원래 공개용이라 예외.)
- 회사 비밀번호를 대신 입력하거나, 사용자 계정의 OAuth 동의·로그인을 대신 누르지 않는다.
- 구글·네이버웍스 토큰은 암호화해서 각자 브라우저 localStorage 에만 둔다. Firebase·서버에 개인 정보를 올리지 않는다 (개인 일정은 본인 화면에만).
- 사용자 허락 없이 새 계정·저장소·외부 서비스를 만들거나 연결하지 않는다.

## 데이터를 망가뜨리지 않기
- 실사용 데이터는 Firebase Realtime Database 에 있고, 여러 직원이 동시에 쓴다.
- 데이터를 통째로 덮어쓰지 말고 **바뀐 키만** 저장한다 (메모는 `memo/<k>` 별로). 예전에 통째 저장 때문에 공지가 사라졌다.
- 값이 그대로면 저장하지 않는다 (`_orig`, `_dirty` 규칙 유지).
- 데이터 구조를 바꿀 때는 기존 데이터를 옮기는 코드(migrate)를 함께 넣는다.
- 테스트는 실제 Firebase 가 아니라 **RTDB 에뮬레이터**나 테스트용 데이터로 한다 (컨테이너에서는 실제 Firebase 에 못 붙는다).

## 화면·인쇄 규칙
- 화면 모양은 회사 엑셀 양식을 따른다. 인쇄는 **A4 가로 한 장**에 들어가야 한다.
- 인쇄 검은 선은 안쪽 회색 선보다 얇으면 안 된다.
- 인쇄·레이아웃을 바꾸면 PDF로 뽑아 한 장에 들어가는지, 선이 보이는지 확인한다.
- 화면을 바꾸면 스크린샷으로 보여 준다.

## 작업 방식·배포
- 작은 수정은 PR 없이 **main 에 바로 커밋·푸시**한다. 다른 작업이 PR 로 합쳐지기도 하니 푸시 전에 `git pull --rebase origin main`.
- main 에 푸시하면 `pages.yml` 이 사이트를 배포한다. `pages.yml` 은 build/deploy 두 작업으로 나눠 둔다 (합치면 배포 실패).
- `worker/**` 를 바꾸면 `band-worker.yml` / `mail-worker.yml` 이 Cloudflare 에 배포한다.
- Secret 만 바꿨을 때는 `gh workflow run pages.yml` 로 사이트를 다시 배포한다.
- 데스크톱 앱도 같이 바뀌어야 하는 변경(주간 스케줄 화면 `public/app.*`, `public/index.html`, `public/ops.js`, `server.js`, `desktop/` 등)은 `package.json` 의 `version` 을 올린다 → `release.yml` 이 Release `vX.Y.Z` 를 만들고 앱이 자동 업데이트. 웹 화면만 바뀌면 버전은 그대로.
- 주간 스케줄 화면은 웹(Firebase)과 데스크톱 앱(file:)에서 같이 쓰인다. 한쪽만 깨지지 않게 둘 다 생각한다.
- makensis 는 `-INPUTCHARSET UTF8` 를 빼지 않는다 (바로가기 이름 깨짐).
- 설치 파일을 사람에게 직접 줄 때는 **zip** 으로 (.exe 다운로드는 막힌다).
- 화면은 vanilla JS + HTML/CSS (빌드 도구 없음). 리눅스에서 데스크톱 빌드할 때 wine 은 필요 없다.
