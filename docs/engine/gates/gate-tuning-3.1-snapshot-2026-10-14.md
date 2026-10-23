# Gate: tuning-3.1 vs engine 3.0.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts --challenger`. The challenger uses the contextual model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23` (with its final recalibration, slope 1.057692). The champion uses the same model, and the shipped rating settings:

```json
{}
```

The challenger's changes:

```json
{
 "growthPerWeek": 0.03,
 "growthMaxWeeks": 6,
 "playoffWeight": 0.8
}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.54 pts, challenger 0.47 pts. Regressions beyond noise: teamMatches: 6-15; eventType: league meet.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | +0.31 [−1.24, +1.77] | +0.70 [−3.47, +4.50] | +0.08 [−0.04, +0.21] |
| Match type: playoff | 2,969 | +3.16 [−4.98, +11.12] | +3.56 [−16.70, +23.78] | +0.24 [−0.27, +0.81] |
| Match type: qual | 25,106 | −0.03 [−1.49, +1.46] | +0.36 [−3.59, +4.41] | +0.06 [−0.06, +0.20] |
| Event phase: qualification match number: playoff | 2,969 | +3.16 [−4.98, +11.12] | +3.56 [−16.70, +23.78] | +0.24 [−0.27, +0.81] |
| Event phase: qualification match number: q1-10 | 10,431 | −0.03 [−2.44, +2.29] | +0.62 [−5.46, +6.68] | +0.16 [−0.04, +0.37] |
| Event phase: qualification match number: q11-25 | 10,412 | +0.75 [−1.41, +2.90] | +2.04 [−3.57, +7.62] | +0.01 [−0.17, +0.18] |
| Event phase: qualification match number: q26+ | 4,263 | −1.96 [−5.15, +1.61] | −4.36 [−13.14, +4.86] | −0.05 [−0.35, +0.27] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | +0.13 [−1.87, +2.04] | +0.48 [−4.68, +5.31] | +0.06 [−0.09, +0.21] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | +1.80 [−1.51, +5.17] | +5.66 [−2.81, +14.10] | +0.12 [−0.15, +0.41] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | −0.63 [−3.53, +2.51] | −2.95 [−10.83, +5.50] | +0.09 [−0.18, +0.36] |
| Team experience (least experienced robot): rookie | 15,029 | +0.92 [−1.03, +2.86] | +1.86 [−3.30, +6.95] | +0.03 [−0.12, +0.20] |
| Team experience (least experienced robot): veteran | 7,416 | −0.10 [−3.29, +2.98] | +1.21 [−7.39, +9.19] | +0.15 [−0.10, +0.42] |
| Team experience (least experienced robot): year2 | 5,630 | −0.81 [−4.19, +2.80] | −3.07 [−12.14, +5.94] | +0.13 [−0.17, +0.41] |
| Rated matches this season (fewest on the field): 0-5 | 12,833 | −1.25 [−3.14, +0.55] | −2.43 [−7.14, +2.10] | +0.07 [−0.07, +0.22] |
| Rated matches this season (fewest on the field): 16+ | 4,861 | −2.18 [−6.71, +2.68] | −9.80 [−22.49, +3.39] | +0.00 [−0.40, +0.39] |
| Rated matches this season (fewest on the field): 6-15 | 10,381 | +3.39 [+0.59, +6.29] | +9.49 [+2.39, +16.69] | +0.14 [−0.10, +0.37] | **regression**
| Data density (all four robots' rated matches): dense | 7,119 | −0.90 [−4.40, +2.64] | −5.92 [−15.71, +4.05] | +0.00 [−0.30, +0.29] |
| Data density (all four robots' rated matches): normal | 11,776 | +2.12 [−0.38, +4.73] | +7.45 [+0.96, +14.01] | +0.27 [+0.05, +0.48] |
| Data density (all four robots' rated matches): thin | 9,180 | −1.09 [−2.85, +0.56] | −2.83 [−7.15, +1.09] | −0.09 [−0.23, +0.06] |
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | −0.29 [−1.21, +0.58] | −0.55 [−2.71, +1.51] | −0.09 [−0.20, +0.00] |
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | +0.94 [−1.35, +3.29] | +2.96 [−3.09, +8.89] | +0.16 [−0.02, +0.34] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | −0.88 [−4.83, +3.04] | −4.59 [−15.08, +6.22] | +0.07 [−0.23, +0.41] |
| Event size (teams): large | 6,510 | −0.96 [−3.85, +1.92] | −2.07 [−9.94, +5.95] | +0.19 [−0.08, +0.45] |
| Event size (teams): mid | 15,470 | −0.08 [−2.17, +1.95] | −0.20 [−5.75, +5.05] | +0.08 [−0.09, +0.25] |
| Event size (teams): small | 6,095 | +2.65 [−0.47, +5.84] | +5.93 [−2.27, +14.51] | −0.02 [−0.25, +0.22] |
| Event type: championship | 4,378 | −0.61 [−5.75, +4.71] | −1.97 [−15.38, +11.78] | −0.07 [−0.47, +0.32] |
| Event type: league meet | 11,683 | +1.91 [+0.50, +3.36] | +5.18 [+1.26, +9.07] | +0.21 [+0.06, +0.35] | **regression**
| Event type: qualifier | 11,417 | −1.20 [−3.86, +1.41] | −3.79 [−10.80, +3.32] | +0.04 [−0.17, +0.24] |
| Event type: world | 597 | +4.43 [−3.79, +18.14] | +18.49 [−1.28, +50.98] | −0.34 [−0.68, +0.63] |
| Favourite's stated chance: 50-60 | 7,295 | −2.27 [−5.96, +1.37] | −4.67 [−12.17, +2.71] | +0.30 [−0.17, +0.80] |
| Favourite's stated chance: 60-70 | 5,815 | +2.23 [−1.92, +6.15] | +5.35 [−3.77, +14.01] | +0.02 [+0.00, +0.05] |
| Favourite's stated chance: 70-80 | 5,260 | +1.07 [−2.36, +4.63] | +2.51 [−6.39, +11.91] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 4,944 | +1.40 [−1.37, +3.94] | +4.70 [−5.41, +13.93] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 4,761 | −0.08 [−1.25, +1.02] | −2.92 [−12.15, +5.95] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,393 | 54.3% | 54.7% | 0.5% | 0.3% |
| 60-70% | 5,929 | 64.9% | 65.2% | 0.4% | 0.2% |
| 70-80% | 5,284 | 74.9% | 75.5% | 0.6% | 0.5% |
| 80-90% | 4,919 | 84.9% | 86.2% | 1.3% | 1.2% |
| 90-100% | 4,550 | 94.9% | 94.7% | 0.2% | 0.3% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 0.61 pts, challenger 0.98 pts. Regressions beyond noise: teamEvent: 1st; teamMatches: 0-5; density: thin; volatility: not measured; eventType: league meet.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | −2.51 [−4.55, −0.33] | −8.95 [−14.65, −3.04] | −0.05 [−0.19, +0.08] | better
| Match type: playoff | 4,386 | −18.26 [−26.97, −9.46] | −45.73 [−67.99, −22.60] | +0.09 [−0.43, +0.62] | better
| Match type: qual | 28,885 | −0.11 [−2.21, +1.85] | −3.37 [−9.08, +2.10] | −0.07 [−0.21, +0.07] |
| Event phase: qualification match number: playoff | 4,386 | −18.26 [−26.97, −9.46] | −45.73 [−67.99, −22.60] | +0.09 [−0.43, +0.62] | better
| Event phase: qualification match number: q1-10 | 10,927 | +1.19 [−1.64, +3.94] | −0.50 [−8.62, +6.85] | −0.17 [−0.40, +0.06] |
| Event phase: qualification match number: q11-25 | 11,671 | −0.23 [−3.02, +2.45] | −3.04 [−11.03, +4.54] | +0.03 [−0.16, +0.24] |
| Event phase: qualification match number: q26+ | 6,287 | −2.15 [−6.32, +2.31] | −8.95 [−21.70, +3.14] | −0.10 [−0.37, +0.19] |
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | +3.38 [+0.68, +6.26] | +6.47 [−0.44, +13.72] | −0.17 [−0.37, +0.03] | **regression**
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | −4.70 [−8.80, −0.60] | −13.08 [−23.85, −1.96] | +0.15 [−0.12, +0.40] | better
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | −8.42 [−12.40, −4.38] | −25.62 [−37.15, −13.93] | −0.04 [−0.33, +0.24] | better
| Team experience (least experienced robot): rookie | 16,718 | −3.94 [−6.91, −1.10] | −12.27 [−20.16, −4.56] | −0.05 [−0.24, +0.13] | better
| Team experience (least experienced robot): veteran | 8,250 | −0.51 [−5.04, +3.71] | −5.56 [−17.15, +5.21] | −0.06 [−0.36, +0.22] |
| Team experience (least experienced robot): year2 | 8,303 | −1.60 [−5.58, +2.91] | −5.63 [−16.43, +6.19] | −0.02 [−0.29, +0.26] |
| Rated matches this season (fewest on the field): 0-5 | 14,202 | +4.27 [+1.93, +6.90] | +7.81 [+0.88, +14.79] | −0.14 [−0.31, +0.04] | **regression**
| Rated matches this season (fewest on the field): 16+ | 6,847 | −10.87 [−16.24, −5.26] | −30.55 [−44.76, −14.96] | −0.01 [−0.42, +0.39] | better
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −5.69 [−9.13, −2.13] | −16.32 [−25.74, −6.66] | +0.03 [−0.18, +0.24] | better
| Data density (all four robots' rated matches): dense | 10,110 | −10.74 [−15.46, −6.05] | −32.11 [−45.33, −18.68] | +0.01 [−0.28, +0.31] | better
| Data density (all four robots' rated matches): normal | 13,190 | −1.64 [−4.79, +1.35] | −6.07 [−14.50, +1.81] | −0.02 [−0.22, +0.20] |
| Data density (all four robots' rated matches): thin | 9,971 | +4.71 [+2.29, +7.42] | +10.72 [+4.39, +17.39] | −0.15 [−0.36, +0.07] | **regression**
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | +2.53 [+0.91, +4.34] | +5.86 [+1.77, +10.21] | −0.18 [−0.39, +0.03] | **regression**
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | −2.44 [−5.43, +0.55] | −9.24 [−17.19, −1.55] | −0.02 [−0.20, +0.17] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | −8.46 [−13.60, −3.01] | −25.07 [−40.18, −10.09] | +0.02 [−0.29, +0.33] | better
| Event size (teams): large | 8,980 | −2.54 [−7.23, +2.52] | −9.67 [−22.37, +3.29] | +0.02 [−0.24, +0.28] |
| Event size (teams): mid | 18,322 | −3.44 [−6.22, −0.61] | −11.90 [−19.55, −4.31] | −0.14 [−0.33, +0.05] | better
| Event size (teams): small | 5,969 | +0.42 [−2.70, +3.64] | +1.19 [−7.51, +9.88] | +0.14 [−0.17, +0.44] |
| Event type: championship | 6,344 | −9.45 [−16.26, −2.32] | −29.68 [−48.60, −10.59] | −0.21 [−0.60, +0.18] | better
| Event type: league meet | 12,322 | +2.68 [+0.99, +4.26] | +6.49 [+1.49, +11.39] | −0.02 [−0.21, +0.16] | **regression**
| Event type: qualifier | 13,903 | −3.38 [−6.77, +0.11] | −11.17 [−20.27, −1.84] | +0.04 [−0.18, +0.25] |
| Event type: world | 702 | −13.44 [−33.21, +10.63] | −48.76 [−84.02, +13.25] | −0.72 [−2.25, +0.57] |
| Favourite's stated chance: 50-60 | 6,442 | −7.96 [−13.88, −1.47] | −16.28 [−28.23, −2.91] | −0.25 [−0.95, +0.43] | better
| Favourite's stated chance: 60-70 | 6,138 | +0.97 [−4.73, +6.59] | +2.07 [−10.29, +14.43] | +0.00 [−0.08, +0.08] |
| Favourite's stated chance: 70-80 | 6,005 | +0.13 [−5.20, +5.49] | +1.08 [−12.53, +15.09] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,243 | −3.66 [−6.80, −0.39] | −14.78 [−26.22, −2.73] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 90-100 | 8,443 | −1.88 [−3.17, −0.66] | −14.19 [−23.72, −4.73] | +0.00 [+0.00, +0.00] | better

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,591 | 55.0% | 54.5% | 0.4% | 0.5% |
| 60-70% | 6,251 | 65.0% | 65.7% | 0.6% | 0.7% |
| 70-80% | 6,025 | 75.0% | 76.9% | 2.0% | 1.9% |
| 80-90% | 6,223 | 85.1% | 84.5% | 0.6% | 0.5% |
| 90-100% | 8,181 | 95.4% | 95.2% | 0.2% | 0.2% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 0.90 pts, challenger 1.08 pts. Regressions beyond noise: eventMatch: q1-10; teamEvent: 1st; teamMatches: 0-5; density: thin; volatility: not measured; eventType: league meet.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | +0.60 [−1.18, +2.36] | +0.73 [−3.98, +5.36] | −0.05 [−0.18, +0.09] |
| Match type: playoff | 5,117 | −0.03 [−7.10, +7.20] | −3.19 [−20.54, +14.75] | +0.04 [−0.38, +0.46] |
| Match type: qual | 31,725 | +0.70 [−1.02, +2.39] | +1.36 [−3.37, +5.86] | −0.06 [−0.20, +0.08] |
| Event phase: qualification match number: playoff | 5,117 | −0.03 [−7.10, +7.20] | −3.19 [−20.54, +14.75] | +0.04 [−0.38, +0.46] |
| Event phase: qualification match number: q1-10 | 11,613 | +3.04 [+0.40, +5.65] | +6.86 [−0.10, +13.58] | +0.06 [−0.17, +0.29] | **regression**
| Event phase: qualification match number: q11-25 | 12,697 | +0.11 [−2.60, +2.92] | +0.78 [−6.19, +7.99] | −0.24 [−0.45, −0.03] |
| Event phase: qualification match number: q26+ | 7,415 | −1.93 [−5.73, +1.80] | −6.28 [−16.71, +3.66] | +0.05 [−0.26, +0.36] |
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | +3.57 [+1.25, +6.01] | +8.98 [+2.98, +15.41] | −0.11 [−0.29, +0.07] | **regression**
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | +0.38 [−3.39, +3.63] | +0.49 [−9.01, +9.52] | −0.14 [−0.44, +0.15] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | −2.94 [−6.11, +0.27] | −9.40 [−18.21, −0.50] | +0.10 [−0.15, +0.35] |
| Team experience (least experienced robot): rookie | 17,177 | +0.78 [−1.79, +3.22] | +0.72 [−6.42, +7.74] | −0.06 [−0.25, +0.12] |
| Team experience (least experienced robot): veteran | 10,384 | +1.00 [−2.41, +4.43] | +0.64 [−8.04, +9.89] | −0.16 [−0.42, +0.09] |
| Team experience (least experienced robot): year2 | 9,281 | −0.17 [−3.57, +3.29] | +0.84 [−7.61, +9.26] | +0.12 [−0.17, +0.43] |
| Rated matches this season (fewest on the field): 0-5 | 15,389 | +2.82 [+0.64, +5.09] | +6.79 [+1.12, +12.78] | −0.07 [−0.25, +0.11] | **regression**
| Rated matches this season (fewest on the field): 16+ | 8,268 | −0.27 [−4.98, +4.18] | −2.87 [−14.81, +8.80] | +0.13 [−0.18, +0.45] |
| Rated matches this season (fewest on the field): 6-15 | 13,185 | −1.44 [−4.42, +1.77] | −4.10 [−11.84, +4.02] | −0.14 [−0.38, +0.10] |
| Data density (all four robots' rated matches): dense | 11,835 | −4.50 [−8.24, −0.75] | −14.10 [−24.63, −3.39] | +0.18 [−0.08, +0.44] | better
| Data density (all four robots' rated matches): normal | 14,138 | +1.76 [−1.08, +4.63] | +4.79 [−2.24, +11.84] | −0.20 [−0.42, +0.01] |
| Data density (all four robots' rated matches): thin | 10,869 | +4.66 [+2.75, +6.59] | +11.58 [+6.86, +16.33] | −0.09 [−0.29, +0.12] | **regression**
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | +2.96 [+1.62, +4.47] | +7.22 [+4.06, +10.64] | +0.01 [−0.18, +0.22] | **regression**
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | −0.54 [−3.08, +2.06] | −1.98 [−8.59, +4.96] | +0.05 [−0.14, +0.23] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | +1.40 [−2.94, +5.98] | +1.64 [−10.34, +13.75] | −0.39 [−0.73, −0.06] |
| Event size (teams): large | 10,439 | −0.79 [−4.53, +3.08] | −3.37 [−14.44, +7.01] | −0.09 [−0.36, +0.20] |
| Event size (teams): mid | 20,568 | +1.15 [−1.19, +3.70] | +1.82 [−4.13, +8.20] | −0.03 [−0.21, +0.14] |
| Event size (teams): small | 5,835 | +1.17 [−2.18, +4.51] | +4.19 [−4.30, +13.06] | −0.02 [−0.31, +0.27] |
| Event type: championship | 7,650 | −1.18 [−6.51, +4.49] | −5.40 [−19.83, +9.22] | +0.21 [−0.14, +0.55] |
| Event type: league meet | 12,338 | +2.14 [+0.59, +3.66] | +4.45 [+0.07, +8.61] | −0.05 [−0.20, +0.10] | **regression**
| Event type: qualifier | 15,911 | +1.09 [−1.75, +3.99] | +1.96 [−5.43, +9.30] | −0.16 [−0.38, +0.03] |
| Event type: world | 943 | −13.28 [−27.78, −4.59] | −19.20 [−55.51, +7.46] | −0.11 [−1.51, +1.05] | better
| Favourite's stated chance: 50-60 | 8,125 | +0.44 [−4.50, +5.33] | +0.79 [−9.23, +10.72] | −0.19 [−0.74, +0.42] |
| Favourite's stated chance: 60-70 | 7,879 | +2.16 [−2.44, +6.81] | +5.06 [−5.09, +15.27] | −0.03 [−0.06, +0.00] |
| Favourite's stated chance: 70-80 | 7,240 | +1.61 [−2.65, +5.83] | +4.51 [−6.31, +15.76] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 6,945 | −1.45 [−4.49, +1.51] | −5.75 [−16.98, +5.28] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 6,653 | −0.00 [−1.30, +1.20] | −1.85 [−12.34, +7.90] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,279 | 55.0% | 55.0% | 0.1% | 0.0% |
| 60-70% | 8,010 | 64.9% | 66.1% | 1.1% | 1.1% |
| 70-80% | 7,334 | 75.0% | 77.1% | 2.2% | 2.1% |
| 80-90% | 6,943 | 84.9% | 86.7% | 1.8% | 1.7% |
| 90-100% | 6,276 | 94.8% | 94.8% | 0.0% | 0.2% |

## 2026–27

Calibration error in the 50–80% bands (match-weighted): champion NaN pts, challenger NaN pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 0 | – [–, –] | – [–, –] | – [–, –] | ⚠ low n

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% ⚠ low n | 0 | – | – | – | – |
| 60-70% ⚠ low n | 0 | – | – | – | – |
| 70-80% ⚠ low n | 0 | – | – | – | – |
| 80-90% ⚠ low n | 0 | – | – | – | – |
| 90-100% ⚠ low n | 0 | – | – | – | – |
