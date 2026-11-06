// The words search understands, as data (docs/search-pipeline.md, "Lexicon"). Each phrase people type maps to one
// symbol: a slot value (an aggregation, a metric, a match type, a side), a scope word (Worlds, states) or filler. The
// parser (./parse.ts) reads a query against this table in any word order; a new way of saying something is one more
// phrase here, never a branch in code. No team, event, place or number is named here: those come from the data.

export type Agg = "max" | "min" | "mean" | "median" | "sum" | "count" | "first" | "last" | "closest" | "next";
export type Metric =
  | "score" | "margin" | "record" | "win" | "loss" | "tie" | "winrate" | "opr" | "rating" | "rank" | "award" | "penalty"
  | "auto" | "teleop" | "endgame" | "streak" | "partner" | "opponent" | "rp" | "range" | "consistency" | "reliability" | "playoffs"
  // Whether or how often a team went somewhere: a question no pipeline rule takes.
  | "appearance"
  // Derived from a match's numbers by a rule the card prints (./matchFind.ts).
  | "upset" | "comeback";
export type Thing = "match" | "event" | "season" | "team";

export type Sym =
  | { k: "filler" }
  | { k: "agg"; v: Agg }
  | { k: "metric"; v: Metric }
  | { k: "thing"; v: Thing }
  | { k: "level"; v: "qual" | "playoff" }
  /** The finals only, of the playoffs. */
  | { k: "finals" }
  | { k: "alliance"; v: "red" | "blue" }
  | { k: "worlds" }
  | { k: "states" }
  | { k: "predict" }
  /** How a number moved over a season: "trend", "going up or down", "event by event". */
  | { k: "trend" }
  /** Going through: from a division to the finals, from an event to the next level ("advancement odds"). */
  | { k: "advance" }
  /** A forecast held up against what happened: "vs actual", "before and after", "did it get it right". */
  | { k: "review" }
  | { k: "vs" }
  | { k: "and" }
  | { k: "together" }
  | { k: "same-side" }
  | { k: "compare" }
  | { k: "outcome"; v: "W" | "L" }
  | { k: "prep"; v: "in" | "at" | "from" | "by" | "with" | "for" }
  | { k: "award"; v: string }
  | { k: "list" }
  | { k: "per"; v: "match" | "event" | "rate" }
  | { k: "nopen" }
  /** No losses: "undefeated", "a perfect record". */
  | { k: "undefeated" }
  /** A scope's or a team's standout matches: "worlds highlights". */
  | { k: "highlights" }
  /** Its match videos: "jackson division recap", "<team> videos" (read as its highlights). */
  | { k: "videos" }
  /** A name asked about as words ("teams named …", "called …"): the words after it are the name (./parse.ts). */
  | { k: "named" };

/** Each entry: the phrases (`|`-separated, words separated by spaces) and the symbol they mean (or several: "margin of
 *  victory" is a margin of wins only). Longer phrases win over shorter ones at the same place, so "win rate" is one
 *  metric, never "win" and "rate". */
