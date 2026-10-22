// The event page's Projections: the stored Monte Carlo runs of the rest of the event (server/projections),
// updated live as results land. While the event runs: projected rank (median + P10–P90 whisker), playoff
// and advancement odds per team, movement since the pre-event projection, tracked teams pinned. Once it's
// over: "Final results vs projections", each actual seed against the band it was last projected in.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChartNoAxesGantt, HardDrive, Info, Pin, Radio, Target } from "lucide-react";
import { cn } from "./cn";
import { Badge } from "./ui/basic";
import { EmptyState } from "./page";
import { ConfidenceBadge } from "./predict";
import { ErrorState } from "./states";
import { oddsPct } from "../lib/format";
import { bandHits, canRunLocal, localLabel, localTier, projectionSource, projectionTier, rankMovement, useLocalProjection, useProjections, type LocalProjection } from "../lib/projections";
import { offlineSource } from "../lib/offline/saved";
import { usePersonal } from "../lib/personal";
import { ADVANCE_LABEL, LOCAL_STOP_MS, PROJECTION_RUNS, advanceStatus, throughText, type ProjectionRun, type ProjectionTeam } from "../shared/projections";
import type { EventDetail } from "../shared/api";

type SortKey = "team" | "now" | "proj" | "playoff" | "advance";

const runsText = (n: number) => `${n.toLocaleString("en-US")} simulations`;

/** "10,000 simulations • updated after Match 24" (or before the first match). */
export function projectionHeadline(run: ProjectionRun): string {
  const through = throughText(run.through);
  return `${runsText(run.runs)} • ${through ? `updated after ${through}` : "before the first match"}`;
}

/** "Local estimate · 1,500 simulations on this device • after Match 24": never mistakable for the server's run. */
export function localHeadline(run: ProjectionRun): string {
  const through = throughText(run.through);
  return `${localLabel(run.runs)} • ${through ? `after ${through}` : "before the first match"}`;
}

const shortDate = (iso: string) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

/** Why the page shows a local estimate, what it's made from, and that the server's run replaces it. */
function LocalNote({ value, why }: { value: LocalProjection; why: string }) {
  const asOf = shortDate(value.ratingsAsOf);
  return (
    <div className="relative flex gap-2.5 border-b border-border bg-info/[0.06] px-4 py-3 text-sm sm:px-5">
      <HardDrive className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <p className="text-muted-foreground">
        The server's {PROJECTION_RUNS.toLocaleString("en-US")}-simulation projection {why}, so this one was simulated on this device from your offline pack{asOf ? ` (ratings as of ${asOf})` : ""}.
        {value.stopped && <> It stopped after {LOCAL_STOP_MS / 1000} seconds to save battery: <span className="font-medium text-foreground">{value.run.runs.toLocaleString("en-US")} of {value.run.target.toLocaleString("en-US")}</span> simulations ran.</>}
        {" "}Fewer simulations means rougher ranges; the server's projection takes over as soon as it can be read.
      </p>
    </div>
  );
}

/** While the device simulates: progress, never a frozen page (the work runs in a Web Worker). */
function LocalProgress({ done, target }: { done: number; target: number }) {
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  return (
    <section aria-labelledby="proj-h" aria-busy="true" className="relative overflow-hidden rounded-2xl border border-info/40 bg-card p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-24 size-64 rounded-full bg-info/10 blur-3xl" />
      <h2 id="proj-h" className="relative flex flex-wrap items-center gap-2 font-display text-lg font-semibold"><ChartNoAxesGantt className="size-5 text-accent-text" /> Projections<Badge variant="info" className="font-sans"><HardDrive aria-hidden /> Local estimate</Badge></h2>
      <p className="relative mt-1 text-sm text-muted-foreground" aria-live="polite">
        {target ? `Simulating the rest of the event on this device: ${done.toLocaleString("en-US")} of ${target.toLocaleString("en-US")}` : "Getting a local estimate ready from your offline pack"}
      </p>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Local simulations done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-info transition-[width] duration-150" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
    </section>
  );
}

