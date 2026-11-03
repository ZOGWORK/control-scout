// Stat answers (docs/search.md, "Stat answers"): a question about a team's records answered from the stored matches,
// events and seasons, by fixed rules (./read.ts reads it, ./clauses.ts scopes it, ./families/* answer it). Step 0 of
// search's chain (server/api/searchAnswer.ts): a query that isn't one of these, or whose team isn't found, goes on
// through the chain unchanged.
//
// The dropdown and /search get the same hits and the same reading; the answer's blocks (tables, records, charts) are
// worked out only for /search and its first paint (`full`), never per keystroke.
import type { SearchAnswer, SearchHit, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { teamNameOf } from "../../../src/shared/teamTitle.js";
import { officialClause, scopePhrase, type Scope } from "./clauses.js";
import { teamEventSet } from "./eventSet.js";
import { matchAnswer, whoOf } from "./families/matches.js";
import { eventAnswer } from "./families/events.js";
import { teamMatches } from "./matchSet.js";
import { readStatQuestion, type IntentId, type StatQuestion } from "./read.js";

/** Search's own answer for the part of a query that names the team (searchAnswer with intents off). */
export type Resolve = (core: string) => Promise<SearchAnswer>;

const TITLES: Record<IntentId, string> = {
  "highest-score": "Highest score", "lowest-score": "Lowest score", "biggest-win": "Biggest win", "biggest-loss": "Biggest loss", "closest-match": "Closest match",
  "first-match": "First match", "recent-match": "Most recent match", "best-finish": "Best event finish", "worst-finish": "Worst event finish", "first-event": "First event",
  "last-event": "Most recent event", "best-opr-event": "Best OPR event", "best-season": "Best season", "most-improved-season": "Most improved season", "first-season": "First season",
  "wins-count": "Match wins", record: "Record", "average-score": "Average score", "total-matches": "Matches played", "total-events": "Events played", "seasons-played": "Seasons played",
  "seasons-count": "How many seasons", "current-streak": "Current streak", "longest-streak": "Longest win streak", "last-matches": "Last matches", "average-rank": "Average event rank",
  "playoff-appearances": "Playoff appearances", "blowout-wins": "Blowout wins", losses: "Losses", "playoff-matches": "Playoff matches", "qual-matches": "Qualification matches",
  "red-blue-record": "Record by alliance colour",
};

/** The intents read from event and season rows; the rest from matches. */
const EVENT_INTENTS = new Set<IntentId>(["best-finish", "worst-finish", "first-event", "last-event", "best-opr-event", "best-season", "most-improved-season", "first-season", "total-events", "average-rank", "seasons-played", "seasons-count"]);

/** The scope an answer covers: the season named, else "this season" or an intent that defaults to one as the team's
 *  latest season with matches at official events (said so), else every season. */
async function scopeFor(it: StatQuestion, team: number): Promise<Scope> {
  const s = it.scope;
  const scope: Scope = { season: s.season, championship: s.championship, states: s.states, level: s.level ?? undefined, alliance: s.alliance ?? undefined };
  if (s.season == null && !s.ever && (s.latest || it.defaultSeason === "latest")) {
    // A season of only scrimmages isn't one: its matches never count.
    const official = officialClause();
    const ms = (await teamMatches(team)).filter(official);
    const latest = ms.length ? Math.max(...ms.map((m) => m.season)) : null;
    scope.season = latest;
    if (latest != null) scope.seasonWhy = `"This season" here is ${seasonLabel(latest)}, the team's latest season with matches on record.`;
  }
  return scope;
}

/** The answer for `q`, or null when it isn't a stat question or its team isn't found. */
export async function statAnswer(q: string, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const it = readStatQuestion(q);
  if (!it) return null;
  const base = await resolve(it.core);
  const top = base.step !== "recovery" ? base.hits[0] : undefined;
  if (!top || top.kind !== "team" || top.href) return null;
  const team = { number: Number(top.ref), name: teamNameOf(top.title) || null };
  const scope = await scopeFor(it, team.number);
  const title = `${it.leadEvent ? "Event with the highest score" : TITLES[it.id]}${scopePhrase(scope)}`;
  const label = `${whoOf(team)} · ${title}`;
  const hit: SearchHit = { ...top, section: EVENT_INTENTS.has(it.id) ? "history" : "matches", ...(scope.season != null ? { linkSeason: scope.season } : {}), facts: undefined, events: undefined };
  // A team found by a correction ("hypnotc") keeps search's warning, said for the whole question.
  const guessed = base.step === "did-you-mean";
  const said = q.toLowerCase();
  const answer: SearchAnswer = {
    q, hits: [hit, ...base.hits.slice(1).filter((h) => !(h.kind === "team" && h.ref === top.ref))], pages: opts.pages, step: guessed ? "did-you-mean" : "deterministic", weak: guessed && base.weak,
    ...(guessed && base.didYouMean ? { didYouMean: said.includes(it.core) ? said.replace(it.core, base.didYouMean) : base.didYouMean } : {}),
    understood: { kind: "question", label, ...(scope.season != null ? { season: scope.season } : {}) },
    intent: { kind: `stat-${it.id}`, pattern: `[team] ${it.id}${it.scope.championship ? " [worlds]" : ""}${scope.season != null ? " [season]" : ""}`, met: true, understood: [`Team ${whoOf(team)}`, title] },
  };
  if (!opts.full) return answer;
  const stat = await build(it, team, scope);
  if (!stat) return null;
  if (scope.seasonWhy) stat.definition = `${stat.definition} ${scope.seasonWhy}`;
  return { ...answer, stat };
}

async function build(it: StatQuestion, team: { number: number; name: string | null }, scope: Scope): Promise<StatAnswer | null> {
  if (EVENT_INTENTS.has(it.id)) return eventAnswer(it.id, team, await teamEventSet(team.number), scope);
  return matchAnswer(it.id, team, await teamMatches(team.number), scope, { leadEvent: it.leadEvent, n: it.n, outcome: it.outcome });
}
