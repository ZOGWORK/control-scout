// The raw season file (the Download page's .db link for analysts) is 13 to 45 MB, and its gzipped twin sits beside
// it (packs/build.ts). A download that can take gzip and asks for no range gets the twin's bytes as they are, marked
// Content-Encoding: gzip, with their length: nothing is compressed per request (the compression middleware used to
// Brotli the whole file on every download, with no length for the browser's progress bar). A range (a resumed
// download) or a client that can't take gzip gets the raw file. The app's own downloads (.gz) are unchanged.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { request } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "../db";
import { createApp } from "../app";

const NAME = "scout-pack-2026-11-27-8-2026.db";
// Compressible, so any compression on the way would show (and be worth something to the middleware).
const raw = Buffer.from("SQLite format 3\0".padEnd(200_000, "rows of a season pack "));
const gz = gzipSync(raw, { level: 9 });
let server: Server, port = 0, dataDir = "", savedDir: string | undefined;

beforeAll(async () => {
  savedDir = process.env.DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "cs-rawdb-"));
  process.env.DATA_DIR = dataDir;
  mkdirSync(join(dataDir, "packs"), { recursive: true });
  writeFileSync(join(dataDir, "packs", NAME), raw);
  writeFileSync(join(dataDir, "packs", `${NAME}.gz`), gz);
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server?.close();
  if (savedDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = savedDir;
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* a temp dir */ }
});

/** The bytes as they came over the wire (no decoding), with the headers. */
function get(path: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (d: Buffer) => parts.push(d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the raw season file", () => {
  it("a browser's download gets the gzipped twin as it is: its length, no per-request compression", async () => {
    const r = await get(`/packs/${NAME}`, { "Accept-Encoding": "gzip, deflate, br, zstd" });
    expect(r.status).toBe(200);
    expect(r.headers["content-encoding"]).toBe("gzip");
    expect(r.headers["content-length"]).toBe(String(gz.length));
    expect(r.body.equals(gz)).toBe(true);
    expect(gunzipSync(r.body).equals(raw)).toBe(true);
    expect(r.headers["content-disposition"]).toContain(NAME);
    expect(r.headers["content-type"]).toMatch(/^application\/vnd\.sqlite3/);
    expect(String(r.headers.vary)).toMatch(/Accept-Encoding/i);
    expect(r.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("never Brotli-compressed per request: a client that takes only br gets the raw file, with its length", async () => {
    const r = await get(`/packs/${NAME}`, { "Accept-Encoding": "br" });
    expect(r.status).toBe(200);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.headers["content-length"]).toBe(String(raw.length));
    expect(r.body.equals(raw)).toBe(true);
  });

  it("no Accept-Encoding (curl, wget): the raw file", async () => {
    const r = await get(`/packs/${NAME}`, {});
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.body.equals(raw)).toBe(true);
  });

  it("a resumed download asks for a range of the raw file and gets exactly that", async () => {
    const r = await get(`/packs/${NAME}`, { "Accept-Encoding": "gzip", Range: "bytes=100-199" });
    expect(r.status).toBe(206);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.body.equals(raw.subarray(100, 200))).toBe(true);
  });

  it("the app's own download (the .gz) is served as it always was", async () => {
    const r = await get(`/packs/${NAME}.gz`, { "Accept-Encoding": "gzip, br" });
    expect(r.status).toBe(200);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.headers["content-length"]).toBe(String(gz.length));
    expect(r.body.equals(gz)).toBe(true);
  });
});
