// Family 7, leaderboards (the brief's "ranked list, stat plus place filter, precomputed"): teams ranked by one stored
// season number (team_season_stats, the numbers every team page shows: never worked out here), in one state or
// province or worldwide, capped at 25 rows. An OPR list ends with a link to the same list on the Teams page (its
// season table, filtered and sorted the same way; its OPRs are these), a rating list with one to Rankings.
// The rules every answer below states:
//   A team is ranked once it has played 3 matches that season (as Rankings), and only teams with a team page.
//   Win rate: wins over matches played (ties count as played). Record: the same order, said as wins-losses-ties.
//   Reliability: the team page's reliability index (team_reliability, out of 100).
//   Rookie: the team's rookie year is that season.
//   Most improved: the biggest climb in worldwide OPR standing (OPR rank as a share of the ranked teams) from the
//     season before; OPR in points can't be compared across seasons, since every season is a different game.
//   A city: teams whose home city is that name, newest season played first; its best team, the city's top OPR.
//   With no season named, the season is the latest completed one (../season.ts), said on the card.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { RANKED_MIN_MATCHES } from "../../../../src/shared/rankings.js";
import { teamPageSql } from "../../../../src/shared/teamPages.js";
import { recordSql } from "../../../../src/shared/eventRecord.js";
import { countryOf } from "../../../../src/shared/countries.js";
import type { Region } from "../../../../src/shared/regions.js";
import { all, get } from "../../../db.js";
import { searchSeason, searchSeasonWhy } from "../season.js";
import { reportedTeleopIncludesEndgame } from "../../../data/seasons.js";
import { eventHref, teamHref } from "../matchSet.js";
import { seasonOfDate } from "../../query/time.js";
import { searchToday } from "../../searchEvents.js";
import { OFFICIAL_TYPES } from "../clauses.js";

export const LEADERBOARD_MAX = 25;

/** A stat a leaderboard ranks by: its stored column (or expression), its words, and the Teams page's sort key: only
 *  where that table shows the same number (its OPRs; its wins and averages count qualification matches only). */
export interface BoardStat { id: string; label: string; sql: string; unit: string; teamsSort: string | null; digits: number; join?: string;
  /** A count (matches, events, awards): its leader is the team "with the most", not the "best". */
  count?: boolean;
  /** Fewer is better (penalties): the top of the list is the most, never "the best". */
  fewerBetter?: true;
  /** What breaks a tie before wins: penalties' estimate is 0 for many teams, so the points their alliances gave away. */
  tie?: string }
export const BOARD_STATS: Record<string, BoardStat> = {
  opr: { id: "opr", label: "OPR", sql: "s.opr_np", unit: "", teamsSort: "totalPointsNpOpr", digits: 1 },
  auto: { id: "auto", label: "Auto OPR", sql: "s.opr_auto", unit: "", teamsSort: "autoPointsOpr", digits: 1 },
  teleop: { id: "teleop", label: "TeleOp OPR", sql: "s.opr_teleop", unit: "", teamsSort: "dcPointsOpr", digits: 1 },
  endgame: { id: "endgame", label: "Endgame OPR", sql: "s.opr_endgame", unit: "", teamsSort: "endgamePointsOpr", digits: 1 },
  "win-rate": { id: "win-rate", label: "Win rate", sql: "(1.0 * s.wins / NULLIF(s.wins + s.losses + s.ties, 0))", unit: "%", teamsSort: null, digits: 0 },
  wins: { id: "wins", label: "Wins", sql: "s.wins", unit: "", teamsSort: null, digits: 0 },
  "avg-score": { id: "avg-score", label: "Average score", sql: "s.avg_np", unit: "", teamsSort: null, digits: 1 },
  rating: { id: "rating", label: "Prediction rating", sql: "s.rating_np", unit: "", teamsSort: null, digits: 1 },
  record: { id: "record", label: "Record", sql: "(1.0 * s.wins / NULLIF(s.wins + s.losses + s.ties, 0))", unit: "%", teamsSort: null, digits: 0 },
  // The rating's share for penalty points given away a match, as the team page says it: fewest is best.
  penalties: { id: "penalties", label: "Penalties a match", sql: "s.rating_pen", unit: "", teamsSort: null, digits: 1, fewerBetter: true, tie: "s.avg_pen" },
  // Counts of a season: matches and events played, awards won (each award an event gave the team, as the team page lists).
  matches: { count: true, id: "matches", label: "Matches played", sql: "s.matches", unit: "", teamsSort: null, digits: 0 },
  events: { count: true, id: "events", label: "Events played", sql: "s.events", unit: "", teamsSort: null, digits: 0 },
  awards: { count: true, id: "awards", label: "Awards won", sql: "(SELECT COUNT(*) FROM awards a WHERE a.season = s.season AND a.team = s.team)", unit: "", teamsSort: null, digits: 0 },
  // Every season's count (career boards, careerAnswer): seasons with a match on record.
  seasons: { count: true, id: "seasons", label: "Seasons played", sql: "s.matches", unit: "", teamsSort: null, digits: 0 },
  reliability: { id: "reliability", label: "Reliability", sql: "r.idx", unit: "", teamsSort: null, digits: 0, join: "JOIN team_reliability r ON r.season = s.season AND r.code = '' AND r.team = s.team" },
};

const PHASE_LABEL: Record<string, string> = { auto: "Auto", teleop: "TeleOp", endgame: "Endgame" };

/** A board stat by its id, or two or three phases' OPRs added ("auto+endgame", read from "best auto and endgame"):
 *  OPR is a sum of each team's points, so its parts add. A season whose TeleOp is reported with the endgame in it
 *  counts the endgame once, inside TeleOp. Undefined for an id that is neither. */
export function boardStatFor(id: string, season: number): BoardStat | undefined {
  if (BOARD_STATS[id]) return BOARD_STATS[id];
  let parts = id.split("+");
  if (parts.length < 2 || parts.some((x) => !PHASE_LABEL[x])) return undefined;
  if (reportedTeleopIncludesEndgame(season) && parts.includes("teleop")) parts = parts.filter((x) => x !== "endgame");
  if (parts.length === 1) return BOARD_STATS[parts[0]];
  return { id: parts.join("+"), label: `${parts.map((x) => PHASE_LABEL[x]).join(" + ")} OPR`, sql: `(${parts.map((x) => BOARD_STATS[x].sql).join(" + ")})`, unit: "", teamsSort: null, digits: 1 };
}

export type BoardKind = "top" | "rookie" | "improved" | "gain" | "steady" | "phases" | "city" | "city-best" | "career" | "oldest";
/** `best`: "best team in New Jersey by OPR", one team asked for: titled so, the next few listed under it. */
export interface BoardQuestion { kind: BoardKind; stat: BoardStat; n: number; region: Region | null; city: string | null; season: number | null; seasonWhy?: string; best?: boolean;
  /** `city` is a school's name: its teams. */
  school?: boolean;
  /** The state or country said with the town: its teams from there only. */
  cityIn?: Region;
  /** The bottom of the list, lowest first ("sorted lowest to highest", "worst teleop OPR in Romania"). */
  asc?: boolean;
  /** Teams with no losses that season only ("undefeated teams", "a perfect record"). */
  undefeated?: boolean;
  /** A town within the region ("best team in Cluj-Napoca, Romania, by OPR"): the teams from it. */
  town?: string | null;
  /** The teams named: those only, ranked among themselves. */
  teams?: number[];
  /** Only the teams from this worldwide OPR rank or below the season before to this rank or better. */
  climb?: { from: number; to: number };
  /** A date window ("this week"): a count of matches played, wins or events in it, from the match rows. */
  window?: { from: string; to: string; label: string };
  /** One event's teams, its divisions' too ("east bergen conference best teams", "top teams at nj states"). */
  /** `home`: the teams from that place only ("nj teams at worlds"). */
  event?: { season: number; code: string; codes: string[]; name: string; home?: Region | null; rookies?: boolean } }

/** A stat's name inside a sentence ("by win rate", "by OPR"). */
export const statWords = (st: BoardStat) => (/OPR/.test(st.label) ? st.label : st.label.toLowerCase());
const fmt = (v: number | null, st: BoardStat) => (v == null ? "–" : st.unit === "%" ? `${Math.round(v * 100)}%` : st.digits ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)));

