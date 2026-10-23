# Engine error report: 3.0.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts`. Engine 3.0.0 (champion model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23`). Data version 2026-10-14T04:19:58.853Z.

Every match is predicted from earlier results only, in the backtest ledger's order and with its exclusions. The replay is checked against the served prediction call (`explainMatch`) on 664 matches. Slices with fewer than 200 matches are marked ⚠ low n and are never ranked.

## Corpus

| Season | Events | Unrated events | Matches | Predicted | Predicted at rated events | Surrogate matches | sha256 (match list) |
|---|---|---|---|---|---|---|---|
| 2019–20 | 570 | 560 | 15,393 | 15,391 | 15,391 | 393 | `7c6abc954de6fdcb…` |
| 2020–21 | 31 | 934 | 739 | 712 | 564 | 13 | `f4abab59e38384e4…` |
| 2021–22 | 676 | 581 | 14,729 | 14,639 | 13,239 | 499 | `10832bc8d2157b0c…` |
| 2022–23 | 1006 | 391 | 26,403 | 26,208 | 24,226 | 730 | `557c2e332b7843aa…` |
| 2023–24 | 1208 | 486 | 30,983 | 30,702 | 28,075 | 817 | `7a365c4792e3f393…` |
| 2024–25 | 1296 | 532 | 37,399 | 36,557 | 33,271 | 872 | `94fbd00d97718c51…` |
| 2025–26 | 1454 | 634 | 42,474 | 41,743 | 36,842 | 1017 | `86a7ca9e42cddc1f…` |

## Global numbers

`champion` is the live engine; `v2.0` the frozen Engine 2.0 model on the same ratings (the live shadow); `legacy` Engine 1.x, the program's historical baseline (72.7%, Brier 0.179 on 2025–26). The champion's coefficients were fitted on 2023–24 and its calibration on spring 2025, so 2023–24 rows are in-sample for it. 2025–26 is its out-of-sample season, already examined for 2.0 and 2.1, hence **reused**: it sets priorities here and is not proof of any change.

**In-sample warning:** the champion's final recalibration (slope 1.057692) was fitted on rated matches 2024-07-26 to 2026-07-26, so its numbers on those seasons are in-sample for that step. Forward-only evidence for it is the release's rolling-origin gate in `docs/engine/gates/`.

| Season | Model | Matches | Accuracy | Brier | Log loss | ECE |
|---|---|---|---|---|---|---|
| 2019–20 | champion | 15,391 | 69.23% | 0.1937 | 0.5769 | 2.38% |
| 2019–20 | v2.0 | 15,391 | 69.09% | 0.1944 | 0.5788 | 2.69% |
| 2019–20 | legacy | 15,391 | 68.10% | 0.2004 | 0.5937 | 2.87% |
| 2020–21 | champion | 564 | 73.69% | 0.1658 | 0.5018 | 5.51% |
| 2020–21 | v2.0 | 564 | 73.87% | 0.1669 | 0.5049 | 4.41% |
| 2020–21 | legacy | 564 | 73.69% | 0.1716 | 0.5210 | 6.12% |
| 2021–22 | champion | 13,239 | 71.73% | 0.1830 | 0.5463 | 0.59% |
| 2021–22 | v2.0 | 13,239 | 71.66% | 0.1834 | 0.5471 | 0.87% |
| 2021–22 | legacy | 13,239 | 70.83% | 0.1887 | 0.5609 | 1.10% |
| 2022–23 | champion | 24,226 | 74.67% | 0.1688 | 0.5108 | 0.80% |
| 2022–23 | v2.0 | 24,226 | 74.47% | 0.1695 | 0.5128 | 0.99% |
| 2022–23 | legacy | 24,226 | 73.53% | 0.1738 | 0.5240 | 0.54% |
| 2023–24 | champion | 28,075 | 73.86% | 0.1708 | 0.5154 | 0.70% |
| 2023–24 | v2.0 | 28,075 | 73.85% | 0.1714 | 0.5171 | 0.88% |
| 2023–24 | legacy | 28,075 | 72.76% | 0.1774 | 0.5327 | 1.01% |
| 2024–25 | champion | 33,271 | 76.53% | 0.1570 | 0.4801 | 0.90% |
| 2024–25 | v2.0 | 33,271 | 76.39% | 0.1574 | 0.4813 | 0.88% |
| 2024–25 | legacy | 33,271 | 75.82% | 0.1618 | 0.4943 | 0.91% |
| 2025–26 (reused) | champion | 36,842 | 74.79% | 0.1672 | 0.5071 | 0.92% |
| 2025–26 (reused) | v2.0 | 36,842 | 74.70% | 0.1677 | 0.5084 | 1.27% |
| 2025–26 (reused) | legacy | 36,842 | 72.71% | 0.1791 | 0.5378 | 1.07% |

**Baseline check:** legacy on 2025–26 scores 72.71% and Brier 0.1791 over 36,842 matches, against the published 72.7% / 0.179: **reproduced**.

Matches at rated events only. Scrimmage and off-season events are predicted but never rated; their matches, on their own:

| Season | Model | Matches | Accuracy | Brier | Log loss |
|---|---|---|---|---|---|
| 2020–21 | champion | 148 | 68.24% | 0.2119 | 0.6443 |
| 2020–21 | v2.0 | 148 | 68.92% | 0.2074 | 0.6136 |
| 2020–21 | legacy | 148 | 67.57% | 0.2199 | 0.7174 |
| 2021–22 | champion | 1,400 | 63.25% | 0.2234 | 0.6447 |
| 2021–22 | v2.0 | 1,400 | 63.47% | 0.2230 | 0.6435 |
| 2021–22 | legacy | 1,400 | 63.03% | 0.2257 | 0.6523 |
| 2022–23 | champion | 1,982 | 64.33% | 0.2127 | 0.6244 |
| 2022–23 | v2.0 | 1,982 | 64.64% | 0.2128 | 0.6244 |
| 2022–23 | legacy | 1,982 | 63.98% | 0.2163 | 0.6356 |
| 2023–24 | champion | 2,627 | 66.93% | 0.2012 | 0.6035 |
| 2023–24 | v2.0 | 2,627 | 66.89% | 0.2013 | 0.6028 |
| 2023–24 | legacy | 2,627 | 66.14% | 0.2053 | 0.6178 |
| 2024–25 | champion | 3,286 | 66.53% | 0.2092 | 0.6155 |
| 2024–25 | v2.0 | 3,286 | 66.35% | 0.2084 | 0.6114 |
| 2024–25 | legacy | 3,286 | 66.07% | 0.2165 | 0.6444 |
| 2025–26 | champion | 4,901 | 66.03% | 0.2107 | 0.6265 |
| 2025–26 | v2.0 | 4,901 | 65.86% | 0.2107 | 0.6247 |
| 2025–26 | legacy | 4,901 | 65.38% | 0.2174 | 0.6518 |

## Where the champion loses most (2025–26 (reused))

Ranked by **excess Brier**: the Brier a slice carries above an average match, summed over its matches (Σ(Brier − corpus mean)). Only data slices compete, at most one per dimension: the dimensions overlap (thin data shows up as few matches, thin density and unmeasured volatility), and three views of one weakness would hide the next. Probability and margin bands are calibration diagnostics: a coin-flip band carries more Brier by construction.

