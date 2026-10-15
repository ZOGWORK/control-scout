// One-tap preset chips above the records tables ("Elite OPR", "Clean drivers"…).
// EDIT HERE to add, change or remove a chip — nothing else needs to change.
//
// Each chip is a list of conditions, all of which must hold (AND). A condition
// is either a fixed value, or a per-season threshold:
//   thresholds: { 2025: 80 }  the value for that season (picked from the data:
//                             roughly the top 10% of team-events with 3+ matches)
//   topPct: 10                for any season not listed, the app looks up the
//                             value that the top 10% reach (so 2019–2022 and
//                             new seasons work without editing this file)
// Keys are stat catalog keys (src/shared/statCatalog.ts); a test checks every
// key exists for the chip's tables. `predictableOnly` hides a chip in seasons
// without predictions (2019–2022).
import type { NumberOp } from "../shared/filterDsl";
import type { Tone } from "../lib/records/describe";

export type PresetCondition =
  | { key: string; op: NumberOp; value: number }
  | { key: string; op: "gte" | "lte"; thresholds: Record<number, number>; topPct: number };

export interface FilterPreset {
  id: string;
  label: string;
  /** Shown on hover and under the chip in the builder. */
  description: string;
  /** Which tables show it: team records (team-event and team-season) or match records. */
  kind: "team" | "match";
  tone: Tone;
  conditions: PresetCondition[];
  predictableOnly?: boolean;
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: "elite-opr", label: "Elite OPR", kind: "team", tone: "violet",
    description: "Top ~10% by OPR without penalties (npOPR).",
    conditions: [{ key: "totalPointsNpOpr", op: "gte", thresholds: { 2023: 80, 2024: 100, 2025: 80, 2026: 45 }, topPct: 10 }],
  },
  {
    id: "clean-drivers", label: "Clean drivers", kind: "team", tone: "rose",
    description: "Gives away under 2 penalty points a match (penalty OPR < 2), over 3+ matches.",
    conditions: [{ key: "penaltyPointsCommittedOpr", op: "lt", value: 2 }, { key: "qualMatchesPlayed", op: "gte", value: 3 }],
  },
  {
    id: "auto-specialists", label: "Auto specialists", kind: "team", tone: "sky",
    description: "Top ~10% by auto OPR.",
    conditions: [{ key: "autoPointsOpr", op: "gte", thresholds: { 2023: 33, 2024: 22, 2025: 25, 2026: 15 }, topPct: 10 }],
  },
  {
    id: "strong-endgame", label: "Strong endgame", kind: "team", tone: "emerald",
    description: "Top ~10% by endgame OPR.",
    conditions: [{ key: "endgamePointsOpr", op: "gte", thresholds: { 2023: 29, 2024: 14, 2025: 9, 2026: 6 }, topPct: 10 }],
  },
  {
    id: "favourites", label: "Favourites", kind: "team", tone: "gold", predictableOnly: true,
    description: "Control Scout gave their alliance a 70%+ average win chance before each match.",
    conditions: [{ key: "predictedWinPctAvg", op: "gte", value: 70 }],
  },
  {
    id: "close-games", label: "Nail-biters", kind: "match", tone: "orange",
    description: "Decided by 5 points or fewer.",
    conditions: [{ key: "winningMargin", op: "lte", value: 5 }],
  },
  {
    id: "blowouts", label: "Blowouts", kind: "match", tone: "red",
    description: "The biggest winning margins (top ~10%).",
    conditions: [{ key: "winningMargin", op: "gte", thresholds: {}, topPct: 10 }],
  },
  {
    id: "high-scores", label: "High scores", kind: "match", tone: "violet",
    description: "The highest-scoring matches (top ~5% by high score).",
    conditions: [{ key: "highScore", op: "gte", thresholds: {}, topPct: 5 }],
  },
];
