// Stat answers at one event, awards and winning alliances (server/api/answers/) on a small fixture database: a team
// at a named event (results, rank, OPR, one match), its event wins as 1st place and Inspire apart, award counts by
// kind, and the winning alliance of an event or a season's championship, decided by its final match. Worlds answers
// end with the season's championship events and related questions; nothing found says so.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { readStatQuestion, readTwoTeam } from "./read";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [23268, "Ultraviolet"], [207, "Critical Mass"], [7149, "ENFORCERS"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (code: string, name: string, type: string, start: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, ?, 'Hillsborough', 'NJ', 'USA', ?, ?, 't')", [code, name, type, division, start, start]);
  await ev("USNJCMP", "New Jersey Championship", "Championship", "2026-03-15");
  await ev("USNJCMPPKWY", "New Jersey Championship - Parkway Division", "Championship", "2026-03-15", "USNJCMP");
  await ev("FTCCMP1", "FIRST Championship - FIRST Tech Challenge", "FIRSTChampionship", "2026-04-29");
  await ev("FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", "2026-04-29", "FTCCMP1");
  // An Edison Division a season earlier: a division's answer switches to the same division.
  await run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (2024, 'FTCCMP1EDIS', 'FIRST Championship - FIRST Tech Challenge - Edison Division', 'FIRSTChampionship', 'FTCCMP1', 'Houston', 'TX', 'USA', '2025-04-16', '2025-04-19', 't')");
  await ev("FTCCMP1OCHO", "FIRST Championship - FIRST Tech Challenge - Ochoa Division", "FIRSTChampionship", "2026-04-29", "FTCCMP1");
  const match = (code: string, level: string, series: number, n: number, label: string, red: number, blue: number, teams: [number, string, number?][]) => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, ?, ?, ?, ?, '2026-03-15T10:00:00Z', 1, ?, ?, ?, ?, 't')", [code, level, series, n, label, red, red, blue, blue]),
    ...teams.map(([t, alliance, on = 1]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, ?, ?, ?, ?, ?, ?, ?)", [code, level, series, n, t, alliance, on])),
  ]);
  // The Parkway Division: 4215 ranked #2 of 2, won Q1, lost Q2; 23268 and 7149 win its final.
  for (const [t, rank] of [[4215, 2], [6980, 1], [23268, 3], [7149, 4]] as const) await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJCMPPKWY', ?, ?)", [t, rank]);
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (2025, 'USNJCMPPKWY', 4215, 101.6, 30.2, 60.1, 11.3, 2)");
  await match("USNJCMPPKWY", "qual", 0, 1, "Q1", 150, 90, [[4215, "red"], [207, "red"], [6980, "blue"], [7149, "blue"]]);
  await match("USNJCMPPKWY", "qual", 0, 12, "Q12", 80, 120, [[4215, "red"], [6980, "red"], [23268, "blue"], [7149, "blue"]]);
  await match("USNJCMPPKWY", "playoff", 5, 1, "M5", 200, 180, [[23268, "red"], [7149, "red"], [6980, "blue"], [4215, "blue"]]);
  await run("INSERT INTO alliances (season, code, number, captain, pick1, pick2) VALUES (2025, 'USNJCMPPKWY', 1, 23268, 7149, 207)");
  // Awards: 4215 won an Inspire Award (and a 2nd place Inspire elsewhere), a Finalist Alliance, and Think.
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (2025, 'USNJCMPPKWY', 'Inspire', 1, 4215), (2025, 'USNJCMPPKWY', 'Finalist', 1, 4215), (2025, 'USNJCMP', 'Think', 1, 4215), (2025, 'USNJCMP', 'Inspire', 2, 4215), (2025, 'USNJCMPPKWY', 'Winner', 1, 23268), (2025, 'USNJCMPPKWY', 'Winner', 2, 7149)");
  // Worlds: Edison's final decided; Ochoa's not played; the finals award lists every division winner (as FIRST's 2025–26
  // list did), so the final match decides the champions.
  await match("FTCCMP1EDIS", "playoff", 9, 1, "M9", 300, 250, [[6980, "red"], [207, "red"], [23268, "blue"], [7149, "blue"]]);
  await run("INSERT INTO alliances (season, code, number, captain, pick1, pick2) VALUES (2025, 'FTCCMP1EDIS', 1, 6980, 207, 4215)");
  await match("FTCCMP1", "playoff", 2, 1, "F1", 400, 410, [[6980, "red"], [207, "red"], [23268, "blue"], [7149, "blue"]]);
  await run("INSERT INTO alliances (season, code, number, name, captain, pick1) VALUES (2025, 'FTCCMP1', 1, 'Edison', 6980, 207), (2025, 'FTCCMP1', 2, 'Ochoa', 23268, 7149)");
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (2025, 'FTCCMP1', 'Winner', 1, 23268), (2025, 'FTCCMP1', 'Winner', 2, 7149), (2025, 'FTCCMP1', 'Winner', 3, 6980), (2025, 'FTCCMP1', 'Winner', 4, 207)");
  // A Leadership Award is stored as a Winner too (FIRST's 2025-26 Worlds list): never a winning alliance.
  await ev("USNJQ5", "Pine Barrens Qualifier", "Qualifier", "2026-02-01");
  await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2025, 'USNJQ5', 'Winner', 1, 207, 'Winning Alliance - Captain'), (2025, 'USNJQ5', 'Winner', 1, 6980, '<i>FIRST</i>® Leadership Award Winner')");
  // The next season has begun (an event on the calendar) but has no championship yet.
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, 'USNJQ26', 'Fall Qualifier', 'Qualifier', 'Hillsborough', 'NJ', 'USA', '2026-10-01', '2026-10-01', 't')");
  await rebuildSearch();
});

