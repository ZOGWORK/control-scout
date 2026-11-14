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
import { BRACKETS } from "@control-scout/predict-engine";
import { DOUBLE_ELIM_FROM } from "../../../src/shared/bracketOdds.js";
import { matchHref, shortEvent, teamLinks } from "../answers/matchSet.js";
import { markedLabel, unofficialLine } from "../../data/unofficialRecords.js";
import { seasonClipKeys } from "../../videos/recordings.js";

export type MatchMeasure = "high" | "low" | "closest" | "lopsided" | "penalties" | "upset" | "comeback" | "miss" | "accurate" | "loss-high";

/** A score an alliance had to reach ("where the losing alliance scored over 200", "both alliances scored over 250"):
 *  `side` is whose final score (penalties included, as the result was decided) is held to it. The losing or winning
 *  alliance's needs a decided match. Both alliances over a number is the lower score over it, under one the higher
 *  score under it; either alliance the other way round. */
export interface ScoreCond { side: "losing" | "winning" | "both" | "either"; op: ">" | ">=" | "<" | "<=" | "="; n: number }
const LOW = "MIN(m.red_total, m.blue_total)", HIGH = "MAX(m.red_total, m.blue_total)";
/** The score a condition holds to its number. */
export function condValue(c: ScoreCond): string {
  const upper = c.op === "<" || c.op === "<=";
  return c.side === "losing" ? LOW : c.side === "winning" ? HIGH : (c.side === "both") === upper ? HIGH : LOW;
}
const OP_WORDS: Record<ScoreCond["op"], string> = { ">": "over", ">=": "at least", "<": "under", "<=": "at most", "=": "exactly" };
/** The condition in words: "the losing alliance scored over 200". */
export function condWords(c: ScoreCond): string {
  const who = c.side === "both" ? "both alliances" : c.side === "either" ? "an alliance" : `the ${c.side} alliance`;
  return `${who} scored ${OP_WORDS[c.op]} ${c.n}`;
}

