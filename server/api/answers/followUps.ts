// People also ask (the owner's follow-ups brief, §1a): the next questions after a search, from what search read in it (its
// teams, event, place, time and award) and the questions it already answers. Nothing here answers anything: each
// candidate is run as a search, the same kept answer a tap on it opens (pageAnswer), and shown only when that answer
// is a direct one: never a sorry, a fallback, a weak guess or a list of names. Its preview is that answer's own
// headline, so the numbers are the ones the linked page shows. No team, event or year is written here: the words come
// from the query as typed, the answer and the lexicon.
import type { SearchAnswer, SearchFollowUp, SearchFollowUps } from "../../../src/shared/api.js";
import { ASK_MAX, FOLLOW_BUDGET_MS, SEARCH_PAGE_LIMIT } from "../../../src/shared/search.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { normalise, parseQuery, type Parsed } from "../query/parse.js";
import { parseContext } from "../query/context.js";
import { names } from "../query/names.js";
import { AWARD_WORDS, LEXICON } from "../query/lexicon.js";
import { keptAnswer, searchVersion } from "../searchReads.js";
import { searchAnswer } from "../searchAnswer.js";
import { loneTeamHit } from "../searchLayers.js";
import { forecasterBuilds } from "../../predict/engine.js";
import { failureOf, outcomeTrace } from "../../searchFailures.js";

type Family = SearchFollowUp["family"];

/** The whole answer for `q` as /api/search?answer=1 gives it, kept a minute: a follow-up checked here is the answer its
 *  tap opens. */
export const pageAnswer = (q: string, limit: number, prefer: ReadonlySet<string>): Promise<SearchAnswer> =>
  keptAnswer(JSON.stringify([q, limit, [...prefer].sort(), forecasterBuilds()]), () => searchAnswer(q, { limit, prefer }));

/** The kept follow-ups' key for `q` and `prefer`. */
const followKey = (q: string, prefer: ReadonlySet<string>) => JSON.stringify(["follow", q, [...prefer].sort(), forecasterBuilds()]);
/** The follow-up sets being made right now, by key: what each has so far (followUps' Progress), for followUpsWithin. */
const making = new Map<string, Progress>();

/** The follow-ups for `q` with its own kept answer (followUps), kept a minute as the answer is: the /search page's
 *  first paint and the app's /api/search/follow for the same search are one reading. */
export const keptFollowUps = (q: string, prefer: ReadonlySet<string> = new Set()): Promise<SearchFollowUps> => {
  const key = followKey(q, prefer);
  return keptAnswer(key, async () => {
    const progress: Progress = {};
    making.set(key, progress);
    try { return await followUps(q, await pageAnswer(q, SEARCH_PAGE_LIMIT, prefer), prefer, progress); } finally { if (making.get(key) === progress) making.delete(key); }
  });
};

/** The follow-ups for `q` within `ms`: the whole kept set when it's ready by then, else what's been checked so far,
 *  marked `partial` (never kept: the whole set is still being made, and is kept once it's done). */
export async function followUpsWithin(q: string, prefer: ReadonlySet<string> = new Set(), ms = FOLLOW_BUDGET_MS): Promise<SearchFollowUps> {
  // Made ahead for this search index (precomputeFollowUps): served at once, nothing made while anyone waits.
  const early = await aheadOf(followKey(q, prefer));
  if (early) return early;
  const whole = keptFollowUps(q, prefer);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((ok) => { timer = setTimeout(ok, ms, null); });
  const got = await Promise.race([whole, late]).finally(() => clearTimeout(timer));
  if (got) return got;
  // Still being made: its checks go on (a failure is the whole set's, met by the next ask).
  whole.catch(() => {});
  const now = making.get(followKey(q, prefer))?.now?.();
  return { ask: [], related: [], ...now, partial: true };
}

/** Follow-up sets made ahead of time for the most-asked searches (precomputeFollowUps, the search audit's S9), by key,
 *  each with the search index version it was made under ("search:version", moved by each stats run). */
const ahead = new Map<string, { version: string; value: SearchFollowUps }>();

/** The set made ahead under `key` for the search index in use, if there is one. */
async function aheadOf(key: string): Promise<SearchFollowUps | undefined> {
  const a = ahead.get(key);
  return a && a.version === (await searchVersion()) ? a.value : undefined;
}

/** Make the follow-ups of each of `qs` (searches any visitor shares: no preferred teams) ahead of time, for the search
 *  index in use, one set at a time with every check of theirs `later` (behind every live search's questions), so
 *  People also ask for the most-asked searches is there at once. Sets made for an older index are dropped once these
 *  are made. Stops early (keeping what's made) if the index moves meanwhile. Returns how many were made. */
export async function precomputeFollowUps(qs: readonly string[]): Promise<number> {
  const version = await searchVersion();
  const none: ReadonlySet<string> = new Set();
  let made = 0;
  for (const q of qs) {
    if ((await searchVersion()) !== version) break;
    try {
      const value = await followUps(q, await pageAnswer(q, SEARCH_PAGE_LIMIT, none), none, undefined, true);
      ahead.set(followKey(q, none), { version, value });
      made++;
    } catch { /* the next one */ }
  }
  for (const [k, v] of ahead) if (v.version !== version) ahead.delete(k);
  return made;
}

