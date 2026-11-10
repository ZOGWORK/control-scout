// A league's standings as the API sends them (server/api/leagues.ts): FIRST's official league rankings, the running
// standing over every meet of the league so far that season. A league is its region and code together.

export interface LeagueStandingRow {
  rank: number;
  team: number;
  name: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  /** The ranking score: FIRST's first sort key. */
  rs: number | null;
  /** FIRST's second sort key. */
  tbp: number | null;
  /** Qualification matches played across the league's meets. */
  played: number | null;
  /** League meets the team played in. */
  meets: number;
}

export interface LeagueMeet { code: string; name: string; start: string | null; type: string | null; /** A match there has a result. */ played: boolean }

export interface LeagueStandings {
  season: number;
  region: string;
  code: string;
  /** FIRST's name for it ("Northeast"), null when not listed. */
  name: string | null;
  location: string | null;
  /** Where its meets are ("New Jersey"), from the events. */
  place: string | null;
  /** When the standings were read from FIRST (null: not yet). */
  readAt: string | null;
  rows: LeagueStandingRow[];
  /** The league's meets this season, oldest first (its tournament too). */
  meets: LeagueMeet[];
}

/** A league's page. */
export const leagueHref = (season: number, region: string, code: string) => `/leagues/${season}/${encodeURIComponent(region)}/${encodeURIComponent(code)}`;

/** "Northeast League", or "NE League" when FIRST lists no name. */
export function leagueTitle(name: string | null, code: string): string {
  const n = name?.trim() || code;
  return /\bleague$/i.test(n) ? n : `${n} League`;
}

/** A win-loss-tie record, or null when FIRST gave none. */
export function leagueRecord(r: Pick<LeagueStandingRow, "wins" | "losses" | "ties">): string | null {
  return r.wins == null || r.losses == null ? null : `${r.wins}-${r.losses}-${r.ties ?? 0}`;
}

/** A ranking score as FIRST shows it (two decimals). */
export const rankingScore = (v: number | null) => (v == null ? null : v.toFixed(2));

/** A league page's title, the same on the server and in the app: "Northeast League (New Jersey) standings 2026–27". */
export const leaguePageTitle = (d: Pick<LeagueStandings, "name" | "code" | "place" | "season">) =>
  `${leagueTitle(d.name, d.code)}${d.place ? ` (${d.place})` : ""} standings ${d.season}–${String((d.season + 1) % 100).padStart(2, "0")}`;
