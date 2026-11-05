// A parsed query run as a structured query over the stored data (docs/search-pipeline.md, "Execute"): the slots
// become the question objects the family answers already take (server/api/answers/: a StatQuestion, a
// TwoTeamQuestion, a TopMatchesQuestion, a LeaderboardQuestion). They are built from the slots, never by reading text
// again, and answered with the families' own cards. A parse that isn't complete, or an intent no family takes, is
// left to search's other readers (null).
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import type { Region } from "../../../src/shared/regions.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { get } from "../../db.js";
import { intentDefaults, scopeFits, type IntentId, type LeaderboardQuestion, type ReadScope, type StatQuestion, type TwoTeamId } from "../answers/read.js";
import { boardSearch, statAnswerOf, topSearch, twoTeamSearch, type Resolve } from "../answers/index.js";
import { searchSeason } from "../answers/season.js";
import { BOARD_STATS } from "../answers/families/leaderboard.js";
import { describe, normalise, parseQuery, type Parsed } from "./parse.js";
import { parseContext } from "./context.js";
import type { PipelineIntent } from "./intents.js";

export interface PipelineOptions { full: boolean; pages: SearchPageLink[]; resolve: Resolve; now?: number; prefer?: ReadonlySet<string> }

/** The pipeline's answer for `q`, or null when it leaves the query to search's other readers. */
export async function pipelineAnswer(q: string, opts: PipelineOptions): Promise<SearchAnswer | null> {
  const p = await parseQuery(q, await parseContext(opts.now, opts.prefer));
  if (!p.complete || !p.intent) return null;
  const a = await execute(p, opts);
  if (!a) return null;
  // How the query was read, slot by slot: the card states the filters it applied.
  return { ...a, intent: { ...(a.intent ?? { kind: `pipeline-${p.intent}`, pattern: p.intent, met: true, understood: [] }), understood: describe(p) } };
}

/** Whether the pipeline reads `q` completely (an intent it answers, every word explained). */
export async function pipelineReads(q: string, now?: number, prefer?: ReadonlySet<string>): Promise<boolean> {
  const p = await parseQuery(q, await parseContext(now, prefer));
  return p.complete && !!p.intent && ANSWERED.has(p.intent);
}

/** The award answers that take "first" and "latest" ("4215 latest Inspire award"). */
const AWARD_LISTS = new Set<IntentId>(["awards", "total-awards", "inspire-awards"]);

/** The intents that are a stat answer's own (server/api/answers/read.ts IntentId), by the same name. */
const TEAM_INTENTS = new Set<PipelineIntent>([
  "highest-score", "lowest-score", "biggest-win", "biggest-loss", "closest-match", "first-match", "recent-match", "last-matches", "best-finish",
  "worst-finish", "average-rank", "first-event", "last-event", "best-season", "first-season", "wins-count", "losses", "ties-count",
  "record", "win-percent", "average-score", "median-score", "average-margin", "total-points", "total-matches", "total-events", "seasons-count",
  "current-streak", "longest-streak", "highest-auto", "highest-teleop", "highest-endgame", "most-penalties", "penalties", "score-range",
  "score-consistency", "awards", "total-awards", "results", "event-rank", "event-opr", "best-partner", "partners", "opponents", "playoff-matches",
  "qual-matches", "match-lookup", "avg-penalties",
]);
const TWO_TEAM: Partial<Record<PipelineIntent, TwoTeamId>> = {
  "head-to-head": "head-to-head", "shared-matches": "shared-matches", "h2h-wins": "h2h-wins", "opr-vs": "opr-vs", "rating-vs": "rating-vs",
  "awards-vs": "awards-vs", "two-predict": "predict",
};
/** The two-team answers read from the matches the teams met in: the only ones an event, a match type or a side applies to. */
const MEETINGS = new Set<TwoTeamId>(["head-to-head", "h2h-wins", "shared-matches"]);
/** Every intent execute() answers (the rest are left to search's readers). */
const ANSWERED = new Set<PipelineIntent>([...TEAM_INTENTS, ...(Object.keys(TWO_TEAM) as PipelineIntent[]), "top-matches", "leaderboard"]);
/** The leaderboard's stat for a metric said ("by opr"); the prediction rating when none is. */
const BOARD_STAT: Partial<Record<string, string>> = {
  "metric:opr": "opr", "metric:rating": "rating", "metric:winrate": "win-rate", "metric:auto": "auto", "metric:teleop": "teleop",
  "metric:endgame": "endgame", "metric:record": "record", "metric:win": "wins", "metric:consistency": "reliability",
};

