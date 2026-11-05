// The query, parsed into slots (docs/search-pipeline.md): the teams, the event, the place, the time, the match type,
// the side, the award, the aggregation and its limit, and the intent. Read in any word order, filler ignored, every
// word accounted for. Names come from the data (./names.ts), words from the lexicon (./lexicon.ts), times from
// ./time.ts, the intent from ./intents.ts. Nothing here names a team, an event or a place.
import { AWARD_ONE_WORD, EVENT_NAME_WORDS, LEXICON, type Agg, type Sym } from "./lexicon.js";
import { pickIntent, type IntentRule, type PipelineIntent } from "./intents.js";
import { readTime, type TimeSlot } from "./time.js";
import { fold, type Names, type Place, type TeamName } from "./names.js";

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
  /** Every intent symbol read ("agg:max", "metric:score"). */
  symbols: string[];
  intent: PipelineIntent | null;
  rule: IntentRule | null;
  /** Words nothing explained: a parse with any is incomplete, and left to search's other readers. */
  leftover: string[];
  /** Symbols no intent explained. */
  unexplained: string[];
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

type Tok = { w: string; typed: string; used: boolean };
/** The one-word filler phrases ("the", "a"): read before a name that starts with one. */
const FILLER_WORDS = new Set(LEXICON.filter((e) => e.words.length === 1 && e.syms.every((x) => x.k === "filler")).map((e) => e.words[0]));
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
    .replace(/(\w)'s\b/g, "$1").replace(/s'(?=\s)/g, "s").replace(/#(?=\d)/g, " ")
    .replace(/(?<=[a-z])-(?=[a-z])/g, " ").replace(/[?!,;:()"[\]{}]/g, " ").replace(/\.(?=\s|$)/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Parses `raw`. */
export async function parseQuery(raw: string, ctx: ParseContext): Promise<Parsed> {
  const q = normalise(raw);
  const typedWords = raw.replace(/[?!,;:()"]/g, " ").split(/\s+/).filter(Boolean);
  // The other team numbers typed: a limit ("last 5") or a match's number ("match 3") is never a team.
  const words0 = q.split(" ");
  const teamNums = words0.filter((w, i) => /^\d{1,5}$/.test(w) && !COUNT_BEFORE.test(words0[i - 1] ?? "") && !MATCH_BEFORE.test(words0[i - 1] ?? "") && !!ctx.names.team(Number(w))).map(Number);
  // A bare year is a season unless it's the only team number and a team has it ("2024 record", "2024 last 5 matches").
  const yearOk = (y: number) => teamNums.some((n) => n !== y) || !ctx.names.team(y) || new RegExp(`\\b(?:in|during|for|season|from)\\s+(?:the\\s+)?${y}\\b`).test(q);
  const { time, rest, unread } = readTime(q, ctx.today, yearOk);
  // Each word with its own spelling as typed, matched in order ("in IN": the second is the state code).
  let at = 0;
  const toks: Tok[] = rest.split(" ").filter(Boolean).map((w) => {
    const k = typedWords.findIndex((t, i) => i >= at && fold(t) === w);
    if (k >= 0) at = k + 1;
    return { w, typed: k >= 0 ? typedWords[k] : w, used: false };
  });
  const symbols = new Set<string>();
  const p: Parsed = {
    q: raw, teams: [], event: null, place: null, time, level: null, alliance: null, worlds: false, states: false, award: null, agg: null,
    n: null, matchNumber: null, noPenalties: false, symbols: [], intent: null, rule: null, leftover: [], unexplained: [], complete: false,
  };
  const lexAt = (i: number) => LEXICON.find((e) => e.words.every((w, j) => toks[i + j] && !toks[i + j].used && toks[i + j].w === w));
  const isLex = (w: string) => LEX_WORDS.has(w) || AWARD_ONE_WORD.has(w);

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
    if (prev && COUNT_BEFORE.test(prev) && n <= 50 && next && !ctx.names.team(Number(next))) { p.n = n; t.used = true; continue; }
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
    for (const s of e.syms) {
      if (s.k === "level") p.level = s.v;
      else if (s.k === "alliance") p.alliance = s.v;
      else if (s.k === "worlds") p.worlds = true;
      else if (s.k === "states") p.states = true;
      else if (s.k === "award") { p.award = s.v; symbols.add("metric:award"); }
      else if (s.k === "nopen") p.noPenalties = true;
      else if (s.k === "agg" && !p.agg) p.agg = s.v;
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
    // A team's name nearly right ("hypnotc robotics"): the team, with a "Did you mean". A name can start with a word
    // read as filler ("the roocats": The Robocats), so the words just before the run are tried with it first.
    if (!ctx.nearTeam || words().length < 3 || /^\d+$/.test(words())) continue;
    for (const k of [2, 1, 0]) {
      const start = from - k;
      if (start < 0 || toks.slice(start, from).some((t) => !FILLER_WORDS.has(t.w))) continue;
      const span = toks.slice(start, to + 1);
      const near = await ctx.nearTeam(span.map((t) => t.w).join(" "));
      if (!near || p.teams.some((t) => t.number === near.number)) continue;
      p.teams.push({ number: near.number, name: near.name, typed: span.map((t) => t.typed).join(" "), via: "near", at: start });
      span.forEach((t) => (t.used = true));
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
    p.event ? `Event: ${p.event.typed}` : "",
    p.worlds ? "FIRST Championship" : p.states ? "State championship" : "",
    p.place ? `${p.place.kind === "city" ? "From" : "In"} ${p.place.name}` : "",
    p.time ? `Time: ${p.time.label}` : "",
    p.level ? (p.level === "qual" ? "Qualification matches" : "Playoff matches") : "",
    p.alliance ? `${p.alliance === "red" ? "Red" : "Blue"} alliance` : "",
    p.award ? `Award: ${p.award}` : "",
    p.n != null ? `Limit: ${p.n}` : "",
  ].filter(Boolean);
}
