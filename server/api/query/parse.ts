// The query, parsed into slots (docs/search-pipeline.md): the teams, the event, the place, the time, the match type,
// the side, the award, the aggregation and its limit, and the intent. Read in any word order, filler ignored, every
// word accounted for. Names come from the data (./names.ts), words from the lexicon (./lexicon.ts), times from
// ./time.ts, the intent from ./intents.ts. Nothing here names a team, an event or a place.
import { AWARD_ONE_WORD, EVENT_NAME_WORDS, LEXICON, type Agg, type Sym } from "./lexicon.js";
import { pickIntent, type IntentRule, type PipelineIntent } from "./intents.js";
import { readTime, type TimeRead, type TimeSlot } from "./time.js";
import type { ScoreCond } from "./matchFind.js";
import { fold, type Names, type Place, type TeamName } from "./names.js";
import { EVENT_TYPES } from "../../../src/shared/searchEventQuery.js";
import { onlyTopicWords } from "../../../src/shared/searchQuery.js";
import { asksWhich, onlyOrdinary } from "./ordinary.js";
import { pickShared as pickAmong } from "./shared.js";

/** A name as typed or stored, compared whole: lower case, any run of punctuation and spaces one space. */
const wholeName = (n: string | null) => (n ?? "").toLowerCase().replace(/[^\p{L}\d]+/gu, " ").trim();
import { allowedEdits, joinThousands } from "../../../src/shared/fuzzy.js";
import { edits } from "../../../src/shared/regions.js";

export interface TeamSlot {
  number: number; name: string | null; typed: string; via: "number" | "name" | "near";
  /** Every team with the name typed, when several share it, and the rule that picked this one. */
  candidates?: number[];
  rule?: string;
  /** Where in the query it was typed (teams are listed in typed order). */
  at: number;
}
/** An event named by its words: the executor finds it, by the season rule (latest, or the year said). */
export interface EventSlot { words: string; typed: string;
  /** Read from one word of a named team's own events: their latest with it in its name (ParseContext.teamEvent). */
  latest?: true }
export interface EventFound { season: number; code: string; name: string }

export interface Parsed {
  /** The query as typed. */
  q: string;
  teams: TeamSlot[];
  event: EventSlot | null;
  place: (Place & { typed: string }) | null;
  time: TimeSlot | null;
  level: "qual" | "playoff" | null;
  /** The finals only ("closest finals match"), a playoff level too. */
  finals: boolean;
  /** A kind of event named by its type words alone ("at a league meet", "at qualifiers"), no event's name: the
   *  words, read by the match finder (./matchFind.ts eventKindOf), the one reader that filters by it. */
  eventKind: string | null;
  alliance: "red" | "blue" | null;
  worlds: boolean;
  states: boolean;
  award: string | null;
  agg: Agg | null;
  /** "top 5", "last 10 matches": how many. */
  n: number | null;
  /** "match 12", "q12": a match's number. */
  matchNumber: number | null;
  /** Penalty points left out of scores ("without penalties"): read, and an intent that can't apply it leaves the parse
   *  incomplete. */
  noPenalties: boolean;
  /** A floor in points ("more than 50 points", "at least 30 pts", that number counting): only a rule that takes "over"
   *  applies it. */
  over?: { n: number; atLeast: boolean };
  /** Where the first "vs" stands (a word's index, as a team's `at`): two alliances are the teams either side of it. */
  vsAt?: number;
  /** Where the swap word is ("swap 12345 for 23456"), as a team's `at`. */
  swapAt?: number;
  /** Every intent symbol read ("agg:max", "metric:score"). */
  symbols: string[];
  /** The stats said not to go by ("not OPR"), as typed: the card says it left them out. */
  notStats?: string[];
  /** The same stats as symbols ("metric:opr"): a default never ranks by one of them. */
  notMetrics?: string[];
  intent: PipelineIntent | null;
  rule: IntentRule | null;
  /** Words nothing explained: a parse with any is incomplete, and left to search's other readers. */
  leftover: string[];
  /** Symbols no intent explained. */
  unexplained: string[];
  /** No losses asked ("undefeated teams"). */
  undefeated?: boolean;
  /** Rookie teams asked ("rookie teams", "first-year teams"): teams in their first season. */
  rookie?: boolean;
  /** Reaching Worlds or states said beside a forecast ("chance of making worlds"): the chance to advance there. */
  reach?: true;
  /** A name asked about as words ("teams named <name>"): the words, never read as a team. */
  named?: { words: string; typed: string };
  /** A score an alliance had to reach ("where the losing alliance scored over 200"): the match finder's filter. */
  scoreCond?: ScoreCond;
  /** Every word explained and an intent found. */
  complete: boolean;
}

export interface ParseContext {
  names: Names;
  /** Today, YYYY-MM-DD (UTC). */
  today: string;
  /** Whether these words name a stored event (any season), and the team numbers' event when one is given. */
  isEvent: (words: string) => Promise<boolean>;
  /** The name (folded) of the latest event of `teams` (in the season or held in the calendar year given) with `word`
   *  in its name as a whole word, or null: one word names an event only among the named teams' own. */
  teamEvent?: (word: string, teams: number[], when: { season: number | null; year: number | null; from?: string; to?: string }) => Promise<string | null>;
  /** The team a near miss of a name means ("hypnotc robotics"), or null. */
  nearTeam?: (words: string) => Promise<TeamName | null>;
  /** The visitor's own teams ("team:12345"), first when several share a name. */
  prefer?: ReadonlySet<string>;
}

