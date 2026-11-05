// A season's highest-scoring matches, no team: "highest scoring games in decode", "top scores this season", "highest
// score in new jersey", "highest scoring matches at the new jersey championship", "highest scoring match ever". The top
// alliance scores (each the alliance's own points without penalties, as the season records count them) and the top
// combined scores (both alliances), from official events only, with both alliances' teams, the event, the date and a
// link to each match. Each season is a different game, so "ever" lists each season's best apart, never one record.
import type { StatAnswer, StatBlock, StatMatchRow } from "../../../../src/shared/searchStat.js";
import type { Region } from "../../../../src/shared/regions.js";
import { dateRange, seasonLabel } from "../../../../src/shared/format.js";
import { regionOf } from "../../../../src/shared/searchEventQuery.js";
import { all, get } from "../../../db.js";
import { SEASONS, gameOf as gameOfSeason, ownScorePenalties, reportedTeleopIncludesEndgame } from "../../../data/seasons.js";
import { parseHighScore } from "../../searchHighScores.js";
import { OFFICIAL_TYPES } from "../clauses.js";
import { eventHref, matchHref, shortEvent, teamLinks } from "../matchSet.js";

/** How many matches each list shows. */
export const TOP_MATCHES = 10;

export interface TopMatchesQuestion {
  season: number | null;
  game: string | null;
  /** "ever", "all time": each season's best, apart. */
  ever: boolean;
  region: Region | null;
  /** "at <event>": the words naming the event (found by search). */
  event: string | null;
  /** "highest auto score": one period's points ranked (absent: the alliance's points without penalties). */
  phase?: Phase | null;
  /** "without penalties" said: the title says so (an alliance score is always ranked without them). */
  noPenalties?: boolean;
}

export type Phase = "auto" | "teleop" | "endgame";
const PHASE_LABEL: Record<Phase, string> = { auto: "Auto", teleop: "Teleop", endgame: "Endgame" };
/** A period's words before a score ("highest auto score", "top endgame scores"). */
const PHASE_SAID = /\b(auto(?:nomous)?|tele[\s-]?op|driver[\s-]controlled|end[\s-]?game)\s+(?=(?:match\s+|alliance\s+)?(?:scores?|scoring|points)\b)/;
const phaseOf = (w: string): Phase => (/^auto/.test(w) ? "auto" : /^end/.test(w) ? "endgame" : "teleop");
/** Penalties taken off, said any way ("without penalties", "no fouls", "excluding penalty points"). */
const NO_PENALTIES = /\b(?:without|no|minus|excluding|excl|not\s+counting|before|less)\s+(?:any\s+|the\s+)?(?:penalt(?:y|ies)|fouls?)(?:\s+points?)?\b/;

// A season-wide high score ("highest scoring games", "top scores", "highest score in decode"); a team's, or a world
// record ("world record score", the season records' own card), is not this.
const ASKED = /\b(?:highest[\s-]+scoring\s+(?:games?|match(?:es)?)|(?:highest|top|best|biggest|max(?:imum)?)\s+(?:match\s+|alliance\s+|combined\s+)?scores?)\b/;
const FILLER = /\b(?:the|in|of|for|during|all|ftc|first|tech|challenge|what|whats|which|were|was|are|is|games?|matches?|scores?|scoring|highest|top|best|ever|time|history|so|far|this|season|year|official)\b/g;