| # | Slice | Excess Brier | Share of Brier | Share of matches |
|---|---|---|---|---|
| 1 | Data density (all four robots' rated matches): **thin** | +212.0 | 32.9% | 29.5% |
| 2 | Event phase: qualification match number: **q1-10** | +166.5 | 34.2% | 31.5% |
| 3 | Rated matches this season (fewest on the field): **0-5** | +146.0 | 44.1% | 41.8% |

**Surprise** is the mean of (p − y)² − p(1 − p) over decided matches (ties left out): the Brier above what the model's own probabilities expected. Above zero means the model is too sure in that slice; below zero means too timid. **Fav. stated → won** compares the favourite's mean stated chance with how often it won.

### Calibration by stated chance (champion, 2025–26 (reused))

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,141 | 55.0% | 55.5% | 0.5% | 0.5% |
| 60-70% | 7,862 | 65.0% | 65.5% | 0.6% | 0.5% |
| 70-80% | 7,234 | 75.0% | 76.7% | 1.7% | 1.7% |
| 80-90% | 6,951 | 85.0% | 86.0% | 1.0% | 1.0% |
| 90-100% | 6,654 | 94.9% | 94.7% | 0.2% | 0.3% |

### All slices (champion, 2025–26 (reused))

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.67% | 0.1566 | 0.4815 | −54.3 | 75.9% → 76.5% | −4.4‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.49% | 0.1689 | 0.5112 | +54.3 | 73.6% → 74.3% | −3.7‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.67% | 0.1566 | 0.4815 | −54.3 | 75.9% → 76.5% | −4.4‰ |
| q1-10 | 11,613 | 31.5% | 34.2% | 71.90% | 0.1816 | 0.5438 | +166.5 | 70.9% → 71.7% | −4.5‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.94% | 0.1628 | 0.4954 | −56.5 | 74.5% → 75.7% | −5.3‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.04% | 0.1597 | 0.4873 | −55.7 | 76.1% → 75.9% | +0.1‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.25% | 0.1742 | 0.5249 | +109.1 | 72.0% → 73.0% | −6.0‰ |
| 2nd | 8,732 | 23.7% | 23.0% | 75.92% | 0.1620 | 0.4928 | −45.4 | 74.9% → 75.8% | −3.9‰ |
| 3rd+ | 12,513 | 34.0% | 32.9% | 75.92% | 0.1621 | 0.4949 | −63.7 | 75.5% → 75.7% | −1.0‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.78% | 0.1687 | 0.5111 | +26.0 | 73.8% → 74.6% | −2.6‰ |
| veteran | 10,384 | 28.2% | 27.8% | 75.18% | 0.1652 | 0.5015 | −21.2 | 74.1% → 75.0% | −4.9‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.36% | 0.1667 | 0.5060 | −4.8 | 73.8% → 74.1% | −4.8‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.82% | 0.1767 | 0.5312 | +146.0 | 71.6% → 72.6% | −5.4‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.67% | 0.1622 | 0.4940 | −41.8 | 75.8% → 75.5% | +0.6‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.53% | 0.1593 | 0.4873 | −104.2 | 75.3% → 76.4% | −4.7‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.05% | 0.1596 | 0.4873 | −89.6 | 76.2% → 75.9% | +0.1‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.72% | 0.1586 | 0.4855 | −122.5 | 75.0% → 76.5% | −7.1‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.89% | 0.1867 | 0.5568 | +212.0 | 70.0% → 70.7% | −3.8‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.7% | 70.05% | 0.1898 | 0.5641 | +181.1 | 69.3% → 69.8% | −3.6‰ |
| rest | 21,629 | 58.7% | 56.4% | 76.08% | 0.1605 | 0.4901 | −144.7 | 75.1% → 75.9% | −4.6‰ |
| top quartile | 7,210 | 19.6% | 19.0% | 76.16% | 0.1622 | 0.4948 | −36.4 | 75.5% → 76.0% | −1.5‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.9% | 75.64% | 0.1644 | 0.4989 | −29.7 | 74.5% → 75.5% | −3.7‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.31% | 0.1684 | 0.5100 | +25.0 | 74.0% → 74.1% | −2.0‰ |
| small | 5,835 | 15.8% | 15.9% | 74.96% | 0.1680 | 0.5115 | +4.7 | 72.2% → 74.7% | −10.2‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 74.98% | 0.1657 | 0.5013 | −11.7 | 75.0% → 74.8% | +0.4‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.96% | 0.1720 | 0.5197 | +58.8 | 72.6% → 73.8% | −5.6‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.39% | 0.1641 | 0.5000 | −49.7 | 74.2% → 75.2% | −5.1‰ |
| world | 943 | 2.6% | 2.6% | 73.94% | 0.1701 | 0.5095 | +2.7 | 75.7% → 73.9% | +7.7‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,141 | 22.1% | 32.1% | 55.55% | 0.2432 | 0.6856 | +618.2 | 55.0% → 55.5% | −0.5‰ |
| 60-70 | 7,862 | 21.3% | 28.4% | 65.65% | 0.2228 | 0.6420 | +437.2 | 65.0% → 65.5% | −2.3‰ |
| 70-80 | 7,234 | 19.6% | 20.7% | 76.87% | 0.1760 | 0.5410 | +63.6 | 75.0% → 76.7% | −9.8‰ |
| 80-90 | 6,951 | 18.9% | 13.4% | 86.13% | 0.1190 | 0.4031 | −335.4 | 85.0% → 86.0% | −7.9‰ |
| 90-100 | 6,654 | 18.1% | 5.3% | 94.74% | 0.0494 | 0.2012 | −783.7 | 94.9% → 94.7% | +1.3‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 19,007 | 51.6% | 55.9% | 74.12% | 0.1811 | 0.5484 | +263.5 | 72.7% → 73.9% | −8.0‰ |
| close | 8,587 | 23.3% | 33.4% | 57.58% | 0.2398 | 0.6782 | +623.1 | 56.9% → 57.5% | −0.3‰ |
| lopsided | 9,248 | 25.1% | 10.7% | 91.99% | 0.0713 | 0.2635 | −886.6 | 92.1% → 91.9% | +1.7‰ |

## Champion, 2019–20 (older season: used to choose no setting)

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+88.9); Event phase: qualification match number **q1-10** (+81.3); Rated matches this season (fewest on the field) **0-5** (+58.8)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 5,579 | 54.3% | 55.0% | 0.7% | 0.0% |
| 60-70% | 4,156 | 64.8% | 67.5% | 2.7% | 2.5% |
| 70-80% | 3,104 | 74.7% | 78.9% | 4.2% | 3.9% |
| 80-90% | 1,811 | 84.4% | 87.4% | 3.1% | 2.4% |
| 90-100% | 741 | 93.7% | 95.0% | 1.3% | 0.0% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 1,970 | 12.8% | 11.7% | 72.43% | 0.1772 | 0.5378 | −32.5 | 71.2% → 72.1% | −7.5‰ |
| qual | 13,421 | 87.2% | 88.3% | 68.76% | 0.1961 | 0.5827 | +32.5 | 66.0% → 68.5% | −11.1‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 1,970 | 12.8% | 11.7% | 72.43% | 0.1772 | 0.5378 | −32.5 | 71.2% → 72.1% | −7.5‰ |
| q1-10 | 5,544 | 36.0% | 38.7% | 65.89% | 0.2084 | 0.6105 | +81.3 | 63.3% → 65.7% | −8.1‰ |
| q11-25 | 5,692 | 37.0% | 36.4% | 70.04% | 0.1905 | 0.5700 | −18.1 | 67.6% → 69.8% | −12.0‰ |
| q26+ | 2,185 | 14.2% | 13.2% | 72.74% | 0.1797 | 0.5450 | −30.7 | 69.0% → 72.4% | −16.6‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 9,311 | 60.5% | 61.8% | 67.84% | 0.1980 | 0.5880 | +40.2 | 65.5% → 67.5% | −10.4‰ |
| 2nd | 3,768 | 24.5% | 23.7% | 71.73% | 0.1876 | 0.5622 | −23.1 | 68.2% → 71.5% | −12.0‰ |
| 3rd+ | 2,312 | 15.0% | 14.4% | 70.73% | 0.1863 | 0.5563 | −17.1 | 69.2% → 70.5% | −9.7‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 4,543 | 29.5% | 29.8% | 68.86% | 0.1958 | 0.5814 | +9.4 | 66.1% → 68.6% | −11.3‰ |
| unknown | 5,057 | 32.9% | 32.2% | 70.51% | 0.1897 | 0.5672 | −20.3 | 67.0% → 70.2% | −13.4‰ |
| veteran | 1,501 | 9.8% | 9.7% | 68.81% | 0.1935 | 0.5790 | −0.2 | 67.1% → 68.5% | −8.9‰ |
| year2 | 4,290 | 27.9% | 28.2% | 68.26% | 0.1963 | 0.5829 | +11.1 | 66.9% → 68.0% | −7.4‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 9,128 | 59.3% | 61.3% | 67.58% | 0.2001 | 0.5933 | +58.8 | 65.1% → 67.3% | −9.8‰ |
| 16+ | 1,030 | 6.7% | 6.4% | 70.56% | 0.1850 | 0.5530 | −9.0 | 70.0% → 70.3% | −7.0‰ |
| 6-15 | 5,233 | 34.0% | 32.3% | 71.84% | 0.1842 | 0.5530 | −49.8 | 68.8% → 71.6% | −12.8‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 2,119 | 13.8% | 12.8% | 72.34% | 0.1797 | 0.5409 | −29.6 | 70.4% → 72.1% | −9.8‰ |
| normal | 6,759 | 43.9% | 41.9% | 71.64% | 0.1849 | 0.5561 | −59.3 | 69.1% → 71.3% | −11.0‰ |
| thin | 6,513 | 42.3% | 45.3% | 65.70% | 0.2073 | 0.6103 | +88.9 | 63.1% → 65.4% | −10.6‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 4,388 | 28.5% | 30.9% | 64.65% | 0.2101 | 0.6178 | +72.2 | 61.3% → 64.4% | −12.5‰ |
| rest | 8,252 | 53.6% | 53.0% | 70.11% | 0.1913 | 0.5715 | −19.7 | 68.2% → 69.8% | −8.8‰ |
| top quartile | 2,751 | 17.9% | 16.1% | 73.83% | 0.1746 | 0.5281 | −52.5 | 70.8% → 73.6% | −13.4‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 1,702 | 11.1% | 11.6% | 66.59% | 0.2041 | 0.6007 | +17.6 | 66.5% → 66.3% | −2.1‰ |
| mid | 8,674 | 56.4% | 55.6% | 69.85% | 0.1911 | 0.5699 | −22.2 | 67.6% → 69.6% | −9.7‰ |
| small | 5,015 | 32.6% | 32.7% | 69.06% | 0.1946 | 0.5810 | +4.6 | 65.1% → 68.7% | −15.2‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 2,459 | 16.0% | 15.6% | 70.74% | 0.1893 | 0.5640 | −10.9 | 69.7% → 70.5% | −3.5‰ |
| league meet | 4,861 | 31.6% | 32.3% | 68.34% | 0.1983 | 0.5901 | +22.6 | 64.2% → 68.0% | −15.1‰ |
| qualifier | 8,071 | 52.4% | 52.0% | 69.31% | 0.1923 | 0.5729 | −11.6 | 67.3% → 69.0% | −10.2‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 5,579 | 36.2% | 45.2% | 55.09% | 0.2417 | 0.6861 | +268.0 | 54.3% → 55.0% | −0.8‰ |
| 60-70 | 4,156 | 27.0% | 29.9% | 67.81% | 0.2148 | 0.6289 | +87.5 | 64.8% → 67.5% | −9.3‰ |
| 70-80 | 3,104 | 20.2% | 17.1% | 79.26% | 0.1641 | 0.5161 | −91.8 | 74.7% → 78.9% | −22.7‰ |
| 80-90 | 1,811 | 11.8% | 6.6% | 87.79% | 0.1080 | 0.3796 | −155.1 | 84.4% → 87.4% | −22.9‰ |
| 90-100 | 741 | 4.8% | 1.2% | 95.13% | 0.0472 | 0.2003 | −108.6 | 93.7% → 95.0% | −11.3‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 8,058 | 52.4% | 47.2% | 76.10% | 0.1747 | 0.5380 | −153.2 | 71.7% → 75.8% | −19.9‰ |
| close | 6,173 | 40.1% | 49.8% | 56.01% | 0.2405 | 0.6830 | +288.8 | 55.7% → 55.9% | +0.1‰ |
| lopsided | 1,160 | 7.5% | 3.0% | 91.34% | 0.0768 | 0.2833 | −135.6 | 90.9% → 91.2% | −3.6‰ |

