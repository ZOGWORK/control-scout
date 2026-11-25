// FTC One Search's catalog for the layered query path (./searchLayers.ts, docs/search-layers.md): every intent the
// keyword layer can reach, the scope each accepts, and the one phrasing it hands to that intent's answer. The words that
// say each one are the lexicon's (src/shared/query/lexicon.ts INTENT_WORDS and the lists after it), one word list for
// all of search. Data, reviewed like code; every entry has a test (./searchLayers.test.ts).

import { INTENT_WORDS, LEADER_STAT_ORDER } from "../../src/shared/query/lexicon.js";
// The keyword layer's word lists live in the lexicon, with every other way of saying something (the search audit's C1).
export { AWARDS, FILLER, FORBIDDEN, PARAPHRASES, PHASES, SCAFFOLD, TAIL_FILLER, WEAK_SIGNALS } from "../../src/shared/query/lexicon.js";

/** Who an intent is about: a team it needs, may have, or must not have. */
export type TeamRule = "required" | "optional" | "forbidden";
export type ScopeKind = "season" | "place" | "event";

/** What the keyword layer found: the team(s), the intent's modifiers and the scope, as the canonical phrasing reads them. */
export interface Found {
  teams: string[];
  /** A phase (auto, teleop, endgame) and an award name, when typed. */
  phase?: "auto" | "teleop" | "endgame";
  award?: string;
  /** Scope as the answers read it: a season as typed ("2024-25", "decode", "last season"), a place by its name, an
   *  event's words. */
  season?: string;
  place?: string;
  event?: string;
  /** Words that only shape how it was asked ("who wins", "appearances", "record"). */
  extra: Set<string>;
}

export interface Intent {
  id: string;
  /** The family it belongs to, for the coverage table. */
  family: string;
  /** Strong keywords (any one, with the team rule met, is the intent). Phrases are words joined by spaces. */
  words: string[];
  team: TeamRule;
  scope: ScopeKind[];
  /** The phrasing the existing answer reads, or null when the found pieces don't make one. */
  canonical: (f: Found) => string | null;
}

const T = (f: Found) => f.teams[0];
const at = (f: Found) => (f.event ? ` at ${f.event}` : "");
/** A season, when named, after everything else: every filter typed stays in the phrasing handed on. */
const inSeason = (f: Found) => (f.season ? ` ${f.season}` : "");
const PHASE_LABEL = { auto: "auto", teleop: "teleop", endgame: "endgame" } as const;

