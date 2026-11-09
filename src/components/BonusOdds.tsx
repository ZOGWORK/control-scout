// Bonus ranking point odds next to a match's win odds: for each of the season's bonus RPs, the chance
// each alliance earns it, mirrored red | label | blue like the score breakdown, and the ranking points
// each side can expect from the match. Rule: shown with its confidence tier, never a flat 0% or 100%
// (oddsPct), and once played the call sits beside what actually happened.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import type { BonusOddsView } from "../shared/api";
import { bonusLabels } from "../shared/labels";
import { oddsPct } from "../lib/format";
import { TierMark } from "./predict";
import { cn } from "./cn";

type Flags = [boolean, boolean, boolean] | null | undefined;

export function BonusOdds({ season, bonus, actual, className, compact }: {
  season: number;
  bonus: BonusOddsView;
  /** Bonus RPs actually earned (played matches), in the same order. */
  actual?: { red: Flags; blue: Flags } | null;
  className?: string;
  /** Inside a card that already explains itself: no footnote. */
  compact?: boolean;
}) {
  const labels = bonusLabels(season);
  if (!labels) return null;
  const won = (f: Flags, i: number) => (f ? f[i] : null);
  return (
    <section aria-label="Bonus ranking point odds" className={cn("rounded-xl border border-border bg-card p-3 sm:p-4", className)} data-testid="bonus-odds">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Bonus ranking points</p>
        <TierMark tier={bonus.tier} chip />
      </div>
      <ul className="mt-2 space-y-1.5">
        {labels.map((label, i) => (
          <li key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(4.5rem,auto)_minmax(0,1fr)] items-center gap-2">
            <Side side="red" p={bonus.red[i]} got={won(actual?.red, i)} />
            <span className="text-center text-xs text-text-muted">{label}</span>
            <Side side="blue" p={bonus.blue[i]} got={won(actual?.blue, i)} />
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(4.5rem,auto)_minmax(0,1fr)] items-baseline gap-2 border-t border-border pt-2">
        <span className="text-right font-display text-xl font-bold tabular-nums text-red-alliance">{bonus.rpRed.toFixed(1)}</span>
        <span className="text-center text-xs font-medium text-text-muted">Expected RP</span>
        <span className="font-display text-xl font-bold tabular-nums text-blue-alliance">{bonus.rpBlue.toFixed(1)}</span>
      </div>
      {!compact && (
        <p className="mt-2 text-[11px] leading-snug text-text-muted">
          3 for a win and 1 for a tie, weighted by their chances (a tie is about 1% in an even match), plus each bonus chance, from each alliance's likely score this season. Qualification matches only.{" "}
          <Link to="/methodology#bonus" className="underline underline-offset-2">How</Link>
        </p>
      )}
    </section>
  );
}

/** The same odds as one compact row inside a card that already has its own frame (a match's call): each RP's
 *  chance per side as numbers (no bars), the expected RP, and the footnote as one small line. */
export function BonusOddsRow({ season, bonus, actual, className }: {
  season: number; bonus: BonusOddsView; actual?: { red: Flags; blue: Flags } | null; className?: string;
}) {
  const labels = bonusLabels(season);
  if (!labels) return null;
  const mark = (f: Flags, i: number) => (!f ? null : f[i]
    ? <Check className="inline size-3 text-success" aria-label="earned" />
    : <X className="inline size-3 text-text-muted" aria-label="missed" />);
  const pair = (r: ReactNode, b: ReactNode) => (
    <span className="whitespace-nowrap tabular-nums"><span className="font-semibold text-red-alliance">{r}</span><span className="text-text-muted"> – </span><span className="font-semibold text-blue-alliance">{b}</span></span>
  );
  return (
    <div aria-label="Bonus ranking point odds" className={className} data-testid="bonus-odds">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-text-muted">Bonus ranking points</span>
        <TierMark tier={bonus.tier} chip />
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {labels.map((label, i) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className="text-text-muted">{label}</span>
            {mark(actual?.red, i)}{pair(oddsPct(bonus.red[i]), oddsPct(bonus.blue[i]))}{mark(actual?.blue, i)}
          </li>
        ))}
        <li className="flex items-center gap-1.5"><span className="text-text-muted">Expected RP</span>{pair(bonus.rpRed.toFixed(1), bonus.rpBlue.toFixed(1))}</li>
      </ul>
      <p className="mt-1 text-[11px] leading-snug text-text-muted">
        3 for a win and 1 for a tie, weighted by their chances (a tie is about 1% in an even match), plus each bonus chance, from each alliance's likely score this season. Qualification matches only.{" "}
        <Link to="/methodology#bonus" className="underline underline-offset-2">How</Link>
      </p>
    </div>
  );
}

function Side({ side, p, got }: { side: "red" | "blue"; p: number; got: boolean | null }) {
  const red = side === "red";
  const pct = oddsPct(p);
  const mark = got == null ? null : got
    ? <Check className="size-3.5 shrink-0 text-success" aria-label="earned" />
    : <X className="size-3.5 shrink-0 text-text-muted" aria-label="missed" />;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", red ? "flex-row" : "flex-row-reverse")}>
      {mark}
      <span className={cn("w-9 shrink-0 text-sm font-semibold tabular-nums", red ? "text-right text-red-alliance" : "text-blue-alliance")}>{pct}</span>
      <span className={cn("flex h-2 flex-1 overflow-hidden rounded-full bg-muted", red ? "justify-end" : "justify-start")} role="img" aria-label={`${red ? "Red" : "Blue"} ${pct}`}>
        <span className={cn("h-full rounded-full", red ? "bg-red-alliance" : "bg-blue-alliance")} style={{ width: `${Math.max(3, Math.min(97, p * 100))}%` }} />
      </span>
    </span>
  );
}
