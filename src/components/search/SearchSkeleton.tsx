// /search while its answer loads (a search just submitted, or a new one run from the page itself): the shapes of what's
// coming (title and badge, a grid of result cards, and on a desktop the panel at the right) with the site's shimmer,
// still under reduced motion (src/index.css .skeleton), and one line saying what's happening. Older results are never
// left on screen looking current while a new search loads. The query itself stays in the top bar.
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { PeopleAlsoAskPending } from "./page/FollowUps";

const Card = () => (
  <div className="rounded-xl border border-border bg-card p-4" aria-hidden>
    <div className="skeleton h-4 w-24" />
    <div className="skeleton mt-3 h-5 w-4/5" />
    <div className="skeleton mt-2 h-3.5 w-1/2" />
    <div className="mt-4 flex gap-1.5"><div className="skeleton h-5 w-16" /><div className="skeleton h-5 w-14" /><div className="skeleton h-5 w-20" /></div>
  </div>
);

/** `top`: what the page keeps above it while loading (a phone's search bar holding the query). */
export function SearchSkeleton({ query, top }: { query: string; top?: ReactNode }) {
  return (
    <div className="w-full max-w-6xl pt-4 sm:pt-8" data-search-loading aria-busy="true">
      {top}
      <p className="text-xs font-semibold text-accent-text max-md:hidden">FTC One Search</p>
      <h1 className="sr-only">Searching for “{query}”</h1>
      <div className="skeleton mt-2 h-7 w-3/4 max-w-lg md:h-8" aria-hidden />
      <div className="skeleton mt-3 h-6 w-56 max-w-full rounded-full" aria-hidden />
      <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin text-accent motion-reduce:animate-none" aria-hidden />Searching teams, events and matches…
      </p>
      {/* The answer's own grid (SearchPage: results at most 720px, People also ask's column beside them), so nothing
          moves when the answer replaces it. */}
      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,720px)_minmax(20rem,1fr)] lg:items-start lg:gap-6">
        <div className="min-w-0">
          <div className="skeleton mb-2 h-3 w-20" aria-hidden />
          <div className="grid gap-3 sm:grid-cols-2"><Card /><Card /><Card /><Card /></div>
        </div>
        <div className="max-lg:hidden" data-loading-panel><PeopleAlsoAskPending /></div>
      </div>
    </div>
  );
}
