// A scope's highlights (docs/search-pipeline.md, "Highlights"): "worlds highlights", "jackson division recap", "nj
// championship highlights", "new jersey highlights", "highlights 2024-25". Its standout matches of one season, each a
// match box saying why it's there (best score, biggest margin, latest playoff match, best Auto, closest finish, biggest
// upset), so the answer's video (../answers/video.ts) gives each its clip and the card plays the best one. Each match
// is listed once, under the first reason it meets; the same shape as a team's highlights (../answers/highlights.ts).
// The scope is the match finder's filters (./matchFind.ts where), resolved to its events first so its matches, teams
// and saved calls are read by their keys.
import type { StatAnswer, StatMatchRow } from "../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { all, get } from "../../db.js";
import { registerCache } from "../../caches.js";
import { search } from "../search.js";
import { eventFit } from "../answers/index.js";
import { shortEvent, teamLinks } from "../answers/matchSet.js";
import { COLS, allianceRow, type Row } from "../answers/families/topMatches.js";
import { OFFICIAL_TYPES } from "../answers/clauses.js";
import { EVENT_FIT } from "./context.js";
import { FROM, MARGIN, NP, where, type MatchScope } from "./matchFind.js";

export interface HighlightFind extends MatchScope {
  /** The scope in words after "Highlights" ("at Worlds", "in New Jersey"), and as the card's chips. */
  at: string;
  chips: string[];
  /** An event named: its name, dates and place as the season held it, for each season it's held. */
  eventName?: Map<number, { name: string; when: string | null; where: string | null }>;
}

type Pick = Row & { side: "red" | "blue" };
/** A scope's match with its place in the event order and the engine's saved call (live, else replayed). */
type Scored = Row & { at: number; p_red: number | null };

const n = (v: number | null | undefined) => Number(v) || 0;
const winnerOf = (r: Row): "red" | "blue" => (n(r.blue_total) > n(r.red_total) ? "blue" : "red");
const decided = (r: Row) => n(r.red_total) !== n(r.blue_total);
const margin = (r: Row) => Math.abs(n(r.red_total) - n(r.blue_total));
const npOf = (r: Row) => Math.max(n(r.red_np), n(r.blue_np));
/** The match finder's upset rule: the beaten favourite's chance, over 50%, else none. */
const upsetOf = (r: Scored) => (r.p_red == null || !decided(r) ? null : winnerOf(r) === "red" ? (1 - r.p_red > 0.5 ? 1 - r.p_red : null) : r.p_red > 0.5 ? r.p_red : null);

/** Why each pick is a highlight: its value (the highest wins; null, not one), the alliance it's about, and the same as
 *  SQL (over m, e) for a scope too big to read whole. Ties go to the higher score, then the earlier match. Each takes
 *  a few, so the next one stands in for a match an earlier reason already listed. The upset (the match finder's rule, a
 *  favourite's loss) reads the saved calls, so only a scope read whole takes it. */
const WINNER = "CASE WHEN m.blue_total > m.red_total THEN 'blue' ELSE 'red' END";
const REASONS: { note: string; value: (r: Scored) => number | null; side: (r: Row) => "red" | "blue"; sql?: { side: string; order: string; only?: string } }[] = [
  { note: "Best score", value: npOf, side: (r) => (n(r.blue_np) > n(r.red_np) ? "blue" : "red"),
    sql: { side: "CASE WHEN m.blue_np > m.red_np THEN 'blue' ELSE 'red' END", order: `${NP} DESC` } },
  { note: "Biggest margin", value: (r) => (decided(r) ? margin(r) : null), side: winnerOf, sql: { side: WINNER, order: `${MARGIN} DESC`, only: "m.red_total <> m.blue_total" } },
  // The last one played: a division's playoffs before the finals they feed, the final (series 0) last.
  { note: "Latest playoff match", value: (r) => (r.level === "playoff" ? r.at : null), side: winnerOf,
    sql: { side: WINNER, order: "e.start DESC, e.division_code IS NULL DESC, m.series = 0 DESC, m.series DESC, m.number DESC", only: "m.level = 'playoff'" } },
  { note: "Best Auto", value: (r) => (r.red_auto == null || r.blue_auto == null ? null : Math.max(n(r.red_auto), n(r.blue_auto))), side: (r) => (n(r.blue_auto) > n(r.red_auto) ? "blue" : "red"),
    sql: { side: "CASE WHEN m.blue_auto > m.red_auto THEN 'blue' ELSE 'red' END", order: "MAX(m.red_auto, m.blue_auto) DESC", only: "m.red_auto IS NOT NULL AND m.blue_auto IS NOT NULL" } },
  { note: "Closest finish", value: (r) => (decided(r) ? -margin(r) : null), side: winnerOf, sql: { side: WINNER, order: `${MARGIN} ASC`, only: "m.red_total <> m.blue_total" } },
  { note: "Biggest upset", value: upsetOf, side: winnerOf },
];
/** Most matches read whole (the highlights picked here); a bigger scope is asked each reason's best of. */
const READ_WHOLE = 4000;

