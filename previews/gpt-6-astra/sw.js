// Cache only the named application assets. Never cache an API request,
// conversation, arbitrary same-origin response, or exported transcript.
const CACHE = 'still-shell-v1-' + self.registration.scope;
const ASSETS = ['./', './index.html', './styles.css', './main.js', './icons.js',
  './storage.js', './engine.js', './local.worker.js', './icon.svg'];
const allowed = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !allowed.has(event.request.url)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(event.request, { cacheName: CACHE });
    return cached || Response.error();
  }));
});
