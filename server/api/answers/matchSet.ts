// A team's played matches, read once per team (two bounded queries on match_teams_team) and kept a few minutes: the
// set every superlative and aggregate answer filters with the scope clauses (./clauses.ts). Scored matches at
// in-person events only, as every record on the site (src/shared/eventRecord.ts).
import { all } from "../../db.js";
import { registerCache } from "../../caches.js";
import { onRecord } from "../../../src/shared/eventRecord.js";
import type { StatLink, StatMatchRow } from "../../../src/shared/searchStat.js";
import { dateRange, seasonLabel } from "../../../src/shared/format.js";
import { CHAMPIONSHIP_TYPE } from "./clauses.js";

export interface TeamMatch {
  season: number; code: string; level: string; series: number; number: number; label: string;
  /** The match's time, else its event's first day (YYYY-MM-DD…). */
  date: string | null;
  event: string; type: string | null; country: string | null; state: string | null;
  /** A championship division's parent event code (FTCCMP1). */
  division: string | null;
  alliance: "red" | "blue";
  /** With penalties (the result), and without (the alliance's own points). */
  own: number; opp: number; ownNp: number | null; oppNp: number | null;
  /** The alliance's phase points (as the match's own breakdown stores them) and the penalty points it gave away (its
   *  fouls, the other alliance's gain). A match FIRST posted as totals only (`breakdown` 0) has a reported Auto and
   *  fouls but an estimated TeleOp and no Endgame: those two are null, never a phase record. */
  ownAuto: number | null; ownTeleop: number | null; ownEndgame: number | null; ownPen: number | null; oppPen: number | null;
  /** On the team's win-loss record (eventRecord's rule: a qualification surrogate isn't, a playoff team sitting out isn't). */
  counted: boolean;
  /** The team's robot was on the field (its alliance's score is one it helped make). */
  onField: boolean;
  result: "W" | "L" | "T";
  partners: number[]; opponents: number[];
}

const TTL_MS = 5 * 60_000, MAX = 300;
const num = (v: unknown) => (v == null ? null : Number(v));
const cache = new Map<number, { at: number; rows: Promise<TeamMatch[]> }>();
registerCache("Search answers: team matches", () => cache.clear());

/** The team's played, scored matches at in-person events, oldest first: by event (a division before the finals it
 *  feeds, held the same day), then in the event's own match order
 *  (qualifications, then playoffs by bracket stage with the final, series 0, last), never by match time, which a played
 *  match may lack. */
export function teamMatches(team: number): Promise<TeamMatch[]> {
  const hit = cache.get(team);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const rows = load(team);
  cache.set(team, { at: Date.now(), rows });
  // A failed read never sticks; the oldest entry goes when the cache is full.
  rows.catch(() => { if (cache.get(team)?.rows === rows) cache.delete(team); });
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return rows;
}

