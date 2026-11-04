# Gate: 3.5.0 margin calibration vs engine 3.4.0

A score-only change, gated under the owner's rule of 2026-11-04 (research sign-off, section 6): it may ship
without a Brier gain if (1) margin MAE improves beyond noise in both seasons, (2) every probability stays
bit-identical, (3) score ranges are not worse, and (4) alliance score MAE is not worse beyond noise.

**The change.** The research (R1's side finding, R6's margin map) found the served expected margin about 7%
too wide. 3.5.0 shrinks both served expected scores toward their midpoint m = (red + blue) / 2:

- red′ = m + s·(red − m), blue′ = m − s·(m − blue), so the margin is s × the model's and the total is unchanged.
- Each 80% range keeps its sd and is recentred on the served score.
- s is a fitted constant, `FITTED_MODEL.margin.scale` = `DEFAULT_MARGIN.scale` = **0.95**.
- Only the shown scores, margins and range centres move. Every probability reads the model's unscaled scores
  (`AlliancePrediction.modelMean`, `modelView`): the win chance and the contextual model's inputs, P(tie), the
  bonus odds, the factor sheet and the event simulator. `marginScale.test.ts` fails if any of them reads a
  served score: it runs them at s = 1, 0.95 and 0.3 and requires identical outputs.

**Protocol.** On the pinned snapshot (2026-10-14), every predictable match of 2023–24 to 2025–26 is replayed in
order exactly as the backtest replays it (`scripts/slices/corpus.ts`). Old and new are the same rows: the model's
scores, range sd and probability are identical (checked below), so 3.4.0 is the rows as served and 3.5.0 is the
same rows with the transform. Scored: rated events, ties included in the score metrics (they are real margins),
decisive matches for Brier and accuracy. Intervals are 95%, from resampling whole events (2000 draws). Reproduce:

```bash
node -e "require('fs').writeFileSync('snap.db', require('zlib').brotliDecompressSync(require('fs').readFileSync('data/snapshot.db.br')))"
DATABASE_URL=file:snap.db npx tsx scripts/part12/margin-scale.ts replay rows.json.gz
npx tsx scripts/part12/margin-scale.ts gate rows.json.gz --json docs/engine/gates/gate-3.5.0-margin-scale-snapshot-2026-10-14.json
DATABASE_URL=file:snap2.db npx tsx scripts/engine-slices.ts --seasons 2023,2024,2025 --explain-against <3.4.0 dist> --scores-may-move
DATABASE_URL=file:snap3.db npx tsx scripts/part12/margin-scale.ts sim - --against <3.4.0 dist>
```

## Fitting s (walk-forward, 2024–25 only)

Each month from October 2024 is scored with s fitted on the 365 days of rated matches before it (Part 9 / 12.5
rolling origins). Two fits per window: the s that minimises the margin's mean absolute error (grid 0.700–1.100,
step 0.0025), and the least-squares slope of the real margin on the model's, through the origin. The rule, set
before any number was looked at: s is the MAE fit, and the shipped constant is the median of its nine 2024–25
monthly values, rounded to 0.01 → **0.95**. It was frozen before 2025–26 was scored; 2025–26 is labelled reused
(it has been examined by earlier research).

