// SPACEBASE 웹사이트에서 넘어온 일정(주소 # 뒤에 담김)을 밴드 '일정 만들기' 창에 채운다.
// 자동 입력 방식은 원래 데스크톱 앱 "회사 밴드 캘린더"(bandform.js)를 그대로 쓴다.
// '완료'는 누르지 않는다: 사람이 내용을 확인하고 직접 누른다.
(async () => {
  const KEY = 'sbe_pending';
  const m = location.hash.match(/[#&]sbe=([^&]+)/);
  if (m) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data: m[1] })); } catch {}
    history.replaceState(null, '', location.pathname + location.search);
  }
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch {}
  if (!pending || Date.now() - pending.at > 10 * 60 * 1000) return;
  // 밴드 일정 화면이 될 때까지 기다린다 (로그인을 거치거나 화면이 늦게 바뀌는 경우)
  const onEventPage = () => /\/band\/\d+\/(event|calendar)/.test(location.pathname);
  for (let i = 0; i < 600 && !onEventPage(); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!onEventPage()) return;
  try { sessionStorage.removeItem(KEY); } catch {}

  let p;
  try {
    const b64 = pending.data.replace(/-/g, '+').replace(/_/g, '/');
    p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  } catch { return; }

  // 오른쪽 위 안내 상자
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;max-width:340px;padding:12px 14px;border-radius:10px;background:#1d1d1b;color:#fff;font:13px/1.55 "Malgun Gothic",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)';
  const say = (html, tone) => { box.innerHTML = html; box.style.background = tone === 'ok' ? '#1d1d1b' : tone === 'warn' ? '#8a5a00' : '#1d1d1b'; };
  const close = () => box.remove();
  document.documentElement.append(box);
  say('<b style="color:#f1bf52">SPACEBASE</b> 일정 입력 준비 중…');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const A = window.__bandAuto;
  if (!A) { say('자동 입력 도구를 불러오지 못했어요. 직접 입력해 주세요.', 'warn'); return; }
  const type = async (text) => { document.execCommand('insertText', false, text); await sleep(60); };
  const digits = (t) => String(t ?? '').replace(/\D/g, '');
  const squash = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
  const pad2 = (n) => String(n).padStart(2, '0');
  const clock = (t) => { const [h, mm] = t.split(':').map(Number); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${pad2(mm)}`; };
  const dotDate = (d) => { const [y, mo, day] = d.split('-'); return `${y}. ${mo}. ${day}.`; };
  const need = async (r) => { r = await r; if (!r || r.ok === false) throw new Error((r && r.reason) || '밴드 화면 구성이 달라 입력하지 못했습니다'); return r; };
  const bad = [];
  const step = async (label, fn) => { try { await fn(); } catch (e) { console.warn('[SPACEBASE]', label, e.message); bad.push(label); } };

  async function setDate(which, date) {
    const r = await need(A.focusDate(which));
    if (r.typable) {
      for (const text of [dotDate(date), date.replace(/-/g, '')]) {
        await need(A.focusDate(which)); await type(text); A.blur(); await sleep(300);
        if (digits(A.readDate(which)) === digits(date)) return;
      }
    }
    await need(A.pickDate({ which, date })); await sleep(250);
    if (digits(A.readDate(which)) !== digits(date)) throw new Error('날짜가 반영되지 않았습니다');
  }

  try {
    await need(A.open());
  } catch (e) {
    say(`'일정 만들기' 창을 열지 못했어요.<br><small>${e.message}</small><br>밴드에 로그인되어 있는지 확인해 주세요.`, 'warn');
    return;
  }
  say('<b style="color:#f1bf52">SPACEBASE</b> 일정을 채우는 중… 잠시만 기다려 주세요.');
  await step('제목', async () => { await need(A.focus('title')); await type(p.title); });
  if (p.description) await step('설명', async () => {
    await need(A.focus('desc'));
    const lines = p.description.split('\n');
    for (let i = 0; i < lines.length; i++) { if (i) document.execCommand('insertLineBreak'); if (lines[i]) await type(lines[i]); }
  });
  if (p.place) await step('장소', async () => { await need(A.focus('place')); await type(p.place); await sleep(500); A.blur(); });
  await step('하루 종일', () => need(A.check({ key: 'allDay', value: !!p.allDay })));
  await step('시작 날짜', () => setDate('start', p.startDate));
  if (!p.allDay) await step('시작 시간', () => need(A.setTime({ which: 'start', text: clock(p.startTime) })));
  await step('종료 날짜', () => setDate('end', p.endDate));
  if (!p.allDay) await step('종료 시간', () => need(A.setTime({ which: 'end', text: clock(p.endTime) })));

  // 확인
  const s = A.read();
  if (s && s.ok) {
    if (!bad.includes('제목') && squash(s.title) !== squash(p.title)) bad.push('제목');
    if (p.place && !bad.includes('장소') && squash(s.place) !== squash(p.place)) bad.push('장소');
  }
  const btn = '<button style="margin-top:8px;border:0;border-radius:6px;padding:5px 10px;background:#f1bf52;color:#1d1d1b;font-weight:700;cursor:pointer">닫기</button>';
  if (bad.length) say(`일정을 채웠어요. 다음 항목은 <b>직접 확인</b>해 주세요: ${[...new Set(bad)].join(', ')}<br>확인 후 밴드의 <b>완료</b>를 눌러 주세요.<br>${btn}`, 'warn');
  else say(`일정을 다 채웠어요. 내용을 확인하고 밴드의 <b>완료</b>를 눌러 주세요.<br>${btn}`, 'ok');
  box.querySelector('button').onclick = close;
})();
