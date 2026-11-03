// Research R1 (rating systems beyond Elo): three challenger raters, replayed causally on the backtest corpus by
// scripts/research/r1-rating-systems.ts. Research only: nothing here ships in packages/predict-engine.
//
// All three see only what the FIRST API publishes: alliance totals and the per-phase breakdown (auto, TeleOp,
// endgame, penalties committed). No per-robot data. A 2-robot alliance's strength is the SUM of its robots'
// ratings in every method (the same assumption the engine's EPA ratings make), which is what lets alliance-level
// results identify team-level ratings when qualification partners are randomised.
//
//   Massey     ridge least squares on score margins: margin ≈ (r1 + r2) − (r3 + r4), solved on every rated match
//              before the prediction (conjugate gradients each new day, Gauss–Seidel on the four robots after each match). Vector-valued: total margin plus the four phase
//              margins (auto, TeleOp, endgame, penalty points gained) share the same normal equations.
//   TrueSkill  Gaussian skill per robot (μ, σ); alliance performance = sum of its robots' performances; win/loss/draw
//              moment-matching update (Herbrich et al. 2007, two teams of two).
//   Glicko-2   (μ, φ, σ) per robot; each robot's opponent is the composite "opponents minus partner", so the
//              expected score is the alliance-sum model's; one rating period per match (Glickman 2012, adapted).
import type { AllianceResult, MatchRecord } from "@control-scout/predict-engine";

/** What a rater says about a match before it is played (red's point of view). */
export interface RaterCall {
  /** Strength difference on the method's own probability scale: P(red) = σ(a·z) after the rolling Platt fit. */
  z: number;
  /** Share of the prediction's variance that is rating uncertainty (0 = all known, → 1 = nothing known). */
  u: number;
  /** Native expected margin in points (Massey), or a points-scaled strength difference to be mapped by a fitted slope. */
  margin: number;
  /** True when `margin` is already in points (no fitted mapping needed). */
  nativeMargin: boolean;
  /** Massey only: per-phase margin z-scores (auto, TeleOp, endgame, penalties gained). */
  phases?: number[];
}

export interface Rater {
  readonly name: string;
  startSeason(season: number): void;
  /** Called before every predicted match with its start time (lets Massey re-solve when the day changes). */
  setTime(time: number): void;
  predict(m: MatchRecord): RaterCall;
  update(m: MatchRecord): void;
}

/** Season scale: running mean alliance score and RMS margin this season (rated matches), seeded from last season. */
export class SeasonScale {
  private sumScore = 0; private nScore = 0; private sumSq = 0; private nSq = 0;
  private prevMean = 0; private prevRms = 0;
  private static readonly PSEUDO = 20;
  startSeason(): void {
    if (this.nScore) { this.prevMean = this.sumScore / this.nScore; this.prevRms = Math.sqrt(this.sumSq / this.nSq); }
    this.sumScore = 0; this.nScore = 0; this.sumSq = 0; this.nSq = 0;
  }
  /** Mean alliance score so far this season; the first few matches lean on last season's level. */
  mean(): number {
    const p = this.prevMean ? SeasonScale.PSEUDO : 0;
    return this.nScore + p ? (this.sumScore + p * this.prevMean) / (this.nScore + p) : 100;
  }
  /** Last season's mean alliance score (0 in the first season). */
  previousMean(): number { return this.prevMean; }
  /** RMS of realised margins this season; seeded by last season's RMS rescaled to this season's score level. */
  rms(): number {
    const seed = this.prevRms && this.prevMean ? this.prevRms * (this.mean() / this.prevMean) : 0.6 * this.mean();
    const p = SeasonScale.PSEUDO;
    return Math.sqrt((this.sumSq + p * seed * seed) / (this.nSq + p));
  }
  update(m: MatchRecord): void {
    this.sumScore += m.red.total + m.blue.total; this.nScore += 2;
    this.sumSq += (m.red.total - m.blue.total) ** 2; this.nSq++;
  }
}

