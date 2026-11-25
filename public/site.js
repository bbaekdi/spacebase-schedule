// Site: 현장 공정 스케줄표 + 출근 (구글 로그인 회원만)
// 현장 목록·소장은 주간 스케줄에서 읽기만 한다. 공정·출근은 Firebase site/<현장id>/... (site-core.js)
// 화면: 왼쪽 = 현장 목록 + 공정 목록(추가·이름·완료·순서·삭제), 오른쪽 = 4주 공정 캘린더(지난주~다다음 주).
// PC: 목록의 공정을 날짜로 끌어다 놓기, 막대 가운데를 끌어 옮기기, 끝을 끌어 늘리기/줄이기. 휴대폰: 날짜를 눌러 그날 공정 켜고 끄기.
(function () {
  const S = SBSite, esc = WS.esc;
  const $ = (s) => document.querySelector(s);
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const H = () => window.SB_HOLIDAYS || {};
  const sundayOf = (d) => S.addDays(d, -S.parse(d).getDay());
  const home = () => S.addDays(sundayOf(S.today()), -7); // 지난주 일요일부터 4주
  let me = null, db = null, sched = { projects: [], groups: [], members: [] }, siteData = {}, cur = null, weekBase = home();
  const canDrag = () => matchMedia('(pointer: fine)').matches && innerWidth > 900;

  const canEdit = (site) => !!me && (me.admin || S.isManager(site, sched.members, me.name));
  const tasksOf = (id) => (siteData[id] && siteData[id].tasks) || {};
  const attendOf = (id) => (siteData[id] && siteData[id].attend) || {};
  const dayCls = (d) => { const w = S.parse(d).getDay(); return w === 0 || H()[d] ? 'red' : w === 6 ? 'blue' : ''; };
  const COLORS = ['#e5484d', '#0f8a6a', '#2f6fd8', '#a33b6b', '#1d1d1b', '#c26a12', '#3f7f2a', '#d4572a', '#7c6be0', '#1e9e7a', '#b8860b', '#5a6b8c'];
  const colorOf = (tl, t) => COLORS[Math.max(0, tl.findIndex((x) => x.id === t.id)) % COLORS.length];
  const lists = () => S.sites(sched);

  // ---------- 왼쪽: 현장 목록 + 공정 목록 ----------
  function sitesHtml() {
    const L = lists();
    const item = (s) => `<a href="#s=${encodeURIComponent(s.id)}" class="${cur && cur.id === s.id ? 'on' : ''}"><span class="dot"></span><span class="nm">${esc(s.name)}</span><span class="pc">${S.progress(tasksOf(s.id))}%</span></a>`;
    return `<h3>진행 현장</h3>${L.active.length ? L.active.map(item).join('') : '<div class="st-none">지금 공사기간인 현장이 없어요.</div>'}
      ${L.undated.length ? `<h3 style="margin-top:14px">준비 · 기간 미정</h3>${L.undated.map(item).join('')}` : ''}
      ${L.past.length ? `<details><summary>지난 현장 (${L.past.length})</summary>${L.past.map(item).join('')}</details>` : ''}`;
  }
  function tasksPanel(mobile) {
    if (!cur) return '';
    const tl = S.taskList(tasksOf(cur.id)), edit = canEdit(cur), drag = edit && !mobile && canDrag();
    const thisWeek = sundayOf(S.today());
    const items = tl.map((t, i) => {
      const ds = S.daysOf(t), now = ds.some((d) => d >= thisWeek && d <= S.addDays(thisWeek, 6));
      return `<li class="st-ti ${t.done ? 'done' : ''}" data-t="${esc(t.id)}" ${drag ? 'draggable="true" title="캘린더 날짜로 끌어다 놓으세요"' : ''}>
        ${drag ? '<span class="grip" aria-hidden="true">⋮⋮</span>' : ''}<input type="checkbox" class="chk" ${t.done ? 'checked' : ''} ${edit ? '' : 'disabled'} aria-label="${esc(t.name)} 완료">
        <i class="dot" style="background:${now && !t.done ? colorOf(tl, t) : '#c9c5b6'}"></i>
        ${edit ? `<input type="text" class="nmc" value="${esc(t.name)}" maxlength="30" aria-label="공정 이름">` : `<span class="nmc">${esc(t.name)}</span>`}
        <span class="dd">${ds.length ? ds.length + '일' : '일정 없음'}</span>
        ${edit ? `<span class="acts"><button type="button" data-mv="-1" ${i ? '' : 'disabled'} aria-label="위로">▲</button><button type="button" data-mv="1" ${i < tl.length - 1 ? '' : 'disabled'} aria-label="아래로">▼</button><button type="button" class="del" data-del aria-label="삭제">✕</button></span>` : ''}
      </li>`;
    }).join('');
    return `<div class="st-tp ${mobile ? 'st-mobonly card' : ''}"><h3>공정 <small>${edit ? (drag ? '캘린더 날짜로 끌어다 놓기' : '날짜를 눌러 그날 공정 고르기') : '보기만 (수정: 소장님·관리자)'}</small></h3>
      ${edit ? '<form class="st-add"><input name="nm" placeholder="+ 공정 추가 (Enter)" maxlength="30" autocomplete="off"><button class="btn" type="submit">추가</button></form>' : ''}
      ${tl.length ? `<ul class="st-tl">${items}</ul>` : '<div class="st-none">아직 공정이 없어요.</div>'}
      ${edit && !tl.length ? '<button class="btn primary st-defbtn" type="button" data-default>기본 공정 목록 넣기</button>' : ''}</div>`;
  }
  function drawSide() { $('#side').innerHTML = sitesHtml() + tasksPanel(false); }
  function pickHtml() {
    const L = lists();
    const opt = (s) => `<option value="${esc(s.id)}" ${cur && cur.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`;
    return `<select class="st-pick" id="pick" aria-label="현장 고르기">${L.active.length ? `<optgroup label="진행 현장">${L.active.map(opt).join('')}</optgroup>` : ''}${L.undated.length ? `<optgroup label="준비 · 기간 미정">${L.undated.map(opt).join('')}</optgroup>` : ''}${L.past.length ? `<optgroup label="지난 현장">${L.past.map(opt).join('')}</optgroup>` : ''}</select>`;
  }

  // ---------- 오른쪽: 현장 머리 + 4주 캘린더 ----------
  function drawMain() {
    const L = lists();
    if (!cur) {
      $('#main').innerHTML = L.all.length ? '<div class="st-empty">왼쪽에서 현장을 골라 주세요.</div>'
        : '<div class="st-empty">주간 스케줄 <b>PROJECT</b> 구분에 현장이 없어요.<br>주간 스케줄에 현장과 공사기간을 넣으면 여기에 나와요.</div>';
      return;
    }
    const s = cur, day = S.today(), tasks = tasksOf(s.id), tl = S.taskList(tasks);
    const mg = S.managers(s, sched.members);
    const pc = S.progress(tasks), nowT = S.todayTasks(tasks, day), nx = S.nextTask(tasks, day);
    const state = s.en && s.en < day ? ['end', '끝남'] : s.st && s.st > day ? ['soon', '준비 중'] : ['', '진행 중'];
    const att = (attendOf(s.id)[day] || {})[me.uid];
    const wk0 = sundayOf(day), weekDays = [...Array(7)].map((_, i) => S.addDays(wk0, i));
    const weekCount = tl.filter((t) => weekDays.some((d) => S.activeOn(t, d))).length;
    const periodText = s.st || s.en ? `${S.yy(s.st) || '?'} ~ ${S.yy(s.en) || '준공일 미정'}` : `공사기간: ${esc(s.period || '미정')}`;
    $('#main').innerHTML = `${pickHtml()}
      <div class="st-head card">
        <div class="tt"><h1>${esc(s.name)}</h1>
          <div class="sub">${periodText} · 진행률 ${pc}%${nowT.length ? ` · 오늘: <b>${nowT.map((t) => esc(t.name)).join(', ')}</b>` : ''}${nx ? ` · 다음: ${esc(nx.t.name)} (D-${S.diffDays(day, nx.day)})` : ''}</div>
          <div class="sub">소장: ${mg.length ? mg.map((m) => esc((m.name + ' ' + m.rank).trim())).join(', ') : '주간 스케줄 "시공 담당"이 비어 있어요'}</div></div>
        <div class="st-attend"><span class="st-badge ${state[0]}">${state[1]}</span>
          ${S.canAttend(s, sched.members, me) && state[0] !== 'end' ? (att ? '<span class="done">✓ 출근함</span>' : '<button class="btn primary" type="button" id="attBtn">출근</button>') : ''}</div>
      </div>
      <div class="st-stats">
        <div class="st-stat"><div class="k">진행 현장</div><div class="v">${L.active.length}</div><div class="s">공사기간 안 (착공 7일 전부터)</div></div>
        <div class="st-stat"><div class="k">오늘 공정</div><div class="v">${nowT.length}<small> 개</small></div><div class="s">${nowT.length ? nowT.map((t) => esc(t.name)).join(', ') : '오늘은 공정이 없어요'}</div></div>
        <div class="st-stat"><div class="k">이번 주 공정</div><div class="v">${weekCount}<small> / ${tl.length}</small></div><div class="s">${S.md(weekDays[0])} ~ ${S.md(weekDays[6])}</div></div>
        <div class="st-stat"><div class="k">진행률</div><div class="v">${pc}<small>%</small></div><div class="st-bar"><i style="width:${pc}%"></i></div><div class="s">공정 일정이 지난 만큼 · 완료 ${tl.filter((t) => t.done).length} / ${tl.length}</div></div>
      </div>
      ${tasksPanel(true)}
      ${calCard(s, tl, canEdit(s))}`;
    const pick = $('#pick'); if (pick) pick.onchange = () => { location.hash = 's=' + encodeURIComponent(pick.value); };
    const ab = $('#attBtn'); if (ab) ab.onclick = doAttend;
  }

  // 4주 캘린더: 이번 주 막대만 공정 색, 나머지 주·완료한 공정은 회색
  function calCard(s, tl, edit) {
    const day = S.today(), att = attendOf(s.id), thisWeek = sundayOf(day), drag = edit && canDrag();
    const weeks = [0, 1, 2, 3].map((k) => [...Array(7)].map((_, i) => S.addDays(weekBase, k * 7 + i)));
    const rows = weeks.map((w) => {
      const isNow = w[0] === thisWeek, segs = [];
      tl.forEach((t) => {
        const ds = S.daysOf(t); if (!ds.length) return;
        const first = ds[0], last = ds[ds.length - 1];
        let st = -1;
        for (let i = 0; i <= 7; i++) {
          const on = i < 7 && S.activeOn(t, w[i]);
          if (on && st < 0) st = i;
          if (!on && st >= 0) { segs.push({ t, a: st, b: i, s: w[st] === first, e: w[i - 1] === last, n: ds.length }); st = -1; }
        }
      });
      const lanes = [];
      segs.forEach((g) => { let l = lanes.findIndex((end) => end <= g.a); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = g.b; g.l = l; });
      const cells = w.map((d) => {
        const a = Object.values(att[d] || {});
        return `<${edit ? 'button type="button"' : 'div'} class="st-day ${d === day ? 'today' : ''}" data-day="${d}"><span class="n ${dayCls(d)}">${+d.slice(8) === 1 || d === w[0] ? `${+d.slice(5, 7)}/${+d.slice(8)}` : +d.slice(8)}</span>${a.length ? '<span class="att">✓ 출근</span>' : ''}</${edit ? 'button' : 'div'}>`;
      }).join('');
      const bars = segs.map((g) => {
        const color = isNow && !g.t.done ? colorOf(tl, g.t) : '';
        return `<span class="st-seg ${color ? 'now' : ''} ${drag ? 'drag' : ''}" data-t="${esc(g.t.id)}" style="left:calc(${(g.a / 7) * 100}% + 3px);width:calc(${((g.b - g.a) / 7) * 100}% - 6px);top:${32 + g.l * 24}px;${color ? 'background:' + color : ''}" title="${esc(g.t.name)} ${g.n}일">${drag && g.s ? '<i class="hl" data-edge="start"></i>' : ''}${esc(g.t.name)}${g.b - g.a > 1 ? ` ${g.n}일` : ''}${drag && g.e ? '<i class="hr" data-edge="end"></i>' : ''}</span>`;
      }).join('');
      return `<div class="st-wk ${isNow ? 'now' : ''}" style="min-height:${Math.max(84, 38 + lanes.length * 24)}px">${cells}${bars}</div>`;
    }).join('');
    const a = weeks[0][0], b = weeks[3][6];
    return `<div class="card st-calcard"><div class="card-h"><div class="st-nav" style="margin-left:0"><button type="button" data-wk="-7" aria-label="한 주 앞">‹</button></div>
      <h2>${S.md(a)} ~ ${S.md(b)} 공정 일정</h2><div class="st-nav" style="margin-left:0"><button type="button" data-wk="7" aria-label="한 주 뒤">›</button><button type="button" data-wk="0">이번 주</button></div>
      <span class="st-ro" style="margin-left:auto">이번 주 공정만 색으로 보여요${edit ? (drag ? ' · 막대를 끌어 옮기고, 끝을 끌어 늘려요 · 날짜를 누르면 그날 공정 고르기' : ' · 날짜를 누르면 그날 공정 고르기') : ''}</span></div>
      <div class="st-scroll"><div class="st-month"><div class="st-wh">${WD.map((d, i) => `<span class="${i === 0 ? 'red' : i === 6 ? 'blue' : ''}">${d}</span>`).join('')}</div>${rows}</div></div></div>`;
  }

  // ---------- 저장 ----------
  const tRef = (id) => db.ref('site/' + cur.id + '/tasks/' + id);
  const stamp = () => ({ by: me.name, at: Date.now() });
  const fail = (e) => alert('저장하지 못했어요: ' + e.message);
  const shiftMap = (m, n) => { if (!m) return null; const o = {}; Object.keys(m).forEach((d) => { o[S.addDays(d, n)] = true; }); return Object.keys(o).length ? o : null; };
  // 공정 전체를 n일 옮기기 (쉬는 날·더한 날도 같이)
  function shiftTask(id, n) {
    const t = tasksOf(cur.id)[id]; if (!t || !n) return;
    return tRef(id).update({ start: t.start ? S.addDays(t.start, n) : null, end: t.end ? S.addDays(t.end, n) : null, plus: shiftMap(t.plus, n), minus: shiftMap(t.minus, n), ...stamp() }).catch(fail);
  }
  // 목록에서 날짜로 놓기: 일정이 없으면 그날 하루, 있으면 첫날이 그날이 되게 옮기기
  function placeTask(id, day) {
    const t = tasksOf(cur.id)[id]; if (!t) return;
    const ds = S.daysOf(t);
    if (!ds.length) return tRef(id).update({ start: day, end: day, ...stamp() }).catch(fail);
    return shiftTask(id, S.diffDays(ds[0], day));
  }
  // 끝 잡아 늘리기/줄이기 (기간 밖의 더한 날·쉬는 날은 정리)
  function resizeTask(id, edge, day) {
    const t = tasksOf(cur.id)[id]; if (!t) return;
    let st = t.start || day, en = t.end || t.start || day;
    if (edge === 'end') en = day < st ? st : day; else st = day > en ? en : day;
    const keep = (m) => { if (!m) return null; const o = {}; Object.keys(m).forEach((d) => { if (d >= st && d <= en) o[d] = true; }); return Object.keys(o).length ? o : null; };
    return tRef(id).update({ start: st, end: en, plus: keep(t.plus), minus: keep(t.minus), ...stamp() }).catch(fail);
  }

  // ---------- 누르기 ----------
  document.addEventListener('click', (e) => {
    if (dayPop && !e.target.closest('.st-daypop') && !e.target.closest('.st-day')) closeDayPop();
    if (!e.target.closest('#side, #main')) return;
    const wk = e.target.closest('[data-wk]');
    if (wk) { weekBase = +wk.dataset.wk ? S.addDays(weekBase, +wk.dataset.wk) : home(); closeDayPop(); return drawMain(); }
    if (!cur || !canEdit(cur)) return;
    const tasks = tasksOf(cur.id);
    const dc = e.target.closest('button.st-day[data-day]'); if (dc) { if (justDragged) return; e.stopPropagation(); return openDayPop(dc); }
    const li = e.target.closest('.st-ti');
    if (li && e.target.closest('[data-del]')) { const t = tasks[li.dataset.t]; if (confirm(`"${t.name}" 공정을 삭제할까요?`)) tRef(li.dataset.t).remove().catch(fail); return; }
    const mv = e.target.closest('[data-mv]');
    if (li && mv) {
      const tl = S.taskList(tasks), i = tl.findIndex((t) => t.id === li.dataset.t), j = i + +mv.dataset.mv;
      if (j < 0 || j >= tl.length) return;
      const up = {}; [tl[i], tl[j]] = [tl[j], tl[i]]; tl.forEach((t, k) => { if ((t.order || 0) !== k + 1) up[t.id + '/order'] = k + 1; });
      return db.ref('site/' + cur.id + '/tasks').update(up).catch(fail);
    }
    if (e.target.closest('[data-default]')) {
      const up = {}; S.DEFAULT_TASKS.forEach((n, i) => { up[db.ref().push().key] = { name: n, order: i + 1, ...stamp() }; });
      return db.ref('site/' + cur.id + '/tasks').update(up).catch(fail);
    }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('.st-add'); if (!f) return;
    e.preventDefault();
    if (!cur || !canEdit(cur)) return;
    const name = f.nm.value.trim().slice(0, 30); if (!name) return;
    const max = Math.max(0, ...S.taskList(tasksOf(cur.id)).map((t) => t.order || 0));
    f.nm.value = '';
    db.ref('site/' + cur.id + '/tasks').push({ name, order: max + 1, ...stamp() }).catch(fail);
  });
  document.addEventListener('change', (e) => {
    if (!cur || !canEdit(cur)) return;
    const li = e.target.closest('.st-ti'); if (!li) return;
    if (e.target.classList.contains('chk')) tRef(li.dataset.t).update({ done: e.target.checked, ...stamp() }).catch(fail);
    if (e.target.classList.contains('nmc')) { const v = e.target.value.trim().slice(0, 30); if (v) tRef(li.dataset.t).update({ name: v, ...stamp() }).catch(fail); else e.target.value = tasksOf(cur.id)[li.dataset.t].name; }
  });

  // ---------- 끌기 (PC) ----------
  const dayAt = (x, y) => { const el = document.elementsFromPoint(x, y).find((n) => n.matches && n.matches('.st-day[data-day]')); return el ? el.dataset.day : null; };
  const mark = (days) => { document.querySelectorAll('.st-day.hl').forEach((c) => c.classList.remove('hl')); (days || []).forEach((d) => { const c = document.querySelector(`.st-day[data-day="${d}"]`); if (c) c.classList.add('hl'); }); };
  // 목록 → 날짜 (HTML 끌어다 놓기)
  document.addEventListener('dragstart', (e) => { const li = e.target.closest && e.target.closest('.st-ti[draggable="true"]'); if (!li) return; e.dataTransfer.setData('text/plain', 'sbtask:' + li.dataset.t); e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
  document.addEventListener('dragend', (e) => { const li = e.target.closest && e.target.closest('.st-ti'); if (li) li.classList.remove('dragging'); mark(); });
  // 막대 위에 놓아도 그 아래 날짜를 찾음
  document.addEventListener('dragover', (e) => { if (!(e.target.closest && e.target.closest('.st-month'))) return; const d = dayAt(e.clientX, e.clientY); if (!d) return; e.preventDefault(); mark([d]); });
  document.addEventListener('drop', (e) => {
    if (!(e.target.closest && e.target.closest('.st-month'))) return;
    const d = dayAt(e.clientX, e.clientY); if (!d) return;
    const v = e.dataTransfer.getData('text/plain') || ''; if (!v.startsWith('sbtask:')) return;
    e.preventDefault(); mark(); placeTask(v.slice(7), d);
  });
  // 막대 옮기기 / 끝 잡아 늘리기
  let drag = null, justDragged = false;
  document.addEventListener('pointerdown', (e) => {
    const seg = e.target.closest && e.target.closest('.st-seg.drag'); if (!seg || e.button !== 0 || !cur) return;
    const day = dayAt(e.clientX, e.clientY); if (!day) return;
    const t = tasksOf(cur.id)[seg.dataset.t]; if (!t) return;
    e.preventDefault();
    drag = { id: seg.dataset.t, edge: (e.target.dataset && e.target.dataset.edge) || null, from: day, to: day, ds: S.daysOf(t), t };
    document.body.classList.add('st-dragging');
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const d = dayAt(e.clientX, e.clientY); if (!d || d === drag.to) return;
    drag.to = d;
    const n = S.diffDays(drag.from, d), ds = drag.ds;
    if (!drag.edge) mark(ds.map((x) => S.addDays(x, n)));
    else { const st = drag.edge === 'start' ? (d > ds[ds.length - 1] ? ds[ds.length - 1] : d) : ds[0], en = drag.edge === 'end' ? (d < ds[0] ? ds[0] : d) : ds[ds.length - 1]; const out = []; for (let x = st; x <= en; x = S.addDays(x, 1)) out.push(x); mark(out); }
  });
  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const g = drag; drag = null; document.body.classList.remove('st-dragging'); mark();
    if (g.to === g.from) { const c = document.querySelector(`.st-day[data-day="${g.from}"]`); if (c && c.tagName === 'BUTTON') { justDragged = true; setTimeout(() => (justDragged = false), 0); openDayPop(c); } return; }
    justDragged = true; setTimeout(() => (justDragged = false), 0);
    if (!g.edge) shiftTask(g.id, S.diffDays(g.from, g.to)); else resizeTask(g.id, g.edge, g.to);
  });

  // ---------- 날짜 누르기: 그날 하는 공정 고르기 ----------
  let dayPop = null;
  const closeDayPop = () => { if (dayPop) { dayPop.remove(); dayPop = null; } };
  function openDayPop(cell) {
    closeDayPop();
    const d = cell.dataset.day, tl = S.taskList(tasksOf(cur.id));
    dayPop = document.createElement('div'); dayPop.className = 'st-cal st-daypop';
    dayPop.innerHTML = `<b>${S.yy(d)} 하는 공정</b>${tl.length ? `<div class="st-dpl">${tl.map((t) => `<label><input type="checkbox" data-t="${esc(t.id)}" ${S.activeOn(t, d) ? 'checked' : ''}><i style="background:${colorOf(tl, t)}"></i>${esc(t.name)}</label>`).join('')}</div>` : '<div class="st-none">왼쪽(휴대폰은 위쪽) 공정 목록에 공정을 먼저 넣어 주세요.</div>'}<div class="st-calf"><span></span><button type="button" data-close>닫기</button></div>`;
    dayPop.addEventListener('click', (e) => { e.stopPropagation(); if (e.target.closest('[data-close]')) closeDayPop(); });
    dayPop.addEventListener('change', (e) => {
      const id = e.target.dataset.t, t = tasksOf(cur.id)[id]; if (!t) return;
      const up = { ...stamp() };
      if (!t.start && !Object.keys(t.plus || {}).length) { up.start = d; up.end = d; } // 일정 없는 공정은 그날로 시작
      else if (S.activeOn(t, d)) { if (t.plus && t.plus[d]) up['plus/' + d] = null; else up['minus/' + d] = true; }
      else { if (t.minus && t.minus[d]) up['minus/' + d] = null; else up['plus/' + d] = true; }
      tRef(id).update(up).catch(fail);
    });
    document.body.append(dayPop);
    const r = cell.getBoundingClientRect();
    dayPop.style.top = window.scrollY + r.bottom + 4 + 'px';
    dayPop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - 308)) + 'px';
  }

  async function doAttend() {
    const b = $('#attBtn'); b.disabled = true;
    try { const r = await S.attend(db, me, cur); if (r.already) alert('오늘은 이미 출근 등록을 했어요.'); }
    catch (e) { alert('출근 등록을 하지 못했어요: ' + e.message); b.disabled = false; }
  }

  // ---------- 시작 ----------
  function route() {
    const id = new URLSearchParams(location.hash.slice(1)).get('s');
    const L = lists();
    cur = L.all.find((s) => s.id === id) || (id ? null : L.active[0] || L.undated[0] || null);
    drawSide(); drawMain();
  }
  window.addEventListener('hashchange', () => { closeDayPop(); route(); });
  // 공정 이름을 쓰는 중이거나 끄는 중이면 다 끝날 때까지 화면을 다시 그리지 않음
  let pending = false;
  function redraw(full) {
    const ae = document.activeElement;
    if (drag || (ae && ae.matches('.st-tp input[type=text]') && ae.dataset.typing === '1')) { pending = true; return; }
    pending = false;
    if (cur) cur = lists().all.find((s) => s.id === cur.id) || cur;
    full ? route() : (drawSide(), drawMain());
  }
  document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('.st-tp input[type=text]')) e.target.dataset.typing = '1'; });
  document.addEventListener('focusout', (e) => { if (e.target.dataset) delete e.target.dataset.typing; setTimeout(() => { if (pending) redraw(true); }, 0); });
  document.addEventListener('pointerup', () => setTimeout(() => { if (pending && !drag) redraw(true); }, 50));
  if (!window.SBAuth || !SBAuth.enabled()) {
    $('#side').style.display = 'none';
    $('#main').innerHTML = `<div class="st-empty"><b>Site 는 지금 시험 중이에요.</b><br>관리자에게 초대받은 분은 아래 버튼을 눌러<br>구글 계정으로 로그인해 주세요.<br><br><a class="btn primary" href="site.html?login=google">구글 로그인으로 들어가기</a></div>`;
    return;
  }
  SBAuth.start().then((a) => {
    me = a; db = firebase.database();
    const base = db.ref('spaces/' + a.spaceKey + '/data');
    const got = new Set();
    ['projects', 'groups', 'members'].forEach((k) => base.child(k).on('value', (s) => { sched[k] = S.list(s.val()); got.add(k); if (got.size === 3) redraw(true); }));
    db.ref('site').on('value', (s) => { siteData = s.val() || {}; if (got.size === 3) redraw(); }, (e) => { $('#main').innerHTML = `<div class="st-empty">불러오지 못했어요: ${esc(e.message)}</div>`; });
  });
})();
