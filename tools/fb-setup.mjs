// Firebase 실제 프로젝트에 규칙을 올리고, 비밀 값에서 만든 "열쇠 모양"(해시)을 넣는다.
// GitHub Actions(firebase-rules.yml)에서만 실행. 비밀 값은 화면(로그)에 찍지 않는다.
// 필요한 환경 변수: FIREBASE_SERVICE_ACCOUNT(JSON), SB_CODE(회사 비밀번호), ADMIN_CODE(관리자 비밀번호)
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import admin from 'firebase-admin';

const DB_URL = 'https://spacebase-schedule-default-rtdb.asia-southeast1.firebasedatabase.app';
const need = ['FIREBASE_SERVICE_ACCOUNT', 'SB_CODE', 'ADMIN_CODE'].filter((k) => !process.env[k]);
if (need.length) { console.error('GitHub Secret 이 없습니다: ' + need.join(', ')); process.exit(1); }
if (process.env.ADMIN_CODE.length < 12) { console.error('ADMIN_CODE(관리자 비밀번호)는 12자 이상이어야 합니다.'); process.exit(1); }
let sa;
try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); } catch { console.error('FIREBASE_SERVICE_ACCOUNT 가 올바른 JSON 이 아닙니다. 내려받은 키 파일 내용을 통째로 넣어 주세요.'); process.exit(1); }
if (sa.project_id !== 'spacebase-schedule') { console.error('다른 Firebase 프로젝트의 키입니다: ' + sa.project_id); process.exit(1); }

const h = (s) => createHash('sha256').update(s).digest('hex');
const cred = admin.credential.cert(sa);
admin.initializeApp({ credential: cred, databaseURL: DB_URL });
const { access_token } = await cred.getAccessToken();
const rulesUrl = DB_URL + '/.settings/rules.json';
const auth = { Authorization: 'Bearer ' + access_token };

// 1) 지금 규칙을 기록으로 남김 (되돌릴 때 참고)
const before = await fetch(rulesUrl, { headers: auth });
if (!before.ok) { console.error('지금 규칙을 읽지 못했습니다: ' + before.status + ' ' + (await before.text()).slice(0, 200)); process.exit(1); }
const beforeText = await before.text();
console.log('--- 바꾸기 전 규칙 ---\n' + beforeText);
// 우리가 모르는 자리에 대한 규칙이 있으면 멈춤 (그 자리를 못 쓰게 될 수 있으므로)
try {
  const keys = Object.keys(JSON.parse(beforeText.replace(/^\s*\/\/.*$/gm, '')).rules || {});
  const known = Object.keys(JSON.parse(readFileSync(new URL('../firebase/database.rules.json', import.meta.url), 'utf8')).rules);
  const unknown = keys.filter((k) => !known.includes(k));
  if (unknown.length) { console.error('지금 규칙에 새 규칙 파일에 없는 자리가 있어 멈춥니다: ' + unknown.join(', ')); process.exit(1); }
} catch (e) { console.error('지금 규칙을 해석하지 못해 멈춥니다: ' + e.message); process.exit(1); }

// 2) 새 규칙 올리기
const rules = readFileSync(new URL('../firebase/database.rules.json', import.meta.url), 'utf8');
JSON.parse(rules);
const put = await fetch(rulesUrl, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: rules });
if (!put.ok) { console.error('규칙 올리기 실패: ' + put.status + ' ' + (await put.text()).slice(0, 300)); process.exit(1); }
console.log('규칙 올리기 완료');

// 3) 회원에게만 보이는 설정 + 관리자 비밀번호 열쇠 모양 (비밀번호 자체는 저장하지 않음)
const db = admin.database();
const space = h('spacebase:' + process.env.SB_CODE);
const exists = (await db.ref('spaces/' + space + '/data/title').once('value')).exists() || (await db.ref('spaces/' + space + '/data/groups').once('value')).exists();
if (!exists) { console.error('SB_CODE 로 된 주간 스케줄이 없습니다. SB_CODE 가 회사 비밀번호와 같은지 확인해 주세요.'); process.exit(1); }
await db.ref('ws/config/space').set(space);
await db.ref('ws/adminKeys').set({ [h('spacebase-admin:' + process.env.ADMIN_CODE)]: true });
console.log('설정 완료 (주간 스케줄 연결 확인됨, 관리자 비밀번호 열쇠 갱신)');
process.exit(0);
