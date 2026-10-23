# Part 12.8: test-only slice tags (measured; neither graduates)

**No build was authorised, and none is made.** The engine is unchanged.
- Script: `scripts/part12/tags-research.ts`.
- Output: `tags-2026-10-23.json`.

## The brief's claim

There are two hypotheses, both expected to be small or imaginary:
- **Short turnaround:** a robot that just played does worse.
- **Alliance colour:** some games have a slight field asymmetry.

A tag graduates to a build item only with an effect that survives the held-out season (2025–26).

## Method

- **The replay:** the live engine (3.0.0, which has the same win odds as 3.1.0) replays 2023–24 to 2025–26. Each alliance in each predicted match is one row.
- **Turnaround:** in a qualification match, count the matches each robot sat out since its previous qual at the same event, in schedule order (start times are too patchy). The alliance's tag is the fewest of its robots'.
- **Measures:**
  - won − stated: the alliance's win rate minus its stated chance, with ties counted half;
  - score miss: actual final score minus expected.
- **Intervals:** event bootstraps.

## Measured

**Short turnaround.** Values are won − stated in percentage points [95%], then score miss in points:

| Season | Back-to-back (0) | 1 | 2–3 | 4+ |
|---|---|---|---|---|
| 2023–24 | +0.14 [−0.97, +1.32]; miss +2.38 | −0.50 [−1.36, +0.37]; +3.24 | −0.34 [−0.76, +0.08]; +3.91 | +0.32 [+0.02, +0.63]; +4.75 |
| 2024–25 | +0.31 [−0.78, +1.44]; +1.36 | +0.37 [−0.33, +1.04]; +2.03 | +0.14 [−0.28, +0.60]; +2.21 | −0.25 [−0.53, +0.04]; +2.45 |
| 2025–26 | +0.34 [−0.95, +1.57]; −0.23 | +0.38 [−0.29, +1.08]; +1.21 | −0.35 [−0.84, +0.08]; +1.00 | +0.09 [−0.17, +0.33]; +2.30 |

- **Win odds:** there is no effect. Every back-to-back and one-gap interval includes zero, in every season.
- **Scores:** there is a small, consistent pattern. Back-to-back alliances score 1.1 to 2.5 points less, relative to expectation, than rested ones (4+), in all three seasons.
  - Both alliances in a match are often equally short of rest, which is likely why it doesn't reach the win odds.
  - At a couple of points, a small share of a typical alliance score, it is not worth a model term. This is recorded, not built.

**Alliance colour.** Red's win rate minus red's stated chance, in points [95%]:

| Season | Quals | Playoffs |
|---|---|---|
| 2023–24 | +0.34 [−0.17, +0.84] | +1.18 [−0.19, +2.58] |
| 2024–25 | −0.20 [−0.63, +0.27] | +0.31 [−0.88, +1.56] |
| 2025–26 | +0.52 [+0.05, +0.96] | +1.91 [+0.72, +3.03] |

- **Quals:** red won slightly more than stated only in 2025–26 (DECODE), and only just beyond noise. The tuning season shows nothing (−0.20).
  - This could be a DECODE field asymmetry. It does not survive the rule, and the engine has no colour term by design (Part 9 rejected an intercept for this reason).
  - It is worth watching in the 2025–26 live ledger, but there is nothing to build.
- **Playoffs:** in a playoff match the higher-seeded alliance takes the red side. So red's playoff surplus is the known "favourites win playoffs more often than stated" effect (Part 7's lab note), not colour.

## Verdict

- Neither tag graduates. No slice-report line is added for graduation.
- The turnaround score dip and the 2025–26 qual colour surplus are recorded here, so the decision can be audited.
