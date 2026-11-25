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
