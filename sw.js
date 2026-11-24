/* Работа без интернета: страница и файлы приложения сначала из сети (обновления приходят сразу),
   без сети или если сеть молчит 3 с, из кеша. Шрифты Google и библиотека Firebase из кеша, обновляются в фоне.
   Служебные адреса входа Firebase (/__/) и запросы к базе не трогаем. */
const CACHE = 'tabata-v4';
const CORE = ['./', './cloud.js', './firebase-config.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const START = new URL('./', self.registration.scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(key, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(key, copy));
  }
  return res;
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
function staleWhileRevalidate(req) {
  return caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => put(req, res)).catch(() => hit);
    return hit || net;
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/__/')) return;
    const isStart = req.mode === 'navigate' && (url.pathname === START || url.pathname === START + 'index.html');
    if (req.mode === 'navigate' && !isStart) return;
    const key = isStart ? './' : req;
    e.respondWith(
      withTimeout(fetch(isStart ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : req).then((res) => put(key, res)), 3000)
        .catch(() => caches.match(key, { ignoreSearch: true }).then((hit) => hit || fetch(req)))
    );
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
    || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))) {
    e.respondWith(staleWhileRevalidate(req));
  }
});
