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
// Needed only to read saved seasons offline (the SQLite engine): precached only when this browser has one.
const OFFLINE_FILES = __OFFLINE_FILES__;
// /logo.png, /mark.png and /wordmark.png stay answerable from the cache for a tab still running an older release (they are no longer precached).
const BRAND = new Set(["/logo-56.webp", "/mark.webp", "/wordmark.webp", "/logo.png", "/mark.png", "/wordmark.png", "/favicon.ico"]);
const PREFIX = "cs-shell-";
const CACHE = `${PREFIX}${VERSION}`;
const KEEP = 2;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES);
    // A saved season must stay readable offline after an update, so its engine comes along; best effort. (A save puts it in the newest cache itself too: keepEngine in seasons.ts.)
    if (OFFLINE_FILES.length && (await hasSavedSeason())) await cache.addAll(OFFLINE_FILES).catch(() => {});
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

/** Does this browser hold a saved season? (IndexedDB "control-scout-packs", keys "season:<n>:<sha256>"; see src/lib/offline/seasons.ts.) */
function hasSavedSeason() {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open("control-scout-packs");
      open.onerror = () => resolve(false);
      open.onupgradeneeded = () => { open.transaction.abort(); resolve(false); }; // no database yet: don't create one here
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("packs")) { db.close(); resolve(false); return; }
        const keys = db.transaction("packs").objectStore("packs").getAllKeys();
        keys.onsuccess = () => { db.close(); resolve(keys.result.some((k) => String(k).startsWith("season:"))); };
        keys.onerror = () => { db.close(); resolve(false); };
      };
    } catch { resolve(false); }
  });
}

/** The full page a light one stands in for (fullHref in src/shared/lite.ts, kept in step: src/sw.lite.test.ts). */
function fullPage(url) {
  const rest = url.pathname.replace(/^\/lite/i, "") || "/";
  if (!/^\/picklist\/?$/i.test(rest)) return /^\/(events|teams)\//i.test(rest) ? rest + (/^\/teams\//i.test(rest) ? url.search : "") : "/";
  const q = new URLSearchParams();
  const space = url.searchParams.get("space");
  if (space && /^[A-Za-z0-9_-]{1,64}$/.test(space)) q.set("space", space);
  q.set("tab", "planning");
  q.set("view", "picklist");
  const season = url.searchParams.get("season");
  if (season && /^\d{4}$/.test(season)) q.set("season", season);
  return `/scout?${q}`;
}

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
    // Pages: fresh when online, the cached shell when not (the app routes client-side). A light page (/lite/…,
    // src/shared/lite.ts) is for a weak signal; with none at all, its full page opens instead, from the shell and
    // the offline pack.
    const lite = /^\/lite(\/|$)/i.test(url.pathname);
    event.respondWith(fetch(req).catch(async () => (lite ? Response.redirect(new URL(fullPage(url), url).href, 302) : (await fromCache("/")) ?? Response.error())));
    return;
  }
  if (BRAND.has(url.pathname)) {
    // Brand images keep their names across releases: fresh when online, the precached copy when not.
    event.respondWith(fetch(req).catch(async () => (await fromCache(url.pathname)) ?? Response.error()));
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

// --- Web push (docs/push.md) ------------------------------------------------------------------
// The server sends { title, body, url, tag } (src/shared/push.ts). A tap focuses an open Control Scout tab
// and takes it to the url (a path in this app, never another site), or opens a new window there.
const pushPath = (u) => (typeof u === "string" && /^\/(?!\/)[^\s\\]*$/.test(u) ? u : "/");

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = typeof data.title === "string" && data.title ? data.title : "Control Scout";
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: pushPath(data.url) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(pushPath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      await tab.focus().catch(() => {});
      if ("navigate" in tab) { const moved = await tab.navigate(url).catch(() => null); if (moved) return; }
    }
    await self.clients.openWindow(url);
  })());
});