/** Red-minus-blue targets: total margin, then the phases that add up to it. */
export const TARGETS = ["total", "auto", "teleop", "endgame", "pen"] as const;
export function targets(a: AllianceResult, b: AllianceResult): number[] {
  return [a.total - b.total, a.auto - b.auto, a.teleop - b.teleop, a.endgame - b.endgame, b.penCommitted - a.penCommitted];
}
const K = TARGETS.length;
const dayOf = (t: number) => Math.floor(t / 864e5);

// ---------------------------------------------------------------- Massey

export interface MasseyParams {
  /** Ridge strength: pseudo-matches pulling each robot toward its prior (last season's carried rating, else 0 = average). */
  lambda: number;
  /** Carry-over of last season's standardised rating into this season's prior. */
  rho: number;
}
interface MasseyTeam { n: number; nb: Map<number, number>; b: number[]; r: number[] }

export class Massey implements Rater {
  readonly name = "massey";
  private teams = new Map<number, MasseyTeam>();
  /** Last season's rating per robot in SDs of that season's ratings (robots with 5+ matches). */
  private carried = new Map<number, number[]>();
  /** Last season's rating SD per target as a share of its mean alliance score. */
  private sdShare = new Array(K).fill(0);
  private scale = new SeasonScale();
  private day = -1;
  /** Running mean of e²/f (e = total-margin miss before the match, f = 1 + Σ 1/(n+λ)): the game-noise variance. */
  private s2sum = 0; private s2n = 0; private s2share = 0.6;
  sweeps = 0;
  constructor(readonly p: MasseyParams) {}

