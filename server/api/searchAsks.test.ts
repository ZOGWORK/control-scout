// Questions routed to the view that answers them (server/api/searchAsks.ts): the FTC One Search brief's Requirement 11
// and test 16. Every number is from the fixture; every link is a real route.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchSeason } from "./answers/season";
import { searchAnswer } from "./searchAnswer";
import { askAnswer, askSeason, eventWon, readAsk, type Stat } from "./searchAsks";
import { seasonLabel } from "../../src/shared/format";
import { readStatQuestion } from "./answers/read";
import { pageMeta } from "../seoMeta";
import { awardQuery } from "./searchCoverage";
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
    // The team word unsaid before a place, and short words for "this season".
    for (const q of ["top in texas atm", "the strongest in GA right now", "best from ohio rn", "top 5 in new jersey currently"])
      expect(readAsk(q), q).toMatchObject({ kind: "leaderboard", region: { key: expect.stringMatching(/^USA:/) } });
    for (const q of ["best in show", "best in class", "top of the hour"]) expect(readAsk(q), q).toBeNull();
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
    // No match rows here, only the stored season: the team's own record (the record answer needs matches).
    expect(a.hits[0].facts?.find((f) => f.label === "Record")?.value).toBe("26-6-0");
  });
  it("when does 4215 play next: its next match, or plainly none scheduled", async () => {
    const a = await ask("when does 4215 play next");
    expect(a.card).toMatchObject({ kind: "next-match" });
    expect(a.card!.none).toMatch(/No upcoming match is scheduled/);
  });
  it("top teams in New Jersey (and NJ rankings, best team in NJ): the region's ranking, linked", async () => {
    for (const q of ["top teams in New Jersey", "NJ rankings", "best team in NJ", "the strongest in New Jersey atm"]) {
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
    // Predict opens on the season the answer's call is for (the latest completed one when none is written).
    expect(hrefs(a)[0]).toBe(`/predict?mode=match&season=${searchSeason()}&red=4215&blue=6980`);
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
    // The podium's award, the event (its Awards tab) and every award it gave, in the event page's order.
    expect(a.card).toMatchObject({ award: "Inspire", event: { season: 2025, code: "USNJCMP" } });
    expect(a.card!.awards!.filter((x) => x.type === "Inspire").map((x) => [x.placement, x.team])).toEqual([[1, 23268], [2, 4215]]);
    expect(a.card!.awards![0].type).toBe("Inspire");
  });
  it("Predict itself: a lineup of your own is Custom matchup, picking predictions out is Scheduled matches", async () => {
    for (const q of ["can i see the odds for teams i choose", "do the predicted scores change if i swap the teams", "who would win a hypothetical match"]) {
      expect(readAsk(q), q).toEqual({ kind: "predict-lineup" });
    }
    const lineup = await ask("can i get a prediction for a match that has not been played yet");
    expect(lineup.pages[0]).toEqual({ title: "Predict: Custom matchup", href: "/predict?mode=match" });
    expect(lineup.understood?.label).toMatch(/^Yes: Predict's Custom matchup takes any teams on each alliance\. After changing them, press Predict this match/);
    expect(readAsk("how do i sort predictions by team")).toEqual({ kind: "predict-filter" });
    const filter = await ask("is there a way to filter the forecasts by event");
    expect(filter.pages[0]).toEqual({ title: "Predict: Scheduled matches", href: "/predict?mode=scheduled" });
    expect(filter.understood?.label).toMatch(/not by date/);
    // A team named is that team's question, never Predict's help.
    expect(readAsk("can i filter 4215 predictions")?.kind).not.toBe("predict-filter");
  });
  it("a lineup changed in a supposition, with no forecast word: Custom matchup, or which partner is best in it", async () => {
    for (const q of ["what if we switch the alliance", "suppose you change our partners", "what if we swap our alliance"]) expect(readAsk(q), q).toEqual({ kind: "predict-lineup", say: "change" });
    for (const q of ["who's the strongest partner if we swap teams", "which team would make the best alliance partner if i switch the alliance", "who is the best partner if you swap the alliances"]) {
      expect(readAsk(q), q).toEqual({ kind: "predict-lineup", say: "partner" });
    }
    // Through the whole search, whatever it rewrites first ("teams" read as "team").
    const changed = await ask("What if I switch teams?");
    expect(changed.pages[0]).toEqual({ title: "Predict: Custom matchup", href: "/predict?mode=match" });
    expect(changed.understood?.label).toMatch(/^Predict's Custom matchup takes any teams on each alliance: change them/);
    const partner = await ask("who would be the best partner if we change teams");
    expect(partner.understood?.label).toMatch(/^Try each partner in Predict's Custom matchup/);
    // Anything else asked, or a team named, is left to the other readers.
    for (const q of ["if we change the alliance who scores most", "if we change teams does 4215 win"]) expect(readAsk(q)?.kind, q).not.toBe("predict-lineup");
  });
  it("a team's predictions page: its matches in Predict; a day's calls: that day's events", async () => {
    // A name is read only for a team that has played: this test's own played row, whatever ran before it.
    await run("INSERT OR IGNORE INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'UVPLAYED', 23268, 50, 5)", [S]);
    await rebuildSearch();
    const team = await ask("ultraviolet prediction settings");
    expect(team.hits[0]).toMatchObject({ kind: "team", ref: "23268" });
    expect(team.pages[0]).toEqual({ title: "Predict Ultraviolet's matches", href: "/predict?mode=scheduled&for=team:23268" });
    expect(readAsk("predictions for todays matches")).toEqual({ kind: "predict-day", day: "today" });
    // A place or an event named with the day asks for a filter this list doesn't apply: left to other readers.
    for (const q of ["predictions for tomorrow's matches in ohio", "today's matches at the state championship predictions", "predictions for tomorrow's playoff matches", "show me predictions for today's matches for hypnotic robotics"]) expect(readAsk(q)?.kind, q).not.toBe("predict-day");
    expect(readAsk("show me the forecasts for all of tomorrow's matches")).toEqual({ kind: "predict-day", day: "tomorrow" });
    expect(readAsk("what are the predictions for tomorrow's matches")).toEqual({ kind: "predict-day", day: "tomorrow" });
    // A closing "if any (are scheduled)" narrows nothing, with or without the filler retry's cut.
    for (const q of ["give me all forecasts for today's matches, if there are any", "show me all predictions for tomorrow's matches are scheduled"]) expect(readAsk(q)?.kind, q).toBe("predict-day");
    const none = await ask("tomorrow's matches predictions");
    expect(none.understood?.label).toMatch(/^Tomorrow \(.+\): no event has matches then/);
    // End to end, through the query cleaning and the filler retry: the same day answer.
    expect((await ask("show me all predictions for tomorrow's matches, if any are scheduled")).understood?.label).toMatch(/^Tomorrow \(.+\): no event has matches then/);
    const day = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNJQ9', 'Garden Qualifier', 'Qualifier', 'Union', 'NJ', 'USA', ?, ?, 't')", [CURRENT_SEASON, day, day]);
    // A workshop plays no matches: never counted. An event with no schedule posted yet has no predictions yet.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNJW9', 'Build Workshop', 'Workshop', 'Union', 'NJ', 'USA', ?, ?, 't')", [CURRENT_SEASON, day, day]);
    const early = await ask("show me predictions for tomorrows matches");
    expect(early.understood?.label).toMatch(/^Tomorrow \(.+\): 1 event, none with a match schedule posted yet/);
    expect(early.hits.map((h) => h.ref)).toEqual([`${CURRENT_SEASON}:USNJQ9`]);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (?, 'USNJQ9', 'qual', 0, 1, 'Q1', ?, 0, 't')", [CURRENT_SEASON, `${day}T14:00:00Z`]);
    const one = await ask("show me predictions for tomorrows matches");
    expect(one.understood?.label).toMatch(/^Tomorrow \(.+\): 1 event with matches/);
    expect(one.hits[0]).toMatchObject({ kind: "event", ref: `${CURRENT_SEASON}:USNJQ9` });
    expect(one.pages[0]).toEqual({ title: "Predict: Garden Qualifier", href: `/predict?mode=scheduled&for=event:${CURRENT_SEASON}:USNJQ9` });
    // A two-day event whose matches are all the day after (inspection tomorrow): no matches tomorrow, left out. One with
    // a schedule but no match times yet: kept, said apart. A match late tomorrow evening in California is past midnight
    // UTC, but tomorrow where it's held: counted.
    const next = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, source) VALUES (?, 'USPAT2', 'Two Day Tournament', 'Qualifier', 'Erie', 'PA', 'USA', ?, ?, 'America/New_York', 't'), (?, 'USOHU1', 'Untimed Qualifier', 'Qualifier', 'Akron', 'OH', 'USA', ?, ?, NULL, 't'), (?, 'USCAL1', 'Late Night Qualifier', 'Qualifier', 'Fresno', 'CA', 'USA', ?, ?, 'America/Los_Angeles', 't')",
      [CURRENT_SEASON, day, next, CURRENT_SEASON, day, day, CURRENT_SEASON, day, day]);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (?, 'USPAT2', 'qual', 0, 1, 'Q1', ?, 0, 't'), (?, 'USOHU1', 'qual', 0, 1, 'Q1', NULL, 0, 't'), (?, 'USCAL1', 'qual', 0, 1, 'Q1', ?, 0, 't')",
      [CURRENT_SEASON, `${next}T15:00:00Z`, CURRENT_SEASON, CURRENT_SEASON, `${next}T04:00:00Z`]);
    // A venue's wall time (no zone, as FIRST writes them) is its own date, never read again in another zone: an
    // afternoon match in Brisbane stays tomorrow there.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, source) VALUES (?, 'AUBNE1', 'Brisbane Qualifier', 'Qualifier', 'Brisbane', 'QLD', 'Australia', ?, ?, 'Australia/Brisbane', 't')", [CURRENT_SEASON, day, day]);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (?, 'AUBNE1', 'qual', 0, 1, 'Q1', ?, 0, 't')", [CURRENT_SEASON, `${day}T15:00:00`]);
    const mixed = await ask("show me predictions for tomorrows matches");
    expect(mixed.hits.map((h) => h.ref)).toEqual([`${CURRENT_SEASON}:AUBNE1`, `${CURRENT_SEASON}:USNJQ9`, `${CURRENT_SEASON}:USCAL1`, `${CURRENT_SEASON}:USOHU1`]);
    expect(mixed.understood?.label).toMatch(/^Tomorrow \(.+\): 4 events, 3 with matches that day, 1 with a schedule posted but no match times yet: their predictions are in Predict$/);
    await run("DELETE FROM matches WHERE code IN ('USNJQ9', 'USPAT2', 'USOHU1', 'USCAL1', 'AUBNE1')");
    await run("DELETE FROM events WHERE code IN ('USNJQ9', 'USNJW9', 'USPAT2', 'USOHU1', 'USCAL1', 'AUBNE1')");
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
      expect(a.understood?.label, q).toBe("New Jersey Championship 2025–26 winning alliance");
      expect(a.stat?.title, q).not.toBe(a.understood?.label);
      expect(a.stat?.headline?.value, q).toBe("23268 Ultraviolet, 6980 Bad Wolf");
      expect(a.stat?.blocks.find((b) => b.kind === "links" && b.title === "Inspire Award"), q).toMatchObject({ items: [{ label: "23268 Ultraviolet" }] });
    }
  });
  it("an event's alliances, however said, are its Playoffs tab, never words of its name", async () => {
    for (const q of ["nj states alliances", "nj states alliance selection", "alliance selection nj states", "nj states alliance captains"]) {
      const a = await ask(q);
      expect(a.understood?.label ?? "", q).toMatch(/^Playoffs · New Jersey Championship/);
      expect(a.hits.find((h) => h.kind === "event"), q).toMatchObject({ section: "playoffs" });
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

describe("who won: a Leadership Award stored as a Winner isn't a winner (Worlds 2025–26, FTCCMP1)", () => {
  it("leaves FIRST Leadership Award rows out of the winning alliance", async () => {
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'USNJCMP', 'Winner', 3, 14270, 'FIRST Leadership Award')", [S]);
    // On /search "who won" is the stat answer's card (server/api/answers/families/winners.ts).
    const a = await ask("who won nj states");
    expect(a.stat?.headline).toBeDefined();
    expect(JSON.stringify(a.stat)).not.toContain("14270");
  });
  it("keeps winners stored with no award name (event-day bundles store none) (Greptile on #466)", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USDECMP', 'Delaware Championship', 'Championship', 'Dover', 'DE', 'USA', '2026-02-01', '2026-02-01', 't')", [S]);
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'USDECMP', 'Winner', 1, 4215, NULL)", [S]);
    await rebuildSearch();
    const a = await ask("who won DE states");
    expect(a.stat?.headline?.value).toContain("4215");
  });
});