export interface MatchFind {
  measure: MatchMeasure;
  season: number;
  window?: { from: string; to: string; label: string };
  region: Region | null;
  level: "qual" | "playoff" | null;
  /** The finals only: a classic bracket's "F" series, a double-elimination bracket's grand final and its replay. */
  finals: boolean;
  /** A win or a loss said ("closest win"): decided matches only, never a tie. */
  decided?: boolean;
  /** FIRST event types ("LeagueMeet"), with the words for them; none: every official event. */
  kind: { types: string[]; label: string } | null;
  /** How many to list; the first is the answer. */
  n: number;
  /** A list asked for ("closest matches", "top 5"): the ranked table alone. Else the first is the headline and the
   *  rest a table after it. */
  list?: boolean;
  /** These events only (one named with a score to reach), official or not. */
  events?: { season: number; code: string; name?: string }[];
  named?: boolean;
  /** Only matches with video to play ("with video"): FIRST's own video, or a clip in the event's recording. */
  video?: boolean;
  /** Those matches' keys ("season|code|level|series|number"), read by matchFindAnswer before its query (where). */
  videoKeys?: string[];
  /** A score an alliance had to reach. */
  cond?: ScoreCond;
  /** One team's matches only (the prediction measures: "<team>'s most unpredictable match"). */
  team?: { number: number; name: string | null };
  /** Only matches whose value is over this ("missed by more than 50 points"), or this or more ("at least 50 points"). */
  over?: { n: number; atLeast: boolean };
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
export const NP = "MAX(m.red_np, m.blue_np)";
export const MARGIN = "ABS(m.red_total - m.blue_total)";
/** The losing alliance's chance before the match: the engine's call saved live, else its replayed one. */
const CHANCE = (side: "red" | "blue") => {
  const p = (kind: string) => `(SELECT p.p_red FROM predictions p WHERE p.kind = '${kind}' AND p.season = m.season AND p.code = m.code AND p.level = m.level AND p.series = m.series AND p.number = m.number)`;
  const red = `COALESCE(${p("live")}, ${p("backtest")})`;
  return side === "red" ? red : `(1 - ${red})`;
};
/** How far the engine's predicted margin (red less blue) was from the real one, like with like as the ledger's accuracy
 *  figures measure it (./accuracy.ts callMargin): the predicted scores carry the penalties each side is expected to
 *  draw, so the real margin is the final scores', penalties included. Its call saved live before the match, else its
 *  replay with only earlier matches; a call with no score basis is left out. */
const MISS = `ABS((SELECT p.red_mean - p.blue_mean FROM predictions p WHERE p.season = m.season AND p.code = m.code AND p.level = m.level AND p.series = m.series AND p.number = m.number
  AND p.kind IN ('live', 'backtest') AND p.no_score_basis = 0 ORDER BY p.kind = 'live' DESC LIMIT 1) - (m.red_total - m.blue_total))`;
const MISS_RULE = "a prediction's miss is how far the engine's predicted margin (red less blue, with the penalties each side was expected to draw) was from the final margin, penalties included, as the accuracy page measures it: the call saved before the match, else its replay with only earlier matches";
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
  upset: { value: `CASE WHEN m.red_total > m.blue_total AND ${CHANCE("blue")} > 0.5 THEN ${CHANCE("blue")} WHEN m.blue_total > m.red_total AND ${CHANCE("red")} > 0.5 THEN ${CHANCE("red")} END`, order: "DESC", title: "Biggest upset", plural: "Biggest upsets", column: "Favourite's chance",
    rule: "an upset is a match the favourite lost: its losing alliance had over a 50% predicted chance to win before it was played (the engine's call saved before the match, else its replay with only earlier matches); the biggest is the one with the highest such chance. A tie is never an upset.", show: (v) => `${v > 0.99 ? ">99" : Math.round(v * 100)}% favourite lost` },
  comeback: { value: "CASE WHEN m.red_total > m.blue_total AND m.red_auto < m.blue_auto THEN m.blue_auto - m.red_auto WHEN m.blue_total > m.red_total AND m.blue_auto < m.red_auto THEN m.red_auto - m.blue_auto END", order: "DESC", title: "Biggest comeback", plural: "Biggest comebacks", column: "Behind after auto",
    rule: "a comeback is a match won by the alliance that was behind after the autonomous period (fewer auto points); the biggest is the one it was furthest behind in.", show: (v) => `Won after trailing by ${v} after auto` },
  miss: { value: MISS, order: "DESC", title: "Biggest prediction miss", plural: "Biggest prediction misses", column: "Off by", rule: `${MISS_RULE}; the furthest off first.`, show: (v) => `Off by ${Math.round(v)} points` },
  "loss-high": { value: "CASE WHEN m.red_total < m.blue_total THEN m.red_np WHEN m.blue_total < m.red_total THEN m.blue_np END", order: "DESC", title: "Highest score in a lost match", plural: "Highest scores in lost matches", column: "Losing score",
    rule: "a lost match's score is the losing alliance's points without penalties, the result decided by the final scores, penalties included; the highest first. A tie is never a loss.", show: (v) => `${v} points, and lost` },
  accurate: { value: MISS, order: "ASC", title: "Most accurate prediction", plural: "Most accurate predictions", column: "Off by", rule: `${MISS_RULE}; the closest first.`, show: (v) => (Math.round(v) === 0 ? "Margin called exactly" : `Off by ${Math.round(v)} points`) },
};
/** The upset rule's fallback, when the matches have no saved call: the larger summed season rating that lost. */
const UPSET_BY_RATING = `CASE WHEN m.red_total > m.blue_total AND ${RATING("blue")} > ${RATING("red")} THEN ${RATING("blue")} - ${RATING("red")}
  WHEN m.blue_total > m.red_total AND ${RATING("red")} > ${RATING("blue")} THEN ${RATING("red")} - ${RATING("blue")} END`;

/** A final: a classic bracket's "F" series, or a double-elimination bracket's grand final and its if-needed replay,
 *  by the event's bracket (its alliance count in the engine's BRACKETS, the grand final its last match). */
const FINAL = (() => {
  // The bracket is the event's own (its alliance count), never guessed from how far its posted matches reach.
  const alliances = `(SELECT COUNT(*) FROM alliances a WHERE a.season = m.season AND a.code = m.code)`;
  // A match's place in the bracket, counted from the event's first playoff series whatever its label (a bracket
  // numbered from 0 posts its opening match as "F1").
  const at = `(m.series - (SELECT MIN(x.series) FROM matches x WHERE x.season = m.season AND x.code = m.code AND x.level = 'playoff') + 1)`;
  const isDouble = `(m.season >= ${DOUBLE_ELIM_FROM} AND ${alliances} IN (${Object.keys(BRACKETS).map(Number).join(", ")}))`;
  const double = Object.entries(BRACKETS).map(([n, b]) => `(${alliances} = ${Number(n)} AND ${at} IN (${b.matches.length}, ${b.matches.length + 1}))`).join(" OR ");
  // A double-elimination bracket's final is its last match (and the replay); only a classic bracket's is its "F" series.
  return `m.level = 'playoff' AND ((NOT ${isDouble} AND m.label LIKE 'F%') OR (${isDouble} AND (${double})))`;
})();

