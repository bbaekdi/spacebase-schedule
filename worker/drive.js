// Band 사진 보관: 회사 구글 드라이브 (Cloudflare Worker 중계)
// 사진은 직원 브라우저 → 이 중계 → 회사 드라이브 폴더 "Band 사진/현장이름/날짜/". 보는 것도 이 중계를 거쳐서 로그인한 회원에게만 보인다.
// 구글 허락 열쇠(refresh token)와 최상위 폴더 번호는 Firebase `driveAuth` 칸에만 있다 (규칙으로 아무도 못 읽음, 이 중계만 서비스 계정으로 읽음).
// 허락 범위는 drive.file = 이 앱이 만든 파일만 (회사 드라이브의 다른 파일은 볼 수도 없음).
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (개인 캘린더 연결에 쓰던 것 그대로), FIREBASE_SERVICE_ACCOUNT
//
// 길:
//   GET  /drive/status            연결됐는지 {ready}
//   POST /drive/connect           (관리자) 구글 허락 화면 주소 {url}
//   GET  /drive/callback          구글이 돌려보내는 곳: 열쇠를 받아 Firebase 에 저장 + "Band 사진" 폴더 만들기
//   POST /drive/upload?site=&day= (회원) 줄인 JPEG 한 장 저장 → {id, size}
//   GET  /drive/photo/<id>        (회원) 사진 보기
//   POST /drive/trash {post}      (글쓴이·관리자) 그 글의 사진을 드라이브 휴지통으로

import { db, authUid } from './push.js';

const G = 'https://www.googleapis.com';
const ROOT_NAME = 'Band 사진';
const MAX_BYTES = 3 * 1024 * 1024;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };

// ---------- 열쇠 (Firebase driveAuth) ----------
let authCache = null, tokCache = null;
const folders = new Map();
async function driveAuth(env, fresh) {
  if (!fresh && authCache && authCache.until > Date.now()) return authCache.v;
  const v = (await db(env, 'driveAuth')) || {};
  authCache = { v, until: Date.now() + 60e3 };
  return v;
}
async function accessToken(env) {
  if (tokCache && tokCache.until > Date.now()) return tokCache.token;
  const a = await driveAuth(env);
  if (!a.rt) throw new Error('not connected');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: a.rt, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) { const e = new Error(j.error === 'invalid_grant' ? 'revoked' : 'token'); e.code = j.error; throw e; }
  tokCache = { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in || 3600) - 120) * 1000 };
  return tokCache.token;
}
const gfetch = async (env, path, opt = {}) => {
  const t = await accessToken(env);
  return fetch(G + path, { ...opt, headers: { Authorization: 'Bearer ' + t, ...(opt.headers || {}) } });
};

