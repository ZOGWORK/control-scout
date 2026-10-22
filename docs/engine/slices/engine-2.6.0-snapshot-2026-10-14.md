# Engine error report: 2.6.0 on snapshot-2026-10-14

Generated 2026-10-22 by `scripts/engine-slices.ts`. Engine 2.6.0 (champion model `ctx-rel-form-2026-10-17-1fdd2958`). Data version 2026-10-14T04:19:58.853Z.

Every match is predicted from earlier results only, in the backtest ledger's order and with its exclusions. The replay is checked against the served prediction call (`explainMatch`) on 437 matches. Slices with fewer than 200 matches are marked ⚠ low n and are never ranked.

## Corpus

| Season | Events | Unrated events | Matches | Predicted | Predicted at rated events | Surrogate matches | sha256 (match list) |
|---|---|---|---|---|---|---|---|
| 2023–24 | 1208 | 486 | 30,983 | 30,702 | 28,075 | 817 | `7a365c4792e3f393…` |
| 2024–25 | 1296 | 532 | 37,399 | 36,557 | 33,271 | 872 | `94fbd00d97718c51…` |
| 2025–26 | 1454 | 634 | 42,474 | 41,743 | 36,842 | 1017 | `86a7ca9e42cddc1f…` |

## Global numbers

`champion` is the live engine; `v2.0` the frozen Engine 2.0 model on the same ratings (the live shadow); `legacy` Engine 1.x, the program's historical baseline (72.7%, Brier 0.179 on 2025–26). The champion's coefficients were fitted on 2023–24 and its calibration on spring 2025, so 2023–24 rows are in-sample for it. 2025–26 is its out-of-sample season, already examined for 2.0 and 2.1, hence **reused**: it sets priorities here and is not proof of any change.

| Season | Model | Matches | Accuracy | Brier | Log loss | ECE |
|---|---|---|---|---|---|---|
| 2023–24 | champion | 28,075 | 72.93% | 0.1743 | 0.5238 | 1.09% |
| 2023–24 | v2.0 | 28,075 | 72.82% | 0.1747 | 0.5247 | 0.95% |
| 2023–24 | legacy | 28,075 | 72.15% | 0.1796 | 0.5373 | 0.63% |
| 2024–25 | champion | 33,271 | 76.41% | 0.1578 | 0.4821 | 1.07% |
| 2024–25 | v2.0 | 33,271 | 76.24% | 0.1582 | 0.4836 | 1.00% |
| 2024–25 | legacy | 33,271 | 75.84% | 0.1619 | 0.4944 | 0.94% |
| 2025–26 (reused) | champion | 36,842 | 74.83% | 0.1682 | 0.5095 | 1.76% |
| 2025–26 (reused) | v2.0 | 36,842 | 74.64% | 0.1685 | 0.5104 | 1.35% |
| 2025–26 (reused) | legacy | 36,842 | 72.66% | 0.1791 | 0.5378 | 1.03% |

**Baseline check:** legacy on 2025–26 scores 72.66% and Brier 0.1791 over 36,842 matches, against the published 72.7% / 0.179: **reproduced**.

Matches at rated events only. Scrimmage and off-season events are predicted but never rated; their matches, on their own:

| Season | Model | Matches | Accuracy | Brier | Log loss |
|---|---|---|---|---|---|
| 2023–24 | champion | 2,627 | 63.60% | 0.2043 | 0.6075 |
| 2023–24 | v2.0 | 2,627 | 63.75% | 0.2049 | 0.6093 |
| 2023–24 | legacy | 2,627 | 63.09% | 0.2069 | 0.6175 |
| 2024–25 | champion | 3,286 | 65.92% | 0.2091 | 0.6130 |
| 2024–25 | v2.0 | 3,286 | 65.83% | 0.2092 | 0.6130 |
| 2024–25 | legacy | 3,286 | 65.52% | 0.2170 | 0.6449 |
| 2025–26 | champion | 4,901 | 65.96% | 0.2107 | 0.6235 |
| 2025–26 | v2.0 | 4,901 | 65.80% | 0.2110 | 0.6251 |
| 2025–26 | legacy | 4,901 | 65.34% | 0.2175 | 0.6519 |

## Where the champion loses most (2025–26 (reused))

Ranked by **excess Brier**: the Brier a slice carries above an average match, summed over its matches (Σ(Brier − corpus mean)). Only data slices compete, at most one per dimension: the dimensions overlap (thin data shows up as few matches, thin density and unmeasured volatility), and three views of one weakness would hide the next. Probability and margin bands are calibration diagnostics: a coin-flip band carries more Brier by construction.

