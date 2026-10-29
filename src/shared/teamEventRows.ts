// The team page's event rows, built the same way on the server (server/api/teams.ts) and from a saved season pack
// (src/lib/offline/readers.ts). Each row's record is counted from the matches (src/shared/eventRecord.ts), so the
// rows add up to the season record. FIRST's ranking row gives only the rank (and, for a remote event, which has no
// win-loss record, the number of matches played).
import type { TeamEventRow } from "./api.js";
import type { EventRecord } from "./eventRecord.js";

/**
 * SQL for a season's events of one team: every event the team is on the roster of or listed in a match at, with
 * FIRST's ranking row, the event OPR, whether the event has results and whether the team was on the field in one.
 * `meetRanks`: also the meet's own rank and ranking score (team_event_records, which a season pack doesn't hold).
 */
export function teamEventsQuery(season: number, team: number, o: { meetRanks: boolean }): { sql: string; args: number[] } {
  const sql = `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.city, e.state, e.country, e.remote,
            et.rank, et.rp, et.wins, et.losses, et.ties, et.qual_played,
            ${o.meetRanks ? "r.rank meet_rank, r.rp meet_rp," : "NULL meet_rank, NULL meet_rp,"}
            s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame, s.opr_pen, s.avg_score, s.avg_np, s.avg_pen,
            ${KEEP_COLUMNS}
     FROM events e
     LEFT JOIN event_teams et ON et.season = e.season AND et.code = e.code AND et.team = ?
     LEFT JOIN team_event_stats s ON s.season = e.season AND s.code = e.code AND s.team = ?
     ${o.meetRanks ? "LEFT JOIN team_event_records r ON r.season = e.season AND r.code = e.code AND r.team = ? AND e.type = 'LeagueMeet'" : ""}
     WHERE e.season = ? AND (et.team IS NOT NULL OR e.code IN (SELECT code FROM match_teams WHERE season = ? AND team = ?))
     ORDER BY e.start, e.code`;
  return { sql, args: [team, team, team, ...(o.meetRanks ? [team] : []), season, season, team] };
}

type Seat = NonNullable<TeamEventRow["alliance"]>["seat"];
const num = (x: unknown) => (x == null ? null : Number(x));

/**
 * The rows, from teamEventsQuery's rows and the team's records (recordsFromRows, keyed "team|code"). Kept:
 *  - an event with a match on the team's record;
 *  - one where it was on the field (a surrogate's only matches: on the field, not on its record);
 *  - a remote event (2020–2023: one robot a "match", so no win-loss record, only FIRST's count of matches played);
 *  - an event with no results yet that hasn't ended (upcoming, or under way), and a finished event that published
 *    no scores (an unplayed scrimmage: the row says so). Not a league meet with no results once it's over: a league
 *    lists every league team at every meet, so there's no telling whether the team was there.
 * Left out: an event with results the team has no match in (a league roster entry for a meet it skipped).
 * A league meet's rank and ranking score are the meet's own (FIRST's are the league's running standing).
 */
/**
 * Whether an event is one of the team's (the rule above). `r` needs remote, type, start, end, has_results (any played
 * match there) and on_field (the team on the field in one); `rec` is its record there, if any. Also what picks a
 * team's last and next event in its summary (server/api/teams.ts teamSummaries).
 */
export function keepEvent(r: any, rec: EventRecord | undefined, today: string): boolean {
  const ended = (r.end ?? r.start ?? "9999") < today;
  return (!!rec && rec.played > 0) || !!Number(r.on_field) || !!Number(r.remote ?? 0)
    || (!Number(r.has_results) && (!ended || r.type !== "LeagueMeet"));
}

/** SQL columns keepEvent reads from the match tables, for events `e` and the team `?` (one arg). */
export const KEEP_COLUMNS = `EXISTS (SELECT 1 FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1) has_results,
            EXISTS (SELECT 1 FROM match_teams x JOIN matches m
                      ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
                    WHERE x.season = e.season AND x.code = e.code AND x.team = ? AND x.on_field = 1 AND m.played = 1) on_field`;

export function teamEventRows(
  season: number, team: number, rows: any[], recs: Map<string, EventRecord>, awards: any[], alliances: any[], today: string,
): TeamEventRow[] {
  const out: TeamEventRow[] = [];
  for (const r of rows) {
    const rec = recs.get(`${team}|${r.code}`);
    const remote = !!Number(r.remote ?? 0);
    if (!keepEvent(r, rec, today)) continue;
    const meet = r.type === "LeagueMeet";
    const al = alliances.find((a) => a.code === r.code);
    const seat: Seat | null = al ? (Number(al.captain) === team ? "captain" : Number(al.pick1) === team ? "pick1" : Number(al.pick2) === team ? "pick2" : "backup") : null;
    out.push({
      season, code: r.code, name: r.name, type: r.type, start: r.start, end: r.end, city: r.city, state: r.state, country: r.country,
      rank: meet ? num(r.meet_rank) : num(r.rank), rp: meet ? num(r.meet_rp) : num(r.rp),
      wins: rec ? rec.wins : null, losses: rec ? rec.losses : null, ties: rec ? rec.ties : null, played: rec ? rec.played : null,
      qualPlayed: rec ? rec.qual.played : remote ? num(r.qual_played) : null,
      qual: rec ? rec.qual : null,
      onField: !!Number(r.on_field),
      opr: { np: r.opr_np, auto: r.opr_auto, teleop: r.opr_teleop, endgame: r.opr_endgame, pen: r.opr_pen },
      avg: { score: r.avg_score, np: r.avg_np, pen: r.avg_pen },
      awards: awards.filter((a) => a.code === r.code).map((a) => ({ type: a.type, placement: Number(a.placement), name: a.name })),
      alliance: al && seat ? { number: Number(al.number), seat } : null,
    });
  }
  return out;
}
