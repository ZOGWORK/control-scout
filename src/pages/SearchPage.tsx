// /search?q=…: where the browser's address-bar search lands ("Press Tab to search Control Scout",
// server/openSearch.ts). The same results as the header's box (useSearchHits, content only: teams, events,
// matches and places), as a page of cards. The server already lists them in the first paint (server/seoMeta.ts
// searchMeta) and hands them over (src/lib/searchBoot.ts), and the query lives in the address, so a direct
// visit never waits on the header's state. Plain Enter in any search box and its "See all results" row land here.
// Titled by what was found ("Team 7149 — Worlds Appearances", src/shared/searchPage.ts), never the query as typed (that
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
import { BrunoAnswer } from "../components/search/BrunoAnswer";
import { AnswerCard, AnswerNotesView, useSearchHits, useSections } from "../components/search/SearchBox";
import { CompareCard, EventCard, HeadToHead, ResultRow, TeamCard, teamSeasons, type SeasonSummary } from "../components/search/page/ResultCards";
import { NoResults } from "../components/search/page/NoResults";
import { PhoneSearchBar } from "../components/search/page/PhoneSearchBar";
import { PhoneTeamCard } from "../components/search/page/PhoneTeamActions";
import { CompareBar, CompareSheet, togglePick } from "../components/search/page/PhoneCompare";
import { AppearanceCard, QualityBanner, StatBanner, Timeline } from "../components/search/page/Summary";
import { appearanceStats, appearances, eventName, isQualityQuestion, hasNumbers, standing } from "../components/search/page/records";
import { SearchFilters } from "../components/search/page/SearchFilters";
import { anyFilter, compareSeason, compareSides, compareTeams, filterChoices, isCompare, isFuzzy, keeps, pageTitle, contextBadge, badgeUnder, readingOf, fuzzyWords, readFilters, teamParts, withFilters, type AnswerExtra, type PageFilters } from "../components/search/page/results";
import { SEARCH_PAGE_LIMIT } from "../shared/search";
import type { AnswerRow, AnswerSection } from "../shared/searchSections";
import type { SearchHit, TeamSummary } from "../shared/api";
import { BOOT_HITS } from "../lib/searchBoot";
import { useTitle, useMeta, useCurrentSeason, useMediaQuery } from "../lib/meta";
import { useApi, qs } from "../lib/api";
import { cn } from "../components/cn";

