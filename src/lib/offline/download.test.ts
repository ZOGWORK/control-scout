// @vitest-environment jsdom
// The shared downloader: what came is kept as it comes, a dropped connection resumes with a Range request
// instead of starting over, a server that ignores the range or a changed file starts cleanly from the first
// byte, and nothing is ever handed back (or kept as saved) unless the whole file matches its SHA-256.
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resumeMarks, wantResume } from "./resumeMarks";
import { ChecksumError, DownloadPaused, NoConnection, PIECE, STALL, StorageError, StorageFull, download, txError, finishDownload, partialDownloads, resetDownloadStore, type DownloadOwner } from "./download";
import { deviceItems, pausedItems, totalBytes, whatChanged } from "./storage";
import { downloadLite, getv, packStatus, removeLite, syncLite, type PackFile, type PackManifest } from "../packs";

const owner: DownloadOwner = { kind: "season", id: "2026", label: "2026–27 season" };
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = (n: number, seed = 7) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * seed + 3) % 251; return b; };

/** A body that sends `upTo` bytes of `data` and then fails, as a dropped connection does. */
function dying(data: Uint8Array, upTo: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= upTo) { c.error(new TypeError("network error")); return; }
      const n = Math.min(64 * 1024, upTo - sent);
      c.enqueue(data.slice(sent, sent + n));
      sent += n;
    },
  });
}

