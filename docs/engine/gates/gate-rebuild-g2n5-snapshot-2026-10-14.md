# Gate: rebuild-g2n5 vs engine 3.2.0 on snapshot-2026-10-14

Generated 2026-10-27 by `scripts/engine-slices.ts --challenger`. The challenger uses the contextual model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23` (with its final recalibration, slope 1.057692). The champion uses the same model, and the shipped rating settings:

```json
{}
```

The challenger's changes:

```json
{
 "rebuildGapWeeks": 2,
 "rebuildN": 5,
 "rebuildUncPerWeek": 0
}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.54 pts, challenger 0.46 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | +0.21 [−0.79, +1.23] | +0.61 [−2.11, +3.24] | +0.05 [−0.03, +0.14] |
| Match type: playoff | 2,969 | +0.40 [−2.14, +2.82] | −0.71 [−6.92, +5.19] | +0.10 [−0.10, +0.34] |
| Match type: qual | 25,106 | +0.19 [−0.87, +1.29] | +0.77 [−2.13, +3.56] | +0.05 [−0.05, +0.15] |
| Event phase: qualification match number: playoff | 2,969 | +0.40 [−2.14, +2.82] | −0.71 [−6.92, +5.19] | +0.10 [−0.10, +0.34] |
| Event phase: qualification match number: q1-10 | 10,431 | +0.75 [−0.46, +2.02] | +0.84 [−2.09, +4.01] | +0.06 [−0.07, +0.18] |
| Event phase: qualification match number: q11-25 | 10,412 | −0.94 [−2.94, +1.08] | −1.38 [−6.55, +3.71] | +0.09 [−0.08, +0.25] |
| Event phase: qualification match number: q26+ | 4,263 | +1.57 [−1.79, +5.20] | +5.85 [−3.52, +15.74] | −0.07 [−0.32, +0.19] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | −0.16 [−1.00, +0.67] | −0.14 [−2.24, +1.92] | +0.02 [−0.05, +0.10] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | +0.13 [−1.86, +1.93] | +0.14 [−5.04, +5.01] | +0.15 [−0.06, +0.36] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | +0.80 [−1.95, +3.75] | +2.06 [−5.15, +9.59] | +0.02 [−0.19, +0.24] |
| Team experience (least experienced robot): rookie | 15,029 | +1.12 [−0.33, +2.47] | +2.42 [−1.02, +5.83] | +0.05 [−0.07, +0.17] |
| Team experience (least experienced robot): veteran | 7,416 | −1.35 [−3.54, +0.69] | −3.65 [−9.08, +1.50] | +0.11 [−0.07, +0.31] |
| Team experience (least experienced robot): year2 | 5,630 | −0.16 [−2.56, +2.16] | +1.39 [−4.86, +7.49] | −0.02 [−0.21, +0.17] |
| Rated matches this season (fewest on the field): 0-5 | 12,833 | −0.21 [−1.12, +0.66] | −0.30 [−2.65, +1.96] | +0.01 [−0.08, +0.09] |
| Rated matches this season (fewest on the field): 16+ | 4,861 | +1.14 [−2.69, +5.09] | +3.10 [−6.85, +13.31] | −0.06 [−0.34, +0.22] |
| Rated matches this season (fewest on the field): 6-15 | 10,381 | +0.29 [−1.62, +2.24] | +0.58 [−4.33, +5.42] | +0.17 [−0.02, +0.35] |
| Data density (all four robots' rated matches): dense | 7,119 | +0.80 [−2.04, +3.80] | +2.21 [−5.08, +9.92] | −0.06 [−0.30, +0.20] |
| Data density (all four robots' rated matches): normal | 11,776 | +0.06 [−1.72, +1.79] | +0.37 [−4.10, +4.83] | +0.21 [+0.05, +0.37] |
| Data density (all four robots' rated matches): thin | 9,180 | −0.05 [−0.52, +0.41] | −0.32 [−1.50, +0.85] | −0.05 [−0.10, −0.01] |
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | −0.19 [−0.42, −0.00] | −0.49 [−1.05, −0.01] | +0.00 [−0.05, +0.05] | better
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | −0.13 [−1.61, +1.35] | −0.12 [−3.82, +3.68] | +0.12 [−0.01, +0.26] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | +1.71 [−1.81, +5.16] | +4.15 [−4.70, +13.20] | −0.09 [−0.36, +0.18] |
| Event size (teams): large | 6,510 | +0.80 [−1.38, +2.85] | +3.35 [−2.80, +9.27] | +0.11 [−0.10, +0.32] |
| Event size (teams): mid | 15,470 | +0.30 [−1.16, +1.76] | +0.79 [−2.94, +4.61] | +0.08 [−0.04, +0.20] |
| Event size (teams): small | 6,095 | −0.65 [−2.60, +1.43] | −2.76 [−7.49, +2.47] | −0.07 [−0.24, +0.10] |
| Event type: championship | 4,378 | +1.87 [−1.00, +4.75] | +7.02 [−1.47, +15.36] | +0.05 [−0.21, +0.32] |
| Event type: league meet | 11,683 | −1.15 [−2.55, +0.28] | −3.55 [−7.10, −0.16] | +0.17 [+0.06, +0.30] |
| Event type: qualifier | 11,417 | +0.78 [−0.88, +2.50] | +1.60 [−2.49, +5.98] | −0.04 [−0.19, +0.10] |
| Event type: world | 597 | +3.82 [−6.79, +13.19] | +16.06 [−16.55, +44.48] | −0.34 [−0.67, +0.00] |
| Favourite's stated chance: 50-60 | 7,295 | +1.19 [−1.27, +3.67] | +2.42 [−2.56, +7.40] | +0.21 [−0.14, +0.56] |
| Favourite's stated chance: 60-70 | 5,815 | −0.82 [−3.64, +2.04] | −1.85 [−7.96, +4.55] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 5,260 | −0.35 [−2.65, +2.02] | −0.97 [−7.13, +5.33] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 4,944 | +0.86 [−1.00, +2.82] | +2.91 [−4.46, +10.53] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 4,761 | −0.08 [−0.59, +0.44] | +0.21 [−4.25, +4.77] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,272 | 54.3% | 54.6% | 0.3% | 0.4% |
| 60-70% | 5,782 | 64.9% | 64.4% | 0.5% | 0.6% |
| 70-80% | 5,291 | 74.9% | 75.6% | 0.7% | 0.6% |
| 80-90% | 4,948 | 84.9% | 85.4% | 0.5% | 0.4% |
| 90-100% | 4,782 | 95.0% | 94.6% | 0.4% | 0.4% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 0.61 pts, challenger 0.55 pts. Regressions beyond noise: volatility: not measured.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | −1.22 [−2.35, +0.00] | −3.26 [−6.33, −0.04] | +0.03 [−0.06, +0.13] |
| Match type: playoff | 4,386 | −1.02 [−3.49, +1.30] | −3.84 [−9.93, +2.22] | −0.32 [−0.57, −0.07] |
| Match type: qual | 28,885 | −1.25 [−2.64, +0.07] | −3.17 [−6.71, +0.37] | +0.09 [−0.01, +0.19] |
| Event phase: qualification match number: playoff | 4,386 | −1.02 [−3.49, +1.30] | −3.84 [−9.93, +2.22] | −0.32 [−0.57, −0.07] |
| Event phase: qualification match number: q1-10 | 10,927 | −0.83 [−2.54, +0.94] | −1.03 [−5.59, +3.39] | +0.21 [+0.04, +0.39] |
| Event phase: qualification match number: q11-25 | 11,671 | −1.35 [−3.35, +0.63] | −3.86 [−9.16, +1.96] | +0.05 [−0.11, +0.22] |
| Event phase: qualification match number: q26+ | 6,287 | −1.79 [−4.69, +1.21] | −5.60 [−13.41, +2.42] | −0.06 [−0.30, +0.16] |
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | −0.34 [−1.46, +0.78] | −1.51 [−4.46, +1.34] | +0.03 [−0.09, +0.16] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | −1.26 [−3.51, +1.00] | −2.59 [−8.59, +3.58] | +0.05 [−0.12, +0.22] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | −2.31 [−5.03, +0.53] | −5.96 [−12.92, +1.38] | +0.03 [−0.19, +0.24] |
| Team experience (least experienced robot): rookie | 16,718 | −1.34 [−2.91, +0.21] | −4.44 [−8.64, −0.52] | +0.07 [−0.07, +0.20] |
| Team experience (least experienced robot): veteran | 8,250 | −0.39 [−2.68, +1.99] | −1.52 [−7.57, +4.81] | −0.01 [−0.20, +0.21] |
| Team experience (least experienced robot): year2 | 8,303 | −1.80 [−4.29, +0.67] | −2.59 [−9.37, +4.08] | +0.01 [−0.17, +0.21] |
| Rated matches this season (fewest on the field): 0-5 | 14,202 | −0.35 [−1.50, +0.84] | −1.38 [−4.45, +1.65] | +0.02 [−0.10, +0.14] |
| Rated matches this season (fewest on the field): 16+ | 6,847 | −1.96 [−5.40, +1.48] | −4.98 [−13.92, +4.14] | −0.01 [−0.32, +0.28] |
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −1.81 [−3.87, +0.40] | −4.47 [−10.33, +1.50] | +0.07 [−0.08, +0.23] |
| Data density (all four robots' rated matches): dense | 10,110 | −1.79 [−4.67, +1.10] | −3.19 [−10.86, +4.22] | −0.08 [−0.29, +0.15] |
| Data density (all four robots' rated matches): normal | 13,190 | −2.15 [−3.96, −0.36] | −7.11 [−11.94, −2.40] | +0.20 [+0.05, +0.35] | better
| Data density (all four robots' rated matches): thin | 9,971 | +0.59 [−0.23, +1.45] | +1.77 [−0.29, +4.01] | −0.07 [−0.20, +0.06] |
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | +0.85 [+0.04, +1.68] | +1.95 [−0.04, +3.97] | −0.07 [−0.23, +0.09] | **regression**
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | −1.13 [−2.74, +0.59] | −2.48 [−6.65, +1.93] | +0.10 [−0.02, +0.22] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | −3.85 [−7.45, +0.19] | −11.55 [−21.11, −1.47] | −0.05 [−0.33, +0.23] |
| Event size (teams): large | 8,980 | −2.40 [−4.42, −0.21] | −3.47 [−9.29, +2.55] | +0.07 [−0.10, +0.25] | better
| Event size (teams): mid | 18,322 | −0.28 [−2.01, +1.35] | −1.74 [−6.28, +2.43] | −0.08 [−0.21, +0.06] |
| Event size (teams): small | 5,969 | −2.32 [−4.68, −0.21] | −7.57 [−13.78, −1.84] | +0.32 [+0.10, +0.55] | better
| Event type: championship | 6,344 | −1.15 [−4.94, +2.48] | −1.99 [−11.92, +8.16] | −0.22 [−0.47, +0.02] |
| Event type: league meet | 12,322 | −0.93 [−2.42, +0.67] | −2.64 [−6.51, +1.43] | +0.09 [−0.06, +0.25] |
| Event type: qualifier | 13,903 | −1.22 [−2.91, +0.55] | −3.62 [−7.98, +0.89] | +0.10 [−0.05, +0.26] |
| Event type: world | 702 | −6.97 [−11.84, +0.25] | −18.14 [−31.67, +4.13] | +0.00 [−0.42, +0.38] |
| Favourite's stated chance: 50-60 | 6,442 | −3.93 [−7.35, −0.27] | −7.99 [−14.95, −0.53] | +0.17 [−0.34, +0.64] | better
| Favourite's stated chance: 60-70 | 6,138 | −1.23 [−4.55, +2.17] | −2.75 [−10.07, +4.83] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 6,005 | +0.48 [−2.38, +3.18] | +1.03 [−6.42, +8.11] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,243 | −0.88 [−2.75, +1.00] | −2.93 [−10.09, +4.29] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 8,443 | −0.60 [−1.21, +0.03] | −3.30 [−7.85, +1.46] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,435 | 54.9% | 54.9% | 0.0% | 0.1% |
| 60-70% | 6,105 | 65.0% | 65.5% | 0.4% | 0.5% |
| 70-80% | 6,013 | 75.0% | 76.2% | 1.2% | 1.2% |
| 80-90% | 6,212 | 85.2% | 84.1% | 1.0% | 0.9% |
| 90-100% | 8,506 | 95.5% | 94.9% | 0.6% | 0.1% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 0.90 pts, challenger 0.83 pts. Regressions beyond noise: level: playoff; eventMatch: playoff; volatility: not measured; eventType: world; probBand: 90-100.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | −0.27 [−1.31, +0.78] | −0.99 [−3.54, +1.67] | +0.02 [−0.07, +0.11] |
| Match type: playoff | 5,117 | +2.53 [+0.55, +4.70] | +5.44 [+0.47, +10.49] | +0.02 [−0.16, +0.22] | **regression**
| Match type: qual | 31,725 | −0.72 [−1.85, +0.43] | −2.03 [−4.98, +0.85] | +0.02 [−0.09, +0.13] |
| Event phase: qualification match number: playoff | 5,117 | +2.53 [+0.55, +4.70] | +5.44 [+0.47, +10.49] | +0.02 [−0.16, +0.22] | **regression**
| Event phase: qualification match number: q1-10 | 11,613 | +0.04 [−1.22, +1.36] | −0.39 [−3.78, +2.91] | +0.07 [−0.09, +0.23] |
| Event phase: qualification match number: q11-25 | 12,697 | −1.87 [−3.72, +0.10] | −5.03 [−9.65, −0.31] | −0.02 [−0.19, +0.14] |
| Event phase: qualification match number: q26+ | 7,415 | +0.07 [−2.88, +2.83] | +0.56 [−6.76, +7.52] | +0.01 [−0.23, +0.24] |
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | −0.05 [−0.85, +0.80] | −0.85 [−2.87, +1.15] | +0.06 [−0.06, +0.18] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | +0.46 [−1.57, +2.32] | +0.16 [−4.97, +5.12] | −0.22 [−0.40, −0.05] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | −1.05 [−3.54, +1.47] | −1.97 [−8.15, +4.23] | +0.14 [−0.05, +0.34] |
| Team experience (least experienced robot): rookie | 17,177 | −0.67 [−2.31, +1.01] | −2.02 [−6.25, +2.08] | +0.01 [−0.14, +0.16] |
| Team experience (least experienced robot): veteran | 10,384 | −0.30 [−2.36, +1.64] | −1.57 [−6.99, +3.60] | +0.14 [−0.03, +0.31] |
| Team experience (least experienced robot): year2 | 9,281 | +0.52 [−1.47, +2.60] | +1.57 [−3.71, +7.20] | −0.09 [−0.26, +0.09] |
| Rated matches this season (fewest on the field): 0-5 | 15,389 | −0.01 [−0.78, +0.83] | −0.48 [−2.46, +1.70] | +0.02 [−0.10, +0.13] |
| Rated matches this season (fewest on the field): 16+ | 8,268 | +0.47 [−2.75, +3.62] | +1.52 [−6.85, +9.02] | +0.16 [−0.09, +0.40] |
| Rated matches this season (fewest on the field): 6-15 | 13,185 | −1.03 [−2.84, +0.69] | −3.16 [−7.63, +1.22] | −0.07 [−0.22, +0.09] |
| Data density (all four robots' rated matches): dense | 11,835 | −0.79 [−3.33, +1.77] | −2.18 [−8.38, +4.12] | +0.10 [−0.10, +0.32] |
| Data density (all four robots' rated matches): normal | 14,138 | −0.53 [−1.99, +0.95] | −1.74 [−5.47, +2.04] | −0.04 [−0.19, +0.12] |
| Data density (all four robots' rated matches): thin | 10,869 | +0.64 [−0.00, +1.28] | +1.29 [−0.31, +2.77] | +0.00 [−0.11, +0.11] |
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | +0.85 [+0.19, +1.49] | +1.90 [+0.38, +3.36] | +0.00 [−0.14, +0.15] | **regression**
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | −0.82 [−2.16, +0.55] | −2.27 [−5.69, +1.15] | +0.06 [−0.07, +0.17] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | +0.15 [−2.88, +3.21] | −0.35 [−8.31, +7.59] | −0.07 [−0.33, +0.19] |
| Event size (teams): large | 10,439 | +0.35 [−1.88, +2.51] | +0.27 [−5.38, +6.01] | −0.14 [−0.34, +0.05] |
| Event size (teams): mid | 20,568 | −0.36 [−1.76, +1.04] | −1.08 [−4.51, +2.33] | +0.09 [−0.03, +0.21] |
| Event size (teams): small | 5,835 | −1.03 [−2.93, +0.76] | −2.93 [−7.73, +1.62] | +0.07 [−0.16, +0.29] |
| Event type: championship | 7,650 | −0.97 [−4.01, +1.90] | −2.34 [−9.97, +5.03] | +0.17 [−0.09, +0.42] |
| Event type: league meet | 12,338 | −0.63 [−2.00, +0.79] | −1.38 [−5.01, +2.31] | +0.01 [−0.13, +0.15] |
| Event type: qualifier | 15,911 | −0.23 [−1.73, +1.29] | −1.74 [−5.13, +1.80] | −0.02 [−0.16, +0.13] |
| Event type: world | 943 | +9.65 [+0.23, +18.26] | +27.84 [+3.27, +49.23] | −0.43 [−0.96, +0.19] | **regression**
| Favourite's stated chance: 50-60 | 8,125 | +1.56 [−1.52, +4.77] | +3.15 [−3.12, +9.62] | +0.09 [−0.34, +0.54] |
| Favourite's stated chance: 60-70 | 7,879 | −0.26 [−2.95, +2.48] | −0.64 [−6.57, +5.43] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 7,240 | −1.76 [−4.12, +0.62] | −5.00 [−11.29, +1.37] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,945 | −1.76 [−3.24, −0.30] | −6.94 [−12.70, −1.37] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 90-100 | 6,653 | +0.68 [+0.16, +1.20] | +4.13 [−0.39, +8.61] | +0.00 [+0.00, +0.00] | **regression**

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,146 | 55.0% | 55.5% | 0.5% | 0.5% |
| 60-70% | 7,808 | 65.0% | 65.6% | 0.6% | 0.6% |
| 70-80% | 7,223 | 75.0% | 76.4% | 1.4% | 1.4% |
| 80-90% | 6,948 | 85.0% | 86.2% | 1.2% | 1.2% |
| 90-100% | 6,717 | 94.9% | 94.5% | 0.3% | 0.5% |
