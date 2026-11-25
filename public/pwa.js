// 휴대폰에 앱처럼 설치 + 새 글 알림 켜고 끄기 (웹사이트 전용, 데스크톱 앱에서는 동작 안 함)
// - 안드로이드·PC 크롬: "설치하기" 버튼 → 바로 설치
// - 아이폰: 공유 버튼 → "홈 화면에 추가" 안내 (아이폰은 홈 화면에 추가한 앱에서만 알림이 옴)
(function () {
  const ok = 'serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname));
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobile = ios || /Android/i.test(ua);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  if (!ok) { window.SBPush = { supported: () => false, ios, standalone }; return; }
  const ready = navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).catch(() => null);

  // ---------- 앱 설치 ----------
  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; showBar(); });
  addEventListener('appinstalled', () => { deferred = null; const b = document.getElementById('sbInstall'); if (b) b.remove(); });
  function iosGuide() {
    let d = document.getElementById('sbIosGuide');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'sbIosGuide'; d.className = 'sb-guide';
      const share = '<svg class="sb-shareic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6v10h12V10h-1"/></svg>';
      d.innerHTML = `<h3>아이폰에 SPACEBASE 앱 설치</h3>
        <ol>
          <li><b>공유 버튼</b> <span class="sb-share">${share}</span> 을 눌러요. (네모 위로 화살표 모양)
            <ul class="sb-where">
              <li>화면 <b>맨 아래 버튼 줄의 가운데</b> 버튼이에요. 버튼 줄이 안 보이면 화면을 손가락으로 살짝 아래로 끌어 주세요.</li>
              <li>아래에 <b>주소창만</b> 있으면: 주소창 오른쪽 <b class="sb-dots">⋯</b> → <b>공유</b> ${share}</li>
              <li>주소창이 <b>화면 위</b>에 있으면: 주소창 오른쪽 끝에 있어요.</li>
            </ul></li>
          <li>목록을 아래로 내려 <b>"홈 화면에 추가"</b>를 눌러요. <small>(안 보이면 맨 아래 "작업 편집"에서 추가)</small></li>
          <li>오른쪽 위 <b>"추가"</b>를 누르면 홈 화면에 SPACEBASE 아이콘이 생겨요.</li>
        </ol>
        <p class="sb-warn">⚠️ <b>카카오톡·네이버 앱 안</b>에서 열었다면 공유 버튼이 없어요. 오른쪽 아래(또는 위) 메뉴에서 <b>"Safari로 열기"</b>를 먼저 눌러 주세요.</p>
        <p>설치한 아이콘으로 열면 새 글 알림도 받을 수 있어요. (iOS 16.4 이상)</p>
        <button class="btn primary" type="button">알겠어요</button>`;
      d.querySelector('button').onclick = () => d.close();
      document.body.append(d);
    }
    d.showModal();
  }
  function install() {
    if (deferred) { deferred.prompt(); deferred.userChoice.finally(() => { deferred = null; }); return; }
    if (ios) return iosGuide();
    alert('브라우저 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 눌러 주세요.');
  }
  function showBar() {
    if (standalone() || !mobile || document.getElementById('sbInstall')) return;
    if (Date.now() - (+lsGet('sb_install_later') || 0) < 7 * 864e5) return;
    const bar = document.createElement('div');
    bar.id = 'sbInstall'; bar.className = 'extbar sb-installbar';
    bar.innerHTML = `<img src="icons/icon-192.png" alt="" width="36" height="36"><span><b>SPACEBASE 앱 설치</b><br>홈 화면에서 열고 알림 받기</span>
      <button class="btn primary" type="button" data-i>설치하기</button><button class="btn" type="button" data-l>나중에</button>`;
    bar.querySelector('[data-i]').onclick = () => { install(); };
    bar.querySelector('[data-l]').onclick = () => { lsSet('sb_install_later', String(Date.now())); bar.remove(); };
    document.body.append(bar);
  }
  if (ios && !standalone()) setTimeout(showBar, 1500);

  // ---------- 새 글 알림 ----------
  const b64 = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); const r = atob(s + '='.repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  const sameKey = (sub, key) => { try { const a = new Uint8Array(sub.options.applicationServerKey), b = b64(key); return a.length === b.length && a.every((x, i) => x === b[i]); } catch { return false; } };
  async function subId(endpoint) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }
  const supported = () => 'PushManager' in window && 'Notification' in window;
  async function status() {
    if (!supported() || Notification.permission !== 'granted') return 'off';
    const r = await ready; const sub = r && (await r.pushManager.getSubscription());
    return sub && sameKey(sub, window.SB_VAPID_PUBLIC || '') ? 'on' : 'off';
  }
  async function enable(db, uid) {
    if (ios && !standalone()) { const e = new Error('아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요.'); e.code = 'ios-install'; throw e; }
    if (!supported()) throw new Error('이 브라우저는 알림을 지원하지 않아요.');
    const key = window.SB_VAPID_PUBLIC; if (!key) throw new Error('알림 설정이 아직 준비되지 않았어요. (관리자 확인 필요)');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { const e = new Error('알림이 꺼져 있어요. 휴대폰 설정에서 이 앱(또는 브라우저)의 알림을 허용해 주세요.'); e.code = 'denied'; throw e; }
    const r = await ready; if (!r) throw new Error('알림 준비에 실패했어요.');
    let sub = await r.pushManager.getSubscription();
    if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    const j = sub.toJSON(), id = await subId(j.endpoint);
    await db.ref('push/subs/' + uid + '/' + id).set({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, at: Date.now(), dev: (ios ? 'iPhone' : /Android/i.test(ua) ? 'Android' : 'PC') + (standalone() ? ' 앱' : '') });
    lsSet('sb_push_id', id);
  }
  async function disable(db, uid) {
    const r = await ready; const sub = r && (await r.pushManager.getSubscription());
    if (sub) { const id = await subId(sub.endpoint); await sub.unsubscribe().catch(() => {}); await db.ref('push/subs/' + uid + '/' + id).remove().catch(() => {}); }
    lsSet('sb_push_id', null);
  }
  window.SBPush = { supported, ios, standalone, status, enable, disable, install, iosGuide };
})();
