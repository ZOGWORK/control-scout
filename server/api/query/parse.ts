// The query, parsed into slots (docs/search-pipeline.md): the teams, the event, the place, the time, the match type,
// the side, the award, the aggregation and its limit, and the intent. Read in any word order, filler ignored, every
// word accounted for. Names come from the data (./names.ts), words from the lexicon (./lexicon.ts), times from
// ./time.ts, the intent from ./intents.ts. Nothing here names a team, an event or a place.
import { AWARD_ONE_WORD, EVENT_NAME_WORDS, LEXICON, type Agg, type Sym } from "./lexicon.js";
import { pickIntent, type IntentRule, type PipelineIntent } from "./intents.js";
import { readTime, type TimeSlot } from "./time.js";
import type { ScoreCond } from "./matchFind.js";
import { fold, type Names, type Place, type TeamName } from "./names.js";
import { EVENT_TYPES } from "../../../src/shared/searchEventQuery.js";

export interface TeamSlot {
  number: number; name: string | null; typed: string; via: "number" | "name" | "near";
  /** Every team with the name typed, when several share it, and the rule that picked this one. */
  candidates?: number[];
  rule?: string;
  /** Where in the query it was typed (teams are listed in typed order). */
  at: number;
}
/** An event named by its words: the executor finds it, by the season rule (latest, or the year said). */
export interface EventSlot { words: string; typed: string }
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
  /** Where the first "vs" stands (a word's index, as a team's `at`): two alliances are the teams either side of it. */
  vsAt?: number;
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
  /** The team a near miss of a name means ("hypnotc robotics"), or null. */
  nearTeam?: (words: string) => Promise<TeamName | null>;
  /** The visitor's own teams ("team:12345"), first when several share a name. */
  prefer?: ReadonlySet<string>;
}

type Tok = { w: string; typed: string; used: boolean; alliance?: boolean; side?: "red" | "blue" };
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
/** The kind words an event's name can end with. */
const KIND_WORDS = new Set(["meet", "meets", "tournament", "tournaments", "event", "events", "competition", "competitions"]);
/** The words before a number that make it a count ("top 5", "last 10") or a match's number ("match 3"). */
const COUNT_BEFORE = /^(?:top|last|first|best|latest|past|recent|bottom|worst|highest|lowest)$/;
const MATCH_BEFORE = /^(?:match|qual|q|game|qualification)$/;
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
  return ` ${q.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()} `
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
function keptName(words: string[], ctx: ParseContext, timeOnly: (w: string[]) => boolean): { from: number; to: number } | null {
  for (let i = 0; i < words.length; i++) {
    const f = NAMED_PHRASES.find((n) => n.every((w, j) => words[i + j] === w));
    if (!f) continue;
    const from = i + f.length;
    for (let to = words.length; to > from; to--) {
      const tail = words.slice(to);
      const ends = !tail.length || NAME_ENDS.test(tail[0]) || allFiller(tail) || timeOnly(tail);
      if (ends && ctx.names.teamsNamed(words.slice(from, to).join(" ")).length) return { from, to };
    }
  }
  return null;
}

/** Parses `raw`. */
/** "Where the losing alliance scored over 200", "both alliances scored over 250", "each alliance had at least 150
 *  points": whose score, the comparison and the number, and the query without them. */
