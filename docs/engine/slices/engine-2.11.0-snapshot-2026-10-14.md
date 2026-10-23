# Engine error report: 2.11.0 on snapshot-2026-10-14

Generated 2026-10-23 by `scripts/engine-slices.ts`. Engine 2.11.0 (champion model `ctx-rel-form-2026-10-17-1fdd2958+recal-2026-10-23`). Data version 2026-10-14T04:19:58.853Z.

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
| 2023–24 | champion | 28,075 | 72.94% | 0.1741 | 0.5233 | 0.76% |
| 2023–24 | v2.0 | 28,075 | 73.00% | 0.1745 | 0.5243 | 1.00% |
| 2023–24 | legacy | 28,075 | 72.15% | 0.1796 | 0.5373 | 0.63% |
| 2024–25 | champion | 33,271 | 76.54% | 0.1570 | 0.4802 | 0.85% |
| 2024–25 | v2.0 | 33,271 | 76.45% | 0.1574 | 0.4814 | 0.91% |
| 2024–25 | legacy | 33,271 | 75.84% | 0.1619 | 0.4944 | 0.94% |
| 2025–26 (reused) | champion | 36,842 | 74.79% | 0.1672 | 0.5071 | 0.90% |
| 2025–26 (reused) | v2.0 | 36,842 | 74.69% | 0.1677 | 0.5084 | 1.29% |
| 2025–26 (reused) | legacy | 36,842 | 72.66% | 0.1791 | 0.5378 | 1.03% |

**Baseline check:** legacy on 2025–26 scores 72.66% and Brier 0.1791 over 36,842 matches, against the published 72.7% / 0.179: **reproduced**.

Matches at rated events only. Scrimmage and off-season events are predicted but never rated; their matches, on their own:

| Season | Model | Matches | Accuracy | Brier | Log loss |
|---|---|---|---|---|---|
| 2023–24 | champion | 2,627 | 63.60% | 0.2048 | 0.6100 |
| 2023–24 | v2.0 | 2,627 | 63.32% | 0.2053 | 0.6107 |
| 2023–24 | legacy | 2,627 | 63.09% | 0.2069 | 0.6175 |
| 2024–25 | champion | 3,286 | 66.26% | 0.2094 | 0.6160 |
| 2024–25 | v2.0 | 3,286 | 66.07% | 0.2087 | 0.6121 |
| 2024–25 | legacy | 3,286 | 65.52% | 0.2170 | 0.6449 |
| 2025–26 | champion | 4,901 | 66.05% | 0.2108 | 0.6265 |
| 2025–26 | v2.0 | 4,901 | 65.96% | 0.2107 | 0.6248 |
| 2025–26 | legacy | 4,901 | 65.34% | 0.2175 | 0.6519 |

## Where the champion loses most (2025–26 (reused))

Ranked by **excess Brier**: the Brier a slice carries above an average match, summed over its matches (Σ(Brier − corpus mean)). Only data slices compete, at most one per dimension: the dimensions overlap (thin data shows up as few matches, thin density and unmeasured volatility), and three views of one weakness would hide the next. Probability and margin bands are calibration diagnostics: a coin-flip band carries more Brier by construction.

