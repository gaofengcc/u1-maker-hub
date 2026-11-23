// Service worker for U1 Maker Hub.
// - Build assets and icons: cache first (their URLs are content-hashed or stable).
// - Pages: network first, falling back to the last copy, then to /offline.
// - API calls, printer camera and MakerWorld images: never cached, always live.

const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const PRECACHE = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only keep plain same-origin successes. A redirect usually means the auth gateway wants a login.
const cacheable = (res) => res.ok && res.type === "basic" && !res.redirected;

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (cacheable(res)) (await caches.open(STATIC_CACHE)).put(request, res.clone());
  return res;
}

async function networkFirstPage(request) {
  try {
    const res = await fetch(request);
    if (cacheable(res)) (await caches.open(PAGE_CACHE)).put(request, res.clone());
    return res;
  } catch {
    return (await caches.match(request)) ?? (await caches.match("/offline")) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
  }
});
