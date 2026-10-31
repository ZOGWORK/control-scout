// The full why breakdown (engine 3.3 factor sheet): every factor behind a call with its weight in it.
// Shared by the server (it stores the sheet with each live ledger call), the web app and the offline
// lite path, so all three show the same thing.
import { compactFactorSheet, type FactorSheet, type SheetFactor } from "@control-scout/predict-engine";

export type { FactorSheet, SheetFactor };

/** The sheet as stored and sent: log-odds and weights to 4 places (about 0.01 percentage points). */
export const compactSheet = compactFactorSheet;

/** A stored sheet (ledger column factor_sheet), or null for calls logged before engine 3.3 or a malformed value. */
export function parseSheet(json: string | null | undefined): FactorSheet | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as FactorSheet;
    return Array.isArray(s?.phases) && Array.isArray(s.model) && Array.isArray(s.reasons) ? s : null;
  } catch {
    return null;
  }
}

/** Did a factor point to the alliance that won? null when it pointed nowhere, or the match tied or isn't played. */
export function pointedRight(f: Pick<SheetFactor, "favors">, winner: "A" | "B" | "tie" | null): boolean | null {
  if (!winner || winner === "tie" || f.favors === "even") return null;
  return f.favors === winner;
}

/** Post-match review: of the factors that leaned one way, how many pointed to the winner, and the share of the call they carried. */
export function sheetReview(s: FactorSheet, winner: "A" | "B" | "tie" | null): { right: number; leaning: number; rightWeight: number } | null {
  if (!winner || winner === "tie") return null;
  const leaning = [...s.phases, ...s.model, ...s.reasons].filter((f) => f.favors !== "even");
  const right = leaning.filter((f) => f.favors === winner);
  return { right: right.length, leaning: leaning.length, rightWeight: right.reduce((a, f) => a + f.weight, 0) };
}

/** Who won a played match, in the sheet's sides (A = red). */
export const sheetWinner = (red: number, blue: number): "A" | "B" | "tie" => (red === blue ? "tie" : red > blue ? "A" : "B");
