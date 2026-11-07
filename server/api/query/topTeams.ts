// "The top NJ team", "the best team in Romania", said where a team's number would be ("who would win between the top NJ
// team and the top Romania team"): that place's first team on its prediction-rating board, as "top teams in <place>"
// ranks them (the search season, RANKED_MIN_MATCHES rated matches, ties to the lower number). The query is read again
// with the numbers in their place; the answer says which team each phrase was taken as.
import { RANKED_MIN_MATCHES } from "../../../src/shared/rankings.js";
import { teamPageSql } from "../../../src/shared/teamPages.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { get } from "../../db.js";
import { searchSeason } from "../answers/season.js";
import { parseQuery, type ParseContext } from "./parse.js";

/** "(the) top / best / strongest / number one <place> team", or "… team in / from <place>". */
const TOP_TEAM = /\b(?:the\s+)?(?:top|best|strongest|number\s+one|no\s*1|highest[\s-]rated)\s+(?:(?:ranked|rated)\s+)?(?:(?<before>[\p{L}][\p{L}.'\s-]*?)\s+team|team\s+(?:in|from|of)\s+(?<after>[\p{L}][\p{L}.'\s-]*?))(?=\s+(?:and|vs\.?|versus|against|or|in|at|with|on)\b|[,?.!]|\s*$)/giu;

export interface TopTeamSaid { typed: string; team: number; name: string | null; place: string }

/** `q` with each place's top team said as its number, and which team each phrase was; null when none is said, or a
 *  place named has no rated team. */
export async function topTeamsSaid(q: string, ctx: ParseContext): Promise<{ q: string; said: TopTeamSaid[] } | null> {
  const found = [...q.matchAll(TOP_TEAM)];
  if (!found.length) return null;
  const season = searchSeason();
  const said: TopTeamSaid[] = [];
  let out = q;
  for (const m of found) {
    const words = (m.groups!.before ?? m.groups!.after ?? "").trim();
    // The words are a place and nothing else (a region or a country, never a town).
    const pl = (await parseQuery(words, ctx)).place;
    if (!pl || pl.kind === "city" || pl.typed.toLowerCase() !== words.toLowerCase()) return null;
    const top = await get<{ team: number; name: string | null }>(
      `SELECT s.team, t.name FROM team_season_stats s JOIN teams t ON t.number = s.team
       WHERE s.season = ? AND s.rating_matches >= ? AND s.rating_np IS NOT NULL AND ${teamPageSql("s.team", "t.name")} AND t.country = ?${pl.state ? " AND t.state = ?" : ""}
       ORDER BY s.rating_np DESC, s.team LIMIT 1`, [season, RANKED_MIN_MATCHES, pl.country, ...(pl.state ? [pl.state] : [])]);
    if (!top) return null;
    said.push({ typed: m[0].trim(), team: Number(top.team), name: top.name, place: pl.name });
    out = out.replace(m[0], ` ${top.team} `);
  }
  return { q: out.replace(/\s+/g, " ").trim(), said };
}

/** The line that says which team each phrase was read as. */
export const topTeamsNote = (said: TopTeamSaid[]) =>
  said.map((s) => `the top ${s.place} team by prediction rating in ${seasonLabel(searchSeason())} is ${s.name ? `${s.name} (${s.team})` : `Team ${s.team}`}`).join(", and ").replace(/^t/, "T");
