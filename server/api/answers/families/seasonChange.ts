// How a team's number changed, from stored rows only (never worked out per request):
//   "how much did 12345's opr improve from last season to this season" → both seasons' OPR (the team page's season
//     rows), the difference, and the world standing each season (OPR in points is a different game each season, so
//     the standing is the like-for-like comparison, said so)
//   "how much did 12345's rating change this season" → the rating in the earliest and the last stored week of the
//     season (the weekly Rankings snapshots, ranking_snapshots), the difference, the weeks between, and the team
//     page's live rating beside them
// No season named: "this season" is the default season (the latest completed one, ../season.ts), "last season" the one
// before it.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { dateRange, num, possessive, seasonLabel } from "../../../../src/shared/format.js";
import { all, get } from "../../../db.js";
import { seasonStats } from "../../teams.js";
import { readScope } from "../read.js";
import { currentSeason, seasonWhy, teamSeason } from "../season.js";
import { teamHref } from "../matchSet.js";

export interface ChangeQuestion {
  stat: "opr" | "rating";
  core: string;
  /** Two seasons ("from last season to this season"), or one ("this season": within it). */
  from: number | null;
  to: number;
  /** No season was said (or "this season"): `to` is the current season here, and the answer reads the team's latest
   *  season with matches instead (the one season rule, ../season.ts). */
  defaulted?: boolean;
  /** `from` is said relative to `to` ("last season", or the season before when only one is said), so it moves with
   *  `to` when that is resolved; a named starting season never moves. */
  fromRelative?: boolean;
  /** The starting end was said as "this season" ("from this season to 2024-25"): it is resolved like `to` would be. */
  fromThis?: boolean;
}

/** The question read for the season `to` resolves to (the team's latest, or the season with matches): `to` moves there,
 *  `from` only when it was said relative to it. */
export function shiftChange(c: ChangeQuestion, latest: number): ChangeQuestion {
  let { from, to } = c;
  if (c.defaulted) { if (from != null && c.fromRelative) from -= to - latest; to = latest; }
  if (c.fromThis) from = latest;
  return from === c.from && to === c.to ? c : { ...c, from, to };
}

const CHANGE = String.raw`(?:improve[ds]?|improvement|change[ds]?|grow|grew|go up|went up|increase[ds]?|rise|rose|drop(?:ped)?|fall|fell|go down|went down|decrease[ds]?)`;

/** A season in words or as one ("last season", "this season", "2024-25"): its number, or null. */
function seasonIn(words: string): number | null | undefined {
  const { scope, rest } = readScope(` ${words} `);
  if (rest.replace(/\b(?:the|season|year)\b/g, "").trim()) return undefined;
  return scope.season ?? (scope.latest ? currentSeason() : null);
}

/** "how much did 12345's opr improve from last season to this season", "12345 rating change this season", "12345
 *  predicted change", or null. With no team ("predicted changes", "rating change"), `core` is "": the answer asks for
 *  one. */
export function readChange(raw: string): ChangeQuestion | null {
  const q = raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!,.]/g, " ").replace(/\s+/g, " ").trim();
  const m = new RegExp(String.raw`^(?:how much (?:did|has|have|does) |what (?:was|is|are) )?(?:the )?(?:(.+?) )?(opr|(?:prediction |predicted )?rating|predicted|prediction|predictions) (?:${CHANGE})(?: by)?(?: (.+))?$`).exec(q);
  // The prediction's own words never name a team ("prediction rating change" isn't Post-Production Team's).
  if (m) m[1] = (m[1] ?? "").replace(/\b(?:the|predicted|prediction|predictions)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!m || /\b(?:vs|versus|and|or)\b/.test(m[1])) return null;
  const stat = m[2] === "opr" ? "opr" : "rating";
  const tail = (m[3] ?? "").trim();
  const def = currentSeason();
  // "from X to Y" keeps its direction (the change is Y against X); "between X and Y" has none: oldest first.
  const two = /^(from|between) (.+?) (?:to|and) (.+)$/.exec(tail) ?? (/^since (.+)$/.exec(tail) ? [tail, "from", tail.slice(6), "this season"] : null);
  if (two) {
    const a = seasonIn(two[2]), b = seasonIn(two[3]);
    if (a == null || b == null || a === b) return null;
    // "between" reads oldest first, so its ends are put in order with their words.
    const swap = two[1] === "between" && a > b;
    const from = swap ? b : a, to = swap ? a : b, fromWords = swap ? two[3] : two[2], toWords = swap ? two[2] : two[3];
    const defaulted = to === def && /\b(?:this|current)\s+(?:season|year)\b/.test(toWords);
    const fromRelative = defaulted && /\b(?:last|previous|past)\s+(?:season|year)\b/.test(fromWords);
    const fromThis = from === def && /\b(?:this|current)\s+(?:season|year)\b/.test(fromWords);
    return { stat, core: m[1], from, to, ...(defaulted ? { defaulted } : {}), ...(fromRelative ? { fromRelative } : {}), ...(fromThis ? { fromThis } : {}) };
  }
  if (!tail) return stat === "opr" ? { stat, core: m[1], from: def - 1, to: def, defaulted: true, fromRelative: true } : { stat, core: m[1], from: null, to: def, defaulted: true };
  const latest = /^(?:in|during|over|across )?\s*(?:the\s+)?(?:this|current)\s+(?:season|year)$/.test(tail);
  const one = seasonIn(tail.replace(/^(?:in|during|over|across) /, ""));
  if (one == null) return null;
  // One season: a rating moves within it; OPR is a season's best event, so it's set against the season before.
  return stat === "opr" ? { stat, core: m[1], from: one - 1, to: one, fromRelative: true, ...(latest ? { defaulted: true } : {}) } : { stat, core: m[1], from: null, to: one, ...(latest ? { defaulted: true } : {}) };
}

