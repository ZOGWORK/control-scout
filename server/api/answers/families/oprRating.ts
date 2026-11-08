// One team's OPR and prediction rating, asked a particular way: its rank worldwide or in a place (as the Teams and
// Rankings lists filtered to that place order it), its percentile, its best and worst event OPR, its OPR and rating
// at the FIRST Championship, its average event OPR, one phase against another, its rating's ± spread, its rating
// over the season and its best season rating. Every number is a stored one the team page (or the filtered list)
// already shows: team_season_stats, team_event_stats, the weekly ranking snapshots. Nothing is recomputed here; an
// average of stored event OPRs is the only arithmetic, and it says so.
import { EXCLUDED_TYPES } from "@control-scout/predict-engine";
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { findRegions, regionLabel, type Region } from "../../../../src/shared/regions.js";
import { dateRange, num, possessive, seasonLabel } from "../../../../src/shared/format.js";
import { regionOf } from "../../../../src/shared/searchEventQuery.js";
import { RANKED_MIN_MATCHES, WEEK_MS, weekOf } from "../../../../src/shared/rankings.js";
import { RECORDS_MAX_PAGE_SIZE, type TeamSeasonRecord } from "../../../../src/shared/statCatalog.js";
import { all, get } from "../../../db.js";
import { regionPlace } from "../../rankings.js";
import { listRecords, recordsQuery } from "../../records.js";
import { seasonStats } from "../../teams.js";
import type { TeamEvent, TeamSeason } from "../eventSet.js";
import { CHAMPIONSHIP_TYPE } from "../clauses.js";
import { eventHref, teamHref } from "../matchSet.js";
import { readScope } from "../read.js";
import { BOARD_STATS, teamsHref } from "./leaderboard.js";
import { seasonTrend, trendAnswer } from "./trends.js";

export type OprRatingId =
  | "penalty-opr" | "opr-worlds" | "rating-worlds" | "opr-high" | "opr-low" | "opr-trend" | "opr-rank" | "opr-breakdown"
  | "opr-average-events" | "phase-vs" | "opr-vs-team-average" | "rating-rank" | "rating-sd" | "rating-trend" | "rating-best"
  | "rank" | "percentile" | "top-pct";

type Phase = "auto" | "teleop" | "endgame";

export interface OprRatingQuestion {
  id: OprRatingId;
  /** The words naming the team. */
  core: string;
  season: number | null;
  /** "in New Jersey", "on the New Jersey leaderboard": ranked within that place's list. */
  region: Region | null;
  /** "ever", "all time": every season. */
  ever: boolean;
  /** "this season": the team's latest season with matches, even when none is named. */
  latest?: boolean;
  /** "auto OPR versus TeleOp OPR": the two phases, as asked. */
  phases?: [Phase, Phase];
  /** "in the top 10 percent": the share asked about. */
  pct?: number;
}

const PHASE_WORD = String.raw`(auto(?:nomous)?|tele-?op|driver[\s-]controlled|end\s?game)`;
const phaseOf = (w: string): Phase => (/^auto/.test(w) ? "auto" : /^end/.test(w) ? "endgame" : "teleop");
const PHASE_NAME: Record<Phase, string> = { auto: "Auto", teleop: "TeleOp", endgame: "Endgame" };

// In order: the more specific first. Each takes its own words out; what's left names the team (and maybe a place).
const RULES: { id: OprRatingId; re: RegExp }[] = [
  { id: "phase-vs", re: new RegExp(String.raw`\b${PHASE_WORD}(?:\s+opr)?\s+(?:vs\.?|versus|compared\s+(?:to|with)|against|or)\s+${PHASE_WORD}(?:\s+opr)?\b`) },
  { id: "opr-vs-team-average", re: /\bopr\s+(?:vs\.?|versus|compared\s+(?:to|with)|against)\s+(?:the\s+|an?\s+)?(?:average|avg|mean|typical)\s+(?:ftc\s+)?teams?\b/ },
  { id: "penalty-opr", re: /\bpenalt(?:y|ies)\s+opr\b|\bopr\s+penalt(?:y|ies)\b/ },
  { id: "opr-trend", re: /\bopr\s+(?:trend|history|progression)\s+(?:over|across|by|through)\s+(?:the\s+)?(?:seasons|years)\b|\bopr\s+(?:over|across)\s+(?:the\s+)?(?:seasons|years)\b/ },
  { id: "opr-high", re: /\bopr\s+(?:at\s+)?(?:their|its|his|her|the)\s+best\s+(?:event|competition|meet)\b|\b(?:highest|best|top|max(?:imum)?|peak)\s+(?:event\s+)?opr\b(?!\s+(?:event|competition|meet|team))/ },
  { id: "opr-low", re: /\bopr\s+(?:at\s+)?(?:their|its|his|her|the)\s+worst\s+(?:event|competition|meet)\b|\b(?:lowest|worst|min(?:imum)?)\s+(?:event\s+)?opr\b(?!\s+(?:event|competition|meet|team))/ },
  { id: "opr-average-events", re: /\b(?:average|avg|mean)\s+(?:event\s+)?opr\s+(?:across|over|at|per|of)\s+(?:all\s+)?(?:(?:its|their|the)\s+)?events?\b|\b(?:average|avg|mean)\s+opr\s+(?:per|by)\s+event\b/ },
  { id: "opr-breakdown", re: /\b(?:component|phase|part)s?\s+opr(?:\s+(?:breakdown|split))?\b|\bopr\s+(?:breakdown|split|by\s+phase|components?|parts?)\b/ },
  { id: "percentile", re: /\bpercentile\b/ },
  { id: "top-pct", re: /\b(?:in\s+)?(?:the\s+)?top\s+(\d{1,2})\s*(?:%(?=\s|$)|(?:percent|per\s+cent|pct)\b)/ },
  { id: "opr-rank", re: /(?<!\b(?:auto(?:nomous)?|tele-?op|end\s?game|controlled)\s)\bopr\s+(?:rank(?:ing)?|place|position|standing)\b|\brank(?:ed|ing)?\s+by\s+opr\b/ },
  { id: "rating-sd", re: /\b(?:prediction|rating|engine)\s+(?:rating\s+)?(?:uncertainty|confidence|spread|error\s+bars?|margin\s+of\s+error)\b|\buncertainty\s+(?:on|of|in)\s+(?:the\s+|its\s+|their\s+)?(?:prediction\s+)?rating\b/ },
  { id: "rating-trend", re: /\b(?:prediction\s+)?rating\s+(?:trend|history|over\s+time|progression|by\s+(?:event|week)|graph|chart)\b/ },
  { id: "rating-best", re: /\b(?:best|highest|peak|top|max(?:imum)?)\s+(?:prediction\s+|engine\s+)?rating\b/ },
  { id: "rating-rank", re: /\b(?:prediction\s+)?rating\s+(?:rank(?:ing)?|place|position|standing)\b|\brank(?:ed|ing)?\s+by\s+(?:prediction\s+)?rating\b/ },
  // "12345 rating in New Jersey": its place on that region's rankings (a season after "in" is the rating card's own).
  { id: "rating-rank", re: /\b(?:prediction\s+)?rating(?=\s+(?:in|on|across|within)\s)/ },
  { id: "rank", re: /\b(?:rank(?:ing)?|place|position|standing)\b/ },
];

