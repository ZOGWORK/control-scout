import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import type { AddressInfo } from "node:net";
import express from "express";
import { MAX_ROUTES, OTHER_ROUTE, flushMetrics, isMeasured, isSyncRoute, normalizeRoute, percentile, recordRequest, requestMetrics, resetMetrics, usageSummary } from "./metrics";
import { driftAlerts, MIN_BASELINE, MIN_WEEK } from "./portal/predictionHealth";

describe("normalizeRoute", () => {
  it.each([
    ["/api/teams/18360", "/api/teams/:n"],
    ["/api/teams/18360/matches", "/api/teams/:n/matches"],
    ["/api/events/2025/AUSYQ1", "/api/events/:n/:id"],
    ["/api/events/2025/usnyliq2", "/api/events/:n/:id"],
    ["/api/events/2025/AUSYQ1/matches/qual:0:12", "/api/events/:n/:id/matches/:key"],
    ["/api/events/2025/AUSYQ1/refresh", "/api/events/:n/:id/refresh"],
    ["/api/records/2025/teams", "/api/records/:n/teams"],
    ["/api/me/state/myTeam", "/api/me/state/myteam"],
    ["/api/auth/control-point/callback", "/api/auth/control-point/callback"],
    ["/API/teams/42/", "/api/teams/:n"],
    ["/packs/latest.json", "/packs/latest.json"],
    ["/api/scout/workspaces/ws_123/export.csv", "/api/scout/workspaces/:id/export.csv"],
    ["/packs/scout-pack-2026-10-15-1-lite.json.gz", "/packs/:file"],
    ["/api/reports/errors", "/api/reports/errors"],
    ["/api/x/0123456789abcdef0123456789abcdef", "/api/x/:id"],
    ["/api/events/2025/%E2%9C%93", "/api/events/:n/:id"],
  ])("%s → %s", (path, want) => expect(normalizeRoute(path)).toBe(want));

  it("keeps ids out, so thousands of teams are one pattern", () => {
    const routes = new Set(Array.from({ length: 2000 }, (_, i) => normalizeRoute(`/api/teams/${i + 1}/matches`)));
    expect([...routes]).toEqual(["/api/teams/:n/matches"]);
  });

  it("leaves out health checks, the owner portal, the live stream and static files", () => {
    for (const p of ["/api/health", "/api/owner/usage", "/api/scout/stream", "/API/Scout/Stream/", "/assets/index-abc.js", "/teams/18360"]) expect(isMeasured(p), p).toBe(false);
    for (const p of ["/api/teams/1", "/api/scout/sync", "/packs/latest.json", "/api/scout/streams-not"]) expect(isMeasured(p), p).toBe(true);
  });

  it("tells sync traffic apart", () => {
    expect(isSyncRoute("POST /api/me/scout/sync")).toBe(true);
    expect(isSyncRoute("GET /api/scout/sync")).toBe(true); // workspace pulls
    expect(isSyncRoute(`GET ${normalizeRoute("/api/scout/sync")}`)).toBe(true);
    expect(isSyncRoute("PUT /api/me/state/myteam")).toBe(true);
    expect(isSyncRoute("GET /packs/:file")).toBe(true);
    expect(isSyncRoute("GET /api/teams/:n")).toBe(false);
    expect(isSyncRoute("GET /api/me")).toBe(false);
  });
});

