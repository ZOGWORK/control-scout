// The team answer cards the search display audit found missing or thin (v2.8.9): "4215 record" (a whole season's record
// with its win rate, season and world rank by win rate), "4215 awards" / "awards 4215 has won" (every award, grouped by
// season, newest first, the Inspire Award never called 1st place) and the listing facts ("4215 sponsors and school",
// "where is 4215 from") with each value apart, exactly as stored.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readStatQuestion } from "./read";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country, school, sponsors) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA', 'River Dell Regional High Sch', ?)", [JSON.stringify(["Gene Haas", "Unique Scaffolding Systems"])]);
  for (const [n, name] of [[6980, "Bad Wolf"], [23268, "Ultraviolet"], [207, "Critical Mass"]] as const) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
  for (const n of [4215, 6980, 23268, 207]) await run("INSERT INTO team_seasons (season, team) VALUES (2024, ?), (2025, ?)", [n, n]);
  const ev = (season: number, code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Oradell', 'NJ', 'USA', ?, ?, 't')", [season, code, name, type, start, start]);
  await ev(2024, "USNJCMP", "New Jersey Championship", "Championship", "2025-03-15");
  await ev(2025, "USNJQ1", "New Jersey Qualifier", "Qualifier", "2026-01-10");
  const match = (season: number, code: string, n: number, red: number, blue: number, redTeams: number[], blueTeams: number[]) => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, NULL, 1, ?, ?, ?, ?, 't')", [season, code, n, `Q${n}`, red, red, blue, blue]),
    ...redTeams.map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, 'red', 1)", [season, code, n, t])),
    ...blueTeams.map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, 'blue', 1)", [season, code, n, t])),
  ]);
  // 2024–25: a loss. 2025–26 (the latest): 3 wins and a loss, 3-1-0.
  await match(2024, "USNJCMP", 1, 50, 90, [4215, 207], [6980, 23268]);
  await match(2025, "USNJQ1", 1, 100, 60, [4215, 207], [6980, 23268]);
  await match(2025, "USNJQ1", 2, 120, 80, [4215, 23268], [6980, 207]);
  await match(2025, "USNJQ1", 3, 140, 40, [4215, 207], [6980, 23268]);
  await match(2025, "USNJQ1", 4, 40, 140, [4215, 6980], [207, 23268]);
  // The season's stored numbers, as the highest-win-rate list ranks them: 23268 (4-0) first, then 4215 (3-1), 207 and 6980.
  for (const [team, w, l, opr] of [[4215, 3, 1, 50], [23268, 4, 0, 40], [207, 2, 2, 60], [6980, 0, 4, 30]]) {
    await run("INSERT INTO team_season_stats (season, team, matches, wins, losses, ties, opr_np) VALUES (2025, ?, ?, ?, ?, 0, ?)", [team, w + l, w, l, opr]);
  }
  // Awards over two seasons: a 1st place (Winning Alliance) and an Inspire Award in 2025–26, a 2nd place Inspire in 2024–25.
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (2025, 'USNJQ1', 'Winner', 1, 4215), (2025, 'USNJQ1', 'Inspire', 1, 4215), (2024, 'USNJCMP', 'Inspire', 2, 4215), (2024, 'USNJCMP', 'Think', 1, 4215)");
  await rebuildSearch();
});

const page = (q: string) => searchAnswer(q, { limit: 25 });

