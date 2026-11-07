// Long, conversational queries said the short way search's readers know (docs/search-layers.md, "Long-form"):
// "when was the last time 12345 went worlds" is "12345 worlds appearances", "is 12345 better than 67890 at auto" is
// "12345 versus 67890 who is better at auto". Fixed rules, no model: the question's wrapper ("can you tell me", "what
// was", "how many times has", "please", "?") and its fillers ("the team", "right now") go, the verbs around Worlds
// and events ("went", "made it to", "qualified for") become the phrase the answer families read, and every word that
// scopes the answer stays: a season ("last season", "2024-25"), a place, an event's name.

/** A team as a long question names it: its number (with "team" or "#" before it), or the words of its name. */
const T = String.raw`(?:the\s+)?(?:team\s+)?#?(\d{1,6}|[a-z][a-z0-9 .&'-]*?)`;
/** What may follow a rank question: a season or a place only ("in 2025-26", "last season", "in new jersey"), so a team's
 *  name is never cut short and "at worlds" isn't a rank. */
const NEAR_TAIL = String.raw`(?:\s+(?:in|during|for|this|last|from)\s.*)?`;
const WORLDS = String.raw`(?:the\s+)?(?:worlds|world\s+championships?|first\s+championship|championship)`;
/** The verbs a question puts between a team and an event ("went to", "made it to", "qualified for", "competed at"). */
const STATES = String.raw`(?:the\s+)?(?:states|state\s+championships?|state\s+champs?|state\s+finals?)`;
const GO = String.raw`(?:went|gone|go|going|been|made\s+it|make\s+it|qualif(?:y|ied)|competed?|attend(?:ed)?|played|play|advanced?)(?:\s+(?:to|for|at|in))?`;
const PHASE = String.raw`(auto(?:nomous)?|tele-?op|driver(?:\s+controlled)?|end\s?game)`;

