// The pick helper (Scout → Pick helper): which partners at an event fill an alliance's gaps. Each team's
// engine rating components (auto, TeleOp without the endgame, endgame, and the penalty points it gives away
// a match), as the stats job stores them (team_season_stats.rating_*), are added up per alliance and put on
// a radar of four axes, each 0..1 against the best this event's teams could field on that axis alone. The
// partner whose alliance covers the most radar area comes first: area rewards an alliance strong on
// neighbouring axes, so a partner strong where the alliance is weak beats one strong where it's already strong.
// Pure, so the page, its tests and the methodology agree. Nothing here computes a rating.

/** The radar's axes, in the order they're drawn (clockwise from the top). Area depends on the order: each
 *  axis counts with its two neighbours (Auto with TeleOp and Fouls, TeleOp with Auto and Endgame, …). */
export const PICK_AXES = ["auto", "teleop", "endgame", "fouls"] as const;
export type PickAxis = (typeof PICK_AXES)[number];
export const PICK_AXIS_LABEL: Record<PickAxis, string> = { auto: "Auto", teleop: "TeleOp", endgame: "Endgame", fouls: "Few fouls" };

/** The most suggestions shown. */
export const PICK_LIMIT = 5;

/** One team at the event, with its engine rating components (points a match). */
export interface PickTeam {
  team: number;
  name: string | null;
  /** Qualification rank at this event (null before rankings post). */
  rank: number | null;
  auto: number;
  teleop: number;
  endgame: number;
  /** Penalty points it gives away a match (fewer is better). */
  fouls: number;
  /** Matches its rating is built from. */
  matches: number;
}

export interface PickAlliance { number: number; captain: number | null; pick1: number | null; pick2: number | null }

/** GET /api/events/:season/:code/pick-ratings. */
export interface PickRatings {
  season: number;
  code: string;
  name: string;
  /** Teams with a rating (the pool and the scale). */
  teams: PickTeam[];
  /** Teams at the event with no rating yet: never suggested. */
  unrated: number[];
  /** Playoff alliances as posted (empty before alliance selection). */
  alliances: PickAlliance[];
  /** Teams per alliance: 3 when a posted alliance has a second pick, otherwise 2. */
  size: 2 | 3;
  /** Where size came from: the posted alliances, or the usual 2 when none are posted. */
  sizeFrom: "alliances" | "default";
}

type Totals = Record<PickAxis, number>;
export type Axes = Record<PickAxis, number>;

/** What each axis is measured against: the event's best `size` teams on it added up (fouls: the worst `size`). */
export interface PickScale { size: number; auto: number; teleop: number; endgame: number; fouls: number }

const r1 = (x: number) => Math.round(x * 10) / 10;
const topSum = (xs: number[], n: number) => r1([...xs].sort((a, b) => b - a).slice(0, n).reduce((s, x) => s + x, 0));

/** The scale: per scoring axis, the event's top `size` teams added up; for fouls, its `size` most-fouling teams. */
export function pickScale(teams: readonly PickTeam[], size: number): PickScale {
  return {
    size,
    auto: topSum(teams.map((t) => t.auto), size),
    teleop: topSum(teams.map((t) => t.teleop), size),
    endgame: topSum(teams.map((t) => t.endgame), size),
    fouls: topSum(teams.map((t) => t.fouls), size),
  };
}

