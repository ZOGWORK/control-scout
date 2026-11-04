// Reading a stat question (docs/search.md, "Stat answers"): fixed rules, no model. A query is an intent phrase
// ("highest score", "worlds record", "average score"), scope phrases ("at worlds", "this season", "2024-25", "in
// playoffs", "on red", "ever") and what's left, which names the team. One table of intents, each naming its family;
// the scope words are read once, the same way for every intent (./clauses.ts applies them).
import type { StatFamily } from "../../../src/shared/searchStat.js";
import { CURRENT_SEASON, SEASONS } from "../../data/seasons.js";
import { findRegions, nearRegion, type Region } from "../../../src/shared/regions.js";

export type IntentId =
  // Family 3: one best (or worst) of a filtered set.
  | "highest-score" | "lowest-score" | "biggest-win" | "biggest-loss" | "closest-match" | "first-match" | "recent-match"
  | "best-finish" | "worst-finish" | "first-event" | "last-event" | "best-opr-event" | "best-season" | "most-improved-season" | "first-season"
  // Family 4: a count, a mean, a record or a streak over a filtered set.
  | "wins-count" | "record" | "average-score" | "average-margin" | "total-points" | "total-matches" | "total-events" | "seasons-played" | "seasons-count"
  | "current-streak" | "longest-streak" | "last-matches" | "average-rank" | "playoff-appearances"
  | "blowout-wins" | "losses" | "playoff-matches" | "qual-matches" | "red-blue-record"
  // Family 5: at one event (its matches, rank and OPR there).
  | "results" | "event-rank" | "event-opr" | "match-lookup"
  // Family 8: awards (a list or a count, by kind).
  | "event-wins" | "inspire-awards" | "finalist-finishes" | "total-awards" | "award-split" | "awards"
  // An event's or a season's winners: no team.
  | "winning-alliance"
  // Family 6: the team's opponents and partners.
  | "most-played-opponent" | "toughest-opponent" | "best-partner" | "frequent-partner" | "never-played"
  | "worst-partner" | "partners" | "opponents" | "beat-most" | "lost-to-most" | "partner-top-opr" | "opponent-top-opr"
  | "partner-win-rate" | "opponent-win-rate" | "pick-partner"
  // The engine's stored projection for the team's next event (families/predict.ts).
  | "next-event-wins" | "event-win-chance" | "advance-chance" | "playoff-chance"
  // Family 2: one number over the team's events or seasons.
  | "opr-history" | "opr-by-season" | "record-by-season" | "win-rate" | "avg-penalties" | "avg-score-by-event" | "ranking-points"
  // Family 4 again: a season's penalty points.
  | "total-penalties";

/** Family 6 with two teams named ("4215 vs 6980 head to head"). */
export type TwoTeamId = "head-to-head" | "opr-vs" | "rating-vs" | "win-chance" | "better-record"
  | "predict" | "h2h-wins" | "shared-matches" | "compare" | "phase-vs" | "reliability-vs" | "awards-vs";

interface IntentRule {
  id: IntentId;
  family: StatFamily;
  re: RegExp;
  /** The season used when none is named: every season, or the team's latest season with matches. */
  season: "all" | "latest";
  /** The season used when the question names no scope at all ("4215 record": the team's latest season). */
  alone?: "all" | "latest";
  /** Taken only with an event ("4215 rank at New Jersey Championship"). */
  needsEvent?: boolean;
  /** Names no team: what's left names an event, or nothing (the season's championship). */
  noTeam?: boolean;
}

