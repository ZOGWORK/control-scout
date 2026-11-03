// Stat answers (server/api/answers/) on a small fixture database: what's read as a stat question and its scope, and
// the answers of the superlative and aggregate families: Worlds-only scores and records, every season, the team's
// latest season for "this season", which event, streaks and the record split by colour. Nothing found says so.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { pageMeta } from "../../seoMeta";
import { searchAnswer } from "../searchAnswer";
import { readStatQuestion } from "./read";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [23268, "Ultraviolet"], [207, "Critical Mass"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2024, ?), (2025, ?)", [n, n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Houston', 'TX', 'USA', ?, ?, 't')", [season, code, name, type, start, start]);
  await ev(2024, "FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", "2025-04-16");
  await ev(2024, "USNJCMP", "New Jersey Championship", "Championship", "2025-03-15");
  await ev(2025, "USNJQ1", "New Jersey Qualifier", "Qualifier", "2026-01-10");
  await ev(2025, "USNJSCR", "Summer Scrimmage", "Scrimmage", "2026-07-01");
  const match = (season: number, code: string, n: number, time: string, red: [number, number], blue: [number, number], teams: [number, string, number?][], level = "qual") => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [season, code, level, n, `${level === "qual" ? "Q" : "M"}${n}`, time, ...red, ...blue]),
    ...teams.map(([t, alliance, on = 1]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, ?, 0, ?, ?, ?, ?)", [season, code, level, n, t, alliance, on])),
  ]);
  // State championship 2024–25: 4215's best score of all (330 without penalties), a win and a loss.
  await match(2024, "USNJCMP", 1, "2025-03-15T10:00:00Z", [340, 330], [100, 100], [[4215, "red"], [207, "red"], [6980, "blue"], [23268, "blue"]]);
  await match(2024, "USNJCMP", 2, "2025-03-15T11:00:00Z", [90, 90], [120, 120], [[4215, "red"], [207, "red"], [6980, "blue"], [23268, "blue"]]);
  // Worlds 2024–25: two wins and a loss; the best there is 260 (275 with the other alliance's penalties).
  await match(2024, "FTCCMP1EDIS", 1, "2025-04-17T10:00:00Z", [275, 260], [200, 200], [[4215, "red"], [23268, "red"], [6980, "blue"], [207, "blue"]]);
  await match(2024, "FTCCMP1EDIS", 2, "2025-04-17T11:00:00Z", [210, 210], [150, 150], [[4215, "blue"], [207, "blue"], [6980, "red"], [23268, "red"]]);
  await match(2024, "FTCCMP1EDIS", 3, "2025-04-17T12:00:00Z", [180, 180], [120, 120], [[4215, "red"], [6980, "red"], [207, "blue"], [23268, "blue"]]);
  // 2025–26: a win, a loss, then the latest match a win (a one-win streak to date).
  await match(2025, "USNJQ1", 1, "2026-01-10T10:00:00Z", [100, 100], [60, 60], [[4215, "red"], [207, "red"], [6980, "blue"], [23268, "blue"]]);
  await match(2025, "USNJQ1", 2, "2026-01-10T11:00:00Z", [120, 120], [80, 80], [[4215, "blue"], [23268, "blue"], [6980, "red"], [207, "red"]]);
  await match(2025, "USNJQ1", 3, "2026-01-10T12:00:00Z", [140, 140], [40, 40], [[4215, "red"], [207, "red"], [6980, "blue"], [23268, "blue"]]);
  // A scrimmage never counts, however high.
  await match(2025, "USNJSCR", 1, "2026-07-01T10:00:00Z", [500, 500], [0, 0], [[4215, "red"]]);
  await rebuildSearch();
});

