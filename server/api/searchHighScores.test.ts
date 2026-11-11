// High-score questions (server/api/searchHighScores.ts) on a small fixture database: what's read as one (a game named
// with any spacing, a season label, "this season"; never a team's win-loss "record"), a season's best scores without
// penalties from official events only, a team's, and before a season's first official match its scrimmages' best,
// said plainly.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { parseHighScore } from "./searchHighScores";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [23268, "Ultraviolet"], [207, "Critical Mass"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Hillsborough', 'NJ', 'USA', ?, ?, 't')", [season, code, name, type, start, start]);
  await ev(2025, "USNJCMP", "New Jersey Championship", "Championship", "2026-03-15");
  await ev(2025, "USNJSCR", "Summer Scrimmage", "Scrimmage", "2026-07-01");
  await ev(2026, "USNJSCR1", "Kickoff Scrimmage", "Scrimmage", "2026-09-20");
  const match = (season: number, code: string, n: number, red: [number, number], blue: [number, number], teams: [number, string, number?][], level = "qual") => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, ?, 0, ?, ?, 1, ?, ?, ?, ?, 't')", [season, code, level, n, `${level === "qual" ? "Q" : "M"}${n}`, ...red, ...blue]),
    ...teams.map(([t, alliance, on = 1]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, ?, 0, ?, ?, ?, ?)", [season, code, level, n, t, alliance, on])),
  ]);
  // Q1: blue's 900 is mostly red's penalties; red's 250 is the best score without penalties.
  await match(2025, "USNJCMP", 1, [262, 250], [900, 180], [[4215, "red"], [23268, "red"], [6980, "blue"], [207, "blue"]]);
  await match(2025, "USNJCMP", 2, [221, 221], [190, 190], [[207, "red"], [6980, "red"], [4215, "blue"], [23268, "blue"]]);
  // A playoff: 207 sat it out (its alliance's third team), so its 300 is 6980's and 23268's, never 207's.
  await match(2025, "USNJCMP", 9, [300, 300], [50, 50], [[6980, "red"], [23268, "red"], [207, "red", 0], [4215, "blue"]], "playoff");
  // 2021: penalties came off the alliance's own score.
  await ev(2021, "USNJ21", "Freight Frenzy Qualifier", "Qualifier", "2022-01-15");
  await match(2021, "USNJ21", 1, [140, 160], [90, 90], [[4215, "red"], [207, "red"]]);
  // Scrimmages: never the record, however high.
  await match(2025, "USNJSCR", 1, [400, 400], [10, 10], [[6980, "red"]]);
  await match(2026, "USNJSCR1", 1, [120, 115], [80, 80], [[4215, "red"], [207, "blue"]]);
  await rebuildSearch();
});

describe("what's read as a high-score question", () => {
  it("reads the game with any spacing, a season label or this season, and what's left names the team", () => {
    expect(parseHighScore("World record score bio buzz")).toEqual({ season: 2026, game: "BIOBUZZ", core: "" });
    expect(parseHighScore("world record score BIOBUZZ")).toMatchObject({ season: 2026, core: "" });
    expect(parseHighScore("highest score in into the deep")).toMatchObject({ season: 2024, game: "INTO THE DEEP", core: "" });
    expect(parseHighScore("what is the highest score in 2025-26")).toMatchObject({ season: 2025, core: "" });
    expect(parseHighScore("4215 high score")).toEqual({ season: null, game: null, core: "4215" });
    expect(parseHighScore("hypnotic robotics best score this season")).toMatchObject({ season: 2026, core: "hypnotic robotics" });
    // "Official" only says what a record is (official events): never a team's words (failed search #1339).
    expect(parseHighScore("decode official world record")).toMatchObject({ season: 2025, core: "" });
  });
  it("a team's win-loss record or a plain search is never one", () => {
    for (const q of ["4215 record", "hypnotic robotics", "score", "records"]) expect(parseHighScore(q), q).toBeNull();
  });
});