/** The question `q` asks, or null. */
export function readTopMatches(raw: string): TopMatchesQuestion | null {
  let q = ` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!.,]/g, " ")} `.replace(/\s+/g, " ");
  const noPen = NO_PENALTIES.exec(q);
  if (noPen) q = q.replace(noPen[0], " ").replace(/\s+/g, " ");
  const ph = PHASE_SAID.exec(q);
  if (ph) q = q.replace(ph[0], "");
  if (!ASKED.test(q) || /\bworld[\s-]+records?\b|\brecords?\b/.test(q)) return null;
  // "highest combined scores", "top alliance score": the same question to the high-score reader.
  const hs = parseHighScore(q.replace(/\b(highest|top|best|biggest|max(?:imum)?)\s+(?:match|alliance|combined)\s+(scores?)\b/, "$1 $2"));
  if (!hs) return null;
  const ever = /\b(?:ever|all[\s-]+time|of\s+all\s+time|in\s+history)\b/.test(q);
  let rest = ` ${hs.core} `;
  const at = /\bat\s+(.+)$/.exec(rest);
  let event = at ? at[1].trim() : null;
  if (at) rest = rest.slice(0, at.index);
  // A year inside the event's words is its season, as search reads a bare year ("at 2022 texas qualifier": 2022–23).
  let season = hs.season;
  const y = event ? /\b(20\d\d)\b/.exec(event) : null;
  if (y && season == null && SEASONS.some((x) => x.season === Number(y[1]))) { season = Number(y[1]); event = event!.replace(y[0], " ").replace(/\s+/g, " ").trim(); }
  const words = rest.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  // Words left over name a place ("in nj") or nothing; anything else (a team) is another answer's.
  // A state code is read as typed ("MA", "OR": in lower case they're words), so each word's own case is kept.
  const asTyped = raw.replace(/[?!.,]/g, " ").split(/\s+/);
  const typed = words ? words.split(" ").map((w) => asTyped.find((x) => x.toLowerCase() === w) ?? w) : [];
  // A place's whole name, its own small words kept ("in District of Columbia"), else what the filler left.
  const named = /\bin\s+((?:the\s+)?[a-z][a-z\s.]*?)\s*$/.exec(q.replace(/\b(?:ever|all[\s-]+time|of\s+all\s+time|in\s+history|this\s+(?:season|year))\b/g, " ").replace(/\s+/g, " "));
  // Only when the place explains every word left: "4215 highest score in NJ" is the team's question.
  const placeWords = named ? named[1].split(" ").filter(Boolean) : [];
  const whole = placeWords.length && words.split(" ").every((w) => placeWords.includes(w)) ? regionOf(placeWords.map((w) => asTyped.find((x) => x.toLowerCase() === w) ?? w)) : null;
  const region = words ? whole ?? regionOf(typed) : null;
  if (words && !region) return null;
  return { season, game: hs.game, ever: ever && season == null, region, event: event || null, phase: ph ? phaseOf(ph[1]) : null, noPenalties: !!noPen };
}

interface Row { season: number; code: string; level: string; series: number; number: number; label: string; time: string | null; name: string; type: string | null; start: string | null; end: string | null; red_total: number | null; red_np: number | null; blue_total: number | null; blue_np: number | null;
  red_auto: number | null; red_teleop: number | null; red_endgame: number | null; red_pen: number | null; blue_auto: number | null; blue_teleop: number | null; blue_endgame: number | null; blue_pen: number | null; breakdown: number | null }
const COLS = "m.season, m.code, m.level, m.series, m.number, m.label, m.time, e.name, e.type, e.start, e.end, m.red_total, m.red_np, m.blue_total, m.blue_np, m.red_auto, m.red_teleop, m.red_endgame, m.red_pen, m.blue_auto, m.blue_teleop, m.blue_endgame, m.blue_pen, m.breakdown";
/** An alliance's ranked points: one period's ("auto"), else its points without penalties (its total where none are kept). */
/** TeleOp as FIRST reports it (and the team page shows it): with the endgame from 2024–25 on. */
const scoreSql = (s: "red" | "blue", phase: Phase | null, season: number) =>
  phase === "teleop" && reportedTeleopIncludesEndgame(season) ? `(m.${s}_teleop + m.${s}_endgame)` : phase ? `m.${s}_${phase}` : `COALESCE(m.${s}_np, m.${s}_total)`;
/** A match FIRST posted as totals only (`breakdown` 0): its Auto is reported, its TeleOp/Endgame split estimated. */
const estimated = (r: Row) => r.breakdown != null && Number(r.breakdown) === 0;
/** An alliance's reported points by period (TeleOp as reported) and the penalty points it gave away; an estimated
 *  split's TeleOp and Endgame left out. */
const phasesOf = (r: Row, s: "red" | "blue"): StatMatchRow["phases"] => {
  const [a, t, e, pen] = [r[`${s}_auto`], r[`${s}_teleop`], r[`${s}_endgame`], n0(r[`${s}_pen`])];
  if (a == null) return null;
  if (estimated(r) || t == null || e == null) return { auto: Number(a), pen };
  const withEnd = reportedTeleopIncludesEndgame(r.season);
  return { auto: Number(a), teleop: Number(t) + (withEnd ? Number(e) : 0), endgame: Number(e), pen, ...(withEnd ? { teleopWithEndgame: true } : {}) };
};
const np = (r: Row, side: "red" | "blue") => (side === "red" ? r.red_np ?? r.red_total : r.blue_np ?? r.blue_total) ?? 0;
const n0 = (v: number | null | undefined) => (v == null ? null : Number(v));
/** The official winner (penalties included), null on a tie. */
const winnerOf = (r: Row): "red" | "blue" | null => { const red = Number(r.red_total) || 0, blue = Number(r.blue_total) || 0; return red > blue ? "red" : blue > red ? "blue" : null; };