interface Row { season: number; code: string; level: string; series: number; number: number; label: string; time: string | null; name: string; type: string | null; start: string | null; red_total: number; blue_total: number; v: number }

/** The filters the match finder and a scope's highlights (./highlights.ts) take. `events`: these events only (a
 *  division is an event of its own: ./highlights.ts scopeEvents lists them). */
export type MatchScope = Pick<MatchFind, "season" | "window" | "region" | "level" | "finals" | "decided" | "kind" | "cond" | "team" | "video" | "videoKeys"> & { events?: { season: number; code: string }[];
  /** `events` were named by the query and one isn't official (an off-season event): theirs are the matches all the same. */
  named?: boolean };

/** The matches' filters as SQL over m and e; `upTo`, every season up to the scope's (its latest with matches). */
export function where(f: MatchScope, upTo = false) {
  const types = f.kind?.types ?? (f.named && f.events ? null : [...OFFICIAL_TYPES]);
  // A date window is its own range: a week across the season's start (Aug 31 to Sep 6) holds both seasons' matches.
  const sql = [`${f.window ? "" : `m.season ${upTo ? "<=" : "="} ? AND `}m.played = 1 AND m.red_np IS NOT NULL AND m.blue_np IS NOT NULL AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL
    AND COALESCE(e.remote, 0) = 0${types ? ` AND e.type IN (${types.map(() => "?").join(", ")})` : ""}`];
  const args: (string | number)[] = [...(f.window ? [] : [f.season]), ...(types ?? [])];
  if (f.region) { sql.push(f.region.state ? "e.country = ? AND e.state = ?" : "e.country = ?"); args.push(f.region.country, ...(f.region.state ? [f.region.state] : [])); }
  if (f.window) { sql.push("substr(COALESCE(m.time, e.start), 1, 10) BETWEEN ? AND ?"); args.push(f.window.from, f.window.to); }
  if (f.level) { sql.push("m.level = ?"); args.push(f.level); }
  if (f.finals) sql.push(FINAL);
  if (f.decided || f.cond?.side === "losing" || f.cond?.side === "winning") sql.push("m.red_total <> m.blue_total");
  // A score said outright ("a 226 point match"): either alliance's final score is that number.
  if (f.cond?.op === "=") { sql.push("(m.red_total = ? OR m.blue_total = ?)"); args.push(f.cond.n, f.cond.n); }
  else if (f.cond) { sql.push(`${condValue(f.cond)} ${f.cond.op} ?`); args.push(f.cond.n); }
  // With video: the keys read for the scope's seasons (server/videos/recordings.ts seasonClipKeys); none read, none.
  if (f.video) {
    sql.push("(m.season || '|' || m.code || '|' || m.level || '|' || m.series || '|' || m.number) IN (SELECT value FROM json_each(?))");
    args.push(JSON.stringify(f.videoKeys ?? []));
  }
  if (f.team) {
    sql.push("EXISTS (SELECT 1 FROM match_teams x WHERE x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number AND x.on_field = 1 AND x.team = ?)");
    args.push(f.team.number);
  }
  if (f.events) {
    // By season, as the matches' key reads them.
    const by = new Map<number, string[]>();
    for (const e of f.events) by.set(e.season, [...(by.get(e.season) ?? []), e.code]);
    sql.push(by.size ? `(${[...by].map(([, cs]) => `(m.season = ? AND m.code IN (${cs.map(() => "?").join(", ")}))`).join(" OR ")})` : "0");
    args.push(...[...by].flatMap(([s, cs]) => [s, ...cs]));
  }
  return { sql: sql.join(" AND "), args };
}

/** The first season with match video on record (FIRST's per-match videos and event recordings start here). */
const FIRST_VIDEO_SEASON = 2019;

/** The keys of the matches with video in the scope's seasons: its own, a window's either side of it, its events'. */
export async function videoKeys(f: Pick<MatchFind, "season" | "window" | "events">, upTo = false): Promise<string[]> {
  const seasons = new Set<number>([f.season, ...(f.events ?? []).map((e) => e.season)]);
  // Every season up to the scope's (where's `upTo`): the seasons a search for the latest one with a match reaches.
  if (upTo) for (let s = f.season - 1; s >= FIRST_VIDEO_SEASON; s--) seasons.add(s);
  if (f.window) for (const s of [f.season - 1, f.season + 1]) seasons.add(s);
  const sets = await Promise.all([...seasons].map(async (s) => [s, await seasonClipKeys(s)] as const));
  return sets.flatMap(([s, keys]) => [...keys].map((k) => `${s}|${k}`));
}

