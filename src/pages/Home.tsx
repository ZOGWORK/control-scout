// Home, the FTC observatory: search and the two main actions first, with the
// season's coverage and your team under them, beside a country atlas of this
// season's teams; then today's coin flips (the closest calls at every event on today), what's on the calendar, the public prediction record and Control Scout's own
// opt-in usage. On a phone it reads in task order: search, the season, your team
// and events come before the atlas. The brand lives in the shell's chrome.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, ArrowUpRight, CalendarDays, LockOpen, MapPin, Radio, Sparkles } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useMediaQuery, useTitle } from "../lib/meta";
import { usePersonal, type AccountUser } from "../lib/personal";
import { myTeamsOf } from "../lib/myTeams";
import { countryOf } from "../shared/countries";
import type { EventListItem, TeamSummary } from "../shared/api";
import type { HomeOverview } from "../shared/home";
import { SEARCH_HINT, hitHref, usePageSearch, useSearch } from "../components/layout/Search";
import { SearchBox } from "../components/search/SearchBox";
import { Badge } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { Reveal } from "../components/motion";
import { CompetitionAtlas, preloadAtlas } from "../components/home/CompetitionAtlas";
import { FindYourTeam, OnTheCalendar, PredictionRecord, PublicUsagePanel, SeasonCoverage, YourTeam } from "../components/home/HomeSections";
import { HOME_ABOUT, HOME_HEADLINE_MS, HOME_HEADLINES, HOME_LEAD, homeHeadlineAt } from "../shared/boot";
import { cn } from "../components/cn";
import { readBootLines, useHeroLines } from "../lib/heroLines";
import { dateRange, place } from "../lib/format";

/** The member's home team: their Control Point team (admin teams first), else the team they follow. */
export function homeTeamOf(user: AccountUser, myTeam: number | null): number | null {
  return myTeamsOf(user).teams[0]?.teamNumber ?? myTeam ?? null;
}

/** The country of a team's reported place ("Oradell, NJ, USA" is US), or null while unknown. Same request
 *  as the Your team card's, so it's usually answered from the cache. */
function useHomeCountry(team: number | null, season: number): string | null {
  const info = useApi<{ teams: TeamSummary[] }>(team ? `/api/teams-summary${qs({ season, teams: String(team) })}` : null);
  const place = info.data?.teams[0]?.place;
  return place ? countryOf(place.split(",").at(-1)?.trim())?.code ?? null : null;
}

export default function Home() {
  useTitle(null);
  // Home stays Home for everyone: your team shows here, it never redirects to My team.
  const { state, user } = usePersonal();
  const season = useCurrentSeason();
  // The atlas opens on the member's home team's country (signed out: the United States).
  const homeCountry = useHomeCountry(user ? homeTeamOf(user, state.myTeam) : null, season);
  // A search from outside (/?q=…, the site search named in the home page's structured data).
  const [sp] = useSearchParams();
  const query = sp.get("q")?.trim().slice(0, 100) || undefined;
  // The atlas's code and boundaries load beside the page's data, after the hero has painted.
  useEffect(() => { const t = setTimeout(preloadAtlas, 0); return () => clearTimeout(t); }, []);
  const overview = useApi<HomeOverview>(`/api/home/overview${qs({ season })}`);
  const phone = useMediaQuery("(max-width: 639px)");
  const search = useSearch();
  return (
    <div className="@container/home">
      <div className="home-grid">
        <div className="[grid-area:hero]"><Hero query={query} /></div>
        <div className="[grid-area:strip]"><SeasonCoverage state={overview} /></div>
        <div className="[grid-area:team]">{state.myTeam ? <YourTeam team={state.myTeam} season={season} /> : <FindYourTeam onSearch={search.open} />}</div>
        <div className="[grid-area:events]"><OnTheCalendar season={season} /></div>
        <div className="[grid-area:atlas]">
          {overview.data ? <CompetitionAtlas overview={overview.data} currentSeason={season} compact={phone} homeCountry={homeCountry} /> : <AtlasPending failed={!!overview.error} onRetry={overview.reload} />}
        </div>
        <div className="[grid-area:record]"><PredictionRecord /></div>
        <div className="[grid-area:usage]"><PublicUsagePanel /></div>
      </div>
      <footer className="mt-10 max-sm:mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm text-text-muted">
        <span>FTC, with a clearer view.</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <Link to="/methodology" className="inline-flex items-center hover:text-text-base hover:underline max-sm:min-h-10">How the numbers work</Link>
          <Link to="/download" className="inline-flex items-center hover:text-text-base hover:underline max-sm:min-h-10">Offline packs</Link>
          <Link to="/compare" className="inline-flex items-center hover:text-text-base hover:underline max-sm:min-h-10">Compare teams</Link>
        </span>
      </footer>
    </div>
  );
}

/** The headline a server first paint in `doc` shows (its data-line, out of `count` lines) and the hour it was read in, or null. */
export function readBootHeadline(doc: Document, now: number, count: number = HOME_HEADLINES.length): { line: number; hour: number } | null {
  const raw = doc.querySelector<HTMLElement>("#cs-boot-page h1")?.dataset.line ?? "";
  const line = /^\d+$/.test(raw) ? Number(raw) : -1;
  return line >= 0 && line < count ? { line, hour: Math.floor(now / HOME_HEADLINE_MS) } : null;
}

/** The first paint's headline, read before the app replaces that paint (out of the lines that paint carried). */
const BOOT_HEADLINE = typeof document === "undefined" ? null : readBootHeadline(document, Date.now(), readBootLines(document)?.length);

/** The headline to start on, out of `count` lines: in the hour the page loaded, the first paint's line (that HTML
 *  may have been rendered a moment earlier, or come from the offline cache); after that, the clock's. */
