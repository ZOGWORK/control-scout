// What `npm run power-rankings:new` writes (scripts/power-rankings-new.ts): a new week's file with
// the current top 25 by rating filled in, so the authors only write the intro and the blurbs.
import { all, get } from "../db.js";
import { PREDICT_SEASONS } from "../data/seasons.js";
import { POWER_RANKINGS_SIZE } from "../../src/shared/powerRankings.js";
import { scaffold, type ScaffoldTeam } from "./format.js";

/** Rated teams need this many rated matches to be listed (as the world rankings do). */
export const MIN_RATED_MATCHES = 3;

/** The season to rank: the newest one with rated teams. */
export async function latestRatedSeason(): Promise<number | null> {
  const r = await get<{ season: number | null }>(
    `SELECT MAX(season) season FROM team_season_stats WHERE rating_np IS NOT NULL AND rating_matches >= ? AND season IN (${PREDICT_SEASONS.map(() => "?").join(",")})`,
    [MIN_RATED_MATCHES, ...PREDICT_SEASONS]);
  return r?.season ? Number(r.season) : null;
}

/** The season's top teams by prediction rating (ties: more rated matches, then the lower number). */
export async function topByRating(season: number, n = POWER_RANKINGS_SIZE): Promise<ScaffoldTeam[]> {
  const rows = await all<{ team: number; name: string | null; rating_np: number; opr_np: number | null; wins: number; losses: number; ties: number }>(
    `SELECT s.team, t.name, s.rating_np, s.opr_np, s.wins, s.losses, s.ties FROM team_season_stats s LEFT JOIN teams t ON t.number = s.team
     WHERE s.season = ? AND s.rating_np IS NOT NULL AND s.rating_matches >= ? ORDER BY s.rating_np DESC, s.rating_matches DESC, s.team LIMIT ?`,
    [season, MIN_RATED_MATCHES, n]);
  return rows.map((r) => ({
    team: Number(r.team), name: r.name?.trim() || null, rating: Number(r.rating_np), opr: r.opr_np == null ? null : Number(r.opr_np),
    wins: Number(r.wins), losses: Number(r.losses), ties: Number(r.ties),
  }));
}

/** The file for a week, from the database's current ratings. */
export async function newWeekFile(o: { week: string; season: number; published: string }): Promise<{ text: string; teams: number }> {
  const teams = await topByRating(o.season);
  return { text: scaffold({ ...o, teams }), teams: teams.length };
}
