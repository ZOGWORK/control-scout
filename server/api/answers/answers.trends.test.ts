// Trend answers (server/api/answers/families/trends.ts) on a small fixture database: one number over a team's events
// in one season (OPR, win rate, penalty points given, alliance score, ranking points: the team page's trend chart's
// metrics), rising or falling against the event before, a season's penalty total, and OPR and record by season.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readStatQuestion } from "./read";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA')");
  const ev = (season: number, code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Edison', 'NJ', 'USA', ?, ?, 't')", [season, code, name, type, start, start]);
  await ev(2024, "USNJQ1", "Qualifier One", "Qualifier", "2024-12-01");
  await ev(2025, "USNJQ2", "Qualifier Two", "Qualifier", "2025-12-01");
  await ev(2025, "USNJCMP", "New Jersey Championship", "Championship", "2026-03-01");
  // code, season, opr, avg score, avg pen, matches, wins, losses, rp
  for (const [code, season, opr, score, pen, n, w, l, rp] of [["USNJQ1", 2024, 140, 150, 10, 5, 3, 2, 2.0], ["USNJQ2", 2025, 60, 90, 20, 5, 4, 1, 2.2], ["USNJCMP", 2025, 100, 170, 8, 6, 3, 3, 1.5]] as const) {
    await run("INSERT INTO event_teams (season, code, team, rank, rp) VALUES (?, ?, 4215, 3, ?)", [season, code, rp]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, avg_score, avg_pen, matches, wins, losses, ties) VALUES (?, ?, 4215, ?, ?, ?, ?, ?, ?, 0)", [season, code, opr, score, pen, n, w, l]);
  }
  // TeleOp OPR and the reliability index at each 2025–26 event (failed-search #863/#999, #862/#1000).
  for (const [code, teleop, idx] of [["USNJQ2", 30, 70], ["USNJCMP", 45, 64]] as const) {
    await run("UPDATE team_event_stats SET opr_teleop = ? WHERE season = 2025 AND code = ? AND team = 4215", [teleop, code]);
    await run(`INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero, idx, computed_at)
      VALUES (2025, ?, 4215, 5, 0, 0, 0, 5, 5, 0, 0, ?, 't')`, [code, idx]);
  }
  await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, events, matches, wins, losses, ties) VALUES (2024, 4215, 144.8, 370, 7608, 1, 12, 7, 5, 0), (2025, 4215, 101.6, 616, 8375, 2, 14, 10, 4, 0)");
  await rebuildSearch();
});

