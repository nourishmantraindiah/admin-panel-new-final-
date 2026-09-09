/* Service worker for the admin panel's push notifications.
   Kept deliberately small: it only receives pushes and focuses the panel when
   one is clicked. It does not cache anything — an admin panel showing stale
   fee balances or attendance from a cache would be worse than useless. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { title: 'Byte Morphix Admin', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Byte Morphix Admin';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    // Grouping by event type means ten new leads collapse into one entry
    // rather than burying the notification tray.
    tag: payload.event || 'general',
    renotify: true,
    timestamp: Date.now(),
    data: { link: payload.link || '/', id: payload.id || null },
    actions: [{ action: 'open', title: 'Open panel' }]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  const target = link.startsWith('http') ? link : self.location.origin + (link.startsWith('#') ? '/' + link : link);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Reuse an already-open panel tab instead of piling up new ones.
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
