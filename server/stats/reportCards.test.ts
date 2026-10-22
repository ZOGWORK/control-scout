// Report cards: live calls only, per team per event and per season, shrunk toward the field average.
import { beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { aggregate, computeReportCards, refreshReportCards, REPORT_PRIOR, shrink, teamCalls, type LedgerRow } from "./reportCards";
import { teamReportCards } from "../api/teams";

const row = (o: Partial<LedgerRow>): LedgerRow => ({
  code: "E1", red: [1, 2], blue: [3, 4], pRed: 0.7, redMean: 100, blueMean: 80, redScore: 110, blueScore: 70, outcome: 1, scoreBasis: true, ...o,
});

describe("team calls", () => {
  it("gives each robot its alliance's call and an even share of the miss", () => {
    const calls = teamCalls([row({})]);
    expect(calls).toHaveLength(4);
    expect(calls.find((c) => c.team === 1)).toMatchObject({ right: true, residual: 5 });
    expect(calls.find((c) => c.team === 3)).toMatchObject({ right: true, residual: -5 }); // blue was the underdog and lost: the call was right
  });

  it("counts ties and coin-flip calls as neither right nor wrong", () => {
    expect(teamCalls([row({ outcome: 0.5, redScore: 80, blueScore: 80 })]).every((c) => c.right === null)).toBe(true);
    expect(teamCalls([row({ pRed: 0.5 })]).every((c) => c.right === null)).toBe(true);
  });

  it("leaves calls without a predicted score out of the miss numbers only", () => {
    const a = aggregate(teamCalls([row({ scoreBasis: false, redMean: 2, blueMean: 0 })]).filter((c) => c.team === 1));
    expect(a).toMatchObject({ calls: 1, decided: 1, hits: 1, scored: 0, errMean: null, errAbs: null, errVar: null });
  });

  it("aggregates mean, absolute and variance of the misses", () => {
    const a = aggregate(teamCalls([row({ redScore: 110 }), row({ redScore: 90, outcome: 1 })]).filter((c) => c.team === 1));
    expect(a.errMean).toBe(0);
    expect(a.errAbs).toBe(5);
    expect(a.errVar).toBe(25);
  });

  it("shrinks small samples toward the field", () => {
    expect(shrink(1, 2, 0.6)).toBeCloseTo((2 + REPORT_PRIOR * 0.6) / (2 + REPORT_PRIOR));
    expect(shrink(1, 1000, 0.6)).toBeGreaterThan(0.99);
    expect(shrink(null, 0, 0.6)).toBe(0.6);
  });
});

describe("stored report cards", () => {
  const S = 2026;
  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'DONE', 'Done event', 'Qualifier', '2026-10-01', '2026-10-01', 'UTC', 0, 0, 'test')", [S]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'NOW', 'Today', 'Qualifier', '2026-10-21', '2026-10-21', 'UTC', 0, 0, 'test')", [S]);
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'NOW', 'qual', 0, 9, 'Q9', 0, 'test')", [S]);
    const ins = (kind: string, code: string, n: number, pRed: number, red: number, blue: number) => run(
      `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, red_score, blue_score, outcome, scored_at)
       VALUES (?, ?, ?, 'qual', 0, ?, '[1,2]', '[3,4]', ?, 100, 80, 'moderate', 'x', '2026-10-01T00:00:00Z', ?, ?, ?, '2026-10-01T01:00:00Z')`,
      [kind, S, code, n, pRed, red, blue, red > blue ? 1 : red < blue ? 0 : 0.5],
    );
    await ins("live", "DONE", 1, 0.7, 110, 70);
    await ins("live", "DONE", 2, 0.7, 60, 90); // upset
    await ins("live", "NOW", 1, 0.6, 104, 80);
    // The replay never counts: a hundred wrong backtest calls change nothing.
    for (let i = 0; i < 100; i++) await ins("backtest", "DONE", 100 + i, 0.9, 0, 200);
  });

  it("uses live calls only, per event and per season, with finished events marked final", async () => {
    await computeReportCards(S, () => {}, Date.parse("2026-10-21T12:00:00Z"));
    const rows = await all<any>("SELECT * FROM team_report_cards WHERE team = 1 ORDER BY code");
    expect(rows.map((r) => [r.code, r.calls, r.hits, r.final])).toEqual([["", 3, 2, 0], ["DONE", 2, 1, 1], ["NOW", 1, 1, 0]]);
    const season = rows[0];
    // Field: every team-call pooled (12 calls: 3 matches × 4 robots); hit rate 8/12 (both sides of each match share its call).
    expect(season.hit_shrunk).toBeCloseTo((2 + REPORT_PRIOR * (8 / 12)) / (3 + REPORT_PRIOR), 4);
  });

  it("serves the season row and finished events only", async () => {
    await computeReportCards(S, () => {}, Date.parse("2026-10-21T12:00:00Z"));
    const r = await teamReportCards(S, 1);
    expect(r?.season?.calls).toBe(3);
    expect(r?.events.map((e) => e.code)).toEqual(["DONE"]);
    expect(r?.events[0].name).toBe("Done event");
    expect(r?.field?.calls).toBe(12);
    expect(r?.season?.raw.hitRate).toBeCloseTo(2 / 3);
    expect(await teamReportCards(S, 999)).toBeNull();
  });

  it("rewrites the season on every run (no stale rows)", async () => {
    await computeReportCards(S, () => {}, Date.parse("2026-10-21T12:00:00Z"));
    await run("DELETE FROM predictions WHERE kind = 'live' AND code = 'NOW'");
    await computeReportCards(S, () => {}, Date.parse("2026-10-21T12:00:00Z"));
    expect((await all<any>("SELECT code FROM team_report_cards WHERE team = 1 ORDER BY code")).map((r) => r.code)).toEqual(["", "DONE"]);
  });
});

