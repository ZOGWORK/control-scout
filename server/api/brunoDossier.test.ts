// What Bruno knows about each team a Discord message names (server/api/brunoDossier.ts), on a database: the audit's
// Q43 (19666 had no line at all), its drifting numbers (0.15 read as 0.1 here and 0.2 on the card) and its unlabelled
// seasons (101.6 "at the New Jersey Championship", beside 2026–27 numbers).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { CURRENT_SEASON } from "../data/seasons";
import { DOSSIER_LINE, namedTeams, opr, seasonNowLine, splitLine, teamDossier } from "./brunoDossier";

const NOW = CURRENT_SEASON;
const LAST = CURRENT_SEASON - 1;
const label = (s: number) => `${s}–${String((s + 1) % 100).padStart(2, "0")}`;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (3, 'Three', 'X', 'NJ', 'USA', 2005), (5, 'Five', 'X', 'NJ', 'USA', 2005), (26, 'Twenty Six', 'X', 'NJ', 'USA', 2005), (50, 'Fifty', 'X', 'NJ', 'USA', 2005), (100, 'Hundred', 'X', 'NJ', 'USA', 2005), (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA', 2010), (6980, 'Bad Wolf', 'Oradell', 'NJ', 'USA', 2013), (7149, 'Old Timers', 'Edison', 'NJ', 'USA', 2009)");
  const season = (s: number, t: number, np: number, a: number, te: number, e: number, w: number, l: number) =>
    run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, events, matches, wins, losses, ties) VALUES (?, ?, ?, ?, ?, ?, 10, 8308, 1, ?, ?, ?, 0)", [s, t, np, a, te, e, w + l, w, l]);
  await season(NOW, 4215, 16.02, 1.35, 14.68, 5.55, 2, 3);
  await season(LAST, 4215, 101.64, 28.28, 73.37, 6.67, 26, 6);
  await season(NOW, 6980, 11.26, 0.15, 11.11, 4.89, 2, 4);
  // 7149 has not played this season: its numbers must never pass as this season's.
  await season(LAST, 7149, 115.26, 36.45, 83.98, 7.24, 39, 4);
  await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'NEM3', 'Northeast League Meet', 'LeagueMeet', ?, ?, 'first'), (?, 'NJCMP', 'New Jersey Championship', 'Championship', ?, ?, 'first'), (?, 'WCMP', 'FIRST Championship - Edison Division', 'FIRSTChampionship', ?, ?, 'first')",
    [NOW, `${NOW}-11-07`, `${NOW}-11-07`, LAST, `${NOW}-03-15`, `${NOW}-03-15`, LAST, `${NOW}-04-17`, `${NOW}-04-19`]);
  await run("UPDATE events SET division_code = 'FTCCMP1' WHERE code = 'WCMP'");
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches, wins, losses, ties) VALUES (?, 'NEM3', 4215, 16.02, 1.35, 14.68, 5.55, 6, 2, 3, 1), (?, 'NJCMP', 4215, 101.64, 28.28, 73.37, 5.5, 5, 4, 1, 0)", [NOW, LAST]);
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, 'NEM3', 4215, 18), (?, 'NEM3', 6980, 34), (?, 'NJCMP', 4215, 6), (?, 'WCMP', 4215, 20)", [NOW, NOW, LAST, LAST]);
  await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, blue_total, source) VALUES (?, 'NEM3', 'qual', 0, 6, 'Q6', 1, 75, 19, 'first'), (?, 'NEM3', 'qual', 0, 5, 'Q5', 1, 20, 61, 'first')", [NOW, NOW]);
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, 'NEM3', 'qual', 0, 6, 4215, 'red'), (?, 'NEM3', 'qual', 0, 6, 23314, 'red'), (?, 'NEM3', 'qual', 0, 6, 18760, 'blue'), (?, 'NEM3', 'qual', 0, 5, 4215, 'blue'), (?, 'NEM3', 'qual', 0, 5, 6980, 'blue'), (?, 'NEM3', 'qual', 0, 5, 10243, 'red')", [NOW, NOW, NOW, NOW, NOW, NOW]);
});

describe("one number per fact", () => {
  it("rounds half up, as every card does", () => {
    expect(opr(0.15)).toBe("0.2");
    expect(opr(5.55)).toBe("5.6");
    expect(opr(16.02)).toBe("16.0");
    expect(opr(-0.62)).toBe("-0.6");
    expect(opr(null)).toBe("–");
  });
});