const WORLD = /\b(?:world\s?wide|globally|global|in\s+the\s+world|world)\b/;
const PLACE = /\b(?:in|on|across|within|for)\s+(?:the\s+)?(?<place>[a-z][a-z .'-]*?)(?:\s+(?:leaderboard|rankings?|list|teams?))?\s*$/;
const FILLER = /\b(?:what|whats|is|are|was|the|of|for|team|ftc|does|did|has|have|its|their|his|her|in|on|at|by|to|a|an|how|where|does|do|leaderboard|rankings?|list|across|events?|this|season|opr|rating|prediction|overall)\b/g;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The question `raw` asks about one team's OPR or rating, or null. */
export function readOprRating(raw: string): OprRatingQuestion | null {
  const q = ` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!,]/g, " ")} `.replace(/\s+/g, " ");
  for (const r of RULES) {
    const m = r.re.exec(q);
    if (!m) continue;
    // The generic "rank" names no stat: taken only for a place or the world ("12345 rank worldwide", "12345 place on
    // the New Jersey leaderboard"), and never beside a stat word another rule or answer reads ("12345 endgame opr
    // rank", "12345 rank at the New Jersey Championship").
    if (r.id === "rank" && (/\b(?:opr|rating|auto|tele-?op|end\s?game|score|record|award|match|qual|finish|average|avg|mean|best|worst|highest|lowest|league|event|seed)/.test(q) || /\bat\s/.test(q))) continue;
    if (r.id === "rating-rank" && /\bat\s/.test(q)) continue;
    // A top share or a percentile with no stat named is by OPR (the team page's standing); a rating one isn't read.
    if ((r.id === "top-pct" || r.id === "percentile") && /\brating\b/.test(q)) return null;
    let rest = q.replace(m[0], " ");
    const world = WORLD.test(rest);
    rest = rest.replace(WORLD, " ");
    const { scope, rest: left } = readScope(rest);
    // A match type, a colour, an event, a place of events or Worlds can't apply to these season numbers: left to the
    // other answers.
    if (scope.level || scope.alliance || scope.states || scope.at || scope.championship || scope.place || scope.outOfState) return null;
    const id = r.id;
    let words = left;
    let region: Region | null = null;
    const p = PLACE.exec(` ${words} `);
    if (p?.groups?.place) {
      const found = regionOf(p.groups.place.trim().split(" "));
      if (found) { region = found; words = ` ${words} `.replace(p[0], " "); }
    }
    // A region is for a rank; "12345 rating in New Jersey" is its place on that region's ranking.
    if (region && !["opr-rank", "rating-rank", "rank", "opr-vs-team-average"].includes(id)) return null;
    if (world && region) return null;
    // A rank with no stat and no place named ("12345 rank", "<team> ranking") is its world rank, as "worldwide" says.
    if (id === "rating-rank" && !region && !/\b(?:rank|place|position|standing)/.test(m[0])) return null;
    const core = squash(words.replace(FILLER, " ").replace(/\b(?:highest|lowest|best|worst|average|vs|versus|compared|with|percent|top)\b/g, " "));
    if (!core) return null;
    // An average of event OPRs stays in one season (each is a different game).
    if (id === "opr-average-events" && scope.ever) return null;
    const phases = r.id === "phase-vs" ? [phaseOf(m[1]), phaseOf(m[2])] as [Phase, Phase] : undefined;
    if (phases && phases[0] === phases[1]) return null;
    const pct = r.id === "top-pct" ? Number(m[1]) : undefined;
    if (pct != null && (pct < 1 || pct > 99)) return null;
    return { id, core, season: scope.season, region, ever: scope.ever, ...(phases ? { phases } : {}), ...(pct != null ? { pct } : {}) };
  }
  // "12345 opr at worlds", "12345 rating at the first championship": the OPR or the rating, Worlds only.
  const { scope, rest } = readScope(q);
  if (scope.championship && !scope.at && !scope.level && !scope.alliance) {
    const which = /\bopr\b/.test(rest) && !/\b(?:auto|tele-?op|end\s?game|rank|vs|versus)\b/.test(rest) ? "opr-worlds" : /\brating\b/.test(rest) && !/\b(?:rank|vs|versus)\b/.test(rest) ? "rating-worlds" : null;
    const core = which ? squash(rest.replace(FILLER, " ")) : "";
    if (which && core) return { id: which, core, season: scope.season, region: null, ever: scope.ever, ...(scope.latest ? { latest: true } : {}) };
  }
  return null;
}

/** Titles for the search page's "understood" line. */
export const OPR_RATING_TITLES: Record<OprRatingId, string> = {
  "penalty-opr": "Penalty points given away", "opr-worlds": "OPR at Worlds", "rating-worlds": "Prediction rating at Worlds", "opr-high": "Highest event OPR", "opr-low": "Lowest event OPR",
  "opr-trend": "OPR trend", "opr-rank": "OPR rank", "opr-breakdown": "OPR by phase", "opr-average-events": "Average event OPR", "phase-vs": "Phase against phase",
  "opr-vs-team-average": "OPR vs the average", "rating-rank": "Prediction rating rank", "rating-sd": "Prediction rating uncertainty", "rating-trend": "Prediction rating trend",
  "rating-best": "Best prediction rating", rank: "Rank", percentile: "OPR percentile", "top-pct": "Top share by OPR",
};

type Team = { number: number; name: string | null };
const who = (t: Team) => `${t.number}${t.name ? ` ${t.name}` : ""}`;
const n = (x: number) => x.toLocaleString("en-US");
const topPct = (rank: number, of: number) => Math.max(1, Math.ceil((100 * rank) / of));
const ordinal = (x: number) => `${x}${x % 100 >= 11 && x % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][x % 10] ?? "th"}`;
const rankingsHref = (season: number, region: Region | null) => `/rankings?season=${season}${region ? `&region=${encodeURIComponent(region.key)}` : ""}`;

const OPR_RULE = "OPR: the points a team adds to its alliance's score without penalties, its best event that season, as its team page shows. Ranks count every team with an OPR that season; each season is a different game, so a number is only set against its own season's.";
const RATING_RULE = `The prediction rating is the engine's estimate of the points a team adds to its alliance each match (without penalties), with its ± spread (the engine's uncertainty, which narrows as matches are rated), as the team page and Rankings show it; ranked once ${RANKED_MIN_MATCHES} matches are rated.`;
const PLACE_RULE = (r: Region, by: "opr" | "rating") => by === "opr"
  ? `Place in ${r.name}: the team's position on the Teams list filtered to ${r.name} and sorted by OPR, which counts teams from there with ${RANKED_MIN_MATCHES}+ matches that season (ties: more wins first).`
  : `Place in ${r.name}: the team's position on Rankings filtered to ${r.name}, by prediction rating (teams rated on ${RANKED_MIN_MATCHES}+ matches).`;

/** The world rank and population by rating, as the team page states it. */
async function ratingPop(season: number): Promise<number> {
  return Number((await get<{ n: number }>("SELECT COUNT(*) n FROM team_season_stats WHERE season = ? AND rating_rank IS NOT NULL", [season]))?.n ?? 0);
}

/** The team's place on a region's OPR list: the Teams page's own season table (../../records.ts listRecords), read
 *  with the very query the answer links to (its filter, sort and place), so the place, the count and the teams
 *  around it are that list's. */
async function regionOprPlace(season: number, team: number, r: Region): Promise<{ rank: number; of: number; near: { rank: number; team: number; name: string | null; v: number }[] } | null> {
  const href = teamsHref(season, BOARD_STATS.opr, r);
  if (!href) return null;
  const p = new URLSearchParams(href.split("?")[1]);
  const opr = BOARD_STATS.opr.teamsSort!;
  const ask = (page: number) => listRecords(season, recordsQuery("teamSeason", { filter: p.get("filter"), sort: p.get("sort"), country: p.get("country"), state: p.get("state"), fields: `teamName,${opr}`, page: String(page), pageSize: String(RECORDS_MAX_PAGE_SIZE) }));
  const rows: { team: number; name: string | null; v: number }[] = [];
  for (let page = 1; ; page++) {
    const res = await ask(page);
    rows.push(...(res.rows as TeamSeasonRecord[]).map((x) => ({ team: Number(x.team), name: (x.stats.teamName as string | null) ?? null, v: Number(x.stats[opr]) })));
    // Stop once the team and the two below it are read, or the list ends.
    const i = rows.findIndex((x) => x.team === team);
    if ((i >= 0 && rows.length >= i + 3) || rows.length >= res.total || !res.rows.length) {
      if (i < 0) return null;
      const from = Math.max(0, Math.min(i - 2, rows.length - 5));
      return { rank: i + 1, of: res.total, near: rows.slice(from, from + 5).map((x, k) => ({ rank: from + k + 1, team: x.team, name: x.name, v: x.v })) };
    }
  }
}

export interface OprRatingDeps {
  /** The team's events and seasons as its page holds them (../eventSet.ts). */
  set: () => Promise<{ events: TeamEvent[]; seasons: TeamSeason[] }>;
  /** The season used when none is named (the team's latest with matches). */
  season: () => Promise<number | null>;
  /** The OPR answer and the OPR-vs-average answer (./facts.ts), for the answers that are those with a twist. */
  oprCard: (season: number | null) => Promise<StatAnswer | null>;
  worldAverage: (season: number | null, region: Region | null) => Promise<StatAnswer | null>;
}

/** The answer, or null when the question is left to search. */
export async function oprRatingAnswer(f: OprRatingQuestion, team: Team, deps: OprRatingDeps): Promise<StatAnswer | null> {
  const asked = f.season;
  const base = (intent: string, title: string, scope: string[], definition: string, source: string): StatAnswer => ({ family: "stat", intent, title, team, scope, definition, source, blocks: [] });

  if (f.id === "opr-vs-team-average") return deps.worldAverage(asked, f.region);

  if (f.id === "opr-breakdown") {
    const card = await deps.oprCard(asked);
    if (!card) return null;
    return { ...card, intent: "opr-breakdown", title: card.title.replace(/^OPR in /, "OPR by phase in "), definition: `${card.definition} The phases are the team page's Autonomous, TeleOp and Endgame OPRs.` };
  }

  if (f.id === "opr-trend") {
    const set = await deps.set();
    const latest = asked ?? (await deps.season());
    const ev = trendAnswer("opr-history", team, set, { season: latest });
    if (!ev) return null;
    const seasons = seasonTrend("opr-by-season", team, set.seasons);
    const blocks = [...ev.blocks.filter((b) => b.kind !== "links"), ...seasons.blocks.filter((b) => b.kind === "table").map((b) => ({ ...b, title: "OPR standing by season (a different game each year)" }))];
    return { ...ev, intent: "opr-trend", title: ev.title.replace(/^OPR by event/, "OPR trend, event by event"), definition: `${ev.definition} Each season is a different game, so the seasons are set side by side by OPR standing (rank among every team with an OPR), never by raw OPR.`, blocks };
  }

  const season = asked ?? (await deps.season());
  const S = season != null ? seasonLabel(season) : "";
  const why = asked == null && season != null ? ` The season is ${S}, the team's latest with matches.` : "";

  if (f.id === "opr-high" || f.id === "opr-low" || f.id === "opr-average-events" || f.id === "opr-worlds" || f.id === "rating-worlds") {
    const set = await deps.set();
    const played = set.events.filter((e) => e.matches > 0 && e.opr != null);
    if (f.id === "opr-worlds" || f.id === "rating-worlds") return worldsAnswer(f, team, set, asked ?? (f.latest ? season : null), season);
    const every = f.ever && asked == null;
    const evs = every ? played : played.filter((e) => e.season === season);
    const scopeChips = [every ? "All seasons" : S, "Event OPRs"];
    const where = every ? "every season" : S;
    if (f.id === "opr-average-events") {
      const b = base("opr-average-events", `Average event OPR in ${S}`, [S, "Every event"], `The average of the team's OPR at each event it played in ${S} (each event's OPR as its team page lists it, every event counted once). The season OPR is its best event, not this average.${why}`, `From ${possessive(who(team))} ${S} event OPRs`);
      if (!evs.length) return { ...b, none: `${who(team)} has no event OPR in ${S || "any season"}.` };
      const avg = evs.reduce((s, e) => s + (e.opr ?? 0), 0) / evs.length;
      const matches = evs.reduce((s, e) => s + e.matches, 0);
      const st = season != null ? await seasonStats(season, team.number) : null;
      return {
        ...b, headline: { value: num(avg), label: `average OPR across ${evs.length} event${evs.length === 1 ? "" : "s"}`, sub: `${matches} qualification matches · season OPR ${num(st?.opr.np.value)} (its best event)`, href: teamHref(team.number, season) },
        blocks: [eventTable(evs, team, false, `Each event, ${S}`)],
      };
    }
    const high = f.id === "opr-high";
    const b = base(f.id, `${high ? "Highest" : "Lowest"} event OPR${every ? ", every season" : ` in ${S}`}`, scopeChips,
      `The team's OPR at each event it played (without penalties, as its team page lists it), ${high ? "highest" : "lowest"} first.${every ? " Every season is a different game, so the season is named beside each number." : why}`,
      `From ${evs.length} event OPR${evs.length === 1 ? "" : "s"}, ${where}`);
    if (!evs.length) return { ...b, none: `${who(team)} has no event OPR in ${every ? "any season" : S}.` };
    const sorted = [...evs].sort((a, c) => (high ? (c.opr ?? 0) - (a.opr ?? 0) : (a.opr ?? 0) - (c.opr ?? 0)));
    const e = sorted[0];
    return {
      ...b, headline: { value: num(e.opr), label: `at ${e.name}`, sub: [seasonLabel(e.season), dateRange(e.start, e.end), `${e.matches} matches`].filter(Boolean).join(" · "), href: eventHref(e.season, e.code, team.number) },
      blocks: [
        { kind: "kpis", items: [{ label: "OPR", value: num(e.opr), phase: "np" as const }, { label: "Auto", value: num(e.auto), phase: "auto" as const }, { label: "TeleOp", value: num(e.teleop), phase: "teleop" as const }, { label: "Endgame", value: num(e.endgame), phase: "endgame" as const }] },
        eventTable(sorted, team, every, every ? "Every event, by OPR" : `Each event, ${S}, by OPR`),
      ],
    };
  }

  if (season == null) return { ...base(f.id, "Season numbers", [], OPR_RULE, "From the stored season numbers"), none: `${who(team)} has no season with matches on record.` };
  const st = await seasonStats(season, team.number);

  if (f.id === "phase-vs") {
    const [a, c] = f.phases!;
    const b = base("phase-vs", `${PHASE_NAME[a]} OPR vs ${PHASE_NAME[c]} OPR in ${S}`, [S], `${OPR_RULE} Each phase's OPR is its own best that season, so the phases don't add up to the OPR.${why}`, `From ${possessive(who(team))} ${S} season numbers`);
    const va = st?.opr[a].value, vc = st?.opr[c].value;
    if (va == null || vc == null) return { ...b, none: `${who(team)} has no ${PHASE_NAME[a]} and ${PHASE_NAME[c]} OPR in ${S} yet.` };
    const d = Number(va) - Number(vc);
    const ph = (k: "np" | Phase, label: string) => ({ label, value: num(st!.opr[k].value), phase: k, rank: st!.opr[k].rank, of: st!.opr[k].of, ...(k === a || k === c ? { tone: "accent" as const } : {}) });
    return {
      ...b, headline: { value: `${num(va)} vs ${num(vc)}`, label: `${PHASE_NAME[a]} ${Math.abs(d) < 0.05 ? "level with" : d > 0 ? `${num(Math.abs(d))} above` : `${num(Math.abs(d))} below`} ${PHASE_NAME[c]}`, sub: S, href: teamHref(team.number, season) },
      blocks: [
        // The phase tiles in the team page's phase colours (a bar block's tones aren't the phase colours).
        { kind: "kpis", items: [ph("np", "OPR"), ph("auto", "Auto"), ph("teleop", "TeleOp"), ph("endgame", "Endgame")] },
      ],
    };
  }

  if (f.id === "penalty-opr") {
    const b = base("penalty-opr", `Penalty points given away in ${S}`, [S], `Penalty points given away: the prediction rating's penalty part, as the team page's rating line shows it, the points its fouls hand the other alliance per match (lower is better). OPR itself leaves penalties out.${why}`, `From ${possessive(who(team))} ${S} rating`);
    const r = st?.rating;
    if (!r || r.pen == null) return { ...b, none: `${who(team)} has no prediction rating in ${S} yet, so no penalty figure.` };
    return {
      ...b, headline: { value: num(r.pen), label: "penalty points given away per match", sub: `${r.matches ?? 0} matches rated · ${S}`, href: teamHref(team.number, season) },
      blocks: [ratingKpis(st!, await ratingPop(season))],
    };
  }

  if (((f.id === "opr-rank" || f.id === "rank") && !f.region) || f.id === "percentile" || f.id === "top-pct") {
    const o = st?.opr.np;
    const of = Number(o?.of) || 0, rank = Number(o?.rank) || 0;
    const card = await deps.oprCard(season);
    const titles: Record<string, string> = { "opr-rank": `OPR rank in ${S}`, percentile: `OPR percentile in ${S}`, "top-pct": `Top ${f.pct}% by OPR in ${S}?`, rank: `World rank in ${S}` };
    const b = base(f.id, titles[f.id], [S, "Worldwide"], `${OPR_RULE}${f.id === "percentile" || f.id === "top-pct" ? " Top share: the rank over every team with an OPR, rounded up (#612 of 8,308 is top 8%); percentile: the share of those teams ranked below it." : ""}${f.id === "rank" ? ` ${RATING_RULE}` : ""}${why}`, `From ${possessive(who(team))} ${S} season numbers`);
    if (!o || o.value == null || !rank || !of) return { ...b, none: `${who(team)} has no OPR rank in ${S} yet.` };
    const t = topPct(rank, of);
    const pctl = Math.floor((100 * (of - rank)) / of);
    const blocks: StatBlock[] = [];
    if (f.id === "rank") blocks.push(rankKpis(st!, await ratingPop(season), null, null));
    blocks.push(...(card?.blocks ?? []).filter((x) => x.kind === "kpis"));
    // Its place on the world OPR list: the teams just above and below it ("who is ranked just above 12345").
    if (f.id === "rank" || f.id === "opr-rank") {
      const near = await all<{ team: number; name: string | null; opr: number; rank: number }>(
        `SELECT s.team, t.name, s.opr_np opr, s.rank_np rank FROM team_season_stats s LEFT JOIN teams t ON t.number = s.team
         WHERE s.season = ? AND s.rank_np BETWEEN ? AND ? AND s.opr_np IS NOT NULL ORDER BY s.rank_np, s.team`, [season, Math.max(1, rank - 2), rank + 2]);
      if (near.length > 1) blocks.push({ kind: "table", title: "Nearby worldwide by OPR", columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "opr", label: "OPR", num: true }],
        rows: near.map((x) => ({ cells: { rank: Number(x.rank), team: `${x.team} ${x.name ?? ""}`.trim(), opr: num(Number(x.opr)) }, href: teamHref(Number(x.team), season), strong: Number(x.team) === team.number })) });
    }
    const at = `#${n(rank)} of ${n(of)}`;
    const headline = f.id === "percentile"
      ? { value: `Top ${t}%`, label: `worldwide by OPR: ${at} · ${ordinal(pctl)} percentile`, sub: `OPR ${num(o.value)} · ${S}` }
      : f.id === "top-pct"
        ? { value: t <= f.pct! ? "Yes" : "No", label: `top ${t}% worldwide by OPR: ${at}`, sub: `OPR ${num(o.value)} · ${S}` }
        : f.id === "rank"
          ? { value: at, label: `worldwide by OPR · top ${t}%`, sub: st?.rating?.rank ? `#${n(st.rating.rank)} worldwide by prediction rating · ${S}` : S }
          : { value: at, label: `worldwide by OPR · top ${t}%`, sub: `OPR ${num(o.value)} · ${S}` };
    return { ...b, headline: { ...headline, href: teamHref(team.number, season) }, blocks };
  }

  if (f.id === "rating-rank" || f.id === "rating-sd") {
    const r = st?.rating;
    const pop = await ratingPop(season);
    if (f.region) return regionAnswer(f, team, season, st, pop, why, "rating");
    const b = base(f.id, f.id === "rating-sd" ? `Prediction rating uncertainty in ${S}` : `Prediction rating rank in ${S}`, [S, ...(f.id === "rating-rank" ? ["Worldwide"] : [])], `${RATING_RULE}${why}`, `From ${possessive(who(team))} ${S} rating`);
    if (!r) return { ...b, none: `${who(team)} has no prediction rating in ${S} yet.` };
    const headline = f.id === "rating-sd"
      ? { value: `± ${num(r.sd)}`, label: `uncertainty on its ${num(r.np)} prediction rating`, sub: `${r.matches ?? 0} matches rated in ${S}` }
      : r.rank
        ? { value: `#${n(r.rank)}`, label: `worldwide by prediction rating${pop ? ` · of ${n(pop)} rated · top ${topPct(r.rank, pop)}%` : ""}`, sub: `${num(r.np)} ± ${num(r.sd)} · ${S}` }
        : { value: "Not ranked yet", label: `under ${RANKED_MIN_MATCHES} matches rated`, sub: `${num(r.np)} ± ${num(r.sd)} · ${S}` };
    return { ...b, headline: { ...headline, href: rankingsHref(season, null) }, blocks: [ratingKpis(st!, pop)] };
  }

  if (f.id === "rank" || f.id === "opr-rank") return regionAnswer(f, team, season, st, await ratingPop(season), why, f.id === "rank" ? "both" : "opr");

  if (f.id === "rating-trend") return ratingTrend(team, season, await deps.set(), st, why);

  if (f.id === "rating-best") {
    const set = await deps.set();
    const rated = set.seasons.filter((s) => s.rating != null && (asked == null || s.season === asked));
    const b = base("rating-best", asked == null ? "Best prediction rating, every season" : `Prediction rating in ${S}`, [asked == null ? "All seasons" : S], `${RATING_RULE} A season's rating is the engine's at the end of that season (after its last event), as the team page shows each season. Ratings carry over from one season to the next, but each season is a different game.`, `From ${rated.length} season rating${rated.length === 1 ? "" : "s"}`);
    if (!rated.length) return { ...b, none: `${who(team)} has no prediction rating on record.` };
    const best = [...rated].sort((a, c) => (c.rating ?? 0) - (a.rating ?? 0))[0];
    const last = set.events.filter((e) => e.season === best.season && e.matches > 0).at(-1);
    const bs = await seasonStats(best.season, team.number);
    return {
      ...b, headline: { value: `${num(best.rating)}${bs?.rating?.sd != null ? ` ± ${num(bs.rating.sd)}` : ""}`, label: `${seasonLabel(best.season)} season rating${last ? `, after ${last.name}` : ""}`, sub: [last ? dateRange(last.start, last.end) : null, best.ratingRank ? `#${n(best.ratingRank)} worldwide that season` : null].filter(Boolean).join(" · "), href: teamHref(team.number, best.season) },
      blocks: [{ kind: "table", title: "Season ratings", columns: [{ key: "season", label: "Season" }, { key: "rating", label: "Rating", num: true }, { key: "rank", label: "World rank" }],
        rows: [...rated].reverse().map((s) => ({ cells: { season: seasonLabel(s.season), rating: num(s.rating), rank: s.ratingRank ? `#${n(s.ratingRank)}` : "–" }, href: teamHref(team.number, s.season), strong: s === best })) }],
    };
  }
  return null;
}

