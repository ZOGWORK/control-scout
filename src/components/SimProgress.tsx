// While a simulation runs (the Rankings tab's simulated rankings, the Predict Lab's advancement odds): a die that
// rolls, a count of simulated events climbing to the target, a bar that fills, and a small histogram of where a
// team lands shuffling as the runs come in. The server answers in a second or two and doesn't report progress,
// so the count and bar follow the usual pace and hold just short of the end until the answer is in. Still (text
// and a full-width bar) when the viewer asks for reduced motion.
import { useEffect, useState } from "react";
import { Dices } from "lucide-react";
import { cn } from "./cn";

/** How far along to show `ms` into a run expected to take `expectedMs`: eases out, never past 95% before it's done. */
export function shownProgress(ms: number, expectedMs: number): number {
  const x = Math.max(0, ms) / Math.max(1, expectedMs);
  return Math.min(0.95, 1 - Math.exp(-2.6 * x));
}

const BARS = 12;
const reduced = () => { try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; } catch { return false; } };

export function SimProgress({ runs = 2000, expectedMs = 2200, label = "Simulating the event", detail, className }: { runs?: number | null; expectedMs?: number; label?: string; detail?: string; className?: string }) {
  const [still] = useState(reduced);
  const [ms, setMs] = useState(0);
  const [bars, setBars] = useState<number[]>(() => Array.from({ length: BARS }, (_, i) => 0.25 + 0.5 * Math.exp(-(((i - 3.5) / 3) ** 2))));
  useEffect(() => {
    if (still) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => { setMs(performance.now() - t0); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    // The histogram settles as runs pile up: early draws jump around, later ones only nudge.
    const shuffle = setInterval(() => {
      const p = shownProgress(performance.now() - t0, expectedMs);
      setBars((b) => b.map((h, i) => {
        const target = 0.15 + 0.8 * Math.exp(-(((i - 3.5) / 2.6) ** 2));
        return Math.max(0.08, Math.min(1, h + (target - h) * (0.25 + p * 0.5) + (Math.random() - 0.5) * 0.5 * (1 - p)));
      }));
    }, 110);
    return () => { cancelAnimationFrame(raf); clearInterval(shuffle); };
  }, [still, expectedMs]);
  const p = still ? 0 : shownProgress(ms, expectedMs);
  const done = Math.round(p * (runs ?? 0));
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)} role="status" aria-live="polite" aria-busy="true" data-sim-progress>
      <div className="flex items-center gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text", !still && "animate-[cs-roll_0.9s_ease-in-out_infinite]")} aria-hidden>
          <Dices className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{label}…</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {runs == null ? detail : still ? `${runs.toLocaleString()} simulated events` : <><span className="font-mono text-foreground">{done.toLocaleString()}</span> of {runs.toLocaleString()} simulated events</>}
          </p>
        </div>
        {/* Where a team lands, run after run: the shape settles as the count climbs. */}
        <div className="flex h-9 shrink-0 items-end gap-[3px]" aria-hidden>
          {bars.map((h, i) => <span key={i} className="w-1.5 rounded-sm bg-accent/70 transition-[height] duration-100 ease-out motion-reduce:transition-none" style={{ height: `${Math.round(h * 100)}%` }} />)}
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-text-base/10" aria-hidden>
        <div className={cn("h-full rounded-full bg-accent", still && "w-full opacity-40")} style={still ? undefined : { width: `${p * 100}%` }} />
      </div>
    </div>
  );
}
