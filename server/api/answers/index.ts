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
import { findRegions } from "../../../src/shared/regions.js";
import { CURRENT_SEASON } from "../../data/seasons.js";
import { teamNameOf } from "../../../src/shared/teamTitle.js";
import { get } from "../../db.js";
import { fuzzyScore } from "../fuzzy.js";
import { search } from "../search.js";
import { eventWon, readAsk } from "../searchAsks.js";
import { eventHit } from "../searchEvents.js";
import { namedTeam } from "../searchCompare.js";
import { officialClause, scopePhrase, type Scope } from "./clauses.js";
import { teamEventSet, type TeamEvent } from "./eventSet.js";
import { awardsAnswer, awardsTitle } from "./families/awards.js";
import { eventScopeAnswer, worldsMatchesAnswer } from "./families/eventScope.js";
import { eventAnswer } from "./families/events.js";
import { factAnswer, readTeamFact, type FactQuestion } from "./families/facts.js";
import { counts, matchAnswer, whoOf } from "./families/matches.js";
import { BOARD_STATS, LEADERBOARD_MAX, leaderboardAnswer, statWords } from "./families/leaderboard.js";
import { everTopMatches, readTopMatches, topMatchesAnswer, type TopMatchesQuestion } from "./families/topMatches.js";
import { penaltyTotalAnswer, trendAnswer } from "./families/trends.js";
import { headToHead, neverPlayedAnswer, opponentsAnswer, seasonSideBySide } from "./families/twoTeam.js";
import { winnersAnswer, worldsFollowUps } from "./families/winners.js";
import { shortEvent, teamMatches } from "./matchSet.js";
import { readLeaderboard, readStatQuestion, readTwoTeam, type LeaderboardQuestion, type IntentId, type StatQuestion, type TwoTeamId, type TwoTeamQuestion } from "./read.js";

/** Search's own answer for the part of a query that names the team (searchAnswer with intents off). */
export type Resolve = (core: string) => Promise<SearchAnswer>;

const TITLES: Record<IntentId, string> = {
  "highest-score": "Highest score", "lowest-score": "Lowest score", "biggest-win": "Biggest win", "biggest-loss": "Biggest loss", "closest-match": "Closest match",
  "first-match": "First match", "recent-match": "Most recent match", "best-finish": "Best event finish", "worst-finish": "Worst event finish", "first-place-events": "Events ranked 1st", "worlds-divisions": "Worlds divisions", "first-event": "First event",
  "last-event": "Most recent event", "best-opr-event": "Best OPR event", "best-season": "Best season", "most-improved-season": "Most improved season", "first-season": "First season",
  "wins-count": "Match wins", record: "Record", "average-score": "Average score", "average-margin": "Average margin", "total-points": "Total points", "total-matches": "Matches played", "total-events": "Events played", "seasons-played": "Seasons played",
  "seasons-count": "How many seasons", "current-streak": "Current streak", "longest-streak": "Longest win streak", "last-matches": "Last matches", "average-rank": "Average event rank",
  "playoff-appearances": "Playoff appearances", "blowout-wins": "Blowout wins", losses: "Losses", "playoff-matches": "Playoff matches", "qual-matches": "Qualification matches",
  "red-blue-record": "Record by alliance colour", results: "Results", "event-rank": "Rank", "event-opr": "OPR", "match-lookup": "Match",
  "event-wins": "Event wins", "inspire-awards": "Inspire Awards", "finalist-finishes": "Finalist finishes", "total-awards": "All awards", "award-split": "Judged and performance awards",
  awards: "Awards", "winning-alliance": "Winning alliance",
  "opr-history": "OPR by event", "opr-by-season": "OPR by season", "record-by-season": "Record by season", "win-rate": "Win rate by event", "avg-penalties": "Penalty points given by event",
  "avg-score-by-event": "Average alliance score by event", "ranking-points": "Ranking points by event", "total-penalties": "Penalty points given",
  "most-played-opponent": "Most played opponent", "toughest-opponent": "Toughest opponent", "best-partner": "Best alliance partner", "frequent-partner": "Most frequent partner", "never-played": "Teams never played",
};
const TWO_TEAM_TITLES: Record<TwoTeamId, string> = { "head-to-head": "Head to head", "opr-vs": "OPR side by side", "rating-vs": "Prediction ratings side by side", "win-chance": "Win chance", "better-record": "Better record" };

