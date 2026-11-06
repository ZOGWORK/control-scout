// Event sets search answers from the event data itself (src/shared/searchEventQuery.ts reads the query): "upcoming
// meets in New Jersey", "meets at River Dell High School", "meets this weekend", "2024 Houston Championship Edison
// Division", "New Jersey". Fixed rules, every part a filter on stored columns (events.state/country, city, venue,
// start/end, season, type, name):
//   - no year or season named: the current season (championships, one a season: every season, newest season first;
//     a venue or city: every season, in date order); "2024": events held in 2024; "2023-24": that season
//   - a venue or city matches loosely: punctuation, "HS" for "High School", "Regional" and a letter or two off
//     ("River DeHigh School") are the same venue; its city counts too
//   - ordered by date, never by relevance: upcoming (any date today or later) soonest first, then past most recent first
//   - nothing matched: the closest honest set, labelled as a fallback ("No meets in New Jersey at Nonexistent High
//     School in the data — showing meets in New Jersey instead"): the time dropped first (the venue asked for stays:
//     "No past meets at River Dell High School in the data — showing meets at River Dell High School instead"), then
//     the venue or city.
//     A year is never dropped: no event in 2019 is said plainly, with the other years' events as closest matches.
import type { SearchAnswer, SearchEventInfo, SearchHit, SearchUnderstood } from "../../src/shared/api.js";
import { eventSetLabel, eventSetSpan, eventTypesOf, timeWindow, type EventQuery } from "../../src/shared/searchEventQuery.js";
import { STOPWORDS } from "../../src/shared/searchQuery.js";
import { SEARCH_BROWSE, SEARCH_PAGE_LIMIT, familyKey, firstCards, pagesFor } from "../../src/shared/search.js";
import { eventStatus, localDate } from "../../src/shared/eventDay.js";
import { seasonLabel } from "../../src/shared/format.js";
import { wordScore, words } from "./fuzzy.js";
import { all, get } from "../db.js";
import { searchRead } from "./searchReads.js";
import { CURRENT_SEASON, SEASON_NUMBERS, gameOf } from "../data/seasons.js";
import { edits, type Region } from "../../src/shared/regions.js";

interface Row { season: number; code: string; name: string; type: string | null; division_code?: string | null; venue: string | null; city: string | null; state: string | null; country: string | null; start: string | null; end: string | null; timezone: string | null }

/** Today's date (UTC): the reference for windows like "this weekend". */
export const searchToday = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Today's date at the event's venue (its own calendar, as its status reads it), UTC when its time zone is unknown:
 *  "upcoming" and "past" are read on it, so a meet under way in Los Angeles at 02:00 UTC is still upcoming. */
/** localToday for one moment, each time zone worked out once (a search reads it for every event). */
export function localTodays(now: number): (timezone: string | null) => string {
  const seen = new Map<string, string>();
  return (tz) => { const k = tz ?? ""; let d = seen.get(k); if (d == null) seen.set(k, (d = localToday(now, tz))); return d; };
}

export function localToday(now: number, timezone: string | null): string {
  // An unknown zone: UTC's date.
  return (timezone ? localDate(now, timezone) : null) ?? searchToday(now);
}

/** Every query word is in `text` (a whole word, its start, or within the typo allowance). */
const allIn = (qs: string[], text: string) => { const ws = words(text); return qs.every((q) => ws.some((w) => wordScore(q, w) >= 0.8)); };

/** The event's place in a subtitle, as the search index writes it. */
/** A venue or city as one run of letters: punctuation, little words and "Regional" out, "HS" as "high school"
 *  ("River Dell Regional H.S." is "riverdellhighschool"). */
