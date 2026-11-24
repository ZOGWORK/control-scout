// Two places in one question (search audit, "two places"): "nj vs texas average opr" sets the places side by side,
// each one's teams' average in the same season; "teams from nj or ny" is one board over both. Nothing here names a
// place: the parse reads the two (./parse.ts, `places`) and the stat said.
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import type { Region } from "../../../src/shared/regions.js";
import type { Place } from "../../../src/shared/query/names.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { teamPageSql } from "../../../src/shared/teamPages.js";
import { all } from "../../db.js";
import { BOARD_STATS, type BoardStat } from "../answers/families/leaderboard.js";
import { relativeSeason } from "../answers/season.js";
import type { Parsed } from "./parse.js";

/** A place's teams need this many with the stat for the season to be the one both are set side by side in. */
export const MIN_TEAMS = 3;

/** A place read as a region (a whole country: no state). */
export const placeRegion = (pl: Place): Region => ({ key: `${pl.country}:${pl.state ?? ""}`, country: pl.country, state: pl.state ?? "", name: pl.name });
const placeSql = (r: Region) => `(t.country = ?${r.state ? " AND t.state = ?" : ""})`;
const placeArgs = (r: Region) => [r.country, ...(r.state ? [r.state] : [])];

/** Whether the parse holds only two places, a stat or "teams", and a season: nothing this answer would drop. */
function onlyPlaces(p: Parsed): boolean {
  return !p.teams.length && !p.rookie && !p.named && p.over == null && !p.notMetrics?.length && !p.notStats?.length && !p.event && !p.eventKind && !p.worlds && !p.states && !p.award && !p.alliance && p.matchNumber == null && !p.level
    && !p.finals && !p.leftover.length && !p.scoreCond && !p.withVideo && !p.undefeated && !p.nameHas && !p.conference && (!p.time || p.time.kind === "season");
}

/** What a question of two places asks: "side" (each place's average, side by side) or "board" (both places' teams on
 *  one board), or null when it asks something else of them. `stat`: the board stat said, if any. */
export function placesAsk(p: Parsed, stat: string | null): "side" | "board" | null {
  if (!p.places || !onlyPlaces(p)) return null;
  // Side by side: "vs" said, or an average asked of either place.
  if (p.places.join === "vs" || p.symbols.includes("agg:mean") || p.symbols.includes("compare")) {
    // Each place's top team ("the top <place> team vs the top <place> team") is two teams set side by side, the
    // top-teams reader's: never the places' averages.
    if (p.agg === "max" || p.agg === "min") return null;
    const st = BOARD_STATS[stat ?? "opr"];
    return st && !st.count ? "side" : null;
  }
  // Both places' teams on one board, the leaderboard's (./execute.ts, `also`): "teams" or a stat said ("teams from nj
  // or ny", "best auto in nj or ny"). A count of them, or anything else, is another reader's.
  return (!p.intent || p.intent === "leaderboard") && (p.symbols.includes("thing:team") || stat || p.agg) ? "board" : null;
}

/** Two places' averages side by side, or null when the question asks something else of them (the board over both is
 *  the leaderboard's, ./execute.ts). */
export async function placesAnswer(p: Parsed, stat: string | null, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  if (placesAsk(p, stat) !== "side" || !p.places) return null;
  // A season said, or "this season" / "last season" as the season it names.
  const season = p.time?.kind === "season" ? relativeSeason(p.time.relative, p.time.season) : null;
  return sideBySide(p.q, p.places.list.map(placeRegion), BOARD_STATS[stat ?? "opr"], season, opts, p.places.said === "versus" ? "versus" : "vs");
}

const fmt = (st: BoardStat, v: number) => (st.unit === "%" ? `${Math.round(v * 100)}%` : v.toFixed(st.digits));

