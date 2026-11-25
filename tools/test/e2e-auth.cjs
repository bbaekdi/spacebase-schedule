// 구글 로그인·회원 관리 화면 시험 (연습용 Firebase). 실행 방법:
// 1) cd firebase && firebase emulators:start --only auth,database --project spacebase-schedule
// 2) cd public && python3 -m http.server 8080 --bind 127.0.0.1
// 3) node tools/test/emu-seed.mjs && node tools/test/e2e-auth.cjs <스크린샷 폴더>
//    (테스트용 가짜 관리자 비밀번호: admin-password-123, 실제 비밀번호 아님)
const { chromium, devices } = require('playwright');
const SH = process.argv[2], B = 'http://127.0.0.1:8080/';
let fails = 0; const log = (ok, m) => { if (!ok) fails++; console.log((ok ? '✓ ' : '✗ ') + m); };
(async () => {
  const br = await chromium.launch();
  const errs = [];
  async function ctx(opt = {}, google = true) {
    const c = await br.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...opt });
    await c.addInitScript((g) => { try { localStorage.setItem('sb_emu', '1'); } catch { return; } if (g) localStorage.setItem('sb_auth', 'google'); localStorage.setItem('sbe_ext_later', String(Date.now())); }, google);
    c.on('page', (p) => { p.on('pageerror', (e) => errs.push(p.url() + ' ' + e.message)); p.on('dialog', (d) => d.accept()); });
    return c;
  }
  const signIn = (p, uid, email, name) => p.evaluate(([uid, email, name]) => firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: uid, email, email_verified: true, name }))), [uid, email, name]);
  const text = (p) => p.locator('#sbAuth .card').innerText().catch(() => '');

  // 1) 관리자: 로그인 화면 → 승인 대기 → 관리자 비밀번호로 들어가기
  const A = await ctx(); const a = await A.newPage();
  await a.goto(B + 'portal.html'); await a.waitForSelector('#sbG');
  await a.screenshot({ path: SH + '/01-login.png' });
  log(true, '로그인 화면 보임');
  await signIn(a, 'uidA', 'admin@test.com', 'Admin Kim');
  await a.waitForFunction(() => /승인을 기다리고/.test(document.body.innerText));
  log(true, '처음 로그인 → 승인 대기');
  await a.click('#sbAdmin');
  await a.fill('input[name=pw]', 'wrong-password-000'); await a.fill('input[name=name]', '김테스트'); await a.click('#sbAuth button.primary');
  await a.waitForFunction(() => /맞지 않아요/.test(document.body.innerText));
  log(true, '틀린 관리자 비밀번호 → 막힘');
  await a.fill('input[name=pw]', 'admin-password-123'); await a.click('#sbAuth button.primary');
  await a.waitForSelector('#wsMembers', { timeout: 15000 });
  log((await a.locator('#wsName').innerText()).includes('김테스트'), '관리자로 들어감, 이름 표시: ' + await a.locator('#wsName').innerText());
  await a.waitForTimeout(1500); await a.screenshot({ path: SH + '/03-home-admin.png' });

  // 2) 직원 B: 가입 신청 → 관리자 승인
  const Bc = await ctx(); const b = await Bc.newPage();
  await b.goto(B + 'portal.html'); await b.waitForSelector('#sbG');
  await signIn(b, 'uidB', 'b@test.com', 'Bee Lee');
  await b.waitForFunction(() => /승인을 기다리고/.test(document.body.innerText));
  await b.screenshot({ path: SH + '/02-pending.png' });
  log(true, '직원 B 승인 대기');
  await a.goto(B + 'members.html'); await a.waitForSelector('#pend tr[data-uid]');
  await a.selectOption('#pend tr[data-uid] select', '이시험');
  await a.screenshot({ path: SH + '/04-members-pending.png', fullPage: true });
  await a.click('#pend tr[data-uid] [data-a=ok]');
  await b.waitForSelector('#wsName:has-text("이시험")', { timeout: 15000 });
  log(true, '승인되자 B 화면이 저절로 넘어감 (이시험)');
  log((await b.locator('#wsMembers').count()) === 0, '일반 직원에게는 회원 관리 링크 없음');

  // 3) 초대 링크로 C 가입
  await a.selectOption('.invName', '박연습'); await a.click('#mkInv');
  await a.waitForSelector('#newInv .link');
  const link = (await a.locator('#newInv .link').innerText()).split('\n').pop().trim();
  log(/\?invite=[A-Za-z0-9_-]{24}$/.test(link), '초대 링크 생김');
  const Cc = await ctx({}, false); const c = await Cc.newPage();
  await c.goto(link.replace(/^https?:\/\/[^/]+\/\?/, B + 'portal.html?')); await c.waitForSelector('#sbG');
  log(/초대 링크로/.test(await text(c)), '초대 링크로 열면 안내 문구');
  await signIn(c, 'uidC', 'c@test.com', 'Cee Park');
  await c.waitForSelector('#wsName:has-text("박연습")', { timeout: 15000 });
  log(true, '초대 링크 → 바로 가입 (박연습)');
  // 같은 링크로 D 시도
  const Dc = await ctx({}, false); const d = await Dc.newPage();
  await d.goto(link.replace(/^https?:\/\/[^/]+\/\?/, B + 'portal.html?')); await d.waitForSelector('#sbG');
  await signIn(d, 'uidD', 'd@test.com', 'Dee');
  await d.waitForFunction(() => /이미 사용한 초대 링크/.test(document.body.innerText));
  log(true, '같은 초대 링크 두 번째 사람 → 막히고 승인 대기');
  await a.waitForTimeout(800); await a.screenshot({ path: SH + '/05-members-all.png', fullPage: true });

  // 4) 주간 스케줄·캘린더 (회원)
  await b.goto(B + 'index.html'); await b.waitForFunction(() => /실시간 연결됨/.test(document.body.innerText), null, { timeout: 15000 });
  log((await b.locator('#me').innerText()).includes('이시험'), '주간 스케줄 열림, 이름표: ' + await b.locator('#me').innerText());
  await b.screenshot({ path: SH + '/06-schedule.png' });
  await b.goto(B + 'calendar.html'); await b.waitForTimeout(2500);
  log(!(await b.locator('#sbAuth:not(.hidden)').count()), '캘린더 열림 (로그인 화면 없음)');

  // 5) 내보내기 → C 바로 나감
  await a.goto(B + 'members.html'); await a.waitForSelector('#mems tr:has-text("c@test.com")');
  await a.click('#mems tr:has-text("c@test.com") [data-a=out]');
  await c.waitForSelector('#sbG', { timeout: 15000 });
  log(true, '내보내기 → C 바로 로그인 화면으로');
  await c.reload(); await c.waitForTimeout(800);
  const cs = await c.evaluate(() => firebase.auth().currentUser);
  if (cs) { await c.waitForFunction(() => /승인을 기다리고/.test(document.body.innerText)); }
  log(true, '내보낸 사람 다시 로그인해도 승인 대기');

  // 6) 휴대폰 화면 + 카카오톡 안 브라우저
  const M = await ctx({ ...devices['iPhone 13'] }); const m = await M.newPage();
  await m.goto(B + 'portal.html'); await m.waitForSelector('#sbG');
  await m.screenshot({ path: SH + '/07-mobile-login.png' });
  const K = await ctx({ ...devices['Galaxy S9+'], userAgent: devices['Galaxy S9+'].userAgent + ' KAKAOTALK 10.4.5' }); const k = await K.newPage();
  await k.goto(B + 'portal.html'); await k.waitForFunction(() => /다른 브라우저로/.test(document.body.innerText));
  await k.screenshot({ path: SH + '/08-kakao.png' });
  log(true, '카카오톡 안에서 열면 바깥 브라우저 안내');
  await Bc.close();
  // 7) 비밀번호 방식(구글 로그인 꺼짐) 그대로 동작
  const P = await ctx({}, false); const pp = await P.newPage();
  await pp.goto(B + 'portal.html'); await pp.waitForTimeout(1500);
  log((await pp.locator('#wsGate:not(.hidden)').count()) === 1 && !(await pp.locator('#sbAuth').count()), '구글 로그인을 안 켜면 예전 회사 비밀번호 화면 그대로');
  // 회원 관리 휴대폰 화면
  const AM = await ctx({ ...devices['iPhone 13'] }); const am = await AM.newPage();
  await am.goto(B + 'members.html'); await am.waitForSelector('#sbG');
  await signIn(am, 'uidA', 'admin@test.com', 'Admin Kim');
  await am.waitForSelector('#mems tbody tr', { timeout: 15000 }); await am.waitForTimeout(800);
  await am.screenshot({ path: SH + '/09-members-mobile.png', fullPage: true });
  console.log('\n페이지 오류:', errs.length ? errs.join('\n') : '없음');
  console.log(fails ? `실패 ${fails}개` : '모두 통과');
  await br.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error('시험 중단:', e.message); process.exit(1); });
