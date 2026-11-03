// Stat answers at one event, awards and winning alliances (server/api/answers/) on a small fixture database: a team
// at a named event (results, rank, OPR, one match), its event wins as 1st place and Inspire apart, award counts by
// kind, and the winning alliance of an event or a season's championship, decided by its final match. Worlds answers
// end with the season's championship events and related questions; nothing found says so.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
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
  it("counts and the judged/performance split", async () => {
    expect((await searchAnswer("4215 Inspire awards count", { limit: 25 })).stat!.headline).toMatchObject({ value: "1 Inspire Award", label: "plus 1 2nd or 3rd place Inspire" });
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
    expect(a.stat!.blocks.find((b) => b.kind === "links")).toMatchObject({ title: "Worlds events, 2025–26", items: [{ label: "Edison Division" }, { label: "Ochoa Division" }, { label: "Worlds finals", sub: "finals" }] });
  });
  it("a season with no championship in the data says so", async () => {
    const a = await searchAnswer("into the deep winning alliance", { limit: 25 });
    expect(a.stat!.none).toBe("No championship results yet for INTO THE DEEP: the 2024–25 FIRST Championship isn't in the data.");
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
    const n = await searchAnswer("4215 teams never played", { limit: 25 });
    expect(n.stat!.none).toBe("Hypnotic Robotics (4215) has played against every NJ team with matches in 2025–26.");
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
});