describe("who won a division (owner: \"who won nj turnpike division this year\" read no results)", () => {
  // The Vermont Championship: a North Division with its playoffs played and no awards (FIRST posts a division's awards
  // on its championship), a South Division not played, the finals between the division winners, and a qualifier not
  // held yet.
  beforeAll(async () => {
    await run(`INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES
      (?, 'USVTCMP', 'Vermont Championship', 'Championship', NULL, 'Burlington', 'VT', 'USA', '2026-03-07', '2026-03-07', 't'),
      (?, 'USVTCMPN', 'Vermont Championship - North Division', 'Championship', 'USVTCMP', 'Burlington', 'VT', 'USA', '2026-03-07', '2026-03-07', 't'),
      (?, 'USVTCMPS', 'Vermont Championship - South Division', 'Championship', 'USVTCMP', 'Burlington', 'VT', 'USA', '2026-03-07', '2026-03-07', 't'),
      (?, 'USVTMAPLE', 'Vermont Maple Qualifier', 'Qualifier', NULL, 'Stowe', 'VT', 'USA', '2027-01-10', '2027-01-10', 't')`, [S, S, S, S]);
    await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (?, 'USVTCMPN', 1, 23268, 6980), (?, 'USVTCMPN', 2, 4215, 14270), (?, 'USVTCMP', 1, 23268, 6980), (?, 'USVTCMP', 2, 20265, 4215)", [S, S, S, S]);
    const final = async (code: string, n: number, red: number[], blue: number[], r: number, b: number) => {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'playoff', 6, ?, ?, 1, ?, ?, ?, ?, 't')", [S, code, n, `F${n}`, r, r, b, b]);
      for (const [t, al] of [...red.map((t) => [t, "red"]), ...blue.map((t) => [t, "blue"])]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'playoff', 6, ?, ?, ?)", [S, code, n, t, al]);
    };
    for (const n of [1, 2]) await final("USVTCMPN", n, [23268, 6980], [4215, 14270], 150, 100);
    for (const n of [1, 2]) await final("USVTCMP", n, [20265, 4215], [23268, 6980], 90, 160);
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'USVTCMP', 'Inspire', 1, 20265, 'Inspire Award'), (?, 'USVTCMP', 'Think', 1, 4215, 'Think Award')", [S, S]);
    await rebuildSearch();
  });
  const card = async (q: string) => (await askAnswer(q, readAsk(q)!, { prefer: new Set(), ask }))?.card;
  const chips = (h: { teams?: { label: string }[] } | undefined) => h?.teams?.map((t) => t.label);
  it("reads every way of asking it", () => {
    for (const q of ["who won vermont championship north division", "winner of vermont championship north division", "champions of vermont championship north division", "who took vermont championship north division", "who were the champions of vermont championship north division"]) {
      expect(readAsk(q), q).toEqual({ kind: "event-won", event: "vermont championship north division" });
      expect(readStatQuestion(q)?.id, q).toBe("winning-alliance");
    }
    // A measure taken is never an event's winners.
    expect(readAsk("who took the most penalties at vermont championship")).toBeNull();
    expect(readStatQuestion("who took the most penalties at vermont championship")?.id).not.toBe("winning-alliance");
  });
  it("a division with its playoffs and no awards: its champions first, the championship's awards below", async () => {
    const c = await card("who won vermont championship north division");
    expect(c?.none).toBeUndefined();
    expect(c?.champions).toEqual([{ label: "Champions", href: "/events/2025/USVTCMPN", teams: [{ label: "23268 Ultraviolet", href: expect.any(String) }, { label: "6980 Bad Wolf", href: expect.any(String) }], alliance: "red", number: 1 }]);
    expect(c?.event).toEqual({ season: S, code: "USVTCMP", name: "Vermont Championship" });
    expect(c?.awards?.map((a) => a.type)).toEqual(["Inspire", "Think"]);
    for (const q of ["who won vermont championship north division", "champions of vermont championship north division", "who took vermont championship north division"]) {
      const a = await ask(q);
      expect(a.stat?.headline, q).toMatchObject({ value: "Alliance 1", alliance: "red" });
      expect(chips(a.stat?.headline), q).toEqual(["23268 Ultraviolet", "6980 Bad Wolf"]);
    }
  });
  it("the championship: its finals' champions, then each division's winners, and its Inspire Award", async () => {
    const c = await card("who won the vermont championship");
    expect(c?.champions?.map((x) => [x.label, x.number, chips(x)])).toEqual([["Champions", undefined, ["23268 Ultraviolet", "6980 Bad Wolf"]], ["North Division winners", 1, ["23268 Ultraviolet", "6980 Bad Wolf"]]]);
    const a = await ask("who won the vermont championship");
    expect(a.stat?.headline).toMatchObject({ value: "Champions", alliance: "blue" });
    expect(a.stat?.blocks.find((b) => b.kind === "links" && b.title === "Inspire Award")).toMatchObject({ items: [{ label: "20265 Heart of RoBots" }] });
  });
  it("\"this year\" before the event's season: said so, its latest one finished below", async () => {
    const a = await ask("who won vermont championship north division this year");
    expect(a.stat?.none).toBe("Vermont Championship - North Division has no 2026–27 event on record yet. Below: the latest one finished, 2025–26.");
    expect(chips(a.stat?.headline)).toEqual(["23268 Ultraviolet", "6980 Bad Wolf"]);
  });
  it("on the page the division's answer lists its championship's Inspire Award and links its awards", async () => {
    const a = await ask("who won vermont championship north division");
    expect(a.stat?.blocks.find((b) => b.kind === "links" && b.title === "Inspire Award · Vermont Championship")).toMatchObject({ items: [{ label: "20265 Heart of RoBots" }] });
    expect(a.stat?.blocks.find((b) => b.kind === "links" && b.title === "Awards")).toMatchObject({ items: [{ href: "/events/2025/USVTCMP?tab=awards" }] });
    // The first HTML names the champions too, the chips' teams beside their alliance.
    expect((await pageMeta("/search", { q: "who won vermont championship north division" })).bodyHtml).toMatch(/Alliance 1<\/a><\/b>.*23268 Ultraviolet.*6980 Bad Wolf/s);
  });
  it("\"this year\" with this season's event scheduled, not held: said it isn't decided, never that it's missing", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, 'USVTCMP', 'Vermont Championship', 'Championship', 'Burlington', 'VT', 'USA', '2027-03-06', '2027-03-06', 't')");
    const a = await ask("who won vermont championship this year");
    expect(a.stat?.none).toBe("Vermont Championship 2026–27 isn't decided yet (Mar 6, 2027). Below: the latest one finished, 2025–26.");
    expect(a.stat?.headline).toMatchObject({ value: "Champions" });
    await run("DELETE FROM events WHERE season = 2026 AND code = 'USVTCMP'");
  });
  it("an event not held yet has no winners, never another event's", async () => {
    expect(await card("who won vermont maple qualifier")).toBeUndefined();
    const a = await ask("who won vermont maple qualifier");
    expect(a.stat?.headline).toBeUndefined();
    expect(JSON.stringify(a)).not.toContain("23268");
  });
  // Owner: "East Bergen conference inspire award winner" read names and a sorry note.
  it("an event's award asked any way round: the award's winner, its name kept wherever it sits", async () => {
    for (const q of ["vermont championship inspire award winner", "vermont championship inspire", "inspire winner at vermont championship", "who got inspire at vermont championship", "the inspire award winners from vermont championship", "who won inspire at vermont championship"]) {
      expect(await awardQuery(q), q).toBe("who won inspire at vermont championship");
      const a = await ask(q);
      expect(a.card?.kind, q).toBe("event-awards");
      expect(a.card?.lines.map((l) => l.text), q).toEqual(["20265 Heart of RoBots"]);
      expect(a.understood?.label, q).toBe("Who won the Inspire Award at Vermont Championship (2025–26)");
    }
    // Every award word, and the name FIRST's type doesn't spell.
    expect((await ask("vermont championship think award")).card?.lines.map((l) => l.text)).toEqual(["4215 Hypnotic Robotics"]);
    expect((await ask("judges' choice winner vermont championship")).understood?.label).toBe("Who won the Judges' Choice Award at Vermont Championship (2025–26)");
    // A team's awards stay the team's, and an award alone names no event.
    expect(await awardQuery("Heart of RoBots inspire")).toBeNull();
    expect(await awardQuery("4215 inspire at vermont championship")).toBeNull();
    expect(await awardQuery("inspire award")).toBeNull();
  });
  it("a recurring event's award: its latest one given, the season said, the newer one not held yet said too", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, 'USVTCMP', 'Vermont Championship', 'Championship', 'Burlington', 'VT', 'USA', '2027-03-06', '2027-03-06', 't')");
    await rebuildSearch();
    const a = await ask("vermont championship inspire award winner");
    expect(a.card?.lines.map((l) => l.text)).toEqual(["20265 Heart of RoBots"]);
    expect(a.understood?.label).toBe("Who won the Inspire Award at Vermont Championship (2025–26) · The 2026–27 one (Mar 6, 2027) isn't held yet");
    await run("DELETE FROM events WHERE season = 2026 AND code = 'USVTCMP'");
    await rebuildSearch();
  });
  // Greptile on #928: the note is for a newer one without the award, never one that has its winner.
  it("an older year asked, its newer one already given the award: no note that it's missing", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2024, 'USVTCMP', 'Vermont Championship', 'Championship', 'Burlington', 'VT', 'USA', '2025-03-08', '2025-03-08', 't')");
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2024, 'USVTCMP', 'Inspire', 1, 4215, 'Inspire Award')");
    await rebuildSearch();
    const a = await askAnswer("who won inspire at vermont championship 2024-25", readAsk("who won inspire at vermont championship 2024-25")!, { prefer: new Set(), ask });
    expect(a?.card?.lines.map((l) => l.text)).toEqual(["4215 Hypnotic Robotics"]);
    expect(a?.understood?.label).toBe("Who won the Inspire Award at Vermont Championship (2024–25)");
    await run("DELETE FROM awards WHERE season = 2024 AND code = 'USVTCMP'");
    await run("DELETE FROM events WHERE season = 2024 AND code = 'USVTCMP'");
    await rebuildSearch();
  });
  // Failed searches (awards and winners): a season said in words or as one, a short name, and a place asked.
  // Held out: another event, award, season and place than the reports'.
  it("an event's award with its season said anywhere, and a place asked: that season, that place first", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2024, 'USVTCMP', 'Vermont Championship', 'Championship', 'Burlington', 'VT', 'USA', '2025-03-08', '2025-03-08', 't')");
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2024, 'USVTCMP', 'Think', 1, 4215, 'Think Award'), (2024, 'USVTCMP', 'Think', 2, 6980, 'Think Award 2nd Place')");
    await rebuildSearch();
    const prev = `${CURRENT_SEASON - 1}-${String(CURRENT_SEASON % 100).padStart(2, "0")}`;
    expect(await awardQuery("Vermont Championship think 2024-25")).toBe("who won think at vermont championship 2024-25");
    expect(await awardQuery("who won think in vermont championship last year?")).toBe(`who won think at vermont championship ${prev}`);
    expect(await awardQuery("who got think at vermont championship this season")).toBe("who won think at vermont championship");
    expect(await awardQuery("who got second place think at vermont championship 2024-25")).toBe("who won 2nd place think at vermont championship 2024-25");
    const a = await ask("Vermont Championship think 2024-25");
    expect(a.card?.lines.map((l) => l.text)).toEqual(["4215 Hypnotic Robotics", "6980 Bad Wolf"]);
    expect(a.understood?.label).toBe("Who won the Think Award at Vermont Championship (2024–25)");
    const p = await ask("who got second place think at vermont championship 2024-25");
    expect(p.card?.lines.map((l) => l.text)).toEqual(["6980 Bad Wolf", "4215 Hypnotic Robotics"]);
    expect(p.understood?.label).toBe("Who got 2nd place for the Think Award at Vermont Championship (2024–25)");
    expect(p.card?.place).toBe(2);
    // No such place given: every place listed, and said so.
    expect((await ask("who got 3rd place think at vermont championship 2024-25")).understood?.label).toBe("Who got 3rd place for the Think Award at Vermont Championship (2024–25) · No 3rd place recorded");
    // "cham" is "champ" cut short: the state's newest championship, never an older event whose name has it.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2020, 'USVTHYB', 'VT FTC Vermont State Championship HYBRID', 'Championship', 'Burlington', 'VT', 'USA', '2021-03-06', '2021-03-06', 't')");
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2020, 'USVTHYB', 'Think', 1, 6980, 'Think Award')");
    await rebuildSearch();
    const cham = await ask("who won think in vt cham this year");
    expect(cham.card?.event).toMatchObject({ code: "USVTCMP" });
    expect(cham.card?.event?.season).not.toBe(2020);
    await run("DELETE FROM awards WHERE season = 2020 AND code = 'USVTHYB'");
    await run("DELETE FROM events WHERE season = 2020 AND code = 'USVTHYB'");
    await run("DELETE FROM awards WHERE season = 2024 AND code = 'USVTCMP'");
    await run("DELETE FROM events WHERE season = 2024 AND code = 'USVTCMP'");
    await rebuildSearch();
  });
});

