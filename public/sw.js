// Stocky QOD — Service Worker
// Strategy: network-first for everything, offline fallback for navigation only.
// We do NOT cache JS/CSS chunks — Vite already does content-addressing with hashes,
// and caching them causes stale module errors after deploys.

const CACHE_NAME = 'stocky-shell-v2';
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
