// A scope's highlights (docs/search-pipeline.md, "Highlights"): "worlds highlights", "jackson division recap", "nj
// championship highlights", "new jersey highlights", "highlights 2024-25". Its standout matches of one season, each a
// match box saying why it's there (best score, biggest margin, latest playoff match, best Auto, closest finish, biggest
// upset), so the answer's video (../answers/video.ts) gives each its clip and the card plays the best one. Each match
// is listed once, under the first reason it meets; the same shape as a team's highlights (../answers/highlights.ts).
// The scope is the match finder's filters (./matchFind.ts where), resolved to its events first so its matches, teams
// and saved calls are read by their keys.
import type { StatAnswer, StatBlock, StatLink, StatMatchRow, VideoTile } from "../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { all, get } from "../../db.js";
import { registerCache } from "../../caches.js";
import { search } from "../search.js";
import { INITIALISM_FIT, eventFit } from "../answers/index.js";
import { eventHref, matchHref, shortEvent, teamLinks } from "../answers/matchSet.js";
import { COLS, allianceRow, lineups, type Row } from "../answers/families/topMatches.js";
import { OFFICIAL_TYPES } from "../answers/clauses.js";
import { DOUBLE_ELIM_FROM } from "../../../src/shared/bracketOdds.js";
import { EVENT_FIT } from "./context.js";
import { names } from "./names.js";
import { initialismEvent } from "./initialisms.js";
import { FROM, MARGIN, NP, where, type MatchScope } from "./matchFind.js";

export interface HighlightFind extends MatchScope {
  /** The scope in words after "Highlights" ("at Worlds", "in New Jersey"), and as the card's chips. */
  at: string;
  chips: string[];
  /** An event named: its name, dates and place as the season held it, for each season it's held. */
  eventName?: Map<number, { name: string; when: string | null; where: string | null }>;
  /** A count asked for ("top 3 highlights"): at most that many. */
  n?: number;
  /** A video page asked for ("recap", "videos", "watch"): every match's video first, led by the latest playoff match;
   *  else the highlights, every match's video after them. */
  videos?: boolean;
}

/** Most matches a video page lists: a scope with more lists its playoff matches, and with more still none (its
 *  highlights stand alone). Most events whose own stream it offers. */
export const GALLERY = 200;
const STREAMS = 8;

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
/** A classic bracket's final (series 0, played last); a double-elimination bracket numbered from 0 opens with it. */
const FINAL_LAST = `(m.level = 'playoff' AND m.series = 0 AND m.season < ${DOUBLE_ELIM_FROM})`;
const REASONS: { note: string; value: (r: Scored) => number | null; side: (r: Row) => "red" | "blue"; sql?: { side: string; order: string; only?: string } }[] = [
  { note: "Best score", value: npOf, side: (r) => (n(r.blue_np) > n(r.red_np) ? "blue" : "red"),
    sql: { side: "CASE WHEN m.blue_np > m.red_np THEN 'blue' ELSE 'red' END", order: `${NP} DESC` } },
  { note: "Biggest margin", value: (r) => (decided(r) ? margin(r) : null), side: winnerOf, sql: { side: WINNER, order: `${MARGIN} DESC`, only: "m.red_total <> m.blue_total" } },
  // The last one played: a division's playoffs before the finals they feed, a classic bracket's final last.
  { note: "Latest playoff match", value: (r) => (r.level === "playoff" ? r.at : null), side: winnerOf,
    sql: { side: WINNER, order: `e.start DESC, e.division_code IS NULL DESC, ${FINAL_LAST} DESC, m.series DESC, m.number DESC`, only: "m.level = 'playoff'" } },
  { note: "Best Auto", value: (r) => (r.red_auto == null || r.blue_auto == null ? null : Math.max(n(r.red_auto), n(r.blue_auto))), side: (r) => (n(r.blue_auto) > n(r.red_auto) ? "blue" : "red"),
    sql: { side: "CASE WHEN m.blue_auto > m.red_auto THEN 'blue' ELSE 'red' END", order: "MAX(m.red_auto, m.blue_auto) DESC", only: "m.red_auto IS NOT NULL AND m.blue_auto IS NOT NULL" } },
  { note: "Closest finish", value: (r) => (decided(r) ? -margin(r) : null), side: winnerOf, sql: { side: WINNER, order: `${MARGIN} ASC`, only: "m.red_total <> m.blue_total" } },
  { note: "Biggest upset", value: upsetOf, side: winnerOf },
];
/** Most matches read whole (the highlights picked here); a bigger scope is asked each reason's best of. */
const READ_WHOLE = 4000;