/** The intents about the team's opponents and partners (family 6, one team named). */
/** One number over the team's events or seasons (family 2), and a season's penalty total. */
const TREND_INTENTS = new Set<IntentId>(["opr-history", "opr-by-season", "record-by-season", "win-rate", "avg-penalties", "avg-score-by-event", "ranking-points", "total-penalties"]);
const OPPONENT_INTENTS = new Set<IntentId>(["most-played-opponent", "toughest-opponent", "best-partner", "frequent-partner"]);

/** The intents read from event and season rows; the rest from matches (or awards). */
const EVENT_INTENTS = new Set<IntentId>(["best-finish", "worst-finish", "first-place-events", "worlds-divisions", "first-event", "last-event", "best-opr-event", "best-season", "most-improved-season", "first-season", "total-events", "average-rank", "seasons-played", "seasons-count"]);
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
async function latestSeason(team: number, id?: IntentId): Promise<number | null> {
  // A season of only scrimmages isn't one, nor one where the team is only on a roster (league rosters list teams that
  // never took the field): the latest season with a match the answer counts.
  const official = officialClause();
  const ms = (await teamMatches(team)).filter((m) => official(m) && (!id || counts(id, m)));
  return ms.length ? Math.max(...ms.map((m) => m.season)) : null;
}

/** "new jersey events", "nj meets": a region named outright (its whole name or code), else null. */
function placeOf(at: string) {
  const words = at.replace(/\b(?:the|events?|meets?|competitions?|tournaments?)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!words || words === at) return null;
  return findRegions(words).find((r) => r.name.toLowerCase() === words || r.state.toLowerCase() === words) ?? null;
}

/** The scope an answer covers: the season named, else "this season" or an intent that defaults to one as the team's
 *  latest season with matches at official events (said so), else every season. */
async function scopeFor(it: StatQuestion, team: number): Promise<Scope | null> {
  const s = it.scope;
  const scope: Scope = { season: s.season, championship: s.championship, states: s.states, level: s.level ?? undefined, alliance: s.alliance ?? undefined };
  // "4215 awards at New Jersey events": a place (the events' own region), not one event.
  const region = s.at ? placeOf(s.at) : null;
  if (region) scope.place = { country: region.country, state: region.state, name: region.name };
  else if (s.at) {
    // An event the team attended, in the season asked for ("this season": the team's latest with matches); none (or two
    // alike): left to search's team-at-event answer, which lets the visitor pick.
    const season = s.season ?? (s.latest ? await latestSeason(team, it.id) : null);
    if (s.latest && season == null) return null;
    const e = pickTeamEvent((await teamEventSet(team)).events, s.at, season);
    if (!e) return null;
    return { ...scope, season: null, event: { season: e.season, code: e.code, name: e.name } };
  }
  if (s.season == null && !s.ever && (s.latest || it.defaultSeason === "latest")) {
    const latest = await latestSeason(team, it.id);
    // A plain "4215 record" with no match on record is left to search's team answer (its stored season record).
    if (latest == null && it.id === "record" && !s.latest) return null;
    scope.season = latest;
    if (latest != null) scope.seasonWhy = !s.latest
      ? `The season is ${seasonLabel(latest)}, the team's latest with matches on record.`
      : latest !== CURRENT_SEASON
        ? `"This season" here is ${seasonLabel(latest)}: no ${seasonLabel(CURRENT_SEASON)} matches yet, so the team's latest season with matches on record.`
        : `"This season" here is ${seasonLabel(latest)}, the team's latest season with matches on record.`;
  }
  return scope;
}

