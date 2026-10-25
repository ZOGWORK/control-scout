// Predict: predictions run on their own, so this page starts from what people
// care about — a team or an event. Pick one and its predictions show inline;
// this week's events are listed underneath. The manual what-if lab (any four
// teams, advancement for any team at any event) sits at the bottom.
// Every output carries its confidence tier.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, ArrowRight, BookmarkPlus, CalendarDays, ChevronDown, FlaskConical, Link2, MapPin, Search, Sparkles, Star, Swords, Trophy, Users, WifiOff, X } from "lucide-react";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { noteOfflineAnswer, useApi, qs, type ApiError } from "../lib/api";
import { useCurrentSeason, useMeta, useTitle } from "../lib/meta";
import { defaultSeason } from "../lib/myTeamSeason";
import { callTally } from "../lib/seasonSoFar";
import { usePersonal } from "../lib/personal";
import type { EventDetail, EventSummary, EventListItem, MatchExplanationView, MatchView, TeamProfile } from "../shared/api";
import { pairHistory } from "../shared/pairHistory";
import { labEventChoices } from "../lib/labEvents";
import { LabEventsEmpty } from "../components/LabEventsEmpty";
import { PageHeader, Section, EmptyState } from "../components/page";
import { LatestCalls } from "../components/LatestCalls";
import { Async, ErrorState } from "../components/states";
import { Button } from "../components/ui/button";
import { Badge, Input } from "../components/ui/basic";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "../components/ui/sonner";
import { CalibrationLine, ConfidenceBadge, FactorList, MatchList, PairHistoryLine, WinBar } from "../components/predict";
import { TeamInput, lookupTeamName } from "../components/TeamInput";
import { teamsErrors } from "../lib/teamCheck";
import { SeasonToggle } from "../components/SeasonToggle";
import { AdvancementView } from "../components/Advancement";
import { SearchBox } from "../components/search/SearchBox";
import { SEARCH_HINT, usePageSearch } from "../components/layout/Search";
import { cn } from "../components/cn";
import { Reveal, m } from "../components/motion";
import { dateRange, num, oddsPct, place, seasonLabel } from "../lib/format";
import { copyLink } from "../lib/clipboard";
import { ShareMatch } from "../components/ShareMatch";
import { BonusOdds } from "../components/BonusOdds";
import { bonusView } from "../shared/bonusOdds";
import { ScoreRange } from "../components/ScoreRange";
import { levelPct } from "../shared/scoreRange";

type LabMode = "match" | "advancement";
const ADVANCING = new Set(["LeagueTournament", "Qualifier", "Championship", "SuperQualifier", "Premier", "FIRSTChampionship"]);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** ?for=team:4215 or ?for=event:2026:USNJQ1 — what's picked. The lab keeps its own params (mode, red, blue, code, team). */
type Pick = { kind: "team"; team: number } | { kind: "event"; season: number; code: string } | null;
function parsePick(v: string | null): Pick {
  const [k, a, b] = (v ?? "").split(":");
  if (k === "team" && /^\d+$/.test(a ?? "")) return { kind: "team", team: Number(a) };
  if (k === "event" && /^\d{4}$/.test(a ?? "") && b) return { kind: "event", season: Number(a), code: b };
  return null;
}