/** The Teams page's season table, filtered and sorted as this list (src/lib/records/urlState.ts reads these). */
export function teamsHref(season: number, st: BoardStat, region: Region | null, rookie = false, lowest = false): string | null {
  if (!st.teamsSort) return null;
  const p = new URLSearchParams({ view: "season", season: String(season) });
  const iso = region ? countryOf(region.country)?.code : null;
  if (region && iso) { p.set("country", iso); p.set("state", region.state); }
  p.set("sort", st.teamsSort);
  if (lowest) p.set("dir", "asc");
  p.set("filter", `and-qualMatchesPlayed.gte.${RANKED_MIN_MATCHES}${rookie ? ` rookieYear.eq.${season}` : ""}-`);
  return `/teams?${p}`;
}
// A whole country's key ends in ":" ("Romania:"); Rankings reads a country alone without it.
const rankingsHref = (season: number, region: Region | null) => `/rankings?season=${season}${region ? `&region=${encodeURIComponent(region.key.replace(/:$/, ""))}` : ""}`;

const RANKED = `A team is ranked once it has played ${RANKED_MIN_MATCHES} matches that season, as on Rankings, from the season numbers each team page shows (OPR and averages without penalties).`;
const record = (r: { wins: number; losses: number; ties: number }) => `${r.wins}-${r.losses}-${r.ties}`;

