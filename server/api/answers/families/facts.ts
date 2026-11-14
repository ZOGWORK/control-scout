// One team's stored facts, answered from what its team page already holds (never recomputed in a request): its season
// OPR and each phase's with the world rank, its prediction rating, the engine's report card on it, its next match's
// prediction, its events in a season or a place, its OPR against a place's, the world's or an event's average, its
// reliability, its schedule difficulty and its league standing. (Its registration, school to sponsors, is
// searchCoverage.ts's own answer.) Each season is a different game: a number is only ever set against its own season's.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import type { Region } from "../../../../src/shared/regions.js";
import { dateRange, num, possessive, seasonLabel } from "../../../../src/shared/format.js";
import { regionOf } from "../../../../src/shared/searchEventQuery.js";
import { countryOf } from "../../../../src/shared/countries.js";
import { RANKED_MIN_MATCHES } from "../../../../src/shared/rankings.js";
import { scheduleRankText, scheduleWord } from "../../../../src/shared/scheduleDifficulty.js";
import { all, get } from "../../../db.js";
import { isEnabled } from "../../../flags.js";
import { ATTENDED, LEAGUE_RANKED, seasonStats, teamEvents, teamReliability, teamReportCards, teamSchedule } from "../../teams.js";
import { readScope } from "../read.js";
import { currentSeason, seasonWhy, teamSeason } from "../season.js";
import { ratingKpis } from "./oprRating.js";
import { eventHref, matchHref, shortEvent, teamHref } from "../matchSet.js";
import { leagueStandings, teamLeagueStanding } from "../../leagues.js";
import { leagueHref, leagueTitle } from "../../../../src/shared/leagues.js";

export type FactId = "opr" | "auto-opr" | "teleop-opr" | "endgame-opr" | "rating" | "report-card" | "next-match" | "events-season" | "events-place"
  | "opr-vs-average" | "reliability" | "schedule" | "league-rank";

