// Band: 회사 게시판 (네이버 밴드 대신). 글·댓글은 Firebase board/ 에 저장, 회원(구글 로그인 + 관리자 승인)만 읽고 쓴다.
// 규칙: firebase/database.rules.json 의 board. 글은 지우면 deleted 표시만 남김 (휴지통은 다음 단계).
(function () {
  const CATS = [
    { key: '', label: '전체' },
    { key: 'photo', label: '현장 사진' },
    { key: 'as', label: 'A/S' },
    { key: 'project', label: '프로젝트' },
    { key: 'notice', label: '공지·자유글' },
  ];
  const catLabel = (k) => (CATS.find((c) => c.key === k) || {}).label || '';
  const $ = (s) => document.querySelector(s);
  const esc = WS.esc;
  const PAGE = 50;

  let me = null, db = null, posts = [], limit = PAGE, cat = '', query = '', openId = null, cmtRef = null;
  try { cat = sessionStorage.getItem('bd_cat') || ''; } catch {}

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
  const ICON_CMT = '<svg class="si" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>';

  // ---------- 목록 ----------
  function drawCats() {
    $('#cats').innerHTML = CATS.map((c) => `<button type="button" data-k="${c.key}" class="${c.key === cat ? 'on' : ''}">${c.label}</button>`).join('');
  }
  $('#cats').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    cat = b.dataset.k; try { sessionStorage.setItem('bd_cat', cat); } catch {}
    drawCats(); drawList();
  };
  let qt = 0;
  $('#q').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { query = $('#q').value.trim(); drawList(); }, 150); };

  function drawList() {
    const q = query.toLowerCase();
    const shown = posts.filter((p) => !p.deleted && (!cat || p.cat === cat) && (!q || (p.text + ' ' + p.name).toLowerCase().includes(q)));
    $('#msg').textContent = query ? `"${query}" 찾은 글 ${shown.length}개` + (posts.length >= limit ? ' (최근 글에서 찾았어요. 아래 "이전 글 더 보기"를 누르면 더 찾아요)' : '') : '';
    $('#more').classList.toggle('hidden', posts.length < limit);
    if (!shown.length) {
      $('#list').innerHTML = `<div class="bd-empty">${query ? '찾는 글이 없어요.' : cat ? catLabel(cat) + ' 게시판에 아직 글이 없어요.<br>오른쪽 아래 <b>글쓰기</b>로 첫 글을 올려 보세요.' : '아직 글이 없어요.<br>오른쪽 아래 <b>글쓰기</b>로 첫 글을 올려 보세요.'}</div>`;
      return;
    }
    $('#list').innerHTML = shown.map((p) => `
      <article class="bd-post" data-id="${esc(p.id)}" tabindex="0">
        <div class="bd-meta"><span class="bd-chip ${esc(p.cat)}">${catLabel(p.cat)}</span><b>${mark(p.name)}</b><span>${ago(p.at)}${p.editedAt ? ' · 수정됨' : ''}</span></div>
        <div class="bd-text">${mark(p.text)}</div>
        <div class="bd-foot"><span>${ICON_CMT}댓글 ${p.commentCount || 0}</span></div>
      </article>`).join('');
  }
  $('#list').onclick = (e) => { const a = e.target.closest('.bd-post'); if (a) openPost(a.dataset.id); };
  $('#list').onkeydown = (e) => { if (e.key === 'Enter') { const a = e.target.closest('.bd-post'); if (a) openPost(a.dataset.id); } };
  $('#more').onclick = () => { limit += PAGE; listen(); };

  let listRef = null;
  function listen() {
    if (listRef) listRef.off();
    listRef = db.ref('board/posts').orderByChild('at').limitToLast(limit);
    listRef.on('value', (s) => {
      const out = [];
      s.forEach((c) => { out.push({ id: c.key, ...c.val() }); });
      posts = out.reverse();
      drawList();
      if (openId) { const p = posts.find((x) => x.id === openId); if (p && !p.deleted) drawPost(p); }
    }, (e) => { $('#msg').textContent = '글을 불러오지 못했어요: ' + e.message; });
  }

  // ---------- 글쓰기 / 고치기 ----------
  const dW = $('#dlgWrite'), fW = $('#fWrite');
  let editing = null;
  function openWrite(p) {
    editing = p || null;
    $('#wTitle').textContent = p ? '글 고치기' : '글쓰기';
    $('#wSave').textContent = p ? '저장' : '올리기';
    const sel = p ? p.cat : cat || 'notice';
    $('#wCats').innerHTML = CATS.filter((c) => c.key).map((c) => `<label><input type="radio" name="cat" value="${c.key}" ${c.key === sel ? 'checked' : ''}><span>${c.label}</span></label>`).join('');
    fW.text.value = p ? p.text : '';
    $('#wErr').textContent = '';
    dW.showModal();
    setTimeout(() => fW.text.focus(), 30);
  }
  $('#write').onclick = () => openWrite();
  fW.onsubmit = async (e) => {
    e.preventDefault();
    const text = fW.text.value.trim(), c = (fW.querySelector('input[name=cat]:checked') || {}).value;
    if (!c) return ($('#wErr').textContent = '게시판을 골라 주세요.');
    if (!text) return ($('#wErr').textContent = '내용을 써 주세요.');
    $('#wSave').disabled = true;
    try {
      if (editing) {
        if (text !== editing.text || c !== editing.cat) await db.ref('board/posts/' + editing.id).update({ text, cat: c, editedAt: Date.now() });
      } else {
        await db.ref('board/posts').push({ cat: c, text, uid: me.uid, name: me.name, at: Date.now(), commentCount: 0 });
        if (cat && cat !== c) { cat = c; drawCats(); }
      }
      dW.close();
    } catch (err) { $('#wErr').textContent = '저장하지 못했어요: ' + err.message; }
    finally { $('#wSave').disabled = false; }
  };

  // ---------- 글 보기 + 댓글 ----------
  const dP = $('#dlgPost'), fC = $('#fCmt');
  let cmts = [];
  function drawPost(p) {
    $('#pCat').innerHTML = `<span class="bd-chip ${esc(p.cat)}">${catLabel(p.cat)}</span>`;
    $('#pBody').innerHTML = `
      <div class="bd-meta"><b>${esc(p.name)}</b><span>${ago(p.at)}${p.editedAt ? ' · 수정됨' : ''}</span></div>
      <div class="bd-text">${esc(p.text)}</div>
      ${canEdit(p) ? '<div class="bd-acts"><button class="btn" type="button" data-a="edit">고치기</button><button class="btn danger" type="button" data-a="del">지우기</button></div>' : ''}
      <ul class="bd-cmts">${cmts.length ? cmts.map((c) => `<li data-cid="${esc(c.id)}"><div class="who"><b>${esc(c.name)}</b><span>${ago(c.at)}</span>${me && (c.uid === me.uid || me.admin) ? '<button type="button" data-a="cdel">지우기</button>' : ''}</div><div class="t">${esc(c.text)}</div></li>`).join('') : '<li class="none">첫 댓글을 달아 보세요.</li>'}</ul>`;
  }
  function openPost(id) {
    const p = posts.find((x) => x.id === id); if (!p) return;
    openId = id; cmts = [];
    drawPost(p);
    fC.text.value = '';
    if (cmtRef) cmtRef.off();
    cmtRef = db.ref('board/comments/' + id).orderByChild('at');
    cmtRef.on('value', (s) => {
      const out = []; s.forEach((c) => { out.push({ id: c.key, ...c.val() }); });
      cmts = out;
      const cur = posts.find((x) => x.id === openId); if (cur) drawPost(cur);
    });
    if (!dP.open) dP.showModal();
  }
  dP.addEventListener('close', () => { openId = null; if (cmtRef) { cmtRef.off(); cmtRef = null; } });
  $('#pBody').onclick = async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const p = posts.find((x) => x.id === openId); if (!p) return;
    if (b.dataset.a === 'edit') { dP.close(); openWrite(p); }
    if (b.dataset.a === 'del') {
      if (!confirm('이 글을 지울까요?')) return;
      try { await db.ref('board/posts/' + p.id + '/deleted').set({ by: me.uid, name: me.name, at: Date.now() }); dP.close(); }
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
  drawCats();
  if (!window.SBAuth || !SBAuth.enabled()) {
    $('#write').classList.add('hidden');
    $('#list').innerHTML = `<div class="bd-empty">Band 는 구글 로그인으로 들어온 회원만 볼 수 있어요. (지금은 시험 중)<br><br><a class="btn primary" href="band.html?login=google">구글 로그인으로 들어가기</a></div>`;
    return;
  }
  SBAuth.start().then((a) => {
    me = a; db = firebase.database();
    $('#list').innerHTML = '<div class="bd-empty">불러오는 중…</div>';
    listen();
  });
})();