export async function leaderboardAnswer(b: BoardQuestion): Promise<StatAnswer> {
  if (b.kind === "city") return cityAnswer(b.city!, !!b.school, b.cityIn ?? null);
  if (b.event) return eventBoardAnswer(b, b.event);
  const season = b.season ?? searchSeason();
  const why = b.season == null ? ` ${searchSeasonWhy(season)}` : b.seasonWhy ? ` ${b.seasonWhy}` : "";
  if (b.kind === "city-best") return b.season == null ? cityBestNow(b) : cityBestAnswer(b, season, why);
  // A region, or a whole country (no state); a town in it narrows to the teams from there.
  const where = b.teams ? " named" : b.town ? ` in ${b.town}` : b.region ? ` in ${b.region.name}` : " worldwide";
  const regionSql = `${b.region ? ` AND t.country = ?${b.region.state ? " AND t.state = ?" : ""}` : ""}${b.town ? " AND lower(t.city) = lower(?)" : ""}`;
  const regionArgs = [...(b.region ? [b.region.country, ...(b.region.state ? [b.region.state] : [])] : []), ...(b.town ? [b.town] : [])];
  const chips = b.teams ? [`${b.teams.length} teams named`, seasonLabel(season)] : [...(b.town ? [b.town] : []), b.region?.name ?? "Worldwide", seasonLabel(season)];
  if (b.kind === "improved") return improvedAnswer(b, season, where, regionSql, regionArgs, chips, why);
  if (b.kind === "career" || b.kind === "oldest") return careerAnswer(b, where, regionSql, regionArgs);
  if (b.kind === "steady") return steadyAnswer(b, season, where, regionSql, regionArgs, chips, why);
  if (b.kind === "phases") return phasesAnswer(b, season, where, regionSql, regionArgs, chips, why);
  if (b.kind === "gain") return gainAnswer(b, season, where, regionSql, regionArgs, chips, why);
  if (b.window) return windowCountAnswer(b, b.window, where, regionSql, regionArgs);
  const st = b.stat;
  const rookie = b.kind === "rookie";
  const ranked = `s.season = ? AND ${st.id === "rating" || st.id === "penalties" ? "s.rating_matches" : "s.matches"} >= ? AND ${st.sql} IS NOT NULL AND ${teamPageSql("s.team", "t.name")}${regionSql}${rookie ? " AND t.rookie_year = ?" : ""}${b.undefeated ? " AND s.losses = 0" : ""}${b.teams ? ` AND s.team IN (${b.teams.map(() => "?").join(", ")})` : ""}`;
  const from = `team_season_stats s JOIN teams t ON t.number = s.team${st.join ? ` ${st.join}` : ""}`;
  const args = [season, RANKED_MIN_MATCHES, ...regionArgs, ...(rookie ? [season] : []), ...(b.teams ?? [])];
  const [rows, count] = await Promise.all([
    all<{ team: number; name: string | null; city: string | null; state: string | null; country: string | null; v: number | null; opr: number | null; auto: number | null; teleop: number | null; endgame: number | null; pen: number | null; wins: number; losses: number; ties: number; matches: number }>(
      `SELECT s.team, t.name, t.city, t.state, t.country, ${st.sql} v, s.opr_np opr, s.opr_auto auto, s.opr_teleop teleop, s.opr_endgame endgame, s.opr_pen pen, s.wins, s.losses, s.ties, s.matches
       FROM ${from} WHERE ${ranked}
       ORDER BY v ${b.asc ? "ASC" : "DESC"}, ${st.tie ? `${st.tie} ${b.asc ? "ASC" : "DESC"}, ` : ""}${st.id === "rating" ? "" : `s.wins ${b.asc ? "ASC" : "DESC"}, `}s.team ${b.asc ? "DESC" : "ASC"} LIMIT ?`, [...args, b.n]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM ${from} WHERE ${ranked}`, args),
  ]);
  // The bottom of the ranked list, each place counted from the top; teams named are ranked among themselves (penalties
  // fewest first), from 1.
  const bottom = b.asc && !b.teams;
  const title = b.teams ? `${b.teams.length} teams${b.asc ? (st.fewerBetter ? ", fewest first," : ", lowest first,") : ""} by ${statWords(st)}` : b.undefeated ? `Undefeated teams${where} by ${statWords(st)}` : rookie ? `${b.asc ? "Lowest" : "Best"} rookie team${b.n > 1 ? "s" : ""}${where} by ${statWords(st)}` : b.asc && b.best && st.fewerBetter ? `Team${where} with the fewest ${statWords(st)}` : b.asc ? `Lowest ${b.n > 1 ? `${b.n} teams` : "team"} by ${statWords(st)}${where}`
    : b.best ? (st.fewerBetter || st.count ? `Team${where} with the most ${statWords(st)}` : `Best team${where} by ${statWords(st)}`) : `Top ${b.n} teams by ${statWords(st)}${where}`;
  // A link opens the same list or none: Rankings has no rookie filter and no lowest-first order, and neither page
  // takes a town or undefeated teams, so those get no link rather than one to a different list.
  const href = b.town || b.undefeated || b.teams ? null : st.teamsSort ? teamsHref(season, st, b.region, rookie, !!b.asc)
    : st.id === "rating" && !rookie && !b.asc ? rankingsHref(season, b.region) : null;
  const definition = `${b.undefeated ? "Undefeated: no losses in the season's matches (ties allowed). " : ""}${RANKED}${rookie ? ` A rookie team's rookie year is ${seasonLabel(season)}.` : ""}${st.id === "win-rate" ? " Win rate: wins over matches played, ties counted as played." : ""}${st.id === "record" ? " Record: wins-losses-ties, the best win rate first (wins over matches played, ties counted as played), then the most wins." : ""}${st.id === "penalties" ? " Penalties a match: penalty points the robot alone gives away a match, its prediction rating's estimate as the team page shows it; a tie goes to the points its alliances gave away a match; ranked once 3 matches are rated." : ""}${st.id === "awards" ? " Awards won: every award the team's events gave it that season, winning and finalist alliances included." : ""}${st.id === "matches" || st.id === "events" ? ` ${st.label}: at every event of the season, scrimmages included, as the team page counts them.` : ""}${st.id === "reliability" ? " Reliability: the team page's index out of 100, from no-shows, disqualifications, near-zero matches and how steady its scoring is." : ""}${st.id === "rating" ? " The prediction rating is the engine's points-per-match strength; ranked once 3 matches are rated, as on Rankings." : ""}${st.id.includes("+") ? ` ${st.label}: each phase's OPR added, as the team page shows them.` : ""}${bottom ? " Lowest first: the bottom of the ranked list, each team's place counted from the top." : ""}${why}`;
  const total = Number(count?.n ?? 0);
  // The teams named that aren't on the list (too few matches, or no number yet): said, never dropped silently.
  const unranked = b.teams?.filter((t) => !rows.some((r) => Number(r.team) === t)) ?? [];
  const base = { family: "leaderboard" as const, intent: rookie ? "best-rookie" : `top-${st.id}`, title: `${title} · ${seasonLabel(season)}`, scope: chips, definition, source: `From the ${seasonLabel(season)} season numbers of ${total.toLocaleString("en-US")} ranked ${rookie ? "rookie " : ""}team${total === 1 ? "" : "s"}${where}${unranked.length ? ` · Not ranked (under ${RANKED_MIN_MATCHES} matches or no ${statWords(st)}): ${unranked.join(", ")}` : ""}` };
  if (!rows.length) return { ...base, blocks: [], none: b.teams ? `None of the ${b.teams.length} teams named has a ${seasonLabel(season)} ${statWords(st)} yet: a team is ranked once it has played ${RANKED_MIN_MATCHES} matches.` : b.undefeated ? `No team${where} with ${RANKED_MIN_MATCHES}+ matches is undefeated in ${seasonLabel(season)}.` : `No ${rookie ? "rookie " : ""}team${where} has played ${RANKED_MIN_MATCHES}+ matches in ${seasonLabel(season)} yet.` };
  const top = rows[0];
  const num = (v: number | null) => (v == null ? null : Number(v));
  const shown = (r: (typeof rows)[number]) => (st.id === "record" ? record(r) : fmt(r.v, st));
  const board: StatBlock = {
    kind: "leaderboard", title: b.teams ? `${rows.length} ranked by ${st.label}` : rookie ? `Rookie teams by ${st.label}` : b.asc ? `Lowest ${rows.length} by ${st.label}` : `Top ${rows.length} by ${st.label}`, stat: { id: st.id, label: st.label, ...(st.unit ? { unit: st.unit } : {}) },
    ...(reportedTeleopIncludesEndgame(season) ? { teleopWithEndgame: true } : {}), ...(b.asc ? { lowest: true } : {}),
    note: `${seasonLabel(season)} · ${total.toLocaleString("en-US")} ranked ${rookie ? "rookie " : ""}team${total === 1 ? "" : "s"}${where} · by ${statWords(st)}`,
    rows: rows.map((r, i) => ({
      rank: bottom ? total - i : i + 1, team: { label: `${r.team} ${r.name ?? ""}`.trim(), href: teamHref(Number(r.team), season) },
      location: [r.city, r.state, r.country && r.country !== "USA" ? r.country : null].filter(Boolean).join(", ") || null,
      record: record(r), opr: num(r.opr), value: num(r.v), display: shown(r),
      parts: r.auto != null || r.teleop != null || r.endgame != null || r.pen != null ? { auto: num(r.auto), teleop: num(r.teleop), endgame: num(r.endgame), pen: num(r.pen) } : null,
    })),
    // The Teams table counts qualification matches only, so its list can differ by a team or two: said on the link.
    ...(href ? { more: { label: st.teamsSort ? "View more detail on the Teams page (qualification matches)" : "View more detail on Rankings", href } } : {}),
  };
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `${st.id === "record" ? `Record ${record(top)}` : `${st.label} ${fmt(top.v, st)}, ${record(top)}`}${top.city ? ` · ${top.city}` : ""}`, sub: bottom ? `Lowest of ${total.toLocaleString("en-US")} ranked${where}` : b.best ? `#1 of ${total.toLocaleString("en-US")} ranked${where}` : `#1 of ${rows.length} shown`, href: teamHref(Number(top.team), season) },
    blocks: [board],
  };
}

/** FTC's first season (2005–06): a rookie year listed before it is a directory slip, never a team's start. */
const FTC_FIRST_SEASON = 2005;
/** An every-season board's title, the same on its card and as the page's heading (search's boardSearch), so the page
 *  never says it twice in two wordings. */
export function careerBoardTitle(b: Pick<BoardQuestion, "kind" | "stat">, where: string): string {
  return b.kind === "oldest" ? `Oldest teams still active${where}, by rookie year` : `Team${where} with the most ${CAREER[b.stat.id]?.label.toLowerCase() ?? statWords(b.stat)}, every season`;
}

const CAREER: Record<string, { label: string; sql: string; rule: string }> = {
  matches: { label: "Matches played", sql: "SUM(s.matches)", rule: "Matches played: every season's matches on record, as each team page counts them." },
  events: { label: "Events played", sql: "SUM(s.events)", rule: "Events played: every season's events on record, as each team page counts them." },
  wins: { label: "Wins", sql: "SUM(s.wins)", rule: "Wins: every season's match wins on record." },
  // Match rows are stored for recent seasons only, so a team's seasons run from FIRST's rookie year to its latest season
  // with a match.
  seasons: { label: "Seasons played", sql: "MAX(CASE WHEN s.matches > 0 THEN s.season END) - t.rookie_year + 1", rule: "Seasons played: from the team's rookie year, as FIRST lists it, to its latest season with a match on record, both counted." },
};

/** Every season counted: the team with the most matches, events, wins or seasons on record; or the oldest
 *  teams still active (a match in the latest season played), the earliest rookie year first. */
async function careerAnswer(b: BoardQuestion, where: string, regionSql: string, regionArgs: string[]): Promise<StatAnswer> {
  const oldest = b.kind === "oldest";
  const c = CAREER[oldest ? "seasons" : b.stat.id];
  const span = await get<{ first: number | null; last: number | null }>("SELECT MIN(season) first, MAX(season) last FROM team_season_stats WHERE matches > 0");
  const title = careerBoardTitle(b, where);
  // No season with a match on record: no years to say, so none are made up.
  if (span?.first == null || span?.last == null) {
    return { family: "leaderboard", intent: oldest ? "oldest-active" : `career-${b.stat.id}`, title, scope: [b.region?.name ?? "Worldwide"], definition: oldest ? "Still active: a match on record in one of the two latest seasons played." : c.rule,
      source: `Every season on record${where}`, blocks: [], none: `No team${where} has a match on record yet.` };
  }
  const first = Number(span.first), last = Number(span.last);
  const rows = await all<{ team: number; name: string | null; city: string | null; state: string | null; country: string | null; rookie: number | null; v: number; wins: number; losses: number; ties: number; lastPlayed: number; opr: number | null }>(
    // From every team, its season rows when it has any: a team whose awards come from events with no match rows here
    // (remote ones) still counts its awards.
    `SELECT t.number team, t.name, t.city, t.state, t.country, t.rookie_year rookie, ${c.sql} v, COALESCE(SUM(s.wins), 0) wins, COALESCE(SUM(s.losses), 0) losses, COALESCE(SUM(s.ties), 0) ties,
            MAX(CASE WHEN s.matches > 0 THEN s.season END) lastPlayed,
            (SELECT x.opr_np FROM team_season_stats x WHERE x.team = t.number AND x.matches > 0 ORDER BY x.season DESC LIMIT 1) opr
     FROM teams t LEFT JOIN team_season_stats s ON s.team = t.number
     WHERE ${teamPageSql("t.number", "t.name")}${regionSql}${oldest || b.stat.id === "seasons" ? ` AND t.rookie_year >= ${FTC_FIRST_SEASON}` : ""}
     GROUP BY t.number${oldest ? " HAVING lastPlayed >= ?" : " HAVING v > 0"}
     ORDER BY ${oldest ? "t.rookie_year ASC, v DESC" : "v DESC, wins DESC"}, t.number LIMIT ?`, [...regionArgs, ...(oldest ? [last - 1] : []), b.n]);
  const S = `${seasonLabel(first)} to ${seasonLabel(last)}`;
  // Still active: a match in the latest season played or the one before (a new season's first weeks have few).
  const active = `${seasonLabel(last - 1)} or ${seasonLabel(last)}`;
  const base = {
    family: "leaderboard" as const, intent: oldest ? "oldest-active" : `career-${b.stat.id}`, title, scope: [b.region?.name ?? "Worldwide", oldest ? `Active in ${active}` : `Every season on record (${S})`],
    definition: (oldest ? `Still active: a match on record in ${active}, the two latest seasons played. Oldest: the earliest rookie year, as FIRST lists it; a tie goes to the most seasons on record.`
      : `${c.rule} Seasons on record here run ${S}.`) + " OPR: each team's in its latest season with a match.",
    source: oldest ? `Teams${where} with a match in ${active}` : `From every season on record${where} (${S})`,
  };
  if (!rows.length) return { ...base, blocks: [], none: `No team${where} has ${oldest ? `a match in ${active}` : `any ${c.label.toLowerCase()} on record`}.` };
  const top = rows[0];
  const shown = (r: (typeof rows)[number]) => (oldest ? String(r.rookie ?? "–") : String(Number(r.v)));
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: oldest ? `Rookie year ${top.rookie}, ${Number(top.v)} seasons played${top.city ? ` · ${top.city}` : ""}` : `${c.label} ${Number(top.v)}${b.stat.id === "seasons" && top.rookie ? `, rookie year ${top.rookie}` : `, ${record(top)}`}${top.city ? ` · ${top.city}` : ""}`,
      sub: oldest ? `Active in ${active}${where}` : `#1 of every team${where}, every season on record`, href: teamHref(Number(top.team), top.lastPlayed) },
    blocks: [{
      kind: "leaderboard", title: `Top ${rows.length} by ${oldest ? "rookie year" : c.label.toLowerCase()}`, stat: { id: oldest ? "rookie-year" : b.stat.id, label: oldest ? "Rookie year" : c.label },
      note: `${oldest ? `Active in ${active}` : `Every season on record, ${S}`}${where}`,
      // A team link opens the season its OPR is from: its latest with a match.
      rows: rows.map((r, i) => ({ rank: i + 1, team: { label: `${r.team} ${r.name ?? ""}`.trim(), href: teamHref(Number(r.team), r.lastPlayed) },
        location: [r.city, r.state, r.country && r.country !== "USA" ? r.country : null].filter(Boolean).join(", ") || null,
        // OPR: the team's latest season with a match, as its team page shows it.
        record: record(r), opr: r.opr == null ? null : Number(r.opr), value: oldest ? r.rookie : Number(r.v), display: shown(r), parts: null })),
    }],
  };
}

