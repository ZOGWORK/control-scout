// Weekly rankings snapshots: which weeks are wanted, written once (idempotent), ranked by the shared
// rules, pruned past the retention window, and replayed from the same book the forecaster builds.
import { beforeEach, describe, expect, it } from "vitest";
import type { RatingBook } from "@control-scout/predict-engine";
import { all, migrate, openDb, run, setDb } from "../db";
import { ScoutForecaster } from "../predict/engine";
import { retainFrom, snapshotRankings, wantedWeeks } from "./rankings";
import { SNAPSHOT_RETAIN_WEEKS, WEEK_MS, weekStartMs } from "../../src/shared/rankings";

const at = (iso: string) => Date.parse(iso);

describe("wantedWeeks", () => {
  it("every Monday after the first match through the first Monday after the last, never ahead of now", () => {
    // First match Sat Oct 3, last Wed Oct 21; now is Fri Oct 30.
    expect(wantedWeeks(at("2026-10-03T15:00:00Z"), at("2026-10-21T18:00:00Z"), at("2026-10-30T12:00:00Z"))).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    // Season still going: up to this week's Monday.
    expect(wantedWeeks(at("2026-10-03T15:00:00Z"), at("2026-10-29T18:00:00Z"), at("2026-10-30T12:00:00Z"))).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    // Nothing yet: the first match is this week.
    expect(wantedWeeks(at("2026-10-27T15:00:00Z"), at("2026-10-28T18:00:00Z"), at("2026-10-30T12:00:00Z"))).toEqual([]);
  });
  it("nothing older than the retention window", () => {
    const now = at("2027-12-01T00:00:00Z");
    const w = wantedWeeks(at("2026-09-01T00:00:00Z"), at("2027-11-30T00:00:00Z"), now);
    expect(w[0]).toBe(retainFrom(now));
    expect(w).toHaveLength(SNAPSHOT_RETAIN_WEEKS + 1);
    expect(SNAPSHOT_RETAIN_WEEKS).toBeGreaterThanOrEqual(26);
  });
});

/**
 * A stand-in forecaster: a season whose matches run from `first` to `last`, and ratings given per
 * instant by `ratingsAt` (team → [rating, rated matches]). Counts replays.
 */
function fakeForecaster(season: number, first: number, last: number, ratingsAt: (ms: number) => Record<number, [number, number]>) {
  const f = {
    replays: 0,
    seasons: [season],
    seasonEvents: (s: number) => (s === season ? [{ matches: [{ time: first }, { time: last }] }] : []),
    replayTo(_s: number, times: number[], cb: (ms: number, book: RatingBook) => void) {
      f.replays++;
      for (const t of [...times].sort((a, b) => a - b)) {
        const r = ratingsAt(t);
        const ratings = new Map(Object.entries(r).map(([team, [, n]]) => [Number(team), { n }]));
        cb(t, { ratings, get: (team: number) => ({ auto: r[team][0], teleop: 0, endgame: 0 }) } as unknown as RatingBook);
      }
    },
  };
  return f;
}

