// 밴드 캘린더 중계 (Cloudflare Workers, DB 없음)
// 웹사이트(GitHub Pages)는 밴드 구독 주소를 직접 알 수 없으므로(공개 저장소), 이 중계가 대신 밴드에서 최신 iCal 을 받아 준다.
// 회사 비밀번호 해시(X-SB-Key: sha256('spacebase:' + 회사 비밀번호))가 맞을 때만 돌려준다. 파싱은 브라우저(public/band-ics.js)가 한다.
// Secrets: BAND_ICAL_URL, SB_CODE (GitHub Secrets → .github/workflows/band-worker.yml 이 넣어 줌)

import { google } from './google.js';
import { push } from './push.js';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

// 개인 구글 캘린더(비공개 iCal 주소) 중계. 주소는 각자 브라우저에만 저장되고, 여기서는 받아서 전달만 한다 (저장·기록 안 함).
// 구글 캘린더는 다른 사이트에서 직접 읽을 수 없게(CORS) 막혀 있어서 중계가 필요하다.
async function gcal(req, env, reply) {
  if (req.method !== 'POST') return reply('POST only', 405);
  if (!env.SB_CODE || (req.headers.get('X-SB-Key') || '') !== (await sha256('spacebase:' + env.SB_CODE.trim()))) return reply('forbidden', 403);
  let u;
  try { u = new URL(String((await req.json()).url || '').trim().replace(/^webcal:/i, 'https:')); } catch { return reply('주소 형식이 아닙니다.', 400); }
  if (u.protocol !== 'https:' || u.hostname !== 'calendar.google.com' || !u.pathname.startsWith('/calendar/ical/') || !u.pathname.endsWith('.ics')) {
    return reply('구글 캘린더 iCal 주소(https://calendar.google.com/calendar/ical/.../basic.ics)가 아닙니다.', 400);
  }
  const r = await fetch(u.toString(), { cache: 'no-store', redirect: 'follow' });
  if (!r.ok) return reply('구글 캘린더 응답 오류 ' + r.status + (r.status === 404 ? ' (주소가 바뀌었거나 잘못됐어요)' : ''), 502);
  return reply(await r.text(), 200, 'text/calendar; charset=utf-8');
}

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'X-SB-Key, X-G-Token, Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    const reply = (body, status = 200, type = 'text/plain; charset=utf-8') =>
      new Response(body, { status, headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (url.pathname === '/gcal') return gcal(req, env, reply);
    if (url.pathname.startsWith('/google/')) return google(req, env, url, reply);
    if (url.pathname.startsWith('/push/')) return push(req, env, url, reply);
    if (url.pathname !== '/ics') return reply('SPACEBASE band relay');
    if (!env.BAND_ICAL_URL || !env.SB_CODE) return reply('밴드 중계 설정이 아직 없습니다.', 503);
    if ((req.headers.get('X-SB-Key') || '') !== (await sha256('spacebase:' + env.SB_CODE.trim()))) return reply('forbidden', 403);
    const u = new URL(env.BAND_ICAL_URL.trim().replace(/^webcal:/i, 'https:'));
    if (u.hostname !== 'api.band.us' || u.pathname !== '/ical') return reply('밴드 구독 주소 형식이 아닙니다.', 500);
    // 중간 저장(캐시)된 옛 내용이 오지 않도록 매번 밴드에서 새로 받는다
    const r = await fetch(u.toString(), { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
    if (!r.ok) return reply('밴드 응답 오류 ' + r.status, 502);
    const res = reply(await r.text(), 200, 'text/calendar; charset=utf-8');
    // 확인용: 밴드가 보낸 캐시 관련 정보
    const info = ['age', 'cache-control', 'last-modified', 'date', 'cf-cache-status', 'etag'].map((h) => h + '=' + (r.headers.get(h) || '')).join('; ');
    res.headers.set('X-Band-Info', info);
    res.headers.set('Access-Control-Expose-Headers', 'X-Band-Info');
    return res;
  },
};
