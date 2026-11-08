// A parsed query run as a structured query over the stored data (docs/search-pipeline.md, "Execute"): the slots
// become the question objects the family answers already take (server/api/answers/: a StatQuestion, a
// TwoTeamQuestion, a TopMatchesQuestion, a LeaderboardQuestion). They are built from the slots, never by reading text
// again, and answered with the families' own cards. A parse that isn't complete, or an intent no family takes, is
// left to search's other readers (null).
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import type { Region } from "../../../src/shared/regions.js";
import { dateRange, seasonLabel } from "../../../src/shared/format.js";
import { all, get } from "../../db.js";
import { intentDefaults, readLeaderboard, scopeFits, type IntentId, type LeaderboardQuestion, type ReadScope, type StatQuestion, type TwoTeamId } from "../answers/read.js";
import { allianceForecast, predictionSeasonOf } from "../answers/families/predict.js";
import { isLegacy } from "../../data/seasons.js";
import { predictHref } from "../../../src/shared/predictUrl.js";
import { boardSearch, statAnswer, statAnswerOf, topSearch, twoTeamSearch, type Resolve } from "../answers/index.js";
import { searchSeason } from "../answers/season.js";
import { BOARD_STATS } from "../answers/families/leaderboard.js";
import type { TopMatchesQuestion } from "../answers/families/topMatches.js";
import { defaultSteps, isEmpty, relaxed, windowSteps } from "./relax.js";
import { eventsNamed, heldInYear, highlightsAnswer, latestPlayed, scopeEvents, type HighlightFind } from "./highlights.js";
import { teamHighlights, type TeamHighlightScope } from "../answers/highlights.js";
import { shortEvent } from "../answers/matchSet.js";
import { CHAMPIONSHIP_TYPE, OFFICIAL_TYPES, STATES_TYPE } from "../answers/clauses.js";
import { eventKindOf, matchFindAnswer, type MatchFind, type MatchMeasure } from "./matchFind.js";
import { seasonOfDate } from "./time.js";
import { searchToday } from "../searchEvents.js";
import { eventFor, forecastAt, teamEventOfType } from "./forecast.js";
import { teamsNamedSearch } from "../answers/teamsNamed.js";
import { pickAnswer, teamPickEvent } from "../answers/families/pick.js";
import { describe, normalise, parseQuery, type Parsed } from "./parse.js";
import { parseContext } from "./context.js";
import { topTeamsNote, topTeamsSaid } from "./topTeams.js";
import type { PipelineIntent } from "./intents.js";

export interface PipelineOptions { full: boolean; pages: SearchPageLink[]; resolve: Resolve; now?: number; prefer?: ReadonlySet<string> }

/** The pipeline's answer for `q`, or null when it leaves the query to search's other readers. */
export async function pipelineAnswer(q: string, opts: PipelineOptions): Promise<SearchAnswer | null> {
  const ctx = await parseContext(opts.now, opts.prefer);
  let p = await parseQuery(q, ctx);
  // A place's top team said where a team would be ("the top NJ team vs the top Romania team"): two teams compared,
  // read again with their numbers, the card saying which team each phrase was.
  let tops: Awaited<ReturnType<typeof topTeamsSaid>> = null;
  if (!p.complete || !p.intent) {
    // The season the question names picks each place's leader too ("in 2024-25, the top NJ team vs …").
    tops = await topTeamsSaid(q, ctx, p.time?.kind === "season" && p.time.season != null ? p.time.season : undefined);
    const again = tops ? await parseQuery(tops.q, ctx) : null;
    if (!again?.complete || !again.intent || again.teams.length !== 2 || !TWO_TEAM[again.intent]) return null;
    p = { ...again, q };
  }
  if (!p.intent) return null;
  let a = await execute(p, opts);
  if (!a) return null;
  if (tops && a.understood) a = { ...a, understood: { ...a.understood, label: `${a.understood.label} · ${topTeamsNote(tops.said, tops.season)}` } };
  // Part of a region ("north jersey") is read as all of it, and the card says so.
  if (p.place?.part && a.understood) a = { ...a, understood: { ...a.understood, label: `${a.understood.label} · ${p.place.part.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())} isn't a separate region: all of ${p.place.name}` } };
  // A team's name typed nearly right: answered for that team, with the spelling to search for.
  const near = p.teams.filter((t) => t.via === "near" && t.name);
  if (near.length) {
    // The words as typed, whatever stood between them ("hypnotc-robotics"), so the spelling replaces them.
    const typedAt = (typed: string) => new RegExp(typed.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]+"), "iu");
    const fixed = near.reduce((s, t) => s.replace(typedAt(t.typed), t.name!), q);
    a = { ...a, step: "did-you-mean", didYouMean: fixed };
  }
  // How the query was read, slot by slot: the card states the filters it applied.
  return { ...a, intent: { ...(a.intent ?? { kind: `pipeline-${p.intent}`, pattern: p.intent, met: true, understood: [] }), understood: describe(p) } };
}

/** Whether `q` asks about teams: one named, or which team in a place ("which team in New Jersey fouls the least").
 *  A rules question never does. */
export async function asksOfTeams(q: string, now?: number, prefer?: ReadonlySet<string>): Promise<boolean> {
  const p = await parseQuery(q, await parseContext(now, prefer));
  return p.teams.length > 0 || (!!p.place && /\b(?:teams?|who|whose)\b/i.test(q));
}

/** Whether the pipeline reads `q` completely (an intent it answers, every word explained). */
export async function pipelineReads(q: string, now?: number, prefer?: ReadonlySet<string>): Promise<boolean> {
  const p = await parseQuery(q, await parseContext(now, prefer));
  // A comparison is the pipeline's only at an event (or Worlds, or states): "12345 or 67890" stays the boolean reader's.
  return p.complete && !!p.intent && ANSWERED.has(p.intent) && (p.intent !== "team-predict" || !!p.event || p.worlds || p.states) && (p.intent !== "count-teams" || townCount(p))
    && (p.intent !== "compare" || !!p.event || p.worlds || p.states);
}

/** A count of teams the pipeline answers: a town's, with no time, event, championship, match type, side or award said
 *  (its list is every team from the town, which none of those narrow). */
const townCount = (p: Parsed) => p.place?.kind === "city" && !p.time && !p.teams.length && !p.event && !p.eventKind && !p.worlds && !p.states
  && !p.level && !p.finals && !p.alliance && !p.award && p.n == null && !p.undefeated && !p.noPenalties;

/** The answers that list as many rows as a count said ("12345 last 3 matches"). */
const COUNTED = new Set<IntentId>(["last-matches"]);
/** The award answers that take "first" and "latest" ("12345 latest Inspire award"). */
const AWARD_LISTS = new Set<IntentId>(["awards", "total-awards", "inspire-awards"]);

/** A team's trend, asked of the reader that draws it in its own words ("12345 rating trend in 2025–26"), and the answer
 *  it has to give: any other is left to search. */
const TREND_ASK: Partial<Record<PipelineIntent, { ask: string; intent: string }>> = {
  "rating-trend": { ask: "rating trend", intent: "rating-trend" },
  "opr-trend": { ask: "opr history", intent: "opr-history" },
  "auto-trend": { ask: "auto opr history", intent: "auto-history" },
  "teleop-trend": { ask: "teleop opr history", intent: "teleop-history" },
  "endgame-trend": { ask: "endgame opr history", intent: "endgame-history" },
  "reliability-trend": { ask: "reliability history", intent: "reliability-history" },
};

