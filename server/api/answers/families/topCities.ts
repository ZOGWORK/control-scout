// "Which city in Romania has the most FTC teams", "cities with the most teams in Texas", "top towns in NJ by teams": a
// place's home cities ranked by how many teams the team directory lists there, with how many of them played in the
// newest season. Each row opens that city's own team list ("teams in <city> <state>").
import type { StatAnswer } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { teamPageSql } from "../../../../src/shared/teamPages.js";
import { findRegions, nearRegion, type Region } from "../../../../src/shared/regions.js";
import { countryOf } from "../../../../src/shared/countries.js";
import { all, get } from "../../../db.js";

/** `country`: a whole country as said ("Romania"), matched to the directory's own label when answered. */
export interface TopCitiesQuestion { region: Region | null; country?: string; n: number }

const CITY = String.raw`(?:cit(?:y|ies)|towns?)`;
const MOST = String.raw`(?:the\s+)?most\s+(?:ftc\s+)?teams?`;
/** The asks, the place caught in either spot: "which city in X has the most teams", "which city has the most teams in X",
 *  "cities with the most teams in X", "top cities in X by teams", "cities in X with the most teams". */
const ASKS = [
  new RegExp(String.raw`^(?:which|what)\s+${CITY}(?:\s+(?:in|of)\s+(.+?))?\s+(?:has|have|had)\s+${MOST}(?:\s+in\s+(.+))?$`, "i"),
  new RegExp(String.raw`^(?:the\s+)?(?:top\s+(?:(\d{1,2})\s+)?|biggest\s+)?${CITY}\s+with\s+${MOST}(?:\s+in\s+(.+))?$`, "i"),
  new RegExp(String.raw`^(?:the\s+)?(?:top\s+(?:(\d{1,2})\s+)?|biggest\s+)?${CITY}\s+in\s+(.+?)\s+(?:with\s+${MOST}|by\s+(?:number\s+of\s+)?teams?)$`, "i"),
];
const WORLD = /^(?:the\s+)?(?:world|ftc)$/i;

/** The question `raw` asks, or null: the place has to be a region, or none ("in the world"). */
export function readTopCities(raw: string): TopCitiesQuestion | null {
  const q = raw.replace(/[?!.,]/g, " ").replace(/\s+/g, " ").replace(/\b(?:worldwide|globally|in\s+the\s+world)\b/gi, " ").replace(/\s+/g, " ").trim();
  for (const [i, re] of ASKS.entries()) {
    const m = re.exec(q);
    if (!m) continue;
    const said = i === 0 ? null : m[1];
    const place = (i === 0 ? m[1] ?? m[2] : m[2])?.trim().replace(/^the\s+/i, "") || null;
    const n = Math.min(25, Math.max(1, said ? Number(said) : 10));
    if (!place || WORLD.test(place)) return { region: null, n };
    // A state or province named whole ("Georgia", "CA") is that one; else a whole country ("Romania", "UK"); else the
    // one region a start of a name or a near spelling finds, as leaderboards read a place.
    const rs = findRegions(place);
    const whole = rs.filter((x) => x.name.toLowerCase() === place.toLowerCase() || x.state.toLowerCase() === place.toLowerCase());
    if (whole.length === 1) return { region: whole[0], n };
    if (countryOf(place)) return { region: null, country: place, n };
    const region = rs.length === 1 ? rs[0] : rs.length ? null : nearRegion(place);
    return region ? { region, n } : null;
  }
  return null;
}

/** A city's own team list: its name with the state in North America (as a code), else its country. */
const cityHref = (x: { city: string; state: string | null; country: string | null }) =>
  `/search?q=${encodeURIComponent(`teams in ${x.city} ${(x.country === "USA" || x.country === "Canada") && x.state ? x.state : x.country ?? ""}`.trim())}`;

