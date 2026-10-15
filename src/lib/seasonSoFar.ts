// "Season so far" numbers for the My team page, derived from the matches it already loads.
import type { MatchView } from "../shared/api";

export interface CallTally { right: number; of: number }

/** How many of a team's decided matches the engine called right, kept apart by kind: calls logged
 *  before the match (live) and replayed ones (backtest) are never added together. Same rule as a
 *  match row's Right / Upset mark: a played match with both scores, a prediction, and no tie. */
export function callTally(matches: MatchView[], team: number): { live: CallTally; backtest: CallTally } {
  const t = { live: { right: 0, of: 0 }, backtest: { right: 0, of: 0 } };
  for (const m of matches) {
    const p = m.prediction;
    if (!p || (p.kind !== "live" && p.kind !== "backtest")) continue;
    if (!m.played || !m.red.score || !m.blue.score) continue;
    if (![...m.red.teams, ...m.blue.teams].some((x) => x.number === team)) continue;
    const red = m.red.score.total, blue = m.blue.score.total;
    if (red === blue) continue;
    const bucket = t[p.kind];
    bucket.of++;
    if ((p.pRed > 0.5) === (red > blue)) bucket.right++;
  }
  return t;
}

/** Whole-number percent, or null with nothing to divide by. */
export const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : null);
