// OPR (offensive power rating): each robot's average contribution to its
// alliance's score, solved from the event's qualification matches.
//
// Plain least squares (what most FTC sites run) is unstable with the 5–6
// matches a team plays per event and can return impossible negative values.
// Here, per component (np, auto, TeleOp, endgame, penalties committed):
//   minimise ‖A x − y‖² + λ ‖x − μ‖²   subject to x ≥ 0
// where μ is the event's average per-robot contribution. Ridge shrinkage
// toward μ (not toward 0) keeps thin data honest; the box constraint kills
// negative ratings. Solved exactly by cyclic coordinate descent (convex).
//
// Data hygiene (research report, anti-patterns 5–6): only played quals;
// alliance rows with a surrogate or a DQ'd robot are dropped (the result
// doesn't reflect those robots' normal play); only robots on the field count.

export const OPR_COMPONENTS = ["np", "auto", "teleop", "endgame", "pen"] as const;
export type OprComponent = (typeof OPR_COMPONENTS)[number];

export interface OprRow {
  /** Robots on the field for this alliance. */
  teams: number[];
  values: Record<OprComponent, number>;
}

export interface OprResult {
  /** Component → team → rating. */
  opr: Record<OprComponent, Map<number, number>>;
  /** Alliance rows each team appeared in (after hygiene). */
  rows: Map<number, number>;
}

/** Ridge strength. Chosen on held-out matches (scripts/fit-opr-lambda.ts); see DECISIONS.md. */
export const DEFAULT_LAMBDA = 0.5;

export function solveOpr(rows: OprRow[], lambda = DEFAULT_LAMBDA): OprResult {
  const teams = [...new Set(rows.flatMap((r) => r.teams))].sort((a, b) => a - b);
  const idx = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const counts = new Map<number, number>();
  for (const r of rows) for (const t of r.teams) counts.set(t, (counts.get(t) ?? 0) + 1);
  const out = {} as OprResult["opr"];
  // AᵀA is shared by every component.
  const ata: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const members = rows.map((r) => r.teams.map((t) => idx.get(t)!));
  for (const m of members) for (const i of m) for (const j of m) ata[i][j] += 1;
  const robots = rows.reduce((s, r) => s + r.teams.length, 0);
  for (const c of OPR_COMPONENTS) {
    const aty = new Array(n).fill(0);
    let total = 0;
    rows.forEach((r, k) => { total += r.values[c]; for (const i of members[k]) aty[i] += r.values[c]; });
    const mu = robots ? total / robots : 0;
    // Gradient of the objective at x: 2(AᵀA x − Aᵀy) + 2λ(x − μ).
    const x = new Array(n).fill(mu);
    for (let sweep = 0; sweep < 500; sweep++) {
      let change = 0;
      for (let i = 0; i < n; i++) {
        let s = aty[i] + lambda * mu;
        for (let j = 0; j < n; j++) if (j !== i) s -= ata[i][j] * x[j];
        const next = Math.max(0, s / (ata[i][i] + lambda));
        change = Math.max(change, Math.abs(next - x[i]));
        x[i] = next;
      }
      if (change < 1e-6) break;
    }
    out[c] = new Map(teams.map((t, i) => [t, x[i]]));
  }
  return { opr: out, rows: counts };
}

/** Build OPR rows from match rows (hygiene applied here). */
export interface MatchForOpr {
  level: string;
  played: boolean;
  red: { team: number; surrogate: boolean; dq: boolean; onField: boolean }[];
  blue: { team: number; surrogate: boolean; dq: boolean; onField: boolean }[];
  redScore: { np: number; auto: number; teleop: number; endgame: number; pen: number } | null;
  blueScore: { np: number; auto: number; teleop: number; endgame: number; pen: number } | null;
}

export function oprRows(matches: MatchForOpr[]): OprRow[] {
  const rows: OprRow[] = [];
  for (const m of matches) {
    if (m.level !== "qual" || !m.played || !m.redScore || !m.blueScore) continue;
    for (const [side, sc] of [[m.red, m.redScore], [m.blue, m.blueScore]] as const) {
      const on = side.filter((t) => t.onField);
      if (!on.length || on.some((t) => t.surrogate || t.dq)) continue;
      rows.push({ teams: on.map((t) => t.team), values: { np: sc.np, auto: sc.auto, teleop: sc.teleop, endgame: sc.endgame, pen: sc.pen } });
    }
  }
  return rows;
}
