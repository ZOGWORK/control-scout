// Events: a season's calendar grouped by week, with one filter bar — season,
// place (full names: "New Jersey", not "NJ"), event type, dates, status and
// text — all kept in the URL so a filtered list can be shared or bookmarked
// (search links here with ?region=USA:NJ).
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarDays, Users } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import type { EventListItem } from "../shared/api";
import { PageHeader, EmptyState } from "../components/page";
import { Async, LoadingBlock } from "../components/states";
import { OfflineNote } from "../components/OfflineNote";
import { Button } from "../components/ui/button";
import { SearchBox, hitHref } from "../components/search/SearchBox";
import { CoinFlipRadarSection } from "../components/home/CoinFlipRadar";
import { CurrentlyTracking } from "../components/CurrentlyTracking";
import { seasonLabel } from "../lib/format";
import { useCompactFilters } from "../components/CompactFilters";
import { EventFilterBar, EventWeeks } from "../components/EventBrowse";
import { MorphScope } from "../components/CardMorph";
import { EventsNow } from "../components/EventsNow";
import { useIsV8 } from "../lib/v8";
import { readFilters, statusParam, weekOf } from "./eventsList";

export default function EventsPage() {
  const current = useCurrentSeason();
  const [sp, setSp] = useSearchParams();
  const season = Number(sp.get("season")) || current;
  const { region, type, from, to, video, q: urlQ } = readFilters((k) => sp.get(k));
  // Status: All unless the address names one (opening on Live now hid the season behind a short list).
  const status = statusParam(sp.get("status")) ?? "all";
  const state = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season })}`);
  // One place for URL edits: empty values (and All) drop out, history isn't flooded while typing.
  const set = useCallback((patch: Record<string, string | null>, replace = true) => setSp((x) => {
    for (const [k, v] of Object.entries(patch)) {
      const none = v == null || v === "" || v === "all";
      if (none) x.delete(k); else x.set(k, v!);
    }
    return x;
  }, { replace }), [setSp]);
  // The text box is local state, so it updates on the keystroke: router updates run as transitions and
  // land late. The list filters on a deferred copy — the box never waits for the cards, and the cards
  // follow straight after instead of jumping in half a second later.
  const [q, setQ] = useState(urlQ);
  const wrote = useRef(urlQ);
  useEffect(() => { if (urlQ !== wrote.current) { wrote.current = urlQ; setQ(urlQ); } }, [urlQ]); // back/forward, Clear filters
  // Typing refines one history entry; taking the search off as a whole (its chip) is a step Back undoes.
  const onQ = (v: string, replace = true) => { setQ(v); wrote.current = v; set({ q: v }, replace); };
  const listQ = useDeferredValue(q);
  const clear = useCallback(() => set({ region: null, type: null, status: null, from: null, to: null, q: null, video: null }, false), [set]);
  useTitle(`Events ${seasonLabel(season)}`);
  const active = !!(region || type !== "all" || status !== "all" || from || to || q || video !== "all");
  const compact = useCompactFilters();
  const nav = useNavigate();
  const v8 = useIsV8();
  const events = state.data?.events;
  const filterBar = <EventFilterBar season={season} onSeason={(s) => set({ season: String(s), from: null, to: null }, false)} events={events ?? []} {...{ region, type, status, from, to, q, video, listQ, onQ, set, active }} onClear={clear} />;
  const list = (
    <Async state={state} loading={<div className="min-h-[100svh]"><LoadingBlock rows={8} label="Loading events" /></div>} empty={(d) => !d.events.length && <EmptyState icon={CalendarDays} title={`No events listed for ${seasonLabel(season)} yet`} />}>
      {(d) => <><OfflineNote data={d} what="Events list" /><MorphScope name="list"><EventWeeks events={d.events} {...{ region, type, status, from, to, video }} q={listQ} onClear={clear} /></MorphScope></>}
    </Async>
  );
  if (v8) {
    // v8 (docs/design/v8-revamp-brief.md §7.9, the PR's page plan): what's on now and next first, then search and
    // filters, then the long list. The summary line is one line whether the list is in or not, so nothing moves.
    const live = events?.filter((e) => e.status === "live").length ?? 0;
    const thisWeek = weekOf(new Date().toISOString().slice(0, 10));
    const week = events?.filter((e) => e.start && weekOf(e.start) === thisWeek).length ?? 0;
    // The season leads on wide screens; a phone has it in the season picker under, and keeps the live and week counts.
    const counts = [live ? `${live} live now` : null, season === current && week ? `${week} this week` : null].filter(Boolean).join(" · ");
    const summary = <><span className={counts ? "max-sm:hidden" : undefined}>{seasonLabel(season)} season{counts && " · "}</span>{counts}</>;
    return (
      <div data-events-page="v8">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[1.375rem] font-semibold leading-7 tracking-tight text-text-base">Events</h1>
            <p className="mt-1 truncate text-sm tabular-nums text-text-muted" data-events-summary>{summary}</p>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" asChild><Link to={`/teams${season !== current ? `?season=${season}` : ""}`}><Users /> Team records</Link></Button>
        </header>
        {season === current && <EventsNow events={events} loading={state.loading} onLive={() => set({ status: "live" }, false)} className="mb-5" />}
        {compact && <SearchBox kinds={["event", "place"]} label="Search events" placeholder="Find an event…" onPick={(h) => nav(hitHref(h))} className="mb-5 [&>div:first-child]:h-11" />}
        <CurrentlyTracking season={season} current={current} events={events} listSettled={!state.loading} className="mb-5" />
        {season === current && <CoinFlipRadarSection className="mb-6" />}
        {filterBar}
        {list}
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        eyebrow={<span className="text-accent-text">{seasonLabel(season)} season</span>}
        title="Events"
        description="Every FTC event — results, rankings, brackets and advancement odds. Filter by place, type and dates."
        phoneDescription="Every FTC event: results, rankings and odds."
        actions={<Button variant="outline" size="sm" asChild><Link to={`/teams${season !== current ? `?season=${season}` : ""}`}><Users /> Team records <ArrowRight /></Link></Button>}
      />
      {/* On a phone the text filter sits in the sheet, so the page gets Home's search at the top, for events only. */}
      {compact && <SearchBox kinds={["event", "place"]} label="Search events" placeholder="Find an event…" onPick={(h) => nav(hitHref(h))} className="mb-6 [&>div:first-child]:h-11" />}
      {/* The events you track, one tap away: above the coin flips and the list, so a phone's first screen has them. */}
      <CurrentlyTracking season={season} current={current} events={state.data?.events} listSettled={!state.loading} className="mb-6 max-sm:mb-5" />
      {/* Today's coin flips across every event on today: only this season's events can be on today. Left out on a day with none. */}
      {season === current && <CoinFlipRadarSection className="mb-8" />}
      {/* The filter bar stays up while loading or on an error, so another season can always be picked. */}
      {filterBar}
      {/* The placeholder is a screen tall, so the footer starts below the fold: the list arriving pushes nothing
          a reader can see (it used to shove a footer in view down the screen, the page's layout shift on a phone). */}
      {list}
    </div>
  );
}

