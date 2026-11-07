// The rank and W-L-T a team shows at one event. At a league meet that's the meet's own standing (FieldRow.meet):
// FIRST's rank and record there are the league's running standing, not what happened at the meet.
import type { FieldRow } from "./api";

export interface EventStanding { rank: number | null; wins: number | null; losses: number | null; ties: number | null }

export function eventStanding(r: Pick<FieldRow, "rank" | "wins" | "losses" | "ties" | "meet">): EventStanding {
  if (r.meet !== undefined) return r.meet ? { rank: r.meet.rank, wins: r.meet.wins, losses: r.meet.losses, ties: r.meet.ties } : { rank: null, wins: null, losses: null, ties: null };
  return { rank: r.rank, wins: r.wins, losses: r.losses, ties: r.ties };
}

/** The teams that were at this league meet (a counted match here), or the whole field anywhere else. The field is
 *  FIRST's participant list for the meet (sources/first.ts), so before its first counted match it stays whole. */
export function eventRoster<T extends Pick<FieldRow, "meet">>(field: T[]): T[] {
  const here = field.filter((r) => r.meet);
  return here.length ? here : field;
}

/** League events (FIRST's standing is the league's): its W-L-T counts only each team's best matches, so a record
 *  that doesn't add up to the matches played isn't a record (2025 USNJNOM3: 10-0-0 over 16 played, for a 5-1 team). */
export const LEAGUE_TYPES = new Set(["LeagueMeet", "LeagueTournament"]);

export function recordAddsUp(wins: number | null, losses: number | null, ties: number | null, played: number | null): boolean {
  return wins != null && played != null && wins + (losses ?? 0) + (ties ?? 0) === played;
}
