// Stat answers (docs/search.md, "Stat answers"): a question about a team's records answered from the stored matches,
// events, seasons and awards, by fixed rules (./read.ts reads it, ./clauses.ts scopes it, ./families/* answer it).
// Step 0 of search's chain (server/api/searchAnswer.ts): a query that isn't one of these, or whose team (or event)
// isn't found, goes on through the chain unchanged.
//
// The dropdown and /search get the same hits and the same reading; the answer's blocks (tables, records, charts) are
// worked out only for /search and its first paint (`full`), never per keystroke.
import type { SearchAnswer, SearchHit, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { dateRange, seasonLabel } from "../../../src/shared/format.js";
import { teamNameOf } from "../../../src/shared/teamTitle.js";
import { get } from "../../db.js";
import { fuzzyScore } from "../fuzzy.js";
import { search } from "../search.js";
import { readAsk } from "../searchAsks.js";
import { namedTeam } from "../searchCompare.js";
import { officialClause, scopePhrase, type Scope } from "./clauses.js";
import { teamEventSet, type TeamEvent } from "./eventSet.js";
import { awardsAnswer } from "./families/awards.js";
import { eventScopeAnswer } from "./families/eventScope.js";
import { eventAnswer } from "./families/events.js";
import { matchAnswer, whoOf } from "./families/matches.js";
import { BOARD_STATS, LEADERBOARD_MAX, leaderboardAnswer, statWords } from "./families/leaderboard.js";
import { headToHead, neverPlayedAnswer, opponentsAnswer, seasonSideBySide } from "./families/twoTeam.js";
import { winnersAnswer, worldsFollowUps } from "./families/winners.js";
import { shortEvent, teamMatches } from "./matchSet.js";
import { readLeaderboard, readStatQuestion, readTwoTeam, type LeaderboardQuestion, type IntentId, type StatQuestion, type TwoTeamId, type TwoTeamQuestion } from "./read.js";

/** Search's own answer for the part of a query that names the team (searchAnswer with intents off). */
export type Resolve = (core: string) => Promise<SearchAnswer>;

const TITLES: Record<IntentId, string> = {
  "highest-score": "Highest score", "lowest-score": "Lowest score", "biggest-win": "Biggest win", "biggest-loss": "Biggest loss", "closest-match": "Closest match",
  "first-match": "First match", "recent-match": "Most recent match", "best-finish": "Best event finish", "worst-finish": "Worst event finish", "first-event": "First event",
  "last-event": "Most recent event", "best-opr-event": "Best OPR event", "best-season": "Best season", "most-improved-season": "Most improved season", "first-season": "First season",
  "wins-count": "Match wins", record: "Record", "average-score": "Average score", "total-matches": "Matches played", "total-events": "Events played", "seasons-played": "Seasons played",
  "seasons-count": "How many seasons", "current-streak": "Current streak", "longest-streak": "Longest win streak", "last-matches": "Last matches", "average-rank": "Average event rank",
  "playoff-appearances": "Playoff appearances", "blowout-wins": "Blowout wins", losses: "Losses", "playoff-matches": "Playoff matches", "qual-matches": "Qualification matches",
  "red-blue-record": "Record by alliance colour", results: "Results", "event-rank": "Rank", "event-opr": "OPR", "match-lookup": "Match",
  "event-wins": "Event wins", "inspire-awards": "Inspire Awards", "finalist-finishes": "Finalist finishes", "total-awards": "All awards", "award-split": "Judged and performance awards",
  awards: "Awards", "winning-alliance": "Winning alliance",
  "most-played-opponent": "Most played opponent", "toughest-opponent": "Toughest opponent", "best-partner": "Best alliance partner", "frequent-partner": "Most frequent partner", "never-played": "Teams never played",
};
const TWO_TEAM_TITLES: Record<TwoTeamId, string> = { "head-to-head": "Head to head", "opr-vs": "OPR side by side", "rating-vs": "Prediction ratings side by side", "win-chance": "Win chance", "better-record": "Better record" };

/** The intents about the team's opponents and partners (family 6, one team named). */
const OPPONENT_INTENTS = new Set<IntentId>(["most-played-opponent", "toughest-opponent", "best-partner", "frequent-partner"]);

/** The intents read from event and season rows; the rest from matches (or awards). */
const EVENT_INTENTS = new Set<IntentId>(["best-finish", "worst-finish", "first-event", "last-event", "best-opr-event", "best-season", "most-improved-season", "first-season", "total-events", "average-rank", "seasons-played", "seasons-count"]);
const AWARD_INTENTS = new Set<IntentId>(["event-wins", "inspire-awards", "finalist-finishes", "total-awards", "award-split", "awards"]);

/** One of the team's events, by the words typed ("New Jersey Championship"): the best name match of every season it
 *  attended, the newest season on a tie (or the season named). Two events of one season matching about as well
 *  ("Northern League Meet"): no pick, never a guess. */
export function pickTeamEvent(evs: TeamEvent[], words: string, season: number | null): TeamEvent | null {
  const scored = evs.filter((e) => season == null || e.season === season)
    .map((e) => ({ e, s: Math.max(fuzzyScore(words, e.name), fuzzyScore(words, e.code)) }))
    .filter((x) => x.s >= 0.75)
    .sort((a, b) => b.s - a.s || b.e.season - a.e.season || String(b.e.start).localeCompare(String(a.e.start)));
  const [best, next] = scored;
  if (!best) return null;
  if (next && next.e.season === best.e.season && best.s - next.s < 0.05) return null;
  return best.e;
}

/** The team's latest season with matches at official events (a season of only scrimmages isn't one). */
async function latestSeason(team: number): Promise<number | null> {
  const ms = (await teamMatches(team)).filter(officialClause());
  return ms.length ? Math.max(...ms.map((m) => m.season)) : null;
}

/** The scope an answer covers: the season named, else "this season" or an intent that defaults to one as the team's
 *  latest season with matches at official events (said so), else every season. */
async function scopeFor(it: StatQuestion, team: number): Promise<Scope | null> {
  const s = it.scope;
  const scope: Scope = { season: s.season, championship: s.championship, states: s.states, level: s.level ?? undefined, alliance: s.alliance ?? undefined };
  if (s.at) {
    // An event the team attended, in the season asked for ("this season": the team's latest with matches); none (or two
    // alike): left to search's team-at-event answer, which lets the visitor pick.
    const season = s.season ?? (s.latest ? await latestSeason(team) : null);
    if (s.latest && season == null) return null;
    const e = pickTeamEvent((await teamEventSet(team)).events, s.at, season);
    if (!e) return null;
    return { ...scope, season: null, event: { season: e.season, code: e.code, name: e.name } };
  }
  if (s.season == null && !s.ever && (s.latest || it.defaultSeason === "latest")) {
    const latest = await latestSeason(team);
    scope.season = latest;
    if (latest != null) scope.seasonWhy = `"This season" here is ${seasonLabel(latest)}, the team's latest season with matches on record.`;
  }
  return scope;
}

/** An event by name for a team-less question (its newest season, or the season named). */
async function findEvent(words: string, season: number | null) {
  const hits = (await search(words, 8, new Set(), new Set(["event"]), season)).filter((h) => h.kind === "event" && (season == null || h.season === season));
  const top = hits[0];
  if (!top) return null;
  const [s, code] = top.ref.split(":");
  // No season named: the newest season of that event with a played playoff (an event not held yet has no winners).
  const played = season != null ? null : await get<{ s: number | null }>("SELECT MAX(season) s FROM matches WHERE code = ? AND level = 'playoff' AND played = 1", [code]);
  const at = played?.s != null ? Number(played.s) : Number(s);
  return (await get<any>("SELECT season, code, name, type, start, end, division_code division FROM events WHERE season = ? AND code = ?", [at, code])) ?? null;
}

/** The answer for `q`, or null when it isn't a stat question or its team isn't found. */
export async function statAnswer(q: string, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  // The asks' leaderboards are drawn here on the page; the dropdown keeps the asks' own short card.
  const board = readLeaderboard(q) ?? (opts.full ? boardOfAsk(q) : null);
  if (board) return boardSearch(q, board, opts);
  const two = readTwoTeam(q);
  if (two) return twoTeamSearch(q, two, resolve, opts);
  const it = readStatQuestion(q);
  if (!it) return null;
  if (it.noTeam) return winnersSearch(q, it, opts);
  const base = await resolve(it.core);
  const top = base.step !== "recovery" ? base.hits[0] : undefined;
  if (!top || top.kind !== "team" || top.href) return null;
  const team = { number: Number(top.ref), name: teamNameOf(top.title) || null };
  const scope = await scopeFor(it, team.number);
  if (!scope) return null;
  const title = `${it.leadEvent ? "Event with the highest score" : TITLES[it.id]}${scopePhrase(scope)}`;
  const label = `${whoOf(team)} · ${title}`;
  const section = AWARD_INTENTS.has(it.id) ? "awards" : EVENT_INTENTS.has(it.id) ? "history" : "matches";
  const linkSeason = scope.season ?? scope.event?.season;
  const hit: SearchHit = { ...top, section, ...(linkSeason != null ? { linkSeason } : {}), facts: undefined, events: undefined };
  // A team found by a correction ("hypnotc") keeps search's warning, said for the whole question.
  const guessed = base.step === "did-you-mean";
  const said = q.toLowerCase();
  const answer: SearchAnswer = {
    q, hits: [hit, ...base.hits.slice(1).filter((h) => !(h.kind === "team" && h.ref === top.ref))], pages: opts.pages, step: guessed ? "did-you-mean" : "deterministic", weak: guessed && base.weak,
    ...(guessed && base.didYouMean ? { didYouMean: said.includes(it.core) ? said.replace(it.core, base.didYouMean) : base.didYouMean } : {}),
    understood: { kind: "question", label, ...(linkSeason != null ? { season: linkSeason } : {}) },
    intent: { kind: `stat-${it.id}`, pattern: `[team] ${it.id}${scope.event ? " [event]" : ""}${it.scope.championship ? " [worlds]" : ""}${scope.season != null ? " [season]" : ""}`, met: true, understood: [`Team ${whoOf(team)}`, title] },
  };
  if (!opts.full) return answer;
  const stat = await build(it, team, scope);
  if (!stat) return null;
  if (scope.seasonWhy) stat.definition = `${stat.definition} ${scope.seasonWhy}`;
  // A Worlds answer ends with the season's championship events and the related Worlds questions (never instead of it).
  if (scope.championship) {
    const season = scope.season ?? worldsSeason(stat);
    const follow = await worldsFollowUps(season, team);
    stat.blocks.push(...follow.map((b) => (b.kind === "related" ? { ...b, queries: b.queries.filter((x) => x.toLowerCase() !== q.toLowerCase()) } : b)));
  }
  return { ...answer, stat };
}

/** The season a Worlds answer is about: its headline's (the match or event it names), else the latest in the data. */
const worldsSeason = (s: StatAnswer): number | null => {
  const m = /\b(20\d\d)–\d\d\b/.exec(s.headline?.sub ?? "") ?? /\b(20\d\d)–\d\d\b/.exec(s.headline?.label ?? "");
  return m ? Number(m[1]) : null;
};

async function build(it: StatQuestion, team: { number: number; name: string | null }, scope: Scope): Promise<StatAnswer | null> {
  if (AWARD_INTENTS.has(it.id)) return awardsAnswer(it.id, team, scope, { count: it.count });
  if (EVENT_INTENTS.has(it.id)) return eventAnswer(it.id, team, await teamEventSet(team.number), scope);
  const ms = await teamMatches(team.number);
  if (OPPONENT_INTENTS.has(it.id)) return opponentsAnswer(it.id, team, ms, scope);
  if (it.id === "never-played") return neverPlayedAnswer(team, ms, scope);
  if (scope.event) {
    const ev = (await teamEventSet(team.number)).events.find((e) => e.season === scope.event!.season && e.code === scope.event!.code);
    const at = await eventScopeAnswer(it.id, team, ms, ev, scope, { n: it.n });
    if (at) return at;
  }
  return matchAnswer(it.id, team, ms, scope, { leadEvent: it.leadEvent, n: it.n, outcome: it.outcome });
}

/** "ftc decode winning alliance", "New Jersey Championship winning alliance": no team, an event's (or the season's
 *  championship's) winners. The event is the hit; its answer is worked out for the page only. */
async function winnersSearch(q: string, it: StatQuestion, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const championship = it.scope.championship || !it.core;
  const named = championship ? null : await findEvent(it.core, it.scope.season);
  if (!championship && !named) return null;
  const stat = opts.full ? await winnersAnswer(it.core, it.scope.season, championship, async () => named) : null;
  if (opts.full && !stat) return null;
  const season = named?.season ?? it.scope.season;
  const label = named ? `${shortEvent(named.name, named.type)} · Winning alliance` : `${season != null ? `${seasonLabel(season)} ` : ""}FIRST Championship · Winning alliances`;
  const hits: SearchHit[] = named ? [{ kind: "event", ref: `${named.season}:${named.code}`, title: named.name, subtitle: [named.code, dateRange(named.start, named.end)].filter(Boolean).join(" · "), season: named.season, section: "playoffs" }] : [];
  return {
    q, hits, pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label: stat?.title ?? label, ...(season != null ? { season } : {}) },
    intent: { kind: "stat-winning-alliance", pattern: named ? "[event] winning alliance" : "[season] winning alliance", met: true, understood: [label] },
    ...(stat ? { stat } : {}),
  };
}

