// Service worker de la prueba: guarda la "cáscara" de la app para comprobar que abre sin conexión.
const CACHE = 'fase0-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/config.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // Las mediciones (API, payload, sondas) nunca salen de caché.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/api-') || url.pathname.startsWith('/assets/') || url.pathname === '/probe.png') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
