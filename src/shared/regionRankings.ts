// Region rankings (/rankings/regions, /rankings/regions/:country/:state): one country's or state's teams out of the
// world ranking (src/shared/rankings.ts), with each team's record, OPR, events and rated matches beside its rating,
// the week's climbers, fallers and newcomers, the region's unranked teams (labeled, never ranked), and its leagues.
//
// Rank: the team's place among the region's ranked teams, in world-ranking order (the same list /rankings?region=
// shows, numbered from 1). Its world rank stays beside it. Sorting by another column reorders the rows, never the
// ranks. Everything is one season's: ratings are only comparable inside a season, so nothing here crosses seasons.
//
// Move: places moved in the region since last week's snapshot (the one /rankings compares with), counted among the
// region's teams then and now: +3 is three places higher in the region. A team in the snapshot but not this week's
// list fell off the table and isn't shown; one in this week's list but not the snapshot is "new".
import { RANKED_MIN_MATCHES, movementOf, type Movement, type PlaceFilter } from "./rankings";
import { regionLabel } from "./regions";
import type { SwingCell } from "./reliability";

export const REGION_PAGE_SIZE = 50;
/** At most this many unranked teams are listed (the count is always the whole). */
export const UNRANKED_LIST_MAX = 200;
export const REGION_SORTS = ["rank", "rating", "opr", "record", "events", "move"] as const;
export type RegionSort = (typeof REGION_SORTS)[number];
export const isRegionSort = (s: string): s is RegionSort => (REGION_SORTS as readonly string[]).includes(s);

/** A region's name: a state or province ("New Jersey") where one is named, else the country ("Romania"). */
export const regionName = (key: string) => regionLabel(key);
/** Whether a state code has a name we can show (FIRST's codes elsewhere, "B" or "VN", would mean nothing). */
export const namedState = (country: string, state: string) => regionLabel(`${country}:${state.toUpperCase()}`) !== state.toUpperCase();

/** A team's home region: its state or province where one is named, else its country; null without a country. */
export function homeRegion(country: string | null | undefined, state: string | null | undefined): PlaceFilter | null {
  if (!country) return null;
  const st = state ? state.toUpperCase() : null;
  return { country, state: st && namedState(country, st) ? st : null };
}

/** A region page: /rankings/regions/USA/NJ (or /rankings/regions/Romania), with the view's options. */
export function regionHref(key: string, o: { season?: number | null; team?: number | null; week?: string | null; page?: number | null; sort?: RegionSort | null } = {}): string {
  const [country, state] = key.split(":");
  const q = new URLSearchParams();
  if (o.season) q.set("season", String(o.season));
  if (o.week) q.set("week", o.week);
  if (o.sort && o.sort !== "rank") q.set("sort", o.sort);
  if (o.page && o.page > 1) q.set("page", String(o.page));
  if (o.team) q.set("team", String(o.team));
  const s = q.toString();
  return `/rankings/regions/${encodeURIComponent(country)}${state ? `/${encodeURIComponent(state)}` : ""}${s ? `?${s}` : ""}`;
}

/** "Not ranked yet — 2 of 3 rated matches", or "No rated matches yet". Never a rank or a rating. */
export function unrankedLabel(ratedMatches: number): string {
  return ratedMatches > 0 ? `Not ranked yet — ${Math.min(ratedMatches, RANKED_MIN_MATCHES - 1)} of ${RANKED_MIN_MATCHES} rated matches` : "No rated matches yet";
}

/** A ranked team as the region's lists read it (the world list plus the season stats beside the rating). */
export interface RegionListTeam {
  rank: number; team: number; rating: number; name: string | null; state: string | null; country: string | null;
  /** Season stats (null on a past week's view: the snapshot holds rank and rating only). */
  opr?: number | null; wins?: number | null; losses?: number | null; ties?: number | null; events?: number | null; ratedMatches?: number | null;
}

export interface RegionRow extends Movement {
  /** Place in the region (by rating, always). */
  rank: number;
  /** Place in the world ranking. */
  world: number;
  team: number;
  name: string | null;
  rating: number;
  /** Season OPR (non-penalty), null when the team has none. Null on a past week's view. */
  opr: number | null;
  /** The season's record, every official match (the team page's record). Null on a past week's view. */
  wins: number | null; losses: number | null; ties: number | null;
  /** Events played in the season. */
  events: number | null;
  /** Rated matches the rating is based on (the sample size). */
  ratedMatches: number | null;
  swing?: SwingCell | null;
}

/** A team in the region that isn't ranked: its label comes from its rated matches. */
export interface UnrankedTeam { team: number; name: string | null; ratedMatches: number }

export interface RegionMover { team: number; name: string | null; rank: number; rating: number; move: number }
export interface RegionNewcomer { team: number; name: string | null; rank: number; rating: number }

/** A league whose meets are in a region (src/shared/leagues.ts has the standings). */
export interface LeagueListItem {
  season: number;
  region: string;
  code: string;
  name: string | null;
  /** Where its meets are: a region key ("USA:NJ") and name, null when no meet says. */
  place: string | null;
  placeName: string | null;
  /** League meets with a result so far, and meets scheduled. */
  meetsPlayed: number;
  meets: number;
  /** Teams in FIRST's standings (0 before the first meet has scores). */
  teams: number;
  /** FIRST's #1 by ranking score, null before standings exist. */
  top: { team: number; name: string | null; rs: number | null } | null;
}

