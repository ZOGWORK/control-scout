// Control Scout service worker: the app opens with no signal (venues!).
//
// Install: precache the app shell, every built chunk and the fonts, listed by
// the build in /sw-precache.json (so a page never visited online still opens
// offline). Hashed assets and fonts: cache first (they never change). Pages:
// network first, falling back to the cached shell. /api and /packs are never
// cached here: live data comes from the server, and offline predictions come
// from the lite pack the app keeps in IndexedDB.
const CACHE = "cs-shell";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const res = await fetch("/sw-precache.json", { cache: "no-store" });
    const { version, files } = await res.json();
    const cache = await caches.open(`${CACHE}-${version}`);
    await cache.addAll(files);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const res = await fetch("/sw-precache.json", { cache: "no-store" }).catch(() => null);
    const keep = res ? `${CACHE}-${(await res.json()).version}` : null;
    if (keep) for (const k of await caches.keys()) if (k.startsWith(CACHE) && k !== keep) await caches.delete(k);
    await self.clients.claim();
  })());
});

const fromCache = async (req) => {
  for (const k of await caches.keys()) {
    if (!k.startsWith(CACHE)) continue;
    const hit = await (await caches.open(k)).match(req, { ignoreSearch: true });
    if (hit) return hit;
  }
  return null;
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/packs/")) return;

  if (req.mode === "navigate") {
    // Pages: fresh when online, the cached shell when not (the app routes client-side).
    event.respondWith(fetch(req).catch(async () => (await fromCache("/index.html")) ?? (await fromCache("/")) ?? Response.error()));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith((async () => (await fromCache(req)) ?? fetch(req))());
  }
});
