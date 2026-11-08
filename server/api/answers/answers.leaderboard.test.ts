// Leaderboard answers (server/api/answers/families/leaderboard.ts) on a small fixture database: the top N teams by a
// stored season number in one state, rookies, the most improved by OPR standing, and a city's teams, each with the
// link to the same list on the Teams page. A team under 3 matches, or in another state, is never ranked.
import { beforeAll, describe, expect, it, vi } from "vitest";
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
    // A country is never a city, even one a team lists as its home city.
    for (const q of ["teams in romania", "best team in romania", "teams from canada"]) expect(readLeaderboard(q)?.kind ?? "", q).not.toMatch(/^city/);
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
  it("a count's board with the place before the team word, whatever the verb", () => {
    expect(readLeaderboard("which texas teams have won the most awards")).toMatchObject({ stat: "awards", region: { key: "USA:TX" } });
    expect(readLeaderboard("ohio teams with the most events")).toMatchObject({ stat: "events", region: { key: "USA:OH" } });
    expect(readLeaderboard("the georgia team with most matches")).toMatchObject({ stat: "matches", region: { key: "USA:GA" } });
    expect(readLeaderboard("which new jersey teams have played the most matches")).toMatchObject({ stat: "matches", region: { key: "USA:NJ" } });
    expect(readLeaderboard("what michigan teams attended the most events")).toMatchObject({ stat: "events", region: { key: "USA:MI" } });
    expect(readLeaderboard("which texas teams won the most matches")).toMatchObject({ stat: "wins", region: { key: "USA:TX" } });
    // Only a place goes before the team word, and only one place is said.
    expect(readLeaderboard("which rookie teams have the most awards")).toBeNull();
    expect(readLeaderboard("texas teams with the most awards in ohio")).toBeNull();
    // Greptile on #1161: "FTC teams" is the team word, with or without a place before or after it.
    expect(readLeaderboard("which ftc teams have the most awards in ohio")).toMatchObject({ stat: "awards", region: { key: "USA:OH" } });
    expect(readLeaderboard("which ftc teams have the most awards")).toMatchObject({ stat: "awards", region: null });
    expect(readLeaderboard("which georgia ftc teams have played the most matches")).toMatchObject({ stat: "matches", region: { key: "USA:GA" } });
  });
});