| Origin | Season | Fit on (matches) | MAE fit | Least-squares slope | Quals only | Playoffs only |
|---|---|---|---|---|---|---|
| 2024-10 | 2024–25 | 28,075 | 0.9525 | 0.9358 | 0.945 | 0.995 |
| 2024-11 | 2024–25 | 28,326 | 0.9525 | 0.9363 | 0.945 | 0.995 |
| 2024-12 | 2024–25 | 30,186 | 0.9575 | 0.9412 | 0.9525 | 0.99 |
| 2025-01 | 2024–25 | 29,748 | 0.965 | 0.9425 | 0.96 | 0.9925 |
| 2025-02 | 2024–25 | 30,577 | 0.9525 | 0.9284 | 0.9475 | 0.9825 |
| 2025-03 | 2024–25 | 31,991 | 0.9475 | 0.9204 | 0.9425 | 0.9775 |
| 2025-04 | 2024–25 | 31,920 | 0.945 | 0.9162 | 0.94 | 0.9725 |
| 2025-06 | 2024–25 | 32,305 | 0.9425 | 0.9142 | 0.9375 | 0.97 |
| 2025-07 | 2024–25 | 32,829 | 0.94 | 0.9094 | 0.935 | 0.965 |
| 2025-10 | 2025–26 | 33,271 | 0.9375 | 0.9066 | 0.935 | 0.955 |
| 2025-11 | 2025–26 | 32,569 | 0.9375 | 0.9058 | 0.9325 | 0.955 |
| 2025-12 | 2025–26 | 33,490 | 0.9325 | 0.9046 | 0.93 | 0.955 |
| 2026-01 | 2025–26 | 34,332 | 0.9225 | 0.8979 | 0.9175 | 0.9425 |
| 2026-02 | 2025–26 | 35,377 | 0.92 | 0.9005 | 0.9175 | 0.935 |
| 2026-03 | 2025–26 | 36,133 | 0.92 | 0.9117 | 0.9225 | 0.9025 |
| 2026-04 | 2025–26 | 36,291 | 0.925 | 0.9185 | 0.9275 | 0.9025 |
| 2026-05 | 2025–26 | 35,865 | 0.9275 | 0.9223 | 0.93 | 0.9025 |
| 2026-06 | 2025–26 | 36,628 | 0.925 | 0.9192 | 0.9275 | 0.905 |
| 2026-07 | 2025–26 | 37,057 | 0.9275 | 0.9226 | 0.9275 | 0.925 |

- **Month by month** the MAE fit runs 0.92–0.965 (2024–25: 0.94–0.965) and the least-squares slope 0.90–0.94,
  the research's range. The least-squares slope is lower because a few blowouts pull a squared-error fit; the
  gate's metric is absolute error, so its own fit is the one shipped.
- **Walk-forward, rolled monthly s** against 3.4.0: Δ margin MAE −0.108 [−0.149, −0.069] in 2024–25 and
  −0.107 [−0.151, −0.065] in 2025–26. The frozen 0.95 gets nearly all of it (table below).
- **Quals and playoffs: one slope.** Separate monthly fits per level against one: 2024–25 Δ −0.001
  [−0.010, +0.008], 2025–26 +0.003 [−0.001, +0.008]. No gain, so one constant. Playoff fits drift (0.995 → 0.90)
  but buy nothing measurable.
- **The form: total unchanged.** The least-squares slope of the real total on the predicted total is 0.985
  (2024–25) and 0.989 (2025–26), and scaling the total by it makes 2024–25's total MAE worse (39.57 → 39.71) while
  helping 2025–26 a little (39.09 → 38.97). No consistent signal, so the midpoint form (total kept) stays.
- **The least-squares variant (s = 0.93, the median of the 2024–25 slopes)** was gated too, not shipped: margin
  MAE −0.111 [−0.166, −0.050] and −0.104 [−0.145, −0.065], but alliance MAE in the fewer-than-6-matches slice gets
  worse beyond noise in both seasons (+0.029 [+0.007, +0.052] and +0.018 [+0.001, +0.035]). At 0.95 it does not.

## Gate: 3.4.0 against 3.5.0 (s = 0.95), identical matches

Δ = 3.5.0 − 3.4.0. MAE and widths in points (negative is better for MAE and interval score); coverage in
percentage points. Brier and accuracy are on identical probabilities, so their Δ is exactly 0 on every row.