/** How many sets are made ahead right now (tests). */
export const aheadCount = () => ahead.size;

/** At most this many questions are shown, and this many candidates run to find them. */
export { ASK_MAX };
export const RELATED_MAX = 8;
const CHECK_MAX = 16;
/** A search that names nothing (START's starting points): its questions are START's first ASK_MAX and its related
 *  searches the next, so no more are checked than can be shown (ASK_MAX and RELATED_MAX, not CHECK_MAX each: the search audit's S2). */
const START_ASK_CHECK = ASK_MAX, START_RELATED_CHECK = RELATED_MAX;
/** At most this many of the searches the page already offers are read, to leave out questions that repeat them. */
const SHOWN_MAX = 8;

type Slots = { t?: number; u?: number; event?: string; place?: string; when?: string; award?: string };
type Template = { family: Family; needs: (keyof Slots)[]; ask: (s: Required<Slots>) => string; short: (s: Required<Slots>) => string; when?: boolean; chip?: boolean; list?: boolean };
/** A follow-up two ways: a question (People also ask) and the search's short form (Related searches). */
const T = (family: Family, needs: (keyof Slots)[], ask: Template["ask"], short: Template["short"], when = false): Template => ({ family, needs, ask, short, when });
/** The words a time is typed with that already say how it's placed ("in <season>", "last season", "this year"). */
const PLACED = /^(?:in|during|for|from|at|of|this|last|next|the|current|previous|past)\b/i;
/** " in <time>" when the query said one and the question is about one season: "in" only when the time typed doesn't
 *  already say how it's placed ("… in <season>", "… last season"). */
const IN = (s: Slots) => (!s.when ? "" : PLACED.test(s.when) ? ` ${s.when}` : ` in ${s.when}`);
const AT = (s: Slots) => (s.when ? ` ${s.when}` : "");

