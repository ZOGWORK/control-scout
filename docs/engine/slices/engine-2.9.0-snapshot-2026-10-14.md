# Engine error report: 2.9.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts`. Engine 2.9.0 (champion model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23`). Data version 2026-10-14T04:19:58.853Z.

Every match is predicted from earlier results only, in the backtest ledger's order and with its exclusions. The replay is checked against the served prediction call (`explainMatch`) on 437 matches. Slices with fewer than 200 matches are marked ⚠ low n and are never ranked.

## Corpus

| Season | Events | Unrated events | Matches | Predicted | Predicted at rated events | Surrogate matches | sha256 (match list) |
|---|---|---|---|---|---|---|---|
| 2023–24 | 1208 | 486 | 30,983 | 30,702 | 28,075 | 817 | `7a365c4792e3f393…` |
| 2024–25 | 1296 | 532 | 37,399 | 36,557 | 33,271 | 872 | `94fbd00d97718c51…` |
| 2025–26 | 1454 | 634 | 42,474 | 41,743 | 36,842 | 1017 | `86a7ca9e42cddc1f…` |

## Global numbers

`champion` is the live engine; `v2.0` the frozen Engine 2.0 model on the same ratings (the live shadow); `legacy` Engine 1.x, the program's historical baseline (72.7%, Brier 0.179 on 2025–26). The champion's coefficients were fitted on 2023–24 and its calibration on spring 2025, so 2023–24 rows are in-sample for it. 2025–26 is its out-of-sample season, already examined for 2.0 and 2.1, hence **reused**: it sets priorities here and is not proof of any change.

**In-sample warning:** the champion's final recalibration (slope 1.057692) was fitted on rated matches 2024-07-26 to 2026-07-26, so its numbers on those seasons are in-sample for that step. Forward-only evidence for it is the release's rolling-origin gate in `docs/engine/gates/`.

| Season | Model | Matches | Accuracy | Brier | Log loss | ECE |
|---|---|---|---|---|---|---|
| 2023–24 | champion | 28,075 | 72.98% | 0.1743 | 0.5236 | 0.71% |
| 2023–24 | v2.0 | 28,075 | 72.93% | 0.1746 | 0.5245 | 0.87% |
| 2023–24 | legacy | 28,075 | 72.15% | 0.1796 | 0.5373 | 0.63% |
| 2024–25 | champion | 33,271 | 76.52% | 0.1572 | 0.4808 | 0.78% |
| 2024–25 | v2.0 | 33,271 | 76.32% | 0.1576 | 0.4820 | 0.76% |
| 2024–25 | legacy | 33,271 | 75.84% | 0.1619 | 0.4944 | 0.94% |
| 2025–26 (reused) | champion | 36,842 | 74.80% | 0.1675 | 0.5078 | 0.85% |
| 2025–26 (reused) | v2.0 | 36,842 | 74.64% | 0.1680 | 0.5090 | 1.06% |
| 2025–26 (reused) | legacy | 36,842 | 72.66% | 0.1791 | 0.5378 | 1.03% |

**Baseline check:** legacy on 2025–26 scores 72.66% and Brier 0.1791 over 36,842 matches, against the published 72.7% / 0.179: **reproduced**.

Matches at rated events only. Scrimmage and off-season events are predicted but never rated; their matches, on their own:

| Season | Model | Matches | Accuracy | Brier | Log loss |
|---|---|---|---|---|---|
| 2023–24 | champion | 2,627 | 63.60% | 0.2044 | 0.6084 |
| 2023–24 | v2.0 | 2,627 | 63.75% | 0.2049 | 0.6093 |
| 2023–24 | legacy | 2,627 | 63.09% | 0.2069 | 0.6175 |
| 2024–25 | champion | 3,286 | 65.98% | 0.2100 | 0.6175 |
| 2024–25 | v2.0 | 3,286 | 65.80% | 0.2093 | 0.6135 |
| 2024–25 | legacy | 3,286 | 65.52% | 0.2170 | 0.6449 |
| 2025–26 | champion | 4,901 | 66.00% | 0.2111 | 0.6269 |
| 2025–26 | v2.0 | 4,901 | 65.82% | 0.2111 | 0.6254 |
| 2025–26 | legacy | 4,901 | 65.34% | 0.2175 | 0.6519 |

