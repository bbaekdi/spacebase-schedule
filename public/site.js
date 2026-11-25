// Site: 현장 공정 스케줄표 + 출근 (구글 로그인 회원만)
// 현장 목록·소장은 주간 스케줄에서 읽기만 한다. 공정·출근은 Firebase site/<현장id>/... (site-core.js)
// 화면: 왼쪽 = 현장 목록, 오른쪽 = 회사 공정표 양식 같은 표 (공종 · 공종 상세 · 공사기간 날짜 칸, 하는 날은 회색 칸).
// 같은 기능은 한 가지 방법만 — PC: 빈 칸 끌기 = 일정 넣기(일정 없는 공정), 회색 칸 끌기 = 옮기기, 끝 손잡이 = 늘리기·줄이기,
//   ✕ = 일정 지우기, 칸 누르기 = 그날 켜고 끄기. 휴대폰: 칸 누르기 = 그날 켜고 끄기(일정 없는 공정은 그날로 시작), ✕ = 지우기.
(function () {
  const S = SBSite, esc = WS.esc;
  const $ = (s) => document.querySelector(s);
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const H = () => window.SB_HOLIDAYS || {};
  const sundayOf = (d) => S.addDays(d, -S.parse(d).getDay());
  let me = null, db = null, sched = { projects: [], groups: [], members: [] }, siteData = {}, cur = null;
  let listEdit = false, stdOpen = false, scrolledFor = null;
  const canDrag = () => matchMedia('(pointer: fine)').matches && innerWidth > 900;
  let preview = null; // 끄는 동안 그 공정의 바뀐 모습 {id, task}
  const withPreview = (tl) => (preview ? tl.map((t) => (t.id === preview.id ? { ...t, ...preview.task, id: t.id } : t)) : tl);

  const canEdit = (site) => !!me && (me.admin || S.isManager(site, sched.members, me.name));
  const tasksOf = (id) => (siteData[id] && siteData[id].tasks) || {};
  const attendOf = (id) => (siteData[id] && siteData[id].attend) || {};
  const dayCls = (d) => { const w = S.parse(d).getDay(); return w === 0 || H()[d] ? 'red' : w === 6 ? 'blue' : ''; };
  const lists = () => S.sites(sched);
  const catOf = (t) => String(t.cat || '').trim() || '기타';

  // ---------- 왼쪽: 현장 목록 ----------
  function sitesHtml() {
    const L = lists();
    const item = (s) => `<a href="#s=${encodeURIComponent(s.id)}" class="${cur && cur.id === s.id ? 'on' : ''}"><span class="dot"></span><span class="nm">${esc(s.name)}</span><span class="pc">${S.progress(tasksOf(s.id))}%</span></a>`;
    return `<h3>진행 현장</h3>${L.active.length ? L.active.map(item).join('') : '<div class="st-none">지금 공사기간인 현장이 없어요.</div>'}
      ${L.undated.length ? `<h3 style="margin-top:14px">준비 · 기간 미정</h3>${L.undated.map(item).join('')}` : ''}
      ${L.past.length ? `<details><summary>지난 현장 (${L.past.length})</summary>${L.past.map(item).join('')}</details>` : ''}`;
  }
  function drawSide() { $('#side').innerHTML = sitesHtml(); }
  function pickHtml() {
    const L = lists();
    const opt = (s) => `<option value="${esc(s.id)}" ${cur && cur.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`;
    return `<select class="st-pick" id="pick" aria-label="현장 고르기">${L.active.length ? `<optgroup label="진행 현장">${L.active.map(opt).join('')}</optgroup>` : ''}${L.undated.length ? `<optgroup label="준비 · 기간 미정">${L.undated.map(opt).join('')}</optgroup>` : ''}${L.past.length ? `<optgroup label="지난 현장">${L.past.map(opt).join('')}</optgroup>` : ''}</select>`;
  }

  // ---------- 오른쪽: 현장 머리 + 공정표 ----------
  function drawMain() {
    const L = lists();
    if (!cur) {
      $('#main').innerHTML = L.all.length ? '<div class="st-empty">왼쪽에서 현장을 골라 주세요.</div>'
        : '<div class="st-empty">주간 스케줄 <b>PROJECT</b> 구분에 현장이 없어요.<br>주간 스케줄에 현장과 공사기간을 넣으면 여기에 나와요.</div>';
      return;
    }
    const keep = $('.gt-scroll'), sl = keep ? keep.scrollLeft : null;
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
      ${gtCard(s, tl, canEdit(s))}`;
    const pick = $('#pick'); if (pick) pick.onchange = () => { location.hash = 's=' + encodeURIComponent(pick.value); };
    const ab = $('#attBtn'); if (ab) ab.onclick = doAttend;
    // 옆으로 밀어 둔 자리 유지, 처음 열 때는 오늘이 보이게
    const sc = $('.gt-scroll');
    if (sc) {
      if (sl !== null && scrolledFor === s.id) sc.scrollLeft = sl;
      else { scrolledFor = s.id; const td = sc.querySelector('thead th.td'); if (td) sc.scrollLeft = Math.max(0, td.offsetLeft - sc.clientWidth / 2); }
    }
  }

  // 표에 보일 날짜: 공사기간 전체 (공정이 기간 밖에 있으면 그만큼 넓힘)
  function daysRange(s, tl) {
    const ds = tl.flatMap((t) => S.daysOf(t)).sort();
    let a = s.st || ds[0] || S.today(), b = s.en || ds[ds.length - 1] || S.addDays(a, 34);
    if (ds.length) { if (ds[0] < a) a = ds[0]; if (ds[ds.length - 1] > b) b = ds[ds.length - 1]; }
    if (b < a) b = a;
    if (S.diffDays(a, b) > 240) b = S.addDays(a, 240);
    const out = []; for (let d = a; d <= b; d = S.addDays(d, 1)) out.push(d);
    return out;
  }
  // 공종별로 묶기 (공정 순서대로, 공종이 처음 나온 자리에)
  function groupsOf(tl) {
    const m = new Map();
    tl.forEach((t) => { const c = catOf(t); if (!m.has(c)) m.set(c, []); m.get(c).push(t); });
    return [...m];
  }

  function gtCard(s, tlRaw, edit) {
    const tl = tlRaw, drag = edit && canDrag();
    const help = !edit ? '보기만 (수정: 소장님·관리자)' : listEdit ? '공종·공정 이름, 순서, 삭제를 고쳐요' : drag ? '빈 칸을 끌어 일정 넣기 · 회색 칸을 끌어 옮기기 · 끝을 끌어 늘리기 · ✕ 지우기 · 칸 누르기 = 그날 켜고 끄기' : '칸을 눌러 그날 켜고 끄기 · ✕ 지우기';
    return `<div class="card gt-card"><div class="card-h"><h2>공정표</h2><span class="st-ro">${help}</span>
        <span class="gt-btns">${edit ? `<button type="button" class="btn ${listEdit ? 'primary' : ''}" data-listedit>${listEdit ? '다 고쳤어요' : '공정 목록 고치기'}</button><button type="button" class="btn" data-std>표준 공정표 넣기</button>` : ''}<button type="button" class="btn" data-print>인쇄</button></span></div>
      ${stdOpen && edit ? stdForm(s, tl) : ''}
      <div class="gt-ptitle"><b>INTERIOR PROGRESS SCHEDULE</b><span>공 사 명 : ${esc(s.name)}</span></div>
      <div class="gt-scroll">${gtTable(s, withPreview(tl), edit)}</div>
      ${edit && (listEdit || !tl.length) ? addForm(tl) : ''}
      ${!tl.length ? `<div class="st-none" style="margin-top:10px">아직 공정이 없어요. ${edit ? '"표준 공정표 넣기"를 누르면 회사 공정표의 공종·공정이 착공일 기준 날짜로 들어가요.' : ''}</div>` : ''}
    </div>`;
  }
  function stdForm(s, tl) {
    return `<form class="gt-std"><b>표준 공정표 넣기</b><span>회사 공정표의 공정 ${S.STD_TASKS.length}개를 착공일부터 36일 일정으로 넣어요.${tl.length ? ' 이름이 같은 공정은 날짜만 바꾸고, 다른 공정은 그대로 둬요.' : ''}</span>
      <label>착공일 <input type="date" name="st" value="${esc(s.st || S.today())}" required></label><button class="btn primary" type="submit">넣기</button><button class="btn" type="button" data-stdclose>취소</button></form>`;
  }
  function addForm(tl) {
    const cats = [...new Set(tl.map(catOf))];
    return `<form class="st-add gt-add"><input name="cat" list="gtCats" placeholder="공종 (예: 목공사)" maxlength="20" autocomplete="off"><input name="nm" placeholder="+ 공정 추가 (Enter)" maxlength="30" autocomplete="off"><button class="btn" type="submit">추가</button>
      <datalist id="gtCats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></form>`;
  }

  function gtTable(s, tl, edit) {
    const day = S.today(), days = daysRange(s, tl), drag = edit && canDrag(), att = attendOf(s.id);
    const jg = s.en, n0 = s.st; // 준공일 (빨간 줄), 기간 번호는 착공일부터
    const colCls = (d) => [d === day ? 'td' : '', d === jg ? 'jg' : '', S.parse(d).getDay() === 0 ? 'wk' : ''].join(' ');
    // 머리: 월 / 일 / 요일 / 기간
    const months = []; days.forEach((d) => { const m = +d.slice(5, 7); if (!months.length || months[months.length - 1].m !== m) months.push({ m, n: 0 }); months[months.length - 1].n++; });
    const head = `<thead><tr><th rowspan="4" class="cat">공종</th><th rowspan="4" class="nm">공종 상세</th>${months.map((m) => `<th colspan="${m.n}" class="mo">${m.m}월</th>`).join('')}</tr>
      <tr>${days.map((d) => `<th class="dn ${dayCls(d)} ${colCls(d)}">${+d.slice(8)}</th>`).join('')}</tr>
      <tr>${days.map((d) => `<th class="dw ${dayCls(d)} ${colCls(d)}">${WD[S.parse(d).getDay()]}</th>`).join('')}</tr>
      <tr>${days.map((d) => { const n = n0 ? S.diffDays(n0, d) + 1 : 0; return `<th class="dp ${colCls(d)}">${d === jg ? '준공' : n > 0 ? n : ''}</th>`; }).join('')}</tr></thead>`;
    const groups = groupsOf(tl);
    const rows = groups.map(([cat, ts]) => ts.map((t, k) => {
      const ds = S.daysOf(t), last = ds[ds.length - 1];
      const cells = days.map((d) => {
        const on = S.activeOn(t, d);
        const hl = drag && on && d === t.start ? '<i class="hl" data-edge="start"></i>' : '';
        const hr = drag && on && d === (t.end || t.start) ? '<i class="hr" data-edge="end"></i>' : '';
        const x = edit && !listEdit && d === last ? '<i class="x" data-clear title="일정 지우기">✕</i>' : '';
        return `<td class="d ${on ? 'on' : ''} ${colCls(d)}" data-day="${d}">${hl}${hr}${x}</td>`;
      }).join('');
      const catCell = listEdit && edit ? `<td class="cat"><input type="text" class="catc" value="${esc(t.cat || '')}" list="gtCats" maxlength="20" placeholder="기타" aria-label="공종"></td>`
        : k === 0 ? `<td class="cat" rowspan="${ts.length}">${esc(cat)}</td>` : '';
      const i = tl.findIndex((x) => x.id === t.id);
      const nmCell = listEdit && edit
        ? `<td class="nm"><div class="nmw"><input type="text" class="nmc" value="${esc(t.name)}" maxlength="30" aria-label="공정 이름"><span class="acts"><button type="button" data-mv="-1" ${i ? '' : 'disabled'} aria-label="위로">▲</button><button type="button" data-mv="1" ${i < tl.length - 1 ? '' : 'disabled'} aria-label="아래로">▼</button><button type="button" class="del" data-del aria-label="삭제">삭제</button></span></div></td>`
        : `<td class="nm"><div class="nmw">${edit ? `<input type="checkbox" class="chk" ${t.done ? 'checked' : ''} aria-label="${esc(t.name)} 완료" title="완료">` : t.done ? '<span class="ok">✓</span>' : ''}<span class="nmt" title="${esc(t.name)}">${esc(t.name)}</span></div></td>`;
      return `<tr class="${k === 0 ? 'g1' : ''} ${t.done ? 'done' : ''} ${preview && preview.id === t.id ? 'live' : ''}" data-t="${esc(t.id)}">${catCell}${nmCell}${cells}</tr>`;
    }).join('')).join('');
    const attRow = `<tr class="att g1"><td class="cat" colspan="2">출근</td>${days.map((d) => { const a = Object.values(att[d] || {}); return `<td class="d ${colCls(d)}" ${a.length ? `title="${esc(a.map((x) => x.name).join(', '))}"` : ''}>${a.length ? '✓' : ''}</td>`; }).join('')}</tr>`;
    return `<table class="gt ${drag && !listEdit ? 'drag' : ''} ${edit && !listEdit ? 'edit' : ''}" style="--n:${days.length}"><colgroup><col class="c-cat"><col class="c-nm">${days.map(() => '<col class="c-d">').join('')}</colgroup>${head}<tbody>${rows}${attRow}</tbody></table>`;
  }

  // ---------- 저장 ----------
  const tRef = (id) => db.ref('site/' + cur.id + '/tasks/' + id);
  const stamp = () => ({ by: me.name, at: Date.now() });
  const fail = (e) => alert('저장하지 못했어요: ' + e.message);
  const shiftMap = (m, n) => { if (!m) return null; const o = {}; Object.keys(m).forEach((d) => { o[S.addDays(d, n)] = true; }); return Object.keys(o).length ? o : null; };
  // 공정 전체를 n일 옮긴 모습 (쉬는 날·더한 날도 같이)
  const shifted = (t, n) => ({ start: t.start ? S.addDays(t.start, n) : null, end: t.end ? S.addDays(t.end, n) : null, plus: shiftMap(t.plus, n), minus: shiftMap(t.minus, n) });
  // 일정 지우기 (공정 이름은 표에 남음)
  function clearSchedule(id) {
    const t = tasksOf(cur.id)[id]; if (!t) return;
    if (!confirm(`"${t.name}" 일정을 지울까요?\n공정은 표에 그대로 남아요.`)) return;
    return tRef(id).update({ start: null, end: null, plus: null, minus: null, ...stamp() }).catch(fail);
  }
  // 끝 잡아 늘리기/줄이기한 모습 (기간 밖의 쉬는 날은 정리, 기간 밖에 따로 더한 날은 그대로)
  function resized(t, edge, day) {
    let st = t.start || day, en = t.end || t.start || day;
    if (edge === 'end') en = day < st ? st : day; else st = day > en ? en : day;
    const keepIn = (m) => { if (!m) return null; const o = {}; Object.keys(m).forEach((d) => { if (d >= st && d <= en) o[d] = true; }); return Object.keys(o).length ? o : null; };
    const plus = {}; Object.keys(t.plus || {}).forEach((d) => { if (d < st || d > en) plus[d] = true; });
    return { start: st, end: en, plus: Object.keys(plus).length ? plus : null, minus: keepIn(t.minus) };
  }
  // 칠한 모습 (일정 없는 공정: from~to)
  const painted = (a, b) => (a <= b ? { start: a, end: b } : { start: b, end: a });
  // 칸 누르기: 그날 켜고 끄기 (일정 없는 공정은 그날 하루로 시작)
  function toggleDay(id, d) {
    const t = tasksOf(cur.id)[id]; if (!t) return;
    const up = { ...stamp() };
    if (!S.daysOf(t).length) { up.start = d; up.end = d; up.plus = null; up.minus = null; }
    else if (S.activeOn(t, d)) { if (t.plus && t.plus[d]) up['plus/' + d] = null; else up['minus/' + d] = true; }
    else { if (t.minus && t.minus[d]) up['minus/' + d] = null; else up['plus/' + d] = true; }
    return tRef(id).update(up).catch(fail);
  }
  // 표준 공정표 넣기: 이름이 같은 공정은 공종·날짜만 바꾸고, 없는 공정은 새로 (다른 공정은 그대로)
  function putStd(st) {
    const tl = S.taskList(tasksOf(cur.id)), byName = new Map(tl.map((t) => [S.norm(t.name), t]));
    if (tl.length && !confirm(`지금 공정 ${tl.length}개가 있어요.\n표준 공정표와 이름이 같은 공정은 날짜를 바꾸고, 없는 공정은 새로 넣을까요?\n(다른 공정은 그대로 둬요)`)) return;
    const up = {};
    S.STD_TASKS.forEach(([cat, name, r], i) => {
      const d = S.stdDates(r, st), ex = byName.get(S.norm(name));
      if (ex) Object.assign(up, { [ex.id + '/cat']: cat, [ex.id + '/order']: i + 1, [ex.id + '/start']: d.start, [ex.id + '/end']: d.end, [ex.id + '/plus']: d.plus, [ex.id + '/minus']: null, [ex.id + '/by']: me.name, [ex.id + '/at']: Date.now() });
      else up[db.ref().push().key] = { cat, name, order: i + 1, start: d.start, end: d.end, ...(d.plus ? { plus: d.plus } : {}), ...stamp() };
    });
    stdOpen = false;
    return db.ref('site/' + cur.id + '/tasks').update(up).catch(fail);
  }

  // ---------- 누르기 ----------
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#side, #main')) return;
    if (e.target.closest('[data-print]')) return window.print();
    if (!cur || !canEdit(cur)) return;
    const tasks = tasksOf(cur.id);
    if (e.target.closest('[data-listedit]')) { listEdit = !listEdit; return drawMain(); }
    if (e.target.closest('[data-std]')) { stdOpen = !stdOpen; return drawMain(); }
    if (e.target.closest('[data-stdclose]')) { stdOpen = false; return drawMain(); }
    const tr = e.target.closest('tr[data-t]');
    const clr = e.target.closest('[data-clear]');
    if (clr && tr) return clearSchedule(tr.dataset.t);
    if (tr && e.target.closest('[data-del]')) { const t = tasks[tr.dataset.t]; if (confirm(`"${t.name}" 공정을 삭제할까요?`)) tRef(tr.dataset.t).remove().catch(fail); return; }
    const mv = e.target.closest('[data-mv]');
    if (tr && mv) {
      const tl = S.taskList(tasks), i = tl.findIndex((t) => t.id === tr.dataset.t), j = i + +mv.dataset.mv;
      if (j < 0 || j >= tl.length) return;
      const up = {}; [tl[i], tl[j]] = [tl[j], tl[i]]; tl.forEach((t, k) => { if ((t.order || 0) !== k + 1) up[t.id + '/order'] = k + 1; });
      return db.ref('site/' + cur.id + '/tasks').update(up).catch(fail);
    }
    // 휴대폰: 칸 누르기 (PC 는 아래 끌기에서 처리)
    const td = e.target.closest('table.gt.edit td.d[data-day]');
    if (td && tr && !canDrag()) return toggleDay(tr.dataset.t, td.dataset.day);
  });
  document.addEventListener('submit', (e) => {
    const std = e.target.closest('.gt-std');
    if (std) { e.preventDefault(); if (cur && canEdit(cur) && std.st.value) putStd(std.st.value); return; }
    const f = e.target.closest('.st-add'); if (!f) return;
    e.preventDefault();
    if (!cur || !canEdit(cur)) return;
    const name = f.nm.value.trim().slice(0, 30), cat = f.cat.value.trim().slice(0, 20); if (!name) return;
    const tl = S.taskList(tasksOf(cur.id));
    // 같은 공종의 마지막 공정 바로 뒤에 (없으면 맨 끝)
    const same = tl.filter((t) => cat && catOf(t) === cat), after = same.length ? same[same.length - 1].order || 0 : Math.max(0, ...tl.map((t) => t.order || 0));
    const up = {}; tl.forEach((t) => { if ((t.order || 0) > after) up[t.id + '/order'] = (t.order || 0) + 1; });
    up[db.ref().push().key] = { name, order: after + 1, ...(cat ? { cat } : {}), ...stamp() };
    f.nm.value = '';
    db.ref('site/' + cur.id + '/tasks').update(up).catch(fail);
  });
  document.addEventListener('change', (e) => {
    if (!cur || !canEdit(cur)) return;
    const tr = e.target.closest('tr[data-t]'); if (!tr) return;
    const t = tasksOf(cur.id)[tr.dataset.t]; if (!t) return;
    if (e.target.classList.contains('chk')) tRef(tr.dataset.t).update({ done: e.target.checked, ...stamp() }).catch(fail);
    if (e.target.classList.contains('nmc')) { const v = e.target.value.trim().slice(0, 30); if (v && v !== t.name) tRef(tr.dataset.t).update({ name: v, ...stamp() }).catch(fail); else e.target.value = t.name; }
    if (e.target.classList.contains('catc')) { const v = e.target.value.trim().slice(0, 20); if (v !== (t.cat || '')) tRef(tr.dataset.t).update({ cat: v || null, ...stamp() }).catch(fail); }
  });

  // ---------- 끌기 (PC) ----------
  // 마우스 아래 날짜 (어느 줄이든 그 열의 날짜)
  const dayAt = (x, y) => { const el = document.elementsFromPoint(x, y).find((n) => n.matches && n.matches('table.gt [data-day]')); return el ? el.dataset.day : null; };
  // 표만 다시 그림 (끄는 동안)
  const renderTable = () => { const sc = $('.gt-scroll'); if (!sc || !cur) return; const l = sc.scrollLeft; sc.innerHTML = gtTable(cur, withPreview(S.taskList(tasksOf(cur.id))), canEdit(cur)); sc.scrollLeft = l; };
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const td = e.target.closest && e.target.closest('table.gt.drag td.d[data-day]'); if (!td || e.button !== 0 || !cur || e.target.closest('[data-clear]')) return;
    const tr = td.closest('tr[data-t]'); if (!tr) return;
    const t = tasksOf(cur.id)[tr.dataset.t]; if (!t) return;
    e.preventDefault();
    const day = td.dataset.day, edge = (e.target.dataset && e.target.dataset.edge) || null;
    const has = S.daysOf(t).length > 0;
    // 끝 손잡이 = 늘리기, 회색 칸 = 옮기기, 일정 없는 공정의 빈 칸 = 칠하기, 그 밖의 빈 칸 = 누르기만
    const mode = edge ? 'resize' : td.classList.contains('on') ? 'move' : !has ? 'paint' : 'tap';
    drag = { id: tr.dataset.t, mode, edge, from: day, to: day, t };
    document.body.classList.add('st-dragging');
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag || drag.mode === 'tap') return;
    const d = dayAt(e.clientX, e.clientY); if (!d || d === drag.to) return;
    drag.to = d;
    const next = drag.mode === 'resize' ? resized(drag.t, drag.edge, d) : drag.mode === 'paint' ? painted(drag.from, d) : shifted(drag.t, S.diffDays(drag.from, d));
    preview = { id: drag.id, task: next };
    renderTable();
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const g = drag; drag = null; document.body.classList.remove('st-dragging');
    const commit = preview && preview.id === g.id ? preview.task : null;
    preview = null;
    if (g.to === g.from || !commit) { renderTable(); return toggleDay(g.id, g.from); } // 움직이지 않았으면 = 칸 누르기
    tRef(g.id).update({ ...commit, ...stamp() }).catch(fail);
    renderTable();
  });

  async function doAttend() {
    const b = $('#attBtn'); b.disabled = true;
    try { const r = await S.attend(db, me, cur); if (r.already) alert('오늘은 이미 출근 등록을 했어요.'); }
    catch (e) { alert('출근 등록을 하지 못했어요: ' + e.message); b.disabled = false; }
  }

  // ---------- 시작 ----------
  function route() {
    const id = new URLSearchParams(location.hash.slice(1)).get('s');
    const L = lists();
    const prev = cur && cur.id;
    cur = L.all.find((s) => s.id === id) || (id ? null : L.active[0] || L.undated[0] || null);
    if ((cur && cur.id) !== prev) { listEdit = false; stdOpen = false; }
    drawSide(); drawMain();
  }
  window.addEventListener('hashchange', route);
  // 이름을 쓰는 중이거나 끄는 중이면 다 끝날 때까지 화면을 다시 그리지 않음
  let pending = false;
  function redraw(full) {
    const ae = document.activeElement;
    if (drag || (ae && ae.matches('.gt-card input[type=text], .gt-card input[type=date]'))) { pending = true; return; }
    pending = false;
    if (cur) cur = lists().all.find((s) => s.id === cur.id) || cur;
    full ? route() : (drawSide(), drawMain());
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (pending) redraw(true); }, 0));
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