/** An event by name for a team-less question (its newest season, or the season named). */
async function findEvent(words: string, season: number | null, opts: { anyPlayed?: boolean } = {}) {
  const found = (await search(words, 8, new Set(), new Set(["event"]), season)).filter((h) => h.kind === "event");
  const row = (s: number, code: string) => get<any>("SELECT season, code, name, type, start, end, division_code division FROM events WHERE season = ? AND code = ?", [s, code]);
  // A season named: the first event found that was held that season (search lists an event once, by its newest season,
  // so an older one is looked up by its code).
  if (season != null) {
    for (const h of found) { const e = await row(season, h.ref.split(":")[1]); if (e) return e; }
    return null;
  }
  const top = found[0];
  if (!top) return null;
  const [s, code] = top.ref.split(":");
  // No season named: the newest season of that event with a played playoff (an event not held yet has no winners), or
  // with any played match when the answer is its matches.
  // An answer about its matches counts its divisions' matches too.
  const played = opts.anyPlayed
    ? await get<{ s: number | null }>("SELECT MAX(m.season) s FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE (e.code = ? OR e.division_code = ?) AND m.played = 1", [code, code])
    : await get<{ s: number | null }>("SELECT MAX(season) s FROM matches WHERE code = ? AND level = 'playoff' AND played = 1", [code]);
  return (await row(played?.s != null ? Number(played.s) : Number(s), code)) ?? null;
}

/** The answer for `q`, or null when it isn't a stat question or its team isn't found. */
export async function statAnswer(q: string, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  // A season's highest-scoring matches before a leaderboard ("highest scoring matches at <event>" names no city).
  const tm = readTopMatches(q);
  if (tm) return topSearch(q, tm, opts);
  // The asks' leaderboards are drawn here on the page; the dropdown keeps the asks' own short card.
  const board = readLeaderboard(q) ?? (opts.full ? boardOfAsk(q) : null);
  if (board) return boardSearch(q, board, opts);
  const two = readTwoTeam(q);
  if (two) return twoTeamSearch(q, two, resolve, opts);
  const it = readStatQuestion(q);
  if (!it) {
    const f = readTeamFact(q);
    return f ? factSearch(q, f, resolve, opts) : null;
  }
  if (it.noTeam) return winnersSearch(q, it, opts);
  const base = await resolve(it.core);
  const top = base.step !== "recovery" ? base.hits[0] : undefined;
  if (!top || top.kind !== "team" || top.href) return null;
  const team = { number: Number(top.ref), name: teamNameOf(top.title) || null };
  const scope = await scopeFor(it, team.number);
  if (!scope) return null;
  // "average winning margin" is titled as asked, not as the plain average margin.
  const name = it.id === "average-margin" && it.outcome ? `Average ${it.outcome === "W" ? "winning" : "losing"} margin`
    : AWARD_INTENTS.has(it.id) ? awardsTitle(it.id, it) ?? TITLES[it.id] : it.byRecord ? (it.id === "best-finish" ? "Best event" : "Worst event") : TITLES[it.id];
  const title = `${it.leadEvent ? "Event with the highest score" : name}${scopePhrase(it.id === "worlds-divisions" ? { ...scope, championship: false } : scope)}`;
  // "This season" with none of the season in progress played yet reads the team's latest: the heading names that
  // season (its title ends "in 2025–26"), and the answer's note says why (scope.seasonWhy), so the heading stays clean.
  const label = `${whoOf(team)} · ${title}`;
  const section = AWARD_INTENTS.has(it.id) ? "awards" : EVENT_INTENTS.has(it.id) || TREND_INTENTS.has(it.id) ? "history" : "matches";
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
  if (AWARD_INTENTS.has(it.id)) return awardsAnswer(it.id, team, scope, { count: it.count, award: it.award, pick: it.pick });
  if (it.id === "total-penalties") return penaltyTotalAnswer(team, await teamEventSet(team.number), scope);
  if (TREND_INTENTS.has(it.id)) return trendAnswer(it.id, team, await teamEventSet(team.number), scope);
  if (EVENT_INTENTS.has(it.id)) return eventAnswer(it.id, team, await teamEventSet(team.number), scope, { byRecord: it.byRecord });
  const ms = await teamMatches(team.number);
  if (OPPONENT_INTENTS.has(it.id)) return opponentsAnswer(it.id, team, ms, scope);
  if (it.id === "never-played") return neverPlayedAnswer(team, ms, scope);
  if (scope.event) {
    const ev = (await teamEventSet(team.number)).events.find((e) => e.season === scope.event!.season && e.code === scope.event!.code);
    const at = await eventScopeAnswer(it.id, team, ms, ev, scope, { n: it.n });
    if (at) return at;
  }
  if (it.id === "results" && scope.championship) return worldsMatchesAnswer(team, ms, scope);
  return matchAnswer(it.id, team, ms, scope, { leadEvent: it.leadEvent, n: it.n, outcome: it.outcome });
}