export function startingHeadline(boot: { line: number; hour: number } | null, now: number, count: number = HOME_HEADLINES.length): number {
  return boot && boot.line < count && boot.hour === Math.floor(now / HOME_HEADLINE_MS) ? boot.line : homeHeadlineAt(now, count);
}

/** This hour's headline out of `count` lines, changing on the hour while the page stays open. When the lines
 *  themselves change (only without a first paint: they arrive from the API), it's the clock's line among the new ones. */
export function useHomeHeadline(count: number = HOME_HEADLINES.length, boot = BOOT_HEADLINE): { line: number; changed: boolean } {
  const [at, setAt] = useState(() => ({ count, line: startingHeadline(boot, Date.now(), count) }));
  const [tick, setTick] = useState(0);
  const countRef = useRef(count);
  countRef.current = count;
  useEffect(() => {
    const t = setTimeout(() => { setAt({ count: countRef.current, line: homeHeadlineAt(Date.now(), countRef.current) }); setTick((n) => n + 1); }, HOME_HEADLINE_MS - (Date.now() % HOME_HEADLINE_MS) + 50);
    return () => clearTimeout(t);
  }, [tick]);
  return { line: at.count === count ? at.line : homeHeadlineAt(Date.now(), count), changed: tick > 0 };
}

/** The hero's headline: one H1 with this hour's line. Every line sits invisibly in the same grid cell, so the
 *  hero is always as tall as the longest line and the hourly change never moves the page. A change fades in
 *  (no motion under reduced motion); it isn't announced, as nothing new happened on the page. */
function Headline() {
  const lines = useHeroLines();
  const { line, changed } = useHomeHeadline(lines.length);
  const [first, second] = lines[line];
  return (
    <div className="grid font-display text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] @lg/home:text-5xl @4xl/home:text-[3.5rem] @6xl/home:text-[4rem]">
      {lines.map(([a, b], i) => (
        <span key={i} aria-hidden className="invisible [grid-area:1/1]">{a} <span className="block">{b}</span></span>
      ))}
      <h1 key={line} className={cn("[grid-area:1/1] font-semibold tracking-[-0.02em]", changed && "cs-headline-in")}>
        {first} <span className="block text-accent-display">{second}</span>
      </h1>
    </div>
  );
}

function Hero({ query }: { query?: string }) {
  // Home's search IS the page's search: the top-bar field steps aside here.
  const searchRef = usePageSearch();
  const nav = useNavigate();
  // The page's main content: full opacity on its first frame (no fade from 0).
  return (
    <Reveal fade={false} className="pt-2 @4xl/home:pt-8">
      <Headline />
      <p className="mt-4 max-w-[30rem] text-base text-text-muted">{HOME_LEAD}</p>
      <SearchBox
        size="lg" inputRef={searchRef} hint={SEARCH_HINT} tour="search" initialQuery={query}
        label="Search teams, events and matches"
        placeholder="Find a team, event or match…"
        onPick={(h) => nav(hitHref(h))}
        className="mt-6 max-sm:mt-4 w-full max-w-[36rem] [&>div:first-child]:rounded-xl"
      />
      {/* The page's main actions, above the fold at every size; they paint with the rest of the hero. */}
      <div className="mt-4 flex max-w-[36rem] flex-wrap gap-3">
        <Button size="lg" asChild className="max-sm:flex-1"><Link to="/predict" data-tour="predict"><Sparkles /> Predict a match <ArrowUpRight /></Link></Button>
        <Button size="lg" variant="secondary" asChild className="max-sm:flex-1"><Link to="/events"><CalendarDays /> Find an event <ArrowRight /></Link></Button>
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-sm text-text-muted"><LockOpen className="mt-0.5 size-4 shrink-0" aria-hidden /> {HOME_ABOUT}</p>
    </Reveal>
  );
}

/** The atlas's place while its numbers load (kept the same size), or a way back if they couldn't. */
function AtlasPending({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <section aria-label="FTC Control Scout: teams by country" className="@container/atlas min-w-0">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">FTC Control Scout</p>
      {failed ? (
        <div className="mt-3 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-5 max-sm:p-4 text-sm text-text-muted">
          Where this season’s teams are from couldn’t load.
          <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
        </div>
      ) : (
        // The globe's place, beside its country panel where there's room (as CompetitionAtlas lays it out).
        <div className="mt-3 @xl/atlas:grid @xl/atlas:grid-cols-[minmax(0,1fr)_15.5rem] @xl/atlas:gap-5" aria-hidden>
          <div className="mx-auto aspect-square w-full max-w-[30rem] rounded-full border border-line @max-xl/home:max-w-[22rem]" />
        </div>
      )}
    </section>
  );
}

/** An event as a card (the My team page's tracked events use it). */
export function EventCard({ e }: { e: EventListItem }) {
  return (
    <Link to={`/events/${e.season}/${e.code}`} className="lift group flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {e.status === "live" ? <Badge variant="destructive"><Radio /> Live</Badge> : e.status === "upcoming" ? <Badge variant="secondary">Upcoming</Badge> : <Badge variant="outline">Finished</Badge>}
        <span className="truncate text-xs text-muted-foreground">{e.typeLabel}</span>
        {e.matchesTotal > 0 && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{e.matchesPlayed}/{e.matchesTotal}</span>}
      </div>
      <p className="mt-2 line-clamp-2 font-medium leading-snug group-hover:text-accent-text">{e.name}</p>
      <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />{dateRange(e.start, e.end)}</p>
      <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><MapPin className="size-3.5 shrink-0" />{place(e.city, e.state, e.country) || "Location TBA"}{e.teams ? ` · ${e.teams} teams` : ""}</p>
    </Link>
  );
}