const key = (r: { season: number; code: string; level: string; series: number; number: number }) => `${r.season}|${r.code}|${r.level}|${r.series}|${r.number}`;
/** A division before the finals it feeds, then the event's own order: qualifications, playoffs, the final last. */
const ORDER = "e.start, COALESCE(e.division_code, e.code), e.division_code IS NULL, m.code, m.level = 'playoff', m.level = 'playoff' AND m.series = 0, m.series, m.number";

/** The events `words` name (FIRST's `types` only, when given): in each season, the ones that fit them best. */
export async function eventsNamed(words: string, types: readonly string[] | null): Promise<{ season: number; code: string; name: string; type: string | null; division: string | null; start: string | null; end: string | null; city: string | null; state: string | null }[]> {
  const hits = (await search(words, 25, new Set(), new Set(["event"]))).filter((h) => h.kind === "event" && eventFit(words, h.title, h.ref.split(":")[1] ?? "") >= EVENT_FIT);
  const codes = [...new Set(hits.map((h) => h.ref.split(":")[1]))];
  if (!codes.length) return [];
  const rows = await all<{ season: number; code: string; name: string; type: string | null; division_code: string | null; start: string | null; end: string | null; city: string | null; state: string | null }>(
    `SELECT season, code, name, type, division_code, start, end, city, state FROM events WHERE code IN (${codes.map(() => "?").join(", ")})`, codes);
  const fits = rows.map((e) => ({ e, fit: eventFit(words, e.name, e.code) })).filter(({ e, fit }) => fit >= EVENT_FIT && (!types || types.includes(e.type ?? "")));
  const best = new Map<number, number>();
  for (const { e, fit } of fits) best.set(Number(e.season), Math.max(best.get(Number(e.season)) ?? 0, fit));
  return fits.filter(({ e, fit }) => fit === best.get(Number(e.season)))
    .map(({ e }) => ({ season: Number(e.season), code: e.code, name: e.name, type: e.type ?? null, division: e.division_code ?? null, start: e.start ?? null, end: e.end ?? null, city: e.city ?? null, state: e.state ?? null }));
}

/** The scope's events, by code, so its matches, teams and calls are read by their key: the events named and their
 *  divisions, else the season's events in its place or of its kind. Everywhere (no place, kind or event): undefined. */
export async function scopeEvents(f: MatchScope, upTo = false): Promise<{ season: number; code: string }[] | undefined> {
  if (f.events) {
    if (!f.events.length) return [];
    const rows = await all<{ season: number; code: string }>(`SELECT season, code FROM events WHERE ${f.events.map(() => "(season = ? AND (code = ? OR division_code = ?))").join(" OR ")}`,
      f.events.flatMap((e) => [e.season, e.code, e.code]));
    return rows.map((r) => ({ season: Number(r.season), code: r.code }));
  }
  if (!f.region && !f.kind) return undefined;
  const types = f.kind?.types ?? [...OFFICIAL_TYPES];
  const sql = [`e.season ${upTo ? "<=" : "="} ? AND COALESCE(e.remote, 0) = 0 AND e.type IN (${types.map(() => "?").join(", ")})`];
  const args: (string | number)[] = [f.season, ...types];
  if (f.region) { sql.push(f.region.state ? "e.country = ? AND e.state = ?" : "e.country = ?"); args.push(f.region.country, ...(f.region.state ? [f.region.state] : [])); }
  const rows = await all<{ season: number; code: string }>(`SELECT e.season, e.code FROM events e WHERE ${sql.join(" AND ")}`, args);
  return rows.map((r) => ({ season: Number(r.season), code: r.code }));
}

