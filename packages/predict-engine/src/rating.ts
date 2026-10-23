// Predict — Layer 1: team ratings (EPA-style, per game component).
//
// Each team carries an expected contribution to its alliance for auto,
// TeleOp (without endgame), endgame and penalties committed. After every
// played match the alliance's error on each component is split equally
// between its robots and folded in with a gain that shrinks as the team
// plays more (fast early, stable later). Playoff matches count less: teams
// play differently in eliminations.
//
// New season: games change, so raw points don't carry over. A team's final
// rating is turned into a z-score within its season and carried forward
// with decay (ρ1 for last season, ρ2 for the one before), scaled into the
// new season's units using the population seen so far. Teams with no
// history (rookies) start from a fitted rookie z with a wider uncertainty.
//
// Regional prior offsets (engine 2.7): how far a region's teams beat (or miss)
// the priors they are given differs by region, and the difference holds from
// season to season. Each region keeps, per phase, the shrunk mean "lift" of its
// returning teams this season: rating after their first few matches minus the
// prior they were given (offset included, so the lift is what the prior still
// got wrong). Every team new to the season starts from its prior plus its
// region's lift so far, the region being that of the event where it first
// plays: MatchRecord.region when its first result is folded in, and the
// prediction context's region (withRegion) when it is predicted before any
// result. Only returning teams teach the lift, so a season where no team has
// history (a cold start) is unchanged. Off when regionKappa = 0.
//
// Event-local form (engine 2.9): a robot is not a constant across a day. At
// an event, each team keeps the sum of its share of its alliances' misses
// there (actual minus what its ratings expected, per phase), and predictions
// AT THAT EVENT (withEvent) add a temporary adjustment of
//   eventLambda_c · mean miss_c · eventKappa / (matches there + eventKappa),
// capped at eventCap
// population standard deviations. The permanent rating is untouched: results
// are always judged against it, and the adjustment is gone at the team's
// next event. Off when every eventLambda is 0.
//
// Breaks between events: teams often come back from a few weeks off with a
// changed (rebuilt) robot. After a break of at least `rebuildGapWeeks`, a
// team's prediction is less certain (extra variance per week away) and its
// next matches move its rating faster (its gain experience is capped at
// `rebuildN`), so a rebuilt robot is picked up within a few matches.
import { COMPONENTS, type Component, type MatchRecord, type TeamRating } from "./types.js";

export interface RatingParams {
  /** Update gain for a team's first match. */
  k0: number;
  /** Matches over which the gain halves. */
  n0: number;
  /** Floor for the update gain. */
  kMin: number;
  /** Multiplier on updates from playoff matches. */
  playoffWeight: number;
  /** Carry-over of last season's z-score (0 = forget, 1 = full). */
  rho1: number;
  /** Carry-over of the season before last. */
  rho2: number;
  /** Prior z for teams with no history. */
  rookieZ: number;
  /** Per-phase share of a returning team's carried-over z (1 = the NP z applies in full to that phase).
   *  Engine 2.7: endgame mechanisms carry over far less between games than scoring does. Never applied
   *  to the no-history prior (rookieZ), which is a level, not a carry-over. */
  carryAuto: number;
  carryTeleop: number;
  carryEndgame: number;
  /** Regional prior offsets: shrinkage (pseudo-teams at zero lift); 0 turns them off. */
  regionKappa: number;
  /** A team's lift is measured once it has played this many rated matches. */
  regionFreezeN: number;
  /** Event-local form, per phase: share of a team's mean miss at this event added to its predictions there (0 = off). */
  eventLambdaAuto: number;
  eventLambdaTeleop: number;
  eventLambdaEndgame: number;
  /** How fast event-local form fades as matches there pile up (its weight is eventKappa / (n + eventKappa)). */
  eventKappa: number;
  /** Cap on event-local form, in population standard deviations of that phase. */
  eventCap: number;
  /** Starting prediction variance (points², per team) for known teams / rookies. */
  uncKnown: number;
  uncRookie: number;
  /** Per-match multiplicative decay of that variance, and its floor. */
  uncDecay: number;
  uncMin: number;
  /** EMA rate for the population baseline (per-robot average contribution). */
  baseAlpha: number;
  /** Season growth: fractional scoring improvement per week since a team's last match. */
  growthPerWeek: number;
  /** Cap on weeks of growth applied at once (long breaks). */
  growthMaxWeeks: number;
  /** A break (weeks since a team's last match) at least this long counts as a
   *  possible rebuild; 0 turns rebuild handling off. */
  rebuildGapWeeks: number;
  /** After such a break, the gain is computed as if the team had played at
   *  most this many matches. */
  rebuildN: number;
  /** Extra prediction variance (points², per robot) per week of break,
   *  counting at most growthMaxWeeks. */
  rebuildUncPerWeek: number;
  /** Population baseline update: "symmetric" (2.0+) folds both alliances
   *  of a match in together, so the baseline (and every newcomer's prior)
   *  doesn't depend on which side is listed first; "sequential" is the 1.1.0
   *  red-then-blue update, kept only to replay old versions exactly. */
  populationUpdate?: "symmetric" | "sequential";
}