export interface FactQuestion {
  id: FactId;
  /** The words naming the team. */
  core: string;
  season: number | null;
  /** A year after every season on record, as typed ("12345 opr 2027"): answered with the "no events yet" card. */
  future?: { season: number; typed: string };
  /** "events in New Jersey", "OPR vs New Jersey average". */
  region: Region | null;
  /** "events in Romania": a whole country (events-place), by its code. */
  country?: { code: string; name: string };
  /** "OPR vs world average". */
  world: boolean;
  /** "OPR vs New Jersey Championship average": the event's words. */
  event: string | null;
  /** "this season" was said: the season is the team's latest with matches, and the card says so (seasonOf). */
  latest?: boolean;
  /** "events played in 2025-26": only the events with a played match (the season's list holds upcoming ones too). */
  played?: boolean;
  /** "in date order", "oldest first": a place's events listed oldest first (they're newest first otherwise). */
  oldestFirst?: boolean;
  /** "events in March": a season's events with a day in that month (0-based), its year the season's. */
  month?: number;
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "In March", "during june 2026": a month, the year optional ("May" only after "in" or "during", as it's a word too). */
const MONTH = /\s(?:in|during)\s+(?:the\s+month\s+of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d\d))?(?=\s)/;
/** A month's calendar year in a season (Sep–Dec its first year, Jan–Aug its second). */
const monthYear = (season: number, month: number) => (month >= 8 ? season : season + 1);

/** "In (date / chronological) order", "oldest first": how a list of events is asked to run. */
const OLDEST_FIRST = /\s(?:in\s+(?:date\s+|chronological\s+)?order|oldest\s+first|chronologically)(?=\s)/;

const PHASE = { "auto-opr": ["auto", "Auto OPR"], "teleop-opr": ["teleop", "TeleOp OPR"], "endgame-opr": ["endgame", "Endgame OPR"] } as const;

// In order: the longer phrases first ("OPR vs … average" before "OPR", "auto OPR" before "OPR").
const RULES: { id: FactId; re: RegExp }[] = [
  { id: "opr-vs-average", re: /\bopr\s+(?:vs\.?|versus|compared\s+(?:to|with)|against)\s+(?:the\s+)?(?<what>.+?)\s+(?:average|avg|mean)\b/ },
  { id: "auto-opr", re: /\b(?:auto|autonomous)\s+opr\b/ },
  { id: "teleop-opr", re: /\b(?:tele-?op|driver[\s-]controlled)\s+opr\b/ },
  { id: "endgame-opr", re: /\bend\s?game\s+opr\b/ },
  { id: "report-card", re: /\b(?:prediction\s+)?report\s+card\b|\bprediction\s+(?:accuracy|record)\b/ },
  // Only the predicted score: "will 12345 win its next match" and "when is 12345's next match" are the asks' own.
  // "Predicted matches" (failed-search #1147): the engine's call on the team's next match, as "next match prediction".
  { id: "next-match", re: /\bpredicted\s+score(?:\s+(?:for\s+)?(?:the\s+|its\s+)?next\s+match)?\b|\bnext\s+match\s+(?:prediction|forecast|predicted\s+score)\b|\bpredicted\s+match(?:es)?\b|\bmatch(?:es)?\s+predictions?\b/ },
  // "reliability rating" is the reliability index, below.
  { id: "rating", re: /(?<!\breliability\s)\b(?:prediction\s+|engine\s+|predicted\s+)?rating\b/ },
  // Search reads plurals as singular ("12345 event in 2025-26"), so both.
  { id: "events-place", re: /\bevents?\s+in\s+(?<what>.+)$/ },
  { id: "events-season", re: /\b(?:events?|competitions?|tournaments?)\b/ },
  { id: "reliability", re: /\breliab(?:ility|le)(?:\s+(?:score|index|rating))?\b|\bdependab(?:ility|le)\b/ },
  { id: "schedule", re: /\b(?:schedule|draw)\s+(?:difficulty|strength|toughness)\b|\b(?:strength|difficulty|toughness)\s+of\s+(?:the\s+|their\s+)?schedule\b/ },
  { id: "league-rank", re: /\bleague\s+(?:rank(?:ing)?|standing|place|position)\b/ },
  // OPR is already a per-match average: "average OPR" asks the same number.
  { id: "opr", re: /\b(?:(?:average|avg|mean)\s+)?opr\b/ },
];

/** The fact `raw` asks about one team, or null. */
export function readTeamFact(raw: string): FactQuestion | null {
  const typed = ` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!,]/g, " ")} `.replace(/\s+/g, " ");
  // How an events list is asked for: its words go, the list keeps them (FactQuestion.played, .oldestFirst).
  const listed = { ...(/\bevents?\s+played\b/.test(typed) ? { played: true } : {}), ...(OLDEST_FIRST.test(typed) ? { oldestFirst: true } : {}) };
  // A month said ("12345 events in March", "in june 2026"): its season is the year's, else the default season (the
  // latest completed one, so the month has happened).
  const mo = MONTH.exec(typed);
  const month = mo ? MONTH_NAMES.findIndex((n) => n.startsWith(mo[1].slice(0, 3))) : -1;
  const monthSeason = mo?.[2] ? Number(mo[2]) - (month >= 8 ? 0 : 1) : null;
  const q = (mo ? typed.replace(mo[0], " ") : typed).replace(OLDEST_FIRST, " ").replace(/\b(events?)\s+played\b/, "$1");
  for (const r of RULES) {
    const m = r.re.exec(q);
    if (!m) continue;
    const what = m.groups?.what?.trim() ?? "";
    // The fact's own words go; the season, if named, is read from what's left ("12345 events in 2025-26").
    const { scope, rest } = readScope(q.replace(m[0], " "));
    if (scope.championship || scope.states || scope.level || scope.alliance || scope.at || scope.ever) return null;
    let region: Region | null = null, world = false, event: string | null = null, country: FactQuestion["country"];
    if (r.id === "opr-vs-average") {
      if (/^(?:world(?:wide)?|global|everyone|all\s+teams|the\s+world)$/.test(what)) world = true;
      else if (!(region = regionOf(what.split(" ")))) event = what;
    }
    if (r.id === "events-place") {
      // "events in 2025-26" names a season, not a place.
      const s = readScope(` events in ${what} `);
      if (s.scope.season != null && !s.rest.replace(/\bevents?\b/, "").trim()) { const core = rest.trim(); return core ? { id: "events-season", core, season: s.scope.season, region: null, world: false, event: null, ...listed, ...(mo ? { month } : {}) } : null; }
      // "events in New Jersey 2024-25", "events in Romania this year": the place, and the season read off it ("this
      // year" is the team's latest season with matches, as every team answer reads it: resolved by the answer).
      const said = s.scope.season;
      const place = said != null || s.scope.latest ? s.rest.replace(/\bevents?\s+in\b/, "").trim() : what;
      region = regionOf(place.split(" "));
      // A whole country ("Romania"): its events, every state or province of it.
      const c = region ? null : countryOf(place);
      if (!region && !c) return null;
      if (said != null) scope.season ??= said;
      else if (s.scope.latest) scope.latest = true;
      if (c) country = { code: c.code, name: c.name };
    }
    // "12345 events" alone is the count, another answer's: the season list needs a season. A question about them
    // ("when is 12345's next event", "what events did 12345 win in 2024") is the asks' own.
    // "This season" is the default season, as the team's other answers read it ("12345 events played this season").
    // A month is a filter on a season's events only: any other answer would drop it.
    if (mo && r.id !== "events-season") return null;
    if (mo) scope.season ??= monthSeason ?? currentSeason();
    // "12345 events this season": the team's latest season with matches, resolved by the answer (seasonOf); said here as
    // "latest" so the answer knows it was asked for.
    if (r.id === "events-season" && scope.season == null && !scope.latest) return null;
    if ((r.id === "events-season" || r.id === "events-place") && /\b(?:when|next|win|won|did|does|what|which|how|where|awards?|upcoming)\b/.test(q)) return null;
    // "past events in michigan", "recent events in nj": a time, not a team ("past" isn't PastaBots), the event sets' own.
    if ((r.id === "events-season" || r.id === "events-place") && /^\s*(?:past|recent|previous|latest|future|coming|all|every|the|list|show)\s*$/.test(rest)) return null;
    // "what does 12345's reliability score mean": the question's own words, never part of the team's name.
    const core = (/^\s*what\b/.test(q) ? rest.replace(/\s(?:mean|means|stand for)\s*$/, " ") : rest).replace(/\b(?:what|whats|what's|is|are|the|of|for|team|ftc|does|did|has|have|its|their)\b/g, " ").replace(/\s+/g, " ").trim();
    // A bare year with nothing else naming a team is the team's number ("2024 reliability").
    const more = { ...(country ? { country } : {}), ...(r.id === "events-season" || r.id === "events-place" ? listed : {}), ...(mo ? { month } : {}) };
    // The month's own year stays its season ("2024 events in march 2024"): the bare year was the team's.
    if (!core && scope.year && scope.season != null) return { id: r.id, core: String(scope.season), season: mo ? (monthSeason ?? currentSeason()) : null, region, world, event, ...more };
    if (!core) return null;
    return { id: r.id, core, season: scope.season, region, world, event, ...more, ...(scope.latest && scope.season == null ? { latest: true } : {}), ...(scope.future ? { future: scope.future } : {}) };
  }
  return null;
}

type Team = { number: number; name: string | null };
const who = (t: Team) => `${t.number}${t.name ? ` ${t.name}` : ""}`;
const dp = (x: number | null | undefined) => (x == null ? "–" : (Math.round(Number(x) * 10) / 10).toFixed(1));
const top = (rank: number, of: number) => `top ${Math.max(1, Math.ceil((100 * rank) / of))}%`;
const n = (x: number) => x.toLocaleString("en-US");
const OPR_RULE = "OPR: the points a team adds to its alliance's score without penalties, its best event that season (as its team page shows). Each phase's OPR is its own best that season, so the phases don't add up to the OPR. Ranks count every team with an OPR that season; each season is a different game, so a number is only set against its own season's.";

/** The season asked, else the team's latest season with official matches (the one season rule, ../season.ts). */
export async function seasonOf(team: number, asked: number | null): Promise<number | null> {
  if (asked != null) return asked;
  return teamSeason(team);
}

/** The newest season the team has a league standing in, from a match played (null: none read from FIRST). */
export async function newestLeagueSeason(team: number): Promise<number | null> {
  const r = await get<{ s: number | null }>("SELECT MAX(season) s FROM league_rankings WHERE team = ? AND COALESCE(played, 1) > 0", [team]);
  return r?.s == null ? null : Number(r.s);
}

/** The answer, or null when it has nothing to stand on (the question is left to search). */
export async function factAnswer(f: FactQuestion, team: Team, findEvent: (words: string, season: number | null) => Promise<{ season: number; code: string; name: string; type: string | null } | null>): Promise<StatAnswer | null> {
  const base = (intent: string, title: string, scope: string[], definition: string, source: string) => ({ family: "stat" as const, intent, title, team, scope, definition, source, blocks: [] as StatBlock[] });
  // The next match needs no played season (a rookie's first event).
  if (f.id === "next-match") {
    const m = await get<any>(`SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, e.name, e.type, mt.alliance FROM match_teams mt JOIN matches m ON m.season = mt.season AND m.code = mt.code AND m.level = mt.level AND m.series = mt.series AND m.number = mt.number
      JOIN events e ON e.season = m.season AND e.code = m.code WHERE mt.team = ? AND m.played = 0 AND (m.time IS NULL OR m.time >= ?) AND COALESCE(e.end, e.start) >= ? ORDER BY COALESCE(m.time, e.start), m.code, m.level, m.series, m.number LIMIT 1`, [team.number, new Date(Date.now() - 6 * 3600e3).toISOString(), new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10)]);
    const b = base("next-match", "Predicted score, next match", [], "The engine's prediction logged before the match: each alliance's expected score (without penalties) and the chance each wins. Shown once the schedule is posted.", "From the posted schedules and the engine's live predictions");
    if (!m) return { ...b, none: `${who(team)} has no upcoming match on a posted schedule. Predict can forecast any alliance in the meantime.`, more: { label: "Open Predict", href: `/predict?teams=${team.number}` } };
    const p = await get<any>("SELECT p_red, red_mean, blue_mean FROM predictions WHERE kind = 'live' AND season = ? AND code = ? AND level = ? AND series = ? AND number = ?", [m.season, m.code, m.level, m.series, m.number]);
    const own = m.alliance === "red" ? "red" : "blue";
    const label = `${m.label} at ${shortEvent(m.name, m.type)}${m.time ? ` · ${String(m.time).slice(0, 16).replace("T", " ")}` : ""}`;
    if (!p) return { ...b, headline: { value: m.label, label, sub: `On ${own}. The prediction is logged shortly before the match; the match page shows it then.`, href: matchHref(m), upcoming: true } };
    const mine = own === "red" ? p.red_mean : p.blue_mean, theirs = own === "red" ? p.blue_mean : p.red_mean;
    const win = own === "red" ? p.p_red : 1 - p.p_red;
    return { ...b, headline: { value: `${Math.round(mine)}–${Math.round(theirs)}`, label, sub: `${own === "red" ? "Red" : "Blue"} (${possessive(who(team))} alliance) ${Math.round(win * 100)}% to win`, href: matchHref(m), upcoming: true },
      blocks: [{ kind: "bars", title: "Predicted scores", groups: [{ label: m.label, items: [{ label: `${own === "red" ? "Red" : "Blue"} (with ${team.number})`, value: Math.round(mine), tone: "a" }, { label: own === "red" ? "Blue" : "Red", value: Math.round(theirs), tone: "b" }] }] }] };
  }

  // A league standing runs through the season, so with no season named it is the team's newest league's (FIRST's
  // league rankings, server/data/leagues.ts), not the latest completed season's final table.
  const leagueSeason = f.id === "league-rank" && f.season == null ? await newestLeagueSeason(team.number) : null;
  const season = leagueSeason ?? await seasonOf(team.number, f.season);
  if (season == null) return { ...base(f.id, "Season numbers", [], OPR_RULE, "From the stored season numbers"), none: `${who(team)} has no season with matches on record.` };
  const S = seasonLabel(season);
  const why = leagueSeason != null ? ` With no season named, the season is ${S}, the team's newest league standing.` : f.season == null ? ` ${seasonWhy(f.latest ? "this" : "team", season, String(team.number))}` : "";

  if (f.id === "opr" || f.id in PHASE) {
    // The team page's own reader (seasonStats, server/api/teams.ts): the same stored row, ranks and population, so the
    // card and /teams/<n>?season=<s> can't drift apart. Nothing is worked out per request.
    const st = await seasonStats(season, team.number);
    const title = f.id === "opr" ? `OPR in ${S}` : `${PHASE[f.id as keyof typeof PHASE][1]} in ${S}`;
    const b = base(f.id, title, [S], `${OPR_RULE}${why}`, `From ${possessive(who(team))} ${S} season numbers`);
    if (!st || st.opr.np.value == null) return { ...b, none: `${who(team)} has no OPR in ${S} yet.` };
    const of = Number(st.opr.np.of) || 0;
    const ph = [["np", "OPR"], ["auto", "Auto"], ["teleop", "TeleOp"], ["endgame", "Endgame"]] as const;
    const key = f.id === "opr" ? "np" : PHASE[f.id as keyof typeof PHASE][0];
    const v = st.opr[key].value, rank = st.opr[key].rank;
    // Formatted as the team page formats them (num, src/shared/format.ts); each item keeps its rank for the tile's bar.
    const kpis: StatBlock = { kind: "kpis", items: ph.map(([k, label]) => ({ label, value: num(st.opr[k].value), phase: k, rank: st.opr[k].rank, of: st.opr[k].of, ...(st.opr[k].rank && of ? { sub: `#${n(Number(st.opr[k].rank))} of ${n(of)}` } : {}), ...(k === key ? { tone: "accent" as const } : {}) })) };
    const blocks: StatBlock[] = [kpis];
    if (f.id === "opr") {
      const evs = await all<any>(`SELECT e.code, e.name, e.type, e.start, s.opr_np FROM team_event_stats s JOIN events e ON e.season = s.season AND e.code = s.code WHERE s.team = ? AND s.season = ? AND s.opr_np IS NOT NULL AND s.matches > 0 ORDER BY e.start, e.code`, [team.number, season]);
      if (evs.length) blocks.push({ kind: "series", title: `OPR by event, ${S}`, points: evs.map((e) => ({ x: shortEvent(e.name, e.type), y: Math.round(Number(e.opr_np) * 10) / 10, href: eventHref(season, e.code, team.number), note: dateRange(e.start) ?? undefined })) });
    }
    return { ...b, headline: { value: num(v), label: rank && of ? `#${n(Number(rank))} of ${n(of)} worldwide · ${top(rank, of)}` : "Not ranked yet", sub: S, href: teamHref(team.number, season) }, blocks };
  }

  if (f.id === "rating") {
    // The team page's own reader (seasonStats), formatted as its rating tile formats it (num: "98 ± 3.2"), the rating,
    // its ± and its world rank first, then its parts.
    const [st, c] = await Promise.all([
      seasonStats(season, team.number),
      get<{ n: number }>("SELECT COUNT(*) n FROM team_season_stats WHERE season = ? AND rating_rank IS NOT NULL", [season]),
    ]);
    const b = base("rating", `Prediction rating in ${S}`, [S], `The prediction rating is the engine's estimate of the points a team adds to its alliance each match (without penalties), with its ± spread, as the team page and Rankings show it; ranked once ${RANKED_MIN_MATCHES} matches are rated. The phases are its auto, TeleOp and endgame parts; penalty points given away are what its fouls hand the other alliance per match.${why}`, `From ${possessive(who(team))} ${S} rating`);
    const r = st?.rating;
    if (!st || !r) return { ...b, none: `${who(team)} has no prediction rating in ${S} yet.` };
    const of = Number(c?.n ?? 0);
    return {
      ...b, headline: { value: `${num(r.np)} ± ${num(r.sd)}`, label: r.rank ? `#${n(r.rank)} worldwide${of ? ` of ${n(of)} rated · ${top(r.rank, of)}` : ""}` : "Not ranked yet", sub: `${r.matches ?? 0} matches rated · ${S}`, href: `/rankings?season=${season}` },
      blocks: [ratingKpis(st, of)],
    };
  }

  if (f.id === "report-card") {
    const rc = await teamReportCards(season, team.number);
    const b = base("report-card", `Prediction report card, ${S}`, [S], `The engine's live calls on ${possessive(who(team))} matches, logged before each match: a call is right when the alliance it favoured won (ties and 50/50 calls don't count), and the miss is the alliance's actual score against the predicted one, per robot.${why}`, `From the live calls logged in ${S}`);
    const s = rc?.season;
    if (!s || !s.calls) return { ...b, none: `No live calls on ${possessive(who(team))} matches in ${S} yet.` };
    const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
    return {
      ...b, headline: { value: `${s.hits} of ${s.decided} right`, label: `${pct(s.decided ? s.hits / s.decided : null)} of decided calls`, sub: `${s.calls} calls, average miss ${dp(s.raw.errAbs)} points a robot` },
      blocks: [
        { kind: "bars", title: "Calls", groups: [{ label: "Calls", items: [{ label: "Right", value: s.hits, tone: "a" }, { label: "Wrong", value: s.decided - s.hits, tone: "d" }, { label: "Not decided", value: s.calls - s.decided, tone: "c" }] }] },
        ...(rc!.events.length ? [{ kind: "table" as const, title: "By event", columns: [{ key: "event", label: "Event" }, { key: "calls", label: "Calls", num: true }, { key: "right", label: "Right" }, { key: "miss", label: "Average miss", num: true }],
          rows: rc!.events.map((e) => ({ cells: { event: e.name ?? e.code, calls: e.calls, right: `${e.hits} of ${e.decided}`, miss: dp(e.raw.errAbs) }, ...(e.code ? { href: eventHref(season, e.code, team.number) } : {}) })) }] : []),
      ],
    };
  }

  if (f.id === "events-season") {
    // "Events played": those the team was on the field at (its record, or surrogate matches off it) or a remote event's
    // matches FIRST counts, never the season's upcoming ones.
    const playedAt = (e: { played: number | null; onField: boolean; qualPlayed: number | null }) => (e.played ?? 0) > 0 || e.onField || (e.qualPlayed ?? 0) > 0;
    // A month: the events with a day in it ("in March" of 2025–26 is March 2026).
    const mon = f.month == null ? null : { from: `${monthYear(season, f.month)}-${String(f.month + 1).padStart(2, "0")}-01`, name: `${MONTH_NAMES[f.month][0].toUpperCase()}${MONTH_NAMES[f.month].slice(1)} ${monthYear(season, f.month)}` };
    const inMonth = (e: { start: string | null; end: string | null }) => !mon || (!!e.start && e.start.slice(0, 7) <= mon.from.slice(0, 7) && (e.end ?? e.start).slice(0, 7) >= mon.from.slice(0, 7));
    const evs = (await teamEvents(season, team.number)).filter((e) => (!f.played || playedAt(e)) && inMonth(e));
    const what = f.played ? "Events played" : "Events";
    const when = mon ? `${mon.name} (${S})` : S;
    const b = base("events-season", `${what} in ${when}`, mon ? [mon.name, S] : [S], `Every event the team is listed for ${mon ? `with a day in ${mon.name}, of the ${S} season` : "that season"}${f.played ? " that it played (on the field, or a remote event's matches)" : ""}, oldest first, with its rank, record and OPR there.${why}`, `From ${possessive(who(team))} ${S} events`);
    if (!evs.length) return { ...b, none: `${who(team)} has no events${f.played ? " played" : ""} in ${when}.` };
    // The best finish among them: the best rank, its event named.
    const best = evs.filter((e) => e.rank != null).sort((x, y) => Number(x.rank) - Number(y.rank))[0];
    return { ...b, headline: { value: `${evs.length} event${evs.length === 1 ? "" : "s"}`, label: when, ...(best ? { sub: `Best finish #${best.rank} at ${shortEvent(best.name, best.type)}` } : {}) },
      blocks: [{ kind: "table", title: `${what} in ${when}`, columns: [{ key: "event", label: "Event" }, { key: "date", label: "Date" }, { key: "rank", label: "Rank", num: true }, { key: "record", label: "W-L-T" }, { key: "opr", label: "OPR", num: true }],
        rows: evs.map((e) => ({ cells: { event: shortEvent(e.name, e.type), date: dateRange(e.start, e.end) ?? "–", rank: e.rank ?? "–", record: e.wins == null ? "–" : `${e.wins}-${e.losses}-${e.ties}`, opr: dp(e.opr.np) }, href: eventHref(season, e.code, team.number) })) }] };
  }

  if (f.id === "events-place" && f.latest && f.season == null) {
    // "This season": the team's latest season with matches (the one season rule, ../season.ts), said on the card.
    const own = await teamSeason(team.number);
    if (own != null) {
      const a = await factAnswer({ ...f, season: own, latest: false }, team, findEvent);
      return a ? { ...a, definition: `${a.definition} ${seasonWhy("this", own, String(team.number))}` } : a;
    }
  }
  if (f.id === "events-place") {
    const country = f.country;
    if (!f.region && !country) return null;
    const r = f.region ?? { name: country!.name };
    // A state or province by its stored codes; a whole country by its code, whatever label FIRST stored for it.
    const sql = `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.country, et.rank FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
      WHERE et.team = ?${f.region ? " AND e.country = ? AND e.state = ?" : ""}${f.season != null ? " AND e.season = ?" : ""} AND ${ATTENDED} ORDER BY e.start ${f.oldestFirst ? "ASC" : "DESC"}, e.code`;
    const evs = (await all<any>(sql, [team.number, ...(f.region ? [f.region.country, f.region.state] : []), ...(f.season != null ? [f.season] : [])]))
      .filter((e) => f.region || countryOf(e.country)?.code === country!.code);
    const in_ = f.season != null ? ` in ${seasonLabel(f.season)}` : "";
    const b = base("events-place", `Events in ${r.name}${in_}`, [r.name, f.season != null ? seasonLabel(f.season) : "All seasons"], `Every event in ${r.name} the team is listed for${in_ || ", every season"}, ${f.oldestFirst ? "oldest" : "newest"} first.`, `From ${possessive(who(team))} events`);
    if (!evs.length) return { ...b, none: `${who(team)} has no events in ${r.name}${in_} on record.` };
    const seasons = new Set(evs.map((e) => Number(e.season)));
    return { ...b, headline: { value: `${evs.length} event${evs.length === 1 ? "" : "s"}`, label: `in ${r.name}, ${seasons.size} season${seasons.size === 1 ? "" : "s"}` },
      blocks: [{ kind: "table", title: `Events in ${r.name}`, columns: [{ key: "season", label: "Season" }, { key: "event", label: "Event" }, { key: "date", label: "Date" }, { key: "rank", label: "Rank", num: true }],
        rows: evs.map((e) => ({ cells: { season: seasonLabel(Number(e.season)), event: shortEvent(e.name, e.type), date: dateRange(e.start, e.end) ?? "–", rank: e.rank ?? "–" }, href: eventHref(Number(e.season), e.code, team.number) })) }] };
  }

  if (f.id === "opr-vs-average") {
    const ev = f.event ? await findEvent(f.event, season) : null;
    if (f.event && !ev) return null;
    const at = ev ? ev.season : season;
    const AT = seasonLabel(at);
    const where = ev ? shortEvent(ev.name, ev.type) : f.region ? f.region.name : "the world";
    const b = base("opr-vs-average", `OPR vs ${ev ? `the ${where} field` : f.region ? `the ${where}` : "the world"} average, ${AT}`, [AT, ev ? where : f.region?.name ?? "Worldwide"],
      ev ? "The team's OPR at the event against the average OPR of the teams that played there (without penalties)." : `The team's season OPR against the average season OPR of ${f.region ? `${possessive(f.region.name)} teams with ${RANKED_MIN_MATCHES}+ matches` : "every team the world OPR ranks count (as the team page's rank does)"} (without penalties). Each season is a different game, so this compares within one season only.${f.season == null ? ` The season is ${AT}, the team's latest with matches.` : ""}`,
      ev ? `From the OPRs at ${where}, ${AT}` : `From the ${AT} season numbers`);
    // At a championship with divisions, the team's own division is its field.
    const own = ev
      ? await get<{ v: number | null; code: string; name?: string; type?: string | null; m?: number; r?: number | null }>("SELECT s.opr_np v, s.code, e.name, e.type FROM team_event_stats s JOIN events e ON e.season = s.season AND e.code = s.code WHERE s.season = ? AND (e.code = ? OR e.division_code = ?) AND s.team = ? AND s.matches > 0 ORDER BY e.division_code IS NULL LIMIT 1", [at, ev.code, ev.code, team.number])
      : await get<{ v: number | null; code: string; name?: string; type?: string | null; m?: number; r?: number | null }>("SELECT opr_np v, '' code, NULL name, NULL type, matches m, rank_np r FROM team_season_stats WHERE season = ? AND team = ?", [at, team.number]);
    if (own?.v == null) return { ...b, none: ev ? `${who(team)} has no OPR at ${where}.` : `${who(team)} has no OPR in ${AT}.` };
    const field = ev
      ? await get<{ avg: number | null; n: number; above: number }>("SELECT AVG(opr_np) avg, COUNT(*) n, SUM(CASE WHEN opr_np > ? THEN 1 ELSE 0 END) above FROM team_event_stats WHERE season = ? AND code = ? AND matches > 0 AND opr_np IS NOT NULL", [own.v, at, own.code])
      : await get<{ avg: number | null; n: number; above: number }>(`SELECT AVG(s.opr_np) avg, COUNT(*) n, SUM(CASE WHEN s.opr_np > ? THEN 1 ELSE 0 END) above FROM team_season_stats s${f.region ? " JOIN teams t ON t.number = s.team" : ""} WHERE s.season = ? AND s.opr_np IS NOT NULL${f.region ? " AND s.matches >= ? AND t.country = ? AND t.state = ?" : " AND s.rank_np IS NOT NULL"}`,
        // Worldwide: the teams the team page's world rank counts (rank_np), so the rank and its population are its own.
        [own.v, at, ...(f.region ? [RANKED_MIN_MATCHES, f.region.country, f.region.state] : [])]);
    if (field?.avg == null || !field.n) return { ...b, none: `No OPRs for ${where} in ${AT}.` };
    const d = Number(own.v) - Number(field.avg);
    const fieldName = own.name ? shortEvent(own.name, own.type ?? null) : where;
    const world = !ev && !f.region;
    const rank = world && own.r != null ? Number(own.r) : Number(field.above) + 1;
    return { ...b, headline: { value: `${d >= 0 ? "+" : "−"}${dp(Math.abs(d))}`, label: `${d >= 0 ? "above" : "below"} the average: ${dp(own.v)} vs ${dp(field.avg)}`, ...(ev || (world ? own.r != null : Number(own.m ?? 0) >= RANKED_MIN_MATCHES) ? { sub: `#${n(rank)} of ${n(Number(field.n))} by OPR · ${top(rank, Number(field.n))}${world ? ` · world average ${dp(field.avg)} across ${n(Number(field.n))} teams` : ""}` } : { sub: world ? "Not ranked worldwide yet" : `Not ranked among them: under ${RANKED_MIN_MATCHES} matches` }) },
      blocks: [{ kind: "bars", title: "OPR against the average", groups: [{ label: `${fieldName[0].toUpperCase()}${fieldName.slice(1)}, ${AT}`, items: [{ label: String(team.number), value: Math.round(Number(own.v) * 10) / 10, tone: "a" }, { label: "Average", value: Math.round(Number(field.avg) * 10) / 10, tone: "c" }] }] }] };
  }

  if (f.id === "reliability") {
    const r = await teamReliability(season, team.number);
    const b = base("reliability", `Reliability in ${S}`, [S], `Reliability (0–100, higher = more dependable), from public match data only: no-shows, disqualifications, near-zero matches (under a tenth of a typical alliance share), how much its contribution swings, the penalty points it gives away against the field's, and how far its scores land from the engine's calls. 1.0× is the field's average for each part.${why}`, `From ${possessive(who(team))} ${S} qualification matches`);
    if (!r) return { ...b, none: `No reliability for ${who(team)} in ${S} yet.` };
    const x = (v: number) => `${v.toFixed(2)}×`;
    const pc = (v: number) => `${Math.round(v * 100)}%`;
    return { ...b, headline: { value: `${r.index}`, label: `out of 100${r.fieldIndex != null ? ` · field average ${r.fieldIndex}` : ""}`, sub: `${r.matches} qualification matches`, href: teamHref(team.number, season) },
      blocks: [
        { kind: "kpis", items: [{ label: "No-shows", value: String(r.noShows), ...(r.noShows ? { tone: "bad" as const } : {}) }, { label: "Disqualified", value: String(r.dqs), ...(r.dqs ? { tone: "bad" as const } : {}) }, { label: "Near-zero matches", value: String(r.nearZero) }, { label: `Last ${r.recent.matches}`, value: `${r.recent.noShows} no-shows`, sub: `${r.recent.nearZero} near zero` }] },
        { kind: "table", title: "Breakdown", columns: [{ key: "part", label: "Part" }, { key: "v", label: "Value", num: true }],
          rows: [["No-show rate", pc(r.parts.noShowRate)], ["Disqualification rate", pc(r.parts.dqRate)], ["Near-zero rate", pc(r.parts.nearZeroRate)], ["Swing", r.parts.swing.toFixed(2)], ["Penalties given away vs field", x(r.parts.penaltyRatio)], ["Miss vs the engine's calls vs field", x(r.parts.predictabilityRatio)]].map(([part, v]) => ({ cells: { part, v } })) },
      ] };
  }

  if (f.id === "schedule") {
    const b = base("schedule", `Schedule difficulty in ${S}`, [S], `Schedule difficulty: at each event, the average prediction rating of the team's qualification opponents minus its partners', against the field's (+ = harder). Rank 1 is the hardest schedule there.${why}`, `From the posted qualification schedules of ${S}`);
    if (!(await isEnabled("scheduleDifficulty").catch(() => false))) return null;
    const rows = (await teamSchedule(season, team.number)).filter((x) => x.full);
    if (!rows.length) return { ...b, none: `No posted qualification schedule for ${who(team)} in ${S}.` };
    const names = new Map((await teamEvents(season, team.number)).map((e) => [e.code, shortEvent(e.name, e.type)]));
    const last = rows[rows.length - 1];
    const sign = (v: number) => `${v >= 0 ? "+" : "−"}${dp(Math.abs(v))}`;
    return { ...b, headline: { value: scheduleWord(last.full!.z), label: `${scheduleRankText(last.full!)} at ${names.get(last.code) ?? last.code}`, sub: `Latest event, ${last.full!.matches} matches` },
      blocks: [{ kind: "table", title: "By event", columns: [{ key: "event", label: "Event" }, { key: "word", label: "Draw" }, { key: "rank", label: "Rank" }, { key: "opp", label: "Opponents", num: true }, { key: "par", label: "Partners", num: true }],
        rows: rows.map((x) => ({ cells: { event: names.get(x.code) ?? x.code, word: scheduleWord(x.full!.z), rank: scheduleRankText(x.full!), opp: sign(x.full!.opponents), par: sign(x.full!.partners) }, href: eventHref(season, x.code, team.number) })) }] };
  }

  // league-rank: FIRST's ranking at a league meet is the league's running standing, out of the teams ranked in that
  // league's meets (its region's: a league code can repeat across regions) this season up to that meet's date (a meet lists only its own teams, so its count alone is too small;
  // a later meet's teams aren't in that standing yet).
  const r = await get<any>(`SELECT e.code, e.name, e.type, e.league, e.start, et.rank, ${LEAGUE_RANKED} n
    FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE et.team = ? AND et.season = ? AND e.type = 'LeagueMeet' AND et.rank IS NOT NULL AND ${ATTENDED} ORDER BY e.start DESC LIMIT 1`, [team.number, season]);
  const b = base("league-rank", `League standing in ${S}`, [S], `A league's standing is FIRST's ranking at the team's latest league meet, which counts every meet so far that season.${why}`, `From the ${S} league meets`);
  // FIRST's whole league table, when the sync has read it (server/data/leagues.ts): the standing is its row, out of the
  // teams that have played, and the table follows with the team's row marked.
  const own = await teamLeagueStanding(season, team.number);
  const table = own ? await leagueStandings(season, own.region, own.code) : null;
  if (own && table?.rows.length) {
    const name = `${leagueTitle(table.name, table.code)}${table.place ? ` (${table.place})` : ""}`;
    const more = { label: "Full league standings", href: `${leagueHref(season, table.region, table.code)}?team=${team.number}` };
    // The table is the whole league's, so its time is the league's latest meet played, not the team's own last meet.
    const latest = table.meets.filter((m) => m.played).sort((x, y) => (y.start ?? "").localeCompare(x.start ?? ""))[0];
    return { ...b, definition: `A league's standing is FIRST's official league ranking, which counts every meet so far that season, ranked by ranking score (RS, average ranking points per match).${why}`, source: `FIRST's ${S} league rankings`,
      // A member with no match yet sits below everyone in FIRST's list: not a place out of the teams that have played.
      headline: { value: table.rows.find((x) => x.team === team.number)?.played ? `#${own.rank} of ${own.of}` : "Not ranked yet", label: latest ? `${name} after ${shortEvent(latest.name, latest.type)}` : name, sub: (latest && dateRange(latest.start)) || undefined, href: more.href },
      blocks: [{ kind: "league", title: `${name} standings`, season, rows: table.rows, team: team.number, more }] };
  }
  if (!r) return { ...b, none: `${who(team)} played no league meets in ${S}.` };
  return { ...b, headline: { value: `#${r.rank}${r.n && r.n >= r.rank ? ` of ${r.n}` : ""}`, label: `${r.league ? `${r.league} league` : "League"} after ${shortEvent(r.name, r.type)}`, sub: dateRange(r.start) ?? undefined, href: eventHref(season, r.code, team.number) } };
}
