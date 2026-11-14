// The scope clauses every stat answer is built from (brief: "build each scope clause once and reuse it"): team,
// season, championship, official events, place, event, match type and alliance colour. An answer names its scope as a
// Scope; `inScope` applies it to a team's matches (./matchSet.ts), `eventSql` to event rows (awards, placements), and
// `scopeChips` says it in words. No intent filters on its own.
import { isOfficialEvent } from "../../../src/shared/eventRecord.js";

/** Events whose matches count for scores and records (as server/api/searchHighScores.ts's records, and the team page's
 *  season record): src/shared/eventRecord.ts, one list for all of them. */
export { OFFICIAL_TYPES } from "../../../src/shared/eventRecord.js";

/** Worlds: the FIRST Championship, its divisions (FTCCMP1EDIS, …) and its finals (FTCCMP1), all stored as this type.
 *  "States" is a region's championship (Championship), as in server/api/searchQuestions.ts. */
export const CHAMPIONSHIP_TYPE = "FIRSTChampionship";
export const STATES_TYPE = "Championship";

export type { Scope } from "../../../src/shared/searchVersus.js";
import type { Scope } from "../../../src/shared/searchVersus.js";

/** What an event-level clause reads: the event's season, code, type, country and state. */
export interface EventFacts { season: number; code: string; type: string | null; country?: string | null; state?: string | null; start?: string | null; end?: string | null; date?: string | null }

/** Season clause. A date window decides by its dates alone: a week across the season's start (Aug 31 to Sep 6) takes
 *  both seasons' matches in it. */
export const seasonClause = (s: Scope) => (e: EventFacts) => s.season == null || !!s.window || e.season === s.season;
/** Championship scope clause (Worlds), and the states one. */
export const championshipClause = (s: Scope) => (e: EventFacts) => !s.championship || e.type === CHAMPIONSHIP_TYPE;
export const statesClause = (s: Scope) => (e: EventFacts) => !s.states || e.type === STATES_TYPE;
/** Official events only: always on for scores and records. */
export const officialClause = () => (e: EventFacts) => isOfficialEvent(e.type);
/** Event clause. */
export const eventClause = (s: Scope) => (e: EventFacts) => !s.event || (e.season === s.event.season && (s.event.codes ?? [s.event.code]).includes(e.code));
/** Venue clause. */
export const venueClause = (s: Scope) => (e: EventFacts) => !s.venue || s.venue.keys.includes(`${e.season}:${e.code}`);
/** Place clause (the event's region; a place with no state is the whole country). */
export const placeClause = (s: Scope) => (e: EventFacts) => !s.place || (e.country === s.place.country && (!s.place.state || e.state === s.place.state)) !== !!s.place.outside;
/** Window clause: a match by its date, an event by its days. */
export const windowClause = (s: Scope) => (e: EventFacts) => {
  if (!s.window) return true;
  const day = e.date?.slice(0, 10);
  if (day) return day >= s.window.from && day <= s.window.to;
  const from = e.start?.slice(0, 10), to = (e.end ?? e.start)?.slice(0, 10);
  return !!from && !!to && from <= s.window.to && to >= s.window.from;
};
/** Match-type clause (qualifications or playoffs). */
export const levelClause = (s: Scope) => (m: { level: string; final?: boolean }) => (!s.level || m.level === s.level) && (!s.finals || (m.level === "playoff" && !!m.final));
/** Alliance-colour clause. */
export const allianceClause = (s: Scope) => (m: { alliance: string }) => !s.alliance || m.alliance === s.alliance;

/** Every event-level clause of a scope, as one test. */
export function eventInScope(s: Scope): (e: EventFacts) => boolean {
  const cs = [seasonClause(s), championshipClause(s), statesClause(s), officialClause(), eventClause(s), venueClause(s), placeClause(s), windowClause(s)];
  return (e) => cs.every((c) => c(e));
}

/** Every clause of a scope, as one test on a match (its event's facts and the team's side). */
export function inScope(s: Scope): (m: EventFacts & { level: string; final?: boolean; alliance: string }) => boolean {
  const ev = eventInScope(s), lv = levelClause(s), al = allianceClause(s);
  return (m) => ev(m) && lv(m) && al(m);
}

/** The same event-level clauses as SQL over an events table aliased `e` (awards, placements): the WHERE part and its
 *  arguments. Official-only is left to the caller (awards come from any event that gives them). */
export function eventSql(s: Scope, alias = "e"): { sql: string; args: (string | number)[] } {
  const parts: string[] = [], args: (string | number)[] = [];
  if (s.season != null && !s.window) { parts.push(`${alias}.season = ?`); args.push(s.season); }
  if (s.championship) { parts.push(`${alias}.type = ?`); args.push(CHAMPIONSHIP_TYPE); }
  if (s.states) { parts.push(`${alias}.type = ?`); args.push(STATES_TYPE); }
  if (s.event) {
    const codes = s.event.codes ?? [s.event.code];
    parts.push(`${alias}.season = ? AND ${alias}.code IN (${codes.map(() => "?").join(", ")})`); args.push(s.event.season, ...codes);
  }
  if (s.venue) {
    parts.push(s.venue.keys.length ? `(${s.venue.keys.map(() => `(${alias}.season = ? AND ${alias}.code = ?)`).join(" OR ")})` : "0 = 1");
    for (const k of s.venue.keys) { const [season, code] = k.split(":"); args.push(Number(season), code); }
  }
  if (s.place) {
    parts.push(`${s.place.outside ? "NOT " : ""}(COALESCE(${alias}.country, '') = ?${s.place.state ? ` AND COALESCE(${alias}.state, '') = ?` : ""})`);
    args.push(s.place.country, ...(s.place.state ? [s.place.state] : []));
  }
  if (s.window) { parts.push(`substr(${alias}.start, 1, 10) <= ? AND substr(COALESCE(${alias}.end, ${alias}.start), 1, 10) >= ?`); args.push(s.window.to, s.window.from); }
  return { sql: parts.length ? parts.join(" AND ") : "1 = 1", args };
}

/** The scope in words, as chips, and as a phrase in a sentence: src/shared/searchVersus.ts (the event pack says it the
 *  same way with no signal). */
export { scopeChips, scopePhrase } from "../../../src/shared/searchVersus.js";
