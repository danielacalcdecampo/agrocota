/**
 * Service Worker - PWA offline (OAgroCota)
 * Cache do app + respostas Supabase para ~95% offline.
 */
const CACHE_APP = 'agrocota-app-v1';
const CACHE_DATA = 'agrocota-data-v1';

function isSupabase(url) {
  try {
    return new URL(url).hostname.includes('supabase.co');
  } catch { return false; }
}

function isAppAsset(url) {
  try {
    const u = new URL(url);
    return u.origin === self.location.origin || u.pathname.startsWith('/_expo/');
  } catch { return false; }
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('agrocota-') && k !== CACHE_APP && k !== CACHE_DATA)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = request.url;
  const get = request.method === 'GET';

  // POST/PATCH/DELETE: sempre rede (não cachear)
  if (!get) {
    e.respondWith(fetch(request));
    return;
  }

  // Supabase GET: network first, fallback cache
  if (isSupabase(url)) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_DATA).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })))
    );
    return;
  }

  // App (HTML, JS, CSS, assets): cache first, fallback network
  if (isAppAsset(url) || url.startsWith(self.location.origin)) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_APP).then((cache) => cache.put(request, clone));
          return res;
        });
      })
    );
    return;
  }

  e.respondWith(fetch(request));
});
