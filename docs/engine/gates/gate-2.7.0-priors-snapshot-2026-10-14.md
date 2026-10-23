# Gate: 2.7.0-priors vs engine 2.6.0 on snapshot-2026-10-14

Generated 2026-10-22 by `scripts/engine-slices.ts --challenger`. The challenger is the champion (`ctx-rel-form-2026-10-17-1fdd2958`) with these rating settings changed:

```json
{
 "regionKappa": 20,
 "rho1": 0.7
}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.80 pts, challenger 0.80 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Match type: playoff | 2,969 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Match type: qual | 25,106 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event phase: qualification match number: playoff | 2,969 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event phase: qualification match number: q1-10 | 10,431 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event phase: qualification match number: q11-25 | 10,412 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event phase: qualification match number: q26+ | 4,263 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Team experience (least experienced robot): rookie | 15,029 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Team experience (least experienced robot): veteran | 7,416 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Team experience (least experienced robot): year2 | 5,630 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Rated matches this season (fewest on the field): 0-5 | 12,833 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Rated matches this season (fewest on the field): 16+ | 4,861 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Rated matches this season (fewest on the field): 6-15 | 10,381 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Data density (all four robots' rated matches): dense | 7,119 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Data density (all four robots' rated matches): normal | 11,776 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Data density (all four robots' rated matches): thin | 9,180 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event size (teams): large | 6,510 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event size (teams): mid | 15,470 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event size (teams): small | 6,095 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event type: championship | 4,378 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event type: league meet | 11,683 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event type: qualifier | 11,417 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Event type: world | 597 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 50-60 | 7,668 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 60-70 | 6,095 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 5,326 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 4,779 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 4,207 | +0.00 [+0.00, +0.00] | +0.00 | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,668 | 54.3% | 54.6% | 0.2% | 0.4% |
| 60-70% | 6,095 | 64.9% | 65.8% | 1.0% | 0.8% |
| 70-80% | 5,326 | 74.9% | 76.4% | 1.4% | 1.4% |
| 80-90% | 4,779 | 84.8% | 87.1% | 2.3% | 2.1% |
| 90-100% | 4,207 | 94.8% | 95.0% | 0.2% | 0.0% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 1.45 pts, challenger 1.22 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | −2.11 [−3.37, −0.90] | −5.72 | +0.01 [−0.09, +0.11] | better
| Match type: playoff | 4,386 | −0.89 [−2.16, +0.35] | −3.29 | +0.11 [−0.02, +0.25] |
| Match type: qual | 28,885 | −2.30 [−3.65, −1.02] | −6.09 | −0.00 [−0.11, +0.11] | better
| Event phase: qualification match number: playoff | 4,386 | −0.89 [−2.16, +0.35] | −3.29 | +0.11 [−0.02, +0.25] |
| Event phase: qualification match number: q1-10 | 10,927 | −0.28 [−3.07, +2.60] | −0.71 | −0.11 [−0.31, +0.09] |
| Event phase: qualification match number: q11-25 | 11,671 | −4.18 [−6.33, −1.91] | −10.67 | +0.03 [−0.14, +0.18] | better
| Event phase: qualification match number: q26+ | 6,287 | −2.33 [−4.09, −0.64] | −6.93 | +0.13 [−0.05, +0.30] | better
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | −4.01 [−6.66, −1.36] | −10.31 | −0.01 [−0.22, +0.18] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | −1.41 [−2.94, +0.18] | −5.20 | +0.08 [−0.10, +0.24] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | −0.21 [−0.66, +0.23] | −0.24 | +0.00 [−0.07, +0.07] |
| Team experience (least experienced robot): rookie | 16,718 | −1.58 [−3.32, +0.10] | −4.05 | +0.00 [−0.15, +0.15] |
| Team experience (least experienced robot): veteran | 8,250 | −2.90 [−5.16, −0.68] | −7.40 | −0.04 [−0.20, +0.13] | better
| Team experience (least experienced robot): year2 | 8,303 | −2.42 [−4.85, −0.02] | −7.41 | +0.08 [−0.11, +0.29] | better
| Rated matches this season (fewest on the field): 0-5 | 14,202 | −4.13 [−6.94, −1.37] | −11.00 | +0.03 [−0.17, +0.23] | better
| Rated matches this season (fewest on the field): 16+ | 6,847 | −0.24 [−0.62, +0.13] | −0.29 | +0.01 [−0.06, +0.10] |
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −0.82 [−1.79, +0.11] | −2.62 | −0.01 [−0.10, +0.08] |
| Data density (all four robots' rated matches): dense | 10,110 | −0.56 [−1.07, −0.11] | −1.18 | +0.06 [−0.01, +0.13] | better
| Data density (all four robots' rated matches): normal | 13,190 | −1.79 [−3.41, −0.16] | −4.60 | −0.04 [−0.17, +0.09] | better
| Data density (all four robots' rated matches): thin | 9,971 | −4.12 [−7.66, −0.77] | −11.80 | +0.03 [−0.22, +0.30] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | −0.70 [−4.24, +3.00] | −3.29 | +0.12 [−0.18, +0.43] |
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | −2.89 [−4.34, −1.49] | −7.26 | −0.04 [−0.14, +0.07] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | −1.41 [−3.54, +0.66] | −3.89 | +0.05 [−0.09, +0.19] |
| Event size (teams): large | 8,980 | −2.08 [−4.05, −0.12] | −6.49 | −0.08 [−0.25, +0.08] | better
| Event size (teams): mid | 18,322 | −1.89 [−3.56, −0.15] | −4.40 | +0.06 [−0.07, +0.19] | better
| Event size (teams): small | 5,969 | −2.87 [−5.84, +0.06] | −8.61 | +0.02 [−0.23, +0.26] |
| Event type: championship | 6,344 | −1.29 [−2.84, +0.26] | −3.04 | −0.02 [−0.17, +0.13] |
| Event type: league meet | 12,322 | −4.10 [−6.15, −2.04] | −11.33 | −0.08 [−0.25, +0.08] | better
| Event type: qualifier | 13,903 | −0.74 [−2.80, +1.32] | −2.01 | +0.11 [−0.04, +0.28] |
| Event type: world | 702 | −2.02 [−5.20, −0.05] | −4.90 | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 50-60 | 6,941 | −2.43 [−5.91, +1.14] | −4.81 | +0.03 [−0.44, +0.52] |
| Favourite's stated chance: 60-70 | 6,573 | −3.87 [−7.91, −0.07] | −8.37 | +0.03 [+0.00, +0.08] | better
| Favourite's stated chance: 70-80 | 6,081 | −2.72 [−5.65, +0.13] | −7.34 | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,174 | −1.53 [−3.39, +0.41] | −6.46 | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 7,502 | −0.27 [−0.83, +0.33] | −2.32 | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,799 | 54.9% | 54.9% | 0.0% | 0.1% |
| 60-70% | 6,456 | 65.0% | 66.5% | 1.5% | 1.5% |
| 70-80% | 6,116 | 74.9% | 77.2% | 2.3% | 2.2% |
| 80-90% | 6,227 | 85.1% | 85.0% | 0.0% | 0.0% |
| 90-100% | 7,673 | 95.3% | 95.4% | 0.1% | 0.4% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 1.95 pts, challenger 1.64 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | −2.30 [−3.40, −1.23] | −6.09 | −0.04 [−0.13, +0.06] | better
| Match type: playoff | 5,117 | −0.28 [−1.48, +0.90] | −0.94 | −0.02 [−0.16, +0.12] |
| Match type: qual | 31,725 | −2.62 [−3.87, −1.38] | −6.92 | −0.04 [−0.15, +0.07] | better
| Event phase: qualification match number: playoff | 5,117 | −0.28 [−1.48, +0.90] | −0.94 | −0.02 [−0.16, +0.12] |
| Event phase: qualification match number: q1-10 | 11,613 | −4.03 [−6.59, −1.56] | −9.39 | +0.03 [−0.14, +0.23] | better
| Event phase: qualification match number: q11-25 | 12,697 | −2.36 [−4.13, −0.66] | −7.10 | −0.09 [−0.26, +0.09] | better
| Event phase: qualification match number: q26+ | 7,415 | −0.85 [−2.22, +0.57] | −2.76 | −0.07 [−0.26, +0.11] |
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | −5.03 [−7.35, −2.67] | −13.63 | −0.13 [−0.32, +0.06] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | −0.75 [−2.00, +0.53] | −1.78 | +0.07 [−0.11, +0.23] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | +0.04 [−0.43, +0.52] | +0.30 | +0.01 [−0.06, +0.08] |
| Team experience (least experienced robot): rookie | 17,177 | −1.58 [−3.22, +0.09] | −4.09 | −0.04 [−0.18, +0.10] |
| Team experience (least experienced robot): veteran | 10,384 | −2.71 [−4.68, −0.86] | −7.61 | +0.14 [−0.03, +0.30] | better
| Team experience (least experienced robot): year2 | 9,281 | −3.16 [−5.19, −1.24] | −8.10 | −0.23 [−0.44, −0.03] | better
| Rated matches this season (fewest on the field): 0-5 | 15,389 | −5.26 [−7.67, −2.94] | −14.14 | −0.10 [−0.30, +0.09] | better
| Rated matches this season (fewest on the field): 16+ | 8,268 | −0.26 [−0.60, +0.11] | −0.45 | +0.02 [−0.03, +0.09] |
| Rated matches this season (fewest on the field): 6-15 | 13,185 | −0.12 [−1.00, +0.75] | −0.24 | +0.01 [−0.12, +0.13] |
| Data density (all four robots' rated matches): dense | 11,835 | −0.17 [−0.70, +0.40] | −0.44 | +0.08 [+0.02, +0.16] |
| Data density (all four robots' rated matches): normal | 14,138 | −3.06 [−4.49, −1.60] | −8.05 | −0.05 [−0.19, +0.09] | better
| Data density (all four robots' rated matches): thin | 10,869 | −3.62 [−6.60, −0.55] | −9.70 | −0.15 [−0.39, +0.10] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | −2.27 [−5.66, +1.20] | −5.54 | −0.04 [−0.30, +0.22] |
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | −2.34 [−3.48, −1.24] | −6.38 | −0.04 [−0.14, +0.07] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | −2.20 [−4.51, +0.19] | −5.84 | −0.03 [−0.21, +0.15] |
| Event size (teams): large | 10,439 | −1.42 [−3.14, +0.15] | −4.63 | +0.02 [−0.14, +0.19] |
| Event size (teams): mid | 20,568 | −2.19 [−3.53, −0.82] | −5.69 | −0.10 [−0.23, +0.03] | better
| Event size (teams): small | 5,835 | −4.24 [−7.89, −0.67] | −10.12 | +0.10 [−0.14, +0.38] | better
| Event type: championship | 7,650 | −0.51 [−1.85, +0.79] | −1.00 | +0.00 [−0.17, +0.16] |
| Event type: league meet | 12,338 | −2.27 [−4.09, −0.61] | −6.03 | +0.16 [+0.00, +0.33] | better
| Event type: qualifier | 15,911 | −3.13 [−5.13, −1.14] | −8.49 | −0.22 [−0.37, −0.06] | better
| Event type: world | 943 | −3.01 [−6.17, −0.58] | −7.72 | +0.21 [+0.00, +0.64] | better
| Favourite's stated chance: 50-60 | 8,762 | −2.09 [−4.81, +0.87] | −4.24 | −0.15 [−0.56, +0.25] |
| Favourite's stated chance: 60-70 | 8,266 | −3.61 [−6.19, −1.14] | −8.27 | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 70-80 | 7,288 | −3.25 [−5.60, −0.84] | −9.33 | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 80-90 | 6,786 | −2.03 [−3.43, −0.67] | −8.35 | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 90-100 | 5,740 | +0.16 [−0.35, +0.74] | +0.99 | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,597 | 55.0% | 56.2% | 1.2% | 1.2% |
| 60-70% | 8,174 | 64.9% | 66.2% | 1.3% | 1.2% |
| 70-80% | 7,309 | 74.9% | 77.4% | 2.5% | 2.4% |
| 80-90% | 6,867 | 84.9% | 87.2% | 2.2% | 2.2% |
| 90-100% | 5,895 | 94.8% | 95.0% | 0.2% | 0.0% |