const RESULT_KINDS = new Set(["place", "team", "event", "match"]);

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const query = q.trim();
  const filters = readFilters(params);
  const { hits, answer, busy, error, retry, logPick, stale, prefer } = useSearchHits(q, undefined, SEARCH_PAGE_LIMIT, BOOT_HITS, false);
  const { sections, notes } = useSections(hits, answer, null);
  const ax = answer as AnswerExtra | undefined;
  const nav = useNavigate();
  const phone = useMediaQuery("(max-width: 767px)");
  const meta = useMeta();
  const season = useCurrentSeason();
  useTitle(query ? `Search: ${query}` : "Search");
  // Each filter change is a step Back can undo.
  const setFilters = (f: PageFilters) => setParams(withFilters(params, f));

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
  // A query that names a season ("4215 vs 6980 2024-25", "4215 2024-25": the Compare's link, a team hit's linkSeason)
  // shows that season, like the page it opens. Otherwise: this season, and early in it (most teams have no numbers
  // yet) last season's, labelled with it. A team hit asking for yet another season gets no badges (never another's).
  const h2h = compares.find((c) => compareTeams(c).length >= 2);
  const asked = (h2h ? compareSeason(h2h) : null) ?? hits.find((h) => h.kind === "team" && h.linkSeason != null)?.linkSeason ?? null;
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
    for (const h of hits) if (h.kind === "team" && h.linkSeason != null && h.linkSeason !== base) m.delete(Number(h.ref));
    return m;
  }, [now.data, before.data, base, asked, hits]);

  // One line for what the query was read as (the server's reading, else the top result's subject and what it opens on).
  const title = found ? pageTitle(ax, hits, isQualityQuestion(query)) : null;
  const badge = !found || !ax ? null : badgeUnder(title!, contextBadge({ ...ax, hits }, notes.understood));
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
  const panel: "versus" | "summary" | null = h2h ? "versus" : apps.length || quality ? "summary" : null;
  const aboutTeam = answer?.card?.team?.number ?? (quality && topTeam ? Number(topTeam.ref) : null);
  const summary = (
    <BrunoAnswer q={q} prefer={prefer} ready={!busy && !stale} className="mb-4 lg:mb-0">
      {apps.length ? <><StatBanner stats={appearanceStats(apps)} /><Timeline apps={apps} /></> : quality ? <QualityBanner s={quality} /> : null}
    </BrunoAnswer>
  );
  return (
    <div className="w-full max-w-6xl pt-4 sm:pt-8">
      {/* The feature's name sits above the title; the title names what was found, the badge what the query was read as.
          The query itself lives in the top bar (refine there): the page never repeats it. */}
      {/* Phones: the query in a bar that stays under the top bar, then a short header ("Results: …"), no eyebrow. */}
      {phone && <PhoneSearchBar query={query} />}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-text max-md:hidden" data-eyebrow>FTC One Search</p>
      <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-foreground max-md:mt-0 md:text-2xl lg:text-3xl">
        {!query ? "Search" : found ? <>{phone && "Results: "}{title}</> : busy || error ? "Search results" : <>No matches for “{query}”</>}
      </h1>
      {badge && (
        <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.07] px-2.5 py-1 text-xs font-medium text-foreground" data-context-badge>
          <ScanSearch className="size-3.5 shrink-0 text-accent" aria-hidden /><span className="min-w-0 break-words">{badge}</span>
        </p>
      )}
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
                <NoResults
                  query={query} onOpen={open}
                  understood={readingOf(ax) ? [readingOf(ax)!] : notes.understood}
                  closest={sections.find((s) => s.id === "closest")?.rows.filter((r) => !r.sub).map((r) => r.hit) ?? []}
                />
              )
          ) : (
            <div className={cn("transition-opacity", stale && "opacity-60")} aria-busy={stale || undefined}>
              {/* The badge carries what was understood; a correction ("Did you mean …") and a gap still say so here. */}
              <AnswerNotesView notes={{ ...notes, understood: [] }} query={query} className="mb-4 text-sm" />
              {/* The server found nothing for all of it and shows the nearest set instead: said plainly, above that set. */}
              {ax?.understood?.fallback && (
                <p className="mb-4 flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/[0.08] px-3 py-2 text-sm text-foreground" data-fallback-label>
                  <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />{ax.understood.fallback}
                </p>
              )}
              {(events >= 2 || choices.seasons.length > 1 || filtersOn) && <div className="mb-4"><SearchFilters f={filters} seasons={choices.seasons} types={choices.types} onChange={setFilters} /></div>}
              {/* Desktop: results left (65%), at most one panel right (35%), chosen by the query: a versus query's
                  head-to-head; else a question's summary (timeline, stats or standing) with the team's pages. With
                  both, the head-to-head keeps the column and the summary goes below the results. Phone: one column,
                  the summary first (H1, badge, summary, cards). */}
              <div className={cn(panel && "lg:grid lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)] lg:items-start lg:gap-6")} data-layout={panel ?? "single"}>
                {panel === "summary" && (
                  <aside aria-label="Summary" className="mb-4 space-y-3 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:col-start-2 lg:row-start-1" data-panel="summary">
                    {summary}
                    {aboutTeam && <TeamLinks team={aboutTeam} season={apps.length ? null : quality?.season} />}
                  </aside>
                )}
                <div className="min-w-0 lg:col-start-1 lg:row-start-1">
                  {!panel && summary}
                  {/* A question's records: as cards the timeline jumps to (championships, newest first: a "when" question reads
                      from the latest), else the answer card as before. */}
                  {apps.length ? (
                    <section aria-label={answer!.card!.title} className="mb-5" data-section="records">
                      <h2 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{answer!.card!.title}<span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-foreground/80">{apps.length}</span></h2>
                      <div className="grid gap-3 sm:grid-cols-2">{[...apps].reverse().map((a) => <AppearanceCard key={a.id} a={a} />)}</div>
                    </section>
                  ) : answer?.card && <div className="mb-5"><AnswerCard card={answer.card} onOpen={(href) => nav(href)} /></div>}
                  {!!compares.length && (
                    <section aria-label="Compare" className="mb-5" data-section="compare">
                      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Compare</h2>
                      <div className="space-y-2">{compares.map((c) => <CompareCard key={c.href ?? c.ref} h={c} summaries={summaries} onOpen={() => open(c)} preview={phone && compareTeams(c).length >= 2 ? (from) => { if (!stale) setSheet({ hit: c, from, of: answer }); } : undefined} />)}</div>
                    </section>
                  )}
                  {view.map((s) => <ResultSection key={s.id} s={s} summaries={summaries} covered={covered} picks={picks} onPick={pick} fuzzyWord={fuzzyWords(hits) ?? undefined} twoCol={!!panel} onOpen={open} />)}
                  {filtersOn && !view.some((s) => RESULT_KINDS.has(s.id) || s.id === "top" || s.id === "fuzzy") && (
                    <div className="rounded-xl border border-border bg-card px-4 py-3.5 text-sm" data-filtered-empty>
                      <p className="text-foreground">No results match these filters.</p>
                      <button type="button" onClick={() => setFilters({ when: "all", season: null, type: null })} className="mt-1.5 text-sm font-medium text-accent-text hover:underline">Clear filters</button>
                    </div>
                  )}
                  {panel === "versus" && summary}
                </div>
                {panel === "versus" && h2h && <aside aria-label="Head-to-head" className="max-lg:hidden lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:col-start-2 lg:row-start-1" data-panel="versus"><HeadToHead h={h2h} now={now.data?.teams} before={asked == null ? before.data?.teams : undefined} season={base} /></aside>}
              </div>
            </div>
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

function ResultSection({ s, summaries, covered, picks, onPick, fuzzyWord, twoCol, onOpen }: { s: ViewSection; summaries: Map<number, SeasonSummary>; covered: number | null; picks: number[]; onPick: (team: number) => void; fuzzyWord?: string; twoCol: boolean; onOpen: (h: SearchHit) => void }) {
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
      <h2 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        {s.id !== "pages" && s.id !== "browse" && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-foreground/80">{count}</span>}
      </h2>
      {s.id === "event" ? (
        <div className={cn("grid gap-3 sm:grid-cols-2", twoCol ? "2xl:grid-cols-3" : "xl:grid-cols-3")}>{bySeasons(s.rows.map((r) => r.hit)).map((g) => <EventCard key={g[0].ref} h={g[0]} seasons={g} onOpen={onOpen} />)}</div>
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

/** An event's name for grouping: a championship division by its own name ("Edison Division", whatever the year's
 *  championship was called), anything else by its whole name. */
const nameKey = (h: SearchHit) => eventName(h.title).title.trim().toLowerCase();

/** Events that share a name across seasons, as one group (a card with a tab per season) where the first stood.
 *  Every event stays reachable; two with one name in the same season stay apart. */
function bySeasons(hits: SearchHit[]): SearchHit[][] {
  const groups: SearchHit[][] = [];
  for (const h of hits) {
    const g = groups.find((x) => nameKey(x[0]) === nameKey(h) && !x.some((y) => y.season === h.season));
    if (g) g.push(h); else groups.push([h]);
  }
  return groups;
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
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Team {team}</p>
      <ul className="mt-1.5">
        {links.map((l) => <li key={l.to}><Link to={l.to} className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-foreground hover:bg-accent/[0.08] hover:text-accent-text">{l.label}<ArrowRight className="size-4 text-muted-foreground" aria-hidden /></Link></li>)}
      </ul>
    </nav>
  );
}
