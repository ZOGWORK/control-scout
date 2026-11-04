// One team's OPR and rating asked a particular way (server/api/answers/families/oprRating.ts), on a small fixture
// database shaped like 4215's: its rank worldwide and in New Jersey (the Teams list and Rankings filtered to it), its
// percentile, its best and worst event OPR, its OPR and rating at Worlds, its average event OPR, Auto against TeleOp,
// its rating's ± and world rank, its rating after each event and its best season rating. Each is one of the
// 260-query completion list's (by number in the test names).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { clearAllCaches } from "../../caches";
import { seasonStats } from "../teams";
import { readTwoTeam } from "./read";
import { readOprRating } from "./families/oprRating";
import { readTeamFact } from "./families/facts";
import { num } from "../../../src/shared/format";
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat";

const ask = async (q: string) => (await searchAnswer(q, { limit: 25, full: true })).stat as StatAnswer;
const kpis = (s: StatAnswer) => s.blocks.find((b) => b.kind === "kpis") as Extract<StatBlock, { kind: "kpis" }>;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run(`INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA'), (6980, 'Bad Wolf', 'Oradell', 'NJ', 'USA'),
    (7000, 'Jersey Top', 'Edison', 'NJ', 'USA'), (8000, 'Texas Top', 'Austin', 'TX', 'USA'), (24357, 'Teleop Tigers', 'Austin', 'TX', 'USA'), (9100, 'Few Matches', 'Trenton', 'NJ', 'USA')`);
  const ev = (season: number, code: string, name: string, type: string, start: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, 'Edison', 'NJ', 'USA', ?, ?, 't')", [season, code, name, type, division, start, start]);
  await ev(2023, "FTCCMP1EDIS", "2024 FIRST Championship - Edison Division", "FIRSTChampionship", "2024-04-17", "FTCCMP1");
  await ev(2023, "USNJCMPTNPK", "New Jersey State Championship - Turnpike Division", "Championship", "2024-03-17", "USNJCMP");
  await ev(2024, "USNJNOLT", "East Bergen Conference Northern League Tournament", "LeagueTournament", "2025-02-23");
  await ev(2025, "USNJNOM3", "P1-4 PM Northern League Meet", "LeagueMeet", "2025-11-08");
  await ev(2025, "USNJNOLT2", "East Bergen Conference Northern League Tournament", "LeagueTournament", "2026-03-08");
  await ev(2025, "USNJCMPPKWY", "New Jersey Championship - Parkway Division", "Championship", "2026-03-15", "USNJCMP");
  // season, code, OPR, auto, teleop, endgame, matches
  for (const [season, code, opr, a, t, e, n] of [[2023, "USNJCMPTNPK", 111.5, 30, 60, 21, 5], [2023, "FTCCMP1EDIS", 141.4, 47.3, 55.3, 38.9, 10], [2024, "USNJNOLT", 144.8, 38.6, 106.2, 2, 5],
    [2025, "USNJNOM3", 52.4, 6.6, 45.8, 2.4, 6], [2025, "USNJNOLT2", 84.4, 20, 60, 4.4, 5], [2025, "USNJCMPPKWY", 101.6, 28.3, 73.4, 5.5, 5]] as const) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, ?, 4215, 3)", [season, code]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (?, ?, 4215, ?, ?, ?, ?, ?)", [season, code, opr, a, t, e, n]);
  }
  // season, team, OPR, auto, teleop, endgame, OPR rank, ranked teams, matches, wins, rating, ± , rating rank, rated matches
  const rows = [
    [2023, 4215, 141.4, 47.3, 60, 38.9, 40, 6000, 15, 12, 139.2, 3.2, 84, 52], [2024, 4215, 144.8, 38.6, 106.2, 2, 30, 7600, 5, 5, 167.6, 3.2, 166, 42],
    [2025, 4215, 101.6, 28.3, 73.4, 6.7, 612, 8308, 26, 26, 98.04, 3.16, 525, 32], [2025, 6980, 46.9, 13.2, 40.9, 5.6, 2669, 8308, 24, 13, 50.3, 3.2, 2041, 24],
    [2025, 7000, 120, 40, 75, 5, 300, 8308, 20, 18, 130, 3.1, 200, 20], [2025, 8000, 150, 50, 90, 10, 100, 8308, 20, 18, 160, 3.1, 50, 20],
    [2025, 24357, 27.7, 5, 20, 2.7, 4985, 8308, 10, 3, 20, 4, 6000, 10],
  ] as const;
  for (const [season, team, opr, a, t, e, rank, of, m, w, r, sd, rr, rm] of rows) {
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, matches, wins, losses, ties,
      rating_np, rating_sd, rating_auto, rating_teleop, rating_endgame, rating_pen, rating_matches, rating_rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 29.3, 61.9, 6.8, 8.4, ?, ?)`,
    [season, team, opr, a, t, e, rank, of, m, w, r, sd, rm, rr]);
  }
  // On the New Jersey list only with 3+ matches (the Teams list's filter): under 3, never ranked there.
  await run("INSERT INTO team_season_stats (season, team, opr_np, matches, wins, losses, ties) VALUES (2025, 9100, 300, 2, 2, 0, 0)");
  // The Teams page's season table (team_season_records), at full precision: what its New Jersey list sorts.
  for (const [team, name, opr, played] of [[4215, "Hypnotic Robotics", 101.64, 26], [6980, "Bad Wolf", 46.91, 24], [7000, "Jersey Top", 120.02, 20], [9100, "Few Matches", 300, 2], [8000, "Texas Top", 150, 20]] as const) {
    await run("INSERT INTO team_season_records (season, team, team_name, events, played, wins, losses, ties, np_opr) VALUES (2025, ?, ?, 2, ?, 10, 0, 0, ?)", [team, name, played, opr]);
  }
  // The weekly Rankings snapshots: the Monday after each 2025–26 event.
  for (const [week, rating] of [["2025-11-10", 60.5], ["2026-03-09", 88.2], ["2026-03-16", 98.04]] as const) {
    await run("INSERT INTO ranking_snapshots (season, week, team, rank, rating) VALUES (2025, ?, 4215, 1, ?)", [week, rating]);
  }
  await rebuildSearch();
});

describe("reading", () => {
  it("each phrasing's question, and the ones left to the other answers", () => {
    expect(readOprRating("4215 opr rank in New Jersey")).toMatchObject({ id: "opr-rank", core: "4215", region: { state: "NJ" } });
    expect(readOprRating("4215 rating in New Jersey")).toMatchObject({ id: "rating-rank", region: { state: "NJ" } });
    expect(readOprRating("4215 place on the New Jersey leaderboard")).toMatchObject({ id: "rank", region: { state: "NJ" } });
    expect(readOprRating("6980 auto opr versus teleop opr")).toMatchObject({ id: "phase-vs", core: "6980", phases: ["auto", "teleop"] });
    expect(readOprRating("is 4215 in the top 10 percent worldwide")).toMatchObject({ id: "top-pct", core: "4215", pct: 10 });
    expect(readOprRating("is 4215 in the top 10% worldwide")).toMatchObject({ id: "top-pct", core: "4215", pct: 10 });
    expect(readOprRating("4215 opr at worlds")).toMatchObject({ id: "opr-worlds", core: "4215" });
    expect(readOprRating("4215 opr at worlds this season")).toMatchObject({ id: "opr-worlds", core: "4215", latest: true });
    expect(readOprRating("4215 rating at first championship")).toMatchObject({ id: "rating-worlds", core: "4215" });
    expect(readOprRating("4215 highest opr ever")).toMatchObject({ id: "opr-high", ever: true });
    // Left to the answers that already read them: the plain OPR and rating, a phase's rank, an event's OPR, two
    // teams, a season named after "rating in", league and average rank, a leaderboard.
    for (const q of ["4215 opr", "4215 rating", "4215 endgame opr rank", "4215 opr at the New Jersey championship", "4215 opr vs 6980", "4215 rating in 2024-25",
      "4215 league rank", "4215 average rank", "4215 best opr event", "4215 percentile by rating", "4215 rating percentile worldwide", "4215 average opr across events ever", "top 5 teams by auto opr in New Jersey", "highest opr in nj", "4215 rank at New Jersey Championship"]) {
      expect(readOprRating(q), q).toBeNull();
    }
    // Before these, "auto opr versus teleop opr" read as two teams and "the average team" as an event called "the".
    expect(readTwoTeam("6980 auto opr versus teleop opr")).not.toBeNull();
    expect(readTeamFact("4215 opr compared to the average team")).toMatchObject({ event: "the" });
  });
});

describe("answers", () => {
  it("46, 52–54: the rating card leads with the rating, its ± and its world rank, as the team page", async () => {
    const r = await ask("4215 rating");
    const page = (await seasonStats(2025, 4215))!.rating!;
    expect(r.headline).toMatchObject({ value: "98 ± 3.2", label: expect.stringMatching(/^#525 worldwide/) });
    expect(kpis(r).items[0]).toMatchObject({ label: "Prediction rating", value: `${num(page.np)} ± ${num(page.sd)}`, sub: expect.stringMatching(/^#525 worldwide/) });
    expect((await ask("4215 rating rank")).headline).toMatchObject({ value: "#525", label: expect.stringContaining("worldwide by prediction rating"), sub: "98 ± 3.2 · 2025–26" });
  });
  it("47, 59: the rating's uncertainty, with its matches", async () => {
    for (const q of ["4215 prediction rating uncertainty", "4215 prediction confidence"]) {
      expect((await ask(q)).headline, q).toMatchObject({ value: "± 3.2", label: "uncertainty on its 98 prediction rating", sub: "32 matches rated in 2025–26" });
    }
  });
  it("25: penalty points given away per match, from the rating", async () => {
    expect((await ask("4215 penalty opr")).headline).toMatchObject({ value: "8.4", label: "penalty points given away per match" });
  });
  it("33, 35, 207–209: the world rank by OPR, its percentile and top share; the rank both ways", async () => {
    expect((await ask("4215 opr rank worldwide")).headline).toMatchObject({ value: "#612 of 8,308", label: "worldwide by OPR · top 8%" });
    expect((await ask("6980 opr rank")).headline).toMatchObject({ value: "#2,669 of 8,308" });
    const w = await ask("4215 rank worldwide");
    expect(w.headline).toMatchObject({ value: "#612 of 8,308", sub: "#525 worldwide by prediction rating · 2025–26" });
    expect(kpis(w).items.map((i) => i.value)).toEqual(["#612 of 8,308", "#525 of 5"]);
    expect((await ask("4215 percentile worldwide by opr")).headline).toMatchObject({ value: "Top 8%", label: "worldwide by OPR: #612 of 8,308 · 92nd percentile" });
    expect((await ask("is 4215 in the top 10 percent worldwide")).headline).toMatchObject({ value: "Yes", label: "top 8% worldwide by OPR: #612 of 8,308" });
    expect((await ask("is 4215 in the top 5 percent worldwide")).headline).toMatchObject({ value: "No" });
  });
  it("34, 55, 206, 219, 220: the place on New Jersey's own lists, not the world rank", async () => {
    // The Teams list in New Jersey by OPR: 9100's 300 has under 3 matches, so it isn't on it.
    const o = await ask("4215 opr rank in New Jersey");
    expect(o).toMatchObject({ scope: ["New Jersey", "2025–26"], headline: { value: "#2 of 3", label: "in New Jersey by OPR" } });
    expect(o.blocks.find((b) => b.kind === "table")).toMatchObject({ rows: [{ cells: { team: "7000 Jersey Top" } }, { cells: { team: "4215 Hypnotic Robotics" }, strong: true }, { cells: { team: "6980 Bad Wolf" } }] });
    expect(kpis(o).items.map((i) => i.label)).toEqual(["New Jersey by OPR", "Worldwide by OPR", "Worldwide by rating"]);
    // Rankings in New Jersey by rating.
    expect((await ask("4215 rating in New Jersey")).headline).toMatchObject({ value: "#2 of 3", label: "in New Jersey by prediction rating" });
    for (const q of ["4215 rank in New Jersey", "4215 place on the New Jersey leaderboard"]) {
      expect((await ask(q)).headline, q).toMatchObject({ value: "#2 of 3", label: "in New Jersey by prediction rating", sub: expect.stringContaining("#2 of 3 in New Jersey by OPR") });
    }
    expect((await ask("6980 place on the New Jersey leaderboard")).headline).toMatchObject({ value: "#3 of 3" });
  });
  it("36: OPR against the world's average team, the average stated", async () => {
    const s = await ask("4215 opr compared to the average team");
    expect(s.title).toBe("OPR vs the world average, 2025–26");
    expect(s.headline?.sub).toMatch(/^#612 of 5 by OPR · .* · world average [\d.]+ across 5 teams$/);
  });
  it("37: the phase breakdown, as the OPR tiles", async () => {
    const s = await ask("4215 component opr breakdown");
    expect(kpis(s).items.map((i) => [i.phase, i.value])).toEqual([["np", "101.6"], ["auto", "28.3"], ["teleop", "73.4"], ["endgame", "6.7"]]);
  });
  it("44: a team's own Auto against its own TeleOp, never another team", async () => {
    const s = await ask("6980 auto opr versus teleop opr");
    expect(s).toMatchObject({ intent: "phase-vs", team: { number: 6980 }, headline: { value: "13.2 vs 40.9", label: "Auto 27.7 below TeleOp" } });
    expect(JSON.stringify(s)).not.toContain("24357");
  });
  it("30, 31, 41, 42: highest and lowest event OPR, the event named", async () => {
    expect((await ask("4215 highest opr ever")).headline).toMatchObject({ value: "144.8", label: "at East Bergen Conference Northern League Tournament", sub: expect.stringContaining("2024–25") });
    expect((await ask("4215 lowest opr")).headline).toMatchObject({ value: "52.4", label: "at P1-4 PM Northern League Meet" });
    expect((await ask("4215 opr at their best event")).headline).toMatchObject({ value: "101.6", label: "at New Jersey Championship - Parkway Division", sub: expect.stringContaining("Mar 15, 2026") });
    expect((await ask("4215 opr at their worst event")).headline).toMatchObject({ value: "52.4", label: "at P1-4 PM Northern League Meet" });
  });
  it("43: the average of the season's event OPRs, matches stated", async () => {
    expect((await ask("4215 average opr across events this season")).headline).toMatchObject({ value: "79.5", label: "average OPR across 3 events", sub: expect.stringContaining("16 qualification matches") });
  });
  it("32: OPR event by event this season, rising to its latest, and each season's standing", async () => {
    const s = await ask("4215 opr trend over seasons");
    expect(s.headline).toMatchObject({ value: "101.6", label: expect.stringContaining("Rising") });
    expect(s.blocks.some((b) => b.kind === "table" && b.rows.length === 3)).toBe(true);
  });
  it("28, 63: OPR and rating at Worlds, the division named, when its latest season had none", async () => {
    const o = await ask("4215 opr at worlds");
    expect(o.headline).toMatchObject({ value: "141.4", label: "at Worlds · Edison Division, 2023–24" });
    expect(o.definition).toContain("didn't play the FIRST Championship in 2025–26");
    const r = await ask("4215 rating at worlds");
    expect(r.headline).toMatchObject({ value: "139.2 ± 3.2", label: "after Worlds · Edison Division, 2023–24", sub: expect.stringContaining("#84 worldwide that season") });
    // "this season" is the latest season only: no older Worlds stands in for it.
    const now = await ask("4215 opr at worlds this season");
    expect(now.headline).toBeUndefined();
    expect(now.none).toContain("in 2025–26");
    // The Worlds finals after the division (playoffs only, no qualification matches): the season rating is after them.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2023, 'FTCCMP1', '2024 FIRST Championship', 'FIRSTChampionship', 'Houston', 'TX', 'USA', '2024-04-20', '2024-04-20', 't')");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2023, 'FTCCMP1', 'playoff', 1, 1, 'F1', '2024-04-20T15:00:00Z', 1, 200, 200, 150, 150, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2023, 'FTCCMP1', 'playoff', 1, 1, 4215, 'red', 1)");
    await run("INSERT INTO event_teams (season, code, team) VALUES (2023, 'FTCCMP1', 4215)");
    clearAllCaches();
    const fin = await ask("4215 rating at worlds");
    await run("DELETE FROM match_teams WHERE code = 'FTCCMP1'");
    await run("DELETE FROM event_teams WHERE code = 'FTCCMP1'");
    await run("DELETE FROM matches WHERE code = 'FTCCMP1'");
    await run("DELETE FROM events WHERE code = 'FTCCMP1'");
    clearAllCaches();
    expect(fin.headline).toMatchObject({ value: "139.2 ± 3.2", label: "after Worlds · Edison Division and the Worlds finals, 2023–24" });
    // "at New Jersey events" is a place of events, which these answers don't filter by: left to the other answers.
    expect(readOprRating("4215 highest opr at New Jersey events")).toBeNull();
  });
  it("51: the rating after each event, ending on the team page's; 64: the best season rating, its event named", async () => {
    const t = await ask("4215 rating trend");
    expect(t.headline).toMatchObject({ value: "98 ± 3.2", label: "latest rating, after New Jersey Championship - Parkway Division · Rising from 60.5 after P1-4 PM Northern League Meet" });
    expect(t.blocks.find((b) => b.kind === "series")).toMatchObject({ points: [{ y: 60.5 }, { y: 88.2 }, { y: 98 }] });
    // An event whose Monday snapshot was pruned (older than the retention window) is a gap, never a later week's rating.
    await run("DELETE FROM ranking_snapshots WHERE week = '2025-11-10'");
    const g = await ask("4215 rating trend");
    expect(g.blocks.find((b) => b.kind === "series")).toMatchObject({ points: [{ y: null }, { y: 88.2 }, { y: 98 }] });
    expect(g.headline?.label).toContain("Rising from 88.2 after East Bergen Conference Northern League Tournament");
    // An event with no dates on record is a gap too, never a failed answer.
    await run("UPDATE events SET start = NULL, end = NULL WHERE code = 'USNJNOLT2'");
    clearAllCaches();
    const nd = await ask("4215 rating trend");
    // (Only the last event's rating is left here, so no line: one point isn't a trend.)
    expect(nd).toMatchObject({ headline: { value: "98 ± 3.2" }, definition: expect.stringContaining("only the season rating is shown") });
    await run("UPDATE events SET start = '2026-03-08', end = '2026-03-08' WHERE code = 'USNJNOLT2'");
    clearAllCaches();
    expect((await ask("4215 best prediction rating ever")).headline).toMatchObject({ value: "167.6 ± 3.2", label: "2024–25 season rating, after East Bergen Conference Northern League Tournament" });
  });
});
