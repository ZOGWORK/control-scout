// Questions routed to the view that answers them (server/api/searchAsks.ts): the FTC One Search brief's Requirement 11
// and test 16. Every number is from the fixture; every link is a real route.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { eventWon, readAsk, type Stat } from "./searchAsks";
import { withTeamStats } from "./searchTeamStats";
import { parseQuestion } from "./searchQuestions";
import { CURRENT_SEASON } from "../data/seasons";

const S = 2025;
const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false });
const hrefs = (a: { pages: { href: string }[] }) => a.pages.map((p) => p.href);
// On /search a leaderboard is the stat answer's card (server/api/answers/families/leaderboard.ts): its teams in order.
const board = (a: Awaited<ReturnType<typeof ask>>) => { const b = a.stat?.blocks.find((x) => x.kind === "leaderboard"); return b && b.kind === "leaderboard" ? b : undefined; };
const teams = (a: Awaited<ReturnType<typeof ask>>, n = 3) => board(a)?.rows.slice(0, n).map((r) => r.team.label);

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
      expect(teams(a), q).toEqual(["23268 Ultraviolet", "4215 Hypnotic Robotics", "6980 Bad Wolf"]);
      expect(hrefs(a)[0], q).toBe("/rankings?season=2025&region=USA%3ANJ");
      expect(a.hits, q).toEqual([]);
    }
  });
  it("best auto team: the team first by auto OPR; highest OPR and most wins likewise", async () => {
    expect(board(await ask("best auto team"))?.rows[0]).toMatchObject({ team: { label: "20265 Heart of RoBots" }, display: "80.2" });
    expect(board(await ask("highest OPR"))?.rows[0]).toMatchObject({ team: { label: "20265 Heart of RoBots" }, display: "267.1" });
    expect(board(await ask("who has the most wins"))?.rows[0]).toMatchObject({ team: { label: "14270 Quantum Robotics" }, record: "91-25-0" });
    expect(teams(await ask("highest OPR in NJ"))).toEqual(["23268 Ultraviolet", "4215 Hypnotic Robotics", "6980 Bad Wolf"]);
    // The dropdown keeps the short card.
    expect((await searchAnswer("best auto team", { limit: 8, learn: false })).card?.lines[0]).toMatchObject({ text: "20265 Heart of RoBots", results: ["auto OPR 80.2"] });
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
    expect(hrefs(await ask("will 4215 advance to states"))[0]).toBe(`/predict?mode=advancement&season=${CURRENT_SEASON}&team=4215`);
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
      expect(a.stat?.title, q).toBe("Top 10 teams by prediction rating worldwide · 2025–26");
      expect(teams(a, 1), q).toEqual(["20265 Heart of RoBots"]);
      expect(teams(a, 10), q).not.toContain("99001 The Best Friends");
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

describe("Greptile on #440", () => {
  beforeAll(async () => {
    // A placeholder registration with a big OPR, a second Ultraviolet, an event from before predictions,
    // and next season's New Jersey Championship (not held yet).
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (99990, 'Off-Season Demo Team', 'X', 'NJ', 'USA'), (20245, 'Ultraviolet', 'Norton Shores', 'MI', 'USA')");
    await run("INSERT INTO team_seasons (season, team) VALUES (?, 99990), (?, 20245)", [S, S]);
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, matches, wins, losses, ties) VALUES (?, 99990, 999, 99, 10, 10, 0, 0)", [S]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'X', 23268, 50, 5), (?, 'X', 20245, 50, 5)", [S, S]);
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2021, 'USNJOLD', 'Old Jersey Classic', 'Qualifier', 'Union', 'NJ', 'USA', '2022-01-08', '2022-01-08', 't'), (2026, 'USNJCMP', 'New Jersey Championship', 'Championship', 'Edison', 'NJ', 'USA', '2027-03-13', '2027-03-13', 't')");
    await rebuildSearch();
  });
  it("region codes typed in capitals are read as regions", () => {
    expect(readAsk("top teams in IN")).toMatchObject({ kind: "leaderboard", region: { key: "USA:IN" } });
    expect(readAsk("GA rankings")).toMatchObject({ kind: "leaderboard", region: { key: "USA:GA" } });
    expect(readAsk("highest OPR in OH")).toMatchObject({ kind: "stat", stat: "opr", region: { key: "USA:OH" } });
  });
  it("stat leaders never list a placeholder registration", async () => {
    const a = await ask("highest OPR");
    expect(teams(a, 1)).toEqual(["20265 Heart of RoBots"]);
    expect(teams(a, 25)!.join()).not.toMatch(/99990/);
  });
  it("a past-tense qualify question is history, not the simulator", () => {
    expect(readAsk("did 4215 qualify to worlds")).toBeNull();
  });
  it("Judges' Choice with either apostrophe", () => {
    for (const q of ["who won judges' choice at new jersey championship", "who won judges’ choice at new jersey championship"])
      expect(readAsk(q), q).toEqual({ kind: "award", award: "JudgesChoice", event: "new jersey championship" });
  });
  it("a shared name still tied: the question stays, and no Predict link is guessed", async () => {
    const a = await ask("ultraviolet vs 20265 who wins");
    expect(a.hits.filter((h) => h.kind === "compare").length).toBe(2);
    expect(a.understood?.label).toMatch(/^Which "ultraviolet"\?/);
    expect(hrefs(a).some((h) => h.startsWith("/predict"))).toBe(false);
  });
  it("a season written in a who-wins question goes to both Compare and Predict", async () => {
    const a = await ask("4215 vs 6980 2024-25 who wins");
    expect(a.hits[0]).toMatchObject({ kind: "compare", ref: "4215,6980" });
    expect(a.hits[0].href).toContain("season=2024");
    expect(hrefs(a).find((h) => h.startsWith("/predict"))).toContain("season=2024");
  });
  it("an event from before predictions has no odds to open", async () => {
    const a = await ask("who will win old jersey classic");
    expect(a.hits[0]).toMatchObject({ kind: "event", ref: "2021:USNJOLD" });
    expect(a.hits[0].section).toBeUndefined();
    expect(a.understood?.label).toMatch(/no odds for 2021–22, predictions start with 2023–24/);
  });
  it("an award from an older season shows that season's event, its own dates", async () => {
    const a = await ask("who won inspire at new jersey championship");
    expect(a.hits[0]).toMatchObject({ ref: "2025:USNJCMP", season: 2025, section: "awards" });
    expect(a.hits[0].subtitle ?? "").not.toMatch(/2027/);
  });
  it("'play next' only when it ends the question", () => {
    expect(parseQuestion("when does 4215 play next")).toMatchObject({ kind: "next-match" });
    expect(parseQuestion("when does 4215 play next season")?.kind).not.toBe("next-match");
  });
});

