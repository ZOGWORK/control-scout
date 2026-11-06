// A parsed query run as a structured query over the stored data (docs/search-pipeline.md, "Execute"): the slots
// become the question objects the family answers already take (server/api/answers/: a StatQuestion, a
// TwoTeamQuestion, a TopMatchesQuestion, a LeaderboardQuestion). They are built from the slots, never by reading text
// again, and answered with the families' own cards. A parse that isn't complete, or an intent no family takes, is
// left to search's other readers (null).
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import type { Region } from "../../../src/shared/regions.js";
import { dateRange, seasonLabel } from "../../../src/shared/format.js";
import { get } from "../../db.js";
import { intentDefaults, readLeaderboard, scopeFits, type IntentId, type LeaderboardQuestion, type ReadScope, type StatQuestion, type TwoTeamId } from "../answers/read.js";
import { boardSearch, statAnswerOf, topSearch, twoTeamSearch, type Resolve } from "../answers/index.js";
import { searchSeason } from "../answers/season.js";
import { BOARD_STATS } from "../answers/families/leaderboard.js";
import type { TopMatchesQuestion } from "../answers/families/topMatches.js";
import { defaultSteps, isEmpty, relaxed, windowSteps } from "./relax.js";
import { eventsNamed, heldInYear, highlightsAnswer, latestPlayed, type HighlightFind } from "./highlights.js";
import { teamHighlights, type TeamHighlightScope } from "../answers/highlights.js";
import { shortEvent } from "../answers/matchSet.js";
import { CHAMPIONSHIP_TYPE } from "../answers/clauses.js";
import { eventKindOf, matchFindAnswer, type MatchFind, type MatchMeasure } from "./matchFind.js";
import { seasonOfDate } from "./time.js";
import { searchToday } from "../searchEvents.js";
import { eventFor, forecastAt } from "./forecast.js";
import { teamsNamedSearch } from "../answers/teamsNamed.js";
import { describe, normalise, parseQuery, type Parsed } from "./parse.js";
import { parseContext } from "./context.js";
import type { PipelineIntent } from "./intents.js";

export interface PipelineOptions { full: boolean; pages: SearchPageLink[]; resolve: Resolve; now?: number; prefer?: ReadonlySet<string> }

