// Prediction UI shared by every surface. Rule: a prediction is never shown
// without its confidence tier, and never presented as a fact.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Link, useLocation } from "react-router-dom";
import { Check, ChevronDown, CircleDashed, ClipboardList, Gauge, History, PlayCircle, Radio, ShieldCheck, Video, X } from "lucide-react";
import type { ConfidenceTier, Factor, MatchPredictionView, MatchView } from "../shared/api";
import { matchReportHref } from "../shared/matchReport";
import { cn } from "./cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/overlay";
import { matchTime, oddsPct } from "../lib/format";
import { useVideoLinkCount } from "./MatchVideo";
import { restoredSavedPosition } from "../lib/mainScroll";

const MatchDetails = lazy(() => import("./MatchDetails").then((x) => ({ default: x.MatchDetails })));
import { useCalibration } from "../lib/calibration";
import { usePredictable } from "../lib/meta";

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

/** One small status chip in a match row's call column: never wraps, the same height for every kind. */
const STATUS_CHIP = "inline-flex h-[18px] shrink-0 items-center gap-0.5 whitespace-nowrap rounded px-1 text-[11px] font-medium leading-none";

/** Compact, always-visible tier for dense lists (match rows, the Home card):
 *  the rule is a confidence tier on every prediction surface, never hover-only. */
export function TierMark({ tier, className, chip }: { tier: ConfidenceTier; className?: string; chip?: boolean }) {
  const t = TIER[tier];
  const color = t.cls.split(" ").find((c) => c.startsWith("text-"));
  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap [&_svg]:size-3", chip ? cn(STATUS_CHIP, "border", t.cls) : color, className)} title={`${t.label} confidence: ${t.blurb}`}>
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
  const me = n === highlight;
  return (
    <Link to={`/teams/${n}?season=${season}`} title={sub ? `${n} (surrogate or didn't play)` : undefined}
      className={cn("tabular rounded-md px-1.5 py-0.5 font-mono text-[13px] hover:underline", me ? "bg-accent/15 font-bold text-accent ring-1 ring-accent/60" : "text-text-base", sub && "opacity-55")}>
      {n}{sub && <span className="sr-only"> (surrogate)</span>}
    </Link>
  );
}

type Side = "red" | "blue";

/** How many times `value` has changed since the first render (0: never): a new score arriving
 *  (live auto-refresh) restarts its flash; a row that mounts with its score doesn't flash. */
function useChangeCount<T>(value: T): number {
  const prev = useRef(value);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    setN((x) => x + 1);
  }, [value]);
  return n;
}

/** One alliance: its teams and score in one tinted box. The winner's box is stronger; the loser's fades back. */
function AllianceBox({ side, m, score, forecast, outcome, highlight }: {
  side: Side; m: MatchView; score: number | null; forecast: number | null; outcome: "win" | "loss" | "tie" | null; highlight?: number;
}) {
  const a = m[side];
  const flash = useChangeCount(score);
  return (
    <div className={cn(
      // Narrow rows: one line per alliance, teams then score. Wider rows (the row's own width): the two boxes face each other, scores in the middle.
      "flex min-w-0 items-center justify-between gap-2 rounded-lg border-l-[3px] px-2.5 py-1.5",
      side === "red" ? "border-red-alliance bg-red-alliance/[0.06]" : "border-blue-alliance bg-blue-alliance/[0.06] @lg:flex-row-reverse @lg:border-l-0 @lg:border-r-[3px]",
      outcome === "win" && (side === "red" ? "bg-red-alliance/[0.14]" : "bg-blue-alliance/[0.14]"),
    )}>
      <div className={cn("flex min-w-0 flex-wrap gap-x-0.5", side === "blue" && "@lg:justify-end")}>
        {a.teams.map((t) => <TeamChip key={t.number} n={t.number} season={m.season} highlight={highlight} sub={t.surrogate || !t.onField} />)}
      </div>
      {score != null ? (
        <span key={flash} className={cn("shrink-0 font-display text-lg font-bold tabular-nums", flash > 0 && "cs-score-flash -mx-1 px-1", side === "red" ? "text-red-alliance" : "text-blue-alliance", outcome === "loss" && "opacity-45")}>
          {score}{outcome === "win" && <span className="sr-only"> (won)</span>}
        </span>
      ) : forecast != null ? (
        <span className={cn("shrink-0 font-display text-base font-semibold tabular-nums opacity-60", side === "red" ? "text-red-alliance" : "text-blue-alliance")} title="Predicted score">~{forecast}</span>
      ) : null}
    </div>
  );
}

