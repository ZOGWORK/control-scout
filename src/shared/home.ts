// The home page's public aggregates: one season's coverage and where its teams
// are from (GET /api/home/overview), and the opt-in usage totals Control Scout
// publishes about itself (GET /api/public-usage). Both are shared, cacheable and
// carry nothing about any one visitor.

/** One country's teams in a season (countries are normalised: see countries.ts). */
export interface CountryTotal {
  /** ISO 3166-1 alpha-2, the value /teams?country= takes. */
  code: string;
  /** ISO 3166-1 numeric, for matching boundary geometry. */
  numeric: string;
  name: string;
  /** Teams registered for the season whose directory entry reports this country (each team once). */
  listings: number;
  /** Of those, teams with a team-season record (played qualification matches): the rows /teams?view=season&country= lists. */
  withResults: number;
}

/** Listings whose reported country isn't one we can place (blank, "Independent", an unrecognised label). */
export interface UnmappedTotal {
  /** The label as the directory reports it; null when it reports none. */
  label: string | null;
  listings: number;
}

/**
 * Whether a season's derived statistics (the team records behind "teams with results") are in step
 * with its source results. Counts drawn from the records are only a fact when this is "ready".
 * - "ready": the statistics were prepared after the latest synced results (or nothing has been played).
 * - "preparing": results have been played, but no statistics exist for the season yet (a fresh restore,
 *   a first run): every results count would read zero, so none is shown.
 * - "catching-up": statistics exist, but results were synced again after they were prepared: counts
 *   are from the last preparation and may be behind until the next one finishes.
 */
export type ReadinessState = "ready" | "preparing" | "catching-up";

export interface SeasonReadiness {
  state: ReadinessState;
  /** When the season's results were last synced from the source (null: never, or unknown). */
  resultsAt: string | null;
  /** When the season's statistics were last prepared (null: never, or unknown). */
  statsAt: string | null;
}

export interface HomeOverview {
  season: number;
  /** When this response was built (server clock). */
  generatedAt: string;
  /** When FTC data was last synced, and when the season's stats/records were last rebuilt (null: never). */
  dataAsOf: string | null;
  statsAt: string | null;
  coverage: {
    /** Teams registered for the season (team_seasons: each team once). */
    teamListings: number;
    /** Competition events listed for the season (kickoffs, workshops and other no-match events left out). */
    events: number;
    /** Matches with a recorded score this season. */
    matchScores: number;
  };
  /** Whether the withResults counts can be read as facts (see SeasonReadiness). */
  readiness: SeasonReadiness;
  /** Countries with at least one listing, most listings first. */
  countries: CountryTotal[];
  /** Listings no country can be given to: Σ countries + Σ unmapped = coverage.teamListings. */
  unmapped: UnmappedTotal[];
}

/** Why public usage isn't shown. */
export type PublicUsageUnavailable =
  /** The owner hasn't turned publishing on (PUBLIC_USAGE_ENABLED). */
  | "not-published"
  /** Publishing is on but nothing has been collected yet. */
  | "no-data"
  /** The aggregates couldn't be read. */
  | "error";

export interface PublicUsageDay {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  pageViews: number;
  sessionStarts: number;
}

export interface PublicUsage {
  status: "available" | "unavailable";
  /** Set when status is "unavailable". */
  reason: PublicUsageUnavailable | null;
  /** The window's first and last UTC days (inclusive). `to` is today, so it's still partial. */
  from: string;
  to: string;
  /** The day counting began (the first recorded day), when it falls inside the window: earlier days weren't measured. */
  measuredFrom: string | null;
  generatedAt: string;
  /** The moment the totals run to (they're live aggregates, so the time they were read). Null when unavailable. */
  measuredThrough: string | null;
  /** Only visitors who said yes to anonymous statistics are counted. */
  coverage: "opt-in";
  /** Null when unavailable: never a stand-in zero. */
  totals: { pageViews: number; sessionStarts: number } | null;
  /** Every measured day in the window (zero days included), oldest first; empty when unavailable. */
  daily: PublicUsageDay[];
}

/** Days in the public usage window. */
export const PUBLIC_USAGE_DAYS = 30;
