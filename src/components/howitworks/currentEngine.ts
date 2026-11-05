// The engine serving predictions today, scored by the rolling monthly test of the November 2026 research
// (docs/engine/research-2026-11/signoff-report.md §2): each month from Oct 2024 to Jul 2026 is predicted by
// models fitted only on the 365 days before it, on decisive matches at rated events. Win odds have not moved
// since 3.3.0 (3.4.0 and 3.5.0 are bit-identical on every probability), so Brier and accuracy are 3.3.0's
// served calls; margin error is 3.5.0's, from its gate (docs/engine/gates/gate-3.5.0-margin-scale-*.md).
// Kept here, not in the engine's model file, so updating it needs no engine release.

export interface CurrentEngineRow {
  season: string;
  /** "tuning" was used to pick settings; "reused" has been examined before, so it isn't a clean test. */
  role: "tuning" | "reused";
  /** Decisive matches scored for Brier and accuracy. */
  matches: number;
  brier: number;
  accuracy: number;
  /** Matches with a predicted score, for margin error. */
  marginMatches: number;
  marginMae: number;
  /** Margin error before the 3.5.0 margin scale, same matches. */
  marginMaeBefore: number;
}

export const CURRENT_ENGINE = { version: "3.5", test: "rolling monthly test" } as const;

export const CURRENT_ENGINE_ROWS: CurrentEngineRow[] = [
  { season: "2024–25", role: "tuning", matches: 32974, brier: 0.1578, accuracy: 0.7654, marginMatches: 33271, marginMae: 38.64, marginMaeBefore: 38.75 },
  { season: "2025–26", role: "reused", matches: 36572, brier: 0.1681, accuracy: 0.7479, marginMatches: 36842, marginMae: 37.26, marginMaeBefore: 37.36 },
];
