/*
 * FocusPath service worker.
 *
 * It makes the app installable and quick to open, and nothing more. It caches
 * exactly two things: the app shell (index.html) and Vite's hashed files under
 * /assets/. Every other request goes to the network untouched — the API above
 * all. Habits, profiles and sessions are one person's data, served
 * same-origin in production, and a cache that could hand them to whoever
 * next opens the browser, or show yesterday's streak as today's, is worse
 * than no cache.
 *
 * Served `no-cache` by the server so a new deploy's worker is always found.
 * Bump VERSION when these rules change; older caches are dropped on activate.
 */
const VERSION = 'v1';
const SHELL_CACHE = `focuspath-shell-${VERSION}`;
const ASSET_CACHE = `focuspath-assets-${VERSION}`;
const SHELL_KEY = '/';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Every route is the same shell. The network wins whenever it answers, so a
  // deploy is picked up on the next visit; the cached copy is only for when it
  // does not.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_KEY, copy)));
          }
          return response;
        })
        .catch(() =>
          caches.match(SHELL_KEY, { cacheName: SHELL_CACHE }).then((cached) => cached ?? Response.error()),
        ),
    );
    return;
  }

  // Named by content hash, so a cached copy can never be the wrong version.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request, { cacheName: ASSET_CACHE }).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)));
            }
            return response;
          }),
      ),
    );
  }
});
