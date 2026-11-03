// Reading a stat question (docs/search.md, "Stat answers"): fixed rules, no model. A query is an intent phrase
// ("highest score", "worlds record", "average score"), scope phrases ("at worlds", "this season", "2024-25", "in
// playoffs", "on red", "ever") and what's left, which names the team. One table of intents, each naming its family;
// the scope words are read once, the same way for every intent (./clauses.ts applies them).
import type { StatFamily } from "../../../src/shared/searchStat.js";
import { SEASONS } from "../../data/seasons.js";

export type IntentId =
  // Family 3: one best (or worst) of a filtered set.
  | "highest-score" | "lowest-score" | "biggest-win" | "biggest-loss" | "closest-match" | "first-match" | "recent-match"
  | "best-finish" | "worst-finish" | "first-event" | "last-event" | "best-opr-event" | "best-season" | "most-improved-season" | "first-season"
  // Family 4: a count, a mean, a record or a streak over a filtered set.
  | "wins-count" | "record" | "average-score" | "total-matches" | "total-events" | "seasons-played" | "seasons-count"
  | "current-streak" | "longest-streak" | "last-matches" | "average-rank" | "playoff-appearances"
  | "blowout-wins" | "losses" | "playoff-matches" | "qual-matches" | "red-blue-record";

interface IntentRule {
  id: IntentId;
  family: StatFamily;
  re: RegExp;
  /** The season used when none is named: every season, or the team's latest season with matches. */
  season: "all" | "latest";
  /** Taken only when a scope is named ("4215 record" alone stays search's own team answer). */
  needsScope?: boolean;
}

const MATCHES = "(?:matches|match|games?)";
/** In order: the longer, more specific phrases first ("longest win streak" before "win streak"). */
const RULES: IntentRule[] = [
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
  { id: "record", family: "aggregate", season: "all", needsScope: true, re: /\b(?:win[\s-]+loss(?:[\s-]+tie)?\s+)?record\b/ },
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
}

export interface StatQuestion {
  id: IntentId;
  family: StatFamily;
  defaultSeason: "all" | "latest";
  scope: ReadScope;
  /** "which event did 4215 score highest in": the answer leads with the event. */
  leadEvent: boolean;
  /** "last 5 matches": how many. */
  n: number | null;
  /** "closest win", "current losing streak": the result asked about (null: any). */
  outcome: "W" | "L" | null;
  /** What names the team. */
  core: string;
}

const WORLDS = /\b(?:(?:at|in|during|from)\s+)?(?:the\s+)?(?:worlds?|world\s+champ(?:ionships?|s)?|first\s+champ(?:ionships?|s)?|houston\s+champ(?:ionships?|s)?|championship\s+divisions?)\b/;
const STATES = /\b(?:(?:at|in|during)\s+)?(?:the\s+)?(?:states|state\s+champ(?:ionships?|s)?|state\s+finals?)\b/;
// The question's own words: never part of a team's name here.
const FRAME = /\b(?:how|many|much|what|whats|which|who|when|where|is|was|were|are|has|have|had|did|does|do|the|a|an|of|in|at|on|for|by|to|team|teams|their|its|his|her|ever|all|time|career|so|far|total|number|score|scored|scores|points|match|matches|game|games|event|events|played|play|won|win|wins|been|show|me|tell|list|get|give|stats?|statistics)\b/g;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Answered from season rows: no event, match-type or colour scope applies to a season's numbers. */
const SEASON_ROWS = new Set<IntentId>(["seasons-played", "seasons-count", "first-season", "best-season", "most-improved-season"]);
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
  if (take(/\b(?:this|current|the\s+current)\s+(?:season|year)\b|\bthis\s+year'?s?\b/)) scope.latest = true;
  if (take(/\b(?:ever|all[\s-]+time|of\s+all\s+time|career|in\s+history|overall)\b/)) scope.ever = true;
  if (take(/\b(?:on|as|from)\s+(?:the\s+)?red(?:\s+alliance|\s+side)?\b|\bred\s+alliance\b/)) scope.alliance = "red";
  else if (take(/\b(?:on|as|from)\s+(?:the\s+)?blue(?:\s+alliance|\s+side)?\b|\bblue\s+alliance\b/)) scope.alliance = "blue";
  if (take(/\b(?:in|during)\s+(?:the\s+)?(?:playoffs?|eliminations?|elims?)\b/)) scope.level = "playoff";
  else if (take(/\b(?:in|during)\s+(?:the\s+)?(?:qualifications?|quals?|qualifying)\b/)) scope.level = "qual";
  const at = /\bat\s+(.+)$/.exec(rest);
  if (at && at[1].trim()) scope.at = at[1].trim();
  return { scope, rest: squash(rest) };
}

const hasScope = (s: ReadScope) => s.season != null || s.latest || s.ever || s.championship || s.states || !!s.level || !!s.alliance || !!s.at;

/** The stat question `raw` asks, or null when it isn't one. `raw` is the query as search cleaned it. */
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
    if (r.needsScope && !hasScope(scope)) return null;
    // A scope the answer's rows can't apply is never dropped silently: the query is left to search.
    if (SEASON_ROWS.has(r.id) && (scope.championship || scope.states || scope.level || scope.alliance)) return null;
    if (EVENT_ROWS.has(r.id) && (scope.level || scope.alliance)) return null;
    // The red-vs-blue split names both colours itself: never read as a red-only scope.
    if (r.id === "red-blue-record") scope.alliance = null;
    // An "at <event>" scope belongs to the event family (not built yet): left to search's team-at-event answer.
    if (scope.at) return null;
    const leadEvent = r.id === "highest-score" && /\b(?:which|what)\s+(?:event|competition|tournament|meet)\b/.test(q);
    // A team's best scores in one season ("4215 high score", "hypnotic best score in decode") are the season records'
    // own answer (searchHighScores.ts, the same rule): taken here only with what that answer doesn't cover (Worlds,
    // states, every season, which event, playoffs or quals, a colour).
    if (r.id === "highest-score" && !(scope.championship || scope.states || scope.ever || leadEvent || scope.level || scope.alliance)) return null;
    const n = r.id === "last-matches" ? Math.min(20, Math.max(1, Number(m[1]))) : null;
    const outcome = r.id === "closest-match" || r.id === "current-streak" ? (/\b(?:loss|losing|lost)\b/.test(m[0]) ? "L" : /\bwin/.test(m[0]) ? "W" : null) : null;
    const core = squash(rest.replace(FRAME, " ").replace(/\b(?:highest|lowest|best|worst|biggest|average|record)\b/g, " "));
    if (!core) return null;
    return { id: r.id, family: r.family, defaultSeason: r.season, scope, leadEvent, n, outcome, core };
  }
  return null;
}
