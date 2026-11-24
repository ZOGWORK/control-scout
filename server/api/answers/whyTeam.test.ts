// A question asking why a team is strong (logged failed searches #2232 and #2233): answered from the team's own season
// numbers against the field (./families/whyTeam.ts), never "Sorry — I can't answer that yet" beside the team.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { failureOf } from "../../searchFailures";
import { readWhy } from "./families/whyTeam";
import { refreshSearchSeason } from "./season";

const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Two teams of a 100-team field: one far ahead in auto, one an average partner strongest in the endgame.
  const rows: [number, string, number, number, number, number, number, number, number, number, number, number][] = [
    // number, name, opr, auto, teleop, endgame, rank, rank auto, rank teleop, rank endgame, wins, losses
    [31301, "Gear Owls", 120.5, 48.2, 60.1, 12.2, 3, 1, 9, 30, 20, 2],
    [31302, "Bolt Foxes", 55.0, 12.0, 30.0, 13.0, 40, 55, 50, 5, 9, 7],
    [2024, "Year Bots", 60.0, 22.0, 30.0, 8.0, 30, 20, 45, 70, 8, 8],
  ];
  for (const [n, name, opr, a, t, e, rk, ra, rt, re, w, l] of rows) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, rank_auto, rank_teleop, rank_endgame, ranked_teams, matches, wins, losses, ties)
      VALUES (2025, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, ?, ?, ?, 0)`, [n, opr, a, t, e, rk, ra, rt, re, w + l, w, l]);
  }
  // Gear Owls the season before, weaker in auto; Iron Hares with no auto numbers stored.
  await run("INSERT INTO team_seasons (season, team) VALUES (2024, 31301)");
  await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, rank_auto, rank_teleop, rank_endgame, ranked_teams, matches, wins, losses, ties)
    VALUES (2024, 31301, 70.0, 20.5, 40.0, 9.5, 20, 30, 15, 25, 80, 12, 7, 5, 0)`);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (31303, 'Iron Hares', 'Town', 'NJ', 'USA')");
  await run("INSERT INTO team_seasons (season, team) VALUES (2025, 31303)");
  await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_teleop, opr_endgame, rank_np, rank_teleop, rank_endgame, ranked_teams, matches, wins, losses, ties)
    VALUES (2025, 31303, 40.0, 30.0, 10.0, 60, 58, 40, 100, 10, 5, 5, 0)`);
  // How dependable: the field's reliability and Bolt Foxes' (Gear Owls has none stored, so its card has no such line).
  const rel = (team: number, idx: number, noShows: number) => run(`INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows,
    recent_near_zero, no_show_rate, dq_rate, near_zero_rate, swing, penalty_ratio, predictability_ratio, idx, computed_at) VALUES (2025, '', ?, 16, ?, 0, 1, 16, 6, 0, 0, 0, 0, 0, 0.3, 1, 1, ?, 'now')`, [team, noShows, idx]);
  await rel(0, 61, 0); await rel(31302, 88, 0);
  await rebuildSearch();
  clearAllCaches();
  await refreshSearchSeason(Date.parse("2026-11-24T12:00:00Z"));
});

describe("reading a why question", () => {
  it("reads the team, and the phase or role asked about", () => {
    expect(readWhy("why is 31301 so good at auto")).toEqual({ core: "31301", topic: "auto" });
    expect(readWhy("why are gear owls so dominant in teleop?")).toEqual({ core: "gear owls", topic: "teleop" });
    expect(readWhy("what makes 31302 such a good partner")).toEqual({ core: "31302", topic: "partner" });
    expect(readWhy("why is 31301 so strong")).toEqual({ core: "31301", topic: null });
  });
  it("leaves a why question that isn't why a team is strong", () => {
    expect(readWhy("why did 31301's rating go down")).toBeNull();
    expect(readWhy("why is 31301 ranked so low")).toBeNull();
    expect(readWhy("31301 auto opr")).toBeNull();
    expect(readWhy("why is 31301 not so good at auto")).toBeNull();
    expect(readWhy("why isn't 31301 good at auto")).toBeNull();
  });
});

describe("the answer", () => {
  it("puts the phase asked about against the field first, then its strongest phase", async () => {
    const a = await ask("why is 31301 so good at auto");
    expect(a.card?.title).toBe("31301 Gear Owls in Auto, against the field");
    expect(a.card?.lines[0].text).toBe("Auto OPR 48.2: #1 of 100 (top 1%)");
    expect(a.card?.lines.map((l) => l.text)).toContain("OPR 120.5: #3 of 100 (top 3%)");
    expect(a.card?.lines.map((l) => l.text)).toContain("Record 20-2-0 (91% won)");
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "31301" });
    expect(a.understood?.label).not.toMatch(/Sorry/);
    expect(failureOf("why is 31301 so good at auto", a)).toBeNull();
  });
  it("answers what makes a team a partner by what it adds to an alliance", async () => {
    const a = await ask("what makes bolt foxes a good alliance partner");
    expect(a.card?.title).toBe("31302 Bolt Foxes as an alliance partner");
    expect(a.card?.lines[0].text).toBe("OPR 55.0: #40 of 100 (top 40%)");
    expect(a.card?.lines[1].text).toBe("Reliability 88 out of 100 (field average 61)");
    expect(a.card?.lines.map((l) => l.text)).toContain("Strongest phase against the field: Endgame (top 5%)");
    expect(failureOf("what makes bolt foxes a good alliance partner", a)).toBeNull();
  });
  it("reads a season said with it, and is nothing for another scope", async () => {
    const a = await ask("why was 31301 so good at auto in 2024-25");
    expect(a.card?.lines[0].text).toBe("Auto OPR 20.5: #30 of 80 (top 38%)");
    expect(a.understood?.label).toMatch(/2024–25/);
    expect((await ask("why was 31301 so good at auto at worlds")).card?.title ?? "").not.toMatch(/against the field/);
    expect((await ask("why was 31301 so good at auto this weekend")).card?.title ?? "").not.toMatch(/against the field/);
  });
  it("reads a team numbered like a year as the team, unless the year is said as a season", async () => {
    expect((await ask("why is 2024 so good at auto")).card?.title).toBe("2024 Year Bots in Auto, against the field");
  });
  it("is nothing when the phase asked about has no numbers, or the team is said not to be strong", async () => {
    expect((await ask("why is 31303 so good at auto")).card?.title ?? "").not.toMatch(/against the field/);
    expect((await ask("why is 31303 so strong")).card?.title).toBe("31303 Iron Hares against the field");
    expect((await ask("why is 31301 not so good at auto")).card?.title ?? "").not.toMatch(/against the field/);
  });
  it("is nothing for a why question about no team", async () => {
    expect((await ask("why is the sky so blue")).card?.title ?? "").not.toMatch(/against the field|alliance partner/);
  });
});
