# Gate: rebuild-g3n3 vs engine 3.2.0 on snapshot-2026-10-14

Generated 2026-10-27 by `scripts/engine-slices.ts --challenger`. The challenger uses the contextual model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23` (with its final recalibration, slope 1.057692). The champion uses the same model, and the shipped rating settings:

```json
{}
```

The challenger's changes:

```json
{
 "rebuildGapWeeks": 3,
 "rebuildN": 3,
 "rebuildUncPerWeek": 0
}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.54 pts, challenger 0.41 pts. Regressions beyond noise: experience: rookie.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | +1.10 [−0.60, +2.78] | +2.80 [−1.79, +7.22] | −0.02 [−0.13, +0.09] |
| Match type: playoff | 2,969 | +1.08 [−3.12, +4.92] | +2.18 [−7.41, +11.56] | −0.07 [−0.38, +0.24] |
| Match type: qual | 25,106 | +1.10 [−0.82, +2.97] | +2.87 [−2.12, +7.76] | −0.01 [−0.14, +0.12] |
| Event phase: qualification match number: playoff | 2,969 | +1.08 [−3.12, +4.92] | +2.18 [−7.41, +11.56] | −0.07 [−0.38, +0.24] |
| Event phase: qualification match number: q1-10 | 10,431 | +1.79 [−0.38, +4.07] | +3.66 [−1.71, +9.33] | +0.04 [−0.14, +0.22] |
| Event phase: qualification match number: q11-25 | 10,412 | +0.14 [−2.91, +3.14] | −0.25 [−8.01, +7.32] | −0.03 [−0.24, +0.17] |
| Event phase: qualification match number: q26+ | 4,263 | +1.77 [−3.69, +7.74] | +8.55 [−7.03, +25.05] | −0.09 [−0.46, +0.28] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | −0.41 [−1.98, +1.15] | −0.67 [−4.60, +3.19] | +0.07 [−0.05, +0.20] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | +3.30 [−0.26, +6.71] | +8.29 [−1.38, +17.47] | +0.00 [−0.27, +0.27] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | +1.50 [−2.61, +6.24] | +3.35 [−7.60, +15.12] | −0.16 [−0.43, +0.11] |
| Team experience (least experienced robot): rookie | 15,029 | +2.36 [+0.17, +4.46] | +4.78 [−1.03, +10.29] | −0.05 [−0.21, +0.11] | **regression**
| Team experience (least experienced robot): veteran | 7,416 | −0.58 [−3.94, +2.76] | −1.70 [−10.06, +6.87] | +0.00 [−0.20, +0.22] |
| Team experience (least experienced robot): year2 | 5,630 | −0.06 [−4.04, +3.77] | +3.42 [−7.23, +14.04] | +0.05 [−0.21, +0.30] |
| Rated matches this season (fewest on the field): 0-5 | 12,833 | −0.41 [−2.08, +1.15] | −0.80 [−5.12, +3.08] | +0.08 [−0.05, +0.21] |
| Rated matches this season (fewest on the field): 16+ | 4,861 | +2.37 [−3.81, +8.30] | +5.76 [−10.76, +22.16] | −0.17 [−0.51, +0.17] |
| Rated matches this season (fewest on the field): 6-15 | 10,381 | +2.37 [−0.91, +5.90] | +5.85 [−2.59, +14.37] | −0.07 [−0.31, +0.18] |
| Data density (all four robots' rated matches): dense | 7,119 | +2.25 [−2.24, +7.03] | +4.98 [−7.03, +18.00] | −0.31 [−0.60, −0.01] |
| Data density (all four robots' rated matches): normal | 11,776 | +1.55 [−1.42, +4.53] | +4.61 [−2.88, +12.12] | +0.15 [−0.05, +0.35] |
| Data density (all four robots' rated matches): thin | 9,180 | −0.37 [−1.23, +0.51] | −1.22 [−3.36, +0.99] | +0.00 [−0.08, +0.08] |
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | −0.36 [−0.75, −0.01] | −0.87 [−1.79, −0.02] | +0.02 [−0.05, +0.08] | better
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | +0.51 [−1.97, +2.92] | +1.24 [−4.68, +7.44] | +0.01 [−0.17, +0.17] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | +4.65 [−1.23, +10.46] | +11.90 [−3.74, +27.25] | −0.13 [−0.48, +0.21] |
| Event size (teams): large | 6,510 | +2.36 [−1.51, +6.11] | +8.42 [−2.24, +19.16] | −0.08 [−0.31, +0.17] |
| Event size (teams): mid | 15,470 | +1.16 [−1.15, +3.50] | +2.19 [−3.68, +7.99] | +0.07 [−0.08, +0.22] |
| Event size (teams): small | 6,095 | −0.40 [−3.95, +3.32] | −1.68 [−10.37, +7.80] | −0.18 [−0.43, +0.08] |
| Event type: championship | 4,378 | +3.31 [−1.22, +7.99] | +11.28 [−1.28, +25.12] | −0.05 [−0.37, +0.29] |
| Event type: league meet | 11,683 | −0.74 [−3.41, +1.86] | −2.94 [−9.33, +3.29] | +0.06 [−0.11, +0.24] |
| Event type: qualifier | 11,417 | +1.63 [−1.06, +4.41] | +3.64 [−2.84, +10.46] | −0.06 [−0.25, +0.11] |
| Event type: world | 597 | +10.78 [−9.89, +28.40] | +36.65 [−21.14, +84.89] | −0.50 [−1.09, +0.00] |
| Favourite's stated chance: 50-60 | 7,295 | +2.39 [−2.00, +6.48] | +4.90 [−4.13, +13.41] | −0.06 [−0.49, +0.39] |
| Favourite's stated chance: 60-70 | 5,815 | +1.05 [−3.45, +5.82] | +2.44 [−7.60, +12.90] | −0.02 [−0.07, +0.04] |
| Favourite's stated chance: 70-80 | 5,260 | +0.00 [−3.54, +3.80] | +0.44 [−9.12, +10.60] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 4,944 | +1.51 [−1.48, +4.59] | +5.03 [−6.62, +17.13] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 4,761 | −0.03 [−0.92, +0.93] | +0.30 [−6.74, +7.84] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,245 | 54.3% | 54.5% | 0.2% | 0.5% |
| 60-70% | 5,796 | 64.8% | 64.3% | 0.6% | 0.7% |
| 70-80% | 5,259 | 74.9% | 75.5% | 0.5% | 0.5% |
| 80-90% | 4,955 | 84.9% | 85.1% | 0.2% | 0.1% |
| 90-100% | 4,820 | 95.0% | 94.7% | 0.3% | 0.3% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 0.61 pts, challenger 0.56 pts. Regressions beyond noise: volatility: not measured.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | −0.61 [−2.50, +1.29] | −2.15 [−7.23, +2.99] | +0.04 [−0.08, +0.16] |
| Match type: playoff | 4,386 | −2.00 [−6.12, +2.17] | −7.26 [−17.86, +3.25] | −0.05 [−0.35, +0.25] |
| Match type: qual | 28,885 | −0.40 [−2.54, +1.55] | −1.38 [−6.94, +4.17] | +0.05 [−0.08, +0.18] |
| Event phase: qualification match number: playoff | 4,386 | −2.00 [−6.12, +2.17] | −7.26 [−17.86, +3.25] | −0.05 [−0.35, +0.25] |
| Event phase: qualification match number: q1-10 | 10,927 | −0.69 [−3.37, +2.04] | −1.13 [−8.14, +5.85] | +0.17 [−0.05, +0.38] |
| Event phase: qualification match number: q11-25 | 11,671 | +0.53 [−2.84, +3.78] | +0.39 [−8.85, +9.84] | +0.02 [−0.18, +0.22] |
| Event phase: qualification match number: q26+ | 6,287 | −1.63 [−6.22, +3.18] | −5.10 [−17.41, +8.06] | −0.08 [−0.37, +0.21] |
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | −0.18 [−2.10, +1.74] | −2.13 [−7.37, +2.58] | +0.04 [−0.12, +0.20] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | −0.59 [−4.54, +3.31] | −0.18 [−10.89, +10.70] | +0.14 [−0.10, +0.38] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | −1.19 [−5.46, +3.20] | −3.61 [−15.10, +8.30] | −0.03 [−0.28, +0.23] |
| Team experience (least experienced robot): rookie | 16,718 | −1.29 [−3.84, +1.38] | −5.01 [−12.15, +1.69] | +0.02 [−0.16, +0.19] |
| Team experience (least experienced robot): veteran | 8,250 | −0.06 [−3.55, +3.69] | −0.23 [−9.78, +9.80] | +0.12 [−0.08, +0.35] |
| Team experience (least experienced robot): year2 | 8,303 | +0.20 [−3.84, +4.26] | +1.69 [−8.92, +12.79] | +0.00 [−0.24, +0.23] |
| Rated matches this season (fewest on the field): 0-5 | 14,202 | −0.28 [−2.21, +1.67] | −2.21 [−7.22, +2.79] | +0.04 [−0.12, +0.19] |
| Rated matches this season (fewest on the field): 16+ | 6,847 | −0.97 [−6.28, +4.43] | −3.90 [−17.82, +10.24] | −0.16 [−0.50, +0.15] |
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −0.80 [−4.62, +2.90] | −1.10 [−11.32, +8.79] | +0.16 [−0.05, +0.35] |
| Data density (all four robots' rated matches): dense | 10,110 | −0.11 [−4.41, +4.12] | +1.69 [−10.42, +13.24] | −0.16 [−0.41, +0.09] |
| Data density (all four robots' rated matches): normal | 13,190 | −2.39 [−5.58, +0.94] | −9.15 [−17.39, −0.78] | +0.21 [+0.00, +0.40] |
| Data density (all four robots' rated matches): thin | 9,971 | +1.22 [−0.14, +2.60] | +3.20 [−0.07, +6.68] | +0.02 [−0.15, +0.20] |
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | +1.53 [+0.25, +2.82] | +3.75 [+0.68, +6.88] | +0.04 [−0.15, +0.23] | **regression**
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | +0.14 [−2.43, +2.85] | +0.20 [−6.42, +7.29] | +0.02 [−0.13, +0.17] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | −5.33 [−11.17, +0.95] | −15.98 [−33.15, +0.29] | +0.11 [−0.24, +0.44] |
| Event size (teams): large | 8,980 | −1.90 [−5.53, +1.61] | −0.70 [−10.53, +9.09] | +0.06 [−0.16, +0.27] |
| Event size (teams): mid | 18,322 | +0.45 [−2.24, +3.18] | −1.21 [−8.56, +5.84] | +0.01 [−0.17, +0.18] |
| Event size (teams): small | 5,969 | −1.93 [−5.58, +1.49] | −7.24 [−15.95, +1.75] | +0.12 [−0.12, +0.37] |
| Event type: championship | 6,344 | +0.12 [−6.12, +6.24] | +2.05 [−14.33, +19.07] | −0.22 [−0.55, +0.08] |
| Event type: league meet | 12,322 | −0.31 [−2.92, +2.32] | −1.09 [−7.94, +5.72] | +0.16 [−0.02, +0.36] |
| Event type: qualifier | 13,903 | −1.12 [−3.87, +1.49] | −4.91 [−12.26, +1.82] | +0.07 [−0.12, +0.25] |
| Event type: world | 702 | −2.57 [−12.24, +11.40] | −4.24 [−33.74, +35.27] | −0.29 [−0.86, +0.00] |
| Favourite's stated chance: 50-60 | 6,442 | −2.55 [−8.70, +3.65] | −5.29 [−17.85, +7.32] | +0.20 [−0.43, +0.82] |
| Favourite's stated chance: 60-70 | 6,138 | +2.02 [−3.15, +7.43] | +4.48 [−6.97, +16.38] | +0.00 [−0.06, +0.07] |
| Favourite's stated chance: 70-80 | 6,005 | +0.17 [−4.26, +4.42] | −0.02 [−11.50, +11.17] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,243 | −1.30 [−4.30, +1.90] | −3.52 [−15.14, +8.96] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 8,443 | −1.09 [−2.13, −0.02] | −5.09 [−12.48, +3.30] | +0.00 [+0.00, +0.00] | better

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,403 | 54.9% | 54.8% | 0.1% | 0.2% |
| 60-70% | 6,146 | 65.0% | 65.7% | 0.7% | 0.7% |
| 70-80% | 5,962 | 75.0% | 75.9% | 1.0% | 0.9% |
| 80-90% | 6,195 | 85.1% | 83.9% | 1.2% | 1.1% |
| 90-100% | 8,565 | 95.5% | 95.0% | 0.6% | 0.0% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 0.90 pts, challenger 0.78 pts. Regressions beyond noise: level: playoff; eventMatch: playoff; volatility: not measured; eventType: world; probBand: 90-100.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | +0.42 [−1.28, +2.04] | +1.30 [−2.81, +5.31] | +0.01 [−0.11, +0.14] |
| Match type: playoff | 5,117 | +3.64 [+0.43, +7.07] | +8.28 [+0.32, +16.46] | −0.08 [−0.31, +0.16] | **regression**
| Match type: qual | 31,725 | −0.10 [−1.94, +1.68] | +0.17 [−4.45, +4.64] | +0.03 [−0.11, +0.16] |
| Event phase: qualification match number: playoff | 5,117 | +3.64 [+0.43, +7.07] | +8.28 [+0.32, +16.46] | −0.08 [−0.31, +0.16] | **regression**
| Event phase: qualification match number: q1-10 | 11,613 | −0.24 [−2.27, +1.72] | −0.25 [−5.89, +5.02] | +0.14 [−0.05, +0.33] |
| Event phase: qualification match number: q11-25 | 12,697 | −0.97 [−3.88, +2.02] | −2.38 [−9.24, +4.76] | −0.05 [−0.26, +0.17] |
| Event phase: qualification match number: q26+ | 7,415 | +1.59 [−3.30, +6.33] | +5.19 [−7.79, +17.60] | −0.03 [−0.37, +0.32] |
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | −0.17 [−1.53, +1.30] | −1.47 [−4.77, +2.18] | +0.15 [−0.01, +0.30] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | +2.53 [−0.76, +5.67] | +6.16 [−2.62, +14.73] | −0.24 [−0.49, +0.00] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | −0.33 [−4.02, +3.62] | +1.35 [−8.27, +11.01] | +0.02 [−0.24, +0.28] |
| Team experience (least experienced robot): rookie | 17,177 | −0.47 [−2.88, +2.11] | −0.54 [−7.02, +6.06] | +0.09 [−0.08, +0.26] |
| Team experience (least experienced robot): veteran | 10,384 | +0.61 [−2.44, +3.69] | +0.42 [−7.87, +8.17] | −0.01 [−0.23, +0.22] |
| Team experience (least experienced robot): year2 | 9,281 | +1.83 [−1.54, +5.18] | +5.67 [−3.17, +15.04] | −0.11 [−0.35, +0.15] |
| Rated matches this season (fewest on the field): 0-5 | 15,389 | −0.08 [−1.38, +1.30] | −0.72 [−4.04, +2.88] | +0.12 [−0.03, +0.27] |
| Rated matches this season (fewest on the field): 16+ | 8,268 | +2.66 [−2.44, +7.52] | +8.38 [−4.76, +20.48] | +0.01 [−0.32, +0.36] |
| Rated matches this season (fewest on the field): 6-15 | 13,185 | −0.41 [−3.30, +2.36] | −0.79 [−8.15, +6.45] | −0.11 [−0.31, +0.09] |
| Data density (all four robots' rated matches): dense | 11,835 | +0.75 [−3.31, +4.73] | +2.64 [−7.12, +12.93] | +0.00 [−0.28, +0.29] |
| Data density (all four robots' rated matches): normal | 14,138 | −0.18 [−2.62, +2.13] | −0.13 [−6.36, +6.08] | −0.03 [−0.23, +0.16] |
| Data density (all four robots' rated matches): thin | 10,869 | +0.83 [−0.29, +1.89] | +1.69 [−1.05, +4.17] | +0.07 [−0.07, +0.22] |
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | +1.23 [+0.15, +2.31] | +2.88 [+0.38, +5.37] | +0.05 [−0.13, +0.22] | **regression**
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | −1.20 [−3.43, +0.98] | −2.69 [−7.99, +2.82] | +0.06 [−0.11, +0.22] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | +4.37 [−0.71, +9.35] | +11.51 [−2.03, +24.94] | −0.17 [−0.54, +0.17] |
| Event size (teams): large | 10,439 | +0.84 [−2.90, +4.54] | +2.52 [−7.26, +12.82] | −0.20 [−0.47, +0.07] |
| Event size (teams): mid | 20,568 | +0.53 [−1.54, +2.74] | +1.67 [−3.49, +7.16] | +0.10 [−0.06, +0.27] |
| Event size (teams): small | 5,835 | −0.77 [−3.90, +2.07] | −2.22 [−9.83, +4.51] | +0.07 [−0.19, +0.33] |
| Event type: championship | 7,650 | −0.08 [−4.98, +4.72] | +1.05 [−11.14, +13.23] | +0.11 [−0.20, +0.44] |
| Event type: league meet | 12,338 | −0.88 [−3.03, +1.43] | −1.69 [−7.51, +4.17] | −0.02 [−0.19, +0.15] |
| Event type: qualifier | 15,911 | +0.42 [−1.74, +2.75] | +0.15 [−4.88, +5.27] | +0.04 [−0.14, +0.22] |
| Event type: world | 943 | +21.22 [+6.89, +34.38] | +61.64 [+25.48, +93.80] | −0.85 [−2.23, +0.63] | **regression**
| Favourite's stated chance: 50-60 | 8,125 | +2.34 [−2.69, +7.53] | +4.76 [−5.45, +15.35] | +0.02 [−0.55, +0.61] |
| Favourite's stated chance: 60-70 | 7,879 | +0.04 [−4.54, +4.38] | −0.06 [−10.34, +9.62] | +0.03 [+0.00, +0.07] |
| Favourite's stated chance: 70-80 | 7,240 | +0.05 [−3.61, +3.75] | −0.40 [−10.15, +9.59] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,945 | −1.76 [−4.04, +0.58] | −6.69 [−15.63, +2.49] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 6,653 | +1.19 [+0.31, +2.03] | +8.87 [+1.05, +16.61] | +0.00 [+0.00, +0.00] | **regression**

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,119 | 55.0% | 55.4% | 0.5% | 0.4% |
| 60-70% | 7,819 | 65.0% | 65.8% | 0.8% | 0.8% |
| 70-80% | 7,167 | 75.0% | 76.1% | 1.1% | 1.1% |
| 80-90% | 6,976 | 84.9% | 86.1% | 1.1% | 1.1% |
| 90-100% | 6,761 | 94.9% | 94.6% | 0.3% | 0.4% |
