// Predictability report cards: per team, how the prediction engine's live calls
// on its matches turned out. Pure aggregation over the calibration ledger —
// live calls only (written down before each match), never the backtest replay,
// so the two are never blended.
//
// For every scored live call a team was in:
//   called right  — the side the model favoured won (ties and exact 50/50 calls
//                   don't count either way);
//   residual      — (alliance's actual score − its predicted score) ÷ robots on
//                   the alliance: the robot's even share of how far the alliance
//                   landed from the model. The ledger stores alliance predictions,
//                   not per-robot ones, so an even split is the honest attribution.
//                   Calls made before the season had any rated match carry no
//                   predicted score (no_score_basis): they count for "called
//                   right" but have no residual.
// Per team (per event, and over the season) we store the hit rate, the mean
// residual (above zero: scored more than predicted), the mean absolute residual
// and the residual variance — each raw and shrunk toward the season's field
// average with a prior worth REPORT_PRIOR calls, so a team with three calls
// isn't shown as 100% predictable.
import type { InStatement } from "@libsql/client";
import { all, kvSet, writeBatch } from "../db.js";
import type { ReportCardField } from "../../src/shared/api.js";
import { REPORT_PRIOR } from "../../src/shared/ledger.js";

export { REPORT_PRIOR };

type Log = (m: string) => void;

export interface LedgerRow {
  code: string;
  red: number[];
  blue: number[];
  pRed: number;
  redMean: number;
  blueMean: number;
  redScore: number;
  blueScore: number;
  /** 1 red won, 0 blue won, 0.5 tie. */
  outcome: number;
  /** The call had predicted scores (false: logged before the season's first rated match). */
  scoreBasis: boolean;
}

export interface TeamCall {
  team: number;
  code: string;
  /** null: a tie, or a 50/50 call (neither right nor wrong). */
  right: boolean | null;
  /** null: the call had no predicted score. */
  residual: number | null;
}

/** One call per robot on either alliance. */
export function teamCalls(rows: LedgerRow[]): TeamCall[] {
  const out: TeamCall[] = [];
  for (const r of rows) {
    const decided = r.outcome !== 0.5 && r.pRed !== 0.5;
    for (const [teams, p, mean, score, won] of [
      [r.red, r.pRed, r.redMean, r.redScore, r.outcome === 1],
      [r.blue, 1 - r.pRed, r.blueMean, r.blueScore, r.outcome === 0],
    ] as const) {
      if (!teams.length) continue;
      const residual = r.scoreBasis ? (score - mean) / teams.length : null;
      for (const team of teams) out.push({ team, code: r.code, right: decided ? (p > 0.5) === won : null, residual });
    }
  }
  return out;
}

export interface Aggregate {
  calls: number;
  decided: number;
  hits: number;
  /** Calls with a residual (a predicted score to compare with). */
  scored: number;
  errMean: number | null;
  errAbs: number | null;
  errVar: number | null;
}

export function aggregate(calls: TeamCall[]): Aggregate {
  const decided = calls.filter((c) => c.right != null);
  const hits = decided.filter((c) => c.right).length;
  const res = calls.map((c) => c.residual).filter((x): x is number => x != null);
  const n = res.length;
  if (!n) return { calls: calls.length, decided: decided.length, hits, scored: 0, errMean: null, errAbs: null, errVar: null };
  const mean = res.reduce((s, x) => s + x, 0) / n;
  const abs = res.reduce((s, x) => s + Math.abs(x), 0) / n;
  const v = res.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return { calls: calls.length, decided: decided.length, hits, scored: n, errMean: mean, errAbs: abs, errVar: v };
}

/** The season's field average: every team-call pooled. */
export function fieldOf(calls: TeamCall[]): ReportCardField {
  const a = aggregate(calls);
  return {
    calls: a.calls,
    decided: a.decided,
    scored: a.scored,
    hitRate: a.decided ? a.hits / a.decided : null,
    errMean: a.errMean,
    errAbs: a.errAbs,
    errSd: a.errVar == null ? null : Math.sqrt(a.errVar),
  };
}

/** x over n observations, pulled toward the field value f with a prior worth k observations. */
export function shrink(x: number | null, n: number, f: number | null, k = REPORT_PRIOR): number | null {
  if (f == null) return x;
  if (x == null || n <= 0) return f;
  return (n * x + k * f) / (n + k);
}