describe("percentile", () => {
  it("interpolates inside a bucket and caps the open one at the max", () => {
    // 10 requests in the 10–25 ms bucket, the slowest 24 ms: spread over 10–24
    const b = [0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(percentile(b, 0.5, 24)).toBeCloseTo(17, 5);
    expect(percentile(b, 1, 24)).toBeCloseTo(24, 5);
    expect(percentile([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4], 0.95, 31_000)).toBeLessThanOrEqual(31_000);
    expect(percentile(new Array(12).fill(0), 0.5, 0)).toBeNull();
  });
});

describe("request counters", () => {
  beforeAll(async () => { const c = openDb(":memory:"); setDb(c); await migrate(c); });
  beforeEach(async () => { resetMetrics(); await run("DELETE FROM request_metrics_daily"); });

  it("a streamed download counts to its first byte, not to its end (a long CSV export isn't a slow route)", async () => {
    const app = express();
    app.use(requestMetrics());
    app.get("/api/scout/workspaces/:id/export.csv", (_req, res) => {
      res.locals.firstByteAt = performance.now(); // as streamedBody marks it (server/api/records.ts)
      res.write("header\n");
      setTimeout(() => res.end("rows\n"), 400);
    });
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    try {
      await (await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/scout/workspaces/w1/export.csv`)).text();
      await new Promise((r) => setTimeout(r, 20)); // the close event
    } finally { srv.close(); }
    await flushMetrics();
    const rows = await all<any>("SELECT * FROM request_metrics_daily");
    expect(rows.map((r) => r.route)).toEqual(["GET /api/scout/workspaces/:id/export.csv"]);
    expect(Number(rows[0].max_ms)).toBeLessThan(200);
  });

  it("flush into one row per day and pattern, adding up across flushes", async () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    recordRequest("GET", "/api/teams/1", 200, 4, now);
    recordRequest("GET", "/api/teams/2", 200, 120, now);
    recordRequest("get", "/api/teams/3", 500, 3000, now);
    expect(await flushMetrics()).toBe(1);
    recordRequest("GET", "/api/teams/4", 200, 8, now);
    recordRequest("POST", "/api/me/scout/sync", 200, 30, now);
    await flushMetrics();
    const rows = await all<any>("SELECT * FROM request_metrics_daily ORDER BY route");
    expect(rows.map((r) => [r.day, r.route, r.count, r.errors])).toEqual([
      ["2026-10-15", "GET /api/teams/:n", 4, 1],
      ["2026-10-15", "POST /api/me/scout/sync", 1, 0],
    ]);
    expect(Number(rows[0].max_ms)).toBe(3000);
    expect([rows[0].b0, rows[0].b1, rows[0].b5, rows[0].b9]).toEqual([1, 1, 1, 1]);
    const u = await usageSummary(2, now);
    expect(u.daily.at(-1)).toEqual({ day: "2026-10-15", requests: 5, sync: 1, errors: 1 });
    expect(u.busiest[0]).toMatchObject({ route: "GET /api/teams/:n", count: 4 });
  });

  it("lumps an endless stream of unknown paths together instead of growing without bound", async () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    for (let i = 0; i < 50; i++) recordRequest("GET", `/api/x/AB${i}CD`, 404, 1, now);
    for (let i = 0; i < MAX_ROUTES + 50; i++) recordRequest("GET", `/api/w${String.fromCharCode(97 + (i % 26))}${"z".repeat(Math.floor(i / 26))}`, 200, 1, now);
    await flushMetrics();
    const rows = await all<any>("SELECT route, count FROM request_metrics_daily");
    expect(rows.length).toBeLessThanOrEqual(MAX_ROUTES + 1);
    expect(rows.find((r) => r.route === "GET (not found)")?.count).toBe(50);
    expect(rows.find((r) => r.route === OTHER_ROUTE)?.count).toBeGreaterThan(0);
  });
});

describe("drift alerts", () => {
  const calls = (n: number, p: number, wonShare: number) => Array.from({ length: n }, (_, i) => ({ p, y: i < n * wonShare ? 1 : 0, tier: "confident" as const, level: "qual", time: null }));
  it("flags a week that falls well below the season so far, and only with enough calls", () => {
    const steady = calls(Math.max(MIN_BASELINE, 120), 0.75, 0.75);
    const weeks = [
      { week: "2026-01-05", calls: steady },
      { week: "2026-01-12", calls: calls(MIN_WEEK, 0.75, 0.74) },  // normal
      { week: "2026-01-19", calls: calls(MIN_WEEK, 0.75, 0.5) },   // the favourite won half the time
      { week: "2026-01-26", calls: calls(MIN_WEEK - 1, 0.75, 0.2) }, // too few calls to judge
    ];
    const alerts = driftAlerts(weeks);
    expect(alerts.map((a) => a.week)).toEqual(["2026-01-19"]);
    expect(alerts[0].reasons).toEqual(["brier", "accuracy"]);
    expect(alerts[0].baselineAccuracy).toBeGreaterThan(alerts[0].accuracy);
  });
});
