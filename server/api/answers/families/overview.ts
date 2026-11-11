// "How good is <team>", "is <team> actually that good", "whats up with <team>", "<team> stuff", "everything about
// <team>": an open question about a team as a whole. Answered with the team page's own season numbers in one card:
// OPR with its world rank and percentile, the record and the prediction rating (./oprRating.ts "overview"). A question
// naming one thing about the team ("how good is <team> at auto", "<team> record") is left to the readers of that thing.
import { readScope } from "../read.js";
import type { OprRatingQuestion } from "./oprRating.js";

/** The ways an open question about a team is put: the team's words are group 1. Fixed shapes, read in order. */
const SHAPES: RegExp[] = [
  /^(?:.*?\s)?how\s+(?:good|strong)\s+(?:is|are|was|were)\s+(.+)$/,
  // "is <team> good", "is <team> actually that good or just hype", "can u tell me if <team> is good".
  /^(?:.*?\s)?(?:is|are|was|were)\s+(.+?)\s+(?:even\s+|actually\s+|really\s+|truly\s+)*(?:that\s+|so\s+|any\s+|very\s+|pretty\s+)?good\b(.*)$/,
  /^(?:.*?\s)?if\s+(.+?)\s+(?:is|are|was|were)\s+(?:even\s+|actually\s+|really\s+|truly\s+)*(?:that\s+|so\s+|any\s+|very\s+|pretty\s+)?good\b(.*)$/,
  /^what(?:s|'s|\s+is)\s+up\s+with\s+(.+)$/,
  /^(?:show\s+me\s+|give\s+me\s+|tell\s+me\s+)?everything\s+(?:about|on|for)\s+(.+)$/,
  /^(?:show\s+me\s+|give\s+me\s+)?(.+?)\s+stuff\b(.*)$/,
];

/** What a speaker adds around the question, never what it asks: "really", "be honest", "are they cracked". */
const ASIDES = [
  /\b(?:like\s+)?in\s+plain\s+numbers\b/g,
  /\b(?:are|is)\s+(?:they|it|he|she|them)\s+(?:actually\s+|really\s+)?(?:cracked|good|any\s+good|legit|elite|nice|decent|strong)\b/g,
  /\bor\s+(?:just\s+)?(?:hype|overrated|not|what|nah)\b/g,
  /\blike\s+everything\b/g,
  /\b(?:be\s+honest|honestly|for\s+real|fr|tbh|tho|though|really|actually|truly|overall|right\s+now|lol)\b/g,
];

/** Words that say the question is about one thing, not the team as a whole: another reader's. */
const ONE_THING = /\b(?:at|in\s+(?:auto|tele|end|the\s+(?:auto|playoffs?|finals?|quals?))|auto(?:nomous)?|tele-?op|end\s?game|opr|rating|record|wins?|loss(?:es)?|scores?|points|penalt(?:y|ies)|awards?|matches|match|events?|worlds|states|championship|vs\.?|versus|than|compared|partners?|opponents?|defen[cs]e|drivers?|robot|rank(?:ed|ing)?|percentile|next|last|first)\b/;

/** The overview question `raw` asks, or null. */
export function readOverview(raw: string): OprRatingQuestion | null {
  const q = raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!,.;:]+/g, " ").replace(/\s+/g, " ").trim();
  for (const re of SHAPES) {
    const m = re.exec(q);
    if (!m) continue;
    let words = ` ${m[1]} ${m[2] ?? ""} `;
    for (const a of ASIDES) words = words.replace(a, " ");
    const { scope, rest } = readScope(words.replace(/\s+/g, " ").trim());
    if (scope.level || scope.alliance || scope.states || scope.at || scope.championship || scope.place || scope.outOfState || scope.ever) return null;
    const core = rest.replace(/\b(?:the|team|ftc|they|them|their)\b/g, " ").replace(/\s+/g, " ").trim();
    if (!core || ONE_THING.test(core)) return null;
    return { id: "overview", core, season: scope.season, region: null, ever: false, ...(scope.future ? { future: scope.future } : {}) };
  }
  return null;
}
