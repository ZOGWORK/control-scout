// Leaderboard answers (server/api/answers/families/leaderboard.ts) on a small fixture database: the top N teams by a
// stored season number in one state, rookies, the most improved by OPR standing, and a city's teams, each with the
// link to the same list on the Teams page. A team under 3 matches, or in another state, is never ranked.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readLeaderboard } from "./read";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, city, state, rookie year, [2024: opr, rank], [2025: opr, auto, wins, losses, matches, rank]
  const teams: [number, string, string, string, number, [number, number] | null, [number, number, number, number, number, number]][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", 2010, [90, 100], [101.6, 28, 26, 6, 32, 600]],
    [6980, "Bad Wolf", "Oradell", "NJ", 2013, [40, 3000], [46.9, 13, 13, 11, 24, 2700]],
    [31814, "Quantum Core", "Hillsborough", "NJ", 2025, null, [117.2, 30, 20, 4, 24, 400]],
    [23268, "Ultraviolet", "Hillsborough", "NJ", 2017, [80, 6000], [157.9, 40, 33, 17, 50, 30]],
    [9999, "Two Matches", "Trenton", "NJ", 2025, null, [300, 90, 2, 0, 2, 1]],
    [19564, "The Marvels of MAS", "Richardson", "TX", 2021, [100, 10], [200, 50, 70, 20, 90, 2]],
  ];
  for (const [n, name, city, state, rookie, s24, s25] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, ?, ?, 'USA', ?)", [n, name, city, state, rookie]);
    if (s24) await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, matches, wins, losses, ties) VALUES (2024, ?, ?, ?, 7600, 20, 10, 10, 0)", [n, s24[0], s24[1]]);
    const [opr, auto, w, l, m, rank] = s25;
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, wins, losses, ties, matches, rank_np, ranked_teams, rating_np, rating_matches) VALUES (2025, ?, ?, ?, ?, ?, 0, ?, ?, 8375, ?, ?)", [n, opr, auto, w, l, m, rank, opr, m]);
  }
  await rebuildSearch();
});

describe("what's read", () => {
  it("a stat, how many, a place, a season; a city only when it isn't a region", () => {
    expect(readLeaderboard("Top 10 teams by OPR in NJ")).toMatchObject({ kind: "top", stat: "opr", n: 10, region: { key: "USA:NJ" } });
    expect(readLeaderboard("Top teams by auto OPR in New Jersey")).toMatchObject({ kind: "top", stat: "auto", n: 10 });
    expect(readLeaderboard("top 5 win rate teams in nj 2024-25")).toMatchObject({ kind: "top", stat: "win-rate", n: 5, season: 2024 });
    expect(readLeaderboard("Best rookie team in New Jersey")).toMatchObject({ kind: "rookie", stat: "opr" });
    expect(readLeaderboard("Most improved team in New Jersey")).toMatchObject({ kind: "improved" });
    expect(readLeaderboard("Teams in Oradell")).toMatchObject({ kind: "city", city: "oradell" });
    expect(readLeaderboard("top teams by overall OPR in NJ")).toMatchObject({ kind: "top", stat: "opr", region: { key: "USA:NJ" } });
    expect(readLeaderboard("top 10 teams in NJ")).toMatchObject({ kind: "top", stat: "rating", n: 10, region: { key: "USA:NJ" } });
    expect(readLeaderboard("top teams in NJ")).toBeNull();
    expect(readLeaderboard("teams in new jersey")).toBeNull();
    expect(readLeaderboard("top teams by vibes in nj")).toBeNull();
    expect(readLeaderboard("top 10 teams by opr in narnia")).toBeNull();
  });
});

describe("the lists", () => {
  it("top N by OPR in a state: ranked rows, 3 matches or more, the Teams page link", async () => {
    const a = await searchAnswer("Top 10 teams by OPR in NJ", { limit: 25 });
    expect(a.stat).toMatchObject({ family: "leaderboard", title: "Top 10 teams by OPR in New Jersey · 2025–26", headline: { value: "23268 Ultraviolet" } });
    // The card: rank, team, location, W-L-T, OPR, the bar scaled to #1 with the OPR's phase split, and the note.
    const t = a.stat!.blocks[0];
    if (t.kind !== "leaderboard") throw new Error(t.kind);
    expect(t.rows.map((r) => r.team.label)).toEqual(["23268 Ultraviolet", "31814 Quantum Core", "4215 Hypnotic Robotics", "6980 Bad Wolf"]);
    expect(t.rows[0]).toMatchObject({ rank: 1, location: expect.stringContaining("NJ"), record: expect.stringMatching(/^\d+-\d+-\d+$/), parts: expect.any(Object) });
    expect(t.note).toBe("2025–26 · 4 ranked teams in New Jersey · by OPR");
    expect(t.more).toEqual({ label: "View more detail on the Teams page (qualification matches)", href: "/teams?view=season&season=2025&country=US&state=NJ&sort=totalPointsNpOpr&filter=and-qualMatchesPlayed.gte.3-" });
    expect(a.pages[0]).toMatchObject({ href: t.more!.href });
  });
  it("win rate, rookies, the most improved by standing", async () => {
    const w = await searchAnswer("Top teams by win rate in New Jersey", { limit: 25 });
    expect(w.stat!.headline).toMatchObject({ value: "31814 Quantum Core", label: "Win rate 83%, 20-4-0 · Hillsborough" });
    // The Teams table counts qualification matches only: no link to a list that would differ.
    expect(w.stat!.blocks[0]).not.toHaveProperty("more");
    const r = await searchAnswer("Best rookie team in New Jersey", { limit: 25 });
    expect(r.stat!.headline).toMatchObject({ value: "31814 Quantum Core" });
    const rb = r.stat!.blocks[0];
    expect(rb.kind === "leaderboard" && rb.more!.href).toContain("filter=and-qualMatchesPlayed.gte.3+rookieYear.eq.2025-");
    const i = await searchAnswer("Most improved team in New Jersey", { limit: 25 });
    expect(i.stat!.headline).toMatchObject({ value: "23268 Ultraviolet", sub: "OPR rank #6000 of 7600 → #30 of 8375" });
    // No Teams page list asks the same question (a climb from last season): no link.
    expect(i.stat!.more).toBeUndefined();
  });
  it("a rookie rating list has no Rankings link (Rankings can't keep the rookie filter)", async () => {
    const r = await searchAnswer("best rookie team by rating in New Jersey", { limit: 25 });
    const rb = r.stat?.blocks[0];
    expect(rb?.kind).toBe("leaderboard");
    expect(rb).not.toHaveProperty("more");
  });
  it("the search box gets a link to the answer page, never an empty answer", async () => {
    const a = await searchAnswer("Best rookie team in New Jersey", { limit: 8 });
    expect(a.stat).toBeUndefined();
    expect(a.pages[0]).toMatchObject({ href: "/search?q=Best%20rookie%20team%20in%20New%20Jersey" });
  });
  it("a city's teams; a city no team lists is left to search", async () => {
    const c = await searchAnswer("Teams in Oradell", { limit: 25 });
    expect(c.understood?.label).toBe("Teams in Oradell");
    expect(c.stat!.headline).toMatchObject({ value: "2 teams" });
    expect((await searchAnswer("teams in atlantis", { limit: 25 })).stat).toBeUndefined();
  });
});