## Champion, 2020–21 (older season: used to choose no setting)

Top excess-Brier slices: Rated matches this season (fewest on the field) **0-5** (+7.0); Event phase: robot's event of the season (lowest on the field) **1st** (+6.1); Data density (all four robots' rated matches) **thin** (+5.8)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% ⚠ low n | 112 | 54.2% | 56.3% | 2.1% | 1.2% |
| 60-70% ⚠ low n | 92 | 64.5% | 52.7% | 11.8% | 12.3% |
| 70-80% ⚠ low n | 97 | 75.3% | 69.6% | 5.7% | 5.4% |
| 80-90% ⚠ low n | 91 | 85.2% | 83.0% | 2.2% | 2.0% |
| 90-100% ⚠ low n | 172 | 95.6% | 92.4% | 3.1% | 2.6% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff ⚠ low n | 116 | 20.6% | 14.7% | 86.21% | 0.1188 | 0.3781 | −5.5 | 82.2% → 86.2% | −6.2‰ |
| qual | 448 | 79.4% | 85.3% | 70.39% | 0.1780 | 0.5339 | +5.5 | 75.8% → 70.0% | +22.4‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff ⚠ low n | 116 | 20.6% | 14.7% | 86.21% | 0.1188 | 0.3781 | −5.5 | 82.2% → 86.2% | −6.2‰ |
| q1-10 | 219 | 38.8% | 42.8% | 69.67% | 0.1827 | 0.5637 | +3.7 | 74.6% → 68.9% | +23.7‰ |
| q11-25 ⚠ low n | 193 | 34.2% | 37.0% | 70.83% | 0.1792 | 0.5203 | +2.6 | 77.0% → 70.7% | +27.0‰ |
| q26+ ⚠ low n | 36 | 6.4% | 5.5% | 72.22% | 0.1432 | 0.4255 | −0.8 | 76.7% → 72.2% | −9.2‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 395 | 70.0% | 76.6% | 70.44% | 0.1814 | 0.5428 | +6.1 | 75.6% → 70.1% | +24.5‰ |
| 2nd ⚠ low n | 73 | 12.9% | 8.5% | 84.29% | 0.1085 | 0.3563 | −4.2 | 80.8% → 82.9% | −17.5‰ |
| 3rd+ ⚠ low n | 96 | 17.0% | 14.9% | 79.17% | 0.1456 | 0.4439 | −1.9 | 80.7% → 79.2% | +8.4‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 215 | 38.1% | 38.7% | 73.93% | 0.1685 | 0.5215 | +0.6 | 77.8% → 73.5% | +24.1‰ |
| unknown ⚠ low n | 101 | 17.9% | 16.1% | 75.00% | 0.1489 | 0.4473 | −1.7 | 75.7% → 74.8% | −8.2‰ |
| veteran ⚠ low n | 65 | 11.5% | 8.9% | 78.13% | 0.1279 | 0.3847 | −2.5 | 80.4% → 77.7% | −2.7‰ |
| year2 ⚠ low n | 183 | 32.4% | 36.3% | 71.11% | 0.1855 | 0.5505 | +3.6 | 75.9% → 70.8% | +28.0‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 339 | 60.1% | 67.6% | 68.37% | 0.1865 | 0.5573 | +7.0 | 75.1% → 68.0% | +28.4‰ |
| 16+ ⚠ low n | 63 | 11.2% | 8.4% | 80.95% | 0.1252 | 0.3907 | −2.6 | 80.6% → 81.0% | −12.8‰ |
| 6-15 ⚠ low n | 162 | 28.7% | 24.0% | 81.88% | 0.1385 | 0.4290 | −4.4 | 80.0% → 81.5% | +3.2‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense ⚠ low n | 151 | 26.8% | 24.7% | 78.00% | 0.1529 | 0.4730 | −2.0 | 81.5% → 77.8% | +21.5‰ |
| normal ⚠ low n | 171 | 30.3% | 26.2% | 79.17% | 0.1434 | 0.4379 | −3.8 | 80.9% → 78.7% | +15.6‰ |
| thin | 242 | 42.9% | 49.1% | 67.09% | 0.1898 | 0.5650 | +5.8 | 71.7% → 66.7% | +13.9‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 207 | 36.7% | 41.0% | 68.32% | 0.1850 | 0.5571 | +4.0 | 71.0% → 67.9% | +7.0‰ |
| rest | 267 | 47.3% | 45.3% | 74.90% | 0.1588 | 0.4804 | −1.9 | 80.5% → 74.5% | +25.0‰ |
| top quartile ⚠ low n | 90 | 16.0% | 13.7% | 82.22% | 0.1427 | 0.4384 | −2.1 | 81.1% → 82.2% | +12.8‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| mid | 304 | 53.9% | 57.2% | 71.57% | 0.1758 | 0.5280 | +3.0 | 75.1% → 71.2% | +16.4‰ |
| small | 260 | 46.1% | 42.8% | 76.17% | 0.1541 | 0.4712 | −3.0 | 79.5% → 75.8% | +16.5‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 204 | 36.2% | 37.7% | 74.75% | 0.1728 | 0.5182 | +1.4 | 76.0% → 74.5% | +14.2‰ |
| league meet ⚠ low n | 81 | 14.4% | 14.0% | 77.22% | 0.1621 | 0.4975 | −0.3 | 74.2% → 76.5% | −5.6‰ |
| qualifier | 279 | 49.5% | 48.3% | 71.90% | 0.1618 | 0.4912 | −1.1 | 78.8% → 71.5% | +24.4‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 ⚠ low n | 112 | 19.9% | 28.4% | 56.36% | 0.2372 | 0.6764 | +8.0 | 54.2% → 56.3% | −5.7‰ |
| 60-70 ⚠ low n | 92 | 16.3% | 25.5% | 52.75% | 0.2592 | 0.7182 | +8.6 | 64.5% → 52.7% | +33.8‰ |
| 70-80 ⚠ low n | 97 | 17.2% | 21.2% | 70.21% | 0.2040 | 0.6143 | +3.7 | 75.3% → 69.6% | +22.5‰ |
| 80-90 ⚠ low n | 91 | 16.1% | 13.1% | 83.33% | 0.1347 | 0.4420 | −2.8 | 85.2% → 83.0% | +9.5‰ |
| 90-100 ⚠ low n | 172 | 30.5% | 11.8% | 92.94% | 0.0644 | 0.2406 | −17.5 | 95.6% → 92.4% | +21.8‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 224 | 39.7% | 50.4% | 66.82% | 0.2104 | 0.6084 | +10.0 | 71.5% → 66.7% | +15.3‰ |
| close ⚠ low n | 110 | 19.5% | 28.2% | 54.21% | 0.2402 | 0.6882 | +8.2 | 55.9% → 54.1% | +3.1‰ |
| lopsided | 230 | 40.8% | 21.4% | 89.78% | 0.0869 | 0.3089 | −18.2 | 92.8% → 88.9% | +23.9‰ |