| Season · slice | Matches | Margin MAE 3.4.0 → 3.5.0 | Δ margin MAE [95%] | Δ alliance MAE [95%] | Δ Brier | Δ accuracy |
|---|---|---|---|---|---|---|
| **2024–25 (tuning)** · all | 33,271 | 38.75 → 38.64 | **−0.107 [−0.147, −0.064]** | **−0.018 [−0.031, −0.004]** | 0 | 0 |
| quals | 28,885 | 38.19 → 38.07 | −0.116 [−0.156, −0.074] | −0.015 [−0.028, −0.002] | 0 | 0 |
| playoffs | 4,386 | 42.45 → 42.40 | −0.052 [−0.163, +0.062] | −0.036 [−0.075, +0.007] | 0 | 0 |
| fewer than 6 matches | 14,202 | 34.23 → 34.20 | −0.027 [−0.068, +0.017] | +0.012 [−0.004, +0.029] | 0 | 0 |
| **2025–26 DECODE (reused)** · all | 36,842 | 37.36 → 37.26 | **−0.095 [−0.124, −0.066]** | **−0.012 [−0.022, −0.003]** | 0 | 0 |
| quals | 31,725 | 37.30 → 37.20 | −0.093 [−0.125, −0.062] | −0.010 [−0.021, +0.001] | 0 | 0 |
| playoffs | 5,117 | 37.75 → 37.65 | −0.102 [−0.183, −0.024] | −0.027 [−0.052, −0.001] | 0 | 0 |
| fewer than 6 matches | 15,389 | 36.17 → 36.13 | −0.042 [−0.079, −0.005] | +0.008 [−0.005, +0.020] | 0 | 0 |
| 2023–24 (outside the gate) · all | 28,075 | 34.44 → 34.39 | −0.041 [−0.071, −0.010] | +0.001 [−0.010, +0.013] | 0 | 0 |
| quals | 25,106 | 33.99 → 33.94 | −0.052 [−0.083, −0.023] | −0.004 [−0.015, +0.007] | 0 | 0 |
| playoffs | 2,969 | 38.21 → 38.26 | +0.051 [−0.047, +0.151] | +0.038 [+0.002, +0.077] | 0 | 0 |
| fewer than 6 matches | 12,833 | 31.59 → 31.62 | +0.029 [−0.002, +0.062] | +0.023 [+0.011, +0.034] | 0 | 0 |

### Score ranges (80%)

Coverage (share of real alliance scores inside), the 80% interval score (width + 10 × the miss outside; lower is
better) and mean width, 3.4.0 → 3.5.0.

| Season · slice | Coverage | Δ coverage [95%] | Interval score | Δ interval score [95%] | Mean width |
|---|---|---|---|---|---|
| **2024–25** · all | 81.96% → 82.02% | +0.06 [−0.02, +0.13] | 124.46 → 124.07 | −0.39 [−0.46, −0.33] | 89.56 → 89.61 |
| quals | 81.76% → 81.81% | +0.05 [−0.03, +0.13] | 122.62 → 122.21 | −0.41 [−0.48, −0.34] | 87.83 → 87.88 |
| playoffs | 83.33% → 83.42% | +0.09 [−0.11, +0.29] | 136.58 → 136.31 | −0.27 [−0.44, −0.10] | 101.00 → 101.00 |
| fewer than 6 matches | 83.48% → 83.44% | −0.04 [−0.16, +0.06] | 110.30 → 110.09 | −0.21 [−0.28, −0.14] | 81.31 → 81.39 |
| **2025–26 (reused)** · all | 81.43% → 81.38% | −0.05 [−0.13, +0.02] | 126.60 → 126.48 | −0.12 [−0.16, −0.07] | 82.03 → 82.05 |
| quals | 81.65% → 81.59% | −0.06 [−0.14, +0.02] | 126.39 → 126.28 | −0.11 [−0.16, −0.06] | 81.85 → 81.86 |
| playoffs | 80.06% → 80.05% | −0.01 [−0.23, +0.22] | 127.86 → 127.74 | −0.12 [−0.25, +0.01] | 83.17 → 83.17 |
| fewer than 6 matches | 83.38% → 83.38% | 0.00 [−0.10, +0.10] | 122.47 → 122.43 | −0.04 [−0.09, +0.01] | 80.91 → 80.94 |
| 2023–24 · all | 81.48% → 81.50% | +0.02 [−0.05, +0.09] | 112.28 → 112.12 | −0.16 [−0.20, −0.10] | 76.27 → 76.31 |

