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

export function calibrationMarkdown(rows: BandRow[]): string {
  return [
    "| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |",
    "|---|---|---|---|---|---|",
    ...rows.map((b) => `| ${b.band}%${b.lowConfidence ? " ⚠ low n" : ""} | ${b.n.toLocaleString("en-US")} | ${pct(b.stated)} | ${pct(b.empirical)} | ${pct(b.error)} | ${pct(b.midpointError)} |`),
  ].join("\n");
}
