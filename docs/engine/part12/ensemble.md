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

**Blend:** logistic stacking of the three logits. It has no intercept (no colour term) and uses ridge toward "champion only". It was fit on mirrored rows of season s−1. A two-member blend (champion + Bayesian) was fit the same way, to show what the margin member adds.

**Judging:** rolling origin. Each fit season s−1 judges season s, for s = 2022, 2023, 2024 and 2025. The intervals are paired event bootstraps (1,000 draws, mulberry32).

### What "held out" means here

The blend's own constants and weights never see the judged season. The champion is a different matter:
- It is the frozen live engine.
- Its 22 contextual weights were fit on data from 2023–24 and 2024–25, and its final recalibration on 2025–26.
- So **2022–23 is the only fully held-out season.** 2023–24 to 2025–26 are a frozen-champion retrospective.
- There, the champion is partly in-sample. That favours the champion alone, and it makes the blend lean on it. It is the same caveat the slice reports carry.

## Brief's claim

Blending diverse members should improve held-out Brier. The part as a whole was expected to give "+0.5–1.5 accuracy points".

**Acceptance rules:**
- held-out Brier must beat the champion alone;
- a blend that "only ever moves calls by <1%" is dead weight and gets cut.

## Measured

Blend minus champion. Brier and log loss are ×10⁻⁴, where negative is better. Accuracy is in percentage points, where positive is better.

| Judged season (fit on) | n | Δ Brier [95%] | Δ log loss [95%] | Δ accuracy, pts [95%] | Δ Brier, no margin member [95%] |
|---|---|---|---|---|---|
| **2022–23 (2021), fully held out** | 24,226 | **+1.61 [−0.54, +3.48]** | +6.37 [−0.29, +12.22] | +0.01 [−0.15, +0.19] | +0.97 [−0.90, +2.66] |
| 2023–24 (2022), champion in-sample | 28,075 | −0.62 [−1.06, −0.12] | −1.40 [−2.64, +0.04] | −0.04 [−0.11, +0.04] | −0.62 [−1.04, −0.15] |
| 2024–25 (2023), champion in-sample | 33,271 | −0.98 [−2.06, +0.16] | −3.35 [−5.90, −0.50] | +0.05 [−0.06, +0.16] | −0.89 [−1.96, +0.25] |
| 2025–26 (2024), champion in-sample | 36,842 | −0.66 [−1.77, +0.41] | −2.35 [−5.28, +0.66] | −0.07 [−0.18, +0.05] | −0.28 [−1.22, +0.65] |

Members alone, Brier / accuracy:

| Season | Champion | Bayesian | Margin regression |
|---|---|---|---|
| 2022–23 | 0.16883 / 74.67% | 0.20461 / 67.45% | 0.17387 / 74.03% |
| 2023–24 | 0.17078 / 73.86% | 0.20375 / 67.63% | 0.17568 / 73.34% |
| 2024–25 | 0.15703 / 76.53% | 0.19419 / 69.30% | 0.16327 / 76.16% |
| 2025–26 | 0.16721 / 74.79% | 0.20299 / 68.05% | 0.17384 / 74.25% |

**Blend weights (champion, Bayesian, margin):**

| Fit season | Champion | Bayesian | Margin |
|---|---|---|---|
| 2021 | 0.809 | 0.083 | +0.175 |
| 2022 | 1.009 | 0.026 | −0.013 |
| 2023 | 0.960 | 0.075 | −0.006 |
| 2024 | 1.017 | 0.079 | −0.090 |

- The margin member's weight is unstable: positive once, then small and negative.
- Dropping it changes held-out Brier by at most 0.6×10⁻⁴, in either direction.

**Size of the adjustment, |blend − champion|:**

| Season | Median | p90 | p99 | Calls moved > 1% | Picks flipped |
|---|---|---|---|---|---|
| 2022 | 1.02% | 2.89% | 5.18% | 50.6% | 1.75% |
| 2023 | 0.26% | 0.75% | 1.34% | 3.9% | 0.43% |
| 2024 | 0.54% | 1.78% | 3.44% | 27.8% | 1.09% |
| 2025 | 0.68% | 2.07% | 3.88% | 35.7% | 1.33% |

**12.2 diagnostic:** quartiles of the selected Bayesian member's own uncertainty.
- The champion's error is highest in the most-uncertain quartile: 0.179–0.196 Brier, against 0.145–0.169 in the others.
- This is the thin-data pattern the Part 1 slice report already shows. It adds no new map.

## Why rejected

- **On the one fully held-out season, the blend is worse.** Brier is +1.61×10⁻⁴ and log loss +6.37×10⁻⁴; both intervals reach zero only at the edge.
  - The small gains in 2023–26 come where the champion is partly in-sample.
  - Even there, the gain is under 1×10⁻⁴ Brier, and the interval crosses zero in two of three seasons.
  - For scale, 2.7–2.11 each gave about 1.5–3×10⁻⁴, with intervals clear of zero.
- **No accuracy gain.** Every accuracy interval includes zero.
- **A real cost.** Shipping would add a second rating system to the shared package, a stored per-team state in both apps, and a factor-sheet line.
- **The adjustment is real but small.** The median move is 0.3–1.0%. This supports the cost argument.
  - It does not meet the brief's literal "only ever <1%" cut rule: 4–51% of calls moved by more than 1%.
  - The rejection rests on the held-out Brier, not on that rule.
- **The members are not diverse enough to help:**
  - The Bayesian member sees only wins and losses, so it is about 0.035 Brier worse than the champion. It can only nudge the champion.
  - The margin regression is built from the champion's own ratings. Its weight is unstable, and leaving it out changes little.

The brief's +0.5–1.5 accuracy points for the part did not appear for 12.1.

## Would revisit if

- A member with genuinely independent information appears, for example scouting data or a model that sees schedule strength the champion does not.
- The champion is refitted per origin, which makes every judged season fully held out.
- A new game makes the champion's score model fit badly early in a season.
