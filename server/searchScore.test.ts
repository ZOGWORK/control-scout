// POST /api/collect/search (validation, test traffic, bots, privacy signals, rate limit) and the owner's speed and
// weekly score (p50/p95 by phone and desktop, ISO week bucketing, rates of a sample).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { answerSpeed, recordSearch, searchScore, weeksOf } from "./searchScore";
import { ANSWER_BUCKETS_MS, answerBucket, isoWeek, parseSearchBeacon, weekStart, type SearchBeacon } from "../src/shared/searchScore";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const HEADLESS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36";
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
beforeEach(async () => { await run("DELETE FROM search_score_daily"); });

const beacon = (o: Partial<SearchBeacon> = {}): SearchBeacon => ({ screen: "phone", entry: "app", outcome: "direct", via: "typed", re: false, ms: 420, ...o });
const post = (body: unknown, headers: Record<string, string> = {}, type = "application/json") =>
  fetch(`${base}/api/collect/search`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": type, "User-Agent": CHROME, ...headers } });
const rows = () => all<Record<string, number | string>>("SELECT day, screen, entry, searches, direct, results, page, sorry, error, re_search, via_related, via_ask, timed, total_ms, max_ms, b3, b4 FROM search_score_daily ORDER BY screen, entry");

describe("the search beacon", () => {
  it("keeps the fixed choices only, and never anything else sent with them", () => {
    expect(parseSearchBeacon({ ...beacon(), q: "4215 vs 6980", url: "/search?q=x", id: "abc" })).toEqual(beacon());
    for (const bad of [null, [], "x", { ...beacon(), screen: "watch" }, { ...beacon(), entry: "push" }, { ...beacon(), outcome: "maybe" }, { ...beacon(), via: "bruno" }, { ...beacon(), re: "yes" }]) {
      expect(parseSearchBeacon(bad)).toBeNull();
    }
  });
  it("drops an impossible time but keeps the search", () => {
    for (const ms of [-1, Infinity, NaN, 60_001, "300"]) expect(parseSearchBeacon({ ...beacon(), ms })).toEqual({ screen: "phone", entry: "app", outcome: "direct", via: "typed", re: false });
    expect(parseSearchBeacon({ ...beacon(), ms: 312.7 })?.ms).toBe(313);
  });
  it("only a typed search is a re-search", () => {
    expect(parseSearchBeacon({ ...beacon(), via: "related", re: true })?.re).toBe(false);
    expect(parseSearchBeacon({ ...beacon(), via: "typed", re: true })?.re).toBe(true);
  });
  it("buckets times at the bounds", () => {
    expect(ANSWER_BUCKETS_MS).toHaveLength(12);
    expect(answerBucket(0)).toBe(0);
    expect(answerBucket(100)).toBe(0);
    expect(answerBucket(101)).toBe(1);
    expect(answerBucket(1000)).toBe(5);
    expect(answerBucket(59_999)).toBe(11);
  });
});

describe("ISO weeks", () => {
  it("puts each day in its ISO week, across year ends", () => {
    expect(isoWeek("2026-11-23")).toBe("2026-W48"); // a Monday
    expect(isoWeek("2026-11-29")).toBe("2026-W48"); // its Sunday
    expect(isoWeek("2026-11-30")).toBe("2026-W49");
    expect(isoWeek("2027-01-01")).toBe("2026-W53"); // a Friday: still 2026's last week
    expect(isoWeek("2027-01-04")).toBe("2027-W01");
    expect(isoWeek("2024-12-30")).toBe("2025-W01"); // a Monday in 2025's first week
    expect(isoWeek("2021-01-03")).toBe("2020-W53");
  });
  it("starts each week on its Monday", () => {
    expect(weekStart("2026-W48")).toBe("2026-11-23");
    expect(weekStart("2025-W01")).toBe("2024-12-30");
    expect(weekStart("2020-W53")).toBe("2020-12-28");
    for (const d of ["2026-01-01", "2026-06-15", "2027-01-03"]) expect(weekStart(isoWeek(d)) <= d).toBe(true);
  });
});

describe("POST /api/collect/search", () => {
  it("adds a search to its day's total (JSON or text/plain)", async () => {
    expect((await post(beacon())).status).toBe(204);
    expect((await post(JSON.stringify(beacon({ outcome: "sorry", ms: 1800, re: true })), {}, "text/plain")).status).toBe(204);
    expect((await post(beacon({ outcome: "page", ms: undefined, via: "related" }))).status).toBe(204);
    const [r] = await rows();
    expect(r).toMatchObject({ screen: "phone", entry: "app", searches: 3, direct: 1, sorry: 1, page: 1, re_search: 1, via_related: 1, timed: 2, total_ms: 2220, max_ms: 1800, b3: 1 });
  });
  it("accepts and doesn't count test traffic, bots, headless browsers or privacy signals", async () => {
    const skipped: Record<string, string>[] = [{ "X-CS-Test": "1" }, { "User-Agent": HEADLESS }, { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }, { "Sec-GPC": "1" }, { DNT: "1" }];
    for (const h of skipped) {
      expect((await post(beacon(), h)).status).toBe(204);
    }
    expect(await rows()).toEqual([]);
  });
  it("refuses what isn't a search beacon", async () => {
    expect((await post({ screen: "phone" })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ ...beacon(), pad: "x".repeat(2000) })).status).toBe(413);
    expect(await rows()).toEqual([]);
  });
  it("limits one address to 60 beacons a minute", async () => {
    // Earlier tests in this file used some of this minute's allowance: once limited, every later beacon is refused.
    const codes: number[] = [];
    for (let i = 0; i < 70; i++) codes.push((await post(beacon(), { "X-CS-Test": "1" })).status);
    const first = codes.indexOf(429);
    expect(first).toBeGreaterThan(40);
    expect(first).toBeLessThanOrEqual(60);
    expect(codes.slice(first).every((c) => c === 429)).toBe(true);
  });
});

