// Leaderboard answers (server/api/answers/families/leaderboard.ts) on a small fixture database: the top N teams by a
// stored season number in one state, rookies, the most improved by OPR standing, and a city's teams, each with the
// link to the same list on the Teams page. A team under 3 matches, or in another state, is never ranked.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
  it("a town with its state after it is that state's town, never the other state's of the same name (failed-search #899)", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (41001, 'Prairie Bots', 'Springfield', 'IL', 'USA'), (41002, 'Ozark Gears', 'Springfield', 'MO', 'USA'), (41003, 'Ozark Two', 'Springfield', 'MO', 'USA')");
    const il = await searchAnswer("teams in springfield il", { limit: 25 });
    expect(il.stat?.headline).toMatchObject({ value: "1 team", label: "in Springfield, IL" });
    expect(il.stat?.title).toContain("Springfield, IL");
    const mo = await searchAnswer("teams in Springfield Missouri", { limit: 25 });
    expect(mo.stat?.headline).toMatchObject({ value: "2 teams" });
    expect(mo.stat?.title).toContain("Springfield, MO");
    // The town alone is every Springfield; one in a state no team lists it in is left to search.
    expect((await searchAnswer("teams in springfield", { limit: 25 })).stat?.headline).toMatchObject({ value: "3 teams" });
    expect((await searchAnswer("teams in springfield texas", { limit: 25 })).stat).toBeUndefined();
    // After a town the directory has, a code that's also a word is the state; a country is said by its name, never a
    // county code (the cities board links here this way).
    expect((await searchAnswer("teams in springfield mo", { limit: 25 })).stat?.headline).toMatchObject({ value: "2 teams", label: "in Springfield, MO" });
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (41004, 'Carpathian Bots', 'Bucharest', 'B', 'Romania')");
    const ro = await searchAnswer("teams in Bucharest Romania", { limit: 25 });
    expect(ro.stat?.headline).toMatchObject({ value: "1 team", label: "in Bucharest, Romania" });
    expect(ro.stat?.title).toBe("Teams in Bucharest, Romania");
  });
  it("a school's teams, by the school FIRST lists, however the count is asked (failed-search #965)", async () => {
    await run("UPDATE teams SET school = 'River Dell Regional High School' WHERE number IN (4215, 6980)");
    expect(readLeaderboard("how many teams at River Dell Regional High School")).toMatchObject({ kind: "city", school: true, city: "River Dell Regional High School" });
    for (const q of ["how many teams at River Dell Regional High School", "teams from river dell regional high school"]) {
      const a = await searchAnswer(q, { limit: 25 });
      expect(a.understood?.label, q).toBe("Teams at River Dell Regional High School");
      expect(a.stat?.headline, q).toMatchObject({ value: "2 teams", label: "at River Dell Regional High School" });
    }
    // A school's own punctuation is kept, so its name as FIRST lists it is found.
    await run("UPDATE teams SET school = 'St. Patrick''s High School' WHERE number = 31814");
    expect(readLeaderboard("how many teams at St. Patrick's High School?")).toMatchObject({ school: true, city: "St. Patrick's High School" });
    expect((await searchAnswer("how many teams at St. Patrick's High School", { limit: 25 })).stat?.headline).toMatchObject({ value: "1 team" });
    // A school no team lists is left to search.
    expect((await searchAnswer("teams at atlantis high school", { limit: 25 })).stat).toBeUndefined();
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
      // Its events leave no rows behind for the boards below.
      await run("DELETE FROM team_event_stats WHERE code IN ('USNJWK', 'USTXWK', 'USNJOLD')"); await run("DELETE FROM events WHERE code IN ('USNJWK', 'USTXWK', 'USNJOLD')");
    }
  });
});