/** The matches' scope: official events of the season, in the place or the event asked. */
function where(season: number, region: Region | null, event: { season: number; code: string } | null, phase: Phase | null = null) {
  const sql = [`m.season = ? AND m.played = 1 AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")})`];
  // TeleOp and Endgame records only from reported splits, never a totals-only match's estimate.
  if (phase === "teleop" || phase === "endgame") sql.push("(m.breakdown IS NULL OR m.breakdown != 0)");
  const args: (string | number)[] = [season, ...OFFICIAL_TYPES];
  if (region) { sql.push("e.country = ? AND e.state = ?"); args.push(region.country, region.state); }
  if (event) { sql.push("(e.code = ? OR e.division_code = ?)"); args.push(event.code, event.code); }
  return { sql: sql.join(" AND "), args };
}

const SIDE_FROM = "FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code";
const side = (s: "red" | "blue", w: string, season: number, phase: Phase | null = null) => `SELECT ${COLS}, '${s}' side, ${scoreSql(s, phase, season)} score ${SIDE_FROM} WHERE ${w} AND ${scoreSql(s, phase, season)} IS NOT NULL`;

/** One season's best alliance score only (the "ever" table's row). */
async function bestOf(season: number, region: Region | null, event: { season: number; code: string } | null, phase: Phase | null = null) {
  const w = where(season, region, event, phase);
  // select-star: the derived table's own columns (side() names each one), not a table's.
  return (await get<Row & { side: "red" | "blue"; score: number }>(`SELECT * FROM (${side("red", w.sql, season, phase)} UNION ALL ${side("blue", w.sql, season, phase)}) ORDER BY score DESC, start, code, label LIMIT 1`, [...w.args, ...w.args])) ?? null;
}

/** The top alliance scores (each side its own row) and the top combined scores, in one season's scope. */
async function topOf(season: number, region: Region | null, event: { season: number; code: string } | null, phase: Phase | null = null) {
  const w = where(season, region, event, phase);
  const from = SIDE_FROM;
  const [alliances, combined, count] = await Promise.all([
    // select-star: the derived table's own columns (side() names each one), not a table's.
    all<Row & { side: "red" | "blue"; score: number }>(`SELECT * FROM (${side("red", w.sql, season, phase)} UNION ALL ${side("blue", w.sql, season, phase)}) ORDER BY score DESC, start, code, label LIMIT ?`, [...w.args, ...w.args, TOP_MATCHES]),
    all<Row & { score: number; score_red: number; score_blue: number }>(`SELECT ${COLS}, ${scoreSql("red", phase, season)} score_red, ${scoreSql("blue", phase, season)} score_blue, ${scoreSql("red", phase, season)} + ${scoreSql("blue", phase, season)} score ${from} WHERE ${w.sql} AND ${scoreSql("red", phase, season)} IS NOT NULL AND ${scoreSql("blue", phase, season)} IS NOT NULL ORDER BY score DESC, e.start, m.code, m.label LIMIT ?`, [...w.args, TOP_MATCHES]),
    get<{ n: number }>(`SELECT COUNT(*) n ${from} WHERE ${w.sql}`, w.args),
  ]);
  return { alliances, combined, count: Number(count?.n ?? 0) };
}

/** Each listed match's teams that played, by match and colour. */
async function lineups(rows: Row[]) {
  const out = new Map<string, number[]>();
  if (!rows.length) return out;
  const ts = await all<{ season: number; code: string; level: string; series: number; number: number; alliance: string; team: number }>(
    `SELECT season, code, level, series, number, alliance, team FROM match_teams WHERE on_field = 1 AND (${rows.map(() => "(season = ? AND code = ? AND level = ? AND series = ? AND number = ?)").join(" OR ")}) ORDER BY station, team`,
    rows.flatMap((r) => [r.season, r.code, r.level, r.series, r.number]));
  for (const t of ts) { const k = `${t.season}|${t.code}|${t.level}|${t.series}|${t.number}|${t.alliance}`; out.set(k, [...(out.get(k) ?? []), Number(t.team)]); }
  return out;
}
const keyOf = (r: Row, side: string) => `${r.season}|${r.code}|${r.level}|${r.series}|${r.number}|${side}`;