/** The team's numbers by rating, leading with the rating and its ± and world rank, as the team page's rating tile. */
export function ratingKpis(st: NonNullable<Awaited<ReturnType<typeof seasonStats>>>, pop: number): StatBlock {
  const r = st.rating!;
  return { kind: "kpis", items: [
    { label: "Prediction rating", value: `${num(r.np)} ± ${num(r.sd)}`, sub: r.rank ? `#${n(r.rank)} worldwide${pop ? ` of ${n(pop)}` : ""}` : "Not ranked yet", tone: "accent" },
    { label: "Auto", value: num(r.auto) }, { label: "TeleOp", value: num(r.teleop) }, { label: "Endgame", value: num(r.endgame) },
    { label: "Penalty points given away", value: num(r.pen), sub: "per match" }, { label: "Matches rated", value: String(r.matches ?? 0) },
  ] };
}

/** The OPR and rating ranks side by side: worldwide, and in a place when asked. */
function rankKpis(st: NonNullable<Awaited<ReturnType<typeof seasonStats>>>, pop: number, region: Region | null, place: { opr: { rank: number; of: number } | null; rating: { rank: number; of: number } | null } | null, by: "opr" | "rating" | "both" = "both"): StatBlock {
  const o = st.opr.np, r = st.rating;
  return { kind: "kpis", items: [
    ...(region && place && by !== "opr" ? [
      { label: `${region.name} by rating`, value: place.rating ? `#${n(place.rating.rank)} of ${n(place.rating.of)}` : "Not ranked", sub: r ? `${num(r.np)} ± ${num(r.sd)}` : undefined, tone: "accent" as const },
    ] : []),
    ...(region && place && by !== "rating" ? [
      { label: `${region.name} by OPR`, value: place.opr ? `#${n(place.opr.rank)} of ${n(place.opr.of)}` : "Not ranked", sub: `OPR ${num(o.value)}`, ...(by === "opr" ? { tone: "accent" as const } : {}) },
    ] : []),
    { label: "Worldwide by OPR", value: o.rank && o.of ? `#${n(o.rank)} of ${n(o.of)}` : "Not ranked", sub: o.rank && o.of ? `OPR ${num(o.value)} · top ${topPct(o.rank, o.of)}%` : `OPR ${num(o.value)}` },
    { label: "Worldwide by rating", value: r?.rank ? `#${n(r.rank)}${pop ? ` of ${n(pop)}` : ""}` : "Not ranked", sub: r ? `${num(r.np)} ± ${num(r.sd)}` : undefined },
  ] };
}