  startSeason(): void {
    if (this.teams.size) {
      const sd = new Array(K).fill(0); let n = 0;
      for (const t of this.teams.values()) if (t.n >= 5) { n++; for (let k = 0; k < K; k++) sd[k] += t.r[k] ** 2; }
      for (let k = 0; k < K; k++) sd[k] = Math.sqrt(sd[k] / Math.max(1, n)) || 1;
      this.carried = new Map([...this.teams].filter(([, t]) => t.n >= 1).map(([id, t]) => [id, t.r.map((x, k) => x / sd[k])]));
      const mean = this.scale.mean();
      this.sdShare = sd.map((x) => x / mean);
      if (this.s2n) this.s2share = Math.sqrt(this.s2sum / this.s2n) / mean;
    }
    this.teams = new Map(); this.scale.startSeason(); this.day = -1; this.s2sum = 0; this.s2n = 0;
  }
  private prior(id: number, k: number): number {
    const c = this.carried.get(id);
    return c ? this.p.rho * c[k] * this.sdShare[k] * this.scale.mean() : 0;
  }
  private team(id: number): MasseyTeam {
    let t = this.teams.get(id);
    if (!t) { t = { n: 0, nb: new Map(), b: new Array(K).fill(0), r: Array.from({ length: K }, (_, k) => this.prior(id, k)) }; this.teams.set(id, t); }
    return t;
  }
  /** One Gauss–Seidel step for one robot; returns the largest change (points). */
  private relax(id: number): number {
    const t = this.teams.get(id)!; const L = this.p.lambda; let d = 0;
    for (let k = 0; k < K; k++) {
      let s = t.b[k] + L * this.prior(id, k);
      for (const [o, c] of t.nb) s -= c * this.teams.get(o)!.r[k];
      const v = s / (t.n + L);
      d = Math.max(d, Math.abs(v - t.r[k])); t.r[k] = v;
    }
    return d;
  }
  /** Full solve at the first match of each UTC day: Jacobi-preconditioned conjugate gradients per target, warm-started,
   *  until no robot's residual moves its rating by more than 0.01 points (at most 200 iterations). */
  setTime(time: number): void {
    const d = dayOf(time);
    if (d === this.day) return;
    this.day = d;
    const ids = [...this.teams.keys()], N = ids.length, L = this.p.lambda;
    if (!N) return;
    const at = new Map(ids.map((id, i) => [id, i]));
    const T = ids.map((id) => this.teams.get(id)!), diag = T.map((t) => t.n + L);
    const nbI = T.map((t) => [...t.nb.keys()].map((o) => at.get(o)!)), nbC = T.map((t) => [...t.nb.values()]);
    const mul = (x: Float64Array, out: Float64Array) => { for (let i = 0; i < N; i++) { let s = diag[i] * x[i]; const I = nbI[i], C = nbC[i]; for (let j = 0; j < I.length; j++) s += C[j] * x[I[j]]; out[i] = s; } };
    for (let k = 0; k < K; k++) {
      const x = Float64Array.from(T, (t) => t.r[k]), r = new Float64Array(N), z = new Float64Array(N), q = new Float64Array(N);
      mul(x, q);
      for (let i = 0; i < N; i++) r[i] = T[i].b[k] + L * this.prior(ids[i], k) - q[i];
      for (let i = 0; i < N; i++) z[i] = r[i] / diag[i];
      const p = Float64Array.from(z);
      let rz = 0; for (let i = 0; i < N; i++) rz += r[i] * z[i];
      for (let it = 0; it < 200; it++) {
        let worst = 0; for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(z[i]));
        if (worst < 0.01) break;
        this.sweeps++;
        mul(p, q);
        let pq = 0; for (let i = 0; i < N; i++) pq += p[i] * q[i];
        const a = rz / pq;
        for (let i = 0; i < N; i++) { x[i] += a * p[i]; r[i] -= a * q[i]; z[i] = r[i] / diag[i]; }
        let rz2 = 0; for (let i = 0; i < N; i++) rz2 += r[i] * z[i];
        const beta = rz2 / rz; rz = rz2;
        for (let i = 0; i < N; i++) p[i] = z[i] + beta * p[i];
      }
      for (let i = 0; i < N; i++) T[i].r[k] = x[i];
    }
  }
  private f(ids: number[]): number { return 1 + ids.reduce((s, id) => s + 1 / ((this.teams.get(id)?.n ?? 0) + this.p.lambda), 0); }
  private s2(): number {
    const seed = (this.s2share * this.scale.mean()) ** 2, p = 30;
    return (this.s2sum + p * seed) / (this.s2n + p);
  }
  private expect(m: MatchRecord): number[] {
    const r = (id: number) => this.teams.get(id)?.r ?? Array.from({ length: K }, (_, k) => this.prior(id, k));
    const [a, b] = m.red.teams.map(r), [c, e] = m.blue.teams.map(r);
    return Array.from({ length: K }, (_, k) => a[k] + b[k] - c[k] - e[k]);
  }
  predict(m: MatchRecord): RaterCall {
    const ids = [...m.red.teams, ...m.blue.teams], f = this.f(ids), sd = Math.sqrt(this.s2() * f), x = this.expect(m);
    return { z: x[0] / sd, u: (f - 1) / f, margin: x[0], nativeMargin: true, phases: x.slice(1).map((v) => v / sd) };
  }
  update(m: MatchRecord): void {
    const ids = [...m.red.teams, ...m.blue.teams];
    const e = m.red.total - m.blue.total - this.expect(m)[0];
    this.s2sum += (e * e) / this.f(ids); this.s2n++;
    const y = targets(m.red, m.blue), sign = [1, 1, -1, -1];
    ids.forEach((id, i) => {
      const t = this.team(id); t.n++;
      for (let k = 0; k < K; k++) t.b[k] += sign[i] * y[k];
      ids.forEach((o, j) => { if (j !== i) t.nb.set(o, (t.nb.get(o) ?? 0) + sign[i] * sign[j]); });
    });
    for (const id of ids) this.team(id);
    this.scale.update(m);
    for (let pass = 0; pass < 3; pass++) for (const id of ids) this.relax(id);
  }
}

// ---------------------------------------------------------------- normal helpers

const SQRT2PI = Math.sqrt(2 * Math.PI);
export const pdf = (x: number) => Math.exp(-0.5 * x * x) / SQRT2PI;
/** Standard normal CDF (erfc via Numerical Recipes' Chebyshev fit, |error| < 1.2e-7). */
export function cdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - r / 2 : r / 2;
}
function invCdf(p: number): number { let lo = -10, hi = 10; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < p) lo = mid; else hi = mid; } return (lo + hi) / 2; }

// ---------------------------------------------------------------- TrueSkill

