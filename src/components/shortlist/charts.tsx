// Shortlist graphs, kept light: plain SVG / divs (the trend line is Arc's sparkline).
import { Sparkline } from "../arc/sparkline/sparkline";
import { cn } from "../cn";
import { num } from "../../lib/format";
import type { ShortlistEventPoint } from "../../shared/api";

/** The three parts of a score, in the app's chart colours: auto blue, driver-controlled gold, endgame green. */
export const PARTS = [
  { k: "auto", label: "Auto", short: "Auto", fill: "var(--color-chart-2)", text: "text-info" },
  { k: "teleop", label: "Driver-controlled", short: "DC", fill: "var(--color-accent)", text: "text-accent-text" },
  { k: "endgame", label: "Endgame", short: "End", fill: "var(--color-chart-3)", text: "text-success" },
] as const;

/** OPR across this season's events. Rising = green, falling = red, flat = gold. Null when under two events. */
export function OprSpark({ events, className, interactive = false, width = 120, height = 28 }: { events: ShortlistEventPoint[]; className?: string; interactive?: boolean; width?: number; height?: number }) {
  const pts = events.filter((e) => e.opr != null);
  if (pts.length < 2) {
    return <span className={cn("text-[11px] text-text-muted", className)}>{pts.length ? "1 event" : "No events yet"}</span>;
  }
  const data = pts.map((e) => Math.round(e.opr! * 10) / 10);
  const delta = data[data.length - 1] - data[0];
  const tone = Math.abs(delta) < 2 ? "accent" : delta > 0 ? "success" : "danger";
  return (
    <div className={cn("min-w-0 [&_figcaption]:sr-only", className)}>
      <Sparkline data={data} label="OPR by event" value={num(data[data.length - 1])} change={`${delta >= 0 ? "+" : ""}${num(delta)} since ${pts[0].name}`}
        labels={pts.map((e) => e.name)} tone={tone} width={width} height={height} interactive={interactive} />
    </div>
  );
}

/** One stacked bar: auto / DC / endgame shares of OPR, with the numbers under it. */
export function BreakdownBar({ auto, teleop, endgame, className }: { auto: number | null; teleop: number | null; endgame: number | null; className?: string }) {
  const v = { auto: Math.max(0, auto ?? 0), teleop: Math.max(0, teleop ?? 0), endgame: Math.max(0, endgame ?? 0) };
  const sum = v.auto + v.teleop + v.endgame;
  if (auto == null && teleop == null && endgame == null) return <p className={cn("text-sm text-text-muted", className)}>No OPR split yet this season.</p>;
  return (
    <div className={className}>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={PARTS.map((p) => `${p.label} ${num(v[p.k])}`).join(", ")}>
        {PARTS.map((p) => sum > 0 && v[p.k] > 0 && (
          <div key={p.k} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(v[p.k] / sum) * 100}%`, background: p.fill }} />
        ))}
      </div>
      <dl className="mt-2.5 grid grid-cols-3 gap-2">
        {PARTS.map((p) => (
          <div key={p.k} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[11px] text-text-muted"><span className="size-2 shrink-0 rounded-full" style={{ background: p.fill }} />{p.label}</dt>
            <dd className={cn("font-display text-lg font-semibold tabular-nums", p.text)}>{num(v[p.k])}<span className="ml-1 text-[11px] font-normal text-text-muted">{sum > 0 ? `${Math.round((v[p.k] / sum) * 100)}%` : ""}</span></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Event by event: a stacked column per event (auto / DC / endgame event OPR), the OPR on top. */
export function EventPointsChart({ events, className }: { events: ShortlistEventPoint[]; className?: string }) {
  const pts = events.filter((e) => e.opr != null).slice(-8);
  if (!pts.length) return <p className={cn("text-sm text-text-muted", className)}>No events with results yet this season.</p>;
  const parts = (e: ShortlistEventPoint) => PARTS.map((p) => Math.max(0, e[p.k] ?? 0));
  const height = (e: ShortlistEventPoint) => Math.max(e.opr ?? 0, parts(e).reduce((a, b) => a + b, 0));
  const max = Math.max(...pts.map(height), 1);
  return (
    <div className={cn("flex h-40 items-end gap-1.5 sm:gap-2", className)} role="img"
      aria-label={`OPR by event: ${pts.map((e) => `${e.name} ${num(e.opr)}`).join("; ")}`}>
      {pts.map((e) => {
        const ps = parts(e), sum = ps.reduce((a, b) => a + b, 0) || 1;
        return (
          <div key={e.code} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={`${e.name}: OPR ${num(e.opr)} (auto ${num(e.auto)}, DC ${num(e.teleop)}, endgame ${num(e.endgame)})${e.rank ? `, ranked #${e.rank}` : ""}`}>
            <span className="text-[11px] font-semibold tabular-nums text-text-base">{num(e.opr, 0)}</span>
            <div className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-md bg-muted" style={{ height: `${Math.max(4, (height(e) / max) * 100)}px` }}>
              {PARTS.map((p, i) => ps[i] > 0 && <div key={p.k} style={{ height: `${(ps[i] / sum) * 100}%`, background: p.fill }} />)}
            </div>
            <span className="w-full truncate text-center text-[10px] text-text-muted">{e.code}</span>
          </div>
        );
      })}
    </div>
  );
}
