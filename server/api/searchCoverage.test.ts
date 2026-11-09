// Phrasings that used to end on "no results" (server/api/searchCoverage.ts): each is said the way a reader already
// answers, or answered on its own. Every number is from the fixture.
import { beforeAll, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { explainAnswer, explainTeamAnswer, placeTeamsAnswer, rewriteQuery, teamListAnswer } from "./searchCoverage";
import { CURRENT_SEASON } from "../data/seasons";
import { pageMeta } from "../seoMeta";
import { seasonLabel } from "../../src/shared/format";

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
  // Failed-search #797, #798, #1039, #920, #922, #882, #878: the issues' own words.
  it("a team's quality or a showing asked in plain words, with its asides", () => {
    const cases: [string, string][] = [
      ["how good is 7149 really, like in plain numbers, in 2025-26", "how good is 7149 in 2025-26"],
      ["is 23268 actually that good or just hype, in 2025-26", "how good is 23268 in 2025-26"],
      ["is 23268 actually that good or just hype", "how good is 23268"],
      ["whats up with ultraviolet, are they cracked", "how good is ultraviolet"],
      ["can u tell me if bad wolf is good", "how good is bad wolf"],
      ["can u tell me if bad wolf is good, be honest", "how good is bad wolf"],
      ["did hypnotic robotics choke at states or nah", "how did hypnotic robotics do at states"],
      ["show me 7149 in 2023, if they played then", "7149 in 2023"],
    ];
    for (const [q, out] of cases) expect(rewriteQuery(q), q).toMatchObject({ q: out, pre: true });
    // Anything after the quality word, two teams, an event or a game's name is another question.
    for (const q of ["is 4215 good at auto", "is 4215 better than 6980", "whats up with decode", "whats up with nj states", "how good is 4215"]) expect(rewriteQuery(q)?.q ?? "", q).not.toMatch(/^how good is/);
  });
  it("a team's quality in plain words gets its season's numbers", async () => {
    for (const q of ["is 23268 actually that good or just hype", "can u tell me if bad wolf is good, be honest"]) {
      const a = await ask(q);
      expect(a.step, q).toBe("deterministic");
      expect(a.hits[0], q).toMatchObject({ kind: "team", ref: q.includes("23268") ? "23268" : "6980" });
      expect(a.hits[0].facts?.map((f) => f.label), q).toEqual(expect.arrayContaining(["OPR", "Record"]));
    }
    // A past season said with the question is that season's numbers, never the latest's (fixture: 90 OPR, 12-8 then).
    const past = await ask(`is 23268 actually that good or just hype, in ${S - 1}-${String(S % 100).padStart(2, "0")}`);
    const facts = Object.fromEntries((past.hits[0].facts ?? []).map((f) => [f.label, f.value]));
    expect(past.hits[0]).toMatchObject({ ref: "23268", linkSeason: S - 1 });
    expect(facts).toMatchObject({ OPR: "90.0", Record: "12-8-0", Season: seasonLabel(S - 1) });
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
    // A country by its people's word: its teams by OPR on the answer page.
    const word = await searchAnswer("best romanian teams", { limit: 25, learn: false, full: true });
    expect(word.stat?.title).toMatch(/^Top 10 teams by OPR in Romania · /);
    // The number asked for: the USA has three ranked teams here.
    expect((await teamListAnswer("top 2 teams in usa"))?.card?.lines.map((l) => l.text)).toEqual(["23268 Ultraviolet", "6980 Bad Wolf"]);
  });
  it("undefeated teams and the highest win rate", async () => {
    // Undefeated is a leaderboard filter the pipeline applies (server/api/query/): no losses, the most wins first.
    const u = (await ask("undefeated teams")).stat?.blocks[0];
    expect(u?.kind === "leaderboard" ? u.rows.map((r) => r.team.label) : u).toEqual(["6980 Bad Wolf"]);
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
      expect(a.card?.title).toBe("Sponsors and school");
      expect(a.card?.lines.map((l) => l.text.split(":")[0])).toEqual(["Sponsors", "School or organization"]);
      expect(a.card?.lines[1]?.text).toMatch(/Oradell High School/);
    }
    expect((await ask("4215 school, website")).card?.title).toBe("School and website");
    // A two-word fact can come first.
    expect((await ask("4215 rookie year website")).card?.title).toBe("Rookie year and website");
    // A team whose name ends in a fact word is read whole first: "Code Site"'s website, not "Code"'s site and website.
    await run("INSERT INTO teams (number, name, website) VALUES (31010, 'Code', 'https://code.example'), (31011, 'Code Site', 'https://codesite.example')");
    await rebuildSearch();
    const s = await ask("code site website");
    expect(s.card?.team?.number).toBe(31011);
    expect(s.card?.title).toBe("Website");
  });
  it("a team name and a place no one team has together: the place's, or plainly none there (failed-search #503)", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (31020, 'Robo Rebels', 'Troy', 'MI', 'USA'), (31021, 'Robo Rebels', 'Fremont', 'CA', 'USA')");
    await rebuildSearch();
    const none = await ask("robo rebels nj");
    expect(none.hits.map((h) => h.ref).sort()).toEqual(["31020", "31021"]);
    expect(none.understood?.label).toBe("No team named Robo Rebels in New Jersey: all 2 by that name");
    const mi = await ask("robo rebels michigan");
    expect(mi.hits.map((h) => h.ref)).toEqual(["31020"]);
    expect(mi.understood?.label).toBe("The team named Robo Rebels in Michigan");
    // Every team by the name counts, however many share it: the one in the place is never cut off by a result cap.
    const many = Array.from({ length: 30 }, (_, i) => `(${32000 + i}, 'Gear Heads', 'Austin', 'TX', 'USA')`).join(", ");
    await run(`INSERT INTO teams (number, name, city, state, country) VALUES ${many}, (32099, 'Gear Heads', 'Flint', 'MI', 'USA')`);
    // A team with no city on record is still in its state.
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (32100, 'Lone Gear', NULL, 'NJ', 'USA')");
    await rebuildSearch();
    const gh = await ask("gear heads michigan");
    expect(gh.hits.map((h) => h.ref)).toEqual(["32099"]);
    expect((await ask("lone gear nj")).understood?.label).toBe("The team named Lone Gear in New Jersey");
    // A name read as search reads it, accents folded: "cafe" finds "Café".
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (32101, 'Cafe Robotics', 'Austin', 'TX', 'USA'), (32102, 'Café Robotics', 'Newark', 'NJ', 'USA')");
    await rebuildSearch();
    expect((await ask("cafe robotics nj")).hits.map((h) => h.ref)).toEqual(["32102"]);
    // The same with "in" or "from" before the place: the local team leads, never cut off, accents folded.
    for (const [q, team] of [["gear heads from michigan", "32099"], ["gear heads in michigan", "32099"], ["cafe robotics in new jersey", "32102"], ["cafe robotics from nj", "32102"]]) {
      expect((await ask(q)).hits[0]?.ref, q).toBe(team);
    }
    // A team asked for by its number stays that team; one found past the hits listed opens on the season asked for.
    expect((await ask("32000 in michigan")).hits[0]?.ref).toBe("32000");
    const last = await ask("gear heads from michigan last season");
    expect(last.hits[0]?.ref).toBe("32099");
    expect(last.hits[0]?.linkSeason).toBe((await ask("gear heads last season")).hits[0]?.linkSeason);
    expect(last.hits[0]?.linkSeason).toBeDefined();
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
    // It may say plainly that none is there, never that it is.
    const label = (await ask("hypnotic robotics texas")).understood?.label ?? "";
    expect(label.replace(/^No team named .+? in Texas/, "")).not.toMatch(/Texas/);
  });
});

