// Band 새 글 알림 보내기 (Web Push). 글쓴이 브라우저가 글을 올린 뒤 POST /push/notify {post} 를 부른다.
// 1) 구글 로그인 확인 (Firebase ID 토큰)  2) 회원인지, 그 사람이 방금 쓴 글인지 확인  3) 알림을 켠 다른 회원 기기에 보냄
// Secrets: FIREBASE_SERVICE_ACCOUNT (Firebase 읽기·쓰기), VAPID_PRIVATE / VAPID_PUBLIC (tools/vapid.mjs 가 만들어 band-worker.yml 이 넣음)
// 알림 내용은 기기마다 암호화해서 보낸다 (RFC 8291 aes128gcm). 구독 정보는 Firebase push/subs/<uid>/<id>.

const PROJECT = 'spacebase-schedule';
const DB = 'https://spacebase-schedule-default-rtdb.asia-southeast1.firebasedatabase.app';
const CAT = { photo: '현장 사진', as: 'A/S', project: '프로젝트', notice: '공지·자유글' };
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); const r = atob(s + '='.repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const jsonPart = (s) => JSON.parse(new TextDecoder().decode(unb64u(s)));

// ---------- 구글 로그인(Firebase ID 토큰) 확인 ----------
let certCache = null;
async function verifyIdToken(token) {
  const [h, p, sig] = String(token || '').split('.');
  if (!sig) throw new Error('token');
  const head = jsonPart(h), body = jsonPart(p), now = Date.now() / 1000;
  if (head.alg !== 'RS256' || body.aud !== PROJECT || body.iss !== 'https://securetoken.google.com/' + PROJECT || !(body.exp > now) || !(body.iat < now + 300) || !body.sub) throw new Error('token');
  if (!certCache || certCache.until < Date.now()) {
    const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    certCache = { keys: (await r.json()).keys || [], until: Date.now() + 3600e3 };
  }
  const jwk = certCache.keys.find((k) => k.kid === head.kid);
  if (!jwk) throw new Error('token');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(sig), enc.encode(h + '.' + p)))) throw new Error('token');
  return body.sub;
}

// ---------- Firebase 읽기·쓰기 (서비스 계정) ----------
let tokCache = null;
async function dbToken(env) {
  if (tokCache && tokCache.until > Date.now()) return tokCache.token;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const c = b64u(enc.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (x) => x.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(h + '.' + c)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + h + '.' + c + '.' + sig });
  const j = await r.json();
  if (!j.access_token) throw new Error('db auth');
  tokCache = { token: j.access_token, until: Date.now() + (j.expires_in - 120) * 1000 };
  return tokCache.token;
}
async function db(env, path, method = 'GET', body) {
  const test = /^http:\/\/127\.0\.0\.1:/.test(env.TEST_DB || '');
  const url = (test ? env.TEST_DB : DB) + '/' + path + '.json' + (test ? '?ns=' + PROJECT + '-default-rtdb' : '');
  const auth = test ? 'Bearer owner' : 'Bearer ' + (await dbToken(env));
  const r = await fetch(url, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error('db ' + r.status);
  return r.json();
}

// ---------- Web Push (VAPID + aes128gcm 암호화) ----------
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function encrypt(payload, p256dh, authSecret) {
  const ua = unb64u(p256dh), auth = unb64u(authSecret);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = (await hmac(prkKey, concat(enc.encode('WebPush: info\0'), ua, asPub, new Uint8Array([1])))).slice(0, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 레코드 크기 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function vapidAuth(env, endpoint) {
  const jwk = JSON.parse(env.VAPID_PRIVATE);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://bbaekdi.github.io/spacebase-schedule/' })));
  const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(h + '.' + c)));
  return `vapid t=${h}.${c}.${sig}, k=${env.VAPID_PUBLIC}`;
}
async function sendOne(env, sub, payload) {
  if (!/^https:\/\//.test(sub.endpoint || '')) return 410;
  const body = await encrypt(payload, sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: await vapidAuth(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' }, body });
  return r.status;
}

// ---------- POST /push/notify ----------
export async function push(req, env, url, reply) {
  if (url.pathname !== '/push/notify') return reply('not found', 404);
  if (req.method !== 'POST') return reply('POST only', 405);
  if (!env.FIREBASE_SERVICE_ACCOUNT || !env.VAPID_PRIVATE || !env.VAPID_PUBLIC) return reply('알림 설정이 아직 없습니다.', 503);
  let uid;
  // TEST_DB/TEST_UID 는 내 컴퓨터 시험(연습용 Firebase)에서만 씀. 실제 중계에는 넣지 않는다.
  const testing = /^http:\/\/127\.0\.0\.1:/.test(env.TEST_DB || '');
  try { uid = testing && env.TEST_UID ? env.TEST_UID : await verifyIdToken((req.headers.get('Authorization') || '').replace(/^Bearer /, '')); }
  catch { return reply('로그인이 필요합니다.', 401); }
  let postId;
  try { postId = String((await req.json()).post || ''); } catch { return reply('bad request', 400); }
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(postId)) return reply('bad request', 400);
  const [member, post, sent] = await Promise.all([db(env, 'ws/members/' + uid), db(env, 'board/posts/' + postId), db(env, 'push/sent/' + postId)]);
  if (!member) return reply('회원이 아닙니다.', 403);
  if (!post || post.uid !== uid || post.deleted) return reply('보낼 수 없는 글입니다.', 403);
  if (post.cat === 'attend') return reply(JSON.stringify({ sent: 0, attend: true }), 200, 'application/json'); // 출근 글은 알림 안 보냄
  if (Date.now() - post.at > 10 * 60e3) return reply('오래된 글입니다.', 409);
  if (sent) return reply(JSON.stringify({ sent: 0, already: true }), 200, 'application/json');
  await db(env, 'push/sent/' + postId, 'PUT', Date.now());
  const first = String(post.cat === 'project' ? post.siteName : post.text || '').split('\n')[0].slice(0, 80);
  const payload = JSON.stringify({
    title: `${post.name} · ${CAT[post.cat] || 'Band'}`,
    body: (post.siteName && post.cat !== 'project' ? `[${post.siteName}] ` : '') + first,
    url: 'band.html#post=' + postId,
    tag: postId,
  });
  const [subs, members] = await Promise.all([db(env, 'push/subs'), db(env, 'ws/members')]);
  const jobs = [];
  for (const [u, list] of Object.entries(subs || {})) {
    if (u === uid || !(members || {})[u]) continue; // 글쓴이 본인, 내보낸 사람 빼고
    for (const [id, s] of Object.entries(list || {})) jobs.push(sendOne(env, s, payload).then((st) => ({ u, id, st }), () => ({ u, id, st: 0 })));
  }
  const res = await Promise.all(jobs);
  // 더 이상 없는 기기(404/410)는 지움
  const gone = res.filter((x) => x.st === 404 || x.st === 410);
  await Promise.all(gone.map((x) => db(env, `push/subs/${x.u}/${x.id}`, 'DELETE').catch(() => {})));
  return reply(JSON.stringify({ sent: res.filter((x) => x.st >= 200 && x.st < 300).length, failed: res.length - gone.length - res.filter((x) => x.st >= 200 && x.st < 300).length, removed: gone.length }), 200, 'application/json');
}