export const DEFAULT_RATING_PARAMS: RatingParams = {
  k0: 0.5,
  n0: 6,
  kMin: 0.12,
  playoffWeight: 0.5,
  rho1: 0.6,
  rho2: 0.15,
  rookieZ: -0.4,
  carryAuto: 1,
  carryTeleop: 1,
  carryEndgame: 1,
  regionKappa: 0,
  regionFreezeN: 3,
  eventLambdaAuto: 0,
  eventLambdaTeleop: 0,
  eventLambdaEndgame: 0,
  eventKappa: 2,
  eventCap: 1,
  uncKnown: 150,
  uncRookie: 350,
  uncDecay: 0.8,
  uncMin: 10,
  baseAlpha: 0.002,
  growthPerWeek: 0.02,
  growthMaxWeeks: 8,
  rebuildGapWeeks: 0,
  rebuildN: 3,
  rebuildUncPerWeek: 0,
  populationUpdate: "symmetric",
};

/** True when two (possibly partial) settings objects mean the same RatingBook:
 *  missing fields take their defaults, unknown fields are ignored. */
export function sameRatingParams(x: Partial<RatingParams>, y: Partial<RatingParams>): boolean {
  const fx = { ...DEFAULT_RATING_PARAMS, ...x }, fy = { ...DEFAULT_RATING_PARAMS, ...y };
  return (Object.keys(DEFAULT_RATING_PARAMS) as (keyof RatingParams)[]).every((k) => fx[k] === fy[k]);
}

type Vec = Record<Component, number>;

export interface RatingBookData {
  params: RatingParams;
  ratings: [number, TeamRating][];
  base: Vec; baseSq: Vec; baseReady: boolean;
  history: [number, (number | null)[]][];
  season: number | null;
  now: number;
  /** Reliability state per team (engine 2.0+). Older data has none, and a
   *  book loaded from it predicts with the legacy probability model. */
  reliability?: [number, ReliabilityState][];
  /** Layout version of `reliability`: 1 = engine 2.0, 2 = engine 2.1 (adds form fields). */
  stateVersion?: number;
  /** Regional prior state (engine 2.7; absent = none learned yet). */
  regions?: RegionStateData;
  /** Event-local form (engine 2.9): each team's current event and its summed miss shares there. */
  events?: [number, EventForm][];
}

/** A team's event-local form: the event, its matches there, and its summed share of its alliances' misses. */
export interface EventForm { code: string; n: number; auto: number; teleop: number; endgame: number }

type Phases = { auto: number; teleop: number; endgame: number };

/** Serialized regional prior state: summed lifts per region, and the returning
 *  teams whose lift isn't measured yet (their region and the prior they were given). */
export interface RegionStateData {
  lift: [string, Phases & { n: number }][];
  pending: [number, Phases & { region: string }][];
}

/**
 * Causal reliability proxies for one robot (engine 2.0+), learned this
 * season from its alliances' standardized residuals. They come from alliance
 * totals, so they can't tell which partner caused a bad score: team-level
 * proxies, not observed robot failures.
 */
