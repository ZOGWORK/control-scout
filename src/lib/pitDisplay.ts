// The pit display (/events/:season/:code/display): what each panel shows, worked out from the event's
// detail (the same /api/events/:season/:code the event page reads, so the numbers are the page's).
// Pure, so every rule below is unit tested (pitDisplay.test.ts).
//
//   Now panel   the match on the field (the next one, once its start time has passed and it has no
//               result yet), else the last result with its score and how the call went. Finished: the
//               last match and the winning alliance (once the Winner award is posted).
//   Up next     the next 3 unplayed matches after the one on the field, in schedule order.
//   Countdown   to the next match's start, only while the schedule is on time: once any unplayed match
//               is more than LATE_MS past its start the times are stale, and it says "Up next: Q25".
//   Rankings    the top 8 by event rank (W–L–T, event OPR); "Final rankings" once the event is over.
import type { EventDetail, FieldRow, MatchView } from "../shared/api";
import { nextMatch } from "./liveMode";

/** A match this far past its scheduled start without a result means the event runs behind. */
export const LATE_MS = 5 * 60_000;
export const UP_NEXT = 3;
export const TOP = 8;

const at = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : NaN);
const order = (a: MatchView, b: MatchView) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number;

/** Unplayed matches in schedule order (times when every one has a time, else stage order), as nextMatch picks them. */
export function unplayed(matches: MatchView[]): MatchView[] {
  const left = matches.filter((m) => !m.played);
  const timed = left.every((m) => Number.isFinite(at(m)));
  return left.sort((a, b) => (timed ? at(a) - at(b) : 0) || order(a, b));
}

/** The last match with a result, by the time it was played (or stage order without times). */
export function lastPlayed(matches: MatchView[]): MatchView | null {
  const done = matches.filter((m) => m.played);
  if (!done.length) return null;
  const timed = done.every((m) => Number.isFinite(at(m)));
  return done.sort((a, b) => (timed ? at(a) - at(b) : 0) || order(a, b)).at(-1)!;
}

/** "Qual 24 of 60": the qual on the field or next up (the last one once they're all played), of all quals. Playoffs once quals are done. */
export function progress(matches: MatchView[], current: MatchView | null): string | null {
  const quals = matches.filter((m) => m.level === "qual");
  if (!quals.length) return matches.length ? "Playoffs" : null;
  const left = quals.filter((m) => !m.played);
  if (!left.length) return matches.some((m) => m.level === "playoff") ? "Playoffs" : `Qual ${quals.length} of ${quals.length}`;
  const n = current?.level === "qual" ? current.number : unplayed(quals)[0].number;
  return `Qual ${n} of ${quals.length}`;
}

export interface Winners { alliance: number | null; teams: number[] }

/** The Winner award's teams and their alliance, as the event page says it. Nothing until FIRST posts awards:
 *  a finished status alone doesn't prove the final was decided, so no playoff match stands in for it. */
export function winners(d: Pick<EventDetail, "awards" | "alliances">): Winners | null {
  const awarded = d.awards.filter((a) => a.type === "Winner").map((a) => a.team);
  if (!awarded.length) return null;
  const a = d.alliances.find((x) => [x.captain, x.pick1, x.pick2].some((t) => t != null && awarded.includes(t)));
  return { alliance: a?.number ?? null, teams: awarded };
}

/** How the call went: called it, upset, or neither (a tie, an even call, no call, not played). */
export function verdict(m: MatchView): "called" | "upset" | null {
  const p = m.prediction;
  if (!p || !m.played || !m.red.score || !m.blue.score || m.red.score.total === m.blue.score.total || p.pRed === 0.5) return null;
  return (p.pRed > 0.5) === (m.red.score.total > m.blue.score.total) ? "called" : "upset";
}

export interface DisplayModel {
  progress: string | null;
  /** The now panel: on the field (no score yet), or the last result. Null before any match has started or been played. */
  now: { match: MatchView; kind: "on-field" | "result" } | null;
  upNext: MatchView[];
  /** The tracked teams' next match, when it isn't the one on the field or already first in Up next. */
  mine: MatchView | null;
  /** What the countdown counts to; `start` null when the time isn't known or the schedule runs behind (no timer then). */
  countdown: { match: MatchView; start: number | null } | null;
  rankings: { rows: FieldRow[]; final: boolean };
  winners: Winners | null;
  /** No schedule posted yet. */
  noSchedule: boolean;
  /** A finished event's scheduled matches that never got a result (they aren't coming: no Up next for them). */
  unreported: number;
}

export function displayModel(d: EventDetail, now: number, highlight: ReadonlySet<number> = new Set()): DisplayModel {
  const all = unplayed(d.matches);
  // Only the event's own status says it's over: every posted match being played can just mean alliance
  // selection, or the next playoff round not posted yet.
  const finished = d.event.status === "finished";
  // Once the event is over (its last day has passed), a match without a result is one that was never reported,
  // not one still to come: nothing is up now or next, and no countdown.
  const left = finished ? [] : all;
  const first = left[0] ?? null;
  const onField = first && Number.isFinite(at(first)) && at(first) <= now ? first : null;
  const last = lastPlayed(d.matches);
  const nowPanel = onField ? { match: onField, kind: "on-field" as const } : last ? { match: last, kind: "result" as const } : null;
  const queue = onField ? left.slice(1) : left;
  const upNext = queue.slice(0, UP_NEXT);
  const mineMatch = highlight.size ? nextMatch(left, highlight) : null;
  const mine = mineMatch && mineMatch.key !== onField?.key && mineMatch.key !== upNext[0]?.key ? mineMatch : null;
  // Behind schedule: an unplayed match more than LATE_MS past its start. Then no timer at all.
  const behind = left.some((m) => Number.isFinite(at(m)) && now - at(m) > LATE_MS);
  const target = queue[0] ?? null;
  const countdown = target ? { match: target, start: !behind && Number.isFinite(at(target)) && at(target) > now ? at(target) : null } : null;
  const ranked = d.field.filter((f) => f.rank != null).sort((a, b) => a.rank! - b.rank! || a.team - b.team).slice(0, TOP);
  return {
    progress: finished ? (d.matches.length ? "Event finished" : null) : progress(d.matches, onField),
    now: nowPanel,
    upNext,
    mine,
    countdown,
    rankings: { rows: ranked, final: finished },
    winners: finished ? winners(d) : null,
    noSchedule: !d.matches.length,
    unreported: finished ? all.length : 0,
  };
}