type Team = { number: number; name: string | null };
const who = (t: Team) => `${t.number}${t.name ? ` ${t.name}` : ""}`;
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${num(Math.abs(x))}`;
const top = (rank: number, of: number) => `top ${Math.max(1, Math.ceil((100 * rank) / of))}%`;

/** The question with its "this season" ends read as `team`'s latest season with matches (the one season rule,
 *  ../season.ts), and the ends said relative to them moved along; named seasons stay. Reading it twice changes nothing. */
export async function resolveChange(c: ChangeQuestion, team: number): Promise<ChangeQuestion> {
  const latest = c.defaulted || c.fromThis ? await teamSeason(team) : null;
  return latest == null ? c : shiftChange(c, latest);
}

export async function changeAnswer(c0: ChangeQuestion, team: Team): Promise<StatAnswer> {
  // No season said (or "this season"): the team's latest season with matches, the one season rule (../season.ts). A
  // starting season said relative to it moves with it; a named one stays as said.
  const c = await resolveChange(c0, team.number);
  if (c.from == null) return withinAnswer(c.to, team, !!c.defaulted);
  const a = await seasonsAnswer(c, c.from, team);
  return c.defaulted ? { ...a, definition: `${a.definition} ${seasonWhy("this", c.to, String(team.number))}` } : a;
}

/** One number in two seasons: the team page's season rows, and the difference. */
async function seasonsAnswer(c: ChangeQuestion, from: number, team: Team): Promise<StatAnswer> {
  const [a, b] = await Promise.all([seasonStats(from, team.number), seasonStats(c.to, team.number)]);
  const A = seasonLabel(from), B = seasonLabel(c.to);
  const label = c.stat === "opr" ? "OPR" : "Prediction rating";
  const value = (s: typeof a) => (c.stat === "opr" ? s?.opr.np.value ?? null : s?.rating?.np ?? null);
  const rank = (s: typeof a) => (c.stat === "opr" ? { rank: s?.opr.np.rank ?? null, of: s?.opr.np.of ?? null } : { rank: s?.rating?.rank ?? null, of: null });
  const base = {
    family: "trend" as const, intent: `${c.stat}-change`, title: `${label} change, ${A} to ${B}`, team, scope: [A, B],
    definition: `${c.stat === "opr" ? "OPR: the points a team adds to its alliance's score without penalties, its best event that season (as its team page shows)." : "Prediction rating: the engine's points-per-match strength at the end of each season's matches (as the team page shows)."} Each season is a different game, so the change in points says how far apart the two seasons' numbers are, not how much the robot itself improved; the world standing (rank as a share of every ranked team) compares like with like.`,
    source: `From ${possessive(who(team))} ${A} and ${B} season numbers`,
  };
  if (from === c.to) return { ...base, scope: [A], blocks: [], none: `${A} is ${possessive(who(team))} latest season on record, so there is no later season to compare it with.` };
  const va = value(a), vb = value(b);
  if (va == null || vb == null) {
    const missing = [va == null ? A : null, vb == null ? B : null].filter(Boolean).join(" or ");
    return { ...base, blocks: [], none: `${who(team)} has no ${label === "OPR" ? "OPR" : "prediction rating"} in ${missing} on record, so there is nothing to compare.` };
  }
  const d = Number(vb) - Number(va);
  const ra = rank(a), rb = rank(b);
  // The rating's world population is the season's rated teams (team_season_stats.rating_rank), counted here.
  if (c.stat === "rating") {
    const [na, nb] = await Promise.all([from, c.to].map((s) => get<{ n: number }>("SELECT COUNT(*) n FROM team_season_stats WHERE season = ? AND rating_rank IS NOT NULL", [s])));
    ra.of = Number(na?.n) || null; rb.of = Number(nb?.n) || null;
  }
  const standing = (r: { rank: number | null; of: number | null }) => (r.rank && r.of ? `#${r.rank.toLocaleString("en-US")} of ${r.of.toLocaleString("en-US")} · ${top(r.rank, r.of)}` : undefined);
  const items: Extract<StatBlock, { kind: "kpis" }>["items"] = [
    { label: `${label}, ${A}`, value: num(va), ...(standing(ra) ? { sub: standing(ra) } : {}), href: teamHref(team.number, from) },
    { label: `${label}, ${B}`, value: num(vb), ...(standing(rb) ? { sub: standing(rb) } : {}), href: teamHref(team.number, c.to) },
    { label: "Change", value: signed(d), tone: d > 0 ? "good" : d < 0 ? "bad" : undefined, sub: `${B} against ${A}` },
  ];
  return {
    ...base,
    headline: { value: signed(d), label: `${label} ${num(va)} in ${A} → ${num(vb)} in ${B}`, sub: ra.rank && ra.of && rb.rank && rb.of ? `World standing ${top(ra.rank, ra.of)} → ${top(rb.rank, rb.of)}` : undefined, href: teamHref(team.number, c.to) },
    blocks: [{ kind: "kpis", items }],
  };
}

