// Reading a stat question (docs/search.md, "Stat answers"): fixed rules, no model. A query is an intent phrase
// ("highest score", "worlds record", "average score"), scope phrases ("at worlds", "this season", "2024-25", "in
// playoffs", "on red", "ever") and what's left, which names the team. One table of intents, each naming its family;
// the scope words are read once, the same way for every intent (./clauses.ts applies them).
import type { StatFamily } from "../../../src/shared/searchStat.js";
import { SEASONS } from "../../data/seasons.js";
import { searchSeason } from "./season.js";
import { findRegions, nearRegion, type Region } from "../../../src/shared/regions.js";

export type IntentId =
  // Family 3: one best (or worst) of a filtered set.
  | "highest-score" | "lowest-score" | "biggest-win" | "biggest-loss" | "closest-match" | "first-match" | "recent-match"
  | "best-finish" | "worst-finish" | "first-place-events" | "worlds-divisions" | "first-event" | "last-event" | "best-opr-event" | "best-season" | "most-improved-season" | "first-season"
  // Family 4: a count, a mean, a record or a streak over a filtered set.
  | "wins-count" | "record" | "average-score" | "average-margin" | "total-points" | "total-matches" | "total-events" | "seasons-played" | "seasons-count"
  | "current-streak" | "longest-streak" | "last-matches" | "average-rank" | "playoff-appearances"
  | "blowout-wins" | "losses" | "playoff-matches" | "qual-matches" | "season-matches" | "red-blue-record"
  // Family 4 again, over the match rows' scores, phases and penalties (families/matchStats.ts).
  | "ties-count" | "win-percent" | "score-range" | "median-score" | "score-consistency" | "scores-over"
  | "highest-auto" | "highest-teleop" | "highest-endgame" | "most-penalties" | "penalties"
  | "easiest-opponent" | "vs-top" | "vs-rookies" | "early-late"
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

/** Family 6 with two teams named ("12345 vs 67890 head to head"). */
export type TwoTeamId = "head-to-head" | "opr-vs" | "rating-vs" | "win-chance" | "better-record"
  | "predict" | "h2h-wins" | "shared-matches" | "compare" | "phase-vs" | "reliability-vs" | "awards-vs";

interface IntentRule {
  id: IntentId;
  family: StatFamily;
  re: RegExp;
  /** The season used when none is named: every season, or the team's latest season with matches. */
  season: "all" | "latest";
  /** The season used when the question names no scope at all ("12345 record": the team's latest season). */
  alone?: "all" | "latest";
  /** Taken only with an event ("12345 rank at New Jersey Championship"). */
  needsEvent?: boolean;
  /** Names no team: what's left names an event, or nothing (the season's championship). */
  noTeam?: boolean;
}

const MATCHES = "(?:matches|match|games?)";
/** Opponents as a group ("against top teams", "vs rookie teams") and a season's halves: read before any team's name. */
const GROUP_TOP = /\b(?:against|vs\.?|versus|facing)\s+(?:the\s+)?(?:top|best|strong(?:est)?|elite|good|better|highest[\s-]rated|top[\s-]rated|high[\s-]rated|top[\s-]ranked)\s+(?:teams?|opponents?|alliances?|competition)\b/;
const GROUP_ROOKIE = /\b(?:against|vs\.?|versus|facing)\s+(?:the\s+)?(?:rookies?|rookie\s+(?:teams?|opponents?)|new\s+teams?|first[\s-]year\s+teams?)\b/;
const HALF = String.raw`(?:early|late|first[\s-]half|second[\s-]half)(?:\s+(?:of\s+the\s+)?season)?(?:\s+(?:form|results?|performance|record))?`;
const EARLY_LATE = new RegExp(String.raw`\b${HALF}\s+(?:vs\.?|versus|against|and|or|compared\s+(?:to|with))\s+${HALF}\b|\b(?:early|late)\s+(?:vs\.?|versus|and)\s+(?:early|late)\s+season\b`);
/** A side of a two-team question that's a group or a time, never a team: "top teams", "rookie teams", "early season". */
export const NOT_A_TEAM = new RegExp(String.raw`^(?:the\s+)?(?:top|best|strong(?:est)?|elite|good|weak(?:er|est)?|better|worse|rookies?|rookie\s+teams?|new\s+teams?|highest[\s-]rated|top[\s-]rated|low(?:er)?[\s-]rated)(?:\s+(?:teams?|opponents?|alliances?|competition))?$|\b${HALF}$`);
/** The words some intents leave around the team ("12345 match with the most penalties", "12345 form in their last 5
 *  matches", "12345 performance against top teams"): never part of a team's name there. */