const MATCHES = "(?:matches|match|games?)";
/** The awards by the words people use: a question naming one is about that award, never the winning alliance. */
const AWARD_WORDS = /\b(?:inspire|think|innovate|design|reach|sustain|connect|control|compass|motivate|promote|judges?|deans?|leadership|award)\b/;
/** In order: the longer, more specific phrases first ("longest win streak" before "win streak"). */
const RULES: IntentRule[] = [
  // A season's or an event's winners: "winning alliance", "who won …", and "winner(s)"/"champion(s)" (those two only
  // with Worlds or a season named: "decode winner", "into the deep champions", "worlds winners 2025").
  { id: "winning-alliance", family: "event", season: "all", noTeam: true, re: /\bwinning\s+alliances?\b|\bwho\s+won\b|\b(?:world\s+)?(?:champions?|winners?)\b/ },
  { id: "opr-by-season", family: "trend", season: "all", re: /\bopr\s+(?:by|per|each|every|over\s+the)\s+seasons?\b|\bseason(?:al)?\s+opr\b/ },
  { id: "record-by-season", family: "trend", season: "all", re: /\b(?:record|w-l-t|win[\s-]loss(?:[\s-]tie)?)\s+(?:by|per|each|every)\s+season\b|\bseason\s+by\s+season\s+record\b/ },
  { id: "opr-history", family: "trend", season: "all", re: /\bopr\s+(?:history|trend|over\s+time|by\s+event|progression|graph|chart)\b/ },
  { id: "avg-score-by-event", family: "trend", season: "all", re: /\b(?:average|avg|mean)\s+(?:alliance\s+)?score\s+(?:by|per|each|at\s+each)\s+event\b/ },
  { id: "total-penalties", family: "aggregate", season: "all", re: /\btotal\s+penalt(?:y|ies)(?:\s+points)?\b|\bpenalt(?:y|ies)\s+total\b/ },
  { id: "avg-penalties", family: "trend", season: "all", re: /\b(?:average|avg|mean)\s+penalt(?:y|ies)\b|\bpenalt(?:y|ies)(?:\s+points)?\s+(?:given|committed|per\s+match|by\s+event|trend)\b/ },
  // A partner's or an opponent's win rate (families/twoTeam.ts) before the team's own.
  { id: "partner-win-rate", family: "two-team", season: "latest", re: /\b(?:alliance\s+)?partners?\s+win(?:ning)?\s+(?:rate|percentage|pct|%)\b|\bwin(?:ning)?\s+(?:rate|percentage)\s+with\s+(?:alliance\s+)?partners?\b/ },
  { id: "opponent-win-rate", family: "two-team", season: "latest", re: /\bopponents?\s+win(?:ning)?\s+(?:rate|percentage|pct|%)(?:\s+against\s+(?:them|it|him|her))?\b|\bwin(?:ning)?\s+(?:rate|percentage)\s+of\s+(?:their\s+)?opponents?\b/ },
  { id: "win-rate", family: "trend", season: "all", re: /\bwin(?:ning)?\s+(?:rate|percentage|pct|%)\b/ },
  { id: "ranking-points", family: "trend", season: "all", re: /\branking\s+(?:points|score)\b/ },
  { id: "never-played", family: "two-team", season: "latest", re: /\bteams?\s+(?:(?:it|they|he|she)\s+)?(?:(?:has|have)\s+)?(?:never|not\s+yet|hasn't|haven't|has\s+not|have\s+not|didn't|did\s+not)\s+(?:played|faced|met)(?:\s+(?:against|with))?\b|\bnever\s+(?:played|faced|met)\s+(?:teams?|opponents?)\b/ },
  // The team's partners and opponents (families/twoTeam.ts), before "win rate" and "best partner" read their words.
  { id: "pick-partner", family: "two-team", season: "latest", re: /\bwho\s+should\s+(?<team>.+?)\s+(?:pick|choose|select|ally\s+with)(?:\s+as\s+(?:an?\s+|their\s+)?(?:alliance\s+)?partner)?\b|\b(?:recommended|suggested)\s+(?:alliance\s+)?(?:partner|pick)s?\b|\bpick\s+(?:recommendations?|suggestions?)\b/ },
  { id: "partner-top-opr", family: "two-team", season: "latest", re: /\bpartners?\s+with\s+(?:the\s+)?(?:highest|best|biggest|top)\s+(?:combined\s+)?opr\b|\b(?:highest|best|top)\s+(?:combined\s+)?opr\s+(?:alliance\s+)?partners?\b/ },
  { id: "opponent-top-opr", family: "two-team", season: "latest", re: /\bopponents?\s+with\s+(?:the\s+)?(?:highest|best|biggest|top)\s+opr(?:\s+(?:they|it|he|she)\s+(?:faced|played|met))?\b|\b(?:highest|best|top)[\s-]+opr\s+opponents?(?:\s+(?:they|it)\s+(?:faced|played|met))?\b/ },
  { id: "beat-most", family: "two-team", season: "all", re: /\bteams?\s+(?:(?:they|it|he|she)\s+)?(?:beat|beaten|defeated)\s+(?:the\s+)?most(?:\s+often)?\b|\bmost\s+(?:beaten|defeated)\s+(?:teams?|opponents?)\b/ },
  { id: "lost-to-most", family: "two-team", season: "all", re: /\bteams?\s+(?:(?:they|it|he|she)\s+)?(?:lost|lose)\s+to\s+(?:the\s+)?most(?:\s+often)?\b|\bmost\s+losses\s+(?:to|against)\b/ },
  { id: "worst-partner", family: "two-team", season: "all", re: /\b(?:worst|weakest|least\s+successful)\s+(?:alliance\s+)?partners?\b/ },
  // The engine's stored projection for the team's next event (families/predict.ts).
  { id: "next-event-wins", family: "stat", season: "all", re: /\bpredicted\s+(?:wins|record|w-l-t)(?:\s+(?:at|for|in)\s+(?:their|its|the)\s+next\s+(?:event|competition|meet))?\b|\bhow\s+many\s+(?:matches\s+)?will\s+(?<team>.+?)\s+win\b/ },
  { id: "playoff-chance", family: "stat", season: "all", re: /\b(?:predicted|projected|expected|likely)\s+to\s+make\s+(?:the\s+)?(?:playoffs?|eliminations?|elims?)(?:\s+(?:at|in)\s+(?:their|its|the)\s+next\s+(?:event|competition|meet))?\b|\b(?:playoffs?|elimination)\s+(?:chances?|odds|probability)\b|\bchances?\s+(?:to|of)\s+mak(?:e|ing)\s+(?:the\s+)?playoffs?\b/ },
  { id: "advance-chance", family: "stat", season: "all", re: /\badvancement\s+(?:chances?|odds|probability)\b|\bchances?\s+(?:to|of)\s+(?:advance|advancing|qualify|qualifying)(?:\s+to\s+(?:the\s+)?(?:worlds?|first\s+championship|states|state\s+championship))?\b|\b(?:odds|probability)\s+(?:to|of)\s+(?:advance|advancing)\b/ },
  { id: "event-win-chance", family: "stat", season: "all", re: /\bchances?\s+(?:to|of)\s+win(?:ning)?\s+(?:an?|the|their|its)\s+(?:next\s+)?(?:event|competition|meet|tournament)\b|\bevent\s+win\s+(?:chances?|odds|probability)\b/ },
  { id: "toughest-opponent", family: "two-team", season: "all", re: /\b(?:toughest|hardest|strongest|worst)\s+(?:opponents?|rivals?|matchups?)\b|\bnemesis\b/ },
  { id: "most-played-opponent", family: "two-team", season: "all", re: /\bmost\s+(?:played|common|frequent|faced|often\s+(?:played|faced))\s+(?:opponents?|rivals?)\b|\bopponents?\s+(?:faced|played|met)\s+(?:the\s+)?most\b|\bbiggest\s+rival\b/ },
  { id: "frequent-partner", family: "two-team", season: "all", re: /\bmost\s+(?:frequent|common|often|played\s+with)\s+(?:alliance\s+)?partners?\b|\bfrequent\s+(?:alliance\s+)?partners?\b|\bpartnered\s+(?:with\s+)?(?:the\s+)?most\b/ },
  { id: "best-partner", family: "two-team", season: "all", re: /\b(?:best|strongest|top|winningest)\s+(?:alliance\s+)?partners?\b/ },
  // Every partner or opponent: after the superlatives above ("frequent partners", "toughest opponents").
  { id: "partners", family: "two-team", season: "all", alone: "latest", re: /\b(?:all\s+)?(?:alliance\s+)?partners\b|\bteams?\s+(?:they|it)\s+(?:partnered|played)\s+with\b/ },
  { id: "opponents", family: "two-team", season: "all", alone: "latest", re: /\b(?:all\s+)?opponents\b|\bteams?\s+(?:they|it)\s+(?:faced|played\s+against)\b/ },
  { id: "award-split", family: "awards", season: "all", re: /\bjudged\s+(?:vs\.?|versus|and|or)\s+performance(?:\s+awards?)?\b|\bperformance\s+(?:vs\.?|versus|and|or)\s+judged(?:\s+awards?)?\b|\bawards?\s+by\s+(?:type|kind)\b/ },
  { id: "event-wins", family: "awards", season: "all", re: /\bhow\s+many\s+(?:events?|tournaments?|competitions?)\s+(?:has|have|did)\s+(?<team>.+?)\s+won?\b|\b(?:ever\s+)?won\s+(?:an?\s+|any\s+)?(?:events?|tournaments?|competitions?)\b|\bevent\s+wins?\b|\b(?:events?|tournaments?)\s+won\b/ },
  { id: "inspire-awards", family: "awards", season: "all", re: /\binspire(?:\s+awards?)?\b/ },
  { id: "finalist-finishes", family: "awards", season: "all", re: /\bfinalists?(?:\s+(?:finish(?:es)?|alliances?|awards?))?\b/ },
  { id: "total-awards", family: "awards", season: "all", re: /\b(?:total|number\s+of|how\s+many|all|career)\s+awards\b|\bawards?\s+(?:count|total)\b/ },
  { id: "match-lookup", family: "event", season: "all", needsEvent: true, re: /\b(?:score|result)\s+(?:in|of|for)\s+(?:match|qual(?:ification)?|q)\s*(\d{1,3})\b|\b(?:match|qual|q)\s*(\d{1,3})\b/ },
  { id: "red-blue-record", family: "aggregate", season: "all", re: /\b(?:red\s+(?:vs\.?|versus|and|or)\s+blue|blue\s+(?:vs\.?|versus|and|or)\s+red)(?:\s+(?:alliance|side))?\s+(?:record|results?|split)\b|\brecord\s+(?:by|per)\s+(?:alliance\s+)?(?:colou?r|side)\b/ },
  { id: "most-improved-season", family: "superlative", season: "all", re: /\bmost\s+improved\s+season\b|\bbiggest\s+(?:opr\s+)?(?:jump|improvement|gain)\b/ },
  { id: "best-opr-event", family: "superlative", season: "all", re: /\b(?:best|highest|top)\s+opr\s+(?:event|competition|meet)\b|\b(?:event|competition|meet)\s+with\s+(?:the\s+)?(?:best|highest)\s+opr\b/ },
  { id: "longest-streak", family: "aggregate", season: "all", re: /\b(?:longest|best|biggest|record)\s+(?:win(?:ning)?\s+)?streak\b/ },
  { id: "current-streak", family: "aggregate", season: "all", re: /\b(?:current|active|ongoing)?\s*(?:win(?:ning)?\s+|losing\s+|loss\s+)?streak\b/ },
  { id: "last-matches", family: "aggregate", season: "all", re: new RegExp(`\\b(?:last|latest|recent|past)\\s+(\\d{1,2})\\s+${MATCHES}\\b`) },
  { id: "recent-match", family: "superlative", season: "all", re: new RegExp(`\\b(?:most\\s+recent|latest|last|newest)\\s+${MATCHES}\\b`) },
  { id: "first-match", family: "superlative", season: "all", re: new RegExp(`\\b(?:first|debut|earliest|very\\s+first)\\s+${MATCHES}\\b`) },
  { id: "lowest-score", family: "superlative", season: "all", re: /\blowest[\s-]+(?:scoring\s+(?:match|game)|(?:match\s+)?scores?)\b|\bworst\s+(?:match\s+)?scores?\b/ },
  { id: "highest-score", family: "superlative", season: "all", re: /\bhighest[\s-]+scoring(?:\s+(?:match|game))?\b|\b(?:highest|best|top|max(?:imum)?|biggest|most)\s+(?:match\s+)?(?:scores?|points)\b|\bscored?\s+(?:the\s+)?(?:highest|most|best)\b/ },
  { id: "biggest-win", family: "superlative", season: "all", re: /\b(?:biggest|largest|best|widest)\s+(?:win|victory|winning\s+margin|margin\s+of\s+victory|blowout)\b/ },
  { id: "biggest-loss", family: "superlative", season: "all", re: /\b(?:biggest|largest|worst|widest)\s+(?:loss|defeat|losing\s+margin)\b/ },
  { id: "closest-match", family: "superlative", season: "all", re: new RegExp(`\\b(?:closest|tightest|narrowest)\\s+(?:${MATCHES}|win|loss|result)\\b|\\bsmallest\\s+margin\\b`) },
  { id: "blowout-wins", family: "aggregate", season: "all", re: /\bblow\s?outs?(?:\s+wins?)?\b|\bblow\s?out\s+victories\b/ },
  { id: "playoff-appearances", family: "aggregate", season: "all", re: /\b(?:playoffs?|elimination|elims?)\s+appearances?\b|\b(?:times|events)\s+(?:in|made|reached)\s+(?:the\s+)?(?:playoffs?|eliminations?|elims?)\b/ },
  { id: "playoff-matches", family: "aggregate", season: "all", re: new RegExp(`\\b(?:playoffs?|elimination|elims?)\\s+${MATCHES}\\b`) },
  { id: "qual-matches", family: "aggregate", season: "all", re: new RegExp(`\\b(?:qualification|qualifying|quals?)\\s+${MATCHES}\\b`) },
  { id: "average-rank", family: "aggregate", season: "all", re: /\b(?:average|avg|mean)\s+(?:event\s+)?(?:rank(?:ing)?|placement|finish|place)\b/ },
  { id: "average-margin", family: "aggregate", season: "all", re: /\b(?:average|avg|mean|typical)\s+(?:winning\s+|losing\s+|match\s+)?(?:margin|point\s+differential|differential|point\s+diff)\b|\bmargin\s+(?:of\s+victory\s+)?(?:on\s+)?average\b/ },
  { id: "total-points", family: "aggregate", season: "all", re: /\btotal\s+(?:points|score)(?:\s+scored)?\b|\b(?:points|score)\s+total\b|\ball\s+the\s+points\b|\bhow\s+many\s+points\s+(?:has|have|did)\s+(?<team>.+?)\s+score[ds]?\b/ },
  { id: "average-score", family: "aggregate", season: "latest", re: /\b(?:average|avg|mean)\s+(?:match\s+|alliance\s+)?(?:scores?|points)\b/ },
  { id: "best-finish", family: "superlative", season: "all", re: /\b(?:best|highest|top)\s+(?:event\s+)?(?:finish|placement|ranking|rank|place)\b/ },
  { id: "worst-finish", family: "superlative", season: "all", re: /\b(?:worst|lowest)\s+(?:event\s+)?(?:finish|placement|ranking|rank|place)\b/ },
  { id: "first-event", family: "superlative", season: "all", re: /\b(?:first|debut|earliest)\s+(?:event|competition|tournament|meet)\b/ },
  { id: "last-event", family: "superlative", season: "all", re: /\b(?:last|latest|most\s+recent|newest)\s+(?:event|competition|tournament|meet)\b/ },
  { id: "first-season", family: "superlative", season: "all", re: /\b(?:first|debut|rookie)\s+season\b/ },
  { id: "best-season", family: "superlative", season: "all", re: /\b(?:best|greatest|strongest)\s+season\b/ },
  { id: "seasons-count", family: "aggregate", season: "all", re: /\b(?:seasons?\s+count|how\s+many\s+seasons|number\s+of\s+seasons|seasons?\s+total|total\s+seasons)\b/ },
  { id: "seasons-played", family: "aggregate", season: "all", re: /\bseasons?\s+(?:played|competed|active)\b|\bwhich\s+seasons\b|\blist\s+of\s+seasons\b/ },
  { id: "total-events", family: "aggregate", season: "all", re: /\b(?:total|number\s+of|how\s+many|career)\s+(?:events?|competitions?|tournaments?)\b|\bevents?\s+(?:count|total)\b/ },
  { id: "total-matches", family: "aggregate", season: "all", re: new RegExp(`\\b(?:total|number\\s+of|career)\\s+${MATCHES}(?:\\s+played)?\\b|\\b${MATCHES}\\s+(?:count|total)\\b|\\bhow\\s+many\\s+${MATCHES}\\s+(?:has|have|did)\\s+(?<team>.+?)\\s+play(?:ed)?\\b`) },
  { id: "wins-count", family: "aggregate", season: "all", re: new RegExp(`\\bhow\\s+many\\s+(?:${MATCHES}\\s+|times\\s+)?(?:has|have|did)\\s+(?<team>.+?)\\s+won?\\b|\\b(?:number\\s+of|total|career|how\\s+many)\\s+(?:match\\s+)?wins\\b|\\bwins?\\s+count\\b`) },
  { id: "losses", family: "aggregate", season: "all", re: new RegExp(`\\blosses\\b|\\blost\\s+${MATCHES}\\b|\\b${MATCHES}\\s+lost\\b`) },
  { id: "results", family: "event", season: "all", needsEvent: true, re: /\b(?:results?|matches|how\s+did\s+(?<team>.+?)\s+do)\b/ },
  { id: "event-rank", family: "event", season: "all", needsEvent: true, re: /\b(?:rank(?:ed|ing)?|placement|place|placed|finish(?:ed)?|seed(?:ed)?)\b/ },
  { id: "event-opr", family: "event", season: "all", needsEvent: true, re: /\bopr\b/ },
  { id: "awards", family: "awards", season: "all", re: /\bawards?\b/ },
  { id: "record", family: "aggregate", season: "all", alone: "latest", re: /\b(?:win[\s-]+loss(?:[\s-]+tie)?\s+)?record\b/ },
];

export interface ReadScope {
  season: number | null;
  /** "this season": the team's latest season with matches. */
  latest: boolean;
  /** "ever", "all time", "career": every season, said so. */
  ever: boolean;
  championship: boolean;
  states: boolean;
  level: "qual" | "playoff" | null;
  alliance: "red" | "blue" | null;
  /** "at <something>" that isn't Worlds or states: an event (left to the event family). */
  at: string | null;
  /** The season came from a bare year ("2024"), which could also be a team's number. */
  year?: boolean;
  /** "last year", "last season": for a season's winners, the latest season whose championship has finished. */
  lastYear?: boolean;
}

export interface StatQuestion {
  id: IntentId;
  family: StatFamily;
  defaultSeason: "all" | "latest";
  scope: ReadScope;
  /** "which event did 4215 score highest in": the answer leads with the event. */
  leadEvent: boolean;
  /** "last 5 matches": how many; "score in match 12": the match number. */
  n: number | null;
  /** "closest win", "current losing streak": the result asked about (null: any). */
  outcome: "W" | "L" | null;
  /** "how many inspire awards", "event wins count": a count, not the list. */
  count: boolean;
  /** No team: what's left (an event's name, or "" for the season's championship). */
  noTeam: boolean;
  /** What names the team. */
  core: string;
}

const WORLDS = /\b(?:(?:at|in|during|from)\s+)?(?:the\s+)?(?:worlds?|world\s+champ(?:ionships?|s)?|first\s+champ(?:ionships?|s)?|houston\s+champ(?:ionships?|s)?|championship\s+divisions?)\b/;
const STATES = /\b(?:(?:at|in|during)\s+)?(?:the\s+)?(?:states|state\s+champ(?:ionships?|s)?|state\s+finals?)\b/;
// The question's own words: never part of a team's name here.
const FRAME = /\b(?:how|many|much|what|whats|which|who|when|where|is|was|were|are|has|have|had|did|does|do|the|a|an|of|in|at|on|for|by|to|team|teams|their|its|his|her|ever|all|time|career|so|far|total|number|score|scored|scores|points|match|matches|game|games|event|events|played|play|won|win|wins|been|show|me|tell|list|get|give|stats?|statistics|count)\b/g;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Answered from season rows: no event, match-type or colour scope applies to a season's numbers. */
const SEASON_ROWS = new Set<IntentId>(["seasons-played", "seasons-count", "first-season", "best-season", "most-improved-season"]);
/** Answered from the awards: no match type or colour applies. */
const AWARD_IDS = new Set<IntentId>(["event-wins", "inspire-awards", "finalist-finishes", "total-awards", "award-split", "awards"]);
/** Answered from event rows: an event-level scope (Worlds, states, a season) applies, a match type or colour doesn't. */
const EVENT_ROWS = new Set<IntentId>(["best-finish", "worst-finish", "first-event", "last-event", "best-opr-event", "total-events", "average-rank"]);

/** The scope phrases in `q` (lower case), and `q` without them. */
export function readScope(q: string): { scope: ReadScope; rest: string } {
  let rest = q;
  const take = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], " "); return m; };
  const scope: ReadScope = { season: null, latest: false, ever: false, championship: false, states: false, level: null, alliance: null, at: null };
  if (take(WORLDS)) scope.championship = true;
  else if (take(STATES)) scope.states = true;
  // A season: "2024-25" / "2024–25", a game's name ("into the deep"), "this season", "ever".
  const label = take(/\b(?:in\s+|during\s+)?(20\d\d)\s*[-–/]\s*(\d\d)\b/);
  if (label && (Number(label[1]) + 1) % 100 === Number(label[2])) scope.season = Number(label[1]);
  for (const s of SEASONS) {
    if (scope.season != null) break;
    const m = new RegExp(`\\b(?:in\\s+|during\\s+)?${[...s.game.replace(/\s+/g, "").toLowerCase()].join("[\\s-]?")}\\b`).exec(rest);
    if (m) { scope.season = s.season; rest = rest.replace(m[0], " "); }
  }
  // A bare year is its season, as search reads it ("4215 worlds record 2024": 2024–25): one after "in" or "during"
  // first; a number after "team" is always the team ("team 2024 worlds record in 2025").
  if (scope.season == null) {
    const y = /\b(?:in|during)\s+(20\d\d)\b(?!\s*[-–/]\s*\d)/.exec(rest) ?? /(?<!\bteam\s+)\b(20\d\d)\b(?!\s*[-–/]\s*\d)/.exec(rest);
    if (y && SEASONS.some((s) => s.season === Number(y[1]))) { scope.season = Number(y[1]); scope.year = true; rest = rest.replace(y[0], " "); }
  }
  if (take(/\b(?:this|current|the\s+current)\s+(?:season|year)\b|\bthis\s+year'?s?\b/)) scope.latest = true;
  // "Last season" is the season before the current one; a championship question reads it as the latest finished one.
  else if (take(/\b(?:last|previous|past)\s+(?:year|season)'?s?\b/)) { scope.lastYear = true; scope.season ??= CURRENT_SEASON - 1; }
  if (take(/\b(?:ever|all[\s-]+time|of\s+all\s+time|career|in\s+history|overall)\b/)) scope.ever = true;
  if (take(/\b(?:on|as|from)\s+(?:the\s+)?red(?:\s+alliance|\s+side)?\b|\bred\s+alliance\b/)) scope.alliance = "red";
  else if (take(/\b(?:on|as|from)\s+(?:the\s+)?blue(?:\s+alliance|\s+side)?\b|\bblue\s+alliance\b/)) scope.alliance = "blue";
  if (take(/\b(?:in|during)\s+(?:the\s+)?(?:playoffs?|eliminations?|elims?)\b/)) scope.level = "playoff";
  else if (take(/\b(?:in|during)\s+(?:the\s+)?(?:qualifications?|quals?|qualifying)\b/)) scope.level = "qual";
  const at = /\bat\s+(.+)$/.exec(rest);
  if (at && at[1].trim()) { scope.at = at[1].trim(); rest = rest.slice(0, at.index); }
  return { scope, rest: squash(rest) };
}

const hasScope = (s: ReadScope) => s.season != null || s.latest || s.ever || s.championship || s.states || !!s.level || !!s.alliance || !!s.at;

/** The stat question `raw` asks, or null when it isn't one. `raw` is the query as search cleaned it. */
export interface TwoTeamQuestion { id: TwoTeamId; scope: ReadScope; a: string; b: string; phase?: "auto" | "teleop" | "endgame" }

const VS = String.raw`(?:vs\.?|versus|v\.?|against)`;
const H2H = String.raw`(?:head[\s-]?to[\s-]?head|h2h)`;
const WHO = String.raw`(?:who|which(?: team)?)(?: is|'s| has| had)?`;
const PHASE = String.raw`(auto(?:nomous)?|tele ?op|driver(?:[- ]controlled)?|end ?game)`;
/** In order; each names its two teams as groups 1 and 2 (a phase, when asked, as group 3). */
const TWO_TEAM: { id: TwoTeamId; re: RegExp }[] = [
  // "4215 vs 6980 prediction", "6980 versus 4215 who wins", "4215 predicted score against 6980", "4215 expected margin
  // against 6980": the engine's call for the two of them (families/predict.ts).
  { id: "predict", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) (?:prediction|predicted (?:score|winner|result|margin)|forecast|who (?:wins|will win|would win|is favou?red)|favou?rite)$`) },
  { id: "predict", re: new RegExp(String.raw`^(?:who (?:wins|will win|would win)|prediction(?: for)?) (.+?) (?:${VS}|or) (.+)$`) },
  { id: "predict", re: new RegExp(String.raw`^(.+?) (?:predicted|expected|projected) (?:score|margin|result|points) (?:${VS}|over) (.+)$`) },
  // "4215 wins against 6980": the meetings' wins.
  { id: "h2h-wins", re: new RegExp(String.raw`^(.+?) (?:wins|victories) (?:${VS}|over) (.+)$`) },
  // "4215 versus 6980 matches together", "4215 and 6980 matches in common": the list both are in (search's AND list).
  { id: "shared-matches", re: new RegExp(String.raw`^(.+?) (?:${VS}|and|with) (.+?) (?:matches|match|games?) (?:together|in common|shared)$`) },
  { id: "shared-matches", re: new RegExp(String.raw`^(.+?) (?:${VS}|and|with) (.+?) (?:shared|common) (?:matches|match|games?)$`) },
  // "4215 versus 6980 who is better at auto", "who is better at endgame 4215 or 6980".
  { id: "phase-vs", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) (?:${WHO} )?(?:better|stronger|best) (?:at|in) ${PHASE}$`) },
  { id: "phase-vs", re: new RegExp(String.raw`^${WHO} (?:better|stronger) (?:at|in) ${PHASE} (.+?) (?:${VS}|or) (.+)$`) },
  { id: "phase-vs", re: new RegExp(String.raw`^(.+?) ${PHASE} (?:${VS}|compared to|or) (.+)$`) },
  // "4215 versus 6980 who has higher reliability".
  { id: "reliability-vs", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) (?:${WHO} )?(?:higher|better|more|greater) reliab(?:ility|le)$`) },
  { id: "reliability-vs", re: new RegExp(String.raw`^(.+?) reliability (?:${VS}|compared to|or) (.+)$`) },
  { id: "reliability-vs", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) reliability$`) },
  // "4215 versus 6980 who has won more awards".
  { id: "awards-vs", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) (?:${WHO} )?(?:won )?more awards$`) },
  { id: "awards-vs", re: new RegExp(String.raw`^(.+?) awards (?:${VS}|compared to|or) (.+)$`) },
  // "4215 versus 6980 compare": both teams' season numbers in one card.
  { id: "compare", re: new RegExp(String.raw`^(.+?) (?:${VS}|and|or) (.+?) (?:compare|comparison|compared|side by side|stats compared)$`) },
  { id: "head-to-head", re: new RegExp(String.raw`^(.+?) (?:${VS}|and) (.+?) ${H2H}(?: record| matches| results| history)?$`) },
  { id: "head-to-head", re: new RegExp(String.raw`^${H2H}(?: record| matches| results| history)?(?: of| for| between)? (.+?) (?:${VS}|and) (.+)$`) },
  { id: "head-to-head", re: new RegExp(String.raw`^(.+?) ${H2H}(?: record)? (?:${VS}|with) (.+)$`) },
  { id: "head-to-head", re: /^(?:has|have|did) (.+?) (?:ever )?(?:played|faced|met|beaten|beat|lost to)(?: against)? (.+?)(?: before)?$/ },
  { id: "head-to-head", re: new RegExp(String.raw`^(.+?) (?:record|results?|matches|match|games?) (?:against|${VS}) (.+)$`) },
  { id: "opr-vs", re: new RegExp(String.raw`^(.+?) opr (?:${VS}|compared to|or) (.+)$`) },
  { id: "opr-vs", re: new RegExp(String.raw`^(.+?) ${VS} (.+?) opr$`) },
  { id: "rating-vs", re: new RegExp(String.raw`^(.+?) (?:prediction )?(?:rating|strength) (?:${VS}|compared to|or) (.+)$`) },
  { id: "rating-vs", re: new RegExp(String.raw`^(.+?) ${VS} (.+?) (?:prediction )?(?:rating|strength)$`) },
  { id: "win-chance", re: new RegExp(String.raw`^(.+?) (?:win (?:chances?|probability|odds)|chances? (?:of winning|to win)|odds) (?:${VS}|over) (.+)$`) },
  { id: "win-chance", re: /^(?:what are the )?(?:chances?|odds|probability) (?:that )?(.+?) (?:beats|wins against|wins vs|will beat) (.+)$/ },
  { id: "better-record", re: /^(?:who|which team|which) (?:has|had) (?:a |the )?better record (.+?) or (.+)$/ },
  { id: "better-record", re: /^(.+?) or (.+?) (?:who has (?:a |the )?)?better record$/ },
  { id: "better-record", re: /^better record (.+?) or (.+)$/ },
];
/** Read from the matches the two teams met in: a match-type, colour, Worlds or states scope applies to them. */
const MEETING_IDS = new Set<TwoTeamId>(["head-to-head", "h2h-wins", "shared-matches"]);

/** "4215 6980 33950 compare", "compare 4215, 6980 and 33950", "4215 vs 6980 vs 33950": three or four team numbers (as
 *  many as Compare takes), side by side (families/twoTeam.ts compareAnswer). Two teams are readTwoTeam's. Numbers only:
 *  names are Compare's. */
/** The most teams Compare shows side by side. */
const COMPARE_MAX = 4;
export interface TeamSetQuestion { teams: number[]; season: number | null }
export function readTeamSet(raw: string): TeamSetQuestion | null {
  // A bare year in a list of numbers is a team ("4215 6980 2024 compare"); a season is written as one ("2024-25") or
  // named as one ("in 2024", "during 2024").
  const q = ` ${raw.toLowerCase().replace(/[?!,&]/g, " ").replace(/#/g, "")} `.replace(/\s+/g, " ").replace(/(?<!\b(?:in|during|for|from|season|year) )\b(20\d\d)\b(?!\s*[-–/]\s*\d)/g, "n$1");
  const { scope, rest: said } = readScope(q);
  if (scope.at || scope.championship || scope.states || scope.level || scope.alliance) return null;
  const rest = said.replace(/\bn(20\d\d)\b/g, "$1");
  const m = /^(?:compare )?((?:\d{1,5}(?: (?:vs\.?|versus|and|or))? ){2,3}\d{1,5})(?: (?:compare|comparison|compared|side by side|stats))?$/.exec(rest);
  if (!m || (!/^compare /.test(rest) && !/ (?:compare|comparison|compared|side by side|stats)$/.test(rest) && !/\b(?:vs\.?|versus)\b/.test(m[1]))) return null;
  const teams = [...new Set(m[1].split(" ").filter((w) => /^\d+$/.test(w)).map(Number))];
  return teams.length >= 3 && teams.length <= COMPARE_MAX ? { teams, season: scope.season } : null;
}

/** "4215 vs 6980 head to head", "4215 OPR vs 6980", "who has a better record, 4215 or 6980": two teams named, or null. */
/** Family 7: a ranked list ("top 10 teams by OPR in NJ", "best rookie team in New Jersey", "most improved team in
 *  New Jersey") or a city's teams ("teams in Oradell"). */
export interface LeaderboardQuestion {
  kind: "top" | "rookie" | "improved" | "city";
  /** BOARD_STATS key (families/leaderboard.ts). */
  stat: string;
  n: number;
  region: Region | null;
  city: string | null;
  season: number | null;
}

const BOARD_STAT_WORDS: [string, RegExp][] = [
  ["auto", /^auto(?:nomous)?(?: opr| points?| scores?)?$/],
  ["teleop", /^(?:tele ?op|driver(?:[- ]controlled)?|dc)(?: opr| points?| scores?)?$/],
  ["endgame", /^end ?game(?: opr| points?| scores?)?$/],
  ["opr", /^(?:total |overall |season )?opr$/],
  ["win-rate", /^(?:win(?:ning)? (?:rate|percentage|pct|%)|win%)$/],
  ["wins", /^(?:(?:most |match )?wins)$/],
  ["avg-score", /^(?:average|avg|mean) (?:score|points)$/],
  ["rating", /^(?:prediction |predicted )?(?:rating|strength)$/],
];
const boardStat = (s: string) => BOARD_STAT_WORDS.find(([, re]) => re.test(s.trim()))?.[0] ?? null;
/** A place's words as one region (a name, its start, a code, or one near miss), or null. */
const regionOf = (s: string): Region | null => { const rs = findRegions(s); return rs.length === 1 ? rs[0] : rs.length ? null : nearRegion(s); };
const TEAMS = "(?:teams?|robots?|ftc teams?)";
const PLACE = "(?: (?:in|from) (.+))?";

export function readLeaderboard(raw: string): LeaderboardQuestion | null {
  // "overall OPR" is the stat's name, not an every-season scope.
  const q = ` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!,.]/g, " ")} `.replace(/\s+/g, " ").replace(/\b(?:overall|total) opr\b/g, "opr");
  const { scope, rest } = readScope(q);
  if (scope.championship || scope.states || scope.level || scope.alliance || scope.at || scope.ever) return null;
  const n = (s: string | undefined, def: number) => Math.min(25, Math.max(1, s ? Number(s) : def));
  const place = (s: string | undefined): Region | null | false => (s ? regionOf(s) ?? false : null);
  let m: RegExpExecArray | null;
  // "top 10 teams by opr in nj", "best teams by win rate in new jersey"
  if ((m = new RegExp(`^(?:the )?(?:top|best|highest(?: ranked)?|strongest)(?: (\\d{1,2}))? ${TEAMS} (?:by|for|in|on|ranked by|with the (?:best|highest|most)) (.+?)${PLACE}$`).exec(rest))) {
    const stat = boardStat(m[2]), region = place(m[3]);
    if (stat && region !== false) return { kind: "top", stat, n: n(m[1], 10), region, city: null, season: scope.season };
  }
  // "top 10 opr teams in nj", "top 5 auto teams"
  if ((m = new RegExp(`^(?:the )?top (\\d{1,2}) (.+?) ${TEAMS}${PLACE}$`).exec(rest))) {
    const stat = boardStat(m[2]), region = place(m[3]);
    if (stat && region !== false) return { kind: "top", stat, n: n(m[1], 10), region, city: null, season: scope.season };
  }
  // "top 10 teams in nj": a number asked for is honoured (search's own leaderboard shows 5); ranked as Rankings ranks,
  // by the prediction rating
  if ((m = new RegExp(`^(?:the )?(?:top|best|highest ranked|strongest) (\\d{1,2}) ${TEAMS}${PLACE}$`).exec(rest))) {
    const region = place(m[2]);
    if (region !== false) return { kind: "top", stat: "rating", n: n(m[1], 10), region, city: null, season: scope.season };
  }
  // "best rookie team in new jersey", "top 5 rookies in nj"
  if ((m = new RegExp(`^(?:the )?(?:best|top|strongest|highest ranked)(?: (\\d{1,2}))? rookies?(?: ${TEAMS})?(?: by (.+?))?${PLACE}$`).exec(rest))) {
    const stat = m[2] ? boardStat(m[2]) : "opr", region = place(m[3]);
    if (stat && region !== false) return { kind: "rookie", stat, n: n(m[1], 10), region, city: null, season: scope.season };
  }
  // "most improved team in new jersey"
  if ((m = new RegExp(`^(?:the )?(?:top (\\d{1,2}) )?most improved ${TEAMS}${PLACE}$`).exec(rest))) {
    const region = place(m[2]);
    if (region !== false) return { kind: "improved", stat: "opr", n: n(m[1], 10), region, city: null, season: scope.season };
  }
  // "teams in oradell": a city, never a region (the region's own answers are search's)
  if ((m = new RegExp(`^(?:all )?${TEAMS} (?:in|from|based in) (.+)$`).exec(rest)) && !findRegions(m[1]).length && !nearRegion(m[1]) && scope.season == null) {
    return { kind: "city", stat: "opr", n: 25, region: null, city: m[1].trim(), season: null };
  }
  return null;
}

export function readTwoTeam(raw: string): TwoTeamQuestion | null {
  // A sentence's closing period goes; "vs." inside stays.
  const q = ` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!,]/g, " ").replace(/\.+\s*$/, " ")} `.replace(/\s+/g, " ");
  // "red vs blue record" is one team's split by colour, not two teams.
  if (/\b(?:red\s+(?:vs\.?|versus|v\.?|and|or)\s+blue|blue\s+(?:vs\.?|versus|v\.?|and|or)\s+red)\b/.test(q)) return null;
  // A bare year is a season, unless that leaves a side empty: then it's a team's number ("4215 vs 2024 head to head").
  for (const yearIsTeam of [false, true]) {
    // "better at auto" names a phase, not an event called Auto.
    const said = q.replace(new RegExp(String.raw`\b(better|stronger|best) at ${PHASE}\b`, "g"), "$1 in $2");
    const { scope, rest } = readScope(yearIsTeam ? said.replace(/\b(20\d\d)\b(?!\s*[-–/]\s*\d)/g, "n$1") : said);
    // "at <event>" isn't read for two teams: left to search.
    if (scope.at) return null;
    const side = (s: string) => squash(s.replace(/\b(?:team|teams|the|ftc)\b/g, " ").replace(/\bn(20\d\d)\b/g, "$1"));
    for (const r of TWO_TEAM) {
      const m = r.re.exec(rest);
      if (!m) continue;
      // A phase question's phase is whichever group spells one; the other two are its teams.
      const isPhase = (g: string) => new RegExp(`^${PHASE}$`).test(g);
      const groups = m.slice(1, 4).filter((g): g is string => g != null);
      const phaseWord = r.id === "phase-vs" ? groups.find(isPhase) : undefined;
      const [ga, gb] = r.id === "phase-vs" ? groups.filter((g) => g !== phaseWord) : groups;
      const a = side(ga ?? ""), b = side(gb ?? "");
      if (!a || !b || a === b) break;
      // "4215 OPR vs New Jersey average": a team against a field's average (families/facts.ts), not two teams.
      if (/\b(?:average|avg|mean)$/.test(b)) return null;
      // A side still holding a versus word names more than one team: Compare's question, not this one.
      if (new RegExp(String.raw`\b${VS}\b`).test(a) || new RegExp(String.raw`\b${VS}\b`).test(b)) return null;
      // Season numbers are read per team; match-type and colour scopes only apply to the meetings.
      if (!MEETING_IDS.has(r.id) && (scope.championship || scope.states || scope.level || scope.alliance)) return null;
      const phase = phaseWord == null ? undefined : /^a/.test(phaseWord) ? "auto" : /^e/.test(phaseWord) ? "endgame" : "teleop";
      return { id: r.id, scope, a, b, ...(phase ? { phase } : {}) };
    }
    if (!scope.year) break;
  }
  return null;
}

export function readStatQuestion(raw: string): StatQuestion | null {
  const q = ` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!.,]/g, " ")} `.replace(/\s+/g, " ");
  // "world record score" and "highest score this season" with no team are a season's records (searchHighScores.ts).
  if (/\bworld[\s-]+records?\b|\brecords?\s+scores?\b|\bscore\s+records?\b/.test(q)) return null;
  for (const r of RULES) {
    const m = r.re.exec(q);
    if (!m) continue;
    // The intent's own words go; a team named inside them ("how many matches has 4215 in 2024-25 played") stays, so
    // its scope words are read like any other.
    const { scope, rest } = readScope(q.replace(m[0], ` ${m.groups?.team ?? ""} `));
    if (r.id === "winning-alliance") {
      if (/^world\s/.test(m[0])) scope.championship = true;
      // An award's winner ("who won inspire at nj states", "4215 inspire winner") is the awards' own question; "winner"
      // and "champion" alone name a season's winners only with Worlds or a season ("4215 champion" is a team).
      if (AWARD_WORDS.test(q)) continue;
      if (!/^(?:who|winning)/.test(m[0]) && !(scope.championship || scope.states || scope.season != null || scope.lastYear || scope.latest)) continue;
      // A team's number left over ("4215 worlds winner") is a question about that team.
      if (/(?:^|\s)\d{1,5}(?:\s|$)/.test(rest)) continue;
    }
    // A scope the answer's rows can't apply is never dropped silently: the query is left to search.
    if (SEASON_ROWS.has(r.id) && (scope.championship || scope.states || scope.level || scope.alliance)) return null;
    if (EVENT_ROWS.has(r.id) && (scope.level || scope.alliance)) return null;
    if (r.id === "never-played" && (scope.championship || scope.states || scope.level || scope.alliance || scope.ever || scope.at)) return null;
    // An event's rank and OPR are whole-event numbers: a match type or a colour can't apply to them.
    if ((r.id === "event-rank" || r.id === "event-opr") && (scope.level || scope.alliance)) return null;
    if (SEASON_ROWS.has(r.id) && scope.at) return null;
    // A trend is the team's events or seasons: an event, Worlds, a match type or a colour can't apply.
    if (r.family === "trend" && (scope.at || scope.championship || scope.states || scope.level || scope.alliance)) return null;
    // Season by season covers every season (a season named isn't one of its rows); event by event stays in one season
    // (every season is a different game), so "all time" can't apply.
    // A bare year with nothing else naming a team is the team's number ("2024 OPR by season"), not a season.
    const yearIsTeam = scope.year && !squash(rest.replace(FRAME, " ").replace(/\b(?:highest|lowest|best|worst|biggest|average|record)\b/g, " "));
    if ((r.id === "opr-by-season" || r.id === "record-by-season") && scope.season != null && !yearIsTeam) return null;
    if (r.family === "trend" && r.id !== "opr-by-season" && r.id !== "record-by-season" && scope.ever) return null;
    // A season's penalty total is every event's quals: an event, Worlds, a match type, a colour or all time can't apply.
    if (r.id === "total-penalties" && (scope.at || scope.championship || scope.states || scope.level || scope.alliance || scope.ever)) return null;
    if (AWARD_IDS.has(r.id) && (scope.level || scope.alliance)) return null;
    if (r.needsEvent && !scope.at) return null;
    // The red-vs-blue split names both colours itself: never read as a red-only scope.
    if (r.id === "red-blue-record") scope.alliance = null;
    const leadEvent = r.id === "highest-score" && /\b(?:which|what)\s+(?:event|competition|tournament|meet)\b/.test(q);
    // A team's best scores in one season ("4215 high score", "hypnotic best score in decode") are the season records'
    // own answer (searchHighScores.ts, the same rule): taken here only with what that answer doesn't cover (Worlds,
    // states, every season, which event, playoffs or quals, a colour, one event).
    if (r.id === "highest-score" && !(scope.championship || scope.states || scope.ever || leadEvent || scope.level || scope.alliance || scope.at)) return null;
    // "q12", "qual 12": a qualification match only, never a playoff match with that number.
    if (r.id === "match-lookup" && /\bq(?:ual(?:ification)?)?\s*\d/.test(m[0])) scope.level = "qual";
    const n = r.id === "last-matches" ? Math.min(20, Math.max(1, Number(m[1]))) : r.id === "match-lookup" ? Number(m[1] ?? m[2]) : null;
    // "average winning margin", "margin of victory on average": wins only; "average losing margin": losses only.
    const outcome = r.id === "closest-match" || r.id === "current-streak" ? (/\b(?:loss|losing|lost)\b/.test(m[0]) ? "L" : /\bwin/.test(m[0]) ? "W" : null)
      : r.id === "average-margin" ? (/\blosing\b/.test(m[0]) ? "L" : /\b(?:winning|victory)\b/.test(m[0]) ? "W" : null) : null;
    const count = /\b(?:count|how\s+many|number\s+of|total)\b/.test(q);
    // A team-less question: what's left names an event (or nothing: the season's championship).
    // Chosen once the scope is final: a bare year can still turn out to be the team ("2024 record").
    const defaultOf = () => (r.alone && !hasScope(scope) ? r.alone : r.season);
    if (r.noTeam) return { id: r.id, family: r.family, defaultSeason: defaultOf(), scope, leadEvent, n, outcome, count, noTeam: true, core: squash(rest.replace(/\b(?:ftc|first|tech|challenge|the|who|won|what|which|was|is|of|in|for|world|winners?|champions?|winning|alliances?)\b/g, " ").replace(/^[\s-]+|[\s-]+$/g, "")) || (scope.at ?? "") };
    let core = squash(rest.replace(FRAME, " ").replace(/\b(?:highest|lowest|best|worst|biggest|average|record)\b/g, " "));
    // Nothing else names a team: the "year" was the team's number ("2024 worlds record").
    if (!core && scope.year) { core = String(scope.season); scope.season = null; scope.year = false; }
    if (!core) return null;
    return { id: r.id, family: r.family, defaultSeason: defaultOf(), scope, leadEvent, n, outcome, count, noTeam: false, core };
  }
  return null;
}