describe("what's read", () => {
  it("an event scope, a match number, a count, and a team-less winning alliance", () => {
    expect(readStatQuestion("4215 rank at New Jersey Championship")).toMatchObject({ id: "event-rank", core: "4215", scope: { at: "new jersey championship" } });
    expect(readStatQuestion("4215 score in match 12 at New Jersey Championship")).toMatchObject({ id: "match-lookup", n: 12, core: "4215" });
    expect(readStatQuestion("4215 Inspire awards count")).toMatchObject({ id: "inspire-awards", count: true, core: "4215" });
    expect(readStatQuestion("Has 4215 ever won an event")).toMatchObject({ id: "event-wins", core: "4215" });
    expect(readStatQuestion("ftc decode winning alliance")).toMatchObject({ id: "winning-alliance", noTeam: true, core: "", scope: { season: 2025 } });
  });
});

describe("one team at one event", () => {
  it("results, rank and OPR at the event the words name (its division, where the team played)", async () => {
    const r = await searchAnswer("4215 results at New Jersey Championship", { limit: 25 });
    expect(r.stat).toMatchObject({ family: "event", title: "Results at New Jersey Championship - Parkway Division", headline: { value: "1-2-0" } });
    const k = await searchAnswer("4215 rank at New Jersey Championship", { limit: 25 });
    expect(k.stat!.headline).toMatchObject({ value: "#2 of 4" });
    const o = await searchAnswer("4215 OPR at New Jersey Championship", { limit: 25 });
    expect(o.stat!.headline).toMatchObject({ value: "OPR 101.6" });
  });
  it("one match there, or its own matches when it didn't play that one", async () => {
    expect((await searchAnswer("4215 score in match 12 at New Jersey Championship", { limit: 25 })).stat!.headline).toMatchObject({ value: "Lost 80–120", label: "Q12 at New Jersey Championship - Parkway Division" });
    expect((await searchAnswer("4215 score in match 7 at New Jersey Championship", { limit: 25 })).stat!.none).toMatch(/didn't play a match 7/);
  });
  it("an event the team never attended is left to search", async () => {
    expect((await searchAnswer("4215 rank at Texas Championship", { limit: 25 })).stat).toBeUndefined();
  });
});

describe("awards", () => {
  it("event wins: 1st place and Inspire, each labelled; a 2nd place Inspire is no win", async () => {
    const a = await searchAnswer("Has 4215 ever won an event", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "1 win", label: "0 1st-place finishes · 1 Inspire Award" });
    const t = a.stat!.blocks.find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.rows.map((r) => r.cells.award)).toEqual(["Inspire Award"]);
    await run("INSERT INTO teams (number, name) VALUES (1234, 'Newcomers')");
    const n = await searchAnswer("1234 event wins", { limit: 25 });
    expect(n.stat!.none).toMatch(/^None found: no 1st-place finishes and no Inspire Awards/);
  });
  it("1st-place as an adjective, 1st place as a noun, the same everywhere (audit v2.8.9)", async () => {
    const a = await searchAnswer("Has 4215 ever won an event", { limit: 25 });
    const k = a.stat!.blocks.find((b) => b.kind === "kpis");
    expect(k && k.kind === "kpis" && k.items[0]).toMatchObject({ label: "1st-place finishes", sub: "Winning Alliance" });
    const w = await searchAnswer("ftc decode winning alliance", { limit: 25 });
    for (const s of [a.stat, w.stat]) expect(JSON.stringify(s)).not.toMatch(/\b(?:1st|2nd|3rd) place (?:Inspire|finish)|\b(?:2nd|3rd) place\b/);
    const inspire = w.stat!.blocks.find((b) => b.kind === "links" && b.title === "Inspire Award");
    if (inspire && inspire.kind === "links") for (const i of inspire.items) expect(i.sub).toBe("1st-place Inspire");
  });
  it("counts and the judged/performance split", async () => {
    expect((await searchAnswer("4215 Inspire awards count", { limit: 25 })).stat!.headline).toMatchObject({ value: "1 Inspire Award", label: "plus 1 2nd- or 3rd-place Inspire" });
    expect((await searchAnswer("4215 finalist finishes", { limit: 25 })).stat!.headline).toMatchObject({ value: "1 finalist finish" });
    expect((await searchAnswer("4215 total awards", { limit: 25 })).stat!.headline).toMatchObject({ value: "4 awards", label: "1 performance · 3 judged" });
    expect((await searchAnswer("4215 awards at New Jersey Championship", { limit: 25 })).stat!.headline).toMatchObject({ value: "2 awards" });
  });
});

