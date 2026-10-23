// Engine program Part 12.1 + 12.2, the research gate: does blending the champion's win probability with two
// diverse members beat the champion alone on seasons the blend never saw?
//   (a) the champion (the live engine, exactly as served: predictMatch with the fitted contextual model);
//   (b) a Bayesian skill rating (TrueSkill-style: per-team mean + uncertainty, updated from results only,
//       chronological; ties and unrated events teach it nothing), win% = Φ(Δμ / c);
//   (c) a margin regression: actual margin on the champion's per-phase rating differences (auto, teleop,
//       endgame, fouls; no intercept, the model is colour-symmetric), win% = Φ(predicted margin / residual sd).
// Rolling origin: the members' constants and the blend's weights are fit on season s−1 and judged once on s.
// Blend = logistic stacking of the three logits (no intercept, ridge toward "champion only").
// Reports each member alone, the blend, paired event-bootstrap 95% intervals vs the champion, and the size
// of the blend's adjustment (|blend − champion|): a blend that only ever moves calls by <1% is dead weight.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part12/ensemble-research.ts [--json out.json]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { ENGINE_VERSION, FITTED_MODEL, RatingBook, predictMatch, type MatchRecord } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { outcome, predictable, seasonCorpus } from "../slices/corpus.js";
import { fit, logit, sig } from "../part9/lib.js";
import { rng } from "../slices/report.js";

await migrate();
const M = FITTED_MODEL;
const SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
// 2022–23 is the one judged season the champion never learned from: its 22 contextual weights saw 2023–24 and
// 2024–25, and its final recalibration 2025–26. Later seasons are a frozen-champion retrospective (the champion
// is in-sample there, which favours it, and the blend leans on it).
const JUDGED = [2022, 2023, 2024, 2025];
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

const Phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x: number) { // Abramowitz–Stegun 7.1.26
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
}
const phi = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** TrueSkill-style team rating, two-outcome update (no draw margin: ties are skipped). */
class Skill {
  mu = new Map<number, number>(); v = new Map<number, number>();
  constructor(public beta: number, public tau: number, public carry: number, public v0 = (25 / 3) ** 2) {}
  startSeason() { for (const [t, m] of this.mu) { this.mu.set(t, m * this.carry); this.v.set(t, this.v0); } }
  private c2(a: number[], b: number[]) { return (a.length + b.length) * this.beta ** 2 + [...a, ...b].reduce((s, t) => s + (this.v.get(t) ?? this.v0) + this.tau ** 2, 0); }
  private d(a: number[], b: number[]) { const m = (t: number) => this.mu.get(t) ?? 0; return a.reduce((s, t) => s + m(t), 0) - b.reduce((s, t) => s + m(t), 0); }
  p(a: number[], b: number[]) { return Phi(this.d(a, b) / Math.sqrt(this.c2(a, b))); }
  uncertainty(a: number[], b: number[]) { return Math.sqrt([...a, ...b].reduce((s, t) => s + (this.v.get(t) ?? this.v0), 0) / (a.length + b.length)); }
  update(m: MatchRecord) {
    if (m.red.total === m.blue.total) return;
    const [w, l] = m.red.total > m.blue.total ? [m.red.teams, m.blue.teams] : [m.blue.teams, m.red.teams];
    const c2 = this.c2(w, l), c = Math.sqrt(c2), t = this.d(w, l) / c;
    const V = phi(t) / Math.max(1e-12, Phi(t)), W = V * (V + t);
    for (const [team, sgn] of [...w.map((x) => [x, 1] as const), ...l.map((x) => [x, -1] as const)]) {
      const v = (this.v.get(team) ?? this.v0) + this.tau ** 2;
      this.mu.set(team, (this.mu.get(team) ?? 0) + sgn * (v / c) * V);
      this.v.set(team, v * Math.max(1e-4, 1 - (v / c2) * W));
    }
  }
}
const SKILL_GRID = [2, 4, 6].flatMap((beta) => [0.1, 0.5].flatMap((tau) => [0, 0.5].map((carry) => ({ beta, tau, carry }))));