/** "Which team played the most matches this week": each team's played matches in the window (a match by its own date,
 *  else its event's first day), its wins or the events they were at, from the match rows; the most first. */
async function windowCountAnswer(b: BoardQuestion, w: { from: string; to: string; label: string }, where: string, regionSql: string, regionArgs: string[]): Promise<StatAnswer> {
  const a = await windowCount(b, w, where, regionSql, regionArgs);
  if (a.headline) return a;
  // None in the window yet: the latest seven days before it with a played match (in the place asked), said so.
  const last = await get<{ d: string | null }>(
    `SELECT MAX(substr(COALESCE(m.time, e.start), 1, 10)) d FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
     JOIN match_teams mt ON mt.season = m.season AND mt.code = m.code AND mt.level = m.level AND mt.series = m.series AND mt.number = m.number
     JOIN teams t ON t.number = mt.team
     WHERE e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")}) AND m.played = 1 AND mt.on_field = 1 AND ${teamPageSql("mt.team", "t.name")} AND substr(COALESCE(m.time, e.start), 1, 10) < ?${regionSql}`, [...OFFICIAL_TYPES, w.from, ...regionArgs]);
  if (!last?.d) return a;
  const end = new Date(`${last.d}T00:00:00Z`), start = new Date(end.getTime() - 6 * 864e5);
  const before = { from: start.toISOString().slice(0, 10), to: last.d, label: "in the latest week with matches" };
  const b2 = await windowCount(b, before, where, regionSql, regionArgs);
  if (!b2.headline) return a;
  const note = `No matches ${w.label} yet${where}; showing ${before.from} to ${before.to}`;
  return { ...b2, scope: [note, ...b2.scope], definition: `${b2.definition} ${note}: the latest seven days with a played match before ${w.label}.` };
}

async function windowCount(b: BoardQuestion, w: { from: string; to: string; label: string }, where: string, regionSql: string, regionArgs: string[]): Promise<StatAnswer> {
  const st = b.stat;
  const v = st.id === "wins" ? "SUM(won)" : st.id === "events" ? "COUNT(DISTINCT p.season || ':' || p.code)" : "COUNT(*)";
  // Each row's OPR beside the count: the team's stored OPR in the season of the window's last day.
  const season = seasonOfDate(w.to);
  // On the team's record, as eventRecord's onRecord says: a qualification surrogate isn't; every match counts played.
  const rec = "(m.level <> 'qual' OR mt.surrogate = 0)";
  const rows = await all<{ team: number; name: string | null; city: string | null; state: string | null; country: string | null; v: number; wins: number; losses: number; ties: number; opr: number | null }>(
    `WITH played AS (
       SELECT mt.team, m.season, m.code, CASE WHEN ${rec} THEN 1 ELSE 0 END rec,
              CASE WHEN ${rec} AND ((mt.alliance = 'red' AND m.red_total > m.blue_total) OR (mt.alliance = 'blue' AND m.blue_total > m.red_total)) THEN 1 ELSE 0 END won,
              CASE WHEN ${rec} AND ((mt.alliance = 'red' AND m.red_total < m.blue_total) OR (mt.alliance = 'blue' AND m.blue_total < m.red_total)) THEN 1 ELSE 0 END lost
       FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
       JOIN match_teams mt ON mt.season = m.season AND mt.code = m.code AND mt.level = m.level AND mt.series = m.series AND mt.number = m.number
       WHERE e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")}) AND m.played = 1 AND mt.on_field = 1 AND substr(COALESCE(m.time, e.start), 1, 10) BETWEEN ? AND ?)
     SELECT p.team, t.name, t.city, t.state, t.country, ${v} v, SUM(won) wins, SUM(lost) losses, SUM(rec) - SUM(won) - SUM(lost) ties, MAX(s.opr_np) opr
     FROM played p JOIN teams t ON t.number = p.team LEFT JOIN team_season_stats s ON s.season = ? AND s.team = p.team
     WHERE ${teamPageSql("p.team", "t.name")}${regionSql}
     GROUP BY p.team ORDER BY v DESC, wins DESC, p.team LIMIT ?`, [...OFFICIAL_TYPES, w.from, w.to, season, ...regionArgs, b.n]);
  const label = st.id === "wins" ? "Wins" : st.id === "events" ? "Events played" : "Matches played";
  const when = w.label;
  const title = b.best ? `Team${where} with the most ${label.toLowerCase()} ${when}` : `Top ${b.n} teams${where} by ${label.toLowerCase()} ${when}`;
  const base = {
    family: "leaderboard" as const, intent: `top-${st.id}-window`, title, scope: [b.region?.name ?? "Worldwide", when.replace(/^./, (c) => c.toUpperCase()), `${w.from} to ${w.to}`],
    definition: `${label} ${when} (${w.from} to ${w.to}): every played match at an official event in those days, a match by its own date, else its event's first day; a team counts once it was on the field. OPR: the team's stored ${seasonLabel(season)} OPR.${st.id === "wins" ? " A win: its alliance's official score, penalties included, above the other's." : ""}${st.id === "events" ? " Events played: the events of those matches." : ""}`,
    source: `From the matches played ${when}`,
  };
  if (!rows.length) return { ...base, blocks: [], none: `No matches on record${where} ${when} (${w.from} to ${w.to}).` };
  const top = rows[0];
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `${label} ${Number(top.v)}, ${record(top)}${top.city ? ` · ${top.city}` : ""}`, sub: `${when.replace(/^./, (c) => c.toUpperCase())}${where}`, href: teamHref(Number(top.team), season) },
    blocks: [{
      kind: "leaderboard", title: `Top ${rows.length} by ${label.toLowerCase()}`, stat: { id: st.id, label },
      note: `${when} · ${w.from} to ${w.to}${where}`,
      rows: rows.map((r, i) => ({ rank: i + 1, team: { label: `${r.team} ${r.name ?? ""}`.trim(), href: teamHref(Number(r.team), season) },
        location: [r.city, r.state, r.country && r.country !== "USA" ? r.country : null].filter(Boolean).join(", ") || null,
        record: record(r), opr: r.opr == null ? null : Number(r.opr), value: Number(r.v), display: String(Number(r.v)), parts: null })),
    }],
  };
}

