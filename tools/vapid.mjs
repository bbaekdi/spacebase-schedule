// 알림 열쇠(VAPID) 만들기: GitHub Secret FIREBASE_SERVICE_ACCOUNT 에서 항상 같은 열쇠를 만들어 낸다 (따로 Secret 필요 없음).
// node tools/vapid.mjs public  → 공개 열쇠 (사이트에 넣음, 비밀 아님)
// node tools/vapid.mjs private → 비밀 열쇠 JWK (Cloudflare 중계 Secret 으로만, 화면에 찍지 말 것)
import { createHmac, createECDH } from 'crypto';
let sa;
try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ''); } catch { sa = null; }
if (!sa || !sa.private_key) { console.error('FIREBASE_SERVICE_ACCOUNT 가 없습니다.'); process.exit(1); }
const N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551'); // P-256 차수
const h = BigInt('0x' + createHmac('sha256', sa.private_key).update('spacebase-vapid-v1').digest('hex'));
const d = Buffer.from(((h % (N - 1n)) + 1n).toString(16).padStart(64, '0'), 'hex');
const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(d);
const pub = ecdh.getPublicKey(); // 65 바이트 (0x04 + x + y)
const u = (b) => Buffer.from(b).toString('base64url');
if (process.argv[2] === 'public') process.stdout.write(u(pub));
else if (process.argv[2] === 'private') process.stdout.write(JSON.stringify({ kty: 'EC', crv: 'P-256', d: u(d), x: u(pub.subarray(1, 33)), y: u(pub.subarray(33)) }));
else { console.error('public 또는 private'); process.exit(1); }