describe("the lists", () => {
  it("a count's board: the team with the most matches played, or awards won, in a state", async () => {
    const m = await searchAnswer("which team played the most matches in NJ", { limit: 25, full: true });
    expect(m.stat).toMatchObject({ family: "leaderboard", title: "Team in New Jersey with the most matches played · 2025–26", headline: { value: "23268 Ultraviolet" } });
    // Never the highest-scoring matches.
    expect(m.intent?.kind).toBe("stat-leaderboard-top");
    // Greptile on #1040: with no verb, as typed ("matches", "events"), it's still the count's board.
    for (const [q, title] of [["which team has the most matches in NJ", "Team in New Jersey with the most matches played · 2025–26"], ["most events in New Jersey", "Team in New Jersey with the most events played · 2025–26"],
      // The place before the team word: the count's board, never the prediction rating's.
      ["which New Jersey teams have attended the most events", "Team in New Jersey with the most events played · 2025–26"], ["NJ team with most matches", "Team in New Jersey with the most matches played · 2025–26"]]) {
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
  // Failed search #1012, in its own words: rookies from the bottom, a stat said before "rookies" or after the place.
  it("the lowest rookies, the stat said anywhere", async () => {
    expect(readLeaderboard("lowest opr rookies in new jersey")).toMatchObject({ kind: "rookie", stat: "opr", asc: true, region: { key: "USA:NJ" } });
    expect(readLeaderboard("worst rookie teams in texas by auto opr")).toMatchObject({ kind: "rookie", stat: "auto", asc: true, region: { key: "USA:TX" } });
    expect(readLeaderboard("top 5 rookies in nj")).toMatchObject({ kind: "rookie", stat: "opr", n: 5 });
    expect(readLeaderboard("top 5 rookies in nj")).not.toHaveProperty("asc");
    // Two stats said is no one board.
    expect(readLeaderboard("lowest opr rookies in nj by auto")).toBeNull();
    // A second ranked rookie with a lower OPR (Greptile on #1085): the lowest leads, each ranked from the top.
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (31999, 'Low Rookie', 'Trenton', 'NJ', 'USA', 2025)");
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, wins, losses, ties, matches, rank_np, ranked_teams, rating_np, rating_matches) VALUES (2025, 31999, 12.5, 2, 1, 9, 0, 10, 8000, 8375, 12.5, 10)");
    try {
      const r = await searchAnswer("lowest opr rookies in new jersey", { limit: 25 });
      expect(r.stat).toMatchObject({ title: "Lowest rookie teams in New Jersey by OPR · 2025–26", headline: { value: "31999 Low Rookie", sub: "Lowest of 2 ranked in New Jersey" } });
      const rb = r.stat!.blocks[0];
      if (rb.kind !== "leaderboard") throw new Error(rb.kind);
      expect(rb.rows.map((x) => [x.rank, x.team.label, x.display])).toEqual([[2, "31999 Low Rookie", "12.5"], [1, "31814 Quantum Core", "117.2"]]);
      expect(rb.more!.href).toContain("dir=asc");
    } finally {
      await run("DELETE FROM team_season_stats WHERE team = 31999");
      await run("DELETE FROM teams WHERE number = 31999");
    }
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

// "Top teams this week" (failed-search #1174): the teams that played at an event held in the window, by OPR there.
describe("the top teams in a date window", () => {
  it("ranks the window's teams by their OPR at its events, a place keeping its own, and says when none played", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-11-12T12:00:00Z"));
    try {
      await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USNJWK', 'Week Meet', 'LeagueMeet', 'Oradell', 'NJ', 'USA', '2025-11-10', '2025-11-10', 't'), (2025, 'USTXWK', 'Texas Week Qualifier', 'Qualifier', 'Richardson', 'TX', 'USA', '2025-11-11', '2025-11-11', 't'), (2025, 'USNJOLD', 'Old Meet', 'LeagueMeet', 'Oradell', 'NJ', 'USA', '2025-10-01', '2025-10-01', 't')");
      await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'USNJWK', 4215, 88, 5), (2025, 'USNJWK', 6980, 41, 5), (2025, 'USTXWK', 19564, 120, 5), (2025, 'USNJOLD', 23268, 300, 5)");
      const world = await searchAnswer("top teams this week", { limit: 25, full: true });
      expect(world.stat?.intent).toBe("window-best");
      expect(world.stat?.headline?.value).toBe("19564 The Marvels of MAS");
      const board = world.stat!.blocks.find((b) => b.kind === "leaderboard") as { rows: { team: { label: string } }[] };
      // An event outside the window never counts: 23268's 300 was a month before.
      expect(board.rows.map((r) => r.team.label)).toEqual(["19564 The Marvels of MAS", "4215 Hypnotic Robotics", "6980 Bad Wolf"]);
      const nj = await searchAnswer("best teams in nj this week", { limit: 25, full: true });
      expect(nj.stat?.headline?.value).toBe("4215 Hypnotic Robotics");
      expect(nj.stat?.title).toBe("Top teams from New Jersey this week, by OPR at their events");
      const none = await searchAnswer("top teams next week", { limit: 25, full: true });
      expect(none.stat?.none).toMatch(/^No team has an OPR from an event held next week yet/);
      // With no time said, the season's board as before.
      expect((await searchAnswer("top teams in nj", { limit: 25, full: true })).stat?.intent).not.toBe("window-best");
    } finally {
      vi.useRealTimers();
    }
  });
});
