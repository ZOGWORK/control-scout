// Two to four teams set side by side by search ("12722 vs 17064", "12722 vs 17064 vs 27851"): Compare's hit, the teams'
// rows and the season-numbers card, built from what the server read (the teams, their stored season rows, the season's
// scales). Pure, so the server (server/api/searchCompare.ts, answers/families/twoTeam.ts, answers/index.ts) and the
// app with no signal (src/lib/offline/search.ts, from the event pack's `search` section) build the very same answer
// through the same functions: never a second copy of the rules.
import type { SearchAnswer, SearchCompareSide, SearchHit, SearchPageLink } from "./api";
import type { CompareRow, StatAnswer, StatBlock } from "./searchStat";
import { seasonLabel, place } from "./format";
import { cleanTeamName, searchTeamTitle, teamNameOf, teamWords } from "./teamTitle";
import { predictHref } from "./predictUrl";
import { VERSUS, pagesFor } from "./search";

// --- Teams and links -------------------------------------------------------------------------------------------------

/** A team an answer is about: its number and its name as FIRST lists it (null: none). */
export interface AnswerTeam { number: number; name: string | null }
/** "Hypnotic Robotics (4215)", or "Team 4215" with no name. */
export const whoOf = (t: AnswerTeam) => (t.name ? `${t.name} (${t.number})` : `Team ${t.number}`);
/** A team page, on a season. */
export const teamHref = (n: number, season?: number | null) => `/teams/${n}${season != null ? `?season=${season}` : ""}`;

// --- Scope in words --------------------------------------------------------------------------------------------------

