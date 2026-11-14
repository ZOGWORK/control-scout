// One downloader for every offline file (season packs, the lite pack, event bundles): it keeps what it has
// received in IndexedDB as it goes, so a download cut off by the venue Wi-Fi picks up where it stopped
// (`Range: bytes=<have>-`) instead of starting over, even after the app was closed. Nothing it holds is ever
// a saved copy: the bytes become one only once the whole file matches its published SHA-256, and the caller
// has swapped it in (then finishDownload drops the pieces).
//
// Pieces are keyed by the file's SHA-256, so a changed file (a new release) never mixes with an old one. A
// server that ignores the Range (200), answers a different range or a different total, or a stored ETag that
// no longer matches (If-Range): the pieces are dropped and the file comes again from its first byte.
//
// Browsers send `Accept-Encoding: identity` with any Range request (Fetch standard), so a resumed piece comes
// uncompressed: big files are offered pre-compressed (the season pack's .db.gz, the lite .json.gz), where a
// range is a range of the small file.

export interface DownloadFile { url: string; bytes: number; sha256: string }
/** What the download is for, so a paused one can be listed and resumed ("2025–26 season", "Predictions"). */
export interface DownloadOwner { kind: "season" | "lite" | "bundle"; id: string; label: string }
export interface PartialDownload {
  sha256: string;
  url: string;
  bytes: number;
  /** Bytes kept on the device so far (in order from the first). */
  have: number;
  /** Pieces stored. */
  pieces: number;
  etag: string | null;
  owner: DownloadOwner;
  startedAt: number;
  updatedAt: number;
  /** The whole file is here and matched its checksum; waiting for the caller to keep it. */
  verified?: boolean;
}
export type Progress = (done: number, total: number) => void;

/** Received bytes are written to the device in pieces this big: a cut-off loses at most this much. */
export const PIECE = 512 * 1024;
const DB = "control-scout-downloads";

export class ChecksumError extends Error {
  constructor() { super("The download didn't match its published checksum — not saved. Try again."); }
}
/** The device ran out of room for the download. */
export class StorageFull extends Error {
  constructor() { super("Not enough storage on this device for this download. Delete a pack you don't need, or free some space."); }
}
/** The connection dropped: what came is kept, and the next try picks up from there. */
export class DownloadPaused extends Error {
  constructor(readonly have: number, readonly total: number) {
    super(`The download stopped at ${Math.round((have / Math.max(1, total)) * 100)}%. What came is kept: try again to pick up from there.`);
  }
}

// --- Storage: IndexedDB, or memory where there is none (old browsers, some tests) -----------------------

interface Store {
  get(sha: string): Promise<PartialDownload | undefined>;
  list(): Promise<PartialDownload[]>;
  /** Write one piece and the record saying it's there, together. */
  append(p: PartialDownload, index: number, bytes: Uint8Array): Promise<void>;
  put(p: PartialDownload): Promise<void>;
  pieces(sha: string, count: number): Promise<Uint8Array[]>;
  drop(sha: string): Promise<void>;
}

const pieceKey = (sha: string, i: number) => `${sha}:${String(i).padStart(6, "0")}`;

function memoryStore(): Store {
  const parts = new Map<string, PartialDownload>();
  const chunks = new Map<string, Uint8Array>();
  return {
    get: async (sha) => parts.get(sha),
    list: async () => [...parts.values()],
    append: async (p, i, b) => { chunks.set(pieceKey(p.sha256, i), b); parts.set(p.sha256, { ...p }); },
    put: async (p) => { parts.set(p.sha256, { ...p }); },
    pieces: async (sha, n) => Array.from({ length: n }, (_, i) => chunks.get(pieceKey(sha, i))!),
    drop: async (sha) => { parts.delete(sha); for (const k of [...chunks.keys()]) if (k.startsWith(`${sha}:`)) chunks.delete(k); },
  };
}

