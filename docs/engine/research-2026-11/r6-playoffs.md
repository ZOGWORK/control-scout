# R6: playoff-specific modeling (measured; no separate playoff model ships)

**Verdict: a separate playoff model does not beat the live engine (3.3.0) on playoff matches.** No challenger passes the gate on both seasons. The engine stays 3.3.0 and the playoff handling stays as it is.
- Script: `scripts/research/r6-playoffs.ts`, with helpers in `scripts/research/r67-lib.ts` and actual scores from `scripts/research/r67-scores.ts`.
- Output: `r6-playoffs-2026-10-14.json`.
- Data: a copy of `data/snapshot.db.br` (data version 2026-10-14T04:19:58Z), replayed by `scripts/engine-slices.ts --rows --features`.

This builds on Part 7 (October). Part 7 found that playoffs were predicted *better* than quals, that no defence rating exists, and it closed with no build. The engine already treats playoffs differently in four ways:
- Rating updates from playoff matches are down-weighted (`playoffWeight`).
- The overlap term (2.11) is fitted on quals only.
- The contextual model carries a playoff slope input (D8 = raw logit × playoff).
- Playoff score ranges have their own band factor (3.2).

The bracket predictor (`src/shared/bracketOdds.ts`) builds series odds from these match odds. R6 asks whether a model fitted on playoff matches alone does better.

## How elimination play changes the prediction problem

- **Partners are fixed and picked, not drawn at random.** Per-team skill is pulled out of alliance scores on the assumption that quals partners are random. In playoffs the same two (or three) robots play every match, and captains pick partners on purpose.
  - Partners are picked using information the ratings may not have: scouting, pit talk, robot repairs, and how roles fit together. A selected alliance can be better than the sum of its ratings. It can also be worse, when a captain picks a friend or a defensive robot.
- **Selection effects.** Playoff alliances are the strongest robots at the event, so the field is narrower in the middle and the matches are sorted.
  - The higher seed plays red. Red won 68–72% of playoff matches against 50% of quals, so a lot of the outcome is known from the seed before any rating is used.
  - This lowers the "uncertainty" part of the Brier score (UNC = 0.20–0.22 against 0.25 in quals). A lower playoff Brier is partly a property of the matches, not of the model. See R7 for the decomposition.
- **Complementarity.** A fixed alliance can split tasks (one robot scores, one plays the endgame), so its score need not equal the sum of the robots' quals averages.
  - The engine's partner-spread input (D4) and the quals-only overlap term are the nearest existing measures. The refit challenger below re-weights all of them on playoff rows.
- **Series.** FTC's double-elimination bracket plays single matches; finals are best of three.
  - Series odds come from match odds (the bracket predictor), so a better match probability is the only lever. A separate series model would add nothing that match odds don't already carry.
  - A lost match also changes behaviour. Teams repair robots and change strategy between matches, which the down-weighted rating updates already allow for.
- **Small samples.** Playoffs are 13–14% of matches: about 4,300–5,100 decisive playoff matches per season at rated events. That bounds what can be learned from them; see the power note below.

## Part 1: the live engine, quals vs playoffs

These are decisive matches (ties left out) at rated events, pre-match predictions from the slice replay, for the whole season. Intervals come from resampling whole events.
- **Margin MAE** is |expected (red − blue) − actual|, in points.
- **In-sample caveat:** the final recalibration (slope 1.057692) was fitted on 2024-07-26 to 2026-07-26, so these 2024–25 and 2025–26 numbers are in-sample for that one step. The walk-forward numbers in Part 2 are not.

| Season | Part | n | Brier [95%] | Accuracy [95%] | Margin MAE [95%] | Log loss | Fav. stated | Red stated → won |
|---|---|---|---|---|---|---|---|---|
| 2023–24 | qual | 24,910 | 0.1774 [0.1745, 0.1804] | 72.50% [71.86, 73.13] | 34.1 [33.2, 35.0] | 0.5268 | 72.2% | 50.0% → 50.4% |
| 2023–24 | playoff | 2,951 | 0.1563 [0.1484, 0.1639] | 76.72% [75.19, 78.28] | 38.3 [37.0, 39.7] | 0.4730 | 76.7% | 70.4% → 71.7% |
| 2024–25 | qual | 28,664 | 0.1589 [0.1563, 0.1616] | 76.27% [75.74, 76.82] | 38.3 [37.1, 39.5] | 0.4800 | 76.3% | 49.9% → 49.7% |
| 2024–25 | playoff | 4,353 | 0.1508 [0.1448, 0.1572] | 78.31% [77.08, 79.50] | 42.5 [40.9, 44.1] | 0.4590 | 77.4% | 67.4% → 67.8% |
| 2025–26 (reused) | qual | 31,489 | 0.1699 [0.1674, 0.1724] | 74.50% [73.96, 75.06] | 37.4 [36.5, 38.4] | 0.5091 | 73.6% | 49.9% → 50.4% |
| 2025–26 (reused) | playoff | 5,083 | 0.1573 [0.1523, 0.1627] | 76.63% [75.43, 77.80] | 37.9 [36.4, 39.3] | 0.4792 | 75.9% | 65.8% → 67.8% |

