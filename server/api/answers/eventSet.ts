// A team's events and seasons as the team page already holds them (event_teams, team_event_stats, team_season_stats:
// computed by the stats job, never in a request), read once per team and kept a few minutes. The event and season
// superlatives (best finish, best OPR event, best season) order these rows; nothing here recomputes OPR or ratings.
import { all } from "../../db.js";
import { registerCache } from "../../caches.js";
import { recordSql } from "../../../src/shared/eventRecord.js";
import { ATTENDED } from "../teams.js";
import { shortEvent } from "./matchSet.js";

export interface TeamEvent {
  season: number; code: string; name: string; type: string | null; start: string | null; end: string | null;
  city: string | null; state: string | null; country: string | null; division: string | null;
  /** Qualification rank there, and how many teams were ranked (none for a league meet: its stored rank is the league's
   *  standing). */
  rank: number | null; of: number | null;
  /** A league meet's posted rank: the league's running standing after it, as the event page shows it (#1 of 20).
   *  Shown, labelled, in event lists; never a finish (best, worst or mean rank leave it out). */
  standing?: { n: number; of: number | null } | null;
  /** The team's OPR at the event, without penalties (as on its pages), and its phases. */
  opr: number | null; auto: number | null; teleop: number | null; endgame: number | null;
  matches: number;
  /** As the team page's trend chart reads them: the alliance's average score and penalty points it gave away (per
   *  match, with the team on it), its record there, and its ranking points (none for a league meet). */
  avgScore: number | null; avgPen: number | null; wins: number | null; losses: number | null; ties: number | null; rp: number | null;
  /** The record the team page's events list shows there: every counted match, playoffs included (eventRecord.ts). */
  record: { wins: number; losses: number; ties: number } | null;
  /** Its reliability index there (0–100), only on reliabilityEvents' rows. */
  reliability?: number | null;
}

/** The team's events with a reliability row (team_reliability, one per event), oldest first: an event where it missed
 *  every qualification match counts too (its no-shows are what the index counts), so `matches` is the qualification
 *  matches it was listed for, not those it took the field in. */
export async function reliabilityEvents(team: number): Promise<TeamEvent[]> {
  const rows = await all<any>(
    `SELECT r.season, r.code, r.matches, r.idx, e.name, e.type, e.start, e.end, e.city, e.state, e.country, e.division_code
     FROM team_reliability r JOIN events e ON e.season = r.season AND e.code = r.code
     WHERE r.team = ? AND r.code <> '' ORDER BY e.start, e.code`, [team]);
  return rows.map((r) => ({
    season: Number(r.season), code: r.code, name: shortEvent(r.name, r.type ?? null), type: r.type ?? null, start: r.start ?? null, end: r.end ?? null,
    city: r.city ?? null, state: r.state ?? null, country: r.country ?? null, division: r.division_code ?? null,
    rank: null, of: null, opr: null, auto: null, teleop: null, endgame: null, matches: Number(r.matches) || 0,
    avgScore: null, avgPen: null, wins: null, losses: null, ties: null, rp: null, record: null, reliability: num(r.idx),
  }));
}

export interface TeamSeason {
  season: number;
  opr: number | null; auto: number | null; teleop: number | null; endgame: number | null;
  /** OPR rank among the season's ranked teams (3+ matches), and how many. */
  rank: number | null; of: number | null;
  rating: number | null; ratingSd: number | null; ratingRank: number | null;
  events: number; matches: number; wins: number; losses: number; ties: number;
  avgNp: number | null;
}

const TTL_MS = 5 * 60_000, MAX = 300;
const cache = new Map<number, { at: number; rows: Promise<{ events: TeamEvent[]; seasons: TeamSeason[] }> }>();
registerCache("Search answers: team events", () => cache.clear());

/** The team's attended events (oldest first) and its seasons with stats (oldest first). */
export function teamEventSet(team: number): Promise<{ events: TeamEvent[]; seasons: TeamSeason[] }> {
  const hit = cache.get(team);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const rows = load(team);
  cache.set(team, { at: Date.now(), rows });
  rows.catch(() => { if (cache.get(team)?.rows === rows) cache.delete(team); });
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return rows;
}

