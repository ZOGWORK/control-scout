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
import { countryOf } from "../../../../src/shared/countries.js";
import type { Region } from "../../../../src/shared/regions.js";
import { all, get } from "../../../db.js";
import { searchSeason, searchSeasonWhy } from "../season.js";
import { reportedTeleopIncludesEndgame } from "../../../data/seasons.js";
import { teamHref } from "../matchSet.js";
import { seasonOfDate } from "../../query/time.js";
import { searchToday } from "../../searchEvents.js";

export const LEADERBOARD_MAX = 25;

/** A stat a leaderboard ranks by: its stored column (or expression), its words, and the Teams page's sort key: only
 *  where that table shows the same number (its OPRs; its wins and averages count qualification matches only). */
export interface BoardStat { id: string; label: string; sql: string; unit: string; teamsSort: string | null; digits: number; join?: string;
  /** Fewer is better (penalties): the top of the list is the most, never "the best". */
  fewerBetter?: true }
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
  penalties: { id: "penalties", label: "Penalty points given away a match", sql: "s.rating_pen", unit: "", teamsSort: null, digits: 1, fewerBetter: true },
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

export type BoardKind = "top" | "rookie" | "improved" | "city" | "city-best";
/** `best`: "best team in New Jersey by OPR", one team asked for: titled so, the next few listed under it. */
export interface BoardQuestion { kind: BoardKind; stat: BoardStat; n: number; region: Region | null; city: string | null; season: number | null; seasonWhy?: string; best?: boolean;
  /** The bottom of the list, lowest first ("sorted lowest to highest", "worst teleop OPR in Romania"). */
  asc?: boolean;
  /** Teams with no losses that season only ("undefeated teams", "a perfect record"). */
  undefeated?: boolean;
  /** A town within the region ("best team in Cluj-Napoca, Romania, by OPR"): the teams from it. */
  town?: string | null }

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
  if (b.kind === "city") return cityAnswer(b.city!);
  const season = b.season ?? searchSeason();
  const why = b.season == null ? ` ${searchSeasonWhy(season)}` : b.seasonWhy ? ` ${b.seasonWhy}` : "";
  if (b.kind === "city-best") return b.season == null ? cityBestNow(b) : cityBestAnswer(b, season, why);
  // A region, or a whole country (no state); a town in it narrows to the teams from there.
  const where = b.town ? ` in ${b.town}` : b.region ? ` in ${b.region.name}` : " worldwide";
  const regionSql = `${b.region ? ` AND t.country = ?${b.region.state ? " AND t.state = ?" : ""}` : ""}${b.town ? " AND lower(t.city) = lower(?)" : ""}`;
  const regionArgs = [...(b.region ? [b.region.country, ...(b.region.state ? [b.region.state] : [])] : []), ...(b.town ? [b.town] : [])];
  const chips = [...(b.town ? [b.town] : []), b.region?.name ?? "Worldwide", seasonLabel(season)];
  if (b.kind === "improved") return improvedAnswer(b, season, where, regionSql, regionArgs, chips, why);
  const st = b.stat;
  const rookie = b.kind === "rookie";
  const ranked = `s.season = ? AND ${st.id === "rating" ? "s.rating_matches" : "s.matches"} >= ? AND ${st.sql} IS NOT NULL AND ${teamPageSql("s.team", "t.name")}${regionSql}${rookie ? " AND t.rookie_year = ?" : ""}${b.undefeated ? " AND s.losses = 0" : ""}`;
  const from = `team_season_stats s JOIN teams t ON t.number = s.team${st.join ? ` ${st.join}` : ""}`;
  const args = [season, RANKED_MIN_MATCHES, ...regionArgs, ...(rookie ? [season] : [])];
  const [rows, count] = await Promise.all([
    all<{ team: number; name: string | null; city: string | null; state: string | null; country: string | null; v: number | null; opr: number | null; auto: number | null; teleop: number | null; endgame: number | null; pen: number | null; wins: number; losses: number; ties: number; matches: number }>(
      `SELECT s.team, t.name, t.city, t.state, t.country, ${st.sql} v, s.opr_np opr, s.opr_auto auto, s.opr_teleop teleop, s.opr_endgame endgame, s.opr_pen pen, s.wins, s.losses, s.ties, s.matches
       FROM ${from} WHERE ${ranked}
       ORDER BY v ${b.asc ? "ASC" : "DESC"}, ${st.id === "rating" ? "" : `s.wins ${b.asc ? "ASC" : "DESC"}, `}s.team ${b.asc ? "DESC" : "ASC"} LIMIT ?`, [...args, b.n]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM ${from} WHERE ${ranked}`, args),
  ]);
  const title = b.undefeated ? `Undefeated teams${where} by ${statWords(st)}` : rookie ? `Best rookie team${b.n > 1 ? "s" : ""}${where} by ${statWords(st)}` : b.asc ? `Lowest ${b.n > 1 ? `${b.n} teams` : "team"} by ${statWords(st)}${where}`
    : b.best ? (st.fewerBetter ? `Team${where} with the most ${statWords(st)}` : `Best team${where} by ${statWords(st)}`) : `Top ${b.n} teams by ${statWords(st)}${where}`;
  // A link opens the same list or none: Rankings has no rookie filter and no lowest-first order, and neither page
  // takes a town or undefeated teams, so those get no link rather than one to a different list.
  const href = b.town || b.undefeated ? null : st.teamsSort ? teamsHref(season, st, b.region, rookie, !!b.asc)
    : st.id === "rating" && !rookie && !b.asc ? rankingsHref(season, b.region) : null;
  const definition = `${b.undefeated ? "Undefeated: no losses in the season's matches (ties allowed). " : ""}${RANKED}${rookie ? ` A rookie team's rookie year is ${seasonLabel(season)}.` : ""}${st.id === "win-rate" ? " Win rate: wins over matches played, ties counted as played." : ""}${st.id === "record" ? " Record: wins-losses-ties, the best win rate first (wins over matches played, ties counted as played), then the most wins." : ""}${st.id === "penalties" ? " Penalty points given away a match: the prediction rating's estimate of what the robot alone gives away, as the team page shows it." : ""}${st.id === "reliability" ? " Reliability: the team page's index out of 100, from no-shows, disqualifications, near-zero matches and how steady its scoring is." : ""}${st.id === "rating" ? " The prediction rating is the engine's points-per-match strength; ranked once 3 matches are rated, as on Rankings." : ""}${st.id.includes("+") ? ` ${st.label}: each phase's OPR added, as the team page shows them.` : ""}${b.asc ? " Lowest first: the bottom of the ranked list, each team's place counted from the top." : ""}${why}`;
  const total = Number(count?.n ?? 0);
  const base = { family: "leaderboard" as const, intent: rookie ? "best-rookie" : `top-${st.id}`, title: `${title} · ${seasonLabel(season)}`, scope: chips, definition, source: `From the ${seasonLabel(season)} season numbers of ${total.toLocaleString("en-US")} ranked ${rookie ? "rookie " : ""}team${total === 1 ? "" : "s"}${where}` };
  if (!rows.length) return { ...base, blocks: [], none: b.undefeated ? `No team${where} with ${RANKED_MIN_MATCHES}+ matches is undefeated in ${seasonLabel(season)}.` : `No ${rookie ? "rookie " : ""}team${where} has played ${RANKED_MIN_MATCHES}+ matches in ${seasonLabel(season)} yet.` };
  const top = rows[0];
  const num = (v: number | null) => (v == null ? null : Number(v));
  const shown = (r: (typeof rows)[number]) => (st.id === "record" ? record(r) : fmt(r.v, st));
  const board: StatBlock = {
    kind: "leaderboard", title: rookie ? `Rookie teams by ${st.label}` : b.asc ? `Lowest ${rows.length} by ${st.label}` : `Top ${rows.length} by ${st.label}`, stat: { id: st.id, label: st.label, ...(st.unit ? { unit: st.unit } : {}) },
    ...(reportedTeleopIncludesEndgame(season) ? { teleopWithEndgame: true } : {}), ...(b.asc ? { lowest: true } : {}),
    note: `${seasonLabel(season)} · ${total.toLocaleString("en-US")} ranked ${rookie ? "rookie " : ""}team${total === 1 ? "" : "s"}${where} · by ${statWords(st)}`,
    rows: rows.map((r, i) => ({
      rank: b.asc ? total - i : i + 1, team: { label: `${r.team} ${r.name ?? ""}`.trim(), href: teamHref(Number(r.team), season) },
      location: [r.city, r.state, r.country && r.country !== "USA" ? r.country : null].filter(Boolean).join(", ") || null,
      record: record(r), opr: num(r.opr), value: num(r.v), display: shown(r),
      parts: r.auto != null || r.teleop != null || r.endgame != null || r.pen != null ? { auto: num(r.auto), teleop: num(r.teleop), endgame: num(r.endgame), pen: num(r.pen) } : null,
    })),
    // The Teams table counts qualification matches only, so its list can differ by a team or two: said on the link.
    ...(href ? { more: { label: st.teamsSort ? "View more detail on the Teams page (qualification matches)" : "View more detail on Rankings", href } } : {}),
  };
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `${st.id === "record" ? `Record ${record(top)}` : `${st.label} ${fmt(top.v, st)}, ${record(top)}`}${top.city ? ` · ${top.city}` : ""}`, sub: b.asc ? `Lowest of ${total.toLocaleString("en-US")} ranked${where}` : b.best ? `#1 of ${total.toLocaleString("en-US")} ranked${where}` : `#1 of ${rows.length} shown`, href: teamHref(Number(top.team), season) },
    blocks: [board],
  };
}

async function improvedAnswer(b: BoardQuestion, season: number, where: string, regionSql: string, regionArgs: string[], chips: string[], why: string): Promise<StatAnswer> {
  const rows = await all<{ team: number; name: string | null; r1: number; n1: number; r0: number; n0: number; o1: number | null; o0: number | null }>(
    `SELECT s.team, t.name, s.rank_np r1, s.ranked_teams n1, p.rank_np r0, p.ranked_teams n0, s.opr_np o1, p.opr_np o0
     FROM team_season_stats s JOIN team_season_stats p ON p.team = s.team AND p.season = s.season - 1 JOIN teams t ON t.number = s.team
     WHERE s.season = ? AND s.matches >= ? AND p.matches >= ? AND s.rank_np IS NOT NULL AND p.rank_np IS NOT NULL AND s.ranked_teams > 0 AND p.ranked_teams > 0
       AND ${teamPageSql("s.team", "t.name")}${regionSql}
     ORDER BY (1.0 * p.rank_np / p.ranked_teams) - (1.0 * s.rank_np / s.ranked_teams) DESC, s.team LIMIT ?`,
    [season, RANKED_MIN_MATCHES, RANKED_MIN_MATCHES, ...regionArgs, b.n]);
  const share = (r: number, n: number) => `top ${Math.max(1, Math.ceil((100 * r) / n))}%`;
  const title = `Most improved team${b.n > 1 ? "s" : ""}${where}`;
  const base = {
    family: "leaderboard" as const, intent: "most-improved", title: `${title} · ${seasonLabel(season)}`, scope: chips,
    definition: `Most improved: the biggest climb in worldwide OPR standing (OPR rank as a share of all ranked teams) from ${seasonLabel(season - 1)} to ${seasonLabel(season)}. OPR in points isn't compared, since every season is a different game. ${RANKED}${why}`,
    source: `From the ${seasonLabel(season - 1)} and ${seasonLabel(season)} season numbers`,
  };
  if (!rows.length) return { ...base, blocks: [], none: `No team${where} has ${RANKED_MIN_MATCHES}+ matches in both ${seasonLabel(season - 1)} and ${seasonLabel(season)}.` };
  const top = rows[0];
  return {
    ...base,
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `${share(top.r0, top.n0)} → ${share(top.r1, top.n1)} worldwide by OPR`, sub: `OPR rank #${top.r0} of ${top.n0} → #${top.r1} of ${top.n1}`, href: teamHref(Number(top.team), season) },
    blocks: [{
      kind: "table", title: "Biggest climbs",
      columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "before", label: seasonLabel(season - 1) }, { key: "now", label: seasonLabel(season) }, { key: "opr", label: "OPR now", num: true }],
      rows: rows.map((r, i) => ({ cells: { rank: i + 1, team: `${r.team} ${r.name ?? ""}`.trim(), before: `#${r.r0} (${share(r.r0, r.n0)})`, now: `#${r.r1} (${share(r.r1, r.n1)})`, opr: r.o1 == null ? "–" : (Math.round(r.o1 * 10) / 10).toFixed(1) }, href: teamHref(Number(r.team), season), strong: i === 0 })),
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

async function cityAnswer(city: string): Promise<StatAnswer> {
  const rows = await all<{ number: number; name: string | null; city: string; state: string | null; rookie_year: number | null; last: number | null; opr: number | null }>(
    `SELECT t.number, t.name, t.city, t.state, t.rookie_year,
            (SELECT MAX(season) FROM team_season_stats x WHERE x.team = t.number AND x.matches > 0) last,
            (SELECT opr_np FROM team_season_stats x WHERE x.team = t.number AND x.matches > 0 ORDER BY season DESC LIMIT 1) opr
     FROM teams t WHERE lower(t.city) = lower(?) AND ${teamPageSql("t.number", "t.name")}
     ORDER BY last IS NULL, last DESC, t.number LIMIT 1000`, [city]);
  const name = rows[0]?.city ?? city;
  const states = [...new Set(rows.map((r) => r.state).filter(Boolean))];
  const title = `Teams in ${name}${states.length === 1 ? `, ${states[0]}` : ""}`;
  const base = { family: "leaderboard" as const, intent: "city-teams", title, scope: [name], definition: "Teams whose home city is this name, as FIRST lists it; newest season played first, with that season's OPR. A team that hasn't played yet is listed last.", source: `From the team directory: ${rows.length} team${rows.length === 1 ? "" : "s"}` };
  if (!rows.length) return { ...base, blocks: [], none: `No teams list ${city} as their home city.` };
  const active = rows.filter((r) => r.last != null);
  return {
    ...base,
    headline: { value: `${rows.length} team${rows.length === 1 ? "" : "s"}`, label: `in ${name}${states.length > 1 ? ` (${states.join(", ")})` : ""}`, sub: active.length ? `${active.filter((r) => r.last === active[0].last).length} played in ${seasonLabel(active[0].last!)}` : undefined },
    blocks: [{
      kind: "table", title: "Teams, newest season first",
      columns: [{ key: "team", label: "Team" }, { key: "rookie", label: "Rookie year", num: true }, { key: "last", label: "Last season" }, { key: "opr", label: "OPR then", num: true }],
      rows: rows.map((r) => ({ cells: { team: `${r.number} ${r.name ?? ""}`.trim(), rookie: r.rookie_year ?? "–", last: r.last != null ? seasonLabel(r.last) : "Not yet", opr: r.opr == null ? "–" : (Math.round(r.opr * 10) / 10).toFixed(1) }, href: teamHref(Number(r.number)) })),
    }],
  };
}