export interface TrueSkillParams {
  /** Starting σ (skill units; μ starts at 0). */
  sigma0: number;
  /** Performance noise per robot. */
  beta: number;
  /** Dynamics: σ² grows by τ² before every match. */
  tau: number;
  /** Season carry-over: μ ← ρ·μ, σ² ← min(σ0², σ² + σ0²·(1 − ρ²)). */
  rho: number;
  /** Tie rate the draw margin is set from. */
  drawRate: number;
}
interface Gauss { mu: number; s2: number }

export class TrueSkill implements Rater {
  readonly name = "trueskill";
  private teams = new Map<number, Gauss>();
  private scale = new SeasonScale();
  private readonly eps: number;
  constructor(readonly p: TrueSkillParams) { this.eps = invCdf((p.drawRate + 1) / 2) * Math.sqrt(4) * p.beta; }
  startSeason(): void {
    const { rho, sigma0 } = this.p;
    for (const g of this.teams.values()) { g.mu *= rho; g.s2 = Math.min(sigma0 ** 2, g.s2 + sigma0 ** 2 * (1 - rho * rho)); }
    this.scale.startSeason();
  }
  setTime(): void {}
  private get(id: number): Gauss { let g = this.teams.get(id); if (!g) { g = { mu: 0, s2: this.p.sigma0 ** 2 }; this.teams.set(id, g); } return g; }
  private peek(id: number): Gauss { return this.teams.get(id) ?? { mu: 0, s2: this.p.sigma0 ** 2 }; }
  predict(m: MatchRecord): RaterCall {
    const R = m.red.teams.map((t) => this.peek(t)), B = m.blue.teams.map((t) => this.peek(t));
    const d = R[0].mu + R[1].mu - B[0].mu - B[1].mu;
    const tau2 = this.p.tau ** 2, unc = [...R, ...B].reduce((s, g) => s + g.s2 + tau2, 0), c2 = unc + 4 * this.p.beta ** 2;
    return { z: d / Math.sqrt(c2), u: unc / c2, margin: d * this.scale.rms(), nativeMargin: false };
  }
  update(m: MatchRecord): void {
    const ids = [...m.red.teams, ...m.blue.teams], G = ids.map((id) => this.get(id));
    for (const g of G) g.s2 += this.p.tau ** 2;
    const c2 = G.reduce((s, g) => s + g.s2, 0) + 4 * this.p.beta ** 2, c = Math.sqrt(c2);
    const y = m.red.total > m.blue.total ? 1 : m.red.total < m.blue.total ? 0 : 0.5;
    // From the winner's side (red on a draw): t = (μ_w − μ_l)/c.
    const sideW = y === 0 ? [2, 3] : [0, 1], sideL = y === 0 ? [0, 1] : [2, 3];
    const t = (G[sideW[0]].mu + G[sideW[1]].mu - G[sideL[0]].mu - G[sideL[1]].mu) / c, e = this.eps / c;
    let v: number, w: number;
    if (y !== 0.5) {
      const x = t - e, den = cdf(x);
      v = den > 1e-12 ? pdf(x) / den : -x; w = v * (v + x);
    } else {
      const den = cdf(e - t) - cdf(-e - t);
      if (den > 1e-12) { v = (pdf(-e - t) - pdf(e - t)) / den; w = v * v + ((e - t) * pdf(e - t) + (e + t) * pdf(e + t)) / den; }
      else { v = t < 0 ? -t - e : -t + e; w = 1; }
    }
    w = Math.min(Math.max(w, 0), 1 - 1e-9);
    for (const i of sideW) { const g = G[i]; g.mu += (g.s2 / c) * v; g.s2 *= 1 - (g.s2 / c2) * w; }
    for (const i of sideL) { const g = G[i]; g.mu -= (g.s2 / c) * v; g.s2 *= 1 - (g.s2 / c2) * w; }
    this.scale.update(m);
  }
}

// ---------------------------------------------------------------- Glicko-2

export interface Glicko2Params {
  /** Starting rating deviation φ (Glicko-2 scale; 350/173.7178 ≈ 2.01 is the classic value). */
  phi0: number;
  /** Starting volatility. */
  sigma0: number;
  /** System constant τ (how fast volatility may move). */
  tau: number;
  /** Season carry-over: μ ← ρ·μ, φ ← min(φ0, √(φ² + φ0²·(1 − ρ²))). */
  rho: number;
}
export interface G2 { mu: number; phi: number; sigma: number }
const gFn = (phi2: number) => 1 / Math.sqrt(1 + (3 * phi2) / (Math.PI * Math.PI));