const num = (v: unknown) => (v == null ? null : Number(v));

async function load(team: number): Promise<{ events: TeamEvent[]; seasons: TeamSeason[] }> {
  const [evs, ss, recs] = await Promise.all([
    all<any>(
      `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.city, e.state, e.country, e.division_code, et.rank,
              (SELECT COUNT(*) FROM event_teams r WHERE r.season = et.season AND r.code = et.code AND r.rank IS NOT NULL) ranked,
              -- A league meet's standing is out of the league's ranked teams through that meet (as facts.ts's league
              -- standing counts them), not the meet's own roster.
              CASE WHEN e.type = 'LeagueMeet' THEN (SELECT COUNT(DISTINCT o.team) FROM event_teams o JOIN events oe ON oe.season = o.season AND oe.code = o.code
                WHERE o.season = et.season AND o.rank IS NOT NULL AND (oe.code = e.code OR (e.league IS NOT NULL AND oe.league = e.league AND oe.region IS e.region AND oe.type = 'LeagueMeet' AND oe.start <= e.start))) END league_ranked,
              s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame, COALESCE(s.matches, 0) matches,
              s.avg_score, s.avg_pen, s.wins, s.losses, s.ties, et.rp
       FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
       LEFT JOIN team_event_stats s ON s.season = et.season AND s.code = et.code AND s.team = et.team
       WHERE et.team = ? AND COALESCE(e.remote, 0) = 0 AND ${ATTENDED}
       ORDER BY e.start, e.code`, [team]),
    all<any>(
      `SELECT season, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_sd, rating_rank, events, matches, wins, losses, ties, avg_np
       FROM team_season_stats WHERE team = ? ORDER BY season`, [team]),
    all<any>(recordSql("mt.team = ?"), [team]),
  ]);
  const rec = new Map(recs.map((r) => [`${r.season}|${r.code}`, { wins: Number(r.wins) || 0, losses: Number(r.losses) || 0, ties: Number(r.ties) || 0 }]));
  return {
    events: evs.map((r) => ({
      season: Number(r.season), code: r.code, name: shortEvent(r.name, r.type ?? null), type: r.type ?? null, start: r.start ?? null, end: r.end ?? null,
      city: r.city ?? null, state: r.state ?? null, country: r.country ?? null, division: r.division_code ?? null,
      // A league meet's stored rank is the league's running standing, not the team's finish there: left out.
      rank: r.type === "LeagueMeet" ? null : num(r.rank), of: r.type === "LeagueMeet" ? null : Number(r.ranked) || null,
      standing: r.type === "LeagueMeet" && r.rank != null ? { n: Number(r.rank), of: Number(r.league_ranked) >= Number(r.rank) ? Number(r.league_ranked) : null } : null, opr: num(r.opr_np), auto: num(r.opr_auto), teleop: num(r.opr_teleop), endgame: num(r.opr_endgame),
      matches: Number(r.matches) || 0,
      avgScore: num(r.avg_score), avgPen: num(r.avg_pen), wins: num(r.wins), losses: num(r.losses), ties: num(r.ties),
      rp: r.type === "LeagueMeet" ? null : num(r.rp),
      record: rec.get(`${r.season}|${r.code}`) ?? null,
    })),
    seasons: ss.map((r) => ({
      season: Number(r.season), opr: num(r.opr_np), auto: num(r.opr_auto), teleop: num(r.opr_teleop), endgame: num(r.opr_endgame),
      rank: num(r.rank_np), of: num(r.ranked_teams), rating: num(r.rating_np), ratingSd: num(r.rating_sd), ratingRank: num(r.rating_rank),
      events: Number(r.events) || 0, matches: Number(r.matches) || 0, wins: Number(r.wins) || 0, losses: Number(r.losses) || 0, ties: Number(r.ties) || 0,
      avgNp: num(r.avg_np),
    })),
  };
}
