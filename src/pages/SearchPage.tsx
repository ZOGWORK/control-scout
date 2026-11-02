// /search?q=…: where the browser's address-bar search lands ("Press Tab to search Control Scout",
// server/openSearch.ts). The same results as the header's box (useSearchHits, content only: teams, events,
// matches and places), as a page of cards. The server already lists them in the first paint (server/seoMeta.ts
// searchMeta) and hands them over (src/lib/searchBoot.ts), and the query lives in the address, so a direct
// visit never waits on the header's state. Plain Enter in any search box and its "See all results" row land here.
// "Here's what we found": what the query was read as, the question's direct answer when it asked one (from stored
// data: server/api/searchQuestions.ts), a Compare as its own card above the teams, then teams (with their season
// numbers), events (as blocks with date and status), matches and pages. Filters for time, season and event type
// narrow the results here, in the address (./search/page/results.ts). A question also gets Bruno AI's short
// written answer on top, from those same records (./search/BrunoAnswer.tsx). Nothing found is never a dead end
// (./search/page/NoResults.tsx).
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import { BrunoAnswer } from "../components/search/BrunoAnswer";
import { AnswerCard, AnswerNotesView, useSearchHits, useSections } from "../components/search/SearchBox";
import { CompareCard, EventCard, HeadToHead, ResultRow, TeamCard, teamSeasons, type SeasonSummary } from "../components/search/page/ResultCards";
import { NoResults } from "../components/search/page/NoResults";
import { SearchFilters } from "../components/search/page/SearchFilters";
import { anyFilter, compareSeason, compareTeams, filterChoices, isCompare, isFuzzy, keeps, readFilters, withFilters, type AnswerExtra, type PageFilters } from "../components/search/page/results";
import { SEARCH_PAGE_LIMIT, showingLine } from "../shared/search";
import type { AnswerRow, AnswerSection } from "../shared/searchSections";
import type { SearchHit, TeamSummary } from "../shared/api";
import { BOOT_HITS } from "../lib/searchBoot";
import { useTitle, useMeta, useCurrentSeason } from "../lib/meta";
import { useApi, qs } from "../lib/api";
import { cn } from "../components/cn";

