# Gate: 2.7.0-priors vs engine 2.7.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts --challenger`. Both use the contextual model `ctx-rel-form-2026-10-17-1fdd2958`. The champion's rating settings are the shipped ones with these overrides (the previous release):

```json
{
 "rho1": 0.6,
 "regionKappa": 0
}
```

The challenger's changes:

```json
{}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.80 pts, challenger 0.80 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Match type: playoff | 2,969 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Match type: qual | 25,106 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event phase: qualification match number: playoff | 2,969 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event phase: qualification match number: q1-10 | 10,431 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event phase: qualification match number: q11-25 | 10,412 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event phase: qualification match number: q26+ | 4,263 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Team experience (least experienced robot): rookie | 15,029 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Team experience (least experienced robot): veteran | 7,416 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Team experience (least experienced robot): year2 | 5,630 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Rated matches this season (fewest on the field): 0-5 | 12,833 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Rated matches this season (fewest on the field): 16+ | 4,861 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Rated matches this season (fewest on the field): 6-15 | 10,381 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Data density (all four robots' rated matches): dense | 7,119 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Data density (all four robots' rated matches): normal | 11,776 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Data density (all four robots' rated matches): thin | 9,180 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event size (teams): large | 6,510 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event size (teams): mid | 15,470 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event size (teams): small | 6,095 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event type: championship | 4,378 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event type: league meet | 11,683 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event type: qualifier | 11,417 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Event type: world | 597 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 50-60 | 7,668 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 60-70 | 6,095 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 5,326 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 4,779 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 4,207 | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,668 | 54.3% | 54.6% | 0.2% | 0.4% |
| 60-70% | 6,095 | 64.9% | 65.8% | 1.0% | 0.8% |
| 70-80% | 5,326 | 74.9% | 76.4% | 1.4% | 1.4% |
| 80-90% | 4,779 | 84.8% | 87.1% | 2.3% | 2.1% |
| 90-100% | 4,207 | 94.8% | 95.0% | 0.2% | 0.0% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 1.45 pts, challenger 1.32 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | −3.29 [−4.50, −2.06] | −8.42 [−11.36, −5.44] | +0.08 [−0.02, +0.17] | better
| Match type: playoff | 4,386 | −1.11 [−2.23, +0.00] | −4.11 [−7.08, −1.13] | +0.00 [−0.16, +0.16] |
| Match type: qual | 28,885 | −3.62 [−5.01, −2.29] | −9.08 [−12.49, −5.70] | +0.09 [−0.01, +0.20] | better
| Event phase: qualification match number: playoff | 4,386 | −1.11 [−2.23, +0.00] | −4.11 [−7.08, −1.13] | +0.00 [−0.16, +0.16] |
| Event phase: qualification match number: q1-10 | 10,927 | −3.37 [−6.09, −0.62] | −7.78 [−14.40, −0.75] | +0.05 [−0.15, +0.26] | better
| Event phase: qualification match number: q11-25 | 11,671 | −4.60 [−6.39, −2.73] | −11.73 [−16.31, −7.14] | +0.12 [−0.03, +0.26] | better
| Event phase: qualification match number: q26+ | 6,287 | −2.23 [−3.64, −0.76] | −6.40 [−10.13, −2.68] | +0.11 [−0.05, +0.28] | better
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | −6.12 [−8.69, −3.48] | −15.13 [−21.41, −8.57] | +0.07 [−0.12, +0.27] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | −2.18 [−3.65, −0.64] | −6.93 [−10.54, −3.05] | +0.11 [−0.05, +0.28] | better
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | −0.48 [−0.90, −0.04] | −0.94 [−2.15, +0.30] | +0.06 [+0.00, +0.13] | better
| Team experience (least experienced robot): rookie | 16,718 | −3.06 [−4.78, −1.41] | −6.98 [−11.14, −3.01] | +0.04 [−0.10, +0.18] | better
| Team experience (least experienced robot): veteran | 8,250 | −3.66 [−5.98, −1.36] | −9.25 [−15.05, −3.33] | +0.07 [−0.09, +0.24] | better
| Team experience (least experienced robot): year2 | 8,303 | −3.38 [−5.57, −1.31] | −10.49 [−16.14, −5.07] | +0.16 [−0.04, +0.35] | better
| Rated matches this season (fewest on the field): 0-5 | 14,202 | −6.39 [−9.05, −3.70] | −16.07 [−22.78, −9.40] | +0.14 [−0.06, +0.33] | better
| Rated matches this season (fewest on the field): 16+ | 6,847 | −0.16 [−0.47, +0.17] | +0.02 [−1.07, +1.18] | +0.04 [−0.02, +0.11] |
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −1.43 [−2.31, −0.55] | −4.25 [−6.55, −1.94] | +0.02 [−0.07, +0.12] | better
| Data density (all four robots' rated matches): dense | 10,110 | −0.53 [−0.98, −0.10] | −0.99 [−2.30, +0.21] | +0.08 [+0.01, +0.15] | better
| Data density (all four robots' rated matches): normal | 13,190 | −2.70 [−4.21, −1.33] | −7.32 [−11.13, −3.69] | +0.00 [−0.13, +0.13] | better
| Data density (all four robots' rated matches): thin | 9,971 | −6.85 [−10.43, −3.48] | −17.41 [−25.96, −9.07] | +0.18 [−0.07, +0.45] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | −4.11 [−7.33, −0.55] | −10.46 [−18.58, −1.95] | +0.19 [−0.09, +0.50] | better
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | −3.66 [−5.10, −2.23] | −9.04 [−12.63, −5.56] | +0.05 [−0.06, +0.16] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | −1.22 [−2.94, +0.38] | −4.22 [−8.69, −0.12] | +0.05 [−0.09, +0.19] |
| Event size (teams): large | 8,980 | −1.89 [−3.69, −0.21] | −5.33 [−9.92, −0.81] | −0.04 [−0.20, +0.10] | better
| Event size (teams): mid | 18,322 | −3.79 [−5.60, −2.04] | −9.31 [−13.72, −4.81] | +0.12 [−0.01, +0.25] | better
| Event size (teams): small | 5,969 | −3.83 [−6.74, −0.69] | −10.33 [−17.73, −2.71] | +0.14 [−0.10, +0.38] | better
| Event type: championship | 6,344 | −1.52 [−3.16, +0.05] | −3.31 [−7.32, +0.38] | +0.06 [−0.08, +0.21] |
| Event type: league meet | 12,322 | −4.99 [−6.93, −3.05] | −13.09 [−17.91, −8.23] | +0.05 [−0.11, +0.20] | better
| Event type: qualifier | 13,903 | −2.66 [−4.82, −0.39] | −6.83 [−12.17, −1.28] | +0.12 [−0.04, +0.27] | better
| Event type: world | 702 | −1.72 [−4.39, +0.03] | −4.30 [−11.17, −0.21] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 50-60 | 6,941 | −5.44 [−8.69, −1.95] | −11.09 [−17.72, −3.96] | +0.38 [−0.09, +0.84] | better
| Favourite's stated chance: 60-70 | 6,573 | −5.93 [−9.51, −2.53] | −13.37 [−21.26, −5.81] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 70-80 | 6,081 | −3.57 [−6.19, −0.82] | −9.40 [−16.49, −2.01] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 80-90 | 6,174 | −1.40 [−3.00, +0.32] | −5.85 [−12.27, +0.94] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 7,502 | −0.31 [−0.71, +0.16] | −2.94 [−6.17, +1.00] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,799 | 54.9% | 55.0% | 0.1% | 0.0% |
| 60-70% | 6,440 | 65.0% | 66.7% | 1.7% | 1.7% |
| 70-80% | 6,130 | 74.9% | 77.2% | 2.3% | 2.2% |
| 80-90% | 6,226 | 85.1% | 85.0% | 0.1% | 0.0% |
| 90-100% | 7,676 | 95.3% | 95.4% | 0.1% | 0.4% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 1.95 pts, challenger 1.64 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | −2.37 [−3.47, −1.29] | −6.19 [−8.98, −3.61] | −0.01 [−0.10, +0.08] | better
| Match type: playoff | 5,117 | −0.38 [−1.35, +0.64] | −0.95 [−3.47, +1.57] | +0.02 [−0.11, +0.16] |
| Match type: qual | 31,725 | −2.69 [−3.99, −1.53] | −7.04 [−10.31, −4.04] | −0.02 [−0.12, +0.09] | better
| Event phase: qualification match number: playoff | 5,117 | −0.38 [−1.35, +0.64] | −0.95 [−3.47, +1.57] | +0.02 [−0.11, +0.16] |
| Event phase: qualification match number: q1-10 | 11,613 | −4.65 [−7.25, −2.18] | −11.24 [−17.81, −4.72] | +0.02 [−0.18, +0.22] | better
| Event phase: qualification match number: q11-25 | 12,697 | −1.56 [−3.08, −0.04] | −4.73 [−8.76, −0.87] | −0.04 [−0.19, +0.12] | better
| Event phase: qualification match number: q26+ | 7,415 | −1.55 [−2.77, −0.38] | −4.43 [−7.34, −1.57] | −0.03 [−0.21, +0.14] | better
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | −4.70 [−7.15, −2.41] | −12.79 [−19.16, −7.00] | −0.12 [−0.30, +0.07] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | −1.49 [−2.72, −0.29] | −3.20 [−6.55, +0.08] | +0.10 [−0.05, +0.26] | better
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | −0.07 [−0.50, +0.38] | −0.06 [−1.22, +1.17] | +0.04 [−0.02, +0.11] |
| Team experience (least experienced robot): rookie | 17,177 | −1.52 [−2.98, +0.04] | −3.75 [−7.73, +0.33] | −0.04 [−0.18, +0.10] |
| Team experience (least experienced robot): veteran | 10,384 | −3.25 [−5.07, −1.39] | −8.84 [−13.31, −4.36] | +0.17 [+0.02, +0.33] | better
| Team experience (least experienced robot): year2 | 9,281 | −2.94 [−5.05, −0.81] | −7.75 [−13.29, −2.15] | −0.16 [−0.35, +0.02] | better
| Rated matches this season (fewest on the field): 0-5 | 15,389 | −5.07 [−7.62, −2.74] | −13.56 [−19.77, −7.46] | −0.09 [−0.27, +0.09] | better
| Rated matches this season (fewest on the field): 16+ | 8,268 | −0.26 [−0.59, +0.08] | −0.70 [−1.55, +0.17] | +0.01 [−0.06, +0.09] |
| Rated matches this season (fewest on the field): 6-15 | 13,185 | −0.53 [−1.33, +0.27] | −1.04 [−3.25, +1.11] | +0.07 [−0.04, +0.18] |
| Data density (all four robots' rated matches): dense | 11,835 | −0.33 [−0.79, +0.16] | −0.84 [−2.03, +0.46] | +0.08 [+0.01, +0.14] |
| Data density (all four robots' rated matches): normal | 14,138 | −3.11 [−4.35, −1.89] | −8.14 [−11.45, −4.85] | +0.00 [−0.13, +0.13] | better
| Data density (all four robots' rated matches): thin | 10,869 | −3.62 [−6.83, −0.53] | −9.49 [−17.21, −1.73] | −0.12 [−0.37, +0.12] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | −2.03 [−5.43, +1.43] | −4.15 [−12.56, +4.78] | +0.00 [−0.26, +0.25] |
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | −2.46 [−3.52, −1.40] | −6.93 [−9.79, −4.03] | −0.05 [−0.15, +0.04] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | −2.45 [−4.38, −0.51] | −6.26 [−10.89, −1.56] | +0.08 [−0.08, +0.26] | better
| Event size (teams): large | 10,439 | −2.28 [−3.88, −0.68] | −6.67 [−10.76, −2.62] | +0.13 [+0.00, +0.29] | better
| Event size (teams): mid | 20,568 | −1.18 [−2.41, +0.14] | −3.54 [−6.90, −0.06] | −0.15 [−0.28, −0.03] |
| Event size (teams): small | 5,835 | −6.70 [−10.81, −2.88] | −14.70 [−24.74, −5.22] | +0.21 [−0.05, +0.47] | better
| Event type: championship | 7,650 | −0.79 [−2.13, +0.51] | −1.42 [−4.86, +2.15] | +0.01 [−0.14, +0.15] |
| Event type: league meet | 12,338 | −2.43 [−4.06, −0.72] | −6.13 [−10.27, −1.97] | +0.21 [+0.05, +0.37] | better
| Event type: qualifier | 15,911 | −3.02 [−5.07, −0.99] | −8.38 [−13.64, −2.99] | −0.20 [−0.35, −0.05] | better
| Event type: world | 943 | −3.39 [−6.43, −0.83] | −8.78 [−15.96, −2.96] | +0.11 [+0.00, +0.32] | better
| Favourite's stated chance: 50-60 | 8,762 | −2.09 [−4.87, +0.56] | −4.32 [−9.91, +1.10] | −0.05 [−0.43, +0.34] |
| Favourite's stated chance: 60-70 | 8,266 | −3.89 [−6.33, −1.42] | −9.03 [−14.47, −3.58] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 70-80 | 7,288 | −3.01 [−5.16, −0.77] | −8.51 [−14.29, −2.36] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 80-90 | 6,786 | −2.17 [−3.35, −0.97] | −8.66 [−13.41, −3.67] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 90-100 | 5,740 | −0.00 [−0.60, +0.56] | +0.88 [−3.98, +5.91] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,581 | 55.0% | 56.3% | 1.3% | 1.3% |
| 60-70% | 8,157 | 64.9% | 65.9% | 1.0% | 0.9% |
| 70-80% | 7,328 | 74.9% | 77.6% | 2.7% | 2.6% |
| 80-90% | 6,889 | 84.9% | 87.2% | 2.3% | 2.2% |
| 90-100% | 5,887 | 94.8% | 94.9% | 0.2% | 0.1% |