/** Opening wrappers, longest first: they ask, they never name what's asked. */
const OPENERS = [
  /^(?:hey|hi|so|ok(?:ay)?|um+|uh+)\s+/,
  /^(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?(?:tell|show|give|find|get)\s+(?:me|us)\s+/,
  /^(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?/,
  /^(?:i\s+(?:want|wanna|would\s+like|'d\s+like|need)\s+(?:to\s+)?(?:know|see|find\s+out)\s+)/,
  /^(?:do\s+you\s+know\s+|tell\s+me\s+|show\s+me\s+|give\s+me\s+|find\s+me\s+|please\s+)/,
];
/** Spoken fillers anywhere in a question ("what is like the opr for 12345"): never what is asked. "like" only where it
 *  says nothing: never comparing ("teams like 12345", "robots like theirs", "what does 12345 look like"), nor before a
 *  team's number. */
const FILLERS = /\s(?:um+|uh+|basically|actually|literally|kinda|kind\s+of|sort\s+of|(?<!\b(?:teams?|robots?|ones?|someone|something|anything|similar|look|looks|looked|feel|feels|would|do|does|did|i|you|we|they)\s)like(?!\s+(?:#?\d+|them|theirs|their|it|this|that|those|these|team|robot)\b))(?=\s)/g;
/** Closing fillers: "please", "for me", "right now", "thanks". */
const CLOSERS = /\s+(?:please|pls|for\s+me|thanks|thank\s+you|right\s+now|currently|at\s+the\s+moment)$/;

/** Whole-question rules, first match wins: what each long phrasing asks, said as its short form. `$n` are the
 *  captured groups; the scope words after them (a season, a place) are kept by `tail`. */
const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  // Worlds and states: when (the first or the last time), how often, whether, which divisions, how far.
  [new RegExp(String.raw`^(?:when\s+(?:was|is)\s+(?:the\s+)?(last|latest|most\s+recent|first|earliest)\s+time|when\s+did|how\s+many\s+times\s+(?:has|have|did)|how\s+often\s+(?:has|have|did)|(?:has|have|did)|was)\s+${T}\s+(?:ever\s+)?(?:(first|last)\s+)?${GO}\s+(?:(${WORLDS})|(${STATES}))(.*)$`), (m) => {
    const kind = m[4] ? "worlds" : "states", which = m[1] ?? m[3], tail = m[6];
    // A season or place after a Worlds question ("… in 2024-25") is read by Worlds divisions, which takes a scope; the
    // appearances card is every season's, with the first or last trip as its headline.
    if (tail.trim() && kind === "worlds") return `${m[2]} worlds divisions${tail}`;
    return `${m[2]} ${which ? `${/^(?:first|earliest)/.test(which) ? "first" : "last"} ` : ""}${kind} appearances${tail}`;
  }],
  [new RegExp(String.raw`^(?:which|what)\s+(?:worlds\s+)?divisions?\s+(?:has|have|did)\s+${T}\s+(?:ever\s+)?(?:played|play|been|competed?)\s+(?:in\s+)?(?:at\s+)?${WORLDS}(.*)$`), (m) => `${m[1]} worlds divisions${m[2]}`],
  [new RegExp(String.raw`^(?:what\s+(?:is|was)\s+|how\s+(?:far|well)\s+did\s+)${T}\s+(?:best\s+finish|go|do)\s+(?:at|in)\s+${WORLDS}(.*)$`), (m) => `${m[1]} worlds best finish${m[2]}`],
  // Partners and opponents.
  [new RegExp(String.raw`^who\s+(?:did|has|have|does)\s+${T}\s+(?:play(?:ed)?|team(?:ed)?\s+up|partner(?:ed)?|been\s+(?:on\s+)?an?\s+alliance)\s+with\s+(?:the\s+)?most(?:\s+often)?(.*)$`), (m) => `${m[1]} most common alliance partner${m[2]}`],
  [new RegExp(String.raw`^who\s+(?:did|has|have|does)\s+${T}\s+(?:play(?:ed)?|face[ds]?|compete[ds]?)\s+against\s+(?:the\s+)?most(?:\s+often)?(.*)$`), (m) => `${m[1]} most common opponent${m[2]}`],
  [new RegExp(String.raw`^who\s+(?:is|was|are|were)\s+${T}\s+(?:best|top)\s+(?:alliance\s+)?partners?(.*)$`), (m) => `${m[1]} best alliance partner${m[2]}`],
  [new RegExp(String.raw`^how\s+many\s+times\s+(?:has|have|did)\s+${T}\s+(?:beaten|beat|won\s+against|defeated|defeat)\s+(?:team\s+)?(\d{1,6})(.*)$`), (m) => `${m[1]} wins against ${m[2]}${m[3]}`],
  // Two teams side by side.
  [new RegExp(String.raw`^(?:is|was|are)\s+${T}\s+better\s+(?:than|then)\s+(?:team\s+)?(\d{1,6})\s+(?:at|in|during)\s+${PHASE}(.*)$`), (m) => `${m[1]} versus ${m[2]} who is better at ${phase(m[3])}${m[4]}`],
  [new RegExp(String.raw`^who\s+(?:has|have)\s+(?:won\s+more\s+awards|more\s+awards)\s+(?:team\s+)?(\d{1,6})\s+or\s+(?:team\s+)?(\d{1,6})(.*)$`), (m) => `${m[1]} versus ${m[2]} who has won more awards${m[3]}`],
  [new RegExp(String.raw`^who\s+(?:has|is)\s+(?:higher|better|more)\s+reliab(?:ility|le)\s+(?:team\s+)?(\d{1,6})\s+or\s+(?:team\s+)?(\d{1,6})(.*)$`), (m) => `${m[1]} versus ${m[2]} who has higher reliability${m[3]}`],
  [new RegExp(String.raw`^who\s+is\s+better\s+at\s+${PHASE}\s+(?:team\s+)?(\d{1,6})\s+or\s+(?:team\s+)?(\d{1,6})(.*)$`), (m) => `${m[2]} versus ${m[3]} who is better at ${phase(m[1])}${m[4]}`],
  [new RegExp(String.raw`^what\s+(?:are|is)\s+(?:the\s+)?(?:chances?|odds|probability)\s+(?:that\s+)?(?:team\s+)?(\d{1,6})\s+(?:beats?|wins?\s+against|defeats?)\s+(?:team\s+)?(\d{1,6})(.*)$`), (m) => `${m[1]} win probability against ${m[2]}${m[3]}`],
  // Predictions for the team's next event.
  [new RegExp(String.raw`^how\s+many\s+(?:matches\s+)?(?:wins|matches)\s+(?:is|will)\s+${T}\s+(?:predicted|expected|projected|going)\s+to\s+(?:get|win|have)(?:\s+at\s+(?:their|its|the)\s+next\s+(?:event|meet|competition))?(.*)$`), (m) => `${m[1]} predicted wins at their next event${m[2]}`],
  [new RegExp(String.raw`^what\s+(?:are|is)\s+${T}\s+(?:chances?|odds)\s+(?:of|to)\s+(?:advancing|advance|making\s+it|qualifying|qualify|going)\s+(?:to|for)\s+${WORLDS}(.*)$`), (m) => `${m[1]} chance to advance to worlds${m[2]}`],
  // The teams around a team's world rank ("who is ranked just above and just below 12345 worldwide", "teams ranked
  // near 12345"): its OPR rank, whose card lists them.
  [new RegExp(String.raw`^(?:who|which\s+teams?|what\s+teams?)\s+(?:is|are|was|were)\s+(?:ranked\s+)?(?:just\s+|right\s+|directly\s+|immediately\s+)?(?:above|below|ahead\s+of|behind)(?:\s+and\s+(?:just\s+|right\s+|directly\s+|immediately\s+)?(?:above|below|ahead\s+of|behind))?\s+${T}(?:\s+(?:worldwide|globally|in\s+the\s+world(?:\s+rankings?)?|in\s+the\s+rankings?))?(${NEAR_TAIL})$`), (m) => `${m[1]} opr rank${m[2]}`],
  [new RegExp(String.raw`^(?:(?:who|which\s+teams?|what\s+teams?)\s+(?:is|are)\s+|teams?\s+)(?:ranked\s+)?(?:near|around|close\s+to|next\s+to)\s+${T}(?:\s+(?:worldwide|globally|in\s+the\s+world(?:\s+rankings?)?|in\s+the\s+rankings?))?(${NEAR_TAIL})$`), (m) => `${m[1]} opr rank${m[2]}`],
  // Their events, OPR over time, rank.
  [new RegExp(String.raw`^(?:what|which)\s+(?:events?|meets?|competitions?|tournaments?)\s+(?:has|have|did|does)\s+${T}\s+(?:go(?:ne)?\s+to|went\s+to|compete(?:d)?\s+(?:at|in)|attend(?:ed)?|play(?:ed)?\s+(?:at|in))(.*)$`), (m) => `events ${m[1]} went to${m[2]}`],
  [new RegExp(String.raw`^how\s+(?:has|did|have)\s+${T}\s+opr\s+(?:changed|change|grown|grow|improved|improve|gone|developed)(?:\s+(?:over|across|through)\s+(?:the\s+)?(?:seasons|years))?(.*)$`), (m) => `${m[1]} opr trend over seasons${m[2]}`],
  // "Where does 12345 rank": OPR, unless the question names the stat ("in rating", "by auto opr").
  [new RegExp(String.raw`^where\s+(?:does|did|do)\s+${T}\s+rank(?:\s+(?:in|by|for|on)\s+(?:the\s+)?((?:(?:auto|teleop|endgame|penalty)\s+)?opr|(?:prediction\s+)?rating|reliability))?(.*)$`), (m) => {
    const stat = m[2] ? (/rating/.test(m[2]) ? "rating" : m[2]) : "opr";
    return `${m[1]} ${stat} rank${m[3]}`;
  }],
  [new RegExp(String.raw`^how\s+(?:did|has|does|is)\s+${T}\s+(?:do|done|doing)\b(?:\s+record(?:\s+|-)?wise)?(.*?)(?:\s+record(?:\s+|-)?wise)?$`), (m) => `${m[1]} record${m[2]}`],
  // "what is the highest score 12345 has ever gotten": the stat, then the team, then a verb.
  [new RegExp(String.raw`^(?:what|which)\s+(?:is|was|are|were)\s+(?:the\s+)?(.+?)\s+(?:that\s+)?(?:team\s+)?(\d{1,6})\s+(?:has\s+|have\s+|had\s+)?(?:ever\s+)?(?:gotten|got|had|scored|earned|won|reached|posted|put\s+up|hit)(.*)$`), (m) => `${m[2]} ${m[1]} ever${m[3]}`],
  // The plain wrappers last: "what is the opr of team 12345", "what was 12345 record at worlds".
  [/^(?:what|which)\s+(?:is|was|are|were)\s+(?:the\s+)?(.+?)\s+(?:of|for)\s+(?:the\s+)?(?:team\s+)?#?(\d{1,6})(.*)$/, (m) => `${m[2]} ${m[1]}${m[3]}`],
  [/^(?:what|which)\s+(?:is|was|are|were)\s+(?:the\s+)?(?:team\s+)?#?(\d{1,6})\s+(.+)$/, (m) => `${m[1]} ${m[2]}`],
];

const phase = (p: string) => (/^auto/.test(p) ? "auto" : /^tele|^driver/.test(p) ? "teleop" : "endgame");

/** The long query said the short way, or null when it isn't a long phrasing this knows (nothing would change). */
export function longForm(raw: string): string | null {
  let t = ` ${raw.toLowerCase().replace(/[?!.]+\s*$/, "").replace(/[’]/g, "'").replace(/\s+/g, " ").trim()} `;
  // "12345's", "hypnotic robotics'": the possessive is the team.
  t = t.replace(/(\d)'s\b/g, "$1").replace(/(\w)'s\s/g, "$1 ").replace(/(\w)s'\s/g, "$1s ");
  t = t.trim();
  const start = t;
  // Inner fillers go once, before the wrappers are read ("what is like the opr for 12345" → "what is the opr for 12345").
  for (let n = ` ${t} `.replace(FILLERS, ""); n !== ` ${t} `; n = ` ${t} `.replace(FILLERS, "")) t = n.trim();
  for (let changed = true; changed;) {
    changed = false;
    for (const o of OPENERS) { const n = t.replace(o, ""); if (n !== t && n) { t = n; changed = true; } }
    const n = t.replace(CLOSERS, "");
    if (n !== t && n) { t = n; changed = true; }
  }
  for (const [re, to] of RULES) {
    const m = re.exec(t);
    if (m) { t = to(m); break; }
  }
  // A team number with "team" before it ("the team 12345", "team #12345") is that number.
  t = t.replace(/\b(?:the\s+)?team\s+#?(\d{1,6})\b/g, "$1").replace(/\s+/g, " ").trim();
  return t && t !== start ? t : null;
}