/** "Highest scoring games in decode", "top scores in nj this season", "highest scoring match ever": no team, a
 *  season's best alliance and combined scores, worked out for the page only. */
async function topSearch(q: string, t: TopMatchesQuestion, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const label = `Highest-scoring matches${t.region ? ` in ${t.region.name}` : t.event ? ` at ${t.event}` : ""}${t.ever ? ", each season" : t.season != null ? `, ${seasonLabel(t.season)}` : ""}`;
  const answer: SearchAnswer = {
    q, hits: [], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label, ...(t.season != null ? { season: t.season } : {}), ...(t.region ? { place: { key: t.region.key, name: t.region.name } } : {}) },
    intent: { kind: "stat-season-top-matches", pattern: `highest scoring matches${t.region ? " [place]" : t.event ? " [event]" : ""}${t.season != null ? " [season]" : ""}`, met: true, understood: [label] },
  };
  // The search box keeps the asks' own high-score card.
  if (!opts.full) return null;
  const matchesAt = (words: string, season: number | null) => findEvent(words, season, { anyPlayed: true });
  const stat = t.ever ? await everTopMatches(t, matchesAt) : await topMatchesAnswer(t, matchesAt);
  if (!stat) return null;
  return { ...answer, understood: { ...answer.understood!, label: stat.title }, stat };
}

/** "4215 auto OPR", "4215 reliability", "4215 school": one team's stored fact. The team is found as search finds it;
 *  the answer is worked out for the page only. */
async function factSearch(q: string, f: FactQuestion, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const base = await resolve(f.core);
  const top = base.step !== "recovery" ? base.hits[0] : undefined;
  if (!top || top.kind !== "team" || top.href) return null;
  const team = { number: Number(top.ref), name: teamNameOf(top.title) || null };
  const label = `${whoOf(team)} · ${FACT_TITLES[f.id]}`;
  const guessed = base.step === "did-you-mean";
  const answer: SearchAnswer = {
    q, hits: [{ ...top, ...(f.season != null ? { linkSeason: f.season } : {}) }, ...base.hits.slice(1).filter((h) => !(h.kind === "team" && h.ref === top.ref))], pages: opts.pages,
    step: guessed ? "did-you-mean" : "deterministic", weak: guessed && base.weak,
    ...(guessed && base.didYouMean ? { didYouMean: q.toLowerCase().includes(f.core) ? q.toLowerCase().replace(f.core, base.didYouMean) : base.didYouMean } : {}),
    understood: { kind: "question", label, ...(f.season != null ? { season: f.season } : {}) },
    intent: { kind: `stat-${f.id}`, pattern: `[team] ${f.id}${f.region ? " [place]" : f.event ? " [event]" : ""}${f.season != null ? " [season]" : ""}`, met: true, understood: [`Team ${whoOf(team)}`, FACT_TITLES[f.id]] },
  };
  if (!opts.full) return answer;
  const stat = await factAnswer(f, team, (words, season) => findEvent(words, season, { anyPlayed: true }));
  return stat ? { ...answer, understood: { ...answer.understood!, label: `${whoOf(team)} · ${stat.title}` }, stat } : null;
}

const FACT_TITLES: Record<FactQuestion["id"], string> = {
  opr: "OPR", "auto-opr": "Auto OPR", "teleop-opr": "TeleOp OPR", "endgame-opr": "Endgame OPR", rating: "Prediction rating", "report-card": "Prediction report card",
  "next-match": "Predicted score, next match", "events-season": "Events in a season", "events-place": "Events in a place", "opr-vs-average": "OPR vs the average",
  reliability: "Reliability", schedule: "Schedule difficulty", "league-rank": "League standing",
};

/** "ftc decode winning alliance", "New Jersey Championship winning alliance": no team, an event's (or the season's
 *  championship's) winners. The event is the hit; its answer is worked out for the page only. */