describe("winning alliances", () => {
  it("an event's: the final match's winners with their whole alliance", async () => {
    const a = await searchAnswer("New Jersey Championship Parkway Division winning alliance", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "23268 Ultraviolet, 7149 ENFORCERS, 207 Critical Mass" });
  });
  it("the season's championship: the finals decide, never the award list; a division not played says so", async () => {
    const a = await searchAnswer("ftc decode winning alliance", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "23268 Ultraviolet, 7149 ENFORCERS" });
    const divs = a.stat!.blocks.find((b) => b.kind === "table");
    expect(divs && divs.kind === "table" && divs.rows.map((r) => [r.cells.division, r.cells.alliance])).toEqual([
      ["Worlds · Edison Division", "6980 Bad Wolf, 207 Critical Mass, 4215 Hypnotic Robotics"],
      ["Worlds · Ochoa Division", "Not decided in the data yet"],
    ]);
    // The season's championship events, from the data, as buttons.
    expect(a.stat!.blocks.find((b) => b.kind === "links")).toMatchObject({ title: "Worlds events, 2025–26", items: [{ label: "Edison Division" }, { label: "Ochoa Division" }, { label: "Worlds finals" }] });
    // No pill says a word twice ("Worlds finals finals", audit v2.8.9).
    for (const b of a.stat!.blocks) if (b.kind === "links") for (const i of b.items) expect(`${i.label} ${i.sub ?? ""}`.trim(), i.label).not.toMatch(/\b(\w+) \1\b/i);
    // The card's heading complements the page's, never repeats it.
    expect(a.understood!.label).toBe("DECODE 2025–26 FIRST Championship winning alliances");
    expect(a.stat!.title).toBe("The champions and each division's winners");
  });
  it("a season with no championship results says so, then the latest finished season's champions below it", async () => {
    const a = await searchAnswer("into the deep winning alliance", { limit: 25 });
    expect(a.stat!.none).toBe("No championship results yet for INTO THE DEEP (2024–25). Below: the latest finished season's champions, DECODE (2025–26).");
    expect(a.stat!.headline).toMatchObject({ value: "23268 Ultraviolet, 7149 ENFORCERS" });
    const t = await searchAnswer("who won worlds this year", { limit: 25 });
    expect(t.stat!.none).toBe("No championship results yet for BIOBUZZ (2026–27). Below: the latest finished season's champions, DECODE (2025–26).");
  });
  it("a season's champions however it's asked: a game's name, Worlds, winner, champion, last year", async () => {
    for (const q of ["decode winner", "into the deep champions", "who won centerstage", "who won worlds", "worlds winners", "world champions", "who won worlds last year", "worlds winners 2025", "into the deep world champions"]) {
      expect(readStatQuestion(q), q).toMatchObject({ id: "winning-alliance", noTeam: true, core: "" });
    }
    for (const q of ["decode winner", "who won worlds", "world champions", "who won worlds last year"]) {
      expect((await searchAnswer(q, { limit: 25 })).stat!.headline, q).toMatchObject({ value: "23268 Ultraviolet, 7149 ENFORCERS" });
    }
    expect((await searchAnswer("who won worlds last year", { limit: 25 })).stat!.definition).toContain('"Last year" is DECODE (2025–26), the latest whose championship has finished.');
    // An award's winner, or a team, is never read as a season's champions.
    for (const q of ["who won the inspire award at nj states", "4215 worlds winner", "4215 champion"]) expect(readStatQuestion(q)?.id, q).not.toBe("winning-alliance");
  });
  it("who won a state championship: its winners, each division apart, its Inspire Award and its other seasons", async () => {
    const a = await searchAnswer("who won nj states", { limit: 25 });
    expect(a.understood!.label).toMatch(/2025–26 winning alliance$/);
    expect(a.stat!.title).toBe("The winners and their final matches");
    expect(a.stat!.headline).toBeDefined();
    expect(a.stat!.blocks.some((b) => b.kind === "links" && b.title === "Inspire Award")).toBe(true);
    expect(readStatQuestion("who won states")?.id === "winning-alliance" ? (await searchAnswer("who won states", { limit: 25 })).stat : undefined).toBeUndefined();
    // A bare year is when the event was held, as the asks read it: 2026 is the 2025–26 championship, 2025 the one before.
    expect((await searchAnswer("who won 2026 nj states", { limit: 25 })).understood!.label).toMatch(/2025–26 winning alliance$/);
    expect((await searchAnswer("who won 2025 nj states", { limit: 25 })).stat).toBeUndefined();
    // "This year" is the current season (2026–27 here, not played): never last season's winners as this year's.
    expect((await searchAnswer("who won nj states this year", { limit: 25 })).stat?.headline).toBeUndefined();
  });
  it('"last season" outside a championship question is the season before the current one', () => {
    expect(readTwoTeam("4215 vs 6980 head to head last season")).toMatchObject({ id: "head-to-head", scope: { season: 2025, lastYear: true } });
    expect(readStatQuestion("4215 average score last season")).toMatchObject({ scope: { season: 2025 } });
  });
  it("a Worlds division's other seasons are that division's", async () => {
    const a = await searchAnswer("decode edison division winners", { limit: 25 });
    const other = a.stat?.blocks.find((b) => b.kind === "links" && b.title === "Other seasons");
    expect(other && other.kind === "links" && other.items.map((i) => decodeURIComponent(i.href))).toEqual(["/search?q=into the deep edison division winners"]);
  });
  it("a Leadership Award stored as a Winner is never on the winning alliance", async () => {
    expect((await searchAnswer("Pine Barrens Qualifier winning alliance", { limit: 25 })).stat!.headline).toMatchObject({ value: "207 Critical Mass" });
  });
});