describe("snapshotRankings", () => {
  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  const first = at("2026-10-03T15:00:00Z"), last = at("2026-10-21T18:00:00Z");
  // Week by week: team 7 overtakes 5; 9 has two matches until the third week; 3 ties 7 on rating in week 2.
  const ratingsAt = (ms: number): Record<number, [number, number]> => (ms < at("2026-10-12T00:00:00Z")
    ? { 5: [80, 3], 7: [70, 4], 9: [99, 2], 3: [10, 3] }
    : ms < at("2026-10-19T00:00:00Z")
      ? { 5: [80.004, 5], 7: [90, 6], 9: [99, 2], 3: [90.001, 3] }
      : { 5: [85, 7], 7: [91, 8], 9: [60, 3], 3: [40, 4] });

  it("writes each wanted week once, ranked by the shared rules; a second run writes nothing", async () => {
    const f = fakeForecaster(2026, first, last, ratingsAt);
    const now = at("2026-10-23T09:00:00Z");
    const r = await snapshotRankings({ now, forecaster: f as unknown as ScoutForecaster });
    expect(r.written).toEqual([{ season: 2026, week: "2026-10-05", teams: 3 }, { season: 2026, week: "2026-10-12", teams: 3 }, { season: 2026, week: "2026-10-19", teams: 4 }]);
    expect(f.replays).toBe(1); // one replay for every missing week
    const rows = await all<any>("SELECT week, team, rank, rating FROM ranking_snapshots ORDER BY week, rank");
    expect(rows.map((x) => [x.week, x.rank, x.team, x.rating])).toEqual([
      ["2026-10-05", 1, 5, 80], ["2026-10-05", 2, 7, 70], ["2026-10-05", 3, 3, 10], // 9: under 3 rated matches
      // Ratings stored to 0.01: 3 and 7 tie at 90 and go by team number; 5 is 80.
      ["2026-10-12", 1, 3, 90], ["2026-10-12", 2, 7, 90], ["2026-10-12", 3, 5, 80],
      ["2026-10-19", 1, 7, 91], ["2026-10-19", 2, 5, 85], ["2026-10-19", 3, 9, 60], ["2026-10-19", 4, 3, 40],
    ]);
    const again = await snapshotRankings({ now, forecaster: f as unknown as ScoutForecaster });
    expect(again.written).toEqual([]);
    expect(f.replays).toBe(1); // nothing missing: no replay at all
  });

  it("a written week is never rewritten, even when the data behind it changes", async () => {
    const f1 = fakeForecaster(2026, first, last, ratingsAt);
    await snapshotRankings({ now: at("2026-10-13T09:00:00Z"), forecaster: f1 as unknown as ScoutForecaster });
    const f2 = fakeForecaster(2026, first, last, () => ({ 5: [1, 9], 7: [2, 9], 3: [3, 9] }));
    const r = await snapshotRankings({ now: at("2026-10-23T09:00:00Z"), forecaster: f2 as unknown as ScoutForecaster });
    expect(r.written.map((w) => w.week)).toEqual(["2026-10-19"]);
    expect((await all<any>("SELECT team FROM ranking_snapshots WHERE week = '2026-10-05' ORDER BY rank")).map((x) => x.team)).toEqual([5, 7, 3]);
  });

  it("prunes weeks past the retention window, keeping at least 26 weeks", async () => {
    const f = fakeForecaster(2026, first, last, ratingsAt);
    await snapshotRankings({ now: at("2026-10-23T09:00:00Z"), forecaster: f as unknown as ScoutForecaster });
    // 26 weeks on: all kept.
    let r = await snapshotRankings({ now: at("2026-10-23T09:00:00Z") + 26 * WEEK_MS, forecaster: fakeForecaster(2026, first, last, ratingsAt) as unknown as ScoutForecaster });
    expect(r.pruned).toBe(0);
    // (that run also writes the season's final week, the Monday after its last match, now in the past)
    expect((await all<any>("SELECT week FROM ranking_weeks ORDER BY week")).map((x) => x.week)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    // Past the window: the oldest weeks (rows and markers) go.
    const later = weekStartMs("2026-10-12") + SNAPSHOT_RETAIN_WEEKS * WEEK_MS + 3600_000;
    r = await snapshotRankings({ now: later, forecaster: fakeForecaster(2026, first, last, ratingsAt) as unknown as ScoutForecaster });
    expect(r.pruned).toBe(3);
    expect((await all<any>("SELECT week FROM ranking_weeks ORDER BY week")).map((x) => x.week)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    expect((await all<any>("SELECT DISTINCT week FROM ranking_snapshots ORDER BY week")).map((x) => x.week)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("a season with no rated matches gets no weeks", async () => {
    const f = { ...fakeForecaster(2026, first, last, ratingsAt), seasonEvents: () => [] };
    expect((await snapshotRankings({ now: at("2026-10-23T09:00:00Z"), forecaster: f as unknown as ScoutForecaster })).written).toEqual([]);
  });
});

describe("ScoutForecaster.replayTo", () => {
  it("replayed past the last match, the book holds the forecaster's own ratings; earlier, only earlier matches count", async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    const S = 2024;
    await run("INSERT INTO seasons (season, name) VALUES (?, 'x')", [S]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'E1', 'Qual', 'Qualifier', '2024-11-02', '2024-11-02', 'UTC', 0, 0, 'test'), (?, 'E2', 'Qual 2', 'Qualifier', '2024-11-16', '2024-11-16', 'UTC', 0, 0, 'test')", [S, S]);
    let n = 0;
    const match = async (code: string, time: string, red: number[], blue: number[], r: number, b: number) => {
      n++;
      await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
        blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 'test')`,
        [S, code, n, `Q${n}`, time, r, r, r / 4, r / 2, r / 4, b, b, b / 4, b / 2, b / 4]);
      for (const [alliance, ts] of [["red", red], ["blue", blue]] as const)
        for (const [i, t] of ts.entries()) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, surrogate, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, 0, 1)", [S, code, n, t, alliance, i + 1]);
    };
    for (const t of [1, 2, 3, 4]) await run("INSERT INTO teams (number, name) VALUES (?, ?)", [t, `T${t}`]);
    await match("E1", "2024-11-02T10:00:00", [1, 2], [3, 4], 120, 60);
    await match("E1", "2024-11-02T10:10:00", [1, 3], [2, 4], 100, 70);
    await match("E1", "2024-11-02T10:20:00", [1, 4], [2, 3], 90, 80);
    await match("E2", "2024-11-16T10:00:00", [2, 3], [1, 4], 150, 40);
    const f = new ScoutForecaster(S);
    await f.rebuild();
    const stored = f.book(S)!.ratings;
    expect(stored.size).toBe(4);
    const seen: { ms: number; ns: number[]; ratings: Map<number, unknown> }[] = [];
    f.replayTo(S, [Date.parse("2024-12-01T00:00:00Z"), Date.parse("2024-11-04T00:00:00Z")], (ms, book) => {
      seen.push({ ms, ns: [...book.ratings.values()].map((r) => r.n), ratings: new Map([...book.ratings].map(([t, r]) => [t, { ...r }])) });
    });
    expect(seen.map((s) => s.ms)).toEqual([Date.parse("2024-11-04T00:00:00Z"), Date.parse("2024-12-01T00:00:00Z")]); // in time order
    expect(seen[0].ns).toEqual([3, 3, 3, 3]); // the first event only
    expect(seen[1].ratings).toEqual(new Map([...stored].map(([t, r]) => [t, { ...r }])));
  });
});