/** The latest season up to the scope's with a played match in it, or null. */
export async function latestPlayed(f: MatchScope): Promise<number | null> {
  const events = await scopeEvents(f, true);
  const w = where({ ...f, window: undefined, ...(events ? { events } : {}) }, true);
  const s = (await get<{ s: number | null }>(`SELECT MAX(m.season) s ${FROM} WHERE ${w.sql}`, w.args))?.s;
  return s == null ? null : Number(s);
}

/** `(season, code)` pairs as SQL over `alias` (by season, as the tables' keys read them). */
function byEvent(events: { season: number; code: string }[], alias: string) {
  const by = new Map<number, Set<string>>();
  for (const e of events) by.set(e.season, (by.get(e.season) ?? new Set()).add(e.code));
  return {
    sql: by.size ? `(${[...by].map(([, cs]) => `(${alias}.season = ? AND ${alias}.code IN (${[...cs].map(() => "?").join(", ")}))`).join(" OR ")})` : "0",
    args: [...by].flatMap(([s, cs]) => [s, ...cs]),
  };
}

/** The on-field teams of these events' matches, by match and colour, in one read. */
async function lineups(events: { season: number; code: string }[]) {
  const w = byEvent(events, "x");
  const ts = await all<{ season: number; code: string; level: string; series: number; number: number; alliance: string; team: number }>(
    `SELECT x.season, x.code, x.level, x.series, x.number, x.alliance, x.team FROM match_teams x WHERE x.on_field = 1 AND ${w.sql} ORDER BY x.station, x.team`, w.args);
  const out = new Map<string, number[]>();
  for (const t of ts) { const k = `${key(t)}|${t.alliance}`; out.set(k, [...(out.get(k) ?? []), Number(t.team)]); }
  return out;
}

const DEFINITION = (at: string, S: string, upset: boolean) =>
  `The standout matches${at ? ` ${at}` : ""} in ${S}: the best score (an alliance's points without penalties), the biggest margin, the latest playoff match, the best Auto, the closest finish (the smallest winning margin)${upset ? " and the biggest upset (a favourite's loss: the losing alliance had over a 50% predicted chance before the match)" : ""}, each match once. Only played matches at official events held in person, with both alliances' points on record. A match with a video plays here.`;

/** Each reason's pick, each match once. */
function pickAll(xs: Scored[]): { r: Pick; note: string }[] {
  const seen = new Set<string>();
  const picks: { r: Pick; note: string }[] = [];
  for (const reason of REASONS) {
    let top: Scored | null = null, topV = 0;
    for (const r of xs) {
      const v = reason.value(r);
      if (v == null || seen.has(key(r))) continue;
      if (!top || v > topV || (v === topV && npOf(r) > npOf(top))) { top = r; topV = v; }
    }
    if (top) { seen.add(key(top)); picks.push({ r: { ...top, side: reason.side(top) }, note: reason.note }); }
  }
  return picks;
}

/** The scope's matches read whole, in the event order, each with its saved call (live, else its replay). */
async function readWhole(w: { sql: string; args: (string | number)[] }, events: { season: number; code: string }[] | undefined): Promise<Scored[]> {
  const rows = await all<Row>(`SELECT ${COLS} ${FROM} WHERE ${w.sql} ORDER BY ${ORDER}`, w.args);
  const p = byEvent(events ?? rows, "p");
  const calls = rows.length ? await all<{ kind: string; season: number; code: string; level: string; series: number; number: number; p_red: number }>(
    `SELECT p.kind, p.season, p.code, p.level, p.series, p.number, p.p_red FROM predictions p WHERE p.kind IN ('live', 'backtest') AND ${p.sql}`, p.args) : [];
  const call = new Map<string, { live: boolean; p: number }>();
  for (const c of calls) {
    const had = call.get(key(c));
    if (!had || (!had.live && c.kind === "live")) call.set(key(c), { live: c.kind === "live", p: Number(c.p_red) });
  }
  return rows.map((r, at) => ({ ...r, at, p_red: call.get(key(r))?.p ?? null }));
}