describe("Greptile on #440, round 2", () => {
  it("a conversational opening keeps the links the answer added", async () => {
    // An OPR list's full list is the Teams page, sorted the same way.
    expect(hrefs(await ask("show me highest OPR"))[0]).toMatch(/^\/teams\?view=season&season=2025&sort=totalPointsNpOpr/);
    expect(hrefs(await ask("show me top teams in NJ"))[0]).toBe("/rankings?season=2025&region=USA%3ANJ");
  });
});

describe("Greptile on #440, round 3", () => {
  it("a shared name still tied asks which team, with no schedule or Predict guessed", async () => {
    for (const q of ["will ultraviolet win their next match", "will ultraviolet advance"]) {
      const a = await ask(q);
      expect(a.understood?.label, q).toMatch(/^Which "ultraviolet"\? 2 teams have that name: 20245 \(Norton Shores, MI\), 23268 \(Hackettstown, NJ\)/);
      expect(a.hits.map((h) => h.ref), q).toEqual(["20245", "23268"]);
      expect(hrefs(a).some((h) => h.startsWith("/predict")), q).toBe(false);
    }
  });
  it("your own team settles it", async () => {
    const a = await searchAnswer("will ultraviolet advance", { limit: 25, learn: false, prefer: new Set(["team:23268"]) });
    expect(a.hits[0]).toMatchObject({ ref: "23268" });
    expect(hrefs(a)).toContain(`/predict?mode=advancement&season=${CURRENT_SEASON}&team=23268`);
  });
});

