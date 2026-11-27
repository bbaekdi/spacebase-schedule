// 사진 보관(worker/drive.js) 시험: 연습용 Firebase + 가짜 구글 드라이브.
// 실행: (에뮬레이터 켠 뒤) node tools/test/drive.test.mjs
// 확인: 회원만 올리고 보고, 사진이 아닌 것·너무 큰 것은 막고, 폴더(Band 사진/현장/날짜)를 만들어 다시 쓰고,
//       글쓴이·관리자만 휴지통으로 보내고, 연결(허락)은 관리자만, 열쇠는 Firebase 에만 저장되고 밖으로 안 나오는지.
import { drive } from '../../worker/drive.js';
const DB = 'http://127.0.0.1:9000', NS = '?ns=spacebase-schedule-default-rtdb';
const put = (p, v) => fetch(DB + '/' + p + '.json' + NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(v) });
const get = async (p) => (await fetch(DB + '/' + p + '.json' + NS, { headers: { Authorization: 'Bearer owner' } })).json();
let fails = 0; const log = (ok, m) => { if (!ok) fails++; console.log((ok ? '✓ ' : '✗ ') + m); };

// ---- 가짜 구글 드라이브 ----
const files = new Map(); let seq = 0; const requests = [];
const realFetch = globalThis.fetch;
const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, opt = {}) => {
  const s = String(url), u = new URL(s), h = opt.headers || {};
  if (u.origin === 'https://oauth2.googleapis.com') {
    const b = new URLSearchParams(String(opt.body));
    requests.push('token:' + b.get('grant_type'));
    if (b.get('grant_type') === 'authorization_code') return b.get('code') === 'good' ? json({ access_token: 'AT-1', refresh_token: 'RT-OK', expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400);
    return b.get('refresh_token') === 'RT-OK' ? json({ access_token: 'AT-1', expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400);
  }
  if (u.origin !== 'https://www.googleapis.com') return realFetch(url, opt);
  const auth = h.Authorization || h.authorization || '';
  if (auth !== 'Bearer AT-1') return json({ error: 'unauth' }, 401);
  const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (u.pathname === '/drive/v3/files' && (opt.method || 'GET') === 'GET') {
    const q = u.searchParams.get('q'), name = q.match(/name='((?:[^'\\]|\\.)*)'/)[1].replace(/\\(.)/g, '$1'), parent = q.match(/'([^']+)' in parents/)[1];
    return json({ files: [...files.entries()].filter(([, f]) => f.folder && f.name === name && f.parents[0] === parent && !f.trashed).map(([id]) => ({ id })) });
  }
  if (u.pathname === '/drive/v3/files' && opt.method === 'POST') {
    const b = JSON.parse(opt.body), id = 'F' + String(++seq).padStart(11, '0');
    files.set(id, { folder: true, name: b.name, parents: b.parents || [], trashed: false });
    return json({ id });
  }
  if (u.pathname === '/upload/drive/v3/files' && opt.method === 'POST') {
    const body = Buffer.from(opt.body).toString('latin1'), bd = /boundary=(.+)$/.exec(h['Content-Type'])[1];
    const parts = body.split('--' + bd).filter((x) => x.trim() && x.trim() !== '--');
    const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim());
    const data = Buffer.from(parts[1].slice(parts[1].indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''), 'latin1');
    const id = 'P' + String(++seq).padStart(11, '0');
    files.set(id, { folder: false, name: meta.name, parents: meta.parents, bytes: data, trashed: false });
    return json({ id, size: String(data.length) });
  }
  if (m && !files.has(m[1])) return json({ error: 'nf' }, 404);
  if (m && u.searchParams.get('alt') === 'media') return new Response(files.get(m[1]).bytes, { status: 200 });
  if (m && (opt.method || 'GET') === 'GET') return json({ id: m[1], trashed: files.get(m[1]).trashed });
  if (m && opt.method === 'PATCH') { Object.assign(files.get(m[1]), JSON.parse(opt.body)); return json({ id: m[1] }); }
  return json({ error: 'unknown ' + u.pathname }, 400);
};

