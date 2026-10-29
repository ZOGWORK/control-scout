// Prediction UI shared by every surface. Rule: a prediction is never shown
// without its confidence tier, and never presented as a fact.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { m as Motion } from "./motion";
import { Link, useLocation } from "react-router-dom";
import { Check, ChevronDown, CircleDashed, ClipboardList, Gauge, Handshake, History, PlayCircle, Radio, ShieldCheck, Video, X } from "lucide-react";
import type { AllianceScore, ConfidenceTier, Factor, MatchPredictionView, MatchView, PairHistory } from "../shared/api";
import { matchReportHref } from "../shared/matchReport";
import { cn } from "./cn";
import { ClipLink } from "./MatchClip";
import { ScoreRange } from "./ScoreRange";
import { levelPct, predictedText } from "../shared/scoreRange";
import { Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from "./ui/overlay";
import { matchTime, oddsPct } from "../lib/format";
import { useVideoLinkCount } from "./MatchVideo";
import { restoredSavedPosition, scrollToElement, smoothBehavior } from "../lib/pageScroll";

const MatchDetails = lazy(() => import("./MatchDetails").then((x) => ({ default: x.MatchDetails })));
import { useCalibration } from "../lib/calibration";
import { usePredictable } from "../lib/meta";
import { TIER_WORD, tierPhrase } from "../shared/tierWords";
import { factorLabel } from "../lib/factorLabel";
import { TeamSnack, TeamSnackContext, nameIn, useTeamSnack, useTeamSnackState } from "./TeamSnack";
import { hasTeamPage } from "../shared/teamPages";

const TIER: Record<ConfidenceTier, { label: string; cls: string; icon: typeof Gauge; blurb: string }> = {
  provisional: { label: TIER_WORD.provisional, cls: "border-warning/40 bg-warning/10 text-warning", icon: CircleDashed, blurb: "Mostly prior-season data — treat as a rough guess." },
  moderate: { label: TIER_WORD.moderate, cls: "border-info/40 bg-info/10 text-info", icon: Gauge, blurb: "Some matches this season; still settling." },
  confident: { label: TIER_WORD.confident, cls: "border-success/40 bg-success/10 text-success", icon: ShieldCheck, blurb: "Every robot has a real sample this season." },
};

export function ConfidenceBadge({ tier, reason, className }: { tier: ConfidenceTier; reason?: string; className?: string }) {
  const t = TIER[tier];
  const badge = (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap [&_svg]:size-3", t.cls, className)}>
      <t.icon aria-hidden /> <span className="sr-only">Confidence: </span>{t.label}
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
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap [&_svg]:size-3", chip ? cn(STATUS_CHIP, "border", t.cls) : color, className)} title={`Confidence: ${t.label.toLowerCase()}. ${t.blurb}`}>
      <t.icon aria-hidden /><span className="sr-only">confidence: </span>{t.label.toLowerCase()}
    </span>
  );
}

/** The tier as its icon alone, for a match row where the word would take a team name's room: the icon and its
 *  colour still mark every call, and a tap (or Enter) opens the tier's name and what it means. */
export function TierIcon({ tier }: { tier: ConfidenceTier }) {
  const t = TIER[tier];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(STATUS_CHIP, "w-[18px] justify-center border px-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-3", t.cls)} data-tier={tier}>
          <t.icon aria-hidden /><span className="sr-only">Confidence: {t.label.toLowerCase()}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 text-sm" align="end">
        <p className={cn("flex items-center gap-1.5 font-semibold [&_svg]:size-3.5", t.cls.split(" ").find((c) => c.startsWith("text-")))}><t.icon aria-hidden />Confidence: {t.label.toLowerCase()}</p>
        <p className="mt-1 text-text-muted">{t.blurb}</p>
        <Link to="/methodology#confidence" className="mt-2 inline-block text-xs underline">How tiers work</Link>
      </PopoverContent>
    </Popover>
  );
}

/** Red vs blue win probability bar. */
/** `decorative`: the odds are already in words beside it (e.g. inside a button), so the bar stays out of the
 *  accessibility tree instead of saying them twice. */
