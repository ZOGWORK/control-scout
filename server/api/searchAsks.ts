// Questions search answers by routing to a view Scout already has (FTC One Search brief, Requirement 11). Fixed
// rules, no model; every number comes from the stored data, and each answer links the view that holds the rest:
//   leaderboards   "top teams in New Jersey", "NJ rankings", "best team in NJ"     → the region's ranking (top 5 + /rankings)
//   stat leaders   "highest OPR", "best auto team", "most wins" (optionally "in NJ") → the season's leaders by that stat
//   predictions    "will 12345 win their next match"   → its next match, and Predict opened on the team's matches
//                  "12345 vs 67890 who wins"            → Compare, and Predict with both teams filled in
//                  "who will win New Jersey Championship" → the event's odds
//   advancement    "will 12345 advance to states", "what does 12345 need to advance" → Predict's advancement simulator
//   event awards   "who won Inspire at New Jersey Championship" → that event's award, from its results
//   event winners  "who won nj states", "who won the New Jersey Championship" → its newest finished one: the winning
//                  alliance and the Inspire Award, from its results
//   how it works   "how are predictions calculated"  → the methodology page, in the Pages group
//   using Predict  "win probability for teams I pick", "does it update if I change the alliance" → Custom matchup;
//                  "can I filter predictions by team" → Scheduled matches; "12345 prediction settings" → its matches there
//   a day's calls  "predictions for tomorrow's matches" → that day's events, each one's matches in Predict
// Only stats the data holds: OPR without penalties and its auto/teleop/endgame parts, and wins. Never an inferred one.
import type { SearchAnswer, SearchCard, SearchCardAward, SearchCardLine, SearchHit, SearchPageLink } from "../../src/shared/api.js";
import { pagesFor } from "../../src/shared/search.js";
import { eventTypesOf, readEventQuery, regionOf } from "../../src/shared/searchEventQuery.js";
import { RANKED_MIN_MATCHES, parsePlaces } from "../../src/shared/rankings.js";
import { predictHref } from "../../src/shared/predictUrl.js";
import { cleanTeamName } from "../../src/shared/teamTitle.js";
import type { Region } from "../../src/shared/regions.js";
import { dateRange, possessive, seasonLabel } from "../../src/shared/format.js";
import { matchDay } from "../../src/shared/coinFlips.js";
import { teamPageSql } from "../../src/shared/teamPages.js";
import { CURRENT_SEASON, FIRST_PREDICT_SEASON, isLegacy } from "../data/seasons.js";
import { all } from "../db.js";
import { rankings } from "./rankings.js";
import { search } from "./search.js";
import { fuzzyScore } from "./fuzzy.js";
import { PHASE_COLS, tableOf } from "./teamTableRows.js";
import { eventHit, localTodays, searchToday } from "./searchEvents.js";
import { seasonOfDate } from "./query/time.js";
import { namedTeam, versusAnswer } from "./searchCompare.js";
import { eventChampions } from "./answers/families/winners.js";
import { NO_MATCH_TYPES } from "./events.js";
import { place } from "../../src/shared/format.js";

export type Stat = "opr" | "auto" | "teleop" | "endgame" | "wins";
export type Ask =
  | { kind: "leaderboard"; region: Region | null }
  | { kind: "stat"; stat: Stat; region: Region | null }
  | { kind: "predict-next"; team: string }
  | { kind: "predict-versus"; rest: string }
  | { kind: "event-winner"; event: string }
  | { kind: "advance"; team: string }
  | { kind: "award"; award: string; event: string; place?: number }
  | { kind: "event-won"; event: string }
  /** Who advanced from an event, or how many ("how many teams went to states at <event>"). */
  | { kind: "advanced"; event: string; count: boolean }
  | { kind: "how" }
  /** How to get a call for any lineup, or whether it updates as the lineup changes: Predict's Custom matchup. */
  | { kind: "predict-lineup";
      /** Said with no forecast word: "change", a lineup changed and nothing more asked; "partner", which partner is
       *  best once it changes. Absent: a yes-or-no question about the forecast ("does the win chance update"). */
      say?: "change" | "partner" }
  /** Which predictions can be picked out: Predict's Scheduled matches, by team or event. */
  | { kind: "predict-filter" }
  /** One team's predictions page ("12345 prediction settings"): its matches in Predict. */
  | { kind: "predict-team"; team: string }
  /** The calls for a day's matches: that day's events. */
  | { kind: "predict-day"; day: "today" | "tomorrow" };