describe("the answer", () => {
  it("a season's best scores without penalties, official events only, each a link to its match with its alliance", async () => {
    const a = await searchAnswer("world record score decode");
    expect(a.card).toMatchObject({ kind: "high-scores", title: "Highest scores in 2025–26 (DECODE)" });
    expect(a.card!.team).toBeUndefined();
    expect(a.card!.lines.map((l) => l.text)).toEqual(["300 points: M9 at New Jersey Championship", "250 points: Q1 at New Jersey Championship", "221 points: Q2 at New Jersey Championship", "190 points: Q2 at New Jersey Championship", "180 points: Q1 at New Jersey Championship"]);
    // The team sitting the playoff out isn't on its alliance.
    expect(a.card!.lines[0].results![0]).toBe("Red alliance: 6980 Bad Wolf, 23268 Ultraviolet");
    expect(a.card!.lines[1]).toMatchObject({
      detail: "2025–26 · Mar 15, 2026 · Hillsborough, NJ",
      results: ["Red alliance: 4215 Hypnotic Robotics, 23268 Ultraviolet", "262 with the other alliance's penalties"],
      href: "/events/2025/USNJCMP?match=qual:0:1",
    });
  });
  // A team's best score is the stat answer's (server/api/answers/families/matches.ts), in every phrasing: the match
  // picked by its own points, shown at the official score, from official events only (a scrimmage never counts).
  it("a team's, in the latest season it played officially", async () => {
    const a = await searchAnswer("4215 high score", { limit: 25 });
    expect(a.card).toBeUndefined();
    expect(a.stat).toMatchObject({ intent: "highest-score", headline: { value: "262 points", label: "Q1 at New Jersey Championship (official score, penalties included)", sub: expect.stringContaining("250 without penalties") } });
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "4215" });
    const d = await searchAnswer("hypnotic best score in decode", { limit: 25 });
    // The team's link opens the season asked about.
    expect(d.hits[0]).toMatchObject({ kind: "team", ref: "4215", section: "matches", linkSeason: 2025 });
    const ms = d.stat!.blocks.find((b) => b.kind === "matches");
    expect(ms && ms.kind === "matches" && ms.rows.map((r) => `${r.label} ${r.own}`)).toEqual(["Q1 262", "Q2 190", "M9 50"]);
  });
  it("a team's best never counts a match it sat out", async () => {
    const a = await searchAnswer("critical mass best score in decode", { limit: 25 });
    const ms = a.stat!.blocks.find((b) => b.kind === "matches");
    expect(ms && ms.kind === "matches" && ms.rows.map((r) => `${r.label} ${r.own}`)).toEqual(["Q2 221", "Q1 900"]);
  });
  it("2020–21 and 2021–22: penalties came off the alliance's own score, and it says so", async () => {
    // A season's highest score with no team is the stat answer's (server/api/answers/families/topMatches.ts).
    const a = await searchAnswer("highest score in freight frenzy", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "160 points", label: "Q1 at Freight Frenzy Qualifier" });
    expect(a.stat!.definition).toContain("penalties came off the alliance's own score");
    const ms = a.stat!.blocks.find((b) => b.kind === "matches");
    expect(ms && ms.kind === "matches" && ms.rows[0]).toMatchObject({ own: 140, ownNp: 160, partners: [{ label: "207 Critical Mass" }, { label: "4215 Hypnotic Robotics" }] });
  });
  it("the season's first official match not played yet: no record, its scrimmages' best below", async () => {
    const a = await searchAnswer("World record score bio buzz");
    expect(a.card!.lines).toEqual([]);
    expect(a.card!.none).toMatch(/no record yet/);
    expect(a.card!.closest!.map((l) => l.text)).toEqual(["115 points: Q1 at Kickoff Scrimmage", "80 points: Q1 at Kickoff Scrimmage"]);
  });
});

