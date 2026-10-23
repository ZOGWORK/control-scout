# Part 12.3: experience / improvement curve (measured; closed at step 1)

**Verdict: no build.** The engine is unchanged (3.0.0).
- Script: `scripts/part12/growth-research.ts`.
- Output: `growth-2026-10-23.json`.

## The brief's claim

Young teams improve fastest during a season. A per-band growth adjustment (rookie / year 2) between events should improve the rookie and year-2 slices. Step 1 measures this first: "if step 1's slopes are within noise, this item closes with the finding recorded".

## What was measured

For every predicted, rated match in 2023–24, 2024–25 and 2025–26:
- Each alliance's miss per phase is its actual score minus the live engine's expectation.
  - The expectation is read exactly as a prediction reads it: regional start, event form (2.9) and the existing between-event growth factor are all included.
  - So recent form is already controlled for.
- The miss is split evenly between the two robots.
- Each robot's share is bucketed by its experience band and by its rated matches so far this season.
- The slope of the miss on matches played (n ≤ 48) is fitted per band.

## Measured

Total non-penalty miss per robot (points, ± 95%), by matches already played:

| Season | Band | 0–5 | 6–11 | 12–23 | 24–47 | Slope per 10 matches |
|---|---|---|---|---|---|---|
| 2023–24 | Rookie | +0.96 ±0.26 | +0.94 ±0.33 | +0.37 ±0.38 | −3.02 ±1.00 | −1.04 ±0.23 |
| | Year 2 | −1.06 ±0.35 | +0.43 ±0.40 | −0.16 ±0.47 | −4.29 ±1.34 | −0.48 ±0.29 |
| | Veteran | −1.43 ±0.17 | +0.26 ±0.19 | −0.46 ±0.20 | −4.92 ±0.44 | −0.95 ±0.12 |
| 2024–25 | Rookie | +0.02 ±0.31 | +0.80 ±0.38 | −0.78 ±0.44 | −4.45 ±1.10 | −1.25 ±0.25 |
| | Year 2 | −2.29 ±0.38 | −0.03 ±0.45 | −1.51 ±0.48 | −6.98 ±1.04 | −1.38 ±0.27 |
| | Veteran | −2.30 ±0.20 | −0.51 ±0.22 | −1.55 ±0.23 | −6.82 ±0.44 | −1.50 ±0.12 |
| 2025–26 | Rookie | +0.32 ±0.26 | −0.24 ±0.30 | −2.38 ±0.33 | −4.91 ±0.79 | −1.86 ±0.19 |
| | Year 2 | −1.86 ±0.28 | −1.48 ±0.32 | −2.62 ±0.34 | −5.71 ±0.77 | −1.23 ±0.19 |
| | Veteran | −2.53 ±0.15 | −1.37 ±0.15 | −2.72 ±0.16 | −5.95 ±0.31 | −1.19 ±0.09 |

The per-phase tables are in the JSON. Auto, teleop and endgame show the same pattern.

## Findings

1. **There is no missing upward trajectory for young teams.**
   - The hypothesis predicts positive, growing misses for rookies and year-2 teams. Every band's slope is negative instead.
   - Rookie minus veteran slope is within about ±0.7 points per 10 matches, and changes sign across seasons (−0.09, +0.25, −0.67).
   - The existing growth factor and event form already cover the improvement that is there.
2. **Rookies start slightly under-predicted:** +0.3 to +1.0 points per robot in their first 5 matches in two of three seasons. This is small, and it fades by match 12. It is the regional-prior territory 2.7 already addressed.
3. **A common late-season drift in every band.** Robots with 24–47 matches are over-predicted by 3–7 points.
   - These are the teams at late, stronger events (championships, playoffs against full-strength alliances).
   - Candidate causes: the between-event growth factor extrapolating too far, or harder late events.
   - This is not an experience effect, so it goes to 12.4 (tuning sweep: `growthPerWeek`, `growthMaxWeeks`) rather than here.

## Caveats

- Robots on the same alliance share a miss, so the intervals are somewhat optimistic. The conclusion does not rest on a narrow interval.
- The 0–5 bucket is negative for veterans and year-2 teams: season priors are slightly high early on. This is a known calibration-of-start effect, and the event-form term absorbs it within an event.
