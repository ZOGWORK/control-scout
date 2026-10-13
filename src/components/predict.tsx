// Prediction UI shared by every surface. Rule: a prediction is never shown
// without its confidence tier, and never presented as a fact.
import { Link } from "react-router-dom";
import { Check, CircleDashed, Gauge, PlayCircle, ShieldCheck, X } from "lucide-react";
import type { ConfidenceTier, Factor, MatchPredictionView, MatchView } from "../shared/api";
import { cn } from "./cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/overlay";
import { matchTime, oddsPct } from "../lib/format";
import { VideoButton } from "./VideoDialog";
import { useCalibration } from "../lib/calibration";

const TIER: Record<ConfidenceTier, { label: string; cls: string; icon: typeof Gauge; blurb: string }> = {
  provisional: { label: "Provisional", cls: "border-warning/40 bg-warning/10 text-warning", icon: CircleDashed, blurb: "Mostly prior-season data — treat as a rough guess." },
  moderate: { label: "Moderate", cls: "border-info/40 bg-info/10 text-info", icon: Gauge, blurb: "Some matches this season; still settling." },
  confident: { label: "Confident", cls: "border-success/40 bg-success/10 text-success", icon: ShieldCheck, blurb: "Every robot has a real sample this season." },
};

export function ConfidenceBadge({ tier, reason, className }: { tier: ConfidenceTier; reason?: string; className?: string }) {
  const t = TIER[tier];
  const badge = (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap [&_svg]:size-3", t.cls, className)}>
      <t.icon aria-hidden /> {t.label}<span className="sr-only"> confidence</span>
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild><button type="button" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60">{badge}</button></TooltipTrigger>
      <TooltipContent className="max-w-64">{reason ?? t.blurb} <Link to="/methodology#confidence" className="underline">How tiers work</Link></TooltipContent>
    </Tooltip>
  );
}

/** Red vs blue win probability bar. */
export function WinBar({ pRed, className, size = "md" }: { pRed: number; className?: string; size?: "sm" | "md" }) {
  const r = Math.max(0.02, Math.min(0.98, pRed));
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full bg-muted", size === "sm" ? "h-1.5" : "h-2.5", className)} role="img" aria-label={`Red ${oddsPct(pRed)} to win, blue ${oddsPct(1 - pRed)}`}>
      <div className="h-full bg-red-alliance transition-[width] duration-500" style={{ width: `${r * 100}%` }} />
      <div className="h-full flex-1 bg-blue-alliance" />
    </div>
  );
}

