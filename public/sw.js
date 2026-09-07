/* Notifications only: private API responses and messages are never cached. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    /* Generic notification below. */
  }
  event.waitUntil(
    self.registration.showNotification(String(data.title || 'Noctgram'), {
      body: String(data.body || 'Новое уведомление'),
      icon: '/assets/noctgram-logo.png',
      tag: String(data.tag || 'noctgram'),
      data: { url: data.url || '/' },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      let url;
      try {
        url = new URL(
          event.notification.data?.url || '/',
          self.location.origin,
        );
      } catch {
        return;
      }
      if (url.origin !== self.location.origin) return;
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const client = windows.find(
        (w) => new URL(w.url).origin === self.location.origin,
      );
      if (client) {
        await client.navigate(url.href);
        await client.focus();
      } else await self.clients.openWindow(url.href);
    })(),
  );
});
