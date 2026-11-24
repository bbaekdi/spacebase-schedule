// 밴드 캘린더 중계 (Cloudflare Workers, DB 없음)
// 웹사이트(GitHub Pages)는 밴드 구독 주소를 직접 알 수 없으므로(공개 저장소), 이 중계가 대신 밴드에서 최신 iCal 을 받아 준다.
// 회사 비밀번호 해시(X-SB-Key: sha256('spacebase:' + 회사 비밀번호))가 맞을 때만 돌려준다. 파싱은 브라우저(public/band-ics.js)가 한다.
// Secrets: BAND_ICAL_URL, SB_CODE (GitHub Secrets → .github/workflows/band-worker.yml 이 넣어 줌)

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'X-SB-Key',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    const reply = (body, status = 200, type = 'text/plain; charset=utf-8') =>
      new Response(body, { status, headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (url.pathname !== '/ics') return reply('SPACEBASE band relay');
    if (!env.BAND_ICAL_URL || !env.SB_CODE) return reply('밴드 중계 설정이 아직 없습니다.', 503);
    if ((req.headers.get('X-SB-Key') || '') !== (await sha256('spacebase:' + env.SB_CODE.trim()))) return reply('forbidden', 403);
    const u = new URL(env.BAND_ICAL_URL.trim().replace(/^webcal:/i, 'https:'));
    if (u.hostname !== 'api.band.us' || u.pathname !== '/ical') return reply('밴드 구독 주소 형식이 아닙니다.', 500);
    const r = await fetch(u.toString(), { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return reply('밴드 응답 오류 ' + r.status, 502);
    return reply(await r.text(), 200, 'text/calendar; charset=utf-8');
  },
};
