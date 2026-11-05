// Two or more teams' numbers as one head-to-head table (src/shared/searchStat.ts "compare"): a row per stat, each
// team's value in its own column, the better one named (the higher, or the lower for a rank or penalties) and, for
// two teams, the gap between them. The page draws it (src/components/search/page/CompareTable.tsx); this decides
// nothing the numbers don't: a tie, or a value missing on either side, names no one.
import type { CompareRow, StatBlock } from "../../../src/shared/searchStat.js";
import { teamHref } from "./matchSet.js";
import type { AnswerTeam } from "./families/matches.js";

export interface CompareInput {
  label: string;
  /** A phase row: its name in the team page's phase colour. */
  phase?: CompareRow["phase"];
  /** Each team's number, in the block's team order (null: not on record). */
  values: (number | null | undefined)[];
  /** How each value reads ("101.6", "#612 of 8,308", "26-6-0"); default one decimal. */
  show?: (v: number | null | undefined, i: number) => string;
  /** Which way is better; null: no side is (matches played). */
  better: "higher" | "lower" | null;
  /** The gap as words ("+42.7", "266 places"); default one decimal with a plus. */
  gap?: (d: number) => string;
}

const one = (v: number | null | undefined) => (v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1));

/** One row: the better side (a tie or a missing value: none), the gap to the next best and how big it is next to the
 *  larger value (0 to 1, for a thin marker). */
export function compareRow(x: CompareInput): CompareRow {
  const vs = x.values.map((v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v)));
  const shown = vs.map((v, i) => (x.show ?? one)(v, i));
  const known = vs.every((v) => v != null);
  if (!x.better || !known) return { label: x.label, ...(x.phase ? { phase: x.phase } : {}), values: shown, best: null };
  const order = vs.map((v, i) => ({ v: v!, i })).sort((a, b) => (x.better === "higher" ? b.v - a.v : a.v - b.v));
  const [top, next] = order;
  const d = Math.abs(top.v - next.v);
  if (d < 1e-9) return { label: x.label, ...(x.phase ? { phase: x.phase } : {}), values: shown, best: null, gap: "Even" };
  const scale = Math.max(Math.abs(top.v), Math.abs(next.v)) || 1;
  return { label: x.label, ...(x.phase ? { phase: x.phase } : {}), values: shown, best: top.i, gap: (x.gap ?? ((g) => `+${one(g)}`))(d), lead: Math.min(1, d / scale) };
}

export function compareBlock(title: string, teams: AnswerTeam[], rows: CompareInput[], season?: number | null): StatBlock {
  return {
    kind: "compare", title,
    teams: teams.map((t) => ({ label: String(t.number), href: teamHref(t.number, season ?? undefined) })),
    rows: rows.map(compareRow),
  };
}

/** A W-L-T record's win share (ties half), what records are compared by. */
export const winShare = (r: { wins: number; losses: number; ties: number }) => { const n = r.wins + r.losses + r.ties; return n ? (r.wins + r.ties / 2) / n : null; };
