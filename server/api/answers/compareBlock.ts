// Two or more teams' numbers as one comparison (src/shared/searchStat.ts "compare"), built to the search results
// guide's contract (.claude/search-viz-guide-2026-11-05.txt §10): a row per metric, Total first and then the rest by
// the size of the gap, each row on its own scale from zero with that scale's maximum printed, each team's value at the
// end of its bar, the gap once. The scale of a season stat is the season's own (the highest any team reached that
// season, rounded up), so the same value draws the same bar on every card that season. The page draws it
// (src/components/search/page/CompareCard.tsx); this decides nothing the numbers don't: a tie, or a value missing on
// either side, names no one.
import type { CompareRow, StatBlock } from "../../../src/shared/searchStat.js";
import { get } from "../../db.js";
import { teamHref } from "./matchSet.js";
import type { AnswerTeam } from "./families/matches.js";

export interface CompareInput {
  label: string;
  /** Each team's number, in the block's team order (null: not on record). */
  values: (number | null | undefined)[];
  /** How each value reads ("101.6", "#612", "26-6-0"); default one decimal. */
  show?: (v: number | null | undefined, i: number) => string;
  /** Which way is better; null: no side is (matches played). */
  better: "higher" | "lower" | null;
  /** The gap as words ("+42.7", "266 places"); default one decimal with a plus. */
  gap?: (d: number) => string;
  /** The row's scale maximum: drawn as bars from zero to it. Absent: a row of values only (a rank, a record). */
  max?: number | null;
  /** The headline row (Total): first, whatever its gap. */
  total?: boolean;
}

const one = (v: number | null | undefined) => (v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1));

/** A round number at or above `v`, for a scale's maximum: 10s up to 200, then 50s. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const step = v <= 10 ? 1 : v <= 50 ? 5 : v <= 200 ? 10 : 50;
  return Math.ceil(v / step) * step;
}

/** One row: the better side (a tie or a missing value: none), the gap to the next best. */
export function compareRow(x: CompareInput): CompareRow {
  const vs = x.values.map((v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v)));
  const shown = vs.map((v, i) => (x.show ?? one)(v, i));
  // A value below zero (an OPR can be) gets no bar: a bar from zero can't show it, so the row is its values, noted.
  const negative = vs.some((v) => v != null && v < 0);
  const top = Math.max(...vs.map((v) => v ?? 0));
  const base: CompareRow = { label: x.label, values: shown, best: null,
    ...(x.max != null && !negative && vs.some((v) => v != null) ? { max: top > x.max ? niceMax(top) : x.max, nums: vs } : {}),
    ...(x.max != null && negative ? { note: "below zero: no bars" } : {}) };
  if (!x.better || !vs.every((v) => v != null)) return base;
  const order = vs.map((v, i) => ({ v: v!, i })).sort((a, b) => (x.better === "higher" ? b.v - a.v : a.v - b.v));
  const d = Math.abs(order[0].v - order[1].v);
  // A tie for the lead: the teams level at the top, by index (the rest are behind them).
  if (d < 1e-9) return { ...base, gap: "Even", diff: 0, tied: order.filter((o) => Math.abs(o.v - order[0].v) < 1e-9).map((o) => o.i).sort((p, q) => p - q) };
  return { ...base, best: order[0].i, gap: (x.gap ?? ((g) => `+${one(g)}`))(d), diff: d };
}

/** The rows in reading order: the Total first, then every other row with bars by its gap, largest first (the one
 *  that decided it comes second), then the rows of values only, as given. */
export function compareRows(rows: CompareInput[]): CompareRow[] {
  const built = rows.map((x) => ({ x, r: compareRow(x) }));
  const total = built.filter((b) => b.x.total);
  const bars = built.filter((b) => !b.x.total && b.r.max != null).sort((a, b) => (b.r.diff ?? -1) - (a.r.diff ?? -1));
  const rest = built.filter((b) => !b.x.total && b.r.max == null);
  return [...total, ...bars, ...rest].map((b) => b.r);
}

export function compareBlock(title: string, teams: AnswerTeam[], rows: CompareInput[], season?: number | null, scale?: string): StatBlock {
  return {
    kind: "compare", title,
    teams: teams.map((t) => ({ label: String(t.number), href: teamHref(t.number, season ?? undefined) })),
    rows: compareRows(rows),
    ...(scale ? { scale } : {}),
  };
}