describe("the season's record line (the match records page)", () => {
  it("is the answer's own first line: official events, penalties left out, never a scrimmage's higher score", async () => {
    const { seasonRecordLine } = await import("./searchHighScores");
    const a = await searchAnswer("world record score decode");
    const line = await seasonRecordLine(2025);
    // The same line, without the card's label for it.
    const { tag, ...first } = a.card!.lines[0];
    expect(tag).toBe("Official world record");
    expect(line).toEqual(first);
    expect(line?.text).toBe("300 points: M9 at New Jersey Championship");
    expect(await seasonRecordLine(2019)).toBeNull();
  });
  it("/matches says the same record above its table", async () => {
    const { pageMeta } = await import("../seoMeta");
    const html = (await pageMeta("/matches", { season: "2025" })).bodyHtml ?? "";
    expect(html).toContain("Season record 2025–26:");
    expect(html).toContain(">300 points: M9 at New Jersey Championship</a>");
  });
  it("a search page answered by the card alone describes that answer, never 'no match'", async () => {
    const { pageMeta } = await import("../seoMeta");
    const m = await pageMeta("/search", { q: "world record score decode" });
    // The page's own answer (a stat here): its title, then its record.
    expect(m.description).toMatch(/^Highest[^:]*DECODE[^:]*: 300 points .*M9 at New Jersey Championship$/);
    expect(m.description).not.toMatch(/^No FTC team/);
    expect((await pageMeta("/search", { q: "zzqqxxvv" })).description).toBe("No FTC team, event or match matches “zzqqxxvv”.");
  });
});

describe("recordMarks", () => {
  it("keeps what changes how the record's number reads, never the alliance line", async () => {
    const { recordMarks } = await import("../../src/shared/seasonRecord");
    expect(recordMarks({ results: ["Red alliance: 1 A", "Penalties not posted"] })).toBe("Penalties not posted");
    expect(recordMarks({ results: ["Red alliance: 1 A", "Not an official record: why"] })).toBe("Not an official record: why");
    expect(recordMarks({ results: ["Red alliance: 1 A"] })).toBeNull();
  });
});

describe("a highlights headline's penalty wording", () => {
  it("says without penalties only when they were posted", async () => {
    const { withoutPenalties } = await import("../../src/shared/seasonRecord");
    expect(withoutPenalties("Best score", 78)).toBe("Best score without penalties");
    expect(withoutPenalties("Best score", null)).toBe("Best score, penalties not posted");
    expect(withoutPenalties("Closest finish", null)).toBe("Closest finish");
  });
});

