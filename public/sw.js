// 서비스 워커: 휴대폰에 앱처럼 설치 + 새 글 알림 받기
// 화면 파일은 따로 저장해 두지 않는다(항상 최신 화면). 알림만 다룬다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SPACEBASE', {
    body: d.body || 'Band 에 새 글이 올라왔어요.',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: d.tag || 'band',
    data: { url: d.url || 'band.html' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || 'band.html', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = all.find((c) => c.url.startsWith(self.registration.scope));
    if (same) { await same.focus(); return same.navigate(url).catch(() => self.clients.openWindow(url)); }
    return self.clients.openWindow(url);
  })());
});