/** The teams at one event (its divisions too), best first. Once its matches are played: by each team's OPR there
 *  (its best division's), with its record there. Before: by the season OPR each team brings, else the season before's
 *  when none has one yet; said on the card which. */
async function eventBoardAnswer(b: BoardQuestion, ev: NonNullable<BoardQuestion["event"]>): Promise<StatAnswer> {
  const home = ev.home ?? null;
  const inList = ev.codes.map(() => "?").join(", ");
  const everyone = await all<{ team: number; name: string | null; city: string | null; state: string | null; country: string | null; rookie_year: number | null; eo: number | null;
    so: number | null; sw: number | null; sl: number | null; st: number | null; po: number | null }>(
    `SELECT et.team, t.name, t.city, t.state, t.country, t.rookie_year, MAX(x.opr_np) eo,
            MAX(s.opr_np) so, MAX(s.wins) sw, MAX(s.losses) sl, MAX(s.ties) st, MAX(p.opr_np) po
     FROM events e JOIN event_teams et ON et.season = e.season AND et.code = e.code JOIN teams t ON t.number = et.team
     LEFT JOIN team_event_stats x ON x.season = et.season AND x.code = et.code AND x.team = et.team
     LEFT JOIN team_season_stats s ON s.season = e.season AND s.team = et.team
     LEFT JOIN team_season_stats p ON p.season = e.season - 1 AND p.team = et.team
     WHERE e.season = ? AND (e.code IN (${inList}) OR e.division_code IN (${inList})) AND ${teamPageSql("et.team", "t.name")}
     GROUP BY et.team`, [ev.season, ...ev.codes, ...ev.codes]);
  // A place said keeps the teams from there; how they're ranked is the whole event's (played or not), so a played event
  // whose teams from there have no OPR there never reads as unplayed.
  // Rookies asked: the teams in their first season, the event's own (a team's rookie year is the season it started).
  const rows = everyone.filter((r) => (!home || (r.country === home.country && (!home.state || r.state === home.state))) && (!ev.rookies || Number(r.rookie_year) === ev.season));
  // Records there by the official rule (playoffs and qualification no-shows counted), summed over its divisions.
  const there = new Map<number, { wins: number; losses: number; ties: number }>();
  for (const r of await all<{ team: number; wins: number; losses: number; ties: number }>(
    recordSql(`mt.season = ? AND (e.code IN (${inList}) OR e.division_code IN (${inList}))`), [ev.season, ...ev.codes, ...ev.codes])) {
    const o = there.get(Number(r.team)) ?? { wins: 0, losses: 0, ties: 0 };
    there.set(Number(r.team), { wins: o.wins + Number(r.wins), losses: o.losses + Number(r.losses), ties: o.ties + Number(r.ties) });
  }
  const S = seasonLabel(ev.season), P = seasonLabel(ev.season - 1);
  const mode = everyone.some((r) => r.eo != null) ? "event" : everyone.some((r) => r.so != null) ? "season" : "before";
  const by = mode === "event" ? "OPR there" : mode === "season" ? `${S} OPR` : `${P} OPR`;
  const v = (r: (typeof rows)[number]) => (mode === "event" ? r.eo : mode === "season" ? r.so : r.po);
  const ranked = rows.filter((r) => v(r) != null).sort((x, y) => Number(v(y)) - Number(v(x)) || Number(x.team) - Number(y.team));
  const shown = ranked.slice(0, b.n);
  const rec = (r: (typeof rows)[number]) => (mode === "event" ? there.get(Number(r.team)) ?? { wins: 0, losses: 0, ties: 0 } : { wins: Number(r.sw ?? 0), losses: Number(r.sl ?? 0), ties: Number(r.st ?? 0) });
  const who = ev.rookies ? `${home ? `${home.name} rookie` : "Rookie"} teams` : home ? `${home.name} teams` : "Best teams";
  const title = `${who} at ${ev.name} by ${by}`;
  const base = {
    family: "leaderboard" as const, intent: "event-best", title: `${title} · ${S}`, scope: [ev.name, ...(home ? [`From ${home.name}`] : []), ...(ev.rookies ? ["Rookies"] : []), S, `By ${by}`],
    definition: `The ${rows.length}${ev.rookies ? " rookie" : ""} team${rows.length === 1 ? "" : "s"}${home ? ` from ${home.name}` : ""}${ev.rookies ? ` (in their first season, ${S})` : ""} on the event's list (its divisions' too). ${mode === "event" ? "Ranked by each team's OPR at the event (its best division's), without penalties, as the event page shows it; the record is its matches there, playoffs included." : mode === "season" ? `The event's matches aren't played yet: ranked by the ${S} OPR each team brings, as its team page shows it; the record is its ${S} season's.` : `Neither the event's matches nor any ${S} OPR are on record yet: ranked by each team's ${P} OPR.`} A team with no such OPR isn't ranked.`,
    source: `${ranked.length} of ${rows.length} teams at ${ev.name} with ${mode === "event" ? "an OPR there" : `a ${mode === "season" ? S : P} OPR`}`,
  };
  if (!shown.length) return { ...base, blocks: [], none: rows.length ? `None of the ${rows.length} teams at ${ev.name} has ${mode === "before" ? `a ${P}` : "an"} OPR on record yet.` : `No${ev.rookies ? " rookie" : ""} teams${home ? ` from ${home.name}` : ""} are listed for ${ev.name} in ${S}${home || ev.rookies ? "" : " yet"}.` };
  const top = shown[0];
  const fmt1 = (x: number | null) => (x == null ? "–" : (Math.round(x * 10) / 10).toFixed(1));
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `${by} ${fmt1(v(top))}, ${record(rec(top))}${top.city ? ` · ${top.city}` : ""}`, sub: `#1 of ${ranked.length} ranked at ${ev.name}`, href: teamHref(Number(top.team), ev.season) },
    blocks: [{
      kind: "leaderboard", title: `Top ${shown.length} at ${ev.name}`, stat: { id: "opr", label: mode === "event" ? "OPR there" : by },
      ...(reportedTeleopIncludesEndgame(ev.season) ? { teleopWithEndgame: true } : {}),
      note: `${S} · ${ranked.length} ranked of ${rows.length} teams · by ${by}`,
      rows: shown.map((r, i) => ({ rank: i + 1, team: { label: `${r.team} ${r.name ?? ""}`.trim(), href: teamHref(Number(r.team), ev.season) },
        location: [r.city, r.state, r.country && r.country !== "USA" ? r.country : null].filter(Boolean).join(", ") || null,
        record: record(rec(r)), opr: v(r) == null ? null : Number(v(r)), value: v(r) == null ? null : Number(v(r)), display: fmt1(v(r)), parts: null })),
      more: { label: "Open the event", href: eventHref(ev.season, ev.code) },
    }],
  };
}

/** "Top teams this week", "best teams in NJ last weekend": the teams that played at an event held in the window (a place
 *  said keeps its teams), ranked by their OPR there (their best event's), with their record over the window's events. */