// In the order they're offered: the questions nearest a search about a team first (its numbers, record and rating),
// then its awards, matches and events. Each says the time the query said, when it's a season's question.
const TEAM: Template[] = [
  T("team", ["t"], (s) => `What is ${s.t}'s OPR${IN(s)}?`, (s) => `${s.t} opr${AT(s)}`, true),
  T("team", ["t"], (s) => `What is ${s.t}'s record${IN(s)}?`, (s) => `${s.t} record${AT(s)}`, true),
  T("predict", ["t"], (s) => `What is ${s.t}'s rating${IN(s)}?`, (s) => `${s.t} rating${AT(s)}`, true),
  T("awards", ["t"], (s) => `What awards has ${s.t} won?`, (s) => `${s.t} awards`),
  T("team", ["t"], (s) => `When did ${s.t} last play?`, (s) => `${s.t} last match`),
  T("events", ["t"], (s) => `How many events has ${s.t} played?`, (s) => `${s.t} events played`),
  T("team", ["t"], (s) => `What is ${s.t}'s highest score${IN(s)}?`, (s) => `${s.t} highest score${AT(s)}`, true),
  T("team", ["t"], (s) => `Who is ${s.t}'s best alliance partner?`, (s) => `${s.t} best alliance partner`),
  T("events", ["t"], (s) => `Has ${s.t} been to Worlds?`, (s) => `${s.t} worlds appearances`),
  T("team", ["t"], (s) => `What is ${s.t}'s win rate${IN(s)}?`, (s) => `${s.t} win rate${AT(s)}`, true),
  T("team", ["t"], (s) => `What is ${s.t}'s average score${IN(s)}?`, (s) => `${s.t} average score${AT(s)}`, true),
  T("team", ["t"], (s) => `Is ${s.t}'s OPR going up?`, (s) => `${s.t} opr trend`),
  T("team", ["t"], (s) => `What is ${s.t}'s longest win streak?`, (s) => `${s.t} longest win streak`),
  T("team", ["t"], (s) => `How many matches has ${s.t} played?`, (s) => `${s.t} total matches`),
  T("events", ["t"], (s) => `When is ${s.t}'s next event?`, (s) => `${s.t} next event`),
  T("team", ["t"], (s) => `What was ${s.t}'s biggest win?`, (s) => `${s.t} biggest win`),
  T("events", ["t"], (s) => `What was ${s.t}'s best finish?`, (s) => `${s.t} best finish`),
  T("team", ["t"], (s) => `What was ${s.t}'s best season?`, (s) => `${s.t} best season`),
  T("team", ["t"], (s) => `What is ${s.t}'s current streak?`, (s) => `${s.t} current streak`),
  T("events", ["t"], (s) => `What was ${s.t}'s first event?`, (s) => `${s.t} first event`),
];
// A season's numbers (OPR, record) say the season the query said, as one team's do; a prediction and the
// head-to-head are about every meeting, never one season's.
const TWO: Template[] = [
  T("compare", ["t", "u"], (s) => `Who has the higher OPR${IN(s)}, ${s.t} or ${s.u}?`, (s) => `${s.t} vs ${s.u} opr${AT(s)}`, true),
  T("predict", ["t", "u"], (s) => `Who would win, ${s.t} or ${s.u}?`, (s) => `${s.t} vs ${s.u} prediction`),
  T("compare", ["t", "u"], (s) => `Who has the better record${IN(s)}, ${s.t} or ${s.u}?`, (s) => `${s.t} vs ${s.u} record${AT(s)}`, true),
  T("compare", ["t", "u"], (s) => `How has ${s.t} done against ${s.u}?`, (s) => `${s.t} vs ${s.u} head to head`),
];
const EVENT: Template[] = [
  T("events", ["event"], (s) => `Who won ${s.event}${IN(s)}?`, (s) => `who won ${s.event}${AT(s)}`),
  T("events", ["event"], (s) => `What were the best matches at ${s.event}${IN(s)}?`, (s) => `${s.event}${AT(s)} highlights`),
  // A list question: its preview says how many teams, the first of them after (never one team as if it were the answer).
  { ...T("events", ["event"], (s) => `Which teams played at ${s.event}${IN(s)}?`, (s) => `teams at ${s.event}${AT(s)}`), list: true },
  T("events", ["event"], (s) => `Who were the top teams at ${s.event}${IN(s)}?`, (s) => `top teams at ${s.event}${AT(s)}`),
];
const AWARD_AT: Template = T("awards", ["event", "award"], (s) => `Who won the ${s.award} Award at ${s.event}${IN(s)}?`, (s) => `${s.award} award at ${s.event}${AT(s)}`);
const PLACE: Template[] = [
  T("leaders", ["place"], (s) => `Who are the top teams in ${s.place}?`, (s) => `top teams in ${s.place}`),
  T("leaders", ["place"], (s) => `Which team has the highest OPR in ${s.place}?`, (s) => `highest opr in ${s.place}`),
  T("leaders", ["place"], (s) => `Who has the highest rating in ${s.place}?`, (s) => `highest rated in ${s.place}`),
  T("team", ["place"], (s) => `How many teams are in ${s.place}?`, (s) => `teams in ${s.place}`),
  T("leaders", ["place"], (s) => `What is the highest score in ${s.place}?`, (s) => `highest score in ${s.place}`),
  T("events", ["place"], (s) => `What events are coming up in ${s.place}?`, (s) => `upcoming events in ${s.place}`),
  T("events", ["place"], (s) => `What events are this week in ${s.place}?`, (s) => `events this week in ${s.place}`),
  T("events", ["place"], (s) => `What events are in ${s.place}?`, (s) => `events in ${s.place}`),
];
// A leaderboard's neighbours: the same teams ranked by each other number a board ranks by, in the place and season the
// board was asked for, the board itself left out by its answer. They're Related searches' chips, never questions: one
// tap from one board to the next.
const BOARDS: [string, string][] = [["Auto OPR", "auto opr"], ["TeleOp OPR", "teleop opr"], ["Endgame OPR", "endgame opr"], ["OPR", "opr"], ["prediction rating", "rated"]];
const IN_PLACE = (s: Slots) => (s.place ? ` in ${s.place}` : "");
const LEADERS: Template[] = BOARDS.map(([label, words]) =>
  ({ ...T("leaders", [], (s) => `Who has the best ${label}${IN_PLACE(s)}${IN(s)}?`, (s) => `${words === "rated" ? "highest rated teams" : `best ${words}`}${IN_PLACE(s)}${AT(s)}`), chip: true }));

// A search that names nothing (a list of upcoming events, a season's leaders): the season's starting points.
const START: Template[] = [
  T("leaders", [], () => "Who are the top teams?", () => "top teams"),
  T("leaders", [], () => "Which team has the highest OPR?", () => "highest opr"),
  T("leaders", [], () => "What is the highest score this season?", () => "highest score"),
  T("events", [], () => "What events are coming up?", () => "upcoming events"),
  T("events", [], () => "What events are this week?", () => "events this week"),
  T("events", [], () => "What events are happening today?", () => "live events"),
  // Past the questions' six: the season's other boards and weeks, Related searches' chips.
  T("leaders", [], () => "Who has the best Auto OPR?", () => "best auto opr"),
  T("leaders", [], () => "Who has the best TeleOp OPR?", () => "best teleop opr"),
  T("leaders", [], () => "Who has the best Endgame OPR?", () => "best endgame opr"),
  T("leaders", [], () => "Which team has the best record?", () => "best record"),
  T("events", [], () => "What events are next week?", () => "events next week"),
  T("events", [], () => "What events have already happened?", () => "past events"),
  T("events", [], () => "What championships are coming up?", () => "upcoming championships"),
  T("events", [], () => "What events are this weekend?", () => "events this weekend"),
];

