// Event page: schedule + results (with predictions), rankings and insights
// (records tables with filters, sorting, compare and CSV), the teams, playoff
// bracket, awards + advancement, and advancement odds for any team there.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Award, CalendarDays, Clock, ExternalLink, Loader2, MapPin, Radio, RefreshCw, Search, Sparkles, Swords, Trophy, Users } from "lucide-react";
import { BRACKETS, type Slot } from "@control-scout/predict-engine";
import { ApiError, apiFetch, load, prime, useApi } from "../lib/api";
import { useMeta, usePredictable, useTitle } from "../lib/meta";
import { TABLE_PARAMS } from "../lib/records/urlState";
import { RecordsTable } from "../components/records/RecordsTable";
import { usePersonal } from "../lib/personal";
import type { EventDetail, EventRefreshResult, FieldRow, MatchView } from "../shared/api";
import { EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Reveal } from "../components/motion";
import { Badge, Input } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { StickyActions, useScrolledPast } from "../components/StickyActions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/controls";
import { MatchList } from "../components/predict";
import { SortTable, type Col } from "../components/SortTable";
import { AdvancementView } from "../components/Advancement";
import { cn } from "../components/cn";
import { OfflineNote } from "../components/OfflineNote";
import { EventGlance } from "../components/EventGlance";
import { callRecord } from "../lib/eventGlance";
import { NotFoundView } from "../components/NotFoundView";
import { LiveCountdownChip, LivePanel, useLiveTarget } from "../components/LivePanel";
import { HeaderActions } from "../components/EventActions";
import { isLiveMode, useEventPoll } from "../lib/liveMode";
import { agoSeconds, awardLabel, dateRange, num, place, seasonLabel } from "../lib/format";
import { scrollToElement } from "../lib/pageScroll";

export default function EventPage() {
  const { season, code } = useParams();
  const path = `/api/events/${season}/${code}`;
  // A season is digits only (as on the server: /events/02025/X is 2025; /events/0x7E9/X is no page).
  const validSeason = /^\d+$/.test(season ?? "");
  const state = useApi<EventDetail>(validSeason ? path : null);
  // No such event (404), or an address that can't be one (400: a malformed code or season): the branded
  // not-found page, which the server also answers with a 404.
  const status = validSeason ? (state.error as ApiError | undefined)?.status : 400;
  const missing = status === 404 || status === 400;
  useTitle(missing ? "Event not found" : state.data ? `${state.data.event.name} (${seasonLabel(state.data.event.season)})` : code); // same as the server-rendered title
  // Live: scores and rankings refresh on their own (lib/liveMode.ts has the cadence).
  useEventPoll(state.data, () => { load(path, true).catch(() => {}); });
  if (missing) return <NotFoundView title={status === 404 ? state.error!.message : `No event ${code} in ${season}`} description="The event code may be mistyped or from another season. Search by name, code or city." />;
  return <Async state={state}>{(d) => <Event d={d} path={path} />}</Async>;
}

