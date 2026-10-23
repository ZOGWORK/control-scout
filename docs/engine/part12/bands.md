# Score-range band refit (follow-up to Part 12.7; shipped as engine 3.2.0)

**Verdict: shipped.** Win probabilities are identical to 3.1.0: the slice replay has the same row hashes and reports. Score ranges and the event simulator's score spread change.
- Script: `scripts/part12/band-refit.ts`.
- Output: `bands-2026-10-23.json`, measured with 3.1 as the baseline.

## Why

Part 12.7 found that the stated 80% score ranges held 84–86% of real scores. Misses leaned high, and low-scoring alliances were covered at 88–90%.
- The band (`FITTED_MODEL.band`) was fitted for 2.2.
- Since then, 2.7–2.11 made the expected scores sharper (regional starts, event form, overlap, slow foul learning), but the band was never refitted.
- The same band sets the event simulator's per-alliance score spread (engine 2.6, `gameVariance`), so the simulator's scores were also a little too spread out.

## Method (the 2.2 recipe)

- Every 2-robot alliance score in 2023–24 to 2025–26 (196,376) is replayed walk-forward through the live engine.
- The band's inputs are read exactly as `predictMatch` reads them: expected score, the alliance's consistency factor, the fewest matches played, rating uncertainty and playoff flag.
- Every row's range was checked against the served one, and all matched.
- **Fit:** coordinate descent on the 80% interval score (width + 2/α × distance outside), on 2024–25 only. Ranges are whole points, inside means lo ≤ score ≤ hi, and values are rounded to two places as in 2.2.
- **Judged** on 2025–26, with 2023–24 reported as an earlier out-of-sample season.

## The fit, and the one choice made after looking

| Parameter | 2.2 band | Plain fit | Shipped (3.2.0) |
|---|---|---|---|
| scale | 1.1 | 0.92 | 0.92 |
| consistencyPower | 0.3 | 0.66 | 0.66 |
| smallSample | 0.7 | 0.85 | 0.85 |
| rating | 0.75 | 0.59 | 0.59 |
| playoff | 0.6 | 0.59 | **0.72** |

With the plain fit, playoff ranges under-covered outside the tuning season:
- 2025–26: 75.9% coverage, interval score 128.56 against 128.04 before.
- 2023–24: 77.2%, 121.04 against 120.63.

The fit cut the overall width but left the playoff factor alone, so playoff ranges shrank with it. The shipped playoff factor keeps playoff ranges as wide as before (scale × playoff = 1.1 × 0.6 = 0.66, so 0.66 / 0.92 = 0.72).

**This choice was made after seeing 2025–26 playoffs, so 2025–26 is reused evidence for that one parameter.** The other four are fitted on 2024–25 alone.

## Measured (shipped band against the 2.2 band, under 3.1's expected scores)

| Season | Coverage | Interval score | Mean width (points) | Below / above |
|---|---|---|---|---|
| 2023–24 | 84.3% → 81.5% | 112.53 → 112.28 | 81.8 → 76.3 | 4.7 / 11.0 → 5.8 / 12.7 |
| 2024–25 (tuning) | 84.8% → 82.0% | 125.32 → 124.46 | 96.0 → 89.6 | 6.6 / 8.6 → 8.0 / 10.0 |
| 2025–26 | 85.5% → 81.4% | 128.00 → 126.60 | 91.5 → 82.0 | 6.0 / 8.5 → 8.5 / 10.1 |

2025–26 by part:
- **Quals:** 86.0% → 81.7% (interval score 127.99 → 126.39).
- **Playoffs:** 82.6% → 80.1% (128.04 → 127.86).
- **Robots with fewer than 6 matches:** 87.0% → 84.2% (120.87 → 119.25). These are still a little wide; the small-sample term grew, but thin data stays cautious.
- **6+ matches:** 84.7% → 79.9%.

**Still not perfect:**
- Misses keep leaning high: about 10% above the range against 8.5% below.
- Ranges are symmetric around the expected score and floored at 0. A skewed range would need a new band term; it was not built.

## Event simulator (Part 11 Monte Carlo check)

`npm run projections:replay -- 2025 --events 40 --runs 2000`: 40 finished 2025–26 events, cut at their midpoint.

| | 3.1.0 | 3.2.0 |
|---|---|---|
| Final ranks inside the P10–P90 band | 87.2% (958 / 1,098) | 86.8% (953 / 1,098) |
| Mean P10–P90 width | 12.25 ranks | 11.91 ranks |
| Mean \|actual − median\| | 3.58 ranks | 3.59 ranks |

The simulator's rank bands get slightly narrower, a little closer to their nominal 80%, with no loss of accuracy.

## Unchanged

- **Win probabilities.** They use the score model's own sd, not the band. The slice replay is bit-identical to 3.1.0.
- **Bonus-RP odds.** These also use that sd.
