// Research R6/R7 shared helpers: row loading (decisive, rated, pre-match rows from engine-slices --rows), the
// rolling origins of Part 9 / 12.5, a paired event bootstrap that also carries margin MAE, and the binned Murphy
// decomposition of the Brier score.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { rng } from "../slices/report.js";

export interface Pred { p: number; muR: number; muB: number; sdR: number; sdB: number }
export interface Row {
  key: string; season: number; event: string; level: string; time: number; y: number; rated: boolean;
  x?: number[]; pRaw?: number; pred: Record<string, Pred>;
  /** Actual red − blue score (from r67-scores.ts). */
  margin: number;
}

export const DAY = 864e5;
export const WINDOW = 365 * DAY;
export const readGz = <T>(f: string): T => JSON.parse(gunzipSync(readFileSync(f)).toString()) as T;

/** Rated, decisive (no ties), scored rows in time order. Rows without a known final score are dropped. */
export function loadRows(rowsFile: string, scoresFile: string, keepTies = false): Row[] {
  const scores = readGz<Record<string, [number, number]>>(scoresFile);
  return readGz<Row[]>(rowsFile)
    .filter((r) => r.rated && scores[r.key] && (keepTies || r.y !== 0.5))
    .map((r) => ({ ...r, margin: scores[r.key][0] - scores[r.key][1] }))
    .sort((a, b) => a.time - b.time);
}

