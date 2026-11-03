// Questions routed to the view that answers them (server/api/searchAsks.ts): the FTC One Search brief's Requirement 11
// and test 16. Every number is from the fixture; every link is a real route.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { readAsk } from "./searchAsks";
import { withTeamStats } from "./searchTeamStats";

const S = 2025;
const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false });
const hrefs = (a: { pages: { href: string }[] }) => a.pages.map((p) => p.href);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, city, state, opr, auto opr, wins, losses, rating
  const teams: [number, string, string, string, number, number, number, number, number][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", 101.6, 30, 26, 6, 90],
    [6980, "Bad Wolf", "Oradell", "NJ", 80, 35, 20, 10, 70],
    [23268, "Ultraviolet", "Hackettstown", "NJ", 157.9, 50, 33, 17, 140],
    [20265, "Heart of RoBots", "Austin", "TX", 267.1, 80.2, 86, 20, 200],
    [14270, "Quantum Robotics", "Bucharest", "", 200, 60, 91, 25, 180],
  ];
  for (const [n, name, city, state, opr, auto, w, l, rating] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state || null, state ? "USA" : "Romania"]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, rank_np, ranked_teams, rating_np, rating_matches, matches, wins, losses, ties)
      VALUES (?, ?, ?, ?, ?, 5, ?, 10, 10, ?, ?, 0)`, [S, n, opr, auto, null, rating, w, l]);
  }
  await run("UPDATE team_season_stats SET rank_np = (SELECT COUNT(*) FROM team_season_stats x WHERE x.season = team_season_stats.season AND x.opr_np > team_season_stats.opr_np) + 1");
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNJCMP', 'New Jersey Championship', 'Championship', 'Union', 'NJ', 'USA', '2026-03-14', '2026-03-14', 't')", [S]);
  await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'USNJCMP', 'Inspire', 1, 23268, 'Inspire Award'), (?, 'USNJCMP', 'Inspire', 2, 4215, 'Inspire Award')", [S, S]);
  await rebuildSearch();
});

describe("reading", () => {
  it("reads each question, and leaves names alone", () => {
    expect(readAsk("top teams in new jersey")).toMatchObject({ kind: "leaderboard", region: { key: "USA:NJ" } });
    expect(readAsk("nj rankings")).toMatchObject({ kind: "leaderboard" });
    expect(readAsk("best team in nj")).toMatchObject({ kind: "leaderboard" });
    expect(readAsk("highest opr")).toEqual({ kind: "stat", stat: "opr", region: null });
    expect(readAsk("best auto team")).toEqual({ kind: "stat", stat: "auto", region: null });
    expect(readAsk("who has the most wins")).toEqual({ kind: "stat", stat: "wins", region: null });
    expect(readAsk("will 4215 win their next match")).toEqual({ kind: "predict-next", team: "4215" });
    expect(readAsk("4215 vs 6980 who wins")).toEqual({ kind: "predict-versus", rest: "4215 vs 6980" });
    expect(readAsk("who will win new jersey championship")).toEqual({ kind: "event-winner", event: "new jersey championship" });
    expect(readAsk("will 4215 advance to states")).toEqual({ kind: "advance", team: "4215" });
    expect(readAsk("what does 4215 need to advance")).toEqual({ kind: "advance", team: "4215" });
    expect(readAsk("who won inspire at new jersey championship")).toEqual({ kind: "award", award: "Inspire", event: "new jersey championship" });
    expect(readAsk("how are predictions calculated")).toEqual({ kind: "how" });
    for (const q of ["top shelf", "best robotics", "hypnotic", "4215", "highest score this season", "rankings", "meets in new jersey"]) expect(readAsk(q), q).toBeNull();
  });
});

describe("test 16: each intent returns its stated surface", () => {
  it("4215 record: its record", async () => {
    const a = await ask("4215 record");
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "4215" });
    expect(a.hits[0].facts?.find((f) => f.label === "Record")?.value).toBe("26-6-0");
  });
  it("when does 4215 play next: its next match, or plainly none scheduled", async () => {
    const a = await ask("when does 4215 play next");
    expect(a.card).toMatchObject({ kind: "next-match" });
    expect(a.card!.none).toMatch(/No upcoming match is scheduled/);
  });
  it("top teams in New Jersey (and NJ rankings, best team in NJ): the region's ranking, linked", async () => {
    for (const q of ["top teams in New Jersey", "NJ rankings", "best team in NJ"]) {
      const a = await ask(q);
      expect(a.card?.lines.map((l) => l.text), q).toEqual(["23268 Ultraviolet", "4215 Hypnotic Robotics", "6980 Bad Wolf"]);
      expect(hrefs(a), q).toContain("/rankings?season=2025&region=USA%3ANJ");
      expect(a.hits, q).toEqual([]);
    }
  });
  it("best auto team: the team first by auto OPR; highest OPR and most wins likewise", async () => {
    expect((await ask("best auto team")).card?.lines[0]).toMatchObject({ text: "20265 Heart of RoBots", results: ["auto OPR 80.2"] });
    expect((await ask("highest OPR")).card?.lines[0]).toMatchObject({ text: "20265 Heart of RoBots", results: ["OPR 267.1"] });
    expect((await ask("who has the most wins")).card?.lines[0]).toMatchObject({ text: "14270 Quantum Robotics", results: ["91-25-0"] });
    expect((await ask("highest OPR in NJ")).card?.lines.map((l) => l.text)).toEqual(["23268 Ultraviolet", "4215 Hypnotic Robotics", "6980 Bad Wolf"]);
  });
  it("will 4215 win their next match: its next match, and Predict opened on its matches", async () => {
    const a = await ask("will 4215 win their next match");
    expect(a.card).toMatchObject({ kind: "next-match" });
    expect(hrefs(a)[0]).toBe("/predict?mode=scheduled&for=team:4215");
  });
  it("4215 vs 6980 who wins: Compare, and Predict with both teams", async () => {
    const a = await ask("4215 vs 6980 who wins");
    expect(a.hits[0]).toMatchObject({ kind: "compare", ref: "4215,6980" });
    expect(hrefs(a)[0]).toBe("/predict?mode=match&red=4215&blue=6980");
  });
  it("who will win an event: its odds", async () => {
    expect((await ask("who will win New Jersey Championship")).hits[0]).toMatchObject({ kind: "event", ref: "2025:USNJCMP", section: "odds" });
  });
  it("will 4215 advance: Predict's advancement simulator", async () => {
    expect(hrefs(await ask("will 4215 advance to states"))[0]).toBe("/predict?mode=advancement&season=2025&team=4215");
  });
  it("who won Inspire at an event: its winner, from the event's results", async () => {
    const a = await ask("who won Inspire at New Jersey Championship");
    expect(a.card?.lines.map((l) => [l.text, l.results?.[0]])).toEqual([["23268 Ultraviolet", "Winner"], ["4215 Hypnotic Robotics", "2nd place"]]);
    expect(a.hits[0]).toMatchObject({ ref: "2025:USNJCMP", section: "awards" });
  });
  it("how are predictions calculated: the methodology page in the Pages group", async () => {
    const a = await ask("how are predictions calculated");
    expect(a.pages[0]).toEqual({ title: "How predictions are calculated", href: "/methodology" });
    expect(a.hits).toEqual([]);
  });
});

describe("team rows carry their season numbers", () => {
  it("OPR, record and rank from the newest season played", async () => {
    const [h] = await withTeamStats((await ask("4215")).hits);
    expect(h.team).toEqual({ season: 2025, opr: 101.6, record: { w: 26, l: 6, t: 0 }, rank: { n: 4, of: 5 } });
  });
  it("no matches played: no numbers", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (99999, 'Brand New', 'Reno', 'NV', 'USA')");
    expect((await withTeamStats([{ kind: "team", ref: "99999", title: "99999 | Brand New", subtitle: "", season: 2025 }]))[0].team).toBeUndefined();
  });
});

describe("the best team, worldwide (owner report: \"what is the best ftc team right now\" found nothing)", () => {
  beforeAll(async () => {
    // Names and towns that share its words: never the answer to a question.
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (99001, 'The Best Friends', 'Best', NULL, 'Netherlands'), (99002, 'the_best', 'Heerbeeck', NULL, 'Netherlands')");
    await rebuildSearch();
  });
  it("reads as the world leaderboard, whatever filler or time words it has", () => {
    for (const q of ["what is the best ftc team right now", "best team", "who is the best ftc team", "top ftc teams", "whats the best team currently", "strongest team in the world", "who is the best"])
      expect(readAsk(q), q).toEqual({ kind: "leaderboard", region: null });
    for (const q of ["best", "the best friends", "best robotics"]) expect(readAsk(q), q).toBeNull();
  });
  it("answers with the season's top teams, linked to the world rankings", async () => {
    for (const q of ["what is the best ftc team right now", "best team", "who is the best ftc team", "top ftc teams"]) {
      const a = await ask(q);
      expect(a.step, q).toBe("deterministic");
      expect(a.card?.title, q).toBe("Top teams · 2025–26");
      expect(a.card?.lines[0]?.text, q).toBe("20265 Heart of RoBots");
      expect(a.card?.lines.map((l) => l.text), q).not.toContain("99001 The Best Friends");
      expect(a.understood?.label, q).toBe("Top teams · 2025–26: the world rankings");
      expect(hrefs(a)[0], q).toBe("/rankings?season=2025");
      expect(a.hits, q).toEqual([]);
    }
  });
  it("a question that matches nothing lists no word-by-word matches", async () => {
    const a = await ask("what is the best way to win friends");
    expect(a.step).toBe("recovery");
    expect(a.recovery?.closest).toEqual([]);
    expect(a.recovery?.browse.length).toBeGreaterThan(0);
  });
});