/** The rating within one season, from the weekly Rankings snapshots alone (one series, so start and end compare): its
 *  earliest stored week and the season's last (its final standing), and the weeks between. The team page's rating
 *  today is shown beside it, said to be the engine's live number, which isn't one of the weekly snapshots. */
async function withinAnswer(season: number, team: Team, defaulted = false): Promise<StatAnswer> {
  const S = seasonLabel(season);
  const [all_, now] = await Promise.all([
    all<{ week: string; rating: number; rank: number }>("SELECT week, rating, rank FROM ranking_snapshots WHERE season = ? AND team = ? ORDER BY week", [season, team.number]),
    seasonStats(season, team.number),
  ]);
  // Weeks after the team's last change (the off-season, no matches) repeat the final standing: the first one stays.
  // A week whose rank moved (others passed the team) is a change too.
  let last = all_.length - 1;
  while (last > 0 && Number(all_[last].rating) === Number(all_[last - 1].rating) && Number(all_[last].rank) === Number(all_[last - 1].rank)) last--;
  const weeks = all_.slice(0, last + 1);
  const base = {
    family: "trend" as const, intent: "rating-change", title: `Prediction rating change in ${S}`, team, scope: [S],
    definition: `Prediction rating: the engine's points-per-match strength, from the weekly Rankings snapshots (a team is in a week's snapshot once 3 of its matches are rated). The start is the earliest week of ${S} kept; the end is the season's last week in which its rating or world rank changed, its final standing. The team page shows the engine's live ${S} rating, which isn't one of these weekly snapshots, so it is listed beside them and not used for the change.${defaulted ? ` ${seasonWhy("this", season, String(team.number))}` : ""}`,
    source: `From ${weeks.length} weekly Rankings snapshot${weeks.length === 1 ? "" : "s"} of ${who(team)}, ${S}`,
  };
  const live = now?.rating?.np ?? null;
  if (!weeks.length) return { ...base, blocks: [], none: `No weekly ratings of ${who(team)} are kept for ${S}, so its change over the season can't be shown.${live != null ? ` Its ${S} rating on its team page is ${num(live)}.` : ""}` };
  const first = weeks[0], end = weeks[weeks.length - 1];
  const d = Number(end.rating) - Number(first.rating);
  const day = (w: string) => dateRange(w) ?? w;
  return {
    ...base,
    headline: { value: signed(d), label: `${num(first.rating)} (week of ${day(first.week)}) → ${num(end.rating)} (week of ${day(end.week)})`, sub: `${weeks.length} week${weeks.length === 1 ? "" : "s"} on record`, href: teamHref(team.number, season) },
    blocks: [
      { kind: "kpis", items: [
        { label: "Start", value: num(first.rating), sub: `Week of ${day(first.week)} · #${first.rank.toLocaleString("en-US")} worldwide` },
        { label: "End", value: num(end.rating), sub: `Week of ${day(end.week)} · #${end.rank.toLocaleString("en-US")} worldwide` },
        { label: "Change", value: signed(d), tone: d > 0 ? "good" : d < 0 ? "bad" : undefined },
        ...(live != null ? [{ label: "Team page rating now", value: num(live), sub: now?.rating?.rank ? `#${now.rating.rank.toLocaleString("en-US")} worldwide, live` : "Live", href: teamHref(team.number, season) }] : []),
      ] },
      { kind: "series", title: `Rating by week, ${S}`, points: weeks.map((w) => ({ x: day(w.week), y: Math.round(Number(w.rating) * 10) / 10, note: `#${w.rank.toLocaleString("en-US")} worldwide` })) },
    ],
  };
}
