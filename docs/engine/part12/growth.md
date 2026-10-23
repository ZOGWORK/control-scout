# Part 12.3: experience / improvement curve (measured; closed at step 1)

**Verdict: no build.** The engine is unchanged (3.0.0).
- Script: `scripts/part12/growth-research.ts`.
- Output: `growth-2026-10-23.json`.

## The brief's claim

Young teams improve fastest during a season. A per-band growth adjustment (rookie / year 2) between events should improve the rookie and year-2 slices. Step 1 measures this first: "if step 1's slopes are within noise, this item closes with the finding recorded".

## What was measured

For every predicted, rated match in 2023–24, 2024–25 and 2025–26:
- Each alliance's miss is its actual non-penalty score minus the live engine's alliance expectation (`allianceExpectation`).
  - The expectation is read exactly as a prediction reads it: regional start, event form (2.9), the existing between-event growth factor and the quals overlap deduction (2.11) are all included.
  - So recent form is already controlled for.
- The miss is split evenly between the two robots.
- Each robot's share is bucketed by its experience band and by its rated matches so far this season.
- The slope of the miss on matches played (n ≤ 48) is fitted per band.

## Measured

Total non-penalty miss per robot (points, ± 95%), by matches already played:

| Season | Band | 0–5 | 6–11 | 12–23 | 24–47 | Slope per 10 matches |
|---|---|---|---|---|---|---|
| 2023–24 | Rookie | +1.53 ±0.26 | +1.68 ±0.33 | +1.60 ±0.38 | −0.78 ±0.98 | −0.48 ±0.22 |
| | Year 2 | −0.34 ±0.35 | +1.23 ±0.40 | +1.08 ±0.47 | −1.84 ±1.31 | +0.06 ±0.29 |
| | Veteran | −0.63 ±0.17 | +1.18 ±0.19 | +0.98 ±0.20 | −2.20 ±0.42 | −0.29 ±0.12 |
| 2024–25 | Rookie | +1.07 ±0.30 | +2.01 ±0.38 | +1.10 ±0.43 | −1.22 ±1.07 | −0.51 ±0.25 |
| | Year 2 | −0.97 ±0.37 | +1.32 ±0.44 | +0.66 ±0.47 | −3.12 ±1.00 | −0.52 ±0.26 |
| | Veteran | −0.91 ±0.19 | +0.95 ±0.22 | +0.68 ±0.22 | −2.96 ±0.42 | −0.63 ±0.12 |
| 2025–26 | Rookie | +1.34 ±0.25 | +0.95 ±0.30 | −0.66 ±0.32 | −2.11 ±0.77 | −1.25 ±0.18 |
| | Year 2 | −0.66 ±0.27 | −0.26 ±0.32 | −0.77 ±0.34 | −2.41 ±0.75 | −0.52 ±0.19 |
| | Veteran | −1.22 ±0.15 | −0.08 ±0.15 | −0.82 ±0.15 | −2.45 ±0.30 | −0.42 ±0.08 |

The per-phase tables are in the JSON.

(A first version of this measurement summed the robots' ratings directly and missed the 2.11 overlap deduction. That made every miss too negative: late-season figures of −3 to −7 points. It was corrected in review.)

## Findings

1. **There is no missing upward trajectory for young teams.**
   - The hypothesis predicts misses for rookies and year-2 teams that grow upward with matches played. Instead, every band's slope is negative or flat; the largest is year 2 in 2023–24, at +0.06 ±0.29.
   - Rookie minus veteran slope is −0.19, +0.12 and −0.82 points per 10 matches. It changes sign and is never positive beyond noise.
   - The existing growth factor and event form already keep up with the improvement that is there.
2. **Rookies start under-rated, and the engine catches up.**
   - In the first 5 matches, rookies are under-predicted by +1.1 to +1.5 points per robot in every season, while veterans are over-predicted by 0.6 to 1.2 points.
   - The gap closes as results come in. That is the opposite of a growth curve: a starting-prior question (`rookieZ`).
   - 12.4's sweep of `rookieZ` found Brier flat from −0.8 to −0.6, so a few early-match points do not move the win odds.
3. **A small late-season over-rating appears in every band:** −0.8 to −3.1 points per robot at 24–47 matches.
   - These robots play late, stronger events (championships, playoffs against full-strength alliances).
   - It is not an experience effect. It goes to 12.4, which sweeps `growthPerWeek` and `growthMaxWeeks`.

## Caveats

- Robots on the same alliance share a miss, so the intervals are somewhat optimistic. The conclusion does not rest on a narrow interval.
