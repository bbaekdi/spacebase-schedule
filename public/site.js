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
  let stdOpen = false, perOpen = false, scrolledFor = null, focusSel = null, rowDrag = null;
  const home = () => S.addDays(sundayOf(S.today()), -7); // 지난주 일요일부터 3주
  let weekBase = home();
  const canDrag = () => matchMedia('(pointer: fine)').matches && innerWidth > 900;
  let preview = null; // 끄는 동안 바뀐 모습 {tasks: {공정id: {start,end,plus,minus}}} (표는 공정 하나, 캘린더는 공종 통째)
  const withPreview = (tl) => (preview ? tl.map((t) => (preview.tasks[t.id] ? { ...t, ...preview.tasks[t.id], id: t.id } : t)) : tl);
  const isLive = (id) => !!(preview && preview.tasks[id]);

  const canEdit = (site) => !!me && (me.admin || S.isManager(site, sched.members, me.name));
  const tasksOf = (id) => (siteData[id] && siteData[id].tasks) || {};
  const dayCls = (d) => { const w = S.parse(d).getDay(); return w === 0 || H()[d] ? 'red' : w === 6 ? 'blue' : ''; };
  // 파스텔 그라데이션 (노랑 → 연두 → 초록 → 민트 → 하늘 → 파랑) 14칸. 옆 공종끼리 색이 멀도록 5칸씩 건너 고름
  const PAL = Array.from({ length: 14 }, (_, i) => { const h = Math.round(48 + i * (170 / 13)); return { fill: `hsl(${h} 70% 76%)`, line: `hsl(${h} 48% 36%)` }; });
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
    fitHol();
    if (focusSel) { const el = $(focusSel); if (el) { el.focus(); if (el.select) el.select(); focusSel = null; } }
    const pick = $('#pick'); if (pick) pick.onchange = () => { location.hash = 's=' + encodeURIComponent(pick.value); };
    // 옆으로 밀어 둔 자리 유지, 처음 열 때는 오늘이 보이게
    const sc = $('.gt-scroll');
    if (sc) {
      if (sl !== null && scrolledFor === s.id) sc.scrollLeft = sl;
      else { scrolledFor = s.id; const td = sc.querySelector('thead th.td'); if (td) { const fx = (sc.querySelector('th.nm') || {}).offsetLeft + (sc.querySelector('th.nm') || {}).offsetWidth || 0; sc.scrollLeft = Math.max(0, td.offsetLeft - fx - (sc.clientWidth - fx) / 2); } }
    }
  }

  // 공휴일 세로 글씨 높이 = 표 몸통 높이
  const fitHol = () => document.querySelectorAll('table.gt').forEach((t) => { const b = t.querySelector('tbody'); if (b) t.style.setProperty('--tbh', b.offsetHeight + 'px'); });
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
    const help = !edit ? '보기만 (수정: 소장님·관리자)' : drag ? '빈 칸을 마우스로 끌어 칠하면 일정이 돼요(다른 날도 또 칠할 수 있어요) · 회색 칸을 끌면 옮기기 · 끝을 끌면 늘리기 · 줄에 마우스를 올리면 ＋ － (줄 추가·삭제) · 이름은 눌러서 바로 수정 · ⋮⋮ 를 끌면 줄 순서 · Ctrl+Z = 되돌리기' : '칸을 눌러 그날 켜고 끄기 · 이름 옆 ✕ = 일정 지우기';
    return `<div class="card gt-card"><div class="card-h"><h2>공정표</h2><span class="st-ro">${help}</span>
        <span class="gt-btns">${edit ? `<button type="button" class="btn" data-std>표준 공정표 넣기</button>` : ''}<button type="button" class="btn" data-print>인쇄</button></span></div>
      ${stdOpen && edit ? stdForm(s, tl) : ''}
      <div class="gt-ptitle"><b>INTERIOR PROGRESS SCHEDULE</b><span>공 사 명 : ${esc(s.name)}</span></div>
      <div class="gt-scroll">${gtTable(s, withPreview(tl), edit)}</div>
      ${edit && drag ? catList(tl) : ''}
      ${edit && !tl.length ? '<button type="button" class="btn" data-addfirst style="margin-top:10px">+ 첫 공정 줄 추가</button>' : ''}
      ${!tl.length ? `<div class="st-none" style="margin-top:10px">아직 공정이 없어요. ${edit ? '"표준 공정표 넣기"를 누르면 회사 공정표의 공종·공정이 착공일 기준 날짜로 들어가요.' : ''}</div>` : ''}
    </div>`;
  }
  function stdForm(s, tl) {
    return `<form class="gt-std"><b>표준 공정표 넣기</b><span>회사 공정표의 공정 ${S.STD_TASKS.length}개를 착공일부터 36일 일정으로 넣어요.${tl.length ? ' 이름이 같은 공정은 날짜만 바꾸고, 다른 공정은 그대로 둬요.' : ''}</span>
      <label>착공일 <input type="date" name="st" value="${esc(s.st || S.today())}" required></label><button class="btn primary" type="submit">넣기</button><button class="btn" type="button" data-stdclose>취소</button></form>`;
  }
  // 공종 이름 후보 (공종 칸 입력 자동완성)
  const catList = (tl) => `<datalist id="gtCats">${[...new Set(tl.map(catOf))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;

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
    let firstRow = true; // 공휴일·명절 이름은 첫 줄 칸에 세로로 길게 (칸은 합치지 않음)
    const rows = groups.map(([cat, ts]) => ts.map((t, k) => {
      const isFirst = firstRow; firstRow = false;
      const ds = S.daysOf(t);
      const cells = days.map((d) => {
        const on = S.activeOn(t, d);
        const hl = drag && on && d === t.start ? '<i class="hl" data-edge="start"></i>' : '';
        const hr = drag && on && d === (t.end || t.start) ? '<i class="hr" data-edge="end"></i>' : '';
        const hv = isFirst && H()[d] ? `<span class="holv">${esc(H()[d])}</span>` : '';
        return `<td class="d ${on ? 'on' : ''} ${colCls(d)}" data-day="${d}">${hv}${hl}${hr}</td>`;
      }).join('');
      // 공종 칸: PC 는 바로 고치는 글자칸 (합쳐진 칸 = 그 공종 전체 이름 바꾸기) + 마우스를 올리면 ＋(아래에 새 공종)
      const catCell = k !== 0 ? '' : drag
        ? `<td class="cat" rowspan="${ts.length}"><div class="catw"><input type="text" class="catc" value="${esc(cat === '기타' && !ts.some((x) => x.cat) ? '' : cat)}" list="gtCats" maxlength="20" placeholder="기타" aria-label="공종 (눌러서 바로 수정)" title="눌러서 공종 이름 바로 수정"><button type="button" class="pm" data-addcat title="이 공종 아래에 새 공종 추가">＋공종</button></div></td>`
        : `<td class="cat" rowspan="${ts.length}">${esc(cat)}</td>`;
      // 공종 상세 칸: PC 는 바로 고치는 글자칸 + ⋮⋮(끌어서 순서) + 마우스를 올리면 ✕ ＋ －, 휴대폰은 글자만 (✕ 는 누를 수 있음)
      const nmCell = drag
        ? `<td class="nm"><div class="nmw"><span class="rgrip" title="끌어서 줄 순서 바꾸기 (또는 Alt+↑/↓)">⋮⋮</span><input type="checkbox" class="chk" ${t.done ? 'checked' : ''} aria-label="${esc(t.name)} 완료" title="완료"><input type="text" class="nmc" value="${esc(t.name)}" maxlength="30" aria-label="공종 상세 (눌러서 바로 수정)"><span class="acts">${ds.length ? '<button type="button" class="pm clr" data-clear title="일정 지우기 (이름은 남아요)">✕</button>' : ''}<button type="button" class="pm" data-ins="1" title="이 줄 아래에 줄 추가">＋</button><button type="button" class="pm del" data-del title="이 줄 삭제 (Ctrl+Z 로 되돌려요)">－</button></span></div></td>`
        : `<td class="nm"><div class="nmw">${edit ? `<input type="checkbox" class="chk" ${t.done ? 'checked' : ''} aria-label="${esc(t.name)} 완료" title="완료">` : t.done ? '<span class="ok">✓</span>' : ''}<span class="nmt" title="${esc(t.name)}">${esc(t.name)}</span>${edit && ds.length ? '<button type="button" class="pm clr" data-clear title="일정 지우기 (공정 이름은 남아요)">✕</button>' : ''}</div></td>`;
      return `<tr class="${k === 0 ? 'g1' : ''} ${t.done ? 'done' : ''} ${isLive(t.id) ? 'live' : ''}" data-t="${esc(t.id)}">${catCell}${nmCell}${cells}</tr>`;
    }).join('')).join('');
    return `<table class="gt ${drag ? 'drag' : ''} ${edit ? 'edit' : ''}" style="--n:${days.length}"><colgroup><col class="c-cat"><col class="c-nm">${days.map(() => '<col class="c-d">').join('')}</colgroup>${head}<tbody>${rows}</tbody></table>`;
  }

  function perForm(s) {
    return `<form class="gt-per"><label>착공일 <input type="date" name="st" value="${esc(s.st || '')}" required></label><label>준공일 <input type="date" name="en" value="${esc(s.en || '')}"></label>
      <button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-perclose>취소</button>
      <span class="st-ro">주간 스케줄의 공사기간도 같이 바뀌어요. 준공일은 비워 둬도 돼요.</span></form>`;
  }

  // ---------- 3주 캘린더 (지난주 · 이번 주 · 다음 주): 공종별 막대 ----------
  const catColor = (tl, cat) => PAL[(Math.max(0, groupsOf(tl).findIndex(([c]) => c === cat)) * 5) % PAL.length];
  function calCard(s, tl, edit) {
    const day = S.today(), thisWeek = sundayOf(day), drag = edit && canDrag();
    const weeks = [0, 1, 2].map((k) => [...Array(7)].map((_, i) => S.addDays(weekBase, k * 7 + i)));
    // 공종마다: 일이 있는 날(그 공종 공정이 하나라도 있는 날)과 이어진 날 수
    const cats = groupsOf(tl).map(([cat, ts]) => {
      const set = new Set(ts.flatMap((t) => S.daysOf(t))), run = new Map(), ds = [...set].sort();
      for (let i = 0; i < ds.length;) { let j = i; while (j + 1 < ds.length && S.addDays(ds[j], 1) === ds[j + 1]) j++; for (let k = i; k <= j; k++) run.set(ds[k], j - i + 1); i = j + 1; }
      return { cat, set, run, col: catColor(tl, cat) };
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
      const cells = w.map((d) => `<div class="st-day ${d === day ? 'today' : ''}" data-day="${d}"><span class="n ${dayCls(d)}">${+d.slice(8) === 1 || d === w[0] ? `${+d.slice(5, 7)}/${+d.slice(8)}` : +d.slice(8)}</span>${H()[d] ? `<span class="hol" title="${esc(H()[d])}">${esc(H()[d])}</span>` : ''}</div>`).join('');
      const bars = segs.map((g) => {
        const live = ts_live(tl, g.c.cat);
        const fill = isNow ? `background:${g.c.col.fill};color:#2b2b28;` : `background:#fff;color:${g.c.col.line};border:1.5px dashed ${g.c.col.line};line-height:17px;`;
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
  // 되돌리기(Ctrl+Z) · 다시 하기(Ctrl+Shift+Z / Ctrl+Y): 공정 쓰기는 모두 write() 를 거쳐 "바꾸기 전 값"을 기억함 (이 화면을 열어 둔 동안만, 현장을 바꾸면 비움)
  let undoStack = [], redoStack = [];
  const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  const getAt = (o, path) => path.split('/').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
  const setAt = (o, path, val) => { const seg = path.split('/'); let x = o; seg.slice(0, -1).forEach((k) => { if (!x[k] || typeof x[k] !== 'object') x[k] = {}; x = x[k]; }); if (val === null || val === undefined) delete x[seg[seg.length - 1]]; else x[seg[seg.length - 1]] = val; };
  let fresh = null; // 방금 만든 새 줄 {key, entry}: 그 줄을 이어서 고치는 일(이름·날짜 칠하기 …)은 "줄 추가"와 한 단계로 묶음 → Ctrl+Z 한 번이면 줄 통째로 사라짐
  function write(up, label, opts = {}) {
    const pid = cur.id, T = tasksOf(pid);
    if (fresh && fresh.entry.pid === pid && undoStack[undoStack.length - 1] === fresh.entry && Object.keys(up).every((k) => k.split('/')[0] === fresh.key && k.includes('/'))) {
      const obj = fresh.entry.after[fresh.key];
      if (obj && typeof obj === 'object') { Object.entries(clone(up)).forEach(([k, v]) => setAt(obj, k.slice(fresh.key.length + 1), v)); redoStack = []; return db.ref('site/' + pid + '/tasks').update(up).catch(fail); }
    }
    fresh = null;
    const before = {};
    Object.keys(up).forEach((k) => { before[k] = clone(getAt(T, k)); });
    const entry = { pid, label, before, after: clone(up) || {} };
    undoStack.push(entry); if (undoStack.length > 60) undoStack.shift(); redoStack = [];
    if (opts.fresh) fresh = { key: opts.fresh, entry };
    return db.ref('site/' + pid + '/tasks').update(up).catch(fail);
  }
  const writeTask = (id, obj, label) => write(Object.fromEntries(Object.entries(obj).map(([k, v]) => [id + '/' + k, v === undefined ? null : v])), label);
  // 되돌릴 때는 쓴 사람 표시(by/at)를 지금 사람으로 새로 찍음 (규칙: by 는 내 이름이어야 함)
  function restoreMap(m) {
    const up = {}, ids = new Set();
    Object.entries(m).forEach(([k, v]) => {
      const seg = k.split('/');
      if (seg.length === 2 && (seg[1] === 'by' || seg[1] === 'at')) return;
      if (seg.length === 1) { up[k] = v ? { ...v, by: me.name, at: Date.now() } : null; return; }
      up[k] = v; ids.add(seg[0]);
    });
    ids.forEach((id) => { if (!(id in up)) { up[id + '/by'] = me.name; up[id + '/at'] = Date.now(); } });
    return up;
  }
  function undoRedo(redo) {
    const from = redo ? redoStack : undoStack, e = from.pop();
    if (!e || !cur || cur.id !== e.pid) { if (e) from.length = 0; return flash(redo ? '다시 할 게 없어요.' : '되돌릴 게 없어요.'); }
    (redo ? undoStack : redoStack).push(e);
    return db.ref('site/' + e.pid + '/tasks').update(restoreMap(redo ? e.after : e.before)).then(() => flash((redo ? '다시 했어요: ' : '되돌렸어요: ') + e.label)).catch(fail);
  }
  // 글자를 쓰는 중(바꾼 글자가 있는 입력칸)에는 글자 되돌리기, 아니면 공정표 되돌리기
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = String(e.key).toLowerCase(); if (k !== 'z' && k !== 'y') return;
    const ae = document.activeElement;
    if (ae && ae.matches('input[type=text], input[type=date], textarea') && ae.value !== ae.defaultValue) return;
    if (!cur || !canEdit(cur) || !document.querySelector('.gt')) return;
    e.preventDefault();
    undoRedo(k === 'y' || e.shiftKey);
  });
  const stamp = () => ({ by: me.name, at: Date.now() });
  const fail = (e) => alert('저장하지 못했어요: ' + e.message);
  const shiftMap = (m, n) => { if (!m) return null; const o = {}; Object.keys(m).forEach((d) => { o[S.addDays(d, n)] = true; }); return Object.keys(o).length ? o : null; };
  // 공정 전체를 n일 옮긴 모습 (쉬는 날·더한 날도 같이)
  const shifted = (t, n) => ({ start: t.start ? S.addDays(t.start, n) : null, end: t.end ? S.addDays(t.end, n) : null, plus: shiftMap(t.plus, n), minus: shiftMap(t.minus, n) });
  // 일정 지우기 (공정 이름은 표에 남음)
  function clearSchedule(id) {
    const t = tasksOf(cur.id)[id]; if (!t) return;
    if (!confirm(`"${t.name}" 일정을 지울까요?\n공정은 표에 그대로 남아요.`)) return;
    return writeTask(id, { start: null, end: null, plus: null, minus: null, ...stamp() }, '일정 지우기');
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
  // 이미 일정이 있는 공정의 빈 칸을 끌면 그 구간이 더해짐 (기간 밖은 "더한 날", 쉬는 날로 꺼 둔 날은 다시 켬)
  function paintedMore(t, a, b) {
    const lo = a <= b ? a : b, hi = a <= b ? b : a, plus = { ...(t.plus || {}) }, minus = { ...(t.minus || {}) };
    for (let d = lo, i = 0; d <= hi && i < 400; d = S.addDays(d, 1), i++) { if (S.activeOn(t, d)) continue; if (minus[d]) delete minus[d]; else plus[d] = true; }
    return { start: t.start || null, end: t.end || null, plus: Object.keys(plus).length ? plus : null, minus: Object.keys(minus).length ? minus : null };
  }
  // 칸 누르기: 그날 켜고 끄기 (일정 없는 공정은 그날 하루로 시작)
  function toggleDay(id, d) {
    const t = tasksOf(cur.id)[id]; if (!t) return;
    const up = { ...stamp() };
    if (!S.daysOf(t).length) { up.start = d; up.end = d; up.plus = null; up.minus = null; }
    else if (S.activeOn(t, d)) { if (t.plus && t.plus[d]) up['plus/' + d] = null; else up['minus/' + d] = true; }
    else { if (t.minus && t.minus[d]) up['minus/' + d] = null; else up['plus/' + d] = true; }
    return writeTask(id, up, '칸 누르기');
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
  // 줄 넣기(＋): 고른 줄 아래에 같은 공종의 새 줄 ("새 공정") — 만들자마자 이름 칸에 커서
  function insertRow(id, dir) {
    const tl = S.taskList(tasksOf(cur.id)), t = id ? tl.find((x) => x.id === id) : null;
    if (id && !t) return;
    const at = t ? (dir < 0 ? t.order || 0 : (t.order || 0) + 1) : 1;
    const up = {}; tl.forEach((x) => { if ((x.order || 0) >= at) up[x.id + '/order'] = (x.order || 0) + 1; });
    const key = db.ref().push().key;
    up[key] = { name: '새 공정', order: at, ...(t && t.cat ? { cat: t.cat } : {}), ...stamp() };
    focusSel = `tr[data-t="${key}"] input.nmc`;
    return write(up, '줄 추가', { fresh: key });
  }
  // ＋공종: 이 공종 맨 아래에 새 공종 한 줄 ("새 공종" / "새 공정") — 만들자마자 공종 칸에 커서
  function addCat(id) {
    const tl = S.taskList(tasksOf(cur.id)), t = tl.find((x) => x.id === id); if (!t) return;
    const grp = tl.filter((x) => catOf(x) === catOf(t)), at = Math.max(...grp.map((x) => x.order || 0)) + 1;
    const up = {}; tl.forEach((x) => { if ((x.order || 0) >= at) up[x.id + '/order'] = (x.order || 0) + 1; });
    const key = db.ref().push().key;
    up[key] = { name: '새 공정', cat: '새 공종', order: at, ...stamp() };
    focusSel = `tr[data-t="${key}"] input.catc`;
    return write(up, '공종 추가', { fresh: key });
  }
  // 보이는 순서 (공종끼리 묶인 모습)
  const displayList = (tl) => groupsOf(tl).flatMap(([, ts]) => ts);
  // 줄 옮기기 (끌기 · Alt+↑/↓): 다른 공종 줄 사이로 놓으면 그 공종이 됨. 바뀐 순서·공종 칸만 저장
  function moveRow(id, targetId, after) {
    const tl = S.taskList(tasksOf(cur.id)), disp = displayList(tl), t = disp.find((x) => x.id === id), tg = disp.find((x) => x.id === targetId);
    if (!t || !tg || t.id === tg.id) return;
    const rest = disp.filter((x) => x.id !== id), idx = rest.findIndex((x) => x.id === targetId) + (after ? 1 : 0);
    rest.splice(idx, 0, t);
    const up = {}; rest.forEach((x, k) => { if ((x.order || 0) !== k + 1) up[x.id + '/order'] = k + 1; });
    if (catOf(tg) !== catOf(t)) { up[id + '/cat'] = tg.cat || null; up[id + '/by'] = me.name; up[id + '/at'] = Date.now(); }
    if (!Object.keys(up).length) return;
    focusSel = `tr[data-t="${id}"] input.nmc`;
    return write(up, '줄 순서 바꾸기');
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
    return write(up, '표준 공정표 넣기');
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
    if (e.target.closest('[data-std]')) { stdOpen = !stdOpen; return drawMain(); }
    if (e.target.closest('[data-addfirst]')) return insertRow(null, 1);
    if (e.target.closest('[data-stdclose]')) { stdOpen = false; return drawMain(); }
    const tr = e.target.closest('tr[data-t]');
    const clr = e.target.closest('[data-clear]');
    if (clr) { const host = clr.closest('[data-t]'); if (host) clearSchedule(host.dataset.t); return; }
    if (tr && e.target.closest('[data-del]')) { if (tasks[tr.dataset.t]) { flash('줄을 지웠어요. 잘못 지웠으면 Ctrl+Z'); write({ [tr.dataset.t]: null }, '줄 삭제'); } return; }
    const ac = e.target.closest('[data-addcat]'); if (tr && ac) return addCat(tr.dataset.t);
    const ins = e.target.closest('[data-ins]');
    if (tr && ins) return insertRow(tr.dataset.t, +ins.dataset.ins);
    // 휴대폰: 칸 누르기 (PC 는 아래 끌기에서 처리)
    const td = e.target.closest('table.gt.edit td.d[data-day]');
    if (td && tr && !canDrag()) return toggleDay(tr.dataset.t, td.dataset.day);
  });
  document.addEventListener('submit', (e) => {
    const per = e.target.closest('.gt-per');
    if (per) { e.preventDefault(); if (cur && canEdit(cur)) savePeriod(per.st.value, per.en.value); return; }
    const std = e.target.closest('.gt-std');
    if (std) { e.preventDefault(); if (cur && canEdit(cur) && std.st.value) putStd(std.st.value); return; }
  });
  document.addEventListener('change', (e) => {
    if (!cur || !canEdit(cur)) return;
    const tr = e.target.closest('tr[data-t]'); if (!tr) return;
    const t = tasksOf(cur.id)[tr.dataset.t]; if (!t) return;
    if (e.target.classList.contains('chk')) writeTask(tr.dataset.t, { done: e.target.checked, ...stamp() }, '완료 체크');
    if (e.target.classList.contains('nmc')) { const v = e.target.value.trim().slice(0, 30); if (v && v !== t.name) writeTask(tr.dataset.t, { name: v, ...stamp() }, '이름 고치기'); else e.target.value = t.name; }
    if (e.target.classList.contains('catc')) { // 합쳐진 공종 칸: 그 공종 전체 이름 바꾸기
      const v = e.target.value.trim().slice(0, 20), c0 = catOf(t);
      if ((v || '기타') === c0) return;
      const up = {}; S.taskList(tasksOf(cur.id)).filter((x) => catOf(x) === c0).forEach((x) => { up[x.id + '/cat'] = v || null; up[x.id + '/by'] = me.name; up[x.id + '/at'] = Date.now(); });
      write(up, '공종 이름 고치기');
    }
  });

  // ---------- 끌기 (PC) ----------
  // 마우스 아래 날짜 (어느 줄이든 그 열의 날짜)
  const dayAt = (x, y) => { const el = document.elementsFromPoint(x, y).find((n) => n.matches && n.matches('table.gt td[data-day], .st-month .st-day[data-day]')); return el ? el.dataset.day : null; };
  // 표만 다시 그림 (끄는 동안)
  const renderTable = () => { const sc = $('.gt-scroll'); if (!sc || !cur) return; const l = sc.scrollLeft; sc.innerHTML = gtTable(cur, withPreview(S.taskList(tasksOf(cur.id))), canEdit(cur)); sc.scrollLeft = l; fitHol(); };
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
    const mode = edge ? 'resize' : td.classList.contains('on') ? 'move' : 'paint';
    drag = { src: 'table', id: tr.dataset.t, mode, edge, from: day, to: day, t, has };
    document.body.classList.add('st-dragging');
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const d = dayAt(e.clientX, e.clientY); if (!d || d === drag.to) return;
    drag.to = d;
    if (drag.src === 'cal') { const n = S.diffDays(drag.from, d); preview = { tasks: Object.fromEntries(drag.ts.map((t) => [t.id, shifted(t, n)])) }; }
    else {
      const next = drag.mode === 'resize' ? resized(drag.t, drag.edge, d) : drag.mode === 'paint' ? (drag.has ? paintedMore(drag.t, drag.from, d) : painted(drag.from, d)) : shifted(drag.t, S.diffDays(drag.from, d));
      preview = { tasks: { [drag.id]: next } };
    }
    renderLive();
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const g = drag; drag = null; document.body.classList.remove('st-dragging');
    const commit = preview; preview = null;
    if (g.to === g.from || !commit) { // 움직이지 않았으면: 표 = 칸 누르기, 캘린더 = 아무 일 없음
      renderLive();
      if (g.src === 'table') return toggleDay(g.id, g.from);
      return;
    }
    const up = {};
    Object.entries(commit.tasks).forEach(([id, t]) => { up[id + '/start'] = t.start || null; up[id + '/end'] = t.end || null; up[id + '/plus'] = t.plus || null; up[id + '/minus'] = t.minus || null; up[id + '/by'] = me.name; up[id + '/at'] = Date.now(); });
    write(up, g.src === 'cal' ? '공종 옮기기' : g.mode === 'paint' ? '일정 넣기' : g.mode === 'resize' ? '일정 늘리기·줄이기' : '일정 옮기기');
    renderLive();
  });

  // ---------- 줄 순서 (⋮⋮ 끌기 · Alt+↑/↓) · Enter 로 저장 ----------
  document.addEventListener('keydown', (e) => {
    const t = e.target; if (!t.matches || !t.matches('input.nmc, input.catc') || !cur || !canEdit(cur)) return;
    if (e.key === 'Enter') { e.preventDefault(); t.blur(); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && t.matches('input.nmc')) {
      e.preventDefault();
      const id = t.closest('tr[data-t]').dataset.t, up = e.key === 'ArrowUp';
      if (t.value !== t.defaultValue) t.blur();
      setTimeout(() => { const disp = displayList(S.taskList(tasksOf(cur.id))), i = disp.findIndex((x) => x.id === id), nb = disp[i + (up ? -1 : 1)]; if (nb) moveRow(id, nb.id, !up); }, 40);
    }
  });
  const clearDrop = () => document.querySelectorAll('tr.rowdrag, tr.drop-before, tr.drop-after').forEach((n) => n.classList.remove('rowdrag', 'drop-before', 'drop-after'));
  document.addEventListener('pointerdown', (e) => {
    const g = e.target.closest && e.target.closest('.rgrip'); if (!g || e.button !== 0 || !cur || !canEdit(cur)) return;
    const tr = g.closest('tr[data-t]'); if (!tr) return;
    e.preventDefault();
    rowDrag = { id: tr.dataset.t, tg: null, after: false };
    tr.classList.add('rowdrag'); document.body.classList.add('st-dragging');
  });
  document.addEventListener('pointermove', (e) => {
    if (!rowDrag) return;
    document.querySelectorAll('tr.drop-before, tr.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    const cellEl = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.matches && n.matches('table.gt tbody td')), el = cellEl && cellEl.closest('tr[data-t]');
    if (!el || el.dataset.t === rowDrag.id) { rowDrag.tg = null; return; }
    const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    rowDrag.tg = el.dataset.t; rowDrag.after = after; el.classList.add(after ? 'drop-after' : 'drop-before');
  });
  document.addEventListener('pointerup', () => {
    if (!rowDrag) return;
    const g = rowDrag; rowDrag = null; document.body.classList.remove('st-dragging'); clearDrop();
    if (g.tg) moveRow(g.id, g.tg, g.after);
  });

  // ---------- 시작 ----------
  function route() {
    const id = new URLSearchParams(location.hash.slice(1)).get('s');
    const L = lists();
    const prev = cur && cur.id;
    cur = L.all.find((s) => s.id === id) || (id ? null : L.active[0] || L.undated[0] || null);
    if ((cur && cur.id) !== prev) { stdOpen = false; perOpen = false; undoStack = []; redoStack = []; fresh = null; }
    drawSide(); drawMain();
  }
  window.addEventListener('hashchange', route);
  // 이름을 쓰는 중이거나 끄는 중이면 다 끝날 때까지 화면을 다시 그리지 않음
  let pending = false;
  function redraw(full) {
    const ae = document.activeElement;
    if (drag || rowDrag || (ae && ae.matches('.gt-card input[type=text], .gt-card input[type=date], .gt-per input') && ae.value !== ae.defaultValue)) { pending = true; return; }
    pending = false;
    if (cur) cur = lists().all.find((s) => s.id === cur.id) || cur;
    full ? route() : (drawSide(), drawMain());
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (pending) redraw(true); }, 0));
  document.addEventListener('pointerup', () => setTimeout(() => { if (pending && !drag && !rowDrag) redraw(true); }, 50));
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
