// The search limit (server/app.ts searchLimit): per visitor address (Cloudflare's CF-Connecting-IP, else req.ip), a
// 429 with Retry-After past the limit, and one visitor's limit never slows another's.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEARCHES_PER_MINUTE, searchLimit, visitorIp } from "./app";

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.get("/search", searchLimit(3, 60_000), (_req, res) => { res.send("ok"); });
  app.get("/ip", (req, res) => { res.send(visitorIp(req)); });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

const ask = (path: string, ip?: string) => fetch(base + path, { headers: ip ? { "CF-Connecting-IP": ip } : {} });

describe("search limit", () => {
  it("lets a visitor search up to the limit, then answers 429 with Retry-After", async () => {
    for (let i = 0; i < 3; i++) expect((await ask("/search", "203.0.113.1")).status).toBe(200);
    const r = await ask("/search", "203.0.113.1");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps each visitor apart, even behind the same Cloudflare edge", async () => {
    for (let i = 0; i < 3; i++) expect((await ask("/search", "203.0.113.2")).status).toBe(200);
    expect((await ask("/search", "203.0.113.2")).status).toBe(429);
    expect((await ask("/search", "203.0.113.3")).status).toBe(200);
  });

  it("names the visitor by CF-Connecting-IP, else the connection", async () => {
    expect(await (await ask("/ip", "198.51.100.7")).text()).toBe("198.51.100.7");
    expect(await (await ask("/ip")).text()).toMatch(/127\.0\.0\.1/);
  });

  it("is generous: well above a load test of 100 users searching every few seconds", () => {
    // 100 users, 5 s apart, 2 of 3 requests searches: ~800 a minute from one machine.
    expect(SEARCHES_PER_MINUTE).toBeGreaterThanOrEqual(1_000);
  });
});
