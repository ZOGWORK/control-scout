// Where each series of a double-elimination bracket sits when drawn as a tree: its lane (upper, lower or the
// finals column), its round within the lane, and the winner lines between series. Read off the series' own
// stage names and "Winner M3" sources (src/shared/bracketOdds.ts), so any bracket size lays out the same way.
import type { BracketSeriesView } from "../shared/api";

export type BracketLane = "upper" | "lower" | "final";

export interface BracketLayout {
  /** Series indexes per round, left to right. */
  upper: number[][];
  lower: number[][];
  /** The grand final, then its if-needed replay. */
  final: number[];
  /** Winner lines: [from series index, to series index]. Loser drops between lanes aren't drawn (their slots name them). */
  edges: [number, number][];
}

const LANE: Record<string, BracketLane> = {
  "Upper bracket": "upper", "Upper final": "upper",
  "Lower bracket": "lower", "Lower final": "lower",
  "Grand final": "final", "Final (if needed)": "final",
};

/** The tree for a double-elimination bracket; null when a series' stage or source doesn't read as one. */
export function bracketLayout(series: BracketSeriesView[]): BracketLayout | null {
  if (!series.length) return null;
  const byIndex = new Map(series.map((s) => [s.index, s]));
  const lane = new Map<number, BracketLane>();
  for (const s of series) {
    const l = LANE[s.stage];
    if (!l) return null;
    lane.set(s.index, l);
  }
  const feeds = (s: BracketSeriesView) =>
    [s.red.source, s.blue.source].map((src) => /^Winner M(\d+)$/.exec(src)).filter((m) => m != null).map((m) => Number(m[1]));
  const round = new Map<number, number>();
  const edges: [number, number][] = [];
  for (const s of [...series].sort((a, b) => a.index - b.index)) {
    const l = lane.get(s.index)!;
    let r = 0;
    for (const from of feeds(s)) {
      if (!byIndex.has(from)) return null;
      if (lane.get(from) === l) r = Math.max(r, (round.get(from) ?? 0) + 1);
      if (lane.get(from) === l || l === "final") edges.push([from, s.index]);
    }
    round.set(s.index, r);
  }
  // The replay's slots say "Upper bracket"/"Lower bracket": it follows the grand final.
  const finals = series.filter((s) => lane.get(s.index) === "final").map((s) => s.index).sort((a, b) => a - b);
  const replay = series.find((s) => s.ifNeeded);
  const gf = finals.find((i) => i !== replay?.index);
  if (replay && gf != null) edges.push([gf, replay.index]);
  const columns = (l: BracketLane) => {
    const out: number[][] = [];
    for (const s of series) if (lane.get(s.index) === l) (out[round.get(s.index)!] ??= []).push(s.index);
    return out.map((c) => c.sort((a, b) => a - b));
  };
  const upper = columns("upper"), lower = columns("lower");
  if (!upper.length || !lower.length || !finals.length || [...upper, ...lower].some((c) => !c)) return null;
  return { upper, lower, final: finals, edges };
}
