// /search?q=…: where the browser's address-bar search lands ("Press Tab to search Control Scout",
// server/openSearch.ts). The same results as the header's box (useSearchHits, content only: teams, events,
// matches and places), as a page of links. The server already lists them in the first paint (server/seoMeta.ts
// searchMeta) and hands them over (src/lib/searchBoot.ts), and the query lives in the address, so a direct
// visit never waits on the header's state.
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Search, Sparkles } from "lucide-react";
import { AnswerNotesView, HitText, hitHref, rowIcon, useSearchHits, useSections } from "../components/search/SearchBox";
import { SEARCH_PAGE_LIMIT } from "../shared/search";
import { BOOT_HITS } from "../lib/searchBoot";
import { useTitle, useMeta } from "../lib/meta";
import { cn } from "../components/cn";

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const query = q.trim();
  const { hits, answer, ai, refining, busy, error, logPick } = useSearchHits(q, undefined, SEARCH_PAGE_LIMIT, BOOT_HITS);
  const { sections, notes } = useSections(hits, answer, ai);
  const meta = useMeta();
  useTitle(query ? `Search: ${query}` : "Search");
  // Typing replaces the address (no history entry per letter), so Back leaves the page.
  const setQ = (v: string) => setParams(v ? { q: v } : {}, { replace: true });
  return (
    <div className="mx-auto w-full max-w-3xl px-1 pt-4 sm:pt-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {query ? <>Results for “{query}”</> : "Search"}
      </h1>
      <form role="search" className="mt-4" onSubmit={(e) => e.preventDefault()}>
        <label className="flex h-11 items-center gap-2.5 rounded-xl border border-border bg-card px-3 text-foreground transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]">
          {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Search className="size-4 shrink-0 text-accent" />}
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search teams, events and matches"
            placeholder="Team number, team or event name, or a match like USNJCMP Q12"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </label>
      </form>
      <div className="mt-5" aria-live="polite">
        {!query ? <p className="text-sm text-muted-foreground">Search any FTC team, event or match.</p>
          : error ? <p className="text-sm text-destructive">{error}</p>
          : !sections.length ? (
            <p className="text-sm text-muted-foreground">{busy ? "Searching…" : meta && !meta.dataLoaded ? "No FTC data has been loaded on this server yet, so there's nothing to search." : <>Nothing matches “{query}”.</>}</p>
          ) : (
            <>
              <AnswerNotesView notes={notes} refining={refining} className="mb-4 text-sm" />
              {sections.map((s) => (
                <section key={s.id} aria-label={s.title} className="mb-5">
                  <h2 className={cn("mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider", s.id === "ai" ? "text-accent-text" : "text-muted-foreground")}>
                    {s.id === "ai" && <Sparkles className="size-3" />}{s.title}
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
            </>
          )}
      </div>
    </div>
  );
}
