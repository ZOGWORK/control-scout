# Engine error report: 2.10.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts`. Engine 2.10.0 (champion model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23`). Data version 2026-10-14T04:19:58.853Z.

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
| 2023–24 | champion | 28,075 | 72.96% | 0.1743 | 0.5237 | 0.74% |
| 2023–24 | v2.0 | 28,075 | 72.89% | 0.1746 | 0.5245 | 0.81% |
| 2023–24 | legacy | 28,075 | 72.15% | 0.1796 | 0.5373 | 0.63% |
| 2024–25 | champion | 33,271 | 76.54% | 0.1572 | 0.4808 | 0.79% |
| 2024–25 | v2.0 | 33,271 | 76.34% | 0.1576 | 0.4819 | 0.80% |
| 2024–25 | legacy | 33,271 | 75.84% | 0.1619 | 0.4944 | 0.94% |
| 2025–26 (reused) | champion | 36,842 | 74.81% | 0.1675 | 0.5077 | 0.92% |
| 2025–26 (reused) | v2.0 | 36,842 | 74.65% | 0.1679 | 0.5088 | 1.19% |
| 2025–26 (reused) | legacy | 36,842 | 72.66% | 0.1791 | 0.5378 | 1.03% |

**Baseline check:** legacy on 2025–26 scores 72.66% and Brier 0.1791 over 36,842 matches, against the published 72.7% / 0.179: **reproduced**.

Matches at rated events only. Scrimmage and off-season events are predicted but never rated; their matches, on their own:

| Season | Model | Matches | Accuracy | Brier | Log loss |
|---|---|---|---|---|---|
| 2023–24 | champion | 2,627 | 63.60% | 0.2045 | 0.6087 |
| 2023–24 | v2.0 | 2,627 | 63.48% | 0.2050 | 0.6096 |
| 2023–24 | legacy | 2,627 | 63.09% | 0.2069 | 0.6175 |
| 2024–25 | champion | 3,286 | 66.04% | 0.2100 | 0.6175 |
| 2024–25 | v2.0 | 3,286 | 65.77% | 0.2093 | 0.6135 |
| 2024–25 | legacy | 3,286 | 65.52% | 0.2170 | 0.6449 |
| 2025–26 | champion | 4,901 | 65.96% | 0.2110 | 0.6271 |
| 2025–26 | v2.0 | 4,901 | 66.07% | 0.2108 | 0.6253 |
| 2025–26 | legacy | 4,901 | 65.34% | 0.2175 | 0.6519 |

## Where the champion loses most (2025–26 (reused))

Ranked by **excess Brier**: the Brier a slice carries above an average match, summed over its matches (Σ(Brier − corpus mean)). Only data slices compete, at most one per dimension: the dimensions overlap (thin data shows up as few matches, thin density and unmeasured volatility), and three views of one weakness would hide the next. Probability and margin bands are calibration diagnostics: a coin-flip band carries more Brier by construction.

