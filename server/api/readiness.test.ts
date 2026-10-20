// DATA-F01: a season with real played results but no derived team records (a fresh
// restore, or statistics lagging behind a sync) must not report its results counts as
// facts. The overview exposes the season's readiness: "preparing" until records exist,
// "catching-up" while a newer sync waits for them, "ready" otherwise.
import { beforeEach, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { CURRENT_SEASON } from "../data/seasons";
import { buildOverview, homeOverview } from "./home";
import { recordsAtKey, resultsAtKey, seasonReadiness, unprovenSeasons } from "./readiness";
import { computeRecords } from "../stats/records";
import { loadSeason } from "../stats/load";

const S = CURRENT_SEASON;

/** Six US teams, four of whom played two scored qualification matches at an in-person event. */
async function fixture({ remote = false } = {}) {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  await run("INSERT INTO seasons (season, name, last_sync) VALUES (?, 'Test', '2026-10-17T12:00:00.000Z')", [S]);
  for (let t = 1; t <= 6; t++) {
    await run("INSERT INTO teams (number, name, country) VALUES (?, ?, 'USA')", [t, `Team ${t}`]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, t]);
  }
  await run("INSERT INTO events (season, code, name, type, remote, hybrid, source, start, end) VALUES (?, 'Q1', 'Q1', 'Qualifier', ?, 0, 'test', '2026-10-10', '2026-10-10')", [S, remote ? 1 : 0]);
  for (const [n, red, blue] of [[1, [1, 2], [3, 4]], [2, [1, 3], [2, 4]]] as const) {
    await run(`INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
      blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, 'Q1', 'qual', 0, ?, ?, 1, 50, 50, 10, 30, 10, 0, 40, 40, 10, 20, 10, 0, 'test')`, [S, n, `Q${n}`]);
    for (const [alliance, teams] of [["red", red], ["blue", blue]] as const)
      for (const t of teams) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, 'Q1', 'qual', 0, ?, ?, ?)", [S, n, t, alliance]);
  }
}

