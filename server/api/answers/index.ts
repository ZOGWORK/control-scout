// Stat answers (docs/search.md, "Stat answers"): a question about a team's records answered from the stored matches,
// events, seasons and awards, by fixed rules (./read.ts reads it, ./clauses.ts scopes it, ./families/* answer it).
// Step 0 of search's chain (server/api/searchAnswer.ts): a query that isn't one of these, or whose team (or event)
// isn't found, goes on through the chain unchanged.
//
// The dropdown and /search get the same hits and the same reading; the answer's blocks (tables, records, charts) are
// worked out only for /search and its first paint (`full`), never per keystroke.
import type { SearchAnswer, SearchHit, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import type { AnswerTeam } from "./families/matches.js";
import { dateRange, seasonLabel } from "../../../src/shared/format.js";
import { edits, findRegions, regionLabel } from "../../../src/shared/regions.js";
import { eventTypeLabel } from "../../../src/shared/labels.js";
import { CURRENT_SEASON, SEASON_NUMBERS } from "../../data/seasons.js";
import { searchSeason, searchSeasonWhy } from "./season.js";
import { teamNameOf } from "../../../src/shared/teamTitle.js";
import { teamPageSql } from "../../../src/shared/teamPages.js";
import { all, get } from "../../db.js";
import { fuzzyScore } from "../fuzzy.js";
import { search } from "../search.js";
import { askSeason, eventWon, readAsk } from "../searchAsks.js";
import { defaultSteps, relaxed } from "../query/relax.js";
import { eventHit, searchToday } from "../searchEvents.js";
import { namedTeam, versusAnswer } from "../searchCompare.js";
import { predictHref } from "../../../src/shared/predictUrl.js";
import { CHAMPIONSHIP_TYPE, STATES_TYPE, inScope, officialClause, scopeChips, scopePhrase, type Scope } from "./clauses.js";
import { reliabilityEvents, teamEventSet, type TeamEvent } from "./eventSet.js";
import { awardsAnswer, awardsTitle } from "./families/awards.js";
import { championshipMatchesAnswer, eventScopeAnswer } from "./families/eventScope.js";
import { eventAnswer } from "./families/events.js";
import { factAnswer, readTeamFact, seasonOf as factSeason, type FactQuestion } from "./families/facts.js";
import { OPR_RATING_TITLES, oprRatingAnswer, readOprRating, type OprRatingQuestion } from "./families/oprRating.js";
import { counts, matchAnswer, whoOf } from "./families/matches.js";
import { changeAnswer, readChange, type ChangeQuestion } from "./families/seasonChange.js";
import { MATCH_STAT_IDS, matchStatAnswer } from "./families/matchStats.js";
import { BOARD_STATS, LEADERBOARD_MAX, boardStatFor, leaderboardAnswer, statWords, windowBoardAnswer } from "./families/leaderboard.js";
import { readTime } from "../query/time.js";
import { biggestEventsAnswer, readBiggestEvents } from "./families/biggestEvents.js";
import { everTopMatches, readTopMatches, topMatchesAnswer, type TopMatchesQuestion } from "./families/topMatches.js";
import { penaltyTotalAnswer, trendAnswer } from "./families/trends.js";
import { nextEventPrediction, pairPrediction, predictTitle, predictionSeason } from "./families/predict.js";
import { awardsSideBySide, compareAnswer, compareSeason, headToHead, neverPlayedAnswer, opponentsAnswer, partnerListAnswer, penaltiesSideBySide, phaseSideBySide, reliabilitySideBySide, seasonSideBySide } from "./families/twoTeam.js";
import { sharedMatchList } from "../searchBoolean.js";
import { compareBlock, decidedText, leadHeadline, seasonScale, winShare } from "./compareBlock.js";
import { winnersAnswer, worldsFollowUps } from "./families/winners.js";
import { eventHref, shortEvent, teamMatches } from "./matchSet.js";
import { readCompound } from "./compound.js";
import { eventInitialisms, initialismEvent } from "../query/initialisms.js";
import { names } from "../query/names.js";
import { countryOf } from "../../../src/shared/countries.js";
import { regionOf } from "../../../src/shared/searchEventQuery.js";
import { compoundSearch } from "./compoundSearch.js";
import { THEIR_FIRST, THEIR_LAST, readLeaderboard, readStatQuestion, readTeamSet, readTwoTeam, type LeaderboardQuestion, type TeamSetQuestion, type IntentId, type StatQuestion, type TwoTeamId, type TwoTeamQuestion } from "./read.js";

/** Search's own answer for the part of a query that names the team (searchAnswer with intents off). */
export type Resolve = (core: string) => Promise<SearchAnswer>;

const TITLES: Record<IntentId, string> = {
  "highest-score": "Highest score", "lowest-score": "Lowest score", "biggest-win": "Biggest win", "biggest-loss": "Biggest loss", "closest-match": "Closest match",
  "first-match": "First match", "recent-match": "Most recent match", "best-finish": "Best event finish", "worst-finish": "Worst event finish", "first-place-events": "Events ranked 1st", "worlds-divisions": "Worlds divisions", "first-event": "First event",
  "last-event": "Most recent event", "best-opr-event": "Best OPR event", "best-season": "Best season", "most-improved-season": "Most improved season", "first-season": "First season",
  "wins-count": "Match wins", record: "Record", "average-score": "Average score", "average-margin": "Average margin", "total-points": "Total points", "total-matches": "Matches played", "total-events": "Events played", "seasons-played": "Seasons played",
  "seasons-count": "How many seasons", "current-streak": "Current streak", "longest-streak": "Longest win streak", "last-matches": "Last matches", "average-rank": "Average event rank",
  "playoff-appearances": "Playoff appearances", "blowout-wins": "Blowout wins", losses: "Losses", "playoff-matches": "Playoff matches", "qual-matches": "Qualification matches", "season-matches": "Matches",
  "red-blue-record": "Record by alliance colour", results: "Results", "event-rank": "Rank", "event-opr": "OPR", "match-lookup": "Match",
  "event-wins": "Event wins", "inspire-awards": "Inspire Awards", "finalist-finishes": "Finalist finishes", "total-awards": "All awards", "award-split": "Judged and performance awards",
  awards: "Awards", "winning-alliance": "Winning alliance",
  "opr-history": "OPR by event", "auto-history": "Auto OPR by event", "teleop-history": "TeleOp OPR by event", "endgame-history": "Endgame OPR by event", "reliability-history": "Reliability by event", "opr-by-season": "OPR by season", "record-by-season": "Record by season", "win-rate": "Win rate by event", "avg-penalties": "Penalty points given by event",
  "avg-score-by-event": "Average alliance score by event", "ranking-points": "Ranking points by event", "total-penalties": "Penalty points given",
  "most-played-opponent": "Most played opponent", "toughest-opponent": "Toughest opponent", "best-partner": "Best alliance partner", "frequent-partner": "Most frequent partner", "never-played": "Teams never played",
  "worst-partner": "Worst alliance partner", partners: "Alliance partners", opponents: "Opponents", "beat-most": "Teams beaten most often", "lost-to-most": "Teams lost to most often",
  "partner-top-opr": "Partner with the highest combined OPR", "opponent-top-opr": "Highest-OPR opponent", "partner-win-rate": "Win rate with alliance partners", "opponent-win-rate": "Opponents' win rate against them",
  "pick-partner": "Who to pick as an alliance partner",
  "next-event-wins": "Predicted wins, next event", "event-win-chance": "Chance to win their next event", "advance-chance": "Advancement chance", "playoff-chance": "Playoff chance, next event",
  "ties-count": "Ties", "win-percent": "Win rate", "score-range": "Score range", "median-score": "Median score", "score-consistency": "Score consistency", "scores-over": "Scores over",
  "highest-auto": "Highest Auto score", "highest-teleop": "Highest TeleOp score", "highest-endgame": "Highest Endgame score", "most-penalties": "Match with the most penalty points given away",
  penalties: "Penalty points given away", "easiest-opponent": "Easiest opponent", "vs-top": "Against top-rated teams", "vs-rookies": "Against rookie teams", "early-late": "Early season against late season",
};
const TWO_TEAM_TITLES: Record<TwoTeamId, string> = {
  "head-to-head": "Head to head", "opr-vs": "OPR side by side", "rating-vs": "Prediction ratings side by side", "win-chance": "Win chance", "better-record": "Better record",
  predict: "Prediction", "h2h-wins": "Wins against", "shared-matches": "Shared matches", compare: "Compare", "phase-vs": "Phase side by side", "reliability-vs": "Reliability side by side", "awards-vs": "Awards side by side", "penalties-vs": "Penalties side by side",
};
/** Read from the matches the two teams met in ("this season" is the first team's latest season with matches). */
const MEETING_IDS = new Set<TwoTeamId>(["head-to-head", "h2h-wins", "shared-matches"]);

/** The intents about the team's opponents and partners (family 6, one team named). */
/** One number over the team's events or seasons (family 2), and a season's penalty total. */
const TREND_INTENTS = new Set<IntentId>(["opr-history", "auto-history", "teleop-history", "endgame-history", "reliability-history", "opr-by-season", "record-by-season", "win-rate", "avg-penalties", "avg-score-by-event", "ranking-points", "total-penalties"]);
const OPPONENT_INTENTS = new Set<IntentId>(["most-played-opponent", "toughest-opponent", "best-partner", "frequent-partner"]);
const PARTNER_LIST_INTENTS = new Set<IntentId>(["worst-partner", "partners", "opponents", "beat-most", "lost-to-most", "partner-top-opr", "opponent-top-opr", "partner-win-rate", "opponent-win-rate", "pick-partner"]);
/** The engine's stored projection for the team's next event (families/predict.ts): no season scope applies. */
const PREDICT_INTENTS = new Set<IntentId>(["next-event-wins", "event-win-chance", "advance-chance", "playoff-chance"]);

/** A team at one event: its results, rank and OPR there, or one match. */
const EVENT_SCOPE_INTENTS = new Set<IntentId>(["results", "event-rank", "event-opr", "match-lookup"]);

/** The intents read from event and season rows; the rest from matches (or awards). */
const EVENT_INTENTS = new Set<IntentId>(["best-finish", "worst-finish", "first-place-events", "worlds-divisions", "first-event", "last-event", "best-opr-event", "best-season", "most-improved-season", "first-season", "total-events", "average-rank", "seasons-played", "seasons-count"]);
const AWARD_INTENTS = new Set<IntentId>(["event-wins", "inspire-awards", "finalist-finishes", "total-awards", "award-split", "awards"]);

/** The events of a team that the words typed name ("New Jersey Championship"), read as one: `primary` is the one whose
 *  rank and OPR the answer shows, `events` every one it covers (oldest first), `name` what the answer calls them. */
export interface TeamEventPick { primary: TeamEvent; events: TeamEvent[]; name: string }

/** The team's events the words name: the best name match of every season it attended, the newest season on a tie (or
 *  the season named). The events of that season matching about as well are the same question asked of each ("Northern
 *  League Meet", an AM and a PM meet): all of them. A championship named takes in the division the team played there
 *  ("NJ championship": its own division and the finals it reached, never another team's division). */
export function pickTeamEvent(evs: TeamEvent[], words: string, season: number | null | ((e: TeamEvent) => boolean)): TeamEventPick | null {
  const keep = typeof season === "function" ? season : (e: TeamEvent) => season == null || e.season === season;
  const scored = evs.filter(keep)
    .map((e) => ({ e, s: eventFit(words, e.name, e.code) }))
    .filter((x) => x.s >= 0.75)
    .sort((a, b) => b.s - a.s || b.e.season - a.e.season || String(b.e.start).localeCompare(String(a.e.start)));
  const [best] = scored;
  if (!best) return null;
  const tied = scored.filter((x) => x.e.season === best.e.season && best.s - x.s < 0.05).map((x) => x.e);
  // The championship named takes in the division the team played; a division named is that division alone.
  const named = new Set(tied.map((e) => e.code));
  const events = evs.filter((e) => e.season === best.e.season && (named.has(e.code) || (e.division != null && named.has(e.division))));
  return pickOf(events, best.e);
}

/** `events` read as one: the division's row leads (its rank and OPR are the team's own; the finals rank only the
 *  alliances that reached them), else `lead`. */
function pickOf(events: TeamEvent[], lead: TeamEvent, name?: string): TeamEventPick {
  const families = new Set(events.map((e) => e.division ?? e.code)).size;
  const primary = events.length > 1 && families === 1 ? (events.find((e) => e.division != null) ?? lead) : lead;
  return { primary, events, name: name ?? pickName(events, families) };
}

/** A championship's whole family the team played in `e`'s season: its division and the finals. */
const familyOf = (evs: TeamEvent[], e: TeamEvent) => evs.filter((x) => x.season === e.season && (x.division ?? x.code) === (e.division ?? e.code));

/** Played there: a match the team page counts (a league meet's row can list a team that never took the field). */
const played = (e: TeamEvent) => e.matches > 0 || (e.record != null && e.record.wins + e.record.losses + e.record.ties > 0);

/** How well the words typed name an event (0–1), by its name or code. Every word has to match (fuzzyScore's rule), so a
 *  shared word ("conference", "league") never stands in for the distinctive ones ("east bergen"). A US or Canadian
 *  state code typed is also read spelled out ("nj championship" is "New Jersey Championship"). */
export function eventFit(words: string, name: string, code = ""): number {
  // Its initialism ("mti" for the Multinational Tech Invitational, ../query/initialisms.ts): a fit, below its name's.
  if (eventInitialisms(name).includes(words.trim().toLowerCase())) return INITIALISM_FIT;
  const spelled = words.split(/\s+/).map((w) => (w.length === 2 ? findRegions(w).find((r) => (r.country === "USA" || r.country === "Canada") && r.state.toLowerCase() === w)?.name ?? w : w)).join(" ");
  return Math.max(fuzzyScore(words, name), fuzzyScore(spelled, name), code ? fuzzyScore(words, code) : 0);
}

/** How well an event's initialism fits it: enough to name it, below its name typed in full. */
export const INITIALISM_FIT = 0.9;

/** "league meets", "qualifiers": a kind of event, not one by name, as the team's events of that type. */
const EVENT_KINDS: [RegExp, string, string][] = [
  [/^(?:(?:its|their|the)\s+)?league\s+meets?$/, "LeagueMeet", "league meets"],
  [/^(?:(?:its|their|the)\s+)?qualifiers$/, "Qualifier", "qualifiers"],
  [/^(?:(?:its|their|the)\s+)?league\s+tournaments$/, "LeagueTournament", "league tournaments"],
  [/^(?:(?:its|their|the)\s+)?scrimmages?$/, "Scrimmage", "scrimmages"],
];

/** The team's events an event scope covers, when the words or the scope name them: the event named (or of the kind
 *  named), its own last or first event, its state championship or its Worlds that season. `held`: a year written with
 *  an event is when it was held ("Romania championship in 2026" is the 2025–26 one). Null: nothing of the team's fits. */
function teamPick(evs: TeamEvent[], s: StatQuestion["scope"], season: number | null): TeamEventPick | null {
  const held = s.year && s.season != null ? s.season : null;
  const inSeason = (e: TeamEvent) => (held != null ? String(e.start ?? "").startsWith(String(held)) : season == null || e.season === season);
  const official = officialClause();
  const at = s.at ?? "";
  // The newest season's of `pool`, read as one.
  const newest = (pool: TeamEvent[], name?: (season: number) => string) => {
    if (!pool.length) return null;
    const last = Math.max(...pool.map((e) => e.season));
    const events = pool.filter((e) => e.season === last);
    return pickOf(events, events[events.length - 1], name?.(last));
  };
  if (at === THEIR_LAST || at === THEIR_FIRST) {
    const pool = evs.filter((e) => inSeason(e) && official(e) && played(e));
    const e = at === THEIR_LAST ? pool[pool.length - 1] : pool[0];
    return e ? pickOf(familyOf(pool, e), e) : null;
  }
  const kind = EVENT_KINDS.find(([re]) => re.test(at));
  if (kind) return newest(evs.filter((e) => inSeason(e) && e.type === kind[1] && played(e)), (x) => `its ${seasonLabel(x)} ${kind[2]}`);
  if (at) return pickTeamEvent(evs, at, inSeason);
  if (s.states) return newest(evs.filter((e) => inSeason(e) && e.type === STATES_TYPE && played(e) && (!s.place || (e.country === s.place.country && e.state === s.place.state))));
  // Worlds: the season or year named, else the current search season's.
  if (s.championship) return newest(evs.filter((e) => (season != null || held != null ? inSeason(e) : e.season === searchSeason()) && e.type === CHAMPIONSHIP_TYPE && played(e)));
  return null;
}

/** "New Jersey Championship (Northern Division and finals)", "P1-4 AM Northern League Meet and P1-4 PM Northern League
 *  Meet", "3 events: A, B and C". */
function pickName(events: TeamEvent[], families: number): string {
  if (events.length === 1) return events[0].name;
  if (families === 1) {
    const finals = events.find((e) => e.division == null), divs = events.filter((e) => e.division != null);
    if (finals) {
      const part = (d: TeamEvent) => (d.name.startsWith(finals.name) ? d.name.slice(finals.name.length).replace(/^[\s:–-]+/, "") : d.name);
      return `${finals.name} (${divs.map(part).join(", ")} and finals)`;
    }
  }
  const names = events.map((e) => e.name);
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return names.length === 2 ? list : `${names.length} events: ${list}`;
}

/** The season a team's answer reads when none is named: the default season (the latest completed one, ./season.ts)
 *  when the team has matches at official events in it, else the team's latest season with such matches (a season of
 *  only scrimmages isn't one). `own`: the team's latest was used. */
export async function latestSeason(team: number, id?: IntentId): Promise<{ season: number; own: boolean } | null> {
  // A season of only scrimmages isn't one, nor one where the team is only on a roster (league rosters list teams that
  // never took the field): a season with a match the answer counts.
  const official = officialClause();
  const ms = (await teamMatches(team)).filter((m) => official(m) && (!id || counts(id, m)));
  if (!ms.length) return null;
  const def = searchSeason();
  return ms.some((m) => m.season === def) ? { season: def, own: false } : { season: Math.max(...ms.map((m) => m.season)), own: true };
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
  const scope: Scope = { season: s.season, championship: s.championship, states: s.states, level: s.level ?? undefined, ...(s.finals ? { finals: true } : {}), alliance: s.alliance ?? undefined };
  if (s.place) scope.place = { country: s.place.country, state: s.place.state, name: s.place.name };
  if (s.area) scope.place = { country: s.area.country, state: s.area.state ?? "", name: s.area.name };
  if (s.window) scope.window = s.window;
  if (s.outOfState) {
    // "Out-of-state events": outside the team's own state, as its team page lists it.
    const home = await get<{ state: string | null; country: string | null }>("SELECT state, country FROM teams WHERE number = ?", [team]);
    if (!home?.state) return null;
    const region = findRegions(home.state).find((r) => r.country === (home.country ?? r.country) && r.state === home.state);
    scope.place = { country: home.country ?? "", state: home.state, name: region?.name ?? home.state, outside: true };
  }
  // "12345 awards at New Jersey events" when the place wasn't read already: the events' own region, not one event.
  const region = !scope.place && s.at ? placeOf(s.at) : null;
  // "At states" and "at worlds" with no season named are one event for a team's results, rank or OPR there: its state
  // championship (the latest it played, or the year's) and its Worlds of the latest completed season.
  const oneEvent = EVENT_SCOPE_INTENTS.has(it.id) && ((s.states && it.id !== "match-lookup" && !s.ever) || (s.championship && it.id === "results" && s.season == null && !s.ever && !s.latest && !s.at));
  if (region) scope.place = { country: region.country, state: region.state, name: region.name };
  else if (s.at || oneEvent) {
    // An event the team attended, in the season asked for ("this season": the team's latest with matches).
    // A forecast's "this season" is the current one (its upcoming event), not the team's last played.
    const season = s.year ? null : s.season ?? (s.latest ? (PREDICT_INTENTS.has(it.id) ? CURRENT_SEASON : (await latestSeason(team, it.id))?.season ?? null) : null);
    if (s.latest && season == null) return null;
    const p = teamPick((await teamEventSet(team)).events, s, season);
    if (p) {
      const codes = p.events.map((e) => e.code);
      return { ...scope, season: null, states: false, event: { season: p.primary.season, code: p.primary.code, name: p.name, ...(codes.length > 1 ? { codes } : {}) } };
    }
    // An event read beside the team names one of its own, or none.
    if (s.own) return null;
    // Worlds with none of the latest season: every season the team went, as before.
    if (!s.at && !s.states) return scope;
    // No state championship of the team's: said so, with the events it did play.
    if (!s.at) {
      const name = s.season != null ? (s.place ? `the ${s.place.name} state championship` : "a state championship") : `${s.place ? `${s.place.name} ` : ""}state championships`;
      return { ...scope, place: undefined, states: false, event: { season: s.season != null ? (s.year ? s.season - 1 : s.season) : searchSeason(), code: "", name, absent: s.season != null ? true : "never" } };
    }
    if (s.at === THEIR_LAST || s.at === THEIR_FIRST || EVENT_KINDS.some(([re]) => re.test(s.at!))) return null;
    // None of the team's events: the event those words name, which the answer says the team didn't play.
    const named = await findEvent(s.at, s.year ? s.season! - 1 : season, { anyPlayed: true, closest: true });
    if (!named) return null;
    // The team's event list leaves some events out (remote ones): only a team with no row there at all is absent.
    const there = await get("SELECT 1 FROM events e WHERE e.season = ? AND (e.code = ? OR e.division_code = ?) AND (EXISTS (SELECT 1 FROM event_teams t WHERE t.season = e.season AND t.code = e.code AND t.team = ?) OR EXISTS (SELECT 1 FROM match_teams t WHERE t.season = e.season AND t.code = e.code AND t.team = ?) OR EXISTS (SELECT 1 FROM awards t WHERE t.season = e.season AND t.code = e.code AND t.team = ?)) LIMIT 1",
      [named.season, named.code, named.code, team, team, team]);
    if (there) return null;
    return { ...scope, season: null, event: { season: Number(named.season), code: named.code, name: shortEvent(named.name, named.type ?? null), absent: true } };
  }
  // A forecast's "this season" is the current one, where its upcoming event is: the heading and links agree with it.
  if (s.season == null && s.latest && PREDICT_INTENTS.has(it.id)) return { ...scope, season: CURRENT_SEASON };
  if (s.season == null && !s.ever && (s.latest || it.defaultSeason === "latest") && PARTNER_LIST_INTENTS.has(it.id)) {
    // The partner and opponent answers read the latest completed season when the team played it ("this season" too).
    const def = searchSeason();
    const official = officialClause();
    if ((await teamMatches(team)).some((m) => m.season === def && official(m))) {
      scope.season = def;
      scope.seasonWhy = s.latest ? `"This season" here is ${seasonLabel(def)}, the latest completed season.` : searchSeasonWhy(def);
      return scope;
    }
  }
  // Worlds with no season named is every season the team went (a team goes to few), unless "this season" says one.
  if (s.season == null && !s.ever && (s.latest || (it.defaultSeason === "latest" && !s.championship))) {
    const latest = await latestSeason(team, it.id);
    // A plain "12345 record" with no match on record is left to search's team answer (its stored season record).
    if (latest == null && it.id === "record" && !s.latest) return null;
    scope.season = latest?.season ?? null;
    if (latest) {
      const S = seasonLabel(latest.season), said = s.latest ? `"This season" here is ${S}` : `The season is ${S}`;
      scope.seasonWhy = latest.own
        ? `${said}: no ${seasonLabel(searchSeason())} matches on record, so the team's latest season with matches.`
        : `${said}, the latest completed season (its FIRST Championship has finished).`;
    }
  }
  return scope;
}

/** An event by name for a team-less question (its newest season, or the season named). */
async function findEvent(words: string, season: number | null, opts: { anyPlayed?: boolean; closest?: boolean } = {}) {
  const hits = (await search(words, 8, new Set(), new Set(["event"]), season)).filter((h) => h.kind === "event");
  // Every word typed has to name the event (eventFit): a shared word ("conference") never stands in for the
  // distinctive ones ("east bergen"). `closest`: only those, the closest first; else they lead, search's order after.
  const fit = (h: (typeof hits)[number]) => eventFit(words, h.title);
  const named = hits.filter((h) => fit(h) >= 0.75).sort((a, b) => fit(b) - fit(a));
  const found = opts.closest ? named : [...named, ...hits.filter((h) => !named.includes(h))];
  const row = (s: number, code: string) => get<any>("SELECT season, code, name, type, start, end, division_code division FROM events WHERE season = ? AND code = ?", [s, code]);
  // A season named: the first event found that was held that season (search lists an event once, by its newest season,
  // so an older one is looked up by its code).
  if (season != null) {
    for (const h of found) { const e = await row(season, h.ref.split(":")[1]); if (e && (!named.length || eventFit(words, e.name) >= 0.75)) return e; }
    return null;
  }
  const top = found[0];
  if (!top) return null;
  // No season named: the newest season with a played playoff (an event not held yet has no winners), or with any played
  // match when the answer is its matches (its divisions' too), of an event the words name. A code is reused for other
  // events over the years (USNJNELT2 was a South Essex tournament in 2024–25): a season counts only while its event
  // still has a name the words match.
  const playedIn = (code: string) => (opts.anyPlayed
    ? all<{ s: number; name: string }>("SELECT DISTINCT e.season s, p.name FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code JOIN events p ON p.season = e.season AND p.code = ? WHERE (e.code = ? OR e.division_code = ?) AND m.played = 1", [code, code, code])
    : all<{ s: number; name: string }>("SELECT DISTINCT m.season s, e.name FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.code = ? AND m.level = 'playoff' AND m.played = 1", [code]));
  const best = named.length ? fit(named[0]) : 0;
  let pick: { s: number; code: string } | null = null;
  for (const h of named.length ? named.filter((x) => best - fit(x) < 0.05) : [top]) {
    const code = h.ref.split(":")[1];
    for (const r of await playedIn(code)) {
      if (named.length && eventFit(words, r.name) < 0.75) continue;
      if (!pick || Number(r.s) > pick.s) pick = { s: Number(r.s), code };
    }
  }
  if (pick) return (await row(pick.s, pick.code)) ?? null;
  const [s, code] = top.ref.split(":");
  return (await row(Number(s), code)) ?? null;
}

/** "Top teams", "best 5 teams", "strongest teams": the words that ask for the best teams, with a time said or not. */
const TOP_TEAMS_SAID = /\b(?:top|best|strongest)\s+(?:\d{1,2}\s+)?teams?\b/i;

/** The answer for `q`, or null when it isn't a stat question or its team isn't found. */
export async function statAnswer(q: string, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  // A compound question (filters joined, or two answers at once) before any single reader takes part of it.
  const comp = readCompound(q);
  if (comp) {
    const a = await compoundSearch(q, comp, resolve, opts, { latestSeason, pickTeamEvent });
    if (a) return a;
  }
  // A season's highest-scoring matches before a leaderboard ("highest scoring matches at <event>" names no city).
  const tm = readTopMatches(q);
  if (tm) return topSearch(q, tm, opts);
  // "Which event had the most teams in California this season", "biggest qualifiers in Texas": events by team count.
  const big = readBiggestEvents(q);
  if (big) {
    const stat = opts.full ? await biggestEventsAnswer(big, searchSeason()) : null;
    const label = stat?.title ?? `Events with the most teams${big.e.region ? ` in ${big.e.region.name}` : ""}`;
    return { q, hits: [], pages: opts.pages, step: "deterministic", weak: false, understood: { kind: "question", label, ...(big.e.region ? { place: { key: big.e.region.key, name: big.e.region.name } } : {}) },
      intent: { kind: "stat-biggest-events", pattern: `events with the most teams${big.e.region ? " [place]" : ""}`, met: true, understood: [label] }, ...(stat ? { stat } : {}) };
  }
  // "Top teams this week", "best teams in NJ last weekend": the teams that played then, by their OPR at those events.
  const win = TOP_TEAMS_SAID.test(q) ? readTime(q.toLowerCase(), searchToday()) : null;
  if (win?.time?.kind === "window" && win.time.from && win.time.to) {
    const rest = win.rest.replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
    const ask = boardOfAsk(rest);
    if (ask && ask.stat === BOARD_STATS.rating.id) {
      const stat = opts.full ? await windowBoardAnswer({ from: win.time.from, to: win.time.to, label: win.time.label }, ask.region, ask.n) : null;
      return { q, hits: [], pages: opts.pages, step: "deterministic", weak: false, understood: { kind: "question", label: stat?.title ?? `Top teams ${win.time.label}` },
        intent: { kind: "stat-window-best", pattern: `top teams [window]${ask.region ? " [place]" : ""}`, met: true, understood: [`Top teams ${win.time.label}`] }, ...(stat ? { stat } : {}) };
    }
  }
  // The asks' leaderboards are drawn here on the page; the dropdown keeps the asks' own short card.
  const board = readLeaderboard(q);
  if (board) return boardSearch(q, board, opts);
  // An asked board reads the season as the pipeline does: the current one, then the one before when nobody is ranked
  // there yet, said on the card.
  const asked = opts.full ? boardOfAsk(q) : null;
  if (asked) {
    const season = askSeason();
    const a = await boardSearch(q, { ...asked, season }, opts);
    return relaxed(a, defaultSteps(season, asked.region ? ` in ${asked.region.name}` : "", "ranked teams"), (s) => boardSearch(q, { ...asked, season: s }, opts));
  }
  // "How much did 12345's OPR improve from last season to this season", "12345 rating change this season".
  const change = readChange(q);
  if (change) return changeSearch(q, change, resolve, opts);
  // One team's OPR or rating asked a particular way (its rank in a place, its best event, Auto against TeleOp)
  // before the two-team reader takes "auto opr versus teleop opr" for two teams.
  const or = readOprRating(q);
  if (or) {
    const a = await oprRatingSearch(q, or, resolve, opts);
    if (a) return a;
  }
  const set = readTeamSet(q);
  if (set) return teamSetSearch(q, set, resolve, opts);
  const two = readTwoTeam(q);
  if (two) return twoTeamSearch(q, two, resolve, opts);
  let it = readStatQuestion(q);
  // The event named beside the team, with no "at" ("what rank did 4215 get in the east bergen conference"). With none,
  // an event's own numbers aren't asked ("4215 auto opr" is the team's), and a forecast is for the next event.
  if (it?.eventInCore) {
    const beside = await eventBeside(it, resolve);
    it = beside ?? (PREDICT_INTENTS.has(it.id) ? it : null);
  }
  if (!it) {
    const f = readTeamFact(q);
    return f ? factSearch(q, f, resolve, opts) : null;
  }
  if (it.noTeam) return winnersSearch(q, it, opts);
  return statAnswerOf(q, it, resolve, opts);
}

/** `core` with the words typed just before it that a question's frame drops ("team", "the", "ftc") put back, when
 *  with them it's a team's name or one slip from just one ("team sealth" is Team Stealth, not a team named "Stealth…"). */
async function withLead(q: string, core: string): Promise<{ core: string; near?: string }> {
  const esc = core.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = esc && new RegExp(`(?:^|\\s)((?:(?:the|team|ftc)\\s+)+)${esc}(?=\\s|$)`).exec(q.toLowerCase());
  // A team's number ("team 14471") or a name of its own stands as it is.
  if (!m || /^\d+$/.test(core.trim())) return { core };
  const idx = await names();
  const own = idx.teamsNamed(core).length > 0;
  for (let lead = m[1].trim().split(/\s+/); lead.length; lead = lead.slice(1)) {
    const named = `${lead.join(" ")} ${core.trim()}`;
    if (idx.teamsNamed(named).length) return { core: named };
    // One slip from a name: read as that name, and said so ("Did you mean team stealth record").
    const near = own ? null : idx.nearTeam(named);
    if (near?.name) return { core: near.name.toLowerCase(), near: named };
  }
  return { core };
}

/** Whether `core` is a place's name alone: a country, or a state or province. */
const placeNamed = (core: string) => !/\d/.test(core) && (!!countryOf(core) || !!regionOf(core.trim().split(/\s+/)));

/** The answer to a stat question already read (by ./read.ts, or by the search pipeline from its slots), or null when
 *  its team isn't found. */
export async function statAnswerOf(q: string, it0: StatQuestion, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const lead = await withLead(q, it0.core);
  const it = { ...it0, core: lead.core };
  // A place's name beside states or a championship is the place's championship ("romania states results"), never a team
  // with the place in its name: a team there only by its number or its whole name.
  if ((it.scope.states || it.scope.championship || /\bchampionships?\b/i.test(q)) && placeNamed(it.core) && !(await names()).teamsNamed(it.core).length) return null;
  const base = await resolve(it.core);
  const top = base.step !== "recovery" ? base.hits[0] : undefined;
  if (!top || top.kind !== "team" || top.href) return null;
  const team = { number: Number(top.ref), name: teamNameOf(top.title) || null };
  const scope = await scopeFor(it, team.number);
  if (!scope) return null;
  // "average winning margin" is titled as asked, not as the plain average margin.
  // A win or a loss said with a match question is in its title too ("Most recent loss", "Longest losing streak").
  const won = it.outcome === "W" ? "win" : "loss";
  const outcomeTitle = !it.outcome ? null : ({ "first-match": `First ${won}`, "recent-match": `Most recent ${won}`, "last-matches": `Last ${it.outcome === "W" ? "wins" : "losses"}`,
    "longest-streak": it.outcome === "L" ? "Longest losing streak" : null } as Partial<Record<IntentId, string | null>>)[it.id] ?? null;
  const name = outcomeTitle ? outcomeTitle : it.id === "average-margin" && it.outcome ? `Average ${it.outcome === "W" ? "winning" : "losing"} margin` : it.id === "scores-over" ? `Scores ${it.variant === "at-least" ? "of at least" : "over"} ${it.n}`
    : it.id === "vs-top" && it.n != null ? `Against top-${it.n} teams`
    : it.id === "penalties" && it.variant ? (it.variant === "rate" ? "Penalty rate" : "Penalty points given away per event")
    : AWARD_INTENTS.has(it.id) ? awardsTitle(it.id, it) ?? TITLES[it.id] : it.byRecord ? (it.id === "best-finish" ? "Best event" : "Worst event") : it.schedule ? "Event schedule" : PREDICT_INTENTS.has(it.id) && scope.event ? predictTitle(it.id) : TITLES[it.id];
  const title = `${it.leadEvent ? "Event with the highest score" : name}${scopePhrase(it.id === "worlds-divisions" ? { ...scope, championship: false } : scope)}`;
  // "This season" with none of the season in progress played yet reads the team's latest: the heading names that
  // season (its title ends "in 2025–26"), and the answer's note says why (scope.seasonWhy), so the heading stays clean.
  const label = `${whoOf(team)} · ${title}`;
  const section = AWARD_INTENTS.has(it.id) ? "awards" : EVENT_INTENTS.has(it.id) || TREND_INTENTS.has(it.id) ? "history" : "matches";
  const linkSeason = scope.season ?? scope.event?.season;
  const hit: SearchHit = { ...top, section, ...(linkSeason != null ? { linkSeason } : {}), facts: undefined, events: undefined };
  // A team found by a correction ("hypnotc") keeps search's warning, said for the whole question.
  const said = q.toLowerCase();
  // A name put back with its lead word and corrected (withLead): the correction is said for the whole question.
  const fixed = lead.near && said.includes(lead.near) ? said.replace(lead.near, it.core) : undefined;
  const guessed = base.step === "did-you-mean" || !!fixed;
  const answer: SearchAnswer = {
    q, hits: [hit, ...base.hits.slice(1).filter((h) => !(h.kind === "team" && h.ref === top.ref))], pages: opts.pages, step: guessed ? "did-you-mean" : "deterministic", weak: guessed && base.weak,
    ...(fixed ? { didYouMean: fixed } : guessed && base.didYouMean ? { didYouMean: said.includes(it.core) ? said.replace(it.core, base.didYouMean) : base.didYouMean } : {}),
    understood: { kind: "question", label, ...(linkSeason != null ? { season: linkSeason } : {}) },
    intent: { kind: `stat-${it.id}`, pattern: `[team] ${it.id}${scope.event ? " [event]" : ""}${it.scope.championship ? " [worlds]" : ""}${scope.season != null ? " [season]" : ""}`, met: true, understood: [`Team ${whoOf(team)}`, title] },
  };
  if (!opts.full) return answer;
  const stat = scope.event?.absent ? await absentAnswer(q, it, team, scope, title) : await build(it, team, scope);
  if (!stat) return null;
  if (scope.seasonWhy) stat.definition = `${stat.definition} ${scope.seasonWhy}`;
  // A state championship read as one season's: the team's other seasons there, each its own question (by the year held).
  if (it.scope.states && scope.event && !scope.event.absent) {
    const other = [...new Set((await teamEventSet(team.number)).events.filter((e) => e.type === STATES_TYPE && played(e) && e.season !== scope.event!.season).map((e) => e.season))].sort((x, y) => y - x);
    const word = it.id === "event-opr" ? "opr" : it.id === "event-rank" ? "rank" : "matches";
    if (other.length) stat.blocks.push({ kind: "related", title: "Its other state championships", queries: other.map((s) => `${team.number} ${word} at states in ${s + 1}`) });
    stat.definition = `${stat.definition} States: the team's own state championship, its division and the finals it reached; with no year named, the latest it played.`;
  }
  // A Worlds answer ends with the season's championship events and the related Worlds questions (never instead of it).
  if (scope.championship) {
    const season = scope.season ?? worldsSeason(stat);
    const follow = await worldsFollowUps(season, team);
    stat.blocks.push(...follow.map((b) => (b.kind === "related" ? { ...b, queries: b.queries.filter((x) => x.toLowerCase() !== q.toLowerCase()) } : b)));
  }
  return { ...answer, stat };
}

/** "4215 east bergen conference", "hypnotic robotics conference": the team and, beside it, one of its own events named
 *  with no "at" (StatQuestion.eventInCore). The team is a number typed, else the most leading or trailing words search
 *  reads as one team; the words left have to name one of that team's events (pickTeamEvent), in the season asked for.
 *  Null when no split does. */
async function eventBeside(it: StatQuestion, resolve: Resolve): Promise<StatQuestion | null> {
  const ws = it.core.split(" ");
  if (ws.length < 2 || ws.length > 8) return null;
  const tries: [string, string][] = [];
  const n = ws.findIndex((w) => /^\d{1,5}$/.test(w));
  if (n >= 0) tries.push([ws[n], [...ws.slice(0, n), ...ws.slice(n + 1)].join(" ")]);
  else for (let k = ws.length - 1; k >= 1; k--) tries.push([ws.slice(0, k).join(" "), ws.slice(k).join(" ")], [ws.slice(-k).join(" "), ws.slice(0, -k).join(" ")]);
  // A phase, a stat's own word, a place alone or "league" alone (its standing) is the team's own question ("4215 auto
  // opr", "4215 opr nj", "4215 league rank"), never an event's name.
  const notEvent = (words: string) => /\b(?:auto(?:nomous)?|tele ?op|end ?game|driver|penalt(?:y|ies)|average|avg|total|overall|world(?:wide)?|global(?:ly)?|now|today|currently)\b|^league$/.test(words)
    || findRegions(words).some((r) => r.name.toLowerCase() === words || r.state.toLowerCase() === words);
  const s = it.scope;
  // As teamPick reads the season: a year written is when the event was held; "this season" is checked by scopeFor.
  const inSeason = (e: TeamEvent) => (s.year && s.season != null ? String(e.start ?? "").startsWith(String(s.season)) : s.season == null || e.season === s.season);
  for (const [team, event] of tries) {
    if (notEvent(event)) continue;
    const base = await resolve(team);
    const top = base.step !== "recovery" ? base.hits[0] : undefined;
    if (!top || top.kind !== "team" || top.href) continue;
    if (!pickTeamEvent((await teamEventSet(Number(top.ref))).events, event, inSeason)) continue;
    return { ...it, core: team, scope: { ...s, at: event, own: true } };
  }
  return null;
}

/** A team asked about an event it didn't play ("7149 record at NJ championship"): said so, naming the event checked,
 *  with the reason the records give (a team from another state or country; else the events it did play, by kind, or
 *  none that season) and links to its real events: those of that season, else of its latest season with any. The
 *  same question is asked of each of them below. */
async function absentAnswer(q: string, it: StatQuestion, team: AnswerTeam, scope: Scope, title: string): Promise<StatAnswer> {
  const ev = scope.event!, who = whoOf(team), S = seasonLabel(ev.season);
  const official = officialClause();
  const all_ = (await teamEventSet(team.number)).events.filter((e) => official(e));
  const theirs = all_.filter((e) => e.season === ev.season);
  // None that season: its latest season with events stands in, said so.
  const shownSeason = theirs.length ? ev.season : Math.max(-1, ...all_.map((e) => e.season));
  const shown = theirs.length ? theirs : all_.filter((e) => e.season === shownSeason);
  const S2 = shownSeason >= 0 ? seasonLabel(shownSeason) : S;
  const at = (it.scope.at ?? "").toLowerCase(), said = q.toLowerCase();
  const ask = (name: string) => (at && said.includes(at) ? said.replace(at, name.toLowerCase()) : `${team.number} results at ${name.toLowerCase()}`);
  // Where the team and the event are from, as their rows store them.
  const [home, where] = await Promise.all([
    get<{ state: string | null; country: string | null }>("SELECT state, country FROM teams WHERE number = ?", [team.number]),
    ev.code ? get<{ state: string | null; country: string | null }>("SELECT state, country FROM events WHERE season = ? AND code = ?", [ev.season, ev.code]) : Promise.resolve(null),
  ]);
  const placeName = (p: { state: string | null; country: string | null }) => (p.country ? findRegions(regionLabel(`${p.country}:${p.state ?? ""}`)).find((x) => x.country === p.country)?.name ?? p.country : null);
  const elsewhere = home && where && where.country && (home.country !== where.country || (home.state ?? "") !== (where.state ?? ""));
  const from = elsewhere ? placeName(home) : null, there = elsewhere ? placeName(where) : null;
  // "7 league meets and 1 league tournament": its events by kind.
  const kinds = [...new Map(theirs.map((e) => [e.type ?? "", 0])).keys()].map((k) => {
    const n = theirs.filter((e) => (e.type ?? "") === k).length, label = eventTypeLabel(k || null).toLowerCase().replace(/^first /, "FIRST ");
    return `${n} ${label}${n === 1 ? "" : "s"}`;
  });
  const listed = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}` : kinds[0];
  const why = from && there && from !== there ? ` It's a team from ${from}, and ${ev.name} is ${there}'s.`
    : theirs.length ? ` Its ${S} events, below, were ${listed}.` : ` It has no official events on record in ${S}.`;
  const below = !shown.length || (theirs.length && !(from && there && from !== there)) ? "" : theirs.length ? ` Its ${S} events are below.` : ` Its ${S2} events, its latest season with any, are below.`;
  const blocks: StatAnswer["blocks"] = shown.length ? [
    { kind: "links", title: `Its events in ${S2}`, items: shown.map((e) => ({ label: e.name, sub: [eventTypeLabel(e.type), dateRange(e.start, e.end)].filter(Boolean).join(" · "), href: eventHref(e.season, e.code, team.number) })) },
    ...(theirs.length ? [{ kind: "related" as const, title: `The same question at its ${S} events`, queries: [...new Set(theirs.map((e) => ask(e.name)))] }] : []),
  ] : [];
  return {
    family: "event", intent: it.id, title, team, scope: scopeChips(scope), blocks,
    definition: "An event's answers count only the matches, rank and awards a team has there.",
    source: `${who}'s ${S} events checked`,
    none: `${ev.absent === "never" ? `${who} has no ${ev.name.replace(/^an?s+/, "")} on record` : `${who} didn't play at ${ev.name} in ${S}`}, so it has no matches, rank or awards there.${why}${below}`,
  };
}

