// 밴드 캘린더 → Firebase 옮기기 (GitHub Actions 가 15분마다 실행)
// 서버 없이 쓰는 웹사이트(GitHub Pages)에서도 밴드 일정이 보이도록,
// 밴드 구독 주소를 읽어 Firebase 의 spaces/<회사 비밀번호 해시>/band 에 넣는다.
//
// 필요한 GitHub 저장소 Secrets (Settings → Secrets and variables → Actions):
//   BAND_ICAL_URL : 밴드 캘린더 구독 주소 (webcal://api.band.us/ical?...)
//   SB_CODE       : 주간 스케줄에서 쓰는 회사 비밀번호
//   BAND_URL      : (선택) "밴드에서 보기" 를 눌렀을 때 열 주소
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseIcs, normalizeIcalUrl } = require('../calendar.js');

async function main() {
  const rawUrl = process.env.BAND_ICAL_URL, code = process.env.SB_CODE;
  if (!rawUrl || !code) {
    console.log('BAND_ICAL_URL 또는 SB_CODE 가 설정되지 않아 건너뜁니다. (저장소 Settings → Secrets 에서 설정)');
    return;
  }
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'public', 'firebase-config.js'), 'utf8');
  const dbUrl = (cfg.match(/databaseURL:\s*['"]([^'"]+)['"]/) || [])[1];
  if (!dbUrl) throw new Error('public/firebase-config.js 에서 databaseURL 을 찾지 못했습니다.');
  const key = crypto.createHash('sha256').update('spacebase:' + code.trim()).digest('hex');
  const target = `${dbUrl.replace(/\/$/, '')}/spaces/${key}/band.json`;

  let body;
  try {
    const r = await fetch(normalizeIcalUrl(rawUrl), { signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error('밴드 응답 오류 ' + r.status);
    const now = Date.now();
    const events = parseIcs(await r.text(), new Date(now - 100 * 864e5), new Date(now + 400 * 864e5), process.env.BAND_URL || 'https://www.band.us');
    body = { events, count: events.length, lastSync: new Date(now).toISOString(), error: '' };
    console.log(`밴드 일정 ${events.length}개를 읽었습니다.`);
  } catch (e) {
    // 실패하면 이전 일정은 그대로 두고 오류 메시지만 남긴다
    console.error('밴드 일정 읽기 실패:', e.message);
    await fetch(target.replace(/band\.json$/, 'band/error.json'), { method: 'PUT', body: JSON.stringify('밴드 일정을 새로 읽지 못했어요 (이전 내용 표시 중)') });
    process.exitCode = 1;
    return;
  }
  const w = await fetch(target, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  if (!w.ok) throw new Error('Firebase 저장 실패 ' + w.status + ' ' + (await w.text()).slice(0, 200));
  console.log('Firebase 에 저장했습니다.');
}
main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