export default function PredictPage() {
  useTitle("Predict");
  const [sp, setSp] = useSearchParams();
  const pick = parsePick(sp.get("for"));
  // ?view=lab|events picks the view; without it, a lab link (mode, red/blue, code) opens the Lab.
  // Each view keeps its own params (for= vs the lab's), so switching back and forth loses neither.
  const view = viewOf(sp);
  // Picking a team or event shows its predictions in the Events view (the lab's matchup stays for later).
  const setPick = (v: string | null) => setSp((x) => { x.set("view", "events"); if (v) x.set("for", v); else x.delete("for"); return x; });
  const setView = (v: "events" | "lab") => setSp((x) => { x.set("view", v); if (v === "lab" && !labLink(x)) x.set("mode", "advancement"); return x; });
  // The header's width (the content area's, not the window's): the latest-calls card needs 64 rem, the grid's own threshold.
  const headerBox = useRef<HTMLDivElement>(null);
  const wide = useWiderThan(headerBox, 64);
  return (
    <div className="space-y-10 max-sm:space-y-6">
      {/* Wide content: the latest live calls fill the header's right side (none on narrower screens: search comes first). */}
      <div ref={headerBox} className="@container/predict">
      <div className="grid items-start gap-x-10 @5xl/predict:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
      <div className="min-w-0">
        <PageHeader title="Predict" description={<>Every scheduled match gets win odds and predicted scores automatically, and every advancing event gets advancement odds. Pick a team or an event to see them. Each number carries its confidence, and the <Link to="/methodology#accuracy" className="underline">track record</Link> shows how often they've been right.</>} />
        <Picker onPick={setPick} />
        <PredictSwitch value={view} onChange={setView} />
      </div>
      {/* Only mounted when there's room: no request or timer for a card nobody can see. */}
      {wide && <LatestCalls />}
      </div>
      </div>
      <div role="tabpanel" id={`predict-panel-${view}`} aria-labelledby={`predict-tab-${view}`} className="space-y-10 max-sm:space-y-6">
        {view === "lab" ? <Lab /> : (
          <>
            {pick?.kind === "team" && <TeamPredictions team={pick.team} onClear={() => setPick(null)} />}
            {pick?.kind === "event" && <EventPredictions season={pick.season} code={pick.code} onClear={() => setPick(null)} />}
            <ThisWeek onPick={setPick} picked={pick?.kind === "event" ? pick.code : null} />
          </>
        )}
      </div>
    </div>
  );
}

/** Which view: ?view= if set, else the Lab for a lab link, else Events. */
export function viewOf(sp: URLSearchParams): "events" | "lab" {
  const v = sp.get("view");
  return v === "lab" || v === "events" ? v : labLink(sp) ? "lab" : "events";
}
/** A lab link: an explicit mode, or (older links) a matchup or an event without one. */
function labLink(sp: URLSearchParams): "match" | "advancement" | null {
  const m = sp.get("mode") ?? (sp.get("red") || sp.get("blue") ? "match" : sp.get("code") ? "advancement" : null);
  return m === "advancement" ? "advancement" : m === "match" ? "match" : null;
}

/**
 * Predict (scheduled matches and events) or Predict Lab (what-ifs): one switch, right under the search.
 * Two cards that say what each does, so the Lab (any four teams) isn't missed by people who'd otherwise
 * type one team into the search and expect a matchup.
 */
function PredictSwitch({ value, onChange }: { value: "events" | "lab"; onChange: (v: "events" | "lab") => void }) {
  const views = [
    { v: "events" as const, label: "Scheduled", icon: CalendarDays, hint: "Odds for the matches and events on the calendar, for the team or event you pick." },
    { v: "lab" as const, label: "Lab: advancement & matchups", icon: FlaskConical, hint: "Any team's odds to advance at any event, or any four teams for win odds and a predicted score." },
  ];
  // Tabs keyboard pattern: the selected tab is the one Tab reaches; arrows (and Home/End) move and select.
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const i = views.findIndex((x) => x.v === value);
    const next = e.key === "ArrowRight" ? (i + 1) % views.length : e.key === "ArrowLeft" ? (i + views.length - 1) % views.length : e.key === "Home" ? 0 : e.key === "End" ? views.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(views[next].v);
    document.getElementById(`predict-tab-${views[next].v}`)?.focus();
  };
  return (
    <div className="mt-5 max-sm:mt-4 grid max-w-2xl gap-2 sm:grid-cols-2" role="tablist" aria-label="Predict">
      {views.map(({ v, label, icon: Icon, hint }) => (
        <button key={v} id={`predict-tab-${v}`} type="button" role="tab" aria-selected={value === v} aria-controls={`predict-panel-${v}`} tabIndex={value === v ? 0 : -1}
          onKeyDown={onKey} onClick={() => value !== v && onChange(v)}
          className={cn("relative flex min-h-[4.5rem] items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors",
            value !== v && "hover:border-accent/40 hover:bg-[color-mix(in_srgb,var(--color-text-base)_4%,var(--color-card))]")}>
          {/* The chosen card's highlight: one shape that slides to the other card when the view changes. */}
          {value === v && <m.span layoutId="predict-view-active" aria-hidden transition={{ type: "spring", stiffness: 500, damping: 38 }}
            className="absolute -inset-px rounded-xl border border-accent/70 bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-card))] shadow-[0_4px_16px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]" />}
          <span className={cn("relative grid size-9 shrink-0 place-items-center rounded-lg transition-colors duration-300", value === v ? "bg-accent text-accent-ink" : "bg-accent/[0.12] text-accent")}><Icon className="size-4" /></span>
          <span className="relative min-w-0">
            <span className="block text-sm font-semibold text-text-base">{label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Picker({ onPick }: { onPick: (v: string) => void }) {
  const { state } = usePersonal();
  // This picker is the page's search box: the top-bar field steps aside, and ⌘K focuses this.
  const searchRef = usePageSearch();
  const quick = [...new Set([...(state.myTeam ? [state.myTeam] : []), ...state.tracked.teams, ...state.bookmarks])].slice(0, 6);
  const chip = (t: number, small?: boolean) => (
    <button key={t} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => onPick(`team:${t}`)}
      className={cn("inline-flex items-center gap-1 rounded-full border border-border font-mono text-foreground hover:border-accent/60 hover:text-accent-text", small ? "px-2.5 py-0.5 text-xs max-sm:min-h-8" : "px-3 py-1 text-sm max-sm:min-h-9")}>
      {t === state.myTeam && <Star className={cn("fill-accent text-accent", small ? "size-3" : "size-3.5")} />}{t}
    </button>
  );
  return (
    <div className="max-w-2xl space-y-3">
      <SearchBox
        size="lg" kinds={["team", "event"]} label="Pick a team or event" inputRef={searchRef} hint={SEARCH_HINT}
        placeholder="Team or event: number or name"
        onPick={(h) => onPick(h.kind === "team" ? `team:${h.ref}` : `event:${h.ref}`)}
        emptyHint={quick.length ? (
          <div className="p-2">
            <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your teams</p>
            <div className="flex flex-wrap gap-1.5">{quick.map((t) => chip(t))}</div>
          </div>
        ) : undefined}
      />
      {quick.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"><span>Quick:</span>{quick.map((t) => chip(t, true))}</div>}
    </div>
  );
}

/** The picked team or event. Its identity gets the width: the team number never breaks, a long name or date
 *  wraps rather than truncating, Open page drops under it on a phone, and Close keeps a 44px target. */
function PickedHeader({ icon: Icon, number, title, sub, to, openLabel, onClear }: { icon: typeof Users; number?: number; title: string; sub?: string; to: string; openLabel: string; onClear: () => void }) {
  return (
    <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
      <span className="col-start-1 row-start-1 grid size-10 shrink-0 place-items-center rounded-xl bg-accent/[0.12] text-accent"><Icon className="size-5" /></span>
      <div className="col-start-2 row-start-1 min-w-0 self-center">
        <h2 className="font-display text-lg font-semibold leading-snug text-foreground sm:text-xl [overflow-wrap:anywhere]">
          {number != null && <span className="whitespace-nowrap font-mono tabular-nums">{number}</span>}
          {number != null && title && " "}{title}
        </h2>
        {sub && <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">{sub}</p>}
      </div>
      {/* Before Close in the DOM, so Tab goes identity → Open page → Close wherever the grid draws them. */}
      <Button variant="secondary" size="sm" asChild className="col-start-2 row-start-2 justify-self-start max-sm:h-10 sm:col-start-3 sm:row-start-1 sm:self-center">
        <Link to={to}>{openLabel} <ArrowRight /></Link>
      </Button>
      <Button variant="ghost" size="icon" onClick={onClear} aria-label="Clear selection" className="col-start-3 row-start-1 -mr-1.5 size-11 sm:col-start-4"><X /></Button>
    </div>
  );
}

/** Lab links with a team filled in (as red's first team, or as the advancement team). */
export const labMatchHref = (team: number, season: number) => `/predict${qs({ view: "lab", mode: "match", season, red: team })}`;
export const labAdvancementHref = (team: number, season: number) => `/predict${qs({ view: "lab", mode: "advancement", season, team })}`;

function TeamPredictions({ team, onClear }: { team: number; onClear: () => void }) {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const meta = useMeta();
  const offered = (x: number) => meta?.seasons.find((m) => m.season === x)?.predictable ?? x >= 2023;
  const asked = Number(sp.get("season")) || null;
  // With no ?season: this season once the team has played in it, else its latest predictable season (as My team does).
  const probe = useApi<TeamProfile>(`/api/teams/${team}${qs({ season: current })}`);
  const probed = probe.data?.team.number === team && probe.data.season === current ? probe.data : undefined;
  const season = asked ?? (probed ? defaultSeason(probed, offered) : probe.error ? current : null);
  const profile = useApi<TeamProfile>(season != null ? `/api/teams/${team}${qs({ season })}` : null);
  const matches = useApi<{ matches: MatchView[] }>(season != null ? `/api/teams/${team}/matches${qs({ season })}` : null);
  const setSeason = (x: number) => setSp((q) => { q.set("season", String(x)); return q; }, { replace: true });
  const isCurrent = season === current;
  // Unplayed and not long past: matches from ended events that never got a result aren't "next".
  const stale = Date.now() - 12 * 3600_000;
  const all = useMemo(() => matches.data?.matches ?? [], [matches.data]);
  const upcoming = all.filter((m) => !m.played && (!m.startsAt || Date.parse(m.startsAt) > stale));
  const played = useMemo(() => all.filter((m) => m.played).reverse(), [all]);
  const calls = useMemo(() => callTally(all, team), [all, team]);
  const p = profile.data?.team.number === team ? profile.data : probed;
  const t = p?.team ?? probe.data?.team;
  const now = iso(new Date());
  const next = isCurrent ? (p?.events ?? []).find((e) => (e.end ?? e.start ?? "") >= now) : undefined;
  const seasons = p?.seasons ?? probed?.seasons;
  const s = season ?? current;
  // Each event's name and dates, for the match lists' event headings (codes otherwise).
  const ev = useMemo(() => {
    const names: Record<string, string> = {}, dates: Record<string, string> = {};
    for (const e of profile.data?.team.number === team ? profile.data.events : []) { names[e.code] = e.name; dates[e.code] = dateRange(e.start, e.end); }
    return { names, dates };
  }, [profile.data, team]);
  return (
    <section aria-label={`Predictions for team ${team}`} className="rounded-2xl border border-border bg-card/60 p-4 sm:p-6">
      <PickedHeader icon={Users} number={team} title={t?.name ?? ""} sub={t ? place(t.city, t.state, t.country) : undefined} to={`/teams/${team}?season=${s}`} openLabel="Open team page" onClear={onClear} />
      {probe.error?.status === 404 ? <EmptyState icon={Users} title={`No team ${team}`} description="No FTC team with that number in the seasons we hold." /> : (
        <div className="space-y-8 max-sm:space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            {seasons ? <SeasonToggle predictOnly seasons={seasons} value={s} onChange={setSeason} /> : <div className="skeleton h-9 w-72 max-w-full rounded-lg" />}
            {season != null && !isCurrent && <span className="text-xs text-muted-foreground">{asked ? `Predictions from ${seasonLabel(season)}` : `No results in ${seasonLabel(current)} yet, so this is ${seasonLabel(season)}`}</span>}
          </div>
          {/* People pick one team expecting a matchup: the Lab, with this team already in. Both ways in carry the same weight. */}
          <Reveal className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.06] p-3.5">
            <FlaskConical className="size-5 shrink-0 text-accent" aria-hidden />
            <p className="min-w-0 flex-1 text-sm"><span className="font-medium">Predict a matchup with {team}.</span> <span className="text-muted-foreground">Pick its partner and two opponents in the Lab for win odds and a predicted score.</span></p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" asChild><Link to={labMatchHref(team, s)}><Swords /> Predict a matchup</Link></Button>
              <Button size="sm" variant="secondary" asChild><Link to={labAdvancementHref(team, s)}><Trophy /> Odds at an event</Link></Button>
            </div>
          </Reveal>
          {season == null ? <div className="skeleton h-40 rounded-xl" /> : isCurrent ? (
            <>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">Next matches</h3>
                <Async state={matches}>{() => (
                  <MatchList matches={upcoming.slice(0, 12)} highlight={team} eventNames={ev.names} eventDates={ev.dates} empty={next ? `No schedule yet for ${next.name}. Win odds appear as soon as the event publishes its matches (usually that morning).` : `No scheduled matches for ${team} in ${seasonLabel(season)} yet.`} />
                )}</Async>
                {upcoming.length > 12 && <p className="mt-2 text-xs text-muted-foreground">Showing 12 of {upcoming.length}. All of them are on the <Link to={`/teams/${team}`} className="underline">team page</Link>.</p>}
              </div>
              {next && (
                <div>
                  <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-foreground">
                    <span>Next event: <Link to={`/events/${next.season}/${next.code}`} className="hover:underline">{next.name}</Link></span>
                    <span className="text-xs font-normal text-muted-foreground">{dateRange(next.start, next.end)}</span>
                  </h3>
                  {ADVANCING.has(next.type ?? "")
                    ? <AdvancementView season={next.season} code={next.code} team={team} nameOf={() => ""} />
                    : <p className="text-sm text-muted-foreground">This event doesn't advance teams, so there are no advancement odds. Its matches get win odds once it publishes a schedule.</p>}
                </div>
              )}
              {played.length > 0 && <PastCalls team={team} season={season} played={played} calls={calls} ev={ev} />}
            </>
          ) : (
            <Async state={matches}>{() => <PastCalls team={team} season={season} played={played} calls={calls} ev={ev} />}</Async>
          )}
        </div>
      )}
    </section>
  );
}

/** A season's played matches, newest first, each with the call made before it, and how many were right. */
// Live and replayed calls are tallied apart, each named, never added together (the list below can hold both).
function PastCalls({ team, season, played, calls, ev }: { team: number; season: number; played: MatchView[]; calls: ReturnType<typeof callTally>; ev: { names: Record<string, string>; dates: Record<string, string> } }) {
  const line = (t: { right: number; of: number }, what: string) => (
    <li><span className="font-medium text-foreground">{t.right} of {t.of}</span> {what} right ({Math.round((t.right / t.of) * 100)}%)</li>
  );
  return (
    <Reveal>
      <h3 className="mb-1 text-sm font-semibold text-foreground">How the calls did in {seasonLabel(season)}</h3>
      {calls.live.of || calls.backtest.of ? (
        <ul className="mb-3 space-y-0.5 text-sm text-muted-foreground" aria-label="Calls right">
          {calls.live.of > 0 && line(calls.live, "live calls (logged before the match)")}
          {calls.backtest.of > 0 && line(calls.backtest, "replayed calls (made afterward from only the data before each match, not live)")}
        </ul>
      ) : <p className="mb-3 text-sm text-muted-foreground">No called matches for {team} in {seasonLabel(season)}.</p>}
      <MatchList matches={played.slice(0, 20)} highlight={team} eventNames={ev.names} eventDates={ev.dates} outcomeAccent newestFirst empty={`No matches played in ${seasonLabel(season)}.`} />
      {played.length > 20 && <p className="mt-2 text-xs text-muted-foreground">Showing the latest 20 of {played.length}. Every match is on the <Link to={`/teams/${team}?season=${season}`} className="underline">team page</Link>.</p>}
    </Reveal>
  );
}

function EventPredictions({ season, code, onClear }: { season: number; code: string; onClear: () => void }) {
  const state = useApi<EventDetail>(`/api/events/${season}/${code}`);
  const e = state.data?.event;
  // Unplayed matches of an event that has already ended never got results: say so, don't call them upcoming.
  const over = !!e && (e.end ?? e.start ?? "") < iso(new Date());
  const unplayed = (state.data?.matches ?? []).filter((m) => !m.played);
  const upcoming = over ? [] : unplayed;
  const played = (state.data?.matches ?? []).filter((m) => m.played);
  return (
    <section aria-label={`Predictions for ${e?.name ?? code}`} className="rounded-2xl border border-border bg-card/60 p-4 sm:p-6">
      <PickedHeader icon={CalendarDays} title={e?.name ?? code} sub={e ? `${dateRange(e.start, e.end)} · ${place(e.city, e.state, e.country)}` : undefined} to={`/events/${season}/${code}`} openLabel="Open event page" onClear={onClear} />
      <Async state={state}>{(d) => (
        <div className="space-y-8 max-sm:space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">{upcoming.length ? `Upcoming matches (${upcoming.length})` : over ? "This event is over" : played.length ? "All matches have been played" : "Matches"}</h3>
            {over && unplayed.length > 0 && <p className="mb-3 text-sm text-muted-foreground">{unplayed.length} scheduled {unplayed.length === 1 ? "match has" : "matches have"} no result from FIRST, so {unplayed.length === 1 ? "it isn't" : "they aren't"} shown as upcoming.</p>}
            {upcoming.length ? <MatchList matches={upcoming.slice(0, 16)} />
              : played.length ? <p className="text-sm text-muted-foreground">See how the predictions did on the <Link to={`/events/${season}/${code}`} className="underline">event page</Link>.</p>
                : <MatchList matches={[]} empty="No schedule published yet. Win odds for every match appear as soon as it is (usually the morning of the event)." />}
            {upcoming.length > 16 && <p className="mt-2 text-xs text-muted-foreground">Showing 16 of {upcoming.length}. The rest are on the <Link to={`/events/${season}/${code}?tab=matches`} className="underline">event page</Link>.</p>}
          </div>
          {!d.forecastUnsupported && d.event.status !== "finished" && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Advancement odds</h3>
              <AdvancementView season={season} code={code} team={null} nameOf={() => ""} />
            </div>
          )}
        </div>
      )}</Async>
    </section>
  );
}

function ThisWeek({ onPick, picked }: { onPick: (v: string) => void; picked: string | null }) {
  const [all, setAll] = useState(false);
  const season = useCurrentSeason();
  const now = new Date();
  const from = iso(new Date(now.getTime() - 2 * 864e5)), to = iso(new Date(now.getTime() + 7 * 864e5));
  const events = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season, from, to })}`);
  // Per-event counts from the event list itself (complete, unlike a capped match feed).
  const toPlay = (e: EventListItem) => (e.status === "finished" ? 0 : Math.max(0, e.matchesTotal - e.matchesPlayed));
  return (
    <Section title="This week" description="Events from two days ago to a week out. Pick one to see its predictions.">
      <Async state={events} empty={(d) => !d.events.length && <EmptyState icon={CalendarDays} title="No events this week" description="Nothing is scheduled in the next seven days. Pick any team or event above to see its predictions." />}>
        {(d) => (
          <div className="grid gap-2 sm:grid-cols-2">
            {[...d.events].sort((a, b) => toPlay(b) - toPlay(a) || (a.start ?? "").localeCompare(b.start ?? "")).slice(0, all ? undefined : 12).map((e) => {
              const n = toPlay(e);
              return (
                <button key={e.code} type="button" onClick={() => onPick(`event:${e.season}:${e.code}`)} aria-pressed={picked === e.code}
                  className={cn("lift flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3 text-left", picked === e.code ? "border-accent/60" : "border-border")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{e.name}</span>
                    <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" />{dateRange(e.start, e.end)} · {place(e.city, e.state)}</span>
                  </span>
                  <span className="shrink-0">{n > 0 ? <Badge variant="success">{n} scheduled</Badge> : <Badge variant="secondary">{e.typeLabel ?? e.type ?? "Event"}</Badge>}</span>
                </button>
              );
            })}
            {d.events.length > 12 && <Button variant="ghost" size="sm" className="sm:col-span-2 justify-self-start" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${d.events.length} events`}</Button>}
          </div>
        )}
      </Async>
    </Section>
  );
}

