// Logged failed searches #2441/#2444, #2439, #2405, #2373, #2369, #2359, #2358 and #2355, each asked as logged:
// - "black friday scrimmage highest score compared to the world record" (#2441, #2444): the event's question asked again
//   with the scope after "compared to" (../query/scopePair.ts): the scrimmage's own best beside the season's official
//   record, never "No team, event or match matched". A scrimmage named is read on its own matches (families/topMatches.ts).
// - "273 point biobuzz match" (#2439): a score said with the game's name between it and "match" is the score, never team 273.
// - "rank the teams at nj states by auto opr in a table" (#2405): "rank … by" is the board's order, "in a table" its layout.
// - "what is team 99999's opr" (#2373): no such team page, said plainly, with the closest real team numbers.
// - "did mti happen before or after worlds" (#2369): the two events by their dates (families/eventOrder.ts).
// - "How many years ultraviolet from nj play" (#2359): "play" ending the question is its verb, never a versus.
// - "How many years ultrab" (#2358): the start of a team's name is that team, as search's own lookup reads it.
// - "who won New Jersey State Championship-NJ0312 2023–24" (#2355): one season's name of an event with another season
//   said is the same event that season; the answer's other-season links use each season's own name.
// The clock is Nov 28 2026: the 2026–27 season (BIOBUZZ) has matches.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { parseQuery } from "../query/parse";
import { parseContext } from "../query/context";
import { refreshSearchSeason, resetSearchSeason } from "./season";
import { readEventOrder } from "./families/eventOrder";
import { chipSeason, gapLine } from "../query/scopePair";
import { readLeaderboard } from "./read";

