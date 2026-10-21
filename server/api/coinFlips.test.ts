// The coin-flip radar: "today" is each venue's own date (not the server's UTC date), only calls between
// 45% and 55% count, thin-data (provisional) calls are left out and counted, a decided match keeps only a
// call logged before it (with its result), an event with no known zone is left out, and a stored radar
// drops rows once their venue's midnight passes. Then end to end: logged calls in the database → the
// job → kv → GET /api/home/coin-flips.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { kvGet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { CURRENT_SEASON } from "../data/seasons";
import { arrange, buildCoinFlips, current, eventCoinFlips, KV_KEY, refreshCoinFlips, resetCoinFlips } from "./coinFlips";
import { matchDay, type CoinFlipRadar, type CoinFlipRow } from "../../src/shared/coinFlips";
import type { MatchView } from "../../src/shared/api";

const S = CURRENT_SEASON;
const LA = { code: "LAQ", name: "LA Qualifier", city: "Los Angeles", state: "CA", country: "USA", timezone: "America/Los_Angeles", start: "2026-10-17", end: "2026-10-17", type: "Qualifier" };

function mv(n: number, time: string, pRed: number | null, o: { tier?: "provisional" | "moderate" | "confident"; kind?: "live" | "now" | "backtest"; played?: boolean; scores?: [number, number] } = {}): MatchView {
  const team = (x: number, onField = true) => ({ number: x, surrogate: false, dq: false, onField });
  return {
    season: S, code: "LAQ", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time, startsAt: null, played: !!o.played,
    red: { teams: [team(n * 10 + 1), team(n * 10 + 2)], score: o.scores ? { total: o.scores[0], np: o.scores[0], auto: 0, teleop: 0, endgame: 0, pen: 0 } : null },
    blue: { teams: [team(n * 10 + 3), team(n * 10 + 4)], score: o.scores ? { total: o.scores[1], np: o.scores[1], auto: 0, teleop: 0, endgame: 0, pen: 0 } : null },
    video: null,
    prediction: pRed == null ? null : { pRed, redMean: 100, blueMean: 100, tier: o.tier ?? "moderate", kind: o.kind ?? "now", predictedAt: null },
  } as MatchView;
}

// 05:00 UTC on the 18th is still 22:00 on the 17th in Los Angeles.
const NOW = Date.parse("2026-10-18T05:00:00Z");

describe("eventCoinFlips", () => {
  it("reads today on the venue's calendar, not UTC's", () => {
    const r = eventCoinFlips(LA, [mv(1, "2026-10-17T21:30:00", 0.5), mv(2, "2026-10-18T09:00:00", 0.5)], NOW);
    expect(r.rows.map((x) => x.label)).toEqual(["Q1"]);
    expect(r.rows[0].day).toBe("2026-10-17");
    expect(r.scheduled).toBe(true);
  });

  it("keeps only calls from 45% to 55%, either side", () => {
    const r = eventCoinFlips(LA, [mv(1, "2026-10-17T10:00:00", 0.45), mv(2, "2026-10-17T10:10:00", 0.55), mv(3, "2026-10-17T10:20:00", 0.449), mv(4, "2026-10-17T10:30:00", 0.62)], NOW);
    expect(r.rows.map((x) => x.label)).toEqual(["Q1", "Q2"]);
    expect(r.calls).toBe(4);
  });

  it("leaves out thin-data calls and counts them", () => {
    const r = eventCoinFlips(LA, [mv(1, "2026-10-17T10:00:00", 0.5, { tier: "provisional" }), mv(2, "2026-10-17T10:10:00", 0.51, { tier: "confident" })], NOW);
    expect(r.rows.map((x) => x.label)).toEqual(["Q2"]);
    expect(r.thin).toBe(1);
  });

  it("keeps a decided match only with a call logged before it, and adds its result", () => {
    const r = eventCoinFlips(LA, [
      mv(1, "2026-10-17T10:00:00", 0.52, { kind: "live", played: true, scores: [120, 118] }),
      mv(2, "2026-10-17T10:10:00", 0.5, { kind: "backtest", played: true, scores: [90, 95] }),
      mv(3, "2026-10-17T10:20:00", null),
    ], NOW);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ label: "Q1", played: true, kind: "live", result: { red: 120, blue: 118 } });
    expect(r.calls).toBe(1);
  });

  it("leaves out an event whose zone isn't known", () => {
    const r = eventCoinFlips({ ...LA, timezone: null }, [mv(1, "2026-10-17T21:30:00", 0.5)], NOW);
    expect(r).toEqual({ rows: [], calls: 0, thin: 0, scheduled: false });
  });

  it("leaves a robot that wasn't on the field out of a decided lineup", () => {
    const m = mv(1, "2026-10-17T10:00:00", 0.5, { kind: "live", played: true, scores: [50, 50] });
    m.red.teams.push({ number: 999, surrogate: false, dq: false, onField: false });
    expect(eventCoinFlips(LA, [m], NOW).rows[0].red).toEqual([11, 12]);
  });
});

describe("matchDay", () => {
  it("takes an event-local wall time's own date, and reads a zoned time in the venue's zone", () => {
    expect(matchDay("2026-10-17T23:59:00", null, "Australia/Sydney")).toBe("2026-10-17");
    expect(matchDay("2026-10-17T20:00:00Z", null, "Australia/Sydney")).toBe("2026-10-18");
    expect(matchDay(null, null, "Australia/Sydney")).toBeNull();
  });
});