/** Predict Lab: what-if alliances and advancement for any team at any event (the switcher's Lab view). */
function Lab() {
  const [sp, setSp] = useSearchParams();
  // Advancement first: the Lab opens there unless the link asks for a matchup.
  const mode: LabMode = labLink(sp) === "match" ? "match" : "advancement";
  const setMode = (m: string) => setSp((x) => { x.set("mode", m); return x; }, { replace: true });
  return (
    <section aria-label="Predict Lab" className="rounded-2xl border border-border px-4 pb-6 max-sm:pb-4 pt-6 max-sm:pt-5 sm:px-8 sm:pb-8">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink"><FlaskConical className="size-5" aria-hidden /></span>
        <div>
          <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Predict Lab</h2>
          <p className="mt-1 text-base text-muted-foreground">Advancement odds for any team at any event, or a custom matchup of any four teams.</p>
        </div>
      </div>
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className="sm:p-1.5">
          <TabsTrigger value="advancement" className="sm:h-11 sm:px-5 sm:text-base"><Trophy className="size-4" /> Advancement</TabsTrigger>
          <TabsTrigger value="match" className="sm:h-11 sm:px-5 sm:text-base"><Swords className="size-4" /> Custom matchup</TabsTrigger>
        </TabsList>
        <TabsContent value="advancement" className="mt-6 max-sm:mt-4"><AdvancementLab /></TabsContent>
        <TabsContent value="match" className="mt-6 max-sm:mt-4"><MatchLab /></TabsContent>
      </Tabs>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Match: what-if alliances
// ---------------------------------------------------------------------------

function MatchLab() {
  const [sp, setSp] = useSearchParams();
  // The first empty box takes focus only when nothing else has it (arriving on the Lab); switching to it with the
  // view tabs' arrow keys leaves focus on the tab, as the tabs pattern expects.
  const [grab] = useState(() => !document.activeElement || document.activeElement === document.body);
  const current = useCurrentSeason();
  const season = Number(sp.get("season")) || current;
  const init = (k: string) => (sp.get(k) ?? "").split(",").filter(Boolean);
  const [red, setRed] = useState<string[]>(() => { const x = init("red"); return [x[0] ?? "", x[1] ?? ""]; });
  const [blue, setBlue] = useState<string[]>(() => { const x = init("blue"); return [x[0] ?? "", x[1] ?? ""]; });
  const ready = red.every((x) => x) && blue.every((x) => x);
  const query = ready ? `/api/predict/match${qs({ season, red: red.join(","), blue: blue.join(",") })}` : null;
  // The matchup last asked for (from the URL or the Predict button). Typing in
  // the inputs edits a draft; the season switch never touches the draft.
  type Matchup = { red: number[]; blue: number[] };
  const parse = (r: string, b: string): Matchup | null => {
    const red = r.split(",").filter(Boolean).map(Number), blue = b.split(",").filter(Boolean).map(Number);
    const all = [...red, ...blue];
    return red.length === 2 && blue.length === 2 && all.every((t) => Number.isInteger(t) && t > 0) && new Set(all).size === 4 ? { red, blue } : null;
  };
  const urlRed = sp.get("red") ?? "", urlBlue = sp.get("blue") ?? "";
  const [submittedTeams, setSubmittedTeams] = useState<Matchup | null>(() => parse(urlRed, urlBlue));
  // Saved links and back/forward change the URL on this same page: follow it.
  useEffect(() => {
    const r = urlRed.split(",").filter(Boolean), b = urlBlue.split(",").filter(Boolean);
    setRed([r[0] ?? "", r[1] ?? ""]);
    setBlue([b[0] ?? "", b[1] ?? ""]);
    setSubmittedTeams(parse(urlRed, urlBlue));
    setErrors([null, null, null, null]);
    edits.current++;
  }, [urlRed, urlBlue]);
  const submitted = submittedTeams ? `/api/predict/match${qs({ season, red: submittedTeams.red.join(","), blue: submittedTeams.blue.join(",") })}` : null;
  const state = useApi<MatchExplanationView>(submitted);
  // Offline: the submitted (validated) matchup — never the half-typed draft.
  const offline = useOfflineFallback(state.error?.offline && submittedTeams ? { season, ...submittedTeams } : null);
  // One error per field (red 1, red 2, blue 1, blue 2), set on submit and cleared as that field is edited.
  const [errors, setErrors] = useState<(string | null)[]>([null, null, null, null]);
  const [checking, setChecking] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  // Bumped by every edit, swap or URL change: a check that finishes after one is stale and dropped.
  const edits = useRef(0);
  const clearError = (i: number) => { edits.current++; setErrors((e) => (e[i] ? e.map((x, j) => (j === i ? null : x)) : e)); };
  const run = async () => {
    if (!ready) return;
    const at = edits.current;
    setChecking(true);
    const errs = await teamsErrors([...red, ...blue], ["red team 1", "red team 2", "blue team 1", "blue team 2"], lookupTeamName);
    setChecking(false);
    if (edits.current !== at) return;
    setErrors(errs);
    const bad = errs.findIndex(Boolean);
    if (bad >= 0) { inputs.current[bad]?.focus(); return; }
    const m = parse(red.join(","), blue.join(","));
    if (!m) return;
    setSubmittedTeams(m);
    setSp((x) => { x.set("mode", "match"); x.set("season", String(season)); x.set("red", red.join(",")); x.set("blue", blue.join(",")); return x; }, { replace: true });
  };
  const swap = () => { edits.current++; setRed(blue); setBlue(red); setErrors((e) => [e[2], e[3], e[0], e[1]]); };
  return (
    <div className="space-y-6 max-sm:space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SeasonToggle predictOnly value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} />
          <span className="text-xs text-muted-foreground">Ratings as of now for {seasonLabel(season)}</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); run(); }} noValidate className="grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
          <fieldset className="rounded-xl border border-red-alliance/30 bg-red-alliance/[0.04] p-4">
            <legend className="px-1 text-sm font-semibold text-red-alliance">Red alliance</legend>
            <div className="grid grid-cols-2 gap-3">{red.map((v, i) => <TeamInput key={i} label={`Red team ${i + 1}`} tone="red" value={v} onChange={(x) => { setRed((r) => r.map((y, j) => (j === i ? x : y))); clearError(i); }} autoFocus={grab && !v && i === red.indexOf("")} error={errors[i]} inputRef={(el) => { inputs.current[i] = el; }} />)}</div>
          </fieldset>
          <div className="flex justify-center md:pt-8"><Button type="button" variant="ghost" size="icon" onClick={swap} aria-label="Swap alliances"><ArrowLeftRight /></Button></div>
          <fieldset className="rounded-xl border border-blue-alliance/30 bg-blue-alliance/[0.04] p-4">
            <legend className="px-1 text-sm font-semibold text-blue-alliance">Blue alliance</legend>
            <div className="grid grid-cols-2 gap-3">{blue.map((v, i) => <TeamInput key={i} label={`Blue team ${i + 1}`} tone="blue" value={v} onChange={(x) => { setBlue((r) => r.map((y, j) => (j === i ? x : y))); clearError(2 + i); }} error={errors[2 + i]} inputRef={(el) => { inputs.current[2 + i] = el; }} />)}</div>
          </fieldset>
          <div className="md:col-span-3"><Button type="submit" size="lg" disabled={!ready || checking} className="w-full sm:w-auto"><Sparkles /> Predict this match</Button></div>
        </form>
      </div>
      {submitted && (state.error
        ? (offline.data ? <MatchResult x={offline.data} offlineAsOf={offline.asOf} /> : offline.loading ? <div className="skeleton h-72 rounded-2xl" /> : <ErrorState error={state.error} onRetry={state.reload} />)
        : !state.data ? <div className="skeleton h-72 rounded-2xl" /> : <MatchResult x={state.data} />)}
      {!submitted && <EmptyState icon={Swords} title="Pick four teams" description="Any teams, any season — a real matchup or a what-if. You'll get win odds, predicted scores with ranges, the three biggest reasons, and how confident the call is." />}
      <SavedPredictions />
    </div>
  );
}

