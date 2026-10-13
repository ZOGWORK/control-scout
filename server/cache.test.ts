// Cache-Control on the API: public FTC data may be cached briefly; personal
// routes (any casing) and every error response must never be.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "./db";
import { createApp } from "./app";

let server: Server;
let base = "";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

const cc = async (path: string) => { const r = await fetch(base + path); await r.arrayBuffer(); return { status: r.status, cc: r.headers.get("cache-control") }; };

describe("API cache headers", () => {
  it("lets public data be cached", async () => {
    const r = await cc("/api/meta");
    expect(r.status).toBe(200);
    expect(r.cc).toContain("public");
  });
  it("never caches personal routes, whatever the casing", async () => {
    for (const p of ["/api/me/state", "/api/ME/state", "/api/Auth/session", "/api/HEALTH"]) expect((await cc(p)).cc, p).toBe("no-store");
  });
  it("never caches errors", async () => {
    const r = await cc("/api/teams/99999999");
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.cc).toBe("no-store");
  });
});
