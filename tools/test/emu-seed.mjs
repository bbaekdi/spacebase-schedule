import { readFileSync } from 'fs'; import { createHash } from 'crypto'; import vm from 'vm';
const h = (s) => createHash('sha256').update(s).digest('hex');
const ctx = { window: {} }; vm.runInNewContext(readFileSync(new URL('../../public/default-data.js', import.meta.url).pathname, 'utf8'), ctx);
const d = JSON.parse(JSON.stringify(ctx.window.SB_DEFAULT_DB)); delete d.version;
d.mteams = [{ id: 't1', name: '설계팀' }]; d.members = [{ id: 'm1', name: '김테스트', rank: '대리', teamId: 't1' }, { id: 'm2', name: '이시험', rank: '사원', teamId: 't1' }, { id: 'm3', name: '박연습', rank: '과장', teamId: 't1' }];
const SPACE = h('spacebase:testcode');
const body = { ws: { config: { space: SPACE }, adminKeys: { [h('spacebase-admin:admin-password-123')]: true } }, spaces: { [SPACE]: { data: d } } };
const r = await fetch('http://127.0.0.1:9000/.json?ns=spacebase-schedule-default-rtdb', { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(body) });
console.log('seed', r.status);
