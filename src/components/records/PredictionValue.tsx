// A match record's replayed call (redPredictedWinPct) as a value: the percentage with the confidence
// tier it was recorded with, or no percentage at all when the ledger has no tier for it (rule: a
// prediction never shows without its tier). Used by the table cell and the phone card's "More stats".
import type { ConfidenceTier } from "../../shared/api";
import { TierMark } from "../predict";
import { cn } from "../cn";

export function PredictionValue({ text, tier, className }: { text: string; tier: ConfidenceTier | null | undefined; className?: string }) {
  if (text === "—") return <>{text}</>;
  if (!tier) {
    return (
      <span className={cn("text-text-muted", className)} title="Not shown: no confidence tier was recorded with this call">
        <span aria-hidden>—</span><span className="sr-only">Not shown: no confidence tier was recorded with this call</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {text}<TierMark tier={tier} chip />
    </span>
  );
}
