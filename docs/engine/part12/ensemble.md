# Part 12.1 + 12.2: win-probability ensemble with a Bayesian member (measured, rejected)

**Verdict: not shipped.** The engine is unchanged (3.0.0). The research script and its output are kept:
- `scripts/part12/ensemble-research.ts`
- `ensemble-2026-10-23.json`

## What was built (research only)

Three members were computed for every predicted, rated match, replayed chronologically from 2019:

| Member | What it is |
|---|---|
| (a) Champion | The live engine 3.0.0, exactly as served: `predictMatch` with the fitted contextual model and recalibration. |
| (b) Bayesian (12.2) | A TrueSkill-style rating: per-team mean and variance, updated from wins and losses only. Ties and unrated events are skipped. Win% = Φ(Δμ / c). Its constants (β, τ, season carry-over) were picked from a 12-point grid on the fit season. |
| (c) Margin regression | Actual margin regressed on the champion's per-phase rating differences (auto, teleop, endgame, fouls). There is no intercept, so the model is colour-symmetric. Win% = Φ(predicted margin / residual sd). |

**Blend:** logistic stacking of the three logits. It has no intercept (no colour term) and uses ridge toward "champion only". It was fit on mirrored rows of season s−1.

**Judging:** rolling origin. Each fit season s−1 judges season s, for s = 2023, 2024 and 2025. The intervals are paired event bootstraps (1,000 draws).

## Brief's claim

Blending diverse members should improve held-out Brier. The part as a whole was expected to give "+0.5–1.5 accuracy points".

**Acceptance rules:**
- held-out Brier must beat the champion alone;
- a blend that "only ever moves calls by <1%" is dead weight and gets cut.

## Measured

Blend minus champion, ×10⁻⁴ (negative is better):

| Judged season (fit on) | n | Δ Brier [95%] | Δ log loss [95%] | Δ accuracy, pts [95%] |
|---|---|---|---|---|
| 2023–24 (2022) | 28,075 | −0.62 [−0.97, −0.20] | −1.40 [−2.46, −0.40] | −0.04 [−0.11, +0.03] |
| 2024–25 (2023) | 33,271 | −0.98 [−1.77, +0.45] | −3.35 [−5.22, +0.24] | +0.05 [−0.05, +0.14] |
| 2025–26 (2024) | 36,842 | −0.66 [−1.79, +0.25] | −2.35 [−5.57, +0.62] | −0.07 [−0.22, +0.08] |

Members alone, held-out Brier / accuracy:

| Season | Champion | Bayesian | Margin regression |
|---|---|---|---|
| 2023–24 | 0.17078 / 73.86% | 0.20375 / 67.63% | 0.17568 / 73.34% |
| 2024–25 | 0.15703 / 76.53% | 0.19419 / 69.30% | 0.16327 / 76.16% |
| 2025–26 | 0.16721 / 74.79% | 0.20299 / 68.05% | 0.17384 / 74.25% |

**Blend weights (champion, Bayesian, margin):**
- 2023: 1.009, 0.026, −0.013
- 2024: 0.960, 0.075, −0.006
- 2025: 1.017, 0.079, −0.090

The margin member gets a zero or negative weight. It adds nothing that the champion does not already know.

**Size of the adjustment, |blend − champion|:**

| Season | Median | p90 | p99 | Calls moved > 1% | Picks flipped |
|---|---|---|---|---|---|
| 2023 | 0.26% | 0.75% | 1.34% | 3.9% | 0.43% |
| 2024 | 0.54% | 1.78% | 3.44% | 27.8% | 1.09% |
| 2025 | 0.68% | 2.07% | 3.88% | 35.7% | 1.33% |

**12.2 diagnostic** (Bayesian uncertainty quartiles): the champion's error is highest in the most-uncertain quartile, at 0.179–0.196 Brier against 0.145–0.167 in the others. This is the thin-data pattern the Part 1 slice report already shows. It adds no new map.

## Why rejected

- **The gain is too small to carry its cost.** It is under 1×10⁻⁴ Brier, and the 95% interval crosses zero in both recent seasons.
  - For scale, 2.7–2.11 each gave about 1.5–3×10⁻⁴, with intervals clear of zero.
  - Shipping it would add a second rating system to the shared package, a stored per-team state in both apps, and a factor-sheet line.
- **No accuracy gain.** Every accuracy interval includes zero.
- **The adjustment is mostly below the dead-weight line.** The median move is under 1% in every season. That is the brief's own cut rule.
- **The members are not diverse enough to help:**
  - The Bayesian member sees only wins and losses, so it is about 0.035 Brier worse than the champion. It cannot correct a score-based model; it can only nudge it.
  - The margin regression is built from the champion's own ratings, so it is redundant.

The brief's +0.5–1.5 accuracy points for the part did not appear for 12.1.

## Would revisit if

- A member with genuinely independent information appears, for example scouting data or a model that sees schedule strength the champion does not.
- A new game makes the champion's score model fit badly early in a season.
