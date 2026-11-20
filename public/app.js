// SPACEBASE 주간 스케줄 - 화면 로직
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  let db = null;
  let me = null;
  let ws = null;
  let version = 0;
  let pending = []; // 연결이 끊긴 동안 보낸 변경
  let focusMonday = mondayOf(new Date()); // 빨간 박스(금주) 기준 월요일
  let days = [];
  let sel = null; // { r0, c0, r1, c1 } 행/열 인덱스 (프로젝트 순서, 날짜 순서)
  let dragging = false;
  let clipboard = null;
  let rowList = []; // 화면 순서대로 프로젝트 id
  const peers = {}; // 다른 사람이 선택한 칸 { id: {name, key, color} }

  // ---------- 날짜 ----------
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const wd = (x.getDay() + 6) % 7; // 월=0
    x.setDate(x.getDate() - wd);
    return x;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function weekLabel(mon) {
    // 목요일이 속한 달 기준 주차 (엑셀 파일명 "11월3주차" 와 동일한 방식)
    const thu = addDays(mon, 3);
    const n = Math.ceil(thu.getDate() / 7);
    const sun = addDays(mon, 6);
    return `${thu.getFullYear()}년 ${thu.getMonth() + 1}월 ${n}주차  (${mon.getMonth() + 1}/${mon.getDate()} ~ ${sun.getMonth() + 1}/${sun.getDate()})`;
  }

  // ---------- 숫자 서식 ----------
  const isNum = (v) => /^-?\d+(\.\d+)?$/.test(String(v).replace(/,/g, '').trim()) && String(v).trim() !== '';
  function fmtAmount(v) {
    if (v == null || v === '') return '';
    if (!isNum(v)) return v;
    const n = Number(String(v).replace(/,/g, ''));
    return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }
  function fmtArea(v) {
    if (v == null || v === '') return '';
    if (!isNum(v)) return v;
    return Number(String(v).replace(/,/g, '')).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' PY';
  }

  // 일요일과 공휴일은 빨간 글자 (토요일은 검은 글자)
  function holName(d) { return (window.SB_HOLIDAYS || {})[ymd(d)] || ''; }
  function redDay(d) { return d.getDay() === 0 || !!holName(d); }

  // ---------- 연결 ----------
  // ---------- 클라우드(Firebase) 방식 ----------
  // FIREBASE_CONFIG 가 있으면 회사 서버 없이 Firebase 실시간 데이터베이스에 바로 저장한다.
  // 회사 비밀번호의 해시(64자리)가 저장 위치가 되므로, 비밀번호를 아는 사람만 같은 스케줄표를 본다.
  const CLOUD = !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);
  const clientId = uid('c');
  let fbData = null; // spaces/<key>/data
  let fbSpace = null; // spaces/<key>
  const ARRAY_KEYS = ['groups', 'projects', 'categories', 'teams', 'mteams', 'members', 'ranks'];
  function getCred() { try { const c = JSON.parse(localStorage.getItem('sb_cred') || 'null'); return c && c.code && c.name ? c : null; } catch { return null; } }
  function setCred(c) { try { localStorage.setItem('sb_cred', JSON.stringify(c)); } catch {} }
  async function sha256hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function toArr(v) { if (!v) return []; if (Array.isArray(v)) return v.filter((x) => x != null); return Object.keys(v).sort((a, b) => a - b).map((k) => v[k]).filter((x) => x != null); }
  function fromFb(v) {
    const d = Object.assign({}, v || {});
    ARRAY_KEYS.forEach((k) => (d[k] = toArr(d[k])));
    d.teams = [d.teams[0] || '', d.teams[1] || ''];
    d.cells = d.cells || {};
    d.memo = Object.assign({ left: '', right: '', notice: '', etc: '' }, d.memo || {});
    d.title = d.title || 'SPACEBASE SCHEDULE';
    return d;
  }
  function toFb(d) {
    const x = JSON.parse(JSON.stringify(d));
    delete x.version; delete x.updatedAt; delete x.updatedBy;
    return x;
  }
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; if (db) renderAll(); });
  }
  function showGate(msg) {
    $('#gate').classList.remove('hidden');
    $('#gateErr').textContent = msg || '';
    const c = getCred();
    if (c) { $('#gateName').value = c.name; if (!$('#gateCode').value) $('#gateCode').value = c.code; }
    setTimeout(() => ($('#gateCode').value ? $('#gateName') : $('#gateCode')).focus(), 50);
  }
  $('#gateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#gateCode').value.trim(), name = $('#gateName').value.trim().slice(0, 20);
    if (code.length < 4) { $('#gateErr').textContent = '회사 비밀번호는 4자 이상이어야 해요.'; return; }
    if (!name) { $('#gateErr').textContent = '이름을 입력해 주세요.'; return; }
    setCred({ code, name });
    $('#gate').classList.add('hidden');
    if (fbData) return location.reload(); // 이미 연결된 상태에서 이름/비밀번호를 바꾼 경우
    connectCloud();
  });
  async function connectCloud() {
    const cred = getCred();
    if (!cred) return showGate();
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    const fdb = firebase.database();
    const key = await sha256hex('spacebase:' + cred.code);
    fbSpace = fdb.ref('spaces/' + key);
    fbData = fbSpace.child('data');
    me = { id: 'n:' + cred.name, name: cred.name };
    $('#me').textContent = me.name + ' 님';
    $('#logoutLink').textContent = '이름 바꾸기';
    fdb.ref('.info/connected').on('value', (s) => setStatus(s.val() ? '실시간 연결됨' : '연결 끊김 · 다시 연결 중…', s.val() ? 'ok' : 'bad'));
    let snap;
    try { snap = await fbData.once('value'); } catch (e) { setStatus('연결 실패', 'bad'); showGate('저장소에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. (' + e.message + ')'); return; }
    if (!snap.exists()) {
      // 처음 쓰는 회사 비밀번호: 이 PC에 예전(회사 PC 서버) 데이터가 있으면 그것으로, 없으면 빈 양식으로 시작
      let legacy = null;
      try { legacy = window.sbDesktop && window.sbDesktop.readLegacyData ? await window.sbDesktop.readLegacyData() : null; } catch {}
      const ok = legacy || confirm('이 회사 비밀번호로 된 스케줄표가 아직 없어요.\n새 스케줄표를 만들까요?\n\n(비밀번호를 잘못 입력했다면 "취소"를 누르세요)');
      if (!ok) { localStorage.removeItem('sb_cred'); return showGate('회사 비밀번호를 다시 확인해 주세요.'); }
      await fbData.transaction((cur) => cur || toFb(legacy || window.SB_DEFAULT_DB));
      if (legacy) toast('이 PC에 있던 기존 스케줄을 옮겼어요.');
    }
    fbData.on('value', (s) => { db = fromFb(s.val()); scheduleRender(); });
    // 접속 중인 사람과 선택한 칸 표시
    const pres = fbSpace.child('presence/' + clientId);
    pres.onDisconnect().remove();
    pres.set({ id: me.id, name: me.name, key: null });
    fdb.ref('.info/connected').on('value', (s) => { if (s.val()) { pres.onDisconnect().remove(); pres.set({ id: me.id, name: me.name, key: lastCursor || null }); } });
    fbSpace.child('presence').on('value', (s) => {
      const all = s.val() || {};
      const users = new Map();
      for (const k in peers) delete peers[k];
      for (const [cid, p] of Object.entries(all)) {
        if (!p || !p.name) continue;
        users.set(p.id, { id: p.id, name: p.name, img: '' });
        if (cid !== clientId && p.key) peers[cid] = { name: p.name, key: p.key, color: colorFor(p.id) };
      }
      renderPeople([...users.values()]);
    });
  }
  function cloudWrite(before, after) {
    const up = {};
    for (const k of ['title', ...ARRAY_KEYS]) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) up[k] = after[k] == null ? null : JSON.parse(JSON.stringify(after[k]));
    }
    // 메모는 칸별로 저장 (한 칸을 고칠 때 다른 사람이 쓴 다른 칸 내용을 덮어쓰지 않게)
    const mb = before.memo || {}, ma = after.memo || {};
    for (const k of new Set([...Object.keys(mb), ...Object.keys(ma)])) {
      if ((mb[k] || '') !== (ma[k] || '')) up['memo/' + k] = ma[k] || '';
    }
    const keys = new Set([...Object.keys(before.cells || {}), ...Object.keys(after.cells || {})]);
    for (const k of keys) {
      const a = (before.cells || {})[k], b = (after.cells || {})[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) up['cells/' + k] = b || null;
    }
    if (Object.keys(up).length) fbData.update(up).catch((e) => toast('저장 실패: ' + e.message));
  }
  function downloadBackup() {
    const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `SPACEBASE-스케줄-백업-${ymd(d)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function connect() {
    if (CLOUD) {
      $('#backupLink').addEventListener('click', (e) => { e.preventDefault(); if (db) downloadBackup(); });
      $('#logoutLink').addEventListener('click', (e) => {
        e.preventDefault();
        const c = getCred(); if (!c) return;
        $('#gateCode').value = c.code;
        showGate();
      });
      return connectCloud();
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => setStatus('실시간 연결됨', 'ok');
    ws.onclose = () => { setStatus('연결 끊김 · 다시 연결 중…', 'bad'); setTimeout(connect, 1500); };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.t === 'init') {
        db = msg.db; me = msg.me; version = db.version;
        // 끊긴 동안의 변경을 다시 적용하고 전송
        const q = pending; pending = [];
        q.forEach((op) => rawSend(op));
        $('#me').textContent = me.name + ' 님';
        if (me.id.startsWith('dev:')) $('#logoutLink').textContent = '이름 바꾸기';
        renderAll();
      } else if (msg.t === 'op') {
        if (msg.version !== version + 1) { ws.send(JSON.stringify({ t: 'sync' })); return; }
        version = msg.version;
        Ops.applyOp(db, msg.op);
        renderFor(msg.op);
        if (msg.by) setStatus(`${msg.by} 님이 수정함`, 'ok');
      } else if (msg.t === 'ack') {
        version = msg.version;
      } else if (msg.t === 'presence') {
        renderPeople(msg.users);
      } else if (msg.t === 'cursor') {
        if (msg.id === (me && me.id)) return;
        if (msg.key) peers[msg.id] = { name: msg.name, key: msg.key, color: colorFor(msg.id) };
        else delete peers[msg.id];
        renderPeers();
      }
    };
  }
  // ---------- 되돌리기 (Ctrl+Z / Ctrl+Y) ----------
  let undoStack = [];
  let redoStack = [];
  function send(op) { // 사용자가 한 변경: 되돌리기 기록을 남긴다
    const inv = invert(db, op);
    rawSend(op);
    if (inv) { undoStack.push(inv); if (undoStack.length > 300) undoStack.shift(); redoStack = []; }
  }
  function undo() {
    const inv = undoStack.pop();
    if (!inv) { toast('더 되돌릴 내용이 없습니다.'); return; }
    const back = invert(db, inv);
    rawSend(inv);
    if (back) redoStack.push(back);
    renderAll(); toast('되돌렸습니다 (Ctrl+Y: 다시 실행)');
  }
  function redo() {
    const op = redoStack.pop();
    if (!op) return;
    const inv = invert(db, op);
    rawSend(op);
    if (inv) undoStack.push(inv);
    renderAll();
  }
  // op 를 적용하기 직전 상태(d)를 보고, 원래대로 돌리는 op 를 만든다
  function invert(d, op) {
    const clone = (x) => JSON.parse(JSON.stringify(x));
    switch (op.k) {
      case 'cell': { const p = d.cells[op.pid + '|' + op.date] || {}; return { k: 'cell', pid: op.pid, date: op.date, t: p.t || '', c: p.c || '' }; }
      case 'cells': return { k: 'batch', ops: op.list.map((it) => { const p = d.cells[it.pid + '|' + it.date] || {}; return { k: 'cell', pid: it.pid, date: it.date, t: p.t || '', c: p.c || '' }; }) };
      case 'batch': {
        const tmp = clone(d); const out = [];
        for (const sub of op.ops) { const iv = invert(tmp, sub); if (iv) out.unshift(iv); Ops.applyOp(tmp, sub); }
        const flat = []; out.forEach((x) => (x.k === 'batch' ? flat.push(...x.ops) : flat.push(x)));
        return { k: 'batch', ops: flat };
      }
      case 'proj': { const p = d.projects.find((x) => x.id === op.id); return p ? { k: 'proj', id: op.id, field: op.field, value: p[op.field] || '' } : null; }
      case 'addProj': return { k: 'delProj', id: op.project.id };
      case 'delProj': {
        const i = d.projects.findIndex((x) => x.id === op.id); if (i < 0) return null;
        const p = d.projects[i];
        const prev = d.projects[i - 1], next = d.projects[i + 1];
        const add = { k: 'addProj', project: clone(p) };
        if (prev && prev.groupId === p.groupId) add.after = prev.id; else if (next && next.groupId === p.groupId) add.before = next.id;
        const ops = [add];
        Object.keys(d.cells).forEach((k) => { if (k.startsWith(op.id + '|')) { const c = d.cells[k]; ops.push({ k: 'cell', pid: op.id, date: k.split('|')[1], t: c.t || '', c: c.c || '' }); } });
        return { k: 'batch', ops };
      }
      case 'moveProj': { const tmp = clone(d); return Ops.applyOp(tmp, op) ? { k: 'moveProj', id: op.id, dir: -op.dir } : null; }
      case 'addGroup': return { k: 'delGroup', id: op.id };
      case 'renameGroup': { const g = d.groups.find((x) => x.id === op.id); return g ? { k: 'renameGroup', id: op.id, name: g.name } : null; }
      case 'delGroup': { const i = d.groups.findIndex((x) => x.id === op.id); return i < 0 ? null : { k: 'addGroup', id: op.id, name: d.groups[i].name, index: i, shade: d.groups[i].shade }; }
      case 'groupShade': { const g = d.groups.find((x) => x.id === op.id); return g ? { k: 'groupShade', id: op.id, value: !!g.shade } : null; }
      case 'moveGroup': { const tmp = clone(d); return Ops.applyOp(tmp, op) ? { k: 'moveGroup', id: op.id, dir: -op.dir } : null; }
      case 'memo': return { k: 'memo', key: op.key, value: (d.memo || {})[op.key] || '' };
      case 'team': return { k: 'team', idx: op.idx, value: (d.teams || [])[op.idx] || '' };
      case 'ranks': return { k: 'ranks', list: clone(d.ranks || []) };
      case 'mteamAdd': return { k: 'mteamDel', id: op.team.id };
      case 'mteamSet': { const t = (d.mteams || []).find((x) => x.id === op.id); return t ? { k: 'mteamSet', id: op.id, value: t.name } : null; }
      case 'mteamDel': {
        const i = (d.mteams || []).findIndex((x) => x.id === op.id);
        if (i < 0) return null;
        const ops = [{ k: 'mteamAdd', team: clone(d.mteams[i]), index: i }];
        (d.members || []).forEach((m, mi) => { if (m.teamId === op.id) ops.push({ k: 'memberAdd', member: clone(m), index: mi }); });
        return { k: 'batch', ops };
      }
      case 'memberAdd': return { k: 'memberDel', id: op.member.id };
      case 'memberSet': { const m = (d.members || []).find((x) => x.id === op.id); return m ? { k: 'memberSet', id: op.id, field: op.field, value: m[op.field] || '' } : null; }
      case 'memberDel': { const i = (d.members || []).findIndex((x) => x.id === op.id); return i < 0 ? null : { k: 'memberAdd', member: clone(d.members[i]), index: i }; }
      case 'memberMove': return { k: 'memberMove', id: op.id, dir: op.dir < 0 ? 1 : -1 };
    }
    return null;
  }
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const k = e.key.toLowerCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      // 입력 중(글자를 고친 상태)이면 글자 단위 되돌리기. 칸을 눌러 입력창만 열린 상태면 표 되돌리기
      const el = document.activeElement;
      if (!(k === 'z' || k === 'y') || (tag !== 'SELECT' && el.value !== el._orig)) return;
      e.preventDefault(); closePop(); if (el.blur) el.blur();
      if (k === 'z' && !e.shiftKey) undo(); else redo();
      return;
    }
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); closePop(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); closePop(); redo(); }
  }, true);

  function rawSend(op) {
    if (CLOUD) {
      const before = JSON.parse(JSON.stringify(db));
      Ops.applyOp(db, op); // 내 화면에 먼저 반영
      cloudWrite(before, db);
      return;
    }
    Ops.applyOp(db, op); // 내 화면에 먼저 반영
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'op', op, id: uid('o') }));
    else pending.push(op);
  }
  function sendRemote(op) { // 이미 로컬에 반영된 경우
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'op', op, id: uid('o') }));
    else pending.push(op);
  }
  function setStatus(t, cls) { const s = $('#status'); s.textContent = t; s.className = 'status ' + (cls || ''); }
  function colorFor(id) {
    let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 65% 42%)`;
  }
  function renderPeople(users) {
    $('#people').innerHTML = users.map((u) => `<span title="${esc(u.name)}" style="background-color:${colorFor(u.id)};${u.img ? `background-image:url('${esc(u.img)}')` : ''}">${u.img ? '' : esc(u.name.slice(-2))}</span>`).join('');
    const ids = new Set(users.map((u) => u.id));
    Object.keys(peers).forEach((k) => { if (!ids.has(k)) delete peers[k]; });
    renderPeers();
  }
  let lastCursor = null;
  function sendCursor() {
    const key = sel ? `${rowList[sel.r0]}|${days[sel.c0] && ymd(days[sel.c0])}` : null;
    if (key === lastCursor) return;
    lastCursor = key;
    if (CLOUD) { if (fbSpace) fbSpace.child('presence/' + clientId + '/key').set(key || null); return; }
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'cursor', key }));
  }

  // ---------- 그리기 ----------
  function renderAll() {
    renderSheet();
    renderMemo();
    renderMembers();
    renderLegend();
    $('#title').textContent = db.title || 'SPACEBASE SCHEDULE';
  }
  function renderFor(op) {
    if (['memo'].includes(op.k)) renderMemo();
    else if (op.k === 'team') renderMemo();
    else if (/^(member|mteam|ranks|initMembers)/.test(op.k)) renderMembers();
    else if (op.k === 'cat' || op.k === 'delCat') { renderLegend(); renderSheet(); }
    else if (op.k === 'batch') renderAll();
    else renderSheet();
  }

  function catOf(id) { return db.categories.find((c) => c.id === id); }
  function textColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.65 ? '#fff' : '#000';
  }

  const measureCtx = document.createElement('canvas').getContext('2d');
  function textWidth(t) {
    measureCtx.font = `12px ${getComputedStyle(document.body).fontFamily}`;
    return measureCtx.measureText(t).width + 4;
  }

  const SHADE = '#D9D9D9';
  let shadeMigrated = false;
  function migrateShade() {
    // 처음 한 번: 'PROJECT' 구분은 날짜칸 기본 회색 (엑셀처럼). 이후엔 오른쪽 클릭으로 끄고 켤 수 있다
    if (shadeMigrated || !db.groups) return;
    shadeMigrated = true;
    const ops = db.groups.filter((g) => g.shade == null && /^project$/i.test((g.name || '').trim())).map((g) => ({ k: 'groupShade', id: g.id, value: true }));
    if (ops.length) rawSend(ops.length === 1 ? ops[0] : { k: 'batch', ops });
  }
  function renderSheet() {
    migrateShade();
    // 포커스 중인 입력칸 보존
    const ae = document.activeElement;
    const keep = ae && ae.dataset && ae.dataset.key ? { key: ae.dataset.key, val: ae.value, typed: ae.value !== ae._orig, orig: ae._orig, s: ae.selectionStart, e: ae.selectionEnd } : null;

    days = Array.from({ length: 21 }, (_, i) => addDays(focusMonday, i - 7));
    $('#weekLabel').textContent = weekLabel(focusMonday);

    // 인쇄할 때는 엑셀 원본(A4 가로 1장)과 같은 칸 비율로 좁혀서 글씨가 작아지지 않게 한다
    const printing = document.body.classList.contains('printing');
    const dayW = printing ? 34 : 50;
    const cols = printing ? [68, 50, 156, 71, 70, 124, 54, 57] : [80, 64, 170, 80, 92, 168, 64, 64];
    const noteW = printing ? 80 : 120;
    const tableW = cols.reduce((a, b) => a + b, 0) + days.length * dayW + noteW;
    $('#sheet').style.width = tableW + 'px'; // 표가 화면에 맞춰 줄어들지 않게 고정
    $('#sheetTitle').style.width = tableW + 'px'; // 제목은 표 가운데에
    $('#pageFoot').style.width = tableW + 'px';
    let h = '<colgroup>' + cols.map((w) => `<col style="width:${w}px">`).join('') + days.map(() => `<col style="width:${dayW}px">`).join('') + `<col style="width:${noteW}px"></colgroup>`;

    // 헤더 3줄
    const months = [];
    days.forEach((d) => {
      const m = d.getMonth() + 1;
      if (months.length && months[months.length - 1].m === m) months[months.length - 1].n++;
      else months.push({ m, n: 1 });
    });
    h += '<thead><tr class="head-1">';
    h += '<th rowspan="3" colspan="2">구&nbsp;&nbsp;&nbsp;분</th><th rowspan="3">PROJECT</th><th rowspan="3">면적<br>(py)</th><th rowspan="3">공사금액<br>(천원)</th><th rowspan="3">공사기간/진행업무<br>(예정)</th><th colspan="2">담 당 자</th>';
    h += months.map((x) => `<th class="month" colspan="${x.n}">${x.m}월</th>`).join('');
    h += '<th class="note-h">NOTE</th></tr><tr><th>설계</th><th>공사</th>';
    h += days.map((d) => `<th class="day${redDay(d) ? ' red' : ''}"${holName(d) ? ` title="${holName(d)}"` : ''}>${d.getDate()}</th>`).join('');
    h += '<th class="note-h"></th></tr><tr><th>M/S</th><th>M/S</th>';
    h += days.map((d) => `<th class="day${redDay(d) ? ' red' : ''}"${holName(d) ? ` title="${holName(d)}"` : ''}>${WD[d.getDay()]}</th>`).join('');
    h += '<th class="note-h"></th>';
    h += '</tr></thead><tbody>';
    const spacer = `<tr class="spacer"><td colspan="${8 + days.length}"></td><td class="keep"></td></tr>`;
    h += spacer;

    rowList = [];
    const dateKeys = days.map(ymd);
    db.groups.forEach((g, gi) => {
      const ps = db.projects.filter((p) => p.groupId === g.id);
      if (!ps.length) {
        h += `<tr data-group="${g.id}" class="empty-group"><td class="g" colspan="2"><input class="cell" data-key="g|${g.id}" value="${esc(g.name)}"></td><td colspan="${6 + days.length}" style="color:#888;font-size:12px;text-align:left;padding-left:8px">비어 있는 구분입니다. 오른쪽 클릭 또는 왼쪽 ＋ 로 행을 추가하세요.</td><td class="note"></td></tr>`;
      }
      ps.forEach((p, i) => {
        const r = rowList.length;
        rowList.push(p.id);
        const edge = (i === 0 ? ' gfirst' : '') + (i === ps.length - 1 ? ' glast' : '');
        h += `<tr data-pid="${p.id}" data-r="${r}" class="prow${edge}">`;
        if (i === 0) h += `<td class="g" rowspan="${ps.length}" data-group="${g.id}"><input class="cell" data-key="g|${g.id}" value="${esc(g.name)}"></td>`;
        h += `<td class="info">${inp(p, 'type')}</td>`;
        h += `<td class="info">${inp(p, 'name', 'left')}</td>`;
        h += `<td class="info">${inp(p, 'area')}</td>`;
        h += `<td class="info">${inp(p, 'amount', 'right')}</td>`;
        h += `<td class="info">${inp(p, 'period')}</td>`;
        h += `<td class="info">${inp(p, 'design')}</td>`;
        h += `<td class="info">${inp(p, 'build')}</td>`;
        // 칸 텍스트가 옆 빈칸으로 넘쳐 보이게 (엑셀처럼)
        const cells = dateKeys.map((k) => db.cells[p.id + '|' + k] || {});
        cells.forEach((cell, c) => {
          const d = days[c];
          const we = d.getDay() === 0 || d.getDay() === 6 || !!holName(d);
          const cat = cell.c && catOf(cell.c);
          // 회색 구분(PROJECT 등): 색을 안 칠한 칸도 기본 회색 (새 행·새 날짜도 자동)
          let style = cat ? `background:${cat.color}` : (g.shade ? `background:${SHADE}` : '');
          let inner = '';
          if (cell.t) {
            let L = 0, R = 0;
            for (let j = c - 1; j >= 0 && !cells[j].t; j--) L++;
            for (let j = c + 1; j < cells.length && !cells[j].t; j++) R++;
            const tw = textWidth(cell.t);
            const need = Math.max(1, Math.ceil(tw / dayW));
            // 글자는 항상 자기 칸에서 시작한다. 앞(왼쪽) 날짜 칸으로는 넘치지 않고, 오른쪽 빈칸으로만 넘친다.
            // 오른쪽에 자리가 모자라면 글자를 조금 작게 해서 자기 칸 안에 맞춘다.
            let left = 0, width, cls = '', fs = '';
            if (need === 1) width = dayW;
            else {
              width = (Math.min(need - 1, R) + 1) * dayW; cls = 'l';
              const base = printing ? 10.7 : 12, twb = tw * base / 12; // tw 는 12px 기준
              if (twb > width) fs = `font-size:${Math.max(7, base * (width - 2) / twb).toFixed(1)}px;`;
            }
            const fits = need === 1;
            const color = '#000'; // 칸 색과 상관없이 글자는 검은색 (엑셀과 같게)
            inner = `<span class="txt ${cls}" style="left:${left - 1}px;width:${width + 1}px;color:${color};${fs}"><i>${esc(cell.t)}</i></span>`; // 글자 부분을 누르면 그 글자가 있는 칸이 선택됨
          }
          h += `<td class="d${we ? ' we' : ''}" data-r="${r}" data-c="${c}" style="${style}" title="${esc(cell.t || '')}${cat ? (cell.t ? ' · ' : '') + esc(cat.name) : ''}">${inner}</td>`;
        });
        h += `<td class="note">${inp(p, 'note')}</td>`;
        h += '</tr>';
      });
      h += spacer;
    });
    h += '</tbody>';
    $('#sheet').innerHTML = h;

    if (keep) {
      const el = document.querySelector(`[data-key="${CSS.escape(keep.key)}"]`);
      if (el) {
        // 고치던 중이면 그 글자를 유지, 그냥 커서만 있던 칸이면 다른 사람이 바꾼 최신 값을 보여 준다
        if (keep.typed) el.value = keep.val;
        el.focus(); el._orig = keep.typed ? keep.orig : el.value;
        try { el.setSelectionRange(keep.s, keep.e); } catch {}
      }
    }
    if (sel) clampSel();
    paintSel();
    renderPeers();
    placeThisWeekBox();
  }

  function inp(p, field, align = '') {
    let v = p[field] || '';
    let shown = v;
    if (field === 'amount') shown = fmtAmount(v);
    if (field === 'area') shown = fmtArea(v);
    return `<input class="cell ${align}" data-key="p|${p.id}|${field}" data-pid="${p.id}" data-field="${field}" value="${esc(shown)}" ${field === 'amount' ? 'inputmode="numeric"' : ''}>`;
  }

  function placeThisWeekBox() {
    const box = $('#thisWeekBox');
    const wrap = $('#sheetWrap');
    const first = $(`#sheet td.d[data-r="0"][data-c="7"]`);
    const lastR = rowList.length - 1;
    const last = $(`#sheet td.d[data-r="${lastR}"][data-c="13"]`);
    if (!first || !last) { box.style.display = 'none'; return; }
    // offsetLeft/Top 은 확대·축소(인쇄 맞춤)에 영향을 받지 않는다
    // 셀의 위치를 박스가 들어 있는 sheet-wrap 기준으로 계산 (offsetParent 를 따라 올라감)
    const pos = (el) => { let x = 0, y = 0; while (el && el !== wrap) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; } return { x, y }; };
    const pa = pos(first), pb = pos(last);
    const x0 = pa.x, y0 = pa.y, x1 = pb.x + last.offsetWidth, y1 = pb.y + last.offsetHeight;
    box.style.display = 'block';
    box.style.left = x0 - 1 + 'px';
    box.style.top = y0 - 1 + 'px';
    box.style.width = x1 - x0 + 2 + 'px';
    box.style.height = y1 - y0 + 2 + 'px';
  }

  // ---------- 선택 ----------
  function normSel() {
    if (!sel) return null;
    return { r0: Math.min(sel.r0, sel.r1), r1: Math.max(sel.r0, sel.r1), c0: Math.min(sel.c0, sel.c1), c1: Math.max(sel.c0, sel.c1) };
  }
  function clampSel() {
    const maxR = rowList.length - 1;
    if (maxR < 0) { sel = null; return; }
    ['r0', 'r1'].forEach((k) => (sel[k] = Math.min(Math.max(sel[k], 0), maxR)));
    ['c0', 'c1'].forEach((k) => (sel[k] = Math.min(Math.max(sel[k], 0), 20)));
  }
  function paintSel() {
    $$('#sheet td.d.sel, #sheet td.d.sel-multi').forEach((td) => td.classList.remove('sel', 'sel-multi'));
    const n = normSel();
    if (!n) return;
    const multi = n.r0 !== n.r1 || n.c0 !== n.c1;
    for (let r = n.r0; r <= n.r1; r++) for (let c = n.c0; c <= n.c1; c++) {
      const td = $(`#sheet td.d[data-r="${r}"][data-c="${c}"]`);
      if (td) td.classList.add(multi ? 'sel-multi' : 'sel');
    }
    if (multi) { const a = $(`#sheet td.d[data-r="${sel.r0}"][data-c="${sel.c0}"]`); if (a) a.classList.add('sel'); }
    sendCursor();
  }
  function selCells() {
    const n = normSel(); const out = [];
    if (!n) return out;
    for (let r = n.r0; r <= n.r1; r++) for (let c = n.c0; c <= n.c1; c++) out.push({ pid: rowList[r], date: ymd(days[c]) });
    return out;
  }
  function renderPeers() {
    $$('#sheet .peer').forEach((x) => x.remove());
    for (const id in peers) {
      const p = peers[id];
      const [pid, date] = p.key.split('|');
      const r = rowList.indexOf(pid);
      const c = days.findIndex((d) => ymd(d) === date);
      if (r < 0 || c < 0) continue;
      const td = $(`#sheet td.d[data-r="${r}"][data-c="${c}"]`);
      if (td) td.insertAdjacentHTML('beforeend', `<span class="peer" style="border-color:${p.color}"><b style="background:${p.color}">${esc(p.name)}</b></span>`);
    }
  }

  // ---------- 칸 편집 팝업 ----------
  const pop = $('#pop');
  function openPop(initialText) {
    const n = normSel();
    if (!n) return;
    const multi = n.r0 !== n.r1 || n.c0 !== n.c1;
    const pid = rowList[sel.r0];
    const date = ymd(days[sel.c0]);
    const cell = db.cells[pid + '|' + date] || {};
    const p = db.projects.find((x) => x.id === pid);
    const d = days[sel.c0];
    $('#popTitle').textContent = multi ? `${selCells().length}칸 선택됨 · 카테고리를 고르면 모두 칠해집니다` : `${p ? p.name : ''} · ${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
    const t = $('#popText');
    t.value = initialText != null ? initialText : (cell.t || '');
    t._orig = initialText != null ? null : t.value;
    t.placeholder = multi ? `첫 칸(${d.getMonth() + 1}/${d.getDate()})에 넣을 글자` : '일정 입력 후 Enter';
    const curCat = multi ? null : (cell.c || '');
    $('#popChips').innerHTML = `<button class="chip${curCat === '' ? ' on' : ''}" data-cat=""><i class="none"></i>색 없음</button>` +
      db.categories.map((c) => `<button class="chip${curCat === c.id ? ' on' : ''}" data-cat="${c.id}"><i style="background:${c.color}"></i>${esc(c.name)}</button>`).join('');
    pop.classList.remove('hidden');
    const td = $(`#sheet td.d[data-r="${sel.r0}"][data-c="${sel.c0}"]`);
    const r = td.getBoundingClientRect();
    let left = r.left + window.scrollX;
    if (left + 310 > window.scrollX + document.documentElement.clientWidth) left = window.scrollX + document.documentElement.clientWidth - 316;
    let top = r.bottom + window.scrollY + 4;
    const ph = pop.offsetHeight;
    if (r.bottom + ph + 10 > window.innerHeight && r.top - ph - 4 > 0) top = r.top + window.scrollY - ph - 4;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    t.focus();
    if (initialText != null) t.setSelectionRange(t.value.length, t.value.length); else t.select();
  }
  function closePop() { pop.classList.add('hidden'); if (document.activeElement && pop.contains(document.activeElement)) document.activeElement.blur(); }
  function savePopText() {
    if (pop.classList.contains('hidden') || !sel) return;
    const pid = rowList[sel.r0]; const date = ymd(days[sel.c0]);
    const cur = (db.cells[pid + '|' + date] || {}).t || '';
    const v = $('#popText').value.trim();
    if (v !== cur) send({ k: 'cell', pid, date, t: v });
  }
  $('#popText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); savePopText(); closePop(); renderSheet(); moveSel(1, 0); }
    else if (e.key === 'Escape') { closePop(); }
    else if (e.key === 'Tab') { e.preventDefault(); savePopText(); closePop(); renderSheet(); moveSel(0, e.shiftKey ? -1 : 1); }
  });
  $('#popChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const list = selCells();
    const v = $('#popText').value.trim();
    if (list.length === 1) send({ k: 'cell', pid: list[0].pid, date: list[0].date, t: v, c: b.dataset.cat });
    else {
      const ops = [{ k: 'cells', list, c: b.dataset.cat }];
      const first = { pid: rowList[sel.r0], date: ymd(days[sel.c0]) };
      if (v !== ((db.cells[first.pid + '|' + first.date] || {}).t || '')) ops.push({ k: 'cell', ...first, t: v });
      send({ k: 'batch', ops: ops.flatMap((o) => (o.k === 'cells' ? o.list.map((it) => ({ k: 'cell', pid: it.pid, date: it.date, c: o.c })) : [o])) });
    }
    closePop(); renderSheet();
  });
  $('#popClear').addEventListener('click', () => { clearSel(); closePop(); });
  $('#popClose').addEventListener('click', () => { savePopText(); closePop(); renderSheet(); });

  function clearSel() {
    const list = selCells(); if (!list.length) return;
    send({ k: 'cells', list, t: '', c: '' });
    renderSheet();
  }
  function moveSel(dr, dc, extend) {
    if (!sel) return;
    if (extend) { sel.r1 += dr; sel.c1 += dc; }
    else {
      let r = sel.r0 + dr, c = sel.c0 + dc;
      if (c < 0 || c > 20) { // 주 넘기기
        focusMonday = addDays(focusMonday, c < 0 ? -7 : 7);
        c = c < 0 ? c + 7 : c - 7;
        sel = { r0: r, c0: c, r1: r, c1: c };
        renderSheet(); return;
      }
      sel = { r0: r, c0: c, r1: r, c1: c };
    }
    clampSel(); paintSel();
  }

  // 마우스 선택
  const sheet = $('#sheet');
  sheet.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td.d'); if (!td || e.button !== 0) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (!pop.classList.contains('hidden')) { savePopText(); closePop(); }
    const r = +td.dataset.r, c = +td.dataset.c;
    if (e.shiftKey && sel) { sel.r1 = r; sel.c1 = c; }
    else sel = { r0: r, c0: c, r1: r, c1: c };
    dragging = true; paintSel();
  });
  sheet.addEventListener('mouseover', (e) => {
    if (!dragging) return;
    const td = e.target.closest('td.d'); if (!td) return;
    sel.r1 = +td.dataset.r; sel.c1 = +td.dataset.c; paintSel();
  });
  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (e.target.closest && e.target.closest('td.d')) openPop();
  });
  sheet.addEventListener('dblclick', (e) => {
    if (!e.target.closest('td.d')) return;
    openPop();
    // 더블클릭은 글자 고치기: 전체 선택 대신 커서를 글자 끝에 둔다 (엑셀처럼)
    const t = $('#popText'); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
  });

  // 키보드 (엑셀처럼)
  document.addEventListener('keydown', (e) => {
    if (!sel || !pop.classList.contains('hidden')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.ctrlKey || e.metaKey;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) { e.preventDefault(); moveSel(...arrows[e.key], e.shiftKey); }
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); openPop(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSel(); }
    else if (e.key === 'Escape') { sel = null; paintSel(); }
    else if (mod && e.key.toLowerCase() === 'c') { copySel(); e.preventDefault(); }
    else if (mod && e.key.toLowerCase() === 'x') { copySel(); clearSel(); e.preventDefault(); }
    else if (mod && e.key.toLowerCase() === 'v') { pasteSel(); e.preventDefault(); }
    else if (!mod && e.key.length === 1) { e.preventDefault(); openPop(e.key); }
    else if (e.key === 'Process') { openPop(''); } // 한글 입력 시작
  });

  function copySel() {
    const n = normSel(); if (!n) return;
    clipboard = [];
    for (let r = n.r0; r <= n.r1; r++) {
      const row = [];
      for (let c = n.c0; c <= n.c1; c++) row.push(Object.assign({}, db.cells[rowList[r] + '|' + ymd(days[c])] || {}));
      clipboard.push(row);
    }
    toast(`${clipboard.length * clipboard[0].length}칸 복사됨 · 붙여넣을 칸을 선택하고 Ctrl+V`);
  }
  function pasteSel() {
    if (!clipboard || !sel) return;
    const n = normSel();
    const ops = [];
    clipboard.forEach((row, i) => row.forEach((cell, j) => {
      const r = n.r0 + i, c = n.c0 + j;
      if (r >= rowList.length || c > 20) return;
      ops.push({ k: 'cell', pid: rowList[r], date: ymd(days[c]), t: cell.t || '', c: cell.c || '' });
    }));
    if (ops.length) send({ k: 'batch', ops });
    renderSheet();
  }

  // ---------- 프로젝트 정보 칸 ----------
  sheet.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.field) return;
    const p = db.projects.find((x) => x.id === el.dataset.pid);
    if (!p) return;
    if (el.dataset.field === 'area') el.value = p.area || '';
    if (el.dataset.field === 'amount') el.value = fmtAmount(p.amount || '');
    el.select();
    sel = null; paintSel();
  });
  sheet.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.field === 'amount') {
      // 숫자만 입력하면 자동으로 천 단위 쉼표
      const raw = el.value.replace(/,/g, '');
      if (/^-?\d*$/.test(raw) && raw !== '-') {
        const fromEnd = el.value.length - el.selectionStart;
        el.value = raw === '' ? '' : Number(raw).toLocaleString('ko-KR');
        const pos = Math.max(0, el.value.length - fromEnd);
        el.setSelectionRange(pos, pos);
      }
    }
  });
  sheet.addEventListener('focusout', (e) => commitInput(e.target));
  // 포커스 받을 때 값을 기억해 두고, 안 고친 상태에서 Ctrl+Z 를 누르면 표 되돌리기로 넘긴다
  document.addEventListener('focusin', (e) => { const el = e.target; if (el && el.id !== 'popText' && 'value' in el) el._orig = el.value; });

  // ---------- 담당자(설계/공사) 칸: 구성원 약칭을 눌러서 고르기 ----------
  const abbrPop = document.createElement('div');
  abbrPop.className = 'abbr-pop hidden';
  document.body.appendChild(abbrPop);
  let abbrKey = null;
  function abbrTokens(v) { return String(v || '').split(/[\/,·]+|\s+/).map((s) => s.trim()).filter((s) => s && s !== '-'); }
  function abbrInput() { return abbrKey ? document.querySelector(`[data-key="${CSS.escape(abbrKey)}"]`) : null; }
  function closeAbbrPop() { abbrKey = null; abbrPop.classList.add('hidden'); }
  function renderAbbrPop() {
    const el = abbrInput();
    if (!el) return closeAbbrPop();
    const sel = abbrTokens(el.value);
    const rows = (db.mteams || []).map((t) => {
      const ms = (db.members || []).filter((m) => m.teamId === t.id && m.abbr);
      if (!ms.length) return '';
      return `<div class="ap-row"><span class="ap-team">${esc(t.name)}</span>${ms.map((m) => `<button type="button" class="ap-chip${sel.includes(m.abbr) ? ' on' : ''}" data-ab="${esc(m.abbr)}" title="${esc((m.rank + ' ' + m.name).trim())}">${esc(m.abbr)}</button>`).join('')}</div>`;
    }).join('');
    abbrPop.innerHTML = (rows || '<div class="ap-empty">아래 ■ 구성원에 약칭을 먼저 넣어 주세요.</div>')
      + '<div class="ap-foot"><button type="button" class="ap-clear">비우기</button><span>눌러서 넣기/빼기 · 직접 입력도 돼요</span></div>';
    const r = el.getBoundingClientRect();
    abbrPop.classList.remove('hidden');
    const w = abbrPop.offsetWidth;
    abbrPop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8)) + 'px';
    abbrPop.style.top = window.scrollY + r.bottom + 2 + 'px';
  }
  abbrPop.addEventListener('mousedown', (e) => e.preventDefault()); // 입력칸 포커스 유지
  abbrPop.addEventListener('click', (e) => {
    const el = abbrInput();
    if (!el) return closeAbbrPop();
    const chip = e.target.closest('.ap-chip');
    if (chip) {
      const ab = chip.dataset.ab;
      let toks = abbrTokens(el.value);
      toks = toks.includes(ab) ? toks.filter((t) => t !== ab) : [...toks, ab];
      el.value = toks.length ? toks[0] + (toks.length > 1 ? ' / ' + toks.slice(1).join(',') : '') : '-'; // 엑셀처럼 "도 / 이,영"
    } else if (e.target.closest('.ap-clear')) el.value = '-';
    else return;
    commitInput(el);
    setTimeout(() => { const n = abbrInput(); if (n && document.activeElement !== n) n.focus(); renderAbbrPop(); }, 0);
  });
  sheet.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.dataset && (el.dataset.field === 'design' || el.dataset.field === 'build')) { abbrKey = el.dataset.key; renderAbbrPop(); }
    else closeAbbrPop();
  });
  sheet.addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if (!a || !a.dataset || a.dataset.key !== abbrKey) closeAbbrPop();
  }, 0));
  sheet.addEventListener('input', (e) => { if (abbrKey && e.target.dataset && e.target.dataset.key === abbrKey) renderAbbrPop(); });
  sheet.addEventListener('keydown', (e) => {
    const el = e.target;
    if (el.tagName !== 'INPUT') return;
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.dataset.cancel = '1'; el.blur(); }
  });
  function commitInput(el) {
    if (!el || !el.dataset || !el.dataset.key) return;
    if (el.dataset.cancel) { delete el.dataset.cancel; renderSheet(); return; }
    // 손대지 않은 칸은 저장하지 않는다 (오래 열어 둔 화면의 옛 값이 다른 사람의 수정을 덮어쓰지 않게)
    if (el._orig !== undefined && el.value === el._orig) return;
    el._orig = el.value;
    const [kind, id, field] = el.dataset.key.split('|');
    if (kind === 'g') {
      const g = db.groups.find((x) => x.id === id);
      if (g && g.name !== el.value.trim()) send({ k: 'renameGroup', id, name: el.value.trim() });
      return;
    }
    const p = db.projects.find((x) => x.id === id);
    if (!p) return;
    let v = el.value.trim();
    if (field === 'amount' && isNum(v)) v = v.replace(/,/g, '');
    if (field === 'area') { const m = v.replace(/,/g, '').match(/^(-?\d+(\.\d+)?)\s*(py|PY|평)?$/); if (m) v = String(Number(m[1])); }
    if ((p[field] || '') !== v) send({ k: 'proj', id, field, value: v });
    // 서식 다시 보이기
    if (field === 'amount') el.value = fmtAmount(v);
    if (field === 'area') el.value = fmtArea(v);
  }

  // ---------- 행 추가/삭제/이동 ----------
  const rowTools = $('#rowTools');
  let hoverPid = null;
  $('#sheetWrap').addEventListener('mousemove', (e) => {
    if (e.target.closest('#rowTools')) return;
    let tr = e.target.closest('tr[data-pid]');
    if (!tr) return;
    // 왼쪽 구분 칸(여러 행을 합친 칸)은 첫 행 소속이라, 마우스 높이로 실제 행을 찾는다
    if (e.target.closest('td.g')) {
      const hit = [...tr.parentNode.querySelectorAll('tr[data-pid]')].find((t) => { const q = t.getBoundingClientRect(); return e.clientY >= q.top && e.clientY < q.bottom; });
      if (hit) tr = hit;
    }
    hoverPid = tr.dataset.pid;
    const wr = $('#sheetWrap').getBoundingClientRect();
    const r = tr.getBoundingClientRect();
    rowTools.style.display = 'flex';
    rowTools.style.top = r.top - wr.top + (r.height - 22) / 2 + 'px';
    rowTools.style.left = $('#sheetWrap').scrollLeft + 2 + 'px';
  });
  $('#sheetWrap').addEventListener('mouseleave', () => { rowTools.style.display = 'none'; });
  rowTools.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !hoverPid) return;
    rowAction(b.dataset.act, hoverPid);
  });

  function newProject(groupId) {
    return { id: uid('p'), groupId, type: 'OFFICE', name: '', area: '', amount: '', period: '', design: '', build: '', note: '' };
  }
  function rowAction(act, pid) {
    const p = db.projects.find((x) => x.id === pid); if (!p) return;
    if (act === 'addBelow' || act === 'addAbove') {
      const np = newProject(p.groupId);
      send(act === 'addBelow' ? { k: 'addProj', project: np, after: pid } : { k: 'addProj', project: np, before: pid });
      renderSheet();
      const el = document.querySelector(`[data-key="p|${np.id}|name"]`); if (el) el.focus();
    } else if (act === 'up' || act === 'down') {
      send({ k: 'moveProj', id: pid, dir: act === 'up' ? -1 : 1 }); renderSheet();
    } else if (act === 'del') {
      const name = p.name || '(이름 없음)';
      if (!confirm(`"${name}" 행을 삭제할까요?\n이 행의 모든 일정도 함께 삭제됩니다.`)) return;
      send({ k: 'delProj', id: pid }); renderSheet(); rowTools.style.display = 'none';
    }
  }

  // 오른쪽 클릭 메뉴
  const ctx = $('#ctx');
  sheet.addEventListener('contextmenu', (e) => {
    const tr = e.target.closest('tr[data-pid], tr[data-group]');
    const gtd = e.target.closest('td.g');
    if (!tr) return;
    e.preventDefault();
    const groupId = gtd ? (gtd.dataset.group || tr.dataset.group) : null;
    let items = [];
    if (tr.dataset.pid && !gtd) {
      const pid = tr.dataset.pid;
      items = [['위에 행 추가', () => rowAction('addAbove', pid)], ['아래에 행 추가', () => rowAction('addBelow', pid)], '-',
        ['위로 이동', () => rowAction('up', pid)], ['아래로 이동', () => rowAction('down', pid)], '-',
        ['행 삭제', () => rowAction('del', pid), 'danger']];
    } else if (groupId) {
      const has = db.projects.some((p) => p.groupId === groupId);
      const gg = db.groups.find((x) => x.id === groupId) || {};
      items = [['이 구분에 행 추가', () => { const np = newProject(groupId); send({ k: 'addProj', project: np }); renderSheet(); }],
        [gg.shade ? '날짜칸 기본색 흰색으로' : '날짜칸 기본색 회색으로', () => { send({ k: 'groupShade', id: groupId, value: !gg.shade }); renderSheet(); }],
        ['구분 위로 이동', () => { send({ k: 'moveGroup', id: groupId, dir: -1 }); renderSheet(); }],
        ['구분 아래로 이동', () => { send({ k: 'moveGroup', id: groupId, dir: 1 }); renderSheet(); }], '-',
        ['새 구분 추가', addGroup],
        has ? ['구분 삭제 (먼저 행을 모두 지우세요)', () => toast('구분 안의 행을 먼저 모두 삭제해 주세요.'), 'danger']
          : ['구분 삭제', () => { send({ k: 'delGroup', id: groupId }); renderSheet(); }, 'danger']];
    }
    ctx.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" class="${it[2] || ''}">${esc(it[0])}</button>`)).join('');
    ctx.classList.remove('hidden');
    ctx.style.left = Math.min(e.clientX, window.innerWidth - 190) + 'px';
    ctx.style.top = Math.min(e.clientY, window.innerHeight - ctx.offsetHeight - 8) + 'px';
    ctx.onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; ctx.classList.add('hidden'); items[+b.dataset.i][1](); };
  });
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#ctx')) ctx.classList.add('hidden');
    if (!pop.classList.contains('hidden') && !e.target.closest('#pop') && !e.target.closest('td.d')) { savePopText(); closePop(); renderSheet(); }
  });
  function addGroup() {
    // 프로그램(Electron)에서는 prompt 창이 안 떠서, 바로 만들고 이름 칸에 커서를 둔다
    const id = uid('g');
    send({ k: 'batch', ops: [{ k: 'addGroup', id, name: '새 구분' }, { k: 'addProj', project: newProject(id) }] });
    renderSheet();
    const el = document.querySelector(`[data-key="g|${id}"]`); if (el) { el.focus(); el.select(); }
  }
  $('#addGroupBtn').addEventListener('click', addGroup);

  // ---------- 메모 / 담당자 ----------
  function renderMemo() {
    // 예전 데이터: 왼쪽 메모에 같이 있던 "■ 공지사항" 부분을 아래 전체 너비 칸으로 옮긴다 (엑셀과 같은 배치)
    const m = db.memo || {};
    const at = (m.left || '').indexOf('■ 공지사항');
    if (!m.notice && at > 0) {
      rawSend({ k: 'memo', key: 'notice', value: m.left.slice(at).trim() });
      rawSend({ k: 'memo', key: 'left', value: m.left.slice(0, at).replace(/\s+$/, '') });
    }
    // 다른 사람이 고친 내용은 바로 보여 준다. 내가 지금 글자를 고치는 중인 칸만 그대로 둔다
    $$('textarea[data-memo]').forEach((t) => { if (t !== document.activeElement || !t._dirty) t.value = (db.memo || {})[t.dataset.memo] || ''; autoGrow(t); });
    $$('textarea[data-team]').forEach((t) => { if (t !== document.activeElement) t.value = (db.teams || [])[+t.dataset.team] || ''; autoGrow(t); });
  }
  // 메모 칸 높이를 내용에 맞춤 (최신 브라우저/프로그램은 CSS field-sizing 으로 자동)
  const FIELD_SIZING = !!(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'));
  function autoGrow(t) { if (FIELD_SIZING) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
  const timers = {};
  function debounced(key, fn) { clearTimeout(timers[key]); timers[key] = setTimeout(fn, 500); }
  $$('textarea[data-memo]').forEach((t) => {
    // 직접 글자를 고친 경우에만 저장한다. 커서만 두었다 빠져나가면 저장하지 않아서,
    // 오래 열어 둔 화면의 빈 칸/옛 내용이 다른 사람이 쓴 공지사항을 지우지 않는다
    const save = () => {
      if (!t._dirty) return;
      t._dirty = false;
      if (((db.memo || {})[t.dataset.memo] || '') !== t.value) send({ k: 'memo', key: t.dataset.memo, value: t.value });
    };
    t.addEventListener('input', () => { t._dirty = true; autoGrow(t); debounced('m' + t.dataset.memo, save); });
    t.addEventListener('blur', save);
  });
  $$('textarea[data-team]').forEach((t) => {
    const save = () => { if (((db.teams || [])[+t.dataset.team] || '') !== t.value) send({ k: 'team', idx: +t.dataset.team, value: t.value }); };
    t.addEventListener('input', () => { autoGrow(t); debounced('t' + t.dataset.team, save); });
    t.addEventListener('blur', save);
  });

  // ---------- 구성원 (팀별 목록, 직급은 목록에서 선택) ----------
  const DEFAULT_RANKS = ['이사', '부장', '실장', '책임', '선임', '사원'];
  let membersMigrated = false;
  function migrateMembers() {
    // 예전: 팀 목록을 글자로 적어 두던 칸 → 팀/약칭/직급/이름 구조로 한 번 옮긴다
    if (membersMigrated || (db.mteams || []).length || (db.members || []).length) return;
    membersMigrated = true;
    const mteams = [], members = [], ranks = DEFAULT_RANKS.slice();
    let cur = null;
    (db.teams || []).forEach((txt) => String(txt || '').split('\n').forEach((line) => {
      line = line.trim();
      if (!line) return;
      const m = line.match(/^\[([^\]]*)\]\s*(\S+)?\s*(.*)$/);
      if (m) {
        if (!cur) { cur = { id: uid('t'), name: '팀' }; mteams.push(cur); }
        const rank = m[2] || '';
        if (rank && !ranks.includes(rank)) ranks.push(rank);
        members.push({ id: uid('m'), teamId: cur.id, abbr: m[1], rank, name: (m[3] || '').trim() });
      } else { cur = { id: uid('t'), name: line }; mteams.push(cur); }
    }));
    if (!mteams.length) ['설계팀', '시공팀', '공무팀', '관리부'].forEach((name) => mteams.push({ id: uid('t'), name }));
    rawSend({ k: 'initMembers', mteams, members, ranks });
  }
  function ranksOf() { return (db.ranks && db.ranks.length ? db.ranks : DEFAULT_RANKS); }
  function renderMembers() {
    migrateMembers();
    const box = $('#mteams');
    const ae = document.activeElement;
    const keepK = ae && box.contains(ae) && ae.dataset.k ? { k: ae.dataset.k, s: ae.selectionStart, e: ae.selectionEnd } : null;
    const ranks = ranksOf();
    let h = '';
    (db.mteams || []).forEach((t) => {
      h += `<div class="mteam" data-team="${t.id}"><div class="mt-head"><input class="mt-name" data-k="t|${t.id}" value="${esc(t.name)}" placeholder="팀 이름"><button class="mt-del tool" title="팀 삭제">✕</button></div>`;
      (db.members || []).filter((m) => m.teamId === t.id).forEach((m) => {
        const opts = ranks.includes(m.rank) || !m.rank ? ranks : [m.rank, ...ranks];
        h += `<div class="mrow${m.abbr || m.name ? '' : ' empty'}" data-id="${m.id}"><span class="m-ab">[<input class="m-abbr" data-k="m|${m.id}|abbr" value="${esc(m.abbr)}" placeholder="약칭">]</span>`
          + `<select class="m-rank" data-k="m|${m.id}|rank"><option value=""${m.rank ? '' : ' selected'}>직급</option>${opts.map((r) => `<option${r === m.rank ? ' selected' : ''}>${esc(r)}</option>`).join('')}<option value="__edit">직급 목록 편집…</option></select>`
          + `<input class="m-name" data-k="m|${m.id}|name" value="${esc(m.name)}" placeholder="이름">`
          + `<span class="m-tools"><button class="tool" data-mact="up" title="위로">▲</button><button class="tool" data-mact="down" title="아래로">▼</button><button class="tool danger" data-mact="del" title="삭제">✕</button></span></div>`;
      });
      h += `<button class="m-add link">＋ 구성원 추가</button></div>`;
    });
    box.innerHTML = h;
    if (keepK) {
      const el = box.querySelector(`[data-k="${CSS.escape(keepK.k)}"]`);
      if (el) { el.focus(); try { el.setSelectionRange(keepK.s, keepK.e); } catch {} }
    }
  }
  function memberInputSave(el) {
    const [kind, id, field] = el.dataset.k.split('|');
    if (kind === 't') {
      const t = (db.mteams || []).find((x) => x.id === id);
      if (t && t.name !== el.value) send({ k: 'mteamSet', id, value: el.value });
    } else {
      const m = (db.members || []).find((x) => x.id === id);
      if (m && (m[field] || '') !== el.value) send({ k: 'memberSet', id, field, value: el.value });
    }
  }
  $('#mteams').addEventListener('input', (e) => {
    const el = e.target;
    if (el.tagName === 'INPUT' && el.dataset.k) debounced('mb' + el.dataset.k, () => memberInputSave(el));
  });
  $('#mteams').addEventListener('focusout', (e) => { if (e.target.tagName === 'INPUT' && e.target.dataset.k) memberInputSave(e.target); });
  $('#mteams').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
  $('#mteams').addEventListener('change', (e) => {
    const el = e.target;
    if (el.tagName !== 'SELECT') return;
    const id = el.dataset.k.split('|')[1];
    if (el.value === '__edit') { renderMembers(); openRanksEditor(); return; }
    send({ k: 'memberSet', id, field: 'rank', value: el.value });
    renderMembers();
  });
  $('#mteams').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const team = b.closest('.mteam'), row = b.closest('.mrow');
    if (b.classList.contains('m-add')) {
      const tid = team.dataset.team;
      const last = (db.members || []).reduce((a, m, i) => (m.teamId === tid ? i : a), -1);
      const id = uid('m');
      const prev = last >= 0 ? db.members[last] : null;
      send({ k: 'memberAdd', member: { id, teamId: tid, abbr: '', rank: prev ? prev.rank : '', name: '' }, index: last >= 0 ? last + 1 : null });
      renderMembers();
      const el = $(`[data-k="m|${id}|abbr"]`); if (el) el.focus();
    } else if (b.classList.contains('mt-del')) {
      const t = (db.mteams || []).find((x) => x.id === team.dataset.team);
      const n = (db.members || []).filter((m) => m.teamId === team.dataset.team).length;
      if (n && !confirm(`"${t ? t.name : ''}" 팀과 구성원 ${n}명을 삭제할까요?`)) return;
      send({ k: 'mteamDel', id: team.dataset.team });
      renderMembers();
    } else if (row && b.dataset.mact) {
      const id = row.dataset.id;
      if (b.dataset.mact === 'del') send({ k: 'memberDel', id });
      else send({ k: 'memberMove', id, dir: b.dataset.mact === 'up' ? -1 : 1 });
      renderMembers();
    }
  });
  $('#mteamAddBtn').addEventListener('click', () => {
    const id = uid('t');
    send({ k: 'mteamAdd', team: { id, name: '새 팀' } });
    renderMembers();
    const el = $(`[data-k="t|${id}"]`); if (el) { el.focus(); el.select(); }
  });
  function openRanksEditor() {
    $('#ranksEdit').classList.remove('hidden');
    $('#ranksInput').value = ranksOf().join(', ');
    $('#ranksInput').focus();
  }
  $('#ranksBtn').addEventListener('click', openRanksEditor);
  $('#ranksCancel').addEventListener('click', () => $('#ranksEdit').classList.add('hidden'));
  function saveRanks() {
    const list = [...new Set($('#ranksInput').value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
    if (list.length) send({ k: 'ranks', list });
    $('#ranksEdit').classList.add('hidden');
    renderMembers();
  }
  $('#ranksSave').addEventListener('click', saveRanks);
  $('#ranksInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRanks(); } else if (e.key === 'Escape') $('#ranksEdit').classList.add('hidden'); });

  // 카테고리는 칸을 눌렀을 때 뜨는 선택 창에서만 고른다 (하단 범례는 없앰)
  function renderLegend() {}

  // ---------- 상단 ----------
  $('#prevWeek').addEventListener('click', () => { focusMonday = addDays(focusMonday, -7); closePop(); renderSheet(); });
  $('#nextWeek').addEventListener('click', () => { focusMonday = addDays(focusMonday, 7); closePop(); renderSheet(); });
  $('#thisWeek').addEventListener('click', () => { focusMonday = mondayOf(new Date()); closePop(); renderSheet(); });
  $('#printBtn').addEventListener('click', () => (window.sbDesktop ? window.sbDesktop.printPreview() : window.print()));
  // A4 가로 한 장에 맞게 자동 축소
  function fitPrint() {
    const pageW = 1080, pageH = 740; // A4 가로(여백 제외)를 화면 픽셀로 환산한 값
    document.body.classList.add('printing');
    sel = null; paintSel();
    $('.etc-memo').classList.toggle('empty', !$('#memoEtc').value.trim());
    document.body.style.zoom = 1;
    const page = $('.page');
    page.style.minHeight = '';
    if (db) renderSheet(); // 인쇄용 칸 너비로 다시 그림
    page.style.width = $('#sheet').offsetWidth + 'px'; // 메모 등도 표 너비에 맞춤
    document.querySelectorAll('textarea[data-memo], textarea[data-team]').forEach(autoGrow);
    const w = Math.max($('#sheet').scrollWidth, page.scrollWidth);
    const h = page.scrollHeight;
    const z = Math.min(pageW / w, pageH / h, 1);
    document.body.style.zoom = z;
    page.style.minHeight = Math.floor(pageH / z) - 4 + 'px'; // 바닥글을 엑셀처럼 종이 맨 아래에
    placeThisWeekBox();
  }
  function unfitPrint() {
    document.body.classList.remove('printing'); document.body.style.zoom = '';
    const page = $('.page'); page.style.width = ''; page.style.minHeight = '';
    if (db) renderSheet();
    document.querySelectorAll('textarea[data-memo], textarea[data-team]').forEach(autoGrow);
    placeThisWeekBox();
  }
  window.__fitPrint = fitPrint; window.__unfitPrint = unfitPrint; // 앱의 인쇄 미리보기에서 사용
  window.addEventListener('beforeprint', fitPrint);
  window.addEventListener('afterprint', unfitPrint);
  window.addEventListener('resize', placeThisWeekBox);
  // 표 크기가 바뀔 때마다 (글꼴 로딩, 스크롤바, 확대/축소 등) 빨간 박스 위치를 다시 맞춘다
  if (window.ResizeObserver) new ResizeObserver(() => placeThisWeekBox()).observe($('#sheet'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeThisWeekBox);
  // 자정이 지나면 오늘/금주 표시 갱신
  let lastDay = ymd(new Date());
  setInterval(() => { const d = ymd(new Date()); if (d !== lastDay) { const wasThis = ymd(focusMonday) === ymd(mondayOf(new Date(Date.now() - 864e5))); lastDay = d; if (wasThis) focusMonday = mondayOf(new Date()); if (db) renderSheet(); } }, 60000);

  let toastTimer;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 2500); }

  connect();
})();
