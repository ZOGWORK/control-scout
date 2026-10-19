// The team directory (GET /api/directory/:season, the /teams?view=listed page):
// every team registered for a season, results or not, optionally from one
// country. Its totals are counted the way the home page's atlas counts them, so
// a country's numbers match on both pages.
import type { SeasonReadiness } from "./home";

export const DIRECTORY_SORTS = ["team", "name", "rookie", "location", "results"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];
export const DIRECTORY_PAGE_SIZE = 50;
export const DIRECTORY_MAX_PAGE_SIZE = 100;

export interface DirectoryTeam {
  team: number;
  /** Null when the directory has no entry for a registered number. */
  name: string | null;
  city: string | null;
  state: string | null;
  /** The country as the directory reports it (free text, possibly blank). */
  country: string | null;
  rookieYear: number | null;
  /** Has a team-season record (scored qualification matches) this season. Only a fact when readiness is "ready". */
  hasResults: boolean;
}

export interface DirectoryPage {
  season: number;
  /** ISO alpha-2, or null for every country. */
  country: string | null;
  /** Teams registered for the season (from this country): the same count as the atlas's listings. */
  total: number;
  /** Of those, teams with results: the same count as the atlas's withResults. */
  withResults: number;
  /** Registered teams whose reported country can't be placed (blank, "Independent", unknown labels); season-wide. */
  unplaced: number;
  page: number;
  pageSize: number;
  sort: DirectorySort;
  dir: "asc" | "desc";
  readiness: SeasonReadiness;
  rows: DirectoryTeam[];
}
