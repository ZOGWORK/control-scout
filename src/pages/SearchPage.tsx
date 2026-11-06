// /search?q=…: where the browser's address-bar search lands ("Press Tab to search Control Scout",
// server/openSearch.ts). The same results as the header's box (useSearchHits, content only: teams, events,
// matches and places), as a page of cards. The server already lists them in the first paint (server/seoMeta.ts
// searchMeta) and hands them over (src/lib/searchBoot.ts), and the query lives in the address, so a direct
// visit never waits on the header's state. Plain Enter in any search box and its "See all results" row land here.
// Titled by what was found ("Worlds appearances for ENFORCERS (7149)", src/shared/searchPage.ts), never the query as typed (that
// stays in the top bar, where it's refined), with one badge for what the query was read as; then the question's direct answer when it asked one (from stored
// data: server/api/searchQuestions.ts), a Compare as its own card above the teams, then teams (with their season
// numbers), events (as blocks with date and status), matches and pages. Filters for time, season and event type
// narrow the results here, in the address (./search/page/results.ts). A question also gets Bruno AI's short
// written answer on top, from those same records (./search/BrunoAnswer.tsx). Nothing found is never a dead end
// (./search/page/NoResults.tsx).
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Info, RefreshCw, ScanSearch } from "lucide-react";
import { Button } from "../components/ui/button";
import { seasonLabel } from "../lib/format";
import { BrunoAnswer } from "../components/search/BrunoAnswer";
import { EventAwardsAnswer } from "../components/search/page/EventAwards";
import { useSubmittedSearch } from "../components/search/direct";
import { SearchSkeleton } from "../components/search/SearchSkeleton";
import { AnswerNotesView, useSearchHits, useSections } from "../components/search/SearchBox";
import { CompareCard, EventCard, HeadToHead, ResultRow, TeamCard, teamSeasons, type SeasonSummary } from "../components/search/page/ResultCards";
import { NoResults, SorryNote } from "../components/search/page/NoResults";
import { StatAnswerCard } from "../components/search/page/StatAnswer";
import { AnswerVideo, AnswerVideoProvider } from "../components/search/page/AnswerVideo";
import { comparisonOf } from "../components/search/page/CompareCard";
import { FactCard } from "../components/search/page/FactCard";
import { RelatedQuestions } from "../components/search/page/TeamAnswer";
import { PhoneSearchBar } from "../components/search/page/PhoneSearchBar";
import { PhoneTeamCard } from "../components/search/page/PhoneTeamActions";
import { CompareBar, CompareSheet, togglePick } from "../components/search/page/PhoneCompare";
import { AppearancesAnswer, QualityBanner, StatBanner, Timeline } from "../components/search/page/Summary";
import { appearanceStats, appearances, isQualityQuestion, hasNumbers, standing } from "../components/search/page/records";
import { SearchFilters } from "../components/search/page/SearchFilters";
import { openFamilies, type FamilyStatus } from "../components/search/page/eventFamilies";
import { eventSections, eventStatuses, localDay } from "../components/search/page/eventSections";
import { SEARCH_PALETTE } from "../lib/textTones";
import { EventTree } from "../components/search/page/EventTree";
import { answerTeams, anyFilter, askedWhen, filteredTitle, filterAlternatives, whenCounts, compareSeason, compareSides, compareTeams, filterChoices, cardTeamName, isCompare, isFuzzy, keeps, pageTitle, contextBadge, badgeUnder, readingOf, fuzzyWords, readFilters, teamParts, withFilters, type AnswerExtra, type PageFilters, type Statuses } from "../components/search/page/results";
import { SEARCH_PAGE_LIMIT } from "../shared/search";
import type { AnswerRow, AnswerSection } from "../shared/searchSections";
import type { SearchHit, TeamSummary } from "../shared/api";
import { BOOT_HITS } from "../lib/searchBoot";
import { useTitle, useMeta, useCurrentSeason, useMediaQuery } from "../lib/meta";
import { useApi, qs } from "../lib/api";
import { cn } from "../components/cn";
import { Verdict } from "../components/search/page/Verdict";