/** One match: two alliance boxes facing each other, then the call in plain words.
 *  Click the row (anywhere but a link or button) to open its details in place. */
/** `showEvent` replaces the time under the label; `eventName` only names the event inside the details. */
/** `outcomeAccent`: the highlighted team's rows get a left edge in its result's colour (green won, red lost) instead of gold. */
export function MatchRow({ m, highlight, showEvent, eventName, open, onToggle, outcomeAccent }: { m: MatchView; highlight?: number; showEvent?: string; eventName?: string; open?: boolean; onToggle?: () => void; outcomeAccent?: boolean }) {
  const videos = useVideoLinkCount(`${m.season}:${m.code}:${m.level}:${m.series}:${m.number}`);
  const detailsId = `match-${m.code}-${m.key.replace(/:/g, "-")}`;
  // MotionConfig's reducedMotion only stops transforms; height is a layout animation, so it's turned off here.
  const reduce = !!useReducedMotion();
  const p = m.prediction;
  const scored = m.played && m.red.score && m.blue.score;
  const red = scored ? m.red.score!.total : null, blue = scored ? m.blue.score!.total : null;
  const tie = scored && red === blue;
  const winner: Side | null = scored && !tie ? (red! > blue! ? "red" : "blue") : null;
  const outcome = (s: Side) => (!scored ? null : tie ? "tie" : winner === s ? "win" : "loss");
  const called = p && scored && !tie ? (p.pRed > 0.5) === (winner === "red") : null;
  const mySide: Side | null = highlight ? (m.red.teams.some((t) => t.number === highlight) ? "red" : m.blue.teams.some((t) => t.number === highlight) ? "blue" : null) : null;
  const mine = mySide ? outcome(mySide) : null;
  const forecast = !scored && p && !p.noScoreBasis ? { red: Math.round(p.redMean), blue: Math.round(p.blueMean) } : null;
  const fav: Side | null = p ? (p.pRed >= 0.5 ? "red" : "blue") : null;
  const missing = [m.red, m.blue].some((a) => a.teams.filter((t) => t.onField).length !== 2);
  const when = showEvent ?? matchTime(m.time);
  const predictable = usePredictable(m.season); // 2019–2022: history only, so no "No call" on every row
  return (
    // @container: the row lays itself out by its own width (an event's tab, a team's season, a narrow drawer), not the window's.
    <div className={cn("@container border-b border-border last:border-b-0", mySide && "relative before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
      mySide && (outcomeAccent && mine === "win" ? "before:bg-success" : outcomeAccent && mine === "loss" ? "before:bg-destructive" : "before:bg-accent/70"))} data-match={m.key}>
    <div
      // Narrow rows: the label keeps at least its own width (time, the team's won/lost chip), and the call's
      // chips wrap under it instead of pushing into the label.
      className={cn("group/row density-row grid grid-cols-[minmax(min-content,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 transition-colors",
        // Wide rows: label | red | blue | the call | report. Fixed tracks either side, so every row lines up.
        "@3xl:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_11.5rem_2rem]",
        onToggle ? "cursor-pointer hover:bg-accent/[0.07]" : "hover:bg-text-base/[0.03]", open && "bg-accent/[0.05]")}
      onClick={onToggle ? (e) => { if (!(e.target as HTMLElement).closest("a, button, input")) onToggle(); } : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 @3xl:block" data-match-label>
        {onToggle ? (
          <button type="button" onClick={onToggle} aria-expanded={!!open} aria-controls={detailsId} aria-label={`${m.label} details`} className={cn("flex items-center gap-0.5 rounded font-mono text-sm font-semibold outline-none transition-colors group-hover/row:text-accent-text focus-visible:ring-2 focus-visible:ring-ring/60", open && "text-accent-text")}>
            {m.label}<ChevronDown className={cn("size-3.5 text-text-muted transition-transform group-hover/row:text-accent-text", open && "rotate-180 text-accent-text")} />
          </button>
        ) : <p className="font-mono text-sm font-semibold">{m.label}</p>}
        {/* An event name (a team's season, the shortlist drawer) can be long: on its own line, truncated, and with no
            intrinsic width (contain), so it never makes the label column reserve its full length. */}
        <p className={cn("min-w-0 text-[11px] text-text-muted", showEvent ? "basis-full truncate [contain:inline-size]" : "whitespace-nowrap")} title={when} data-when>{when}</p>
        {/* The highlighted team's own result goes with the match, not the call. */}
        {mine && (
          <span className={cn("mt-0.5 inline-block whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold",
            mine === "win" ? "bg-success/15 text-success" : mine === "loss" ? "bg-destructive/15 text-destructive" : "bg-muted text-text-muted")} data-mine>
            {highlight} {mine === "win" ? "won" : mine === "loss" ? "lost" : "tied"}
          </span>
        )}
      </div>
      {/* Narrow rows: the alliances sit under the label line (stacked, then facing each other once there's room). */}
      <div className="col-span-3 row-start-2 grid gap-1 @lg:grid-cols-2 @lg:gap-1.5 @3xl:col-span-2 @3xl:col-start-2 @3xl:row-start-1" data-alliances>
        <AllianceBox side="red" m={m} score={red} forecast={forecast?.red ?? null} outcome={outcome("red")} highlight={highlight} />
        <AllianceBox side="blue" m={m} score={blue} forecast={forecast?.blue ?? null} outcome={outcome("blue")} highlight={highlight} />
      </div>
      {/* The call, in its own track so it never runs into the blue box: line 1 the pick and its bar, line 2 small status chips. */}
      <div className="col-start-2 row-start-1 flex min-w-0 flex-col items-end gap-1 text-right @3xl:col-start-4" data-call>
        {p && fav ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="flex items-center gap-1.5 whitespace-nowrap rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Predicted ${fav} ${oddsPct(fav === "red" ? p.pRed : 1 - p.pRed)}`}>
                {/* Under 20rem of row the word goes (the button's aria-label still says "Predicted …"): the label needs the room. */}
                <span className="text-text-muted @max-xs:hidden">Picked</span>
                <span className={cn("font-semibold tabular-nums", fav === "red" ? "text-red-alliance" : "text-blue-alliance")}>{fav === "red" ? "Red" : "Blue"} {oddsPct(fav === "red" ? p.pRed : 1 - p.pRed)}</span>
                <WinBar pRed={p.pRed} size="sm" className="w-12 shrink-0" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {KIND_LABEL[p.kind]} · {p.noScoreBasis ? "no predicted score: when this call was made, the season had no rated matches yet" : `predicted ${p.redMean}–${p.blueMean}`} · {p.tier} confidence
              {p.factors?.length ? <span className="mt-1 block opacity-80">{p.factors[0].label}</span> : null}
              <CalibrationTip pRed={p.pRed} />
            </TooltipContent>
          </Tooltip>
        ) : (
          !predictable ? null : <span className="whitespace-nowrap text-xs text-text-muted" title={missing && m.played ? "An alliance played with one robot. The engine predicts full 2-against-2 matches only." : undefined}>
            {m.played ? (missing ? "No call · a robot sat out" : "No call") : m.red.teams.length > 2 || m.blue.teams.length > 2 ? "Lineup TBD" : "—"}
          </span>
        )}
        {(p || m.video || videos > 0) && (
          <div className="flex flex-wrap items-center justify-end gap-1 text-[11px] text-text-muted" data-call-status>
            {/* Right and Upset share one width, so the chips after them line up from row to row. */}
            {called === true && <span className={cn(STATUS_CHIP, "min-w-[3.25rem] justify-center bg-success/12 text-success")} data-outcome="right"><Check className="size-3" aria-hidden /> Right</span>}
            {called === false && <span className={cn(STATUS_CHIP, "min-w-[3.25rem] justify-center bg-warning/12 text-warning")} data-outcome="upset"><X className="size-3" aria-hidden /> Upset</span>}
            {p && <TierMark tier={p.tier} chip />}
            {/* Which ledger a played match's call came from, as an icon chip (a word never fits beside the others): the words
                stay in its title and for screen readers. Live and replayed calls are never blended, so both are marked. */}
            {p && m.played && (p.kind === "live" || p.kind === "backtest") && (
              <span className={cn(STATUS_CHIP, "bg-muted text-text-muted")} title={`${p.kind === "live" ? "Pre-match" : "Replayed"}: ${KIND_LABEL[p.kind]}`} data-kind={p.kind}>
                {p.kind === "live" ? <Radio className="size-3" aria-hidden /> : <History className="size-3" aria-hidden />}
                <span className="sr-only">{p.kind === "live" ? "pre-match" : "replayed"}: {KIND_LABEL[p.kind]}</span>
              </span>
            )}
            {m.video && <a href={m.video} target="_blank" rel="noreferrer noopener" className={cn(STATUS_CHIP, "hover:text-text-base")} aria-label="Official match video"><PlayCircle className="size-3.5" /></a>}
            {videos > 0 && <span className={cn(STATUS_CHIP, "text-accent")} title={`${videos} saved video link${videos > 1 ? "s" : ""}`}><Video className="size-3.5" /><span className="text-[10px]">{videos}</span></span>}
          </div>
        )}
      </div>
      {/* One tap to the pre-match scouting report (v1.6 Task 2): an icon button in its own track, so it never takes the
          call's width. 32px to look at, 40px to tap (the ::after). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to={matchReportHref(m)} className="relative col-start-3 row-start-1 inline-flex size-8 items-center justify-center justify-self-end rounded-md border border-border bg-card text-text-muted outline-none transition-colors after:absolute after:-inset-1 hover:border-accent/60 hover:text-accent-text focus-visible:ring-2 focus-visible:ring-ring/60 @3xl:col-start-5" aria-label={`Pre-match report for ${m.label}`} data-report-link>
            <ClipboardList className="size-4" aria-hidden />
          </Link>
        </TooltipTrigger>
        <TooltipContent>Know your match: the pre-match report for {m.label}</TooltipContent>
      </Tooltip>
    </div>
    {/* Details unfold under the row (height + fade); instant with "reduce motion". */}
    <AnimatePresence initial={false}>
      {open && (
        <motion.div id={detailsId} key="details" className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={reduce ? { duration: 0 } : { height: { duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }, opacity: { duration: 0.18 } }}>
          <Suspense fallback={<div className="border-t border-border p-4"><div className="skeleton h-40 rounded-xl" /></div>}>
            <MatchDetails m={m} eventName={eventName ?? showEvent} />
          </Suspense>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}

const LEVEL_TITLE: Record<MatchView["level"], string> = { qual: "Qualifications", playoff: "Playoffs" };

/** Matches in one column, time order, under Qualifications / Playoffs headings, each opening its details
 *  in place. `initialOpen` (a match key, e.g. from ?match=) opens that one and scrolls it into view.
 *  With `highlight`, a summary line gives that team's record in the matches shown.
 *  `eventDates` (by event code, with `eventNames`) puts each event's dates in its heading; `outcomeAccent`: see MatchRow. */
export function MatchList({ matches, highlight, empty, eventNames, eventDates, initialOpen, outcomeAccent }: { matches: MatchView[]; highlight?: number; empty?: string; eventNames?: Record<string, string>; eventDates?: Record<string, string>; initialOpen?: string | null; outcomeAccent?: boolean }) {
  const id = (m: MatchView) => `${m.code}:${m.key}`;
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const box = useRef<HTMLDivElement>(null);
  // The match a link asked for is brought into view once per visit (history entry): a live update that
  // adds matches to the list must not pull the page back to it after the reader has scrolled on, and
  // nor may Back/Forward, which return to where the reader actually was (src/lib/mainScroll.ts).
  const loc = useLocation();
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    const visit = `${loc.key}:${initialOpen}`;
    if (!initialOpen || shownFor.current === visit) return;
    const m = matches.find((x) => x.key === initialOpen);
    if (!m) return;
    shownFor.current = visit;
    setOpen((s) => (s.has(id(m)) ? s : new Set(s).add(id(m))));
    if (restoredSavedPosition(loc)) return;
    requestAnimationFrame(() => box.current?.querySelector(`[data-match="${CSS.escape(m.key)}"]`)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    // Only when the requested match or the visit changes (not on every refresh of the list).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpen, loc.key, matches.length]);
  if (!matches.length) return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">{empty ?? "No matches yet."}</p>;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // An event's own schedule: Qualifications / Playoffs headings. A list across events (the caller passes
  // eventNames: a team's season): a heading per event, in the list's own order, even when only one shows.
  const oneEvent = !eventNames && new Set(matches.map((m) => m.code)).size === 1;
  const groups: { key: string; title: string; date?: string; href?: string; ms: MatchView[] }[] = [];
  if (oneEvent) for (const l of ["qual", "playoff"] as const) { const ms = matches.filter((m) => m.level === l); if (ms.length) groups.push({ key: l, title: LEVEL_TITLE[l], ms }); }
  else for (const m of matches) {
    const last = groups[groups.length - 1];
    if (last?.key === m.code) last.ms.push(m);
    else groups.push({ key: m.code, title: eventNames?.[m.code] ?? m.code, date: eventDates?.[m.code], href: `/events/${m.season}/${m.code}`, ms: [m] });
  }
  const rec = highlight ? teamRecord(matches, highlight) : null;
  return (
    <div ref={box} className="space-y-2">
      {rec && rec.played > 0 && (
        <p className="text-sm text-text-muted">
          <span className="font-semibold text-accent">{highlight}</span> in these matches: <span className={cn("font-semibold", rec.w ? "text-success" : "text-text-muted")}>{rec.w} won</span> · <span className={cn("font-semibold", rec.l ? "text-destructive" : "text-text-muted")}>{rec.l} lost</span>{rec.t > 0 && <> · {rec.t} tied</>}{rec.upcoming > 0 && <> · {rec.upcoming} to play</>}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {groups.map((g, i) => (
          <section key={`${g.key}:${i}`} aria-label={g.title}>
            {(groups.length > 1 || g.href) && (g.date ? (
              // A dated event heading reads as a heading: the event's full name, then its dates (under it on phones).
              <h3 className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <Link to={g.href!} className="truncate text-sm font-semibold text-text-base hover:text-accent-text hover:underline">{g.title}</Link>
                  <span className="shrink-0 text-xs font-normal text-text-muted">{g.date}</span>
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] font-medium tabular-nums text-text-base/80">{g.ms.length}<span className="sr-only"> matches</span></span>
              </h3>
            ) : (
              <h3 className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {g.href ? <Link to={g.href} className="truncate normal-case tracking-normal text-[13px] text-text-base hover:text-accent-text hover:underline">{g.title}</Link> : g.title}
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-text-base/80">{g.ms.length}</span>
              </h3>
            ))}
            {g.ms.map((m) => <MatchRow key={id(m)} m={m} highlight={highlight} outcomeAccent={outcomeAccent} eventName={eventNames?.[m.code]} open={open.has(id(m))} onToggle={() => toggle(id(m))} />)}
          </section>
        ))}
      </div>
    </div>
  );
}

/** A team's wins, losses and ties in these matches (and how many it still has to play). Like the season
 *  record (computeSeasonStats): a match the team sat out, or played as a qualification surrogate, doesn't count. */
export function teamRecord(matches: MatchView[], team: number) {
  const r = { w: 0, l: 0, t: 0, played: 0, upcoming: 0 };
  for (const m of matches) {
    const side = m.red.teams.some((t) => t.number === team) ? m.red : m.blue.teams.some((t) => t.number === team) ? m.blue : null;
    if (!side) continue;
    const me = side.teams.find((t) => t.number === team)!;
    if (m.played && (!me.onField || (m.level === "qual" && me.surrogate))) continue;
    const other = side === m.red ? m.blue : m.red;
    if (!m.played || !side.score || !other.score) { r.upcoming++; continue; }
    r.played++;
    if (side.score.total > other.score.total) r.w++; else if (side.score.total < other.score.total) r.l++; else r.t++;
  }
  return r;
}

function CalibrationTip({ pRed }: { pRed: number }) {
  const c = useCalibration(pRed);
  if (!c) return null;
  // Always name the history it came from: a backtest must never read as live calls.
  const source = c.kind === "live" ? `${c.seasonLabel} live calls` : `${c.seasonLabel} predictions (replayed)`;
  return <span className="mt-1 block opacity-80">Track record ({source}): favourites near {Math.round(c.said * 100)}% won {Math.round(c.won * 100)}% of {c.n.toLocaleString()} matches, ties counting half.</span>;
}
