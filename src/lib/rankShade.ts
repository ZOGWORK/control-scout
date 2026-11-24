// The event Rankings table's colours (owner, 11-23): rank, RS and TBP shade smoothly from green (the best in this
// event) to red (the worst) by value; wins read green, losses red, ties neutral. Nothing else in that table takes a
// colour, so green and red mean only where a team stands. Both ends are the site's readable status text tokens
// (index.css: --color-success-text / --color-danger-text, a deeper shade on Light), mixed in OKLab, so every step
// between them stays as readable as the ends in Light, Dim, Dark and the classic look (rankShade.test.ts).

/** The ranking columns that shade, and whether a lower value is better. Event tables (RecordsTable keys) and the
 *  standings fallback (RankingTable keys) both. */
export const SHADE_COLS: Readonly<Record<string, { lowerIsBetter: boolean }>> = {
  rank: { lowerIsBetter: true },
  rp: { lowerIsBetter: false },
  rs: { lowerIsBetter: false },
  tb1: { lowerIsBetter: false },
};

/** Wins, losses and ties: the site's status tones (text-success / text-danger swap to their deeper -text shade on Light). */
export const WLT_TONE = { wins: "text-success", losses: "text-danger", ties: "text-text-muted" } as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Where `v` sits between the column's worst and best value: 1 = best, 0 = worst, linear by value in between.
 * Null for a blank cell, or when the column has fewer than two different values (nothing to tell apart).
 */
export function shadeT(values: readonly unknown[], v: unknown, lowerIsBetter = false): number | null {
  if (!finite(v)) return null;
  let lo = Infinity, hi = -Infinity;
  for (const x of values) if (finite(x)) { if (x < lo) lo = x; if (x > hi) hi = x; }
  if (!(hi > lo)) return null;
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return lowerIsBetter ? 1 - t : t;
}

/** The text colour for a position on the scale: green at 1, red at 0, an OKLab mix of the two in between.
 *  Undefined for a position that isn't a number (NaN, ±Infinity), so a caller never sets an invalid colour. */
export function shadeColour(t: number): string | undefined {
  if (!Number.isFinite(t)) return undefined;
  const pct = Math.round(Math.min(1, Math.max(0, t)) * 100);
  return `color-mix(in oklab, var(--color-success-text) ${pct}%, var(--color-danger-text))`;
}

/** A column's shader over the rows shown: value → inline colour (undefined for blanks or a flat column). */
export function columnShade(values: readonly unknown[], lowerIsBetter: boolean): (v: unknown) => string | undefined {
  return (v) => {
    const t = shadeT(values, v, lowerIsBetter);
    return t == null ? undefined : shadeColour(t);
  };
}
