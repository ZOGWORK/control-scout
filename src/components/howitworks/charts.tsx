// Shared hand-drawn SVG charts: horizontal bars and two-alliance bell curves.
import { Chart, useTip } from "./ui";
import { pdf, Z80 } from "./math";

export type Tone = "gold" | "red" | "blue" | "muted";
export const FILL: Record<Tone, string> = {
  gold: "var(--color-accent)",
  red: "var(--hiw-red)",
  blue: "var(--hiw-blue)",
  muted: "var(--hiw-muted)",
};

export interface HRow { label: string; v: number; tone?: Tone; dim?: boolean; strong?: boolean; tip?: string }

/** Horizontal bar chart (CP's hbar): labels left, value right of each bar. */
export function HBars({ rows, max, fmt, ticks, label, left = 180, rowH = 34, width = 640 }: {
  rows: HRow[]; max: number; fmt: (v: number) => string; ticks: number[]; label: string; left?: number; rowH?: number; width?: number;
}) {
  const tip = useTip();
  const top = 10, right = width - 64;
  const x = (v: number) => left + (v / max) * (right - left);
  const h = top + rows.length * rowH + 24;
  return (
    <Chart viewBox={`0 0 ${width} ${h}`} label={label} interactive>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top - 4} y2={top + rows.length * rowH} className="grid" />
          <text x={x(t)} y={top + rows.length * rowH + 16} textAnchor="middle">{fmt(t)}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = top + i * rowH;
        return (
          <g key={r.label}>
            <text x={left - 10} y={y + rowH / 2 + 4} textAnchor="end" className={r.strong ? "t-ink" : undefined}>{r.label}</text>
            <rect
              x={left} y={y + 6} width={Math.max(1, x(r.v) - left)} height={rowH - 12} rx={3}
              fill={FILL[r.tone ?? "muted"]} opacity={r.dim ? 0.45 : r.tone === "muted" || !r.tone ? 0.75 : 1}
              className="bar-h" style={{ ["--i" as string]: i }}
              {...tip(r.tip ?? `${r.label}: ${fmt(r.v)}`)}
            />
            <text x={x(r.v) + 8} y={y + rowH / 2 + 4} className={`${r.strong ? "t-ink " : ""}fade-late`}>{fmt(r.v)}</text>
          </g>
        );
      })}
    </Chart>
  );
}

/** Two alliance score curves with shaded 80% ranges. Returns SVG children only. */
export function Bells({ muR, muB, sR, sB, L, R, T, B, xmin = 0, xmax = 320, step = 40 }: {
  muR: number; muB: number; sR: number; sB: number; L: number; R: number; T: number; B: number; xmin?: number; xmax?: number; step?: number;
}) {
  const tip = useTip();
  const x = (v: number) => L + ((v - xmin) / (xmax - xmin)) * (R - L);
  const peak = Math.max(pdf(muR, muR, sR), pdf(muB, muB, sB));
  const y = (p: number) => B - (p / peak) * (B - T) * 0.92;
  const ticks: number[] = [];
  for (let v = xmin; v <= xmax; v += step) ticks.push(v);
  const curve = (m: number, s: number, c: "red" | "blue") => {
    const lo = Math.max(xmin, m - Z80 * s), hi = Math.min(xmax, m + Z80 * s);
    let area = `M${x(lo).toFixed(1)},${B}`;
    for (let v = lo; v <= hi; v += 1) area += `L${x(v).toFixed(1)},${y(pdf(v, m, s)).toFixed(1)}`;
    area += `L${x(hi).toFixed(1)},${y(pdf(hi, m, s)).toFixed(1)}L${x(hi).toFixed(1)},${B}Z`;
    let d = "";
    for (let v = xmin; v <= xmax; v += 1) d += `${v === xmin ? "M" : "L"}${x(v).toFixed(1)},${y(pdf(v, m, s)).toFixed(1)}`;
    const name = c === "red" ? "Red" : "Blue";
    const col = c === "red" ? "var(--hiw-red)" : "var(--hiw-blue)";
    return (
      <g key={c}>
        <path d={area} fill={col} opacity={0.16} {...tip(`${name} 80% range: ${Math.round(lo)}–${Math.round(hi)} pts`)} />
        <path d={d} fill="none" stroke={col} strokeWidth={3} pointerEvents="none" />
        <line x1={x(m)} x2={x(m)} y1={y(pdf(m, m, s))} y2={B} stroke={col} strokeDasharray="4 4" />
        <text x={x(m)} y={y(pdf(m, m, s)) - 8} textAnchor="middle" className={`t-big ${c === "red" ? "t-red" : "t-blue"}`}>{Math.round(m)}</text>
      </g>
    );
  };
  return (
    <>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={T} y2={B} className="grid" />
          <text x={x(v)} y={B + 16} textAnchor="middle">{v}</text>
        </g>
      ))}
      <line x1={L} x2={R} y1={B} y2={B} className="axis" />
      {curve(muB, sB, "blue")}
      {curve(muR, sR, "red")}
      <text x={(L + R) / 2} y={B + 34} textAnchor="middle">alliance score (points)</text>
    </>
  );
}