describe("\"official\" asked: official records only (failed search #1339, Carolinas Premier Event)", () => {
  beforeAll(async () => {
    // An event that didn't play by the game's usual rules (server/data/unofficialRecords.ts): its scores are no record.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'FPECAR', 'Carolinas Premier Event', 'Premier', 'Raleigh', 'NC', 'USA', '2026-07-25', '2026-07-26', 't')");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'FPECAR', 'qual', 0, 49, 'Q49', 1, 714, 714, 100, 100, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'FPECAR', 'qual', 0, 49, 4215, 'red', 1)");
    await rebuildSearch();
  });
  it("reads 'official' as asked", () => {
    expect(parseHighScore("decode official world record")).toMatchObject({ season: 2025, core: "", official: true });
    expect(parseHighScore("decode world record")).not.toHaveProperty("official");
  });
  it("the record card leads with the official record, titled and labelled so; without 'official' it still leads, the marked score after it", async () => {
    const off = await searchAnswer("decode official world record", { limit: 10, learn: false });
    expect(off.card?.title).toBe("Highest official scores in 2025–26 (DECODE)");
    expect(off.card?.lines[0]).toMatchObject({ text: "300 points: M9 at New Jersey Championship", tag: "Official world record" });
    expect(off.card?.lines.some((l) => l.text.includes("Carolinas"))).toBe(false);
    const all = await searchAnswer("decode world record", { limit: 10, learn: false });
    expect(all.card?.lines[0]).toMatchObject({ text: "300 points: M9 at New Jersey Championship", tag: "Official world record" });
    expect(all.card?.lines[1].text).toBe("714 points: Q49 at Carolinas Premier Event");
    expect(all.card?.lines[1].results).toContain("Not an official record: the event did not play by the game's usual rules");
    expect(all.card?.lines.filter((l) => l.tag)).toHaveLength(1);
    // A team's: its own official best, labelled so.
    expect((await searchAnswer("4215 decode world record", { limit: 10, learn: false })).card?.lines[0]).toMatchObject({ text: "250 points: Q1 at New Jersey Championship", tag: "Official best" });
  });
  it("the top-matches answer leads with an official record too", async () => {
    const off = await searchAnswer("best official decode score", { limit: 10, learn: false, full: true });
    expect(off.stat?.title).toMatch(/^Highest-scoring official matches/);
    expect(off.stat?.headline?.value).toBe("300 points");
    expect((await searchAnswer("best decode score", { limit: 10, learn: false, full: true })).stat?.headline?.value).toBe("714 points");
  });
  it("every season's best, 'official' said: each heading says so, and the season's row is its official record (Loopy on #1357)", async () => {
    const a = await searchAnswer("highest official score ever", { limit: 10, learn: false, full: true });
    expect(a.stat?.title).toBe("Highest-scoring official match each season");
    const table = a.stat?.blocks.find((b) => b.kind === "table");
    expect(table?.kind === "table" && table.title).toBe("Highest official alliance score each season (each season is a different game)");
    const row = table?.kind === "table" ? table.rows.find((r) => String(r.cells.season).includes("2025–26")) : undefined;
    expect(row?.cells.score).toBe(300);
    expect(a.stat?.definition).toContain("Only official records are listed");
  });
  it("an event whose matches are none of them official records says so, never that none were played (Loopy on #1357)", async () => {
    const a = await searchAnswer("best official score at FPECAR", { limit: 10, learn: false, full: true });
    expect(a.stat?.none).toBe("No official records at Carolinas Premier Event in 2025–26: the matches played are not official records (the event did not play by the game's usual rules).");
    expect((await searchAnswer("best score at FPECAR", { limit: 10, learn: false, full: true })).stat?.headline?.value).toBe("714 points");
  });
});

describe("\"decode official world record\": the official record first and labelled (Sushil, 11-11)", () => {
  beforeAll(async () => {
    // As live: 714 and 592 at Carolinas Premier Event (not official records), 574 in M14 at FIRST Championship, Ross Division.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'FTCCMPROSS', 'FIRST Championship, Ross Division', 'Championship', 'Houston', 'TX', 'USA', '2026-04-15', '2026-04-18', 't')");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'FPECAR', 'qual', 0, 54, 'Q54', 1, 592, 592, 100, 100, 't')");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'FTCCMPROSS', 'playoff', 14, 1, 'M14', 1, 120, 120, 594, 574, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'FTCCMPROSS', 'playoff', 14, 1, 6980, 'blue', 1)");
    await rebuildSearch();
  });
  it("the first row is the 574 in M14 at Ross Division, labelled the official world record; no unofficial score is listed", async () => {
    const a = await searchAnswer("decode official world record", { limit: 10, learn: false });
    expect(a.card?.lines[0]).toMatchObject({ text: "574 points: M14 at FIRST Championship, Ross Division", tag: "Official world record" });
    expect(a.card?.lines.some((l) => /Carolinas/.test(l.text))).toBe(false);
  });
  it("\"decode world record\": the same official record leads, the higher unofficial scores after it, marked", async () => {
    const lines = (await searchAnswer("decode world record", { limit: 10, learn: false })).card!.lines;
    expect(lines.map((l) => l.text.split(" at ")[0])).toEqual(["574 points: M14", "714 points: Q49", "592 points: Q54", "300 points: M9", "250 points: Q1"]);
    expect(lines[0].tag).toBe("Official world record");
    for (const l of lines.slice(1, 3)) expect(l.results).toContain("Not an official record: the event did not play by the game's usual rules");
  });
});