/** Monthly origins Oct 2024 – Jul 2026 (the last origin's month is scored); each scores [t0, t1). */
export function origins(): [number, number][] {
  const m: number[] = [];
  for (let d = new Date(Date.UTC(2024, 9, 1)); d <= new Date(Date.UTC(2026, 7, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) m.push(d.getTime());
  return m.slice(0, -1).map((t, i) => [t, m[i + 1]]);
}
export const rolledSeasons = [{ season: 2024, label: "2024–25 (rolled, tuning)" }, { season: 2025, label: "2025–26 DECODE (rolled, reused)" }] as const;

const clip = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const right = (p: number, y: number) => (p === 0.5 ? 0.5 : (p > 0.5) === (y === 1) ? 1 : 0);

export interface Scored { event: string; y: number; p: number; m: number; margin: number }
export interface Metrics { n: number; events: number; brier: number; logLoss: number; accuracy: number; marginMae: number; brier95: [number, number]; accuracy95: [number, number]; marginMae95: [number, number] }
export interface Delta { n: number; brier: number; brier95: [number, number]; accuracyPp: number; accuracy95: [number, number]; marginMae: number; marginMae95: [number, number]; logLoss: number }

const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
function byEvent<T extends { event: string }>(rows: T[]): T[][] {
  const g = new Map<string, T[]>(); for (const r of rows) (g.get(r.event) ?? g.set(r.event, []).get(r.event)!).push(r);
  return [...g.values()];
}

/** One model's metrics with event-bootstrap 95% intervals. */
export function metrics(rows: Scored[], draws = 2000, seed = 61): Metrics {
  const E = byEvent(rows).map((rs) => rs.reduce((a, r) => ({ n: a.n + 1, b: a.b + (r.p - r.y) ** 2, l: a.l - (r.y * Math.log(clip(r.p)) + (1 - r.y) * Math.log(1 - clip(r.p))), c: a.c + right(r.p, r.y), e: a.e + Math.abs(r.m - r.margin) }), { n: 0, b: 0, l: 0, c: 0, e: 0 }));
  const tot = E.reduce((a, x) => ({ n: a.n + x.n, b: a.b + x.b, l: a.l + x.l, c: a.c + x.c, e: a.e + x.e }), { n: 0, b: 0, l: 0, c: 0, e: 0 });
  const rand = rng(seed), B: number[] = [], A: number[] = [], M: number[] = [];
  for (let k = 0; k < draws; k++) {
    let n = 0, b = 0, c = 0, e = 0;
    for (let j = 0; j < E.length; j++) { const x = E[Math.floor(rand() * E.length)]; n += x.n; b += x.b; c += x.c; e += x.e; }
    B.push(b / n); A.push(c / n); M.push(e / n);
  }
  for (const xs of [B, A, M]) xs.sort((a, b) => a - b);
  return { n: tot.n, events: E.length, brier: tot.b / tot.n, logLoss: tot.l / tot.n, accuracy: tot.c / tot.n, marginMae: tot.e / tot.n, brier95: [q(B, 0.025), q(B, 0.975)], accuracy95: [q(A, 0.025), q(A, 0.975)], marginMae95: [q(M, 0.025), q(M, 0.975)] };
}

/** Challenger (b) minus champion (a) on the same rows: Brier, accuracy (points) and margin MAE, event bootstrap. */
export function paired(rows: { event: string; y: number; margin: number; a: number; b: number; ma: number; mb: number }[], draws = 2000, seed = 20261103): Delta {
  const E = byEvent(rows).map((rs) => rs.reduce((s, r) => ({
    n: s.n + 1, d: s.d + (r.b - r.y) ** 2 - (r.a - r.y) ** 2, c: s.c + right(r.b, r.y) - right(r.a, r.y),
    e: s.e + Math.abs(r.mb - r.margin) - Math.abs(r.ma - r.margin),
    l: s.l - (r.y * Math.log(clip(r.b)) + (1 - r.y) * Math.log(1 - clip(r.b))) + (r.y * Math.log(clip(r.a)) + (1 - r.y) * Math.log(1 - clip(r.a))),
  }), { n: 0, d: 0, c: 0, e: 0, l: 0 }));
  const tot = E.reduce((s, x) => ({ n: s.n + x.n, d: s.d + x.d, c: s.c + x.c, e: s.e + x.e, l: s.l + x.l }), { n: 0, d: 0, c: 0, e: 0, l: 0 });
  const rand = rng(seed), D: number[] = [], C: number[] = [], M: number[] = [];
  for (let k = 0; k < draws; k++) {
    let n = 0, d = 0, c = 0, e = 0;
    for (let j = 0; j < E.length; j++) { const x = E[Math.floor(rand() * E.length)]; n += x.n; d += x.d; c += x.c; e += x.e; }
    D.push(d / n); C.push((100 * c) / n); M.push(e / n);
  }
  for (const xs of [D, C, M]) xs.sort((a, b) => a - b);
  return { n: tot.n, brier: tot.d / tot.n, brier95: [q(D, 0.025), q(D, 0.975)], accuracyPp: (100 * tot.c) / tot.n, accuracy95: [q(C, 0.025), q(C, 0.975)], marginMae: tot.e / tot.n, marginMae95: [q(M, 0.025), q(M, 0.975)], logLoss: tot.l / tot.n };
}

/** The gate: Brier interval entirely below zero, and no point-estimate loss in accuracy or margin MAE. */
export const passes = (d: Delta) => d.brier95[1] < 0 && d.accuracyPp >= 0 && d.marginMae <= 0;

/** Calibration by the favourite's stated chance (10-point bands). */
export function bands(rows: { y: number; p: number }[]) {
  const g = new Map<number, { n: number; s: number; w: number }>();
  for (const r of rows) {
    const fav = Math.max(r.p, 1 - r.p), won = r.p >= 0.5 ? r.y : 1 - r.y, b = Math.min(9, Math.floor(fav * 10));
    const x = g.get(b) ?? { n: 0, s: 0, w: 0 }; x.n++; x.s += fav; x.w += won; g.set(b, x);
  }
  return [...g].sort((a, b) => a[0] - b[0]).map(([b, x]) => ({ band: `${b * 10}-${b * 10 + 10}%`, n: x.n, stated: x.s / x.n, won: x.w / x.n }));
}

export interface Murphy { n: number; bins: number; brier: number; rel: number; res: number; unc: number; residual: number; relDebiased: number; resDebiased: number; bsMinusRel: number; binRecal: number; pav: number; mcb: number; dsc: number; sharpness: number }
/**
 * Binned Murphy (1973) decomposition of the Brier score of p = P(red wins) against y:
 *   BS ≈ REL − RES + UNC,  REL = Σ n_k(p̄_k − ō_k)²/N,  RES = Σ n_k(ō_k − ō)²/N,  UNC = ō(1 − ō).
 * With K equal-width bins the identity is not exact: residual = BS − (REL − RES + UNC) holds the within-bin
 * terms (Stephenson et al. 2008). Each bin's (p̄_k − ō_k)² also carries sampling noise of about ō_k(1 − ō_k)/n_k,
 * so the plain REL is biased upward; relDebiased subtracts Σ ō_k(1 − ō_k)/N (Ferro & Fricker 2012 style), and
 * resDebiased subtracts the same noise from RES (minus UNC/N for the overall mean).
 * Three "perfect calibration" figures, because the binned one is not a bound:
 *   bsMinusRel = BS − REL, the brief's definition (it keeps the binning residual);
 *   binRecal   = UNC − RES, the Brier if every forecast were replaced by its bin's observed rate (this loses the
 *                within-bin resolution, so it can sit ABOVE BS);
 *   pav        = the Brier after the best monotone recalibration fitted IN SAMPLE (pool-adjacent-violators on p),
 *                the CORP decomposition (Dimitriadis, Gneiting & Jordan 2021): BS = MCB − DSC + UNC exactly, with
 *                MCB = BS − pav (miscalibration) and DSC = UNC − pav (discrimination). No monotone recalibration
 *                can score below pav on these matches; it is optimistic, being fitted on the matches it scores.
 * sharpness = mean p(1 − p): the Brier the engine expects of itself if its own probabilities were true.
 */
export function murphy(rows: { y: number; p: number }[], K = 20): Murphy {
  const N = rows.length, bins = Array.from({ length: K }, () => ({ n: 0, p: 0, y: 0 }));
  let bs = 0, ybar = 0, sh = 0;
  for (const r of rows) { const k = Math.min(K - 1, Math.floor(r.p * K)); bins[k].n++; bins[k].p += r.p; bins[k].y += r.y; bs += (r.p - r.y) ** 2; ybar += r.y; sh += r.p * (1 - r.p); }
  ybar /= N; bs /= N;
  let rel = 0, res = 0, noise = 0;
  for (const b of bins) {
    if (!b.n) continue;
    const pk = b.p / b.n, ok = b.y / b.n;
    rel += (b.n * (pk - ok) ** 2) / N; res += (b.n * (ok - ybar) ** 2) / N; noise += (ok * (1 - ok)) / N;
  }
  const unc = ybar * (1 - ybar), bp = pavBrier(rows);
  // ō_k(1−ō_k) is itself the biased (1/n) variance; the n/(n−1) correction is below 0.1% at these bin sizes.
  return { n: N, bins: K, brier: bs, rel, res, unc, residual: bs - (rel - res + unc), relDebiased: Math.max(0, rel - noise), resDebiased: Math.max(0, res - noise + unc / N), bsMinusRel: bs - rel, binRecal: unc - res, pav: bp, mcb: bs - bp, dsc: unc - bp, sharpness: sh / N };
}

/** Brier of the in-sample isotonic (PAV) recalibration of p: equal p values start as one block. */
export function pavBrier(rows: { y: number; p: number }[]): number {
  const s = [...rows].sort((a, b) => a.p - b.p), blocks: { y: number; n: number }[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i, y = 0;
    while (j < s.length && s[j].p === s[i].p) y += s[j++].y;
    blocks.push({ y, n: j - i }); i = j;
    while (blocks.length > 1 && blocks[blocks.length - 2].y / blocks[blocks.length - 2].n >= blocks[blocks.length - 1].y / blocks[blocks.length - 1].n) {
      const b = blocks.pop()!, a = blocks[blocks.length - 1]; a.y += b.y; a.n += b.n;
    }
  }
  // Within a block the fitted value is its mean ō, so its Brier sum is n·ō(1 − ō) for 0/1 outcomes.
  let sum = 0; for (const b of blocks) { const o = b.y / b.n; sum += b.n * o * (1 - o); }
  return sum / s.length;
}

/** Event-bootstrap 95% intervals for every Murphy term. */
export function murphyBoot(rows: { event: string; y: number; p: number }[], K = 20, draws = 1000, seed = 7) {
  const E = byEvent(rows), rand = rng(seed);
  const keys = ["brier", "rel", "res", "unc", "relDebiased", "resDebiased", "bsMinusRel", "binRecal", "pav", "mcb", "dsc"] as const;
  const acc: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, []]));
  for (let d = 0; d < draws; d++) {
    const S: { y: number; p: number }[] = [];
    for (let j = 0; j < E.length; j++) for (const r of E[Math.floor(rand() * E.length)]) S.push(r);
    const m = murphy(S, K); for (const k of keys) acc[k].push(m[k]);
  }
  return Object.fromEntries(keys.map((k) => { const xs = acc[k].sort((a, b) => a - b); return [k, [q(xs, 0.025), q(xs, 0.975)]]; })) as Record<(typeof keys)[number], [number, number]>;
}