describe("who won an event (owner: \"who won nj states\")", () => {
  // Today is after every finished event in this fixture; next season's NJ Championship (2027) isn't held yet.
  beforeAll(async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNJCMPPKWY', 'New Jersey Championship - Parkway Division', 'Championship', 'Union', 'NJ', 'USA', '2026-03-14', '2026-03-14', 't')", [S]);
    await run(`INSERT INTO awards (season, code, type, placement, team, name) VALUES
      (?, 'USNJCMP', 'Winner', 1, 23268, 'Winning Alliance - Captain'), (?, 'USNJCMP', 'Winner', 2, 6980, 'Winning Alliance - 1st Team Selected'),
      (?, 'USNJCMP', 'Finalist', 1, 4215, 'Finalist Alliance - Captain')`, [S, S, S]);
    await rebuildSearch();
  });
  it("reads 'who won' an event or a place's states, never 'won' as a name word; an award stays an award", () => {
    expect(readAsk("who won nj states")).toEqual({ kind: "event-won", event: "nj states" });
    expect(readAsk("who won the new jersey championship")).toEqual({ kind: "event-won", event: "new jersey championship" });
    expect(readAsk("winners of nj states")).toEqual({ kind: "event-won", event: "nj states" });
    expect(readAsk("who won inspire at new jersey championship")).toMatchObject({ kind: "award" });
    expect(readAsk("who won inspire")).toBeNull();
  });
  // Search's stat answers take "who won <event>" first (server/api/answers/families/winners.ts): each division's winners
  // apart, then the Inspire Award and the event's other seasons, on the same event eventWon picks.
  it("answers the newest finished championship: its winning alliance, then the Inspire Award", async () => {
    for (const q of ["who won nj states", "winners of nj states", "who won new jesey states", "who won the New Jersey Championship"]) {
      const a = await ask(q);
      expect(a.step, q).toBe("deterministic");
      expect(a.hits[0], q).toMatchObject({ kind: "event", ref: "2025:USNJCMP", section: "playoffs" });
      expect(a.stat?.title, q).toBe("New Jersey Championship 2025–26 winning alliance");
      expect(a.stat?.headline?.value, q).toBe("23268 Ultraviolet, 6980 Bad Wolf");
      expect(a.stat?.blocks.find((b) => b.kind === "links" && b.title === "Inspire Award"), q).toMatchObject({ items: [{ label: "23268 Ultraviolet" }] });
    }
  });
  it("an event with no results recorded says so plainly", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNYCMP', 'New York Championship', 'Championship', 'Albany', 'NY', 'USA', '2026-03-01', '2026-03-01', 't')", [S]);
    const a = await ask("who won ny states");
    expect(a.stat?.none).toBe("No winning alliance is published for New York Championship yet.");
  });
});

