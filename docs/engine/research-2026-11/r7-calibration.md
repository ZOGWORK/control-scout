# R7: calibration, properly measured

**Verdict:** calibration is not where the remaining error is.
- **Platt vs isotonic.** On decisive DECODE matches the result is the same as Part 12.5: isotonic is no better than the shipped Platt-family stretch, so the stretch stays.
- **Ceiling from perfect calibration.** The Murphy decomposition puts the live engine's calibration cost at about 1–2×10⁻⁴ of Brier (0.1%). Perfect calibration would move the DECODE Brier from 0.1681 to 0.1680 at best.
- **Where the remaining error is.** Everything left is resolution: telling strong alliances from weak ones. That needs better information, not a better final mapping.
- Script: `scripts/research/r7-calibration.ts`, with helpers in `scripts/research/r67-lib.ts`.
- Output: `r7-calibration-2026-10-14.json`.
- Data: a copy of `data/snapshot.db.br` (data version 2026-10-14T04:19:58Z).

## Part 1: Platt vs isotonic, decisive DECODE matches

Part 12.5 (`docs/engine/part12/isotonic.md`) already ran this comparison walk-forward and rejected isotonic. It scored **every** rated match, ties included (as half-wins), so the exact slice the prompt asks for (decisive DECODE matches) was not reported. This run uses 12.5's method unchanged (the same rolling origins, fits and PAV map, copied into the script) and **scores decisive matches only**:
- The input is the engine's chance before its final stretch. Rows come from `engine-slices --champion '{"rating":{},"recalibration":false}' --rows`.
- Each month from October 2024 to July 2026 is fitted on the 365 days before it. The fit keeps ties as half-wins, as 12.5 and the shipped fit do.
- **Platt** is p′ = σ(a·z), slope only and mirrored. **Isotonic** is the symmetric pool-adjacent-violators map of |z|.

Isotonic minus Platt. Brier and log loss are ×10⁻⁴, where negative is better. Intervals come from resampling whole events.

| Season | Decisive n | Δ Brier [95%] | Δ log loss | Δ accuracy [95%] |
|---|---|---|---|---|
| 2024–25 (rolled, tuning) | 32,974 | +0.84 [+0.07, +1.62] | +2.55 | −0.07 [−0.13, −0.00] |
| 2025–26 DECODE (rolled, reused) | 36,572 | −0.12 [−1.04, +0.82] | +0.23 | 0.00 [−0.03, +0.03] |

| Season | No stretch: Brier / acc. | Platt: Brier / acc. | Isotonic: Brier / acc. |
|---|---|---|---|
| 2024–25 | 0.1580 / 76.53% | 0.1579 / 76.53% | 0.1580 / 76.46% |
| 2025–26 | 0.1684 / 74.79% | 0.1682 / 74.79% | 0.1682 / 74.80% |

**Same verdict as 12.5.**
- On the tuning season isotonic is worse on Brier, beyond noise, and slightly worse on accuracy.
- On DECODE it ties: the interval straddles zero, and log loss is worse.
- It fails the gate (a Brier win with the interval below zero, on both seasons), so it does not ship.
- Margin MAE is identical for both (calibration does not move the expected margin).

Isotonic does have lower **reliability** (REL) in both seasons, because a step map can follow the bins more closely: in DECODE, 1.43 against 2.29×10⁻⁴ raw, or 0.53 against 1.40 debiased. But it gives that back in resolution, so Brier does not improve. This is the "fits noise the sigmoid smooths over" result from 12.5, seen through the decomposition.

## Part 2: Murphy decomposition of the live engine

**Method.** The forecast is p = the live engine's served P(red wins). Matches are decisive and from rated events, pre-match from the slice replay; per season, and quals vs playoffs.
- **Bin scheme:** 20 equal-width bins of p (5-point bins), with 10 and 50 bins reported for sensitivity.
- BS ≈ REL − RES + UNC (Murphy 1973), where for bin k with n_k matches, mean stated chance p̄_k and observed red win rate ō_k:
  - REL = Σ n_k (p̄_k − ō_k)² / N (the calibration term; lower is better);
  - RES = Σ n_k (ō_k − ō)² / N (resolution; higher is better);
  - UNC = ō(1 − ō) (uncertainty: the Brier of a constant forecast at the base rate).
