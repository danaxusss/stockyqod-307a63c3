// Stocky QOD — Service Worker
// Strategy: network-first for everything, offline fallback for navigation only.
// We do NOT cache JS/CSS chunks — Vite already does content-addressing with hashes,
// and caching them causes stale module errors after deploys.

const CACHE_NAME = 'stocky-shell-v3';
const SHELL_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.add(SHELL_URL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET navigation requests (HTML pages)
  // Everything else (JS chunks, CSS, API calls) goes straight to network
  if (request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request)
      .then(response => {
        // Cache the fresh HTML shell on success
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(SHELL_URL, clone));
        return response;
      })
      .catch(() =>
        // Offline fallback: serve the cached shell
        caches.match(SHELL_URL).then(r => r || new Response('Hors ligne', { status: 503 }))
      )
  );
});

// ===== Web Push (Tasks / Delivery module) =====

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Notification', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Notification';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: data.tag || data.task_id || undefined,
    renotify: !!data.tag || !!data.task_id,
    requireInteraction: !!data.requireInteraction,
    data: { url: data.url || '/tasks', task_id: data.task_id || null },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/tasks';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      // Focus an existing tab if one is open, otherwise open a new one.
      const existing = clientsArr.find(c => 'focus' in c);
      if (existing) {
        existing.navigate(targetUrl).catch(() => {});
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