const key = (r: { season: number; code: string; level: string; series: number; number: number }) => `${r.season}|${r.code}|${r.level}|${r.series}|${r.number}`;
/** A division before the finals it feeds, then the event's own order: qualifications, playoffs, a classic final last. */
const ORDER = `e.start, COALESCE(e.division_code, e.code), e.division_code IS NULL, m.code, m.level = 'playoff', ${FINAL_LAST}, m.series, m.number`;

/** The events `words` name (FIRST's `types` only, when given, and only those `when` keeps: a year asked): in each
 *  season, the ones that fit them best. */
export async function eventsNamed(words: string, types: readonly string[] | null, when?: (e: { season: number; start: string | null }) => boolean): Promise<{ season: number; code: string; name: string; type: string | null; division: string | null; start: string | null; end: string | null; city: string | null; state: string | null }[]> {
  const hits = (await search(words, 25, new Set(), new Set(["event"]))).filter((h) => h.kind === "event" && eventFit(words, h.title, h.ref.split(":")[1] ?? "") >= EVENT_FIT);
  // An initialism's events by the names index, which a search for a short word may rank below others.
  const codes = [...new Set([...hits.map((h) => h.ref.split(":")[1]), ...(await names()).initialism(words)])];
  if (!codes.length) return [];
  const rows = await all<{ season: number; code: string; name: string; type: string | null; division_code: string | null; start: string | null; end: string | null; city: string | null; state: string | null }>(
    `SELECT season, code, name, type, division_code, start, end, city, state FROM events WHERE code IN (${codes.map(() => "?").join(", ")})`, codes);
  const fits = rows.map((e) => ({ e, fit: eventFit(words, e.name, e.code) })).filter(({ e, fit }) => fit >= EVENT_FIT && (!types || types.includes(e.type ?? "")) && (!when || when({ season: Number(e.season), start: e.start ?? null })));
  // An initialism several events share ("mti"): the one initialismEvent picks among these (the kinds and year asked),
  // in each season it was held.
  const shared = fits.filter(({ fit }) => fit === INITIALISM_FIT);
  if (shared.length && shared.length === fits.length && new Set(shared.map(({ e }) => e.code)).size > 1) {
    const among = new Set(shared.map(({ e }) => `${e.season}|${e.code}`));
    const pick = (await initialismEvent(words, (e) => among.has(`${e.season}|${e.code}`)))?.code;
    fits.splice(0, fits.length, ...shared.filter(({ e }) => e.code === pick));
  }
  const best = new Map<number, number>();
  for (const { e, fit } of fits) best.set(Number(e.season), Math.max(best.get(Number(e.season)) ?? 0, fit));
  return fits.filter(({ e, fit }) => fit === best.get(Number(e.season)))
    .map(({ e }) => ({ season: Number(e.season), code: e.code, name: e.name, type: e.type ?? null, division: e.division_code ?? null, start: e.start ?? null, end: e.end ?? null, city: e.city ?? null, state: e.state ?? null }));
}

/** The seasons whose `types` events (in `region`, when given) were held in the calendar `year` ("worlds 2025": the
 *  2024–25 Worlds), latest first. */
export async function heldInYear(types: readonly string[], year: number, region: MatchScope["region"]): Promise<number[]> {
  const sql = [`type IN (${types.map(() => "?").join(", ")}) AND substr(start, 1, 4) = ?`];
  const args: (string | number)[] = [...types, String(year)];
  if (region) { sql.push(region.state ? "country = ? AND state = ?" : "country = ?"); args.push(region.country, ...(region.state ? [region.state] : [])); }
  return (await all<{ season: number }>(`SELECT DISTINCT season FROM events WHERE ${sql.join(" AND ")} ORDER BY season DESC`, args)).map((r) => Number(r.season));
}

