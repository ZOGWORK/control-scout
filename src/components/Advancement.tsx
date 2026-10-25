// Advancement simulator view — Control Point's Predict page (stage strip,
// Outlook, Alliance, Field), generalised to ANY team at ANY event.
import { SimProgress } from "./SimProgress";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { Link } from "react-router-dom";
import { m } from "./motion";
import { ArrowUpRight, Check, ChevronDown, Crown, Gauge, History, Info, PanelRight, RefreshCw, Search, Trophy, Users } from "lucide-react";
import { useApi, qs, load } from "../lib/api";
import type { ConfidenceTier, EventDetail, FieldRow, ForecastView, Partners } from "../shared/api";
import { TeamPeek } from "./TeamPeek";
import { cn } from "./cn";
import { Badge, Input } from "./ui/basic";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "./ui/controls";
import { EmptyState, Stat } from "./page";
import { Stagger, StaggerItem } from "./motion";
import { ErrorState } from "./states";
import { ConfidenceBadge } from "./predict";
import { ago, oddsPct } from "../lib/format";
import { projectionsPath } from "../lib/projections";
import { projectionHeadline } from "./Projections";
import { ADVANCE_LABEL, advanceStatus, type ProjectionRun, type ProjectionsView } from "../shared/projections";

const ease = [0.2, 0.8, 0.2, 1] as const;
const pct = (p: number | null | undefined, decided = false) => oddsPct(p, decided);
/** A seat that alliance selection already settled: it was taken or it wasn't. */
const yesNo = (p: number | null | undefined) => ((p ?? 0) >= 0.5 ? "Yes" : "No");
/** Playoffs are over once a played final exists and none is left to play (after alliance selection). */
const playoffsDone = (fc: ForecastView) => fc.stage === "selected" && fc.matches.some((x) => x.level === "playoff" && x.played) && !fc.matches.some((x) => x.level === "playoff" && !x.played);
const rankRange = (a: number, b: number) => (Math.round(a) === Math.round(b) ? `#${Math.round(a)}` : `#${Math.round(a)}–${Math.round(b)}`);

function GrowBar({ value, className, delay = 0 }: { value: number; className?: string; delay?: number }) {
  return <m.div className={cn("h-full rounded-full", className)} initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} transition={{ duration: 0.6, ease, delay }} />;
}

const STAGES = [
  { k: "pre", label: "Before the event", short: "Before" },
  { k: "live", label: "Quals in progress", short: "Quals" },
  { k: "quals", label: "Quals finished", short: "Ranked" },
  { k: "selected", label: "Alliances selected", short: "Alliances" },
] as const;

/** How sure an advancement forecast is (a stated rule, shown on the page). */
export function forecastTier(fc: ForecastView, team: number | null): { tier: ConfidenceTier; reason: string } {
  const base = forecastTierBase(fc, team);
  if (!fc.bonusModelled && fc.stage !== "selected" && base.tier === "confident") return { tier: "moderate", reason: `${base.reason} Bonus ranking points aren't modelled for this forecast.` };
  return base;
}

function forecastTierBase(fc: ForecastView, team: number | null): { tier: ConfidenceTier; reason: string } {
  const t = team ? fc.teams.find((x) => x.team === team) : null;
  const n = t?.strength.matches ?? Math.min(...fc.teams.map((x) => x.strength.matches));
  if (fc.stage === "selected") return { tier: "confident", reason: "Alliances are set; only the playoffs (and awards) are left to simulate." };
  if (fc.stage === "quals") return n >= 3 ? { tier: "confident", reason: "Quals are over: ranks are known, only alliance selection, playoffs and awards are simulated." } : { tier: "moderate", reason: "Quals are over, but this team has few matches on record." };
  if (n < 3) return { tier: "provisional", reason: `${team ? `Team ${team} has` : "Some teams have"} under 3 matches this season, so the forecast leans on last season.` };
  return { tier: fc.stage === "live" ? "moderate" : n >= 8 ? "moderate" : "provisional", reason: fc.stage === "live" ? "Quals are under way; most of the event is still simulated." : `Before the event, every match is simulated (${n} matches on record for the team).` };
}

