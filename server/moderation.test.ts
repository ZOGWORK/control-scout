// Abuse signals (server/moderation.ts): addresses cut to a coarse range before anything is counted, per-day
// counts per range and kind, bursts, retention, and the middleware on the real app.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import {
  BURST_PER_MINUTE, MAX_RANGES, OTHER_RANGE, RETENTION_DAYS, UNKNOWN_RANGE, abuseSummary, flushAbuse, ipRange, pendingAbuseKeys, recordAbuseSignal, resetAbuse,
} from "./moderation";

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const NOW = Date.parse("2026-10-20T12:00:00Z");

/** Anything that looks like a whole address: four IPv4 parts, or IPv6 with more than two groups before "::". */
const FULL_V4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
const looksFull = (s: string) => (FULL_V4.test(s) && !/\.0\.0\/16$/.test(s)) || /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+/i.test(s);

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
beforeEach(async () => {
  resetAbuse();
  await run("DELETE FROM abuse_daily");
});

describe("ipRange", () => {
  it("cuts IPv4 to its /16 and IPv6 to its /32, never returning the address", () => {
    expect(ipRange("203.0.113.77")).toBe("203.0.0.0/16");
    expect(ipRange("::ffff:198.51.100.9")).toBe("198.51.0.0/16");
    expect(ipRange("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8::/32");
    expect(ipRange("2001:0DB8::1")).toBe("2001:db8::/32");
    expect(ipRange("2001::7")).toBe("2001:0::/32");
    expect(ipRange("::1")).toBe("0:0::/32");
    expect(ipRange("fe80::1%eth0")).toBe("fe80:0::/32");
  });

  it("answers unknown for anything that isn't an address", () => {
    for (const x of [undefined, null, "", "localhost", "999.1.2.3", "1:2:3::4::5", "not:an:ip!"]) expect(ipRange(x as string)).toBe(UNKNOWN_RANGE);
  });
});

describe("counting", () => {
  it("never holds or stores a full address: only day, range, kind and a count", async () => {
    const ips = ["203.0.113.77", "203.0.113.78", "198.51.100.9", "2001:db8:85a3:8d3:1319:8a2e:370:7348", "::ffff:192.0.2.44"];
    for (const ip of ips) {
      recordAbuseSignal(ip, 429, BROWSER, NOW);
      recordAbuseSignal(ip, 200, "curl/8.4.0", NOW);
    }
    for (const k of pendingAbuseKeys()) {
      for (const ip of ips) expect(k).not.toContain(ip);
      expect(looksFull(k.split("\u0000")[1])).toBe(false);
    }
    await flushAbuse(NOW);
    const rows = await all<{ day: string; ip_range: string; kind: string; count: number }>("SELECT * FROM abuse_daily ORDER BY ip_range, kind");
    const cols = Object.keys(rows[0] ?? {}).sort();
    expect(cols).toEqual(["count", "day", "ip_range", "kind"]);
    for (const r of rows) {
      for (const ip of ips) expect(JSON.stringify(r)).not.toContain(ip);
      expect(looksFull(r.ip_range)).toBe(false);
      expect(r.ip_range).toMatch(/^(\d+\.\d+\.0\.0\/16|[0-9a-f]+:[0-9a-f]+::\/32)$/);
    }
    // Two addresses in one /16 count together.
    expect(rows.filter((r) => r.ip_range === "203.0.0.0/16").map((r) => [r.kind, Number(r.count)])).toEqual([["bot_ua", 2], ["rate_limited", 2]]);
  });

  it("counts ordinary browser traffic not at all", async () => {
    for (let i = 0; i < 50; i++) recordAbuseSignal("203.0.113.1", 200, BROWSER, NOW);
    expect(pendingAbuseKeys()).toEqual([]);
  });

  it("counts a burst once per minute a range goes over the ceiling", async () => {
    for (let i = 0; i < BURST_PER_MINUTE * 2; i++) recordAbuseSignal("203.0.113.1", 200, BROWSER, NOW);
    // The next minute: under the ceiling again.
    for (let i = 0; i < 10; i++) recordAbuseSignal("203.0.113.1", 200, BROWSER, NOW + 60_000);
    await flushAbuse(NOW);
    const s = await abuseSummary(7, NOW);
    expect(s.totals).toEqual({ rate_limited: 0, bot_ua: 0, burst: 1 });
    expect(s.ranges).toEqual([{ range: "203.0.0.0/16", rate_limited: 0, bot_ua: 0, burst: 1, days: 1 }]);
  });

  it("caps the ranges a day holds, the rest counting as other", () => {
    for (let i = 0; i < MAX_RANGES + 5; i++) recordAbuseSignal(`${1 + Math.floor(i / 256)}.${i % 256}.0.1`, 429, BROWSER, NOW);
    const ranges = new Set(pendingAbuseKeys().map((k) => k.split("\u0000")[1]));
    expect(ranges.size).toBe(MAX_RANGES + 1);
    expect(ranges.has(OTHER_RANGE)).toBe(true);
  });

  it("sums per day for the summary, and drops days past retention when it flushes", async () => {
    await run("INSERT INTO abuse_daily (day, ip_range, kind, count) VALUES ('2026-01-01', '203.0.0.0/16', 'rate_limited', 9)");
    recordAbuseSignal("203.0.113.1", 429, BROWSER, NOW);
    recordAbuseSignal("203.0.113.1", 429, BROWSER, NOW - 86_400_000);
    await flushAbuse(NOW);
    const days = (await all<{ day: string }>("SELECT DISTINCT day FROM abuse_daily ORDER BY day")).map((r) => r.day);
    expect(days).toEqual(["2026-10-19", "2026-10-20"]);
    expect(RETENTION_DAYS).toBeLessThanOrEqual(90);
    const s = await abuseSummary(7, NOW);
    expect(s.daily).toHaveLength(7);
    expect(s.daily.at(-1)).toEqual({ day: "2026-10-20", rate_limited: 1, bot_ua: 0, burst: 0 });
    expect(s.daily.at(-2)).toEqual({ day: "2026-10-19", rate_limited: 1, bot_ua: 0, burst: 0 });
    expect(s.ranges[0]).toMatchObject({ range: "203.0.0.0/16", rate_limited: 2, days: 2 });
  });

  it("keeps the counters for the next try when a write fails", async () => {
    recordAbuseSignal("203.0.113.1", 429, BROWSER, NOW);
    await run("ALTER TABLE abuse_daily RENAME TO abuse_daily_away");
    try {
      await expect(flushAbuse(NOW + 86_400_000)).rejects.toThrow();
    } finally { await run("ALTER TABLE abuse_daily_away RENAME TO abuse_daily"); }
    expect(pendingAbuseKeys()).toHaveLength(1);
    expect(await flushAbuse(NOW)).toBe(1);
  });
});

describe("on the app", () => {
  it("counts scraper user agents on the API by range, and leaves the owner console and health checks out", async () => {
    await fetch(`${base}/api/meta`, { headers: { "User-Agent": "python-requests/2.31" } });
    await fetch(`${base}/api/health`, { headers: { "User-Agent": "python-requests/2.31" } });
    await fetch(`${base}/api/owner/overview`, { headers: { "User-Agent": "python-requests/2.31" } });
    await fetch(`${base}/api/meta`, { headers: { "User-Agent": BROWSER } });
    await new Promise((r) => setTimeout(r, 50));
    await flushAbuse();
    const rows = await all<{ ip_range: string; kind: string; count: number }>("SELECT ip_range, kind, count FROM abuse_daily");
    expect(rows.map((r) => ({ ...r, count: Number(r.count) }))).toEqual([{ ip_range: "127.0.0.0/16", kind: "bot_ua", count: 1 }]);
  });
});