## Champion, 2021–22 (older season: used to choose no setting)

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+87.0); Event phase: qualification match number **q1-10** (+58.9); Rated matches this season (fewest on the field) **0-5** (+50.3)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 3,699 | 54.7% | 55.1% | 0.4% | 0.1% |
| 60-70% | 2,952 | 64.9% | 65.8% | 0.9% | 0.8% |
| 70-80% | 2,662 | 74.8% | 75.3% | 0.5% | 0.3% |
| 80-90% | 2,324 | 84.8% | 84.9% | 0.1% | 0.1% |
| 90-100% | 1,602 | 94.3% | 94.6% | 0.3% | 0.4% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 1,093 | 8.3% | 7.5% | 75.30% | 0.1657 | 0.5007 | −18.9 | 73.5% → 75.2% | −7.9‰ |
| qual | 12,146 | 91.7% | 92.5% | 71.40% | 0.1846 | 0.5504 | +18.9 | 70.9% → 71.2% | −1.5‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 1,093 | 8.3% | 7.5% | 75.30% | 0.1657 | 0.5007 | −18.9 | 73.5% → 75.2% | −7.9‰ |
| q1-10 | 5,849 | 44.2% | 46.6% | 69.60% | 0.1931 | 0.5704 | +58.9 | 68.5% → 69.4% | −3.6‰ |
| q11-25 | 4,742 | 35.8% | 35.2% | 72.57% | 0.1797 | 0.5397 | −15.7 | 72.7% → 72.4% | +2.1‰ |
| q26+ | 1,555 | 11.7% | 10.7% | 74.61% | 0.1674 | 0.5077 | −24.3 | 74.1% → 74.5% | −4.2‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 6,737 | 50.9% | 52.4% | 70.63% | 0.1885 | 0.5611 | +37.1 | 69.8% → 70.4% | −1.4‰ |
| 2nd | 3,269 | 24.7% | 24.7% | 71.56% | 0.1829 | 0.5449 | −0.3 | 71.8% → 71.4% | +0.4‰ |
| 3rd+ | 3,233 | 24.4% | 22.9% | 74.18% | 0.1716 | 0.5168 | −36.8 | 73.0% → 74.1% | −5.7‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 5,613 | 42.4% | 42.0% | 71.90% | 0.1811 | 0.5414 | −10.5 | 71.3% → 71.7% | −3.2‰ |
| unknown ⚠ low n | 1 | 0.0% | 0.0% | 0.00% | 0.2714 | 0.7359 | +0.1 | 52.1% → 0.0% | +21.8‰ |
| veteran | 5,918 | 44.7% | 45.0% | 71.47% | 0.1843 | 0.5500 | +7.9 | 70.7% → 71.3% | −2.1‰ |
| year2 | 1,707 | 12.9% | 13.0% | 72.09% | 0.1845 | 0.5493 | +2.6 | 71.9% → 71.9% | +2.5‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 6,978 | 52.7% | 54.8% | 70.34% | 0.1902 | 0.5651 | +50.3 | 69.5% → 70.1% | −1.4‰ |
| 16+ | 1,563 | 11.8% | 11.6% | 72.07% | 0.1794 | 0.5340 | −5.7 | 73.2% → 71.9% | +3.9‰ |
| 6-15 | 4,698 | 35.5% | 33.6% | 73.66% | 0.1735 | 0.5224 | −44.7 | 72.8% → 73.5% | −4.8‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 2,561 | 19.3% | 17.9% | 74.19% | 0.1697 | 0.5119 | −34.0 | 73.9% → 74.1% | −2.3‰ |
| normal | 5,649 | 42.7% | 40.5% | 73.59% | 0.1736 | 0.5225 | −53.0 | 72.9% → 73.5% | −3.7‰ |
| thin | 5,029 | 38.0% | 41.6% | 68.36% | 0.2003 | 0.5904 | +87.0 | 67.6% → 68.2% | +0.1‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 3,730 | 28.2% | 31.7% | 67.14% | 0.2060 | 0.6051 | +85.9 | 66.6% → 66.9% | +1.7‰ |
| rest | 7,131 | 53.9% | 51.3% | 73.58% | 0.1741 | 0.5234 | −63.3 | 72.9% → 73.5% | −3.2‰ |
| top quartile | 2,378 | 18.0% | 17.0% | 73.33% | 0.1735 | 0.5227 | −22.6 | 72.8% → 73.2% | −3.9‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 2,193 | 16.6% | 15.8% | 73.92% | 0.1745 | 0.5272 | −18.7 | 72.7% → 73.8% | −2.7‰ |
| mid | 6,221 | 47.0% | 46.6% | 72.29% | 0.1817 | 0.5433 | −8.4 | 71.4% → 72.1% | −1.8‰ |
| small | 4,825 | 36.4% | 37.6% | 70.00% | 0.1886 | 0.5587 | +27.1 | 70.0% → 69.9% | −1.9‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 1,963 | 14.8% | 14.8% | 72.17% | 0.1830 | 0.5454 | +0.1 | 71.6% → 72.1% | −0.4‰ |
| league meet | 7,247 | 54.7% | 55.6% | 71.19% | 0.1858 | 0.5539 | +20.2 | 70.2% → 71.0% | −3.3‰ |
| qualifier | 3,693 | 27.9% | 27.1% | 72.33% | 0.1779 | 0.5326 | −18.7 | 72.1% → 72.2% | −1.8‰ |
| world | 336 | 2.5% | 2.5% | 74.03% | 0.1785 | 0.5353 | −1.5 | 75.7% → 74.0% | +16.0‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 3,699 | 27.9% | 37.3% | 55.19% | 0.2440 | 0.6864 | +225.7 | 54.7% → 55.1% | −0.4‰ |
| 60-70 | 2,952 | 22.3% | 27.0% | 65.98% | 0.2214 | 0.6395 | +113.4 | 64.9% → 65.8% | −3.7‰ |
| 70-80 | 2,662 | 20.1% | 20.3% | 75.41% | 0.1844 | 0.5584 | +3.7 | 74.8% → 75.3% | −2.6‰ |
| 80-90 | 2,324 | 17.6% | 12.1% | 85.14% | 0.1267 | 0.4250 | −131.0 | 84.8% → 84.9% | −1.1‰ |
| 90-100 | 1,602 | 12.1% | 3.4% | 94.63% | 0.0508 | 0.2066 | −211.8 | 94.3% → 94.6% | −2.7‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 6,731 | 50.8% | 54.7% | 71.09% | 0.1970 | 0.5851 | +94.4 | 70.0% → 70.9% | −4.5‰ |
| close | 3,323 | 25.1% | 33.3% | 55.90% | 0.2425 | 0.6829 | +197.6 | 55.6% → 55.8% | −0.0‰ |
| lopsided | 3,185 | 24.1% | 12.0% | 89.47% | 0.0913 | 0.3217 | −292.0 | 89.5% → 89.3% | +1.2‰ |

