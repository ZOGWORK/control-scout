# Engine error report: 2.7.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts`. Engine 2.7.0 (champion model `ctx-rel-form-2026-10-17-1fdd2958`). Data version 2026-10-14T04:19:58.853Z.

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
| 2024–25 | champion | 33,271 | 76.42% | 0.1576 | 0.4815 | 0.92% |
| 2024–25 | v2.0 | 33,271 | 76.28% | 0.1581 | 0.4832 | 0.89% |
| 2024–25 | legacy | 33,271 | 75.86% | 0.1616 | 0.4939 | 0.91% |
| 2025–26 (reused) | champion | 36,842 | 74.79% | 0.1679 | 0.5089 | 1.52% |
| 2025–26 (reused) | v2.0 | 36,842 | 74.62% | 0.1683 | 0.5099 | 1.18% |
| 2025–26 (reused) | legacy | 36,842 | 72.75% | 0.1787 | 0.5372 | 1.02% |

**Baseline check:** legacy on 2025–26 scores 72.75% and Brier 0.1787 over 36,842 matches, against the published 72.7% / 0.179: **reproduced**.

Matches at rated events only. Scrimmage and off-season events are predicted but never rated; their matches, on their own:

| Season | Model | Matches | Accuracy | Brier | Log loss |
|---|---|---|---|---|---|
| 2023–24 | champion | 2,627 | 63.60% | 0.2043 | 0.6075 |
| 2023–24 | v2.0 | 2,627 | 63.75% | 0.2049 | 0.6093 |
| 2023–24 | legacy | 2,627 | 63.09% | 0.2069 | 0.6175 |
| 2024–25 | champion | 3,286 | 66.04% | 0.2090 | 0.6129 |
| 2024–25 | v2.0 | 3,286 | 65.80% | 0.2092 | 0.6128 |
| 2024–25 | legacy | 3,286 | 65.55% | 0.2173 | 0.6464 |
| 2025–26 | champion | 4,901 | 66.00% | 0.2105 | 0.6233 |
| 2025–26 | v2.0 | 4,901 | 65.92% | 0.2110 | 0.6249 |
| 2025–26 | legacy | 4,901 | 65.59% | 0.2180 | 0.6537 |

## Where the champion loses most (2025–26 (reused))

Ranked by **excess Brier**: the Brier a slice carries above an average match, summed over its matches (Σ(Brier − corpus mean)). Only data slices compete, at most one per dimension: the dimensions overlap (thin data shows up as few matches, thin density and unmeasured volatility), and three views of one weakness would hide the next. Probability and margin bands are calibration diagnostics: a coin-flip band carries more Brier by construction.

