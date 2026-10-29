/* PEAK PWA: static navigation fallback only. API responses and secrets are never cached. */
const CACHE = 'peak-static-v1';
const SHELL = ['/', '/styles.css', '/expedition.css', '/cloud.css', '/themes.css', '/app.js', '/peakmap-schedule.js', '/setup-guide.js', '/peakmap-campfires.js', '/icons/peak-icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('peak-static-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  // Never cache personalized URLs, query strings, or documents that may contain access tokens.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('/')) || Response.error();
    }));
    return;
  }
  if (!SHELL.includes(url.pathname) || url.search) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(req);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        await cache.put(url.pathname, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(url.pathname)) || Response.error();
    }
  })());
});
