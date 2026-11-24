// SPACEBASE 주간 스케줄 서버
// - Express 로 정적 파일 제공 + 네이버 밴드 OAuth 로그인
// - WebSocket 으로 여러 사용자 실시간 동기화
// - 데이터는 data/db.json 에 저장 (하루 1회 data/backups 에 백업)

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { createCalendar } = require('./calendar.js');

// ---------- 설정 ----------
loadDotEnv();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BAND_CLIENT_ID = process.env.BAND_CLIENT_ID || '';
const BAND_CLIENT_SECRET = process.env.BAND_CLIENT_SECRET || '';
const BAND_KEY = process.env.BAND_KEY || ''; // 설정 시 이 밴드 멤버만 로그인 허용
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DEV_LOGIN = !BAND_CLIENT_ID || process.env.DEV_LOGIN === '1';
// 밴드 키가 없을 때 쓰는 이름 로그인의 회사 공용 비밀번호 (비워 두면 이름만으로 로그인)
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const ACCESS_TAG = ACCESS_CODE ? crypto.createHash('sha256').update('sb:' + ACCESS_CODE).digest('hex').slice(0, 12) : '';
// 밴드 개발자센터에 등록한 Redirect URI (앱에서는 이 주소로 가는 것을 가로채 서버로 넘김)
const BAND_REDIRECT_URI = process.env.BAND_REDIRECT_URI || `${BASE_URL}/auth/band/callback`;
const DISCOVERY_PORT = 41234;

if (BASE_URL.startsWith('https') && DEV_LOGIN && !ACCESS_CODE) {
  console.warn('[경고] 인터넷에 공개된 주소인데 로그인 비밀번호가 없습니다. ACCESS_CODE 또는 밴드 로그인을 설정하세요.');
}
if (SESSION_SECRET === 'dev-secret-change-me' && !DEV_LOGIN) {
  console.warn('[경고] SESSION_SECRET 을 반드시 설정하세요.');
}

// ---------- 저장소 ----------
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

let db;
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} else {
  db = require('./seed.js')();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
}
db.version = db.version || 1;

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
  const day = new Date().toISOString().slice(0, 10);
  const bk = path.join(BACKUP_DIR, `db-${day}.json`);
  if (!fs.existsSync(bk)) fs.copyFileSync(DB_FILE, bk);
}
process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
process.on('exit', () => { try { clearTimeout(saveTimer); saveNow(); } catch {} });

