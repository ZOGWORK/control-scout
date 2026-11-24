// Search's own score (the search audit's M6 + M7): how long a search takes to show its answer in the visitor's browser,
// and how searches end (answered, Sorry, failed), from a sampled, anonymous counter. Shared by the web app
// (src/lib/searchScore.ts sends one beacon per search) and the server (server/searchScore.ts re-checks it and adds it
// to a daily total). Like web vitals (./vitals), a beacon carries a screen-size bucket and a few fixed choices only:
// never the query, a URL, an id or anything that tells visitors or searches apart.
import { SCREENS, type Screen } from "./analytics";

/**
 * The share of page loads whose searches are counted, decided once per page load in the browser (Math.random). The
 * stored counts are of sampled searches only and are never scaled: the owner console shows rates, which sampling
 * doesn't change, and says the counts are a sample.
 */
export const SEARCH_SAMPLE = 0.5;

/** A typed search that starts this soon after the last one's answer was drawn is a re-search (the first didn't do). */
export const RE_SEARCH_MS = 30_000;

/**
 * How a search ended. direct: a card or stat answer; results: teams, events, matches or pages, no direct answer;
 * page: it went straight on to the one page it names (a team number); sorry: the page said sorry (nothing found, or
 * found but not the answer); error: the search request failed.
 */
export type SearchOutcome = "direct" | "results" | "page" | "sorry" | "error";
export const OUTCOMES: readonly SearchOutcome[] = ["direct", "results", "page", "sorry", "error"];

/** How the search was started: typed (a search box, the address bar, a link) or a tap on a follow-up. */
export type SearchVia = "typed" | "related" | "ask";
export const VIAS: readonly SearchVia[] = ["typed", "related", "ask"];

/** load: the page was opened on /search (its time includes loading the app); app: a search run inside the open app. */
export type SearchEntry = "load" | "app";
export const ENTRIES: readonly SearchEntry[] = ["load", "app"];

/** Upper bounds (ms) of the time-to-answer histogram's buckets, columns b0..b11 (the last open-ended). */
export const ANSWER_BUCKETS_MS = [100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10_000, Infinity] as const;
export const ANSWER_BUCKET_COUNT = ANSWER_BUCKETS_MS.length;
/** A longer wait is a glitch (a sleeping laptop, a clock jump), not search speed: the search counts, its time doesn't. */
export const ANSWER_MAX_MS = 60_000;

/** What the browser sends to POST /api/collect/search: one search. */
export type SearchBeacon = {
  screen: Screen;
  entry: SearchEntry;
  outcome: SearchOutcome;
  via: SearchVia;
  /** A typed search within RE_SEARCH_MS of the previous answer, with other words. */
  re: boolean;
  /** Time to answer in ms; left out when unknown (the tab was hidden while waiting, or it went on to a page). */
  ms?: number;
};

export function answerBucket(ms: number): number {
  let i = 0;
  while (ms > ANSWER_BUCKETS_MS[i]) i++;
  return i;
}

/** Server side: a validated beacon, or null. Unknown keys are ignored; a bad time drops the time, not the search. */
export function parseSearchBeacon(body: unknown): SearchBeacon | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!SCREENS.includes(b.screen as Screen)) return null;
  if (!ENTRIES.includes(b.entry as SearchEntry)) return null;
  if (!OUTCOMES.includes(b.outcome as SearchOutcome)) return null;
  if (!VIAS.includes(b.via as SearchVia)) return null;
  if (typeof b.re !== "boolean") return null;
  const out: SearchBeacon = { screen: b.screen as Screen, entry: b.entry as SearchEntry, outcome: b.outcome as SearchOutcome, via: b.via as SearchVia, re: b.re && b.via === "typed" };
  if (typeof b.ms === "number" && Number.isFinite(b.ms) && b.ms >= 0 && b.ms <= ANSWER_MAX_MS) out.ms = Math.round(b.ms);
  return out;
}

/** The ISO 8601 week ("2026-W48") a UTC day ("2026-11-23") belongs to: weeks start on Monday, week 1 holds the year's first Thursday. */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  d.setUTCDate(d.getUTCDate() - dow + 3); // that week's Thursday decides its year
  const year = d.getUTCFullYear();
  const week = 1 + Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The UTC day ("YYYY-MM-DD") an ISO week starts on (its Monday). */
export function weekStart(week: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new Error(`Not an ISO week: ${week}`);
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const monday1 = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000;
  return new Date(monday1 + (Number(m[2]) - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** Time to answer for one group of searches (ms). */
export interface AnswerSpeed { n: number; p50: number | null; p95: number | null }

/** One ISO week's score. Rates are 0–1 of that week's sampled searches (null with none). */
export interface SearchWeek {
  week: string;
  /** Monday of the week (UTC). */
  from: string;
  searches: number;
  answered: number | null;
  direct: number | null;
  sorry: number | null;
  failed: number | null;
  related: number | null;
  reSearch: number | null;
}

/** GET /api/owner/search-score: the owner console's Search speed & score section. */
export interface SearchScore {
  days: number;
  sample: number;
  /** Time to answer over the last `days`: phone (under 768 px wide) and desktop (tablets included), then by how the search began. */
  speed: { phone: AnswerSpeed; desktop: AnswerSpeed; load: AnswerSpeed; app: AnswerSpeed };
  /** The last few ISO weeks, newest first. */
  weeks: SearchWeek[];
}