export async function windowBoardAnswer(window: { from: string; to: string; label: string }, region: Region | null, n: number): Promise<StatAnswer> {
  const season = seasonOfDate(window.to);
  const regionSql = region ? ` AND t.country = ?${region.state ? " AND t.state = ?" : ""}` : "";
  const regionArgs = region ? [region.country, ...(region.state ? [region.state] : [])] : [];
  // An event counts when any of its days falls in the window.
  const held = "e.season = ? AND e.start <= ? AND COALESCE(e.end, e.start) >= ?";
  const heldArgs = [season, window.to, window.from];
  const rows = await all<{ team: number; name: string | null; city: string | null; state: string | null; country: string | null; v: number; code: string; event: string; etype: string | null; events: number }>(
    `SELECT x.team, t.name, t.city, t.state, t.country, MAX(x.opr_np) v, e.code, e.name event, e.type etype, COUNT(DISTINCT x.code) events
     FROM team_event_stats x JOIN events e ON e.season = x.season AND e.code = x.code JOIN teams t ON t.number = x.team
     WHERE ${held} AND x.opr_np IS NOT NULL AND ${teamPageSql("x.team", "t.name")}${regionSql}
     GROUP BY x.team ORDER BY v DESC, x.team`, [...heldArgs, ...regionArgs]);
  const where = region ? ` from ${region.name}` : "";
  const W = window.label.replace(/^./, (c) => c.toUpperCase());
  const base = {
    family: "leaderboard" as const, intent: "window-best", title: `Top teams${where} ${window.label}, by OPR at their events`,
    scope: [W, region?.name ?? "Worldwide", seasonLabel(season)],
    definition: `The teams${where} that played at an event held ${window.label} (${window.from} to ${window.to}), ranked by their OPR at those events (their best one's), without penalties, with their record over them. A team's OPR at one event rests on a few matches, so it moves more than a season's.`,
    source: `${rows.length} team${rows.length === 1 ? "" : "s"} with an OPR at an event held ${window.label}`,
  };
  if (!rows.length) return { ...base, blocks: [], none: `No team${where} has an OPR from an event held ${window.label} yet: none has been played, or its scores aren't in.` };
  const shown = rows.slice(0, n);
  const there = new Map<number, { wins: number; losses: number; ties: number }>();
  const ph = shown.map(() => "?").join(", ");
  for (const r of await all<{ team: number; wins: number; losses: number; ties: number }>(
    recordSql(`mt.season = ? AND e.start <= ? AND COALESCE(e.end, e.start) >= ? AND mt.team IN (${ph})`), [...heldArgs, ...shown.map((r) => r.team)])) {
    const o = there.get(Number(r.team)) ?? { wins: 0, losses: 0, ties: 0 };
    there.set(Number(r.team), { wins: o.wins + Number(r.wins), losses: o.losses + Number(r.losses), ties: o.ties + Number(r.ties) });
  }
  const rec = (t: number) => record(there.get(t) ?? { wins: 0, losses: 0, ties: 0 });
  const fmt1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
  const top = shown[0];
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `OPR ${fmt1(Number(top.v))} at ${top.event}, ${rec(Number(top.team))}`, sub: `#1 of ${rows.length} teams that played ${window.label}`, href: teamHref(Number(top.team), season) },
    blocks: [{
      kind: "leaderboard", title: `Top ${shown.length} ${window.label}`, stat: { id: "opr", label: "OPR there" },
      ...(reportedTeleopIncludesEndgame(season) ? { teleopWithEndgame: true } : {}),
      note: `${seasonLabel(season)} · ${rows.length} team${rows.length === 1 ? "" : "s"} that played ${window.label} · by OPR at their best event`,
      rows: shown.map((r, i) => ({ rank: i + 1, team: { label: `${r.team} ${r.name ?? ""}`.trim(), href: eventHref(season, r.code, Number(r.team)) },
        location: [r.city, r.state, r.country && r.country !== "USA" ? r.country : null].filter(Boolean).join(", ") || null,
        record: rec(Number(r.team)), opr: Number(r.v), value: Number(r.v), display: fmt1(Number(r.v)), parts: null })),
    }],
  };
}

async function improvedAnswer(b: BoardQuestion, season: number, where: string, regionSql: string, regionArgs: string[], chips: string[], why: string): Promise<StatAnswer> {
  const rows = await all<{ team: number; name: string | null; r1: number; n1: number; r0: number; n0: number; o1: number | null; o0: number | null }>(
    `SELECT s.team, t.name, s.rank_np r1, s.ranked_teams n1, p.rank_np r0, p.ranked_teams n0, s.opr_np o1, p.opr_np o0
     FROM team_season_stats s JOIN team_season_stats p ON p.team = s.team AND p.season = s.season - 1 JOIN teams t ON t.number = s.team
     WHERE s.season = ? AND s.matches >= ? AND p.matches >= ? AND s.rank_np IS NOT NULL AND p.rank_np IS NOT NULL AND s.ranked_teams > 0 AND p.ranked_teams > 0
       AND ${teamPageSql("s.team", "t.name")}${regionSql}${b.climb ? " AND p.rank_np >= ? AND s.rank_np <= ?" : ""}
     ORDER BY (1.0 * p.rank_np / p.ranked_teams) - (1.0 * s.rank_np / s.ranked_teams) DESC, s.team LIMIT ?`,
    [season, RANKED_MIN_MATCHES, RANKED_MIN_MATCHES, ...regionArgs, ...(b.climb ? [b.climb.from, b.climb.to] : []), b.n]);
  const share = (r: number, n: number) => `top ${Math.max(1, Math.ceil((100 * r) / n))}%`;
  const c = b.climb;
  const climb = c ? `from OPR rank ${c.from.toLocaleString("en-US")}+ to the top ${c.to.toLocaleString("en-US")}` : "";
  const title = c ? `Teams${where} that climbed ${climb}` : `Most improved team${b.n > 1 ? "s" : ""}${where}`;
  const base = {
    family: "leaderboard" as const, intent: "most-improved", title: `${title} · ${seasonLabel(season)}`, scope: chips,
    definition: `Most improved: the biggest climb in worldwide OPR standing (OPR rank as a share of all ranked teams) from ${seasonLabel(season - 1)} to ${seasonLabel(season)}. OPR in points isn't compared, since every season is a different game.${c ? ` Only teams ranked #${c.from.toLocaleString("en-US")} or below worldwide in ${seasonLabel(season - 1)} and #${c.to.toLocaleString("en-US")} or better in ${seasonLabel(season)}.` : ""} ${RANKED}${why}`,
    source: `From the ${seasonLabel(season - 1)} and ${seasonLabel(season)} season numbers`,
  };
  if (!rows.length) return { ...base, blocks: [], none: c ? `No team${where} climbed ${climb} from ${seasonLabel(season - 1)} to ${seasonLabel(season)}.` : `No team${where} has ${RANKED_MIN_MATCHES}+ matches in both ${seasonLabel(season - 1)} and ${seasonLabel(season)}.` };
  const top = rows[0];
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `${share(top.r0, top.n0)} → ${share(top.r1, top.n1)} worldwide by OPR`, sub: `OPR rank #${top.r0} of ${top.n0} → #${top.r1} of ${top.n1}`, href: teamHref(Number(top.team), season) },
    blocks: [{
      kind: "table", title: "Biggest climbs",
      // Numbers only, so a phone shows the climb beside the team; the shares are on the headline.
      columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "climb", label: "OPR rank", num: true }, { key: "opr", label: "OPR now", num: true }],
      rows: rows.map((r, i) => ({ cells: { rank: i + 1, team: `${r.team} ${r.name ?? ""}`.trim(), climb: `#${r.r0} → #${r.r1}`, opr: r.o1 == null ? "–" : (Math.round(r.o1 * 10) / 10).toFixed(1) }, href: teamHref(Number(r.team), season), strong: i === 0 })),
    }],
  };
}

const STEADY_MIN_EVENTS = 3;
const f1 = (x: number | null) => (x == null ? "–" : (Math.round(x * 10) / 10).toFixed(1));

/** "Most stable OPR": the smallest swing in a team's OPR from event to event in the season (its event OPRs' standard
 *  deviation as a share of their mean), teams with an OPR at 3+ events. */