export interface LeaguesResponse { season: number; leagues: LeagueListItem[] }

/** The asked-for team (?team=): where it is in this view. */
export type AskedTeam =
  | { team: number; name: string | null; status: "ranked"; rank: number; page: number }
  | { team: number; name: string | null; status: "unranked"; ratedMatches: number }
  | { team: number; name: string | null; status: "elsewhere"; region: string | null }
  | { team: number; name: null; status: "unknown" };

export interface RegionRankingsResponse {
  season: number;
  /** The snapshot week shown, or null for the live ranking. */
  week: string | null;
  asOf: string | null;
  /** The snapshot moves are measured against, null when there is none. */
  baseline: string | null;
  weeks: string[];
  region: { key: string; country: string; state: string | null; name: string };
  /** Ranked teams in the region, and in the world. */
  total: number;
  worldRanked: number;
  /** Record, OPR, events and rated matches are in the rows (the live ranking only). */
  stats: boolean;
  sort: RegionSort;
  page: number;
  pages: number;
  pageSize: number;
  rows: RegionRow[];
  climbers: RegionMover[];
  fallers: RegionMover[];
  newcomers: RegionNewcomer[];
  newTotal: number;
  /** The region's unranked teams (the live ranking only), most rated matches first; `unrankedTotal` counts them all. */
  unranked: UnrankedTeam[];
  unrankedTotal: number;
  leagues: LeagueListItem[];
  asked?: AskedTeam;
}

export interface RegionListItem {
  key: string;
  country: string;
  state: string | null;
  name: string;
  /** Rated (ranked) teams from there. */
  teams: number;
  top: { team: number; name: string | null; rating: number };
  /** Leagues whose meets are there this season. */
  leagues: number;
}

export interface RegionsResponse { season: number; regions: RegionListItem[] }

const winShare = (r: RegionRow) => {
  const n = (r.wins ?? 0) + (r.losses ?? 0) + (r.ties ?? 0);
  return n ? ((r.wins ?? 0) + (r.ties ?? 0) / 2) / n : -1;
};
/** A row's value for a sort (higher is better; nulls lowest). "New" sorts above every numbered move. */
function sortValue(r: RegionRow, s: RegionSort): number {
  switch (s) {
    case "rank": case "rating": return -r.rank;
    case "opr": return r.opr ?? -Infinity;
    case "record": return winShare(r) * 1e6 + (r.wins ?? 0);
    case "events": return r.events ?? -Infinity;
    case "move": return r.move === "new" ? 1e9 : r.move ?? -Infinity;
  }
}

/** Rows in a sort's order, best first (rank 1, the highest OPR, the best record, the most events, the biggest climb).
 *  Ties and missing values keep rank order, missing values last; the rank on each row never changes. */
export function sortRows(rows: RegionRow[], s: RegionSort): RegionRow[] {
  return [...rows].sort((a, b) => {
    const va = sortValue(a, s), vb = sortValue(b, s);
    return (va === vb ? 0 : vb > va ? 1 : -1) || a.rank - b.rank;
  });
}

/** The week's climbers, fallers (top 3 each, by places moved in the region) and newcomers (in rank order). */
export function movers(rows: RegionRow[], n = 3): { climbers: RegionMover[]; fallers: RegionMover[]; newcomers: RegionNewcomer[]; newTotal: number } {
  const moved = rows.filter((r): r is RegionRow & { move: number } => typeof r.move === "number" && r.move !== 0);
  const m = (r: RegionRow & { move: number }): RegionMover => ({ team: r.team, name: r.name, rank: r.rank, rating: r.rating, move: r.move });
  const climbers = moved.filter((r) => r.move > 0).sort((a, b) => b.move - a.move || a.rank - b.rank).slice(0, n).map(m);
  const fallers = moved.filter((r) => r.move < 0).sort((a, b) => a.move - b.move || a.rank - b.rank).slice(0, n).map(m);
  const fresh = rows.filter((r) => r.move === "new");
  return { climbers, fallers, newcomers: fresh.slice(0, 10).map((r) => ({ team: r.team, name: r.name, rank: r.rank, rating: r.rating })), newTotal: fresh.length };
}

/**
 * The region's rows: its teams out of the world list, numbered in the region, with moves counted in the region
 * against `prev` (last week's world list, null when there's no snapshot to compare with).
 */
export function regionRows(list: RegionListTeam[], prev: { team: number; rank: number; rating: number; country: string | null; state: string | null }[] | null, inRegion: (t: { country: string | null; state: string | null }) => boolean): RegionRow[] {
  const here = list.filter(inRegion);
  const before = prev ? new Map(prev.filter(inRegion).map((t, i) => [Number(t.team), { rank: i + 1, rating: Number(t.rating) }])) : null;
  return here.map((t, i) => {
    const rank = i + 1;
    return {
      rank, world: t.rank, team: Number(t.team), name: t.name ?? null, rating: Number(t.rating),
      opr: t.opr ?? null, wins: t.wins ?? null, losses: t.losses ?? null, ties: t.ties ?? null, events: t.events ?? null, ratedMatches: t.ratedMatches ?? null,
      ...movementOf({ rank, rating: Number(t.rating) }, before, Number(t.team)),
    };
  });
}