| # | Slice | Excess Brier | Share of Brier | Share of matches |
|---|---|---|---|---|
| 1 | Data density (all four robots' rated matches): **thin** | +212.6 | 32.9% | 29.5% |
| 2 | Event phase: qualification match number: **q1-10** | +170.9 | 34.3% | 31.5% |
| 3 | Rated matches this season (fewest on the field): **0-5** | +146.5 | 44.1% | 41.8% |

**Surprise** is the mean of (p − y)² − p(1 − p) over decided matches (ties left out): the Brier above what the model's own probabilities expected. Above zero means the model is too sure in that slice; below zero means too timid. **Fav. stated → won** compares the favourite's mean stated chance with how often it won.

### Calibration by stated chance (champion, 2025–26 (reused))

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,597 | 55.0% | 56.2% | 1.2% | 1.2% |
| 60-70% | 8,174 | 64.9% | 66.2% | 1.3% | 1.2% |
| 70-80% | 7,309 | 74.9% | 77.4% | 2.5% | 2.4% |
| 80-90% | 6,867 | 84.9% | 87.2% | 2.2% | 2.2% |
| 90-100% | 5,895 | 94.8% | 95.0% | 0.2% | 0.0% |

### All slices (champion, 2025–26 (reused))

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.79% | 0.1574 | 0.4836 | −53.7 | 74.9% → 76.6% | −9.1‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.47% | 0.1696 | 0.5130 | +53.7 | 72.8% → 74.3% | −7.1‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.79% | 0.1574 | 0.4836 | −53.7 | 74.9% → 76.6% | −9.1‰ |
| q1-10 | 11,613 | 31.5% | 34.3% | 72.10% | 0.1826 | 0.5465 | +170.9 | 70.1% → 71.9% | −7.1‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.67% | 0.1633 | 0.4969 | −58.5 | 73.8% → 75.5% | −8.9‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.11% | 0.1600 | 0.4881 | −58.6 | 75.3% → 76.0% | −4.1‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.16% | 0.1750 | 0.5271 | +110.5 | 71.3% → 73.0% | −9.1‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 76.08% | 0.1625 | 0.4942 | −47.3 | 74.1% → 75.9% | −7.9‰ |
| 3rd+ | 12,513 | 34.0% | 32.9% | 75.92% | 0.1629 | 0.4966 | −63.2 | 74.7% → 75.7% | −5.0‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.1% | 74.86% | 0.1695 | 0.5129 | +27.0 | 73.0% → 74.7% | −6.3‰ |
| veteran | 10,384 | 28.2% | 27.8% | 75.16% | 0.1659 | 0.5037 | −20.9 | 73.3% → 75.0% | −8.5‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.26% | 0.1673 | 0.5074 | −6.1 | 73.0% → 74.0% | −8.3‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.70% | 0.1774 | 0.5330 | +146.5 | 70.9% → 72.5% | −8.4‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.79% | 0.1629 | 0.4957 | −41.7 | 74.9% → 75.6% | −3.7‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.60% | 0.1600 | 0.4891 | −104.8 | 74.5% → 76.4% | −8.6‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.19% | 0.1603 | 0.4888 | −90.7 | 75.3% → 76.0% | −4.1‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.68% | 0.1593 | 0.4875 | −121.9 | 74.2% → 76.5% | −10.9‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.80% | 0.1875 | 0.5588 | +212.6 | 69.2% → 70.6% | −6.6‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 69.95% | 0.1904 | 0.5655 | +179.7 | 68.6% → 69.7% | −6.4‰ |
| rest | 21,629 | 58.7% | 56.3% | 76.14% | 0.1611 | 0.4916 | −146.7 | 74.2% → 76.0% | −8.6‰ |
| top quartile | 7,210 | 19.6% | 19.0% | 76.09% | 0.1634 | 0.4980 | −33.0 | 74.6% → 76.0% | −5.1‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 75.52% | 0.1649 | 0.5003 | −31.3 | 73.7% → 75.4% | −7.6‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.38% | 0.1690 | 0.5116 | +23.2 | 73.2% → 74.2% | −5.8‰ |
| small | 5,835 | 15.8% | 16.0% | 74.94% | 0.1693 | 0.5150 | +8.1 | 71.5% → 74.7% | −12.8‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 75.14% | 0.1664 | 0.5032 | −11.7 | 74.3% → 75.0% | −3.1‰ |
| league meet | 12,338 | 33.5% | 34.5% | 73.87% | 0.1727 | 0.5218 | +59.5 | 71.8% → 73.7% | −9.0‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.37% | 0.1648 | 0.5018 | −49.3 | 73.4% → 75.2% | −8.9‰ |
| world | 943 | 2.6% | 2.6% | 74.26% | 0.1695 | 0.5082 | +1.5 | 75.0% → 74.2% | +3.4‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,597 | 23.3% | 33.7% | 56.29% | 0.2428 | 0.6845 | +643.5 | 55.0% → 56.2% | −1.1‰ |
| 60-70 | 8,174 | 22.2% | 29.1% | 66.36% | 0.2205 | 0.6376 | +429.6 | 64.9% → 66.2% | −4.6‰ |
| 70-80 | 7,309 | 19.8% | 20.4% | 77.63% | 0.1726 | 0.5331 | +34.0 | 74.9% → 77.4% | −13.7‰ |
| 80-90 | 6,867 | 18.6% | 12.3% | 87.31% | 0.1109 | 0.3828 | −391.7 | 84.9% → 87.2% | −16.2‰ |
| 90-100 | 5,895 | 16.0% | 4.4% | 95.07% | 0.0466 | 0.1915 | −715.4 | 94.8% → 95.0% | −2.6‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,452 | 50.1% | 56.0% | 72.02% | 0.1878 | 0.5627 | +367.6 | 70.3% → 71.8% | −8.9‰ |
| close | 8,053 | 21.9% | 29.7% | 61.74% | 0.2285 | 0.6538 | +488.0 | 59.4% → 61.6% | −5.1‰ |
| lopsided | 10,337 | 28.1% | 14.2% | 89.82% | 0.0852 | 0.3001 | −855.6 | 88.8% → 89.7% | −6.6‰ |

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

Top excess-Brier slices: Event phase: qualification match number **q1-10** (+189.7); Data density (all four robots' rated matches) **thin** (+169.7); Rated matches this season (fewest on the field) **0-5** (+111.6)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,799 | 54.9% | 54.9% | 0.0% | 0.1% |
| 60-70% | 6,456 | 65.0% | 66.5% | 1.5% | 1.5% |
| 70-80% | 6,116 | 74.9% | 77.2% | 2.3% | 2.2% |
| 80-90% | 6,227 | 85.1% | 85.0% | 0.0% | 0.0% |
| 90-100% | 7,673 | 95.3% | 95.4% | 0.1% | 0.4% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.43% | 0.1503 | 0.4627 | −32.0 | 76.4% → 78.2% | −7.3‰ |
| qual | 28,885 | 86.8% | 87.4% | 76.12% | 0.1587 | 0.4844 | +32.0 | 75.4% → 75.9% | −3.4‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.43% | 0.1503 | 0.4627 | −32.0 | 76.4% → 78.2% | −7.3‰ |
| q1-10 | 10,927 | 32.8% | 36.5% | 72.93% | 0.1749 | 0.5265 | +189.7 | 72.6% → 72.7% | −1.1‰ |
| q11-25 | 11,671 | 35.1% | 33.8% | 77.47% | 0.1517 | 0.4661 | −69.1 | 76.5% → 77.3% | −4.8‰ |
| q26+ | 6,287 | 18.9% | 17.2% | 79.12% | 0.1435 | 0.4450 | −88.6 | 78.0% → 78.9% | −4.7‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 14,138 | 42.5% | 44.1% | 75.11% | 0.1634 | 0.4970 | +82.8 | 73.9% → 74.9% | −5.8‰ |
| 2nd | 8,049 | 24.2% | 23.4% | 77.43% | 0.1521 | 0.4668 | −44.1 | 76.5% → 77.2% | −4.9‰ |
| 3rd+ | 11,084 | 33.3% | 32.6% | 77.36% | 0.1541 | 0.4724 | −38.7 | 76.8% → 77.2% | −0.7‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 16,718 | 50.2% | 51.1% | 75.92% | 0.1603 | 0.4897 | +45.4 | 75.1% → 75.7% | −2.9‰ |
| veteran | 8,250 | 24.8% | 24.5% | 76.81% | 0.1558 | 0.4764 | −14.7 | 75.6% → 76.6% | −5.5‰ |
| year2 | 8,303 | 25.0% | 24.4% | 77.04% | 0.1539 | 0.4700 | −30.6 | 76.2% → 76.9% | −4.3‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 14,202 | 42.7% | 44.8% | 74.74% | 0.1654 | 0.5023 | +111.6 | 73.5% → 74.5% | −5.8‰ |
| 16+ | 6,847 | 20.6% | 20.4% | 77.13% | 0.1563 | 0.4759 | −8.7 | 76.5% → 77.0% | −0.4‰ |
| 6-15 | 12,222 | 36.7% | 34.8% | 77.98% | 0.1492 | 0.4605 | −102.8 | 77.2% → 77.8% | −3.6‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 10,110 | 30.4% | 29.7% | 77.54% | 0.1541 | 0.4718 | −34.9 | 77.2% → 77.4% | +1.4‰ |
| normal | 13,190 | 39.6% | 37.1% | 78.23% | 0.1474 | 0.4556 | −134.8 | 77.0% → 78.0% | −6.3‰ |
| thin | 9,971 | 30.0% | 33.2% | 72.87% | 0.1746 | 0.5256 | +169.7 | 71.7% → 72.6% | −6.0‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 7,418 | 22.3% | 25.4% | 71.84% | 0.1795 | 0.5370 | +162.5 | 71.0% → 71.6% | −4.2‰ |
| rest | 19,389 | 58.3% | 55.5% | 77.91% | 0.1501 | 0.4633 | −144.1 | 76.7% → 77.7% | −5.0‰ |
| top quartile | 6,464 | 19.4% | 19.1% | 77.19% | 0.1547 | 0.4725 | −18.4 | 77.0% → 77.1% | −0.0‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 8,980 | 27.0% | 26.9% | 76.51% | 0.1571 | 0.4797 | −3.9 | 75.8% → 76.3% | −3.1‰ |
| mid | 18,322 | 55.1% | 55.1% | 76.41% | 0.1576 | 0.4819 | +0.0 | 75.7% → 76.2% | −2.9‰ |
| small | 5,969 | 17.9% | 18.0% | 76.33% | 0.1582 | 0.4829 | +3.9 | 74.5% → 76.1% | −8.0‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 6,344 | 19.1% | 19.5% | 76.57% | 0.1609 | 0.4894 | +20.8 | 76.1% → 76.4% | +2.2‰ |
| league meet | 12,322 | 37.0% | 36.7% | 76.45% | 0.1563 | 0.4796 | −15.3 | 74.6% → 76.2% | −9.8‰ |
| qualifier | 13,903 | 41.8% | 41.6% | 76.34% | 0.1568 | 0.4785 | −11.2 | 76.0% → 76.2% | −2.0‰ |
| world | 702 | 2.1% | 2.2% | 76.22% | 0.1656 | 0.5033 | +5.6 | 76.1% → 76.1% | +6.2‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 6,799 | 20.4% | 31.5% | 54.94% | 0.2429 | 0.6864 | +580.3 | 54.9% → 54.9% | −0.3‰ |
| 60-70 | 6,456 | 19.4% | 27.1% | 66.66% | 0.2201 | 0.6365 | +403.8 | 65.0% → 66.5% | −4.8‰ |
| 70-80 | 6,116 | 18.4% | 20.3% | 77.35% | 0.1742 | 0.5362 | +101.4 | 74.9% → 77.2% | −12.1‰ |
| 80-90 | 6,227 | 18.7% | 14.9% | 85.24% | 0.1252 | 0.4195 | −201.8 | 85.1% → 85.0% | −1.2‰ |
| 90-100 | 7,673 | 23.1% | 6.2% | 95.52% | 0.0424 | 0.1761 | −883.7 | 95.3% → 95.4% | −1.9‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 14,944 | 44.9% | 54.2% | 72.43% | 0.1901 | 0.5697 | +486.5 | 70.8% → 72.2% | −7.6‰ |
| close | 6,359 | 19.1% | 28.8% | 57.39% | 0.2375 | 0.6750 | +508.2 | 56.4% → 57.3% | −2.5‰ |
| lopsided | 11,968 | 36.0% | 17.0% | 91.38% | 0.0745 | 0.2685 | −994.7 | 91.4% → 91.2% | −0.0‰ |

## Baselines on 2025–26 (reused)

### v2.0

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+210.2); Event phase: qualification match number **q1-10** (+172.9); Rated matches this season (fewest on the field) **0-5** (+144.9)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,500 | 55.0% | 55.7% | 0.7% | 0.7% |
| 60-70% | 8,046 | 65.0% | 65.7% | 0.7% | 0.7% |
| 70-80% | 7,303 | 74.9% | 77.3% | 2.4% | 2.3% |
| 80-90% | 6,889 | 85.0% | 86.7% | 1.7% | 1.7% |
| 90-100% | 6,104 | 94.8% | 94.8% | 0.0% | 0.2% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.81% | 0.1572 | 0.4829 | −57.0 | 75.3% → 76.6% | −7.0‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.26% | 0.1701 | 0.5143 | +57.0 | 73.0% → 74.1% | −5.6‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.81% | 0.1572 | 0.4829 | −57.0 | 75.3% → 76.6% | −7.0‰ |
| q1-10 | 11,613 | 31.5% | 34.3% | 71.93% | 0.1832 | 0.5481 | +172.9 | 70.7% → 71.8% | −3.5‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.47% | 0.1638 | 0.4981 | −57.1 | 74.0% → 75.3% | −7.0‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 75.85% | 0.1604 | 0.4890 | −58.8 | 74.9% → 75.7% | −6.2‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.09% | 0.1752 | 0.5276 | +107.1 | 71.6% → 72.9% | −7.1‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 75.96% | 0.1629 | 0.4951 | −47.4 | 74.4% → 75.8% | −6.1‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.58% | 0.1636 | 0.4982 | −59.7 | 74.7% → 75.4% | −3.8‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.69% | 0.1698 | 0.5138 | +25.9 | 73.2% → 74.5% | −4.8‰ |
| veteran | 10,384 | 28.2% | 27.8% | 74.97% | 0.1663 | 0.5045 | −21.2 | 73.6% → 74.8% | −6.8‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.08% | 0.1678 | 0.5087 | −4.6 | 73.3% → 73.9% | −6.4‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.58% | 0.1777 | 0.5338 | +144.9 | 71.2% → 72.4% | −6.2‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.41% | 0.1634 | 0.4970 | −40.4 | 74.9% → 75.3% | −3.5‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.50% | 0.1604 | 0.4901 | −104.5 | 74.8% → 76.3% | −6.6‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 75.95% | 0.1610 | 0.4906 | −86.8 | 75.3% → 75.8% | −3.4‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.51% | 0.1596 | 0.4880 | −123.5 | 74.6% → 76.3% | −8.5‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.70% | 0.1877 | 0.5595 | +210.2 | 69.5% → 70.5% | −4.7‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 69.81% | 0.1907 | 0.5664 | +179.1 | 68.8% → 69.6% | −4.9‰ |
| rest | 21,629 | 58.7% | 56.3% | 76.01% | 0.1614 | 0.4923 | −149.5 | 74.5% → 75.8% | −6.8‰ |
| top quartile | 7,210 | 19.6% | 19.1% | 75.76% | 0.1642 | 0.5001 | −29.6 | 74.7% → 75.6% | −3.6‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.9% | 75.44% | 0.1654 | 0.5016 | −30.0 | 73.8% → 75.3% | −6.5‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.26% | 0.1694 | 0.5126 | +22.9 | 73.5% → 74.1% | −3.9‰ |
| small | 5,835 | 15.8% | 16.0% | 74.40% | 0.1695 | 0.5154 | +7.1 | 71.8% → 74.1% | −10.8‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 74.96% | 0.1668 | 0.5045 | −11.3 | 74.3% → 74.8% | −2.8‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.71% | 0.1730 | 0.5224 | +58.0 | 72.1% → 73.5% | −7.1‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.20% | 0.1652 | 0.5028 | −49.0 | 73.7% → 75.0% | −6.6‰ |
| world | 943 | 2.6% | 2.6% | 73.83% | 0.1708 | 0.5113 | +2.3 | 74.5% → 73.8% | +1.7‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,500 | 23.1% | 33.3% | 55.75% | 0.2430 | 0.6849 | +635.0 | 55.0% → 55.7% | −0.9‰ |
| 60-70 | 8,046 | 21.8% | 28.9% | 65.81% | 0.2225 | 0.6419 | +436.3 | 65.0% → 65.7% | −2.3‰ |
| 70-80 | 7,303 | 19.8% | 20.4% | 77.57% | 0.1731 | 0.5346 | +34.7 | 74.9% → 77.3% | −13.2‰ |
| 80-90 | 6,889 | 18.7% | 12.7% | 86.86% | 0.1141 | 0.3910 | −373.5 | 85.0% → 86.7% | −12.8‰ |
| 90-100 | 6,104 | 16.6% | 4.8% | 94.86% | 0.0483 | 0.1969 | −732.5 | 94.8% → 94.8% | −0.2‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,452 | 50.1% | 56.0% | 72.03% | 0.1883 | 0.5636 | +367.8 | 70.5% → 71.9% | −7.5‰ |
| close | 8,053 | 21.9% | 29.7% | 60.94% | 0.2291 | 0.6550 | +489.4 | 59.4% → 60.8% | −4.7‰ |
| lopsided | 10,337 | 28.1% | 14.2% | 89.79% | 0.0854 | 0.3010 | −857.2 | 89.2% → 89.6% | −3.5‰ |

### legacy

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+235.4); Rated matches this season (fewest on the field) **0-5** (+175.8); Event phase: qualification match number **q1-10** (+167.5)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,653 | 55.0% | 55.5% | 0.6% | 0.5% |
| 60-70% | 8,307 | 65.0% | 64.0% | 0.9% | 1.0% |
| 70-80% | 7,603 | 75.0% | 76.0% | 0.9% | 1.0% |
| 80-90% | 6,855 | 84.9% | 84.4% | 0.5% | 0.6% |
| 90-100% | 5,424 | 94.6% | 93.1% | 1.5% | 1.9% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 12.9% | 75.57% | 0.1659 | 0.5070 | −65.8 | 71.3% → 75.4% | −20.0‰ |
| qual | 31,725 | 86.1% | 87.1% | 72.29% | 0.1808 | 0.5420 | +65.8 | 73.0% → 72.1% | +4.7‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 12.9% | 75.57% | 0.1659 | 0.5070 | −65.8 | 71.3% → 75.4% | −20.0‰ |
| q1-10 | 11,613 | 31.5% | 34.1% | 69.99% | 0.1932 | 0.5742 | +167.5 | 71.8% → 69.8% | +11.8‰ |
| q11-25 | 12,697 | 34.5% | 34.0% | 73.09% | 0.1762 | 0.5302 | −31.8 | 73.5% → 72.9% | +2.3‰ |
| q26+ | 7,415 | 20.1% | 19.1% | 74.54% | 0.1693 | 0.5120 | −70.0 | 74.1% → 74.4% | −2.3‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.5% | 70.82% | 0.1879 | 0.5604 | +142.2 | 72.0% → 70.6% | +7.1‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 73.96% | 0.1730 | 0.5228 | −50.2 | 73.7% → 73.8% | +0.6‰ |
| 3rd+ | 12,513 | 34.0% | 32.6% | 74.30% | 0.1714 | 0.5183 | −91.9 | 73.0% → 74.1% | −5.6‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.1% | 72.60% | 0.1806 | 0.5412 | +32.5 | 72.9% → 72.4% | +3.9‰ |
| veteran | 10,384 | 28.2% | 27.9% | 73.20% | 0.1767 | 0.5332 | −21.0 | 72.7% → 73.0% | −1.5‰ |
| year2 | 9,281 | 25.2% | 25.0% | 72.52% | 0.1775 | 0.5341 | −11.6 | 72.6% → 72.3% | −0.7‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.4% | 70.27% | 0.1902 | 0.5661 | +175.8 | 72.2% → 70.1% | +10.2‰ |
| 16+ | 8,268 | 22.4% | 21.4% | 74.56% | 0.1702 | 0.5152 | −70.6 | 72.5% → 74.4% | −9.8‰ |
| 6-15 | 13,185 | 35.8% | 34.2% | 74.49% | 0.1708 | 0.5172 | −105.2 | 73.6% → 74.3% | −2.3‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.1% | 75.11% | 0.1674 | 0.5080 | −134.8 | 73.2% → 75.0% | −8.7‰ |
| normal | 14,138 | 38.4% | 36.8% | 74.35% | 0.1716 | 0.5195 | −100.6 | 73.8% → 74.2% | −0.4‰ |
| thin | 10,869 | 29.5% | 33.1% | 68.07% | 0.2004 | 0.5919 | +235.4 | 70.9% → 67.9% | +14.3‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.5% | 67.61% | 0.2020 | 0.5948 | +185.9 | 70.4% → 67.4% | +13.4‰ |
| rest | 21,629 | 58.7% | 56.3% | 74.22% | 0.1713 | 0.5181 | −161.3 | 73.1% → 74.0% | −4.8‰ |
| top quartile | 7,210 | 19.6% | 19.2% | 74.01% | 0.1753 | 0.5303 | −24.7 | 74.4% → 73.9% | +6.0‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 73.34% | 0.1753 | 0.5274 | −36.0 | 73.1% → 73.2% | −1.0‰ |
| mid | 20,568 | 55.8% | 56.2% | 72.57% | 0.1798 | 0.5397 | +21.9 | 72.9% → 72.4% | +3.0‰ |
| small | 5,835 | 15.8% | 16.1% | 72.31% | 0.1812 | 0.5457 | +14.1 | 71.6% → 72.1% | −1.1‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.2% | 73.80% | 0.1740 | 0.5247 | −36.5 | 72.9% → 73.7% | −3.2‰ |
| league meet | 12,338 | 33.5% | 34.7% | 71.35% | 0.1852 | 0.5528 | +79.3 | 72.0% → 71.2% | +4.4‰ |
| qualifier | 15,911 | 43.2% | 42.6% | 73.24% | 0.1765 | 0.5324 | −35.9 | 73.2% → 73.1% | +1.3‰ |
| world | 943 | 2.6% | 2.5% | 74.15% | 0.1715 | 0.5148 | −6.9 | 73.0% → 74.1% | −6.0‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,653 | 23.5% | 31.9% | 55.60% | 0.2431 | 0.6842 | +556.5 | 55.0% → 55.5% | −1.2‰ |
| 60-70 | 8,307 | 22.5% | 28.6% | 64.17% | 0.2270 | 0.6512 | +400.7 | 65.0% → 64.0% | +2.2‰ |
| 70-80 | 7,603 | 20.6% | 20.7% | 76.16% | 0.1797 | 0.5488 | +7.2 | 75.0% → 76.0% | −6.0‰ |
| 80-90 | 6,855 | 18.6% | 13.5% | 84.61% | 0.1297 | 0.4307 | −335.9 | 84.9% → 84.4% | +2.5‰ |
| 90-100 | 5,424 | 14.7% | 5.2% | 93.24% | 0.0628 | 0.2462 | −628.7 | 94.6% → 93.1% | +12.2‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,457 | 50.1% | 56.0% | 70.84% | 0.1998 | 0.5917 | +388.0 | 70.6% → 70.7% | −1.7‰ |
| close | 8,036 | 21.8% | 29.7% | 55.15% | 0.2436 | 0.6854 | +521.3 | 54.6% → 55.1% | −1.0‰ |
| lopsided | 10,349 | 28.1% | 14.3% | 89.70% | 0.0909 | 0.3247 | −909.3 | 90.6% → 89.6% | +8.3‰ |

## Live ledger

Not included in this run (`--live`).

## Definitions

- **Ties** score 0.5 for Brier and log loss and are left out of accuracy (a 50% call counts half).
- **Event phase**: the qualification match number at the event (playoffs separate), and the lowest season event ordinal among the four robots (any event with a predicted or played match counts, scrimmages included).
- **Experience**: from FIRST's rookie year; rookie = this season, year 2 = last season. Unknown rookie years rank just above veteran.
- **Rated matches / density**: the engine's own count of rated matches this season, before the match. Thin < 24 summed (under 6 per robot on average), dense ≥ 64 (16 or more).
- **Volatility**: the highest residual-variance EMA (engine reliability state, 1 = as variable as the model assumes) among robots with 6+ rated matches. The cut is the season's 75th percentile; it labels matches and never feeds a prediction.
- **Event size**: teams registered (or seen in matches). Small ≤ 16, mid 17–32, large 33+.
- **Margin**: |expected red − expected blue| over √(sd_red² + sd_blue²). Close < 0.25, clear < 1, lopsided ≥ 1.
- Playoff semifinal and final rounds are not split: the stored series numbers don't identify rounds consistently across seasons.