async function load(team: number): Promise<TeamMatch[]> {
  const [ms, others] = await Promise.all([
    all<any>(
      `SELECT x.season, x.code, x.level, x.series, x.number, x.alliance, x.surrogate, x.on_field, m.label, COALESCE(m.time, e.start) date,
              m.red_total, m.blue_total, m.red_np, m.blue_np, m.red_auto, m.blue_auto, m.red_teleop, m.blue_teleop,
              m.red_endgame, m.blue_endgame, m.red_pen, m.blue_pen, m.breakdown, e.name event, e.type, e.country, e.state, e.division_code
       FROM match_teams x
       JOIN matches m ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
       JOIN events e ON e.season = x.season AND e.code = x.code
       WHERE x.team = ? AND m.played = 1 AND m.red_np IS NOT NULL AND m.blue_np IS NOT NULL AND COALESCE(e.remote, 0) = 0
       ORDER BY e.start, x.season, COALESCE(e.division_code, e.code), e.division_code IS NULL, x.code, x.level = 'playoff', x.level = 'playoff' AND x.series = 0, x.series, x.number`, [team]),
    all<{ season: number; code: string; level: string; series: number; number: number; team: number; alliance: string }>(
      `SELECT y.season, y.code, y.level, y.series, y.number, y.team, y.alliance FROM match_teams x
       JOIN match_teams y ON y.season = x.season AND y.code = x.code AND y.level = x.level AND y.series = x.series AND y.number = x.number
       WHERE x.team = ? AND y.team <> x.team AND y.on_field = 1 ORDER BY y.station, y.team`, [team]),
  ]);
  const key = (r: { season: number; code: string; level: string; series: number; number: number }) => `${r.season}|${r.code}|${r.level}|${r.series}|${r.number}`;
  const sides = new Map<string, { team: number; alliance: string }[]>();
  for (const o of others) { const k = key(o); sides.set(k, [...(sides.get(k) ?? []), o]); }
  return ms.map((r): TeamMatch => {
    const red = r.alliance === "red";
    const own = Number(red ? r.red_total : r.blue_total) || 0, opp = Number(red ? r.blue_total : r.red_total) || 0;
    const around = sides.get(key(r)) ?? [];
    const split = r.breakdown == null || Number(r.breakdown) !== 0;
    return {
      season: Number(r.season), code: r.code, level: r.level, series: Number(r.series), number: Number(r.number), label: r.label, date: r.date ?? null,
      event: shortEvent(r.event, r.type), type: r.type ?? null, country: r.country ?? null, state: r.state ?? null, division: r.division_code ?? null,
      alliance: red ? "red" : "blue", own, opp,
      ownNp: (red ? r.red_np : r.blue_np) == null ? null : Number(red ? r.red_np : r.blue_np),
      oppNp: (red ? r.blue_np : r.red_np) == null ? null : Number(red ? r.blue_np : r.red_np),
      ownAuto: num(red ? r.red_auto : r.blue_auto), ownTeleop: split ? num(red ? r.red_teleop : r.blue_teleop) : null, ownEndgame: split ? num(red ? r.red_endgame : r.blue_endgame) : null,
      ownPen: num(red ? r.red_pen : r.blue_pen), oppPen: num(red ? r.blue_pen : r.red_pen),
      counted: onRecord(r.level, { surrogate: !!Number(r.surrogate), onField: Number(r.on_field ?? 1) === 1 }),
      onField: Number(r.on_field ?? 1) === 1,
      result: own > opp ? "W" : own < opp ? "L" : "T",
      partners: around.filter((o) => o.alliance === r.alliance).map((o) => o.team),
      opponents: around.filter((o) => o.alliance !== r.alliance).map((o) => o.team),
    };
  });
}

/** An event's name as answers show it: a FIRST Championship's long name ("2024 FIRST Championship presented by BAE
 *  Systems - FIRST Tech Challenge - Edison Division") as "Worlds · Edison Division" (its finals as "Worlds finals"). */
export function shortEvent(name: string, type: string | null): string {
  if (type !== CHAMPIONSHIP_TYPE) return name;
  const last = name.split(/\s+-\s+/).pop() ?? name;
  return /\bdivision\b/i.test(last) ? `Worlds · ${last.trim()}` : "Worlds finals";
}

export const matchHref = (m: { season: number; code: string; level: string; series: number; number: number }) =>
  `/events/${m.season}/${encodeURIComponent(m.code)}?match=${m.level}:${m.series}:${m.number}`;
export const eventHref = (season: number, code: string, team?: number) => `/events/${season}/${encodeURIComponent(code)}${team ? `?team=${team}` : ""}`;
export const teamHref = (n: number, season?: number | null) => `/teams/${n}${season != null ? `?season=${season}` : ""}`;

/** Team numbers → "4215 Hypnotic Robotics" links, read once for every row of an answer. */
export async function teamLinks(numbers: Iterable<number>): Promise<Map<number, StatLink>> {
  const ns = [...new Set(numbers)].slice(0, 400);
  const out = new Map<number, StatLink>();
  if (!ns.length) return out;
  const rows = await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${ns.map(() => "?").join(",")})`, ns);
  const names = new Map(rows.map((r) => [Number(r.number), r.name]));
  for (const n of ns) out.set(n, { label: names.get(n) ? `${n} ${names.get(n)}` : String(n), href: teamHref(n) });
  return out;
}

/** A match as an answer's row, with its teams named (`links` from teamLinks). */
export function matchRow(m: TeamMatch, links: Map<number, StatLink>, team?: number): StatMatchRow {
  const link = (n: number) => links.get(n) ?? { label: String(n), href: teamHref(n) };
  return {
    label: m.label, href: matchHref(m), event: { label: m.event, href: eventHref(m.season, m.code, team) }, season: seasonLabel(m.season),
    date: m.date ? dateRange(m.date.slice(0, 10)) : null, alliance: m.alliance, own: m.own, opp: m.opp, ownNp: m.ownNp, result: m.result,
    partners: m.partners.map(link), opponents: m.opponents.map(link), oppNp: m.oppNp, type: m.type,
    phases: m.ownAuto != null || m.ownTeleop != null || m.ownEndgame != null ? { auto: m.ownAuto, teleop: m.ownTeleop, endgame: m.ownEndgame, pen: m.ownPen } : null,
  };
}
