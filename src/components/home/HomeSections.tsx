// The home page's sections below the hero: the season strip, your team, the
// calendar, the public prediction record and Control Scout's own opt-in usage.
// Each one loads, fails and empties on its own; none of them holds up search.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, CalendarDays, Info, MapPin, Radio, RefreshCw, Search, Star } from "lucide-react";
import { qs, useApi, type ApiState } from "../../lib/api";
import { dateRange, matchTime, oddsPct, pct, place, seasonLabel, ago } from "../../lib/format";
import type { EventListItem, MatchView, TeamSummary, TrackRecord } from "../../shared/api";
import type { HomeOverview, PublicUsage } from "../../shared/home";
import { Button } from "../ui/button";
import { TierMark, WinBar } from "../predict";
import { ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { ErrorState } from "../states";
import { DataStatus } from "../DataStatus";
import { cn } from "../cn";
import { defaultEvidence, eventState, recordFor, shortDay, usageView, type Evidence } from "./homeModel";
import { headlineRule, LEDGER_MODE } from "../../shared/ledger";

const fmt = (n: number) => n.toLocaleString();

/** A heading's small label above it. */
function Kicker({ children, id }: { children: React.ReactNode; id?: string }) {
  return <p id={id} className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{children}</p>;
}

// --- Season coverage ----------------------------------------------------------

export function SeasonCoverage({ state }: { state: ApiState<HomeOverview> }) {
  const o = state.data;
  const items = [
    { n: o?.coverage.teamListings, label: "team listings this season", hint: "Teams registered for the season, each counted once", tone: "text-accent-text" },
    { n: o?.coverage.events, label: "events on the calendar", hint: "Competition events listed for the season (kickoffs and workshops left out)", tone: "text-info" },
    { n: o?.coverage.matchScores, label: "match scores recorded", hint: "Matches with a published score this season", tone: "text-success" },
  ];
  return (
    // Sized by its own width: on a wide screen it sits under the hero's search, half the page wide.
    <section aria-label={o ? `${seasonLabel(o.season)} season coverage` : "Season coverage"} className="@container/strip border-y border-line py-4">
      {state.error && !o ? (
        <p className="flex flex-wrap items-center gap-3 text-sm text-text-muted">Season totals couldn’t load. <Button variant="secondary" size="sm" onClick={state.reload}><RefreshCw /> Try again</Button></p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 @md/strip:gap-5">
            {items.map((x, i) => (
              <div key={x.label} className={cn("min-w-0", i > 0 && "border-l border-line pl-3 @md/strip:pl-5")} title={x.hint}>
                <dt className="sr-only">{x.label}</dt>
                <dd className="flex flex-col gap-x-3 @3xl/strip:flex-row @3xl/strip:items-baseline">
                  <span className={cn("font-display text-2xl font-semibold tabular-nums @md/strip:text-3xl", x.tone)}>{x.n == null ? <span className="text-text-muted">—</span> : fmt(x.n)}</span>
                  <span aria-hidden className="text-xs leading-snug text-text-muted @md/strip:text-sm">{x.label}</span>
                </dd>
              </div>
            ))}
          </dl>
          {o ? (
            <div className="mt-3 flex flex-wrap items-start gap-x-2 gap-y-1 text-xs text-text-muted">
              <span className="py-0.5 font-medium">{seasonLabel(o.season)}</span>
              {/* Source results, prepared statistics, or the two out of step for now (E5). */}
              <DataStatus readiness={o.readiness} fallbackResultsAt={o.dataAsOf} onRetry={state.reload} className="min-w-0 flex-1" />
            </div>
          ) : <p className="mt-3 text-xs"> </p>}
        </>
      )}
    </section>
  );
}

// --- Your team -----------------------------------------------------------------

/** Unplayed and not stale: a match scheduled well in the past belongs to a finished event (a left-over
 *  slot), while same-day delays still count. Without a known time zone, the event-local time read as UTC
 *  is within ±14 h of the real instant, so it still orders the schedule; the stale cutoff gets that much slack. */
export function nextMatch(matches: MatchView[], now = Date.now()): MatchView | undefined {
  const at = (m: MatchView) => m.startsAt ? Date.parse(m.startsAt) : m.time ? Date.parse(`${m.time.replace(/Z$/, "")}Z`) : NaN;
  const slack = (m: MatchView) => (m.startsAt ? 12 : 26) * 3600_000;
  return matches
    .filter((m) => !m.played && (!Number.isFinite(at(m)) || at(m) > now - slack(m)))
    .sort((a, b) => (Number.isFinite(at(a)) ? at(a) : Infinity) - (Number.isFinite(at(b)) ? at(b) : Infinity))[0];
}

/** Your team's next match and its odds, one tap from home (only with a team chosen on this device or account). */
export function YourTeam({ team, season }: { team: number; season: number }) {
  const sched = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches${qs({ season })}`);
  const info = useApi<{ teams: TeamSummary[] }>(`/api/teams-summary${qs({ season, teams: String(team) })}`);
  const t = info.data?.teams[0];
  const next = sched.data ? nextMatch(sched.data.matches) : undefined;
  const side = next ? (next.red.teams.some((x) => x.number === team) ? "red" : "blue") : null;
  const pWin = next?.prediction ? (side === "red" ? next.prediction.pRed : 1 - next.prediction.pRed) : null;
  return (
    <section aria-label="Your team" className="rounded-2xl border border-accent/30 bg-accent/[0.06]">
      <Link to="/my-team" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-accent @2xl/home:px-5">
        <Star className="size-5 shrink-0 fill-accent text-accent" aria-hidden />
        <span className="font-display text-2xl font-semibold tabular-nums text-accent-text">{team}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{t?.name ?? (info.data ? `Team ${team}` : " ")}</span>
          <span className="block truncate text-sm text-text-muted">Your team{t?.place ? ` · ${t.place}` : ""}</span>
        </span>
        <span className="ml-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm max-sm:ml-0 max-sm:basis-full">
          {next ? (
            <>
              <span className="text-text-muted">Next: <span className="text-text-base">{next.label}</span> · {next.code} · {matchTime(next.time)}</span>
              {pWin != null && next.prediction && (
                <span className="flex items-center gap-2">
                  <WinBar pRed={next.prediction.pRed} size="sm" className="w-20" />
                  <span className="font-semibold">{oddsPct(pWin)} to win</span>
                  <TierMark tier={next.prediction.tier} className="text-xs" />
                </span>
              )}
            </>
          ) : !sched.data ? (
            <span className="text-text-muted">{sched.error ? "Couldn’t load the schedule. Open your dashboard." : "Checking the schedule…"}</span>
          ) : (
            <span className="text-text-muted">No match schedule published yet.{t?.nextEvent ? ` Next event: ${t.nextEvent.name}, ${dateRange(t.nextEvent.start, t.nextEvent.end)}.` : ""}</span>
          )}
          <span className="inline-flex items-center gap-1 font-semibold text-accent-text">Your team <ArrowRight className="size-4" /></span>
        </span>
      </Link>
    </section>
  );
}

/** No team chosen: an invitation, not a gate (browsing never needs an account). */
export function FindYourTeam({ onSearch }: { onSearch: () => void }) {
  return (
    <section aria-label="Your team" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-dashed border-line px-4 py-3.5 text-sm @2xl/home:px-5">
      <Star className="size-5 shrink-0 text-text-muted" aria-hidden />
      <span className="min-w-[14rem] flex-1 text-text-muted">Pick your team to see its next match and odds here. It stays on this device; no account needed.</span>
      <Button variant="secondary" size="sm" onClick={onSearch} className="max-sm:h-10"><Search /> Find your team</Button>
    </section>
  );
}

// --- On the calendar --------------------------------------------------------------

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function OnTheCalendar({ season }: { season: number }) {
  // Running now or starting in the next 7 days (two days back, so a multi-day event that's on still shows).
  const [win] = useState(() => { const now = Date.now(); return { from: iso(new Date(now - 2 * 864e5)), to: iso(new Date(now + 7 * 864e5)), today: iso(new Date(now)) }; });
  const state = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season, from: win.from, to: win.to })}`);
  const order = { live: 0, upcoming: 1, finished: 2 } as const;
  const evs = state.data ? [...state.data.events].filter((e) => e.status !== "finished")
    .sort((a, b) => order[a.status] - order[b.status] || (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name)) : [];
  const shown = evs.slice(0, 5);
  return (
    <section aria-labelledby="cal-title" className="min-w-0">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="cal-title" className="font-display text-2xl font-semibold">On the calendar</h2>
          <p className="mt-1 text-sm text-text-muted">{seasonLabel(season)} events on now or starting by {shortDay(win.to)}</p>
        </div>
        {state.data && <span className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs tabular-nums text-text-muted">{evs.length} {evs.length === 1 ? "event" : "events"}</span>}
      </div>
      <div className="mt-3">
        {state.error && !state.data ? <ErrorState error={state.error} onRetry={state.reload} /> : !state.data ? (
          <ul aria-busy="true" className="divide-y divide-line border-y border-line">{[0, 1, 2].map((i) => <li key={i} className="h-[4.5rem]" />)}</ul>
        ) : !evs.length ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 max-sm:py-4 text-sm text-text-muted">No events on now or starting between {shortDay(win.today)} and {shortDay(win.to)}. <Link to="/events" className="font-medium text-accent-text underline">Browse the season calendar</Link>.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {shown.map((e) => <CalendarRow key={e.code} e={e} />)}
          </ul>
        )}
      </div>
      <Link to="/events" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-text hover:underline">
        {evs.length > shown.length ? `${evs.length - shown.length} more this week · all events` : "All events"} <ArrowRight className="size-4" />
      </Link>
    </section>
  );
}

