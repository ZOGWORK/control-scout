// The Compare page's address (/compare?teams=4215,7149&season=2025) read the one way, by the page (src/pages/ComparePage.tsx)
// and by the server drawing its first paint (server/firstPaint.ts), so both ask the API for exactly the same answer.

/** The most teams a comparison holds. */
export const COMPARE_MAX = 4;

/** The teams in ?teams=, as plain numbers ("04215" is 4215), each once, at most COMPARE_MAX. */
export function compareTeamsOf(v: string | null): string[] {
  return [...new Set((v ?? "").split(",").filter((x) => /^\d+$/.test(x) && Number(x) > 0).map((x) => String(Number(x))))].slice(0, COMPARE_MAX);
}

/** The season asked for in ?season= (null: none, the API picks the latest the teams have results in). */
export const compareSeasonOf = (v: string | null): number | null => Number(v) || null;

/** The API path the page asks for these teams: in one fixed order (so reordering the columns asks nothing new), the season
 *  only when asked for. The same string on the server and in the app, so the first paint's answer is the one the app reads. */
export function compareApiPath(teams: string[], season: number | null): string {
  const p = new URLSearchParams();
  p.set("teams", [...teams].sort((a, b) => Number(a) - Number(b)).join(","));
  if (season != null) p.set("season", String(season));
  return `/api/compare?${p.toString()}`;
}