/** The simulator's forecast with a stored projection's odds and ranks laid over it (awards and points stay the simulator's). */
export type Shown = ForecastView & { projection?: ProjectionRun; awardOdds?: Map<number, number>; ineligible?: Set<number> };

export function withProjection(fc: ForecastView, run: ProjectionRun): Shown {
  const by = new Map(run.teams.map((t) => [t.team, t]));
  const teams = fc.teams.map((t) => {
    const s = by.get(t.team);
    if (!s) return t;
    return {
      ...t, pAdvance: s.pAdvance ?? t.pAdvance, pCaptain: s.pCaptain, pPicked: s.pPicked, pWin: s.pWin, pFinalist: s.pFinalist,
      rank: s.rank ? { mean: s.rank.mean, p10: s.rank.p10, p90: s.rank.p90 } : t.rank,
    };
  }).sort((a, b) => b.pAdvance - a.pAdvance || a.rank.mean - b.rank.mean);
  // Not eligible to advance here is its own status: never "Qualified", never odds.
  const ineligible = new Set(run.teams.filter((t) => advanceStatus(t) === "ineligible").map((t) => t.team));
  return { ...fc, teams, runs: run.runs, projection: run, awardOdds: new Map(fc.teams.map((t) => [t.team, t.pAdvance])), ineligible };
}

/** One team's row of a forecast. */
export type ForecastTeam = ForecastView["teams"][number];