/** The season a Worlds answer is about: its headline's (the match or event it names), else the latest in the data. */
const worldsSeason = (s: StatAnswer): number | null => {
  const m = /\b(20\d\d)–\d\d\b/.exec(s.headline?.sub ?? "") ?? /\b(20\d\d)–\d\d\b/.exec(s.headline?.label ?? "");
  return m ? Number(m[1]) : null;
};

async function build(it: StatQuestion, team: { number: number; name: string | null }, scope: Scope): Promise<StatAnswer | null> {
  if (AWARD_INTENTS.has(it.id)) return awardsAnswer(it.id, team, scope, { count: it.count, award: it.award, pick: it.pick });
  if (it.id === "total-penalties") return penaltyTotalAnswer(team, await teamEventSet(team.number), scope);
  // Reliability is read from its own rows: an event the team was listed for but never took the field at counts.
  if (it.id === "reliability-history") return trendAnswer(it.id, team, { ...(await teamEventSet(team.number)), events: await reliabilityEvents(team.number) }, scope);
  if (TREND_INTENTS.has(it.id)) return trendAnswer(it.id, team, await teamEventSet(team.number), scope);
  if (EVENT_INTENTS.has(it.id)) return eventAnswer(it.id, team, await teamEventSet(team.number), scope, { byRecord: it.byRecord, schedule: it.schedule });
  // A forecast is for one event: the one named, else the team's next; a place or Worlds isn't one event.
  // Only a season written in the question, or "this season" (the current one), narrows it.
  if (PREDICT_INTENTS.has(it.id)) return scope.place || scope.championship || scope.states ? null : nextEventPrediction(it.id, team, undefined, scope.event, scope.season ?? null);
  const ms = await teamMatches(team.number);
  if (OPPONENT_INTENTS.has(it.id)) return opponentsAnswer(it.id, team, ms, scope);
  if (PARTNER_LIST_INTENTS.has(it.id)) return partnerListAnswer(it.id, team, ms, scope);
  if (it.id === "never-played") return neverPlayedAnswer(team, ms, scope);
  if (scope.event) {
    const evs = (await teamEventSet(team.number)).events.filter((e) => e.season === scope.event!.season && (scope.event!.codes ?? [scope.event!.code]).includes(e.code));
    const at = await eventScopeAnswer(it.id, team, ms, evs.find((e) => e.code === scope.event!.code), scope, { n: it.n, each: evs });
    if (at) return at;
  }
  if (MATCH_STAT_IDS.has(it.id)) return matchStatAnswer(it.id, team, ms, scope, { n: it.n, variant: it.variant });
  if (it.id === "results" && (scope.championship || scope.states)) return championshipMatchesAnswer(team, ms, scope);
  return matchAnswer(it.id, team, ms, scope, { leadEvent: it.leadEvent, n: it.n, outcome: it.outcome, perEvent: it.variant === "per-event" });
}