const AROUND = /\b(?:with|where|when|they|them|trend|form|over|performance|recent|per|rate)\b/g;
const AROUND_IDS = new Set<IntentId>(["ties-count", "win-percent", "score-range", "median-score", "score-consistency", "scores-over", "highest-auto", "highest-teleop", "highest-endgame", "most-penalties", "penalties", "easiest-opponent", "vs-top", "vs-rookies", "early-late", "last-matches", "highest-score", "opr-history"]);
/** The awards by the words people use: a question naming one is about that award, never the winning alliance. */
const AWARD_WORDS = /\b(?:inspire|think|innovate|design|reach|sustain|connect|control|compass|motivate|promote|judges?|deans?|leadership|award)\b/;
/** One award by the words people use for it (awards.type); Inspire and Finalist are intents of their own. */
const AWARD_TYPES: [RegExp, string][] = [
  [/\bwinning\s+alliances?\b|\bwinners?\b/, "Winner"], [/\bjudges?\s+choice\b|\bjudges?\b/, "JudgesChoice"], [/\bdeans?\s+list\b/, "DeansList"],
  [/\bdesign\b/, "Design"], [/\bmotivate\b/, "Motivate"], [/\bthink\b/, "Think"], [/\bconnect\b/, "Connect"], [/\binnovate\b/, "Innovate"],
  [/\bcontrol\b/, "Control"], [/\breach\b/, "Reach"], [/\bsustain\b/, "Sustain"], [/\bcompass\b/, "Compass"], [/\bvolunteer\b/, "Volunteer"],
];
/** In order: the longer, more specific phrases first ("longest win streak" before "win streak"). */
const RULES: IntentRule[] = [
  // A season's or an event's winners: "winning alliance", "who won …", "who took …", and "winner(s)"/"champion(s)" (those two only
  // with Worlds or a season named: "decode winner", "into the deep champions", "worlds winners 2025").
  { id: "winning-alliance", family: "event", season: "all", noTeam: true, re: /\bwinning\s+alliances?\b|\bwho\s+won\b|\bwho\s+took\s+(?!(?:the\s+)?(?:most|fewest|least|highest|lowest|best|worst|first|last|top|longest|biggest|more|fewer)\b)|\b(?:world\s+)?(?:champions?|winners?)\b|\bwinning(?=\s*$)/ },
  { id: "opr-by-season", family: "trend", season: "all", re: /\bopr\s+(?:by|per|each|every|over\s+the)\s+seasons?\b|\bseason(?:al)?\s+opr\b/ },
  { id: "record-by-season", family: "trend", season: "all", re: /\b(?:record|w-l-t|win[\s-]loss(?:[\s-]tie)?)\s+(?:by|per|each|every)\s+season\b|\bseason\s+by\s+season\s+record\b/ },
  // "Late season form versus early season form", "against top teams", "against rookie teams": groups of matches, never
  // a team's name (a team called "Top Hat" or "Rookie" isn't what's asked).
  { id: "early-late", family: "aggregate", season: "latest", re: EARLY_LATE },
  { id: "vs-top", family: "aggregate", season: "latest", re: GROUP_TOP },
  { id: "vs-rookies", family: "aggregate", season: "latest", re: GROUP_ROOKIE },
  { id: "easiest-opponent", family: "aggregate", season: "latest", re: /\b(?:easiest|weakest|lowest[\s-]rated)\s+(?:opponents?|matchups?|rivals?)\b/ },
  { id: "opr-history", family: "trend", season: "all", re: /\bopr\s+(?:history|trend|over\s+time|by\s+event|progression|graph|chart)\b|\bimprovement\s+trend\b/ },
  { id: "avg-score-by-event", family: "trend", season: "all", re: /\b(?:average|avg|mean)\s+(?:alliance\s+)?score\s+(?:by|per|each|at\s+each)\s+event\b/ },
  { id: "total-penalties", family: "aggregate", season: "all", re: /\btotal\s+penalt(?:y|ies)(?:\s+points)?\b|\bpenalt(?:y|ies)\s+total\b/ },
  // "Average penalties per event" is the match rows' per-event figure ("penalties" below), not this trend.
  { id: "avg-penalties", family: "trend", season: "all", re: /\b(?:average|avg|mean)\s+penalt(?:y|ies)\b(?!\s+(?:points\s+)?per\s+event)|\bpenalt(?:y|ies)(?:\s+points)?\s+(?:given|committed|per\s+match|by\s+event|trend)\b/ },
  // A partner's or an opponent's win rate (families/twoTeam.ts) before the team's own.
  { id: "partner-win-rate", family: "two-team", season: "latest", re: /\b(?:alliance\s+)?partners?\s+win(?:ning)?\s+(?:rate|percentage|pct|%)\b|\bwin(?:ning)?\s+(?:rate|percentage)\s+with\s+(?:alliance\s+)?partners?\b/ },
  { id: "opponent-win-rate", family: "two-team", season: "latest", re: /\bopponents?\s+win(?:ning)?\s+(?:rate|percentage|pct|%)(?:\s+against\s+(?:them|it|him|her))?\b|\bwin(?:ning)?\s+(?:rate|percentage)\s+of\s+(?:their\s+)?opponents?\b/ },
  // A win rate by event is the trend; a plain win rate is wins over matches ("26 of 32").
  { id: "win-rate", family: "trend", season: "all", re: /\bwin(?:ning)?\s+(?:rate|percentage|pct|%)\s+(?:by|per|each|at\s+each|every)\s+event\b|\bwin(?:ning)?\s+(?:rate|percentage|pct|%)\s+(?:trend|history|over\s+time)\b/ },
  { id: "win-percent", family: "aggregate", season: "latest", re: /\bwin(?:ning)?\s+(?:rate|percentage|pct|%)|\bwin%/ },
  // Penalty points given away, from the match rows: the most in one match, per match, a rate, per event.
  { id: "most-penalties", family: "superlative", season: "latest", re: /\b(?:most|highest|biggest|worst)\s+(?:penalt(?:y|ies)|fouls?)(?:\s+points)?\b/ },
  { id: "penalties", family: "aggregate", season: "latest", re: /\bfouls?(?:\s+(?:per\s+(?:match|game|event)|rate|committed|points|given(?:\s+away)?))?\b|\bpenalt(?:y|ies)(?:\s+(?:points?\s+)?(?:rate|per\s+(?:match|game|event)|committed|given(?:\s+away)?))?\b/ },
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
  // "Predicted chances of 4215 at …": the projection's chances, led by the chance to win the event.
  { id: "event-win-chance", family: "stat", season: "all", re: /\bchances?\s+(?:to|of)\s+win(?:ning)?\s+(?:an?|the|their|its)\s+(?:next\s+)?(?:event|competition|meet|tournament)\b|\bevent\s+win\s+(?:chances?|odds|probability)\b|\b(?:predicted|projected|forecast)\s+(?:chances?|odds|probabilit(?:y|ies))(?:\s+(?:of|for))?\b/ },
  { id: "toughest-opponent", family: "two-team", season: "all", re: /\b(?:toughest|hardest|strongest|worst)\s+(?:opponents?|rivals?|matchups?)\b|\bnemesis\b/ },
  { id: "most-played-opponent", family: "two-team", season: "all", re: /\bmost\s+(?:played|common|frequent|faced|often\s+(?:played|faced))\s+(?:opponents?|rivals?)\b|\bopponents?\s+(?:faced|played|met)\s+(?:the\s+)?most\b|\bbiggest\s+rival\b/ },
  { id: "frequent-partner", family: "two-team", season: "all", re: /\bmost\s+(?:frequent|common|often|played\s+with)\s+(?:alliance\s+)?partners?\b|\bfrequent\s+(?:alliance\s+)?partners?\b|\bpartnered\s+(?:with\s+)?(?:the\s+)?most\b/ },
  { id: "best-partner", family: "two-team", season: "all", re: /\b(?:best|strongest|top|winningest)\s+(?:alliance\s+)?partners?\b/ },
  // Every partner or opponent: after the superlatives above ("frequent partners", "toughest opponents").
  { id: "partners", family: "two-team", season: "all", alone: "latest", re: /\b(?:all\s+)?(?:alliance\s+)?partners\b|\bteams?\s+(?:they|it)\s+(?:partnered|played)\s+with\b/ },
  { id: "opponents", family: "two-team", season: "all", alone: "latest", re: /\b(?:all\s+)?opponents\b|\bteams?\s+(?:they|it)\s+(?:faced|played\s+against)\b/ },
  { id: "award-split", family: "awards", season: "all", re: /\bjudged\s+(?:vs\.?|versus|and|or)\s+performance(?:\s+awards?)?\b|\bperformance\s+(?:vs\.?|versus|and|or)\s+judged(?:\s+awards?)?\b|\bawards?\s+by\s+(?:type|kind)\b/ },
  // Events the team ranked first at (a placement, never an award): "events 12345 won outright", "… placed first in".
  { id: "first-place-events", family: "superlative", season: "all", re: /\b(?:events?|tournaments?|competitions?|meets?)\s+(?<team>.+?)\s+(?:won\s+outright|(?:placed|ranked|finished)\s+(?:first|1st|#1|number\s+one)(?:\s+(?:in|at))?)(?=\s|$)|\b(?:placed|ranked|finished)\s+(?:first|1st|#1)\s+(?:in|at)\s+(?:events?|tournaments?)\b|\bwon\s+(?:events?\s+)?outright\b/ },
  // The team's Worlds divisions (one per championship it went to): "12345 worlds divisions", "championship divisions
  // 12345 played in", "12345 championship appearances count".
  { id: "worlds-divisions", family: "aggregate", season: "all", re: /\b(?:(?:world|first|houston)\s+)?(?:championship|worlds?)\s+divisions?\b|\bchampionship\s+appearances?\b|\bdivisions?\s+(?:at|in)\s+(?:the\s+)?(?:worlds?|(?:first\s+)?championship)\b/ },
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
  { id: "highest-auto", family: "superlative", season: "latest", re: /\b(?:highest|best|top|most|max(?:imum)?)\s+auto(?:nomous)?(?:\s+(?:scores?|points))?\b(?!\s+(?:opr|teams?))/ },
  { id: "highest-teleop", family: "superlative", season: "latest", re: /\b(?:highest|best|top|most|max(?:imum)?)\s+(?:tele[\s-]?op|driver[\s-]controlled)(?:\s+(?:scores?|points))?\b(?!\s+(?:opr|teams?))/ },
  { id: "highest-endgame", family: "superlative", season: "latest", re: /\b(?:highest|best|top|most|max(?:imum)?)\s+end[\s-]?game(?:\s+(?:scores?|points))?\b(?!\s+(?:opr|teams?))/ },
  { id: "scores-over", family: "aggregate", season: "latest", re: /\b(?:scores?|scored|matches|games)\s+(?:(?:where|when|with|that|in\s+which)\s+(?:they|it|the\s+team)?\s*(?:scored?|had|got)\s+)?(?:of\s+)?(?:over|above|more\s+than|at\s+least|higher\s+than)\s+(\d{2,3})(?:\s+points)?\b/ },
  { id: "median-score", family: "aggregate", season: "latest", re: /\bmedian\s+(?:match\s+|alliance\s+)?(?:scores?|points)\b/ },
  { id: "score-range", family: "aggregate", season: "latest", re: /\b(?:score|scoring|points)\s+(?:range|spread)\b|\brange\s+of\s+scores\b/ },
  { id: "score-consistency", family: "aggregate", season: "latest", re: /\b(?:(?:score|scoring)\s+)?consisten(?:cy|t)(?:\s+(?:rating|score|index))?\b/ },
  { id: "lowest-score", family: "superlative", season: "all", re: /\blowest[\s-]+(?:scoring\s+(?:match|game)|(?:match\s+)?scores?)\b|\bworst\s+(?:match\s+)?scores?\b/ },
  { id: "highest-score", family: "superlative", season: "all", re: /\bhighest[\s-]+scoring(?:\s+(?:match|game))?\b|\b(?:high(?:est)?|best|top|max(?:imum)?|biggest|most)\s+(?:match\s+|alliance\s+)?(?:scores?|points)\b|\bscored?\s+(?:the\s+)?(?:highest|most|best)\b/ },
  { id: "biggest-win", family: "superlative", season: "all", re: /\b(?:biggest|largest|best|widest)\s+(?:win|victory|winning\s+margin|margin\s+of\s+victory|blowout)\b/ },
  { id: "biggest-loss", family: "superlative", season: "all", re: /\b(?:biggest|largest|worst|widest)\s+(?:loss|defeat|losing\s+margin)\b/ },
  { id: "closest-match", family: "superlative", season: "all", re: new RegExp(`\\b(?:closest|tightest|narrowest)\\s+(?:${MATCHES}|win|loss|result)\\b|\\bsmallest\\s+margin\\b`) },
  { id: "blowout-wins", family: "aggregate", season: "all", re: /\bblow\s?outs?(?:\s+wins?)?\b|\bblow\s?out\s+victories\b/ },
  { id: "playoff-appearances", family: "aggregate", season: "all", re: /\b(?:playoffs?|elimination|elims?)\s+appearances?\b|\b(?:times|events)\s+(?:in|made|reached)\s+(?:the\s+)?(?:playoffs?|eliminations?|elims?)\b/ },
  { id: "playoff-matches", family: "aggregate", season: "all", re: new RegExp(`\\b(?:playoffs?|elimination|elims?)\\s+${MATCHES}\\b`) },
  { id: "qual-matches", family: "aggregate", season: "all", re: new RegExp(`\\b(?:qualification|qualifying|quals?)\\s+${MATCHES}\\b`) },
  // A team's matches in a season ("12345 matches in 2025-26"): read by the search pipeline only, so no phrasing here.
  { id: "season-matches", family: "aggregate", season: "latest", re: /(?!)/ },
  { id: "average-rank", family: "aggregate", season: "all", re: /\b(?:average|avg|mean)\s+(?:event\s+)?(?:rank(?:ing)?|placement|finish|place)\b/ },
  { id: "average-margin", family: "aggregate", season: "all", re: /\b(?:average|avg|mean|typical)\s+(?:winning\s+|losing\s+|match\s+)?(?:margin|point\s+differential|differential|point\s+diff)\b|\bmargin\s+(?:of\s+victory\s+)?(?:on\s+)?average\b/ },
  { id: "total-points", family: "aggregate", season: "all", re: /\btotal\s+(?:points|score)(?:\s+scored)?\b|\b(?:points|score)\s+total\b|\ball\s+the\s+points\b|\bhow\s+many\s+points\s+(?:has|have|did)\s+(?<team>.+?)\s+score[ds]?\b/ },
  { id: "average-score", family: "aggregate", season: "latest", re: /\b(?:average|avg|mean)\s+(?:match\s+|alliance\s+)?(?:scores?|points)\b/ },
  { id: "best-finish", family: "superlative", season: "all", re: /\b(?:best|highest|top)\s+(?:event\s+)?(?:finish|placement|ranking|rank|place)\b|\b(?:best|greatest|strongest)\s+(?:event|competition|tournament)\b/ },
  { id: "worst-finish", family: "superlative", season: "all", re: /\b(?:worst|lowest)\s+(?:event\s+)?(?:finish|placement|ranking|rank|place)\b|\b(?:worst|weakest)\s+(?:event|competition|tournament)\b/ },
  { id: "first-event", family: "superlative", season: "all", re: /\b(?:first|debut|earliest)\s+(?:event|competition|tournament|meet)\b/ },
  { id: "last-event", family: "superlative", season: "all", re: /\b(?:last|latest|most\s+recent|newest)\s+(?:event|competition|tournament|meet)\b/ },
  { id: "first-season", family: "superlative", season: "all", re: /\b(?:first|debut|rookie)\s+season\b/ },
  { id: "best-season", family: "superlative", season: "all", re: /\b(?:best|greatest|strongest)\s+season\b/ },
  { id: "seasons-count", family: "aggregate", season: "all", re: /\b(?:seasons?\s+count|how\s+many\s+seasons|number\s+of\s+seasons|seasons?\s+total|total\s+seasons)\b/ },
  { id: "seasons-played", family: "aggregate", season: "all", re: /\bseasons?\s+(?:played|competed|active)\b|\bwhich\s+seasons\b|\blist\s+of\s+seasons\b/ },
  { id: "total-events", family: "aggregate", season: "all", re: /\b(?:total|number\s+of|how\s+many|career)\s+(?:events?|competitions?|tournaments?)\b|\bevents?\s+(?:count|total)\b|\b(?:event|competition)\s+(?:schedule|calendar)\b/ },
  { id: "total-matches", family: "aggregate", season: "all", re: new RegExp(`\\b(?:total|number\\s+of|career)\\s+${MATCHES}(?:\\s+played)?\\b|\\b${MATCHES}\\s+(?:count|total)\\b|\\bhow\\s+many\\s+${MATCHES}\\s+(?:has|have|did)\\s+(?<team>.+?)\\s+play(?:ed)?\\b`) },
  { id: "wins-count", family: "aggregate", season: "all", re: new RegExp(`\\bhow\\s+many\\s+(?:${MATCHES}\\s+|times\\s+)?(?:has|have|did)\\s+(?<team>.+?)\\s+won?\\b|\\b(?:number\\s+of|total|career|how\\s+many)\\s+(?:match\\s+)?wins\\b|\\bwins?\\s+count\\b|\\bwins\\b(?!\\s+and\\s+loss)|\\b${MATCHES}\\s+(?:(?:they|it|the\\s+team)\\s+)?won\\b|\\bwon\\s+${MATCHES}\\b`) },
  { id: "ties-count", family: "aggregate", season: "all", re: new RegExp(`\\bties\\b|\\btied\\s+${MATCHES}|\\bdraws\\b`) },
  { id: "losses", family: "aggregate", season: "all", re: new RegExp(`(?<!\\bwins?\\s+and\\s+)\\blosses\\b|\\blost\\s+${MATCHES}\\b|\\b${MATCHES}\\s+(?:(?:they|it|the\\s+team)\\s+)?lost\\b`) },
  { id: "results", family: "event", season: "all", needsEvent: true, re: /\b(?:results?|matches|match|how\s+did\s+(?<team>.+?)\s+do)\b/ },
  { id: "event-rank", family: "event", season: "all", needsEvent: true, re: /\b(?:rank(?:ed|ing)?|placement|place|placed|finish(?:ed)?|seed(?:ed)?)\b/ },
  { id: "event-opr", family: "event", season: "all", needsEvent: true, re: /\bopr\b/ },
  { id: "awards", family: "awards", season: "all", re: /\bawards?\b/ },
  { id: "record", family: "aggregate", season: "all", alone: "latest", re: /\b(?:win[\s-]+loss(?:[\s-]+tie)?\s+)?record\b|\bwins?\s+and\s+loss(?:es)?\b/ },
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
  /** "at New Jersey events": events in one region. */
  place?: Region | null;
  /** "at out-of-state events": events outside the team's own state. */
  outOfState?: boolean;
  /** `at` was read beside the team, with no "at" (StatQuestion.eventInCore): only the team's own events count. */
  own?: boolean;
  /** "this week", "on Mar 15, 2026": a date window (the search pipeline's time slot, server/api/query/time.ts). */
  window?: { from: string; to: string; label: string };
  /** A place that's a whole country or a region, read by the search pipeline (the regex readers name regions only). */
  area?: { country: string; state: string | null; name: string };
}

export interface StatQuestion {
  id: IntentId;
  family: StatFamily;
  defaultSeason: "all" | "latest";
  scope: ReadScope;
  /** "which event did 12345 score highest in": the answer leads with the event. */
  leadEvent: boolean;
  /** "last 5 matches": how many; "score in match 12": the match number. */
  n: number | null;
  /** "closest win", "current losing streak": the result asked about (null: any). */
  outcome: "W" | "L" | null;
  /** "how many inspire awards", "event wins count": a count, not the list. */
  count: boolean;
  /** "12345 design award", "12345 winning alliance awards": the one award asked about (its awards.type). */
  award?: string;
  /** "12345 latest inspire award", "12345 first award ever": only the newest or the earliest of the awards. */
  pick?: "first" | "latest";
  /** "12345 best event": the event's record breaks a tie on rank, and is shown. */
  byRecord?: boolean;
  /** "12345 event schedule": every event, the ones still to come included. */
  schedule?: boolean;
  /** "penalties per event", "penalty rate": which figure leads a penalties answer; "at least 200": a limit that
   *  includes itself. */
  variant?: "per-event" | "rate" | "at-least" | "total" | null;
  /** No team: what's left (an event's name, or "" for the season's championship). */
  noTeam: boolean;
  /** No "at": the event may be named anywhere in `core` beside the team ("what rank did 4215 get in the east bergen
   *  conference", "4215 conference rank"), as one of the team's own events. */
  eventInCore?: boolean;
  /** "east bergen conference winner": a winner word alone, so `core` has to name an event outright. */
  bare?: boolean;
  /** What names the team. */
  core: string;
}

const WORLDS = /\b(?:(?:at|in|during|from)\s+)?(?:the\s+)?(?:worlds?|world\s+champ(?:ionships?|s)?|first\s+champ(?:ionships?|s)?|houston\s+champ(?:ionships?|s)?|championship\s+divisions?)\b/;
const STATES = /\b(?:(?:at|in|during)\s+)?(?:the\s+)?(?:states|state\s+champ(?:ionships?|s)?|state\s+finals?)\b/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// The question's own words: never part of a team's name here.
const FRAME = /\b(?:how|many|much|what|whats|which|who|when|where|is|was|were|are|has|have|had|did|does|do|the|a|an|of|in|at|on|for|by|to|team|teams|their|its|his|her|ever|all|time|career|so|far|total|number|score|scored|scores|points|match|matches|game|games|event|events|played|play|won|win|wins|been|show|me|tell|list|get|give|stats?|statistics|count)\b/g;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Answered from season rows: no event, match-type or colour scope applies to a season's numbers. */
const SEASON_ROWS = new Set<IntentId>(["seasons-played", "seasons-count", "first-season", "best-season", "most-improved-season"]);
/** Answered from the awards: no match type or colour applies. */
const AWARD_IDS = new Set<IntentId>(["event-wins", "inspire-awards", "finalist-finishes", "total-awards", "award-split", "awards"]);
/** Answered from event rows: an event-level scope (Worlds, states, a season) applies, a match type or colour doesn't. */
const EVENT_ROWS = new Set<IntentId>(["best-finish", "worst-finish", "first-place-events", "worlds-divisions", "first-event", "last-event", "best-opr-event", "total-events", "average-rank"]);

/** An event's rank, OPR and results, and the forecasts: their event can be named without "at" (StatQuestion.eventInCore). */
const EVENT_IN_CORE = new Set<IntentId>(["event-rank", "event-opr", "results", "next-event-wins", "event-win-chance", "advance-chance", "playoff-chance"]);

/** The scope phrases in `q` (lower case), and `q` without them. */
export function readScope(q: string): { scope: ReadScope; rest: string } {
  let rest = q;
  const take = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], " "); return m; };
  const scope: ReadScope = { season: null, latest: false, ever: false, championship: false, states: false, level: null, alliance: null, at: null };
  if (take(WORLDS)) scope.championship = true;
  else {
    // "New Jersey state championship", "nj states": the team's own state championship, the state's name said with it.
    const st = STATES.exec(rest);
    if (st) {
      const before = rest.slice(0, st.index).trimEnd().split(" ");
      const regionOf = (w: string) => findRegions(w).find((r) => r.name.toLowerCase() === w || ((r.country === "USA" || r.country === "Canada") && r.state.toLowerCase() === w));
      const named = (w: string) => !!regionOf(w);
      // Only beside a team's number: "who won nj states" keeps its state, the event it names.
      const team = /(?:^|\s)(?!(?:19|20)\d\d\b)\d{1,5}(?:\s|$)/.test(rest);
      const k = team ? [3, 2, 1].find((n) => before.length > n && named(before.slice(-n).join(" "))) : undefined;
      // The state named stays a limit: "10809 new jersey states" is New Jersey's, not the team's own elsewhere.
      if (k) scope.place = regionOf(before.slice(-k).join(" "));
      rest = `${(k ? before.slice(0, -k) : before).join(" ")} ${rest.slice(st.index + st[0].length)}`;
      scope.states = true;
    }
  }
  // A date names its season ("the March 15 2026 NJ championship": 2025–26, the season of a spring event).
  const date = take(/\b(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(20\d\d)\b/);
  if (date) scope.season = Number(date[2]) - (MONTHS.indexOf(date[1]) >= 8 ? 0 : 1);
  // A season: "2024-25" / "2024–25", a game's name ("into the deep"), "this season", "ever".
  const label = take(/\b(?:in\s+|during\s+)?(20\d\d)\s*[-–/]\s*(\d\d)\b/);
  if (label && (Number(label[1]) + 1) % 100 === Number(label[2])) scope.season = Number(label[1]);
  for (const s of SEASONS) {
    if (scope.season != null) break;
    const m = new RegExp(`\\b(?:in\\s+|during\\s+)?${[...s.game.replace(/\s+/g, "").toLowerCase()].join("[\\s-]?")}\\b`).exec(rest);
    if (m) { scope.season = s.season; rest = rest.replace(m[0], " "); }
  }
  // A bare year is its season, as search reads it ("12345 worlds record 2024": 2024–25): one after "in" or "during"
  // first; a number after "team" is always the team ("team 2024 worlds record in 2025").
  if (scope.season == null) {
    const y = /\b(?:in|during)\s+(20\d\d)\b(?!\s*[-–/]\s*\d)/.exec(rest) ?? /(?<!\bteam\s+)\b(20\d\d)\b(?!\s*[-–/]\s*\d)/.exec(rest);
    if (y && SEASONS.some((s) => s.season === Number(y[1]))) { scope.season = Number(y[1]); scope.year = true; rest = rest.replace(y[0], " "); }
  }
  if (take(/\b(?:this|current|the\s+current)\s+(?:season|year)\b|\bthis\s+year'?s?\b/)) scope.latest = true;
  // "Last season" is the season before the default one (the latest completed season, ./season.ts); a championship
  // question reads it as the latest finished one.
  else if (take(/\b(?:last|previous|past)\s+(?:year|season)'?s?\b/)) { scope.lastYear = true; scope.season ??= searchSeason() - 1; }
  if (take(/\b(?:ever|all[\s-]+time|of\s+all\s+time|career|in\s+history|overall)\b/)) scope.ever = true;
  if (take(/\b(?:on|as|from)\s+(?:the\s+)?red(?:\s+alliance|\s+side)?\b|\bred\s+alliance\b/)) scope.alliance = "red";
  else if (take(/\b(?:on|as|from)\s+(?:the\s+)?blue(?:\s+alliance|\s+side)?\b|\bblue\s+alliance\b/)) scope.alliance = "blue";
  if (take(/\b(?:in|during)\s+(?:the\s+)?(?:playoffs?|eliminations?|elims?)\b/)) scope.level = "playoff";
  else if (take(/\b(?:in|during)\s+(?:the\s+)?(?:qualifications?|quals?|qualifying)\b/)) scope.level = "qual";
  // The match type said before the intent ("12345 playoff record", "quals record this season"); never a match list's
  // own words ("playoff matches"), which their intents read.
  else if (take(/\b(?:playoffs?|eliminations?|elims?)\b(?!\s+(?:matches|match|games?|appearances?|odds|chances?|bracket))/)) scope.level = "playoff";
  else if (take(/\b(?:qualifications?|quals?|qualifying)\b(?!\s+(?:matches|match|games?|odds|chances?))/)) scope.level = "qual";
  // Events by place: "at New Jersey events" (a region), "at out-of-state events" (outside the team's own state).
  if (take(/\b(?:at|in)\s+(?:the\s+)?(?:out[\s-]of[\s-]state|outside(?:\s+(?:the\s+)?(?:home\s+)?state)?|away)\s+(?:events?|competitions?|tournaments?)\b/)) scope.outOfState = true;
  else {
    const pl = /\b(?:at|in)\s+(?:the\s+)?(.+?)\s+(?:events?|competitions?|tournaments?)\b/.exec(rest);
    const region = pl ? regionOf(pl[1]) : null;
    if (pl && region) { scope.place = region; rest = rest.replace(pl[0], " "); }
  }
  const at = /\bat\s+(.+)$/.exec(rest);
  if (at && at[1].trim()) { scope.at = squash(at[1].replace(/^\s*the\s+/, " ")); rest = rest.slice(0, at.index); }
  // "worlds Ross division": one division of the FIRST Championship.
  const div = scope.championship && !scope.at ? /\b([a-z]+)\s+division\b/.exec(rest) : null;
  if (div) { scope.at = div[0]; rest = rest.replace(div[0], " "); }
  return { scope, rest: squash(rest) };
}

/** A scope that says which seasons: with none, an intent's `alone` season applies ("12345 record in quals": the latest). */
const namesSeasons = (s: ReadScope) => s.season != null || s.latest || s.ever || s.championship || s.states || !!s.at;
/** Read from the team's match rows: the only answers a place of events ("at NJ events") applies to. */
const PLACE_IDS = new Set<IntentId>(["highest-score", "lowest-score", "biggest-win", "biggest-loss", "closest-match", "first-match", "recent-match", "wins-count", "record", "average-score", "average-margin", "total-points", "total-matches",
  "current-streak", "longest-streak", "last-matches", "blowout-wins", "losses", "playoff-matches", "qual-matches", "season-matches", "ties-count", "win-percent", "score-range", "median-score", "score-consistency", "scores-over",
  "highest-auto", "highest-teleop", "highest-endgame", "most-penalties", "penalties", "vs-top", "vs-rookies", "early-late"]);

/** Whether `scope` can apply to the rows intent `id` is answered from: a scope that can't is never dropped silently,
 *  the question is left to search instead. The regex readers and the search pipeline both ask it. */
export function scopeFits(id: IntentId, family: StatFamily, scope: ReadScope, opts: { place?: boolean } = {}): boolean {
  const matchLevel = !!(scope.level || scope.alliance);
  if (SEASON_ROWS.has(id) && (scope.championship || scope.states || matchLevel || scope.at || scope.window)) return false;
  if (EVENT_ROWS.has(id) && matchLevel) return false;
  if (id === "never-played" && (scope.championship || scope.states || matchLevel || scope.ever || scope.at || scope.window)) return false;
  // An event's rank and OPR are whole-event numbers: a match type or a colour can't apply to them.
  if ((id === "event-rank" || id === "event-opr") && matchLevel) return false;
  // A trend is the team's events or seasons: an event, Worlds, a match type or a colour can't apply.
  if (family === "trend" && (scope.at || scope.championship || scope.states || matchLevel || scope.window)) return false;
  // A season's penalty total is every event's quals: an event, Worlds, a match type, a colour or all time can't apply.
  if (id === "total-penalties" && (scope.at || scope.championship || scope.states || matchLevel || scope.ever || scope.window)) return false;
  if (AWARD_IDS.has(id) && matchLevel) return false;
  // Awards and event rows take a place and a window too ("12345 awards at New Jersey events"): their clauses read the
  // event's region and days. A state's championship is any team question's ("nj states opr").
  const where = (scope.place && !scope.states) || scope.outOfState || scope.area || scope.window;
  if (opts.place !== false && where && !PLACE_IDS.has(id) && !AWARD_IDS.has(id) && !EVENT_ROWS.has(id)) return false;
  return true;
}

/** An intent's family and the season it reads when none is named (the search pipeline builds its questions with
 *  these, server/api/query/execute.ts). */
export function intentDefaults(id: IntentId): { family: StatFamily; season: "all" | "latest"; alone?: "all" | "latest" } | null {
  const r = RULES.find((x) => x.id === id);
  return r ? { family: r.family, season: r.season, ...(r.alone ? { alone: r.alone } : {}) } : null;
}

/** The stat question `raw` asks, or null when it isn't one. `raw` is the query as search cleaned it. */
export interface TwoTeamQuestion { id: TwoTeamId; scope: ReadScope; a: string; b: string; phase?: "auto" | "teleop" | "endgame" }

const VS = String.raw`(?:vs\.?|versus|v\.?|against)`;
const H2H = String.raw`(?:head[\s-]?to[\s-]?head|h2h)`;
const WHO = String.raw`(?:who|which(?: team)?)(?: is|'s| has| had)?`;
const PHASE = String.raw`(auto(?:nomous)?|tele ?op|driver(?:[- ]controlled)?|end ?game)`;
/** In order; each names its two teams as groups 1 and 2 (a phase, when asked, as group 3). */
const TWO_TEAM: { id: TwoTeamId; re: RegExp; atOnly?: boolean }[] = [
  // "12345 vs 67890 prediction", "67890 versus 12345 who wins", "12345 predicted score against 67890", "12345 expected margin
  // against 67890": the engine's call for the two of them (families/predict.ts).
  { id: "predict", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) (?:prediction|predicted (?:score|winner|result|margin)|forecast|who (?:wins|will win|would win|is favou?red)|favou?rite)$`) },
  { id: "predict", re: new RegExp(String.raw`^(?:who (?:wins|will win|would win)|prediction(?: for)?) (.+?) (?:${VS}|or) (.+)$`) },
  { id: "predict", re: new RegExp(String.raw`^(.+?) (?:predicted|expected|projected) (?:score|margin|result|points) (?:${VS}|over) (.+)$`) },
  // "12345 wins against 67890": the meetings' wins.
  { id: "h2h-wins", re: new RegExp(String.raw`^(.+?) (?:wins|victories) (?:${VS}|over) (.+)$`) },
  // "12345 versus 67890 matches together", "12345 and 67890 matches in common": the list both are in (search's AND list).
  { id: "shared-matches", re: new RegExp(String.raw`^(.+?) (?:${VS}|and|with) (.+?) (?:matches|match|games?) (?:together|in common|shared)$`) },
  { id: "shared-matches", re: new RegExp(String.raw`^(.+?) (?:${VS}|and|with) (.+?) (?:shared|common) (?:matches|match|games?)$`) },
  // "12345 and 67890 matches at river dell": the matches both are in there (an event or a venue named only).
  { id: "shared-matches", atOnly: true, re: new RegExp(String.raw`^(.+?) (?:${VS}|and|with) (.+?) (?:matches|match|games?)$`) },
  // "12345 vs 67890 at worlds who scored higher": their meetings there.
  { id: "head-to-head", re: new RegExp(String.raw`^(.+?) (?:${VS}|and|or) (.+?) (?:${WHO} )?(?:scored|scores|scoring) (?:higher|more|the most)$`) },
  // "12345 versus 67890 who is better at auto", "who is better at endgame 12345 or 67890".
  { id: "phase-vs", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) (?:${WHO} )?(?:better|stronger|best) (?:at|in) ${PHASE}$`) },
  { id: "phase-vs", re: new RegExp(String.raw`^${WHO} (?:better|stronger) (?:at|in) ${PHASE} (.+?) (?:${VS}|or) (.+)$`) },
  { id: "phase-vs", re: new RegExp(String.raw`^(.+?) ${PHASE} (?:${VS}|compared to|or) (.+)$`) },
  // "12345 versus 67890 who has higher reliability".
  { id: "reliability-vs", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) (?:${WHO} )?(?:higher|better|more|greater) reliab(?:ility|le)$`) },
  { id: "reliability-vs", re: new RegExp(String.raw`^(.+?) reliability (?:${VS}|compared to|or) (.+)$`) },
  { id: "reliability-vs", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) reliability$`) },
  // "12345 versus 67890 who has won more awards".
  { id: "awards-vs", re: new RegExp(String.raw`^(.+?) (?:${VS}|or) (.+?) (?:${WHO} )?(?:won )?more awards$`) },
  { id: "awards-vs", re: new RegExp(String.raw`^(.+?) awards (?:${VS}|compared to|or) (.+)$`) },
  // "12345 versus 67890 compare": both teams' season numbers in one card.
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

/** "12345 67890 33950 compare", "compare 12345, 67890 and 33950", "12345 vs 67890 vs 33950": three or four team numbers (as
 *  many as Compare takes), side by side (families/twoTeam.ts compareAnswer). Two teams are readTwoTeam's. Numbers only:
 *  names are Compare's. */
/** The most teams Compare shows side by side. */
const COMPARE_MAX = 4;
export interface TeamSetQuestion { teams: number[]; season: number | null }
export function readTeamSet(raw: string): TeamSetQuestion | null {
  // A bare year in a list of numbers is a team ("12345 67890 2024 compare"); a season is written as one ("2024-25") or
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

/** "12345 vs 67890 head to head", "12345 OPR vs 67890", "who has a better record, 12345 or 67890": two teams named, or null. */
/** Family 7: a ranked list ("top 10 teams by OPR in NJ", "best rookie team in New Jersey", "most improved team in
 *  New Jersey") or a city's teams ("teams in Oradell"). */
export interface LeaderboardQuestion {
  kind: "top" | "rookie" | "improved" | "city" | "city-best";
  /** BOARD_STATS key (families/leaderboard.ts). */
  stat: string;
  n: number;
  region: Region | null;
  city: string | null;
  season: number | null;
  /** "best team in New Jersey by OPR": one team asked for. */
  best?: boolean;
  /** "sorted lowest to highest", "worst opr": the bottom of the list, lowest first. */
  asc?: boolean;
  /** Teams with no losses only. */
  undefeated?: boolean;
  /** A town in the region: its teams only. */
  town?: string | null;
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
  ["record", /^(?:(?:win[- ]loss(?:[- ]tie)? )?record|w-l-t)$/],
  ["reliability", /^(?:reliability|reliable|dependability)(?: index| score)?$/],
  // Singular when search has read the plural as one ("most match played"), only with its verb.
  ["matches", /^(?:(?:matches|games)(?: played)?|(?:match|game) played)$/],
  ["events", /^(?:(?:events|competitions|meets)(?: played| attended)?|(?:event|competition|meet) (?:played|attended))$/],
  ["awards", /^awards?(?: won)?$/],
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
  // "best team in new jersey by opr", "best team by auto opr in nj": one team, the next few listed under it
  if ((m = new RegExp(`^(?:the )?(?:best|top|strongest|highest ranked) (?:team|robot|ftc team) (?:(?:in|from) (.+?) by (.+)|by (.+?)${PLACE})$`).exec(rest))) {
    const stat = boardStat(m[2] ?? m[3]), region = place(m[1] ?? m[4]);
    if (stat && region !== false) return { kind: "top", stat, n: 5, region, city: null, season: scope.season, best: true };
  }
  // "new jersey leaderboard by rating", "leaderboard by record in nj", "nj leaderboard": the place's ranked list (by
  // the prediction rating, as Rankings, unless a stat is named)
  if ((m = /^(?:the )?(?:(.+?) )?(?:leaderboard|rankings?|standings)(?: (?:by|for|on) (.+?))?(?: (?:in|from) (.+))?$/.exec(rest)) && (m[1] || m[2] || m[3]) && !(m[1] && m[3])) {
    const stat = m[2] ? boardStat(m[2]) : "rating", region = place(m[1] ?? m[3]);
    // "12345 rankings" names a team: only a place (or no place, with a stat) is a leaderboard.
    if (stat && region !== false && (region || !m[1])) return { kind: "top", stat, n: m[2] ? 25 : 10, region, city: null, season: scope.season };
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
  // "which team has the most awards in nj", "team that played the most matches", "most events played in ohio": a
  // count's board, its leader first. Right after "most" a count needs no verb: search reads "most matches" as "most
  // match" (matches played), and a verb said before it is its own ("attended the most event").
  // Counted at some events only ("at New Jersey events", "out of state") is a count the board can't make: none.
  if (!scope.place && !scope.outOfState && (m = new RegExp(`^(?:(?:which|what) )?(?:${TEAMS} )?(?:(?:in|from) (.+?) )?(?:(?:that|who) )?(?:(has|have|had|with|won|played|plays|attended|got) )?(?:the )?most (.+?)${PLACE}$`).exec(rest))) {
    const stat = boardStat(m[3]) ?? boardStat(`${m[3]} ${m[2] === "attended" ? "attended" : "played"}`), region = place(m[1] ?? m[4]);
    if ((stat === "matches" || stat === "events" || stat === "awards") && region !== false) return { kind: "top", stat, n: 10, region, city: null, season: scope.season, best: true };
  }
  // "most improved team in new jersey"
  if ((m = new RegExp(`^(?:the )?(?:top (\\d{1,2}) )?most improved ${TEAMS}${PLACE}$`).exec(rest))) {
    const region = place(m[2]);
    if (region !== false) return { kind: "improved", stat: "opr", n: n(m[1], 10), region, city: null, season: scope.season };
  }
  // "best team in oradell": a city's best team by OPR, never a region's (above)
  if ((m = new RegExp(`^(?:the )?(?:best|top|strongest)(?: (\\d{1,2}))? ${TEAMS} (?:in|from|based in) (.+)$`).exec(rest)) && !findRegions(m[2]).length && !nearRegion(m[2])) {
    return { kind: "city-best", stat: "opr", n: n(m[1], 10), region: null, city: m[2].trim(), season: scope.season };
  }
  // "teams in oradell": a city, never a region (the region's own answers are search's)
  if ((m = new RegExp(`^(?:all )?${TEAMS} (?:in|from|based in) (.+)$`).exec(rest)) && !findRegions(m[1]).length && !nearRegion(m[1]) && scope.season == null) {
    return { kind: "city", stat: "opr", n: 25, region: null, city: m[1].trim(), season: null };
  }
  // A place read as events' ("in nj events") is the teams from there; outside the team's own state has no board.
  const sorted = scope.outOfState ? null : readSorted(rest);
  if (!sorted || (sorted.region && scope.place)) return null;
  return { kind: "top", ...sorted, n: 10, region: sorted.region ?? scope.place ?? null, city: null, season: scope.season };
}

const LOW_WORDS = "worst|lowest|weakest", LOW = `(?:${LOW_WORDS})`;
/** Lowest first, or highest first, said in words ("sorted lowest to highest", "ascending", "high to low"). */
const ASC = String.raw`(?:(?:from )?(?:the )?(?:lowest|worst|smallest|least|bottom) (?:to (?:the )?(?:highest|best|top|biggest|most)|first|up)|(?:in )?ascending(?: order)?|low to high|from the bottom)`;
const DESC = String.raw`(?:(?:from )?(?:the )?(?:highest|best|top|biggest|most) (?:to (?:the )?(?:lowest|worst|smallest|bottom)|first|down)|(?:in )?descending(?: order)?|high to low)`;
const SORTED = "(?:sorted|ranked|ordered|listed|sort|order|rank)";
const PHASE_ORDER = ["auto", "teleop", "endgame"];

/** A stat's words, or two or three phases joined ("auto and endgame", "auto + teleop"): their OPRs added, as
 *  "auto+endgame" (families/leaderboard.ts boardStatFor). */
function sortStat(s: string): string | null {
  const one = boardStat(s);
  if (one) return one;
  const parts = s.split(/\s*(?:\band\b|\+|&|,)\s*/).filter(Boolean).map(boardStat);
  if (parts.length < 2 || parts.some((p) => !p || !PHASE_ORDER.includes(p))) return null;
  const ids = PHASE_ORDER.filter((p) => parts.includes(p));
  return ids.length > 1 ? ids.join("+") : ids[0];
}

/** A leaderboard asked for as a sort, in plain words: "what is the best team sorted by auto", "best auto sorted lowest
 *  to highest", "teleop ranked", "best auto and endgame". `asc`: lowest first. A sort word, a direction or phases
 *  joined has to be said, so "best auto" and "best team" stay the asks' own. */
function readSorted(rest: string): { stat: string; asc?: boolean; region?: Region } | null {
  let t = rest.replace(/^(?:what|who|which)(?: is| are|s)? (?:the )?/, "").replace(/(?:^| )(?:right now|right|rn|currently|now|please)(?= |$)/g, " ").replace(/\s+/g, " ").trim();
  // A direction said last, before or after a place ("in ascending order", "from the bottom" are directions, not places).
  let dir: "asc" | "desc" | null = null;
  const direction = () => {
    const d = new RegExp(String.raw`(?:^| )(?:${SORTED} )?(${ASC}|${DESC})$`).exec(t);
    if (d) { dir = new RegExp(`^${ASC}$`).test(d[1]) ? "asc" : "desc"; t = t.slice(0, d.index).trim(); }
  };
  direction();
  // A place said last ("teams ranked by auto in nj"): its teams, or no board when it names no region.
  let region: Region | undefined;
  const pl = / (?:in|from) (.+)$/.exec(t);
  if (pl) { const r = regionOf(pl[1]); if (!r) return null; region = r; t = t.slice(0, pl.index).trim(); if (!dir) direction(); }
  const out = (q: string | undefined, s: string) => {
    const stat = sortStat(s);
    return stat ? { stat, ...(region ? { region } : {}), ...(dir === "asc" || (!dir && q && new RegExp(`^${LOW}$`).test(q)) ? { asc: true } : {}) } : null;
  };
  const Q = `(?:(best|top|highest|strongest|${LOW_WORDS}) )?`;
  let m: RegExpExecArray | null;
  // "best team sorted by auto", "teams ranked by teleop opr"
  if ((m = new RegExp(String.raw`^(?:the )?${Q}(?:${TEAMS} )?${SORTED} (?:by|on) (.+)$`).exec(t))) return out(m[1], m[2]);
  // "teleop ranked", "best auto sorted", "endgame rankings"
  if ((m = new RegExp(String.raw`^(?:the )?${Q}(.+?)(?: ${TEAMS})? (?:${SORTED}|rankings?|leaderboard)$`).exec(t))) return out(m[1], m[2]);
  // "best auto and endgame", or a direction said ("auto lowest to highest")
  if ((m = new RegExp(String.raw`^(?:the )?${Q}(.+?)(?: ${TEAMS})?$`).exec(t)) && (dir || /\band\b|\+|&/.test(m[2]))) return out(m[1], m[2]);
  return null;
}

export function readTwoTeam(raw: string): TwoTeamQuestion | null {
  // A sentence's closing period goes; "vs." inside stays.
  const q = ` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!,]/g, " ").replace(/\.+\s*$/, " ")} `.replace(/\s+/g, " ");
  // "red vs blue record" is one team's split by colour, not two teams.
  if (/\b(?:red\s+(?:vs\.?|versus|v\.?|and|or)\s+blue|blue\s+(?:vs\.?|versus|v\.?|and|or)\s+red)\b/.test(q)) return null;
  // A bare year is a season, unless that leaves a side empty: then it's a team's number ("12345 vs 2024 head to head").
  for (const yearIsTeam of [false, true]) {
    // "better at auto" names a phase, not an event called Auto.
    const said = q.replace(new RegExp(String.raw`\b(better|stronger|best) at ${PHASE}\b`, "g"), "$1 in $2");
    const { scope, rest } = readScope(yearIsTeam ? said.replace(/\b(20\d\d)\b(?!\s*[-–/]\s*\d)/g, "n$1") : said);
    // "at <event>" is read for their meetings only (an event or a venue); else left to search.
    const side = (s: string) => squash(s.replace(/\b(?:team|teams|the|ftc)\b/g, " ").replace(/\bn(20\d\d)\b/g, "$1"));
    for (const r of TWO_TEAM) {
      if (r.atOnly && !scope.at) continue;
      const m = r.re.exec(rest);
      if (!m) continue;
      if (scope.at && !MEETING_IDS.has(r.id)) return null;
      // A phase question's phase is whichever group spells one; the other two are its teams.
      const isPhase = (g: string) => new RegExp(`^${PHASE}$`).test(g);
      const groups = m.slice(1, 4).filter((g): g is string => g != null);
      const phaseWord = r.id === "phase-vs" ? groups.find(isPhase) : undefined;
      const [ga, gb] = r.id === "phase-vs" ? groups.filter((g) => g !== phaseWord) : groups;
      const a = side(ga ?? ""), b = side(gb ?? "");
      if (!a || !b || a === b) break;
      // "12345 record against top teams": a group of opponents (the stat answers' own), never a team named "Top Hat".
      if (NOT_A_TEAM.test(a) || NOT_A_TEAM.test(b)) return null;
      // "12345 OPR vs New Jersey average": a team against a field's average (families/facts.ts), not two teams.
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
  const q = ` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!.,]/g, " ")} `.replace(/\s+/g, " ")
    // "matches at their last event", "… at its first event this season": the team's own event, never the superlative.
    .replace(/\bat (?:their|its|his|her|the) (?:(last|latest|most recent|newest|previous)|first|debut|earliest) (?:event|competition|tournament|meet)\b/, (_, last) => `at ${last ? THEIR_LAST : THEIR_FIRST}`);
  // "world record score" and "highest score this season" with no team are a season's records (searchHighScores.ts).
  if (/\bworld[\s-]+records?\b|\brecords?\s+scores?\b|\bscore\s+records?\b/.test(q)) return null;
  for (const r of RULES) {
    const m = r.re.exec(q);
    if (!m) continue;
    // The intent's own words go; a team named inside them ("how many matches has 12345 in 2024-25 played") stays, so
    // its scope words are read like any other.
    const { scope, rest } = readScope(q.replace(m[0], ` ${m.groups?.team ?? ""} `));
    let bare = false;
    if (r.id === "winning-alliance") {
      if (/^world\s/.test(m[0])) scope.championship = true;
      // An award's winner ("who won inspire at nj states", "12345 inspire winner") is the awards' own question; "winner"
      // and "champion" alone name a season's winners only with Worlds or a season ("12345 champion" is a team).
      if (AWARD_WORDS.test(q)) continue;
      // A team's number left over ("12345 worlds winner") is a question about that team.
      if (/(?:^|\s)\d{1,5}(?:\s|$)/.test(rest)) continue;
      // Else an event named outright ("east bergen conference winner"): `bare`, checked once the event is looked up.
      if (!/^(?:who|winning\s)/.test(m[0]) && !(scope.championship || scope.states || scope.season != null || scope.lastYear || scope.latest)) bare = true;
    }
    // A scope the answer's rows can't apply is never dropped silently: the query is left to search.
    if (!scopeFits(r.id, r.family, scope, { place: false })) return null;
    // Season by season covers every season (a season named isn't one of its rows); event by event stays in one season
    // (every season is a different game), so "all time" can't apply.
    // A bare year with nothing else naming a team is the team's number ("2024 OPR by season"), not a season.
    const yearIsTeam = scope.year && !squash(rest.replace(FRAME, " ").replace(/\b(?:highest|lowest|best|worst|biggest|average|record)\b/g, " "));
    if ((r.id === "opr-by-season" || r.id === "record-by-season") && scope.season != null && !yearIsTeam) return null;
    if (r.family === "trend" && r.id !== "opr-by-season" && r.id !== "record-by-season" && scope.ever) return null;
    // "Wins" alone counts match wins only with a scope ("12345 worlds wins"); "12345 wins" stays search's.
    if (r.id === "wins-count" && m[0] === "wins" && !(scope.championship || scope.states || scope.season != null || scope.latest || scope.at)) continue;
    // Worlds divisions are the FIRST Championship's, whichever word named it ("championship divisions").
    if (r.id === "worlds-divisions") scope.championship = true;
    // "12345 matches at worlds in 2025": the championship held in 2025 (2024–25), as the winners read a year.
    if (r.id === "results" && scope.championship && scope.year && scope.season != null) { scope.season -= 1; scope.year = false; }
    // Search reads plurals as their singular ("matches" → "match"): "match" alone names a team's matches only at an
    // event or Worlds ("12345 match record" is the record's).
    // Nor a question that asks for a record, rank or OPR ("12345 match record at worlds in 2025" is the record's).
    // An event named beside the team counts as one ("12345 matches east bergen conference": read beside it, below).
    const besideTeam = /\s/.test(squash(rest.replace(FRAME, " ")));
    if (r.id === "results" && m[0] === "match" && (!(scope.at || scope.championship || scope.states || besideTeam) || /\b(?:record|w-l-t|win[\s-]+loss|rank(?:ed|ing)?|placement|place[ds]?|finish(?:ed)?|seed(?:ed)?|opr)\b/.test(q))) continue;
    // A team's matches at Worlds need no one event ("12345 matches at worlds in 2025").
    // At states: the team's own state championship that season (its division and finals), answered as one event.
    // Else the event may be in what's left beside the team ("12345 rank in the east bergen conference"): the answer
    // looks for it among the team's own events (StatQuestion.eventInCore).
    const eventInCore = EVENT_IN_CORE.has(r.id) && !scope.at && !scope.championship && !scope.states;
    if (r.needsEvent && !scope.at && !(r.id === "results" && scope.championship) && !(scope.states && r.id !== "match-lookup") && !eventInCore) return null;
    // Awards and event rows take a place too ("12345 awards at New Jersey events"): their clauses read the event's region.
    // A state's championship is any team question's ("nj states opr").
    if (((scope.place && !scope.states) || scope.outOfState) && !PLACE_IDS.has(r.id) && !AWARD_IDS.has(r.id) && !EVENT_ROWS.has(r.id)) return null;
    // A rules question about a penalty ("penalty for pinning", "what is a major foul") is the rules' own, never a team's.
    if ((r.id === "penalties" || r.id === "most-penalties") && /\b(?:major|minor|tech(?:nical)?|yellow|red)\s+(?:fouls?|penalt|cards?)|\b(?:penalt(?:y|ies)|fouls?)\s+(?:for|if|when|in\s+the\s+rules)\b|\bwhat\s+(?:is|are|counts)\b|\bcan\s+(?:a|you|robots?)\b/.test(q)) continue;
    // The red-vs-blue split names both colours itself: never read as a red-only scope.
    if (r.id === "red-blue-record") scope.alliance = null;
    const leadEvent = r.id === "highest-score" && /\b(?:which|what)\s+(?:event|competition|tournament|meet)\b/.test(q);
    // A team's best score is always this answer ("12345 high score", "12345 best match", "highest scoring match this
    // season"): the official score, as its match list shows it, so every phrasing names the same match. A season's
    // records with no team stay searchHighScores.ts's.
    // "q12", "qual 12": a qualification match only, never a playoff match with that number.
    if (r.id === "match-lookup" && /\bq(?:ual(?:ification)?)?\s*\d/.test(m[0])) scope.level = "qual";
    const n = r.id === "last-matches" ? Math.min(20, Math.max(1, Number(m[1]))) : r.id === "match-lookup" ? Number(m[1] ?? m[2]) : r.id === "scores-over" ? Number(m[1]) : null;
    const variant = r.id === "penalties" ? (/\bper\s+event\b/.test(q) ? "per-event" : /\brate\b/.test(q) ? "rate" : null)
      : r.id === "scores-over" && /\bat\s+least\b/.test(m[0]) ? "at-least" : null;
    // "average winning margin", "margin of victory on average": wins only; "average losing margin": losses only.
    const outcome = r.id === "closest-match" || r.id === "current-streak" ? (/\b(?:loss|losing|lost)\b/.test(m[0]) ? "L" : /\bwin/.test(m[0]) ? "W" : null)
      : r.id === "average-margin" ? (/\blosing\b/.test(m[0]) ? "L" : /\b(?:winning|victory)\b/.test(m[0]) ? "W" : null) : null;
    const count = /\b(?:count|how\s+many|number\s+of|total)\b/.test(q);
    // A team-less question: what's left names an event (or nothing: the season's championship).
    // Chosen once the scope is final: a bare year can still turn out to be the team ("2024 record").
    const defaultOf = () => (r.alone && !namesSeasons(scope) ? r.alone : r.season);
    if (r.noTeam) return { id: r.id, family: r.family, defaultSeason: defaultOf(), scope, leadEvent, n, outcome, count, noTeam: true, ...(bare ? { bare } : {}), core: squash(rest.replace(/\b(?:ftc|first|tech|challenge|the|who|won|what|which|was|is|of|in|for|world|winners?|champions?|winning|alliances?)\b/g, " ").replace(/^[\s-]+|[\s-]+$/g, "")) || (scope.at ?? "") };
    // One award named, and only the newest or the earliest: their words never name the team.
    let left = rest, award: string | undefined, pick: "first" | "latest" | undefined;
    if (r.id === "awards" || r.id === "total-awards" || r.id === "inspire-awards") {
      const t = r.id === "inspire-awards" ? undefined : AWARD_TYPES.find(([re]) => re.test(left));
      if (t) { award = t[1]; left = left.replace(t[0], " "); }
      const p = /\b(?:latest|most\s+recent|newest|last|recent|first|earliest|debut|oldest)\b/.exec(left);
      if (p) { pick = /^(?:first|earliest|debut|oldest)$/.test(p[0]) ? "first" : "latest"; left = left.replace(p[0], " "); }
    }
    let core = squash(left.replace(FRAME, " ").replace(/\b(?:highest|lowest|best|worst|biggest|average|record)\b/g, " "));
    if (AROUND_IDS.has(r.id)) core = squash(core.replace(AROUND, " "));
    // Nothing else names a team: the "year" was the team's number ("2024 worlds record").
    if (!core && scope.year) { core = String(scope.season); scope.season = null; scope.year = false; }
    if (!core) return null;
    // An event's own number with only the team said ("4215 rank"): no event, so it's search's team answer.
    if (eventInCore && r.needsEvent && !/\s/.test(core)) return null;
    const byRecord = (r.id === "best-finish" || r.id === "worst-finish") && /\b(?:event|competition|tournament)$/.test(m[0]);
    return { id: r.id, family: r.family, defaultSeason: defaultOf(), scope, leadEvent, n, outcome, count, variant, noTeam: false, core, ...(eventInCore ? { eventInCore } : {}), ...(award ? { award } : {}), ...(pick ? { pick } : {}), ...(byRecord ? { byRecord } : {}), ...(r.id === "total-events" && /schedule|calendar/.test(m[0]) ? { schedule: true } : {}) };
  }
  // "12345 at states": its results there.
  const { scope, rest } = readScope(q);
  const core = squash(rest.replace(FRAME, " "));
  if (scope.states && core && !/\s/.test(core)) return { id: "results", family: "event", defaultSeason: "all", scope, leadEvent: false, n: null, outcome: null, count: false, noTeam: false, core };
  return null;
}

/** The team's own last and first event, as an event scope's words ("12345 matches at their last event"). */
export const THEIR_LAST = "their-last-event", THEIR_FIRST = "their-first-event";