| # | Slice | Excess Brier | Share of Brier | Share of matches |
|---|---|---|---|---|
| 1 | Data density (all four robots' rated matches): **thin** | +212.1 | 32.9% | 29.5% |
| 2 | Event phase: qualification match number: **q1-10** | +166.7 | 34.2% | 31.5% |
| 3 | Rated matches this season (fewest on the field): **0-5** | +146.1 | 44.1% | 41.8% |

**Surprise** is the mean of (p − y)² − p(1 − p) over decided matches (ties left out): the Brier above what the model's own probabilities expected. Above zero means the model is too sure in that slice; below zero means too timid. **Fav. stated → won** compares the favourite's mean stated chance with how often it won.

### Calibration by stated chance (champion, 2025–26 (reused))

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,125 | 54.9% | 55.5% | 0.5% | 0.5% |
| 60-70% | 7,879 | 64.9% | 65.6% | 0.7% | 0.6% |
| 70-80% | 7,240 | 75.0% | 76.5% | 1.5% | 1.5% |
| 80-90% | 6,945 | 85.0% | 86.0% | 1.0% | 1.0% |
| 90-100% | 6,653 | 94.9% | 94.6% | 0.2% | 0.4% |

### All slices (champion, 2025–26 (reused))

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.63% | 0.1566 | 0.4815 | −54.4 | 75.9% → 76.5% | −4.4‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.50% | 0.1689 | 0.5113 | +54.4 | 73.6% → 74.3% | −3.7‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.63% | 0.1566 | 0.4815 | −54.4 | 75.9% → 76.5% | −4.4‰ |
| q1-10 | 11,613 | 31.5% | 34.2% | 71.91% | 0.1816 | 0.5439 | +166.7 | 70.9% → 71.7% | −4.4‰ |
| q11-25 | 12,697 | 34.5% | 33.5% | 75.95% | 0.1628 | 0.4954 | −56.6 | 74.5% → 75.7% | −5.3‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.05% | 0.1597 | 0.4873 | −55.8 | 76.1% → 75.9% | +0.1‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.25% | 0.1742 | 0.5250 | +109.2 | 72.0% → 73.1% | −6.0‰ |
| 2nd | 8,732 | 23.7% | 23.0% | 75.94% | 0.1620 | 0.4928 | −45.4 | 74.9% → 75.8% | −3.9‰ |
| 3rd+ | 12,513 | 34.0% | 32.9% | 75.91% | 0.1621 | 0.4949 | −63.8 | 75.5% → 75.7% | −1.0‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.79% | 0.1687 | 0.5111 | +25.8 | 73.8% → 74.6% | −2.6‰ |
| veteran | 10,384 | 28.2% | 27.8% | 75.20% | 0.1652 | 0.5015 | −21.2 | 74.1% → 75.0% | −4.9‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.34% | 0.1667 | 0.5061 | −4.6 | 73.8% → 74.1% | −4.7‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.84% | 0.1767 | 0.5312 | +146.1 | 71.6% → 72.6% | −5.4‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.68% | 0.1622 | 0.4940 | −41.9 | 75.8% → 75.5% | +0.6‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.52% | 0.1593 | 0.4873 | −104.3 | 75.3% → 76.3% | −4.7‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.05% | 0.1596 | 0.4873 | −89.7 | 76.2% → 75.9% | +0.1‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.73% | 0.1586 | 0.4855 | −122.4 | 75.0% → 76.6% | −7.1‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.90% | 0.1867 | 0.5568 | +212.1 | 70.0% → 70.7% | −3.8‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.7% | 70.05% | 0.1898 | 0.5641 | +181.1 | 69.3% → 69.8% | −3.6‰ |
| rest | 21,629 | 58.7% | 56.3% | 76.08% | 0.1605 | 0.4900 | −146.3 | 75.1% → 75.9% | −4.7‰ |
| top quartile | 7,210 | 19.6% | 19.0% | 76.18% | 0.1624 | 0.4954 | −34.8 | 75.5% → 76.1% | −1.2‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.9% | 75.68% | 0.1644 | 0.4989 | −29.7 | 74.5% → 75.5% | −3.7‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.32% | 0.1684 | 0.5101 | +25.0 | 74.0% → 74.1% | −2.0‰ |
| small | 5,835 | 15.8% | 15.9% | 74.89% | 0.1680 | 0.5115 | +4.7 | 72.2% → 74.6% | −10.2‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 75.04% | 0.1657 | 0.5014 | −11.8 | 75.0% → 74.9% | +0.4‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.96% | 0.1720 | 0.5197 | +58.6 | 72.6% → 73.8% | −5.6‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.37% | 0.1641 | 0.5000 | −49.5 | 74.2% → 75.2% | −5.1‰ |
| world | 943 | 2.6% | 2.6% | 73.94% | 0.1701 | 0.5095 | +2.7 | 75.7% → 73.9% | +7.7‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,125 | 22.1% | 32.1% | 55.56% | 0.2432 | 0.6857 | +617.4 | 54.9% → 55.5% | −0.5‰ |
| 60-70 | 7,879 | 21.4% | 28.4% | 65.75% | 0.2224 | 0.6412 | +434.9 | 64.9% → 65.6% | −2.7‰ |
| 70-80 | 7,240 | 19.7% | 20.8% | 76.74% | 0.1766 | 0.5421 | +67.8 | 75.0% → 76.5% | −9.2‰ |
| 80-90 | 6,945 | 18.9% | 13.4% | 86.17% | 0.1187 | 0.4025 | −337.3 | 85.0% → 86.0% | −8.2‰ |
| 90-100 | 6,653 | 18.1% | 5.4% | 94.73% | 0.0496 | 0.2015 | −782.8 | 94.9% → 94.6% | +1.4‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,996 | 51.6% | 55.8% | 74.20% | 0.1809 | 0.5481 | +260.5 | 72.7% → 74.0% | −8.1‰ |
| close | 8,601 | 23.3% | 33.5% | 57.45% | 0.2401 | 0.6787 | +626.4 | 56.9% → 57.4% | −0.0‰ |
| lopsided | 9,245 | 25.1% | 10.7% | 92.00% | 0.0713 | 0.2634 | −886.9 | 92.1% → 91.9% | +1.6‰ |

## Champion, 2023–24 (in-sample for the champion)

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+248.3); Rated matches this season (fewest on the field) **0-5** (+187.1); Event phase: qualification match number **q1-10** (+176.1)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 7,295 | 54.3% | 54.7% | 0.4% | 0.3% |
| 60-70% | 5,815 | 64.9% | 64.2% | 0.7% | 0.8% |
| 70-80% | 5,260 | 74.9% | 75.5% | 0.6% | 0.5% |
| 80-90% | 4,944 | 84.9% | 85.5% | 0.7% | 0.5% |
| 90-100% | 4,761 | 95.0% | 94.7% | 0.2% | 0.3% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.5% | 76.72% | 0.1556 | 0.4751 | −55.0 | 76.7% → 76.6% | −0.2‰ |
| qual | 25,106 | 89.4% | 90.5% | 72.50% | 0.1763 | 0.5291 | +55.0 | 72.1% → 72.3% | −1.5‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 2,969 | 10.6% | 9.5% | 76.72% | 0.1556 | 0.4751 | −55.0 | 76.7% → 76.6% | −0.2‰ |
| q1-10 | 10,431 | 37.2% | 40.8% | 69.16% | 0.1910 | 0.5649 | +176.1 | 68.9% → 69.0% | −0.6‰ |
| q11-25 | 10,412 | 37.1% | 35.8% | 74.52% | 0.1681 | 0.5096 | −62.7 | 74.0% → 74.3% | −2.3‰ |
| q26+ | 4,263 | 15.2% | 14.0% | 75.71% | 0.1604 | 0.4889 | −58.5 | 75.6% → 75.6% | −1.8‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 12,415 | 44.2% | 47.1% | 70.51% | 0.1856 | 0.5503 | +142.2 | 70.2% → 70.3% | −0.1‰ |
| 2nd | 6,952 | 24.8% | 24.1% | 73.97% | 0.1693 | 0.5129 | −33.9 | 73.7% → 73.8% | −2.4‰ |
| 3rd+ | 8,708 | 31.0% | 28.8% | 75.60% | 0.1617 | 0.4932 | −108.2 | 75.3% → 75.4% | −2.3‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 15,029 | 53.5% | 54.0% | 72.56% | 0.1756 | 0.5266 | +21.2 | 72.2% → 72.4% | −1.6‰ |
| veteran | 7,416 | 26.4% | 25.8% | 73.69% | 0.1701 | 0.5131 | −30.3 | 73.5% → 73.6% | −1.4‰ |
| year2 | 5,630 | 20.1% | 20.2% | 73.00% | 0.1758 | 0.5281 | +9.1 | 72.5% → 72.8% | −0.6‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 12,833 | 45.7% | 49.5% | 69.79% | 0.1887 | 0.5583 | +187.1 | 69.7% → 69.6% | +0.3‰ |
| 16+ | 4,861 | 17.3% | 16.1% | 75.72% | 0.1623 | 0.4939 | −57.8 | 75.8% → 75.6% | +1.0‰ |
| 6-15 | 10,381 | 37.0% | 34.3% | 75.54% | 0.1617 | 0.4940 | −129.3 | 74.8% → 75.3% | −4.5‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 7,119 | 25.4% | 23.1% | 76.40% | 0.1589 | 0.4866 | −108.5 | 76.2% → 76.3% | +0.3‰ |
| normal | 11,776 | 41.9% | 39.1% | 75.35% | 0.1623 | 0.4940 | −139.8 | 74.7% → 75.2% | −4.6‰ |
| thin | 9,180 | 32.7% | 37.8% | 67.16% | 0.2012 | 0.5895 | +248.3 | 67.1% → 67.0% | +1.5‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 6,533 | 23.3% | 27.5% | 65.85% | 0.2057 | 0.6008 | +206.4 | 65.4% → 65.7% | −0.2‰ |
| rest | 16,156 | 57.5% | 55.8% | 74.24% | 0.1688 | 0.5110 | −86.5 | 74.1% → 74.1% | −1.0‰ |
| top quartile | 5,386 | 19.2% | 16.7% | 77.62% | 0.1519 | 0.4666 | −119.8 | 76.9% → 77.5% | −3.8‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 6,510 | 23.2% | 23.4% | 72.99% | 0.1756 | 0.5282 | +9.3 | 73.4% → 72.8% | +3.3‰ |
| mid | 15,470 | 55.1% | 54.2% | 73.26% | 0.1712 | 0.5153 | −46.1 | 72.9% → 73.1% | −3.0‰ |
| small | 6,095 | 21.7% | 22.5% | 72.09% | 0.1802 | 0.5385 | +36.8 | 71.1% → 71.9% | −2.0‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 4,378 | 15.6% | 15.8% | 72.57% | 0.1767 | 0.5305 | +11.4 | 73.7% → 72.4% | +5.0‰ |
| league meet | 11,683 | 41.6% | 42.7% | 71.91% | 0.1785 | 0.5350 | +51.2 | 70.8% → 71.7% | −5.6‰ |
| qualifier | 11,417 | 40.7% | 39.6% | 73.89% | 0.1695 | 0.5109 | −52.7 | 73.8% → 73.7% | +0.4‰ |
| world | 597 | 2.1% | 1.9% | 77.72% | 0.1576 | 0.4806 | −9.9 | 76.6% → 77.7% | +1.0‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 7,295 | 26.0% | 36.4% | 54.73% | 0.2439 | 0.6864 | +508.5 | 54.3% → 54.7% | −0.6‰ |
| 60-70 | 5,815 | 20.7% | 26.9% | 64.33% | 0.2265 | 0.6507 | +304.6 | 64.9% → 64.2% | +1.6‰ |
| 70-80 | 5,260 | 18.7% | 19.6% | 75.68% | 0.1823 | 0.5542 | +42.8 | 74.9% → 75.5% | −4.0‰ |
| 80-90 | 4,944 | 17.6% | 12.3% | 85.71% | 0.1215 | 0.4092 | −260.4 | 84.9% → 85.5% | −6.0‰ |
| 90-100 | 4,761 | 17.0% | 4.8% | 94.82% | 0.0491 | 0.2024 | −595.5 | 95.0% → 94.7% | +1.6‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 13,366 | 47.6% | 52.5% | 72.30% | 0.1920 | 0.5741 | +239.0 | 71.7% → 72.1% | −2.1‰ |
| close | 7,438 | 26.5% | 37.0% | 55.16% | 0.2433 | 0.6850 | +514.6 | 55.6% → 55.1% | +1.3‰ |
| lopsided | 7,271 | 25.9% | 10.5% | 92.18% | 0.0705 | 0.2648 | −753.6 | 91.7% → 92.1% | −2.7‰ |

