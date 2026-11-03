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
import { SEASONS, ownScorePenalties } from "../../../data/seasons.js";
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
}

// A season-wide high score ("highest scoring games", "top scores", "highest score in decode"); a team's, or a world
// record ("world record score", the season records' own card), is not this.
const ASKED = /\b(?:highest[\s-]+scoring\s+(?:games?|match(?:es)?)|(?:highest|top|best|biggest|max(?:imum)?)\s+(?:match\s+|alliance\s+|combined\s+)?scores?)\b/;
const FILLER = /\b(?:the|in|of|for|during|all|ftc|first|tech|challenge|what|whats|which|were|was|are|is|games?|matches?|scores?|scoring|highest|top|best|ever|time|history|so|far|this|season|year|official)\b/g;

/** The question `q` asks, or null. */
export function readTopMatches(raw: string): TopMatchesQuestion | null {
  const q = ` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!.,]/g, " ")} `.replace(/\s+/g, " ");
  if (!ASKED.test(q) || /\bworld[\s-]+records?\b|\brecords?\b/.test(q)) return null;
  // "highest combined scores", "top alliance score": the same question to the high-score reader.
  const hs = parseHighScore(q.replace(/\b(highest|top|best|biggest|max(?:imum)?)\s+(?:match|alliance|combined)\s+(scores?)\b/, "$1 $2"));
  if (!hs) return null;
  const ever = /\b(?:ever|all[\s-]+time|of\s+all\s+time|in\s+history)\b/.test(q);
  let rest = ` ${hs.core} `;
  const at = /\bat\s+(.+)$/.exec(rest);
  const event = at ? at[1].trim() : null;
  if (at) rest = rest.slice(0, at.index);
  const words = rest.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  // Words left over name a place ("in nj") or nothing; anything else (a team) is another answer's.
  // A state code is read as typed ("MA", "OR": in lower case they're words), so each word's own case is kept.
  const asTyped = raw.replace(/[?!.,]/g, " ").split(/\s+/);
  const typed = words ? words.split(" ").map((w) => asTyped.find((x) => x.toLowerCase() === w) ?? w) : [];
  const region = words ? regionOf(typed) : null;
  if (words && !region) return null;
  return { season: hs.season, game: hs.game, ever: ever && hs.season == null, region, event: event || null };
}

interface Row { season: number; code: string; level: string; series: number; number: number; label: string; time: string | null; name: string; type: string | null; start: string | null; end: string | null; red_total: number | null; red_np: number | null; blue_total: number | null; blue_np: number | null }
const COLS = "m.season, m.code, m.level, m.series, m.number, m.label, m.time, e.name, e.type, e.start, e.end, m.red_total, m.red_np, m.blue_total, m.blue_np";
const np = (r: Row, side: "red" | "blue") => (side === "red" ? r.red_np ?? r.red_total : r.blue_np ?? r.blue_total) ?? 0;

/** The matches' scope: official events of the season, in the place or the event asked. */
function where(season: number, region: Region | null, event: { season: number; code: string } | null) {
  const sql = [`m.season = ? AND m.played = 1 AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")})`];
  const args: (string | number)[] = [season, ...OFFICIAL_TYPES];
  if (region) { sql.push("e.country = ? AND e.state = ?"); args.push(region.country, region.state); }
  if (event) { sql.push("(e.code = ? OR e.division_code = ?)"); args.push(event.code, event.code); }
  return { sql: sql.join(" AND "), args };
}

const SIDE_FROM = "FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code";
const side = (s: "red" | "blue", w: string) => `SELECT ${COLS}, '${s}' side, COALESCE(m.${s}_np, m.${s}_total) score ${SIDE_FROM} WHERE ${w} AND COALESCE(m.${s}_np, m.${s}_total) IS NOT NULL`;

/** One season's best alliance score only (the "ever" table's row). */
async function bestOf(season: number, region: Region | null, event: { season: number; code: string } | null) {
  const w = where(season, region, event);
  // select-star: the derived table's own columns (side() names each one), not a table's.
  return (await get<Row & { side: "red" | "blue"; score: number }>(`SELECT * FROM (${side("red", w.sql)} UNION ALL ${side("blue", w.sql)}) ORDER BY score DESC, start, code, label LIMIT 1`, [...w.args, ...w.args])) ?? null;
}

