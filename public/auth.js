// 구글 로그인 + "관리자가 받아 준 사람만" (웹사이트 전용)
//
// - 구글로 로그인한 뒤, Firebase 의 회원 명단(ws/members)에 있어야 들어온다.
// - 들어오는 방법: ① 초대 링크(?invite=코드, 1명용, 7일) ② 가입 신청 → 관리자 승인
//   ③ 관리자 비밀번호 (처음 관리자). 규칙은 firebase/database.rules.json 이 지킨다.
// - 데스크톱 앱(file:)과 회사 PC 서버 방식에서는 쓰지 않는다 (예전처럼 회사 비밀번호).
// - 전체 직원이 초대받기 전까지는 꺼 둔다(SB_GOOGLE_AUTH=false). 시험하는 사람은 주소 뒤에 ?login=google
//   (끄기: ?login=password). 초대 링크로 들어오면 자동으로 켜진다.
(function () {
  const SB_GOOGLE_AUTH = false; // 전 직원 초대가 끝나면 true 로 바꾼다 (Doc/Doing/우리-밴드.md 9단계)

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  const q = new URLSearchParams(location.search);
  if (q.get('login') === 'google') lsSet('sb_auth', 'google');
  if (q.get('login') === 'password') lsSet('sb_auth', null);
  if (q.get('invite')) { lsSet('sb_invite', q.get('invite')); lsSet('sb_auth', 'google'); }
  if (q.has('login') || q.has('invite')) {
    q.delete('login'); q.delete('invite');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }

  const enabled = () =>
    location.protocol !== 'file:' && !window.sbDesktop &&
    !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && window.firebase && firebase.auth) &&
    (SB_GOOGLE_AUTH || lsGet('sb_auth') === 'google');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function sha256hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- 화면 ----------
  const css = `
  #sbAuth{position:fixed;inset:0;z-index:9999;background:#f6f5f2;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit}
  #sbAuth.hidden{display:none}
  #sbAuth .card{background:#fff;border-radius:16px;box-shadow:0 6px 30px rgba(0,0,0,.08);padding:28px 24px;width:100%;max-width:380px;text-align:center}
  #sbAuth img.logo{height:28px;margin-bottom:14px}
  #sbAuth h2{font-size:18px;margin:4px 0 8px}
  #sbAuth p{font-size:14px;color:#555;line-height:1.6;margin:6px 0}
  #sbAuth .err{color:#c62828;font-size:13px;min-height:18px;margin:8px 0}
  #sbAuth button,#sbAuth a.btn{display:block;width:100%;box-sizing:border-box;border:1px solid #ddd;background:#fff;border-radius:10px;padding:11px;font-size:15px;margin-top:10px;cursor:pointer;color:#1d1d1b;text-decoration:none}
  #sbAuth button.primary,#sbAuth a.primary{background:#f1bf52;border-color:#f1bf52;font-weight:600}
  #sbAuth button.link{border:0;background:none;color:#777;font-size:13px;text-decoration:underline;padding:6px}
  #sbAuth input{display:block;width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;padding:11px;font-size:15px;margin-top:10px}
  #sbAuth .g{display:inline-block;width:18px;height:18px;vertical-align:-4px;margin-right:8px}
  #sbAuth .who{font-size:13px;color:#777;margin-top:14px}`;
  const G_ICON = '<svg class="g" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
  function box() {
    let el = document.getElementById('sbAuth');
    if (!el) {
      const st = document.createElement('style'); st.textContent = css; document.head.append(st);
      el = document.createElement('div'); el.id = 'sbAuth';
      el.innerHTML = '<div class="card"></div>';
      document.body.append(el);
    }
    el.classList.remove('hidden');
    return el.querySelector('.card');
  }
  const hide = () => { const el = document.getElementById('sbAuth'); if (el) el.classList.add('hidden'); };
  const head = '<img class="logo" src="logo.svg" alt="SPACEBASE">';

  // 카카오톡·밴드 등 앱 안의 브라우저에서는 구글이 로그인을 막는다 → 바깥 브라우저로 열기
  const ua = navigator.userAgent;
  const inApp = /KAKAOTALK|NAVER\(inapp|BAND\/|Line\/|Instagram|FBAN|FBAV|everytimeApp|DaumApps/i.test(ua);
  function showInApp() {
    const url = location.href;
    const isKakao = /KAKAOTALK/i.test(ua), isAndroid = /Android/i.test(ua);
    const c = box();
    c.innerHTML = `${head}<h2>다른 브라우저로 열어 주세요</h2>
      <p>카카오톡·밴드 같은 앱 안의 화면에서는<br>구글 로그인이 되지 않아요.</p>
      ${isKakao ? '<button class="primary" id="sbOpen">바깥 브라우저로 열기</button>' : isAndroid ? '<button class="primary" id="sbOpen">크롬으로 열기</button>' : '<p>오른쪽 아래(또는 위) <b>⋯ 메뉴 → "Safari로 열기"</b>를 눌러 주세요.</p>'}
      <button id="sbCopy">주소 복사하기</button><div class="err"></div>`;
    const open = c.querySelector('#sbOpen');
    if (open) open.onclick = () => {
      location.href = isKakao ? 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url)
        : 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
    };
    c.querySelector('#sbCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(url); c.querySelector('.err').textContent = '복사했어요. 크롬이나 Safari 주소창에 붙여넣어 주세요.'; }
      catch { prompt('이 주소를 복사해 크롬이나 Safari 에 붙여넣어 주세요.', url); }
    };
  }

  function showLogin(err) {
    const c = box();
    c.innerHTML = `${head}<h2>로그인</h2><p>회사 구글 계정 또는 본인 구글 계정으로<br>로그인해 주세요.</p>
      ${lsGet('sb_invite') ? '<p><b>초대 링크로 들어오셨어요.</b> 로그인하면 바로 가입돼요.</p>' : ''}
      <button class="primary" id="sbG">${G_ICON}Google 로 로그인</button><div class="err">${esc(err || '')}</div>
      <p style="font-size:12px;color:#999">관리자가 받아 준 사람만 들어올 수 있어요.</p>`;
    c.querySelector('#sbG').onclick = signIn;
  }
  async function signIn() {
    const p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    try { await firebase.auth().signInWithPopup(p); }
    catch (e) {
      if (/popup-blocked|operation-not-supported|web-storage-unsupported/.test(e.code || '')) return firebase.auth().signInWithRedirect(p);
      if (/popup-closed|cancelled-popup/.test(e.code || '')) return;
      showLogin('로그인하지 못했어요: ' + (e.message || e.code));
    }
  }
  const signOut = async () => { try { await firebase.auth().signOut(); } catch {} location.reload(); };

  function showPending(user, err) {
    const c = box();
    c.innerHTML = `${head}<h2>관리자 승인을 기다리고 있어요</h2>
      <p>가입 신청을 보냈어요.<br>관리자가 승인하면 이 화면이 저절로 넘어가요.</p>
      <p style="font-size:13px">빨리 들어가야 하면 관리자에게<br><b>초대 링크</b>를 달라고 해 주세요.</p>
      <div class="err">${esc(err || '')}</div>
      <button class="link" id="sbAdmin">관리자 비밀번호가 있어요</button>
      <div class="who">${esc(user.email || '')} · <button class="link" id="sbOut" style="display:inline;width:auto">다른 계정으로 로그인</button></div>`;
    c.querySelector('#sbOut').onclick = signOut;
    c.querySelector('#sbAdmin').onclick = () => showAdminJoin(user);
  }
  let joining = false; // 관리자 비밀번호로 들어가는 중 (틀렸을 때 화면이 잠깐 넘어가지 않게)
  function showAdminJoin(user, err, typed) {
    const c = box();
    c.innerHTML = `${head}<h2>관리자로 들어가기</h2>
      <form autocomplete="off"><input name="pw" type="password" placeholder="관리자 비밀번호">
      <input name="name" placeholder="내 이름 (주간 스케줄 직원표와 같게)" maxlength="20" value="${esc(typed != null ? typed : user.displayName || '')}">
      <div class="err">${esc(err || '')}</div><button class="primary">들어가기</button></form>
      <button class="link" id="sbBack">돌아가기</button>`;
    const f = c.querySelector('form');
    c.querySelector('#sbBack').onclick = () => showPending(user);
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const name = f.name.value.trim().slice(0, 20);
      if (!f.pw.value || !name) return showAdminJoin(user, '비밀번호와 이름을 모두 넣어 주세요.', name);
      const key = await sha256hex('spacebase-admin:' + f.pw.value);
      joining = true;
      try {
        await firebase.database().ref('ws').update({
          ['adminTry/' + user.uid]: key, ['admins/' + user.uid]: true, ['pending/' + user.uid]: null,
          ['members/' + user.uid]: { name, email: user.email || '', joinedAt: Date.now(), via: 'admin' },
        });
        location.reload();
      } catch { joining = false; showAdminJoin(user, '관리자 비밀번호가 맞지 않아요.', name); }
    };
  }

  // ---------- 회원 확인 ----------
  async function useInvite(user, code) {
    const db = firebase.database();
    const inv = (await db.ref('ws/invites/' + code).once('value')).val();
    if (!inv || !inv.name) throw new Error('없는 초대 링크예요.');
    if (inv.usedBy && inv.usedBy !== user.uid) throw new Error('이미 사용한 초대 링크예요. 관리자에게 새 링크를 받아 주세요.');
    if (inv.expires < Date.now()) throw new Error('기한(7일)이 지난 초대 링크예요. 관리자에게 새 링크를 받아 주세요.');
    await db.ref('ws').update({
      ['members/' + user.uid]: { name: inv.name, email: user.email || '', joinedAt: Date.now(), via: 'invite', invite: code },
      ['invites/' + code + '/usedBy']: user.uid, ['pending/' + user.uid]: null,
    });
  }

  let started = null;
  function start() {
    if (started) return started;
    started = new Promise((resolve) => {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      // 시험용: 내 컴퓨터(localhost)에서 sb_emu 를 켜면 연습용 Firebase(에뮬레이터)에 붙는다. 실제 사이트에서는 무시.
      if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && lsGet('sb_emu')) {
        firebase.auth().useEmulator('http://127.0.0.1:9099');
        firebase.database().useEmulator('127.0.0.1', 9000);
      }
      if (inApp) return showInApp();
      const db = firebase.database();
      let watching = null, done = false;
      firebase.auth().getRedirectResult().catch((e) => showLogin('로그인하지 못했어요: ' + (e.message || e.code)));
      firebase.auth().onAuthStateChanged(async (user) => {
        if (done) { if (!user) location.reload(); return; }
        if (!user) { if (watching) watching.off(); return showLogin(); }
        const myRef = db.ref('ws/members/' + user.uid);
        let me = (await myRef.once('value')).val();
        let err = '';
        const code = lsGet('sb_invite');
        if (!me && code) {
          try { await useInvite(user, code); me = (await myRef.once('value')).val(); }
          catch (e) { err = e.message || '초대 링크를 쓰지 못했어요.'; }
          lsSet('sb_invite', null);
        }
        if (!me) {
          await db.ref('ws/pending/' + user.uid).set({ email: user.email || '', gname: user.displayName || '', at: Date.now() }).catch(() => {});
          showPending(user, err);
          watching = myRef;
          myRef.on('value', (s) => { if (s.exists() && !joining) location.reload(); });
          return;
        }
        const [space, adm] = await Promise.all([db.ref('ws/config/space').once('value'), db.ref('ws/admins/' + user.uid).once('value')]);
        if (!space.val()) { const c = box(); c.innerHTML = `${head}<h2>아직 준비 중이에요</h2><p>관리자 설정이 끝나지 않았어요. (ws/config)</p>`; return; }
        done = true;
        hide();
        // 내보내기 당하면 바로 나가게
        myRef.on('value', (s) => { if (!s.exists()) { alert('관리자가 회원에서 내보냈어요.'); signOut(); } });
        resolve({ uid: user.uid, email: user.email || '', name: me.name, admin: adm.val() === true, spaceKey: space.val() });
      });
    });
    return started;
  }

  window.SBAuth = { enabled, start, signOut, sha256hex };
})();