function CalendarRow({ e }: { e: EventListItem }) {
  const st = eventState(e);
  const d = e.start ? new Date(`${e.start}T00:00:00Z`) : null;
  return (
    <li>
      <Link to={`/events/${e.season}/${e.code}`} className="group flex items-center gap-4 py-3 pr-1 focus-visible:outline-2 focus-visible:outline-accent">
        <span className="w-11 shrink-0 text-center leading-none" aria-hidden>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">{d ? d.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }) : "TBA"}</span>
          <span className="mt-1 block font-display text-xl font-semibold tabular-nums">{d ? d.getUTCDate() : "–"}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium group-hover:text-accent-text">{e.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
            <span className="inline-flex min-w-0 items-center gap-1 truncate"><MapPin className="size-3.5 shrink-0" aria-hidden />{place(e.city, e.state, e.country) || "Location TBA"}</span>
            {/* The date block on the left shows the first day; a multi-day event says its full span (screen readers always get it). */}
            {e.end && e.end !== e.start ? <><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />{dateRange(e.start, e.end)}</span></> : <span className="sr-only">{dateRange(e.start, e.end)}</span>}
            <span aria-hidden>·</span>
            <span className={cn("inline-flex items-center gap-1", st.tone === "live" && "font-semibold text-danger")}>
              {st.tone === "live" && <Radio className="size-3.5" aria-hidden />}{st.label}{st.tone === "live" && e.matchesTotal > 0 ? ` · ${e.matchesPlayed}/${e.matchesTotal} played` : ""}
            </span>
          </span>
        </span>
        <ArrowUpRight className="size-4 shrink-0 text-text-muted group-hover:text-accent-text" aria-hidden />
      </Link>
    </li>
  );
}