function compact(s: string): string {
  // Each venue and city is compacted once, not once a search: a place query reads every event's.
  let c = compacted.get(s);
  if (c === undefined) {
    const ws = s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\bh\.?\s*s\b\.?/g, " high school ").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ");
    c = ws.filter((w) => w && !STOPWORDS.has(w) && w !== "regional").join("");
    if (compacted.size > 100_000) compacted.clear();
    compacted.set(s, c);
  }
  return c;
}
const compacted = new Map<string, string>();
/** Whether `text` (a stored venue, or a city: `whole`) is the place typed: a venue holds the words typed (or they
 *  hold it); either is a letter or two off (one per eight letters), its first five letters the same ("Dumont High
 *  School" is never "Dimond High School"). */
function samePlace(typed: string, text: string | null, whole = false): boolean {
  const q = compact(typed), t = compact(text ?? "");
  if (!q || !t) return false;
  if (!whole && (t.includes(q) || (t.length >= 10 && q.includes(t)))) return true;
  return q.slice(0, 5) === t.slice(0, 5) && Math.abs(q.length - t.length) <= 2 && edits(q, t) <= Math.max(1, Math.floor(q.length / 8));
}
/** The venue or city is the place as typed, no letter off: the venue holds the words typed (or they hold it), or the
 *  city is them. */
function exactPlace(typed: string, r: Row): boolean {
  const q = compact(typed), v = compact(r.venue ?? ""), c = compact(r.city ?? "");
  return !!q && ((!!v && (v.includes(q) || (v.length >= 10 && q.includes(v)))) || c === q);
}

/** The states (country:state) where some event's venue or city is the place as typed (exactPlace). */
async function exactStates(typed: string): Promise<Set<string>> {
  const all_ = await searchRead<Row>("SELECT venue, city, state, country FROM events WHERE venue IS NOT NULL OR city IS NOT NULL");
  return new Set(all_.filter((r) => exactPlace(typed, r)).map((r) => `${r.country}:${r.state}`));
}

/** The event is at the place typed: its venue or city (samePlace), or every word typed is a word of its venue, in
 *  any order ("Dell River High School"). Never city words and venue words mixed: "Ramsey High School" is not Don
 *  Bosco Prep High School in Ramsey. */
function atPlace(typed: string, r: Row): boolean {
  if (samePlace(typed, r.venue) || samePlace(typed, r.city, true)) return true;
  const qs = words(typed).filter((w) => !STOPWORDS.has(w));
  if (!qs.length) return false;
  const v = r.venue ?? "";
  let have = venueWords.get(v);
  if (!have) {
    have = new Set(words(v));
    if (venueWords.size > 100_000) venueWords.clear();
    venueWords.set(v, have);
  }
  return qs.every((w) => have.has(w));
}
const venueWords = new Map<string, Set<string>>();

const placeOf = (r: Row) => [r.city, r.state, r.country].filter(Boolean).join(", ");

/** A venue as shown: FIRST's event list stores some with a trailing comma (the address cut off after it, "Columbia
 *  High School,"), so the name ends at the comma; nothing else of it changes. */
export const venueName = (v: string | null): string | null => v?.replace(/[,\s]+$/, "") || null;

export function eventHit(r: Row, now = Date.now()): SearchHit {
  const status = eventStatus({ start: r.start, end: r.end, timezone: r.timezone }, 0, 0, now);
  const event: SearchEventInfo = { start: r.start, end: r.end, type: r.type, venue: venueName(r.venue), status };
  return { kind: "event", ref: `${r.season}:${r.code}`, title: r.name, subtitle: [r.code, r.start, placeOf(r)].filter(Boolean).join(" · "), season: Number(r.season), event, match: "exact", ...(r.division_code ? { parent: r.division_code } : {}) };
}

/** Each event hit with its season's game (SearchHit.game), and each division with its event's code (SearchHit.parent)
 *  from the events table: hits read from names (the search index) don't carry it. One read for the whole answer. */