describe("a list of teams as a table", () => {
  beforeAll(async () => {
    // The phases each team page shows (team_season_stats), set here so the table has numbers to read.
    await run("UPDATE team_season_stats SET opr_auto = opr_np / 4, opr_teleop = opr_np / 2, opr_endgame = 10, opr_pen = 2.5 WHERE season = ?", [S]);
  });
  it("a place's teams: a row per team with the stored phase OPRs, in the list's order", async () => {
    const a = (await placeTeamsAnswer("teams in new jersey", new Set()))!;
    const t = a.card!.table!;
    expect(t.by).toBe("opr");
    // From 2024–25 on the stored TeleOp OPR includes the endgame (as FIRST reports it): said so, never called DC.
    expect(t.teleopWithEndgame).toBe(true);
    expect(t.rows.map((r) => r.team)).toEqual(a.card!.lines.map((l) => Number(l.text.split(" ")[0])));
    expect(t.rows[0]).toMatchObject({ rank: 1, team: 23268, name: "Ultraviolet", location: "Hackettstown, NJ", href: `/teams/23268?season=${S}`, opr: 157.9, auto: 39.475, dc: 78.95, endgame: 10, pen: 2.5, wins: 33, losses: 17, ties: 0 });
    // The header context line is the same as before.
    expect(a.understood?.label).toMatch(/registered for .*, best by OPR first$/);
  });
  it("a list ranked by another number carries it as its own column, in its own order", async () => {
    const w = (await ask("teams with the highest win rate")).card!.table!;
    expect(w).toMatchObject({ by: "rank", asked: { label: "Win rate" } });
    expect(w.rows[0]).toMatchObject({ team: 6980, asked: { display: "100%" } });
    expect((await ask("best teams in romania")).card!.table!.rows[0]).toMatchObject({ team: 14270, dc: 100 });
  });
  it("a single team's answer keeps its card, with no table", async () => {
    const a = await ask("4215 school");
    expect(a.card?.kind).toBe("info");
    expect(a.card?.table).toBeUndefined();
  });
  it("the first paint carries the whole table, no script needed", async () => {
    const m = await pageMeta("/search", { q: "teams in new jersey" });
    const html = m.bodyHtml ?? "";
    expect(html).toMatch(/<table aria-label="Teams in New Jersey · best by OPR, [^"]+"><thead><tr><th scope="col">#<\/th><th scope="col">Team<\/th><th scope="col" title="[^"]+">OPR<\/th><th scope="col" title="[^"]+">Auto<\/th><th scope="col" title="Driver-controlled OPR, endgame included[^"]+">TeleOp<\/th><th scope="col" title="[^"]+">Endgame<\/th><th scope="col" title="[^"]+">Pen<\/th><th scope="col" title="[^"]+">W-L-T<\/th><\/tr><\/thead>/);
    expect(html).toContain(`<tr><td>1</td><td><a href="/teams/23268?season=${S}">23268 Ultraviolet</a><br><small>Hackettstown, NJ</small></td><td>157.9</td><td>39.5</td><td>79.0</td><td>10.0</td><td>2.5</td><td>33-17-0</td></tr>`);
    expect(html).toContain("don't add up to the OPR");
  });
});

