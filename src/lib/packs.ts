// Offline packs on the device. The lite pack (every team's ratings + names,
// a few MB) runs match predictions with no connection, using the very same
// engine as the server. It's verified against the manifest's SHA-256 before
// it's kept.
import { RatingBook, explainMatch, FITTED_MODEL, type RatingBookData, type MatchExplanation } from "@control-scout/predict-engine";
import { PACK_META_KEY } from "./packPolicy";

export interface PackFile { name: string; url: string; bytes: number; sha256: string; seasons: number[]; kind: "lite" | "full"; contents: string }
export interface PackManifest { format: number; version: string; builtAt: string; engineVersion: string; dataAsOf: string | null; lite: PackFile | null; full: PackFile[] }

export interface LitePack {
  format: 1;
  version: string;
  builtAt: string;
  engineVersion: string;
  /** Season → ratings (as of the build), ready for RatingBook.fromData. */
  books: Record<string, RatingBookData>;
  /** [number, name, city/state/country] */
  teams: [number, string | null, string | null][];
}

const DB = "control-scout-packs";
const META = PACK_META_KEY;

// Shared with saved seasons (src/lib/offline/seasons.ts): same database, one store.
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("packs");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function put(key: string, value: unknown) { const db = await idb(); await new Promise<void>((res, rej) => { const t = db.transaction("packs", "readwrite"); t.objectStore("packs").put(value, key); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); }); }
export async function getv<T>(key: string): Promise<T | undefined> { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("packs"); const r = t.objectStore("packs").get(key); r.onsuccess = () => { db.close(); res(r.result as T | undefined); }; r.onerror = () => rej(r.error); }); }

export async function keys(prefix: string): Promise<string[]> { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("packs"); const r = t.objectStore("packs").getAllKeys(); r.onsuccess = () => { db.close(); res(r.result.map(String).filter((k) => k.startsWith(prefix))); }; r.onerror = () => rej(r.error); }); }
export async function del(key: string) { const db = await idb(); await new Promise<void>((res, rej) => { const t = db.transaction("packs", "readwrite"); t.objectStore("packs").delete(key); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); }); }

export interface PackMeta { version: string; bytes: number; savedAt: number; builtAt: string; engineVersion: string }
export function packStatus(): PackMeta | null { try { return JSON.parse(localStorage.getItem(META) ?? "null"); } catch { return null; } }

/** Why the pack list couldn't be read: none published yet, or the server
 *  couldn't be reached (offline, or down) — they need different messages. */
export class ManifestError extends Error {
  constructor(readonly reason: "none" | "unreachable" | "failed" | "paused", message: string) { super(message); }
}

export async function fetchManifest(): Promise<PackManifest> {
  if (navigator.onLine === false) throw new ManifestError("unreachable", "You're offline — the pack list loads when you're back online.");
  let r: Response;
  try { r = await fetch("/packs/latest.json", { cache: "no-cache" }); }
  catch { throw new ManifestError("unreachable", "Can't reach the server right now — try again in a moment."); }
  if (r.status === 404) throw new ManifestError("none", "No packs have been published on this server yet.");
  // Switched off for now (the offlinePacks flag): the server says so in its own words.
  if (r.status === 503) {
    const body = await r.json().catch(() => null) as { paused?: boolean; error?: string } | null;
    if (body?.paused) throw new ManifestError("paused", body.error ?? "Offline packs are paused right now.");
  }
  if (!r.ok) throw new ManifestError("failed", `Couldn't read the pack list (${r.status}).`);
  return r.json();
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Download a pack file with progress and check it against its published SHA-256. */
export async function fetchVerified(file: PackFile, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(file.url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    parts.push(value);
    done += value.length;
    onProgress?.(done, file.bytes);
  }
  const bytes = new Uint8Array(done);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (digest !== file.sha256) throw new Error("The download didn't match its published checksum — not saved. Try again.");
  return bytes;
}

/** Download with progress, verify the hash, keep it on the device. */
export async function downloadLite(file: PackFile, manifest: PackManifest, onProgress?: (done: number, total: number) => void): Promise<PackMeta> {
  const bytes = await fetchVerified(file, onProgress);
  // The pack file is gzipped JSON.
  const text = file.name.endsWith(".gz") ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text() : new TextDecoder().decode(bytes);
  const pack = JSON.parse(text) as LitePack;
  if (pack.format !== 1) throw new Error("This pack is from a newer version of Control Scout — refresh the page.");
  await put("lite", pack);
  const meta: PackMeta = { version: manifest.version, bytes: bytes.length, savedAt: Date.now(), builtAt: pack.builtAt, engineVersion: pack.engineVersion };
  localStorage.setItem(META, JSON.stringify(meta));
  cached = pack;
  return meta;
}

let cached: LitePack | null = null;
export async function loadLite(): Promise<LitePack | null> {
  if (cached) return cached;
  cached = (await getv<LitePack>("lite").catch(() => undefined)) ?? null;
  return cached;
}

export async function removeLite(): Promise<void> {
  await put("lite", null);
  localStorage.removeItem(META);
  cached = null;
}

/** Predict a match on this device from the lite pack (same engine as the server). */
export async function offlineExplain(season: number, red: number[], blue: number[]): Promise<(MatchExplanation & { asOf: string }) | null> {
  const p = await loadLite();
  const data = p?.books[String(season)];
  if (!p || !data) return null;
  const book = RatingBook.fromData(data);
  book.setTime(Date.now());
  return { ...explainMatch(book, red, blue, { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration }), asOf: p.builtAt };
}

/** Fired on window when the background sync saves a new lite pack. */
export const PACK_EVENT = "cs-pack-changed";

let syncing: Promise<PackMeta | null> | null = null;
/** Keep the lite pack current in the background: download it when it's
 *  missing or older than the published one. Quiet on failure (offline, no
 *  packs, bad checksum); the next visit tries again. */
export function syncLite(): Promise<PackMeta | null> {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const m = await fetchManifest();
      const have = packStatus();
      if (!m.lite || (have && have.version === m.version)) return have;
      const meta = await downloadLite(m.lite, m);
      window.dispatchEvent(new Event(PACK_EVENT));
      return meta;
    } catch { return packStatus(); }
    finally { syncing = null; }
  })();
  return syncing;
}

