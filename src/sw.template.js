// Control Scout service worker: the app opens with no signal (venues!).
//
// This file is a template: the build (vite.config.ts, cs-sw plugin) fills in
// VERSION and FILES and emits /sw.js. Every release therefore changes the
// worker's bytes, which is what makes browsers install the new version.
//
// Install: precache the app shell, every built chunk and the fonts. Hashed
// assets and fonts: cache first (they never change), saved as they're fetched.
// Pages: network first, falling back to the cached shell. /api and /packs are
// never cached here: live data comes from the server, offline predictions from
// the lite pack the app keeps in IndexedDB.
//
// Updates: the new worker takes over at once, but the previous release's cache
// is kept (the two newest are kept), so a tab still running the old code can
// still lazy-load its own chunks, online or offline.
const VERSION = "__VERSION__";
const FILES = __FILES__;
const PREFIX = "cs-shell-";
const CACHE = `${PREFIX}${VERSION}`;
const KEEP = 2;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Cache names are cs-shell-<build time>-<hash>: newest first by name.
    const ours = (await caches.keys()).filter((k) => k.startsWith(PREFIX)).sort().reverse();
    for (const old of ours.filter((k) => k !== CACHE).slice(KEEP - 1)) await caches.delete(old);
    await self.clients.claim();
  })());
});

async function fromCache(req) {
  const names = (await caches.keys()).filter((k) => k.startsWith(PREFIX)).sort().reverse();
  for (const k of names) {
    const hit = await (await caches.open(k)).match(req, { ignoreSearch: true });
    if (hit) return hit;
  }
  return null;
}

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
    event.respondWith((async () => {
      const hit = await fromCache(req);
      if (hit) return hit;
      const res = await fetch(req);
      // Anything not precached (e.g. from a newer deploy than this worker) is kept too.
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone()).catch(() => {});
      return res;
    })());
  }
});
