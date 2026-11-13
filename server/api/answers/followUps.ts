// People also ask (the owner's follow-ups brief, §1a): the next questions after a search, from what search read in it (its
// teams, event, place, time and award) and the questions it already answers. Nothing here answers anything: each
// candidate is run as a search, the same kept answer a tap on it opens (pageAnswer), and shown only when that answer
// is a direct one: never a sorry, a fallback, a weak guess or a list of names. Its preview is that answer's own
// headline, so the numbers are the ones the linked page shows. No team, event or year is written here: the words come
// from the query as typed, the answer and the lexicon.
import type { SearchAnswer, SearchFollowUp, SearchFollowUps } from "../../../src/shared/api.js";
import { ASK_MAX, SEARCH_PAGE_LIMIT } from "../../../src/shared/search.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { normalise, parseQuery, type Parsed } from "../query/parse.js";
import { parseContext } from "../query/context.js";
import { names } from "../query/names.js";
import { AWARD_WORDS, LEXICON } from "../query/lexicon.js";
import { keptAnswer } from "../searchReads.js";
import { searchAnswer } from "../searchAnswer.js";
import { forecasterBuilds } from "../../predict/engine.js";
import { failureOf, outcomeTrace } from "../../searchFailures.js";

type Family = SearchFollowUp["family"];

/** The whole answer for `q` as /api/search?answer=1 gives it, kept a minute: a follow-up checked here is the answer its
 *  tap opens. */
export const pageAnswer = (q: string, limit: number, prefer: ReadonlySet<string>): Promise<SearchAnswer> =>
  keptAnswer(JSON.stringify([q, limit, [...prefer].sort(), forecasterBuilds()]), () => searchAnswer(q, { limit, prefer }));

/** The follow-ups for `q` with its own kept answer (followUps), kept a minute as the answer is: the /search page's
 *  first paint and the app's /api/search/follow for the same search are one reading. */
export const keptFollowUps = (q: string, prefer: ReadonlySet<string> = new Set()): Promise<SearchFollowUps> =>
  keptAnswer(JSON.stringify(["follow", q, [...prefer].sort(), forecasterBuilds()]), async () => followUps(q, await pageAnswer(q, SEARCH_PAGE_LIMIT, prefer), prefer));

/** At most this many questions are shown, and this many candidates run to find them. */
export { ASK_MAX };
export const RELATED_MAX = 8;
const CHECK_MAX = 16;
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
    ...(p.intent === "leaderboard" ? fill(LEADERS, s) : []),
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
export async function followUps(q: string, a: SearchAnswer, prefer: ReadonlySet<string> = new Set()): Promise<SearchFollowUps> {
  const read = await initialsUpper(await parseQuery(q, await parseContext(Date.now(), prefer)));
  // A name several teams still share holds an arbitrary first one: no follow-up is about it (../query/shared.ts).
  const p = { ...read, teams: read.teams.filter((t) => !t.candidates || t.rule) };
  // The searches the page already offers (a sorry note's, a team fallback's, the answer's own related ones): asked
  // again in other words, they'd be offered twice. Their answers, kept the same way, say what they answer.
  const shown = [...new Set([...(a.suggest ?? []), ...(a.sorry?.suggest ?? []), ...(a.stat?.blocks ?? []).flatMap((b) => (b.kind === "related" ? b.queries : []))])].slice(0, SHOWN_MAX);
  const all = candidates(p, a);
  const run = inTurn((x: string) => pageAnswer(x, SEARCH_PAGE_LIMIT, prefer).catch(() => null));
  const [offered, asked] = await Promise.all([Promise.all(shown.map(run)), pick(all.filter((c) => !c.chip).slice(0, CHECK_MAX).map((c) => ({ ...c, run: c.q })), run)]);
  const seen = new Set([a, ...offered].flatMap((x) => (x ? [answerKey(x).toLowerCase()] : [])));
  const ask = fresh(asked, seen, ASK_MAX);
  // What the questions didn't take, as short searches: never a question's answer again. Only about what the search
  // itself is about (its teams, the team its answer is about): never a team that only a question's answer named (a
  // leaderboard's first, from "top teams" asked under "upcoming events").
  const taken = new Set(ask.map((x) => x.q));
  const rest = all.filter((c) => !taken.has(c.q)).slice(0, CHECK_MAX).map((c) => ({ ...c, run: c.short }));
  // The team's standout matches, beside the answer on a wide screen: the team asked about, else the one its answer is
  // about; none for a search about no team. Run beside the related searches; a related search still comes first to an
  // answer they share.
  const about = p.teams[0]?.number ?? answerTeam(a);
  const [picked, lit] = await Promise.all([pick(rest, run), about != null ? pick([{ q: "", short: "", family: "team" as const, run: `${about} highlights` }], run) : []]);
  const related = fresh(picked, seen, RELATED_MAX);
  const [best] = fresh(lit, seen, 1);
  const view = (x: Omit<SearchFollowUp, "q"> & { run: string }): SearchFollowUp => ({ q: x.run, family: x.family, preview: x.preview, value: x.value, rest: x.rest, tone: x.tone });
  return { ask: ask.map(view), related: related.map(view), ...(best ? { highlights: { ...view(best), team: about! } } : {}), ...(about != null ? { about } : {}) };
}

/** `f`, its calls run one at a time in the order made, each after this process has looked at what else is waiting
 *  (other visitors' requests, timers). The database answers without ever giving the event loop back (its reads
 *  resolve as microtasks), so the up to 40 searches checked for one search's follow-ups, all asked at once, held this
 *  process for their whole run, 2 to 4 seconds, and every other request waited behind them. One
 *  at a time with a turn of the loop between them, a request that comes in meanwhile waits for one search at most.
 *  The same searches run either way, each the same kept answer: only when they run changes. */
export function inTurn<A extends unknown[], R>(f: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let last: Promise<unknown> = Promise.resolve();
  return (...args) => {
    const next = last.then(() => new Promise<void>((go) => setImmediate(go))).then(() => f(...args));
    last = next.catch(() => {});
    return next;
  };
}

/** The first `max` of `xs` whose answers none before them (nor `seen`) gives, each added to `seen`. */
function fresh<X extends { key: string }>(xs: X[], seen: Set<string>, max: number): X[] {
  const out: X[] = [];
  for (const x of xs) if (out.length < max && !seen.has(x.key)) { seen.add(x.key); out.push(x); }
  return out;
}

/** The candidates (each run as `run`) whose answer is a direct one, in order, each with its preview and answer key. */
async function pick<C extends Candidate & { run: string }>(cs: C[], run: (q: string) => Promise<SearchAnswer | null>) {
  const answers = await Promise.all(cs.map((c) => run(c.run)));
  return cs.flatMap((c, i) => {
    const ans = answers[i];
    const line = ans && !failureOf(c.run, ans, outcomeTrace(ans)) ? lineOf(ans, !!c.list) : null;
    return ans && line ? [{ ...c, ...line, preview: [line.value, line.rest].filter(Boolean).join(" · "), key: answerKey(ans).toLowerCase() }] : [];
  });
}