| # | Slice | Excess Brier | Share of Brier | Share of matches |
|---|---|---|---|---|
| 1 | Data density (all four robots' rated matches): **thin** | +214.1 | 33.0% | 29.5% |
| 2 | Event phase: qualification match number: **q1-10** | +172.9 | 34.3% | 31.5% |
| 3 | Rated matches this season (fewest on the field): **0-5** | +151.1 | 44.2% | 41.8% |

**Surprise** is the mean of (p − y)² − p(1 − p) over decided matches (ties left out): the Brier above what the model's own probabilities expected. Above zero means the model is too sure in that slice; below zero means too timid. **Fav. stated → won** compares the favourite's mean stated chance with how often it won.

### Calibration by stated chance (champion, 2025–26 (reused))

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,762 | 55.0% | 56.5% | 1.5% | 1.5% |
| 60-70% | 8,266 | 64.9% | 66.6% | 1.6% | 1.6% |
| 70-80% | 7,288 | 75.0% | 77.8% | 2.8% | 2.8% |
| 80-90% | 6,786 | 84.9% | 87.3% | 2.3% | 2.3% |
| 90-100% | 5,740 | 94.8% | 95.1% | 0.3% | 0.1% |

### All slices (champion, 2025–26 (reused))

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.81% | 0.1575 | 0.4837 | −54.7 | 74.9% → 76.6% | −9.3‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.51% | 0.1699 | 0.5137 | +54.7 | 72.6% → 74.3% | −8.0‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.81% | 0.1575 | 0.4837 | −54.7 | 74.9% → 76.6% | −9.3‰ |
| q1-10 | 11,613 | 31.5% | 34.3% | 72.07% | 0.1830 | 0.5475 | +172.9 | 69.7% → 71.9% | −8.4‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.76% | 0.1635 | 0.4976 | −58.5 | 73.6% → 75.6% | −9.7‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.18% | 0.1601 | 0.4884 | −59.7 | 75.3% → 76.0% | −4.4‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.2% | 73.29% | 0.1755 | 0.5285 | +114.7 | 70.8% → 73.1% | −10.6‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 76.01% | 0.1626 | 0.4943 | −48.6 | 74.0% → 75.8% | −8.4‰ |
| 3rd+ | 12,513 | 34.0% | 32.9% | 75.91% | 0.1629 | 0.4966 | −66.1 | 74.6% → 75.7% | −5.0‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.89% | 0.1697 | 0.5133 | +25.8 | 72.8% → 74.7% | −7.1‰ |
| veteran | 10,384 | 28.2% | 27.9% | 75.03% | 0.1662 | 0.5044 | −20.5 | 73.1% → 74.9% | −9.2‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.48% | 0.1676 | 0.5082 | −5.3 | 72.8% → 74.3% | −9.1‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.2% | 72.81% | 0.1780 | 0.5345 | +151.1 | 70.5% → 72.6% | −10.0‰ |
| 16+ | 8,268 | 22.4% | 21.7% | 75.76% | 0.1629 | 0.4958 | −43.4 | 74.9% → 75.6% | −3.6‰ |
| 6-15 | 13,185 | 35.8% | 34.0% | 76.60% | 0.1600 | 0.4891 | −107.7 | 74.4% → 76.4% | −8.9‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.6% | 76.11% | 0.1603 | 0.4888 | −93.2 | 75.3% → 76.0% | −4.1‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.73% | 0.1596 | 0.4883 | −120.8 | 74.0% → 76.6% | −11.4‰ |
| thin | 10,869 | 29.5% | 33.0% | 70.95% | 0.1878 | 0.5597 | +214.1 | 68.7% → 70.7% | −8.5‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 69.99% | 0.1906 | 0.5661 | +179.7 | 68.2% → 69.8% | −8.3‰ |
| rest | 21,629 | 58.7% | 56.3% | 76.18% | 0.1613 | 0.4920 | −148.7 | 74.1% → 76.0% | −9.0‰ |
| top quartile | 7,210 | 19.6% | 19.1% | 76.11% | 0.1639 | 0.4995 | −31.0 | 74.4% → 76.0% | −5.6‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 75.51% | 0.1651 | 0.5007 | −32.2 | 73.6% → 75.4% | −8.1‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.48% | 0.1693 | 0.5122 | +23.0 | 73.0% → 74.3% | −6.7‰ |
| small | 5,835 | 15.8% | 16.0% | 74.84% | 0.1697 | 0.5160 | +9.3 | 71.2% → 74.6% | −13.7‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 75.14% | 0.1664 | 0.5033 | −13.1 | 74.2% → 75.0% | −3.4‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.70% | 0.1730 | 0.5224 | +59.5 | 71.6% → 73.5% | −9.8‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.60% | 0.1651 | 0.5026 | −47.9 | 73.1% → 75.4% | −10.0‰ |
| world | 943 | 2.6% | 2.6% | 74.04% | 0.1698 | 0.5090 | +1.6 | 75.0% → 74.0% | +3.8‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,762 | 23.8% | 34.3% | 56.59% | 0.2428 | 0.6844 | +653.7 | 55.0% → 56.5% | −1.1‰ |
| 60-70 | 8,266 | 22.4% | 29.3% | 66.74% | 0.2193 | 0.6352 | +423.1 | 64.9% → 66.6% | −5.7‰ |
| 70-80 | 7,288 | 19.8% | 20.1% | 77.97% | 0.1707 | 0.5291 | +18.7 | 75.0% → 77.8% | −15.3‰ |
| 80-90 | 6,786 | 18.4% | 12.1% | 87.41% | 0.1102 | 0.3810 | −393.4 | 84.9% → 87.3% | −16.9‰ |
| 90-100 | 5,740 | 15.6% | 4.2% | 95.15% | 0.0458 | 0.1888 | −702.1 | 94.8% → 95.1% | −3.2‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,545 | 50.3% | 56.1% | 72.18% | 0.1873 | 0.5619 | +355.8 | 70.2% → 72.0% | −9.6‰ |
| close | 8,171 | 22.2% | 30.2% | 61.88% | 0.2290 | 0.6545 | +496.9 | 59.4% → 61.8% | −5.0‰ |
| lopsided | 10,126 | 27.5% | 13.7% | 90.03% | 0.0839 | 0.2967 | −852.7 | 88.7% → 89.9% | −8.1‰ |

## Champion, 2023–24 (in-sample for the champion)

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+248.4); Rated matches this season (fewest on the field) **0-5** (+188.0); Event phase: qualification match number **q1-10** (+175.9)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,668 | 54.3% | 54.6% | 0.2% | 0.4% |
| 60-70% | 6,095 | 64.9% | 65.8% | 1.0% | 0.8% |
| 70-80% | 5,326 | 74.9% | 76.4% | 1.4% | 1.4% |
| 80-90% | 4,779 | 84.8% | 87.1% | 2.3% | 2.1% |
| 90-100% | 4,207 | 94.8% | 95.0% | 0.2% | 0.0% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.4% | 77.02% | 0.1556 | 0.4752 | −55.5 | 75.8% → 76.9% | −5.4‰ |
| qual | 25,106 | 89.4% | 90.6% | 72.44% | 0.1765 | 0.5295 | +55.5 | 71.3% → 72.3% | −5.7‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.4% | 77.02% | 0.1556 | 0.4752 | −55.5 | 75.8% → 76.9% | −5.4‰ |
| q1-10 | 10,431 | 37.2% | 40.7% | 69.18% | 0.1912 | 0.5654 | +175.9 | 68.1% → 69.0% | −4.4‰ |
| q11-25 | 10,412 | 37.1% | 35.8% | 74.33% | 0.1684 | 0.5100 | −62.0 | 73.2% → 74.1% | −6.7‰ |
| q26+ | 4,263 | 15.2% | 14.0% | 75.81% | 0.1606 | 0.4895 | −58.4 | 74.8% → 75.7% | −6.2‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 12,415 | 44.2% | 47.2% | 70.40% | 0.1859 | 0.5512 | +144.1 | 69.3% → 70.2% | −4.3‰ |
| 2nd | 6,952 | 24.8% | 24.1% | 73.79% | 0.1695 | 0.5135 | −33.6 | 72.9% → 73.6% | −6.6‰ |
| 3rd+ | 8,708 | 31.0% | 28.8% | 75.84% | 0.1616 | 0.4930 | −110.5 | 74.5% → 75.7% | −6.8‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 15,029 | 53.5% | 54.0% | 72.51% | 0.1757 | 0.5272 | +21.2 | 71.4% → 72.3% | −5.9‰ |
| veteran | 7,416 | 26.4% | 25.8% | 73.71% | 0.1702 | 0.5133 | −30.5 | 72.7% → 73.6% | −5.7‰ |
| year2 | 5,630 | 20.1% | 20.2% | 73.00% | 0.1760 | 0.5285 | +9.4 | 71.6% → 72.8% | −4.8‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 12,833 | 45.7% | 49.6% | 69.66% | 0.1890 | 0.5589 | +188.0 | 68.8% → 69.5% | −3.8‰ |
| 16+ | 4,861 | 17.3% | 16.1% | 75.70% | 0.1621 | 0.4934 | −59.2 | 75.0% → 75.6% | −3.5‰ |
| 6-15 | 10,381 | 37.0% | 34.3% | 75.67% | 0.1619 | 0.4946 | −128.8 | 74.0% → 75.5% | −8.9‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 7,119 | 25.4% | 23.1% | 76.36% | 0.1589 | 0.4865 | −109.5 | 75.5% → 76.2% | −4.2‰ |
| normal | 11,776 | 41.9% | 39.1% | 75.54% | 0.1625 | 0.4949 | −138.9 | 73.9% → 75.3% | −9.0‰ |
| thin | 9,180 | 32.7% | 37.8% | 66.91% | 0.2014 | 0.5898 | +248.4 | 66.3% → 66.7% | −2.4‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 6,533 | 23.3% | 27.5% | 65.58% | 0.2058 | 0.6007 | +205.5 | 64.5% → 65.4% | −4.1‰ |
| rest | 16,156 | 57.5% | 55.6% | 74.36% | 0.1686 | 0.5104 | −93.2 | 73.3% → 74.2% | −5.5‰ |
| top quartile | 5,386 | 19.2% | 16.9% | 77.51% | 0.1535 | 0.4708 | −112.4 | 76.0% → 77.4% | −7.8‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 6,510 | 23.2% | 23.3% | 73.03% | 0.1754 | 0.5275 | +7.2 | 72.7% → 72.9% | −1.2‰ |
| mid | 15,470 | 55.1% | 54.2% | 73.26% | 0.1715 | 0.5163 | −43.6 | 72.0% → 73.1% | −7.3‰ |
| small | 6,095 | 21.7% | 22.5% | 71.98% | 0.1803 | 0.5388 | +36.5 | 70.3% → 71.8% | −6.3‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 4,378 | 15.6% | 15.8% | 72.60% | 0.1765 | 0.5294 | +9.6 | 73.0% → 72.5% | +0.9‰ |
| league meet | 11,683 | 41.6% | 42.7% | 71.80% | 0.1789 | 0.5361 | +53.3 | 70.0% → 71.6% | −9.5‰ |
| qualifier | 11,417 | 40.7% | 39.6% | 73.99% | 0.1697 | 0.5113 | −53.2 | 72.9% → 73.8% | −4.4‰ |
| world | 597 | 2.1% | 1.9% | 77.22% | 0.1580 | 0.4806 | −9.7 | 76.0% → 77.2% | −2.5‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 7,668 | 27.3% | 38.3% | 54.61% | 0.2446 | 0.6877 | +539.1 | 54.3% → 54.6% | +0.2‰ |
| 60-70 | 6,095 | 21.7% | 27.6% | 66.01% | 0.2214 | 0.6401 | +286.9 | 64.9% → 65.8% | −3.5‰ |
| 70-80 | 5,326 | 19.0% | 19.3% | 76.57% | 0.1775 | 0.5437 | +17.1 | 74.9% → 76.4% | −8.6‰ |
| 80-90 | 4,779 | 17.0% | 10.8% | 87.26% | 0.1106 | 0.3816 | −304.4 | 84.8% → 87.1% | −17.1‰ |
| 90-100 | 4,207 | 15.0% | 4.0% | 95.14% | 0.0463 | 0.1929 | −538.6 | 94.8% → 95.0% | −2.6‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 13,347 | 47.5% | 52.8% | 71.43% | 0.1935 | 0.5763 | +255.4 | 69.8% → 71.3% | −7.4‰ |
| close | 7,132 | 25.4% | 35.0% | 56.53% | 0.2400 | 0.6783 | +468.5 | 56.5% → 56.5% | +0.5‰ |
| lopsided | 7,596 | 27.1% | 12.3% | 90.83% | 0.0790 | 0.2865 | −723.9 | 89.7% → 90.7% | −8.3‰ |

