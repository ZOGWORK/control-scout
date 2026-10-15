// OPR (offensive power rating): each robot's average contribution to its
// alliance's score, solved from the event's qualification matches.
//
// Computed exactly the way FTC Scout (and FTC Events) do, so a team sees the
// same number on every site: plain least squares, A x = y, over every played
// qualification match, counting every team FIRST lists on the alliance
// (surrogates and no-shows included). Components follow FIRST's own score
// breakdown (seasons.ts: teleopAsReported), so "TeleOp" means what FIRST and
// FTC Scout mean by it. Checked against FTC Scout's published OPR for every
// team at four events across three seasons: identical to the hundredth.
//
// Least squares can be negative or swing with few matches: that's the
// published number, and the page says how many matches it rests on.

import { teleopAsReported } from "../data/seasons.js";

export const OPR_COMPONENTS = ["np", "auto", "teleop", "endgame", "pen"] as const;
export type OprComponent = (typeof OPR_COMPONENTS)[number];

export interface OprRow {
  /** Robots FIRST lists on this alliance. */
  teams: number[];
  values: Record<OprComponent, number>;
}

export interface OprResult {
  /** Component → team → rating. */
  opr: Record<OprComponent, Map<number, number>>;
  /** Alliance rows each team appeared in. */
  rows: Map<number, number>;
}

/**
 * Least squares per component: solve the normal equations (AᵀA) x = Aᵀy by
 * Gauss–Jordan elimination with partial pivoting. A vanishing ridge (1e-9)
 * only keeps a rank-deficient schedule (two robots always paired) solvable;
 * it doesn't move a well-posed answer.
 */
export function solveOpr(rows: OprRow[]): OprResult {
  const { teams, solution, rows: counts } = solveLeastSquares(rows.map((r) => ({ teams: r.teams, values: OPR_COMPONENTS.map((c) => r.values[c]) })));
  const out = {} as OprResult["opr"];
  OPR_COMPONENTS.forEach((c, ci) => { out[c] = new Map(teams.map((t, i) => [t, solution[i][ci]])); });
  return { opr: out, rows: counts };
}

/**
 * The same least squares for any number of value columns at once: each row is
 * an alliance (its listed robots) and that alliance's values. Returns, per
 * team (sorted), the solved contribution for every column.
 */
export function solveLeastSquares(rows: { teams: number[]; values: number[] }[]): { teams: number[]; solution: number[][]; rows: Map<number, number> } {
  const teams = [...new Set(rows.flatMap((r) => r.teams))].sort((a, b) => a - b);
  const idx = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const counts = new Map<number, number>();
  for (const r of rows) for (const t of r.teams) counts.set(t, (counts.get(t) ?? 0) + 1);
  const members = rows.map((r) => r.teams.map((t) => idx.get(t)!));
  // Augmented matrix [AᵀA | Aᵀy₁ … Aᵀyₖ]: one elimination solves every column.
  const k = rows[0]?.values.length ?? 0;
  const M: number[][] = Array.from({ length: n }, () => new Array(n + k).fill(0));
  members.forEach((m, r) => {
    for (const i of m) {
      for (const j of m) M[i][j] += 1;
      for (let ci = 0; ci < k; ci++) M[i][n + ci] += rows[r].values[ci];
    }
  });
  for (let i = 0; i < n; i++) M[i][i] += 1e-9;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const pivot = M[c][c];
    for (let r = 0; r < n; r++) {
      if (r === c || !M[r][c]) continue;
      const f = M[r][c] / pivot;
      for (let col = c; col < n + k; col++) M[r][col] -= f * M[c][col];
    }
  }
  return { teams, solution: teams.map((_, i) => Array.from({ length: k }, (_, ci) => M[i][n + ci] / M[i][i])), rows: counts };
}

/** Build OPR rows from match rows. */
export interface MatchForOpr {
  level: string;
  played: boolean;
  red: { team: number; surrogate: boolean; dq: boolean; onField: boolean }[];
  blue: { team: number; surrogate: boolean; dq: boolean; onField: boolean }[];
  redScore: { np: number; auto: number; teleop: number; endgame: number; pen: number } | null;
  blueScore: { np: number; auto: number; teleop: number; endgame: number; pen: number } | null;
}

export function oprRows(matches: MatchForOpr[], season: number): OprRow[] {
  const rows: OprRow[] = [];
  for (const m of matches) {
    if (m.level !== "qual" || !m.played || !m.redScore || !m.blueScore) continue;
    for (const [side, sc] of [[m.red, m.redScore], [m.blue, m.blueScore]] as const) {
      if (!side.length) continue;
      rows.push({ teams: side.map((t) => t.team), values: { np: sc.np, auto: sc.auto, teleop: teleopAsReported(season, sc), endgame: sc.endgame, pen: sc.pen } });
    }
  }
  return rows;
}