const TABLE: [string, Sym | Sym[]][] = [
  ["margin of victory|victory margin|winning margin|margin of win", [{ k: "metric", v: "margin" }, { k: "outcome", v: "W" }]],
  ["margin of defeat|losing margin|margin of loss|defeat margin", [{ k: "metric", v: "margin" }, { k: "outcome", v: "L" }]],
  // Aggregations.
  ["highest|high|best|top|max|maximum|biggest|largest|greatest|most|record high|peak|strongest|winningest|career high|personal best|longest|most times|the most times", { k: "agg", v: "max" }],
  ["lowest|low|worst|min|minimum|smallest|fewest|least|weakest", { k: "agg", v: "min" }],
  ["average|avg|mean|typical|on average", { k: "agg", v: "mean" }],
  ["median", { k: "agg", v: "median" }],
  ["total|sum|combined total|all together|altogether", { k: "agg", v: "sum" }],
  ["how many|number of|count|count of|how often|times", { k: "agg", v: "count" }],
  ["first|earliest|debut|very first|opening|initial", { k: "agg", v: "first" }],
  ["last|latest|most recent|recent|newest|previous|final|current|so far", { k: "agg", v: "last" }],
  ["closest|tightest|narrowest|nail biter|nailbiter", { k: "agg", v: "closest" }],
  ["next|upcoming|coming up", { k: "agg", v: "next" }],
  // "The last time", "the first time", "next time": when, said with "time" ("when was the last time they played").
  ["last time|the last time|most recent time|latest time|last time ever", { k: "agg", v: "last" }],
  ["first time|the first time|very first time|first time ever|first ever", { k: "agg", v: "first" }],
  ["next time|the next time", { k: "agg", v: "next" }],
  // Metrics.
  // "Total points" is two words read apart: a sum ("total") of scores ("points").
  ["score|scores|scored|scoring|points|point|pts", { k: "metric", v: "score" }],
  ["margin|margin of victory|point differential|differential|point diff|spread|gap|score gap|point gap|points gap|difference in score", { k: "metric", v: "margin" }],
  // The biggest margin, said as one word.
  ["lopsided|most lopsided|one sided|blowout|blowouts|biggest blowout|mismatch|mismatches|rout|routs|beatdown", [{ k: "agg", v: "max" }, { k: "metric", v: "margin" }]],
  ["upset|upsets|underdog|underdogs|giant killing|giant killer|shock win|shock result|surprise win|surprise result", { k: "metric", v: "upset" }],
  ["comeback|comebacks|come back|came back|comeback win|comeback wins|rallied|rally", { k: "metric", v: "comeback" }],
  // A place's leaderboard ("Romania leaderboard"): its top teams.
  ["leaderboard|leaderboards|leader board", [{ k: "agg", v: "max" }, { k: "thing", v: "team" }]],
  ["with their records|with their record|with records|and their records|record|records|w-l-t|w l t|wlt|win loss|win-loss|win loss record|win loss tie|wins and losses|win/loss", { k: "metric", v: "record" }],
  ["win|wins|won|victory|victories|beat|beaten|defeated", { k: "metric", v: "win" }],
  ["loss|losses|lost|lose|loses|defeat|defeats", { k: "metric", v: "loss" }],
  // Winning a match, as a question ("did they ever win a match"): its wins.
  ["win a match|won a match|win a game|won a game|win any match|won any match|win any matches|won any matches", [{ k: "metric", v: "win" }, { k: "thing", v: "match" }]],
  // Losing to someone: the opponents that beat the team.
  ["lose to|lost to|loses to|losing to|lost against|beaten by|defeated by|beat by", [{ k: "metric", v: "opponent" }, { k: "outcome", v: "L" }]],
  // The same asked about the other side: "who beat <team>" is the teams that beat it.
  ["who beat|who has beaten|who have beaten|who beats|who defeated|who has defeated|who knocked out|who eliminated", [{ k: "metric", v: "opponent" }, { k: "outcome", v: "L" }]],
  ["tie|ties|tied|draw|draws", { k: "metric", v: "tie" }],
  ["win rate|win percentage|win pct|win %|win%|winning percentage|winning rate", { k: "metric", v: "winrate" }],
  ["opr|offensive power rating|offense rating|offensive rating", { k: "metric", v: "opr" }],
  // "Highest rated", "top-rated": the prediction rating.
  ["rating|rated|prediction rating|strength|power rating|elo", { k: "metric", v: "rating" }],
  ["rank|ranking|ranked|placement|place|placed|finish|finished|standing|standings|seed|seeded|position", { k: "metric", v: "rank" }],
  ["award|awards|trophy|trophies|honors|honours|banners", { k: "metric", v: "award" }],
  // Penalty points are given away ("which team gives away the most").
  ["penalty|penalties|foul|fouls|fouled|penalty points|foul points|give away|gives away|gave away|given away|giving away", { k: "metric", v: "penalty" }],
  ["auto|autonomous|auton|auto period", { k: "metric", v: "auto" }],
  ["teleop|tele op|tele-op|driver controlled|driver-controlled|driver period|dc", { k: "metric", v: "teleop" }],
  ["endgame|end game|end-game", { k: "metric", v: "endgame" }],
  // A win streak is wins only (and a losing one losses only): the current run of the other kind is never the answer.
  ["win streak|winning streak|streak of wins", [{ k: "metric", v: "streak" }, { k: "outcome", v: "W" }]],
  ["losing streak|loss streak|streak of losses", [{ k: "metric", v: "streak" }, { k: "outcome", v: "L" }]],
  ["streak|run", { k: "metric", v: "streak" }],
  ["partner|partners|alliance partner|alliance partners|teammate|teammates|allies", { k: "metric", v: "partner" }],
  ["opponent|opponents|rival|rivals|nemesis|enemy|enemies", { k: "metric", v: "opponent" }],
  ["ranking points|rp|rps", { k: "metric", v: "rp" }],
  ["range|score range|spread of scores", { k: "metric", v: "range" }],
  ["consistency|consistent|score consistency", { k: "metric", v: "consistency" }],
  ["reliability|reliable|dependability|dependable|reliability score|reliability index", { k: "metric", v: "reliability" }],
  // Whether or how often a team went somewhere ("has 12345 been to worlds"): its appearances, a question no rule takes,
  // so it's left to the readers that count trips, never the results there.
  ["been to|been at|gone to|went to|go to|made it to|make it to|qualified for|qualify for|qualified to|attended|competed at|appearance|appearances", { k: "metric", v: "appearance" }],
  // What is counted or listed.
  ["match|matches|game|games|round|rounds|qualification match", { k: "thing", v: "match" }],
  ["event|events|competition|competitions|comp|comps|tournament|tournaments|meet|meets", { k: "thing", v: "event" }],
  ["season|seasons|year|years", { k: "thing", v: "season" }],
  ["team|teams|robot|robots", { k: "thing", v: "team" }],
  // Scope words.
  ["finals|grand final|grand finals|finals match|finals matches|final match|final matches|championship match|championship final", [{ k: "level", v: "playoff" }, { k: "finals" }]],
  ["playoff|playoffs|elim|elims|elimination|eliminations|bracket|semifinals|semis", { k: "level", v: "playoff" }],
  ["qual|quals|qualification|qualifications|qualifying|qualis", { k: "level", v: "qual" }],
  ["red|red alliance|red side|on red|as red", { k: "alliance", v: "red" }],
  ["blue|blue alliance|blue side|on blue|as blue", { k: "alliance", v: "blue" }],
  // Everywhere, said: no place filter (never the FIRST Championship).
  ["in the world|worldwide|world wide|globally|across the world|around the world|all over the world|internationally|anywhere|in ftc", { k: "filler" }],
  // Asides and slang around a question: never part of it, nor a team's name ("just curious" is no team called Curious).
  ["only|just|just curious|curious|out of curiosity|wondering|i wonder|i was wondering|honestly|be honest|lol|lmao|bruh|da|ur|ya|yall|kinda|sorta|gonna|wanna|nah|or nah|right now|these days|lately|by now|if any|if there is one|if there are any|often|frequently", { k: "filler" }],
  ["worlds|world|world championship|world championships|world champs|first championship|first champs|championship of the world|cmp|houston championship|houston", { k: "worlds" }],
  ["states|state|state championship|state championships|state champs|state finals|regionals|regional championship|regional", { k: "states" }],
  // Forecasts.
  ["prediction|predictions|predicted|predict|forecast|forecasts|projected|projection|expected|expect|chance|chances|odds|probability|likely|likelihood|favourite|favorite|favored|favoured|who wins|who will win|who would win|matchup|matchups|match up|custom matchup|custom match|hypothetical matchup|hypothetical match", { k: "predict" }],
  ["trend|trends|trending|over time|progression|going up or down|going up|going down|up or down|improving|getting better|getting worse|rising|falling|event by event|over the season|across the season|through the season|week by week|after each event", { k: "trend" }],
  ["vs actual|versus actual|vs the actual|compared to actual|vs what happened|vs reality|vs result|vs results|vs the result|actual|actually happened|what happened|before and after|before vs after|before or after|right or wrong|get it right|got it right|was it right|were they right|was it accurate|how accurate|accurate|accuracy|way off|or was it way off|or way off|or was it off|or not|how far off|hit or miss", { k: "review" }],
  ["advance|advances|advancing|advancement|advancements|advance to the finals|make the finals|making the finals|go through|goes through|get through|gets through", { k: "advance" }],
  // Two teams.
  ["vs|v|versus|against|facing|face|faced|play|played|playing|plays|vs.", { k: "vs" }],
  ["and|&|plus|with|alongside", { k: "and" }],
  ["together|in common|shared|share|both|both played|jointly|same match|same matches", { k: "together" }],
  ["same alliance|same side|as partners|on the same alliance|teamed up|teamed", { k: "same-side" }],
  // "Who is better, 12345 or 67890": the two side by side.
  ["compare|comparison|compared|side by side|or|better|stronger|who is better|which is better|whos better|who's better", { k: "compare" }],
  // Wins and losses as an outcome ("closest win", "biggest loss").
  ["winning", { k: "outcome", v: "W" }],
  ["losing", { k: "outcome", v: "L" }],
  // No losses.
  ["undefeated|unbeaten|perfect record|a perfect record|perfect season|no losses|zero losses|without a loss|never lost|not lost|havent lost|hasnt lost", { k: "undefeated" }],
  // Standout matches, each with why it's one.
  ["highlights|highlight|highlight reel|highlight reels|top moments|best moments|best matches|best games|standout matches|standout moments|best plays|top plays", { k: "highlights" }],
  ["recap|recaps|replay|replays|video|videos|clip|clips|watch|watch back|rewatch|stream|streams|livestream|live stream|vod|vods|footage|match videos|match video|youtube", { k: "videos" }],
  // A name said as words, never a team read from them: "teams named …", "how many teams are called …".
  ["named|called|with the name|have the name|has the name|having the name|by the name|by the name of|go by|goes by|going by|known as", { k: "named" }],
  // Penalty points left out.
  ["without penalties|no penalties|excluding penalties|minus penalties|penalty free|np|non penalty", { k: "nopen" }],
  // Prepositions that say which slot follows.
  ["in|inside|within|during", { k: "prep", v: "in" }],
  ["at", { k: "prep", v: "at" }],
  ["from|based in|located in|out of", { k: "prep", v: "from" }],
  ["by|sorted by|ranked by|ordered by", { k: "prep", v: "by" }],
  ["for|of", { k: "prep", v: "for" }],
  ["list|show all|all of|every|each|history|log|most often|the most often|by type|by kind|each type|of each type", { k: "list" }],
  // "Per match", "per event", "rate": how a count is divided.
  ["per match|per game|a match|a game|each match|every match|per round", { k: "per", v: "match" }],
  ["per event|each event|every event|per competition|per tournament|by event", { k: "per", v: "event" }],
  ["rate", { k: "per", v: "rate" }],
  // Filler: the question's frame and conversation, never part of a name.
  ["the|a|an|is|are|was|were|be|been|has|have|had|do|does|did|what|whats|which|who|whom|how|when|where|why|please|pls|plz|thanks|thank you|hey|hi|hello|yo|ok|okay|so|just|really|actually|basically|like|um|uh|rn|right now|at the moment|currently|now|today's|show|show me|tell|tell me|give|give me|get|find|lookup|look up|search|i want|i want to know|i wanna know|i need|can you|could you|would you|let me know|let me see|i'd like|id like|want|need|know|see|me|my|us|our|their|its|his|her|they|them|it|team's|teams'|ftc|first tech challenge|tech challenge|stat|stats|statistics|info|information|data|number|numbers|result|results|did they|ever had|on record|official|overall|all|any|some|there|here|that|this|these|those|than|then|to|on|into|about|up|out|off|over|under|ago|yet|still|also|too|much|many|good|well|very|quite|pretty|kind of|sort of|exactly|anyone|anybody|someone|somebody|got|get|gets|getting", { k: "filler" }],
];