/** `at`: the word as typed it came from (its place among the words typed, before any time was read out). */
type Tok = { w: string; typed: string; at: number; used: boolean; alliance?: boolean; side?: "red" | "blue" };
/** The one-word filler phrases ("the", "a"): read before a name that starts with one. */
const FILLER_WORDS = new Set(LEXICON.filter((e) => e.words.length === 1 && e.syms.every((x) => x.k === "filler")).map((e) => e.words[0]));
/** Every filler phrase, one word or more ("the", "thank you"). */
const FILLER_PHRASES = LEXICON.filter((e) => e.syms.every((x) => x.k === "filler")).map((e) => e.words);
/** The stats a list can be ranked by, which "not" before one drops ("by rating, not OPR"). */
const NOT_STATS = new Set<string>(["opr", "rating", "winrate", "auto", "teleop", "endgame", "reliability", "penalty"]);
/** True when `words` are filler phrases end to end ("are there", "thank you"); none at all is too. */
function allFiller(words: string[]): boolean {
  const ok = [true, ...words.map(() => false)];
  for (let i = 0; i < words.length; i++) if (ok[i]) for (const f of FILLER_PHRASES) if (f.every((w, j) => words[i + j] === w)) ok[i + f.length] = true;
  return ok[words.length];
}
const NAME_MARK = "namedname";
/** The phrases that say a name follows ("named", "called", "with the name"). */
const NAMED_PHRASES = LEXICON.filter((e) => e.syms.some((x) => x.k === "named")).map((e) => e.words);
/** The words that end a name asked about as words: a place or a time follows. */
const NAME_ENDS = /^(?:from|in|at|near|based|located|during|out)$/;
/** The words that swap one team for another (the lexicon's "swap"), as a pattern. */
const SWAP_WORDS = "swap|swaps|swapped|swapping|switch|switches|switched|switching|replace|replaces|replaced|replacing|substitute|substituted|substituting|sub|subs|subbed|subbing|trade|traded|trading";
/** Words that say reaching a place ("making worlds", "qualifying for worlds"), and the words that name Worlds. */
const REACH = new Set(["make", "makes", "making", "reach", "reaches", "reaching", "qualify", "qualifies", "qualifying", "get", "gets", "getting"]);
/** "Advance" said toward a place ("advance to states"): reaching it, as a reach verb is. */
const ADVANCE_TO = new Set(["advance", "advances", "advancing"]);
const WORLDS_WORDS = new Set([
  // Every one-word name the lexicon reads as Worlds or states ("regionals" is states), so a new name is never missed here.
  ...LEXICON.filter((e) => e.words.length === 1 && e.syms.some((x) => x.k === "worlds" || x.k === "states")).map((e) => e.words[0]),
  // The last word of their longer names ("the state championship", "world champs").
  "championship", "championships", "champs",
]);
/** What may stand between a reach verb and the place: the lexicon's one-word filler ("it", "to", "the"), the
 *  prepositions of going there ("for", "into", "in", "at", "through"), and "first" of "the FIRST Championship". */
const REACH_BETWEEN = new Set([
  ...LEXICON.filter((e) => e.words.length === 1 && e.syms.every((x) => x.k === "filler")).map((e) => e.words[0]),
  "for", "into", "in", "at", "through", "first",
]);
/** The kind words an event's name can end with. */
const KIND_WORDS = new Set(["meet", "meets", "tournament", "tournaments", "event", "events", "competition", "competitions"]);
/** The words before a number that make it a count ("top 5", "last 10") or a match's number ("match 3"). */
const COUNT_BEFORE = /^(?:top|last|first|best|latest|past|recent|bottom|worst|highest|lowest)$/;
const MATCH_BEFORE = /^(?:match|qual|q|game|qualification)$/;
/** The words before a number of teams that make it a size ("more than 40 teams", "over 40", "at least 40"). */
const SIZE_BEFORE = /^(?:than|over|least|most|under|above|below|exceeding)$/;
/** A floor in points ("more than 50 points", "at least 30 pts"): read before the team and time readers, so its number is
 *  never a team or a season. */
const FLOOR = /(?:^| )(more than|greater than|over|above|exceeding|beyond|at least) (\d{1,5}) (?:points?|pts)(?= |$)/;
/** Every word of a lexicon phrase: a team's name beside one ("bad wolf offensive power rating") still ends there. */
const LEX_WORDS = new Set(LEXICON.flatMap((e) => e.words));

const symKey = (s: Sym): string | null => {
  switch (s.k) {
    case "agg": case "metric": case "thing": case "level": case "alliance": case "outcome": case "prep": case "award": case "per": return `${s.k}:${s.v}`;
    case "filler": return null;
    default: return s.k;
  }
};

