// Reliability index: tallies from match data, shrinkage toward the field, stored rows, and that it reads
// public tables only (packs ship only public tables; the job never touches workspace scouting).
import { beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { computeReliability, partsOf, fieldOf, tallyReliability } from "./reliability";
import { loadSeason, type DbEvent, type DbMatch } from "./load";
import { teamReliability, seasonStats } from "../api/teams";
import { blendedIndex, reliabilityIndex, RELIABILITY_PRIOR, type ReliabilityParts } from "../../src/shared/reliability";
import { PACK_TABLES } from "../../src/shared/packSchema";
import { PUBLIC_TABLES } from "../data/snapshot";

const t = (team: number, o: Partial<DbMatch["red"][number]> = {}) => ({ team, surrogate: false, dq: false, onField: true, ...o });
const sc = (np: number, pen = 0) => ({ total: np, np, auto: 0, teleop: np, endgame: 0, pen, bonus: null });
let n = 0;
const m = (red: DbMatch["red"], blue: DbMatch["blue"], r: number, b: number, o: Partial<DbMatch> = {}): DbMatch => ({
  code: "E", level: "qual", series: 0, number: ++n, label: `Q${n}`, time: null, played: true, red, blue, redScore: sc(r), blueScore: sc(b), video: null, ...o,
});
const ev = (matches: DbMatch[]): DbEvent => ({ season: 2025, code: "E", name: "E", type: "Qualifier", region: null, start: "2025-11-01", end: "2025-11-01", remote: false, hybrid: false, matches, ranks: new Map(), teams: [], awards: [] });

describe("tallies", () => {
  it("counts qual no-shows (never playoffs), DQs and near-zero matches from the partner's OPR", () => {
    const e = ev([
      m([t(1), t(2)], [t(3), t(4)], 100, 100),
      m([t(1, { onField: false }), t(2)], [t(3), t(4, { dq: true })], 40, 100),
      m([t(1), t(2)], [t(3), t(4)], 52, 100), // 1 adds ~nothing beyond 2's OPR (50)
      m([t(1), t(2), t(5, { onField: false })], [t(3), t(4)], 100, 100, { level: "playoff" }),
    ]);
    const x = tallyReliability([e], (_c, team) => 50 + 0 * team).get("E")!;
    expect(x.get(1)).toMatchObject({ listed: 3, noShows: 1, onField: 2, nearZero: 1 });
    expect(x.get(4)).toMatchObject({ dqs: 1, noShows: 0 });
    expect(x.has(5)).toBe(false); // sitting out a playoff isn't a no-show
    expect(x.get(1)!.seq).toEqual(["ok", "noShow", "nearZero"]);
  });

  it("shrinks small samples toward the field", () => {
    const f = { noShowRate: 0.01, dqRate: 0, nearZeroRate: 0.1, swingVar: 0.25, penPerRobot: 5 };
    const one = { listed: 1, onField: 0, noShows: 1, dqs: 0, contribs: [], ss: 0, nearZero: 0, penSum: 0, seq: ["noShow" as const] };
    const p = partsOf(one, f, null, null);
    expect(p.noShowRate).toBeCloseTo((1 + RELIABILITY_PRIOR * 0.01) / (1 + RELIABILITY_PRIOR));
    expect(p.penaltyRatio).toBe(1);
    expect(p.predictabilityRatio).toBe(1);
    expect(fieldOf([one]).noShowRate).toBe(1);
  });

  it("index: 100 minus stated weights, clamped; a workspace's failure notes only lower the blended one", () => {
    const clean: ReliabilityParts = { noShowRate: 0, dqRate: 0, nearZeroRate: 0, swing: 0, penaltyRatio: 0, predictabilityRatio: 0 };
    expect(reliabilityIndex(clean)).toBe(100);
    expect(reliabilityIndex({ ...clean, noShowRate: 0.1 })).toBe(85);
    expect(reliabilityIndex({ ...clean, noShowRate: 1 })).toBe(0);
    const r = { index: 100, matches: 10, noShows: 0, dqs: 0, nearZero: 0, recent: { matches: 10, noShows: 0, nearZero: 0 }, parts: clean, fieldIndex: 70 };
    expect(blendedIndex(r, { matchEntries: 10, flagged: 0 })).toBe(100);
    expect(blendedIndex(r, { matchEntries: 10, flagged: 5 })).toBe(75); // 5/10 shrunk with 10 at 0 → 0.25
  });
});

describe("stored rows", () => {
  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (2025, 'E', 'E', 'Qualifier', '2025-11-01', '2025-11-01', 'UTC', 0, 0, 'test')");
    let k = 0;
    const add = async (red: [number, number], blue: [number, number], r: number, b: number, off: number[] = []) => {
      k++;
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, red_pen, blue_total, blue_np, blue_pen, source) VALUES (2025, 'E', 'qual', 0, ?, ?, 1, ?, ?, 0, ?, ?, 0, 'test')", [k, `Q${k}`, r, r, b, b]);
      for (const [al, ts] of [["red", red], ["blue", blue]] as const) for (const tm of ts) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'E', 'qual', 0, ?, ?, ?, ?)", [k, tm, al, off.includes(tm) ? 0 : 1]);
    };
    for (let i = 0; i < 6; i++) await add([1, 2], [3, 4], 100, 90, i < 2 ? [1] : []);
    for (const tm of [1, 2, 3, 4]) await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'E', ?, 50, 6)", [tm]);
  });

  it("writes season, event and field rows that the profile reads", async () => {
    await computeReliability(2025, await loadSeason(2025));
    const rows = await all<any>("SELECT code, team, matches, no_shows, idx FROM team_reliability ORDER BY team, code");
    expect(rows.find((r) => r.team === 0 && r.code === "")).toBeTruthy();
    expect(rows.find((r) => r.team === 1 && r.code === "")).toMatchObject({ matches: 6, no_shows: 2 });
    const r1 = await teamReliability(2025, 1), r2 = await teamReliability(2025, 2);
    expect(r1!.index).toBeLessThan(r2!.index);
    expect(r1!.recent).toMatchObject({ matches: 6, noShows: 2 });
    expect(r1!.fieldIndex).not.toBeNull();
    expect(await teamReliability(2025, 0)).toBeNull();
    // The profile carries it with its season stats.
    await run("INSERT INTO team_season_stats (season, team, matches) VALUES (2025, 1, 6)");
    expect((await seasonStats(2025, 1))?.reliability?.index).toBe(r1!.index);
  });
});

describe("privacy", () => {
  it("packs and the snapshot ship only public tables (the reliability table is one; workspace tables never are)", () => {
    for (const tb of PACK_TABLES) expect(PUBLIC_TABLES, tb.name).toContain(tb.name);
    expect(PUBLIC_TABLES).toContain("team_reliability");
    expect(PUBLIC_TABLES).not.toContain("workspace_scout_entries");
  });
});