describe("OPR gained within a season", () => {
  it("reads the gain, said any way, apart from the climb in standing", () => {
    expect(readLeaderboard("top 3 most improved teams in texas by opr growth")).toMatchObject({ kind: "gain", stat: "opr", n: 3, region: { key: "USA:TX" } });
    expect(readLeaderboard("which texas team raised its opr the most from its first to its last event")).toMatchObject({ kind: "gain", n: 10, region: { key: "USA:TX" } });
    // Counted at some events only, or on a day: no gain board (it counts every event of the season).
    expect(readLeaderboard("which teams gained the most opr at new jersey events")?.kind).not.toBe("gain");
    expect(readLeaderboard("which teams gained the most opr out of state")?.kind).not.toBe("gain");
    expect(readLeaderboard("what teams in nj gained the most opr across the season")).toMatchObject({ kind: "gain", region: { key: "USA:NJ" } });
    expect(readLeaderboard("most improved teams in texas")).toMatchObject({ kind: "improved" });
  });
  it("ranks the first event's OPR to the last's, 2+ events only, in the place", async () => {
    const ev = (code: string, start: string) => run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, ?, ?, 'Qualifier', 'Edison', 'NJ', 'USA', ?, ?, 't')", [code, `Meet ${code}`, start, start]);
    await ev("G1", "2025-11-01"); await ev("G2", "2026-01-10"); await ev("G3", "2026-02-01");
    // 6980: 20 → 70; 4215: 80 → 110 (its middle event never counts); 23268 one event only; 19564 in Texas.
    for (const [code, team, opr] of [["G1", 4215, 80], ["G2", 4215, 140], ["G3", 4215, 110], ["G1", 6980, 20], ["G2", 6980, 70], ["G2", 23268, 150], ["G1", 19564, 10], ["G3", 19564, 200]] as const) {
      await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, ?, ?, ?, 5)", [code, team, opr]);
    }
    try {
      const b = await searchAnswer("most improved teams in new jersey in 2025-26 by opr gain", { limit: 25, full: true });
      expect(b.stat).toMatchObject({ intent: "opr-gain", title: "Most OPR gained in New Jersey between first and last event · 2025–26", headline: { value: "6980 Bad Wolf", label: "+50.0 OPR: 20.0 → 70.0 over 2 events · Oradell" } });
      const t = b.stat!.blocks[0];
      if (t.kind !== "table") throw new Error(t.kind);
      expect(t.rows.map((r) => [r.cells.team, r.cells.gain])).toEqual([["6980 Bad Wolf", "+50.0"], ["4215 Hypnotic Robotics", "+30.0"]]);
      // Asked of "teams" or "team" through search, the same whole board.
      for (const q of ["what teams in nj gained the most opr across the season in 2025-26", "which nj team improved its opr the most in 2025-26"]) {
        const c = await searchAnswer(q, { limit: 25, full: true });
        expect(c.stat?.title, q).toBe("Most OPR gained in New Jersey between first and last event · 2025–26");
        expect((c.stat!.blocks[0] as { rows: unknown[] }).rows, q).toHaveLength(2);
      }
    } finally {
      await run("DELETE FROM team_event_stats WHERE code IN ('G1', 'G2', 'G3')"); await run("DELETE FROM events WHERE code IN ('G1', 'G2', 'G3')");
    }
  });
});

