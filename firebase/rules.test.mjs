// 규칙 시험 (연습용 Firebase 에뮬레이터): bash tools/test-rules.sh
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
const h = (s) => createHash('sha256').update(s).digest('hex');
const env = await initializeTestEnvironment({ projectId: 'demo-sb', database: { rules: readFileSync(process.argv[2], 'utf8'), host: '127.0.0.1', port: 9000 } });
const SPACE = h('spacebase:testcode'), AK = h('spacebase-admin:admin-password-123');
await env.withSecurityRulesDisabled(async (c) => {
  await c.database().ref().set({ ws: { config: { space: SPACE }, adminKeys: { [AK]: true } }, spaces: { [SPACE]: { data: { title: 'T' } } } });
});
const db = (uid, email) => (uid ? env.authenticatedContext(uid, { email }) : env.unauthenticatedContext()).database();
let n = 0, bad = 0;
const ok = async (name, p) => { n++; try { await assertSucceeds(p); } catch (e) { bad++; console.log('✗ 돼야 하는데 막힘:', name, e.message); } };
const no = async (name, p) => { n++; try { await assertFails(p); } catch (e) { bad++; console.log('✗ 막혀야 하는데 됨:', name); } };
const A = db('a', 'a@x.com'), B = db('b', 'b@x.com'), C = db('c', 'c@x.com'), X = db('x', 'x@x.com'), anon = db(null);

await no('비회원 config 읽기', X.ref('ws/config').once('value'));
await no('로그인 안 함 config 읽기', anon.ref('ws/config').once('value'));
await no('adminKeys 읽기', X.ref('ws/adminKeys').once('value'));
await no('틀린 관리자 비번으로 관리자 되기', A.ref('ws').update({ 'adminTry/a': h('spacebase-admin:wrong'), 'admins/a': true, 'members/a': { name: '관리', email: 'a@x.com' } }));
await no('비번 없이 회원 되기', X.ref('ws/members/x').set({ name: '아무개', email: 'x@x.com' }));
await ok('맞는 관리자 비번으로 관리자+회원 되기', A.ref('ws').update({ 'adminTry/a': AK, 'admins/a': true, 'members/a': { name: '관리', email: 'a@x.com' }, 'pending/a': null }));
await ok('회원 config 읽기', A.ref('ws/config/space').once('value'));
await ok('회원 명단 읽기', A.ref('ws/members').once('value'));
// 가입 신청
await ok('비회원 가입 신청', B.ref('ws/pending/b').set({ email: 'b@x.com', gname: 'B', at: 1 }));
await no('남의 가입 신청 쓰기', B.ref('ws/pending/c').set({ email: 'c@x.com' }));
await no('비회원 신청 목록 읽기', B.ref('ws/pending').once('value'));
await ok('관리자 신청 목록 읽기', A.ref('ws/pending').once('value'));
await no('비회원 스스로 회원 되기', B.ref('ws/members/b').set({ name: 'B', email: 'b@x.com' }));
await ok('관리자 승인', A.ref('ws').update({ 'members/b': { name: '비', email: 'b@x.com' }, 'pending/b': null }));
await ok('승인 후 config 읽기', B.ref('ws/config/space').once('value'));
await no('일반 회원이 이름 바꾸기', B.ref('ws/members/b/name').set('바뀜'));
await no('일반 회원이 남 내보내기', B.ref('ws/members/a').remove());
await no('일반 회원이 관리자 되기(비번 없이)', B.ref('ws/admins/b').set(true));
await no('일반 회원이 초대 만들기', B.ref('ws/invites/aaaaaaaaaaaaaaaaaaaaaaaa').set({ name: 'z', expires: Date.now() + 1e6 }));
await no('일반 회원이 초대 목록 보기', B.ref('ws/invites').once('value'));
await ok('기존 회원이 관리자 비번으로 관리자 되기', B.ref('ws').update({ 'adminTry/b': AK, 'admins/b': true }));
await ok('관리자가 관리자 해제', A.ref('ws/admins/b').remove());
// 초대 링크
const code = 'Abcdefghijklmnopqrstuvwx';
await ok('관리자 초대 만들기', A.ref('ws/invites/' + code).set({ name: '씨', expires: Date.now() + 7 * 864e5, by: '관리' }));
await no('초대 이름과 다른 이름으로 가입', C.ref('ws').update({ ['members/c']: { name: '가짜', email: 'c@x.com', invite: code }, [`invites/${code}/usedBy`]: 'c' }));
await no('usedBy 없이 가입', C.ref('ws/members/c').set({ name: '씨', email: 'c@x.com', invite: code }));
await ok('초대 링크로 가입', C.ref('ws').update({ ['members/c']: { name: '씨', email: 'c@x.com', invite: code }, [`invites/${code}/usedBy`]: 'c', 'pending/c': null }));
await no('같은 초대 링크 다시 쓰기', X.ref('ws').update({ ['members/x']: { name: '씨', email: 'x@x.com', invite: code }, [`invites/${code}/usedBy`]: 'x' }));
const old = 'Zbcdefghijklmnopqrstuvwx';
await ok('관리자 만료된 초대 만들기(시험용)', A.ref('ws/invites/' + old).set({ name: '엑스', expires: Date.now() - 1000 }));
await no('만료된 초대로 가입', X.ref('ws').update({ ['members/x']: { name: '엑스', email: 'x@x.com', invite: old }, [`invites/${old}/usedBy`]: 'x' }));
await no('초대 코드 짧으면 안 됨', A.ref('ws/invites/short').set({ name: 'z', expires: 1 }));

