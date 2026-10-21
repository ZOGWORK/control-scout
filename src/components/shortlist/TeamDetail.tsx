// The panel a shortlist row opens in place: OPR split, event-by-event chart,
// prediction snapshot, the last five matches, and the quick actions.
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpToLine, ExternalLink, Scale, Trash2, TrendingUp } from "lucide-react";
import type { ForecastView, MatchView, ShortlistTeam } from "../../shared/api";
import { useApi, qs } from "../../lib/api";
import { useCurrentSeason } from "../../lib/meta";
import { num, oddsPct, rankPct } from "../../lib/format";
import { compareHref, lastPlayed, predictionSnapshot } from "../../lib/shortlist";
import { Button } from "../ui/button";
import { MatchRow, TierMark } from "../predict";
import { forecastTier } from "../Advancement";
import { projectionTier, projectionsPath } from "../../lib/projections";
import { ADVANCE_LABEL, advanceStatus, advanceText, type ProjectionsView } from "../../shared/projections";
import { BreakdownBar, EventPointsChart } from "./charts";
import { cn } from "../cn";

function Block({ title, children, className, aside }: { title: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-background/40 p-3.5", className)} aria-label={title}>
      <h4 className="mb-3 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}{aside}</h4>
      {children}
    </section>
  );
}

function Tile({ label, value, hint, tone, children }: { label: string; value: string; hint?: React.ReactNode; tone: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2.5">
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className={cn("font-display text-2xl font-semibold tabular-nums leading-tight", tone)}>{value}</p>
      {hint && <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-text-muted">{hint}</p>}
      {children}
    </div>
  );
}

/** Advancement odds at the team's current or next event (this season only; the forecast is cached per event). */
function Advance({ t, season }: { t: ShortlistTeam; season: number }) {
  const today = new Date().toISOString().slice(0, 10);
  const live = t.lastEvent && (t.lastEvent.end ?? t.lastEvent.start ?? "") >= today ? t.lastEvent : null;
  const ev = live ?? t.nextEvent;
  // The stored Monte Carlo projection first (a read, nothing simulated); the simulator only when there's none yet.
  const proj = useApi<ProjectionsView>(ev ? projectionsPath(season, ev.code) : null);
  const run = proj.data?.current;
  const mine = run?.teams.find((x) => x.team === t.team);
  const fallback = ev && (proj.error || (proj.data && !mine));
  const fc = useApi<ForecastView>(fallback ? `/api/predict/event${qs({ season, code: ev.code })}` : null);
  if (!ev) return null;
  if (run && mine) {
    const conf = projectionTier(run);
    const s = advanceStatus(mine);
    const value = advanceText(mine, (p) => oddsPct(p));
    return (
      <Tile label={`Advance from ${ev.name}`} value={value} tone={s === "odds" || s === "qualified" ? "text-success" : "text-text-muted"}
        hint={<><span title={ADVANCE_LABEL}>performance-based</span><span>· playoffs {oddsPct(mine.pPlayoff, run.stage === "selected")}</span><TierMark tier={conf.tier} /><Link to={`/events/${season}/${ev.code}?tab=odds`} className="underline hover:text-text-base">odds</Link></>} />
    );
  }
  if (!fallback && !proj.error) return <Tile label={`Advance from ${ev.name}`} value="…" tone="text-text-muted" hint="Reading the projection" />;
  const me = fc.data?.teams.find((x) => x.team === t.team);
  if (fc.loading) return <Tile label={`Advance from ${ev.name}`} value="…" tone="text-text-muted" hint="Simulating the event" />;
  if (!fc.data || !me) return <Tile label={`Advance from ${ev.name}`} value="—" tone="text-text-muted" hint={fc.error ? fc.error.message : "No forecast for this event yet"} />;
  const pre = fc.data.prequalified.includes(t.team);
  const conf = forecastTier(fc.data, t.team);
  return (
    <Tile label={`Advance from ${ev.name}`} value={pre ? "Qualified" : oddsPct(me.pAdvance)} tone="text-success"
      hint={<><span>win event {oddsPct(me.pWin)}</span><TierMark tier={conf.tier} /><Link to={`/events/${season}/${ev.code}?tab=odds`} className="underline hover:text-text-base">odds</Link></>} />
  );
}

function Snapshot({ t, season, matches }: { t: ShortlistTeam; season: number; matches: MatchView[] | undefined }) {
  const current = useCurrentSeason();
  const snap = matches ? predictionSnapshot(matches, t.team) : null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {!matches ? <><div className="skeleton h-20 rounded-lg" /><div className="skeleton h-20 rounded-lg" /></> : (
        <>
          {snap?.next ? (
            <Tile label={`Next: ${snap.next.m.label}`} value={oddsPct(snap.next.pWin)} tone="text-accent-text"
              hint={<><span>to win</span><TierMark tier={snap.next.tier} />{snap.upcoming && snap.upcoming.n > 1 && <><span>· {oddsPct(snap.upcoming.pWin)} avg over {snap.upcoming.n}</span><TierMark tier={snap.upcoming.tier} /></>}</>} />
          ) : snap?.past ? (
            <Tile label={`Expected win rate (${snap.past.n} matches)`} value={oddsPct(snap.past.expected)} tone="text-accent-text"
              hint={<><span>won {Math.round(snap.past.actual * 100)}% · {snap.past.kind === "live" ? "calls logged before each match" : "backtest replay"}</span><TierMark tier={snap.past.tier} /></>} />
          ) : <Tile label="Win chance" value="—" tone="text-text-muted" hint="No predicted matches this season" />}
          {snap?.next && snap.past ? (
            <Tile label={`Expected win rate (${snap.past.n} played)`} value={oddsPct(snap.past.expected)} tone="text-info"
              hint={<><span>won {Math.round(snap.past.actual * 100)}% · {snap.past.kind === "live" ? "logged pre-match" : "backtest"}</span><TierMark tier={snap.past.tier} /></>} />
          ) : null}
          {season === current && <Advance t={t} season={season} />}
        </>
      )}
    </div>
  );
}