describe("refreshing report cards across seasons", () => {
  const PAST = 2024, NOW_S = 2026;
  const T = Date.parse("2026-10-21T12:00:00Z");
  let id = 0;
  const live = (season: number, code: string, red: number, blue: number, scored = true) => run(
    `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, red_score, blue_score, outcome, scored_at)
     VALUES ('live', ?, ?, 'qual', 0, ?, '[1,2]', '[3,4]', 0.7, 100, 80, 'moderate', 'x', '2026-01-01T00:00:00Z', ?, ?, ?, ?)`,
    [season, code, ++id, scored ? red : null, scored ? blue : null, scored ? (red > blue ? 1 : red < blue ? 0 : 0.5) : null, scored ? `2026-01-01T00:00:${String(id % 60).padStart(2, "0")}Z` : null],
  );
  const seasonCalls = async (season: number) => (await all<any>("SELECT calls FROM team_report_cards WHERE season = ? AND team = 1 AND code = ''", [season]))[0]?.calls ?? 0;

  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    id = 0;
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'OLD', 'Old', 'Qualifier', '2025-02-01', '2025-02-01', 'UTC', 0, 0, 'test')", [PAST]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'NOW', 'Today', 'Qualifier', '2026-10-21', '2026-10-21', 'UTC', 0, 0, 'test')", [NOW_S]);
    await live(PAST, "OLD", 110, 70);
    await live(NOW_S, "NOW", 104, 80);
    await live(NOW_S, "NOW", 0, 0, false); // logged, not played yet: not part of any card
  });

  it("builds every season with scored live calls the first time, then skips the unchanged ones", async () => {
    expect(await refreshReportCards(() => {}, T)).toEqual([NOW_S, PAST]);
    expect(await refreshReportCards(() => {}, T)).toEqual([]);
  });

  it("rebuilds a past season that gains a scored live call, and only that season", async () => {
    await refreshReportCards(() => {}, T);
    expect(await seasonCalls(PAST)).toBe(1);
    await live(PAST, "OLD", 60, 90);
    expect(await refreshReportCards(() => {}, T)).toEqual([PAST]);
    expect(await seasonCalls(PAST)).toBe(2);
  });

  it("rebuilds when a logged call is scored", async () => {
    await refreshReportCards(() => {}, T);
    await run("UPDATE predictions SET red_score = 90, blue_score = 95, outcome = 0, scored_at = '2026-10-21T13:00:00Z' WHERE outcome IS NULL");
    expect(await refreshReportCards(() => {}, T)).toEqual([NOW_S]);
    expect(await seasonCalls(NOW_S)).toBe(2);
  });

  it("a call caught between its scores and its outcome is picked up once the outcome is in", async () => {
    await refreshReportCards(() => {}, T);
    await run("UPDATE predictions SET red_score = 90, blue_score = 95, scored_at = '2026-10-21T13:00:00Z' WHERE outcome IS NULL");
    expect(await refreshReportCards(() => {}, T)).toEqual([NOW_S]);
    expect(await seasonCalls(NOW_S)).toBe(1);
    await run("UPDATE predictions SET outcome = 0 WHERE outcome IS NULL");
    expect(await refreshReportCards(() => {}, T)).toEqual([NOW_S]);
    expect(await seasonCalls(NOW_S)).toBe(2);
    expect(await refreshReportCards(() => {}, T)).toEqual([]);
  });

  it("rebuilds a season with an open event once a day (events turn final as their last day passes)", async () => {
    await refreshReportCards(() => {}, T);
    const nextDay = T + 24 * 3600_000;
    expect(await refreshReportCards(() => {}, nextDay)).toEqual([NOW_S]); // PAST: every event final, skipped
    expect((await all<any>("SELECT final FROM team_report_cards WHERE season = ? AND code = 'NOW' AND team = 1", [NOW_S]))[0].final).toBe(1);
    expect(await refreshReportCards(() => {}, nextDay + 24 * 3600_000)).toEqual([]); // now final too
  });

  it("an event marked final that gains an unplayed match is rebuilt and drops back out of the finished ones", async () => {
    await refreshReportCards(() => {}, T);
    expect((await teamReportCards(PAST, 1))?.events.map((e) => e.code)).toEqual(["OLD"]);
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'OLD', 'playoff', 1, 1, 'F1', 0, 'test')", [PAST]);
    expect(await refreshReportCards(() => {}, T)).toEqual([PAST]);
    expect((await teamReportCards(PAST, 1))?.events).toEqual([]);
    expect(await refreshReportCards(() => {}, T)).toEqual([]);
    // Played (the sync brings the result): final again.
    await run("UPDATE matches SET played = 1 WHERE season = ? AND code = 'OLD'", [PAST]);
    expect(await refreshReportCards(() => {}, T)).toEqual([PAST]);
    expect((await teamReportCards(PAST, 1))?.events.map((e) => e.code)).toEqual(["OLD"]);
  });

  it("an event marked final whose end date moves to the future is rebuilt", async () => {
    await refreshReportCards(() => {}, T);
    await run("UPDATE events SET end = '2026-12-01' WHERE season = ? AND code = 'OLD'", [PAST]);
    expect(await refreshReportCards(() => {}, T)).toEqual([PAST]);
    expect((await all<any>("SELECT final FROM team_report_cards WHERE season = ? AND code = 'OLD' AND team = 1", [PAST]))[0].final).toBe(0);
  });

  it("never reads the backtest replay", async () => {
    await refreshReportCards(() => {}, T);
    for (let i = 0; i < 20; i++) await run(
      `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, red_score, blue_score, outcome, scored_at)
       VALUES ('backtest', ?, 'OLD', 'qual', 0, ?, '[1,2]', '[3,4]', 0.9, 100, 80, 'moderate', 'x', '2026-01-01T00:00:00Z', 0, 200, 0, '2026-10-21T13:00:00Z')`, [PAST, 1000 + i]);
    expect(await refreshReportCards(() => {}, T)).toEqual([]);
    expect(await seasonCalls(PAST)).toBe(1);
  });
});
