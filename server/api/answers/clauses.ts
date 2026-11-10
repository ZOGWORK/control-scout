// The scope clauses every stat answer is built from (brief: "build each scope clause once and reuse it"): team,
// season, championship, official events, place, event, match type and alliance colour. An answer names its scope as a
// Scope; `inScope` applies it to a team's matches (./matchSet.ts), `eventSql` to event rows (awards, placements), and
// `scopeChips` says it in words. No intent filters on its own.
import { seasonLabel } from "../../../src/shared/format.js";
import { isOfficialEvent } from "../../../src/shared/eventRecord.js";

/** Events whose matches count for scores and records (as server/api/searchHighScores.ts's records, and the team page's
 *  season record): src/shared/eventRecord.ts, one list for all of them. */
export { OFFICIAL_TYPES } from "../../../src/shared/eventRecord.js";

/** Worlds: the FIRST Championship, its divisions (FTCCMP1EDIS, …) and its finals (FTCCMP1), all stored as this type.
 *  "States" is a region's championship (Championship), as in server/api/searchQuestions.ts. */
export const CHAMPIONSHIP_TYPE = "FIRSTChampionship";
export const STATES_TYPE = "Championship";

export interface Scope {
  /** One season, or null for every season on record. */
  season: number | null;
  /** How the season was chosen, said in the answer ("latest season with matches for 12345"). */
  seasonWhy?: string;
  /** Only FIRST Championship (Worlds) events. */
  championship?: boolean;
  /** Only region (state) championships. */
  states?: boolean;
  /** One event ("season:CODE"), and its name for the chips. `codes`: every event the words named that the team played
   *  in that season (a championship's division and its finals, an AM and a PM meet), read as one; `code` is the one
   *  whose rank and OPR the answer shows. `absent`: the team played none of them (the answer says so; "never": it has
   *  none of that kind on record, as a state championship). */
  event?: { season: number; code: string; name: string; codes?: string[]; absent?: boolean | "never" };
  /** Events held at one venue, any season ("River Dell High School"): their "season:CODE" keys. */
  venue?: { name: string; keys: string[] };
  /** Events in one region (by the event's own state and country), or with `outside`, every event outside it (the
   *  team's home state: "out-of-state events"). */
  place?: { country: string; state: string; name: string; outside?: boolean };
  /** A date window (YYYY-MM-DD, inclusive: "this week", "on Mar 15, 2026", "in March"), and how it was said. A match
   *  counts by its own date (its time, else its event's first day); an event when any of its days is in the window. */
  window?: { from: string; to: string; label: string };
  level?: "qual" | "playoff";
  /** The finals only, of the playoffs (a match's `final`, ./matchSet.ts). Set with `level: "playoff"`. */
  finals?: boolean;
  alliance?: "red" | "blue";
}

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

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** The scope in words, as chips: "FIRST Championship (Worlds)", "2025–26", "Playoffs", "Red alliance". */
export function scopeChips(s: Scope): string[] {
  return [
    s.event ? s.event.name : s.venue ? `At ${s.venue.name}` : "",
    s.championship ? "FIRST Championship (Worlds)" : s.states ? "State championships" : "",
    s.place ? `Events ${s.place.outside ? "outside" : "in"} ${s.place.name}` : "",
    s.window ? cap(s.window.label) : "",
    // One event's answer names the event's season too, so the card always states which season it reads.
    s.season != null ? seasonLabel(s.season) : s.event ? seasonLabel(s.event.season) : "All seasons",
    s.finals ? "Finals" : s.level === "qual" ? "Qualification matches" : s.level === "playoff" ? "Playoff matches" : "",
    s.alliance ? `${s.alliance === "red" ? "Red" : "Blue"} alliance` : "",
  ].filter(Boolean);
}

/** The scope as a phrase in a sentence: "at Worlds", "in 2025–26", "in playoffs at New Jersey Championship", "" for
 *  all. The match type is said first, so a title always names it ("Record in quals in 2025–26"). */
export function scopePhrase(s: Scope): string {
  const level = s.finals ? " in the finals" : s.level === "qual" ? " in quals" : s.level === "playoff" ? " in playoffs" : "";
  const where = s.event ? ` at ${s.event.name}` : s.venue ? ` at ${s.venue.name}` : s.championship ? " at Worlds" : s.states ? " at state championships" : s.place ? ` at events ${s.place.outside ? "outside" : "in"} ${s.place.name}` : "";
  const when = s.window ? ` ${s.window.label}` : s.season != null && !s.event ? ` in ${seasonLabel(s.season)}` : "";
  return `${level}${where}${when}`;
}
