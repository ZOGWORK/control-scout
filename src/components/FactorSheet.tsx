// The full why breakdown (engine 3.3 factor sheet), behind an expander: every factor behind a call with its
// share of it. Phases split the predicted margin; the win model's other inputs are grouped into plain factors;
// head-to-head and schedule strength are reasons that never move the odds (0%). Once the match is played, each
// factor that leaned one way says whether it pointed to the winner. Used by the Lab, the match page and Know
// your match, online and offline (the same sheet: src/shared/factorSheet.ts).
//
// Sized by its container, not the screen: on a wide card the game phases and the win model's factors sit side by
// side; in a narrow one (a phone, the match drawer's half) they stack.
import type { ReactNode } from "react";
import {
  Bot, CalendarRange, ChartBarBig, ChartPie, Check, ChevronDown, Flag, Gamepad2, Gauge, Hourglass, Scale, ShieldAlert, Swords,
  TrendingUp, Users, Wrench, X, Zap, type LucideIcon,
} from "lucide-react";
import { pointedRight, sheetReview, type FactorSheet, type SheetFactor } from "../shared/factorSheet";
import { factorLabel } from "../lib/factorLabel";
import { useFlag } from "../lib/flags";
import { cn } from "./cn";

const pctOf = (w: number) => (w <= 0 ? "0%" : w < 0.005 ? "<1%" : `${Math.round(w * 100)}%`);

/** Below this many log-odds (about 52.5% either way) the whole call is a near coin flip. */
const COIN_FLIP = 0.1;

const TONE = {
  A: { text: "text-red-alliance", bar: "bg-red-alliance", chip: "bg-red-alliance/15 text-red-alliance" },
  B: { text: "text-blue-alliance", bar: "bg-blue-alliance", chip: "bg-blue-alliance/15 text-blue-alliance" },
  even: { text: "text-text-muted", bar: "bg-text-muted/40", chip: "bg-muted text-text-muted" },
} as const;

const ICON: Record<SheetFactor["id"], LucideIcon> = {
  auto: Bot, teleop: Gamepad2, endgame: Flag, pen: ShieldAlert,
  pointMix: ChartPie, form: TrendingUp, momentum: Zap, reliability: Wrench, partners: Users, experience: Hourglass, certainty: Gauge,
  schedule: CalendarRange, headToHead: Swords,
};

export function FactorSheetPanel({ sheet, winner = null, defaultOpen = false, className }: {
  sheet: FactorSheet;
  /** The played result ("A" = red won): marks which factors pointed to the winner. */
  winner?: "A" | "B" | "tie" | null;
  defaultOpen?: boolean;
  className?: string;
}) {
  // The owner's factorSheet toggle: off, the call keeps its top 3 reasons and nothing else (offline too).
  const on = useFlag("factorSheet");
  if (!on) return null;
  const all = [...sheet.phases, ...sheet.model, ...sheet.reasons];
  // Bars are drawn against the largest share, so a call carried by one factor still reads at a glance.
  const top = Math.max(...all.map((f) => f.weight), 0.0001);
  const review = sheetReview(sheet, winner);
  return (
    <details className={cn("@container group rounded-xl border border-border bg-text-base/[0.02]", className)} open={defaultOpen || undefined} data-testid="factor-sheet">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-text" aria-hidden><ChartBarBig className="size-4" /></span>
        <span className="min-w-0 flex-1">Full why breakdown <span className="font-normal text-text-muted">· {all.length} factors</span></span>
        <ChevronDown className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-border px-3 pb-3 pt-3 @2xl:px-4 @2xl:pb-4">
        <TugOfWar sheet={sheet} />
        {review && (
          <p className="rounded-lg bg-success/10 px-3 py-2 text-sm" data-testid="sheet-review">
            <span className="font-semibold text-success">{review.right} of {review.leaning}</span> factors that leaned one way pointed to the winner, carrying{" "}
            <span className="font-semibold tabular-nums">{pctOf(review.rightWeight)}</span> of the call.
          </p>
        )}
        {Math.abs(sheet.logit) < COIN_FLIP && (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm" data-testid="sheet-coin-flip">
            This call is close to a coin flip. Strong factors can pull in opposite directions and cancel each other.
          </p>
        )}
        <div className="grid gap-5 @3xl:grid-cols-2 @3xl:gap-x-8">
          <div className="space-y-5">
            <Section title="Game phases" note="An exact split of the predicted margin">
              {sheet.phases.map((f) => <Row key={f.id} f={f} top={top} winner={winner} />)}
            </Section>
            <Section title="Reasons that don't move the odds">
              {sheet.reasons.map((f) => <Row key={f.id} f={f} top={top} winner={winner} />)}
            </Section>
          </div>
          {sheet.model.length > 0 && (
            <Section title="What else the win model weighs" note="How the odds move beyond the score gap">
              {sheet.model.map((f) => <Row key={f.id} f={f} top={top} winner={winner} />)}
            </Section>
          )}
        </div>
        <p className="text-xs text-text-muted">
          Each share is how much of the call that factor carries; the shares add up to 100%. A red bar helps red, a blue bar helps blue.
        </p>
      </div>
    </details>
  );
}

