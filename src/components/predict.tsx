// Prediction UI shared by every surface. Rule: a prediction is never shown
// without its confidence tier, and never presented as a fact.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, CircleDashed, Gauge, PlayCircle, ShieldCheck, Video, X } from "lucide-react";
import type { ConfidenceTier, Factor, MatchPredictionView, MatchView } from "../shared/api";
import { cn } from "./cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/overlay";
import { matchTime, oddsPct } from "../lib/format";
import { useVideoLinkCount } from "./MatchVideo";

const MatchDetails = lazy(() => import("./MatchDetails").then((x) => ({ default: x.MatchDetails })));
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

/** Compact, always-visible tier for dense lists (match rows, the Home card):
 *  the rule is a confidence tier on every prediction surface, never hover-only. */
export function TierMark({ tier, className }: { tier: ConfidenceTier; className?: string }) {
  const t = TIER[tier];
  const color = t.cls.split(" ").find((c) => c.startsWith("text-"));
  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap [&_svg]:size-3", color, className)} title={`${t.label} confidence: ${t.blurb}`}>
      <t.icon aria-hidden />{t.label.toLowerCase()}<span className="sr-only"> confidence</span>
    </span>
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
    <Link to="/methodology#accuracy" title="A tie counts as half a win" className={cn("group inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-base", className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
      {compact
        ? <>Calls near {said}% came true {won}% of the time</>
        : <>When we say about {said}%, the favourite wins {won}% of the time (ties count half) — {c.n.toLocaleString()} {c.kind === "live" ? "live calls" : `${c.seasonLabel} matches predicted from earlier data`}.</>}
      <span className="underline decoration-dotted underline-offset-2 group-hover:decoration-solid">Track record</span>
    </Link>
  );
}

export const KIND_LABEL: Record<MatchPredictionView["kind"], string> = {
  live: "Called before the match",
  backtest: "Predicted using only the matches before it (replayed afterward; not a live call)",
  now: "Prediction from today's ratings",
};

function TeamChip({ n, season, highlight, sub }: { n: number; season: number; highlight?: number; sub?: boolean }) {
  return (
    <Link to={`/teams/${n}?season=${season}`} className={cn("tabular rounded px-1 font-mono text-[13px] hover:underline", n === highlight ? "font-bold text-accent" : "text-text-base", sub && "opacity-60")}>
      {n}{sub && <span className="sr-only"> (surrogate)</span>}
    </Link>
  );
}

/** One match: lineups, scores (or time), and its prediction with honest labelling.
 *  Click the row (anywhere but a link or button) to open its details in place. */
export function MatchRow({ m, highlight, showEvent, open, onToggle }: { m: MatchView; highlight?: number; showEvent?: string; open?: boolean; onToggle?: () => void }) {
  const videos = useVideoLinkCount(`${m.season}:${m.code}:${m.level}:${m.series}:${m.number}`);
  const detailsId = `match-${m.code}-${m.key.replace(/:/g, "-")}`;
  const p = m.prediction;
  const redWon = m.played && m.red.score && m.blue.score ? m.red.score.total > m.blue.score.total : null;
  const tie = m.played && m.red.score && m.blue.score && m.red.score.total === m.blue.score.total;
  const called = p && m.played && !tie ? (p.pRed > 0.5) === redWon : null;
  const teamSide = highlight ? (m.red.teams.some((t) => t.number === highlight) ? "red" : m.blue.teams.some((t) => t.number === highlight) ? "blue" : null) : null;
  return (
    <div className="border-b border-border last:border-b-0" data-match={m.key}>
    <div
      className={cn("density-row grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 px-3 py-2.5 hover:bg-text-base/[0.03] sm:grid-cols-[4rem_1fr_1fr_9rem]", onToggle && "cursor-pointer", open && "bg-text-base/[0.03]")}
      onClick={onToggle ? (e) => { if (!(e.target as HTMLElement).closest("a, button, input")) onToggle(); } : undefined}
    >
      <div className="min-w-0">
        {onToggle ? (
          <button type="button" onClick={onToggle} aria-expanded={!!open} aria-controls={detailsId} aria-label={`${m.label} details`} className="flex items-center gap-0.5 rounded font-mono text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            {m.label}<ChevronDown className={cn("size-3.5 text-text-muted transition-transform", open && "rotate-180")} />
          </button>
        ) : <p className="font-mono text-sm font-semibold">{m.label}</p>}
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
          ) : p && !m.played && !p.noScoreBasis ? (
            // Not played yet: the predicted score, styled as a forecast (dimmed, with a tilde).
            <span className="flex items-center gap-1.5 opacity-70" title={`Predicted score ${Math.round(p.redMean)}–${Math.round(p.blueMean)}`} aria-label={`Predicted score ${Math.round(p.redMean)} to ${Math.round(p.blueMean)}`}>
              <span className="min-w-8 text-right text-red-alliance">~{Math.round(p.redMean)}</span>
              <span className="text-text-muted">–</span>
              <span className="min-w-8 text-blue-alliance">{Math.round(p.blueMean)}</span>
            </span>
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
              {KIND_LABEL[p.kind]} · {p.noScoreBasis ? "no predicted score: when this call was made, the season had no rated matches yet" : `predicted ${p.redMean}–${p.blueMean}`} · {p.tier} confidence
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
          {p && <TierMark tier={p.tier} />}
          {p?.kind === "backtest" && <span title={KIND_LABEL.backtest}>predicted</span>}
          {p?.kind === "live" && m.played && <span title={KIND_LABEL.live}>pre-match</span>}
          {m.video && <a href={m.video} target="_blank" rel="noreferrer noopener" className="inline-flex items-center hover:text-text-base" aria-label="Official match video"><PlayCircle className="size-3.5" /></a>}
          {videos > 0 && <span className="inline-flex items-center gap-0.5 text-accent" title={`${videos} saved video link${videos > 1 ? "s" : ""}`}><Video className="size-3.5" /><span className="text-[10px]">{videos}</span></span>}
        </div>
      </div>
    </div>
    {open && (
      <div id={detailsId}>
        <Suspense fallback={<div className="border-t border-border p-4"><div className="skeleton h-40 rounded-xl" /></div>}>
          <MatchDetails m={m} eventName={showEvent} />
        </Suspense>
      </div>
    )}
    </div>
  );
}

/** Matches, each opening its details in place. `initialOpen` (a match key,
 *  e.g. from ?match=) opens that one and scrolls it into view. `split`: at
 *  1700px+ the rows flow into two columns, in time order (down the left, then the right). */
export function MatchList({ matches, highlight, empty, eventNames, initialOpen, split }: { matches: MatchView[]; highlight?: number; empty?: string; eventNames?: Record<string, string>; initialOpen?: string | null; split?: boolean }) {
  const id = (m: MatchView) => `${m.code}:${m.key}`;
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!initialOpen) return;
    const m = matches.find((x) => x.key === initialOpen);
    if (!m) return;
    setOpen((s) => (s.has(id(m)) ? s : new Set(s).add(id(m))));
    requestAnimationFrame(() => box.current?.querySelector(`[data-match="${CSS.escape(m.key)}"]`)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    // Only when the requested match changes (not on every refresh of the list).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpen, matches.length]);
  if (!matches.length) return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">{empty ?? "No matches yet."}</p>;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div ref={box} className={cn("overflow-hidden rounded-xl border border-border bg-card", split && "min-[1700px]:columns-2 min-[1700px]:gap-0 min-[1700px]:[column-rule:1px_solid_var(--color-border)] [&>*]:break-inside-avoid")}>
      {matches.map((m) => <MatchRow key={id(m)} m={m} highlight={highlight} showEvent={eventNames?.[m.code]} open={open.has(id(m))} onToggle={() => toggle(id(m))} />)}
    </div>
  );
}

function CalibrationTip({ pRed }: { pRed: number }) {
  const c = useCalibration(pRed);
  if (!c) return null;
  // Always name the history it came from: a backtest must never read as live calls.
  const source = c.kind === "live" ? `${c.seasonLabel} live calls` : `${c.seasonLabel} predictions (replayed)`;
  return <span className="mt-1 block opacity-80">Track record ({source}): favourites near {Math.round(c.said * 100)}% won {Math.round(c.won * 100)}% of {c.n.toLocaleString()} matches, ties counting half.</span>;
}