describe("the owner's speed and score", () => {
  it("reads the median and 95th percentile off the histogram", () => {
    const b = new Array(12).fill(0);
    b[answerBucket(250)] = 50; // 200–300 ms
    b[answerBucket(2500)] = 50; // 2–3 s
    const s = answerSpeed(b, 2900);
    expect(s.n).toBe(100);
    expect(s.p50).toBe(300); // the top of the lower half's bucket
    expect(s.p95).toBeCloseTo(2810, 0); // inside 2–3 s, its top capped at the slowest seen (2.9 s)
    expect(answerSpeed(new Array(12).fill(0), 0)).toEqual({ n: 0, p50: null, p95: null });
  });
  it("splits phone from desktop (tablets with desktop), and load from app", async () => {
    const now = new Date("2026-11-25T12:00:00Z");
    for (let i = 0; i < 18; i++) await recordSearch(beacon({ ms: 150 }), now);
    for (let i = 0; i < 2; i++) await recordSearch(beacon({ ms: 4000 }), now); // the slowest 10%: the 95th % is among them
    await recordSearch(beacon({ screen: "desktop", ms: 800 }), now);
    await recordSearch(beacon({ screen: "tablet", entry: "load", ms: 800 }), now);
    const s = await searchScore(14, now.getTime());
    expect(s.speed.phone.n).toBe(20);
    expect(s.speed.phone.p50).toBeGreaterThan(100);
    expect(s.speed.phone.p50).toBeLessThanOrEqual(200);
    expect(s.speed.phone.p95).toBeGreaterThan(3000);
    expect(s.speed.desktop).toMatchObject({ n: 2 });
    expect(s.speed.desktop.p50).toBeGreaterThan(750);
    expect(s.speed.load.n).toBe(1);
    expect(s.speed.app.n).toBe(21);
  });
  it("scores each ISO week, newest first, with rates of the sample and re-searches of typed searches only", async () => {
    const mon = new Date("2026-11-23T08:00:00Z"), sun = new Date("2026-11-29T23:00:00Z"), before = new Date("2026-11-22T23:00:00Z");
    await recordSearch(beacon({ outcome: "direct" }), mon);
    await recordSearch(beacon({ outcome: "results", re: true }), sun);
    await recordSearch(beacon({ outcome: "sorry", via: "related" }), sun);
    await recordSearch(beacon({ outcome: "error", via: "ask" }), sun);
    await recordSearch(beacon({ outcome: "sorry" }), before);
    const s = await searchScore(14, sun.getTime());
    expect(s.sample).toBe(0.5);
    expect(s.weeks.map((w) => [w.week, w.from, w.searches])).toEqual([["2026-W48", "2026-11-23", 4], ["2026-W47", "2026-11-16", 1]]);
    expect(s.weeks[0]).toMatchObject({ answered: 0.5, direct: 0.25, sorry: 0.25, failed: 0.25, related: 0.5, reSearch: 0.5 });
    expect(s.weeks[1]).toMatchObject({ answered: 0, sorry: 1, reSearch: 0 });
  });
  it("keeps the last eight weeks even for a short speed period", async () => {
    const now = new Date("2026-11-25T12:00:00Z");
    await recordSearch(beacon({ ms: 5000 }), new Date("2026-10-07T12:00:00Z")); // W41: 8th week back counts
    await recordSearch(beacon(), new Date("2026-09-28T12:00:00Z")); // W40: too old
    const s = await searchScore(1, now.getTime());
    expect(s.weeks.map((w) => w.week)).toEqual(["2026-W41"]);
    expect(s.speed.phone.n).toBe(0); // outside the 1-day speed period
  });
  it("gives no rates for a week with nothing typed", () => {
    expect(weeksOf([{ day: "2026-11-23", searches: 2, via_related: 2, re_search: 0 }])[0]).toMatchObject({ related: 1, reSearch: null });
  });
});
