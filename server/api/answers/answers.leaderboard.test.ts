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
  it("a count's board: the most matches, events or awards, said any way round", () => {
    expect(readLeaderboard("which team has the most awards in NJ")).toMatchObject({ kind: "top", stat: "awards", best: true, region: { key: "USA:NJ" } });
    expect(readLeaderboard("which team in Texas has the most awards")).toMatchObject({ stat: "awards", region: { key: "USA:TX" } });
    expect(readLeaderboard("team that played the most matches this season")).toMatchObject({ stat: "matches", best: true, region: null });
    // Search reads a plural as one ("most match played"): its verb keeps it a count.
    expect(readLeaderboard("which team played the most match")).toMatchObject({ stat: "matches" });
    expect(readLeaderboard("most events attended in new jersey")).toMatchObject({ stat: "events", region: { key: "USA:NJ" } });
    expect(readLeaderboard("top 5 teams by matches played")).toMatchObject({ stat: "matches", n: 5 });
    // "Most" with a stat that isn't a count is the stat's own board; right after "most", a count read as one is a count.
    expect(readLeaderboard("which team has the most vibes")).toBeNull();
    // Greptile on #1040: a day said is a count the season totals can't make.
    expect(readLeaderboard("most awards on April 12 2026 in Ohio")).toBeNull();
    expect(readLeaderboard("most match in nj")).toMatchObject({ stat: "matches", region: { key: "USA:NJ" } });
    expect(readLeaderboard("best match in nj")).toBeNull();
    // Greptile on #1040: "won" keeps its meaning, as typed or read as one.
    expect(readLeaderboard("which team won the most matches in NJ")).toMatchObject({ stat: "wins", region: { key: "USA:NJ" } });
    expect(readLeaderboard("which team won the most match in NJ")).toMatchObject({ stat: "wins" });
    expect(readLeaderboard("team that won the most events")).toBeNull();
    expect(readLeaderboard("which team won the most awards")).toMatchObject({ stat: "awards" });
    // Greptile on #1040: counted at some events only is a count the board can't make.
    expect(readLeaderboard("which team played the most matches at New Jersey events")).toBeNull();
    expect(readLeaderboard("most awards at out of state events")).toBeNull();
  });
});

describe("the lists", () => {
  it("a count's board: the team with the most matches played, or awards won, in a state", async () => {
    const m = await searchAnswer("which team played the most matches in NJ", { limit: 25, full: true });
    expect(m.stat).toMatchObject({ family: "leaderboard", title: "Team in New Jersey with the most matches played · 2025–26", headline: { value: "23268 Ultraviolet" } });
    // Never the highest-scoring matches.
    expect(m.intent?.kind).toBe("stat-leaderboard-top");
    // Greptile on #1040: with no verb, as typed ("matches", "events"), it's still the count's board.
    for (const [q, title] of [["which team has the most matches in NJ", "Team in New Jersey with the most matches played · 2025–26"], ["most events in New Jersey", "Team in New Jersey with the most events played · 2025–26"]]) {
      expect((await searchAnswer(q, { limit: 25, full: true })).stat?.title, q).toBe(title);
    }
    for (const [code, team] of [["NJQ1", 6980], ["NJQ1", 4215], ["NJQ2", 6980]] as const) await run("INSERT INTO awards (season, code, type, placement, team) VALUES (2025, ?, 'Think', ?, ?)", [code, team === 4215 ? 2 : 1, team]);
    const a = await searchAnswer("most awards in New Jersey", { limit: 25, full: true });
    expect(a.stat).toMatchObject({ title: "Team in New Jersey with the most awards won · 2025–26", headline: { value: "6980 Bad Wolf" } });
    const t = a.stat!.blocks[0];
    if (t.kind !== "leaderboard") throw new Error(t.kind);
    expect(t.rows.slice(0, 2).map((r) => [r.team.label, r.display])).toEqual([["6980 Bad Wolf", "2"], ["4215 Hypnotic Robotics", "1"]]);
  });
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

describe("a climb in rank from one season to the next", () => {
  it("reads the ranks said, the lower first", () => {
    expect(readLeaderboard("teams who jumped from #800 to the top 10 in a single season")).toMatchObject({ kind: "improved", climb: { from: 800, to: 10 }, region: null });
    expect(readLeaderboard("which nj teams rose from rank 2000 or worse to the top 100")).toMatchObject({ kind: "improved", climb: { from: 2000, to: 100 }, region: { key: "USA:NJ" } });
    // A fall is no climb.
    expect(readLeaderboard("teams that went from rank 10 to rank 100")?.climb).toBeUndefined();
  });
  it("keeps only the teams that made the climb in worldwide OPR rank", async () => {
    // 23268: #6000 → #30. 6980 (#3000 → #2700) and 4215 (#100 → #600) didn't make it.
    const a = await searchAnswer("which teams climbed from rank 5000 to the top 50 in 2025-26", { limit: 25, full: true });
    expect(a.stat).toMatchObject({ intent: "most-improved", title: "Teams worldwide that climbed from OPR rank 5,000+ to the top 50 · 2025–26", headline: { value: "23268 Ultraviolet" } });
    const t = a.stat!.blocks[0];
    if (t.kind !== "table") throw new Error(t.kind);
    expect(t.rows.map((r) => r.cells.team)).toEqual(["23268 Ultraviolet"]);
    const none = await searchAnswer("which nj teams climbed from rank 7000 to the top 50 in 2025-26", { limit: 25, full: true });
    expect(none.stat?.none).toBe("No team in New Jersey climbed from OPR rank 7,000+ to the top 50 from 2024–25 to 2025–26.");
  });
});
