// Home, the FTC observatory: search and the two main actions first, with the
// season's coverage and your team under them, beside a country atlas of this
// season's teams; then what's on the calendar, the public prediction record and Control Scout's own
// opt-in usage. On a phone it reads in task order: search, the season, your team
// and events come before the atlas. The brand lives in the shell's chrome.
import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, ArrowUpRight, CalendarDays, LockOpen, MapPin, Radio, Sparkles } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useMediaQuery, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { EventListItem } from "../shared/api";
import type { HomeOverview } from "../shared/home";
import { SEARCH_HINT, hitHref, usePageSearch, useSearch } from "../components/layout/Search";
import { SearchBox } from "../components/search/SearchBox";
import { Badge } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { Reveal } from "../components/motion";
import { CompetitionAtlas, preloadAtlas } from "../components/home/CompetitionAtlas";
import { FindYourTeam, OnTheCalendar, PredictionRecord, PublicUsagePanel, SeasonCoverage, YourTeam } from "../components/home/HomeSections";
import { HOME_ABOUT, HOME_HEADLINE, HOME_LEAD } from "../shared/boot";
import { dateRange, place } from "../lib/format";

export default function Home() {
  useTitle(null);
  const { user, state } = usePersonal();
  const nav = useNavigate();
  const season = useCurrentSeason();
  // A search from outside (/?q=…, the site search named in the home page's structured data).
  const [sp] = useSearchParams();
  const query = sp.get("q")?.trim().slice(0, 100) || undefined;
  // Signed-in users with a team land on their dashboard (once per visit), unless they came to search.
  useEffect(() => {
    if (user && state.myTeam && !query && !sessionStorage.getItem("cs-landed")) {
      sessionStorage.setItem("cs-landed", "1");
      nav("/my-team", { replace: true });
    }
  }, [user, state.myTeam, query, nav]);
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
          {overview.data ? <CompetitionAtlas overview={overview.data} currentSeason={season} compact={phone} /> : <AtlasPending failed={!!overview.error} onRetry={overview.reload} />}
        </div>
        <div className="[grid-area:record]"><PredictionRecord /></div>
        <div className="[grid-area:usage]"><PublicUsagePanel /></div>
      </div>
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm text-text-muted">
        <span>FTC, with a clearer view.</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <Link to="/methodology" className="inline-flex items-center hover:text-text-base hover:underline max-sm:min-h-11">How the numbers work</Link>
          <Link to="/download" className="inline-flex items-center hover:text-text-base hover:underline max-sm:min-h-11">Offline packs</Link>
          <Link to="/compare" className="inline-flex items-center hover:text-text-base hover:underline max-sm:min-h-11">Compare teams</Link>
        </span>
      </footer>
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
      <h1 className="font-display text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] @lg/home:text-5xl @4xl/home:text-[3.5rem] @6xl/home:text-[4rem]">
        {HOME_HEADLINE[0]} <span className="block text-accent-display">{HOME_HEADLINE[1]}</span>
      </h1>
      <p className="mt-4 max-w-[30rem] text-base text-text-muted">{HOME_LEAD}</p>
      <SearchBox
        size="lg" inputRef={searchRef} hint={SEARCH_HINT} tour="search" initialQuery={query}
        label="Search teams, events and matches"
        placeholder="Find a team, event or match…"
        onPick={(h) => nav(hitHref(h))}
        className="mt-6 w-full max-w-[36rem] [&>div:first-child]:rounded-xl"
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
        <div className="mt-3 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-5 text-sm text-text-muted">
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
