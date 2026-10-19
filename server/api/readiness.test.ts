// DATA-F01: a season with real played results but no derived team records (a fresh
// restore, or statistics lagging behind a sync) must not report its results counts as
// facts. The overview exposes the season's readiness: "preparing" until records exist,
// "catching-up" while a newer sync waits for them, "ready" otherwise.
import { beforeEach, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { CURRENT_SEASON } from "../data/seasons";
import { buildOverview, homeOverview } from "./home";
import { recordsAtKey, seasonReadiness } from "./readiness";
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

  it("falls back to the stats job's time when the season has no stamp of its own", async () => {
    await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [S]);
    await kvSet("stats:last", { at: "2026-10-17T13:00:00.000Z", seasons: [S] });
    expect(await seasonReadiness(S)).toEqual({ state: "ready", resultsAt: "2026-10-17T12:00:00.000Z", statsAt: "2026-10-17T13:00:00.000Z" });
    // A stats run that didn't cover this season says nothing about it.
    await kvSet("stats:last", { at: "2026-10-17T13:00:00.000Z", seasons: [S - 1] });
    expect((await seasonReadiness(S)).statsAt).toBeNull();
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