/** The scope's events, by code, so its matches, teams and calls are read by their key: the events named and their
 *  divisions, else the season's events in its place or of its kind (a date window's, the seasons either side too, as
 *  a week across September holds both). Everywhere (no place, kind or event): undefined. */
export async function scopeEvents(f: MatchScope, upTo = false): Promise<{ season: number; code: string }[] | undefined> {
  if (f.events) {
    if (!f.events.length) return [];
    const rows = await all<{ season: number; code: string }>(`SELECT season, code FROM events WHERE ${f.events.map(() => "(season = ? AND (code = ? OR division_code = ?))").join(" OR ")}`,
      f.events.flatMap((e) => [e.season, e.code, e.code]));
    return rows.map((r) => ({ season: Number(r.season), code: r.code }));
  }
  if (!f.region && !f.kind) return undefined;
  const types = f.kind?.types ?? [...OFFICIAL_TYPES];
  const sql = [`${f.window && !upTo ? "e.season BETWEEN ? AND ?" : `e.season ${upTo ? "<=" : "="} ?`} AND COALESCE(e.remote, 0) = 0 AND e.type IN (${types.map(() => "?").join(", ")})`];
  const args: (string | number)[] = [...(f.window && !upTo ? [f.season - 1, f.season + 1] : [f.season]), ...types];
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

const DEFINITION = (at: string, S: string, upset: boolean, named = false) =>
  `The standout matches${at ? ` ${at}` : ""} in ${S}: the best score (an alliance's points without penalties), the biggest margin, the latest playoff match, the best Auto, the closest finish (the smallest winning margin)${upset ? " and the biggest upset (a favourite's loss: the losing alliance had over a 50% predicted chance before the match)" : ""}, each match once. Only played matches ${named ? "at the event named" : "at official events"} held in person, with both alliances' points on record. A match with a video plays here.`;

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
  let scored: Scored[] | null = null;
  if (whole) picks = pickAll(scored = await readWhole(w, events));
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
  if (f.n != null) picks = picks.slice(0, f.n);
  const S = seasonLabel(f.season);
  const ev = f.eventName?.get(f.season);
  const at = ev ? `at ${ev.name}` : f.at;
  // The event's name is the title's; its dates and place are the chips'.
  const scope = [S, ...(ev ? [...(ev.when ? [ev.when] : []), ...(ev.where ? [ev.where] : [])] : []), ...f.chips, ...(f.named ? [] : ["Official events"])];
  const where2 = `${at ? ` ${at}` : ""}${f.window ? ` ${f.window.label}` : ` in ${S}`}`;
  const base = {
    family: "superlative" as const, intent: "scope-highlights", title: `Highlights${at ? ` ${at}` : ""}, ${S}`, scope,
    definition: DEFINITION(at, S, whole, !!f.named),
    source: `From ${count.toLocaleString("en-US")} played match${count === 1 ? "" : "es"}${where2}`,
  };
  if (!picks.length) return { ...base, blocks: [], none: `No played matches${f.named ? "" : " at official events"}${where2} yet.` };
  const gallery = await galleryOf(whole ? scored : null, events, f.videos ? (f.named && ev ? "No recording for this event — stats only." : `No match videos${where2} yet.`) : null, ev ? f.eventName : undefined);
  // A video page leads with the scope's latest playoff match (a recap ends on the final, whatever reason it was
  // listed under), highlights with the best score.
  const last = f.videos ? (scored?.filter((r) => r.level === "playoff").at(-1) ?? picks.find((p) => p.note === "Latest playoff match")?.r) : undefined;
  const lead = last ? { r: { ...last, side: winnerOf(last) } as Pick, note: "Latest playoff match" } : picks[0];
  // The picks' teams (and the lead's), in one read of those matches.
  const ups = await lineups([...picks.map((x) => x.r), lead.r]);
  const links = await teamLinks([...ups.values()].flat());
  const named = (r: Row, side: string) => (ups.get(`${key(r)}|${side}`) ?? []).map((t) => links.get(t)!).filter(Boolean);
  const rows: StatMatchRow[] = picks.map(({ r, note }) => ({ ...allianceRow(r, r.side, named), note }));
  const top = lead.r, best = allianceRow(top, top.side, named);
  const standout: StatBlock = { kind: "matches", title: `${picks.length} standout ${picks.length === 1 ? "match" : "matches"}`, rows };
  return {
    ...base, ...(f.videos ? { title: `Match videos${at ? ` ${at}` : ""}, ${S}` } : {}),
    headline: { value: `${best.ownNp ?? best.own} points`, label: `${lead.note}: ${top.label} at ${shortEvent(top.name, top.type)}`, href: best.href, type: top.type,
      sub: `${best.ownNp != null && best.own !== best.ownNp ? `${best.own} with penalties · ` : ""}${best.alliance === "red" ? "Red" : "Blue"} ${best.result === "W" ? "won" : best.result === "L" ? "lost" : "tied"} ${best.own}–${best.opp}`,
      teams: best.partners, alliance: best.alliance },
    // A scope too big to list keeps its standout matches, the gallery saying why it lists none.
    blocks: f.videos && gallery.kind === "videos" && gallery.tiles.length ? [gallery] : [standout, gallery],
  };
}

