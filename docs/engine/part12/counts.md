# Part 12.7: count-based phase distributions (measured; closed at step 1)

**Verdict: no build.** The engine is unchanged.
- Script: `scripts/part12/counts-research.ts`.
- Output: `counts-2026-10-23.json`.

One real finding (score ranges too wide) is recorded below as a separate follow-up.

## The brief's claim

Discrete phases, auto first, are lumpy. Replacing a continuous bell with Poisson or negative-binomial counts "for the consumers that sample phase distributions" should fix three things:
- bonus-RP probabilities ("RP thresholds are phase-specific");
- the Monte Carlo simulation;
- score-range widths.

The brief says to judge it on RP-call calibration and range coverage, not on headline accuracy.

## What the engine actually does

**No consumer samples a phase on its own:**
- **Bonus-RP odds** (`bonus.ts`) are a logistic on the alliance's whole non-penalty score, integrated over that score's distribution. The bonus model has no phase-specific thresholds.
- **The simulator** (`sim.ts`) draws the alliance's total and splits it by each robot's phase share.
- **Score ranges** are drawn on the final total.

A count model for auto would therefore have no consumer, unless it came with a new phase-level bonus model. So step 1 asks the question the brief says to judge by: are those calls wrong where lumpy, low-count scoring would bite (low scores, auto-heavy alliances)?

## Measured

**80% score ranges.** The share of real final scores inside the stated range (and the share below it):

| Season | All | By expected score, low → high | By auto share, low → high |
|---|---|---|---|
| 2023–24 | 84.3% (4.7% below, 11.0% above) | 87.5 · 85.6 · 82.4 · 80.7 · 85.2 | 85.5 · 84.7 · 83.9 · 84.4 · 83.2 |
| 2024–25 | 84.8% (6.6% below, 8.6% above) | 89.7 · 84.6 · 81.6 · 82.6 · 85.4 | 86.6 · 85.7 · 84.0 · 83.5 · 84.2 |
| 2025–26 | 85.5% (6.0% below, 8.5% above) | 88.3 · 85.3 · 85.1 · 84.3 · 84.7 | 86.6 · 86.3 · 85.2 · 85.5 · 84.1 |

**Bonus-RP odds, 2025–26 quals: a replay of the ledger's walk-forward calls** (`server/stats/job.ts`). Each match is called with a model refitted every 50 new alliances from the season's results before it. Calls before `BONUS_MIN_SAMPLES` results are left out, as the ledger leaves them out.

This is not a measurement of live match pages. Those use `Forecaster.bonusModel`: the shipped fit until enough results exist, then a fit from the latest results, once per build. That path was not replayed here. Values are stated / earned (%) by decile of stated probability:

| Bonus | Calibration error | Deciles |
|---|---|---|
| Movement | 3.00 pts | 27/26 34/34 39/40 43/47 46/50 50/55 55/57 60/60 67/63 80/71 |
| Goal | 2.39 pts | 0/0 0/0 0/0 0/0 1/0 2/1 6/2 15/8 35/28 72/68 |
| Pattern | 1.61 pts | 8/9 10/10 12/12 13/12 15/14 18/16 20/19 24/24 31/30 49/42 |

The shipped whole-season fit (`FITTED_MODEL.bonus`) applied to every match is far worse at the top: pattern is stated at 83% but earned 24%. Live pages fall back to it only before a season has enough results.

## Findings

1. **No count model is needed for bonus odds.** Replayed walk-forward calls are within 1.6–3.0 points. The remaining gap is mild overconfidence in the top decile (movement 80 → 71, pattern 49 → 42). That concerns the total-score logistic, not phase shape.
2. **Auto-heavy alliances are not worse covered than others** (within about 2 points in every season). Lumpy auto is not breaking the ranges.
3. **The ranges are too wide across the board.**
   - They cover 84–86% where 80% is stated, and 88–90% for the lowest-scoring fifth.
   - Misses lean high: 8.5–11% of scores land above the range, against 5–6.6% below.
   - The expected scores got sharper in 2.7–2.11 (Part 11: expected-score error fell), but the band width (`FITTED_MODEL.band`, fitted for 2.2) was not refitted.
   - **The fix is a band refit,** and possibly an upward skew. It is not count distributions.
   - **Follow-up, not built here:** refit `band.scale` (and check skew) on 2024–25, judge on 2025–26 coverage, and ship it as its own engine release on both apps.
