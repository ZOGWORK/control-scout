# Faster learning at a team's next meet (measured, rejected)

**Verdict: rebuild handling stays off.** The engine stays 3.2.0. No setting changed.
- Gate reports: `docs/engine/gates/gate-rebuild-{g2n3,g2n5,g3n3}-snapshot-2026-10-14.{md,json}`.
- Corpus: the pinned 2019–26 snapshot (`snapshot-2026-10-14` plus the FIRST sync), replayed for 2023–24, 2024–25 (tuning) and 2025–26 (reused).

## The claim

A team that is poor at its first meet and much better at its second (a rebuilt or fixed robot) should be picked up quickly. The rating gain is `max(kMin, k0 ÷ (1 + n/n0))`, which reaches its floor (0.33) after about 10 matches. The idea was to raise the gain again when a team starts a new meet, so the first few matches there move its rating faster.

## What already existed

The engine has had this mode since 2.1 (`rebuildGapWeeks`, `rebuildN`, `rebuildUncPerWeek` in `RatingParams`), switched off. After a break of at least `rebuildGapWeeks`, the team's gain is computed as if it had played at most `rebuildN` matches, then falls back to the floor as it plays.
- 2.1 round 2 tested it with extra uncertainty (gap ≥ 4 weeks, +200 points² per week): Brier −0.00015 [−0.00044, +0.00012], rejected.
- A later refit improved score error after long breaks but made advancement odds slightly worse, so it stayed off (Lab notes, "Robot rebuild detection").

Since then the engine gained event-local form (2.9), which already shifts a team's predictions at its current event by its misses there. So this re-test asks whether the gain bump still adds anything on 3.2, as a gain bump alone (no extra uncertainty, the part that made 2.1's version worse).

## Method

`scripts/engine-slices.ts --challenger` against the live 3.2.0 engine, same matches in the same order, 95% intervals from resampling whole events. Three variants, `rebuildUncPerWeek` 0 in all:

| Variant | Break that counts | Gain as if played |
|---|---|---|
| g2n3 | 2+ weeks | 3 matches (gain 0.50) |
| g2n5 | 2+ weeks | 5 matches (gain 0.43) |
| g3n3 | 3+ weeks | 3 matches (gain 0.50) |

The slice that matters is "robot's event of the season: 2nd" (and 3rd+), where the least experienced robot on the field is at its second event.

## Measured

Challenger minus 3.2.0, Brier ×10⁻⁴ (negative is better).

| Variant | Season | All matches | 2nd event | 3rd+ event | Playoffs |
|---|---|---|---|---|---|
| g2n3 | 2023–24 | +1.65 [−0.20, +3.59] | +2.04 [−1.87, +5.81] | +4.32 [−0.66, +9.45] | +2.54 |
| | 2024–25 (tuning) | +0.03 [−2.05, +2.11] | +0.08 [−4.34, +4.49] | −0.44 [−5.15, +4.47] | +0.02 |
| | 2025–26 (reused) | +1.28 [−0.55, +3.11] | +2.97 [−0.81, +6.57] | +1.13 [−3.28, +5.59] | **+5.00 [+1.29, +8.95]** |
| g2n5 | 2023–24 | +0.21 [−0.79, +1.23] | +0.13 [−1.86, +1.93] | +0.80 [−1.95, +3.75] | +0.40 |
| | 2024–25 (tuning) | −1.22 [−2.35, +0.00] | −1.26 [−3.51, +1.00] | −2.31 [−5.03, +0.53] | −1.02 |
| | 2025–26 (reused) | −0.27 [−1.31, +0.78] | +0.46 [−1.57, +2.32] | −1.05 [−3.54, +1.47] | **+2.53 [+0.55, +4.70]** |
| g3n3 | 2023–24 | +1.10 [−0.60, +2.78] | +3.30 [−0.26, +6.71] | +1.50 [−2.61, +6.24] | +1.08 |
| | 2024–25 (tuning) | −0.61 [−2.50, +1.29] | −0.59 [−4.54, +3.31] | −1.19 [−5.46, +3.20] | −2.00 |
| | 2025–26 (reused) | +0.42 [−1.28, +2.04] | +2.53 [−0.76, +5.67] | −0.33 [−4.02, +3.62] | **+3.64 [+0.43, +7.07]** |

Winner accuracy on the 2nd-event slice, 2025–26: −0.28 [−0.54, −0.01] (g2n3), −0.22 [−0.40, −0.05] (g2n5), −0.24 [−0.49, +0.00] (g3n3) points.

## Why rejected

- **It doesn't help the slice it targets.** On a robot's 2nd event, no variant is better beyond noise in any season, and the point estimates are mostly worse.
- **It hurts playoffs.** All three regress 2025–26 playoffs beyond noise. Playoff alliances are mostly teams deep into their event, and a bigger gain at the start of the event makes their ratings noisier.
- **The only gain is on the tuning season.** g2n5's −1.22 on 2024–25 is borderline and does not replicate in either other season.
- **The engine keeps learning within a meet, but not fast.** The 0.33 floor applies to the alliance's error, split between its two robots. For one improved robot playing with accurately rated partners, that closes 16.5% of its rating gap per match and leaves about 34% after six qualification matches (0.835⁶). Event-local form (2.9) separately shifts predictions at the current event by the team's misses there. Even so, a bigger gain didn't measurably help: what it gains on the improved robots, it loses by making every other robot's rating noisier.

## What would be worth trying instead

The cost of a rebuilt robot is concentrated in its first one or two matches back, before any result exists, so no gain setting can fix those. Pre-event information (a scouting note, a reported practice score, or the team's own OPR from a later scrimmage) is the only thing that could. That is a data question, not a rating-setting one.
