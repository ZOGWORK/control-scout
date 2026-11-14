// Clear cache (the Network & offline screen): what the service worker keeps beyond what this release needs to open
// with no signal. It only ever touches Cache Storage (the service worker's cs-shell-* caches and any other cache this
// site made), never IndexedDB (event packs, saved seasons, the predictions pack, recordings) or localStorage
// (scouting notes, settings): those have their own Delete buttons.
//
// What it frees:
//   - every cache but the current release's (older releases kept for tabs still running them, anything else),
//   - in the current release's cache, every file that isn't one of the release's own (files saved as they were
//     fetched, from a newer deploy than this worker).
// The current release's own files stay, so the app still opens offline afterwards. The service worker says which
// those are (src/sw.template.js, the "cs-cache-keep" message); with no worker in charge (the first visit, dev), the
// newest cs-shell cache stays whole.

export interface KeepList { cache: string; files: string[] }

/** One thing Clear cache removes: a whole cache, or one file in the current one. */
export interface CacheItem { cache: string; url: string | null; bytes: number }
export interface CachePlan { items: CacheItem[]; bytes: number }

const PREFIX = "cs-shell-";

/** Ask the service worker in charge which cache and files this release needs (null: none answers within `ms`). */
export function askKeepList(ms = 1500): Promise<KeepList | null> {
  const sw = typeof navigator === "undefined" ? undefined : navigator.serviceWorker?.controller;
  if (!sw || typeof MessageChannel === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      const d = e.data as Partial<KeepList> | null;
      resolve(d && typeof d.cache === "string" && Array.isArray(d.files) ? { cache: d.cache, files: d.files.filter((f): f is string => typeof f === "string") } : null);
    };
    sw.postMessage({ type: "cs-cache-keep" }, [ch.port2]);
  });
}

/** A stored response's size: its body as kept (measured, not the header's word). */
async function sizeOf(res: Response | undefined): Promise<number> {
  if (!res) return 0;
  try { return (await res.blob()).size; } catch { return 0; }
}

const pathOf = (url: string) => { try { return new URL(url, "http://x").pathname; } catch { return url; } };

/** What Clear cache would remove, and how much that frees. */
export async function planClear(store: CacheStorage, keep: KeepList | null): Promise<CachePlan> {
  const names = await store.keys();
  const current = keep?.cache && names.includes(keep.cache) ? keep.cache : names.filter((n) => n.startsWith(PREFIX)).sort().reverse()[0] ?? null;
  const own = keep && current === keep.cache ? new Set(keep.files.map(pathOf)) : null;
  const items: CacheItem[] = [];
  for (const name of names) {
    const cache = await store.open(name);
    const reqs = await cache.keys();
    if (name !== current) {
      let total = 0;
      for (const r of reqs) total += await sizeOf(await cache.match(r));
      items.push({ cache: name, url: null, bytes: total });
      continue;
    }
    if (!own) continue; // the worker didn't say: the newest release's cache stays whole
    for (const r of reqs) {
      if (own.has(pathOf(r.url))) continue;
      items.push({ cache: name, url: r.url, bytes: await sizeOf(await cache.match(r)) });
    }
  }
  return { items, bytes: items.reduce((n, i) => n + i.bytes, 0) };
}

/** Remove what the plan lists; returns the bytes freed. */
export async function clearPlanned(store: CacheStorage, plan: CachePlan): Promise<number> {
  let freed = 0;
  for (const i of plan.items) {
    const ok = i.url == null ? await store.delete(i.cache) : await (await store.open(i.cache)).delete(i.url);
    if (ok) freed += i.bytes;
  }
  return freed;
}

/** The plan for this browser (null: it has no Cache Storage). */
export async function planAppCache(): Promise<CachePlan | null> {
  if (typeof caches === "undefined") return null;
  return planClear(caches, await askKeepList());
}

/** Clear it now, planned afresh (the caches may have changed since the screen measured them). Returns bytes freed. */
export async function clearAppCache(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  return clearPlanned(caches, await planClear(caches, await askKeepList()));
}
