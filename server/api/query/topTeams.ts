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
/** Where a phrase may end: before the word that joins it to the next part of the question, or at punctuation. */
const END = String.raw`(?=\s+(?:and|vs\.?|versus|against|or|in|at|with|on)\b|[,?.!]|\s*$)`;
/** "(the) top / best / strongest / number one <place> team", or "… team in / from <place>" (tried first: its place
 *  runs on to the longest words that are one place, as `placeAfter` reads them). */
const TOP_TEAM = new RegExp(String.raw`\b(?:the\s+)?(?:top|best|strongest|number\s+one|no\s*1|highest[\s-]rated)\s+(?:(?:ranked|rated)\s+)?(?:team\s+(?:in|from|of)\s+(?=\p{L})|(?<before>${PLACE})\s+team${END})`, "giu");
const ENDS = new RegExp(END, "gu");

type Place = NonNullable<Awaited<ReturnType<typeof parseQuery>>["place"]>;
/** The words are one place and nothing else: a region or a country, never a town. */
async function wholePlace(words: string, ctx: ParseContext): Promise<Place | null> {
  if (!words || /\bteams?\b/iu.test(words)) return null;
  const pl = (await parseQuery(words, ctx)).place;
  return pl && pl.kind !== "city" && pl.typed.toLowerCase() === words.toLowerCase() ? pl : null;
}

/** The place said after "team in": the longest words up to a phrase end that are one place, so a joining word inside
 *  a place's own name ("Trinidad and Tobago") stays in it, while "Ohio and <team>" stops at Ohio. */
async function placeAfter(rest: string, ctx: ParseContext): Promise<{ words: string; place: Place } | null> {
  const ends = [...new Set([...rest.matchAll(ENDS)].map((m) => m.index!))].filter((i) => i > 0).sort((a, b) => b - a);
  for (const end of ends) {
    const words = rest.slice(0, end).trim();
    const place = await wholePlace(words, ctx);
    if (place) return { words, place };
  }
  return null;
}

export interface TopTeamSaid { typed: string; team: number; name: string | null; place: string;
  /** Part of a region said ("north jersey"): read as all of it, and said so. */
  part?: string }

/** `q` with each place's top team said as its number, and which team each phrase was; null when none is said, or a
 *  place named has no rated team. `season`: the one the question names, else the search season. */
export async function topTeamsSaid(q: string, ctx: ParseContext, season = searchSeason()): Promise<{ q: string; said: TopTeamSaid[]; season: number } | null> {
  const said: TopTeamSaid[] = [];
  let out = "", from = 0;
  const re = new RegExp(TOP_TEAM.source, TOP_TEAM.flags);
  for (let m = re.exec(q); m; m = re.exec(q)) {
    let pl: Place | null, typed: string;
    if (m.groups!.before != null) {
      pl = await wholePlace(m.groups!.before.trim(), ctx);
      typed = m[0];
    } else {
      const after = await placeAfter(q.slice(m.index + m[0].length), ctx);
      pl = after?.place ?? null;
      typed = after ? q.slice(m.index, m.index + m[0].length) + after.words : m[0];
    }
    if (!pl) return null;
    re.lastIndex = m.index + typed.length;
    const top = await get<{ team: number; name: string | null }>(
      `SELECT s.team, t.name FROM team_season_stats s JOIN teams t ON t.number = s.team
       WHERE s.season = ? AND s.rating_matches >= ? AND s.rating_np IS NOT NULL AND ${teamPageSql("s.team", "t.name")} AND t.country = ?${pl.state ? " AND t.state = ?" : ""}
       ORDER BY s.rating_np DESC, s.team LIMIT 1`, [season, RANKED_MIN_MATCHES, pl.country, ...(pl.state ? [pl.state] : [])]);
    if (!top) return null;
    said.push({ typed: typed.trim(), team: Number(top.team), name: top.name, place: pl.name, ...(pl.part ? { part: pl.part } : {}) });
    out += `${q.slice(from, m.index)} ${top.team} `;
    from = m.index + typed.length;
  }
  if (!said.length) return null;
  return { q: (out + q.slice(from)).replace(/\s+/g, " ").trim(), said, season };
}

/** The line that says which team each phrase was read as. */
export const topTeamsNote = (said: TopTeamSaid[], season: number) =>
  said.map((s) => `the top ${s.place} team${s.part ? ` (${s.part.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())} isn't a separate region: all of ${s.place})` : ""} by prediction rating in ${seasonLabel(season)} is ${s.name ? `${s.name} (${s.team})` : `Team ${s.team}`}`).join(", and ").replace(/^t/, "T");
