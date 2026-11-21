// A stat tile in its own colour (team page OPR cards, My team): a tinted box and border, the icon in a
// tinted chip, the value in the foreground colour, and a bar in the stat's colour where there's a rank.
// With onClick it's a toggle button (e.g. "show event by event"); `selected` gives the open one a ring.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { V8_NUM } from "../lib/v8";

// Static class strings (Tailwind only generates classes it can see written out).
export const TONES = {
  accent: { box: "border-accent/30 bg-accent/[0.06]", hover: "hover:border-accent/60", selected: "border-accent ring-2 ring-accent/50 bg-accent/[0.12]", chip: "bg-accent/15 text-accent-text", bar: "bg-accent", text: "text-accent-text", edge: "border-t-accent" },
  sky: { box: "border-info/30 bg-info/[0.06]", hover: "hover:border-info/60", selected: "border-info ring-2 ring-info/50 bg-info/[0.12]", chip: "bg-info/15 text-info", bar: "bg-info", text: "text-info", edge: "border-t-info" },
  emerald: { box: "border-success/30 bg-success/[0.06]", hover: "hover:border-success/60", selected: "border-success ring-2 ring-success/50 bg-success/[0.12]", chip: "bg-success/15 text-success", bar: "bg-success", text: "text-success", edge: "border-t-success" },
  violet: { box: "border-violet-500/30 bg-violet-500/[0.06]", hover: "hover:border-violet-500/60", selected: "border-violet-500 ring-2 ring-violet-500/50 bg-violet-500/[0.12]", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400", bar: "bg-violet-500", text: "text-violet-600 dark:text-violet-400", edge: "border-t-violet-500" },
  amber: { box: "border-warning/30 bg-warning/[0.06]", hover: "hover:border-warning/60", selected: "border-warning ring-2 ring-warning/50 bg-warning/[0.12]", chip: "bg-warning/15 text-warning", bar: "bg-warning", text: "text-warning", edge: "border-t-warning" },
  rose: { box: "border-rose-500/30 bg-rose-500/[0.06]", hover: "hover:border-rose-500/60", selected: "border-rose-500 ring-2 ring-rose-500/50 bg-rose-500/[0.12]", chip: "bg-rose-500/15 text-rose-600 dark:text-rose-400", bar: "bg-rose-500", text: "text-rose-600 dark:text-rose-400", edge: "border-t-rose-500" },
  teal: { box: "border-teal-500/30 bg-teal-500/[0.06]", hover: "hover:border-teal-500/60", selected: "border-teal-500 ring-2 ring-teal-500/50 bg-teal-500/[0.12]", chip: "bg-teal-500/15 text-teal-600 dark:text-teal-400", bar: "bg-teal-500", text: "text-teal-600 dark:text-teal-400", edge: "border-t-teal-500" },
  // Search answer cards (the search results guide: hue means team only): a tile with no colour of its own.
  neutral: { box: "border-border bg-muted/30", hover: "hover:border-foreground/30", selected: "border-foreground/40 ring-2 ring-foreground/20 bg-muted/50", chip: "bg-muted text-foreground", bar: "bg-foreground/55", text: "text-foreground", edge: "border-t-border" },
  orange: { box: "border-orange-500/30 bg-orange-500/[0.06]", hover: "hover:border-orange-500/60", selected: "border-orange-500 ring-2 ring-orange-500/50 bg-orange-500/[0.12]", chip: "bg-orange-500/15 text-orange-600 dark:text-orange-400", bar: "bg-orange-500", text: "text-orange-600 dark:text-orange-400", edge: "border-t-orange-500" },
} as const;
export type Tone = keyof typeof TONES;

// v8 (docs/design/v8-revamp-brief.md §2, §5): the card surface and its hairline, no filled tint, no hover lift. The
// tile's meaning colour stays in three thin places (src/lib/v8colour.ts): a 2px bracket on its left edge, the icon
// (plain, no chip) and the value. Written after the tone's classes, so these win while <html data-v8> is set and
// nothing changes without it.
const V8_BOX = "v8:border-line v8:bg-card";
const V8_HOVER = "v8:hover:border-ink/[0.12] v8:hover:bg-ink/[0.02] v8:hover:translate-y-0";
const V8_SELECTED = "v8:border-ink/25 v8:bg-ink/[0.04] v8:ring-1 v8:ring-ink/10";
const V8_CHIP = "v8:size-4 v8:rounded-none v8:bg-transparent v8:text-text-faint";
/** Each tone in v8's palette: `text` for the icon and value, `edge` for the left bracket. No teal in v8 (it takes the
 *  accent); a neutral tile keeps the faint icon and the slate-blue number. */
export const V8_TONES: Record<Tone, { text: string; edge: string }> = {
  accent: { text: "v8:text-accent", edge: "v8:border-l-accent" },
  sky: { text: "v8:text-sky-400", edge: "v8:border-l-sky-400" },
  emerald: { text: "v8:text-emerald-400", edge: "v8:border-l-emerald-400" },
  violet: { text: "v8:text-violet-400", edge: "v8:border-l-violet-400" },
  amber: { text: "v8:text-amber-400", edge: "v8:border-l-amber-400" },
  rose: { text: "v8:text-rose-400", edge: "v8:border-l-rose-400" },
  teal: { text: "v8:text-accent", edge: "v8:border-l-accent" },
  neutral: { text: V8_NUM, edge: "" },
  orange: { text: "v8:text-orange-400", edge: "v8:border-l-orange-400" },
};
/** The bracket's width, on toned tiles only. */
const V8_EDGE = "v8:border-l-2";
/** A meter part in v8: progress is the one place mint shows on a tile. */
export const V8_BAR = "v8:bg-accent";

export function StatTile({ tone, icon: Icon, label, value, hint, bar, onClick, selected, action, className, chip }: {
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
  /** With onClick: what pressing does (e.g. "Show event by event"), added for screen readers after the
   *  visible text, so the button's name keeps everything it shows (WCAG 2.5.3, label in name). */
  action?: string;
  className?: string;
  /** The icon chip's own colours, over the tone's (search's palette: a filled chip in the tile's meaning). */
  chip?: string;
}) {
  const t = TONES[tone];
  const v8t = V8_TONES[tone];
  const v8Edge = tone === "neutral" ? "" : cn(V8_EDGE, v8t.edge);
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm leading-tight text-muted-foreground v8:gap-1.5">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", chip ?? t.chip, V8_CHIP, !chip && tone !== "neutral" && v8t.text)}><Icon className="size-4" aria-hidden /></span>{label}
      </span>
      <span className={cn("mt-2 block font-display text-3xl font-semibold tabular-nums text-foreground", v8t.text)}>{value}</span>
      {hint && <span className="mt-1 block break-words text-xs text-muted-foreground">{hint}</span>}
      {bar && <span className="mt-auto block pt-2">{bar}</span>}
    </>
  );
  const base = "flex h-full w-full min-w-0 flex-col rounded-xl border p-4 text-left";
  if (!onClick) return <div className={cn(base, t.box, V8_BOX, v8Edge, className)}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-expanded={!!selected} data-selected={selected ? "true" : undefined}
      className={cn(base, "transition-[border-color,transform,box-shadow,background-color] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 v8:active:scale-[0.99] motion-reduce:v8:active:scale-100", selected ? cn(t.selected, V8_SELECTED, v8Edge) : cn(t.box, t.hover, V8_BOX, V8_HOVER, v8Edge), className)}>
      {body}
      {action && <span className="sr-only">. {action}</span>}
    </button>
  );
}

/** A thin bar of coloured parts, each a percent of the whole. Decorative: the numbers are always in text beside it.
 *  `value` and `scale`: the number a part stands for and its whole (marked for the answer-card audit), else the pc. */
export function Meter({ parts }: { parts: { pc: number; cls: string; value?: number; scale?: number }[] }) {
  return (
    <span aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-muted v8:h-1 v8:bg-ink/[0.06]">
      {parts.map((x, i) => <span key={i} className={cn("h-full transition-[width] duration-700 motion-reduce:transition-none v8:transition-none", x.cls)} style={{ width: `${x.pc}%` }} data-bar data-value={x.value ?? x.pc} data-scale={x.scale ?? 100} />)}
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