describe("\"4215 record\": the latest season's record", () => {
  it("is read alone, on the team's latest season; a scope keeps its own season", () => {
    expect(readStatQuestion("4215 record")).toMatchObject({ id: "record", core: "4215", defaultSeason: "latest" });
    expect(readStatQuestion("hypnotic robotics record")).toMatchObject({ id: "record", defaultSeason: "latest" });
    expect(readStatQuestion("4215 worlds record")).toMatchObject({ id: "record", defaultSeason: "all", scope: { championship: true } });
    // A bare year left as the team's number is no scope: still that team's latest season.
    expect(readStatQuestion("2024 record")).toMatchObject({ id: "record", core: "2024", defaultSeason: "latest", scope: { season: null } });
  });
  it("big W-L-T, the split bar, win rate, season and the world rank by win rate", async () => {
    const a = await page("4215 record");
    expect(a.stat).toMatchObject({ intent: "record", title: "Record in 2025–26", headline: { value: "3-1-0", label: "75% win rate in 4 matches in 2025–26" } });
    expect(a.understood?.label).toBe("Hypnotic Robotics (4215) · Record in 2025–26");
    const kpis = a.stat!.blocks.find((b) => b.kind === "kpis");
    expect(kpis && kpis.kind === "kpis" && kpis.items.map((k) => [k.label, k.value, k.sub])).toEqual([
      ["Win rate", "75%", "4 matches"], ["Season", "2025–26"], ["World rank by win rate", "#2", "of 4 teams"],
    ].map(([l, v, s]) => [l, v, s]));
    expect(a.stat!.blocks.find((b) => b.kind === "record")).toMatchObject({ wins: 3, losses: 1, ties: 0 });
    expect(a.stat!.definition).toMatch(/World rank by win rate/);
    expect(a.stat!.definition).toMatch(/The season is 2025–26, the team's latest/);
  });
  it("a team with no match on record keeps search's own team answer", async () => {
    await run("INSERT INTO teams (number, name) VALUES (31999, 'Fresh Start')");
    await rebuildSearch();
    const a = await page("31999 record");
    expect(a.stat).toBeUndefined();
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "31999" });
  });
  it("a record over several seasons or narrowed to Worlds has no season rank", async () => {
    const a = await page("4215 record all time");
    expect(a.stat?.blocks.some((b) => b.kind === "kpis")).toBe(false);
    expect(a.stat?.headline?.value).toBe("3-2-0");
  });
});

describe("\"4215 awards\": every award, grouped by season", () => {
  it("is read alone and from \"awards 4215 has won\"", () => {
    for (const q of ["4215 awards", "awards 4215 has won", "what awards has 4215 won"]) expect(readStatQuestion(q), q).toMatchObject({ id: "awards", core: "4215" });
    expect(readStatQuestion("awards")).toBeNull();
  });
  it("a table per season, newest first, with each award's event and date; Inspire is never 1st place", async () => {
    for (const q of ["4215 awards", "awards 4215 has won"]) {
      const a = await page(q);
      expect(a.stat, q).toMatchObject({ intent: "awards", headline: { value: "4 awards" } });
      const tables = a.stat!.blocks.filter((b) => b.kind === "table");
      expect(tables.map((t) => t.kind === "table" && t.title)).toEqual(["2025–26 · 2 awards", "2024–25 · 2 awards"]);
      const first = tables[0].kind === "table" ? tables[0] : null;
      expect(first!.columns.map((c) => c.key)).toEqual(["award", "event", "date"]);
      expect(first!.rows.map((r) => r.cells.award)).toEqual(["1st place (Winning Alliance)", "Inspire Award"]);
      expect(first!.rows[0].cells).toMatchObject({ event: "New Jersey Qualifier", date: expect.stringMatching(/2026/) });
      const awards = tables.flatMap((t) => (t.kind === "table" ? t.rows.map((r) => String(r.cells.award)) : []));
      expect(awards.filter((x) => /inspire/i.test(x) && /1st/.test(x))).toEqual([]);
    }
  });
});

describe("listing facts: one team card, each value apart, as stored", () => {
  it("sponsors: each its own row", async () => {
    const a = await page("4215 sponsors");
    expect(a.card).toMatchObject({ kind: "info", team: { number: 4215 }, facts: [{ label: "Sponsors", values: ["Gene Haas", "Unique Scaffolding Systems"] }] });
    expect(a.card!.related).toEqual(["4215 record", "4215 awards", "4215 opr"]);
    // The dropdown keeps its line.
    expect(a.card!.lines[0].text).toBe("Gene Haas, Unique Scaffolding Systems");
  });
  it("sponsors and school: the school exactly as FIRST's listing stores it, never cut further", async () => {
    const a = await page("4215 sponsors and school");
    expect(a.card!.facts).toEqual([
      { label: "Sponsors", values: ["Gene Haas", "Unique Scaffolding Systems"] },
      { label: "School or organization", values: ["River Dell Regional High Sch"] },
    ]);
  });
  it("where they're from: the location as one value", async () => {
    const a = await page("where is 4215 from");
    expect(a.card!.facts).toEqual([{ label: "Where they're from", values: ["Oradell, NJ, USA"] }]);
  });
  it("a fact FIRST's listing doesn't have: no values", async () => {
    expect((await page("6980 sponsors")).card!.facts).toEqual([{ label: "Sponsors", values: [] }]);
  });
});