/** No connection: predict from the lite pack saved on this device (same engine). Only ever runs once the
 *  server couldn't be reached (an offline error): the pack code loads lazily then, never on an online visit. */
function useOfflineFallback(q: { season: number; red: number[]; blue: number[] } | null) {
  const [out, setOut] = useState<{ data: MatchExplanationView | null; asOf: string | null; loading: boolean }>({ data: null, asOf: null, loading: false });
  const key = q ? `${q.season}|${q.red}|${q.blue}` : "";
  useEffect(() => {
    if (!q) { setOut({ data: null, asOf: null, loading: false }); return; }
    let live = true;
    setOut((o) => ({ ...o, loading: true }));
    import("../lib/offline/predict").then((p) => p.offlineExplain(q.season, q.red, q.blue)).then((x) => {
      if (!live) return;
      if (!x) { setOut({ data: null, asOf: null, loading: false }); return; }
      noteOfflineAnswer();
      setOut({
        loading: false, asOf: x.asOf,
        data: {
          season: q.season, red: q.red, blue: q.blue, winProbRed: x.winProbA, winProbBlue: x.winProbB, predictedRed: x.predictedScoreA, predictedBlue: x.predictedScoreB,
          rangeRed: x.scoreRangeA, rangeBlue: x.scoreRangeB, rangeLevel: x.scoreBandA.level, factors: x.factors, history: x.partnership ? pairHistory(x.partnership) : null, confidence: x.confidence,
          teamsRed: x.teamsA.map((t) => ({ ...t, name: null })), teamsBlue: x.teamsB.map((t) => ({ ...t, name: null })), bonus: bonusView(q.season, x) ?? null, engineVersion: ENGINE_VERSION,
        },
      });
    }, () => live && setOut({ data: null, asOf: null, loading: false }));
    return () => { live = false; };
  }, [key]);
  return out;
}

