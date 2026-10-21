// Bonus ranking point odds next to a match's win odds: for each of the season's bonus RPs, the chance
// each alliance earns it, mirrored red | label | blue like the score breakdown, and the ranking points
// each side can expect from the match. Rule: shown with its confidence tier, never a flat 0% or 100%
// (oddsPct), and once played the call sits beside what actually happened.
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
          Win chance × 3 plus each bonus chance, from each alliance's likely score this season. Qualification matches only.{" "}
          <Link to="/methodology#bonus" className="underline underline-offset-2">How</Link>
        </p>
      )}
    </section>
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