/** The top alliance scores (each side its own row) and the top combined scores, in one season's scope. */
async function topOf(season: number, region: Region | null, event: { season: number; code: string } | null) {
  const w = where(season, region, event);
  const from = SIDE_FROM;
  const [alliances, combined, count] = await Promise.all([
    // select-star: the derived table's own columns (side() names each one), not a table's.
    all<Row & { side: "red" | "blue"; score: number }>(`SELECT * FROM (${side("red", w.sql)} UNION ALL ${side("blue", w.sql)}) ORDER BY score DESC, start, code, label LIMIT ?`, [...w.args, ...w.args, TOP_MATCHES]),
    all<Row & { score: number }>(`SELECT ${COLS}, COALESCE(m.red_np, m.red_total) + COALESCE(m.blue_np, m.blue_total) score ${from} WHERE ${w.sql} AND COALESCE(m.red_np, m.red_total) IS NOT NULL AND COALESCE(m.blue_np, m.blue_total) IS NOT NULL ORDER BY score DESC, e.start, m.code, m.label LIMIT ?`, [...w.args, TOP_MATCHES]),
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
  const gameOf = (s: number) => SEASONS.find((x) => x.season === s)?.game ?? seasonLabel(s);
  const top = await topOf(season, t.region, ev);
  const all2 = [...top.alliances, ...top.combined];
  const ups = await lineups(all2);
  const links = await teamLinks([...ups.values()].flat());
  const named = (r: Row, side: string) => (ups.get(keyOf(r, side)) ?? []).map((n) => links.get(n)!).filter(Boolean);
  const scopeWords = `${gameOf(season)} ${seasonLabel(season)}${place ? ` · ${place}` : ""}`;
  const title = `Highest-scoring matches${place ? ` ${ev ? "at" : "in"} ${place}` : ""}, ${gameOf(season)} ${seasonLabel(season)}`;
  const base = {
    family: "superlative" as const, intent: "season-top-matches", title, scope: [seasonLabel(season), ...(place ? [place] : []), "Official events"],
    definition: `${ownScorePenalties(season) ? RULE_OWN : RULE}${t.season == null && !ev ? ` The season is ${gameOf(season)} (${seasonLabel(season)}), the latest with official matches played.` : ""}`,
    source: `From ${top.count.toLocaleString("en-US")} played match${top.count === 1 ? "" : "es"} at official events, ${scopeWords}`,
  };
  if (!top.alliances.length) return { ...base, blocks: [], none: `No played matches at official events${place ? ` in ${place}` : ""} in ${seasonLabel(season)} yet.` };
  const row = (r: Row & { side: "red" | "blue" }): StatMatchRow => {
    const other = r.side === "red" ? "blue" : "red";
    const own = Number(r.side === "red" ? r.red_total : r.blue_total) || 0, opp = Number(r.side === "red" ? r.blue_total : r.red_total) || 0;
    return {
      label: r.label, href: matchHref(r), event: { label: shortEvent(r.name, r.type), href: eventHref(r.season, r.code) }, season: seasonLabel(r.season),
      date: (r.time ?? r.start)?.slice(0, 10) ?? null, alliance: r.side, own, opp, ownNp: np(r, r.side), result: own > opp ? "W" : own < opp ? "L" : "T",
      partners: named(r, r.side), opponents: named(r, other),
    };
  };
  const best = top.alliances[0];
  const blocks: StatBlock[] = [
    { kind: "bars", title: `Top ${top.alliances.length} alliance scores`, groups: [{ label: "Alliance scores", items: top.alliances.map((r, i) => ({ label: `${i + 1}. ${r.label}`, value: r.score })) }] },
    { kind: "matches", title: "Highest alliance scores", rows: top.alliances.map(row) },
    { kind: "table", title: "Highest combined scores (both alliances)", columns: [{ key: "rank", label: "#", num: true }, { key: "combined", label: "Combined", num: true }, { key: "score", label: "Red–Blue" }, { key: "match", label: "Match" }, { key: "event", label: "Event" }, { key: "date", label: "Date" }],
      rows: top.combined.map((r, i) => ({ cells: { rank: i + 1, combined: r.score, score: `${np(r, "red")}–${np(r, "blue")}`, match: r.label, event: shortEvent(r.name, r.type), date: dateRange((r.time ?? r.start)?.slice(0, 10) ?? null) }, href: matchHref(r) })) },
  ];
  return {
    ...base, blocks,
    headline: { value: `${best.score} points`, label: `${best.label} at ${shortEvent(best.name, best.type)}`, sub: [seasonLabel(best.season), dateRange((best.time ?? best.start)?.slice(0, 10) ?? null), `${best.side === "red" ? "Red" : "Blue"}: ${named(best, best.side).map((l) => l.label).join(", ")}`].filter(Boolean).join(" · "), href: matchHref(best) },
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
  const per = (await Promise.all(seasons.map(async (s) => ({ s, r: await bestOf(s, t.region, ev ? { season: s, code: ev.code } : null) })))).filter((p) => p.r);
  if (!per.length) return latest;
  const gameOf = (s: number) => SEASONS.find((x) => x.season === s)?.game ?? seasonLabel(s);
  const table: StatBlock = { kind: "table", title: "Highest alliance score each season (each season is a different game)", columns: [{ key: "season", label: "Season" }, { key: "score", label: "Score", num: true }, { key: "match", label: "Match" }, { key: "event", label: "Event" }],
    rows: per.map(({ s, r }) => ({ cells: { season: `${gameOf(s)} ${seasonLabel(s)}`, score: r!.score, match: r!.label, event: shortEvent(r!.name, r!.type) }, href: matchHref(r!), strong: s === per[0].s })) };
  const place = ev ? ` at ${shortEvent(ev.name, ev.type)}` : t.region ? ` in ${t.region.name}` : "";
  // The latest season's lists only when it has scores here (a place's newest season may have none yet).
  return {
    ...latest, none: undefined, title: `Highest-scoring match each season${place}`, scope: ["Every season", ...latest.scope.slice(1)], blocks: [table, ...(latest.headline ? latest.blocks : [])],
    definition: `${latest.definition} Each season is a different game that scores on its own scale, so there is no all-time record: each season's best is listed apart, and the latest season's lists below.`,
  };
}