/** An answer's scope (server/api/answers/clauses.ts, where it's applied to matches and events). */
export interface Scope {
  /** One season, or null for every season on record. */
  season: number | null;
  /** Every season was asked for outright ("ever", "all time", "career"): a best or worst is the best of all of them. */
  ever?: boolean;
  /** How the season was chosen, said in the answer ("latest season with matches for 12345"). */
  seasonWhy?: string;
  /** Only FIRST Championship (Worlds) events. */
  championship?: boolean;
  /** Only region (state) championships. */
  states?: boolean;
  /** One event ("season:CODE"), and its name for the chips. `codes`: every event the words named that the team played
   *  in that season (a championship's division and its finals, an AM and a PM meet), read as one; `code` is the one
   *  whose rank and OPR the answer shows. `absent`: the team played none of them (the answer says so; "never": it has
   *  none of that kind on record, as a state championship). */
  event?: { season: number; code: string; name: string; codes?: string[]; absent?: boolean | "never" };
  /** Events held at one venue, any season ("River Dell High School"): their "season:CODE" keys. */
  venue?: { name: string; keys: string[] };
  /** Events in one region (by the event's own state and country), or with `outside`, every event outside it (the
   *  team's home state: "out-of-state events"). */
  place?: { country: string; state: string; name: string; outside?: boolean };
  /** A date window (YYYY-MM-DD, inclusive: "this week", "on Mar 15, 2026", "in March"), and how it was said. A match
   *  counts by its own date (its time, else its event's first day); an event when any of its days is in the window. */
  window?: { from: string; to: string; label: string };
  level?: "qual" | "playoff";
  /** The finals only, of the playoffs (a match's `final`). Set with `level: "playoff"`. */
  finals?: boolean;
  alliance?: "red" | "blue";
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** The scope in words, as chips: "FIRST Championship (Worlds)", "2025–26", "Playoffs", "Red alliance". */
export function scopeChips(s: Scope): string[] {
  return [
    s.event ? s.event.name : s.venue ? `At ${s.venue.name}` : "",
    s.championship ? "FIRST Championship (Worlds)" : s.states ? "State championships" : "",
    s.place ? `Events ${s.place.outside ? "outside" : "in"} ${s.place.name}` : "",
    s.window ? cap(s.window.label) : "",
    // One event's answer names the event's season too, so the card always states which season it reads.
    s.season != null ? seasonLabel(s.season) : s.event ? seasonLabel(s.event.season) : "All seasons",
    s.finals ? "Finals" : s.level === "qual" ? "Qualification matches" : s.level === "playoff" ? "Playoff matches" : "",
    s.alliance ? `${s.alliance === "red" ? "Red" : "Blue"} alliance` : "",
  ].filter(Boolean);
}

/** The scope as a phrase in a sentence: "at Worlds", "in 2025–26", "in playoffs at New Jersey Championship", "" for
 *  all. The match type is said first, so a title always names it ("Record in quals in 2025–26"). */
export function scopePhrase(s: Scope): string {
  const level = s.finals ? " in the finals" : s.level === "qual" ? " in quals" : s.level === "playoff" ? " in playoffs" : "";
  const where = s.event ? ` at ${s.event.name}` : s.venue ? ` at ${s.venue.name}` : s.championship ? " at Worlds" : s.states ? " at state championships" : s.place ? ` at events ${s.place.outside ? "outside" : "in"} ${s.place.name}` : "";
  const when = s.window ? ` ${s.window.label}` : s.season != null && !s.event ? ` in ${seasonLabel(s.season)}` : "";
  return `${level}${where}${when}`;
}

export type SeasonWhyKind = "any" | "team" | "teams" | "this" | "this-any" | "last";
/** The card's note on the season it chose, one wording per rule, `current` the current season (server/api/answers/
 *  season.ts seasonWhy passes its own). See there for the kinds. */
export function seasonWhyAt(kind: SeasonWhyKind, season: number, current: number, who?: string): string {
  const S = seasonLabel(season);
  const now = season === current;
  switch (kind) {
    case "any": return now ? `With no season named, the season is ${S}, the current season.`
      : `With no season named, the season is ${S}, the latest season with matches on record (no ${seasonLabel(current)} matches yet).`;
    case "this-any": return `"This season" is ${S}, the current season.`;
    case "team": return now ? `With no season named, the season is ${S}, the current season, which ${who ?? "the team"} has played in.`
      : `With no season named, the season is ${S}, the latest season ${who ?? "the team"} has played in (no ${seasonLabel(current)} match played yet).`;
    case "this": return now ? `"This season" is ${S}, the current season, which ${who ?? "the team"} has played in.`
      : `"This season" here is ${S}, the latest season ${who ?? "the team"} has played in (no ${seasonLabel(current)} match played yet).`;
    case "teams": return now ? `With no season named, the season is ${S}, the current season, which every team here has played in.`
      : `With no season named, the season is ${S}, the latest season every team here has played in.`;
    case "last": return `"Last season" is ${S}, the latest completed season.`;
  }
}

// --- Comparison rows (the search results guide's compare contract) ------------------------------------------------

export interface CompareInput {
  label: string;
  /** Each team's number, in the block's team order (null: not on record). */
  values: (number | null | undefined)[];
  /** How each value reads ("101.6", "#612", "26-6-0"); default one decimal. */
  show?: (v: number | null | undefined, i: number) => string;
  /** Which way is better; null: no side is (matches played). */
  better: "higher" | "lower" | null;
  /** The gap as words ("+42.7", "266 places"); default one decimal with a plus. */
  gap?: (d: number) => string;
  /** The row's scale maximum: drawn as bars from zero to it. Absent: a row of values only (a rank, a record). */
  max?: number | null;
  /** The headline row (Total): first, whatever its gap. */
  total?: boolean;
}

const one = (v: number | null | undefined) => (v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1));

/** A round number at or above `v`, for a scale's maximum: 10s up to 200, then 50s. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const step = v <= 10 ? 1 : v <= 50 ? 5 : v <= 200 ? 10 : 50;
  return Math.ceil(v / step) * step;
}

/** One row: the better side (a tie or a missing value: none), the gap to the next best. */
export function compareRow(x: CompareInput): CompareRow {
  const vs = x.values.map((v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v)));
  const shown = vs.map((v, i) => (x.show ?? one)(v, i));
  // A value below zero (an OPR can be) gets no bar: a bar from zero can't show it, so the row is its values, noted.
  const negative = vs.some((v) => v != null && v < 0);
  const top = Math.max(...vs.map((v) => v ?? 0));
  const base: CompareRow = { label: x.label, values: shown, best: null,
    ...(x.max != null && !negative && vs.some((v) => v != null) ? { max: top > x.max ? niceMax(top) : x.max, nums: vs } : {}),
    ...(x.max != null && negative ? { note: "below zero: no bars" } : {}) };
  if (!x.better || !vs.every((v) => v != null)) return base;
  const order = vs.map((v, i) => ({ v: v!, i })).sort((a, b) => (x.better === "higher" ? b.v - a.v : a.v - b.v));
  const d = Math.abs(order[0].v - order[1].v);
  // A tie for the lead: the teams level at the top, by index (the rest are behind them).
  if (d < 1e-9) return { ...base, gap: "Even", diff: 0, tied: order.filter((o) => Math.abs(o.v - order[0].v) < 1e-9).map((o) => o.i).sort((p, q) => p - q) };
  return { ...base, best: order[0].i, gap: (x.gap ?? ((g) => `+${one(g)}`))(d), diff: d };
}

