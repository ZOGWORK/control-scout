// Event sets search answers from the event data itself (src/shared/searchEventQuery.ts reads the query): "upcoming
// meets in New Jersey", "meets at River Dell High School", "meets this weekend", "2024 Houston Championship Edison
// Division", "New Jersey". Fixed rules, every part a filter on stored columns (events.state/country, city, venue,
// start/end, season, type, name):
//   - no year or season named: the current season; "2024": events held in 2024; "2023-24": that season
//   - ordered by date, never by relevance: upcoming (any date today or later) soonest first, then past most recent first
//   - nothing matched: the closest honest set, labelled as a fallback ("No league meets at Nonexistent High School in
//     New Jersey — showing all league meets in New Jersey instead"): the venue or city dropped first, then the time.
//     A year is never dropped: no event in 2019 is said plainly, with the other years' events as closest matches.
import type { SearchAnswer, SearchEventInfo, SearchHit, SearchUnderstood } from "../../src/shared/api.js";
import { eventSetLabel, eventTypesOf, timeWindow, type EventQuery } from "../../src/shared/searchEventQuery.js";
import { STOPWORDS } from "../../src/shared/searchQuery.js";
import { SEARCH_BROWSE, pagesFor } from "../../src/shared/search.js";
import { eventStatus } from "../../src/shared/eventDay.js";
import { seasonLabel } from "../../src/shared/format.js";
import { wordScore, words } from "./fuzzy.js";
import { all, get } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import type { Region } from "../../src/shared/regions.js";

interface Row { season: number; code: string; name: string; type: string | null; venue: string | null; city: string | null; state: string | null; country: string | null; start: string | null; end: string | null; timezone: string | null }

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
  if (timezone) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); } catch { /* unknown zone */ }
  }
  return searchToday(now);
}

/** Every query word is in `text` (a whole word, its start, or within the typo allowance). */
const allIn = (qs: string[], text: string) => { const ws = words(text); return qs.every((q) => ws.some((w) => wordScore(q, w) >= 0.8)); };

/** The event's place in a subtitle, as the search index writes it. */
const placeOf = (r: Row) => [r.city, r.state, r.country].filter(Boolean).join(", ");

export function eventHit(r: Row, now = Date.now()): SearchHit {
  const status = eventStatus({ start: r.start, end: r.end, timezone: r.timezone }, 0, 0, now);
  const event: SearchEventInfo = { start: r.start, end: r.end, type: r.type, venue: r.venue, status };
  return { kind: "event", ref: `${r.season}:${r.code}`, title: r.name, subtitle: [r.code, r.start, placeOf(r)].filter(Boolean).join(" · "), season: Number(r.season), event, match: "exact" };
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
  else if (e.year == null && e.season == null) { where.push("season = ?"); args.push(CURRENT_SEASON); }
  if (e.region) { where.push("country = ? AND state = ?"); args.push(e.region.country, e.region.state); }
  // Bounded windows ("this weekend"): an event is in when any of its days is. "upcoming" and "past" are read on the
  // event's own calendar, below.
  if (e.time && !drop.time && e.time !== "upcoming" && e.time !== "past") {
    const w = timeWindow(e.time, today);
    if (w.from) { where.push("COALESCE(end, start) >= ?"); args.push(w.from); }
    if (w.to) { where.push("start <= ?"); args.push(w.to); }
  }
  let rows = await all<Row>(`SELECT season, code, name, type, venue, city, state, country, start, end, timezone FROM events WHERE ${where.join(" AND ")}`, args);
  if (e.time === "upcoming" && !drop.time) rows = rows.filter((r) => (r.end ?? r.start ?? "") >= dayAt(r.timezone));
  if (e.time === "past" && !drop.time) rows = rows.filter((r) => (r.end ?? r.start ?? "") < dayAt(r.timezone));
  // The kind of event: its type, or (no type stored) the word in its name ("… League Meet"). The most specific word
  // decides (eventTypesOf).
  const allowed = eventTypesOf(e.kinds);
  if (allowed) {
    const named = e.kinds.filter((k) => Object.hasOwn(EVENT_TYPES_NAMES, k));
    rows = rows.filter((r) => (r.type ? allowed.includes(r.type) : named.some((k) => allIn([k], r.name))));
  }
  if (e.where && !drop.where) {
    const qs = words(e.where).filter((w) => !STOPWORDS.has(w));
    rows = rows.filter((r) => allIn(qs, `${r.venue ?? ""} ${r.city ?? ""}`));
  }
  if (e.words.length) {
    const qs = e.words.flatMap((w) => words(w));
    rows = rows.filter((r) => allIn(qs, `${r.name} ${r.city ?? ""} ${r.venue ?? ""} ${r.code}`));
  }
  return chronological(rows, now, dayAt);
}

