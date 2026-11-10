// The search limit (server/app.ts searchLimit): per visitor address (server/visitorIp.ts: Cloudflare's
// CF-Connecting-IP when the request came from Cloudflare, else req.ip), a 429 with Retry-After past the limit, one
// visitor's limit never slowing another's, and the /search page and /api/search spending one budget.
// Requests here come as nginx passes them on: X-Forwarded-For names the peer (one trusted proxy), so req.ip is it.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEARCHES_PER_MINUTE, createApp, searchLimit } from "./app";
import { fromCloudflare, visitorIp } from "./visitorIp";
import { migrate, openDb, setDb } from "./db";
import { clearAllCaches } from "./caches";

const EDGE = "172.64.0.10"; // one of Cloudflare's
const listen = async (app: express.Express) => {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};
const ask = (base: string, path: string, peer: string, visitor?: string) =>
  fetch(base + path, { headers: { "X-Forwarded-For": peer, ...(visitor ? { "CF-Connecting-IP": visitor } : {}) } });

describe("search limit", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.get("/search", searchLimit(3, 60_000), (_req, res) => { res.send("ok"); });
    ({ server, base } = await listen(app));
  });
  afterAll(() => { server?.close(); });

  it("lets a visitor search up to the limit, then answers 429 with Retry-After", async () => {
    for (let i = 0; i < 3; i++) expect((await ask(base, "/search", EDGE, "203.0.113.1")).status).toBe(200);
    const r = await ask(base, "/search", EDGE, "203.0.113.1");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps each visitor apart, even behind the same Cloudflare edge", async () => {
    for (let i = 0; i < 3; i++) expect((await ask(base, "/search", EDGE, "203.0.113.2")).status).toBe(200);
    expect((await ask(base, "/search", EDGE, "203.0.113.2")).status).toBe(429);
    expect((await ask(base, "/search", EDGE, "203.0.113.3")).status).toBe(200);
  });

  it("never gives a fresh limit for a CF-Connecting-IP sent from outside Cloudflare", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await ask(base, "/search", "198.51.100.9", `203.0.113.${50 + i}`)).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });
});

describe("the visitor's address", () => {
  const req = (ip: string, cf?: string) => ({ ip, get: (h: string) => (h.toLowerCase() === "cf-connecting-ip" ? cf : undefined) }) as Parameters<typeof visitorIp>[0];

  it("knows Cloudflare's addresses, IPv4, IPv6 and IPv4 written as IPv6", () => {
    for (const ip of ["172.64.0.10", "104.16.0.1", "::ffff:162.158.1.1", "2606:4700::1", "2a06:98c0:1::1"]) expect(fromCloudflare(ip), ip).toBe(true);
    for (const ip of ["127.0.0.1", "203.0.113.1", "::1", "2001:db8::1", "not an address", "", undefined]) expect(fromCloudflare(ip), String(ip)).toBe(false);
  });

  it("reads CF-Connecting-IP only from Cloudflare, else the peer", () => {
    expect(visitorIp(req(EDGE, "198.51.100.7"))).toBe("198.51.100.7");
    expect(visitorIp(req("2606:4700::1", "2001:db8::7"))).toBe("2001:db8::7");
    expect(visitorIp(req("198.51.100.9", "203.0.113.1"))).toBe("198.51.100.9");
    expect(visitorIp(req(EDGE))).toBe(EDGE);
    // A header that isn't an address, even from Cloudflare: the peer.
    expect(visitorIp(req(EDGE, "x".repeat(80)))).toBe(EDGE);
  });

  it("is generous: well above a load test of 100 users searching every few seconds", () => {
    // 100 users, 5 s apart, 2 of 3 requests searches: ~800 a minute from one machine.
    expect(SEARCHES_PER_MINUTE).toBeGreaterThanOrEqual(1_000);
  });
});

describe("the app's search limit", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    clearAllCaches();
    const dist = mkdtempSync(join(tmpdir(), "cs-limit-"));
    writeFileSync(join(dist, "index.html"), `<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>`);
    ({ server, base } = await listen(createApp({ dist, searchesPerMinute: 4 })));
  });
  afterAll(() => { server?.close(); });

  it("spends one budget on the /search page and /api/search, and leaves another visitor alone", async () => {
    const page = (v: string) => ask(base, "/search?q=4215", EDGE, v), api = (v: string) => ask(base, "/api/search?q=4215", EDGE, v);
    const statuses = [];
    for (const go of [page, api, page, api, page, api]) statuses.push((await go("203.0.113.20")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 429, 429]);
    expect((await page("203.0.113.21")).status).toBe(200);
    expect((await api("203.0.113.21")).status).toBe(200);
  });
});