## Champion, 2024–25 (in-sample for the champion)

Top excess-Brier slices: Event phase: qualification match number **q1-10** (+187.7); Data density (all four robots' rated matches) **thin** (+171.7); Rated matches this season (fewest on the field) **0-5** (+114.5)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,941 | 54.9% | 54.9% | 0.0% | 0.1% |
| 60-70% | 6,573 | 65.0% | 67.1% | 2.1% | 2.1% |
| 70-80% | 6,081 | 75.0% | 77.3% | 2.4% | 2.3% |
| 80-90% | 6,174 | 85.1% | 85.4% | 0.3% | 0.4% |
| 90-100% | 7,502 | 95.3% | 95.4% | 0.2% | 0.4% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.31% | 0.1504 | 0.4630 | −32.6 | 76.3% → 78.1% | −7.4‰ |
| qual | 28,885 | 86.8% | 87.4% | 76.12% | 0.1589 | 0.4850 | +32.6 | 75.1% → 75.9% | −4.5‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.31% | 0.1504 | 0.4630 | −32.6 | 76.3% → 78.1% | −7.4‰ |
| q1-10 | 10,927 | 32.8% | 36.4% | 73.04% | 0.1750 | 0.5266 | +187.7 | 72.2% → 72.8% | −3.0‰ |
| q11-25 | 11,671 | 35.1% | 33.8% | 77.45% | 0.1521 | 0.4671 | −66.7 | 76.3% → 77.3% | −5.6‰ |
| q26+ | 6,287 | 18.9% | 17.2% | 78.99% | 0.1437 | 0.4457 | −88.4 | 77.9% → 78.8% | −5.1‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 14,138 | 42.5% | 44.1% | 75.12% | 0.1638 | 0.4981 | +85.5 | 73.5% → 74.9% | −7.8‰ |
| 2nd | 8,049 | 24.2% | 23.3% | 77.36% | 0.1522 | 0.4673 | −44.7 | 76.3% → 77.2% | −5.4‰ |
| 3rd+ | 11,084 | 33.3% | 32.5% | 77.36% | 0.1541 | 0.4724 | −40.8 | 76.8% → 77.2% | −0.8‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 16,718 | 50.2% | 51.1% | 75.92% | 0.1605 | 0.4901 | +44.5 | 74.9% → 75.7% | −3.9‰ |
| veteran | 8,250 | 24.8% | 24.5% | 76.85% | 0.1561 | 0.4772 | −14.1 | 75.3% → 76.7% | −6.4‰ |
| year2 | 8,303 | 25.0% | 24.4% | 76.95% | 0.1541 | 0.4707 | −30.4 | 75.9% → 76.8% | −5.4‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 14,202 | 42.7% | 44.9% | 74.71% | 0.1659 | 0.5034 | +114.5 | 73.0% → 74.5% | −7.8‰ |
| 16+ | 6,847 | 20.6% | 20.4% | 77.11% | 0.1563 | 0.4759 | −10.0 | 76.5% → 77.0% | −0.4‰ |
| 6-15 | 12,222 | 36.7% | 34.7% | 77.98% | 0.1492 | 0.4608 | −104.4 | 77.1% → 77.8% | −4.0‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 10,110 | 30.4% | 29.7% | 77.48% | 0.1542 | 0.4719 | −36.5 | 77.2% → 77.3% | +1.3‰ |
| normal | 13,190 | 39.6% | 37.1% | 78.27% | 0.1475 | 0.4561 | −135.3 | 76.9% → 78.1% | −7.1‰ |
| thin | 9,971 | 30.0% | 33.2% | 72.84% | 0.1750 | 0.5268 | +171.7 | 71.2% → 72.6% | −8.3‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 7,418 | 22.3% | 25.4% | 71.72% | 0.1796 | 0.5374 | +161.4 | 70.5% → 71.5% | −6.8‰ |
| rest | 19,389 | 58.3% | 55.6% | 77.92% | 0.1506 | 0.4643 | −139.0 | 76.6% → 77.7% | −5.5‰ |
| top quartile | 6,464 | 19.4% | 19.0% | 77.23% | 0.1543 | 0.4719 | −22.5 | 76.8% → 77.1% | −1.0‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 8,980 | 27.0% | 26.9% | 76.59% | 0.1574 | 0.4804 | −4.0 | 75.6% → 76.4% | −3.9‰ |
| mid | 18,322 | 55.1% | 55.1% | 76.35% | 0.1578 | 0.4824 | −0.4 | 75.4% → 76.1% | −4.0‰ |
| small | 5,969 | 17.9% | 18.0% | 76.31% | 0.1585 | 0.4838 | +4.4 | 74.2% → 76.1% | −9.2‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 6,344 | 19.1% | 19.5% | 76.58% | 0.1610 | 0.4897 | +20.3 | 76.1% → 76.4% | +1.9‰ |
| league meet | 12,322 | 37.0% | 36.8% | 76.53% | 0.1568 | 0.4807 | −12.8 | 74.3% → 76.3% | −10.7‰ |
| qualifier | 13,903 | 41.8% | 41.5% | 76.23% | 0.1569 | 0.4787 | −13.1 | 75.7% → 76.0% | −3.4‰ |
| world | 702 | 2.1% | 2.2% | 76.22% | 0.1658 | 0.5038 | +5.6 | 76.1% → 76.1% | +6.4‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 6,941 | 20.9% | 32.2% | 54.99% | 0.2433 | 0.6869 | +593.2 | 54.9% → 54.9% | +0.0‰ |
| 60-70 | 6,573 | 19.8% | 27.3% | 67.23% | 0.2182 | 0.6328 | +397.2 | 65.0% → 67.1% | −6.6‰ |
| 70-80 | 6,081 | 18.3% | 20.1% | 77.51% | 0.1733 | 0.5342 | +94.6 | 75.0% → 77.3% | −12.8‰ |
| 80-90 | 6,174 | 18.6% | 14.4% | 85.59% | 0.1227 | 0.4131 | −216.5 | 85.1% → 85.4% | −3.5‰ |
| 90-100 | 7,502 | 22.5% | 6.0% | 95.56% | 0.0420 | 0.1749 | −868.4 | 95.3% → 95.4% | −2.5‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 15,124 | 45.5% | 54.6% | 72.53% | 0.1895 | 0.5683 | +478.8 | 70.7% → 72.3% | −8.7‰ |
| close | 6,413 | 19.3% | 29.0% | 57.67% | 0.2375 | 0.6749 | +511.4 | 56.4% → 57.6% | −2.6‰ |
| lopsided | 11,734 | 35.3% | 16.4% | 91.52% | 0.0734 | 0.2656 | −990.2 | 91.4% → 91.4% | −1.3‰ |

## Baselines on 2025–26 (reused)

### v2.0

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+210.9); Event phase: qualification match number **q1-10** (+174.7); Rated matches this season (fewest on the field) **0-5** (+149.1)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,624 | 55.0% | 56.1% | 1.1% | 1.1% |
| 60-70% | 8,139 | 65.0% | 66.0% | 1.0% | 1.0% |
| 70-80% | 7,275 | 74.9% | 77.3% | 2.4% | 2.3% |
| 80-90% | 6,840 | 85.0% | 86.9% | 2.0% | 1.9% |
| 90-100% | 5,964 | 94.8% | 94.8% | 0.0% | 0.2% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.81% | 0.1572 | 0.4830 | −57.9 | 75.3% → 76.6% | −7.1‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.29% | 0.1703 | 0.5148 | +57.9 | 72.8% → 74.1% | −6.4‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.81% | 0.1572 | 0.4830 | −57.9 | 75.3% → 76.6% | −7.1‰ |
| q1-10 | 11,613 | 31.5% | 34.3% | 71.78% | 0.1836 | 0.5488 | +174.7 | 70.3% → 71.6% | −4.8‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.55% | 0.1640 | 0.4987 | −57.2 | 73.8% → 75.3% | −7.8‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.05% | 0.1605 | 0.4893 | −59.6 | 74.9% → 75.9% | −6.4‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.14% | 0.1756 | 0.5287 | +111.0 | 71.2% → 72.9% | −8.7‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 75.94% | 0.1629 | 0.4951 | −48.9 | 74.3% → 75.8% | −6.3‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.59% | 0.1636 | 0.4982 | −62.1 | 74.7% → 75.4% | −3.8‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.80% | 0.1699 | 0.5141 | +24.5 | 73.0% → 74.6% | −5.5‰ |
| veteran | 10,384 | 28.2% | 27.9% | 74.93% | 0.1665 | 0.5052 | −20.7 | 73.4% → 74.8% | −7.5‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.02% | 0.1681 | 0.5094 | −3.8 | 73.0% → 73.8% | −7.1‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.2% | 72.66% | 0.1782 | 0.5350 | +149.1 | 70.8% → 72.5% | −7.8‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.39% | 0.1635 | 0.4971 | −41.8 | 74.9% → 75.2% | −3.5‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.47% | 0.1604 | 0.4901 | −107.3 | 74.7% → 76.3% | −6.7‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 75.91% | 0.1610 | 0.4906 | −88.9 | 75.3% → 75.8% | −3.4‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.53% | 0.1599 | 0.4888 | −122.0 | 74.5% → 76.4% | −8.7‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.78% | 0.1879 | 0.5601 | +210.9 | 69.0% → 70.6% | −6.8‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 69.89% | 0.1908 | 0.5665 | +178.0 | 68.4% → 69.7% | −7.0‰ |
| rest | 21,629 | 58.7% | 56.3% | 76.03% | 0.1616 | 0.4927 | −150.1 | 74.4% → 75.8% | −7.1‰ |
| top quartile | 7,210 | 19.6% | 19.1% | 75.71% | 0.1646 | 0.5013 | −27.9 | 74.6% → 75.6% | −4.1‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 75.39% | 0.1656 | 0.5020 | −30.7 | 73.7% → 75.3% | −7.0‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.32% | 0.1696 | 0.5130 | +22.8 | 73.3% → 74.1% | −4.7‰ |
| small | 5,835 | 15.8% | 16.0% | 74.42% | 0.1699 | 0.5162 | +8.0 | 71.5% → 74.2% | −11.7‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 74.92% | 0.1669 | 0.5046 | −12.5 | 74.2% → 74.8% | −3.0‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.57% | 0.1732 | 0.5229 | +57.9 | 71.9% → 73.4% | −7.8‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.38% | 0.1655 | 0.5034 | −47.9 | 73.5% → 75.2% | −7.6‰ |
| world | 943 | 2.6% | 2.6% | 73.83% | 0.1711 | 0.5122 | +2.4 | 74.5% → 73.8% | +2.2‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,624 | 23.4% | 33.7% | 56.17% | 0.2427 | 0.6843 | +640.1 | 55.0% → 56.1% | −1.2‰ |
| 60-70 | 8,139 | 22.1% | 29.0% | 66.10% | 0.2212 | 0.6389 | +428.6 | 65.0% → 66.0% | −3.7‰ |
| 70-80 | 7,275 | 19.7% | 20.3% | 77.54% | 0.1731 | 0.5346 | +33.4 | 74.9% → 77.3% | −13.1‰ |
| 80-90 | 6,840 | 18.6% | 12.4% | 87.08% | 0.1126 | 0.3875 | −382.5 | 85.0% → 86.9% | −14.4‰ |
| 90-100 | 5,964 | 16.2% | 4.6% | 94.91% | 0.0479 | 0.1950 | −719.6 | 94.8% → 94.8% | −0.6‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,545 | 50.3% | 56.1% | 72.12% | 0.1877 | 0.5628 | +356.2 | 70.5% → 71.9% | −8.1‰ |
| close | 8,171 | 22.2% | 30.2% | 61.16% | 0.2296 | 0.6558 | +499.0 | 59.3% → 61.1% | −4.5‰ |
| lopsided | 10,126 | 27.5% | 13.7% | 90.03% | 0.0841 | 0.2971 | −855.3 | 89.1% → 89.9% | −5.0‰ |