describe("season readiness (DATA-F01)", () => {
  beforeEach(() => fixture());

  it("reports real results with no records as being prepared, not as a zero", async () => {
    const o = await buildOverview(S);
    // The raw data has played results...
    expect(o.coverage.matchScores).toBe(2);
    // ...the records behind withResults don't exist yet, so withResults is 0 and must not be read as a fact.
    expect(o.countries.find((c) => c.code === "US")?.withResults).toBe(0);
    expect(o.readiness.state).toBe("preparing");
    expect(o.readiness.resultsAt).toBe("2026-10-17T12:00:00.000Z");
    expect(o.readiness.statsAt).toBeNull();
  });

  it("is ready once the records are built after the latest sync, with the true counts", async () => {
    await computeRecords(S, await loadSeason(S));
    clearAllCaches();
    const o = await homeOverview(S);
    expect(o.readiness.state).toBe("ready");
    expect(o.readiness.statsAt).not.toBeNull();
    expect(o.countries.find((c) => c.code === "US")).toMatchObject({ listings: 6, withResults: 4 });
  });

  it("is catching up while a sync newer than the records waits for the next build", async () => {
    await computeRecords(S, await loadSeason(S));
    await kvSet(recordsAtKey(S), { at: "2026-10-17T11:00:00.000Z" });
    expect((await seasonReadiness(S)).state).toBe("catching-up");
    // The cached overview moves with the season's sync and build, not only the data version.
    const before = await homeOverview(S);
    expect(before.readiness.state).toBe("catching-up");
    await kvSet(recordsAtKey(S), { at: "2026-10-17T12:30:00.000Z" });
    expect((await homeOverview(S)).readiness.state).toBe("ready");
  });

  it("is catching up when the live lane stores results its throttled records build hasn't taken in", async () => {
    await computeRecords(S, await loadSeason(S));
    expect((await seasonReadiness(S)).state).toBe("ready");
    await kvSet(resultsAtKey(S), { at: new Date(Date.now() + 60_000).toISOString() });
    expect((await seasonReadiness(S)).state).toBe("catching-up");
    await computeRecords(S, await loadSeason(S));
    await kvSet(recordsAtKey(S), { at: new Date(Date.now() + 120_000).toISOString() });
    expect((await seasonReadiness(S)).state).toBe("ready");
  });

  it("never borrows the live lane's build time for another season", async () => {
    await run("INSERT INTO seasons (season, name, last_sync) VALUES (?, 'Past', '2026-01-01T00:00:00.000Z')", [S - 1]);
    await kvSet("records:last", { at: "2026-10-17T13:00:00.000Z" });
    expect((await seasonReadiness(S - 1)).statsAt).toBeNull();
    await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [S]);
    expect((await seasonReadiness(S)).statsAt).toBe("2026-10-17T13:00:00.000Z");
  });

  it("falls back to the stats job's time when the season has no stamp of its own", async () => {
    await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [S]);
    await kvSet("stats:last", { at: "2026-10-17T13:00:00.000Z", seasons: [S] });
    expect(await seasonReadiness(S)).toEqual({ state: "ready", resultsAt: "2026-10-17T12:00:00.000Z", statsAt: "2026-10-17T13:00:00.000Z" });
    // A stats run that didn't cover this season says nothing about it.
    await kvSet("stats:last", { at: "2026-10-17T13:00:00.000Z", seasons: [S - 1] });
    expect((await seasonReadiness(S)).statsAt).toBeNull();
  });

  // PUB3-F05: records exist, but nothing says when they were built (no per-season stamp, and no stats
  // run or live build that covers the season), so nothing shows they include the latest results.
  it("is catching up, not up to date, when the records have no build time at all (PUB3-F05)", async () => {
    await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [S]);
    expect(await seasonReadiness(S)).toEqual({ state: "catching-up", resultsAt: "2026-10-17T12:00:00.000Z", statsAt: null });
    expect((await buildOverview(S)).readiness.state).toBe("catching-up");
  });

  it("is catching up when the only stats run on record covered another season (PUB3-F05)", async () => {
    await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [S]);
    await kvSet("stats:last", { at: "2026-10-17T13:00:00.000Z", seasons: [S - 1] });
    expect(await seasonReadiness(S)).toEqual({ state: "catching-up", resultsAt: "2026-10-17T12:00:00.000Z", statsAt: null });
    // A past season never borrows the live lane's build time either.
    await run("INSERT INTO seasons (season, name, last_sync) VALUES (?, 'Past', '2026-01-01T00:00:00.000Z')", [S - 1]);
    await run("INSERT INTO events (season, code, name, type, remote, hybrid, source, start, end) VALUES (?, 'P1', 'P1', 'Qualifier', 0, 0, 'test', '2025-11-01', '2025-11-01')", [S - 1]);
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'P1', 'qual', 0, 1, 'Q1', 1, 50, 50, 40, 40, 'test')", [S - 1]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, 'P1', 'qual', 0, 1, 1, 'red')", [S - 1]);
    await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [S - 1]);
    await kvSet("stats:last", { at: "2026-10-17T13:00:00.000Z", seasons: [S - 2] });
    // Both are what the data cycle rebuilds, newest first.
    expect(await unprovenSeasons()).toEqual([S, S - 1]);
    // The live lane's build (current season only) proves the current season, never the past one.
    await kvSet("records:last", { at: "2026-10-17T13:00:00.000Z" });
    expect((await seasonReadiness(S)).state).toBe("ready");
    expect(await seasonReadiness(S - 1)).toEqual({ state: "catching-up", resultsAt: "2026-01-01T00:00:00.000Z", statsAt: null });
    expect(await unprovenSeasons()).toEqual([S - 1]);
    // A records build stamps it ready.
    await kvSet(recordsAtKey(S - 1), { at: "2026-10-17T14:00:00.000Z" });
    expect((await seasonReadiness(S - 1)).state).toBe("ready");
    expect(await unprovenSeasons()).toEqual([]);
  });

  it("is catching up with no build time even when the season's sync time is unknown too (PUB3-F05)", async () => {
    await run("UPDATE seasons SET last_sync = NULL WHERE season = ?", [S]);
    await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [S]);
    expect(await seasonReadiness(S)).toEqual({ state: "catching-up", resultsAt: null, statsAt: null });
  });

  it("keeps a stamped build that took in the latest results ready (PUB3-F05 doesn't over-reach)", async () => {
    await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [S]);
    await kvSet(recordsAtKey(S), { at: "2026-10-17T12:00:00.000Z" }); // built from exactly the latest sync
    expect((await seasonReadiness(S)).state).toBe("ready");
    expect(await unprovenSeasons()).toEqual([]);
  });

  it("still says preparing, not catching up, when results have no records at all (with or without a stamp)", async () => {
    expect(await seasonReadiness(S)).toEqual({ state: "preparing", resultsAt: "2026-10-17T12:00:00.000Z", statsAt: null });
    await kvSet(recordsAtKey(S), { at: "2026-10-17T13:00:00.000Z" });
    expect(await seasonReadiness(S)).toEqual({ state: "preparing", resultsAt: "2026-10-17T12:00:00.000Z", statsAt: null });
    expect(await unprovenSeasons()).toEqual([]);
  });

  it("a genuine zero (nothing played) with no build time is still ready", async () => {
    await run("UPDATE matches SET played = 0 WHERE season = ?", [S]);
    expect(await seasonReadiness(S)).toEqual({ state: "ready", resultsAt: "2026-10-17T12:00:00.000Z", statsAt: null });
  });

  it("remote-only results with no build time are still ready (they never get qualification records)", async () => {
    await fixture({ remote: true });
    expect(await seasonReadiness(S)).toEqual({ state: "ready", resultsAt: "2026-10-17T12:00:00.000Z", statsAt: null });
    await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [S]);
    expect((await seasonReadiness(S)).state).toBe("ready");
  });

  it("is ready with a true zero when nothing the records count has been played", async () => {
    await run("UPDATE matches SET played = 0 WHERE season = ?", [S]);
    expect((await seasonReadiness(S)).state).toBe("ready");
  });

  it("doesn't wait for records remote events never get", async () => {
    await fixture({ remote: true });
    expect((await seasonReadiness(S)).state).toBe("ready");
  });
});