const base = { TEST_DB: DB, FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ private_key: 'test-only' }), GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' };
const reply = (b, st = 200, type = 'text/plain') => new Response(b, { status: st, headers: { 'Content-Type': type } });
const call = (path, uid, init = {}) => { const url = new URL('https://relay.test' + path); return drive(new Request(url, init), { ...base, TEST_UID: uid }, url, reply); };
const jpeg = (n, fill = 7) => { const b = Buffer.alloc(n, fill); b[0] = 0xff; b[1] = 0xd8; return b; };

await put('', null);
await put('ws/members', { uidA: { name: '관리', email: 'a' }, uidB: { name: '김테스트', email: 'b' }, uidC: { name: '이시험', email: 'c' } });
await put('ws/admins', { uidA: true });

// ---- 연결 전 ----
let r = await call('/drive/status', 'uidB');
log((await r.json()).ready === false, '연결 전: ready=false');
r = await call('/drive/upload?site=x', 'uidB', { method: 'POST', body: jpeg(500) });
log(r.status === 503, '연결 전 사진 올리기는 "아직 연결 안 됨" (503)');

// ---- 연결(허락): 관리자만 ----
r = await call('/drive/connect', 'uidB', { method: 'POST' });
log(r.status === 403, '일반 회원은 연결 못 함 (403)');
r = await call('/drive/connect', 'uidX', { method: 'POST' });
log(r.status === 403, '회원이 아닌 사람도 못 함');
r = await call('/drive/connect', 'uidA', { method: 'POST' });
const cj = await r.json(), cu = new URL(cj.url);
log(r.status === 200 && cu.hostname === 'accounts.google.com' && cu.searchParams.get('scope') === 'https://www.googleapis.com/auth/drive.file' && cu.searchParams.get('access_type') === 'offline' && cu.searchParams.get('redirect_uri') === 'https://relay.test/drive/callback', '관리자: 구글 허락 주소 (drive.file 범위만, 열쇠 받기 모드)');
const state = cu.searchParams.get('state');
r = await call('/drive/callback?code=good&state=' + encodeURIComponent(state.slice(0, -2) + 'zz'), 'anon');
log(r.status === 400 && (await get('driveAuth')) === null, '가짜 state 는 거절 (아무것도 저장 안 함)');
r = await call('/drive/callback?code=good&state=' + encodeURIComponent(state.replace(/\.(\d+)\./, (_, n) => '.' + (Number(n) - 99999999) + '.')), 'anon');
log(r.status === 400, '시간이 지난 state 는 거절');
r = await call('/drive/callback?code=bad&state=' + encodeURIComponent(state), 'anon');
log(r.status === 502 && (await get('driveAuth')) === null, '구글이 열쇠를 안 주면 연결 안 됨');
r = await call('/drive/callback?code=good&state=' + encodeURIComponent(state), 'anon');
const da = await get('driveAuth');
log(r.status === 200 && /연결됐어요/.test(await r.text()) && da.rt === 'RT-OK' && /^F/.test(da.root), '허락 완료: 열쇠와 "Band 사진" 폴더를 Firebase driveAuth 에 저장');
const rootF = files.get(da.root);
log(rootF && rootF.name === 'Band 사진' && rootF.folder, '드라이브에 "Band 사진" 폴더가 만들어짐');
r = await call('/drive/status', 'uidB'); const st = await r.json();
log(st.ready === true && !JSON.stringify(st).includes('RT-OK'), '연결 뒤: ready=true (열쇠는 밖으로 안 나옴)');