export class Glicko2 implements Rater {
  readonly name = "glicko2";
  private teams = new Map<number, G2>();
  private scale = new SeasonScale();
  constructor(readonly p: Glicko2Params) {}
  startSeason(): void {
    const { rho, phi0 } = this.p;
    for (const g of this.teams.values()) { g.mu *= rho; g.phi = Math.min(phi0, Math.sqrt(g.phi ** 2 + phi0 ** 2 * (1 - rho * rho))); }
    this.scale.startSeason();
  }
  setTime(): void {}
  private peek(id: number): G2 { return this.teams.get(id) ?? { mu: 0, phi: this.p.phi0, sigma: this.p.sigma0 }; }
  predict(m: MatchRecord): RaterCall {
    const G = [...m.red.teams, ...m.blue.teams].map((id) => this.peek(id));
    const d = G[0].mu + G[1].mu - G[2].mu - G[3].mu, phi2 = G.reduce((s, g) => s + g.phi ** 2, 0), g = gFn(phi2);
    // u: how much the rating deviations flatten the call (g = 1 when every rating is known exactly).
    return { z: g * d, u: 1 - g, margin: d * this.scale.rms(), nativeMargin: false };
  }
  update(m: MatchRecord): void {
    const ids = [...m.red.teams, ...m.blue.teams], G = ids.map((id) => this.peek(id));
    const y = m.red.total > m.blue.total ? 1 : m.red.total < m.blue.total ? 0 : 0.5;
    const next = G.map((me, i) => {
      const red = i < 2, partner = G[red ? 1 - i : 5 - i], opp = red ? [G[2], G[3]] : [G[0], G[1]];
      // The composite opponent: opponents' sum minus the partner's rating, with all three deviations.
      const muO = opp[0].mu + opp[1].mu - partner.mu, phiO2 = opp[0].phi ** 2 + opp[1].phi ** 2 + partner.phi ** 2;
      return glicko2Period(me, [{ mu: muO, phi2: phiO2, s: red ? y : 1 - y }], this.p.tau);
    });
    ids.forEach((id, i) => this.teams.set(id, next[i]));
    this.scale.update(m);
  }
}

/** One Glicko-2 rating period (Glickman 2012, steps 3–7) against opponents given as (μ, φ², score). */
export function glicko2Period(me: G2, games: { mu: number; phi2: number; s: number }[], tau: number): G2 {
  let info = 0, sum = 0;
  for (const o of games) { const g = gFn(o.phi2), E = 1 / (1 + Math.exp(-g * (me.mu - o.mu))); info += g * g * E * (1 - E); sum += g * (o.s - E); }
  const v = 1 / info, delta = v * sum;
  const sigma = volatility(me, v, delta, tau);
  const phiStar = Math.sqrt(me.phi ** 2 + sigma ** 2), phi = 1 / Math.sqrt(1 / phiStar ** 2 + 1 / v);
  return { mu: me.mu + phi * phi * sum, phi, sigma };
}

/** Glickman's Illinois iteration for the new volatility. */
function volatility(me: G2, v: number, delta: number, tau: number): number {
  const a = Math.log(me.sigma ** 2), phi2 = me.phi ** 2;
  const f = (x: number) => (Math.exp(x) * (delta * delta - phi2 - v - Math.exp(x))) / (2 * (phi2 + v + Math.exp(x)) ** 2) - (x - a) / (tau * tau);
  let A = a, B: number;
  if (delta * delta > phi2 + v) B = Math.log(delta * delta - phi2 - v);
  else { let k = 1; while (f(a - k * tau) < 0 && k < 100) k++; B = a - k * tau; }
  let fA = f(A), fB = f(B);
  for (let it = 0; it < 100 && Math.abs(B - A) > 1e-6; it++) {
    const C = A + ((A - B) * fA) / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  return Math.exp(A / 2);
}