/** Words that ask for two teams side by side, beside "or" alone ("12345 or 67890" is a search for either). */
const COMPARE_SAID = /\b(?:compare|comparison|compared|side by side|better|stronger)\b/;
/** The intents that are a stat answer's own (server/api/answers/read.ts IntentId), by the same name. */
const TEAM_INTENTS = new Set<PipelineIntent>([
  "highest-score", "lowest-score", "biggest-win", "biggest-loss", "closest-match", "first-match", "recent-match", "last-matches", "best-finish",
  "worst-finish", "average-rank", "first-event", "last-event", "best-season", "first-season", "wins-count", "losses", "ties-count",
  "record", "win-percent", "average-score", "median-score", "average-margin", "total-points", "total-matches", "total-events", "seasons-count",
  "current-streak", "longest-streak", "highest-auto", "highest-teleop", "highest-endgame", "most-penalties", "penalties", "score-range",
  "score-consistency", "awards", "total-awards", "results", "event-rank", "event-opr", "best-partner", "partners", "opponents", "playoff-matches",
  "qual-matches", "match-lookup", "avg-penalties", "lost-to-most", "season-matches",
]);
const TWO_TEAM: Partial<Record<PipelineIntent, TwoTeamId>> = {
  "head-to-head": "head-to-head", "shared-matches": "shared-matches", "h2h-wins": "h2h-wins", "opr-vs": "opr-vs", "rating-vs": "rating-vs",
  "awards-vs": "awards-vs", "two-predict": "predict", compare: "compare",
};
/** The two-team answers read from the matches the teams met in: the only ones an event, a match type or a side applies to. */
const MEETINGS = new Set<TwoTeamId>(["head-to-head", "h2h-wins", "shared-matches"]);
/** Every intent execute() answers (the rest are left to search's readers). */
/** The match finder's measure for each intent that asks for one (./matchFind.ts). */
const FIND: Partial<Record<PipelineIntent, MatchMeasure>> = {
  "low-matches": "low", "close-matches": "closest", "lopsided-matches": "lopsided", "penalty-matches": "penalties", "upset-matches": "upset", "comeback-matches": "comeback",
  "miss-matches": "miss", "accurate-matches": "accurate",
};
/** The match finder's measures one team's matches take ("<team>'s most unpredictable match"). */
const TEAM_FIND = new Set<MatchMeasure>(["miss", "accurate"]);
/** The matches a measure finds, in a sentence ("no 2026–27 upsets yet"). */
const MATCH_NOUN: Record<MatchMeasure, string> = {
  high: "scored matches", low: "scored matches", closest: "decided matches", lopsided: "decided matches", penalties: "matches with penalty points",
  upset: "upsets", comeback: "comebacks", miss: "matches with a saved prediction", accurate: "matches with a saved prediction",
};
/** A time's label that already reads alone ("in March 2026", "this week", "on Mar 15, 2026", "today"). */
const WHEN_WORD = /^(?:in|on|during|this|last|next|from|between|today|tonight|yesterday|tomorrow)\b/i;
/** A place's or the world's season (docs/search-pipeline.md, "Seasons"): the one said, else the current one (today's);
 *  "last season" is the one before the current one. A team's own season stays the latest it played (readScopeOf). */
function placeSeason(p: Parsed, said: number | null | undefined, opts: PipelineOptions): number {
  const current = seasonOfDate(searchToday(opts.now));
  if (p.time?.kind === "season" && p.time.relative === "last") return current - 1;
  return said ?? current;
}
/** The answers a win or a loss said with them narrows ("closest loss", "first win", "longest losing streak"). */
const OUTCOME_IDS = new Set(["closest-match", "current-streak", "average-margin", "first-match", "recent-match", "last-matches", "longest-streak"]);
const ANSWERED = new Set<PipelineIntent>([...TEAM_INTENTS, ...(Object.keys(TWO_TEAM) as PipelineIntent[]), ...(Object.keys(FIND) as PipelineIntent[]), "top-matches", "leaderboard", "team-predict", "highlights", "teams-named", "count-teams", "alliance-predict", "swap-predict", "pick-partners", ...(Object.keys(TREND_ASK) as PipelineIntent[])]);
/** The leaderboard's stat for a metric said ("by opr"); the prediction rating when none is. */
const BOARD_STAT: Partial<Record<string, string>> = {
  "metric:opr": "opr", "metric:rating": "rating", "metric:winrate": "win-rate", "metric:auto": "auto", "metric:teleop": "teleop",
  "metric:endgame": "endgame", "metric:record": "record", "metric:win": "wins", "metric:reliability": "reliability", "metric:penalty": "penalties",
};

