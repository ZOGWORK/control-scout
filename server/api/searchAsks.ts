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
import { teamPageSql } from "../../src/shared/teamPages.js";
import { CURRENT_SEASON, FIRST_PREDICT_SEASON, isLegacy } from "../data/seasons.js";
import { all } from "../db.js";
import { rankings } from "./rankings.js";
import { searchSeason } from "./answers/season.js";
import { search } from "./search.js";
import { fuzzyScore } from "./fuzzy.js";
import { PHASE_COLS, tableOf } from "./teamTableRows.js";
import { eventHit, localTodays, searchToday } from "./searchEvents.js";
import { namedTeam, versusAnswer } from "./searchCompare.js";
import { eventChampions } from "./answers/families/winners.js";

export type Stat = "opr" | "auto" | "teleop" | "endgame" | "wins";
export type Ask =
  | { kind: "leaderboard"; region: Region | null }
  | { kind: "stat"; stat: Stat; region: Region | null }
  | { kind: "predict-next"; team: string }
  | { kind: "predict-versus"; rest: string }
  | { kind: "event-winner"; event: string }
  | { kind: "advance"; team: string }
  | { kind: "award"; award: string; event: string }
  | { kind: "event-won"; event: string }
  | { kind: "how" }
  /** How to get a call for any lineup, or whether it updates as the lineup changes: Predict's Custom matchup. */
  | { kind: "predict-lineup" }
  /** Which predictions can be picked out: Predict's Scheduled matches, by team or event. */
  | { kind: "predict-filter" }
  /** One team's predictions page ("12345 prediction settings"): its matches in Predict. */
  | { kind: "predict-team"; team: string }
  /** The calls for a day's matches: that day's events. */
  | { kind: "predict-day"; day: "today" | "tomorrow" };

/** Words for a forecast, in a question about Predict itself. */
const FORECAST_WORDS = /\b(?:predict|predicts|predicted|prediction|predictions|forecasts?|odds|win (?:probabilit(?:y|ies)|chances?)|who (?:would|will) win)\b/;
/** A lineup someone makes up, or changes. */
const OWN_LINEUP = /\b(?:teams? (?:i|you|we) (?:pick|choose|select|want)|(?:my|our) own teams|any teams|custom (?:match(?:up)?|lineup|alliances?)|hypothetical|change (?:the |an |my |our )?(?:alliances?|teams|lineup|partners?)|swap(?:ping)? (?:the )?teams|(?:has ?n['’]?t|has not|have ?n['’]?t|have not|not) (?:happened|been played|played)(?: yet)?)\b/;

const STAT_LABEL: Record<Stat, string> = { opr: "Highest OPR", auto: "Best auto (auto OPR)", teleop: "Best teleop (teleop OPR)", endgame: "Best endgame (endgame OPR)", wins: "Most wins" };
const STAT_COLUMN: Record<Stat, string> = { opr: "s.opr_np", auto: "s.opr_auto", teleop: "s.opr_teleop", endgame: "s.opr_endgame", wins: "s.wins" };

/** The award types as FIRST stores them, by the word people use. "control" here is the Control Award. */
const AWARDS: Record<string, string> = {
  inspire: "Inspire", think: "Think", innovate: "Innovate", design: "Design", reach: "Reach", sustain: "Sustain",
  connect: "Connect", control: "Control", motivate: "Motivate", compass: "Compass", judges: "JudgesChoice", "judges choice": "JudgesChoice",
  "deans list": "DeansList", "dean's list": "DeansList",
};
/** An award type's name in words, where FIRST's type isn't one ("JudgesChoice"). */
const AWARD_NAME: Record<string, string> = { JudgesChoice: "Judges' Choice", DeansList: "Dean's List" };

/** A region named by the words `s` (all of them), or null. */
const regionWords = (s: string): Region | null => regionOf(s.trim().replace(/^(?:the )?(?:state of )?/i, "").split(/\s+/).filter(Boolean));

