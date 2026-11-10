// A team's win-loss-tie record: one rule for every record we show, so a team's event rows add up to its season
// record. Counted from the stored matches, never from FIRST's ranking rows: a league meet's ranking row is the
// league's running standing (earlier meets' matches included), and every ranking row is qualifications only.
//
// The rule: every played, scored match at an in-person event, playoffs included.
//  - Qualifications as FIRST's own rankings count them (its published W-L-T matches this for every team at every
//    2024 and 2025 event that isn't a league's): every team listed, a no-show and a disqualification included (they
//    keep the alliance's result), except a surrogate, whose match isn't on its record.
//  - Playoffs: the robots on the field. A playoff alliance lists three or four teams and fields two; the one sitting
//    out didn't play that match.
// Used by the stats job (server/stats/job.ts, the season record), the team page's event rows
// (server/api/teams.ts, src/lib/offline/readers.ts), team summaries, the team page's search snippet and the digest.

export interface Wlt { wins: number; losses: number; ties: number; played: number }
/** A team's record at one event: every counted match, and its qualification matches alone. */
export interface EventRecord extends Wlt { qual: Wlt }

/** Whether a listed team's result in a played, scored match goes on its record. */
export const onRecord = (level: string, t: { surrogate: boolean; onField: boolean }): boolean =>
  level === "qual" ? !t.surrogate : t.onField;

/** Events whose matches go on a team's season record (and its scores and records in search): qualifiers, league play,
 *  championships and premier events. Off-season events, scrimmages and demos never count; the team page lists them
 *  apart (offSeasonRecord). One list for the stats job, the team page and search. */
export const OFFICIAL_TYPES = ["Qualifier", "LeagueMeet", "LeagueTournament", "Championship", "FIRSTChampionship", "Premier", "SuperQualifier", "Official"] as const;
export const isOfficialEvent = (type: string | null | undefined): boolean => (OFFICIAL_TYPES as readonly string[]).includes(type ?? "");
/** The season record's scope, said on every card and tile that shows one. */
export const OFFICIAL_ONLY = "Official events only";
export const OFFICIAL_RULE = "A season record counts official events only (qualifiers, league play, championships and premier events); off-season events and scrimmages are listed apart, never added in.";

/** The matches at events off the record (off-season, scrimmages) added up from the team's event rows, or null when
 *  it played none: the team page's separate line. */
export function offSeasonRecord(rows: { type: string | null; wins: number | null; losses: number | null; ties: number | null }[]): (Pick<Wlt, "wins" | "losses" | "ties"> & { events: number }) | null {
  const off = rows.filter((r) => !isOfficialEvent(r.type) && r.wins != null);
  if (!off.length) return null;
  return off.reduce((a, r) => ({ wins: a.wins + (r.wins ?? 0), losses: a.losses + (r.losses ?? 0), ties: a.ties + (r.ties ?? 0), events: a.events + 1 }), { wins: 0, losses: 0, ties: 0, events: 0 });
}

/** Short form of the rule, for a note or tooltip next to a record. */
export const RECORD_RULE = "Every match played, playoffs included. As in FIRST's rankings, a qualification no-show still counts and a surrogate match doesn't.";

/**
 * SQL for counted results, one row per team and event: season, team, code, played, wins, losses, ties and the same
 * for qualification matches (qual_played, qual_wins, qual_losses, qual_ties). Args: `where`'s.
 * `where` filters match_teams `mt`, e.g. "mt.season = ? AND mt.team = ?" or "mt.season = ? AND mt.team IN (?, ?)".
 */
export function recordSql(where: string): string {
  return `SELECT season, team, code, COUNT(*) played,
      SUM(own > opp) wins, SUM(own < opp) losses, SUM(own = opp) ties,
      SUM(level = 'qual') qual_played, SUM(level = 'qual' AND own > opp) qual_wins,
      SUM(level = 'qual' AND own < opp) qual_losses, SUM(level = 'qual' AND own = opp) qual_ties
    FROM (SELECT mt.season, mt.team, mt.code, mt.level,
            COALESCE(CASE mt.alliance WHEN 'red' THEN m.red_total ELSE m.blue_total END, 0) own,
            COALESCE(CASE mt.alliance WHEN 'red' THEN m.blue_total ELSE m.red_total END, 0) opp
          FROM match_teams mt
          JOIN matches m ON m.season = mt.season AND m.code = mt.code AND m.level = mt.level AND m.series = mt.series AND m.number = mt.number
          JOIN events e ON e.season = mt.season AND e.code = mt.code
          WHERE (${where}) AND m.played = 1 AND m.red_np IS NOT NULL AND m.blue_np IS NOT NULL
            AND COALESCE(e.remote, 0) = 0
            AND CASE WHEN mt.level = 'qual' THEN COALESCE(mt.surrogate, 0) = 0 ELSE COALESCE(mt.on_field, 1) = 1 END)
    GROUP BY season, team, code`;
}

const n = (x: unknown) => Number(x ?? 0);

/** One recordSql row → its record. */
export const recordOf = (r: Record<string, unknown>): EventRecord => ({
  wins: n(r.wins), losses: n(r.losses), ties: n(r.ties), played: n(r.played),
  qual: { wins: n(r.qual_wins), losses: n(r.qual_losses), ties: n(r.qual_ties), played: n(r.qual_played) },
});

/** recordSql's rows → "team|code" (season left out: callers ask for one season) → record. */
export function recordsFromRows(rows: Record<string, unknown>[]): Map<string, EventRecord> {
  return new Map(rows.map((r) => [`${n(r.team)}|${String(r.code)}`, recordOf(r)]));
}

/** "5-1-0" (ties always shown, as the team page writes records). */
export const wltText = (r: Pick<Wlt, "wins" | "losses" | "ties">) => `${r.wins}-${r.losses}-${r.ties}`;