describe("what's read as a stat question", () => {
  it("reads the intent, its scope and the team", () => {
    expect(readStatQuestion("4215 highest score in worlds")).toMatchObject({ id: "highest-score", core: "4215", scope: { championship: true } });
    expect(readStatQuestion("4215 highest score ever")).toMatchObject({ id: "highest-score", core: "4215", scope: { ever: true } });
    expect(readStatQuestion("How many matches has 4215 won at worlds")).toMatchObject({ id: "wins-count", core: "4215", scope: { championship: true } });
    expect(readStatQuestion("4215 worlds record")).toMatchObject({ id: "record", core: "4215", scope: { championship: true } });
    expect(readStatQuestion("Which event did 4215 score highest in")).toMatchObject({ id: "highest-score", core: "4215", leadEvent: true });
    expect(readStatQuestion("4215 average score this season")).toMatchObject({ id: "average-score", core: "4215", scope: { latest: true } });
    expect(readStatQuestion("hypnotic robotics last 3 matches")).toMatchObject({ id: "last-matches", n: 3, core: "hypnotic robotics" });
    expect(readStatQuestion("4215 red vs blue record")).toMatchObject({ id: "red-blue-record", scope: { alliance: null } });
    // A team named inside the intent's words keeps its scope words.
    expect(readStatQuestion("How many matches has 4215 in 2024-25 played")).toMatchObject({ id: "total-matches", core: "4215", scope: { season: 2024 } });
    expect(readStatQuestion("4215 closest win")).toMatchObject({ id: "closest-match", outcome: "W" });
    expect(readStatQuestion("4215 current losing streak")).toMatchObject({ id: "current-streak", outcome: "L" });
    // A bare year is its season, as search reads it; with nothing else naming a team, it's the team's number.
    expect(readStatQuestion("4215 worlds record 2024")).toMatchObject({ id: "record", core: "4215", scope: { championship: true, season: 2024 } });
    expect(readStatQuestion("4215 average score 2024")).toMatchObject({ id: "average-score", core: "4215", scope: { season: 2024 } });
    expect(readStatQuestion("2024 worlds record")).toMatchObject({ id: "record", core: "2024", scope: { championship: true, season: null } });
  });
  it("never drops a scope its answer can't apply: those are left to search", () => {
    for (const q of ["4215 seasons played at worlds", "4215 best season in playoffs", "4215 total events on red", "4215 best event finish in playoffs"]) expect(readStatQuestion(q), q).toBeNull();
    expect(readStatQuestion("4215 total events at worlds")).toMatchObject({ id: "total-events", scope: { championship: true } });
  });
  it("leaves to search what it doesn't answer: a plain record, a season's high scores, a team at an event, no team", () => {
    for (const q of ["4215 record", "4215 high score", "hypnotic best score in decode", "highest score this season", "world record score decode", "4215 record at New Jersey Championship", "hypnotic robotics", "average score"]) {
      expect(readStatQuestion(q), q).toBeNull();
    }
  });
});