/** The country as the team directory labels it ("USA", "Romania"), from any of its names; null when no team lists it. */
export async function storedCountry(said: string): Promise<Region | null> {
  const want = countryOf(said)?.code;
  const labels = await all<{ country: string }>("SELECT DISTINCT country FROM teams WHERE country IS NOT NULL AND country <> ''");
  const hit = labels.find((l) => countryOf(l.country)?.code === want);
  return hit ? { key: `${hit.country}:`, country: hit.country, state: "", name: countryOf(hit.country)?.name ?? hit.country } : null;
}

/** The answer, or null when the country said has no teams in the directory (left to search). */
export async function topCitiesAnswer(c: TopCitiesQuestion): Promise<StatAnswer | null> {
  const r = c.country ? await storedCountry(c.country) : c.region;
  if (c.country && !r) return null;
  const inSql = r ? ` AND t.country = ?${r.state ? " AND t.state = ?" : ""}` : "";
  const args = r ? [r.country, ...(r.state ? [r.state] : [])] : [];
  // The place's newest season with matches played (a region whose season hasn't started reads its last one).
  const newest = (await get<{ s: number | null }>(`SELECT MAX(x.season) s FROM team_season_stats x JOIN teams t ON t.number = x.team WHERE x.matches > 0${inSql}`, args))?.s ?? null;
  const rows = await all<{ city: string; state: string | null; country: string | null; teams: number; played: number }>(
    `SELECT COALESCE(MAX(CASE WHEN t.city <> upper(t.city) THEN t.city END), MIN(t.city)) city, t.state, t.country, COUNT(*) teams,
            SUM(CASE WHEN EXISTS (SELECT 1 FROM team_season_stats x WHERE x.team = t.number AND x.season = ? AND x.matches > 0) THEN 1 ELSE 0 END) played
     FROM teams t WHERE t.city IS NOT NULL AND trim(t.city) <> ''${inSql} AND ${teamPageSql("t.number", "t.name")}
     GROUP BY lower(trim(t.city)), t.state, t.country ORDER BY played DESC, teams DESC, city LIMIT ?`, [newest ?? -1, ...args, c.n]);
  const where = r ? ` in ${r.name}` : " worldwide";
  // A city's name is said with its state, or its country when the place is wider than one country.
  const na = (x: { country: string | null }) => x.country === "USA" || x.country === "Canada";
  const placeOf = (x: { city: string; state: string | null; country: string | null }) =>
    [x.city, r?.state ? null : na(x) ? x.state : r ? null : x.country].filter(Boolean).join(", ");
  const base = {
    family: "leaderboard" as const, intent: "top-cities", title: `Cities with the most teams${where}`, scope: [r?.name ?? "Worldwide"],
    definition: `A city's teams are the teams whose home city it is, as FIRST lists it in the team directory.${newest != null ? ` Cities are ranked by how many of them played in ${seasonLabel(newest)}, the newest season with matches here; "Listed" counts every team the directory has there, played lately or not.` : ""}`,
    source: `From the team directory${where}`,
  };
  if (!rows.length) return { ...base, blocks: [], none: `No teams${where} list a home city yet.` };
  const top = rows[0];
  return {
    ...base,
    headline: newest != null
      ? { value: placeOf(top), label: `${top.played} team${Number(top.played) === 1 ? "" : "s"} played in ${seasonLabel(newest)}`, sub: `${top.teams} listed in all`, href: cityHref(top) }
      : { value: placeOf(top), label: `${top.teams} teams listed`, href: cityHref(top) },
    blocks: [{
      kind: "table", title: newest != null ? `By teams that played in ${seasonLabel(newest)}` : "By teams listed",
      columns: [{ key: "city", label: "City" }, ...(newest != null ? [{ key: "played", label: "Played", num: true }] : []), { key: "teams", label: "Listed", num: true }],
      rows: rows.map((x, i) => ({ cells: { city: placeOf(x), teams: Number(x.teams), played: Number(x.played) }, href: cityHref(x), strong: i === 0 })),
    }],
  };
}
