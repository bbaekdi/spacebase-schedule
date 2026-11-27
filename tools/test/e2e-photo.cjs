// Band 사진 올리기·보기 화면 시험 (연습용 Firebase + 가짜 드라이브 중계). 실행 방법은 e2e-band.cjs 와 같음:
// 에뮬레이터 + 로컬 서버를 켠 뒤 node tools/test/emu-seed.mjs && node tools/test/e2e-photo.cjs <스크린샷 폴더>
// 중계(worker/drive.js) 자체는 tools/test/drive.test.mjs 가 시험한다. 여기서는 화면: 고르기·줄이기·올리기·보기·크게 보기·지우기.
const { chromium, devices } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const SH = process.argv[2], B = 'http://127.0.0.1:8080/', DB = 'http://127.0.0.1:9000/', NS = '?ns=spacebase-schedule-default-rtdb';
let fails = 0; const log = (ok, m) => { if (!ok) fails++; console.log((ok ? '✓ ' : '✗ ') + m); };
const put = (p, v) => fetch(DB + p + '.json' + NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(v) });
const get = async (p) => (await fetch(DB + p + '.json' + NS, { headers: { Authorization: 'Bearer owner' } })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 아주 작은 진짜 JPEG (1x1) — 가짜 중계가 "사진"으로 돌려줌
const TINY = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
// JPEG 가로·세로 읽기 (SOF 표시)
function jpegSize(b) { let i = 2; while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + b.readUInt16BE(i + 2); } return null; }