/** A server that honours `Range: bytes=N-` with a 206 (or ignores it, `ranges: false`), dying after `cut` bytes on the first request. */
function server(data: Uint8Array, opts: { cut?: number; ranges?: boolean; etag?: string } = {}) {
  const calls: { range: string | null; ifRange: string | null; sent: number }[] = [];
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    const range = h.get("Range");
    const start = range && opts.ranges !== false ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    const body = data.slice(start);
    const first = calls.length === 0;
    calls.push({ range, ifRange: h.get("If-Range"), sent: first && opts.cut != null ? opts.cut - start : body.length });
    const headers: Record<string, string> = { ETag: opts.etag ?? '"v1"' };
    const stream = first && opts.cut != null ? dying(body, opts.cut) : new Response(body).body!;
    if (start > 0) return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${data.length - 1}/${data.length}` } });
    return new Response(stream, { status: 200, headers });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

beforeEach(async () => {
  resetDownloadStore();
  for (const p of await partialDownloads()) await finishDownload(p.sha256);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("resuming", () => {
  it("keeps what came when the connection drops, then asks only for the rest (206) and finishes", async () => {
    const data = bytes(PIECE * 3 + 1234);
    const file = { url: "/packs/a.db.gz", bytes: data.length, sha256: sha(data) };
    const s = server(data, { cut: PIECE + 100_000 });
    const progress: number[] = [];
    await expect(download(file, { owner, fetch: s.fn, onProgress: (d) => progress.push(d) })).rejects.toBeInstanceOf(DownloadPaused);

    // Paused: listed as paused with what's here, never as saved.
    const [p] = await partialDownloads();
    expect(p).toMatchObject({ sha256: file.sha256, have: PIECE + 100_000, bytes: data.length, owner });
    expect(p.verified).toBeFalsy();
    expect(pausedItems([p])[0]).toMatchObject({ label: "2026–27 season", have: PIECE + 100_000, total: data.length, pct: Math.floor(((PIECE + 100_000) / data.length) * 100) });
    expect(deviceItems(null, [], [])).toEqual([]);

    // Reopened later (a fresh store over the same IndexedDB): resumes from the byte it stopped at.
    resetDownloadStore();
    const got = await download(file, { owner, fetch: s.fn, onProgress: (d) => progress.push(d) });
    expect(s.calls[1].range).toBe(`bytes=${PIECE + 100_000}-`);
    expect(s.calls[1].ifRange).toBe('"v1"');
    expect(s.calls[1].sent).toBe(data.length - PIECE - 100_000); // only the rest came again
    expect(sha(got)).toBe(file.sha256);
    expect(progress.at(-1)).toBe(data.length);
    expect(Math.max(...progress)).toBe(data.length); // never counts past the file

    // Kept by the caller: the pieces go.
    await finishDownload(file.sha256);
    expect(await partialDownloads()).toEqual([]);
  });

  it("a server that ignores the Range (200) starts cleanly from the first byte", async () => {
    const data = bytes(PIECE * 2 + 5, 11);
    const file = { url: "/packs/b", bytes: data.length, sha256: sha(data) };
    const s = server(data, { cut: PIECE + 10, ranges: false });
    await expect(download(file, { owner, fetch: s.fn })).rejects.toBeInstanceOf(DownloadPaused);
    const got = await download(file, { owner, fetch: s.fn });
    expect(s.calls[1].range).toBe(`bytes=${PIECE + 10}-`);
    expect(sha(got)).toBe(file.sha256);
  });

  it("a weak ETag isn't sent as If-Range (the checksum still vouches for the bytes)", async () => {
    const data = bytes(PIECE + 50);
    const file = { url: "/packs/c", bytes: data.length, sha256: sha(data) };
    const s = server(data, { cut: 1000, etag: 'W/"abc"' });
    await expect(download(file, { owner, fetch: s.fn })).rejects.toBeInstanceOf(DownloadPaused);
    await download(file, { owner, fetch: s.fn });
    expect(s.calls[1].range).toBe("bytes=1000-");
    expect(s.calls[1].ifRange).toBeNull();
  });

  it("a range of a different file (another total) drops the pieces and fetches the whole file", async () => {
    const data = bytes(PIECE + 50);
    const file = { url: "/packs/d", bytes: data.length, sha256: sha(data) };
    const s = server(data, { cut: 2000 });
    await expect(download(file, { owner, fetch: s.fn })).rejects.toBeInstanceOf(DownloadPaused);
    let n = 0;
    const odd = vi.fn(async (url: string, init?: RequestInit) => {
      if (n++ === 0) return new Response(data.slice(2000), { status: 206, headers: { "Content-Range": `bytes 2000-${data.length + 9}/${data.length + 10}` } });
      return (s.fn as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;
    const got = await download(file, { owner, fetch: odd });
    expect(sha(got)).toBe(file.sha256);
    expect(new Headers((odd as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1]?.headers).get("Range")).toBeNull();
  });

  it("a resumed file that comes out wrong is fetched once more from scratch, and right then", async () => {
    const data = bytes(PIECE + 50);
    const file = { url: "/packs/e", bytes: data.length, sha256: sha(data) };
    // The first try stored the wrong first 3000 bytes (a different file under the same name).
    const wrong = bytes(PIECE + 50, 13);
    const bad = server(wrong, { cut: 3000 });
    await expect(download(file, { owner, fetch: bad.fn })).rejects.toBeInstanceOf(DownloadPaused);
    const good = server(data);
    const got = await download(file, { owner, fetch: good.fn });
    expect(sha(got)).toBe(file.sha256);
    expect(good.calls.map((c) => c.range)).toEqual(["bytes=3000-", null]);
  });

  it("a newer release of the same pack drops the old half download", async () => {
    const old = bytes(PIECE + 50, 3), now = bytes(PIECE + 60, 5);
    await expect(download({ url: "/packs/old", bytes: old.length, sha256: sha(old) }, { owner, fetch: server(old, { cut: 900 }).fn })).rejects.toBeInstanceOf(DownloadPaused);
    await download({ url: "/packs/new", bytes: now.length, sha256: sha(now) }, { owner, fetch: server(now).fn });
    expect((await partialDownloads()).map((p) => p.sha256)).toEqual([sha(now)]);
  });
});

describe("checksums", () => {
  it("a whole file that doesn't match is never handed back, and nothing of it is kept", async () => {
    const data = bytes(4000), other = bytes(4000, 9);
    const file = { url: "/packs/f", bytes: data.length, sha256: sha(data) };
    await expect(download(file, { owner, fetch: server(other).fn })).rejects.toBeInstanceOf(ChecksumError);
    expect(await partialDownloads()).toEqual([]);
  });

  it("a body longer than the file is refused", async () => {
    const data = bytes(4000);
    const file = { url: "/packs/g", bytes: 3000, sha256: sha(data.slice(0, 3000)) };
    await expect(download(file, { owner, fetch: server(data).fn })).rejects.toBeInstanceOf(ChecksumError);
  });
});

describe("the lite pack through the downloader", () => {
  const gz = new Uint8Array(gzipSync(JSON.stringify({ format: 1, version: "v1", books: {}, teams: [] })));
  const lite: PackFile = { name: "scout-pack-v1-lite.json.gz", url: "/packs/lite.json.gz", bytes: gz.length, sha256: sha(gz), seasons: [2026], kind: "lite", contents: "" };
  const manifest = { format: 1, version: "v1", builtAt: "2026-11-13T20:09:39Z", engineVersion: "3.5.0", dataAsOf: "2026-11-13T19:58:54Z", lite, full: [] } as PackManifest;

  it("Delete marks the pack deleted before it touches storage, so a sync saving in another tab meanwhile takes back its write", async () => {
    // A background sync checks the mark after its write. Were the mark set only after Delete's own storage work,
    // a sync whose write landed after Delete's del (and whose check ran before the mark) would leave bytes behind.
    vi.stubGlobal("fetch", server(gz).fn);
    await downloadLite(lite, manifest);
    const deleting = removeLite();
    expect(localStorage.getItem("cs-lite-deleted")).toBe("1"); // already, before any await
    expect(await deleting).toBe(gz.length);
    expect(packStatus()).toBeNull();
    localStorage.removeItem("cs-lite-deleted");
  });

  it("a wrong file never becomes the saved copy", async () => {
    vi.stubGlobal("fetch", server(bytes(gz.length)).fn);
    await expect(downloadLite(lite, manifest)).rejects.toThrow(/checksum/);
    expect(packStatus()).toBeNull();
    expect(await getv("lite-gz")).toBeUndefined();
  });

  it("an interrupted one is paused, not saved; Delete really deletes and says how much it freed", async () => {
    const big = new Uint8Array(PIECE + 200); big.set(gz);
    const bigFile = { ...lite, bytes: big.length, sha256: sha(big) };
    vi.stubGlobal("fetch", server(big, { cut: 700 }).fn);
    await expect(downloadLite(bigFile, manifest)).rejects.toBeInstanceOf(DownloadPaused);
    expect(packStatus()).toBeNull();
    expect(pausedItems(await partialDownloads())).toHaveLength(1);

    vi.stubGlobal("fetch", server(gz).fn);
    await downloadLite(lite, manifest);
    expect(packStatus()).toMatchObject({ version: "v1", bytes: gz.length, dataAsOf: manifest.dataAsOf });
    expect(await partialDownloads()).toEqual([]); // the old half download went with the newer file; the kept file's pieces after the save

    expect(await removeLite()).toBe(gz.length);
    expect(await getv("lite-gz")).toBeUndefined(); // deleted, not overwritten with null
    expect(packStatus()).toBeNull();
  });

  it("Delete also drops a paused download of a newer release and its pick-up mark, and counts it as freed", async () => {
    vi.stubGlobal("fetch", server(gz).fn);
    await downloadLite(lite, manifest);
    const big = new Uint8Array(PIECE + 200); big.set(gz);
    const next = { ...lite, url: "/packs/lite-v2.json.gz", bytes: big.length, sha256: sha(big) };
    vi.stubGlobal("fetch", server(big, { cut: 700 }).fn);
    wantResume("lite", "lite");
    await expect(downloadLite(next, { ...manifest, version: "v2" })).rejects.toBeInstanceOf(DownloadPaused);
    expect(await partialDownloads()).toHaveLength(1);

    expect(await removeLite()).toBe(gz.length + 700);
    expect(await getv("lite-gz")).toBeUndefined();
    expect(await partialDownloads()).toEqual([]);
    expect(resumeMarks()).toEqual([]);
    localStorage.removeItem("cs-lite-deleted");
  });

  it("Get it: a connection that drops before a byte came keeps it marked to pick up; a bad file doesn't", async () => {
    const { getLite } = await import("./resume");
    const respond = (lite: (url: string) => Response | Promise<Response>) => vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).endsWith("latest.json") ? new Response(JSON.stringify(manifest)) : lite(String(url)))));
    respond(() => { throw new TypeError("Failed to fetch"); });
    await expect(getLite("v1")).rejects.toThrow(/Couldn't finish/);
    expect(await partialDownloads()).toEqual([]); // nothing came
    expect(resumeMarks().map((m) => m.key)).toEqual(["lite:lite"]);

    respond(() => new Response(bytes(gz.length)));
    await expect(getLite("v1")).rejects.toThrow(/Couldn't finish/);
    expect(resumeMarks()).toEqual([]);
  });

  it("a Delete whose half-download tidy-up fails still counts as done", async () => {
    vi.stubGlobal("fetch", server(gz).fn);
    await downloadLite(lite, manifest);
    const store = await import("./download");
    vi.spyOn(store, "partialDownloads").mockRejectedValueOnce(new Error("idb broke"));
    expect(await removeLite()).toBe(gz.length);
    expect(packStatus()).toBeNull();
    localStorage.removeItem("cs-lite-deleted");
  });

  it("a Delete made while a background sync is downloading (another tab) isn't undone when it finishes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("latest.json")) return new Response(JSON.stringify(manifest));
      localStorage.setItem("cs-lite-deleted", "1"); // deleted in another tab while the bytes come
      return new Response(gz);
    }));
    await syncLite({ allowed: () => true });
    expect(packStatus()).toBeNull();
    expect(await getv("lite-gz")).toBeUndefined();
    expect(localStorage.getItem("cs-lite-deleted")).toBe("1");
    expect(await partialDownloads()).toEqual([]); // its pieces went too
    localStorage.removeItem("cs-lite-deleted");
  });

  it("a Delete made in another tab while a background sync saves (after the bytes came) isn't undone either", async () => {
    vi.stubGlobal("fetch", server(gz).fn);
    const set = localStorage.setItem.bind(localStorage);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      set(k, v);
      if (k === "cs-pack-meta") set("cs-lite-deleted", "1"); // the other tab's Delete lands during the save
    });
    expect(await downloadLite(lite, manifest, undefined, { background: true })).toBeNull();
    spy.mockRestore();
    expect(packStatus()).toBeNull();
    expect(await getv("lite-gz")).toBeUndefined();
    expect(localStorage.getItem("cs-lite-deleted")).toBe("1");
    localStorage.removeItem("cs-lite-deleted");
  });

  it("after a Delete, the background sync leaves it off; the person's own Download brings it back", async () => {
    vi.stubGlobal("fetch", server(gz).fn);
    await downloadLite(lite, manifest);
    await removeLite();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(String(url)); return String(url).endsWith("latest.json") ? new Response(JSON.stringify(manifest)) : new Response(gz); }));
    expect(await syncLite({ allowed: () => true })).toBeNull();
    expect(calls).toEqual(["/packs/latest.json"]); // the manifest only, never the pack
    expect(await syncLite()).toMatchObject({ version: "v1" });
    expect(packStatus()).toMatchObject({ version: "v1" });
    await removeLite();
    localStorage.removeItem("cs-lite-deleted");
  });
});

describe("event packs", () => {
  it("a failed one keeps no pieces (it starts again, and nothing hides in storage)", async () => {
    const data = bytes(PIECE + 500);
    const file = { url: "/api/bundles/2026/X/file", bytes: data.length, sha256: sha(data) };
    const e = await download(file, { owner: { kind: "bundle", id: "2026:X", label: "X" }, fetch: server(data, { cut: 1000 }).fn }).catch((x) => x);
    expect(e).not.toBeInstanceOf(DownloadPaused); // nothing is kept, so it never says "picks up from there"
    expect(String(e.message)).toMatch(/connection dropped/);
    expect(await partialDownloads()).toEqual([]);
  });
  it("one left half-done by a tab that closed is swept away, while one a live tab is running stays", async () => {
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { locks: { request: lockRequest(new Map()) } }));
    vi.resetModules();
    const tabA = await import("./download");
    vi.resetModules();
    const tabB = await import("./download");
    const data = bytes(PIECE * 2 + 5, 11);
    let sent = 0;
    const gate = new Promise<void>(() => {}); // the tab closes before the rest ever comes
    const stalls = (async () => new Response(new ReadableStream({
      async pull(c) {
        if (sent >= PIECE) await gate;
        c.enqueue(data.slice(sent, sent + PIECE));
        sent += PIECE;
      },
    }))) as unknown as typeof fetch;
    void tabA.download({ url: "/api/bundles/2026/Y/file", bytes: data.length, sha256: sha(data) }, { owner: { kind: "bundle", id: "2026:Y", label: "Y" }, fetch: stalls }).catch(() => {});
    // Running in tab A: tab B leaves it alone.
    await vi.waitFor(async () => expect((await tabB.partialDownloads()).some((p) => p.sha256 === sha(data) && p.have >= PIECE)).toBe(true));
    // Tab A closes: the browser lets go of its locks. Nothing will ever resume an event pack, so it goes.
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { locks: { request: lockRequest(new Map()) } }));
    expect(await tabB.partialDownloads()).toEqual([]);
    vi.resetModules();
    const tabC = await import("./download");
    expect(await tabC.partialDownloads()).toEqual([]); // its pieces and row are gone for good
  });
});

/** Web Locks as a browser gives them: one holder per name across every tab (here: module instances), ifAvailable included. */
function lockRequest(held: Map<string, Promise<unknown>>) {
  const busy = new Set<string>();
  return (name: string, a: unknown, b?: unknown) => {
    const fn = (typeof a === "function" ? a : b) as (lock: unknown) => Promise<unknown>;
    const opts = (typeof a === "function" ? {} : a) as { ifAvailable?: boolean };
    if (opts.ifAvailable && busy.has(name)) return fn(null);
    const run = (held.get(name) ?? Promise.resolve()).catch(() => {}).then(async () => { busy.add(name); try { return await fn({ name }); } finally { busy.delete(name); } });
    held.set(name, run);
    return run;
  };
}

describe("callers sharing one download", () => {
  /** Sends the first piece, then waits for `go` before the rest. Records each request's signal. */
  function gated(data: Uint8Array) {
    let go!: () => void;
    const gate = new Promise<void>((r) => { go = r; });
    const signals: AbortSignal[] = [];
    const fn = vi.fn(async (_u: string, init?: RequestInit) => {
      signals.push(init!.signal!);
      let sent = 0;
      return new Response(new ReadableStream({
        async pull(c) {
          if (sent >= data.length) { c.close(); return; }
          if (sent >= PIECE) await gate;
          const n = Math.min(PIECE, data.length - sent);
          c.enqueue(data.slice(sent, sent + n));
          sent += n;
        },
      }));
    });
    return { fn: fn as unknown as typeof fetch, calls: fn, signals, go: () => go() };
  }

  it("a second caller hears progress, and its Stop leaves only it: the first still gets the file", async () => {
    const data = bytes(PIECE * 2 + 9, 5);
    const file = { url: "/packs/shared", bytes: data.length, sha256: sha(data) };
    const s = gated(data);
    const a = download(file, { owner, fetch: s.fn });
    const stopB = new AbortController();
    const seenB: number[] = [];
    const b = download(file, { owner, fetch: s.fn, signal: stopB.signal, onProgress: (d) => seenB.push(d) });
    await vi.waitFor(() => expect(Math.max(0, ...seenB)).toBeGreaterThanOrEqual(PIECE));
    stopB.abort();
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
    expect(s.signals[0].aborted).toBe(false); // the first caller still wants it
    const heardB = seenB.length;
    s.go();
    expect(sha(await a)).toBe(file.sha256);
    expect(seenB).toHaveLength(heardB); // a caller that stopped hears nothing more
    expect(s.calls).toHaveBeenCalledTimes(1); // one run for both
    await finishDownload(file.sha256);
  });

  it("the download itself stops once every caller has stopped", async () => {
    const data = bytes(PIECE * 2 + 9, 3);
    const file = { url: "/packs/stopped", bytes: data.length, sha256: sha(data) };
    const s = gated(data);
    const stopA = new AbortController(), stopB = new AbortController();
    const a = download(file, { owner, fetch: s.fn, signal: stopA.signal });
    const b = download(file, { owner, fetch: s.fn, signal: stopB.signal });
    await vi.waitFor(() => expect(s.signals).toHaveLength(1));
    stopA.abort();
    expect(s.signals[0].aborted).toBe(false);
    stopB.abort();
    expect(s.signals[0].aborted).toBe(true);
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
    s.go();
    await finishDownload(file.sha256); // waits for the stopped run to let go of its pieces
  });

  it("Download again right after Stop starts afresh once the stopped run lets go, never fails as stopped", async () => {
    const data = bytes(PIECE * 2 + 9, 11);
    const file = { url: "/packs/restart", bytes: data.length, sha256: sha(data) };
    // A fetch whose body, once stopped, ends with an AbortError, but only when let go (the run is slow to end).
    let go!: () => void;
    const gate = new Promise<void>((r) => { go = r; });
    const slow = vi.fn(async (_u: string, init?: RequestInit) => {
      let sent = 0;
      return new Response(new ReadableStream({
        async pull(c) {
          if (sent >= PIECE) { await gate; if (init?.signal?.aborted) { c.error(new DOMException("stopped", "AbortError")); return; } }
          if (sent >= data.length) { c.close(); return; }
          const n = Math.min(PIECE, data.length - sent);
          c.enqueue(data.slice(sent, sent + n));
          sent += n;
        },
      }));
    }) as unknown as typeof fetch;
    const stop = new AbortController();
    const a = download(file, { owner, fetch: slow, signal: stop.signal });
    await vi.waitFor(() => expect((slow as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1));
    stop.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    // The stopped run hasn't ended yet: Download again now, then let the old run go.
    const again = server(data);
    const b = download(file, { owner, fetch: again.fn });
    go();
    expect(sha(await b)).toBe(file.sha256);
    expect(again.calls.length).toBeGreaterThan(0);
    await finishDownload(file.sha256);
  });
});

describe("a connection that drops before anything came", () => {
  it("never promises kept bytes: a plain try-again, and no paused row", async () => {
    const data = bytes(PIECE + 10, 13);
    const file = { url: "/packs/nothing", bytes: data.length, sha256: sha(data) };
    const e = await download(file, { owner, fetch: server(data, { cut: 0 }).fn }).catch((x) => x);
    expect(e).not.toBeInstanceOf(DownloadPaused);
    expect(e).toBeInstanceOf(NoConnection); // the connection's doing: a download the person started picks up once it's back
    expect(String(e.message)).toMatch(/Try again|offline/);
    expect(String(e.message)).not.toMatch(/kept/);
    expect(await partialDownloads()).toEqual([]);
    // A body that ends at zero bytes says the same.
    const empty = (async () => new Response(new Uint8Array(0), { status: 200 })) as unknown as typeof fetch;
    const e2 = await download(file, { owner, fetch: empty }).catch((x) => x);
    expect(e2).not.toBeInstanceOf(DownloadPaused);
    expect(await partialDownloads()).toEqual([]);
  });
});

describe("a try that hangs (right after the line comes back)", () => {
  const saved = { ...STALL };
  beforeEach(() => { Object.assign(STALL, { ms: 60, retries: 3, pauseMs: 0 }); });
  afterEach(() => { Object.assign(STALL, saved); });

  /** Answers nothing (headers never come) until the request is given up on, as a hung request does. */
  const hung = (init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
  });
  /** Headers, then `upTo` bytes, then silence (the body never ends) until given up on. */
  function silentAfter(data: Uint8Array, upTo: number, init?: RequestInit): Response {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (!sent) { sent = true; c.enqueue(data.slice(0, upTo)); return; }
        return new Promise<void>((_res, rej) => init?.signal?.addEventListener("abort", () => { const e = new DOMException("aborted", "AbortError"); c.error(e); rej(e); }));
      },
    });
    return new Response(body, { status: 200, headers: { ETag: '"v1"' } });
  }

  it("one with no answer is given up on after STALL.ms and asked again at once: the file comes, no pause", async () => {
    const data = bytes(PIECE + 99, 5);
    const file = { url: "/packs/hang", bytes: data.length, sha256: sha(data) };
    const ok = server(data);
    let n = 0;
    const fetch = vi.fn(async (u: string, init?: RequestInit) => (n++ < 2 ? hung(init) : ok.fn(u, init)));
    const t0 = Date.now();
    const got = await download(file, { owner, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(sha(got)).toBe(file.sha256);
    expect(fetch).toHaveBeenCalledTimes(3); // two hung tries abandoned, the third came
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("a body that goes silent mid-way keeps what came and asks for the rest (Range), not from the start", async () => {
    const data = bytes(PIECE * 2 + 7, 3);
    const file = { url: "/packs/silent", bytes: data.length, sha256: sha(data) };
    const ok = server(data);
    let n = 0;
    const fetch = vi.fn(async (u: string, init?: RequestInit) => (n++ === 0 ? silentAfter(data, PIECE + 10, init) : ok.fn(u, init)));
    const got = await download(file, { owner, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(sha(got)).toBe(file.sha256);
    expect(ok.calls[0].range).toBe(`bytes=${PIECE + 10}-`);
  });

  it("every try hangs: it pauses as a dropped connection does (what came is kept), never hangs on", async () => {
    const data = bytes(PIECE * 2, 9);
    const file = { url: "/packs/dead", bytes: data.length, sha256: sha(data) };
    let n = 0;
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => (n++ === 0 ? silentAfter(data, PIECE + 10, init) : hung(init)));
    const e = await download(file, { owner, fetch: fetch as unknown as typeof globalThis.fetch }).catch((x) => x);
    expect(e).toBeInstanceOf(DownloadPaused);
    expect(fetch).toHaveBeenCalledTimes(1 + STALL.retries);
    expect((await partialDownloads())[0]).toMatchObject({ have: PIECE + 10 });
  });

  it("Stop while a try hangs is a Stop (no retry, no pause)", async () => {
    const data = bytes(PIECE, 4);
    const file = { url: "/packs/stop", bytes: data.length, sha256: sha(data) };
    STALL.ms = 10_000;
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => hung(init));
    const ctrl = new AbortController();
    const p = download(file, { owner, fetch: fetch as unknown as typeof globalThis.fetch, signal: ctrl.signal }).catch((x) => x);
    await new Promise((r) => setTimeout(r, 20));
    ctrl.abort();
    expect((await p).name).toBe("AbortError");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("storage failures", () => {
  it("a write the device refuses (not for room) is said as a storage problem, never as a dropped connection", async () => {
    const data = bytes(PIECE + 10, 9);
    const file = { url: "/packs/refused", bytes: data.length, sha256: sha(data) };
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "pieces") throw new DOMException("The database connection is closing.", "InvalidStateError");
      return put.apply(this, a);
    });
    const e = await download(file, { owner, fetch: server(data).fn }).catch((x) => x);
    spy.mockRestore();
    expect(e).toBeInstanceOf(StorageError);
    expect(e).not.toBeInstanceOf(DownloadPaused);
    expect(String(e.message)).toMatch(/storage/);
    await finishDownload(file.sha256);
  });
});

describe("a device that runs out of room mid-download", () => {
  it("lets the connection go at once (the body is cancelled), and says it's full", async () => {
    const data = bytes(PIECE * 3, 13);
    const file = { url: "/packs/full", bytes: data.length, sha256: sha(data) };
    let cancelled = false, sent = 0;
    const fetchFull = (async () => new Response(new ReadableStream<Uint8Array>({
      pull(c) { if (sent >= data.length) { c.close(); return; } const n = Math.min(PIECE, data.length - sent); c.enqueue(data.slice(sent, sent + n)); sent += n; },
      cancel() { cancelled = true; },
    }))) as unknown as typeof fetch;
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "pieces") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return put.apply(this, a);
    });
    const e = await download(file, { owner, fetch: fetchFull }).catch((x) => x);
    spy.mockRestore();
    expect(e).toBeInstanceOf(StorageFull);
    expect(cancelled).toBe(true);
    await finishDownload(file.sha256);
  });
});

describe("two downloads of one file", () => {
  it("in two tabs, take turns on its pieces: the first tab's cleanup waits until the second has read them back", async () => {
    // Web Locks as a browser gives them: one holder per name, across every tab (here: two module instances).
    const held = new Map<string, Promise<unknown>>();
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { locks: {
      request: lockRequest(held),
    } }));
    vi.resetModules();
    const tabA = await import("./download");
    vi.resetModules();
    const tabB = await import("./download");
    const data = bytes(PIECE * 2 + 9);
    const file = { url: "/packs/h", bytes: data.length, sha256: sha(data) };
    const fetchA = server(data).fn;
    const fetchB = vi.fn(server(data).fn as unknown as (...a: unknown[]) => Promise<Response>);
    const a = tabA.download(file, { owner, fetch: fetchA });
    const b = tabB.download(file, { owner, fetch: fetchB as unknown as typeof fetch });
    // Tab A saves its copy and drops the pieces as soon as it has them.
    const aDone = a.then(() => tabA.finishDownload(file.sha256));
    expect(sha(await a)).toBe(file.sha256);
    expect(sha(await b)).toBe(file.sha256); // not a checksum failure: B read the pieces before A's cleanup
    expect(fetchB).not.toHaveBeenCalled(); // B found the whole verified file already on the device
    await aDone;
    await tabB.finishDownload(file.sha256);
    expect(await tabA.partialDownloads()).toEqual([]);
  });
  it("Delete on a paused row in another tab never waits for, or pulls away, a download that's running", async () => {
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { locks: { request: lockRequest(new Map()) } }));
    vi.resetModules();
    const tabA = await import("./download");
    vi.resetModules();
    const tabB = await import("./download");
    const data = bytes(PIECE * 2 + 3, 7);
    let go!: () => void;
    const gate = new Promise<void>((r) => { go = r; });
    let sent = 0;
    const slow = vi.fn(async () => new Response(new ReadableStream({
      async pull(c) {
        if (sent >= data.length) { c.close(); return; }
        if (sent >= PIECE) await gate;
        const n = Math.min(PIECE, data.length - sent);
        c.enqueue(data.slice(sent, sent + n));
        sent += n;
      },
    }))) as unknown as typeof fetch;
    const a = tabA.download({ url: "/packs/busy", bytes: data.length, sha256: sha(data) }, { owner, fetch: slow });
    await vi.waitFor(async () => expect((await tabB.partialDownloads()).some((p) => p.sha256 === sha(data) && p.have >= PIECE)).toBe(true));
    expect(await tabB.dropPartial(sha(data))).toBe(false); // answered at once: A holds it
    go();
    expect(sha(await a)).toBe(sha(data)); // A's pieces were all still there
    expect(await tabB.dropPartial(sha(data))).toBe(true); // idle now: Delete works
  });

  it("a tab saving a newer release leaves another tab's older download alone while it runs", async () => {
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { locks: { request: lockRequest(new Map()) } }));
    vi.resetModules();
    const tabA = await import("./download");
    vi.resetModules();
    const tabB = await import("./download");
    const old = bytes(PIECE * 2 + 3, 3), now = bytes(PIECE + 9, 5);
    // Tab A's old-release download stalls after its first piece until let go.
    let go!: () => void;
    const gate = new Promise<void>((r) => { go = r; });
    let sent = 0;
    const slow = vi.fn(async () => new Response(new ReadableStream({
      async pull(c) {
        if (sent >= old.length) { c.close(); return; }
        if (sent >= PIECE) await gate;
        const n = Math.min(PIECE, old.length - sent);
        c.enqueue(old.slice(sent, sent + n));
        sent += n;
      },
    }))) as unknown as typeof fetch;
    const a = tabA.download({ url: "/packs/old", bytes: old.length, sha256: sha(old) }, { owner, fetch: slow });
    await vi.waitFor(async () => expect((await tabB.partialDownloads()).some((p) => p.sha256 === sha(old) && p.have >= PIECE)).toBe(true));
    // Tab B saves the newer release of the same pack meanwhile.
    expect(sha(await tabB.download({ url: "/packs/new", bytes: now.length, sha256: sha(now) }, { owner, fetch: server(now).fn }))).toBe(sha(now));
    go();
    expect(sha(await a)).toBe(sha(old)); // A's pieces were left alone: its file still comes out whole
    await tabA.finishDownload(sha(old));
    await tabB.finishDownload(sha(now));
  });
});

describe("storage list", () => {
  it("every pack with its size here, and one total (half downloads count what they hold)", () => {
    const lite = { version: "v", bytes: 4_150_509, savedAt: 1, builtAt: "2026-11-13T20:09:39Z", engineVersion: "3.5.0", dataAsOf: "2026-11-13T19:58:54Z" };
    const seasons = [{ season: 2025, version: "v", sha256: "a", bytes: 44_433_408, savedAt: 1, dataAsOf: null, builtAt: "b" }, { season: 2026, version: "v", sha256: "b", bytes: 6_922_240, savedAt: 1, dataAsOf: "2026-11-13T19:58:54Z", builtAt: "b" }];
    const bundles = [{ season: 2026, code: "USMIMIQ1", name: "Bullock Creek Qualifier", end: "2026-11-07", version: "x", sha256: "s", bytes: 31_949, savedAt: 1, builtAt: "b", dataAsOf: null, team: null, workspace: null, reports: 0, reportKeys: [], teams: [], picklist: false }];
    const items = deviceItems(lite, seasons, bundles as never);
    expect(items.map((i) => [i.label, i.bytes])).toEqual([
      ["Predictions for every team", 4_150_509], ["2026–27 season", 6_922_240], ["2025–26 season", 44_433_408], ["Bullock Creek Qualifier", 31_949],
    ]);
    expect(totalBytes(items, [{ have: 1000 }])).toBe(4_150_509 + 6_922_240 + 44_433_408 + 31_949 + 1000);
  });

  it("says what a newer release brings, in plain words", () => {
    const now = new Date("2026-11-15T12:00:00");
    const at = "2026-11-14T09:02:00";
    expect(whatChanged({ dataAsOf: null, stats: { matches: 100, events: 4 } }, { dataAsOf: at, stats: { matches: 314, events: 7 } }, now)).toBe("Newer data from Nov 14, 9:02 AM · 214 new matches from 3 more events");
    expect(whatChanged({ dataAsOf: null, stats: { matches: 100, events: 4 } }, { dataAsOf: at, stats: { matches: 101, events: 4 } }, now)).toBe("Newer data from Nov 14, 9:02 AM · 1 new match");
    expect(whatChanged({ dataAsOf: null }, { dataAsOf: at, stats: { matches: 1, events: 1 } }, now)).toBe("Newer data from Nov 14, 9:02 AM");
  });
});

describe("app updates keep the packs", () => {
  it("the service worker never deletes IndexedDB (only its own old caches)", () => {
    const sw = readFileSync(join(process.cwd(), "src", "sw.template.js"), "utf8");
    expect(sw).not.toMatch(/deleteDatabase|\.clear\(\)|objectStore\([^)]*\)\.delete/);
    expect(sw).toMatch(/caches\.delete\(old\)/);
  });
});

describe("a write that fails", () => {
  it("says the request's own error (a full device), not the transaction's empty one", () => {
    const full = new DOMException("The quota has been exceeded.", "QuotaExceededError");
    expect(txError({ target: { error: full } }, { error: null })).toBe(full);
    expect((txError({ target: null }, { error: null }) as Error).message).toBe("Storage write failed.");
  });
});
