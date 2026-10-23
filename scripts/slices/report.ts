// Engine error report (Prediction Engine program, Part 1): accuracy, Brier,
// log loss and calibration per slice, from per-match rows of a chronological
// replay (or of the live ledger). Pure functions; scripts/engine-slices.ts
// does the replay and writes the files.

export interface ScoredRow {
  /** Red's win probability as stated before the match. */
  p: number;
  /** 1 red won, 0 blue won, 0.5 tie. */
  y: number;
  /** Slice value per dimension, e.g. { level: "qual", density: "thin" }. */
  tags: Record<string, string>;
}

export interface SliceMetrics {
  n: number;
  /** Matches with a winner (ties are scored for Brier and log loss, not for accuracy). */
  decided: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  /** 10-bin expected calibration error of red's probability. */
  ece10: number;
  /** Mean stated probability of the favourite. */
  favStated: number;
  /** How often the favourite won (ties count half). */
  favWon: number;
  /** favWon − favStated: negative = the model is too sure of its favourites here. */
  calGap: number;
  /** This slice's share of all matches and of the summed Brier score. */
  shareMatches: number;
  shareBrier: number;
  /** Σ (Brier − corpus mean Brier) over the slice: how much more error than an average match it carries. */
  excessBrier: number;
  /** Mean of (p − y)² − p(1 − p) over decided matches: Brier above what the model's own probabilities expected (> 0 = overconfident). */
  surprise: number;
  /** Fewer than LOW_CONFIDENCE_N matches: shown, never trusted. */
  lowConfidence: boolean;
}

export const LOW_CONFIDENCE_N = 200;

/** Slice values that mean "no measurement", never a weakness to rank. */
const UNRANKED = new Set(["not measured"]);

export interface BandRow { band: string; n: number; stated: number; empirical: number; error: number; midpointError: number; lowConfidence: boolean }

export interface SliceReport {
  all: SliceMetrics;
  /** dimension → slice value → metrics. */
  dims: Record<string, Record<string, SliceMetrics>>;
  /** Favourite-probability calibration table (50–60 … 90–100). */
  calibration: BandRow[];
  /** The three data slices carrying the most excess Brier, at most one per dimension (low-confidence slices skipped). */
  top: { dim: string; value: string; excessBrier: number; shareBrier: number; shareMatches: number }[];
}

const clip = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));

function metricsOf(rows: ScoredRow[], total: { n: number; brierSum: number; meanBrier: number }): SliceMetrics {
  let brierSum = 0, ll = 0, correct = 0, decided = 0, favP = 0, favW = 0, surprise = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const r of rows) {
    const p = clip(r.p), b = (p - r.y) ** 2;
    brierSum += b;
    ll += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p));
    // Surprise compares against the binary-outcome expectation p(1 − p); a half-scored tie lands 0.25 below
    // half a win plus half a loss and would read as timidity, so ties are left out.
    if (r.y !== 0.5) { surprise += b - p * (1 - p); decided++; correct += r.p === 0.5 ? 0.5 : (r.p > 0.5) === (r.y === 1) ? 1 : 0; }
    const fav = Math.max(p, 1 - p);
    favP += fav;
    favW += r.y === 0.5 ? 0.5 : (p >= 0.5) === (r.y === 1) ? 1 : 0;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.n++; bin.p += p; bin.y += r.y;
  }
  const n = rows.length;
  const ece = n ? bins.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.p / b.n - b.y / b.n) : 0), 0) : NaN;
  return {
    n, decided,
    accuracy: decided ? correct / decided : NaN,
    brier: n ? brierSum / n : NaN,
    logLoss: n ? ll / n : NaN,
    ece10: ece,
    favStated: n ? favP / n : NaN,
    favWon: n ? favW / n : NaN,
    calGap: n ? (favW - favP) / n : NaN,
    shareMatches: total.n ? n / total.n : NaN,
    shareBrier: total.brierSum ? brierSum / total.brierSum : NaN,
    excessBrier: brierSum - n * total.meanBrier,
    surprise: decided ? surprise / decided : NaN,
    lowConfidence: n < LOW_CONFIDENCE_N,
  };
}

const BANDS: [string, number, number][] = [["50-60", 0.5, 0.6], ["60-70", 0.6, 0.7], ["70-80", 0.7, 0.8], ["80-90", 0.8, 0.9], ["90-100", 0.9, 1.0000001]];

