// 워크스페이스 공통: 상단 메뉴, 로그인, 날짜 도우미, 일정 데이터, 일정 상세 팝업
//
// 두 가지 방식으로 동작한다.
// - 서버 방식: server.js 가 있는 곳 (회사 PC 등). 로그인과 일정은 서버 API 를 쓴다.
// - 클라우드 방식: 서버 없이 정적 파일만 올린 곳 (GitHub Pages 등). 주간 스케줄과 같은 방법으로
//   "회사 비밀번호 + 이름"을 입력하고, 일정은 Firebase 의 spaces/<비밀번호 해시>/ 아래에 저장한다.
//   밴드 일정은 GitHub Actions(.github/workflows/band-calendar.yml)가 15분마다 spaces/<해시>/band 에 넣어 준다.
(function () {
  const TABS = [
    { href: './', key: 'home', label: '홈', ic: '⌂' },
    { href: 'schedule.html', key: 'schedule', label: '주간 스케줄', ic: '▦' },
    { href: 'calendar.html', key: 'calendar', label: '캘린더', ic: '▣' },
  ];
  const page = document.body.dataset.page || 'home';
  const tab = (t) => `<a href="${t.href}" class="${t.key === page ? 'on' : ''}">`;

  const top = document.createElement('header');
  top.className = 'topbar';
  top.innerHTML = `<a class="logo" href="./" title="SPACEBASE 홈"><img src="logo.svg" alt="SPACEBASE"></a>
    <nav class="tabs">${TABS.map((t) => tab(t) + t.label + '</a>').join('')}</nav>
    <div class="spacer"></div>
    <div class="user"><span class="name" id="wsName"></span><a href="logout" id="wsLogout">로그아웃</a></div>`;
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

  // ---------- 서버 방식 ----------
  async function api(url, opt = {}) {
    const r = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    if (r.status === 401) { location.href = 'login'; throw new Error('로그인이 필요합니다.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '요청 실패');
    return j;
  }
  const serverBackend = {
    mode: 'server',
    async start() { const u = await api('api/me'); return u; },
    profile: async () => ({}),
    events: (from, to) => api(`api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    add: (body) => api('api/calendar/items', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => api('api/calendar/items/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id) => api('api/calendar/items/' + encodeURIComponent(id), { method: 'DELETE' }),
  };

  // ---------- 클라우드 방식 (Firebase) ----------
  // 주간 스케줄(app.js)과 같은 저장 위치·같은 로그인 정보(localStorage sb_cred)를 쓴다.
  const getCred = () => { try { const c = JSON.parse(localStorage.getItem('sb_cred') || 'null'); return c && c.code && c.name ? c : null; } catch { return null; } };
  const setCred = (c) => { try { localStorage.setItem('sb_cred', JSON.stringify(c)); } catch {} };
  async function sha256hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function cleanItem(body, name) {
    const title = String(body.title || '').trim().slice(0, 100);
    if (!title) throw new Error('제목을 입력해 주세요.');
    const s = new Date(body.start), e = new Date(body.end || body.start);
    if (isNaN(s) || isNaN(e)) throw new Error('날짜를 확인해 주세요.');
    if (e < s) throw new Error('끝나는 시간이 시작보다 빠릅니다.');
    if (body.allDay && e.getTime() === s.getTime()) e.setTime(s.getTime() + 864e5);
    return {
      title, start: s.toISOString(), end: e.toISOString(), allDay: !!body.allDay,
      description: String(body.description || '').slice(0, 2000), location: String(body.location || '').slice(0, 200),
      by: name, updatedAt: new Date().toISOString(),
    };
  }
  let space = null, cred = null;
  const cloudBackend = {
    mode: 'cloud',
    async start() {
      cred = getCred();
      if (!cred) cred = await askCred();
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      for (;;) {
        space = firebase.database().ref('spaces/' + await sha256hex('spacebase:' + cred.code));
        const snap = await space.child('data/title').once('value');
        if (snap.exists() || (await space.child('data/groups').once('value')).exists()) break;
        // 주간 스케줄이 없는 비밀번호 = 잘못 입력한 비밀번호
        cred = await askCred('회사 비밀번호가 맞지 않아요. 주간 스케줄에서 쓰는 비밀번호를 넣어 주세요.');
      }
      return { id: 'n:' + cred.name, name: cred.name };
    },
    // 주간 스케줄의 "구성원" 표에서 내 이름을 찾아 직급·팀을 가져온다
    async profile() {
      const [ms, ts] = await Promise.all([space.child('data/members').once('value'), space.child('data/mteams').once('value')]);
      const list = (v) => (Array.isArray(v) ? v : Object.values(v || {})).filter(Boolean);
      const norm = (s) => String(s || '').replace(/\s+/g, '');
      const me = list(ms.val()).find((m) => norm(m.name) === norm(cred.name));
      if (!me) return {};
      const team = list(ts.val()).find((t) => t.id === me.teamId);
      return { rank: me.rank || '', team: team ? team.name : '' };
    },
    async events(from, to) {
      const [band, items] = await Promise.all([space.child('band').once('value'), space.child('calendar/items').once('value')]);
      const b = band.val() || {};
      const f = new Date(from), t = new Date(to);
      const inRange = (e) => e && e.start && new Date(e.start) < t && new Date(e.end) > f;
      const list = [
        ...(Array.isArray(b.events) ? b.events : Object.values(b.events || {})).filter(inRange).map((e) => ({ ...e, source: 'band' })),
        ...Object.entries(items.val() || {}).map(([id, e]) => ({ ...e, id, source: 'web' })).filter(inRange),
      ];
      list.sort((x, y) => x.start.localeCompare(y.start));
      return {
        events: list,
        status: { bandConnected: !!b.lastSync, error: b.error || '', lastSync: b.lastSync || null, bandCount: b.count || 0, bandUrl: b.bandUrl || '', cloud: true },
      };
    },
    async add(body) { const r = space.child('calendar/items').push(); await r.set(cleanItem(body, cred.name)); return { id: r.key }; },
    async update(id, body) { await space.child('calendar/items/' + id).set(cleanItem(body, cred.name)); return { id }; },
    async remove(id) { await space.child('calendar/items/' + id).remove(); return { ok: true }; },
  };

  // 로그인 창 (클라우드 방식)
  function askCred(err) {
    let g = document.getElementById('wsGate');
    if (!g) {
      g = document.createElement('div');
      g.id = 'wsGate';
      g.className = 'gate';
      g.innerHTML = `<form class="gate-card" autocomplete="off">
        <h1>SPACEBASE</h1><p>처음 한 번만 입력하면 다음부터는 바로 열려요.</p>
        <input name="code" type="password" placeholder="회사 비밀번호">
        <input name="name" placeholder="이름 (예: 홍길동)" maxlength="20">
        <div class="dlg-err"></div><button class="btn primary">시작하기</button></form>`;
      document.body.append(g);
    }
    const f = g.querySelector('form'), em = g.querySelector('.dlg-err');
    const c = getCred();
    if (c) { f.code.value = c.code; f.name.value = c.name; }
    em.textContent = err || '';
    g.classList.remove('hidden');
    setTimeout(() => (f.code.value ? f.name : f.code).focus(), 30);
    return new Promise((resolve) => {
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const code = f.code.value.trim(), name = f.name.value.trim().slice(0, 20);
        if (code.length < 4) { em.textContent = '회사 비밀번호는 4자 이상이어야 해요.'; return; }
        if (!name) { em.textContent = '이름을 입력해 주세요.'; return; }
        setCred({ code, name });
        g.classList.add('hidden');
        resolve({ code, name });
      };
    });
  }

  // 서버가 있으면 서버 방식, 없으면(정적 호스팅) Firebase 방식
  const data = (async () => {
    let server = false;
    try { const r = await fetch('api/auth-config'); server = r.ok && (await r.json()).app === 'spacebase-schedule'; } catch {}
    const be = server || !(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) ? serverBackend : cloudBackend;
    if (be.mode === 'cloud') {
      document.getElementById('wsLogout').addEventListener('click', (e) => {
        e.preventDefault();
        if (!confirm('이 기기에서 로그아웃할까요? 다음에 회사 비밀번호와 이름을 다시 입력해야 해요.')) return;
        try { localStorage.removeItem('sb_cred'); } catch {}
        location.reload();
      });
    }
    // 사이트에서 추가한 일정을 밴드에도 등록하면, 밴드 쪽 일정이 들어온 뒤로는 같은 날 같은 제목의 사이트 일정을 숨긴다 (중복 표시 방지)
    const rawEvents = be.events;
    be.events = async (from, to) => {
      const r = await rawEvents(from, to);
      const key = (e) => ymd(e.start) + '|' + String(e.title || '').replace(/\s+/g, '').toLowerCase();
      const band = new Set(r.events.filter((e) => e.source === 'band').map(key));
      r.events = r.events.filter((e) => e.source !== 'web' || !band.has(key(e)));
      return r;
    };
    const user = await be.start();
    if (user) document.getElementById('wsName').textContent = user.name + ' 님';
    return { ...be, user };
  })();
  data.catch((e) => console.error(e));

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
    if (e.source === 'band' && /^https:\/\//.test(e.url || '')) { const a = document.createElement('a'); a.className = 'btn'; a.href = e.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '밴드에서 보기'; foot.append(a); }
    (actions || []).forEach((x) => foot.append(x));
    const sp = document.createElement('span'); sp.className = 'spacer'; foot.append(sp);
    const c = document.createElement('button'); c.className = 'btn'; c.textContent = '닫기'; c.onclick = () => dlg.close(); foot.append(c);
    dlg.showModal();
  }

  const bandMissingText = (st) => st.cloud
    ? '밴드 캘린더가 아직 연결되지 않았어요. GitHub 저장소 설정에 밴드 구독 주소(BAND_ICAL_URL)와 회사 비밀번호(SB_CODE)를 넣으면 5분마다 밴드 일정이 자동으로 들어와요.'
    : '밴드 캘린더가 아직 연결되지 않았어요. 관리자가 서버 설정에 밴드 구독 주소(BAND_ICAL_URL)를 넣으면 밴드 일정이 자동으로 보여요.';

  window.WS = { esc, ymd, hm, dayLabel, addDays, daysOf, whenText, data, showEvent, WD, bandMissingText, closeEvent: () => dlg.close() };
})();