const RULE = "An alliance score is the alliance's own points without penalties (fouls the other alliance committed aren't its points), the score with penalties beside it; a combined score is both alliances' points without penalties. Only official events count (qualifiers, league play, championships, premier events), never scrimmages or off-season events.";

// 2020–21 and 2021–22 took penalties off the alliance's own score instead.
const RULE_OWN = RULE.replace("the alliance's own points without penalties (fouls the other alliance committed aren't its points), the score with penalties beside it", "the alliance's points before its own penalties (in this season penalties came off the alliance's own score), the score after them beside it");

/** The answer. Null when the event named isn't found. */
export async function topMatchesAnswer(t: TopMatchesQuestion, findEvent: (words: string, season: number | null) => Promise<{ season: number; code: string; name: string; type: string | null } | null>): Promise<StatAnswer | null> {
  const ev = t.event ? await findEvent(t.event, t.season) : null;
  if (t.event && !ev) return null;
  const place = ev ? shortEvent(ev.name, ev.type) : t.region?.name ?? null;
  const latest = async () => Number((await get<{ s: number | null }>(`SELECT MAX(m.season) s FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.played = 1 AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")})`, [...OFFICIAL_TYPES]))?.s ?? NaN);
  const season = ev?.season ?? t.season ?? await latest();
  if (!Number.isFinite(season)) return null;
  const gameOf = (s: number) => gameOfSeason(s) ?? seasonLabel(s);
  const phase = t.phase ?? null, P = phase ? PHASE_LABEL[phase] : null;
  const top = await topOf(season, t.region, ev, phase);
  const all2 = [...top.alliances, ...top.combined];
  const ups = await lineups(all2);
  const links = await teamLinks([...ups.values()].flat());
  const named = (r: Row, side: string) => (ups.get(keyOf(r, side)) ?? []).map((n) => links.get(n)!).filter(Boolean);
  const scopeWords = `${gameOf(season)} ${seasonLabel(season)}${place ? ` · ${place}` : ""}`;
  const at = place ? ` ${ev ? "at" : "in"} ${place}` : "";
  // A period asked, or penalties said: the one score ranked, named with its season's game.
  const title = phase ? `Highest ${P!.toLowerCase()} scores in ${gameOf(season)} (${seasonLabel(season)})${at}`
    : t.noPenalties ? `Highest match score in ${gameOf(season)} (${seasonLabel(season)})${at} without penalties`
    : `Highest-scoring matches${at}, ${gameOf(season)} ${seasonLabel(season)}`;
  const base = {
    family: "superlative" as const, intent: "season-top-matches", title, scope: [seasonLabel(season), ...(place ? [place] : []), "Official events"],
    definition: `${phase ? `An alliance's ${P!.toLowerCase()} score is its own points in that period${phase === "teleop" && reportedTeleopIncludesEndgame(season) ? ", with the endgame, as FIRST reports TeleOp this season" : ""} (penalties are never a period's points); a combined score is both alliances'.${phase !== "auto" ? " A match posted as totals only has no reported split and isn't counted." : ""} ` : ""}${ownScorePenalties(season) ? RULE_OWN : RULE}${t.season == null && !ev ? ` The season is ${gameOf(season)} (${seasonLabel(season)}), the latest with official matches played.` : ""}`,
    source: `From ${top.count.toLocaleString("en-US")} played match${top.count === 1 ? "" : "es"} at official events, ${scopeWords}`,
  };
  if (!top.alliances.length) return { ...base, blocks: [], none: `No played matches at official events${place ? ` in ${place}` : ""} in ${seasonLabel(season)} yet.` };
  const row = (r: Row & { side: "red" | "blue" }, i: number): StatMatchRow => {
    const other = r.side === "red" ? "blue" : "red";
    const own = Number(r.side === "red" ? r.red_total : r.blue_total) || 0, opp = Number(r.side === "red" ? r.blue_total : r.red_total) || 0;
    return {
      label: r.label, href: matchHref(r), event: { label: shortEvent(r.name, r.type), href: eventHref(r.season, r.code) }, season: seasonLabel(r.season),
      date: dateRange((r.time ?? r.start)?.slice(0, 10) ?? null) || null, alliance: r.side, own, opp, ownNp: np(r, r.side), oppNp: np(r, other), result: own > opp ? "W" : own < opp ? "L" : "T",
      partners: named(r, r.side), opponents: named(r, other), type: r.type, phases: phasesOf(r, r.side), rank: i + 1, ...(phase ? { ranked: phase } : {}),
    };
  };
  const best = top.alliances[0];
  // One list per question, a match box each (no bar chart repeating it): the alliance scores, then the combined.
  const blocks: StatBlock[] = [
    { kind: "matches", title: P ? `Top ${top.alliances.length} alliance ${P.toLowerCase()} scores` : `Top ${top.alliances.length} alliance scores`, rows: top.alliances.map(row) },
    { kind: "table", title: `Highest combined ${P ? `${P.toLowerCase()} ` : ""}scores (both alliances)`, columns: [{ key: "rank", label: "#", num: true }, { key: "combined", label: "Combined", num: true }, { key: "score", label: "Red–Blue" }, { key: "match", label: "Match" }, { key: "event", label: "Event" }, { key: "date", label: "Date" }],
      rows: top.combined.map((r, i) => ({ cells: { rank: i + 1, combined: r.score, score: phase ? `${r.score_red}–${r.score_blue}` : `${np(r, "red")}–${np(r, "blue")}`, match: r.label, event: shortEvent(r.name, r.type), date: dateRange((r.time ?? r.start)?.slice(0, 10) ?? null) },
        href: matchHref(r), eventHref: eventHref(r.season, r.code), type: r.type, teams: { red: named(r, "red"), blue: named(r, "blue") }, winner: winnerOf(r) })) },
  ];
  const bestTotal = Number(best.side === "red" ? best.red_total : best.blue_total);
  return {
    ...base, blocks,
    headline: { value: `${best.score} ${P ? `${P.toLowerCase()} ` : ""}points`, label: `${best.label} at ${shortEvent(best.name, best.type)}`, sub: [!phase && Number.isFinite(bestTotal) && bestTotal !== best.score ? `${bestTotal} with penalties` : "", seasonLabel(best.season), dateRange((best.time ?? best.start)?.slice(0, 10) ?? null)].filter(Boolean).join(" · "), href: matchHref(best), type: best.type,
      teams: named(best, best.side), alliance: best.side },
  };
}

