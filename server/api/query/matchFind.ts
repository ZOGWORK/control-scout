// Matches found by a measure, no team (docs/search-pipeline.md, "Match finder"): "closest match in Romania last month",
// "most lopsided match in Ohio this week", "biggest upset in New Jersey this season", "best comeback in Michigan",
// "lowest scoring playoff match in Texas", "match with the most penalty points at a league meet". One query over the
// stored matches: the place, the time, the match type and the kind of event as filters, the measure as the order. A
// measure the data doesn't hold directly (an upset, a comeback) is worked out by a fixed rule the card prints under
// "How this is counted", never guessed.
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat.js";
import type { Region } from "../../../src/shared/regions.js";
import { dateRange, seasonLabel } from "../../../src/shared/format.js";
import { EVENT_TYPES } from "../../../src/shared/searchEventQuery.js";
import { all, get } from "../../db.js";
import { OFFICIAL_TYPES } from "../answers/clauses.js";
import { matchHref, shortEvent, teamLinks } from "../answers/matchSet.js";

export type MatchMeasure = "high" | "low" | "closest" | "lopsided" | "penalties" | "upset" | "comeback";

export interface MatchFind {
  measure: MatchMeasure;
  season: number;
  window?: { from: string; to: string; label: string };
  region: Region | null;
  level: "qual" | "playoff" | null;
  /** The finals only (labels "F1", "Final 2"). */
  finals: boolean;
  /** FIRST event types ("LeagueMeet"), with the words for them; none: every official event. */
  kind: { types: string[]; label: string } | null;
  /** How many to list; the first is the answer. */
  n: number;
}

/** A kind of event said by its words alone ("league meet", "qualifiers"): its FIRST types, or null. */
export function eventKindOf(words: string): MatchFind["kind"] {
  const ws = words.split(" ").map((w) => w.replace(/s$/, ""));
  if (!ws.length || !ws.every((w) => Object.hasOwn(EVENT_TYPES, w))) return null;
  const sets = ws.map((w) => EVENT_TYPES[w]).filter((t): t is string[] => !!t);
  if (!sets.length) return null;
  const both = sets.reduce((a, b) => a.filter((t) => b.includes(t)));
  const types = (both.length ? both : [...new Set(sets.flat())]).filter((t) => (OFFICIAL_TYPES as readonly string[]).includes(t));
  if (!types.length) return null;
  const label = KIND_LABEL[types.join(",")] ?? `${words.replace(/^./, (c) => c.toUpperCase())}${/s$/.test(words) ? "" : "s"}`;
  return { types, label };
}
const KIND_LABEL: Record<string, string> = {
  LeagueMeet: "League meets", LeagueTournament: "League tournaments", "LeagueMeet,LeagueTournament": "League events", Qualifier: "Qualifiers",
  "Qualifier,SuperQualifier": "Qualifiers", Championship: "Championships", "Championship,FIRSTChampionship": "Championships", Premier: "Premier events",
};

/** Each measure: its value per match (SQL over m, e), the order, and how it reads. */
interface Measure { value: string; order: "ASC" | "DESC"; title: string; plural: string; column: string; rule: string; show: (v: number) => string }
const NP = "MAX(m.red_np, m.blue_np)";
const MARGIN = "ABS(m.red_total - m.blue_total)";
/** The losing alliance's chance before the match: the engine's call saved live, else its replayed one. */
const CHANCE = (side: "red" | "blue") => {
  const p = (kind: string) => `(SELECT p.p_red FROM predictions p WHERE p.kind = '${kind}' AND p.season = m.season AND p.code = m.code AND p.level = m.level AND p.series = m.series AND p.number = m.number)`;
  const red = `COALESCE(${p("live")}, ${p("backtest")})`;
  return side === "red" ? red : `(1 - ${red})`;
};
/** An alliance's summed season prediction ratings (the upset rule's fallback when no call was saved). */
const RATING = (side: "red" | "blue") => `(SELECT SUM(s.rating_np) FROM match_teams x JOIN team_season_stats s ON s.season = x.season AND s.team = x.team
  WHERE x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number AND x.alliance = '${side}' AND x.on_field = 1)`;