export async function withEventParents(hits: SearchHit[]): Promise<SearchHit[]> {
  const ask = hits.filter((h) => h.kind === "event" && h.parent == null && h.season != null);
  const rows = ask.length ? await all<{ season: number; code: string; division_code: string }>(
    `SELECT season, code, division_code FROM events WHERE division_code IS NOT NULL AND (${ask.map(() => "(season = ? AND code = ?)").join(" OR ")})`,
    ask.flatMap((h) => [h.season!, h.ref.split(":")[1]])) : [];
  const of = new Map(rows.map((r) => [`${r.season}:${r.code}`, r.division_code]));
  return hits.map((h) => {
    if (h.kind !== "event" || h.season == null) return h;
    const parent = h.parent ?? of.get(h.ref), game = gameOf(h.season);
    return { ...h, ...(parent ? { parent } : {}), ...(game ? { game } : {}) };
  });
}

/** The hits with each family listed in part made whole (an event split in divisions: its finals and every division), the
 *  missing members right after the last one listed, each hit with its parent and game (withEventParents). A list cut
 *  by raw hits (names matched, a layer's) can hold part of one; the page's cut (firstCards) then keeps or drops it
 *  whole. */
export async function withWholeFamilies(hits: SearchHit[], now = Date.now()): Promise<SearchHit[]> {
  const out = await withEventParents(hits);
  // Only a family the list already shows (2+ of it): a lone event or division ("edison division") stays as found.
  const listed = new Map<string, number>();
  for (const h of out) listed.set(familyKey(h), (listed.get(familyKey(h)) ?? 0) + 1);
  const fams = new Map<string, { season: number; code: string }>();
  for (const h of out) if (h.kind === "event" && h.season != null && listed.get(familyKey(h))! >= 2) fams.set(familyKey(h), { season: h.season, code: h.parent ?? h.ref.split(":")[1] });
  if (!fams.size) return out;
  const rows = await all<Row>(
    `SELECT season, code, name, type, division_code, venue, city, state, country, start, end, timezone FROM events WHERE ${[...fams.values()].map(() => "(season = ? AND (code = ? OR division_code = ?))").join(" OR ")} ORDER BY season, code`,
    [...fams.values()].flatMap((f) => [f.season, f.code, f.code]));
  const have = new Set(out.map((h) => `${h.kind}:${h.ref}`));
  const missing = new Map<string, SearchHit[]>();
  for (const r of rows) {
    const h = eventHit(r, now);
    if (have.has(`event:${h.ref}`)) continue;
    const k = familyKey(h);
    missing.set(k, [...(missing.get(k) ?? []), h]);
  }
  if (!missing.size) return out;
  const last = new Map<string, number>();
  out.forEach((h, i) => last.set(familyKey(h), i));
  return withEventParents(out.flatMap((h, i) => (last.get(familyKey(h)) === i ? [h, ...(missing.get(familyKey(h)) ?? [])] : [h])));
}

/** Upcoming soonest first, then past most recent first: the two never interleave (brief Requirement 9). */
export function chronological<T extends { start: string | null; end: string | null; code: string; timezone?: string | null }>(rows: T[], now: number, dayAt = localTodays(now)): T[] {
  const last = (r: T) => r.end ?? r.start ?? "";
  const ended = (r: T) => last(r) < dayAt(r.timezone ?? null);
  const up = rows.filter((r) => !ended(r)).sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.code.localeCompare(b.code));
  const past = rows.filter(ended).sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "") || a.code.localeCompare(b.code));
  return [...up, ...past];
}

