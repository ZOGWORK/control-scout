// The team directory (GET /api/directory/:season, the /teams?view=listed page):
// every team registered for a season, results or not, optionally from one
// country. Its totals are counted the way the home page's atlas counts them, so
// a country's numbers match on both pages.
import type { SeasonReadiness } from "./home";

export const DIRECTORY_SORTS = ["team", "name", "rookie", "location", "results"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];
export const DIRECTORY_PAGE_SIZE = 50;
export const DIRECTORY_MAX_PAGE_SIZE = 100;
/** The longest ?q= the directory takes, and the most words in one. */
export const DIRECTORY_QUERY_MAX = 64;
export const DIRECTORY_QUERY_MAX_WORDS = 6;

/** A search's words: case- and accent-folded, split at anything that isn't a letter or digit (as the
 *  server's index splits names), so "  Équipe-Robo! " is ["equipe", "robo"]. Only letters and digits
 *  survive, so a word can never carry SQL or full-text syntax. */
export function directorySearchWords(q: string): string[] {
  return q.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Why a ?q= can't be searched (null when it can): too long, a control character, or too many words. */
export function directorySearchProblem(q: string): string | null {
  if (q.length > DIRECTORY_QUERY_MAX) return `Search is limited to ${DIRECTORY_QUERY_MAX} characters`;
  if (/\p{Cc}/u.test(q)) return "Search can't contain control characters";
  if (directorySearchWords(q).length > DIRECTORY_QUERY_MAX_WORDS) return `Search is limited to ${DIRECTORY_QUERY_MAX_WORDS} words`;
  return null;
}

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
  /** The search these rows answer (trimmed), or null for no search. Matches a team's number (exact or
   *  starting with a number typed) or words of its name, city and state; always inside the season and country. */
  q?: string | null;
  /** Teams in the season and country that match q: what the rows and pages are counted from (total without q).
   *  Optional so an answer from before search existed still draws (as matched = total). */
  matched?: number;
  /** Registered teams whose reported country can't be placed (blank, "Independent", unknown labels); season-wide. */
  unplaced: number;
  page: number;
  pageSize: number;
  sort: DirectorySort;
  dir: "asc" | "desc";
  readiness: SeasonReadiness;
  rows: DirectoryTeam[];
}

const isInt = (x: unknown): x is number => Number.isSafeInteger(x);
const isNullableString = (x: unknown) => x === null || typeof x === "string";

/** Is this a directory page the table can draw? Checked by the web app before it uses an answer (audit PUB3-F04):
 *  anything else (a null, a proxy's page, a cut-down object) shows as an error with Try again. */
export function isDirectoryPage(x: unknown): x is DirectoryPage {
  const d = x as DirectoryPage;
  return !!d && typeof d === "object"
    && isInt(d.season) && isNullableString(d.country)
    && isInt(d.total) && isInt(d.withResults)
    && (d.q === undefined || isNullableString(d.q)) && (d.matched === undefined || isInt(d.matched))
    && isInt(d.unplaced) && isInt(d.page) && isInt(d.pageSize) && d.pageSize > 0
    && (DIRECTORY_SORTS as readonly string[]).includes(d.sort) && (d.dir === "asc" || d.dir === "desc")
    && !!d.readiness && typeof d.readiness === "object" && typeof d.readiness.state === "string"
    && Array.isArray(d.rows) && d.rows.every((r) => !!r && typeof r === "object" && isInt(r.team) && typeof r.hasResults === "boolean");
}
