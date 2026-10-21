// The Predict page's header card: the latest live calls (logged before the match, then scored), one at a
// time, turning over every few seconds. Real calls from the track record (/api/predict/accuracy), each
// with its tier and how it turned out; a pause button stops the turnover, and reduced motion shows the
// first three still. Nothing here is invented: with no scored live calls yet, it says so.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Pause, Play, X } from "lucide-react";
import { useApi } from "../lib/api";
import { oddsPct } from "../lib/format";
import type { MatchPredictionView, MatchView, TrackRecord } from "../shared/api";
import { TierMark, WinBar } from "./predict";
import { cn } from "./cn";

type Call = MatchView & { prediction: MatchPredictionView };

/** How a scored call turned out: right, missed, a 50:50 call (no pick) or a tied match. */
export function callOutcome(m: Call): "right" | "missed" | "even" | "tie" | null {
  const r = m.red.score?.total, b = m.blue.score?.total;
  if (!m.played || r == null || b == null) return null;
  if (r === b) return "tie";
  if (m.prediction.pRed === 0.5) return "even";
  return (m.prediction.pRed > 0.5) === (r > b) ? "right" : "missed";
}

/**
 * A pick's odds, for the side that was picked (p > 0.5): like oddsPct, but a near-even lean never reads as
 * 50:50. It keeps decimals while they still show the lean ("50.1%", "50.04%"), and below that says so.
 */
export function pickPct(p: number): string {
  if (Math.round(p * 100) !== 50) return oddsPct(p);
  for (const d of [1, 2]) { const s = (p * 100).toFixed(d); if (Number(s) > 50) return `${s}%`; }
  return "just over 50%";
}

/** Milliseconds each call stays up. */
export const TURN_MS = 4500;

export function LatestCalls({ className }: { className?: string }) {
  const state = useApi<TrackRecord>("/api/predict/accuracy");
  const calls = (state.data?.recentCalls ?? []).filter((m): m is Call => !!m.prediction && m.played);
  const reduced = !!useReducedMotion();
  const [paused, setPaused] = useState<boolean | null>(null);
  // Reading pauses the turnover: the pointer over the card or focus inside it (tracked apart, so one ending doesn't end the other).
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const still = paused ?? reduced;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (still || hover || focus || calls.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % calls.length), TURN_MS);
    return () => clearInterval(t);
  }, [still, hover, focus, calls.length]);
  if (state.error || (state.data && !calls.length)) {
    return state.data ? (
      <aside aria-label="Latest live calls" className={cn("rounded-2xl border border-dashed border-line p-5 max-sm:p-4 text-sm text-text-muted", className)}>
        No live calls have been scored yet. Each match prediction is logged before the match and scored after it; they'll show here.
      </aside>
    ) : null;
  }
  const shown = reduced && paused === null ? calls.slice(0, 3) : calls.length ? [calls[i % calls.length]] : [];
  return (
    <aside aria-label="Latest live calls" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); }}
      className={cn("relative overflow-hidden rounded-2xl border border-line bg-card p-5 max-sm:p-4", className)}>
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Latest live calls</p>
        {calls.length > 1 && !(reduced && paused === null) && (
          <button type="button" onClick={() => setPaused(!still)} aria-label={still ? "Turn through the calls" : "Stop turning through the calls"}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-text-muted hover:bg-text-base/[0.06] hover:text-text-base focus-visible:outline-2 focus-visible:outline-accent max-sm:size-10">
            {still ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
          </button>
        )}
      </div>
      {!state.data ? <div aria-busy="true" className="mt-4 h-32" /> : (
        <ul className="relative mt-3 space-y-3" aria-live="off">
          {shown.map((m) => <CallRow key={`${m.code}:${m.key}`} m={m} />)}
        </ul>
      )}
      {calls.length > 1 && !(reduced && paused === null) && (
        <div className="relative mt-4 flex items-center gap-1.5" aria-hidden>
          {calls.map((m, k) => <span key={`${m.code}:${m.key}`} className={cn("h-1 rounded-full transition-all duration-300 motion-reduce:transition-none", k === i % calls.length ? "w-5 bg-accent" : "w-1.5 bg-text-base/20")} />)}
        </div>
      )}
      <Link to="/methodology#recent" className="relative mt-3 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent-text hover:underline">
        Every call, scored <ArrowUpRight className="size-4" />
      </Link>
    </aside>
  );
}

function CallRow({ m }: { m: Call }) {
  const o = callOutcome(m);
  const red = m.red.teams.map((t) => t.number).join(" "), blue = m.blue.teams.map((t) => t.number).join(" ");
  const p = m.prediction.pRed;
  const pick = p === 0.5 ? null : p > 0.5 ? "red" : "blue";
  return (
    <li className="animate-[cs-call-in_400ms_ease-out] motion-reduce:animate-none">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{m.label} · <span className="font-mono text-text-muted">{m.code}</span></span>
        <TierMark tier={m.prediction.tier} className="text-xs" />
      </p>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs tabular-nums">
        <span className="truncate font-mono text-red-alliance">{red}</span>
        <span className="font-semibold">{m.red.score?.total ?? "–"}–{m.blue.score?.total ?? "–"}</span>
        <span className="truncate text-right font-mono text-blue-alliance">{blue}</span>
      </div>
      <WinBar pRed={p} size="sm" className="mt-2" />
      <p className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-xs">
        <span className="text-text-muted">{pick ? <>Called <span className={pick === "red" ? "text-red-alliance" : "text-blue-alliance"}>{pick === "red" ? "Red" : "Blue"} {pickPct(pick === "red" ? p : 1 - p)}</span> before the match</> : "A 50:50 call before the match"}</span>
        {o === "right" ? <span className="inline-flex items-center gap-1 font-semibold text-success"><Check className="size-3.5" aria-hidden /> Right</span>
          : o === "missed" ? <span className="inline-flex items-center gap-1 font-semibold text-danger"><X className="size-3.5" aria-hidden /> Missed</span>
          : <span className="text-text-muted">{o === "tie" ? "Tied match" : "No pick"}</span>}
      </p>
    </li>
  );
}
