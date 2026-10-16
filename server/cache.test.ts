// Cache-Control on the API: public FTC data may be cached briefly; personal
// routes (any casing) and every error response must never be.
import type { AddressInfo } from "node:net";
import { get, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { stableP } from "./api/matches";

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

describe("a live event's detail (polled by the event page every 30 s)", () => {
  it("revalidates every time, and a poll that finds nothing new is a 304 with no body", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await run(`INSERT INTO events (season, code, name, type, start, "end", timezone, source) VALUES (2025, 'ETAGLIVE', 'ETag Live', 'Qualifier', ?, ?, 'UTC', 'first')`, [today, today]);
    // An unplayed match with a full lineup: it gets a call from today's ratings, which must not carry the clock.
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2025, 'ETAGLIVE', 'qual', 0, 1, 'Q1', ?, 0, 'first')`, [`${today}T23:59:00`]);
    for (const [team, alliance] of [[101, "red"], [102, "red"], [103, "blue"], [104, "blue"]] as const) {
      await run(`INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, 'ETAGLIVE', 'qual', 0, 1, ?, ?)`, [team, alliance]);
    }
    const first = await fetch(`${base}/api/events/2025/ETAGLIVE`);
    const body = (await first.json()) as { live: unknown; matches: { prediction: unknown }[] };
    expect(body.matches[0].prediction).toBeTruthy();
    expect(first.status).toBe(200);
    expect(body.live).not.toBeNull();
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    // As a browser's cache revalidates: If-None-Match alone (fetch() adds Cache-Control: no-cache to a
    // hand-made conditional request, which rightly defeats it, so plain http here).
    const again = await new Promise<{ status: number; bytes: number }>((resolve, reject) => {
      get(`${base}/api/events/2025/ETAGLIVE`, { headers: { "If-None-Match": etag! } }, (r) => {
        let bytes = 0;
        r.on("data", (c: Buffer) => { bytes += c.length; }).on("end", () => resolve({ status: r.statusCode ?? 0, bytes }));
      }).on("error", reject);
    });
    expect(again).toEqual({ status: 304, bytes: 0 });
  });
  it("keeps a call from today's ratings still between reads (they decay with the clock by ~1e-9)", () => {
    expect(stableP(0.6881869737194418)).toBe(stableP(0.6881869715164509));
    expect(stableP(0.6881869737194418)).toBe(0.6882);
    // Never a flat 0 or 1: it's a call, not a result.
    expect(stableP(0.999996)).toBe(0.9999);
    expect(stableP(0.000004)).toBe(0.0001);
  });
});