function idbStore(): Store {
  const open = () => new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("partials"); r.result.createObjectStore("pieces"); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async <T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> => {
    const db = await open();
    return new Promise<T>((res, rej) => {
      const t = db.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => { db.close(); res(req ? req.result : (undefined as T)); };
      t.onerror = () => { db.close(); rej(t.error); };
      t.onabort = () => { db.close(); rej(t.error ?? new Error("Storage write was stopped.")); };
    });
  };
  return {
    get: (sha) => tx<PartialDownload | undefined>(["partials"], "readonly", (t) => t.objectStore("partials").get(sha)),
    list: () => tx<PartialDownload[]>(["partials"], "readonly", (t) => t.objectStore("partials").getAll()),
    append: (p, i, b) => tx<void>(["partials", "pieces"], "readwrite", (t) => { t.objectStore("pieces").put(b, pieceKey(p.sha256, i)); t.objectStore("partials").put(p, p.sha256); }),
    put: (p) => tx<void>(["partials"], "readwrite", (t) => { t.objectStore("partials").put(p, p.sha256); }),
    pieces: (sha, n) => tx<Uint8Array[]>(["pieces"], "readonly", (t) => t.objectStore("pieces").getAll(IDBKeyRange.bound(pieceKey(sha, 0), pieceKey(sha, Math.max(0, n - 1))))),
    drop: (sha) => tx<void>(["partials", "pieces"], "readwrite", (t) => {
      t.objectStore("partials").delete(sha);
      t.objectStore("pieces").delete(IDBKeyRange.bound(`${sha}:`, `${sha}:￿`));
    }),
  };
}

let store: Store | null = null;
const db = (): Store => (store ??= typeof indexedDB === "undefined" ? memoryStore() : idbStore());
/** Tests only: a fresh store (IndexedDB if there is one). */
export function resetDownloadStore() { store = null; }

// --- What's downloading now (for the Offline page) ------------------------------------------------------

export interface ActiveDownload { owner: DownloadOwner; done: number; total: number }
const ownerKey = (o: Pick<DownloadOwner, "kind" | "id">) => `${o.kind}:${o.id}`;
let active: Record<string, ActiveDownload> = {};
const subs = new Set<() => void>();
const PARTIALS_EVENT = "cs-partial-downloads-changed";
function setActive(key: string, v: ActiveDownload | null) {
  const next = { ...active };
  if (v) next[key] = v; else delete next[key];
  active = next;
  for (const f of subs) f();
}
export const activeDownloads = () => active;
export function subscribeDownloads(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; }
export const activeFor = (o: Pick<DownloadOwner, "kind" | "id">): ActiveDownload | null => active[ownerKey(o)] ?? null;
const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(PARTIALS_EVENT)); };
export { PARTIALS_EVENT };

// --- The download -----------------------------------------------------------------------------------------

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256Of = async (bytes: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));

let askedPersist = false;
/** Ask once that the browser keep this site's storage under pressure (granted quietly, or not at all). */
export function askPersist() {
  if (askedPersist) return;
  askedPersist = true;
  try { void navigator.storage?.persist?.().catch(() => {}); } catch { /* not offered */ }
}

const inflight = new Map<string, Promise<Uint8Array>>();

export interface DownloadOptions { owner: DownloadOwner; onProgress?: Progress; signal?: AbortSignal; fetch?: typeof fetch }

/**
 * Download a file, resuming a partial one, and return its bytes once they match `file.sha256`. The pieces
 * stay on the device (marked verified) until finishDownload: the caller keeps the bytes first, so a failed
 * save costs no second download. Throws DownloadPaused when the connection drops (what came is kept),
 * ChecksumError when the whole file doesn't match (nothing kept).
 */
export function download(file: DownloadFile, opts: DownloadOptions): Promise<Uint8Array> {
  const running = inflight.get(file.sha256);
  if (running) return running;
  const p = withPieces(file.sha256, () => run(file, opts))
    .catch(async (e) => {
      // An event pack is small and built per request: a failed one starts again, so its pieces aren't kept.
      if (opts.owner.kind === "bundle") await finishDownload(file.sha256);
      throw e;
    })
    .finally(() => { inflight.delete(file.sha256); setActive(ownerKey(opts.owner), null); changed(); });
  inflight.set(file.sha256, p);
  return p;
}

