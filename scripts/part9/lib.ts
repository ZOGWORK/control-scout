// Part 9 helpers: ridge logistic fits for calibration layers (research and the shipped fit share them).

export const logit = (p: number) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };
export const sig = (x: number) => 1 / (1 + Math.exp(-x));

export /** Ridge logistic regression (Newton), soft labels allowed; `prior` is the penalty centre per coefficient. */
function fit(X: number[][], y: number[], pen: number[], prior: number[]): number[] {
  const k = X[0].length; let w = [...prior];
  for (let it = 0; it < 30; it++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < X.length; i++) {
      let z = 0; for (let j = 0; j < k; j++) z += w[j] * X[i][j];
      const p = sig(z), d = p - y[i], v = p * (1 - p);
      for (let a = 0; a < k; a++) { if (!X[i][a]) continue; g[a] += d * X[i][a]; for (let b = 0; b < k; b++) H[a][b] += v * X[i][a] * X[i][b]; }
    }
    for (let a = 0; a < k; a++) { g[a] += pen[a] * (w[a] - prior[a]); H[a][a] += pen[a] + 1e-9; }
    // Solve H Δ = g.
    const A = H.map((r, i) => [...r, g[i]]);
    for (let i = 0; i < k; i++) {
      let piv = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      [A[i], A[piv]] = [A[piv], A[i]];
      for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c]; }
    }
    const step = A.map((r, i) => r[k] / r[i]);
    w = w.map((x, i) => x - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return w;
}

/**
 * The contextual model's research learner (round 2's explib.fit_logistic): logistic regression of
 * the outcome on scaled features with the raw logit L as an offset, on mirrored examples (red/blue
 * swapped, so no intercept and no colour bias), ridge on the coefficients, ties left out.
 */
export function fitContextual(X: number[][], L: number[], y: number[], ridge = 1e-3): { coefficients: number[]; scale: number[] } {
  const keep = y.map((v, i) => (v !== 0.5 ? i : -1)).filter((i) => i >= 0), k = X[0].length;
  const mean = new Array(k).fill(0), sq = new Array(k).fill(0);
  for (const i of keep) for (let j = 0; j < k; j++) { mean[j] += X[i][j]; sq[j] += X[i][j] ** 2; }
  const scale = mean.map((m, j) => Math.max(0.05, Math.sqrt(Math.max(0, sq[j] / keep.length - (m / keep.length) ** 2))));
  let w = new Array(k).fill(0);
  const n2 = 2 * keep.length;
  for (let it = 0; it < 50; it++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const i of keep) for (const s of [1, -1]) {
      const xs = X[i].map((v, j) => (s * v) / scale[j]);
      let z = s * L[i]; for (let j = 0; j < k; j++) z += w[j] * xs[j];
      const p = sig(z), t = s === 1 ? y[i] : 1 - y[i], d = p - t, v = p * (1 - p);
      for (let a = 0; a < k; a++) { g[a] += d * xs[a]; for (let b = a; b < k; b++) H[a][b] += v * xs[a] * xs[b]; }
    }
    for (let a = 0; a < k; a++) { for (let b = 0; b < a; b++) H[a][b] = H[b][a]; }
    for (let a = 0; a < k; a++) { g[a] = g[a] / n2 + ridge * w[a]; for (let b = 0; b < k; b++) H[a][b] /= n2; H[a][a] += ridge; }
    const A = H.map((r, i) => [...r, g[i]]);
    for (let i = 0; i < k; i++) {
      let piv = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      [A[i], A[piv]] = [A[piv], A[i]];
      for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c]; }
    }
    const step = A.map((r, i) => r[k] / r[i]);
    w = w.map((x, i) => x - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-10) break;
  }
  return { coefficients: w, scale };
}

/** Raw contextual probability (before calibration) for one row. */
export const contextualRaw = (m: { coefficients: number[]; scale: number[] }, x: number[], L: number) => {
  let z = L; for (let j = 0; j < x.length; j++) z += (x[j] / m.scale[j]) * m.coefficients[j];
  return Math.min(1 - 1e-8, Math.max(1e-8, sig(z)));
};
