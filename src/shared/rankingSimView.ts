// What the simulated rankings answer carries (src/shared/rankingSim.ts computes it): kept apart from the
// simulation so the page imports these without the engine.

/** Matches per team offered when there's no schedule yet (FTC events run 5 or 6 for most fields). */
export const PER_TEAM_CHOICES = [4, 5, 6, 7, 8, 9, 10] as const;
export const DEFAULT_PER_TEAM = 5;

export interface SimRankRow {
  team: number;
  /** Matches this season behind the team's rating: 0 means it's estimated (from earlier seasons, or a typical new team). */
  played: number;
  /** Mean simulated rank, and the 10th to 90th percentile range (80% of runs land inside). */
  mean: number;
  p10: number;
  p90: number;
  /** Share of runs ranked first, in the top 4, in the top 8. */
  first: number;
  top4: number;
  top8: number;
}

export interface SimRankResult {
  runs: number;
  /** "random": a fresh random schedule each run, perTeam matches each; "published": the event's own schedule. */
  schedule: "random" | "published";
  perTeam: number | null;
  teams: SimRankRow[];
}
