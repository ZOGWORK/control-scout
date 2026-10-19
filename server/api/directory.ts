// GET /api/directory/:season?country=US&sort=name&dir=asc&page=2: the team
// directory, every team registered for a season whether or not it has played,
// optionally from one country. A country here is the same set of teams the home
// page's atlas counts (countries.ts normalisation, via countryLabels), and the
// totals are counted with the same joins, so the two pages agree. Teams with
// results are flagged, never filtered: the statistical tables (/teams?view=season)
// keep their own denominator.
import { all, get } from "../db.js";
import { countryLabels } from "./records.js";
import { cachedReadiness } from "./readiness.js";
import { homeOverview } from "./home.js";
import { countryByCode } from "../../src/shared/countries.js";
import { DIRECTORY_MAX_PAGE_SIZE, DIRECTORY_PAGE_SIZE, DIRECTORY_SORTS, type DirectoryPage, type DirectorySort } from "../../src/shared/directory.js";

export class DirectoryQueryError extends Error {}

export interface DirectoryQuery {
  country: string | null;
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
  const sortRaw = one(q, "sort");
  if (sortRaw != null && !(DIRECTORY_SORTS as readonly string[]).includes(sortRaw)) throw new DirectoryQueryError(`sort must be one of ${DIRECTORY_SORTS.join(", ")}`);
  const sort = (sortRaw ?? "team") as DirectorySort;
  const dirRaw = one(q, "dir");
  if (dirRaw != null && dirRaw !== "asc" && dirRaw !== "desc") throw new DirectoryQueryError("dir must be asc or desc");
  return {
    country, sort, dir: dirRaw ?? defaultDirectoryDir(sort),
    page: whole(one(q, "page"), "page", 1, 100000, 1),
    pageSize: whole(one(q, "pageSize"), "pageSize", 1, DIRECTORY_MAX_PAGE_SIZE, DIRECTORY_PAGE_SIZE),
  };
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
  const from = `FROM team_seasons ts
    LEFT JOIN teams t ON t.number = ts.team
    LEFT JOIN team_season_records r ON r.season = ts.season AND r.team = ts.team
    WHERE ${where.join(" AND ")}`;
  const [counts, rows, readiness, overview] = await Promise.all([
    get<{ total: number; withResults: number }>(`SELECT COUNT(*) total, COUNT(r.team) withResults ${from}`, args),
    all<{ team: number; name: string | null; city: string | null; state: string | null; country: string | null; rookie_year: number | null; has: number }>(
      `SELECT ts.team, t.name, t.city, t.state, t.country, t.rookie_year, (r.team IS NOT NULL) has ${from}
       ORDER BY ${orderBy(q.sort, q.dir)} LIMIT ? OFFSET ?`, [...args, q.pageSize, (q.page - 1) * q.pageSize]),
    cachedReadiness(season),
    homeOverview(season),
  ]);
  return {
    season, country: q.country,
    total: Number(counts?.total ?? 0), withResults: Number(counts?.withResults ?? 0),
    unplaced: overview.unmapped.reduce((a, u) => a + u.listings, 0),
    page: q.page, pageSize: q.pageSize, sort: q.sort, dir: q.dir, readiness,
    rows: rows.map((r) => ({
      team: Number(r.team), name: r.name ?? null, city: r.city ?? null, state: r.state ?? null, country: r.country ?? null,
      rookieYear: r.rookie_year == null ? null : Number(r.rookie_year), hasResults: !!Number(r.has),
    })),
  };
}