export function Projections({ d, team }: { d: EventDetail; team: number | null }) {
  const e = d.event;
  const finished = e.status === "finished";
  const state = useProjections(e.season, e.code, { live: !finished, refreshKey: d.live?.checkedAt ?? `${e.matchesPlayed}` });
  const { state: personal } = usePersonal();
  const pinned = useMemo(() => new Set([...(personal.myTeam != null ? [personal.myTeam] : []), ...personal.tracked.teams, ...(team ? [team] : [])]), [personal.myTeam, personal.tracked.teams, team]);
  const names = useMemo(() => new Map(d.field.map((f) => [f.team, f.name ?? ""])), [d.field]);
  const rankNow = useMemo(() => new Map(d.field.filter((f) => f.rank != null).map((f) => [f.team, f.rank!])), [d.field]);
  const hasSchedule = d.matches.some((m) => m.level === "qual");
  // The server's stored run whenever there is one; a local estimate only when there's none to be had.
  const source = projectionSource({ finished, hasCurrent: !!state.data?.current, loaded: !!state.data, failed: !!state.error, hasSchedule, canRunLocal: canRunLocal(e.season) });
  const local = useLocalProjection(d, source === "local");

  if (source === "local" && (local.status === "running" || local.status === "idle")) return <LocalProgress done={local.status === "running" ? local.done : 0} target={local.status === "running" ? local.target : 0} />;
  if (source === "local" && local.status === "done") {
    const why = state.error ? "can't be reached right now" : offlineSource(state.data) ? "isn't in your saved season" : "hasn't been made yet";
    return <LiveView run={local.value.run} baseline={null} rankNow={rankNow} names={names} pinned={pinned} local={{ value: local.value, why }} />;
  }
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!state.data) return <div className="skeleton h-64 rounded-2xl" aria-busy="true" />;
  const v = state.data;
  if (finished) {
    const judged = v.lastOpen ?? v.baseline;
    // Events that finished before projections existed have none: nothing to compare, nothing shown.
    if (!judged) return null;
    return <FinalView run={judged} baseline={v.baseline} isLastOpen={!!v.lastOpen} actual={rankNow} names={names} pinned={pinned} />;
  }
  if (!v.current) {
    return (
      <EmptyState icon={ChartNoAxesGantt} title={hasSchedule ? "The first projection is on its way" : "No qualification schedule yet"}
        description={hasSchedule ? "The event is simulated 10,000 times in the background; the projection shows here within a minute or two." : "Projections start once the qualification schedule is published: every remaining match is simulated from current ratings."} />
    );
  }
  return <LiveView run={v.current} baseline={v.baseline} rankNow={rankNow} names={names} pinned={pinned} />;
}

// ---------------------------------------------------------------------------
// While the event runs
// ---------------------------------------------------------------------------