describe("trends", () => {
  it("what's read", () => {
    expect(readStatQuestion("4215 OPR history")).toMatchObject({ id: "opr-history", core: "4215" });
    expect(readStatQuestion("4215 OPR by season")).toMatchObject({ id: "opr-by-season" });
    expect(readStatQuestion("4215 record by season")).toMatchObject({ id: "record-by-season" });
    expect(readStatQuestion("4215 average penalties")).toMatchObject({ id: "avg-penalties" });
    expect(readStatQuestion("4215 total penalties in 2025-26")).toMatchObject({ id: "total-penalties", scope: { season: 2025 } });
    expect(readStatQuestion("4215 win rate by event")).toMatchObject({ id: "win-rate" });
    // A plain win rate is wins over matches (families/matchStats.ts), any scope.
    expect(readStatQuestion("4215 win rate")).toMatchObject({ id: "win-percent" });
    expect(readStatQuestion("4215 win rate at worlds")).toMatchObject({ id: "win-percent", scope: { championship: true } });
    expect(readStatQuestion("4215 average alliance score by event")).toMatchObject({ id: "avg-score-by-event" });
    expect(readStatQuestion("4215 ranking points")).toMatchObject({ id: "ranking-points" });
    // A scope a trend can't apply is left to search.
    expect(readStatQuestion("4215 opr history at worlds")).toBeNull();
    expect(readStatQuestion("2024 OPR by season")).toMatchObject({ id: "opr-by-season", core: "2024", scope: { season: null } });
    for (const q of ["4215 total penalties at New Jersey Championship", "4215 total penalties at worlds", "4215 total penalties in playoffs", "4215 seasonal OPR in 2024-25", "4215 record by season 2024-25", "4215 win rate by event all time", "4215 OPR history ever"]) expect(readStatQuestion(q), q).toBeNull();
  });
  it("by event in the latest season, rising or falling against the event before", async () => {
    const o = await searchAnswer("4215 OPR history", { limit: 25 });
    expect(o.stat).toMatchObject({ family: "trend", title: "OPR by event in 2025–26", headline: { value: "100.0", label: "OPR at New Jersey Championship · Rising" } });
    const s = o.stat!.blocks.find((b) => b.kind === "series");
    expect(s && s.kind === "series" && s.points.map((p) => [p.x, p.y])).toEqual([["Qualifier Two", 60], ["New Jersey Championship", 100]]);
    // Its other seasons, each the same trend read in that season.
    const other = o.stat!.blocks.find((b) => b.kind === "links");
    expect(other && other.kind === "links" && other.items.map((l) => l.label)).toEqual(["2024–25"]);
    if (other && other.kind === "links") for (const l of other.items) expect(readStatQuestion(decodeURIComponent(l.href.split("q=")[1]))).toMatchObject({ id: "opr-history", scope: { season: Number(l.label.slice(0, 4)) } });
    // Fewer penalty points is better: falling is good.
    const p = await searchAnswer("4215 average penalties", { limit: 25 });
    expect(p.stat!.blocks[0]).toMatchObject({ kind: "kpis", items: [{ value: "8.0" }, { label: "Trend", value: "Falling", tone: "good" }, { label: "Lowest" }] });
    expect((await searchAnswer("4215 win rate by event", { limit: 25 })).stat!.headline).toMatchObject({ value: "50%" });
    expect((await searchAnswer("4215 ranking points", { limit: 25 })).stat!.headline).toMatchObject({ value: "1.50" });
  });
  it("a season's penalty total; OPR and record by season", async () => {
    expect((await searchAnswer("4215 total penalties in 2025-26", { limit: 25 })).stat!.headline).toMatchObject({ value: "148 points", label: "given in 11 qualification matches · 13.5 per match" });
    // Never a raw OPR across seasons (owner rule): the standing each season, its rank, no OPR number.
    const o = (await searchAnswer("4215 OPR by season", { limit: 25 })).stat!;
    expect(o).toMatchObject({ title: "OPR standing by season", headline: { value: "Top 8%", label: "worldwide by OPR in 2025–26" } });
    expect(JSON.stringify(o.blocks)).not.toContain("101.6");
    const t = o.blocks.find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.columns.map((c) => c.key)).toEqual(["season", "rank", "share"]);
    expect((await searchAnswer("4215 record by season", { limit: 25 })).stat!.headline).toMatchObject({ value: "10-4-0", label: "in 2025–26 · 71% wins" });
  });
});

// A phase's OPR and the reliability index, event by event (failed-search #862, #863, #999, #1000): held out from the
// issues' words (other team, other phrasings).
describe("a phase's OPR and reliability by event", () => {
  it("what's read", () => {
    expect(readStatQuestion("4215 teleop opr history")).toMatchObject({ id: "teleop-history", core: "4215" });
    expect(readStatQuestion("4215 auto trend")).toMatchObject({ id: "auto-history", core: "4215" });
    expect(readStatQuestion("4215 endgame over time")).toMatchObject({ id: "endgame-history", core: "4215" });
    expect(readStatQuestion("4215 reliability by event")).toMatchObject({ id: "reliability-history", core: "4215" });
    // The OPR's own history stays the OPR's; a plain phase OPR or reliability stays the fact's.
    expect(readStatQuestion("4215 opr history")).toMatchObject({ id: "opr-history" });
    for (const q of ["4215 teleop opr", "4215 reliability"]) expect(readStatQuestion(q)?.family, q).not.toBe("trend");
  });
  it("each event's number, rising or falling against the event before", async () => {
    const t = await searchAnswer("is hypnotic robotics' teleop getting better", { limit: 25 });
    expect(t.stat).toMatchObject({ intent: "teleop-history", title: "TeleOp OPR by event in 2025–26", headline: { value: "45.0", label: "TeleOp OPR at New Jersey Championship · Rising" } });
    const s = t.stat!.blocks.find((b) => b.kind === "series");
    expect(s && s.kind === "series" && s.points.map((p) => [p.x, p.y])).toEqual([["Qualifier Two", 30], ["New Jersey Championship", 45]]);
    for (const q of ["4215 reliability over the season", "how reliable has 4215 been event by event"]) {
      const r = await searchAnswer(q, { limit: 25 });
      expect(r.stat, q).toMatchObject({ intent: "reliability-history", title: "Reliability by event in 2025–26", headline: { value: "64" } });
      expect(r.stat!.headline!.label, q).toContain("Falling");
    }
  });
});
