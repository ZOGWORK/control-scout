// A folder of static files that shares a page's name (public/legacy/ holds the classic logos; /legacy is a page) falls
// through to the app: express.static used to 301 "/legacy" to "/legacy/", which the one-URL rule 301s back, a loop
// ("too many redirects", live 2026-11-22). The folder's own files are still served.
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
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const dist = mkdtempSync(join(tmpdir(), "cs-folder-page-"));
  writeFileSync(join(dist, "index.html"), "<html><head><title>x</title></head><body><div id=\"root\"></div></body></html>");
  mkdirSync(join(dist, "legacy"));
  writeFileSync(join(dist, "legacy", "logo-56.webp"), "RIFF");
  server = createApp({ dist }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe("a page named like a static folder", () => {
  it("serves /legacy as the app's page, never a redirect", async () => {
    const res = await fetch(`${base}/legacy`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it("still serves the folder's files", async () => {
    const res = await fetch(`${base}/legacy/logo-56.webp`, { redirect: "manual" });
    expect(res.status).toBe(200);
  });
});
