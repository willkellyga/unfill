// Unfill's service worker, filled in at build time by the `pwa` plugin in vite.config.ts. It keeps every file of
// the game in a cache so the home-screen app opens and plays with no connection.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `unfill-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('unfill-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first, then the network. Test links (?tray=12, ?nosave) get the same cached page. A page that was never
// cached (the 2D lab before a visit, say) still loads from the network when there is one.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // ignoreVary: a module script asks with an Origin header, and some hosts answer with Vary: Origin
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === 'navigate') {
          const page = await cache.match('./');
          if (page) return page;
        }
        throw err;
      }
    })(),
  );
});