// ---------- Band 게시판 ----------
await ok('관리자가 B 다시 승인(게시판 시험용)', A.ref('ws/members/b').once('value'));
const P = 'post1';
await no('비회원 게시판 읽기', X.ref('board').once('value'));
await no('로그인 안 함 게시판 읽기', anon.ref('board').once('value'));
await ok('회원 게시판 읽기', B.ref('board').once('value'));
await ok('회원 글쓰기', B.ref('board/posts/' + P).set({ cat: 'notice', text: '안녕하세요', uid: 'b', name: '비', at: 1000 }));
await no('남의 이름으로 글쓰기', B.ref('board/posts/p2').set({ cat: 'notice', text: 'x', uid: 'b', name: '관리', at: 1 }));
await no('남인 척 글쓰기(uid)', B.ref('board/posts/p3').set({ cat: 'notice', text: 'x', uid: 'a', name: '관리', at: 1 }));
await no('없는 게시판 종류', B.ref('board/posts/p4').set({ cat: 'xxx', text: 'x', uid: 'b', name: '비', at: 1 }));
await no('빈 글', B.ref('board/posts/p5').set({ cat: 'notice', text: '', uid: 'b', name: '비', at: 1 }));
await no('비회원 글쓰기', X.ref('board/posts/p6').set({ cat: 'notice', text: 'x', uid: 'x', name: 'x', at: 1 }));
await ok('쓴 사람 글 고치기', B.ref('board/posts/' + P + '/text').set('고친 글'));
await ok('관리자 남의 글 고치기', A.ref('board/posts/' + P + '/text').set('관리자가 고침'));
await ok('쓴 사람 글 지우기 표시(휴지통)', B.ref('board/posts/' + P + '/deleted').set({ by: 'b', at: 2 }));
await no('글쓴이 바꾸기', B.ref('board/posts/' + P + '/name').set('관리'));
await no('글 아예 지우기(휴지통 없이)', B.ref('board/posts/' + P).remove());
await ok('관리자 남의 글 지우기 표시', A.ref('board/posts/' + P + '/deleted').set({ by: 'a', at: 3 }));
await ok('회원 댓글', A.ref('board/comments/' + P + '/c1').set({ uid: 'a', name: '관리', text: '확인했어요', at: 5 }));
await ok('댓글 수 늘리기(다른 회원)', A.ref('board/posts/' + P + '/commentCount').set(1));
await no('없는 글에 댓글', A.ref('board/comments/nopost/c1').set({ uid: 'a', name: '관리', text: 'x', at: 5 }));
await no('남의 이름으로 댓글', A.ref('board/comments/' + P + '/c2').set({ uid: 'a', name: '비', text: 'x', at: 5 }));
await no('남의 댓글 고치기', B.ref('board/comments/' + P + '/c1/text').set('바꿈'));
await no('남의 댓글 지우기(일반 회원)', B.ref('board/comments/' + P + '/c1').remove());
await ok('쓴 사람 댓글 지우기', A.ref('board/comments/' + P + '/c1').remove());
// 내보내기
await ok('관리자가 내보내기', A.ref('ws/members/c').remove());
await no('내보낸 사람 config 읽기', C.ref('ws/config').once('value'));
await no('내보낸 사람 명단 읽기', C.ref('ws/members').once('value'));
// 기존 스케줄 (데스크톱 앱용 길, 전환 전까지 열려 있음)
await ok('기존 스케줄 길 (로그인 없이) — 전환 전까지 유지', anon.ref('spaces/' + SPACE + '/data').once('value'));
console.log(`\n시험 ${n}개 중 ${n - bad}개 통과`);
await env.cleanup();
process.exit(bad ? 1 : 0);