/** Lower case, accents off, possessives and punctuation dropped; "highest-scoring" is two words, "2024-25" one. */
export function normalise(q: string): string {
  return ` ${joinThousands(q).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()} `
    .replace(/[’‘`]/g, "'").replace(/\bwhat's\b/g, "what is").replace(/\bwho's\b/g, "who is").replace(/\bhow's\b/g, "how is")
    .replace(/([\p{L}\p{N}])'s\b/gu, "$1").replace(/s'(?=\s)/g, "s").replace(/#(?=\d)/g, " ")
    .replace(/(?<=[a-z])-(?=[a-z])/g, " ").replace(/[?!,;:()"[\]{}]/g, " ").replace(/\.(?=\s|$)/g, " ")
    // A dash on its own or ending a word is punctuation ("UK 488 - The King's School- Barrel Botz"), never a word; one
    // between two numbers joins them ("2024 - 25" is the season 2024-25).
    .replace(/(?<=\d)\s+-+\s+(?=\d)/g, "-").replace(/(?<=\s)-+(?=\s)/g, " ").replace(/(?<=[\p{L}\p{N}])-+(?=\s)/gu, "")
    .replace(/\s+/g, " ").trim();
}

/** The longest stored name after a phrase saying a name follows, ending where a place's preposition, the closing
 *  filler or a time (`timeOnly`) follows it, or null. */
function keptName(words: string[], names: Names, timeOnly: (w: string[]) => boolean): { from: number; to: number } | null {
  for (let i = 0; i < words.length; i++) {
    const f = NAMED_PHRASES.find((n) => n.every((w, j) => words[i + j] === w));
    if (!f) continue;
    const from = i + f.length;
    for (let to = words.length; to > from; to--) {
      const tail = words.slice(to);
      const ends = !tail.length || NAME_ENDS.test(tail[0]) || allFiller(tail) || timeOnly(tail);
      if (ends && names.teamsNamed(words.slice(from, to).join(" ")).length) return { from, to };
    }
  }
  return null;
}

/** Whether a bare four-digit year in `q` (normalised words) is a season, given which numbers are teams' (`team`). */
function yearReading(q: string, team: (n: number) => boolean): (y: number) => boolean {
  // The other team numbers typed: a limit ("last 5") or a match's number ("match 3") is never a team.
  const words0 = q.split(" ");
  const teamNums = words0.filter((w, i) => /^\d{1,5}$/.test(w) && !COUNT_BEFORE.test(words0[i - 1] ?? "") && !MATCH_BEFORE.test(words0[i - 1] ?? "") && team(Number(w))).map(Number);
  // A bare year is a season unless it's the only team number and a team has it ("2024 record", "2024 last 5 matches").
  // "Season 2024" names the season, but "this season 2024 record" is the team after "this season".
  // A team's number joined to another by "vs" or "and" is one of the teams compared, not a year.
  const said = (y: number) => new RegExp(`\\b(?:in|during|for|from|(?<!\\b(?:this|current)\\s)season)\\s+(?:the\\s+)?${y}\\b`).test(q);
  const paired = (y: number) => new RegExp(`\\b${y}\\s+(?:vs\\.?|v|versus|against|and|&)\\s|\\s(?:vs\\.?|v|versus|against|and|&)\\s+${y}\\b`).test(` ${q} `);
  // A team's number swapped out or in ("swap <team> for <team>", "replace <team> with <team>", a number like a year) is a team, never a year.
  const swapped = (y: number) => new RegExp(`\\b(?:${SWAP_WORDS})\\s+(?:(?:out|in)\\s+)?(?:\\d{1,5}\\s+(?:(?:out|in)\\s+)?(?:for|with|by)\\s+)?${y}\\b`).test(q);
  return (y: number) => !(swapped(y) && team(y)) && (said(y) || (!(team(y) && paired(y)) && (teamNums.some((n) => n !== y) || !team(y))));
}

/** The time `q` (normalised words) says, as the parser reads it: a bare year by `yearReading`, and a stored name asked
 *  about as words ("teams named Powerplay Pioneers", "March Madness") never read as a time. `rest`: `q` without the
 *  time's words. Shared with the answer's season picker (server/api/answers/season.ts withSeason). */
export function queryTime(q0: string, names: Names, today: string): TimeRead {
  // A score threshold ("at least 2025 pts", "both alliances scored over 2025") is never a year: set aside first, as
  // parseQuery does. parseQuery has read its own condition off already: one more here stays in `rest`, unread, so the
  // query never passes with a limit dropped.
  const c = scoreCondOf(q0);
  const q1 = c ? c.rest : q0;
  const fl = FLOOR.exec(q1);
  const q = fl ? `${q1.slice(0, fl.index)} ${q1.slice(fl.index + fl[0].length)}`.replace(/\s+/g, " ").trim() : q1;
  const words0 = q.split(" ");
  const yearOk = yearReading(q, (n) => !!names.team(n));
  const timeOnly = (w: string[]) => { const r = readTime(w.join(" "), today, yearOk); return !!r.time && allFiller(r.rest.split(" ").filter(Boolean)); };
  const at0 = keptName(words0, names, timeOnly);
  // The name stands in as one word no time reads, then comes back whole.
  const kept = at0 && words0.slice(at0.from, at0.to).join(" ");
  const read = readTime(at0 ? [...words0.slice(0, at0.from), NAME_MARK, ...words0.slice(at0.to)].join(" ") : q, today, yearOk);
  const out = kept ? { ...read, rest: read.rest.replace(NAME_MARK, kept) } : read;
  return c ? { ...out, rest: `${out.rest} ${c.said}`.trim() } : out;
}

/** "Where the losing alliance scored over 200", "both alliances scored over 250", "each alliance had at least 150
 *  points": whose score, the comparison and the number, and the query without them. */
const SIDE: Record<string, ScoreCond["side"]> = { losing: "losing", losers: "losing", winning: "winning", winners: "winning", both: "both", each: "both", either: "either", one: "either" };
const OP: [RegExp, ScoreCond["op"]][] = [[/^(?:over|more than|above)$/, ">"], [/^at least$/, ">="], [/^(?:under|less than|below|fewer than)$/, "<"], [/^at most$/, "<="]];
const COND_RE = /(?:^| )(?:(?:where|with|in which|when|that|and) )?(?:the )?(losing|losers|winning|winners|both|each|either|one) (?:of the )?(?:alliances?|sides?)(?: each)? (?:scored|scores|score|had|got|put up|reached|hit|with) (over|more than|above|at least|under|less than|below|fewer than|at most) (\d{1,4})(?: points?| pts)?(?= |$)/;
export function scoreCondOf(q: string): { cond: ScoreCond; rest: string; said: string } | null {
  const m = COND_RE.exec(q);
  if (!m) return null;
  const op = OP.find(([re]) => re.test(m[2]))![1];
  return { cond: { side: SIDE[m[1]], op, n: Number(m[3]) }, rest: `${q.slice(0, m.index)} ${q.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim(), said: m[0].trim() };
}

/** A match that "went to a tiebreak, or overtime" ended level: said as "tied". Only after a verb saying how it ended, so
 *  a team named Overtime is still that team anywhere else; never "going to", which asks about a match still to come. */
const LEVEL = "(?:a |an )?(?:tiebreak|tiebreaker|tie break|tie breaker|overtime|sudden death|tie)s?";
const LEVEL_SRC = `\\b(?:went|go|goes|gone|ended|end|ends|came down|come down|decided) (?:to|in|by) ${LEVEL}(?: or ${LEVEL})?(?= |$)`;
const LEVEL_END = new RegExp(LEVEL_SRC, "g");
export const endedLevel = (q: string) => q.replace(LEVEL_END, "tied");
/** The same, on the words as typed (any case, "tie-break"), so the typed words stay in step with the read ones: a
 *  state's capitals ("IN") are found again after it. */
const LEVEL_END_TYPED = new RegExp(LEVEL_SRC.replace(/ /g, "[\\s-]+"), "gi");

/** Parses `raw`. */
export async function parseQuery(raw: string, ctx: ParseContext): Promise<Parsed> {
  // How a match ended, said as "tied" first; then a score an alliance had to reach is read off: its number is never a
  // team, nor a floor in points.
  const nq = endedLevel(normalise(raw));
  const cond = scoreCondOf(nq);
  const q0 = cond ? cond.rest : nq;
  const fl = FLOOR.exec(q0);
  const q = fl ? `${q0.slice(0, fl.index)} ${q0.slice(fl.index + fl[0].length)}`.replace(/\s+/g, " ").trim() : q0;
  const typedWords = raw.replace(/[?!,;:()"]/g, " ").replace(LEVEL_END_TYPED, "tied").split(/\s+/).filter(Boolean);
  const read = queryTime(q, ctx.names, ctx.today);
  const { time, unread, rest } = read;
  // Each word with its own spelling as typed, matched in order ("in IN": the second is the state code).
  let at = 0;
  const toks: Tok[] = rest.split(" ").filter(Boolean).map((w) => {
    const k = typedWords.findIndex((t, i) => i >= at && fold(t) === w);
    if (k >= 0) at = k + 1;
    return { w, typed: k >= 0 ? typedWords[k] : w, at: k >= 0 ? k : at, used: false };
  });
  const symbols = new Set<string>(cond ? ["cond"] : []);
  let rate = false;
  const p: Parsed = {
    q: raw, teams: [], event: null, place: null, time, level: null, finals: false, eventKind: null, alliance: null, worlds: false, states: false, award: null, agg: null,
    n: null, matchNumber: null, noPenalties: false, symbols: [], intent: null, rule: null, leftover: [], unexplained: [], complete: false,
    ...(cond ? { scoreCond: cond.cond } : {}),
    ...(fl ? { over: { n: Number(fl[2]), atLeast: fl[1] === "at least" } } : {}),
  };
  // Where the place read starts, in the parser's words: a place typed right after a shared name picks the team.
  let placeFrom = -1;
  const lexAt = (i: number) => LEXICON.find((e) => e.words.every((w, j) => toks[i + j] && !toks[i + j].used && toks[i + j].w === w));
  const isLex = (w: string) => LEX_WORDS.has(w) || AWARD_ONE_WORD.has(w);

  // 0. A name asked about as words ("how many teams named <name> from <place>"): the words after the phrase, never a
  // team. The longest run of them that is a stored name, whatever words it holds ("in", "us"); else the words up to a
  // place's preposition, without the question's closing filler ("… are there").
  for (let i = 0; i < toks.length && !p.named; i++) {
    const e = lexAt(i);
    if (!e?.syms.some((s) => s.k === "named")) continue;
    const from = i + e.words.length;
    let to = toks.length;
    // A stored name ends the words only where a place's preposition or the closing filler follows it.
    const ends = (k: number) => k === toks.length || NAME_ENDS.test(toks[k].w) || allFiller(toks.slice(k).map((t) => t.w));
    while (to > from && !(ends(to) && ctx.names.teamsNamed(toks.slice(from, to).map((t) => t.w).join(" ")).length)) to--;
    if (to === from) {
      while (to < toks.length && !NAME_ENDS.test(toks[to].w)) to++;
      // Without the question's closing filler, a phrase of it too ("… thank you").
      const end = to;
      for (to = from + 1; to < end && !allFiller(toks.slice(to, end).map((t) => t.w)); to++);
      if (allFiller(toks.slice(from, end).map((t) => t.w))) to = from;
    }
    if (to === from) continue;
    const span = toks.slice(from, to);
    p.named = { words: span.map((t) => t.w).join(" "), typed: span.map((t) => t.typed).join(" ") };
    span.forEach((t) => (t.used = true));
  }

  // 0b. Rookie teams ("rookie teams", "first-year teams", "first year teams"): the group, read before any name ("rookie
  // year" is the team's own fact, never this). Only right before the teams word.
  for (let i = 0; i < toks.length; i++) {
    const two = toks[i].w === "first" && /^year$/.test(toks[i + 1]?.w ?? "");
    const w = two ? 2 : /^(?:rookies?|first-year)$/.test(toks[i].w) ? 1 : 0;
    if (!w || toks.slice(i, i + w).some((t) => t.used) || !/^teams?$/.test(toks[i + w]?.w ?? "")) continue;
    p.rookie = true;
    toks.slice(i, i + w).forEach((t) => (t.used = true));
  }

  // 1. Teams by their whole name, longest first: a name made only of search's own words ("The Best") isn't claimed,
  // so "best team" stays a question.
  for (let len = Math.min(ctx.names.longest, 12); len >= 1; len--) {
    for (let i = 0; i + len <= toks.length; i++) {
      const span = toks.slice(i, i + len);
      if (span.some((t) => t.used) || span.every((t) => isLex(t.w) || /^\d+$/.test(t.w))) continue;
      // After "in" or "from", a place's name is the place ("teams from Texas"), whatever team shares it.
      if (/^(?:in|from|at|near)$/.test(toks[i - 1]?.w ?? "") && ctx.names.place(span.map((t) => t.w).join(" "), span.map((t) => t.typed).join(" "))) continue;
      // A one-word name covers its whole run of unknown words: "robotics" alone isn't the team in "hypnotc robotics".
      // A longer name is specific enough beside another ("hypnotic robotics bad wolf"), and a place beside it is a
      // place ("ultraviolet nj").
      const loose = (t: Tok | undefined) => !!t && !t.used && !isLex(t.w) && !/^\d+$/.test(t.w);
      const placeAt = (a: number, b: number) => a >= 0 && b <= toks.length && toks.slice(a, b).every((t) => !t.used) && !!ctx.names.place(toks.slice(a, b).map((t) => t.w).join(" "), toks.slice(a, b).map((t) => t.typed).join(" "));
      const placed = (k: number, dir: 1 | -1) => [1, 2, 3].some((n) => (dir > 0 ? placeAt(k, k + n) : placeAt(k - n + 1, k + 1)));
      if (len === 1 && ((loose(toks[i - 1]) && !placed(i - 1, -1)) || (loose(toks[i + len]) && !placed(i + len, 1)))) continue;
      const said = span.map((t) => t.w).join(" ");
      // A name's own part never takes a word of a longer place's name ("north" of "north carolina").
      const inPlace = [1, 2, 3].some((n) => n > len && Array.from({ length: n - len + 1 }, (_, o) => i - o).some((a) => placeAt(a, a + n)));
      const named = ctx.names.teamsNamed(said).length ? ctx.names.teamsNamed(said) : inPlace ? [] : ctx.names.teamsCalled(said);
      if (!named.length) continue;
      // What a question asks about ("alliances", "inspire", "stats") names a team only typed as its whole name: "nj
      // states alliances" is never team Alliance, "most inspire awards" never team Inspires (onlyTopicWords).
      const typed = span.map((t) => t.typed).join(" ");
      if (onlyTopicWords(typed) && !named.some((n) => wholeName(n.name) === wholeName(typed))) continue;
      // A name is a team only where the query refers to one: "team" or "ftc" before it, or one of its numbers beside it,
      // make it one whatever its words. Otherwise a region's or a country's name is the place ("top match CA this week",
      // "lowest score Texas"), never a team named after it; and a name made only of ordinary words ("I Forgot", "Lost
      // In Time") is a team only typed whole, and never in a question asking which team ("who won inspire at …, i forgot").
      const numbered = (t: Tok | undefined) => !!t && /^\d+$/.test(t.w) && named.some((n) => n.number === Number(t.w));
      if (!/^(?:team|ftc)$/.test(toks[i - 1]?.w ?? "") && !numbered(toks[i - 1]) && !numbered(toks[i + len])) {
        const pl = ctx.names.place(said, typed);
        if (pl && pl.kind !== "city") continue;
        if (onlyOrdinary(said) && (!ctx.names.teamsNamed(said).length || asksWhich(raw))) continue;
      }
      // A number typed beside its own name ("12345 hypnotic robotics") is one team.
      if (!named.some((n) => p.teams.some((t) => t.number === n.number))) {
        p.teams.push({ number: named[0].number, name: named[0].name, typed: span.map((t) => t.typed).join(" "), via: "name", at: i, ...(named.length > 1 ? { candidates: named.map((n) => n.number) } : {}) });
      }
      span.forEach((t) => (t.used = true));
      if (/^(?:team|ftc)$/.test(toks[i - 1]?.w ?? "")) toks[i - 1].used = true;
    }
  }

  // 2. Numbers: a match's number, a count ("top 5"), or a team.
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.used) continue;
    const qm = /^(?:q|qm|qual|m)(\d{1,3})$/.exec(t.w);
    if (qm) { p.matchNumber = Number(qm[1]); if (/^q/.test(t.w)) p.level = "qual"; t.used = true; symbols.add("thing:match"); continue; }
    // A team's number with its possessive typed without the apostrophe ("4215s chances"): that team's number.
    const poss = /^(\d{1,5})s$/.exec(t.w);
    if (poss && ctx.names.team(Number(poss[1]))) t.w = poss[1];
    if (!/^\d{1,5}$/.test(t.w)) continue;
    const n = Number(t.w), prev = toks[i - 1]?.w, next = toks[i + 1]?.w;
    if (prev && MATCH_BEFORE.test(prev) && n <= 400) { p.matchNumber = n; t.used = true; toks[i - 1].used = true; symbols.add("thing:match"); if (prev !== "match" && prev !== "game") p.level = "qual"; continue; }
    // "Top 5 teams", and "top 3" ending the query.
    if (prev && COUNT_BEFORE.test(prev) && n <= 50 && (next ? !ctx.names.team(Number(next)) : !p.teams.length)) { p.n = n; t.used = true; continue; }
    // A size in teams ("more than 40 teams", "at least 40 teams", "40 or more teams"): a count, never team 40.
    const sized = /^teams?$/.test(next ?? "") || (next === "or" && /^(?:more|fewer|less)$/.test(toks[i + 2]?.w ?? "") && /^teams?$/.test(toks[i + 3]?.w ?? ""));
    if (sized && (SIZE_BEFORE.test(prev ?? "") || next === "or")) { t.used = true; continue; }
    // A number of points ("lose by 1 point", "won by 30 pts"): a margin or a score, never team 1. Left unread for the
    // readers that take it.
    if (/^(?:points?|pts?)$/.test(next ?? "")) continue;
    const team = ctx.names.team(n);
    if (team) {
      // A name several teams share, with one of their numbers typed right beside it ("<shared name> <number>", "<number>
      // <shared name>", "team" or "ftc" between allowed), is that team. Only beside it: a number elsewhere is its own
      // team, never pulled across "vs" or past another team.
      const beside = (x: Parsed["teams"][number]) => {
        if (x.at == null) return false;
        const end = x.at + x.typed.split(/\s+/).length, gap = (k: number) => /^(?:team|ftc)$/.test(toks[k]?.w ?? "");
        return i === end || (i === end + 1 && gap(end)) || i === x.at - 1 || (i === x.at - 2 && gap(x.at - 1));
      };
      const shared = p.teams.find((x) => x.via === "name" && x.candidates?.includes(n) && beside(x));
      if (shared) { shared.number = n; shared.name = team.name; delete shared.candidates; }
      else if (!p.teams.some((x) => x.number === n)) p.teams.push({ number: n, name: team.name, typed: t.typed, via: "number", at: i });
      t.used = true;
      if (/^(?:team|ftc)$/.test(prev ?? "")) toks[i - 1].used = true;
    }
  }

  // 2b. Places by their whole name or code, before the lexicon reads their words ("in ME" is Maine, "united states"
  // a country): a region code only as typed in capitals after "in", "from" or "at"; never a word of an event's name
  // ("New Jersey Championship").
  for (let len = 4; len >= 1 && !p.place; len--) {
    for (let i = 0; i + len <= toks.length && !p.place; i++) {
      const span = toks.slice(i, i + len);
      if (span.some((t) => t.used) || EVENT_NAME_WORDS.has(toks[i + len]?.w ?? "")) continue;
      const code = len === 1 && /^[A-Z]{2}$/.test(span[0].typed);
      if (code && !/^(?:in|from|at)$/.test(toks[i - 1]?.w ?? "")) continue;
      if (!code && span.every((t) => isLex(t.w))) continue;
      const pl = ctx.names.place(span.map((t) => t.w).join(" "), span.map((t) => t.typed).join(" "));
      if (pl) { p.place = { ...pl, typed: span.map((t) => t.typed).join(" ") }; placeFrom = i; span.forEach((t) => (t.used = true)); }
    }
  }

  // A swapped team said with "in" or "out" before "for" or "with" ("sub <team> in for <team>", "swap <team> out for
  // <team>"): which way the swap goes, read before the lexicon so "in" is never a preposition there.
  const swapSaid = new RegExp(`^(?:${SWAP_WORDS})$`);
  if (toks.some((t) => !t.used && swapSaid.test(t.w))) {
    for (const t of p.teams) {
      const i = t.at + t.typed.split(" ").length, d = toks[i];
      if (d && !d.used && /^(?:in|out)$/.test(d.w) && /^(?:for|with)$/.test(toks[i + 1]?.w ?? "")) { d.used = true; if (d.w === "in") symbols.add("swap-in"); }
    }
  }

  // 3. The lexicon, longest phrase first at each place.
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used) continue;
    const e = lexAt(i);
    if (!e) continue;
    e.words.forEach((_, j) => (toks[i + j].used = true));
    // A stat said not to go by ("by rating, not OPR"): dropped with its "not". Stats only: "did not win" keeps its win.
    if (i > 0 && !toks[i - 1].used && toks[i - 1].w === "not" && e.syms.every((s) => s.k === "metric" && NOT_STATS.has(s.v))) { toks[i - 1].used = true; (p.notStats ??= []).push(e.words.map((_, j) => toks[i + j].typed).join(" ")); (p.notMetrics ??= []).push(...e.syms.map((s) => `metric:${s.k === "metric" ? s.v : ""}`)); continue; }
    // A colour read as an alliance can start a team's name typed nearly right ("blue megalodns"): step 4 may take it back.
    if (e.words.length === 1 && e.syms.length === 1 && e.syms[0].k === "alliance") toks[i].alliance = true;
    for (const s of e.syms) {
      if (s.k === "level") p.level = s.v;
      else if (s.k === "finals") p.finals = true;
      else if (s.k === "alliance") { p.alliance = s.v; e.words.forEach((_, j) => (toks[i + j].side = s.v)); }
      else if (s.k === "worlds") p.worlds = true;
      else if (s.k === "states") p.states = true;
      else if (s.k === "award") { p.award = s.v; symbols.add("metric:award"); }
      else if (s.k === "nopen") p.noPenalties = true;
      else if (s.k === "undefeated") p.undefeated = true;
      else if (s.k === "agg" && !p.agg) p.agg = s.v;
      else if (s.k === "vs" && p.vsAt == null) p.vsAt = i;
      // "Per match", "each game": a rate said, never "a match".
      else if (s.k === "per" && s.v === "match" && e.words[0] !== "a") rate = true;
      else if (s.k === "swap" && p.swapAt == null) p.swapAt = i;
      const k = symKey(s);
      if (k && s.k !== "award") symbols.add(k);
    }
  }
  // Reaching Worlds said beside a forecast ("chance of making worlds", "odds of qualifying for worlds"): the chance to
  // advance there, never a count of appearances or qualification matches.
  // A question of what is to come said instead ("can 12345 make it to states", "will 12345 make worlds") asks the same.
  if ((symbols.has("predict") || symbols.has("future")) && (p.worlds || p.states)) {
    // The verb, then any filler or preposition ("making it to the world championship"), then the place's name.
    // The words in between are part of the reach, read with it.
    const between: Tok[] = [];
    const reach = toks.filter((t, i) => {
      // "Advance" reaches a place only said with "to" ("advance to worlds"); "advance at worlds" is its division there.
      const toward = ADVANCE_TO.has(t.w);
      if (!REACH.has(t.w) && !toward) return false;
      let j = i + 1;
      while (j < toks.length && REACH_BETWEEN.has(toks[j].w)) j++;
      if (j >= toks.length || !WORLDS_WORDS.has(toks[j].w)) return false;
      if (toward && !toks.slice(i + 1, j).some((x) => x.w === "to" || x.w === "into")) return false;
      between.push(...toks.slice(i + 1, j));
      return true;
    });
    if (reach.length) {
      [...reach, ...between].forEach((t) => (t.used = true));
      p.reach = true;
      symbols.add("advance");
      // "Next year", "next season": the way there starts at the team's next event.
      if (symbols.has("agg:next")) symbols.delete("thing:season");
      symbols.delete("metric:appearance");
      if (p.level === "qual" && reach.some((t) => t.w.startsWith("qualif"))) { p.level = null; symbols.delete("level:qual"); }
    }
  }
  // One-word awards beside an award word: "design award", "12345 think awards".
  if (symbols.has("metric:award")) {
    for (const t of toks) if (!t.used && AWARD_ONE_WORD.has(t.w)) { p.award = AWARD_ONE_WORD.get(t.w)!; t.used = true; }
    // "Winner" beside an award word ("12345 winner awards") is the winning-alliance award, not a win asked about.
    // Never a forecast's word ("who is the winner …"): only a win read from "winner" itself.
    if (!p.award && !symbols.has("predict") && symbols.has("metric:win") && toks.some((t) => /^winners?$/.test(t.w))) { p.award = AWARD_ONE_WORD.get("winner")!; symbols.delete("metric:win"); }
  }

  // One word left on its own, of a named team's own event's name ("<team> last prediction for <word>"): that event,
  // its latest (in the season or the year said), once every team is settled. Never a kind of event's word ("league",
  // "qualifiers": read below) or a word of its own kind ("meet"). Tried before a near miss of a team's name, so a team
  // named nearly so ("Rivertide" for "riverside") never takes a named team's own event word. A name several teams share
  // reads every one of them's events here, and the event is checked again once the name is settled (below).
  const when = (() => {
    const t = p.time;
    return { season: t?.kind === "season" && t.year == null ? t.season : t?.kind === "window" ? t.season : null, year: t?.kind === "season" ? t.year ?? null : null,
      // A window said ("last week", "in March"): the event is one held in it.
      ...(t?.kind === "window" && t.from && t.to ? { from: t.from, to: t.to } : {}) };
  })();
  let ownWord: Tok | null = null, ownDropped = false;
  const ownEventWord = async (one: Tok): Promise<boolean> => {
    if (p.event || !p.teams.length || !ctx.teamEvent || one.w.length < 3 || KIND_WORDS.has(one.w) || EVENT_TYPES[one.w.replace(/s$/, "")] || EVENT_TYPES[one.w]) return false;
    // "Division" with Worlds said is the team's Worlds division ("what division was <team> in at worlds"), never its
    // latest event with a division.
    if (p.worlds && /^divisions?$/.test(one.w)) return false;
    const name = await ctx.teamEvent(one.w, p.teams.flatMap((x) => (x.candidates && !x.rule ? x.candidates : [x.number])), when);
    if (!name) return false;
    p.event = { words: name, typed: one.typed, latest: true };
    one.used = true;
    ownWord = one;
    if (!toks.some((x) => x !== one && KIND_WORDS.has(x.w))) ownDropped = symbols.delete("thing:event");
    return true;
  };

  // 4. The words left, in runs: an event's name, a place, or a team's name typed nearly right.
  const runs: { from: number; to: number }[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used) continue;
    let j = i;
    while (j + 1 < toks.length && !toks[j + 1].used) j++;
    runs.push({ from: i, to: j });
    i = j;
  }
  for (const run of runs) {
    const { from, to } = run;
    const words = () => toks.slice(from, to + 1).map((t) => t.w).join(" ");
    const typed = () => toks.slice(from, to + 1).map((t) => t.typed).join(" ");
    // A team read by part of its name ("girls in" of Girls in Robotics), with the words right after it nearly spelling a
    // longer team's whole name with it ("girls in roboics 2": Girls in Robotics 2): that team, never the words taken
    // for an event or a place. The longest stretch of the words that does is taken. A name several teams share ("Girls
    // in Robotics", two teams) is no reason to stop: the longer name is one team's.
    const before = p.teams.find((t) => t.via === "name" && t.at + t.typed.split(" ").length === from);
    if (before && ctx.nearTeam) {
      const own = toks.slice(before.at, from);
      let longer: { team: TeamName; upTo: number } | null = null;
      for (let end = to; end >= from && !longer; end--) {
        const near = await ctx.nearTeam([...own, ...toks.slice(from, end + 1)].map((t) => t.w).join(" "));
        if (near && near.number !== before.number && !before.candidates?.includes(near.number) && fold(near.name ?? "").length > fold(before.name ?? "").length) longer = { team: near, upTo: end };
      }
      if (longer) {
        Object.assign(before, { number: longer.team.number, name: longer.team.name, typed: [...own, ...toks.slice(from, longer.upTo + 1)].map((t) => t.typed).join(" "), via: "near" as const });
        delete before.candidates;
        delete before.rule;
        toks.slice(from, longer.upTo + 1).forEach((t) => (t.used = true));
        // Words after it in the run are left unread (the question isn't read whole), never taken for an event here.
        continue;
      }
      // No longer team, but the words nearly spell the rest of its own name ("girls in roboics": Girls in Robotics):
      // they are its name, never an event's or a place's; any words after them are left unread.
      const whole = fold(before.name ?? ""), ownSaid = fold(own.map((t) => t.w).join(" "));
      for (let end = to; end >= from; end--) {
        const said = fold([...own, ...toks.slice(from, end + 1)].map((t) => t.w).join(" "));
        const d = edits(said, whole);
        if (said.length > ownSaid.length && d > 0 && d <= allowedEdits(whole.replace(/\s/g, "").length)) {
          before.typed = [...own, ...toks.slice(from, end + 1)].map((t) => t.typed).join(" ");
          toks.slice(from, end + 1).forEach((t) => (t.used = true));
          break;
        }
      }
      if (toks[from].used) continue;
    }
    const hasEventWord = toks.slice(from, to + 1).some((t) => EVENT_NAME_WORDS.has(t.w));
    const place = !hasEventWord ? ctx.names.place(words(), typed()) : null;
    if (place && !p.place) { p.place = { ...place, typed: typed() }; placeFrom = from; toks.slice(from, to + 1).forEach((t) => (t.used = true)); continue; }
    // The region or country a town named is in, said after it ("Cluj-Napoca, Romania", "Oradell, NJ"): the same place.
    if (place && p.place && within(p.place, place)) { toks.slice(from, to + 1).forEach((t) => (t.used = true)); continue; }
    // One event: a second one named ("at nj championship at northern division") is left unexplained, never dropped.
    if (!p.event && await ctx.isEvent(words())) {
      // The event words the lexicon read beside it ("northern league meet": "meet") stay in its name when the name
      // with them is an event too, so a meet is never read as the league's tournament.
      let a = from, b = to;
      while (b + 1 < toks.length && EVENT_NAME_WORDS.has(toks[b + 1].w)) b++;
      while (a > 0 && EVENT_NAME_WORDS.has(toks[a - 1].w)) a--;
      const span = (x: number, y: number) => toks.slice(x, y + 1);
      const wide = (a !== from || b !== to) && await ctx.isEvent(span(a, b).map((t) => t.w).join(" "));
      const [x, y] = wide ? [a, b] : [from, to];
      p.event = { words: span(x, y).map((t) => t.w).join(" "), typed: span(x, y).map((t) => t.typed).join(" ") };
      span(x, y).forEach((t) => (t.used = true));
      if (!toks.some((t) => !span(x, y).includes(t) && KIND_WORDS.has(t.w))) symbols.delete("thing:event");
      continue;
    }
    // A place with an event word after it, read as both: "California events".
    if (hasEventWord && !p.place) {
      const bare = toks.slice(from, to + 1).filter((t) => !EVENT_NAME_WORDS.has(t.w));
      const pl = bare.length ? ctx.names.place(bare.map((t) => t.w).join(" "), bare.map((t) => t.typed).join(" ")) : null;
      // A state with only a championship word after it is its state championship ("nj champs", "texas championship").
      const champ = toks.slice(from, to + 1).every((t) => !EVENT_NAME_WORDS.has(t.w) || /^(?:championships?|champs)$/.test(t.w));
      if (pl) {
        p.place = { ...pl, typed: bare.map((t) => t.typed).join(" ") }; placeFrom = from; toks.slice(from, to + 1).forEach((t) => (t.used = true));
        if (champ && pl.kind === "region") { p.states = true; symbols.add("states"); } else symbols.add("thing:event");
        continue;
      }
    }
    // A kind of event by its type words alone ("league", with "meet" the lexicon read beside it; "qualifiers"): every
    // word one of FIRST's event types, never an event's name (read above).
    const kindSpan = (() => {
      let a = from, b = to;
      while (a > 0 && KIND_WORDS.has(toks[a - 1].w)) a--;
      while (b + 1 < toks.length && KIND_WORDS.has(toks[b + 1].w)) b++;
      return toks.slice(a, b + 1);
    })();
    if (!p.event && !p.eventKind && toks.slice(from, to + 1).every((t) => EVENT_TYPES[t.w.replace(/s$/, "")] || EVENT_TYPES[t.w])) {
      p.eventKind = kindSpan.map((t) => t.w).join(" ");
      kindSpan.forEach((t) => (t.used = true));
      if (!toks.some((t) => !kindSpan.includes(t) && KIND_WORDS.has(t.w))) symbols.delete("thing:event");
      continue;
    }
    // A team's name nearly right ("hypnotc robotics"): the team, with a "Did you mean". A name can start with a word
    // read as filler ("the roocats": The Robocats) or a colour read as an alliance, so the words just before the run are
    // tried with it first; a colour taken into the name is no longer an alliance, and the alliance is the one the
    // phrases outside the name said ("on red blue lanternfsh": red).
    if (from === to && await ownEventWord(toks[from])) continue;
    if (!ctx.nearTeam || words().length < 3 || /^\d+$/.test(words())) continue;
    for (const k of [2, 1, 0]) {
      const start = from - k;
      if (start < 0 || toks.slice(start, from).some((t) => !FILLER_WORDS.has(t.w) && !t.alliance)) continue;
      const span = toks.slice(start, to + 1);
      // What a question asks about is never a name typed nearly right ("inspire" is no typo of team Inspires), nor is an
      // ordinary word ("month" is no typo of team Monte).
      if (onlyTopicWords(span.map((t) => t.typed).join(" ")) || onlyOrdinary(span.map((t) => t.w).join(" "))) continue;
      const near = await ctx.nearTeam(span.map((t) => t.w).join(" "));
      // A name several teams share typed nearly right ("copper roboics", two teams called Copper Robotics) is that
      // name: its teams, picked or asked about as the name typed right is. A number after it that is no team's
      // ("girls in roboics 2") is the teams' own numbering, read with the name.
      const last = toks[to].w, numbering = to > start && /^\d{1,3}$/.test(last) && !ctx.names.team(Number(last));
      const nameSpan = numbering ? span.slice(0, -1) : span;
      const shared = near ? [] : ctx.names.nearShared?.(nameSpan.map((t) => t.w).join(" ")) ?? [];
      if (shared.length && !shared.some((n) => p.teams.some((t) => t.number === n.number))) {
        p.teams.push({ number: shared[0].number, name: shared[0].name, typed: nameSpan.map((t) => t.typed).join(" "), via: "name", at: start, candidates: shared.map((n) => n.number) });
        span.forEach((t) => (t.used = true));
        break;
      }
      if (!near || p.teams.some((t) => t.number === near.number)) continue;
      p.teams.push({ number: near.number, name: near.name, typed: span.map((t) => t.typed).join(" "), via: "near", at: start });
      span.forEach((t) => (t.used = true));
      if (span.some((t) => t.alliance)) {
        const side = toks.filter((t) => t.side && !span.includes(t)).pop()?.side ?? null;
        symbols.delete("alliance:red"); symbols.delete("alliance:blue");
        p.alliance = side;
        if (side) symbols.add(`alliance:${side}`);
      }
      break;
    }
  }

  p.teams.sort((a, b) => a.at - b.at);
  // A name several teams share: picked by fixed rules (pickShared below), with the place named as one of them.
  // In passes, so a name settled on its own (newest season, your team) can then settle the one beside it, in any order.
  for (let more = true; more;) {
    more = false;
    for (const t of p.teams) {
      if (!t.candidates || t.rule) continue;
      const pick = pickShared(t, p, ctx);
      if (pick.rule) { Object.assign(t, pick); more = true; }
    }
  }
  // A place typed right after a shared name that it told apart ("ultraviolet nj") said which team, not where its
  // matches were; one said with a preposition ("record in new jersey", "at nj states") stays the matches' place.
  // The name's last word is the word typed just before the place's first, counted in the words as typed (a time read
  // out between them still stands between them; a possessive dropped from the name still counts as its word).
  const rightAfter = (t: TeamSlot) => {
    const last = toks[t.at + t.typed.split(/\s+/).length - 1];
    return placeFrom >= 0 && !!last && last.at + 1 === toks[placeFrom].at;
  };
  if (p.place && p.teams.some((t) => t.rule === `the one in ${p.place!.name}` && rightAfter(t))) p.place = null;
  // The one-word event, checked again among the teams as settled: none of theirs, and the word is left unread.
  const own = ownWord as Tok | null;
  if (own && p.event?.latest && ctx.teamEvent && !p.teams.some((t) => t.candidates && !t.rule)) {
    const name = await ctx.teamEvent(own.w, p.teams.map((t) => t.number), when);
    if (name) p.event = { ...p.event, words: name };
    else {
      // Undone whole: the word unread again, and "event" said around it back in the question.
      p.event = null; own.used = false;
      if (ownDropped) symbols.add("thing:event");
    }
  }
  // A word said before any team was found ("<word> forecast for <team typed nearly right>"): tried again now every
  // team is, among the settled teams' own events.
  if (!p.event && p.teams.length && !p.teams.some((t) => t.candidates && !t.rule)) {
    for (const [i, one] of toks.entries()) {
      if (one.used || one === own || toks[i - 1]?.used === false || toks[i + 1]?.used === false) continue;
      if (await ownEventWord(one)) break;
    }
  }
  // "Worlds division highlights", with no team: every division of Worlds, which Worlds already is (each division and
  // the finals). With a team, "division" is its own Worlds division, search's other readers' ask.
  if (p.worlds && !p.teams.length && !p.event) for (const t of toks) if (!t.used && /^divisions?$/.test(t.w)) t.used = true;
  p.leftover = toks.filter((t) => !t.used).map((t) => t.typed);
  if (unread) p.leftover.unshift(unread);
  if (p.teams.some((t) => t.candidates && !t.rule)) p.leftover.push(...p.teams.filter((t) => t.candidates && !t.rule).map((t) => t.typed));
  p.symbols = [...symbols];
  const pick = pickIntent(symbols, p.teams.length, { event: !!p.event, n: p.n != null, matchNo: p.matchNumber != null, rate });
  if (pick) { p.intent = pick.rule.id; p.rule = pick.rule; p.unexplained = pick.unexplained; }
  // "Without penalties" is a slot only the rules that list it take (the season's best matches); anywhere else the
  // parse is left incomplete rather than answered with penalties in.
  if (pick && p.noPenalties && !(pick.rule.opt ?? []).includes("nopen")) pick.unexplained.push("nopen");
  if (pick && p.over != null && !(pick.rule.opt ?? []).includes("over")) pick.unexplained.push("over");
  // The awards side-by-side counts every award: one award named ("12345 vs 67890 inspire awards") is left to the
  // readers that count that award alone.
  if (pick && p.award && pick.rule.id === "awards-vs") pick.unexplained.push(`award:${p.award}`);
  p.complete = !!pick && !pick.unexplained.length && !p.leftover.length;
  return p;
}