function Event({ d, path }: { d: EventDetail; path: string }) {
  const [sp, setSp] = useSearchParams();
  const e = d.event;
  const { state: personal, update } = usePersonal();
  const ref = `${e.season}:${e.code}`;
  const tracked = personal.tracked.events.includes(ref);
  const teamParam = Number(sp.get("team")) || null;
  const names = useMemo(() => new Map(d.field.map((f) => [f.team, f.name ?? ""])), [d.field]);
  const nameOf = (t: number) => names.get(t) ?? "";
  // 2019–2022 are history only: no odds, no what-if lab (their predict routes 404).
  const predictable = usePredictable(e.season);
  // The records tables follow the live results: fetched again whenever the event's results are checked or the stats are rebuilt.
  const statsAt = useMeta()?.statsAt ?? "";
  const recordsKey = `${d.live?.checkedAt ?? ""}|${statsAt}`;
  const asked = sp.get("tab") ?? (sp.get("match") ? "matches" : e.status === "upcoming" && !d.matches.length ? (predictable ? "odds" : "teams") : "matches");
  const tab = !predictable && asked === "odds" ? "matches" : asked;
  // Rankings and Insights are different tables: a filter, sort or column choice belongs to the one it was made in.
  const setTab = (t: string) => setSp((x) => { if (t !== tab) for (const k of TABLE_PARAMS) x.delete(k); x.set("tab", t); return x; }, { replace: true });
  const setTeam = (t: number | null) => setSp((x) => { if (t) x.set("team", String(t)); else x.delete("team"); return x; }, { replace: true });
  const toggleTrack = () => update("tracked", (t) => ({ ...t, events: tracked ? t.events.filter((x) => x !== ref) : [...t.events, ref] }));
  const track = { on: tracked, toggle: toggleTrack };
  const labHref = `/predict?mode=advancement&season=${e.season}&code=${e.code}${teamParam ? `&team=${teamParam}` : ""}`;
  const refresh = useRefreshResults(path);
  const [headerEnd, pastHeader] = useScrolledPast<HTMLDivElement>();
  const tabsRef = useRef<HTMLDivElement>(null);
  // The bar's "See odds" opens the tab and brings it into view (the header that held the button is off screen).
  const seeOdds = () => { setTab("odds"); if (tabsRef.current) scrollToElement(tabsRef.current, matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"); };
  // Phones get a sticky bar only where one action leads: live (the countdown, back to the LIVE panel) or upcoming with predictions (odds / lab).
  // Finished events and history seasons have no bar.
  const sticky = e.status === "live" || (e.status === "upcoming" && predictable);
  // Live mode (the event is running now): the LIVE panel with the countdown replaces the live bar.
  const liveMode = isLiveMode(d);
  const target = useLiveTarget(d, liveMode);
  const livePanel = useRef<HTMLDivElement>(null);
  const toLivePanel = () => { if (livePanel.current) scrollToElement(livePanel.current, matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"); };
  const oddsOpen = predictable && !d.forecastUnsupported;
  return (
    <div>
      <OfflineNote data={d} />
      <Reveal fade={false} className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-accent opacity-15 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-10">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {e.status === "live" ? <Badge variant="destructive"><Radio /> Live</Badge> : e.status === "upcoming" ? <Badge variant="secondary">Upcoming</Badge> : <Badge variant="outline">Finished</Badge>}
            <Badge variant="outline">{e.typeLabel}</Badge>
            <span className="font-mono text-xs text-muted-foreground">{e.code} · {seasonLabel(e.season)}</span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{e.name}</h1>
          {/* Right under the name, so the countdown is on a phone's first screen. */}
          {liveMode && <div ref={livePanel} className="scroll-mt-bar-20"><LivePanel d={d} target={target} refresh={refresh} track={track} /></div>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><CalendarDays className="size-4" />{dateRange(e.start, e.end)}</span>
            {(e.venue || e.city) && <span className="flex items-center gap-1.5"><MapPin className="size-4" />{place(e.venue, e.city, e.state, e.country)}</span>}
            <span>{e.teams} teams · {e.matchesPlayed}/{e.matchesTotal} matches played</span>
            {e.website && <a href={e.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-foreground">Website <ExternalLink className="size-3" /></a>}
          </div>
          {d.live && !liveMode && <LiveBar live={d.live} r={refresh} />}
          <HeaderActions liveMode={liveMode} livestream={e.livestream} track={track}>
            {predictable && <Button variant="outline" size="sm" asChild><Link to={labHref}>Open in what-if lab</Link></Button>}
          </HeaderActions>
          {!predictable && <p className="mt-3 text-xs text-muted-foreground">{seasonLabel(e.season)} is shown for history: results, rankings and awards, no predictions (those start with 2023–24).</p>}
          <p className="mt-3 text-[11px] text-muted-foreground">Source: {e.source === "first" ? "FIRST Events API" : "FTC Scout"}</p>
        </div>
        <EventGlance d={d} onTab={setTab} live={liveMode ? { match: target.next, mine: !!target.mine, open: toLivePanel } : undefined} />
        </div>
        <div ref={headerEnd} aria-hidden />
      </Reveal>
      {sticky && (
        <StickyActions show={pastHeader} label="Event actions">
          {liveMode
            ? <LiveCountdownChip target={target} onClick={toLivePanel} />
            : oddsOpen
              ? <Button onClick={seeOdds}><Trophy /> See odds</Button>
              : predictable && <Button asChild><Link to={labHref}><Sparkles /> What-if lab</Link></Button>}
          <Button variant={tracked ? "secondary" : "outline"} aria-pressed={tracked} onClick={toggleTrack} className="!flex-none">{tracked ? "Tracking" : "Track event"}</Button>
        </StickyActions>
      )}

      <div ref={tabsRef} className="scroll-mt-bar-4" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="rankings">Rankings</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="teams">Teams <span className="rounded-md bg-current/15 px-1.5 text-[11px] tabular-nums">{d.field.length}</span></TabsTrigger>
          <TabsTrigger value="playoffs">Playoffs</TabsTrigger>
          <TabsTrigger value="awards">Awards</TabsTrigger>
          {predictable && <TabsTrigger value="odds">Odds</TabsTrigger>}
        </TabsList>
        <TabsContent value="matches" className="mt-5"><Matches d={d} team={teamParam} /></TabsContent>
        <TabsContent value="rankings" className="mt-5">
          {tab === "rankings" && (
            <>
              {/* While the event is on, the ranking comes from the event itself (refreshed every minute or so);
                  the records table below is rebuilt by the stats cycle, so it says how old it is. */}
              {e.status === "live" && <LiveStandings field={d.field} season={e.season} team={teamParam} code={e.code} />}
              {e.status === "live" && <StatsAsOf />}
              <RecordsTable scope="teamEvent" season={e.season} code={e.code} predictable={predictable} refreshKey={recordsKey} defaultSort="rank" storageKey="event-rankings" noun="teams"
                defaultCols={RANKING_COLS.filter((k) => k !== "advancementOdds" || !d.forecastUnsupported)} selectable highlightTeam={teamParam}
                emptyFallback={e.status === "live" ? <EmptyState icon={Swords} title="Full stats arrive with the next stats update" description="The live standings above are current." /> : <Rankings field={d.field} season={e.season} team={teamParam} code={e.code} note={NOTE_NO_RECORDS} />}
                offlineFallback={<Rankings field={d.field} season={e.season} team={teamParam} code={e.code} note={NOTE_OFFLINE} />} />
            </>
          )}
        </TabsContent>
        <TabsContent value="insights" className="mt-5">
          {tab === "insights" && e.status === "live" && <StatsAsOf />}
          {tab === "insights" && (
            <RecordsTable scope="teamEvent" season={e.season} code={e.code} predictable={predictable} refreshKey={recordsKey} defaultSort="totalPointsNpOpr" storageKey="event-insights" noun="teams"
              defaultCols={INSIGHT_COLS} selectable highlightTeam={teamParam}
              emptyFallback={<EmptyState icon={Swords} title="No match stats yet" description="Score breakdowns, OPR and averages appear here once qualification matches have been played and the stats have been updated." />}
              offlineFallback={<Rankings field={d.field} season={e.season} team={teamParam} code={e.code} note={NOTE_OFFLINE} />} />
          )}
        </TabsContent>
        <TabsContent value="teams" className="mt-5"><TeamsGrid field={d.field} season={e.season} team={teamParam} predictable={predictable} /></TabsContent>
        <TabsContent value="playoffs" className="mt-5"><Playoffs d={d} /></TabsContent>
        <TabsContent value="awards" className="mt-5"><Awards d={d} nameOf={nameOf} /></TabsContent>
        {predictable && <TabsContent value="odds" className="mt-5">
          {/* Every event with a schedule gets match predictions; advancement odds only where teams advance. */}
          <TeamPicker field={d.field} value={teamParam} onChange={setTeam} />
          {d.forecastUnsupported ? (
            <p className="mb-6 flex items-start gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              <Trophy className="mt-0.5 size-4 shrink-0" />
              <span>{d.forecastUnsupported} Every scheduled match below still gets win odds and a predicted score.</span>
            </p>
          ) : (
            <section aria-label="Advancement odds" className="mb-10">
              <h2 className="mb-3 font-display text-lg font-semibold text-foreground">Advancement odds</h2>
              <AdvancementView season={e.season} code={e.code} team={teamParam} nameOf={nameOf} onPickTeam={setTeam} />
            </section>
          )}
          <MatchOdds d={d} team={teamParam} onTab={setTab} />
        </TabsContent>}
      </Tabs>
    </div>
  );
}

/** "Refresh results" for a live event: shared by the header's live bar and the phone's sticky bar. */
function useRefreshResults(path: string) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const noteTimer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);
  const say = (m: string) => { setNote(m); window.clearTimeout(noteTimer.current); noteTimer.current = window.setTimeout(() => setNote(null), 8000); };
  /** Refreshes and returns what happened (also shown as the live bar's note). */
  const run = async (): Promise<{ ok: boolean; message: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch<EventRefreshResult>(`${path}/refresh`, { method: "POST" });
      prime(path, r.detail);
      setAt(Date.now());
      say(r.message);
      // "failed" comes back as a 200 (FIRST didn't answer; the cached detail is still good).
      return { ok: r.outcome !== "failed", message: r.message };
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't refresh right now. Try again in a moment.";
      say(message);
      return { ok: false, message };
    } finally { setBusy(false); }
  };
  return { busy, note, at, run };
}

/** "Results updated 40 s ago" + "Refresh results", on events that are on today. */
function LiveBar({ live, r }: { live: NonNullable<EventDetail["live"]>; r: ReturnType<typeof useRefreshResults> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (r.at) setNow(r.at); }, [r.at]);
  const { busy, note } = r;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-medium text-foreground">
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-destructive" />
        </span>
        {live.checkedAt ? <>Results updated <time dateTime={live.checkedAt} className="tabular-nums">{agoSeconds(live.checkedAt, now)}</time></> : "Results not checked yet today"}
      </span>
      <Button variant="outline" size="sm" onClick={r.run} disabled={busy} aria-busy={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {busy ? "Checking…" : "Refresh results"}
      </Button>
      <span className="text-xs text-muted-foreground">{live.auto ? <>Checks for new results every {live.everySeconds < 90 ? `${live.everySeconds} s` : `${Math.round(live.everySeconds / 60)} min`} on its own</> : "Refresh to check for new results"}</span>
      <p role="status" aria-live="polite" className="w-full text-xs text-muted-foreground empty:hidden">{note}</p>
    </div>
  );
}

/** Win odds and predicted scores for the matches still to play (one team's, when a team is picked). */
function MatchOdds({ d, team, onTab }: { d: EventDetail; team: number | null; onTab: (t: string) => void }) {
  const mine = (m: MatchView) => !team || [...m.red.teams, ...m.blue.teams].some((t) => t.number === team);
  const unplayed = d.matches.filter((m) => !m.played && mine(m));
  const predicted = unplayed.filter((m) => m.prediction);
  const played = d.matches.filter((m) => m.played && mine(m));
  const fullLineup = (m: MatchView) => [m.red, m.blue].every((a) => a.teams.filter((t) => t.onField).length === 2);
  const ended = d.event.status === "finished";
  const who = team ? `${team}'s` : "the";
  // "all 12 of the matches" / "10 of 12 of 4215's matches" / "4215's only match"
  const scope = predicted.length === unplayed.length
    ? (unplayed.length === 1 ? (team ? `${who} only match` : "the only match") : `all ${unplayed.length} of ${who} matches`)
    : `${predicted.length} of ${who} ${unplayed.length} matches`;
  const seeHow = <button type="button" onClick={() => onTab("matches")} className="underline">See how the predictions did</button>;
  // The event's dates have passed: never promise a list. Unplayed matches there are missing results, not upcoming.
  const message: ReactNode = ended
    ? (unplayed.length
      ? <>This event has ended. {unplayed.length} scheduled {unplayed.length === 1 ? "match has" : "matches have"} no result yet, so {unplayed.length === 1 ? "it isn't" : "they aren't"} listed here as upcoming. {played.length > 0 && seeHow}</>
      : <>All of {who} matches have been played. {seeHow}.</>)
    : predicted.length ? (predicted.some((m) => m.prediction?.noScoreBasis)
      ? `Win odds for ${scope} still to play. Where a call was made before this season had any rated matches (scrimmages aren't rated), it has no predicted score: the ratings then were last season's.`
      : `Win odds and predicted scores for ${scope} still to play, from current ratings.`)
      : played.length && !unplayed.length ? <>All of {who} matches have been played. {seeHow}.</>
        : unplayed.length
          ? (unplayed.some(fullLineup)
            ? "Predictions aren't available right now (the ratings are still loading). Try again in a minute."
            : "The scheduled matches don't have full 2-against-2 lineups yet, so there's nothing to predict until they do.")
          : team && d.matches.length ? `${team} has no scheduled matches at this event.`
            : "No schedule published yet. Every match gets win odds and a predicted score as soon as it is (usually the morning of the event).";
  return (
    <section aria-label="Match predictions">
      <h2 className="mb-1 font-display text-lg font-semibold text-foreground">Match predictions</h2>
      <p className="mb-3 text-sm text-muted-foreground">{message}</p>
      {!ended && unplayed.length > 0 && <MatchList matches={unplayed} highlight={team ?? undefined} />}
    </section>
  );
}

function TeamPicker({ field, value, onChange }: { field: FieldRow[]; value: number | null; onChange: (t: number | null) => void }) {
  const [q, setQ] = useState("");
  const options = field.filter((f) => !q || String(f.team).includes(q) || (f.name ?? "").toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Odds for team</span>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={value ? String(value) : "type a number or name"} className="h-9 w-48" aria-label="Pick a team at this event" />
      {q && options.map((f) => <Button key={f.team} size="sm" variant="secondary" onClick={() => { onChange(f.team); setQ(""); }}>{f.team} {f.name && <span className="max-w-32 truncate text-muted-foreground">{f.name}</span>}</Button>)}
      {value != null && !q && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>All teams</Button>}
    </div>
  );
}

function Matches({ d, team }: { d: EventDetail; team: number | null }) {
  const predictable = usePredictable(d.event.season);
  const [level, setLevel] = useState<"all" | "qual" | "playoff">("all");
  const [onlyTeam, setOnlyTeam] = useState(!!team);
  const [sp] = useSearchParams();
  // A linked match (?match=, from search or prev/next) must be visible: drop any filter that hides it.
  const want = sp.get("match");
  useEffect(() => {
    const m = want ? d.matches.find((x) => x.key === want) : undefined;
    if (!m) return;
    if (level !== "all" && m.level !== level) setLevel("all");
    if (onlyTeam && team && ![...m.red.teams, ...m.blue.teams].some((t) => t.number === team)) setOnlyTeam(false);
    // Only when the requested match changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, d.matches.length]);
  const list = d.matches.filter((m: MatchView) => (level === "all" || m.level === level) && (!onlyTeam || !team || [...m.red.teams, ...m.blue.teams].some((t) => t.number === team)));
  const record = callRecord(d.matches);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* The tab's heading for screen readers: the list's Qualifications / Playoffs headings (h3) sit under it.
            In here (absolutely placed) so it adds no space to the stack. */}
        <h2 className="sr-only">Matches</h2>
        <ToggleGroup type="single" value={level} onValueChange={(v) => { if (v) setLevel(v as typeof level); }} aria-label="Match level">
          <ToggleGroupItem value="all">All</ToggleGroupItem><ToggleGroupItem value="qual">Quals</ToggleGroupItem><ToggleGroupItem value="playoff">Playoffs</ToggleGroupItem>
        </ToggleGroup>
        {team && <Button size="sm" variant={onlyTeam ? "secondary" : "outline"} onClick={() => setOnlyTeam(!onlyTeam)}>{onlyTeam ? `Only ${team}` : `Highlight ${team}`}</Button>}
        {record.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{record.map((x) => `${x.kind === "live" ? "Live calls" : "Predicted"} ${x.right}/${x.n} right (${Math.round((x.right / x.n) * 100)}%)`).join(" · ")}</span>}
      </div>
      {!d.matches.length ? <EmptyState icon={Swords} title="No schedule yet" description="The match schedule appears here once FIRST publishes it (usually the morning of the event)." /> : (
        <MatchList matches={list} highlight={team ?? undefined} empty="No matches in this view." initialOpen={want} />
      )}
      {predictable && <p className="text-xs text-muted-foreground">Played matches show the prediction logged before they were played (or, for past seasons, the prediction replayed from the matches before it). Upcoming matches show odds from today's ratings.</p>}
    </div>
  );
}

/** Rankings tab columns (FTC Scout's: RS, TBP, played, record, np OPR / AVG / MAX) plus Control Scout's win % and odds. */
const RANKING_COLS = ["rank", "rp", "tb1", "qualMatchesPlayed", "wins", "losses", "ties", "totalPointsNpOpr", "totalPointsNpAvg", "totalPointsNpMax", "predictedWinPctAvg", "advancementOdds"];
const NOTE_NO_RECORDS = "Filters, every stat and CSV export arrive here after the next stats update. Until then, the official ranking:";
const NOTE_OFFLINE = "You're offline, so here is the ranking saved on this device. Filters, every stat and export need a connection.";
/** Insights tab: where the points come from. */
const INSIGHT_COLS = ["totalPointsNpOpr", "autoPointsOpr", "dcPointsOpr", "endgamePointsOpr", "penaltyPointsCommittedOpr", "autoPointsAvg", "dcPointsAvg", "endgamePointsAvg", "totalPointsNpMax", "predictedScoreAvg"];

/**
 * While an event is live: the standings from the event itself (rank, RS, record,
 * OPR — refreshed with the event, every minute or so), first. The records table
 * under it is rebuilt by the stats cycle, so it can lag a few matches behind.
 */
function LiveStandings({ field, season, team, code }: { field: FieldRow[]; season: number; team: number | null; code: string }) {
  return (
    <section aria-label="Live standings" className="mb-8 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-3 sm:p-4">
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Radio className="size-4 text-red-500" /> Live standings
        <span className="font-normal text-muted-foreground">· the official ranking, updated as matches are scored</span>
      </h2>
      <Rankings field={field} season={season} team={team} code={code} />
    </section>
  );
}

/** How fresh the records tables are, shown while an event is live (they're rebuilt by the stats cycle, not every match). */
function StatsAsOf() {
  const at = useMeta()?.statsAt;
  const time = at ? new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <p className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
      <Clock className="size-3.5 shrink-0" />
      <span>Full stats and filters{time ? <> as of <span className="font-medium text-foreground">{time}</span></> : null} — rebuilt every few minutes during events, so the last few matches may not be in yet.</span>
    </p>
  );
}

function Rankings({ field, season, team, code, note }: { field: FieldRow[]; season: number; team: number | null; code: string; note?: string }) {
  if (note) return (
    <div className="space-y-3">
      <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {note}
      </p>
      <Rankings field={field} season={season} team={team} code={code} />
    </div>
  );
  const cols: Col<FieldRow>[] = [
    { key: "rank", label: "Rank", value: (r) => r.rank, asc: true, align: "right", render: (r) => r.rank ?? "—" },
    { key: "team", label: "Team", value: (r) => r.team, render: (r) => <Link to={`/teams/${r.team}?season=${season}`} className="hover:underline"><span className="font-mono font-medium">{r.team}</span> <span className="text-muted-foreground">{r.name}</span></Link> },
    { key: "rs", label: "RS", title: "Ranking score (average ranking points)", value: (r) => r.rp, align: "right", render: (r) => num(r.rp, 2) },
    { key: "wlt", label: "W-L-T", value: (r) => (r.wins ?? 0) - (r.losses ?? 0), align: "right", render: (r) => `${r.wins ?? "–"}-${r.losses ?? "–"}-${r.ties ?? "–"}` },
    { key: "opr", label: "OPR", value: (r) => r.opr.np, align: "right", render: (r) => num(r.opr.np) },
    { key: "auto", label: "Auto", value: (r) => r.opr.auto, align: "right", render: (r) => num(r.opr.auto), hideOnMobile: true },
    { key: "teleop", label: "TeleOp", value: (r) => r.opr.teleop, align: "right", render: (r) => num(r.opr.teleop), hideOnMobile: true },
    { key: "endgame", label: "Endgame", value: (r) => r.opr.endgame, align: "right", render: (r) => num(r.opr.endgame), hideOnMobile: true },
    { key: "pen", label: "Pen.", title: "Penalty points given away per match (OPR)", value: (r) => r.opr.pen, asc: true, align: "right", render: (r) => num(r.opr.pen), hideOnMobile: true },
    { key: "rating", label: "Rating", title: "Prediction rating now (± uncertainty)", value: (r) => r.rating?.np ?? null, align: "right", render: (r) => r.rating ? <span>{num(r.rating.np)} <span className="text-muted-foreground">±{num(r.rating.sd, 0)}</span></span> : "—" },
  ];
  return <SortTable rows={field} cols={cols} rowKey={(r) => r.team} initial={{ key: "rank", dir: "asc" }} csvName={`${code}-${season}-rankings`} highlight={(r) => r.team === team} empty="No teams registered yet." />;
}

/** Teams (N): everyone registered, as cards — rank, OPR and rating at a glance, searchable. */
function TeamsGrid({ field, season, team, predictable }: { field: FieldRow[]; season: number; team: number | null; predictable: boolean }) {
  const [q, setQ] = useState("");
  const f = q.trim().toLowerCase();
  const list = [...field]
    .filter((t) => !f || `${t.team} ${t.name ?? ""} ${t.city ?? ""} ${t.state ?? ""}`.toLowerCase().includes(f))
    .sort((a, b) => a.team - b.team);
  if (!field.length) return <EmptyState icon={Users} title="No teams registered yet" description="The team list appears once FIRST publishes it." />;
  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find one of ${field.length} teams`} aria-label="Find a team at this event" className="h-10 pl-9" />
      </div>
      {!list.length ? <EmptyState icon={Search} title="No team matches" /> : (
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => (
            <li key={t.team}>
              <Link to={`/teams/${t.team}?season=${season}`} className={cn("lift flex h-full items-center gap-3 rounded-xl border border-border bg-card p-3", t.team === team && "border-accent/60 bg-accent/[0.06]")}>
                <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-lg bg-muted text-center">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Rank</span>
                  <span className={cn("font-display text-lg font-semibold leading-none tabular-nums", t.rank != null && t.rank <= 4 && "text-accent")}>{t.rank ?? "–"}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2"><span className="font-mono font-semibold">{t.team}</span><span className="truncate text-sm">{t.name}</span></span>
                  <span className="block truncate text-xs text-muted-foreground">{place(t.city, t.state) || "—"}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] tabular-nums">
                    {t.opr.np != null && <span className="rounded-md bg-violet-500/12 px-1.5 py-0.5 text-violet-600 dark:text-violet-400">npOPR {num(t.opr.np)}</span>}
                    {t.wins != null && <span className="rounded-md bg-green-500/12 px-1.5 py-0.5 text-green-600 dark:text-green-400">{t.wins}-{t.losses ?? 0}-{t.ties ?? 0}</span>}
                    {predictable && t.rating && <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-accent-text">Rating {num(t.rating.np)} ±{num(t.rating.sd, 0)}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function slotLabel(s: Slot): string {
  if ("seed" in s) return `Seed ${s.seed}`;
  if ("winnerOf" in s) return `Winner M${s.winnerOf}`;
  return `Loser M${s.loserOf}`;
}

function Playoffs({ d }: { d: EventDetail }) {
  const al = d.alliances;
  if (!al.length) return <EmptyState icon={Trophy} title="Alliances not selected yet" description="Alliance selection happens after qualification matches." />;
  const playoff = d.matches.filter((m) => m.level === "playoff");
  const bracket = BRACKETS[al.length];
  const bySeries = new Map<number, MatchView[]>();
  for (const m of playoff) bySeries.set(m.series, [...(bySeries.get(m.series) ?? []), m]);
  const allianceOf = (teams: number[]) => al.find((a) => [a.captain, a.pick1, a.pick2, a.backup].some((t) => t && teams.includes(t)))?.number;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {al.map((a) => (
          <div key={a.number} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Alliance {a.number}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[a.captain, a.pick1, a.pick2, a.backup].filter((t): t is number => t != null).map((t, i) => (
                <Link key={t} to={`/teams/${t}?season=${d.event.season}`} className={cn("rounded-md px-2 py-0.5 font-mono text-sm", i === 0 ? "bg-accent text-accent-ink" : "bg-muted")}>{t}</Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      {bracket ? (
        <div>
          <h3 className="mb-3 text-base font-semibold">Double-elimination bracket</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {bracket.matches.map((bm, i) => {
              const ms = bySeries.get(i + 1) ?? [];
              const last = ms.filter((m) => m.played).at(-1);
              const winnerAl = last && last.red.score && last.blue.score ? allianceOf((last.red.score.total > last.blue.score.total ? last.red : last.blue).teams.map((t) => t.number)) : null;
              const isFinal = i === bracket.matches.length - 1;
              return (
                <div key={i} className={cn("rounded-xl border border-border bg-card p-3", isFinal && "border-accent/40")}>
                  <p className="text-xs font-medium text-muted-foreground">M{i + 1}{isFinal ? " · Grand final" : ""}</p>
                  <p className="mt-1 text-sm">{slotLabel(bm.red)} <span className="text-muted-foreground">vs</span> {slotLabel(bm.blue)}</p>
                  {ms.length ? ms.map((m) => (
                    <p key={m.key} className="mt-1 text-xs tabular-nums text-muted-foreground">{m.label}: {m.played && m.red.score && m.blue.score ? <><span className="text-red-alliance">{m.red.score.total}</span>–<span className="text-blue-alliance">{m.blue.score.total}</span></> : "not played yet"}</p>
                  )) : <p className="mt-1 text-xs text-muted-foreground">Not scheduled yet</p>}
                  {winnerAl && <Badge variant="soft" className="mt-2"><Trophy /> Alliance {winnerAl}</Badge>}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <MatchList matches={playoff} empty="No playoff matches yet." />
    </div>
  );
}

function Awards({ d, nameOf }: { d: EventDetail; nameOf: (t: number) => string }) {
  const s = d.event.season;
  return (
    <div className="space-y-6">
      {!d.awards.length ? <EmptyState icon={Award} title="No awards published yet" description="Awards appear after the closing ceremony." /> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {d.awards.map((a) => (
            <li key={`${a.type}${a.placement}${a.team}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <Award className="size-5 shrink-0 text-accent" />
              <div className="min-w-0"><p className="text-sm font-medium">{a.name ?? awardLabel(a.type, a.placement)}</p><Link to={`/teams/${a.team}?season=${s}`} className="text-sm text-muted-foreground hover:underline"><span className="font-mono">{a.team}</span> {nameOf(a.team)}</Link></div>
            </li>
          ))}
        </ul>
      )}
      {d.advancement && (
        <div>
          <h3 className="mb-2 text-base font-semibold">Advancement <span className="text-sm font-normal text-muted-foreground">· {d.advancement.slots} slots{d.advancement.advancesTo ? ` to ${d.advancement.advancesTo}` : ""}</span></h3>
          <div className="flex flex-wrap gap-2">
            {d.advancement.rows.map((r) => (
              <Link key={r.team} to={`/teams/${r.team}?season=${s}`} className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm hover:border-accent/40">
                <span className="font-mono">{r.team}</span> <span className="text-xs text-muted-foreground">{r.status === "FIRST" ? "advanced" : r.status === "ALREADY_ADVANCING" ? "already qualified" : r.status.toLowerCase()}{r.declined ? " · declined" : ""}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
