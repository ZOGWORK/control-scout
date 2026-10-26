// One scout field sized for watching the field, not the screen (the redesigned scout form,
// docs/mockups/scout-redesign.html): a counter is one big tap target that adds 1, a yes/no is a
// full-width row, a choice or rating is a row of equal buttons. Values are the old form's
// (ScoutFieldInput): a counter or rating is a number, a yes/no a boolean, a choice or text a string.
// `undefined` from onChange means "no answer" (a choice or rating tapped again).
// Surfaces are the app's own: Card's rounded-xl hairline card, the chip/card toggles' accent pick
// (src/components/ui/controls.tsx), the secondary button. Tap targets are px, not rem, so they stay
// 44px+ on a phone's 14px base.
import type { KeyboardEvent } from "react";
import { Minus } from "lucide-react";
import { Input, Label } from "../../ui/basic";
import { buttonVariants } from "../../ui/button";
import { cn } from "../../cn";
import type { ScoutField } from "../../../shared/scoutTemplate";
import type { ScoutValue } from "../../../lib/scouting";

/** How a yes/no reads when it's on: "bad" (a breakdown) shows in the danger colour instead of success. */
export type FieldTone = "default" | "bad";

/** A counter's floor and ceiling, and the number it shows: its floor until touched (the old form's rule). */
export function counterRange(f: ScoutField, value: ScoutValue | undefined) {
  const lo = f.min ?? 0, hi = f.max ?? 999;
  return { lo, hi, n: typeof value === "number" ? value : lo };
}

const tap = "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50";
const card = "rounded-xl border bg-card text-card-foreground";

export function BigFieldInput({ f, value, onChange, tone = "default", disabled, idPrefix = "big" }: {
  f: ScoutField; value: ScoutValue | undefined; onChange: (v: ScoutValue | undefined) => void; tone?: FieldTone; disabled?: boolean; idPrefix?: string;
}) {
  const id = `${idPrefix}-${f.id}`;
  if (f.type === "counter") {
    const { lo, hi, n } = counterRange(f, value);
    return (
      <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-2">
        <button type="button" aria-label={`${f.label} minus one`} disabled={disabled || n <= lo} onClick={() => onChange(Math.max(lo, n - 1))}
          className={cn(buttonVariants({ variant: "secondary" }), "h-auto min-h-[72px] px-0")}>
          <Minus className="size-5" />
        </button>
        <button type="button" aria-label={`${f.label}: ${n}. Add one`} disabled={disabled || n >= hi} onClick={() => onChange(Math.min(hi, n + 1))}
          className={cn(card, tap, "flex min-h-[72px] items-center justify-between gap-3 border-input px-4 text-left hover:bg-text-base/[0.04] active:border-accent/60 active:bg-accent/10")}>
          <span className="min-w-0">
            <span className="block font-semibold leading-snug">{f.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{n >= hi ? `Most is ${hi}` : "Tap to add 1"}</span>
          </span>
          <span className="font-mono text-3xl font-bold tabular-nums" aria-hidden>{n}</span>
        </button>
        <span className="sr-only" aria-live="polite">{`${f.label}: ${n}`}</span>
      </div>
    );
  }
  if (f.type === "toggle") {
    const on = value === true, bad = tone === "bad";
    return (
      <button type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(!on)}
        className={cn(card, tap, "flex min-h-[56px] w-full items-center justify-between gap-3 px-4 text-left font-semibold",
          !on ? "border-input hover:bg-text-base/[0.04]" : bad ? "border-danger/50 bg-danger/10" : "border-success/50 bg-success/10")}>
        <span className="min-w-0 leading-snug">{f.label}</span>
        <span className={cn("shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold",
          !on ? "bg-muted text-muted-foreground" : bad ? "bg-danger/15 text-danger-text" : "bg-success/15 text-success-text")} aria-hidden>{on ? "Yes" : "No"}</span>
      </button>
    );
  }
  if (f.type === "choice" || f.type === "rating") {
    const rating = f.type === "rating";
    const opts: { key: string; v: ScoutValue }[] = rating
      ? Array.from({ length: f.max ?? 5 }, (_, i) => ({ key: String(i + 1), v: i + 1 }))
      : (f.options ?? []).map((o) => ({ key: o, v: o }));
    // One row while each button keeps 44px+ on a 320px phone; longer lists wrap into even rows.
    // A radio group is one tab stop (the picked option, else the first); arrow keys, Home and End move
    // and pick, as in the app's other radio groups.
    const picked = opts.findIndex((o) => value === o.v), stop = picked < 0 ? 0 : picked;
    const onRadioKey = (e: KeyboardEvent<HTMLDivElement>) => {
      const from = Number((e.target as HTMLElement).dataset.index ?? stop), n = opts.length;
      const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (from + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (from - 1 + n) % n
        : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
      if (to < 0 || disabled) return;
      e.preventDefault();
      onChange(opts[to].v);
      e.currentTarget.querySelector<HTMLElement>(`[data-index="${to}"]`)?.focus();
    };
    const cols = rating ? (opts.length <= 5 ? opts.length : Math.ceil(opts.length / 2)) : opts.length <= 3 ? opts.length : 2;
    return (
      <div className={cn(card, "border-border p-3")}>
        <div id={`${id}-label`} className="mb-2 font-semibold leading-snug">{f.label}</div>
        <div role="radiogroup" aria-labelledby={`${id}-label`} onKeyDown={onRadioKey} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }}>
          {opts.map((o, i) => {
            const on = value === o.v;
            return (
              <button key={o.key} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(on ? undefined : o.v)}
                tabIndex={i === stop ? 0 : -1} data-index={i}
                className={cn(tap, "min-h-[44px] rounded-lg border px-2 text-sm font-semibold break-words",
                  on ? "border-accent/60 bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{o.key}</button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{f.label}</Label>
      <Input id={id} value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-[44px]" />
    </div>
  );
}
