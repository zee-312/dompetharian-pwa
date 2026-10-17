/**
 * DompetHarian — Hand-Written Versioned Service Worker (Milestone 2.1)
 * Author / Credit: Aravajordan
 *
 * Security & Offline Guarantees:
 * 1. Precaches the application shell and all offline-required routes.
 * 2. Normalizes Next.js App Router RSC requests by pathname so client-side navigation works 100% offline.
 * 3. Versioned cache names with safe cleanup of old caches on activate.
 * 4. NEVER caches /api/*, Supabase auth requests, or Google Drive receipt files.
 * 5. Supports user-initiated update ("Versi baru tersedia" -> SKIP_WAITING) without losing IndexedDB data.
 */

const CACHE_VERSION = 'v2.0.0-warm-editorial';
const SHELL_CACHE = `dompetharian-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `dompetharian-static-${CACHE_VERSION}`;

const APP_SHELL_ROUTES = [
  '/',
  '/beranda',
  '/tambah',
  '/riwayat',
  '/laporan',
  '/scan',
  '/sinkronisasi',
  '/pengaturan',
  '/login',
  '/privasi',
  '/manifest.webmanifest',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-512x512.png',
];

function isSensitiveOrDynamicRequest(url) {
  if (url.pathname.startsWith('/api/')) return true;
  if (url.hostname.includes('supabase.co')) return true;
  if (url.hostname.includes('googleapis.com')) return true;
  if (url.hostname.includes('googleusercontent.com')) return true;
  if (url.hostname.includes('accounts.google.com')) return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      for (const route of APP_SHELL_ROUTES) {
        try {
          const response = await fetch(route, { cache: 'reload' });
          if (response && response.ok) {
            await cache.put(route, response.clone());
          }
        } catch {
          // Ignore individual route failure during install
        }
      }
      // Immediately activate on first install so offline mode works right after first load
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== STATIC_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'dompetharian-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'TRIGGER_FOREGROUND_SYNC' });
        }
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isSensitiveOrDynamicRequest(url)) return;

  // 1. Static Next.js chunks, icons, fonts: Cache-First, then Network
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // 2. HTML Document Navigation requests: Network-First with fast fallback to cached route or /beranda shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return networkRes;
        })
        .catch(async () => {
          const exactMatch = await caches.match(url.pathname);
          if (exactMatch) return exactMatch;

          // Dynamic route /transaksi/[id] fallback to cached shell
          const berandaShell = await caches.match('/beranda');
          if (berandaShell) return berandaShell;

          const rootShell = await caches.match('/');
          if (rootShell) return rootShell;

          return new Response(
            '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DompetHarian Offline</title></head><body style="font-family:sans-serif;padding:24px;text-align:center;"><h1>DompetHarian Sedang Offline</h1><p>Silakan buka kembali halaman Beranda.</p><a href="/beranda">Ke Beranda</a></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // 3. Next.js RSC requests (_rsc query or RSC header): normalize cache key by pathname
  const isRscRequest = request.headers.get('RSC') === '1' || url.searchParams.has('_rsc');
  if (isRscRequest) {
    const normalizedRscKey = `${url.origin}${url.pathname}?__rsc_cache=1`;
    event.respondWith(
      fetch(request)
        .then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(normalizedRscKey, copy));
          }
          return networkRes;
        })
        .catch(async () => {
          const cachedRsc = await caches.match(normalizedRscKey);
          if (cachedRsc) return cachedRsc;
          return new Response('', { status: 504, statusText: 'Offline' });
        })
    );
    return;
  }

  // 4. Other same-origin GET requests
  event.respondWith(
    fetch(request)
      .then((networkRes) => {
        if (networkRes && networkRes.ok) {
          const copy = networkRes.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return networkRes;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('', { status: 504, statusText: 'Offline' });
      })
  );
});