/** The rows in reading order: the Total first, then every other row with a scale by its gap, largest first (the one
 *  that decided it comes second; a row below zero shows values only but keeps its place by gap), then the rows of
 *  values only, as given. */
export function compareRows(rows: CompareInput[]): CompareRow[] {
  const built = rows.map((x) => ({ x, r: compareRow(x) }));
  const total = built.filter((b) => b.x.total);
  const bars = built.filter((b) => !b.x.total && b.x.max != null).sort((a, b) => (b.r.diff ?? -1) - (a.r.diff ?? -1));
  const rest = built.filter((b) => !b.x.total && b.x.max == null);
  return [...total, ...bars, ...rest].map((b) => b.r);
}

export function compareBlock(title: string, teams: AnswerTeam[], rows: CompareInput[], season?: number | null, scale?: string): StatBlock {
  return {
    kind: "compare", title,
    teams: teams.map((t) => ({ label: String(t.number), href: teamHref(t.number, season ?? undefined) })),
    rows: compareRows(rows),
    ...(scale ? { scale } : {}),
  };
}

export type StatColumn = "opr_np" | "opr_auto" | "opr_teleop" | "opr_endgame" | "rating_np" | "rating_auto" | "rating_teleop" | "rating_endgame" | "rating_pen" | "avg_pen";

/** A W-L-T record's win share (ties half), what records are compared by. */
export const winShare = (r: { wins: number; losses: number; ties: number }) => { const n = r.wins + r.losses + r.ties; return n ? (r.wins + r.ties / 2) / n : null; };

const PHASE_ROWS = new Set(["Auto", "TeleOp", "Endgame"]);

/** The phase after the Total that decided it: the phase with the largest gap, when it went the leader's way. */
export function decidingPhase(rows: CompareRow[]): CompareRow | null {
  const total = rows[0];
  // The phase with the largest gap, whatever order the rows are in.
  const p = rows.slice(1).filter((r) => PHASE_ROWS.has(r.label)).sort((a, b) => (b.diff ?? -1) - (a.diff ?? -1))[0];
  return total?.best != null && p && p.best === total.best && (p.diff ?? 0) > 0 ? p : null;
}

/** A comparison's headline, the result said once: "23268 leads 157.9 – 115.3", the gap, and the context line (each
 *  fact once: ranks, records, what decided it). The leader's value first; a tie is "Even". */
export function leadHeadline(teams: AnswerTeam[], total: CompareRow, context: (string | null | undefined)[], href?: string): { value: string; label: string; sub?: string; href?: string } {
  const sub = context.filter(Boolean).join(" · ") || undefined;
  if (total.best == null && total.tied?.length) {
    // Level at the top: all of them ("Even at 50.0"), or the leaders named ("6980 and 33950 tie at 20.0").
    const at = total.values[total.tied[0]];
    return total.tied.length === teams.length
      ? { value: `Even at ${at}`, label: "No gap", ...(sub ? { sub } : {}) }
      : { value: `${total.tied.map((i) => teams[i].number).join(" and ")} tie at ${at}`, label: "No gap between them", ...(sub ? { sub } : {}) };
  }
  if (total.best == null) return { value: total.values.join(" – "), label: "No leader: a value is missing", ...(sub ? { sub } : {}) };
  const order = [total.best, ...total.values.map((_, i) => i).filter((i) => i !== total.best)];
  return { value: `${teams[total.best].number} leads ${order.map((i) => total.values[i]).join(" – ")}`, label: total.gap ?? "", ...(sub ? { sub } : {}), ...(href ? { href } : {}) };
}

/** "TeleOp decided it (+32.3)". */
export const decidedText = (rows: CompareRow[]) => { const p = decidingPhase(rows); return p ? `${p.label} decided it (${p.gap})` : null; };

// --- Compare's hit ---------------------------------------------------------------------------------------------------

/** What Compare's hit says about a team (server/api/searchCompare.ts reads it from the teams table). */
export interface CompareFacts { number: number; name: string; city: string | null; state: string | null; country: string | null }

export const comparePlace = (t: CompareFacts) => place(t.city, t.state) || t.country || "";
const sideOf = (t: CompareFacts): SearchCompareSide => ({ number: t.number, name: cleanTeamName(t.number, t.name) ?? "", place: comparePlace(t) });

