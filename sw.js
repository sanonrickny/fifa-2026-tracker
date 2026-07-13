// Service worker: cache the app shell so the app installs to the home screen
// and opens instantly (with the last localStorage-cached scores) when offline.
// Network-first so a deploy shows up on the next load, cache is the fallback.
const CACHE = 'rickcup-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'data.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Same-origin GETs only: ESPN API calls pass straight through (live data is
  // never served stale; offline scores come from localStorage, not the cache).
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Clicking a notification focuses (or opens) the app.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list =>
      list.length ? list[0].focus() : self.clients.openWindow('./')
    )
  );
});
