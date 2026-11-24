// A run of seasons (search audit, "season ranges"): "<team> opr since <year>", "<team> last 3 seasons", "best teams
// <season> to <season>". Each season is read as its own rank among that season's ranked teams, never one season's raw
// OPR against another's.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { resetSearchSeason } from "../answers/season";
import { searchAnswer } from "../searchAnswer";
import { readTime } from "../../../src/shared/query/time";
import type { StatAnswer } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const stat = async (q: string) => (await searchAnswer(q, { limit: 25, full: true, now: NOW })).stat as StatAnswer | undefined;
const table = (s: StatAnswer | undefined) => {
  const t = s?.blocks.find((b) => b.kind === "table");
  return t?.kind === "table" ? t.rows.map((r) => r.cells) : [];
};

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Three seasons, ten ranked teams in each. A later game scores higher: raw OPR rises while the ranks don't.
  const teams = [30401, 30402, 30403, 30404, 30405, 30406, 30407, 30408, 30409, 30410];
  for (const n of teams) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, `Bots ${n}`, n <= 30403 ? "MD" : "DE"]);
  // Each season's order, best first: 30401 leads 2023 and 2025; 30402 leads 2024.
  const order: Record<number, number[]> = {
    2023: [30401, 30402, 30403, 30404, 30405, 30406, 30407, 30408, 30409, 30410],
    2024: [30402, 30401, 30404, 30403, 30405, 30406, 30407, 30408, 30409, 30410],
    2025: [30401, 30403, 30402, 30404, 30405, 30406, 30407, 30408, 30409, 30410],
  };
  for (const [season, list] of Object.entries(order)) {
    for (const [i, n] of list.entries()) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [season, n]);
      // Auto ranks run the other way round.
      await run(`INSERT INTO team_season_stats (season, team, matches, wins, losses, ties, opr_np, rank_np, opr_auto, rank_auto, ranked_teams)
        VALUES (?, ?, 6, 3, 3, 0, ?, ?, ?, ?, 10)`, [season, n, (Number(season) - 2000) * 4 - i, i + 1, i + 1, 10 - i]);
    }
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USMDQ1', 'Maryland Qualifier', 'Qualifier', 'Town', 'MD', 'USA', '2026-02-01', '2026-02-01', 't')");
  await rebuildSearch();
  resetSearchSeason();
  clearAllCaches();
});

describe("a run of seasons", () => {
  it("is read as its first and last season, from today or as said", () => {
    const t = (q: string) => readTime(q, "2026-03-18").time;
    expect(t("opr since 2023")).toMatchObject({ kind: "seasons", range: { from: 2023, to: null }, label: "since 2023–24" });
    expect(t("best teams 2023-24 to 2025-26")).toMatchObject({ kind: "seasons", range: { from: 2023, to: 2025 } });
    expect(t("between 2023 and 2025")).toMatchObject({ kind: "seasons", range: { from: 2023, to: 2025 } });
    expect(t("the past three seasons")).toMatchObject({ kind: "seasons", range: { last: 3 } });
    // One season, and a count of something else, are as before.
    expect(t("in 2024-25")).toMatchObject({ kind: "season", season: 2024 });
    expect(t("last 3 matches")).toBeNull();
  });
  it("a team's run: its rank and share each season, never its raw OPR set against another season's", async () => {
    const s = await stat("30402 opr since 2023");
    expect(s?.intent).toBe("team-seasons");
    // Its best season is the one it ranked highest in (#1 in 2024–25), though its raw OPR is highest in 2025–26.
    expect(s?.headline).toMatchObject({ value: "Top 10%", label: "Best season by OPR rank: 2024–25, #1 of 10" });
    expect(table(s).map((c) => [c.season, c.rank, c.share])).toEqual([["2023–24", "#2 of 10", "Top 20%"], ["2024–25", "#1 of 10", "Top 10%"], ["2025–26", "#3 of 10", "Top 30%"]]);
    expect(table(await stat("30402 last 2 seasons")).map((c) => c.season)).toEqual(["2024–25", "2025–26"]);
    // "Auto OPR" is the auto phase's own rank; "between … and …" is one run, never two searches joined by "and".
    const auto = await stat("30402 auto opr between 2023 and 2025");
    expect([auto?.title, table(auto).map((c) => c.rank)]).toEqual(["Bots 30402 (30402): Auto OPR rank each season, 2023–24 to 2025–26", ["#9 of 10", "#10 of 10", "#8 of 10"]]);
  });
  it("the best teams over a run: by their average share of each season's ranked teams, in a place too", async () => {
    const s = await stat("best teams 2023-24 to 2025-26");
    expect(s?.intent).toBe("seasons-board");
    expect(table(s).slice(0, 3).map((c) => [c.team, c.avg])).toEqual([["30401 Bots 30401", "Top 14%"], ["30402 Bots 30402", "Top 20%"], ["30403 Bots 30403", "Top 30%"]]);
    expect(table(await stat("best teams in delaware since 2023")).map((c) => c.team)[0]).toBe("30404 Bots 30404");
  });
});
