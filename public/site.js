// Site: 현장 공정 스케줄표 + 출근 (구글 로그인 회원만)
// 현장 목록·소장은 주간 스케줄에서 읽기만 한다. 공정·출근은 Firebase site/<현장id>/... (site-core.js)
(function () {
  const S = SBSite, esc = WS.esc;
  const $ = (s) => document.querySelector(s);
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const H = () => window.SB_HOLIDAYS || {};
  let me = null, db = null, sched = { projects: [], groups: [], members: [] }, siteData = {}, cur = null, weekStart = null;

  const mondayOf = (day) => { const w = S.parse(day).getDay(); return S.addDays(day, -((w + 6) % 7)); };
  const canEdit = (site) => !!me && (me.admin || S.isManager(site, sched.members, me.name));
  const tasksOf = (id) => (siteData[id] && siteData[id].tasks) || {};
  const attendOf = (id) => (siteData[id] && siteData[id].attend) || {};
  const dayCls = (d) => { const w = S.parse(d).getDay(); return w === 0 || H()[d] ? 'red' : w === 6 ? 'blue' : ''; };

  // ---------- 현장 목록 ----------
  function lists() { return S.sites(sched); }
  function drawSide() {
    const L = lists();
    const item = (s) => `<a href="#s=${encodeURIComponent(s.id)}" class="${cur && cur.id === s.id ? 'on' : ''}"><span class="dot"></span><span class="nm">${esc(s.name)}</span><span class="pc">${S.progress(tasksOf(s.id))}%</span></a>`;
    $('#side').innerHTML = `<h3>진행 현장</h3>${L.active.length ? L.active.map(item).join('') : '<div class="st-none">지금 공사기간인 현장이 없어요.</div>'}
      ${L.undated.length ? `<h3 style="margin-top:14px">준비 · 기간 미정</h3>${L.undated.map(item).join('')}` : ''}
      ${L.past.length ? `<details><summary>지난 현장 (${L.past.length})</summary>${L.past.map(item).join('')}</details>` : ''}`;
  }
  function pickHtml() {
    const L = lists();
    const opt = (s) => `<option value="${esc(s.id)}" ${cur && cur.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`;
    return `<select class="st-pick" id="pick" aria-label="현장 고르기">${L.active.length ? `<optgroup label="진행 현장">${L.active.map(opt).join('')}</optgroup>` : ''}${L.undated.length ? `<optgroup label="준비 · 기간 미정">${L.undated.map(opt).join('')}</optgroup>` : ''}${L.past.length ? `<optgroup label="지난 현장">${L.past.map(opt).join('')}</optgroup>` : ''}</select>`;
  }

  // ---------- 현장 화면 ----------
  function drawMain() {
    const L = lists();
    if (!cur) {
      $('#main').innerHTML = L.all.length ? '<div class="st-empty">왼쪽에서 현장을 골라 주세요.</div>'
        : '<div class="st-empty">주간 스케줄 <b>PROJECT</b> 구분에 현장이 없어요.<br>주간 스케줄에 현장과 공사기간을 넣으면 여기에 나와요.</div>';
      return;
    }
    const s = cur, day = S.today(), tasks = tasksOf(s.id), tl = S.taskList(tasks), edit = canEdit(s);
    const mg = S.managers(s, sched.members);
    const pc = S.progress(tasks), nowT = S.todayTasks(tasks, day), nx = S.nextTask(tasks, day);
    const state = s.en && s.en < day ? ['end', '끝남'] : s.st && s.st > day ? ['soon', '준비 중'] : ['', '진행 중'];
    const att = (attendOf(s.id)[day] || {})[me.uid];
    const isMg = S.isManager(s, sched.members, me.name);
    const weekDays = [...Array(7)].map((_, i) => S.addDays(weekStart, i));
    const weekCount = tl.filter((t) => weekDays.some((d) => S.activeOn(t, d))).length;
    const periodText = s.st || s.en ? `${S.yy(s.st) || '?'} ~ ${S.yy(s.en) || '준공일 미정'}` : `공사기간: ${esc(s.period || '미정')}`;
    $('#main').innerHTML = `${pickHtml()}
      <div class="st-head card">
        <div class="tt"><h1>${esc(s.name)}</h1>
          <div class="sub">${periodText} · 진행률 ${pc}%${nowT.length ? ` · 오늘: <b>${nowT.map((t) => esc(t.name)).join(', ')}</b>` : ''}${nx ? ` · 다음: ${esc(nx.t.name)} (D-${S.diffDays(day, nx.day)})` : ''}</div>
          <div class="sub">소장: ${mg.length ? mg.map((m) => esc((m.name + ' ' + m.rank).trim())).join(', ') : '주간 스케줄 "시공 담당"이 비어 있어요'}</div></div>
        <div class="st-attend"><span class="st-badge ${state[0]}">${state[1]}</span>
          ${isMg && state[0] !== 'end' ? (att ? `<span class="done">✓ 출근 ${S.hmOf(att.at)}</span>` : '<button class="btn primary" type="button" id="attBtn">출근</button>') : ''}</div>
      </div>
      <div class="st-stats">
        <div class="st-stat"><div class="k">진행 현장</div><div class="v">${L.active.length}</div><div class="s">공사기간 안 (착공 7일 전부터)</div></div>
        <div class="st-stat"><div class="k">오늘 공정</div><div class="v">${nowT.length}<small> 개</small></div><div class="s">${nowT.length ? nowT.map((t) => esc(t.name)).join(', ') : '오늘은 공정이 없어요'}</div></div>
        <div class="st-stat"><div class="k">이번 주 공정</div><div class="v">${weekCount}<small> / ${tl.length}</small></div><div class="s">${S.md(weekDays[0])} ~ ${S.md(weekDays[6])}</div></div>
        <div class="st-stat"><div class="k">진행률</div><div class="v">${pc}<small>%</small></div><div class="st-bar"><i style="width:${pc}%"></i></div><div class="s">완료 ${tl.filter((t) => t.done).length} / ${tl.length} 공정</div></div>
      </div>
      ${weekCard(s, tl, weekDays, edit)}
      ${ganttCard(s, tl)}
      ${tasksCard(s, tl, edit)}`;
    const pick = $('#pick'); if (pick) pick.onchange = () => { location.hash = 's=' + encodeURIComponent(pick.value); };
    const ab = $('#attBtn'); if (ab) ab.onclick = doAttend;
  }

  function weekCard(s, tl, days, edit) {
    const day = S.today(), att = attendOf(s.id);
    const head = days.map((d) => `<div class="h ${dayCls(d)} ${d === day ? 'today' : ''}">${WD[S.parse(d).getDay()]}<small>${S.md(d)}</small></div>`).join('');
    const attRow = `<div class="rl att-l">출근</div>` + days.map((d) => { const a = Object.values(att[d] || {}); return `<div class="att">${a.length ? '✓ ' + esc(S.hmOf(Math.min(...a.map((x) => x.at)))) : ''}</div>`; }).join('');
    const rows = tl.map((t) => `<div class="rl ${t.done ? 'done' : ''}" title="${esc(t.name)}">${esc(t.name)}</div>` + days.map((d) => {
      const on = S.activeOn(t, d), cls = `c ${on ? 'on' : dayCls(d) === 'red' ? 'rest' : ''} ${t.done ? 'done' : ''}`;
      return edit ? `<button type="button" class="${cls}" data-t="${esc(t.id)}" data-d="${d}" aria-label="${esc(t.name)} ${S.md(d)} ${on ? '하는 날' : '안 하는 날'}"></button>` : `<div class="${cls}"></div>`;
    }).join('')).join('');
    return `<div class="card st-week"><div class="card-h"><h2>이번 주 공정</h2><span class="st-range">${S.md(days[0])} — ${S.md(days[6])}</span>
      <div class="st-nav"><button type="button" data-w="-7" aria-label="지난주">‹</button><button type="button" data-w="0">이번 주</button><button type="button" data-w="7" aria-label="다음 주">›</button></div></div>
      ${tl.length ? `<div class="st-scroll"><div class="st-grid"><div class="h">공정</div>${head}${attRow}${rows}</div></div>
      ${edit ? '<div class="st-hint">칸을 누르면 그날 하는 날 ↔ 안 하는 날로 바뀌어요 (쉬는 날, 하루 더 하는 날).</div>' : ''}`
      : `<div class="st-empty" style="padding:24px">아직 공정이 없어요.${edit ? ' 아래 "공정 목록"에서 넣어 주세요.' : ''}</div>`}</div>`;
  }

  function ganttCard(s, tl) {
    const days = [];
    tl.forEach((t) => { if (t.start) days.push(t.start); if (t.end) days.push(t.end); Object.keys(t.plus || {}).forEach((d) => days.push(d)); });
    let a = s.st || days.slice().sort()[0], b = s.en || days.slice().sort().pop();
    if (days.length) { const sd = days.slice().sort(); if (sd[0] < a) a = sd[0]; if (sd[sd.length - 1] > b) b = sd[sd.length - 1]; }
    if (!a || !b || b < a || !tl.length) return `<div class="card st-gantt"><div class="card-h"><h2>전체 공정</h2></div><div class="st-empty" style="padding:24px">공정에 기간을 넣으면 착공부터 준공까지 막대로 보여요.</div></div>`;
    const span = Math.min(S.diffDays(a, b) + 1, 500), pos = (d) => (S.diffDays(a, d) / span) * 100;
    // 그 공정이 하는 날들을 이어 붙여 막대로
    const segs = (t) => {
      const out = []; let st = null;
      for (let i = 0; i <= span; i++) {
        const d = S.addDays(a, i), on = i < span && S.activeOn(t, d);
        if (on && st === null) st = i;
        if (!on && st !== null) { out.push([st, i]); st = null; }
      }
      return out.map(([x, y]) => `<i class="${t.done ? 'done' : ''}" style="left:${(x / span) * 100}%;width:${((y - x) / span) * 100}%" title="${esc(t.name)} ${S.md(S.addDays(a, x))}~${S.md(S.addDays(a, y - 1))}"></i>`).join('');
    };
    const months = []; for (let d = a; d <= b; d = S.addDays(d, 1)) if (d === a || d.endsWith('-01')) months.push(d);
    const today = S.today(), tp = today >= a && today <= b ? pos(today) : null;
    return `<div class="card st-gantt"><div class="card-h"><h2>전체 공정</h2><span class="st-range">${S.md(a)} — ${S.md(b)}</span></div>
      <div class="st-scroll"><div class="st-g">
        <div class="st-g-months"><div></div><div class="m">${months.map((d) => `<span style="left:${pos(d)}%">${+d.slice(5, 7)}월</span>`).join('')}</div></div>
        ${tl.map((t) => `<div class="st-g-row"><div class="rl" title="${esc(t.name)}">${esc(t.name)}</div><div class="st-g-track">${segs(t)}</div></div>`).join('')}
        ${tp !== null ? `<div class="st-g-today" style="left:calc(96px + (100% - 96px) * ${tp / 100})" title="오늘"></div>` : ''}
      </div></div></div>`;
  }

  function tasksCard(s, tl, edit) {
    const dbtn = (t, k, ph) => `<button type="button" class="st-date ${t[k] ? '' : 'empty'} ${k === 'start' ? 'd1' : 'd2'}" data-cal="${k}" data-t="${esc(t.id)}" ${edit ? '' : 'disabled'}>${t[k] ? S.yy(t[k]) : edit ? ph : '-'}</button>`;
    const rows = tl.map((t, i) => `<div class="st-trow" data-t="${esc(t.id)}">
        <input type="checkbox" class="chk" ${t.done ? 'checked' : ''} ${edit ? '' : 'disabled'} aria-label="${esc(t.name)} 완료">
        ${edit ? `<input type="text" class="nmc" value="${esc(t.name)}" maxlength="30" aria-label="공정 이름">` : `<span class="nm nmc ${t.done ? 'done' : ''}">${esc(t.name)}</span>`}
        ${dbtn(t, 'start', '시작일')}<span class="tilde">~</span>${dbtn(t, 'end', '끝일')}
        ${edit ? `<span class="acts"><button type="button" data-mv="-1" ${i ? '' : 'disabled'} aria-label="위로">▲</button><button type="button" data-mv="1" ${i < tl.length - 1 ? '' : 'disabled'} aria-label="아래로">▼</button><button type="button" class="del" data-del aria-label="삭제">✕</button></span>` : '<span></span>'}
      </div>`).join('');
    return `<div class="card st-tasks"><div class="card-h"><h2>공정 목록</h2>${edit ? '' : '<span class="st-ro">보기만 할 수 있어요 (수정: 이 현장 소장님·관리자)</span>'}</div>
      ${tl.length ? rows : '<div class="st-none">아직 공정이 없어요.</div>'}
      ${edit ? `<div class="st-tbtns">${tl.length ? '' : '<button class="btn primary" type="button" id="addDefault">기본 공정 목록 넣기</button>'}<button class="btn" type="button" id="addTask">+ 공정 추가</button></div>` : ''}</div>`;
  }

  // ---------- 수정 ----------
  const tRef = (id) => db.ref('site/' + cur.id + '/tasks/' + id);
  const stamp = () => ({ by: me.name, at: Date.now() });
  const fail = (e) => alert('저장하지 못했어요: ' + e.message);
  $('#main').addEventListener('click', async (e) => {
    const w = e.target.closest('[data-w]'); if (w) { weekStart = +w.dataset.w ? S.addDays(weekStart, +w.dataset.w) : mondayOf(S.today()); return drawMain(); }
    if (!cur || !canEdit(cur)) return;
    const tasks = tasksOf(cur.id);
    const c = e.target.closest('button.c[data-t]');
    if (c) {
      const t = tasks[c.dataset.t], d = c.dataset.d; if (!t) return;
      const up = { ...stamp() };
      if (S.activeOn(t, d)) { if (t.plus && t.plus[d]) up['plus/' + d] = null; else up['minus/' + d] = true; }
      else { if (t.minus && t.minus[d]) up['minus/' + d] = null; else up['plus/' + d] = true; }
      return tRef(c.dataset.t).update(up).catch(fail);
    }
    const cal = e.target.closest('[data-cal]');
    if (cal) {
      const t = tasks[cal.dataset.t], k = cal.dataset.cal;
      return openCal(cal, t[k] || '', k === 'end' ? t.start || '' : '', (v) => {
        if (v && k === 'end' && t.start && v < t.start) return alert('끝일이 시작일보다 빨라요.');
        if (v && k === 'start' && t.end && v > t.end) return alert('시작일이 끝일보다 늦어요.');
        tRef(cal.dataset.t).update({ [k]: v || null, ...stamp() }).catch(fail);
      });
    }
    const row = e.target.closest('.st-trow');
    if (row && e.target.closest('[data-del]')) { const t = tasks[row.dataset.t]; if (confirm(`"${t.name}" 공정을 삭제할까요?`)) tRef(row.dataset.t).remove().catch(fail); return; }
    const mv = e.target.closest('[data-mv]');
    if (row && mv) {
      const tl = S.taskList(tasks), i = tl.findIndex((t) => t.id === row.dataset.t), j = i + +mv.dataset.mv;
      if (j < 0 || j >= tl.length) return;
      const up = {}; [tl[i], tl[j]] = [tl[j], tl[i]]; tl.forEach((t, k) => { if ((t.order || 0) !== k + 1) up[t.id + '/order'] = k + 1; });
      return db.ref('site/' + cur.id + '/tasks').update(up).catch(fail);
    }
    if (e.target.id === 'addDefault') {
      const up = {}; S.DEFAULT_TASKS.forEach((n, i) => { up[db.ref().push().key] = { name: n, order: i + 1, ...stamp() }; });
      return db.ref('site/' + cur.id + '/tasks').update(up).catch(fail);
    }
    if (e.target.id === 'addTask') {
      const name = (prompt('공정 이름 (예: 필름, 금속, 유리)') || '').trim().slice(0, 30); if (!name) return;
      const max = Math.max(0, ...S.taskList(tasks).map((t) => t.order || 0));
      return db.ref('site/' + cur.id + '/tasks').push({ name, order: max + 1, ...stamp() }).catch(fail);
    }
  });
  $('#main').addEventListener('change', (e) => {
    if (!cur || !canEdit(cur)) return;
    const row = e.target.closest('.st-trow'); if (!row) return;
    if (e.target.classList.contains('chk')) tRef(row.dataset.t).update({ done: e.target.checked, ...stamp() }).catch(fail);
    if (e.target.classList.contains('nmc')) { const v = e.target.value.trim().slice(0, 30); if (v) tRef(row.dataset.t).update({ name: v, ...stamp() }).catch(fail); else e.target.value = tasksOf(cur.id)[row.dataset.t].name; }
  });

  async function doAttend() {
    const b = $('#attBtn'); b.disabled = true;
    try { const r = await S.attend(db, me, cur); if (r.already) alert('오늘은 이미 출근 등록을 했어요.'); }
    catch (e) { alert('출근 등록을 하지 못했어요: ' + e.message); b.disabled = false; }
  }

  // ---------- 달력 (일요일·공휴일 빨강, 토요일 파랑) ----------
  let calEl = null;
  const closeCal = () => { if (calEl) { calEl.remove(); calEl = null; } };
  function openCal(btn, value, hint, onPick) {
    closeCal();
    const today = S.today();
    let base = (value || hint || today).slice(0, 7);
    calEl = document.createElement('div'); calEl.className = 'st-cal';
    const draw = () => {
      const [y, m] = base.split('-').map(Number);
      const first = new Date(y, m - 1, 1).getDay(), n = new Date(y, m, 0).getDate();
      let cells = ''; for (let i = 0; i < first; i++) cells += '<span></span>';
      for (let d = 1; d <= n; d++) {
        const k = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells += `<button type="button" data-d="${k}" class="${dayCls(k)} ${k === today ? 'today' : ''} ${k === value ? 'on' : ''}" ${H()[k] ? `title="${esc(H()[k])}"` : ''}>${d}</button>`;
      }
      const hols = Object.keys(H()).filter((k) => k.startsWith(base)).map((k) => `${+k.slice(8)}일 ${esc(H()[k])}`);
      calEl.innerHTML = `<div class="st-calh"><button type="button" data-m="-1" aria-label="이전 달">‹</button><b>${y}년 ${m}월</b><button type="button" data-m="1" aria-label="다음 달">›</button></div>
        <div class="st-calg"><i class="red">일</i><i>월</i><i>화</i><i>수</i><i>목</i><i>금</i><i class="blue">토</i>${cells}</div>
        ${hols.length ? `<div class="st-calhol">${hols.join(' · ')}</div>` : ''}<div class="st-calf"><button type="button" data-x>삭제</button><button type="button" data-today>오늘</button></div>`;
    };
    calEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.m) { const [y, m] = base.split('-').map(Number); const d = new Date(y, m - 1 + +t.dataset.m, 1); base = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; return draw(); }
      const v = t.dataset.d || ('today' in t.dataset ? today : 'x' in t.dataset ? '' : null);
      if (v === null) return;
      closeCal(); onPick(v);
    });
    draw();
    document.body.append(calEl);
    const r = btn.getBoundingClientRect();
    calEl.style.top = window.scrollY + r.bottom + 6 + 'px';
    calEl.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - 308)) + 'px';
  }
  document.addEventListener('click', (e) => { if (calEl && !e.target.closest('.st-cal') && !e.target.closest('[data-cal]')) closeCal(); });

  // ---------- 시작 ----------
  function route() {
    const id = new URLSearchParams(location.hash.slice(1)).get('s');
    const L = lists();
    cur = L.all.find((s) => s.id === id) || (id ? null : L.active[0] || L.undated[0] || null);
    drawSide(); drawMain();
  }
  window.addEventListener('hashchange', () => { closeCal(); route(); });
  // 공정 이름을 고치는 중이면 다 쓸 때까지 화면을 다시 그리지 않음 (다른 사람이 고쳐도 쓰던 글자가 안 지워지게)
  let pending = false;
  function redraw(full) {
    if (document.activeElement && document.activeElement.matches('#main input[type=text]')) { pending = true; return; }
    pending = false; full ? route() : (refreshCur(), drawSide(), drawMain());
  }
  const refreshCur = () => { if (cur) cur = lists().all.find((s) => s.id === cur.id) || cur; };
  $('#main').addEventListener('focusout', () => setTimeout(() => { if (pending) redraw(true); }, 0));
  if (!window.SBAuth || !SBAuth.enabled()) {
    $('#side').style.display = 'none';
    $('#main').innerHTML = `<div class="st-empty"><b>Site 는 지금 시험 중이에요.</b><br>관리자에게 초대받은 분은 아래 버튼을 눌러<br>구글 계정으로 로그인해 주세요.<br><br><a class="btn primary" href="site.html?login=google">구글 로그인으로 들어가기</a></div>`;
    return;
  }
  weekStart = mondayOf(S.today());
  SBAuth.start().then((a) => {
    me = a; db = firebase.database();
    const base = db.ref('spaces/' + a.spaceKey + '/data');
    const got = new Set();
    ['projects', 'groups', 'members'].forEach((k) => base.child(k).on('value', (s) => { sched[k] = S.list(s.val()); got.add(k); if (got.size === 3) redraw(true); }));
    db.ref('site').on('value', (s) => { siteData = s.val() || {}; if (got.size === 3) redraw(); }, (e) => { $('#main').innerHTML = `<div class="st-empty">불러오지 못했어요: ${esc(e.message)}</div>`; });
  });
})();
