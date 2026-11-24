# SPACEBASE 워크스페이스 — 작업 규칙

회사 주간 스케줄 + 캘린더 사내 웹사이트 (https://bbaekdi.github.io/spacebase-schedule/).
**프로그램 구조, 사용 기술, 결정한 내용, 남은 할 일은 `README.md` 에 있다. 작업 전에 먼저 읽는다.**

## 소통
- 사용자는 개발자가 아니다. 쉬운 한국어로, 단계별로, 눌러야 할 화면은 링크를 붙여 설명한다. 전문 용어는 피한다.
- 화면을 바꾸면 스크린샷으로 보여 주고, 배포 뒤 "Ctrl+F5 로 새로고침"을 안내한다.
- 사용자의 직함·역할을 짐작해서 부르지 않는다.

## 보안 (가장 중요)
- 이 저장소는 **공개(public)** 다. 실제 스케줄 데이터, 직원 이름, 공지 내용, 밴드 구독(iCal) 주소, 밴드 번호, 비밀번호·토큰은 **절대 커밋하지 않는다**. `seed-data.json` 은 빈 양식만.
- 비밀 값은 GitHub Secrets 에만 둔다. 사용자가 Secret 화면(Settings → Secrets and variables → Actions)에 직접 넣게 하고, 채팅에 붙여넣지 말라고 안내한다. 새 밴드 주소 같은 것도 Secret 으로 받아 `pages.yml` 이 빌드할 때 넣는다.
- 회사 비밀번호를 대신 입력하거나, 사용자 계정의 OAuth 동의·로그인을 대신 누르지 않는다.
- 구글·네이버웍스 토큰은 암호화해서 각자 브라우저 localStorage 에만 둔다. Firebase·서버에 개인 정보를 올리지 않는다 (개인 일정은 본인 화면에만).

## 작업 방식
- 작은 화면 수정은 PR 없이 **main 에 바로 커밋·푸시**한다. 다른 작업이 PR 로 합쳐지기도 하니 푸시 전에 `git pull --rebase origin main`.
- main 에 푸시하면 `pages.yml` 이 사이트를 배포한다. `pages.yml` 은 build/deploy 두 작업으로 나눠 둔다 (합치면 배포 실패).
- `worker/**` 를 바꾸면 `band-worker.yml` / `mail-worker.yml` 이 Cloudflare 에 배포한다.
- Secret 만 바꿨을 때는 `gh workflow run pages.yml` 로 사이트를 다시 배포한다.
- 데스크톱 앱(Electron)도 같이 업데이트해야 하는 변경(주간 스케줄 화면 `public/app.*`, `public/index.html`, `server.js` 등)은 `package.json` 의 `version` 을 올린다 → `release.yml` 이 Release 를 만들고 회사 PC 가 자동 업데이트.
- 주간 스케줄 화면은 웹(Firebase)과 데스크톱 앱(서버 방식, file:)에서 같이 쓰인다. 한쪽만 깨지지 않게 둘 다 생각한다.
- 화면은 vanilla JS + HTML/CSS (빌드 도구 없음). 리눅스에서 데스크톱 빌드할 때 wine 은 필요 없다.
