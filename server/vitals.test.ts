// POST /api/collect/vitals (validation, bots, privacy signals, aggregation) and the owner's per-page summary.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { recordVitals, vitalsSummary, vitalStat } from "./vitals";
import { parseVitals, rateVital, VITAL_BUCKETS, VITAL_THRESHOLDS, VITALS, vitalBucket } from "../src/shared/vitals";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
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
beforeEach(async () => { await run("DELETE FROM web_vitals_daily"); });

const post = (body: unknown, headers: Record<string, string> = {}, type = "application/json") =>
  fetch(`${base}/api/collect/vitals`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": type, "User-Agent": CHROME, ...headers } });
const rows = () => all<Record<string, unknown>>("SELECT * FROM web_vitals_daily ORDER BY metric");

describe("shared vitals", () => {
  it("has both thresholds of every metric as bucket bounds, so good and poor shares are exact", () => {
    for (const v of VITALS) {
      expect(VITAL_BUCKETS[v]).toHaveLength(12);
      for (const t of VITAL_THRESHOLDS[v]) expect(VITAL_BUCKETS[v]).toContain(t);
    }
  });
  it("rates and buckets at the thresholds", () => {
    expect(rateVital("LCP", 2500)).toBe("good");
    expect(rateVital("LCP", 2501)).toBe("ni");
    expect(rateVital("CLS", 0.26)).toBe("poor");
    expect(vitalBucket("LCP", 2500)).toBe(4);
    expect(vitalBucket("LCP", 1e9)).toBe(11);
  });
  it("keeps known metrics with sane values only; needs a route pattern and a screen bucket", () => {
    expect(parseVitals({ path: "/teams/:number", screen: "phone", m: { LCP: 1200, CLS: -1, INP: Infinity, FOO: 3, TTFB: "9" } }))
      .toEqual({ path: "/teams/:number", screen: "phone", m: { LCP: 1200 } });
    expect(parseVitals({ path: "/teams/18360", screen: "phone", m: { LCP: 1200 } })).toBeNull();
    expect(parseVitals({ path: "/", screen: "watch", m: { LCP: 1200 } })).toBeNull();
    expect(parseVitals({ path: "/", screen: "phone", m: { LCP: 1e9 } })).toBeNull();
    expect(parseVitals({ path: "/", screen: "phone", m: [] })).toBeNull();
  });
});

describe("POST /api/collect/vitals", () => {
  it("counts a beacon (JSON or text/plain) into one histogram row per metric", async () => {
    expect((await post({ path: "/events", screen: "phone", m: { LCP: 1800, CLS: 0.05 } })).status).toBe(204);
    expect((await post(JSON.stringify({ path: "/events", screen: "phone", m: { LCP: 4500 } }), {}, "text/plain")).status).toBe(204);
    const r = await rows();
    expect(r.map((x) => [x.metric, x.count, x.path, x.screen])).toEqual([["CLS", 1, "/events", "phone"], ["LCP", 2, "/events", "phone"]]);
    const lcp = r.find((x) => x.metric === "LCP")!;
    expect(lcp.b3).toBe(1); // 1800 ≤ 2000
    expect(lcp.b7).toBe(1); // 4500 ≤ 5000
    expect(lcp.max).toBe(4500);
    // Nothing but the aggregate: no IP, user agent or time of day.
    expect(Object.keys(lcp).sort()).toEqual(["b0", "b1", "b10", "b11", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "count", "day", "max", "metric", "path", "screen", "total"]);
  });

  it("accepts but doesn't count bots and browsers sending a privacy signal", async () => {
    const b = { path: "/", screen: "desktop", m: { LCP: 900 } };
    expect((await post(b, { "User-Agent": "Googlebot/2.1" })).status).toBe(204);
    expect((await post(b, { "Sec-GPC": "1" })).status).toBe(204);
    expect((await post(b, { DNT: "1" })).status).toBe(204);
    expect(await rows()).toEqual([]);
  });

  it("refuses anything that isn't a beacon, and oversized bodies", async () => {
    expect((await post({ path: "/teams/18360", screen: "phone", m: { LCP: 1 } })).status).toBe(400);
    expect((await post("not json", {}, "text/plain")).status).toBe(400);
    expect((await post({ path: "/", screen: "phone", m: { LCP: 1 }, pad: "x".repeat(2000) })).status).toBe(413);
    expect(await rows()).toEqual([]);
  });
});

describe("vitalsSummary", () => {
  it("gives p75 and good/poor shares per page and for all pages, most-loaded page first", async () => {
    const now = new Date("2026-11-01T12:00:00Z");
    for (let i = 0; i < 3; i++) await recordVitals({ path: "/", screen: "phone", m: { LCP: 1000, TTFB: 300 } }, now);
    await recordVitals({ path: "/", screen: "desktop", m: { LCP: 5000 } }, now);
    await recordVitals({ path: "/events", screen: "phone", m: { LCP: 3000, CLS: 0.3 } }, now);
    await recordVitals({ path: "/events", screen: "phone", m: { LCP: 3000 } }, new Date("2026-10-01T12:00:00Z")); // outside the period
    const s = await vitalsSummary(14, now.getTime());
    expect(s.pages.map((p) => p.path)).toEqual(["/", "/events"]);
    const home = s.pages[0].metrics;
    expect(home.LCP).toMatchObject({ n: 4, good: 0.75, poor: 0.25 });
    expect(home.TTFB?.n).toBe(3);
    expect(s.pages[1].metrics.CLS).toMatchObject({ n: 1, good: 0, poor: 1 });
    expect(s.all.path).toBe("(all pages)");
    expect(s.all.metrics.LCP?.n).toBe(5);
    expect(s.all.metrics.LCP?.p75).toBeGreaterThan(1000);
  });

  it("is empty with no measurements", async () => {
    expect(await vitalsSummary(14)).toEqual({ all: { path: "(all pages)", metrics: {} }, pages: [] });
  });

  it("reads p75 within its bucket, capped by the largest value seen", () => {
    const b = new Array(12).fill(0);
    b[4] = 4; // four loads in (2000, 2500]
    const s = vitalStat("LCP", b, 2300);
    expect(s.p75).toBeGreaterThan(2000);
    expect(s.p75).toBeLessThanOrEqual(2300);
  });
});
