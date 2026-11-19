// /search while its answer loads (a search just submitted, or a new one run from the page itself): the shapes of what's
// coming (title and badge, a grid of result cards, and on a desktop the panel at the right) with the site's shimmer,
// still under reduced motion (src/index.css .skeleton), and one line saying what's happening. Older results are never
// left on screen looking current while a new search loads. The query itself stays in the top bar (on a phone, in the
// page's bar, which SearchPage keeps above this so it's the same field through the load).
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

/** v8: the answer's own shape (one card in the centred column: a title, a header rule, five 48px rows), so the answer
 *  fades in where its shapes were and nothing jumps. */
const V8Answer = () => (
  <div className="mt-5 hidden rounded-xl border border-line bg-card p-5 v8:block" aria-hidden data-v8-skeleton>
    <div className="skeleton h-3 w-28" />
    <div className="mt-5 h-9 border-b border-white/[0.12]" />
    {Array.from({ length: 5 }, (_, i) => (
      <div key={i} className="flex h-12 items-center gap-4 border-t border-white/[0.07] first:border-t-0">
        <div className="skeleton size-6 rounded-full" />
        <div className="flex-1"><div className="skeleton h-3.5 w-40 max-w-full" /><div className="skeleton mt-1.5 h-2.5 w-24" /></div>
        <div className="skeleton h-3.5 w-10" /><div className="skeleton h-3.5 w-10 max-md:hidden" /><div className="skeleton h-3.5 w-10 max-md:hidden" />
      </div>
    ))}
  </div>
);

export function SearchSkeleton({ query }: { query: string }) {
  return (
    // At least a screen tall: the footer stays below, never shown under the loading shapes and then pushed away.
    <div className="min-h-[100dvh] w-full max-w-6xl pt-4 sm:pt-8 v8:mx-auto v8:max-w-[720px]" data-search-loading aria-busy="true">
      <p className="text-xs font-semibold text-accent-text v8:hidden max-md:hidden">FTC One Search</p>
      <h1 className="sr-only">Searching for “{query}”</h1>
      <div className="skeleton mt-2 h-7 w-3/4 max-w-lg md:h-8" aria-hidden />
      <div className="skeleton mt-3 h-6 w-56 max-w-full rounded-full v8:h-4" aria-hidden />
      <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin text-accent v8:text-muted-foreground motion-reduce:animate-none" aria-hidden />Searching teams, events and matches…
      </p>
      {/* The answer's own grid (SearchPage: results at most 720px, People also ask's column beside them), so nothing
          moves when the answer replaces it. */}
      <V8Answer />
      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,720px)_minmax(20rem,1fr)] lg:items-start lg:gap-6 v8:hidden">
        <div className="min-w-0">
          <div className="skeleton mb-2 h-3 w-20" aria-hidden />
          <div className="grid gap-3 sm:grid-cols-2"><Card /><Card /><Card /><Card /></div>
        </div>
        <div className="max-lg:hidden" data-loading-panel><PeopleAlsoAskPending /></div>
      </div>
    </div>
  );
}
