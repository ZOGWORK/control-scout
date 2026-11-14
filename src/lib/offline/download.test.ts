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
import { ChecksumError, DownloadPaused, PIECE, download, finishDownload, partialDownloads, resetDownloadStore, type DownloadOwner } from "./download";
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