export type StatColumn = "opr_np" | "opr_auto" | "opr_teleop" | "opr_endgame" | "rating_np" | "rating_auto" | "rating_teleop" | "rating_endgame";
const cache = new Map<string, { at: number; v: Record<string, number | null> }>();

/** Each stat's scale for a season: the highest any team reached that season, rounded up (niceMax). Fixed per
 *  season, so two cards with the same value draw the same bar. Read once an hour per season. */
export async function seasonScale(season: number, cols: readonly StatColumn[]): Promise<Record<string, number | null>> {
  const key = `${season}|${cols.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.v;
  const row = await get<Record<string, number | null>>(`SELECT ${cols.map((c) => `MAX(${c}) ${c}`).join(", ")} FROM team_season_stats WHERE season = ? AND matches > 0`, [season]);
  const v = Object.fromEntries(cols.map((c) => [c, row?.[c] != null && Number(row[c]) > 0 ? niceMax(Number(row[c])) : null]));
  cache.set(key, { at: Date.now(), v });
  return v;
}

/** A W-L-T record's win share (ties half), what records are compared by. */
export const winShare = (r: { wins: number; losses: number; ties: number }) => { const n = r.wins + r.losses + r.ties; return n ? (r.wins + r.ties / 2) / n : null; };

const PHASE_ROWS = new Set(["Auto", "TeleOp", "Endgame"]);

/** The phase after the Total that decided it: the phase with the largest gap, when it went the leader's way. */
export function decidingPhase(rows: CompareRow[]): CompareRow | null {
  const total = rows[0];
  const p = rows.slice(1).find((r) => PHASE_ROWS.has(r.label));
  return total?.best != null && p && p.best === total.best && (p.diff ?? 0) > 0 ? p : null;
}

/** A comparison's headline, the result said once: "23268 leads 157.9 – 115.3", the gap, and the context line (each
 *  fact once: ranks, records, what decided it). The leader's value first; a tie is "Even". */
export function leadHeadline(teams: AnswerTeam[], total: CompareRow, context: (string | null | undefined)[], href?: string): { value: string; label: string; sub?: string; href?: string } {
  const sub = context.filter(Boolean).join(" · ") || undefined;
  if (total.best == null && total.tied?.length) {
    // Level at the top: all of them ("Even at 50.0"), or the leaders named ("6980 and 33950 tie at 20.0").
    const at = total.values[total.tied[0]];
    return total.tied.length === teams.length
      ? { value: `Even at ${at}`, label: "No gap", ...(sub ? { sub } : {}) }
      : { value: `${total.tied.map((i) => teams[i].number).join(" and ")} tie at ${at}`, label: "No gap between them", ...(sub ? { sub } : {}) };
  }
  if (total.best == null) return { value: total.values.join(" – "), label: "No leader: a value is missing", ...(sub ? { sub } : {}) };
  const order = [total.best, ...total.values.map((_, i) => i).filter((i) => i !== total.best)];
  return { value: `${teams[total.best].number} leads ${order.map((i) => total.values[i]).join(" – ")}`, label: total.gap ?? "", ...(sub ? { sub } : {}), ...(href ? { href } : {}) };
}

/** "TeleOp decided it (+32.3)". */
export const decidedText = (rows: CompareRow[]) => { const p = decidingPhase(rows); return p ? `${p.label} decided it (${p.gap})` : null; };

const awardCache = new Map<string, { at: number; v: number | null }>();
/** The most awards any one team won in a season (or in all seasons, null): the awards rows' scale. */
export async function awardScale(season: number | null): Promise<number | null> {
  const key = String(season);
  const hit = awardCache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.v;
  const row = await get<{ n: number | null }>(`SELECT MAX(n) n FROM (SELECT team, COUNT(*) n FROM awards${season != null ? " WHERE season = ?" : ""} GROUP BY team) x`, season != null ? [season] : []);
  const v = row?.n ? niceMax(Number(row.n)) : null;
  awardCache.set(key, { at: Date.now(), v });
  return v;
}