/** START's questions, to tell a search's starting points from its own follow-ups. */
const START_QS = new Set(START.map((x) => x.ask({} as Required<Slots>)));
/** The season's starting points as candidates, less the search `q` itself. */
const starts = (q: string): Candidate[] => {
  const n = normalise(q);
  return START.map((x) => ({ q: x.ask({} as Required<Slots>), short: x.short({} as Required<Slots>), family: x.family })).filter((x) => normalise(x.q) !== n && normalise(x.short) !== n);
};

/** The Worlds phrases the lexicon reads, longest first ("first championship" before "first"). */
const WORLDS = LEXICON.filter((e) => e.syms.some((x) => x.k === "worlds")).map((e) => e.words.join(" ")).sort((a, b) => b.length - a.length);
/** FTC's own words (every word of the lexicon's phrases: "alliance", "auto", "worlds"). A place or event typed as one
 *  of them alone ("if I change the alliance": Alliance, Nebraska) is the word, not the place: no follow-up names it. A
 *  name of two or more words ("High Point", "New Jersey") was meant, and so was a state or country, read only from its
 *  own names and codes ("in IN": Indiana): only a town or an event can be a word too. */
const FTC_WORDS = new Set(LEXICON.flatMap((e) => e.words));
const meant = (typed: string | undefined) => !!typed && (/\s/.test(typed.trim()) || !FTC_WORDS.has(normalise(typed)));

/** The awards a question can name in one word ("Think"), in the lexicon's order. */
const AWARDS = AWARD_WORDS.map(([, type]) => type).filter((type) => /^[A-Z][a-z]+$/.test(type));

/** A follow-up as a question and as the search's short form. */
export type Candidate = { q: string; short: string; family: Family; chip?: boolean; list?: boolean };

