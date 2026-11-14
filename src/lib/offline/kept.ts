// The last good answer to each read the scouting pages need (the offline + Lite brief, Phase 3), kept on this device
// so Scout, the shortlist, the pick list and the pick helper open with no signal: the event list, an event's pick
// ratings, the shortlist rows, an event forecast, a team's profile and matches, the scouting alliance views.
//
// - Online, every such GET that answers 2xx is kept as it came (lib/api.ts calls keepAnswer): the server's own JSON,
//   never something computed here. No signal (or no answer within OFFLINE_TIMEOUT_MS), the kept copy answers
//   (lib/offline/scoutReads.ts), marked with the time it was loaded, and the next look asks the server again.
// - Per account: the key carries the account signed in on this device (lib/personal.tsx's owner), so another
//   account never sees a workspace's kept answers, and a workspace's are dropped as soon as another account writes.
// - The list (path → when) is in localStorage, so api.ts knows at once whether a read has a kept answer; the bodies
//   are in IndexedDB. At most MAX_KEPT answers: the oldest go first.
import { deviceOffline } from "./online";

/** The reads kept (GET paths, query included). Event lists: a season's whole list only (`?season=`, and the event
 *  picker's `all=1` one), never a search as it's typed (offline, the whole list is narrowed instead). */
export const KEPT_PATHS = /^\/api\/(events\?season=\d{4}(&all=1&limit=\d+)?$|events\/\d{4}\/[^/?]+\/pick-ratings$|shortlist\?|predict\/event\?|projections\/\d{4}\/[^/?]+(\?|$)|teams\/\d+(\/matches)?(\?|$)|scout\/workspaces\/[^/?]+\/alliances([/?]|$))/;
export const MAX_KEPT = 150;

const INDEX = "cs-kept-answers";
const OWNER = "cs-personal-owner";
const DB = "control-scout-kept";
const STORE = "answers";

const owner = () => { try { return localStorage.getItem(OWNER) ?? ""; } catch { return ""; } };
const keyOf = (path: string, who = owner()) => `${who}|${path}`;
/** Workspace answers belong to the account that read them (public reads too, but those are no one's secret). */
const isPrivate = (path: string) => path.startsWith("/api/scout/");

export const keepable = (path: string, method?: string): boolean => (method ?? "GET").toUpperCase() === "GET" && KEPT_PATHS.test(path);

type Index = [key: string, savedAt: number][];
let raw: string | null | undefined;
let index: Index = [];
function readIndex(): Index {
  let r: string | null = null;
  try { r = localStorage.getItem(INDEX); } catch { /* storage blocked */ }
  if (r !== raw) {
    raw = r;
    try { const v = JSON.parse(r ?? "[]"); index = Array.isArray(v) ? v.filter((x) => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "number") : []; } catch { index = []; }
  }
  return index;
}
function writeIndex(next: Index) {
  try { localStorage.setItem(INDEX, JSON.stringify(next)); raw = undefined; } catch { /* storage full: this answer just isn't kept */ }
}

/** When this account's kept answer for a path was loaded (ms), or null: none kept. */
export function keptAt(path: string): number | null {
  const k = keyOf(path);
  return readIndex().find(([x]) => x === k)?.[1] ?? null;
}

/** This account's kept paths whose path passes `test`, newest first. */
export function keptPaths(test: (path: string) => boolean): { path: string; savedAt: number }[] {
  const prefix = `${owner()}|`;
  return readIndex().filter(([k]) => k.startsWith(prefix) && test(k.slice(prefix.length)))
    .map(([k, savedAt]) => ({ path: k.slice(prefix.length), savedAt })).sort((a, b) => b.savedAt - a.savedAt);
}

let dbp: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise<IDBDatabase>((res, rej) => {
      if (typeof indexedDB === "undefined") { rej(new Error("no IndexedDB")); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await idb();
  return new Promise<T | undefined>((res, rej) => {
    const t = db.transaction(STORE, mode);
    const r = run(t.objectStore(STORE));
    t.oncomplete = () => res(r ? (r.result as T) : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

/** Writes in the order they were asked for: a slower older write never lands over a newer one. */
let queue: Promise<unknown> = Promise.resolve();

/** Keep the server's answer for a read (a 2xx GET of KEPT_PATHS). Never throws. */
export function keepAnswer(path: string, data: unknown): Promise<void> {
  if (!keepable(path) || data === null || typeof data !== "object") return Promise.resolve();
  const who = owner(), key = keyOf(path, who), at = Date.now();
  const run = queue.then(async () => {
    await tx("readwrite", (s) => s.put({ path, owner: who, savedAt: at, data }, key));
    // Newest first; another account's workspace answers go now; past MAX_KEPT the oldest go.
    const all = readIndex().filter(([k]) => k !== key);
    const drop = all.filter(([k]) => { const bar = k.indexOf("|"); return k.slice(0, bar) !== who && isPrivate(k.slice(bar + 1)); });
    const kept = all.filter((e) => !drop.includes(e));
    const next: Index = [[key, at] as [string, number], ...kept].slice(0, MAX_KEPT);
    drop.push(...kept.slice(MAX_KEPT - 1));
    writeIndex(next);
    if (drop.length) await tx("readwrite", (s) => { for (const [k] of drop) s.delete(k); });
  }).catch(() => {});
  queue = run;
  return run;
}

/** This account's kept answer for a path (a fresh copy each time), or null. */
export async function keptAnswer<T = unknown>(path: string): Promise<{ data: T; savedAt: number } | null> {
  if (keptAt(path) == null) return null;
  try {
    const v = await tx<{ data: T; savedAt: number }>("readonly", (s) => s.get(keyOf(path)));
    return v && v.data != null ? { data: v.data, savedAt: v.savedAt } : null;
  } catch { return null; }
}

/** Forget every kept answer (tests; a sign-out could too). */
export async function clearKept(): Promise<void> {
  writeIndex([]);
  await queue.catch(() => {});
  await tx("readwrite", (s) => { s.clear(); }).catch(() => {});
}

/** Is it worth asking the server for kept reads right now (warming them up for later)? */
export const canWarm = () => !deviceOffline();