/** Words for a forecast, in a question about Predict itself. */
const FORECAST_WORDS = /\b(?:predict|predicts|predicted|prediction|predictions|forecasts?|odds|win (?:probabilit(?:y|ies)|chances?)|who (?:would|will) win)\b/;
/** A lineup someone makes up, or changes. */
const OWN_LINEUP = /\b(?:teams? (?:i|you|we) (?:pick|choose|select|want)|(?:my|our) own teams|any teams|custom (?:match(?:up)?|lineup|alliances?)|hypothetical|(?:chang(?:e|ing)|switch(?:ing)?|swap(?:ping)?) (?:the |an |my |our )?(?:alliances?|teams?|lineup|partners?)|(?:has ?n['’]?t|has not|have ?n['’]?t|have not|not) (?:happened|been played|played)(?: yet)?)\b/;
/** A supposition's opener: "if I", "what if we", "suppose you". */
const HYPO_CHANGE = /\b(?:what if|if|suppose|supposing|when) (?:i|we|you)\b/g;
/** Which partner is best, asked of no team in particular. */
const BEST_PARTNER = /^(?:(?:who|whos|who['’]s|which team|which)(?: is| has| would be| will be| makes| would make| is the)?\s+)?(?:the\s+)?(?:best|strongest|top)\s+(?:alliance\s+)?(?:partner|partners|pick|teammate)(?:\s+(?:be|is|would be))?$/;

const STAT_LABEL: Record<Stat, string> = { opr: "Highest OPR", auto: "Best auto (auto OPR)", teleop: "Best teleop (teleop OPR)", endgame: "Best endgame (endgame OPR)", wins: "Most wins" };
const STAT_COLUMN: Record<Stat, string> = { opr: "s.opr_np", auto: "s.opr_auto", teleop: "s.opr_teleop", endgame: "s.opr_endgame", wins: "s.wins" };

/** The award types as FIRST stores them, by the word people use. "control" here is the Control Award. */
const AWARDS: Record<string, string> = {
  inspire: "Inspire", think: "Think", innovate: "Innovate", design: "Design", reach: "Reach", sustain: "Sustain",
  connect: "Connect", control: "Control", motivate: "Motivate", compass: "Compass", judges: "JudgesChoice", "judges choice": "JudgesChoice",
  "deans list": "DeansList", "dean's list": "DeansList",
  // The performance awards, by the alliance each names ("who won the finalist award at …").
  finalist: "Finalist", finalists: "Finalist", "finalist alliance": "Finalist", "winning alliance": "Winner",
};
/** An award type's name in words, where FIRST's type isn't one ("JudgesChoice"). */
const AWARD_NAME: Record<string, string> = { JudgesChoice: "Judges' Choice", DeansList: "Dean's List", Finalist: "Finalist Alliance", Winner: "Winning Alliance" };

/** A region named by the words `s` (all of them), or null. */
const regionWords = (s: string): Region | null => regionOf(s.trim().replace(/^(?:the )?(?:state of )?/i, "").split(/\s+/).filter(Boolean));

/** Words that only say "everyone, this season": a leaderboard's scope is the world's unless a place is named. */
const SCOPE_WORDS = /(?:^| )(?:right now|rn|atm|at the moment|currently|now|today|this season|this year|in the (?:whole )?world|of the world|worldwide|globally|overall|of all time|all time|of all|ever)(?= |$)/g;

/** "What is the best FTC team right now" → "best team", "best teleop in FTC in the world" → "best teleop": the opener,
 *  "FTC" and the scope words say nothing about which teams. */
function leaderWords(t: string): { t: string; opened: boolean } {
  const opener = /^(?:what|who|which)(?: is| are|s)? (?:the )?/;
  const opened = opener.test(t);
  t = t.replace(opener, "").replace(/(?:^| )(?:in |of )?(?:ftc|first tech challenge)(?= |$)/g, " ").replace(SCOPE_WORDS, " ")
    .replace(/\s+/g, " ").trim();
  return { t, opened };
}

/** The stat a word names: "auto"/"autonomous", "teleop"/"tele op"/"driver"/"driver controlled", "endgame", "opr", "wins". */
const statOf = (w: string): Stat => (w = w.replace(/\s+/g, ""), w.startsWith("auto") ? "auto" : w.startsWith("tele") || w.startsWith("driver") ? "teleop" : w.startsWith("end") ? "endgame" : w === "wins" ? "wins" : "opr");

/** The season an asked board reads with none said, as the query pipeline reads one (./query/execute.ts): the current
 *  season, so "best in NJ right now" and "best teams in NJ" agree whichever reader answers. */
export const askSeason = (now = Date.now()): number => seasonOfDate(searchToday(now));

/** `read` for the current season, then the season before when the current one has nothing yet (the pipeline's own
 *  step, ./query/relax.ts defaultSteps). */
async function currentFirst<T>(read: (season: number) => Promise<T>, empty: (t: T) => boolean): Promise<{ season: number; got: T; skipped: number | null }> {
  const season = askSeason();
  const got = await read(season);
  if (!empty(got)) return { season, got, skipped: null };
  const before = await read(season - 1);
  return empty(before) ? { season, got, skipped: null } : { season: season - 1, got: before, skipped: season };
}
/** Why an asked board shows the season before `skipped`, in the pipeline's own words (./query/relax.ts defaultSteps),
 *  or "" when it shows the current one. */
const fellBack = (skipped: number | null, where: string) => skipped == null ? "" : ` (No ${seasonLabel(skipped)} ranked teams yet${where}; showing ${seasonLabel(skipped - 1)})`;

/** The question `q` asks of a view, or null. `q` is cleaned (no punctuation), any case. */
export function readAsk(q: string): Ask | null {
  const t = q.trim().toLowerCase().replace(/\s+/g, " ");
  // Region codes that are also words ("IN", "ON", "OH") count only in capitals, so a region is read as typed.
  const cased = new Map<string, string>();
  for (const w of q.trim().split(/\s+/)) if (!cased.has(w.toLowerCase()) || /^[A-Z]+$/.test(w)) cased.set(w.toLowerCase(), w);
  const regionIn = (s: string) => regionWords(s.split(" ").map((w) => cased.get(w) ?? w).join(" "));
  if (/^how (?:are|is|do|does) (?:the )?(?:predictions?|odds|win chances?|forecasts?)(?: (?:calculated|made|worked out|computed|work|working))?$|^how does (?:the )?(?:prediction|predict(?:ion)? engine|simulator) work$|^(?:prediction|predictions) (?:methodology|method)$/.test(t)) return { kind: "how" };
  // Predict itself, asked about with no team named: a lineup of your own, or picking predictions out.
  if (!/\d/.test(t) && FORECAST_WORDS.test(t)) {
    if (OWN_LINEUP.test(t)) return { kind: "predict-lineup" };
    if (/\b(?:filter|filtered|filtering|sort|sorted|narrow|narrowed)\b/.test(t)) return { kind: "predict-filter" };
  }
  // A lineup changed in a supposition, with no forecast word and no team ("if I change the alliance", "who's the best
  // partner if we swap teams"): what Custom matchup is for. Anything else asked of it is left to the other readers.
  if (!/\d/.test(t) && new RegExp(HYPO_CHANGE.source).test(t) && OWN_LINEUP.test(t)) {
    const rest = t.replace(HYPO_CHANGE, " ").replace(OWN_LINEUP, " ").replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
    if (!rest) return { kind: "predict-lineup", say: "change" };
    if (BEST_PARTNER.test(rest)) return { kind: "predict-lineup", say: "partner" };
  }
  // The day's predictions everywhere, said with nothing else: any other scope ("in New Jersey", "at worlds", "playoff",
  // a team) asks for a filter this list doesn't apply, so the whole question must be the day and its matches, and
  // anything more is left to the readers that do. A closing "if any (are scheduled)" narrows nothing.
  const lead = String.raw`(?:(?:what are|what're|show me|show|give me|see|list)\s+)?(?:all\s+)?(?:the\s+)?`;
  const day = String.raw`(today|tomorrow)(?:['’]?s)?\s+(?:matches|match|games)`;
  const close = String.raw`(?:,?\s+if\s+(?:there\s+(?:are|is)\s+)?any)?(?:,?\s+(?:are|is)\s+(?:scheduled|planned|happening|on))?[?.!]?`;
  let d = new RegExp(String.raw`^${lead}(?:predictions?|forecasts?)\s+(?:for|of|on)\s+(?:all\s+(?:of\s+)?)?(?:the\s+)?${day}${close}$|^${lead}${day}\s+(?:predictions?|forecasts?)${close}$`).exec(t);
  if (d) return { kind: "predict-day", day: (d[1] ?? d[2]) as "today" | "tomorrow" };
  d = /^(.+?) (?:prediction|predictions|predict|forecast) (?:settings|options|page|tool|view)$/.exec(t);
  if (d) return { kind: "predict-team", team: d[1] };
  // Leaderboards: the world's ("best team", "what is the best FTC team right now") or a place's.
  const lw = leaderWords(t);
  if (/^(?:the )?(?:top|best|highest(?: |-)ranked|strongest|number one|no 1|1)(?: \d+)? (?:teams?|robots?)$/.test(lw.t) || (lw.opened && /^(?:best|top|strongest|number one)$/.test(lw.t))) return { kind: "leaderboard", region: null };
  // "The best in NJ": the team word can go unsaid before a place, since only a team is "the best in" a region.
  let m = /^(?:the )?(?:top|best|highest(?: |-)ranked|strongest)(?: \d+)?(?: (?:teams?|robots?)(?: in| from| of)?| in| from| of) (.+)$/.exec(lw.t);
  if (m) { const region = regionIn(m[1]); if (region) return { kind: "leaderboard", region }; }
  m = /^(.+?) (?:rankings?|standings|leaderboard|top teams|best teams?)$/.exec(lw.t);
  if (m) { const region = regionIn(m[1]); if (region) return { kind: "leaderboard", region }; }
  // Stat leaders, the whole season (scope words like "in the world" or "this season" change nothing) or a place's.
  m = /^(?:(?:who )?(?:has|had|is) (?:the )?)?(?:the )?(?:highest|best|top|most|biggest|strongest|greatest|number one|no 1|1) (opr|auto(?:nomous)?|tele ?op|driver(?: ?controlled)?|end ?game|wins)(?: opr| scores?| scoring| points| period)?(?: teams?| robots?)?(?: (?:in|from|of) (.+))?$/.exec(lw.t)
    ?? /^(?:which|what) team has (?:the )?(?:highest|best|most) (opr|wins)(?: in (.+))?$/.exec(t.replace(SCOPE_WORDS, " ").replace(/\s+/g, " ").trim());
  if (m) {
    const stat = statOf(m[1]);
    const region = m[2] ? regionIn(m[2]) : null;
    if (!m[2] || region) return { kind: "stat", stat, region };
  }
  // Predictions.
  m = /^(?:will|can|does|do) (.+?) win (?:their|its|his|her|the|our|my) next (?:match|game)$/.exec(t);
  if (m) return { kind: "predict-next", team: m[1] };
  m = /^(?:who (?:will )?wins?|who would win|prediction|predict) (.+ (?:vs\.?|versus|v\.?|against) .+)$/.exec(t) ?? /^(.+ (?:vs\.?|versus|v\.?|against) .+?) (?:who (?:will )?wins?|who would win|prediction|predict|odds|win chances?)$/.exec(t);
  if (m) return { kind: "predict-versus", rest: m[1] };
  m = /^who (?:will|is going to|would) win (?:the )?(.+)$/.exec(t);
  if (m) return { kind: "event-winner", event: m[1] };
  // Advancement.
  // "Did 12345 qualify to worlds" is history (parseQuestion), not the simulator.
  m = /^(?:will|can|does) (.+?) (?:advance|qualify|make it)(?: to (?:states?|worlds|the championship|regionals?))?$/.exec(t)
    ?? /^what does (.+?) need to (?:advance|qualify)(?: to .+)?$/.exec(t) ?? /^(.+?) (?:advancement|advancement odds|chances? to advance)$/.exec(t);
  if (m) return { kind: "advance", team: m[1] };
  // An event's award.
  // A place asked ("who won 2nd place inspire at …"): every place listed, that one first.
  m = /^who (?:won|got|received|took) (?:the )?(?:([123])(?:st|nd|rd) place )?(.+?)(?: award)? at (?:the )?(.+)$/.exec(t);
  if (m) {
    const w = m[2].replace(/['’]/g, ""); // "Judges' Choice", "Judges’ Choice"
    if (Object.hasOwn(AWARDS, w)) return { kind: "award", award: AWARDS[w], event: m[3], ...(m[1] ? { place: Number(m[1]) } : {}) };
  }
  // Who advanced from an event, or how many ("how many teams went to states at <event>", "which teams qualified for
  // worlds from <event>", "who advanced from <event>"): the event's advancement list. The step named is only words:
  // the list says where its teams go.
  m = /^(?:(how many|which|what) teams?|who) (?:went|go|got|advanced|advance|advancing|qualified|qualify|made it|moved on|move on)(?: on)?(?: (?:to|for|into) (?:the )?(?:states?|state championships?|state champs|regionals?|regional championships?|worlds|world championships?|first championship|next (?:level|event|round)))? (?:from|at|out of) (?:the )?(.+)$/.exec(t);
  if (m) return { kind: "advanced", event: m[2].split(" ").map((w) => cased.get(w) ?? w).join(" "), count: m[1] === "how many" };
  // Who won an event ("who won nj states", "winners of the New Jersey Championship"): never "won" as a name word, nor
  // an award at an event ("who won the … award at …"), whichever award it is.
  m = /^(?:who (?:won|took|was the winner of|were the winners of|were the champions of|was the champion of)|winners? of|champions? of) (?:the )?(.+)$/.exec(t);
  // "Who took the most penalties" is a measure, never an event.
  if (m && !/^(?:most|fewest|least|highest|lowest|best|worst|first|last|top|longest|biggest|more|fewer)\b/.test(m[1]) && !Object.hasOwn(AWARDS, m[1].replace(/['’]/g, "").replace(/ award$/, "")) && !/(?:^| )awards? at /.test(m[1])) return { kind: "event-won", event: m[1].split(" ").map((w) => cased.get(w) ?? w).join(" ") };
  return null;
}

/** An event's whole award list and the event itself, in its Awards tab's order (server/api/events.ts) except that a
 *  judged award's finalists ("… Finalist", placed 1 like its winner) come after its placed teams. */
async function eventAwards(season: number, code: string, name: string): Promise<Pick<SearchCard, "event" | "awards">> {
  const rows = await all<any>(
    `SELECT a.type, a.placement, a.team, a.name, t.name team_name FROM awards a LEFT JOIN teams t ON t.number = a.team WHERE a.season = ? AND a.code = ?
     ORDER BY CASE a.type WHEN 'Inspire' THEN 0 WHEN 'Winner' THEN 1 WHEN 'Finalist' THEN 2 ELSE 3 END, a.type, (a.type NOT IN ('Winner', 'Finalist') AND COALESCE(a.name, '') LIKE '%Finalist'), a.placement`, [season, code]);
  const awards: SearchCardAward[] = rows.map((r) => ({ type: r.type, placement: Number(r.placement), team: Number(r.team), teamName: r.team_name ?? null, name: r.name ?? null }));
  return { event: { season, code, name }, awards };
}

const teamLine = (n: number, name: string | null, results: string[], detail?: string): SearchCardLine => ({
  text: `${n} ${cleanTeamName(n, name) ?? ""}`.trim(), ...(detail ? { detail } : {}), results, href: `/teams/${n}`,
});
const fmt = (x: number | null) => (x == null ? "–" : (Math.round(Number(x) * 10) / 10).toFixed(1));
/** The event "who won <words>" asks about: a place's championship ("nj states", "new jesey state championship"), its
 *  newest one finished (the event with the most results recorded, so the main event over its divisions); or an event by
 *  name, its newest season finished. A season named ("2024-25 nj states") is that season's. */
export async function eventWon(words: string, prefer: ReadonlySet<string>, now = Date.now()): Promise<{ season: number; code: string; name: string } | null> {
  // "Finished" on each event's own calendar: an event on its last day in Los Angeles isn't over at 02:00 UTC.
  const dayAt = localTodays(now);
  type Ev = { season: number; code: string; name: string; start: string | null; end: string | null; timezone: string | null };
  const finished = (rows: Ev[]) => rows.filter((r) => (r.end ?? r.start ?? "") !== "" && (r.end ?? r.start ?? "") < dayAt(r.timezone));
  const pick = (r: Ev | undefined) => (r ? { season: Number(r.season), code: r.code, name: r.name } : null);
  // A season ("2024-25") or a calendar year ("2024") named: only that one.
  const sm = /(?:^|\s)(20\d\d)(?:\s*[-\u2013/]\s*(\d\d(?:\d\d)?))?(?=\s|$)/.exec(words);
  const season = sm?.[2] && (sm[2].length === 2 ? (Number(sm[1]) + 1) % 100 : Number(sm[1]) + 1) === Number(sm[2]) ? Number(sm[1]) : null;
  const year = sm && !sm[2] ? Number(sm[1]) : null;
  const inScope = (r: Ev) => (season != null ? Number(r.season) === season : year != null ? (r.start ?? "").startsWith(String(year)) : true);
  const e = readEventQuery(words);
  const types = e ? eventTypesOf(e.kinds) : null;
  // A place's championship ("nj states"), with no event named beyond it: its newest finished one of the types asked
  // ("states": the state's own, never the FIRST Championship held there; one stored with no type, by its name), the
  // one with the most results first.
  if (e?.region && !e.words.length && !e.where && types?.every((t) => t === "Championship" || t === "FIRSTChampionship")) {
    const rows = await all<Ev>(
      `SELECT season, code, name, start, end, timezone FROM events ev WHERE (type IN (${types.map(() => "?").join(", ")}) OR (type IS NULL AND name LIKE '%Championship%')) AND country = ? AND state = ?
       ORDER BY season DESC, (SELECT COUNT(*) FROM awards a WHERE a.season = ev.season AND a.code = ev.code) DESC, length(code), code`,
      [...types, e.region.country, e.region.state]);
    return pick(finished(rows).filter(inScope)[0]);
  }
  // The FIRST Championship ("worlds", "worlds 2025"): its newest finished one, the main event (its finals) over its divisions.
  if ((e?.kinds.includes("worlds") && !e.region && !e.words.length && !e.where) || /^(?:the )?(?:worlds|first championship|world championships?)$/.test(words.trim())) {
    const rows = await all<Ev>(
      `SELECT season, code, name, start, end, timezone FROM events WHERE type = 'FIRSTChampionship' ORDER BY season DESC, length(code), code`, []);
    return pick(finished(rows).filter(inScope)[0]);
  }
  // An event by name ("New Jersey Championship Eastern Division"): the code search finds, its newest finished season
  // (or the one named).
  // A code is reused for other events over the years (USNJNELT2 was a South Essex tournament in 2024–25): a season
  // counts only while its event still has a name every word typed matches, and the events found that do lead.
  const named = sm ? (words.slice(0, sm.index) + " " + words.slice(sm.index + sm[0].length)).trim() : words;
  const hits = (await search(named, 8, prefer, new Set(["event"]))).filter((h) => h.kind === "event");
  const fits = (name: string) => fuzzyScore(regionsSpelled(named), name) >= 0.75;
  const lead = hits.filter((h) => fits(h.title));
  if (!hits.length) return null;
  const pool = lead.length ? lead : [bestEventHit(named, hits, prefer) ?? hits[0]];
  const rows = (await Promise.all(pool.map((h) => all<Ev>("SELECT season, code, name, start, end, timezone FROM events WHERE code = ?", [h.ref.split(":")[1]])))).flat()
    .filter((r) => !lead.length || fits(r.name)).sort((a, b) => Number(b.season) - Number(a.season));
  return pick(finished(rows).filter(inScope)[0]);
}

const answer = (q: string, a: Omit<SearchAnswer, "q" | "step" | "weak">): SearchAnswer => ({ q, step: "deterministic", weak: false, ...a });
const withPage = (q: string, first: SearchPageLink[]): SearchPageLink[] => [...first, ...pagesFor(q).filter((p) => !first.some((f) => f.href === p.href))];

type Named = { hit: SearchHit } | { tied: SearchHit[]; question: string };

/** The team the words name (a number or a name) by Compare's fixed rules, as search shows it; or, for a name several
 *  teams share and still tied, those teams and the question which one. */
async function teamOf(words: string, prefer: ReadonlySet<string>): Promise<Named | null> {
  const named = await namedTeam(words.trim(), prefer);
  if (!named) return null;
  const hitOf = async (n: number) => (await search(String(n), 3, prefer, new Set(["team"]))).find((h) => h.kind === "team" && h.ref === String(n)) ?? null;
  if ("team" in named) { const hit = await hitOf(named.team); return hit ? { hit } : null; }
  const tied = (await Promise.all(named.tied.map(hitOf))).filter((h): h is SearchHit => h != null);
  return tied.length ? { tied, question: named.question } : null;
}
/** A shared name still tied: its teams and the question; no schedule or Predict link is guessed. */
const whichAnswer = (q: string, t: { tied: SearchHit[]; question: string }) => answer(q, { hits: t.tied, pages: pagesFor(q), understood: { kind: "question", label: t.question } });

/** The words with each region code read as its region's name ("nj championship" → "new jersey championship"), so a
 *  name is scored against the words a stored name holds. */
export const regionsSpelled = (words: string) => words.split(/\s+/).map((w) => (/^[a-z]{2}$/i.test(w) ? regionOf([w])?.name ?? w : w)).join(" ");

/** The least a name must fit the words typed to be picked by its fit (fuzzyScore). */
const MIN_NAME_FIT = 0.5;

/** Of the event hits search found, the ones whose name fits the words best (within 0.05 of the best fit): one the
 *  visitor follows (`prefer`) first, then the newest season: "NJ Championship Parkway Division" is the latest event of
 *  that name, never an older one whose name holds extra words ("… State Championship HYBRID - Parkway Division"). */
export function bestEventHit(words: string, hits: SearchHit[], prefer: ReadonlySet<string> = new Set()): SearchHit | null {
  const evs = hits.filter((h) => h.kind === "event");
  if (!evs.length) return null;
  const said = regionsSpelled(words);
  const scored = evs.map((h, i) => ({ h, i, s: fuzzyScore(said, h.title) }));
  const top = Math.max(...scored.map((x) => x.s));
  // No name fits the words (an event's code typed, "USNJQ1", which search reads from its terms): search's own order.
  if (top < MIN_NAME_FIT) return evs[0];
  const followed = (h: SearchHit) => (prefer.has(`event:${h.ref}`) ? 0 : 1);
  return scored.filter((x) => x.s >= top - 0.05).sort((a, b) => followed(a.h) - followed(b.h) || (b.h.season ?? 0) - (a.h.season ?? 0) || a.i - b.i)[0].h;
}

async function eventOf(words: string, prefer: ReadonlySet<string>): Promise<SearchHit | null> {
  return bestEventHit(words, await search(words, 8, prefer, new Set(["event"])), prefer);
}

/** The answer for `ask`, or null when what it names isn't found (search goes on as before). */
export async function askAnswer(q: string, ask: Ask, opts: { prefer: ReadonlySet<string>; ask: (q: string) => Promise<SearchAnswer> }): Promise<SearchAnswer | null> {
  switch (ask.kind) {
    case "how":
      return answer(q, { hits: [], pages: withPage(q, [{ title: "How predictions are calculated", href: "/methodology" }]), understood: { kind: "question", label: "How predictions are calculated: the methodology page" } });

    case "predict-lineup":
      return answer(q, { hits: [], pages: withPage(q, [{ title: "Predict: Custom matchup", href: predictHref({ mode: "match" }) }]),
        understood: { kind: "question", label: ask.say === "partner"
          ? "Try each partner in Predict's Custom matchup: put your team and one partner on an alliance, press Predict this match, and the partner with the highest win chance is the best one for that lineup"
          : ask.say === "change"
            ? "Predict's Custom matchup takes any teams on each alliance: change them and press Predict this match for the new win chance and predicted score"
            : "Yes: Predict's Custom matchup takes any teams on each alliance. After changing them, press Predict this match for the new win chance and predicted score" } });

    case "predict-filter":
      return answer(q, { hits: [], pages: withPage(q, [{ title: "Predict: Scheduled matches", href: predictHref({ mode: "scheduled" }) }]),
        understood: { kind: "question", label: "By team and by event, not by date: Predict's Scheduled matches lists the engine's calls for the team or event you pick, its matches in order" } });

    case "predict-team": {
      const named = await teamOf(ask.team, opts.prefer);
      if (!named) return null;
      if ("tied" in named) return whichAnswer(q, named);
      const team = named.hit;
      const name = cleanTeamName(Number(team.ref), team.title.replace(/^\d+\s*\|\s*/, "")) ?? team.ref;
      const href = predictHref({ mode: "scheduled", pick: { kind: "team", team: Number(team.ref) } });
      return answer(q, { hits: [team], pages: withPage(q, [{ title: `Predict ${possessive(name)} matches`, href }]),
        understood: { kind: "question", label: `${name} (${team.ref}) · Predictions: their matches in Predict, each with the engine's call (there are no settings to change)` } });
    }

    case "predict-day": {
      const now = Date.now(), day = searchToday(now + (ask.day === "tomorrow" ? 864e5 : 0));
      // Events held that day that play matches (never a kickoff or a workshop), each read by its own posted matches: some
      // on that day where it's held (its time zone), a schedule with no match times yet (said apart: the day can't be
      // told), or none posted yet. An event whose posted matches all fall on other days (inspection that day, matches
      // the next) has none that day and is left out.
      const held = await all<any>(
        `SELECT season, code, name, type, venue, city, state, country, start, end, timezone, division_code FROM events e
         WHERE start <= ? AND COALESCE(end, start) >= ? AND COALESCE(remote, 0) = 0 AND (type IS NULL OR type NOT IN (${NO_MATCH_TYPES.map(() => "?").join(", ")}))
         ORDER BY start, name LIMIT 200`, [day, day, ...NO_MATCH_TYPES]);
      const times = held.length ? await all<{ season: number; code: string; time: string | null }>(
        `SELECT DISTINCT season, code, time FROM matches WHERE ${held.map(() => "(season = ? AND code = ?)").join(" OR ")}`, held.flatMap((r) => [r.season, r.code])) : [];
      // A venue's wall time (no zone, as FIRST writes them) is its own date; an instant is read in the venue's zone.
      const dayOf = (r: any, t: string) => matchDay(t, null, r.timezone ?? "UTC");
      const RANK = { day: 0, untimed: 1, unposted: 2 } as const;
      const classed = held.map((r) => {
        const own = times.filter((m) => Number(m.season) === Number(r.season) && m.code === r.code);
        const kind = !own.length ? "unposted" : own.some((m) => m.time && dayOf(r, m.time) === day) ? "day" : own.some((m) => !m.time) ? "untimed" : "other";
        return { r, kind };
      }).filter((x): x is { r: any; kind: keyof typeof RANK } => x.kind !== "other").sort((a, b) => RANK[a.kind] - RANK[b.kind]).slice(0, 12);
      const rows = classed.map((x) => x.r);
      const when = `${ask.day === "tomorrow" ? "Tomorrow" : "Today"} (${dateRange(day, day)})`;
      if (!rows.length) return answer(q, { hits: [], pages: withPage(q, [{ title: "Predict: Scheduled matches", href: predictHref({ mode: "scheduled" }) }]), understood: { kind: "question", label: `${when}: no event has matches then, so there are no predictions for that day` } });
      const count = (k: keyof typeof RANK) => classed.filter((x) => x.kind === k).length;
      const onDay = count("day"), untimed = count("untimed");
      const pages = classed.filter((x) => x.kind !== "unposted").slice(0, 3).map(({ r }) => ({ title: `Predict: ${r.name}`, href: predictHref({ mode: "scheduled", pick: { kind: "event", season: Number(r.season), code: r.code } }) }));
      const n = (k: number) => `${k === 12 ? "12 or more" : k} event${k === 1 ? "" : "s"}`;
      const label = onDay === rows.length ? `${n(rows.length)} with matches; each one's predictions are in Predict`
        : onDay || untimed ? `${n(rows.length)}${onDay ? `, ${onDay} with matches that day` : ""}${untimed ? `, ${untimed} with a schedule posted but no match times yet` : ""}: their predictions are in Predict`
        : `${n(rows.length)}, none with a match schedule posted yet, so no predictions yet`;
      return answer(q, { hits: rows.map((r) => eventHit(r, now)), pages: pages.length ? withPage(q, pages) : pagesFor(q), understood: { kind: "question", label: `${when}: ${label}` } });
    }

    case "leaderboard": {
      if (!ask.region) {
        const { season, got: r, skipped } = await currentFirst((s) => rankings({ season: s, week: null, places: [], page: 1 }), (x) => !x.rows.length);
        const lines = r.rows.slice(0, 5).map((row) => teamLine(row.team, row.name, [`#${row.rank} worldwide`]));
        const title = `Top teams · ${seasonLabel(season)}`;
        return answer(q, {
          hits: [], pages: withPage(q, [{ title: `World rankings (${r.total} teams)`, href: `/rankings?season=${season}` }]),
          card: { kind: "leaderboard", title, lines, ...(lines.length ? {} : { none: `No ranked teams for ${seasonLabel(season)} yet.` }) },
          understood: { kind: "question", label: `${title}: the world rankings${fellBack(skipped, "")}`, season },
        });
      }
      const region = ask.region;
      const place = parsePlaces(region.key)?.[0];
      if (!place) return null;
      const { season, got: r, skipped } = await currentFirst((s) => rankings({ season: s, week: null, places: [place], page: 1 }), (x) => !x.rows.length);
      const lines = r.rows.slice(0, 5).map((row, i) => teamLine(row.team, row.name, [`#${i + 1} in ${region.name}`, `#${row.rank} worldwide`]));
      const href = `/rankings?season=${season}&region=${encodeURIComponent(ask.region.key)}`;
      const title = `Top teams in ${ask.region.name} · ${seasonLabel(season)}`;
      return answer(q, {
        hits: [], pages: withPage(q, [{ title: `${ask.region.name} rankings (${r.total} teams)`, href }]),
        card: { kind: "leaderboard", title, lines, ...(lines.length ? {} : { none: `No ranked teams in ${ask.region.name} for ${seasonLabel(season)} yet.` }) },
        understood: { kind: "question", label: `${title}: the region's rankings${fellBack(skipped, ` in ${ask.region.name}`)}`, place: { key: ask.region.key, name: ask.region.name }, season },
      });
    }

    case "stat": {
      const where = ask.region ? " AND t.country = ? AND t.state = ?" : "";
      const col = STAT_COLUMN[ask.stat];
      const { season, got: rows, skipped } = await currentFirst((season) => all<any>(
        `SELECT s.team, t.name, t.city, t.state, t.country, s.opr_np, ${PHASE_COLS}, s.wins, s.losses, s.ties
         FROM team_season_stats s JOIN teams t ON t.number = s.team
         WHERE s.season = ? AND s.matches >= ? AND ${col} IS NOT NULL AND ${teamPageSql("s.team", "t.name")}${where}
         ORDER BY ${col} DESC${ask.stat === "wins" ? ", s.losses ASC" : ""}, s.team LIMIT 5`,
        [season, RANKED_MIN_MATCHES, ...(ask.region ? [ask.region.country, ask.region.state] : [])]), (x) => !x.length);
      const value = (r: any) => ask.stat === "wins" ? `${r.wins}-${r.losses}-${r.ties}` : `${STAT_LABEL[ask.stat].replace(/^.*\((.+)\)$/, "$1").replace(/^Highest /, "")} ${fmt(r[col.slice(2)])}`;
      const lines = rows.map((r) => teamLine(Number(r.team), r.name, [value(r)], place(r.city, r.state)));
      const title = `${STAT_LABEL[ask.stat]}${ask.region ? ` in ${ask.region.name}` : ""} · ${seasonLabel(season)}`;
      return answer(q, {
        hits: [], pages: withPage(q, [{ title: "Rankings", href: `/rankings?season=${season}${ask.region ? `&region=${encodeURIComponent(ask.region.key)}` : ""}` }]),
        // The same teams as a table, sorted by the stat asked (most wins: the list's own order, its record a column).
        card: { kind: "leaderboard", title, lines, ...(lines.length ? { table: tableOf(rows, season, ({ opr: "opr", auto: "auto", teleop: "dc", endgame: "endgame", wins: "rank" } as const)[ask.stat]) } : { none: `No team has played ${RANKED_MIN_MATCHES}+ matches in ${seasonLabel(season)} yet.` }) },
        understood: { kind: "question", label: `${title}${ask.stat === "wins" ? "" : ", without penalties"}${fellBack(skipped, ask.region ? ` in ${ask.region.name}` : "")}`, season, ...(ask.region ? { place: { key: ask.region.key, name: ask.region.name } } : {}) },
      });
    }

    case "predict-next": {
      const named = await teamOf(ask.team, opts.prefer);
      if (!named) return null;
      if ("tied" in named) return whichAnswer(q, named);
      const team = named.hit;
      const base = await opts.ask(`when is ${team.ref}'s next match`);
      const name = cleanTeamName(Number(team.ref), team.title.replace(/^\d+\s*\|\s*/, "")) ?? team.ref;
      const href = predictHref({ mode: "scheduled", pick: { kind: "team", team: Number(team.ref) } });
      return { ...base, q, pages: withPage(q, [{ title: `Predict ${possessive(name)} matches`, href }]), understood: { kind: "question", label: `Will ${name} (${team.ref}) win their next match? Their next match, and Predict` } };
    }

    case "predict-versus": {
      // A season written as one ("2024-25") is the season of both the Compare and Predict.
      const sm = /(?:^|\s)(20\d\d)\s*[-–/]\s*(\d\d)(?=\s|$)/.exec(ask.rest);
      const season = sm && (Number(sm[1]) + 1) % 100 === Number(sm[2]) ? Number(sm[1]) : null;
      const rest = sm && season != null ? (ask.rest.slice(0, sm.index) + " " + ask.rest.slice(sm.index + sm[0].length)).replace(/\s+/g, " ").trim() : ask.rest;
      const vs = await versusAnswer(rest, opts.prefer, season);
      // A shared name still tied: its question stays, and Predict waits for the team chosen.
      const cs = vs?.hits.filter((h) => h.kind === "compare") ?? [];
      const c = cs.length === 1 ? cs[0] : null;
      if (!vs || !c?.compare || c.compare.teams.length !== 2) return vs ? { ...vs, q } : null;
      const [a, b] = c.compare.teams;
      const href = predictHref({ mode: "match", ...(season != null ? { season } : {}), red: [a.number], blue: [b.number] });
      return { ...vs, q, pages: withPage(q, [{ title: `Predict ${a.number} vs ${b.number}`, href }]), understood: { kind: "compare", label: `Who wins: ${a.name} (${a.number}) vs ${b.name} (${b.number}): Predict, and Compare` } };
    }

    case "event-winner": {
      const ev = await eventOf(ask.event, opts.prefer);
      if (!ev) return null;
      // Events before predictions began have no odds: the event, and the reason.
      if (ev.season != null && isLegacy(ev.season)) return answer(q, { hits: [ev], pages: pagesFor(q), understood: { kind: "question", label: `Who will win ${ev.title}: no odds for ${seasonLabel(ev.season)}, predictions start with ${seasonLabel(FIRST_PREDICT_SEASON)}`, season: ev.season } });
      return answer(q, { hits: [{ ...ev, section: "odds" }], pages: pagesFor(q), understood: { kind: "question", label: `Who will win ${ev.title}: its odds` } });
    }

    case "advance": {
      const named = await teamOf(ask.team, opts.prefer);
      if (!named) return null;
      if ("tied" in named) return whichAnswer(q, named);
      const team = named.hit;
      // This season's simulator, even before anyone has three rated matches (when the rankings still show last season's).
      const season = CURRENT_SEASON;
      const name = cleanTeamName(Number(team.ref), team.title.replace(/^\d+\s*\|\s*/, "")) ?? team.ref;
      const href = predictHref({ mode: "advancement", team: Number(team.ref), season });
      return answer(q, { hits: [{ ...team, section: "history" }], pages: withPage(q, [{ title: `${possessive(name)} advancement odds`, href }]), understood: { kind: "question", label: `${name} (${team.ref}) · Advancement odds` } });
    }

    case "award": {
      // A place's championship ("nj states") or Worlds as "who won" reads it; else the event the name search finds.
      const won = await eventWon(ask.event, opts.prefer);
      const [wonRow] = won ? await all<any>("SELECT season, code, name, type, venue, city, state, country, start, end, timezone FROM events WHERE season = ? AND code = ?", [won.season, won.code]) : [];
      let ev = wonRow ? eventHit(wonRow) : await eventOf(ask.event, opts.prefer);
      if (!ev) return null;
      // The event found, or (not held yet, or no such award recorded) the latest season the same event code gave it:
      // "who won Inspire at New Jersey Championship" in November is last season's winner, said with its season.
      const [found, code] = ev.ref.split(":");
      // A championship's division: FIRST posts the judged awards on the championship itself (its parent event), so a
      // division with none of that award recorded reads its parent's, said so on the card.
      const parentRow = (await all<{ division_code: string | null; name: string | null }>("SELECT d.division_code, p.name FROM events d LEFT JOIN events p ON p.season = d.season AND p.code = d.division_code WHERE d.season = ? AND d.code = ?", [Number(found), code]))[0];
      const parent = parentRow?.division_code ?? null;
      // A season named ("worlds 2024-25", "… in into the deep" as search rewrites it): that season's award only, never
      // an older season's said in its place.
      const named = /(?:^|\s)20\d\d(?:\s*[-\u2013/]\s*\d\d(?:\d\d)?)?(?=\s|$)/.test(ask.event);
      const since = named ? Number(found) : 0;
      const latestOf = async (c: string) => (await all<{ season: number }>("SELECT MAX(season) season FROM awards WHERE code = ? AND type = ? AND season <= ? AND season >= ?", [c, ask.award, Number(found), since]))[0]?.season;
      const own = await latestOf(code), fromParentSeason = parent != null ? await latestOf(parent) : undefined;
      // A championship whose divisions judge the award (Worlds 2024-25's Innovate Award, one per division): its
      // divisions' places, when they gave it more recently than the championship itself did.
      const divisionsSeason = parent == null ? (await all<{ season: number }>(
        "SELECT MAX(a.season) season FROM awards a JOIN events d ON d.season = a.season AND d.code = a.code WHERE d.division_code = ? AND a.type = ? AND a.season <= ? AND a.season >= ?",
        [code, ask.award, Number(found), since]))[0]?.season : undefined;
      // The championship's, unless the division has that award of its own as recently (some regions judge divisions).
      const fromParent = parent != null && fromParentSeason != null && (own == null || Number(fromParentSeason) > Number(own));
      const fromDivisions = !fromParent && divisionsSeason != null && (own == null || Number(divisionsSeason) > Number(own));
      const awardCode = fromParent ? parent! : code;
      const latest = fromParent ? fromParentSeason : fromDivisions ? divisionsSeason : own;
      const season = latest != null ? Number(latest) : Number(found);
      // A Winning or Finalist Alliance: its teams, never the FIRST Leadership Award's finalists FIRST files with them.
      const alliance = ask.award === "Winner" || ask.award === "Finalist";
      // Each division's places, its winners first, named by the division ("Edison Division").
      const rows = (fromDivisions
        ? await all<any>(
          `SELECT a.placement, a.team, a.name award, t.name, d.name division FROM awards a JOIN events d ON d.season = a.season AND d.code = a.code LEFT JOIN teams t ON t.number = a.team
           WHERE a.season = ? AND d.division_code = ? AND a.type = ? ORDER BY a.placement, d.name, a.team`, [season, code, ask.award])
        : await all<any>(
          "SELECT a.placement, a.team, a.name award, t.name FROM awards a LEFT JOIN teams t ON t.number = a.team WHERE a.season = ? AND a.code = ? AND a.type = ? ORDER BY a.placement, a.team",
          [season, awardCode, ask.award])).filter((r) => !alliance || !/leadership/i.test(r.award ?? ""));
      // A judged award's finalists, as FIRST names them ("Innovate Award … Finalist", placed 1 like its winner): after
      // its placed teams, said as finalists.
      const finalist = (r: any) => !alliance && /\bfinalist\s*$/i.test(String(r.award ?? ""));
      rows.sort((a, b) => Number(finalist(a)) - Number(finalist(b)));
      // An older season: that season's event, with its own dates and place, and the newer one said when it's still to
      // come or not posted ("The 2026–27 one (Nov 15, 2026) isn't held yet").
      // Only a newer one with no such award recorded: an older year asked, whose newer one has its winner, says nothing.
      // A season named says nothing of newer ones; a championship's divisions' awards are its own.
      const [newer] = named ? [] : await all<{ season: number; start: string | null; end: string | null }>("SELECT season, start, end FROM events e WHERE e.code = ? AND e.season > ? AND NOT EXISTS (SELECT 1 FROM awards a WHERE a.season = e.season AND (a.code IN (e.code, COALESCE(e.division_code, e.code)) OR a.code IN (SELECT d.code FROM events d WHERE d.season = e.season AND d.division_code = e.code)) AND a.type = ?) ORDER BY e.season DESC LIMIT 1", [code, season, ask.award]);
      const held = !!newer?.start && (newer.end ?? newer.start) < new Date().toISOString().slice(0, 10);
      const upcoming = newer?.start ? ` · The ${seasonLabel(Number(newer.season))} one (${dateRange(newer.start, newer.end)}) ${held ? "has no award posted yet" : "isn't held yet"}` : "";
      // That season's event, its own dates and place: never the season found's dates under the older season's label.
      const rowOf = async (c: string) => (await all<any>("SELECT season, code, name, type, division_code, venue, city, state, country, start, end, timezone FROM events WHERE season = ? AND code = ?", [season, c]))[0];
      if (season !== Number(found)) {
        const row = await rowOf(code);
        ev = (await search(code, 5, opts.prefer, new Set(["event"]), season)).find((h) => h.kind === "event" && h.ref === `${season}:${code}`)
          ?? (row ? eventHit(row) : { ...ev, ref: `${season}:${code}`, season, subtitle: seasonLabel(season), event: undefined });
      }
      const parentName = !fromParent ? "" : season === Number(found) && parentRow?.name ? parentRow.name
        : (await all<{ name: string }>("SELECT name FROM events WHERE season = ? AND code = ?", [season, parent!]))[0]?.name ?? parentRow?.name ?? parent!;
      // The result under the card is the event the awards were given at: the championship, whose Awards tab holds them.
      const shownHit: SearchHit = fromParent ? (await search(parent!, 5, opts.prefer, new Set(["event"]), season)).find((h) => h.kind === "event" && h.ref === `${season}:${parent}`)
        ?? await rowOf(parent!).then((row) => (row ? eventHit(row) : { ...ev!, ref: `${season}:${parent}`, title: parentName, season, subtitle: seasonLabel(season), event: undefined })) : ev;
      const place = (p: number) => (p === 1 ? "Winner" : `${p}${p === 2 ? "nd" : p === 3 ? "rd" : "th"} place`);
      // A place asked is a placed team's: a finalist's number is only FIRST's order in its list, never a place.
      const asked = ask.place != null ? rows.filter((r) => Number(r.placement) === ask.place && !finalist(r)) : [];
      // An alliance's teams are its captain and picks, which each row's own name says ("Finalist Alliance - Captain"),
      // never a place; the award is the alliance's, never one division's.
      // A division by its own words ("Edison Division"), its championship's name taken off.
      const division = (r: any) => (String(r.division ?? "").startsWith(ev!.title) ? String(r.division).slice(ev!.title.length).replace(/^[\s\-\u2013:]+/, "") || r.division : r.division);
      const lines = [...asked, ...rows.filter((r) => !asked.includes(r))].map((r) => teamLine(Number(r.team), r.name, alliance ? [] : [finalist(r) ? "Finalist" : place(Number(r.placement))],
        [r.award, fromDivisions ? division(r) : null].filter(Boolean).join(" · ") || undefined));
      // The award by its winner's name, never a finalist's ("… Finalist") nor a place's ("… 2nd Place").
      const award = (!alliance && String(rows.find((r) => !finalist(r))?.award ?? "").replace(/\s+\d(?:st|nd|rd|th) place$/i, "")) || `${AWARD_NAME[ask.award] ?? ask.award} Award`;
      return answer(q, {
        hits: [{ ...shownHit, section: "awards" }], pages: pagesFor(q),
        card: { kind: "event-awards", title: `${award} · ${fromParent ? parentName : ev.title} · ${seasonLabel(season)}`, lines, award: ask.award, ...(ask.place != null ? { place: ask.place } : {}), ...(await eventAwards(season, awardCode, fromParent ? parentName : ev.title)),
          ...(fromParent ? { note: `${ev.title} is a division of ${parentName}: its awards are given at the championship, so this is the championship's ${award}.` } : {}),
          ...(fromDivisions ? { note: `In ${seasonLabel(season)} the ${award} at ${ev.title} was judged in each division: every division's places, winners first.` } : {}),
          // A league meet gives no awards: a league's are given at its league tournament.
          ...(lines.length ? {} : { none: ev.event?.type === "LeagueMeet" ? `${ev.title} is a league meet, and league meets give no awards: a league's awards, the ${award} among them, are given at its league tournament.`
            : `No ${award} recorded at ${fromParent ? parentName : ev.title}${parent && !fromParent ? ` or its championship` : ""} ${named ? `in ${seasonLabel(season)}` : "in any season on record"}.` }) },
        understood: { kind: "question", label: `${ask.place != null && ask.place > 1 ? `Who got ${place(ask.place)} for the` : "Who won the"} ${award} at ${ev.title} (${seasonLabel(season)})${fromParent ? ` · given at ${parentName}` : ""}${upcoming}${ask.place != null && rows.length && !asked.length ? ` · No ${place(ask.place)} recorded` : ""}`, season },
      });
    }

    case "advanced": {
      // The newest event by that name with an advancement list (a league's tournament, a qualifier), every word of
      // the name in it; a season or year named, that one's.
      const sm = /(?:^|\s)(20\d\d)(?:\s*[-–/]\s*\d\d(?:\d\d)?)?(?=\s|$)/.exec(ask.event);
      const words = ask.event.replace(sm?.[0] ?? "", " ").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !/^(?:the|of|and|ftc)$/.test(w));
      if (!words.length) return null;
      const [ev] = await all<any>(
        `SELECT e.season, e.code, e.name, e.type, e.division_code, e.venue, e.city, e.state, e.country, e.start, e.end, e.timezone, a.slots, a.advances_to, a.rows, n.name to_name
         FROM advancement a JOIN events e ON e.season = a.season AND e.code = a.code LEFT JOIN events n ON n.season = a.season AND n.code = a.advances_to
         WHERE ${words.map(() => "lower(e.name) LIKE ?").join(" AND ")}${sm ? " AND (e.season = ? OR e.start LIKE ?)" : ""}
         ORDER BY e.season DESC, e.start DESC LIMIT 1`,
        [...words.map((w) => `%${w}%`), ...(sm ? [Number(sm[1]), `${sm[1]}%`] : [])]);
      if (!ev) return null;
      const rows = JSON.parse(ev.rows) as { team: number; status: string; declined: boolean }[];
      const took = rows.filter((r) => r.status === "FIRST" && !r.declined);
      // A list posted with no slot taken (every one declined, or its teams already qualified): its teams, each with why,
      // as the event's Awards tab lists them; each team once.
      const shown = took.length ? took : rows.filter((r, i) => rows.findIndex((x) => x.team === r.team) === i);
      const names = shown.length ? await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${shown.map(() => "?").join(", ")})`, shown.map((r) => r.team)) : [];
      const nameOf = new Map(names.map((t) => [Number(t.number), t.name]));
      // Where they go, in words: the next event's name, FTC Events' own words, else "the next event" (never a code).
      const to = ev.to_name?.trim() || (ev.advances_to && !/^[A-Z0-9]+$/.test(ev.advances_to.trim()) ? ev.advances_to.trim().replace(/ Events$/, " events") : null);
      const dest = to ? (/^the\b/i.test(to) ? to : `the ${to}`) : "the next event";
      const why = (r: (typeof rows)[number]) => (r.status === "FIRST" ? "Declined" : r.status === "ALREADY_ADVANCING" ? "Already qualified" : r.status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()));
      const lines = shown.map((r, i) => ({ ...teamLine(r.team, nameOf.get(r.team) ?? null, [took.length ? `#${i + 1} in advancement order` : why(r)]), href: `/teams/${r.team}?season=${ev.season}` }));
      const n = took.length;
      const said = `${n} team${n === 1 ? "" : "s"} advanced from ${ev.name} to ${dest}`;
      const season = seasonLabel(Number(ev.season));
      const slots = `${ev.slots} slot${ev.slots === 1 ? "" : "s"} to ${dest}`;
      // Why no slot was taken, from the reasons the list holds only ("declined or had already qualified"), as each team's
      // own line says it.
      const REASON: Record<string, string> = { Declined: "declined", "Already qualified": "had already qualified", Ineligible: "was ineligible" };
      const reasons = [...new Set(shown.map((r) => REASON[why(r)] ?? `was listed as ${why(r).toLowerCase()}`))];
      const reasonWords = reasons.length > 1 ? `${reasons.slice(0, -1).join(", ")} or ${reasons[reasons.length - 1]}` : reasons[0];
      // A count is said only from a posted list: none posted is not zero.
      return answer(q, {
        hits: [{ ...eventHit(ev), section: "awards" }], pages: pagesFor(q),
        card: { kind: "info", title: `${ask.count && rows.length ? said : `Teams that advanced from ${ev.name}`} · ${season}`, lines,
          ...(n ? {} : { none: rows.length ? `No team took ${ev.slots === 1 ? `the slot to ${dest}` : `one of the ${slots}`}: ${reasons.length > 1 ? "each listed team" : shown.length > 1 ? "every listed team" : "the listed team"} ${reasonWords}.` : `FIRST hasn't posted who advanced from ${ev.name} (${season}) yet: ${slots}.` }) },
        understood: { kind: "question", label: `${rows.length ? said : `Who advanced from ${ev.name}`} (${season}), in FIRST's advancement order`, season: Number(ev.season) },
      });
    }

    case "event-won": {
      const won = await eventWon(ask.event, opts.prefer);
      if (!won) return null;
      // The winning alliance(s) as FIRST names them (a championship with divisions names each division's), then the
      // Inspire Award winner. Nothing is inferred from match scores.
      const rows = await all<any>(
        `SELECT a.type, a.placement, a.team, a.name award, t.name FROM awards a LEFT JOIN teams t ON t.number = a.team
         WHERE a.season = ? AND a.code = ? AND ((a.type = 'Winner' AND COALESCE(a.name, '') NOT LIKE '%Leadership%') OR (a.type = 'Inspire' AND a.placement = 1)) ORDER BY a.type = 'Inspire', substr(a.name, 1, instr(a.name, 'Winning')), a.placement, a.team`,
        [won.season, won.code]);
      // The playoff champions first (the Playoffs tab's), by the winning-alliance rule: they're the answer even where
      // FIRST posts no awards (a division's are on its championship).
      const champions = await eventChampions(won.season, won.code);
      const lines = rows.length ? rows.map((r) => teamLine(Number(r.team), r.name, [String(r.award ?? (r.type === "Inspire" ? "Inspire Award" : "Winning Alliance")).replace(/<[^>]+>/g, "")]))
        : champions.flatMap((c) => c.teams.map((t) => ({ text: t.label, href: t.href, results: [c.label] })));
      // The event row as event sets show it (its dates, place and status).
      const [row] = await all<any>("SELECT season, code, name, type, division_code, venue, city, state, country, start, end, timezone FROM events WHERE season = ? AND code = ?", [won.season, won.code]);
      const ev = eventHit(row);
      // The event's awards, else (a division) its championship's, where FIRST posts them.
      let awards = await eventAwards(won.season, won.code, won.name);
      if (!awards.awards?.length && row?.division_code) {
        const [parent] = await all<{ name: string }>("SELECT name FROM events WHERE season = ? AND code = ?", [won.season, row.division_code]);
        if (parent) awards = await eventAwards(won.season, row.division_code, parent.name);
      }
      const none = !lines.length && !champions.length && !awards.awards?.length;
      return answer(q, {
        hits: [{ ...ev, section: "playoffs" }], pages: pagesFor(q),
        card: { kind: "event-awards", title: `Who won · ${won.name} · ${seasonLabel(won.season)}`, lines, ...awards, ...(champions.length ? { champions } : {}), ...(none ? { none: `No results are recorded for ${won.name} (${seasonLabel(won.season)}) yet.` } : {}) },
        understood: { kind: "question", label: `Who won ${won.name} (${seasonLabel(won.season)}): the winning alliance and the Inspire Award`, season: won.season },
      });
    }
  }
}