/** Compare's hit for these teams (number order). */
export function compareHit(teams: CompareFacts[], q: string, season: number | null, resolved: { typed: string; number: number; rule: string; candidates: number[] }[], extra = ""): SearchHit {
  const sorted = [...teams].sort((a, b) => a.number - b.number);
  const nums = sorted.map((t) => t.number);
  // "… awards": Compare opened on its events-and-awards section.
  const awards = /\bawards?\b/i.test(q);
  return {
    kind: "compare", ref: nums.join(","), season,
    href: `/compare?teams=${nums.join(",")}${season != null ? `&season=${season}` : ""}${awards ? "#awards" : ""}`,
    title: sorted.map((t) => teamWords(searchTeamTitle(t.number, t.name))).join(" vs "),
    subtitle: `${awards ? "Compare their events and awards side by side" : "Compare side by side: records, OPR and event history"}${extra}`,
    compare: { teams: sorted.map(sideOf), ...(resolved.length ? { resolved } : {}) },
  };
}

// --- Season numbers side by side -------------------------------------------------------------------------------------

/** A team's stored season numbers (team_season_stats), as the compare card reads them. */
export interface SeasonRow { team: number; season: number; opr_np: number | null; opr_auto: number | null; opr_teleop: number | null; opr_endgame: number | null; rank_np: number | null; rank_auto: number | null; rank_teleop: number | null; rank_endgame: number | null; ranked_teams: number | null; rating_np: number | null; rating_auto: number | null; rating_teleop: number | null; rating_endgame: number | null; rating_sd: number | null; rating_rank: number | null; matches: number; wins: number; losses: number; ties: number }

/** The season rows' columns, as read. */
export const SEASON_COLS = "team, season, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, rank_auto, rank_teleop, rank_endgame, ranked_teams, rating_np, rating_auto, rating_teleop, rating_endgame, rating_sd, rating_rank, matches, wins, losses, ties";

export interface PickedSeason { season: number | null; why?: string; rows: (SeasonRow | undefined)[] }

/** Every team's row for the season named, else for the current season when all of them played it, else the latest
 *  season all of them played (said so). `rows`: the teams' rows with matches, newest season first. */
export function pickSeasonRows(teams: number[], rows: SeasonRow[], season: number | null, current: number): PickedSeason {
  const of = (t: number, s: number) => rows.find((r) => Number(r.team) === t && Number(r.season) === s);
  const allOf = (s: number) => teams.map((t) => of(t, s));
  if (season != null) return { season, rows: allOf(season) };
  // The one season rule (server/api/answers/season.ts): the current season when every team has played it, else the
  // latest they all have.
  if (teams.every((t) => of(t, current))) return { season: current, why: seasonWhyAt("teams", current, current), rows: allOf(current) };
  const s = rows.map((r) => Number(r.season)).find((x) => teams.every((t) => of(t, x)));
  if (s == null) return { season: null, rows: [] };
  return { season: s, why: `The season is ${seasonLabel(s)}, the latest season ${teams.length === 2 ? "both" : "all the"} teams played.`, rows: allOf(s) };
}

const PHASE_NAME = { auto: "Auto", teleop: "TeleOp", endgame: "Endgame" } as const;
type Rec = { wins: number; losses: number; ties: number };
const recText = (r: Rec) => `${r.wins}-${r.losses}-${r.ties}`;
/** The compare card's season scales: the season's high for each of these, rounded up. */
export const COMPARE_SCALE_COLS: StatColumn[] = ["opr_np", "opr_auto", "opr_teleop", "opr_endgame", "rating_np"];

const COMPARE_RULE = "Each team's stored season numbers, as their team pages show them: OPR (the points a team adds to its alliance without penalties) and its rank among every team with an OPR that season, OPR by phase, the prediction rating (points per match ± its uncertainty) and the season's record.";

/** "12345 vs 67890 compare", "12345 67890 33950 compare": the teams' season numbers in one card, from the season
 *  picked (pickSeasonRows) and that season's scales (`scale`: COMPARE_SCALE_COLS, read only when a season was
 *  picked). `legacy`: the season predates Predict (an older season is Compare only). */