- **BS − REL** is the Brier the same forecasts would score with perfect calibration (each bin's stated chance equal to its win rate).
- **Self-expected Brier** is the mean p(1 − p): the Brier the engine expects of itself if its own chances were exactly true.
- **Intervals** come from resampling whole events, 1,000 draws.

**Bias of the binned decomposition (read before the numbers).**
- **Noise inflates REL.** Each bin's observed rate carries sampling noise, adding about ō_k(1 − ō_k)/n_k to (p̄_k − ō_k)². So the plain REL is biased upward by about Σ_k ō_k(1 − ō_k)/N, roughly 1×10⁻⁴ at N ≈ 35,000 with 20 bins.
  - The **debiased REL** column subtracts that noise term (Ferro & Fricker 2012 style).
  - The upward bias shows in the bin sensitivity: DECODE's REL is 1.62, 1.94 and 2.92×10⁻⁴ at 10, 20 and 50 bins. True miscalibration does not grow with the bin count; noise does.
- **Binning also drops the within-bin terms**, so REL − RES + UNC ≠ BS exactly (Stephenson et al. 2008). The residual BS − (REL − RES + UNC) is −1.5 to −2.9×10⁻⁴ here: as large as REL itself.
  - So REL is only known to within a few 10⁻⁴. That is the honest resolution of "how much is calibration".
- **The REL intervals sit above their point estimates.** Resampling events adds bin noise on top of the noise already in the estimate, so the bootstrap distribution is shifted up. Read each REL interval as an upper range, not as a centred interval.
- **In-sample caveat.** The served chance includes the final stretch (slope 1.057692), which was fitted on 2024-07-26 to 2026-07-26. So the live REL for 2024–25 and 2025–26 is in-sample for that one parameter.
  - The walk-forward Platt row below is the out-of-sample version. Its DECODE REL is 2.29×10⁻⁴ raw, 1.40 debiased: the same size.

REL and residual are ×10⁻⁴.

| Season / part | n | BS [95%] | REL (raw) [95%] | REL debiased [95%] | RES [95%] | UNC [95%] | BS − REL [95%] | Self-expected Brier | Residual | REL at 10 / 50 bins |
|---|---|---|---|---|---|---|---|---|---|---|
| 2023–24 all | 27,861 | 0.1752 [0.1727, 0.1780] | 1.74 [1.53, 4.74] | 0.55 [0.32, 3.55] | 0.0741 [0.0714, 0.0766] | 0.2493 [0.2490, 0.2496] | 0.1750 [0.1724, 0.1777] | 0.1765 | −2.43 | 1.16 / 3.67 |
| 2023–24 qual | 24,910 | 0.1774 [0.1745, 0.1803] | 1.70 [1.59, 4.90] | 0.37 [0.26, 3.58] | 0.0725 [0.0697, 0.0757] | 0.2500 | 0.1772 [0.1742, 0.1800] | 0.1789 | −2.54 | 1.09 / 4.50 |
| 2023–24 playoff | 2,951 | 0.1563 [0.1490, 0.1635] | 14.72 [13.85, 40.97] | 3.30 [2.52, 29.70] | 0.0481 [0.0423, 0.0562] | 0.2030 [0.1950, 0.2102] | 0.1548 [0.1460, 0.1607] | 0.1565 | −1.46 | 5.48 / 23.29 |
| 2024–25 all | 33,017 | 0.1578 [0.1554, 0.1602] | 1.56 [1.41, 4.05] | 0.55 [0.40, 3.04] | 0.0917 [0.0895, 0.0943] | 0.2496 [0.2493, 0.2497] | 0.1577 [0.1551, 0.1599] | 0.1572 | −1.72 | 1.17 / 3.61 |
| 2024–25 qual | 28,664 | 0.1589 [0.1564, 0.1614] | 1.75 [1.60, 4.71] | 0.58 [0.43, 3.55] | 0.0911 [0.0887, 0.0937] | 0.2500 | 0.1587 [0.1561, 0.1611] | 0.1580 | −1.51 | 1.19 / 4.32 |
| 2024–25 playoff | 4,353 | 0.1508 [0.1445, 0.1575] | 9.86 [8.94, 29.49] | 2.36 [1.51, 22.32] | 0.0682 [0.0625, 0.0760] | 0.2183 [0.2122, 0.2241] | 0.1498 [0.1425, 0.1560] | 0.1523 | −2.91 | 6.27 / 18.52 |
| **2025–26 all (reused)** | 36,572 | **0.1681** [0.1658, 0.1704] | **1.94** [1.65, 4.64] | **1.04** [0.75, 3.76] | **0.0810** [0.0788, 0.0834] | **0.2492** [0.2489, 0.2494] | **0.1680** [0.1654, 0.1702] | 0.1719 | −2.37 | 1.62 / 2.92 |
| 2025–26 qual | 31,489 | 0.1699 [0.1673, 0.1724] | 1.83 [1.52, 4.60] | 0.79 [0.47, 3.59] | 0.0800 [0.0775, 0.0829] | 0.2500 | 0.1697 [0.1669, 0.1723] | 0.1736 | −2.37 | 1.53 / 2.97 |
| 2025–26 playoff | 5,083 | 0.1573 [0.1520, 0.1629] | 10.22 [8.99, 26.54] | 3.79 [2.50, 20.03] | 0.0619 [0.0575, 0.0675] | 0.2185 [0.2129, 0.2233] | 0.1563 [0.1500, 0.1613] | 0.1617 | −2.23 | 8.30 / 16.99 |

The walk-forward final mappings (Part 1 rows; out of sample), 20 bins, ×10⁻⁴ for REL:

| Season | Mapping | BS | REL raw [95%] | REL debiased [95%] | RES [95%] | BS − REL [95%] |
|---|---|---|---|---|---|---|
| 2024–25 | Platt | 0.1579 | 1.49 [1.36, 3.86] | 0.47 [0.34, 2.84] | 0.0916 [0.0894, 0.0942] | 0.1577 [0.1552, 0.1600] |
| 2024–25 | isotonic | 0.1580 | 1.34 [1.25, 3.69] | 0.32 [0.22, 2.68] | 0.0915 [0.0892, 0.0940] | 0.1578 [0.1553, 0.1601] |
| 2025–26 | Platt | 0.1682 | 2.29 [1.89, 5.10] | 1.40 [1.00, 4.22] | 0.0810 [0.0788, 0.0834] | 0.1680 [0.1655, 0.1702] |
| 2025–26 | isotonic | 0.1682 | 1.43 [1.35, 3.71] | 0.53 [0.44, 2.80] | 0.0810 [0.0787, 0.0834] | 0.1681 [0.1656, 0.1703] |

## How close to the ceiling the engine is

DECODE (2025–26, all decisive matches, live engine):
- **Brier 0.1681 = REL 0.0002 − RES 0.0810 + UNC 0.2492** (plus a −0.0002 binning residual).
- **Perfect calibration:** BS − REL = 0.1680 (debiased: 0.1680 as well, since 1.04×10⁻⁴ rounds away).
  - Calibration costs 1–2×10⁻⁴ of Brier, about 0.1%, which is smaller than the event-bootstrap interval on the Brier itself (±23×10⁻⁴).
  - No calibration method can buy more than that. The same holds in 2023–24 (0.1752 → 0.1750) and 2024–25 (0.1578 → 0.1577).
- **Uncertainty: UNC = 0.2492.** This is the Brier of always saying "the base rate" (red wins 52.8% of decisive matches: 50.4% of quals, 67.8% of playoffs). It is fixed by the matches, not the model.
  - It is **not** the floor. The true floor, the noise left once both alliances' real strength is known, cannot be measured from outcomes alone.
- **Resolution: RES = 0.0810.** This is what the engine removes from UNC by separating strong alliances from weak ones. It is the only term left to improve.
  - The program's stretch target of Brier 0.155 would need RES of about 0.094 (+16%), with calibration as it is.
  - That has to come from better information: ratings, features, the R1–R5 topics. It cannot come from the final mapping.
- **Self-expected Brier 0.1719 against actual 0.1681.** If the engine's own chances were exactly true it would expect a Brier of 0.172. It does slightly better than it expects, so it is still a little **timid** in DECODE, consistent with the favourite winning 1–2 points more often than stated in the 65–85% bands (12.5).
  - That timidity is already priced in the REL above. A slightly steeper stretch is the rollover refit noted in 12.5, worth at most ~1×10⁻⁴.

**Quals vs playoffs.**
- **Playoff REL looks five times larger** (raw 9.9–14.7×10⁻⁴), but most of that is small-sample noise: there are about 3,000–5,000 matches over 20 bins. Debiased, it is 2.4–3.8×10⁻⁴, and the bin sensitivity (6–8 at 10 bins, 17–23 at 50) shows how noise-driven the raw number is. Playoff calibration costs at most a few 10⁻⁴: R6's playoff-only recalibration (slope) found no gain, and the seed term only a season-specific one.
- **Playoff UNC is lower** (0.20–0.22 against 0.25), because red is the higher seed and wins 68–72% of playoff matches. That, not better modeling, is why playoff Brier is lower.
- **Playoff RES is lower too** (DECODE 0.062 against 0.080). Selected alliances are harder to separate than random quals pairs. See R6.

## What changes

Nothing. The engine stays 3.3.0 with the Platt-family stretch.
- The 2026–27 rollover refit of the stretch slope (already on the list from 12.5) stays the one calibration action.
- The decomposition says calibration work beyond that cannot move Brier by more than about 0.0002.