async function steadyAnswer(b: BoardQuestion, season: number, where: string, regionSql: string, regionArgs: string[], chips: string[], why: string): Promise<StatAnswer> {
  const from = `team_event_stats x JOIN teams t ON t.number = x.team
     WHERE x.season = ? AND x.matches > 0 AND x.opr_np IS NOT NULL AND ${teamPageSql("x.team", "t.name")}${regionSql}
     GROUP BY x.team HAVING k >= ${STEADY_MIN_EVENTS} AND m > 0`;
  const cols = "x.team, t.name, t.city, COUNT(*) k, AVG(x.opr_np) m, AVG(x.opr_np * x.opr_np) - AVG(x.opr_np) * AVG(x.opr_np) var, MIN(x.opr_np) lo, MAX(x.opr_np) hi";
  const [rows, count] = await Promise.all([
    all<{ team: number; name: string | null; city: string | null; k: number; m: number; var: number; lo: number; hi: number }>(
      `SELECT ${cols} FROM ${from} ORDER BY var / (m * m) ASC, m DESC, x.team LIMIT ?`, [season, ...regionArgs, b.n]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM (SELECT ${cols} FROM ${from})`, [season, ...regionArgs]),
  ]);
  const S = seasonLabel(season), total = Number(count?.n ?? 0);
  // A share of the team's own average OPR, so a strong team's swing in points isn't held against it.
  const swing = (r: (typeof rows)[number]) => `±${Math.round((100 * Math.sqrt(Math.max(0, Number(r.var)))) / Number(r.m))}%`;
  const base = {
    family: "leaderboard" as const, intent: "steady-opr", title: `Most stable OPR${where}: the fewest ups and downs · ${S}`, scope: chips,
    definition: `Stable: the smallest swing in OPR from event to event, the standard deviation of the team's event OPRs (without penalties, as its team page shows them) as a share of their average; teams with an OPR at ${STEADY_MIN_EVENTS} or more events and an average above 0 (a share of an average at or below 0 means nothing).${why}`,
    source: `From the event OPRs of ${total.toLocaleString("en-US")} team${total === 1 ? "" : "s"}${where} with ${STEADY_MIN_EVENTS}+ events in ${S}`,
  };
  if (!rows.length) return { ...base, blocks: [], none: `No team${where} has an OPR at ${STEADY_MIN_EVENTS} or more events, averaging above 0, in ${S}.` };
  const top = rows[0];
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `OPR ${f1(top.m)} on average, ${swing(top)} over ${top.k} events${top.city ? ` · ${top.city}` : ""}`, sub: `Every event between ${f1(top.lo)} and ${f1(top.hi)}`, href: teamHref(Number(top.team), season) },
    blocks: [{
      kind: "table", title: "Steadiest OPR",
      columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "swing", label: "Swing", num: true }, { key: "avg", label: "OPR avg", num: true }, { key: "range", label: "Low – high", num: true }],
      rows: rows.map((r, i) => ({ cells: { rank: i + 1, team: `${r.team} ${r.name ?? ""}`.trim(), swing: swing(r), avg: f1(r.m), range: `${f1(r.lo)} – ${f1(r.hi)}` }, href: teamHref(Number(r.team), season), strong: i === 0 })),
    }],
  };
}

/** "Most consistent across all phases": strong in every phase, ranked by the team's weakest phase OPR rank worldwide
 *  (auto, teleop and endgame; teleop alone where the season's teleop includes endgame), the overall OPR rank breaking
 *  a tie. */
async function phasesAnswer(b: BoardQuestion, season: number, where: string, regionSql: string, regionArgs: string[], chips: string[], why: string): Promise<StatAnswer> {
  const withEnd = !reportedTeleopIncludesEndgame(season);
  const worst = `MAX(s.rank_auto, s.rank_teleop${withEnd ? ", s.rank_endgame" : ""})`;
  const ranked = `s.season = ? AND s.matches >= ? AND s.rank_auto IS NOT NULL AND s.rank_teleop IS NOT NULL${withEnd ? " AND s.rank_endgame IS NOT NULL" : ""} AND ${teamPageSql("s.team", "t.name")}${regionSql}`;
  const args = [season, RANKED_MIN_MATCHES, ...regionArgs];
  const [rows, count] = await Promise.all([
    all<{ team: number; name: string | null; city: string | null; w: number; ra: number; rt: number; re: number | null; n: number; opr: number | null }>(
      `SELECT s.team, t.name, t.city, ${worst} w, s.rank_auto ra, s.rank_teleop rt, s.rank_endgame re, s.ranked_teams n, s.opr_np opr
       FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked} ORDER BY w ASC, s.rank_np ASC, s.team LIMIT ?`, [...args, b.n]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked}`, args),
  ]);
  const S = seasonLabel(season), total = Number(count?.n ?? 0);
  const phases = withEnd ? "auto, teleop and endgame" : "auto and teleop (this season's teleop includes endgame)";
  const base = {
    family: "leaderboard" as const, intent: "every-phase", title: `Strongest in every phase${where} · ${S}`, scope: chips,
    definition: `Strongest in every phase: ranked by the team's weakest phase, its lowest worldwide OPR rank among ${phases}, so a team strong in one phase alone doesn't lead; the overall OPR rank breaks a tie. ${RANKED}${why}`,
    source: `From the ${S} season numbers of ${total.toLocaleString("en-US")} ranked team${total === 1 ? "" : "s"}${where}`,
  };
  // Phase ranks are worked out with the season's numbers, so a team can have its matches before it has them.
  if (!rows.length) return { ...base, blocks: [], none: `No team${where} has phase OPR ranks for ${S} yet: they come with ${RANKED_MIN_MATCHES}+ matches and the season's numbers worked out.` };
  const top = rows[0];
  const r1 = (x: number | null) => (x == null ? "–" : `#${Number(x).toLocaleString("en-US")}`);
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `Weakest phase ${r1(top.w)} worldwide${top.city ? ` · ${top.city}` : ""}`, sub: `Auto ${r1(top.ra)} · teleop ${r1(top.rt)}${withEnd ? ` · endgame ${r1(top.re)}` : ""} of ${Number(top.n).toLocaleString("en-US")}`, href: teamHref(Number(top.team), season) },
    blocks: [{
      kind: "table", title: "Strongest in every phase",
      columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "worst", label: "Weakest", num: true }, { key: "auto", label: "Auto", num: true }, { key: "teleop", label: "Teleop", num: true },
        ...(withEnd ? [{ key: "endgame", label: "Endgame", num: true }] : []), { key: "opr", label: "OPR", num: true }],
      rows: rows.map((r, i) => ({ cells: { rank: i + 1, team: `${r.team} ${r.name ?? ""}`.trim(), worst: r1(r.w), auto: r1(r.ra), teleop: r1(r.rt), ...(withEnd ? { endgame: r1(r.re) } : {}), opr: f1(r.opr) }, href: teamHref(Number(r.team), season), strong: i === 0 })),
    }],
  };
}

/** "Most improved teams in NJ by OPR gain": the OPR gained within one season, from the team's first event with an OPR
 *  to its last (by date), as the team page's OPR-by-event list shows them. Points are compared within one game only. */
async function gainAnswer(b: BoardQuestion, season: number, where: string, regionSql: string, regionArgs: string[], chips: string[], why: string): Promise<StatAnswer> {
  const ev = `SELECT x.team, x.opr_np o, e.name, e.code,
      ROW_NUMBER() OVER (PARTITION BY x.team ORDER BY e.start, e.code) a, ROW_NUMBER() OVER (PARTITION BY x.team ORDER BY e.start DESC, e.code DESC) z,
      COUNT(*) OVER (PARTITION BY x.team) k
    FROM team_event_stats x JOIN events e ON e.season = x.season AND e.code = x.code
    WHERE x.season = ? AND x.matches > 0 AND x.opr_np IS NOT NULL AND e.start IS NOT NULL`;
  const from = `ev f JOIN ev l ON l.team = f.team AND l.z = 1 JOIN teams t ON t.number = f.team
    WHERE f.a = 1 AND f.k >= 2 AND ${teamPageSql("f.team", "t.name")}${regionSql}`;
  const [rows, count] = await Promise.all([
    all<{ team: number; name: string | null; city: string | null; o0: number; o1: number; n0: string; n1: string; c1: string; k: number }>(
      `WITH ev AS (${ev}) SELECT f.team, t.name, t.city, f.o o0, l.o o1, f.name n0, l.name n1, l.code c1, f.k k FROM ${from}
       ORDER BY l.o - f.o DESC, f.team LIMIT ?`, [season, ...regionArgs, b.n]),
    get<{ n: number }>(`WITH ev AS (${ev}) SELECT COUNT(*) n FROM ${from}`, [season, ...regionArgs]),
  ]);
  const S = seasonLabel(season), total = Number(count?.n ?? 0);
  const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
  const gain = (r: (typeof rows)[number]) => { const g = Number(r.o1) - Number(r.o0); return `${g >= 0 ? "+" : "−"}${f1(Math.abs(g))}`; };
  const title = `Most OPR gained${where}`;
  const base = {
    family: "leaderboard" as const, intent: "opr-gain", title: `${title} between first and last event · ${S}`, scope: chips,
    definition: `OPR gained: the OPR at the team's last event of ${S} (without penalties, as its team page shows it) less its OPR at its first, by date; teams with an OPR at 2 or more events.${why}`,
    source: `From the event OPRs of ${total.toLocaleString("en-US")} team${total === 1 ? "" : "s"}${where} with 2+ events in ${S}`,
  };
  if (!rows.length) return { ...base, blocks: [], none: `No team${where} has an OPR at 2 or more events in ${S}.` };
  const top = rows[0];
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `${gain(top)} OPR: ${f1(top.o0)} → ${f1(top.o1)} over ${top.k} events${top.city ? ` · ${top.city}` : ""}`, sub: `${top.n0} → ${top.n1}`, href: teamHref(Number(top.team), season) },
    blocks: [{
      kind: "table", title: "Most OPR gained",
      columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "gain", label: "Gained", num: true }, { key: "span", label: "First → last event", num: true }],
      rows: rows.map((r, i) => ({ cells: { rank: i + 1, team: `${r.team} ${r.name ?? ""}`.trim(), gain: gain(r), span: `${f1(r.o0)} → ${f1(r.o1)}` }, href: teamHref(Number(r.team), season), strong: i === 0 })),
    }],
  };
}