/** The events matching every part of `e` (each part can be left out: `drop`). */
async function rowsFor(e: EventQuery, now: number, drop: { where?: boolean; time?: boolean; year?: boolean } = {}): Promise<Row[]> {
  const today = searchToday(now), dayAt = localTodays(now);
  const where: string[] = ["(type IS NULL OR type <> 'VolunteerSignup')"];
  const args: (string | number)[] = [];
  if (e.season != null && !drop.year) { where.push("season = ?"); args.push(e.season); }
  else if (e.year != null && !drop.year) { where.push("start BETWEEN ? AND ?"); args.push(`${e.year}-01-01`, `${e.year}-12-31`); }
  // A venue or city asked for with no year: every season ("meets at River Dell High School", past ones too).
  else if (e.year == null && e.season == null && !e.allSeasons && !(e.where && !drop.where)) { where.push("season = ?"); args.push(CURRENT_SEASON); }
  if (e.region) { where.push("country = ? AND state = ?"); args.push(e.region.country, e.region.state); }
  // Bounded windows ("this weekend"): an event is in when any of its days is. "upcoming" and "past" are read on the
  // event's own calendar, below.
  if (e.time && !drop.time && e.time !== "upcoming" && e.time !== "past") {
    const w = timeWindow(e.time, today);
    if (w.from) { where.push("COALESCE(end, start) >= ?"); args.push(w.from); }
    if (w.to) { where.push("start <= ?"); args.push(w.to); }
  }
  // A copy: the rows read are shared (./searchReads.ts), and an every-season list is sorted in place below.
  let rows = [...(await searchRead<Row>(`SELECT season, code, name, type, division_code, venue, city, state, country, start, end, timezone FROM events WHERE ${where.join(" AND ")}`, args))];
  if (e.time === "upcoming" && !drop.time) rows = rows.filter((r) => (r.end ?? r.start ?? "") >= dayAt(r.timezone));
  if (e.time === "past" && !drop.time) rows = rows.filter((r) => (r.end ?? r.start ?? "") < dayAt(r.timezone));
  // The kind of event: its type, or (no type stored) the word in its name ("… League Meet"). The most specific word
  // decides (eventTypesOf).
  const allowed = eventTypesOf(e.kinds);
  if (allowed) {
    // "states" with no type stored: a championship by its name ("Texas Championship").
    const named = e.kinds.map((k) => (k === "states" ? "championship" : k)).filter((k) => Object.hasOwn(EVENT_TYPES_NAMES, k));
    rows = rows.filter((r) => (r.type ? allowed.includes(r.type) : named.some((k) => allIn([k], r.name))));
  }
  if (e.where && !drop.where) {
    rows = rows.filter((r) => atPlace(e.where!, r));
    // A spelling a letter or two off counts only in a state where the place is found as typed, any season, date or
    // kind (a window that leaves out the place's own events never lets another state's school in): New Jersey's
    // "River Dale High School" is River Dell's typo; Riverdale High School in Illinois is another school.
    const states = await exactStates(e.where);
    if (states.size) rows = rows.filter((r) => exactPlace(e.where!, r) || states.has(`${r.country}:${r.state}`));
  }
  if (e.words.length) {
    const qs = e.words.flatMap((w) => words(w));
    rows = rows.filter((r) => allIn(qs, `${r.name} ${r.city ?? ""} ${r.venue ?? ""} ${r.code}`));
  }
  // Every season: newest season first, each season's events (divisions too) in date order.
  if (e.allSeasons) return rows.sort((a, b) => Number(b.season) - Number(a.season) || (a.start ?? "").localeCompare(b.start ?? "") || a.code.localeCompare(b.code));
  return chronological(rows, now, dayAt);
}

/** Seasons between the newest and oldest found with none of them: ", none on record for 2020–21". */
function gaps(e: EventQuery, rows: Row[]): string {
  if (!e.allSeasons || !rows.length) return "";
  const have = new Set(rows.map((r) => Number(r.season)));
  const lo = Math.min(...have), hi = Math.max(CURRENT_SEASON, ...have);
  const none = SEASON_NUMBERS.filter((s) => s >= lo && s <= hi && !have.has(s)).sort((a, b) => b - a);
  return none.length ? `, none on record for ${none.map(seasonLabel).join(", ")}` : "";
}

/** Event words whose own name says the kind ("… League Meet"), for an event stored with no type. */
const EVENT_TYPES_NAMES: Record<string, true> = { meet: true, league: true, tournament: true, championship: true, qualifier: true, scrimmage: true, kickoff: true, premier: true };

/** How the data spells the venue or city the query named, its most common spelling among the events matched: "at
 *  River Dell High School" (a venue, though one event has it "River DeHigh School"), "in Oradell" (a city). Only a
 *  name every event matched answers to: a city's meets at two schools are "in Oradell", never one school's name. The
 *  spelling comes from the venues found as typed when there are any: "riverdale high school" reads "Riverdale High
 *  School", never River Dell's more common spelling. */