// ---------- 폴더: Band 사진 / 현장이름 / 날짜 ----------
const safeName = (s, fb) => String(s || '').replace(/[\u0000-\u001f\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || fb;
async function ensureFolder(env, name, parent) {
  const key = parent + '/' + name;
  if (folders.has(key)) return folders.get(key);
  const q = `name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await gfetch(env, '/drive/v3/files?fields=files(id)&pageSize=1&q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('drive list ' + r.status);
  let id = ((await r.json()).files || [])[0];
  id = id && id.id;
  if (!id) {
    const c = await gfetch(env, '/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
    if (!c.ok) throw new Error('drive mkdir ' + c.status);
    id = (await c.json()).id;
  }
  folders.set(key, id);
  return id;
}

// ---------- 로그인·회원 확인 ----------
async function member(req, env) {
  let uid;
  try { uid = await authUid(req, env); } catch { return { err: 401 }; }
  const m = await db(env, 'ws/members/' + uid);
  if (!m) return { err: 403 };
  return { uid, m, admin: (await db(env, 'ws/admins/' + uid)) === true };
}

// ---------- 구글 허락 (관리자가 한 번) ----------
async function hmac(env, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode('sbe-drive:' + env.GOOGLE_CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
const page = (reply, title, msg, status = 200) => reply(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;line-height:1.7"><h2>${title}</h2><p>${msg}</p>`, status, 'text/html; charset=utf-8');

export async function drive(req, env, url, reply) {
  const p = url.pathname;
  if (!env.FIREBASE_SERVICE_ACCOUNT || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    if (p === '/drive/status') return reply(JSON.stringify({ ready: false, why: 'setup' }), 200, 'application/json');
    return reply('사진 보관 설정이 아직 없습니다.', 503);
  }
  const redirect = url.origin + '/drive/callback';

  if (p === '/drive/status') {
    const a = await driveAuth(env).catch(() => ({}));
    return reply(JSON.stringify({ ready: !!(a.rt && a.root), at: a.at || null }), 200, 'application/json');
  }

  if (p === '/drive/connect') {
    if (req.method !== 'POST') return reply('POST only', 405);
    const w = await member(req, env); if (w.err) return reply('로그인이 필요합니다.', w.err);
    if (!w.admin) return reply('관리자만 연결할 수 있어요.', 403);
    const exp = Date.now() + 15 * 60e3, state = `${w.uid}.${exp}.${await hmac(env, w.uid + '.' + exp)}`;
    const a = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    a.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state }).toString();
    return reply(JSON.stringify({ url: a.toString() }), 200, 'application/json');
  }

  if (p === '/drive/callback') {
    const code = url.searchParams.get('code'), st = String(url.searchParams.get('state') || '').split('.');
    if (url.searchParams.get('error')) return page(reply, '연결하지 않았어요', '구글 허락 화면에서 "허용"을 누르지 않아 연결되지 않았어요. 사이트로 돌아가 다시 눌러 주세요.', 400);
    if (!code || st.length !== 3 || !(Number(st[1]) > Date.now()) || st[2] !== (await hmac(env, st[0] + '.' + st[1]))) return page(reply, '연결 주소가 맞지 않아요', '사이트의 "연결하기" 버튼을 다시 눌러 주세요. (15분이 지났거나 주소가 바뀌었을 수 있어요)', 400);
    if ((await db(env, 'ws/admins/' + st[0])) !== true) return page(reply, '관리자만 연결할 수 있어요', '관리자 계정으로 다시 시도해 주세요.', 403);
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }) });
    const j = await r.json().catch(() => ({}));
    if (!j.refresh_token) return page(reply, '연결하지 못했어요', '구글이 열쇠를 주지 않았어요. 구글 계정의 "서드파티 앱 접근" 설정에서 이 앱을 지운 뒤 다시 "연결하기"를 눌러 주세요.', 502);
    // 새 열쇠로 "Band 사진" 폴더 만들기 (이미 연결했던 폴더가 있으면 그대로 씀)
    tokCache = { token: j.access_token, until: Date.now() + 50 * 60e3 };
    authCache = { v: { rt: j.refresh_token }, until: Date.now() + 60e3 };
    folders.clear();
    let root;
    try {
      const old = await db(env, 'driveAuth/root');
      const chk = old && (await gfetch(env, '/drive/v3/files/' + encodeURIComponent(old) + '?fields=id,trashed'));
      if (chk && chk.ok && !(await chk.json()).trashed) root = old;
      else {
        const c = await gfetch(env, '/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ROOT_NAME, mimeType: 'application/vnd.google-apps.folder' }) });
        if (!c.ok) throw new Error('mkdir ' + c.status);
        root = (await c.json()).id;
      }
    } catch (e) {
      tokCache = null; authCache = null;
      return page(reply, '폴더를 만들지 못했어요', '구글 클라우드에서 "Google Drive API"가 켜져 있는지 확인한 뒤 다시 눌러 주세요. (' + String(e.message).slice(0, 40) + ')', 502);
    }
    await db(env, 'driveAuth', 'PUT', { rt: j.refresh_token, root, at: Date.now(), by: st[0] });
    authCache = null;
    return page(reply, '회사 드라이브가 연결됐어요 ✓', '이제 Band 에서 사진을 올릴 수 있어요. 이 창을 닫고 사이트로 돌아가세요.<br><small>드라이브의 "Band 사진" 폴더에 현장별·날짜별로 저장돼요.</small>');
  }

  // ---- 여기부터는 회원만 ----
  const w = await member(req, env);
  if (w.err) return reply(w.err === 401 ? '로그인이 필요합니다.' : '회원이 아닙니다.', w.err);
  const auth = await driveAuth(env).catch(() => ({}));
  if (!auth.rt || !auth.root) return reply('사진 보관이 아직 연결되지 않았어요. 관리자에게 알려 주세요.', 503);
  const fail = (e) => {
    if (e && e.message === 'revoked') { tokCache = null; return reply('사진 연결이 끊겼어요. 관리자가 다시 "연결하기"를 눌러 주세요.', 503); }
    return reply('사진 처리 중 문제가 생겼어요: ' + String((e && e.message) || e).slice(0, 60), 502);
  };

  if (p === '/drive/upload') {
    if (req.method !== 'POST') return reply('POST only', 405);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length > MAX_BYTES) return reply('사진이 너무 커요 (3MB 이하).', 413);
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return reply('JPEG 사진이 아니에요.', 400);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day') : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const site = safeName(url.searchParams.get('site'), '기타');
    try {
      let dayFolder;
      try { dayFolder = await ensureFolder(env, day, await ensureFolder(env, site, auth.root)); }
      catch (e) { folders.clear(); dayFolder = await ensureFolder(env, day, await ensureFolder(env, site, auth.root)); }
      const name = `${Date.now().toString(36)}-${w.uid.slice(0, 6)}-${Math.random().toString(36).slice(2, 6)}.jpg`;
      const b = 'sbe' + Math.random().toString(36).slice(2);
      const body = concat(enc.encode(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [dayFolder] })}\r\n--${b}\r\nContent-Type: image/jpeg\r\n\r\n`), buf, enc.encode(`\r\n--${b}--`));
      const r = await gfetch(env, '/upload/drive/v3/files?uploadType=multipart&fields=id,size', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
      if (!r.ok) { if (r.status === 404) folders.clear(); throw new Error('drive upload ' + r.status); }
      const j = await r.json();
      return reply(JSON.stringify({ id: j.id, size: buf.length }), 200, 'application/json');
    } catch (e) { return fail(e); }
  }

  const m = p.match(/^\/drive\/photo\/([A-Za-z0-9_-]{10,80})$/);
  if (m) {
    try {
      const r = await gfetch(env, '/drive/v3/files/' + m[1] + '?alt=media');
      if (!r.ok) return reply('사진을 찾을 수 없어요.', r.status === 404 ? 404 : 502);
      const res = reply(await r.arrayBuffer(), 200, 'image/jpeg');
      res.headers.set('Cache-Control', 'private, max-age=86400');
      return res;
    } catch (e) { return fail(e); }
  }

  if (p === '/drive/trash') {
    if (req.method !== 'POST') return reply('POST only', 405);
    let post;
    try { post = String((await req.json()).post || ''); } catch { return reply('bad request', 400); }
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(post)) return reply('bad request', 400);
    const v = await db(env, 'board/posts/' + post);
    if (!v) return reply(JSON.stringify({ trashed: 0 }), 200, 'application/json');
    if (!w.admin && v.uid !== w.uid) return reply('글쓴이나 관리자만 할 수 있어요.', 403);
    const ids = (Array.isArray(v.photos) ? v.photos : Object.values(v.photos || {})).map((x) => x && x.id).filter((x) => /^[A-Za-z0-9_-]{10,80}$/.test(x || ''));
    let n = 0;
    try {
      for (const id of ids) {
        const r = await gfetch(env, '/drive/v3/files/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
        if (r.ok) n++;
      }
    } catch (e) { return fail(e); }
    return reply(JSON.stringify({ trashed: n }), 200, 'application/json');
  }
  return reply('not found', 404);
}
