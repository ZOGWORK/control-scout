// A four-axis radar (src/shared/pickRadar.ts): Auto at the top, then TeleOp, Endgame and Few fouls clockwise.
// The alliance so far is the dashed outline; with a partner, the filled shape is the alliance it makes.
import { PICK_AXES, PICK_AXIS_LABEL, type Axes } from "../../../shared/pickRadar";

const C = 100;
const R = 62;
const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / PICK_AXES.length;
const at = (i: number, r: number) => [C + Math.cos(angle(i)) * R * r, C + Math.sin(angle(i)) * R * r] as const;
const points = (a: Axes) => PICK_AXES.map((k, i) => at(i, a[k]).map((x) => x.toFixed(1)).join(",")).join(" ");

/** Label spots: above, right, below, left. */
const LABEL = [
  { x: C, y: C - R - 10, anchor: "middle" },
  { x: C + R + 6, y: C + 4, anchor: "start" },
  { x: C, y: C + R + 18, anchor: "middle" },
  { x: C - R - 6, y: C + 4, anchor: "end" },
] as const;

export function PickRadar({ current, result, label, className }: {
  /** The alliance so far. */
  current: Axes;
  /** The alliance with this partner (none: the current alliance is the filled shape). */
  result?: Axes;
  label: string;
  className?: string;
}) {
  const filled = result ?? current;
  return (
    <svg viewBox="-24 0 248 200" role="img" aria-label={label} className={className}>
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={PICK_AXES.map((_, i) => at(i, r).join(",")).join(" ")} fill="none" className="stroke-border" strokeWidth={1} />
      ))}
      {PICK_AXES.map((_, i) => { const [x, y] = at(i, 1); return <line key={i} x1={C} y1={C} x2={x} y2={y} className="stroke-border" strokeWidth={1} />; })}
      <polygon points={points(filled)} className="fill-accent/25 stroke-accent" strokeWidth={2} strokeLinejoin="round" />
      {result && <polygon points={points(current)} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />}
      {PICK_AXES.map((k, i) => (
        <text key={k} x={LABEL[i].x} y={LABEL[i].y} textAnchor={LABEL[i].anchor} className="fill-muted-foreground text-[11px]">
          {PICK_AXIS_LABEL[k]} <tspan className="fill-foreground font-semibold tabular-nums">{Math.round(filled[k] * 100)}</tspan>
        </text>
      ))}
    </svg>
  );
}