const SIDE: Record<string, ScoreCond["side"]> = { losing: "losing", losers: "losing", winning: "winning", winners: "winning", both: "both", each: "both", either: "either", one: "either" };
const OP: [RegExp, ScoreCond["op"]][] = [[/^(?:over|more than|above)$/, ">"], [/^at least$/, ">="], [/^(?:under|less than|below|fewer than)$/, "<"], [/^at most$/, "<="]];
const COND_RE = /(?:^| )(?:(?:where|with|in which|when|that|and) )?(?:the )?(losing|losers|winning|winners|both|each|either|one) (?:of the )?(?:alliances?|sides?)(?: each)? (?:scored|scores|score|had|got|put up|reached|hit|with) (over|more than|above|at least|under|less than|below|fewer than|at most) (\d{1,4})(?: points?| pts)?(?= |$)/;
export function scoreCondOf(q: string): { cond: ScoreCond; rest: string } | null {
  const m = COND_RE.exec(q);
  if (!m) return null;
  const op = OP.find(([re]) => re.test(m[2]))![1];
  return { cond: { side: SIDE[m[1]], op, n: Number(m[3]) }, rest: `${q.slice(0, m.index)} ${q.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim() };
}

export async function parseQuery(raw: string, ctx: ParseContext): Promise<Parsed> {
  // A score an alliance had to reach is read off first: its number is never a team.
  const cond = scoreCondOf(normalise(raw));
  const q = cond ? cond.rest : normalise(raw);
  const typedWords = raw.replace(/[?!,;:()"]/g, " ").split(/\s+/).filter(Boolean);
  // The other team numbers typed: a limit ("last 5") or a match's number ("match 3") is never a team.
  const words0 = q.split(" ");
  const teamNums = words0.filter((w, i) => /^\d{1,5}$/.test(w) && !COUNT_BEFORE.test(words0[i - 1] ?? "") && !MATCH_BEFORE.test(words0[i - 1] ?? "") && !!ctx.names.team(Number(w))).map(Number);
  // A bare year is a season unless it's the only team number and a team has it ("2024 record", "2024 last 5 matches").
  // "Season 2024" names the season, but "this season 2024 record" is the team after "this season".
  // A team's number joined to another by "vs" or "and" is one of the teams compared, not a year.
  const said = (y: number) => new RegExp(`\\b(?:in|during|for|from|(?<!\\b(?:this|current)\\s)season)\\s+(?:the\\s+)?${y}\\b`).test(q);
  const paired = (y: number) => new RegExp(`\\b${y}\\s+(?:vs\\.?|v|versus|against|and|&)\\s|\\s(?:vs\\.?|v|versus|against|and|&)\\s+${y}\\b`).test(` ${q} `);
  const yearOk = (y: number) => said(y) || (!(ctx.names.team(y) && paired(y)) && (teamNums.some((n) => n !== y) || !ctx.names.team(y)));
  // A stored name asked about as words keeps its words from the time reader ("Powerplay Robotics", "March Madness").
  const timeOnly = (w: string[]) => { const r = readTime(w.join(" "), ctx.today, yearOk); return !!r.time && allFiller(r.rest.split(" ").filter(Boolean)); };
  const at0 = keptName(words0, ctx, timeOnly);
  // The name stands in as one word no time reads, then comes back whole.
  const kept = at0 && words0.slice(at0.from, at0.to).join(" ");
  const read = readTime(at0 ? [...words0.slice(0, at0.from), NAME_MARK, ...words0.slice(at0.to)].join(" ") : q, ctx.today, yearOk);
  const { time, unread } = read;
  const rest = kept ? read.rest.replace(NAME_MARK, kept) : read.rest;
  // Each word with its own spelling as typed, matched in order ("in IN": the second is the state code).
  let at = 0;
  const toks: Tok[] = rest.split(" ").filter(Boolean).map((w) => {
    const k = typedWords.findIndex((t, i) => i >= at && fold(t) === w);
    if (k >= 0) at = k + 1;
    return { w, typed: k >= 0 ? typedWords[k] : w, used: false };
  });
  const symbols = new Set<string>(cond ? ["cond"] : []);
  const p: Parsed = {
    q: raw, teams: [], event: null, place: null, time, level: null, finals: false, eventKind: null, alliance: null, worlds: false, states: false, award: null, agg: null,
    n: null, matchNumber: null, noPenalties: false, symbols: [], intent: null, rule: null, leftover: [], unexplained: [], complete: false,
    ...(cond ? { scoreCond: cond.cond } : {}),
  };
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

  // 1. Teams by their whole name, longest first: a name made only of search's own words ("The Best") isn't claimed,
  // so "best team" stays a question.
  for (let len = Math.min(ctx.names.longest, 12); len >= 1; len--) {
    for (let i = 0; i + len <= toks.length; i++) {
      const span = toks.slice(i, i + len);
      if (span.some((t) => t.used) || span.every((t) => isLex(t.w) || /^\d+$/.test(t.w))) continue;
      // After "in" or "from", a place's name is the place ("teams from Texas"), whatever team shares it.
      if (/^(?:in|from|at|near)$/.test(toks[i - 1]?.w ?? "") && ctx.names.place(span.map((t) => t.w).join(" "), span.map((t) => t.typed).join(" "))) continue;
      // A one-word name covers its whole run of unknown words: "robotics" alone isn't the team in "hypnotc robotics".
      // A longer name is specific enough beside another ("hypnotic robotics bad wolf").
      const loose = (t: Tok | undefined) => !!t && !t.used && !isLex(t.w) && !/^\d+$/.test(t.w);
      if (len === 1 && (loose(toks[i - 1]) || loose(toks[i + len]))) continue;
      const named = ctx.names.teamsNamed(span.map((t) => t.w).join(" "));
      if (!named.length) continue;
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
    if (!/^\d{1,5}$/.test(t.w)) continue;
    const n = Number(t.w), prev = toks[i - 1]?.w, next = toks[i + 1]?.w;
    if (prev && MATCH_BEFORE.test(prev) && n <= 400) { p.matchNumber = n; t.used = true; toks[i - 1].used = true; symbols.add("thing:match"); if (prev !== "match" && prev !== "game") p.level = "qual"; continue; }
    // "Top 5 teams", and "top 3" ending the query.
    if (prev && COUNT_BEFORE.test(prev) && n <= 50 && (next ? !ctx.names.team(Number(next)) : !p.teams.length)) { p.n = n; t.used = true; continue; }
    const team = ctx.names.team(n);
    if (team) {
      if (!p.teams.some((x) => x.number === n)) p.teams.push({ number: n, name: team.name, typed: t.typed, via: "number", at: i });
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
      if (pl) { p.place = { ...pl, typed: span.map((t) => t.typed).join(" ") }; span.forEach((t) => (t.used = true)); }
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
      const k = symKey(s);
      if (k && s.k !== "award") symbols.add(k);
    }
  }
  // One-word awards beside an award word: "design award", "12345 think awards".
  if (symbols.has("metric:award")) {
    for (const t of toks) if (!t.used && AWARD_ONE_WORD.has(t.w)) { p.award = AWARD_ONE_WORD.get(t.w)!; t.used = true; }
  }

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
    const hasEventWord = toks.slice(from, to + 1).some((t) => EVENT_NAME_WORDS.has(t.w));
    const place = !hasEventWord ? ctx.names.place(words(), typed()) : null;
    if (place && !p.place) { p.place = { ...place, typed: typed() }; toks.slice(from, to + 1).forEach((t) => (t.used = true)); continue; }
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
      if (pl) { p.place = { ...pl, typed: bare.map((t) => t.typed).join(" ") }; toks.slice(from, to + 1).forEach((t) => (t.used = true)); symbols.add("thing:event"); continue; }
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
    if (!ctx.nearTeam || words().length < 3 || /^\d+$/.test(words())) continue;
    for (const k of [2, 1, 0]) {
      const start = from - k;
      if (start < 0 || toks.slice(start, from).some((t) => !FILLER_WORDS.has(t.w) && !t.alliance)) continue;
      const span = toks.slice(start, to + 1);
      const near = await ctx.nearTeam(span.map((t) => t.w).join(" "));
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
  p.leftover = toks.filter((t) => !t.used).map((t) => t.typed);
  if (unread) p.leftover.unshift(unread);
  if (p.teams.some((t) => t.candidates && !t.rule)) p.leftover.push(...p.teams.filter((t) => t.candidates && !t.rule).map((t) => t.typed));
  p.symbols = [...symbols];
  const pick = pickIntent(symbols, p.teams.length, { event: !!p.event, n: p.n != null, matchNo: p.matchNumber != null });
  if (pick) { p.intent = pick.rule.id; p.rule = pick.rule; p.unexplained = pick.unexplained; }
  // "Without penalties" is a slot only the rules that list it take (the season's best matches); anywhere else the
  // parse is left incomplete rather than answered with penalties in.
  if (pick && p.noPenalties && !(pick.rule.opt ?? []).includes("nopen")) pick.unexplained.push("nopen");
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

/** One of the teams sharing a name, by the rules Compare uses (server/api/searchCompare.ts): the visitor's own team,
 *  one that has played, the newest season played, then the one in the place named or in the other team's region.
 *  Still tied: no rule, and the parse is incomplete (search asks which). */
function pickShared(slot: TeamSlot, p: Parsed, ctx: ParseContext): Partial<TeamSlot> {
  let cands = (slot.candidates ?? []).map((n) => ctx.names.team(n)).filter((t): t is TeamName => !!t);
  const take = (t: TeamName, rule: string): Partial<TeamSlot> => ({ number: t.number, name: t.name, rule });
  const mine = cands.filter((t) => ctx.prefer?.has(`team:${t.number}`));
  if (mine.length === 1) return take(mine[0], "your team");
  if (mine.length > 1) cands = mine;
  // Only teams already settled count as "the other team": a name still shared holds an arbitrary first candidate.
  const place = p.place, others = p.teams.filter((t) => t !== slot && (!t.candidates || t.rule)).map((t) => ctx.names.team(t.number)).filter((t): t is TeamName => !!t);
  const inPlace = (t: TeamName) => !!place && t.country === place.country && (place.state == null || t.state === place.state) && (place.city == null || t.city === place.city);
  const local = place ? cands.filter(inPlace) : [];
  if (local.length === 1) return take(local[0], `the one in ${place!.name}`);
  if (local.length > 1) cands = local;
  const played = cands.filter((t) => t.lastPlayed != null);
  if (played.length === 1) return take(played[0], "the only one that has played");
  if (played.length) cands = played;
  const newest = Math.max(...cands.map((t) => t.lastPlayed ?? -1));
  const recent = cands.filter((t) => (t.lastPlayed ?? -1) === newest);
  if (recent.length === 1) return take(recent[0], "the one that played most recently");
  const near = recent.filter((t) => others.some((o) => o.country === t.country && o.state === t.state));
  if (near.length === 1) return take(near[0], `the one in the same region as ${others[0].number}`);
  return {};
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