/** A video page's list: the scope's matches in the events' order (read whole), each with both alliances' team
 *  numbers, and each event's stream. A scope with more than GALLERY matches lists its playoffs, more still none. */
async function galleryOf(xs: Scored[] | null, events: { season: number; code: string }[] | undefined, empty: string | null,
  named?: HighlightFind["eventName"]): Promise<StatBlock> {
  const playoffs = xs?.filter((r) => r.level === "playoff") ?? [];
  const listed = !xs ? [] : xs.length <= GALLERY ? xs : playoffs.length <= GALLERY ? playoffs : [];
  const more = !xs || listed.length < xs.length ? (listed.length ? `Playoff matches only: ${xs!.length.toLocaleString("en-US")} matches in all.` : "Too many matches to list here; open an event for each match's video.") : undefined;
  const sides = new Map<string, number[]>();
  if (listed.length) {
    const p = byEvent([...new Map(listed.map((r) => [`${r.season}|${r.code}`, r])).values()], "x");
    const ts = await all<{ season: number; code: string; level: string; series: number; number: number; alliance: string; team: number }>(
      `SELECT x.season, x.code, x.level, x.series, x.number, x.alliance, x.team FROM match_teams x WHERE x.on_field = 1 AND ${p.sql} ORDER BY x.station, x.team`, p.args);
    for (const t of ts) { const k = `${key(t)}|${t.alliance}`; sides.set(k, [...(sides.get(k) ?? []), Number(t.team)]); }
  }
  const several = new Set(listed.map((r) => `${r.season}|${r.code}`)).size > 1;
  const tiles: VideoTile[] = listed.map((r) => ({
    label: r.label, href: matchHref(r), level: r.level === "playoff" ? "playoff" : "qual", red: sides.get(`${key(r)}|red`) ?? [], blue: sides.get(`${key(r)}|blue`) ?? [],
    redScore: n(r.red_total), blueScore: n(r.blue_total), ...(several ? { event: shortEvent(r.name, r.type) } : {}), date: (r.time ?? r.start)?.slice(0, 10) ?? null,
  }));
  // Each event's own stream: the listed matches' events, else the scope's.
  const at = listed.length ? listed : xs ?? [];
  const streams: StatLink[] = [...new Map(at.map((r) => [`${r.season}|${r.code}`, { label: shortEvent(r.name, r.type), href: eventHref(r.season, r.code) }])).values()].slice(0, STREAMS);
  const first = events?.[0];
  return { kind: "videos", title: "Every match", tiles, ...(streams.length ? { streams } : {}), ...(more ? { more } : {}),
    // Nothing with a video says so only when every match was listed; a list cut short says why instead.
    ...(empty && !more ? { empty: { text: empty, ...(named && first ? { href: eventHref(first.season, first.code) } : {}) } } : {}) };
}
