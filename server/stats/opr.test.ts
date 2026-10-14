// OPR is computed the way FTC Scout and FTC Events compute it (plain least
// squares, every listed team, every played qual), so the numbers match theirs.
import { describe, it, expect } from "vitest";
import { solveOpr, oprRows, type OprRow } from "./opr";
import { teleopAsReported } from "../data/seasons";

/** Round-robin-ish schedule over `teams` with exact contributions `truth`. */
function event(truth: Record<number, number>, rounds: number): OprRow[] {
  const teams = Object.keys(truth).map(Number);
  const rows: OprRow[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rounds; r++) {
    const order = [...teams].sort(() => rnd() - 0.5);
    for (let i = 0; i + 1 < order.length; i += 2) {
      const pair = [order[i], order[i + 1]];
      const v = pair.reduce((s, t) => s + truth[t], 0);
      rows.push({ teams: pair, values: { np: v, auto: v * 0.2, teleop: v * 0.7, endgame: v * 0.1, pen: 0 } });
    }
  }
  return rows;
}

describe("solveOpr (least squares)", () => {
  const truth = { 1: 80, 2: 60, 3: 40, 4: 30, 5: 20, 6: 10, 7: 50, 8: 45 };

  it("recovers exact contributions", () => {
    const { opr } = solveOpr(event(truth, 12));
    for (const [t, v] of Object.entries(truth)) expect(opr.np.get(Number(t))!).toBeCloseTo(v, 6);
  });

  it("is the least-squares solution even when that's negative (as FTC Scout publishes it)", () => {
    // Hand-solved: x1+x2=100, x1+x3=40, x2+x3=30, x3+x4=0 → LS gives x3 < 0 for a robot that drags its partners down.
    const rows: OprRow[] = [
      { teams: [1, 2], values: { np: 100, auto: 0, teleop: 100, endgame: 0, pen: 0 } },
      { teams: [1, 3], values: { np: 40, auto: 0, teleop: 40, endgame: 0, pen: 0 } },
      { teams: [2, 3], values: { np: 30, auto: 0, teleop: 30, endgame: 0, pen: 0 } },
      { teams: [3, 4], values: { np: 0, auto: 0, teleop: 0, endgame: 0, pen: 0 } },
    ];
    const { opr } = solveOpr(rows);
    // Exactly determined (4 equations, 4 unknowns): x1 = 55, x2 = 45, x3 = -15, x4 = 15.
    expect(opr.np.get(1)!).toBeCloseTo(55, 6);
    expect(opr.np.get(2)!).toBeCloseTo(45, 6);
    expect(opr.np.get(3)!).toBeCloseTo(-15, 6);
    expect(opr.np.get(4)!).toBeCloseTo(15, 6);
  });

  it("stays finite when two robots are always paired (rank-deficient schedule)", () => {
    const rows: OprRow[] = [
      { teams: [1, 2], values: { np: 60, auto: 0, teleop: 60, endgame: 0, pen: 0 } },
      { teams: [1, 2], values: { np: 80, auto: 0, teleop: 80, endgame: 0, pen: 0 } },
      { teams: [3, 4], values: { np: 40, auto: 0, teleop: 40, endgame: 0, pen: 0 } },
    ];
    const { opr } = solveOpr(rows);
    for (const v of opr.np.values()) expect(Number.isFinite(v)).toBe(true);
    expect(opr.np.get(1)! + opr.np.get(2)!).toBeCloseTo(70, 3); // the pair's mean is all the data says
  });

  it("components are solved independently and sum to np when the inputs do", () => {
    const { opr } = solveOpr(event(truth, 10));
    for (const t of Object.keys(truth).map(Number)) {
      const sum = opr.auto.get(t)! + opr.teleop.get(t)! + opr.endgame.get(t)!;
      expect(sum).toBeCloseTo(opr.np.get(t)!, 6);
    }
  });
});

describe("oprRows: FTC Scout's match set", () => {
  const sc = { np: 50, auto: 10, teleop: 30, endgame: 10, pen: 5 };
  const t = (team: number, o: Partial<{ surrogate: boolean; dq: boolean; onField: boolean }> = {}) => ({ team, surrogate: false, dq: false, onField: true, ...o });

  it("uses every played qual and every listed team: surrogates, DQs and no-shows included; no playoffs", () => {
    const rows = oprRows([
      { level: "qual", played: true, red: [t(1), t(2)], blue: [t(3), t(4, { surrogate: true })], redScore: sc, blueScore: sc },
      { level: "qual", played: true, red: [t(5, { dq: true }), t(6, { onField: false })], blue: [t(7), t(8)], redScore: sc, blueScore: sc },
      { level: "qual", played: false, red: [t(1), t(3)], blue: [t(2), t(4)], redScore: null, blueScore: null },
      { level: "playoff", played: true, red: [t(1), t(3)], blue: [t(2), t(4)], redScore: sc, blueScore: sc },
    ], 2025);
    expect(rows.map((r) => r.teams)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);
  });

  it("reports TeleOp the way FIRST does: endgame included from 2024, separate in 2023", () => {
    expect(oprRows([{ level: "qual", played: true, red: [t(1), t(2)], blue: [t(3), t(4)], redScore: sc, blueScore: sc }], 2025)[0].values.teleop).toBe(40);
    expect(oprRows([{ level: "qual", played: true, red: [t(1), t(2)], blue: [t(3), t(4)], redScore: sc, blueScore: sc }], 2023)[0].values.teleop).toBe(30);
    expect(teleopAsReported(2024, { teleop: 30, endgame: 10 })).toBe(40);
  });
});

describe("world ranks", () => {
  it("rank negative OPRs too (FTC Scout does), below every positive one", async () => {
    const { rankBy } = await import("./job");
    const r = rankBy([[1, 50], [2, -3.2], [3, 10], [4, Number.NaN]]);
    expect([r.get(1), r.get(3), r.get(2)]).toEqual([1, 2, 3]);
    expect(r.has(4)).toBe(false);
    expect(r.size).toBe(3);
  });
  it("can keep a floor (the prediction rating does)", async () => {
    const { rankBy } = await import("./job");
    expect(rankBy([[1, 5], [2, -1]], 0).has(2)).toBe(false);
  });
});