// --- The public prediction record ---------------------------------------------------

export function PredictionRecord() {
  const state = useApi<TrackRecord>("/api/predict/accuracy");
  const [chosen, setChosen] = useState<Evidence | null>(null);
  const t = state.data;
  const kind = chosen ?? (t ? defaultEvidence(t) : "backtest");
  const view = t ? recordFor(t, kind) : null;
  const sizes = t ? { live: recordFor(t, "live")?.block.n, backtest: recordFor(t, "backtest")?.block.n } : null;
  const tabs: Evidence[] = ["live", "backtest"];
  return (
    <section aria-labelledby="record-title" className="min-w-0 rounded-2xl border border-line bg-card p-5 max-sm:p-4 @2xl/home:p-6">
      <Kicker>The public track record</Kicker>
      <h2 id="record-title" className="mt-2 font-display text-2xl font-semibold leading-tight">Odds that answer<br className="max-sm:hidden" /> for themselves.</h2>
      {state.error && !t ? <div className="mt-4"><ErrorState error={state.error} onRetry={state.reload} /></div> : !t ? (
        <div aria-busy="true" className="mt-4 h-52" />
      ) : (
        <>
          {/* A choice of evidence (radio semantics, arrow keys between the two), each with its sample size, and the record it shows. */}
          <ToggleGroup type="single" value={kind} onValueChange={(v) => v && setChosen(v as Evidence)} aria-label="Evidence" aria-controls="record-evidence"
            className="mt-4 rounded-xl border border-line p-1">
            {tabs.map((k) => (
              <ToggleGroupItem key={k} value={k} size="lg" className="gap-1.5 rounded-lg px-3 text-sm max-sm:h-10"
                aria-label={sizes?.[k] != null ? `${LEDGER_MODE[k].tab}, ${fmt(sizes[k]!)} scored` : LEDGER_MODE[k].tab}>
                {LEDGER_MODE[k].tab}
                {sizes?.[k] != null && <span aria-hidden className="font-mono text-xs tabular-nums text-text-muted">{fmt(sizes[k]!)}</span>}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div id="record-evidence" role="region" aria-live="polite" aria-label={LEDGER_MODE[kind].tab} className="mt-4">
            {!view ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 max-sm:py-4 text-sm text-text-muted">
                {kind === "live" ? "No live calls have been scored yet: every match prediction is logged before the match and scored after it." : "No replayed season is on record yet."}
              </p>
            ) : (
              <>
                {/* Which mode the big number is, said before the number. */}
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">
                  {view.kind === "live" ? (view.early ? "Logged live · early sample" : "Logged live") : "Season replay"}{view.isHeadline && " · the headline"}
                </p>
                {view.noneDecided
                  ? <p className="font-display text-6xl font-semibold text-text-muted" aria-label="No percentage yet">—</p>
                  : <p className="font-display text-6xl font-semibold tabular-nums">{pct(view.block.accuracy, 1).replace("%", "")}<span className="text-3xl text-text-muted">%</span></p>}
                <p className="mt-1 text-sm text-text-muted">
                  Correct winner · {view.kind === "live" ? `${view.seasonLabel}, called before each match` : `${view.seasonLabel}, replayed from recorded matches (not calls made in advance)`}
                </p>
                {view.split && (
                  <div className="mt-4">
                    <div className="flex h-2 overflow-hidden rounded-full bg-text-base/15" role="img" aria-label={`${fmt(view.split.correct)} correct, ${fmt(view.split.missed)} missed of ${fmt(view.split.decided)} decisive calls`}>
                      <div className="bg-accent" style={{ width: `${(view.split.correct / view.split.decided) * 100}%` }} />
                    </div>
                    <p className="mt-2 flex justify-between text-sm tabular-nums"><span>{fmt(view.split.correct)} correct</span><span className="text-text-muted">{fmt(view.split.missed)} missed</span></p>
                  </div>
                )}
                <p className="mt-2 text-xs text-text-muted">
                  {view.noneDecided ? `All ${fmt(view.block.n)} scored ${view.block.n === 1 ? "call was a tie or a 50:50 call" : "calls were ties or 50:50 calls"}, so none could be right or wrong yet.`
                    : view.split ? `${fmt(view.split.decided)} decisive calls; ties and 50:50 calls aren’t counted (${fmt(view.block.n)} scored in all).` : `${fmt(view.block.n)} scored calls; ties and 50:50 calls aren’t counted in the percentage.`}
                  {view.coverage && view.coverage.scored > view.coverage.replayed && ` ${fmt(view.coverage.replayed)} of ${fmt(view.coverage.scored)} scored matches replayed${view.coverage.shortHanded ? `; ${fmt(view.coverage.shortHanded)} had a robot missing, so there’s no 2-on-2 call to replay` : ""}${view.coverage.eventSkipped ? `; ${fmt(view.coverage.eventSkipped)} were at remote or hybrid events` : ""}.`}
                  {` ${headlineRule(t)}`}
                  {` Engine v${t.engineVersion} serves predictions now · updated ${ago(t.generatedAt)}.`}
                </p>
              </>
            )}
          </div>
          <Link to="/methodology#accuracy" className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-text hover:underline">Every call, including the misses <ArrowUpRight className="size-4" /></Link>
        </>
      )}
    </section>
  );
}

// --- Control Scout, in use ------------------------------------------------------------

export function PublicUsagePanel() {
  const state = useApi<PublicUsage>("/api/public-usage");
  const v = state.data ? usageView(state.data) : state.error ? usageView(null) : null;
  const max = v?.kind === "available" ? Math.max(1, ...v.daily.map((d) => d.pageViews)) : 1;
  return (
    <section aria-labelledby="usage-title" className="min-w-0 border-t border-line pt-8 max-sm:pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="usage-title" className="font-display text-2xl font-semibold">Control Scout, in use.</h2>
          <p className="mt-1 text-sm text-text-muted">Opt-in, anonymous counts from visitors who allowed usage statistics. Not all traffic, and not people.</p>
        </div>
        {v?.kind === "unavailable" && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-text-muted"><Info className="size-3.5" aria-hidden /> {v.reason === "not-published" ? "Not published" : "Unavailable"}</span>
        )}
      </div>
      {!v ? <div aria-busy="true" className="mt-4 h-32 rounded-2xl border border-line" /> : v.kind === "unavailable" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line px-5 max-sm:px-4 py-5 max-sm:py-4 text-sm text-text-muted">
          {v.message}{v.reason === "not-published" && " Page views and sessions started will show here once they are."}
          {(v.reason === "error" || v.reason === "unreachable") && <Button variant="secondary" size="sm" onClick={state.reload}><RefreshCw /> Try again</Button>}
        </div>
      ) : (
        <>
          <dl className="mt-4 grid rounded-2xl border border-line @2xl/home:grid-cols-[1fr_1fr_1.6fr]">
            <div className="px-5 max-sm:px-4 py-4">
              <dt className="text-sm font-medium">Page views</dt>
              <dd className="mt-1 font-display text-3xl font-semibold tabular-nums">{fmt(v.totals.pageViews)}</dd>
            </div>
            <div className="border-line px-5 max-sm:px-4 py-4 @max-2xl/home:border-t @2xl/home:border-l">
              <dt className="text-sm font-medium">Sessions started</dt>
              <dd className="mt-1 font-display text-3xl font-semibold tabular-nums">{fmt(v.totals.sessionStarts)}</dd>
            </div>
            <div className="border-line px-5 max-sm:px-4 py-4 @max-2xl/home:border-t @2xl/home:border-l">
              <dt className="text-sm font-medium">Daily page views</dt>
              <dd className="mt-2">
                <svg viewBox={`0 0 ${v.daily.length * 6} 40`} preserveAspectRatio="none" className="h-12 w-full" role="img"
                  aria-label={`Daily page views from ${shortDay(v.from)} to ${shortDay(v.to)}: ${v.daily.map((d) => `${shortDay(d.day)} ${d.pageViews}`).join(", ")}`}>
                  {v.daily.map((d, i) => {
                    const h = d.pageViews ? Math.max(1.5, (d.pageViews / max) * 40) : 0.75;
                    return <rect key={d.day} x={i * 6 + 0.75} y={40 - h} width={4.5} height={h} rx={1} className={i === v.daily.length - 1 ? "fill-accent/50" : "fill-accent"}><title>{`${shortDay(d.day)}: ${fmt(d.pageViews)} page views, ${fmt(d.sessionStarts)} sessions started`}</title></rect>;
                  })}
                </svg>
                <span className="mt-1 flex justify-between text-[11px] tabular-nums text-text-muted"><span>{shortDay(v.from)}</span><span>{shortDay(v.to)} (so far)</span></span>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-text-muted">
            {shortDay(v.from)} to {shortDay(v.to)}, UTC days; today is still being counted.{v.measuredFrom && ` Counting began ${shortDay(v.measuredFrom)}.`} A session is one browser tab’s visit, not a unique person. Updated {ago(v.generatedAt)}.
          </p>
        </>
      )}
    </section>
  );
}