function LiveView({ run, baseline, rankNow, names, pinned, local }: { run: ProjectionRun; baseline: ProjectionRun | null; rankNow: Map<number, number>; names: Map<number, string>; pinned: Set<number>; local?: { value: LocalProjection; why: string } }) {
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "proj", asc: true });
  const conf = local ? localTier(local.value) : projectionTier(run);
  const n = Math.max(run.teams.length, ...run.teams.map((t) => t.rank?.p90 ?? 0));
  const before = useMemo(() => new Map((baseline?.teams ?? []).map((t) => [t.team, t])), [baseline]);
  const showMove = !!baseline && baseline.computedAt !== run.computedAt && run.played > 0;
  const decidedPlayoffs = run.stage === "selected";
  const value = (t: ProjectionTeam): number | null => {
    switch (sort.key) {
      case "team": return t.team;
      case "now": return rankNow.get(t.team) ?? null;
      case "proj": return t.rank ? t.rank.p50 + t.rank.mean / 1000 : null;
      case "playoff": return t.pPlayoff;
      case "advance": return t.pAdvance;
    }
  };
  const rows = useMemo(() => {
    const m = sort.asc ? 1 : -1;
    const sorted = [...run.teams].sort((a, b) => {
      const x = value(a), y = value(b);
      if (x == null && y == null) return a.team - b.team;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * m || a.team - b.team;
    });
    return [...sorted.filter((t) => pinned.has(t.team)), ...sorted.filter((t) => !pinned.has(t.team))];
  }, [run.teams, sort, pinned, rankNow]);
  const click = (key: SortKey) => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === "team" || key === "now" || key === "proj" }));
  const slotsNote = run.slots ? `${run.slots} advancement slot${run.slots === 1 ? "" : "s"}${run.slotsSource === "official" ? " (official)" : " (estimated)"}` : null;

  return (
    <section aria-labelledby="proj-h" className={cn("relative overflow-hidden rounded-2xl border bg-card", local ? "border-info/40" : "border-border")} data-local-estimate={local ? "" : undefined}>
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-24 size-64 rounded-full bg-info/10 blur-3xl" />
      <div aria-hidden className={cn("pointer-events-none absolute -right-16 -top-20 size-56 rounded-full blur-3xl", local ? "bg-warning/10" : "bg-accent/10")} />
      <header className="relative flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
        <div className="min-w-0">
          <h2 id="proj-h" className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold"><ChartNoAxesGantt className="size-5 text-accent-text" /> Projections{local && <Badge variant="info" className="font-sans"><HardDrive aria-hidden /> Local estimate</Badge>}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" aria-live="polite">
            {local
              ? <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><HardDrive className="size-3.5 text-info" aria-hidden />{localHeadline(run)}</span>
              : <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><Radio className="size-3.5 text-success" aria-hidden />{projectionHeadline(run)}</span>}
            {!local && run.runs < run.target && <span className="text-xs">(of {run.target.toLocaleString("en-US")}: this event is big, so it's simulated fewer times to stay quick)</span>}
          </p>
        </div>
        <ConfidenceBadge tier={conf.tier} reason={conf.reason} />
      </header>
      {local && <LocalNote value={local.value} why={local.why} />}
      <div className="relative custom-scrollbar overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Projected final quals rank (median and 10th–90th percentile range), playoff odds and advancement odds for each team</caption>
          <thead>
            <tr className="border-b border-border">
              <Th label="Team" k="team" sort={sort} onSort={click} />
              <Th label="Now" k="now" sort={sort} onSort={click} right className="max-sm:hidden" title="Current official rank" />
              <Th label="Projected rank" k="proj" sort={sort} onSort={click} className="w-full min-w-40 max-sm:min-w-24" title="Median final quals rank, with the range it lands in 80% of simulations (10th–90th percentile)" />
              <Th label="Playoffs" k="playoff" sort={sort} onSort={click} right title="Chance to play in the playoffs: captain or picked" />
              <Th label="Advance" k="advance" sort={sort} onSort={click} right title={`Chance to advance: ${ADVANCE_LABEL}`} />
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const pin = pinned.has(t.team);
              const lastPin = pin && !pinned.has(rows[i + 1]?.team ?? -1);
              const move = showMove ? rankMovement(t, before.get(t.team)) : null;
              return (
                <tr key={t.team} className={cn("border-b border-border last:border-b-0 hover:bg-text-base/[0.03]", pin && "bg-accent/[0.07]", lastPin && "border-b-2 border-b-accent/40")}>
                  <td className="density-row whitespace-nowrap px-3 py-2 max-sm:px-2">
                    <span className={cn("flex items-center gap-1.5", pin && "border-l-2 border-accent -ml-3 pl-2.5")}>
                      {pin && <Pin className="size-3 shrink-0 text-accent-text" aria-label="Pinned: your team or a tracked team" />}
                      <Link to={`/teams/${t.team}`} className="font-medium tabular-nums hover:underline">{t.team}</Link>
                      <span className="max-w-36 truncate text-xs text-muted-foreground max-sm:hidden">{names.get(t.team)}</span>
                    </span>
                  </td>
                  <td className="density-row px-3 py-2 text-right tabular-nums text-muted-foreground max-sm:hidden">{rankNow.get(t.team) ?? "—"}</td>
                  <td className="density-row px-3 py-2 max-sm:px-2">
                    <div className="flex items-center gap-2.5 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
                      <RankText t={t} move={move} />
                      <Whisker t={t} n={n} now={rankNow.get(t.team) ?? null} ghost={showMove ? before.get(t.team)?.rank?.p50 ?? null : null} />
                    </div>
                  </td>
                  <td className="density-row px-3 py-2 text-right max-sm:px-2"><Odds p={t.pPlayoff} decided={decidedPlayoffs} tone="bg-info" /></td>
                  <td className="density-row px-3 py-2 text-right max-sm:px-2"><AdvanceCell t={t} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className="relative space-y-1.5 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <p className="flex gap-1.5"><Info className="mt-0.5 size-3 shrink-0" /><span><span className="font-medium text-foreground">Advance</span>: {ADVANCE_LABEL}.{slotsNote ? ` ${slotsNote}.` : ""} <span className="font-medium text-foreground">Playoffs</span>: captain or picked; picks follow the fitted pick model (seed and rating).</span></p>
        {local && <p className="flex gap-1.5"><HardDrive className="mt-0.5 size-3 shrink-0" /><span>{localLabel(run.runs)}: same engine and method as the server, kept on this device only and never mixed with the server's projections.</span></p>}
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-5 rounded-full bg-accent/35" /> 80% range</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-accent" /> median</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-foreground" /> rank now</span>
          {showMove && <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full border-2 border-muted-foreground/60" /> before the event</span>}
          <Link to="/methodology#projections" className="underline">How projections work</Link>
        </p>
      </footer>
    </section>
  );
}

function Th({ label, k, sort, onSort, right, className, title }: { label: string; k: SortKey; sort: { key: SortKey; asc: boolean }; onSort: (k: SortKey) => void; right?: boolean; className?: string; title?: string }) {
  const on = sort.key === k;
  return (
    <th scope="col" aria-sort={on ? (sort.asc ? "ascending" : "descending") : "none"} className={cn("h-10 whitespace-nowrap px-3 text-[10px] font-bold uppercase tracking-wider text-text-muted max-sm:px-2", right ? "text-right" : "text-left", className)}>
      <button onClick={() => onSort(k)} title={title} className={cn("inline-flex items-center gap-1 rounded hover:text-text-base", right && "flex-row-reverse")}>
        {label}{on && (sort.asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
}

function RankText({ t, move }: { t: ProjectionTeam; move: number | null }) {
  if (!t.rank) return <span className="w-16 shrink-0 text-muted-foreground">—</span>;
  const { p10, p50, p90 } = t.rank;
  return (
    <span className="w-24 shrink-0 leading-tight max-sm:w-auto">
      <span className="font-display text-base font-semibold tabular-nums">#{p50}</span>
      {move != null && move !== 0 && (
        <span className={cn("ml-1 inline-flex items-center text-[11px] font-medium tabular-nums", move > 0 ? "text-success" : "text-destructive")} title={`${move > 0 ? "Up" : "Down"} ${Math.abs(move)} since the pre-event projection`}>
          {move > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}{Math.abs(move)}
          <span className="sr-only">{move > 0 ? " places up" : " places down"} since the pre-event projection</span>
        </span>
      )}
      <span className="block text-[11px] tabular-nums text-muted-foreground max-sm:ml-1.5 max-sm:inline">{p10 === p90 ? "settled" : `#${p10}–${p90}`}</span>
    </span>
  );
}

/** The rank line 1…n (best on the left): the P10–P90 band, the median, today's rank and the pre-event median. */
function Whisker({ t, n, now, ghost, actual }: { t: ProjectionTeam; n: number; now: number | null; ghost: number | null; actual?: { rank: number; inside: boolean } }) {
  if (!t.rank) return <span className="h-4 flex-1" />;
  const x = (r: number) => (n <= 1 ? 50 : ((r - 1) / (n - 1)) * 100);
  const { p10, p50, p90 } = t.rank;
  const label = `Projected rank ${p50} of ${n}, 80% range ${p10} to ${p90}${now != null ? `, now ${now}` : ""}${actual ? `, finished ${actual.rank} (${actual.inside ? "inside" : "outside"} the range)` : ""}`;
  return (
    <span className="relative block h-5 min-w-20 flex-1 max-sm:flex-none" role="img" aria-label={label}>
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <span className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-accent/35" style={{ left: `${x(p10)}%`, width: `max(0.5rem, ${x(p90) - x(p10)}%)` }} />
      {ghost != null && ghost !== p50 && <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground/60 bg-card" style={{ left: `${x(ghost)}%` }} />}
      <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-card" style={{ left: `${x(p50)}%` }} />
      {now != null && !actual && <span className="absolute top-0 h-5 w-0.5 -translate-x-1/2 rounded bg-foreground/80" style={{ left: `${x(now)}%` }} />}
      {actual && <span className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 ring-2 ring-card", actual.inside ? "bg-success" : "bg-warning")} style={{ left: `${x(actual.rank)}%` }} />}
    </span>
  );
}

/** Advance column: odds, "Qualified" only for a team that already qualified, a neutral "Not eligible" otherwise. */
export function AdvanceCell({ t }: { t: ProjectionTeam }) {
  const s = advanceStatus(t);
  if (s === "odds" && t.pAdvance != null) return <Odds p={t.pAdvance} tone="bg-success" />;
  if (s === "qualified") return <Badge variant="success" title="Already qualified at an earlier event">Qualified</Badge>;
  if (s === "ineligible") return <Badge variant="outline" title="FIRST lists this team as not eligible to advance from this event">Not eligible</Badge>;
  return <span className="text-muted-foreground" title="No advancement odds for this team">—</span>;
}

function Odds({ p, decided, tone }: { p: number; decided?: boolean; tone: string }) {
  return (
    <span className="inline-flex min-w-14 flex-col items-end gap-1">
      <span className="font-medium tabular-nums">{oddsPct(p, decided)}</span>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-muted" aria-hidden><span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.max(0, Math.min(1, p)) * 100}%` }} /></span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// After the event
// ---------------------------------------------------------------------------

function FinalView({ run, baseline, isLastOpen, actual, names, pinned }: { run: ProjectionRun; baseline: ProjectionRun | null; isLastOpen: boolean; actual: Map<number, number>; names: Map<number, string>; pinned: Set<number> }) {
  const hits = bandHits(run, actual);
  const pre = isLastOpen ? bandHits(baseline, actual) : null;
  const before = new Map((baseline?.teams ?? []).map((t) => [t.team, t]));
  const n = Math.max(run.teams.length, ...actual.values());
  const rows = [...run.teams].sort((a, b) => (actual.get(a.team) ?? 1e9) - (actual.get(b.team) ?? 1e9) || a.team - b.team);
  if (!hits.total) return null;
  const when = isLastOpen ? (throughText(run.through) ? `after ${throughText(run.through)}` : "before the first match") : "before the event";
  return (
    <section aria-labelledby="proj-h" className="relative overflow-hidden rounded-2xl border border-border bg-card">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-success/10 blur-3xl" />
      <header className="relative border-b border-border p-4 sm:p-5">
        <h2 id="proj-h" className="flex items-center gap-2 font-display text-lg font-semibold"><Target className="size-5 text-success" /> Final results vs projections</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each team's final seed against the range it was projected in {when} ({runsText(run.runs)}).</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Score label={`inside their projected range ${when}`} inside={hits.inside} total={hits.total} tone="text-success" />
          {pre && pre.total > 0 && <Score label="inside their pre-event range" inside={pre.inside} total={pre.total} tone="text-info" />}
        </div>
      </header>
      <div className="relative custom-scrollbar overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Final quals seed of each team against its projected range</caption>
          <thead>
            <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wider text-text-muted">
              <th scope="col" className="h-10 px-3 text-left">Team</th>
              <th scope="col" className="h-10 px-3 text-right">Seed</th>
              <th scope="col" className="h-10 w-full min-w-40 px-3 max-sm:min-w-24 text-left">Projected range</th>
              <th scope="col" className="h-10 px-3 text-right max-sm:hidden">Pre-event</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const a = actual.get(t.team);
              const inside = a != null && !!t.rank && a >= t.rank.p10 && a <= t.rank.p90;
              return (
                <tr key={t.team} className={cn("border-b border-border last:border-b-0", pinned.has(t.team) && "bg-accent/[0.07]")}>
                  <td className="density-row whitespace-nowrap px-3 py-2 max-sm:px-2"><Link to={`/teams/${t.team}`} className="font-medium tabular-nums hover:underline">{t.team}</Link> <span className="max-w-36 truncate text-xs text-muted-foreground max-sm:hidden">{names.get(t.team)}</span></td>
                  <td className="density-row px-3 py-2 text-right font-display font-semibold tabular-nums">{a ?? "—"}</td>
                  <td className="density-row px-3 py-2 max-sm:px-2">
                    <div className="flex items-center gap-2.5 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
                      <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:w-36">{t.rank ? `#${t.rank.p10}–${t.rank.p90}` : "—"} {a != null && t.rank && <Badge variant={inside ? "success" : "outline"} className="ml-0.5 max-sm:hidden">{inside ? "inside" : "outside"}</Badge>}</span>
                      <Whisker t={t} n={n} now={null} ghost={null} actual={a != null ? { rank: a, inside } : undefined} />
                    </div>
                  </td>
                  <td className="density-row px-3 py-2 text-right tabular-nums text-muted-foreground max-sm:hidden">{before.get(t.team)?.rank ? `#${before.get(t.team)!.rank!.p50}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className="relative border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rotate-45 bg-success" /> final seed inside the range</span>
        <span className="ml-3 inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rotate-45 bg-warning" /> outside</span>
        <span className="ml-3">An 80% range should hold about 8 teams in 10. <Link to="/methodology#projections" className="underline">How projections work</Link></span>
      </footer>
    </section>
  );
}

function Score({ label, inside, total, tone }: { label: string; inside: number; total: number; tone: string }): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-background/60 px-4 py-2.5">
      <p className={cn("font-display text-2xl font-semibold tabular-nums", tone)}>{inside} <span className="text-base text-muted-foreground">of {total}</span></p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
