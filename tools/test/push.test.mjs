// 알림 보내기(worker/push.js) 시험: 연습용 Firebase + 가짜 휴대폰 알림 서버.
// 실행: (에뮬레이터 켠 뒤) node tools/test/push.test.mjs
// 확인: 암호화한 알림을 "휴대폰 열쇠"로 풀 수 있는지, 서명이 맞는지, 글쓴이·남의 글·오래된 글·두 번 보내기를 막는지.
import { webcrypto as C, createHmac, createDecipheriv } from 'crypto';
import { execFileSync } from 'child_process';
import { push } from '../../worker/push.js';
const DB = 'http://127.0.0.1:9000', NS = '?ns=spacebase-schedule-default-rtdb';
const put = (p, v) => fetch(DB + '/' + p + '.json' + NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(v) });
const get = async (p) => (await fetch(DB + '/' + p + '.json' + NS, { headers: { Authorization: 'Bearer owner' } })).json();
const u = (b) => Buffer.from(b).toString('base64url');
let fails = 0; const log = (ok, m) => { if (!ok) fails++; console.log((ok ? '✓ ' : '✗ ') + m); };

// 가짜 휴대폰 (알림 받는 쪽 열쇠)
const ua = await C.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await C.subtle.exportKey('raw', ua.publicKey));
const authSecret = C.getRandomValues(new Uint8Array(16));
// 알림 열쇠 (시험용 가짜 Firebase 열쇠에서)
const fakeSA = JSON.stringify({ private_key: 'test-only-not-real' });
const vEnv = { ...process.env, FIREBASE_SERVICE_ACCOUNT: fakeSA };
const VAPID_PUBLIC = execFileSync('node', ['tools/vapid.mjs', 'public'], { env: vEnv }).toString();
const VAPID_PRIVATE = execFileSync('node', ['tools/vapid.mjs', 'private'], { env: vEnv }).toString();
const env = { TEST_DB: DB, TEST_UID: 'uidA', FIREBASE_SERVICE_ACCOUNT: fakeSA, VAPID_PUBLIC, VAPID_PRIVATE };

// 가짜 휴대폰 알림 서버
const got = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  const s = String(url);
  if (s.startsWith('https://push.test/ok')) { got.push({ url: s, opt }); return new Response('', { status: 201 }); }
  if (s.startsWith('https://push.test/gone')) return new Response('', { status: 410 });
  return realFetch(url, opt);
};
const call = (post) => push(new Request('https://x/push/notify', { method: 'POST', body: JSON.stringify({ post }) }), env, new URL('https://x/push/notify'), (b, st = 200) => new Response(b, { status: st }));

await put('', null);
await put('ws/members', { uidA: { name: '김테스트', email: 'a' }, uidB: { name: '이시험', email: 'b' } });
const now = Date.now();
await put('board/posts', {
  p1: { cat: 'as', siteName: '테스트현장', text: '1.발주처명 : 테스트현장\n요청내용 :\n문 손잡이', uid: 'uidA', name: '김테스트', at: now },
  p2: { cat: 'notice', text: '남의 글', uid: 'uidB', name: '이시험', at: now },
  p3: { cat: 'notice', text: '오래된 글', uid: 'uidA', name: '김테스트', at: now - 3600e3 },
});
const sub = (ep) => ({ endpoint: ep, p256dh: u(uaPub), auth: u(authSecret), at: 1 });
await put('push/subs', { uidB: { d1: sub('https://push.test/ok/1'), d2: sub('https://push.test/gone/2') }, uidA: { me: sub('https://push.test/ok/self') }, uidX: { left: sub('https://push.test/ok/left') } });

let r = await call('p1'); let j = await r.json();
log(r.status === 200 && j.sent === 1 && j.removed === 1, `새 글 알림: 1대 보냄, 없어진 기기 1대 정리 (${JSON.stringify(j)})`);
log(got.length === 1 && got[0].url === 'https://push.test/ok/1', '글쓴이 본인·내보낸 사람에게는 안 보냄');
log((await get('push/subs/uidB/d2')) === null, '없어진 기기(410)는 구독 목록에서 지움');
// 받은 알림 풀어 보기 (RFC 8291)
const body = new Uint8Array(await new Response(got[0].opt.body).arrayBuffer());
const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
const asKey = await C.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const ecdh = Buffer.from(await C.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
const H = (k, d) => createHmac('sha256', k).update(d).digest();
const ikm = H(H(authSecret, ecdh), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])])).subarray(0, 32);
const prk = H(salt, ikm);
const cek = H(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
const nonce = H(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
const dc = createDecipheriv('aes-128-gcm', cek, nonce); dc.setAuthTag(Buffer.from(ct.slice(-16)));
const plain = Buffer.concat([dc.update(Buffer.from(ct.slice(0, -16))), dc.final()]);
const msg = JSON.parse(plain.subarray(0, plain.length - 1).toString());
log(plain[plain.length - 1] === 2 && msg.title === '김테스트 · A/S' && msg.body === '[테스트현장] 1.발주처명 : 테스트현장' && msg.url === 'band.html#post=p1', '휴대폰에서 알림 내용을 풀 수 있음 (제목·내용·누르면 열 글)');
log(got[0].opt.headers['Content-Encoding'] === 'aes128gcm' && got[0].opt.headers.TTL === '86400', '알림 형식 머리말');
// VAPID 서명 확인
const m = got[0].opt.headers.Authorization.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
const pub = await C.subtle.importKey('raw', Buffer.from(m[4], 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const okSig = await C.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(m[3], 'base64url'), Buffer.from(m[1] + '.' + m[2]));
log(okSig && JSON.parse(Buffer.from(m[2], 'base64url')).aud === 'https://push.test', '알림 서버용 서명(VAPID)이 맞음');
r = await call('p1'); j = await r.json();
log(j.already === true && got.length === 1, '같은 글은 두 번 안 보냄');
r = await call('p2'); log(r.status === 403, '남의 글로는 못 보냄');
r = await call('p3'); log(r.status === 409, '오래된 글(10분 지난 글)은 안 보냄');
r = await call('../x'); log(r.status === 400, '이상한 글 번호는 막음');
env.TEST_UID = 'uidZ'; r = await call('p1'); log(r.status === 403, '회원 아니면 못 보냄');
const env2 = { ...env, TEST_DB: 'https://evil.example' }; delete env2.TEST_UID;
r = await push(new Request('https://x/push/notify', { method: 'POST', body: '{"post":"p1"}' }), env2, new URL('https://x/push/notify'), (b, st = 200) => new Response(b, { status: st }));
log(r.status === 401, '실제 중계에서는 로그인 토큰 없으면 막음 (시험용 설정이 있어도)');
console.log(fails ? `실패 ${fails}개` : '모두 통과');
process.exit(fails ? 1 : 0);