/** The team an answer is about when the query named none ("who won inspire at …": the winner). */
function answerTeam(a: SearchAnswer): number | undefined {
  // A filtered list ("teams from texas with opr over 50") answers with many teams: its first row is no team it's about.
  if (a.intent?.kind.startsWith("stat-compound-list")) return undefined;
  // A leaderboard's team is its first row, the headline's link.
  const led = /^\/teams\/(\d+)(?:[?#]|$)/.exec(a.stat?.headline?.href ?? "");
  // One award asked about ("Innovate award at …"): its winner, never the first of the event's other awards.
  const won = a.card?.award ? (a.card.lines.find((l) => l.results?.includes("Winner") && !/Finalist/i.test(l.detail ?? "")) ?? a.card.lines[0]) : undefined;
  const wonTeam = /^\/teams\/(\d+)(?:[?#]|$)/.exec(won?.href ?? "");
  if (a.card?.award) return wonTeam ? Number(wonTeam[1]) : undefined;
  return a.stat?.team?.number ?? a.stat?.teams?.[0]?.number ?? a.card?.team?.number ?? a.card?.awards?.[0]?.team ?? (led ? Number(led[1]) : undefined);
}

/** The candidates for a query read as `p` with answer `a`, in the order they're offered. */
export function candidates(p: Parsed, a: SearchAnswer, team = answerTeam(a)): Candidate[] {
  const n = normalise(p.q);
  const worlds = p.worlds ? WORLDS.find((w) => ` ${n} `.includes(` ${w} `)) : undefined;
  // A league's standings answer named a league, not an event ("nj league standings" is no event called "Nj League").
  const league = a.intent?.kind === "stat-league-standings";
  const said = league ? undefined : (meant(p.event?.typed) ? p.event?.typed : undefined) ?? worlds;
  // As typed, or in title case when typed all in lower case ("north league meet" → "North League Meet").
  const event = said && said === said.toLowerCase() ? said.replace(/(?<![\p{L}\p{N}'])\p{L}/gu, (c) => c.toUpperCase()) : said;
  const teams = p.teams.map((t) => t.number);
  // A place read from the words that a card answered without ("… in one season" read as a town named One) is never
  // asked about: a board's place is on its title or chips. Other cards name no place, so a place meant is asked about.
  const shown = a.stat?.family === "leaderboard" ? `${a.stat.title} ${a.stat.scope.join(" ")}`.toLowerCase() : null;
  // A town is asked about only when its name was meant as one.
  const place = p.place && (p.place.kind !== "city" || meant(p.place.typed)) && (shown == null || shown.includes(p.place.name.toLowerCase())) ? p.place.name : undefined;
  const s: Slots = {
    t: teams[0] ?? team, u: teams[1], event, place,
    // A season said (a year, a season's two years): a window ("this week") or every season is no season's question.
    when: p.time?.kind === "season" ? p.time.typed : undefined,
    award: p.award ?? undefined,
  };
  // An event's time is the event's ("<event> <year>"), never a season of the team's questions.
  const teamWhen = event ? undefined : s.when;
  const fill = (list: Template[], slots: Slots) => list
    .filter((x) => x.needs.every((k) => slots[k] != null))
    .map((x) => {
      const filled = { ...(slots as Required<Slots>), when: (x.needs.includes("t") ? (x.when ? teamWhen : undefined) : slots.when) ?? "" };
      return { q: x.ask(filled), short: x.short(filled), family: x.family, ...(x.chip ? { chip: true } : {}), ...(x.list ? { list: true } : {}) };
    });
  // Every award an event gives, its winner's question first: those the questions don't take are Related searches.
  const [award1, ...awards] = event ? AWARDS.filter((x) => x !== s.award).flatMap((award) => fill([AWARD_AT], { ...s, award })) : [];
  const out = [
    ...(s.u != null ? fill(TWO, s) : []),
    // A board's neighbours; a filtered list's too ("teams from texas with opr over 50": the place's boards, best auto
    // opr in Texas …), so its related searches are about the place it asked about, never one team in the list.
    ...(p.intent === "leaderboard" || a.intent?.kind.startsWith("stat-compound-list") ? fill(LEADERS, s) : []),
    ...(event ? fill(EVENT, s) : []),
    ...(award1 ? [award1] : []),
    ...(s.place ? fill(PLACE, s) : []),
    ...(s.t != null ? fill(TEAM, s) : []),
    // The second team's own, after the first's; an event's other awards after its winner's questions.
    ...(s.u != null ? fill(TEAM, { ...s, t: s.u }) : []),
    ...awards,
    ...(s.t == null && !event && !s.place && p.intent !== "leaderboard" ? fill(START, s) : []),
  ];
  return out.filter((x) => normalise(x.q) !== n && normalise(x.short) !== n);
}

type Line = Pick<SearchFollowUp, "value" | "rest" | "tone">;

/** A season said in words: a season's two years ("<year>–<yy>"), "all seasons", "over N seasons", "this season". */
const SAYS_SEASON = /\d{4}[–-]\d{2}|\bseasons?\b/i;
/** One season's two years, alone. */
const ONE_SEASON = /^\d{4}[–-]\d{2}$/;
/** The season a line's numbers are from, said after it when the line itself doesn't say one (a rating's line ends
 *  "· <season>"): one follow-up's numbers are often another season's than the next one's (a record from the
 *  latest completed season, a trend from the current one), so each says which. `said`: the answer's own words for it
 *  (a stat's season chip, "All seasons"), else a card's season. */
function withSeason(l: Line, said: string | undefined): Line {
  if (!said || SAYS_SEASON.test(`${l.value} ${l.rest}`)) return l;
  const season = /^all seasons$/i.test(said) ? "all seasons" : said;
  return { ...l, rest: l.rest ? `${l.rest} · ${season}` : season };
}

/** One line from a direct answer, its number apart from the rest, or null when `a` isn't one (no answer card,
 *  nothing found, a list of names). */
export function lineOf(a: SearchAnswer, list = false): Line | null {
  if (a.sorry || a.weak || a.understood?.fallback) return null;
  if (a.verdict) return { value: a.verdict.answer, rest: a.verdict.label, tone: { verdict: a.verdict.answer } };
  const st = a.stat;
  if (st) {
    if (st.none || !st.headline?.value) return null;
    // A list question ("which teams played at …"): how many its answer lists, then the first, so the preview never
    // reads as one team being the whole answer.
    if (list && st.listed != null && st.listed > 0) return { value: `${st.listed.toLocaleString("en-US")} ${st.listed === 1 ? "team" : "teams"}`, rest: `first: ${st.headline.value}, ${st.headline.label}`, tone: { count: true } };
    // The teams its card draws: two or more as the card lists them, else the one it's about.
    const teams = (st.teams && st.teams.length > 1 ? st.teams : st.team ? [st.team] : []).map((t) => t.number);
    // The headline's own season when the line under it says one on its own (a single match's: "<season> · <date>"),
    // which an all-season answer narrows to; else the answer's season chip.
    const own = st.headline.sub?.split(" · ").map((x) => x.trim()).find((x) => ONE_SEASON.test(x));
    const chip = own ?? st.scope.find((x) => SAYS_SEASON.test(x));
    return withSeason({ value: st.headline.value, rest: st.headline.label, tone: { stat: { intent: st.intent, family: st.family, ...(st.split != null ? { split: st.split } : {}), teams } } }, chip);
  }
  const c = a.card;
  if (c) {
    const first = c.lines[0];
    const season = c.season != null ? seasonLabel(c.season) : undefined;
    if (c.headline) return withSeason({ value: c.headline, rest: "", tone: { card: c.kind } }, season);
    return first?.text ? withSeason({ value: first.text, rest: first.detail ?? "", tone: { card: c.kind } }, season) : null;
  }
  const u = a.understood;
  // As many events as its page lists (and its tabs count), never more than the page will show.
  const listed = a.hits.filter((h) => h.kind === "event").length;
  if (u?.kind === "events" && u.total && listed) {
    const n = Math.min(u.total, listed);
    return { value: `${n.toLocaleString("en-US")} event${n === 1 ? "" : "s"}`, rest: u.label, tone: { count: true } };
  }
  return null;
}

/** The line as one string ("26-6-0 · 81% win rate …"), or null. */
export function previewOf(a: SearchAnswer): string | null {
  const l = lineOf(a);
  return l && [l.value, l.rest].filter(Boolean).join(" · ");
}

/** The words a board's title says only how it's worded ("Best team …", "Top 10 teams …"): its direction ("Lowest"),
 *  measure, filters, place and season are the rest. */
const BOARD_WORDING = new Set(["best", "top", "team", "teams", "in", "by", "the"]);
/** What an answer answers: two candidates with the same are one question asked twice, and one with the search's own is
 *  the search again. A board is the words of its title that aren't wording, in any order: "Best team in New Jersey by
 *  OPR" and "Top 10 teams by OPR in New Jersey" are one board, "Lowest 10 teams by OPR" another. */
export const answerKey = (a: SearchAnswer) => {
  if (a.stat?.family === "leaderboard") {
    const words = a.stat.title.toLowerCase().split(/[^\p{L}\p{N}–-]+/u).filter((w) => w && !BOARD_WORDING.has(w) && !/^\d+$/.test(w));
    return `${a.stat.intent}|${[...new Set(words)].sort().join(" ")}`;
  }
  return `${a.stat?.intent ?? a.card?.kind ?? a.understood?.kind}|${a.stat?.title ?? a.card?.title ?? a.understood?.label}`;
};

/** An event named by its initials typed in lower case ("mti") is said in capitals ("Who won MTI?"), never title case. */
export async function initialsUpper(p: Parsed): Promise<Parsed> {
  const typed = p.event?.typed;
  if (!typed || /\s/.test(typed) || typed !== typed.toLowerCase() || !(await names()).initialism(typed).length) return p;
  return { ...p, event: { ...p.event!, typed: typed.toUpperCase() } };
}

/** The follow-ups for `q` (its own answer `a`): People also ask, up to ASK_MAX questions, and Related searches, up to
 *  RELATED_MAX short searches about what the questions didn't cover. Each is one search answers directly, with its
 *  answer's own line; none answers what another, the search itself or one the page already offers does. Only the
 *  first CHECK_MAX candidates are run for each: fewer follow-ups, never a slower page. */
export async function followUps(q: string, a: SearchAnswer, prefer: ReadonlySet<string> = new Set(), progress?: Progress, background = false): Promise<SearchFollowUps> {
  const read = await initialsUpper(await parseQuery(q, await parseContext(Date.now(), prefer)));
  // A name several teams still share holds an arbitrary first one: no follow-up is about it (../query/shared.ts).
  // A number the answer read as something else is no team: when the answer says how it read the query (its intent's
  // pattern) and that reading has no [team] in it, the parser's teams aren't what it answered ("teams from texas with
  // opr over 50" is a board with a threshold, never a search about team 50).
  const teamless = a.intent?.pattern != null && !a.intent.pattern.includes("[team]");
  const p = { ...read, teams: teamless ? [] : read.teams.filter((t) => !t.candidates || t.rule) };
  // The searches the page already offers (a sorry note's, a team fallback's, the answer's own related ones): asked
  // again in other words, they'd be offered twice. Their answers, kept the same way, say what they answer.
  // A sorry about no team ("weather in paris"): the season's starting points, the same short list for every such
  // search, so their checks are the kept answers of the last one (the search audit's S5); a place or name it read is
  // in the sorry note's own searches already. A sorry about a team keeps that team's questions.
  const fixed = !!a.sorry && p.teams.length === 0 && answerTeam(a) == null;
  const shown = fixed ? [] : [...new Set([...(a.suggest ?? []), ...(a.sorry?.suggest ?? []), ...(a.stat?.blocks ?? []).flatMap((b) => (b.kind === "related" ? b.queries : []))])].slice(0, SHOWN_MAX);
  const all = fixed ? starts(q) : candidates(p, a);
  // The season's starting points (a search about nothing): only as many checked as can be shown.
  const start = all.length > 0 && all.every((c) => START_QS.has(c.q));
  // This search's own lane in the line (inTurns): its checks take turns with every other search's, one each, so one
  // visitor's 40 checks never hold another's behind them. Its related searches and highlights, shown after its
  // questions, wait for every search's questions first (`later`).
  const lane = `f${++lanes}`;
  // Made ahead (`background`: precomputeFollowUps): every check `later`, behind live searches' questions.
  const run = (x: string, later = false) => inTurns(() => pageAnswer(x, SEARCH_PAGE_LIMIT, prefer), lane, later || background).catch(() => null);
  const askC = all.filter((c) => !c.chip).slice(0, start ? START_ASK_CHECK : CHECK_MAX).map((c) => ({ ...c, run: c.q }));
  // Each check's answer as it comes (undefined: still to run), for what's been checked so far (progress).
  const askDone: (SearchAnswer | null | undefined)[] = askC.map(() => undefined);
  const offDone: (SearchAnswer | null | undefined)[] = shown.map(() => undefined);
  // The page's own searches first (read only to leave out questions that repeat them), then the questions: in one
  // lane they run in this order, so any question checked so far is checked against all of them, and what's sent
  // partial is always the first of the whole set's questions.
  const offP = shown.map((x, i) => run(x).then((y) => (offDone[i] = y)));
  const askP = askC.map((c, i) => run(c.run).then((x) => (askDone[i] = x)));
  const seenOf = (offered: (SearchAnswer | null | undefined)[]) => new Set([a, ...offered].flatMap((x) => (x ? [answerKey(x).toLowerCase()] : [])));
  const view = (x: Omit<SearchFollowUp, "q"> & { run: string }): SearchFollowUp => ({ q: x.run, family: x.family, preview: x.preview, value: x.value, rest: x.rest, tone: x.tone });
  // The team's standout matches, beside the answer on a wide screen: the team asked about, else the one its answer is
  // about; none for a search about no team, nor for a team searched alone, whose page answer is already its
  // highlights (../searchPageAnswer.ts withHighlights): the same search twice (the search audit's S2).
  const about = p.teams[0]?.number ?? answerTeam(a);
  const lone = loneTeamHit(a);
  const lights = about != null && !(lone && Number(lone.ref) === about);
  // What's been checked so far: the questions up to the first still running (they run in order, after the page's
  // own searches, so these are the first of the whole set's).
  if (progress) progress.now = () => {
    const upto = askDone.indexOf(undefined);
    const done = upto < 0 ? askDone.length : upto;
    const ask = fresh(pickFrom(askC.slice(0, done), askDone.slice(0, done)), seenOf(offDone), ASK_MAX);
    return { ask: ask.map(view), related: [], ...(about != null ? { about } : {}) };
  };
  const [offered, answered] = await Promise.all([Promise.all(offP), Promise.all(askP)]);
  const seen = seenOf(offered);
  const ask = fresh(pickFrom(askC, answered), seen, ASK_MAX);
  // What the questions didn't take, as short searches: never a question's answer again. Only about what the search
  // itself is about (its teams, the team its answer is about): never a team that only a question's answer named (a
  // leaderboard's first, from "top teams" asked under "upcoming events").
  const taken = new Set(ask.map((x) => x.q));
  const rest = all.filter((c) => !taken.has(c.q)).slice(0, start ? START_RELATED_CHECK : CHECK_MAX).map((c) => ({ ...c, run: c.short }));
  // The highlights run beside the related searches; a related search still comes first to an answer they share.
  const later = (x: string) => run(x, true);
  const [picked, lit] = await Promise.all([pick(rest, later), lights ? pick([{ q: "", short: "", family: "team" as const, run: `${about} highlights` }], later) : []]);
  const related = fresh(picked, seen, RELATED_MAX);
  const [best] = fresh(lit, seen, 1);
  return { ask: ask.map(view), related: related.map(view), ...(best ? { highlights: { ...view(best), team: about! } } : {}), ...(about != null ? { about } : {}) };
}

/** What a follow-up set has so far while it's being made (followUps sets `now`): its questions checked so far. */
export type Progress = { now?: () => SearchFollowUps };
/** Lanes handed out so far (one per follow-up set made). */
let lanes = 0;

/** `f`, its calls run one at a time in the order made, each after this process has looked at what else is waiting
 *  (other visitors' requests, timers). The database answers without ever giving the event loop back (its reads
 *  resolve as microtasks), so the up to 40 searches checked for one search's follow-ups, all asked at once, held this
 *  process for their whole run, 2 to 4 seconds, and every other request waited behind them. One at a time with a turn
 *  of the loop between them, a request that comes in meanwhile waits for one search at most. The same searches run
 *  either way, each the same kept answer: only when they run changes. */
export function inTurn<A extends unknown[], R>(f: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let last: Promise<unknown> = Promise.resolve();
  return (...args) => {
    const next = last.then(() => new Promise<void>((go) => setImmediate(go))).then(() => f(...args));
    last = next.catch(() => {});
    return next;
  };
}

type Job = { task: () => Promise<unknown>; settle: (p: Promise<unknown>) => void; at: number };
/** The checks waiting, by priority (now, later): a queue per lane (one search's follow-ups), lanes in turn order. */
const waiting: [Map<string, Job[]>, Map<string, Job[]>] = [new Map(), new Map()];
let turning = false;

/** Answers being made right now (holdChecks), and the turns waiting for them to be done. */
let answering = 0;
const resumes = new Set<() => void>();
/** How long a check waits for the answers being made before it runs anyway, so a steady stream of answers never
 *  starves People also ask. */
const ANSWER_FIRST_MS = FOLLOW_BUDGET_MS / 4;
/** How long a `later` check waits for the checks that aren't before it runs anyway, so a steady stream of searches
 *  never starves the related searches and highlights (each set is done only once they are). */
const LATER_FIRST_MS = FOLLOW_BUDGET_MS * 2;
/** When a follow-up check was first held back for the answers being made (0: none is): held ones wait
 *  ANSWER_FIRST_MS from then at most, however many of the answers' own checks run meanwhile. */
let heldSince = 0;

/** A search's answer is being made (/api/search): follow-up checks wait until it's done (up to ANSWER_FIRST_MS each),
 *  so a visitor's answer is never slowed by other searches' People also ask. Returns the release (safe to call more
 *  than once). */
export function holdChecks(): () => void {
  answering++;
  let on = true;
  return () => {
    if (!on) return;
    on = false;
    if (--answering === 0) wake();
  };
}

/** Whether a lane other than the default one has a check waiting. */
const othersWaiting = () => waiting.some((line) => [...line.keys()].some((lane) => lane !== ""));

/** The next check, or none to run now. Held (an answer being made, and no follow-up check held back ANSWER_FIRST_MS
 *  yet): only the default lane's (an answer's own checks). Else the first lane's of the highest priority with one
 *  waiting, that lane then going to the back; `later` ones first once one has waited LATER_FIRST_MS. */
function nextJob(now: number): Job | undefined {
  if (othersWaiting() && answering > 0) heldSince ||= now;
  const held = answering > 0 && heldSince > 0 && now - heldSince < ANSWER_FIRST_MS;
  const aged = [...waiting[1].values()].some((jobs) => now - jobs[0].at >= LATER_FIRST_MS);
  for (const line of aged ? [waiting[1], waiting[0]] : waiting) for (const [lane, jobs] of line) {
    if (held && lane !== "") continue;
    const job = jobs.shift()!;
    line.delete(lane);
    if (jobs.length) line.set(lane, jobs);
    // A follow-up check runs: none has been held back since before it.
    if (lane !== "") heldSince = 0;
    return job;
  }
  return undefined;
}

/** One check, after a turn of the loop; then the next. */
function turn(): void {
  if (turning) return;
  turning = true;
  setImmediate(go);
}

function go(): void {
  const job = nextJob(Date.now());
  if (!job) {
    // Only held checks are waiting: run them once the answers are done, their wait is up, or an answer's own comes.
    if (othersWaiting()) { resumeLater(); return; }
    turning = false;
    return;
  }
  const p = Promise.resolve().then(job.task);
  job.settle(p);
  p.catch(() => {}).finally(() => { turning = false; turn(); });
}

/** Wake a turn that's waiting (resumeLater). */
function wake(): void {
  for (const f of [...resumes]) f();
}

/** Go on once no answer is being made, ANSWER_FIRST_MS after the first held check was held back, or an answer's own
 *  check comes, whichever is first. */
function resumeLater(): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    resumes.delete(once);
    go();
  };
  const timer = setTimeout(once, Math.max(0, heldSince + ANSWER_FIRST_MS - Date.now()));
  resumes.add(once);
}

/** The one line every follow-up check in this process takes its turn in, one check at a time with a turn of the loop
 *  before each (as inTurn), so two checks never run in the same turn. Fair between searches: each `lane` (one search's
 *  follow-ups) takes one check in turn with every other lane waiting, so a visitor's first questions never wait behind
 *  another's 40 checks (one first-come line made four searches at once wait 6.7–7.3 s each: the search audit's S1).
 *  `later`: run once no lane has a check that isn't, or after LATER_FIRST_MS (related searches, highlights and
 *  background builds). The default lane is an answer's own checks: never held for the answers being made. The same
 *  searches run either way, each the same kept answer: only when they run changes. */
export function inTurns<T>(task: () => Promise<T>, lane = "", later = false): Promise<T> {
  return new Promise<T>((ok, no) => {
    const line = waiting[later ? 1 : 0];
    const job: Job = { task, settle: (p) => { (p as Promise<T>).then(ok, no); }, at: Date.now() };
    const jobs = line.get(lane);
    if (jobs) jobs.push(job); else line.set(lane, [job]);
    if (lane === "") wake();
    turn();
  });
}

/** The first `max` of `xs` whose answers none before them (nor `seen`) gives, each added to `seen`. */
function fresh<X extends { key: string }>(xs: X[], seen: Set<string>, max: number): X[] {
  const out: X[] = [];
  for (const x of xs) if (out.length < max && !seen.has(x.key)) { seen.add(x.key); out.push(x); }
  return out;
}

/** The candidates (each run as `run`) whose answer is a direct one, in order, each with its preview and answer key. */
async function pick<C extends Candidate & { run: string }>(cs: C[], run: (q: string) => Promise<SearchAnswer | null>) {
  return pickFrom(cs, await Promise.all(cs.map((c) => run(c.run))));
}

/** As pick, from the candidates' answers (`answers[i]` is `cs[i]`'s; null or undefined: none). */
function pickFrom<C extends Candidate & { run: string }>(cs: C[], answers: (SearchAnswer | null | undefined)[]) {
  return cs.flatMap((c, i) => {
    const ans = answers[i];
    const line = ans && !failureOf(c.run, ans, outcomeTrace(ans)) ? lineOf(ans, !!c.list) : null;
    return ans && line ? [{ ...c, ...line, preview: [line.value, line.rest].filter(Boolean).join(" · "), key: answerKey(ans).toLowerCase() }] : [];
  });
}
