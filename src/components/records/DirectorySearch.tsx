// The All listed view's search box: finds teams by number or by words of their name, city and state,
// inside the season and country already chosen (the server does the matching: GET /api/directory?q=).
// Typed text stays local (no cursor jumps) and reaches the URL after a pause, so the search is a link
// and Back/Forward step through searches; a search changed from outside (Back, Clear search) replaces
// what's in the box. Starting or clearing a search adds a history entry; refining one replaces it.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Input } from "../ui/basic";
import { DIRECTORY_QUERY_MAX } from "../../shared/directory";
import { cn } from "../cn";

/** How long typing pauses before the search runs. */
export const DIRECTORY_SEARCH_DEBOUNCE_MS = 300;

export function DirectorySearch({ value, onSearch, where, draft, className }: {
  /** The URL's search (null for none). */
  value: string | null;
  /** Put a search in the URL (null clears it); `replace` refines the current history entry. */
  onSearch: (q: string | null, replace: boolean) => void;
  /** "Canada", "every country": said in the box's label. */
  where: string;
  /**
   * Typed text not yet in the URL, kept by the page: when the box is swapped for another (the phone and wide
   * layouts each have their own), the new one carries on with it instead of dropping it.
   */
  draft?: { current: string | null };
  className?: string;
}) {
  const [text, setText] = useState(() => draft?.current ?? value ?? "");
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
    if (v !== written.current) { stop(); written.current = v; setText(v); if (draft) draft.current = null; }
  }, [value]);
  // Back/Forward drop a search still waiting even when both entries have the same search (a sort changed
  // between them): run later, it would push a new entry and wipe the Forward history.
  const loc = useLocation();
  const nav = useNavigationType();
  useEffect(() => {
    if (nav !== "POP" || !timer.current) return;
    stop();
    written.current = value ?? "";
    setText(value ?? "");
    if (draft) draft.current = null;
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // A draft from the box this one replaced: its search runs after the usual pause. (After the effect above,
  // which on mount would take the waiting search for one left over from a Back.)
  useEffect(() => {
    const d = draft?.current;
    if (d != null && d.trim() !== (value ?? "")) timer.current = setTimeout(() => commit(d), DIRECTORY_SEARCH_DEBOUNCE_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (raw: string) => {
    stop();
    if (draft) draft.current = null;
    const q = raw.trim();
    if (q === written.current) return;
    const replace = !!q && !!written.current;
    written.current = q;
    latest.current(q || null, replace);
  };
  const change = (v: string) => {
    setText(v);
    if (draft) draft.current = v;
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