Calibration by the favourite's stated chance, 2025–26 (stated → won):

| Band | Quals (n) | Quals | Playoffs (n) | Playoffs |
|---|---|---|---|---|
| 50–60% | 7,122 | 54.9 → 55.6 | 903 | 54.9 → 55.5 |
| 60–70% | 6,809 | 64.9 → 65.9 | 1,003 | 65.0 → 64.5 |
| 70–80% | 6,142 | 75.0 → 76.9 | 1,039 | 75.0 → 75.6 |
| 80–90% | 5,928 | 85.0 → 85.8 | 986 | 85.0 → 88.6 |
| 90–100% | 5,488 | 94.8 → 94.8 | 1,152 | 95.1 → 94.4 |

What this shows:
- **Part 7's finding holds on the raw numbers.** Playoffs have lower Brier and higher accuracy in every season. The intervals do not overlap in 2023–24 or 2025–26, and only just overlap in 2024–25.
- **Most of that gap is the seed, not the model.** Against a no-skill forecast that knows only the red win rate (UNC), the skill score 1 − BS/UNC is lower in playoffs in every season:

  | Season | Quals | Playoffs |
  |---|---|---|
  | 2023–24 | 0.29 | 0.23 |
  | 2024–25 | 0.36 | 0.31 |
  | 2025–26 | 0.32 | 0.28 |

  The engine adds less beyond the seed in playoffs than it adds beyond a coin flip in quals. Resolution is lower too (R7). Selected alliances are harder to separate than random pairs, which fits the selection effect described above.
- **Margin error is larger in playoffs** in 2023–24 and 2024–25 (scores are higher). In 2025–26 it is about level (37.9 against 37.4).
- **Calibration is close in both.** The one visible playoff gap is the 80–90% band in 2025–26 (85.0 stated, 88.6 won, n 986): the engine is a little timid there.
  - Red, the higher seed, is under-stated by 2.0 points in 2025–26 playoffs (65.8 → 67.8) and by 1.3 points in 2023–24, but by only 0.4 points in 2024–25.
- **Finals (series 0) look harder** (2025–26 Brier 0.181, accuracy 72.3%), but only n = 148 in 2025–26 and 122 in 2024–25. The 2023–24 data numbers more of its bracket as series 0 (n = 1,032). This is too few matches to act on.

## Part 2: separate playoff models, walk-forward

**Protocol.** These are the rolling origins of Part 9 and 12.5.
- Each month from October 2024 to July 2026 gets a model fitted on the **playoff rows only** from the 365 days before it, then scored on that month's playoff rows only. Origins with fewer than 500 playoff training rows keep the champion; none were needed.
- Rows are decisive and from rated events; the fitting data is pre-match only.
- 2024–25 is the tuning season. 2025–26 (DECODE) is judged and labelled **reused**, because it has already been looked at.
- The champion is the live engine 3.3.0's served chance.

The challengers (z is the logit of the live chance):

| Challenger | Form | What it tests |
|---|---|---|
| slope | σ(a·z), mirrored | A playoff-only recalibration: is the stretch wrong for playoffs? |
| seed | σ(z + b) | A red-alliance (higher-seed) term: does the seed carry information the ratings miss (the picking advantage)? |
| slope+seed | σ(a·z + b) | Both together. |
| refit | Every contextual input (22) refitted on playoff rows with the raw logit as offset, then σ(a·z + b) | Playoff-specific weights for overlap, partner spread (complementarity), experience, reliability and the rest. Ridge 1e-3 (the shipped learner) and 1e-2. |
| margin | Expected margin c·(μR − μB) + d, least squares; win chance unchanged | Playoff margin scale plus a red term. |
| playoff | slope+seed plus margin | The full "separate playoff model". |

Each challenger minus the champion, on playoff matches only. Brier is in units of 10⁻⁴, so negative is better. Accuracy is in points (positive is better) and margin MAE in points (negative is better). The 95% intervals come from resampling whole events.

**2024–25 (rolled, tuning)**: 4,353 playoff matches. Champion: Brier 0.1508, accuracy 78.31%, margin MAE 42.51.

