// Every team by one whole name, as search reads a name (accents, case and punctuation folded), with its home: what
// "<name> <place>" (searchAnswer's namedInPlace) and "<name> in/from <place>" (searchIntents) pick the local team from.
import type { SearchHit } from "../../src/shared/api.js";
import type { Region } from "../../src/shared/regions.js";
import { cleanTeamName, searchTeamTitle } from "../../src/shared/teamTitle.js";
import { teamPageSql } from "../../src/shared/teamPages.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { all } from "../db.js";
import { normalize } from "./fuzzy.js";
import { ftsQuery } from "./search.js";
import { place } from "../../src/shared/format.js";

export interface NamedTeam { number: number; name: string | null; city: string | null; state: string | null; country: string | null; last: number | null }

/** The teams whose whole name is `name`, this season's first, then by number: the search index's candidates with no
 *  cap, then the teams themselves with their stored state and country (a team with no city on record still counts). */
export async function teamsByName(name: string): Promise<NamedTeam[]> {
  const want = normalize(name);
  const fts = want ? ftsQuery(name) : null;
  if (!fts) return [];
  const refs = (await all<{ ref: string }>("SELECT ref FROM search WHERE search MATCH ? AND kind = 'team'", [fts])).map((r) => Number(r.ref)).filter(Number.isFinite);
  if (!refs.length) return [];
  return (await all<NamedTeam>(
    `SELECT t.number, t.name, t.city, t.state, t.country, cs.season last FROM teams t
     LEFT JOIN team_seasons cs ON cs.team = t.number AND cs.season = ?
     WHERE t.number IN (${refs.map(() => "?").join(",")}) AND ${teamPageSql("t.number", "t.name")} ORDER BY cs.season IS NOT NULL DESC, t.number`,
    [CURRENT_SEASON, ...refs],
  )).filter((t) => normalize(cleanTeamName(t.number, t.name) ?? "") === want);
}

/** Whether a team's home is in `region` (a country, or a state or province in it). */
export const inRegion = (t: Pick<NamedTeam, "state" | "country">, region: Region): boolean =>
  String(t.country ?? "").toLowerCase() === region.country.toLowerCase() && (!region.state || String(t.state ?? "").toLowerCase() === region.state.toLowerCase());

/** A team's search hit, as search lists a team. */
export const namedTeamHit = (t: NamedTeam): SearchHit =>
  ({ kind: "team", ref: String(t.number), title: searchTeamTitle(t.number, t.name), subtitle: place(t.city, t.state, t.country), season: t.last == null ? null : Number(t.last) });
