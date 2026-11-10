// League standings (src/shared/leagues.ts): FIRST's official league rankings as the sync stored them
// (server/data/leagues.ts), each team's name and how many of the league's meets it played. A league is its region and
// code together: "NE" is a league in New Jersey and another in Florida.
import { all, get } from "../db.js";
import type { LeagueMeet, LeagueStandingRow, LeagueStandings } from "../../src/shared/leagues.js";

/** A league meet the team played a match at (a ranked roster entry alone is no proof: an upcoming meet's list carries
 *  the league's standing before anyone plays). */
const PLAYED = `EXISTS (SELECT 1 FROM match_teams x JOIN matches m ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
  WHERE x.season = et.season AND x.code = et.code AND x.team = et.team AND x.on_field = 1 AND m.played = 1)`;
import { placeName } from "../../src/shared/regions.js";

/** A league's region and code as stored ("usnj" → "USNJ"), or null when the season has no such league. */
export async function storedLeague(season: number, region: string, code: string): Promise<{ region: string; code: string } | null> {
  const r = await get<{ region: string; code: string }>(
    `SELECT region, code FROM leagues WHERE season = ? AND region = ? COLLATE NOCASE AND code = ? COLLATE NOCASE
     UNION ALL SELECT region, league code FROM events WHERE season = ? AND region = ? COLLATE NOCASE AND league = ? COLLATE NOCASE LIMIT 1`,
    [season, region, code, season, region, code]);
  return r ?? null;
}

/** One league's standings, or null when the season has no such league. */
export async function leagueStandings(season: number, regionRaw: string, codeRaw: string): Promise<LeagueStandings | null> {
  const k = await storedLeague(season, regionRaw, codeRaw);
  if (!k) return null;
  const { region, code } = k;
  const [info, rows, meets] = await Promise.all([
    get<{ name: string | null; location: string | null; ranked_at: string | null }>("SELECT name, location, ranked_at FROM leagues WHERE season = ? AND region = ? AND code = ?", [season, region, code]),
    all<Omit<LeagueStandingRow, "meets"> & { meets: number | null }>(
      `SELECT r.rank, r.team, t.name, r.wins, r.losses, r.ties, r.rs, r.tbp, r.played,
         (SELECT COUNT(*) FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
           WHERE et.season = r.season AND et.team = r.team AND e.type = 'LeagueMeet' AND e.region = r.region AND e.league = r.league AND ${PLAYED}) meets
       FROM league_rankings r LEFT JOIN teams t ON t.number = r.team
       WHERE r.season = ? AND r.region = ? AND r.league = ? ORDER BY r.rank, r.team`, [season, region, code]),
    all<Omit<LeagueMeet, "played"> & { played: number; state: string | null; country: string | null }>("SELECT e.code, e.name, e.start, e.type, e.state, e.country, EXISTS (SELECT 1 FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1) played FROM events e WHERE e.season = ? AND e.region = ? AND e.league = ? ORDER BY e.start, e.code", [season, region, code]),
  ]);
  // Where the league plays: its meets' state (or country).
  const at = meets.find((m) => m.state || m.country);
  const place = at ? placeName(at.state, at.country) : null;
  return {
    season, region, code, name: info?.name?.trim() || null, location: info?.location ?? null, place, readAt: info?.ranked_at ?? null,
    rows: rows.map((r) => ({ ...r, meets: r.meets ?? 0 })), meets: meets.map(({ code, name, start, type, played }) => ({ code, name, start, type, played: !!played })),
  };
}

/** A team's place in its league's standings for a season (its latest league meet's league), or null. */
export async function teamLeagueStanding(season: number, team: number): Promise<{ region: string; code: string; name: string | null; rank: number; of: number; played: boolean } | null> {
  const r = await get<{ region: string; code: string; name: string | null; rank: number; n: number; played: number | null }>(
    `SELECT r.region, r.league code, l.name, r.rank, r.played, (SELECT COUNT(*) FROM league_rankings o WHERE o.season = r.season AND o.region = r.region AND o.league = r.league AND COALESCE(o.played, 1) > 0) n
     FROM league_rankings r LEFT JOIN leagues l ON l.season = r.season AND l.region = r.region AND l.code = r.league
     WHERE r.season = ? AND r.team = ?
     ORDER BY (SELECT MAX(e.start) FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
               WHERE et.season = r.season AND et.team = r.team AND e.region = r.region AND e.league = r.league) DESC LIMIT 1`, [season, team]);
  // A member with no match yet sits below everyone in FIRST's list: no place out of the teams that have played.
  return r ? { region: r.region, code: r.code, name: r.name, rank: r.rank, of: r.n, played: (r.played ?? 1) > 0 } : null;
}

/** The leagues of a season with standings, in `region` when given (FIRST's region code, "USNJ"): name and team count. */
export async function leaguesOf(season: number, region?: string): Promise<{ region: string; code: string; name: string | null; teams: number }[]> {
  return all(
    `SELECT r.region, r.league code, l.name, COUNT(*) teams FROM league_rankings r LEFT JOIN leagues l ON l.season = r.season AND l.region = r.region AND l.code = r.league
     WHERE r.season = ?${region ? " AND r.region = ?" : ""} GROUP BY r.region, r.league ORDER BY COALESCE(l.name, r.league)`, region ? [season, region] : [season]);
}