/** The awards by the words people use (awards.type values). */
export const AWARD_WORDS: [string, string][] = [
  ["inspire|inspire award", "Inspire"], ["think|think award", "Think"], ["connect|connect award", "Connect"],
  ["innovate|innovate award", "Innovate"], ["design|design award", "Design"], ["motivate|motivate award", "Motivate"],
  ["control|control award", "Control"], ["reach|reach award", "Reach"], ["sustain|sustain award", "Sustain"],
  ["compass|compass award", "Compass"], ["judges choice|judges' choice|judge's choice|judges award", "JudgesChoice"],
  ["deans list|dean's list|deans", "DeansList"], ["winning alliance|winners|winner|champion|champions|event winner", "Winner"],
  ["finalist|finalists|finalist alliance|runner up|runners up|runner-up", "Finalist"], ["volunteer|volunteer award", "Volunteer"],
];

export interface Entry { words: string[]; syms: Sym[] }
const split = (p: string) => p.toLowerCase().split(/\s+/).filter(Boolean);
/** Every phrase as its words, the longest first (the parser's greedy match). */
export const LEXICON: Entry[] = [
  ...AWARD_WORDS.flatMap(([ps, type]) => ps.split("|").filter((p) => /\s/.test(p) || p === "inspire" || p === "finalist" || p === "finalists").map((p) => ({ words: split(p), syms: [{ k: "award", v: type } as Sym] }))),
  ...TABLE.flatMap(([ps, sym]) => ps.split("|").map((p) => ({ words: split(p), syms: Array.isArray(sym) ? sym : [sym] }))),
].sort((a, b) => b.words.length - a.words.length);