const MEASURES: Record<MatchMeasure, Measure> = {
  high: { value: NP, order: "DESC", title: "Highest-scoring match", plural: "Highest-scoring matches", column: "Score",
    rule: "a match's score is its higher alliance's points without penalties; the highest first.", show: (v) => `${v} points` },
  low: { value: NP, order: "ASC", title: "Lowest-scoring match", plural: "Lowest-scoring matches", column: "Score",
    rule: "a match's score is its higher alliance's points without penalties (the winning side's, so a no-show alliance's zero never decides it); the lowest first.", show: (v) => `${v} points` },
  closest: { value: MARGIN, order: "ASC", title: "Closest match", plural: "Closest matches", column: "Margin",
    rule: "the margin is the difference between the two alliances' final scores, penalties included (as the result was decided); the smallest first, a tie being the closest.", show: (v) => (v === 0 ? "Tie" : `${v}-point margin`) },
  lopsided: { value: MARGIN, order: "DESC", title: "Most lopsided match", plural: "Most lopsided matches", column: "Margin",
    rule: "the margin is the difference between the two alliances' final scores, penalties included; the largest first.", show: (v) => `${v}-point margin` },
  penalties: { value: "ABS(m.red_total - m.red_np) + ABS(m.blue_total - m.blue_np)", order: "DESC", title: "Match with the most penalty points", plural: "Matches with the most penalty points", column: "Penalty points",
    rule: "a match's penalty points are both alliances' final scores less their points without penalties, added together; the most first.", show: (v) => `${v} penalty points` },
  upset: { value: `CASE WHEN m.red_total > m.blue_total THEN ${CHANCE("blue")} WHEN m.blue_total > m.red_total THEN ${CHANCE("red")} END`, order: "DESC", title: "Biggest upset", plural: "Biggest upsets", column: "Favourite's chance",
    rule: "an upset is a match the favourite lost; the biggest is the one whose losing alliance had the highest predicted chance to win before it was played (the engine's call saved before the match, else its replay with only earlier matches). A tie is never an upset.", show: (v) => `${Math.round(v * 100)}% favourite lost` },
  comeback: { value: "CASE WHEN m.red_total > m.blue_total AND m.red_auto < m.blue_auto THEN m.blue_auto - m.red_auto WHEN m.blue_total > m.red_total AND m.blue_auto < m.red_auto THEN m.red_auto - m.blue_auto END", order: "DESC", title: "Biggest comeback", plural: "Biggest comebacks", column: "Behind after auto",
    rule: "a comeback is a match won by the alliance that was behind after the autonomous period (fewer auto points); the biggest is the one it was furthest behind in.", show: (v) => `Won after trailing by ${v} after auto` },
};
/** The upset rule's fallback, when the matches have no saved call: the larger summed season rating that lost. */
const UPSET_BY_RATING = `CASE WHEN m.red_total > m.blue_total THEN ${RATING("blue")} - ${RATING("red")} WHEN m.blue_total > m.red_total THEN ${RATING("red")} - ${RATING("blue")} END`;

interface Row { season: number; code: string; level: string; series: number; number: number; label: string; time: string | null; name: string; type: string | null; start: string | null; red_total: number; blue_total: number; v: number }

/** The matches' filters as SQL over m and e. */
function where(f: MatchFind) {
  const types = f.kind?.types ?? [...OFFICIAL_TYPES];
  const sql = [`m.season = ? AND m.played = 1 AND m.red_np IS NOT NULL AND m.blue_np IS NOT NULL AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL
    AND COALESCE(e.remote, 0) = 0 AND e.type IN (${types.map(() => "?").join(", ")})`];
  const args: (string | number)[] = [f.season, ...types];
  if (f.region) { sql.push(f.region.state ? "e.country = ? AND e.state = ?" : "e.country = ?"); args.push(f.region.country, ...(f.region.state ? [f.region.state] : [])); }
  if (f.window) { sql.push("substr(COALESCE(m.time, e.start), 1, 10) BETWEEN ? AND ?"); args.push(f.window.from, f.window.to); }
  if (f.level) { sql.push("m.level = ?"); args.push(f.level); }
  if (f.finals) sql.push("m.level = 'playoff' AND m.label LIKE 'F%'");
  return { sql: sql.join(" AND "), args };
}

const FROM = "FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code";

