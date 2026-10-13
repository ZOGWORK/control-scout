import { describe, it, expect } from "vitest";
import { solveOpr, oprRows, type OprRow } from "./opr";

/** Round-robin-ish schedule over `teams` with exact contributions `truth`. */
function event(truth: Record<number, number>, rounds: number, noise = () => 0): OprRow[] {
  const teams = Object.keys(truth).map(Number);
  const rows: OprRow[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rounds; r++) {
    const order = [...teams].sort(() => rnd() - 0.5);
    for (let i = 0; i + 1 < order.length; i += 2) {
      const pair = [order[i], order[i + 1]];
      const v = pair.reduce((s, t) => s + truth[t], 0) + noise();
      rows.push({ teams: pair, values: { np: v, auto: v * 0.2, teleop: v * 0.7, endgame: v * 0.1, pen: 0 } });
    }
  }
  return rows;
}

describe("solveOpr", () => {
  const truth = { 1: 80, 2: 60, 3: 40, 4: 30, 5: 20, 6: 10, 7: 50, 8: 45 };

  it("recovers exact contributions with plenty of matches and no shrinkage", () => {
    const { opr } = solveOpr(event(truth, 12), 0);
    for (const [t, v] of Object.entries(truth)) expect(opr.np.get(Number(t))!).toBeCloseTo(v, 3);
  });

  it("never returns a negative rating, even when least squares would", () => {
    // A robot that only ever plays with a strong partner in low-scoring matches.
    const rows: OprRow[] = [
      { teams: [1, 2], values: { np: 100, auto: 0, teleop: 100, endgame: 0, pen: 0 } },
      { teams: [1, 3], values: { np: 40, auto: 0, teleop: 40, endgame: 0, pen: 0 } },
      { teams: [2, 3], values: { np: 30, auto: 0, teleop: 30, endgame: 0, pen: 0 } },
      { teams: [3, 4], values: { np: 0, auto: 0, teleop: 0, endgame: 0, pen: 0 } },
    ];
    for (const lambda of [0, 1, 5]) {
      const { opr } = solveOpr(rows, lambda);
      for (const v of opr.np.values()) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("shrinks thin data toward the event average, not toward zero", () => {
    const rows = event(truth, 2);
    const mean = rows.reduce((s, r) => s + r.values.np, 0) / rows.reduce((s, r) => s + r.teams.length, 0);
    const loose = solveOpr(rows, 0).opr.np, tight = solveOpr(rows, 1e6).opr.np;
    for (const v of tight.values()) expect(v).toBeCloseTo(mean, 1);
    // A strong robot's rating moves toward the mean as λ grows.
    expect(tight.get(1)!).toBeLessThan(loose.get(1)!);
  });

  it("components are solved independently and sum to np when the inputs do", () => {
    const { opr } = solveOpr(event(truth, 10), 0.5);
    for (const t of Object.keys(truth).map(Number)) {
      const sum = opr.auto.get(t)! + opr.teleop.get(t)! + opr.endgame.get(t)!;
      expect(sum).toBeCloseTo(opr.np.get(t)!, 3);
    }
  });
});

describe("oprRows hygiene", () => {
  const sc = { np: 50, auto: 10, teleop: 30, endgame: 10, pen: 5 };
  const t = (team: number, o: Partial<{ surrogate: boolean; dq: boolean; onField: boolean }> = {}) => ({ team, surrogate: false, dq: false, onField: true, ...o });

  it("keeps only played quals and drops surrogate / DQ alliances", () => {
    const rows = oprRows([
      { level: "qual", played: true, red: [t(1), t(2)], blue: [t(3), t(4, { surrogate: true })], redScore: sc, blueScore: sc },
      { level: "qual", played: true, red: [t(5, { dq: true }), t(6)], blue: [t(7), t(8)], redScore: sc, blueScore: sc },
      { level: "qual", played: false, red: [t(1), t(3)], blue: [t(2), t(4)], redScore: null, blueScore: null },
      { level: "playoff", played: true, red: [t(1), t(3)], blue: [t(2), t(4)], redScore: sc, blueScore: sc },
    ]);
    expect(rows.map((r) => r.teams)).toEqual([[1, 2], [7, 8]]);
  });

  it("counts only robots that were on the field", () => {
    const rows = oprRows([{ level: "qual", played: true, red: [t(1), t(2), t(9, { onField: false })], blue: [t(3), t(4)], redScore: sc, blueScore: sc }]);
    expect(rows[0].teams).toEqual([1, 2]);
  });
});
