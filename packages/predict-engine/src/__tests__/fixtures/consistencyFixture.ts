// The consistency (swing) fixture: the engine's test, Control Scout's reliability-job test and Control Point's
// test (src/predict/__tests__/consistency.test.ts there) all run it and pin the same numbers.
import type { ConsistencyAlliance } from "../../consistency.js";

export const OPR: Record<number, number> = { 1: 40, 2: 30, 3: 20, 4: 10 };
/** Played qualification alliances in play order, red then blue per match. */
export const ALLIANCES: ConsistencyAlliance[] = [
  { np: 80, onField: [1, 2] }, { np: 30, onField: [3, 4] },
  { np: 50, onField: [1, 3] }, { np: 45, onField: [2, 4] },
  { np: 60, onField: [1, 4] }, { np: 55, onField: [2, 3] },
  { np: 64, onField: [1, 2] }, { np: 26, onField: [3, 4] },
  // 4 a no-show: 2 played alone, so neither gets a contribution from this match.
  { np: 66, onField: [1, 3] }, { np: 35, onField: [2] },
];
export const FIELD_VAR = 0.04;
/** Team → [contributions, swing to 12 places]. */
export const PINNED: Record<number, [number, string]> = { 1: [5, "0.243124151165"], 2: [4, "0.205183300301"], 3: [5, "0.206916109560"], 4: [4, "0.198766188424"] };
