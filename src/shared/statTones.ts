// Stat colours shared by the records tables (src/components/records) and their Excel export
// (server/api/records.ts): each column's colour family, and the five green-to-red bands a number
// takes from where it stands among the rows.
import type { StatDef } from "./statCatalog";

/** Colour families for stat columns (coloured headers, our palette). */
export type Tone = "gold" | "red" | "blue" | "green" | "violet" | "sky" | "orange" | "emerald" | "rose" | "pink" | "slate" | "redAlliance" | "blueAlliance";

export function toneOf(def: StatDef | undefined): Tone {
  if (!def) return "slate";
  if (def.category === "Control Scout Exclusives") return "gold";
  if (def.key.startsWith("red") && def.category === "Match Scores") return "redAlliance";
  if (def.key.startsWith("blue") && def.category === "Match Scores") return "blueAlliance";
  switch (def.base) {
    case "totalPoints": case "totalPointsNp": return "violet";
    case "autoPoints": return "sky";
    case "dcPoints": return "orange";
    case "endgamePoints": return "emerald";
    case "penaltyPointsCommitted": return "rose";
    case "penaltyPointsByOpp": return "pink";
  }
  switch (def.key) {
    case "rank": return "gold";
    case "rp": return "red";
    case "tb1": return "blue";
    case "qualMatchesPlayed": case "wins": case "losses": case "ties": case "events": return "green";
    case "winningMargin": case "highScore": case "combinedScore": return "violet";
  }
  return "slate";
}

/** Each tone as plain hex on white (the light theme's): readable text, and the brighter bar/underline colour. */
export const TONE_HEX: Record<Tone, { text: string; bar: string }> = {
  gold: { text: "875200", bar: "EAB308" },
  red: { text: "B91C1C", bar: "EF4444" },
  blue: { text: "2563EB", bar: "3B82F6" },
  green: { text: "166534", bar: "22C55E" },
  violet: { text: "7C3AED", bar: "8B5CF6" },
  sky: { text: "0369A1", bar: "38BDF8" },
  orange: { text: "C2410C", bar: "FB923C" },
  emerald: { text: "047857", bar: "34D399" },
  rose: { text: "BE123C", bar: "F43F5E" },
  pink: { text: "BE185D", bar: "F472B6" },
  slate: { text: "52525B", bar: "A1A1AA" },
  redAlliance: { text: "BE123C", bar: "F43F5E" },
  blueAlliance: { text: "0369A1", bar: "0EA5E9" },
};

/** Not coloured green/red: counts that say how much a team played, not how well. */
export const NO_HEAT = new Set(["qualMatchesPlayed", "ties", "rookieYear"]);

/** Fewer values than this, or all one value: the column isn't banded. */
export const HEAT_MIN = 4;

/** Whether a column gets green/red bands (a number that says how well, not how much). */
export const heatable = (def: StatDef | undefined): def is StatDef => !!def && def.type === "number" && !NO_HEAT.has(def.key);

/**
 * Which of five bands `v` falls in among `sorted` (ascending): 0 is the best fifth, 4 the worst, flipped for
 * lower-is-better stats. Its share of the values below it, ties counting half, so equal values share a band.
 */
export function heatBand(sorted: ArrayLike<number>, v: number, lowerIsBetter?: boolean): number {
  const n = sorted.length;
  const bound = (strict: boolean) => {
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (strict ? sorted[m] < v : sorted[m] <= v) lo = m + 1; else hi = m; }
    return lo;
  };
  const below = bound(true), same = bound(false) - below;
  let q = (below + (same - 1) / 2) / (n - 1);
  if (lowerIsBetter) q = 1 - q;
  return Math.max(0, Math.min(4, Math.floor((1 - q) * 5)));
}
