# Gate: 2.11.0-overlap vs engine 2.10.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts --challenger`. Both use the contextual model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23`. The champion's rating settings are the shipped ones:

```json
{}
```

The challenger's changes:

```json
{
 "overlapAuto": 0.25,
 "overlapTeleop": 0.15
}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.14 pts, challenger 0.54 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | −1.38 [−2.54, −0.21] | −3.20 [−6.22, −0.23] | −0.02 [−0.15, +0.10] | better
| Match type: playoff | 2,969 | −0.59 [−3.14, +1.94] | −0.97 [−7.11, +5.36] | −0.20 [−0.50, +0.07] |
| Match type: qual | 25,106 | −1.47 [−2.82, −0.20] | −3.46 [−6.79, −0.07] | +0.00 [−0.13, +0.14] | better
| Event phase: qualification match number: playoff | 2,969 | −0.59 [−3.14, +1.94] | −0.97 [−7.11, +5.36] | −0.20 [−0.50, +0.07] |
| Event phase: qualification match number: q1-10 | 10,431 | −1.07 [−2.70, +0.69] | −3.75 [−7.68, +0.43] | −0.18 [−0.39, +0.04] |
| Event phase: qualification match number: q11-25 | 10,412 | −1.92 [−3.97, +0.12] | −3.31 [−8.73, +1.93] | +0.23 [+0.04, +0.44] |
| Event phase: qualification match number: q26+ | 4,263 | −1.34 [−5.22, +2.37] | −3.13 [−13.40, +6.40] | −0.09 [−0.47, +0.26] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | −2.64 [−4.11, −1.13] | −6.34 [−10.03, −2.60] | −0.06 [−0.23, +0.11] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | −2.38 [−5.18, +0.36] | −4.93 [−11.76, +1.69] | +0.00 [−0.26, +0.26] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | +1.22 [−0.95, +3.55] | +2.66 [−2.85, +8.51] | +0.02 [−0.22, +0.26] |
| Team experience (least experienced robot): rookie | 15,029 | −1.84 [−3.30, −0.30] | −4.07 [−7.81, −0.25] | −0.09 [−0.26, +0.10] | better
| Team experience (least experienced robot): veteran | 7,416 | −0.67 [−3.17, +1.67] | −0.94 [−7.08, +4.91] | +0.19 [−0.04, +0.43] |
| Team experience (least experienced robot): year2 | 5,630 | −1.07 [−3.63, +1.59] | −3.84 [−10.32, +2.81] | −0.11 [−0.38, +0.17] |
| Rated matches this season (fewest on the field): 0-5 | 12,833 | −2.78 [−4.22, −1.27] | −6.59 [−10.32, −2.76] | −0.02 [−0.19, +0.15] | better
| Rated matches this season (fewest on the field): 16+ | 4,861 | +0.38 [−2.93, +3.62] | +1.08 [−7.30, +9.55] | +0.10 [−0.19, +0.41] |
| Rated matches this season (fewest on the field): 6-15 | 10,381 | −0.46 [−2.62, +1.64] | −1.02 [−6.51, +4.38] | −0.08 [−0.29, +0.13] |
| Data density (all four robots' rated matches): dense | 7,119 | +0.62 [−2.26, +3.50] | +1.60 [−5.80, +8.96] | +0.16 [−0.12, +0.43] |
| Data density (all four robots' rated matches): normal | 11,776 | −1.58 [−3.39, +0.16] | −4.27 [−8.93, +0.22] | −0.22 [−0.42, −0.04] |
| Data density (all four robots' rated matches): thin | 9,180 | −2.67 [−4.51, −0.84] | −5.55 [−9.88, −1.08] | +0.11 [−0.11, +0.32] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | −1.64 [−3.73, +0.41] | −3.20 [−8.20, +1.58] | +0.06 [−0.15, +0.28] |
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | −0.99 [−2.63, +0.61] | −2.58 [−7.03, +1.73] | −0.06 [−0.23, +0.11] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | −2.21 [−4.74, +0.48] | −5.06 [−11.62, +2.09] | +0.00 [−0.29, +0.28] |
| Event size (teams): large | 6,510 | −2.57 [−5.62, +0.38] | −5.84 [−13.54, +1.82] | −0.08 [−0.31, +0.16] |
| Event size (teams): mid | 15,470 | −0.47 [−1.95, +1.13] | −0.38 [−3.94, +3.56] | +0.03 [−0.16, +0.20] |
| Event size (teams): small | 6,095 | −2.42 [−4.77, −0.17] | −7.54 [−13.64, −1.71] | −0.07 [−0.33, +0.23] | better
| Event type: championship | 4,378 | −0.81 [−3.95, +2.48] | −2.52 [−10.92, +6.06] | +0.16 [−0.16, +0.48] |
| Event type: league meet | 11,683 | −1.37 [−3.07, +0.27] | −3.36 [−7.56, +0.62] | −0.12 [−0.31, +0.06] |
| Event type: qualifier | 11,417 | −1.35 [−3.09, +0.46] | −3.17 [−7.75, +1.21] | +0.01 [−0.18, +0.19] |
| Event type: world | 597 | −6.19 [−24.84, +10.42] | −5.64 [−56.48, +37.93] | +0.17 [+0.00, +0.50] |
| Favourite's stated chance: 50-60 | 7,210 | −3.70 [−6.71, −0.70] | −7.48 [−13.60, −1.38] | −0.07 [−0.58, +0.40] | better
| Favourite's stated chance: 60-70 | 5,778 | −0.64 [−3.96, +2.42] | −1.52 [−8.90, +5.15] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 5,261 | −0.67 [−3.47, +2.12] | −1.51 [−8.79, +5.84] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 5,006 | −0.55 [−2.43, +1.27] | −1.99 [−8.82, +4.93] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 4,820 | −0.43 [−1.27, +0.35] | −1.91 [−8.37, +4.37] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,295 | 54.3% | 54.7% | 0.4% | 0.3% |
| 60-70% | 5,815 | 64.9% | 64.2% | 0.7% | 0.8% |
| 70-80% | 5,260 | 74.9% | 75.5% | 0.6% | 0.5% |
| 80-90% | 4,944 | 84.9% | 85.5% | 0.7% | 0.5% |
| 90-100% | 4,761 | 95.0% | 94.7% | 0.2% | 0.3% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 0.63 pts, challenger 0.61 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | −2.06 [−3.54, −0.64] | −5.48 [−9.20, −1.76] | −0.00 [−0.12, +0.12] | better
| Match type: playoff | 4,386 | +0.84 [−1.86, +3.56] | +2.91 [−3.87, +10.18] | −0.02 [−0.29, +0.24] |
| Match type: qual | 28,885 | −2.50 [−3.94, −1.01] | −6.75 [−10.67, −2.78] | +0.00 [−0.14, +0.14] | better
| Event phase: qualification match number: playoff | 4,386 | +0.84 [−1.86, +3.56] | +2.91 [−3.87, +10.18] | −0.02 [−0.29, +0.24] |
| Event phase: qualification match number: q1-10 | 10,927 | −3.57 [−5.81, −1.20] | −10.02 [−15.75, −3.62] | +0.05 [−0.17, +0.27] | better
| Event phase: qualification match number: q11-25 | 11,671 | −2.34 [−4.71, +0.10] | −4.76 [−11.28, +1.76] | −0.07 [−0.28, +0.14] |
| Event phase: qualification match number: q26+ | 6,287 | −0.93 [−4.98, +3.21] | −4.77 [−15.53, +6.45] | +0.05 [−0.23, +0.32] |
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | −4.36 [−6.31, −2.38] | −10.67 [−15.61, −5.64] | +0.10 [−0.10, +0.31] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | −1.79 [−4.33, +0.62] | −5.82 [−12.61, +0.66] | −0.05 [−0.27, +0.18] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | +0.68 [−1.81, +3.31] | +1.40 [−5.48, +9.07] | −0.10 [−0.32, +0.11] |
| Team experience (least experienced robot): rookie | 16,718 | −2.20 [−3.96, −0.41] | −5.50 [−10.35, −1.02] | +0.07 [−0.11, +0.25] | better
| Team experience (least experienced robot): veteran | 8,250 | −1.84 [−4.93, +1.17] | −3.52 [−11.69, +4.24] | −0.06 [−0.28, +0.16] |
| Team experience (least experienced robot): year2 | 8,303 | −1.99 [−4.78, +0.90] | −7.37 [−14.70, +0.24] | −0.10 [−0.34, +0.14] |
| Rated matches this season (fewest on the field): 0-5 | 14,202 | −3.82 [−5.75, −1.90] | −9.45 [−14.28, −4.40] | +0.09 [−0.12, +0.31] | better
| Rated matches this season (fewest on the field): 16+ | 6,847 | +2.47 [−0.96, +5.79] | +5.54 [−3.74, +14.92] | −0.13 [−0.41, +0.16] |
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −2.55 [−4.78, −0.31] | −7.03 [−13.25, −0.64] | −0.04 [−0.21, +0.14] | better
| Data density (all four robots' rated matches): dense | 10,110 | +1.03 [−1.81, +4.11] | +1.12 [−6.35, +9.72] | −0.12 [−0.33, +0.09] |
| Data density (all four robots' rated matches): normal | 13,190 | −1.67 [−3.62, +0.32] | −4.02 [−9.22, +1.23] | +0.01 [−0.15, +0.18] |
| Data density (all four robots' rated matches): thin | 9,971 | −5.70 [−7.86, −3.47] | −14.10 [−19.48, −8.60] | +0.10 [−0.15, +0.36] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | −6.20 [−8.72, −3.54] | −15.36 [−21.93, −8.93] | +0.12 [−0.17, +0.40] | better
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | −1.29 [−3.08, +0.57] | −4.25 [−8.92, +0.81] | −0.05 [−0.21, +0.11] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | +0.39 [−3.15, +4.31] | +2.18 [−7.53, +13.30] | −0.02 [−0.28, +0.23] |
| Event size (teams): large | 8,980 | −1.20 [−4.41, +2.10] | −4.29 [−12.42, +4.09] | −0.06 [−0.28, +0.14] |
| Event size (teams): mid | 18,322 | −2.55 [−4.18, −0.91] | −6.58 [−11.01, −2.24] | +0.01 [−0.17, +0.17] | better
| Event size (teams): small | 5,969 | −1.84 [−4.87, +1.25] | −3.88 [−11.65, +3.84] | +0.05 [−0.26, +0.36] |
| Event type: championship | 6,344 | +0.47 [−3.33, +4.04] | +0.14 [−10.51, +10.40] | −0.21 [−0.47, +0.08] |
| Event type: league meet | 12,322 | −2.21 [−4.14, −0.23] | −5.66 [−11.08, −0.28] | −0.03 [−0.23, +0.17] | better
| Event type: qualifier | 13,903 | −3.01 [−5.01, −0.92] | −7.26 [−12.61, −2.06] | +0.10 [−0.08, +0.29] | better
| Event type: world | 702 | −3.36 [−18.35, +12.75] | −17.79 [−58.76, +24.26] | +0.29 [−0.38, +0.95] |
| Favourite's stated chance: 50-60 | 6,438 | −3.15 [−7.33, +0.96] | −6.39 [−14.85, +1.95] | −0.02 [−0.64, +0.63] |
| Favourite's stated chance: 60-70 | 6,053 | −5.32 [−9.37, −1.02] | −11.80 [−20.82, −2.41] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 70-80 | 5,960 | −0.61 [−4.07, +2.82] | −1.38 [−10.61, +7.70] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,262 | −1.25 [−3.53, +1.15] | −4.49 [−13.35, +4.83] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 8,558 | −0.53 [−1.18, +0.11] | −3.89 [−9.46, +1.42] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,442 | 54.9% | 54.9% | 0.0% | 0.1% |
| 60-70% | 6,138 | 65.0% | 65.4% | 0.4% | 0.4% |
| 70-80% | 6,005 | 75.0% | 76.4% | 1.5% | 1.4% |
| 80-90% | 6,243 | 85.1% | 84.1% | 1.0% | 0.9% |
| 90-100% | 8,443 | 95.5% | 94.9% | 0.7% | 0.1% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 0.81 pts, challenger 0.90 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | −2.41 [−3.68, −1.14] | −5.59 [−8.86, −2.29] | −0.01 [−0.14, +0.12] | better
| Match type: playoff | 5,117 | −3.58 [−6.24, −1.06] | −8.54 [−15.33, −2.15] | −0.30 [−0.58, −0.02] | better
| Match type: qual | 31,725 | −2.23 [−3.70, −0.77] | −5.11 [−8.76, −1.25] | +0.03 [−0.11, +0.16] | better
| Event phase: qualification match number: playoff | 5,117 | −3.58 [−6.24, −1.06] | −8.54 [−15.33, −2.15] | −0.30 [−0.58, −0.02] | better
| Event phase: qualification match number: q1-10 | 11,613 | −3.83 [−5.95, −1.68] | −9.42 [−14.70, −4.00] | −0.04 [−0.29, +0.19] | better
| Event phase: qualification match number: q11-25 | 12,697 | −1.29 [−3.59, +1.07] | −1.49 [−7.32, +4.28] | +0.14 [−0.06, +0.35] |
| Event phase: qualification match number: q26+ | 7,415 | −1.32 [−4.76, +2.04] | −4.57 [−13.54, +3.98] | −0.04 [−0.37, +0.27] |
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | −1.39 [−3.35, +0.57] | −2.77 [−7.33, +2.14] | +0.06 [−0.12, +0.24] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | −2.39 [−5.07, +0.39] | −4.49 [−11.34, +2.72] | −0.05 [−0.30, +0.24] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | −3.71 [−5.99, −1.57] | −9.87 [−15.53, −3.99] | −0.08 [−0.30, +0.14] | better
| Team experience (least experienced robot): rookie | 17,177 | −2.48 [−4.33, −0.55] | −5.95 [−10.68, −0.99] | −0.11 [−0.29, +0.07] | better
| Team experience (least experienced robot): veteran | 10,384 | −2.40 [−4.84, +0.22] | −4.63 [−11.04, +1.85] | +0.04 [−0.20, +0.28] |
| Team experience (least experienced robot): year2 | 9,281 | −2.32 [−5.01, +0.36] | −5.99 [−12.84, +0.75] | +0.11 [−0.15, +0.36] |
| Rated matches this season (fewest on the field): 0-5 | 15,389 | −2.05 [−4.06, −0.09] | −4.14 [−8.96, +0.79] | +0.06 [−0.11, +0.23] | better
| Rated matches this season (fewest on the field): 16+ | 8,268 | −4.42 [−7.11, −1.92] | −12.10 [−18.88, −5.34] | −0.21 [−0.49, +0.09] | better
| Rated matches this season (fewest on the field): 6-15 | 13,185 | −1.58 [−3.95, +0.75] | −3.20 [−9.17, +2.70] | +0.02 [−0.19, +0.25] |
| Data density (all four robots' rated matches): dense | 11,835 | −2.98 [−5.42, −0.64] | −8.21 [−14.67, −2.02] | −0.16 [−0.40, +0.07] | better
| Data density (all four robots' rated matches): normal | 14,138 | −1.57 [−3.54, +0.47] | −2.00 [−7.10, +3.33] | +0.04 [−0.15, +0.24] |
| Data density (all four robots' rated matches): thin | 10,869 | −2.89 [−5.15, −0.72] | −7.40 [−12.94, −2.25] | +0.07 [−0.14, +0.29] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | −3.01 [−5.81, −0.39] | −7.28 [−14.03, −1.11] | +0.09 [−0.17, +0.34] | better
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | −1.81 [−3.49, −0.23] | −3.22 [−7.54, +0.91] | −0.06 [−0.23, +0.10] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | −3.56 [−7.05, −0.32] | −10.83 [−19.60, −2.53] | +0.01 [−0.25, +0.31] | better
| Event size (teams): large | 10,439 | −1.37 [−4.22, +1.23] | −2.35 [−9.57, +4.45] | +0.05 [−0.19, +0.28] |
| Event size (teams): mid | 20,568 | −3.02 [−4.76, −1.29] | −7.45 [−11.88, −3.09] | −0.06 [−0.23, +0.11] | better
| Event size (teams): small | 5,835 | −2.13 [−5.18, +0.78] | −4.81 [−12.29, +2.48] | +0.05 [−0.23, +0.34] |
| Event type: championship | 7,650 | −2.90 [−6.04, +0.06] | −7.95 [−16.31, −0.26] | −0.17 [−0.48, +0.15] |
| Event type: league meet | 12,338 | −3.29 [−5.36, −1.24] | −7.30 [−12.83, −2.27] | +0.10 [−0.11, +0.30] | better
| Event type: qualifier | 15,911 | −1.86 [−3.76, −0.01] | −3.72 [−8.17, +1.08] | −0.03 [−0.21, +0.17] | better
| Event type: world | 943 | +3.67 [−2.05, +11.51] | +4.36 [−9.36, +18.88] | +0.11 [−0.60, +0.74] |
| Favourite's stated chance: 50-60 | 8,103 | −4.71 [−8.58, −1.09] | −9.57 [−17.41, −2.28] | −0.06 [−0.60, +0.50] | better
| Favourite's stated chance: 60-70 | 7,767 | −5.44 [−8.90, −1.92] | −11.65 [−19.24, −4.02] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 70-80 | 7,267 | −0.80 [−3.71, +2.05] | −1.94 [−9.56, +5.60] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,955 | −0.16 [−2.27, +1.89] | −0.28 [−8.09, +7.50] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 6,750 | −0.25 [−0.98, +0.50] | −3.23 [−9.31, +2.91] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,125 | 54.9% | 55.5% | 0.5% | 0.5% |
| 60-70% | 7,879 | 64.9% | 65.6% | 0.7% | 0.6% |
| 70-80% | 7,240 | 75.0% | 76.5% | 1.5% | 1.5% |
| 80-90% | 6,945 | 85.0% | 86.0% | 1.0% | 1.0% |
| 90-100% | 6,653 | 94.9% | 94.6% | 0.2% | 0.4% |
