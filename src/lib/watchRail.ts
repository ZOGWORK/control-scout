// The Watch live section's prediction rail (components/WatchLive.tsx): which match it calls, when it flips to
// a result, and what's after. Pure, tested in watchRail.test.ts.
//
//   Current   the next unplayed match in schedule order (lib/liveMode.ts nextMatch): the one on the field or up next.
//   Flip      when the match the rail was calling gets its result (a refresh of the event's data), the rail shows
//             that result and how the call went for RESULT_MS, then moves on to the new current match.
//   Up next   the 3 unplayed matches after the current one.
//   Finished  the rail hides: the stream is usually the recording by then.
import type { EventDetail, MatchView } from "../shared/api";
import { nextMatch } from "./liveMode";

export const RESULT_MS = 60_000;
export const RAIL_NEXT = 3;

export interface Flip { key: string; until: number }

const at = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : NaN);
const stage = (a: MatchView, b: MatchView) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number;

/** Unplayed matches in schedule order, as nextMatch orders them. */
function queue(matches: MatchView[]): MatchView[] {
  const left = matches.filter((m) => !m.played);
  const timed = left.every((m) => Number.isFinite(at(m)));
  return left.sort((a, b) => (timed ? at(a) - at(b) : 0) || stage(a, b));
}

/** After new data: flip to the result of the match the rail was calling, if it just got one; else keep the flip there was. */
export function nextFlip(calling: string | null, matches: MatchView[], now: number, prev: Flip | null): Flip | null {
  if (calling && matches.some((m) => m.key === calling && m.played)) return { key: calling, until: now + RESULT_MS };
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
  const result = flip && flip.until > now ? d.matches.find((m) => m.key === flip.key && m.played) ?? null : null;
  const upNext = queue(d.matches).filter((m) => m.key !== current?.key).slice(0, RAIL_NEXT);
  return { hidden: false, result, current, upNext };
}