export interface ReliabilityState {
  /** EMA of the clipped standardized residual (positive = beats expectations). */
  bias: number;
  /** EMA of the clipped squared residual (1 = as variable as the model assumes). */
  variance: number;
  /** EMA of "the alliance scored under half its expected non-penalty points". */
  failure: number;
  /** Engine 2.1 (state version 2) form fields; absent in version-1 state. */
  /** Fast EMA (α 0.5) of the clipped residual: recent form. */
  fast?: number;
  /** 1 if the robot's last alliance collapsed (the failure test), else 0. */
  lastFail?: number;
  /** Matches since that last collapse (10 when none this season). */
  sinceFail?: number;
  /** Current event and the clipped residuals summed over its matches there. */
  eventCode?: string;
  eventSum?: number;
  eventN?: number;
}

/** Layout version of RatingBookData.reliability written by this engine. */
export const RELIABILITY_STATE_VERSION = 2;

/** Frozen state-update settings (FTC prediction validation, 16 Oct 2026). */
export const RELIABILITY_PARAMS = {
  biasAlpha: 0.2, varianceAlpha: 0.1, failureAlpha: 0.1,
  initialBias: 0, initialVariance: 1, initialFailure: 0.05,
  biasZClip: 4, varianceZSquaredClip: 25,
  failureExpectedNpMinimum: 40, failureActualFraction: 0.5,
  /** Residual scale σ = noiseA + noiseB · expected NP (fixed by the frozen model). */
  noiseA: 14, noiseB: 0.2,
} as const;

export const initialReliability = (): ReliabilityState => ({
  bias: RELIABILITY_PARAMS.initialBias, variance: RELIABILITY_PARAMS.initialVariance, failure: RELIABILITY_PARAMS.initialFailure,
  fast: 0, lastFail: 0, sinceFail: 10, eventSum: 0, eventN: 0,
});

/** One alliance observation (at `eventCode`) folded into a robot's reliability state. */
export function updateReliability(old: ReliabilityState, z: number, failed: boolean, eventCode?: string): ReliabilityState {
  const P = RELIABILITY_PARAMS;
  const zc = Math.max(-P.biasZClip, Math.min(P.biasZClip, z));
  const sameEvent = eventCode != null && old.eventCode === eventCode;
  return {
    bias: (1 - P.biasAlpha) * old.bias + P.biasAlpha * zc,
    variance: (1 - P.varianceAlpha) * old.variance + P.varianceAlpha * Math.min(P.varianceZSquaredClip, z * z),
    failure: (1 - P.failureAlpha) * old.failure + P.failureAlpha * (failed ? 1 : 0),
    fast: 0.5 * (old.fast ?? 0) + 0.5 * zc,
    lastFail: failed ? 1 : 0,
    sinceFail: failed ? 0 : (old.sinceFail ?? 10) + 1,
    ...(eventCode != null ? { eventCode, eventSum: (sameEvent ? old.eventSum ?? 0 : 0) + zc, eventN: (sameEvent ? old.eventN ?? 0 : 0) + 1 } : { eventSum: old.eventSum ?? 0, eventN: old.eventN ?? 0 }),
  };
}

/** Standardized residual and failure flag of an alliance result, measured
 *  against the expectation the book held before learning it. */
export function allianceResidual(expected: { np: number; uncertainty: number }, actualNp: number): { z: number; failed: boolean } {
  const P = RELIABILITY_PARAMS;
  const z = (actualNp - expected.np) / Math.sqrt((P.noiseA + P.noiseB * expected.np) ** 2 + expected.uncertainty);
  return { z, failed: expected.np >= P.failureExpectedNpMinimum && actualNp < P.failureActualFraction * expected.np };
}
const zero = (): Vec => ({ auto: 0, teleop: 0, endgame: 0, pen: 0 });

export const npOf = (r: { auto: number; teleop: number; endgame: number }) => r.auto + r.teleop + r.endgame;