/** The event a "who won" question names, by the same rule as the asks' "who won" (../searchAsks.ts eventWon): a place's
 *  championship ("nj states") or an event by name, its newest finished season or the one named; else the event search
 *  finds with a played playoff. */
async function namedEvent(it: StatQuestion, season: number | null) {
  const words = [it.core, it.scope.states ? "states" : "", season != null ? seasonLabel(season) : ""].filter(Boolean).join(" ");
  const won = await eventWon(words, new Set());
  if (won) return (await get<any>("SELECT season, code, name, type, start, end, division_code division FROM events WHERE season = ? AND code = ?", [won.season, won.code])) ?? null;
  return it.scope.states ? null : findEvent(it.core, season);
}

/** "winning alliance at 4215's last event": the team's latest event with a match it played (a division, when it played
 *  in one), or null when `words` aren't a team and "last event". */
async function teamsLastEvent(words: string) {
  const m = /^(.+?)\s+(?:last|latest|most\s+recent|newest|previous)\s+(?:event|meet|competition|tournament)$/.exec(words);
  const named = m ? await namedTeam(m[1], new Set()) : null;
  if (!named || !("team" in named)) return null;
  const e = (await teamEventSet(named.team)).events.filter((x) => (x.matches > 0 || x.record != null) && officialClause()(x)).pop();
  return e ? (await get<any>("SELECT season, code, name, type, start, end, division_code division FROM events WHERE season = ? AND code = ?", [e.season, e.code])) ?? null : null;
}

async function winnersSearch(q: string, it: StatQuestion, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  // "who won nj states": a place's state championship; "states" with no place names none.
  if (it.scope.states && !it.core) return null;
  // "decode championship", "the ftc championship": the season's FIRST Championship, never an event by that word.
  const core = /^championships?$/.test(it.core) ? "" : it.core;
  const championship = !it.scope.states && (it.scope.championship || !core);
  // As the asks' "who won" reads them: a bare year is when the event was held ("who won 2025 nj states": 2024–25),
  // "last year" the latest finished championship.
  const asked = it.scope.lastYear ? null : it.scope.latest && it.scope.season == null ? CURRENT_SEASON : it.scope.year && it.scope.season != null ? it.scope.season - 1 : it.scope.season;
  const named = championship ? null : (await teamsLastEvent(core)) ?? await namedEvent(it, asked);
  if (!championship && !named) return null;
  const stat = opts.full ? await winnersAnswer(core, named?.season ?? asked, championship, async () => named, { latest: it.scope.latest, lastYear: it.scope.lastYear }) : null;
  if (opts.full && !stat) return null;
  const season = named?.season ?? asked;
  const label = named ? `${shortEvent(named.name, named.type)} · Winning alliance` : `${season != null ? `${seasonLabel(season)} ` : ""}FIRST Championship · Winning alliances`;
  // The event as event sets show it (its dates, place and status), as the asks' "who won" does.
  const row = named ? await get<any>("SELECT season, code, name, type, venue, city, state, country, start, end, timezone FROM events WHERE season = ? AND code = ?", [named.season, named.code]) : null;
  const hits: SearchHit[] = row ? [{ ...eventHit(row), section: "playoffs" }] : [];
  return {
    q, hits, pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label: stat?.heading ?? stat?.title ?? label, ...(season != null ? { season } : {}) },
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
  // The search box gets a link to the answer page, never an empty answer.
  if (!opts.full) return { ...answer, pages: [{ title: label, href: `/search?q=${encodeURIComponent(q)}` }, ...opts.pages] };
  const stat = await leaderboardAnswer({ ...b, stat: st });
  // The full list's page (Teams for an OPR list, Rankings for a rating list) leads the page links.
  const more = stat.blocks.find((x) => x.kind === "leaderboard")?.more;
  return { ...answer, stat, pages: more ? [{ title: more.label.replace(/^View more detail on (?:the )?/, "").replace(/ \(.*\)$/, "").replace(/^./, (c) => c.toUpperCase()), href: more.href }, ...opts.pages.filter((p) => p.href !== more.href)] : opts.pages };
}
