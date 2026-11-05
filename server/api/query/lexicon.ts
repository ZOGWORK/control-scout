// The words search understands, as data (docs/search-pipeline.md, "Lexicon"). Each phrase people type maps to one
// symbol: a slot value (an aggregation, a metric, a match type, a side), a scope word (Worlds, states) or filler. The
// parser (./parse.ts) reads a query against this table in any word order; a new way of saying something is one more
// phrase here, never a branch in code. No team, event, place or number is named here: those come from the data.

export type Agg = "max" | "min" | "mean" | "median" | "sum" | "count" | "first" | "last" | "closest" | "next";
export type Metric =
  | "score" | "margin" | "record" | "win" | "loss" | "tie" | "winrate" | "opr" | "rating" | "rank" | "award" | "penalty"
  | "auto" | "teleop" | "endgame" | "streak" | "partner" | "opponent" | "rp" | "range" | "consistency" | "reliability" | "playoffs"
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
  | { k: "nopen" };

/** Each entry: the phrases (`|`-separated, words separated by spaces) and the symbol they mean (or several: "margin of
 *  victory" is a margin of wins only). Longer phrases win over shorter ones at the same place, so "win rate" is one
 *  metric, never "win" and "rate". */
const TABLE: [string, Sym | Sym[]][] = [
  ["margin of victory|victory margin|winning margin|margin of win", [{ k: "metric", v: "margin" }, { k: "outcome", v: "W" }]],
  ["margin of defeat|losing margin|margin of loss|defeat margin", [{ k: "metric", v: "margin" }, { k: "outcome", v: "L" }]],
  // Aggregations.
  ["highest|high|best|top|max|maximum|biggest|largest|greatest|most|record high|peak|strongest|winningest|career high|personal best", { k: "agg", v: "max" }],
  ["lowest|low|worst|min|minimum|smallest|fewest|least|weakest", { k: "agg", v: "min" }],
  ["average|avg|mean|typical|on average", { k: "agg", v: "mean" }],
  ["median", { k: "agg", v: "median" }],
  ["total|sum|combined total|all together|altogether", { k: "agg", v: "sum" }],
  ["how many|number of|count|count of|how often|times", { k: "agg", v: "count" }],
  ["first|earliest|debut|very first|opening|initial", { k: "agg", v: "first" }],
  ["last|latest|most recent|recent|newest|previous|final|current|so far", { k: "agg", v: "last" }],
  ["closest|tightest|narrowest|nail biter|nailbiter", { k: "agg", v: "closest" }],
  ["next|upcoming|coming up", { k: "agg", v: "next" }],
  // Metrics.
  ["score|scores|scored|scoring|points|point|pts|total points", { k: "metric", v: "score" }],
  ["margin|margin of victory|point differential|differential|point diff|spread|gap|score gap|point gap|points gap|difference in score", { k: "metric", v: "margin" }],
  // The biggest margin, said as one word.
  ["lopsided|most lopsided|one sided|blowout|blowouts|biggest blowout|mismatch|mismatches|rout|routs|beatdown", [{ k: "agg", v: "max" }, { k: "metric", v: "margin" }]],
  ["upset|upsets|underdog|underdogs|giant killing|giant killer|shock win|shock result|surprise win|surprise result", { k: "metric", v: "upset" }],
  ["comeback|comebacks|come back|came back|comeback win|comeback wins|rallied|rally", { k: "metric", v: "comeback" }],
  ["record|w-l-t|w l t|wlt|win loss|win-loss|win loss record|win loss tie|wins and losses|win/loss", { k: "metric", v: "record" }],
  ["win|wins|won|victory|victories|beat|beaten|defeated", { k: "metric", v: "win" }],
  ["loss|losses|lost|defeat|defeats", { k: "metric", v: "loss" }],
  ["tie|ties|tied|draw|draws", { k: "metric", v: "tie" }],
  ["win rate|win percentage|win pct|win %|win%|winning percentage|winning rate", { k: "metric", v: "winrate" }],
  ["opr|offensive power rating|offense rating|offensive rating", { k: "metric", v: "opr" }],
  ["rating|prediction rating|strength|power rating|elo", { k: "metric", v: "rating" }],
  ["rank|ranking|ranked|placement|place|placed|finish|finished|standing|standings|seed|seeded|position", { k: "metric", v: "rank" }],
  ["award|awards|trophy|trophies|honors|honours|banners", { k: "metric", v: "award" }],
  ["penalty|penalties|foul|fouls|penalty points|foul points", { k: "metric", v: "penalty" }],
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
  ["reliability|reliable|dependability|dependable", { k: "metric", v: "reliability" }],
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
  ["worlds|world|world championship|world championships|world champs|first championship|first champs|championship of the world|cmp|houston championship|houston", { k: "worlds" }],
  ["states|state|state championship|state championships|state champs|state finals|regionals|regional championship|regional", { k: "states" }],
  // Forecasts.
  ["prediction|predictions|predicted|predict|forecast|forecasts|projected|projection|expected|expect|chance|chances|odds|probability|likely|likelihood|favourite|favorite|favored|favoured|who wins|who will win|who would win", { k: "predict" }],
  // Two teams.
  ["vs|v|versus|against|facing|face|faced|play|played|playing|vs.", { k: "vs" }],
  ["and|&|plus|with|alongside", { k: "and" }],
  ["together|in common|shared|share|both|both played|jointly|same match|same matches", { k: "together" }],
  ["same alliance|same side|as partners|on the same alliance|teamed up|teamed", { k: "same-side" }],
  ["compare|comparison|compared|side by side|or", { k: "compare" }],
  // Wins and losses as an outcome ("closest win", "biggest loss").
  ["winning", { k: "outcome", v: "W" }],
  ["losing", { k: "outcome", v: "L" }],
  // Penalty points left out.
  ["without penalties|no penalties|excluding penalties|minus penalties|penalty free|np|non penalty", { k: "nopen" }],
  // Prepositions that say which slot follows.
  ["in|inside|within|during", { k: "prep", v: "in" }],
  ["at", { k: "prep", v: "at" }],
  ["from|based in|located in|out of", { k: "prep", v: "from" }],
  ["by|sorted by|ranked by|ordered by", { k: "prep", v: "by" }],
  ["for|of", { k: "prep", v: "for" }],
  ["list|show all|all of|every|each|history|log", { k: "list" }],
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