/** Each place's teams' average of the stat in one season (the one said, else the latest both have), never across seasons. */
async function sideBySide(q: string, places: Region[], st: BoardStat, said: number | null, opts: { full: boolean; pages: SearchPageLink[] }, vs: "vs" | "versus"): Promise<SearchAnswer> {
  const names = places.map((r) => r.name);
  // A stat that is itself an average ("Average score") is said once: "average score", never "average Average score".
  const what = /^average /i.test(st.label) ? st.label.slice(8) : st.label;
  const label = `${names.join(` ${vs} `)}: average ${what}`;
  const read: SearchAnswer = {
    q, hits: [], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label, ...(said != null ? { season: said } : {}) },
    intent: { kind: "stat-places-compare", pattern: "[place] vs [place] [stat]", met: true, understood: [label] },
  };
  if (!opts.full) return { ...read, pages: [{ title: label, href: `/search?q=${encodeURIComponent(q)}` }, ...opts.pages] };
  const join = st.join ? ` ${st.join}` : "";
  const has = `s.matches > 0 AND ${st.sql} IS NOT NULL AND ${teamPageSql("s.team", "t.name")}`;
  const which = places.map((r, i) => `WHEN ${placeSql(r)} THEN ${i}`).join(" ");
  const whichArgs = places.flatMap(placeArgs);
  const anyPlace = `(${places.map(placeSql).join(" OR ")})`;
  // The season: the one said, else the latest where each place has enough teams with the stat.
  const seasonRow = said != null ? [{ season: said }] : await all<{ season: number }>(
    `SELECT s.season FROM team_season_stats s JOIN teams t ON t.number = s.team${join}
     WHERE ${has} AND ${anyPlace}
     GROUP BY s.season HAVING ${places.map(() => `SUM(CASE WHEN CASE ${which} END = ? THEN 1 ELSE 0 END) >= ?`).join(" AND ")}
     ORDER BY s.season DESC LIMIT 1`,
    [...places.flatMap(placeArgs), ...places.flatMap((_, i) => [...whichArgs, i, MIN_TEAMS])]);
  const season = seasonRow[0]?.season ?? null;
  const base = {
    family: "leaderboard" as const, intent: "places-compare", title: `${names.join(` ${vs} `)} · average ${what}${season != null ? `, ${seasonLabel(season)}` : ""}`,
    scope: [...names, ...(season != null ? [seasonLabel(season)] : [])],
    definition: `A place's average is the mean ${what} of its teams that played in the season, by the team's home region or country in FIRST's team directory. Both places are read in the same season: a stat is never compared across seasons.`,
    source: "From the team directory and each team's season stats",
  };
  if (season == null) return { ...read, stat: { ...base, blocks: [], none: `${names.join(" and ")} don't both have ${MIN_TEAMS} or more teams with a ${st.label} in any season yet.` } };
  const rows = await all<{ at: number; teams: number; avg: number; best: number | null; bestV: number | null }>(
    `WITH x AS (SELECT CASE ${which} END at, s.team, t.name, ${st.sql} v FROM team_season_stats s JOIN teams t ON t.number = s.team${join} WHERE s.season = ? AND ${has} AND ${anyPlace})
     SELECT at, COUNT(*) teams, AVG(v) avg,
       (SELECT y.team FROM x y WHERE y.at = x.at ORDER BY y.v ${st.fewerBetter ? "ASC" : "DESC"}, y.team LIMIT 1) best,
       (SELECT y.v FROM x y WHERE y.at = x.at ORDER BY y.v ${st.fewerBetter ? "ASC" : "DESC"}, y.team LIMIT 1) bestV
     FROM x WHERE at IS NOT NULL GROUP BY at ORDER BY at`,
    [...whichArgs, season, ...places.flatMap(placeArgs)]);
  const of = places.map((_, i) => rows.find((r) => Number(r.at) === i) ?? null);
  // A place with no teams in the season said: nothing to set beside the other place, never "level".
  const missing = names.filter((_, i) => !of[i]);
  if (missing.length) return { ...read, understood: { ...read.understood!, season }, stat: { ...base, blocks: [], none: `${missing.join(" and ")} had no teams with ${st.label} in ${seasonLabel(season)}.` } };
  const vals = of.map((r) => (r ? Number(r.avg) : null));
  const known = vals.filter((v): v is number => v != null);
  const top = known.length ? (st.fewerBetter ? Math.min(...known) : Math.max(...known)) : null;
  // A leader only when the two differ: level places accent neither.
  const lead = known.length === 2 && vals[0] !== vals[1] ? vals.findIndex((v) => v === top) : -1;
  const stat: StatAnswer = {
    ...base,
    headline: lead >= 0
      ? { value: names[lead], label: `${st.fewerBetter ? "Lower" : "Higher"} average ${what}: ${fmt(st, vals[lead]!)} to ${fmt(st, vals[1 - lead]!)}`, sub: seasonLabel(season) }
      : { value: "Level", label: `Average ${what} ${known.length ? fmt(st, known[0]) : "—"} in both`, sub: seasonLabel(season) },
    blocks: [
      { kind: "kpis", items: places.map((r, i) => ({ label: r.name, value: vals[i] != null ? fmt(st, vals[i]!) : "—", sub: `Average of ${of[i]?.teams ?? 0} teams`, ...(i === lead ? { tone: "accent" as const } : {}) })) },
      {
        kind: "table", title: `Average ${what}, ${seasonLabel(season)}`,
        columns: [{ key: "place", label: "Place" }, { key: "avg", label: `Avg ${what}`, num: true }, { key: "teams", label: "Teams", num: true }, { key: "best", label: `Best, ${st.label}` }],
        rows: places.map((r, i) => ({
          cells: { place: r.name, avg: vals[i] != null ? fmt(st, vals[i]!) : null, teams: of[i]?.teams ?? 0, best: of[i]?.best != null ? `${of[i]!.best} · ${fmt(st, Number(of[i]!.bestV))}` : null },
          strong: i === lead,
        })),
      },
    ],
  };
  return { ...read, understood: { ...read.understood!, season }, stat };
}
