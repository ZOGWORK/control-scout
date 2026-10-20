// The All listed view's search box: finds teams by number or by words of their name, city and state,
// inside the season and country already chosen (the server does the matching: GET /api/directory?q=).
// Typed text stays local (no cursor jumps) and reaches the URL after a pause, so the search is a link
// and Back/Forward step through searches; a search changed from outside (Back, Clear search) replaces
// what's in the box. Starting or clearing a search adds a history entry; refining one replaces it.
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "../ui/basic";
import { DIRECTORY_QUERY_MAX } from "../../shared/directory";
import { cn } from "../cn";

/** How long typing pauses before the search runs. */
export const DIRECTORY_SEARCH_DEBOUNCE_MS = 300;

export function DirectorySearch({ value, onSearch, where, className }: {
  /** The URL's search (null for none). */
  value: string | null;
  /** Put a search in the URL (null clears it); `replace` refines the current history entry. */
  onSearch: (q: string | null, replace: boolean) => void;
  /** "Canada", "every country": said in the box's label. */
  where: string;
  className?: string;
}) {
  const [text, setText] = useState(value ?? "");
  const written = useRef(value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest onSearch, for a search that runs after a pause: a sort or country picked meanwhile must stay.
  const latest = useRef(onSearch);
  latest.current = onSearch;
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => stop, []);
  // Changed from outside (Back/Forward, Clear search, a link): show it, and drop any search still waiting.
  useEffect(() => {
    const v = value ?? "";
    if (v !== written.current) { stop(); written.current = v; setText(v); }
  }, [value]);

  const commit = (raw: string) => {
    stop();
    const q = raw.trim();
    if (q === written.current) return;
    const replace = !!q && !!written.current;
    written.current = q;
    latest.current(q || null, replace);
  };
  const change = (v: string) => {
    setText(v);
    stop();
    timer.current = setTimeout(() => commit(v), DIRECTORY_SEARCH_DEBOUNCE_MS);
  };

  return (
    <form role="search" className={cn("relative min-w-0", className)} onSubmit={(e) => { e.preventDefault(); commit(text); }}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-accent" aria-hidden />
      <Input type="search" value={text} maxLength={DIRECTORY_QUERY_MAX} enterKeyHint="search" autoComplete="off" spellCheck={false}
        placeholder="Number, name or town" aria-label={`Search teams listed from ${where}`}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && text) { e.preventDefault(); setText(""); commit(""); } }}
        className="h-9 w-full pl-9 pr-10 max-sm:h-11 [&::-webkit-search-cancel-button]:hidden" />
      {text && (
        <button type="button" onClick={() => { setText(""); commit(""); }} aria-label="Clear search"
          className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-text-muted hover:bg-text-base/[0.06] hover:text-text-base focus-visible:outline-2 focus-visible:outline-accent max-sm:size-10">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </form>
  );
}