async function execute(p: Parsed, opts: PipelineOptions): Promise<SearchAnswer | null> {
  const intent = p.intent!;
  // Rookie teams are listed only at an event (its board keeps its rookies); anywhere else the word is never dropped.
  if (p.rookie && !(intent === "leaderboard" && (p.event || p.worlds || p.states))) return null;
  if (intent === "teams-named") return teamsNamedSearch(p, opts);
  // A town's teams counted ("how many teams from <town>"): the town's list, its length the count. A region's or a
  // country's count is search's own (../searchCoverage.ts countAnswer).
  if (intent === "count-teams") return townCount(p) ? boardSearch(p.q, { kind: "city", stat: "opr", n: 25, region: null, city: p.place!.city, season: null }, opts) : null;
  const scope = readScopeOf(p);
  if (!scope) return null;
  // The finals are a filter the match finder applies (and a scope's highlights, read with its filters), and a team's
  // answers from its own match rows (scopeFits): anything else would answer for every playoff match.
  if (p.finals && !p.teams.length && !(FIND[intent] || intent === "top-matches" || intent === "highlights")) return null;
  // So is a kind of event by its type words alone ("at a league meet").
  if (p.eventKind && (p.teams.length || !(FIND[intent] || intent === "top-matches" || intent === "highlights"))) return null;
  const said = normalise(p.q);
  // A team's matches at Worlds or at its state championship are that event's results card (the division, its rank and
  // OPR there), which search's event readers give: the plain list is for a season, a window or a place.
  if (intent === "season-matches" && (p.worlds || p.states)) return null;
  if (p.teams.length === 1 && TEAM_INTENTS.has(intent)) {
    // An award with an answer of its own: Inspire (its places) and Finalist finishes. The first or latest Finalist
    // award is the award list's, filtered to Finalist, which takes the pick (Finalist finishes only counts them).
    const pickSaid = p.agg === "first" || p.agg === "last";
    const id = (p.award === "Inspire" && (intent === "awards" || intent === "total-awards") ? "inspire-awards"
      : p.award === "Finalist" && (intent === "awards" || intent === "total-awards") && !pickSaid ? "finalist-finishes" : intent) as IntentId;
    const d = intentDefaults(id);
    if (!d || !scopeFits(id, d.family, scope)) return null;
    // A count said ("top 3 scores") applies only where the answer lists that many; elsewhere it's left to search
    // rather than answered with a different number of rows.
    if (p.n != null && !COUNTED.has(id)) return null;
    // A season's penalty total is its own reader's ("12345 total penalties"); here only an event's.
    if (id === "penalties" && (p.symbols.includes("agg:sum") || p.symbols.includes("agg:count")) && !p.symbols.includes("per:match") && !scope.at) return null;
    const team = p.teams[0];
    // "12345 at worlds in 2026": the championship held that year (2025–26), as the readers take a year there.
    const held = id === "results" && scope.championship && scope.year && scope.season != null;
    if (held) { scope.season! -= 1; scope.year = false; }
    // A season or a year with no events on record yet (a future year): said so, never the latest instead.
    const future = held ? null : await noEventsYet(p, team.number, id, opts);
    if (future) return future(opts);
    const named = scope.season != null || scope.latest || scope.ever || scope.championship || scope.states || !!scope.at || !!scope.window;
    const outcome = p.symbols.includes("outcome:L") || (p.symbols.includes("metric:loss") && intent !== "losses") ? "L" : p.symbols.includes("outcome:W") || (p.symbols.includes("metric:win") && OUTCOME_IDS.has(intent) && intent !== "average-margin") ? "W" : null;
    const it: StatQuestion = {
      id, family: d.family, defaultSeason: d.alone && !named ? d.alone : d.season, scope,
      leadEvent: id === "highest-score" && p.symbols.includes("thing:event"),
      n: id === "match-lookup" ? p.matchNumber : p.n ?? (id === "last-matches" ? 5 : null), outcome: OUTCOME_IDS.has(id) ? outcome : null,
      count: p.agg === "count", noTeam: false, core: String(team.number),
      ...(p.award && (id === "awards" || id === "total-awards") ? { award: p.award } : {}),
      ...(AWARD_LISTS.has(id) && (p.agg === "first" || p.agg === "last") ? { pick: p.agg === "first" ? "first" : "latest" } : {}),
      // "How many penalty points", "in total": the total first; "per match" said with it is the per-match figure; a trend
      // with no measure said ("getting better or worse at penalties") is the per-event one.
      ...(id === "penalties" ? { variant: p.symbols.includes("per:event") ? "per-event" : p.symbols.includes("per:rate") ? "rate" : p.symbols.includes("per:match") ? null : p.symbols.includes("agg:sum") || p.symbols.includes("agg:count") ? "total" : p.symbols.includes("trend") ? "per-event" : null } : {}),
      ...(id === "record" && p.symbols.includes("per:event") ? { variant: "per-event" as const } : {}),
    };
    const a = await statAnswerOf(p.q, it, opts.resolve, opts);
    // Nothing in the window asked ("this week"): its season, then the season before, said on the card.
    // A window with its year typed ("march 2026", a date) keeps that year: only a window said against today is relaxed.
    if (!opts.full || !scope.window || scope.season == null || p.time?.year != null) return a;
    return relaxed(a, windowSteps(scope.window, scope.season), (season) => statAnswerOf(p.q, { ...it, scope: { ...scope, window: undefined, season } }, opts.resolve, opts));
  }
  // A forecast at an event named: before and after, side by side (./forecast.ts). With no event, two teams' head-on
  // call (the engine's, with Predict open on it); one team's next match or event is left to the readers that know
  // which ("predicted score next match", "predicted wins at their next event").
  // One team's Worlds or state championship ("advancement odds at worlds") is its own division there.
  // Reaching Worlds or states ("chance of making worlds next year"): the chance to advance from the team's next
  // event, the stored projection's, as "chance to advance to worlds" reads; never a forecast made at Worlds itself.
  if (intent === "team-predict" && p.reach && !p.event && p.teams.length === 1) {
    // The projection is the next event's as things stand: a season, a day or all time said asks for another answer.
    if (scope.level || scope.alliance || scope.place || scope.area || scope.window || scope.at || p.time) return null;
    const a = await statAnswer(`${p.teams[0].number} chance to advance to ${p.worlds ? "worlds" : "states"}`, opts.resolve, { full: opts.full, pages: opts.pages });
    return a && a.intent?.kind === "stat-advance-chance" ? { ...a, q: p.q } : null;
  }
  const ownChampionship = intent === "team-predict" && !p.event && p.teams.length === 1 && (p.worlds || p.states);
  if ((intent === "team-predict" || intent === "two-predict") && (p.event || ownChampionship)) {
    // The card lists every forecast at the event: a count asked ("last 3 predictions") is left to the other readers.
    if (scope.level || scope.alliance || scope.place || scope.area || scope.window || (p.event && (p.worlds || p.states)) || p.n != null) return null;
    // A calendar year ("2025") is the event held that year; a season or a game named ("2025-26", "decode") its season.
    const year = p.time?.kind === "season" && p.time.year != null ? p.time.year : null;
    const season = p.time?.kind === "season" && p.time.year == null && !p.time.relative && p.time.season != null ? p.time.season : null;
    if (p.time && year == null && season == null) return null;
    const found = p.event ? await eventFor(p.event.words, p.teams.map((t) => t.number), year, season)
      : await teamEventOfType(p.teams[0].number, p.worlds ? CHAMPIONSHIP_TYPE : STATES_TYPE, season, year);
    if (!found) return null;
    const stat = await forecastAt(p.teams.map((t) => ({ number: t.number, name: t.name })), found.ev, found.listed, opts.now ?? Date.now(), { advance: p.symbols.includes("advance") });
    const hits = (await Promise.all(p.teams.map(async (t) => (await opts.resolve(String(t.number))).hits.find((h) => h.kind === "team" && h.ref === String(t.number))))).filter((h): h is NonNullable<typeof h> => !!h);
    // The search box's link to Predict; the page prints it once, as the card's own action, so not again under it.
    const inCard = stat.blocks.some((b) => b.kind === "chance" && b.action);
    const predictLink = stat.blocks.flatMap((b) => (b.kind === "links" ? b.items : b.kind === "chance" && b.action ? [b.action] : [])).find((l) => l.label.startsWith("Open in Predict"));
    return {
      q: p.q, hits: hits.map((h) => ({ ...h, facts: undefined, events: undefined })), pages: predictLink && !(opts.full && inCard) ? [{ title: predictLink.label, href: predictLink.href }, ...opts.pages] : opts.pages,
      step: "deterministic", weak: false, understood: { kind: "question", label: p.event?.latest ? `${stat.title} · the latest event with "${p.event.typed}" in its name` : stat.title, season: found.ev.season }, ...(opts.full ? { stat } : {}),
      intent: { kind: `stat-${stat.intent}`, pattern: `${p.teams.map(() => "[team]").join(" ")} predict ${p.event ? "[event]" : p.worlds ? "[worlds]" : "[states]"}`, met: true, understood: [] },
    };
  }
  // One team swapped for another: on an alliance, the predicted score moves by the gap between the two teams' ratings
  // (a rating is the points a team adds a match), so the answer is those two side by side, the partner kept as is.
  // The first team after the swap word goes out and the next comes in ("swap A for B", "replace A with B"), the other
  // way round when the word says in ("sub in A for B"); any other team is the partner.
  if (intent === "swap-predict") {
    // The call is on one season's ratings: every season asked ("across all seasons") is left to search, never narrowed.
    if (scope.level || scope.alliance || scope.place || scope.area || scope.window || scope.at || scope.championship || scope.states || scope.ever || p.matchNumber != null) return null;
    // Each team where it was read, never its name searched for again (a name inside another's: "Robotics").
    const after = p.swapAt == null ? [] : p.teams.filter((t) => t.at > p.swapAt!).sort((a, b) => a.at - b.at);
    if (after.length < 2) return null;
    const [out, inn] = p.symbols.includes("swap-in") ? [after[1], after[0]] : after;
    const partner = p.teams.find((t) => t !== out && t !== inn) ?? null;
    const a = await twoTeamSearch(p.q, { id: "predict", scope, a: String(out.number), b: String(inn.number) }, opts.resolve, opts);
    if (!a?.understood) return a;
    const who = (t: (typeof p.teams)[number]) => `${t.name ?? `Team ${t.number}`} (${t.number})`;
    return { ...a, understood: { ...a.understood, label: `Swapping ${who(out)} for ${who(inn)}${partner ? ` beside ${who(partner)}` : ""}: the alliance's predicted score moves by the gap in their ratings` } };
  }
  // Two alliances of two, one either side of the "vs": the engine's call for that match, in the season said (else the
  // latest every team has a rating in). A match has no event, place or window to filter by.
  if (intent === "alliance-predict") {
    const red = p.teams.filter((t) => p.vsAt != null && t.at < p.vsAt), blue = p.teams.filter((t) => p.vsAt != null && t.at > p.vsAt);
    if (red.length !== 2 || blue.length !== 2 || p.event || p.worlds || p.states || scope.place || scope.area || scope.window || scope.level || scope.alliance) return null;
    // A match number the matchup can't answer for ("… match 12") is left to search, never dropped.
    if (scope.ever || p.matchNumber != null) return null;
    // The season the scope read ("in 2024-25", "last season"); "this season" or none, the latest every team is rated in.
    const pick = scope.season != null ? { season: scope.season, why: undefined } : await predictionSeasonOf(p.teams.map((t) => t.number));
    const team = (t: (typeof red)[number]) => ({ number: t.number, name: t.name });
    const stat = await allianceForecast(red.map(team), blue.map(team), pick.season, pick.why);
    const hits = (await Promise.all(p.teams.map(async (t) => (await opts.resolve(String(t.number))).hits.find((h) => h.kind === "team" && h.ref === String(t.number))))).filter((h): h is NonNullable<typeof h> => !!h);
    return {
      q: p.q, hits: hits.map((h) => ({ ...h, facts: undefined, events: undefined })), step: "deterministic", weak: false,
      // Predict on this lineup, first among the pages: the dropdown (no card) opens it too.
      pages: isLegacy(pick.season) ? opts.pages : [{ title: `Predict ${red.map((t) => t.number).join(" & ")} vs ${blue.map((t) => t.number).join(" & ")}`, href: predictHref({ mode: "match", season: pick.season, red: red.map((t) => t.number), blue: blue.map((t) => t.number) }) }, ...opts.pages],
      understood: { kind: "question", label: stat.title, season: pick.season }, ...(opts.full ? { stat } : {}),
      intent: { kind: `stat-${stat.intent}`, pattern: "[team] [team] vs [team] [team] predict", met: true, understood: [] },
    };
  }
  // Who one team should pick at an event: the pick helper on that event's teams. The event named (its Worlds or state
  // championship division), else the team's next event, else its latest; a stat said is what the helper weighs.
  if (intent === "pick-partners") {
    // A place only narrows a state championship ("who should 12345 pick at nj states"), never anything else.
    const region = p.states && !p.worlds && !p.event ? regionOf(p) : null;
    if (p.teams.length !== 1 || scope.level || scope.alliance || (scope.place && !region) || scope.area || scope.window || p.n != null || (p.event && (p.worlds || p.states))) return null;
    const year = p.time?.kind === "season" && p.time.year != null ? p.time.year : null;
    const season = p.time?.kind === "season" && p.time.year == null && !p.time.relative && p.time.season != null ? p.time.season : null;
    if (p.time && year == null && season == null) return null;
    const t = p.teams[0], team = { number: t.number, name: t.name };
    const found = p.event ? await eventFor(p.event.words, [t.number], year, season)
      : p.worlds || p.states ? await teamEventOfType(t.number, p.worlds ? CHAMPIONSHIP_TYPE : STATES_TYPE, season, year, region)
      : await teamPickEvent(t.number, opts.now ?? Date.now(), season, year);
    if (!found) return null;
    const why = p.event || p.worlds || p.states ? undefined : `No event was named: this is ${t.number}'s ${"next" in found && found.next ? "next" : "latest"} event.`;
    const focus = (["auto", "teleop", "endgame"] as const).find((x) => p.symbols.includes(`metric:${x}`)) ?? null;
    const stat = await pickAnswer(team, found.ev, why, focus, opts.now);
    const hit = (await opts.resolve(String(t.number))).hits.find((h) => h.kind === "team" && h.ref === String(t.number));
    return {
      q: p.q, hits: hit ? [{ ...hit, facts: undefined, events: undefined }] : [], pages: opts.pages, step: "deterministic", weak: false,
      understood: { kind: "question", label: stat.title, season: found.ev.season }, ...(opts.full ? { stat } : {}),
      intent: { kind: `stat-${stat.intent}`, pattern: `[team] pick ${p.event ? "[event]" : p.worlds ? "[worlds]" : p.states ? "[states]" : "[next event]"}`, met: true, understood: [] },
    };
  }
  if (p.teams.length === 2 && TWO_TEAM[intent]) {
    const id = TWO_TEAM[intent]!;
    // A match still to come ("if 12345 played 23456 tomorrow", "… this week") is called on the ratings as they stand: a
    // window with a day still to come filters nothing there, so the forecast reads the latest season both teams have a
    // rating in, as with none said. A window wholly gone by ("last week") is left to the readers of what happened.
    const upcoming = id === "predict" && scope.window && scope.window.to >= searchToday(opts.now) ? scope.window.label : null;
    if (upcoming) { delete scope.window; scope.season = null; }
    // Compared at an event (or their Worlds, their states): each team's numbers there. With no event, the season's
    // numbers side by side ("12345 vs 67890", "who is better, 12345 or 67890"); a lone "or" is the boolean reader's.
    if (id === "compare") {
      if (scope.level || scope.alliance || scope.window || scope.place || scope.area) return null;
      if (!(scope.at || scope.championship || scope.states)) {
        if (!p.symbols.includes("vs") && !COMPARE_SAID.test(said)) return null;
        // A name several teams share is Compare's to ask about ("Which 'twins'?"), never settled here.
        if (p.teams.some((t) => t.candidates)) return null;
      }
      return twoTeamSearch(p.q, { id, scope, a: String(p.teams[0].number), b: String(p.teams[1].number) }, opts.resolve, opts);
    }
    // Season side-by-sides (OPR, rating, awards, a forecast) read whole seasons: only the meetings take an event, a
    // place, a window, a match type or a side.
    if (!MEETINGS.has(id) && (scope.at || scope.championship || scope.states || scope.level || scope.alliance || scope.window || scope.place || scope.area)) return null;
    const a = await twoTeamSearch(p.q, { id, scope, a: String(p.teams[0].number), b: String(p.teams[1].number) }, opts.resolve, opts);
    // The day said is said back as what it was read as, with the season whose ratings make the call.
    if (!a || !upcoming || !a.understood) return a;
    const used = (await predictionSeasonOf(p.teams.map((t) => t.number))).season;
    return { ...a, understood: { ...a.understood, label: `${a.understood.label} · ${upcoming}: an upcoming match, called on ${seasonLabel(used)} ratings` } };
  }
  // A trend: the reader's own card for the team and the season (said, or the team's latest), whatever the words were.
  const trend = TREND_ASK[intent];
  if (trend && p.teams.length === 1) {
    // The reader draws the whole season: a count it can't apply ("last 2 events") is left to search.
    if (p.n != null || scope.at || scope.championship || scope.states || scope.level || scope.alliance || scope.window || scope.place || scope.area || scope.ever) return null;
    const asked = `${p.teams[0].number} ${trend.ask}${scope.season != null ? ` in ${seasonLabel(scope.season)}` : ""}`;
    const a = await statAnswer(asked, opts.resolve, { full: opts.full, pages: opts.pages });
    if (!a || a.intent?.kind !== `stat-${trend.intent}`) return null;
    return { ...a, q: p.q };
  }
  if (intent === "highlights") return highlights(p, scope, opts);
  // Matches by a measure, or the best ones with a filter the season records don't take (a match type, a kind of
  // event): the match finder.
  // Matches with no measure said are a window's only ("matches from yesterday"), or those with a score to reach
  // ("matches at <event> where both alliances scored over 250"), listed best first; "matches" alone, a place's or a
  // match type's ("playoff matches in NJ") are left to search.
  if (intent === "top-matches" && !p.teams.length && !p.symbols.includes("agg:max") && !scope.window && !p.scoreCond) return null;
  const kind = p.event ? eventKindOf(normalise(p.event.words)) : p.eventKind ? eventKindOf(p.eventKind) : null;
  const teamFind = p.teams.length === 1 && TEAM_FIND.has(FIND[intent]!);
  if ((!p.teams.length || teamFind) && (FIND[intent] || (intent === "top-matches" && (p.level || p.finals || kind || p.scoreCond)))) {
    // An event named with a score to reach ("matches at <event> where both alliances scored over 250"): its matches,
    // its divisions' too. A calendar year said is the edition held that year; none said, its latest.
    const year = p.time?.kind === "season" && p.time.year != null && !p.time.relative ? p.time.year : null;
    const named = p.event && !kind && p.scoreCond ? await eventsNamed(normalise(p.event.words), null, year != null ? (e) => (e.start ?? "").startsWith(String(year)) : undefined) : null;
    const events = named && year != null ? named.filter((e) => (e.start ?? "").startsWith(String(year))) : named;
    if (events && !events.length) return null;
    if (((p.event || p.eventKind) && !kind && !events) || p.worlds || p.states || p.alliance || scope.ever || (p.place && p.place.kind === "city")) return null;
    // Its name as each season held it: the main event's, never a division's.
    const mainFirst = events ? [...events].sort((x, y) => Number(x.division != null) - Number(y.division != null)) : [];
    const eventKeys = events ? (await scopeEvents({ season: 0, region: null, level: null, finals: false, kind: null, events })) ?? [] : null;
    // None said: the latest edition with a match played, its divisions' counted (one only scheduled has none yet).
    const playedIn = eventKeys?.length && year == null && !p.time ? await get<{ s: number | null }>(
      `SELECT MAX(m.season) s FROM matches m WHERE m.played = 1 AND (${eventKeys.map(() => "(m.season = ? AND m.code = ?)").join(" OR ")})`, eventKeys.flatMap((k) => [k.season, k.code])) : null;
    const eventSeason = events && (year != null || !p.time) ? (playedIn?.s != null ? Number(playedIn.s) : Math.max(...events.map((e) => e.season))) : null;
    const plural = /\b(?:matches|games|scores|upsets|comebacks|blowouts|routs|mismatches|underdogs|wins|losses|predictions|misses)\b/.test(said);
    const f: MatchFind = {
      // The current season is the one today is in.
      measure: FIND[intent] ?? "high", season: eventSeason ?? placeSeason(p, scope.season, opts), region: regionOf(p), level: p.level, finals: p.finals, kind,
      ...(["metric:win", "metric:loss", "outcome:W", "outcome:L"].some((s) => p.symbols.includes(s)) ? { decided: true } : {}),
      ...(scope.window ? { window: scope.window } : {}), n: p.n ?? (plural ? 10 : 5), ...(plural || p.n != null ? { list: true } : {}),
      ...(teamFind ? { team: { number: p.teams[0].number, name: p.teams[0].name } } : {}), ...(p.over != null ? { over: p.over } : {}),
      ...(p.scoreCond ? { cond: p.scoreCond } : {}), ...(events && eventKeys ? {
        events: eventKeys.map((k) => ({ ...k, name: mainFirst.find((e) => e.season === k.season)?.name })),
        // An off-season event named ("MTI") is its own matches, though the finder otherwise reads official events only.
        ...(events.some((e) => !(OFFICIAL_TYPES as readonly string[]).includes(e.type ?? "")) ? { named: true } : {}),
      } : {}),
    };
    const card = async (g: MatchFind): Promise<SearchAnswer> => {
      const stat = await matchFindAnswer(g);
      return { q: p.q, hits: [], pages: opts.pages, step: "deterministic", weak: false, understood: { kind: "question", label: stat.title, season: g.season }, ...(opts.full ? { stat } : {}),
        intent: { kind: `stat-${stat.intent}`, pattern: `${stat.intent}${g.region ? " [place]" : ""}${g.window ? " [window]" : ""}`, met: true, understood: [] } };
    };
    // The search box keeps a link to the answer page.
    if (!opts.full) return null;
    const a = await card(f);
    const where = f.region ? ` in ${f.region.name}` : "";
    if (scope.window && scope.season != null && p.time?.year == null) return relaxed(a, windowSteps(scope.window, scope.season), (season) => card({ ...f, window: undefined, season }));
    // No season said, or "this season": the current one, then the one before when it has nothing yet.
    // Its note says what there's none of: matches, when nothing is played there yet; else the matches asked for.
    const played = !/^From 0 /.test(a.stat?.source ?? "");
    if (!events && (!p.time || (p.time.kind === "season" && p.time.relative === "this"))) return relaxed(a, defaultSteps(f.season, where, played ? MATCH_NOUN[f.measure] : "matches"), (season) => card({ ...f, season }));
    return a;
  }
  // A count's board ("the most matches played", "most awards in nj"): answered as the leaderboard reader reads it, never
  // the highest-scoring matches or the rating's board. Read here, as typed: the readers after this see "matches" as one.
  if (!p.teams.length && (intent === "top-matches" || intent === "leaderboard")) {
    const counted = readLeaderboard(p.q);
    if (counted && BOARD_STATS[counted.stat]?.count) return boardSearch(p.q, counted, opts);
  }
  if (!p.teams.length && intent === "top-matches") {
    if (p.event || p.worlds || p.states || p.level || p.alliance || (p.place && p.place.kind === "city")) return null;
    // "The highest-scoring match": one match; "matches", "scores", "top 5", or no match said ("highest score in
    // decode"): a list.
    const one = /\b(?:match|game)\b/.test(said) && !/\b(?:matches|games|scores)\b/.test(said);
    const t: TopMatchesQuestion = {
      season: scope.ever ? scope.season : placeSeason(p, scope.season, opts), game: null, ever: scope.ever, region: regionOf(p), event: null,
      ...(scope.window ? { window: scope.window } : {}), ...(p.n != null ? { n: p.n } : one ? { n: 1 } : {}), ...(p.noPenalties ? { noPenalties: true } : {}),
    };
    const a = await topSearch(p.q, t, opts);
    // No season said: the current one, then the one before (as the match finder does).
    if (!scope.ever && (!p.time || (p.time.kind === "season" && p.time.relative === "this"))) {
      return relaxed(a, defaultSteps(t.season!, t.region ? ` in ${t.region.name}` : "", "scored matches"), (season) => topSearch(p.q, { ...t, season }, opts));
    }
    if (!scope.window || scope.season == null || p.time?.year != null) return a;
    return relaxed(a, windowSteps(scope.window, scope.season), (season) => topSearch(p.q, { ...t, window: undefined, season }, opts));
  }
  if (!p.teams.length && intent === "leaderboard") {
    // The search box keeps the asks' own short card; the page draws the list.
    if (!opts.full) return null;
    // The teams at one event, Worlds or a state championship ("east bergen conference best teams", "top teams at nj
    // states"): that event's board.
    if ((p.event || p.worlds || p.states) && !p.level && !p.alliance && !p.finals && !p.eventKind && !scope.window && !scope.ever) return eventBoard(p, scope, said, opts);
    if (p.event || p.worlds || p.states || p.level || p.alliance || scope.window || scope.ever) return null;
    // A "leaderboard" the leaderboard reader reads (a state's, by a stat) is its own; a country's is answered here.
    if (/\bleader ?boards?\b/.test(said) && readLeaderboard(p.q)) return null;
    let stats = [...new Set(p.symbols.map((s) => BOARD_STAT[s]).filter((s): s is string => !!s && !!BOARD_STATS[s]))];
    // "Auto OPR" is the auto phase's OPR; a record beside another stat is the column every row shows.
    if (stats.some((s) => s === "auto" || s === "teleop" || s === "endgame")) stats = stats.filter((s) => s !== "opr");
    if (stats.length > 1) stats = stats.filter((s) => s !== "record" && s !== "wins");
    if (stats.length > 1) return null;
    // "The best team in NJ by OPR": one team, the next few under it; with no place or stat named, or a sort asked
    // for ("best team sorted by auto"), the top 10.
    const one = /\b(?:team|who)\b/.test(said) && !/\b(?:teams|sorted|ranked|order)\b/.test(said) && p.n == null && (!!p.place || stats.length === 1);
    const town = p.place?.kind === "city" ? p.place : null;
    // No stat said and the place alone ending the question ("best teams in romania", "best team in Oradell"): the place
    // readers' own cards. Said any other way ("in Cluj-Napoca, Romania", "best Romanian teams", "leaderboard in
    // Romania", which those readers don't take): its teams by OPR here.
    const boardSaid = /\bleader ?boards?\b/.test(said);
    if ((town || p.place?.kind === "country") && !stats.length && !p.undefeated && !boardSaid && said.endsWith(` in ${normalise(p.place!.typed)}`)) return null;
    // Fewer is better for penalties: "best" and "cleanest" are the fewest, "worst" the most; "most" and "fewest" as said.
    const goodWord = !!stats[0] && !!BOARD_STATS[stats[0]].fewerBetter && /\b(?:best|better|cleanest|worst|weakest)\b/.test(said);
    const region: Region | null = town ? { key: `${town.country}:${town.state ?? ""}`, country: town.country, state: town.state ?? "", name: town.state ?? town.country } : regionOf(p);
    const b: LeaderboardQuestion = {
      kind: "top", stat: stats[0] ?? (p.undefeated ? "wins" : town || p.place?.kind === "country" ? "opr" : "rating"), ...(p.undefeated ? { undefeated: true } : {}), n: one ? 5 : Math.min(25, p.n ?? 10), region, city: null, town: town?.city ?? null, season: placeSeason(p, scope.season, opts),
      ...(one ? { best: true } : {}), ...((p.agg === "min") !== goodWord ? { asc: true } : {}),
    };
    // A stat said not to go by is never the one ranked by (a default included): with no other stat said, left unanswered.
    if ((p.notMetrics ?? []).some((s) => BOARD_STAT[s] === b.stat)) return null;
    // A stat said not to go by is named on the card, never silently dropped.
    const board = async (q: LeaderboardQuestion) => {
      const a = await boardSearch(p.q, q, opts);
      return p.notStats?.length && a?.stat ? { ...a, stat: { ...a.stat, scope: [...a.stat.scope, ...p.notStats.map((w) => `Not by ${w}`)] } } : a;
    };
    const a = await board(b);
    // No season said, or "this season": the current one, then the one before when nobody has played enough yet.
    if (scope.season != null || !(p.time == null || (p.time.kind === "season" && p.time.relative === "this"))) return a;
    return relaxed(a, defaultSteps(b.season!, town ? ` in ${town.city}` : region ? ` in ${region.name}` : "", b.undefeated ? "undefeated teams" : b.kind === "top" ? "ranked teams" : "teams"), (season) => board({ ...b, season }));
  }
  return null;
}