Ranges are not worse anywhere: the interval score improves or stays within noise in every slice of both seasons,
coverage moves by under 0.1 points (inside noise), and the mean width grows by under 0.1 points (the recentred
ranges clip at 0 a little less often). **The band (3.2.0) is not refitted.**

## Probabilities: bit-identical

- **Slice replay** (`scripts/engine-slices.ts --explain-against` the 3.4.0 dist, `--scores-may-move`): on all
  109,002 predicted matches of 2023–24 to 2025–26, every field `explainMatch` serves other than the eight shown
  score fields is bit-identical to 3.4.0's: win probability, the shadow model, the factors and the whole factor
  sheet (log-odds, weights, points), confidence, reasons, partnership, and, on 2025–26 qualification matches with
  the bonus model passed, P(tie), every bonus-RP odd and expected RP. The eight score fields equal the transform
  of the model's scores exactly (same sd, recentred), and the model's scores round to 3.4.0's shown scores. The
  shown score moved on 93,371 matches. Champion, v2.0 and legacy row SHA-256 equal 3.4.0's
  (`65b44316…`, `a5ce99b6…`, `8ee1a03a…`); Brier 0.1741 / 0.1570 / 0.1672 unchanged. Report:
  `docs/engine/slices/engine-3.5.0-snapshot-2026-10-14`.
- **Replay rows** (`margin-scale.ts replay`) from the 3.4.0 and 3.5.0 builds: identical on all 109,002 rows
  (model scores, range sd, probability), and on every row the 3.5.0 served scores and ranges are exactly the
  transform, and `predictMatch` with `margin: { scale: 1 }` returns the same probability.
- **Event simulator on fixed seeds** (`margin-scale.ts sim`, seed 7, 500 runs): 36 real events (12 a season, half
  their quals played), 678 teams' odds (advance, captain, picked, win, finalist, rank, points) identical to 3.4.0's
  bit for bit. Forecasts' advancement and bracket odds come from these and from the unchanged win probability.
- **Unit tests** (`marginScale.test.ts`): `predictMatch`, `explainMatch` and `Forecaster.forecast` at s = 1, 0.95
  and 0.3 give identical probabilities, contextual inputs, P(tie), bonus odds, factor sheets and simulated odds.

## Ship call

| Gate item | 2024–25 (tuning) | 2025–26 (reused) | Pass |
|---|---|---|---|
| 1. Margin MAE better, interval below 0 | −0.107 [−0.147, −0.064] | −0.095 [−0.124, −0.066] | yes |
| 2. Every probability bit-identical | 109,002 matches, 36 simulated events | (same replay) | yes |
| 3. Ranges not worse (coverage, interval score, width; playoffs, < 6 matches) | interval score −0.39 [−0.46, −0.33] | −0.12 [−0.16, −0.07] | yes, no refit |
| 4. Alliance score MAE not worse beyond noise | −0.018 [−0.031, −0.004] | −0.012 [−0.022, −0.003] | yes (improves) |

**Verdict: ships as 3.5.0** with s = 0.95.

Caveats, reported rather than hidden:
- The gain is small: about a tenth of a point of margin error on a 37–39 point MAE.
- In the fewer-than-6-matches slice the margin gain is small and alliance MAE moves +0.008 to +0.012, inside
  noise in both gate seasons. In 2023–24 (outside the gate, before the tuning season) that slice's alliance MAE is
  worse beyond noise (+0.023 [+0.011, +0.034]), as is playoffs' (+0.038 [+0.002, +0.077]). Thin-data margins are
  already pulled in by the priors, so a single scale over-shrinks them slightly. A per-data-density scale is a
  possible follow-up; it would need its own gate.