## Where the champion loses most (2025–26 (reused))

Ranked by **excess Brier**: the Brier a slice carries above an average match, summed over its matches (Σ(Brier − corpus mean)). Only data slices compete, at most one per dimension: the dimensions overlap (thin data shows up as few matches, thin density and unmeasured volatility), and three views of one weakness would hide the next. Probability and margin bands are calibration diagnostics: a coin-flip band carries more Brier by construction.

| # | Slice | Excess Brier | Share of Brier | Share of matches |
|---|---|---|---|---|
| 1 | Data density (all four robots' rated matches): **thin** | +211.8 | 32.9% | 29.5% |
| 2 | Event phase: qualification match number: **q1-10** | +168.4 | 34.2% | 31.5% |
| 3 | Rated matches this season (fewest on the field): **0-5** | +144.6 | 44.1% | 41.8% |

**Surprise** is the mean of (p − y)² − p(1 − p) over decided matches (ties left out): the Brier above what the model's own probabilities expected. Above zero means the model is too sure in that slice; below zero means too timid. **Fav. stated → won** compares the favourite's mean stated chance with how often it won.

### Calibration by stated chance (champion, 2025–26 (reused))

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,077 | 55.0% | 55.8% | 0.8% | 0.8% |
| 60-70% | 7,750 | 65.0% | 65.2% | 0.3% | 0.2% |
| 70-80% | 7,233 | 74.9% | 76.1% | 1.2% | 1.1% |
| 80-90% | 7,023 | 85.0% | 85.8% | 0.8% | 0.8% |
| 90-100% | 6,759 | 94.9% | 94.6% | 0.3% | 0.4% |

### All slices (champion, 2025–26 (reused))

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.79% | 0.1571 | 0.4827 | −53.4 | 75.8% → 76.6% | −4.5‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.48% | 0.1692 | 0.5119 | +53.4 | 73.8% → 74.3% | −2.4‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.79% | 0.1571 | 0.4827 | −53.4 | 75.8% → 76.6% | −4.5‰ |
| q1-10 | 11,613 | 31.5% | 34.2% | 72.02% | 0.1820 | 0.5450 | +168.4 | 71.1% → 71.8% | −2.8‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.77% | 0.1630 | 0.4957 | −58.1 | 74.7% → 75.6% | −4.0‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.11% | 0.1599 | 0.4877 | −56.9 | 76.3% → 76.0% | +1.0‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.28% | 0.1745 | 0.5256 | +108.5 | 72.3% → 73.1% | −4.5‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 76.03% | 0.1622 | 0.4931 | −46.9 | 75.0% → 75.9% | −3.1‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.82% | 0.1626 | 0.4960 | −61.6 | 75.5% → 75.7% | −0.2‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.1% | 74.89% | 0.1691 | 0.5120 | +26.4 | 74.0% → 74.7% | −1.6‰ |
| veteran | 10,384 | 28.2% | 27.8% | 75.21% | 0.1655 | 0.5024 | −21.3 | 74.3% → 75.0% | −3.8‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.17% | 0.1670 | 0.5064 | −5.1 | 73.9% → 74.0% | −3.5‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.82% | 0.1769 | 0.5316 | +144.6 | 71.9% → 72.6% | −3.8‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.75% | 0.1628 | 0.4955 | −39.5 | 75.8% → 75.6% | +1.3‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.50% | 0.1596 | 0.4879 | −105.1 | 75.4% → 76.3% | −3.9‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.08% | 0.1600 | 0.4882 | −89.0 | 76.2% → 75.9% | +0.8‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.66% | 0.1589 | 0.4860 | −122.8 | 75.1% → 76.5% | −6.2‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.96% | 0.1870 | 0.5576 | +211.8 | 70.3% → 70.7% | −1.9‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 70.16% | 0.1899 | 0.5644 | +179.3 | 69.7% → 69.9% | −1.8‰ |
| rest | 21,629 | 58.7% | 56.3% | 76.09% | 0.1608 | 0.4906 | −146.6 | 75.2% → 75.9% | −3.8‰ |
| top quartile | 7,210 | 19.6% | 19.0% | 76.04% | 0.1630 | 0.4968 | −32.7 | 75.5% → 75.9% | −0.1‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 75.54% | 0.1646 | 0.4992 | −31.1 | 74.7% → 75.4% | −2.8‰ |
| mid | 20,568 | 55.8% | 56.3% | 74.42% | 0.1688 | 0.5109 | +26.4 | 74.2% → 74.2% | −0.9‰ |
| small | 5,835 | 15.8% | 15.9% | 74.80% | 0.1683 | 0.5126 | +4.7 | 72.5% → 74.5% | −8.8‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 75.15% | 0.1662 | 0.5026 | −10.5 | 75.2% → 75.0% | +1.9‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.89% | 0.1723 | 0.5206 | +59.3 | 72.8% → 73.7% | −4.4‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.38% | 0.1643 | 0.5005 | −50.7 | 74.3% → 75.2% | −4.2‰ |
| world | 943 | 2.6% | 2.6% | 73.94% | 0.1696 | 0.5086 | +1.9 | 75.9% → 73.9% | +8.9‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,077 | 21.9% | 31.8% | 55.91% | 0.2432 | 0.6855 | +611.3 | 55.0% → 55.8% | −0.6‰ |
| 60-70 | 7,750 | 21.0% | 28.1% | 65.38% | 0.2234 | 0.6437 | +433.2 | 65.0% → 65.2% | −1.5‰ |
| 70-80 | 7,233 | 19.6% | 21.0% | 76.34% | 0.1788 | 0.5469 | +81.4 | 74.9% → 76.1% | −7.3‰ |
| 80-90 | 7,023 | 19.1% | 13.7% | 85.96% | 0.1201 | 0.4062 | −333.3 | 85.0% → 85.8% | −6.7‰ |
| 90-100 | 6,759 | 18.3% | 5.5% | 94.65% | 0.0503 | 0.2036 | −792.6 | 94.9% → 94.6% | +2.6‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,406 | 50.0% | 56.0% | 72.01% | 0.1876 | 0.5620 | +370.1 | 71.3% → 71.8% | −4.3‰ |
| close | 8,009 | 21.7% | 29.8% | 61.39% | 0.2295 | 0.6558 | +496.0 | 60.0% → 61.3% | −2.5‰ |
| lopsided | 10,427 | 28.3% | 14.3% | 89.92% | 0.0845 | 0.2985 | −866.1 | 89.7% → 89.8% | +0.1‰ |

## Champion, 2023–24 (in-sample for the champion)

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+249.6); Rated matches this season (fewest on the field) **0-5** (+189.1); Event phase: qualification match number **q1-10** (+176.4)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,222 | 54.3% | 54.6% | 0.3% | 0.4% |
| 60-70% | 5,790 | 64.8% | 64.5% | 0.3% | 0.5% |
| 70-80% | 5,260 | 74.9% | 75.0% | 0.1% | 0.0% |
| 80-90% | 5,006 | 84.9% | 85.5% | 0.6% | 0.5% |
| 90-100% | 4,797 | 95.0% | 94.6% | 0.4% | 0.4% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.4% | 76.82% | 0.1555 | 0.4749 | −55.6 | 76.6% → 76.7% | −0.7‰ |
| qual | 25,106 | 89.4% | 90.6% | 72.52% | 0.1765 | 0.5294 | +55.6 | 72.3% → 72.3% | −0.7‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.4% | 76.82% | 0.1555 | 0.4749 | −55.6 | 76.6% → 76.7% | −0.7‰ |
| q1-10 | 10,431 | 37.2% | 40.8% | 69.35% | 0.1912 | 0.5654 | +176.4 | 69.0% → 69.2% | +0.2‰ |
| q11-25 | 10,412 | 37.1% | 35.8% | 74.32% | 0.1683 | 0.5098 | −62.3 | 74.2% → 74.1% | −1.5‰ |
| q26+ | 4,263 | 15.2% | 14.0% | 75.88% | 0.1605 | 0.4893 | −58.6 | 75.7% → 75.7% | −1.2‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 12,415 | 44.2% | 47.2% | 70.65% | 0.1859 | 0.5511 | +144.4 | 70.3% → 70.5% | +0.7‰ |
| 2nd | 6,952 | 24.8% | 24.1% | 73.91% | 0.1695 | 0.5133 | −33.3 | 73.8% → 73.7% | −1.6‰ |
| 3rd+ | 8,708 | 31.0% | 28.7% | 75.55% | 0.1615 | 0.4927 | −111.1 | 75.4% → 75.4% | −2.0‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 15,029 | 53.5% | 54.0% | 72.64% | 0.1758 | 0.5271 | +22.3 | 72.3% → 72.4% | −1.0‰ |
| veteran | 7,416 | 26.4% | 25.8% | 73.58% | 0.1700 | 0.5129 | −31.4 | 73.7% → 73.4% | −0.8‰ |
| year2 | 5,630 | 20.1% | 20.2% | 73.09% | 0.1759 | 0.5284 | +9.1 | 72.6% → 72.9% | +0.1‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 12,833 | 45.7% | 49.6% | 69.91% | 0.1890 | 0.5590 | +189.1 | 69.8% → 69.7% | +1.2‰ |
| 16+ | 4,861 | 17.3% | 16.1% | 75.52% | 0.1621 | 0.4935 | −59.3 | 75.9% → 75.4% | +1.3‰ |
| 6-15 | 10,381 | 37.0% | 34.3% | 75.58% | 0.1618 | 0.4940 | −129.8 | 74.9% → 75.4% | −4.0‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 7,119 | 25.4% | 23.1% | 76.14% | 0.1587 | 0.4863 | −110.5 | 76.3% → 76.0% | +0.5‰ |
| normal | 11,776 | 41.9% | 39.1% | 75.61% | 0.1625 | 0.4945 | −139.1 | 74.8% → 75.4% | −4.0‰ |
| thin | 9,180 | 32.7% | 37.8% | 67.13% | 0.2015 | 0.5900 | +249.6 | 67.3% → 67.0% | +2.5‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 6,533 | 23.3% | 27.5% | 65.83% | 0.2058 | 0.6009 | +206.2 | 65.5% → 65.7% | +0.7‰ |
| rest | 16,156 | 57.5% | 55.6% | 74.39% | 0.1684 | 0.5101 | −94.1 | 74.3% → 74.2% | −0.7‰ |
| top quartile | 5,386 | 19.2% | 16.9% | 77.38% | 0.1535 | 0.4706 | −112.0 | 76.9% → 77.3% | −2.4‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 6,510 | 23.2% | 23.4% | 73.16% | 0.1758 | 0.5286 | +9.8 | 73.6% → 73.0% | +4.1‰ |
| mid | 15,470 | 55.1% | 54.2% | 73.25% | 0.1713 | 0.5155 | −46.6 | 73.0% → 73.1% | −2.4‰ |
| small | 6,095 | 21.7% | 22.5% | 72.09% | 0.1803 | 0.5388 | +36.8 | 71.2% → 71.9% | −1.5‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 4,378 | 15.6% | 15.8% | 72.39% | 0.1768 | 0.5306 | +10.9 | 73.9% → 72.2% | +6.1‰ |
| league meet | 11,683 | 41.6% | 42.7% | 72.00% | 0.1786 | 0.5352 | +51.0 | 70.9% → 71.8% | −4.9‰ |
| qualifier | 11,417 | 40.7% | 39.6% | 73.96% | 0.1697 | 0.5113 | −52.4 | 73.9% → 73.8% | +0.8‰ |
| world | 597 | 2.1% | 1.9% | 77.55% | 0.1584 | 0.4819 | −9.5 | 76.8% → 77.6% | +2.7‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 7,222 | 25.7% | 36.1% | 54.64% | 0.2446 | 0.6879 | +507.7 | 54.3% → 54.6% | +0.2‰ |
| 60-70 | 5,790 | 20.6% | 26.7% | 64.67% | 0.2254 | 0.6483 | +296.3 | 64.8% → 64.5% | +0.4‰ |
| 70-80 | 5,260 | 18.7% | 19.8% | 75.22% | 0.1842 | 0.5587 | +52.1 | 74.9% → 75.0% | −2.1‰ |
| 80-90 | 5,006 | 17.8% | 12.5% | 85.63% | 0.1219 | 0.4095 | −262.4 | 84.9% → 85.5% | −5.7‰ |
| 90-100 | 4,797 | 17.1% | 5.0% | 94.65% | 0.0505 | 0.2065 | −593.7 | 95.0% → 94.6% | +3.3‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 13,332 | 47.5% | 52.7% | 71.47% | 0.1932 | 0.5757 | +252.6 | 70.8% → 71.3% | −3.0‰ |
| close | 7,044 | 25.1% | 34.6% | 56.52% | 0.2404 | 0.6788 | +465.7 | 56.9% → 56.5% | +1.6‰ |
| lopsided | 7,699 | 27.4% | 12.7% | 90.52% | 0.0810 | 0.2916 | −718.4 | 90.6% → 90.4% | +1.0‰ |