/** The pipeline's answer for `q`, or null when it leaves the query to search's other readers. */
export async function pipelineAnswer(q: string, opts: PipelineOptions): Promise<SearchAnswer | null> {
  const p = await parseQuery(q, await parseContext(opts.now, opts.prefer));
  if (!p.complete || !p.intent) return null;
  let a = await execute(p, opts);
  if (!a) return null;
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

/** Whether the pipeline reads `q` completely (an intent it answers, every word explained). */
export async function pipelineReads(q: string, now?: number, prefer?: ReadonlySet<string>): Promise<boolean> {
  const p = await parseQuery(q, await parseContext(now, prefer));
  return p.complete && !!p.intent && ANSWERED.has(p.intent) && (p.intent !== "team-predict" || !!p.event) && (p.intent !== "count-teams" || townCount(p));
}

/** A count of teams the pipeline answers: a town's, with no time, event, championship, match type, side or award said
 *  (its list is every team from the town, which none of those narrow). */
const townCount = (p: Parsed) => p.place?.kind === "city" && !p.time && !p.teams.length && !p.event && !p.eventKind && !p.worlds && !p.states
  && !p.level && !p.finals && !p.alliance && !p.award && p.n == null && !p.undefeated && !p.noPenalties;

/** The answers that list as many rows as a count said ("12345 last 3 matches"). */
const COUNTED = new Set<IntentId>(["last-matches"]);
/** The award answers that take "first" and "latest" ("12345 latest Inspire award"). */
const AWARD_LISTS = new Set<IntentId>(["awards", "total-awards", "inspire-awards"]);

/** The intents that are a stat answer's own (server/api/answers/read.ts IntentId), by the same name. */
const TEAM_INTENTS = new Set<PipelineIntent>([
  "highest-score", "lowest-score", "biggest-win", "biggest-loss", "closest-match", "first-match", "recent-match", "last-matches", "best-finish",
  "worst-finish", "average-rank", "first-event", "last-event", "best-season", "first-season", "wins-count", "losses", "ties-count",
  "record", "win-percent", "average-score", "median-score", "average-margin", "total-points", "total-matches", "total-events", "seasons-count",
  "current-streak", "longest-streak", "highest-auto", "highest-teleop", "highest-endgame", "most-penalties", "penalties", "score-range",
  "score-consistency", "awards", "total-awards", "results", "event-rank", "event-opr", "best-partner", "partners", "opponents", "playoff-matches",
  "qual-matches", "match-lookup", "avg-penalties", "lost-to-most",
]);
const TWO_TEAM: Partial<Record<PipelineIntent, TwoTeamId>> = {
  "head-to-head": "head-to-head", "shared-matches": "shared-matches", "h2h-wins": "h2h-wins", "opr-vs": "opr-vs", "rating-vs": "rating-vs",
  "awards-vs": "awards-vs", "two-predict": "predict",
};
/** The two-team answers read from the matches the teams met in: the only ones an event, a match type or a side applies to. */
const MEETINGS = new Set<TwoTeamId>(["head-to-head", "h2h-wins", "shared-matches"]);
/** Every intent execute() answers (the rest are left to search's readers). */
/** The match finder's measure for each intent that asks for one (./matchFind.ts). */
const FIND: Partial<Record<PipelineIntent, MatchMeasure>> = {
  "low-matches": "low", "close-matches": "closest", "lopsided-matches": "lopsided", "penalty-matches": "penalties", "upset-matches": "upset", "comeback-matches": "comeback",
};
/** The matches a measure finds, in a sentence ("no 2026–27 upsets yet"). */
const MATCH_NOUN: Record<MatchMeasure, string> = {
  high: "scored matches", low: "scored matches", closest: "decided matches", lopsided: "decided matches", penalties: "matches with penalty points",
  upset: "upsets", comeback: "comebacks",
};
/** A place's or the world's season (docs/search-pipeline.md, "Seasons"): the one said, else the current one (today's);
 *  "last season" is the one before the current one. A team's own season stays the latest it played (readScopeOf). */
function placeSeason(p: Parsed, said: number | null | undefined, opts: PipelineOptions): number {
  const current = seasonOfDate(searchToday(opts.now));
  if (p.time?.kind === "season" && p.time.relative === "last") return current - 1;
  return said ?? current;
}
/** The answers a win or a loss said with them narrows ("closest loss", "first win", "longest losing streak"). */
const OUTCOME_IDS = new Set(["closest-match", "current-streak", "average-margin", "first-match", "recent-match", "last-matches", "longest-streak"]);
const ANSWERED = new Set<PipelineIntent>([...TEAM_INTENTS, ...(Object.keys(TWO_TEAM) as PipelineIntent[]), ...(Object.keys(FIND) as PipelineIntent[]), "top-matches", "leaderboard", "team-predict", "highlights", "teams-named", "count-teams"]);
/** The leaderboard's stat for a metric said ("by opr"); the prediction rating when none is. */
const BOARD_STAT: Partial<Record<string, string>> = {
  "metric:opr": "opr", "metric:rating": "rating", "metric:winrate": "win-rate", "metric:auto": "auto", "metric:teleop": "teleop",
  "metric:endgame": "endgame", "metric:record": "record", "metric:win": "wins", "metric:reliability": "reliability",
};

async function execute(p: Parsed, opts: PipelineOptions): Promise<SearchAnswer | null> {
  const intent = p.intent!;
  if (intent === "teams-named") return teamsNamedSearch(p, opts);
  // A town's teams counted ("how many teams from <town>"): the town's list, its length the count. A region's or a
  // country's count is search's own (../searchCoverage.ts countAnswer).
  if (intent === "count-teams") return townCount(p) ? boardSearch(p.q, { kind: "city", stat: "opr", n: 25, region: null, city: p.place!.city, season: null }, opts) : null;
  const scope = readScopeOf(p);
  if (!scope) return null;
  // The finals are a filter only the match finder applies: anything else would answer for every playoff match.
  // (and a scope's highlights, read with the match finder's filters).
  if (p.finals && (p.teams.length || !(FIND[intent] || intent === "top-matches" || intent === "highlights"))) return null;
  // So is a kind of event by its type words alone ("at a league meet").
  if (p.eventKind && (p.teams.length || !(FIND[intent] || intent === "top-matches" || intent === "highlights"))) return null;
  const said = normalise(p.q);
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
    const team = p.teams[0];
    // A season or a year with no events on record yet (a future year): said so, never the latest instead.
    const future = await noEventsYet(p, team.number, id, opts);
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
      ...(id === "penalties" ? { variant: p.symbols.includes("per:event") ? "per-event" : p.symbols.includes("per:rate") ? "rate" : null } : {}),
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
  if ((intent === "team-predict" || intent === "two-predict") && p.event) {
    if (scope.level || scope.alliance || scope.place || scope.area || scope.window || p.worlds || p.states) return null;
    // A calendar year ("2025") is the event held that year; a season or a game named ("2025-26", "decode") its season.
    const year = p.time?.kind === "season" && p.time.year != null ? p.time.year : null;
    const season = p.time?.kind === "season" && p.time.year == null && !p.time.relative && p.time.season != null ? p.time.season : null;
    if (p.time && year == null && season == null) return null;
    const found = await eventFor(p.event.words, p.teams.map((t) => t.number), year, season);
    if (!found) return null;
    const stat = await forecastAt(p.teams.map((t) => ({ number: t.number, name: t.name })), found.ev, found.listed, opts.now ?? Date.now());
    const hits = (await Promise.all(p.teams.map(async (t) => (await opts.resolve(String(t.number))).hits.find((h) => h.kind === "team" && h.ref === String(t.number))))).filter((h): h is NonNullable<typeof h> => !!h);
    // The search box's link to Predict; the page prints it once, as the card's own action, so not again under it.
    const inCard = stat.blocks.some((b) => b.kind === "chance" && b.action);
    const predictLink = stat.blocks.flatMap((b) => (b.kind === "links" ? b.items : b.kind === "chance" && b.action ? [b.action] : [])).find((l) => l.label.startsWith("Open in Predict"));
    return {
      q: p.q, hits: hits.map((h) => ({ ...h, facts: undefined, events: undefined })), pages: predictLink && !(opts.full && inCard) ? [{ title: predictLink.label, href: predictLink.href }, ...opts.pages] : opts.pages,
      step: "deterministic", weak: false, understood: { kind: "question", label: stat.title, season: found.ev.season }, ...(opts.full ? { stat } : {}),
      intent: { kind: `stat-${stat.intent}`, pattern: `${p.teams.map(() => "[team]").join(" ")} predict [event]`, met: true, understood: [] },
    };
  }
  if (p.teams.length === 2 && TWO_TEAM[intent]) {
    const id = TWO_TEAM[intent]!;
    // Season side-by-sides (OPR, rating, awards, a forecast) read whole seasons: only the meetings take an event, a
    // place, a window, a match type or a side.
    if (!MEETINGS.has(id) && (scope.at || scope.championship || scope.states || scope.level || scope.alliance || scope.window || scope.place || scope.area)) return null;
    return twoTeamSearch(p.q, { id, scope, a: String(p.teams[0].number), b: String(p.teams[1].number) }, opts.resolve, opts);
  }
  if (intent === "highlights") return highlights(p, scope, opts);
  // Matches by a measure, or the best ones with a filter the season records don't take (a match type, a kind of
  // event): the match finder.
  const kind = p.event ? eventKindOf(normalise(p.event.words)) : p.eventKind ? eventKindOf(p.eventKind) : null;
  if (!p.teams.length && (FIND[intent] || (intent === "top-matches" && (p.level || p.finals || kind)))) {
    if (((p.event || p.eventKind) && !kind) || p.worlds || p.states || p.alliance || scope.ever || (p.place && p.place.kind === "city")) return null;
    const plural = /\b(?:matches|games|scores|upsets|comebacks|blowouts|routs|mismatches|underdogs|wins|losses)\b/.test(said);
    const f: MatchFind = {
      // The current season is the one today is in.
      measure: FIND[intent] ?? "high", season: placeSeason(p, scope.season, opts), region: regionOf(p), level: p.level, finals: p.finals, kind,
      ...(["metric:win", "metric:loss", "outcome:W", "outcome:L"].some((s) => p.symbols.includes(s)) ? { decided: true } : {}),
      ...(scope.window ? { window: scope.window } : {}), n: p.n ?? (plural ? 10 : 5), ...(plural || p.n != null ? { list: true } : {}),
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
    if (!p.time || (p.time.kind === "season" && p.time.relative === "this")) return relaxed(a, defaultSteps(f.season, where, played ? MATCH_NOUN[f.measure] : "matches"), (season) => card({ ...f, season }));
    return a;
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
    // readers' own cards. Said any other way ("in Cluj-Napoca, Romania", "best Romanian teams"): its teams by OPR here.
    if ((town || p.place?.kind === "country") && !stats.length && !p.undefeated && said.endsWith(` in ${normalise(p.place!.typed)}`)) return null;
    const region: Region | null = town ? { key: `${town.country}:${town.state ?? ""}`, country: town.country, state: town.state ?? "", name: town.state ?? town.country } : regionOf(p);
    const b: LeaderboardQuestion = {
      kind: "top", stat: stats[0] ?? (p.undefeated ? "wins" : town || p.place?.kind === "country" ? "opr" : "rating"), ...(p.undefeated ? { undefeated: true } : {}), n: one ? 5 : Math.min(25, p.n ?? 10), region, city: null, town: town?.city ?? null, season: placeSeason(p, scope.season, opts),
      ...(one ? { best: true } : {}), ...(p.agg === "min" ? { asc: true } : {}),
    };
    const a = await boardSearch(p.q, b, opts);
    // No season said, or "this season": the current one, then the one before when nobody has played enough yet.
    if (scope.season != null || !(p.time == null || (p.time.kind === "season" && p.time.relative === "this"))) return a;
    return relaxed(a, defaultSteps(b.season!, town ? ` in ${town.city}` : region ? ` in ${region.name}` : "", b.undefeated ? "undefeated teams" : b.kind === "top" ? "ranked teams" : "teams"), (season) => boardSearch(p.q, { ...b, season }, opts));
  }
  return null;
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
  // Video words alone ("recap", "videos", "watch"): a video page; "highlights" or "best": the standout matches first.
  const videos = !p.symbols.includes("highlights") && !p.symbols.includes("agg:max");
  const kind = p.worlds ? WORLDS_KIND : p.states ? STATES_KIND : p.eventKind ? eventKindOf(p.eventKind) : null;
  if (p.eventKind && !kind) return null;
  const named = p.event ? await eventsNamed(normalise(p.event.words), kind?.types ?? null) : null;
  if (named && !named.length) return null;
  // A calendar year said with an event, Worlds or a state championship ("nj championship 2025", "worlds 2025") is the
  // one held that year; a season ("2024-25"), that season's.
  const year = p.time?.kind === "season" && p.time.year != null && !p.time.relative ? p.time.year : null;
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
    if (p.teams.length > 1 || (scope.place && !(p.states && region)) || scope.area || scope.window || scope.level || p.finals || p.eventKind) return null;
    const t = p.teams[0];
    const said = heldIn ?? (p.time ? placeSeason(p, scope.season, opts) : null);
    const at: TeamHighlightScope | undefined = evs ? { has: (m) => evs.some((e) => e.season === m.season && (e.code === m.code || e.code === m.division)), label: shortEvent(byMain![0].name, byMain![0].type) }
      : p.worlds ? { has: (m) => m.type === CHAMPIONSHIP_TYPE, label: "the FIRST Championship" }
      : p.states ? { has: (m) => STATES_KIND.types.includes(m.type ?? "") && (!region || (m.country === region.country && (!region.state || m.state === region.state))), label: region ? `the ${region.name} championship` : "a state championship" } : undefined;
    const stat = await teamHighlights({ number: t.number, name: t.name }, said ?? undefined, at, p.n ?? undefined, videos ? "videos" : "highlights");
    const hit = (await opts.resolve(String(t.number))).hits.find((h) => h.kind === "team" && h.ref === String(t.number));
    const hits = hit ? [{ ...hit, facts: undefined, events: undefined }] : [];
    if (stat) return answer(stat, Number(/^\d{4}/.exec(stat.scope[0] ?? "")?.[0] ?? said ?? searchSeason()), hits);
    if (said == null) return null;
    const S = seasonLabel(said);
    return answer({ family: "superlative", intent: "team-highlights", title: `Highlights, ${S}`, team: { number: t.number, name: t.name }, scope: [S], blocks: [],
      definition: "The team's standout matches of the season asked: its best score, biggest win, latest playoff win, best Auto and closest win.", source: `Matches on record in ${S}`,
      none: `${t.name ?? `Team ${t.number}`} (${t.number}) has no played matches in ${S}.` }, said, hits);
  }
  const f: HighlightFind = {
    season: heldIn ?? placeSeason(p, scope.season, opts), region, level: p.level, finals: p.finals, kind: evs ? null : kind, ...(scope.window ? { window: scope.window } : {}), ...(p.n != null ? { n: p.n } : {}), ...(videos ? { videos } : {}),
    ...(evs ? {
      events: evs.map((e) => ({ season: e.season, code: e.code })),
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
  const s: ReadScope = { season: null, latest: false, ever: false, championship: p.worlds, states: p.states, level: p.level, alliance: p.alliance, at: p.event?.words ?? null };
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