export function calibrationTable(rows: ScoredRow[]): BandRow[] {
  return BANDS.map(([band, lo, hi]) => {
    let n = 0, s = 0, w = 0;
    for (const r of rows) {
      const fav = Math.max(r.p, 1 - r.p);
      if (fav < lo || fav >= hi) continue;
      n++; s += fav; w += r.y === 0.5 ? 0.5 : (r.p >= 0.5) === (r.y === 1) ? 1 : 0;
    }
    const stated = n ? s / n : NaN, empirical = n ? w / n : NaN;
    return { band, n, stated, empirical, error: Math.abs(stated - empirical), midpointError: Math.abs((lo + Math.min(hi, 1)) / 2 - empirical), lowConfidence: n < LOW_CONFIDENCE_N };
  });
}

/**
 * Slice a set of scored rows. `ranked` names the data dimensions that compete
 * for the top-three list; model dimensions (probability and margin bands) are
 * left out of it on purpose: a coin-flip band carries more Brier by
 * construction, which says nothing about where the model can improve.
 */
export function sliceReport(rows: ScoredRow[], ranked: string[]): SliceReport {
  let brierSum = 0;
  for (const r of rows) brierSum += (clip(r.p) - r.y) ** 2;
  const total = { n: rows.length, brierSum, meanBrier: rows.length ? brierSum / rows.length : 0 };
  const groups: Record<string, Map<string, ScoredRow[]>> = {};
  for (const r of rows) {
    for (const [dim, v] of Object.entries(r.tags)) {
      const g = (groups[dim] ??= new Map());
      let xs = g.get(v);
      if (!xs) g.set(v, (xs = []));
      xs.push(r);
    }
  }
  const dims: SliceReport["dims"] = {};
  for (const [dim, g] of Object.entries(groups)) {
    dims[dim] = {};
    for (const v of [...g.keys()].sort()) dims[dim][v] = metricsOf(g.get(v)!, total);
  }
  // One slice per dimension (its worst): the dimensions overlap (thin data shows up as few matches, as
  // thin density and as unmeasured volatility), and three views of one weakness would hide the next one.
  const top = ranked
    .map((dim) => Object.entries(dims[dim] ?? {})
      .filter(([value, m]) => !UNRANKED.has(value) && !m.lowConfidence && m.excessBrier > 0)
      .map(([value, m]) => ({ dim, value, m }))
      .sort((a, b) => b.m.excessBrier - a.m.excessBrier)[0])
    .filter((x) => !!x)
    .sort((a, b) => b.m.excessBrier - a.m.excessBrier)
    .slice(0, 3)
    .map(({ dim, value, m }) => ({ dim, value, excessBrier: m.excessBrier, shareBrier: m.shareBrier, shareMatches: m.shareMatches }));
  return { all: metricsOf(rows, total), dims, calibration: calibrationTable(rows), top };
}

// ---- Champion vs challenger (Part 2 gate) --------------------------------

export interface PairedRow { event: string; y: number; a: number; b: number; tags: Record<string, string> }

export interface PairedMetrics {
  n: number;
  /** Challenger minus champion (negative Brier / log loss = challenger better). */
  brier: number; brier95: [number, number];
  logLoss: number; logLoss95: [number, number];
  /** Accuracy change in points (decided matches). */
  accuracyPp: number; accuracy95: [number, number];
  lowConfidence: boolean;
  /** The 95% Brier interval lies entirely above zero: a regression beyond noise. */
  regression: boolean;
}

/** Deterministic PRNG (mulberry32) so the bootstrap intervals are reproducible. */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paired comparison with a 95% interval from resampling whole events (matches at one event are not independent). */
export function pairedMetrics(rows: PairedRow[], draws = 2000, seed = 20261022): PairedMetrics {
  const ev = new Map<string, { n: number; d: number; ll: number; dec: number; acc: number }>();
  const corr = (p: number, y: number) => (p === 0.5 ? 0.5 : (p > 0.5) === (y === 1) ? 1 : 0);
  for (const r of rows) {
    const a = clip(r.a), b = clip(r.b);
    const x = ev.get(r.event) ?? { n: 0, d: 0, ll: 0, dec: 0, acc: 0 };
    x.n++;
    x.d += (b - r.y) ** 2 - (a - r.y) ** 2;
    x.ll += -(r.y * Math.log(b) + (1 - r.y) * Math.log(1 - b)) + (r.y * Math.log(a) + (1 - r.y) * Math.log(1 - a));
    if (r.y !== 0.5) { x.dec++; x.acc += corr(r.b, r.y) - corr(r.a, r.y); }
    ev.set(r.event, x);
  }
  const E = [...ev.values()];
  const sum = (k: "n" | "d" | "ll" | "dec" | "acc", xs = E) => xs.reduce((s, x) => s + x[k], 0);
  const n = sum("n"), dec = sum("dec");
  const rand = rng(seed), bs: number[] = [], ls: number[] = [], as: number[] = [];
  for (let i = 0; i < draws && E.length; i++) {
    let d = 0, l = 0, m = 0, a = 0, k = 0;
    for (let j = 0; j < E.length; j++) { const x = E[Math.floor(rand() * E.length)]; d += x.d; l += x.ll; m += x.n; a += x.acc; k += x.dec; }
    bs.push(d / m); ls.push(l / m); as.push(k ? (100 * a) / k : 0);
  }
  bs.sort((x, y) => x - y); ls.sort((x, y) => x - y); as.sort((x, y) => x - y);
  const q = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : NaN);
  const brier95: [number, number] = [q(bs, 0.025), q(bs, 0.975)];
  return {
    n, brier: n ? sum("d") / n : NaN, brier95, logLoss: n ? sum("ll") / n : NaN, logLoss95: [q(ls, 0.025), q(ls, 0.975)],
    accuracyPp: dec ? (100 * sum("acc")) / dec : NaN, accuracy95: [q(as, 0.025), q(as, 0.975)],
    lowConfidence: n < LOW_CONFIDENCE_N, regression: brier95[0] > 0,
  };
}