const RESULT_KINDS = new Set(["place", "team", "event", "match"]);

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const query = q.trim();
  const { hits, answer, busy, error, retry, logPick, stale, prefer, searchNow, live } = useSearchHits(q, undefined, SEARCH_PAGE_LIMIT, BOOT_HITS, false);
  const { sections, notes } = useSections(hits, answer, null);
  const ax = answer as AnswerExtra | undefined;
  // The time tab follows the query ("upcoming meets …" opens on Upcoming); a pick of another is kept in the address.
  const askedTime = askedWhen(ax);
  const filters = readFilters(params, askedTime);
  // Asked at once, and on to the one page a submitted query names (../components/search/direct.ts).
  const leaving = useSubmittedSearch(query, { answer, live, error, searchNow });
  const phone = useMediaQuery("(max-width: 767px)");
  const meta = useMeta();
  const season = useCurrentSeason();
  useTitle(query ? `Search: ${query}` : "Search");
  // "Did you mean: …" runs the corrected query, as a new search Back returns from.
  const nav = useNavigate();
  const runFix = (fix: string) => nav(`/search?q=${encodeURIComponent(fix)}`);
  // Each filter change is a step Back can undo.
  const setFilters = (f: PageFilters) => setParams(withFilters(params, f, askedTime));

  // A Compare is its own card above the teams, never one of them (nor counted with them).
  const compares = useMemo(() => hits.filter(isCompare), [hits]);
  // The teams the answer already shows get no card of their own under it (each team once), only a profile link.
  const named = useMemo(() => answerTeams(answer, compares), [answer, compares]);
  // One status per event, a family's for all of it, chosen among the events the season and type filters keep: the
  // sections, the time filter and the tab counts all read it.
  const statusesFor = (f: PageFilters) => eventStatuses(hits.filter((h) => keeps(h, { ...f, when: "all" })));
  const statuses = useMemo(() => statusesFor(filters), [hits, filters.season, filters.type]);
  const view = useMemo(() => shape(sections, filters, new Set(named), statuses), [sections, filters.when, filters.season, filters.type, named, statuses]);
  const choices = useMemo(() => filterChoices(hits), [hits]);
  // Site pages a query names ("rules", "rankings") are an answer too.
  const found = sections.some((s) => (RESULT_KINDS.has(s.id) || s.id === "pages") && s.rows.some((r) => !isCompare(r.hit))) || compares.length > 0 || !!answer?.card || !!answer?.stat;
  const events = hits.filter((h) => h.kind === "event").length;
  const filtersOn = anyFilter(filters, askedTime);
  const counts = useMemo(() => whenCounts(hits, filters, undefined, statuses), [hits, filters.when, filters.season, filters.type, statuses]);

  // The closest real results when nothing answers (./search/page/NoResults.tsx), drawn as full cards.
  const closest = useMemo(() => sections.find((s) => s.id === "closest")?.rows.filter((r) => !r.sub).map((r) => r.hit) ?? [], [sections]);
  // Season numbers for the teams listed, the closest ones and the Compare's sides, in one request.
  const teamNums = useMemo(() => [...new Set([
    ...compares.flatMap(compareTeams),
    ...[...hits, ...closest].filter((h) => h.kind === "team" && !isCompare(h)).map((h) => Number(h.ref)).filter(Number.isInteger),
  ])].slice(0, 100), [hits, closest, compares]);
  // A query that names a season ("4215 vs 6980 2024-25", "4215 2024-25": the Compare's link, a team hit's linkSeason)
  // shows that season, like the page it opens. Otherwise: this season, and early in it (most teams have no numbers
  // yet) last season's, labelled with it. A team hit asking for yet another season gets no badges (never another's).
  const h2h = compares.find((c) => compareTeams(c).length >= 2);
  // Numbers print once: an answer card that already sets the teams side by side takes the head-to-head panel's place
  // (the Compare still picks the season the page shows).
  const sideBySide = answer?.stat?.family === "two-team" && answer.stat.blocks.some((b) => b.kind === "compare");
  const shownH2h = sideBySide ? undefined : h2h;
  // The closest results when nothing answers count too: a card opening a season shows that season's numbers.
  const listed = useMemo(() => [...hits, ...closest], [hits, closest]);
  const asked = (h2h ? compareSeason(h2h) : null) ?? listed.find((h) => h.kind === "team" && h.linkSeason != null)?.linkSeason ?? null;
  const base = asked ?? season;
  const sumPath = (s: number) => (teamNums.length ? `/api/teams-summary${qs({ season: s, teams: teamNums.join(",") })}` : null);
  const now = useApi<{ teams: TeamSummary[] }>(sumPath(base));
  const before = useApi<{ teams: TeamSummary[] }>(asked == null ? sumPath(season - 1) : null);
  // Phones: teams picked with VS Compare for the Compare (2) bar (this search's own: a new search starts empty), and
  // the Compare result whose head-to-head is open over the results.
  const [picks, setPicks] = useState<number[]>([]);
  // While a new search loads, the last one's results stay on screen dimmed: picking or previewing them does nothing.
  const pick = (t: number) => { if (!stale) setPicks((p) => togglePick(p, t)); };
  // The open head-to-head, the card it was opened from (focus goes back to it on close) and the answer it belongs to:
  // only that answer's numbers ever fill it.
  const [sheet, setSheet] = useState<{ hit: SearchHit; from: HTMLElement; of: typeof answer } | null>(null);
  const preview = sheet?.of === answer ? sheet : null;
  // A new search (Back included) starts with no picks and no open preview: both belonged to the last one.
  const [pickedFor, setPickedFor] = useState(query);
  if (pickedFor !== query) { setPickedFor(query); setPicks([]); setSheet(null); }
  const pickNames = useMemo(() => {
    const m = new Map<number, string>();
    for (const h of hits) if (h.kind === "team" && !isCompare(h)) { const p = teamParts(h.title); if (p?.name) m.set(Number(p.number), p.name); }
    for (const c of compares) {
      for (const s of compareSides(c)) if (s.name && !m.has(s.number)) m.set(s.number, s.name);
      // An older server names the sides only in the title ("4215 Hypnotic Robotics vs 23268 Ultraviolet").
      for (const t of c.title.split(/\s+vs\.?\s+/i)) { const p = teamParts(t); if (p?.name && !m.has(Number(p.number))) m.set(Number(p.number), p.name); }
    }
    return m;
  }, [hits, compares]);
  const summaries = useMemo(() => {
    const m = teamSeasons(now.data?.teams, asked == null ? before.data?.teams : undefined, base);
    for (const h of listed) if (h.kind === "team" && h.linkSeason != null && h.linkSeason !== base) m.delete(Number(h.ref));
    return m;
  }, [now.data, before.data, base, asked, listed]);
  // One line for what the query was read as (the server's reading, else the top result's subject and what it opens on).
  // A comparison card names its teams in its own title: the heading keeps the numbers only, so each name shows once
  // (the search results guide).
  // A set of events the filters narrow says what's left ("…, 2024–25"), as the tabs and cards count it.
  const narrowed = filteredTitle(ax, filters, askedTime);
  const title = found ? (answer?.stat && comparisonOf(answer.stat) ? answer.stat.title : narrowed ?? pageTitle(ax, hits, isQualityQuestion(query))) : null;
  // A question card's heading names its team in bold ("Where **Hypnotic Robotics (4215)** is from").
  const strong = title && ax?.card?.team ? cardTeamName(ax.card.team) : null;
  const shownTitle = strong && title!.includes(strong)
    ? <span className="font-medium">{title!.slice(0, title!.indexOf(strong))}<strong className="font-bold" data-title-team>{strong}</strong>{title!.slice(title!.indexOf(strong) + strong.length)}</span>
    : title;
  // A comparison says what it compares in its own card: no reading badge repeating the teams.
  // Nor does a heading the filters rewrote: the server's reading is of the whole set, which the page no longer shows.
  const badge = !found || !ax || narrowed || (answer?.stat && comparisonOf(answer.stat)) ? null : badgeUnder(title!, contextBadge({ ...ax, hits }, notes.understood));
  const open = (h: SearchHit) => logPick(h);
  // Phase 2 summary: a championship question's records as a timeline and stats; "how good is X" as X's standing.
  const apps = useMemo(() => appearances(answer?.card), [answer?.card]);
  const topTeam = hits.find((h) => h.kind === "team" && !isCompare(h));
  const topSum = topTeam && isQualityQuestion(query) ? summaries.get(Number(topTeam.ref)) : undefined;
  const std = topSum && !answer?.card ? standing(topSum.s, topSum.season) : null;
  // Only a standing with numbers to show becomes the summary; its team's card then shows none of the same numbers.
  const quality = std && hasNumbers(std) ? std : null;
  // A team-at-an-event answer keeps its card's facts: those are the event's numbers, not the summary's season ones.
  const covered = quality && topTeam && !topTeam.atEvent ? Number(topTeam.ref) : null;
  // The one right-hand panel (desktop): a versus query's head-to-head, else a question's computed summary.
  const panel: "versus" | "summary" | null = shownH2h ? "versus" : apps.length || quality ? "summary" : null;
  const aboutTeam = answer?.card?.team?.number ?? (quality && topTeam ? Number(topTeam.ref) : null);
  // Search answered it directly (a card or a stat answer, not a guess): Bruno isn't asked, so the page never shows his
  // card and the answer saying the same thing twice.
  const answered = !!answer && !answer.weak && !!(answer.card || answer.stat);
  const summary = (
    <BrunoAnswer q={q} prefer={prefer} ready={!busy && !stale} answered={answered} className="mb-4 lg:mb-0">
      {apps.length ? <><StatBanner stats={appearanceStats(apps, answer?.card?.kind === "worlds" ? "Worlds" : "states")} /><Timeline apps={apps} /></> : quality ? <QualityBanner s={quality} /> : null}
    </BrunoAnswer>
  );
  // A search on its way (just submitted, or a new one run from here): its loading screen, never older results; and
  // while going on to the one page a submitted query names.
  if (query && !error && ((busy && (stale || !found)) || leaving)) return <SearchSkeleton query={query} top={phone ? <PhoneSearchBar query={query} /> : null} />;
  return (
    // One results column, 640–720px and centred (the search results guide's §9: a line the eye can follow across a
    // card); a page with a side panel keeps that column and puts the panel beside it.
    <div className={cn("w-full pt-4 sm:pt-8", panel ? "max-w-6xl" : "mx-auto max-w-[720px]")} data-results-column={panel ? "with-panel" : ""}>
      {/* The feature's name sits above the title; the title names what was found, the badge what the query was read as.
          The query itself lives in the top bar (refine there): the page never repeats it. */}
      {/* Phones: the query in a bar that stays under the top bar, then a short header ("Results: …"), no eyebrow. */}
      {phone && <PhoneSearchBar query={query} />}
      {/* The accent is the selected control's alone on this page (the active time tab): the eyebrow is plain. */}
      <p className="text-xs font-semibold text-muted-foreground max-md:hidden" data-eyebrow>FTC One Search</p>
      <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-foreground max-md:mt-0 md:text-2xl lg:text-3xl">
        {!query ? "Search" : ax?.sorry && !busy && !error ? "Sorry — I can't answer that yet" : found ? <>{phone && "Results: "}{shownTitle}</> : busy || error ? "Search results" : "No matches found"}
      </h1>
      {badge && (
        <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground" data-context-badge>
          <ScanSearch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 break-words">{badge}</span>
        </p>
      )}
      {/* A long or wordy query said the short way: quietly, under the heading, which keeps the answer's own words. */}
      {found && ax?.understood?.showing && <p className="mt-1.5 break-words text-xs text-muted-foreground" data-showing>Showing: {ax.understood.showing}</p>}
      <div className="mt-5" aria-live="polite">
        {!query ? <p className="text-sm text-muted-foreground">Search any FTC team, event or match with the search bar at the top.</p>
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
                <>
                  {/* Nothing for the corrected query either: the correction is still said, as a tap. */}
                  {notes.didYouMean && <AnswerNotesView notes={{ didYouMean: notes.didYouMean, corrected: false, understood: [] }} className="mb-4 text-sm" onDidYouMean={runFix} />}
                  <NoResults
                    query={query} onOpen={open}
                    understood={readingOf(ax) ? [readingOf(ax)!] : notes.understood}
                    closest={closest} summaries={summaries} sorry={ax?.sorry}
                  />
                </>
              )
          ) : (
            <AnswerVideoProvider video={answer?.video}>
            <div className={cn("transition-opacity", stale && "opacity-60")} aria-busy={stale || undefined}>
              {/* The badge carries what was understood; a correction ("Did you mean …") and a gap still say so here. */}
              <AnswerNotesView notes={{ ...notes, understood: [] }} query={query} className="mb-4 text-sm" onDidYouMean={runFix} />
              {/* The server found nothing for all of it and shows the nearest set instead: said plainly, above that set. */}
              {ax?.understood?.fallback && (
                <p className="mb-4 flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/[0.08] px-3 py-2 text-sm text-foreground" data-fallback-label>
                  <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />{ax.understood.fallback}
                </p>
              )}
              {/* The team was found but not the answer: what search can answer about it, one tap each. */}
              {ax?.sorry ? <SorryNote sorry={ax.sorry} className="mb-5" />
                : !!ax?.suggest?.length && <RelatedQuestions queries={ax.suggest} title="Search can answer these about them" className="mb-5" />}
              {/* A yes-or-no question's answer, first: above the summary and the card that proves it. */}
              {answer?.verdict && <Verdict v={answer.verdict} />}
              {(events >= 2 || choices.seasons.length > 1 || filtersOn) && <div className="mb-4"><SearchFilters f={filters} seasons={choices.seasons} types={choices.types} counts={events ? counts : undefined} asked={askedTime} onChange={setFilters} /></div>}
              {/* Desktop: results left (at most 720px, narrower before the panel gets under 20rem), at most one panel
                  right, chosen by the query: a versus query's
                  head-to-head; else a question's summary (timeline, stats or standing) with the team's pages. With
                  both, the head-to-head keeps the column and the summary goes below the results. Phone: one column,
                  the summary first (H1, badge, summary, cards). */}
              <div className={cn(panel && "lg:grid lg:grid-cols-[minmax(0,720px)_minmax(20rem,1fr)] lg:items-start lg:gap-6")} data-layout={panel ?? "single"}>
                {panel === "summary" && (
                  <aside aria-label="Summary" className="mb-4 space-y-3 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:col-start-2 lg:row-start-1" data-panel="summary">
                    {summary}
                    {aboutTeam && <TeamLinks team={aboutTeam} season={apps.length ? null : quality?.season} />}
                  </aside>
                )}
                <div className="min-w-0 lg:col-start-1 lg:row-start-1">
                  {!panel && summary}
                  {/* A stat question's answer ("4215 highest score in worlds"): ./search/page/StatAnswer.tsx. */}
                  {answer?.stat && <StatAnswerCard stat={answer.stat} heading={title ?? undefined} />}
                  {/* A question's records: as cards the timeline jumps to (championships, newest first: a "when" question reads
                      from the latest), else the answer card as before. */}
                  {apps.length ? (
                    // Worlds or states trips: one card with the team up top, a record card per trip inside.
                    <AppearancesAnswer team={answer!.card!.team} title={answer!.card!.title} heading={title} headline={answer!.card!.headline} trip={answer!.card!.trip} apps={apps} />
                  ) : answer?.card?.kind === "event-awards" ? <EventAwardsAnswer card={answer.card} heading={title ?? undefined} />
                    : answer?.card && <FactCard card={answer.card} heading={title ?? undefined} season={hits.find((h) => h.kind === "team" && !isCompare(h) && Number(h.ref) === answer.card!.team?.number)?.linkSeason} />}
                  {/* A match or event searched by name (no answer card): its video above the results (./search/page/AnswerVideo.tsx). */}
                  {!answer?.stat && !answer?.card && <AnswerVideo className="mb-5 mt-0 max-sm:mx-0" />}
                  {!!compares.length && (
                    <section aria-label="Compare" className="mb-5" data-section="compare">
                      <h2 className="mb-1.5 text-xs font-semibold text-muted-foreground">Compare</h2>
                      <div className="space-y-2">{compares.map((c) => <CompareCard key={c.href ?? c.ref} h={c} summaries={summaries} onOpen={() => open(c)} preview={phone && compareTeams(c).length >= 2 ? (from) => { if (!stale) setSheet({ hit: c, from, of: answer }); } : undefined} />)}</div>
                    </section>
                  )}
                  {/* Phones: a versus query's side-by-side numbers under its Compare (desktop has them beside it). */}
                  {shownH2h && <div className="mb-5 lg:hidden"><HeadToHead h={shownH2h} now={now.data?.teams} before={asked == null ? before.data?.teams : undefined} season={base} /></div>}
                  {view.map((s) => <ResultSection key={s.id} s={s} statuses={statuses} summaries={summaries} covered={covered} picks={picks} onPick={pick} fuzzyWord={fuzzyWords(hits) ?? undefined} twoCol={!!panel} onOpen={open} />)}
                  {filtersOn && !view.some((s) => RESULT_KINDS.has(s.id) || s.id === "top" || s.id === "fuzzy") && (
                    // Never a dead end: what's empty, said plainly, and each choice that isn't, one tap away.
                    <div className="rounded-xl border border-border bg-card px-4 py-3.5 text-sm" data-filtered-empty>
                      <p className="text-foreground">{emptyLine(filters, hits)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {filterAlternatives(hits, filters, undefined, statusesFor).map((a) => (
                          <Button key={a.label} size="sm" variant="secondary" onClick={() => setFilters(a.f)} data-alternative>
                            Show {a.label}
                          </Button>
                        ))}
                        <button type="button" onClick={() => setFilters({ when: askedTime, season: null, type: null })} className="text-sm font-medium text-foreground underline-offset-2 hover:underline">Clear filters</button>
                      </div>
                    </div>
                  )}
                  {panel === "versus" && summary}
                </div>
                {panel === "versus" && shownH2h && <aside aria-label="Head-to-head" className="max-lg:hidden lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:col-start-2 lg:row-start-1" data-panel="versus"><HeadToHead h={shownH2h} now={now.data?.teams} before={asked == null ? before.data?.teams : undefined} season={base} /></aside>}
              </div>
            </div>
            </AnswerVideoProvider>
          )}
      {phone && (
        <>
          <CompareBar picks={picks} names={pickNames} season={asked} onDrop={pick} />
          <CompareSheet open={!!preview} onClose={() => setSheet(null)} returnTo={preview?.from} title={preview ? compareTeams(preview.hit).slice(0, 2).map((n) => pickNames.get(n) ? `${pickNames.get(n)} (${n})` : `Team ${n}`).join(" vs ") : ""}>
            {preview && <HeadToHead h={preview.hit} now={now.data?.teams} before={asked == null ? before.data?.teams : undefined} season={base} />}
          </CompareSheet>
        </>
      )}
      </div>
      <p className="mt-10 border-t border-border pt-4 text-sm text-muted-foreground max-md:mb-20">
        <Link to="/how-it-works/search" className="inline-flex items-center font-medium text-foreground underline-offset-2 hover:underline max-md:min-h-[44px] pointer-coarse:min-h-[44px]">How FTC One Search works</Link>
      </p>
    </div>
  );
}