function whereAsStored(e: EventQuery, rows: Row[]): { text: string; city: boolean } | null {
  const where = e.where;
  if (!where || !rows.length) return null;
  for (const field of ["venue", "city"] as const) {
    const n = new Map<string, number>();
    let all = true;
    for (const r of rows) { const v = r[field]?.replace(/[,\s]+$/, ""); if (v && samePlace(where, v, field === "city")) n.set(v, (n.get(v) ?? 0) + 1); else all = false; }
    const typed = [...n].filter(([v]) => (field === "venue" ? exactPlace(where, { venue: v } as Row) : compact(v) === compact(where)));
    const best = (typed.length ? typed : [...n]).sort((a, b) => b[1] - a[1])[0];
    if (best && all) return { text: best[0], city: field === "city" };
  }
  return null;
}

/** How many events a place holds this season: every kind, less the volunteer sign-ups no event set lists. */
async function placeCount(r: Region): Promise<number> {
  return Number((await get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE season = ? AND country = ? AND state = ? AND (type IS NULL OR type <> 'VolunteerSignup')", [CURRENT_SEASON, r.country, r.state]))?.n ?? 0);
}

/** The "All events in New Jersey" link, with how many events it holds this season (`n`, placeCount). `asked`: the
 *  set the query asked for, named first with its own count when it is narrower than every event: "24 meets · 42
 *  events this season". `listed`: how many of them the page lists (what the events heading and the All tab count),
 *  said when it is fewer: "24 of 26 meets listed · 42 events this season". */
function placeHitOf(r: Region, n: number, asked?: { n: number; listed: number; label: string }): SearchHit | null {
  if (!n) return null;
  const all = `${n} ${n === 1 ? "event" : "events"} this season`;
  const set = !asked || asked.label === "events" ? ""
    : asked.listed < asked.n ? `${asked.listed} of ${asked.n} ${asked.label} listed · `
    : `${asked.n} ${asked.n === 1 ? singular(asked.label) : asked.label} · `;
  return { kind: "place", ref: r.key, title: `All events in ${r.name}`, subtitle: `${set}${all}`, season: CURRENT_SEASON };
}

/** The place's link on its own (a bare "New Jersey"): how many events this season. */
export async function placeHit(r: Region): Promise<SearchHit | null> {
  return placeHitOf(r, await placeCount(r));
}

/** "meets" as one: "meet" (the first event word of a set's label). */
const singular = (label: string) => label.replace(/\b(meet|event|tournament|championship|qualifier|scrimmage|kickoff)s\b/, "$1");

/** The answer for an event set (`q`: the query as typed). `others`: hits to list after the events (a bare region's
 *  teams). */
export async function eventSetAnswer(q: string, e: EventQuery, opts: { now?: number; others?: SearchHit[] } = {}): Promise<SearchAnswer> {
  const now = opts.now ?? Date.now(), today = searchToday(now);
  const label = (o: Parameters<typeof eventSetLabel>[1] = {}) => eventSetLabel(e, { seasonLabel, ...o });
  const window = e.time ? timeWindow(e.time, today) : null;
  const base: Omit<SearchUnderstood, "label"> = {
    kind: "events", ...(e.time ? { time: e.time } : {}), ...(e.region ? { place: { key: e.region.key, name: e.region.name } } : {}),
    ...(e.where ? { where: e.where } : {}), ...(e.year != null ? { year: e.year } : {}), season: e.season ?? (e.year == null && !e.allSeasons && !e.where ? CURRENT_SEASON : undefined),
    ...(window ? { window } : {}), ...(eventTypesOf(e.kinds) ? { eventTypes: eventTypesOf(e.kinds)! } : {}),
  };
  const inPlace = e.region ? await placeCount(e.region) : 0;
  // The place's link names the set listed too, in the label's own words with the place left out ("meets", "upcoming
  // meets"), counted as the list is: one definition for the link, the events heading and the time tabs. A page holds
  // `room` cards after the link (every answer is cut to SEARCH_PAGE_LIMIT cards, an event with its divisions as one:
  // firstCards), so more than that says how many are listed.
  const room = SEARCH_PAGE_LIMIT - (inPlace ? 1 : 0);
  const placeFor = (rows: Row[], listed: number, o: Parameters<typeof eventSetLabel>[1]) => (e.region ? placeHitOf(e.region, inPlace, { n: rows.length, listed, label: lower(eventSetLabel({ ...e, region: null }, { seasonLabel, ...o })) }) : null);
  const done = (rows: Row[], understood: SearchUnderstood, o: Parameters<typeof eventSetLabel>[1] = {}): SearchAnswer => {
    const events = firstCards(rows.map((r) => eventHit(r, now)), room);
    // Every season but more than a page holds: the newest first, how many of them are listed (what the events
    // heading and the All tab count), and the full list one click away.
    const more = e.allSeasons && events.length < rows.length;
    return {
      q, hits: [...[placeFor(rows, events.length, o)].filter((h): h is SearchHit => !!h), ...events, ...(opts.others ?? [])],
      pages: more && e.region ? [{ title: `Championships in ${e.region.name}, each season: Events`, href: `/events?region=${encodeURIComponent(e.region.key)}&type=Championship` }, ...pagesFor(q)] : pagesFor(q),
      step: "deterministic", weak: false,
      understood: { ...understood, ...(more ? { label: `${understood.label}, the newest ${events.length} of ${rows.length} listed (the full list is on Events)` } : {}), total: rows.length },
    };
  };

  const rows = await rowsFor(e, now);
  if (rows.length) {
    const where = whereAsStored(e, rows);
    // A bounded window ("this week") stays in the heading: the page's tabs only stand in for upcoming and past.
    const scope = e.time && e.time !== "upcoming" && e.time !== "past" ? undefined : { subject: eventSetLabel({ ...e, time: null, season: null, year: null, allSeasons: false }, { seasonLabel, where }), span: eventSetSpan(e, seasonLabel) };
    return done(rows, { ...base, label: label({ where }) + gaps(e, rows), ...(scope ? { scope } : {}) }, { where });
  }
  // Nothing matched: the closest honest set, labelled as such. The time goes first (the venue asked for stays), then
  // the venue or city.
  const asked = label();
  const tries: ("where" | "time")[][] = [];
  if (e.time) tries.push(["time"]);
  if (e.where) tries.push(["where"]);
  if (e.time && e.where) tries.push(["where", "time"]);
  for (const d of tries) {
    const fb = await rowsFor(e, now, { where: d.includes("where"), time: d.includes("time") });
    const shown = { drop: d, where: d.includes("where") ? null : whereAsStored(e, fb) };
    if (fb.length) return done(fb, { ...base, ...(d.includes("where") ? { season: e.season ?? (e.year == null && !e.allSeasons ? CURRENT_SEASON : undefined) } : {}), label: asked, fallback: `No ${lower(asked)} in the data — showing ${lower(label(shown))} instead` }, shown);
  }
  // Still nothing. A year named is never swapped for another: say so, with other years' events as closest matches.
  const otherYears = e.year != null || e.season != null ? (await rowsFor(e, now, { year: true })).slice(0, 10) : [];
  const none = e.year != null ? `No events held in ${e.year} match` : e.season != null ? `No ${seasonLabel(e.season)} events match` : "No events match";
  // The label carries the no-match line too: it's the one line surfaces show.
  return {
    q, hits: [], pages: pagesFor(q), step: "recovery", weak: true, understood: { ...base, label: `${asked}: ${lower(none)}`, total: 0 },
    recovery: {
      understood: [asked, none],
      closest: otherYears.map((r) => eventHit(r, now)),
      browse: e.region ? [{ title: `All events in ${e.region.name}`, href: `/events?region=${encodeURIComponent(e.region.key)}` }, ...SEARCH_BROWSE] : SEARCH_BROWSE,
    },
  };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