// ---- 올리기 ----
r = await call('/drive/upload?site=x', 'uidX', { method: 'POST', body: jpeg(500) });
log(r.status === 403, '회원이 아니면 못 올림');
r = await call('/drive/upload?site=x', 'uidB', { method: 'POST', body: Buffer.alloc(500, 1) });
log(r.status === 400, 'JPEG 가 아닌 파일은 거절');
r = await call('/drive/upload?site=x', 'uidB', { method: 'POST', body: jpeg(3 * 1024 * 1024 + 1) });
log(r.status === 413, '3MB 넘는 사진은 거절');
const img1 = jpeg(40000, 9);
r = await call('/drive/upload?site=' + encodeURIComponent('테스트/현장:1') + '&day=2027-01-05', 'uidB', { method: 'POST', body: img1 });
const up1 = await r.json();
const f1 = files.get(up1.id), dayF = f1 && files.get(f1.parents[0]), siteF = dayF && files.get(dayF.parents[0]);
log(r.status === 200 && up1.size === 40000 && Buffer.compare(f1.bytes, img1) === 0, '사진 한 장 올리기 → 드라이브에 같은 내용으로 저장');
log(dayF && dayF.name === '2027-01-05' && siteF && siteF.name === '테스트 현장 1' && siteF.parents[0] === da.root, '폴더: Band 사진 / 현장이름(위험한 글자는 공백으로) / 날짜');
const nFolders = [...files.values()].filter((f) => f.folder).length;
r = await call('/drive/upload?site=' + encodeURIComponent('테스트/현장:1') + '&day=2027-01-05', 'uidC', { method: 'POST', body: jpeg(2000, 3) });
const up2 = await r.json();
log(r.status === 200 && [...files.values()].filter((f) => f.folder).length === nFolders && files.get(up2.id).parents[0] === f1.parents[0], '같은 현장·날짜는 폴더를 다시 만들지 않고 그 폴더에 저장');
r = await call('/drive/upload?site=&day=bad', 'uidB', { method: 'POST', body: jpeg(2000, 4) });
const up3 = await r.json(), f3 = files.get(up3.id), d3 = files.get(f3.parents[0]), s3 = files.get(d3.parents[0]);
log(r.status === 200 && s3.name === '기타' && /^\d{4}-\d{2}-\d{2}$/.test(d3.name), '현장·날짜가 없거나 이상하면 "기타 / 오늘 날짜"');
const upQuote = await (await call("/drive/upload?site=" + encodeURIComponent("김's \\ 현장") + '&day=2027-01-05', 'uidB', { method: 'POST', body: jpeg(2000, 5) })).json();
log(!!upQuote.id, "현장 이름에 ' 가 있어도 폴더를 찾고 만듦");

// ---- 보기 ----
r = await call('/drive/photo/' + up1.id, 'uidC');
const got = Buffer.from(await r.arrayBuffer());
log(r.status === 200 && r.headers.get('Content-Type') === 'image/jpeg' && /private/.test(r.headers.get('Cache-Control')) && Buffer.compare(got, img1) === 0, '회원은 사진을 봄 (남이 볼 수 없게 private 보관)');
r = await call('/drive/photo/' + up1.id, 'uidX');
log(r.status === 403, '회원이 아니면 사진을 못 봄');
r = await call('/drive/photo/' + 'Q'.repeat(20), 'uidB');
log(r.status === 404, '없는 사진은 404');
r = await call('/drive/photo/..%2Fx', 'uidB');
log(r.status === 404, '이상한 주소는 막음');

// ---- 휴지통 ----
const now = Date.now();
await put('board/posts', {
  p1: { cat: 'photo', text: '사진', uid: 'uidB', name: '김테스트', at: now, photos: [{ id: up1.id, w: 100, h: 100 }, { id: up2.id, w: 100, h: 100 }] },
  p2: { cat: 'photo', text: '남의 글', uid: 'uidC', name: '이시험', at: now, photos: [{ id: up3.id }] },
});
r = await call('/drive/trash', 'uidC', { method: 'POST', body: JSON.stringify({ post: 'p1' }) });
log(r.status === 403 && !files.get(up1.id).trashed, '남의 글 사진은 못 지움 (일반 회원)');
r = await call('/drive/trash', 'uidB', { method: 'POST', body: JSON.stringify({ post: 'p1' }) });
log((await r.json()).trashed === 2 && files.get(up1.id).trashed && files.get(up2.id).trashed, '글쓴이: 그 글의 사진 2장을 드라이브 휴지통으로');
log(!files.get(up3.id).trashed && !files.get(upQuote.id).trashed, '다른 글 사진은 그대로');
r = await call('/drive/trash', 'uidA', { method: 'POST', body: JSON.stringify({ post: 'p2' }) });
log((await r.json()).trashed === 1 && files.get(up3.id).trashed, '관리자는 남의 글 사진도 정리');
r = await call('/drive/trash', 'uidA', { method: 'POST', body: JSON.stringify({ post: 'nope' }) });
log((await r.json()).trashed === 0, '없는 글은 아무것도 안 함');
r = await call('/drive/trash', 'uidA', { method: 'POST', body: JSON.stringify({ post: '../x' }) });
log(r.status === 400, '이상한 글 번호는 거절');

console.log(fails ? `\n실패 ${fails}개` : '\n모두 통과');
process.exit(fails ? 1 : 0);
