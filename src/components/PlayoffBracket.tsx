// The Playoffs tab's bracket predictor (src/shared/bracketOdds.ts): championship odds and the danger match per
// alliance, and a card per series with its call. Every alliance keeps one colour across the tab, so a card's
// "A3" and the odds row's Alliance 3 read as the same thing at a glance.
import type { ReactNode } from "react";
import { Check, Crown, Swords, Trophy } from "lucide-react";
import type { BracketAllianceOdds, BracketOdds, BracketSeriesView, BracketSlotView, MatchView } from "../shared/api";
import { BRACKET_ACCURACY } from "../shared/bracketAccuracy";
import { oddsPct, seasonLabel } from "../lib/format";
import { ConfidenceBadge, TierMark } from "./predict";
import { cn } from "./cn";

/** One hue per alliance number (chip tint, text, bar), the same in every card. */
const HUES = [
  { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
  { chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300", text: "text-sky-600 dark:text-sky-400", bar: "bg-sky-500" },
  { chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300", text: "text-violet-600 dark:text-violet-400", bar: "bg-violet-500" },
  { chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
  { chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300", text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500" },
  { chip: "bg-teal-500/15 text-teal-700 dark:text-teal-300", text: "text-teal-600 dark:text-teal-400", bar: "bg-teal-500" },
  { chip: "bg-orange-500/15 text-orange-700 dark:text-orange-300", text: "text-orange-600 dark:text-orange-400", bar: "bg-orange-500" },
  { chip: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300", text: "text-fuchsia-600 dark:text-fuchsia-400", bar: "bg-fuchsia-500" },
] as const;
const hue = (alliance: number) => HUES[(alliance - 1 + HUES.length) % HUES.length];

export function AllianceChip({ alliance, className }: { alliance: number; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", hue(alliance).chip, className)}>A{alliance}</span>;
}

function Bar({ p, alliance }: { p: number; alliance: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className={cn("block h-full rounded-full", hue(alliance).bar)} style={{ width: `${Math.max(2, Math.min(100, p * 100))}%` }} />
    </span>
  );
}

const FORMAT_TITLE: Record<BracketOdds["format"], string> = {
  double: "Double-elimination bracket", classic: "Semifinals and final", final: "Final", unknown: "Playoff series",
};

/** The measured accuracy every prediction surface carries: the walk-forward replay of past playoffs. */
export function BracketAccuracyNote() {
  const a = BRACKET_ACCURACY, s = BRACKET_ACCURACY.series;
  const seasons = a.seasons.length > 1 ? `${seasonLabel(a.seasons[0])} to ${seasonLabel(a.seasons[a.seasons.length - 1])}` : seasonLabel(a.seasons[0]);
  return (
    <p className="text-xs text-muted-foreground">
      Measured on {s.n.toLocaleString()} past playoff series ({seasons}, replayed with only what was known before each one): the favourite won{" "}
      <span className="font-semibold text-success">{Math.round(s.accuracy * 100)}%</span>, Brier score <span className="font-semibold text-foreground tabular-nums">{s.brier.toFixed(3)}</span>.
    </p>
  );
}

/** One alliance's championship odds, final odds and danger match, around its team chips. */
export function AllianceOddsCard({ odds, children }: { odds: BracketAllianceOdds | undefined; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 max-sm:p-3", odds?.status === "champion" && "border-accent/60 bg-accent/[0.06]", odds?.status === "out" && "opacity-75")}>
      {children}
      {odds && (
        <div className="mt-3">
          {odds.status === "champion" ? (
            <p className="flex items-center gap-1.5 font-display text-lg font-semibold text-accent-text"><Crown className="size-4" aria-hidden /> Champions</p>
          ) : odds.status === "out" ? (
            <p className="text-sm text-muted-foreground">Out of the playoffs</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">Wins the event</span>
                <span className={cn("font-display text-2xl font-semibold tabular-nums leading-none", hue(odds.alliance).text)}>{oddsPct(odds.pChampion)}</span>
              </div>
              <div className="mt-1.5"><Bar p={odds.pChampion} alliance={odds.alliance} /></div>
              <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">Reaches the final {oddsPct(odds.pFinal)}</p>
              {odds.danger && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                  <Swords className="size-3.5 shrink-0 text-warning" aria-hidden />
                  <span>Danger match: {odds.danger.label} vs <AllianceChip alliance={odds.danger.opponent} className="px-1 py-0 text-[11px]" /> <span className="text-muted-foreground">· wins it {oddsPct(odds.danger.pWin)}</span></span>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SlotRow({ slot, wins, won, bestOf }: { slot: BracketSlotView; wins: number; won: boolean | null; bestOf: number }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      {slot.alliance != null ? <AllianceChip alliance={slot.alliance} /> : <span className="text-xs text-muted-foreground">{slot.source}</span>}
      {slot.alliance == null && slot.likely && <span className="text-xs text-muted-foreground">likely <AllianceChip alliance={slot.likely.alliance} className="px-1 py-0 text-[11px]" /> {oddsPct(slot.likely.p)}</span>}
      <span className="ml-auto flex items-center gap-1 text-sm tabular-nums">
        {won && <Check className="size-3.5 text-success" aria-label="won" />}
        {bestOf > 1 && slot.alliance != null && <span className={cn(won ? "font-semibold" : "text-muted-foreground")}>{wins}</span>}
      </span>
    </div>
  );
}

/** One series: its sides, score and call, then its matches' scores. */
export function SeriesCard({ s, matches, final }: { s: BracketSeriesView; matches: MatchView[]; final: boolean }) {
  const decided = s.winner != null;
  return (
    <div className={cn("rounded-xl border border-border bg-card p-3", final && "border-accent/40", s.skipped && "opacity-60")}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="text-foreground">{s.label}</span> · {s.stage}
        {s.bestOf > 1 && <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[11px]">Best of {s.bestOf}</span>}
      </p>
      <div className="mt-2 space-y-1">
        <SlotRow slot={s.red} wins={s.wins[0]} won={decided ? s.winner === s.red.alliance : null} bestOf={s.bestOf} />
        <SlotRow slot={s.blue} wins={s.wins[1]} won={decided ? s.winner === s.blue.alliance : null} bestOf={s.bestOf} />
      </div>
      <div className="mt-2 border-t border-border pt-2 text-xs">
        {decided ? (
          <p className="flex items-center gap-1.5"><Trophy className="size-3.5 text-accent" aria-hidden /> <AllianceChip alliance={s.winner!} /> won the series</p>
        ) : s.skipped ? (
          <p className="text-muted-foreground">Not needed: the upper-bracket alliance won the grand final.</p>
        ) : s.pending ? (
          <p className="text-muted-foreground">Played only if the lower-bracket alliance wins the grand final.</p>
        ) : s.call ? (
          <div>
            <p className="flex flex-wrap items-center gap-1.5">
              <AllianceChip alliance={s.call.alliance} /> <span>favoured</span>
              <span className="font-display text-base font-semibold tabular-nums">{oddsPct(s.call.p)}</span>
              <TierMark tier={s.call.tier} className="ml-auto text-[11px]" />
            </p>
            <div className="mt-1.5"><Bar p={s.call.p} alliance={s.call.alliance} /></div>
          </div>
        ) : s.likely ? (
          <p className="flex items-center gap-1.5 text-muted-foreground">Likeliest winner <AllianceChip alliance={s.likely.alliance} /> <span className="font-semibold text-foreground tabular-nums">{oddsPct(s.likely.p)}</span></p>
        ) : (
          <p className="text-muted-foreground">Waiting on the alliances</p>
        )}
      </div>
      {matches.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {matches.map((m) => (
            <p key={m.key} className="text-xs tabular-nums text-muted-foreground">{m.label}: {m.played && m.red.score && m.blue.score ? <><span className="text-red-alliance">{m.red.score.total}</span>–<span className="text-blue-alliance">{m.blue.score.total}</span></> : "not played yet"}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** The bracket's heading, its tier and the series cards. */
export function BracketSeries({ bracket, bySeries }: { bracket: BracketOdds; bySeries: Map<number, MatchView[]> }) {
  const last = bracket.series.filter((s) => !s.ifNeeded).at(-1)?.index;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{FORMAT_TITLE[bracket.format]}</h3>
      </div>
      {bracket.note && <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{bracket.note}</p>}
      {bracket.series.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {bracket.series.map((s) => <SeriesCard key={s.index} s={s} matches={bySeries.get(s.series) ?? []} final={s.index === last && bracket.format !== "unknown"} />)}
        </div>
      ) : <p className="text-sm text-muted-foreground">No playoff series posted yet.</p>}
    </div>
  );
}

/** "Championship odds" heading with the tier the odds rest on. */
export function OddsHeading({ bracket }: { bracket: BracketOdds }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-base font-semibold">Championship odds</h3>
      <ConfidenceBadge tier={bracket.tier} />
      <span className="text-xs text-muted-foreground">{bracket.runs.toLocaleString()} simulated playoffs</span>
    </div>
  );
}
