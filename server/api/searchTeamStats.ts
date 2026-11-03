// Each team row's season numbers in search (`SearchHit.team`): the header box's OPR badge and the /search cards'
// record, OPR and rank. One query for the rows shown, from team_season_stats: the team's newest season with matches
// played (the season its hit links to, when it names one and has matches then). A number the data lacks is left out.
import type { SearchHit, SearchTeamStats } from "../../src/shared/api.js";
import { all } from "../db.js";

export async function withTeamStats(hits: SearchHit[]): Promise<SearchHit[]> {
  const teams = [...new Set(hits.filter((h) => h.kind === "team").map((h) => Number(h.ref)))];
  if (!teams.length) return hits;
  const rows = await all<any>(
    `SELECT team, season, opr_np, rank_np, ranked_teams, wins, losses, ties FROM team_season_stats
     WHERE team IN (${teams.map(() => "?").join(",")}) AND matches > 0 ORDER BY season DESC`, teams);
  const bySeason = new Map<string, any>(), newest = new Map<number, any>();
  for (const r of rows) {
    bySeason.set(`${r.team}:${r.season}`, r);
    if (!newest.has(Number(r.team))) newest.set(Number(r.team), r);
  }
  return hits.map((h) => {
    if (h.kind !== "team") return h;
    const r = (h.linkSeason != null ? bySeason.get(`${h.ref}:${h.linkSeason}`) : null) ?? newest.get(Number(h.ref));
    if (!r) return h;
    const team: SearchTeamStats = {
      season: Number(r.season),
      ...(r.opr_np != null ? { opr: Math.round(Number(r.opr_np) * 10) / 10 } : {}),
      record: { w: Number(r.wins), l: Number(r.losses), t: Number(r.ties) },
      ...(r.rank_np != null && r.ranked_teams ? { rank: { n: Number(r.rank_np), of: Number(r.ranked_teams) } } : {}),
    };
    return { ...h, team };
  });
}