/** The intent catalog. Order is not precedence: precedence is PRECEDENCE below. */
export const INTENTS: Intent[] = [
  // A team's own facts (searchCoverage.ts teamFactAnswer).
  { id: "location", family: "team facts", words: INTENT_WORDS["location"], team: "required", scope: [], canonical: (f) => `${T(f)} location` },
  { id: "school", family: "team facts", words: INTENT_WORDS["school"], team: "required", scope: [], canonical: (f) => `${T(f)} school` },
  { id: "sponsors", family: "team facts", words: INTENT_WORDS["sponsors"], team: "required", scope: [], canonical: (f) => `${T(f)} sponsors` },
  { id: "rookie-year", family: "team facts", words: INTENT_WORDS["rookie-year"], team: "required", scope: [], canonical: (f) => `${T(f)} rookie year` },
  { id: "website", family: "team facts", words: INTENT_WORDS["website"], team: "required", scope: [], canonical: (f) => `${T(f)} website` },
  // A team's stats (answers/families/facts.ts and trends.ts).
  { id: "opr", family: "team stats", words: INTENT_WORDS["opr"], team: "required", scope: ["season"],
    canonical: (f) => `${T(f)} ${f.phase ? `${PHASE_LABEL[f.phase]} ` : ""}opr${f.season ? ` ${f.season}` : ""}` },
  { id: "rating", family: "team stats", words: INTENT_WORDS["rating"], team: "required", scope: ["season"],
    canonical: (f) => `${T(f)} prediction rating${f.season ? ` ${f.season}` : ""}` },
  { id: "record", family: "record", words: INTENT_WORDS["record"], team: "required", scope: ["season", "event"],
    canonical: (f) => `${T(f)} record${at(f)}${inSeason(f)}` },
  { id: "win-rate", family: "record", words: INTENT_WORDS["win-rate"], team: "required", scope: [], canonical: (f) => `${T(f)} win rate` },
  { id: "rank", family: "record", words: INTENT_WORDS["rank"], team: "required", scope: ["place"],
    canonical: (f) => (f.place ? `${T(f)} rank in ${f.place}` : `${T(f)} rank`) },
  { id: "matches", family: "matches", words: INTENT_WORDS["matches"], team: "required", scope: ["event"], canonical: (f) => `${T(f)} matches${at(f)}` },
  { id: "high-score", family: "matches", words: INTENT_WORDS["high-score"], team: "required", scope: [], canonical: (f) => `${T(f)} highest score` },
  { id: "next-match", family: "next and last", words: INTENT_WORDS["next-match"], team: "required", scope: [], canonical: (f) => `${T(f)} next match` },
  { id: "next-event", family: "next and last", words: INTENT_WORDS["next-event"], team: "required", scope: [], canonical: (f) => `${T(f)} next event` },
  { id: "last-event", family: "next and last", words: INTENT_WORDS["last-event"], team: "required", scope: [], canonical: (f) => `${T(f)} last event` },
  { id: "last-match", family: "next and last", words: INTENT_WORDS["last-match"], team: "required", scope: [], canonical: (f) => `${T(f)} last match` },
  { id: "awards", family: "awards", words: INTENT_WORDS["awards"], team: "required", scope: ["season", "event"],
    // An award name at an event has no one phrasing the answers read: it isn't guessed.
    canonical: (f) => (f.event ? (f.award ? null : `${T(f)} awards${at(f)}${inSeason(f)}`) : `${T(f)} ${f.award ? `${f.award} award` : "awards"}${inSeason(f)}`) },
  { id: "events", family: "events", words: INTENT_WORDS["events"], team: "required", scope: ["season", "place"],
    // No season named: the default (searchLayers.ts) fills in the team's latest season with an event.
    canonical: (f) => (f.place ? `${T(f)} events in ${f.place}${inSeason(f)}` : f.season ? `${T(f)} events in ${f.season}` : null) },
  { id: "worlds", family: "worlds and states", words: INTENT_WORDS["worlds"], team: "required", scope: [],
    canonical: (f) => `${T(f)} worlds${f.extra.has("record") ? " record" : ""}` },
  { id: "states", family: "worlds and states", words: INTENT_WORDS["states"], team: "required", scope: [], canonical: (f) => `${T(f)} states` },
  { id: "reliability", family: "team stats", words: INTENT_WORDS["reliability"], team: "required", scope: [], canonical: (f) => `${T(f)} reliability` },
  { id: "league-rank", family: "team stats", words: INTENT_WORDS["league-rank"], team: "required", scope: [], canonical: (f) => `${T(f)} league rank` },
  { id: "report-card", family: "team stats", words: INTENT_WORDS["report-card"], team: "required", scope: [], canonical: (f) => `${T(f)} report card` },
  // Two teams (searchCompare.ts): read before any one team's intent.
  { id: "versus", family: "versus", words: INTENT_WORDS["versus"], team: "optional", scope: [],
    canonical: (f) => (f.teams.length === 2 ? `${f.teams[0]} vs ${f.teams[1]}${f.extra.has("who wins") ? " who wins" : ""}` : null) },
  // No team: a leaderboard, a count, winners, a meaning.
  { id: "leaderboard", family: "leaderboards", words: INTENT_WORDS["leaderboard"], team: "forbidden", scope: ["place"],
    // A named stat before "teams" ("teams with the highest win rate" is the win-rate board).
    canonical: (f) => { const stat = LEADER_STAT_ORDER.find((w) => f.extra.has(w)); return stat ? `${LEADER_STATS[stat](f)}${f.place ? ` in ${f.place}` : ""}` : null; } },
  { id: "count", family: "counts", words: INTENT_WORDS["count"], team: "forbidden", scope: ["place", "season"],
    // Counts are of the current season only (countAnswer): a season named isn't dropped, it isn't answered here.
    canonical: (f) => { const n = f.extra.has("teams") ? "teams" : f.extra.has("events") ? "events" : null; return n && !f.season ? `how many ${n}${f.place ? ` in ${f.place}` : ""}` : null; } },
  { id: "winners", family: "winners", words: INTENT_WORDS["winners"], team: "forbidden", scope: ["event", "season"],
    canonical: (f) => (f.event ? `who won ${f.award ? `${f.award} at ` : ""}${f.event}${f.season ? ` ${f.season}` : ""}` : f.extra.has("worlds") ? `who won worlds${f.season ? ` ${f.season}` : ""}` : null) },
  { id: "meaning", family: "meanings", words: INTENT_WORDS["meaning"], team: "forbidden", scope: [], canonical: () => null },
];

/** Intents retired from the keyword layer (the search audit's C2): the pipeline reads every question they'd claim, so
 *  the keyword layer hands on no phrasing for them (scripts/search-heldout.claims.json, the questions both claim, goes
 *  down with each). They stay in the catalog: their words are still a question's, read for precedence and ambiguity as
 *  before (a team's states and record asked together is still two intents, never the states one alone), and spelling
 *  still knows them. */
export const RETIRED: ReadonlySet<string> = new Set(["record", "states"]);

/** A leaderboard's stat word and the phrasing the leaderboard answer reads (answers/families/leaderboard.ts and the
 *  win-rate card in searchAsks.ts). "teams" alone is the prediction rating's board, as "top teams" is today. */
const LEADER_STATS: Record<string, (f: Found) => string> = {
  opr: (f) => `top ${f.phase ? `${PHASE_LABEL[f.phase]} ` : ""}opr`,
  auto: () => "top auto opr", teleop: () => "top teleop opr", endgame: () => "top endgame opr",
  wins: () => "most wins", "win rate": () => "highest win rate",
  rating: () => "top teams", "prediction rating": () => "top teams", teams: () => "top teams",
};
export const LEADER_STAT_WORDS = Object.keys(LEADER_STATS);

/** Precedence when two strong intents are found (docs/search-layers.md lists the example that forced each one). A pair
 *  [a, b] means a wins over b; a pair with no rule is ambiguous and never guessed. */
export const PRECEDENCE: [string, string][] = [
  ["next-match", "matches"], ["last-match", "matches"], ["next-event", "events"], ["last-event", "events"],
  ["next-match", "rating"], ["high-score", "matches"], ["league-rank", "rank"], ["report-card", "rating"],
  ["record", "matches"], ["worlds", "record"], ["win-rate", "record"], ["worlds", "events"], ["states", "events"],
  ["awards", "events"], ["school", "location"], ["opr", "rank"], ["rating", "rank"],
];
