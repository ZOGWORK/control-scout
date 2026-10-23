// Offline packs on the device. The lite pack (every team's ratings + names,
// a few MB) runs match predictions with no connection, using the very same
// engine as the server. It's verified against the manifest's SHA-256 before
// it's kept.
//
// Downloaded online, RUN only offline: returning visitors get it in the
// background (packSync.tsx) so it's there when the signal drops, but nothing
// decodes or reads it while the server answers (lib/api.ts). Download and
// storage only: running the engine on it lives in lib/offline (predict.ts,
// answer.ts), loaded lazily with no signal.
import type { BonusModelSource, RatingBookData } from "@control-scout/predict-engine";
import type { LitePairs } from "../shared/litePairs";
import type { LiteLearned } from "../shared/liteLearned";
import { PACK_META_KEY, packStatus, type PackMeta } from "./packPolicy";

export { packStatus, type PackMeta } from "./packPolicy";

export interface PackFile { name: string; url: string; bytes: number; sha256: string; seasons: number[]; kind: "lite" | "full"; contents: string }
export interface PackManifest { format: number; version: string; builtAt: string; engineVersion: string; dataAsOf: string | null; lite: PackFile | null; full: PackFile[] }

export interface LitePack {
  format: 1;
  version: string;
  builtAt: string;
  engineVersion: string;
  /** Season → ratings (as of the build), ready for RatingBook.fromData. */
  books: Record<string, RatingBookData>;
  /** Season → bonus-RP model as the server serves it (packs from engine 2.3 on; older packs have none). */
  bonus?: Record<string, BonusModelSource>;
  /** [number, name, city/state/country] */
  teams: [number, string | null, string | null][];
  /** Pair history for the newest season, cut down for the device (src/shared/litePairs.ts; absent in older packs). */
  pairs?: LitePairs | null;
  /** Which results the ratings learned, per recent event (src/shared/liteLearned.ts; absent in older packs). */
  learned?: LiteLearned;
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


/** Why the pack list couldn't be read: none published yet, or the server
 *  couldn't be reached (offline, or down) — they need different messages. */
export class ManifestError extends Error {
  constructor(readonly reason: "none" | "unreachable" | "failed" | "paused", message: string) { super(message); }
}

export async function fetchManifest(): Promise<PackManifest> {
  // Always asked: navigator.onLine can say offline while the phone is online (iOS), so it only picks the message.
  let r: Response;
  try { r = await fetch("/packs/latest.json", { cache: "no-cache" }); }
  catch {
    throw new ManifestError("unreachable", navigator.onLine === false
      ? "You're offline — the pack list loads when you're back online."
      : "Can't reach the server right now — try again in a moment.");
  }
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

/** The pack format this app reads (server/packs/build.ts PACK_FORMAT; the manifest says it too). */
export const PACK_FORMAT = 1;
/** Refuse a release in a format this app can't read before it replaces anything saved. */
export function checkFormat(manifest: Pick<PackManifest, "format">) {
  if (manifest.format !== PACK_FORMAT) throw new Error("This pack is from a newer version of Control Scout. Refresh the page.");
}

/** IndexedDB key of the lite pack as downloaded: its bytes (gzipped JSON when `gz`). Decoding waits
 *  until the pack is needed with no signal, so the background download costs an online visit no gunzip,
 *  no JSON.parse and no big structured clone (a byte array copies as one block). Earlier versions kept
 *  the pack decoded under "lite"; that key is left alone, so a tab still running one keeps working. */
const LITE_KEY = "lite-gz";
const OLD_LITE_KEY = "lite";
interface StoredLite { gz: boolean; bytes: Uint8Array; version: string }

/** Download with progress, verify the hash, keep it on the device. Stores the bytes only: nothing is
 *  decoded or run here (that happens offline, in loadLite). */
export async function downloadLite(file: PackFile, manifest: PackManifest, onProgress?: (done: number, total: number) => void): Promise<PackMeta> {
  checkFormat(manifest);
  const bytes = await fetchVerified(file, onProgress);
  await put(LITE_KEY, { gz: file.name.endsWith(".gz"), bytes, version: manifest.version } satisfies StoredLite);
  const meta: PackMeta = { version: manifest.version, bytes: bytes.length, savedAt: Date.now(), builtAt: manifest.builtAt, engineVersion: manifest.engineVersion, seasons: file.seasons };
  localStorage.setItem(META, JSON.stringify(meta));
  cached = null; // the next offline read decodes the new one
  return meta;
}

/** Decode what's stored (bytes, or a pack an older version stored decoded). A pack in a format this
 *  app doesn't read counts as none. */
export async function decodeLite(v: StoredLite | LitePack | null | undefined): Promise<LitePack | null> {
  if (!v) return null;
  if (!("bytes" in v)) return v.format === PACK_FORMAT ? v : null;
  const text = v.gz ? await new Response(new Response(v.bytes as Uint8Array<ArrayBuffer>).body!.pipeThrough(new DecompressionStream("gzip"))).text() : new TextDecoder().decode(v.bytes);
  const pack = JSON.parse(text) as LitePack;
  return pack.format === PACK_FORMAT ? pack : null;
}

let cached: LitePack | null = null;
/** The lite pack, decoded. Only the no-signal fallbacks call this (lib/offline/answer, the Predict
 *  page's offline prediction): never an online visit. The copy the saved meta names wins (an older
 *  tab may have saved a newer release under the old key); else whichever is there. */
export async function loadLite(): Promise<LitePack | null> {
  if (cached) return cached;
  const [now, old] = await Promise.all([getv<StoredLite>(LITE_KEY).catch(() => undefined), getv<LitePack>(OLD_LITE_KEY).catch(() => undefined)]);
  const want = packStatus()?.version;
  const order = old && old.version === want && now?.version !== want ? [old, now] : [now, old];
  for (const v of order) {
    const p = await decodeLite(v).catch(() => null);
    if (p) return (cached = p);
  }
  return null;
}

export async function removeLite(): Promise<void> {
  await put(LITE_KEY, null);
  await put(OLD_LITE_KEY, null);
  localStorage.removeItem(META);
  cached = null;
}

/** Fired on window when the background sync saves a new lite pack. */
export const PACK_EVENT = "cs-pack-changed";

let syncing: Promise<PackMeta | null> | null = null;
/** Keep the lite pack current in the background: download it when it's
 *  missing or older than the published one. Quiet on failure (offline, no
 *  packs, bad checksum); the next visit tries again. `allowed` is asked again
 *  right before the download (the connection may have changed while the
 *  manifest loaded): false leaves it for next time. */
export function syncLite(opts: { allowed?: () => boolean } = {}): Promise<PackMeta | null> {
  // An explicit request (no `allowed`: Get it now) never just joins a background check, which may refuse the
  // download: it waits for that one, then runs its own (a quick no-op if that one already saved the pack).
  if (syncing) return opts.allowed ? syncing : syncing.then(() => syncLite(opts));
  syncing = (async () => {
    try {
      const m = await fetchManifest();
      const have = packStatus();
      if (!m.lite || (have && have.version === m.version)) return have;
      if (opts.allowed && !opts.allowed()) return have;
      const meta = await downloadLite(m.lite, m);
      window.dispatchEvent(new Event(PACK_EVENT));
      return meta;
    } catch { return packStatus(); }
    finally { syncing = null; }
  })();
  return syncing;
}

