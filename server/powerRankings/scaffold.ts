// What `npm run power-rankings:new` writes (scripts/power-rankings-new.ts): a new week's file with
// the world rankings' top 25 filled in (server/api/rankings.ts: the newest weekly snapshot, or the
// live ranking), so the authors only write the intro and the blurbs.
import { all } from "../db.js";
import { defaultRankingsSeason, rankings, snapshotWeeks } from "../api/rankings.js";
import { POWER_RANKINGS_SIZE } from "../../src/shared/powerRankings.js";
import { scaffold, type ScaffoldTeam } from "./format.js";

/** The season to rank: the one the world rankings open on (the newest with rated teams). */
export const latestRatedSeason = () => defaultRankingsSeason();

/**
 * The season's top teams as the world rankings list them: from the newest weekly snapshot, or the
 * live ranking (`live`, or when the season has no snapshot yet). Each with its OPR and record now.
 */
export async function topByRating(season: number, o: { live?: boolean; n?: number } = {}): Promise<{ teams: ScaffoldTeam[]; week: string | null }> {
  const n = o.n ?? POWER_RANKINGS_SIZE;
  const week = o.live ? null : (await snapshotWeeks(season))[0] ?? null;
  const rows = (await rankings({ season, week, places: [], page: 1 })).rows.slice(0, n);
  const q = rows.map(() => "?").join(",");
  const stats = rows.length ? await all<{ team: number; opr_np: number | null; wins: number; losses: number; ties: number }>(
    `SELECT team, opr_np, wins, losses, ties FROM team_season_stats WHERE season = ? AND team IN (${q})`, [season, ...rows.map((r) => r.team)]) : [];
  const byTeam = new Map(stats.map((s) => [Number(s.team), s]));
  return {
    week,
    teams: rows.map((r) => {
      const s = byTeam.get(r.team);
      return { team: r.team, name: r.name?.trim() || null, rating: r.rating, opr: s?.opr_np == null ? null : Number(s.opr_np), wins: Number(s?.wins ?? 0), losses: Number(s?.losses ?? 0), ties: Number(s?.ties ?? 0) };
    }),
  };
}

/** The file for a week, from the world rankings. */
export async function newWeekFile(o: { week: string; season: number; published: string; live?: boolean }): Promise<{ text: string; teams: number; from: string | null }> {
  const top = await topByRating(o.season, { live: o.live });
  return { text: scaffold({ week: o.week, season: o.season, published: o.published, teams: top.teams }), teams: top.teams.length, from: top.week };
}