/** "4215 vs 6980 head to head", "4215 OPR vs 6980": both teams found by search as typed (a team number or a name it
 *  matches outright), else left to Compare's own versus answer, which asks about a shared name. */
async function twoTeamSearch(q: string, two: TwoTeamQuestion, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  // Each side by Compare's own rules (a number, an exact name, the one that has played, the newest); a name several
  // teams share is left to Compare, which asks which one.
  const [na, nb] = await Promise.all([namedTeam(two.a, new Set()), namedTeam(two.b, new Set())]);
  if (!na || !nb || !("team" in na) || !("team" in nb) || na.team === nb.team) return null;
  const hitOf = async (n: number) => (await resolve(String(n))).hits.find((h) => h.kind === "team" && h.ref === String(n));
  const [ta, tb] = await Promise.all([hitOf(na.team), hitOf(nb.team)]);
  if (!ta || !tb || ta.href || tb.href) return null;
  const a = { number: Number(ta.ref), name: teamNameOf(ta.title) || null }, b = { number: Number(tb.ref), name: teamNameOf(tb.title) || null };
  const s = two.scope;
  const scope: Scope = { season: s.season, championship: s.championship, states: s.states, level: s.level ?? undefined, alliance: s.alliance ?? undefined };
  // "This season" for the meetings: the first team's latest season with matches; for season numbers, the latest both played.
  if (two.id === "head-to-head" && s.season == null && s.latest) {
    const ms = (await teamMatches(a.number)).filter(officialClause());
    scope.season = ms.length ? Math.max(...ms.map((m) => m.season)) : null;
    if (scope.season != null) scope.seasonWhy = `"This season" here is ${seasonLabel(scope.season)}, ${a.number}'s latest season with matches on record.`;
  }
  const title = `${TWO_TEAM_TITLES[two.id]}: ${whoOf(a)} vs ${whoOf(b)}`;
  const answer: SearchAnswer = {
    q, hits: [{ ...ta, section: "matches", facts: undefined, events: undefined }, { ...tb, section: "matches", facts: undefined, events: undefined }], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label: title, ...(scope.season != null ? { season: scope.season } : {}) },
    intent: { kind: `stat-${two.id}`, pattern: `[team] ${two.id} [team]${scope.season != null ? " [season]" : ""}`, met: true, understood: [`Teams ${whoOf(a)} and ${whoOf(b)}`, TWO_TEAM_TITLES[two.id]] },
  };
  if (!opts.full) return answer;
  const stat = two.id === "head-to-head" ? await headToHead(a, b, await teamMatches(a.number), scope) : await seasonSideBySide(two.id, a, b, scope);
  if (scope.seasonWhy) stat.definition = `${stat.definition} ${scope.seasonWhy}`;
  return { ...answer, stat };
}

