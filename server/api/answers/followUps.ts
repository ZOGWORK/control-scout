// People also ask (the owner's follow-ups brief, §1a): the next questions after a search, from what search read in it (its
// teams, event, place, time and award) and the questions it already answers. Nothing here answers anything: each
// candidate is run as a search, the same kept answer a tap on it opens (pageAnswer), and shown only when that answer
// is a direct one: never a sorry, a fallback, a weak guess or a list of names. Its preview is that answer's own
// headline, so the numbers are the ones the linked page shows. No team, event or year is written here: the words come
// from the query as typed, the answer and the lexicon.
import type { SearchAnswer, SearchFollowUp } from "../../../src/shared/api.js";
import { SEARCH_PAGE_LIMIT } from "../../../src/shared/search.js";
import { normalise, parseQuery, type Parsed } from "../query/parse.js";
import { parseContext } from "../query/context.js";
import { AWARD_WORDS, LEXICON } from "../query/lexicon.js";
import { keptAnswer } from "../searchReads.js";
import { searchAnswer } from "../searchAnswer.js";
import { failureOf, outcomeTrace } from "../../searchFailures.js";

type Family = SearchFollowUp["family"];

/** The whole answer for `q` as /api/search?answer=1 gives it, kept a minute: a follow-up checked here is the answer its
 *  tap opens. */
export const pageAnswer = (q: string, limit: number, prefer: ReadonlySet<string>): Promise<SearchAnswer> =>
  keptAnswer(JSON.stringify([q, limit, [...prefer].sort()]), () => searchAnswer(q, { limit, prefer }));

/** At most this many questions are shown, and this many candidates run to find them. */
export const ASK_MAX = 6;
const CHECK_MAX = 16;

type Slots = { t?: number; u?: number; event?: string; place?: string; when?: string; award?: string };
type Template = { family: Family; ask: (s: Required<Slots>) => string; needs: (keyof Slots)[]; when?: boolean };
const T = (family: Family, needs: (keyof Slots)[], ask: Template["ask"], when = false): Template => ({ family, needs, ask, when });
/** " in <time>" when the query said one and the question is about one season. */
const IN = (s: Slots) => (s.when ? ` in ${s.when}` : "");

// In the order they're offered: the questions nearest a search about a team first (its numbers, record and rating),
// then its awards, matches and events. Each says the time the query said, when it's a season's question.
const TEAM: Template[] = [
  T("team", ["t"], (s) => `What is ${s.t}'s OPR${IN(s)}?`, true),
  T("team", ["t"], (s) => `What is ${s.t}'s record${IN(s)}?`, true),
  T("predict", ["t"], (s) => `What is ${s.t}'s rating${IN(s)}?`, true),
  T("awards", ["t"], (s) => `What awards has ${s.t} won?`),
  T("team", ["t"], (s) => `When did ${s.t} last play?`),
  T("events", ["t"], (s) => `How many events has ${s.t} played?`),
  T("team", ["t"], (s) => `What is ${s.t}'s highest score${IN(s)}?`, true),
  T("team", ["t"], (s) => `Who is ${s.t}'s best alliance partner?`),
  T("events", ["t"], (s) => `Has ${s.t} been to Worlds?`),
  T("team", ["t"], (s) => `What is ${s.t}'s win rate${IN(s)}?`, true),
  T("team", ["t"], (s) => `What is ${s.t}'s average score${IN(s)}?`, true),
  T("team", ["t"], (s) => `Is ${s.t}'s OPR going up?`),
  T("team", ["t"], (s) => `What is ${s.t}'s longest win streak?`),
  T("team", ["t"], (s) => `How many matches has ${s.t} played?`),
  T("events", ["t"], (s) => `When is ${s.t}'s next event?`),
];
const TWO: Template[] = [
  T("compare", ["t", "u"], (s) => `Who has the higher OPR, ${s.t} or ${s.u}?`),
  T("predict", ["t", "u"], (s) => `Who would win, ${s.t} or ${s.u}?`),
  T("compare", ["t", "u"], (s) => `Who has the better record, ${s.t} or ${s.u}?`),
  T("compare", ["t", "u"], (s) => `How has ${s.t} done against ${s.u}?`),
];
const EVENT: Template[] = [
  T("events", ["event"], (s) => `Who won ${s.event}${IN(s)}?`),
  T("events", ["event"], (s) => `What were the best matches at ${s.event}${IN(s)}?`),
  T("events", ["event"], (s) => `Which teams played at ${s.event}${IN(s)}?`),
];
const AWARD_AT: Template = T("awards", ["event", "award"], (s) => `Who won the ${s.award} Award at ${s.event}${IN(s)}?`);
const PLACE: Template[] = [
  T("team", ["place"], (s) => `Who are the top teams in ${s.place}?`),
  T("team", ["place"], (s) => `Which team has the highest OPR in ${s.place}?`),
  T("predict", ["place"], (s) => `Who has the highest rating in ${s.place}?`),
  T("team", ["place"], (s) => `How many teams are in ${s.place}?`),
  T("team", ["place"], (s) => `What is the highest score in ${s.place}?`),
  T("events", ["place"], (s) => `What events are coming up in ${s.place}?`),
  T("events", ["place"], (s) => `What events are this week in ${s.place}?`),
  T("events", ["place"], (s) => `What events are in ${s.place}?`),
];
// A search that names nothing (a list of upcoming events, a season's leaders): the season's starting points.
const START: Template[] = [
  T("team", [], () => "Who are the top teams?"),
  T("team", [], () => "Which team has the highest OPR?"),
  T("team", [], () => "What is the highest score this season?"),
  T("events", [], () => "What events are coming up?"),
  T("events", [], () => "What events are this week?"),
  T("events", [], () => "What events are happening today?"),
];

