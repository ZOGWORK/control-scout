// What the /search results page reads off a search answer, beyond the dropdown's rows: each event's date, status,
// type and place (for its card and the page's filters), which hit is a Compare (its own card, above the teams),
// and which team hits are exact matches and which only share a word (src/pages/SearchPage.tsx).
// Presentation only: nothing here adds, drops or reorders a result except the filters the visitor picks.
import type { SearchHit } from "../../../shared/api";
import { isCompare, type AnswerExtra } from "../../../shared/searchPage";
export { badgeUnder, cardTeamName, contextBadge, isCompare, pageTitle, readingOf, teamParts, type AnswerExtra } from "../../../shared/searchPage";
import { hitHref } from "../../../shared/search";
import { seasonLabel } from "../../../lib/format";
import { eventTypeLabel } from "../../../shared/labels";

/** "started": begun, and without its last day we can't say whether it's still on (the server sent only its first). */
export type EventStatus = "upcoming" | "live" | "started" | "finished";

/** An event hit's facts for its card: the server's own when it sends them, else read off its subtitle ("CODE · start · place"). */
export interface EventFacts {
  code: string;
  start: string | null;
  end: string | null;
  status: EventStatus;
  type: string | null;
  typeLabel: string | null;
  place: string | null;
  venue: string | null;
  teams: number | null;
}

/** The event facts the server may send with an event hit (the search-engine work): every field optional. */
interface HitEvent { start?: string | null; end?: string | null; status?: EventStatus; type?: string | null; typeLabel?: string | null; venue?: string | null; teams?: number | null }
/** Fields a newer server adds to a hit or an answer; read defensively, so the page works with or without them. */
/** A Compare's sides as the server names them: number, name and place. */
export interface CompareSide { number: number; name: string; place: string }
type Extra = SearchHit & { event?: HitEvent; match?: "exact" | "fuzzy"; matched?: string[]; compare?: { teams?: CompareSide[] } };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today as the server and the Events list count it (UTC date). */
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

/** The longest an FTC event runs (the Championship's four days): with no last day known, an event this far past its
 *  first is over. */
const MAX_EVENT_DAYS = 4;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Upcoming before its first day, finished after its last, live in between. With no last day: "started" from its
 *  first day until it must be over (never called finished, or live, on a guess). */
export function statusOf(start: string | null, end: string | null, today = todayIso()): EventStatus {
  if (!start) return "upcoming";
  if (start > today) return "upcoming";
  if (end) return end < today ? "finished" : "live";
  return daysBetween(start, today) >= MAX_EVENT_DAYS ? "finished" : "started";
}

export function eventFacts(h: SearchHit, today = todayIso()): EventFacts {
  const ev = (h as Extra).event;
  const parts = h.subtitle.split(" · ").map((s) => s.trim()).filter(Boolean);
  const code = h.ref.split(":")[1] ?? parts[0] ?? "";
  const start = ev?.start ?? parts.find((p) => DAY.test(p)) ?? null;
  const end = ev?.end ?? null;
  // The place stays in the subtitle ("CODE · start · place"), with or without the server's event facts.
  const place = parts.filter((p) => p !== code && !DAY.test(p)).join(" · ") || null;
  return {
    code, start, end, place,
    status: ev?.status ?? statusOf(start, end, today),
    type: ev?.type ?? null, typeLabel: ev?.typeLabel ?? null,
    venue: ev?.venue ?? null, teams: ev?.teams ?? null,
  };
}


/** The team numbers a Compare puts side by side, from its link (/compare?teams=4215,23268). */
/** A Compare link's query (/compare?teams=…&season=…#awards: the part before any #). */
const compareQuery = (h: SearchHit) => new URLSearchParams(hitHref(h).split("#")[0].split("?")[1] ?? "");

/** A Compare's sides as the server names them (number, name, place), when it does. */
export const compareSides = (h: SearchHit): CompareSide[] => (h as Extra).compare?.teams ?? [];

