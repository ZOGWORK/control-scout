// A league's standings asked with no team ("NE league standings", "nj northeast league leaderboard", "who is first in
// the northeast league"): FIRST's league table (server/api/leagues.ts). The league is found from the data, never by
// name here: its FIRST name's words ("Northeast"), its code ("NE") and the place its meets are in ("nj", "new jersey").
// A place with several leagues and no name said ("nj league standings") lists that place's leagues.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { regionOf } from "../../../../src/shared/searchEventQuery.js";
import { placeName } from "../../../../src/shared/regions.js";
import { leagueHref, leagueTitle } from "../../../../src/shared/leagues.js";
import { all } from "../../../db.js";
import { leagueStandings } from "../../leagues.js";
import { readScope } from "../read.js";

export interface LeagueAsk {
  /** The words naming the league and its place ("ne", "nj northeast"). */
  words: string[];
  season: number | null;
  /** "Last season": the season before the current one (the caller's askSeason()), not readScope's latest completed. */
  last: boolean;
  /** "Who is first …": the leader is the headline. */
  leader: boolean;
}

/** What a standings ask says beside "league": its table, or who leads it. */
const TABLE = /\b(?:standings?|rankings?|ranks?|ranked|leaderboard|leader\s?board|table|ladder|placings?|positions?|results?)\b/;
const LEADER = /\bwho(?:\s+is|'s|s)?\s+(?:in\s+)?(?:first|1st|top|leading|winning|number\s+(?:one|1)|#1)\b|\b(?:who|which\s+team)\s+(?:leads|is\s+leading|tops)\b|\bleaders?\b|\btop\s+(?:teams?|of)\b|\bfirst\s+place\b/;
/** Words that are the ask's frame, not the league's name. */
const FRAME = new Set(["the", "a", "an", "of", "in", "for", "at", "on", "is", "are", "what", "whats", "who", "whos", "which", "team", "teams", "show", "me", "current", "currently", "now", "rn", "right", "today", "latest", "so", "far", "please", "pls", "ftc", "first", "1st", "top", "leading", "winning", "leads", "leader", "leaders", "place", "number", "one", "1", "this", "season", "year", "official", "overall", "full", "whole", "entire", "and", "how", "does", "do", "look", "looks", "like", "s", "tops", "#1", "see", "get", "list", "all", "tell", "about", "standing", "standings", "ranking", "rankings", "rank", "ranks", "ranked", "leaderboard", "leader board", "board", "table", "ladder", "placing", "placings", "position", "positions", "result", "results", "league", "leagues"]);

/** A league's standings asked with no team, or null. A team's number in it is a team's ask (facts.ts league-rank). */
export function readLeagueAsk(raw: string): LeagueAsk | null {
  const q = ` ${raw.toLowerCase().replace(/['’]/g, "").replace(/[?!,.]/g, " ")} `.replace(/\s+/g, " ");
  if (!/\bleagues?\b/.test(q)) return null;
  const leader = LEADER.test(q);
  if (!leader && !TABLE.test(q)) return null;
  const { scope, rest } = readScope(q);
  // Any other number is a team's (a season was taken out above).
  if (/\b\d{1,6}s?\b/.test(rest.replace(/\b(?:number\s+1|1st|#1)\b/g, " "))) return null;
  // A filter the league table can't answer (playoffs, an alliance, all time, a day, an event's place): not this ask,
  // never the whole season's table as if it were.
  if (scope.championship || scope.states || scope.at || scope.level || scope.alliance || scope.ever || scope.day || scope.window || scope.place || scope.outOfState) return null;
  // A code typed in capitals is kept as typed, even one that is a word too ("IN", "OR", "MA"): the place and code
  // readers below tell "MA" (Massachusetts) from "ma", and a frame word in capitals may be a league's code.
  // A query all in capitals says nothing by them.
  const caps = new Set(/[a-z]/.test(raw) ? raw.match(/\b[A-Z]{2,3}\b/g) ?? [] : []);
  const words = rest.split(" ").filter((w) => w && (caps.has(w.toUpperCase()) || !FRAME.has(w))).map((w) => caps.has(w.toUpperCase()) ? w.toUpperCase() : w);
  // A season after every one on record ("… in 2027") is kept as asked: the answer says it has no standings yet.
  const season = scope.future?.season ?? (scope.lastYear ? null : scope.season);
  return words.length ? { words, season, last: !!scope.lastYear && season == null, leader } : null;
}

export interface League { region: string; code: string; name: string | null; state: string | null; country: string | null; teams: number }

/** The season's leagues with standings, each with its meets' place. */
async function leaguesWithPlace(season: number): Promise<League[]> {
  return all<League>(
    `SELECT r.region, r.league code, l.name, COUNT(*) teams,
       (SELECT e.state FROM events e WHERE e.season = r.season AND e.region = r.region AND e.league = r.league AND e.state IS NOT NULL LIMIT 1) state,
       (SELECT e.country FROM events e WHERE e.season = r.season AND e.region = r.region AND e.league = r.league AND e.country IS NOT NULL LIMIT 1) country
     FROM league_rankings r LEFT JOIN leagues l ON l.season = r.season AND l.region = r.region AND l.code = r.league
     WHERE r.season = ? GROUP BY r.region, r.league`, [season]);
}

const lower = (w: string) => w.toLowerCase();
const nameWords = (l: League) => (l.name ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && w !== "league");

/**
 * The leagues `words` name: a place said (its longest run of words that is a state or country) keeps that place's
 * leagues; every other word must be one of the league's name words or its code. Leagues whose whole name was said
 * come first. When the place reading leaves no league ("NE" is Nebraska too), the words are read without it.
 */
export function matchLeagues(said: string[], leagues: League[]): { leagues: League[]; place: string | null; named: boolean; also?: { place: string; leagues: League[] } } {
  // Two words said for one of a league's name words ("north east" for "Northeast") are that word.
  const known = new Set(leagues.flatMap(nameWords));
  // Read joined first ("north east" is "northeast" even where "North" and "East" are leagues too), then as said.
  const joined = said.reduce<string[]>((out, w) => { const j = lower(`${out[out.length - 1] ?? ""}${w}`); if (out.length && known.has(j)) out[out.length - 1] = j; else out.push(w); return out; }, []);
  if (joined.length < said.length) { const m = matchWords(joined, leagues); if (m.leagues.length) return m; }
  return matchWords(said, leagues);
}

function matchWords(words: string[], leagues: League[]): { leagues: League[]; place: string | null; named: boolean; also?: { place: string; leagues: League[] } } {
  const countries = new Map(leagues.filter((l) => l.country).map((l) => [lower(l.country!), l.country!]));
  const tryWith = (placeWords: string[] | null) => {
    const region = placeWords ? regionOf(placeWords) : null;
    // A country said ("canada league standings"): its leagues, whatever their state.
    const country = placeWords && !region ? countries.get(lower(placeWords.join(" "))) ?? null : null;
    if (placeWords && !region && !country) return null;
    const left = placeWords ? words.filter((w) => !placeWords.includes(w)) : words;
    let pool = region ? leagues.filter((l) => l.state === region.state && l.country === region.country) : country ? leagues.filter((l) => l.country === country) : leagues;
    if (left.length) pool = pool.filter((l) => left.every((w) => nameWords(l).includes(lower(w)) || lower(l.code) === lower(w)));
    if (!pool.length) return null;
    const whole = pool.filter((l) => nameWords(l).length > 0 && nameWords(l).every((w) => left.some((x) => lower(x) === w)));
    return { leagues: whole.length ? whole : pool, place: region?.name ?? country, named: left.length > 0 };
  };
  // The longest run of words that is a place, then shorter ones.
  let placed: ReturnType<typeof tryWith> = null;
  for (let n = Math.min(3, words.length); n >= 1 && !placed; n--) {
    for (let i = 0; i + n <= words.length && !placed; i++) placed = tryWith(words.slice(i, i + n));
  }
  // A place with a league's name beside it wins; a place alone loses to the same word read as a league's code or name.
  const plain = placed?.named ? null : tryWith(null);
  // The same word read both ways ("MA": a league's code and Massachusetts): the code's league, the place's linked.
  if (plain && placed?.place) return { ...plain, also: { place: placed.place, leagues: placed.leagues } };
  return plain ?? placed ?? { leagues: [], place: null, named: true };
}

/** The answer: one league's table (the biggest of equally good matches, the others linked), or a place's leagues. */
export async function leagueAskAnswer(ask: LeagueAsk, season: number, said: boolean): Promise<StatAnswer> {
  const S = seasonLabel(season);
  const why = said ? "" : ` With no season named, the season is ${S}, the current one.`;
  const base = { family: "leaderboard" as const, intent: "league-standings", title: `League standings ${S}`, scope: [S], definition: `A league's standing is FIRST's official league ranking, which counts every meet so far that season, ranked by ranking score (RS, average ranking points per match).${why}`, source: `FIRST's ${S} league rankings`, blocks: [] as StatBlock[] };
  const { leagues, place, named, also } = matchLeagues(ask.words, await leaguesWithPlace(season));
  if (!leagues.length) return { ...base, none: `No league named "${ask.words.join(" ")}" has standings in ${S}.` };
  const label = (l: League) => `${leagueTitle(l.name, l.code)}${placeName(l.state, l.country) ? ` (${placeName(l.state, l.country)})` : ""}`;
  // A place's leagues, no name said: the list.
  if (!named && leagues.length > 1) {
    return { ...base, title: `Leagues in ${place} · ${S}`, scope: [S, place ?? ""].filter(Boolean),
      blocks: [{ kind: "links", title: `${leagues.length} leagues with standings`, items: leagues.sort((a, b) => (a.name ?? a.code).localeCompare(b.name ?? b.code)).map((l) => ({ label: leagueTitle(l.name, l.code), href: leagueHref(season, l.region, l.code), sub: `${l.teams} teams` })) }] };
  }
  const [top, ...others] = [...leagues].sort((a, b) => b.teams - a.teams);
  const d = (await leagueStandings(season, top.region, top.code))!;
  const name = `${leagueTitle(d.name, d.code)}${d.place ? ` (${d.place})` : ""}`;
  const more = { label: "Full league standings", href: leagueHref(season, d.region, d.code) };
  const lead = d.rows[0];
  const blocks: StatBlock[] = [{ kind: "league", title: "", season, rows: d.rows, more }];
  if (others.length) blocks.push({ kind: "links", title: `Other leagues called "${ask.words.join(" ")}"`, items: others.map((l) => ({ label: label(l), href: leagueHref(season, l.region, l.code), sub: `${l.teams} teams` })) });
  if (also) blocks.push({ kind: "links", title: `Leagues in ${also.place}`, items: also.leagues.map((l) => ({ label: label(l), href: leagueHref(season, l.region, l.code), sub: `${l.teams} teams` })) });
  return { ...base, title: `${name} standings · ${S}`, scope: [S, d.place ?? ""].filter(Boolean),
    ...(lead ? { headline: { value: `#1 ${lead.team}`, label: `${lead.name ?? `Team ${lead.team}`} leads ${d.rows.filter((r) => r.played).length} teams`, sub: `RS ${lead.rs?.toFixed(2) ?? "—"} · ${lead.wins ?? 0}-${lead.losses ?? 0}-${lead.ties ?? 0}`, href: `/teams/${lead.team}?season=${season}` } } : { none: `FIRST has no standings for ${name} yet.` }),
    blocks };
}