## Champion, 2022–23 (older season: used to choose no setting)

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+104.8); Event phase: qualification match number **q1-10** (+70.7); Rated matches this season (fewest on the field) **0-5** (+61.5)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 5,254 | 54.8% | 56.6% | 1.8% | 1.6% |
| 60-70% | 5,136 | 65.0% | 65.0% | 0.0% | 0.0% |
| 70-80% | 4,738 | 75.0% | 74.9% | 0.1% | 0.1% |
| 80-90% | 4,677 | 85.0% | 85.8% | 0.7% | 0.8% |
| 90-100% | 4,421 | 94.8% | 94.3% | 0.5% | 0.7% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,510 | 10.4% | 10.5% | 73.71% | 0.1704 | 0.5132 | +4.0 | 75.1% → 73.5% | +6.7‰ |
| qual | 21,716 | 89.6% | 89.5% | 74.78% | 0.1687 | 0.5106 | −4.0 | 73.9% → 74.6% | −2.2‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,510 | 10.4% | 10.5% | 73.71% | 0.1704 | 0.5132 | +4.0 | 75.1% → 73.5% | +6.7‰ |
| q1-10 | 8,976 | 37.1% | 38.8% | 73.54% | 0.1767 | 0.5328 | +70.7 | 71.9% → 73.3% | −3.8‰ |
| q11-25 | 8,887 | 36.7% | 35.4% | 75.42% | 0.1628 | 0.4947 | −54.0 | 75.3% → 75.3% | −1.4‰ |
| q26+ | 3,853 | 15.9% | 15.4% | 76.16% | 0.1635 | 0.4954 | −20.7 | 75.5% → 76.0% | −0.4‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 10,565 | 43.6% | 44.7% | 73.49% | 0.1732 | 0.5209 | +46.6 | 72.7% → 73.3% | −3.4‰ |
| 2nd | 5,827 | 24.1% | 23.5% | 75.42% | 0.1652 | 0.5042 | −20.9 | 74.9% → 75.2% | −1.1‰ |
| 3rd+ | 7,834 | 32.3% | 31.7% | 75.70% | 0.1656 | 0.5023 | −25.7 | 75.4% → 75.6% | +1.3‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 11,591 | 47.8% | 47.5% | 74.71% | 0.1676 | 0.5082 | −13.9 | 74.2% → 74.5% | −1.6‰ |
| veteran | 7,495 | 30.9% | 31.2% | 74.71% | 0.1704 | 0.5142 | +11.6 | 74.0% → 74.6% | −0.8‰ |
| year2 | 5,140 | 21.2% | 21.3% | 74.51% | 0.1693 | 0.5120 | +2.3 | 73.8% → 74.3% | −1.4‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 10,940 | 45.2% | 46.7% | 73.38% | 0.1745 | 0.5246 | +61.5 | 72.4% → 73.2% | −3.8‰ |
| 16+ | 4,340 | 17.9% | 18.1% | 74.65% | 0.1707 | 0.5151 | +8.1 | 74.8% → 74.5% | +3.8‰ |
| 6-15 | 8,946 | 36.9% | 35.2% | 76.25% | 0.1610 | 0.4919 | −69.7 | 75.8% → 76.1% | −0.8‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 6,447 | 26.6% | 26.4% | 75.49% | 0.1677 | 0.5086 | −7.4 | 75.4% → 75.3% | +4.2‰ |
| normal | 10,168 | 42.0% | 39.6% | 76.16% | 0.1593 | 0.4866 | −97.4 | 75.8% → 76.0% | −2.3‰ |
| thin | 7,611 | 31.4% | 34.0% | 71.96% | 0.1826 | 0.5451 | +104.8 | 70.6% → 71.8% | −4.7‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 5,589 | 23.1% | 25.7% | 70.91% | 0.1882 | 0.5590 | +108.3 | 69.4% → 70.7% | −4.1‰ |
| rest | 13,977 | 57.7% | 55.6% | 75.68% | 0.1627 | 0.4959 | −85.2 | 75.6% → 75.5% | +0.4‰ |
| top quartile | 4,660 | 19.2% | 18.7% | 76.14% | 0.1639 | 0.4980 | −23.1 | 75.0% → 76.0% | −3.1‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 6,408 | 26.5% | 26.6% | 74.56% | 0.1700 | 0.5136 | +7.2 | 73.5% → 74.4% | −3.5‰ |
| mid | 12,958 | 53.5% | 53.8% | 74.49% | 0.1698 | 0.5134 | +13.0 | 74.4% → 74.3% | +1.4‰ |
| small | 4,860 | 20.1% | 19.6% | 75.29% | 0.1647 | 0.5004 | −20.2 | 73.9% → 75.1% | −5.6‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 3,611 | 14.9% | 15.5% | 74.05% | 0.1751 | 0.5263 | +22.7 | 72.7% → 73.9% | −2.8‰ |
| league meet | 10,174 | 42.0% | 41.5% | 75.03% | 0.1668 | 0.5059 | −21.1 | 73.8% → 74.9% | −5.3‰ |
| qualifier | 9,882 | 40.8% | 40.4% | 74.69% | 0.1672 | 0.5065 | −16.1 | 74.8% → 74.5% | +1.9‰ |
| world | 559 | 2.3% | 2.7% | 71.68% | 0.1948 | 0.5767 | +14.5 | 74.6% → 71.6% | +25.5‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 5,254 | 21.7% | 31.1% | 56.72% | 0.2418 | 0.6829 | +383.6 | 54.8% → 56.6% | −2.0‰ |
| 60-70 | 5,136 | 21.2% | 28.2% | 65.12% | 0.2246 | 0.6455 | +286.4 | 65.0% → 65.0% | −0.6‰ |
| 70-80 | 4,738 | 19.6% | 21.4% | 75.09% | 0.1847 | 0.5603 | +75.1 | 75.0% → 74.9% | −0.8‰ |
| 80-90 | 4,677 | 19.3% | 13.7% | 85.94% | 0.1201 | 0.4058 | −227.8 | 85.0% → 85.8% | −6.3‰ |
| 90-100 | 4,421 | 18.2% | 5.6% | 94.46% | 0.0518 | 0.2081 | −517.3 | 94.8% → 94.3% | +3.4‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 11,766 | 48.6% | 55.4% | 72.23% | 0.1926 | 0.5750 | +279.5 | 71.6% → 72.1% | −2.1‰ |
| close | 5,296 | 21.9% | 31.2% | 57.38% | 0.2407 | 0.6801 | +380.5 | 56.3% → 57.3% | −0.4‰ |
| lopsided | 7,164 | 29.6% | 13.4% | 91.33% | 0.0767 | 0.2803 | −660.0 | 91.2% → 91.2% | −0.7‰ |

