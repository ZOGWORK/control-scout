// "Which state has the highest average OPR": US states and Canadian provinces ranked by the average OPR of their teams
// that played in the newest season with matches. A place needs enough teams for its average to say something.
import type { StatAnswer } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { regionLabel } from "../../../../src/shared/regions.js";
import { teamPageSql } from "../../../../src/shared/teamPages.js";
import { all, get } from "../../../db.js";

/** `country`: the one country said ("in the US", "in Canada"); none for both. */
export interface PlaceAverageQuestion { order: "desc" | "asc"; n: number; country?: "USA" | "Canada" }

/** Fewer teams than this and a place's average is left out: one strong team isn't a state's teams. */
export const MIN_TEAMS = 10;

const PLACE = String.raw`(?:states?|provinces?|regions?)`;
const HIGH = String.raw`(?:highest|best|top|strongest|biggest)`;
const LOW = String.raw`(?:lowest|worst|weakest|smallest)`;
const AVG = String.raw`(?:average|avg|mean)\s+(?:team\s+)?opr`;
/** "which state has the highest average OPR", "states by average opr", "state with the lowest average opr". */
const ASKS = [
  new RegExp(String.raw`^(?:which|what)\s+${PLACE}\s+(?:has|have|had)\s+(?:the\s+)?(${HIGH}|${LOW})\s+${AVG}$`, "i"),
  new RegExp(String.raw`^(?:the\s+)?${PLACE}\s+with\s+(?:the\s+)?(${HIGH}|${LOW})\s+${AVG}$`, "i"),
  new RegExp(String.raw`^(?:top\s+(?:(\d{1,2})\s+)?)?${PLACE}\s+by\s+${AVG}$`, "i"),
];

/** The question `raw` asks, or null. */
export function readPlaceAverage(raw: string): PlaceAverageQuestion | null {
  let q = raw.replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
  // The country said, anywhere: kept and applied; the world adds nothing.
  const us = /\b(?:in|of)\s+(?:the\s+)?(?:us|usa|u\s?s\s?a?|united\s+states)\b/i, ca = /\b(?:in|of)\s+canada\b/i;
  const country = us.test(q) ? "USA" as const : ca.test(q) ? "Canada" as const : undefined;
  q = q.replace(us, " ").replace(ca, " ").replace(/\b(?:in\s+the\s+world|worldwide|ftc)\b/gi, " ").replace(/\s+/g, " ").trim();
  const said = country ? { country } : {};
  for (const [i, re] of ASKS.entries()) {
    const m = re.exec(q);
    if (!m) continue;
    if (i === 2) return { order: "desc", n: Math.min(25, Math.max(1, m[1] ? Number(m[1]) : 15)), ...said };
    return { order: new RegExp(`^${LOW}$`, "i").test(m[1]) ? "asc" : "desc", n: 15, ...said };
  }
  return null;
}

/** The answer: states and provinces by their teams' average OPR in the newest season with matches. */
export async function placeAverageAnswer(c: PlaceAverageQuestion): Promise<StatAnswer> {
  const season = (await get<{ s: number | null }>("SELECT MAX(season) s FROM team_season_stats WHERE matches > 0 AND opr_np IS NOT NULL"))?.s ?? null;
  const base = {
    family: "leaderboard" as const, intent: "place-average-opr",
    title: `${c.country === "USA" ? "US states" : c.country === "Canada" ? "Canadian provinces" : "States and provinces"} by average OPR${c.order === "asc" ? ", lowest first" : ""}`, scope: [c.country === "USA" ? "United States" : c.country ?? "US and Canada"],
    definition: `A place's average is the mean OPR (no penalties) of its teams that played in ${season != null ? seasonLabel(season) : "the newest season"}, by the team's home US state or Canadian province in FIRST's team directory. Places with fewer than ${MIN_TEAMS} such teams are left out.`,
    source: "From the team directory and each team's season OPR",
  };
  if (season == null) return { ...base, blocks: [], none: "No season has OPRs yet." };
  const rows = await all<{ country: string; state: string; teams: number; avg: number }>(
    `SELECT t.country, t.state, COUNT(*) teams, AVG(x.opr_np) avg
     FROM team_season_stats x JOIN teams t ON t.number = x.team
     WHERE x.season = ? AND x.matches > 0 AND x.opr_np IS NOT NULL AND t.state IS NOT NULL AND trim(t.state) <> '' AND t.country IN (${c.country ? "?" : "'USA', 'Canada'"})
       AND ${teamPageSql("t.number", "t.name")}
     GROUP BY t.country, t.state HAVING COUNT(*) >= ? ORDER BY avg ${c.order === "asc" ? "ASC" : "DESC"}, teams DESC LIMIT ?`,
    [season, ...(c.country ? [c.country] : []), MIN_TEAMS, c.n]);
  const nameOf = (x: { country: string; state: string }) => {
    const name = regionLabel(`${x.country}:${x.state}`);
    return x.country === "USA" ? name : `${name}, ${x.country}`;
  };
  const one = (v: number) => Number(v).toFixed(1);
  if (!rows.length) return { ...base, scope: [...base.scope, seasonLabel(season)], blocks: [], none: `No state or province had ${MIN_TEAMS} or more teams with an OPR in ${seasonLabel(season)}.` };
  const top = rows[0];
  return {
    ...base, scope: [...base.scope, seasonLabel(season)],
    headline: { value: nameOf(top), label: `Average OPR ${one(top.avg)}`, sub: `${top.teams} teams in ${seasonLabel(season)}` },
    blocks: [{
      kind: "table", title: `By average OPR, ${seasonLabel(season)}`,
      columns: [{ key: "place", label: "State or province" }, { key: "avg", label: "Avg OPR", num: true }, { key: "teams", label: "Teams", num: true }],
      rows: rows.map((x, i) => ({ cells: { place: nameOf(x), avg: one(x.avg), teams: Number(x.teams) }, strong: i === 0 })),
    }],
  };
}
