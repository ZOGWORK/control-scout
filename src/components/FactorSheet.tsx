// The full why breakdown (engine 3.3 factor sheet), behind an expander: every factor behind a call with its
// share of it. Phases split the predicted margin; the win model's other inputs are grouped into plain factors;
// head-to-head and schedule strength are reasons that never move the odds (0%). Once the match is played, each
// factor that leaned one way says whether it pointed to the winner. Used by the Lab, the match page and Know
// your match, online and offline (the same sheet: src/shared/factorSheet.ts).
import type { ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { pointedRight, sheetReview, type FactorSheet, type SheetFactor } from "../shared/factorSheet";
import { factorLabel } from "../lib/factorLabel";
import { cn } from "./cn";

const pctOf = (w: number) => (w <= 0 ? "0%" : w < 0.005 ? "<1%" : `${Math.round(w * 100)}%`);

/** Below this many log-odds (about 52.5% either way) the whole call is a near coin flip. */
const COIN_FLIP = 0.1;

const TONE = {
  A: { text: "text-red-alliance", bar: "bg-red-alliance" },
  B: { text: "text-blue-alliance", bar: "bg-blue-alliance" },
  even: { text: "text-text-muted", bar: "bg-text-muted/40" },
} as const;

export function FactorSheetPanel({ sheet, winner = null, defaultOpen = false, className }: {
  sheet: FactorSheet;
  /** The played result ("A" = red won): marks which factors pointed to the winner. */
  winner?: "A" | "B" | "tie" | null;
  defaultOpen?: boolean;
  className?: string;
}) {
  const all = [...sheet.phases, ...sheet.model, ...sheet.reasons];
  // Bars are drawn against the largest share, so a call carried by one factor still reads at a glance.
  const top = Math.max(...all.map((f) => f.weight), 0.0001);
  const review = sheetReview(sheet, winner);
  return (
    <details className={cn("group rounded-xl border border-border bg-text-base/[0.02]", className)} open={defaultOpen || undefined} data-testid="factor-sheet">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>Full why breakdown <span className="font-normal text-text-muted">· {all.length} factors</span></span>
        <ChevronDown className="size-4 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-border px-3 pb-3 pt-3">
        {review && (
          <p className="rounded-lg bg-success/10 px-3 py-2 text-sm" data-testid="sheet-review">
            <span className="font-semibold text-success">{review.right} of {review.leaning}</span> factors that leaned one way pointed to the winner, carrying{" "}
            <span className="font-semibold tabular-nums">{pctOf(review.rightWeight)}</span> of the call.
          </p>
        )}
        {Math.abs(sheet.logit) < COIN_FLIP && (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm" data-testid="sheet-coin-flip">
            This call is close to a coin flip, so every factor is small. The shares show how that small lean splits.
          </p>
        )}
        <Section title="Game phases" note="An exact split of the predicted margin">
          {sheet.phases.map((f) => <Row key={f.id} f={f} top={top} winner={winner} />)}
        </Section>
        {sheet.model.length > 0 && (
          <Section title="What else the win model weighs" note="How the odds move beyond the score gap">
            {sheet.model.map((f) => <Row key={f.id} f={f} top={top} winner={winner} />)}
          </Section>
        )}
        <Section title="Reasons that don't move the odds">
          {sheet.reasons.map((f) => <Row key={f.id} f={f} top={top} winner={winner} />)}
        </Section>
        <p className="text-xs text-text-muted">
          Each share is how much of the call that factor carries; the shares add up to 100%. A red bar helps red, a blue bar helps blue.
        </p>
      </div>
    </details>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="text-xs font-semibold text-text-base">{title}{note && <span className="font-normal text-text-muted"> · {note}</span>}</h4>
      <ul className="mt-1.5 space-y-2">{children}</ul>
    </section>
  );
}

function Row({ f, top, winner }: { f: SheetFactor; top: number; winner: "A" | "B" | "tie" | null }) {
  const tone = TONE[f.favors];
  const right = pointedRight(f, winner);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
          {f.name}
          {right != null && (
            <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[11px] font-medium", right ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
              {right ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}{right ? "Pointed right" : "Pointed wrong"}
            </span>
          )}
        </p>
        <p className="text-xs text-text-muted">{factorLabel(f.label)}</p>
      </div>
      <span className={cn("text-sm font-semibold tabular-nums", tone.text)} title={f.kind === "reason" ? "Words only: this never moves the odds" : undefined}>{pctOf(f.weight)}</span>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${(f.weight / top) * 100}%` }} />
      </div>
    </li>
  );
}
