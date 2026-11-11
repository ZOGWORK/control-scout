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
   *  Shown, labelled, in event lists; the best and worst finish fall back to it (as a share of the league's ranked
   *  teams) only when the meet's own rank (\`meet\`) isn't posted; the mean rank leaves it out. */
  standing?: { n: number; of: number | null } | null;
  /** A league meet's own finish: the team's rank at that meet among the teams ranked there, as its team page shows
   *  it (team_event_records). The best and worst finish judge a meet by it, the league standing only without it. */
  meet?: { n: number; of: number | null } | null;
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
  /** How its playoffs went there: on the Winning Alliance, the Finalist Alliance, or on an alliance that went out
   *  earlier (from FIRST's awards and alliance lists); null when it wasn't on a playoff alliance. */
  playoff?: "won" | "finalist" | "alliance" | null;
  /** It took an advancing slot there (FIRST's advancement list; a declined slot isn't one). */
  advanced?: boolean;
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
  const [evs, ss, recs, alAwards, onAlliance, advLists] = await Promise.all([
    all<any>(
      `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.city, e.state, e.country, e.division_code, et.rank,
              (SELECT COUNT(*) FROM event_teams r WHERE r.season = et.season AND r.code = et.code AND r.rank IS NOT NULL) ranked,
              -- A league meet's standing is out of the league's ranked teams through that meet (as facts.ts's league
              -- standing counts them), not the meet's own roster.
              CASE WHEN e.type = 'LeagueMeet' THEN (SELECT COUNT(DISTINCT o.team) FROM event_teams o JOIN events oe ON oe.season = o.season AND oe.code = o.code
                WHERE o.season = et.season AND o.rank IS NOT NULL AND (oe.code = e.code OR (e.league IS NOT NULL AND oe.league = e.league AND oe.region IS e.region AND oe.type = 'LeagueMeet' AND oe.start <= e.start))) END league_ranked,
              -- A league meet's own rank, and how many teams ranked at that meet (the team page's figures).
              CASE WHEN e.type = 'LeagueMeet' THEN (SELECT r.rank FROM team_event_records r WHERE r.season = et.season AND r.code = et.code AND r.team = et.team) END meet_rank,
              CASE WHEN e.type = 'LeagueMeet' THEN (SELECT COUNT(*) FROM team_event_records r WHERE r.season = et.season AND r.code = et.code AND r.rank IS NOT NULL) END meet_ranked,
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
    // The playoffs and advancement at each of its events: the alliance awards (the Winning Alliance's, never a
    // leadership award of the same type), the alliances it was on, and the advancement lists it is on.
    all<any>(`SELECT season, code, type FROM awards WHERE team = ? AND type IN ('Winner', 'Finalist') AND COALESCE(name, '') NOT LIKE '%Leadership%'`, [team]),
    all<any>("SELECT season, code FROM alliances WHERE ? IN (captain, pick1, pick2, backup)", [team]),
    all<any>("SELECT a.season, a.code, a.rows FROM advancement a JOIN event_teams et ON et.season = a.season AND et.code = a.code AND et.team = ?", [team]),
  ]);
  const rec = new Map(recs.map((r) => [`${r.season}|${r.code}`, { wins: Number(r.wins) || 0, losses: Number(r.losses) || 0, ties: Number(r.ties) || 0 }]));
  const k = (r: { season: unknown; code: unknown }) => `${r.season}|${r.code}`;
  const won = new Set(alAwards.filter((a) => a.type === "Winner").map(k)), finalist = new Set(alAwards.filter((a) => a.type === "Finalist").map(k));
  const allied = new Set(onAlliance.map(k));
  const advanced = new Set(advLists.filter((a) => { try { return (JSON.parse(a.rows) as { team: number; status: string; declined?: boolean }[]).some((x) => Number(x.team) === team && x.status === "FIRST" && !x.declined); } catch { return false; } }).map(k));
  const playoffOf = (r: { season: unknown; code: unknown }) => (won.has(k(r)) ? "won" as const : finalist.has(k(r)) ? "finalist" as const : allied.has(k(r)) ? "alliance" as const : null);
  return {
    events: evs.map((r) => ({
      season: Number(r.season), code: r.code, name: shortEvent(r.name, r.type ?? null), type: r.type ?? null, start: r.start ?? null, end: r.end ?? null,
      city: r.city ?? null, state: r.state ?? null, country: r.country ?? null, division: r.division_code ?? null,
      // A league meet's stored rank is the league's running standing, not the team's finish there: left out.
      rank: r.type === "LeagueMeet" ? null : num(r.rank), of: r.type === "LeagueMeet" ? null : Number(r.ranked) || null,
      standing: r.type === "LeagueMeet" && r.rank != null ? { n: Number(r.rank), of: Number(r.league_ranked) >= Number(r.rank) ? Number(r.league_ranked) : null } : null,
      meet: r.type === "LeagueMeet" && r.meet_rank != null ? { n: Number(r.meet_rank), of: Number(r.meet_ranked) >= Number(r.meet_rank) ? Number(r.meet_ranked) : null } : null, opr: num(r.opr_np), auto: num(r.opr_auto), teleop: num(r.opr_teleop), endgame: num(r.opr_endgame),
      matches: Number(r.matches) || 0,
      avgScore: num(r.avg_score), avgPen: num(r.avg_pen), wins: num(r.wins), losses: num(r.losses), ties: num(r.ties),
      rp: r.type === "LeagueMeet" ? null : num(r.rp),
      record: rec.get(`${r.season}|${r.code}`) ?? null,
      playoff: playoffOf(r), advanced: advanced.has(k(r)),
    })),
    seasons: ss.map((r) => ({
      season: Number(r.season), opr: num(r.opr_np), auto: num(r.opr_auto), teleop: num(r.opr_teleop), endgame: num(r.opr_endgame),
      rank: num(r.rank_np), of: num(r.ranked_teams), rating: num(r.rating_np), ratingSd: num(r.rating_sd), ratingRank: num(r.rating_rank),
      events: Number(r.events) || 0, matches: Number(r.matches) || 0, wins: Number(r.wins) || 0, losses: Number(r.losses) || 0, ties: Number(r.ties) || 0,
      avgNp: num(r.avg_np),
    })),
  };
}
