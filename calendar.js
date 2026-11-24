// 회사 밴드 캘린더 (웹 버전)
// - 밴드 공식 캘린더 "구독 주소"(webcal://api.band.us/ical?...)를 서버가 10분마다 읽어 일정으로 바꾼다.
// - 웹에서 직접 추가한 일정(모두에게 공유)은 DATA_DIR/calendar.json 에 저장한다.
// 구독 주소는 비밀번호와 같으므로 저장소에 적지 말고 서버 환경변수 BAND_ICAL_URL 에만 넣는다.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ICAL = require('ical.js');

const REFRESH_MS = 10 * 60 * 1000;
const key = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 20);

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

function createCalendar({ dataDir }) {
  const FILE = path.join(dataDir, 'calendar.json');
  let store = { items: [] };
  try { if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.warn('calendar.json 을 읽지 못했습니다:', e.message); }
  store.items = Array.isArray(store.items) ? store.items : [];
  function save() {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
    fs.renameSync(tmp, FILE);
  }

  let icalUrl = '';
  let configError = '';
  try { icalUrl = normalizeIcalUrl(process.env.BAND_ICAL_URL); } catch (e) { configError = e.message; }
  const linkUrl = process.env.BAND_URL || 'https://www.band.us';

  const cache = { events: [], at: 0, error: '', loading: null };
  async function refresh() {
    if (!icalUrl) return;
    if (cache.loading) return cache.loading;
    cache.loading = (async () => {
      try {
        const r = await fetch(icalUrl, { signal: AbortSignal.timeout(25000) });
        if (!r.ok) throw new Error('밴드 응답 오류 ' + r.status);
        const now = Date.now();
        cache.events = parseIcs(await r.text(), new Date(now - 100 * 864e5), new Date(now + 400 * 864e5), linkUrl);
        cache.at = now;
        cache.error = '';
      } catch (e) {
        cache.error = '밴드 일정을 새로 읽지 못했어요 (이전 내용 표시 중): ' + (e.message || e);
        console.warn(cache.error);
      } finally { cache.loading = null; }
    })();
    return cache.loading;
  }
  if (icalUrl) { refresh(); setInterval(refresh, REFRESH_MS).unref(); }

  function status() {
    return {
      bandConnected: !!icalUrl, configError, error: cache.error,
      lastSync: cache.at ? new Date(cache.at).toISOString() : null, bandCount: cache.events.length,
      bandUrl: process.env.BAND_URL || '',
    };
  }

  async function events(fromIso, toIso) {
    if (icalUrl && !cache.at) await refresh();
    const from = new Date(fromIso || Date.now() - 40 * 864e5), to = new Date(toIso || Date.now() + 80 * 864e5);
    const inRange = (e) => new Date(e.start) < to && new Date(e.end) > from;
    const all = [...cache.events.filter(inRange), ...store.items.filter(inRange)];
    all.sort((a, b) => a.start.localeCompare(b.start));
    return { events: all, status: status() };
  }

  function cleanItem(body, user) {
    const title = String(body.title || '').trim().slice(0, 100);
    if (!title) throw new Error('제목을 입력해 주세요.');
    const s = new Date(body.start), e = new Date(body.end || body.start);
    if (isNaN(s) || isNaN(e)) throw new Error('날짜를 확인해 주세요.');
    if (e < s) throw new Error('끝나는 시간이 시작보다 빠릅니다.');
    const allDay = !!body.allDay;
    if (allDay && e.getTime() === s.getTime()) e.setTime(s.getTime() + 864e5);
    return {
      title, start: s.toISOString(), end: e.toISOString(), allDay,
      description: String(body.description || '').slice(0, 2000), location: String(body.location || '').slice(0, 200),
      color: /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '',
      by: user.name, byId: user.id, updatedAt: new Date().toISOString(),
    };
  }

  function addItem(body, user) {
    const item = { id: 'web:' + crypto.randomBytes(8).toString('hex'), source: 'web', ...cleanItem(body, user) };
    store.items.push(item);
    save();
    return item;
  }
  function updateItem(id, body, user) {
    const i = store.items.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('일정을 찾을 수 없습니다.');
    store.items[i] = { ...store.items[i], ...cleanItem(body, user) };
    save();
    return store.items[i];
  }
  function deleteItem(id) {
    const n = store.items.length;
    store.items = store.items.filter((x) => x.id !== id);
    if (store.items.length === n) throw new Error('일정을 찾을 수 없습니다.');
    save();
  }

  return { events, status, refresh, addItem, updateItem, deleteItem };
}

module.exports = { createCalendar, parseIcs, normalizeIcalUrl };