export function WinBar({ pRed, className, size = "md", decorative }: { pRed: number; className?: string; size?: "sm" | "md"; decorative?: boolean }) {
  const r = Math.max(0.02, Math.min(0.98, pRed));
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full bg-muted", size === "sm" ? "h-1.5" : "h-2.5", className)}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `Red ${oddsPct(pRed)} to win, blue ${oddsPct(1 - pRed)}` })}>
      <div className="h-full bg-red-alliance transition-[width] duration-500" style={{ width: `${r * 100}%` }} />
      <div className="h-full flex-1 bg-blue-alliance" />
    </div>
  );
}

/** The top factors, then any notable reasons from the engine (recent no-shows…), which never move the odds. */
export function FactorList({ factors, reasons, className }: { factors: Factor[]; reasons?: string[]; className?: string }) {
  return (
    <ol className={cn("space-y-1.5", className)}>
      {factors.map((f, i) => (
        <li key={f.id} className="flex gap-2 text-sm">
          <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
            f.favors === "A" ? "bg-red-alliance/15 text-red-alliance" : f.favors === "B" ? "bg-blue-alliance/15 text-blue-alliance" : "bg-muted text-text-muted")}>{i + 1}</span>
          <span className="text-text-base">{factorLabel(f.label)}</span>
        </li>
      ))}
      {reasons?.map((r) => (
        <li key={r} className="flex gap-2 text-sm" data-testid="reason">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-warning/15 text-[11px] font-bold text-warning" aria-hidden>!</span>
          <span className="text-text-base">{r}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Earlier matches between these robots (engine 2.4 partnership memory): a real
 * result, shown as a reason next to the factors. It isn't one of them (the
 * factors split the predicted margin exactly; this history doesn't move it).
 */
export function PairHistoryLine({ history, className }: { history: PairHistory; className?: string }) {
  const tone = history.kind === "against" ? "bg-muted text-text-muted" : history.side === "A" ? "bg-red-alliance/15 text-red-alliance" : "bg-blue-alliance/15 text-blue-alliance";
  return (
    <p className={cn("flex gap-2 text-sm", className)}>
      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", tone)} aria-hidden="true"><Handshake className="size-3" /></span>
      <span className="text-text-base"><span className="sr-only">Earlier matches: </span>{history.label}</span>
    </p>
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

type Side = "red" | "blue";

/** A team in an alliance box: its number, its name under it. In a match list a tap opens the team card
 *  (TeamSnack) and marks the team in every row; elsewhere it links to the team page. */
function TeamChip({ t, side, season, highlight }: { t: AllianceScore["teams"][number]; side: Side; season: number; highlight?: number }) {
  const snack = useTeamSnack();
  const n = t.number, sub = t.surrogate || !t.onField;
  const me = n === highlight, picked = snack?.team === n;
  const cls = cn("flex min-w-0 flex-col rounded-md px-1.5 py-0.5 text-left leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
    side === "blue" && "@min-[330px]:items-end @min-[330px]:text-right",
    picked ? (side === "red" ? "bg-red-alliance/30 ring-1 ring-red-alliance/70" : "bg-blue-alliance/30 ring-1 ring-blue-alliance/70")
      : me ? "bg-accent/15 ring-1 ring-accent/60" : "still-hover:bg-text-base/[0.06]");
  const body = (
    <>
      <span className={cn("tabular font-mono text-[0.8125rem]", me ? "font-bold text-accent-text" : picked ? "font-bold text-text-base" : sub ? "text-text-muted" : "text-text-base")}>{n}</span>
      {/* The space keeps number and name apart in the text, so the button's label ("207 Critical Mass: …") contains it (WCAG 2.5.3). */}
      {t.name && <>{" "}<span className={cn("block max-w-full truncate text-[11px] italic", picked || me ? "text-text-base" : "text-text-muted")} data-team-name>{t.name}</span></>}
      {sub && <span className="sr-only"> (surrogate)</span>}
    </>
  );
  const title = sub ? `${n} (surrogate or didn't play)` : t.name;
  // A placeholder ("Off-Season Demo Team", a stand-in number): no page and no card, so plain text.
  if (!hasTeamPage(n, t.name)) return <span title={title} className={cls}>{body}</span>;
  return snack
    ? <button type="button" onClick={() => snack.toggle(n)} aria-pressed={picked} aria-label={`${n}${t.name ? ` ${t.name}` : ""}${sub ? " (surrogate)" : ""}: show team card`} title={title} className={cls}>{body}</button>
    : <Link to={`/teams/${n}?season=${season}`} title={title} className={cn(cls, "still-hover:underline")}>{body}</Link>;
}

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

/** The loser's score (and a predicted one) fades back: the alliance colour mixed toward muted text rather than
 *  made transparent, so it still reads at 4.5:1 on the box in both themes. */
const FADED: Record<Side, string> = {
  red: "text-[color-mix(in_srgb,var(--color-red-alliance-text)_55%,var(--color-text-muted))]",
  blue: "text-[color-mix(in_srgb,var(--color-blue-alliance-text)_55%,var(--color-text-muted))]",
};

/** One alliance: its teams and score in one tinted box. The winner's box is stronger; the loser's fades back. */
function AllianceBox({ side, m, score, forecast, outcome, highlight }: {
  side: Side; m: MatchView; score: number | null; forecast: { mean: number; range?: [number, number]; level?: number } | null; outcome: "win" | "loss" | "tie" | null; highlight?: number;
}) {
  const a = m[side];
  const flash = useChangeCount(score);
  return (
    <div className={cn(
      // Narrow rows: one line per alliance, teams then score. Wider rows (the row's own width): the two boxes face each other, scores in the middle.
      "flex min-w-0 items-center justify-between gap-2 rounded-lg border-l-[3px] px-2 py-1.5",
      side === "red" ? "border-red-alliance bg-red-alliance/[0.06]" : "border-blue-alliance bg-blue-alliance/[0.06] @min-[330px]:flex-row-reverse @min-[330px]:border-l-0 @min-[330px]:border-r-[3px]",
      outcome === "win" && (side === "red" ? "bg-red-alliance/[0.14]" : "bg-blue-alliance/[0.14]"),
    )}>
      {/* The teams share the box's width (a playoff alliance of three included), each name truncated to its share. */}
      <div className="grid min-w-0 flex-1 auto-cols-fr grid-flow-col gap-x-1">
        {a.teams.map((t) => <TeamChip key={t.number} t={t} side={side} season={m.season} highlight={highlight} />)}
      </div>
      {score != null ? (
        <span key={flash} className={cn("shrink-0 font-display text-lg font-bold tabular-nums", flash > 0 && "cs-score-flash -mx-1 px-1", outcome === "loss" ? FADED[side] : side === "red" ? "text-red-alliance" : "text-blue-alliance")}>
          {score}{outcome === "win" && <span className="sr-only"> (won)</span>}
        </span>
      ) : forecast != null ? (
        forecast.range
          ? <span className={cn("shrink-0 whitespace-nowrap font-display text-base font-semibold", FADED[side])}><span className="sr-only">Predicted score </span><ScoreRange mean={forecast.mean} range={forecast.range} level={forecast.level} pmClassName="text-[11px] font-medium" /></span>
          : <span className={cn("shrink-0 font-display text-base font-semibold tabular-nums", FADED[side])} title="Predicted score">~{Math.round(forecast.mean)}</span>
      ) : null}
    </div>
  );
}

/** One match: two alliance boxes facing each other, then the call in plain words.
 *  Click the row (anywhere but a link or button) to open its details in place. */
/** `showEvent` replaces the time under the label; `eventName` only names the event inside the details. */
/** `outcomeAccent`: the highlighted team's rows get a left edge in its result's colour (green won, red lost) instead of gold. */
/** `live`: the match being played now; its row stands forward (index.css .match-list) until another row is hovered. */
export function MatchRow({ m, highlight, showEvent, eventName, open, onToggle, outcomeAccent, live }: { m: MatchView; highlight?: number; showEvent?: string; eventName?: string; open?: boolean; onToggle?: () => void; outcomeAccent?: boolean; live?: boolean }) {
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
  const forecast = !scored && p && !p.noScoreBasis
    ? { red: { mean: p.redMean, range: p.redRange, level: p.rangeLevel }, blue: { mean: p.blueMean, range: p.blueRange, level: p.rangeLevel } }
    : null;
  const fav: Side | null = p ? (p.pRed >= 0.5 ? "red" : "blue") : null;
  const missing = [m.red, m.blue].some((a) => a.teams.filter((t) => t.onField).length !== 2);
  const when = showEvent ?? matchTime(m.time);
  const predictable = usePredictable(m.season); // 2019–2022: history only, so no "No call" on every row
  return (
    // @container: the row lays itself out by its own width (an event's tab, a team's season, a narrow drawer), not the window's.
    <div className={cn("@container border-b border-border last:border-b-0", mySide && "relative before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
      mySide && (outcomeAccent && mine === "win" ? "before:bg-success" : outcomeAccent && mine === "loss" ? "before:bg-destructive" : "before:bg-accent/70"), live && "scroll-mt-bar-2")} data-match={m.key} data-live={live || undefined}>
    <div
      // Narrow rows: the label keeps at least its own width (time, the team's won/lost chip), and the call's
      // chips wrap under it instead of pushing into the label.
      // Hover (here, on the label and on the row's links) never fires mid-scroll: a shield takes the pointer
      // while the page scrolls (index.css .scroll-shield). Otherwise every row sliding under a resting pointer
      // lights up and the long list repaints. The hover fades the background only.
      className={cn("group/row density-row grid grid-cols-[minmax(min-content,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 px-3 py-3 transition-[background-color]",
        // Wide rows: label | red | blue | the call | report. Fixed tracks either side, so every row lines up.
        "@3xl:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_11.5rem_2rem]",
        onToggle ? "cursor-pointer still-hover:bg-accent/[0.07]" : "still-hover:bg-text-base/[0.03]", open && "bg-accent/[0.05]")}
      onClick={onToggle ? (e) => { if (!(e.target as HTMLElement).closest("a, button, input")) onToggle(); } : undefined}
      data-row
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 @3xl:block" data-match-label>
        {onToggle ? (
          <button type="button" onClick={onToggle} aria-expanded={!!open} aria-controls={detailsId} aria-label={`${m.label} details`} className={cn("flex items-center gap-0.5 rounded font-mono text-sm font-semibold outline-none row-still-hover:text-accent-text focus-visible:ring-2 focus-visible:ring-ring/60", open && "text-accent-text")}>
            {m.label}<ChevronDown className={cn("size-3.5 text-text-muted transition-transform row-still-hover:text-accent-text", open && "rotate-180 text-accent-text")} />
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
      {/* Narrow rows: the alliances sit under the label line (stacked, then facing each other from a 390 px phone up (a 330 px row)). */}
      <div className="col-span-3 row-start-2 grid gap-1 @min-[330px]:grid-cols-2 @min-[330px]:gap-1.5 @3xl:col-span-2 @3xl:col-start-2 @3xl:row-start-1" data-alliances>
        <AllianceBox side="red" m={m} score={red} forecast={forecast?.red ?? null} outcome={outcome("red")} highlight={highlight} />
        <AllianceBox side="blue" m={m} score={blue} forecast={forecast?.blue ?? null} outcome={outcome("blue")} highlight={highlight} />
      </div>
      {/* The call, in its own track so it never runs into the blue box: line 1 the pick and its bar, line 2 small status chips. */}
      <div className="col-start-2 row-start-1 flex min-w-0 flex-col items-end gap-1 text-right @3xl:col-start-4" data-call>
        {p && fav ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="flex items-center gap-1.5 whitespace-nowrap rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                {/* The name is the text ("Picked Red 58%"). Under 20rem of row the word is only for screen readers: the
                    label needs the room. The bar repeats the number, so it's hidden from them here. */}
                <span className="text-text-muted @max-xs:sr-only">Picked</span>{" "}
                <span className={cn("font-semibold tabular-nums", fav === "red" ? "text-red-alliance" : "text-blue-alliance")}>{fav === "red" ? "Red" : "Blue"} {oddsPct(fav === "red" ? p.pRed : 1 - p.pRed)}</span>
                <WinBar pRed={p.pRed} size="sm" className="w-12 shrink-0" decorative />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {KIND_LABEL[p.kind]} · {p.noScoreBasis ? "no predicted score: when this call was made, the season had no rated matches yet" : `predicted ${predictedText(p)}${p.redRange ? ` (± is the ${levelPct(p.rangeLevel)} range)` : ""}`} · {tierPhrase(p.tier)}
              {p.factors?.length ? <span className="mt-1 block opacity-80">{factorLabel(p.factors[0].label)}</span> : null}
              <CalibrationTip pRed={p.pRed} />
            </TooltipContent>
          </Tooltip>
        ) : (
          !predictable ? null : <span className="whitespace-nowrap text-xs text-text-muted" title={missing && m.played ? "An alliance played with one robot. The engine predicts full 2-against-2 matches only." : undefined}>
            {m.played ? (missing ? "No call · a robot sat out" : "No call") : m.red.teams.length > 2 || m.blue.teams.length > 2 ? "Lineup TBD" : "—"}
          </span>
        )}
        {(p || m.video || m.clip || videos > 0) && (
          <div className="flex flex-wrap items-center justify-end gap-1 text-[11px] text-text-muted" data-call-status>
            {/* Right and Upset share one width, so the chips after them line up from row to row. */}
            {called === true && <span className={cn(STATUS_CHIP, "min-w-[3.25rem] justify-center bg-success/12 text-success")} data-outcome="right"><Check className="size-3" aria-hidden /> Right</span>}
            {called === false && <span className={cn(STATUS_CHIP, "min-w-[3.25rem] justify-center bg-warning/12 text-warning")} data-outcome="upset"><X className="size-3" aria-hidden /> Upset</span>}
            {p && <TierIcon tier={p.tier} />}
            {/* Which ledger a played match's call came from, as an icon chip (a word never fits beside the others): the words
                stay in its title and for screen readers. Live and replayed calls are never blended, so both are marked. */}
            {p && m.played && (p.kind === "live" || p.kind === "backtest") && (
              <span className={cn(STATUS_CHIP, "bg-muted text-text-muted")} title={`${p.kind === "live" ? "Pre-match" : "Replayed"}: ${KIND_LABEL[p.kind]}`} data-kind={p.kind}>
                {p.kind === "live" ? <Radio className="size-3" aria-hidden /> : <History className="size-3" aria-hidden />}
                <span className="sr-only">{p.kind === "live" ? "pre-match" : "replayed"}: {KIND_LABEL[p.kind]}</span>
              </span>
            )}
            {m.clip && <ClipLink clip={m.clip} className={cn(STATUS_CHIP, "bg-[#ff0033]/12 text-[#ff4d6d] still-hover:bg-[#ff0033]/20")}><span className="text-[10px]">Watch</span></ClipLink>}
            {m.video && <a href={m.video} target="_blank" rel="noreferrer noopener" className={cn(STATUS_CHIP, "still-hover:text-text-base")} aria-label="Official match video"><PlayCircle className="size-3.5" /></a>}
            {videos > 0 && <span className={cn(STATUS_CHIP, "text-accent-text")} title={`${videos} saved video link${videos > 1 ? "s" : ""}`}><Video className="size-3.5" /><span className="text-[10px]">{videos}</span></span>}
          </div>
        )}
      </div>
      {/* One tap to the pre-match scouting report (v1.6 Task 2): an icon button in its own track, so it never takes the
          call's width. 32px to look at, 40px to tap (the ::after). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to={matchReportHref(m)} className="relative col-start-3 row-start-1 inline-flex size-8 items-center justify-center justify-self-end rounded-md border border-accent bg-card text-text-muted outline-none transition-colors after:absolute after:-inset-1 still-hover:bg-accent-soft still-hover:text-accent-text focus-visible:ring-2 focus-visible:ring-ring/60 @3xl:col-start-5" aria-label={`Pre-match report for ${m.label}`} data-report-link>
            <ClipboardList className="size-4" aria-hidden />
          </Link>
        </TooltipTrigger>
        <TooltipContent>Know your match: the pre-match report for {m.label}</TooltipContent>
      </Tooltip>
    </div>
    {/* Details unfold under the row (height + fade); instant with "reduce motion". */}
    <AnimatePresence initial={false}>
      {open && (
        <Motion.div id={detailsId} key="details" className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={reduce ? { duration: 0 } : { height: { duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }, opacity: { duration: 0.18 } }}>
          <Suspense fallback={<div className="border-t border-border p-4"><div className="skeleton h-40 rounded-xl" /></div>}>
            <MatchDetails m={m} eventName={eventName ?? showEvent} />
          </Suspense>
        </Motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}

const PHONE = "(max-width: 767px)";

/** The row under the mouse, marked `data-focus` (it stands forward: index.css .match-list). Not :hover, which the
 *  scroll shield takes away while the page scrolls: this follows the pointer through a scroll too, and through the
 *  list changing size under a still pointer (details opening, a live refresh), checking the point under it once a
 *  frame at most and changing only the row it leaves and the row it reaches. */
/** `shown`: whether the list box is rendered (an empty list renders a note instead), so a box that comes back is watched again. */
function usePointerRow(box: RefObject<HTMLDivElement | null>, shown: boolean) {
  // Where the mouse rests, kept across a re-watch (the list coming back after a filter) so a still pointer is found again.
  const at = useRef({ x: -1, y: -1 });
  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover)").matches) return;
    const p = at.current;
    let frame = 0;
    let cur: Element | null = null;
    const mark = (row: Element | null) => {
      if (row === cur) return;
      cur?.removeAttribute("data-focus");
      row?.setAttribute("data-focus", "");
      cur = row;
    };
    const check = () => {
      frame = 0;
      const list = box.current;
      if (!list || p.x < 0) return mark(null);
      // elementsFromPoint, not elementFromPoint: mid-scroll the shield is on top.
      const row = document.elementsFromPoint(p.x, p.y).map((e) => e.closest("[data-row]")).find((r) => r && list.contains(r));
      mark(row ?? null);
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(check); };
    const move = (e: PointerEvent) => { if (e.pointerType !== "mouse") return; p.x = e.clientX; p.y = e.clientY; queue(); };
    const leave = () => { p.x = -1; queue(); };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("scroll", queue, { passive: true, capture: true });
    document.documentElement.addEventListener("pointerleave", leave);
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(queue);
    if (box.current) resized?.observe(box.current);
    queue();
    return () => {
      resized?.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", queue, { capture: true });
      document.documentElement.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(frame);
      mark(null);
    };
  }, [box, shown]);
}

const LEVEL_TITLE: Record<MatchView["level"], string> = { qual: "Qualifications", playoff: "Playoffs" };

/** Schedule order: quals before playoffs, then series and number. */
const scheduleOrder = (a: MatchView, b: MatchView) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number;

/** Matches in one column, in schedule order (Q1, Q2, …; never by start time, so a replayed or late match keeps its place), under Qualifications / Playoffs headings, each opening its details
 *  in place. `initialOpen` (a match key, e.g. from ?match=) opens that one and scrolls it into view.
 *  With `highlight`, a summary line gives that team's record in the matches shown.
 *  `eventDates` (by event code, with `eventNames`) puts each event's dates in its heading; `outcomeAccent`: see MatchRow.
 *  `newestFirst`: each event's matches from the last one back (recent results).
 *  `live` (a match key): the match being played now. Its row stands forward, and on a phone the list opens on it. */
export function MatchList({ matches, highlight, empty, eventNames, eventDates, initialOpen, outcomeAccent, live, newestFirst }: { matches: MatchView[]; highlight?: number; empty?: string; eventNames?: Record<string, string>; eventDates?: Record<string, string>; initialOpen?: string | null; outcomeAccent?: boolean; live?: string | null; newestFirst?: boolean }) {
  const id = (m: MatchView) => `${m.code}:${m.key}`;
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // The team whose card is open (a tap on a team in any row): a second tap on it closes the card.
  const [snack, setSnack] = useTeamSnackState();
  const snackCtx = useMemo(() => ({ team: snack, toggle: (t: number) => setSnack((x) => (x === t ? null : t)) }), [snack, setSnack]);
  const closeSnack = useCallback(() => setSnack(null), [setSnack]);
  const box = useRef<HTMLDivElement>(null);
  // The match a link asked for is brought into view once per visit (history entry): a live update that
  // adds matches to the list must not pull the page back to it after the reader has scrolled on, and
  // nor may Back/Forward, which return to where the reader actually was (src/lib/pageScroll.ts).
  const loc = useLocation();
  usePointerRow(box, matches.length > 0);
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    const visit = `${loc.key}:${initialOpen}`;
    if (!initialOpen || shownFor.current === visit) return;
    const m = matches.find((x) => x.key === initialOpen);
    if (!m) return;
    shownFor.current = visit;
    setOpen((s) => (s.has(id(m)) ? s : new Set(s).add(id(m))));
    if (restoredSavedPosition(loc)) return;
    requestAnimationFrame(() => { const row = box.current?.querySelector(`[data-match="${CSS.escape(m.key)}"]`); if (row) scrollToElement(row, smoothBehavior()); });
    // Only when the requested match or the visit changes (not on every refresh of the list).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpen, loc.key, matches.length]);
  // On a phone (no hover to bring a row forward) the list opens on the live match, at the top of the screen,
  // at once. Once per visit, like a linked match: the next match going live never pulls the reader back.
  const liveShownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!live || initialOpen || liveShownFor.current === loc.key) return;
    if (!window.matchMedia?.(PHONE).matches) return;
    liveShownFor.current = loc.key;
    if (restoredSavedPosition(loc)) return;
    requestAnimationFrame(() => { const row = box.current?.querySelector(`[data-match="${CSS.escape(live)}"]`); if (row) scrollToElement(row); });
    // Only when the live match first shows in a visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, loc.key]);
  if (!matches.length) return <p className="rounded-xl border border-dashed border-border px-4 py-8 max-sm:py-5 text-center text-sm text-text-muted">{empty ?? "No matches yet."}</p>;
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
  // The API lists matches by start time; each group reads in schedule order instead (newest first for a
  // list of recent results, which says so: guessing from the order given breaks on a match played out of turn).
  for (const g of groups) {
    g.ms = [...g.ms].sort((a, b) => (newestFirst ? -1 : 1) * scheduleOrder(a, b));
  }
  const rec = highlight ? teamRecord(matches, highlight) : null;
  return (
    <TeamSnackContext.Provider value={snackCtx}>
    <div ref={box} className="match-list space-y-2">
      {rec && rec.played > 0 && (
        <p className="text-sm text-text-muted">
          <span className="font-semibold text-accent-text">{highlight}</span> in these matches: <span className={cn("font-semibold", rec.w ? "text-success" : "text-text-muted")}>{rec.w} won</span> · <span className={cn("font-semibold", rec.l ? "text-destructive" : "text-text-muted")}>{rec.l} lost</span>{rec.t > 0 && <> · {rec.t} tied</>}{rec.upcoming > 0 && <> · {rec.upcoming} to play</>}
        </p>
      )}
      {/* Not overflow-hidden: a row standing forward (index.css .match-list) reaches past the box's sides. */}
      <div className="rounded-xl border border-border bg-card" data-match-box>
        {groups.map((g, i) => (
          <section key={`${g.key}:${i}`} aria-label={g.title}>
            {(groups.length > 1 || g.href) && (g.date ? (
              // A dated event heading reads as a heading: the event's full name, then its dates (under it on phones).
              <h3 className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <Link to={g.href!} className="truncate text-base font-semibold text-text-base hover:text-accent-text hover:underline">{g.title}</Link>
                  <span className="shrink-0 text-xs font-normal text-text-muted">{g.date}</span>
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] font-medium tabular-nums text-text-base/80">{g.ms.length}<span className="sr-only"> matches</span></span>
              </h3>
            ) : (
              <h3 className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {g.href ? <Link to={g.href} className="truncate normal-case tracking-normal text-base text-text-base hover:text-accent-text hover:underline">{g.title}</Link> : g.title}
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-text-base/80">{g.ms.length}</span>
              </h3>
            ))}
            {g.ms.map((m) => <MatchRow key={id(m)} m={m} highlight={highlight} outcomeAccent={outcomeAccent} eventName={eventNames?.[m.code]} open={open.has(id(m))} onToggle={() => toggle(id(m))} live={!!live && m.key === live} />)}
          </section>
        ))}
      </div>
    </div>
    <TeamSnack team={snack} season={matches[0].season} name={snack != null ? nameIn(matches, snack) : undefined}
      code={oneEvent ? matches[0].code : undefined} record={snack != null ? teamRecord(matches, snack) : null} onClose={closeSnack} />
    </TeamSnackContext.Provider>
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