/** The one-word award names that are everyday words too ("design", "control", "reach"): an award only beside an award
 *  word ("design award") or as what an awards question names ("12345 design awards"). */
export const AWARD_ONE_WORD: Map<string, string> = new Map(
  AWARD_WORDS.flatMap(([ps, type]) => ps.split("|").filter((p) => !/\s/.test(p)).map((p) => [p, type] as [string, string])));

/** Words that make a run of words an event's name ("East Bergen Conference", "Northern Division"). */
export const EVENT_NAME_WORDS = new Set([
  "championship", "championships", "champs", "qualifier", "qualifiers", "qualifying", "league", "meet", "tournament", "conference",
  "invitational", "scrimmage", "premier", "division", "regional", "showcase", "classic", "open", "cup", "challenge", "super",
  "kickoff", "interleague", "event", "competition", "festival", "series", "district", "tourney",
]);

/** Informal and short forms of time and other words, said in full before anything reads the query ("events happening
 *  rn" is "events happening right now"). Longer phrases first; each replaces whole words only, never inside a team's
 *  name (informalQuery). A new short form is one more row here. */
export const INFORMAL: [string, string][] = [
  ["rn rn", "right now"], ["rn", "right now"], ["atm", "right now"], ["rightnow", "right now"],
  ["tdy", "today"], ["2day", "today"],
  ["tmrw", "tomorrow"], ["tmr", "tomorrow"], ["tmrow", "tomorrow"], ["2moro", "tomorrow"],
  ["yday", "yesterday"], ["yest", "yesterday"],
  ["wknd", "weekend"],
  ["nxt wk", "next week"], ["nxt week", "next week"], ["next wk", "next week"], ["lst wk", "last week"], ["last wk", "last week"], ["nxt", "next"],
  ["szn", "season"],
  ["ur", "your"], ["u", "you"],
];