/** The asks' own leaderboards ("top teams in the world", "best auto team", "highest opr in texas": ../searchAsks.ts
 *  readAsk) drawn as this leaderboard: the world's or a place's rankings by prediction rating, as Rankings orders
 *  them, or a stat's leaders; the top 10 unless a number is asked. */
function boardOfAsk(q: string): LeaderboardQuestion | null {
  const ask = readAsk(q.replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim());
  if (!ask || (ask.kind !== "leaderboard" && ask.kind !== "stat")) return null;
  const n = Math.min(LEADERBOARD_MAX, Math.max(1, Number(/\btop\s+(\d{1,2})\b/i.exec(q)?.[1] ?? 10)));
  const stat = ask.kind === "leaderboard" ? BOARD_STATS.rating : BOARD_STATS[ask.stat];
  return { kind: "top", stat: stat.id, n, region: ask.region, city: null, season: null };
}

/** "Top 10 teams by OPR in NJ", "best rookie team in New Jersey", "teams in Oradell": a ranked list (or a city's
 *  teams), worked out for the page only. A city no team lists is left to search. */
async function boardSearch(q: string, b: LeaderboardQuestion, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const city = b.kind === "city" ? await get<{ city: string }>("SELECT city FROM teams WHERE lower(city) = lower(?) LIMIT 1", [b.city]) : null;
  if (b.kind === "city" && !city) return null;
  const st = BOARD_STATS[b.stat];
  const where = b.region ? ` in ${b.region.name}` : city ? ` in ${city.city}` : "";
  const label = b.kind === "city" ? `Teams${where}` : b.kind === "rookie" ? `Best rookie teams${where}` : b.kind === "improved" ? `Most improved teams${where}` : `Top ${b.n} teams by ${statWords(st)}${where}`;
  const answer: SearchAnswer = {
    q, hits: [], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label, ...(b.season != null ? { season: b.season } : {}), ...(b.region ? { place: { key: b.region.key, name: b.region.name } } : {}) },
    intent: { kind: `stat-leaderboard-${b.kind}`, pattern: b.kind === "city" ? "teams in [city]" : `${b.kind} [stat]${b.region ? " [place]" : ""}`, met: true, understood: [label] },
  };
  if (!opts.full) return answer;
  const stat = await leaderboardAnswer({ ...b, stat: st });
  // The full list's page (Teams for an OPR list, Rankings for a rating list) leads the page links.
  const more = stat.blocks.find((x) => x.kind === "leaderboard")?.more;
  return { ...answer, stat, pages: more ? [{ title: more.label.replace(/^View more detail on (?:the )?/, "").replace(/^./, (c) => c.toUpperCase()), href: more.href }, ...opts.pages.filter((p) => p.href !== more.href)] : opts.pages };
}