/** A place's rank: by OPR (the Teams list), by rating (Rankings) or both, with the nearby teams on the OPR list. */
async function regionAnswer(f: OprRatingQuestion, team: Team, season: number, st: Awaited<ReturnType<typeof seasonStats>>, pop: number, why: string, by: "opr" | "rating" | "both"): Promise<StatAnswer | null> {
  const r = f.region;
  const S = seasonLabel(season);
  if (!r) return null;
  const [opr, rating] = await Promise.all([
    by !== "rating" ? regionOprPlace(season, team.number, r) : Promise.resolve(null),
    by !== "opr" ? regionPlace(season, team.number, { country: r.country, state: r.state }) : Promise.resolve(null),
  ]);
  const what = by === "opr" ? "OPR" : by === "rating" ? "prediction rating" : "rank";
  const title = by === "both" ? `Place in ${r.name}, ${S}` : `${by === "opr" ? "OPR" : "Prediction rating"} rank in ${r.name}, ${S}`;
  const b: StatAnswer = {
    family: "stat", intent: by === "both" ? "region-rank" : `${by}-region-rank`, title, team, scope: [r.name, S],
    definition: `${by !== "rating" ? PLACE_RULE(r, "opr") : ""}${by === "both" ? " " : ""}${by !== "opr" ? PLACE_RULE(r, "rating") : ""} ${by === "opr" ? OPR_RULE : RATING_RULE}${why}`.trim(),
    source: `From the ${S} season numbers of ${r.name} teams`, blocks: [],
    more: by === "opr" ? { label: `View the ${r.name} list on the Teams page`, href: teamsHref(season, BOARD_STATS.opr, r) ?? rankingsHref(season, r) } : { label: `View the ${r.name} rankings`, href: rankingsHref(season, r) },
  };
  const lead = by === "opr" ? opr : rating ?? opr;
  const list = by === "opr" ? "OPR" : by === "rating" ? "rankings" : "lists";
  if (!st || !lead) {
    // A place's lists rank the teams from there: a team from elsewhere is said to be, with its own place's question.
    const home = await get<{ state: string | null; country: string | null }>("SELECT state, country FROM teams WHERE number = ?", [team.number]);
    if (home && (home.country !== r.country || (home.state ?? "") !== r.state)) {
      // Its region's own name (as its code is stored: "NSW" is New South Wales), which the question reads back;
      // a code with no known name ("BZ") is said as its country, and only a known region gets the question.
      const named = home.country ? findRegions(regionLabel(`${home.country}:${home.state ?? ""}`)).find((x) => x.country === home.country) : undefined;
      const from = named?.name ?? home.country;
      const ask = `${team.number} ${by === "opr" ? "opr rank" : by === "rating" ? "rating" : "rank"} in ${from} in ${S}`;
      return { ...b, blocks: named ? [{ kind: "related", title: `Its own ${from} ${list}`, queries: [ask] }] : [], none: `${who(team)} isn't on the ${r.name} ${list} for ${S}: ${from ? `it's a team from ${from}, and` : ""} the ${r.name} ${list} rank teams from ${r.name} only.` };
    }
    return { ...b, none: `${who(team)} isn't on the ${r.name} ${list} for ${S}: it needs ${RANKED_MIN_MATCHES}+ ${by === "opr" ? "matches" : "rated matches"} that season.` };
  }
  const leadBy = by === "opr" || (by === "both" && !rating) ? "OPR" : "prediction rating";
  const sub = by === "both"
    ? [rating && opr ? `#${n(opr.rank)} of ${n(opr.of)} in ${r.name} by OPR` : null, st.opr.np.rank && st.opr.np.of ? `#${n(st.opr.np.rank)} of ${n(st.opr.np.of)} worldwide by OPR` : null, S].filter(Boolean).join(" · ")
    : by === "opr"
      ? [`OPR ${num(st.opr.np.value)}`, st.opr.np.rank && st.opr.np.of ? `#${n(st.opr.np.rank)} of ${n(st.opr.np.of)} worldwide` : null, S].filter(Boolean).join(" · ")
      : [st.rating ? `${num(st.rating.np)} ± ${num(st.rating.sd)}` : null, st.rating?.rank ? `#${n(st.rating.rank)} worldwide` : null, S].filter(Boolean).join(" · ");
  const blocks: StatBlock[] = [rankKpis(st, pop, r, { opr, rating }, by)];
  if (by === "rating" && st.rating) blocks.push(ratingKpis(st, pop));
  if (opr && by !== "rating") blocks.push({ kind: "table", title: `Nearby on the ${r.name} OPR list`, columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "opr", label: "OPR", num: true }],
    rows: opr.near.map((x) => ({ cells: { rank: x.rank, team: `${x.team} ${x.name ?? ""}`.trim(), opr: num(x.v) }, href: teamHref(x.team, season), strong: x.team === team.number })) });
  return { ...b, headline: { value: `#${n(lead.rank)} of ${n(lead.of)}`, label: `in ${r.name} by ${leadBy}`, sub, href: leadBy === "OPR" ? (teamsHref(season, BOARD_STATS.opr, r) ?? undefined) : rankingsHref(season, r) }, blocks };
}