/** One tab at a time works on a file's pieces (downloading, reading them back, dropping them): two tabs saving the
 *  same pack would otherwise delete pieces the other still reads. Web Locks span tabs; without them, this tab only. */
const local = new Map<string, Promise<unknown>>();
function withPieces<T>(sha: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(`cs-download-${sha}`, fn) as Promise<T>;
  const run = (local.get(sha) ?? Promise.resolve()).catch(() => {}).then(fn);
  local.set(sha, run);
  return run;
}

/** Drop a file's pieces only if nothing is working on them right now (another tab may still be downloading
 *  that release): never waits, and leaves them for a later tidy-up when they're busy. */
async function dropIfIdle(sha: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`cs-download-${sha}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      await db().drop(sha);
      return true;
    }) as Promise<boolean>;
  }
  if (inflight.has(sha)) return false;
  await db().drop(sha);
  return true;
}

async function run(file: DownloadFile, opts: DownloadOptions): Promise<Uint8Array> {
  askPersist();
  const s = db();
  // Another release's half download of the same thing is no use any more (unless a tab is still on it).
  for (const old of await s.list().catch(() => [])) {
    if (old.sha256 !== file.sha256 && ownerKey(old.owner) === ownerKey(opts.owner)) await dropIfIdle(old.sha256).catch(() => {});
  }
  let p = await s.get(file.sha256).catch(() => undefined);
  const resumed = !!p && p.have > 0;
  try { return await attempt(file, p, opts); }
  catch (e) {
    // A resumed file that came out wrong: the pieces from before may be from a different file. Once more, from scratch.
    if (!(e instanceof ChecksumError) || !resumed) throw e;
    p = undefined;
    return attempt(file, p, opts);
  }
}

const RANGE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/;

async function attempt(file: DownloadFile, prev: PartialDownload | undefined, opts: DownloadOptions): Promise<Uint8Array> {
  const s = db();
  const now = Date.now();
  let p: PartialDownload = prev && prev.url === file.url && prev.bytes === file.bytes
    ? { ...prev, owner: opts.owner }
    : { sha256: file.sha256, url: file.url, bytes: file.bytes, have: 0, pieces: 0, etag: null, owner: opts.owner, startedAt: now, updatedAt: now };
  if (prev && p.have === 0) await s.drop(file.sha256).catch(() => {});
  const key = ownerKey(opts.owner);
  const report = (done: number) => { setActive(key, { owner: opts.owner, done, total: file.bytes }); opts.onProgress?.(done, file.bytes); };

  if (p.have < file.bytes) {
    const headers: Record<string, string> = {};
    if (p.have > 0) {
      headers.Range = `bytes=${p.have}-`;
      // A weak ETag can't vouch for a byte range (RFC 9110); the checksum at the end still does.
      if (p.etag && !p.etag.startsWith("W/")) headers["If-Range"] = p.etag;
    }
    let res: Response;
    try { res = await (opts.fetch ?? fetch)(file.url, { headers, signal: opts.signal }); }
    catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      if (p.have > 0) throw new DownloadPaused(p.have, file.bytes);
      throw new Error(typeof navigator !== "undefined" && navigator.onLine === false ? "You're offline: the download starts when you're back online." : "Can't reach the server right now. Try again in a moment.");
    }
    if (res.status === 416 && p.have > 0) {
      await res.body?.cancel().catch(() => {});
      // Nothing left to send, or a different file now: start over unless the bytes are all here.
      p = await restart(p);
      return attempt(file, p, opts);
    }
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
    if (res.status === 206) {
      const m = RANGE.exec(res.headers.get("Content-Range") ?? "");
      if (!m || Number(m[1]) !== p.have || (m[3] !== "*" && Number(m[3]) !== file.bytes)) {
        await res.body.cancel().catch(() => {});
        if (p.have === 0) throw new Error("The server sent part of a different file. Try again in a moment.");
        // Not the bytes asked for: drop what's here and fetch the whole file.
        p = await restart(p);
        return attempt(file, p, opts);
      }
    } else if (p.have > 0) {
      // 200: the server sent the whole file (it ignores ranges, or If-Range said the file changed).
      p = await restart(p);
    }
    p.etag = res.headers.get("ETag") ?? p.etag;
    report(p.have);
    p = await receive(res.body, p, file, report);
  }

  const parts = await s.pieces(file.sha256, p.pieces);
  const bytes = new Uint8Array(file.bytes);
  let o = 0;
  for (const part of parts) {
    if (!part || o + part.length > bytes.length) { await s.drop(file.sha256).catch(() => {}); throw new ChecksumError(); }
    bytes.set(part, o);
    o += part.length;
  }
  if (o !== file.bytes || (await sha256Of(bytes)) !== file.sha256) {
    await s.drop(file.sha256).catch(() => {});
    changed();
    throw new ChecksumError();
  }
  if (!p.verified) await s.put({ ...p, verified: true }).catch(() => {});
  report(file.bytes);
  return bytes;
}

async function restart(p: PartialDownload): Promise<PartialDownload> {
  await db().drop(p.sha256).catch(() => {});
  return { ...p, have: 0, pieces: 0, etag: null, verified: false };
}

/** Read the body, writing it to the device a piece at a time. Throws DownloadPaused if it stops early. */
async function receive(body: ReadableStream<Uint8Array>, start: PartialDownload, file: DownloadFile, report: (done: number) => void): Promise<PartialDownload> {
  const s = db();
  let p = start;
  let buf: Uint8Array[] = [];
  let buffered = 0;
  const flush = async () => {
    if (!buffered) return;
    const piece = new Uint8Array(buffered);
    let o = 0;
    for (const b of buf) { piece.set(b, o); o += b.length; }
    const next = { ...p, have: p.have + buffered, pieces: p.pieces + 1, updatedAt: Date.now() };
    buf = [];
    buffered = 0;
    try { await s.append(next, p.pieces, piece); }
    catch (e) {
      throw (e as DOMException)?.name === "QuotaExceededError" ? new StorageFull() : e;
    }
    p = next;
  };
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (p.have + buffered + value.length > file.bytes) { await reader.cancel().catch(() => {}); await s.drop(file.sha256).catch(() => {}); throw new ChecksumError(); }
      buf.push(value);
      buffered += value.length;
      report(p.have + buffered);
      if (buffered >= PIECE) await flush();
    }
    await flush();
  } catch (e) {
    if (e instanceof ChecksumError || e instanceof StorageFull) throw e;
    // Keep what came (a storage failure here is the error to show), else it's the connection.
    await flush();
    changed();
    if ((e as Error)?.name === "AbortError") throw e;
    throw new DownloadPaused(p.have, file.bytes);
  }
  if (p.have < file.bytes) { changed(); throw new DownloadPaused(p.have, file.bytes); }
  return p;
}

/** The file is kept (or given up on): drop its pieces. */
export async function finishDownload(...shas: (string | null | undefined)[]): Promise<void> {
  for (const sha of shas) if (sha) await withPieces(sha, () => db().drop(sha)).catch(() => {});
  changed();
}

/** Half-finished downloads on this device (never a saved copy), oldest first. */
export async function partialDownloads(): Promise<PartialDownload[]> {
  const list = await db().list().catch(() => [] as PartialDownload[]);
  return list.sort((a, b) => a.startedAt - b.startedAt);
}

/** Drop a half download (Delete on a paused row). */
/** Drop a half download (Delete on a paused row), only if no tab is working on it right now: false when one is
 *  (it may be downloading or saving it), so nothing in use is pulled away and no space is claimed as freed. */
export async function dropPartial(sha: string): Promise<boolean> {
  const dropped = await dropIfIdle(sha).catch(() => false);
  changed();
  return dropped;
}
