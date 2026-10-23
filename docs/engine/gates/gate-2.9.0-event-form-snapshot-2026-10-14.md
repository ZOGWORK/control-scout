# Gate: 2.9.0-event-form vs engine 2.8.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts --challenger`. Both use the contextual model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23`. The champion's rating settings are the shipped ones:

```json
{}
```

The challenger's changes:

```json
{
 "eventLambdaAuto": 0.4,
 "eventLambdaTeleop": 0.2,
 "eventKappa": 1
}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.29 pts, challenger 0.25 pts. Regressions beyond noise: eventSize: large.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | +0.67 [−0.47, +1.82] | +2.16 [−0.65, +4.88] | +0.05 [−0.07, +0.17] |
| Match type: playoff | 2,969 | −0.06 [−0.98, +0.86] | −0.30 [−2.70, +2.03] | −0.20 [−0.40, −0.03] |
| Match type: qual | 25,106 | +0.76 [−0.59, +2.02] | +2.45 [−0.83, +5.52] | +0.08 [−0.05, +0.21] |
| Event phase: qualification match number: playoff | 2,969 | −0.06 [−0.98, +0.86] | −0.30 [−2.70, +2.03] | −0.20 [−0.40, −0.03] |
| Event phase: qualification match number: q1-10 | 10,431 | +0.93 [−1.54, +3.29] | +2.59 [−3.25, +8.05] | +0.16 [−0.04, +0.39] |
| Event phase: qualification match number: q11-25 | 10,412 | +0.75 [−0.97, +2.51] | +2.38 [−1.86, +6.94] | −0.01 [−0.19, +0.18] |
| Event phase: qualification match number: q26+ | 4,263 | +0.38 [−1.25, +1.98] | +2.28 [−2.07, +6.62] | +0.07 [−0.21, +0.37] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | +0.42 [−1.26, +2.17] | +1.81 [−2.43, +6.18] | +0.24 [+0.08, +0.42] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | +1.25 [−1.06, +3.61] | +3.03 [−2.58, +8.57] | +0.12 [−0.12, +0.36] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | +0.57 [−1.54, +2.62] | +1.97 [−3.53, +7.24] | −0.29 [−0.49, −0.08] |
| Team experience (least experienced robot): rookie | 15,029 | +1.39 [−0.17, +2.90] | +4.01 [+0.18, +7.72] | +0.12 [−0.03, +0.28] |
| Team experience (least experienced robot): veteran | 7,416 | −0.37 [−2.67, +1.98] | −0.78 [−6.19, +4.57] | −0.14 [−0.35, +0.08] |
| Team experience (least experienced robot): year2 | 5,630 | +0.14 [−2.55, +2.87] | +1.09 [−5.54, +8.05] | +0.09 [−0.18, +0.35] |
| Rated matches this season (fewest on the field): 0-5 | 12,833 | +0.80 [−0.85, +2.41] | +2.75 [−1.41, +6.90] | +0.24 [+0.09, +0.41] |
| Rated matches this season (fewest on the field): 16+ | 4,861 | −0.24 [−2.60, +2.27] | +0.64 [−5.60, +7.15] | −0.19 [−0.41, +0.02] |
| Rated matches this season (fewest on the field): 6-15 | 10,381 | +0.94 [−1.14, +2.91] | +2.14 [−2.71, +7.03] | −0.09 [−0.30, +0.13] |
| Data density (all four robots' rated matches): dense | 7,119 | −1.02 [−3.00, +1.12] | −1.42 [−6.53, +3.97] | −0.21 [−0.42, +0.01] |
| Data density (all four robots' rated matches): normal | 11,776 | +1.60 [−0.10, +3.40] | +3.96 [−0.05, +8.18] | +0.07 [−0.11, +0.25] |
| Data density (all four robots' rated matches): thin | 9,180 | +0.80 [−1.18, +2.79] | +2.63 [−2.45, +7.80] | +0.22 [+0.03, +0.42] |
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | +1.31 [−0.64, +3.33] | +4.71 [−0.42, +10.32] | +0.25 [+0.04, +0.46] |
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | +0.02 [−1.58, +1.58] | +0.17 [−3.55, +3.90] | +0.02 [−0.13, +0.19] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | +1.87 [−0.93, +4.80] | +5.05 [−1.98, +12.41] | −0.13 [−0.40, +0.15] |
| Event size (teams): large | 6,510 | +2.94 [+0.37, +5.33] | +8.67 [+2.52, +14.62] | +0.12 [−0.09, +0.36] | **regression**
| Event size (teams): mid | 15,470 | −0.75 [−2.27, +0.76] | −1.72 [−5.49, +1.92] | −0.01 [−0.17, +0.15] |
| Event size (teams): small | 6,095 | +1.88 [−0.35, +4.12] | +5.07 [−0.42, +10.93] | +0.12 [−0.14, +0.36] |
| Event type: championship | 4,378 | +0.85 [−1.80, +3.65] | +5.10 [−2.23, +12.70] | −0.21 [−0.50, +0.12] |
| Event type: league meet | 11,683 | +0.40 [−1.36, +2.23] | +0.55 [−3.50, +4.78] | +0.20 [+0.03, +0.37] |
| Event type: qualifier | 11,417 | +0.70 [−1.16, +2.68] | +2.22 [−2.35, +7.12] | −0.03 [−0.19, +0.14] |
| Event type: world | 597 | +4.19 [−1.79, +10.80] | +11.07 [−2.65, +26.84] | +0.34 [−0.94, +1.34] |
| Favourite's stated chance: 50-60 | 7,282 | −0.28 [−3.22, +2.54] | −0.45 [−6.42, +5.28] | +0.19 [−0.24, +0.62] |
| Favourite's stated chance: 60-70 | 5,890 | +1.28 [−1.68, +4.42] | +2.97 [−3.55, +9.87] | −0.02 [−0.05, +0.00] |
| Favourite's stated chance: 70-80 | 5,260 | +1.44 [−1.05, +3.95] | +4.05 [−2.56, +10.98] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 4,919 | +1.40 [−0.43, +3.29] | +5.60 [−1.26, +12.75] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 4,724 | −0.23 [−0.63, +0.19] | −0.52 [−3.93, +3.18] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,222 | 54.3% | 54.6% | 0.3% | 0.4% |
| 60-70% | 5,790 | 64.8% | 64.5% | 0.3% | 0.5% |
| 70-80% | 5,260 | 74.9% | 75.0% | 0.1% | 0.0% |
| 80-90% | 5,006 | 84.9% | 85.5% | 0.6% | 0.5% |
| 90-100% | 4,797 | 95.0% | 94.6% | 0.4% | 0.4% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 0.78 pts, challenger 0.61 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | −1.47 [−2.54, −0.44] | −4.16 [−6.91, −1.47] | +0.03 [−0.06, +0.12] | better
| Match type: playoff | 4,386 | −0.84 [−1.73, −0.01] | −2.23 [−4.46, −0.09] | +0.05 [−0.07, +0.18] | better
| Match type: qual | 28,885 | −1.57 [−2.74, −0.39] | −4.46 [−7.57, −1.31] | +0.02 [−0.08, +0.13] | better
| Event phase: qualification match number: playoff | 4,386 | −0.84 [−1.73, −0.01] | −2.23 [−4.46, −0.09] | +0.05 [−0.07, +0.18] | better
| Event phase: qualification match number: q1-10 | 10,927 | −1.73 [−3.82, +0.49] | −4.42 [−10.19, +1.52] | +0.09 [−0.09, +0.27] |
| Event phase: qualification match number: q11-25 | 11,671 | −1.67 [−3.56, +0.22] | −5.29 [−10.58, −0.18] | +0.05 [−0.11, +0.22] |
| Event phase: qualification match number: q26+ | 6,287 | −1.12 [−2.42, +0.17] | −2.97 [−6.47, +0.44] | −0.14 [−0.31, +0.03] |
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | −2.43 [−3.88, −0.96] | −6.22 [−9.91, −2.37] | +0.07 [−0.07, +0.22] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | +0.60 [−1.48, +2.62] | +2.19 [−3.32, +7.82] | +0.04 [−0.15, +0.21] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | −1.77 [−3.62, −0.04] | −6.15 [−11.23, −1.27] | −0.04 [−0.19, +0.11] | better
| Team experience (least experienced robot): rookie | 16,718 | −1.39 [−2.80, +0.04] | −3.71 [−7.54, +0.04] | −0.01 [−0.14, +0.12] |
| Team experience (least experienced robot): veteran | 8,250 | −0.60 [−2.40, +1.44] | −3.36 [−8.21, +1.89] | −0.09 [−0.27, +0.09] |
| Team experience (least experienced robot): year2 | 8,303 | −2.52 [−4.54, −0.48] | −5.87 [−11.26, −0.64] | +0.22 [+0.04, +0.41] | better
| Rated matches this season (fewest on the field): 0-5 | 14,202 | −2.44 [−3.95, −0.93] | −6.12 [−10.03, −2.15] | +0.04 [−0.11, +0.19] | better
| Rated matches this season (fewest on the field): 16+ | 6,847 | −1.77 [−3.81, +0.15] | −5.59 [−11.16, −0.44] | −0.06 [−0.22, +0.10] |
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −0.19 [−1.90, +1.55] | −1.09 [−5.70, +3.76] | +0.07 [−0.08, +0.21] |
| Data density (all four robots' rated matches): dense | 10,110 | −1.38 [−3.25, +0.44] | −4.12 [−9.33, +0.93] | −0.02 [−0.16, +0.12] |
| Data density (all four robots' rated matches): normal | 13,190 | −0.77 [−2.25, +0.79] | −3.12 [−7.25, +1.15] | +0.08 [−0.05, +0.22] |
| Data density (all four robots' rated matches): thin | 9,971 | −2.51 [−4.43, −0.56] | −5.58 [−10.32, −0.44] | +0.00 [−0.20, +0.19] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | −1.68 [−3.65, +0.40] | −3.30 [−8.47, +2.01] | +0.01 [−0.20, +0.23] |
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | −0.47 [−1.71, +0.89] | −1.77 [−5.09, +1.69] | +0.03 [−0.09, +0.14] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | −4.26 [−6.93, −1.72] | −12.35 [−20.09, −5.56] | +0.05 [−0.14, +0.25] | better
| Event size (teams): large | 8,980 | −2.32 [−4.28, −0.45] | −6.11 [−11.36, −1.05] | +0.13 [−0.03, +0.30] | better
| Event size (teams): mid | 18,322 | −0.69 [−1.97, +0.58] | −2.29 [−5.77, +1.22] | +0.00 [−0.13, +0.12] |
| Event size (teams): small | 5,969 | −2.62 [−5.14, −0.22] | −7.00 [−13.50, −0.79] | −0.05 [−0.27, +0.14] | better
| Event type: championship | 6,344 | −1.65 [−3.93, +0.60] | −3.74 [−9.70, +2.56] | +0.00 [−0.19, +0.20] |
| Event type: league meet | 12,322 | −1.38 [−3.00, +0.30] | −3.90 [−8.15, +0.43] | +0.10 [−0.06, +0.25] |
| Event type: qualifier | 13,903 | −1.15 [−2.77, +0.44] | −3.82 [−8.04, +0.47] | −0.04 [−0.18, +0.11] |
| Event type: world | 702 | −7.84 [−12.95, −2.17] | −19.44 [−35.50, −2.34] | +0.29 [+0.00, +0.85] | better
| Favourite's stated chance: 50-60 | 6,490 | −3.63 [−6.72, −0.62] | −7.24 [−13.48, −1.10] | +0.14 [−0.32, +0.58] | better
| Favourite's stated chance: 60-70 | 6,108 | −1.61 [−4.65, +1.58] | −3.63 [−10.50, +3.44] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 6,028 | −0.07 [−2.35, +2.46] | −0.36 [−6.54, +6.43] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,238 | −2.07 [−3.58, −0.41] | −7.97 [−13.90, −1.46] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 90-100 | 8,407 | −0.28 [−0.82, +0.23] | −2.08 [−6.28, +2.13] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,448 | 54.9% | 54.7% | 0.2% | 0.3% |
| 60-70% | 6,065 | 65.1% | 65.5% | 0.5% | 0.5% |
| 70-80% | 5,962 | 74.9% | 76.1% | 1.2% | 1.1% |
| 80-90% | 6,291 | 85.1% | 84.0% | 1.2% | 1.0% |
| 90-100% | 8,505 | 95.5% | 94.8% | 0.7% | 0.2% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 0.95 pts, challenger 0.77 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | −1.79 [−2.70, −0.90] | −4.98 [−7.18, −2.76] | −0.02 [−0.11, +0.07] | better
| Match type: playoff | 5,117 | −0.41 [−1.22, +0.41] | −1.25 [−3.27, +0.82] | −0.04 [−0.18, +0.08] |
| Match type: qual | 31,725 | −2.01 [−3.07, −0.99] | −5.58 [−8.18, −3.11] | −0.02 [−0.11, +0.09] | better
| Event phase: qualification match number: playoff | 5,117 | −0.41 [−1.22, +0.41] | −1.25 [−3.27, +0.82] | −0.04 [−0.18, +0.08] |
| Event phase: qualification match number: q1-10 | 11,613 | −3.06 [−5.05, −1.05] | −7.99 [−12.85, −3.11] | −0.07 [−0.25, +0.10] | better
| Event phase: qualification match number: q11-25 | 12,697 | −2.08 [−3.83, −0.32] | −5.97 [−10.36, −1.63] | +0.05 [−0.12, +0.22] | better
| Event phase: qualification match number: q26+ | 7,415 | −0.26 [−1.44, +0.94] | −1.14 [−3.97, +1.77] | −0.04 [−0.23, +0.15] |
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | −2.85 [−4.25, −1.46] | −7.38 [−10.77, −4.04] | +0.10 [−0.04, +0.24] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | −0.61 [−2.52, +1.29] | −1.95 [−6.83, +2.85] | −0.08 [−0.26, +0.11] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | −1.30 [−2.75, +0.10] | −4.11 [−7.69, −0.67] | −0.13 [−0.29, +0.02] |
| Team experience (least experienced robot): rookie | 17,177 | −2.46 [−3.82, −0.96] | −6.22 [−9.61, −2.72] | +0.04 [−0.08, +0.17] | better
| Team experience (least experienced robot): veteran | 10,384 | −1.30 [−3.11, +0.42] | −4.24 [−8.47, −0.04] | +0.01 [−0.16, +0.18] |
| Team experience (least experienced robot): year2 | 9,281 | −1.10 [−2.86, +0.69] | −3.51 [−8.00, +0.97] | −0.15 [−0.32, +0.02] |
| Rated matches this season (fewest on the field): 0-5 | 15,389 | −2.99 [−4.54, −1.40] | −7.63 [−11.29, −3.79] | +0.10 [−0.04, +0.24] | better
| Rated matches this season (fewest on the field): 16+ | 8,268 | −0.65 [−2.42, +1.05] | −2.01 [−6.39, +2.19] | −0.02 [−0.19, +0.14] |
| Rated matches this season (fewest on the field): 6-15 | 13,185 | −1.11 [−2.70, +0.39] | −3.75 [−7.71, +0.11] | −0.16 [−0.31, −0.01] |
| Data density (all four robots' rated matches): dense | 11,835 | −1.60 [−2.92, −0.18] | −4.39 [−7.73, −0.93] | −0.10 [−0.25, +0.04] | better
| Data density (all four robots' rated matches): normal | 14,138 | −1.08 [−2.48, +0.37] | −3.74 [−7.20, −0.02] | −0.06 [−0.20, +0.07] |
| Data density (all four robots' rated matches): thin | 10,869 | −2.92 [−4.88, −0.89] | −7.23 [−11.89, −2.33] | +0.13 [−0.04, +0.30] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | −3.00 [−5.18, −0.80] | −7.97 [−13.18, −2.86] | +0.16 [−0.05, +0.39] | better
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | −0.90 [−1.98, +0.22] | −2.59 [−5.36, +0.27] | −0.05 [−0.16, +0.07] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | −3.13 [−5.49, −0.86] | −8.84 [−14.64, −3.05] | −0.14 [−0.34, +0.06] | better
| Event size (teams): large | 10,439 | −0.66 [−2.27, +0.92] | −2.36 [−6.28, +1.55] | −0.10 [−0.25, +0.06] |
| Event size (teams): mid | 20,568 | −2.16 [−3.47, −0.93] | −5.88 [−9.19, −2.80] | +0.08 [−0.03, +0.20] | better
| Event size (teams): small | 5,835 | −2.50 [−4.70, −0.41] | −6.52 [−11.77, −1.60] | −0.24 [−0.47, +0.00] | better
| Event type: championship | 7,650 | −1.97 [−3.90, −0.07] | −5.62 [−10.21, −0.99] | +0.00 [−0.20, +0.21] | better
| Event type: league meet | 12,338 | −1.09 [−2.64, +0.48] | −3.54 [−7.58, +0.43] | −0.02 [−0.19, +0.14] |
| Event type: qualifier | 15,911 | −2.27 [−3.80, −0.82] | −5.88 [−9.53, −2.20] | −0.01 [−0.14, +0.11] | better
| Event type: world | 943 | −1.50 [−5.70, +1.58] | −3.46 [−11.46, +2.81] | −0.21 [−0.56, +0.21] |
| Favourite's stated chance: 50-60 | 8,139 | −1.89 [−4.60, +0.67] | −3.86 [−9.33, +1.37] | −0.09 [−0.51, +0.32] |
| Favourite's stated chance: 60-70 | 7,819 | −3.21 [−5.67, −0.62] | −7.13 [−12.49, −1.40] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 70-80 | 7,215 | −0.71 [−2.73, +1.26] | −2.22 [−7.65, +3.13] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 7,002 | −2.74 [−4.07, −1.45] | −10.31 [−15.42, −5.46] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 90-100 | 6,667 | −0.17 [−0.59, +0.25] | −1.22 [−4.25, +1.80] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,077 | 55.0% | 55.8% | 0.8% | 0.8% |
| 60-70% | 7,750 | 65.0% | 65.2% | 0.3% | 0.2% |
| 70-80% | 7,233 | 74.9% | 76.1% | 1.2% | 1.1% |
| 80-90% | 7,023 | 85.0% | 85.8% | 0.8% | 0.8% |
| 90-100% | 6,759 | 94.9% | 94.6% | 0.3% | 0.4% |
