// The Playoffs tab's bracket predictor (src/shared/bracketOdds.ts): championship odds and the danger match per
// alliance, and a card per series with its call. Every alliance keeps one colour across the tab, so a card's
// "A3" and the odds row's Alliance 3 read as the same thing at a glance.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Crown, Swords, Trophy } from "lucide-react";
import type { BracketAllianceOdds, BracketOdds, BracketSeriesView, BracketSlotView, MatchView } from "../shared/api";
import { BRACKET_ACCURACY } from "../shared/bracketAccuracy";
import { oddsPct, seasonLabel } from "../lib/format";
import { bracketLayout, type BracketLayout } from "../lib/bracketLayout";
import { ConfidenceBadge, TierMark } from "./predict";
import { cn } from "./cn";
import { PredictionBasis } from "./PredictionBasis";

/** One hue per alliance number (chip tint, text, bar), the same in every card. Chip text reaches 4.5:1 on its tint in both themes (textTones.test.ts). */
export const ALLIANCE_HUES = [
  { chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300", text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
  { chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300", text: "text-sky-600 dark:text-sky-400", bar: "bg-sky-500" },
  { chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300", text: "text-violet-600 dark:text-violet-400", bar: "bg-violet-500" },
  { chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
  { chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300", text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500" },
  { chip: "bg-teal-500/15 text-teal-700 dark:text-teal-300", text: "text-teal-600 dark:text-teal-400", bar: "bg-teal-500" },
  { chip: "bg-orange-500/15 text-orange-800 dark:text-orange-300", text: "text-orange-600 dark:text-orange-400", bar: "bg-orange-500" },
  { chip: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300", text: "text-fuchsia-600 dark:text-fuchsia-400", bar: "bg-fuchsia-500" },
] as const;
const hue = (alliance: number) => ALLIANCE_HUES[(alliance - 1 + ALLIANCE_HUES.length) % ALLIANCE_HUES.length];

/** `muted`: a series' loser, in neutral grey rather than faded (a faded chip fell under 4.5:1). */
export function AllianceChip({ alliance, className, muted }: { alliance: number; className?: string; muted?: boolean }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", muted ? "bg-muted text-muted-foreground" : hue(alliance).chip, className)}>A{alliance}</span>;
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
    <>
    <PredictionBasis kind="bracket" />
    <p className="text-xs text-muted-foreground">
      Measured on {s.n.toLocaleString()} past playoff series ({seasons}, replayed with only what was known before each one): the favourite won{" "}
      <span className="font-semibold text-success">{Math.round(s.accuracy * 100)}%</span>, Brier score <span className="font-semibold text-foreground tabular-nums">{s.brier.toFixed(3)}</span>.
    </p>
    </>
  );
}

/** One alliance's championship odds, final odds and danger match, around its team chips. */
export function AllianceOddsCard({ odds, children }: { odds: BracketAllianceOdds | undefined; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 max-sm:p-3", odds?.status === "champion" && "border-accent/60 bg-accent/[0.06]", odds?.status === "out" && "border-dashed bg-transparent")}>
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

function SlotRow({ slot, wins, bestOf }: { slot: BracketSlotView; wins: number; bestOf: number }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      {slot.alliance != null ? <AllianceChip alliance={slot.alliance} /> : <span className="text-xs text-muted-foreground">{slot.source}</span>}
      {slot.alliance == null && slot.likely && <span className="text-xs text-muted-foreground">likely <AllianceChip alliance={slot.likely.alliance} className="px-1 py-0 text-[11px]" /> {oddsPct(slot.likely.p)}</span>}
      <span className="ml-auto flex items-center gap-1 text-sm tabular-nums">
        {bestOf > 1 && slot.alliance != null && <span className="font-semibold">{wins}</span>}
      </span>
    </div>
  );
}

/** One series: its sides, score and call, then its matches' scores. */
export function SeriesCard({ s, matches, final }: { s: BracketSeriesView; matches: MatchView[]; final: boolean }) {
  const decided = s.winner != null;
  const loser = decided ? (s.winner === s.red.alliance ? s.blue.alliance : s.red.alliance) : null;
  return (
    <div className={cn("rounded-xl border border-border bg-card p-3", final && "border-accent/40", s.skipped && "border-dashed bg-transparent")}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="text-foreground">{s.label}</span> · {s.stage}
        {s.bestOf > 1 && <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[11px]">Best of {s.bestOf}</span>}
      </p>
      {decided ? (
        // Decided: one line, so a played-through bracket stays short on a phone.
        <p className="mt-2 flex items-center gap-1.5 text-sm">
          <Trophy className="size-3.5 text-accent" aria-hidden /> <AllianceChip alliance={s.winner!} /> <span className="text-muted-foreground">beat</span> {loser != null && <AllianceChip alliance={loser} muted />}
          {s.bestOf > 1 && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{Math.max(...s.wins)}–{Math.min(...s.wins)}</span>}
        </p>
      ) : (
      <>
      <div className="mt-2 space-y-1">
        <SlotRow slot={s.red} wins={s.wins[0]} bestOf={s.bestOf} />
        <SlotRow slot={s.blue} wins={s.wins[1]} bestOf={s.bestOf} />
      </div>
      <div className="mt-2 border-t border-border pt-2 text-xs">
        {s.skipped ? (
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
            {s.bestOf > 1 && s.call.game != null && (
              <p className="mt-1 text-muted-foreground tabular-nums" data-testid="series-game">Best of {s.bestOf}, from {oddsPct(s.call.game)} each game</p>
            )}
          </div>
        ) : s.likely ? (
          <p className="flex items-center gap-1.5 text-muted-foreground">Likeliest winner <AllianceChip alliance={s.likely.alliance} /> <span className="font-semibold text-foreground tabular-nums">{oddsPct(s.likely.p)}</span></p>
        ) : (
          <p className="text-muted-foreground">Waiting on the alliances</p>
        )}
      </div>
      </>
      )}
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

/** Which alliance a match side's teams belong to (the event's alliance list), so a score lands on its own row. */
export type AllianceOf = (teams: number[]) => number | null;

/** A side's score in a single-match series, once played. */
function sideScore(alliance: number | null, matches: MatchView[], allianceOf: AllianceOf | undefined): number | null {
  const m = matches.filter((x) => x.played && x.red.score && x.blue.score).at(-1);
  if (!m || alliance == null || !allianceOf) return null;
  const red = allianceOf(m.red.teams.map((t) => t.number)), blue = allianceOf(m.blue.teams.map((t) => t.number));
  return red === alliance ? m.red.score!.total : blue === alliance ? m.blue.score!.total : null;
}

function TreeSide({ slot, s, wins, score }: { slot: BracketSlotView; s: BracketSeriesView; wins: number; score: number | null }) {
  const won = s.winner != null && slot.alliance === s.winner, lost = s.winner != null && !won;
  return (
    <div className={cn("flex min-h-7 items-center gap-1.5 px-2", won && "font-semibold")}>
      {slot.alliance != null ? <AllianceChip alliance={slot.alliance} muted={lost} /> : (
        <span className="truncate text-xs text-muted-foreground">
          {slot.source}
          {slot.likely && <> · likely <AllianceChip alliance={slot.likely.alliance} className="px-1 py-0 text-[11px]" /> {oddsPct(slot.likely.p)}</>}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1 text-sm tabular-nums">
        {won && <Trophy className="size-3.5 text-accent" aria-label="Winner" />}
        {s.bestOf === 1 ? score != null && <span className={cn(lost && "text-muted-foreground")}>{score}</span> : slot.alliance != null && <span>{wins}</span>}
      </span>
    </div>
  );
}

/** One series as a node of the tree: two sides, the winner marked, and the call while it's open. */
function TreeNode({ s, matches, allianceOf }: { s: BracketSeriesView; matches: MatchView[]; allianceOf?: AllianceOf }) {
  const named = s.stage !== "Upper bracket" && s.stage !== "Lower bracket";
  return (
    <div data-series={s.index} className={cn("w-44 rounded-lg border border-border bg-card text-sm", s.stage === "Grand final" && "border-accent/50", s.skipped && "border-dashed bg-transparent")}>
      <p className="flex items-center gap-1 border-b border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">
        <span className="text-foreground">{s.label}</span>{named && <> · {s.stage}</>}
      </p>
      <div className="py-0.5">
        <TreeSide slot={s.red} s={s} wins={s.wins[0]} score={sideScore(s.red.alliance, matches, allianceOf)} />
        <TreeSide slot={s.blue} s={s} wins={s.wins[1]} score={sideScore(s.blue.alliance, matches, allianceOf)} />
      </div>
      {s.winner == null && (s.skipped || s.pending || s.call || s.likely) && (
        <div className="border-t border-border px-2 py-1 text-[11px] text-muted-foreground">
          {s.skipped ? "Not needed" : s.pending ? "Only if the lower alliance wins" : s.call ? (
            <span className="flex items-center gap-1"><AllianceChip alliance={s.call.alliance} className="px-1 py-0 text-[11px]" /> <span className="font-semibold text-foreground tabular-nums">{oddsPct(s.call.p)}</span> <TierMark tier={s.call.tier} className="ml-auto text-[11px]" /></span>
          ) : s.likely && <span className="flex items-center gap-1">Likeliest <AllianceChip alliance={s.likely.alliance} className="px-1 py-0 text-[11px]" /> {oddsPct(s.likely.p)}</span>}
        </div>
      )}
    </div>
  );
}

/** Lines from each series to the one its winner plays next, measured off the drawn nodes. */
function useEdges(layout: BracketLayout) {
  const ref = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ key: string; d: string }[]>([]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const draw = () => {
      const box = el.getBoundingClientRect();
      const at = (i: number) => el.querySelector(`[data-series="${i}"]`)?.getBoundingClientRect();
      setPaths(layout.edges.flatMap(([from, to]) => {
        const a = at(from), b = at(to);
        if (!a || !b || !a.width || !b.width) return [];
        // A step to the next column; the if-needed replay sits under the grand final, so a short drop.
        if (b.left <= a.right) {
          const x = a.left + a.width / 2 - box.left;
          return [{ key: `${from}-${to}`, d: `M${x} ${a.bottom - box.top}V${b.top - box.top}` }];
        }
        const x1 = a.right - box.left, y1 = a.top + a.height / 2 - box.top, x2 = b.left - box.left, y2 = b.top + b.height / 2 - box.top;
        const mid = x2 - 16;
        return [{ key: `${from}-${to}`, d: `M${x1} ${y1}H${mid}V${y2}H${x2}` }];
      }));
    };
    draw();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);
  return { ref, paths };
}

/** The double-elimination bracket drawn as a tree: upper lane over lower lane, rounds left to right, finals on the right. */
function BracketTree({ bracket, layout, bySeries, allianceOf }: { bracket: BracketOdds; layout: BracketLayout; bySeries: Map<number, MatchView[]>; allianceOf?: AllianceOf }) {
  const { ref, paths } = useEdges(layout);
  const byIndex = new Map(bracket.series.map((s) => [s.index, s]));
  const rounds = Math.max(layout.upper.length, layout.lower.length);
  const node = (i: number) => {
    const s = byIndex.get(i)!;
    return <TreeNode key={i} s={s} matches={bySeries.get(s.series) ?? []} allianceOf={allianceOf} />;
  };
  const lane = (cols: number[][], row: number) => Array.from({ length: rounds }, (_, c) => (
    <div key={c} className="flex flex-col justify-around gap-3" style={{ gridColumn: c + 1, gridRow: row }}>{(cols[c] ?? []).map(node)}</div>
  ));
  const label = "text-xs font-medium text-muted-foreground";
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2" data-testid="bracket-tree">
      <div ref={ref} className="relative grid w-max gap-x-10 gap-y-2" style={{ gridTemplateColumns: `repeat(${rounds + 1}, 11rem)` }}>
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible text-border" aria-hidden>
          {paths.map((p) => <path key={p.key} d={p.d} fill="none" stroke="currentColor" strokeWidth={1.5} />)}
        </svg>
        <p className={label} style={{ gridColumn: `1 / span ${rounds}`, gridRow: 1 }}>Upper bracket</p>
        {lane(layout.upper, 2)}
        <p className={cn(label, "mt-4")} style={{ gridColumn: `1 / span ${rounds}`, gridRow: 3 }}>Lower bracket</p>
        {lane(layout.lower, 4)}
        <p className={label} style={{ gridColumn: rounds + 1, gridRow: 1 }}>Finals</p>
        <div className="flex flex-col justify-center gap-6" style={{ gridColumn: rounds + 1, gridRow: "2 / span 3" }}>{layout.final.map(node)}</div>
      </div>
    </div>
  );
}

/** The bracket's heading, its tier and the series: a tree for a double-elimination bracket, cards otherwise. */
export function BracketSeries({ bracket, bySeries, allianceOf }: { bracket: BracketOdds; bySeries: Map<number, MatchView[]>; allianceOf?: AllianceOf }) {
  const last = bracket.series.filter((s) => !s.ifNeeded).at(-1)?.index;
  const layout = bracket.format === "double" ? bracketLayout(bracket.series) : null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{FORMAT_TITLE[bracket.format]}</h3>
      </div>
      {bracket.note && <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{bracket.note}</p>}
      {layout ? <BracketTree bracket={bracket} layout={layout} bySeries={bySeries} allianceOf={allianceOf} /> : bracket.series.length ? (
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
