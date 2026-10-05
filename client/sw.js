const CACHE_NAME = 'spendly-cache-v7';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/badge.png',
  '/css/variables.css',
  '/css/main.css',
  '/css/components.css',
  '/css/views.css',
  '/js/idb.js',
  '/js/api.js',
  '/js/ws.js',
  '/js/store.js',
  '/js/router.js',
  '/js/views/authView.js',
  '/js/views/ownExpensesView.js',
  '/js/views/splitItView.js',
  '/js/views/billView.js',
  '/js/views/analyticsView.js',
  '/js/imageViewer.js',
  '/js/views/profileView.js',
  '/js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Network-first strategy for API requests, Cache-first with network fallback for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Do not cache API or WebSocket requests
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in background
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request).catch(() => caches.match('/index.html'));
    })
  );
});

// Web Push Notification handler
self.addEventListener('push', (event) => {
  let data = { title: 'Spendly Alert', body: 'You have a new update in Spendly.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge.png',
    vibrate: [100, 50, 100],
    data: data.data || {}
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