/** The OPR, or the season-end rating, at each FIRST Championship the team played (every season, or the one named). */
async function worldsAnswer(f: OprRatingQuestion, team: Team, set: { events: TeamEvent[]; seasons: TeamSeason[] }, asked: number | null, latest: number | null): Promise<StatAnswer> {
  const rating = f.id === "rating-worlds";
  const worlds = set.events.filter((e) => e.type === CHAMPIONSHIP_TYPE && e.matches > 0 && (asked == null || e.season === asked));
  const scope = ["FIRST Championship only", asked != null ? seasonLabel(asked) : "All seasons"];
  const missedLatest = asked == null && latest != null && !worlds.some((e) => e.season === latest);
  const note = missedLatest ? ` ${who(team)} didn't play the FIRST Championship in ${seasonLabel(latest!)}, its latest season, so this lists every season it did.` : "";
  const b: StatAnswer = {
    family: "stat", intent: f.id, title: `${rating ? "Prediction rating" : "OPR"} at the FIRST Championship`, team, scope,
    definition: rating
      ? `${RATING_RULE} Ratings aren't stored event by event: a season's rating is the engine's after the team's last match that season, and the FIRST Championship was its last event, so that rating is the one it finished Worlds on. Its division is named.${note}`
      : `OPR at the FIRST Championship: the team's OPR in its Worlds division only (without penalties), as its team page lists that event, not the season OPR. Its division is named.${note}`,
    source: `From ${worlds.length} FIRST Championship event${worlds.length === 1 ? "" : "s"}`, blocks: [],
  };
  if (!worlds.length) return { ...b, none: `${who(team)} hasn't played the FIRST Championship${asked != null ? ` in ${seasonLabel(asked)}` : ""} on record.` };
  const rows = await Promise.all([...worlds].reverse().map(async (e) => {
    // Every rated event it played after this division, playoffs counted (the Worlds finals have no qualification
    // matches). An off-season event or a scrimmage after Worlds isn't rated (the stats job leaves those types out), so
    // the season's rating is still the one it finished Worlds on.
    const season = set.events.filter((x) => x.season === e.season && !EXCLUDED_TYPES.has(x.type ?? "") && (x.matches > 0 || (x.record != null && x.record.wins + x.record.losses + x.record.ties > 0)));
    const after = season.slice(season.findIndex((x) => x.code === e.code) + 1);
    const st = rating ? await seasonStats(e.season, team.number) : null;
    return { e, final: after.every((x) => x.type === CHAMPIONSHIP_TYPE), finals: after.length > 0, r: st?.rating ?? null };
  }));
  const top = rows[0];
  if (rating) {
    const known = rows.filter((x) => x.final && x.r);
    const lead = known[0];
    const table: StatBlock = { kind: "table", title: "Each FIRST Championship", columns: [{ key: "season", label: "Season" }, { key: "event", label: "Division" }, { key: "rating", label: "Rating after Worlds", num: true }, { key: "rank", label: "World rank" }],
      rows: rows.map((x) => ({ cells: { season: seasonLabel(x.e.season), event: x.e.name, rating: x.final && x.r ? `${num(x.r.np)} ± ${num(x.r.sd)}` : "Not stored", rank: x.final && x.r?.rank ? `#${n(x.r.rank)}` : "–" }, href: eventHref(x.e.season, x.e.code, team.number), strong: x === lead })) };
    if (!lead) return { ...b, none: `The rating ${who(team)} had at Worlds isn't stored (Worlds wasn't its last event that season).`, blocks: [table] };
    return { ...b, headline: { value: `${num(lead.r!.np)} ± ${num(lead.r!.sd)}`, label: `after ${lead.e.name}${lead.finals ? " and the Worlds finals" : ""}, ${seasonLabel(lead.e.season)}`, sub: [dateRange(lead.e.start, lead.e.end), lead.r!.rank ? `#${n(lead.r!.rank)} worldwide that season` : null].filter(Boolean).join(" · "), href: eventHref(lead.e.season, lead.e.code, team.number) }, blocks: [table] };
  }
  const e = top.e;
  return {
    ...b, headline: { value: num(e.opr), label: `at ${e.name}, ${seasonLabel(e.season)}`, sub: [dateRange(e.start, e.end), `${e.matches} matches`, e.rank && e.of ? `ranked #${e.rank} of ${e.of} in the division` : null].filter(Boolean).join(" · "), href: eventHref(e.season, e.code, team.number) },
    blocks: [
      { kind: "kpis", items: [{ label: "OPR", value: num(e.opr), phase: "np" as const }, { label: "Auto", value: num(e.auto), phase: "auto" as const }, { label: "TeleOp", value: num(e.teleop), phase: "teleop" as const }, { label: "Endgame", value: num(e.endgame), phase: "endgame" as const }] },
      eventTable(rows.map((x) => x.e), team, true, "Each FIRST Championship"),
    ],
  };
}

