// The Watch live section's prediction rail (components/WatchLive.tsx): which match it calls, when it flips to
// a result, and what's after. Pure, tested in watchRail.test.ts.
//
//   Current   the next unplayed match in schedule order (lib/liveMode.ts nextMatch): the one on the field or up next.
//   Flip      when the match the rail was calling gets its result (a refresh of the event's data), the rail shows
//             that result and how the call went for RESULT_MS, then moves on to the new current match.
//   Up next   the 3 unplayed matches after the current one.
//   Finished  the rail hides: the stream is usually the recording by then.
import type { EventDetail, MatchPredictionView, MatchView } from "../shared/api";
import { nextMatch } from "./liveMode";

export const RESULT_MS = 60_000;
export const RAIL_NEXT = 3;

/** A result being shown: the match, until when, and the call the viewer saw for it (what the result is judged against). */
export interface Flip { key: string; until: number; shown: MatchPredictionView | null }

/** The match the rail was calling, with the call it was showing. */
export interface Calling { key: string; prediction: MatchPredictionView | null }

const at = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : NaN);
const stage = (a: MatchView, b: MatchView) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number;

/** Unplayed matches in schedule order, as nextMatch orders them. */
function queue(matches: MatchView[]): MatchView[] {
  const left = matches.filter((m) => !m.played);
  const timed = left.every((m) => Number.isFinite(at(m)));
  return left.sort((a, b) => (timed ? at(a) - at(b) : 0) || stage(a, b));
}

/** After new data: flip to the result of the match the rail was calling, if it just got one; else keep the flip there was. */
export function nextFlip(calling: Calling | null, matches: MatchView[], now: number, prev: Flip | null): Flip | null {
  // The call shown before the result is kept: once scored, the match's own prediction can be a different one (a
  // call from today's ratings that couldn't be logged gives way to the backtest, or to none).
  if (calling && matches.some((m) => m.key === calling.key && m.played)) return { key: calling.key, until: now + RESULT_MS, shown: calling.prediction };
  return prev;
}

/** How the call went on a played match: called it, upset, or neither (a tie, an even call, no call). */
export function verdict(m: MatchView): "called" | "upset" | null {
  const p = m.prediction;
  if (!p || !m.played || !m.red.score || !m.blue.score || m.red.score.total === m.blue.score.total || p.pRed === 0.5) return null;
  return (p.pRed > 0.5) === (m.red.score.total > m.blue.score.total) ? "called" : "upset";
}

export interface Rail { hidden: boolean; result: MatchView | null; current: MatchView | null; upNext: MatchView[] }

export function railModel(d: Pick<EventDetail, "event" | "matches">, now: number, flip: Flip | null): Rail {
  if (d.event.status === "finished") return { hidden: true, result: null, current: null, upNext: [] };
  const current = nextMatch(d.matches, null);
  const played = flip && flip.until > now ? d.matches.find((m) => m.key === flip.key && m.played) ?? null : null;
  const result = played && flip ? { ...played, prediction: flip.shown } : null;
  const upNext = queue(d.matches).filter((m) => m.key !== current?.key).slice(0, RAIL_NEXT);
  return { hidden: false, result, current, upNext };
}