export function compareTeams(h: SearchHit): number[] {
  const sides = compareSides(h);
  if (sides.length) return sides.map((s) => s.number);
  return (compareQuery(h).get("teams") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/** The teams an answer already names, in order: a fact or stat answer's team, a two-team answer's both sides
 *  ("4215 vs 6980 head to head": its `teams`) and a Compare's sides. The page shows them in the
 *  answer, so they get no team card of their own under it, only a link on to their scouting profiles. */
export function answerTeams(answer: { card?: { team?: { number: number } }; stat?: { team?: { number: number }; teams?: { number: number }[] } } | undefined, compares: SearchHit[]): number[] {
  const out = new Set<number>();
  const one = answer?.stat?.team ?? answer?.card?.team;
  if (one) out.add(one.number);
  for (const t of answer?.stat?.teams ?? []) out.add(t.number);
  for (const c of compares) for (const n of compareTeams(c)) out.add(n);
  return [...out];
}

/** The season a Compare's link asks for (/compare?teams=…&season=2024), or null for the current one. */
export function compareSeason(h: SearchHit): number | null {
  const s = Number(compareQuery(h).get("season"));
  return Number.isInteger(s) && s > 2000 ? s : null;
}

/** A team hit that matched only on a shared word (the server marks it), not the name asked for. */
export const isFuzzy = (h: SearchHit) => (h as Extra).match === "fuzzy";

/** The typed words fuzzy hits matched ("good"), for their group's heading; null when the server doesn't say. */
export function fuzzyWords(hits: SearchHit[]): string | null {
  const words = [...new Set(hits.filter(isFuzzy).flatMap((h) => (h as Extra).matched ?? []))];
  return words.length ? words.join(", ") : null;
}

// ── Filters (the page's own, in its address: ?when=upcoming&season=2025&type=LeagueMeet) ──

export type When = "all" | "upcoming" | "past";
export interface PageFilters { when: When; season: number | null; type: string | null }

/** The time tab the query itself asks for: "upcoming meets in New Jersey" opens on Upcoming, "past meets" on Past,
 *  anything else on All. It's the tab with no trace in the address; any other pick is written there. A fallback ("no
 *  past meets there, showing the upcoming ones instead") opens on All: the time asked for may be what was dropped. */
export function askedWhen(a: AnswerExtra | undefined): When {
  const t = a?.understood?.kind === "events" && !a.understood.fallback ? a.understood.time : undefined;
  return t === "upcoming" || t === "past" ? t : "all";
}

/** `asked`: the query's own time tab (askedWhen), shown when the address names none. */
export function readFilters(p: URLSearchParams, asked: When = "all"): PageFilters {
  const w = p.get("when");
  const s = Number(p.get("season"));
  return { when: w === "all" || w === "upcoming" || w === "past" ? w : asked, season: Number.isInteger(s) && s > 2000 ? s : null, type: p.get("type") || null };
}

/** The heading for a set of events these filters narrow: the server's own reading said for what's left ("FIRST
 *  Championship (Worlds) events, 2024–25", "Past championships in New Jersey, every season"), so the heading, the
 *  tabs and the cards agree. Null when the filters narrow nothing or the server sent no parts (its label stands). */
export function filteredTitle(a: AnswerExtra | undefined, f: PageFilters, asked: When = "all"): string | null {
  const scope = a?.understood?.kind === "events" ? a.understood.scope : undefined;
  if (!scope || !anyFilter(f, asked)) return null;
  const what = f.when === "all" ? scope.subject : `${f.when === "upcoming" ? "Upcoming" : "Past"} ${/^[A-Z][a-z]/.test(scope.subject) ? scope.subject.charAt(0).toLowerCase() + scope.subject.slice(1) : scope.subject}`;
  return `${what}${f.season != null ? `, ${seasonLabel(f.season)}` : scope.span}`;
}

/** Whether the filters narrow the results past what the query asked (its own time tab is no filter). */
export const anyFilter = (f: PageFilters, asked: When = "all") => f.when !== asked || f.season != null || f.type != null;

/** The address with these filters (and the query kept); the query's own time tab and none leave no trace, so a
 *  reload or a shared link opens on the same tab. */
export function withFilters(p: URLSearchParams, f: PageFilters, asked: When = "all"): URLSearchParams {
  const next = new URLSearchParams(p);
  for (const k of ["when", "season", "type"]) next.delete(k);
  if (f.when !== asked) next.set("when", f.when);
  if (f.season != null) next.set("season", String(f.season));
  if (f.type) next.set("type", f.type);
  return next;
}

/** Whether a hit stays under the filters. Time and type describe events, so they narrow events only; a season
 *  narrows events and matches. Teams and places always stay. Never reorders: the kept hits keep the server's order. */
export function keeps(h: SearchHit, f: PageFilters, today = todayIso()): boolean {
  if (h.kind === "event") {
    const e = eventFacts(h, today);
    if (f.when === "upcoming" && e.status === "finished") return false;
    if (f.when === "past" && e.status !== "finished") return false;
    if (f.type && e.type !== f.type) return false;
    if (f.season != null && h.season !== f.season) return false;
    return true;
  }
  if (h.kind === "match") return f.season == null || h.season === f.season;
  return true;
}

/** How many events each time tab would show with the other filters as they are (a tab with none is plain before
 *  it's picked). */
export function whenCounts(hits: SearchHit[], f: PageFilters, today = todayIso()): Record<When, number> {
  const ev = hits.filter((h) => h.kind === "event");
  const n = (when: When) => ev.filter((h) => keeps(h, { ...f, when }, today)).length;
  return { all: n("all"), upcoming: n("upcoming"), past: n("past") };
}

/** What a filtered page with nothing left can switch to instead, nearest first: the other time tab, then every season,
 *  then every event type, each named with how many events it would show ("2 upcoming"); none that would show none. */
export function filterAlternatives(hits: SearchHit[], f: PageFilters, today = todayIso()): { label: string; f: PageFilters }[] {
  const ev = hits.filter((h) => h.kind === "event");
  const count = (g: PageFilters) => ev.filter((h) => keeps(h, g, today)).length;
  const out: { label: string; f: PageFilters }[] = [];
  const add = (g: PageFilters, say: (n: number) => string) => { const n = count(g); if (n) out.push({ label: say(n), f: g }); };
  if (f.when !== "all") { const other: When = f.when === "past" ? "upcoming" : "past"; add({ ...f, when: other }, (n) => `${n} ${other}`); }
  if (f.season != null) add({ ...f, season: null }, (n) => `${n} in every season`);
  if (f.type != null) add({ ...f, type: null }, (n) => `${n} of every type`);
  return out;
}

/** The choices the filters offer: the seasons and event types this result set holds (never ones it doesn't). */
export function filterChoices(hits: SearchHit[]): { seasons: number[]; types: { value: string; label: string }[] } {
  const seasons = new Set<number>(), types = new Map<string, string>();
  for (const h of hits) {
    if (h.kind !== "event" && h.kind !== "match") continue;
    if (h.season != null) seasons.add(h.season);
    if (h.kind === "event") { const e = eventFacts(h); if (e.type) types.set(e.type, e.typeLabel ?? eventTypeLabel(e.type)); }
  }
  return { seasons: [...seasons].sort((a, b) => b - a), types: [...types].map(([value, label]) => ({ value, label })) };
}