interface Row { season: number; event: string; y: number; pa: number; pb: number[]; unc: number[]; dx: number[]; margin: number }
const rows: Row[] = [];
const book = new RatingBook(M.rating);
const skills = SKILL_GRID.map((g) => new Skill(g.beta, g.tau, g.carry));
for (const s of SEASONS) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s); for (const k of skills) k.startSeason();
  for (const m of matches) {
    if (predictable(m) && !unrated.has(m.eventCode)) {
      book.setTime(m.time);
      const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
      const pc = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx });
      const ph = book.withRegion(ctx.region, () => book.withEvent(ctx.event, () => [...m.red.teams, ...m.blue.teams].map((t) => book.get(t))));
      const sum = (i: number[], f: (r: (typeof ph)[number]) => number) => i.reduce((a, j) => a + f(ph[j]), 0);
      const dx = (["auto", "teleop", "endgame", "pen"] as const).map((k) => sum([0, 1], (r) => r[k]) - sum([2, 3], (r) => r[k]));
      rows.push({ season: s, event: `${s}|${m.eventCode}`, y: outcome(m), pa: pc.pRedWin, pb: skills.map((k) => k.p(m.red.teams, m.blue.teams)), unc: skills.map((k) => k.uncertainty(m.red.teams, m.blue.teams)), dx, margin: m.red.total - m.blue.total });
    }
    if (!unrated.has(m.eventCode)) { book.update(m); for (const k of skills) k.update(m); }
  }
  console.log(`${s}: ${rows.filter((r) => r.season === s).length} predicted rated matches`);
}

const brier = (p: number, y: number) => (p - y) ** 2;
const ll = (p: number, y: number) => { const q = Math.min(1 - 1e-9, Math.max(1e-9, p)); return -(y * Math.log(q) + (1 - y) * Math.log(1 - q)); };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const acc = (p: number, y: number) => (y === 0.5 ? NaN : (p > 0.5 ? 1 : 0) === y ? 1 : 0);

