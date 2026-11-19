// SPACEBASE 주간 스케줄 - 데스크톱 앱 (Electron)
// 한 가지 설치 파일로 두 가지 방식으로 동작한다.
//  - 서버 모드: 회사 PC. 앱 안에서 스케줄 서버를 실행하고, 창을 닫아도 트레이에서 계속 돈다.
//  - 접속 모드: 나머지 PC. 회사 PC 서버에 접속해서 스케줄을 보여준다.
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const dgram = require('dgram');

const APP_NAME = 'SPACEBASE 주간 스케줄';
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const ICON = path.join(__dirname, 'icon.png');

let win = null;
let tray = null;
let quitting = false;
let serverOrigin = null; // 접속 중인 서버 주소 (예: http://192.168.0.10:3000)
let redirectUri = null; // 밴드 Redirect URI (이 주소로 가는 이동을 가로챈다)

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  // 사무실 공유기 대역(192.168.x.x)을 먼저
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 950, title: APP_NAME, icon: ICON, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  // 네이버/밴드 로그인 화면이 일반 브라우저로 인식하도록 앱 표시를 뺀 User-Agent 사용
  const appTok = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/\\S+\\s?';
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/Electron\/\S+\s?/, '').replace(new RegExp(appTok), ''));
  win.on('page-title-updated', (e) => e.preventDefault());

  // 밴드 로그인 후 돌아오는 주소를 서버 주소로 바꿔서 연다
  const intercept = (e, url) => {
    if (!redirectUri || !serverOrigin || !url.startsWith(redirectUri)) return;
    e.preventDefault();
    const q = url.slice(url.indexOf('?'));
    win.loadURL(`${serverOrigin}/auth/band/callback${q.startsWith('?') ? q : ''}`);
  };
  win.webContents.on('will-redirect', intercept);
  win.webContents.on('will-navigate', intercept);

  // 서버/밴드/네이버 외의 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = 취소(가로채기)
    showSetup(`서버에 연결하지 못했습니다 (${desc}). 회사 PC가 켜져 있는지, 주소가 맞는지 확인해 주세요.`);
  });

  win.on('close', (e) => {
    const cfg = loadConfig();
    if (!quitting && cfg && cfg.mode === 'server') {
      e.preventDefault();
      win.hide();
      if (process.platform === 'win32' && !cfg.trayNoticeShown && tray) {
        tray.displayBalloon && tray.displayBalloon({ title: APP_NAME, content: '서버는 계속 실행 중입니다. 완전히 끄려면 트레이 아이콘에서 "종료"를 누르세요.' });
        saveConfig({ ...cfg, trayNoticeShown: true });
      }
    }
  });
  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: '파일',
      submenu: [
        { label: '새로고침', accelerator: 'F5', click: () => win && win.webContents.reload() },
        { label: '인쇄 (A4)', accelerator: 'CmdOrCtrl+P', click: () => openPrintPreview() },
        { label: '이번 주로', click: () => win && serverOrigin && win.loadURL(serverOrigin + '/') },
        { type: 'separator' },
        { label: '접속 설정…', click: () => showSetup() },
        { label: '로그아웃 / 이름 바꾸기', click: () => serverOrigin && win.loadURL(serverOrigin + '/logout') },
        { type: 'separator' },
        { label: '종료', click: () => { quitting = true; app.quit(); } },
      ],
    },
    {
      label: '보기',
      submenu: [
        { role: 'zoomIn', label: '확대' }, { role: 'zoomOut', label: '축소' }, { role: 'resetZoom', label: '원래 크기' },
        { type: 'separator' }, { role: 'togglefullscreen', label: '전체 화면' },
        { role: 'toggleDevTools', label: '개발자 도구', visible: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showSetup(error) {
  win.loadFile(path.join(__dirname, 'setup.html'), { query: error ? { error } : {} });
  win.show();
}

async function openServer(origin, rediscover) {
  serverOrigin = origin.replace(/\/$/, '');
  try {
    const r = await fetch(serverOrigin + '/api/auth-config', { signal: AbortSignal.timeout(4000) });
    const c = await r.json();
    if (c.app !== 'spacebase-schedule') throw new Error('스케줄 서버가 아닙니다.');
    redirectUri = c.redirectUri || null;
  } catch (e) {
    if (rediscover) {
      // 회사 PC 주소가 바뀌었을 수 있으니 다시 찾아본다
      showLoading('회사 서버를 다시 찾는 중…');
      const found = await discover();
      if (found.length) {
        const url = `http://${found[0].ip}:${found[0].port}`;
        saveConfig({ ...(loadConfig() || {}), mode: 'client', serverUrl: url });
        return openServer(url, false);
      }
    }
    return showSetup(`서버(${serverOrigin})에 연결하지 못했습니다. 회사 PC에서 프로그램이 켜져 있는지 확인해 주세요.`);
  }
  if ((loadConfig() || {}).mode !== 'server' && await checkUpdate(true)) return;
  win.loadURL(serverOrigin + '/');
}

let serverStarted = false;
async function startLocalServer(cfg) {
  if (serverStarted) return;
  const ip = lanIps()[0] || 'localhost';
  const port = Number(cfg.port || 3000);
  process.env.PORT = String(port);
  process.env.BASE_URL = `http://${ip}:${port}`;
  process.env.DATA_DIR = cfg.dataDir || path.join(app.getPath('documents'), 'SPACEBASE 스케줄 데이터');
  process.env.SESSION_SECRET = cfg.sessionSecret;
  process.env.BAND_CLIENT_ID = cfg.bandClientId || '';
  process.env.BAND_CLIENT_SECRET = cfg.bandClientSecret || '';
  process.env.BAND_KEY = cfg.bandKey || '';
  process.env.ACCESS_CODE = cfg.accessCode || '';
  // 설치 프로그램이 자기 자신을 여기에 복사해 둔다 (직원 PC 자동 업데이트용)
  process.env.UPDATE_INSTALLER = path.join(path.dirname(process.execPath), 'update', 'setup.exe');
  if (cfg.bandRedirectUri) process.env.BAND_REDIRECT_URI = cfg.bandRedirectUri;
  const srv = require(path.join(__dirname, '..', 'server.js'));
  await srv.ready;
  serverStarted = true;
  createTray();
  app.setLoginItemSettings({ openAtLogin: cfg.autoStart !== false, args: ['--hidden'], name: 'SPACEBASE-Schedule' });
}

function createTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip(`${APP_NAME} (서버 실행 중)`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: '종료 (다른 사람도 접속이 끊깁니다)', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.show(); win.focus(); });
}

async function boot() {
  const cfg = loadConfig();
  if (!cfg) {
    // 처음 실행: 같은 사무실의 회사 서버를 자동으로 찾아 바로 로그인 화면으로
    showLoading('회사 서버를 찾는 중…');
    const found = await discover();
    if (found.length) {
      const s = found[0];
      saveConfig({ mode: 'client', serverUrl: `http://${s.ip}:${s.port}`, sessionSecret: crypto.randomBytes(32).toString('hex') });
      return openServer(`http://${s.ip}:${s.port}`);
    }
    return showSetup('같은 네트워크에서 회사 서버를 찾지 못했습니다. 이 PC가 서버(회사 PC)라면 "이 PC를 서버로 사용"을 고르고, 아니라면 회사 PC가 켜져 있는지 확인해 주세요.');
  }
  if (cfg.mode === 'server') {
    try { await startLocalServer(cfg); } catch (e) {
      return showSetup(`서버를 시작하지 못했습니다: ${e.message}. 포트 ${cfg.port || 3000} 을(를) 다른 프로그램이 쓰고 있을 수 있습니다.`);
    }
    return openServer(`http://${lanIps()[0] || 'localhost'}:${cfg.port || 3000}`);
  }
  return openServer(cfg.serverUrl, true);
}

function showLoading(text) {
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#f3f2ee;font-family:'Malgun Gothic',sans-serif;color:#444"><div style="text-align:center"><div style="font-weight:800;font-size:18px;margin-bottom:8px;color:#222">SPACEBASE 주간 스케줄</div>${text}</div></body>`));
}

// ---------- 자동 업데이트 (직원 PC) ----------
// 회사 PC의 버전이 더 새로우면 설치 파일을 받아 조용히 설치하고 다시 켠다.
function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
let updating = false;
async function checkUpdate(atStartup) {
  if (updating || !serverOrigin || !app.isPackaged || process.platform !== 'win32') return false;
  try {
    const info = await (await fetch(serverOrigin + '/api/update-info', { signal: AbortSignal.timeout(4000) })).json();
    if (!info.available || !newer(info.version, app.getVersion())) return false;
    if (!atStartup) {
      const r = await dialog.showMessageBox(win, { type: 'info', buttons: ['지금 업데이트', '나중에'], defaultId: 0, cancelId: 1,
        title: APP_NAME, message: `새 버전(${info.version})이 있어요.`, detail: '지금 업데이트하면 프로그램이 잠깐 꺼졌다가 다시 켜져요.' });
      if (r.response !== 0) return false;
    }
    updating = true;
    showLoading(`새 버전(${info.version})으로 업데이트하는 중… 잠시 후 다시 켜져요.`);
    const buf = Buffer.from(await (await fetch(serverOrigin + '/update/setup.exe')).arrayBuffer());
    const file = path.join(app.getPath('temp'), `SPACEBASE-Schedule-Setup-${info.version}.exe`);
    fs.writeFileSync(file, buf);
    require('child_process').spawn(file, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    quitting = true;
    setTimeout(() => app.exit(0), 500);
    return true;
  } catch (e) {
    updating = false;
    console.warn('업데이트 확인 실패:', e.message);
    return false;
  }
}
setInterval(() => { const c = loadConfig(); if (c && c.mode !== 'server') checkUpdate(false); }, 30 * 60 * 1000);

// ---------- 자동 업데이트 (회사 PC) ----------
// GitHub 에 올라온 새 버전을 확인해서 조용히 설치한다. 그러면 직원 PC들도 회사 PC를 따라 업데이트된다.
const UPDATE_REPO = require(path.join(__dirname, '..', 'package.json')).updateRepo;
async function checkServerUpdate() {
  if (updating || !UPDATE_REPO || !app.isPackaged || process.platform !== 'win32') return;
  try {
    const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { 'User-Agent': 'spacebase-schedule', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return;
    const rel = await r.json();
    const ver = String(rel.tag_name || '').replace(/^v/, '');
    const asset = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    if (!asset || !newer(ver, app.getVersion())) return;
    updating = true;
    const buf = Buffer.from(await (await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'spacebase-schedule' } })).arrayBuffer());
    if (buf.length < 10 * 1024 * 1024 || asset.size && buf.length !== asset.size) throw new Error('다운로드가 완전하지 않습니다.');
    const file = path.join(app.getPath('temp'), `SPACEBASE-Schedule-Setup-${ver}.exe`);
    fs.writeFileSync(file, buf);
    if (tray && tray.displayBalloon) tray.displayBalloon({ title: APP_NAME, content: `새 버전(${ver})으로 업데이트합니다. 잠시 후 다시 켜져요.` });
    try { require(path.join(__dirname, '..', 'server.js')).saveNow(); } catch {}
    require('child_process').spawn(file, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    quitting = true;
    setTimeout(() => app.exit(0), 1500);
  } catch (e) {
    updating = false;
    console.warn('회사 PC 업데이트 확인 실패:', e.message);
  }
}
setTimeout(() => { const c = loadConfig(); if (c && c.mode === 'server') checkServerUpdate(); }, 60 * 1000);
setInterval(() => { const c = loadConfig(); if (c && c.mode === 'server') checkServerUpdate(); }, 60 * 60 * 1000);

// ---------- 설정 화면과 통신 ----------
ipcMain.handle('config:get', () => {
  const cfg = loadConfig() || {};
  return { ...cfg, lanIps: lanIps(), version: app.getVersion(), defaultDataDir: path.join(app.getPath('documents'), 'SPACEBASE 스케줄 데이터') };
});
ipcMain.handle('config:save', async (e, input) => {
  const prev = loadConfig() || {};
  const cfg = {
    ...prev,
    mode: input.mode === 'server' ? 'server' : 'client',
    serverUrl: normalizeUrl(input.serverUrl || ''),
    port: Number(input.port) || 3000,
    bandClientId: (input.bandClientId || '').trim(),
    bandClientSecret: (input.bandClientSecret || '').trim(),
    bandKey: (input.bandKey || '').trim(),
    accessCode: String(input.accessCode || ''),
    bandRedirectUri: (input.bandRedirectUri || '').trim(),
    autoStart: input.autoStart !== false,
    sessionSecret: prev.sessionSecret || crypto.randomBytes(32).toString('hex'),
  };
  saveConfig(cfg);
  // 서버 설정이 바뀌었거나 모드가 바뀌면 다시 시작
  if (serverStarted || prev.mode !== cfg.mode && prev.mode === 'server') { app.relaunch(); quitting = true; app.exit(0); return; }
  boot();
});
ipcMain.handle('discover', () => discover());

// ---------- 인쇄 미리보기 ----------
// Windows 인쇄 창은 이 앱의 미리보기를 못 보여 주므로, A4 PDF 를 만들어 직접 미리보기 창에 띄운다.
let previewWin = null;
let previewPdf = null;
const PRINT_OPTS = { landscape: true, pageSize: 'A4', printBackground: true };
async function withFit(fn) {
  const wc = win.webContents;
  await wc.executeJavaScript('window.__fitPrint && window.__fitPrint(); true');
  try { return await fn(wc); } finally { wc.executeJavaScript('window.__unfitPrint && window.__unfitPrint(); true').catch(() => {}); }
}
async function openPrintPreview() {
  if (!win || !serverOrigin || !win.webContents.getURL().startsWith(serverOrigin)) return;
  const data = await withFit((wc) => wc.printToPDF({ ...PRINT_OPTS, preferCSSPageSize: true }));
  previewPdf = path.join(app.getPath('temp'), `spacebase-schedule-${Date.now()}.pdf`);
  fs.writeFileSync(previewPdf, data);
  if (!previewWin || previewWin.isDestroyed()) {
    previewWin = new BrowserWindow({
      width: 1200, height: 900, parent: win, title: '인쇄 미리보기', icon: ICON, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, plugins: true },
    });
    previewWin.setMenu(null);
    previewWin.on('closed', () => { previewWin = null; });
  }
  previewWin.loadFile(path.join(__dirname, 'preview.html'), { query: { pdf: require('url').pathToFileURL(previewPdf).href } });
  previewWin.show();
}
ipcMain.handle('print:preview', () => openPrintPreview());
ipcMain.handle('print:do', () => withFit((wc) => new Promise((resolve) => {
  wc.print({ ...PRINT_OPTS, silent: false }, (ok, reason) => resolve({ ok, reason }));
})));
ipcMain.handle('print:save', async () => {
  if (!previewPdf) return;
  const d = new Date();
  const r = await dialog.showSaveDialog(previewWin || win, {
    title: 'PDF로 저장',
    defaultPath: path.join(app.getPath('documents'), `SPACEBASE 주간스케줄 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!r.canceled && r.filePath) { fs.copyFileSync(previewPdf, r.filePath); shell.showItemInFolder(r.filePath); }
});
ipcMain.handle('print:close', () => { if (previewWin) previewWin.close(); });

function normalizeUrl(u) {
  u = u.trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'http://' + u;
  if (!/:\d+/.test(u.replace(/^https?:\/\//, ''))) u = u.replace(/\/$/, '') + ':3000';
  return u.replace(/\/$/, '');
}

function discover() {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    sock.on('message', (m, rinfo) => {
      try {
        const d = JSON.parse(String(m));
        if (d.app === 'spacebase-schedule') found.set(rinfo.address, { ip: rinfo.address, port: d.port, name: d.name });
      } catch {}
    });
    sock.on('error', () => resolve([...found.values()]));
    sock.bind(() => {
      sock.setBroadcast(true);
      const msg = Buffer.from('SPACEBASE_SCHEDULE?');
      const targets = new Set(['255.255.255.255']);
      for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) {
          if (a.family !== 'IPv4' || a.internal) continue;
          const ip = a.address.split('.').map(Number), mask = a.netmask.split('.').map(Number);
          targets.add(ip.map((x, i) => (x & mask[i]) | (~mask[i] & 255)).join('.'));
        }
      }
      for (const t of targets) sock.send(msg, 41234, t, () => {});
      setTimeout(() => { try { sock.close(); } catch {} resolve([...found.values()]); }, 1500);
    });
  });
}

app.whenReady().then(() => {
  createWindow();
  boot();
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  const cfg = loadConfig();
  if (!(cfg && cfg.mode === 'server' && !quitting)) app.quit();
});