| # | Slice | Excess Brier | Share of Brier | Share of matches |
|---|---|---|---|---|
| 1 | Data density (all four robots' rated matches): **thin** | +212.6 | 32.9% | 29.5% |
| 2 | Event phase: qualification match number: **q1-10** | +168.3 | 34.2% | 31.5% |
| 3 | Rated matches this season (fewest on the field): **0-5** | +145.6 | 44.1% | 41.8% |

**Surprise** is the mean of (p − y)² − p(1 − p) over decided matches (ties left out): the Brier above what the model's own probabilities expected. Above zero means the model is too sure in that slice; below zero means too timid. **Fav. stated → won** compares the favourite's mean stated chance with how often it won.

### Calibration by stated chance (champion, 2025–26 (reused))

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,103 | 55.0% | 56.0% | 1.0% | 1.0% |
| 60-70% | 7,767 | 65.0% | 65.2% | 0.2% | 0.2% |
| 70-80% | 7,267 | 75.0% | 76.2% | 1.2% | 1.2% |
| 80-90% | 6,955 | 85.0% | 86.1% | 1.1% | 1.1% |
| 90-100% | 6,750 | 94.9% | 94.5% | 0.4% | 0.5% |

### All slices (champion, 2025–26 (reused))

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.92% | 0.1570 | 0.4824 | −53.8 | 75.7% → 76.7% | −5.0‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.47% | 0.1692 | 0.5118 | +53.8 | 73.7% → 74.3% | −2.7‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.92% | 0.1570 | 0.4824 | −53.8 | 75.7% → 76.7% | −5.0‰ |
| q1-10 | 11,613 | 31.5% | 34.2% | 71.96% | 0.1820 | 0.5448 | +168.3 | 71.0% → 71.8% | −3.3‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.81% | 0.1629 | 0.4956 | −58.0 | 74.7% → 75.6% | −4.3‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.09% | 0.1598 | 0.4878 | −56.6 | 76.3% → 76.0% | +1.1‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.20% | 0.1744 | 0.5252 | +107.6 | 72.2% → 73.0% | −5.1‰ |
| 2nd | 8,732 | 23.7% | 23.0% | 75.99% | 0.1623 | 0.4933 | −45.4 | 75.0% → 75.8% | −3.1‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.99% | 0.1625 | 0.4959 | −62.2 | 75.6% → 75.8% | −0.2‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.90% | 0.1690 | 0.5117 | +25.9 | 73.9% → 74.7% | −1.9‰ |
| veteran | 10,384 | 28.2% | 27.8% | 75.16% | 0.1654 | 0.5020 | −21.2 | 74.2% → 75.0% | −4.0‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.23% | 0.1670 | 0.5067 | −4.7 | 73.9% → 74.0% | −3.8‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.78% | 0.1769 | 0.5316 | +145.6 | 71.8% → 72.6% | −4.3‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.89% | 0.1626 | 0.4952 | −40.2 | 75.9% → 75.7% | +1.5‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.50% | 0.1595 | 0.4876 | −105.4 | 75.4% → 76.3% | −4.3‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.21% | 0.1599 | 0.4881 | −89.0 | 76.2% → 76.1% | +1.0‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.68% | 0.1587 | 0.4857 | −123.6 | 75.1% → 76.5% | −6.7‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.83% | 0.1870 | 0.5576 | +212.6 | 70.2% → 70.6% | −2.4‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.7% | 69.97% | 0.1901 | 0.5648 | +181.5 | 69.6% → 69.8% | −2.2‰ |
| rest | 21,629 | 58.7% | 56.3% | 76.15% | 0.1606 | 0.4902 | −149.0 | 75.1% → 76.0% | −4.3‰ |
| top quartile | 7,210 | 19.6% | 19.0% | 76.12% | 0.1629 | 0.4967 | −32.6 | 75.6% → 76.0% | +0.1‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 75.63% | 0.1645 | 0.4992 | −30.8 | 74.7% → 75.5% | −2.8‰ |
| mid | 20,568 | 55.8% | 56.3% | 74.38% | 0.1687 | 0.5108 | +26.3 | 74.1% → 74.2% | −1.3‰ |
| small | 5,835 | 15.8% | 15.9% | 74.84% | 0.1682 | 0.5120 | +4.5 | 72.4% → 74.6% | −9.4‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 75.21% | 0.1660 | 0.5022 | −11.4 | 75.2% → 75.1% | +1.8‰ |
| league meet | 12,338 | 33.5% | 34.5% | 73.87% | 0.1723 | 0.5204 | +59.7 | 72.7% → 73.7% | −4.9‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.41% | 0.1643 | 0.5004 | −50.4 | 74.3% → 75.2% | −4.6‰ |
| world | 943 | 2.6% | 2.6% | 73.83% | 0.1697 | 0.5091 | +2.1 | 76.0% → 73.8% | +9.5‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,103 | 22.0% | 31.9% | 56.03% | 0.2432 | 0.6852 | +613.5 | 55.0% → 56.0% | −0.7‰ |
| 60-70 | 7,767 | 21.1% | 28.1% | 65.32% | 0.2233 | 0.6438 | +433.8 | 65.0% → 65.2% | −1.5‰ |
| 70-80 | 7,267 | 19.7% | 21.0% | 76.40% | 0.1785 | 0.5462 | +80.2 | 75.0% → 76.2% | −7.5‰ |
| 80-90 | 6,955 | 18.9% | 13.3% | 86.22% | 0.1183 | 0.4014 | −342.2 | 85.0% → 86.1% | −8.6‰ |
| 90-100 | 6,750 | 18.3% | 5.6% | 94.54% | 0.0511 | 0.2062 | −785.2 | 94.9% → 94.5% | +3.3‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,931 | 51.4% | 56.1% | 73.77% | 0.1829 | 0.5525 | +291.8 | 72.6% → 73.6% | −6.5‰ |
| close | 8,460 | 23.0% | 32.9% | 57.83% | 0.2399 | 0.6780 | +612.5 | 56.8% → 57.7% | −0.5‰ |
| lopsided | 9,451 | 25.7% | 11.0% | 91.94% | 0.0718 | 0.2654 | −904.4 | 92.1% → 91.8% | +1.8‰ |

## Champion, 2023–24 (in-sample for the champion)

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+249.5); Rated matches this season (fewest on the field) **0-5** (+188.9); Event phase: qualification match number **q1-10** (+175.8)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,210 | 54.3% | 54.4% | 0.2% | 0.6% |
| 60-70% | 5,778 | 64.8% | 64.6% | 0.2% | 0.4% |
| 70-80% | 5,261 | 74.9% | 74.9% | 0.0% | 0.1% |
| 80-90% | 5,006 | 84.9% | 85.5% | 0.6% | 0.5% |
| 90-100% | 4,820 | 95.0% | 94.5% | 0.5% | 0.5% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.4% | 76.92% | 0.1557 | 0.4752 | −55.2 | 76.7% → 76.8% | −0.4‰ |
| qual | 25,106 | 89.4% | 90.6% | 72.49% | 0.1765 | 0.5294 | +55.2 | 72.3% → 72.3% | −0.6‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.4% | 76.92% | 0.1557 | 0.4752 | −55.2 | 76.7% → 76.8% | −0.4‰ |
| q1-10 | 10,431 | 37.2% | 40.7% | 69.35% | 0.1911 | 0.5653 | +175.8 | 69.0% → 69.2% | +0.1‰ |
| q11-25 | 10,412 | 37.1% | 35.8% | 74.28% | 0.1683 | 0.5099 | −62.1 | 74.2% → 74.1% | −1.2‰ |
| q26+ | 4,263 | 15.2% | 14.0% | 75.81% | 0.1606 | 0.4892 | −58.5 | 75.8% → 75.7% | −0.6‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 12,415 | 44.2% | 47.2% | 70.56% | 0.1859 | 0.5510 | +143.7 | 70.3% → 70.4% | +0.7‰ |
| 2nd | 6,952 | 24.8% | 24.1% | 73.97% | 0.1695 | 0.5134 | −33.2 | 73.8% → 73.8% | −1.4‰ |
| 3rd+ | 8,708 | 31.0% | 28.8% | 75.57% | 0.1616 | 0.4930 | −110.5 | 75.4% → 75.4% | −1.7‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 15,029 | 53.5% | 54.0% | 72.64% | 0.1757 | 0.5270 | +21.9 | 72.4% → 72.4% | −0.8‰ |
| veteran | 7,416 | 26.4% | 25.8% | 73.50% | 0.1701 | 0.5132 | −30.8 | 73.7% → 73.4% | −0.5‰ |
| year2 | 5,630 | 20.1% | 20.2% | 73.11% | 0.1759 | 0.5285 | +9.0 | 72.6% → 72.9% | +0.2‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 12,833 | 45.7% | 49.6% | 69.80% | 0.1890 | 0.5589 | +188.9 | 69.8% → 69.6% | +1.3‰ |
| 16+ | 4,861 | 17.3% | 16.1% | 75.62% | 0.1622 | 0.4938 | −58.7 | 76.0% → 75.5% | +1.8‰ |
| 6-15 | 10,381 | 37.0% | 34.3% | 75.62% | 0.1617 | 0.4941 | −130.3 | 74.9% → 75.4% | −3.9‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 7,119 | 25.4% | 23.1% | 76.24% | 0.1588 | 0.4865 | −110.0 | 76.4% → 76.1% | +1.0‰ |
| normal | 11,776 | 41.9% | 39.1% | 75.57% | 0.1624 | 0.4944 | −139.5 | 74.8% → 75.4% | −3.9‰ |
| thin | 9,180 | 32.7% | 37.8% | 67.05% | 0.2015 | 0.5900 | +249.5 | 67.3% → 66.9% | +2.6‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 6,533 | 23.3% | 27.5% | 65.78% | 0.2059 | 0.6011 | +206.6 | 65.5% → 65.6% | +0.8‰ |
| rest | 16,156 | 57.5% | 55.6% | 74.37% | 0.1685 | 0.5101 | −93.5 | 74.3% → 74.2% | −0.6‰ |
| top quartile | 5,386 | 19.2% | 16.9% | 77.40% | 0.1533 | 0.4703 | −113.0 | 77.0% → 77.3% | −2.2‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 6,510 | 23.2% | 23.4% | 73.07% | 0.1758 | 0.5288 | +10.1 | 73.6% → 72.9% | +4.5‰ |
| mid | 15,470 | 55.1% | 54.1% | 73.23% | 0.1712 | 0.5154 | −47.5 | 73.0% → 73.1% | −2.4‰ |
| small | 6,095 | 21.7% | 22.5% | 72.16% | 0.1804 | 0.5392 | +37.4 | 71.2% → 72.0% | −1.3‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 4,378 | 15.6% | 15.8% | 72.41% | 0.1768 | 0.5308 | +11.1 | 74.0% → 72.3% | +6.5‰ |
| league meet | 11,683 | 41.6% | 42.7% | 72.03% | 0.1787 | 0.5353 | +51.2 | 71.0% → 71.8% | −4.9‰ |
| qualifier | 11,417 | 40.7% | 39.6% | 73.88% | 0.1697 | 0.5112 | −52.7 | 73.9% → 73.7% | +1.0‰ |
| world | 597 | 2.1% | 1.9% | 77.55% | 0.1582 | 0.4812 | −9.6 | 76.9% → 77.6% | +3.1‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 7,210 | 25.7% | 36.1% | 54.50% | 0.2447 | 0.6883 | +507.7 | 54.3% → 54.4% | +0.4‰ |
| 60-70 | 5,778 | 20.6% | 26.6% | 64.75% | 0.2254 | 0.6480 | +295.4 | 64.8% → 64.6% | +0.3‰ |
| 70-80 | 5,261 | 18.7% | 19.9% | 75.08% | 0.1849 | 0.5604 | +56.0 | 74.9% → 74.9% | −1.5‰ |
| 80-90 | 5,006 | 17.8% | 12.5% | 85.67% | 0.1217 | 0.4095 | −263.0 | 84.9% → 85.5% | −5.8‰ |
| 90-100 | 4,820 | 17.2% | 5.0% | 94.64% | 0.0506 | 0.2069 | −596.0 | 95.0% → 94.5% | +3.6‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 13,359 | 47.6% | 52.6% | 72.08% | 0.1928 | 0.5757 | +247.2 | 71.7% → 71.9% | −1.4‰ |
| close | 7,329 | 26.1% | 36.4% | 55.36% | 0.2430 | 0.6842 | +503.4 | 55.6% → 55.3% | +0.9‰ |
| lopsided | 7,387 | 26.3% | 11.0% | 91.87% | 0.0727 | 0.2703 | −750.5 | 91.7% → 91.7% | −0.4‰ |

