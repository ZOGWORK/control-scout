// A start, before its migrations (server/index.ts opens the port first): the HTML route still serves the app's page,
// drawn as it always was, and keeps nothing, though the page cache can't read its data versions yet.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openDb, setDb } from "./db";
import { createApp } from "./app";
import { clearAllCaches } from "./caches";
import { keptCounts } from "./api/searchReads";

let server: Server;
let base = "";
beforeAll(async () => {
  setDb(openDb(":memory:")); // no migrate(): no kv table yet
  clearAllCaches();
  const dist = mkdtempSync(join(tmpdir(), "cs-start-"));
  writeFileSync(join(dist, "index.html"), `<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>`);
  server = createApp({ dist }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

it("serves the home page before the data is ready, and keeps nothing", async () => {
  const r = await fetch(`${base}/`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("text/html");
  expect(await r.text()).toContain(`<div id="root">`);
  expect(keptCounts().pages).toBe(0);
});
