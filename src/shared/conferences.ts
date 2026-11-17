// New Jersey's conferences (FTCNJ's own grouping: FIRST has no conference in its data). A conference is read from a New
// Jersey league tournament's name once, at sync time (server/data/conferences.ts), and stored per (season, code): event
// codes are reused across seasons and the LT / LT2 suffix flips, so a code alone never names a conference. Its table
// (server/api/conferences.ts) is the tournament's teams ranked by FIRST's league standing over the league meets only:
// two different rankings from the tournament's own, and labelled so wherever it shows.
import type { TrendDir } from "./trend";

/** The one region with conferences. */
export const CONFERENCE_REGION = "USNJ";

/** Every place a conference table shows carries this, word for word. */
export const CONFERENCE_LABEL = "League meets only — excludes this tournament.";

/**
 * The conference a tournament title names: "East Bergen Conference Northern League Tournament" → "East Bergen
 * Conference"; FTCNJ's "FTCNJ Hudson/East Bergen Conference, Northeast League Tournament (Sunday)" → "Hudson/East Bergen
 * Conference". Null when the title names none (never a guess from the code or the league).
 */
export function conferenceName(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title.replace(/[​﻿]/g, "").replace(/\s+/g, " ").trim()
    // Older names lead with the region and date ("NJ 2/25/24 …") or the league ("Northern League East Bergen …").
    .replace(/^(?:FTC\s*NJ|NJ)\s+/i, "").replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+/, "").replace(/^(?:[A-Z][\w-]*\s+){1,3}League\s+(?=.*\bConference\b)/, "");
  const m = /^(.*?\S)\s+Conference\b/i.exec(t);
  if (!m) return null;
  const name = m[1].replace(/[,;:\s]+$/, "").trim();
  return name ? `${name} Conference` : null;
}

/** "Hudson/East Bergen Conference" → "hudson-east-bergen-conference". */
export const conferenceSlug = (name: string) => name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A team in a conference table. Every FIRST number is as FIRST gave it; null when FIRST has none (never 0). */
export interface ConferenceRow {
  team: number;
  name: string | null;
  /** Its place among the conference's ranked teams, in FIRST's league order; null: not ranked (no league meet). */
  rank: number | null;
  /** Its rank in the whole league table; null: no league row. */
  leagueRank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  rs: number | null;
  tbp: number | null;
  /** Qualification matches across the league meets. */
  played: number | null;
  /** League meets played. */
  meets: number | null;
  /** Scout's rating and season OPR (null: none), the same numbers /rankings and the league page show. */
  rating: number | null;
  opr: number | null;
  /** Going-in view only: FTC New Jersey's status for the team (registered, or the waitlist's pending). */
  registered?: "registered" | "pending";
  /** Its move by Scout rating among the conference's teams (src/shared/rankings.ts movementOf, as region rankings
   *  counts it): places up (+) or down (-) since `Conference.moves.baseline`, "new" when it wasn't rated then; absent
   *  or null when there's nothing to compare with. Never a move in FIRST's league rank: Scout keeps no league history. */
  move?: number | "new" | null;
  trend?: TrendDir | null;
  /** Its rank by Scout rating among the conference's rated teams, in the week the moves are read at. */
  ratingRank?: number | null;
}

/** Where a table's league numbers come from. */
export type ConferenceRs =
  /** Today's league standing (the tournament hasn't started). */
  | { kind: "live"; asOf: string | null }
  /** Stored the week before the tournament. */
  | { kind: "snapshot"; asOf: string }
  /** No snapshot, but every league meet was before the tournament, which FIRST's league table leaves out: today's
   *  standing is the one the teams went in with. */
  | { kind: "final"; asOf: string | null; lastMeet: string }
  /** No snapshot and a league meet after the tournament: what they went in with can't be read any more. */
  | { kind: "gone" };

export interface ConferenceWinner { captain: { team: number; name: string | null }; picks: { team: number; name: string | null }[] }

export interface Conference {
  season: number;
  /** The tournament's event code (this season's: codes are reused). */
  code: string;
  /** FTCNJ's wording when its page has it, else FIRST's event name's. */
  name: string;
  slug: string;
  /** The name as FIRST's event words it, when FTCNJ words it differently. */
  firstName: string | null;
  event: string;
  start: string | null;
  venue: string | null;
  city: string | null;
  /** upcoming: no match played yet; live: under way; finished: awards are in, or its day has passed. */
  status: "upcoming" | "live" | "finished";
  /** field: FIRST's team list; registered: FTC New Jersey's sign-ups (not the final field); none: neither yet. */
  teamsFrom: "field" | "registered" | "none";
  registered: { count: number; fetchedAt: string; url: string; sessionUnknown: boolean } | null;
  rs: ConferenceRs;
  /** Teams with a league row that has played (the "of" in "12th of 48"). */
  leagueOf: number;
  rows: ConferenceRow[];
  /** From the awards (Winning Alliance captain and picks), never the rank 1. */
  winner: ConferenceWinner | null;
  /** The weeks the moves compare (`week` null: this week's live ranking), or null when there's no saved week to
   *  compare with: then no row has a move. */
  moves?: { week: string | null; baseline: string } | null;
  /** The same conference in other seasons (it can change leagues). */
  seasons: { season: number; region: string; league: string; code: string; name: string; slug: string }[];
}

export interface LeagueConferences {
  season: number;
  region: string;
  code: string;
  conferences: Conference[];
}

/** A team's conference place (server/api/conferences.ts): out of its conference tournament's FIRST field. */
export interface TeamConference {
  season: number; region: string; league: string; code: string; name: string; slug: string;
  /** Its place by league standing among the conference's teams (null: no league standing); of: the field's size;
   *  ranked: the teams with a standing. */
  rank: number | null; of: number; ranked: number;
  leagueRank: number | null; leagueOf: number;
  /** False when the standing the teams went in with can't be read any more (no snapshot, a league meet after the
   *  tournament): a null rank then says nothing about the team's meets. */
  available: boolean;
  href: string;
}

/** What the conference button needs to know about a team (GET /api/teams/:number/conference). */
export interface TeamConferenceInfo {
  team: number;
  season: number;
  /** Based in New Jersey (FIRST's home state); null: no such team. */
  nj: boolean | null;
  /** Its league that season (its latest, as the team page says it). */
  league: { region: string; code: string; name: string | null } | null;
  /** Its conference, once FIRST lists it in a conference tournament's field. */
  conference: TeamConference | null;
}

/** A league's conference rankings page (src/pages/ConferencePage.tsx), with a conference and a team marked. */
export function conferenceHref(season: number, region: string, league: string, o: { slug?: string | null; team?: number | null } = {}): string {
  const q = new URLSearchParams();
  if (o.slug) q.set("conference", o.slug);
  if (o.team) q.set("team", String(o.team));
  const qs = q.toString();
  return `/leagues/${season}/${encodeURIComponent(region)}/${encodeURIComponent(league)}/conferences${qs ? `?${qs}` : ""}`;
}

/** One of FIRST's numbers as FIRST gave it, never rounded: one decimal when it has no more ("4.0", "3.8"), else in
 *  full ("3.85"). Null when FIRST gave none. */
export function asGiven(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? v.toFixed(1) : String(v);
}

/** "1st", "2nd", "12th". */
export function ordinal(n: number): string {
  const t = n % 100, u = n % 10;
  return `${n}${t >= 11 && t <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`;
}

/** The date a snapshot or standing was read, as the page says it: "Feb 14, 2027". */
export const asOfDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
};