// ---------- 세션 (서명된 쿠키) ----------
function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (obj.exp && obj.exp < Date.now()) return null;
    return obj;
  } catch { return null; }
}
function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function getUser(req) {
  const u = verify(parseCookies(req.headers.cookie).sb_session);
  if (!u) return null;
  // 이름 로그인 세션은 밴드 로그인으로 바뀌었거나 회사 비밀번호가 바뀌면 다시 로그인해야 한다
  if (u.id.startsWith('dev:') && (!DEV_LOGIN || (u.ac || '') !== ACCESS_TAG)) return null;
  return u;
}
function setSession(res, user) {
  // 이름만 입력하는 방식은 다시 묻지 않도록 오래 유지 (10년), 밴드 로그인은 30일
  const days = user.id.startsWith('dev:') ? 3650 : 30;
  const exp = Date.now() + 1000 * 60 * 60 * 24 * days;
  const secure = BASE_URL.startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sb_session=${encodeURIComponent(sign({ ...user, exp }))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * days}${secure}`);
}

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
// 자동 업데이트: 회사 PC에 설치된 설치 파일을 직원 PC 앱이 받아 간다
const APP_VERSION = require('./package.json').version;
const UPDATE_INSTALLER = process.env.UPDATE_INSTALLER || '';
app.get('/api/update-info', (req, res) => res.json({ version: APP_VERSION, available: !!UPDATE_INSTALLER && fs.existsSync(UPDATE_INSTALLER) }));
app.get('/update/setup.exe', (req, res) => {
  if (!UPDATE_INSTALLER || !fs.existsSync(UPDATE_INSTALLER)) return res.status(404).end();
  res.sendFile(UPDATE_INSTALLER);
});
app.get('/api/auth-config', (req, res) => res.json({ band: !!BAND_CLIENT_ID, dev: DEV_LOGIN, needCode: DEV_LOGIN && !!ACCESS_CODE, redirectUri: BAND_REDIRECT_URI, app: 'spacebase-schedule' }));

// 네이버 밴드 OAuth 2.0
app.get('/auth/band', (req, res) => {
  if (!BAND_CLIENT_ID) return res.status(400).send('BAND_CLIENT_ID 가 설정되지 않았습니다.');
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `sb_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  const url = new URL('https://auth.band.us/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', BAND_CLIENT_ID);
  url.searchParams.set('redirect_uri', BAND_REDIRECT_URI);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/auth/band/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const cookieState = parseCookies(req.headers.cookie).sb_state;
    if (!code) throw new Error('인증 코드가 없습니다.');
    if (!state || state !== cookieState) throw new Error('로그인 요청이 만료되었습니다. 다시 시도해 주세요.');

    const basic = Buffer.from(`${BAND_CLIENT_ID}:${BAND_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch(`https://auth.band.us/oauth2/token?grant_type=authorization_code&code=${encodeURIComponent(code)}`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    const token = await tokenRes.json();
    if (!token.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(token));

    const prof = await (await fetch(`https://openapi.band.us/v2/profile?access_token=${encodeURIComponent(token.access_token)}`)).json();
    if (prof.result_code !== 1) throw new Error('프로필 조회 실패: ' + JSON.stringify(prof));
    const p = prof.result_data;

    if (BAND_KEY) {
      const bands = await (await fetch(`https://openapi.band.us/v2.1/bands?access_token=${encodeURIComponent(token.access_token)}`)).json();
      const list = (bands.result_data && bands.result_data.bands) || [];
      if (!list.some((b) => b.band_key === BAND_KEY)) {
        return res.status(403).send(page('접근 권한 없음', '회사 밴드 멤버만 사용할 수 있습니다.'));
      }
    }
    setSession(res, { id: 'band:' + p.user_key, name: p.name, img: p.profile_image_url || '' });
    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.status(500).send(page('로그인 실패', String(e.message || e)));
  }
});

// 테스트용 로그인 (밴드 앱 등록 전)
const failures = new Map(); // 비밀번호 틀린 횟수 (IP별, 5번 틀리면 10분 차단)
app.post('/auth/dev', express.urlencoded({ extended: false }), (req, res) => {
  if (!DEV_LOGIN) return res.status(403).end();
  const name = String(req.body.name || '').trim().slice(0, 20);
  if (!name) return res.redirect('/login');
  const ip = req.socket.remoteAddress || '';
  const f = failures.get(ip);
  if (f && f.n >= 5 && Date.now() - f.t < 10 * 60 * 1000) return res.redirect('/login?err=locked');
  if (ACCESS_CODE) {
    const a = Buffer.from(String(req.body.code || '')), b = Buffer.from(ACCESS_CODE);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const cur = f && Date.now() - f.t < 10 * 60 * 1000 ? f : { n: 0 };
      failures.set(ip, { n: cur.n + 1, t: Date.now() });
      return res.redirect('/login?err=code');
    }
  }
  failures.delete(ip);
  setSession(res, { id: 'dev:' + name, name, img: '', ac: ACCESS_TAG });
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sb_session=; Path=/; Max-Age=0');
  res.redirect('/login?out=1');
});

// 로그인 필요 구간
app.use((req, res, next) => {
  if (req.path.startsWith('/static/') || req.path === '/favicon.ico') return next();
  const u = getUser(req);
  if (!u) return req.path.startsWith('/api/') ? res.status(401).end() : res.redirect('/login');
  // 이름 방식은 열 때마다 기간을 연장해서 다시 묻지 않게 (브라우저 쿠키 최대 400일 제한 대비)
  if (u.id.startsWith('dev:') && req.path === '/') { const { exp, ...rest } = u; setSession(res, rest); }
  next();
});
app.get('/api/me', (req, res) => res.json(getUser(req)));
app.get('/api/export.json', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="schedule-backup.json"');
  res.json(db);
});
// ---------- 워크스페이스 (홈 · 주간 스케줄 · 캘린더를 한 사이트에서) ----------
const pub = (f) => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get('/', pub('portal.html'));
app.get(['/schedule', '/schedule.html'], pub('index.html'));
app.get('/calendar', pub('calendar.html'));