/** The answer: the first match by the measure, the next few under it, every filter on the card. */
export async function matchFindAnswer(f: MatchFind): Promise<StatAnswer> {
  const ms = MEASURES[f.measure];
  const w = where(f);
  const ranked = async (value: string) => {
    const [rows, count] = await Promise.all([
      all<Row>(`SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, e.name, e.type, e.start, m.red_total, m.blue_total, ${value} v
        ${FROM} WHERE ${w.sql} AND ${value} IS NOT NULL ORDER BY v ${ms.order}, ${NP} DESC, e.start, m.code, m.label LIMIT ?`, [...w.args, f.n]),
      get<{ n: number }>(`SELECT COUNT(*) n ${FROM} WHERE ${w.sql}`, w.args),
    ]);
    return { rows, count: Number(count?.n ?? 0) };
  };
  let { rows, count } = await ranked(ms.value);
  let rule = ms.rule, show = ms.show, column = ms.column;
  // No saved call for these matches: the upset is the largest rating gap that lost, said so.
  if (f.measure === "upset" && !rows.length && count) {
    ({ rows, count } = await ranked(UPSET_BY_RATING));
    rule = "an upset is a match the favourite lost; with no predicted chance saved for these matches, the favourite is the alliance with the larger summed season prediction rating, and the biggest upset the largest such gap that lost. A tie is never an upset.";
    show = (v) => `Favourite by ${v.toFixed(1)} rating lost`;
    column = "Rating gap";
  }
  const place = f.region?.name ?? null;
  const filters = [f.finals ? "finals" : f.level === "qual" ? "qualification" : f.level === "playoff" ? "playoff" : null].filter(Boolean)[0];
  const many = f.n > 1 && !rows.length ? false : f.n > 1;
  const typed = [f.kind ? `at ${f.kind.label.toLowerCase()}` : null, place ? `in ${place}` : null, f.window ? f.window.label : null].filter(Boolean).join(" ");
  const title = `${(filters ? `${ms.title.replace(/match/, `${filters} match`)}` : ms.title)}${typed ? ` ${typed}` : ""}, ${seasonLabel(f.season)}`;
  const scope = [seasonLabel(f.season), ...(place ? [place] : []), ...(f.window ? [f.window.label.replace(/^./, (c) => c.toUpperCase())] : []),
    ...(f.finals ? ["Finals"] : f.level === "qual" ? ["Qualification matches"] : f.level === "playoff" ? ["Playoff matches"] : []), ...(f.kind ? [f.kind.label] : []), "Official events"];
  const definition = `${rule.replace(/^./, (c) => c.toUpperCase())} Only played matches at official events held in person, with both alliances' points on record.`;
  const where2 = `${place ? ` in ${place}` : ""}${f.kind ? ` at ${f.kind.label.toLowerCase()}` : ""}${f.window ? ` ${f.window.label}` : ` in ${seasonLabel(f.season)}`}`;
  const base = { family: "superlative" as const, intent: `find-${f.measure}`, title, scope, definition, source: `From ${count.toLocaleString("en-US")} played match${count === 1 ? "" : "es"}${where2}` };
  if (!rows.length) {
    const none = count ? `None of the ${count.toLocaleString("en-US")} played match${count === 1 ? "" : "es"}${where2} is one: ${rule.replace(/;.*$/, "")}.` : `No played matches at official events${filters ? ` (${filters})` : ""}${where2} yet.`;
    return { ...base, blocks: [], none };
  }
  const ups = await all<{ season: number; code: string; level: string; series: number; number: number; alliance: string; team: number }>(
    `SELECT season, code, level, series, number, alliance, team FROM match_teams WHERE on_field = 1 AND (${rows.map(() => "(season = ? AND code = ? AND level = ? AND series = ? AND number = ?)").join(" OR ")}) ORDER BY station, team`,
    rows.flatMap((r) => [r.season, r.code, r.level, r.series, r.number]));
  const links = await teamLinks(ups.map((u) => Number(u.team)));
  const side = (r: Row, s: string) => ups.filter((u) => u.season === r.season && u.code === r.code && u.level === r.level && u.series === r.series && u.number === r.number && u.alliance === s).map((u) => links.get(Number(u.team))?.label ?? String(u.team)).join(", ");
  const top = rows[0];
  const blocks: StatBlock[] = [{
    kind: "table", title: many ? ms.plural : `${ms.plural}, the first ${rows.length}`,
    columns: [{ key: "rank", label: "#", num: true }, { key: "value", label: column }, { key: "score", label: "Red–Blue" }, { key: "match", label: "Match" }, { key: "event", label: "Event" }, { key: "date", label: "Date" }],
    rows: rows.map((r, i) => ({ cells: { rank: i + 1, value: show(Number(r.v)), score: `${r.red_total}–${r.blue_total}`, match: r.label, event: shortEvent(r.name, r.type), date: dateRange((r.time ?? r.start)?.slice(0, 10) ?? null) }, href: matchHref(r), strong: i === 0 })),
  }];
  return {
    ...base, blocks,
    headline: {
      value: show(Number(top.v)), label: `${top.label} at ${shortEvent(top.name, top.type)}`, href: matchHref(top),
      sub: [dateRange((top.time ?? top.start)?.slice(0, 10) ?? null), `Red ${top.red_total} (${side(top, "red")}) – Blue ${top.blue_total} (${side(top, "blue")})`].filter(Boolean).join(" · "),
    },
  };
}
