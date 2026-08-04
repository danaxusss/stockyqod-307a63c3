/**
 * Force the browser onto the freshly deployed build.
 *
 * A tab left open across a deploy still references the chunk names from the
 * build it loaded. Lazily-imported chunks (the PDF engine, for instance) are
 * fetched only when first used, so the failure surfaces long after the deploy
 * — as "Failed to fetch dynamically imported module". An older service worker
 * that cached assets can keep serving stale files too.
 *
 * Unregistering the service worker and clearing its caches before reloading
 * clears both cases.
 */
export async function hardReloadApp(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(() => false)));
    }
  } catch { /* not fatal — carry on to the cache purge */ }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
    }
  } catch { /* not fatal */ }

  // Cache-busting query so the HTML itself is refetched, not read from cache.
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now().toString(36));
  window.location.replace(url.toString());
}