export function TeamDetail({ t, season, rank, total, topPicks, onMove, onRemove, readOnly = false }: {
  /** A read-only list (Task 19): no move or remove. */
  readOnly?: boolean;
  t: ShortlistTeam; season: number; rank: number; total: number;
  /** The first picks (for "compare with your top picks"). */
  topPicks: number[];
  onMove: (delta: number | "top") => void;
  onRemove: () => void;
}) {
  const m = useApi<{ matches: MatchView[] }>(`/api/teams/${t.team}/matches${qs({ season })}`);
  const recent = m.data ? lastPlayed(m.data.matches) : [];
  const names = Object.fromEntries(t.events.map((e) => [e.code, e.name]));
  const others = topPicks.filter((x) => x !== t.team).slice(0, 3);
  const top = rankPct(t.oprRank, t.of);
  return (
    <div className="grid gap-3 border-t border-border bg-accent/[0.03] p-3 sm:p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="grid min-w-0 content-start gap-3">
        <Block title="OPR breakdown" aside={<span className="normal-case tracking-normal text-text-base"><span className="font-display text-base font-semibold text-accent-text">{num(t.opr)}</span> total{t.oprRank ? <span className="text-text-muted"> · #{t.oprRank.toLocaleString()} world{top ? ` (${top})` : ""}</span> : null}</span>}>
          <BreakdownBar auto={t.breakdown.auto} teleop={t.breakdown.teleop} endgame={t.breakdown.endgame} />
          {t.breakdown.event && <p className="mt-2 text-[11px] text-text-muted">Split from {t.breakdown.event.name}, the event behind the season OPR.</p>}
        </Block>
        <Block title="Event by event" aside={<span className="inline-flex items-center gap-1 normal-case tracking-normal"><TrendingUp className="size-3" /> OPR split per event</span>}>
          <EventPointsChart events={t.events} />
        </Block>
        <Block title="Prediction snapshot">
          {m.error ? <p className="text-sm text-text-muted">Couldn't load matches: {m.error.message}</p> : <Snapshot t={t} season={season} matches={m.data?.matches} />}
        </Block>
      </div>
      <div className="grid min-w-0 content-start gap-3">
        <Block title="Last 5 matches" aside={<Link to={`/teams/${t.team}?season=${season}`} className="normal-case tracking-normal text-text-muted hover:text-text-base hover:underline">All matches</Link>}>
          {m.error ? <p className="text-sm text-text-muted">{m.error.message}</p>
            : !m.data ? <div className="space-y-1.5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
            : !recent.length ? <p className="text-sm text-text-muted">No played matches this season yet.</p>
            : <div className="-mx-3.5 -mb-3.5 overflow-hidden rounded-b-xl border-t border-border">{recent.map((x) => <MatchRow key={`${x.code}:${x.key}`} m={x} highlight={t.team} showEvent={names[x.code] ?? x.code} />)}</div>}
        </Block>
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Actions for ${t.team}`}>
          <Button variant="secondary" size="sm" asChild><Link to={compareHref([t.team, ...others], season)}><Scale /> {others.length ? `Compare with top ${others.length}` : "Compare"}</Link></Button>
          <Button variant="secondary" size="sm" asChild><Link to={`/teams/${t.team}?season=${season}`}><ExternalLink /> Team page</Link></Button>
          {!readOnly && <>
          <Button variant="outline" size="sm" onClick={() => onMove(-1)} disabled={rank === 1} aria-label={`Move ${t.team} up one pick`}><ArrowUp /> Up</Button>
          <Button variant="outline" size="sm" onClick={() => onMove(1)} disabled={rank === total} aria-label={`Move ${t.team} down one pick`}><ArrowDown /> Down</Button>
          <Button variant="outline" size="sm" onClick={() => onMove("top")} disabled={rank === 1} aria-label={`Make ${t.team} first pick`}><ArrowUpToLine /> First pick</Button>
          <Button variant="destructive" size="sm" onClick={onRemove} className="ml-auto"><Trash2 /> Remove</Button>
          </>}
        </div>
      </div>
    </div>
  );
}
