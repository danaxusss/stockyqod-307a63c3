const CACHE_NAME = 'stocky-v1';
const STATIC_ASSETS = ['/'];

// On install — cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// On activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - Navigation requests (HTML): network-first, fall back to cached index.html
// - Static assets (JS/CSS/images): cache-first
// - API/Supabase requests: network-only (never cache)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip Supabase, OpenRouter, and other external API calls
  if (
    url.hostname.includes('supabase') ||
    url.hostname.includes('openrouter') ||
    url.hostname.includes('storage.googleapis') ||
    request.method !== 'GET'
  ) {
    return;
  }

  // Navigation (HTML pages) — network-first, fall back to cached /
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('/').then(r => r || new Response('Hors ligne', { status: 503 })))
    );
    return;
  }

  // Static assets — cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
