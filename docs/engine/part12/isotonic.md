# Part 12.5: isotonic calibration challenger (measured, rejected)

**Verdict: the shipped stretch stays.** The global final calibration remains the Platt-family slope from 2.8.0 (1.057692). The engine stays 3.0.0.
- Script: `scripts/part12/isotonic.ts`.
- Output: `isotonic-2026-10-23.json`.

## The brief's claim

Isotonic regression might fit the GLOBAL calibration mapping better than Platt's sigmoid. Half the value is the comparison itself: "if Platt's sigmoid already matches the isotonic shape, that's published evidence the calibration family is right". The gate is to win held-out calibration error in the 55–85% bands, not just global Brier. Per-slice mappings were out of scope; Part 9 had already rejected them.

## Method

- **Input:** the engine's probability before its final stretch. Rows came from `engine-slices --champion '{"rating":{},"recalibration":false}' --rows`, using the same replay as the served call.
- **Rolling origins, as in Part 9.** Each month from October 2024 to July 2026 gets mappings fitted on the 365 days before it, then scored on that month only.
- **Platt:** p′ = σ(a·z), slope only (the shipped form; no intercept, since an intercept would be a red/blue term). Fitted on mirrored rows.
- **Isotonic:** the favourite's win rate as a non-decreasing function of |z|, fitted by pool-adjacent-violators.
  - It is anchored at 0.5 for a coin flip, mirrored so that p(−z) = 1 − p(z), and linearly interpolated between block centres.
- **Calibration error:** in the 55–85% bands of the favourite's stated chance, using 5-point bins and match-weighted |stated − won|.
- **Intervals:** event bootstraps for both Brier and calibration error.

## Measured

Isotonic minus Platt. Brier and log loss are ×10⁻⁴, where negative is better.

| Season | n | Δ Brier [95%] | Δ log loss [95%] | Δ accuracy |
|---|---|---|---|---|
| 2024–25 (rolled, tuning) | 33,228 | +0.90 [+0.13, +1.68] | +2.71 [+0.03, +5.43] | −0.07 pts |
| 2025–26 (rolled, reused) | 36,615 | +0.07 [−0.85, +1.01] | +0.55 [−2.18, +3.36] | 0.00 pts |

Calibration error, 55–85% bands (points):

| Season | No stretch | Platt | Isotonic | Isotonic − Platt [95%] |
|---|---|---|---|---|
| 2024–25 | 1.36 | 0.76 | 0.59 | −0.17 [−0.57, +0.34] |
| 2025–26 | 1.89 | 1.22 | 0.86 | −0.36 [−0.86, +0.17] |

Platt's bins, 2025–26 (stated / won):

| Band | 55–60 | 60–65 | 65–70 | 70–75 | 75–80 | 80–85 |
|---|---|---|---|---|---|---|
| Stated / won | 57.5 / 58.1 | 62.5 / 62.7 | 67.5 / 68.8 | 72.5 / 74.1 | 77.5 / 79.8 | 82.5 / 84.0 |

The month-by-month Platt slope stays between 1.03 and 1.09. The shipped value, 1.0577, is in the middle of that range.

## Why rejected

- **It does not win the gate.** Isotonic's calibration error is lower as a point estimate in both seasons, but both intervals include zero.
- **It costs Brier on the tuning season** (+0.90×10⁻⁴, beyond noise) and is neutral on the reused one. Its step map fits noise that the sigmoid smooths over.
- **The family is right.** A free-form monotone fit does not find a shape the one-parameter sigmoid misses:
  - Platt's residual errors in 2025–26 are 0.2–2.3 points, all on the favourite's side.
  - That pattern says "slightly bolder", which a slightly larger slope covers. It is not "a different shape".

## Note for the rollover

In 2025–26 the favourite won 1–2 points more often than stated in the 65–85% bands, even after the stretch. The rolling slope climbed to about 1.09 by spring 2026. The yearly refit at the 2026–27 rollover should re-fit this slope; it is already on the rollover list.
