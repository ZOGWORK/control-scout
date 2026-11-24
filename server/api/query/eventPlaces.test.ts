// One place's teams that played in another ("<place> teams at <place> events", "teams from <place> who played in
// <place>"): the first place is the teams' home, the second where their events were held. The board lists the teams of
// the one that played an event in the other that season, never every team of either.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { resetSearchSeason } from "../answers/season";
import { searchAnswer } from "../searchAnswer";
import { parseQuery } from "./parse";
import { parseContext } from "./context";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const S = 2025;
const full = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });
/** The teams a board lists, in its order. */
const listed = async (q: string) => {
  const a = await full(q);
  const b = a.stat?.blocks.find((x) => x.kind === "leaderboard");
  return b?.kind === "leaderboard" ? b.rows.map((r) => Number(r.team.label.split(" ")[0])) : null;
};

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Maryland: three teams, two of them at New Jersey's qualifier; Delaware: one team, at New Jersey's too.
  for (const [n, name, state, opr] of [[30401, "Crab Bots", "MD", 60], [30402, "Bay Bots", "MD", 50], [30403, "Old Line Bots", "MD", 70], [30411, "Blue Hen Bots", "DE", 80]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run("INSERT INTO team_season_stats (season, team, matches, wins, losses, ties, opr_np, opr_auto, rating_np, rating_matches) VALUES (?, ?, 6, 3, 3, 0, ?, ?, ?, 6)", [S, n, opr, opr / 4, opr]);
  }
  for (const [code, name, state] of [["USNJQ1", "Garden Qualifier", "NJ"], ["USMDQ1", "Bay Qualifier", "MD"]] as const) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', ?, 'USA', '2026-01-10', '2026-01-10', 't')", [S, code, name, state]);
  }
  for (const [code, team] of [["USNJQ1", 30401], ["USNJQ1", 30402], ["USNJQ1", 30411], ["USMDQ1", 30403]] as const) {
    await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, code, team]);
  }
  await rebuildSearch();
  resetSearchSeason();
  clearAllCaches();
});

describe("one place's teams at another's events", () => {
  it("reads the teams' home and the events' place, either said first", async () => {
    const ctx = await parseContext(NOW);
    for (const q of ["maryland teams at new jersey events", "teams from maryland who played in new jersey", "teams from maryland at events in new jersey", "best maryland teams that competed in new jersey by opr"]) {
      const p = await parseQuery(q, ctx);
      expect([p.place?.name, p.eventPlace?.name, p.leftover], q).toEqual(["Maryland", "New Jersey", []]);
    }
  });
  it("lists the home place's teams that played an event there, never the others", async () => {
    // 30403 is from Maryland but played only in Maryland; 30411 played in New Jersey but is from Delaware.
    for (const q of ["maryland teams at new jersey events", "teams from maryland who played in new jersey", "teams from maryland at events in new jersey"]) expect(await listed(q), q).toEqual([30401, 30402]);
    const a = await full("best maryland teams that competed in new jersey by opr");
    expect([a.stat?.title, a.stat?.scope]).toEqual(["Top 10 teams by OPR from Maryland at New Jersey events · 2025–26", ["Maryland", "At New Jersey events", "2025–26"]]);
  });
  it("says so when none of them played there", async () => {
    const a = await full("delaware teams at maryland events");
    // The season before is tried too, and said so.
    expect(a.stat?.none).toMatch(/^No ranked team from Delaware \(3\+ matches\) played an event held in Maryland in 2025–26\./);
  });
  it("another question of the two places is never answered for one place alone", async () => {
    const a = await full("average opr of maryland teams at new jersey events");
    expect(a.stat?.title ?? "").not.toMatch(/^Top \d+ teams .*in Maryland/);
  });
});