export function AdvancementView({ season, code, team, nameOf, onPickTeam }: { season: number; code: string; team: number | null; nameOf: (t: number) => string; onPickTeam?: (t: number) => void }) {
  const [mode, setMode] = useState<"current" | "pre-event">("current");
  const pathFor = (t: number | null) => `/api/predict/event${qs({ season, code, team: t, mode })}`;
  const path = pathFor(team);
  const state = useApi<ForecastView>(path);
  // The stored Monte Carlo projection (server/projections) is the advancement number wherever one exists;
  // this simulator's own odds stay the fallback, and its award-inclusive figure a second opinion.
  const proj = useApi<ProjectionsView>(projectionsPath(season, code));
  // Team names (the event's field) when the page doesn't pass them; the event page has this cached already.
  const detail = useApi<EventDetail>(`/api/events/${season}/${code}`);
  const field = useMemo(() => new Map((Array.isArray(detail.data?.field) ? detail.data!.field : []).map((f) => [f.team, f])), [detail.data]);
  const nameFor = useCallback((t: number) => nameOf(t) || field.get(t)?.name || "", [nameOf, field]);
  // Picking another team asks for a new forecast (its award points are worked out for it). Until it lands the
  // view keeps the one on screen, marked as updating, instead of dropping back to the loading animation.
  const key = `${season}|${code}|${mode}`;
  const last = useRef<{ key: string; data: ForecastView } | null>(null);
  if (state.data) last.current = { key, data: state.data };
  const data = state.data ?? (last.current?.key === key ? last.current.data : undefined);
  // The forecast on screen is another team's: still loading (updating), or its request failed (switchFailed:
  // the error and Try again show, and the old numbers stay dimmed so they never pass for this team's).
  const stale = !state.data && !!data;
  const updating = stale && !state.error;
  const switchFailed = stale && !!state.error;
  // Outlook first whenever there's a team (and again whenever the team changes); the field when there's none.
  const [tab, setTab] = useState(team ? "outlook" : "field");
  const [shownTeam, setShownTeam] = useState(team);
  if (shownTeam !== team) { setShownTeam(team); setTab(team ? "outlook" : "field"); }
  const [peek, setPeek] = useState<{ team: number; open: boolean } | null>(null);
  const [, startTransition] = useTransition();
  const pick = onPickTeam ? (t: number) => { setTab("outlook"); startTransition(() => onPickTeam(t)); } : undefined;
  // Pointing at (or focusing) "See N's outlook" starts that team's forecast a moment early. Only on that
  // intent, never for rows merely opened, and one at a time: each is a full simulation on the server.
  const prefetching = useRef<number | null>(null);
  const prefetch = (t: number) => {
    if (t === team || prefetching.current != null) return;
    prefetching.current = t;
    load(pathFor(t)).catch(() => {}).finally(() => { prefetching.current = null; });
  };
  if (state.error && !data) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!data) return <SimProgress runs={2000} />;
  const stored = mode === "pre-event" ? proj.data?.baseline : proj.data?.current;
  const fc: Shown = stored ? withProjection(data, stored) : data;
  const conf = forecastTier(fc, team);
  const statusOf = (t: number) => (fc.prequalified.includes(t) ? "qualified" as const : fc.ineligible?.has(t) ? "ineligible" as const : null);
  const peekRow = peek ? fc.teams.find((t) => t.team === peek.team) : undefined;
  return (
    <div>
      <StageStrip fc={fc} onRefresh={() => load(path, true).catch(() => {})} />
      <div className="mb-5 max-sm:mb-4 flex flex-wrap items-center gap-3">
        <ConfidenceBadge tier={conf.tier} reason={conf.reason} />
        {(fc.stage !== "pre" || mode === "pre-event") && (
          <ToggleGroup type="single" value={mode} onValueChange={(v) => { if (v) setMode(v as typeof mode); }} aria-label="Forecast as of">
            <ToggleGroupItem value="current">Now</ToggleGroupItem>
            <ToggleGroupItem value="pre-event"><History className="size-3.5" /> Before the event</ToggleGroupItem>
          </ToggleGroup>
        )}
        <span className="text-xs text-muted-foreground">
          {fc.projection
            ? <>Odds and ranks: {projectionHeadline(fc.projection)} · award odds and points: {data.runs.toLocaleString("en-US")} simulated events · engine v{fc.engineVersion}</>
            : <>{fc.runs.toLocaleString()} simulated events · engine v{fc.engineVersion}</>}
        </span>
      </div>
      {fc.hindsightNote && <p className="mb-4 flex gap-2 rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm"><Info className="mt-0.5 size-4 shrink-0 text-warning" />{fc.hindsightNote}</p>}
      {mode === "pre-event" && <p className="mb-4 flex gap-2 rounded-xl border border-info/30 bg-info/[0.06] px-4 py-3 text-sm"><History className="mt-0.5 size-4 shrink-0 text-info" />These are the odds as they stood the day before the event: ratings from earlier matches only, and none of this event's results.</p>}
      {fc.assumptions.length > 0 && (
        <ul className="mb-5 max-sm:mb-4 space-y-1 text-xs text-muted-foreground">{fc.assumptions.map((a) => <li key={a} className="flex gap-1.5"><Info className="mt-0.5 size-3 shrink-0" />{a}</li>)}</ul>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center gap-3">
          <TabsList>
            <TabsTrigger value="outlook">Outlook</TabsTrigger>
            <TabsTrigger value="alliance">Alliance</TabsTrigger>
            <TabsTrigger value="field">Field</TabsTrigger>
          </TabsList>
          {updating && (
            <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />Simulating for {team}…
            </span>
          )}
        </div>
        {switchFailed && (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">Couldn't simulate the event for {team ?? "this view"}: {state.error!.message} The numbers below are from before.</span>
            <Button variant="secondary" size="sm" onClick={state.reload}><RefreshCw /> Try again</Button>
          </div>
        )}
        <div aria-busy={updating || undefined} className={cn("transition-opacity duration-200", stale && "opacity-60")}>
          <TabsContent value="outlook" className="mt-5 max-sm:mt-4"><Outlook fc={fc} team={team} name={team ? nameFor(team) : ""} onPeek={(t) => setPeek({ team: t, open: true })} /></TabsContent>
          <TabsContent value="alliance" className="mt-5 max-sm:mt-4">
            <AlliancePanel season={season} code={code} fc={fc} team={team} mode={mode} nameOf={nameFor} onPeek={(t) => setPeek({ team: t, open: true })} />
          </TabsContent>
          <TabsContent value="field" className="mt-5 max-sm:mt-4">
            <Field fc={fc} team={team} nameOf={nameFor} field={field} onPick={pick} onPrefetch={pick ? prefetch : undefined} onPeek={(t) => setPeek({ team: t, open: true })} season={season} />
          </TabsContent>
        </div>
      </Tabs>
      {peek && (
        <TeamPeek team={peek.team} season={season} eventName={fc.eventName} row={peekRow} status={statusOf(peek.team)} settled={fc.stage === "selected"} over={playoffsDone(fc)}
          open={peek.open} onOpenChange={(o) => setPeek((p) => (p ? { ...p, open: o } : p))} onShowOutlook={peek.team !== team ? pick : undefined} />
      )}
    </div>
  );
}

function StageStrip({ fc, onRefresh }: { fc: ForecastView; onRefresh: () => void }) {
  const at = STAGES.findIndex((s) => s.k === fc.stage);
  return (
    <div className="mb-5 max-sm:mb-4 rounded-xl border border-border bg-card p-4">
      <ol className="grid grid-cols-4 gap-2" aria-label="Event stage">
        {STAGES.map((s, i) => {
          const done = i < at, now = i === at;
          return (
            <li key={s.k} aria-current={now ? "step" : undefined} className="min-w-0">
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <m.div className={cn("absolute inset-y-0 left-0 rounded-full", now ? "bg-accent" : "bg-accent/50")} initial={{ width: 0 }} animate={{ width: done || now ? "100%" : 0 }} transition={{ duration: 0.5, delay: i * 0.08 }} />
              </div>
              <p className={cn("mt-2 flex items-center gap-1 truncate text-xs", now ? "font-medium text-foreground" : "text-muted-foreground")}>
                {done && <Check className="size-3 shrink-0 text-accent" />}
                <span className="truncate max-lg:sr-only">{s.label}</span><span className="truncate lg:hidden" aria-hidden>{s.short}</span>
              </p>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <span><span className="font-medium text-foreground">{fc.slots}</span> advancement slot{fc.slots === 1 ? "" : "s"}{fc.slotsSource !== "official" ? " (estimated)" : " (official)"}</span>
        <span>Updated {ago(fc.generatedAt)}</span>
        <Button variant="ghost" size="sm" onClick={onRefresh} className="ml-auto max-sm:h-10"><RefreshCw /> Refresh</Button>
      </div>
    </div>
  );
}

function Outlook({ fc, team, name, onPeek }: { fc: Shown; team: number | null; name: string; onPeek: (t: number) => void }) {
  const me = team ? fc.teams.find((t) => t.team === team) : undefined;
  if (!me) return <EmptyState icon={Users} title={team ? `Team ${team} isn't at this event` : "Pick a team"} description="Choose a team above (or open one in the Field tab) to see its outlook." />;
  const pre = fc.prequalified.includes(me.team);
  const p = me.points;
  const parts = [
    { k: "Quals rank", v: p.quals, cls: "bg-accent" },
    { k: "Alliance selection", v: p.alliance, cls: "bg-amber-500" },
    { k: "Playoffs", v: p.playoffs, cls: "bg-sky-500" },
    { k: "Awards", v: p.awards ?? 0, cls: "bg-fuchsia-500" },
  ];
  const sum = parts.reduce((s, x) => s + x.v, 0) || 1;
  const n = fc.teams.length;
  // Playoffs are over once a played final exists and the event has finished.
  const set = fc.stage === "selected";
  const playoffsOver = playoffsDone(fc);
  return (
    <div className="space-y-6 max-sm:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-base font-semibold"><span className="tabular-nums">{me.team}</span> {name && <span className="font-normal text-muted-foreground">{name}</span>}</p>
        <Button variant="outline" size="sm" onClick={() => onPeek(me.team)}><PanelRight /> Team stats</Button>
      </div>
      <div className="grid gap-6 max-sm:gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 max-sm:p-4" aria-label="Chance to advance">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-accent/10 blur-3xl" />
          {pre ? (
            <><Badge variant="success">Already qualified</Badge><p className="mt-3 font-display text-2xl font-semibold">Team {me.team} has already qualified for the next level.</p></>
          ) : fc.ineligible?.has(me.team) ? (
            <><Badge variant="outline">Not eligible</Badge><p className="mt-3 font-display text-2xl font-semibold">Team {me.team} isn't eligible to advance from this event.</p></>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Team {me.team}'s chance to advance</p>
              <p className="mt-1 font-display text-6xl font-semibold tabular-nums tracking-tight sm:text-7xl">{pct(me.pAdvance)}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><GrowBar value={me.pAdvance} className="bg-accent" /></div>
              {fc.projection ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Live projection, {ADVANCE_LABEL}
                  {fc.awardOdds?.has(me.team) && <> · <span className="font-medium text-foreground">{pct(fc.awardOdds.get(me.team))}</span> with award history (simulator)</>}
                </p>
              ) : fc.matchesOnly && <p className="mt-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">{pct(fc.matchesOnly.pAdvance)}</span> from match results alone · <span className="font-medium text-foreground">{pct(me.pAdvance)}</span> with award history</p>}
            </>
          )}
        </section>
        <Stagger className="grid grid-cols-2 gap-x-6 gap-y-5 max-sm:gap-y-4 rounded-2xl border border-border p-6 max-sm:p-4">
          <StaggerItem><Stat icon={Crown} label="Captain" value={set ? yesNo(me.pCaptain) : pct(me.pCaptain)} hint={set ? "alliance selection is done" : "top seed picks"} /></StaggerItem>
          <StaggerItem><Stat icon={Users} label="Picked" value={set ? yesNo(me.pPicked) : pct(me.pPicked)} hint={set ? "alliance selection is done" : "chosen as partner"} /></StaggerItem>
          <StaggerItem><Stat icon={Trophy} label="Win event" value={pct(me.pWin, playoffsOver)} /></StaggerItem>
          <StaggerItem><Stat icon={Gauge} label="Finalist" value={pct(me.pFinalist, playoffsOver)} /></StaggerItem>
        </Stagger>
      </div>
      <section aria-labelledby="rank-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
          <h3 id="rank-h" className="text-base font-semibold">Likely quals rank</h3>
          <span className="text-sm tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{rankRange(me.rank.p10, me.rank.p90)}</span>{me.rank.p10 !== me.rank.p90 && ` · avg ${me.rank.mean.toFixed(1)}`} of {n}</span>
        </div>
        <div className="flex gap-[3px]" role="img" aria-label={`Likely rank ${rankRange(me.rank.p10, me.rank.p90)} of ${n}`}>
          {Array.from({ length: n }, (_, i) => {
            const seed = i + 1;
            const inRange = seed >= Math.round(me.rank.p10) && seed <= Math.round(me.rank.p90);
            const avg = seed === Math.round(me.rank.mean);
            return <m.span key={seed} initial={{ opacity: 0, scaleY: 0.4 }} animate={{ opacity: 1, scaleY: 1 }} transition={{ duration: 0.25, delay: Math.min(0.6, i * 0.012) }} className={cn("h-7 min-w-0 flex-1 rounded-[3px]", avg ? "bg-accent" : inRange ? "bg-accent/40" : "bg-muted")} />;
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-muted-foreground"><span>1st</span><span>{n}th</span></div>
      </section>
      {fc.season >= 2025 ? (
        <section aria-labelledby="pts-h">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
            <h3 id="pts-h" className="text-base font-semibold">Expected advancement points</h3>
            <span className="text-sm text-muted-foreground">Total <span className="font-medium tabular-nums text-foreground">{p.total != null ? p.total.toFixed(1) : "—"}</span></span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            {parts.map((x, i) => <m.div key={x.k} className={x.cls} title={`${x.k}: ${x.v.toFixed(1)}`} initial={{ width: 0 }} animate={{ width: `${(x.v / sum) * 100}%` }} transition={{ duration: 0.6, ease, delay: 0.1 + i * 0.08 }} />)}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {parts.map((x) => <div key={x.k} className="min-w-0"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("size-2 shrink-0 rounded-full", x.cls)} />{x.k}</dt><dd className="mt-0.5 font-display text-xl font-semibold tabular-nums">{x.v.toFixed(1)}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Average over all simulations. Award odds come from each team's award history and robot strength — judging can't be seen in match data. <Link to="/methodology#advancement" className="underline">How the simulator works</Link></p>
        </section>
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Advancement points started in 2025–26. Before that, teams advanced in award and ranking order, so this event has no points breakdown.</span>
        </p>
      )}
    </div>
  );
}

function AlliancePanel({ season, code, fc, team, mode, nameOf, onPeek }: { season: number; code: string; fc: ForecastView; team: number | null; mode: "current" | "pre-event"; nameOf: (t: number) => string; onPeek: (t: number) => void }) {
  // "Before the event": the same scenarios from the ratings and event as they stood the day before (no hindsight).
  const pre = mode === "pre-event";
  const state = useApi<Partners>(team ? `/api/predict/partners${qs({ season, code, team, mode: pre ? "pre-event" : null })}` : null);
  if (!team) return <EmptyState icon={Users} title="Pick a team" description="Alliance scenarios are worked out for one team." />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  const data = state.data;
  if (!data) return <SimProgress runs={null} label="Simulating the event" detail="Once per possible partner" />;
  if (data.role === "none") {
    const mine = fc.teams.find((t) => t.team === team);
    return <EmptyState icon={Users} title="Alliances are set" description={`Alliance selection has happened, so the partner is locked in. Chance to advance from here: ${pct(mine?.pAdvance)}.`} />;
  }
  const best = data.options[0]?.pAdvance ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{data.role === "captain" ? `Who should ${team} pick?` : `Best captains for ${team}`}</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{data.role === "captain" ? `${team} is likely a captain (${pct(data.baseline.pCaptain)}). Each option simulates the event with that partner on the alliance.` : `${team} is more likely to be picked than to captain. Each option simulates the event with that captain picking ${team}.`}{pre && " As it stood the day before the event: ratings from earlier matches only, none of this event's results."}</p>
        </div>
        <div className="text-right"><p className="text-xs text-muted-foreground">{pre ? "Before the event" : "Right now"}</p><p className="font-display text-2xl font-semibold tabular-nums">{pct(data.baseline.pAdvance)}</p></div>
      </div>
      <Stagger as="ol" className="grid gap-3 md:grid-cols-2">
        {data.options.map((o, i) => {
          const delta = o.pAdvance - data.baseline.pAdvance;
          return (
            <StaggerItem as="li" key={o.team} className={cn("rounded-xl border border-border bg-card p-4", i === 0 && "border-accent/50 ring-1 ring-accent/20")}>
              <div className="flex items-start gap-3">
                <span className="font-display text-2xl font-semibold tabular-nums text-muted-foreground/70">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium"><button type="button" onClick={() => onPeek(o.team)} className="max-w-full truncate rounded text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">{o.team} <span className="text-muted-foreground">{nameOf(o.team)}</span></button></p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {i === 0 && <Badge variant="soft">Best fit</Badge>}
                    <Badge variant={delta >= 0 ? "success" : "destructive"}>{delta >= 0 ? "+" : ""}{Math.round(delta * 100)} pts</Badge>
                    <span className="text-xs text-muted-foreground">win {pct(o.pWin)}</span>
                  </div>
                </div>
                <span className="font-display text-xl font-semibold tabular-nums">{pct(o.pAdvance)}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><GrowBar value={best ? o.pAdvance / best : 0} className="bg-accent" delay={i * 0.04} /></div>
            </StaggerItem>
          );
        })}
      </Stagger>
      <p className="text-xs text-muted-foreground">Odds include rank, alliance, playoff and award points. Scout and talk to teams too — the model can't see robot changes or how well two robots work together.</p>
    </div>
  );
}

function Field({ fc, team, nameOf, field, season, onPick, onPrefetch, onPeek }: {
  fc: Shown; team: number | null; nameOf: (t: number) => string; field: Map<number, FieldRow>; season: number;
  onPick?: (t: number) => void; onPrefetch?: (t: number) => void; onPeek: (t: number) => void;
}) {
  const [q, setQ] = useState("");
  // Rows open in place, like the event page's matches: one at a time, the chosen team's open first.
  const [open, setOpen] = useState<number | null>(null);
  const pre = new Set(fc.prequalified);
  const rows = useMemo(() => { const s = q.trim().toLowerCase(); return s ? fc.teams.filter((t) => String(t.team).includes(s) || nameOf(t.team).toLowerCase().includes(s)) : fc.teams; }, [fc.teams, q, nameOf]);
  const toggle = (t: number) => setOpen((o) => (o === t ? null : t));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a team" aria-label="Find a team" className="pl-9 max-sm:h-10" />
        </div>
        <p className="text-xs text-muted-foreground">Tap a team for its odds and numbers.</p>
      </div>
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((t) => {
          const isOpen = open === t.team;
          const status = pre.has(t.team) ? "qualified" : fc.ineligible?.has(t.team) ? "ineligible" : null;
          const name = nameOf(t.team);
          const id = `field-${t.team}`;
          return (
            <li key={t.team} className={cn("border-b border-border last:border-b-0", t.team === team && "relative before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent")}>
              <button type="button" aria-expanded={isOpen} aria-controls={id} onClick={() => toggle(t.team)}
                className={cn("group/f flex w-full items-center gap-3 px-4 py-3 text-left transition-colors max-sm:px-3 hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                  isOpen && "bg-accent/[0.05]")}>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{t.team}</span>
                    <span className="min-w-0 truncate text-sm text-muted-foreground">{name}</span>
                    {t.team === team && <Badge variant="soft" className="shrink-0">Selected</Badge>}
                  </span>
                  {status ? null : <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted"><GrowBar value={t.pAdvance} className="bg-accent" /></span>}
                </span>
                {status === "qualified" ? <Badge variant="success">Qualified</Badge>
                  : status === "ineligible" ? <Badge variant="outline">Not eligible</Badge>
                  : <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">{pct(t.pAdvance)}</span>}
                <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform group-hover/f:text-accent-text", isOpen && "rotate-180 text-accent-text")} />
              </button>
              {isOpen && <FieldDetails id={id} t={t} row={field.get(t.team)} fc={fc} season={season} isTeam={t.team === team} onPick={onPick} onPrefetch={onPrefetch} onPeek={onPeek} />}
            </li>
          );
        })}
      </ul>
      {!rows.length && <p className="py-6 max-sm:py-4 text-center text-sm text-muted-foreground">No team matches “{q}”.</p>}
    </div>
  );
}

/** A Field row opened: the team's odds at this event, its numbers so far, and the ways on. */
function FieldDetails({ id, t, row, fc, season, isTeam, onPick, onPrefetch, onPeek }: { id: string; t: ForecastTeam; row?: FieldRow; fc: Shown; season: number; isTeam: boolean; onPick?: (t: number) => void; onPrefetch?: (t: number) => void; onPeek: (t: number) => void }) {
  const set = fc.stage === "selected", over = playoffsDone(fc);
  const facts: [string, string][] = [
    ["Likely rank", `${rankRange(t.rank.p10, t.rank.p90)} of ${fc.teams.length}`],
    ["Captain", set ? yesNo(t.pCaptain) : pct(t.pCaptain)],
    ["Picked", set ? yesNo(t.pPicked) : pct(t.pPicked)],
    ["Finalist", pct(t.pFinalist, over)],
    ["Win event", pct(t.pWin, over)],
    ["Rating", `${t.strength.np.toFixed(0)} ± ${t.strength.sd.toFixed(0)}`],
  ];
  if (row?.rank != null) facts.push(["Rank now", `#${row.rank}${row.wins != null ? ` · ${row.wins}-${row.losses ?? 0}-${row.ties ?? 0}` : ""}`]);
  if (row?.opr.np != null) facts.push(["OPR here", row.opr.np.toFixed(1)]);
  else if (row?.seasonOpr != null) facts.push(["Season OPR", row.seasonOpr.toFixed(1)]);
  return (
    <m.div id={id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.2, ease }} className="overflow-hidden bg-accent/[0.03]">
      <div className="space-y-3 border-t border-border/60 px-4 pb-4 pt-3 max-sm:px-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="truncate text-sm font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">Rating: points this team adds to an alliance per match, ± its uncertainty ({t.strength.matches} matches on record).</p>
        <div className="flex flex-wrap gap-2">
          {onPick && !isTeam && <Button size="sm" onClick={() => onPick(t.team)} onPointerEnter={() => onPrefetch?.(t.team)} onFocus={() => onPrefetch?.(t.team)} onPointerDown={() => onPrefetch?.(t.team)}>See {t.team}'s outlook</Button>}
          <Button variant="outline" size="sm" onClick={() => onPeek(t.team)}><PanelRight /> Team stats</Button>
          <Button asChild variant="ghost" size="sm"><Link to={`/teams/${t.team}${qs({ season })}`}>Team page <ArrowUpRight /></Link></Button>
        </div>
      </div>
    </m.div>
  );
}