| Challenger | Δ Brier [95%] | Δ accuracy [95%] | Δ margin MAE [95%] |
|---|---|---|---|
| slope | +0.47 [−0.71, +1.61] | 0.00 | 0 |
| seed | +0.50 [−3.02, +3.81] | −0.41 [−0.75, −0.07] | 0 |
| slope+seed | +1.47 [−2.22, +5.26] | −0.28 [−0.62, +0.07] | 0 |
| refit | +6.60 [−5.27, +18.25] | −0.48 [−1.00, +0.07] | 0 |
| refit (ridge 1e-2) | +2.58 [−8.12, +12.69] | −0.48 [−0.97, +0.05] | 0 |
| margin | 0 | 0 | −0.121 [−0.236, −0.013] |
| playoff | +1.47 [−2.22, +5.26] | −0.28 [−0.62, +0.07] | −0.121 [−0.236, −0.013] |

**2025–26 DECODE (rolled, reused)**: 5,083 playoff matches. Champion: Brier 0.1573, accuracy 76.63%, margin MAE 37.85.

| Challenger | Δ Brier [95%] | Δ accuracy [95%] | Δ margin MAE [95%] |
|---|---|---|---|
| slope | −0.20 [−0.71, +0.33] | 0.00 | 0 |
| seed | −3.39 [−5.96, −0.77] | −0.08 [−0.43, +0.25] | 0 |
| slope+seed | −3.34 [−5.96, −0.64] | −0.06 [−0.42, +0.30] | 0 |
| refit | −3.12 [−12.04, +5.75] | +0.12 [−0.38, +0.60] | 0 |
| refit (ridge 1e-2) | −5.37 [−14.11, +2.96] | +0.04 [−0.45, +0.52] | 0 |
| margin | 0 | 0 | −0.131 [−0.298, +0.041] |
| playoff | −3.34 [−5.96, −0.64] | −0.06 [−0.42, +0.30] | −0.131 [−0.298, +0.041] |

**Gate:** a challenger must cut Brier with an interval entirely below zero, and must not lose accuracy or margin MAE, on both seasons. **No challenger passes.**
- **slope:** about zero in both seasons. The month-by-month playoff slope stays between 0.996 and 1.040, so the shipped stretch already suits playoffs. This matches Part 7: there is no playoff calibration gap to close.
- **seed / slope+seed:** the only real signal, and it is not stable.
  - In DECODE, red (the higher seed) wins more than the engine says. The fitted red term climbs to about +0.12 logits by spring 2026, and Brier improves by 3.4×10⁻⁴ with an interval below zero. Accuracy dips slightly (−0.06 to −0.08).
  - In 2024–25 the same term is fitted from 2023–24, where it was +0.03 to +0.11. It does not help (+0.5 to +1.5×10⁻⁴) and costs 0.3–0.4 accuracy points (the seed-only interval excludes zero).
  - A term that helps in one season and hurts in the other is the season's own pattern, not a stable playoff effect.
- **refit:** the intervals are wide (±9 to ±12×10⁻⁴). It is worse on the tuning season and better in DECODE as a point estimate. 22 weights fitted on 3,000–5,100 playoff rows are too noisy to beat weights fitted on all matches.
- **margin:** playoff expected margins are a little too large (c = 0.85–0.95) and lean slightly red (d = +1 to +4 points).
  - Shrinking them cuts margin MAE by 0.12–0.13 points: inside noise in 2025–26, beyond it in 2024–25.
  - Win chances do not move, so Brier is unchanged, and Brier is the decision metric. It does not ship. The size (0.3% of a 38-point MAE) is not worth a release either.

## Power

The playoff sample limits what this test can detect. With about 4,400–5,100 playoff matches per season, the 95% intervals are:
- about ±0.6×10⁻⁴ for a one-parameter slope;
- about ±2.6–3.5×10⁻⁴ for a red/seed term;
- about ±9–12×10⁻⁴ for the 22-input refit.

The refit could only have shown a win of about 10×10⁻⁴ (0.6% of the Brier) or more. **For the refit, and for any playoff term with more than a few parameters, this test is underpowered.** A real effect of a few 10⁻⁴ would not be detected. For the one- and two-parameter forms the test has enough power, and the answer is no stable gain.

## Kept for the 2026–27 rollover

- **The DECODE seed under-statement.** Red won 2 points more often than stated in 2025–26 playoffs. If 2026–27 shows the same red term (rolling fit above about +0.08 logits for a full season), retest `slope+seed` then.
  - The candidate form is σ(a·z + b) on playoff rows only, b fitted on the prior 365 days. It would ship as a playoff-only intercept in the shared engine, so both apps get it.
- **Finals (best of 3):** too few matches per season for a separate test. Pool seasons if it is ever revisited.
- **Labels.** The quals/playoffs labelling gap (item 7) is presentation and is handled separately. Nothing here changes what the engine computes.
