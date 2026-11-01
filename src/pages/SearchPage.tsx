// /search?q=…: where the browser's address-bar search lands ("Press Tab to search Control Scout",
// server/openSearch.ts). The same results as the header's box (useSearchHits, content only: teams, events,
// matches and places), as a page of links. The server already lists them in the first paint (server/seoMeta.ts
// searchMeta) and hands them over (src/lib/searchBoot.ts), and the query lives in the address, so a direct
// visit never waits on the header's state. Plain Enter in any search box and its "See all results" row land here.
// "Here's what we found": what the query was read as, the question's direct answer when it asked one (from stored
// data: server/api/searchQuestions.ts), then teams, events, matches and pages. A question also gets Bruno AI's short
// written answer on top, from those same records (./search/BrunoAnswer.tsx).
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import { BrunoAnswer } from "../components/search/BrunoAnswer";
import { AnswerCard, AnswerNotesView, HitText, hitHref, rowIcon, useSearchHits, useSections } from "../components/search/SearchBox";
import { SEARCH_PAGE_LIMIT, showingLine } from "../shared/search";
import { BOOT_HITS } from "../lib/searchBoot";
import { useTitle, useMeta } from "../lib/meta";
import { cn } from "../components/cn";

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const query = q.trim();
  const { hits, answer, busy, error, retry, logPick, stale, prefer } = useSearchHits(q, undefined, SEARCH_PAGE_LIMIT, BOOT_HITS, false);
  const { sections, notes } = useSections(hits, answer, null);
  const nav = useNavigate();
  const showing = answer ? showingLine({ ...answer, hits }) : null;
  const meta = useMeta();
  useTitle(query ? `Search: ${query}` : "Search");
  // Typing replaces the address (no history entry per letter), so Back leaves the page.
  const setQ = (v: string) => setParams(v ? { q: v } : {}, { replace: true });
  // The column starts at the page gutter like every other page (it sat centred, its title 190px in from the rest).
  return (
    <div className="w-full max-w-4xl pt-4 sm:pt-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {query ? <>Here's what we found for “{query}”</> : "Search"}
      </h1>
      {showing && <p className="mt-1.5 text-sm text-muted-foreground">Showing: <span className="font-medium text-foreground">{showing}</span></p>}
      {/* A plain GET form to this page (the browser's own idea of the site's search), kept in the app. */}
      <form role="search" action="/search" method="get" className="mt-4" onSubmit={(e) => e.preventDefault()}>
        <label className="flex h-11 items-center gap-2.5 rounded-xl border border-border bg-card px-3 text-foreground transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]">
          {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Search className="size-4 shrink-0 text-accent" />}
          <input
            type="search" name="q" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search teams, events and matches"
            placeholder="Team number, team or event name, or a match like USNJCMP Q12"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </label>
      </form>
      <div className="mt-5" aria-live="polite">
        {!query ? <p className="text-sm text-muted-foreground">Search any FTC team, event or match.</p>
          // A failed search says so and offers the same search again (it never fixes itself while you wait).
          : error ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="secondary" onClick={retry} disabled={busy}><RefreshCw /> Try again</Button>
            </div>
          )
          : !sections.length && !answer?.card ? (
            <p className="text-sm text-muted-foreground">{busy ? "Searching…" : meta && !meta.dataLoaded ? "No FTC data has been loaded on this server yet, so there's nothing to search." : <>Nothing matches “{query}”.</>}</p>
          ) : (
            <div className={cn("transition-opacity", stale && "opacity-60")} aria-busy={stale || undefined}>
              <AnswerNotesView notes={notes} className="mb-4 text-sm" />
              <BrunoAnswer q={q} prefer={prefer} ready={!busy && !stale} className="mb-4" />
              {answer?.card && <div className="mb-5"><AnswerCard card={answer.card} onOpen={(href) => nav(href)} /></div>}
              {sections.map((s) => (
                <section key={s.id} aria-label={s.title} className="mb-5">
                  <h2 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {s.title}
                    {s.id !== "pages" && s.id !== "browse" && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-foreground/80">{s.rows.filter((r) => !r.sub).length}</span>}
                  </h2>
                  <ul className="overflow-hidden rounded-xl border border-border bg-card">
                    {s.rows.map((r) => {
                      const Icon = rowIcon(s.id, r);
                      return (
                        <li key={r.key} className="border-b border-border last:border-b-0">
                          <Link to={hitHref(r.hit)} onClick={() => logPick(r.hit)} className={cn("flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground/90 hover:bg-accent/[0.08] hover:text-foreground", r.sub && "pl-9")}>
                            <Icon className={cn("size-4 shrink-0", r.hit.kind === "place" && !r.hit.href ? "text-accent" : "text-muted-foreground")} />
                            <HitText h={r.hit} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
