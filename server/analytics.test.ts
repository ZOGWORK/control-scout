// POST /api/collect (validation, bots, size, aggregation) and the owner's
// GET /api/stats/summary.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import type { PageView } from "../src/shared/analytics";
import { dayOf, isBot, rateLimiter, recordPageView, statsSummary } from "./analytics";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
let server: Server;
let base = "";
const saved = process.env.STATS_TOKEN;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); if (saved === undefined) delete process.env.STATS_TOKEN; else process.env.STATS_TOKEN = saved; });
beforeEach(async () => { await run("DELETE FROM analytics_daily"); });

const view: PageView = { path: "/teams/:number", ref: "", screen: "desktop", lang: "en", session: false };
const post = (body: unknown, headers: Record<string, string> = {}, type = "application/json") =>
  fetch(`${base}/api/collect`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": type, "User-Agent": CHROME, ...headers } });
const rows = () => all<{ day: string; path: string; referrer_host: string; screen: string; lang: string; views: number; sessions: number }>("SELECT * FROM analytics_daily ORDER BY day, path, referrer_host, screen");

describe("POST /api/collect", () => {
  it("counts a valid page view (JSON or a text/plain beacon) with 204 and stores only the aggregate", async () => {
    expect((await post({ ...view, ref: "WWW.Google.com", session: true })).status).toBe(204);
    expect((await post(view, {}, "text/plain;charset=UTF-8")).status).toBe(204);
    const r = await rows();
    expect(r.map((x) => ({ ...x }))).toEqual([
      { day: dayOf(new Date()), path: "/teams/:number", referrer_host: "", screen: "desktop", lang: "en", views: 1, sessions: 0 },
      { day: dayOf(new Date()), path: "/teams/:number", referrer_host: "google.com", screen: "desktop", lang: "en", views: 1, sessions: 1 },
    ]);
  });

  it("rejects anything that isn't a page view with 400 and stores nothing", async () => {
    for (const bad of [
      "not json", "[]", "null",
      { ...view, path: "/teams/18360" }, // a raw path, not a route pattern
      { ...view, path: "/wp-admin" },
      { ...view, screen: "watch" },
      { ...view, session: "yes" },
      { ...view, ref: 42 },
      { path: "/" },
    ]) expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("drops an oversized body with 413", async () => {
    expect((await post({ ...view, pad: "x".repeat(2000) })).status).toBe(413);
    expect(await rows()).toEqual([]);
  });

  it("ignores bots, missing user agents and GPC / DNT requests: 204, nothing counted", async () => {
    expect((await post(view, { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" })).status).toBe(204);
    expect((await post(view, { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36" })).status).toBe(204);
    expect((await post(view, { "User-Agent": "" })).status).toBe(204);
    expect((await post(view, { "Sec-GPC": "1" })).status).toBe(204);
    expect((await post(view, { DNT: "1" })).status).toBe(204);
    expect(await rows()).toEqual([]);
  });

  it("never sets a cookie", async () => {
    const r = await post(view);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});

describe("aggregation", () => {
  it("upserts: the same day/path/referrer/screen/lang adds to one row", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    await recordPageView({ ...view, session: true }, now);
    await recordPageView(view, now);
    await recordPageView(view, now);
    await recordPageView({ ...view, screen: "phone" }, now);
    await recordPageView(view, new Date("2026-10-16T00:00:01Z"));
    const r = await rows();
    expect(r.map((x) => [x.day, x.screen, x.views, x.sessions])).toEqual([
      ["2026-10-15", "desktop", 3, 1], ["2026-10-15", "phone", 1, 0], ["2026-10-16", "desktop", 1, 0],
    ]);
  });

  it("summarises the window: totals, top pages, referrers, screens, languages", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    await recordPageView({ ...view, path: "/", ref: "reddit.com", session: true }, now);
    await recordPageView({ ...view, path: "/" }, now);
    await recordPageView({ ...view, lang: "es" }, new Date("2026-10-01T08:00:00Z"));
    await recordPageView(view, new Date("2026-09-01T08:00:00Z")); // outside 30 days
    const s = await statsSummary(30, now);
    expect(s).toMatchObject({ from: "2026-09-16", to: "2026-10-15", totals: { views: 3, sessions: 1 } });
    expect(s.topPaths.map((p) => ({ ...p }))).toEqual([{ path: "/", views: 2 }, { path: "/teams/:number", views: 1 }]);
    expect(s.topReferrers.map((p) => ({ ...p }))).toEqual([{ host: "reddit.com", sessions: 1 }]);
    expect(s.languages.map((p) => ({ ...p }))).toEqual([{ lang: "en", views: 2 }, { lang: "es", views: 1 }]);
    expect(s.daily.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-15"]);
  });
});

describe("GET /api/stats/summary", () => {
  it("404s with no STATS_TOKEN set, 401s on a wrong token, answers (no-store) with the right one", async () => {
    delete process.env.STATS_TOKEN;
    expect((await fetch(`${base}/api/stats/summary`)).status).toBe(404);
    process.env.STATS_TOKEN = "s3cret-token-for-tests";
    expect((await fetch(`${base}/api/stats/summary`)).status).toBe(401);
    expect((await fetch(`${base}/api/stats/summary`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
    await recordPageView(view);
    const r = await fetch(`${base}/api/stats/summary?days=7`, { headers: { Authorization: "Bearer s3cret-token-for-tests" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ days: 7, totals: { views: 1, sessions: 0 } });
  });
});

describe("helpers", () => {
  it("isBot: crawlers, tools and empty user agents yes; real browsers no", () => {
    for (const ua of [undefined, "", "curl/8.4.0", "python-requests/2.31", "Mozilla/5.0 (compatible; bingbot/2.0)", "facebookexternalhit/1.1"]) expect(isBot(ua), String(ua)).toBe(true);
    expect(isBot(CHROME)).toBe(false);
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
  });

  it("rateLimiter allows `max` per window per key", () => {
    const allow = rateLimiter(2, 1000);
    expect([allow("a", 0), allow("a", 1), allow("a", 2), allow("b", 2)]).toEqual([true, true, false, true]);
    expect(allow("a", 1001)).toBe(true);
  });
});
