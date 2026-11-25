// 워크스페이스 공통: 상단 메뉴, 로그인, 날짜 도우미, 일정 데이터, 일정 상세 팝업
//
// 두 가지 방식으로 동작한다.
// - 서버 방식: server.js 가 있는 곳 (회사 PC 등). 로그인과 일정은 서버 API 를 쓴다.
// - 클라우드 방식: 서버 없이 정적 파일만 올린 곳 (GitHub Pages 등). 주간 스케줄과 같은 방법으로
//   "회사 비밀번호 + 이름"을 입력하고, 일정은 Firebase 의 spaces/<비밀번호 해시>/ 아래에 저장한다.
//   밴드 일정은 GitHub Actions(.github/workflows/band-calendar.yml)가 15분마다 spaces/<해시>/band 에 넣어 준다.
(function () {
  const TABS = [
    { href: './', key: 'home', label: 'Home', ic: '<svg class="si" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5"/></svg>' },
    { href: 'schedule.html', key: 'schedule', label: 'Weekly Schedule', ic: '<svg class="si" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M7 13h6M10 16.5h7"/></svg>' },
    { href: 'calendar.html', key: 'calendar', label: 'Calendar', ic: '<svg class="si" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8" cy="14.5" r="1" fill="currentColor"/><circle cx="12" cy="14.5" r="1" fill="currentColor"/><circle cx="16" cy="14.5" r="1" fill="currentColor"/><circle cx="8" cy="18" r="1" fill="currentColor"/><circle cx="12" cy="18" r="1" fill="currentColor"/></svg>' },
  ];
  // Band(회사 게시판): 메뉴는 항상 보이고, 구글 로그인이 꺼진 기기에서는 Band 화면이 "구글 로그인으로 들어가기" 버튼을 보여 준다
  // (아이폰은 설치한 앱이 Safari 와 저장 공간을 따로 써서, 앱 안에서 켤 수 있어야 함)
  if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && location.protocol !== 'file:') TABS.push({ href: 'band.html', key: 'band', label: 'Band', ic: '<svg class="si" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>' });
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

  // 밴드 자동 입력 확장 프로그램 설치 권유 (쿠키 안내처럼 아래에 뜸). PC 크롬·엣지·웨일에서, 아직 안 깔았을 때만.
  // "나중에"를 누르면 7일 동안 다시 안 뜬다. 설치 안내 화면에서는 띄우지 않는다.
  setTimeout(() => {
    try {
      const pc = !/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && /Chrome\//.test(navigator.userAgent);
      const later = +localStorage.getItem('sbe_ext_later') || 0;
      if (!pc || document.documentElement.dataset.sbeExt || /band-extension/.test(location.pathname) || Date.now() - later < 7 * 864e5) return;
      const bar = document.createElement('div');
      bar.className = 'extbar';
      bar.innerHTML = `<span><b>밴드 자동 입력</b>을 설치하면 이 사이트에서 쓴 일정이 밴드 "일정 만들기" 창에 자동으로 채워져요. (PC에서 1분, 한 번만)</span>
        <a class="btn primary" href="band-extension.html">설치하기</a><button class="btn" type="button">나중에</button>`;
      bar.querySelector('button').onclick = () => { try { localStorage.setItem('sbe_ext_later', String(Date.now())); } catch {} bar.remove(); };
      document.body.append(bar);
    } catch {}
  }, 1500);

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
  // 구글 로그인(auth.js)을 쓰면 회사 비밀번호 대신 회원 정보로 이름을 정한다.
  let authCred = null;
  const getCred = () => { if (authCred) return authCred; try { const c = JSON.parse(localStorage.getItem('sb_cred') || 'null'); return c && c.code && c.name ? c : null; } catch { return null; } };
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
  const srcCls = (e) => (e.source === 'web' ? 'web' : e.source === 'google' ? 'gc' : '');
  let space = null, cred = null;
  // 밴드 일정을 열 때마다 바로 읽기: 중계(worker/band-relay.js)에서 최신 iCal 을 받아 브라우저에서 바꾼다.
  // 바뀐 내용은 Firebase 에도 저장해 둔다 (중계가 안 될 때 대신 보여줄 내용).
  let liveCache = null;
  // 개인 구글 캘린더: 비공개 iCal 주소를 이 브라우저(이름별)에만 저장 → 본인 화면에만 보인다. 서버·Firebase 에는 저장하지 않는다.
  const gcalKey = () => 'sb_gcal:' + ((getCred() || {}).name || '');
  const getGcal = () => { try { return localStorage.getItem(gcalKey()) || ''; } catch { return ''; } };
  const setGcal = (v) => { try { v ? localStorage.setItem(gcalKey(), v) : localStorage.removeItem(gcalKey()); } catch {} gcalCache = null; };
  let gcalCache = null;
  async function liveGcal() {
    const api = String(window.SB_BAND_API || '').replace(/\/$/, ''), url = getGcal();
    if (!url || !api || !window.BandIcs || !window.ICAL) return null;
    if (gcalCache && gcalCache.url === url && Date.now() - gcalCache.at < 60000) return gcalCache.events;
    const r = await fetch(api + '/gcal', { method: 'POST', headers: { 'X-SB-Key': space.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), cache: 'no-store' });
    if (!r.ok) throw new Error((await r.text()).slice(0, 120) || '응답 ' + r.status);
    const now = Date.now();
    const events = BandIcs.parseIcs(await r.text(), new Date(now - 100 * 864e5), new Date(now + 400 * 864e5), '')
      .map((e) => ({ ...e, id: 'gcal:' + e.id.slice(5), source: 'google', url: '' }));
    gcalCache = { url, at: now, events };
    return events;
  }
  // 개인 구글 캘린더 "구글 계정으로 연결": 연결 정보(암호화된 것)는 이 브라우저(이름별)에만 저장하고,
  // 일정은 구글 캘린더 API 에서 직접 읽는다. 다른 사람 화면에는 보이지 않는다. (중계: worker/google.js)
  const relay = () => String(window.SB_BAND_API || '').replace(/\/$/, '');
  const myName = () => (getCred() || {}).name || '';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const gAcc = () => lsGet('sb_google:' + myName(), null);
  let gTok = null, gCache = null, gCals = null;
  const gReset = () => { gTok = null; gCache = null; gCals = null; };
  // 구글 연결 후 돌아왔을 때 (#gconn=...)
  (() => {
    const hp = new URLSearchParams(location.hash.slice(1));
    if (!hp.has('gconn')) return;
    const blob = hp.get('gconn');
    history.replaceState(null, '', location.pathname + location.search);
    if (blob && blob !== 'cancel') { lsSet('sb_google_pending', { blob, email: hp.get('gemail') || '', name: hp.get('gname') || '', at: Date.now() }); }
  })();
  function gClaimPending() {
    const p = lsGet('sb_google_pending', null);
    if (!p || !myName()) return;
    lsSet('sb_google_pending', null);
    if (Date.now() - p.at < 10 * 60 * 1000) { lsSet('sb_google:' + myName(), { blob: p.blob, email: p.email, name: p.name }); lsSet('sb_gsel:' + myName(), null); gReset(); }
  }
  async function gToken() {
    const acc = gAcc();
    if (!acc) return null;
    if (gTok && gTok.exp > Date.now() + 60000) return gTok.tok;
    const r = await fetch(relay() + '/google/token', { method: 'POST', headers: { 'X-G-Token': acc.blob }, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('구글 연결이 끊겼어요. "내 구글 캘린더"에서 다시 연결해 주세요.');
    if (!r.ok || !j.access_token) throw new Error(j.error || '응답 ' + r.status);
    gTok = { tok: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return gTok.tok;
  }
  async function gApi(path) {
    const r = await fetch('https://www.googleapis.com/calendar/v3' + path, { headers: { Authorization: 'Bearer ' + await gToken() } });
    if (!r.ok) throw new Error('구글 캘린더 응답 ' + r.status);
    return r.json();
  }
  // 구글 할 일(Tasks): 이 브라우저가 구글에서 직접 읽고 쓴다
  const TASKS = 'https://tasks.googleapis.com/tasks/v1';
  async function gFetch(url, opt = {}) {
    const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + await gToken(), ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (r.status === 403 || r.status === 401) { const e = new Error('구글 할 일 권한이 없어요. 구글을 한 번 다시 연결해 주세요.'); e.code = 'scope'; throw e; }
    if (!r.ok) throw new Error('구글 할 일 응답 ' + r.status);
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  const dueOf = (day) => day + 'T00:00:00.000Z';
  const nextDay = (day) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  const tasksApi = {
    async lists() { const j = await gFetch(TASKS + '/users/@me/lists?maxResults=100'); return (j && j.items || []).map((l) => ({ id: l.id, name: l.title })); },
    async onDay(listId, day) {
      const q = `dueMin=${encodeURIComponent(dueOf(day))}&dueMax=${encodeURIComponent(dueOf(nextDay(day)))}&showCompleted=true&showHidden=true&maxResults=100`;
      const j = await gFetch(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks?${q}`);
      return (j && j.items || []).filter((t) => t.title).map((t) => ({ id: t.id, title: t.title, notes: t.notes || '', done: t.status === 'completed', link: t.webViewLink || '' }))
        .sort((a, b) => a.done - b.done);
    },
    add: (listId, title, day) => gFetch(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks`, { method: 'POST', body: JSON.stringify({ title, due: dueOf(day) }) }),
    setDone: (listId, id, done) => gFetch(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(done ? { status: 'completed' } : { status: 'needsAction', completed: null }) }),
    remove: (listId, id) => gFetch(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getList: () => lsGet('sb_tlist:' + myName(), ''),
    setList: (id) => lsSet('sb_tlist:' + myName(), id),
  };
  async function gCalendars(force) {
    if (gCals && !force) return gCals;
    const j = await gApi('/users/me/calendarList?minAccessRole=reader&maxResults=250');
    gCals = (j.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#2f9e5b', primary: !!c.primary, selected: !!c.selected, readOnly: !/owner|writer/.test(c.accessRole) }));
    gCals.sort((a, b) => (b.primary - a.primary));
    return gCals;
  }
  const gSel = (cals) => { const v = lsGet('sb_gsel:' + myName(), null); return Array.isArray(v) ? v : cals.filter((c) => c.primary || c.selected).map((c) => c.id); };
  const kst = (d) => new Date(d + 'T00:00:00+09:00');
  async function googleEvents(from, to) {
    const key = from + '|' + to + '|' + JSON.stringify(lsGet('sb_gsel:' + myName(), null));
    if (gCache && gCache.key === key && Date.now() - gCache.at < 60000) return gCache.events;
    const cals = await gCalendars(), sel = new Set(gSel(cals));
    const q = `timeMin=${encodeURIComponent(new Date(from).toISOString())}&timeMax=${encodeURIComponent(new Date(to).toISOString())}&singleEvents=true&orderBy=startTime&maxResults=2500`;
    const lists = await Promise.all(cals.filter((c) => sel.has(c.id)).map(async (c) => {
      const j = await gApi(`/calendars/${encodeURIComponent(c.id)}/events?${q}`);
      return (j.items || []).filter((it) => it.status !== 'cancelled' && it.start).map((it) => {
        const allDay = !!it.start.date;
        const s = allDay ? kst(it.start.date) : new Date(it.start.dateTime);
        let e = allDay ? kst(it.end.date) : new Date(it.end.dateTime);
        if (e <= s) e = new Date(s.getTime() + 1000);
        return { id: 'g:' + c.id + ':' + it.id, title: it.summary || '(제목 없음)', start: s.toISOString(), end: e.toISOString(), allDay, source: 'google',
          description: it.description || '', location: it.location || '', url: it.htmlLink || '', color: it.colorId ? '' : c.color, calName: c.name };
      });
    }));
    const events = lists.flat();
    gCache = { key, at: Date.now(), events };
    lsSet('sb_gsync:' + myName(), new Date().toISOString());
    return events;
  }
  const googleApi = {
    enabled: () => !!window.SB_GOOGLE_LOGIN && !!relay(),
    account: () => gAcc(),
    lastSync: () => lsGet('sb_gsync:' + myName(), null),
    connect: () => { location.href = relay() + '/google/login?return=' + encodeURIComponent(location.origin + location.pathname); },
    async disconnect() {
      const acc = gAcc();
      if (acc) await fetch(relay() + '/google/revoke', { method: 'POST', headers: { 'X-G-Token': acc.blob } }).catch(() => {});
      lsSet('sb_google:' + myName(), null); lsSet('sb_gsel:' + myName(), null); lsSet('sb_gsync:' + myName(), null); gReset();
    },
    calendars: (force) => gCalendars(force),
    selected: async () => gSel(await gCalendars()),
    setSelected: (ids) => { lsSet('sb_gsel:' + myName(), ids); gCache = null; },
    refresh: () => { gCache = null; gCals = null; },
    tasks: tasksApi,
  };
  async function liveBand(saved) {
    const api = String(window.SB_BAND_API || '').replace(/\/$/, '');
    if (!api || !window.BandIcs || !window.ICAL) return null;
    if (liveCache && Date.now() - liveCache.at < 30000) return liveCache.band;
    const r = await fetch(api + '/ics', { headers: { 'X-SB-Key': space.key }, cache: 'no-store' });
    if (!r.ok) throw new Error('중계 응답 ' + r.status);
    console.info('[밴드]', r.headers.get('X-Band-Info') || '');
    const now = Date.now();
    const events = BandIcs.parseIcs(await r.text(), new Date(now - 100 * 864e5), new Date(now + 400 * 864e5), saved.bandUrl || 'https://www.band.us');
    const rev = BandIcs.key(JSON.stringify(events));
    const band = { ...saved, events, count: events.length, lastSync: new Date(now).toISOString(), error: '', rev, live: true };
    if (saved.rev !== rev) space.child('band').update({ events, count: events.length, lastSync: band.lastSync, error: '', rev }).catch(() => {});
    liveCache = { at: now, band };
    return band;
  }
  const cloudBackend = {
    mode: 'cloud',
    async start() {
      if (window.SBAuth && SBAuth.enabled()) {
        const a = await SBAuth.start();
        authCred = cred = { name: a.name, code: '' };
        space = firebase.database().ref('spaces/' + a.spaceKey);
        gClaimPending();
        return { id: 'u:' + a.uid, name: a.name, admin: a.admin, google: true };
      }
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
      gClaimPending();
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
      let b = band.val() || {};
      try { b = (await liveBand(b)) || b; } catch (e) { console.warn('밴드 바로 읽기 실패, 저장된 일정 표시:', e.message); }
      let mine = [], gcalError = '';
      try { mine = (gAcc() ? await googleEvents(from, to) : await liveGcal()) || []; } catch (e) { gcalError = '내 구글 캘린더를 읽지 못했어요: ' + e.message; }
      const f = new Date(from), t = new Date(to);
      const inRange = (e) => e && e.start && new Date(e.start) < t && new Date(e.end) > f;
      const list = [
        ...(Array.isArray(b.events) ? b.events : Object.values(b.events || {})).filter(inRange).map((e) => ({ ...e, source: 'band' })),
        ...Object.entries(items.val() || {}).map(([id, e]) => ({ ...e, id, source: 'web' })).filter(inRange),
        ...mine.filter(inRange),
      ];
      list.sort((x, y) => x.start.localeCompare(y.start));
      return {
        events: list,
        status: { bandConnected: !!b.lastSync, error: b.error || '', lastSync: b.lastSync || null, bandCount: b.count || 0, bandUrl: b.bandUrl || '', cloud: true, live: !!b.live, gcal: !!(gAcc() || getGcal()), gcalCount: mine.length, gcalError },
      };
    },
    getGcal, setGcal, google: googleApi,
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
        const g = window.SBAuth && SBAuth.enabled();
        if (!confirm(g ? '이 기기에서 로그아웃할까요? 다음에 구글로 다시 로그인하면 돼요.' : '이 기기에서 로그아웃할까요? 다음에 회사 비밀번호와 이름을 다시 입력해야 해요.')) return;
        try { localStorage.removeItem(gcalKey()); localStorage.removeItem('sb_google:' + myName()); localStorage.removeItem('sb_gsel:' + myName()); localStorage.removeItem('sb_cred'); } catch {}
        if (g) return SBAuth.signOut();
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
    // Band 화면인데 구글 로그인이 꺼져 있으면 회사 비밀번호 창을 띄우지 않는다 (Band 화면이 안내함)
    if (be.mode === 'cloud' && page === 'band' && !(window.SBAuth && SBAuth.enabled())) return { ...be, user: null };
    const user = await be.start();
    if (user) document.getElementById('wsName').textContent = user.name + ' 님';
    // 관리자에게만 "회원 관리" 링크
    if (user && user.admin) {
      const a = document.createElement('a'); a.href = 'members.html'; a.id = 'wsMembers'; a.textContent = '회원 관리';
      document.getElementById('wsLogout').before(a);
    }
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
    const src = e.source === 'band' ? '밴드 캘린더' : e.source === 'google' ? `내 구글 캘린더${e.calName ? ' · ' + esc(e.calName) : ''} (나만 보여요)` : `직접 추가 · ${esc(e.by || '')}`;
    dlg.querySelector('#evBody').innerHTML = `<div class="meta">${when}</div>
      <div class="meta"><span class="dot ${srcCls(e)}"></span> ${src}</div>
      ${e.location ? `<div>📍 ${esc(e.location)}</div>` : ''}
      ${e.description ? `<div>${esc(e.description)}</div>` : ''}`;
    const foot = dlg.querySelector('#evFoot');
    foot.innerHTML = '';
    if (e.source === 'google' && /^https:\/\//.test(e.url || '')) { const a = document.createElement('a'); a.className = 'btn'; a.href = e.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '구글 캘린더에서 보기'; foot.append(a); }
    if (e.source === 'band' && /^https:\/\//.test(e.url || '')) { const a = document.createElement('a'); a.className = 'btn'; a.href = e.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '밴드에서 보기'; foot.append(a); }
    (actions || []).forEach((x) => foot.append(x));
    const sp = document.createElement('span'); sp.className = 'spacer'; foot.append(sp);
    const c = document.createElement('button'); c.className = 'btn'; c.textContent = '닫기'; c.onclick = () => dlg.close(); foot.append(c);
    dlg.showModal();
  }

  const bandMissingText = (st) => st.cloud
    ? '밴드 캘린더가 아직 연결되지 않았어요. GitHub 저장소 설정에 밴드 구독 주소(BAND_ICAL_URL)와 회사 비밀번호(SB_CODE)를 넣으면 밴드 일정이 자동으로 들어와요.'
    : '밴드 캘린더가 아직 연결되지 않았어요. 관리자가 서버 설정에 밴드 구독 주소(BAND_ICAL_URL)를 넣으면 밴드 일정이 자동으로 보여요.';

  // 구글 할 일 (To Do List) 칸. 홈과 캘린더가 같이 쓴다. 나에게만 보인다.
  function todoWidget(root) {
    root.innerHTML = `<h2>TO DO LIST <small class="tdToday"></small></h2>
      <div class="dayrow"><div class="day"></div><div class="dnav"><button type="button" data-d="-1" title="이전 날">‹</button><button type="button" data-go="0">오늘</button><button type="button" data-go="1">내일</button><button type="button" data-d="1" title="다음 날">›</button></div></div>
      <form class="hidden"><input name="t" placeholder="+ 할 일 추가 (Enter)" maxlength="300" autocomplete="off"><select title="할 일 목록"></select></form>
      <ul></ul><div class="tmsg"></div>`;
    const q = (sel) => root.querySelector(sel), form = q('form'), sel = q('select'), ul = q('ul'), msg = q('.tmsg');
    let day = '', seq = 0, lists = null;
    const today = ymd(new Date());
    const showMsg = (html) => { form.classList.add('hidden'); ul.innerHTML = ''; msg.innerHTML = html; };
    const connectBtn = (G, label) => { const b = q('.tdConnect'); if (b) b.onclick = () => { try { sessionStorage.setItem('sb_gjust', '1'); } catch {} G.connect(); }; };
    async function show(d) {
      day = d || day || today; const my = ++seq;
      q('.day').textContent = dayLabel(day); q('.tdToday').textContent = day === today ? '· 오늘' : day === addDays(today, 1) ? '· 내일' : '';
      { const [, m, dd] = day.split('-').map(Number); form.t.placeholder = `+ ${day === today ? '오늘' : day === addDays(today, 1) ? '내일' : m + '월 ' + dd + '일'} 할 일 추가 (Enter)`; }
      root.querySelectorAll('.dnav [data-go]').forEach((b) => b.classList.toggle('on', day === addDays(today, +b.dataset.go)));
      const be = await data, G = be.google;
      if (!G || !G.enabled()) return showMsg('구글 할 일은 웹사이트에서 구글 계정을 연결했을 때 보여요.');
      if (!G.account()) { showMsg('구글 계정을 연결하면 구글 할 일(Tasks)이 여기에 보여요. 나에게만 보여요.<br><button class="btn primary tdConnect" type="button">구글 계정으로 연결</button>'); return connectBtn(G); }
      const T = G.tasks;
      try {
        if (!lists) lists = await T.lists();
        if (!lists.length) return showMsg('구글 할 일 목록이 없어요.');
        let lid = T.getList(); if (!lists.some((l) => l.id === lid)) lid = lists[0].id;
        sel.innerHTML = lists.map((l) => `<option value="${esc(l.id)}" ${l.id === lid ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
        sel.classList.toggle('hidden', lists.length < 2);
        const items = await T.onDay(lid, day);
        if (my !== seq) return;
        form.classList.remove('hidden'); msg.innerHTML = items.length ? '' : '이 날의 할 일이 없어요.<br>위에서 추가해 보세요.';
        ul.innerHTML = items.map((t) => `<li class="${t.done ? 'done' : ''}" data-tid="${esc(t.id)}"><input type="checkbox" ${t.done ? 'checked' : ''} aria-label="완료"><span class="tt">${esc(t.title)}${t.notes ? `<small>${esc(t.notes)}</small>` : ''}</span><button class="del" type="button" title="삭제">✕</button></li>`).join('');
      } catch (e) {
        if (my !== seq) return;
        lists = null;
        if (e.code === 'scope') { showMsg('할 일을 보려면 구글을 한 번 <b>다시 연결</b>해 주세요. (할 일 권한이 새로 추가됐어요)<br><button class="btn primary tdConnect" type="button">구글 다시 연결</button>'); connectBtn(G); }
        else showMsg('구글 할 일을 불러오지 못했어요. (' + esc(e.message) + ')');
      }
    }
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const inp = form.t, title = inp.value.trim(); if (!title) return;
      inp.disabled = true;
      try { await (await data).google.tasks.add(sel.value, title, day); inp.value = ''; await show(day); }
      catch (e) { msg.textContent = '추가하지 못했어요: ' + e.message; }
      finally { inp.disabled = false; inp.focus(); }
    };
    // 날짜 옮기기: 오늘 / 내일 / 하루씩 앞뒤로. 보이는 날짜에 할 일이 추가된다.
    q('.dnav').onclick = (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      show(b.dataset.go != null ? addDays(today, +b.dataset.go) : addDays(day, +b.dataset.d));
    };
    sel.onchange = async () => { (await data).google.tasks.setList(sel.value); show(day); };
    ul.onclick = async (ev) => {
      const li = ev.target.closest('li[data-tid]'); if (!li) return;
      const T = (await data).google.tasks;
      try {
        if (ev.target.matches('input[type=checkbox]')) { li.classList.toggle('done', ev.target.checked); await T.setDone(sel.value, li.dataset.tid, ev.target.checked); }
        else if (ev.target.closest('.del')) { if (!confirm('이 할 일을 삭제할까요? 구글 할 일에서도 지워져요.')) return; await T.remove(sel.value, li.dataset.tid); show(day); }
      } catch (e) { msg.textContent = '바꾸지 못했어요: ' + e.message; }
    };
    return { show, reset: () => { lists = null; } };
  }

  window.WS = { todoWidget, srcCls, esc, ymd, hm, dayLabel, addDays, daysOf, whenText, data, showEvent, WD, bandMissingText, closeEvent: () => dlg.close() };
})();