const row = (o: Partial<CoinFlipRow>): CoinFlipRow => ({
  season: S, code: "X", key: "qual:0:1", label: "Q1", eventName: "X", place: null, timezone: "America/Los_Angeles", day: "2026-10-17",
  time: null, startsAt: null, red: [1, 2], blue: [3, 4], pRed: 0.5, tier: "moderate", kind: "now", played: false, result: null, ...o,
});

describe("arrange and current", () => {
  it("puts the soonest still to play first and the latest decided first", () => {
    const a = arrange([
      row({ key: "a", startsAt: "2026-10-17T20:00:00Z" }), row({ key: "b", startsAt: "2026-10-17T18:00:00Z" }), row({ key: "c" }),
      row({ key: "d", played: true, result: { red: 1, blue: 0 }, startsAt: "2026-10-17T15:00:00Z" }),
      row({ key: "e", played: true, result: { red: 1, blue: 0 }, startsAt: "2026-10-17T16:00:00Z" }),
    ]);
    expect(a.upcoming.map((x) => x.key)).toEqual(["b", "a", "c"]);
    expect(a.decided.map((x) => x.key)).toEqual(["e", "d"]);
  });

  it("drops rows once their venue has moved to another day", () => {
    const r: CoinFlipRadar = { generatedAt: "", band: { lo: 0.45, hi: 0.55 }, events: 2, calls: 2, thin: 0, decided: [],
      upcoming: [row({ key: "la" }), row({ key: "syd", timezone: "Australia/Sydney", day: "2026-10-18" })] };
    // 08:00 UTC on the 18th: 01:00 on the 18th in Los Angeles, 19:00 on the 18th in Sydney.
    expect(current(r, Date.parse("2026-10-18T08:00:00Z")).upcoming.map((x) => x.key)).toEqual(["syd"]);
    expect(current(r, Date.parse("2026-10-18T05:00:00Z")).upcoming.map((x) => x.key)).toEqual(["la", "syd"]);
  });
});

describe("the job and GET /api/home/coin-flips", () => {
  let server: Server;
  let base = "";
  // An event on today in New York, with a schedule: one coin flip to play, one decided, one not close.
  const now = Date.now();
  const nyDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const nyClock = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(ms));
  const today = nyDate(now);
  // Wall times on today's venue date (clamped inside it, whatever the hour the test runs at).
  const wall = (deltaMin: number) => { const t = now + deltaMin * 60_000; return nyDate(t) === today ? `${today}T${nyClock(t)}` : `${today}T${deltaMin < 0 ? "00:00:01" : "23:59:59"}`; };

  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO events (season, code, name, type, city, state, country, timezone, start, end, remote, hybrid, source) VALUES (?, 'NYQ', 'NY Qualifier', 'Qualifier', 'Albany', 'NY', 'USA', 'America/New_York', ?, ?, 0, 0, 'test')", [S, today, today]);
    const matches: [number, string, number, number | null][] = [[1, wall(-30), 1, 0.52], [2, wall(30), 0, 0.49], [3, wall(40), 0, 0.8]];
    for (const [n, time, played, p] of matches) {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'NYQ', 'qual', 0, ?, ?, ?, ?, ?, ?, ?, ?, 'test')",
        [S, n, `Q${n}`, time, played, played ? 101 : null, played ? 101 : null, played ? 99 : null, played ? 99 : null]);
      for (const [team, alliance] of [[n * 10 + 1, "red"], [n * 10 + 2, "red"], [n * 10 + 3, "blue"], [n * 10 + 4, "blue"]] as const)
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (?, 'NYQ', 'qual', 0, ?, ?, ?, 1)", [S, n, team, alliance]);
      if (p != null) await run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time)
        VALUES ('live', ?, 'NYQ', 'qual', 0, ?, '[]', '[]', ?, 100, 100, 'moderate', 'test', ?, ?)`, [S, n, p, new Date(now - 3 * 3600_000).toISOString(), time]);
    }
    server = createApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server?.close());
  beforeEach(() => resetCoinFlips());

  it("gathers today's coin flips across events", async () => {
    const r = await buildCoinFlips(now);
    expect(r.events).toBe(1);
    expect(r.calls).toBe(3);
    expect(r.upcoming.map((x) => x.label)).toEqual(["Q2"]);
    expect(r.upcoming[0]).toMatchObject({ eventName: "NY Qualifier", place: "Albany, NY", timezone: "America/New_York", day: today, red: [21, 22], blue: [23, 24], pRed: 0.49 });
    expect(r.decided.map((x) => [x.label, x.result])).toEqual([["Q1", { red: 101, blue: 99 }]]);
  });

  it("stores the radar, and the route answers from it", async () => {
    await refreshCoinFlips();
    const stored = await kvGet<CoinFlipRadar>(KV_KEY);
    expect(stored?.upcoming).toHaveLength(1);
    const res = await fetch(`${base}/api/home/coin-flips`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoinFlipRadar;
    expect(body.generatedAt).toBe(stored!.generatedAt);
    expect(body.upcoming[0].pRed).toBe(0.49);
    expect(res.headers.get("cache-control")).toMatch(/public/);
  });

  it("gathers afresh when nothing is stored yet", async () => {
    await run("DELETE FROM kv WHERE key = ?", [KV_KEY]);
    const body = (await (await fetch(`${base}/api/home/coin-flips`)).json()) as CoinFlipRadar;
    expect(body.upcoming.map((x) => x.label)).toEqual(["Q2"]);
  });
});