describe("the season with none said: one question, one season, whichever reader answers", () => {
  it("reads the current season once anyone is ranked in it, the season before until then", async () => {
    // The season after the fixture's, whatever today is (Greptile on #1166): only the clock's date is faked.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${S + 1}-11-08T12:00:00Z`));
    const now = askSeason();
    expect(now).toBe(S + 1);
    const qs = ["best in New Jersey at the moment", "the strongest in New Jersey rn", "best teams in New Jersey", "top teams in New Jersey"];
    const seasonOf = (a: Awaited<ReturnType<typeof ask>>) => /· (\d{4}–\d{2})/.exec(a.stat?.title ?? a.card?.title ?? "")?.[1];
    const read = async () => {
      const out: string[] = [];
      for (const q of qs) for (const full of [false, true]) out.push(`${q}${full ? " (page)" : ""}: ${seasonOf(await searchAnswer(q, { limit: 25, learn: false, full }))}`);
      return out;
    };
    // Nobody ranked in the current season yet: every reader shows the one before, and says why.
    expect(await read()).toEqual(qs.flatMap((q) => [`${q}: ${seasonLabel(S)}`, `${q} (page): ${seasonLabel(S)}`]));
    // Each one says why: the card's chip, or the short card's own line.
    const why = (a: Awaited<ReturnType<typeof ask>>) => [a.understood?.label ?? "", ...(a.stat?.scope ?? [])].join(" | ");
    for (const q of qs) for (const full of [false, true])
      expect(why(await searchAnswer(q, { limit: 25, learn: false, full })), `${q} ${full}`).toContain(`No ${seasonLabel(now)} ranked teams yet in New Jersey; showing ${seasonLabel(S)}`);
    // Once a team is ranked in the current season, every reader shows it.
    await run("INSERT OR IGNORE INTO team_seasons (season, team) VALUES (?, 6980)", [now]);
    await run(`INSERT OR REPLACE INTO team_season_stats (season, team, opr_np, opr_auto, rank_np, ranked_teams, rating_np, rating_matches, matches, wins, losses, ties)
      VALUES (?, 6980, 90, 30, 1, 1, 95, 10, 10, 8, 2, 0)`, [now]);
    // New data, as a sync says it: the rankings' lists are kept by data version.
    await kvSet("data:version", `season-test-${now}`);
    try {
      expect(await read()).toEqual(qs.flatMap((q) => [`${q}: ${seasonLabel(now)}`, `${q} (page): ${seasonLabel(now)}`]));
      for (const q of qs) expect(why(await searchAnswer(q, { limit: 25, learn: false })), q).not.toContain("ranked teams yet");
    } finally {
      await run("DELETE FROM team_season_stats WHERE season = ?", [now]);
      await run("DELETE FROM team_seasons WHERE season = ?", [now]);
      await kvSet("data:version", `season-test-${now}-done`);
      vi.useRealTimers();
    }
  });
});
