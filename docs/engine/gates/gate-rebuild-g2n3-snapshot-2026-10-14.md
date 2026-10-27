# Gate: rebuild-g2n3 vs engine 3.2.0 on snapshot-2026-10-14

Generated 2026-10-27 by `scripts/engine-slices.ts --challenger`. The challenger uses the contextual model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23` (with its final recalibration, slope 1.057692). The champion uses the same model, and the shipped rating settings:

```json
{}
```

The challenger's changes:

```json
{
 "rebuildGapWeeks": 2,
 "rebuildN": 3,
 "rebuildUncPerWeek": 0
}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.54 pts, challenger 0.28 pts. Regressions beyond noise: eventMatch: q1-10; experience: rookie; eventType: championship; probBand: 80-90.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | +1.65 [−0.20, +3.59] | +4.79 [−0.07, +9.82] | +0.00 [−0.13, +0.13] |
| Match type: playoff | 2,969 | +2.54 [−2.38, +7.05] | +4.63 [−7.09, +15.55] | +0.00 [−0.37, +0.38] |
| Match type: qual | 25,106 | +1.54 [−0.49, +3.60] | +4.80 [−0.85, +10.19] | +0.00 [−0.14, +0.15] |
| Event phase: qualification match number: playoff | 2,969 | +2.54 [−2.38, +7.05] | +4.63 [−7.09, +15.55] | +0.00 [−0.37, +0.38] |
| Event phase: qualification match number: q1-10 | 10,431 | +2.67 [+0.34, +5.12] | +4.97 [−0.80, +11.11] | +0.07 [−0.14, +0.27] | **regression**
| Event phase: qualification match number: q11-25 | 10,412 | −0.52 [−4.02, +2.99] | +0.64 [−8.24, +9.26] | +0.02 [−0.23, +0.27] |
| Event phase: qualification match number: q26+ | 4,263 | +3.80 [−2.24, +10.40] | +14.57 [−2.27, +32.95] | −0.19 [−0.55, +0.21] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | −0.45 [−2.25, +1.28] | −0.72 [−5.03, +3.56] | +0.04 [−0.09, +0.18] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | +2.04 [−1.87, +5.81] | +6.25 [−4.14, +16.13] | +0.06 [−0.26, +0.38] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | +4.32 [−0.66, +9.45] | +11.47 [−1.30, +24.94] | −0.09 [−0.40, +0.21] |
| Team experience (least experienced robot): rookie | 15,029 | +3.15 [+0.56, +5.76] | +7.96 [+1.42, +14.60] | +0.00 [−0.18, +0.19] | **regression**
| Team experience (least experienced robot): veteran | 7,416 | −1.64 [−5.33, +1.95] | −4.27 [−13.46, +5.08] | +0.04 [−0.19, +0.31] |
| Team experience (least experienced robot): year2 | 5,630 | +1.96 [−2.45, +6.10] | +8.23 [−3.16, +19.60] | −0.04 [−0.33, +0.25] |
| Rated matches this season (fewest on the field): 0-5 | 12,833 | −0.48 [−2.30, +1.21] | −0.76 [−5.39, +3.54] | +0.09 [−0.05, +0.23] |
| Rated matches this season (fewest on the field): 16+ | 4,861 | +5.13 [−1.81, +12.06] | +13.39 [−4.97, +31.78] | −0.02 [−0.39, +0.34] |
| Rated matches this season (fewest on the field): 6-15 | 10,381 | +2.64 [−1.11, +6.29] | +7.62 [−1.85, +16.51] | −0.10 [−0.38, +0.18] |
| Data density (all four robots' rated matches): dense | 7,119 | +4.94 [−0.29, +10.51] | +13.21 [+0.07, +27.38] | −0.23 [−0.55, +0.10] |
| Data density (all four robots' rated matches): normal | 11,776 | +1.15 [−2.08, +4.46] | +4.23 [−4.14, +12.31] | +0.16 [−0.07, +0.40] |
| Data density (all four robots' rated matches): thin | 9,180 | −0.27 [−1.28, +0.73] | −1.04 [−3.58, +1.35] | −0.02 [−0.11, +0.07] |
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | −0.30 [−0.69, +0.07] | −0.74 [−1.67, +0.14] | +0.02 [−0.05, +0.08] |
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | +1.26 [−1.48, +4.04] | +4.00 [−2.87, +11.02] | +0.02 [−0.17, +0.21] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | +5.17 [−1.46, +11.90] | +13.84 [−3.12, +31.54] | −0.07 [−0.47, +0.33] |
| Event size (teams): large | 6,510 | +2.31 [−2.10, +6.39] | +8.51 [−3.35, +19.88] | −0.06 [−0.31, +0.18] |
| Event size (teams): mid | 15,470 | +2.26 [−0.36, +4.93] | +5.96 [−0.63, +12.70] | +0.12 [−0.06, +0.32] |
| Event size (teams): small | 6,095 | −0.62 [−4.51, +3.54] | −2.17 [−11.58, +8.15] | −0.23 [−0.50, +0.05] |
| Event type: championship | 4,378 | +5.67 [+0.47, +11.03] | +19.17 [+4.44, +34.48] | +0.05 [−0.30, +0.41] | **regression**
| Event type: league meet | 11,683 | −1.29 [−4.04, +1.43] | −4.16 [−10.85, +2.60] | +0.07 [−0.14, +0.28] |
| Event type: qualifier | 11,417 | +2.71 [−0.36, +5.98] | +6.78 [−0.91, +14.83] | −0.05 [−0.25, +0.14] |
| Event type: world | 597 | +9.29 [−10.09, +26.82] | +36.16 [−21.93, +86.13] | −0.50 [−1.09, +0.00] |
| Favourite's stated chance: 50-60 | 7,295 | +2.88 [−1.74, +7.31] | +5.82 [−3.59, +14.88] | +0.01 [−0.51, +0.54] |
| Favourite's stated chance: 60-70 | 5,815 | +0.40 [−4.93, +5.80] | +0.87 [−10.70, +12.98] | +0.00 [−0.05, +0.05] |
| Favourite's stated chance: 70-80 | 5,260 | +1.18 [−3.16, +5.67] | +3.58 [−7.88, +15.90] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 4,944 | +3.27 [+0.03, +6.49] | +11.43 [−1.93, +24.29] | +0.00 [+0.00, +0.00] | **regression**
| Favourite's stated chance: 90-100 | 4,761 | +0.12 [−0.83, +1.13] | +2.41 [−5.87, +11.03] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,251 | 54.3% | 54.4% | 0.1% | 0.6% |
| 60-70% | 5,757 | 64.9% | 64.5% | 0.4% | 0.5% |
| 70-80% | 5,239 | 74.9% | 75.3% | 0.4% | 0.3% |
| 80-90% | 4,979 | 84.9% | 85.1% | 0.2% | 0.1% |
| 90-100% | 4,849 | 95.0% | 94.7% | 0.3% | 0.3% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 0.61 pts, challenger 0.55 pts. Regressions beyond noise: density: thin; volatility: not measured.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | +0.03 [−2.05, +2.11] | −0.24 [−5.89, +5.32] | −0.01 [−0.15, +0.13] |
| Match type: playoff | 4,386 | +0.02 [−4.71, +4.55] | −1.70 [−13.62, +10.22] | −0.18 [−0.54, +0.14] |
| Match type: qual | 28,885 | +0.03 [−2.42, +2.32] | −0.02 [−6.41, +6.10] | +0.02 [−0.12, +0.16] |
| Event phase: qualification match number: playoff | 4,386 | +0.02 [−4.71, +4.55] | −1.70 [−13.62, +10.22] | −0.18 [−0.54, +0.14] |
| Event phase: qualification match number: q1-10 | 10,927 | +0.21 [−3.02, +3.44] | +1.75 [−6.42, +10.08] | +0.07 [−0.15, +0.31] |
| Event phase: qualification match number: q11-25 | 11,671 | −0.30 [−4.04, +3.34] | −1.04 [−11.12, +9.52] | +0.07 [−0.16, +0.30] |
| Event phase: qualification match number: q26+ | 6,287 | +0.36 [−4.72, +5.64] | −1.21 [−15.61, +12.85] | −0.18 [−0.48, +0.14] |
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | +0.38 [−1.76, +2.42] | −0.87 [−6.29, +4.21] | −0.02 [−0.19, +0.15] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | +0.08 [−4.34, +4.49] | +1.42 [−10.40, +13.43] | +0.20 [−0.08, +0.49] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | −0.44 [−5.15, +4.47] | −0.65 [−12.70, +11.86] | −0.15 [−0.44, +0.15] |
| Team experience (least experienced robot): rookie | 16,718 | −0.38 [−3.26, +2.48] | −2.98 [−10.55, +4.32] | −0.01 [−0.20, +0.18] |
| Team experience (least experienced robot): veteran | 8,250 | +0.88 [−3.26, +5.16] | +1.54 [−9.29, +12.94] | +0.02 [−0.22, +0.30] |
| Team experience (least experienced robot): year2 | 8,303 | +0.03 [−4.44, +4.55] | +3.50 [−8.86, +15.77] | −0.05 [−0.33, +0.22] |
| Rated matches this season (fewest on the field): 0-5 | 14,202 | +0.34 [−1.75, +2.54] | −0.58 [−6.08, +4.91] | −0.03 [−0.20, +0.14] |
| Rated matches this season (fewest on the field): 16+ | 6,847 | +0.43 [−5.56, +6.43] | +0.91 [−14.54, +16.64] | −0.28 [−0.67, +0.10] |
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −0.55 [−4.58, +3.43] | −0.49 [−11.33, +10.12] | +0.16 [−0.07, +0.40] |
| Data density (all four robots' rated matches): dense | 10,110 | +0.96 [−4.10, +5.91] | +4.74 [−8.73, +17.66] | −0.26 [−0.55, +0.05] |
| Data density (all four robots' rated matches): normal | 13,190 | −1.94 [−5.42, +1.55] | −7.65 [−16.85, +1.12] | +0.23 [+0.01, +0.45] |
| Data density (all four robots' rated matches): thin | 9,971 | +1.71 [+0.16, +3.26] | +4.50 [+0.71, +8.40] | −0.07 [−0.24, +0.10] | **regression**
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | +2.14 [+0.77, +3.58] | +4.91 [+1.58, +8.27] | −0.05 [−0.25, +0.14] | **regression**
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | +0.32 [−2.54, +3.29] | +1.43 [−6.00, +8.92] | +0.01 [−0.17, +0.18] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | −3.24 [−9.65, +3.97] | −11.16 [−28.80, +7.61] | +0.00 [−0.39, +0.37] |
| Event size (teams): large | 8,980 | −1.21 [−5.01, +2.64] | +1.12 [−9.62, +11.89] | −0.01 [−0.27, +0.24] |
| Event size (teams): mid | 18,322 | +1.55 [−1.51, +4.56] | +2.42 [−5.67, +10.48] | −0.07 [−0.26, +0.13] |
| Event size (teams): small | 5,969 | −2.76 [−6.91, +1.20] | −10.47 [−21.18, −0.62] | +0.19 [−0.10, +0.47] |
| Event type: championship | 6,344 | +2.13 [−4.64, +8.70] | +6.63 [−11.45, +24.75] | −0.29 [−0.64, +0.06] |
| Event type: league meet | 12,322 | −0.74 [−3.60, +2.20] | −1.79 [−9.19, +5.88] | +0.07 [−0.14, +0.28] |
| Event type: qualifier | 13,903 | −0.11 [−3.18, +3.05] | −1.73 [−9.75, +6.45] | +0.08 [−0.13, +0.30] |
| Event type: world | 702 | −2.59 [−12.92, +11.72] | −5.53 [−36.52, +36.32] | −0.57 [−1.14, +0.00] |
| Favourite's stated chance: 50-60 | 6,442 | −1.83 [−8.45, +4.95] | −3.70 [−17.16, +10.12] | −0.05 [−0.73, +0.65] |
| Favourite's stated chance: 60-70 | 6,138 | +1.93 [−4.17, +8.27] | +4.17 [−9.28, +18.09] | +0.00 [−0.08, +0.09] |
| Favourite's stated chance: 70-80 | 6,005 | +2.70 [−2.37, +7.43] | +6.82 [−6.56, +19.47] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,243 | −1.08 [−4.58, +2.45] | −1.89 [−15.12, +11.57] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 8,443 | −1.00 [−2.11, +0.13] | −4.62 [−12.55, +3.84] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,413 | 54.9% | 54.7% | 0.2% | 0.3% |
| 60-70% | 6,083 | 65.0% | 65.8% | 0.7% | 0.8% |
| 70-80% | 5,954 | 74.9% | 75.6% | 0.7% | 0.6% |
| 80-90% | 6,223 | 85.1% | 84.0% | 1.1% | 1.0% |
| 90-100% | 8,598 | 95.5% | 94.9% | 0.7% | 0.1% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 0.90 pts, challenger 0.67 pts. Regressions beyond noise: level: playoff; eventMatch: playoff; density: thin; volatility: not measured; eventType: world; probBand: 50-60; probBand: 90-100.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | +1.28 [−0.55, +3.11] | +2.88 [−1.65, +7.68] | −0.06 [−0.19, +0.07] |
| Match type: playoff | 5,117 | +5.00 [+1.29, +8.95] | +11.21 [+1.93, +20.55] | +0.02 [−0.26, +0.32] | **regression**
| Match type: qual | 31,725 | +0.68 [−1.35, +2.75] | +1.53 [−3.94, +6.84] | −0.08 [−0.22, +0.06] |
| Event phase: qualification match number: playoff | 5,117 | +5.00 [+1.29, +8.95] | +11.21 [+1.93, +20.55] | +0.02 [−0.26, +0.32] | **regression**
| Event phase: qualification match number: q1-10 | 11,613 | +1.49 [−0.84, +3.93] | +3.56 [−2.71, +9.92] | +0.07 [−0.14, +0.27] |
| Event phase: qualification match number: q11-25 | 12,697 | −0.96 [−4.31, +2.44] | −3.38 [−11.40, +4.95] | −0.19 [−0.42, +0.02] |
| Event phase: qualification match number: q26+ | 7,415 | +2.24 [−2.98, +7.30] | +6.76 [−7.44, +19.87] | −0.11 [−0.49, +0.25] |
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | +0.46 [−1.06, +2.06] | −0.31 [−4.08, +3.53] | +0.03 [−0.14, +0.18] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | +2.97 [−0.81, +6.57] | +6.25 [−3.76, +16.13] | −0.28 [−0.54, −0.01] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | +1.13 [−3.28, +5.59] | +4.50 [−6.43, +15.09] | −0.02 [−0.29, +0.27] |
| Team experience (least experienced robot): rookie | 17,177 | +0.80 [−2.10, +3.82] | +1.81 [−5.86, +9.51] | −0.05 [−0.23, +0.15] |
| Team experience (least experienced robot): veteran | 10,384 | +1.31 [−2.34, +4.76] | +1.40 [−8.25, +10.58] | −0.03 [−0.27, +0.22] |
| Team experience (least experienced robot): year2 | 9,281 | +2.15 [−1.52, +5.91] | +6.49 [−3.49, +16.65] | −0.13 [−0.40, +0.14] |
| Rated matches this season (fewest on the field): 0-5 | 15,389 | +0.65 [−0.84, +2.27] | +0.60 [−3.21, +4.82] | −0.01 [−0.16, +0.15] |
| Rated matches this season (fewest on the field): 16+ | 8,268 | +3.60 [−2.14, +9.08] | +10.24 [−4.24, +23.79] | +0.01 [−0.35, +0.35] |
| Rated matches this season (fewest on the field): 6-15 | 13,185 | +0.57 [−2.73, +3.73] | +0.91 [−7.32, +8.89] | −0.18 [−0.39, +0.05] |
| Data density (all four robots' rated matches): dense | 11,835 | +1.06 [−3.50, +5.54] | +3.15 [−8.25, +14.52] | +0.02 [−0.26, +0.33] |
| Data density (all four robots' rated matches): normal | 14,138 | +1.21 [−1.62, +4.05] | +2.25 [−5.10, +9.24] | −0.17 [−0.38, +0.03] |
| Data density (all four robots' rated matches): thin | 10,869 | +1.62 [+0.35, +2.80] | +3.38 [+0.36, +6.31] | −0.01 [−0.16, +0.15] | **regression**
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | +1.73 [+0.54, +2.88] | +3.88 [+1.14, +6.54] | −0.03 [−0.21, +0.16] | **regression**
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | +0.08 [−2.35, +2.49] | +0.12 [−6.03, +6.52] | +0.00 [−0.17, +0.18] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | +4.41 [−1.19, +9.97] | +10.02 [−5.20, +25.45] | −0.31 [−0.67, +0.06] |
| Event size (teams): large | 10,439 | +2.98 [−0.97, +6.98] | +6.85 [−3.32, +17.73] | −0.36 [−0.64, −0.07] |
| Event size (teams): mid | 20,568 | +1.08 [−1.42, +3.65] | +2.64 [−3.44, +8.69] | +0.06 [−0.11, +0.23] |
| Event size (teams): small | 5,835 | −1.05 [−4.75, +2.32] | −3.39 [−12.44, +4.99] | +0.03 [−0.24, +0.33] |
| Event type: championship | 7,650 | +0.92 [−4.49, +6.11] | +3.40 [−10.02, +16.91] | +0.08 [−0.25, +0.42] |
| Event type: league meet | 12,338 | +0.55 [−2.07, +3.08] | +1.34 [−5.54, +7.85] | −0.11 [−0.29, +0.06] |
| Event type: qualifier | 15,911 | +0.78 [−1.89, +3.47] | +0.18 [−5.82, +6.30] | −0.03 [−0.23, +0.18] |
| Event type: world | 943 | +22.30 [+5.38, +37.77] | +64.19 [+22.35, +102.05] | −1.17 [−2.21, +0.00] | **regression**
| Favourite's stated chance: 50-60 | 8,125 | +6.19 [+0.71, +11.92] | +12.68 [+1.40, +24.24] | −0.31 [−0.91, +0.29] | **regression**
| Favourite's stated chance: 60-70 | 7,879 | +1.26 [−3.60, +6.21] | +2.78 [−7.89, +13.82] | +0.03 [+0.00, +0.07] |
| Favourite's stated chance: 70-80 | 7,240 | −0.70 [−4.91, +3.62] | −2.55 [−13.88, +8.87] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,945 | −2.54 [−5.11, +0.07] | −10.23 [−20.30, +0.08] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 6,653 | +1.46 [+0.51, +2.38] | +10.62 [+2.38, +18.75] | +0.00 [+0.00, +0.00] | **regression**

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,140 | 55.0% | 55.3% | 0.3% | 0.3% |
| 60-70% | 7,754 | 65.0% | 65.8% | 0.8% | 0.8% |
| 70-80% | 7,185 | 74.9% | 75.9% | 1.0% | 0.9% |
| 80-90% | 6,991 | 84.9% | 86.0% | 1.0% | 1.0% |
| 90-100% | 6,772 | 94.9% | 94.6% | 0.4% | 0.4% |