export const FROM = "FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code";

/** The answer: the first match by the measure, the next few under it, every filter on the card. */
export async function matchFindAnswer(f: MatchFind): Promise<StatAnswer> {
  if (f.video && !f.videoKeys) f = { ...f, videoKeys: await videoKeys(f) };
  const ms = MEASURES[f.measure];
  const w = where(f);
  const ranked = async (value: string) => {
    const [rows, count] = await Promise.all([
      all<Row>(`SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, e.name, e.type, e.start, m.red_total, m.blue_total, ${value} v
        ${FROM} WHERE ${w.sql} AND ${value} IS NOT NULL${f.over ? ` AND ${value} ${f.over.atLeast ? ">=" : ">"} ?` : ""} ORDER BY v ${ms.order}, ${NP} DESC, e.start, m.code, m.label LIMIT ?`, [...w.args, ...(f.over ? [f.over.n] : []), f.n]),
      get<{ n: number }>(`SELECT COUNT(*) n ${FROM} WHERE ${w.sql}`, w.args),
    ]);
    return { rows, count: Number(count?.n ?? 0) };
  };
  let { rows, count } = await ranked(ms.value);
  let rule = ms.rule, show = ms.show, column = ms.column;
  // No saved call for any of these matches: the upset is the largest rating gap that lost, said so. Calls saved
  // with none of them an upset is no upsets, never a guess from the ratings.
  const called = f.measure === "upset" && !rows.length && count ? Number((await get<{ n: number }>(`SELECT COUNT(*) n ${FROM} WHERE ${w.sql} AND ${CHANCE("red")} IS NOT NULL`, w.args))?.n ?? 0) : 0;
  if (f.measure === "upset" && !rows.length && count && !called) {
    ({ rows, count } = await ranked(UPSET_BY_RATING));
    rule = "an upset is a match the favourite lost; with no predicted chance saved for these matches, the favourite is the alliance with the larger summed season prediction rating, and the biggest upset the largest such gap that lost. A tie is never an upset.";
    show = (v) => `Favourite by ${v.toFixed(1)} rating lost`;
    column = "Rating gap";
  }
  // A score said outright ("<team> 226 point match"): the matches with it, titled by it, each row its own score.
  const exact = f.cond?.op === "=" ? f.cond.n : null;
  if (exact != null) {
    rule = `a match with a ${exact}-point score is one where either alliance's final score, penalties included, was ${exact}; the highest-scoring of them first.`;
    show = () => `${exact} points`;
    column = "Score";
  }
  const place = f.region?.name ?? null;
  const filters = [f.finals ? "finals" : f.level === "qual" ? "qualification" : f.level === "playoff" ? "playoff" : null].filter(Boolean)[0];
  // An event named: its name in the card's season, as that season held it.
  const eventName = f.events?.find((e) => e.season === f.season && e.name)?.name ?? null;
  const who = f.team ? (f.team.name ? `${f.team.name} (${f.team.number})` : `Team ${f.team.number}`) : null;
  const over = f.over ? `Off by ${f.over.atLeast ? `${f.over.n} points or more` : `more than ${f.over.n} points`}` : null;
  const typed = [who ? `for ${who}` : null, eventName ? `at ${eventName}` : null, f.kind ? `at ${f.kind.label.toLowerCase()}` : null, place ? `in ${place}` : null, f.window ? f.window.label : null, f.cond && exact == null ? `where ${condWords(f.cond)}` : null, f.video ? "with video" : null].filter(Boolean).join(" ");
  // A list asked for is titled as one ("Biggest upsets in California"), its table under no heading of its own.
  const head = exact != null ? `${exact}-point match${f.list || rows.length > 1 ? "es" : ""}` : over ? `Predictions ${over.toLowerCase()}` : f.list ? ms.plural : ms.title;
  const title = `${(filters ? `${head.replace(/match/, `${filters} match`)}` : head)}${typed ? ` ${typed}` : ""}, ${seasonLabel(f.season)}`;
  const scope = [seasonLabel(f.season), ...(place ? [place] : []), ...(f.window ? [f.window.label.replace(/^./, (c) => c.toUpperCase())] : []),
    ...(f.finals ? ["Finals"] : f.level === "qual" ? ["Qualification matches"] : f.level === "playoff" ? ["Playoff matches"] : []), ...(f.kind ? [f.kind.label] : []), ...(f.cond ? [condWords(f.cond).replace(/^./, (c) => c.toUpperCase())] : []), ...(f.decided ? ["No ties"] : []), ...(over ? [over] : []), ...(f.video ? ["With video"] : []), ...(f.named ? [] : ["Official events"])];
  // An off-season event named is its own matches: never called official.
  const at = f.named ? "at the event named" : "at official events";
  const definition = `${rule.replace(/^./, (c) => c.toUpperCase())} Only played matches ${at} held in person, with both alliances' points on record.${f.video ? " With video: FIRST's own video of the match, or its place in the event's recording (the same clip its Play button plays)." : ""}`;
  const where2 = `${who ? ` with ${who}` : ""}${place ? ` in ${place}` : ""}${f.kind ? ` at ${f.kind.label.toLowerCase()}` : ""}${f.window ? ` ${f.window.label}` : ` in ${seasonLabel(f.season)}`}${f.cond ? ` where ${condWords(f.cond)}` : ""}${f.video ? " with video" : ""}`;
  const base = { family: "superlative" as const, intent: `find-${f.measure}`, title, scope, definition, ...(f.team ? { team: f.team } : {}), source: `From ${count.toLocaleString("en-US")} played match${count === 1 ? "" : "es"}${where2}` };
  if (!rows.length) {
    const none = count && over ? `No prediction for the ${count.toLocaleString("en-US")} played match${count === 1 ? "" : "es"}${where2} was off by ${f.over!.atLeast ? `${f.over!.n} points or more` : `more than ${f.over!.n} points`}.`
      : count ? `None of the ${count.toLocaleString("en-US")} played match${count === 1 ? "" : "es"}${where2} is one: ${rule.replace(/;.*$/, "")}.` : `No played matches${f.named ? "" : " at official events"}${filters ? ` (${filters})` : ""}${where2} yet.`;
    return { ...base, blocks: [], none };
  }
  const ups = await all<{ season: number; code: string; level: string; series: number; number: number; alliance: string; team: number }>(
    `SELECT season, code, level, series, number, alliance, team FROM match_teams WHERE on_field = 1 AND (${rows.map(() => "(season = ? AND code = ? AND level = ? AND series = ? AND number = ?)").join(" OR ")}) ORDER BY station, team`,
    rows.flatMap((r) => [r.season, r.code, r.level, r.series, r.number]));
  const links = await teamLinks(ups.map((u) => Number(u.team)));
  const side = (r: Row, s: string) => ups.filter((u) => u.season === r.season && u.code === r.code && u.level === r.level && u.series === r.series && u.number === r.number && u.alliance === s).map((u) => links.get(Number(u.team))?.label ?? String(u.team)).join(", ");
  const top = rows[0];
  // Each match printed once (the results guide): a list asked for is its ranked table alone; else the first is the
  // headline and the ones after it a table, ranked from 2.
  const table = (rs: Row[], from: number, title: string): StatBlock => ({
    kind: "table", title,
    columns: [{ key: "rank", label: "#", num: true }, { key: "value", label: column }, { key: "score", label: "Red–Blue" }, { key: "match", label: "Match" }, { key: "event", label: "Event" }, { key: "date", label: "Date" }],
    rows: rs.map((r, i) => ({ cells: { rank: from + i, value: show(Number(r.v)), score: `${r.red_total}–${r.blue_total}`, match: markedLabel(r), event: shortEvent(r.name, r.type), date: dateRange((r.time ?? r.start)?.slice(0, 10) ?? null) }, href: matchHref(r) })),
  });
  if (f.list) return { ...base, blocks: [table(rows, 1, "")] };
  return {
    ...base, blocks: rows.length > 1 ? [table(rows.slice(1), 2, `The next ${rows.length - 1}`)] : [],
    headline: {
      value: show(Number(top.v)), href: matchHref(top),
      // A lost match's answer is who lost it: the losing alliance's teams lead.
      label: `${f.measure === "loss-high" ? `${side(top, top.red_total < top.blue_total ? "red" : "blue")} lost ` : ""}${top.label} at ${shortEvent(top.name, top.type)}`,
      sub: [unofficialLine(top) ?? "", dateRange((top.time ?? top.start)?.slice(0, 10) ?? null), `Red ${top.red_total} (${side(top, "red")}) – Blue ${top.blue_total} (${side(top, "blue")})`].filter(Boolean).join(" · "),
    },
  };
}
