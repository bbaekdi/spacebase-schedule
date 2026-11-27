// Site(현장 공정표·일정 등록) 화면 시험 (연습용 Firebase, 가짜 데이터). 실행 방법은 e2e-auth.cjs 와 같음:
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
  // 공정표 한 장 (왼쪽엔 현장 목록만)
  log((await a.locator('#side .st-tp').count()) === 0 && (await a.locator('.gt').count()) === 1, '공정표 (왼쪽엔 현장 목록만)');
  const row = (n) => `tr:has(.nmt:text-is("${n}"))`, cell = (id, d) => `tr[data-t="${id}"] td.d[data-day="${d}"]`;
  // 표준 공정표 넣기: 착공일 기준 날짜 (착공 = 10일 전)
  await a.click('[data-std]'); await a.fill('.gt-std input[name=st]', plus(-10)); await a.click('.gt-std button[type=submit]');
  await a.waitForFunction(() => document.querySelectorAll('tr[data-t]').length === 37);
  log(true, '표준 공정표 넣기 → 공정 37개');
  log((await a.locator('td.cat[rowspan="4"]:has-text("목공사")').count()) === 1 && (await a.locator('td.cat:has-text("보양,철거공사")').count()) === 1, '공종 칸이 세로로 합쳐짐 (목공사 4줄)');
  const mokId = await a.getAttribute(row('벽체 MDF 마감판넬 작업'), 'data-t');
  const m0 = await get(`site/p1/tasks/${mokId}`);
  log(m0.cat === '목공사' && m0.start === plus(-1) && m0.end === plus(3), `표준 날짜: 벽체 MDF = 착공 10~14일째 (${m0.start}~${m0.end})`);
  const wsId = await a.getAttribute(row('위생 설비 공사'), 'data-t'), ws0 = await get(`site/p1/tasks/${wsId}`);
  log(ws0.start === plus(-3) && ws0.end === plus(3) && !!ws0.plus[plus(20)] && !!ws0.plus[plus(21)] && (await a.locator(`tr[data-t="${wsId}"] td.d.on`).count()) === 9, '떨어진 두 기간도 회색 칸 (위생 설비 8~14일 + 31~32일, 9칸)');
  log((await a.locator('thead th.mo').count()) >= 2 && (await a.locator('thead th.dn.td').innerText()) === String(+TODAY.slice(8)) && (await a.locator('thead th.dp.jg').innerText()) === '준공', '머리: 월·일·요일·기간 / 오늘 칸 / 준공 칸');
  log((await a.locator('thead th.dw.red').count()) >= 1 && (await a.locator('thead th.dw.blue').count()) >= 1, '일요일 빨강·토요일 파랑');
  log((await a.locator(`${cell(mokId, TODAY)}`).evaluate((el) => getComputedStyle(el).backgroundColor)).replace(/\s/g, '') !== 'rgb(255,255,255)', '하는 날은 회색 칸');
  log(/오늘 공정[\s\S]*벽체 MDF/.test(await a.locator('.st-stats').innerText()) && !/진행률 \d+%\s*·/.test(await a.locator('.st-head').innerText()), '오늘 하는 공정은 위 카드에 (머리의 긴 한 줄은 없앰)');
  // 공정 목록 고치기 (엑셀처럼): 줄 위/아래 추가 · 삭제 · 이름 · 순서
  await a.click('[data-listedit]');
  const names = async () => a.locator('tr[data-t]').evaluateAll((trs) => trs.map((t) => (t.querySelector('input.nmc') || t.querySelector('.nmt')).value || t.querySelector('.nmt').textContent));
  log((await a.locator('[data-ins]').count()) === 2 * 37 && (await a.locator('.gt-add').count()) === 0, '줄마다 +위 / +아래 버튼 (아래쪽 공정 추가 칸은 없앰)');
  const mdfBo = await a.getAttribute('tr:has(input.nmc[value="천정 MDF보드 작업"])', 'data-t');
  await a.click(`tr[data-t="${mdfBo}"] [data-ins="1"]`);
  await a.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('nmc') && document.activeElement.value === '새 공정');
  let nm = await names();
  log(nm.length === 38 && nm.indexOf('새 공정') === nm.indexOf('천정 MDF보드 작업') + 1, '+아래: 그 줄 바로 아래에 새 줄 (같은 공종), 이름 칸에 바로 커서');
  await a.keyboard.type('필름'); await a.keyboard.press('Tab');
  await a.waitForSelector('tr[data-t] input.nmc[value="필름"]');
  nm = await names();
  log(nm.indexOf('필름') === nm.indexOf('천정 MDF보드 작업') + 1 && (await get(`site/p1/tasks/${await a.getAttribute('tr:has(input.nmc[value="필름"])', 'data-t')}/cat`)) === '목공사', '새 줄 이름을 쓰면 저장 (공종 = 목공사)');
  const fId0 = await a.getAttribute('tr:has(input.nmc[value="필름"])', 'data-t');
  await a.click(`tr[data-t="${fId0}"] [data-ins="-1"]`);
  await a.waitForFunction(() => document.activeElement && document.activeElement.value === '새 공정');
  nm = await names();
  log(nm.length === 39 && nm.indexOf('새 공정') === nm.indexOf('필름') - 1, '+위: 그 줄 바로 위에 새 줄');
  await a.locator('tr:has(input.nmc[value="새 공정"]) [data-del]').click(); await new Promise((r) => setTimeout(r, 600));
  log((await names()).length === 38 && !(await names()).includes('새 공정'), '삭제: 그 줄 지우기 (엑셀처럼)');
  const jb = a.locator('tr[data-t] input.nmc[value="잔손보기"]'); await jb.fill('잔손 보기'); await jb.press('Tab');
  await a.waitForSelector('tr[data-t] input.nmc[value="잔손 보기"]');
  log(true, '공정 이름 고치기');
  const fId = fId0;
  await a.click(`tr[data-t="${fId}"] [data-mv="-1"]`); await a.waitForFunction(async () => true);
  await a.waitForFunction((id) => { const t = [...document.querySelectorAll('tr[data-t]')]; return t.findIndex((x) => x.dataset.t === id) < t.findIndex((x) => /MDF보드/.test(x.innerHTML)); }, fId);
  log(true, '공정 순서 바꾸기 (필름 ↑)');
  await a.click('[data-listedit]'); await a.waitForSelector('tr[data-t] .nmt');
  // 일정 넣기: 일정 없는 공정의 빈 칸을 끌어 칠하기 (오늘 → 2일 뒤)
  const pdrag = async (from, to, hold) => { await a.locator(from).scrollIntoViewIfNeeded(); const f = await a.locator(from).boundingBox(), t = await a.locator(to).boundingBox(); await a.mouse.move(f.x + f.width / 2, f.y + f.height / 2); await a.mouse.down(); await a.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 }); if (hold) return hold(); await a.mouse.up(); await new Promise((r) => setTimeout(r, 700)); };
  await pdrag(cell(fId, TODAY), cell(fId, plus(2)));
  const f1 = await get(`site/p1/tasks/${fId}`);
  log(f1.start === TODAY && f1.end === plus(2), '빈 칸 끌어 칠하기 → 오늘~2일 뒤 (일정 없는 공정만)');
  // 끝 손잡이로 늘리기 (→ 4일 뒤)
  await pdrag(`${cell(fId, plus(2))} .hr`, cell(fId, plus(4)));
  const f2 = await get(`site/p1/tasks/${fId}`);
  log(f2.start === TODAY && f2.end === plus(4), '끝 손잡이 끌어 늘리기 → 오늘~4일 뒤');
  // 회색 칸 끌어 옮기기 (+1일): 끄는 동안 제 모습으로 따라오고 저장은 아직
  await pdrag(cell(fId, TODAY), cell(fId, plus(1)), async () => {
    log((await a.locator(`tr.live[data-t="${fId}"]`).count()) === 1 && (await get(`site/p1/tasks/${fId}/start`)) === TODAY && (await a.locator(`${cell(fId, plus(5))}.on`).count()) === 1, '끄는 동안 회색 칸이 따라 움직임 (놓기 전엔 저장 안 함)');
    await a.screenshot({ path: SH + '/s5-dragging.png' });
    await a.mouse.up(); await new Promise((r) => setTimeout(r, 700));
  });
  const f3 = await get(`site/p1/tasks/${fId}`);
  log(f3.start === plus(1) && f3.end === plus(5), `회색 칸 끌어 옮기기 → 하루 뒤로, 기간은 그대로 (${f3.start}~${f3.end})`);
  await pdrag(cell(fId, plus(1)), cell(fId, TODAY));
  const f4 = await get(`site/p1/tasks/${fId}`);
  log(f4.start === TODAY && f4.end === plus(4), '다시 오늘~4일 뒤로');
  // 일정 있는 공정의 빈 칸을 끌어도 새 일정이 안 생김 (같은 기능은 한 가지 방법)
  await pdrag(cell(mokId, plus(10)), cell(mokId, plus(12)));
  const m1 = await get(`site/p1/tasks/${mokId}`);
  log(m1.start === plus(-1) && m1.end === plus(3) && !m1.plus, '일정 있는 공정의 빈 칸 끌기 → 아무 일 없음');
  // 칸 누르기: 하는 날은 쉬는 날로, 다시 누르면 하는 날 / 기간 밖 빈 칸은 그날 더하기
  await a.click(cell(fId, plus(2))); await new Promise((r) => setTimeout(r, 600));
  log((await get(`site/p1/tasks/${fId}/minus/${plus(2)}`)) === true && (await a.locator(`${cell(fId, plus(2))}.on`).count()) === 0, '칸 누르기: 그날만 쉬는 날');
  await a.click(cell(fId, plus(2))); await new Promise((r) => setTimeout(r, 600));
  log((await get(`site/p1/tasks/${fId}/minus/${plus(2)}`)) === null, '다시 누르면 하는 날');
  await a.click(cell(fId, plus(8))); await new Promise((r) => setTimeout(r, 600));
  log((await get(`site/p1/tasks/${fId}/plus/${plus(8)}`)) === true, '빈 칸 누르기: 그날 더하기');
  await a.click(cell(fId, plus(8))); await new Promise((r) => setTimeout(r, 600));
  // 진행률: 완료 체크하면 올라감
  const pct = async () => +(/(\d+)\s*%/.exec(await a.locator('.st-stat:has-text("진행률") .v').innerText()) || [0, -1])[1];
  const p0 = await pct();
  await a.check(`tr[data-t="${wsId}"] input.chk`); await a.waitForFunction((v) => +(/(\d+)\s*%/.exec([...document.querySelectorAll('.st-stat')].find((x) => /진행률/.test(x.innerText)).querySelector('.v').innerText) || [0, -1])[1] > v, p0);
  log((await a.locator(`tr.done[data-t="${wsId}"]`).count()) === 1, `완료 체크 → 진행률 올라감 (${p0}% → ${await pct()}%)`);
  await a.screenshot({ path: SH + '/s1-site.png' });
  // 일정 지우기: ✕ (공정은 표에 남음)
  await a.hover(`tr[data-t="${fId}"]`); await a.click(`tr[data-t="${fId}"] .x`);
  await new Promise((r) => setTimeout(r, 600));
  const f5 = await get(`site/p1/tasks/${fId}`);
  log(!f5.start && !f5.end && !f5.plus && !f5.minus && f5.name === '필름' && (await a.locator(`tr[data-t="${fId}"]`).count()) === 1 && (await a.locator(`tr[data-t="${fId}"] td.d.on`).count()) === 0, '이름 옆 ✕ → 일정만 지워지고 공정은 표에 남음');
  // 데이터 안 지움: 이전 방식(공종 없음) 공정도 "기타" 로 보임
  await put('site/p1/tasks/old1', { name: '옛날 공정', order: 99, start: TODAY, end: TODAY });
  await a.waitForSelector('tr:has(.nmt:text-is("옛날 공정"))');
  log((await a.locator('td.cat:has-text("기타")').count()) >= 1, '공종 없는 예전 공정도 "기타" 로 보임 (안 사라짐)');
  await a.click('[data-listedit]'); await a.click('tr:has(input.nmc[value="옛날 공정"]) [data-del]'); await new Promise((r) => setTimeout(r, 600));
  log((await get('site/p1/tasks/old1')) === null, '공정 삭제'); await a.click('[data-listedit]');
  // 넓게 보임 · 출근 없음
  const gw = await a.locator('.gt-card').boundingBox();
  log(gw.width > 1040, `공정표가 오른쪽으로 넓게 보임 (${Math.round(gw.width)}px)`);
  log((await a.locator('[data-att], #attBtn, tr.att').count()) === 0 && !/출근/.test(await a.locator('#main').innerText()), '출근 버튼·출근 줄 없음');
  // 착공·준공 고치기: 주간 스케줄 공사기간도 같이 바뀜 (그 현장만, 다른 칸은 그대로)
  const projects = async () => Object.values((await get(`spaces/${SPACE}/data/projects`)) || {});
  const before = (await projects()).find((x) => x.id === 'p1');
  await a.click('[data-per]'); await a.fill('.gt-per input[name=st]', plus(-12)); await a.fill('.gt-per input[name=en]', plus(-20)); await a.click('.gt-per button[type=submit]');
  await new Promise((r) => setTimeout(r, 600));
  log((await projects()).find((x) => x.id === 'p1').period === before.period, '준공일이 착공일보다 빠르면 저장 안 함');
  await a.fill('.gt-per input[name=en]', plus(30)); await a.click('.gt-per button[type=submit]');
  await a.waitForFunction((d) => document.querySelector('table.gt td.d[data-day]').dataset.day === d, plus(-12));
  const after = (await projects()).find((x) => x.id === 'p1');
  log(after.period === dot(plus(-12)) + '-' + dot(plus(30)) && after.name === before.name && after.build === before.build && (await projects()).length === 4, `착공·준공 고치기 → 주간 스케줄 공사기간 "${after.period}" (다른 칸·다른 현장은 그대로)`);
  log((await a.locator('table.gt td.d[data-day]').last().getAttribute('data-day')) === plus(30) && (await a.locator('thead th.dp.jg').innerText()) === '준공', '표 날짜 범위가 새 착공~준공으로 바뀜');
  // 일정 등록: 회사 캘린더에 현장 이름으로 한 건 (다시 눌러도 한 건)
  await a.click('[data-calreg]'); await a.waitForSelector('.st-flash'); await new Promise((r) => setTimeout(r, 500));
  const items1 = (await get(`spaces/${SPACE}/calendar/items`)) || {}, ci = items1['site-p1'];
  log(!!ci && ci.title === '테스트 오피스' && ci.allDay === true && ci.start === new Date(`${plus(-12)}T00:00:00+09:00`).toISOString() && ci.end === new Date(`${plus(31)}T00:00:00+09:00`).toISOString() && ci.by === '김테스트', '일정 등록 → 회사 캘린더에 현장 이름·공사기간 한 건');
  await a.click('[data-calreg]'); await new Promise((r) => setTimeout(r, 700));
  log(Object.keys((await get(`spaces/${SPACE}/calendar/items`)) || {}).filter((k) => k.startsWith('site-')).length === 1, '다시 눌러도 같은 일정 한 건 (중복 없음)');
  await a.goto(B + 'calendar.html'); await a.waitForFunction(() => /테스트 오피스/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  log(/테스트 오피스/.test(await a.locator('body').innerText()), 'Calendar 화면에 현장 일정이 보임');
  await a.goto(B + 'site.html'); await a.waitForSelector('.gt');
  // 큰 날짜 · 수정 버튼
  const fs = await a.locator('.st-per .pd b').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const h1s = await a.locator('.st-head h1').evaluate((e) => parseFloat(getComputedStyle(e).fontSize)), bw = (await a.locator('[data-per]').boundingBox()).width;
  log((await a.locator('.st-per .pd b').count()) === 2 && fs >= 16 && fs < h1s && bw < 70 && (await a.locator('.st-per .pd b').first().innerText()).startsWith(plus(-12).slice(2).replace(/-/g, '.')) && (await a.locator('[data-per]').innerText()) === '수정', '착공·준공 날짜가 따로 보임(현장 이름보다 작게) + 작은 "수정" 버튼');
  // 캘린더: 공정표 위, 3주, "공종 며칠" 만
  const sun = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - x.getDay()); return kst(new Date(x.getTime() + 9 * 3600e3)); };
  const W0 = await a.getAttribute('.st-wk >> nth=0 >> .st-day >> nth=0', 'data-day');
  const cy = (await a.locator('.st-calcard').boundingBox()).y, ty0 = (await a.locator('.gt-card').boundingBox()).y;
  log(cy < ty0, '공정 캘린더가 공정표 위에 있음');
  log((await a.locator('.st-wk').count()) === 3 && W0 === S_add(sun(TODAY), -7), '캘린더 3주: 지난주 · 이번 주 · 다음 주');
  await a.click('[data-wk="7"]'); const W1 = await a.getAttribute('.st-wk >> nth=0 >> .st-day >> nth=0', 'data-day'); await a.click('[data-wk="0"]');
  log(W1 === S_add(W0, 7), '› 누르면 한 주씩 넘어감');
  const segTexts = await a.locator('.st-seg').allInnerTexts();
  log(segTexts.length > 0 && segTexts.every((t) => /^.+ \d+일$/.test(t.trim())) && !segTexts.some((t) => /벽체|설치|작업/.test(t)), `막대는 "공종 며칠" 만 (${segTexts.slice(0, 3).join(' / ')} …)`);
  log((await a.locator('.st-seg[data-cat="전기공사"]').first().innerText()).trim() === '전기공사 19일', '며칠 = 그 공종 공정이 있는 날 (전기공사 19일)');
  const sty = (sel) => a.locator(sel).first().evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, bs: c.borderTopStyle, bc: c.borderTopColor, fg: c.color }; });
  const now = await sty('.st-wk.now .st-seg'), off = await sty('.st-wk:not(.now) .st-seg');
  log(now.bg !== 'rgb(255, 255, 255)' && now.fg !== 'rgb(255, 255, 255)', '이번 주 막대는 파스텔 색이 채워짐 (진한 글씨)');
  log(off.bs === 'dashed' && off.bg === 'rgb(255, 255, 255)' && off.bc === off.fg && off.bc !== 'rgb(255, 255, 255)', '지난주·다음 주 막대는 속이 비고 같은 색 점선');
  // 표 → 캘린더 연동: 표에서 일정 없는 공정에 날짜를 칠하면 그 공종 막대가 바로 생김
  await a.locator('.gt-card').scrollIntoViewIfNeeded();
  const cover = async (cat, d) => a.evaluate(([cat, d]) => { const c = document.querySelector(`.st-month .st-day[data-day="${d}"]`).getBoundingClientRect(); return [...document.querySelectorAll(`.st-seg[data-cat="${cat}"]`)].some((b) => { const r = b.getBoundingClientRect(); return r.left <= c.left + c.width / 2 && r.right >= c.left + c.width / 2 && r.top >= c.top && r.bottom <= c.bottom + 200 && r.top < c.bottom; }); }, [cat, d]);
  log(!(await cover('목공사', plus(7))), '(준비) 7일 뒤에는 목공사 막대가 없음');
  await pdrag(cell(fId, plus(7)), cell(fId, plus(8)));
  await a.waitForFunction(([cat, d]) => { const c = document.querySelector(`.st-month .st-day[data-day="${d}"]`).getBoundingClientRect(); return [...document.querySelectorAll(`.st-seg[data-cat="${cat}"]`)].some((b) => { const r = b.getBoundingClientRect(); return r.left <= c.left + c.width / 2 && r.right >= c.left + c.width / 2 && r.top < c.bottom && r.bottom > c.top; }); }, ['목공사', plus(7)]);
  log(true, '표에서 칠하면 캘린더 막대가 바로 생김 (연동)');
  // 캘린더 → 표 연동: 막대를 끌면 그 공종의 공정이 모두 같이 옮겨짐
  const elec = ['전열,전등라인 배선 배관', '등기구 설치', '콘센트 외 기구 설치'];
  const ids = []; for (const n of elec) ids.push(await a.getAttribute(row(n), 'data-t'));
  const st0 = []; for (const id of ids) st0.push(await get(`site/p1/tasks/${id}/start`));
  await a.evaluate(() => document.querySelector('.st-calcard').scrollIntoView({ block: 'center' }));
  const bb = await a.locator('.st-wk.now .st-seg[data-cat="전기공사"] >> nth=0').boundingBox(), cc0 = await a.locator(`.st-month .st-day[data-day="${TODAY}"]`).boundingBox(), cc1 = await a.locator(`.st-month .st-day[data-day="${plus(1)}"]`).boundingBox();
  const yy0 = bb.y + bb.height / 2;
  await a.mouse.move(cc0.x + cc0.width / 2, yy0); await a.mouse.down(); await a.mouse.move(cc1.x + cc1.width / 2, cc1.y + (yy0 - cc0.y), { steps: 8 });
  const liveRows = await a.locator('tr.live').count(), liveBars = await a.locator('.st-seg.live').count();
  log(liveRows === 3 && liveBars >= 1 && (await get(`site/p1/tasks/${ids[0]}/start`)) === st0[0], '끄는 동안 막대와 표의 그 공종 공정 3줄이 같이 움직임 (놓기 전엔 저장 안 함)');
  await a.screenshot({ path: SH + '/s5-dragging.png' });
  await a.mouse.up(); await new Promise((r) => setTimeout(r, 800));
  const st1 = []; for (const id of ids) st1.push(await get(`site/p1/tasks/${id}/start`));
  log(st1.every((v, i) => v === S_add(st0[i], 1)), '막대 끌기 → 그 공종의 공정이 모두 하루씩 뒤로 (표에도 반영)');
  log(await a.locator(`${cell(ids[0], st1[0])}.on`).count() === 1 && (await a.locator(`${cell(ids[0], st0[0])}.on`).count()) === 0, '표의 회색 칸도 같이 옮겨짐');
  await a.screenshot({ path: SH + '/s1-site.png' });
  await put(`site/p1/tasks/${fId}/start`, null); await put(`site/p1/tasks/${fId}/end`, null); await new Promise((r) => setTimeout(r, 600)); // 뒤 시험을 위해 필름 일정 지움
  // 다른 직원 (소장 아님)
  const { p: b } = await user('b@test.com', '이시험', false);
  await b.waitForSelector('.st-head h1');
  log((await b.locator('[data-calreg]').count()) === 0 && (await b.locator('[data-per]').count()) === 0 && (await b.locator('.st-seg.drag').count()) === 0 && (await b.locator('[data-std]').count()) === 0 && (await b.locator('.gt-add').count()) === 0 && (await b.locator('.gt.edit').count()) === 0 && (await b.locator('.gt .nmw .x').count()) === 0 && (await b.locator('.gt input.chk').count()) === 0, '소장 아닌 직원: 일정 등록·기간 고치기·추가·끌기 없음 (보기만)');
  log((await b.locator('.gt td.d.on').count()) > 0 && (await b.locator('.st-seg').count()) > 0, '다른 직원도 표·캘린더를 봄');
  await b.goto(B + 'band.html'); await b.waitForTimeout(1500);
  await put('board/posts/old_att', { cat: 'attend', text: '옛 출근 글', siteName: '테스트 오피스', uid: 'x', name: '옛', at: 5, commentCount: 0 });
  await b.reload().catch(() => {}); await b.waitForTimeout(1500);
  log(!/옛 출근 글/.test(await b.locator('#list').innerText()) && (await b.locator('#cats button:has-text("출근")').count()) === 0, 'Band 에 "출근" 게시판 없음 (옛 글은 안 보이고 데이터는 보관)');
  log((await get('board/posts/old_att')) !== null, '옛 출근 글 데이터는 지워지지 않음');
  await b.click('#write');
  await b.click('#dlgWrite [data-close]');
  // 홈 카드
  await a.goto(B + 'portal.html'); await a.waitForSelector('#mySiteCard:not(.hidden) .mysite');
  log(/테스트 오피스[\s\S]*오늘: [\s\S]*벽체 MDF/.test(await a.locator('#mySiteCard').innerText()) && (await a.locator('#mySiteCard [data-att]').count()) === 0 && !/출근/.test(await a.locator('#mySiteCard').innerText()), '홈 "오늘 내 현장": 오늘 공정 (출근 버튼 없음)');
  await a.waitForTimeout(800); await a.screenshot({ path: SH + '/s2-home.png' });
  await b.goto(B + 'portal.html'); await b.waitForTimeout(2000);
  log(await b.locator('#mySiteCard').isHidden(), '소장 아닌 직원은 "오늘 내 현장" 카드 없음');
  // 관리자 (소장 아님): 일정 등록 버튼·오늘 내 현장 카드 보임
  const { p: c } = await user('c@test.com', '박관리', true);
  await c.waitForSelector('.st-head h1');
  log((await c.locator('[data-calreg]').count()) === 1 && (await c.locator('[data-std]').count()) === 1 && (await c.locator('[data-per]').count()) === 1, '관리자: 일정 등록 · 기간 고치기 · 수정 가능');
  await c.goto(B + 'portal.html'); await c.waitForSelector('#mySiteCard:not(.hidden) .mysite');
  log(/테스트 오피스/.test(await c.locator('#mySiteCard').innerText()), '관리자: 홈 "오늘 내 현장" 카드');
  // 휴대폰
  const { p: m } = await user('a@test.com', '김테스트', false, { ...devices['iPhone 13'] });
  await m.waitForSelector('.st-head h1'); await m.waitForTimeout(500);
  log(await m.locator('#pick').isVisible(), '휴대폰: 현장 고르기 칸');
  log((await m.locator('.gt').count()) === 1 && (await m.locator('.gt.drag').count()) === 0 && (await m.locator('.gt.edit').count()) === 1, '휴대폰: 같은 공정표 (끌기 없음, 칸 누르기)');
  const mf = fId;
  await m.locator(`tr[data-t="${mf}"] td.d[data-day="${TODAY}"]`).scrollIntoViewIfNeeded();
  await m.locator(`tr[data-t="${mf}"] td.d[data-day="${TODAY}"]`).tap(); await new Promise((r) => setTimeout(r, 700));
  const mf1 = await get(`site/p1/tasks/${mf}`);
  log(mf1.start === TODAY && mf1.end === TODAY, '휴대폰 칸 누르기: 일정 없는 공정은 그날로 시작');
  await m.locator(`tr[data-t="${mf}"] .x`).first().tap(); await new Promise((r) => setTimeout(r, 700));
  log(!(await get(`site/p1/tasks/${mf}/start`)), '휴대폰: ✕ 로 일정 지우기');
  log((await m.locator('.st-wk').count()) === 3 && (await m.locator('.st-seg.drag').count()) === 0 && (await m.locator('.st-seg').count()) > 0, '휴대폰: 3주 캘린더는 보기만');
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
