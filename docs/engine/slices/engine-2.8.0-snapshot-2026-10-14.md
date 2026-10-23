# Engine error report: 2.8.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts`. Engine 2.8.0 (champion model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23`). Data version 2026-10-14T04:19:58.853Z.

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
| 2023–24 | champion | 28,075 | 72.93% | 0.1742 | 0.5234 | 0.83% |
| 2023–24 | v2.0 | 28,075 | 72.82% | 0.1747 | 0.5247 | 0.95% |
| 2023–24 | legacy | 28,075 | 72.15% | 0.1796 | 0.5373 | 0.63% |
| 2024–25 | champion | 33,271 | 76.49% | 0.1574 | 0.4812 | 0.82% |
| 2024–25 | v2.0 | 33,271 | 76.30% | 0.1579 | 0.4829 | 0.83% |
| 2024–25 | legacy | 33,271 | 75.84% | 0.1619 | 0.4944 | 0.94% |
| 2025–26 (reused) | champion | 36,842 | 74.82% | 0.1677 | 0.5083 | 0.96% |
| 2025–26 (reused) | v2.0 | 36,842 | 74.60% | 0.1683 | 0.5099 | 1.13% |
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
| 1 | Data density (all four robots' rated matches): **thin** | +213.0 | 32.9% | 29.5% |
| 2 | Event phase: qualification match number: **q1-10** | +169.9 | 34.3% | 31.5% |
| 3 | Rated matches this season (fewest on the field): **0-5** | +146.4 | 44.1% | 41.8% |

**Surprise** is the mean of (p − y)² − p(1 − p) over decided matches (ties left out): the Brier above what the model's own probabilities expected. Above zero means the model is too sure in that slice; below zero means too timid. **Fav. stated → won** compares the favourite's mean stated chance with how often it won.

### Calibration by stated chance (champion, 2025–26 (reused))

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,139 | 55.0% | 56.1% | 1.1% | 1.1% |
| 60-70% | 7,819 | 64.9% | 65.1% | 0.1% | 0.1% |
| 70-80% | 7,215 | 74.9% | 76.6% | 1.7% | 1.6% |
| 80-90% | 7,002 | 85.0% | 85.9% | 0.9% | 0.9% |
| 90-100% | 6,667 | 94.9% | 94.5% | 0.4% | 0.5% |

### All slices (champion, 2025–26 (reused))

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.82% | 0.1571 | 0.4829 | −54.1 | 75.8% → 76.6% | −4.6‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.49% | 0.1694 | 0.5125 | +54.1 | 73.6% → 74.3% | −2.9‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.82% | 0.1571 | 0.4829 | −54.1 | 75.8% → 76.6% | −4.6‰ |
| q1-10 | 11,613 | 31.5% | 34.3% | 72.09% | 0.1823 | 0.5458 | +169.9 | 71.0% → 71.9% | −3.2‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.72% | 0.1632 | 0.4963 | −57.7 | 74.6% → 75.5% | −4.5‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.15% | 0.1599 | 0.4878 | −58.1 | 76.2% → 76.0% | +0.6‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.18% | 0.1748 | 0.5264 | +110.2 | 72.1% → 73.0% | −5.1‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 76.11% | 0.1622 | 0.4933 | −47.9 | 74.9% → 76.0% | −3.5‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.95% | 0.1627 | 0.4964 | −62.2 | 75.5% → 75.8% | −0.4‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.1% | 74.85% | 0.1693 | 0.5126 | +27.5 | 73.8% → 74.7% | −2.0‰ |
| veteran | 10,384 | 28.2% | 27.8% | 75.20% | 0.1656 | 0.5028 | −21.8 | 74.2% → 75.0% | −4.2‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.32% | 0.1671 | 0.5067 | −5.7 | 73.8% → 74.1% | −4.0‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.71% | 0.1772 | 0.5324 | +146.4 | 71.7% → 72.5% | −4.4‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.78% | 0.1628 | 0.4957 | −40.4 | 75.8% → 75.6% | +1.1‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.66% | 0.1597 | 0.4882 | −106.0 | 75.3% → 76.5% | −4.2‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.19% | 0.1602 | 0.4887 | −89.2 | 76.2% → 76.0% | +0.6‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.73% | 0.1590 | 0.4864 | −123.8 | 75.0% → 76.6% | −6.5‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.83% | 0.1873 | 0.5583 | +213.0 | 70.1% → 70.6% | −2.7‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 69.99% | 0.1902 | 0.5652 | +180.3 | 69.4% → 69.8% | −2.6‰ |
| rest | 21,629 | 58.7% | 56.3% | 76.14% | 0.1608 | 0.4909 | −148.5 | 75.1% → 76.0% | −4.1‰ |
| top quartile | 7,210 | 19.6% | 19.1% | 76.18% | 0.1633 | 0.4977 | −31.7 | 75.4% → 76.1% | −0.5‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 75.64% | 0.1646 | 0.4995 | −32.3 | 74.6% → 75.5% | −3.3‰ |
| mid | 20,568 | 55.8% | 56.3% | 74.33% | 0.1690 | 0.5115 | +27.1 | 74.1% → 74.2% | −1.2‰ |
| small | 5,835 | 15.8% | 15.9% | 75.04% | 0.1686 | 0.5132 | +5.1 | 72.3% → 74.8% | −9.2‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 75.15% | 0.1664 | 0.5031 | −10.4 | 75.1% → 75.0% | +1.5‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.92% | 0.1724 | 0.5210 | +58.4 | 72.7% → 73.7% | −4.9‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.39% | 0.1646 | 0.5010 | −49.9 | 74.2% → 75.2% | −4.6‰ |
| world | 943 | 2.6% | 2.6% | 74.15% | 0.1697 | 0.5089 | +1.9 | 75.8% → 74.1% | +8.3‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,139 | 22.1% | 32.0% | 56.16% | 0.2432 | 0.6853 | +614.2 | 55.0% → 56.1% | −0.7‰ |
| 60-70 | 7,819 | 21.2% | 28.4% | 65.23% | 0.2242 | 0.6453 | +441.7 | 64.9% → 65.1% | −0.7‰ |
| 70-80 | 7,215 | 19.6% | 20.6% | 76.81% | 0.1765 | 0.5422 | +63.4 | 74.9% → 76.6% | −9.6‰ |
| 80-90 | 7,002 | 19.0% | 13.5% | 86.07% | 0.1194 | 0.4042 | −338.6 | 85.0% → 85.9% | −7.5‰ |
| 90-100 | 6,667 | 18.1% | 5.5% | 94.61% | 0.0506 | 0.2045 | −780.8 | 94.9% → 94.5% | +2.8‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,473 | 50.1% | 56.1% | 71.99% | 0.1876 | 0.5619 | +367.1 | 71.2% → 71.8% | −4.7‰ |
| close | 8,032 | 21.8% | 29.7% | 61.79% | 0.2286 | 0.6539 | +489.0 | 59.9% → 61.7% | −3.6‰ |
| lopsided | 10,337 | 28.1% | 14.2% | 89.90% | 0.0849 | 0.2996 | −856.1 | 89.7% → 89.8% | +0.1‰ |

## Champion, 2023–24 (in-sample for the champion)

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+249.5); Rated matches this season (fewest on the field) **0-5** (+189.0); Event phase: qualification match number **q1-10** (+176.2)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,282 | 54.3% | 54.4% | 0.1% | 0.6% |
| 60-70% | 5,890 | 64.8% | 64.5% | 0.3% | 0.5% |
| 70-80% | 5,260 | 74.9% | 75.5% | 0.6% | 0.5% |
| 80-90% | 4,919 | 84.9% | 85.9% | 1.0% | 0.9% |
| 90-100% | 4,724 | 95.0% | 94.6% | 0.3% | 0.4% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.4% | 77.02% | 0.1555 | 0.4749 | −55.4 | 76.6% → 76.9% | −0.8‰ |
| qual | 25,106 | 89.4% | 90.6% | 72.44% | 0.1764 | 0.5292 | +55.4 | 72.1% → 72.3% | −1.7‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.4% | 77.02% | 0.1555 | 0.4749 | −55.4 | 76.6% → 76.9% | −0.8‰ |
| q1-10 | 10,431 | 37.2% | 40.8% | 69.18% | 0.1911 | 0.5651 | +176.2 | 68.8% → 69.0% | −1.0‰ |
| q11-25 | 10,412 | 37.1% | 35.8% | 74.33% | 0.1682 | 0.5096 | −62.3 | 74.0% → 74.1% | −2.5‰ |
| q26+ | 4,263 | 15.2% | 14.0% | 75.81% | 0.1605 | 0.4891 | −58.4 | 75.6% → 75.7% | −1.7‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 12,415 | 44.2% | 47.2% | 70.40% | 0.1859 | 0.5509 | +144.7 | 70.0% → 70.2% | −0.6‰ |
| 2nd | 6,952 | 24.8% | 24.1% | 73.79% | 0.1693 | 0.5130 | −33.7 | 73.7% → 73.6% | −2.4‰ |
| 3rd+ | 8,708 | 31.0% | 28.7% | 75.84% | 0.1615 | 0.4925 | −111.0 | 75.3% → 75.7% | −2.4‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 15,029 | 53.5% | 54.0% | 72.51% | 0.1756 | 0.5267 | +21.3 | 72.2% → 72.3% | −2.0‰ |
| veteran | 7,416 | 26.4% | 25.8% | 73.71% | 0.1701 | 0.5130 | −30.6 | 73.5% → 73.6% | −1.5‰ |
| year2 | 5,630 | 20.1% | 20.2% | 73.00% | 0.1759 | 0.5283 | +9.4 | 72.4% → 72.8% | −0.8‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 12,833 | 45.7% | 49.6% | 69.66% | 0.1889 | 0.5587 | +189.0 | 69.5% → 69.5% | −0.2‰ |
| 16+ | 4,861 | 17.3% | 16.1% | 75.70% | 0.1621 | 0.4935 | −58.9 | 75.9% → 75.6% | +1.1‰ |
| 6-15 | 10,381 | 37.0% | 34.3% | 75.67% | 0.1617 | 0.4938 | −130.1 | 74.8% → 75.5% | −4.6‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 7,119 | 25.4% | 23.1% | 76.36% | 0.1588 | 0.4865 | −109.3 | 76.3% → 76.2% | +0.4‰ |
| normal | 11,776 | 41.9% | 39.1% | 75.54% | 0.1623 | 0.4941 | −140.2 | 74.7% → 75.3% | −4.7‰ |
| thin | 9,180 | 32.7% | 37.8% | 66.91% | 0.2014 | 0.5897 | +249.5 | 66.9% → 66.7% | +0.8‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 6,533 | 23.3% | 27.5% | 65.58% | 0.2057 | 0.6004 | +205.7 | 65.1% → 65.4% | −1.4‰ |
| rest | 16,156 | 57.5% | 55.6% | 74.36% | 0.1684 | 0.5101 | −93.0 | 74.2% → 74.2% | −1.2‰ |
| top quartile | 5,386 | 19.2% | 16.9% | 77.51% | 0.1533 | 0.4701 | −112.7 | 76.8% → 77.4% | −3.0‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 6,510 | 23.2% | 23.4% | 73.03% | 0.1755 | 0.5278 | +8.3 | 73.5% → 72.9% | +3.2‰ |
| mid | 15,470 | 55.1% | 54.2% | 73.26% | 0.1713 | 0.5157 | −44.4 | 72.8% → 73.1% | −3.2‰ |
| small | 6,095 | 21.7% | 22.4% | 71.98% | 0.1801 | 0.5383 | +36.1 | 71.0% → 71.8% | −2.6‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 4,378 | 15.6% | 15.8% | 72.60% | 0.1767 | 0.5301 | +10.8 | 73.8% → 72.5% | +5.5‰ |
| league meet | 11,683 | 41.6% | 42.7% | 71.80% | 0.1786 | 0.5352 | +51.3 | 70.8% → 71.6% | −5.9‰ |
| qualifier | 11,417 | 40.7% | 39.6% | 73.99% | 0.1696 | 0.5111 | −52.5 | 73.7% → 73.8% | −0.1‰ |
| world | 597 | 2.1% | 1.9% | 77.22% | 0.1580 | 0.4808 | −9.7 | 76.8% → 77.2% | +2.2‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 7,282 | 25.9% | 36.5% | 54.43% | 0.2448 | 0.6881 | +514.2 | 54.3% → 54.4% | +0.3‰ |
| 60-70 | 5,890 | 21.0% | 27.2% | 64.69% | 0.2256 | 0.6487 | +302.6 | 64.8% → 64.5% | +0.6‰ |
| 70-80 | 5,260 | 18.7% | 19.6% | 75.68% | 0.1822 | 0.5543 | +41.9 | 74.9% → 75.5% | −4.0‰ |
| 80-90 | 4,919 | 17.5% | 12.0% | 86.03% | 0.1191 | 0.4027 | −271.1 | 84.9% → 85.9% | −8.5‰ |
| 90-100 | 4,724 | 16.8% | 4.8% | 94.74% | 0.0498 | 0.2046 | −587.6 | 95.0% → 94.6% | +2.5‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 13,347 | 47.5% | 52.7% | 71.43% | 0.1933 | 0.5756 | +254.5 | 70.7% → 71.3% | −3.3‰ |
| close | 7,132 | 25.4% | 35.0% | 56.53% | 0.2401 | 0.6785 | +469.8 | 56.9% → 56.5% | +1.4‰ |
| lopsided | 7,596 | 27.1% | 12.2% | 90.83% | 0.0788 | 0.2861 | −724.3 | 90.6% → 90.7% | −1.4‰ |

