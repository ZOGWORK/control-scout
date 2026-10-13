// Offline packs on the device. The lite pack (every team's ratings + names,
// a few MB) runs match predictions with no connection, using the very same
// engine as the server. It's verified against the manifest's SHA-256 before
// it's kept.
import { RatingBook, explainMatch, FITTED_MODEL, type RatingBookData, type MatchExplanation } from "@control-scout/predict-engine";

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
const META = "cs-pack-meta";

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("packs");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function put(key: string, value: unknown) { const db = await idb(); await new Promise<void>((res, rej) => { const t = db.transaction("packs", "readwrite"); t.objectStore("packs").put(value, key); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); }); }
async function getv<T>(key: string): Promise<T | undefined> { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("packs"); const r = t.objectStore("packs").get(key); r.onsuccess = () => { db.close(); res(r.result as T | undefined); }; r.onerror = () => rej(r.error); }); }

export interface PackMeta { version: string; bytes: number; savedAt: number; builtAt: string; engineVersion: string }
export function packStatus(): PackMeta | null { try { return JSON.parse(localStorage.getItem(META) ?? "null"); } catch { return null; } }

export async function fetchManifest(): Promise<PackManifest> {
  const r = await fetch("/packs/latest.json", { cache: "no-cache" });
  if (r.status === 404) throw new Error("No packs have been published on this server yet.");
  if (!r.ok) throw new Error(`Couldn't read the pack manifest (${r.status}).`);
  return r.json();
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Download with progress, verify the hash, keep it on the device. */
export async function downloadLite(file: PackFile, manifest: PackManifest, onProgress?: (done: number, total: number) => void): Promise<PackMeta> {
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
  // The pack file is gzipped JSON.
  const text = file.name.endsWith(".gz") ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text() : new TextDecoder().decode(bytes);
  const pack = JSON.parse(text) as LitePack;
  if (pack.format !== 1) throw new Error("This pack is from a newer version of Control Scout — refresh the page.");
  await put("lite", pack);
  const meta: PackMeta = { version: manifest.version, bytes: done, savedAt: Date.now(), builtAt: pack.builtAt, engineVersion: pack.engineVersion };
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
