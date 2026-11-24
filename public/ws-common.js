// 워크스페이스 공통: 상단 메뉴, 로그인 정보, 날짜 도우미, 일정 상세 팝업
(function () {
  const TABS = [
    { href: '/', label: '홈', ic: '⌂' },
    { href: '/schedule', label: '주간 스케줄', ic: '▦' },
    { href: '/calendar', label: '캘린더', ic: '▣' },
  ];
  const here = location.pathname.replace(/\/$/, '') || '/';
  const tab = (t) => `<a href="${t.href}" class="${(t.href === '/' ? here === '/' : here.startsWith(t.href)) ? 'on' : ''}">`;

  const top = document.createElement('header');
  top.className = 'topbar';
  top.innerHTML = `<a class="logo" href="/">SPACEBASE</a>
    <nav class="tabs">${TABS.map((t) => tab(t) + t.label + '</a>').join('')}</nav>
    <div class="spacer"></div>
    <div class="user"><span class="name" id="wsName"></span><a href="/logout">로그아웃</a></div>`;
  document.body.prepend(top);
  const bottom = document.createElement('nav');
  bottom.className = 'bottomnav';
  bottom.innerHTML = TABS.map((t) => tab(t) + `<span class="ic">${t.ic}</span>${t.label}</a>`).join('');
  document.body.append(bottom);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 모든 날짜는 한국 시간 기준
  const TZ = 'Asia/Seoul';
  const ymd = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: TZ });
  const hm = (d) => new Date(d).toLocaleTimeString('ko-KR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = (s) => { const [y, m, d] = s.split('-').map(Number); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `${m}월 ${d}일 (${WD[w]})`; };
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  // 일정이 걸쳐 있는 날짜들 (종일 일정의 끝 날짜는 포함하지 않음)
  function daysOf(e) {
    const s = ymd(e.start);
    let last = ymd(new Date(new Date(e.end).getTime() - 1));
    if (last < s) last = s;
    const out = [];
    for (let d = s; d <= last && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function whenText(e, onDay) {
    if (e.allDay) return '종일';
    const sd = ymd(e.start), ed = ymd(e.end);
    if (onDay && sd !== onDay) return ed === onDay ? '~ ' + hm(e.end) : '종일';
    return hm(e.start);
  }

  async function api(url, opt = {}) {
    const r = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    if (r.status === 401) { location.href = '/login'; throw new Error('로그인이 필요합니다.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '요청 실패');
    return j;
  }

  const me = api('/api/me').then((u) => { if (u) document.getElementById('wsName').textContent = u.name + ' 님'; return u; }).catch(() => null);

  // 일정 상세 팝업
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="dlg-head"><h3 id="evTitle"></h3><button class="x" data-close>✕</button></div>
    <div class="dlg-body"><div class="detail" id="evBody"></div></div>
    <div class="dlg-foot" id="evFoot"></div>`;
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.hasAttribute('data-close')) dlg.close(); });
  function showEvent(e, actions) {
    dlg.querySelector('#evTitle').textContent = e.title;
    const sd = ymd(e.start), ed = ymd(new Date(new Date(e.end).getTime() - (e.allDay ? 1 : 0)));
    const when = e.allDay ? (sd === ed ? dayLabel(sd) + ' 종일' : `${dayLabel(sd)} ~ ${dayLabel(ed)}`)
      : (sd === ymd(e.end) ? `${dayLabel(sd)} ${hm(e.start)} ~ ${hm(e.end)}` : `${dayLabel(sd)} ${hm(e.start)} ~ ${dayLabel(ymd(e.end))} ${hm(e.end)}`);
    const src = e.source === 'band' ? '밴드 캘린더' : `직접 추가 · ${esc(e.by || '')}`;
    dlg.querySelector('#evBody').innerHTML = `<div class="meta">${when}</div>
      <div class="meta"><span class="dot ${e.source === 'web' ? 'web' : ''}"></span> ${src}</div>
      ${e.location ? `<div>📍 ${esc(e.location)}</div>` : ''}
      ${e.description ? `<div>${esc(e.description)}</div>` : ''}`;
    const foot = dlg.querySelector('#evFoot');
    foot.innerHTML = '';
    if (e.source === 'band' && e.url) { const a = document.createElement('a'); a.className = 'btn'; a.href = e.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '밴드에서 보기'; foot.append(a); }
    (actions || []).forEach((x) => foot.append(x));
    const sp = document.createElement('span'); sp.className = 'spacer'; foot.append(sp);
    const c = document.createElement('button'); c.className = 'btn'; c.textContent = '닫기'; c.onclick = () => dlg.close(); foot.append(c);
    dlg.showModal();
  }

  window.WS = { esc, ymd, hm, dayLabel, addDays, daysOf, whenText, api, me, showEvent, WD, closeEvent: () => dlg.close() };
})();
