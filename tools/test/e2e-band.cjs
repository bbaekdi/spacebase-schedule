// Band 게시판 화면 시험 (연습용 Firebase). 실행 방법은 e2e-auth.cjs 와 같음:
// 에뮬레이터 + 로컬 서버를 켠 뒤 node tools/test/emu-seed.mjs && node tools/test/e2e-band.cjs <스크린샷 폴더>
const { chromium, devices } = require('playwright');
const SH = process.argv[2], B = 'http://127.0.0.1:8080/', DB = 'http://127.0.0.1:9000/', NS = '?ns=spacebase-schedule-default-rtdb';
let fails = 0; const log = (ok, m) => { if (!ok) fails++; console.log((ok ? '✓ ' : '✗ ') + m); };
const put = (path, v) => fetch(DB + path + '.json' + NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(v) });
(async () => {
  const br = await chromium.launch(); const errs = [];
  async function user(email, name, admin, opt = {}) {
    const c = await br.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, ...opt });
    await c.addInitScript(() => { try { localStorage.setItem('sb_emu', '1'); localStorage.setItem('sb_auth', 'google'); localStorage.setItem('sbe_ext_later', String(Date.now())); } catch {} });
    const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
    await p.goto(B + 'band.html'); await p.waitForSelector('#sbG');
    const uid = await p.evaluate((email) => firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true }))).then((r) => r.user.uid), email);
    if (name) { await put('ws/members/' + uid, { name, email, joinedAt: 1 }); if (admin) await put('ws/admins/' + uid, true); await p.reload(); }
    return p;
  }
  const a = await user('a@test.com', '김테스트', true);
  await a.waitForSelector('.bd-empty');
  log((await a.locator('.tabs a', { hasText: 'Band' }).count()) === 1, '상단 메뉴에 Band 보임');
  log(/아직 글이 없어요/.test(await a.locator('#list').innerText()), '빈 게시판 안내');
  // 글쓰기
  await a.click('#write'); await a.click('#wCats label:has-text("공지·자유글")');
  await a.fill('#fWrite textarea', '12월 회식 안내\n금요일 저녁 7시입니다. 참석 여부 댓글 부탁드려요.'); await a.click('#wSave');
  await a.waitForSelector('.bd-post');
  await a.click('#write'); await a.click('#wCats label:has-text("A/S")');
  await a.fill('#fWrite textarea', '테스트현장 욕실 실리콘 들뜸 A/S 접수'); await a.click('#wSave');
  await a.waitForFunction(() => document.querySelectorAll('.bd-post').length === 2);
  log(true, '글 2개 올림');
  // 다른 직원
  const b = await user('b@test.com', '이시험', false);
  await b.waitForFunction(() => document.querySelectorAll('.bd-post').length === 2);
  log(true, '다른 직원 화면에 바로 보임');
  await b.click('.bd-post:has-text("회식")'); await b.waitForSelector('#dlgPost[open]');
  log((await b.locator('#pBody [data-a=edit]').count()) === 0, '남의 글에는 고치기/지우기 버튼 없음');
  await b.fill('#fCmt input', '참석합니다!'); await b.click('#fCmt button');
  await b.waitForSelector('.bd-cmts li[data-cid]');
  await b.screenshot({ path: SH + '/b2-post.png' });
  await b.click('#dlgPost [data-close]');
  await a.waitForFunction(() => /댓글 1/.test(document.querySelector('.bd-post:nth-child(2)')?.innerText || document.body.innerText));
  log(true, '댓글 달림 + 글쓴이 화면에 댓글 수 1');
  // 게시판 나누기 + 찾기
  await b.click('#cats button:has-text("A/S")');
  log((await b.locator('.bd-post').count()) === 1, 'A/S 게시판만 보기');
  await b.click('#cats button:has-text("전체")');
  await b.fill('#q', '실리콘'); await b.waitForTimeout(400);
  log((await b.locator('.bd-post').count()) === 1 && (await b.locator('.bd-post mark').count()) >= 1, '"실리콘" 찾기 → 1개 + 노란 표시');
  await b.screenshot({ path: SH + '/b3-search.png' });
  await b.fill('#q', ''); await b.waitForTimeout(300);
  // 글 고치기 (쓴 사람)
  await a.click('.bd-post:has-text("회식")'); await a.click('#pBody [data-a=edit]');
  await a.fill('#fWrite textarea', '12월 회식 안내 (장소 추가)\n금요일 저녁 7시, 회사 앞 식당입니다.'); await a.click('#wSave');
  await b.waitForFunction(() => /장소 추가/.test(document.body.innerText) && /수정됨/.test(document.body.innerText));
  log(true, '글 고치기 → 다른 직원 화면에도 반영, "수정됨" 표시');
  // 관리자가 아닌 사람이 남의 글을 강제로 고치기 → 막힘
  const blocked = await b.evaluate(async () => { const s = await firebase.database().ref('board/posts').once('value'); const id = Object.keys(s.val()).find((k) => s.val()[k].name === '김테스트'); try { await firebase.database().ref('board/posts/' + id + '/text').set('해킹'); return false; } catch { return true; } });
  log(blocked, '일반 직원이 남의 글을 몰래 고치기 → 막힘');
  // 지우기
  await a.click('.bd-post:has-text("실리콘")'); await a.click('#pBody [data-a=del]');
  await b.waitForFunction(() => document.querySelectorAll('.bd-post').length === 1);
  log(true, '글 지우기 → 목록에서 사라짐');
  await a.screenshot({ path: SH + '/b1-list.png' });
  // 비회원
  const x = await user('x@test.com', null, false);
  await x.waitForFunction(() => /승인을 기다리고/.test(document.body.innerText));
  const xr = await x.evaluate(async () => { try { await firebase.database().ref('board').once('value'); return 'read'; } catch { return 'blocked'; } });
  log(xr === 'blocked', '비회원은 Band 글을 못 읽음');

  // ---------- 3단계: 현장 방 + A/S 처리 상태 + 홈 카드 ----------
  await a.click('#write'); await a.click('#wCats label:has-text("프로젝트")');
  log(await a.locator('#fWrite textarea[name=text]').isHidden(), '프로젝트: 자유 글 상자 대신 항목별 칸');
  await a.fill('[name=f_client]', '테스트건설');
  log((await a.locator('.bd-choice label').allInnerTexts()).join(',') === '오피스,카페,병원,직접 입력', '형태: 오피스/카페/병원/직접 입력 고르기');
  await a.click('.bd-choice label:has-text("직접 입력")');
  log(await a.locator('[name=f_type]').isVisible(), '형태 "직접 입력" → 글자 칸 나옴');
  await a.click('.bd-choice label:has-text("오피스")');
  log((await a.inputValue('[name=f_type]')) === '오피스' && await a.locator('[name=f_type]').isHidden(), '형태 "오피스" 고르기');
  log((await a.inputValue('[name=siteName]')) === '', '현장 이름은 자동으로 안 채움 (직접 입력)');
  await a.fill('[name=siteName]', '테스트빌딩 3층 사무실');
  // 도로명주소 검색 (시험에서는 카카오 대신 가짜 검색창)
  await a.evaluate(() => { window.daum = { Postcode: function (o) { this.embed = (el) => { el.innerHTML = '<button type="button" id="fakeAddr">가짜 검색 결과</button>'; el.querySelector('button').onclick = () => o.oncomplete({ roadAddress: '테스트시 테스트구 연습로 1', buildingName: '테스트빌딩' }); }; } }; });
  await a.click('[data-addr]'); await a.click('#fakeAddr');
  log((await a.inputValue('[name=f_address]')) === '테스트시 테스트구 연습로 1', '도로명주소 검색 → 주소 칸 자동 입력');
  await a.fill('[name=f_addr2]', 'A동 305호'); await a.fill('[name=f_area]', '100');
  // 공사기간 달력: 시작일 2027-01-06, 준공일 2027-02-10
  await a.click('[data-cal=f_start]'); await a.click('.bd-cal [data-mv="1"]'); await a.click('.bd-cal [data-mv="1"]');
  log((await a.locator('.bd-cal b').innerText()) === '2027년 1월', '달력 다음 달로 넘기기');
  const cls = async (d) => a.getAttribute(`.bd-cal [data-d="${d}"]`, 'class');
  log(/red/.test(await cls('2027-01-01')) && /red/.test(await cls('2027-01-03')) && /blue/.test(await cls('2027-01-02')) && !/red|blue/.test(await cls('2027-01-04')), '달력: 공휴일·일요일 빨강, 토요일 파랑, 평일 검정');
  await a.screenshot({ path: SH + '/b11-calendar.png' });
  log(await a.evaluate(() => { const d = document.getElementById('dlgWrite'); return d.scrollLeft === 0 && d.querySelector('.dlg-body').scrollLeft === 0 && ![...d.querySelectorAll('*')].some((x) => x.getBoundingClientRect().right > d.getBoundingClientRect().right + 1); }), '글쓰기 창이 옆으로 밀리지 않음');
  await a.click('.bd-cal [data-d="2027-01-06"]');
  await a.click('[data-cal=f_end]');
  log((await a.locator('.bd-cal b').innerText()) === '2027년 1월', '준공일 달력은 시작일 달부터');
  await a.click('.bd-cal [data-mv="1"]'); await a.click('.bd-cal [data-d="2027-02-10"]');
  log((await a.locator('[data-cal=f_start]').innerText()) === '27년 01월 06일' && (await a.locator('[data-cal=f_end]').innerText()) === '27년 02월 10일', '공사기간: 27년 01월 06일 ~ 27년 02월 10일');
  log((await a.locator('.bd-unit b').innerText()) === 'PY', '평수 칸 옆에 PY 단위');
  log((await a.inputValue('[name=f_phonePre]')) === '010', '연락처 앞자리 010 이 미리 골라져 있음');
  await a.fill('[name=f_contact]', '홍길동 팀장'); await a.locator('[name=f_phone]').pressSequentially('12345678');
  log((await a.inputValue('[name=f_phone]')) === '1234-5678', '뒷번호만 치면 줄표 자동 (1234-5678)');
  await a.fill('[name=f_etc]', '예산 미정');
  await a.screenshot({ path: SH + '/b9-form-project.png' });
  await a.click('#wSave');
  await a.waitForSelector('.bd-post:has-text("테스트빌딩")');
  log(/1\. 발주처명 _ 테스트건설\n2\. 형태 _ 오피스\n3\. 위치\(현장주소\) _ 테스트시 테스트구 연습로 1 A동 305호\n4\. 평수 _ 100\.0 PY\n5\. 공사기간 _ 27년 01월 06일~27년 02월 10일[\s\S]*6\. 발주처 담당자 _ 홍길동 팀장 010-1234-5678[\s\S]*7\. 기타 _ 예산 미정/.test(await a.locator('.bd-post:has(.bd-chip.project) .bd-text').innerText()), '올라간 글은 지금 밴드처럼 1~7번 모양');
  await a.click('.bd-post:has(.bd-chip.project) .bd-text');
  log((await a.locator('#pBody a[href="tel:01012345678"]').count()) === 1 && (await a.locator('#pBody a[href*="map.naver.com"]').count()) === 1, '글 보기: 연락처 누르면 전화, 주소 누르면 지도');
  await a.click('#dlgPost [data-close]');
  log(true, '프로젝트(현장) 등록');
  await b.click('#write'); await b.click('#wCats label:has-text("A/S")');
  await b.waitForSelector('#wExtra select[name=site] option:has-text("테스트빌딩")', { state: 'attached' });
  await b.selectOption('#wExtra select[name=site]', { label: '테스트빌딩 3층 사무실' });
  log((await b.inputValue('[name=f_contact]')) === '홍길동 팀장' && (await b.inputValue('[name=f_phone]')) === '1234-5678' && (await b.inputValue('[name=f_phonePre]')) === '010', 'A/S: 현장 고르면 발주처 담당자·연락처 자동으로 채움');
  log((await b.inputValue('[name=f_recv]')) !== '' && /^\d{2}년 \d{2}월 \d{2}일$/.test(await b.locator('[data-cal=f_recv]').innerText()), 'A/S: 접수일 오늘로 미리 채움 (달력 칸)');
  log((await b.locator('.bd-owners label').count()) === 3, 'A/S 담당자 = 주간 스케줄 직원표 전 직원 (3명)');
  log((await b.locator('.bd-teamh').allInnerTexts()).join('|').replace(/\s+/g, ' ') === '설계팀 2명|시공팀 1명', '담당자: 팀별로 나눠서 (설계팀 2명 / 시공팀 1명)');
  log(await b.evaluate(() => getComputedStyle(document.querySelector('.bd-ownbox')).overflowY === 'auto'), '담당자 칸은 스크롤');
  log((await b.locator('.bd-f:has-text("A/S 형태")').count()) === 1, 'A/S 형태 칸 있음');
  await b.click('.bd-owners label:has-text("김테스트 대리")'); await b.click('.bd-owners label:has-text("박연습 과장")');
  await b.fill('[name=f_kind]', '추가공사'); await b.fill('[name=f_req]', '화장실 문 손잡이 고장');
  await b.click('[data-cal=f_asStart]'); await b.click('.bd-cal [data-today]');
  await b.click('[data-cal=f_asEnd]'); await b.click('.bd-cal [data-mv="1"]'); await b.click('.bd-cal [data-d$="-15"]');
  await b.click('[data-cal=f_plan]'); await b.click('.bd-cal [data-today]');
  log(/^\d{2}년 \d{2}월 \d{2}일$/.test(await b.locator('[data-cal=f_asEnd]').innerText()) && /^\d{2}년/.test(await b.locator('[data-cal=f_plan]').innerText()), 'A/S 기간·작업예정일 달력으로 고르기');
  log(/고른 사람: 김테스트 대리, 박연습 과장/.test(await b.locator('#wExtra .bd-ownsel').innerText()), '고른 담당자 표시');
  await b.screenshot({ path: SH + '/b10-form-as.png' });
  await b.click('#wSave');
  await b.waitForSelector('.bd-post:has-text("손잡이") .bd-site');
  log((await b.locator('.bd-post:has-text("손잡이") .bd-as').innerText()) === '접수 · 김테스트 대리 외 1명', 'A/S 글: "접수 · 김테스트 대리 외 1명"');
  log(/1\.발주처명 : 테스트빌딩 3층 사무실\n2\.A\/S 형태 : 추가공사\n3\.A\/S 기간 : \d{2}년 \d{2}월 \d{2}일~\d{2}년 \d{2}월 15일[\s\S]*요청내용 :\n화장실 문 손잡이 고장[\s\S]*작업예정일 : \d+월 \d+일/.test(await b.locator('.bd-post:has-text("손잡이") .bd-text').innerText()), 'A/S 글은 보내 준 모양(발주처명·접수일·요청내용·작업예정일)');
  // 현장 직접 입력
  await b.click('#write'); await b.click('#wCats label:has-text("A/S")');
  await b.selectOption('#wExtra select[name=site]', '__direct');
  await b.fill('[name=siteDirect]', '직접쓴현장'); await b.fill('[name=f_req]', '전등 교체'); await b.click('#wSave');
  await b.waitForSelector('.bd-post:has-text("직접쓴현장") .bd-site.plain');
  log(true, 'A/S 현장 직접 입력 (현장 방 없이 이름만 표시)');
  await b.click('#write'); await b.click('#wCats label:has-text("현장 사진")');
  await b.selectOption('#wExtra select[name=site]', { label: '테스트빌딩 3층 사무실' });
  await b.fill('#fWrite textarea', '오늘 천장 작업 진행'); await b.click('#wSave');
  await b.waitForSelector('.bd-post:has-text("천장")');
  // 현장 방
  await b.click('.bd-post:has-text("천장") .bd-site');
  await b.waitForSelector('.bd-sitecard h1:has-text("테스트빌딩")');
  await b.waitForFunction(() => document.querySelectorAll('#list .bd-post').length === 2);
  log(/현장 사진 1/.test(await b.locator('.bd-sitecard').innerText()) && /안 끝남 1/.test(await b.locator('.bd-sitecard').innerText()), '현장 방: 사진 1 · A/S 1 (안 끝남 1)');
  await b.click('#write');
  log((await b.locator('#wCats label').count()) === 2 && (await b.inputValue('#wExtra select[name=site]')) !== '', '현장 방에서 글쓰기 → 현장이 미리 골라져 있음');
  await b.click('#dlgWrite [data-close]');
  await b.screenshot({ path: SH + '/b6-site.png' });
  // A/S 상태 바꾸기 (다른 직원)
  await a.click('.bd-post:has-text("손잡이")'); await a.waitForSelector('.bd-asbox');
  await a.click('.bd-asbtn.doing');
  await a.click('#pBody .bd-owners label:has-text("박연습 과장")');
  await b.waitForFunction(() => /처리 중 · 김테스트 대리$/.test([...document.querySelectorAll('.bd-post')].find((x) => /손잡이/.test(x.innerText))?.querySelector('.bd-as')?.innerText || ''));
  log(true, '글 보기에서 담당자 빼기/넣기 → 바로 반영');
  await b.waitForFunction(() => /처리 중/.test([...document.querySelectorAll('.bd-post')].find((x) => /손잡이/.test(x.innerText))?.querySelector('.bd-as')?.innerText || ''));
  log(true, 'A/S "처리 중" → 다른 직원 화면에도 바로 반영');
  await a.screenshot({ path: SH + '/b7-as.png' });
  await a.click('.bd-asbtn.done');
  await a.click('#dlgPost [data-close]');
  await b.click('.bd-back');
  await b.click('#cats button:has-text("A/S")'); await b.check('#asOpen');
  await b.waitForFunction(() => document.querySelectorAll('.bd-post').length === 1 && !/손잡이/.test(document.getElementById('list').innerText));
  log(true, 'A/S 완료 → "안 끝난 A/S만" 보기에서 빠짐');
  await b.uncheck('#asOpen'); await b.click('#cats button:has-text("전체")');
  // 끝난 현장 → 고르기 목록에서 숨김
  await a.click('.bd-post:has(.bd-chip.project) .bd-text'); await a.click('#pBody [data-a=edit]');
  await a.check('#wExtra input[name=closed]'); await a.click('#wSave');
  await a.waitForSelector('.bd-post:has-text("끝난 현장")');
  await b.click('#write'); await b.click('#wCats label:has-text("현장 사진")');
  log((await b.locator('#wExtra select[name=site] option:has-text("테스트빌딩")').count()) === 0, '끝난 현장은 현장 고르기 목록에서 숨김');
  await b.click('#dlgWrite [data-close]');
  // 홈 카드
  await b.click('#write'); await b.click('#wCats label:has-text("A/S")'); await b.fill('[name=f_req]', '새 A/S 하나'); await b.click('#wSave');
  await b.goto(B + 'portal.html'); await b.waitForSelector('#bandNew li a');
  await b.waitForFunction(() => /안 끝난 A\/S 2건/.test(document.getElementById('bandAs').innerText));
  log((await b.locator('#bandNew li').count()) === 5, '홈 "Band 새 글" 5개 + "안 끝난 A/S 2건"');
  await b.waitForTimeout(1500); await b.screenshot({ path: SH + '/b8-home.png' });
  await b.click('#bandAs'); await b.waitForSelector('#asOpen:checked'); await b.waitForSelector('.bd-post');
  log((await b.locator('.bd-post').count()) === 2, '홈에서 누르면 안 끝난 A/S 목록으로');
  await b.click('.bd-post'); await b.waitForSelector('#dlgPost[open]'); await b.click('#dlgPost [data-close]');
  await b.goto(B + 'band.html#post=' + (await b.evaluate(async () => { const s = await firebase.database().ref('board/posts').orderByChild('cat').equalTo('project').once('value'); return Object.keys(s.val())[0]; })));
  await b.waitForSelector('#dlgPost[open] .bd-ptitle');
  log(true, 'band.html#post=… 주소로 글 바로 열기');
  // 휴대폰
  const m = await user('m@test.com', '박연습', false, { ...devices['iPhone 13'] });
  await m.waitForSelector('.bd-post'); await m.waitForTimeout(500);
  await m.screenshot({ path: SH + '/b4-mobile.png' });
  await m.click('#write'); await m.waitForSelector('#dlgWrite[open]'); await m.screenshot({ path: SH + '/b5-mobile-write.png' });
  log(true, '휴대폰 화면');
  console.log('\n페이지 오류:', errs.length ? errs.join('\n') : '없음');
  console.log(fails ? `실패 ${fails}개` : '모두 통과');
  await br.close(); process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error('시험 중단:', e.message); process.exit(1); });
