/* MeRun-MeTrail - service worker
   Strategie : cache-first sur la coquille de l'appli (tout est local).
   Les donnees d'entrainement vivent dans localStorage. */
const CACHE = 'merun-v4.8.1';
const SHELL = ['./','./index.html','./app.js','./data/plan.js','./manifest.webmanifest','./vendor/jszip.min.js','./fonts/fonts.css',
  './icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-192.png','./icons/maskable-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const css = await (await fetch('./fonts/fonts.css')).text();
    const fonts = [...css.matchAll(/url\(\.\/([^)]+\.woff2)\)/g)].map(m => './fonts/' + m[1]);
    await Promise.all([...new Set(fonts)].map(u => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // navigation hors ligne -> on sert la coquille
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