### legacy

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+236.9); Rated matches this season (fewest on the field) **0-5** (+182.5); Event phase: qualification match number **q1-10** (+169.0)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,737 | 54.9% | 55.4% | 0.5% | 0.4% |
| 60-70% | 8,381 | 64.9% | 64.2% | 0.8% | 0.8% |
| 70-80% | 7,644 | 75.0% | 76.2% | 1.2% | 1.2% |
| 80-90% | 6,793 | 84.9% | 84.5% | 0.3% | 0.5% |
| 90-100% | 5,287 | 94.6% | 93.1% | 1.5% | 1.9% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 12.9% | 75.70% | 0.1659 | 0.5072 | −67.2 | 71.2% → 75.5% | −20.3‰ |
| qual | 31,725 | 86.1% | 87.1% | 72.17% | 0.1812 | 0.5428 | +67.2 | 72.8% → 72.0% | +4.0‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 12.9% | 75.70% | 0.1659 | 0.5072 | −67.2 | 71.2% → 75.5% | −20.3‰ |
| q1-10 | 11,613 | 31.5% | 34.1% | 69.87% | 0.1936 | 0.5748 | +169.0 | 71.5% → 69.7% | +10.5‰ |
| q11-25 | 12,697 | 34.5% | 34.0% | 72.90% | 0.1767 | 0.5312 | −30.3 | 73.3% → 72.7% | +1.9‰ |
| q26+ | 7,415 | 20.1% | 19.0% | 74.52% | 0.1694 | 0.5123 | −71.4 | 74.0% → 74.4% | −2.5‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.6% | 70.60% | 0.1886 | 0.5619 | +148.6 | 71.6% → 70.4% | +5.8‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 73.91% | 0.1731 | 0.5228 | −52.5 | 73.6% → 73.8% | +0.3‰ |
| 3rd+ | 12,513 | 34.0% | 32.5% | 74.36% | 0.1714 | 0.5183 | −96.1 | 73.0% → 74.2% | −5.6‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.1% | 72.50% | 0.1809 | 0.5417 | +30.8 | 72.7% → 72.3% | +3.2‰ |
| veteran | 10,384 | 28.2% | 27.9% | 73.10% | 0.1771 | 0.5340 | −20.2 | 72.5% → 72.9% | −2.1‰ |
| year2 | 9,281 | 25.2% | 25.0% | 72.49% | 0.1779 | 0.5350 | −10.6 | 72.4% → 72.3% | −1.2‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.5% | 70.04% | 0.1909 | 0.5676 | +182.5 | 71.8% → 69.9% | +9.0‰ |
| 16+ | 8,268 | 22.4% | 21.3% | 74.57% | 0.1702 | 0.5153 | −73.1 | 72.5% → 74.4% | −9.8‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 74.53% | 0.1708 | 0.5172 | −109.5 | 73.6% → 74.4% | −2.6‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.0% | 75.12% | 0.1674 | 0.5081 | −138.2 | 73.2% → 75.0% | −8.7‰ |
| normal | 14,138 | 38.4% | 36.9% | 74.24% | 0.1721 | 0.5206 | −98.7 | 73.7% → 74.1% | −0.6‰ |
| thin | 10,869 | 29.5% | 33.1% | 67.92% | 0.2009 | 0.5927 | +236.9 | 70.5% → 67.7% | +12.5‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.5% | 67.40% | 0.2020 | 0.5945 | +183.7 | 69.9% → 67.2% | +11.1‰ |
| rest | 21,629 | 58.7% | 56.3% | 74.15% | 0.1719 | 0.5196 | −155.8 | 73.0% → 74.0% | −4.6‰ |
| top quartile | 7,210 | 19.6% | 19.1% | 74.02% | 0.1752 | 0.5296 | −27.9 | 74.3% → 73.9% | +4.8‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 73.37% | 0.1755 | 0.5278 | −37.3 | 73.0% → 73.2% | −1.4‰ |
| mid | 20,568 | 55.8% | 56.2% | 72.48% | 0.1802 | 0.5404 | +22.4 | 72.7% → 72.3% | +2.4‰ |
| small | 5,835 | 15.8% | 16.1% | 72.06% | 0.1816 | 0.5466 | +14.9 | 71.4% → 71.8% | −1.8‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.2% | 73.80% | 0.1740 | 0.5247 | −38.7 | 72.9% → 73.7% | −3.5‰ |
| league meet | 12,338 | 33.5% | 34.7% | 71.20% | 0.1855 | 0.5536 | +79.7 | 71.8% → 71.0% | +3.8‰ |
| qualifier | 15,911 | 43.2% | 42.7% | 73.16% | 0.1769 | 0.5333 | −34.1 | 73.0% → 73.0% | +0.5‰ |
| world | 943 | 2.6% | 2.5% | 74.15% | 0.1717 | 0.5152 | −6.9 | 73.0% → 74.1% | −5.6‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,737 | 23.7% | 32.3% | 55.48% | 0.2436 | 0.6849 | +563.5 | 54.9% → 55.4% | −0.9‰ |
| 60-70 | 8,381 | 22.7% | 28.8% | 64.30% | 0.2264 | 0.6502 | +396.6 | 64.9% → 64.2% | +1.6‰ |
| 70-80 | 7,644 | 20.7% | 20.6% | 76.45% | 0.1782 | 0.5456 | −6.7 | 75.0% → 76.2% | −7.5‰ |
| 80-90 | 6,793 | 18.4% | 13.3% | 84.68% | 0.1290 | 0.4283 | −340.2 | 84.9% → 84.5% | +1.5‰ |
| 90-100 | 5,287 | 14.4% | 5.1% | 93.19% | 0.0631 | 0.2463 | −613.1 | 94.6% → 93.1% | +12.1‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,548 | 50.3% | 56.1% | 70.88% | 0.1994 | 0.5913 | +377.9 | 70.6% → 70.7% | −2.0‰ |
| close | 8,152 | 22.1% | 30.1% | 55.22% | 0.2438 | 0.6855 | +527.9 | 54.6% → 55.2% | −1.0‰ |
| lopsided | 10,142 | 27.5% | 13.8% | 89.85% | 0.0898 | 0.3213 | −905.8 | 90.6% → 89.7% | +6.7‰ |

## Live ledger

No scored live calls in this database matched the corpus.

## Definitions

- **Ties** score 0.5 for Brier and log loss and are left out of accuracy (a 50% call counts half).
- **Event phase**: the qualification match number at the event (playoffs separate), and the lowest season event ordinal among the four robots (any event with a predicted or played match counts, scrimmages included).
- **Experience**: from FIRST's rookie year; rookie = this season, year 2 = last season. Unknown rookie years rank just above veteran.
- **Rated matches / density**: the engine's own count of rated matches this season, before the match. Thin < 24 summed (under 6 per robot on average), dense ≥ 64 (16 or more).
- **Volatility**: the highest residual-variance EMA (engine reliability state, 1 = as variable as the model assumes) among robots with 6+ rated matches. The cut is the season's 75th percentile; it labels matches and never feeds a prediction.
- **Event size**: teams registered (or seen in matches). Small ≤ 16, mid 17–32, large 33+.
- **Margin**: |expected red − expected blue| over √(sd_red² + sd_blue²). Close < 0.25, clear < 1, lopsided ≥ 1.
- Playoff semifinal and final rounds are not split: the stored series numbers don't identify rounds consistently across seasons.
