// /search on a phone (FTC One Search, Part B 3b): the query in one bar that stays under the top bar while the page
// scrolls, and draws in to a slimmer line once it has scrolled. Tapping it opens the top bar's search field with the
// query in it (the one search box, src/components/layout/Search.tsx); its × clears the search back to the empty page.
// Phones only (md:hidden): from md up the query sits in the top bar's own field.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useSearch } from "../../layout/Search";
import { cn } from "../../cn";

/** Scrolled past the page's top: the bar draws in. */
function useScrolled(px = 24) {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.scrollY > px);
  useEffect(() => {
    const f = () => setOn(window.scrollY > px);
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, [px]);
  return on;
}

export function PhoneSearchBar({ query }: { query: string }) {
  // While the top bar's field is open it drops in right over this bar: hidden then (its place kept), or both show.
  const { open, expanded } = useSearch();
  const nav = useNavigate();
  const small = useScrolled();
  return (
    <div data-phone-search={small ? "compact" : "full"} aria-hidden={expanded || undefined}
      className={cn("sticky top-(--header-h) z-20 -mx-4 -mt-4 mb-3 border-b bg-primary px-4 sm:-mx-6 sm:px-6 transition-[padding,border-color] duration-150 md:hidden", small ? "border-line py-1.5" : "border-transparent py-2", expanded && "invisible")}>
      <div className={cn("flex items-center rounded-xl border border-border bg-card transition-[height] duration-150", small ? "h-11" : "h-12")}>
        <button type="button" onClick={open} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-l-xl pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={query ? `Search: ${query}. Change the search` : "Search teams, events and matches"}>
          <Search className="size-4 shrink-0 text-accent" aria-hidden />
          <span className={cn("min-w-0 truncate", query ? "text-foreground" : "text-muted-foreground", small ? "text-sm" : "text-base")}>{query || "Search teams, events, matches…"}</span>
        </button>
        {query && (
          <button type="button" onClick={() => nav("/search")} aria-label="Clear the search" data-clear
            className="grid size-11 shrink-0 place-items-center rounded-r-xl text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