async function execute(p: Parsed, opts: PipelineOptions): Promise<SearchAnswer | null> {
  const intent = p.intent!;
  const scope = readScopeOf(p);
  if (!scope) return null;
  const said = normalise(p.q);
  if (p.teams.length === 1 && TEAM_INTENTS.has(intent)) {
    // An award with an answer of its own: Inspire (its places) and Finalist finishes.
    const id = (p.award === "Inspire" && (intent === "awards" || intent === "total-awards") ? "inspire-awards"
      : p.award === "Finalist" && (intent === "awards" || intent === "total-awards") ? "finalist-finishes" : intent) as IntentId;
    const d = intentDefaults(id);
    if (!d || !scopeFits(id, d.family, scope)) return null;
    const team = p.teams[0];
    // A season or a year with no events on record yet (a future year): said so, never the latest instead.
    const future = await noEventsYet(p, team.number, id, opts);
    if (future) return future(opts);
    const named = scope.season != null || scope.latest || scope.ever || scope.championship || scope.states || !!scope.at || !!scope.window;
    const outcome = p.symbols.includes("outcome:L") || (p.symbols.includes("metric:loss") && intent !== "losses") ? "L" : p.symbols.includes("outcome:W") || (p.symbols.includes("metric:win") && intent === "closest-match") ? "W" : null;
    const it: StatQuestion = {
      id, family: d.family, defaultSeason: d.alone && !named ? d.alone : d.season, scope,
      leadEvent: id === "highest-score" && p.symbols.includes("thing:event"),
      n: id === "match-lookup" ? p.matchNumber : p.n ?? (id === "last-matches" ? 5 : null), outcome: ["closest-match", "current-streak", "average-margin"].includes(id) ? outcome : null,
      count: p.agg === "count", noTeam: false, core: String(team.number),
      ...(p.award && (id === "awards" || id === "total-awards") ? { award: p.award } : {}),
      ...(AWARD_LISTS.has(id) && (p.agg === "first" || p.agg === "last") ? { pick: p.agg === "first" ? "first" : "latest" } : {}),
      ...(id === "penalties" ? { variant: p.symbols.includes("per:event") ? "per-event" : p.symbols.includes("per:rate") ? "rate" : null } : {}),
    };
    return statAnswerOf(p.q, it, opts.resolve, opts);
  }
  if (p.teams.length === 2 && TWO_TEAM[intent]) {
    const id = TWO_TEAM[intent]!;
    if (!MEETINGS.has(id) && (scope.at || scope.championship || scope.states || scope.level || scope.alliance || scope.window)) return null;
    return twoTeamSearch(p.q, { id, scope, a: String(p.teams[0].number), b: String(p.teams[1].number) }, opts.resolve, opts);
  }
  if (!p.teams.length && intent === "top-matches") {
    if (p.event || p.worlds || p.states || p.level || p.alliance || (p.place && p.place.kind === "city")) return null;
    // "The highest-scoring match": one match; "matches", "scores", "top 5": a list.
    const plural = /\b(?:matches|games|scores)\b/.test(said);
    return topSearch(p.q, {
      season: scope.season, game: null, ever: scope.ever, region: regionOf(p), event: null,
      ...(scope.window ? { window: scope.window } : {}), ...(p.n != null ? { n: p.n } : plural ? {} : { n: 1 }),
    }, opts);
  }
  if (!p.teams.length && intent === "leaderboard") {
    // The search box keeps the asks' own short card; the page draws the list.
    if (!opts.full) return null;
    if (p.event || p.worlds || p.states || p.level || p.alliance || scope.window || scope.ever || (p.place && p.place.kind !== "region")) return null;
    const stats = p.symbols.map((s) => BOARD_STAT[s]).filter((s): s is string => !!s && !!BOARD_STATS[s]);
    if (stats.length > 1) return null;
    // "The best team in NJ by OPR": one team, the next few under it; with no place or stat named, the top 10.
    const one = /\bteam\b/.test(said) && !/\bteams\b/.test(said) && p.n == null && !!p.place && stats.length === 1;
    const b: LeaderboardQuestion = { kind: "top", stat: stats[0] ?? "rating", n: one ? 5 : Math.min(25, p.n ?? 10), region: regionOf(p), city: null, season: scope.season, ...(one ? { best: true } : {}) };
    return boardSearch(p.q, b, opts);
  }
  return null;
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
    // country are a filter.
    if (p.place.kind === "city") return null;
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