/** A city's best with no season said, as every place answer (docs/search-pipeline.md, "Leaderboards"): the current
 *  season once a team of the city is ranked in it, else the one before, said on the card. */
async function cityBestNow(b: BoardQuestion): Promise<StatAnswer> {
  const current = seasonOfDate(searchToday());
  const now = await cityBestAnswer(b, current, "");
  if (now.headline) return now;
  const before = await cityBestAnswer(b, current - 1, "");
  if (!before.headline) return now;
  const note = `No ${seasonLabel(current)} ranked teams yet in ${before.scope[0]}; showing ${seasonLabel(current - 1)}`;
  return { ...before, scope: [note, ...before.scope], definition: `${before.definition} ${note}: no season was named, so the current one was read first, and it has none yet.` };
}

/** "Best team in Oradell": the city's teams ranked by OPR in the season (3+ matches), the best first. */
async function cityBestAnswer(b: BoardQuestion, season: number, why: string): Promise<StatAnswer> {
  const ranked = `s.season = ? AND s.matches >= ? AND s.opr_np IS NOT NULL AND lower(t.city) = lower(?) AND ${teamPageSql("s.team", "t.name")}`;
  const args = [season, RANKED_MIN_MATCHES, b.city];
  const [rows, count] = await Promise.all([
    all<{ team: number; name: string | null; city: string; state: string | null; opr: number; wins: number; losses: number; ties: number }>(
      `SELECT s.team, t.name, t.city, t.state, s.opr_np opr, s.wins, s.losses, s.ties FROM team_season_stats s JOIN teams t ON t.number = s.team
       WHERE ${ranked} ORDER BY s.opr_np DESC, s.wins DESC, s.team LIMIT ?`, [...args, b.n]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked}`, args),
  ]);
  // Every ranked team of the city counts, not only the rows shown ("top 5 teams in Oradell").
  const total = Number(count?.n ?? rows.length);
  const name = rows[0]?.city ?? b.city!;
  // A city name several states share ("Springfield") is every one of them, so the heading names a state only when one.
  const states = [...new Set(rows.map((r) => r.state).filter(Boolean))];
  const where = ` in ${name}${states.length === 1 ? `, ${states[0]}` : ""}`;
  const S = seasonLabel(season);
  const base = {
    family: "leaderboard" as const, intent: "city-best", title: `Best team${where} by OPR · ${S}`, scope: [name, S],
    definition: `Teams whose home city is ${name}, as FIRST lists it${states.length > 1 ? ` (in ${states.join(", ")})` : ""}, by their ${S} OPR. ${RANKED}${why}`,
    source: `From the ${S} season numbers of ${total} ranked team${total === 1 ? "" : "s"}${where}`,
  };
  if (!rows.length) return { ...base, blocks: [], none: `No team from ${name} has played ${RANKED_MIN_MATCHES}+ matches in ${S}.` };
  const top = rows[0];
  const st = BOARD_STATS.opr;
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `OPR ${fmt(top.opr, st)}, ${record(top)}`, sub: `#1 of ${total} ranked${where}`, href: teamHref(Number(top.team), season) },
    blocks: [{
      kind: "leaderboard", title: `Teams${where} by OPR`, stat: { id: "opr", label: "OPR" },
      ...(reportedTeleopIncludesEndgame(season) ? { teleopWithEndgame: true } : {}),
      note: `${S} · ${total} ranked team${total === 1 ? "" : "s"}${where} · by OPR`,
      rows: rows.map((r, i) => ({ rank: i + 1, team: { label: `${r.team} ${r.name ?? ""}`.trim(), href: teamHref(Number(r.team), season) }, location: [r.city, r.state].filter(Boolean).join(", ") || null, record: record(r), opr: Number(r.opr), value: Number(r.opr), display: fmt(r.opr, st), parts: null })),
    }],
  };
}

/** A town's teams, or a school's (`school`: the name is the school FIRST lists for each team). */
async function cityAnswer(city: string, school = false, within: Region | null = null): Promise<StatAnswer> {
  const inSql = within ? ` AND t.country = ?${within.state ? " AND t.state = ?" : ""}` : "";
  const rows = await all<{ number: number; name: string | null; city: string; school: string | null; state: string | null; country: string | null; rookie_year: number | null; last: number | null; opr: number | null }>(
    `SELECT t.number, t.name, t.city, t.school, t.state, t.country, t.rookie_year,
            (SELECT MAX(season) FROM team_season_stats x WHERE x.team = t.number AND x.matches > 0) last,
            (SELECT opr_np FROM team_season_stats x WHERE x.team = t.number AND x.matches > 0 ORDER BY season DESC LIMIT 1) opr
     FROM teams t WHERE lower(t.${school ? "school" : "city"}) = lower(?)${inSql} AND ${teamPageSql("t.number", "t.name")}
     ORDER BY last IS NULL, last DESC, t.number LIMIT 1000`, [city, ...(within ? [within.country, ...(within.state ? [within.state] : [])] : [])]);
  const name = (school ? rows[0]?.school : rows[0]?.city) ?? city;
  // Where each is: its state in North America, its country elsewhere (a county code like "B" says nothing).
  const states = [...new Set(rows.map((r) => (r.country === "USA" || r.country === "Canada" || !r.country ? r.state : r.country)).filter(Boolean))];
  const title = school ? `Teams at ${name}${rows[0] ? `, ${rows[0].city}` : ""}` : `Teams in ${name}${states.length === 1 ? `, ${states[0]}` : ""}`;
  const base = { family: "leaderboard" as const, intent: school ? "school-teams" : "city-teams", title, scope: [name],
    definition: `Teams whose ${school ? "school" : "home city"} is this name, as FIRST lists it; newest season played first, with that season's OPR. A team that hasn't played yet is listed last.`, source: `From the team directory: ${rows.length} team${rows.length === 1 ? "" : "s"}` };
  if (!rows.length) return { ...base, blocks: [], none: school ? `No teams list ${city} as their school.` : `No teams list ${city} as their home city.` };
  const active = rows.filter((r) => r.last != null);
  return {
    ...base,
    headline: { value: `${rows.length} team${rows.length === 1 ? "" : "s"}`, label: `${school ? "at" : "in"} ${name}${states.length > 1 ? ` (${states.join(", ")})` : within && states.length === 1 ? `, ${states[0]}` : ""}`, sub: active.length ? `${active.filter((r) => r.last === active[0].last).length} played in ${seasonLabel(active[0].last!)}` : undefined },
    blocks: [{
      kind: "table", title: "Teams, newest season first",
      columns: [{ key: "team", label: "Team" }, { key: "rookie", label: "Rookie year", num: true }, { key: "last", label: "Last season" }, { key: "opr", label: "OPR then", num: true }],
      rows: rows.map((r) => ({ cells: { team: `${r.number} ${r.name ?? ""}`.trim(), rookie: r.rookie_year ?? "–", last: r.last != null ? seasonLabel(r.last) : "Not yet", opr: r.opr == null ? "–" : (Math.round(r.opr * 10) / 10).toFixed(1) }, href: teamHref(Number(r.number)) })),
    }],
  };
}
