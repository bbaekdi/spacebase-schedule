// 밴드 iCal(구독 주소) → 일정 목록 변환. 서버(calendar.js, tools/sync-band.js)와 브라우저(ws-common.js)가 같이 쓴다.
// 브라우저에서는 vendor/ical.min.js 를 먼저 불러야 한다 (window.ICAL).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('ical.js'));
  else root.BandIcs = factory(root.ICAL);
})(typeof self !== 'undefined' ? self : this, function (ICAL) {
// 일정 고유 번호 (서버·브라우저 어디서 계산해도 같은 값)
function key(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (const ch of String(s)) { const c = ch.codePointAt(0); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function normalizeIcalUrl(raw) {
  if (!raw) return '';
  const url = String(raw).trim().replace(/^webcal:/i, 'https:');
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'api.band.us' || u.pathname !== '/ical') {
    throw new Error('밴드 캘린더 구독 주소(webcal://api.band.us/ical?...) 형식이 아닙니다.');
  }
  return u.toString();
}

// 시간대 정보가 없는 시간(종일 일정, 떠 있는 시간, 등록 안 된 TZID)은 한국 시간으로 본다.
// 서버가 해외(UTC)에 있어도 날짜가 하루 밀리지 않게 하기 위함.
const KST_MS = 9 * 3600 * 1000;
function toDate(t) {
  const zone = t.zone && t.zone.tzid;
  const known = zone === 'UTC' || (zone && zone !== 'floating' && ICAL.TimezoneService.has(zone));
  if (!t.isDate && known) return t.toJSDate();
  return new Date(Date.UTC(t.year, t.month - 1, t.day, t.isDate ? 0 : t.hour, t.isDate ? 0 : t.minute, t.isDate ? 0 : t.second) - KST_MS);
}

// 밴드 데스크톱 캘린더와 같은 방식: 반복 일정, 제외일, 수정 예외, 취소 일정 처리
function parseIcs(text, from, to, linkUrl) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz.getFirstPropertyValue('tzid'), new ICAL.Timezone(tz)); } catch {}
  }
  const groups = new Map();
  for (const c of root.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(c);
    if (!groups.has(e.uid)) groups.set(e.uid, []);
    groups.get(e.uid).push(e);
  }
  const out = [];
  for (const [uid, list] of groups) {
    const master = list.find((x) => !x.isRecurrenceException());
    if (!master || master.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    for (const ex of list.filter((x) => x.isRecurrenceException())) master.relateException(ex);
    const add = (start, end, item) => {
      if (item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
      const s = toDate(start), e = toDate(end);
      if (e <= s) e.setTime(s.getTime() + 1000);
      if (s < to && e > from) {
        out.push({
          id: 'band:' + key(uid + start.toString()), title: item.summary || '제목 없는 일정',
          start: s.toISOString(), end: e.toISOString(), allDay: start.isDate, source: 'band',
          description: item.description || '', location: item.location || '', url: linkUrl || '',
        });
      }
    };
    if (master.isRecurring()) {
      const it = master.iterator();
      let next, n = 0;
      while ((next = it.next()) && n++ < 30000) {
        if (toDate(next) >= to) break;
        const d = master.getOccurrenceDetails(next);
        add(d.startDate, d.endDate, d.item);
      }
    } else add(master.startDate, master.endDate, master);
  }
  return out;
}

return { parseIcs, normalizeIcalUrl, key };
});
