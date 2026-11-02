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
import { EVENT_TYPES, eventSetLabel, timeWindow, type EventQuery } from "../../src/shared/searchEventQuery.js";
import { STOPWORDS } from "../../src/shared/searchQuery.js";
import { SEARCH_BROWSE, pagesFor } from "../../src/shared/search.js";
import { eventStatus } from "../../src/shared/eventDay.js";
import { seasonLabel } from "../../src/shared/format.js";
import { wordScore, words } from "./fuzzy.js";
import { all, get } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import type { Region } from "../../src/shared/regions.js";

interface Row { season: number; code: string; name: string; type: string | null; venue: string | null; city: string | null; state: string | null; country: string | null; start: string | null; end: string | null; timezone: string | null }

/** Today's date (UTC) as search reads "upcoming" and "past". */
export const searchToday = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

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
export function chronological<T extends { start: string | null; end: string | null; code: string }>(rows: T[], today: string): T[] {
  const last = (r: T) => r.end ?? r.start ?? "";
  const up = rows.filter((r) => last(r) >= today).sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.code.localeCompare(b.code));
  const past = rows.filter((r) => last(r) < today).sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "") || a.code.localeCompare(b.code));
  return [...up, ...past];
}

/** The events matching every part of `e` (each part can be left out: `drop`). */
async function rowsFor(e: EventQuery, today: string, drop: { where?: boolean; time?: boolean; year?: boolean } = {}): Promise<Row[]> {
  const where: string[] = ["(type IS NULL OR type <> 'VolunteerSignup')"];
  const args: (string | number)[] = [];
  if (e.season != null && !drop.year) { where.push("season = ?"); args.push(e.season); }
  else if (e.year != null && !drop.year) { where.push("start BETWEEN ? AND ?"); args.push(`${e.year}-01-01`, `${e.year}-12-31`); }
  else if (e.year == null && e.season == null) { where.push("season = ?"); args.push(CURRENT_SEASON); }
  if (e.region) { where.push("country = ? AND state = ?"); args.push(e.region.country, e.region.state); }
  if (e.time && !drop.time) {
    const w = timeWindow(e.time, today);
    if (w.from) { where.push("COALESCE(end, start) >= ?"); args.push(w.from); }
    if (w.to) { where.push("start <= ?"); args.push(w.to); }
  }
  let rows = await all<Row>(`SELECT season, code, name, type, venue, city, state, country, start, end, timezone FROM events WHERE ${where.join(" AND ")}`, args);
  // The kind of event: its type, or the word in its name ("… League Meet").
  const types = e.kinds.map((k) => EVENT_TYPES[k]);
  if (types.length && types.every((t) => t)) {
    const allowed = new Set(types.flat() as string[]);
    rows = rows.filter((r) => (r.type && allowed.has(r.type)) || e.kinds.some((k) => allIn([k], r.name)));
  }
  if (e.where && !drop.where) {
    const qs = words(e.where).filter((w) => !STOPWORDS.has(w));
    rows = rows.filter((r) => allIn(qs, `${r.venue ?? ""} ${r.city ?? ""}`));
  }
  if (e.words.length) {
    const qs = e.words.flatMap((w) => words(w));
    rows = rows.filter((r) => allIn(qs, `${r.name} ${r.city ?? ""} ${r.venue ?? ""} ${r.code}`));
  }
  return chronological(rows, today);
}

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
    ...(window ? { window } : {}), ...(e.kinds.length ? { eventTypes: [...new Set(e.kinds.flatMap((k) => EVENT_TYPES[k] ?? []))] } : {}),
  };
  const place = e.region ? await placeHit(e.region) : null;
  const done = (rows: Row[], understood: SearchUnderstood): SearchAnswer => ({
    q, hits: [...(place ? [place] : []), ...rows.map((r) => eventHit(r, now)), ...(opts.others ?? [])], pages: pagesFor(q), step: "deterministic", weak: false,
    understood: { ...understood, total: rows.length },
  });

  const rows = await rowsFor(e, today);
  if (rows.length) return done(rows, { ...base, label: label({ where: whereAsStored(e, rows) }) });
  // Nothing matched: the closest honest set, labelled as such. The venue or city goes first, then the time.
  const asked = label();
  const tries: ("where" | "time")[][] = [];
  if (e.where) tries.push(["where"]);
  if (e.time) tries.push(e.where ? ["where", "time"] : ["time"]);
  for (const d of tries) {
    const fb = await rowsFor(e, today, { where: d.includes("where"), time: d.includes("time") });
    if (fb.length) return done(fb, { ...base, label: asked, fallback: `No ${lower(asked)} — showing ${lower(label({ drop: d }))} instead` });
  }
  // Still nothing. A year named is never swapped for another: say so, with other years' events as closest matches.
  const otherYears = e.year != null || e.season != null ? (await rowsFor(e, today, { year: true })).slice(0, 10) : [];
  return {
    q, hits: [], pages: pagesFor(q), step: "recovery", weak: true, understood: { ...base, label: asked, total: 0 },
    recovery: {
      understood: [asked, e.year != null ? `No events held in ${e.year} match` : e.season != null ? `No ${seasonLabel(e.season)} events match` : "No events match"],
      closest: otherYears.map((r) => eventHit(r, now)),
      browse: e.region ? [{ title: `All events in ${e.region.name}`, href: `/events?region=${encodeURIComponent(e.region.key)}` }, ...SEARCH_BROWSE] : SEARCH_BROWSE,
    },
  };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
