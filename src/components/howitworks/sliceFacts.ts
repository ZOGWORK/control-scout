// Numbers How it works quotes from the latest stored slice report (docs/engine/slices), so the page
// never states a figure the report doesn't hold. A test re-reads the report and checks every value here.

/** The report these figures come from (engine version and pinned corpus). */
export const SLICE_REPORT = "engine-2.11.0-snapshot-2026-10-14";

/** 2025–26, matches at rated events, the live engine. */
export const SLICE_FACTS = {
  season: "2025–26",
  accuracy: 0.7479,
  thin: { shareMatches: 0.295, shareBrier: 0.329, accuracy: 0.709 },
  dense: { accuracy: 0.760 },
  firstTenQuals: { shareMatches: 0.315, shareBrier: 0.342, accuracy: 0.719 },
  lateQuals: { accuracy: 0.761 },
} as const;
