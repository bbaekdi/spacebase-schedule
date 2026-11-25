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
const S_add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
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
  // 왼쪽 공정 목록
  log((await a.locator('#side .st-tp').count()) === 1 && (await a.locator('.st-tasks').count()) === 0, '공정 목록은 왼쪽 현장 목록 밑 (아래쪽 공정 목록·날짜 칸 없음)');
  await a.click('#side [data-default]'); await a.waitForFunction(() => document.querySelectorAll('#side .st-ti').length === 11);
  log(true, '기본 공정 목록 11개 넣기');
  log((await a.locator('.st-wk').count()) === 4, '캘린더 4주 (지난주·이번 주·다음 주·다다음 주)');
  const W0 = await a.getAttribute('.st-wk >> nth=0 >> .st-day >> nth=0', 'data-day');
  const sun = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - x.getDay()); return kst(new Date(x.getTime() + 9 * 3600e3)); };
  log(W0 === kst(new Date(new Date(sun(TODAY) + 'T00:00:00').getTime() - 7 * 864e5 + 9 * 3600e3)), '첫 주 = 지난주 일요일');
  await a.click('[data-wk="7"]'); const W1 = await a.getAttribute('.st-wk >> nth=0 >> .st-day >> nth=0', 'data-day'); await a.click('[data-wk="0"]');
  log(W1 > W0, '› 누르면 한 주씩 넘어감');
  const li = (n) => `#side .st-ti:has(input.nmc[value="${n}"])`;
  const mokId = await a.getAttribute(li('목공'), 'data-t');
  // 목록에서 오늘 날짜로 끌어다 놓기
  await a.locator(`${li('목공')} .grip`).dragTo(a.locator(`.st-day[data-day="${TODAY}"]`));
  await a.waitForFunction(() => [...document.querySelectorAll('.st-seg')].some((x) => /목공/.test(x.textContent)));
  const m1 = await get(`site/p1/tasks/${mokId}`);
  log(m1.start === TODAY && m1.end === TODAY, '목록에서 날짜로 끌어다 놓기 → 그날 하루 막대');
  // 끝 잡아 늘리기 (오늘 → 4일 뒤)
  const pdrag = async (from, to) => { const f = await a.locator(from).boundingBox(), t = await a.locator(to).boundingBox(); await a.mouse.move(f.x + f.width / 2, f.y + f.height / 2); await a.mouse.down(); await a.mouse.move(t.x + t.width / 2, t.y + t.height - 8, { steps: 8 }); await a.mouse.move(t.x + t.width / 2, t.y + t.height - 6); await a.mouse.up(); };
  await pdrag(`.st-seg[data-t="${mokId}"] .hr`, `.st-day[data-day="${plus(4)}"]`);
  await new Promise((r) => setTimeout(r, 700));
  const m2 = await get(`site/p1/tasks/${mokId}`);
  log(m2.start === TODAY && m2.end === plus(4), '막대 끝 잡아 늘리기 → 오늘~4일 뒤 (5일)');
  // 막대 가운데 끌어 옮기기 (+1일) 후 되돌리기
  const segIn = (d) => `.st-day[data-day="${d}"]`;
  await a.waitForSelector(`.st-seg[data-t="${mokId}"]`);
  { // 막대 위 오늘 칸에서 잡아 하루 뒤 칸으로
    const bar = await a.locator(`.st-seg[data-t="${mokId}"] >> nth=0`).boundingBox(), c0 = await a.locator(segIn(TODAY)).boundingBox(), c1 = await a.locator(segIn(plus(1))).boundingBox();
    const y = bar.y + bar.height / 2;
    await a.mouse.move(c0.x + c0.width / 2, y); await a.mouse.down(); await a.mouse.move(c1.x + c1.width / 2, y, { steps: 8 }); await a.mouse.up();
  }
  await new Promise((r) => setTimeout(r, 700));
  const m3 = await get(`site/p1/tasks/${mokId}`);
  log(m3.start === plus(1) && m3.end === plus(5), `막대 끌어 옮기기 → 하루 뒤로, 기간은 그대로 (${m3.start}~${m3.end})`);
  await a.locator(`${li('목공')} .grip`).dragTo(a.locator(`.st-day[data-day="${TODAY}"]`), { force: true }); // 막대 위에 놓아도 됨
  await new Promise((r) => setTimeout(r, 700));
  const m4 = await get(`site/p1/tasks/${mokId}`);
  log(m4.start === TODAY && m4.end === plus(4), '목록에서 다시 놓으면 첫날이 그날이 되게 옮김');
  await a.waitForSelector('.st-wk.now .st-seg.now:has-text("목공")');
  log(true, '캘린더: 이번 주 목공 막대가 색으로');
  await a.waitForFunction(() => /오늘: 목공/.test(document.querySelector('.st-head').innerText), null, { timeout: 5000 }).catch(() => {});
  log(/오늘: 목공/.test(await a.locator('.st-head').innerText()), '머리: "오늘: 목공"');
  // 날짜 눌러 그날 하는 공정 고치기
  await a.locator(`button.st-day[data-day="${TODAY}"]`).click({ position: { x: 12, y: 10 } }); await a.waitForSelector('.st-daypop');
  log(await a.isChecked(`.st-daypop input[data-t="${mokId}"]`), '날짜를 누르면 그날 하는 공정 목록 (목공 켜짐)');
  await a.uncheck(`.st-daypop input[data-t="${mokId}"]`); await new Promise((r) => setTimeout(r, 600));
  log((await get(`site/p1/tasks/${mokId}/minus/${TODAY}`)) === true, '끄면 그날만 쉬는 날');
  await a.check(`.st-daypop input[data-t="${mokId}"]`); await new Promise((r) => setTimeout(r, 600));
  log((await get(`site/p1/tasks/${mokId}/minus/${TODAY}`)) === null, '다시 켜면 하는 날');
  await a.click('.st-daypop [data-close]');
  // 이번 주가 아닌 주의 막대는 회색 (타일: 8~9일 뒤)
  const taId = await a.getAttribute(li('타일'), 'data-t');
  await put(`site/p1/tasks/${taId}/start`, plus(8)); await put(`site/p1/tasks/${taId}/end`, plus(9));
  await a.waitForSelector('.st-seg:has-text("타일")');
  log((await a.locator('.st-seg.now:has-text("타일")').count()) === 0, '이번 주가 아닌 공정 막대는 회색');
  // 진행률: 일정이 지난 날만큼 (철거 3일 지남 / 철거3 + 목공5 + 타일2 + 날짜 없는 8)
  const chId = await a.getAttribute(li('철거'), 'data-t');
  await put(`site/p1/tasks/${chId}/start`, plus(-3)); await put(`site/p1/tasks/${chId}/end`, plus(-1));
  await a.waitForFunction(() => /진행률 17%/.test(document.querySelector('.st-head').innerText));
  log(true, '공정을 등록하면 진행률이 바뀜 (지난 날만큼, 17%)');
  await a.check(`${li('목공')} input.chk`); await a.waitForFunction(() => /진행률 44%/.test(document.querySelector('.st-head').innerText));
  log(true, '완료 체크 → 진행률 올라감 (44%)');
  // 왼쪽에서 공정 추가 · 이름 고치기 · 순서
  await a.fill('#side .st-add input', '필름'); await a.press('#side .st-add input', 'Enter');
  await a.waitForSelector(li('필름'));
  log((await a.locator(`${li('필름')} .dd`).innerText()) === '일정 없음', '왼쪽에서 공정 추가 (Enter)');
  await a.fill(`${li('청소')} input.nmc`, '준공 청소'); await a.locator(`${li('청소')} input.nmc`).press('Tab');
  await a.waitForSelector(li('준공 청소'));
  log(true, '공정 이름 고치기');
  await a.hover(li('설비')); await a.click(`${li('설비')} [data-mv="-1"]`);
  await a.waitForFunction(() => document.querySelector('#side .st-ti input.nmc').value === '설비');
  log(true, '공정 순서 바꾸기 (설비 ↑)');
  await a.screenshot({ path: SH + '/s1-site.png' });
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
  log((await b.locator('#attBtn').count()) === 0 && (await b.locator('#side .st-add').count()) === 0 && (await b.locator('button.st-day').count()) === 0 && (await b.locator('.st-seg.drag').count()) === 0, '소장 아닌 직원: 출근·추가·끌기 없음 (보기만)');
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
  log((await c.locator('#attBtn').count()) === 1 && (await c.locator('#side .st-add').count()) === 1, '관리자: 출근 버튼 + 수정 가능');
  await c.goto(B + 'portal.html'); await c.waitForSelector('#mySiteCard:not(.hidden) .mysite');
  log(/테스트 오피스/.test(await c.locator('#mySiteCard').innerText()) && (await c.locator('#mySiteCard [data-att]').count()) === 1, '관리자: 홈 "오늘 내 현장" 카드 + 출근 버튼');
  // 휴대폰
  const { p: m } = await user('a@test.com', '김테스트', false, { ...devices['iPhone 13'] });
  await m.waitForSelector('.st-head h1'); await m.waitForTimeout(500);
  log(await m.locator('#pick').isVisible(), '휴대폰: 현장 고르기 칸');
  log(await m.locator('.st-mobonly .st-ti').first().isVisible() && (await m.locator('.st-ti[draggable="true"]').count()) === 0 && (await m.locator('.st-seg.drag').count()) === 0, '휴대폰: 공정 목록은 위쪽, 끌기 없음 (날짜 눌러 고치기)');
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