/** The Worlds phrases the lexicon reads, longest first ("first championship" before "first"). */
const WORLDS = LEXICON.filter((e) => e.syms.some((x) => x.k === "worlds")).map((e) => e.words.join(" ")).sort((a, b) => b.length - a.length);
/** The awards a question can name in one word ("Think"), in the lexicon's order. */
const AWARDS = AWARD_WORDS.map(([, type]) => type).filter((type) => /^[A-Z][a-z]+$/.test(type));

/** The team an answer is about when the query named none ("who won inspire at …": the winner). */
function answerTeam(a: SearchAnswer): number | undefined {
  return a.stat?.team?.number ?? a.stat?.teams?.[0]?.number ?? a.card?.team?.number ?? a.card?.awards?.[0]?.team;
}

/** The candidates for a query read as `p` with answer `a`, in the order they're offered. */
export function candidates(p: Parsed, a: SearchAnswer): { q: string; family: Family }[] {
  const n = normalise(p.q);
  const worlds = p.worlds ? WORLDS.find((w) => ` ${n} `.includes(` ${w} `)) : undefined;
  const said = p.event?.typed ?? worlds;
  // As typed, or in title case when typed all in lower case ("north league meet" → "North League Meet").
  const event = said && said === said.toLowerCase() ? said.replace(/(?<![\p{L}\p{N}'])\p{L}/gu, (c) => c.toUpperCase()) : said;
  const teams = p.teams.map((t) => t.number);
  const s: Slots = {
    t: teams[0] ?? answerTeam(a), u: teams[1], event, place: p.place?.name,
    // A season said (a year, a season's two years): a window ("this week") or every season is no season's question.
    when: p.time?.kind === "season" ? p.time.typed : undefined,
    award: p.award ?? undefined,
  };
  // An event's time is the event's ("<event> <year>"), never a season of the team's questions.
  const teamWhen = event ? undefined : s.when;
  const fill = (list: Template[], slots: Slots) => list
    .filter((x) => x.needs.every((k) => slots[k] != null))
    .map((x) => ({ q: x.ask({ ...(slots as Required<Slots>), when: (x.needs.includes("t") ? (x.when ? teamWhen : undefined) : slots.when) ?? "" }), family: x.family }));
  const [award1, ...awards] = event ? AWARDS.filter((x) => x !== s.award).slice(0, 4).flatMap((award) => fill([AWARD_AT], { ...s, award })) : [];
  const out = [
    ...(s.u != null ? fill(TWO, s) : []),
    ...(event ? fill(EVENT, s) : []),
    ...(award1 ? [award1] : []),
    ...(s.place ? fill(PLACE, s) : []),
    ...(s.t != null ? fill(TEAM, s) : []),
    // The second team's own, after the first's; an event's other awards after its winner's questions.
    ...(s.u != null ? fill(TEAM, { ...s, t: s.u }) : []),
    ...awards,
    ...(s.t == null && !event && !s.place ? fill(START, s) : []),
  ];
  return out.filter((x) => normalise(x.q) !== n);
}

/** One line from a direct answer, or null when `a` isn't one (no answer card, nothing found, a list of names). */
export function previewOf(a: SearchAnswer): string | null {
  if (a.sorry || a.weak || a.understood?.fallback) return null;
  if (a.verdict) return `${a.verdict.answer}: ${a.verdict.label}`;
  const st = a.stat;
  if (st) return st.none || !st.headline ? null : [st.headline.value, st.headline.label].filter(Boolean).join(" · ");
  const c = a.card;
  if (c) {
    const first = c.lines[0];
    return c.headline ?? (first ? [first.text, first.detail].filter(Boolean).join(" · ") : null);
  }
  const u = a.understood;
  if (u?.kind === "events" && u.total) return `${u.label}: ${u.total.toLocaleString("en-US")} event${u.total === 1 ? "" : "s"}`;
  return null;
}

/** What an answer answers: two candidates with the same are one question asked twice, and one with the search's own is
 *  the search again. */
const answerKey = (a: SearchAnswer) => `${a.stat?.intent ?? a.card?.kind ?? a.understood?.kind}|${a.stat?.title ?? a.card?.title ?? a.understood?.label}`;

/** People also ask for `q` (its own answer `a`): up to ASK_MAX questions search answers directly, each with its answer's
 *  own line. Only the first CHECK_MAX candidates are run: fewer questions, never a slower page. */
export async function followUps(q: string, a: SearchAnswer, prefer: ReadonlySet<string> = new Set()): Promise<SearchFollowUp[]> {
  const p = await parseQuery(q, await parseContext(Date.now(), prefer));
  const seen = new Set([answerKey(a), ...(a.suggest ?? []), ...(a.sorry?.suggest ?? [])].map((x) => x.toLowerCase()));
  const tried = candidates(p, a).slice(0, CHECK_MAX);
  const answers = await Promise.all(tried.map((c) => pageAnswer(c.q, SEARCH_PAGE_LIMIT, prefer).catch(() => null)));
  const out: SearchFollowUp[] = [];
  tried.forEach((c, i) => {
    const ans = answers[i];
    const preview = ans && !failureOf(c.q, ans, outcomeTrace(ans)) ? previewOf(ans) : null;
    const key = ans && answerKey(ans).toLowerCase();
    if (!preview || !key || seen.has(key) || out.length >= ASK_MAX) return;
    seen.add(key);
    out.push({ ...c, preview });
  });
  return out;
}
