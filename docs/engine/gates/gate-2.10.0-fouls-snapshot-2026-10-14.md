# Gate: 2.10.0-fouls vs engine 2.9.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts --challenger`. Both use the contextual model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23`. The champion's rating settings are the shipped ones:

```json
{}
```

The challenger's changes:

```json
{
 "penGain": 0.15
}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.25 pts, challenger 0.14 pts. Regressions beyond noise: teamMatches: 16+.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | +0.21 [−0.57, +1.04] | +0.32 [−1.66, +2.50] | −0.01 [−0.10, +0.07] |
| Match type: playoff | 2,969 | +1.63 [−1.15, +4.41] | +2.87 [−4.97, +10.58] | +0.10 [−0.14, +0.37] |
| Match type: qual | 25,106 | +0.04 [−0.78, +0.89] | +0.02 [−2.08, +2.18] | −0.03 [−0.12, +0.06] |
| Event phase: qualification match number: playoff | 2,969 | +1.63 [−1.15, +4.41] | +2.87 [−4.97, +10.58] | +0.10 [−0.14, +0.37] |
| Event phase: qualification match number: q1-10 | 10,431 | −0.39 [−1.75, +1.06] | −0.60 [−3.77, +2.78] | +0.00 [−0.16, +0.15] |
| Event phase: qualification match number: q11-25 | 10,412 | +0.38 [−0.68, +1.51] | +1.12 [−1.95, +4.28] | −0.04 [−0.16, +0.07] |
| Event phase: qualification match number: q26+ | 4,263 | +0.27 [−1.71, +2.53] | −1.18 [−6.88, +5.69] | −0.07 [−0.28, +0.13] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | −0.32 [−1.62, +0.96] | −1.21 [−4.50, +1.99] | −0.08 [−0.23, +0.06] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | +0.34 [−1.19, +1.90] | +0.63 [−3.59, +4.81] | +0.06 [−0.10, +0.22] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | +0.86 [−0.31, +2.00] | +2.24 [−1.15, +5.69] | +0.02 [−0.08, +0.14] |
| Team experience (least experienced robot): rookie | 15,029 | −0.10 [−1.19, +0.95] | −0.85 [−3.66, +1.78] | +0.01 [−0.10, +0.11] |
| Team experience (least experienced robot): veteran | 7,416 | +0.97 [−0.51, +2.61] | +2.48 [−1.69, +7.05] | −0.08 [−0.23, +0.07] |
| Team experience (least experienced robot): year2 | 5,630 | +0.04 [−1.46, +1.48] | +0.58 [−3.56, +4.71] | +0.02 [−0.20, +0.22] |
| Rated matches this season (fewest on the field): 0-5 | 12,833 | +0.04 [−1.24, +1.38] | −0.54 [−3.63, +2.79] | −0.10 [−0.24, +0.03] |
| Rated matches this season (fewest on the field): 16+ | 4,861 | +1.56 [+0.16, +3.04] | +3.19 [−1.08, +7.92] | +0.10 [−0.04, +0.25] | **regression**
| Rated matches this season (fewest on the field): 6-15 | 10,381 | −0.21 [−1.34, +0.95] | +0.03 [−2.98, +3.33] | +0.04 [−0.08, +0.16] |
| Data density (all four robots' rated matches): dense | 7,119 | +0.98 [−0.17, +2.15] | +1.49 [−1.92, +5.11] | +0.10 [−0.03, +0.23] |
| Data density (all four robots' rated matches): normal | 11,776 | −0.17 [−1.40, +1.13] | −0.36 [−3.57, +3.07] | −0.03 [−0.15, +0.08] |
| Data density (all four robots' rated matches): thin | 9,180 | +0.10 [−1.50, +1.80] | +0.28 [−3.68, +4.54] | −0.08 [−0.26, +0.09] |
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | +0.82 [−0.95, +2.58] | +2.02 [−2.20, +6.09] | −0.05 [−0.24, +0.14] |
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | +0.56 [−0.47, +1.61] | +0.64 [−2.13, +3.35] | −0.01 [−0.12, +0.10] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | −1.57 [−3.20, +0.01] | −2.71 [−7.26, +1.91] | +0.02 [−0.13, +0.16] |
| Event size (teams): large | 6,510 | +0.72 [−0.87, +2.45] | +1.71 [−2.53, +6.19] | −0.09 [−0.25, +0.07] |
| Event size (teams): mid | 15,470 | −0.39 [−1.47, +0.69] | −1.62 [−4.30, +1.22] | −0.01 [−0.14, +0.11] |
| Event size (teams): small | 6,095 | +1.18 [−0.58, +2.91] | +3.74 [−1.03, +8.34] | +0.07 [−0.07, +0.21] |
| Event type: championship | 4,378 | +0.68 [−1.30, +2.84] | +2.05 [−3.17, +7.80] | +0.02 [−0.21, +0.29] |
| Event type: league meet | 11,683 | +0.39 [−0.84, +1.60] | +0.72 [−2.34, +3.77] | +0.03 [−0.09, +0.16] |
| Event type: qualifier | 11,417 | −0.04 [−1.29, +1.21] | −0.37 [−3.58, +3.09] | −0.08 [−0.21, +0.04] |
| Event type: world | 597 | −1.93 [−4.88, +1.02] | −7.22 [−17.19, +1.88] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 50-60 | 7,222 | +0.62 [−1.24, +2.61] | +1.26 [−2.50, +5.32] | −0.06 [−0.36, +0.26] |
| Favourite's stated chance: 60-70 | 5,790 | +0.13 [−2.05, +2.36] | +0.26 [−4.55, +5.16] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 5,260 | −0.29 [−2.18, +1.71] | −0.65 [−5.70, +4.77] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 5,006 | +0.74 [−0.42, +1.97] | +2.78 [−1.81, +7.73] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 4,797 | −0.31 [−0.79, +0.15] | −2.54 [−7.38, +2.18] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,210 | 54.3% | 54.4% | 0.2% | 0.6% |
| 60-70% | 5,778 | 64.8% | 64.6% | 0.2% | 0.4% |
| 70-80% | 5,261 | 74.9% | 74.9% | 0.0% | 0.1% |
| 80-90% | 5,006 | 84.9% | 85.5% | 0.6% | 0.5% |
| 90-100% | 4,820 | 95.0% | 94.5% | 0.5% | 0.5% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 0.61 pts, challenger 0.63 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | −0.17 [−0.53, +0.18] | −0.06 [−1.04, +0.96] | +0.03 [−0.03, +0.09] |
| Match type: playoff | 4,386 | +0.76 [−0.31, +1.87] | +2.68 [−0.43, +5.84] | −0.02 [−0.16, +0.12] |
| Match type: qual | 28,885 | −0.31 [−0.71, +0.07] | −0.47 [−1.58, +0.60] | +0.03 [−0.03, +0.10] |
| Event phase: qualification match number: playoff | 4,386 | +0.76 [−0.31, +1.87] | +2.68 [−0.43, +5.84] | −0.02 [−0.16, +0.12] |
| Event phase: qualification match number: q1-10 | 10,927 | −0.35 [−1.10, +0.37] | −0.22 [−2.15, +1.60] | −0.01 [−0.13, +0.11] |
| Event phase: qualification match number: q11-25 | 11,671 | −0.54 [−1.10, +0.00] | −1.91 [−3.48, −0.35] | +0.03 [−0.07, +0.13] |
| Event phase: qualification match number: q26+ | 6,287 | +0.18 [−0.52, +0.86] | +1.75 [−0.64, +4.19] | +0.11 [+0.00, +0.25] |
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | −0.32 [−0.94, +0.30] | −0.48 [−2.13, +1.19] | −0.02 [−0.12, +0.08] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | −0.48 [−1.20, +0.24] | −0.66 [−2.80, +1.47] | +0.14 [+0.01, +0.26] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | +0.25 [−0.22, +0.74] | +0.93 [−0.55, +2.49] | +0.01 [−0.09, +0.10] |
| Team experience (least experienced robot): rookie | 16,718 | −0.32 [−0.85, +0.22] | −0.40 [−1.85, +1.08] | +0.06 [−0.03, +0.16] |
| Team experience (least experienced robot): veteran | 8,250 | +0.15 [−0.52, +0.81] | +0.25 [−1.55, +1.99] | +0.00 [−0.12, +0.12] |
| Team experience (least experienced robot): year2 | 8,303 | −0.19 [−0.87, +0.54] | +0.34 [−1.63, +2.35] | −0.01 [−0.11, +0.09] |
| Rated matches this season (fewest on the field): 0-5 | 14,202 | −0.51 [−1.23, +0.14] | −1.15 [−2.96, +0.55] | +0.01 [−0.10, +0.12] |
| Rated matches this season (fewest on the field): 16+ | 6,847 | +0.46 [−0.18, +1.08] | +1.69 [−0.23, +3.63] | +0.01 [−0.10, +0.12] |
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −0.12 [−0.60, +0.35] | +0.24 [−1.38, +1.85] | +0.06 [−0.03, +0.16] |
| Data density (all four robots' rated matches): dense | 10,110 | +0.13 [−0.40, +0.63] | +1.25 [−0.57, +2.99] | +0.04 [−0.04, +0.13] |
| Data density (all four robots' rated matches): normal | 13,190 | +0.01 [−0.48, +0.50] | +0.11 [−1.42, +1.65] | −0.02 [−0.11, +0.08] |
| Data density (all four robots' rated matches): thin | 9,971 | −0.71 [−1.53, +0.13] | −1.60 [−3.64, +0.41] | +0.07 [−0.05, +0.20] |
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | −0.76 [−1.65, +0.14] | −1.90 [−4.17, +0.33] | +0.07 [−0.07, +0.22] |
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | −0.06 [−0.49, +0.37] | +0.28 [−1.06, +1.54] | +0.03 [−0.04, +0.10] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | +0.19 [−0.64, +1.01] | +1.07 [−1.26, +3.39] | −0.02 [−0.15, +0.12] |
| Event size (teams): large | 8,980 | −0.38 [−1.16, +0.33] | −0.68 [−3.13, +1.57] | +0.10 [+0.00, +0.22] |
| Event size (teams): mid | 18,322 | −0.12 [−0.61, +0.34] | +0.11 [−1.23, +1.44] | +0.02 [−0.06, +0.10] |
| Event size (teams): small | 5,969 | +0.01 [−0.83, +0.80] | +0.38 [−1.91, +2.81] | −0.07 [−0.20, +0.07] |
| Event type: championship | 6,344 | +0.13 [−0.82, +1.01] | +1.85 [−0.88, +4.46] | +0.08 [−0.02, +0.20] |
| Event type: league meet | 12,322 | −0.24 [−0.76, +0.28] | −1.20 [−2.57, +0.21] | −0.01 [−0.11, +0.09] |
| Event type: qualifier | 13,903 | −0.30 [−0.92, +0.34] | −0.25 [−1.97, +1.42] | +0.04 [−0.07, +0.14] |
| Event type: world | 702 | +0.89 [−0.11, +1.90] | +6.52 [+1.20, +12.53] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 50-60 | 6,448 | −0.76 [−1.87, +0.39] | −1.53 [−3.78, +0.77] | +0.14 [−0.17, +0.46] |
| Favourite's stated chance: 60-70 | 6,065 | −0.72 [−1.75, +0.34] | −1.60 [−3.88, +0.72] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 5,962 | −0.03 [−0.95, +0.91] | −0.17 [−2.62, +2.29] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,291 | +0.42 [−0.20, +1.05] | +1.81 [−0.73, +4.29] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 8,505 | +0.14 [−0.08, +0.37] | +0.85 [−1.06, +2.87] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,438 | 54.9% | 54.7% | 0.2% | 0.3% |
| 60-70% | 6,053 | 65.1% | 65.6% | 0.6% | 0.6% |
| 70-80% | 5,960 | 74.9% | 76.1% | 1.2% | 1.1% |
| 80-90% | 6,262 | 85.1% | 83.9% | 1.2% | 1.1% |
| 90-100% | 8,558 | 95.5% | 94.8% | 0.7% | 0.2% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 0.77 pts, challenger 0.81 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | −0.68 [−1.93, +0.52] | −1.47 [−5.01, +1.85] | +0.01 [−0.09, +0.12] |
| Match type: playoff | 5,117 | −1.39 [−6.22, +3.19] | −3.70 [−17.37, +9.69] | +0.14 [−0.20, +0.49] |
| Match type: qual | 31,725 | −0.56 [−1.79, +0.57] | −1.11 [−4.49, +2.02] | −0.01 [−0.11, +0.09] |
| Event phase: qualification match number: playoff | 5,117 | −1.39 [−6.22, +3.19] | −3.70 [−17.37, +9.69] | +0.14 [−0.20, +0.49] |
| Event phase: qualification match number: q1-10 | 11,613 | −0.73 [−2.68, +1.34] | −1.84 [−6.45, +3.41] | −0.06 [−0.25, +0.14] |
| Event phase: qualification match number: q11-25 | 12,697 | −0.62 [−2.42, +1.20] | −1.40 [−6.45, +3.88] | +0.04 [−0.10, +0.20] |
| Event phase: qualification match number: q26+ | 7,415 | −0.19 [−2.52, +2.19] | +0.52 [−6.32, +7.15] | −0.01 [−0.20, +0.17] |
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | −1.28 [−3.55, +0.81] | −3.70 [−9.57, +2.22] | −0.08 [−0.24, +0.08] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | +1.02 [−1.28, +3.43] | +1.79 [−4.68, +8.45] | −0.05 [−0.27, +0.17] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | −1.10 [−3.07, +0.72] | −0.97 [−6.57, +4.27] | +0.17 [+0.01, +0.34] |
| Team experience (least experienced robot): rookie | 17,177 | −0.98 [−2.76, +0.81] | −2.56 [−7.73, +2.76] | +0.02 [−0.13, +0.16] |
| Team experience (least experienced robot): veteran | 10,384 | −0.57 [−2.63, +1.46] | −3.74 [−9.36, +2.00] | −0.05 [−0.22, +0.14] |
| Team experience (least experienced robot): year2 | 9,281 | −0.23 [−2.47, +2.14] | +3.07 [−3.24, +9.27] | +0.07 [−0.15, +0.28] |
| Rated matches this season (fewest on the field): 0-5 | 15,389 | −0.00 [−1.79, +1.88] | −0.01 [−4.75, +4.87] | −0.04 [−0.20, +0.13] |
| Rated matches this season (fewest on the field): 16+ | 8,268 | −1.62 [−3.95, +0.82] | −2.94 [−9.63, +4.20] | +0.13 [−0.08, +0.35] |
| Rated matches this season (fewest on the field): 6-15 | 13,185 | −0.87 [−3.26, +1.31] | −2.27 [−9.20, +3.95] | −0.01 [−0.18, +0.16] |
| Data density (all four robots' rated matches): dense | 11,835 | −0.68 [−2.46, +1.21] | −0.88 [−5.95, +4.63] | +0.13 [−0.04, +0.28] |
| Data density (all four robots' rated matches): normal | 14,138 | −1.27 [−3.45, +0.88] | −2.93 [−9.19, +3.13] | +0.02 [−0.14, +0.19] |
| Data density (all four robots' rated matches): thin | 10,869 | +0.11 [−2.26, +2.40] | −0.22 [−6.29, +5.50] | −0.13 [−0.33, +0.07] |
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | +2.11 [−0.49, +4.59] | +4.12 [−2.79, +10.74] | −0.19 [−0.41, +0.03] |
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | −1.76 [−3.52, −0.00] | −3.74 [−8.45, +1.17] | +0.06 [−0.08, +0.19] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | −0.50 [−2.87, +1.89] | −0.89 [−7.73, +5.94] | +0.08 [−0.14, +0.30] |
| Event size (teams): large | 10,439 | −0.40 [−2.26, +1.48] | −0.47 [−6.04, +5.15] | +0.09 [−0.11, +0.28] |
| Event size (teams): mid | 20,568 | −0.72 [−2.39, +0.89] | −0.76 [−5.48, +3.58] | −0.03 [−0.16, +0.10] |
| Event size (teams): small | 5,835 | −1.01 [−5.26, +2.95] | −5.77 [−17.90, +5.28] | +0.03 [−0.21, +0.29] |
| Event type: championship | 7,650 | −1.82 [−4.17, +0.62] | −4.06 [−10.62, +2.97] | +0.05 [−0.15, +0.26] |
| Event type: league meet | 12,338 | −0.37 [−2.24, +1.49] | −1.80 [−6.89, +3.49] | −0.02 [−0.18, +0.14] |
| Event type: qualifier | 15,911 | −0.47 [−2.80, +1.72] | −0.35 [−7.02, +5.90] | +0.03 [−0.14, +0.19] |
| Event type: world | 943 | +1.21 [−1.77, +4.05] | +4.77 [−4.06, +14.12] | −0.11 [−0.63, +0.28] |
| Favourite's stated chance: 50-60 | 8,077 | +0.44 [−2.81, +3.58] | +0.84 [−5.76, +7.23] | +0.05 [−0.40, +0.52] |
| Favourite's stated chance: 60-70 | 7,750 | −2.94 [−5.97, +0.08] | −6.49 [−13.12, +0.19] | +0.00 [−0.04, +0.04] |
| Favourite's stated chance: 70-80 | 7,233 | −0.13 [−2.91, +2.75] | −0.62 [−8.19, +7.06] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 7,023 | −0.73 [−3.56, +1.76] | −2.78 [−12.86, +6.20] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 6,759 | +0.07 [−0.83, +0.99] | +1.96 [−5.84, +10.48] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,103 | 55.0% | 56.0% | 1.0% | 1.0% |
| 60-70% | 7,767 | 65.0% | 65.2% | 0.2% | 0.2% |
| 70-80% | 7,267 | 75.0% | 76.2% | 1.2% | 1.2% |
| 80-90% | 6,955 | 85.0% | 86.1% | 1.1% | 1.1% |
| 90-100% | 6,750 | 94.9% | 94.5% | 0.4% | 0.5% |