describe("Greptile on #456", () => {
  beforeAll(async () => {
    // Last season's Parkway Division results, a FIRST Championship in New Jersey with more results than the state's,
    // the 2024-25 championship, and a championship ending today in Los Angeles.
    await run(`INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'USNJCMPPKWY', 'Winner', 1, 4215, 'Parkway Division Winning Alliance - Captain')`, [S]);
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'FTCCMPNJ', 'FIRST Championship East', 'FIRSTChampionship', 'Newark', 'NJ', 'USA', '2026-04-01', '2026-04-01', 't')", [S]);
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'FTCCMPNJ', 'Winner', 1, 20265, 'Winning Alliance - Captain'), (?, 'FTCCMPNJ', 'Winner', 2, 14270, 'Winning Alliance - 1st Team Selected'), (?, 'FTCCMPNJ', 'Inspire', 1, 14270, 'Inspire Award'), (?, 'FTCCMPNJ', 'Think', 1, 4215, 'Think Award'), (?, 'FTCCMPNJ', 'Design', 1, 6980, 'Design Award'), (?, 'FTCCMPNJ', 'Reach', 1, 23268, 'Reach Award'), (?, 'FTCCMPNJ', 'Connect', 1, 23268, 'Connect Award')", [S, S, S, S, S, S, S]);
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2024, 'USNJCMP', 'New Jersey Championship', 'Championship', 'Union', 'NJ', 'USA', '2025-03-15', '2025-03-15', 't')");
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2024, 'USNJCMP', 'Winner', 1, 6980, 'Winning Alliance - Captain')");
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, source) VALUES (?, 'USCACMP', 'California Championship', 'Championship', 'Los Angeles', 'CA', 'USA', '2026-11-02', '2026-11-02', 'America/Los_Angeles', 't')", [S]);
    await rebuildSearch();
  });
  const won = (q: string, now?: number) => eventWon(q, new Set(), now);
  it("'states' never picks the FIRST Championship held in the state", async () => {
    expect(await won("nj states")).toMatchObject({ code: "USNJCMP", season: S });
  });
  it("a year or a season named is the one answered", async () => {
    expect(await won("2025 nj states")).toMatchObject({ code: "USNJCMP", season: 2024 });
    expect(await won("2024-25 nj states")).toMatchObject({ code: "USNJCMP", season: 2024 });
    expect(await won("2025 new jersey championship")).toMatchObject({ code: "USNJCMP", season: 2024 });
  });
  it("a division named is that division", async () => {
    expect(await won("new jersey championship parkway division")).toMatchObject({ code: "USNJCMPPKWY", season: S });
  });
  it("a championship stored with no type is found by its name", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USORCMP', 'Oregon Championship', NULL, 'Portland', 'OR', 'USA', '2026-02-01', '2026-02-01', 't'), (2024, 'USOROLD', 'Oregon Qualifier', 'Championship', 'Salem', 'OR', 'USA', '2025-02-01', '2025-02-01', 't')", [S]);
    expect(await won("OR states")).toMatchObject({ code: "USORCMP", season: S });
  });
  it("an event on its last day at its venue isn't finished yet", async () => {
    // 2026-11-03 02:00 UTC is still Nov 2 in Los Angeles.
    expect(await won("CA states", Date.parse("2026-11-03T02:00:00Z"))).toBeNull();
    expect(await won("CA states", Date.parse("2026-11-03T09:00:00Z"))).toMatchObject({ code: "USCACMP" });
  });
});

describe("stat leaderboards: scope words and places (owner bug: best teleop in the world)", () => {
  const STATS: [string, Stat][] = [
    ["highest opr", "opr"], ["best auto", "auto"], ["best autonomous", "auto"], ["best teleop", "teleop"], ["best tele op", "teleop"],
    ["best driver", "teleop"], ["best driver controlled", "teleop"], ["best endgame", "endgame"], ["most wins", "wins"],
    ["top teleop", "teleop"], ["strongest auto", "auto"], ["greatest endgame", "endgame"], ["number one teleop", "teleop"], ["highest teleop", "teleop"],
  ];
  const WORLD = ["", " in the world", " worldwide", " globally", " overall", " of all time", " ever", " right now", " this season", " currently", " in ftc", " in the world right now"];
  const NJ = [" in NJ", " in New Jersey", " in New Jersey this season", " in NJ right now"];
  it("every stat with every scope is the world's leaderboard", () => {
    for (const [w, stat] of STATS) for (const sfx of WORLD) expect(readAsk(w + sfx), w + sfx).toEqual({ kind: "stat", stat, region: null });
  });
  it("every stat with a place is that place's leaderboard", () => {
    for (const [w, stat] of STATS) for (const sfx of NJ) expect(readAsk(w + sfx), w + sfx).toMatchObject({ kind: "stat", stat, region: { key: "USA:NJ" } });
  });
  it("the question forms read the same", () => {
    expect(readAsk("who has the best teleop in the world")).toEqual({ kind: "stat", stat: "teleop", region: null });
    expect(readAsk("what is the best auto in new jersey")).toMatchObject({ kind: "stat", stat: "auto", region: { key: "USA:NJ" } });
    expect(readAsk("best teleop team in the world")).toEqual({ kind: "stat", stat: "teleop", region: null });
    expect(readAsk("which team has the most wins this season")).toEqual({ kind: "stat", stat: "wins", region: null });
  });
  it("a place that isn't one is never a leaderboard", () => {
    expect(readAsk("best teleop in narnia")).toBeNull();
  });
});
