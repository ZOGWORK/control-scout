// The match form's live strip: how many taps each robot being scouted has so far (the sum of its counters), and
// each alliance's total, updating as the scout taps. Tap totals only: no points, no prediction.
import type { ScoutTemplate } from "../../../shared/scoutTemplate";
import type { ScoutValue } from "../../../lib/scouting";
import type { AllianceSide } from "../../../shared/scoutMatch";
import { cn } from "../../cn";

export interface StripRobot { team: number; side: AllianceSide; station: number; data: Record<string, ScoutValue>; template: ScoutTemplate }

/** A robot's taps: its counters added up (a counter not touched yet counts as its floor, as the form shows it). */
export function tapTotal(r: Pick<StripRobot, "data" | "template">): number {
  let n = 0;
  for (const f of r.template.fields) {
    if (f.type !== "counter") continue;
    const v = r.data[f.id];
    n += typeof v === "number" && Number.isFinite(v) ? v : f.min ?? 0;
  }
  return n;
}

export function ScoreStrip({ robots, className }: { robots: readonly StripRobot[]; className?: string }) {
  const sides = (["red", "blue"] as const).filter((s) => robots.some((r) => r.side === s));
  return (
    <section aria-label="Taps so far" className={cn("grid gap-2 rounded-xl border border-border bg-card p-2", sides.length > 1 && "sm:grid-cols-2", className)}>
      {sides.map((side) => {
        const mine = robots.filter((r) => r.side === side);
        const total = mine.reduce((a, r) => a + tapTotal(r), 0);
        return (
          <div key={side} className={cn("flex items-center gap-2 rounded-lg border-l-[3px] px-3 py-2", side === "red" ? "border-red-alliance bg-red-alliance/[0.06]" : "border-blue-alliance bg-blue-alliance/[0.06]")}>
            <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
              {mine.map((r) => (
                <span key={r.team} className="inline-flex items-baseline gap-1.5">
                  <span className="font-mono text-sm font-semibold">{r.team}</span>
                  <span className="font-mono text-lg font-bold tabular-nums text-foreground" aria-label={`${tapTotal(r)} taps`}>{tapTotal(r)}</span>
                </span>
              ))}
            </div>
            {mine.length > 1 && (
              <span className="shrink-0 text-right">
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">{side === "red" ? "Red" : "Blue"}</span>
                <span className="font-mono text-xl font-bold tabular-nums" aria-label={`${side} alliance ${total} taps`}>{total}</span>
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}