/** Words that only say "everyone, this season": a leaderboard's scope is the world's unless a place is named. */
const SCOPE_WORDS = /(?:^| )(?:right now|currently|now|today|this season|this year|in the (?:whole )?world|of the world|worldwide|globally|overall|of all time|all time|of all|ever)(?= |$)/g;

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
  let d = /\bpredictions?\b.*\b(today|tomorrow)(?:['’]?s)?\b.*\b(?:matches|match|games)\b|\b(today|tomorrow)(?:['’]?s)?\b.*\b(?:matches|match|games)\b.*\bpredictions?\b/.exec(t);
  if (d && !/\d/.test(t)) return { kind: "predict-day", day: (d[1] ?? d[2]) as "today" | "tomorrow" };
  d = /^(.+?) (?:prediction|predictions|predict|forecast) (?:settings|options|page|tool|view)$/.exec(t);
  if (d) return { kind: "predict-team", team: d[1] };
  // Leaderboards: the world's ("best team", "what is the best FTC team right now") or a place's.
  const lw = leaderWords(t);
  if (/^(?:the )?(?:top|best|highest(?: |-)ranked|strongest|number one|no 1|1)(?: \d+)? (?:teams?|robots?)$/.test(lw.t) || (lw.opened && /^(?:best|top|strongest|number one)$/.test(lw.t))) return { kind: "leaderboard", region: null };
  let m = /^(?:the )?(?:top|best|highest(?: |-)ranked|strongest)(?: \d+)? (?:teams?|robots?)(?: in| from| of)? (.+)$/.exec(lw.t);
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
  m = /^who (?:won|got|received|took) (?:the )?(.+?)(?: award)? at (?:the )?(.+)$/.exec(t);
  if (m) {
    const w = m[1].replace(/['’]/g, ""); // "Judges' Choice", "Judges’ Choice"
    if (Object.hasOwn(AWARDS, w)) return { kind: "award", award: AWARDS[w], event: m[2] };
  }
  // Who won an event ("who won nj states", "winners of the New Jersey Championship"): never "won" as a name word.
  m = /^(?:who (?:won|took|was the winner of|were the winners of|were the champions of|was the champion of)|winners? of|champions? of) (?:the )?(.+)$/.exec(t);
  // "Who took the most penalties" is a measure, never an event.
  if (m && !/^(?:most|fewest|least|highest|lowest|best|worst|first|last|top|longest|biggest|more|fewer)\b/.test(m[1]) && !Object.hasOwn(AWARDS, m[1].replace(/['’]/g, "").replace(/ award$/, ""))) return { kind: "event-won", event: m[1].split(" ").map((w) => cased.get(w) ?? w).join(" ") };
  return null;
}

/** An event's whole award list and the event itself, as its Awards tab has them (server/api/events.ts's order). */
async function eventAwards(season: number, code: string, name: string): Promise<Pick<SearchCard, "event" | "awards">> {
  const rows = await all<any>(
    `SELECT a.type, a.placement, a.team, a.name, t.name team_name FROM awards a LEFT JOIN teams t ON t.number = a.team WHERE a.season = ? AND a.code = ?
     ORDER BY CASE a.type WHEN 'Inspire' THEN 0 WHEN 'Winner' THEN 1 WHEN 'Finalist' THEN 2 ELSE 3 END, a.type, a.placement`, [season, code]);
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
  const fits = (name: string) => fuzzyScore(named, name) >= 0.75;
  const lead = hits.filter((h) => fits(h.title));
  if (!hits.length) return null;
  const pool = lead.length ? lead : [hits[0]];
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

async function eventOf(words: string, prefer: ReadonlySet<string>): Promise<SearchHit | null> {
  return (await search(words, 3, prefer, new Set(["event"]))).find((h) => h.kind === "event") ?? null;
}

/** The answer for `ask`, or null when what it names isn't found (search goes on as before). */
export async function askAnswer(q: string, ask: Ask, opts: { prefer: ReadonlySet<string>; ask: (q: string) => Promise<SearchAnswer> }): Promise<SearchAnswer | null> {
  switch (ask.kind) {
    case "how":
      return answer(q, { hits: [], pages: withPage(q, [{ title: "How predictions are calculated", href: "/methodology" }]), understood: { kind: "question", label: "How predictions are calculated: the methodology page" } });

    case "predict-lineup":
      return answer(q, { hits: [], pages: withPage(q, [{ title: "Predict: Custom matchup", href: predictHref({ mode: "match" }) }]),
        understood: { kind: "question", label: "Yes: Predict's Custom matchup takes any teams on each alliance, and the win chance and predicted score update as you change them" } });

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
      const rows = await all<any>(
        `SELECT season, code, name, type, venue, city, state, country, start, end, timezone, division_code FROM events
         WHERE start <= ? AND COALESCE(end, start) >= ? AND COALESCE(remote, 0) = 0 ORDER BY start, name LIMIT 12`, [day, day]);
      const when = `${ask.day === "tomorrow" ? "Tomorrow" : "Today"} (${dateRange(day, day)})`;
      if (!rows.length) return answer(q, { hits: [], pages: withPage(q, [{ title: "Predict: Scheduled matches", href: predictHref({ mode: "scheduled" }) }]), understood: { kind: "question", label: `${when}: no event has matches then, so there are no predictions for that day` } });
      const pages = rows.slice(0, 3).map((r) => ({ title: `Predict: ${r.name}`, href: predictHref({ mode: "scheduled", pick: { kind: "event", season: Number(r.season), code: r.code } }) }));
      return answer(q, { hits: rows.map((r) => eventHit(r, now)), pages: withPage(q, pages),
        understood: { kind: "question", label: `${when}: ${rows.length === 12 ? "12 or more" : rows.length} event${rows.length === 1 ? "" : "s"} with matches; each one's predictions are in Predict` } });
    }

    case "leaderboard": {
      const season = searchSeason();
      if (!ask.region) {
        const r = await rankings({ season, week: null, places: [], page: 1 });
        const lines = r.rows.slice(0, 5).map((row) => teamLine(row.team, row.name, [`#${row.rank} worldwide`]));
        const title = `Top teams · ${seasonLabel(season)}`;
        return answer(q, {
          hits: [], pages: withPage(q, [{ title: `World rankings (${r.total} teams)`, href: `/rankings?season=${season}` }]),
          card: { kind: "leaderboard", title, lines, ...(lines.length ? {} : { none: `No ranked teams for ${seasonLabel(season)} yet.` }) },
          understood: { kind: "question", label: `${title}: the world rankings`, season },
        });
      }
      const region = ask.region;
      const place = parsePlaces(region.key)?.[0];
      if (!place) return null;
      const r = await rankings({ season, week: null, places: [place], page: 1 });
      const lines = r.rows.slice(0, 5).map((row, i) => teamLine(row.team, row.name, [`#${i + 1} in ${region.name}`, `#${row.rank} worldwide`]));
      const href = `/rankings?season=${season}&region=${encodeURIComponent(ask.region.key)}`;
      const title = `Top teams in ${ask.region.name} · ${seasonLabel(season)}`;
      return answer(q, {
        hits: [], pages: withPage(q, [{ title: `${ask.region.name} rankings (${r.total} teams)`, href }]),
        card: { kind: "leaderboard", title, lines, ...(lines.length ? {} : { none: `No ranked teams in ${ask.region.name} for ${seasonLabel(season)} yet.` }) },
        understood: { kind: "question", label: `${title}: the region's rankings`, place: { key: ask.region.key, name: ask.region.name }, season },
      });
    }

    case "stat": {
      const season = searchSeason();
      const where = ask.region ? " AND t.country = ? AND t.state = ?" : "";
      const col = STAT_COLUMN[ask.stat];
      const rows = await all<any>(
        `SELECT s.team, t.name, t.city, t.state, t.country, s.opr_np, ${PHASE_COLS}, s.wins, s.losses, s.ties
         FROM team_season_stats s JOIN teams t ON t.number = s.team
         WHERE s.season = ? AND s.matches >= ? AND ${col} IS NOT NULL AND ${teamPageSql("s.team", "t.name")}${where}
         ORDER BY ${col} DESC${ask.stat === "wins" ? ", s.losses ASC" : ""}, s.team LIMIT 5`,
        [season, RANKED_MIN_MATCHES, ...(ask.region ? [ask.region.country, ask.region.state] : [])]);
      const value = (r: any) => ask.stat === "wins" ? `${r.wins}-${r.losses}-${r.ties}` : `${STAT_LABEL[ask.stat].replace(/^.*\((.+)\)$/, "$1").replace(/^Highest /, "")} ${fmt(r[col.slice(2)])}`;
      const lines = rows.map((r) => teamLine(Number(r.team), r.name, [value(r)], [r.city, r.state].filter(Boolean).join(", ")));
      const title = `${STAT_LABEL[ask.stat]}${ask.region ? ` in ${ask.region.name}` : ""} · ${seasonLabel(season)}`;
      return answer(q, {
        hits: [], pages: withPage(q, [{ title: "Rankings", href: `/rankings?season=${season}${ask.region ? `&region=${encodeURIComponent(ask.region.key)}` : ""}` }]),
        // The same teams as a table, sorted by the stat asked (most wins: the list's own order, its record a column).
        card: { kind: "leaderboard", title, lines, ...(lines.length ? { table: tableOf(rows, season, ({ opr: "opr", auto: "auto", teleop: "dc", endgame: "endgame", wins: "rank" } as const)[ask.stat]) } : { none: `No team has played ${RANKED_MIN_MATCHES}+ matches in ${seasonLabel(season)} yet.` }) },
        understood: { kind: "question", label: `${title}${ask.stat === "wins" ? "" : ", without penalties"}`, season, ...(ask.region ? { place: { key: ask.region.key, name: ask.region.name } } : {}) },
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
      const latest = await all<{ season: number }>("SELECT MAX(season) season FROM awards WHERE code = ? AND type = ? AND season <= ?", [code, ask.award, Number(found)]);
      const season = latest[0]?.season != null ? Number(latest[0].season) : Number(found);
      const rows = await all<any>(
        "SELECT a.placement, a.team, a.name award, t.name FROM awards a LEFT JOIN teams t ON t.number = a.team WHERE a.season = ? AND a.code = ? AND a.type = ? ORDER BY a.placement, a.team",
        [season, code, ask.award]);
      // An older season: that season's event, with its own dates and place, and the newer one said when it's still to
      // come or not posted ("The 2026–27 one (Nov 15, 2026) isn't held yet").
      // Only a newer one with no such award recorded: an older year asked, whose newer one has its winner, says nothing.
      const [newer] = await all<{ season: number; start: string | null; end: string | null }>("SELECT season, start, end FROM events e WHERE e.code = ? AND e.season > ? AND NOT EXISTS (SELECT 1 FROM awards a WHERE a.season = e.season AND a.code = e.code AND a.type = ?) ORDER BY e.season DESC LIMIT 1", [code, season, ask.award]);
      const held = !!newer?.start && (newer.end ?? newer.start) < new Date().toISOString().slice(0, 10);
      const upcoming = newer?.start ? ` · The ${seasonLabel(Number(newer.season))} one (${dateRange(newer.start, newer.end)}) ${held ? "has no award posted yet" : "isn't held yet"}` : "";
      if (season !== Number(found)) ev = (await search(code, 5, opts.prefer, new Set(["event"]), season)).find((h) => h.kind === "event" && h.ref === `${season}:${code}`)
        ?? { ...ev, ref: `${season}:${code}`, season, subtitle: seasonLabel(season) };
      const place = (p: number) => (p === 1 ? "Winner" : `${p}${p === 2 ? "nd" : p === 3 ? "rd" : "th"} place`);
      const lines = rows.map((r) => teamLine(Number(r.team), r.name, [place(Number(r.placement))], r.award ?? undefined));
      const award = rows[0]?.award ?? `${AWARD_NAME[ask.award] ?? ask.award} Award`;
      return answer(q, {
        hits: [{ ...ev, section: "awards" }], pages: pagesFor(q),
        card: { kind: "event-awards", title: `${award} · ${ev.title} · ${seasonLabel(season)}`, lines, award: ask.award, ...(await eventAwards(season, code, ev.title)), ...(lines.length ? {} : { none: `No ${award} recorded at ${ev.title} in any season on record.` }) },
        understood: { kind: "question", label: `Who won the ${award} at ${ev.title} (${seasonLabel(season)})${upcoming}`, season },
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