## Champion, 2024–25 (in-sample for the champion)

Top excess-Brier slices: Event phase: qualification match number **q1-10** (+186.4); Data density (all four robots' rated matches) **thin** (+162.3); Rated matches this season (fewest on the field) **0-5** (+104.6)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 6,442 | 54.9% | 54.9% | 0.0% | 0.1% |
| 60-70% | 6,138 | 65.0% | 65.4% | 0.4% | 0.4% |
| 70-80% | 6,005 | 75.0% | 76.4% | 1.5% | 1.4% |
| 80-90% | 6,243 | 85.1% | 84.1% | 1.0% | 0.9% |
| 90-100% | 8,443 | 95.5% | 94.9% | 0.7% | 0.1% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.31% | 0.1502 | 0.4624 | −30.1 | 77.4% → 78.1% | −1.5‰ |
| qual | 28,885 | 86.8% | 87.4% | 76.27% | 0.1581 | 0.4829 | +30.1 | 76.2% → 76.1% | +0.9‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 4,386 | 13.2% | 12.6% | 78.31% | 0.1502 | 0.4624 | −30.1 | 77.4% → 78.1% | −1.5‰ |
| q1-10 | 10,927 | 32.8% | 36.4% | 73.22% | 0.1741 | 0.5247 | +186.4 | 73.5% → 73.0% | +2.7‰ |
| q11-25 | 11,671 | 35.1% | 33.7% | 77.59% | 0.1511 | 0.4646 | −69.7 | 77.4% → 77.4% | −0.3‰ |
| q26+ | 6,287 | 18.9% | 17.2% | 79.12% | 0.1432 | 0.4443 | −86.6 | 78.9% → 78.9% | +0.1‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 14,138 | 42.5% | 43.9% | 75.34% | 0.1624 | 0.4944 | +75.8 | 74.8% → 75.1% | −1.9‰ |
| 2nd | 8,049 | 24.2% | 23.4% | 77.60% | 0.1518 | 0.4660 | −42.3 | 77.3% → 77.4% | −0.1‰ |
| 3rd+ | 11,084 | 33.3% | 32.7% | 77.29% | 0.1540 | 0.4724 | −33.5 | 77.6% → 77.1% | +4.1‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 16,718 | 50.2% | 51.1% | 76.08% | 0.1597 | 0.4886 | +45.0 | 76.0% → 75.8% | +1.7‰ |
| veteran | 8,250 | 24.8% | 24.5% | 76.77% | 0.1554 | 0.4753 | −13.7 | 76.4% → 76.6% | −1.2‰ |
| year2 | 8,303 | 25.0% | 24.4% | 77.22% | 0.1533 | 0.4682 | −31.3 | 77.0% → 77.1% | +0.1‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 14,202 | 42.7% | 44.7% | 74.99% | 0.1644 | 0.4997 | +104.6 | 74.4% → 74.8% | −2.0‰ |
| 16+ | 6,847 | 20.6% | 20.5% | 76.98% | 0.1565 | 0.4765 | −3.6 | 77.3% → 76.8% | +4.7‰ |
| 6-15 | 12,222 | 36.7% | 34.8% | 78.09% | 0.1488 | 0.4596 | −101.0 | 78.1% → 77.9% | +1.3‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 10,110 | 30.4% | 29.8% | 77.46% | 0.1542 | 0.4724 | −28.4 | 78.0% → 77.3% | +6.3‰ |
| normal | 13,190 | 39.6% | 37.1% | 78.35% | 0.1469 | 0.4543 | −133.9 | 78.0% → 78.2% | −1.4‰ |
| thin | 9,971 | 30.0% | 33.1% | 73.20% | 0.1733 | 0.5224 | +162.3 | 72.6% → 73.0% | −2.6‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 7,418 | 22.3% | 25.3% | 72.12% | 0.1782 | 0.5340 | +157.4 | 71.8% → 71.9% | −1.0‰ |
| rest | 19,389 | 58.3% | 55.7% | 77.92% | 0.1501 | 0.4629 | −134.7 | 77.6% → 77.7% | +0.0‰ |
| top quartile | 6,464 | 19.4% | 19.0% | 77.45% | 0.1535 | 0.4704 | −22.7 | 77.9% → 77.3% | +4.1‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 8,980 | 27.0% | 26.9% | 76.72% | 0.1567 | 0.4788 | −2.7 | 76.6% → 76.6% | +1.2‰ |
| mid | 18,322 | 55.1% | 55.1% | 76.50% | 0.1570 | 0.4806 | +0.1 | 76.6% → 76.3% | +1.8‰ |
| small | 5,969 | 17.9% | 18.0% | 76.38% | 0.1575 | 0.4810 | +2.6 | 75.4% → 76.2% | −4.0‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 6,344 | 19.1% | 19.5% | 76.52% | 0.1609 | 0.4901 | +24.4 | 76.9% → 76.4% | +6.7‰ |
| league meet | 12,322 | 37.0% | 36.7% | 76.64% | 0.1556 | 0.4774 | −17.9 | 75.5% → 76.4% | −5.4‰ |
| qualifier | 13,903 | 41.8% | 41.6% | 76.45% | 0.1562 | 0.4771 | −11.9 | 76.9% → 76.3% | +2.7‰ |
| world | 702 | 2.1% | 2.2% | 76.79% | 0.1648 | 0.5019 | +5.5 | 76.7% → 76.6% | +9.1‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 6,442 | 19.4% | 30.0% | 54.93% | 0.2432 | 0.6867 | +555.4 | 54.9% → 54.9% | −0.1‰ |
| 60-70 | 6,138 | 18.4% | 26.2% | 65.53% | 0.2233 | 0.6433 | +407.0 | 65.0% → 65.4% | −1.4‰ |
| 70-80 | 6,005 | 18.0% | 20.4% | 76.66% | 0.1777 | 0.5450 | +124.1 | 75.0% → 76.4% | −8.2‰ |
| 80-90 | 6,243 | 18.8% | 15.7% | 84.31% | 0.1317 | 0.4358 | −158.2 | 85.1% → 84.1% | +5.9‰ |
| 90-100 | 8,443 | 25.4% | 7.6% | 94.98% | 0.0471 | 0.1908 | −928.3 | 95.5% → 94.9% | +4.7‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 14,975 | 45.0% | 54.2% | 73.05% | 0.1891 | 0.5676 | +480.3 | 72.1% → 72.9% | −3.4‰ |
| close | 6,425 | 19.3% | 29.6% | 56.07% | 0.2404 | 0.6813 | +535.4 | 56.3% → 56.0% | −0.0‰ |
| lopsided | 11,871 | 35.7% | 16.2% | 91.87% | 0.0715 | 0.2612 | −1015.7 | 92.6% → 91.7% | +5.9‰ |

## Baselines on 2025–26 (reused)

### v2.0

Top excess-Brier slices: Data density (all four robots' rated matches) **thin** (+210.1); Event phase: qualification match number **q1-10** (+167.5); Rated matches this season (fewest on the field) **0-5** (+145.7)

| Favourite's stated chance | Matches | Mean stated | Favourite won | Error | Error vs band midpoint |
|---|---|---|---|---|---|
| 50-60% | 8,496 | 55.0% | 55.4% | 0.4% | 0.4% |
| 60-70% | 8,047 | 65.0% | 66.1% | 1.2% | 1.1% |
| 70-80% | 7,360 | 74.9% | 77.4% | 2.5% | 2.4% |
| 80-90% | 6,878 | 85.0% | 86.7% | 1.7% | 1.7% |
| 90-100% | 6,061 | 94.8% | 95.0% | 0.2% | 0.0% |

#### Match type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.63% | 0.1565 | 0.4812 | −57.0 | 75.5% → 76.5% | −6.7‰ |
| qual | 31,725 | 86.1% | 87.0% | 74.38% | 0.1695 | 0.5127 | +57.0 | 72.9% → 74.2% | −6.5‰ |

#### Event phase: qualification match number

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| playoff | 5,117 | 13.9% | 13.0% | 76.63% | 0.1565 | 0.4812 | −57.0 | 75.5% → 76.5% | −6.7‰ |
| q1-10 | 11,613 | 31.5% | 34.2% | 71.95% | 0.1821 | 0.5453 | +167.5 | 70.6% → 71.8% | −4.9‰ |
| q11-25 | 12,697 | 34.5% | 33.6% | 75.65% | 0.1634 | 0.4972 | −54.7 | 73.9% → 75.4% | −7.9‰ |
| q26+ | 7,415 | 20.1% | 19.2% | 76.00% | 0.1602 | 0.4885 | −55.8 | 74.9% → 75.9% | −6.5‰ |

#### Event phase: robot's event of the season (lowest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 1st | 15,597 | 42.3% | 44.1% | 73.24% | 0.1746 | 0.5260 | +107.3 | 71.5% → 73.0% | −8.0‰ |
| 2nd | 8,732 | 23.7% | 23.0% | 75.71% | 0.1625 | 0.4941 | −45.6 | 74.4% → 75.5% | −6.6‰ |
| 3rd+ | 12,513 | 34.0% | 33.0% | 75.78% | 0.1628 | 0.4963 | −61.7 | 74.7% → 75.6% | −4.6‰ |

#### Team experience (least experienced robot)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| rookie | 17,177 | 46.6% | 47.0% | 74.69% | 0.1691 | 0.5121 | +24.3 | 73.2% → 74.5% | −5.5‰ |
| veteran | 10,384 | 28.2% | 27.8% | 75.08% | 0.1656 | 0.5027 | −21.3 | 73.6% → 74.9% | −7.6‰ |
| year2 | 9,281 | 25.2% | 25.1% | 74.27% | 0.1674 | 0.5078 | −3.1 | 73.2% → 74.0% | −7.2‰ |

#### Rated matches this season (fewest on the field)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 0-5 | 15,389 | 41.8% | 44.1% | 72.75% | 0.1772 | 0.5324 | +145.7 | 71.2% → 72.5% | −7.2‰ |
| 16+ | 8,268 | 22.4% | 21.8% | 75.63% | 0.1626 | 0.4951 | −41.7 | 74.9% → 75.5% | −4.1‰ |
| 6-15 | 13,185 | 35.8% | 34.1% | 76.37% | 0.1598 | 0.4886 | −104.1 | 74.8% → 76.2% | −7.2‰ |

#### Data density (all four robots' rated matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| dense | 11,835 | 32.1% | 30.7% | 76.01% | 0.1603 | 0.4889 | −87.3 | 75.3% → 75.9% | −4.0‰ |
| normal | 14,138 | 38.4% | 36.4% | 76.42% | 0.1590 | 0.4867 | −122.8 | 74.5% → 76.2% | −9.2‰ |
| thin | 10,869 | 29.5% | 32.9% | 70.99% | 0.1870 | 0.5578 | +210.1 | 69.5% → 70.8% | −5.7‰ |

#### Volatility (residual variance, robots with 6+ matches)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| not measured | 8,003 | 21.7% | 24.6% | 70.28% | 0.1902 | 0.5651 | +180.1 | 68.8% → 70.1% | −5.9‰ |
| rest | 21,629 | 58.7% | 56.3% | 75.97% | 0.1609 | 0.4913 | −146.7 | 74.5% → 75.8% | −7.4‰ |
| top quartile | 7,210 | 19.6% | 19.0% | 75.75% | 0.1630 | 0.4966 | −33.4 | 74.7% → 75.6% | −4.7‰ |

#### Event size (teams)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| large | 10,439 | 28.3% | 27.9% | 75.61% | 0.1650 | 0.5005 | −28.0 | 73.8% → 75.5% | −7.1‰ |
| mid | 20,568 | 55.8% | 56.2% | 74.20% | 0.1688 | 0.5111 | +22.7 | 73.5% → 74.0% | −4.7‰ |
| small | 5,835 | 15.8% | 15.9% | 74.78% | 0.1686 | 0.5129 | +5.3 | 71.8% → 74.5% | −12.0‰ |

#### Event type

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| championship | 7,650 | 20.8% | 20.6% | 75.14% | 0.1660 | 0.5024 | −12.6 | 74.2% → 75.0% | −4.0‰ |
| league meet | 12,338 | 33.5% | 34.4% | 73.71% | 0.1724 | 0.5208 | +57.7 | 72.1% → 73.5% | −7.8‰ |
| qualifier | 15,911 | 43.2% | 42.4% | 75.28% | 0.1647 | 0.5014 | −48.1 | 73.7% → 75.1% | −7.2‰ |
| world | 943 | 2.6% | 2.6% | 73.94% | 0.1710 | 0.5115 | +3.1 | 74.4% → 73.9% | +1.1‰ |

#### Favourite's stated chance

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| 50-60 | 8,496 | 23.1% | 33.4% | 55.47% | 0.2431 | 0.6854 | +641.1 | 55.0% → 55.4% | −0.7‰ |
| 60-70 | 8,047 | 21.8% | 28.8% | 66.28% | 0.2210 | 0.6384 | +429.4 | 65.0% → 66.1% | −4.0‰ |
| 70-80 | 7,360 | 20.0% | 20.5% | 77.64% | 0.1724 | 0.5329 | +34.4 | 74.9% → 77.4% | −13.7‰ |
| 80-90 | 6,878 | 18.7% | 12.7% | 86.86% | 0.1141 | 0.3912 | −368.7 | 85.0% → 86.7% | −12.5‰ |
| 90-100 | 6,061 | 16.5% | 4.5% | 95.11% | 0.0462 | 0.1907 | −736.1 | 94.8% → 95.0% | −2.5‰ |

#### Expected margin (in SDs of the margin)

| Slice | Matches | Share of matches | Share of Brier | Accuracy | Brier | Log loss | Excess Brier | Fav. stated → won | Surprise |
|---|---|---|---|---|---|---|---|---|---|
| clear | 18,996 | 51.6% | 55.8% | 74.20% | 0.1816 | 0.5499 | +263.8 | 72.0% → 74.0% | −11.1‰ |
| close | 8,601 | 23.3% | 33.5% | 56.99% | 0.2405 | 0.6797 | +626.6 | 56.5% → 56.9% | −0.5‰ |
| lopsided | 9,245 | 25.1% | 10.7% | 92.01% | 0.0714 | 0.2637 | −890.4 | 91.6% → 91.9% | −2.7‰ |

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
| rest | 21,629 | 58.7% | 56.3% | 74.16% | 0.1718 | 0.5195 | −156.9 | 73.0% → 74.0% | −4.7‰ |
| top quartile | 7,210 | 19.6% | 19.2% | 73.99% | 0.1754 | 0.5298 | −26.7 | 74.3% → 73.9% | +5.0‰ |

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
