// @vitest-environment jsdom
// Photos on the device: the compression maths, EXIF never leaving (the photo is
// re-encoded from pixels), the three-step upload, and photo lists from the
// server winning over the device's copy even when a text edit is queued.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canRemovePhoto, compressPhoto, fitWithin, jpegHasExif, PhotoError, uploadEntryPhoto, type CompressDeps } from "./photos";
import { adoptServerEntry, applyLiveEntries, localScoutEntries, saveScoutEntry, type ScoutEntry } from "./scouting";
import { PHOTO_LIMITS } from "../shared/photos";

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** A JPEG as a phone writes it: SOI, an APP1 Exif block (with a GPS tag), then image data. */
function phoneJpeg(): Uint8Array {
  const exif = new TextEncoder().encode("Exif\0\0MM\0*GPSLatitude=40.7");
  const len = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...exif, 0xff, 0xdb, 0x00, 0x04, 1, 2, 0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9]);
}
/** What a canvas encodes: SOI, JFIF, quant table, scan. No EXIF. */
const canvasJpeg = (size = 64) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xda, ...new Array(Math.max(0, size - 22)).fill(5)]);

describe("compression", () => {
  it("fits the long edge into 1600 px, keeping the shape; never enlarges", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(4000, 1000)).toEqual({ width: 1600, height: 400 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
    expect(fitWithin(10000, 3)).toEqual({ width: 1600, height: 1 });
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(PHOTO_LIMITS).toMatchObject({ maxEdge: 1600, quality: 0.8, perEntry: 6 });
  });

  it("finds an EXIF block in a phone's JPEG, and none in a canvas's", () => {
    expect(jpegHasExif(phoneJpeg())).toBe(true);
    expect(jpegHasExif(canvasJpeg())).toBe(false);
    expect(jpegHasExif(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("re-encodes from pixels: the original bytes (and their EXIF) never reach the upload", async () => {
    const decoded = { width: 4032, height: 3024, close: vi.fn() };
    const encode = vi.fn<CompressDeps["encode"]>(async () => new Blob([canvasJpeg()], { type: "image/jpeg" }));
    const deps: CompressDeps = { decode: vi.fn(async () => decoded), encode };
    const original = new Blob([phoneJpeg()], { type: "image/jpeg" });
    const out = await compressPhoto(original, deps);
    expect(encode).toHaveBeenCalledWith(decoded, 1600, 1200, 0.8); // drawn from the decoded image, not the file
    const bytes = new Uint8Array(await out.arrayBuffer());
    expect(jpegHasExif(bytes)).toBe(false);
    expect(out.type).toBe("image/jpeg");
    expect(decoded.close).toHaveBeenCalled();
  });

  it("steps the quality down when a photo is still too big, then gives up with a message", async () => {
    const sizes: number[] = [];
    const deps: CompressDeps = {
      decode: async () => ({ width: 2000, height: 1000 }),
      encode: async (_i, _w, _h, q) => { sizes.push(q); return new Blob([new Uint8Array(q > 0.6 ? PHOTO_LIMITS.maxBytes + 1 : 1000)]); },
    };
    expect((await compressPhoto(new Blob([]), deps)).size).toBe(1000);
    expect(sizes).toEqual([0.8, 0.7, 0.55]);
    const never: CompressDeps = { decode: async () => ({ width: 10, height: 10 }), encode: async () => new Blob([new Uint8Array(PHOTO_LIMITS.maxBytes + 1)]) };
    await expect(compressPhoto(new Blob([]), never)).rejects.toBeInstanceOf(PhotoError);
    await expect(compressPhoto(new Blob([]), { decode: async () => { throw new Error("x"); }, encode: never.encode })).rejects.toThrow(/isn't a photo/);
  });
});

describe("upload", () => {
  it("presign, PUT the compressed JPEG straight to storage, complete; the entry comes back with its photo", async () => {
    const entry = saveScoutEntry({ uuid: "pit000000001", season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: null, kind: "pit", data: {}, notes: "n", workspaceId: "w1", authorAccountId: 7, authorDisplayName: "Ada" });
    const calls: { url: string; method: string; headers: any; body: any }[] = [];
    const photo = { id: "11111111-1111-1111-1111-111111111111", bytes: 64, addedByAccountId: 7, addedByName: "Ada", createdAt: 1, expired: false };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", headers: init?.headers, body: init?.body });
      const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url === "/api/scout/photos/presign") return json({ photoId: photo.id, uploadUrl: "https://r2.test/b/photos/x.jpg?X-Amz-Signature=s", headers: { "Content-Type": "image/jpeg" } });
      if (url.startsWith("https://r2.test/")) return new Response(null, { status: 200 });
      return json({ entry: { ...entry, photos: [photo], photoExpired: false, photosRev: 1 } });
    }));
    const deps: CompressDeps = { decode: async () => ({ width: 3000, height: 2000 }), encode: async () => new Blob([canvasJpeg()], { type: "image/jpeg" }) };
    await uploadEntryPhoto(entry, new Blob([phoneJpeg()]), deps);
    expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual(["POST /api/scout/photos/presign", "PUT https://r2.test/b/photos/x.jpg", `POST /api/scout/photos/${photo.id}/complete`]);
    expect(JSON.parse(calls[0].body)).toEqual({ workspaceId: "w1", entryUuid: "pit000000001", bytes: 64 });
    expect(calls[1].headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(jpegHasExif(new Uint8Array(await (calls[1].body as Blob).arrayBuffer()))).toBe(false);
    expect(localScoutEntries("w1")[0].photos).toEqual([photo]);
  });
});

describe("who sees Remove (the server's rule)", () => {
  const e = { workspaceId: "w", authorAccountId: 7 } as ScoutEntry;
  it("the photo's adder, the entry's author, or an admin; nobody outside the workspace", () => {
    expect(canRemovePhoto(e, { addedByAccountId: 8 }, { accountId: 8, role: "member" })).toBe(true); // added it
    expect(canRemovePhoto(e, { addedByAccountId: 8 }, { accountId: 7, role: "member" })).toBe(true); // the entry is theirs
    expect(canRemovePhoto(e, { addedByAccountId: 8 }, { accountId: 9, role: "member" })).toBe(false);
    expect(canRemovePhoto(e, { addedByAccountId: 8 }, { accountId: 9, role: "admin" })).toBe(true);
    expect(canRemovePhoto(e, { addedByAccountId: 8 }, { accountId: 8 })).toBe(false); // no role here: not a member
    expect(canRemovePhoto(e, { addedByAccountId: 8 }, null)).toBe(false);
  });
});

describe("photo lists from the server", () => {
  const ws = "w2";
  const mk = (over: Partial<ScoutEntry> = {}): ScoutEntry => ({ uuid: "pit000000002", workspaceId: ws, season: 2025, team: 1, eventCode: null, matchLabel: null, kind: "pit", data: {}, notes: "server", updatedAt: 1000, authorAccountId: 7, authorDisplayName: "Ada", ...over });

  it("a newer photo list is taken even while the device's newer text edit waits to sync; the text edit stays", () => {
    applyLiveEntries(ws, [{ entry: mk(), seq: 1 }]);
    saveScoutEntry({ ...mk(), notes: "mine, not synced" }); // queued, newer updatedAt
    const photo = { id: "p1", bytes: 1, addedByAccountId: 8, addedByName: "Ben", createdAt: 1, expired: false };
    applyLiveEntries(ws, [{ entry: mk({ photos: [photo], photosRev: 1 }), seq: 2 }]);
    expect(localScoutEntries(ws)[0]).toMatchObject({ notes: "mine, not synced", photos: [photo], photosRev: 1 });
    // An older list (a late frame) doesn't undo it.
    applyLiveEntries(ws, [{ entry: mk({ photos: [], photosRev: 0 }), seq: 3 }]);
    expect(localScoutEntries(ws)[0].photos).toEqual([photo]);
    // A late answer with an equal stamp but an older photo list (an upload's, after a removal streamed in) keeps the newer list.
    applyLiveEntries(ws, [{ entry: mk({ updatedAt: localScoutEntries(ws)[0].updatedAt, notes: "mine, not synced", photos: [], photosRev: 2 }), seq: 4 }]);
    expect(localScoutEntries(ws)[0]).toMatchObject({ photos: [], photosRev: 2 });
    adoptServerEntry(ws, mk({ updatedAt: localScoutEntries(ws)[0].updatedAt + 1, notes: "newer text", photos: [photo], photosRev: 1 }));
    expect(localScoutEntries(ws)[0]).toMatchObject({ notes: "newer text", photos: [], photosRev: 2 });
    saveScoutEntry({ ...localScoutEntries(ws)[0], photos: [photo], photosRev: 1 });
    // A text edit keeps the photos it had.
    saveScoutEntry({ ...localScoutEntries(ws)[0], photos: undefined, notes: "again" });
    expect(localScoutEntries(ws)[0]).toMatchObject({ notes: "again", photos: [photo] });
  });
});