/** Event words whose own name says the kind ("… League Meet"), for an event stored with no type. */
const EVENT_TYPES_NAMES: Record<string, true> = { meet: true, league: true, tournament: true, championship: true, qualifier: true, scrimmage: true, kickoff: true, premier: true };

/** How the data spells the venue or city the query named, when every matched event shares it: "at River Dell High
 *  School" (a venue), "in Oradell" (a city). */
function whereAsStored(e: EventQuery, rows: Row[]): { text: string; city: boolean } | null {
  if (!e.where || !rows.length) return null;
  const qs = words(e.where).filter((w) => !STOPWORDS.has(w));
  for (const field of ["venue", "city"] as const) {
    const vals = new Set(rows.map((r) => r[field]?.replace(/[,\s]+$/, "") ?? ""));
    const [only] = [...vals];
    if (vals.size === 1 && only && allIn(qs, only)) return { text: only, city: field === "city" };
  }
  return null;
}

/** The "All events in New Jersey" link, with how many this season. */
export async function placeHit(r: Region): Promise<SearchHit | null> {
  const n = Number((await get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE season = ? AND country = ? AND state = ?", [CURRENT_SEASON, r.country, r.state]))?.n ?? 0);
  return n ? { kind: "place", ref: r.key, title: `All events in ${r.name}`, subtitle: `${n} this season`, season: CURRENT_SEASON } : null;
}

/** The answer for an event set (`q`: the query as typed). `others`: hits to list after the events (a bare region's
 *  teams). */
export async function eventSetAnswer(q: string, e: EventQuery, opts: { now?: number; others?: SearchHit[] } = {}): Promise<SearchAnswer> {
  const now = opts.now ?? Date.now(), today = searchToday(now);
  const label = (o: Parameters<typeof eventSetLabel>[1] = {}) => eventSetLabel(e, { seasonLabel, ...o });
  const window = e.time ? timeWindow(e.time, today) : null;
  const base: Omit<SearchUnderstood, "label"> = {
    kind: "events", ...(e.time ? { time: e.time } : {}), ...(e.region ? { place: { key: e.region.key, name: e.region.name } } : {}),
    ...(e.where ? { where: e.where } : {}), ...(e.year != null ? { year: e.year } : {}), season: e.season ?? (e.year == null ? CURRENT_SEASON : undefined),
    ...(window ? { window } : {}), ...(eventTypesOf(e.kinds) ? { eventTypes: eventTypesOf(e.kinds)! } : {}),
  };
  const place = e.region ? await placeHit(e.region) : null;
  const done = (rows: Row[], understood: SearchUnderstood): SearchAnswer => ({
    q, hits: [...(place ? [place] : []), ...rows.map((r) => eventHit(r, now)), ...(opts.others ?? [])], pages: pagesFor(q), step: "deterministic", weak: false,
    understood: { ...understood, total: rows.length },
  });

  const rows = await rowsFor(e, now);
  if (rows.length) return done(rows, { ...base, label: label({ where: whereAsStored(e, rows) }) });
  // Nothing matched: the closest honest set, labelled as such. The venue or city goes first, then the time.
  const asked = label();
  const tries: ("where" | "time")[][] = [];
  if (e.where) tries.push(["where"]);
  if (e.time) tries.push(e.where ? ["where", "time"] : ["time"]);
  for (const d of tries) {
    const fb = await rowsFor(e, now, { where: d.includes("where"), time: d.includes("time") });
    if (fb.length) return done(fb, { ...base, label: asked, fallback: `No ${lower(asked)} — showing ${lower(label({ drop: d }))} instead` });
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