describe("wrong answers from the 92-query probe (11-03)", () => {
  it("rewrites: three or four teams compared, a season's leaderboard, an event's best score, a rookie list", () => {
    for (const q of ["compare 4215 6980 23268", "compare 4215 and 6980 and 23268", "compare 4215 6980 and 23268"]) expect(rewriteQuery(q)?.q, q).toBe("4215 vs 6980 vs 23268");
    expect(rewriteQuery("compare 4215 6980")?.q).toBe("4215 vs 6980");
    expect(rewriteQuery("compare 4215 2024")).toBeNull(); // a team and a year, never two teams
    expect(rewriteQuery("compare 1 2 3 4 5")).toBeNull(); // Compare holds four
    // A name may hold "and": never split into teams (Greptile on #513). Two names are the two-team rule's.
    expect(rewriteQuery("compare nuts and bolts and 4215")?.q).not.toBe("nuts vs bolts vs 4215");
    expect(rewriteQuery("compare hypnotic and bad wolf")?.q).toBe("hypnotic vs bad wolf");
    // Joined by "and", a number like a year is a team: none dropped.
    expect(rewriteQuery("compare 4215 and 2024 and 6980")?.q).toBe("4215 vs 2024 vs 6980");
    expect(rewriteQuery("top opr last season")).toMatchObject({ q: "top 10 teams by opr last season", pre: true });
    expect(rewriteQuery("best auto opr in nj 2024-25")?.q).toBe("top 10 teams by auto opr in New Jersey 2024-25");
    expect(rewriteQuery("top opr in narnia last season")).toBeNull(); // no such place: never a list of somewhere else
    expect(rewriteQuery("highest score new jersey championship")).toMatchObject({ q: "highest score at new jersey championship", pre: true });
    expect(rewriteQuery("nj states highest score")?.q).toBe("highest score at new jersey championship");
    expect(rewriteQuery("highest score at nj states")?.q).toBe("highest score at new jersey championship");
    expect(rewriteQuery("highest score at worlds")?.q).toBe("highest score at first championship");
    expect(rewriteQuery("highest score this season")?.q).not.toMatch(/ at /); // no event named
    expect(rewriteQuery("4215 highest score")).toBeNull();
    expect(rewriteQuery("rookie teams new jersey")?.q).toBe("rookie teams in new jersey");
    expect(rewriteQuery("nj rookie teams")?.q).toBe("rookie teams in new jersey");
    // An event named with a game's name: that game's season, written as one (Sushil's screenshots, 11-03).
    expect(rewriteQuery("nj states decode")).toMatchObject({ q: "nj states 2025-26", pre: true });
    expect(rewriteQuery("decode nj states")?.q).toBe("nj states 2025-26");
    expect(rewriteQuery("worlds edison division centerstage")?.q).toBe("worlds edison division 2023-24");
    // A word that names an event with "division" after it, and a game (failed-search #787): that season's division.
    expect(rewriteQuery("edison centerstage", new Set(["division:edison"]))).toMatchObject({ q: "edison division 2023-24", pre: true });
    expect(rewriteQuery("edison centerstage")).toBeNull(); // no event by that name with "division": left to search
    // A team's matches at its latest meet (owner's screenshots, 11-08): its latest event, never an event named so.
    for (const q of ["6980 matches at recent meet", "6980 matches at their most recent meet", "bad wolf matches at the last event"])
      expect(rewriteQuery(q), q).toMatchObject({ q: `${q.split(" matches")[0]} matches at their last event`, pre: true });
    expect(rewriteQuery("4215 matches at their last event")).toBeNull(); // already read so
    // How a team did there, asked as a question or with a (misspelled) word for its showing (failed-search #1244, #1245).
    expect(rewriteQuery("how did enforcers do in thier recent meet")).toMatchObject({ q: "enforcers matches at their last event", note: "their latest event", pre: true });
    for (const q of ["enforcers last meet performence", "enforcers last meet perforomance"])
      expect(rewriteQuery(q), q).toMatchObject({ q: "enforcers matches at their last event", note: "their latest event", pre: true });
    expect(rewriteQuery("enforcers last meet")).toBeNull(); // no word for a showing: left to search
    // A kind of event said keeps its limit: never the latest event of any kind (Greptile on #1197).
    expect(rewriteQuery("6980 matches at their last qualifier")).toBeNull();
    expect(rewriteQuery("nj states into the deep")?.q).toBe("nj states 2024-25");
    expect(rewriteQuery("nj states highest score decode")?.q).toBe("highest score at new jersey championship 2025-26");
    expect(rewriteQuery("highest score at nj states 2024-25")?.q).toBe("highest score at new jersey championship 2024-25");
    expect(rewriteQuery("what is decode")).toBeNull(); // a game alone is explained, not an event
    expect(rewriteQuery("4215 decode")?.q).toBe("4215 in DECODE"); // a team's season, as before
    // "me" is never a place (it read as Maine), and a bare "teams" near me is nearMeAnswer's.
    expect(rewriteQuery("teams near me")).toBeNull();
    expect(rewriteQuery("events near me")).toBeNull();
    expect(rewriteQuery("teams near hackettstown")?.q).toBe("teams in hackettstown");
  });
  it("a count of a season named: that season's, never teams named Spark team", async () => {
    const a = await ask("how many teams 2024");
    expect(a.card?.title).toBe(`How many teams · ${seasonLabel(2024)}`);
    expect(a.card?.lines[0].text).toBe(`5 teams registered in ${seasonLabel(2024)}`);
    expect(a.hits).toEqual([]);
    expect((await ask("how many teams last season")).card?.title).toBe(`How many teams · ${seasonLabel(CURRENT_SEASON - 1)}`);
    expect((await ask("how many teams in 2024-25")).card?.title).toBe(`How many teams · ${seasonLabel(2024)}`);
  });
  it("a count of events in a bare year: the calendar year, from both seasons, as event searches read it", async () => {
    // An event held in January 2026 belongs to 2025–26; one in October 2026 to 2026–27. 2026 counts both.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'YEARJAN', 'January Qualifier', 'Qualifier', 'Edison', 'NJ', 'USA', '2026-01-10', '2026-01-10', 't'), (?, 'YEAROCT', 'October Qualifier', 'Qualifier', 'Edison', 'NJ', 'USA', '2026-10-10', '2026-10-10', 't')", [S, S + 1]);
    const held = async (sql: string, args: number[]) => Number((await get<{ n: number }>(`SELECT COUNT(*) n FROM events WHERE ${sql}`, args))?.n);
    const y = await ask("how many events in 2026");
    expect(y.card?.title).toBe("How many events · 2026");
    expect(y.card?.lines[0]).toMatchObject({ text: `${await held("substr(start, 1, 4) = '2026'", [])} events in 2026`, href: "/search?q=events%20in%202026" });
    expect(y.card?.lines[0].text).not.toBe(`${await held("season = ?", [2026])} events in 2026`);
    // The current season's spring is the next calendar year: its events count; a season after the current one doesn't.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'YEARNEXT', 'Spring Qualifier', 'Qualifier', 'Edison', 'NJ', 'USA', ?, ?, 't')", [CURRENT_SEASON, `${CURRENT_SEASON + 1}-02-01`, `${CURRENT_SEASON + 1}-02-01`]);
    expect((await ask(`how many events in ${CURRENT_SEASON + 1}`)).card?.lines[0].text).toBe(`${await held(`substr(start, 1, 4) = '${CURRENT_SEASON + 1}'`, [])} events in ${CURRENT_SEASON + 1}`);
    expect((await ask(`how many teams in ${CURRENT_SEASON + 1}`)).card?.title ?? "").not.toMatch(/^How many teams/);
    // A country's year: counted by country, linked to the event list (the event search reads states, not countries).
    expect((await ask("how many events in romania in 2026")).card?.lines[0].href).toBe("/events");
    // A season written as one is that season, January and April included, October not.
    expect((await ask("how many events in 2025-26")).card?.lines[0].text).toBe(`${await held("season = ?", [S])} events in ${seasonLabel(S)}`);
  });
  it("how OPR is calculated: the definition, never a team with 'calculated' in its name", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (30628, 'CALculated Risk', 'Austin', 'TX', 'USA')");
    await rebuildSearch();
    const a = await ask("how is opr calculated");
    expect(a.card).toMatchObject({ kind: "info", title: "OPR: what it is and how it's worked out" });
    expect(a.hits).toEqual([]);
  });
  it("near me: where you are isn't known, said plainly, with no names that happen to match", async () => {
    for (const q of ["teams near me", "events near me", "events nearby"]) {
      const a = await ask(q);
      expect(a.card?.kind, q).toBe("info");
      expect(a.card?.title, q).toMatch(/^Where you are isn't known/);
      expect(a.hits, q).toEqual([]);
    }
  });
  it("the bottom of a list: said plainly, with the full ranking linked", async () => {
    // "Lowest" and "worst" are the pipeline's own list, lowest first (server/api/query/execute.test.ts); "bottom" is this card.
    const a = await ask("bottom opr new jersey");
    expect(a.card).toMatchObject({ kind: "info", title: "Search lists teams from the top, not the bottom" });
    // The stat asked, lowest first: OPR on the Teams page's season table, never Rankings (which is by prediction rating).
    expect(a.card?.lines[0]).toMatchObject({ text: "Every ranked team in New Jersey by OPR, lowest first" });
    expect(a.card?.lines[0].href).toMatch(/^\/teams\?view=season&.*sort=totalPointsNpOpr.*&dir=asc$/);
    expect((await ask("bottom auto opr")).card?.lines[0].href).toMatch(/sort=autoPointsOpr.*&dir=asc$/);
    // "Worst teams" is the prediction rating's, as "top teams" is: Rankings, said to be by that rating.
    const w = await ask("bottom teams");
    expect(w.card?.title).toBe("Search lists teams from the top, not the bottom");
    expect(w.card?.lines[0]).toMatchObject({ text: "Every ranked team, by prediction rating", href: expect.stringMatching(/^\/rankings\?season=/) });
    expect((await ask("4215 lowest score")).card?.title).not.toBe("Search lists teams from the top, not the bottom");
  });
  it("three teams compared: all three, none dropped", async () => {
    for (const q of ["compare 4215 6980 23268", "compare 4215, 6980 and 23268", "compare 4215 and 6980 and 23268"]) {
      expect((await ask(q)).hits[0], q).toMatchObject({ kind: "compare", ref: "4215,6980,23268" });
    }
  });
  it("a past season's leaderboard: that season's numbers", async () => {
    const a = await ask("top opr in nj 2024-25");
    // 2024–25: 4215 (120) led New Jersey; the fixture's later season has Ultraviolet first.
    expect(a.stat?.title).toMatch(new RegExp(`${seasonLabel(2024)}$`));
    expect(a.stat?.headline?.value).toBe("4215 Hypnotic Robotics");
  });
});