## Champion, 2023–24 (in-sample: the contextual model was fitted on 2023–24 and early 2024–25)

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+198.3); Rated matches this season (fewest on the field) **0-5** (+144.5); Event phase: qualification match number **q1-10** (+142.4)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,340 | 54.9% | 54.8% | 0.1% | 0.2% |
| 60-70% | 5,962 | 64.9% | 64.3% | 0.5% | 0.7% |
| 70-80% | 5,507 | 74.9% | 75.1% | 0.2% | 0.1% |
| 80-90% | 5,086 | 84.9% | 85.5% | 0.5% | 0.5% |
| 90-100% | 5,180 | 95.0% | 94.4% | 0.6% | 0.6% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.6% | 76.72% | 0.1557 | 0.4755 | −44.7 | 77.0% → 76.6% | +1.8‰ |
| qual | 25,106 | 89.4% | 90.4% | 73.52% | 0.1726 | 0.5201 | +44.7 | 73.4% → 73.3% | −0.5‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.6% | 76.72% | 0.1557 | 0.4755 | −44.7 | 77.0% → 76.6% | +1.8‰ |
| q1-10 | 10,431 | 37.2% | 40.1% | 71.07% | 0.1844 | 0.5497 | +142.4 | 71.2% → 70.9% | +0.6‰ |
| q11-25 | 10,412 | 37.1% | 36.1% | 75.05% | 0.1660 | 0.5045 | −49.4 | 74.7% → 74.9% | −0.9‰ |
| q26+ | 4,263 | 15.2% | 14.2% | 75.76% | 0.1594 | 0.4855 | −48.4 | 75.7% → 75.6% | −2.0‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 12,415 | 44.2% | 46.5% | 72.21% | 0.1794 | 0.5360 | +107.2 | 72.5% → 72.0% | +2.0‰ |
| 2nd | 6,952 | 24.8% | 24.3% | 74.52% | 0.1677 | 0.5087 | −21.5 | 74.2% → 74.3% | −1.7‰ |
| 3rd+ | 8,708 | 31.0% | 29.2% | 75.67% | 0.1609 | 0.4913 | −85.6 | 75.4% → 75.5% | −2.2‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 15,029 | 53.5% | 54.5% | 73.08% | 0.1739 | 0.5226 | +46.4 | 73.5% → 72.9% | +1.6‰ |
| veteran | 7,416 | 26.4% | 25.4% | 75.33% | 0.1644 | 0.4997 | −47.2 | 74.5% → 75.2% | −3.2‰ |
| year2 | 5,630 | 20.1% | 20.1% | 73.98% | 0.1709 | 0.5167 | +0.8 | 73.6% → 73.8% | −1.2‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 12,833 | 45.7% | 48.7% | 71.63% | 0.1820 | 0.5428 | +144.5 | 72.0% → 71.4% | +2.1‰ |
| 16+ | 4,861 | 17.3% | 16.4% | 75.68% | 0.1621 | 0.4935 | −42.3 | 75.9% → 75.6% | +1.3‰ |
| 6-15 | 10,381 | 37.0% | 34.8% | 75.75% | 0.1609 | 0.4917 | −102.2 | 75.0% → 75.5% | −3.8‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 7,119 | 25.4% | 23.6% | 76.27% | 0.1587 | 0.4859 | −85.8 | 76.2% → 76.1% | +0.2‰ |
| normal | 11,776 | 41.9% | 39.6% | 75.83% | 0.1612 | 0.4911 | −112.5 | 75.0% → 75.6% | −3.9‰ |
| thin | 9,180 | 32.7% | 36.8% | 69.44% | 0.1924 | 0.5693 | +198.3 | 70.3% → 69.3% | +4.2‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 6,533 | 23.3% | 26.8% | 68.66% | 0.1965 | 0.5798 | +168.0 | 69.6% → 68.5% | +4.9‰ |
| rest | 16,156 | 57.5% | 55.2% | 75.18% | 0.1640 | 0.4984 | −110.1 | 74.9% → 75.0% | −1.5‰ |
| top quartile | 5,386 | 19.2% | 18.0% | 76.17% | 0.1600 | 0.4882 | −57.9 | 75.6% → 76.0% | −2.7‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 6,510 | 23.2% | 23.6% | 73.39% | 0.1739 | 0.5239 | +20.5 | 74.0% → 73.2% | +3.9‰ |
| mid | 15,470 | 55.1% | 54.0% | 74.38% | 0.1674 | 0.5067 | −51.7 | 74.0% → 74.2% | −2.5‰ |
| small | 6,095 | 21.7% | 22.4% | 73.02% | 0.1759 | 0.5283 | +31.1 | 73.0% → 72.8% | +1.3‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 4,378 | 15.6% | 16.1% | 72.78% | 0.1764 | 0.5309 | +24.8 | 74.1% → 72.6% | +6.2‰ |
| league meet | 11,683 | 41.6% | 42.4% | 73.26% | 0.1742 | 0.5242 | +39.5 | 72.5% → 73.1% | −3.6‰ |
| qualifier | 11,417 | 40.7% | 39.5% | 74.72% | 0.1658 | 0.5022 | −56.4 | 74.9% → 74.5% | +0.8‰ |
| world | 597 | 2.1% | 2.0% | 76.88% | 0.1575 | 0.4792 | −7.9 | 76.6% → 76.9% | +0.7‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 6,340 | 22.6% | 32.3% | 54.85% | 0.2443 | 0.6875 | +466.3 | 54.9% → 54.8% | +0.4‰ |
| 60-70 | 5,962 | 21.2% | 28.1% | 64.46% | 0.2260 | 0.6493 | +329.3 | 64.9% → 64.3% | +1.0‰ |
| 70-80 | 5,507 | 19.6% | 21.2% | 75.30% | 0.1842 | 0.5588 | +73.9 | 74.9% → 75.1% | −1.8‰ |
| 80-90 | 5,086 | 18.1% | 12.9% | 85.66% | 0.1216 | 0.4099 | −249.9 | 84.9% → 85.5% | −5.4‰ |
| 90-100 | 5,180 | 18.5% | 5.5% | 94.56% | 0.0512 | 0.2079 | −619.5 | 95.0% → 94.4% | +4.5‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 13,753 | 49.0% | 56.3% | 70.85% | 0.1963 | 0.5833 | +350.3 | 71.0% → 70.7% | −0.4‰ |
| close | 6,061 | 21.6% | 30.4% | 56.77% | 0.2407 | 0.6795 | +423.5 | 56.4% → 56.7% | −0.6‰ |
| lopsided | 8,261 | 29.4% | 13.3% | 91.27% | 0.0771 | 0.2819 | −773.9 | 91.2% → 91.1% | +0.4‰ |

## Champion, 2024–25 (in-sample: the contextual model was fitted on 2023–24 and early 2024–25)

