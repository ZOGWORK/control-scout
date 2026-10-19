// Advancement simulator view — Control Point's Predict page (stage strip,
// Outlook, Alliance, Field), generalised to ANY team at ANY event.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { m } from "motion/react";
import { Check, Crown, Gauge, History, Info, RefreshCw, Search, Trophy, Users } from "lucide-react";
import { useApi, qs, load } from "../lib/api";
import type { ConfidenceTier, ForecastView, Partners } from "../shared/api";
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

const ease = [0.2, 0.8, 0.2, 1] as const;
const pct = (p: number | null | undefined, decided = false) => oddsPct(p, decided);
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
  if (!fc.bonusModelled && fc.stage !== "selected" && base.tier === "confident") return { tier: "moderate", reason: `${base.reason} Bonus ranking points aren't modelled for this season yet.` };
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

export function AdvancementView({ season, code, team, nameOf, onPickTeam }: { season: number; code: string; team: number | null; nameOf: (t: number) => string; onPickTeam?: (t: number) => void }) {
  const [mode, setMode] = useState<"current" | "pre-event">("current");
  const path = `/api/predict/event${qs({ season, code, team, mode })}`;
  const state = useApi<ForecastView>(path);
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!state.data) return <div className="space-y-3" aria-busy="true"><p className="text-sm text-muted-foreground">Simulating the event 2,000 times…</p><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-56 rounded-xl" /></div>;
  const fc = state.data;
  const conf = forecastTier(fc, team);
  return (
    <div>
      <StageStrip fc={fc} onRefresh={() => load(path, true).catch(() => {})} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <ConfidenceBadge tier={conf.tier} reason={conf.reason} />
        {(fc.stage !== "pre" || mode === "pre-event") && (
          <ToggleGroup type="single" value={mode} onValueChange={(v) => { if (v) setMode(v as typeof mode); }} aria-label="Forecast as of">
            <ToggleGroupItem value="current">Now</ToggleGroupItem>
            <ToggleGroupItem value="pre-event"><History className="size-3.5" /> Before the event</ToggleGroupItem>
          </ToggleGroup>
        )}
        <span className="text-xs text-muted-foreground">{fc.runs.toLocaleString()} simulated events · engine v{fc.engineVersion}</span>
      </div>
      {fc.hindsightNote && <p className="mb-4 flex gap-2 rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm"><Info className="mt-0.5 size-4 shrink-0 text-warning" />{fc.hindsightNote}</p>}
      {mode === "pre-event" && <p className="mb-4 flex gap-2 rounded-xl border border-info/30 bg-info/[0.06] px-4 py-3 text-sm"><History className="mt-0.5 size-4 shrink-0 text-info" />These are the odds as they stood the day before the event: ratings from earlier matches only, and none of this event's results.</p>}
      {fc.assumptions.length > 0 && (
        <ul className="mb-5 space-y-1 text-xs text-muted-foreground">{fc.assumptions.map((a) => <li key={a} className="flex gap-1.5"><Info className="mt-0.5 size-3 shrink-0" />{a}</li>)}</ul>
      )}
      <Tabs defaultValue={team ? "outlook" : "field"}>
        <TabsList>
          <TabsTrigger value="outlook">Outlook</TabsTrigger>
          <TabsTrigger value="alliance">Alliance</TabsTrigger>
          <TabsTrigger value="field">Field</TabsTrigger>
        </TabsList>
        <TabsContent value="outlook" className="mt-5"><Outlook fc={fc} team={team} /></TabsContent>
        <TabsContent value="alliance" className="mt-5">
          {mode === "pre-event"
            ? <EmptyState icon={Users} title="Partner scenarios use the current forecast" description="Switch to “Now” to compare partners — there's no hindsight-free version of this yet, so it isn't shown next to the pre-event odds." />
            : <AlliancePanel season={season} code={code} fc={fc} team={team} nameOf={nameOf} />}
        </TabsContent>
        <TabsContent value="field" className="mt-5"><Field fc={fc} team={team} nameOf={nameOf} onPick={onPickTeam} /></TabsContent>
      </Tabs>
    </div>
  );
}

function StageStrip({ fc, onRefresh }: { fc: ForecastView; onRefresh: () => void }) {
  const at = STAGES.findIndex((s) => s.k === fc.stage);
  return (
    <div className="mb-5 rounded-xl border border-border bg-card p-4">
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
        <Button variant="ghost" size="sm" onClick={onRefresh} className="ml-auto max-sm:h-11"><RefreshCw /> Refresh</Button>
      </div>
    </div>
  );
}