describe("team facts, the profile and how-it-works answers (260-query list, 11-04)", () => {
  beforeAll(async () => {
    await run("UPDATE teams SET home_region = 'USNJ' WHERE number IN (4215, 6980)");
    // FIRST lists no school for this one.
    await run("INSERT INTO teams (number, name, city, state, country, home_region) VALUES (33950, 'First Street Kids', 'Ridgewood', 'NJ', 'USA', 'USNJ')");
    await rebuildSearch();
  });
  const fact = async (q: string) => (await ask(q)).card;
  it("a team's name, said as a question (6, 14)", async () => {
    for (const [q, name] of [["what is team 4215 called", "Hypnotic Robotics"], ["what is team 6980 called", "Bad Wolf"], ["what is the name of team 4215", "Hypnotic Robotics"]]) {
      const c = await fact(q);
      expect(c?.facts?.[0], q).toMatchObject({ label: "Team name", values: [name] });
    }
  });
  it("a number with the team's own name after it, and two facts (8, 12)", async () => {
    const c = await fact("6980 Bad Wolf school and city");
    expect(c?.team?.number).toBe(6980);
    expect(c?.facts?.map((f) => [f.label, f.values[0]])).toEqual([["School or organization", "Oradell High School"], ["Where they're from", "Oradell, NJ, USA"]]);
    expect((await fact("6980 bad wolf location"))?.facts?.[0]?.values).toEqual(["Oradell, NJ, USA"]);
    // Another team's name after the number is never read as this team.
    expect((await ask("6980 hypnotic robotics location")).card?.team?.number).not.toBe(6980);
  });
  it("organization name, city and state, region (13, 15, 17, 18)", async () => {
    expect((await fact("4215 organization name"))?.facts?.[0]).toMatchObject({ label: "School or organization", values: ["Oradell High School"] });
    expect((await fact("4215 city and state"))?.facts?.[0]).toMatchObject({ label: "Where they're from", values: ["Oradell, NJ, USA"] });
    for (const q of ["4215 region", "6980 region"]) expect((await fact(q))?.facts?.[0], q).toMatchObject({ label: "Region", values: ["New Jersey"] });
  });
  it("every fact carries the rest of the team's card: where, region and the season's numbers", async () => {
    const c = await fact("where is 4215 from");
    expect(c?.season).toBe(S);
    expect(c?.support?.map((f) => [f.label, f.values[0]])).toEqual([["Region", "New Jersey"], [`Record, ${seasonLabel(S)}`, "26-6-0"], [`OPR, ${seasonLabel(S)}`, "101.6"], [`Rating, ${seasonLabel(S)}`, "101.6"]]);
  });
  it("the team profile: one card, the team page's numbers (19, 247, 248)", async () => {
    for (const q of ["4215 team profile summary", "4215 scouting profile", "4215 team page summary"]) {
      const c = await fact(q);
      expect(c?.title, q).toBe(`Team profile, ${seasonLabel(S)}`);
      expect(Object.fromEntries((c?.facts ?? []).map((f) => [f.label, f.values[0]])), q).toMatchObject({
        "Team name": "Hypnotic Robotics", "Where they're from": "Oradell, NJ, USA", "Rookie year": "2009",
        [`Record, ${seasonLabel(S)}`]: "26-6-0", [`OPR, ${seasonLabel(S)}`]: "101.6",
      });
      expect(c?.lines[0]?.href).toBe(`/teams/4215?season=${S}`);
    }
  });
  it("no school listed: said so, with where the team is from (4)", async () => {
    const c = await fact("what school is 33950 from");
    expect(c?.facts?.map((f) => [f.label, f.values])).toEqual([["School or organization", []], ["Where they're from", ["Ridgewood, NJ, USA"]]]);
    expect(c?.none).toBe("FIRST's listing for First Street Kids (33950) has no school. The team is from Ridgewood, NJ, USA.");
    expect(c?.support?.some((f) => f.label === "Where they're from")).toBe(false);
  });
  it("how-it-works answers: search, predictions, Worlds qualification, the rating (249, 252, 253, 255)", () => {
    expect(explainAnswer("how does FTC One Search work")?.card?.title).toBe("How FTC One Search works");
    expect(explainAnswer("how does FTC One Search work")?.card?.lines.map((l) => l.text).join(" ")).not.toMatch(/\bAI\b/);
    expect(explainAnswer("how are predictions made")?.card?.title).toBe("Predictions: how they're made");
    for (const q of ["how does worlds qualification work", "how do teams qualify for worlds"]) expect(explainAnswer(q)?.card?.title, q).toMatch(/^Worlds qualification/);
    const w = explainAnswer("how does worlds qualification work")?.card?.lines ?? [];
    expect(w.find((l) => /Competition Manual/.test(l.detail ?? ""))?.href).toMatch(/^https:\/\/ftc-resources\.firstinspires\.org\//);
    expect(w.at(-1)?.href).toBe("https://ftc-events.firstinspires.org");
    expect(explainAnswer("how is rating calculated")?.card?.lines.map((l) => l.text).join(" ")).toMatch(/playoff match moves a rating 50% as much/);
  });
  it("a profile for a season named, with other facts asked, and no region guessed (Greptile on #562)", async () => {
    for (const q of ["4215 profile 2024-25", "4215 2024-25 profile", "4215 team profile last season"]) {
      const c = await fact(q);
      expect(c?.title, q).toBe(`Team profile, ${seasonLabel(S - 1)}`);
      expect(c?.facts?.find((f) => f.label.startsWith("Record"))?.values, q).toEqual(["20-4-0"]);
    }
    expect((await fact("4215 profile 2019-20"))?.none).toBe(`Hypnotic Robotics (4215) has no matches on record in ${seasonLabel(2019)}.`);
    expect((await fact("4215 school and profile"))?.facts?.some((f) => f.label === "School or organization")).toBe(true);
    // No FIRST region stored: the region is unknown, never read off the address.
    expect((await fact("23268 region"))?.none).toMatch(/has no region/);
  });
});

describe("failed-search issues (11-04)", () => {
  it("rewrites: a leaderboard by a game, the season's events, a misspelled game, filler, 'in' worlds", () => {
    expect(rewriteQuery("best auto in decode")).toMatchObject({ q: "top 10 teams by auto 2025-26", pre: true }); // #511
    expect(rewriteQuery("best scoring auto in decode")?.q).toBe("top 10 teams by auto 2025-26"); // #510
    expect(rewriteQuery("top auto opr decode")?.q).toBe("top 10 teams by auto opr 2025-26");
    expect(rewriteQuery("best auto opr in 2025-26")?.q).toBe("top 10 teams by auto opr 2025-26"); // "in" is never a place
    const now = seasonLabel(CURRENT_SEASON).replace("–", "-");
    for (const q of ["events", "events this season", "events ths", "all events"]) expect(rewriteQuery(q)?.q, q).toBe(`events in ${now}`); // #515
    expect(rewriteQuery("meets")?.q).toBe(`meets in ${now}`);
    expect(rewriteQuery("event horizon")).toBeNull(); // a team's name stays one
    expect(rewriteQuery("jackson division dcode")?.q).toBe("jackson division 2025-26"); // #518
    expect(rewriteQuery("dcode")).toBeNull(); // a typo is forgiven only where an event is named
    expect(rewriteQuery("so like what was 4215 last game")?.q).toBe("what was 4215 last game"); // #509
    expect(rewriteQuery("so robotics")).toBeNull();
    expect(rewriteQuery("4215 matches in worlds")?.q).toBe("4215 matches at worlds"); // #526
  });
  it("an event by its own name and a match number: that match, typo'd 'division' too (#533)", async () => {
    // The division's Q1 this season, and next season's division listed but not yet played (Greptile on #536: an
    // unplayed season never hides the played one).
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'FTCCMP1EDIS', 'qual', 0, 1, 'Q1', 1, 't')", [S]);
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'FTCCMP1EDIS', 'FIRST Championship - Edison Division', 'FIRSTChampionship', 'Houston', 'TX', 'USA', '2027-04-29', '2027-05-01', 't')", [S + 1]);
    await rebuildSearch();
    for (const q of ["edison division q1", "edison divison q1", "worlds edison division q1"]) {
      const a = await ask(q);
      expect(a.step, q).toBe("deterministic");
      expect(a.hits.find((h) => h.kind === "match")?.ref, q).toBe(`${S}:FTCCMP1EDIS:qual:0:1`);
      expect(a.understood?.label, q).toMatch(/^Qualification match 1 at FIRST Championship - Edison Division/);
    }
    // A season named with it, as a season or a game: that season's event, the season not part of the name.
    for (const q of [`edison division q1 ${S}-${(S + 1) % 100}`, "edison division q1 decode"]) {
      expect((await ask(q)).hits.find((h) => h.kind === "match")?.ref, q).toBe(`${S}:FTCCMP1EDIS:qual:0:1`);
    }
    // A misspelled game with "$" left on it is read by position, never as a pattern (Greptile on #536).
    expect(() => rewriteQuery("jackson division decode$")).not.toThrow();
  });
});

