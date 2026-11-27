// Site: 현장 공정 스케줄표 + 출근 (구글 로그인 회원만)
// 현장 목록·소장은 주간 스케줄에서 읽기만 한다. 공정·출근은 Firebase site/<현장id>/... (site-core.js)
// 화면: 왼쪽 = 현장 목록, 오른쪽 = 현장 머리 + 회사 공정표 양식 표(공종 · 공종 상세 · 공사기간 날짜 칸, 하는 날은 회색 칸) + 아래 3주 캘린더.
// 캘린더(공정표 위, 지난주·이번 주·다음 주): 막대는 "공종 며칠" 만(그 공종 공정이 하나라도 있는 날). 이번 주만 색을 채우고 지난주·다음 주는 속이 빈 점선.
//   PC 에서 막대를 끌면 그 공종의 모든 공정이 같이 옮겨짐. 넣기·늘리기·지우기·그날 쉬기는 공정표에서만 (같은 기능은 한 가지 방법).
// 표: PC 빈 칸 끌기 = 일정 넣기(일정 없는 공정), 회색 칸 끌기 = 옮기기, 끝 손잡이 = 늘리기·줄이기, 이름 옆 ✕ = 지우기, 칸 누르기 = 그날 켜고 끄기. 휴대폰은 칸 누르기.
// 착공·준공 고치기 = 주간 스케줄 공사기간(period 글자)도 같이 바뀜. 일정 등록 = 회사 캘린더(calendar/items/site-<현장id>)에 현장 이름으로 한 건.
(function () {
  const S = SBSite, esc = WS.esc;
  const $ = (s) => document.querySelector(s);
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const H = () => window.SB_HOLIDAYS || {};
  const sundayOf = (d) => S.addDays(d, -S.parse(d).getDay());
  let me = null, db = null, base = null, sched = { projects: [], groups: [], members: [] }, siteData = {}, cur = null, projKeys = {};
  let listEdit = false, stdOpen = false, perOpen = false, scrolledFor = null;
  const home = () => S.addDays(sundayOf(S.today()), -7); // 지난주 일요일부터 3주
  let weekBase = home();
  const canDrag = () => matchMedia('(pointer: fine)').matches && innerWidth > 900;
  let preview = null; // 끄는 동안 바뀐 모습 {tasks: {공정id: {start,end,plus,minus}}} (표는 공정 하나, 캘린더는 공종 통째)
  const withPreview = (tl) => (preview ? tl.map((t) => (preview.tasks[t.id] ? { ...t, ...preview.tasks[t.id], id: t.id } : t)) : tl);
  const isLive = (id) => !!(preview && preview.tasks[id]);

  const canEdit = (site) => !!me && (me.admin || S.isManager(site, sched.members, me.name));
  const tasksOf = (id) => (siteData[id] && siteData[id].tasks) || {};
  const dayCls = (d) => { const w = S.parse(d).getDay(); return w === 0 || H()[d] ? 'red' : w === 6 ? 'blue' : ''; };
  const COLORS = ['#e5484d', '#0f8a6a', '#2f6fd8', '#a33b6b', '#1d1d1b', '#c26a12', '#3f7f2a', '#d4572a', '#7c6be0', '#1e9e7a', '#b8860b', '#5a6b8c'];
  const colorOf = (tl, t) => COLORS[Math.max(0, tl.findIndex((x) => x.id === t.id)) % COLORS.length];
  const lists = () => S.sites(sched);
  const flash = (msg) => { const d = document.createElement('div'); d.className = 'st-flash'; d.textContent = msg; document.body.append(d); setTimeout(() => d.remove(), 3500); };
  const catOf = (t) => String(t.cat || '').trim() || '기타';
  const bigDate = (d) => (d ? `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8)}<em>${WD[S.parse(d).getDay()]}</em>` : '<em class="no">미정</em>');

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
    const wk0 = sundayOf(day), weekDays = [...Array(7)].map((_, i) => S.addDays(wk0, i));
    const weekCount = tl.filter((t) => weekDays.some((d) => S.activeOn(t, d))).length;
    $('#main').innerHTML = `${pickHtml()}
      <div class="st-head card">
        <div class="tt"><h1>${esc(s.name)}</h1>
          <div class="st-per"><span class="pd"><small>착공</small><b>${bigDate(s.st)}</b></span><span class="pa">→</span><span class="pd"><small>준공</small><b>${bigDate(s.en)}</b></span>${!s.st && !s.en ? `<span class="pt">공사기간: ${esc(s.period || '미정')}</span>` : ''}${canEdit(s) ? '<button type="button" class="btn st-peredit" data-per>수정</button>' : ''}</div>
          <div class="sub">진행률 ${pc}%${nowT.length ? ` · 오늘: <b>${nowT.map((t) => esc(t.name)).join(', ')}</b>` : ''}${nx ? ` · 다음: ${esc(nx.t.name)} (D-${S.diffDays(day, nx.day)})` : ''}</div>
          <div class="sub">소장: ${mg.length ? mg.map((m) => esc((m.name + ' ' + m.rank).trim())).join(', ') : '주간 스케줄 "시공 담당"이 비어 있어요'}</div>
          ${perOpen && canEdit(s) ? perForm(s) : ''}</div>
        <div class="st-attend"><span class="st-badge ${state[0]}">${state[1]}</span>
          ${canEdit(s) ? '<button class="btn primary" type="button" data-calreg title="회사 캘린더에 현장 이름으로 공사기간 일정을 올려요">일정 등록</button>' : ''}</div>
      </div>
      <div class="st-stats">
        <div class="st-stat"><div class="k">진행 현장</div><div class="v">${L.active.length}</div><div class="s">공사기간 안 (착공 7일 전부터)</div></div>
        <div class="st-stat"><div class="k">오늘 공정</div><div class="v">${nowT.length}<small> 개</small></div><div class="s">${nowT.length ? nowT.map((t) => esc(t.name)).join(', ') : '오늘은 공정이 없어요'}</div></div>
        <div class="st-stat"><div class="k">이번 주 공정</div><div class="v">${weekCount}<small> / ${tl.length}</small></div><div class="s">${S.md(weekDays[0])} ~ ${S.md(weekDays[6])}</div></div>
        <div class="st-stat"><div class="k">진행률</div><div class="v">${pc}<small>%</small></div><div class="st-bar"><i style="width:${pc}%"></i></div><div class="s">공정 일정이 지난 만큼 · 완료 ${tl.filter((t) => t.done).length} / ${tl.length}</div></div>
      </div>
      ${calCard(s, withPreview(tl), canEdit(s))}
      ${gtCard(s, tl, canEdit(s))}`;
    const pick = $('#pick'); if (pick) pick.onchange = () => { location.hash = 's=' + encodeURIComponent(pick.value); };
    // 옆으로 밀어 둔 자리 유지, 처음 열 때는 오늘이 보이게
    const sc = $('.gt-scroll');
    if (sc) {
      if (sl !== null && scrolledFor === s.id) sc.scrollLeft = sl;
      else { scrolledFor = s.id; const td = sc.querySelector('thead th.td'); if (td) { const fx = (sc.querySelector('th.nm') || {}).offsetLeft + (sc.querySelector('th.nm') || {}).offsetWidth || 0; sc.scrollLeft = Math.max(0, td.offsetLeft - fx - (sc.clientWidth - fx) / 2); } }
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
    const help = !edit ? '보기만 (수정: 소장님·관리자)' : listEdit ? '공종·공정 이름, 순서, 삭제를 고쳐요' : drag ? '빈 칸을 끌어 일정 넣기 · 회색 칸을 끌어 옮기기 · 끝을 끌어 늘리기 · 이름 옆 ✕ = 일정 지우기 · 칸 누르기 = 그날 켜고 끄기' : '칸을 눌러 그날 켜고 끄기 · 이름 옆 ✕ = 일정 지우기';
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
    const day = S.today(), days = daysRange(s, tl), drag = edit && canDrag();
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
      const ds = S.daysOf(t);
      const cells = days.map((d) => {
        const on = S.activeOn(t, d);
        const hl = drag && on && d === t.start ? '<i class="hl" data-edge="start"></i>' : '';
        const hr = drag && on && d === (t.end || t.start) ? '<i class="hr" data-edge="end"></i>' : '';
        return `<td class="d ${on ? 'on' : ''} ${colCls(d)}" data-day="${d}">${hl}${hr}</td>`;
      }).join('');
      const catCell = listEdit && edit ? `<td class="cat"><input type="text" class="catc" value="${esc(t.cat || '')}" list="gtCats" maxlength="20" placeholder="기타" aria-label="공종"></td>`
        : k === 0 ? `<td class="cat" rowspan="${ts.length}">${esc(cat)}</td>` : '';
      const i = tl.findIndex((x) => x.id === t.id);
      const nmCell = listEdit && edit
        ? `<td class="nm"><div class="nmw"><input type="text" class="nmc" value="${esc(t.name)}" maxlength="30" aria-label="공정 이름"><span class="acts"><button type="button" data-mv="-1" ${i ? '' : 'disabled'} aria-label="위로">▲</button><button type="button" data-mv="1" ${i < tl.length - 1 ? '' : 'disabled'} aria-label="아래로">▼</button><button type="button" class="del" data-del aria-label="삭제">삭제</button></span></div></td>`
        : `<td class="nm"><div class="nmw">${edit ? `<input type="checkbox" class="chk" ${t.done ? 'checked' : ''} aria-label="${esc(t.name)} 완료" title="완료">` : t.done ? '<span class="ok">✓</span>' : ''}<span class="nmt" title="${esc(t.name)}">${esc(t.name)}</span>${edit && ds.length ? '<i class="x" data-clear title="일정 지우기 (공정 이름은 남아요)">✕</i>' : ''}</div></td>`;
      return `<tr class="${k === 0 ? 'g1' : ''} ${t.done ? 'done' : ''} ${isLive(t.id) ? 'live' : ''}" data-t="${esc(t.id)}">${catCell}${nmCell}${cells}</tr>`;
    }).join('')).join('');
    return `<table class="gt ${drag && !listEdit ? 'drag' : ''} ${edit && !listEdit ? 'edit' : ''}" style="--n:${days.length}"><colgroup><col class="c-cat"><col class="c-nm">${days.map(() => '<col class="c-d">').join('')}</colgroup>${head}<tbody>${rows}</tbody></table>`;
  }

  function perForm(s) {
    return `<form class="gt-per"><label>착공일 <input type="date" name="st" value="${esc(s.st || '')}" required></label><label>준공일 <input type="date" name="en" value="${esc(s.en || '')}"></label>
      <button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-perclose>취소</button>
      <span class="st-ro">주간 스케줄의 공사기간도 같이 바뀌어요. 준공일은 비워 둬도 돼요.</span></form>`;
  }

  // ---------- 3주 캘린더 (지난주 · 이번 주 · 다음 주): 공종별 막대 ----------
  const catColor = (tl, cat) => COLORS[Math.max(0, groupsOf(tl).findIndex(([c]) => c === cat)) % COLORS.length];
  function calCard(s, tl, edit) {
    const day = S.today(), thisWeek = sundayOf(day), drag = edit && canDrag();
    const weeks = [0, 1, 2].map((k) => [...Array(7)].map((_, i) => S.addDays(weekBase, k * 7 + i)));
    // 공종마다: 일이 있는 날(그 공종 공정이 하나라도 있는 날)과 이어진 날 수
    const cats = groupsOf(tl).map(([cat, ts]) => {
      const set = new Set(ts.flatMap((t) => S.daysOf(t))), run = new Map(), ds = [...set].sort();
      for (let i = 0; i < ds.length;) { let j = i; while (j + 1 < ds.length && S.addDays(ds[j], 1) === ds[j + 1]) j++; for (let k = i; k <= j; k++) run.set(ds[k], j - i + 1); i = j + 1; }
      return { cat, set, run, color: catColor(tl, cat) };
    }).filter((c) => c.set.size);
    const rows = weeks.map((w) => {
      const isNow = w[0] === thisWeek, segs = [];
      cats.forEach((c) => {
        let st = -1;
        for (let i = 0; i <= 7; i++) {
          const on = i < 7 && c.set.has(w[i]);
          if (on && st < 0) st = i;
          if (!on && st >= 0) { segs.push({ c, a: st, b: i, n: c.run.get(w[st]) }); st = -1; }
        }
      });
      const lanes = [];
      segs.forEach((g) => { let l = lanes.findIndex((end) => end <= g.a); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = g.b; g.l = l; });
      const cells = w.map((d) => `<div class="st-day ${d === day ? 'today' : ''}" data-day="${d}"><span class="n ${dayCls(d)}">${+d.slice(8) === 1 || d === w[0] ? `${+d.slice(5, 7)}/${+d.slice(8)}` : +d.slice(8)}</span></div>`).join('');
      const bars = segs.map((g) => {
        const live = ts_live(tl, g.c.cat);
        const fill = isNow ? `background:${g.c.color};color:#fff;` : `background:#fff;color:${g.c.color};border:1.5px dashed ${g.c.color};line-height:17px;`;
        return `<span class="st-seg ${isNow ? 'now' : 'off'} ${live ? 'live' : ''} ${drag ? 'drag' : ''}" data-cat="${esc(g.c.cat)}" style="left:calc(${(g.a / 7) * 100}% + 3px);width:calc(${((g.b - g.a) / 7) * 100}% - 6px);top:${32 + g.l * 24}px;${fill}" title="${esc(g.c.cat)} ${g.n}일">${esc(g.c.cat)} ${g.n}일</span>`;
      }).join('');
      return `<div class="st-wk ${isNow ? 'now' : ''}" style="min-height:${Math.max(84, 38 + lanes.length * 24)}px">${cells}${bars}</div>`;
    }).join('');
    const a = weeks[0][0], b = weeks[2][6];
    const help = drag ? '막대를 끌면 그 공종의 공정이 모두 같이 옮겨져요 · 이번 주는 색, 지난주·다음 주는 점선' : '이번 주는 색, 지난주·다음 주는 점선';
    return `<div class="card st-calcard"><div class="card-h"><div class="st-nav" style="margin-left:0"><button type="button" data-wk="-7" aria-label="한 주 앞">‹</button></div>
      <h2>${S.md(a)} ~ ${S.md(b)} 공정 캘린더</h2><div class="st-nav" style="margin-left:0"><button type="button" data-wk="7" aria-label="한 주 뒤">›</button><button type="button" data-wk="0">이번 주</button></div>
      <span class="st-ro" style="margin-left:auto">${help}</span></div>
      <div class="st-scroll"><div class="st-month"><div class="st-wh">${WD.map((d, i) => `<span class="${i === 0 ? 'red' : i === 6 ? 'blue' : ''}">${d}</span>`).join('')}</div>${rows}</div></div></div>`;
  }
  const ts_live = (tl, cat) => !!preview && tl.some((t) => catOf(t) === cat && isLive(t.id));

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
  // 착공·준공 고치기: 주간 스케줄 공사기간(period 글자)만 바꿔 저장 (다른 칸은 안 건드림)
  function savePeriod(st, en) {
    const key = projKeys[cur.id];
    if (key == null) return alert('주간 스케줄에서 이 현장을 찾지 못했어요.');
    if (!st) return alert('착공일을 넣어 주세요.');
    if (en && en < st) return alert('준공일이 착공일보다 빨라요.');
    const dot = (d) => d.replace(/-/g, '.');
    perOpen = false;
    return base.child('projects/' + key + '/period').set(dot(st) + '-' + (en ? dot(en) : '')).then(() => flash('공사기간을 바꿨어요. 이미 올린 캘린더 일정은 "일정 등록"을 다시 눌러 바꿔요.')).catch(fail);
  }
  // 일정 등록: 회사 캘린더(직접 추가한 일정, 모두에게 공유)에 현장 이름으로 공사기간 한 건 (다시 누르면 같은 일정이 새 날짜로 바뀜)
  async function registerCal() {
    const s = cur;
    if (!s.st || !s.en) return alert('착공일과 준공일을 먼저 넣어 주세요. ("기간 고치기")');
    const ref = db.ref('spaces/' + me.spaceKey + '/calendar/items/site-' + String(s.id).replace(/[.#$\[\]\/]/g, '_'));
    try {
      const ex = (await ref.once('value')).val();
      if (ex && !confirm(`"${s.name}" 일정이 캘린더에 이미 있어요.\n새 날짜(${S.yy(s.st)} ~ ${S.yy(s.en)})로 바꿀까요?`)) return;
      await ref.set({ title: s.name.slice(0, 100), start: new Date(s.st + 'T00:00:00+09:00').toISOString(), end: new Date(S.addDays(s.en, 1) + 'T00:00:00+09:00').toISOString(), allDay: true, description: '공사기간 (Site 에서 등록)', location: '', by: me.name, updatedAt: new Date().toISOString() });
      flash(`캘린더에 "${s.name}" 일정을 ${ex ? '바꿨어요' : '등록했어요'}. (${S.md(s.st)} ~ ${S.md(s.en)})`);
    } catch (e) { fail(e); }
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
    const wk = e.target.closest('[data-wk]');
    if (wk) { weekBase = +wk.dataset.wk ? S.addDays(weekBase, +wk.dataset.wk) : home(); return renderCal(); }
    if (!cur || !canEdit(cur)) return;
    const tasks = tasksOf(cur.id);
    if (e.target.closest('[data-calreg]')) return registerCal();
    if (e.target.closest('[data-per]')) { perOpen = !perOpen; return drawMain(); }
    if (e.target.closest('[data-perclose]')) { perOpen = false; return drawMain(); }
    if (e.target.closest('[data-listedit]')) { listEdit = !listEdit; return drawMain(); }
    if (e.target.closest('[data-std]')) { stdOpen = !stdOpen; return drawMain(); }
    if (e.target.closest('[data-stdclose]')) { stdOpen = false; return drawMain(); }
    const tr = e.target.closest('tr[data-t]');
    const clr = e.target.closest('[data-clear]');
    if (clr) { const host = clr.closest('[data-t]'); if (host) clearSchedule(host.dataset.t); return; }
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
    const per = e.target.closest('.gt-per');
    if (per) { e.preventDefault(); if (cur && canEdit(cur)) savePeriod(per.st.value, per.en.value); return; }
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
  const dayAt = (x, y) => { const el = document.elementsFromPoint(x, y).find((n) => n.matches && n.matches('table.gt td[data-day], .st-month .st-day[data-day]')); return el ? el.dataset.day : null; };
  // 표만 다시 그림 (끄는 동안)
  const renderTable = () => { const sc = $('.gt-scroll'); if (!sc || !cur) return; const l = sc.scrollLeft; sc.innerHTML = gtTable(cur, withPreview(S.taskList(tasksOf(cur.id))), canEdit(cur)); sc.scrollLeft = l; };
  const renderCal = () => { const el = document.querySelector('.st-calcard'); if (el && cur) el.outerHTML = calCard(cur, withPreview(S.taskList(tasksOf(cur.id))), canEdit(cur)); };
  const renderLive = () => { renderTable(); renderCal(); };
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const seg = e.target.closest && e.target.closest('.st-seg.drag');
    if (seg && e.button === 0 && cur) { // 캘린더 막대: 그 공종의 공정을 모두 같이 옮기기
      const day = dayAt(e.clientX, e.clientY); if (!day) return;
      const ts = S.taskList(tasksOf(cur.id)).filter((t) => catOf(t) === seg.dataset.cat && S.daysOf(t).length);
      if (!ts.length) return;
      e.preventDefault();
      drag = { src: 'cal', mode: 'move', cat: seg.dataset.cat, ts, from: day, to: day };
      document.body.classList.add('st-dragging');
      return;
    }
    const td = e.target.closest && e.target.closest('table.gt.drag td.d[data-day]'); if (!td || e.button !== 0 || !cur || e.target.closest('[data-clear]')) return;
    const tr = td.closest('tr[data-t]'); if (!tr) return;
    const t = tasksOf(cur.id)[tr.dataset.t]; if (!t) return;
    e.preventDefault();
    const day = td.dataset.day, edge = (e.target.dataset && e.target.dataset.edge) || null;
    const has = S.daysOf(t).length > 0;
    // 끝 손잡이 = 늘리기, 회색 칸 = 옮기기, 일정 없는 공정의 빈 칸 = 칠하기, 그 밖의 빈 칸 = 누르기만
    const mode = edge ? 'resize' : td.classList.contains('on') ? 'move' : !has ? 'paint' : 'tap';
    drag = { src: 'table', id: tr.dataset.t, mode, edge, from: day, to: day, t };
    document.body.classList.add('st-dragging');
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const d = dayAt(e.clientX, e.clientY); if (!d || d === drag.to) return;
    if (drag.mode === 'tap') { drag.moved = true; return; } // 일정 있는 공정의 빈 칸을 끌면 아무 일도 안 함
    drag.to = d;
    if (drag.src === 'cal') { const n = S.diffDays(drag.from, d); preview = { tasks: Object.fromEntries(drag.ts.map((t) => [t.id, shifted(t, n)])) }; }
    else {
      const next = drag.mode === 'resize' ? resized(drag.t, drag.edge, d) : drag.mode === 'paint' ? painted(drag.from, d) : shifted(drag.t, S.diffDays(drag.from, d));
      preview = { tasks: { [drag.id]: next } };
    }
    renderLive();
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const g = drag; drag = null; document.body.classList.remove('st-dragging');
    const commit = preview; preview = null;
    if (g.mode === 'tap' && g.moved) return;
    if (g.to === g.from || !commit) { // 움직이지 않았으면: 표 = 칸 누르기, 캘린더 = 아무 일 없음
      renderLive();
      if (g.src === 'table') return toggleDay(g.id, g.from);
      return;
    }
    const up = {};
    Object.entries(commit.tasks).forEach(([id, t]) => { up[id + '/start'] = t.start || null; up[id + '/end'] = t.end || null; up[id + '/plus'] = t.plus || null; up[id + '/minus'] = t.minus || null; up[id + '/by'] = me.name; up[id + '/at'] = Date.now(); });
    db.ref('site/' + cur.id + '/tasks').update(up).catch(fail);
    renderLive();
  });

  // ---------- 시작 ----------
  function route() {
    const id = new URLSearchParams(location.hash.slice(1)).get('s');
    const L = lists();
    const prev = cur && cur.id;
    cur = L.all.find((s) => s.id === id) || (id ? null : L.active[0] || L.undated[0] || null);
    if ((cur && cur.id) !== prev) { listEdit = false; stdOpen = false; perOpen = false; }
    drawSide(); drawMain();
  }
  window.addEventListener('hashchange', route);
  // 이름을 쓰는 중이거나 끄는 중이면 다 끝날 때까지 화면을 다시 그리지 않음
  let pending = false;
  function redraw(full) {
    const ae = document.activeElement;
    if (drag || (ae && ae.matches('.gt-card input[type=text], .gt-card input[type=date], .gt-per input'))) { pending = true; return; }
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
    base = db.ref('spaces/' + a.spaceKey + '/data');
    const got = new Set();
    ['projects', 'groups', 'members'].forEach((k) => base.child(k).on('value', (s) => { sched[k] = S.list(s.val()); if (k === 'projects') { projKeys = {}; s.forEach((c) => { const v = c.val(); if (v && v.id) projKeys[v.id] = c.key; }); } got.add(k); if (got.size === 3) redraw(true); }));
    db.ref('site').on('value', (s) => { siteData = s.val() || {}; if (got.size === 3) redraw(); }, (e) => { $('#main').innerHTML = `<div class="st-empty">불러오지 못했어요: ${esc(e.message)}</div>`; });
  });
})();
