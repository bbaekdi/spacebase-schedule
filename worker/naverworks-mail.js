// 네이버웍스 메일 중계 서버 (Cloudflare Workers, 무료)
// 웹사이트(GitHub Pages)는 비밀 열쇠(Client Secret)를 가질 수 없어서, 이 작은 서버가 대신 네이버웍스에 로그인하고
// 받은 메일 목록만 웹사이트에 돌려준다. 저장소(DB)는 쓰지 않는다:
// 각 사람의 로그인 정보(refresh token)는 암호화해서 그 사람 브라우저에만 보관하고, 요청할 때마다 이 서버가 풀어서 쓴다.
//
// 필요한 설정 (GitHub Actions 가 배포할 때 넣어 줌): NW_CLIENT_ID, NW_CLIENT_SECRET, ALLOWED_ORIGIN
const AUTH = 'https://auth.worksmobile.com/oauth2/v2.0';
const API = 'https://www.worksapis.com/v1.0';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function key(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('sbe-mail:' + env.NW_CLIENT_SECRET));
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

function cors(env, res) {
  res.headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN);
  res.headers.set('Access-Control-Allow-Headers', 'X-NW-Token');
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.headers.set('Vary', 'Origin');
  return res;
}
const json = (env, body, status = 200) => cors(env, new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
const page = (msg) => new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px"><h3>네이버웍스 연결</h3><p>${msg.replace(/</g, '&lt;')}</p>`, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function token(env, params) {
  const r = await fetch(AUTH + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.NW_CLIENT_ID, client_secret: env.NW_CLIENT_SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('토큰 발급 실패: ' + (j.error_description || j.error || r.status));
  return j;
}

async function mails(env, accessToken) {
  const h = { Authorization: 'Bearer ' + accessToken };
  // 받은메일함 찾기
  const fr = await fetch(`${API}/users/me/mail/mailfolders`, { headers: h });
  const fj = await fr.json().catch(() => ({}));
  if (!fr.ok) throw new Error('메일함 목록 실패 ' + fr.status);
  const folders = fj.mailFolders || fj.folders || [];
  const inbox = folders.find((f) => /inbox/i.test(String(f.folderType || '')) || /받은|inbox/i.test(String(f.folderName || ''))) || folders[0];
  if (!inbox) return { mails: [], unreadCount: 0, folderName: '' };
  const lr = await fetch(`${API}/users/me/mail/mailfolders/${encodeURIComponent(inbox.folderId)}/children?count=10`, { headers: h });
  if (lr.status === 204) return { mails: [], unreadCount: 0, folderName: inbox.folderName || '' };
  const lj = await lr.json().catch(() => ({}));
  if (!lr.ok) throw new Error('메일 목록 실패 ' + lr.status);
  return {
    folderName: lj.folderName || inbox.folderName || '',
    unreadCount: lj.unreadCount || 0,
    mails: (lj.mails || []).slice(0, 10).map((m) => ({
      id: m.mailId, subject: m.subject || '(제목 없음)', from: (m.from && (m.from.name || m.from.email)) || '',
      receivedTime: m.receivedTime, unread: m.status === 'Unread', important: !!m.isImportant, attach: m.attachCount || 0,
    })),
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const self = url.origin;
    if (req.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));
    try {
      if (url.pathname === '/login') {
        const back = url.searchParams.get('return') || '';
        if (!back.startsWith(env.ALLOWED_ORIGIN + '/')) return page('허용되지 않은 주소입니다.');
        const state = await seal(env, { r: back, t: Date.now() });
        const a = new URL(AUTH + '/authorize');
        a.search = new URLSearchParams({ client_id: env.NW_CLIENT_ID, redirect_uri: self + '/callback', scope: 'mail.read', response_type: 'code', state }).toString();
        return Response.redirect(a.toString(), 302);
      }
      if (url.pathname === '/callback') {
        const st = await open(env, url.searchParams.get('state')).catch(() => null);
        if (!st || Date.now() - st.t > 10 * 60 * 1000) return page('로그인 요청이 만료됐어요. 사이트에서 다시 시도해 주세요.');
        const code = url.searchParams.get('code');
        if (!code) return page('네이버웍스 로그인이 취소됐어요.');
        const t = await token(env, { grant_type: 'authorization_code', code });
        const blob = await seal(env, { rt: t.refresh_token });
        return Response.redirect(st.r.split('#')[0] + '#nwmail=' + blob, 302);
      }
      if (url.pathname === '/mail') {
        const blob = req.headers.get('X-NW-Token');
        const s = await open(env, blob).catch(() => null);
        if (!s || !s.rt) return json(env, { error: 'login' }, 401);
        let t;
        try { t = await token(env, { grant_type: 'refresh_token', refresh_token: s.rt }); } catch { return json(env, { error: 'login' }, 401); }
        const out = await mails(env, t.access_token);
        if (t.refresh_token && t.refresh_token !== s.rt) out.token = await seal(env, { rt: t.refresh_token });
        return json(env, out);
      }
      return new Response('SPACEBASE mail relay', { status: 200 });
    } catch (e) {
      return url.pathname === '/mail' ? json(env, { error: String(e.message || e) }, 502) : page(String(e.message || e));
    }
  },
};