type ViewSection = Omit<AnswerSection, "id"> & { id: AnswerSection["id"] | "top" | "fuzzy" };

/** The sections as the page lists them: no Compare among the teams, the filters applied (a team's events go with
 *  it), and, when some teams only share a word with the query, the exact ones apart from them. A team the answer
 *  already names (`named`) is left out, with its events. */
function shape(sections: AnswerSection[], f: PageFilters, named: Set<number>, statuses: Statuses): ViewSection[] {
  const out: ViewSection[] = [];
  for (const s of sections) {
    let dropped = false;
    const rows = s.rows.filter((r) => {
      if (!r.sub) dropped = s.id === "team" && r.hit.kind === "team" && named.has(Number(r.hit.ref));
      return !dropped && !isCompare(r.hit) && (r.sub || !RESULT_KINDS.has(s.id) || keeps(r.hit, f, undefined, statuses));
    });
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

function ResultSection({ s, statuses, summaries, covered, picks, onPick, fuzzyWord, twoCol, onOpen }: { s: ViewSection; statuses: Statuses; summaries: Map<number, SeasonSummary>; covered: number | null; picks: number[]; onPick: (team: number) => void; fuzzyWord?: string; twoCol: boolean; onOpen: (h: SearchHit) => void }) {
  const phone = useMediaQuery("(max-width: 767px)");
  const current = useCurrentSeason();
  const count = s.rows.filter((r) => !r.sub).length;
  const title = s.id === "fuzzy" && fuzzyWord ? `Other teams matching “${fuzzyWord}”` : s.title;
  const teamish = s.id === "team" || s.id === "top" || s.id === "fuzzy";
  // A team card, then its events (each its own link) under it.
  const teamGroups: { head: AnswerRow; subs: AnswerRow[] }[] = [];
  if (teamish) for (const r of s.rows) { if (!r.sub || !teamGroups.length) teamGroups.push({ head: r, subs: [] }); else teamGroups[teamGroups.length - 1].subs.push(r); }
  return (
    <section aria-label={title} className="mb-5" data-section={s.id}>
      <h2 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        {title}
        {s.id !== "pages" && s.id !== "browse" && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-foreground/80">{count}</span>}
      </h2>
      {s.id === "event" ? (
        <EventResults hits={s.rows.map((r) => r.hit)} statuses={statuses} twoCol={twoCol} onOpen={onOpen} />
      ) : teamish ? (
        <div className="space-y-2">
          {teamGroups.map(({ head, subs }) => (
            <div key={head.key}>
              {phone && /^\d+$/.test(head.hit.ref) ? (
                <PhoneTeamCard team={Number(head.hit.ref)} name={teamParts(head.hit.title)?.name ?? ""} season={head.hit.linkSeason ?? summaries.get(Number(head.hit.ref))?.season ?? head.hit.season ?? current} picked={picks.includes(Number(head.hit.ref))} onPick={() => onPick(Number(head.hit.ref))}>
                  <TeamCard h={head.hit} summary={summaries.get(Number(head.hit.ref))} bare={Number(head.hit.ref) === covered} onOpen={() => onOpen(head.hit)} />
                </PhoneTeamCard>
              ) : <TeamCard h={head.hit} summary={summaries.get(Number(head.hit.ref))} bare={Number(head.hit.ref) === covered} onOpen={() => onOpen(head.hit)} />}
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

/** The events, grouped before any card is drawn: by status (Live now, Upcoming, Finished), then by date
 *  (../components/search/page/eventSections.ts), then an event split in divisions as a tree a season, full width
 *  (../components/search/page/eventFamilies.ts), any other event a card in the grid. Every heading says how many
 *  events are under it. */
function EventResults({ hits, statuses, twoCol, onOpen }: { hits: SearchHit[]; statuses: Statuses; twoCol: boolean; onOpen: (h: SearchHit) => void }) {
  const sections = useMemo(() => eventSections(hits, localDay(), statuses as ReadonlyMap<string, FamilyStatus>), [hits, statuses]);
  const open = useMemo(() => openFamilies(sections.flatMap((s) => s.dates.flatMap((d) => d.groups))), [sections]);
  const grid = cn("grid gap-3 sm:grid-cols-2", twoCol ? "2xl:grid-cols-3" : "xl:grid-cols-3");
  return (
    <div className="space-y-8 max-sm:space-y-6" data-event-sections>
      {sections.map((s) => (
        <section key={s.status} aria-label={`${s.title}, ${s.count} ${s.count === 1 ? "event" : "events"}`} data-status-section={s.status}>
          {/* The status in its palette colour (lib/textTones SEARCH_PALETTE: live rose, upcoming cyan, finished lime), the
              same as the trees' bars and chips; the words and order say it without the colour. */}
          <h3 className={cn("mb-3 flex items-center gap-2 rounded-lg px-3 py-2 font-display text-base font-bold", SEARCH_PALETTE[s.status].fill)} data-section-tone={s.status}>
            {s.status === "live" && <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-white motion-reduce:animate-none" data-live-dot />}
            {s.title}<span className="sr-only">, </span><span className="rounded-full bg-black/25 px-2 text-sm tabular-nums" data-section-count>{s.count}</span>
          </h3>
          <div className="space-y-5">
            {s.dates.map((d) => (
              <div key={d.key} data-date-section={d.key}>
                {d.title && (
                  <h4 className={cn("mb-2 flex min-w-0 items-baseline gap-1.5 border-l-4 pl-2 text-sm font-semibold text-foreground", SEARCH_PALETTE[s.status].edge)}>
                    <span className="truncate">{d.title}</span><span className={cn("shrink-0 tabular-nums", SEARCH_PALETTE[s.status].text)}>· {d.count}</span>
                  </h4>
                )}
                <div className={grid}>
                  {d.groups.map((g) => (g.kind === "family"
                    ? <EventTree key={g.family.key} f={g.family} open={open.has(g.family.key)} onOpen={onOpen} />
                    : <EventCard key={g.hits[0].ref} h={g.hits[0]} onOpen={onOpen} />))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The team's own pages a summary leads on to (its scouting profile's parts and Compare), all existing routes, in the
 *  season the summary is about when it's about one (a standing). Awards isn't one: the profile has no awards section
 *  for a team without any, so that link could lead nowhere. */
function TeamLinks({ team, season }: { team: number; season?: number | null }) {
  const q = season != null ? `?season=${season}` : "";
  const links = [
    { label: "Scouting profile", to: `/teams/${team}${q}` },
    { label: "Season road map", to: `/teams/${team}${q}#history` },
    { label: "Matches", to: `/teams/${team}${q}#matches` },
    { label: "Compare with another team", to: `/compare?teams=${team}${season != null ? `&season=${season}` : ""}` },
  ];
  return (
    <nav aria-label={`Team ${team} pages`} className="rounded-xl border border-border bg-card p-3" data-team-links>
      <p className="px-1 text-xs font-semibold text-muted-foreground">Team {team}</p>
      <ul className="mt-1.5">
        {links.map((l) => <li key={l.to}><Link to={l.to} className="flex min-h-[44px] items-center justify-between rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted/60">{l.label}<ArrowRight className="size-4 text-muted-foreground" aria-hidden /></Link></li>)}
      </ul>
    </nav>
  );
}

/** What a filtered page with nothing left is missing, in words ("No past events in 2024–25 in these results."), named
 *  by what the filters narrow: events, matches (a season), or results when it's both. */
function emptyLine(f: PageFilters, hits: SearchHit[]): string {
  const kinds = new Set(hits.filter((h) => h.kind === "event" || h.kind === "match").map((h) => h.kind));
  const noun = kinds.size === 1 ? (kinds.has("match") ? "matches" : "events") : "results";
  const when = f.when === "all" ? "" : `${f.when} `;
  return `No ${when}${noun}${f.season != null ? ` in ${seasonLabel(f.season)}` : ""}${f.type ? " of this type" : ""} in these results.`;
}
