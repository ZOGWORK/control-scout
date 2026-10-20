// GET /api/directory/:season?country=US&q=robo&sort=name&dir=asc&page=2: the team
// directory, every team registered for a season whether or not it has played,
// optionally from one country. A country here is the same set of teams the home
// page's atlas counts (countries.ts normalisation, via countryLabels), and the
// totals are counted with the same joins, so the two pages agree. Teams with
// results are flagged, never filtered: the statistical tables (/teams?view=season)
// keep their own denominator.
// ?q= searches inside that season and country: a team's number (exact, or starting with the digits
// typed) or the words of its name, city and state (case- and accent-blind, word prefixes, every word
// must match). Words come from the team_search full-text index (migration 30); numbers from the
// season's own rows (team_seasons' primary key), so the work is bounded by one season's listings.
import { all, get } from "../db.js";
import { countryLabels } from "./records.js";
import { cachedReadiness } from "./readiness.js";
import { homeOverview } from "./home.js";
import { countryByCode } from "../../src/shared/countries.js";
import { DIRECTORY_MAX_PAGE_SIZE, DIRECTORY_PAGE_SIZE, DIRECTORY_SORTS, directorySearchProblem, directorySearchWords, type DirectoryPage, type DirectorySort } from "../../src/shared/directory.js";

export class DirectoryQueryError extends Error {}

