# Part 12.4: systematic tuning pass (swept; the candidate failed the gate)

**Verdict: no constant changes.** The engine stays 3.0.0.
- Script: `scripts/part12/sweep.ts`.
- Response surfaces: `sweep/<constant>.json`.
- Gate report: `../gates/gate-tuning-3.1-snapshot-2026-10-14.{md,json}`.

## The brief's claim

One disciplined sweep over the existing constants, with the flattest region chosen rather than the peak, should yield constants that "survive next season's game". The brief expected roughly +0.5–1.5 accuracy points across Part 12 as a whole.

## Method

- **Coordinate-wise, one pass.** Each constant was varied alone; the others were held at live, or at an earlier coordinate's pick.
- **Each value was replayed cold from 2023–24.** Only the TUNING season, 2024–25 (33,271 matches), was scored.
- **Scores:**
  - Brier and log loss of the served call (`predictMatch` with the fitted contextual model);
  - winner accuracy;
  - expected-score error: mean |final − expected| points per alliance.
- **Order:** `growthPerWeek` came first, because 12.3 found a late-season over-rating. Then `growthMaxWeeks`, at the new growth rate. Then the 13 other rating constants, from that base.
- **The candidate** was the set of plateau picks. It was run once through the Part 2 gate (`npm run slices -- --challenger`): paired event-bootstrap intervals and per-slice regression flags on 2023–24, 2024–25 (tuning) and 2025–26 (reused).

## Constants table (tuning season, 2024–25)

| Constant | Live | Grid | Plateau pick | Tuning Brier, live → pick (×10⁻⁴) | Surface |
|---|---|---|---|---|---|
| growthPerWeek | 0.05 | 0 – 0.07 | 0.03 | 1570.2 → 1569.7 | Flat from 0.02 to 0.04; 0 and 0.07 worse by +3. Score error is lowest at 0.02–0.03 (27.12 against 27.38 live). |
| growthMaxWeeks (at 0.03) | 8 | 2 – 12 | 6 | 1569.7 → 1569.2 | Flat from 4 to 8, within 0.6. |
| playoffWeight | 0.5 | 0.3 – 1.0 | 0.8 | 1569.2 → 1567.7 | Falls to a plateau at 0.7–0.9, then 1.0 is worse. |
| k0 | 0.65 | 0.45 – 0.85 | 0.65 (live) | — | Peak at live; 0.75 is +0.4, 0.55 +3.6, 0.85 +3.7. |
| n0 | 10 | 6 – 16 | 10 (live) | — | Flat within 0.3 from 8 to 16. |
| kMin | 0.33 | 0.23 – 0.43 | 0.33 (live) | — | Peak at live; ±0.05 costs +0.6 to +0.8. |
| rho1 | 0.7 | 0.6 – 0.8 | 0.7 (live) | — | Flat within 0.5 from 0.65 to 0.8. |
| rookieZ | −0.7 | −0.9 – −0.5 | −0.7 (live) | — | Flat within 0.5 from −0.8 to −0.5. |
| regionKappa | 20 | 10 – 40 | 20 (live) | — | Flat within 0.3. |
| eventLambdaAuto | 0.4 | 0.2 – 0.6 | 0.4 (live) | — | Flat within 0.2 from 0.3 to 0.6. |
| eventLambdaTeleop | 0.2 | 0.1 – 0.3 | 0.2 (live) | — | Flat within 0.2. |
| eventKappa | 1 | 0.5 – 3 | 1 (live) | — | Flat within 0.1 from 1 to 3. |
| penGain | 0.15 | 0.08 – 0.3 | 0.15 (live) | — | Flat within 0.1. |
| overlapAuto | 0.25 | 0.15 – 0.35 | 0.25 (live) | — | Flat within 0.2. |
| overlapTeleop | 0.15 | 0.05 – 0.25 | 0.15 (live) | — | Peak at live, flat within 0.2 from 0.1 to 0.2. |

**Flat-region rule:**
- Constants whose peak or plateau includes the live value kept it, because there is no reason to move.
- No peak and plateau disagreed materially. The three movers' picks are their plateau centres.

## Gate result for the candidate

Candidate: growthPerWeek 0.03, growthMaxWeeks 6, playoffWeight 0.8. Challenger minus 3.0.0, Brier ×10⁻⁴:

| Season | All | Playoffs | Quals | 50–80% calibration error | Regressions beyond noise |
|---|---|---|---|---|---|
| 2023–24 | +0.31 [−1.24, +1.77] | +3.16 | −0.03 | 0.54 → 0.47 pts | 6–15 rated matches (+3.39), league meets (+1.91) |
| 2024–25 (tuning) | **−2.51 [−4.55, −0.33]** | **−18.26 [−26.97, −9.46]** | −0.11 | 0.61 → 0.98 pts | first event (+3.38), 0–5 matches (+4.27), thin data (+4.71), not-measured volatility (+2.53), league meets (+2.68) |
| 2025–26 (reused) | +0.60 [−1.18, +2.36] | −0.03 | +0.70 | 0.90 → 1.08 pts | q1–10 (+3.04), first event (+3.57), 0–5 matches (+2.82), thin data (+4.66), not-measured volatility (+2.96), league meets (+2.14) |

Accuracy changed by 0.08 points or less overall, and every interval includes zero.

## Why rejected

- **The whole tuning gain is playoffs in one season.** In 2024–25, playoffs moved by −18×10⁻⁴; on the other seasons they did not move (+3.16 and −0.03). That is the overfitting signature the flat-region rule is meant to catch. Here it survived the coordinate-wise rule and was caught by slicing.
- **League meets regress beyond noise in all three seasons, and thin data in the two later ones.** In 2024–25 and 2025–26 the affected slices are first events, 0–5 rated matches and thin density. In 2023–24 only the 6–15-match and league-meet slices regressed; thin data there was −1.09 [−2.85, +0.56].
  - A slower between-event growth rate under-rates teams whose next event comes after a long gap. Those are exactly the thin-data matches, which Parts 1–3 worked to fix.
  - The tuning season's global Brier hid it.
- **Calibration in the 50–80% bands got worse** in both later seasons.

## What this says about 12.3's late-season drift

The late over-rating (−0.8 to −3.1 points at 24+ matches) is real. But a global growth constant cannot fix it without breaking early-season thin data. If it is ever addressed, it needs a term that depends on the event (late, strong events) rather than a different global growth rate. Nothing in this pass justifies building that now.

## Caveats

- The pass was one coordinate-wise sweep, not a joint grid. The two growth constants were tuned together; the others were not re-swept at the new base.
- Every constant except three was flat at live, so this pass is published evidence that the 3.0.0 constants already sit on plateaus.
