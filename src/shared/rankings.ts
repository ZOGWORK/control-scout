// World rankings (/rankings): the rules shared by the server and the web app.
//
// Rank: every team with at least 3 rated matches in the season, ordered by its prediction-engine
// rating (expected non-penalty points per match: auto + TeleOp + endgame) from high to low. Equal
// ratings (as stored, to 0.01) go by team number, lowest first, so every team has its own rank.
//
// Movement: each Monday 00:00 UTC the stats job writes down every rated team's rank and rating as of
// that instant (ranking_snapshots, server/stats/rankings.ts). A ranking is compared with the newest
// snapshot taken at least 7 days before it ("last week"): the live ranking against the snapshot from
// 7 to 13 days ago, a past week's snapshot against the one exactly a week earlier.
//   move    = rank then - rank now (positive: climbed), "new" when the team wasn't ranked then
//   dRating = rating now - rating then
//   trend   = Rising / Falling / Steady from the two ratings, by the team page's rule (shared/trend.ts)
// With no snapshot to compare against (the season's first week, or a finished season's live list),
// movement is null everywhere and the page says why.
import { direction, type TrendDir } from "./trend";

export const RANKINGS_PAGE_SIZE = 50;
/** Minimum rated matches before a team is ranked (the engine's own threshold for a rating rank). */
export const RANKED_MIN_MATCHES = 3;
export const WEEK_MS = 7 * 864e5;
/** Weekly snapshots kept (by age). At least 26 weeks are promised; a year keeps a whole season. */
export const SNAPSHOT_RETAIN_WEEKS = 52;
/** Up to this many places in one region filter. */
export const MAX_REGIONS = 10;

/** The Monday 00:00 UTC on or before `ms`, as YYYY-MM-DD (a snapshot's week). */
export function weekOf(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}
/** A week's start (epoch ms). */
export const weekStartMs = (week: string) => Date.parse(`${week}T00:00:00Z`);
/** A YYYY-MM-DD that is a Monday. */
export const isWeek = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(weekStartMs(s)) && weekOf(weekStartMs(s)) === s;

export interface Ranked { rank: number; team: number; rating: number }

/** Rank rows by rating (see the top of this file). Rows without a usable rating are left out. */
export function rankTeams<T extends { team: number; rating: number | null }>(rows: T[]): (T & Ranked)[] {
  return rows
    .filter((r): r is T & { rating: number } => r.rating != null && Number.isFinite(r.rating) && r.rating >= 0)
    .sort((a, b) => b.rating - a.rating || a.team - b.team)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export interface Movement { move: number | "new" | null; dRating: number | null; trend: TrendDir | null }

/**
 * A team's movement against last week's snapshot. `baseline` null: there is no snapshot to compare
 * with at all (no movement for anyone); a snapshot without this team: "new".
 */
export function movementOf(now: { rank: number; rating: number }, baseline: Map<number, { rank: number; rating: number }> | null, team: number): Movement {
  if (!baseline) return { move: null, dRating: null, trend: null };
  const then = baseline.get(team);
  if (!then) return { move: "new", dRating: null, trend: null };
  return { move: then.rank - now.rank, dRating: Math.round((now.rating - then.rating) * 100) / 100, trend: direction([then.rating, now.rating]) };
}

/** A place filter: a whole country ("USA") or one state or province in it ("USA:TX"). */
export interface PlaceFilter { country: string; state: string | null }

export const placeKey = (f: PlaceFilter) => (f.state ? `${f.country}:${f.state}` : f.country);

/** "USA:TX,Canada" → filters (null: not a valid list). Countries as FIRST names them; states as codes. */
export function parsePlaces(raw: string | null | undefined): PlaceFilter[] | null {
  if (raw == null || raw.trim() === "") return [];
  const parts = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (parts.length > MAX_REGIONS) return null;
  const out: PlaceFilter[] = [];
  for (const p of parts) {
    const [country, state, extra] = p.split(":").map((s) => s.trim());
    if (extra !== undefined || !country || country.length > 60 || !/^[\p{L}\p{M} .'()&-]+$/u.test(country)) return null;
    if (state !== undefined && !/^[A-Za-z0-9]{1,6}$/.test(state)) return null;
    out.push({ country, state: state ? state.toUpperCase() : null });
  }
  return out;
}

/** Whether a team's home (country, state) is in any of the places (no places: everywhere). */
export function inPlaces(t: { country: string | null; state: string | null }, places: PlaceFilter[]): boolean {
  if (!places.length) return true;
  return places.some((p) => t.country === p.country && (!p.state || (t.state ?? "").toUpperCase() === p.state));
}

export interface RankingRow extends Movement {
  rank: number;
  team: number;
  name: string | null;
  /** The team's home: a state or province code (as FIRST stores it) and a country. */
  state: string | null;
  country: string | null;
  rating: number;
}

export interface RankingsResponse {
  season: number;
  /** The snapshot week shown (YYYY-MM-DD, a Monday), or null for the live ranking. */
  week: string | null;
  /** When the numbers are from: the data update (live) or the snapshot's instant (ISO). */
  asOf: string | null;
  /** The snapshot movement is measured against, or null when there is none. */
  baseline: string | null;
  /** The season's snapshot weeks, newest first (the week picker). */
  weeks: string[];
  /** The place filter applied (keys, as in the URL). */
  places: string[];
  /** Rated teams in the whole ranking, and those matching the filter. */
  ranked: number;
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  rows: RankingRow[];
}

export interface RankingPlaces {
  season: number;
  /** Countries with ranked teams (most teams first), each with its states or provinces. */
  countries: { country: string; teams: number; states: { state: string; teams: number }[] }[];
  /** Snapshot weeks held for the season, newest first. */
  weeks: string[];
  /** The asked-for team's place key ("USA:TX", or the country alone), when given and known. */
  mine?: string | null;
}