const RESULT_KINDS = new Set(["place", "team", "event", "match"]);

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const query = q.trim();
  const filters = readFilters(params);
  const { hits, answer, busy, error, retry, logPick, stale, prefer, searchNow } = useSearchHits(q, undefined, SEARCH_PAGE_LIMIT, BOOT_HITS, false);
  const { sections, notes } = useSections(hits, answer, null);
  const ax = answer as AnswerExtra | undefined;
  const nav = useNavigate();
  const meta = useMeta();
  const season = useCurrentSeason();
  useTitle(query ? `Search: ${query}` : "Search");
  // Typing replaces the address (no history entry per letter), so Back leaves the page. A new query starts unfiltered.
  const setQ = (v: string) => setParams(v ? { q: v } : {}, { replace: true });
  const setFilters = (f: PageFilters) => setParams(withFilters(params, f), { replace: true });

  // A Compare is its own card above the teams, never one of them (nor counted with them).
  const compares = useMemo(() => hits.filter(isCompare), [hits]);
  const view = useMemo(() => shape(sections, filters), [sections, filters.when, filters.season, filters.type]);
  const choices = useMemo(() => filterChoices(hits), [hits]);
  // Site pages a query names ("rules", "rankings") are an answer too.
  const found = sections.some((s) => (RESULT_KINDS.has(s.id) || s.id === "pages") && s.rows.some((r) => !isCompare(r.hit))) || compares.length > 0 || !!answer?.card;
  const events = hits.filter((h) => h.kind === "event").length;
  const filtersOn = anyFilter(filters);

  // Season numbers for the teams listed and the Compare's sides, in one request.
  const teamNums = useMemo(() => [...new Set([
    ...compares.flatMap(compareTeams),
    ...hits.filter((h) => h.kind === "team" && !isCompare(h)).map((h) => Number(h.ref)).filter(Number.isInteger),
  ])].slice(0, 100), [hits, compares]);
  // A Compare that names a season ("4215 vs 6980 2024-25") previews that season, like the comparison it opens.
  // Otherwise: this season, and early in it (most teams have no numbers yet) last season's, labelled with it.
  const h2h = compares.find((c) => compareTeams(c).length >= 2);
  const asked = h2h ? compareSeason(h2h) : null;
  const base = asked ?? season;
  const sumPath = (s: number) => (teamNums.length ? `/api/teams-summary${qs({ season: s, teams: teamNums.join(",") })}` : null);
  const now = useApi<{ teams: TeamSummary[] }>(sumPath(base));
  const before = useApi<{ teams: TeamSummary[] }>(asked == null ? sumPath(season - 1) : null);
  const summaries = useMemo(() => teamSeasons(now.data?.teams, asked == null ? before.data?.teams : undefined, base), [now.data, before.data, base, asked]);

  const showing = !found ? null : ax?.interpreted ?? (answer ? showingLine({ ...answer, hits }) : null);
  const open = (h: SearchHit) => logPick(h);
  return (
    <div className="w-full max-w-6xl pt-4 sm:pt-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {!query ? "Search" : found || busy || error ? <>Here's what we found for “{query}”</> : <>No matches for “{query}”</>}
      </h1>
      {showing && <p className="mt-1.5 text-sm text-muted-foreground">Showing: <span className="font-medium text-foreground">{showing}</span></p>}
      {/* A plain GET form to this page (the browser's own idea of the site's search), kept in the app. */}
      {/* Enter (a phone's Search key) or the magnifier: results now, not after the typing pause, and the keyboard closes so they show. */}
      <form role="search" action="/search" method="get" className="mt-4 max-w-4xl" onSubmit={(e) => { e.preventDefault(); searchNow(); e.currentTarget.querySelector("input")?.blur(); }}>
        <div className="flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card pl-1.5 pr-3 text-foreground transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]">
          <button type="submit" aria-label="Search" className="grid size-8 shrink-0 place-items-center rounded-lg text-accent hover:bg-accent/[0.1]">
            {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <Search className="size-4" />}
          </button>
          <input
            type="search" name="q" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search teams, events and matches"
            placeholder="Team number, team or event name, or a match like USNJCMP Q12"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>
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
          : !found ? (
            busy ? <p className="text-sm text-muted-foreground">Searching…</p>
              : meta && !meta.dataLoaded ? <p className="text-sm text-muted-foreground">No FTC data has been loaded on this server yet, so there's nothing to search.</p>
              : (
                <NoResults
                  query={query} onOpen={open}
                  understood={ax?.interpreted ? [ax.interpreted] : notes.understood}
                  fallback={ax?.fallback}
                  closest={sections.find((s) => s.id === "closest")?.rows.filter((r) => !r.sub).map((r) => r.hit) ?? []}
                />
              )
          ) : (
            <div className={cn("transition-opacity", stale && "opacity-60")} aria-busy={stale || undefined}>
              <AnswerNotesView notes={notes} query={query} className="mb-4 text-sm" />
              {(events >= 2 || choices.seasons.length > 1 || filtersOn) && <div className="mb-4"><SearchFilters f={filters} seasons={choices.seasons} types={choices.types} onChange={setFilters} /></div>}
              <div className={cn(h2h && "lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-6")}>
                <div className="min-w-0">
                  <BrunoAnswer q={q} prefer={prefer} ready={!busy && !stale} className="mb-4" />
                  {answer?.card && <div className="mb-5"><AnswerCard card={answer.card} onOpen={(href) => nav(href)} /></div>}
                  {!!compares.length && (
                    <section aria-label="Compare" className="mb-5" data-section="compare">
                      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Compare</h2>
                      <div className="space-y-2">{compares.map((c) => <CompareCard key={c.href ?? c.ref} h={c} summaries={summaries} onOpen={() => open(c)} />)}</div>
                    </section>
                  )}
                  {view.map((s) => <ResultSection key={s.id} s={s} summaries={summaries} fuzzyWord={ax?.fuzzyWord} twoCol={!!h2h} onOpen={open} />)}
                  {filtersOn && !view.some((s) => RESULT_KINDS.has(s.id) || s.id === "top" || s.id === "fuzzy") && (
                    <div className="rounded-xl border border-border bg-card px-4 py-3.5 text-sm" data-filtered-empty>
                      <p className="text-foreground">No results match these filters.</p>
                      <button type="button" onClick={() => setFilters({ when: "all", season: null, type: null })} className="mt-1.5 text-sm font-medium text-accent-text hover:underline">Clear filters</button>
                    </div>
                  )}
                </div>
                {h2h && <div className="max-lg:hidden lg:sticky lg:top-[calc(var(--header-h)+1rem)]"><HeadToHead h={h2h} now={now.data?.teams} before={asked == null ? before.data?.teams : undefined} season={base} /></div>}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

type ViewSection = Omit<AnswerSection, "id"> & { id: AnswerSection["id"] | "top" | "fuzzy" };

/** The sections as the page lists them: no Compare among the teams, the filters applied (a team's events go with
 *  it), and, when some teams only share a word with the query, the exact ones apart from them. */
function shape(sections: AnswerSection[], f: PageFilters): ViewSection[] {
  const out: ViewSection[] = [];
  for (const s of sections) {
    const rows = s.rows.filter((r) => !isCompare(r.hit) && (r.sub || !RESULT_KINDS.has(s.id) || keeps(r.hit, f)));
    if (!rows.some((r) => !r.sub)) continue;
    if (s.id === "team" && rows.some((r) => !r.sub && isFuzzy(r.hit))) {
      const exact: AnswerRow[] = [], fuzzy: AnswerRow[] = [];
      let into = exact;
      for (const r of rows) { if (!r.sub) into = isFuzzy(r.hit) ? fuzzy : exact; into.push(r); }
      if (exact.length) out.push({ id: "top", title: "Top match", rows: exact });
      out.push({ id: "fuzzy", title: "Other teams", rows: fuzzy });
      continue;
    }
    out.push({ ...s, rows });
  }
  return out;
}

function ResultSection({ s, summaries, fuzzyWord, twoCol, onOpen }: { s: ViewSection; summaries: Map<number, SeasonSummary>; fuzzyWord?: string; twoCol: boolean; onOpen: (h: SearchHit) => void }) {
  const count = s.rows.filter((r) => !r.sub).length;
  const title = s.id === "fuzzy" && fuzzyWord ? `Other teams matching “${fuzzyWord}”` : s.title;
  const teamish = s.id === "team" || s.id === "top" || s.id === "fuzzy";
  // A team card, then its events (each its own link) under it.
  const teamGroups: { head: AnswerRow; subs: AnswerRow[] }[] = [];
  if (teamish) for (const r of s.rows) { if (!r.sub || !teamGroups.length) teamGroups.push({ head: r, subs: [] }); else teamGroups[teamGroups.length - 1].subs.push(r); }
  return (
    <section aria-label={title} className="mb-5" data-section={s.id}>
      <h2 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        {s.id !== "pages" && s.id !== "browse" && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-foreground/80">{count}</span>}
      </h2>
      {s.id === "event" ? (
        <div className={cn("grid gap-3 sm:grid-cols-2", twoCol ? "2xl:grid-cols-3" : "xl:grid-cols-3")}>{s.rows.map((r) => <EventCard key={r.key} h={r.hit} onOpen={() => onOpen(r.hit)} />)}</div>
      ) : teamish ? (
        <div className="space-y-2">
          {teamGroups.map(({ head, subs }) => (
            <div key={head.key}>
              <TeamCard h={head.hit} summary={summaries.get(Number(head.hit.ref))} onOpen={() => onOpen(head.hit)} />
              {!!subs.length && (
                <ul className="mt-1 overflow-hidden rounded-xl border border-border bg-card">
                  {subs.map((r) => <li key={r.key} className="border-b border-border last:border-b-0"><ResultRow h={r.hit} icon="event" sub onOpen={() => onOpen(r.hit)} /></li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {s.rows.map((r) => (
            <li key={r.key} className="border-b border-border last:border-b-0">
              <ResultRow h={r.hit} sub={r.sub} onOpen={() => onOpen(r.hit)}
                icon={s.id === "pages" ? "page" : s.id === "browse" ? "browse" : r.sub ? "event" : r.hit.kind === "team" ? "team" : r.hit.kind} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
