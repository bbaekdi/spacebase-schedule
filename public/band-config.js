// 밴드 캘린더 중계 주소 (worker/band-relay.js). 비어 있으면 GitHub Actions 가 Firebase 에 넣어 둔 밴드 일정만 쓴다.
window.SB_BAND_API = 'https://sbe-band.smbaek-1c4.workers.dev';
// 구글 캘린더 "구글 계정으로 연결" 사용 여부 (GitHub Secrets 에 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 을 넣은 뒤 true)
window.SB_GOOGLE_LOGIN = false;
