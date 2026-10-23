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

/** Global mapping plus per-cell deviations ridge-shrunk toward it; returns each cell's combined mapping. */
export function fitSliceCalibration(z: number[], y: number[], cell: string[], ridge: number): { global: [number, number]; cells: Record<string, { slope: number; intercept: number; n: number }> } {
  const g = fit(z.map((v) => [v, 1]), y, [1e-4, 1e-4], [1, 0]);
  const cells = [...new Set(cell)].sort();
  const X = z.map((v, i) => { const c = cells.indexOf(cell[i]); const x = [v, 1]; for (let j = 0; j < cells.length; j++) x.push(j === c ? v : 0, j === c ? 1 : 0); return x; });
  const w = fit(X, y, [1e-4, 1e-4, ...cells.flatMap(() => [ridge, ridge])], [g[0], g[1], ...cells.flatMap(() => [0, 0])]);
  return { global: [g[0], g[1]], cells: Object.fromEntries(cells.map((c, j) => [c, { slope: w[0] + w[2 + 2 * j], intercept: w[1] + w[3 + 2 * j], n: cell.filter((x) => x === c).length }])) };
}