function Outlook({ fc, team }: { fc: ForecastView; team: number | null }) {
  const me = team ? fc.teams.find((t) => t.team === team) : undefined;
  if (!me) return <EmptyState icon={Users} title={team ? `Team ${team} isn't at this event` : "Pick a team"} description="Choose a team above (or click one in the Field tab) to see its outlook." />;
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
  const playoffsOver = fc.stage === "selected" && fc.matches.some((m) => m.level === "playoff" && m.played) && !fc.matches.some((m) => m.level === "playoff" && !m.played);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6" aria-label="Chance to advance">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-accent/10 blur-3xl" />
          {pre ? (
            <><Badge variant="success">Already qualified</Badge><p className="mt-3 font-display text-2xl font-semibold">Team {me.team} has already qualified for the next level.</p></>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Team {me.team}'s chance to advance</p>
              <p className="mt-1 font-display text-6xl font-semibold tabular-nums tracking-tight sm:text-7xl">{pct(me.pAdvance)}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><GrowBar value={me.pAdvance} className="bg-accent" /></div>
              {fc.matchesOnly && <p className="mt-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">{pct(fc.matchesOnly.pAdvance)}</span> from match results alone · <span className="font-medium text-foreground">{pct(me.pAdvance)}</span> with award history</p>}
            </>
          )}
        </section>
        <Stagger className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-2xl border border-border p-6">
          <StaggerItem><Stat icon={Crown} label="Captain" value={pct(me.pCaptain, fc.stage === "selected")} hint={fc.stage === "selected" ? "alliances are set" : "top seed picks"} /></StaggerItem>
          <StaggerItem><Stat icon={Users} label="Picked" value={pct(me.pPicked, fc.stage === "selected")} hint={fc.stage === "selected" ? "alliances are set" : "chosen as partner"} /></StaggerItem>
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
      <section aria-labelledby="pts-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
          <h3 id="pts-h" className="text-base font-semibold">Where the expected advancement points come from{fc.season >= 2025 ? "" : " (2025+ points system)"}</h3>
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
    </div>
  );
}

function AlliancePanel({ season, code, fc, team, nameOf }: { season: number; code: string; fc: ForecastView; team: number | null; nameOf: (t: number) => string }) {
  const state = useApi<Partners>(team ? `/api/predict/partners${qs({ season, code, team })}` : null);
  if (!team) return <EmptyState icon={Users} title="Pick a team" description="Alliance scenarios are worked out for one team." />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  const data = state.data;
  if (!data) return <div className="space-y-2" aria-busy="true"><p className="text-sm text-muted-foreground">Simulating the event once per possible partner…</p>{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>;
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
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{data.role === "captain" ? `${team} is likely a captain (${pct(data.baseline.pCaptain)}). Each option simulates the event with that partner on the alliance.` : `${team} is more likely to be picked than to captain. Each option simulates the event with that captain picking ${team}.`}</p>
        </div>
        <div className="text-right"><p className="text-xs text-muted-foreground">Right now</p><p className="font-display text-2xl font-semibold tabular-nums">{pct(data.baseline.pAdvance)}</p></div>
      </div>
      <Stagger as="ol" className="grid gap-3 md:grid-cols-2">
        {data.options.map((o, i) => {
          const delta = o.pAdvance - data.baseline.pAdvance;
          return (
            <StaggerItem as="li" key={o.team} className={cn("rounded-xl border border-border bg-card p-4", i === 0 && "border-accent/50 ring-1 ring-accent/20")}>
              <div className="flex items-start gap-3">
                <span className="font-display text-2xl font-semibold tabular-nums text-muted-foreground/70">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium"><Link to={`/teams/${o.team}?season=${season}`} className="hover:underline">{o.team}</Link> <span className="text-muted-foreground">{nameOf(o.team)}</span></p>
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

function Field({ fc, team, nameOf, onPick }: { fc: ForecastView; team: number | null; nameOf: (t: number) => string; onPick?: (t: number) => void }) {
  const [q, setQ] = useState("");
  const pre = new Set(fc.prequalified);
  const rows = useMemo(() => { const s = q.trim().toLowerCase(); return s ? fc.teams.filter((t) => String(t.team).includes(s) || nameOf(t.team).toLowerCase().includes(s)) : fc.teams; }, [fc.teams, q, nameOf]);
  return (
    <div>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a team" aria-label="Find a team" className="pl-9 max-sm:h-11" />
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((t) => (
          <li key={t.team} className={cn("px-4 py-3", t.team === team && "bg-accent/[0.07]")}>
            <div className="flex items-center gap-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => onPick?.(t.team)} disabled={!onPick}>
                <p className="truncate text-sm font-medium">{t.team} <span className="text-muted-foreground">{nameOf(t.team)}</span>{t.team === team && <Badge variant="soft" className="ml-1.5">Selected</Badge>}</p>
                <p className="text-xs text-muted-foreground">Rank {rankRange(t.rank.p10, t.rank.p90)} · captain {pct(t.pCaptain)} · picked {pct(t.pPicked)} · win {pct(t.pWin)} · rating {t.strength.np.toFixed(0)} ± {t.strength.sd.toFixed(0)}</p>
              </button>
              {pre.has(t.team) ? <Badge variant="success">Qualified</Badge> : <span className="w-14 text-right font-medium tabular-nums">{pct(t.pAdvance)}</span>}
            </div>
            {!pre.has(t.team) && <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted"><GrowBar value={t.pAdvance} className="bg-accent" /></div>}
          </li>
        ))}
      </ul>
      {!rows.length && <p className="py-6 text-center text-sm text-muted-foreground">No team matches “{q}”.</p>}
    </div>
  );
}