/** The board of the teams at one event named, Worlds or the place's state championship: the season said (a year: the
 *  one held then), else the latest held. OPR only: another stat said is left to search. */
async function eventBoard(p: Parsed, scope: ReadScope, said: string, opts: PipelineOptions): Promise<SearchAnswer | null> {
  if (p.symbols.some((s) => BOARD_STAT[s] && BOARD_STAT[s] !== "opr") || p.place?.kind === "city") return null;
  // The best first by OPR only: the lowest first, undefeated teams alone or OPR said not to go by are left to search.
  if (p.agg === "min" || p.undefeated || (p.notMetrics ?? []).some((s) => !BOARD_STAT[s] || BOARD_STAT[s] === "opr")) return null;
  // A place said with a state championship is the event's ("nj states"); with Worlds or an event named, the teams'
  // home ("nj teams at worlds"): only the teams from there are listed.
  const region = regionOf(p);
  if (p.states && !region) return null;
  const home = p.states ? null : region;
  const year = p.time?.kind === "season" && p.time.year != null && !p.time.relative ? p.time.year : null;
  const types = p.worlds ? [CHAMPIONSHIP_TYPE] : p.states ? [STATES_TYPE] : null;
  const evs = p.event ? await eventsNamed(normalise(p.event.words), types, year != null ? (e) => (e.start ?? "").startsWith(String(year)) : undefined)
    : (await all<{ season: number; code: string; name: string; type: string | null; division: string | null; start: string | null }>(
      `SELECT season, code, name, type, division_code division, start FROM events WHERE type = ?${p.states ? ` AND country = ?${region!.state ? " AND state = ?" : ""}` : ""}`,
      [types![0], ...(p.states ? [region!.country, ...(region!.state ? [region!.state] : [])] : [])])).map((e) => ({ ...e, season: Number(e.season) }))
      .filter((e) => year == null || (e.start ?? "").startsWith(String(year)));
  // The events matched themselves: a division named is that division alone; a parent named brings its divisions in
  // (eventBoardAnswer takes each code's children).
  const at = (season: number) => {
    const inSeason = evs.filter((e) => e.season === season);
    const main = inSeason.find((e) => !e.division) ?? inSeason[0];
    return { main, codes: [...new Set(inSeason.map((e) => e.code))] };
  };
  const listed = async (season: number) => { const { codes } = at(season); return !!(await get<{ n: number }>(`SELECT 1 n FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE et.season = ? AND (e.code IN (${codes.map(() => "?").join(", ")}) OR e.division_code IN (${codes.map(() => "?").join(", ")})) LIMIT 1`, [season, ...codes, ...codes])); };
  // A season said, or the one held the year said; else the latest held up to the current season whose teams are listed,
  // a newer one with none listed yet said on the card.
  const current = seasonOfDate(searchToday(opts.now));
  const seasons = [...new Set(evs.map((e) => e.season))].filter((s) => s <= current).sort((x, y) => y - x);
  let season: number | null = null, skipped: number | null = null;
  if (year == null && scope.season != null) season = seasons.includes(scope.season) ? scope.season : null;
  else for (const s of seasons) { if (await listed(s)) { season = s; break; } skipped ??= s; }
  if (season == null) season = year == null && scope.season != null ? null : seasons[0] ?? null;
  if (season == null) return null;
  const { main, codes } = at(season);
  const name = p.worlds ? `Worlds ${season + 1}` : shortEvent(main.name, main.type);
  const one = p.n == null && /\b(?:team|who)\b/.test(said) && !/\bteams\b/.test(said);
  const a = await boardSearch(p.q, { kind: "top", stat: "opr", n: Math.min(25, p.n ?? (one ? 5 : 10)), region: null, city: null, season, event: { season, code: main.code, codes, name, home, ...(p.rookie ? { rookies: true } : {}) } }, opts);
  if (!a?.stat || skipped == null || skipped === season) return a;
  const note = `No teams listed for the ${seasonLabel(skipped)} event yet; showing ${seasonLabel(season)}`;
  return { ...a, stat: { ...a.stat, scope: [note, ...a.stat.scope], definition: `${a.stat.definition} ${note}: no season was named, so the latest was read first.` } };
}

