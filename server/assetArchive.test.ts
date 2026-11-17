// /assets: the release's own hashed files first, then an earlier release's from the asset archive
// (deploy/oracle-vm-setup.sh), so a page drawn before a deploy still loads its chunks; anything in neither is a 404.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "./db";
import { createApp } from "./app";

let server: Server;
let base = "";
let lateServer: Server;
let lateBase = "";
let lateArchive = "";
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const dist = mkdtempSync(join(tmpdir(), "cs-assets-"));
  writeFileSync(join(dist, "index.html"), "<html><head><title>x</title></head><body><div id=\"root\"></div></body></html>");
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets", "TeamDetail-NEW11111.js"), "export const v = 'new';");
  const archive = mkdtempSync(join(tmpdir(), "cs-archive-"));
  writeFileSync(join(archive, "TeamDetail-OLD00000.js"), "export const v = 'old';");
  writeFileSync(join(archive, "TeamDetail-NEW11111.js"), "export const v = 'stale copy';");
  server = createApp({ dist, assetArchive: archive }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // A server started before its archive folder exists.
  lateArchive = join(mkdtempSync(join(tmpdir(), "cs-late-")), "assets-archive");
  lateServer = createApp({ dist, assetArchive: lateArchive }).listen(0);
  await new Promise((r) => lateServer.once("listening", r));
  lateBase = `http://127.0.0.1:${(lateServer.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => lateServer.close(() => r()));
});

describe("hashed assets across releases", () => {
  it("serves the current release's file first", async () => {
    const res = await fetch(`${base}/assets/TeamDetail-NEW11111.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("'new'");
  });

  it("serves an earlier release's chunk from the archive, cached as immutable", async () => {
    const res = await fetch(`${base}/assets/TeamDetail-OLD00000.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("'old'");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("serves an archive made after the server started", async () => {
    expect((await fetch(`${lateBase}/assets/Late-AAAAAAAA.js`)).status).toBe(404);
    mkdirSync(lateArchive);
    writeFileSync(join(lateArchive, "Late-AAAAAAAA.js"), "export const v = 'late';");
    const res = await fetch(`${lateBase}/assets/Late-AAAAAAAA.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("'late'");
  });

  it("is still a 404 for a file in neither", async () => {
    const res = await fetch(`${base}/assets/Nope-ZZZZZZZZ.js`);
    expect(res.status).toBe(404);
  });
});