/** "Highest scoring games in decode", "top scores in nj this season", "highest scoring match ever": no team, a
 *  season's best alliance and combined scores, worked out for the page only. */
export async function topSearch(q: string, t: TopMatchesQuestion, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
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

/** "12345 auto OPR", "12345 reliability", "12345 school": one team's stored fact. The team is found as search finds it;
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

/** "How much did 12345's OPR improve from last season to this season": one team's number in two seasons, or its rating
 *  across one season (./families/seasonChange.ts). */
async function changeSearch(q: string, c: ChangeQuestion, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  if (!c.core) return changeWithoutTeam(q, c, opts.pages);
  const base = await resolve(c.core);
  const top = base.step !== "recovery" ? base.hits[0] : undefined;
  if (!top || top.kind !== "team" || top.href) return null;
  const team = { number: Number(top.ref), name: teamNameOf(top.title) || null };
  const what = c.stat === "opr" ? "OPR" : "Prediction rating";
  const label = `${whoOf(team)} · ${what} change, ${c.from != null ? `${seasonLabel(c.from)} to ` : ""}${seasonLabel(c.to)}`;
  const guessed = base.step === "did-you-mean";
  const answer: SearchAnswer = {
    q, hits: [{ ...top, linkSeason: c.to }, ...base.hits.slice(1).filter((h) => !(h.kind === "team" && h.ref === top.ref))], pages: opts.pages,
    step: guessed ? "did-you-mean" : "deterministic", weak: guessed && base.weak,
    ...(guessed && base.didYouMean ? { didYouMean: q.toLowerCase().includes(c.core) ? q.toLowerCase().replace(c.core, base.didYouMean) : base.didYouMean } : {}),
    understood: { kind: "question", label, season: c.to },
    intent: { kind: `stat-${c.stat}-change`, pattern: `[team] ${c.stat} change${c.from != null ? " [season] [season]" : " [season]"}`, met: true, understood: [`Team ${whoOf(team)}`, `${what} change`] },
  };
  if (!opts.full) return answer;
  return { ...answer, stat: await changeAnswer(c, team) };
}

/** "predicted changes", "rating change": a change is one team's, so the card says so and asks the same question of the
 *  season's top-rated teams (real teams, from the stored ratings), with the season's biggest climbers beside them. */
async function changeWithoutTeam(q: string, c: ChangeQuestion, pages: SearchPageLink[]): Promise<SearchAnswer> {
  const what = c.stat === "opr" ? "OPR" : "prediction rating";
  const col = c.stat === "opr" ? "s.opr_np" : "s.rating_np";
  const top = await all<{ team: number; name: string | null }>(`SELECT s.team, t.name FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE s.season = ? AND ${col} IS NOT NULL AND ${teamPageSql("s.team", "t.name")} ORDER BY ${col} DESC, s.team LIMIT 3`, [c.to]);
  const word = c.stat === "opr" ? "opr" : "rating";
  const ask = (s: string) => ({ href: `/search?q=${encodeURIComponent(s)}` });
  // The seasons the card was read for go with every question it asks ("… rating change in 2023-24", "… from A to B").
  const typed = (s: number) => `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  const when = c.from != null ? `from ${typed(c.from)} to ${typed(c.to)}` : `in ${typed(c.to)}`;
  const title = `A ${what} change is one team's: name the team`;
  return {
    q, hits: [], pages, step: "deterministic", weak: false,
    card: { kind: "info", title, lines: [
      ...top.map((t) => ({ text: `${t.team}${t.name ? ` ${t.name}` : ""}: ${word} change`, detail: `"${t.team} ${word} change ${when}", one of ${seasonLabel(c.to)}'s top-rated teams`, ...ask(`${t.team} ${word} change ${when}`) })),
      { text: "Most improved teams", detail: `The biggest climbs in ${seasonLabel(c.to)}`, ...ask(`most improved teams in ${typed(c.to)}`) },
    ] },
    understood: { kind: "question", label: title, season: c.to },
    intent: { kind: `stat-${c.stat}-change`, pattern: `[team] ${c.stat} change`, met: false, understood: [title] },
  };
}

/** "12345 opr rank in New Jersey", "12345 highest opr ever", "67890 auto opr versus teleop opr": one team's OPR or
 *  rating, read from what its team page (or the place's filtered list) holds; worked out for the page only. */
async function oprRatingSearch(q: string, f: OprRatingQuestion, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const base = await resolve(f.core);
  const top = base.step !== "recovery" ? base.hits[0] : undefined;
  if (!top || top.kind !== "team" || top.href) return null;
  const team = { number: Number(top.ref), name: teamNameOf(top.title) || null };
  const label = `${whoOf(team)} · ${OPR_RATING_TITLES[f.id]}`;
  const guessed = base.step === "did-you-mean";
  const answer: SearchAnswer = {
    q, hits: [{ ...top, ...(f.season != null ? { linkSeason: f.season } : {}) }, ...base.hits.slice(1).filter((h) => !(h.kind === "team" && h.ref === top.ref))], pages: opts.pages,
    step: guessed ? "did-you-mean" : "deterministic", weak: guessed && base.weak,
    ...(guessed && base.didYouMean ? { didYouMean: q.toLowerCase().includes(f.core) ? q.toLowerCase().replace(f.core, base.didYouMean) : base.didYouMean } : {}),
    understood: { kind: "question", label, ...(f.season != null ? { season: f.season } : {}), ...(f.region ? { place: { key: f.region.key, name: f.region.name } } : {}) },
    intent: { kind: `stat-${f.id}`, pattern: `[team] ${f.id}${f.region ? " [place]" : ""}${f.season != null ? " [season]" : ""}`, met: true, understood: [`Team ${whoOf(team)}`, OPR_RATING_TITLES[f.id]] },
  };
  if (!opts.full) return answer;
  const fact = (id: FactQuestion["id"], season: number | null, region: FactQuestion["region"] = null) =>
    factAnswer({ id, core: f.core, season, region, world: id === "opr-vs-average" && !region, event: null }, team, (words, s) => findEvent(words, s, { anyPlayed: true }));
  const stat = await oprRatingAnswer(f, team, {
    set: () => teamEventSet(team.number),
    season: () => factSeason(team.number, null),
    oprCard: (s) => fact("opr", s),
    worldAverage: (s, region) => fact("opr-vs-average", s, region),
  });
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
  // An initialism several events share ("who won mti"): the one every reader picks.
  const ini = await initialismEvent(it.core, (e) => season == null || e.season === season);
  if (ini) return (await get<any>("SELECT season, code, name, type, start, end, division_code division FROM events WHERE season = ? AND code = ?", [ini.season, ini.code])) ?? null;
  const won = await eventWon(words, new Set());
  if (won) return (await get<any>("SELECT season, code, name, type, start, end, division_code division FROM events WHERE season = ? AND code = ?", [won.season, won.code])) ?? null;
  return it.scope.states ? null : findEvent(it.core, season);
}

/** The event the words name in the latest season, `from` down, where it has a result (a played playoff match or a
 *  posted award, its own or a division's): with no season said, or "this year" before this season's is held. Never an older one only because
 *  its name fits the words better (owner: "who won nj turnpike division this year" read the 2022–23 division). */
async function latestWithResult(it: StatQuestion, from: number) {
  for (const s of [...SEASON_NUMBERS].filter((x) => x <= from).sort((a, b) => b - a)) {
    const e = await namedEvent(it, s);
    if (!e || Number(e.season) !== s) continue;
    const done = await get<{ x: number }>(
      // The event's own, or a division's when it's a championship split in divisions (as winnersAnswer reads them).
      `SELECT 1 x WHERE EXISTS (SELECT 1 FROM matches m WHERE m.season = ? AND m.level = 'playoff' AND m.played = 1
         AND (m.code = ? OR m.code IN (SELECT d.code FROM events d WHERE d.season = ? AND d.division_code = ?)))
       OR EXISTS (SELECT 1 FROM awards a WHERE a.season = ? AND (a.code = ? OR a.code IN (SELECT d.code FROM events d WHERE d.season = ? AND d.division_code = ?)))`,
      [s, e.code, s, e.code, s, e.code, s, e.code]);
    if (done) return e;
  }
  return null;
}

/** "winning alliance at 12345's last event": the team's latest event with a match it played (a division, when it played
 *  in one), in the season asked for when one is, or null when `words` aren't a team and "last event". */
async function teamsLastEvent(words: string, season: number | null) {
  const m = /^(.+?)\s+(?:last|latest|most\s+recent|newest|previous)\s+(?:event|meet|competition|tournament)$/.exec(words);
  const named = m ? await namedTeam(m[1], new Set()) : null;
  if (!named || !("team" in named)) return null;
  const e = (await teamEventSet(named.team)).events.filter((x) => (season == null || x.season === season) && (x.matches > 0 || x.record != null) && officialClause()(x)).pop();
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
  // No season said: the latest one held with a result; a season said is that season's, whatever fits better elsewhere.
  const unsaid = asked == null && !it.scope.lastYear;
  let named = championship ? null : (await teamsLastEvent(core, asked)) ?? (unsaid ? (await latestWithResult(it, CURRENT_SEASON)) ?? await namedEvent(it, null) : await namedEvent(it, asked));
  // "This year" naming an event not on this season's calendar yet (a division FIRST hasn't set up): its latest one, said so.
  let before = !championship && !named && it.scope.latest && it.scope.season == null ? asked : null;
  if (before != null) {
    named = (await latestWithResult(it, before - 1)) ?? await namedEvent(it, null);
    // On this season's calendar, not held yet (the same event, or a place's states of the same type there): that event,
    // whose answer says it isn't decided, never "no event on record".
    const scheduled = named ? await get<any>(
      `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.division_code division FROM events e JOIN events n ON n.season = ? AND n.code = ?
       WHERE e.season = ? AND (e.code = n.code OR (? AND e.type = n.type AND e.state IS n.state AND e.country IS n.country AND e.division_code IS NULL))
       ORDER BY e.code = n.code DESC, length(e.code), e.code LIMIT 1`, [named.season, named.code, before, it.scope.states ? 1 : 0]) : null;
    if (scheduled) { named = scheduled; before = null; }
  }
  if (!championship && !named) return null;
  // A winner word alone ("east bergen conference winner") answers only for an event its words name outright.
  if (it.bare && named && eventFit(core, named.name) < 0.75) return null;
  const stat = opts.full ? await winnersAnswer(core, named?.season ?? asked, championship, async () => named, { latest: it.scope.latest, lastYear: it.scope.lastYear, ...(before != null ? { before } : {}) }) : null;
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

/** "12345 vs 67890 head to head", "12345 OPR vs 67890": both teams found by search as typed (a team number or a name it
 *  matches outright), else left to Compare's own versus answer, which asks about a shared name. */
export async function twoTeamSearch(q: string, two: TwoTeamQuestion, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  // Each side by Compare's own rules (a number, an exact name, the one that has played, the newest); a name several
  // teams share is left to Compare, which asks which one.
  const [na, nb] = await Promise.all([namedTeam(two.a, new Set()), namedTeam(two.b, new Set())]);
  if (!na || !nb || !("team" in na) || !("team" in nb) || na.team === nb.team) return null;
  const hitOf = async (n: number) => (await resolve(String(n))).hits.find((h) => h.kind === "team" && h.ref === String(n));
  const [ta, tb] = await Promise.all([hitOf(na.team), hitOf(nb.team)]);
  if (!ta || !tb || ta.href || tb.href) return null;
  const a = { number: Number(ta.ref), name: teamNameOf(ta.title) || null }, b = { number: Number(tb.ref), name: teamNameOf(tb.title) || null };
  const s = two.scope;
  const scope: Scope = { season: s.season, championship: s.championship, states: s.states, level: s.level ?? undefined, ...(s.finals ? { finals: true } : {}), alliance: s.alliance ?? undefined };
  if (s.place) scope.place = { country: s.place.country, state: s.place.state, name: s.place.name };
  if (s.area) scope.place = { country: s.area.country, state: s.area.state ?? "", name: s.area.name };
  if (s.window) scope.window = s.window;
  // "This season" for the meetings: the first team's latest season with matches; for season numbers, the latest both played.
  if (MEETING_IDS.has(two.id) && s.season == null && s.latest) {
    const ms = (await teamMatches(a.number)).filter(officialClause());
    scope.season = ms.length ? Math.max(...ms.map((m) => m.season)) : null;
    if (scope.season != null) scope.seasonWhy = `"This season" here is ${seasonLabel(scope.season)}, ${a.number}'s latest season with matches on record.`;
  }
  const title = `${TWO_TEAM_TITLES[two.id]}: ${whoOf(a)} vs ${whoOf(b)}`;
  // "Who wins" keeps what the asks gave it (Compare's hit first, Predict first among the pages), with the call as its card.
  // Compare's own link leads a forecast and a season side by side, as plain "12345 vs 67890" always opened it: on the
  // card's season, the one named or else the one the card picks (every team played it).
  const seasonCompare = two.id === "compare" && !s.at && !s.championship && !s.states;
  const leadSeason = seasonCompare ? scope.season ?? (await compareSeason([a.number, b.number])) : scope.season;
  const lead = two.id === "predict" || seasonCompare ? (await versusAnswer(`${a.number} vs ${b.number}`, new Set(), leadSeason))?.hits.find((h) => h.kind === "compare") : undefined;
  // Predict opens on the season the card's call is for.
  const predictSeasonOf = two.id === "predict" ? scope.season ?? (await predictionSeason(a.number, b.number)).season : null;
  const pages = predictSeasonOf != null ? [{ title: `Predict ${a.number} vs ${b.number}`, href: predictHref({ mode: "match", season: predictSeasonOf, red: [a.number], blue: [b.number] }) }, ...opts.pages] : opts.pages;
  const answer: SearchAnswer = {
    q, hits: [...(lead ? [lead] : []), { ...ta, section: "matches", facts: undefined, events: undefined }, { ...tb, section: "matches", facts: undefined, events: undefined }], pages, step: "deterministic", weak: false,
    understood: { kind: "question", label: title, ...(scope.season != null ? { season: scope.season } : {}) },
    intent: { kind: `stat-${two.id}`, pattern: `[team] ${two.id} [team]${scope.season != null ? " [season]" : ""}`, met: true, understood: [`Teams ${whoOf(a)} and ${whoOf(b)}`, TWO_TEAM_TITLES[two.id]] },
  };
  if (!opts.full) return answer;
  // Compared at an event named (or their Worlds or states): each team's numbers there, side by side.
  if (two.id === "compare" && (s.at || s.championship || s.states)) {
    const stat = await compareAt(two, a, b, scope);
    return stat ? { ...answer, understood: { kind: "question", label: stat.title }, stat } : null;
  }
  // Their meetings at an event or a venue named: the events of it both played, else why there are none.
  const at = s.at ? await meetingsAt(two, a, b, scope) : null;
  if (s.at && !at) return null;
  if (at && "stat" in at) return { ...answer, understood: { kind: "question", label: at.stat.title }, stat: at.stat };
  const scoped = at ? at.scope : scope;
  const stat = await twoTeamStat(two, a, b, scoped);
  if (scoped.seasonWhy) stat.definition = `${stat.definition} ${scoped.seasonWhy}`;
  if (stat.none) await missingSide(stat, a, b, scoped, s.at);
  return { ...answer, understood: { kind: "question", label: `${TWO_TEAM_TITLES[two.id]}${scopePhrase(scoped)}: ${whoOf(a)} vs ${whoOf(b)}`, ...(scoped.season != null ? { season: scoped.season } : {}) }, stat };
}

/** No meetings in a scope (Worlds, states, an event): which team has no matches there is said, with the question to
 *  ask of each team's own ("67890 has no matches at Worlds on record"). */
async function missingSide(stat: StatAnswer, a: AnswerTeam, b: AnswerTeam, scope: Scope, words: string | null): Promise<void> {
  if (!scope.championship && !scope.states && !scope.event && !scope.venue) return;
  const keep = inScope(scope);
  const none = [];
  for (const t of [a, b]) if (!(await teamMatches(t.number)).some((m) => m.counted && keep(m))) none.push(t);
  const ask = scope.championship ? "at worlds" : scope.states ? "at states" : words ? `at ${words}` : "";
  if (none.length) stat.none = `${stat.none} ${none.map((t) => `${whoOf(t)} has no matches${scopePhrase(scope)} on record.`).join(" ")}`;
  stat.blocks.push({ kind: "related", title: "Each team's own", queries: [a, b].map((t) => `${t.number} matches ${ask}`.trim()) });
}

/** "12345 and 67890 matches together at nj championship", "… at river dell high school": the events the words name that
 *  both teams played (a championship's division and finals as one), as their meetings' scope; else, when only one (or
 *  neither) was there, the answer saying so. A venue's events are read when no event of theirs is named so. */
async function meetingsAt(two: TwoTeamQuestion, a: AnswerTeam, b: AnswerTeam, scope: Scope): Promise<{ scope: Scope } | { stat: StatAnswer } | null> {
  const s = two.scope, words = s.at!;
  // Only events the team took the field at (a kickoff or a roster-only league row is no meeting place).
  const [ea, eb] = (await Promise.all([teamEventSet(a.number), teamEventSet(b.number)])).map((x) => x.events.filter(played));
  // "This season" is the season the scope already chose.
  const season = s.year ? null : s.season ?? (s.latest ? scope.season ?? null : null);
  const first = teamPick(ea, s, season) ?? teamPick(eb, s, season);
  const title = `${TWO_TEAM_TITLES[two.id]}: ${whoOf(a)} vs ${whoOf(b)}`;
  const base = (none: string, chips: string[], queries: string[]): { stat: StatAnswer } => ({ stat: {
    family: "event", intent: two.id, title, team: a, teams: [a, b], scope: chips, definition: "A meeting is a match both teams played in, as partners or opponents.",
    source: "Both teams' events checked", none, blocks: queries.length ? [{ kind: "related", title: "Their own events", queries: [...new Set(queries)] }] : [],
  } });
  if (first) {
    const S = first.primary.season, again = { ...s, year: false, season: S };
    const pa = teamPick(ea, again, S), pb = teamPick(eb, again, S);
    if (pa && pb) {
      const codes = pa.events.filter((e) => pb.events.some((x) => x.code === e.code)).map((e) => e.code);
      if (codes.length) return { scope: { ...scope, season: null, states: false, event: { season: S, code: codes.find((c) => c === pa.primary.code) ?? codes[0], name: codes.length === pa.events.length ? pa.name : pb.name, ...(codes.length > 1 ? { codes } : {}) } } };
      return base(`${whoOf(a)} played ${pa.name} and ${whoOf(b)} played ${pb.name} in ${seasonLabel(S)}: never the same event, so they have no shared matches there.`, [pa.name, pb.name, seasonLabel(S)],
        [`${a.number} matches at ${pa.name.toLowerCase()}`, `${b.number} matches at ${pb.name.toLowerCase()}`]);
    }
    const here = (pa ?? pb)!, there = pa ? a : b, away = pa ? b : a;
    const theirs = (pa ? eb : ea).filter((e) => e.season === S && officialClause()(e));
    return base(`${whoOf(away)} wasn't at ${here.name} in ${seasonLabel(S)}, so there are no matches together there. ${whoOf(there)} played it.`, [here.name, seasonLabel(S)],
      [`${there.number} matches at ${here.name.toLowerCase()}`, ...theirs.map((e) => `${away.number} matches at ${e.name.toLowerCase()}`)]);
  }
  const venue = await venueOf(words, a.number, b.number);
  if (venue) return { scope: { ...scope, venue } };
  const named = await findEvent(words, season, { anyPlayed: true, closest: true });
  if (!named) {
    // None that season ("this season", before the event is held): the event the words name, said to have none then.
    const other = season != null ? await findEvent(words, null, { anyPlayed: true, closest: true }) : null;
    if (!other) return null;
    const name = shortEvent(other.name, other.type ?? null);
    return base(`${name} has no ${seasonLabel(season!)} event on record, so ${whoOf(a)} and ${whoOf(b)} have no matches together there in ${seasonLabel(season!)}.`, [name, seasonLabel(season!)],
      [`${a.number} and ${b.number} matches together at ${words} in ${seasonLabel(Number(other.season))}`]);
  }
  const S = Number(named.season), name = shortEvent(named.name, named.type ?? null);
  return base(`Neither ${whoOf(a)} nor ${whoOf(b)} played at ${name} in ${seasonLabel(S)}, so there are no matches together there.`, [name, seasonLabel(S)],
    [...ea, ...eb].filter((e) => e.season === S && officialClause()(e)).slice(-6).map((e) => `${ea.includes(e) ? a.number : b.number} matches at ${e.name.toLowerCase()}`));
}

/** The words two event names start with, up to a separator ("Romania Championship - A Division", "… - B Division":
 *  "Romania Championship"), or null when they share none. */
function sharedName(x: string, y: string): string | null {
  const wx = x.split(/\s+/), wy = y.split(/\s+/);
  let n = 0;
  while (n < wx.length && n < wy.length && wx[n] === wy[n]) n++;
  const head = wx.slice(0, n).join(" ").replace(/[\s:–·-]+$/, "").trim();
  return head || null;
}

/** The rule a side by side at an event states. */
const AT_EVENT_RULE = "Each team's numbers at the event, as its team page lists them: qualification rank (out of the teams ranked there), OPR there without penalties and by phase, and its record there (playoffs included; a championship's division and finals as one).";

/** "12345 vs 67890 at nj championship": each team's row at the event named (its division and finals for a
 *  championship), side by side. The same event for both, in the season the first one found was in; when only one
 *  team (or neither) was there, or they played different events the words name, the card says so. Null: the words
 *  name no event of either team's. */
async function compareAt(two: TwoTeamQuestion, a: AnswerTeam, b: AnswerTeam, scope: Scope): Promise<StatAnswer | null> {
  const s = two.scope;
  const [ea, eb] = (await Promise.all([teamEventSet(a.number), teamEventSet(b.number)])).map((x) => x.events.filter(played));
  // "This season": the first team's latest season with an official event played, as the meetings read it.
  const official = officialClause(), mine = ea.filter(official);
  const season = s.year ? null : s.season ?? (s.latest && mine.length ? Math.max(...mine.map((e) => e.season)) : null);
  // A calendar year ("in 2025") stays in the scope: it picks the edition held that year.
  const pickScope = s.year ? s : { ...s, season };
  let first = teamPick(ea, pickScope, season) ?? teamPick(eb, pickScope, season);
  // Worlds or states with no season said, and neither team there this season: the newest one either went to.
  const type = s.championship ? CHAMPIONSHIP_TYPE : s.states ? STATES_TYPE : null;
  const went = (evs: TeamEvent[]) => evs.filter((e) => e.type === type);
  if (!first && type && season == null && !s.year) {
    const seasons = [...went(ea), ...went(eb)].map((e) => e.season);
    const last = seasons.length ? Math.max(...seasons) : null;
    if (last != null) first = teamPick(ea, { ...s, season: last }, last) ?? teamPick(eb, { ...s, season: last }, last);
  }
  if (!first) return null;
  const S = first.primary.season, again = { ...s, year: false, season: S };
  const pa = teamPick(ea, again, S), pb = teamPick(eb, again, S);
  const base = { family: "two-team" as const, intent: "compare", team: a, teams: [a, b], definition: AT_EVENT_RULE, source: "From each team's event rows" };
  // Follow-ups ask again of the season shown ("… at nj championship in 2025-26"), never the event's newest edition.
  const at = `${s.at ?? (s.championship ? "worlds" : "states")} in ${S}-${String((S + 1) % 100).padStart(2, "0")}`;
  const related = (picks: [AnswerTeam, TeamEventPick | null][]) => ({ kind: "related" as const, title: "Each team's own", queries: picks.map(([t]) => `${t.number} results at ${at}`) });
  if (!pa || !pb) {
    const here = (pa ?? pb)!, away = pa ? b : a;
    return { ...base, title: `${a.number} vs ${b.number} at ${here.name}`, scope: [here.name, seasonLabel(S)], blocks: [related([[a, pa], [b, pb]])],
      none: type && !went(pa ? eb : ea).length
        ? `${whoOf(away)} has no ${type === CHAMPIONSHIP_TYPE ? "Worlds" : "state championship"} matches on record in any season, so there is nothing to compare there. ${whoOf(pa ? a : b)}'s own results there are linked below.`
        : `${whoOf(away)} has no matches at ${here.name} in ${seasonLabel(S)} on record, so there is nothing to compare there.` };
  }
  // A championship's division and finals are one event: two teams in different divisions still played it.
  const fam = (p: TeamEventPick) => new Set(p.events.map((e) => e.division ?? e.code));
  const fb = fam(pb);
  if (![...fam(pa)].some((c) => fb.has(c))) {
    return { ...base, title: `${a.number} vs ${b.number}, ${seasonLabel(S)}`, scope: [pa.name, pb.name, seasonLabel(S)], blocks: [related([[a, pa], [b, pb]])],
      none: `${whoOf(a)} played ${pa.name} and ${whoOf(b)} played ${pb.name} in ${seasonLabel(S)}: not the same event, so there is no side by side there.` };
  }
  // One event for both: the first team's own when both played it, else the first both played (an AM and a PM meet
  // by one name are two events: one team's PM numbers never stand beside the other's AM ones). Each team's rows are
  // that event's alone (its division and finals for a championship), its division leading.
  const key = (e: TeamEvent) => e.division ?? e.code;
  const shared = [key(pa.primary), ...pa.events.map(key)].find((k) => fb.has(k))!;
  const own = (p: TeamEventPick) => {
    const evs = p.events.filter((e) => key(e) === shared);
    return { events: evs, primary: evs.find((e) => e.division != null) ?? evs[0] };
  };
  const teams = [a, b], picks = [own(pa), own(pb)], rows = picks.map((p) => p.primary);
  const recs = picks.map((p) => p.events.reduce((r, e) => (e.record ? { wins: r.wins + e.record.wins, losses: r.losses + e.record.losses, ties: r.ties + e.record.ties } : r), { wins: 0, losses: 0, ties: 0 }));
  const recText = (r: { wins: number; losses: number; ties: number }) => `${r.wins}-${r.losses}-${r.ties}`;
  const scale = await seasonScale(S, ["opr_np", "opr_auto", "opr_teleop", "opr_endgame"]);
  const block = compareBlock("At the event", teams, [
    { label: "OPR", total: true, values: rows.map((e) => e.opr), max: scale.opr_np, better: "higher" },
    { label: "Auto", values: rows.map((e) => e.auto), max: scale.opr_auto, better: "higher" },
    { label: "TeleOp", values: rows.map((e) => e.teleop), max: scale.opr_teleop, better: "higher" },
    { label: "Endgame", values: rows.map((e) => e.endgame), max: scale.opr_endgame, better: "higher" },
    { label: "Rank", values: rows.map((e) => e.rank), show: (v, i) => (v == null ? "–" : `#${v}${rows[i].of ? ` of ${rows[i].of}` : ""}`), gap: (d) => `${Math.abs(d)} place${Math.abs(d) === 1 ? "" : "s"}`, better: "lower" },
    { label: "Record", values: recs.map(winShare), show: (_, i) => recText(recs[i]), gap: () => "", better: "higher" },
  ], S);
  const crow = block.kind === "compare" ? block.rows : [];
  const ranks = rows.map((e, i) => `${teams[i].number} ${e.rank != null ? `#${e.rank}` : "unranked"} (${recText(recs[i])})`);
  // Different divisions of one championship: the part of their names they share ("Romania Championship").
  const name = rows[0].code === rows[1].code ? (picks[0].events.length === pa.events.length ? pa.name : rows[0].name) : sharedName(rows[0].name, rows[1].name) ?? rows[0].name;
  // Their matches together at the event compared (by its own name, without the divisions note), not every event the
  // words named ("Lakeside League Meet": the AM meet both played, never the PM one too).
  const there = `${name.replace(/\s*\([^)]*\)$/, "").toLowerCase()} in ${S}-${String((S + 1) % 100).padStart(2, "0")}`;
  return {
    ...base, title: `${a.number} vs ${b.number} at ${name}`, scope: [name, seasonLabel(S)],
    headline: crow[0] && rows.some((e) => e.opr != null) ? leadHeadline(teams, crow[0], [...ranks, decidedText(crow)], eventHref(S, rows[0].code)) : { value: ranks.join(" · "), label: `No OPR at ${name} on record` },
    blocks: [block, { kind: "links", title: "Try it", items: [{ label: `${a.number} and ${b.number} matches together there`, href: `/search?q=${encodeURIComponent(`${a.number} and ${b.number} matches together at ${there}`)}` }] }],
  };
}

/** A venue the words name ("river dell high", "river dell high schook"), among the venues of either team's events:
 *  the closest name (or names alike), with every event either team played there, any season. */
/** Letters a stored venue spelling may be off by and still be the same place. */
const VENUE_TYPOS = 4;

async function venueOf(words: string, a: number, b: number): Promise<{ name: string; keys: string[] } | null> {
  const rows = await all<{ season: number; code: string; venue: string; city: string | null }>(
    `SELECT DISTINCT e.season, e.code, e.venue, e.city FROM events e JOIN event_teams t ON t.season = e.season AND t.code = e.code
     WHERE t.team IN (?, ?) AND e.venue IS NOT NULL AND e.venue <> ''`, [a, b]);
  const scored = rows.map((r) => ({ r, s: fuzzyScore(words, r.venue) })).filter((x) => x.s >= 0.75);
  if (!scored.length) return null;
  // The closest name; on a tie, the spelling most events use.
  const uses = (v: string) => rows.filter((r) => r.venue === v).length;
  const best = scored.reduce((x, y) => (y.s > x.s || (y.s === x.s && uses(y.r.venue) > uses(x.r.venue)) ? y : x)).r;
  // One venue can be stored spelled several ways ("River Dell", "River Dale", "River DeHigh High School"): a spelling
  // in the same city a few letters off is that venue too, while another school there ("Lincoln Middle" beside
  // "Lincoln High") is not.
  const fold = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();
  const kept = rows.filter((r) => r.venue === best.venue || (r.city != null && r.city === best.city && edits(fold(r.venue), fold(best.venue)) <= VENUE_TYPOS));
  return { name: best.venue, keys: [...new Set(kept.map((r) => `${r.season}:${r.code}`))] };
}

async function twoTeamStat(two: TwoTeamQuestion, a: AnswerTeam, b: AnswerTeam, scope: Scope): Promise<StatAnswer> {
  switch (two.id) {
    case "head-to-head": return headToHead(a, b, await teamMatches(a.number), scope);
    case "h2h-wins": return { ...(await headToHead(a, b, await teamMatches(a.number), scope, { wins: true })), intent: "h2h-wins", title: `Wins against ${b.number}${scopePhrase(scope)}` };
    case "shared-matches": return sharedMatchList(a, b, scope);
    case "compare": return compareAnswer([a, b], scope);
    case "phase-vs": return phaseSideBySide(two.phase ?? "auto", a, b, scope);
    case "reliability-vs": return reliabilitySideBySide(a, b, scope);
    case "penalties-vs": return penaltiesSideBySide(a, b, scope);
    case "awards-vs": return awardsSideBySide(a, b, scope.season);
    case "predict": case "win-chance": {
      // A prediction is one season's ratings: the season named, else the latest completed one.
      const s: { season: number; why?: string } = scope.season != null ? { season: scope.season } : await predictionSeason(a.number, b.number);
      const season = s.season;
      const why = s.why;
      return pairPrediction(two.id, `${two.id === "win-chance" ? "Win chance" : "Prediction"}: ${a.number} vs ${b.number} in ${seasonLabel(season)}`, a, b, season, why);
    }
    default: return seasonSideBySide(two.id, a, b, scope);
  }
}

/** "12345 67890 33950 compare": three to six teams' season numbers in one card (compareAnswer). Every team found by its
 *  number, else left to search. */
async function teamSetSearch(q: string, set: TeamSetQuestion, resolve: Resolve, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const hits = await Promise.all(set.teams.map(async (n) => (await resolve(String(n))).hits.find((h) => h.kind === "team" && h.ref === String(n) && !h.href)));
  if (hits.some((h) => !h)) return null;
  const found = hits as SearchHit[];
  const teams = found.map((h) => ({ number: Number(h.ref), name: teamNameOf(h.title) || null }));
  const label = `Compare: ${teams.map(whoOf).join(" vs ")}`;
  // Compare's own hit for the set leads, as it does for "12345 vs 67890 vs 33950"; the card is the numbers.
  const found0 = (await resolve(set.teams.join(" vs "))).hits.find((h) => h.kind === "compare");
  // It opens on the card's season: the one named, else the one the card picks (every team played it).
  const season = set.season ?? (await compareSeason(set.teams));
  const compare = found0 && season != null && found0.href && !/[?&]season=/.test(found0.href)
    ? { ...found0, href: `${found0.href}${found0.href.includes("?") ? "&" : "?"}season=${season}` } : found0;
  const answer: SearchAnswer = {
    q, hits: [...(compare ? [compare] : []), ...found.map((h) => ({ ...h, facts: undefined, events: undefined }))], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label, ...(set.season != null ? { season: set.season } : {}) },
    intent: { kind: "stat-compare", pattern: `[team] [team] [team] compare${set.season != null ? " [season]" : ""}`, met: true, understood: [`Teams ${teams.map(whoOf).join(", ")}`, "Compare"] },
  };
  if (!opts.full) return answer;
  return { ...answer, stat: await compareAnswer(teams, { season: set.season }) };
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
export async function boardSearch(q: string, b: LeaderboardQuestion, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const isCity = b.kind === "city" || b.kind === "city-best";
  const city = isCity ? await get<{ city: string }>("SELECT city FROM teams WHERE lower(city) = lower(?) LIMIT 1", [b.city]) : null;
  if (isCity && !city) return null;
  const st = boardStatFor(b.stat, b.season ?? searchSeason());
  if (!st) return null;
  const where = b.town ? ` in ${b.town}` : b.region ? ` in ${b.region.name}` : city ? ` in ${city.city}` : "";
  const label = b.event ? `${b.event.home ? `${b.event.home.name} teams` : "Best teams"} at ${b.event.name}` : b.kind === "city" ? `Teams${where}` : b.kind === "city-best" ? `Best team${where} by OPR` : b.undefeated ? `Undefeated teams${where}` : b.kind === "rookie" && b.asc ? `Lowest rookie teams${where} by ${statWords(st)}` : b.asc ? `Lowest ${b.n > 1 ? `${b.n} teams` : "team"} by ${statWords(st)}${where}` : b.best ? `Best team${where} by ${statWords(st)}` : b.kind === "rookie" ? `Best rookie teams${where}` : b.kind === "improved" ? `Most improved teams${where}` : `Top ${b.n} teams by ${statWords(st)}${where}`;
  const answer: SearchAnswer = {
    q, hits: [], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label, ...(b.season != null ? { season: b.season } : {}), ...(b.region ? { place: { key: b.region.key, name: b.region.name } } : {}) },
    intent: { kind: `stat-leaderboard-${b.kind}`, pattern: b.kind === "city" ? "teams in [city]" : b.kind === "city-best" ? "best team in [city]" : `${b.kind} [stat]${b.region ? " [place]" : ""}`, met: true, understood: [label] },
  };
  // The search box gets a link to the answer page, never an empty answer.
  if (!opts.full) return { ...answer, pages: [{ title: label, href: `/search?q=${encodeURIComponent(q)}` }, ...opts.pages] };
  const stat = await leaderboardAnswer({ ...b, stat: st });
  // An event's board is headed by its card's own title less its season (what it's ranked by is said there), so the
  // page says it once: the card's title under a heading that holds it is hidden.
  const heading = b.event ? stat.title.replace(/ · [^·]+$/, "") : null;
  const read: SearchAnswer = heading ? { ...answer, understood: { ...answer.understood!, label: heading }, intent: { ...answer.intent!, understood: [heading] } } : answer;
  // The full list's page (Teams for an OPR list, Rankings for a rating list) leads the page links.
  const more = stat.blocks.find((x) => x.kind === "leaderboard")?.more;
  return { ...read, stat, pages: more ? [{ title: more.label.replace(/^View more detail on (?:the )?/, "").replace(/ \(.*\)$/, "").replace(/^./, (c) => c.toUpperCase()), href: more.href }, ...opts.pages.filter((p) => p.href !== more.href)] : opts.pages };
}