/** The rating over a season: after each event, read from the weekly ranking snapshots (the Monday after it), ending
 *  on the team page's season rating; and the rating each season. */
async function ratingTrend(team: Team, season: number, set: { events: TeamEvent[]; seasons: TeamSeason[] }, st: Awaited<ReturnType<typeof seasonStats>>, why: string): Promise<StatAnswer> {
  const S = seasonLabel(season);
  const weeks = await all<{ week: string; rating: number }>("SELECT week, rating FROM ranking_snapshots WHERE season = ? AND team = ? ORDER BY week", [season, team.number]);
  const evs = set.events.filter((e) => e.season === season && e.matches > 0);
  const rated = set.seasons.filter((s) => s.rating != null);
  const b: StatAnswer = {
    family: "trend", intent: "rating-trend", title: `Prediction rating by event in ${S}`, team, scope: [S],
    definition: `${RATING_RULE} After each event: the rating in the weekly Rankings snapshot taken the Monday after it; the last event shows the team page's season rating.${why}`,
    source: `From ${weeks.length} weekly snapshot${weeks.length === 1 ? "" : "s"} and ${possessive(who(team))} season ratings`, blocks: [],
  };
  const r = st?.rating;
  if (!r) return { ...b, none: `${who(team)} has no prediction rating in ${S} yet.` };
  const after = (e: TeamEvent, last: boolean): number | null => {
    if (last) return Number(r.np);
    // That exact Monday's snapshot only: one pruned past the retention window leaves a gap, never a later week's rating.
    // An event with no dates on record has no Monday after it: a gap.
    const end = Date.parse(`${e.end ?? e.start}T12:00:00Z`);
    if (!Number.isFinite(end)) return null;
    const monday = weekOf(end + WEEK_MS);
    const w = weeks.find((x) => x.week === monday);
    return w ? Number(w.rating) : null;
  };
  const pts = evs.map((e, i) => ({ e, y: after(e, i === evs.length - 1) }));
  const known = pts.filter((p) => p.y != null) as { e: TeamEvent; y: number }[];
  const first = known[0];
  const dir = known.length > 1 ? (Math.abs(known.at(-1)!.y - first.y) < 0.05 * Math.max(first.y, 1) ? "Steady" : known.at(-1)!.y > first.y ? "Rising" : "Falling") : null;
  const blocks: StatBlock[] = [];
  if (known.length > 1) blocks.push({ kind: "series", title: "Rating after each event", points: pts.map((p) => ({ x: p.e.name, y: p.y == null ? null : Math.round(p.y * 10) / 10, href: eventHref(p.e.season, p.e.code, team.number), note: dateRange(p.e.start, p.e.end) ?? undefined })) });
  blocks.push(ratingKpis(st!, await ratingPop(season)));
  if (rated.length) blocks.push({ kind: "table", title: "Rating each season", columns: [{ key: "season", label: "Season" }, { key: "rating", label: "Rating", num: true }, { key: "rank", label: "World rank" }],
    rows: [...rated].reverse().map((s) => ({ cells: { season: seasonLabel(s.season), rating: num(s.rating), rank: s.ratingRank ? `#${n(s.ratingRank)}` : "–" }, href: teamHref(team.number, s.season), strong: s.season === season })) });
  const last = evs.at(-1);
  return {
    ...b,
    ...(known.length > 1 ? {} : { definition: `${b.definition} No weekly snapshot after its earlier ${S} events is stored, so only the season rating is shown.` }),
    headline: { value: `${num(r.np)} ± ${num(r.sd)}`, label: `latest rating${last ? `, after ${last.name}` : ""}${dir ? ` · ${dir} from ${num(first.y)} after ${first.e.name}` : ""}`, sub: [S, `${r.matches ?? 0} matches rated`, r.rank ? `#${n(r.rank)} worldwide` : null].filter(Boolean).join(" · "), href: teamHref(team.number, season) },
    blocks,
  };
}

function eventTable(evs: TeamEvent[], team: Team, withSeason: boolean, title: string): StatBlock {
  return { kind: "table", title, columns: [...(withSeason ? [{ key: "season", label: "Season" }] : []), { key: "event", label: "Event" }, { key: "date", label: "Date" }, { key: "matches", label: "Matches", num: true }, { key: "opr", label: "OPR", num: true }],
    rows: evs.map((e, i) => ({ cells: { ...(withSeason ? { season: seasonLabel(e.season) } : {}), event: e.name, date: dateRange(e.start, e.end) ?? "–", matches: e.matches, opr: num(e.opr) }, href: eventHref(e.season, e.code, team.number), strong: i === 0 })) };
}
