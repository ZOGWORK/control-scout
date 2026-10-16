// Rising / Falling / Steady: one rule for every trend badge (team page trends, world rankings), so a
// team reads the same everywhere. A change under 8% of where it started is Steady.

export type TrendDir = "up" | "down" | "flat";

/** Steady band: a move smaller than this share of the starting value. */
export const STEADY_BAND = 0.08;

/** Direction from the first to the last known value (null with fewer than two). */
export function direction(vals: (number | null | undefined)[]): TrendDir | null {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return null;
  const first = xs[0], last = xs[xs.length - 1];
  const d = (last - first) / Math.max(1, Math.abs(first));
  return Math.abs(d) < STEADY_BAND ? "flat" : d > 0 ? "up" : "down";
}

/** The badge's word for a direction. */
export const trendLabel = (d: TrendDir) => (d === "up" ? "Rising" : d === "down" ? "Falling" : "Steady");