## Champion, 2024–25 (in-sample for the champion)

Top excess-Brier slices: Event phase: qualification match number **q1-10** (+188.5); Data density (all four robots' rated matches) **thin** (+167.5); Rated matches this season (fewest on the field) **0-5** (+109.0)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,490 | 54.9% | 54.6% | 0.3% | 0.4% |
| 60-70% | 6,108 | 65.0% | 65.6% | 0.6% | 0.6% |
| 70-80% | 6,028 | 74.9% | 76.4% | 1.5% | 1.4% |
| 80-90% | 6,238 | 85.1% | 84.0% | 1.1% | 1.0% |
| 90-100% | 8,407 | 95.5% | 94.9% | 0.6% | 0.1% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.31% | 0.1501 | 0.4621 | −32.0 | 77.2% → 78.1% | −2.6‰ |
| qual | 28,885 | 86.8% | 87.4% | 76.21% | 0.1585 | 0.4841 | +32.0 | 76.2% → 76.0% | +1.1‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.31% | 0.1501 | 0.4621 | −32.0 | 77.2% → 78.1% | −2.6‰ |
| q1-10 | 10,927 | 32.8% | 36.4% | 73.09% | 0.1746 | 0.5261 | +188.5 | 73.5% → 72.9% | +3.1‰ |
| q11-25 | 11,671 | 35.1% | 33.8% | 77.57% | 0.1515 | 0.4658 | −68.7 | 77.3% → 77.4% | −0.3‰ |
| q26+ | 6,287 | 18.9% | 17.2% | 79.11% | 0.1434 | 0.4449 | −87.8 | 78.8% → 78.9% | +0.1‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 14,138 | 42.5% | 44.0% | 75.19% | 0.1631 | 0.4962 | +80.6 | 74.7% → 75.0% | −1.7‰ |
| 2nd | 8,049 | 24.2% | 23.4% | 77.47% | 0.1519 | 0.4665 | −44.0 | 77.3% → 77.3% | −0.2‰ |
| 3rd+ | 11,084 | 33.3% | 32.6% | 77.42% | 0.1541 | 0.4728 | −36.7 | 77.6% → 77.3% | +4.1‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 16,718 | 50.2% | 51.1% | 75.96% | 0.1601 | 0.4895 | +45.3 | 75.9% → 75.7% | +1.6‰ |
| veteran | 8,250 | 24.8% | 24.5% | 76.92% | 0.1556 | 0.4760 | −14.9 | 76.4% → 76.8% | −1.0‰ |
| year2 | 8,303 | 25.0% | 24.4% | 77.11% | 0.1537 | 0.4695 | −30.5 | 77.0% → 76.9% | +0.2‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 14,202 | 42.7% | 44.8% | 74.85% | 0.1651 | 0.5014 | +109.0 | 74.3% → 74.6% | −1.7‰ |
| 16+ | 6,847 | 20.6% | 20.4% | 77.15% | 0.1564 | 0.4763 | −7.0 | 77.3% → 77.0% | +4.4‰ |
| 6-15 | 12,222 | 36.7% | 34.8% | 78.01% | 0.1490 | 0.4604 | −102.1 | 78.0% → 77.8% | +1.2‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 10,110 | 30.4% | 29.8% | 77.56% | 0.1542 | 0.4726 | −31.9 | 78.0% → 77.4% | +6.3‰ |
| normal | 13,190 | 39.6% | 37.1% | 78.27% | 0.1471 | 0.4550 | −135.6 | 77.9% → 78.1% | −1.7‰ |
| thin | 9,971 | 30.0% | 33.2% | 73.02% | 0.1742 | 0.5246 | +167.5 | 72.5% → 72.8% | −2.1‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 7,418 | 22.3% | 25.4% | 71.91% | 0.1791 | 0.5360 | +161.0 | 71.8% → 71.7% | −0.5‰ |
| rest | 19,389 | 58.3% | 55.5% | 77.99% | 0.1500 | 0.4630 | −142.8 | 77.5% → 77.8% | −0.3‰ |
| top quartile | 6,464 | 19.4% | 19.1% | 77.21% | 0.1546 | 0.4729 | −18.2 | 77.8% → 77.1% | +4.5‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 8,980 | 27.0% | 26.9% | 76.54% | 0.1571 | 0.4799 | −2.5 | 76.6% → 76.4% | +1.5‰ |
| mid | 18,322 | 55.1% | 55.1% | 76.48% | 0.1574 | 0.4815 | −0.5 | 76.5% → 76.3% | +1.6‰ |
| small | 5,969 | 17.9% | 18.0% | 76.45% | 0.1579 | 0.4820 | +3.1 | 75.3% → 76.2% | −3.9‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 6,344 | 19.1% | 19.5% | 76.64% | 0.1610 | 0.4902 | +22.7 | 76.9% → 76.5% | +7.1‰ |
| league meet | 12,322 | 37.0% | 36.7% | 76.58% | 0.1560 | 0.4785 | −17.7 | 75.4% → 76.3% | −5.6‰ |
| qualifier | 13,903 | 41.8% | 41.6% | 76.35% | 0.1566 | 0.4782 | −10.9 | 76.8% → 76.2% | +2.6‰ |
| world | 702 | 2.1% | 2.2% | 76.22% | 0.1658 | 0.5050 | +5.9 | 76.9% → 76.1% | +11.1‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 6,490 | 19.5% | 30.2% | 54.69% | 0.2438 | 0.6882 | +560.5 | 54.9% → 54.6% | +0.7‰ |
| 60-70 | 6,108 | 18.4% | 26.0% | 65.76% | 0.2233 | 0.6430 | +402.8 | 65.0% → 65.6% | −1.6‰ |
| 70-80 | 6,028 | 18.1% | 20.4% | 76.66% | 0.1776 | 0.5444 | +121.6 | 74.9% → 76.4% | −8.4‰ |
| 80-90 | 6,238 | 18.7% | 15.8% | 84.21% | 0.1326 | 0.4382 | −154.7 | 85.1% → 84.0% | +6.7‰ |
| 90-100 | 8,407 | 25.3% | 7.5% | 95.03% | 0.0468 | 0.1903 | −930.2 | 95.5% → 94.9% | +4.1‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 14,947 | 44.9% | 54.0% | 72.56% | 0.1893 | 0.5679 | +477.1 | 71.8% → 72.4% | −3.7‰ |
| close | 6,365 | 19.1% | 28.9% | 57.48% | 0.2380 | 0.6759 | +513.1 | 56.8% → 57.4% | −1.3‰ |
| lopsided | 11,959 | 35.9% | 17.0% | 91.38% | 0.0746 | 0.2691 | −990.2 | 92.3% → 91.2% | +7.0‰ |

## Baselines on 2025–26 (reused)

### v2.0

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+210.3); Event phase: qualification match number **q1-10** (+172.2); Rated matches this season (fewest on the field) **0-5** (+145.3)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,473 | 55.0% | 55.5% | 0.5% | 0.5% |
| 60-70% | 8,021 | 65.0% | 65.7% | 0.8% | 0.7% |
| 70-80% | 7,297 | 74.9% | 77.2% | 2.3% | 2.2% |
| 80-90% | 6,942 | 84.9% | 86.6% | 1.7% | 1.6% |
| 90-100% | 6,109 | 94.8% | 94.8% | 0.0% | 0.2% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.79% | 0.1572 | 0.4829 | −57.0 | 75.4% → 76.6% | −6.9‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.24% | 0.1701 | 0.5143 | +57.0 | 73.0% → 74.1% | −5.4‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.79% | 0.1572 | 0.4829 | −57.0 | 75.4% → 76.6% | −6.9‰ |
| q1-10 | 11,613 | 31.5% | 34.3% | 71.80% | 0.1832 | 0.5479 | +172.2 | 70.8% → 71.6% | −3.3‰ |
| q11-25 | 12,697 | 34.5% | 33.6% | 75.45% | 0.1639 | 0.4984 | −56.0 | 74.0% → 75.3% | −6.9‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.00% | 0.1603 | 0.4889 | −59.2 | 74.9% → 75.9% | −6.2‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.05% | 0.1752 | 0.5277 | +107.8 | 71.6% → 72.9% | −6.9‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 75.99% | 0.1628 | 0.4949 | −48.1 | 74.4% → 75.8% | −6.0‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.55% | 0.1636 | 0.4983 | −59.7 | 74.8% → 75.4% | −3.8‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.71% | 0.1698 | 0.5139 | +25.9 | 73.2% → 74.5% | −4.6‰ |
| veteran | 10,384 | 28.2% | 27.8% | 74.95% | 0.1663 | 0.5045 | −21.5 | 73.6% → 74.8% | −6.7‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.01% | 0.1678 | 0.5088 | −4.5 | 73.3% → 73.8% | −6.3‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.55% | 0.1778 | 0.5339 | +145.3 | 71.3% → 72.4% | −6.0‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.40% | 0.1634 | 0.4971 | −40.3 | 74.9% → 75.2% | −3.5‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.48% | 0.1604 | 0.4901 | −105.0 | 74.8% → 76.3% | −6.5‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 75.94% | 0.1610 | 0.4906 | −86.8 | 75.3% → 75.8% | −3.4‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.46% | 0.1596 | 0.4880 | −123.5 | 74.6% → 76.3% | −8.4‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.70% | 0.1877 | 0.5595 | +210.3 | 69.6% → 70.5% | −4.5‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 69.88% | 0.1907 | 0.5666 | +179.3 | 68.9% → 69.7% | −4.6‰ |
| rest | 21,629 | 58.7% | 56.3% | 75.98% | 0.1614 | 0.4924 | −149.8 | 74.5% → 75.8% | −6.7‰ |
| top quartile | 7,210 | 19.6% | 19.1% | 75.68% | 0.1642 | 0.4996 | −29.4 | 74.7% → 75.6% | −3.6‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 75.39% | 0.1654 | 0.5014 | −30.6 | 73.9% → 75.3% | −6.4‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.22% | 0.1695 | 0.5128 | +24.9 | 73.5% → 74.0% | −3.7‰ |
| small | 5,835 | 15.8% | 15.9% | 74.51% | 0.1693 | 0.5149 | +5.7 | 71.9% → 74.3% | −10.9‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 74.96% | 0.1668 | 0.5045 | −11.5 | 74.3% → 74.8% | −2.7‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.63% | 0.1730 | 0.5225 | +58.0 | 72.2% → 73.4% | −6.9‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.22% | 0.1653 | 0.5028 | −48.8 | 73.8% → 75.0% | −6.4‰ |
| world | 943 | 2.6% | 2.6% | 73.83% | 0.1707 | 0.5112 | +2.3 | 74.5% → 73.8% | +1.7‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,473 | 23.0% | 33.2% | 55.60% | 0.2433 | 0.6853 | +634.9 | 55.0% → 55.5% | −0.7‰ |
| 60-70 | 8,021 | 21.8% | 28.7% | 65.89% | 0.2222 | 0.6413 | +432.1 | 65.0% → 65.7% | −2.7‰ |
| 70-80 | 7,297 | 19.8% | 20.4% | 77.43% | 0.1737 | 0.5359 | +39.1 | 74.9% → 77.2% | −12.7‰ |
| 80-90 | 6,942 | 18.8% | 12.8% | 86.78% | 0.1146 | 0.3925 | −372.7 | 84.9% → 86.6% | −12.4‰ |
| 90-100 | 6,109 | 16.6% | 4.8% | 94.87% | 0.0483 | 0.1967 | −733.4 | 94.8% → 94.8% | −0.2‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,473 | 50.1% | 56.1% | 71.99% | 0.1883 | 0.5637 | +368.5 | 70.6% → 71.8% | −7.4‰ |
| close | 8,032 | 21.8% | 29.7% | 60.80% | 0.2294 | 0.6558 | +490.8 | 59.3% → 60.7% | −4.4‰ |
| lopsided | 10,337 | 28.1% | 14.2% | 89.88% | 0.0852 | 0.3006 | −859.3 | 89.2% → 89.7% | −3.5‰ |

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
