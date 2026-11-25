// Site(현장 공정·출근) 공용 도우미: Site 화면(site.js)과 홈 "오늘 내 현장" 카드가 같이 쓴다.
// - 현장 목록 = 주간 스케줄 PROJECT 구분 현장 (주간 스케줄 데이터는 읽기만 함)
// - 현장 소장 = 주간 스케줄 "시공 담당"(약칭) → 직원표 이름
// - 공정·출근은 Firebase site/<현장id>/tasks, site/<현장id>/attend/<날짜>/<uid>
(function () {
  const pad = (n) => String(n).padStart(2, '0');
  const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymdOf(d); };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const yy = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[1].slice(2)}년 ${m[2]}월 ${m[3]}일` : ''; };
  const md = (s) => { const m = String(s || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${+m[1]}/${+m[2]}` : ''; };
  const list = (v) => (Array.isArray(v) ? v : Object.values(v || {})).filter(Boolean);
  const norm = (s) => String(s || '').replace(/\s+/g, '');

  // 주간 스케줄 공사기간 글자(예: 12.05-1.22, 10/26-12/7, 27.01.02-, 2026.12.05-2027.01.22) → {st, en} (YYYY-MM-DD, 없으면 null). 못 읽으면 null.
  // 주간 스케줄(app.js periodRange)과 같은 방법으로 읽는다.
  function periodRange(text, refYmd) {
    const s = String(text || '').trim();
    if (!s) return null;
    const parts = s.split(/\s*[-~∼–]\s*/);
    if (parts.length !== 2) return null;
    const one = (t) => {
      if (!t) return { none: true };
      const m = t.match(/^(?:(\d{2}|\d{4})[./])?(\d{1,2})[./](\d{1,2})(?!\d)/);
      if (!m) return null;
      const mo = +m[2], da = +m[3];
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
      return { y: m[1] ? (m[1].length === 2 ? 2000 + +m[1] : +m[1]) : null, mo, da };
    };
    const a = one(parts[0]), b = one(parts[1]);
    if (!a || !b || (a.none && b.none)) return null;
    const ref = parse(refYmd || today());
    const mk = (y, x) => new Date(y, x.mo - 1, x.da);
    const mdn = (x) => x.mo * 100 + x.da;
    let best = null;
    const ry = ref.getFullYear();
    for (const y of [ry - 1, ry, ry + 1]) {
      let st = null, en = null;
      if (!a.none) st = mk(a.y || y, a);
      if (!b.none) en = mk(b.y || (a.none ? y : st.getFullYear() + (mdn(b) < mdn(a) ? 1 : 0)), b);
      const dist = st && ref < st ? st - ref : en && ref > en ? ref - en : 0;
      const near = Math.abs(ref - (st || en));
      if (!best || dist < best.dist || (dist === best.dist && near < best.near)) best = { st, en, dist, near };
      if ((a.none || a.y) && (b.none || b.y)) break;
    }
    return { st: best.st ? ymdOf(best.st) : null, en: best.en ? ymdOf(best.en) : null };
  }

  // 현장 목록: 진행(공사기간 안, 착공 7일 전부터) / 기간 미정 / 지난 현장
  function sites(data, ref = today()) {
    const groups = list(data.groups).filter((g) => /PROJECT/i.test(g.name || ''));
    const gids = new Set(groups.map((g) => g.id));
    const out = { active: [], undated: [], past: [], all: [] };
    for (const p of list(data.projects)) {
      if (!gids.has(p.groupId) || !String(p.name || '').trim()) continue;
      const r = periodRange(p.period, ref);
      const s = { id: p.id, name: String(p.name).trim(), type: p.type || '', period: p.period || '', st: r && r.st, en: r && r.en, build: p.build || '', p };
      out.all.push(s);
      if (!r) out.undated.push(s);
      else if (r.en && r.en < ref) out.past.push(s);
      else if (!r.st || addDays(r.st, -7) <= ref) out.active.push(s);
      else out.undated.push(s); // 아직 먼 현장은 "준비" 쪽에
    }
    out.past.sort((a, b) => (b.en || '').localeCompare(a.en || ''));
    return out;
  }
  // 현장 소장 이름들 (시공 담당 약칭 → 직원표 이름)
  function managers(site, members) {
    const tokens = String(site.build || '').split(/[\/,·]+|\s+/).map((s) => s.trim()).filter((s) => s && s !== '-');
    const ms = list(members);
    return tokens.map((t) => { const m = ms.find((x) => x.abbr === t) || ms.find((x) => norm(x.name) === norm(t)); return m ? { name: String(m.name).trim(), rank: m.rank || '' } : { name: t, rank: '' }; });
  }
  const isManager = (site, members, myName) => managers(site, members).some((m) => norm(m.name) === norm(myName));

  // 공정이 그날 하는지: 기간 안(빼기 아님) 또는 더하기
  function activeOn(t, day) {
    if (t.plus && t.plus[day]) return true;
    if (t.minus && t.minus[day]) return false;
    return !!(t.start && day >= t.start && (!t.end ? day === t.start : day <= t.end));
  }
  const taskList = (tasks) => Object.entries(tasks || {}).map(([id, t]) => ({ id, ...t })).sort((a, b) => (a.order || 0) - (b.order || 0));
  // 공정이 하는 날들 (기간 안 + 더한 날 - 뺀 날)
  function daysOf(t) {
    const out = new Set();
    if (t.start) { const end = t.end && t.end >= t.start ? t.end : t.start; for (let d = t.start, i = 0; d <= end && i < 1000; d = addDays(d, 1), i++) if (!(t.minus && t.minus[d])) out.add(d); }
    Object.keys(t.plus || {}).forEach((d) => out.add(d));
    return [...out].sort();
  }
  // 진행률: 공정 일정이 지난 날만큼 (완료 체크한 공정은 다 끝난 것으로). 날짜 없는 공정은 1칸으로 세고 완료 체크로만.
  function progress(tasks, day = today()) {
    let tot = 0, got = 0;
    for (const t of taskList(tasks)) {
      const ds = daysOf(t);
      const w = ds.length || 1;
      tot += w;
      got += t.done ? w : ds.filter((d) => d < day).length;
    }
    return tot ? Math.round((got / tot) * 100) : 0;
  }
  const todayTasks = (tasks, day = today()) => taskList(tasks).filter((t) => activeOn(t, day));
  // 다음에 시작하는 공정 (오늘 이후 첫 날)
  function nextTask(tasks, day = today()) {
    let best = null;
    for (const t of taskList(tasks)) {
      if (t.done) continue;
      const days = [t.start, ...Object.keys(t.plus || {})].filter((d) => d && d > day).sort();
      if (days[0] && (!best || days[0] < best.day)) best = { t, day: days[0] };
    }
    return best;
  }
  const DEFAULT_TASKS = ['철거', '설비', '전기', '목공', '타일', '도장', '도배', '가구', '조명', '청소', '검수'];

  // 새 글 알림 보내기 (Band 중계 worker/push.js)
  async function notify(postId) {
    try {
      const api = String(window.SB_BAND_API || '').replace(/\/$/, ''); if (!api || !postId) return;
      const t = await firebase.auth().currentUser.getIdToken();
      fetch(api + '/push/notify', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ post: postId }) }).catch(() => {});
    } catch {}
  }
  // 출근할 수 있는 사람: 그 현장 소장님 + 관리자
  const canAttend = (site, members, me) => !!me && (me.admin || isManager(site, members, me.name));
  // 출근: site/<id>/attend/<날짜>/<uid> + Band "출근" 게시판 글 + 새 글 알림 (하루 한 번)
  async function attend(db, me, site) {
    const day = today(), ref = db.ref('site/' + site.id + '/attend/' + day + '/' + me.uid);
    if ((await ref.once('value')).exists()) return { already: true };
    const now = Date.now();
    await ref.set({ name: me.name, at: now });
    const hm = new Date(now).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
    const post = db.ref('board/posts').push();
    await post.set({ cat: 'attend', text: `${me.name} 출근 · ${hm}`, siteName: site.name.slice(0, 40), uid: me.uid, name: me.name, at: now, commentCount: 0 }).then(() => notify(post.key)).catch(() => {});
    return { at: now, hm };
  }
  const hmOf = (t) => new Date(t).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });

  window.SBSite = { today, addDays, diffDays, parse, ymdOf, yy, md, periodRange, sites, managers, isManager, canAttend, activeOn, daysOf, taskList, progress, todayTasks, nextTask, DEFAULT_TASKS, attend, notify, hmOf, list, norm };
})();
