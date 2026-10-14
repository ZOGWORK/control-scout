// Full seasons saved on this device, for venues with no wifi. A season pack
// (the same SQLite file the Download page offers) is downloaded, checked
// against its published SHA-256, opened once to make sure it really is a
// pack, and kept in IndexedDB; team and event pages then read it with sql.js
// (SQLite compiled to WebAssembly) when the server can't be reached.
//
// sql.js and its .wasm load only when a season is saved or read, and come
// from this site (precached by the service worker), never a CDN.
import type { Database, SqlJsStatic } from "sql.js";
import { del, fetchVerified, getv, put, type PackFile, type PackManifest } from "../packs";
import { savedSeasons, writeSaved, type SavedSeason } from "./saved";
import { wrap, type Db, type SeasonDb } from "./readers";

export { savedSeasons, useSavedSeasons, SEASONS_EVENT, type SavedSeason } from "./saved";

const key = (season: number) => `season:${season}`;

let sqlite: Promise<SqlJsStatic> | null = null;
function loadSqlite(): Promise<SqlJsStatic> {
  sqlite ??= Promise.all([import("sql.js/dist/sql-wasm-browser.js"), import("sql.js/dist/sql-wasm-browser.wasm?url")])
    .then(([m, wasm]) => m.default({ locateFile: () => wasm.default }))
    .catch((e) => { sqlite = null; throw e; }); // a failed load (offline before it was ever cached) can retry
  return sqlite;
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

// Open databases stay in memory (a season is tens of MB; opening it again on
// every page would be slow). Keyed by checksum, so an update reopens.
const open = new Map<number, { sha256: string; db: Promise<Database> }>();

function close(season: number) {
  const o = open.get(season);
  open.delete(season);
  o?.db.then((d) => d.close(), () => {});
}

/**
 * Download one season, verify it, keep it on this device. Replaces an older
 * copy of the same season only once the new one is safely stored.
 */
export async function saveSeason(file: PackFile, manifest: PackManifest, onProgress?: (done: number, total: number) => void): Promise<SavedSeason> {
  const season = file.seasons[0];
  if (file.kind !== "full" || file.seasons.length !== 1) throw new Error("Only single-season packs can be saved.");
  const bytes = await fetchVerified(file, onProgress);
  const db = await openPack(bytes, season);
  // Ask the browser not to clear it under storage pressure (granted quietly or not at all).
  navigator.storage?.persist?.().catch(() => {});
  try { await put(key(season), bytes); }
  catch (e) {
    db.close();
    throw (e as DOMException)?.name === "QuotaExceededError" ? new Error("Not enough storage on this device to save this season. Remove another saved season, or free some space.") : e;
  }
  close(season);
  open.set(season, { sha256: file.sha256, db: Promise.resolve(db) });
  const meta: SavedSeason = { season, version: manifest.version, sha256: file.sha256, bytes: bytes.length, savedAt: Date.now(), dataAsOf: manifest.dataAsOf, builtAt: manifest.builtAt };
  writeSaved([...savedSeasons().filter((s) => s.season !== season), meta]);
  return meta;
}

export async function removeSeason(season: number): Promise<void> {
  close(season);
  await del(key(season));
  writeSaved(savedSeasons().filter((s) => s.season !== season));
}

/** A saved season's database (null when it isn't saved, or its bytes are gone). */
export function openSeason(season: number): Promise<Database | null> {
  const meta = savedSeasons().find((s) => s.season === season);
  if (!meta) return Promise.resolve(null);
  const o = open.get(season);
  if (o?.sha256 === meta.sha256) return o.db;
  close(season);
  const db = (async () => {
    const bytes = await getv<Uint8Array>(key(season));
    if (!bytes) throw new Error(`Season ${season} isn't on this device any more.`);
    return openPack(bytes, season);
  })();
  open.set(season, { sha256: meta.sha256, db });
  db.catch(() => { if (open.get(season)?.db === db) open.delete(season); }); // retry next time
  return db;
}

// One wrapper per open database, so what the readers cache per pack (search names) lasts.
const wrapped = new WeakMap<Database, Db>();

/** Every saved season that opens, newest first. */
export async function openSaved(): Promise<SeasonDb[]> {
  const out = await Promise.all(savedSeasons().map(async (s) => {
    const db = await openSeason(s.season).catch(() => null);
    if (!db) return null;
    if (!wrapped.has(db)) wrapped.set(db, wrap(db));
    return { season: s.season, db: wrapped.get(db)! };
  }));
  return out.filter((x): x is SeasonDb => !!x);
}
