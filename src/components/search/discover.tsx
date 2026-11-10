// FTC One Search, teaching what the box can do (docs/search.md, "Discoverability"): example chips that run their
// query (for empty states; SearchBox lists the same examples as options), and this device's recent searches. Every example is a real query search answers
// today.
import { useSyncExternalStore } from "react";
import { cn } from "../cn";

/** What kind of search an example shows: the set has one of each (src/components/search/discover.test.ts). */
export type SearchExampleKind = "place" | "versus" | "question" | "record" | "rankings" | "leaderboard";

/** Real, runnable examples, one of each kind, checked against the live answer API before each was added: each gives
 *  a real result, not a "none found". No team appears twice, the teams are only the six suggestion teams, by name
 *  (src/shared/homeSuggestions.ts SUGGESTION_TEAMS), and some name no team at all, so the set shows the range
 *  of what search answers rather than one team's page. (A next-match prediction waits until match lists are
 *  published: before an event it answers "none scheduled".) In sentence case: the text shown is the query that runs. */
export const SEARCH_EXAMPLE_SET: readonly { q: string; kind: SearchExampleKind }[] = [
  { q: "Meets in New Jersey", kind: "place" },
  { q: "Bad Wolf vs Don't Blink", kind: "versus" },
  { q: "When did ENFORCERS go to Worlds", kind: "question" },
  { q: "Hypnotic Robotics record", kind: "record" },
  { q: "Top teams in NJ", kind: "rankings" },
  { q: "Highest OPR", kind: "leaderboard" },
];
export const SEARCH_EXAMPLES: readonly string[] = SEARCH_EXAMPLE_SET.map((e) => e.q);

/** Example queries as chips: tapping one runs it. The press keeps focus where it is (a chip inside the search
 *  dropdown mustn't close it before the tap lands). */
export function ExampleChips({ examples = SEARCH_EXAMPLES, onRun, label = "Try", className }: { examples?: readonly string[]; onRun: (q: string) => void; label?: string; className?: string }) {
  if (!examples.length) return null;
  return (
    <div role="group" aria-label="Example searches" className={cn("flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground", className)}>
      {label && <span>{label}:</span>}
      {examples.map((q) => (
        <button key={q} type="button" data-example onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => onRun(q)}
          className="inline-flex items-center rounded-full border border-border px-3 py-1 text-foreground hover:border-accent/60 hover:text-accent-text max-md:min-h-[44px] pointer-coarse:min-h-[44px]">
          {q}
        </button>
      ))}
    </div>
  );
}

// Recent searches: this device only (localStorage, never sent anywhere), newest first, clearable.
export const RECENT_KEY = "cs-recent-searches";
const RECENT_MAX = 6;
const RECENT_EVENT = "cs-recent-searches-change";
let memory: string[] | null = null; // when storage is blocked: this page's list
let cached: { raw: string | null; list: string[] } = { raw: null, list: [] };

function readRecent(): string[] {
  if (memory) return memory;
  let raw: string | null = null;
  try { raw = localStorage.getItem(RECENT_KEY); } catch { /* blocked: none */ }
  if (raw === cached.raw) return cached.list; // the same array while nothing changed (useSyncExternalStore)
  let list: string[] = [];
  try { const v = JSON.parse(raw ?? "[]"); if (Array.isArray(v)) list = v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX); } catch { /* unreadable: none */ }
  cached = { raw, list };
  return list;
}

function writeRecent(list: string[]) {
  try { if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list)); else localStorage.removeItem(RECENT_KEY); memory = null; } catch { memory = list; }
  window.dispatchEvent(new Event(RECENT_EVENT));
}

/** Remember a search that was run (the newest first; the same query, in any case, kept once). */
export function addRecentSearch(q: string) {
  const query = q.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!query) return;
  writeRecent([query, ...readRecent().filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, RECENT_MAX));
}

export function clearRecentSearches() { writeRecent([]); }

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === RECENT_KEY || e.key === null) cb(); };
  window.addEventListener(RECENT_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(RECENT_EVENT, cb); window.removeEventListener("storage", onStorage); };
}
const none: string[] = [];

export function useRecentSearches(): string[] {
  return useSyncExternalStore(subscribe, readRecent, () => none);
}
