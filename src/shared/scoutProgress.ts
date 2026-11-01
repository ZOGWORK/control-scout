// How far scouting has got at an event, worked out once from the space's entries and used everywhere it shows:
// the event picker's cards, Event day's header strip and its pit and match queues. One source, so the numbers
// never disagree between them. Pure (entries in, counts out); match progress per match is scoutMatch's own.
import { matchProgress, scoutedByMatch, type ScheduleMatch, type Watching } from "./scoutMatch";

type Entry = { eventCode: string | null; matchLabel: string | null; kind: string; team: number; deleted?: boolean; updatedAt?: number };

const sameEvent = (e: Entry, code: string) => !e.deleted && (e.eventCode ?? "").toUpperCase() === code;

/** The teams with a pit entry at an event. */
export function pitScouted(entries: readonly Entry[], eventCode: string): Set<number> {
  const code = eventCode.trim().toUpperCase(), out = new Set<number>();
  for (const e of entries) if (e.kind === "pit" && sameEvent(e, code)) out.add(e.team);
  return out;
}

export interface Progress { done: number; total: number }

/**
 * Pit scouting at an event: its teams with a pit entry there, out of its teams. `teams`: the event's team list
 * when known (only those count), else just how many teams it has (the event list's count).
 */
export function pitProgress(entries: readonly Entry[], eventCode: string, teams: readonly number[] | number): Progress {
  const done = pitScouted(entries, eventCode);
  if (typeof teams === "number") return { done: Math.min(done.size, teams), total: teams };
  return { done: teams.filter((t) => done.has(t)).length, total: teams.length };
}

/** Matches done for what the scout watches (every watched team has an entry), out of the schedule's matches. */
export function matchQueueProgress(schedule: readonly ScheduleMatch[], watching: Watching, scouted: Map<string, Set<number>>): Progress {
  let done = 0;
  for (const m of schedule) if (matchProgress(m, watching, scouted) === "done") done++;
  return { done, total: schedule.length };
}

/** Matches at an event with at least one entry (no schedule needed: the event picker's cards), out of `total`. */
export function matchesWithEntries(entries: readonly Entry[], eventCode: string, total: number): Progress {
  const n = scoutedByMatch(entries, eventCode).size;
  return { done: total > 0 ? Math.min(n, total) : n, total };
}

/** Entries at an event saved today on this device's clock. */
export function entriesToday(entries: readonly Entry[], eventCode: string, now = new Date()): number {
  const code = eventCode.trim().toUpperCase();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let n = 0;
  for (const e of entries) if (sameEvent(e, code) && (e.updatedAt ?? 0) >= start) n++;
  return n;
}