Top excess-Brier slices: Event phase: qualification match number **q1-10** (+185.4); Data density (all four robots' rated matches) **thin** (+164.3); Rated matches this season (fewest on the field) **0-5** (+106.2)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,298 | 54.9% | 54.4% | 0.5% | 0.6% |
| 60-70% | 6,157 | 65.0% | 65.7% | 0.7% | 0.7% |
| 70-80% | 5,968 | 75.0% | 76.0% | 1.0% | 1.0% |
| 80-90% | 6,242 | 85.1% | 83.8% | 1.3% | 1.2% |
| 90-100% | 8,606 | 95.5% | 94.8% | 0.7% | 0.2% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.20% | 0.1501 | 0.4623 | −30.4 | 77.4% → 78.0% | −1.3‰ |
| qual | 28,885 | 86.8% | 87.4% | 76.27% | 0.1581 | 0.4828 | +30.4 | 76.4% → 76.1% | +1.9‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.20% | 0.1501 | 0.4623 | −30.4 | 77.4% → 78.0% | −1.3‰ |
| q1-10 | 10,927 | 32.8% | 36.4% | 73.25% | 0.1740 | 0.5244 | +185.4 | 73.8% → 73.0% | +4.2‰ |
| q11-25 | 11,671 | 35.1% | 33.8% | 77.53% | 0.1513 | 0.4650 | −67.3 | 77.5% → 77.3% | +0.6‰ |
| q26+ | 6,287 | 18.9% | 17.2% | 79.20% | 0.1431 | 0.4437 | −87.7 | 78.9% → 79.0% | +0.2‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 14,138 | 42.5% | 44.0% | 75.26% | 0.1626 | 0.4946 | +78.1 | 75.1% → 75.0% | −0.0‰ |
| 2nd | 8,049 | 24.2% | 23.4% | 77.65% | 0.1516 | 0.4655 | −43.9 | 77.4% → 77.5% | +0.2‰ |
| 3rd+ | 11,084 | 33.3% | 32.7% | 77.33% | 0.1539 | 0.4723 | −34.2 | 77.7% → 77.2% | +4.2‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 16,718 | 50.2% | 51.1% | 76.08% | 0.1596 | 0.4884 | +43.4 | 76.2% → 75.8% | +2.4‰ |
| veteran | 8,250 | 24.8% | 24.6% | 76.79% | 0.1556 | 0.4758 | −11.9 | 76.6% → 76.6% | +0.0‰ |
| year2 | 8,303 | 25.0% | 24.4% | 77.17% | 0.1532 | 0.4678 | −31.5 | 77.2% → 77.0% | +0.9‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 14,202 | 42.7% | 44.7% | 74.91% | 0.1645 | 0.4998 | +106.2 | 74.7% → 74.7% | −0.1‰ |
| 16+ | 6,847 | 20.6% | 20.5% | 76.96% | 0.1565 | 0.4765 | −3.7 | 77.3% → 76.8% | +4.7‰ |
| 6-15 | 12,222 | 36.7% | 34.8% | 78.16% | 0.1486 | 0.4593 | −102.6 | 78.2% → 78.0% | +1.4‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 10,110 | 30.4% | 29.8% | 77.45% | 0.1542 | 0.4725 | −28.3 | 78.0% → 77.3% | +6.4‰ |
| normal | 13,190 | 39.6% | 37.0% | 78.43% | 0.1467 | 0.4539 | −136.0 | 78.0% → 78.2% | −1.2‰ |
| thin | 9,971 | 30.0% | 33.1% | 73.05% | 0.1735 | 0.5226 | +164.3 | 73.1% → 72.8% | −0.1‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 7,418 | 22.3% | 25.3% | 72.02% | 0.1784 | 0.5340 | +158.5 | 72.3% → 71.8% | +1.6‰ |
| rest | 19,389 | 58.3% | 55.7% | 77.86% | 0.1502 | 0.4631 | −133.1 | 77.7% → 77.7% | +0.6‰ |
| top quartile | 6,464 | 19.4% | 18.9% | 77.69% | 0.1531 | 0.4693 | −25.4 | 77.9% → 77.6% | +3.8‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 8,980 | 27.0% | 27.0% | 76.38% | 0.1569 | 0.4791 | −1.1 | 76.7% → 76.2% | +2.1‰ |
| mid | 18,322 | 55.1% | 55.1% | 76.56% | 0.1571 | 0.4808 | +2.2 | 76.7% → 76.3% | +2.7‰ |
| small | 5,969 | 17.9% | 17.9% | 76.63% | 0.1569 | 0.4795 | −1.0 | 75.6% → 76.4% | −3.5‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 6,344 | 19.1% | 19.6% | 76.39% | 0.1611 | 0.4907 | +26.0 | 76.9% → 76.2% | +7.1‰ |
| league meet | 12,322 | 37.0% | 36.7% | 76.77% | 0.1556 | 0.4772 | −18.2 | 75.7% → 76.5% | −4.3‰ |
| qualifier | 13,903 | 41.8% | 41.5% | 76.36% | 0.1561 | 0.4768 | −13.3 | 77.1% → 76.2% | +3.6‰ |
| world | 702 | 2.1% | 2.2% | 76.79% | 0.1648 | 0.5019 | +5.5 | 76.7% → 76.6% | +9.2‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 6,298 | 18.9% | 29.5% | 54.41% | 0.2444 | 0.6888 | +550.3 | 54.9% → 54.4% | +1.0‰ |
| 60-70 | 6,157 | 18.5% | 26.1% | 65.92% | 0.2218 | 0.6412 | +398.5 | 65.0% → 65.7% | −2.6‰ |
| 70-80 | 5,968 | 17.9% | 20.6% | 76.14% | 0.1802 | 0.5495 | +138.0 | 75.0% → 76.0% | −6.0‰ |
| 80-90 | 6,242 | 18.8% | 16.0% | 83.96% | 0.1342 | 0.4424 | −142.2 | 85.1% → 83.8% | +8.4‰ |
| 90-100 | 8,606 | 25.9% | 7.8% | 94.95% | 0.0473 | 0.1914 | −944.6 | 95.5% → 94.8% | +4.7‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 14,981 | 45.0% | 54.6% | 72.67% | 0.1904 | 0.5704 | +499.8 | 72.0% → 72.5% | −2.2‰ |
| close | 6,242 | 18.8% | 28.7% | 56.13% | 0.2405 | 0.6811 | +520.8 | 56.3% → 56.0% | −0.1‰ |
| lopsided | 12,048 | 36.2% | 16.7% | 91.77% | 0.0723 | 0.2638 | −1020.6 | 92.6% → 91.6% | +6.7‰ |

## Baselines on 2025–26 (reused)

### v2.0

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+210.2); Event phase: qualification match number **q1-10** (+167.3); Rated matches this season (fewest on the field) **0-5** (+145.7)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,489 | 55.0% | 55.5% | 0.5% | 0.5% |
| 60-70% | 8,050 | 65.0% | 66.1% | 1.1% | 1.1% |
| 70-80% | 7,368 | 74.9% | 77.4% | 2.5% | 2.4% |
| 80-90% | 6,869 | 85.0% | 86.7% | 1.7% | 1.7% |
| 90-100% | 6,066 | 94.8% | 95.0% | 0.2% | 0.0% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.63% | 0.1565 | 0.4813 | −57.0 | 75.5% → 76.5% | −6.7‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.38% | 0.1695 | 0.5127 | +57.0 | 72.9% → 74.2% | −6.5‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.63% | 0.1565 | 0.4813 | −57.0 | 75.5% → 76.5% | −6.7‰ |
| q1-10 | 11,613 | 31.5% | 34.2% | 71.92% | 0.1821 | 0.5452 | +167.3 | 70.6% → 71.7% | −5.0‰ |
| q11-25 | 12,697 | 34.5% | 33.6% | 75.67% | 0.1634 | 0.4972 | −54.5 | 73.9% → 75.5% | −7.9‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.04% | 0.1602 | 0.4885 | −55.8 | 74.9% → 75.9% | −6.5‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.24% | 0.1746 | 0.5260 | +107.3 | 71.5% → 73.0% | −8.0‰ |
| 2nd | 8,732 | 23.7% | 23.0% | 75.72% | 0.1625 | 0.4941 | −45.6 | 74.4% → 75.6% | −6.6‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.79% | 0.1627 | 0.4963 | −61.7 | 74.7% → 75.6% | −4.6‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.67% | 0.1691 | 0.5121 | +24.5 | 73.2% → 74.5% | −5.5‰ |
| veteran | 10,384 | 28.2% | 27.8% | 75.10% | 0.1656 | 0.5027 | −21.3 | 73.6% → 74.9% | −7.6‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.29% | 0.1673 | 0.5077 | −3.2 | 73.2% → 74.1% | −7.2‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.75% | 0.1771 | 0.5324 | +145.7 | 71.2% → 72.6% | −7.2‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.64% | 0.1626 | 0.4951 | −41.7 | 74.9% → 75.5% | −4.1‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.37% | 0.1598 | 0.4886 | −104.0 | 74.8% → 76.2% | −7.2‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.02% | 0.1603 | 0.4888 | −87.3 | 75.3% → 75.9% | −4.0‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.45% | 0.1590 | 0.4867 | −122.8 | 74.5% → 76.3% | −9.2‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.97% | 0.1870 | 0.5578 | +210.2 | 69.5% → 70.8% | −5.7‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 70.22% | 0.1902 | 0.5651 | +180.1 | 68.8% → 70.0% | −5.8‰ |
| rest | 21,629 | 58.7% | 56.4% | 75.98% | 0.1610 | 0.4914 | −145.2 | 74.5% → 75.8% | −7.3‰ |
| top quartile | 7,210 | 19.6% | 19.0% | 75.80% | 0.1628 | 0.4961 | −34.9 | 74.7% → 75.7% | −5.0‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.9% | 75.65% | 0.1650 | 0.5005 | −28.1 | 73.8% → 75.5% | −7.1‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.21% | 0.1688 | 0.5110 | +22.8 | 73.5% → 74.0% | −4.7‰ |
| small | 5,835 | 15.8% | 15.9% | 74.71% | 0.1686 | 0.5129 | +5.3 | 71.8% → 74.5% | −12.0‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 75.12% | 0.1660 | 0.5025 | −12.5 | 74.2% → 75.0% | −4.0‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.71% | 0.1724 | 0.5208 | +57.8 | 72.1% → 73.5% | −7.8‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.30% | 0.1646 | 0.5014 | −48.4 | 73.7% → 75.1% | −7.2‰ |
| world | 943 | 2.6% | 2.6% | 73.94% | 0.1710 | 0.5114 | +3.1 | 74.4% → 73.9% | +1.1‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,489 | 23.0% | 33.4% | 55.54% | 0.2430 | 0.6852 | +639.7 | 55.0% → 55.5% | −0.8‰ |
| 60-70 | 8,050 | 21.9% | 28.8% | 66.24% | 0.2211 | 0.6385 | +429.9 | 65.0% → 66.1% | −4.0‰ |
| 70-80 | 7,368 | 20.0% | 20.6% | 77.63% | 0.1724 | 0.5330 | +34.7 | 74.9% → 77.4% | −13.7‰ |
| 80-90 | 6,869 | 18.6% | 12.7% | 86.87% | 0.1140 | 0.3909 | −368.9 | 85.0% → 86.7% | −12.6‰ |
| 90-100 | 6,066 | 16.5% | 4.6% | 95.08% | 0.0465 | 0.1914 | −735.3 | 94.8% → 95.0% | −2.3‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 19,007 | 51.6% | 55.9% | 74.15% | 0.1817 | 0.5501 | +266.1 | 72.0% → 74.0% | −11.0‰ |
| close | 8,587 | 23.3% | 33.4% | 57.08% | 0.2403 | 0.6793 | +623.9 | 56.4% → 57.0% | −0.7‰ |
| lopsided | 9,248 | 25.1% | 10.7% | 92.01% | 0.0714 | 0.2638 | −890.0 | 91.6% → 91.9% | −2.6‰ |

