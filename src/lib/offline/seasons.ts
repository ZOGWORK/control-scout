// Full seasons saved on this device, for venues with no wifi. A season pack
// (the same SQLite file the Download page offers) is downloaded, checked
// against its published SHA-256, opened once to make sure it really is a
// pack, and kept in IndexedDB; team and event pages then read it with sql.js
// (SQLite compiled to WebAssembly) when the server can't be reached.
//
// sql.js and its .wasm load only when a season is saved or read, and come
// from this site (cached for the service worker), never a CDN.
import type { Database, SqlJsStatic } from "sql.js";
import { del, fetchVerified, getv, keys, put, type PackFile, type PackManifest } from "../packs";
import { savedSeasons, writeSaved, type SavedSeason } from "./saved";
import { wrap, type Db, type SeasonDb } from "./readers";

export { savedSeasons, useSavedSeasons, SEASONS_EVENT, type SavedSeason } from "./saved";

// One key per file (season + checksum): a new copy never overwrites the one the saved list points at.
const key = (season: number, sha256: string) => `season:${season}:${sha256}`;

const engineUrl = () => import("sql.js/dist/sql-wasm-browser.wasm?url").then((m) => m.default);
let sqlite: Promise<SqlJsStatic> | null = null;
function loadSqlite(): Promise<SqlJsStatic> {
  sqlite ??= Promise.all([import("sql.js/dist/sql-wasm-browser.js"), engineUrl()])
    .then(([m, wasm]) => m.default({ locateFile: () => wasm }))
    .catch((e) => { sqlite = null; throw e; }); // a failed load (offline before it was ever cached) can retry
  return sqlite;
}

/**
 * Put the SQLite engine where the service worker serves it offline (its newest
 * cs-shell-* cache; see src/sw.template.js). The worker caches it at install
 * only if a season is already saved, and a first visit can save before the
 * worker controls the page, so the save itself makes sure. Best effort.
 */
async function keepEngine(): Promise<void> {
  if (import.meta.env.DEV || typeof caches === "undefined") return; // no service worker in dev
  try {
    const url = await engineUrl();
    // No cache yet (the worker is still installing): one its fromCache scans all the same.
    const name = (await caches.keys()).filter((k) => k.startsWith("cs-shell-")).sort().reverse()[0] ?? "cs-shell-0";
    const cache = await caches.open(name);
    if (!(await cache.match(url))) await cache.add(url);
  } catch { /* offline reads then need the engine fetched once online */ }
}

/** Open pack bytes and check they're a season pack of the format this app reads. */
async function openPack(bytes: Uint8Array, season: number): Promise<Database> {
  const SQL = await loadSqlite();
  const db = new SQL.Database(bytes);
  try {
    const info = Object.fromEntries(wrap(db).all<{ key: string; value: string }>("SELECT key, value FROM pack_info").map((r) => [r.key, r.value]));
    if (info.format !== "1") throw new Error("This season pack is from a newer version of Control Scout — refresh the page.");
    if (Number(info.season) !== season) throw new Error("This file isn't the season it says it is — not saved.");
    return db;
  } catch (e) {
    db.close();
    throw e instanceof Error && /pack_info|not a database|malformed/i.test(e.message) ? new Error("That file isn't a Control Scout season pack — not saved.") : e;
  }
}

// Open databases stay in memory (opening a season again on every page would be
// slow), but a season is tens of MB: only the KEEP_OPEN most recently read
// stay. Keyed by checksum, so an update reopens. Map order = least recent first.
interface Entry { sha256: string; db: Promise<Database>; pins: number; dead?: boolean }
const open = new Map<number, Entry>();
const KEEP_OPEN = 2;

const shut = (e: Entry) => { e.db.then((d) => d.close(), () => {}); };
/** Forget a season's open database; one being read closes when the read ends. */
function retire(e: Entry) { if (e.pins) e.dead = true; else shut(e); }
function close(season: number) {
  const e = open.get(season);
  open.delete(season);
  if (e) retire(e);
}
function trim() { for (const [s, e] of open) if (open.size > KEEP_OPEN && !e.pins) close(s); }

/**
 * Download one season, verify it, keep it on this device. Replaces an older
 * copy of the same season only once the new one is safely stored and listed;
 * a save that fails leaves the device as it was.
 */
export async function saveSeason(file: PackFile, manifest: PackManifest, onProgress?: (done: number, total: number) => void): Promise<SavedSeason> {
  const season = file.seasons[0];
  if (file.kind !== "full" || file.seasons.length !== 1) throw new Error("Only single-season packs can be saved.");
  const bytes = await fetchVerified(file, onProgress);
  const db = await openPack(bytes, season);
  // Ask the browser not to clear it under storage pressure (granted quietly or not at all).
  navigator.storage?.persist?.().catch(() => {});
  // One save per season at a time, across tabs: two releases saved at once would otherwise both
  // replace the same previous copy and leave one download stored but unlisted.
  return oneAtATime(season, () => store(season, file, manifest, bytes, db));
}