## Champion, 2024–25 (in-sample for the champion)

Top excess-Brier slices: Event phase: qualification match number **q1-10** (+188.0); Data density (all four robots' rated matches) **thin** (+166.0); Rated matches this season (fewest on the field) **0-5** (+107.1)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,438 | 54.9% | 54.7% | 0.2% | 0.3% |
| 60-70% | 6,053 | 65.1% | 65.6% | 0.6% | 0.6% |
| 70-80% | 5,960 | 74.9% | 76.1% | 1.2% | 1.1% |
| 80-90% | 6,262 | 85.1% | 83.9% | 1.2% | 1.1% |
| 90-100% | 8,558 | 95.5% | 94.8% | 0.7% | 0.2% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.34% | 0.1501 | 0.4622 | −31.3 | 77.2% → 78.1% | −2.4‰ |
| qual | 28,885 | 86.8% | 87.4% | 76.27% | 0.1583 | 0.4836 | +31.3 | 76.4% → 76.1% | +1.9‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.34% | 0.1501 | 0.4622 | −31.3 | 77.2% → 78.1% | −2.4‰ |
| q1-10 | 10,927 | 32.8% | 36.4% | 73.17% | 0.1744 | 0.5257 | +188.0 | 73.6% → 73.0% | +3.9‰ |
| q11-25 | 11,671 | 35.1% | 33.8% | 77.66% | 0.1513 | 0.4651 | −69.4 | 77.5% → 77.5% | +0.6‰ |
| q26+ | 6,287 | 18.9% | 17.2% | 79.07% | 0.1433 | 0.4448 | −87.3 | 79.0% → 78.9% | +0.9‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 14,138 | 42.5% | 44.0% | 75.24% | 0.1628 | 0.4955 | +79.1 | 75.0% → 75.0% | −0.7‰ |
| 2nd | 8,049 | 24.2% | 23.4% | 77.65% | 0.1519 | 0.4666 | −42.6 | 77.4% → 77.5% | +0.5‰ |
| 3rd+ | 11,084 | 33.3% | 32.6% | 77.39% | 0.1539 | 0.4722 | −36.5 | 77.7% → 77.2% | +4.5‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 16,718 | 50.2% | 51.1% | 76.01% | 0.1599 | 0.4891 | +45.2 | 76.1% → 75.8% | +2.3‰ |
| veteran | 8,250 | 24.8% | 24.5% | 76.84% | 0.1555 | 0.4757 | −13.9 | 76.5% → 76.7% | −0.3‰ |
| year2 | 8,303 | 25.0% | 24.4% | 77.32% | 0.1535 | 0.4690 | −31.3 | 77.1% → 77.2% | +0.9‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 14,202 | 42.7% | 44.7% | 74.90% | 0.1648 | 0.5007 | +107.1 | 74.6% → 74.7% | −0.8‰ |
| 16+ | 6,847 | 20.6% | 20.5% | 77.11% | 0.1562 | 0.4760 | −6.7 | 77.4% → 77.0% | +4.8‰ |
| 6-15 | 12,222 | 36.7% | 34.8% | 78.13% | 0.1490 | 0.4603 | −100.4 | 78.2% → 77.9% | +1.8‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 10,110 | 30.4% | 29.8% | 77.58% | 0.1541 | 0.4723 | −31.5 | 78.1% → 77.4% | +6.7‰ |
| normal | 13,190 | 39.6% | 37.1% | 78.34% | 0.1470 | 0.4547 | −134.4 | 78.0% → 78.1% | −1.0‰ |
| thin | 9,971 | 30.0% | 33.1% | 73.09% | 0.1739 | 0.5238 | +166.0 | 72.8% → 72.9% | −1.0‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 7,418 | 22.3% | 25.4% | 71.99% | 0.1789 | 0.5355 | +160.4 | 72.1% → 71.7% | +0.7‰ |
| rest | 19,389 | 58.3% | 55.6% | 78.04% | 0.1500 | 0.4628 | −140.7 | 77.7% → 77.8% | +0.3‰ |
| top quartile | 6,464 | 19.4% | 19.1% | 77.25% | 0.1542 | 0.4717 | −19.7 | 77.9% → 77.1% | +5.1‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 8,980 | 27.0% | 26.9% | 76.78% | 0.1568 | 0.4793 | −3.5 | 76.7% → 76.6% | +2.2‰ |
| mid | 18,322 | 55.1% | 55.1% | 76.50% | 0.1573 | 0.4813 | +1.0 | 76.6% → 76.3% | +2.4‰ |
| small | 5,969 | 17.9% | 18.0% | 76.33% | 0.1576 | 0.4814 | +2.5 | 75.5% → 76.1% | −3.2‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 6,344 | 19.1% | 19.5% | 76.72% | 0.1608 | 0.4900 | +22.8 | 77.1% → 76.6% | +7.8‰ |
| league meet | 12,322 | 37.0% | 36.7% | 76.67% | 0.1558 | 0.4780 | −17.7 | 75.5% → 76.4% | −4.8‰ |
| qualifier | 13,903 | 41.8% | 41.6% | 76.35% | 0.1565 | 0.4778 | −10.6 | 77.0% → 76.2% | +3.3‰ |
| world | 702 | 2.1% | 2.2% | 76.50% | 0.1651 | 0.5037 | +5.6 | 77.1% → 76.4% | +11.5‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 6,438 | 19.4% | 30.0% | 54.80% | 0.2436 | 0.6879 | +556.1 | 54.9% → 54.7% | +0.6‰ |
| 60-70 | 6,053 | 18.2% | 25.8% | 65.76% | 0.2233 | 0.6430 | +399.8 | 65.1% → 65.6% | −1.5‰ |
| 70-80 | 5,960 | 17.9% | 20.5% | 76.29% | 0.1796 | 0.5490 | +133.3 | 74.9% → 76.1% | −6.5‰ |
| 80-90 | 6,262 | 18.8% | 15.9% | 84.11% | 0.1332 | 0.4396 | −150.3 | 85.1% → 83.9% | +7.3‰ |
| 90-100 | 8,558 | 25.7% | 7.8% | 94.94% | 0.0475 | 0.1927 | −938.9 | 95.5% → 94.8% | +5.0‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 14,882 | 44.7% | 53.9% | 72.76% | 0.1895 | 0.5682 | +480.9 | 72.1% → 72.6% | −3.1‰ |
| close | 6,349 | 19.1% | 29.0% | 56.76% | 0.2392 | 0.6786 | +520.4 | 56.3% → 56.7% | −1.4‰ |
| lopsided | 12,040 | 36.2% | 17.0% | 91.51% | 0.0741 | 0.2683 | −1001.3 | 92.6% → 91.4% | +8.2‰ |

## Baselines on 2025–26 (reused)

### v2.0

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+210.3); Event phase: qualification match number **q1-10** (+169.8); Rated matches this season (fewest on the field) **0-5** (+145.1)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,425 | 54.9% | 55.6% | 0.6% | 0.6% |
| 60-70% | 8,010 | 65.0% | 65.5% | 0.5% | 0.5% |
| 70-80% | 7,319 | 74.9% | 77.3% | 2.4% | 2.3% |
| 80-90% | 6,883 | 84.9% | 86.5% | 1.6% | 1.5% |
| 90-100% | 6,205 | 94.8% | 94.9% | 0.1% | 0.1% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.71% | 0.1569 | 0.4821 | −56.2 | 75.3% → 76.5% | −7.4‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.31% | 0.1697 | 0.5131 | +56.2 | 73.1% → 74.1% | −5.5‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.71% | 0.1569 | 0.4821 | −56.2 | 75.3% → 76.5% | −7.4‰ |
| q1-10 | 11,613 | 31.5% | 34.3% | 71.82% | 0.1825 | 0.5463 | +169.8 | 70.8% → 71.6% | −3.8‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.53% | 0.1634 | 0.4971 | −56.7 | 74.1% → 75.3% | −7.0‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.14% | 0.1602 | 0.4886 | −56.9 | 75.0% → 76.0% | −5.7‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.0% | 73.09% | 0.1747 | 0.5262 | +105.5 | 71.7% → 72.9% | −7.2‰ |
| 2nd | 8,732 | 23.7% | 23.0% | 75.84% | 0.1627 | 0.4944 | −45.8 | 74.4% → 75.7% | −6.0‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.75% | 0.1631 | 0.4972 | −59.8 | 74.8% → 75.6% | −3.9‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.68% | 0.1693 | 0.5126 | +24.3 | 73.3% → 74.5% | −4.9‰ |
| veteran | 10,384 | 28.2% | 27.8% | 75.05% | 0.1659 | 0.5031 | −21.2 | 73.7% → 74.9% | −6.8‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.14% | 0.1676 | 0.5083 | −3.1 | 73.3% → 73.9% | −6.3‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.65% | 0.1773 | 0.5327 | +145.1 | 71.4% → 72.4% | −6.1‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.59% | 0.1630 | 0.4961 | −40.1 | 75.0% → 75.4% | −3.3‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.38% | 0.1599 | 0.4889 | −105.1 | 74.8% → 76.2% | −7.0‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.01% | 0.1606 | 0.4895 | −86.8 | 75.4% → 75.9% | −3.3‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.47% | 0.1592 | 0.4869 | −123.5 | 74.6% → 76.3% | −8.9‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.78% | 0.1872 | 0.5584 | +210.3 | 69.7% → 70.6% | −4.4‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 69.94% | 0.1904 | 0.5657 | +180.3 | 69.0% → 69.7% | −4.5‰ |
| rest | 21,629 | 58.7% | 56.3% | 75.98% | 0.1610 | 0.4915 | −149.0 | 74.5% → 75.8% | −7.0‰ |
| top quartile | 7,210 | 19.6% | 19.1% | 75.85% | 0.1636 | 0.4978 | −31.3 | 74.9% → 75.7% | −3.6‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.9% | 75.53% | 0.1651 | 0.5006 | −29.2 | 74.0% → 75.4% | −6.2‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.23% | 0.1691 | 0.5117 | +24.0 | 73.5% → 74.0% | −4.0‰ |
| small | 5,835 | 15.8% | 15.9% | 74.54% | 0.1688 | 0.5134 | +5.2 | 71.9% → 74.3% | −11.3‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 75.08% | 0.1663 | 0.5030 | −12.4 | 74.4% → 74.9% | −2.7‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.78% | 0.1727 | 0.5215 | +59.2 | 72.2% → 73.6% | −7.1‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.15% | 0.1648 | 0.5017 | −49.2 | 73.8% → 75.0% | −6.7‰ |
| world | 943 | 2.6% | 2.6% | 74.15% | 0.1704 | 0.5105 | +2.4 | 74.7% → 74.1% | +2.4‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,425 | 22.9% | 33.1% | 55.65% | 0.2431 | 0.6850 | +633.6 | 54.9% → 55.6% | −0.9‰ |
| 60-70 | 8,010 | 21.7% | 28.8% | 65.65% | 0.2228 | 0.6424 | +439.5 | 65.0% → 65.5% | −2.1‰ |
| 70-80 | 7,319 | 19.9% | 20.5% | 77.56% | 0.1730 | 0.5345 | +37.3 | 74.9% → 77.3% | −13.3‰ |
| 80-90 | 6,883 | 18.7% | 12.8% | 86.69% | 0.1153 | 0.3941 | −362.3 | 84.9% → 86.5% | −11.9‰ |
| 90-100 | 6,205 | 16.8% | 4.7% | 94.98% | 0.0473 | 0.1942 | −748.1 | 94.8% → 94.9% | −1.5‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,931 | 51.4% | 56.2% | 73.79% | 0.1835 | 0.5542 | +294.9 | 71.9% → 73.6% | −9.6‰ |
| close | 8,460 | 23.0% | 32.9% | 57.08% | 0.2403 | 0.6788 | +612.3 | 56.4% → 57.0% | −1.0‰ |
| lopsided | 9,451 | 25.7% | 11.0% | 91.95% | 0.0719 | 0.2658 | −907.2 | 91.6% → 91.9% | −2.5‰ |

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