describe("a team's block", () => {
  it("labels this season and every earlier one, with the site's rounding", async () => {
    const d = (await teamDossier(4215, Date.parse(`${NOW}-11-27T00:00:00Z`))).join("\n");
    expect(d).toContain(`Team 4215 Hypnotic Robotics (Oradell, NJ, USA; rookie year 2010). In ${label(NOW)} (this season): 5 matches at 1 event, record 2-3-0, season OPR 16.0 (Auto 1.4, TeleOp 14.7, Endgame 5.6)`);
    expect(d).toContain(`4215 in earlier seasons: ${label(LAST)} (last season): 32 matches at 1 event, record 26-6-0, season OPR 101.6 (Auto 28.3`);
    // The trend: each event in order, its own numbers, labelled with its season.
    expect(d).toContain(`4215's events in ${label(NOW)} (this season), in order`);
    expect(d).toContain(`4215's events in ${label(LAST)} (last season), in order (event OPR, record there, rank there): New Jersey Championship (${NOW}-03-15): OPR 101.6`);
    // Every match at its latest event, with partners and opponents.
    expect(d).toContain(`4215's matches at its latest event, Northeast League Meet, in ${label(NOW)} (this season) (its alliance's score first): Q5 won 61-20 with 6980 vs 10243; Q6 won 75-19 with 23314 vs 18760.`);
    expect(d).toContain(`4215 at Worlds (the FIRST Championship): ${label(LAST)}, Edison Division.`);
    expect(d).toContain("4215 has never been featured on Behind the Bot");
    expect(d).toContain(`4215 has no upcoming ${label(NOW)} event entered yet.`);
  });

  it("says a team has played no matches this season, so last season's numbers are never read as this season's", async () => {
    const d = await teamDossier(7149);
    expect(d[0]).toContain(`In ${label(NOW)} (this season): no matches played yet — every number for 7149 below is from an earlier season and says which.`);
    expect(d.join("\n")).toContain(`${label(LAST)} (last season): 43 matches`);
    expect(d.join("\n")).toContain("7149 has not played at Worlds");
  });

  it("gives 6980's auto as the card does (0.15 is 0.2), and nothing for a number that is no team", async () => {
    expect((await teamDossier(6980))[0]).toContain("Auto 0.2");
    expect(await teamDossier(99999)).toEqual([]);
  });

  it("never sends a line Control Point would refuse: a long list continues on another line, never cut", () => {
    const lines = splitLine("4215's matches", Array.from({ length: 40 }, (_, i) => `Q${i} won 100-50 with 1234 vs 5678, 9012`));
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((l) => l.length <= DOSSIER_LINE + 1)).toBe(true);
    expect(lines.join(" ")).toContain("Q39 won");
    expect(lines[1]).toMatch(/^4215's matches \(cont\.\): Q\d+/);
  });
});

describe("which teams", () => {
  it("takes every team a message names, in order, never a year or an unknown number", async () => {
    expect(await namedTeams("who has the better auto opr, 4215 or 6980 in 2024, and 99999")).toEqual([4215, 6980]);
    expect(await namedTeams("compare 6980, 4215 and 7149 by auto")).toEqual([6980, 4215, 7149]);
    expect(await namedTeams("what is 101.6")).toEqual([]);
    // Counts and seasons are never teams (Loopy on #2391; the audit's Q73 read "top 50" as team 50)...
    expect(await namedTeams("auto and endgame for 4215, 6980 and 7149 in 2024-25 and 2025–26")).toEqual([4215, 6980, 7149]);
    expect(await namedTeams("top 50 teams in nj, compare 4215 and 6980 in the last 3 matches, top 5")).toEqual([4215, 6980]);
    expect(await namedTeams("who scored over 100 points, and 100 pts in auto")).toEqual([]);
    expect(await namedTeams("is 4215 better than 6980 over 7149")).toEqual([4215, 6980, 7149]);
    // A team before a word a team has is the team (Loopy on #2391); an amount or a place is not.
    expect(await namedTeams("4215 wins vs 6980, 7149 matches this season, how many events has 4215 played")).toEqual([4215, 6980, 7149]);
    expect(await namedTeams("who was 100th, and who had 100% or 100 pts")).toEqual([]);
    // ...but a small team number said as one is.
    expect(await namedTeams("how did team 5 and #50 do vs 4215")).toEqual([5, 50, 4215]);
  });

  it("says which season 'this season' is", () => {
    expect(seasonNowLine()).toContain(`"this season", "now" and "rn" mean ${label(NOW)}`);
  });
});