describe("two teams", () => {
  it("what's read: two teams and the question, a bare year that's a team", () => {
    expect(readTwoTeam("4215 vs 6980 head to head")).toMatchObject({ id: "head-to-head", a: "4215", b: "6980" });
    expect(readTwoTeam("Has 4215 ever played 6980")).toMatchObject({ id: "head-to-head", a: "4215", b: "6980", scope: { ever: true } });
    expect(readTwoTeam("4215 vs 2024 head to head")).toMatchObject({ id: "head-to-head", a: "4215", b: "2024", scope: { season: null } });
    expect(readTwoTeam("4215 OPR vs 6980")).toMatchObject({ id: "opr-vs", a: "4215", b: "6980" });
    expect(readTwoTeam("4215 rating vs 6980")).toMatchObject({ id: "rating-vs" });
    expect(readTwoTeam("4215 win chance vs 6980")).toMatchObject({ id: "win-chance" });
    expect(readTwoTeam("Who has a better record, 4215 or 6980")).toMatchObject({ id: "better-record", a: "4215", b: "6980" });
    expect(readTwoTeam("4215 vs 6980")).toBeNull();
    expect(readStatQuestion("4215 most played opponent")).toMatchObject({ id: "most-played-opponent", core: "4215" });
    expect(readStatQuestion("4215 teams never played")).toMatchObject({ id: "never-played", core: "4215" });
  });
  it("head to head: the meetings and the record, partners apart, never met said plainly", async () => {
    const a = await searchAnswer("4215 vs 6980 head to head", { limit: 25 });
    expect(a.stat).toMatchObject({ family: "two-team", headline: { value: "4215 leads 1–0", label: "1 meeting" } });
    expect(a.stat!.blocks.find((b) => b.kind === "matches")).toMatchObject({ title: "Meetings, newest first", rows: [{ label: "Q1", result: "W" }] });
    expect(a.stat!.blocks.find((b) => b.kind === "kpis")).toMatchObject({ items: [{ value: "1" }, { value: "0" }, { label: "As partners", value: "2", sub: "0-2-0" }] });
    expect(a.hits.map((h) => h.ref)).toEqual(["4215", "6980"]);
    // The page names both teams; the card says what it holds (audit v2.8.9: never "4215 vs 6980 head to head" under it).
    expect(a.understood!.label).toBe("Head to head: Hypnotic Robotics (4215) vs Bad Wolf (6980)");
    expect(a.stat!.title).toBe("Their meetings and partnerships");
    const n = await searchAnswer("4215 vs 207 head to head", { limit: 25 });
    expect(n.stat!.none).toBe("Hypnotic Robotics (4215) and Critical Mass (207) have never played each other.");
  });
  it("season numbers side by side: OPR bars, the better record, a win chance that points to Predict", async () => {
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_auto, rating_teleop, rating_endgame, rating_sd, rating_rank, matches, wins, losses, ties) VALUES (2025, 4215, 101.6, 30, 60, 11.6, 3, 50, 98, 29, 58, 11, 6, 40, 12, 9, 3, 0), (2025, 6980, 88.2, 25, 52, 11.2, 9, 50, 90, 26, 53, 11, 7, 80, 12, 10, 2, 0)");
    const o = await searchAnswer("4215 OPR vs 6980", { limit: 25 });
    expect(o.stat!.headline).toMatchObject({ value: "Hypnotic Robotics (4215)", label: "OPR 101.6 against 88.2, +13.4" });
    expect(o.stat!.blocks.find((b) => b.kind === "bars")).toMatchObject({ groups: [{ label: "Total", items: [{ value: 101.6 }, { value: 88.2 }] }, {}, {}, {}] });
    const r = await searchAnswer("Who has a better record, 4215 or 6980", { limit: 25 });
    expect(r.stat!.headline).toMatchObject({ value: "Bad Wolf (6980)", label: "83% win rate against 75%" });
    const w = await searchAnswer("4215 win chance vs 6980", { limit: 25 });
    expect(w.stat!.headline).toMatchObject({ value: "4215 is stronger" });
    expect(w.stat!.blocks.find((b) => b.kind === "links")).toMatchObject({ items: [{ label: "Predict 4215 vs 6980" }, {}] });
  });
  it("opponents and partners, and teams never played", async () => {
    const t = await searchAnswer("4215 toughest opponent", { limit: 25 });
    expect(t.stat!.headline).toMatchObject({ value: "7149 ENFORCERS", label: "met 3 times, 2-1-0 against 4215" });
    const m = await searchAnswer("4215 most played opponent", { limit: 25 });
    expect(m.stat!.headline).toMatchObject({ value: "7149 ENFORCERS" });
    const p = await searchAnswer("4215 best alliance partner", { limit: 25 });
    expect(p.stat!.none).toBe("No partner played with 3 or more times found for Hypnotic Robotics (4215).");
    const f = await searchAnswer("4215 most frequent partner", { limit: 25 });
    expect(f.stat!.headline!.value).toMatch(/^(207|6980|23268) /);
    // Only teams with matches at an official event count (a scrimmage-only season isn't one): 6980 played Parkway.
    expect((await searchAnswer("4215 teams never played", { limit: 25 })).stat!.none).toBe("No other NJ teams with matches in 2025–26.");
    await run("INSERT INTO team_event_stats (season, code, team, matches) VALUES (2025, 'USNJCMPPKWY', 6980, 3)");
    const n = await searchAnswer("4215 teams never played", { limit: 25 });
    expect(n.stat!.none).toBe("Hypnotic Robotics (4215) has played against every NJ team with matches in 2025–26.");
    // A playoff 4215 sat out (not on the field) never met the other alliance.
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (31000, 'Bench Mark', 'Oradell', 'NJ', 'USA')");
    await run("INSERT INTO team_event_stats (season, code, team, matches) VALUES (2025, 'USNJCMPPKWY', 31000, 3)");
    await run("INSERT INTO team_season_stats (season, team, opr_np, matches, wins, losses, ties) VALUES (2025, 31000, 40, 3, 1, 2, 0)");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJCMPPKWY', 'playoff', 3, 1, 'M3', '2026-03-15T13:00:00Z', 1, 90, 90, 80, 80, 't')");
    for (const [t, al, on] of [[4215, "red", 0], [207, "red", 1], [31000, "blue", 1]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJCMPPKWY', 'playoff', 3, 1, ?, ?, ?)", [t, al, on]);
    clearAllCaches();
    const sat = await searchAnswer("4215 teams never played", { limit: 25 });
    expect(JSON.stringify(sat.stat!.blocks)).toContain("31000 Bench Mark");
  });
  it("a season before Predict's (2023–24) offers Compare only", async () => {
    await run("INSERT INTO team_season_stats (season, team, opr_np, matches, wins, losses, ties) VALUES (2021, 4215, 80, 12, 8, 4, 0), (2021, 6980, 70, 12, 6, 6, 0)");
    const a = await searchAnswer("4215 OPR vs 6980 in 2021-22", { limit: 25 });
    const links = a.stat!.blocks.find((b) => b.kind === "links");
    expect(links && links.kind === "links" && links.items.map((i) => i.label)).toEqual(["Compare side by side"]);
  });
});

describe("what Greptile found", () => {
  it("reads the team in 'how did … do', a named event for winners, a Worlds division, a qualification-only match", () => {
    expect(readStatQuestion("how did 4215 do at New Jersey Championship")).toMatchObject({ id: "results", core: "4215" });
    expect(readStatQuestion("winning alliance at New Jersey Championship")).toMatchObject({ id: "winning-alliance", noTeam: true, core: "new jersey championship" });
    expect(readStatQuestion("4215 score in q12 at New Jersey Championship")).toMatchObject({ id: "match-lookup", n: 12, scope: { level: "qual" } });
    // A scope its rows can't apply is left to search.
    expect(readStatQuestion("4215 seasons played at New Jersey Championship")).toBeNull();
    expect(readStatQuestion("4215 total awards on red")).toBeNull();
    expect(readStatQuestion("4215 teams never played at New Jersey Championship")).toBeNull();
    expect(readTwoTeam("4215 vs 6980 head to head.")).toMatchObject({ id: "head-to-head", a: "4215", b: "6980" });
  });
  it("a Worlds division named: that division's winners", async () => {
    const a = await searchAnswer("FIRST Championship - Edison Division winning alliance", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "6980 Bad Wolf, 207 Critical Mass, 4215 Hypnotic Robotics" });
  });
  it("a final still going (one win of a best of three, the event not over) crowns no one", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USNJLIVE', 'Live Qualifier', 'Qualifier', 'Edison', 'NJ', 'USA', '2099-01-01', '2099-01-01', 't')");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJLIVE', 'playoff', 6, 1, 'F1', '2099-01-01T15:00:00Z', 1, 100, 100, 50, 50, 't')");
    for (const [t, a] of [[4215, "red"], [6980, "red"], [207, "blue"], [23268, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJLIVE', 'playoff', 6, 1, ?, ?, 1)", [t, a]);
    await rebuildSearch();
    const a = await searchAnswer("Live Qualifier winning alliance", { limit: 25 });
    expect(a.stat!.headline).toBeUndefined();
    expect(a.stat!.none).toBe("No winning alliance is published for Live Qualifier yet.");
  });
  it("an event's rank or OPR never takes a match filter it can't apply", () => {
    expect(readStatQuestion("4215 OPR at New Jersey Championship in playoffs")).toBeNull();
    expect(readStatQuestion("4215 rank at New Jersey Championship on red")).toBeNull();
  });
  it("a match the team played as a surrogate still has its score", async () => {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJCMPPKWY', 'qual', 0, 7, 'Q7', '2026-03-15T09:00:00Z', 1, 111, 111, 99, 99, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field, surrogate) VALUES (2025, 'USNJCMPPKWY', 'qual', 0, 7, 4215, 'red', 1, 1)");
    clearAllCaches(); // the team's matches are cached
    await rebuildSearch();
    const a = await searchAnswer("4215 score in match 7 at New Jersey Championship", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: expect.stringContaining("111") });
  });
  it("an older season of an event that came back is still found by its season", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2024, 'USNJCMP', 'New Jersey Championship', 'Championship', 'Union', 'NJ', 'USA', '2025-03-15', '2025-03-15', 't')");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2024, 'USNJCMP', 'playoff', 0, 1, 'F1', NULL, 1, 200, 200, 100, 100, 't'), (2024, 'USNJCMP', 'playoff', 0, 2, 'F2', NULL, 1, 210, 210, 100, 100, 't')");
    for (const n of [1, 2]) for (const [t, al] of [[6980, "red"], [207, "red"], [4215, "blue"], [7149, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2024, 'USNJCMP', 'playoff', 0, ?, ?, ?, 1)", [n, t, al]);
    await rebuildSearch();
    const a = await searchAnswer("New Jersey Championship winning alliance 2024-25", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: expect.stringContaining("6980 Bad Wolf") });
    expect(a.stat!.scope).toContain("2024–25");
  });
  it("a Worlds answer ends with related questions, never the one just asked", async () => {
    const a = await searchAnswer("ftc decode winning alliance", { limit: 25 });
    expect(a.stat!.blocks.find((b) => b.kind === "related")).toMatchObject({ queries: ["23268 worlds record", "23268 highest score in worlds", "INTO THE DEEP winning alliance"] });
  });
  it("a classic bracket's final is series 0, never its highest-numbered semifinal", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USNJCLAS', 'Classic Qualifier', 'Qualifier', 'Edison', 'NJ', 'USA', '2026-02-07', '2026-02-07', 't')");
    // Semifinal 2 (series 2): blue wins twice. The final (series 0): red wins twice.
    for (const [series, n, label, red, blue] of [[2, 1, "SF2-1", 50, 100], [2, 2, "SF2-2", 50, 100], [0, 1, "F1", 120, 80], [0, 2, "F2", 130, 90]] as const) {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJCLAS', 'playoff', ?, ?, ?, NULL, 1, ?, ?, ?, ?, 't')", [series, n, label, red, red, blue, blue]);
      for (const [t, a] of (series === 0 ? [[4215, "red"], [207, "red"], [6980, "blue"], [23268, "blue"]] : [[7149, "red"], [207, "blue"]]) as [number, string][]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJCLAS', 'playoff', ?, ?, ?, ?, 1)", [series, n, t, a]);
    }
    await rebuildSearch();
    const a = await searchAnswer("Classic Qualifier winning alliance", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "207 Critical Mass, 4215 Hypnotic Robotics", sub: "F1 120–80 · F2 130–90" });
  });
});