function MatchResult({ x, offlineAsOf }: { x: MatchExplanationView; offlineAsOf?: string | null }) {
  const { update } = usePersonal();
  const fav = x.winProbRed >= 0.5 ? "Red" : "Blue";
  const save = () => {
    update("predictionHistory", (h) => [{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, season: x.season, red: x.red, blue: x.blue, winProbRed: x.winProbRed, predictedRed: x.predictedRed, predictedBlue: x.predictedBlue, tier: x.confidence.tier, savedAt: Date.now() }, ...h].slice(0, 200));
    toast.success("Saved to your predictions");
  };
  const share = () => copyLink();
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 max-sm:p-4">
        {offlineAsOf && <p className="mb-3 flex items-center gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs"><WifiOff className="size-3.5 text-info" />Offline — predicted on this device from your lite pack (ratings as of {new Date(offlineAsOf).toLocaleDateString()}).</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ConfidenceBadge tier={x.confidence.tier} reason={x.confidence.reason} />
          <div className="flex gap-2">
            {/* Offline there's no server to draw the card: just the link. */}
            {offlineAsOf ? <Button variant="outline" size="sm" onClick={share}><Link2 /> Share</Button>
              : <ShareMatch query={{ season: x.season, red: x.red, blue: x.blue }} pRed={x.winProbRed} pBlue={x.winProbBlue} tier={x.confidence.tier} />}
            <Button variant="secondary" size="sm" onClick={save}><BookmarkPlus /> Save</Button>
          </div>
        </div>
        <div className="mt-5 max-sm:mt-4 grid grid-cols-[1fr_auto_1fr] items-end gap-4">
          <div><p className="text-sm font-medium text-red-alliance">Red {x.red.join(" + ")}</p><p className="font-display text-5xl font-semibold tabular-nums text-red-alliance sm:text-6xl">{oddsPct(x.winProbRed)}</p></div>
          <p className="pb-3 text-sm text-muted-foreground">to win</p>
          <div className="text-right"><p className="text-sm font-medium text-blue-alliance">Blue {x.blue.join(" + ")}</p><p className="font-display text-5xl font-semibold tabular-nums text-blue-alliance sm:text-6xl">{oddsPct(x.winProbBlue)}</p></div>
        </div>
        <WinBar pRed={x.winProbRed} className="mt-4" />
        <div className="mt-5 max-sm:mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Predicted score</p><p className="font-display text-2xl font-semibold"><ScoreRange mean={x.predictedRed} range={x.rangeRed} level={x.rangeLevel} pmClassName="text-base font-medium text-muted-foreground" /></p><p className="text-xs text-muted-foreground">{levelPct(x.rangeLevel)} range {x.rangeRed[0]}–{x.rangeRed[1]}</p></div>
          <div className="text-right"><p className="text-muted-foreground">Predicted score</p><p className="font-display text-2xl font-semibold"><ScoreRange mean={x.predictedBlue} range={x.rangeBlue} level={x.rangeLevel} pmClassName="text-base font-medium text-muted-foreground" /></p><p className="text-xs text-muted-foreground">{levelPct(x.rangeLevel)} range {x.rangeBlue[0]}–{x.rangeBlue[1]}</p></div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">± is the {levelPct(x.rangeLevel)} range: about {Math.round((x.rangeLevel ?? 0.8) * 10)} in 10 real scores land inside it. It's wider for robots with few matches or up-and-down results. <Link to="/methodology#ranges" className="underline">How often it holds</Link></p>
        {x.bonus && <BonusOdds season={x.season} bonus={x.bonus} className="mt-4 bg-text-base/[0.02]" />}
        <p className="mt-4 text-xs text-muted-foreground">{fav} is favoured — not certain. This is a probability from current ratings, including penalties each side tends to give away.</p>
        <CalibrationLine pRed={x.winProbRed} className="mt-2" />
        {/* Made to be screenshotted: the card says where it came from. */}
        <div className="mt-5 max-sm:mt-4 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><img src="/logo.png" alt="" className="size-4" /> FTC Control Scout · prediction lab</span>
          <span>{seasonLabel(x.season)} · engine v{x.engineVersion}</span>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5 max-sm:p-4">
          <h3 className="mb-3 text-base font-semibold">Why — the top 3 factors</h3>
          <FactorList factors={x.factors} reasons={x.reasons} />
          {x.history ? <PairHistoryLine history={x.history} className="mt-1.5" /> : null}
          <p className="mt-3 text-xs text-muted-foreground">Factors are an exact split of the predicted margin by game phase{x.history ? "; the last line is these robots' real history together or against each other" : ""}. <Link to="/methodology#factors" className="underline">More</Link></p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 max-sm:p-4">
          <h3 className="mb-3 text-base font-semibold">The robots</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><th className="pb-2">Team</th><th className="pb-2 text-right">Adds</th><th className="pb-2 text-right">Auto</th><th className="pb-2 text-right">Tele</th><th className="pb-2 text-right">End</th><th className="pb-2 text-right">Matches</th></tr></thead>
            <tbody>
              {[...x.teamsRed.map((t) => ({ ...t, side: "red" })), ...x.teamsBlue.map((t) => ({ ...t, side: "blue" }))].map((t) => (
                <tr key={t.team} className="border-t border-border">
                  <td className="py-1.5"><Link to={`/teams/${t.team}?season=${x.season}`} className={cn("font-mono hover:underline", t.side === "red" ? "text-red-alliance" : "text-blue-alliance")}>{t.team}</Link> <span className="text-xs text-muted-foreground">{t.name}</span></td>
                  <td className="text-right tabular-nums">{num(t.np, 0)}<span className="text-xs text-muted-foreground"> ±{num(t.sd, 0)}</span></td>
                  <td className="text-right tabular-nums">{num(t.auto, 0)}</td><td className="text-right tabular-nums">{num(t.teleop, 0)}</td><td className="text-right tabular-nums">{num(t.endgame, 0)}</td>
                  <td className="text-right tabular-nums">{t.matches}{t.matches < 3 && <Badge variant="outline" className="ml-1">few</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SavedPredictions() {
  const { state, update } = usePersonal();
  const h = state.predictionHistory;
  if (!h.length) return null;
  return (
    <Section title="Your saved predictions" description="Saved on this device (and your account, when signed in)." action={<Button variant="ghost" size="sm" onClick={() => update("predictionHistory", () => [])}>Clear</Button>}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {h.slice(0, 12).map((p) => (
          <li key={p.id}>
            <Link to={`/predict?mode=match&season=${p.season}&red=${p.red.join(",")}&blue=${p.blue.join(",")}`} className="lift block rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><span><span className="text-red-alliance">{p.red.join("+")}</span> vs <span className="text-blue-alliance">{p.blue.join("+")}</span></span><span className="text-xs text-muted-foreground">{seasonLabel(p.season)}</span></div>
              <WinBar pRed={p.winProbRed} size="sm" className="mt-2" />
              <p className="mt-1 text-xs text-muted-foreground">Red {oddsPct(p.winProbRed)} · {p.predictedRed}–{p.predictedBlue} · {p.tier} · saved {new Date(p.savedAt).toLocaleDateString()}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Advancement: any team, any event
// ---------------------------------------------------------------------------

function AdvancementLab() {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const { state: personal } = usePersonal();
  const season = Number(sp.get("season")) || current;
  const code = sp.get("code");
  const team = Number(sp.get("team")) || null;
  const [teamText, setTeamText] = useState(team ? String(team) : personal.myTeam ? String(personal.myTeam) : "");
  // Arriving on the Lab (nothing else focused): the team box takes focus while it's empty, as Match's first box does.
  const [grab] = useState(() => !document.activeElement || document.activeElement === document.body);
  useEffect(() => { if (team) setTeamText(String(team)); }, [team]);
  // One URL write per change: two in a row would each start from the same URL, so the second undid the first
  // (the season switch set the season, then clearing the event put the old season back).
  const set = (patch: Record<string, string | null>) => setSp((x) => {
    x.set("mode", "advancement");
    for (const [k, v] of Object.entries(patch)) { if (v) x.set(k, v); else x.delete(k); }
    return x;
  }, { replace: true });
  const teamNo = /^\d+$/.test(teamText) ? Number(teamText) : null;
  const teamEvents = useApi<TeamProfile>(teamNo ? `/api/teams/${teamNo}${qs({ season })}` : null);
  const [q, setQ] = useState("");
  // With a team chosen, step 2 lists only the events it's registered at; "Search all events" lifts that until the team or season changes.
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [teamNo, season]);
  const events = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season })}`);
  // The team's profile, once it's the one typed (an unknown number answers an error: no team, every event).
  const profile = teamEvents.data?.team?.number === teamNo ? teamEvents.data : null;
  const teamCodes = useMemo(() => (profile ? new Set(profile.events.map((e) => e.code)) : null), [profile]);
  const { list: choices, teamOnly, teamCount, otherMatches } = useMemo(() => labEventChoices(events.data?.events ?? [], { teamCodes, q, showAll }), [events.data, teamCodes, q, showAll]);
  const teamLoading = !!teamNo && teamEvents.loading;
  // The lookup failed for another reason than an unknown team (offline, server error): say so, never fall back to every event.
  const teamStatus = (teamEvents.error as ApiError | undefined)?.status;
  const teamFailed = !!teamNo && !!teamEvents.error && teamStatus !== 404 && teamStatus !== 400;
  // Another season the team has events to try (newest first, predicted seasons only).
  const otherSeason = profile?.seasons.find((s) => s !== season && s >= 2023) ?? null;
  const step = "mb-2 flex items-center gap-2 text-sm font-semibold text-foreground";
  const num = "flex size-6 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent-text";
  return (
    <div className="space-y-6 max-sm:space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <SeasonToggle predictOnly value={season} onChange={(s) => set({ season: String(s), code: null })} />
        </div>
        <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className={step}><span className={num}>1</span> Team</p>
            <TeamInput size="lg" label="Team" autoFocus={grab && !teamText} value={teamText} onChange={(v) => { setTeamText(v); set({ team: v || null }); }} />
            <p className="mt-2 text-sm text-muted-foreground">{profile ? `Only its ${seasonLabel(season)} events are listed.` : "Add a team to list only its events."}</p>
          </div>
          <div className="min-w-0">
            <p className={step}><span className={num}>2</span> Event</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Event name, code, city or state" className="h-14 pl-11 text-base" aria-label="Find an event" />
            </div>
            {(profile || teamFailed) && showAll && (
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                Showing every event.
                <button type="button" className="font-medium text-accent-text underline underline-offset-4" onClick={() => setShowAll(false)}>Only {teamNo}'s events</button>
              </p>
            )}
            <div className="custom-scrollbar mt-3 max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
              {events.error ? <p className="text-sm text-destructive">{events.error.message}</p>
                : !events.data || teamLoading ? <div className="skeleton h-40 rounded-xl" />
                : teamFailed && !showAll ? (
                  <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border px-4 py-5">
                    <p className="text-base font-medium text-foreground">Couldn't load {teamNo}'s events</p>
                    <p className="-mt-2 text-sm text-muted-foreground">{teamEvents.error!.message}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => teamEvents.reload()}>Try again</Button>
                      <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>Search all events</Button>
                    </div>
                  </div>
                )
                : !choices.length ? <LabEventsEmpty team={teamOnly ? teamNo : null} teamCount={teamCount} teamEvents={profile?.events.length ?? 0} season={season} q={q} otherMatches={otherMatches}
                    otherSeason={otherSeason} onShowAll={() => setShowAll(true)} onSeason={(s) => set({ season: String(s), code: null })} onClearSearch={() => setQ("")} />
                : choices.slice(0, 60).map((e) => (
                <button key={e.code} type="button" aria-pressed={code === e.code} onClick={() => set({ code: e.code })}
                  className={cn("flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors max-sm:px-3",
                    code === e.code ? "border-accent/60 bg-accent/[0.08]" : "border-border/60 hover:border-border hover:bg-text-base/[0.04]")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium">{e.name}</span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">{[e.typeLabel, [e.city, e.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
                  </span>
                  {!teamOnly && teamCodes?.has(e.code) && <Badge variant="soft" className="shrink-0 max-sm:hidden">{teamText}'s event</Badge>}
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{dateRange(e.start, e.end)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {code ? <AdvancementView season={season} code={code} team={team} nameOf={() => ""} onPickTeam={(t) => { setTeamText(String(t)); set({ team: String(t) }); }} />
        : <EmptyState icon={Trophy} title="Pick an event" description="Any qualifier, league tournament or championship. Add a team to see its chance to advance, captain and pick odds, likely rank, and expected advancement points." />}
    </div>
  );
}

/** Whether the element is at least `rem` root ems wide (so a larger browser font raises it, as the container query does), following its size. */
export function useWiderThan(ref: React.RefObject<HTMLElement | null>, rem: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= rem * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, rem]);
  return wide;
}
