// Records, match scores, penalties and form (families/matchStats.ts and families/matches.ts) on a fixture with phase
// points, penalties, ratings and a rookie: the completion list's group 66–115 and 141–160. What's read (a playoff or
// quals scope, events by place, a group of opponents never read as a team's name), and each answer's numbers.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readStatQuestion, readTwoTeam } from "./read";

type Side = [np: number, auto: number, teleop: number, endgame: number, pen: number];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, number | null][] = [[4215, "Hypnotic Robotics", 2010], [6980, "Bad Wolf", 2012], [207, "Critical Mass", 2008], [23268, "Rookie Robots", 2025], [9999, "Top Hat Robotics", 2015]];
  for (const [n, name, rookie] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Oradell', 'NJ', 'USA', ?)", [n, name, rookie]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2024, ?), (2025, ?)", [n, n]);
  }
  const ev = (season: number, code: string, name: string, type: string, state: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Town', ?, 'USA', ?, ?, 't')", [season, code, name, type, state, start, start]);
  await ev(2024, "FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", "TX", "2025-04-16");
  await ev(2025, "USNJQ1", "New Jersey Qualifier", "Qualifier", "NJ", "2026-01-10");
  await ev(2025, "USPAQ1", "Pennsylvania Qualifier", "Qualifier", "PA", "2026-02-07");
  await ev(2025, "USNJCMP", "New Jersey Championship", "Championship", "NJ", "2026-03-14");
  // Each alliance's own points and phases, and the penalty points it gave away (the other alliance's gain).
  const match = (season: number, code: string, level: string, n: number, time: string, red: Side, blue: Side, redTeams: number[], blueTeams: number[]) => Promise.all([
    run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
           blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 't')`,
      [season, code, level, n, `${level === "qual" ? "Q" : "M"}${n}`, time, red[0] + blue[4], ...red, blue[0] + red[4], ...blue]),
    ...redTeams.map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, ?, 0, ?, ?, 'red')", [season, code, level, n, t])),
    ...blueTeams.map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, ?, 0, ?, ?, 'blue')", [season, code, level, n, t])),
  ]);
  // 2025–26 for 4215: W W L at the NJ qualifier, W W in Pennsylvania (the 260 there is 200 of its own and 60 of the
  // other alliance's fouls; its best of its own is the 210), then L T and a playoff W at the NJ championship.
  await match(2025, "USNJQ1", "qual", 1, "2026-01-10T10:00:00Z", [90, 20, 50, 20, 0], [60, 10, 30, 20, 10], [4215, 207], [6980, 23268]);
  await match(2025, "USNJQ1", "qual", 2, "2026-01-10T11:00:00Z", [80, 10, 50, 20, 0], [120, 30, 70, 20, 5], [6980, 207], [4215, 23268]);
  await match(2025, "USNJQ1", "qual", 3, "2026-01-10T12:00:00Z", [70, 10, 40, 20, 20], [150, 40, 80, 30, 0], [4215, 6980], [207, 9999]);
  await match(2025, "USPAQ1", "qual", 1, "2026-02-07T10:00:00Z", [200, 40, 110, 50, 0], [100, 20, 60, 20, 60], [4215, 207], [9999, 6980]);
  await match(2025, "USPAQ1", "qual", 2, "2026-02-07T11:00:00Z", [90, 20, 50, 20, 0], [210, 60, 120, 30, 0], [207, 23268], [4215, 6980]);
  await match(2025, "USNJCMP", "qual", 1, "2026-03-14T10:00:00Z", [150, 30, 90, 30, 15], [150, 30, 90, 30, 0], [4215, 6980], [9999, 207]);
  await match(2025, "USNJCMP", "qual", 2, "2026-03-14T11:00:00Z", [130, 30, 80, 20, 0], [130, 30, 80, 20, 0], [6980, 23268], [4215, 207]);
  await match(2025, "USNJCMP", "playoff", 1, "2026-03-14T15:00:00Z", [180, 45, 100, 35, 0], [170, 40, 100, 30, 0], [4215, 207], [9999, 6980]);
  // Worlds 2024–25: two wins.
  await match(2024, "FTCCMP1EDIS", "qual", 1, "2025-04-17T10:00:00Z", [200, 50, 110, 40, 10], [150, 30, 90, 30, 0], [4215, 23268], [6980, 207]);
  await match(2024, "FTCCMP1EDIS", "qual", 2, "2025-04-17T11:00:00Z", [100, 20, 60, 20, 0], [220, 50, 130, 40, 0], [6980, 207], [4215, 9999]);
  // 777 at its own meet: one match with a breakdown (Endgame 20), one FIRST posted as totals only (its stored Endgame
  // is no breakdown's: never a phase record).
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (777, 'Totals Only', 'Oradell', 'NJ', 'USA')");
  await ev(2025, "USNJLM7", "Seven League Meet", "LeagueMeet", "NJ", "2026-01-20");
  await match(2025, "USNJLM7", "qual", 1, "2026-01-20T10:00:00Z", [100, 20, 60, 20, 0], [50, 10, 30, 10, 0], [777, 6980], [207, 23268]);
  await match(2025, "USNJLM7", "qual", 2, "2026-01-20T11:00:00Z", [150, 30, 21, 99, 0], [50, 10, 30, 10, 0], [777, 6980], [207, 23268]);
  await run("UPDATE matches SET breakdown = CASE number WHEN 2 THEN 0 ELSE 1 END WHERE code = 'USNJLM7'");
  await rebuildSearch();
  // The stored season numbers the team pages show: ratings (9999 the top one) and 4215's penalty share.
  for (const [team, rating, rank] of [[4215, 98, 2], [6980, 50, 3], [207, 30, 4], [23268, 10, 5], [9999, 150, 1]] as const) {
    await run("INSERT OR REPLACE INTO team_season_stats (season, team, rating_np, rating_rank, rating_pen) VALUES (2025, ?, ?, ?, ?)", [team, rating, rank, team === 4215 ? 8.4 : null]);
  }
});

const stat = async (q: string) => (await searchAnswer(q, { limit: 25, full: true })).stat;

describe("what's read", () => {
  it("a playoff or quals scope said before the intent, and a match type with no season is the latest", () => {
    expect(readStatQuestion("4215 playoff record this season")).toMatchObject({ id: "record", scope: { level: "playoff", latest: true }, core: "4215" });
    expect(readStatQuestion("4215 quals record this season")).toMatchObject({ id: "record", scope: { level: "qual" }, core: "4215" });
    expect(readStatQuestion("4215 record in quals")).toMatchObject({ id: "record", defaultSeason: "latest", scope: { level: "qual" } });
    // A list of playoff matches keeps its own words.
    expect(readStatQuestion("4215 playoff matches")).toMatchObject({ id: "playoff-matches", scope: { level: null } });
  });

  it("events by place: a region's, or outside the team's state", () => {
    expect(readStatQuestion("4215 record at New Jersey events")).toMatchObject({ id: "record", core: "4215", scope: { place: { state: "NJ" } } });
    expect(readStatQuestion("4215 record at out-of-state events")).toMatchObject({ id: "record", core: "4215", scope: { outOfState: true } });
  });

  it("each new intent, with the team left alone", () => {
    const cases: [string, string][] = [
      ["4215 ties all time", "ties-count"], ["4215 win rate", "win-percent"], ["4215 win rate by event", "win-rate"], ["4215 score range this season", "score-range"],
      ["4215 median score this season", "median-score"], ["4215 score consistency", "score-consistency"], ["4215 consistency rating", "score-consistency"],
      ["4215 scores over 200", "scores-over"], ["4215 matches where they scored over 150", "scores-over"], ["4215 highest alliance score", "highest-score"],
      ["4215 match with the most penalties", "most-penalties"], ["4215 match with the highest auto score", "highest-auto"], ["4215 match with the highest teleop score", "highest-teleop"],
      ["4215 match with the highest endgame score", "highest-endgame"], ["4215 fouls per match", "penalties"], ["4215 penalty rate", "penalties"], ["4215 penalties at worlds", "penalties"],
      ["4215 penalties in playoffs", "penalties"], ["4215 average penalties per event", "penalties"], ["4215 easiest opponent this season", "easiest-opponent"],
      ["4215 trend over their last 5 matches", "last-matches"], ["4215 form in their last 5 matches", "last-matches"], ["4215 improvement trend", "opr-history"],
      ["4215 performance against top teams", "vs-top"], ["4215 performance against rookie teams", "vs-rookies"], ["4215 late season form versus early season form", "early-late"],
    ];
    for (const [q, id] of cases) expect(readStatQuestion(q), q).toMatchObject({ id, core: "4215" });
    expect(readStatQuestion("4215 scores over 200")).toMatchObject({ n: 200 });
    expect(readStatQuestion("4215 penalty rate")).toMatchObject({ variant: "rate" });
    expect(readStatQuestion("4215 average penalties per event")).toMatchObject({ variant: "per-event" });
  });

  it("a group of opponents or a part of the season is never a team's name", () => {
    expect(readTwoTeam("4215 record against top teams")).toBeNull();
    expect(readTwoTeam("4215 record vs rookie teams")).toBeNull();
    expect(readTwoTeam("4215 record against 6980")).toMatchObject({ id: "head-to-head", a: "4215", b: "6980" });
    // "Biggest improvement" stays the season-over-season answer; only an improvement trend is the OPR trend.
    expect(readStatQuestion("4215 biggest improvement")).toMatchObject({ id: "most-improved-season" });
  });

  it("a rules question about a penalty is left to the rules", () => {
    expect(readStatQuestion("what is the penalty for pinning")).toBeNull();
    expect(readStatQuestion("major foul")).toBeNull();
  });
});

describe("records", () => {
  it("quals and playoffs records name their scope in the title", async () => {
    expect(await stat("4215 record in quals")).toMatchObject({ title: "Record in quals in 2025–26", headline: { value: "4-2-1" } });
    expect(await stat("4215 playoff record this season")).toMatchObject({ title: "Record in playoffs in 2025–26", headline: { value: "1-0-0" } });
  });

  it("a win rate leads with wins out of matches", async () => {
    const s = await stat("4215 win rate");
    expect(s).toMatchObject({ intent: "win-percent", title: "Win rate in 2025–26", headline: { value: "63%", label: "5 wins out of 8 matches in 2025–26" } });
  });

  it("ties, every season", async () => {
    expect((await stat("4215 ties all time"))?.headline).toMatchObject({ value: "1 tie", label: expect.stringContaining("10 matches") });
  });

  it("at NJ events and outside NJ", async () => {
    expect(await stat("4215 record at New Jersey events")).toMatchObject({ title: "Record at events in New Jersey in 2025–26", headline: { value: "3-2-1" } });
    expect(await stat("4215 record at out-of-state events")).toMatchObject({ title: "Record at events outside New Jersey in 2025–26", headline: { value: "2-0-0" } });
  });

  it("early season against late season, and the last 5 with their scores", async () => {
    expect((await stat("4215 late season form versus early season form"))?.headline).toMatchObject({ value: "1-1-1 late · 4-1-0 early" });
    const last = await stat("4215 trend over their last 5 matches");
    expect(last?.headline).toMatchObject({ value: "3-1-1", sub: "2025–26 · scores 260, 210, 150, 130, 180" });
    expect(last?.blocks.some((b) => b.kind === "series")).toBe(true);
    // A run reaching back a season keeps its record, but its scores are the newest season's only.
    const ten = await stat("4215 last 10 matches");
    expect(ten?.headline).toMatchObject({ value: "7-2-1", sub: "2025–26 · scores 100, 120, 70, 260, 210, 150, 130, 180 (the 8 in 2025–26; each season is a different game)" });
  });

  it("against top-rated and rookie teams, never a compare with a team named so", async () => {
    const top = await stat("4215 performance against top teams");
    expect(top).toMatchObject({ intent: "vs-top", headline: { value: "2-2-0" } });
    expect((await stat("4215 performance against rookie teams"))?.headline).toMatchObject({ value: "2-0-1" });
    expect((await stat("4215 easiest opponent this season"))?.headline).toMatchObject({ value: "23268 Rookie Robots" });
    // Ratings are never compared across seasons: "ever" is the latest season's, said so.
    const ever = await stat("4215 easiest opponent ever");
    expect(ever).toMatchObject({ title: "Easiest opponent", headline: { value: "23268 Rookie Robots", label: expect.stringContaining("in 2025–26") } });
    expect(ever?.definition).toContain("ratings are never compared across seasons");
  });
});

describe("scores", () => {
  it("the highest score is picked by its own points and shown at the official score; a higher one made by fouls is beside it", async () => {
    const s = await stat("4215 highest scoring match this season");
    expect(s?.headline).toMatchObject({ value: "210 points", label: expect.stringContaining("official score, penalties included") });
    const kpis = s?.blocks.find((b) => b.kind === "kpis");
    expect(kpis && kpis.kind === "kpis" && kpis.items.find((i) => i.label === "Highest official score")).toMatchObject({ value: "260", sub: expect.stringContaining("60 from the other alliance's fouls") });
    // Every phrasing names the same match.
    expect((await stat("4215 best match"))?.headline?.value).toBe("210 points");
    expect((await stat("4215 highest alliance score"))?.headline?.value).toBe("210 points");
  });

  it("averages are the official score; Worlds is every season with no season named", async () => {
    expect((await stat("4215 average score this season"))?.headline?.value).toBe("152.5");
    expect(await stat("4215 average score at worlds")).toMatchObject({ title: "Average score at Worlds", headline: { value: "210.0", sub: "2024–25 · Worlds · Edison Division" } });
    expect((await stat("4215 average score in playoffs"))?.title).toBe("Average score in playoffs in 2025–26");
  });

  it("range, median and consistency: real scores in points, never a percent", async () => {
    expect((await stat("4215 score range this season"))?.headline).toMatchObject({ value: "70–260" });
    expect((await stat("4215 median score this season"))?.headline).toMatchObject({ value: "140.0", label: "points, the median of 8 matches" });
    const c = await stat("4215 score consistency");
    expect(c?.headline?.value).toMatch(/^±\d+\.\d$/);
    expect(JSON.stringify(c)).not.toMatch(/\d%/);
  });

  it("scores over a number, with the count", async () => {
    expect((await stat("4215 scores over 200"))?.headline).toMatchObject({ value: "2 matches", label: "of 8 scored over 200 points (official score)" });
    expect((await stat("4215 matches where they scored over 150"))?.headline?.value).toBe("3 matches");
    // "At least" includes the limit itself: the 210 counts.
    expect(readStatQuestion("4215 scores of at least 210")).toMatchObject({ id: "scores-over", n: 210, variant: "at-least" });
    expect(await stat("4215 scores of at least 210")).toMatchObject({ title: "Scores of at least 210 in 2025–26", headline: { value: "2 matches" } });
    expect((await stat("4215 scores over 210"))?.headline?.value).toBe("1 match");
  });

  it("the best match by phase, its phases in the team page's colours, and the most penalties", async () => {
    expect((await stat("4215 match with the highest auto score"))?.headline).toMatchObject({ value: "60 points", label: "Auto in Q2 at Pennsylvania Qualifier" });
    const tele = await stat("4215 match with the highest teleop score");
    expect(tele?.headline).toMatchObject({ value: "160 points", label: "TeleOp in Q1 at Pennsylvania Qualifier" });
    const tiles = tele?.blocks.find((b) => b.kind === "kpis" && b.items.some((i) => i.phase));
    expect(tiles && tiles.kind === "kpis" && tiles.items.map((i) => [i.phase, i.value])).toEqual([["auto", "40"], ["teleop", "160"], ["endgame", "50"]]);
    expect((await stat("4215 match with the highest endgame score"))?.headline?.value).toBe("50 points");
    // A totals-only match has no Endgame of record: the one with a breakdown is the answer.
    expect((await stat("777 match with the highest endgame score"))?.headline).toMatchObject({ value: "20 points", label: "Endgame in Q1 at Seven League Meet" });
    expect((await stat("4215 match with the most penalties"))?.headline).toMatchObject({ value: "20 points", label: "of penalty points given away in Q3 at New Jersey Qualifier" });
  });
});

describe("penalties", () => {
  it("per match, a rate, per event, in playoffs and at Worlds", async () => {
    const per = await stat("4215 fouls per match");
    expect(per?.headline).toMatchObject({ value: "5.0", sub: "3 of 8 matches with any · 2025–26" });
    const k = per?.blocks.find((b) => b.kind === "kpis");
    expect(k && k.kind === "kpis" && k.items.find((i) => i.label === "Robot's own share")?.value).toBe("~8.4");
    expect((await stat("4215 penalty rate"))?.headline).toMatchObject({ value: "38%" });
    expect((await stat("4215 average penalties per event"))?.headline).toMatchObject({ value: "13.3" });
    expect(await stat("4215 penalties in playoffs")).toMatchObject({ title: "Penalty points given away in playoffs in 2025–26", headline: { value: "0.0" } });
    expect(await stat("4215 penalties at worlds")).toMatchObject({ title: "Penalty points given away at Worlds", headline: { value: "5.0", sub: expect.stringContaining("Worlds · Edison Division") } });
  });
});