/** A Worlds or a state championship said, as the kind of event it filters to. */
const WORLDS_KIND = { types: [CHAMPIONSHIP_TYPE], label: "Worlds" };
const STATES_KIND = { types: ["Championship"], label: "State championships" };

/** Highlights (./highlights.ts): one team's (a season, or its matches at an event named, Worlds or a state
 *  championship), or a scope's: an event and its divisions, Worlds, a state championship, a place, a kind of event, a
 *  match type, a window or everywhere. With no season said, the current one, then the latest with matches in the scope,
 *  said in the chip. The search box keeps a link to the answer page. */
async function highlights(p: Parsed, scope: ReadScope, opts: PipelineOptions): Promise<SearchAnswer | null> {
  // A count of none ("top 0 highlights") lists nothing to show.
  if (!opts.full || p.alliance || scope.ever || p.place?.kind === "city" || (p.n != null && p.n < 1)) return null;
  const answer = (stat: StatAnswer, season: number, hits: SearchAnswer["hits"] = []): SearchAnswer => ({
    q: p.q, hits, pages: opts.pages, step: "deterministic", weak: false, understood: { kind: "question", label: stat.title, season }, stat,
    intent: { kind: `stat-${stat.intent}`, pattern: `${p.teams.length ? "[team] " : ""}highlights${p.event ? " [event]" : p.worlds ? " [worlds]" : p.states ? " [states]" : ""}${p.place ? " [place]" : ""}${scope.window ? " [window]" : ""}`, met: true, understood: [] },
  });
  // Video words alone ("recap", "videos", "watch"): a video page; "highlights", "best" or "what happened": the
  // standout matches first.
  const videos = p.symbols.includes("videos") && !p.symbols.includes("highlights") && !p.symbols.includes("agg:max");
  const kind = p.worlds ? WORLDS_KIND : p.states ? STATES_KIND : p.eventKind ? eventKindOf(p.eventKind) : null;
  if (p.eventKind && !kind) return null;
  // A calendar year said with an event, Worlds or a state championship ("nj championship 2025", "worlds 2025") is the
  // one held that year; a season ("2024-25"), that season's. An event is chosen among those held that year.
  const year = p.time?.kind === "season" && p.time.year != null && !p.time.relative ? p.time.year : null;
  const named = p.event ? await eventsNamed(normalise(p.event.words), kind?.types ?? null, year != null ? (e) => (e.start ?? "").startsWith(String(year)) : undefined) : null;
  if (named && !named.length) return null;
  const evs = named && year != null ? named.filter((e) => (e.start ?? "").startsWith(String(year))) : named;
  if (evs && !evs.length) return null;
  const region = regionOf(p);
  const held = year == null ? null : evs ? evs.map((e) => e.season) : p.worlds || p.states ? await heldInYear(kind!.types, year, p.states ? region : null) : null;
  if (held && !held.length) return null;
  const heldIn = held ? Math.max(...held) : null;
  // Its name as each season held it: the main event's when a division fits as well.
  const byMain = evs ? [...evs].sort((a, b) => b.season - a.season || Number(a.division != null) - Number(b.division != null)) : null;
  if (p.teams.length) {
    // A team's own: a season, or its matches at an event named, Worlds or a state championship.
    // A place only narrows a state championship ("<team> highlights at nj states").
    if (p.teams.length > 1 || (scope.place && !(p.states && region)) || scope.area || scope.level || p.finals || p.eventKind) return null;
    const t = p.teams[0];
    const said = heldIn ?? (p.time ? placeSeason(p, scope.season, opts) : null);
    const place: TeamHighlightScope | undefined = evs ? { has: (m) => evs.some((e) => e.season === m.season && (e.code === m.code || e.code === m.division)), label: shortEvent(byMain![0].name, byMain![0].type) }
      : p.worlds ? { has: (m) => m.type === CHAMPIONSHIP_TYPE, label: "the FIRST Championship" }
      : p.states ? { has: (m) => STATES_KIND.types.includes(m.type ?? "") && (!region || (m.country === region.country && (!region.state || m.state === region.state))), label: region ? `the ${region.name} championship` : "a state championship" } : undefined;
    // A time said ("in December", "this week"): its matches played on those days, in an event named too when one is.
    const w = scope.window;
    const when: TeamHighlightScope | undefined = w ? { has: (m) => { const d = (m.date ?? "").slice(0, 10); return d >= w.from && d <= w.to && (!place || place.has(m)); }, label: place?.label ?? w.label, phrase: `${place ? `at ${place.label} ` : ""}${WHEN_WORD.test(w.label) ? w.label : `in ${w.label}`}`, ...(said != null ? { season: said } : {}) } : place;
    // A window is kept by its dates alone, never its first day's season: a week across the season's start (Aug 31 to
    // Sep 6) has matches of both, and the latest season with any is shown (each season's highlights stay apart).
    const stat = await teamHighlights({ number: t.number, name: t.name }, w ? undefined : said ?? undefined, when, p.n ?? undefined, videos ? "videos" : "highlights");
    const hit = (await opts.resolve(String(t.number))).hits.find((h) => h.kind === "team" && h.ref === String(t.number));
    const hits = hit ? [{ ...hit, facts: undefined, events: undefined }] : [];
    const first = stat ? answer(stat, Number(/^\d{4}/.exec(stat.scope[0] ?? "")?.[0] ?? said ?? searchSeason()), hits) : null;
    // Nothing in a time said against today ("in december", "this week"): its season, then the one before, said on the
    // card, as every answer with a window relaxes it. A time with its year typed stays that time.
    if (first && w && scope.season != null && p.time?.year == null) {
      return relaxed(first, windowSteps(w, scope.season), async (s) => {
        const r = await teamHighlights({ number: t.number, name: t.name }, s, place, p.n ?? undefined, videos ? "videos" : "highlights");
        return r ? answer(r, s, hits) : null;
      });
    }
    if (first) return first;
    if (said == null) return null;
    const S = seasonLabel(said);
    return answer({ family: "superlative", intent: "team-highlights", title: `Highlights, ${S}`, team: { number: t.number, name: t.name }, scope: [S], blocks: [],
      definition: "The team's standout matches of the season asked: its best score, biggest win, latest playoff win, best Auto and closest win.", source: `Matches on record in ${S}`,
      none: `${t.name ?? `Team ${t.number}`} (${t.number}) has no played matches in ${S}.` }, said, hits);
  }
  // An event named with no season said is its latest held, never the current season it isn't in.
  const lastHeld = evs && !p.time ? Math.max(...evs.map((e) => e.season)) : null;
  const f: HighlightFind = {
    season: heldIn ?? lastHeld ?? placeSeason(p, scope.season, opts), region, level: p.level, finals: p.finals, kind: evs ? null : kind, ...(scope.window ? { window: scope.window } : {}), ...(p.n != null ? { n: p.n } : {}), ...(videos ? { videos } : {}),
    ...(evs ? {
      events: evs.map((e) => ({ season: e.season, code: e.code })),
      // An off-season event named ("MTI"): its own matches, though highlights are otherwise official events only.
      ...(evs.some((e) => !(OFFICIAL_TYPES as readonly string[]).includes(e.type ?? "")) ? { named: true } : {}),
      eventName: new Map([...byMain!].reverse().map((e) => [e.season, { name: shortEvent(e.name, e.type), when: dateRange(e.start, e.end) || null, where: [e.city, e.state].filter(Boolean).join(", ") || null }])),
    } : {}),
    at: [kind && !evs ? `at ${kind === WORLDS_KIND ? kind.label : kind.label.toLowerCase()}` : "", region ? `in ${region.name}` : ""].filter(Boolean).join(" "),
    chips: [...(region ? [region.name] : []), ...(scope.window ? [scope.window.label.replace(/^./, (c) => c.toUpperCase())] : []),
      ...(p.finals ? ["Finals"] : p.level === "qual" ? ["Qualification matches"] : p.level === "playoff" ? ["Playoff matches"] : []), ...(kind && !evs ? [kind.label] : [])],
  };
  const card = async (season: number, g: HighlightFind = f) => answer(await highlightsAnswer({ ...g, season }), season);
  const a = await card(f.season);
  // A window said against today: its season, then the season before, with the window's chip gone.
  if (scope.window && scope.season != null && p.time?.year == null) {
    const whole: HighlightFind = { ...f, window: undefined, chips: f.chips.filter((c) => c.toLowerCase() !== scope.window!.label.toLowerCase()) };
    return relaxed(a, windowSteps(scope.window, scope.season), (season) => card(season, whole));
  }
  // No season said, or "this season": the current one, then the latest with matches in the scope.
  if (!isEmpty(a) || !(!p.time || (p.time.kind === "season" && p.time.relative === "this"))) return a;
  const latest = await latestPlayed({ ...f, season: f.season - 1 });
  if (latest == null) return a;
  const name = f.eventName?.get(latest)?.name;
  return relaxed(a, defaultSteps(f.season, name ? ` at ${name}` : f.at ? ` ${f.at}` : "", "matches", latest), (season) => card(season));
}

