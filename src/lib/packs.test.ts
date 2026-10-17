// @vitest-environment jsdom
// The lite pack downloads online but only runs offline: downloadLite stores the
// verified bytes as they came (no gunzip, no JSON.parse), and loadLite, which
// only the no-signal fallbacks call, decodes them.
import "fake-indexeddb/auto";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadLite, getv, loadLite, packStatus, put, removeLite, type LitePack, type PackFile, type PackManifest } from "./packs";

const pack: LitePack = { format: 1, version: "v1", builtAt: "2026-10-13T00:00:00Z", engineVersion: "2.1.1", books: {}, teams: [[4215, "Robo", "Somewhere"]] };
const gz = new Uint8Array(gzipSync(JSON.stringify(pack)));
const file: PackFile = { name: "scout-pack-v1-lite.json.gz", url: "/packs/lite.json.gz", bytes: gz.length, sha256: createHash("sha256").update(gz).digest("hex"), seasons: [2025], kind: "lite", contents: "" };
const manifest = { format: 1, version: "v1", builtAt: pack.builtAt, engineVersion: pack.engineVersion, dataAsOf: null, lite: file, full: [] } as PackManifest;

afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await removeLite(); });

describe("downloadLite", () => {
  it("stores the verified bytes without decoding them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(gz)));
    const parse = vi.spyOn(JSON, "parse");
    const meta = await downloadLite(file, manifest);
    expect(parse.mock.calls.filter(([s]) => typeof s === "string" && s.includes("\"books\""))).toEqual([]); // the pack itself was never parsed
    expect(meta).toMatchObject({ version: "v1", bytes: gz.length, builtAt: pack.builtAt, engineVersion: "2.1.1" });
    expect(packStatus()).toMatchObject({ version: "v1" });
    const stored = await getv<{ gz: boolean; bytes: Uint8Array }>("lite");
    expect(stored?.gz).toBe(true);
    expect(stored?.bytes.length).toBe(gz.length);
  });

  it("loadLite (offline only) decodes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(gz)));
    await downloadLite(file, manifest);
    expect(await loadLite()).toEqual(pack);
  });

  it("refuses bytes that don't match the published checksum", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    await expect(downloadLite(file, manifest)).rejects.toThrow(/checksum/);
    expect(packStatus()).toBeNull();
  });

  it("still reads a pack an older version stored decoded", async () => {
    await put("lite", pack);
    expect(await loadLite()).toEqual(pack);
  });
});
