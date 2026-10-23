# Gate: 3.0-vs-2.6 vs engine 2.11.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts --challenger`. Both use the contextual model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23`. The champion's rating settings are the shipped ones with these overrides (the previous release):

```json
{
 "rho1": 0.6,
 "regionKappa": 0,
 "eventLambdaAuto": 0,
 "eventLambdaTeleop": 0,
 "penGain": 1,
 "overlapAuto": 0,
 "overlapTeleop": 0
}
```

The challenger's changes:

```json
{}
```

Both replay the same matches in the same order. Changes are challenger minus champion (negative Brier and log loss = challenger better) with 95% intervals from resampling whole events. A slice is a **regression** when its whole Brier interval lies above zero. 2024–25 is the tuning season; 2025–26 is **reused** and reported, not proof.

## 2019–20

Calibration error in the 50–80% bands (match-weighted): champion 2.81 pts, challenger 2.19 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 15,391 | −7.87 [−10.03, −5.74] | −20.99 [−26.31, −15.75] | +0.06 [−0.13, +0.25] | better
| Match type: playoff | 1,970 | −3.16 [−9.43, +3.21] | −12.68 [−29.08, +3.34] | +0.15 [−0.36, +0.68] |
| Match type: qual | 13,421 | −8.56 [−10.72, −6.30] | −22.21 [−27.50, −16.55] | +0.05 [−0.17, +0.25] | better
| Event phase: qualification match number: playoff | 1,970 | −3.16 [−9.43, +3.21] | −12.68 [−29.08, +3.34] | +0.15 [−0.36, +0.68] |
| Event phase: qualification match number: q1-10 | 5,544 | −7.02 [−10.57, −3.66] | −18.11 [−26.48, −10.25] | +0.16 [−0.15, +0.48] | better
| Event phase: qualification match number: q11-25 | 5,692 | −9.13 [−12.59, −5.54] | −23.48 [−32.19, −14.28] | −0.09 [−0.40, +0.21] | better
| Event phase: qualification match number: q26+ | 2,185 | −11.01 [−17.04, −5.01] | −29.30 [−43.79, −14.75] | +0.09 [−0.35, +0.54] | better
| Event phase: robot's event of the season (lowest on the field): 1st | 9,311 | −8.05 [−10.68, −5.34] | −21.72 [−28.22, −15.28] | +0.02 [−0.24, +0.27] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 3,768 | −8.52 [−13.00, −3.83] | −21.12 [−32.48, −9.03] | +0.24 [−0.14, +0.64] | better
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 2,312 | −6.10 [−11.80, −0.20] | −17.84 [−31.83, −2.89] | −0.09 [−0.61, +0.44] | better
| Team experience (least experienced robot): rookie | 4,543 | −9.18 [−12.96, −5.28] | −24.80 [−34.52, −14.93] | −0.02 [−0.37, +0.32] | better
| Team experience (least experienced robot): unknown | 5,057 | −9.23 [−12.90, −5.18] | −24.38 [−33.55, −14.38] | +0.28 [−0.04, +0.61] | better
| Team experience (least experienced robot): veteran | 1,501 | −6.32 [−12.80, +0.35] | −13.95 [−30.86, +3.61] | −0.68 [−1.41, +0.07] |
| Team experience (least experienced robot): year2 | 4,290 | −5.42 [−9.05, −1.63] | −15.43 [−24.49, −6.20] | +0.14 [−0.17, +0.47] | better
| Rated matches this season (fewest on the field): 0-5 | 9,128 | −8.26 [−10.65, −5.71] | −21.43 [−27.41, −15.55] | +0.06 [−0.19, +0.31] | better
| Rated matches this season (fewest on the field): 16+ | 1,030 | −6.99 [−15.54, +0.93] | −19.97 [−40.52, +0.07] | +0.00 [−0.93, +0.89] |
| Rated matches this season (fewest on the field): 6-15 | 5,233 | −7.37 [−11.25, −3.38] | −20.43 [−30.44, −10.41] | +0.08 [−0.23, +0.40] | better
| Data density (all four robots' rated matches): dense | 2,119 | −5.87 [−12.16, +0.75] | −16.96 [−33.12, +0.44] | +0.05 [−0.48, +0.61] |
| Data density (all four robots' rated matches): normal | 6,759 | −7.97 [−11.32, −4.45] | −22.30 [−30.85, −13.71] | +0.04 [−0.22, +0.32] | better
| Data density (all four robots' rated matches): thin | 6,513 | −8.42 [−11.31, −5.34] | −20.94 [−27.80, −13.94] | +0.08 [−0.22, +0.36] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 4,388 | −9.58 [−12.92, −6.53] | −24.08 [−31.99, −16.92] | +0.05 [−0.35, +0.42] | better
| Volatility (residual variance, robots with 6+ matches): rest | 8,252 | −6.73 [−9.88, −3.62] | −17.94 [−25.80, −9.87] | +0.14 [−0.11, +0.38] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 2,751 | −8.58 [−13.65, −3.09] | −25.20 [−38.07, −11.28] | −0.15 [−0.59, +0.30] | better
| Event size (teams): large | 1,702 | +0.62 [−6.18, +7.36] | +1.48 [−16.97, +19.55] | −0.42 [−1.21, +0.36] |
| Event size (teams): mid | 8,674 | −8.85 [−11.97, −5.64] | −23.49 [−30.98, −15.97] | +0.05 [−0.20, +0.30] | better
| Event size (teams): small | 5,015 | −9.06 [−11.92, −6.14] | −24.29 [−31.10, −17.25] | +0.24 [−0.06, +0.59] | better
| Event type: championship | 2,459 | −2.83 [−9.56, +3.71] | −7.38 [−23.82, +9.85] | −0.08 [−0.62, +0.43] |
| Event type: league meet | 4,861 | −9.08 [−12.02, −6.01] | −23.20 [−30.24, −15.81] | +0.15 [−0.18, +0.46] | better
| Event type: qualifier | 8,071 | −8.68 [−11.80, −5.69] | −23.81 [−31.15, −16.46] | +0.05 [−0.21, +0.31] | better
| Favourite's stated chance: 50-60 | 5,872 | −3.50 [−6.87, −0.35] | −7.23 [−14.15, −0.80] | +0.16 [−0.36, +0.66] | better
| Favourite's stated chance: 60-70 | 4,241 | −9.04 [−13.43, −4.55] | −20.53 [−30.32, −10.45] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 70-80 | 3,037 | −14.51 [−19.45, −9.29] | −38.50 [−52.08, −24.35] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 80-90 | 1,636 | −10.71 [−14.98, −6.11] | −44.67 [−61.69, −26.32] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 90-100 | 605 | −1.13 [−4.32, +2.24] | −5.87 [−32.86, +23.17] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 5,579 | 54.3% | 55.0% | 0.7% | 0.0% |
| 60-70% | 4,156 | 64.8% | 67.5% | 2.7% | 2.5% |
| 70-80% | 3,104 | 74.7% | 78.9% | 4.2% | 3.9% |
| 80-90% | 1,811 | 84.4% | 87.4% | 3.1% | 2.4% |
| 90-100% | 741 | 93.7% | 95.0% | 1.3% | 0.0% |

## 2020–21

Calibration error in the 50–80% bands (match-weighted): champion 7.99 pts, challenger 6.22 pts. Regressions beyond noise: probBand: 60-70 (low n).

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 564 | +1.97 [−10.46, +14.88] | +20.80 [−20.11, +67.87] | +0.00 [−1.00, +0.99] |
| Match type: playoff | 116 | +8.08 [−13.78, +33.80] | +16.16 [−59.36, +103.31] | +0.00 [+0.00, +0.00] | ⚠ low n
| Match type: qual | 448 | +0.39 [−17.25, +17.71] | +22.01 [−35.28, +85.24] | +0.00 [−1.18, +1.26] |
| Event phase: qualification match number: playoff | 116 | +8.08 [−13.78, +33.80] | +16.16 [−59.36, +103.31] | +0.00 [+0.00, +0.00] | ⚠ low n
| Event phase: qualification match number: q1-10 | 219 | +5.94 [−17.70, +28.68] | +47.33 [−32.62, +130.83] | −0.95 [−3.29, +1.00] |
| Event phase: qualification match number: q11-25 | 193 | +0.84 [−34.62, +40.76] | +17.30 [−90.38, +155.75] | +1.04 [−0.98, +3.11] | ⚠ low n
| Event phase: qualification match number: q26+ | 36 | −35.78 [−69.81, +2.99] | −106.81 [−203.98, −10.07] | +0.00 [+0.00, +0.00] | ⚠ low n
| Event phase: robot's event of the season (lowest on the field): 1st | 395 | +6.91 [−8.12, +26.85] | +44.09 [−15.15, +120.61] | −0.26 [−1.61, +1.06] |
| Event phase: robot's event of the season (lowest on the field): 2nd | 73 | −12.46 [−52.55, +31.42] | −62.40 [−148.07, +36.95] | +1.43 [+0.00, +4.44] | ⚠ low n
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 96 | −7.35 [−31.90, +22.60] | −11.74 [−87.95, +59.48] | +0.00 [+0.00, +0.00] | ⚠ low n
| Team experience (least experienced robot): rookie | 215 | +1.72 [−18.48, +27.82] | +52.26 [−17.94, +142.51] | +1.42 [+0.00, +2.77] |
| Team experience (least experienced robot): unknown | 101 | +19.78 [−1.25, +43.68] | +16.43 [−35.65, +81.00] | −3.00 [−5.56, +0.00] | ⚠ low n
| Team experience (least experienced robot): veteran | 65 | −13.71 [−39.30, +19.09] | −59.91 [−120.46, +27.75] | +1.56 [+0.00, +5.71] | ⚠ low n
| Team experience (least experienced robot): year2 | 183 | −1.99 [−36.36, +25.65] | +14.93 [−82.83, +106.74] | −0.56 [−3.51, +2.45] | ⚠ low n
| Rated matches this season (fewest on the field): 0-5 | 339 | +6.60 [−10.63, +30.29] | +44.52 [−26.65, +139.35] | −0.30 [−1.88, +1.24] |
| Rated matches this season (fewest on the field): 16+ | 63 | −14.59 [−39.19, +18.12] | −52.63 [−129.14, +24.32] | +0.00 [+0.00, +0.00] | ⚠ low n
| Rated matches this season (fewest on the field): 6-15 | 162 | −1.27 [−23.89, +23.41] | −0.27 [−63.12, +61.98] | +0.63 [+0.00, +1.99] | ⚠ low n
| Data density (all four robots' rated matches): dense | 151 | −0.12 [−23.93, +23.10] | +45.99 [−42.29, +129.11] | +0.00 [+0.00, +0.00] | ⚠ low n
| Data density (all four robots' rated matches): normal | 171 | +8.37 [−11.69, +28.82] | +24.10 [−62.17, +131.39] | +0.00 [−2.33, +2.70] | ⚠ low n
| Data density (all four robots' rated matches): thin | 242 | −1.24 [−22.40, +24.11] | +2.76 [−53.29, +62.07] | +0.00 [−2.36, +2.03] |
| Volatility (residual variance, robots with 6+ matches): not measured | 207 | −4.51 [−30.26, +24.83] | +0.56 [−70.69, +72.91] | +0.50 [−1.80, +2.75] |
| Volatility (residual variance, robots with 6+ matches): rest | 267 | +6.85 [−11.94, +22.10] | +37.42 [−26.07, +98.11] | −0.38 [−1.65, +0.88] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 90 | +2.40 [−23.90, +27.33] | +18.07 [−76.45, +121.12] | +0.00 [+0.00, +0.00] | ⚠ low n
| Event size (teams): mid | 304 | −3.26 [−12.91, +7.66] | +6.41 [−26.14, +47.14] | +0.00 [−1.32, +1.33] |
| Event size (teams): small | 260 | +8.09 [−18.09, +30.84] | +37.63 [−47.46, +122.66] | +0.00 [−1.64, +1.65] |
| Event type: championship | 204 | −1.96 [−15.59, +12.15] | +5.79 [−28.42, +52.62] | +0.00 [−1.51, +1.47] |
| Event type: league meet | 81 | −2.03 [−44.75, +36.86] | −17.54 [−127.21, +86.76] | −1.27 [−5.43, +2.78] | ⚠ low n
| Event type: qualifier | 279 | +6.01 [−13.79, +27.54] | +42.91 [−27.01, +120.02] | +0.36 [−0.76, +1.61] |
| Favourite's stated chance: 50-60 | 122 | −39.85 [−78.83, +7.16] | −81.03 [−159.99, +14.25] | +0.00 [−4.85, +4.26] | ⚠ low n
| Favourite's stated chance: 60-70 | 96 | +54.02 [+4.23, +105.69] | +123.02 [+13.15, +238.22] | +0.00 [+0.00, +0.00] | **regression** ⚠ low n
| Favourite's stated chance: 70-80 | 93 | −3.72 [−44.60, +31.92] | −7.58 [−115.39, +91.69] | +0.00 [+0.00, +0.00] | ⚠ low n
| Favourite's stated chance: 80-90 | 106 | −1.44 [−27.40, +23.42] | +16.52 [−94.96, +128.95] | +0.00 [+0.00, +0.00] | ⚠ low n
| Favourite's stated chance: 90-100 | 147 | +8.76 [−3.42, +21.31] | +59.61 [−36.57, +153.00] | +0.00 [+0.00, +0.00] | ⚠ low n

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% ⚠ low n | 112 | 54.2% | 56.3% | 2.1% | 1.2% |
| 60-70% ⚠ low n | 92 | 64.5% | 52.7% | 11.8% | 12.3% |
| 70-80% ⚠ low n | 97 | 75.3% | 69.6% | 5.7% | 5.4% |
| 80-90% ⚠ low n | 91 | 85.2% | 83.0% | 2.2% | 2.0% |
| 90-100% ⚠ low n | 172 | 95.6% | 92.4% | 3.1% | 2.6% |

## 2021–22

Calibration error in the 50–80% bands (match-weighted): champion 1.40 pts, challenger 0.60 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 13,239 | −2.77 [−5.61, +0.11] | −6.86 [−14.12, +0.63] | −0.03 [−0.27, +0.21] |
| Match type: playoff | 1,093 | −5.60 [−14.44, +2.34] | −16.28 [−40.31, +7.22] | −0.46 [−1.11, +0.18] |
| Match type: qual | 12,146 | −2.51 [−5.50, +0.49] | −6.01 [−13.82, +2.07] | +0.01 [−0.23, +0.26] |
| Event phase: qualification match number: playoff | 1,093 | −5.60 [−14.44, +2.34] | −16.28 [−40.31, +7.22] | −0.46 [−1.11, +0.18] |
| Event phase: qualification match number: q1-10 | 5,849 | −5.02 [−9.50, −0.66] | −12.12 [−23.60, −0.70] | +0.03 [−0.31, +0.42] | better
| Event phase: qualification match number: q11-25 | 4,742 | −0.73 [−5.16, +3.71] | −1.59 [−13.73, +10.23] | +0.04 [−0.30, +0.40] |
| Event phase: qualification match number: q26+ | 1,555 | +1.52 [−5.35, +9.60] | +3.53 [−13.93, +24.42] | −0.19 [−1.03, +0.74] |
| Event phase: robot's event of the season (lowest on the field): 1st | 6,737 | −4.67 [−8.94, −0.47] | −10.52 [−21.37, +0.39] | +0.10 [−0.25, +0.45] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 3,269 | −3.39 [−8.29, +1.88] | −9.34 [−22.49, +4.99] | +0.03 [−0.40, +0.50] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 3,233 | +1.83 [−3.94, +7.33] | +3.29 [−12.70, +17.87] | −0.37 [−0.79, +0.03] |
| Team experience (least experienced robot): rookie | 5,613 | −4.66 [−8.95, −0.26] | −11.50 [−23.05, +0.41] | −0.02 [−0.35, +0.31] | better
| Team experience (least experienced robot): unknown | 1 | −33.65 [−33.65, −33.65] | −67.44 [−67.44, −67.44] | +0.00 [+0.00, +0.00] | better ⚠ low n
| Team experience (least experienced robot): veteran | 5,918 | −0.98 [−5.06, +3.24] | −1.88 [−12.40, +9.00] | −0.07 [−0.45, +0.29] |
| Team experience (least experienced robot): year2 | 1,707 | −2.72 [−10.04, +4.87] | −8.79 [−27.67, +11.54] | +0.06 [−0.47, +0.56] |
| Rated matches this season (fewest on the field): 0-5 | 6,978 | −3.83 [−8.02, +0.16] | −8.12 [−18.71, +1.97] | +0.17 [−0.17, +0.50] |
| Rated matches this season (fewest on the field): 16+ | 1,563 | +5.37 [−2.61, +12.62] | +11.94 [−8.88, +32.55] | −0.32 [−0.93, +0.27] |
| Rated matches this season (fewest on the field): 6-15 | 4,698 | −3.89 [−7.90, +0.63] | −11.23 [−22.56, +0.71] | −0.24 [−0.58, +0.11] |
| Data density (all four robots' rated matches): dense | 2,561 | +2.14 [−3.36, +8.10] | +2.21 [−12.23, +17.57] | −0.31 [−0.93, +0.30] |
| Data density (all four robots' rated matches): normal | 5,649 | −3.68 [−7.51, +0.56] | −10.46 [−21.23, +1.43] | +0.02 [−0.31, +0.33] |
| Data density (all four robots' rated matches): thin | 5,029 | −4.24 [−9.57, +0.89] | −7.43 [−20.81, +5.61] | +0.06 [−0.34, +0.45] |
| Volatility (residual variance, robots with 6+ matches): not measured | 3,730 | −3.49 [−8.02, +1.11] | −4.19 [−15.54, +7.59] | +0.11 [−0.33, +0.54] |
| Volatility (residual variance, robots with 6+ matches): rest | 7,131 | −2.09 [−6.19, +1.95] | −7.25 [−18.17, +4.35] | +0.06 [−0.26, +0.36] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 2,378 | −3.67 [−10.39, +3.25] | −9.87 [−27.96, +7.83] | −0.51 [−1.15, +0.04] |
| Event size (teams): large | 2,193 | −5.88 [−14.06, +2.73] | −10.81 [−31.43, +10.94] | +0.18 [−0.44, +0.85] |
| Event size (teams): mid | 6,221 | −0.04 [−4.24, +4.13] | −1.29 [−12.85, +10.09] | −0.11 [−0.48, +0.21] |
| Event size (teams): small | 4,825 | −4.86 [−9.07, −0.45] | −12.24 [−23.58, −0.02] | −0.02 [−0.37, +0.30] | better
| Event type: championship | 1,963 | +0.82 [−5.73, +7.34] | +1.21 [−14.67, +17.31] | +0.26 [−0.24, +0.75] |
| Event type: league meet | 7,247 | −4.13 [−7.79, −0.45] | −10.41 [−20.07, −0.37] | +0.00 [−0.28, +0.28] | better
| Event type: qualifier | 3,693 | −1.28 [−7.85, +5.05] | −2.90 [−20.10, +14.59] | −0.27 [−0.78, +0.24] |
| Event type: world | 336 | −10.62 [−15.02, +0.95] | −20.86 [−33.44, +5.27] | +0.30 [−1.82, +2.40] |
| Favourite's stated chance: 50-60 | 3,880 | −1.87 [−7.50, +3.84] | −3.81 [−15.19, +7.86] | −0.10 [−0.87, +0.67] |
| Favourite's stated chance: 60-70 | 3,069 | −5.45 [−11.80, +0.82] | −12.33 [−26.73, +1.63] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 2,700 | −4.86 [−10.86, +1.46] | −13.69 [−30.05, +3.30] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 2,236 | +0.55 [−4.28, +5.57] | +1.24 [−18.56, +21.76] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 1,354 | −0.56 [−2.87, +1.72] | −2.93 [−22.83, +17.24] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 3,699 | 54.7% | 55.1% | 0.4% | 0.1% |
| 60-70% | 2,952 | 64.9% | 65.8% | 0.9% | 0.8% |
| 70-80% | 2,662 | 74.8% | 75.3% | 0.5% | 0.3% |
| 80-90% | 2,324 | 84.8% | 84.9% | 0.1% | 0.1% |
| 90-100% | 1,602 | 94.3% | 94.6% | 0.3% | 0.4% |

## 2022–23

Calibration error in the 50–80% bands (match-weighted): champion 1.59 pts, challenger 0.69 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 24,226 | −3.18 [−5.17, −1.17] | −8.47 [−14.30, −2.47] | −0.05 [−0.20, +0.11] | better
| Match type: playoff | 2,510 | −0.15 [−4.95, +4.80] | +2.49 [−13.30, +18.37] | −0.16 [−0.60, +0.28] |
| Match type: qual | 21,716 | −3.53 [−5.67, −1.27] | −9.74 [−16.09, −2.94] | −0.03 [−0.20, +0.13] | better
| Event phase: qualification match number: playoff | 2,510 | −0.15 [−4.95, +4.80] | +2.49 [−13.30, +18.37] | −0.16 [−0.60, +0.28] |
| Event phase: qualification match number: q1-10 | 8,976 | −6.17 [−10.04, −2.16] | −15.01 [−25.63, −4.11] | −0.02 [−0.30, +0.25] | better
| Event phase: qualification match number: q11-25 | 8,887 | −2.32 [−5.66, +0.95] | −7.13 [−17.58, +3.69] | −0.09 [−0.34, +0.16] |
| Event phase: qualification match number: q26+ | 3,853 | −0.20 [−4.67, +4.43] | −3.47 [−17.09, +9.86] | +0.08 [−0.23, +0.41] |
| Event phase: robot's event of the season (lowest on the field): 1st | 10,565 | −5.59 [−8.96, −2.07] | −16.27 [−26.12, −6.26] | −0.06 [−0.29, +0.17] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 5,827 | −3.45 [−7.42, +0.53] | −7.79 [−19.47, +4.17] | −0.07 [−0.37, +0.24] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 7,834 | +0.25 [−2.98, +3.42] | +1.55 [−8.08, +11.25] | −0.01 [−0.30, +0.30] |
| Team experience (least experienced robot): rookie | 11,591 | −2.95 [−6.09, +0.03] | −8.40 [−16.97, +0.14] | −0.06 [−0.27, +0.15] |
| Team experience (least experienced robot): veteran | 7,495 | −4.15 [−7.90, −0.32] | −10.42 [−21.86, +1.38] | −0.04 [−0.32, +0.24] | better
| Team experience (least experienced robot): year2 | 5,140 | −2.30 [−6.79, +2.31] | −5.79 [−18.26, +7.42] | −0.02 [−0.38, +0.34] |
| Rated matches this season (fewest on the field): 0-5 | 10,940 | −6.29 [−9.78, −2.83] | −17.90 [−27.70, −7.64] | −0.10 [−0.33, +0.13] | better
| Rated matches this season (fewest on the field): 16+ | 4,340 | +2.12 [−1.93, +6.37] | +7.90 [−4.69, +21.81] | +0.00 [−0.38, +0.37] |
| Rated matches this season (fewest on the field): 6-15 | 8,946 | −1.96 [−5.02, +1.32] | −4.88 [−14.58, +4.92] | +0.00 [−0.25, +0.23] |
| Data density (all four robots' rated matches): dense | 6,447 | +1.41 [−1.83, +4.52] | +8.37 [−2.87, +18.86] | −0.03 [−0.34, +0.27] |
| Data density (all four robots' rated matches): normal | 10,168 | −3.89 [−6.64, −1.08] | −12.25 [−20.69, −3.44] | +0.01 [−0.23, +0.24] | better
| Data density (all four robots' rated matches): thin | 7,611 | −6.13 [−10.80, −1.72] | −17.68 [−30.50, −5.31] | −0.13 [−0.40, +0.14] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 5,589 | −6.52 [−11.18, −1.70] | −17.54 [−30.53, −4.67] | −0.04 [−0.36, +0.29] | better
| Volatility (residual variance, robots with 6+ matches): rest | 13,977 | −1.42 [−4.04, +1.13] | −2.05 [−9.99, +6.12] | −0.08 [−0.27, +0.12] |
| Volatility (residual variance, robots with 6+ matches): top quartile | 4,660 | −4.47 [−9.01, +0.35] | −16.83 [−29.59, −3.74] | +0.04 [−0.29, +0.39] |
| Event size (teams): large | 6,408 | −2.99 [−6.82, +0.97] | −10.89 [−22.69, +1.89] | +0.28 [−0.02, +0.57] |
| Event size (teams): mid | 12,958 | −3.52 [−6.15, −0.76] | −7.31 [−15.35, +1.26] | −0.10 [−0.30, +0.11] | better
| Event size (teams): small | 4,860 | −2.55 [−7.20, +2.32] | −8.38 [−21.85, +5.21] | −0.33 [−0.66, +0.04] |
| Event type: championship | 3,611 | −0.72 [−4.77, +3.38] | −1.47 [−11.57, +8.81] | +0.08 [−0.38, +0.54] |
| Event type: league meet | 10,174 | −7.62 [−10.77, −4.41] | −21.91 [−31.48, −12.14] | +0.01 [−0.23, +0.26] | better
| Event type: qualifier | 9,882 | −0.23 [−3.27, +2.87] | +0.17 [−8.93, +9.95] | −0.18 [−0.41, +0.05] |
| Event type: world | 559 | +9.46 [−5.40, +18.67] | +38.17 [−15.66, +80.90] | +0.54 [−0.44, +1.62] |
| Favourite's stated chance: 50-60 | 5,634 | −3.50 [−8.38, +1.52] | −7.31 [−17.27, +3.04] | −0.20 [−0.86, +0.46] |
| Favourite's stated chance: 60-70 | 5,373 | −3.33 [−8.66, +1.93] | −7.75 [−19.88, +4.24] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 4,804 | −4.38 [−9.71, +0.79] | −13.34 [−28.03, +1.10] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 4,595 | −3.48 [−6.97, +0.27] | −10.72 [−26.23, +5.49] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 3,820 | −0.66 [−2.13, +1.05] | −2.37 [−17.02, +14.36] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 5,254 | 54.8% | 56.6% | 1.8% | 1.6% |
| 60-70% | 5,136 | 65.0% | 65.0% | 0.0% | 0.0% |
| 70-80% | 4,738 | 75.0% | 74.9% | 0.1% | 0.1% |
| 80-90% | 4,677 | 85.0% | 85.8% | 0.7% | 0.8% |
| 90-100% | 4,421 | 94.8% | 94.3% | 0.5% | 0.7% |

## 2023–24

Calibration error in the 50–80% bands (match-weighted): champion 0.74 pts, challenger 0.27 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 28,075 | −3.73 [−5.92, −1.57] | −9.68 [−15.64, −3.78] | +0.18 [+0.01, +0.34] | better
| Match type: playoff | 2,969 | −1.55 [−6.52, +3.24] | −3.91 [−19.76, +11.38] | −0.20 [−0.48, +0.07] |
| Match type: qual | 25,106 | −3.99 [−6.44, −1.61] | −10.37 [−16.77, −3.98] | +0.22 [+0.04, +0.42] | better
| Event phase: qualification match number: playoff | 2,969 | −1.55 [−6.52, +3.24] | −3.91 [−19.76, +11.38] | −0.20 [−0.48, +0.07] |
| Event phase: qualification match number: q1-10 | 10,431 | −4.87 [−8.81, −0.60] | −13.96 [−24.65, −3.03] | +0.26 [−0.04, +0.57] | better
| Event phase: qualification match number: q11-25 | 10,412 | −3.26 [−6.55, +0.03] | −5.79 [−15.16, +3.83] | +0.22 [−0.05, +0.49] |
| Event phase: qualification match number: q26+ | 4,263 | −3.64 [−8.63, +1.36] | −12.77 [−27.44, +2.53] | +0.14 [−0.25, +0.53] |
| Event phase: robot's event of the season (lowest on the field): 1st | 12,415 | −5.98 [−9.72, −2.15] | −13.99 [−24.21, −3.46] | +0.38 [+0.11, +0.64] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 6,952 | −3.60 [−7.88, +0.69] | −12.65 [−25.08, −1.29] | −0.06 [−0.39, +0.30] |
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 8,708 | −0.64 [−3.81, +2.77] | −1.17 [−10.74, +8.78] | +0.08 [−0.22, +0.36] |
| Team experience (least experienced robot): rookie | 15,029 | −2.52 [−5.69, +0.51] | −7.02 [−15.59, +1.10] | +0.21 [−0.03, +0.45] |
| Team experience (least experienced robot): veteran | 7,416 | −5.22 [−9.22, −1.03] | −12.28 [−23.42, −1.06] | +0.14 [−0.20, +0.48] | better
| Team experience (least experienced robot): year2 | 5,630 | −5.04 [−9.83, −0.27] | −13.37 [−26.37, −0.32] | +0.16 [−0.18, +0.52] | better
| Rated matches this season (fewest on the field): 0-5 | 12,833 | −5.65 [−9.32, −1.86] | −13.58 [−23.40, −3.18] | +0.38 [+0.11, +0.63] | better
| Rated matches this season (fewest on the field): 16+ | 4,861 | +0.91 [−3.01, +5.20] | +4.71 [−7.77, +17.80] | +0.02 [−0.37, +0.42] |
| Rated matches this season (fewest on the field): 6-15 | 10,381 | −3.54 [−6.91, −0.35] | −11.61 [−20.65, −3.00] | +0.01 [−0.25, +0.25] | better
| Data density (all four robots' rated matches): dense | 7,119 | −0.94 [−4.58, +2.60] | −0.57 [−11.45, +10.29] | +0.08 [−0.24, +0.40] |
| Data density (all four robots' rated matches): normal | 11,776 | −5.12 [−8.08, −2.06] | −17.42 [−25.70, −9.13] | +0.09 [−0.14, +0.32] | better
| Data density (all four robots' rated matches): thin | 9,180 | −4.13 [−8.76, +0.56] | −6.83 [−18.79, +5.63] | +0.36 [+0.03, +0.67] |
| Volatility (residual variance, robots with 6+ matches): not measured | 6,533 | −1.00 [−6.18, +3.91] | +2.61 [−10.94, +15.93] | +0.48 [+0.13, +0.83] |
| Volatility (residual variance, robots with 6+ matches): rest | 16,156 | −4.10 [−6.83, −1.28] | −12.00 [−19.80, −4.27] | +0.11 [−0.11, +0.32] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 5,386 | −5.96 [−10.65, −1.22] | −17.63 [−30.87, −4.95] | +0.04 [−0.31, +0.41] | better
| Event size (teams): large | 6,510 | −0.43 [−4.76, +4.18] | +1.58 [−11.13, +14.12] | +0.09 [−0.26, +0.44] |
| Event size (teams): mid | 15,470 | −5.27 [−8.18, −2.33] | −14.99 [−22.85, −7.06] | +0.22 [−0.01, +0.45] | better
| Event size (teams): small | 6,095 | −3.36 [−8.82, +1.78] | −8.24 [−23.15, +6.23] | +0.17 [−0.17, +0.48] |
| Event type: championship | 4,378 | +1.43 [−3.04, +6.25] | +10.66 [−2.20, +23.99] | +0.16 [−0.30, +0.57] |
| Event type: league meet | 11,683 | −5.86 [−9.21, −2.58] | −18.23 [−26.80, −9.61] | +0.21 [−0.06, +0.47] | better
| Event type: qualifier | 11,417 | −3.46 [−6.99, +0.28] | −8.93 [−18.87, +1.66] | +0.17 [−0.11, +0.43] |
| Event type: world | 597 | −5.25 [−22.74, +14.97] | −6.08 [−52.29, +43.66] | +0.00 [−0.94, +0.41] |
| Favourite's stated chance: 50-60 | 6,866 | −5.77 [−11.17, −0.27] | −11.46 [−22.51, −0.21] | +0.74 [+0.04, +1.42] | better
| Favourite's stated chance: 60-70 | 6,215 | −3.49 [−9.20, +2.11] | −7.63 [−20.67, +4.94] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 70-80 | 5,605 | −2.99 [−8.28, +2.54] | −8.32 [−23.31, +6.98] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 80-90 | 4,909 | −4.86 [−8.54, −1.18] | −20.72 [−36.43, −5.32] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 90-100 | 4,480 | −0.66 [−1.97, +0.74] | +0.58 [−12.15, +14.98] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,340 | 54.9% | 54.8% | 0.1% | 0.2% |
| 60-70% | 5,962 | 64.9% | 64.3% | 0.5% | 0.7% |
| 70-80% | 5,507 | 74.9% | 75.1% | 0.2% | 0.1% |
| 80-90% | 5,086 | 84.9% | 85.5% | 0.5% | 0.5% |
| 90-100% | 5,180 | 95.0% | 94.4% | 0.6% | 0.6% |

## 2024–25 (tuning)

Calibration error in the 50–80% bands (match-weighted): champion 1.44 pts, challenger 0.76 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 33,271 | −6.45 [−8.49, −4.38] | −15.11 [−20.98, −8.81] | +0.16 [+0.03, +0.31] | better
| Match type: playoff | 4,386 | −1.83 [−5.94, +2.41] | −5.22 [−18.93, +8.72] | −0.09 [−0.37, +0.16] |
| Match type: qual | 28,885 | −7.16 [−9.36, −4.84] | −16.61 [−23.36, −9.88] | +0.20 [+0.03, +0.37] | better
| Event phase: qualification match number: playoff | 4,386 | −1.83 [−5.94, +2.41] | −5.22 [−18.93, +8.72] | −0.09 [−0.37, +0.16] |
| Event phase: qualification match number: q1-10 | 10,927 | −6.79 [−10.71, −2.57] | −13.41 [−24.79, −1.33] | +0.29 [−0.01, +0.58] | better
| Event phase: qualification match number: q11-25 | 11,671 | −8.82 [−12.31, −5.32] | −21.69 [−31.41, −11.77] | +0.15 [−0.09, +0.38] | better
| Event phase: qualification match number: q26+ | 6,287 | −4.71 [−9.45, −0.10] | −12.75 [−28.13, +2.63] | +0.16 [−0.12, +0.45] | better
| Event phase: robot's event of the season (lowest on the field): 1st | 14,138 | −11.89 [−15.65, −8.26] | −29.15 [−39.90, −19.22] | +0.19 [−0.06, +0.43] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,049 | −4.39 [−7.99, −0.88] | −11.50 [−22.21, −0.72] | +0.33 [+0.07, +0.58] | better
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 11,084 | −1.02 [−4.01, +2.30] | +0.17 [−9.02, +9.94] | +0.02 [−0.20, +0.23] |
| Team experience (least experienced robot): rookie | 16,718 | −6.01 [−8.88, −3.09] | −11.39 [−19.98, −3.16] | +0.19 [−0.02, +0.40] | better
| Team experience (least experienced robot): veteran | 8,250 | −5.96 [−9.96, −1.64] | −15.21 [−26.94, −2.85] | +0.05 [−0.27, +0.34] | better
| Team experience (least experienced robot): year2 | 8,303 | −7.83 [−11.89, −3.95] | −22.51 [−34.40, −11.10] | +0.22 [−0.06, +0.49] | better
| Rated matches this season (fewest on the field): 0-5 | 14,202 | −11.64 [−15.51, −7.95] | −28.59 [−39.08, −17.76] | +0.23 [−0.01, +0.49] | better
| Rated matches this season (fewest on the field): 16+ | 6,847 | +1.78 [−1.97, +5.45] | +6.16 [−5.41, +17.24] | −0.13 [−0.40, +0.13] |
| Rated matches this season (fewest on the field): 6-15 | 12,222 | −5.04 [−8.06, −2.08] | −11.37 [−20.58, −2.40] | +0.25 [+0.06, +0.44] | better
| Data density (all four robots' rated matches): dense | 10,110 | +0.31 [−3.07, +3.76] | +5.46 [−5.42, +16.61] | −0.01 [−0.22, +0.20] |
| Data density (all four robots' rated matches): normal | 13,190 | −6.50 [−9.43, −3.46] | −17.10 [−26.26, −8.18] | +0.23 [+0.02, +0.44] | better
| Data density (all four robots' rated matches): thin | 9,971 | −13.25 [−17.86, −8.94] | −33.34 [−45.54, −21.23] | +0.25 [−0.07, +0.59] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 7,418 | −8.49 [−13.20, −3.77] | −22.34 [−34.97, −9.35] | +0.27 [−0.10, +0.65] | better
| Volatility (residual variance, robots with 6+ matches): rest | 19,389 | −6.41 [−9.01, −3.57] | −15.09 [−22.90, −6.78] | +0.05 [−0.13, +0.24] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 6,464 | −4.25 [−8.92, +0.46] | −6.89 [−21.10, +7.53] | +0.37 [+0.08, +0.64] |
| Event size (teams): large | 8,980 | −5.88 [−10.50, −1.84] | −13.67 [−27.00, −0.78] | +0.02 [−0.23, +0.26] | better
| Event size (teams): mid | 18,322 | −5.72 [−8.36, −2.84] | −12.54 [−20.56, −4.33] | +0.19 [+0.01, +0.38] | better
| Event size (teams): small | 5,969 | −9.57 [−14.30, −4.67] | −25.18 [−38.14, −11.56] | +0.29 [−0.07, +0.66] | better
| Event type: championship | 6,344 | −0.32 [−5.53, +4.86] | +6.33 [−9.20, +22.02] | −0.03 [−0.31, +0.23] |
| Event type: league meet | 12,322 | −10.52 [−13.68, −7.13] | −29.25 [−38.23, −19.53] | +0.16 [−0.09, +0.41] | better
| Event type: qualifier | 13,903 | −5.47 [−8.62, −2.12] | −12.16 [−21.01, −2.16] | +0.23 [+0.00, +0.47] | better
| Event type: world | 702 | −9.98 [−23.84, +4.24] | −19.08 [−61.56, +45.07] | +0.57 [−0.19, +1.15] |
| Favourite's stated chance: 50-60 | 6,846 | −11.61 [−17.61, −5.73] | −23.67 [−35.95, −11.65] | +0.80 [+0.06, +1.51] | better
| Favourite's stated chance: 60-70 | 6,517 | −13.21 [−18.82, −7.31] | −30.06 [−42.79, −16.73] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 70-80 | 6,053 | −6.23 [−11.59, −0.90] | −16.99 [−31.75, −2.06] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 80-90 | 6,247 | −1.58 [−5.38, +2.18] | −5.25 [−21.39, +10.53] | +0.00 [+0.00, +0.00] |
| Favourite's stated chance: 90-100 | 7,608 | −0.21 [−1.36, +1.12] | −1.20 [−12.57, +11.44] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,298 | 54.9% | 54.4% | 0.5% | 0.6% |
| 60-70% | 6,157 | 65.0% | 65.7% | 0.7% | 0.7% |
| 70-80% | 5,968 | 75.0% | 76.0% | 1.0% | 1.0% |
| 80-90% | 6,242 | 85.1% | 83.8% | 1.3% | 1.2% |
| 90-100% | 8,606 | 95.5% | 94.8% | 0.7% | 0.2% |

## 2025–26 (reused)

Calibration error in the 50–80% bands (match-weighted): champion 1.97 pts, challenger 0.89 pts. Regressions beyond noise: none.

| Slice | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy pp [95%] | |
|---|---|---|---|---|---|
| **all** | 36,842 | −9.31 [−11.60, −7.19] | −24.01 [−30.06, −18.11] | −0.04 [−0.20, +0.13] | better
| Match type: playoff | 5,117 | −8.53 [−14.16, −3.09] | −21.72 [−39.22, −4.71] | −0.16 [−0.52, +0.23] | better
| Match type: qual | 31,725 | −9.43 [−11.84, −7.04] | −24.37 [−31.22, −18.07] | −0.02 [−0.19, +0.16] | better
| Event phase: qualification match number: playoff | 5,117 | −8.53 [−14.16, −3.09] | −21.72 [−39.22, −4.71] | −0.16 [−0.52, +0.23] | better
| Event phase: qualification match number: q1-10 | 11,613 | −14.67 [−19.07, −10.35] | −35.86 [−47.02, −25.00] | −0.16 [−0.44, +0.16] | better
| Event phase: qualification match number: q11-25 | 12,697 | −7.83 [−11.42, −4.19] | −22.07 [−31.90, −12.17] | +0.17 [−0.06, +0.42] | better
| Event phase: qualification match number: q26+ | 7,415 | −3.99 [−8.69, +0.60] | −10.34 [−23.50, +3.07] | −0.15 [−0.53, +0.21] |
| Event phase: robot's event of the season (lowest on the field): 1st | 15,597 | −12.89 [−16.93, −9.20] | −34.80 [−45.16, −24.75] | −0.03 [−0.28, +0.24] | better
| Event phase: robot's event of the season (lowest on the field): 2nd | 8,732 | −5.63 [−9.64, −1.30] | −15.01 [−26.20, −2.85] | −0.13 [−0.46, +0.21] | better
| Event phase: robot's event of the season (lowest on the field): 3rd+ | 12,513 | −7.41 [−10.66, −4.32] | −16.82 [−26.19, −8.25] | +0.00 [−0.25, +0.25] | better
| Team experience (least experienced robot): rookie | 17,177 | −9.24 [−12.38, −5.88] | −22.03 [−30.92, −13.09] | −0.12 [−0.36, +0.10] | better
| Team experience (least experienced robot): veteran | 10,384 | −9.98 [−14.16, −5.95] | −28.89 [−40.01, −18.19] | +0.16 [−0.12, +0.43] | better
| Team experience (least experienced robot): year2 | 9,281 | −8.68 [−12.87, −4.28] | −22.20 [−33.46, −9.88] | −0.11 [−0.40, +0.20] | better
| Rated matches this season (fewest on the field): 0-5 | 15,389 | −12.53 [−16.32, −8.90] | −32.72 [−42.13, −23.12] | +0.04 [−0.22, +0.29] | better
| Rated matches this season (fewest on the field): 16+ | 8,268 | −7.49 [−11.35, −3.75] | −17.94 [−28.30, −7.48] | −0.10 [−0.41, +0.22] | better
| Rated matches this season (fewest on the field): 6-15 | 13,185 | −6.68 [−10.10, −3.47] | −17.64 [−27.79, −8.54] | −0.10 [−0.35, +0.16] | better
| Data density (all four robots' rated matches): dense | 11,835 | −6.26 [−9.47, −2.95] | −15.15 [−24.28, −5.96] | −0.07 [−0.32, +0.18] | better
| Data density (all four robots' rated matches): normal | 14,138 | −10.50 [−13.76, −7.22] | −27.64 [−37.07, −18.46] | −0.04 [−0.29, +0.21] | better
| Data density (all four robots' rated matches): thin | 10,869 | −11.09 [−15.55, −6.64] | −28.92 [−40.42, −17.28] | −0.02 [−0.33, +0.27] | better
| Volatility (residual variance, robots with 6+ matches): not measured | 8,003 | −7.48 [−12.70, −2.16] | −19.65 [−32.86, −5.39] | +0.10 [−0.24, +0.45] | better
| Volatility (residual variance, robots with 6+ matches): rest | 21,629 | −9.61 [−12.24, −6.89] | −24.91 [−32.22, −17.26] | −0.10 [−0.31, +0.09] | better
| Volatility (residual variance, robots with 6+ matches): top quartile | 7,210 | −10.43 [−15.03, −5.29] | −26.14 [−39.58, −11.33] | −0.01 [−0.34, +0.30] | better
| Event size (teams): large | 10,439 | −6.86 [−10.86, −2.97] | −17.79 [−28.84, −6.31] | +0.10 [−0.20, +0.40] | better
| Event size (teams): mid | 20,568 | −8.30 [−10.99, −5.51] | −21.11 [−28.64, −13.59] | −0.18 [−0.38, +0.04] | better
| Event size (teams): small | 5,835 | −17.24 [−23.93, −10.70] | −45.32 [−61.96, −28.40] | +0.19 [−0.19, +0.60] | better
| Event type: championship | 7,650 | −7.48 [−11.94, −3.21] | −18.93 [−31.62, −6.97] | −0.18 [−0.52, +0.16] | better
| Event type: league meet | 12,338 | −9.99 [−13.67, −6.45] | −26.75 [−36.84, −17.09] | +0.27 [+0.02, +0.51] | better
| Event type: qualifier | 15,911 | −10.36 [−14.21, −6.65] | −26.03 [−36.16, −15.72] | −0.21 [−0.46, +0.06] | better
| Event type: world | 943 | +2.59 [−6.60, +12.51] | +4.97 [−16.95, +32.54] | −0.11 [−1.29, +1.00] |
| Favourite's stated chance: 50-60 | 8,761 | −10.95 [−16.33, −5.45] | −22.58 [−33.60, −11.31] | −0.16 [−0.83, +0.52] | better
| Favourite's stated chance: 60-70 | 8,258 | −13.13 [−18.52, −7.88] | −29.56 [−41.99, −17.70] | −0.01 [−0.05, +0.02] | better
| Favourite's stated chance: 70-80 | 7,299 | −10.68 [−15.58, −5.74] | −30.01 [−43.92, −16.13] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 80-90 | 6,785 | −8.74 [−12.10, −5.31] | −34.69 [−48.71, −20.26] | +0.00 [+0.00, +0.00] | better
| Favourite's stated chance: 90-100 | 5,739 | −0.22 [−1.70, +1.33] | +2.10 [−11.59, +16.45] | +0.00 [+0.00, +0.00] |

Challenger calibration:

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,141 | 55.0% | 55.5% | 0.5% | 0.5% |
| 60-70% | 7,862 | 65.0% | 65.5% | 0.6% | 0.5% |
| 70-80% | 7,234 | 75.0% | 76.7% | 1.7% | 1.7% |
| 80-90% | 6,951 | 85.0% | 86.0% | 1.0% | 1.0% |
| 90-100% | 6,654 | 94.9% | 94.7% | 0.2% | 0.3% |
