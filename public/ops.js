// 서버와 브라우저가 함께 쓰는 변경(op) 적용 함수.
// 모든 수정은 op 하나로 표현되고, 서버가 적용한 뒤 다른 사용자에게 그대로 전달된다.
(function (root) {
  const PROJECT_FIELDS = ['type', 'name', 'area', 'amount', 'period', 'design', 'build', 'note'];
  const str = (v, n = 500) => (v == null ? '' : String(v).slice(0, n));
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const isColor = (c) => /^#[0-9a-fA-F]{6}$/.test(c);

  function applyOp(db, op) {
    if (!op || typeof op !== 'object') return false;
    db.cells = db.cells || {};
    switch (op.k) {
      case 'cell': { // 일정 칸 하나: 글자/카테고리
        if (!isDate(op.date) || !findProject(db, op.pid)) return false;
        const key = op.pid + '|' + op.date;
        const cur = Object.assign({}, db.cells[key]);
        if ('t' in op) cur.t = str(op.t, 200);
        if ('c' in op) cur.c = op.c ? str(op.c, 40) : '';
        if (!cur.t) delete cur.t;
        if (!cur.c) delete cur.c;
        if (Object.keys(cur).length) db.cells[key] = cur; else delete db.cells[key];
        return true;
      }
      case 'cells': { // 여러 칸에 같은 변경 (범위 카테고리 지정, 지우기)
        if (!Array.isArray(op.list) || op.list.length > 2000) return false;
        for (const it of op.list) {
          const sub = { k: 'cell', pid: it.pid, date: it.date };
          if ('t' in op) sub.t = op.t;
          if ('c' in op) sub.c = op.c;
          applyOp(db, sub);
        }
        return true;
      }
      case 'proj': { // 프로젝트 정보 칸
        const p = findProject(db, op.id);
        if (!p || !PROJECT_FIELDS.includes(op.field)) return false;
        p[op.field] = str(op.value, 200);
        return true;
      }
      case 'addProj': {
        const p = op.project;
        if (!p || !p.id || findProject(db, p.id) || !db.groups.some((g) => g.id === p.groupId)) return false;
        const clean = { id: str(p.id, 40), groupId: p.groupId };
        PROJECT_FIELDS.forEach((f) => (clean[f] = str(p[f], 200)));
        let idx = db.projects.length;
        if (op.after) {
          const i = db.projects.findIndex((x) => x.id === op.after);
          if (i >= 0) idx = i + 1;
        } else if (op.before) {
          const i = db.projects.findIndex((x) => x.id === op.before);
          if (i >= 0) idx = i;
        } else {
          // 그룹의 마지막 뒤
          let last = -1;
          db.projects.forEach((x, i) => { if (x.groupId === p.groupId) last = i; });
          if (last >= 0) idx = last + 1;
        }
        db.projects.splice(idx, 0, clean);
        return true;
      }
      case 'delProj': {
        const i = db.projects.findIndex((x) => x.id === op.id);
        if (i < 0) return false;
        db.projects.splice(i, 1);
        for (const k of Object.keys(db.cells)) if (k.startsWith(op.id + '|')) delete db.cells[k];
        return true;
      }
      case 'moveProj': { // dir: -1 위로, 1 아래로 (같은 그룹 안에서)
        const i = db.projects.findIndex((x) => x.id === op.id);
        if (i < 0) return false;
        const g = db.projects[i].groupId;
        let j = i + (op.dir < 0 ? -1 : 1);
        while (j >= 0 && j < db.projects.length && db.projects[j].groupId !== g) j += op.dir < 0 ? -1 : 1;
        if (j < 0 || j >= db.projects.length) return false;
        const [x] = db.projects.splice(i, 1);
        db.projects.splice(j, 0, x);
        return true;
      }
      case 'addGroup': {
        if (!op.id || db.groups.some((g) => g.id === op.id)) return false;
        const g = { id: str(op.id, 40), name: str(op.name, 40) || '새 구분' };
        const at = Number.isInteger(op.index) && op.index >= 0 && op.index <= db.groups.length ? op.index : db.groups.length;
        db.groups.splice(at, 0, g);
        return true;
      }
      case 'batch': { // 여러 변경을 한 번에 (붙여넣기, 되돌리기 등)
        if (!Array.isArray(op.ops) || op.ops.length > 3000) return false;
        let any = false;
        for (const sub of op.ops) if (sub && sub.k !== 'batch' && applyOp(db, sub)) any = true;
        return any;
      }
      case 'renameGroup': {
        const g = db.groups.find((x) => x.id === op.id);
        if (!g) return false;
        g.name = str(op.name, 40);
        return true;
      }
      case 'delGroup': {
        if (db.projects.some((p) => p.groupId === op.id)) return false;
        const i = db.groups.findIndex((x) => x.id === op.id);
        if (i < 0) return false;
        db.groups.splice(i, 1);
        return true;
      }
      case 'moveGroup': {
        const i = db.groups.findIndex((x) => x.id === op.id);
        const j = i + (op.dir < 0 ? -1 : 1);
        if (i < 0 || j < 0 || j >= db.groups.length) return false;
        const [x] = db.groups.splice(i, 1);
        db.groups.splice(j, 0, x);
        return true;
      }
      case 'cat': { // 카테고리 추가/수정
        if (!op.id) return false;
        let c = db.categories.find((x) => x.id === op.id);
        if (!c) { c = { id: str(op.id, 40), name: '', color: '#cccccc' }; db.categories.push(c); }
        if ('name' in op) c.name = str(op.name, 60);
        if ('color' in op && isColor(op.color)) c.color = op.color;
        return true;
      }
      case 'delCat': {
        const i = db.categories.findIndex((x) => x.id === op.id);
        if (i < 0) return false;
        db.categories.splice(i, 1);
        return true;
      }
      case 'memo': {
        db.memo = db.memo || {};
        if (!['left', 'right', 'notice', 'etc'].includes(op.key)) return false;
        db.memo[op.key] = str(op.value, 20000);
        return true;
      }
      case 'team': {
        db.teams = db.teams || [];
        const i = Number(op.idx);
        if (!(i >= 0 && i < 10)) return false;
        db.teams[i] = str(op.value, 5000);
        return true;
      }
      case 'title': {
        db.title = str(op.value, 80);
        return true;
      }
      // ---- 구성원 (팀 / 직급 / 이름) ----
      case 'initMembers': { // 예전 글자 목록을 구조로 바꿀 때 한 번
        if ((db.mteams || []).length || (db.members || []).length) return false;
        db.mteams = (op.mteams || []).slice(0, 30).map((t) => ({ id: str(t.id, 40), name: str(t.name, 40) }));
        db.members = (op.members || []).slice(0, 300).map(cleanMember);
        db.ranks = (op.ranks || []).slice(0, 30).map((r) => str(r, 20));
        db.teams = ['', ''];
        return true;
      }
      case 'ranks': {
        db.ranks = (op.list || []).slice(0, 30).map((r) => str(r, 20)).filter(Boolean);
        return true;
      }
      case 'mteamAdd': {
        db.mteams = db.mteams || [];
        if (!op.team || !op.team.id || db.mteams.some((t) => t.id === op.team.id)) return false;
        const i = op.index == null ? db.mteams.length : Math.max(0, Math.min(db.mteams.length, Number(op.index)));
        db.mteams.splice(i, 0, { id: str(op.team.id, 40), name: str(op.team.name, 40) });
        return true;
      }
      case 'mteamSet': {
        const t = (db.mteams || []).find((x) => x.id === op.id);
        if (!t) return false;
        t.name = str(op.value, 40);
        return true;
      }
      case 'mteamDel': {
        const i = (db.mteams || []).findIndex((x) => x.id === op.id);
        if (i < 0) return false;
        db.mteams.splice(i, 1);
        db.members = (db.members || []).filter((m) => m.teamId !== op.id);
        return true;
      }
      case 'memberAdd': {
        db.members = db.members || [];
        if (!op.member || !op.member.id || db.members.some((m) => m.id === op.member.id)) return false;
        const i = op.index == null ? db.members.length : Math.max(0, Math.min(db.members.length, Number(op.index)));
        db.members.splice(i, 0, cleanMember(op.member));
        return true;
      }
      case 'memberSet': {
        const m = (db.members || []).find((x) => x.id === op.id);
        if (!m || !['abbr', 'rank', 'name', 'teamId'].includes(op.field)) return false;
        m[op.field] = str(op.value, 40);
        return true;
      }
      case 'memberDel': {
        const i = (db.members || []).findIndex((x) => x.id === op.id);
        if (i < 0) return false;
        db.members.splice(i, 1);
        return true;
      }
      case 'memberMove': { // 같은 팀 안에서 위/아래로
        const list = db.members || [];
        const i = list.findIndex((x) => x.id === op.id);
        if (i < 0) return false;
        const step = op.dir < 0 ? -1 : 1;
        let j = i + step;
        while (j >= 0 && j < list.length && list[j].teamId !== list[i].teamId) j += step;
        if (j < 0 || j >= list.length) return false;
        const [m] = list.splice(i, 1);
        list.splice(j, 0, m);
        return true;
      }
    }
    return false;
  }

  function cleanMember(m) {
    return { id: str(m.id, 40), teamId: str(m.teamId, 40), abbr: str(m.abbr, 10), rank: str(m.rank, 20), name: str(m.name, 40) };
  }

  function findProject(db, id) {
    return db.projects.find((p) => p.id === id);
  }

  const api = { applyOp, PROJECT_FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ops = api;
})(this);
