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
/** A rank question naming another number than OPR after the team ("in rating", "in auto") isn't the OPR list's; the
 *  team's own name may hold one of these words ("Teleop Tigers"). */
const OTHER_STAT = /\b(?:ratings?|elo|predict(?:ed|ion)?|auto(?:nomous)?|tele-?op|driver|end\s?game|scores?|points|wins?|record|awards?|penalt(?:y|ies)|reliab(?:le|ility)|np)\b/;
/** A team as its number with its name after it ("24033 alphatronic"), or as `T` names it. */
const TN = String.raw`(?:the\s+)?(?:team\s+)?#?(\d{1,6}(?:\s+[a-z][a-z0-9 .&'-]*?)?|[a-z][a-z0-9 .&'-]*?)`;
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
/** Each rule: what it reads, and its short form (null: the rule declines, and the next one is tried). */
const RULES: [RegExp, (m: RegExpExecArray) => string | null][] = [
  // Worlds and states: when (the first or the last time), how often, whether, which divisions, how far.
  [new RegExp(String.raw`^(?:when\s+(?:was|is)\s+(?:the\s+)?(last|latest|most\s+recent|first|earliest)\s+time|when\s+did|how\s+many\s+times\s+(?:has|have|did)|(?:the\s+)?(?:number|count)\s+of\s+times(?:\s+that)?(?:\s+(?:has|have|did))?|how\s+often\s+(?:has|have|did)|(?:has|have|did)|was)\s+${T}\s+(?:(?:has|have|had|did)\s+)?(?:ever\s+)?(?:(first|last)\s+)?${GO}\s+(?:(${WORLDS})|(${STATES}))(.*)$`), (m) => {
    const kind = m[4] ? "worlds" : "states", which = m[1] ?? m[3], tail = m[6];
    // A season or place after a Worlds question ("… in 2024-25") is read by Worlds divisions, which takes a scope; the
    // appearances card is every season's, with the first or last trip as its headline.
    if (tail.trim() && kind === "worlds") return `${m[2]} worlds divisions${tail}`;
    return `${m[2]} ${which ? `${/^(?:first|earliest)/.test(which) ? "first" : "last"} ` : ""}${kind} appearances${tail}`;
  }],
  [new RegExp(String.raw`^(?:which|what)\s+(?:worlds\s+)?divisions?\s+(?:has|have|did)\s+${T}\s+(?:ever\s+)?(?:played|play|been|competed?)\s+(?:in\s+)?(?:at\s+)?${WORLDS}(.*)$`), (m) => `${m[1]} worlds divisions${m[2]}`],
  // "What division was 12345 in at worlds, and what was their rank there": its Worlds divisions, each with its rank and
  // record there.
  [new RegExp(String.raw`^(?:which|what)\s+(?:worlds\s+)?divisions?\s+(?:is|was|were|are)\s+${T}\s+(?:in\s+)?(?:at|for)\s+${WORLDS}(.*?)(?:,?\s+and\s+(?:what|how)\s+(?:was|were|is)\s+(?:their|its)\s+(?:rank|ranking|place|placement|finish|record|seed)(?:\s+(?:there|in\s+it))?)?$`), (m) => `${m[1]} worlds divisions${m[2]}`],
  [new RegExp(String.raw`^(?:what\s+(?:is|was)\s+|how\s+(?:far|well)\s+did\s+)${T}\s+(?:best\s+finish|go|do)\s+(?:at|in)\s+${WORLDS}(.*)$`), (m) => `${m[1]} worlds best finish${m[2]}`],
  // A match told by its margin ("whats the score of that one match where 12345 lost by a lot"): the team's biggest loss
  // or win, whose card names the match and its score.
  [new RegExp(String.raw`^(?:(?:what|which)(?:\s+(?:is|was)|s)?\s+)?(?:the\s+)?(?:(?:final\s+)?score\s+(?:of|in|for)\s+)?(?:that|the)?\s*(?:one\s+)?(?:match|game)\s+(?:where|when|that|in\s+which)\s+${T}\s+(lost|won)\s+(?:by\s+(?:a\s+lot|a\s+ton|so\s+much|the\s+most|a\s+mile|miles|the\s+biggest\s+margin|a\s+huge\s+margin)|so\s+(?:badly|big))(.*)$`),
    (m) => `${m[1]} ${/^won/.test(m[2]) ? "biggest win" : "biggest loss"}${m[3]}`],
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
  [new RegExp(String.raw`^(?:who|which\s+teams?|what\s+teams?)\s+(?:is|are|was|were)\s+(?:ranked\s+)?(?:just\s+|right\s+|directly\s+|immediately\s+)?(?:above|below|ahead\s+of|behind)(?:\s+and\s+(?:just\s+|right\s+|directly\s+|immediately\s+)?(?:above|below|ahead\s+of|behind))?\s+${T}(?:\s+(?:worldwide|globally|in\s+the\s+world(?:\s+rankings?)?|in\s+the\s+rankings?))?(${NEAR_TAIL})$`), (m) => (OTHER_STAT.test(m[2]) ? null : `${m[1]} opr rank${m[2]}`)],
  [new RegExp(String.raw`^(?:(?:who|which\s+teams?|what\s+teams?)\s+(?:is|are)\s+|teams?\s+)(?:ranked\s+)?(?:near|around|close\s+to|next\s+to)\s+${T}(?:\s+(?:worldwide|globally|in\s+the\s+world(?:\s+rankings?)?|in\s+the\s+rankings?))?(${NEAR_TAIL})$`), (m) => (OTHER_STAT.test(m[2]) ? null : `${m[1]} opr rank${m[2]}`)],
  // A team's own listing asked as a yes-or-no question: its rookie season ("is 12345 a rookie team or old"), where it's
  // from ("is 12345 actually from romania or what"), its sponsors, school or website ("does 12345 have any sponsors
  // listed on their team page"). The fact's card answers it, with the place or year itself.
  [new RegExp(String.raw`^(?:is|are)\s+${TN}\s+(?:an?\s+)?(?:rookies?|new|first[\s-]year|veteran|old)(?:\s+(?:team|teams|one))?(?:\s+or\s+(?:an?\s+)?(?:an?\s+)?(?:old|older|new|veteran|established|experienced|rookie)(?:\s+(?:team|one))?)?(?:\s+or\s+not)?$`), (m) => `${m[1]} rookie year`],
  [new RegExp(String.raw`^(?:is|are)\s+${TN}\s+(?:really\s+)?(?:from|based\s+in|located\s+in)\s+(?:the\s+)?[a-z][a-z .'-]*?(?:\s+or\s+(?:what|not))?$`), (m) => `where is ${m[1]} from`],
  [new RegExp(String.raw`^(?:does|do|did)\s+${TN}\s+(?:have|has|list)\s+(?:any\s+|an?\s+)?(sponsors?|school|website|site)(?:\s+(?:listed|named|on\s+record))?(?:\s+on\s+(?:their|its|the)\s+(?:team\s+)?page)?$`), (m) => `${m[1]} ${m[2] === "site" ? "website" : m[2].replace(/^sponsor$/, "sponsors")}`],
  // Their events, OPR over time, rank.
  // One of the team's own events by when it was, and how it did there ("what was the last event 12345 played, and how
  // did they do", "what was 12345's first event this season, and what was their OPR there"): that event's answer.
  [new RegExp(String.raw`^what\s+(?:was|is)\s+(?:the\s+)?(last|latest|most\s+recent|first|earliest)\s+(?:event|competition|tournament|meet)\s+${TN}\s+(?:played(?:\s+(?:at|in))?|went\s+to|attended|competed\s+(?:at|in)|was\s+at)(.*?)(?:,?\s+and\s+how\s+did\s+(?:they|it)\s+do(?:\s+there)?)?$`), (m) => `${m[2]} results at their ${which(m[1])} event${m[3]}`],
  [new RegExp(String.raw`^what\s+(?:was|is)\s+${TN}\s+(last|latest|most\s+recent|first|earliest)\s+(?:event|competition|tournament|meet)(.*?),?\s+and\s+(?:what|how)\s+(?:was|is)\s+(?:their|its)\s+(opr|rank|ranking|record)(?:\s+there|\s+at\s+it)?$`), (m) => `${m[1]} ${m[4] === "ranking" ? "rank" : m[4]} at their ${which(m[2])} event${m[3]}`],
  // Its events in a place, or how many and the best of them: its events list (each with its rank), the scope kept.
  [new RegExp(String.raw`^(?:what|which)\s+(?:events?|meets?|competitions?|tournaments?)\s+(?:has|have|did|does)\s+${TN}\s+(?:play(?:ed)?|compete(?:d)?|go\s+to|went\s+to|attend(?:ed)?)\s+in\s+(.+)$`), (m) => `${m[1]} events in ${m[2]}`],
  // "Did 12345 play at any event in June": the events it played that month (the list says none if so). A month only:
  // the events-played filter is the season list's, never a place's (Greptile on #1084).
  [new RegExp(String.raw`^(?:did|has|have)\s+${TN}\s+(?:play(?:ed)?|compete(?:d)?)\s+(?:at|in)\s+(?:any|an)\s+(?:events?|competitions?|meets?|tournaments?)\s+((?:in|during)\s+(?:the\s+month\s+of\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+20\d\d)?(?:\s+(?:in|during|for|this|last)\s+.+)?)$`), (m) => `${m[1]} events played ${m[2]}`],
  // "12345 events and best finish in 2025-26": the season's events, whose headline names the best finish.
  [new RegExp(String.raw`^${TN}\s+(?:events?|meets?|competitions?)\s+and\s+(?:their\s+|its\s+|the\s+)?best\s+(?:finish|event|rank(?:ing)?|placement|result)(\s+(?:in|during|for|this|last)\s.*)$`), (m) => `${m[1]} events${m[2]}`],
  [new RegExp(String.raw`^how\s+many\s+(?:events?|meets?|competitions?|tournaments?)\s+(?:has|have|did)\s+${TN}\s+(?:play(?:ed)?(?:\s+in)?|compete(?:d)?(?:\s+in)?|attend(?:ed)?|go\s+to|been\s+to)(.*?),?\s+and\s+which\s+(?:was|were|is)\s+(?:their|its)\s+best(?:\s+(?:one|event|finish))?(?:\s+by\s+(?:rank|finish|placement))?$`), (m) => `${m[1]} events played${m[2]}`],
  // "What is my 12345 (upcoming) event": the team's own, its next.
  [/^(?:what|which|when)\s+(?:is|are|was)\s+my\s+(?:team\s+)?#?(\d{1,6})(?:\s+(?:next|upcoming))?\s+(?:event|events|competition|meet)$/, (m) => `${m[1]} next event`],
  [new RegExp(String.raw`^(?:what|which)\s+(?:events?|meets?|competitions?|tournaments?)\s+(?:has|have|did|does)\s+${T}\s+(?:go(?:ne)?\s+to|went\s+to|compete(?:d)?\s+(?:at|in)|attend(?:ed)?|play(?:ed)?\s+(?:at|in))(.*)$`), (m) => `events ${m[1]} went to${m[2]}`],
  [new RegExp(String.raw`^how\s+(?:has|did|have)\s+${T}\s+opr\s+(?:changed|change|grown|grow|improved|improve|gone|developed)(?:\s+(?:over|across|through)\s+(?:the\s+)?(?:seasons|years))?(.*)$`), (m) => `${m[1]} opr trend over seasons${m[2]}`],
  // The team itself changed between two seasons ("how has 12345 changed from last season to this season"): its OPR's
  // change, set against its world standing each season (answers/families/seasonChange.ts). "From last season" alone
  // runs to this season, as "since" does.
  [new RegExp(String.raw`^how\s+(?:has|have|did)\s+${T}\s+(?:changed|change|improved|improve|grown|grow|developed|progressed)\s+((?:from|since|between)\s+.+)$`), (m) => `${m[1]} opr change ${m[2]}${/^from\s/.test(m[2]) && !/\sto\s/.test(m[2]) ? " to this season" : ""}`],
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

const which = (w: string) => (/^(?:first|earliest)$/.test(w) ? "first" : "last");
const phase = (p: string) => (/^auto/.test(p) ? "auto" : /^tele|^driver/.test(p) ? "teleop" : "endgame");

/** The long query said the short way, or null when it isn't a long phrasing this knows (nothing would change). */
export function longForm(raw: string): string | null {
  let t = ` ${raw.toLowerCase().replace(/[?!.]+\s*$/, "").replace(/[’]/g, "'").replace(/\s+/g, " ").trim()} `;
  // "12345's", "hypnotic robotics'": the possessive is the team.
  t = t.replace(/(\d)'s\b/g, "$1").replace(/(\w)'s\s/g, "$1 ").replace(/(\w)s'\s/g, "$1s ");
  t = t.trim();
  const start = t;
  // "my 12345", "our team 12345": whose team it is, never part of what's asked.
  t = t.replace(/\b(?:my|our)\s+(?=(?:team\s+)?#?\d{1,6}\b)/g, "").trim();
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
    const short = m ? to(m) : null;
    if (short != null) { t = short; break; }
  }
  // A team number with "team" before it ("the team 12345", "team #12345") is that number.
  t = t.replace(/\b(?:the\s+)?team\s+#?(\d{1,6})\b/g, "$1").replace(/\s+/g, " ").trim();
  return t && t !== start ? t : null;
}
