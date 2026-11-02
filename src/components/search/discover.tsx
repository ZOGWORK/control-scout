// FTC One Search, teaching what the box can do (docs/search.md, "Discoverability"): example chips that run their
// query, and this device's recent searches, in an empty field's list. Every example is a real query search answers
// today. Home's hero block has its own rotating examples and chips (src/components/home/HeroSearch.tsx).
import { useSyncExternalStore } from "react";
import { Clock } from "lucide-react";
import { cn } from "../cn";

/** Real, runnable examples across different kinds of question. Only queries search answers now (checked against the
 *  live answer API before each is added): a versus, a question, a prediction, a record. */
export const SEARCH_EXAMPLES: readonly string[] = ["4215 vs 6980", "when did 4215 go to worlds", "will 4215 win their next match", "4215 record"];

/** Example queries as chips: tapping one runs it. The press keeps focus where it is (a chip inside the search
 *  dropdown mustn't close it before the tap lands). */
export function ExampleChips({ examples = SEARCH_EXAMPLES, onRun, label = "Try", className }: { examples?: readonly string[]; onRun: (q: string) => void; label?: string; className?: string }) {
  if (!examples.length) return null;
  return (
    <div role="group" aria-label="Example searches" className={cn("flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground", className)}>
      {label && <span>{label}:</span>}
      {examples.map((q) => (
        <button key={q} type="button" data-example onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => onRun(q)}
          className="inline-flex items-center rounded-full border border-border px-3 py-1 text-foreground hover:border-accent/60 hover:text-accent-text max-sm:min-h-9">
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

/** This device's recent searches, one tap to run again, with Clear. Nothing when there are none. */
export function RecentSearches({ onRun, className }: { onRun: (q: string) => void; className?: string }) {
  const recent = useRecentSearches();
  if (!recent.length) return null;
  const keep = (e: React.SyntheticEvent) => e.preventDefault();
  return (
    <div role="group" aria-label="Recent searches" className={className}>
      <p className="flex items-center justify-between px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Recent searches
        <button type="button" onPointerDown={keep} onMouseDown={keep} onClick={clearRecentSearches}
          className="rounded px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-accent-text hover:underline pointer-coarse:min-h-8">Clear</button>
      </p>
      {recent.map((q) => (
        <button key={q} type="button" data-recent onPointerDown={keep} onMouseDown={keep} onClick={() => onRun(q)}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-foreground/90 hover:bg-accent/[0.08] pointer-coarse:min-h-11">
          <Clock className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{q}</span>
        </button>
      ))}
    </div>
  );
}

