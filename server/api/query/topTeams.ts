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

/** A place's words: never the word "team", so one phrase never runs into the next ("the top team in ohio vs the top
 *  romania team" is two phrases). */
const PLACE = String.raw`\p{L}(?:(?!\bteams?\b)[\p{L}.'\s-])*?`;
/** "(the) top / best / strongest / number one <place> team", or "… team in / from <place>" (tried first). */
const TOP_TEAM = new RegExp(String.raw`\b(?:the\s+)?(?:top|best|strongest|number\s+one|no\s*1|highest[\s-]rated)\s+(?:(?:ranked|rated)\s+)?(?:team\s+(?:in|from|of)\s+(?<after>${PLACE})|(?<before>${PLACE})\s+team)(?=\s+(?:and|vs\.?|versus|against|or|in|at|with|on)\b|[,?.!]|\s*$)`, "giu");

export interface TopTeamSaid { typed: string; team: number; name: string | null; place: string;
  /** Part of a region said ("north jersey"): read as all of it, and said so. */
  part?: string }

/** `q` with each place's top team said as its number, and which team each phrase was; null when none is said, or a
 *  place named has no rated team. `season`: the one the question names, else the search season. */
export async function topTeamsSaid(q: string, ctx: ParseContext, season = searchSeason()): Promise<{ q: string; said: TopTeamSaid[]; season: number } | null> {
  const found = [...q.matchAll(TOP_TEAM)];
  if (!found.length) return null;
  const said: TopTeamSaid[] = [];
  let out = q;
  for (const m of found) {
    const words = (m.groups!.after ?? m.groups!.before ?? "").trim();
    // The words are a place and nothing else (a region or a country, never a town).
    const pl = (await parseQuery(words, ctx)).place;
    if (!pl || pl.kind === "city" || pl.typed.toLowerCase() !== words.toLowerCase()) return null;
    const top = await get<{ team: number; name: string | null }>(
      `SELECT s.team, t.name FROM team_season_stats s JOIN teams t ON t.number = s.team
       WHERE s.season = ? AND s.rating_matches >= ? AND s.rating_np IS NOT NULL AND ${teamPageSql("s.team", "t.name")} AND t.country = ?${pl.state ? " AND t.state = ?" : ""}
       ORDER BY s.rating_np DESC, s.team LIMIT 1`, [season, RANKED_MIN_MATCHES, pl.country, ...(pl.state ? [pl.state] : [])]);
    if (!top) return null;
    said.push({ typed: m[0].trim(), team: Number(top.team), name: top.name, place: pl.name, ...(pl.part ? { part: pl.part } : {}) });
    out = out.replace(m[0], ` ${top.team} `);
  }
  return { q: out.replace(/\s+/g, " ").trim(), said, season };
}

/** The line that says which team each phrase was read as. */
export const topTeamsNote = (said: TopTeamSaid[], season: number) =>
  said.map((s) => `the top ${s.place} team${s.part ? ` (${s.part.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())} isn't a separate region: all of ${s.place})` : ""} by prediction rating in ${seasonLabel(season)} is ${s.name ? `${s.name} (${s.team})` : `Team ${s.team}`}`).join(", and ").replace(/^t/, "T");
