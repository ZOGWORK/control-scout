// How a team's number changed, from stored rows only (never worked out per request):
//   "how much did 4215's opr improve from last season to this season" → both seasons' OPR (the team page's season
//     rows), the difference, and the world standing each season (OPR in points is a different game each season, so
//     the standing is the like-for-like comparison, said so)
//   "how much did 4215's rating change this season" → the rating in the earliest and the last stored week of the
//     season (the weekly Rankings snapshots, ranking_snapshots), the difference, the weeks between, and the team
//     page's live rating beside them
// No season named: "this season" is the default season (the latest completed one, ../season.ts), "last season" the one
// before it.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { dateRange, num, possessive, seasonLabel } from "../../../../src/shared/format.js";
import { all, get } from "../../../db.js";
import { seasonStats } from "../../teams.js";
import { readScope } from "../read.js";
import { searchSeason } from "../season.js";
import { teamHref } from "../matchSet.js";

export interface ChangeQuestion {
  stat: "opr" | "rating";
  core: string;
  /** Two seasons ("from last season to this season"), or one ("this season": within it). */
  from: number | null;
  to: number;
}

const CHANGE = String.raw`(?:improve[ds]?|improvement|change[ds]?|grow|grew|go up|went up|increase[ds]?|rise|rose|drop(?:ped)?|fall|fell|go down|went down|decrease[ds]?)`;

/** A season in words or as one ("last season", "this season", "2024-25"): its number, or null. */
function seasonIn(words: string): number | null | undefined {
  const { scope, rest } = readScope(` ${words} `);
  if (rest.replace(/\b(?:the|season|year)\b/g, "").trim()) return undefined;
  return scope.season ?? (scope.latest ? searchSeason() : null);
}

/** "how much did 4215's opr improve from last season to this season", "4215 rating change this season", or null. */
export function readChange(raw: string): ChangeQuestion | null {
  const q = raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!,.]/g, " ").replace(/\s+/g, " ").trim();
  const m = new RegExp(String.raw`^(?:how much (?:did|has|have|does) |what (?:was|is) )?(?:the )?(.+?) (opr|(?:prediction )?rating) (?:${CHANGE})(?: by)?(?: (.+))?$`).exec(q);
  if (!m || /\b(?:vs|versus|and|or)\b/.test(m[1])) return null;
  const stat = m[2] === "opr" ? "opr" : "rating";
  const tail = (m[3] ?? "").trim();
  const def = searchSeason();
  const two = /^(?:from|between) (.+?) (?:to|and) (.+)$/.exec(tail) ?? (/^since (.+)$/.exec(tail) ? [tail, tail.slice(6), "this season"] : null);
  if (two) {
    const a = seasonIn(two[1]), b = seasonIn(two[2]);
    if (a == null || b == null || a === b) return null;
    return { stat, core: m[1], from: Math.min(a, b), to: Math.max(a, b) };
  }
  if (!tail) return stat === "opr" ? { stat, core: m[1], from: def - 1, to: def } : { stat, core: m[1], from: null, to: def };
  const one = seasonIn(tail.replace(/^(?:in|during|over|across) /, ""));
  if (one == null) return null;
  // One season: a rating moves within it; OPR is a season's best event, so it's set against the season before.
  return stat === "opr" ? { stat, core: m[1], from: one - 1, to: one } : { stat, core: m[1], from: null, to: one };
}

type Team = { number: number; name: string | null };
const who = (t: Team) => `${t.number}${t.name ? ` ${t.name}` : ""}`;
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${num(Math.abs(x))}`;
const top = (rank: number, of: number) => `top ${Math.max(1, Math.ceil((100 * rank) / of))}%`;

export async function changeAnswer(c: ChangeQuestion, team: Team): Promise<StatAnswer> {
  return c.from != null ? seasonsAnswer(c, c.from, team) : withinAnswer(c.to, team);
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
async function withinAnswer(season: number, team: Team): Promise<StatAnswer> {
  const S = seasonLabel(season);
  const [all_, now] = await Promise.all([
    all<{ week: string; rating: number; rank: number }>("SELECT week, rating, rank FROM ranking_snapshots WHERE season = ? AND team = ? ORDER BY week", [season, team.number]),
    seasonStats(season, team.number),
  ]);
  // Weeks after the team's last change (the off-season, no matches) repeat the final standing: the first one stays.
  let last = all_.length - 1;
  while (last > 0 && Number(all_[last].rating) === Number(all_[last - 1].rating)) last--;
  const weeks = all_.slice(0, last + 1);
  const base = {
    family: "trend" as const, intent: "rating-change", title: `Prediction rating change in ${S}`, team, scope: [S],
    definition: `Prediction rating: the engine's points-per-match strength, from the weekly Rankings snapshots (a team is in a week's snapshot once 3 of its matches are rated). The start is the earliest week of ${S} kept; the end is the season's last week with a change, its final standing. The team page shows the engine's live ${S} rating, which isn't one of these weekly snapshots, so it is listed beside them and not used for the change.${season === searchSeason() ? ` With no other season named, "this season" is ${S}, the latest completed season (its FIRST Championship has finished).` : ""}`,
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