const calendar = createCalendar({ dataDir: DATA_DIR });
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
};
app.get('/api/calendar/events', wrap((req) => calendar.events(req.query.from, req.query.to)));
app.post('/api/calendar/refresh', wrap(async () => { await calendar.refresh(); return calendar.status(); }));
app.post('/api/calendar/items', express.json(), wrap((req) => calendar.addItem(req.body || {}, getUser(req))));
app.put('/api/calendar/items/:id', express.json(), wrap((req) => calendar.updateItem(req.params.id, req.body || {}, getUser(req))));
app.delete('/api/calendar/items/:id', wrap((req) => { calendar.deleteItem(req.params.id); return { ok: true }; }));

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

function page(title, msg) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:sans-serif;padding:40px"><h2>${title}</h2><p>${String(msg).replace(/</g, '&lt;')}</p><a href="/login">다시 로그인</a></body>`;
}

// ---------- 실시간 동기화 ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const user = getUser(req);
  if (!user || !req.url.startsWith('/ws')) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => { ws.user = user; wss.emit('connection', ws); });
});

function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c !== except && c.readyState === 1) c.send(s);
}
function presence() {
  const map = new Map();
  for (const c of wss.clients) map.set(c.user.id, { id: c.user.id, name: c.user.name, img: c.user.img });
  broadcast({ t: 'presence', users: [...map.values()] });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ t: 'init', db, me: ws.user }));
  presence();
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'sync') { ws.send(JSON.stringify({ t: 'init', db, me: ws.user })); return; }
    if (msg.t === 'cursor') {
      broadcast({ t: 'cursor', id: ws.user.id, name: ws.user.name, key: typeof msg.key === 'string' ? msg.key.slice(0, 100) : null }, ws);
      return;
    }
    if (msg.t !== 'op' || !msg.op) return;
    const ok = applyOp(db, msg.op);
    if (!ok) return;
    db.version++;
    db.updatedAt = new Date().toISOString();
    db.updatedBy = ws.user.name;
    scheduleSave();
    broadcast({ t: 'op', op: msg.op, by: ws.user.name, version: db.version }, ws);
    ws.send(JSON.stringify({ t: 'ack', id: msg.id, version: db.version }));
  });
  ws.on('close', () => {
    broadcast({ t: 'cursor', id: ws.user.id, key: null });
    presence();
  });
});

// 서버/클라이언트가 공유하는 변경 적용 로직
const { applyOp } = require('./public/ops.js');

// 같은 사무실(같은 네트워크)의 앱이 서버를 자동으로 찾을 수 있게 응답
function startDiscovery() {
  try {
    const dgram = require('dgram');
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('message', (m, rinfo) => {
      if (String(m) !== 'SPACEBASE_SCHEDULE?') return;
      const reply = Buffer.from(JSON.stringify({ app: 'spacebase-schedule', port: PORT, name: require('os').hostname() }));
      sock.send(reply, rinfo.port, rinfo.address);
    });
    sock.on('error', (e) => console.warn('자동 찾기 응답 기능을 켜지 못했습니다:', e.message));
    sock.bind(DISCOVERY_PORT);
  } catch (e) { console.warn(e.message); }
}

const ready = new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`주간 스케줄 서버 실행 중: ${BASE_URL}  (밴드 로그인: ${BAND_CLIENT_ID ? '켜짐' : '꺼짐, 테스트 로그인 사용'})`);
    startDiscovery();
    resolve({ port: PORT });
  });
});
module.exports = { ready, saveNow };

function loadDotEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