(async () => {
  const br = await chromium.launch(); const errs = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbphoto-'));
  // 시험용 큰 사진 3장 (4000x3000, 잡음 많게 → 줄이기 전엔 수 MB)
  const mk = await br.newPage();
  const big = await mk.evaluate(() => [0, 1, 2].map((n) => { const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const x = c.getContext('2d'); for (let i = 0; i < 4000; i++) { x.fillStyle = `hsl(${(i * 7 + n * 90) % 360} 70% ${30 + (i % 40)}%)`; x.fillRect((i * 37) % 4000, (i * 91) % 3000, 120, 90); } return c.toDataURL('image/jpeg', 0.97).split(',')[1]; }));
  await mk.close();
  const files = big.map((b, i) => { const f = path.join(tmp, `big${i}.jpg`); fs.writeFileSync(f, Buffer.from(b, 'base64')); return f; });
  const tinyF = path.join(tmp, 'tiny.jpg'); fs.writeFileSync(tinyF, TINY);
  log(files.every((f) => fs.statSync(f).size > 1e6), `(준비) 시험 사진 3장은 큰 원본 (${(fs.statSync(files[0]).size / 1e6).toFixed(1)}MB, 4000x3000)`);

  // 가짜 드라이브 중계 (사진 올리기·보기·휴지통) — 모든 화면에 같은 것을 씀
  const S = { ready: false, fail: 0, up: [], trash: [], seq: 0 };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  async function ctx(opt = {}) {
    const c = await br.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, ...opt });
    await c.addInitScript(() => { try { localStorage.setItem('sb_emu', '1'); localStorage.setItem('sb_auth', 'google'); localStorage.setItem('sbe_ext_later', String(Date.now())); localStorage.setItem('sb_install_later', String(Date.now())); } catch {} });
    await c.route('**/drive/**', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      const j = (o, st = 200) => r.fulfill({ status: st, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
      if (u.pathname === '/drive/status') return j({ ready: S.ready });
      if (u.pathname === '/drive/upload') {
        if (S.fail > 0) { S.fail--; return r.fulfill({ status: 502, headers: cors, body: '사진 처리 중 문제가 생겼어요' }); }
        const body = req.postDataBuffer();
        S.up.push({ auth: req.headers().authorization || '', type: req.headers()['content-type'], size: body.length, dim: jpegSize(body), head: [body[0], body[1]], site: u.searchParams.get('site'), day: u.searchParams.get('day') });
        return j({ id: 'FAKEPHOTO' + String(++S.seq).padStart(6, '0'), size: body.length });
      }
      if (u.pathname.startsWith('/drive/photo/')) { if (!(req.headers().authorization || '').startsWith('Bearer ')) return r.fulfill({ status: 401, headers: cors, body: 'x' }); return r.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'image/jpeg' }, body: TINY }); }
      if (u.pathname === '/drive/trash') { S.trash.push(JSON.parse(req.postData() || '{}').post); return j({ trashed: 1 }); }
      return r.fulfill({ status: 404, headers: cors, body: 'nf' });
    });
    return c;
  }
  async function user(email, name, admin, opt = {}) {
    const c = await ctx(opt), p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
    await p.goto(B + 'band.html'); await p.waitForSelector('#sbG');
    const uid = await p.evaluate((email) => firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true }))).then((r) => r.user.uid), email);
    await put('ws/members/' + uid, { name, email, joinedAt: 1 }); if (admin) await put('ws/admins/' + uid, true);
    await p.reload().catch(() => {}); await p.waitForLoadState(); return p;
  }

  // ---- 1) 연결 전에는 사진 칸이 없음 ----
  S.ready = false;
  const a = await user('a@test.com', '김테스트', true);
  await a.waitForSelector('.bd-empty');
  await a.click('#write'); await a.waitForSelector('#dlgWrite[open]'); await sleep(400);
  log((await a.locator('#wPhotos').isHidden()), '사진 보관이 연결 전이면 "사진 추가" 칸이 안 보임');
  await a.click('#dlgWrite [data-close]');

  // ---- 2) 연결 후: 고르기 → 줄이기 ----
  S.ready = true;
  await a.reload().catch(() => {}); await a.waitForSelector('.bd-empty'); await sleep(500);
  await a.click('#write'); await a.waitForSelector('#dlgWrite[open]'); await a.click('#wCats label:has-text("공지·자유글")');
  log(await a.locator('#wPhotos').isVisible(), '연결되면 "📷 사진 추가" 칸이 보임');
  await a.setInputFiles('#wFile', files);
  await a.waitForFunction(() => document.querySelectorAll('.bd-th.ready').length === 3, null, { timeout: 60000 });
  const kb = await a.locator('.bd-th .kb').allInnerTexts();
  log(kb.length === 3 && kb.every((t) => parseInt(t) <= 700 && parseInt(t) > 20), `고른 사진 3장이 올리기 전에 줄어듦 (${kb.join(', ')})`);
  log(/사진 3장/.test(await a.locator('#wPhNote').innerText()), '"사진 3장" 표시');
  await a.screenshot({ path: SH + '/p1-write.png' });
  await a.locator('.bd-th:nth-child(2) [data-rm]').click();
  log((await a.locator('.bd-th').count()) === 2, '사진 ✕ 로 하나 빼기');

  // ---- 3) 올리기 ----
  await a.fill('#fWrite textarea', '사진 테스트 글'); await a.click('#wSave');
  await a.waitForSelector('.bd-post .bd-ph');
  log(S.up.length === 2 && S.up.every((u) => u.auth.startsWith('Bearer ') && u.type === 'image/jpeg' && u.head[0] === 0xff && u.head[1] === 0xd8), '사진 2장이 로그인 확인과 함께 JPEG 로 올라감');
  log(S.up.every((u) => u.size < 700 * 1024 && Math.max(u.dim.w, u.dim.h) === 1920 && Math.abs(u.dim.w / u.dim.h - 4 / 3) < 0.01), `올라간 사진은 긴 쪽 1920픽셀·약 ${Math.round(S.up[0].size / 1024)}KB (원본 ${(fs.statSync(files[0]).size / 1e6).toFixed(1)}MB)`);
  log(S.up.every((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.day)), '오늘 날짜 폴더로 보냄');
  const posts = Object.values((await get('board/posts')) || {}), p1 = posts.find((x) => x.text === '사진 테스트 글');
  const ph = p1 && Object.values(p1.photos || {});
  log(ph && ph.length === 2 && ph.every((x) => /^FAKEPHOTO/.test(x.id) && x.w === 1920 && x.h === 1440 && x.s > 20000), '글에 사진 번호·크기가 저장됨 (사진 파일 자체는 안 저장)');

  // ---- 4) 보기 ----
  await a.waitForFunction(() => document.querySelectorAll('.bd-post .bd-phi.loaded').length === 2, null, { timeout: 15000 });
  log((await a.locator('.bd-post .bd-ph.n2 img[src^="blob:"]').count()) === 2, '글 카드에 사진 2장이 보임 (로그인한 사람이 받아서)');
  await a.screenshot({ path: SH + '/p2-card.png' });
  await a.locator('.bd-post .bd-phi').first().click();
  await a.waitForSelector('#dlgPhoto[open]');
  await a.waitForFunction(() => document.querySelector('#lbImg').getAttribute('src'));
  log((await a.locator('#lbCnt').innerText()) === '1 / 2', '사진을 누르면 크게 보기 (1 / 2)');
  await a.click('.bd-lbn'); log((await a.locator('#lbCnt').innerText()) === '2 / 2', '› 로 다음 사진 (2 / 2)');
  await a.keyboard.press('ArrowLeft'); log((await a.locator('#lbCnt').innerText()) === '1 / 2', '방향키 ← 로 앞 사진');
  await a.screenshot({ path: SH + '/p3-lightbox.png' });
  await a.click('[data-lbx]'); await sleep(200);
  log(!(await a.locator('#dlgPhoto').evaluate((d) => d.open)), '✕ 로 닫기');
  await a.locator('.bd-post').first().locator('.bd-text').click();
  await a.waitForSelector('#dlgPost[open] .bd-ph.big');
  log((await a.locator('#pBody .bd-ph.big .bd-phi').count()) === 2, '글을 열면 사진이 전부 보임');
  await a.click('#dlgPost [data-close]');

  // 다른 직원 화면
  const b = await user('b@test.com', '이시험', false);
  await b.waitForSelector('.bd-post .bd-ph');
  await b.waitForFunction(() => document.querySelectorAll('.bd-post .bd-phi.loaded').length === 2, null, { timeout: 15000 });
  log(true, '다른 직원 화면에도 사진이 보임');

  // ---- 5) 올리기 실패 → 다시 눌러 이어서 ----
  await a.click('#write'); await a.waitForSelector('#dlgWrite[open]'); await a.click('#wCats label:has-text("공지·자유글")');
  await a.setInputFiles('#wFile', [tinyF]); await a.waitForSelector('.bd-th.ready');
  await a.fill('#fWrite textarea', '실패 시험 글');
  S.fail = 99; const upBefore = S.up.length;
  await a.click('#wSave'); await a.waitForFunction(() => /올리지 못했어요/.test(document.querySelector('#wErr').textContent), null, { timeout: 15000 });
  log(S.up.length === upBefore && (await a.locator('#dlgWrite').evaluate((d) => d.open)) && !Object.values((await get('board/posts')) || {}).some((x) => x.text === '실패 시험 글'), '올리기에 실패하면 글은 저장 안 되고 창이 그대로 남음 + 안내');
  log(await a.locator('#wSave').isEnabled() && (await a.locator('#wSave').innerText()) === '올리기', '"올리기" 버튼이 다시 눌림');
  S.fail = 0; await a.click('#wSave'); await a.waitForFunction(() => !document.querySelector('#dlgWrite').open);
  log(Object.values((await get('board/posts')) || {}).some((x) => x.text === '실패 시험 글' && Object.keys(x.photos || {}).length === 1), '다시 누르면 올라가고 글이 저장됨');

  // ---- 6) 글 없이 사진만 / 30장 제한 ----
  await a.click('#write'); await a.waitForSelector('#dlgWrite[open]'); await a.click('#wCats label:has-text("공지·자유글")');
  await a.setInputFiles('#wFile', [tinyF, tinyF]); await a.waitForFunction(() => document.querySelectorAll('.bd-th.ready').length === 2);
  await a.click('#wSave'); await a.waitForFunction(() => !document.querySelector('#dlgWrite').open);
  log(Object.values((await get('board/posts')) || {}).some((x) => x.text === '사진 2장' && Object.keys(x.photos || {}).length === 2), '글 없이 사진만 올려도 됨 ("사진 2장")');
  await a.click('#write'); await a.waitForSelector('#dlgWrite[open]');
  await a.setInputFiles('#wFile', Array(31).fill(tinyF));
  await a.waitForFunction(() => document.querySelectorAll('.bd-th.ready').length === 30, null, { timeout: 60000 });
  log((await a.locator('.bd-th').count()) === 30 && /30장까지/.test(await a.locator('#wErr').innerText()), '한 글에 사진은 30장까지 (31번째는 뺌 + 안내)');
  await a.click('#dlgWrite [data-close]'); await sleep(200);
  log((await a.locator('.bd-th').count()) === 0, '창을 닫으면 고른 사진을 비움');

  // ---- 7) 고치기: 사진은 그대로, 지우기: 드라이브 휴지통 ----
  await a.locator('.bd-post', { hasText: '사진 테스트 글' }).locator('.bd-text').click(); await a.waitForSelector('#dlgPost[open]');
  await a.click('#pBody [data-a=edit]'); await a.waitForSelector('#dlgWrite[open]');
  log(await a.locator('#wPhotos').isHidden(), '글 수정 창에는 사진 추가 칸이 없음');
  await a.fill('#fWrite textarea', '사진 테스트 글 (고침)'); await a.click('#wSave'); await a.waitForFunction(() => !document.querySelector('#dlgWrite').open);
  const ed = Object.values((await get('board/posts')) || {}).find((x) => x.text === '사진 테스트 글 (고침)');
  log(ed && Object.keys(ed.photos || {}).length === 2, '글을 고쳐도 사진은 그대로');
  await a.locator('.bd-post', { hasText: '사진 테스트 글 (고침)' }).locator('.bd-text').click(); await a.waitForSelector('#dlgPost[open]');
  await a.click('#pBody [data-a=del]'); await a.waitForFunction(() => !document.querySelector('#dlgPost').open);
  log(S.trash.length === 0, '글을 지워도 휴지통에 있는 30일 동안은 사진을 그대로 둠');
  await a.goto(B + 'band.html#trash'); await a.waitForSelector('.bd-trashed');
  await a.locator('.bd-trashed', { hasText: '사진 테스트 글 (고침)' }).locator('[data-tr=purge]').click();
  await a.waitForFunction(() => !document.querySelector('.bd-trashed') || ![...document.querySelectorAll('.bd-trashed')].some((x) => /고침/.test(x.innerText)));
  await sleep(500);
  const edId = Object.entries((await get('board/posts')) || {}).find(([, x]) => x.text === '사진 테스트 글 (고침)');
  log(S.trash.length === 1 && !edId, '"완전 삭제"하면 드라이브의 사진도 휴지통으로 보내고 글을 지움');

  // ---- 7-2) 현장 고르기: Site 에 등록된 현장을 나열 ----
  const crypto = require('crypto'), SPACE = crypto.createHash('sha256').update('spacebase:testcode').digest('hex');
  const dot = (d) => d.replace(/-/g, '.'), plusD = (n) => new Date(Date.now() + n * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
  await put(`spaces/${SPACE}/data/groups`, [{ id: 'g1', name: 'PROJECT' }, { id: 'g2', name: '수주 전' }]);
  await put(`spaces/${SPACE}/data/projects`, [
    { id: 'sp1', groupId: 'g1', name: '테스트 오피스', period: `${dot(plusD(-10))}-${dot(plusD(40))}` },
    { id: 'sp2', groupId: 'g1', name: '지난 현장', period: `${dot(plusD(-90))}-${dot(plusD(-30))}` },
    { id: 'sp3', groupId: 'g1', name: '준비 현장', period: '미정' },
    { id: 'sp4', groupId: 'g2', name: '수주 전 현장', period: `${dot(plusD(-5))}-${dot(plusD(5))}` },
  ]);
  await put('board/posts/room1', { cat: 'project', siteName: '테스트 오피스', text: '1. 발주처명 _ 테스트', uid: 'x', name: '박', at: Date.now() - 5000 });
  await put('board/posts/room2', { cat: 'project', siteName: '옛날 프로젝트 글 현장', text: '옛 프로젝트', uid: 'x', name: '박', at: Date.now() - 6000 });
  await a.goto(B + 'band.html'); await a.waitForSelector('.bd-post'); await sleep(800);
  await a.click('#write'); await a.waitForSelector('#dlgWrite[open]'); await a.click('#wCats label:has-text("현장 사진")');
  const opts = await a.locator('#wExtra select[name=site]').evaluate((sel) => [...sel.querySelectorAll('optgroup')].map((g) => ({ label: g.label, items: [...g.querySelectorAll('option')].map((o) => ({ v: o.value, t: o.textContent })) })));
  await a.evaluate(() => { document.querySelector('#wExtra select[name=site]').size = 9; }); await a.screenshot({ path: SH + '/p6-sites.png' }); await a.evaluate(() => { document.querySelector('#wExtra select[name=site]').removeAttribute('size'); });
  const grp = (l) => (opts.find((g) => g.label.startsWith(l)) || { items: [] }).items;
  log(grp('진행 현장').some((x) => x.t === '테스트 오피스' && x.v === 'sp1'), '현장 고르기: Site 의 진행 현장이 나옴');
  log(grp('준비').some((x) => x.t === '준비 현장' && x.v === 'sp3'), '현장 고르기: Site 의 "준비·기간 미정" 현장도 나옴');
  const all = opts.flatMap((g) => g.items.map((x) => x.t));
  log(!all.includes('지난 현장') && !all.includes('수주 전 현장'), '끝난 현장·PROJECT 가 아닌 구분은 안 나옴 (Site 와 같은 기준)');
  log(!all.includes('옛날 프로젝트 글 현장') && all.filter((t) => t === '테스트 오피스').length === 1 && !opts.some((g) => /프로젝트 글/.test(g.label)), '프로젝트 게시판의 글은 현장 고르기에 섞이지 않음 (따로 운영)');
  await a.selectOption('#wExtra select[name=site]', 'sp3'); await a.fill('#fWrite textarea', 'Site 현장 사진 글'); await a.click('#wSave');
  await a.waitForFunction(() => !document.querySelector('#dlgWrite').open);
  const sp = Object.values((await get('board/posts')) || {}).find((x) => x.text === 'Site 현장 사진 글');
  log(sp && sp.siteName === '준비 현장' && sp.site === 'sp3', 'Site 현장을 고르면 그 현장(site)과 이름이 글에 저장됨');
  await a.click('#write'); await a.waitForSelector('#dlgWrite[open]'); await a.click('#wCats label:has-text("현장 사진")');
  await a.selectOption('#wExtra select[name=site]', 'sp1'); await a.setInputFiles('#wFile', [tinyF]); await a.waitForSelector('.bd-th.ready');
  await a.fill('#fWrite textarea', '방 연결 글'); const upN = S.up.length; await a.click('#wSave'); await a.waitForFunction(() => !document.querySelector('#dlgWrite').open);
  const rp = Object.values((await get('board/posts')) || {}).find((x) => x.text === '방 연결 글');
  log(rp && rp.site === 'sp1' && rp.siteName === '테스트 오피스' && S.up.length === upN + 1 && S.up[upN].site === '테스트 오피스', '글이 Site 현장에 붙고, 사진은 그 현장 이름 폴더로 감');
  await a.locator('.bd-post', { hasText: '방 연결 글' }).locator('.bd-site').first().click();
  await a.waitForSelector('.bd-sitecard h1:has-text("테스트 오피스")');
  log((await a.locator('.bd-sitecard').innerText()).includes('현장 사진 1') && (await a.locator('#list .bd-post').count()) === 1 && (await a.locator('#openProj').count()) === 0, '현장 방은 Site 현장 기준 (프로젝트 글과 무관), 그 현장 글만 모아 봄');
  await a.goto(B + 'band.html'); await a.waitForSelector('.bd-post');
  await a.click('#cats button:has-text("프로젝트")');
  log((await a.locator('.bd-post .bd-room').count()) === 0 && (await a.locator('.bd-post').count()) >= 2, '프로젝트 게시판은 현장 방과 따로 (카드에 현장 방 링크 없음)');
  await a.click('#cats button:has-text("전체")');
  await a.locator('.bd-post', { hasText: 'Site 현장 사진 글' }).locator('.bd-text').click(); await a.waitForSelector('#dlgPost[open]');
  await a.click('#pBody [data-a=edit]'); await a.waitForSelector('#dlgWrite[open]');
  log((await a.locator('#wExtra select[name=site]').inputValue()) === 'sp3', '글을 고칠 때 고른 현장이 그대로 선택돼 있음');
  await a.click('#dlgWrite [data-close]');

  // ---- 8) 휴대폰 ----
  const m = await user('m@test.com', '박연습', false, { ...devices['iPhone 13'] });
  await m.waitForSelector('.bd-post .bd-ph'); await sleep(800);
  await m.click('#write'); await m.waitForSelector('#dlgWrite[open]');
  await m.setInputFiles('#wFile', [files[0], files[1]]); await m.waitForFunction(() => document.querySelectorAll('.bd-th.ready').length === 2, null, { timeout: 60000 });
  const ov = await m.evaluate(() => { const d = document.querySelector('#dlgWrite'); return d.scrollWidth - d.clientWidth; });
  log(ov <= 1, `휴대폰 글쓰기 창이 옆으로 밀리지 않음 (넘침 ${ov}px)`);
  await m.screenshot({ path: SH + '/p4-mobile-write.png' });
  await m.click('#dlgWrite [data-close]');
  await m.locator('.bd-post .bd-phi').first().click(); await m.waitForSelector('#dlgPhoto[open]');
  const vp = m.viewportSize(), lbd = await m.locator('#dlgPhoto').boundingBox();
  log((await m.locator('#lbCnt').isVisible()) && lbd.width >= vp.width - 1 && lbd.height >= vp.height - 1, '휴대폰에서 크게 보기가 화면을 가득 채움');
  await m.screenshot({ path: SH + '/p5-mobile-lightbox.png' });

  console.log('\n페이지 오류:', errs.length ? errs.join('\n') : '없음');
  console.log(fails ? `실패 ${fails}개` : '모두 통과');
  fs.rmSync(tmp, { recursive: true, force: true });
  await br.close(); process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error('시험 중단:', e.message); process.exit(1); });