export function compareStat(teams: AnswerTeam[], scope: Scope, s: PickedSeason, scale: Record<string, number | null>, legacy: (season: number) => boolean): StatAnswer {
  const phrase = s.season != null ? `, ${seasonLabel(s.season)}` : "";
  const base = { family: "two-team" as const, intent: "compare", title: `${teams.map((t) => t.number).join(" vs ")}${phrase}`, team: teams[0], teams, scope: scopeChips({ ...scope, season: s.season }), definition: `${COMPARE_RULE}${s.why ? ` ${s.why}` : ""}`, source: s.season != null ? `From the teams' ${seasonLabel(s.season)} season numbers` : "No season every team played" };
  if (s.season == null) return { ...base, blocks: [], none: `${teams.map(whoOf).join(", ")} have no season they all played.` };
  const missing = teams.filter((_, i) => !s.rows[i]);
  if (missing.length) return { ...base, blocks: [], none: `No ${seasonLabel(s.season)} matches on record for ${missing.map(whoOf).join(" and ")}.` };
  const season = s.season;
  const rows = s.rows as SeasonRow[];
  const best = rows.reduce((x, r) => ((r.opr_np ?? -Infinity) > (x.opr_np ?? -Infinity) ? r : x));
  const lead = teams.find((t) => t.number === Number(best.team))!;
  // No OPR for any of them (counted matches can all be no-shows): the table, with no leader named.
  const noOpr = rows.every((r) => r?.opr_np == null);
  const rec = (r: SeasonRow): Rec => ({ wins: r.wins, losses: r.losses, ties: r.ties });
  const compareHref = `/compare?teams=${teams.map((t) => t.number).sort((x, y) => x - y).join(",")}&season=${season}`;
  const phases = ["np", "auto", "teleop", "endgame"] as const;
  // OPR and its phases, then the rating, each on the season's own scale (five rows); the ranks and records are the
  // context line, said once.
  const block = compareBlock("Season numbers", teams, [
    ...phases.map((k) => ({ label: k === "np" ? "OPR" : PHASE_NAME[k], total: k === "np", values: rows.map((r) => r[`opr_${k}`]), max: scale[`opr_${k}`], better: "higher" as const })),
    { label: "Rating", values: rows.map((r) => r.rating_np), max: scale.rating_np, better: "higher" },
  ], season, `the ${seasonLabel(season)} high, rounded up`);
  const crow = block.kind === "compare" ? block.rows : [];
  const two = teams.length === 2;
  const who = (i: number) => (two ? "" : `${teams[i].number} `);
  const context = [...rows.map((r, i) => `${who(i)}${r.rank_np ? `#${r.rank_np.toLocaleString("en-US")} of ${(r.ranked_teams ?? 0).toLocaleString("en-US")}` : "unranked"} (${recText(rec(r))})`), decidedText(crow)];
  return {
    ...base,
    headline: noOpr ? { value: "No OPR", label: `No ${seasonLabel(season)} OPR on record for these teams`, href: compareHref } : leadHeadline(teams, crow[0], context, teamHref(lead.number, season)),
    blocks: [
      block,
      { kind: "links", title: "Try it", items: [...(two && !legacy(season) ? [{ label: "Open in Predict", href: predictHref({ mode: "match", season, red: [teams[0].number], blue: [teams[1].number] }) }] : []), { label: "Compare side by side", href: compareHref }] },
    ],
  };
}

// --- The answers -----------------------------------------------------------------------------------------------------

/** A team's row under a comparison: search's own team row, its facts and events left out (`section`: where it opens). */
export const versusRow = (h: SearchHit, section?: SearchHit["section"]): SearchHit => ({ ...h, ...(section ? { section } : {}), facts: undefined, events: undefined });

/** "12345 67890 33950 compare", "12345 vs 67890 vs 33950": three or more teams' season numbers in one card. `rows`:
 *  each team's search row (typed order); `top`: Compare's own hit, opened on `season` (the one named, else the card's).
 *  `stat`: the card, on the page (absent in the header's short list). */
export function teamSetAnswer(q: string, rows: SearchHit[], top: SearchHit | undefined, season: number | null, named: number | null, pages: SearchPageLink[], stat?: StatAnswer): SearchAnswer {
  const teams = rows.map((h) => ({ number: Number(h.ref), name: teamNameOf(h.title) || null }));
  const label = `Compare: ${teams.map(whoOf).join(" vs ")}`;
  const compare = top && season != null && top.href && !/[?&]season=/.test(top.href)
    ? { ...top, href: `${top.href}${top.href.includes("?") ? "&" : "?"}season=${season}` } : top;
  return {
    q, hits: [...(compare ? [compare] : []), ...rows.map((h) => versusRow(h))], pages, step: "deterministic", weak: false,
    understood: { kind: "question", label, ...(named != null ? { season: named } : {}) },
    intent: { kind: "stat-compare", pattern: `[team] [team] [team] compare${named != null ? " [season]" : ""}`, met: true, understood: [`Teams ${teams.map(whoOf).join(", ")}`, "Compare"] },
    ...(stat ? { stat } : {}),
  };
}

/** "12345 vs 67890": two teams compared (server/api/answers/index.ts twoTeamSearch, its plain "compare" reading with
 *  no event, place or match type said). `lead`: Compare's hit on the card's season; `read`: how the query was read,
 *  slot by slot (the parser's describe, server/api/query/execute.ts). */
export function twoTeamCompareAnswer(q: string, a: SearchHit, b: SearchHit, lead: SearchHit | undefined, scope: Scope, pages: SearchPageLink[], read: string[], stat?: StatAnswer): SearchAnswer {
  const ta = { number: Number(a.ref), name: teamNameOf(a.title) || null }, tb = { number: Number(b.ref), name: teamNameOf(b.title) || null };
  return {
    q, hits: [...(lead ? [lead] : []), versusRow(a, "matches"), versusRow(b, "matches")], pages, step: "deterministic", weak: false,
    understood: { kind: "question", label: `Compare${scopePhrase(scope)}: ${whoOf(ta)} vs ${whoOf(tb)}`, ...(scope.season != null ? { season: scope.season } : {}) },
    intent: { kind: "stat-compare", pattern: `[team] compare [team]${scope.season != null ? " [season]" : ""}`, met: true, understood: read },
    ...(stat ? { stat } : {}),
  };
}

// --- From the event pack ---------------------------------------------------------------------------------------------

/** What the event pack keeps per team for these answers (server/packs/eventApi.ts packSearch). */
export interface VersusPart {
  facts: CompareFacts;
  /** Search's own row for the team, as the page shows it (its season numbers on it). */
  hit: SearchHit;
  /** Its season rows with matches, newest first. */
  rows: SeasonRow[];
}
/** The event pack's `search` section: the parts above per team number, each season's compare scales, the server's
 *  current season and the seasons older than Predict. */
export interface PackSearch {
  teams: Record<string, VersusPart>;
  scales: Record<string, Record<string, number | null>>;
  current: number;
  legacy: number[];
}

/** The team numbers a query sets against each other, typed order ("12722 vs 17064 vs 27851"): every side a number
 *  alone, 2 to 4 of them, no team twice. Null for anything else (left to the rest of search). */
export function versusNumbers(q: string): number[] | null {
  const sides = q.trim().split(VERSUS).map((s) => s.trim());
  if (sides.length < 2 || sides.length > 4 || !sides.every((s) => /^\d{1,6}$/.test(s))) return null;
  const nums = sides.map(Number);
  return new Set(nums).size === nums.length ? nums : null;
}

/** The answer for a versus of the pack's teams, built as the server builds it (above), or null when the query isn't
 *  one or names a team the pack doesn't hold. `read`: the parser's reading of a two-team query (its describe). */
export function versusFromPack(q: string, pack: PackSearch, read: (q: string) => string[] | null): SearchAnswer | null {
  const nums = versusNumbers(q);
  if (!nums) return null;
  const parts = nums.map((n) => pack.teams[String(n)]);
  if (parts.some((p) => !p)) return null;
  const query = q.trim().replace(/\s+/g, " ");
  const all = parts.flatMap((p) => p.rows).sort((x, y) => y.season - x.season);
  const picked = pickSeasonRows(nums, all, null, pack.current);
  const teams = parts.map((p) => ({ number: Number(p.hit.ref), name: teamNameOf(p.hit.title) || null }));
  const stat = compareStat(teams, { season: null }, picked, picked.season != null ? pack.scales[String(picked.season)] ?? {} : {}, (s) => pack.legacy.includes(s));
  if (nums.length === 2) {
    const how = read(query);
    if (!how) return null;
    const lead = compareHit(parts.map((p) => p.facts), `${nums[0]} vs ${nums[1]}`, picked.season, []);
    return twoTeamCompareAnswer(query, parts[0].hit, parts[1].hit, lead, { season: null }, pagesFor(query), how, stat);
  }
  const top = compareHit(parts.map((p) => p.facts), nums.join(" vs "), null, []);
  return teamSetAnswer(query, parts.map((p) => p.hit), top, picked.season, null, pagesFor(query), stat);
}
