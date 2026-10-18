// A stat tile in its own colour (team page OPR cards, My team): a tinted box and border, the icon in a
// tinted chip, the value in the foreground colour, and a bar in the stat's colour where there's a rank.
// With onClick it's a toggle button (e.g. "show event by event"); `selected` gives the open one a ring.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";

// Static class strings (Tailwind only generates classes it can see written out).
export const TONES = {
  accent: { box: "border-accent/30 bg-accent/[0.06]", hover: "hover:border-accent/60", selected: "border-accent ring-2 ring-accent/50 bg-accent/[0.12]", chip: "bg-accent/15 text-accent-text", bar: "bg-accent", text: "text-accent-text", edge: "border-t-accent" },
  sky: { box: "border-info/30 bg-info/[0.06]", hover: "hover:border-info/60", selected: "border-info ring-2 ring-info/50 bg-info/[0.12]", chip: "bg-info/15 text-info", bar: "bg-info", text: "text-info", edge: "border-t-info" },
  emerald: { box: "border-success/30 bg-success/[0.06]", hover: "hover:border-success/60", selected: "border-success ring-2 ring-success/50 bg-success/[0.12]", chip: "bg-success/15 text-success", bar: "bg-success", text: "text-success", edge: "border-t-success" },
  violet: { box: "border-violet-500/30 bg-violet-500/[0.06]", hover: "hover:border-violet-500/60", selected: "border-violet-500 ring-2 ring-violet-500/50 bg-violet-500/[0.12]", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400", bar: "bg-violet-500", text: "text-violet-600 dark:text-violet-400", edge: "border-t-violet-500" },
  amber: { box: "border-warning/30 bg-warning/[0.06]", hover: "hover:border-warning/60", selected: "border-warning ring-2 ring-warning/50 bg-warning/[0.12]", chip: "bg-warning/15 text-warning", bar: "bg-warning", text: "text-warning", edge: "border-t-warning" },
} as const;
export type Tone = keyof typeof TONES;

export function StatTile({ tone, icon: Icon, label, value, hint, bar, onClick, selected, ariaLabel, className }: {
  tone: Tone;
  icon: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** Under the hint, pinned to the tile's bottom (e.g. a <Meter>). */
  bar?: ReactNode;
  onClick?: () => void;
  /** With onClick: this tile's details are open (aria-expanded, a ring in its colour). */
  selected?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const t = TONES[tone];
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm leading-tight text-muted-foreground">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", t.chip)}><Icon className="size-4" aria-hidden /></span>{label}
      </span>
      <span className="mt-2 block font-display text-3xl font-semibold tabular-nums text-foreground">{value}</span>
      {hint && <span className="mt-1 block break-words text-xs text-muted-foreground">{hint}</span>}
      {bar && <span className="mt-auto block pt-2">{bar}</span>}
    </>
  );
  const base = "flex h-full w-full min-w-0 flex-col rounded-xl border p-4 text-left";
  if (!onClick) return <div className={cn(base, t.box, className)}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-expanded={!!selected} aria-label={ariaLabel} data-selected={selected ? "true" : undefined}
      className={cn(base, "transition-[border-color,transform,box-shadow,background-color] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0", selected ? t.selected : cn(t.box, t.hover), className)}>
      {body}
    </button>
  );
}

/** A thin bar of coloured parts, each a percent of the whole. Decorative: the numbers are always in text beside it. */
export function Meter({ parts }: { parts: { pc: number; cls: string }[] }) {
  return (
    <span aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-muted">
      {parts.map((x, i) => <span key={i} className={cn("h-full transition-[width] duration-700 motion-reduce:transition-none", x.cls)} style={{ width: `${x.pc}%` }} />)}
    </span>
  );
}

/** Percentile from a world rank (rank 1 of n = 100). */
export const rankPc = (rank: number | null | undefined, of: number | null | undefined) => (rank && of ? Math.round((1 - (rank - 1) / of) * 100) : 0);

/** Wins, losses and ties as one bar (green, red, grey). */
export function RecordMeter({ w, l, t }: { w: number; l: number; t: number }) {
  const n = w + l + t || 1;
  return <Meter parts={[{ pc: (w / n) * 100, cls: "bg-success" }, { pc: (l / n) * 100, cls: "bg-destructive" }, { pc: (t / n) * 100, cls: "bg-text-muted/50" }]} />;
}