## Champion, 2024–25 (in-sample for the champion)

Top excess-Brier slices: Event phase: qualification match number **q1-10** (+188.2); Data density (all four robots' rated matches) **thin** (+166.5); Rated matches this season (fewest on the field) **0-5** (+107.6)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,448 | 54.9% | 54.7% | 0.2% | 0.3% |
| 60-70% | 6,065 | 65.1% | 65.5% | 0.5% | 0.5% |
| 70-80% | 5,962 | 74.9% | 76.1% | 1.2% | 1.1% |
| 80-90% | 6,291 | 85.1% | 84.0% | 1.2% | 1.0% |
| 90-100% | 8,505 | 95.5% | 94.8% | 0.7% | 0.2% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.36% | 0.1500 | 0.4619 | −31.7 | 77.2% → 78.1% | −2.6‰ |
| qual | 28,885 | 86.8% | 87.4% | 76.23% | 0.1583 | 0.4836 | +31.7 | 76.3% → 76.0% | +1.7‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.36% | 0.1500 | 0.4619 | −31.7 | 77.2% → 78.1% | −2.6‰ |
| q1-10 | 10,927 | 32.8% | 36.4% | 73.18% | 0.1745 | 0.5257 | +188.2 | 73.6% → 73.0% | +3.8‰ |
| q11-25 | 11,671 | 35.1% | 33.8% | 77.62% | 0.1513 | 0.4653 | −68.9 | 77.4% → 77.4% | +0.4‰ |
| q26+ | 6,287 | 18.9% | 17.2% | 78.96% | 0.1433 | 0.4446 | −87.6 | 78.9% → 78.7% | +0.5‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 14,138 | 42.5% | 44.0% | 75.26% | 0.1629 | 0.4955 | +79.3 | 74.9% → 75.0% | −0.9‰ |
| 2nd | 8,049 | 24.2% | 23.4% | 77.51% | 0.1520 | 0.4667 | −42.3 | 77.4% → 77.3% | +0.4‰ |
| 3rd+ | 11,084 | 33.3% | 32.6% | 77.39% | 0.1539 | 0.4721 | −37.0 | 77.7% → 77.2% | +4.2‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 16,718 | 50.2% | 51.1% | 75.95% | 0.1600 | 0.4892 | +45.5 | 76.1% → 75.7% | +2.2‰ |
| veteran | 8,250 | 24.8% | 24.5% | 76.84% | 0.1555 | 0.4756 | −14.1 | 76.5% → 76.7% | −0.5‰ |
| year2 | 8,303 | 25.0% | 24.4% | 77.33% | 0.1535 | 0.4689 | −31.3 | 77.1% → 77.2% | +0.7‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 14,202 | 42.7% | 44.7% | 74.89% | 0.1648 | 0.5008 | +107.6 | 74.5% → 74.7% | −0.9‰ |
| 16+ | 6,847 | 20.6% | 20.4% | 77.10% | 0.1562 | 0.4758 | −7.2 | 77.3% → 77.0% | +4.5‰ |
| 6-15 | 12,222 | 36.7% | 34.8% | 78.08% | 0.1490 | 0.4603 | −100.5 | 78.1% → 77.9% | +1.6‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 10,110 | 30.4% | 29.8% | 77.54% | 0.1541 | 0.4722 | −31.8 | 78.0% → 77.4% | +6.4‰ |
| normal | 13,190 | 39.6% | 37.1% | 78.36% | 0.1470 | 0.4546 | −134.7 | 78.0% → 78.2% | −1.2‰ |
| thin | 9,971 | 30.0% | 33.2% | 73.02% | 0.1739 | 0.5240 | +166.5 | 72.8% → 72.8% | −1.1‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 7,418 | 22.3% | 25.4% | 71.93% | 0.1789 | 0.5357 | +160.9 | 72.0% → 71.7% | +0.6‰ |
| rest | 19,389 | 58.3% | 55.6% | 78.01% | 0.1500 | 0.4628 | −140.9 | 77.6% → 77.8% | +0.1‰ |
| top quartile | 6,464 | 19.4% | 19.0% | 77.26% | 0.1542 | 0.4716 | −20.0 | 77.9% → 77.1% | +4.7‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 8,980 | 27.0% | 26.9% | 76.67% | 0.1569 | 0.4793 | −3.3 | 76.7% → 76.5% | +1.9‰ |
| mid | 18,322 | 55.1% | 55.1% | 76.48% | 0.1573 | 0.4813 | +0.9 | 76.6% → 76.3% | +2.2‰ |
| small | 5,969 | 17.9% | 18.0% | 76.40% | 0.1576 | 0.4813 | +2.4 | 75.5% → 76.2% | −3.3‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 6,344 | 19.1% | 19.5% | 76.64% | 0.1608 | 0.4899 | +22.6 | 77.0% → 76.5% | +7.4‰ |
| league meet | 12,322 | 37.0% | 36.7% | 76.68% | 0.1558 | 0.4781 | −17.6 | 75.5% → 76.4% | −5.0‰ |
| qualifier | 13,903 | 41.8% | 41.6% | 76.31% | 0.1565 | 0.4778 | −10.4 | 76.9% → 76.1% | +3.1‰ |
| world | 702 | 2.1% | 2.2% | 76.50% | 0.1650 | 0.5030 | +5.5 | 77.0% → 76.4% | +10.9‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 6,448 | 19.4% | 30.0% | 54.82% | 0.2434 | 0.6875 | +555.3 | 54.9% → 54.7% | +0.3‰ |
| 60-70 | 6,065 | 18.2% | 25.9% | 65.64% | 0.2236 | 0.6435 | +402.3 | 65.1% → 65.5% | −1.3‰ |
| 70-80 | 5,962 | 17.9% | 20.4% | 76.36% | 0.1792 | 0.5481 | +130.6 | 74.9% → 76.1% | −6.9‰ |
| 80-90 | 6,291 | 18.9% | 16.0% | 84.13% | 0.1330 | 0.4389 | −152.7 | 85.1% → 84.0% | +7.0‰ |
| 90-100 | 8,505 | 25.6% | 7.7% | 94.96% | 0.0472 | 0.1917 | −935.5 | 95.5% → 94.8% | +4.7‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 14,900 | 44.8% | 54.0% | 72.61% | 0.1896 | 0.5684 | +481.4 | 71.8% → 72.4% | −3.3‰ |
| close | 6,312 | 19.0% | 28.7% | 57.14% | 0.2382 | 0.6761 | +510.7 | 56.8% → 57.0% | −1.2‰ |
| lopsided | 12,059 | 36.2% | 17.3% | 91.35% | 0.0750 | 0.2702 | −992.1 | 92.4% → 91.2% | +7.8‰ |

## Baselines on 2025–26 (reused)

### v2.0

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+208.8); Event phase: qualification match number **q1-10** (+170.0); Rated matches this season (fewest on the field) **0-5** (+143.3)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,412 | 55.0% | 55.6% | 0.6% | 0.6% |
| 60-70% | 7,994 | 65.0% | 65.6% | 0.6% | 0.6% |
| 70-80% | 7,272 | 74.9% | 77.1% | 2.2% | 2.1% |
| 80-90% | 6,969 | 84.9% | 86.5% | 1.5% | 1.5% |
| 90-100% | 6,195 | 94.8% | 94.9% | 0.1% | 0.1% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.79% | 0.1571 | 0.4827 | −55.5 | 75.4% → 76.6% | −6.8‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.29% | 0.1697 | 0.5132 | +55.5 | 73.1% → 74.1% | −5.3‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.79% | 0.1571 | 0.4827 | −55.5 | 75.4% → 76.6% | −6.8‰ |
| q1-10 | 11,613 | 31.5% | 34.3% | 71.77% | 0.1826 | 0.5465 | +170.0 | 70.9% → 71.6% | −3.3‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.54% | 0.1635 | 0.4972 | −57.0 | 74.1% → 75.3% | −6.7‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.09% | 0.1602 | 0.4885 | −57.5 | 75.0% → 76.0% | −5.9‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.11% | 0.1748 | 0.5265 | +106.1 | 71.8% → 72.9% | −6.6‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 75.96% | 0.1626 | 0.4942 | −47.1 | 74.5% → 75.8% | −5.9‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.62% | 0.1632 | 0.4974 | −59.0 | 74.8% → 75.5% | −3.8‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.76% | 0.1694 | 0.5128 | +24.6 | 73.3% → 74.6% | −4.5‰ |
| veteran | 10,384 | 28.2% | 27.8% | 74.96% | 0.1659 | 0.5036 | −20.9 | 73.7% → 74.8% | −6.5‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.05% | 0.1676 | 0.5080 | −3.6 | 73.4% → 73.8% | −6.0‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.63% | 0.1773 | 0.5326 | +143.3 | 71.5% → 72.4% | −5.7‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.53% | 0.1632 | 0.4964 | −39.1 | 74.9% → 75.4% | −3.4‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.42% | 0.1601 | 0.4892 | −104.2 | 74.8% → 76.2% | −6.5‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.02% | 0.1607 | 0.4897 | −86.4 | 75.4% → 75.9% | −3.5‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.45% | 0.1593 | 0.4872 | −122.5 | 74.7% → 76.3% | −8.3‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.76% | 0.1872 | 0.5583 | +208.8 | 69.8% → 70.6% | −4.0‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 69.88% | 0.1902 | 0.5653 | +178.3 | 69.1% → 69.7% | −4.1‰ |
| rest | 21,629 | 58.7% | 56.3% | 76.01% | 0.1612 | 0.4918 | −147.0 | 74.6% → 75.8% | −6.6‰ |
| top quartile | 7,210 | 19.6% | 19.1% | 75.80% | 0.1636 | 0.4980 | −31.3 | 74.8% → 75.7% | −3.7‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.9% | 75.46% | 0.1651 | 0.5007 | −29.5 | 74.0% → 75.3% | −6.2‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.25% | 0.1691 | 0.5118 | +24.0 | 73.6% → 74.1% | −3.6‰ |
| small | 5,835 | 15.8% | 15.9% | 74.54% | 0.1689 | 0.5139 | +5.5 | 72.0% → 74.3% | −10.7‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 74.98% | 0.1664 | 0.5034 | −11.6 | 74.4% → 74.8% | −2.6‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.69% | 0.1727 | 0.5217 | +58.8 | 72.3% → 73.5% | −6.7‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.23% | 0.1648 | 0.5017 | −49.5 | 73.9% → 75.0% | −6.4‰ |
| world | 943 | 2.6% | 2.6% | 74.26% | 0.1704 | 0.5103 | +2.3 | 74.6% → 74.2% | +2.0‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,412 | 22.8% | 33.0% | 55.69% | 0.2430 | 0.6848 | +631.5 | 55.0% → 55.6% | −0.9‰ |
| 60-70 | 7,994 | 21.7% | 28.7% | 65.72% | 0.2223 | 0.6417 | +434.5 | 65.0% → 65.6% | −2.4‰ |
| 70-80 | 7,272 | 19.7% | 20.5% | 77.32% | 0.1741 | 0.5368 | +44.7 | 74.9% → 77.1% | −12.2‰ |
| 80-90 | 6,969 | 18.9% | 13.0% | 86.61% | 0.1157 | 0.3951 | −364.0 | 84.9% → 86.5% | −11.3‰ |
| 90-100 | 6,195 | 16.8% | 4.8% | 94.97% | 0.0474 | 0.1945 | −746.6 | 94.8% → 94.9% | −1.0‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,406 | 50.0% | 56.0% | 71.93% | 0.1881 | 0.5634 | +371.1 | 70.6% → 71.8% | −7.3‰ |
| close | 8,009 | 21.7% | 29.8% | 60.83% | 0.2300 | 0.6570 | +496.9 | 59.4% → 60.7% | −3.5‰ |
| lopsided | 10,427 | 28.3% | 14.3% | 89.92% | 0.0847 | 0.2993 | −868.0 | 89.2% → 89.8% | −3.7‰ |

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
| rest | 21,629 | 58.7% | 56.3% | 74.13% | 0.1717 | 0.5193 | −158.7 | 73.0% → 74.0% | −4.9‰ |
| top quartile | 7,210 | 19.6% | 19.2% | 74.08% | 0.1756 | 0.5305 | −25.0 | 74.3% → 74.0% | +5.6‰ |

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