/** Answers already worked out, kept a few minutes (a whole season's takes most of a second to read) and cleared with
 *  the other caches when matches sync. */
const TTL_MS = 10 * 60_000, KEPT = 100;
const kept = new Map<string, { at: number; page: Promise<StatAnswer> }>();
registerCache("Search answers: highlights", () => kept.clear());

/** The highlights of a scope: its standout matches of one season, each with its reason. */
export function highlightsAnswer(f: HighlightFind): Promise<StatAnswer> {
  const k = JSON.stringify(f, (_, v) => (v instanceof Map ? [...v] : v));
  const hit = kept.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.page;
  const page = workOut(f);
  kept.set(k, { at: Date.now(), page });
  page.catch(() => { if (kept.get(k)?.page === page) kept.delete(k); });
  if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
  return page;
}

async function workOut(f0: HighlightFind): Promise<StatAnswer> {
  const events = await scopeEvents(f0);
  const f: HighlightFind = { ...f0, ...(events ? { events } : {}) };
  const w = where(f);
  const count = Number((await get<{ n: number }>(`SELECT COUNT(*) n ${FROM} WHERE ${w.sql}`, w.args))?.n ?? 0);
  const whole = count <= READ_WHOLE;
  let picks: { r: Pick; note: string }[];
  if (whole) picks = pickAll(await readWhole(w, events));
  else {
    const reasons = REASONS.filter((r) => r.sql);
    const picked = await Promise.all(reasons.map((r) => all<Pick>(`SELECT ${COLS}, ${r.sql!.side} side ${FROM} WHERE ${w.sql}${r.sql!.only ? ` AND ${r.sql!.only}` : ""}
      ORDER BY ${r.sql!.order}, ${NP} DESC, ${ORDER} LIMIT ?`, [...w.args, reasons.length])));
    const seen = new Set<string>();
    picks = [];
    reasons.forEach((reason, i) => {
      const r = picked[i].find((x) => !seen.has(key(x)));
      if (r) { seen.add(key(r)); picks.push({ r, note: reason.note }); }
    });
  }
  const S = seasonLabel(f.season);
  const ev = f.eventName?.get(f.season);
  const at = ev ? `at ${ev.name}` : f.at;
  // The event's name is the title's; its dates and place are the chips'.
  const scope = [S, ...(ev ? [...(ev.when ? [ev.when] : []), ...(ev.where ? [ev.where] : [])] : []), ...f.chips, "Official events"];
  const where2 = `${at ? ` ${at}` : ""}${f.window ? ` ${f.window.label}` : ` in ${S}`}`;
  const base = {
    family: "superlative" as const, intent: "scope-highlights", title: `Highlights${at ? ` ${at}` : ""}, ${S}`, scope,
    definition: DEFINITION(at, S, whole),
    source: `From ${count.toLocaleString("en-US")} played match${count === 1 ? "" : "es"}${where2}`,
  };
  if (!picks.length) return { ...base, blocks: [], none: `No played matches at official events${where2} yet.` };
  // The picks' teams, in one read of their events.
  const ups = await lineups(picks.map((x) => x.r));
  const links = await teamLinks([...ups.values()].flat());
  const named = (r: Row, side: string) => (ups.get(`${key(r)}|${side}`) ?? []).map((t) => links.get(t)!).filter(Boolean);
  const rows: StatMatchRow[] = picks.map(({ r, note }) => ({ ...allianceRow(r, r.side, named), note }));
  const top = picks[0].r, best = rows[0];
  return {
    ...base,
    headline: { value: `${best.ownNp ?? best.own} points`, label: `Best score: ${top.label} at ${shortEvent(top.name, top.type)}`, href: best.href, type: top.type,
      sub: `${best.ownNp != null && best.own !== best.ownNp ? `${best.own} with penalties · ` : ""}${best.alliance === "red" ? "Red" : "Blue"} ${best.result === "W" ? "won" : best.result === "L" ? "lost" : "tied"} ${best.own}–${best.opp}`,
      teams: best.partners, alliance: best.alliance },
    blocks: [{ kind: "matches", title: `${picks.length} standout ${picks.length === 1 ? "match" : "matches"}`, rows }],
  };
}