export class RatingBook {
  readonly params: RatingParams;
  readonly ratings = new Map<number, TeamRating>();
  /** Population baseline: average per-robot contribution per component (EMA). */
  private base: Vec = zero();
  private baseSq: Vec = zero();
  private baseReady = false;
  /** Carried-over z-scores from earlier seasons (most recent first). */
  private history = new Map<number, number[]>();
  season: number | null = null;
  /** Current time (epoch ms): advanced by update(), or set for predictions. */
  now = 0;
  /** Reliability state of the teams that have played this season. */
  private reliability = new Map<number, ReliabilityState>();
  /** Regional prior offsets (engine 2.7): summed lift per region and phase, and how many teams it holds. */
  private regionLift = new Map<string, Phases & { n: number }>();
  /** Returning teams whose lift isn't measured yet: their region and the prior they were given. */
  private regionPending = new Map<number, Phases & { region: string }>();
  /** Teams being created by the match being folded in, and its region (empty between updates). */
  private arriving = new Map<number, string>();
  /** The region of the event being predicted (withRegion): newcomers' priors include its offset. */
  private hint: string | null = null;
  /** Event-local form per team (engine 2.9), for the event it is playing now. */
  private eventForm = new Map<number, EventForm>();
  /** The event being predicted (withEvent): its teams' predictions include their form there. */
  private eventHint: string | null = null;
  /**
   * True when the reliability state covers the whole season so far (a book
   * that started the season itself, or one loaded with 2.0+ state). Data
   * from older versions has none; the contextual probability model must not
   * run on an invented history, so predictions fall back to the legacy model.
   */
  reliabilityReady = true;
  /** Layout version of the state this book holds (2 when built by this engine;
   *  1 when loaded from engine 2.0 data, which lacks the 2.1 form fields). */
  stateVersion = RELIABILITY_STATE_VERSION;

  constructor(params: Partial<RatingParams> = {}) {
    this.params = { ...DEFAULT_RATING_PARAMS, ...params };
  }

