// A team's newest season and that season's OPR, read by key (`x.season IN (…) AND x.team = …`) in the leaderboard's
// town, school, career and still-active boards. `x.team = …` alone read all of team_season_stats once per team: a town of
// 60 teams took 0.7 s.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../../db";
import { SEASONS_IN, SEASON_NUMBERS } from "../../data/seasons";
import { searchAnswer } from "../searchAnswer";
import { rebuildSearch } from "../../stats/job";

const NEWEST = (k: string) => `SELECT MAX(season) FROM team_season_stats x WHERE ${k}x.team = ? AND x.matches > 0`;
const OPR = (k: string) => `SELECT opr_np FROM team_season_stats x WHERE ${k}x.team = ? AND x.matches > 0 ORDER BY season DESC LIMIT 1`;
const KEY = `x.season IN (${SEASONS_IN}) AND `;

beforeAll(async () => {
  const c = openDb(":memory:"); setDb(c); await migrate(c);
  for (const [n, name] of [[501, "Keyed Bots"], [502, "Keyed Gears"], [503, "Keyed Rookies"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Keytown', 'NJ', 'USA')", [n, name]);
  }
  // 501: played 2024 and 2025, a 2026 row with no matches yet. 502: 2024 only. 503: never played.
  for (const [season, team, opr, matches] of [[2024, 501, 40, 10], [2025, 501, 55.5, 12], [2026, 501, 99, 0], [2024, 502, 20, 8]]) {
    await run("INSERT INTO team_season_stats (season, team, opr_np, matches) VALUES (?, ?, ?, ?)", [season, team, opr, matches]);
  }
  await rebuildSearch();
});

describe("a team's newest season, by key", () => {
  it("names every season the app holds", () => {
    expect(SEASONS_IN.split(", ").map(Number)).toEqual(SEASON_NUMBERS.map((s) => Math.trunc(s)));
  });

  it("finds the rows by the table's key, not a read of the whole table", async () => {
    const plan = (sql: string) => all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, [501]).then((rs) => rs.map((r) => r.detail).join(" / "));
    expect(await plan(NEWEST(KEY))).toMatch(/season=\? AND team=\?/);
    expect(await plan(OPR(KEY))).toMatch(/season=\? AND team=\?/);
  });

  it("gives what the read without the key gave", async () => {
    for (const team of [501, 502, 503]) {
      expect(await all(NEWEST(KEY).replace("?", String(team)))).toEqual(await all(NEWEST("").replace("?", String(team))));
      expect(await all(OPR(KEY).replace("?", String(team)))).toEqual(await all(OPR("").replace("?", String(team))));
    }
  });

  it("a town's teams: newest season played first with that season's OPR, a team yet to play last", async () => {
    const a = await searchAnswer("Teams in Keytown", { limit: 25 });
    const rows = (a.stat?.blocks ?? []).flatMap((b) => ("rows" in b ? (b.rows as { cells: Record<string, string | number> }[]) : [])).map((r) => r.cells);
    expect(rows.map((r) => [r.team, r.last, r.opr])).toEqual([["501 Keyed Bots", "2025–26", "55.5"], ["502 Keyed Gears", "2024–25", "20.0"], ["503 Keyed Rookies", "Not yet", "–"]]);
  });
});
