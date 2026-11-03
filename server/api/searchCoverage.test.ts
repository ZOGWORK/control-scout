// Phrasings that used to end on "no results" (server/api/searchCoverage.ts): each is said the way a reader already
// answers, or answered on its own. Every number is from the fixture.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { explainAnswer, placeTeamsAnswer, rewriteQuery, teamListAnswer } from "./searchCoverage";
import { CURRENT_SEASON } from "../data/seasons";

const S = 2025;
const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, city, state, country, rookie year, [opr, wins, losses] last season, [opr, wins, losses] this season
  const teams: [number, string, string, string | null, string, number, [number, number, number], [number, number, number]][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", "USA", 2009, [120, 20, 4], [101.6, 26, 6]],
    [6980, "Bad Wolf", "Oradell", "NJ", "USA", 2013, [40, 5, 15], [130, 20, 0]],
    [23268, "Ultraviolet", "Hackettstown", "NJ", "USA", 2023, [90, 12, 8], [157.9, 33, 17]],
    [14270, "Quantum Robotics", "Bucharest", null, "Romania", 2018, [150, 30, 5], [200, 40, 2]],
    [25920, "Cheetahs", "Lassalle", "ON", "Canada", 2024, [20, 2, 10], [60, 10, 10]],
  ];
  for (const [n, name, city, state, country, rookie, before, now] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year, school) VALUES (?, ?, ?, ?, ?, ?, ?)", [n, name, city, state, country, rookie, `${city} High School`]);
    for (const [season, [opr, w, l]] of [[S - 1, before], [S, now]] as const) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [season, n]);
      await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, rank_np, ranked_teams, rating_np, rating_matches, matches, wins, losses, ties)
        VALUES (?, ?, ?, 0, null, 5, ?, 10, ?, ?, ?, 0)`, [season, n, opr, opr, w + l, w, l]);
    }
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'FTCCMP1', 'FIRST Championship', 'FIRSTChampionship', 'Houston', 'TX', 'USA', '2026-04-30', '2026-05-02', 't')", [S]);
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'FTCCMP1EDIS', 'FIRST Championship - Edison Division', 'FIRSTChampionship', 'Houston', 'TX', 'USA', '2026-04-30', '2026-05-02', 't')", [S]);
  await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'FTCCMP1', 'Winner', 1, 14270, 'Winning Alliance - Captain'), (?, 'FTCCMP1', 'Inspire', 1, 4215, 'Inspire Award')", [S, S]);
  await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'FTCCMP1EDIS', 'Winner', 1, 6980, 'Winning Alliance - Captain')", [S]);
  await rebuildSearch();
});

describe("rewrites: said the way a reader answers", () => {
  it("two teams, however they're compared", () => {
    for (const q of ["compare 4215 and 6980", "is 4215 better than 6980", "which is better 4215 or 6980", "4215, 6980", "4215 & 6980"]) expect(rewriteQuery(q)?.q, q).toBe("4215 vs 6980");
    expect(rewriteQuery("who would win between 4215 and 6980")?.q).toBe("4215 vs 6980 who wins");
    expect(rewriteQuery("4215 2024")).toBeNull(); // a team and a year, never two teams
    // Review gaps (11-03): each said the way people ask it, read before the stat answers where those would misread it.
    for (const q of ["have 4215 and 6980 played each other", "have 4215 and 6980 ever played", "has 4215 played 6980", "did 4215 ever face 6980"]) expect(rewriteQuery(q), q).toMatchObject({ q: "4215 vs 6980 head to head", pre: true });
    expect(rewriteQuery("4215 record at nj states")).toMatchObject({ q: "4215 record at New Jersey championship", pre: true });
    expect(rewriteQuery("4215 match 12 at nj states")?.q).toBe("4215 match 12 at New Jersey championship");
    expect(rewriteQuery("4215 at nj states")?.q).toBe("4215 at New Jersey championship");
    expect(rewriteQuery("4215 penalties")?.q).toBe("4215 penalty points given");
    expect(rewriteQuery("4215 no shows")).toMatchObject({ q: "4215 reliability", note: expect.stringMatching(/no-shows/) });
    expect(rewriteQuery("4215 best match")).toMatchObject({ q: "4215 highest score", note: expect.stringMatching(/highest-scoring/) });
    expect(rewriteQuery("4215 worst match")?.q).toBe("4215 lowest score");
    expect(rewriteQuery("4215 best event")?.q).toBe("4215 best finish");
    expect(rewriteQuery("4215 partners")?.q).toBe("4215 most frequent partner");
    expect(rewriteQuery("4215 opponents")?.q).toBe("4215 most played opponent");
    expect(rewriteQuery("4215 events this season")?.q).toMatch(/^4215 events in 20\d\d-\d\d$/);
    expect(rewriteQuery("4215 world rank")).toMatchObject({ q: "4215 opr", note: expect.stringMatching(/world rank by OPR/) });
    expect(rewriteQuery("4215 nj rank")?.q).toBe("4215 rank in New Jersey");
    expect(rewriteQuery("4215 win probability next match")?.q).toBe("will 4215 win their next match");
    for (const q of ["connect award nj states", "design award winners nj states", "motivate award at nj states"]) expect(rewriteQuery(q)?.q, q).toMatch(/^who won (?:connect|design|motivate) at nj states$/);
    expect(rewriteQuery("who won motivate at nj states")).toBeNull(); // already the asks' own form
    expect(rewriteQuery("6980 texas")).toMatchObject({ q: "6980", note: expect.stringMatching(/"Texas" is left out/) });
    // Never a team's own name: "4215 new jersey" names a place, "4215 robots" doesn't.
    expect(rewriteQuery("4215 robots")).toBeNull();
    expect(rewriteQuery("2024 4215")).toBeNull();
    expect(rewriteQuery("42155")).toBeNull();
  });
  it("a team's history, worlds and states, asked with no verb", () => {
    expect(rewriteQuery("4215 worlds")?.q).toBe("when did 4215 go to worlds");
    expect(rewriteQuery("bad wolf states")?.q).toBe("when did bad wolf go to states");
    expect(rewriteQuery("the bad wolf worlds")?.q).toBe("when did the bad wolf go to worlds");
    for (const q of ["the worlds", "the first championship"]) expect(rewriteQuery(q)?.q ?? "", q).not.toMatch(/^when did/);
    // A place's championship, a match at one, and a question with its own verb are left to their readers.
    for (const q of ["nj states", "OR states", "new jesey states", "qual 5 nj states", "will 4215 advance to states", "all state championships"]) expect(rewriteQuery(q)?.q ?? "", q).not.toMatch(/^when did/);
  });
  it("winners, by a game's name or a division", () => {
    expect(rewriteQuery("decode champions")).toMatchObject({ q: "who won worlds 2025-26" });
    expect(rewriteQuery("franklin division winners")?.q).toBe("who won franklin division");
    expect(rewriteQuery("nj states winners")?.q).toBe("who won nj states");
  });
  it("scope words that say nothing more are dropped", () => {
    expect(rewriteQuery("best teleop in the world")?.q).toBe("best teleop");
    expect(rewriteQuery("top ranked team")?.q).toBe("top teams");
  });
});

describe("answers on their own", () => {
  it("a word explained, with the page that explains it", () => {
    expect(explainAnswer("what is opr")?.card).toMatchObject({ kind: "info" });
    expect(explainAnswer("what is decode")?.understood?.label).toMatch(/^DECODE: the 2025–26 FTC game/);
    expect(explainAnswer("4215")).toBeNull();
    // "help": what the box answers, each with a query to try; a team named "helpers" is still a name.
    for (const q of ["help", "how do i search", "what can i search for"]) expect(explainAnswer(q)?.understood?.label, q).toBe("What you can search");
    expect(explainAnswer("help")?.card?.lines.every((l) => l.href?.startsWith("/search?q="))).toBe(true);
    expect(explainAnswer("helpers")).toBeNull();
  });
  it("a rewrite never loops, and a nonsense query still ends in a recovery", async () => {
    expect((await ask("qual 5 nj states")).step).toBeDefined();
    expect((await ask("asdfgh")).step).toBe("recovery");
  });
  it("who won Worlds: a year is the one held that year, said as its season", () => {
    expect(rewriteQuery("who won worlds 2025")?.q).toBe("who won worlds 2024-25");
    expect(rewriteQuery("worlds winners 2026")?.q).toBe("who won worlds 2025-26");
    // "Last year" is the stat answer's (the latest finished championship), never rewritten to a calendar year.
    expect(rewriteQuery("who won worlds last year")).toBeNull();
  });
  it("an award at Worlds: the main event's, never a division's", async () => {
    const a = await ask("who won inspire at worlds");
    expect(a.card?.lines.map((l) => l.text)).toEqual(["4215 Hypnotic Robotics"]);
    expect(a.hits[0]).toMatchObject({ ref: `${S}:FTCCMP1` });
  });
  it("a country's best teams, by OPR", async () => {
    const a = await ask("best teams in romania");
    expect(a.card?.lines.map((l) => l.text)).toEqual(["14270 Quantum Robotics"]);
    // The number asked for: the USA has three ranked teams here.
    expect((await teamListAnswer("top 2 teams in usa"))?.card?.lines.map((l) => l.text)).toEqual(["23268 Ultraviolet", "6980 Bad Wolf"]);
  });
  it("undefeated teams and the highest win rate", async () => {
    expect((await ask("undefeated teams")).card?.lines.map((l) => l.text)).toEqual(["6980 Bad Wolf"]);
    const w = await ask("teams with the highest win rate");
    // The link opens the season the numbers are from.
    expect(w.card?.lines[0]).toMatchObject({ text: "6980 Bad Wolf", results: ["#1", "100% wins", "20-0-0", "OPR 130.0"], href: `/teams/6980?season=${S}` });
  });
  it("most improved: by OPR standing season to season, never raw OPR", async () => {
    // The stat answers (./answers) take "most improved teams" first; this is the list when they don't.
    const a = (await teamListAnswer("most improved teams"))!;
    // Bad Wolf: 4th of 5 → 3rd of 5; Ultraviolet: 3rd → 2nd. Quantum and 4215 fell or held; Cheetahs held last.
    expect(a.card?.lines.map((l) => l.text)).toEqual(["6980 Bad Wolf", "23268 Ultraviolet"]);
    expect(a.understood?.label).toMatch(/never raw OPR across seasons/);
  });
  it("a team's school, from the team's own record", async () => {
    const a = await ask("4215 school");
    expect(a.card?.kind).toBe("info");
    expect(a.card?.lines[0]?.text).toMatch(/Oradell High School/);
    // The card names the fact only (its team rides on card.team), so the page title never names the team twice.
    expect(a.card?.title).not.toMatch(/4215/);
    expect(a.card?.team?.number).toBe(4215);
    expect(a.understood?.label).toMatch(/\(4215\) · /);
  });
  it("several facts at once: each on its own line (failed-search #489)", async () => {
    // In the order asked.
    for (const q of ["4215 sponsors school", "4215 sponsors, school", "4215 sponsors and school"]) {
      const a = await ask(q);
      expect(a.card?.title).toBe("Sponsors and School or organization");
      expect(a.card?.lines.map((l) => l.text.split(":")[0])).toEqual(["Sponsors", "School or organization"]);
      expect(a.card?.lines[1]?.text).toMatch(/Oradell High School/);
    }
    expect((await ask("4215 school, website")).card?.title).toBe("School or organization and Website");
  });
  it("when a team last played: its most recent match (failed-search #487)", async () => {
    expect(rewriteQuery("when did hypnotic last play")).toMatchObject({ q: "hypnotic last match", pre: true });
    expect(rewriteQuery("when did 4215 play last")).toMatchObject({ q: "4215 last match" });
    expect(rewriteQuery("when did hypnotic robotics last compete")).toMatchObject({ q: "hypnotic robotics last match" });
    // Its answer is the most recent match, and "last" isn't called a word left out.
    const a = await ask("when did 4215 last play");
    expect(a.stat?.intent).toBe("recent-match");
    expect(a.understood?.label ?? "").not.toMatch(/isn't part of this answer/);
  });
  it("a country's teams by an alias, and 'best team' left to the leaderboards", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (31000, 'Lions', 'Leeds', NULL, 'United Kingdom')");
    expect((await ask("teams in great britain")).understood?.label).toMatch(/^Teams in United Kingdom/);
    expect((await ask("best team")).understood?.label ?? "").not.toMatch(/^Teams in/);
  });
  it("teams in a town", async () => {
    // "near" reads as "in", said so; the stat answers list a town's teams first, this when they don't.
    expect(rewriteQuery("teams near oradell")).toMatchObject({ q: "teams in oradell", note: expect.stringMatching(/"near" reads as "in"/) });
    expect((await ask("teams near oradell")).understood?.label).toMatch(/"near" reads as "in"/);
    const a = (await placeTeamsAnswer("teams in oradell", new Set()))!;
    expect(a.hits.map((h) => h.ref).sort()).toEqual(["4215", "6980"]);
  });
});

describe("Greptile on #465", () => {
  it("a state code keeps its capitals: 'OR' is Oregon", async () => {
    const a = await ask("how many teams in OR");
    expect(a.understood?.label).toMatch(/Oregon/);
    expect(a.card?.count).toBeUndefined(); // a count of teams, never "N times"
    expect(a.pages[0]?.href).toMatch(/&country=US&state=OR$/); // the teams counted, as Teams filters them
  });
  it("a month's events: its own count, August in the season's second year, and a month with none said so", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNJQ1', 'March Qualifier', 'Qualifier', 'Union', 'NJ', 'USA', '2026-03-07', '2026-03-07', 't')", [S]);
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNJAUG', 'August Scrimmage', 'Scrimmage', 'Union', 'NJ', 'USA', ?, ?, 't')", [CURRENT_SEASON, `${CURRENT_SEASON + 1}-08-05`, `${CURRENT_SEASON + 1}-08-05`]);
    await rebuildSearch();
    const march = await ask("events in march 2026");
    expect(march.hits.map((h) => h.title)).toEqual(["March Qualifier"]);
    expect(march.understood?.total).toBe(1);
    expect((await ask("events in august")).hits.map((h) => h.title)).toEqual(["August Scrimmage"]);
    const feb = await ask("events in february 2026");
    expect(feb.step).toBe("recovery");
    expect(feb.understood?.label).toMatch(/no events on record in february 2026$/i);
    // A year with no events at all: other years' events are still offered.
    expect((await ask("events in march 2031")).recovery?.closest?.length).toBeGreaterThan(0);
  });
  it("'state championships' are the states' own, never Worlds", async () => {
    const a = await ask("state championships");
    expect(a.understood?.label).toMatch(/^State championships/);
    expect(a.hits.some((h) => /FIRST Championship/.test(h.title))).toBe(false);
  });
  it("a team named with a state it isn't in is never said to be in it", async () => {
    expect((await ask("hypnotic robotics texas")).understood?.label ?? "").not.toMatch(/Texas/);
  });
});