describe("events, awards and Worlds history (260-query list)", () => {
  it("what's read: one award, the newest or first, placements, Worlds divisions, a Worlds year", () => {
    expect(readStatQuestion("4215 Design award")).toMatchObject({ id: "awards", award: "Design", core: "4215" });
    expect(readStatQuestion("4215 Judges Choice award")).toMatchObject({ id: "awards", award: "JudgesChoice", core: "4215" });
    expect(readStatQuestion("4215 winning alliance awards")).toMatchObject({ id: "awards", award: "Winner", core: "4215" });
    expect(readStatQuestion("4215 latest Inspire award")).toMatchObject({ id: "inspire-awards", pick: "latest", core: "4215" });
    expect(readStatQuestion("4215 first award ever")).toMatchObject({ id: "awards", pick: "first", core: "4215" });
    expect(readStatQuestion("4215 most recent award")).toMatchObject({ id: "awards", pick: "latest", core: "4215" });
    expect(readStatQuestion("events 4215 won outright")).toMatchObject({ id: "first-place-events", core: "4215" });
    expect(readStatQuestion("events 4215 placed first in")).toMatchObject({ id: "first-place-events", core: "4215" });
    expect(readStatQuestion("4215 best event ever")).toMatchObject({ id: "best-finish", byRecord: true, core: "4215" });
    expect(readStatQuestion("4215 worst event ever")).toMatchObject({ id: "worst-finish", byRecord: true, core: "4215" });
    for (const q of ["championship divisions 4215 played in", "4215 worlds divisions", "4215 championship appearances count"]) expect(readStatQuestion(q)).toMatchObject({ id: "worlds-divisions", scope: { championship: true }, core: "4215" });
    expect(readStatQuestion("4215 worlds wins")).toMatchObject({ id: "wins-count", scope: { championship: true }, core: "4215" });
    expect(readStatQuestion("4215 event schedule this season")).toMatchObject({ id: "total-events", scope: { latest: true }, core: "4215" });
    // Search reads "matches" as "match": the championship held in 2025 is 2024–25's.
    expect(readStatQuestion("4215 match at worlds in 2025")).toMatchObject({ id: "results", scope: { championship: true, season: 2024 }, core: "4215" });
    // "wins" and "match" alone, with nothing scoping them, are left as they were.
    expect(readStatQuestion("4215 wins")).toBeNull();
    expect(readStatQuestion("4215 match record")).toMatchObject({ id: "record" });
  });
  it("one award only, or plainly none of it; the newest and the first award with their event", async () => {
    const think = await searchAnswer("4215 Think award", { limit: 25 });
    expect(think.stat).toMatchObject({ title: "Think Award", headline: { value: "Think", label: "New Jersey Championship" } });
    const t = think.stat!.blocks.find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.rows.map((r) => r.cells.award)).toEqual(["Think"]);
    expect((await searchAnswer("4215 Motivate award", { limit: 25 })).stat!.none).toBe("No Motivate Award found for Hypnotic Robotics (4215) in the published awards (every season on record checked).");
    expect((await searchAnswer("4215 Judges Choice award", { limit: 25 })).stat!.none).toMatch(/^No Judges' Choice Award found/);
    expect((await searchAnswer("23268 winning alliance awards", { limit: 25 })).stat!.headline).toMatchObject({ value: "2 Winning Alliances", label: "at 2 events" });
    expect((await searchAnswer("4215 latest Inspire award", { limit: 25 })).stat).toMatchObject({ title: "Most recent Inspire Award" });
    expect((await searchAnswer("4215 first award ever", { limit: 25 })).stat).toMatchObject({ title: "First award" });
    const nj = await searchAnswer("4215 awards at New Jersey events", { limit: 25 });
    expect(nj.stat).toMatchObject({ title: "Awards at events in New Jersey", headline: { value: "4 awards" }, scope: expect.arrayContaining(["Events in New Jersey"]) });
  });
  it("events ranked 1st (a placement, never an award), the best event by rank then record, the event schedule", async () => {
    expect((await searchAnswer("events 4215 placed first in", { limit: 25 })).stat!.none).toMatch(/wasn't ranked 1st at any event/);
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJQ5', 4215, 1)");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJQ5', 'qual', 0, 1, 'Q1', '2026-02-01T10:00:00Z', 1, 120, 120, 60, 60, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJQ5', 'qual', 0, 1, 4215, 'red', 1)");
    clearAllCaches();
    const a = await searchAnswer("events 4215 won outright", { limit: 25 });
    expect(a.stat).toMatchObject({ title: "Events ranked 1st", headline: { value: "1 event", label: "ranked #1 after qualifications" } });
    const t = a.stat!.blocks.find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.rows[0].cells).toMatchObject({ event: "Pine Barrens Qualifier", rank: "Ranked #1 of 1", record: "1-0-0" });
    expect(JSON.stringify(a.stat)).not.toMatch(/Winning Alliance\)|Inspire Award"/);
    expect((await searchAnswer("4215 best event ever", { limit: 25 })).stat).toMatchObject({ title: "Best event", headline: { value: "#1 of 1", label: "Pine Barrens Qualifier", sub: expect.stringMatching(/^1-0-0 there/) } });
    expect((await searchAnswer("4215 worst event ever", { limit: 25 })).stat).toMatchObject({ title: "Worst event", headline: { label: "New Jersey Championship - Parkway Division" } });
    expect((await searchAnswer("4215 event schedule this season", { limit: 25 })).stat!.headline).toMatchObject({ value: "2 events" });
  });
  it("Worlds divisions with their seasons, wins at Worlds, Worlds matches by the year it was held", async () => {
    expect((await searchAnswer("4215 worlds divisions", { limit: 25 })).stat!.none).toBe("No Worlds appearances found in Hypnotic Robotics (4215)'s recorded event history.");
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'FTCCMP1EDIS', 4215, 4)");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'FTCCMP1EDIS', 'qual', 0, 3, 'Q3', '2026-04-29T10:00:00Z', 1, 210, 210, 150, 150, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'FTCCMP1EDIS', 'qual', 0, 3, 4215, 'red', 1)");
    clearAllCaches();
    const d = await searchAnswer("championship divisions 4215 played in", { limit: 25 });
    expect(d.stat).toMatchObject({ title: "Worlds divisions", headline: { value: "1 appearance", label: "Edison Division 2025–26" } });
    expect((await searchAnswer("4215 worlds wins", { limit: 25 })).stat).toMatchObject({ intent: "wins-count", headline: { value: "1 win" } });
    const m = await searchAnswer("4215 matches at worlds in 2026", { limit: 25 });
    expect(m.stat).toMatchObject({ title: "Matches at Worlds in 2025–26", headline: { value: "1-0-0" } });
    expect((await searchAnswer("4215 matches at worlds in 2025", { limit: 25 })).stat!.none).toBe("No Worlds matches found for Hypnotic Robotics (4215) in 2024–25 (the 2025 FIRST Championship). Its Worlds matches on record are from 2025–26.");
  });
  it("the winning alliance at a team's last event; 'championship' alone is the FIRST Championship", async () => {
    const a = await searchAnswer("winning alliance at 7149's last event", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "23268 Ultraviolet, 7149 ENFORCERS, 207 Critical Mass", label: "Won New Jersey Championship - Parkway Division" });
    const champs = (await searchAnswer("ftc decode winning alliance", { limit: 25 })).stat!.headline;
    expect((await searchAnswer("decode championship winning alliance", { limit: 25 })).stat!.headline).toEqual(champs);
  });
  it("an event's code with the word event is that event, from its record", async () => {
    const a = await searchAnswer("FTCCMP1EDIS event", { limit: 25 });
    expect(a.hits[0]).toMatchObject({ kind: "event", ref: "2025:FTCCMP1EDIS", event: { start: "2026-04-29" } });
    expect(a.understood?.label).toMatch(/^Event FTCCMP1EDIS/);
  });
});
