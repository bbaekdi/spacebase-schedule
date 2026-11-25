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

// ---------- 현장 방 + A/S 처리 상태 ----------
await ok('프로젝트(현장) 글쓰기', B.ref('board/posts/proj1').set({ cat: 'project', siteName: '테스트현장', text: '새 프로젝트', uid: 'b', name: '비', at: 10 }));
await no('현장 이름 없는 프로젝트', B.ref('board/posts/proj2').set({ cat: 'project', text: 'x', uid: 'b', name: '비', at: 10 }));
await ok('현장 고른 A/S 글', B.ref('board/posts/as1').set({ cat: 'as', site: 'proj1', siteName: '테스트현장', text: '실리콘 들뜸', uid: 'b', name: '비', at: 11, asState: { status: 'new', by: '비', at: 11 } }));
await no('현장 이름 없이 현장만', B.ref('board/posts/as2').set({ cat: 'as', site: 'proj1', text: 'x', uid: 'b', name: '비', at: 11 }));
await ok('다른 회원이 A/S 상태 바꾸기', A.ref('board/posts/as1/asState').set({ status: 'doing', owner: '관리', by: '관리', at: 12 }));
await no('A/S 상태 남의 이름으로', A.ref('board/posts/as1/asState').set({ status: 'done', by: '비', at: 13 }));
await no('없는 A/S 상태', A.ref('board/posts/as1/asState').set({ status: 'xxx', by: '관리', at: 13 }));
await no('A/S 가 아닌 글에 상태', A.ref('board/posts/proj1/asState').set({ status: 'new', by: '관리', at: 13 }));
await no('비회원 A/S 상태 바꾸기', X.ref('board/posts/as1/asState').set({ status: 'done', by: 'x', at: 13 }));
await ok('쓴 사람이 현장 끝남 표시', B.ref('board/posts/proj1/closed').set(true));

// ---------- 자동 양식 ----------
await ok('양식 있는 프로젝트', B.ref('board/posts/proj3').set({ cat: 'project', siteName: '테스트 오피스', text: '1. 발주처명 _ 테스트', form: { client: '테스트', type: '오피스', phone: '010-0000-0000' }, uid: 'b', name: '비', at: 20 }));
await ok('현장 직접 입력 A/S (현장 방 없이 이름만)', B.ref('board/posts/as3').set({ cat: 'as', siteName: '직접쓴현장', text: '요청', uid: 'b', name: '비', at: 21, asState: { status: 'new', owner: '김가나 책임, 이다라 팀장', by: '비', at: 21 } }));
await no('현장 이름 너무 김', B.ref('board/posts/as4').set({ cat: 'as', siteName: 'x'.repeat(41), text: '요청', uid: 'b', name: '비', at: 21 }));
await no('양식 칸이 글자가 아님', B.ref('board/posts/proj4').set({ cat: 'project', siteName: 'x', text: 'x', form: { client: 5 }, uid: 'b', name: '비', at: 20 }));
await no('양식 칸 너무 김', B.ref('board/posts/proj5').set({ cat: 'project', siteName: 'x', text: 'x', form: { etc: 'x'.repeat(2001) }, uid: 'b', name: '비', at: 20 }));

// ---------- 읽음 확인 + 휴지통 ----------
await ok('글 읽음 기록 (나)', B.ref('board').update({ 'reads/proj1/b': 30, 'myreads/b/proj1': 30 }));
await no('남 대신 읽음 기록', B.ref('board/reads/proj1/a').set(30));
await no('남의 내 기록 쓰기', B.ref('board/myreads/a/proj1').set(30));
await no('비회원 읽음 기록', X.ref('board/reads/proj1/x').set(30));
await ok('회원은 읽은 사람 목록 봄', A.ref('board/reads/proj1').once('value'));
await ok('휴지통으로 (삭제 표시)', B.ref('board/posts/proj3/deleted').set({ by: 'b', name: '비', at: 40 }));
await ok('쓴 사람이 되돌리기', B.ref('board/posts/proj3/deleted').remove());
await ok('다시 휴지통으로', B.ref('board/posts/proj3/deleted').set({ by: 'b', name: '비', at: 41 }));
await no('일반 회원 완전 삭제', B.ref('board/posts/proj3').remove());
await no('관리자도 휴지통에 없는 글은 완전 삭제 못 함', A.ref('board/posts/proj1').remove());
await ok('관리자 완전 삭제 (글·댓글·읽음 기록 함께)', A.ref('board').update({ 'posts/proj3': null, 'comments/proj3': null, 'reads/proj3': null }));
await ok('A/S 글에 댓글', A.ref('board/comments/as1/c9').set({ uid: 'a', name: '관리', text: '확인', at: 50 }));
await no('휴지통에 없는 글의 댓글 통째 삭제', A.ref('board/comments/as1').remove());
// 내보내기
await ok('관리자가 내보내기', A.ref('ws/members/c').remove());
await no('내보낸 사람 config 읽기', C.ref('ws/config').once('value'));
await no('내보낸 사람 명단 읽기', C.ref('ws/members').once('value'));
// 기존 스케줄 (데스크톱 앱용 길, 전환 전까지 열려 있음)
await ok('기존 스케줄 길 (로그인 없이) — 전환 전까지 유지', anon.ref('spaces/' + SPACE + '/data').once('value'));
console.log(`\n시험 ${n}개 중 ${n - bad}개 통과`);
await env.cleanup();
process.exit(bad ? 1 : 0);