export interface DirectoryQuery {
  country: string | null;
  /** The search, trimmed (null for none), and its words (letters and digits only). */
  q: string | null;
  words: string[];
  sort: DirectorySort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** The direction a sort starts in: teams with results first; everything else A→Z, low→high. */
export const defaultDirectoryDir = (sort: DirectorySort): "asc" | "desc" => (sort === "results" ? "desc" : "asc");

const one = (q: Record<string, unknown>, k: string): string | null => {
  const v = q[k];
  if (v == null) return null;
  if (Array.isArray(v) || typeof v !== "string") throw new DirectoryQueryError(`${k} is given more than once`);
  return v;
};
const whole = (raw: string | null, name: string, min: number, max: number, fallback: number) => {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new DirectoryQueryError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};

export function directoryQuery(q: Record<string, unknown>): DirectoryQuery {
  const countryRaw = one(q, "country");
  const country = countryRaw == null || countryRaw === "" ? null : countryByCode(countryRaw)?.code ?? null;
  if (countryRaw && !country) throw new DirectoryQueryError("country must be a country code like US or GB");
  const qRaw = (one(q, "q") ?? "").trim();
  const problem = directorySearchProblem(qRaw);
  if (problem) throw new DirectoryQueryError(problem);
  const sortRaw = one(q, "sort");
  if (sortRaw != null && !(DIRECTORY_SORTS as readonly string[]).includes(sortRaw)) throw new DirectoryQueryError(`sort must be one of ${DIRECTORY_SORTS.join(", ")}`);
  const sort = (sortRaw ?? "team") as DirectorySort;
  const dirRaw = one(q, "dir");
  if (dirRaw != null && dirRaw !== "asc" && dirRaw !== "desc") throw new DirectoryQueryError("dir must be asc or desc");
  return {
    country, q: qRaw || null, words: directorySearchWords(qRaw), sort, dir: dirRaw ?? defaultDirectoryDir(sort),
    page: whole(one(q, "page"), "page", 1, 100000, 1),
    pageSize: whole(one(q, "pageSize"), "pageSize", 1, DIRECTORY_MAX_PAGE_SIZE, DIRECTORY_PAGE_SIZE),
  };
}

/** The SQL a search adds (every word must match) and its arguments. A word of digits also matches a team
 *  whose number starts with it (so "123" finds 123, 1234 and 12345). A word is only letters and digits
 *  (directorySearchWords), quoted as one full-text prefix term: never SQL, never full-text syntax. */
function searchWhere(q: DirectoryQuery): { sql: string; args: string[] } | null {
  if (!q.q) return null;
  // A search with no letters or digits ("!!") matches nothing, rather than everything.
  if (!q.words.length) return { sql: "0", args: [] };
  const parts: string[] = [];
  const args: string[] = [];
  const text = q.words.filter((w) => !/^\d+$/.test(w));
  if (text.length) {
    parts.push("ts.team IN (SELECT rowid FROM team_search WHERE team_search MATCH ?)");
    args.push(text.map((w) => `"${w}"*`).join(" AND "));
  }
  for (const w of q.words.filter((w) => /^\d+$/.test(w))) {
    parts.push("(CAST(ts.team AS TEXT) LIKE ? OR ts.team IN (SELECT rowid FROM team_search WHERE team_search MATCH ?))");
    args.push(`${w}%`, `"${w}"*`);
  }
  return { sql: parts.join(" AND "), args };
}

/** ORDER BY for a sort: its key in the asked direction, blanks always last, then the team number. */
function orderBy(sort: DirectorySort, dir: "asc" | "desc"): string {
  const d = dir === "desc" ? "DESC" : "ASC";
  switch (sort) {
    case "name": return `(t.name IS NULL OR t.name = '') ASC, t.name COLLATE NOCASE ${d}, ts.team ASC`;
    case "rookie": return `(t.rookie_year IS NULL) ASC, t.rookie_year ${d}, ts.team ASC`;
    case "location": return `(t.country IS NULL OR trim(t.country) = '') ASC, t.country COLLATE NOCASE ${d}, t.state COLLATE NOCASE ${d}, t.city COLLATE NOCASE ${d}, ts.team ASC`;
    case "results": return `(r.team IS NOT NULL) ${d}, ts.team ASC`;
    default: return `ts.team ${d}`;
  }
}

export async function listDirectory(season: number, q: DirectoryQuery): Promise<DirectoryPage> {
  const where = ["ts.season = ?"];
  const args: (string | number)[] = [season];
  if (q.country) {
    const labels = await countryLabels(q.country);
    if (!labels.length) where.push("0");
    else { where.push(`t.country IN (${labels.map(() => "?").join(", ")})`); args.push(...labels); }
  }
  // Same joins as the atlas's counts (home.ts): team_seasons is one row per team, the records one per team.
  const joins = `FROM team_seasons ts
    LEFT JOIN teams t ON t.number = ts.team
    LEFT JOIN team_season_records r ON r.season = ts.season AND r.team = ts.team`;
  const from = `${joins} WHERE ${where.join(" AND ")}`;
  // A search narrows the rows and pages; the totals stay the whole season and country's ("12 of 9,450").
  const search = searchWhere(q);
  const rowsFrom = search ? `${from} AND (${search.sql})` : from;
  const rowArgs = search ? [...args, ...search.args] : args;
  const [counts, matched, rows, readiness, overview] = await Promise.all([
    get<{ total: number; withResults: number }>(`SELECT COUNT(*) total, COUNT(r.team) withResults ${from}`, args),
    search ? get<{ n: number }>(`SELECT COUNT(*) n ${rowsFrom}`, rowArgs) : null,
    all<{ team: number; name: string | null; city: string | null; state: string | null; country: string | null; rookie_year: number | null; has: number }>(
      `SELECT ts.team, t.name, t.city, t.state, t.country, t.rookie_year, (r.team IS NOT NULL) has ${rowsFrom}
       ORDER BY ${orderBy(q.sort, q.dir)} LIMIT ? OFFSET ?`, [...rowArgs, q.pageSize, (q.page - 1) * q.pageSize]),
    cachedReadiness(season),
    homeOverview(season),
  ]);
  const total = Number(counts?.total ?? 0);
  return {
    season, country: q.country, q: q.q,
    total, withResults: Number(counts?.withResults ?? 0), matched: search ? Number(matched?.n ?? 0) : total,
    unplaced: overview.unmapped.reduce((a, u) => a + u.listings, 0),
    page: q.page, pageSize: q.pageSize, sort: q.sort, dir: q.dir, readiness,
    rows: rows.map((r) => ({
      team: Number(r.team), name: r.name ?? null, city: r.city ?? null, state: r.state ?? null, country: r.country ?? null,
      rookieYear: r.rookie_year == null ? null : Number(r.rookie_year), hasResults: !!Number(r.has),
    })),
  };
}
