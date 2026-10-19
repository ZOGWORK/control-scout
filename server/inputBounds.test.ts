// Public query parameters and cookies that arrive malformed: a bad count is a 400 (never a 500, never past
// the cap), and a corrupt session cookie counts as signed out. Real app over HTTP, in-memory database.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";

let server: Server;
let base = "";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // 16, 160–169, 1600–1639: 51 teams whose numbers start with "16", more than the 25 search cap.
  const numbers = [16, ...Array.from({ length: 10 }, (_, i) => 160 + i), ...Array.from({ length: 40 }, (_, i) => 1600 + i)];
  for (const n of numbers) await run("INSERT INTO teams (number, name) VALUES (?, ?)", [n, `Team ${n}`]);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await fetch(base + path, { headers });
  return { status: res.status, json: await res.json().catch(() => null), setCookie: res.headers.get("set-cookie") };
};

describe("/api/search limit (PUB-F01)", () => {
  it("defaults to 12 and caps a large limit at 25", async () => {
    expect((await get("/api/search?q=16")).json.hits).toHaveLength(12);
    expect((await get("/api/search?q=16&limit=3")).json.hits).toHaveLength(3);
    expect((await get("/api/search?q=16&limit=25")).json.hits).toHaveLength(25);
    expect((await get("/api/search?q=16&limit=500")).json.hits).toHaveLength(25);
    expect((await get("/api/search?q=16&limit=2147483647")).json.hits).toHaveLength(25);
    expect((await get(`/api/search?q=16&limit=${"9".repeat(400)}`)).json.hits).toHaveLength(25);
    expect((await get("/api/search?q=16&limit=007")).json.hits).toHaveLength(7);
  });

  it.each(["-1", "0", "1.5", "-0.5", "-Infinity", "Infinity", "1e3", "abc", "0x10"])("answers 400 for limit=%s", async (limit) => {
    const r = await get(`/api/search?q=16&limit=${encodeURIComponent(limit)}`);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/limit must be a whole number from 1 to 25/);
  });

  it("answers 400 for a repeated limit", async () => {
    expect((await get("/api/search?q=16&limit=3&limit=4")).status).toBe(400);
  });
});

describe("other public counts", () => {
  it.each(["-1", "1.5", "-Infinity"])("/api/events limit=%s is a 400", async (limit) => {
    expect((await get(`/api/events?limit=${encodeURIComponent(limit)}`)).status).toBe(400);
  });
  it("/api/events accepts a plain limit", async () => {
    expect((await get("/api/events?limit=5")).status).toBe(200);
  });
  it.each(["-3", "2.5", "-Infinity"])("/api/predict/upcoming days=%s is a 400", async (days) => {
    expect((await get(`/api/predict/upcoming?days=${encodeURIComponent(days)}`)).status).toBe(400);
  });
});

describe("malformed session cookie (PRIVATE-F04)", () => {
  const bad = { Cookie: "cs_session=%E0%A4%A" };

  it("counts as signed out on /api/auth/me and is cleared", async () => {
    const r = await get("/api/auth/me", bad);
    expect(r.status).toBe(200);
    expect(r.json.user).toBeNull();
    expect(r.setCookie).toMatch(/^cs_session=;/);
  });

  it("doesn't clear a well-formed but unknown session (another tab may be signing in)", async () => {
    const r = await get("/api/auth/me", { Cookie: "cs_session=abc123" });
    expect(r.json.user).toBeNull();
    expect(r.setCookie).toBeNull();
  });

  it("logs out cleanly", async () => {
    const res = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...bad, "Content-Type": "application/json", Origin: base }, body: "{}" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toMatch(/^cs_session=;/);
  });

  it("is signed out for a signed-in-only route, not a server error", async () => {
    expect((await get("/api/me/state", bad)).status).toBe(401);
  });
});
