// Two to four teams compared by one stat (search audit, "3–4 team compares"): "<team> vs <team> vs <team> auto" is the
// teams' season numbers in one card, the stat asked by its headline row, for any board stat (a phase's OPR, the win
// rate, the average score, penalties). Two teams by OPR, the rating or penalties stay their own side-by-side cards.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { resetSearchSeason } from "../answers/season";
import { searchAnswer } from "../searchAnswer";
import type { StatAnswer } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const S = 2025;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });
const card = async (q: string) => (await ask(q)).stat as StatAnswer;
const rowsOf = (s: StatAnswer) => { const b = s.blocks.find((x) => x.kind === "compare"); return b?.kind === "compare" ? b.rows : []; };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Each stat has its own leader: OPR 30601, Auto 30602, TeleOp 30603, the win rate 30603, the average score 30602,
  // fewest penalties 30602.
  const t = [
    [30601, "Crab Bots", 100, 20, 60, 20, 90, 8, 2, 120, 5],
    [30602, "Bay Bots", 90, 35, 40, 15, 95, 5, 5, 130, 2],
    [30603, "Dune Bots", 80, 10, 65, 5, 70, 9, 1, 100, 8],
    [30604, "Reef Bots", 50, 5, 30, 15, 40, 2, 8, 70, 4],
  ] as const;
  for (const [i, [n, name, opr, auto, teleop, endgame, rating, wins, losses, avg, pen]] of t.entries()) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'MD', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, matches, wins, losses, ties, avg_np, rating_pen)
      VALUES (?, ?, ?, ?, ?, ?, ?, 4, ?, 10, ?, ?, 0, ?, ?)`, [S, n, opr, auto, teleop, endgame, i + 1, rating, wins, losses, avg, pen]);
  }
  await rebuildSearch();
  resetSearchSeason();
  clearAllCaches();
});

describe("two to four teams compared by one stat", () => {
  it("three teams by a phase: that phase's OPR leads the card, its leader the headline", async () => {
    const s = await card("30601 vs 30602 vs 30603 auto");
    expect([s.title, s.headline?.value, rowsOf(s)[0]?.label]).toEqual(["Auto OPR: 30601 vs 30602 vs 30603, 2025–26", "30602 leads 35.0 – 20.0 – 10.0", "Auto"]);
    // The other season numbers are still on the card, under it.
    expect(rowsOf(s).map((r) => r.label).sort()).toEqual(["Auto", "Endgame", "OPR", "Rating", "TeleOp"]);
    expect((await card("compare 30601 30602 30603 teleop")).headline?.value).toBe("30603 leads 65.0 – 60.0 – 40.0");
  });
  it("four teams by a stat the five rows don't hold: its own row first, read as the board reads it", async () => {
    const s = await card("compare 30601 30602 30603 30604 win rate");
    expect([s.title, s.headline?.value, rowsOf(s)[0]?.label, rowsOf(s).length]).toEqual(["Win rate: 30601 vs 30602 vs 30603 vs 30604, 2025–26", "30603 leads 90% – 80% – 50% – 20%", "Win rate", 6]);
    // Four teams with "vs" between every two are four sides, never two alliances.
    expect((await card("30601 vs 30602 vs 30603 vs 30604 win rate")).headline?.value).toBe("30603 leads 90% – 80% – 50% – 20%");
  });
  it("fewer is better for penalties; two teams by the average score are compared the same way", async () => {
    const pen = await card("30601 vs 30602 vs 30603 penalties");
    expect([pen.headline?.value, pen.headline?.label]).toEqual(["30602 leads 2.0 – 5.0 – 8.0", "3.0 fewer"]);
    const avg = await ask("compare 30601 and 30602 average score");
    expect([avg.understood?.label, (avg.stat as StatAnswer).headline?.value]).toEqual(["Average score: Crab Bots (30601) vs Bay Bots (30602)", "30602 leads 130.0 – 120.0"]);
  });
  it("no stat said is OPR, as before; anything else is another question's", async () => {
    expect((await card("30601 vs 30602 vs 30603")).headline?.value).toBe("30601 leads 100.0 – 90.0 – 80.0");
    // Two teams by penalties: their own side-by-side card.
    expect((await card("30601 vs 30602 penalties")).intent).toBe("penalties-vs");
    // Two teams by a phase or by reliability: those side-by-side cards, however it's said.
    expect([(await card("30601 vs 30602 auto")).intent, (await card("30601 vs 30602 reliability")).intent]).toEqual(["phase-vs", "reliability-vs"]);
    // Two alliances, or two stats at once: never a comparison by one stat.
    for (const q of ["30601 30602 vs 30603 30604 win rate", "30601 vs 30602 vs 30603 auto and win rate"]) expect((await ask(q)).intent?.kind, q).not.toBe("stat-compare-by");
  });
});