describe("the answers", () => {
  it("Worlds: the best score there, its match, event and season, from championship matches only", async () => {
    const a = await searchAnswer("4215 highest score in worlds", { limit: 25 });
    expect(a.step).toBe("deterministic");
    expect(a.understood?.label).toBe("Hypnotic Robotics (4215) · Highest score at Worlds");
    expect(a.stat).toMatchObject({ family: "superlative", intent: "highest-score", headline: { value: "260 points", label: "Q1 at Worlds · Edison Division", href: "/events/2024/FTCCMP1EDIS?match=qual:0:1" } });
    expect(a.stat!.scope).toEqual(["FIRST Championship (Worlds)", "All seasons"]);
    expect(a.stat!.definition).toMatch(/without penalties/);
    expect(a.stat!.source).toBe("From 3 match records at 1 event, 2024–25");
  });
  it("no Worlds matches: said plainly, never another team's", async () => {
    const b = await searchAnswer("207 highest score at states", { limit: 25 });
    expect(b.stat).toMatchObject({ title: "Highest score at state championships", headline: { value: "330 points" } });
    await run("INSERT INTO teams (number, name) VALUES (99, 'Newcomers')");
    await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'USNJQ1', 99)");
    const c = await searchAnswer("99 worlds record", { limit: 25 });
    expect(c.stat).toMatchObject({ blocks: [], none: "No Worlds matches found for Newcomers (99)." });
  });
  it("ever: every season, the best of each season beside it; a scrimmage never counts", async () => {
    const a = await searchAnswer("4215 highest score ever", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "330 points", label: "Q1 at New Jersey Championship" });
    const per = a.stat!.blocks.find((b) => b.kind === "table");
    expect(per && per.kind === "table" && per.rows.map((r) => r.cells.score)).toEqual([140, 330]);
  });
  it("which event: the same rule, the answer leads with the event", async () => {
    const a = await searchAnswer("Which event did 4215 score highest in", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "New Jersey Championship", label: "330 points in Q1", href: "/events/2024/USNJCMP?team=4215" });
  });
  it("wins and the record at Worlds only, with the matches and seasons counted", async () => {
    const w = await searchAnswer("How many matches has 4215 won at worlds", { limit: 25 });
    expect(w.stat!.headline).toMatchObject({ value: "2 wins", label: "in 3 matches at Worlds", sub: "2024–25" });
    const r = await searchAnswer("4215 worlds record", { limit: 25 });
    expect(r.stat!.headline).toMatchObject({ value: "2-1-0" });
    expect(r.stat!.blocks[0]).toMatchObject({ kind: "record", wins: 2, losses: 1, ties: 0 });
  });
  it("this season: the team's latest season with matches, and it says so", async () => {
    const a = await searchAnswer("4215 average score this season", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "106.7", sub: "2025–26" });
    expect(a.stat!.definition).toMatch(/"This season" here is 2025–26/);
  });
  it("streaks, the last matches and the record split by colour", async () => {
    expect((await searchAnswer("4215 current streak", { limit: 25 })).stat!.headline).toMatchObject({ value: "1 win" });
    expect((await searchAnswer("4215 longest win streak", { limit: 25 })).stat!.headline).toMatchObject({ value: "2 wins" });
    expect((await searchAnswer("4215 last 3 matches", { limit: 25 })).stat!.headline).toMatchObject({ value: "2-1-0", sub: "W L W" });
    const c = await searchAnswer("4215 red vs blue record", { limit: 25 });
    expect(c.stat!.headline!.value).toBe("5-1-0 red · 0-2-0 blue");
    // The latest match was a win: no losing streak now, said so.
    expect((await searchAnswer("4215 current losing streak", { limit: 25 })).stat!.headline).toMatchObject({ value: "0", label: "no losing streak now: the latest match was a win" });
  });
  it("closest win and closest loss keep the result asked for", async () => {
    // Wins by 260-200 (60), 180-120 (60), 340-100, 100-60 (40), 140-40; losses 90-120 (30), 150-210 (60), 80-120 (40).
    expect((await searchAnswer("4215 closest win", { limit: 25 })).stat!.headline).toMatchObject({ value: "40 points", label: "100–60 in Q1 at New Jersey Qualifier" });
    expect((await searchAnswer("4215 closest loss", { limit: 25 })).stat!.headline).toMatchObject({ value: "30 points", label: "90–120 in Q2 at New Jersey Championship" });
  });
  it("a result answer shows the official totals; a score answer the points without penalties", async () => {
    const win = await searchAnswer("4215 biggest win", { limit: 25 });
    const rows = win.stat!.blocks.flatMap((b) => (b.kind === "matches" ? b.rows : []));
    expect(rows.every((r) => r.ownNp === undefined)).toBe(true);
    const high = await searchAnswer("4215 highest score in worlds", { limit: 25 });
    expect(high.stat!.blocks.flatMap((b) => (b.kind === "matches" ? b.rows : []))[0]).toMatchObject({ own: 275, ownNp: 260 });
  });
  it("the dropdown gets the same reading and hits, without the blocks", async () => {
    const a = await searchAnswer("4215 worlds record", { limit: 15 });
    expect(a.stat).toBeUndefined();
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "4215" });
    expect(a.understood?.label).toBe("Hypnotic Robotics (4215) · Record at Worlds");
  });
  it("a team found by a correction keeps search's warning", async () => {
    // Search corrects only to a team that has played (its event stats).
    await run("INSERT INTO team_event_stats (season, code, team, matches) VALUES (2024, 'FTCCMP1EDIS', 4215, 3)");
    const a = await searchAnswer("hipnotic robotics worlds record", { limit: 25 });
    expect(a).toMatchObject({ step: "did-you-mean", didYouMean: "Hypnotic Robotics worlds record" });
    expect(a.stat!.headline).toMatchObject({ value: "2-1-0" });
  });
  it("the first paint says the answer before the app loads", async () => {
    const m = await pageMeta("/search", { q: "4215 worlds record" });
    expect(m.bodyHtml).toMatch(/<h2>Record at Worlds<\/h2>/);
    expect(m.bodyHtml).toContain("<b>2-1-0</b>");
    expect(m.heading).not.toMatch(/^No matches/);
  });
});