/** A word without the punctuation around it (`"rn"`, "rn?"): what a form is matched on, the rest kept as typed. */
const core = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
/** Whether word `i` of `ws` is inside a quoted phrase (or holds a quote mark itself). */
const quoted = (ws: string[], i: number) => (ws.slice(0, i).join(" ").split('"').length - 1) % 2 === 1 || ws[i].includes('"');
const edges = (w: string) => { const c = core(w); const at = c ? w.indexOf(c) : w.length; return [w.slice(0, at), w.slice(at + c.length)]; };

/** `q` with each INFORMAL form said in full: whole words, any case, and never a word of a name `named` knows (a team
 *  named "RN Robotics" keeps it). `named` is asked of each run of words holding a form, up to `longest` (the longest
 *  name it knows, so no word inside a real name is ever changed); `wider`, whether the
 *  run holds more than the form (an event's name with the word in it). Operators and punctuation around a form stay as
 *  typed (`"Raider Robotics" rn?`), and nothing inside quotes is changed. */
export function informalQuery(q: string, named: (words: string, wider: boolean) => boolean, longest = 4): string {
  // Words apart however they're spaced (tabs, line breaks), as the query cleaner reads them.
  let ws = q.trim().split(/\s+/).filter(Boolean);
  for (const [from, to] of INFORMAL) {
    const f = from.split(" ");
    for (let i = 0; i + f.length <= ws.length; i++) {
      if (ws.slice(i, i + f.length).map((w) => core(w).toLowerCase()).join(" ") !== from) continue;
      // A quoted phrase is searched for exactly as typed ('"RN" Robotics'): nothing in it is said another way.
      if (Array.from({ length: f.length }, (_, k) => i + k).some((j) => quoted(ws, j))) continue;
      let inName = false;
      for (let a = Math.max(0, i - longest + 1); a <= i; a++) for (let b = i + f.length; b <= Math.min(ws.length, a + longest); b++) inName ||= named(ws.slice(a, b).map(core).join(" "), b - a > f.length);
      if (inName) continue;
      const said = to.split(" ");
      said[0] = edges(ws[i])[0] + said[0];
      said[said.length - 1] += edges(ws[i + f.length - 1])[1];
      ws = [...ws.slice(0, i), ...said, ...ws.slice(i + f.length)];
      i += to.split(" ").length - 1;
    }
  }
  return ws.join(" ");
}