describe("steady boards", () => {
  it("reads a stable OPR and strength in every phase, never at some events only", () => {
    expect(readLeaderboard("what teams in texas have the steadiest opr")).toMatchObject({ kind: "steady", region: { key: "USA:TX" } });
    expect(readLeaderboard("which team has the least volatile opr with the fewest ups and downs")).toMatchObject({ kind: "steady", region: null });
    expect(readLeaderboard("which texas teams are the best balanced across every phase")).toMatchObject({ kind: "phases", region: { key: "USA:TX" } });
    expect(readLeaderboard("which team has the most stable opr at new jersey events")?.kind).not.toBe("steady");
    // A place said last.
    expect(readLeaderboard("which team has the steadiest opr in texas")).toMatchObject({ kind: "steady", region: { key: "USA:TX" } });
    expect(readLeaderboard("which team is the most balanced across all phases in texas")).toMatchObject({ kind: "phases", region: { key: "USA:TX" } });
    // Two places said: none.
    expect(readLeaderboard("which nj team has the steadiest opr in texas")?.kind).not.toBe("steady");
    // Greptile on #1124: "FTC team" is the team word, not a place.
    expect(readLeaderboard("what ftc team has the steadiest opr")).toMatchObject({ kind: "steady", region: null });
    // Greptile on #1124: "worldwide" adds nothing.
    expect(readLeaderboard("which team has the least volatile opr worldwide")).toMatchObject({ kind: "steady", region: null });
    expect(readLeaderboard("which teams are the most balanced across all phases globally")).toMatchObject({ kind: "phases", region: null });
    expect(readLeaderboard("which ohio ftc teams are the best balanced across every phase")).toMatchObject({ kind: "phases", region: { key: "USA:OH" } });
  });
  it("ranks the smallest swing in event OPR, 3+ events", async () => {
    const ev = (code: string, start: string) => run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, ?, ?, 'Qualifier', 'Edison', 'NJ', 'USA', ?, ?, 't')", [code, `Meet ${code}`, start, start]);
    await ev("H1", "2025-11-01"); await ev("H2", "2026-01-10"); await ev("H3", "2026-02-01");
    // 4215: 98–102 (±2%); 6980: 20–60 (±41%); 23268: two events only.
    for (const [code, team, opr] of [["H1", 4215, 100], ["H2", 4215, 102], ["H3", 4215, 98], ["H1", 6980, 20], ["H2", 6980, 60], ["H3", 6980, 40], ["H1", 23268, 150], ["H2", 23268, 160]] as const) {
      await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, ?, ?, ?, 5)", [code, team, opr]);
    }
    try {
      const a = await searchAnswer("which new jersey team has the most consistent opr in 2025-26", { limit: 25, full: true });
      expect(a.stat).toMatchObject({ intent: "steady-opr", title: "Most stable OPR in New Jersey: the fewest ups and downs · 2025–26", headline: { value: "4215 Hypnotic Robotics", label: "OPR 100.0 on average, ±2% over 3 events · Oradell" } });
      const t = a.stat!.blocks[0];
      if (t.kind !== "table") throw new Error(t.kind);
      expect(t.rows.map((r) => [r.cells.team, r.cells.swing])).toEqual([["4215 Hypnotic Robotics", "±2%"], ["6980 Bad Wolf", "±41%"]]);
    } finally {
      await run("DELETE FROM team_event_stats WHERE code IN ('H1', 'H2', 'H3')"); await run("DELETE FROM events WHERE code IN ('H1', 'H2', 'H3')");
    }
  });
  it("ranks by the weakest phase, so one strong phase alone doesn't lead", async () => {
    // 2025's teleop includes endgame: auto and teleop are the phases. 23268 is #5 in auto but #900 in teleop.
    for (const [team, ra, rt] of [[4215, 50, 60], [23268, 5, 900], [31814, 100, 120]] as const) {
      await run("UPDATE team_season_stats SET rank_auto = ?, rank_teleop = ? WHERE season = 2025 AND team = ?", [ra, rt, team]);
    }
    try {
      const a = await searchAnswer("which nj team is the most well rounded in all phases in 2025-26", { limit: 25, full: true });
      expect(a.stat).toMatchObject({ intent: "every-phase", headline: { value: "4215 Hypnotic Robotics", label: "Weakest phase #60 worldwide · Oradell" } });
      const t = a.stat!.blocks[0];
      if (t.kind !== "table") throw new Error(t.kind);
      expect(t.rows.map((r) => [r.cells.team, r.cells.worst])).toEqual([["4215 Hypnotic Robotics", "#60"], ["31814 Quantum Core", "#120"], ["23268 Ultraviolet", "#900"]]);
    } finally { await run("UPDATE team_season_stats SET rank_auto = NULL, rank_teleop = NULL WHERE season = 2025"); }
  });
});