/** "Highest scoring match ever": each season's best alliance score apart (each season is a different game), the
 *  latest season's lists in full above them. */
export async function everTopMatches(t: TopMatchesQuestion, findEvent: Parameters<typeof topMatchesAnswer>[1]): Promise<StatAnswer | null> {
  const latest = await topMatchesAnswer({ ...t, ever: false }, findEvent);
  if (!latest) return null;
  // An event named is the same event (its code) each season it was held.
  const ev = t.event ? await findEvent(t.event, null) : null;
  const seasons = (await all<{ s: number }>(`SELECT DISTINCT m.season s ${SIDE_FROM} WHERE m.played = 1 AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")})${ev ? " AND (e.code = ? OR e.division_code = ?)" : ""} ORDER BY m.season DESC`, [...OFFICIAL_TYPES, ...(ev ? [ev.code, ev.code] : [])])).map((r) => Number(r.s));
  const per = (await Promise.all(seasons.map(async (s) => ({ s, r: await bestOf(s, t.region, ev ? { season: s, code: ev.code } : null, t.phase ?? null) })))).filter((p) => p.r);
  if (!per.length) return latest;
  const gameOf = (s: number) => gameOfSeason(s) ?? seasonLabel(s);
  // A period asked: every heading says which ("Highest alliance auto score each season").
  const p = t.phase ? `${PHASE_LABEL[t.phase].toLowerCase()} ` : "";
  const table: StatBlock = { kind: "table", title: `Highest alliance ${p}score each season (each season is a different game)`, columns: [{ key: "season", label: "Season" }, { key: "score", label: t.phase ? `${PHASE_LABEL[t.phase]} score` : "Score", num: true }, { key: "match", label: "Match" }, { key: "event", label: "Event" }],
    rows: per.map(({ s, r }) => ({ cells: { season: `${gameOf(s)} ${seasonLabel(s)}`, score: r!.score, match: r!.label, event: shortEvent(r!.name, r!.type) }, href: matchHref(r!), strong: s === per[0].s })) };
  const place = ev ? ` at ${shortEvent(ev.name, ev.type)}` : t.region ? ` in ${t.region.name}` : "";
  // The latest season's lists only when it has scores here (a place's newest season may have none yet).
  return {
    ...latest, none: undefined, title: t.phase ? `Highest ${p}score each season${place}` : `Highest-scoring match each season${place}`, scope: ["Every season", ...latest.scope.slice(1)], blocks: [table, ...(latest.headline ? latest.blocks : [])],
    definition: `${latest.definition} Each season is a different game that scores on its own scale, so there is no all-time record: each season's best is listed apart, and the latest season's lists below.`,
  };
}