// Web Locks cover every tab; without them (old browsers, tests) this tab's own saves still queue.
const queues = new Map<number, Promise<unknown>>();
function oneAtATime<T>(season: number, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(`cs-season-${season}`, fn) as Promise<T>;
  const run = (queues.get(season) ?? Promise.resolve()).catch(() => {}).then(fn);
  queues.set(season, run);
  return run;
}

const crossTab = () => typeof navigator !== "undefined" && !!navigator.locks;

/** Delete every stored copy of a season the saved list doesn't point at (leftovers of an interrupted
 *  save). Only under a cross-tab lock: without one another tab may be publishing the copy it'd delete. */
async function sweep(season: number) {
  if (!crossTab()) return;
  const stored = await keys(`season:${season}:`);
  const listed = savedSeasons().find((s) => s.season === season); // read after listing keys, inside the lock
  for (const k of stored) if (!listed || k !== key(season, listed.sha256)) await del(k);
}

async function store(season: number, file: PackFile, manifest: PackManifest, bytes: Uint8Array, db: Database): Promise<SavedSeason> {
  const k = key(season, file.sha256);
  const prev = savedSeasons().find((s) => s.season === season);
  try { await put(k, bytes); }
  catch (e) {
    db.close();
    throw (e as DOMException)?.name === "QuotaExceededError" ? new Error("Not enough storage on this device to save this season. Remove another saved season, or free some space.") : e;
  }
  await keepEngine();
  const meta: SavedSeason = { season, version: manifest.version, sha256: file.sha256, bytes: bytes.length, savedAt: Date.now(), dataAsOf: manifest.dataAsOf, builtAt: manifest.builtAt };
  // Same tick as the list write, so readers woken by it find this database open.
  const was = open.get(season), mine: Entry = { sha256: file.sha256, db: Promise.resolve(db), pins: 0 };
  open.set(season, mine);
  try { writeSaved([...savedSeasons().filter((s) => s.season !== season), meta]); }
  catch (e) {
    // Roll back: the previous copy (if any) stays listed and readable; the new bytes go.
    if (open.get(season) === mine) { open.delete(season); if (was) open.set(season, was); }
    db.close();
    if (prev?.sha256 !== file.sha256) await del(k).catch(() => {});
    throw e;
  }
  if (was && was !== mine) retire(was);
  if (prev && prev.sha256 !== file.sha256) await del(key(season, prev.sha256)).catch(() => {});
  await sweep(season).catch(() => {}); // tidying only: the save itself succeeded
  trim();
  return meta;
}

export async function removeSeason(season: number): Promise<void> {
  await oneAtATime(season, async () => {
    const meta = savedSeasons().find((s) => s.season === season);
    close(season);
    // The list and the file change together: if either step fails, the season stays listed with its
    // file in place (restored if it was already deleted), so Remove can be tried again.
    const k = meta ? key(season, meta.sha256) : null;
    const bytes = k ? await getv<Uint8Array>(k) : undefined;
    if (k) await del(k);
    try { writeSaved(savedSeasons().filter((s) => s.season !== season)); }
    catch (e) { if (k && bytes) await put(k, bytes).catch(() => {}); throw e; }
    await sweep(season).catch(() => {}); // leftovers of interrupted saves; the season itself is gone
  });
}

/** A saved season's open entry (null when it isn't saved), now the most recently used. */
function entry(season: number): Entry | null {
  const meta = savedSeasons().find((s) => s.season === season);
  if (!meta) return null;
  const o = open.get(season);
  if (o?.sha256 === meta.sha256) { open.delete(season); open.set(season, o); return o; }
  close(season);
  const db = (async () => {
    const bytes = await getv<Uint8Array>(key(season, meta.sha256));
    if (!bytes) throw new Error(`Season ${season} isn't on this device any more.`);
    return openPack(bytes, season);
  })();
  const e: Entry = { sha256: meta.sha256, db, pins: 0 };
  open.set(season, e);
  db.catch(() => { if (open.get(season) === e) open.delete(season); }); // retry next time
  return e;
}

// One wrapper per open database, so what the readers cache per pack (search names) lasts.
const wrapped = new WeakMap<Database, Db>();

/**
 * Read the saved seasons that open, newest first: just `only` when given (a
 * page for one season opens no other), else all of them. They stay open until
 * `read` returns; after that only the most recently read are kept.
 */
export async function readSaved<T>(only: number | undefined, read: (dbs: SeasonDb[]) => T): Promise<T> {
  const list = savedSeasons().filter((s) => only === undefined || s.season === only);
  // Touched oldest first, so the newest seasons end up the most recently used.
  const got: { season: number; e: Entry }[] = [];
  for (const s of [...list].reverse()) { const e = entry(s.season); if (e) got.unshift({ season: s.season, e }); }
  for (const { e } of got) e.pins++;
  try {
    const dbs = await Promise.all(got.map(async ({ season, e }) => {
      const db = await e.db.catch(() => null);
      if (!db) return null;
      if (!wrapped.has(db)) wrapped.set(db, wrap(db));
      return { season, db: wrapped.get(db)! };
    }));
    return read(dbs.filter((x): x is SeasonDb => !!x));
  } finally {
    for (const { e } of got) if (--e.pins === 0 && e.dead) shut(e);
    trim();
  }
}