/** The slots as the scope a stat answer reads (server/api/answers/read.ts ReadScope). Null: a slot no answer applies. */
function readScopeOf(p: Parsed): ReadScope | null {
  const s: ReadScope = { season: null, latest: false, ever: false, championship: p.worlds, states: p.states, level: p.level, ...(p.finals ? { finals: true } : {}), alliance: p.alliance, at: p.event?.words ?? null };
  const t = p.time;
  if (t?.kind === "window") { s.season = t.season; s.window = { from: t.from!, to: t.to!, label: t.label }; }
  else if (t?.kind === "season") {
    if (t.relative === "this") s.latest = true;
    // "Last season": the one before the season a query naming none reads (./answers/season.ts).
    else if (t.relative === "last") { s.lastYear = true; s.season = searchSeason() - 1; }
    else { s.season = t.season; if (t.year) s.year = true; }
  } else if (t?.kind === "ever") s.ever = true;
  if (p.place) {
    // A town names where a team is from, which a team's own question already knows: only events in a region or a
    // country are a filter. A leaderboard's town is the teams from it.
    if (p.place.kind === "city") return p.intent === "leaderboard" ? s : null;
    if (p.place.kind === "region") s.place = regionOf(p);
    else s.area = { country: p.place.country, state: null, name: p.place.name };
  }
  return s;
}