/** The whole call at a glance: one bar, red's factors from the left and blue's from the right, each segment its share. */
function TugOfWar({ sheet }: { sheet: FactorSheet }) {
  const lean = (side: "A" | "B") => [...sheet.phases, ...sheet.model].filter((f) => f.favors === side && f.weight > 0).sort((x, y) => y.weight - x.weight);
  const red = lean("A"), blue = lean("B");
  const sum = (xs: SheetFactor[]) => xs.reduce((s, f) => s + f.weight, 0);
  const total = sum(red) + sum(blue);
  if (total <= 0) return null;
  const seg = (f: SheetFactor, i: number, side: "A" | "B") => (
    <div key={f.id} className={cn("h-full", TONE[side].bar, i > 0 && (side === "A" ? "border-l border-card/70" : "border-r border-card/70"))}
      style={{ width: `${(f.weight / total) * 100}%`, opacity: Math.max(0.45, 1 - i * 0.12) }} title={`${f.name}: ${pctOf(f.weight)}`} />
  );
  return (
    <div data-testid="sheet-tug">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-red-alliance"><span className="tabular-nums text-sm">{pctOf(sum(red) / total)}</span> pulls for red</span>
        <span className="hidden text-text-muted @md:inline"><Scale className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />What the call leans on</span>
        <span className="font-semibold text-blue-alliance">pulls for blue <span className="tabular-nums text-sm">{pctOf(sum(blue) / total)}</span></span>
      </div>
      <div className="mt-1.5 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Factors leaning red carry ${pctOf(sum(red) / total)} of the call, blue ${pctOf(sum(blue) / total)}`}>
        {red.map((f, i) => seg(f, i, "A"))}
        <div className="flex flex-1 flex-row-reverse">{blue.map((f, i) => seg(f, i, "B"))}</div>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="text-xs font-semibold text-text-base">{title}{note && <span className="font-normal text-text-muted"> · {note}</span>}</h4>
      <ul className="mt-2 space-y-2.5">{children}</ul>
    </section>
  );
}

function Row({ f, top, winner }: { f: SheetFactor; top: number; winner: "A" | "B" | "tie" | null }) {
  const tone = TONE[f.favors];
  const right = pointedRight(f, winner);
  const Icon = ICON[f.id] ?? Gauge;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1">
      <span className={cn("row-span-2 mt-0.5 flex size-8 items-center justify-center rounded-lg", tone.chip)} aria-hidden><Icon className="size-4" /></span>
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
      <div className="col-span-2 col-start-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${(f.weight / top) * 100}%` }} />
      </div>
    </li>
  );
}
