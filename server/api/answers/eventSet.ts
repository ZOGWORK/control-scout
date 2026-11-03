// A team's events and seasons as the team page already holds them (event_teams, team_event_stats, team_season_stats:
// computed by the stats job, never in a request), read once per team and kept a few minutes. The event and season
// superlatives (best finish, best OPR event, best season) order these rows; nothing here recomputes OPR or ratings.
import { all } from "../../db.js";
import { registerCache } from "../../caches.js";
import { ATTENDED } from "../teams.js";
import { shortEvent } from "./matchSet.js";

export interface TeamEvent {
  season: number; code: string; name: string; type: string | null; start: string | null; end: string | null;
  city: string | null; state: string | null; country: string | null; division: string | null;
  /** Qualification rank there, and how many teams were ranked. */
  rank: number | null; of: number | null;
  /** The team's OPR at the event, without penalties (as on its pages), and its phases. */
  opr: number | null; auto: number | null; teleop: number | null; endgame: number | null;
  matches: number;
}

export interface TeamSeason {
  season: number;
  opr: number | null; auto: number | null; teleop: number | null; endgame: number | null;
  /** OPR rank among the season's ranked teams (3+ matches), and how many. */
  rank: number | null; of: number | null;
  rating: number | null; ratingRank: number | null;
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
  const [evs, ss] = await Promise.all([
    all<any>(
      `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.city, e.state, e.country, e.division_code, et.rank,
              (SELECT COUNT(*) FROM event_teams r WHERE r.season = et.season AND r.code = et.code AND r.rank IS NOT NULL) ranked,
              s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame, COALESCE(s.matches, 0) matches
       FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
       LEFT JOIN team_event_stats s ON s.season = et.season AND s.code = et.code AND s.team = et.team
       WHERE et.team = ? AND COALESCE(e.remote, 0) = 0 AND ${ATTENDED}
       ORDER BY e.start, e.code`, [team]),
    all<any>(
      `SELECT season, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_rank, events, matches, wins, losses, ties, avg_np
       FROM team_season_stats WHERE team = ? ORDER BY season`, [team]),
  ]);
  return {
    events: evs.map((r) => ({
      season: Number(r.season), code: r.code, name: shortEvent(r.name, r.type ?? null), type: r.type ?? null, start: r.start ?? null, end: r.end ?? null,
      city: r.city ?? null, state: r.state ?? null, country: r.country ?? null, division: r.division_code ?? null,
      rank: num(r.rank), of: Number(r.ranked) || null, opr: num(r.opr_np), auto: num(r.opr_auto), teleop: num(r.opr_teleop), endgame: num(r.opr_endgame),
      matches: Number(r.matches) || 0,
    })),
    seasons: ss.map((r) => ({
      season: Number(r.season), opr: num(r.opr_np), auto: num(r.opr_auto), teleop: num(r.opr_teleop), endgame: num(r.opr_endgame),
      rank: num(r.rank_np), of: num(r.ranked_teams), rating: num(r.rating_np), ratingRank: num(r.rating_rank),
      events: Number(r.events) || 0, matches: Number(r.matches) || 0, wins: Number(r.wins) || 0, losses: Number(r.losses) || 0, ties: Number(r.ties) || 0,
      avgNp: num(r.avg_np),
    })),
  };
}