/** The place as a region (a whole country has no state). */
function regionOf(p: Parsed): Region | null {
  const pl = p.place;
  if (!pl || pl.kind === "city") return null;
  return { key: `${pl.country}:${pl.state ?? ""}`, country: pl.country, state: pl.state ?? "", name: pl.name };
}

/** A year or a season with no events stored for it yet (a future one): the card that says so, naming the latest
 *  season instead as a question to ask, never answered as it. Null when there are events to answer from. */
async function noEventsYet(p: Parsed, team: number, id: IntentId, opts0: { now?: number }): Promise<((opts: PipelineOptions) => Promise<SearchAnswer>) | null> {
  const t = p.time;
  if (!t || t.kind !== "season" || t.relative || t.season == null) return null;
  const latest = Number((await get<{ s: number | null }>("SELECT MAX(season) s FROM events"))?.s ?? NaN);
  // A past year is answered as asked (the family says when the team has nothing there). Only a season after the
  // newest stored, or an event's year still to come, gets this card.
  const today = new Date(opts0.now ?? Date.now());
  if (!(p.event ? (t.year ?? t.season) > today.getUTCFullYear() : t.season > latest)) return null;
  const S = p.event ? String(t.year ?? t.season) : seasonLabel(t.season);
  const what = p.event ? `${p.event.typed} in ${S}` : `${S} events`;
  const who = `${p.teams[0].name ?? `Team ${team}`} (${team})`;
  const latestQ = p.q.replace(new RegExp(`\\b${t.typed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ").replace(/\s+/g, " ").trim();
  return async (opts) => {
    const stat: StatAnswer = {
      family: "event", intent: id, title: `No ${what} yet`, team: { number: team, name: p.teams[0].name }, scope: [p.event ? `${p.event.typed}, ${S}` : S],
      blocks: [{ kind: "related", title: "The latest on record instead", queries: [latestQ] }],
      definition: "A season's events are listed once FIRST publishes them; a year with none yet has nothing to answer from, so its answer is never the latest season's.",
      source: `Seasons on record: up to ${seasonLabel(latest)}`,
      none: `There are no ${what} on record yet, so ${who} has nothing there to show. Ask without the year for the latest.`,
    };
    const hit = (await opts.resolve(String(team))).hits.find((h) => h.kind === "team" && h.ref === String(team));
    return { q: p.q, hits: hit ? [{ ...hit, facts: undefined, events: undefined }] : [], pages: opts.pages, step: "deterministic", weak: false, understood: { kind: "question", label: `${who} · No ${what} yet` }, stat };
  };
}