const full = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
const parse = async (q: string) => parseQuery(q, await parseContext());

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-28T12:00:00Z"));
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, string][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ"], [6980, "Bad Wolf", "Oradell", "NJ"], [207, "Critical Mass", "Oradell", "NJ"],
    [23268, "Ultraviolet", "Hackettstown", "NJ"], [31111, "Ultraviolet", "Austin", "TX"], [20764, "UltraBots", "Cedar Hill", "TX"], [32651, "UltraBot", "San Jose", "CA"],
    [11115, "Gluten Free", "Tulsa", "OK"], [23314, "Robo Rangers", "Oradell", "NJ"], [99999, "Off-Season Demo Team", "Manchester", "NH"], [99998, "Late Bloomers", "Tulsa", "OK"],
  ];
  for (const [n, name, city, state] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, ?, ?, 'USA', 2018)", [n, name, city, state]);
  }
  for (const s of [2022, 2023, 2024, 2025, 2026]) for (const n of [4215, 6980, 207, 23268, 11115]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
  for (const s of [2024, 2025]) await run("INSERT INTO team_seasons (season, team) VALUES (?, 20764)", [s]);
  await run("INSERT INTO team_seasons (season, team) VALUES (2025, 31111), (2025, 99998), (2025, 32651)");
  for (const [s, n, opr, auto] of [[2025, 4215, 120, 40], [2025, 6980, 140, 30], [2025, 207, 90, 20], [2025, 23268, 100, 35], [2024, 20764, 50, 10], [2025, 20764, 60, 12], [2025, 99998, 30, 5], [2025, 32651, 20, 3]] as const) {
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, rating_np, rating_matches, matches, wins, losses, ties) VALUES (?, ?, ?, ?, 50, ?, 10, 10, 6, 4, 0)`, [s, n, opr, auto, opr]);
  }
  const ev = (season: number, code: string, name: string, type: string, state: string, start: string, end = start, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, 'Town', ?, 'USA', ?, ?, 't')", [season, code, name, type, division, state, start, end]);
  const match = (season: number, code: string, level: string, n: number, label: string, red: number, blue: number, lineup: [number, string][]) => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, ?, 0, ?, ?, NULL, 1, ?, ?, ?, ?, 't')", [season, code, level, n, label, red, red, blue, blue]),
    ...lineup.map(([t, a]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, ?, 0, ?, ?, ?, 1)", [season, code, level, n, t, a])),
  ]);
  const four: [number, string][] = [[4215, "red"], [6980, "red"], [207, "blue"], [23268, "blue"]];
  // 2026–27: a scrimmage, and the qualifier holding the season's official record (a 273-point match).
  await ev(2026, "USOKTUN", "Black Friday Scrimmage", "Scrimmage", "OK", "2026-11-27");
  await match(2026, "USOKTUN", "qual", 1, "Q1", 150, 120, four);
  await match(2026, "USOKTUN", "qual", 2, "Q2", 180, 90, four);
  await ev(2026, "USNJQ1", "Oradell Qualifier", "Qualifier", "NJ", "2026-11-14");
  await match(2026, "USNJQ1", "qual", 1, "Q1", 273, 200, four);
  await match(2026, "USNJQ1", "qual", 2, "Q2", 210, 100, four);
  // The New Jersey state championship under a different name each season (code USNJCMP), with its winners.
  await ev(2022, "USNJCMP", "New Jersey State Championship-NJ0312", "Championship", "NJ", "2023-03-12");
  await ev(2023, "USNJCMP", "New Jersey 3/17/24 State Championship Tournament", "Championship", "NJ", "2024-03-17");
  await ev(2025, "USNJCMP", "New Jersey Championship", "Championship", "NJ", "2026-03-15");
  for (const s of [2022, 2023, 2025]) {
    await match(s, "USNJCMP", "playoff", 1, "F1", 300, 250, four);
    await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (?, 'USNJCMP', 1, 4215, 6980)", [s]);
    await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, 'USNJCMP', 'Winner', 1, 4215), (?, 'USNJCMP', 'Winner', 2, 6980)", [s, s]);
  }
  for (const [t, rank] of [[4215, 1], [6980, 2], [207, 3], [23268, 4]] as const) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJCMP', ?, ?)", [t, rank]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (2025, 'USNJCMP', ?, 100, ?, 50, 10, 5)", [t, 50 - rank * 5]);
  }
  // Worlds in April, an off-season invitational after it in June (2025–26).
  await ev(2025, "FTCCMP1", "FIRST Championship - FIRST Tech Challenge", "FIRSTChampionship", "TX", "2026-04-29", "2026-05-02");
  await ev(2025, "USCHSLAOS", "Multinational Tech Invitational", "OffSeason", "MD", "2026-06-26", "2026-06-28");
  // Only 4215 and 6980 of New Jersey's championship teams have been to Worlds.
  await match(2025, "FTCCMP1", "qual", 1, "Q1", 200, 100, [[4215, "red"], [6980, "blue"]]);
  await match(2025, "USCHSLAOS", "qual", 1, "Q1", 210, 100, four);
  // The two teams whose names start "ultrab" have played.
  await ev(2025, "USTXQ9", "Cedar Hill Qualifier", "Qualifier", "TX", "2026-01-10");
  await match(2025, "USTXQ9", "qual", 1, "Q1", 90, 80, [[20764, "red"], [32651, "blue"]]);
  for (const [t, rank] of [[20764, 100], [32651, 800]] as const) {
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (2025, 'USTXQ9', ?, 50, 10, 30, 10, 1)", [t]);
    await run("UPDATE team_season_stats SET rank_np = ?, ranked_teams = 1000 WHERE season = 2025 AND team = ?", [rank, t]);
  }
  await rebuildSearch();
  clearAllCaches();
  await refreshSearchSeason();
});

afterAll(() => {
  resetSearchSeason();
  vi.useRealTimers();
});

describe("an event's highest score compared to the world record (#2441, #2444)", () => {
  it("is the scrimmage's own best beside the season's official record, and how far apart they are", async () => {
    const a = await full("black friday scrimmage highest score compared to the world record");
    expect(a.step).toBe("deterministic");
    expect(a.stat?.intent).toBe("season-top-matches-scopes");
    expect(a.stat?.title).toBe("Highest-scoring matches at Black Friday Scrimmage, BIOBUZZ 2026–27 vs the world record");
    const k = a.stat!.blocks[0];
    expect(k.kind === "kpis" && k.items.map((i) => [i.label, i.value])).toEqual([["Black Friday Scrimmage", "180 points"], ["World record", "273 points"]]);
    expect(a.stat?.headline).toMatchObject({ value: "180 points vs 273 points", label: "93 points below the world record (66% of it)" });
  });
  it("a scrimmage named on its own reads its own matches, said as a scrimmage's, never as official records", async () => {
    const a = await full("black friday scrimmage highest score");
    expect(a.stat?.headline?.value).toBe("180 points");
    expect(a.stat?.scope).toContain("Scrimmage");
    expect(a.stat?.definition).toMatch(/never count toward a season's records/);
  });
  it("the card's season and the gap read from the answers", () => {
    expect(chipSeason("2026–27")).toBe(2026);
    expect(chipSeason("Black Friday Scrimmage")).toBeNull();
    const s = (v: string) => ({ headline: { value: v, label: "" } }) as never;
    expect(gapLine(s("180 points"), s("273 points"), "the world record")).toBe("93 points below the world record (66% of it)");
    expect(gapLine(s("273 points"), s("273 points"), "the world record")).toBe("Level with the world record");
  });
});

describe("a match by its score with the game's name in it (#2439)", () => {
  it("is the score, never team 273", async () => {
    const p = await parse("273 point biobuzz match");
    expect(p.teams).toEqual([]);
    expect(p.scoreCond).toEqual({ side: "either", op: "=", n: 273 });
    expect(p.complete).toBe(true);
    const a = await full("273 point biobuzz match");
    expect(a.understood?.kind).toBe("question");
    expect(JSON.stringify(a.stat)).toContain("273");
  });
  it("a total over several matches is never one match's score", async () => {
    expect((await parse("4215 scored 200 points in 5 matches")).scoreCond).toBeUndefined();
  });
});

describe("rank the teams at a state championship by a stat, in a table (#2405)", () => {
  it("is the championship's board by that stat", async () => {
    const p = await parse("rank the teams at nj states by auto opr in a table");
    expect(p).toMatchObject({ intent: "leaderboard", complete: true, states: true, leftover: [] });
    const a = await full("rank the teams at nj states by auto opr in a table");
    expect(a.understood?.label).toMatch(/New Jersey Championship by Auto OPR/);
  });
});

describe("a team number no team page has (#2373)", () => {
  it("says so plainly, with the closest real team numbers and the question asked again for the closest", async () => {
    const a = await full("what is team 99999's opr");
    expect(a.understood?.label).toMatch(/^No team page for 99999 \(a placeholder entry\): the closest team number/);
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "99998" });
    expect(a.didYouMean).toBe("what is team 99998's opr");
  });
});

describe("which of two events came first (#2369)", () => {
  it("reads the two events and the order asked", () => {
    expect(readEventOrder("did mti happen before or after worlds")).toEqual({ a: "mti", b: "worlds", asked: "either" });
    expect(readEventOrder("was mti before worlds")).toEqual({ a: "mti", b: "worlds", asked: "before" });
    expect(readEventOrder("4215 opr before worlds")).toBeNull();
  });
  it("answers by each event's dates, the newest season both were held", async () => {
    const a = await full("did mti happen before or after worlds");
    expect(a.stat?.intent).toBe("event-order");
    expect(a.stat?.headline).toMatchObject({ value: "After", label: "Multinational Tech Invitational was 8 weeks after Worlds finals" });
  });
});

describe("how many years a team from a place played (#2359), and by the start of its name (#2358)", () => {
  it("'play' ending the question is its verb, and 'from <place>' picks the team, never a filter", async () => {
    const p = await parse("How many years ultraviolet from nj play");
    expect(p).toMatchObject({ intent: "seasons-count", complete: true });
    expect(p.symbols).not.toContain("vs");
    const a = await full("How many years ultraviolet from nj play");
    const b = await full("How many years 23268");
    expect(a.understood?.label).toContain("Ultraviolet (23268)");
    expect(a.stat?.intent).toBe(b.stat?.intent);
    expect(a.stat?.headline?.value).toBe(b.stat?.headline?.value);
  });
  it("'who did <team> play' still asks for its opponents", async () => {
    expect((await parse("who did 4215 play")).symbols).toContain("vs");
  });
  it("the start of teams' names is the one the shared-name rules pick, the card saying which and why", async () => {
    const a = await full("How many years ultrab");
    expect(a.stat?.intent).toBe((await full("How many years 20764")).stat?.intent);
    expect(a.understood?.label).toMatch(/ · ultrab: (20764|32651), .+ of 2 teams whose name starts "ultrab"$/);
  });
});

describe("who won an event by another season's name (#2355)", () => {
  it("is the same event in the season said", async () => {
    for (const [q, title] of [
      ["who won New Jersey State Championship-NJ0312 2023–24", "New Jersey 3/17/24 State Championship Tournament"],
      ["who won New Jersey State Championship-NJ0312 2025–26", "New Jersey Championship"],
      ["who won New Jersey 3/17/24 State Championship Tournament 2022–23", "New Jersey State Championship-NJ0312"],
    ]) {
      const a = await full(q);
      expect(a.stat?.intent, q).toBe("winning-alliance");
      expect(a.understood?.label, q).toContain(title);
    }
  });
  it("the other seasons' links say each season's own name", async () => {
    const a = await full("who won New Jersey Championship 2025–26");
    const links = a.stat!.blocks.find((b) => b.kind === "links" && b.title === "Other seasons");
    const hrefs = links && links.kind === "links" ? links.items.map((i) => decodeURIComponent(i.href)) : [];
    expect(hrefs).toContain("/search?q=who won New Jersey 3/17/24 State Championship Tournament 2023–24");
    expect(hrefs).toContain("/search?q=who won New Jersey State Championship-NJ0312 2022–23");
  });
});

describe("an event's teams that have never been to Worlds (#2397, #2384)", () => {
  it("is the event's board of only the teams never at the FIRST Championship", async () => {
    const p = await parse("which teams at nj states have never been to worlds");
    expect(p).toMatchObject({ intent: "leaderboard", complete: true, states: true, worlds: false });
    const a = await full("which teams at nj states have never been to worlds");
    expect(a.stat?.title).toMatch(/^Teams never at Worlds at New Jersey Championship/);
    expect(a.stat?.scope).toContain("Never at Worlds");
    const board = a.stat!.blocks.find((b) => b.kind === "leaderboard");
    const teams = board && board.kind === "leaderboard" ? board.rows.map((r) => r.team.label) : [];
    expect(teams).toEqual(["207 Critical Mass", "23268 Ultraviolet"]);
  });
});

describe("teams worldwide that climbed from one OPR rank to the top (#2380)", () => {
  it("'worldwide' is every place: the climb board", async () => {
    expect(readLeaderboard("teams worldwide that climbed from opr rank 5000+ to the top 50")).toMatchObject({ kind: "improved", region: null, climb: { from: 5000, to: 50 } });
    const a = await full("teams worldwide that climbed from opr rank 5000+ to the top 50");
    expect(a.understood?.label).toMatch(/^Teams that climbed from OPR rank 5000\+ to the top 50/);
  });
});

describe("how many times one team met another, asked with compare (#2376)", () => {
  it("is their meetings, never a side by side with the count left unread", async () => {
    const p = await parse("compare how many times 4215 got it to 23314");
    expect(p).toMatchObject({ intent: "head-to-head", complete: true });
    expect((await parse("4215 and 6980 matches")).intent).toBe("shared-matches");
    const a = await full("compare how many times 4215 got it to 23314");
    expect(a.stat?.intent).toBe((await full("4215 vs 23314 head to head")).stat?.intent);
  });
});