/** Whether `inner` lies in `outer` (a town in its region or country, a region in its country). */
function within(inner: Place, outer: Place): boolean {
  if (inner.country !== outer.country || outer.kind === "city") return false;
  return outer.kind === "country" ? inner.kind !== "country" : inner.kind === "city" && inner.state === outer.state;
}

/** One of the teams sharing a name, by the rules Compare uses too (./shared.ts): the visitor's own team, the one in
 *  the place named or in another settled team's region, the only one that has played or still plays, the clearly
 *  stronger one. Still tied: no rule, and the parse is incomplete (search asks which). */
function pickShared(slot: TeamSlot, p: Parsed, ctx: ParseContext): Partial<TeamSlot> {
  const cands = (slot.candidates ?? []).map((n) => ctx.names.team(n)).filter((t): t is TeamName => !!t);
  // Only teams already settled count as "the other team": a name still shared holds an arbitrary first candidate.
  const others = p.teams.filter((t) => t !== slot && (!t.candidates || t.rule)).map((t) => ctx.names.team(t.number)).filter((t): t is TeamName => !!t);
  const r = pickAmong(cands, { mine: (n) => !!ctx.prefer?.has(`team:${n}`), place: p.place, others });
  return "team" in r ? { number: r.team.number, name: r.team.name, rule: r.rule } : {};
}

/** The slots in words, for the card's "Read as" line: "Intent: highest score · Team 12345 · In California · This week". */
export function describe(p: Parsed): string[] {
  return [
    p.intent ? `Intent: ${p.intent.replace(/-/g, " ")}` : "",
    ...p.teams.map((t) => `Team ${t.number}${t.name ? ` ${t.name}` : ""}`),
    p.named ? `Name: ${p.named.typed}` : "",
    p.event ? `Event: ${p.event.typed}` : "",
    p.worlds ? "FIRST Championship" : p.states ? "State championship" : "",
    p.place ? `${p.place.kind === "city" ? "From" : "In"} ${p.place.name}` : "",
    p.time ? `Time: ${p.time.label}` : "",
    p.finals ? "Finals" : p.level ? (p.level === "qual" ? "Qualification matches" : "Playoff matches") : "",
    p.alliance ? `${p.alliance === "red" ? "Red" : "Blue"} alliance` : "",
    p.award ? `Award: ${p.award}` : "",
    p.n != null ? `Limit: ${p.n}` : "",
  ].filter(Boolean);
}