### legacy

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+236.8); Rated matches this season (fewest on the field) **0-5** (+182.3); Event phase: qualification match number **q1-10** (+168.7)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,741 | 54.9% | 55.6% | 0.6% | 0.6% |
| 60-70% | 8,378 | 64.9% | 64.2% | 0.8% | 0.8% |
| 70-80% | 7,653 | 75.0% | 76.3% | 1.3% | 1.3% |
| 80-90% | 6,787 | 84.9% | 84.5% | 0.4% | 0.5% |
| 90-100% | 5,283 | 94.6% | 93.1% | 1.5% | 1.9% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 12.9% | 75.70% | 0.1660 | 0.5072 | −67.1 | 71.2% → 75.5% | −20.3‰ |
| qual | 31,725 | 86.1% | 87.1% | 72.22% | 0.1812 | 0.5428 | +67.1 | 72.8% → 72.1% | +4.0‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 12.9% | 75.70% | 0.1660 | 0.5072 | −67.1 | 71.2% → 75.5% | −20.3‰ |
| q1-10 | 11,613 | 31.5% | 34.1% | 69.93% | 0.1936 | 0.5748 | +168.7 | 71.5% → 69.8% | +10.5‰ |
| q11-25 | 12,697 | 34.5% | 34.0% | 72.98% | 0.1767 | 0.5313 | −30.2 | 73.3% → 72.8% | +1.9‰ |
| q26+ | 7,415 | 20.1% | 19.0% | 74.51% | 0.1694 | 0.5123 | −71.4 | 74.0% → 74.4% | −2.5‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.6% | 70.67% | 0.1886 | 0.5619 | +148.5 | 71.7% → 70.5% | +5.8‰ |
| 2nd | 8,732 | 23.7% | 22.9% | 73.95% | 0.1731 | 0.5228 | −52.4 | 73.6% → 73.8% | +0.3‰ |
| 3rd+ | 12,513 | 34.0% | 32.5% | 74.38% | 0.1714 | 0.5183 | −96.0 | 73.0% → 74.2% | −5.6‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.1% | 72.52% | 0.1809 | 0.5417 | +30.9 | 72.8% → 72.4% | +3.2‰ |
| veteran | 10,384 | 28.2% | 27.9% | 73.11% | 0.1771 | 0.5340 | −20.2 | 72.5% → 72.9% | −2.1‰ |
| year2 | 9,281 | 25.2% | 25.0% | 72.60% | 0.1779 | 0.5349 | −10.8 | 72.4% → 72.4% | −1.2‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.5% | 70.12% | 0.1909 | 0.5676 | +182.3 | 71.8% → 69.9% | +8.9‰ |
| 16+ | 8,268 | 22.4% | 21.3% | 74.58% | 0.1702 | 0.5153 | −73.0 | 72.5% → 74.4% | −9.8‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 74.53% | 0.1708 | 0.5172 | −109.3 | 73.6% → 74.4% | −2.5‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.0% | 75.13% | 0.1674 | 0.5081 | −138.1 | 73.2% → 75.0% | −8.7‰ |
| normal | 14,138 | 38.4% | 36.9% | 74.26% | 0.1721 | 0.5206 | −98.7 | 73.7% → 74.1% | −0.6‰ |
| thin | 10,869 | 29.5% | 33.1% | 68.03% | 0.2008 | 0.5926 | +236.8 | 70.5% → 67.8% | +12.5‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.5% | 67.52% | 0.2020 | 0.5945 | +183.6 | 69.9% → 67.3% | +11.1‰ |
| rest | 21,629 | 58.7% | 56.4% | 74.18% | 0.1719 | 0.5196 | −155.4 | 73.0% → 74.0% | −4.6‰ |
| top quartile | 7,210 | 19.6% | 19.1% | 74.03% | 0.1751 | 0.5294 | −28.3 | 74.3% → 73.9% | +4.6‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.8% | 73.37% | 0.1755 | 0.5278 | −37.3 | 73.0% → 73.2% | −1.4‰ |
| mid | 20,568 | 55.8% | 56.2% | 72.54% | 0.1802 | 0.5404 | +22.3 | 72.7% → 72.4% | +2.4‰ |
| small | 5,835 | 15.8% | 16.1% | 72.12% | 0.1816 | 0.5466 | +14.9 | 71.4% → 71.9% | −1.8‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.2% | 73.85% | 0.1740 | 0.5247 | −38.7 | 72.9% → 73.7% | −3.5‰ |
| league meet | 12,338 | 33.5% | 34.7% | 71.20% | 0.1855 | 0.5536 | +79.9 | 71.8% → 71.0% | +3.8‰ |
| qualifier | 15,911 | 43.2% | 42.7% | 73.23% | 0.1769 | 0.5332 | −34.2 | 73.0% → 73.1% | +0.5‰ |
| world | 943 | 2.6% | 2.5% | 74.15% | 0.1717 | 0.5152 | −6.9 | 73.0% → 74.1% | −5.6‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,741 | 23.7% | 32.3% | 55.64% | 0.2435 | 0.6849 | +563.5 | 54.9% → 55.6% | −0.9‰ |
| 60-70 | 8,378 | 22.7% | 28.8% | 64.30% | 0.2264 | 0.6502 | +396.7 | 64.9% → 64.2% | +1.6‰ |
| 70-80 | 7,653 | 20.8% | 20.7% | 76.48% | 0.1781 | 0.5452 | −7.8 | 75.0% → 76.3% | −7.6‰ |
| 80-90 | 6,787 | 18.4% | 13.3% | 84.67% | 0.1291 | 0.4285 | −339.2 | 84.9% → 84.5% | +1.7‰ |
| 90-100 | 5,283 | 14.3% | 5.0% | 93.21% | 0.0630 | 0.2460 | −613.2 | 94.6% → 93.1% | +12.1‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,542 | 50.3% | 56.0% | 70.90% | 0.1994 | 0.5912 | +377.4 | 70.6% → 70.7% | −2.1‰ |
| close | 8,154 | 22.1% | 30.1% | 55.36% | 0.2438 | 0.6856 | +528.1 | 54.6% → 55.3% | −1.0‰ |
| lopsided | 10,146 | 27.5% | 13.8% | 89.84% | 0.0898 | 0.3215 | −905.5 | 90.6% → 89.7% | +6.8‰ |

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