export interface Shrunk { hitRate: number | null; errMean: number | null; errAbs: number | null; errVar: number | null }

export function shrunk(a: Aggregate, f: ReportCardField): Shrunk {
  return {
    hitRate: shrink(a.decided ? a.hits / a.decided : null, a.decided, f.hitRate),
    errMean: shrink(a.errMean, a.scored, f.errMean),
    errAbs: shrink(a.errAbs, a.scored, f.errAbs),
    errVar: shrink(a.errVar, a.scored, f.errSd == null ? null : f.errSd ** 2),
  };
}

const r4 = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);

const INSERT = `INSERT INTO team_report_cards (season, code, team, final, calls, decided, hits, scored, err_mean, err_abs, err_var,
  hit_shrunk, err_mean_shrunk, err_abs_shrunk, err_var_shrunk, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Rows for one season, from the ledger rows given (pure). code '' = the whole season. */
export function reportCardStatements(season: number, rows: LedgerRow[], finalEvents: Set<string>, at: string): { stmts: InStatement[]; field: ReportCardField; teams: number } {
  const calls = teamCalls(rows);
  const field = fieldOf(calls);
  const byTeam = new Map<number, TeamCall[]>();
  for (const c of calls) { const xs = byTeam.get(c.team); if (xs) xs.push(c); else byTeam.set(c.team, [c]); }
  const stmts: InStatement[] = [{ sql: "DELETE FROM team_report_cards WHERE season = ?", args: [season] }];
  const row = (code: string, team: number, final: boolean, xs: TeamCall[]) => {
    const a = aggregate(xs), s = shrunk(a, field);
    stmts.push({ sql: INSERT, args: [season, code, team, final ? 1 : 0, a.calls, a.decided, a.hits, a.scored, r4(a.errMean), r4(a.errAbs), r4(a.errVar), r4(s.hitRate), r4(s.errMean), r4(s.errAbs), r4(s.errVar), at] });
  };
  for (const [team, xs] of byTeam) {
    row("", team, false, xs);
    const byEvent = new Map<string, TeamCall[]>();
    for (const c of xs) { const ys = byEvent.get(c.code); if (ys) ys.push(c); else byEvent.set(c.code, [c]); }
    for (const [code, ys] of byEvent) row(code, team, finalEvents.has(code), ys);
  }
  return { stmts, field, teams: byTeam.size };
}

const ids = (s: string): number[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []; } catch { return []; } };

/**
 * Rewrite a season's report cards from its scored live calls. An event's row is
 * final once the event has ended (its last day is before today, UTC) and none of
 * its matches is left unplayed.
 */
export async function computeReportCards(season: number, log: Log = () => {}, now = Date.now()): Promise<number> {
  const rows = await all<any>(
    `SELECT code, red, blue, p_red, red_mean, blue_mean, red_score, blue_score, outcome, no_score_basis FROM predictions
     WHERE kind = 'live' AND season = ? AND outcome IS NOT NULL AND red_score IS NOT NULL AND blue_score IS NOT NULL`,
    [season],
  );
  const today = new Date(now).toISOString().slice(0, 10);
  const codes = [...new Set(rows.map((r) => String(r.code)))];
  const finals = new Set<string>();
  if (codes.length) {
    const ph = codes.map(() => "?").join(",");
    const evs = await all<{ code: string; end: string | null; start: string | null; open: number }>(
      `SELECT e.code, e.end, e.start, (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 0) open
       FROM events e WHERE e.season = ? AND e.code IN (${ph})`, [season, ...codes],
    );
    for (const e of evs) if ((e.end ?? e.start ?? "9999") < today && !Number(e.open)) finals.add(e.code);
  }
  const ledger: LedgerRow[] = rows.map((r) => ({
    code: String(r.code), red: ids(r.red), blue: ids(r.blue), pRed: Number(r.p_red), redMean: Number(r.red_mean), blueMean: Number(r.blue_mean),
    redScore: Number(r.red_score), blueScore: Number(r.blue_score), outcome: Number(r.outcome), scoreBasis: !Number(r.no_score_basis),
  }));
  const { stmts, field, teams } = reportCardStatements(season, ledger, finals, new Date(now).toISOString());
  await writeBatch(stmts, 5000);
  await kvSet(`reportCards:field:${season}`, field);
  if (teams) log(`${season}: report cards for ${teams} teams from ${rows.length} live calls`);
  return teams;
}