/** OLS without intercept (Gaussian elimination on the normal equations). */
function ols(X: number[][], y: number[]) {
  const k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { A[a][k] += X[i][a] * y[i]; for (let b = 0; b < k; b++) A[a][b] += X[i][a] * X[i][b]; }
  for (let i = 0; i < k; i++) for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c]; }
  return A.map((r, i) => r[k] / r[i]);
}
/** Paired event bootstrap of mean(f(blend) − f(champion)). */
function boot(R: Row[], pB: number[], f: (p: number, y: number) => number, reps = 1000) {
  const byEv = new Map<string, number[]>(); R.forEach((r, i) => { const l = byEv.get(r.event) ?? []; l.push(i); byEv.set(r.event, l); });
  const evs = [...byEv.values()], d = R.map((r, i) => f(pB[i], r.y) - f(r.pa, r.y));
  const rnd = rng(12345);
  const out: number[] = [];
  for (let b = 0; b < reps; b++) { let s = 0, n = 0; for (let e = 0; e < evs.length; e++) for (const i of evs[Math.floor(rnd() * evs.length)]) { s += d[i]; n++; } out.push(s / n); }
  out.sort((a, b) => a - b);
  return { delta: mean(d), lo: out[Math.floor(reps * 0.025)], hi: out[Math.floor(reps * 0.975)] };
}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const report: Record<string, unknown>[] = [];
for (const s of JUDGED) {
  const F = rows.filter((r) => r.season === s - 1), J = rows.filter((r) => r.season === s);
  // (b) pick the skill constants with the best fit-season Brier.
  const gi = SKILL_GRID.map((_, i) => mean(F.map((r) => brier(r.pb[i], r.y)))).reduce((b, v, i, a) => (v < a[b] ? i : b), 0);
  // (c) margin regression on the fit season.
  const w = ols(F.map((r) => r.dx), F.map((r) => r.margin));
  const pred = (r: Row) => r.dx.reduce((a, x, i) => a + w[i] * x, 0);
  const sd = Math.sqrt(mean(F.map((r) => (r.margin - pred(r)) ** 2)));
  const pc = (r: Row) => Phi(pred(r) / sd);
  // Blend: stacked logits on mirrored fit-season rows (ties out), ridge toward champion only.
  const X: number[][] = [], Y: number[] = [];
  for (const r of F) { if (r.y === 0.5) continue; const x = [logit(r.pa), logit(r.pb[gi]), logit(pc(r))]; X.push(x, x.map((v) => -v)); Y.push(r.y, 1 - r.y); }
  const wb = fit(X, Y, [1, 1, 1], [1, 0, 0]);
  const blend = (r: Row) => sig(wb[0] * logit(r.pa) + wb[1] * logit(r.pb[gi]) + wb[2] * logit(pc(r)));
  // The same stacking without the margin member: what the margin member adds.
  const w2 = fit(X.map((x) => [x[0], x[1]]), Y, [1, 1], [1, 0]);
  const blend2 = (r: Row) => sig(w2[0] * logit(r.pa) + w2[1] * logit(r.pb[gi]));
  const members: Record<string, (r: Row) => number> = { champion: (r) => r.pa, bayes: (r) => r.pb[gi], margin: pc, blend, blendNoMargin: blend2 };
  const pB = J.map(blend), adj = J.map((r, i) => Math.abs(pB[i] - r.pa));
  const res = {
    season: s, fitSeason: s - 1, n: J.length, skill: SKILL_GRID[gi], marginWeights: w.map((x) => +x.toFixed(4)), marginSd: +sd.toFixed(2), blendWeights: wb.map((x) => +x.toFixed(4)), blendNoMarginWeights: w2.map((x) => +x.toFixed(4)), championInSample: s >= 2023,
    members: Object.fromEntries(Object.entries(members).map(([k, f]) => [k, { brier: mean(J.map((r) => brier(f(r), r.y))), logLoss: mean(J.map((r) => ll(f(r), r.y))), accuracy: mean(J.map((r) => acc(f(r), r.y)).filter((x) => !Number.isNaN(x))) }])),
    vsChampion: { blendNoMarginBrier: boot(J, J.map(blend2), brier), brier: boot(J, pB, brier), logLoss: boot(J, pB, ll), accuracy: boot(J.filter((r) => r.y !== 0.5), J.map((r, i) => [r, pB[i]] as const).filter(([r]) => r.y !== 0.5).map(([, p]) => p), (p, y) => -acc(p, y)) },
    adjustment: { p50: q(adj, 0.5), p90: q(adj, 0.9), p99: q(adj, 0.99), over1pct: mean(adj.map((a) => (a > 0.01 ? 1 : 0))), over5pct: mean(adj.map((a) => (a > 0.05 ? 1 : 0))), pickFlips: mean(J.map((r, i) => ((pB[i] > 0.5) !== (r.pa > 0.5) ? 1 : 0))) },
    // 12.2's diagnostic: Bayesian-uncertain AND wrong = a thin-data map (champion Brier by the member's uncertainty quartile).
    uncertaintyQuartiles: [0.25, 0.5, 0.75, 1].map((hi, k, a) => { const lo = k ? q(J.map((r) => r.unc[gi]), a[k - 1]) : -Infinity, top = hi === 1 ? Infinity : q(J.map((r) => r.unc[gi]), hi); const S = J.filter((r) => r.unc[gi] > lo && r.unc[gi] <= top); return { n: S.length, championBrier: mean(S.map((r) => brier(r.pa, r.y))), bayesBrier: mean(S.map((r) => brier(r.pb[gi], r.y))) }; }),
  };
  report.push(res);
  const f4 = (x: number) => (x >= 0 ? "+" : "") + (x * 1e4).toFixed(2);
  console.log(`\n${s} (fit on ${s - 1}, n ${J.length}) skill ${JSON.stringify(res.skill)} margin w ${res.marginWeights} sd ${res.marginSd} blend w ${res.blendWeights}`);
  for (const [k, v] of Object.entries(res.members)) console.log(`  ${k.padEnd(9)} Brier ${v.brier.toFixed(5)}  logloss ${v.logLoss.toFixed(5)}  acc ${(v.accuracy * 100).toFixed(2)}%`);
  const b = res.vsChampion;
  console.log(`  blend − champion ×1e-4: Brier ${f4(b.brier.delta)} [${f4(b.brier.lo)}, ${f4(b.brier.hi)}]  logloss ${f4(b.logLoss.delta)} [${f4(b.logLoss.lo)}, ${f4(b.logLoss.hi)}]  acc ${(-b.accuracy.delta * 100).toFixed(2)} pts [${(-b.accuracy.hi * 100).toFixed(2)}, ${(-b.accuracy.lo * 100).toFixed(2)}]`);
  console.log(`  without the margin member: Brier ${f4(b.blendNoMarginBrier.delta)} [${f4(b.blendNoMarginBrier.lo)}, ${f4(b.blendNoMarginBrier.hi)}]  weights ${res.blendNoMarginWeights}`);
  const a = res.adjustment;
  console.log(`  adjustment |blend − champion|: median ${(a.p50 * 100).toFixed(2)}%  p90 ${(a.p90 * 100).toFixed(2)}%  p99 ${(a.p99 * 100).toFixed(2)}%  >1% ${(a.over1pct * 100).toFixed(1)}%  >5% ${(a.over5pct * 100).toFixed(1)}%  pick flips ${(a.pickFlips * 100).toFixed(2)}%`);
  console.log(`  by Bayesian uncertainty quartile (champion / bayes Brier): ${res.uncertaintyQuartiles.map((u) => `${u.championBrier.toFixed(4)}/${u.bayesBrier.toFixed(4)}`).join("  ")}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ engine: ENGINE_VERSION, judged: report }, null, 2));
