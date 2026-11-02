// What the /search results page reads off a search answer, beyond the dropdown's rows: each event's date, status,
// type and place (for its card and the page's filters), which hit is a Compare (its own card, above the teams),
// and which team hits are exact matches and which only share a word (src/pages/SearchPage.tsx).
// Presentation only: nothing here adds, drops or reorders a result except the filters the visitor picks.
import type { SearchAnswer, SearchHit } from "../../../shared/api";
import { eventTypeLabel } from "../../../shared/labels";

export type EventStatus = "upcoming" | "live" | "finished";

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
interface HitEvent { start?: string | null; end?: string | null; status?: EventStatus; type?: string | null; typeLabel?: string | null; city?: string | null; state?: string | null; country?: string | null; venue?: string | null; teams?: number | null }
/** Fields a newer server adds to a hit or an answer; read defensively, so the page works with or without them. */
type Extra = SearchHit & { event?: HitEvent; match?: "exact" | "fuzzy" };
export type AnswerExtra = SearchAnswer & { interpreted?: string; fuzzyWord?: string; fallback?: { label: string; hits: SearchHit[] } };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today as the server and the Events list count it (UTC date). */
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

/** Upcoming before its first day, finished after its last, live in between (no last day: the first). */
export function statusOf(start: string | null, end: string | null, today = todayIso()): EventStatus {
  if (!start) return "upcoming";
  if (start > today) return "upcoming";
  return (end ?? start) < today ? "finished" : "live";
}

export function eventFacts(h: SearchHit, today = todayIso()): EventFacts {
  const ev = (h as Extra).event;
  const parts = h.subtitle.split(" · ").map((s) => s.trim()).filter(Boolean);
  const code = h.ref.split(":")[1] ?? parts[0] ?? "";
  const start = ev?.start ?? parts.find((p) => DAY.test(p)) ?? null;
  const end = ev?.end ?? null;
  const place = ev ? [ev.city, ev.state, ev.country].filter(Boolean).join(", ") || null : parts.filter((p) => p !== code && !DAY.test(p)).join(" · ") || null;
  return {
    code, start, end, place,
    status: ev?.status ?? statusOf(start, end, today),
    type: ev?.type ?? null, typeLabel: ev?.typeLabel ?? null,
    venue: ev?.venue ?? null, teams: ev?.teams ?? null,
  };
}

/** A Compare: its own kind from the server, or (an older server) a team hit that opens /compare. */
export const isCompare = (h: SearchHit) => (h.kind as string) === "compare" || !!h.href?.startsWith("/compare");

/** The team numbers a Compare puts side by side, from its link (/compare?teams=4215,23268). */
export function compareTeams(h: SearchHit): number[] {
  const q = h.href?.split("?")[1] ?? "";
  return (new URLSearchParams(q).get("teams") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/** The season a Compare's link asks for (/compare?teams=…&season=2024), or null for the current one. */
export function compareSeason(h: SearchHit): number | null {
  const s = Number(new URLSearchParams(h.href?.split("?")[1] ?? "").get("season"));
  return Number.isInteger(s) && s > 2000 ? s : null;
}

/** A team hit that matched only on a shared word (the server marks it), not the name asked for. */
export const isFuzzy = (h: SearchHit) => (h as Extra).match === "fuzzy";

// ── Filters (the page's own, in its address: ?when=upcoming&season=2025&type=LeagueMeet) ──

export type When = "all" | "upcoming" | "past";
export interface PageFilters { when: When; season: number | null; type: string | null }

export function readFilters(p: URLSearchParams): PageFilters {
  const w = p.get("when");
  const s = Number(p.get("season"));
  return { when: w === "upcoming" || w === "past" ? w : "all", season: Number.isInteger(s) && s > 2000 ? s : null, type: p.get("type") || null };
}

export const anyFilter = (f: PageFilters) => f.when !== "all" || f.season != null || f.type != null;

/** The address with these filters (and the query kept); "all" and none leave no trace. */
export function withFilters(p: URLSearchParams, f: PageFilters): URLSearchParams {
  const next = new URLSearchParams(p);
  for (const k of ["when", "season", "type"]) next.delete(k);
  if (f.when !== "all") next.set("when", f.when);
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
