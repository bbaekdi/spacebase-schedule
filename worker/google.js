// 개인 구글 캘린더 "구글 계정으로 연결" (OAuth). DB 없음.
// 웹사이트는 비밀 열쇠(Client Secret)를 가질 수 없어서 이 중계가 구글 로그인을 대신 처리한다.
// 각자의 연결 정보(refresh token)는 암호화해서 그 사람 브라우저에만 보관하고, 일정을 읽을 때마다 짧은 출입증(access token)으로 바꿔 준다.
// 일정 자체는 브라우저가 구글 캘린더 API 에서 직접 읽는다 (이 중계를 지나지 않음).
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (GitHub Secrets → band-worker.yml)
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function key(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('sbe-google:' + env.GOOGLE_CLIENT_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), enc.encode(JSON.stringify(obj)));
  return b64u(iv) + '.' + b64u(ct);
}
async function open(env, s) {
  const [iv, ct] = String(s || '').split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await key(env), unb64u(ct));
  return JSON.parse(dec.decode(pt));
}
const page = (msg) => new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px"><h3>구글 캘린더 연결</h3><p>${String(msg).replace(/</g, '&lt;')}</p>`, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const SCOPE = 'openid email profile https://www.googleapis.com/auth/calendar.readonly';

async function token(env, params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error === 'invalid_grant' ? 'login' : '토큰 발급 실패: ' + (j.error_description || j.error || r.status));
  return j;
}
const idInfo = (idt) => { try { const p = JSON.parse(dec.decode(unb64u(idt.split('.')[1]))); return { email: p.email || '', name: p.name || '' }; } catch { return { email: '', name: '' }; } };

export async function google(req, env, url, reply) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return reply('구글 연결 설정이 아직 없습니다.', 503);
  const self = url.origin;
  try {
    if (url.pathname === '/google/login') {
      const back = url.searchParams.get('return') || '';
      if (!back.startsWith(env.ALLOWED_ORIGIN + '/')) return page('허용되지 않은 주소입니다.');
      const state = await seal(env, { r: back, t: Date.now() });
      const a = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      a.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID, redirect_uri: self + '/google/callback', response_type: 'code', scope: SCOPE,
        access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state,
      }).toString();
      return Response.redirect(a.toString(), 302);
    }
    if (url.pathname === '/google/callback') {
      const st = await open(env, url.searchParams.get('state')).catch(() => null);
      if (!st || Date.now() - st.t > 10 * 60 * 1000) return page('연결 요청이 만료됐어요. 사이트에서 다시 시도해 주세요.');
      const code = url.searchParams.get('code');
      if (!code) return Response.redirect(st.r.split('#')[0] + '#gconn=cancel', 302);
      const t = await token(env, { grant_type: 'authorization_code', code, redirect_uri: self + '/google/callback' });
      if (!t.refresh_token) return page('구글이 연결 정보를 주지 않았어요. 사이트에서 연동해제 후 다시 연결해 주세요.');
      const who = idInfo(t.id_token || '');
      const blob = await seal(env, { rt: t.refresh_token, email: who.email });
      const q = new URLSearchParams({ gconn: blob, gemail: who.email, gname: who.name });
      return Response.redirect(st.r.split('#')[0] + '#' + q.toString(), 302);
    }
    if (url.pathname === '/google/token' && req.method === 'POST') {
      const s = await open(env, req.headers.get('X-G-Token')).catch(() => null);
      if (!s || !s.rt) return reply(JSON.stringify({ error: 'login' }), 401, 'application/json');
      try {
        const t = await token(env, { grant_type: 'refresh_token', refresh_token: s.rt });
        return reply(JSON.stringify({ access_token: t.access_token, expires_in: t.expires_in || 3600 }), 200, 'application/json');
      } catch (e) {
        return reply(JSON.stringify({ error: e.message === 'login' ? 'login' : e.message }), e.message === 'login' ? 401 : 502, 'application/json');
      }
    }
    if (url.pathname === '/google/revoke' && req.method === 'POST') {
      const s = await open(env, req.headers.get('X-G-Token')).catch(() => null);
      if (s && s.rt) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(s.rt), { method: 'POST' }).catch(() => {});
      return reply(JSON.stringify({ ok: true }), 200, 'application/json');
    }
    return reply('not found', 404);
  } catch (e) {
    return page(e.message || e);
  }
}
