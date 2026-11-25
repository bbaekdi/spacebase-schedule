// Site(현장 공정·출근) 화면 시험 (연습용 Firebase, 가짜 데이터). 실행 방법은 e2e-auth.cjs 와 같음:
// 에뮬레이터 + 로컬 서버를 켠 뒤 node tools/test/emu-seed.mjs && node tools/test/e2e-site.cjs <스크린샷 폴더>
const { chromium, devices } = require('playwright');
const crypto = require('crypto');
const SH = process.argv[2], B = 'http://127.0.0.1:8080/', DB = 'http://127.0.0.1:9000/', NS = '?ns=spacebase-schedule-default-rtdb';
const SPACE = crypto.createHash('sha256').update('spacebase:testcode').digest('hex');
let fails = 0; const log = (ok, m) => { if (!ok) fails++; console.log((ok ? '✓ ' : '✗ ') + m); };
const put = (path, v) => fetch(DB + path + '.json' + NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(v) });
const get = async (path) => (await fetch(DB + path + '.json' + NS, { headers: { Authorization: 'Bearer owner' } })).json();
const kst = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const plus = (n) => kst(new Date(Date.now() + n * 864e5));
const dot = (s) => s.replace(/-/g, '.');
(async () => {
  const TODAY = plus(0);
  await put(`spaces/${SPACE}/data/groups`, [{ id: 'g1', name: 'PROJECT' }, { id: 'g2', name: '수주 전' }]);
  await put(`spaces/${SPACE}/data/members`, [{ id: 'm1', name: '김테스트', rank: '대리', teamId: 't1', abbr: '김' }, { id: 'm2', name: '이시험', rank: '사원', teamId: 't1', abbr: '이' }]);
  await put(`spaces/${SPACE}/data/projects`, [
    { id: 'p1', groupId: 'g1', name: '테스트 오피스', period: `${dot(plus(-10))}-${dot(plus(40))}`, build: '김', design: '이' },
    { id: 'p2', groupId: 'g1', name: '지난 현장', period: `${dot(plus(-90))}-${dot(plus(-30))}`, build: '김' },
    { id: 'p3', groupId: 'g1', name: '기간 미정 현장', period: '미정', build: '이' },
    { id: 'p4', groupId: 'g2', name: '수주 전 현장', period: `${dot(plus(-5))}-${dot(plus(5))}`, build: '김' },
  ]);
  const br = await chromium.launch(); const errs = [];
  async function user(email, name, admin, opt = {}) {
    const c = await br.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, ...opt });
    await c.addInitScript(() => { try { localStorage.setItem('sb_emu', '1'); localStorage.setItem('sb_auth', 'google'); localStorage.setItem('sbe_ext_later', String(Date.now())); localStorage.setItem('sb_install_later', String(Date.now())); } catch {} });
    const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
    await p.goto(B + 'site.html'); await p.waitForSelector('#sbG');
    const uid = await p.evaluate((email) => firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true }))).then((r) => r.user.uid), email);
    await put('ws/members/' + uid, { name, email, joinedAt: 1 }); if (admin) await put('ws/admins/' + uid, true);
    await p.reload().catch(() => {}); await p.waitForLoadState(); return { p, uid };
  }
  const { p: a, uid: aUid } = await user('a@test.com', '김테스트', false);
  await a.waitForSelector('.st-head h1');
  log((await a.locator('.tabs a', { hasText: 'Site' }).count()) === 1, '상단 메뉴에 Site');
  const side = await a.locator('#side').innerText();
  log(/진행 현장\s*테스트 오피스/.test(side) && /기간 미정 현장/.test(side) && /지난 현장 \(1\)/.test(side) && !/수주 전 현장/.test(side), '현장 목록: 진행 / 기간 미정 / 지난 현장 (PROJECT 구분만)');
  log((await a.locator('.st-head h1').innerText()) === '테스트 오피스', '진행 현장이 먼저 열림');
  log(/소장: 김테스트 대리/.test(await a.locator('.st-head').innerText()), '소장 = 주간 스케줄 시공 담당(약칭 김 → 김테스트 대리)');
  // 공정 목록
  await a.click('#addDefault'); await a.waitForFunction(() => document.querySelectorAll('.st-trow').length === 11);
  log(true, '기본 공정 목록 11개 넣기');
  const row = (n) => `.st-trow:has(input.nmc[value="${n}"])`;
  // 목공: 오늘 ~ 4일 뒤 (달력)
  await a.click(`${row('목공')} [data-cal=start]`); await a.click('.st-cal [data-today]');
  await a.click(`${row('목공')} [data-cal=end]`);
  if (plus(4).slice(0, 7) !== TODAY.slice(0, 7)) await a.click('.st-cal [data-m="1"]');
  await a.click(`.st-cal [data-d="${plus(4)}"]`);
  await a.waitForSelector('.st-wk.now .st-seg.now:has-text("목공")');
  log(true, '캘린더: 이번 주 목공 막대가 색으로');
  const mokId = await a.getAttribute(row('목공'), 'data-t');
  log(/오늘: 목공/.test(await a.locator('.st-head').innerText()), '머리: "오늘: 목공"');
  // 날짜 눌러 그날 하는 공정 고치기
  await a.click(`button.st-day[data-day="${TODAY}"]`); await a.waitForSelector('.st-daypop');
  log(await a.isChecked(`.st-daypop input[data-t="${mokId}"]`), '날짜를 누르면 그날 하는 공정 목록 (목공 켜짐)');
  await a.uncheck(`.st-daypop input[data-t="${mokId}"]`);
  await a.waitForFunction(async ([u]) => true, [0]);
  await new Promise((r) => setTimeout(r, 600));
  log((await get(`site/p1/tasks/${mokId}/minus/${TODAY}`)) === true, '끄면 그날만 쉬는 날');
  await a.check(`.st-daypop input[data-t="${mokId}"]`); await new Promise((r) => setTimeout(r, 600));
  log((await get(`site/p1/tasks/${mokId}/minus/${TODAY}`)) === null, '다시 켜면 하는 날');
  await a.click('.st-daypop [data-close]');
  // 이번 주가 아닌 주의 막대는 회색 (타일: 8~9일 뒤)
  const taId = await a.getAttribute(row('타일'), 'data-t');
  await put(`site/p1/tasks/${taId}/start`, plus(8)); await put(`site/p1/tasks/${taId}/end`, plus(9));
  if (plus(8).slice(0, 7) !== TODAY.slice(0, 7)) await a.click('[data-mo="1"]');
  await a.waitForSelector('.st-seg:has-text("타일")');
  log((await a.locator('.st-seg.now:has-text("타일")').count()) === 0, '이번 주가 아닌 공정 막대는 회색');
  await a.click('[data-mo="0"]');
  // 진행률: 일정이 지난 날만큼 (철거 3일 지남 / 철거3 + 목공5 + 타일2 + 날짜 없는 8)
  const chId = await a.getAttribute(row('철거'), 'data-t');
  await put(`site/p1/tasks/${chId}/start`, plus(-3)); await put(`site/p1/tasks/${chId}/end`, plus(-1));
  await a.waitForFunction(() => /진행률 17%/.test(document.querySelector('.st-head').innerText));
  log(true, '공정을 등록하면 진행률이 바뀜 (지난 날만큼, 17%)');
  // 완료 체크 → 그 공정은 다 끝난 것으로
  await a.check(`${row('목공')} input.chk`); await a.waitForFunction(() => /진행률 44%/.test(document.querySelector('.st-head').innerText));
  log(true, '완료 체크 → 진행률 올라감 (44%)');
  // 이름 고치기 + 순서
  await a.fill(`${row('청소')} input.nmc`, '준공 청소'); await a.locator(`${row('청소')} input.nmc`).press('Tab');
  await a.waitForSelector(row('준공 청소'));
  log(true, '공정 이름 고치기');
  const before = await a.locator('.st-trow input.nmc').evaluateAll((l) => l.map((x) => x.value).slice(0, 2).join(','));
  await a.click(`${row('설비')} [data-mv="-1"]`); await a.waitForFunction(() => document.querySelector('.st-trow input.nmc').value === '설비');
  log(before === '철거,설비', '공정 순서 바꾸기 (설비 ↑)');
  log((await a.locator('.st-gantt, .st-week').count()) === 0, '이번 주 칸·전체 막대는 캘린더 하나로 합침');
  await a.screenshot({ path: SH + '/s1-site.png', fullPage: true });
  // 출근 (+ 새 글 알림 요청)
  let notifyReq = null;
  await a.route('**/push/notify', (r) => { notifyReq = r.request().postDataJSON(); r.fulfill({ status: 200, body: '{}' }); });
  await a.click('#attBtn'); await a.waitForSelector('.st-attend .done');
  log((await a.locator('.st-attend .done').innerText()) === '✓ 출근함', '출근 → "✓ 출근함" (시간 없음)');
  log(/✓ 출근/.test(await a.locator(`.st-day[data-day="${TODAY}"]`).innerText()), '캘린더 오늘 칸에 출근 표시');
  const posts = Object.values((await get('board/posts')) || {});
  log(posts.some((x) => x.cat === 'attend' && /김테스트 출근 · \d\d:\d\d/.test(x.text) && x.siteName === '테스트 오피스'), 'Band "출근" 게시판에 자동 글');
  await new Promise((r) => setTimeout(r, 800));
  log(!!notifyReq && !!notifyReq.post, '출근하면 새 글 알림 보내기 요청');
  await a.locator('.st-head').screenshot({ path: SH + '/s0-head.png' });
  await a.locator('.st-calcard').screenshot({ path: SH + '/s4-calendar.png' });
  // 다른 직원 (소장 아님)
  const { p: b } = await user('b@test.com', '이시험', false);
  await b.waitForSelector('.st-head h1');
  log((await b.locator('#attBtn').count()) === 0 && (await b.locator('#addTask').count()) === 0 && (await b.locator('button.st-day').count()) === 0, '소장 아닌 직원: 출근·수정 버튼 없음 (보기만)');
  log(/✓ 출근/.test(await b.locator('.st-calcard').innerText()), '다른 직원도 출근한 날을 봄');
  await b.goto(B + 'band.html'); await b.waitForTimeout(1500);
  log(!/출근 ·/.test(await b.locator('#list').innerText()), 'Band "전체"에는 출근 글이 안 섞임');
  await b.click('#cats button:has-text("출근")'); await b.waitForTimeout(300);
  log(/김테스트 출근/.test(await b.locator('#list').innerText()), 'Band "출근" 게시판에서 보임');
  await b.click('#write');
  log((await b.locator('#wCats label:has-text("출근")').count()) === 0, '글쓰기에서는 "출근" 게시판을 못 고름');
  await b.click('#dlgWrite [data-close]');
  // 홈 카드
  await a.goto(B + 'portal.html'); await a.waitForSelector('#mySiteCard:not(.hidden) .mysite');
  log(/테스트 오피스[\s\S]*오늘: 목공[\s\S]*✓ 출근함/.test(await a.locator('#mySiteCard').innerText()), '홈 "오늘 내 현장": 오늘 공정 + 출근함');
  await a.waitForTimeout(800); await a.screenshot({ path: SH + '/s2-home.png' });
  await b.goto(B + 'portal.html'); await b.waitForTimeout(2000);
  log(await b.locator('#mySiteCard').isHidden(), '소장 아닌 직원은 "오늘 내 현장" 카드 없음');
  // 관리자 (소장 아님): 출근 버튼·오늘 내 현장 카드 보임
  const { p: c } = await user('c@test.com', '박관리', true);
  await c.waitForSelector('.st-head h1');
  log((await c.locator('#attBtn').count()) === 1 && (await c.locator('#addTask').count()) === 1, '관리자: 출근 버튼 + 수정 가능');
  await c.goto(B + 'portal.html'); await c.waitForSelector('#mySiteCard:not(.hidden) .mysite');
  log(/테스트 오피스/.test(await c.locator('#mySiteCard').innerText()) && (await c.locator('#mySiteCard [data-att]').count()) === 1, '관리자: 홈 "오늘 내 현장" 카드 + 출근 버튼');
  // 휴대폰
  const { p: m } = await user('a@test.com', '김테스트', false, { ...devices['iPhone 13'] });
  await m.waitForSelector('.st-head h1'); await m.waitForTimeout(500);
  log(await m.locator('#pick').isVisible(), '휴대폰: 현장 고르기 칸');
  await m.screenshot({ path: SH + '/s3-mobile.png', fullPage: true });
  // 구글 로그인 꺼진 기기
  const P = await br.newContext(); await P.addInitScript(() => { try { localStorage.setItem('sb_emu', '1'); } catch {} });
  const pp = await P.newPage(); pp.on('pageerror', (e) => errs.push(e.message));
  await pp.goto(B + 'site.html'); await pp.waitForTimeout(1200);
  log((await pp.locator('#wsGate:not(.hidden)').count()) === 0 && /시험 중/.test(await pp.locator('#main').innerText()), '구글 로그인 꺼진 기기: 안내 + 버튼');
  console.log('\n페이지 오류:', errs.length ? errs.join('\n') : '없음');
  console.log(fails ? `실패 ${fails}개` : '모두 통과');
  await br.close(); process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error('시험 중단:', e.message); process.exit(1); });