export function FactorList({ factors, className }: { factors: Factor[]; className?: string }) {
  return (
    <ol className={cn("space-y-1.5", className)}>
      {factors.map((f, i) => (
        <li key={f.id} className="flex gap-2 text-sm">
          <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
            f.favors === "A" ? "bg-red-alliance/15 text-red-alliance" : f.favors === "B" ? "bg-blue-alliance/15 text-blue-alliance" : "bg-muted text-text-muted")}>{i + 1}</span>
          <span className="text-text-base">{f.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The track record, right where the prediction is: "when we say 63%, the
 * favourite wins 65% of the time". Links to the full record.
 */
export function CalibrationLine({ pRed, className, compact }: { pRed: number; className?: string; compact?: boolean }) {
  const c = useCalibration(pRed);
  if (!c) return null;
  const said = Math.round(c.said * 100), won = Math.round(c.won * 100);
  return (
    <Link to="/predict/accuracy" title="A tie counts as half a win" className={cn("group inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-base", className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
      {compact
        ? <>Calls near {said}% came true {won}% of the time</>
        : <>When we say about {said}%, the favourite wins {won}% of the time (ties count half) — {c.n.toLocaleString()} {c.kind === "live" ? "live calls" : `matches, ${c.seasonLabel} backtest`}.</>}
      <span className="underline decoration-dotted underline-offset-2 group-hover:decoration-solid">Track record</span>
    </Link>
  );
}

const KIND_LABEL: Record<MatchPredictionView["kind"], string> = {
  live: "Called before the match",
  backtest: "Backtest (replayed with only earlier data)",
  now: "Prediction from today's ratings",
};

function TeamChip({ n, season, highlight, sub }: { n: number; season: number; highlight?: number; sub?: boolean }) {
  return (
    <Link to={`/teams/${n}?season=${season}`} className={cn("tabular rounded px-1 font-mono text-[13px] hover:underline", n === highlight ? "font-bold text-accent" : "text-text-base", sub && "opacity-60")}>
      {n}{sub && <span className="sr-only"> (surrogate)</span>}
    </Link>
  );
}

/** One match: lineups, scores (or time), and its prediction with honest labelling. */
export function MatchRow({ m, highlight, showEvent }: { m: MatchView; highlight?: number; showEvent?: string }) {
  const p = m.prediction;
  const redWon = m.played && m.red.score && m.blue.score ? m.red.score.total > m.blue.score.total : null;
  const tie = m.played && m.red.score && m.blue.score && m.red.score.total === m.blue.score.total;
  const called = p && m.played && !tie ? (p.pRed > 0.5) === redWon : null;
  const teamSide = highlight ? (m.red.teams.some((t) => t.number === highlight) ? "red" : m.blue.teams.some((t) => t.number === highlight) ? "blue" : null) : null;
  return (
    <div className="density-row grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-text-base/[0.03] sm:grid-cols-[4rem_1fr_1fr_9rem]">
      <div className="min-w-0">
        <p className="font-mono text-sm font-semibold">{m.label}</p>
        <p className="truncate text-[11px] text-text-muted">{showEvent ?? matchTime(m.time)}</p>
      </div>
      <div className="col-span-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:col-span-2">
        <div className={cn("flex flex-wrap justify-end gap-x-1 rounded-lg px-1.5 py-1", teamSide === "red" && "bg-red-alliance/10")}>
          {m.red.teams.map((t) => <TeamChip key={t.number} n={t.number} season={m.season} highlight={highlight} sub={t.surrogate || !t.onField} />)}
        </div>
        <div className="flex items-center gap-1.5 font-display text-base font-bold tabular-nums">
          {m.played && m.red.score && m.blue.score ? (
            <>
              <span className={cn("min-w-8 text-right text-red-alliance", redWon === false && !tie && "opacity-55")}>{m.red.score.total}</span>
              <span className="text-text-muted">–</span>
              <span className={cn("min-w-8 text-blue-alliance", redWon === true && "opacity-55")}>{m.blue.score.total}</span>
            </>
          ) : <span className="px-2 text-xs font-medium text-text-muted">vs</span>}
        </div>
        <div className={cn("flex flex-wrap gap-x-1 rounded-lg px-1.5 py-1", teamSide === "blue" && "bg-blue-alliance/10")}>
          {m.blue.teams.map((t) => <TeamChip key={t.number} n={t.number} season={m.season} highlight={highlight} sub={t.surrogate || !t.onField} />)}
        </div>
      </div>
      <div className="col-span-3 flex items-center gap-2 sm:col-span-1 sm:flex-col sm:items-stretch sm:gap-1">
        {p ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="flex flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:flex-none">
                <span className="w-9 text-right text-xs font-semibold tabular-nums text-red-alliance">{oddsPct(p.pRed)}</span>
                <WinBar pRed={p.pRed} size="sm" className="min-w-12 flex-1" />
                <span className="w-9 text-xs font-semibold tabular-nums text-blue-alliance">{oddsPct(1 - p.pRed)}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {KIND_LABEL[p.kind]} · predicted {p.redMean}–{p.blueMean} · {p.tier} confidence
              {p.factors?.length ? <span className="mt-1 block opacity-80">{p.factors[0].label}</span> : null}
              <CalibrationTip pRed={p.pRed} />
            </TooltipContent>
          </Tooltip>
        ) : <span className="text-xs text-text-muted" title="The engine predicts full 2-against-2 matches only">{
          m.played ? ([m.red, m.blue].some((a) => a.teams.filter((t) => t.onField).length !== 2) ? "Robot missing — not predicted" : "No prediction")
            : m.red.teams.length > 2 || m.blue.teams.length > 2 ? "Lineup TBD" : "—"}</span>}
        <div className="flex items-center justify-end gap-1.5 text-[11px] text-text-muted">
          {called === true && <span className="inline-flex items-center gap-0.5 text-success"><Check className="size-3" /> Called</span>}
          {called === false && <span className="inline-flex items-center gap-0.5 text-warning"><X className="size-3" /> Upset</span>}
          {p?.kind === "backtest" && <span title={KIND_LABEL.backtest}>backtest</span>}
          {p?.kind === "live" && m.played && <span title={KIND_LABEL.live}>pre-match</span>}
          {m.video && <a href={m.video} target="_blank" rel="noreferrer noopener" className="inline-flex items-center hover:text-text-base" aria-label="Official match video"><PlayCircle className="size-3.5" /></a>}
          <VideoButton matchRef={`${m.season}:${m.code}:${m.level}:${m.series}:${m.number}`} label={`${m.code} ${m.label}`} />
        </div>
      </div>
    </div>
  );
}

export function MatchList({ matches, highlight, empty, eventNames }: { matches: MatchView[]; highlight?: number; empty?: string; eventNames?: Record<string, string> }) {
  if (!matches.length) return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">{empty ?? "No matches yet."}</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {matches.map((m) => <MatchRow key={`${m.code}:${m.key}`} m={m} highlight={highlight} showEvent={eventNames?.[m.code]} />)}
    </div>
  );
}

function CalibrationTip({ pRed }: { pRed: number }) {
  const c = useCalibration(pRed);
  if (!c) return null;
  // Always name the history it came from: a backtest must never read as live calls.
  const source = c.kind === "live" ? `${c.seasonLabel} live calls` : `${c.seasonLabel} backtest`;
  return <span className="mt-1 block opacity-80">Track record ({source}): favourites near {Math.round(c.said * 100)}% won {Math.round(c.won * 100)}% of {c.n.toLocaleString()} matches, ties counting half.</span>;
}