/** An alliance's value on each axis: its teams' ratings added up (fouls added up too, inverted on the radar). */
export function allianceTotals(members: readonly PickTeam[]): Totals {
  const sum = (k: PickAxis) => r1(members.reduce((s, t) => s + t[k], 0));
  return { auto: sum("auto"), teleop: sum("teleop"), endgame: sum("endgame"), fouls: sum("fouls") };
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Totals on the radar's 0..1 axes: total ÷ the scale's best (fouls: 1 − total ÷ the scale's worst). */
export function normalizeTotals(t: Totals, scale: PickScale): Axes {
  const of = (x: number, best: number) => (best > 0 ? clamp01(x / best) : 0);
  return {
    auto: of(t.auto, scale.auto),
    teleop: of(t.teleop, scale.teleop),
    endgame: of(t.endgame, scale.endgame),
    // No team at the event gives away points: every alliance is as clean as it gets.
    fouls: scale.fouls > 0 ? clamp01(1 - t.fouls / scale.fouls) : 1,
  };
}

/** A polygon's area on a radar of k evenly spaced axes: ½·sin(2π/k)·Σ rᵢ·rᵢ₊₁ (the last axis wraps to the first). */
export function radarArea(r: readonly number[]): number {
  const k = r.length;
  if (k < 3) return 0;
  let s = 0;
  for (let i = 0; i < k; i++) s += r[i] * r[(i + 1) % k];
  return 0.5 * Math.sin((2 * Math.PI) / k) * s;
}

/** The whole chart's area (every axis at 1): k/2·sin(2π/k). */
export const fullArea = (k: number) => radarArea(Array.from({ length: k }, () => 1));

export const axesList = (a: Axes) => PICK_AXES.map((k) => a[k]);
/** The share of the chart an alliance covers, 0..1. */
export const coverage = (a: Axes) => radarArea(axesList(a)) / fullArea(PICK_AXES.length);

export interface AllianceView { members: number[]; totals: Totals; axes: Axes; area: number; share: number }

export function allianceView(members: readonly PickTeam[], scale: PickScale): AllianceView {
  const totals = allianceTotals(members);
  const axes = normalizeTotals(totals, scale);
  const area = radarArea(axesList(axes));
  return { members: members.map((m) => m.team), totals, axes, area, share: area / fullArea(PICK_AXES.length) };
}

export interface PickGain { axis: PickAxis; /** Change on the 0..100 axis, as shown. */ points: number }

export interface PickSuggestion {
  team: PickTeam;
  result: AllianceView;
  /** Axes this partner moves by at least a point, most first. */
  gains: PickGain[];
  /** Axes it lowers by at least a point (a partner's fouls add to the alliance's), most first. */
  costs: PickGain[];
  /** Where it'd be by rating alone (auto + TeleOp + endgame), among the available teams; 1 = highest. */
  ratingPlace: number;
}

/** A 0..1 axis value as the page shows it, 0..100. */
export const pts = (x: number) => Math.round(x * 100);

/**
 * The partners that cover the most radar area with the alliance so far, best first (at most `limit`). Ties go to
 * the higher rating (auto + TeleOp + endgame), then the lower team number. `members`: the alliance so far (your
 * team first); `unavailable`: teams already on an alliance or marked taken.
 */
export function suggestPartners(opts: {
  teams: readonly PickTeam[];
  members: readonly number[];
  unavailable?: Iterable<number>;
  size: number;
  limit?: number;
}): { current: AllianceView; scale: PickScale; suggestions: PickSuggestion[]; pool: number } {
  const by = new Map(opts.teams.map((t) => [t.team, t]));
  const scale = pickScale(opts.teams, opts.size);
  const members = opts.members.map((n) => by.get(n)).filter((t): t is PickTeam => !!t);
  const current = allianceView(members, scale);
  const out = new Set<number>([...opts.members, ...(opts.unavailable ?? [])]);
  const pool = opts.teams.filter((t) => !out.has(t.team));
  if (opts.members.length >= opts.size) return { current, scale, suggestions: [], pool: pool.length };
  const np = (t: PickTeam) => t.auto + t.teleop + t.endgame;
  const byRating = [...pool].sort((a, b) => np(b) - np(a) || a.team - b.team);
  const place = new Map(byRating.map((t, i) => [t.team, i + 1]));
  const ranked = pool.map((t) => {
    const result = allianceView([...members, t], scale);
    const moves = PICK_AXES.map((axis) => ({ axis, points: pts(result.axes[axis]) - pts(current.axes[axis]) }));
    const gains = moves.filter((g) => g.points >= 1)
      .sort((a, b) => b.points - a.points || PICK_AXES.indexOf(a.axis) - PICK_AXES.indexOf(b.axis));
    const costs = moves.filter((g) => g.points <= -1).sort((a, b) => a.points - b.points);
    return { team: t, result, gains, costs, ratingPlace: place.get(t.team)! };
  }).sort((a, b) => b.result.area - a.result.area || np(b.team) - np(a.team) || a.team.team - b.team.team);
  return { current, scale, suggestions: ranked.slice(0, opts.limit ?? PICK_LIMIT), pool: pool.length };
}

/** Teams already on a posted alliance. */
export function alliancePicked(alliances: readonly PickAlliance[]): Set<number> {
  const s = new Set<number>();
  for (const a of alliances) for (const t of [a.captain, a.pick1, a.pick2]) if (t != null) s.add(t);
  return s;
}

/** The posted alliance a team is on, its members in pick order (captain first). */
export function allianceOf(alliances: readonly PickAlliance[], team: number): number[] | null {
  const a = alliances.find((x) => [x.captain, x.pick1, x.pick2].includes(team));
  return a ? [a.captain, a.pick1, a.pick2].filter((t): t is number => t != null) : null;
}
