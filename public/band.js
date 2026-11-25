// Band: 회사 게시판 (네이버 밴드 대신). 글·댓글은 Firebase board/ 에 저장, 회원(구글 로그인 + 관리자 승인)만 읽고 쓴다.
// 규칙: firebase/database.rules.json 의 board. 글은 지우면 deleted 표시만 남김 (휴지통은 다음 단계).
// - 프로젝트 글 = 현장 방 (siteName). 현장 사진·A/S 글은 현장을 고르면 site(프로젝트 글 id) + siteName 을 가진다.
// - A/S 글은 asState {status: new|doing|done, owner, by, at} — 회원 누구나 바꿀 수 있다.
// - 주소: band.html#site=<프로젝트 글 id> (현장 방), band.html#post=<글 id> (글 바로 열기)
(function () {
  const CATS = [
    { key: '', label: '전체' },
    { key: 'photo', label: '현장 사진' },
    { key: 'as', label: 'A/S' },
    { key: 'project', label: '프로젝트' },
    { key: 'notice', label: '공지·자유글' },
  ];
  const AS = { new: '접수', doing: '처리 중', done: '완료' };
  const catLabel = (k) => (CATS.find((c) => c.key === k) || {}).label || '';
  const $ = (s) => document.querySelector(s);
  const esc = WS.esc;
  const PAGE = 50;

  let me = null, db = null, posts = [], limit = PAGE, cat = '', query = '', openId = null, cmtRef = null;
  let projects = {}, staff = [], site = null, sitePosts = [], siteRef = null, asOpenOnly = false;
  try { cat = sessionStorage.getItem('bd_cat') || ''; asOpenOnly = sessionStorage.getItem('bd_asopen') === '1'; } catch {}

  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    const d = new Date(t), now = new Date();
    const opt = { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opt.year = 'numeric';
    return d.toLocaleDateString('ko-KR', opt) + ' ' + WS.hm(d);
  }
  // 찾는 글자에 노란 표시 (글자를 먼저 나눈 뒤 각각 안전하게 바꿈)
  const mark = (raw) => {
    raw = String(raw == null ? '' : raw);
    if (!query) return esc(raw);
    const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return raw.split(re).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
  };
  const canEdit = (p) => me && (p.uid === me.uid || me.admin);
  const asStatus = (p) => (p.asState && p.asState.status) || 'new';
  const ICON_CMT = '<svg class="si" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>';
  const ICON_PIN = '<svg class="si" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';
  const siteChip = (p) => (p.site && p.siteName ? `<a class="bd-site" href="#site=${encodeURIComponent(p.site)}" title="현장 방 열기">${ICON_PIN}${mark(p.siteName)}</a>`
    : p.siteName && p.cat !== 'project' ? `<span class="bd-site plain">${ICON_PIN}${mark(p.siteName)}</span>` : '');
  const asBadge = (p) => {
    if (p.cat !== 'as') return '';
    const o = String((p.asState && p.asState.owner) || '').split(',').map((s) => s.trim()).filter(Boolean);
    return `<span class="bd-as ${asStatus(p)}">${AS[asStatus(p)]}${o.length ? ' · ' + esc(o[0]) + (o.length > 1 ? ` 외 ${o.length - 1}명` : '') : ''}</span>`;
  };

  // ---------- 목록 ----------
  function drawCats() {
    const list = site ? CATS.filter((c) => ['', 'photo', 'as'].includes(c.key)) : CATS;
    $('#cats').innerHTML = list.map((c) => `<button type="button" data-k="${c.key}" class="${c.key === cat ? 'on' : ''}">${c.label}</button>`).join('')
      + (cat === 'as' ? `<label class="bd-toggle"><input type="checkbox" id="asOpen" ${asOpenOnly ? 'checked' : ''}> 안 끝난 A/S만</label>` : '');
    const t = $('#asOpen');
    if (t) t.onchange = () => { asOpenOnly = t.checked; try { sessionStorage.setItem('bd_asopen', asOpenOnly ? '1' : ''); } catch {} drawList(); };
  }
  $('#cats').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    cat = b.dataset.k; if (!site) try { sessionStorage.setItem('bd_cat', cat); } catch {}
    drawCats(); drawList();
  };
  let qt = 0;
  $('#q').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { query = $('#q').value.trim(); drawList(); }, 150); };

  function card(p) {
    const pj = p.cat === 'project';
    const n = pj ? sitePostCount(p.id) : null;
    return `
      <article class="bd-post" data-id="${esc(p.id)}" tabindex="0">
        <div class="bd-meta"><span class="bd-chip ${esc(p.cat)}">${catLabel(p.cat)}</span>${asBadge(p)}<b>${mark(p.name)}</b><span>${ago(p.at)}${p.editedAt ? ' · 수정됨' : ''}</span></div>
        ${pj ? `<div class="bd-ptitle">${mark(p.siteName)}${p.closed ? ' <span class="bd-as done">끝난 현장</span>' : ''}</div>` : siteChip(p) ? `<div class="bd-sitebar">${siteChip(p)}</div>` : ''}
        <div class="bd-text">${mark(p.text)}</div>
        <div class="bd-foot"><span>${ICON_CMT}댓글 ${p.commentCount || 0}</span>${pj ? `<a class="bd-room" href="#site=${encodeURIComponent(p.id)}">현장 방 열기${n ? ` (글 ${n})` : ''} ›</a>` : ''}</div>
      </article>`;
  }
  // 현장 방 글 수는 지금 불러온 글에서 센다 (정확한 수는 현장 방에서)
  const sitePostCount = (id) => posts.filter((x) => x.site === id && !x.deleted).length;

  function drawList() {
    const q = query.toLowerCase();
    const base = site ? sitePosts : posts;
    const shown = base.filter((p) => !p.deleted && (!cat || p.cat === cat) && !(cat === 'as' && asOpenOnly && asStatus(p) === 'done')
      && (!q || (p.text + ' ' + p.name + ' ' + (p.siteName || '') + ' ' + ((p.asState && p.asState.owner) || '')).toLowerCase().includes(q)));
    $('#msg').textContent = query ? `"${query}" 찾은 글 ${shown.length}개` + (!site && posts.length >= limit ? ' (최근 글에서 찾았어요. 아래 "이전 글 더 보기"를 누르면 더 찾아요)' : '') : '';
    $('#more').classList.toggle('hidden', !!site || posts.length < limit);
    if (!shown.length) {
      const where = site ? '이 현장에' : cat ? catLabel(cat) + ' 게시판에' : '';
      $('#list').innerHTML = `<div class="bd-empty">${query ? '찾는 글이 없어요.' : cat === 'as' && asOpenOnly ? '안 끝난 A/S 가 없어요. 👍' : `${where} 아직 글이 없어요.<br>오른쪽 아래 <b>글쓰기</b>로 첫 글을 올려 보세요.`}</div>`;
      return;
    }
    $('#list').innerHTML = shown.map(card).join('');
  }
  $('#list').onclick = (e) => {
    if (e.target.closest('a')) return; // 현장 칩·현장 방 링크
    const a = e.target.closest('.bd-post'); if (a) openPost(a.dataset.id);
  };
  $('#list').onkeydown = (e) => { if (e.key === 'Enter' && !e.target.closest('a')) { const a = e.target.closest('.bd-post'); if (a) openPost(a.dataset.id); } };
  $('#more').onclick = () => { limit += PAGE; listen(); };

  const findPost = (id) => posts.find((x) => x.id === id) || sitePosts.find((x) => x.id === id) || (projects[id] && { id, ...projects[id] });
  function refreshOpen() { if (openId) { const p = findPost(openId); if (p && !p.deleted) drawPost(p); } }

  let listRef = null;
  function listen() {
    if (listRef) listRef.off();
    listRef = db.ref('board/posts').orderByChild('at').limitToLast(limit);
    listRef.on('value', (s) => {
      const out = [];
      s.forEach((c) => { out.push({ id: c.key, ...c.val() }); });
      posts = out.reverse();
      if (!site) drawList();
      refreshOpen();
    }, (e) => { $('#msg').textContent = '글을 불러오지 못했어요: ' + e.message; });
  }
  // 현장(프로젝트) 목록: 글쓰기의 "현장 고르기"와 현장 방 머리에 쓴다
  function listenProjects() {
    db.ref('board/posts').orderByChild('cat').equalTo('project').on('value', (s) => {
      projects = {};
      s.forEach((c) => { const v = c.val(); if (!v.deleted) projects[c.key] = v; });
      if (site) drawSiteHead();
    });
  }

  // ---------- 현장 방 ----------
  function drawSiteHead() {
    const p = projects[site];
    const el = $('#siteHead');
    if (!p) { el.innerHTML = '<a class="bd-back" href="#">‹ Band</a><div class="bd-empty">없는 현장이거나 지워진 현장이에요.</div>'; return; }
    const as = sitePosts.filter((x) => x.cat === 'as' && !x.deleted);
    const open = as.filter((x) => asStatus(x) !== 'done').length;
    el.innerHTML = `<a class="bd-back" href="#">‹ Band</a>
      <div class="bd-sitecard"><div class="bd-meta"><span class="bd-chip project">현장 방</span>${p.closed ? '<span class="bd-as done">끝난 현장</span>' : ''}<span>${esc(p.name)} · ${ago(p.at)}</span></div>
      <h1>${esc(p.siteName)}</h1><div class="bd-text">${esc(p.text)}</div>
      <div class="bd-foot"><span>현장 사진 ${sitePosts.filter((x) => x.cat === 'photo' && !x.deleted).length}</span><span>A/S ${as.length}${open ? ` (안 끝남 ${open})` : ''}</span><button class="bd-link" type="button" id="openProj">프로젝트 글 · 댓글 ${p.commentCount || 0} ›</button></div></div>`;
    $('#openProj').onclick = () => openPost(site);
  }
  function route() {
    const h = new URLSearchParams(location.hash.slice(1));
    const s = h.get('site'), p = h.get('post');
    if (s !== site) {
      if (siteRef) { siteRef.off(); siteRef = null; }
      site = s || null; sitePosts = []; query = ''; $('#q').value = '';
      if (site) { cat = ''; }
      else { try { cat = sessionStorage.getItem('bd_cat') || ''; } catch {} }
      document.body.classList.toggle('bd-insite', !!site);
      $('#siteHead').innerHTML = '';
      drawCats();
      if (site) {
        drawSiteHead();
        $('#list').innerHTML = '<div class="bd-empty">불러오는 중…</div>';
        siteRef = db.ref('board/posts').orderByChild('site').equalTo(site);
        siteRef.on('value', (snap) => {
          const out = []; snap.forEach((c) => { out.push({ id: c.key, ...c.val() }); });
          sitePosts = out.sort((a, b) => b.at - a.at);
          drawSiteHead(); drawList(); refreshOpen();
        });
        window.scrollTo(0, 0);
      } else drawList();
    }
    if (p) {
      history.replaceState(null, '', location.pathname + location.search + (site ? '#site=' + encodeURIComponent(site) : ''));
      const show = () => { if (findPost(p)) openPost(p); };
      if (findPost(p)) show();
      else db.ref('board/posts/' + p).once('value').then((sn) => { if (sn.exists() && !sn.val().deleted) { posts.push({ id: p, ...sn.val() }); openPost(p); } });
    }
  }
  window.addEventListener('hashchange', route);

  // ---------- 글쓰기 / 고치기 ----------
  const dW = $('#dlgWrite'), fW = $('#fWrite');
  let editing = null;
  // 자동 양식 (지금 밴드에 올리던 글 모양을 따름). 칸에 넣은 값은 form 에, 번호 줄 모양 글은 text 에 저장한다.
  const FORMS = {
    project: [
      { k: 'client', label: '발주처명', req: 1 },
      { k: 'type', label: '형태', ph: '예: 오피스, 카페, 병원' },
      { k: 'address', label: '위치(현장주소)', addr: 1 },
      { k: 'addr2', label: '상세주소', ph: '동·층·호수 (예: A동 305~308호)' },
      { k: 'area', label: '평수', ph: '예: 100평 (대략적)' },
      { k: 'period', label: '공사기간', range: 1, s: 'start', e: 'end', ph: ['시작일', '준공일'], bad: '준공일이 시작일보다 빨라요.' },
      { k: 'contact', label: '발주처 담당자', ph: '이름 직함 (예: 홍길동 팀장)' },
      { k: 'phone', label: '연락처', tel: 1, ph: '010-0000-0000' },
      { k: 'etc', label: '기타', multi: 1, ph: '예: 예산 미정' },
    ],
    as: [
      { k: 'kind', label: 'A/S 형태', ph: '예: 추가공사, 하자보수' },
      { k: 'asPeriod', label: 'A/S 기간', range: 1, s: 'asStart', e: 'asEnd', ph: ['시작일', '종료일'], bad: 'A/S 기간의 종료일이 시작일보다 빨라요.' },
      { k: 'recv', label: '접수일', date: 1 },
      { k: 'contact', label: '발주처 담당자', ph: '이름 직함 (예: 홍길동 팀장)' },
      { k: 'phone', label: '연락처', tel: 1, ph: '010-0000-0000' },
      { k: 'req', label: '요청내용', multi: 1, req: 1, ph: '예: 업무석 확장, 회의실 신설' },
      { k: 'plan', label: '작업예정일', date: 1 },
    ],
  };
  const mdDay = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${+m[2]}월 ${+m[3]}일` : String(s || ''); };
  const who = (f) => [f.contact, f.phone].filter(Boolean).join(' ');
  // 번호 줄 모양 글 만들기 (찾기·목록·홈 카드에 쓰임)
  function compose(c, f, siteName) {
    if (c === 'project') {
      const rows = [['발주처명', f.client], ['형태', f.type], ['위치(현장주소)', [f.address, f.addr2].filter(Boolean).join(' ')], ['평수', f.area], ['공사기간', f.period], ['발주처 담당자', who(f)], ['기타', f.etc]].filter((r) => r[1]);
      return rows.map((r, i) => `${i + 1}. ${r[0]} _ ${r[1]}`).join('\n');
    }
    const rows = [['발주처명', siteName], ['A/S 형태', f.kind], ['A/S 기간', f.asPeriod], ['접수일', mdDay(f.recv)], ['발주처 담당자', who(f)]].filter((r) => r[1]);
    let t = rows.map((r, i) => `${i + 1}.${r[0]} : ${r[1]}`).join('\n');
    if (f.req) t += (t ? '\n' : '') + '요청내용 :\n' + f.req;
    if (f.plan) t += (t ? '\n' : '') + '작업예정일 : ' + mdDay(f.plan);
    return t;
  }
  const staffLabel = (m) => [m.name, m.rank].filter(Boolean).join(' ');
  let teams = [];
  const ownersOf = (p) => String((p.asState && p.asState.owner) || '').split(',').map((s) => s.trim()).filter(Boolean);
  function ownerChips(sel, name) {
    if (!staff.length && !sel.length) return '<div class="bd-hint">주간 스케줄 직원표에 이름이 없어요.</div>';
    // 주간 스케줄 직원표의 팀 순서대로 묶고, 팀이 없는 사람·직원표에 없는 이름은 맨 아래
    const groups = teams.map((t) => ({ name: t.name, list: staff.filter((m) => m.teamId === t.id).map(staffLabel) }));
    const inTeam = new Set(groups.flatMap((g) => g.list));
    const rest = [...new Set([...staff.map(staffLabel).filter((n) => !inTeam.has(n)), ...sel.filter((n) => !staff.some((m) => staffLabel(m) === n))])];
    if (rest.length) groups.push({ name: groups.length ? '기타' : '직원', list: rest });
    const chip = (n) => `<label><input type="checkbox" name="${name}" value="${esc(n)}" ${sel.includes(n) ? 'checked' : ''}><span>${esc(n)}</span></label>`;
    return `<div class="bd-ownbox">${groups.filter((g) => g.list.length).map((g) => `<div class="bd-team"><div class="bd-teamh">${esc(g.name)} <small>${g.list.length}명</small></div><div class="bd-owners">${g.list.map(chip).join('')}</div></div>`).join('')}</div>
      <div class="bd-ownsel">${sel.length ? '고른 사람: ' + sel.map(esc).join(', ') : '아직 고르지 않았어요.'}</div>`;
  }

  const siteOptions = (cur, direct) => {
    const list = Object.entries(projects).filter(([id, v]) => !v.closed || id === cur).sort((a, b) => b[1].at - a[1].at);
    return `<option value="">현장 고르기 (선택)</option>${list.map(([id, v]) => `<option value="${esc(id)}" ${id === cur ? 'selected' : ''}>${esc(v.siteName)}</option>`).join('')}${direct ? `<option value="__direct" ${cur === '__direct' ? 'selected' : ''}>✏️ 직접 입력</option>` : ''}`;
  };
  const useForm = (c) => !!FORMS[c] && (!editing || !!editing.form || editing.cat !== c);
  // 날짜 칸: 누르면 달력(일요일·공휴일 빨강, 토요일 파랑). 값은 숨은 칸에 YYYY-MM-DD 로.
  const yy = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[1].slice(2)}년 ${m[2]}월 ${m[3]}일` : ''; };
  const dateBtn = (nm, val, ph) => `<button type="button" class="bd-date ${val ? '' : 'empty'}" data-cal="${nm}" data-ph="${esc(ph)}">${val ? yy(val) : esc(ph)}</button><input type="hidden" name="${nm}" value="${esc(val || '')}">`;
  const field = (d, val, f = {}) => {
    const v = esc(val || ''), nm = 'f_' + d.k, req = d.req ? ' <b>*</b>' : '';
    if (d.multi) return `<label class="bd-f"><span>${d.label}${req}</span><textarea name="${nm}" rows="3" maxlength="2000" placeholder="${esc(d.ph || '')}">${v}</textarea></label>`;
    if (d.date) return `<div class="bd-f"><span>${d.label}</span><div class="bd-frow">${dateBtn(nm, val, '날짜 고르기')}</div></div>`;
    if (d.range) return `<div class="bd-f"><span>${d.label}</span><div class="bd-frow bd-range">${dateBtn('f_' + d.s, f[d.s], d.ph[0])}<b>~</b>${dateBtn('f_' + d.e, f[d.e], d.ph[1])}</div>${f[d.k] && !f[d.s] && !f[d.e] ? `<small class="bd-hint">예전 입력: ${esc(f[d.k])} (날짜를 고르면 바뀌어요)</small><input type="hidden" name="f_${d.k}Old" value="${esc(f[d.k])}">` : ''}</div>`;
    if (d.addr) return `<div class="bd-f"><span>${d.label}</span><div class="bd-frow"><input name="${nm}" readonly placeholder="도로명주소 검색을 눌러 주세요" value="${v}"><button type="button" class="btn" data-addr>주소 검색</button></div><div class="bd-postcode hidden" id="postBox"></div></div>`;
    return `<label class="bd-f"><span>${d.label}${req}</span><input name="${nm}" ${d.tel ? 'type="tel" inputmode="tel"' : ''} maxlength="200" placeholder="${esc(d.ph || '')}" value="${v}"></label>`;
  };
  function writeExtras() {
    const c = (fW.querySelector('input[name=cat]:checked') || {}).value;
    const p = editing || {}, f = (editing && editing.cat === c && editing.form) || {};
    const form = useForm(c);
    let h = '';
    if (c === 'project') {
      if (form) {
        h += FORMS.project.slice(0, 2).map((d) => field(d, f[d.k], f)).join('');
        h += `<label class="bd-f"><span>현장 이름 <b>*</b></span><input name="siteName" maxlength="40" placeholder="현장 방 이름 (예: ○○빌딩 3층 사무실)" value="${esc(p.siteName || '')}"></label>`;
        h += FORMS.project.slice(2).map((d) => field(d, f[d.k], f)).join('');
      } else h += `<input name="siteName" maxlength="40" placeholder="현장 이름 (예: ○○빌딩 3층 사무실)" value="${esc(p.siteName || '')}">`;
      if (editing) h += `<label class="bd-check"><input type="checkbox" name="closed" ${p.closed ? 'checked' : ''}> 끝난 현장 (현장 고르기 목록에서 숨김)</label>`;
    } else if (c === 'photo' || c === 'as') {
      const cur = p.site || (p.siteName && c === 'as' ? '__direct' : '') || (!editing && site) || '';
      h += `<label class="bd-f"><span>${c === 'as' ? '발주처명 (현장)' : '현장'}</span><select name="site">${siteOptions(cur, c === 'as')}</select></label>`;
      if (c === 'as') h += `<input name="siteDirect" maxlength="40" placeholder="발주처명 / 현장 이름 직접 입력" value="${esc(!p.site && p.siteName ? p.siteName : '')}" class="${cur === '__direct' ? '' : 'hidden'}">`;
      if (!Object.keys(projects).length) h += `<div class="bd-hint">아직 현장이 없어요. <b>프로젝트</b> 게시판에 현장을 등록하면 여기서 고를 수 있어요.${c === 'as' ? ' 지금은 "직접 입력"을 골라 주세요.' : ''}</div>`;
      if (c === 'as' && form) {
        h += FORMS.as.map((d) => field(d, d.k === 'recv' && !f.recv && !editing ? WS.ymd(new Date()) : f[d.k])).join('');
        if (!editing) h += `<div class="bd-f"><span>담당자 (여러 명 고를 수 있어요)</span>${ownerChips([], 'owner')}</div>`;
      }
    }
    $('#wExtra').innerHTML = h;
    fW.text.classList.toggle('hidden', form);
    fW.text.placeholder = c === 'project' ? '어떤 프로젝트인지 써 주세요' : c === 'as' ? 'A/S 내용을 써 주세요' : '내용을 써 주세요';
    // A/S: 현장을 고르면 발주처 담당자·연락처를 프로젝트에서 채움 (비어 있을 때만), 직접 입력 칸 보이기
    if (c === 'as' && fW.site) fW.site.onchange = () => {
      fW.siteDirect.classList.toggle('hidden', fW.site.value !== '__direct');
      if (fW.site.value === '__direct') fW.siteDirect.focus();
      const pf = (projects[fW.site.value] || {}).form || {};
      if (fW.f_contact && !fW.f_contact.value) fW.f_contact.value = pf.contact || '';
      if (fW.f_phone && !fW.f_phone.value) fW.f_phone.value = pf.phone || '';
    };
  }
  function openWrite(p) {
    editing = p || null;
    $('#wTitle').textContent = p ? '글 고치기' : '글쓰기';
    $('#wSave').textContent = p ? '저장' : '올리기';
    const sel = p ? p.cat : cat || (site ? 'photo' : 'notice');
    const keys = site && !p ? ['photo', 'as'] : CATS.filter((c) => c.key).map((c) => c.key);
    $('#wCats').innerHTML = CATS.filter((c) => keys.includes(c.key)).map((c) => `<label><input type="radio" name="cat" value="${c.key}" ${c.key === sel ? 'checked' : ''}><span>${c.label}</span></label>`).join('');
    if (!fW.querySelector('input[name=cat]:checked')) fW.querySelector('input[name=cat]').checked = true;
    fW.text.value = p ? p.text : '';
    $('#wErr').textContent = '';
    writeExtras();
    dW.showModal();
    setTimeout(() => { const first = fW.querySelector('#wExtra input:not([type=hidden]):not(.hidden), #wExtra select'); (useForm((fW.querySelector('input[name=cat]:checked') || {}).value) && first ? first : fW.text).focus(); }, 30);
  }
  $('#wCats').onchange = writeExtras;
  const ownSel = (root, name) => { const el = root.querySelector('.bd-ownsel'); if (!el) return; const v = [...root.querySelectorAll(`input[name=${name}]:checked`)].map((x) => x.value); el.textContent = v.length ? '고른 사람: ' + v.join(', ') : '아직 고르지 않았어요.'; };
  $('#wExtra').addEventListener('change', (e) => { if (e.target.name === 'owner') ownSel($('#wExtra'), 'owner'); });
  $('#wExtra').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cal]'); if (b) { e.preventDefault(); return openCal(b); }
    const a = e.target.closest('[data-addr]'); if (a) { e.preventDefault(); return findAddress(); }
    if (e.target.name === 'f_address' && !e.target.readOnly) return;
    if (e.target.name === 'f_address') findAddress();
  });

  // ---------- 달력 (일요일·공휴일 빨강, 토요일 파랑) ----------
  let calEl = null;
  function closeCal() { if (calEl) { calEl.remove(); calEl = null; } }
  function openCal(btn) {
    if (calEl && calEl.dataset.for === btn.dataset.cal) return closeCal();
    closeCal();
    const input = fW[btn.dataset.cal];
    const pad = (n) => String(n).padStart(2, '0');
    const today = WS.ymd(new Date());
    const pair = { f_end: 'f_start', f_asEnd: 'f_asStart' }[btn.dataset.cal];
    let base = (input.value || (pair && fW[pair] && fW[pair].value) || today).slice(0, 7);
    calEl = document.createElement('div');
    calEl.className = 'bd-cal'; calEl.dataset.for = btn.dataset.cal;
    const draw = () => {
      const [y, m] = base.split('-').map(Number);
      const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const H = window.SB_HOLIDAYS || {};
      let cells = '';
      for (let i = 0; i < first; i++) cells += '<span></span>';
      for (let d = 1; d <= days; d++) {
        const k = `${y}-${pad(m)}-${pad(d)}`, w = (first + d - 1) % 7, hol = H[k];
        cells += `<button type="button" data-d="${k}" class="${w === 0 || hol ? 'red' : w === 6 ? 'blue' : ''} ${k === today ? 'today' : ''} ${k === input.value ? 'on' : ''}" ${hol ? `title="${esc(hol)}"` : ''}>${d}</button>`;
      }
      const hols = Object.keys(H).filter((k) => k.startsWith(base)).map((k) => `${+k.slice(8)}일 ${esc(H[k])}`);
      calEl.innerHTML = `<div class="bd-calh"><button type="button" data-mv="-1" aria-label="이전 달">‹</button><b>${y}년 ${m}월</b><button type="button" data-mv="1" aria-label="다음 달">›</button></div>
        <div class="bd-calg"><i class="red">일</i><i>월</i><i>화</i><i>수</i><i>목</i><i>금</i><i class="blue">토</i>${cells}</div>
        ${hols.length ? `<div class="bd-calhol">${hols.join(' · ')}</div>` : ''}
        <div class="bd-calf"><button type="button" data-clear>지우기</button><button type="button" data-today>오늘</button></div>`;
    };
    const set = (v) => { input.value = v; btn.textContent = v ? yy(v) : btn.dataset.ph; btn.classList.toggle('empty', !v); closeCal(); };
    calEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.mv) { const [y, m] = base.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + +t.dataset.mv, 1)); base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; draw(); }
      else if (t.dataset.d) set(t.dataset.d);
      else if ('clear' in t.dataset) set('');
      else if ('today' in t.dataset) set(today);
    });
    draw();
    btn.closest('.bd-f').append(calEl);
    calEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  dW.addEventListener('click', (e) => { if (calEl && !e.target.closest('.bd-cal') && !e.target.closest('[data-cal]')) closeCal(); });
  dW.addEventListener('close', closeCal);

  // ---------- 도로명주소 검색 (카카오 우편번호 서비스, 가입·열쇠 필요 없음) ----------
  let postcodeLoad = null;
  const loadPostcode = () => postcodeLoad || (postcodeLoad = window.daum && daum.Postcode ? Promise.resolve() : new Promise((ok, no) => {
    const sc = document.createElement('script');
    sc.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    sc.onload = ok; sc.onerror = () => { postcodeLoad = null; no(new Error('load')); };
    document.head.append(sc);
  }));
  async function findAddress() {
    const box = $('#postBox'), inp = fW.f_address; if (!box || !inp) return;
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    try { await loadPostcode(); }
    catch { inp.readOnly = false; inp.placeholder = '주소 검색을 열지 못했어요. 직접 입력해 주세요'; inp.focus(); return; }
    box.classList.remove('hidden'); box.innerHTML = '';
    new daum.Postcode({
      width: '100%', height: '100%',
      oncomplete: (d) => {
        inp.value = d.roadAddress || d.address || '';
        box.classList.add('hidden'); box.innerHTML = '';
        if (fW.f_addr2) { if (!fW.f_addr2.value && d.buildingName) fW.f_addr2.placeholder = d.buildingName + ' (동·층·호수)'; fW.f_addr2.focus(); }
      },
    }).embed(box);
  }
  $('#write').onclick = () => openWrite();
  fW.onsubmit = async (e) => {
    e.preventDefault();
    const c = (fW.querySelector('input[name=cat]:checked') || {}).value;
    if (!c) return ($('#wErr').textContent = '게시판을 골라 주세요.');
    const err = (m) => { $('#wErr').textContent = m; };
    const form = useForm(c);
    let f = null;
    if (form) {
      f = {};
      FORMS[c].forEach((d) => { if (d.range) return; const el = fW['f_' + d.k]; const val = el ? el.value.trim() : ''; if (val) f[d.k] = val; });
      for (const d of FORMS[c].filter((x) => x.range)) {
        const st = fW['f_' + d.s] ? fW['f_' + d.s].value : '', en = fW['f_' + d.e] ? fW['f_' + d.e].value : '';
        if (st && en && en < st) return err(d.bad);
        if (st) f[d.s] = st;
        if (en) f[d.e] = en;
        if (st || en) f[d.k] = `${yy(st)}~${yy(en)}`.replace(/^~/, '~ ');
        else if (fW['f_' + d.k + 'Old']) f[d.k] = fW['f_' + d.k + 'Old'].value;
      }
      const miss = FORMS[c].find((d) => d.req && !f[d.k]);
      if (miss) return err(miss.label + '을(를) 써 주세요.');
    }
    const v = { cat: c, form: f };
    if (c === 'project') {
      v.siteName = (fW.siteName.value || '').trim();
      if (!v.siteName) return err('현장 이름을 써 주세요.');
      if (editing) v.closed = fW.closed && fW.closed.checked ? true : null;
      v.site = null;
    } else if (c === 'photo' || c === 'as') {
      const sid = fW.site ? fW.site.value : '';
      if (sid === '__direct') {
        v.site = null; v.siteName = (fW.siteDirect.value || '').trim() || null;
        if (!v.siteName) return err('발주처명(현장 이름)을 써 주세요.');
      } else { v.site = sid || null; v.siteName = sid && projects[sid] ? projects[sid].siteName : null; }
    } else { v.site = null; v.siteName = null; }
    if (c !== 'project' && editing && editing.cat === 'project') v.closed = null;
    v.text = form ? compose(c, f, v.siteName) : fW.text.value.trim();
    if (!v.text) return err('내용을 써 주세요.');
    $('#wSave').disabled = true;
    try {
      if (editing) {
        const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
        if (Object.keys(v).some((k) => !same(editing[k], v[k]))) {
          if (c === 'as' && !editing.asState) v.asState = { status: 'new', by: me.name, at: Date.now() };
          if (c !== 'as' && editing.asState) v.asState = null;
          await db.ref('board/posts/' + editing.id).update({ ...v, editedAt: Date.now() });
        }
      } else {
        const now = Date.now();
        const post = { ...v, uid: me.uid, name: me.name, at: now, commentCount: 0 };
        Object.keys(post).forEach((k) => post[k] == null && delete post[k]);
        if (c === 'as') {
          post.asState = { status: 'new', by: me.name, at: now };
          const o = [...fW.querySelectorAll('input[name=owner]:checked')].map((x) => x.value).join(', ');
          if (o) post.asState.owner = o.slice(0, 120);
        }
        await db.ref('board/posts').push(post);
        if (!site && cat && cat !== c) { cat = c; drawCats(); }
      }
      dW.close();
    } catch (er) { err('저장하지 못했어요: ' + er.message); }
    finally { $('#wSave').disabled = false; }
  };

  // ---------- 글 보기 + 댓글 + A/S 상태 ----------
  const dP = $('#dlgPost'), fC = $('#fCmt');
  let cmts = [];
  function asBox(p) {
    if (p.cat !== 'as') return '';
    const st = asStatus(p), s = p.asState || {};
    return `<div class="bd-asbox"><div class="bd-asrow">${Object.entries(AS).map(([k, l]) => `<button type="button" class="bd-asbtn ${k} ${k === st ? 'on' : ''}" data-as="${k}">${l}</button>`).join('')}</div>
      <div class="bd-asrow"><b>담당자</b><span class="bd-sub">${s.by ? `${esc(s.by)} · ${ago(s.at)} 바꿈` : ''}</span></div>
      ${ownerChips(ownersOf(p), 'asOwner')}</div>`;
  }
  const telLink = (s) => { const n = String(s || '').replace(/[^\d+]/g, ''); return n.length >= 8 ? `<a href="tel:${n}">${esc(s)}</a>` : esc(s); };
  const linkPhones = (s) => esc(s).replace(/(0\d{1,2}[- .]?\d{3,4}[- .]?\d{4})/g, (m) => `<a href="tel:${m.replace(/\D/g, '')}">${m}</a>`);
  function formView(p) {
    const f = p.form || {};
    const rows = p.cat === 'project'
      ? [['발주처명', esc(f.client)], ['형태', esc(f.type)], ['위치(현장주소)', [f.address ? `<a href="https://map.naver.com/p/search/${encodeURIComponent(f.address)}" target="_blank" rel="noopener">${esc(f.address)}</a>` : '', esc(f.addr2)].filter(Boolean).join(' ')], ['평수', esc(f.area)], ['공사기간', esc(f.period)], ['발주처 담당자', [esc(f.contact), telLink(f.phone)].filter(Boolean).join(' ')], ['기타', esc(f.etc)]]
      : [['발주처명', esc(p.siteName)], ['A/S 형태', esc(f.kind)], ['A/S 기간', esc(f.asPeriod)], ['접수일', esc(mdDay(f.recv))], ['발주처 담당자', [esc(f.contact), telLink(f.phone)].filter(Boolean).join(' ')], ['요청내용', esc(f.req)], ['작업예정일', esc(mdDay(f.plan))]];
    return `<dl class="bd-form">${rows.filter((r) => r[1]).map((r) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl>`;
  }
  function drawPost(p) {
    $('#pCat').innerHTML = `<span class="bd-chip ${esc(p.cat)}">${catLabel(p.cat)}</span>`;
    $('#pBody').innerHTML = `
      <div class="bd-meta"><b>${esc(p.name)}</b><span>${ago(p.at)}${p.editedAt ? ' · 수정됨' : ''}</span></div>
      ${p.cat === 'project' ? `<div class="bd-ptitle">${esc(p.siteName)}</div>` : siteChip(p) ? `<div class="bd-sitebar">${siteChip(p)}</div>` : p.siteName ? `<div class="bd-sitebar"><span class="bd-site plain">${ICON_PIN}${esc(p.siteName)}</span></div>` : ''}
      ${p.form ? formView(p) : `<div class="bd-text">${linkPhones(p.text)}</div>`}
      ${p.cat === 'project' && site !== p.id ? `<a class="btn" style="margin-top:12px" href="#site=${encodeURIComponent(p.id)}">현장 방 열기 ›</a>` : ''}
      ${asBox(p)}
      ${canEdit(p) ? '<div class="bd-acts"><button class="btn" type="button" data-a="edit">고치기</button><button class="btn danger" type="button" data-a="del">지우기</button></div>' : ''}
      <ul class="bd-cmts">${cmts.length ? cmts.map((c) => `<li data-cid="${esc(c.id)}"><div class="who"><b>${esc(c.name)}</b><span>${ago(c.at)}</span>${me && (c.uid === me.uid || me.admin) ? '<button type="button" data-a="cdel">지우기</button>' : ''}</div><div class="t">${esc(c.text)}</div></li>`).join('') : '<li class="none">첫 댓글을 달아 보세요.</li>'}</ul>`;
    $('#pBody').querySelectorAll('input[name=asOwner]').forEach((x) => (x.onchange = () => {
      const o = [...$('#pBody').querySelectorAll('input[name=asOwner]:checked')].map((y) => y.value).join(', ');
      setAs(p, asStatus(p), o);
    }));
  }
  function setAs(p, status, owner) {
    const v = { status, by: me.name, at: Date.now() };
    if (owner) v.owner = owner.slice(0, 120);
    return db.ref('board/posts/' + p.id + '/asState').set(v).catch((e) => alert('바꾸지 못했어요: ' + e.message));
  }
  function openPost(id) {
    const p = findPost(id); if (!p) return;
    openId = id; cmts = [];
    drawPost(p);
    fC.text.value = '';
    if (cmtRef) cmtRef.off();
    cmtRef = db.ref('board/comments/' + id).orderByChild('at');
    cmtRef.on('value', (s) => {
      const out = []; s.forEach((c) => { out.push({ id: c.key, ...c.val() }); });
      cmts = out;
      refreshOpen();
    });
    if (!dP.open) dP.showModal();
  }
  dP.addEventListener('close', () => { openId = null; if (cmtRef) { cmtRef.off(); cmtRef = null; } });
  $('#pBody').onclick = async (e) => {
    if (e.target.closest('a[href^="#site="]')) { dP.close(); return; }
    const b = e.target.closest('button[data-a], button[data-as]'); if (!b) return;
    const p = findPost(openId); if (!p) return;
    if (b.dataset.as) return setAs(p, b.dataset.as, ownersOf(p).join(', '));
    if (b.dataset.a === 'edit') { dP.close(); openWrite(p); }
    if (b.dataset.a === 'del') {
      if (!confirm(p.cat === 'project' ? '이 현장(프로젝트) 글을 지울까요?\n현장에 올라온 사진·A/S 글은 지워지지 않아요.' : '이 글을 지울까요?')) return;
      try { await db.ref('board/posts/' + p.id + '/deleted').set({ by: me.uid, name: me.name, at: Date.now() }); dP.close(); if (site === p.id) location.hash = ''; }
      catch (err) { alert('지우지 못했어요: ' + err.message); }
    }
    if (b.dataset.a === 'cdel') {
      const cid = b.closest('li').dataset.cid;
      if (!confirm('이 댓글을 지울까요?')) return;
      try {
        await db.ref('board/comments/' + p.id + '/' + cid).remove();
        db.ref('board/posts/' + p.id + '/commentCount').transaction((n) => Math.max(0, (n || 1) - 1));
      } catch (err) { alert('지우지 못했어요: ' + err.message); }
    }
  };
  fC.onsubmit = async (e) => {
    e.preventDefault();
    const text = fC.text.value.trim(); if (!text || !openId) return;
    const id = openId;
    fC.text.disabled = true;
    try {
      const now = Date.now();
      await db.ref('board/comments/' + id).push({ uid: me.uid, name: me.name, text, at: now });
      db.ref('board/posts/' + id + '/commentCount').transaction((n) => (n || 0) + 1);
      db.ref('board/posts/' + id + '/lastAt').set(now);
      fC.text.value = '';
    } catch (err) { alert('댓글을 달지 못했어요: ' + err.message); }
    finally { fC.text.disabled = false; fC.text.focus(); }
  };
  document.querySelectorAll('.bd-dlg [data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));
  [dW, dP].forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  // ---------- 시작 ----------
  // 홈의 "안 끝난 A/S" 링크: band.html#cat=as&open=1
  { const h = new URLSearchParams(location.hash.slice(1)); if (h.has('cat')) { cat = h.get('cat') || ''; asOpenOnly = h.get('open') === '1'; history.replaceState(null, '', location.pathname + location.search); } }
  drawCats();
  if (!window.SBAuth || !SBAuth.enabled()) {
    $('#write').classList.add('hidden');
    $('#list').innerHTML = `<div class="bd-empty">Band 는 구글 로그인으로 들어온 회원만 볼 수 있어요. (지금은 시험 중)<br><br><a class="btn primary" href="band.html?login=google">구글 로그인으로 들어가기</a></div>`;
    return;
  }
  SBAuth.start().then((a) => {
    me = a; db = firebase.database();
    $('#list').innerHTML = '<div class="bd-empty">불러오는 중…</div>';
    // A/S 담당자 목록 = 주간 스케줄 직원표 전 직원 (이름 + 직급)
    db.ref('spaces/' + a.spaceKey + '/data/members').once('value').then((s) => {
      const v = s.val(); staff = (Array.isArray(v) ? v : Object.values(v || {})).filter((m) => m && m.name).map((m) => ({ name: String(m.name).trim(), rank: String(m.rank || '').trim(), teamId: m.teamId || '' }));
    }).catch(() => {});
    db.ref('spaces/' + a.spaceKey + '/data/mteams').once('value').then((s) => {
      const v = s.val(); teams = (Array.isArray(v) ? v : Object.values(v || {})).filter((t) => t && t.name);
    }).catch(() => {});
    listenProjects();
    listen();
    route();
  });
})();