// Failed searches #880 #887, in their own words: a count's board in a date window, and said "by any team … top N".
describe("a count's board in a window", () => {
  afterEach(() => { vi.useRealTimers(); });
  const day = (d: string) => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date(`${d}T15:00:00Z`));
  it("reads the window and the 'by any team' shape", () => {
    day("2026-03-12");
    expect(readLeaderboard("which team played the most matches this week")).toMatchObject({ kind: "top", stat: "matches", best: true, window: { from: expect.stringMatching(/^2026-03-/), to: expect.stringMatching(/^2026-03-/) } });
    expect(readLeaderboard("which team played the most matches this week, worldwide")).toMatchObject({ stat: "matches", region: null, window: {} });
    expect(readLeaderboard("most matches played by any team this season, worldwide, top 5")).toMatchObject({ kind: "top", stat: "matches", n: 5, region: null });
    expect(readLeaderboard("most matches played by any team this season, worldwide, top 5")).not.toHaveProperty("best");
    // Awards have no date to count in a window.
    expect(readLeaderboard("which team has the most awards this week")).toBeNull();
  });
  it("counts each team's played matches in the window, else the latest week with matches", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'WQ1', 'Window Qualifier', 'Qualifier', 'Trenton', 'NJ', 'USA', '2026-03-10', '2026-03-10', 't')");
    const m = async (n: number, red: number[], blue: number[], rs: number, bs: number) => {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, blue_total, source) VALUES (2025, 'WQ1', 'qual', 0, ?, ?, '2026-03-10T14:00:00Z', 1, ?, ?, 't')", [n, `Q${n}`, rs, bs]);
      for (const [t, a] of [...red.map((t) => [t, "red"]), ...blue.map((t) => [t, "blue"])]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, 'WQ1', 'qual', 0, ?, ?, ?)", [n, t, a]);
    };
    await m(1, [4215, 6980], [23268, 31814], 100, 80);
    await m(2, [4215, 23268], [6980, 31814], 90, 95);
    await m(3, [4215, 31814], [6980, 9999], 70, 60);
    day("2026-03-12");
    const a = await searchAnswer("which team played the most matches this week", { limit: 25, full: true });
    expect(a.stat).toMatchObject({ title: "Team worldwide with the most matches played this week", headline: { value: "4215 Hypnotic Robotics", label: "Matches played 3, 2-1-0 · Oradell" } });
    // None this week: the latest week with matches, said so.
    day("2026-03-25");
    const b = await searchAnswer("which team played the most matches this week", { limit: 25, full: true });
    expect(b.stat?.headline?.value).toBe("4215 Hypnotic Robotics");
    expect(b.stat?.scope[0]).toBe("No matches this week yet worldwide; showing 2026-03-04 to 2026-03-10");
    // Greptile on #1098: events and wins in a window, titled with it; links keep the board's season.
    day("2026-03-12");
    const e = await searchAnswer("which team attended the most events this week", { limit: 25, full: true });
    expect(e.stat).toMatchObject({ intent: "top-events-window", headline: { value: "4215 Hypnotic Robotics", label: "Events played 1, 2-1-0 · Oradell", href: expect.stringContaining("season=2025") } });
    // Greptile on #1098: a qualification surrogate win is no win on the record; 6980 stays at 2, behind 4215 by number.
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, blue_total, source) VALUES (2025, 'WQ1', 'qual', 0, 4, 'Q4', '2026-03-10T15:00:00Z', 1, 120, 10, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, surrogate) VALUES (2025, 'WQ1', 'qual', 0, 4, 6980, 'red', 1), (2025, 'WQ1', 'qual', 0, 4, 9999, 'blue', 0)");
    const w = await searchAnswer("which team won the most matches this week", { limit: 25, full: true });
    expect(w.stat?.intent).toBe("top-wins-window");
    expect(w.understood?.label).toBe("Team with the most wins this week");
    expect(w.stat?.headline?.value).toBe("4215 Hypnotic Robotics");
    const wb = w.stat!.blocks[0];
    if (wb.kind !== "leaderboard") throw new Error(wb.kind);
    expect(wb.rows.find((r) => r.team.label.startsWith("6980"))).toMatchObject({ value: 2, record: "2-1-0" });
  });
});