/** Paired metrics overall and per slice of every dimension. */
export function pairedReport(rows: PairedRow[], dims: string[]): { all: PairedMetrics; dims: Record<string, Record<string, PairedMetrics>> } {
  const out: Record<string, Record<string, PairedMetrics>> = {};
  for (const dim of dims) {
    const g = new Map<string, PairedRow[]>();
    for (const r of rows) { const v = r.tags[dim]; if (v == null) continue; (g.get(v) ?? g.set(v, []).get(v)!).push(r); }
    out[dim] = Object.fromEntries([...g.keys()].sort().map((v) => [v, pairedMetrics(g.get(v)!)]));
  }
  return { all: pairedMetrics(rows), dims: out };
}

// ---- Markdown rendering -------------------------------------------------

const pct = (x: number, d = 1) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}%` : "–");
const num = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : "–");
const signed = (x: number, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}` : "–");

export function sliceTable(dims: SliceReport["dims"], order: string[], labels: Record<string, string>): string {
  const out: string[] = [];
  for (const dim of order) {
    const d = dims[dim];
    if (!d) continue;
    out.push(`#### ${labels[dim] ?? dim}`, "", "| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const [v, m] of Object.entries(d)) {
      out.push(`| ${v}${m.lowConfidence ? " ⚠ low n" : ""} | ${m.n.toLocaleString("en-US")} | ${pct(m.shareMatches)} | ${pct(m.shareBrier)} | ${pct(m.accuracy, 2)} | ${num(m.brier)} | ${num(m.logLoss)} | ${signed(m.excessBrier)} | ${pct(m.favStated)} → ${pct(m.favWon)} | ${signed(1000 * m.surprise, 1)}‰ |`);
    }
    out.push("");
  }
  return out.join("\n");
}

export function pairedMarkdown(p: ReturnType<typeof pairedReport>, order: string[], labels: Record<string, string>): string {
  const f = (m: PairedMetrics) => `${m.n.toLocaleString("en-US")} | ${signed(1e4 * m.brier, 2)} [${signed(1e4 * m.brier95[0], 2)}, ${signed(1e4 * m.brier95[1], 2)}] | ${signed(1e4 * m.logLoss, 2)} [${signed(1e4 * m.logLoss95[0], 2)}, ${signed(1e4 * m.logLoss95[1], 2)}] | ${signed(m.accuracyPp, 2)} [${signed(m.accuracy95[0], 2)}, ${signed(m.accuracy95[1], 2)}] |${m.regression ? " **regression**" : m.brier95[1] < 0 ? " better" : ""}${m.lowConfidence ? " ⚠ low n" : ""}`;
  const out = ["| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |", "|---|---|---|---|---|---|", `| **all** | ${f(p.all)}`];
  for (const dim of order) for (const [v, m] of Object.entries(p.dims[dim] ?? {})) out.push(`| ${labels[dim] ?? dim}: ${v} | ${f(m)}`);
  return out.join("\n");
}

export function calibrationMarkdown(rows: BandRow[]): string {
  return [
    "| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |",
    "|---|---|---|---|---|---|",
    ...rows.map((b) => `| ${b.band}%${b.lowConfidence ? " ⚠ low n" : ""} | ${b.n.toLocaleString("en-US")} | ${pct(b.stated)} | ${pct(b.empirical)} | ${pct(b.error)} | ${pct(b.midpointError)} |`),
  ].join("\n");
}