// What a word means, asked with framing, two words at once, a team's own numbers, or the season's game (failed-search
// issues 792, 910, 966, 911, 957, 997). Each phrasing here is held out: none is an issue's own words.
describe("explain questions, asked any way", () => {
  it("a word with framing round it: \"explained\", \"in simple terms\", \"for beginners\"", () => {
    for (const q of ["autonomous explained", "endgame explained simply", "explain teleop to me", "what is driver controlled, in simple terms", "opr explained for beginners"])
      expect(explainAnswer(q)?.card?.kind, q).toBe("info");
    expect(explainAnswer("auto explained")?.card?.title).toBe("A match's periods: auto, TeleOp and endgame");
    expect(explainAnswer("auto explained")?.card?.lines.map((l) => l.text).join(" ")).toMatch(/2-minute driver-controlled/);
    expect(explainAnswer("4215 explained")).toBeNull();
  });
  it("two words compared: each one's own lines", () => {
    const a = explainAnswer("what is the difference between the rating and OPR?");
    expect(a?.card?.title).toBe("The prediction rating and OPR: the difference");
    expect(a?.card?.lines.map((l) => l.href)).toEqual(["/methodology#rating", "/methodology#rating", "/methodology#opr", "/methodology#opr"]);
    expect(explainAnswer("how is opr different from reliability, explained simply")?.card?.title).toMatch(/^OPR and the reliability index/);
    expect(explainAnswer("difference between opr and 4215")).toBeNull();
    // Two words one explainer covers: that explainer, which sets them apart.
    for (const q of ["difference between auto and teleop", "how is teleop different from endgame"]) expect(explainAnswer(q)?.card?.title, q).toBe("A match's periods: auto, TeleOp and endgame");
  });
  it("the season's game, by \"this season\" or \"last season\"", () => {
    expect(explainAnswer("what is this season's game")?.card?.title).toContain(`the ${seasonLabel(CURRENT_SEASON)} FTC game`);
    expect(explainAnswer("what was the game last season")?.card?.title).toBe(`${explainAnswer("what was the game last season")?.card?.title.split(":")[0]}: the ${seasonLabel(CURRENT_SEASON - 1)} FTC game`);
    expect(explainAnswer("current ftc game")?.card?.title).toContain(seasonLabel(CURRENT_SEASON));
  });
  it("a word for one team: the team's own stat, with the word's explainer under it", async () => {
    const a = await explainTeamAnswer("what does opr mean for 4215, step by step", ask, true);
    expect(a?.stat?.team?.number).toBe(4215);
    expect(a?.stat?.headline?.value).toBe("101.6");
    expect(a?.card?.title).toBe("OPR: what it is and how it's worked out");
    // The question asked of the stat answers, and a "why did it drop" asks the rating's change.
    const asked: string[] = [];
    const spy = async (x: string) => { asked.push(x); return ask(x); };
    await explainTeamAnswer("explain how 6980's rating is worked out", spy, true);
    await explainTeamAnswer("why did 6980 rating drop after they won", spy, true);
    await explainTeamAnswer("ranking points meaning for 6980 at the FIRST Championship", spy, true);
    // The fixture keeps no weekly ratings, so the change falls back to the season rating.
    expect(asked).toEqual(["6980 rating", "6980 rating change", "6980 rating", "6980 rank at the first championship"]);
    const why = await explainTeamAnswer("why did 6980 rating drop after they won", ask, true);
    expect(why?.card?.lines[0].text).toMatch(/not on who won/);
    // No weekly ratings kept to show the change: the team's own season rating, never an empty panel.
    expect(why?.stat?.none).toBeUndefined();
    expect(why?.stat?.team?.number).toBe(6980);
    // The dropdown (no `stat` worked out) reads it the same: the team found, the explainer under it.
    const quick = await explainTeamAnswer("what does opr mean for 4215, step by step", (x, full) => searchAnswer(x, full ? { limit: 25, full: true, learn: false } : { limit: 15, learn: false }));
    expect(quick?.hits[0]).toMatchObject({ kind: "team", ref: "4215" });
    expect(quick?.card?.title).toBe("OPR: what it is and how it's worked out");
    // A change with nothing on record falls back the same in the dropdown as on the page: one answer, one heading.
    const [page, drop] = await Promise.all([ask("why did 6980 rating drop after they won"), searchAnswer("why did 6980 rating drop after they won", { limit: 15, learn: false })]);
    expect(drop.intent?.kind).toBe(page.intent?.kind);
    expect(drop.hits[0]).toMatchObject({ kind: "team", ref: "6980" });
    expect(drop.card?.title).toBe(page.card?.title);
    expect(drop.understood?.label).toBe(page.understood?.label);
    // The dropdown decides on the page's answers, then shows its own of the same question.
    const both: [string, boolean][] = [];
    await explainTeamAnswer("why did 6980 rating drop after they won", (x, full) => { both.push([x, !!full]); return searchAnswer(x, full ? { limit: 25, full: true, learn: false } : { limit: 15, learn: false }); });
    expect(both).toEqual([["6980 rating change", true], ["6980 rating", true], ["6980 rating", false]]);
    // No meaning asked, or no team named: not this answer.
    for (const q of ["4215 mean opr", "what is 4215's opr", "how is opr calculated", "what does opr mean for teams"]) expect(await explainTeamAnswer(q, ask, true), q).toBeNull();
    // Punctuation is set aside, and a team question is never sent back here as a meaning question.
    const sent: string[] = [];
    const once = (x: string) => { sent.push(x); return ask(x); };
    expect((await explainTeamAnswer("explain 4215's opr calculated.", once, true))?.card?.title).toMatch(/OPR/);
    expect(sent).toEqual(["4215 opr"]);
    expect(await explainTeamAnswer("explain opr calculated.", once, true)).toBeNull();
    expect(await explainTeamAnswer("what does opr mean?! for... teams", once, true)).toBeNull();
    expect(sent).toEqual(["4215 opr", "teams opr"]);
  });
  it("a word for one team: a season keeps its separator, a team's name keeps its words, nothing comes back here", async () => {
    await run("INSERT OR IGNORE INTO teams (number, name, city, state, country) VALUES (30628, 'CALculated Risk', 'Austin', 'TX', 'USA')");
    await rebuildSearch();
    const sent: string[] = [];
    const spy = async (x: string) => { sent.push(x); return ask(x); };
    await explainTeamAnswer("explain 4215 opr in 2024/25.", spy, true);
    await explainTeamAnswer("explain opr for CALculated Risk", spy, true);
    expect(sent).toEqual(["4215 opr in 2024/25", "calculated risk opr"]);
    // An answer that asks back into this helper gets nothing from it: one question out, never a loop.
    let inner: unknown = "unset";
    await explainTeamAnswer("explain opr for CALculated Risk", async (x) => { inner = await explainTeamAnswer(`explain ${x}`, ask, true); return ask(x); }, true);
    expect(inner).toBeNull();
  });
});