  /** Start a new season: snapshot z-scores of the finished one, clear ratings. */
  startSeason(season: number): void {
    if (this.season != null && this.ratings.size) {
      const totals = [...this.ratings.entries()].filter(([, r]) => r.n >= 3).map(([t, r]) => [t, npOf(r)] as const);
      const vals = totals.map(([, v]) => v);
      const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1)) || 1;
      const seen = new Set<number>();
      for (const [t, v] of totals) {
        seen.add(t);
        const prev = this.history.get(t) ?? [];
        this.history.set(t, [(v - mean) / sd, ...prev].slice(0, 2));
      }
      // Teams that didn't play enough last season age their history by one slot.
      for (const [t, h] of this.history) if (!seen.has(t)) this.history.set(t, [NaN, ...h].slice(0, 2));
    }
    this.season = season;
    this.ratings.clear();
    this.base = zero();
    this.baseSq = zero();
    this.baseReady = false;
    this.now = 0;
    this.reliability.clear();
    this.reliabilityReady = true;
    this.stateVersion = RELIABILITY_STATE_VERSION;
    this.regionLift.clear();
    this.regionPending.clear();
    this.eventForm.clear();
  }

  /** Move the clock (e.g. to an event's start before predicting it). */
  setTime(ms: number): void {
    if (ms > this.now) this.now = ms;
  }

  /** Season-growth factor for a rating last updated at `asOf`, evaluated at `at`. */
  private growth(asOf: number | undefined, at: number): number {
    if (asOf == null || at <= asOf) return 1;
    const weeks = Math.min(this.params.growthMaxWeeks, (at - asOf) / (7 * 864e5));
    return 1 + this.params.growthPerWeek * weeks;
  }

  /** Weeks of break counted for rebuild handling (0 if it doesn't apply). */
  private breakWeeks(r: TeamRating, at: number): number {
    const { rebuildGapWeeks, growthMaxWeeks } = this.params;
    if (!rebuildGapWeeks || !r.n || r.asOf == null) return 0;
    const weeks = (at - r.asOf) / (7 * 864e5);
    return weeks >= rebuildGapWeeks ? Math.min(weeks, growthMaxWeeks) : 0;
  }

  /** Spread of per-robot contributions in this season so far (per component). */
  private sd(c: Component): number {
    const v = this.baseSq[c] - this.base[c] ** 2;
    return Math.sqrt(Math.max(v, 1));
  }

  /** Prior z for a team from its carried-over history (NaN slots = no data that season). */
  priorZ(team: number): { z: number; known: boolean } {
    const h = this.history.get(team);
    const { rho1, rho2, rookieZ } = this.params;
    if (!h || h.every((x) => Number.isNaN(x))) return { z: rookieZ, known: false };
    const z1 = h[0], z2 = h[1];
    if (!Number.isNaN(z1)) return { z: rho1 * z1 + (z2 !== undefined && !Number.isNaN(z2) ? rho2 * z2 : 0), known: true };
    // Skipped last season: use the older one with the combined decay.
    return { z: rho1 * rho2 * (z2 ?? 0) + (1 - rho1) * rookieZ, known: true };
  }

  /** A new team's season prior (not stored until it plays). */
  private prior(): TeamRating {
    const p = this.params;
    return { auto: 0, teleop: 0, endgame: 0, pen: this.base.pen, n: 0, uncertainty: this.baseReady ? p.uncKnown : p.uncRookie * 2, asOf: this.now };
  }

  /** Regional offset (points per phase) a team new to the season starts with at an event of `region`:
   *  the shrunk mean lift of the region's returning teams so far. */
  regionOffset(region: string): Phases {
    const k = this.params.regionKappa, L = k > 0 ? this.regionLift.get(region) : undefined;
    if (!L) return { auto: 0, teleop: 0, endgame: 0 };
    const d = L.n + k;
    return { auto: L.auto / d, teleop: L.teleop / d, endgame: L.endgame / d };
  }

  /**
   * Run `fn` with predictions for an event of `region`: a team with no rating
   * yet this season gets the regional starting point it will be stored with
   * at its first result there. A null region (or offsets off) changes nothing.
   */
  withRegion<T>(region: string | null | undefined, fn: () => T): T {
    if (!region || this.params.regionKappa <= 0) return fn();
    const prev = this.hint;
    this.hint = region;
    try { return fn(); } finally { this.hint = prev; }
  }

  private priorFor(team: number): TeamRating {
    const r = this.basePrior(team);
    const region = this.arriving.get(team) ?? this.hint;
    if (region != null && this.params.regionKappa > 0) {
      const o = this.regionOffset(region);
      r.auto = Math.max(0, r.auto + o.auto);
      r.teleop = Math.max(0, r.teleop + o.teleop);
      r.endgame = Math.max(0, r.endgame + o.endgame);
    }
    return r;
  }

  /** The season prior from history alone (no regional offset). */
  private basePrior(team: number): TeamRating {
    const { z, known } = this.priorZ(team);
    const p = this.params;
    // Scale the prior z into this season's units. Penalties are not
    // carried over (z describes scoring strength); start at the baseline.
    const r = this.prior();
    const carry = (c: number) => (known ? c : 1);
    r.auto = Math.max(0, this.base.auto + z * carry(p.carryAuto) * this.sd("auto"));
    r.teleop = Math.max(0, this.base.teleop + z * carry(p.carryTeleop) * this.sd("teleop"));
    r.endgame = Math.max(0, this.base.endgame + z * carry(p.carryEndgame) * this.sd("endgame"));
    r.uncertainty = !this.baseReady ? p.uncRookie * 2 : known ? p.uncKnown : p.uncRookie;
    return r;
  }

  /**
   * Rating as of now, as a copy: the stored rating (as of the team's last
   * match) grown for the time since. Reading never changes stored ratings,
   * so ratings depend only on match history. Unknown teams get their prior.
   */
  get(team: number): TeamRating {
    const r = this.ratings.get(team) ?? this.priorFor(team);
    const f = this.growth(r.asOf, this.now);
    const unc = r.uncertainty + this.params.rebuildUncPerWeek * this.breakWeeks(r, this.now);
    const out = { ...r, auto: r.auto * f, teleop: r.teleop * f, endgame: r.endgame * f, uncertainty: unc };
    if (this.eventHint != null) {
      const e = this.eventOffset(team, this.eventHint);
      if (e) { out.auto = Math.max(0, out.auto + e.auto); out.teleop = Math.max(0, out.teleop + e.teleop); out.endgame = Math.max(0, out.endgame + e.endgame); }
    }
    return out;
  }

  /**
   * Run `fn` with predictions for a match at event `code`: each team's ratings include its
   * event-local form there (engine 2.9). Results are never folded in under it.
   */
  withEvent<T>(code: string | null | undefined, fn: () => T): T {
    const p = this.params;
    if (!code || (!p.eventLambdaAuto && !p.eventLambdaTeleop && !p.eventLambdaEndgame)) return fn();
    const prev = this.eventHint;
    this.eventHint = code;
    try { return fn(); } finally { this.eventHint = prev; }
  }

  /** A team's event-local form state (its current event, matches there and summed misses), as a copy. */
  eventFormOf(team: number): EventForm | null {
    const s = this.eventForm.get(team);
    return s ? { ...s } : null;
  }

  /** A team's event-local form adjustment at `code` (points per phase), or null when it has none there. */
  eventOffset(team: number, code: string): Phases | null {
    const s = this.eventForm.get(team), p = this.params;
    if (!s || s.code !== code || !s.n || (!p.eventLambdaAuto && !p.eventLambdaTeleop && !p.eventLambdaEndgame)) return null;
    const one = (lambda: number, sum: number, c: Component) => {
      const cap = p.eventCap * this.sd(c);
      // Mean miss there, weighted down as matches there pile up (the permanent rating catches up).
      return Math.max(-cap, Math.min(cap, lambda * (sum / s.n) * (p.eventKappa / (s.n + p.eventKappa))));
    };
    return { auto: one(p.eventLambdaAuto, s.auto, "auto"), teleop: one(p.eventLambdaTeleop, s.teleop, "teleop"), endgame: one(p.eventLambdaEndgame, s.endgame, "endgame") };
  }

  /** A team's reliability state now (the season-start value if it hasn't played). */
  reliabilityOf(team: number): ReliabilityState {
    const r = this.reliability.get(team);
    return r ? { ...r } : initialReliability();
  }

  /** Stored rating, created from the prior on a team's first match. */
  private stored(team: number): TeamRating {
    let r = this.ratings.get(team);
    if (!r) { r = this.priorFor(team); this.ratings.set(team, r); }
    return r;
  }

  /** Expected alliance components for a set of robots. */
  allianceExpectation(teams: number[]): Vec & { np: number; uncertainty: number } {
    const out = { ...zero(), np: 0, uncertainty: 0 };
    for (const t of teams) {
      const r = this.get(t);
      for (const c of COMPONENTS) out[c] += r[c];
      out.uncertainty += r.uncertainty;
    }
    out.np = npOf(out);
    return out;
  }

  /** Fold one played match into the ratings. */
  update(m: MatchRecord): void {
    // A result is folded in with its own region (MatchRecord.region), never a prediction's.
    const hint = this.hint, eventHint = this.eventHint;
    this.hint = null;
    this.eventHint = null;
    try { this.fold(m); } finally { this.hint = hint; this.eventHint = eventHint; }
  }

  private fold(m: MatchRecord): void {
    const p = this.params;
    this.setTime(m.time);
    // A team's first rated match of the season fixes its region: its prior includes that region's offset,
    // both in the expectation this result is judged against and in the rating it is stored with.
    if (p.regionKappa > 0 && m.region) for (const t of [...m.red.teams, ...m.blue.teams]) if (!this.ratings.has(t)) this.arriving.set(t, m.region);
    const weight = m.level === "playoff" ? p.playoffWeight : 1;
    // Both alliances are judged against the book as it stood before this
    // match: expectations (and any newcomer's prior, which depends on the
    // population baseline) are taken first, and the baseline only moves
    // after both alliances are folded in. Before, red's result moved the
    // baseline before blue's newcomers got their priors, so the two sides of
    // one match saw different priors (and blue's saw this match's result).
    const sides = [m.red, m.blue].map((al) => ({
      al,
      exp: this.allianceExpectation(al.teams),
      actual: { auto: al.auto, teleop: al.teleop, endgame: al.endgame, pen: al.penCommitted } as Vec,
      share: 1 / al.teams.length,
    }));
    for (const t of [...m.red.teams, ...m.blue.teams]) this.stored(t); // priors from the pre-match baseline
    for (const [t, region] of this.arriving) {
      const b = this.ratings.get(t)!;
      if (this.priorZ(t).known) this.regionPending.set(t, { region, auto: b.auto, teleop: b.teleop, endgame: b.endgame });
    }
    this.arriving.clear();
    for (const { al, exp, actual, share } of sides) {
      for (const t of al.teams) {
        const r = this.stored(t);
        // Back from a break: less certain, and quicker to move (possible rebuild).
        const away = this.breakWeeks(r, this.now);
        if (away) {
          r.uncertainty += p.rebuildUncPerWeek * away;
          r.gainN = Math.min(r.gainN ?? r.n, p.rebuildN);
        }
        // Fold growth since the team's last match into the stored rating.
        const f = this.growth(r.asOf, this.now);
        r.auto *= f; r.teleop *= f; r.endgame *= f; r.asOf = this.now;
        const k = Math.max(p.kMin, p.k0 / (1 + (r.gainN ?? r.n) / p.n0)) * weight;
        for (const c of COMPONENTS) {
          r[c] += k * (actual[c] - exp[c]) * share;
          if (r[c] < 0) r[c] = 0; // contributions and penalties are never negative
        }
        r.n += 1;
        if (r.gainN != null) r.gainN += 1;
        r.uncertainty = Math.max(p.uncMin, r.uncertainty * p.uncDecay);
      }
    }
    // Regional lift: once a team has played regionFreezeN rated matches, how far it has moved from the
    // prior it was given joins its region's lift (measured once per team and season).
    if (p.regionKappa > 0) for (const t of [...m.red.teams, ...m.blue.teams]) {
      const base = this.regionPending.get(t), r = this.ratings.get(t);
      if (!base || !r || r.n < p.regionFreezeN) continue;
      const L = this.regionLift.get(base.region) ?? { auto: 0, teleop: 0, endgame: 0, n: 0 };
      L.auto += r.auto - base.auto; L.teleop += r.teleop - base.teleop; L.endgame += r.endgame - base.endgame; L.n += 1;
      this.regionLift.set(base.region, L);
      this.regionPending.delete(t);
    }
    // Event-local form: each robot's share of its alliance's miss against its permanent ratings,
    // summed over its matches at this event (a new event starts it over).
    for (const { al, exp, actual, share } of sides) {
      for (const t of al.teams) {
        const prev = this.eventForm.get(t), s = prev && prev.code === m.eventCode ? prev : { code: m.eventCode, n: 0, auto: 0, teleop: 0, endgame: 0 };
        this.eventForm.set(t, { code: m.eventCode, n: s.n + 1, auto: s.auto + (actual.auto - exp.auto) * share, teleop: s.teleop + (actual.teleop - exp.teleop) * share, endgame: s.endgame + (actual.endgame - exp.endgame) * share });
      }
    }
    // Reliability: each alliance's standardized residual against the
    // expectation held before this match, applied to every robot on it.
    for (const { al, exp } of sides) {
      const { z, failed } = allianceResidual(exp, al.auto + al.teleop + al.endgame);
      for (const t of al.teams) this.reliability.set(t, updateReliability(this.reliabilityOf(t), z, failed, m.eventCode));
    }
    if (p.populationUpdate === "sequential") {
      // Population baseline from raw per-robot shares (independent of ratings),
      // after both alliances, in the same red-then-blue order as before.
      for (const { actual, share } of sides) {
        for (const c of COMPONENTS) {
          const x = actual[c] * share;
          if (!this.baseReady) { this.base[c] = x; this.baseSq[c] = x * x; }
          else {
            this.base[c] += p.baseAlpha * (x - this.base[c]);
            this.baseSq[c] += p.baseAlpha * (x * x - this.baseSq[c]);
          }
        }
        this.baseReady = true;
      }
    } else {
      // Symmetric: both alliances' per-robot shares enter together (the
      // season's first match seeds the baseline with their mean), so the
      // order the alliances are listed in can't move the baseline.
      const robots = sides.reduce((n, x) => n + x.al.teams.length, 0);
      const alpha = 1 - (1 - p.baseAlpha) ** sides.length;
      for (const c of COMPONENTS) {
        const first = sides.reduce((n, x) => n + x.actual[c], 0) / robots;
        const second = sides.reduce((n, x) => n + (x.actual[c] * x.share) ** 2 * x.al.teams.length, 0) / robots;
        if (!this.baseReady) { this.base[c] = first; this.baseSq[c] = second; }
        else { this.base[c] += alpha * (first - this.base[c]); this.baseSq[c] += alpha * (second - this.baseSq[c]); }
      }
      this.baseReady = true;
    }
  }

  /** Independent copy of the whole book (ratings, baseline, history, clock). */
  clone(): RatingBook {
    const c = new RatingBook(this.params);
    for (const [t, r] of this.ratings) c.ratings.set(t, { ...r });
    c.base = { ...this.base };
    c.baseSq = { ...this.baseSq };
    c.baseReady = this.baseReady;
    c.history = new Map([...this.history].map(([t, h]) => [t, [...h]]));
    c.season = this.season;
    c.now = this.now;
    c.reliability = new Map([...this.reliability].map(([t, r]) => [t, { ...r }]));
    c.reliabilityReady = this.reliabilityReady;
    c.stateVersion = this.stateVersion;
    c.regionLift = new Map([...this.regionLift].map(([k, v]) => [k, { ...v }]));
    c.regionPending = new Map([...this.regionPending].map(([t, v]) => [t, { ...v }]));
    c.eventForm = new Map([...this.eventForm].map(([t, v]) => [t, { ...v }]));
    return c;
  }

  /**
   * Plain-JSON copy (for the offline pack), optionally only some teams'
   * ratings and history; the population baseline is always kept.
   */
  toData(teams?: Set<number>): RatingBookData {
    const keep = (t: number) => !teams || teams.has(t);
    return {
      params: this.params,
      ratings: [...this.ratings].filter(([t]) => keep(t)).map(([t, r]) => [t, { ...r }]),
      base: { ...this.base }, baseSq: { ...this.baseSq }, baseReady: this.baseReady,
      // JSON has no NaN (a season a team skipped): stored as null.
      history: [...this.history].filter(([t]) => keep(t)).map(([t, h]) => [t, h.map((z) => (Number.isFinite(z) ? z : null))]),
      season: this.season, now: this.now,
      // Only a complete state is written; a book without one stays legacy.
      ...(this.reliabilityReady ? {
        reliability: [...this.reliability].filter(([t]) => keep(t)).map(([t, r]) => [t, { ...r }] as [number, ReliabilityState]),
        stateVersion: this.stateVersion,
      } : {}),
      // Regional state only when it is in use, so books without it serialize exactly as before.
      ...(this.params.regionKappa > 0 ? { regions: {
        lift: [...this.regionLift].map(([k, v]) => [k, { ...v }] as [string, Phases & { n: number }]),
        pending: [...this.regionPending].filter(([t]) => keep(t)).map(([t, v]) => [t, { ...v }] as [number, Phases & { region: string }]),
      } } : {}),
      // Event-local form only when it is in use, so books without it serialize exactly as before.
      ...(this.params.eventLambdaAuto || this.params.eventLambdaTeleop || this.params.eventLambdaEndgame
        ? { events: [...this.eventForm].filter(([t]) => keep(t)).map(([t, v]) => [t, { ...v }] as [number, EventForm]) } : {}),
    };
  }

  static fromData(d: RatingBookData): RatingBook {
    const b = new RatingBook(d.params);
    for (const [t, r] of d.ratings) b.ratings.set(t, { ...r });
    b.base = { ...d.base };
    b.baseSq = { ...d.baseSq };
    b.baseReady = d.baseReady;
    b.history = new Map(d.history.map(([t, h]) => [t, h.map((z) => z ?? NaN)]));
    b.season = d.season;
    b.now = d.now;
    // Pre-2.0 data (or an unknown layout) has no usable reliability state.
    // Version-1 state (engine 2.0) is usable by the 2.0 model only.
    b.reliabilityReady = (d.stateVersion === 1 || d.stateVersion === 2) && Array.isArray(d.reliability);
    b.stateVersion = b.reliabilityReady ? d.stateVersion! : 0;
    if (b.reliabilityReady) for (const [t, r] of d.reliability!) b.reliability.set(t, { ...r });
    if (d.regions) {
      b.regionLift = new Map(d.regions.lift.map(([k, v]) => [k, { ...v }]));
      b.regionPending = new Map(d.regions.pending.map(([t, v]) => [t, { ...v }]));
    }
    if (d.events) b.eventForm = new Map(d.events.map(([t, v]) => [t, { ...v }]));
    return b;
  }

  /**
   * Population baseline: the season's average per-robot contribution per
   * component so far (read-only copy; null before any match is folded in).
   */
  baseline(): Vec | null {
    return this.baseReady ? { ...this.base } : null;
  }

  /** Copy of current ratings, grown to now (for "as of event start" snapshots). */
  snapshot(): Map<number, TeamRating> {
    const m = new Map<number, TeamRating>();
    for (const t of this.ratings.keys()) m.set(t, this.get(t));
    return m;
  }
}
