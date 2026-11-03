# R2: shrinkage for low-sample teams (measured; no change)

**Verdict: no build.** The engine already partially pools a low-sample robot toward a population prior in six places, listed below.

The candidate tested here is the one form of pooling it lacks: an **empirical-Bayes prior strength per prior class**, so that a robot with no history trusts its prior less than a returning robot does. It does not pass the gate.
- The best setting, ρ 1.5, chosen by rolling origins, improves 2024–25 by −0.61 [−1.19, −0.05] ×10⁻⁴.
- On 2025–26 it is −0.24 [−1.11, +0.64], inside noise.
- The value the engine's own uncertainty settings imply (ρ 2.33) is worse than live in both seasons.
- The data's method-of-moments check explains why: once a season's data is in, no-history robots spread around their priors almost exactly as much as returning robots do (variance ratio 1.05–1.06).

Script, outputs and harness:
- Script: `scripts/research/r2-shrinkage.ts` (shared harness: `scripts/research/lib.ts`).
- Output: `r2-shrinkage-2026-11-03.json`.
- The protocol is identical to R4's (`r4-recency.md`, "Method").

## Research note: partial pooling in sports forecasting

- **Efron & Morris (1975, *JASA*), Stein's estimator on batting averages.** Each player's early-season average is pulled toward the league mean by a factor estimated from the data's own spread. It beats every player's raw average on the rest of the season. The weight on a player's own data is n / (n + k), with k = σ² / τ²: noise variance over the variance of true talent. This is the sabermetric "add k league-average plate appearances".
- **Hierarchical models: Glickman & Stern (1998, *JASA*), NFL state-space; Baio & Blangiardo (2010, *J. Applied Statistics*), football.** Team strengths are random effects drawn from a population distribution whose spread is fitted. Low-information teams are pulled toward the population automatically, and between seasons the strengths regress toward the mean.
- **Uncertainty-driven gain: Glicko (Glickman 1999); TrueSkill.** Each team carries a variance. The update gain is prior variance over (prior variance + noise): the Kalman gain. A team whose prior is less certain should therefore learn faster from its first results.

The common rule: **how much a prior counts should follow how uncertain it is, and that uncertainty should be estimated from the population** (empirical Bayes), not set by hand.

## What the engine already does (and where)

| Pooling | Where | In shrinkage terms |
|---|---|---|
| Season prior: ρ1·z1 + ρ2·z2, ρ1 0.7 | `priorZ` (2.7) | Last season's standing regressed 30% toward the population mean. This is the Efron–Morris move between seasons. |
| No-history prior `rookieZ` −0.7 sd, with the wider `uncRookie` 350 | `priorZ`, `basePrior` | Robots with no history are pooled toward a fitted rookie-population mean, not the global one. |
| Regional offsets: lift / (n + κ), κ 20 | `regionOffset` (2.7) | A textbook EB mean: a region's lift shrunk toward 0 with κ pseudo-teams, κ fitted (Part 8). |
| Update gain `max(kMin, k0 / (1 + n/n0))` | `fold` | Sequential partial pooling of a robot's own results against its prior. For a robot's ½ share of the alliance miss, the gain is 1 / (A + B·n), with A = 1 / (k0·½) = 3.08 and B = A/n0. That is a normal-mean update in which the prior is worth A − 1 = **2.08 units of noise / prior variance**, and the floor is process noise (see R4). |
| Event-local form: λ · mean miss · κ/(n + κ) | `eventOffset` (2.9) | The event deviation shrunk toward 0 with κ = 1. |
| Per-robot prediction variance (`uncKnown`/`uncRookie`, ×0.45 per match) and the contextual model's experience inputs (log(1 + n), fewest matches, unknown robots, uncertainty share) | `basePrior`, `contextual.ts` | Shrinks the **win probability** toward 50% when the field has played little. The contextual model already learns, from data, how much to discount low-sample ratings. This covers "shrink the contextual model's inputs by sample size". |
| Reliability EMAs start at bias 0, variance 1, failure 0.05 | `initialReliability` | Each form signal is pooled toward a population default, with weight (1 − α)ⁿ. |

Earlier work already covers the levels:
- Part 8 and 12.4 swept `rookieZ` (flat from −0.8 to −0.5), `regionKappa` (flat), `rho1` (flat) and `n0` (flat from 8 to 16).
- 12.3 (`part12/growth.md`) found that rookies start about 1.5 points per robot under-predicted and the engine catches up slowly.

**What is not covered:** the gain's prior strength (A − 1) is the same number for every robot, whatever its prior came from. The engine states that a no-history prior is 2.33× as uncertain (`uncRookie / uncKnown` = 350/150), but it uses that only for the probability's width, never for how fast the rating learns. That is the gap tested here.

## The candidate

With the variance of true strength around a no-history prior equal to ρ times that around a returning robot's prior (τ²_R = ρ·τ²_K), the Kalman / empirical-Bayes prior strength becomes:

  σ²/τ²_R = (A − 1)/ρ,  A_R = 1 + (A − 1)/ρ,  gain_R(n)·½ = 1 / (A_R + B·n),

and the tail and floor stay unchanged. In the engine's own terms, **a robot with no history computes its gain as if it had played Δ fewer matches**:

  gainN = n − Δ(ρ),  Δ(ρ) = n0 · (1 − A_R / A).

There is one parameter:
- ρ = 1 is live;
- ρ = 2.33 is the engine's own stated ratio, with nothing fitted;
- a grid of ρ from 0.5 to 8 maps the curve;
- the rolling origins pick ρ each month from the 365 days before it.

"No history" means `priorZ(t).known === false`. In the cold-start 2023–24, that is every robot.

**Method-of-moments check** (champion replay, robots with 20+ rated matches):
- d = (final rating − the prior it was stored with) / population sd, by class.
- The no-history spread includes the same end-of-season estimation noise as the returning spread. So Var_R / Var_K is a lower bound on ρ only if the two noise terms are equal and the true ratio is above 1. It is a rough check, not a fit.

| Season | Robots (returning / no history) | Var(d) returning | Var(d) no history | Ratio | Mean d returning | Mean d no history |
|---|---|---|---|---|---|---|
| 2024–25 | 2,478 / 563 | 0.619 | 0.649 | **1.05** | +0.74 | +1.00 |
| 2025–26 | 2,919 / 552 | 0.656 | 0.693 | **1.06** | +0.56 | +0.88 |

## Results

Δ = variant − live 3.3.0, Brier ×10⁻⁴ [95%]. Matches are decisive only: 33,017 (2024–25) and 36,572 (2025–26).

| ρ (head start Δ) | 2024–25 all | quals 1–10 | 0–5 matches | Δ acc pp | Δ MAE | 2025–26 all | quals 1–10 | 0–5 matches | Δ acc pp | Δ MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 (−6.75) | +7.49 [+5.33, +9.73] | +7.92 | +13.37 | −0.08 | +0.174 | +4.66 [+2.92, +6.43] | +7.29 | +8.83 | −0.14 | +0.064 |
| 0.7 (−2.89) | +3.07 [+1.92, +4.19] | +3.51 | +5.34 | +0.01 | +0.070 | +1.76 [+0.88, +2.65] | +3.04 | +3.51 | −0.07 | +0.020 |
| **1 (live)** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **1.5 (+2.25)** | **−0.60 [−1.68, +0.51]** | −1.08 [−3.18, +1.01] | −1.09 [−3.33, +1.32] | +0.08 | −0.009 | **−0.24 [−1.11, +0.64]** | −1.49 [−2.97, +0.06] | −1.10 [−3.05, +0.76] | −0.02 | +0.016 |
| 2.33, engine's own ratio (+3.86) | +1.28 [−0.67, +3.36] | +0.77 | +2.72 | −0.01 | +0.036 | +0.98 [−0.69, +2.66] | −0.74 | +0.60 | −0.04 | +0.063 [+0.032, +0.094] |
| 3.5 (+4.82) | +3.96 [+1.39, +6.72] | +3.96 | +8.40 | −0.05 | +0.098 | +2.65 [+0.44, +4.93] | +0.94 | +3.55 | −0.09 | +0.117 |
| 5 (+5.40) | +6.42 [+3.37, +9.72] | +6.98 | +13.59 | −0.06 | +0.154 | +4.19 [+1.53, +6.94] | +2.80 | +6.55 | −0.13 | +0.164 |
| 8 (+5.91) | +9.26 [+5.74, +13.04] | +10.54 | +19.46 | −0.08 | +0.221 | +6.08 [+2.97, +9.26] | +5.20 | +10.35 | −0.24 | +0.218 |

The curve has a shallow minimum at ρ ≈ 1.5 and rises steeply on both sides. Its effect is concentrated where intended: quals 1–10 and robots with 0–5 matches move about twice as much as the whole season.

**Rolling origins** (ρ re-chosen monthly; live until January 2025, then ρ 1.5 every month to July 2026):

| Season | Slice | Δ Brier ×10⁻⁴ [95%] | Δ acc pp [95%] | Δ margin MAE [95%] |
|---|---|---|---|---|
| 2024–25 | all | **−0.61 [−1.19, −0.05]** | +0.00 [−0.06, +0.05] | −0.003 [−0.018, +0.010] |
| | quals 1–10 | −0.56 [−1.72, +0.73] | −0.04 [−0.14, +0.06] | +0.006 [−0.015, +0.029] |
| | 0–5 rated matches | **−1.38 [−2.71, −0.13]** | +0.01 [−0.08, +0.10] | −0.010 [−0.037, +0.017] |
| | playoffs | −1.48 [−2.87, −0.19] | −0.07 [−0.21, +0.07] | −0.006 [−0.052, +0.032] |
| 2025–26 (reused) | all | −0.24 [−1.11, +0.64] | −0.02 [−0.10, +0.07] | +0.016 [−0.001, +0.032] |
| | quals 1–10 | −1.49 [−2.97, +0.06] | +0.03 [−0.13, +0.18] | +0.028 [+0.002, +0.054] |
| | 0–5 rated matches | −1.10 [−3.05, +0.76] | +0.00 [−0.17, +0.16] | +0.012 [−0.022, +0.045] |
| | quals 26+ | +2.69 [+0.80, +4.73] | −0.09 [−0.28, +0.10] | +0.032 [−0.001, +0.067] |

**Gate: fail.**
- 2024–25 passes: Brier better beyond noise, accuracy and margin MAE neutral.
- 2025–26 does not:
  - its Brier interval includes zero;
  - quals 26+ regresses beyond noise (+2.69);
  - quals 1–10 margin MAE is worse beyond noise (+0.028 points).

The fixed picks also fail:
- ρ 1.5, the best on 2024–25: −0.60 [−1.68, +0.51] and −0.24 [−1.11, +0.64].
- ρ 2.33, a priori: +1.28 [−0.67, +3.36] and +0.98 [−0.69, +2.66]. It is also worse on 2025–26 margin MAE beyond noise: +0.063 [+0.032, +0.094].

## Why it doesn't win

1. **The two classes' priors are about equally uncertain.**
   - EB fits the prior strength from the population's spread around the prior. That spread is the same for no-history and returning robots to within 5–6%.
   - So the live engine's single prior strength (ρ = 1) is close to the EB answer. ρ 1.5 sits on the flat bottom of the curve.
   - The engine's `uncRookie / uncKnown` = 2.33 describes early-season prediction variance, which also absorbs the prior's level error (point 2). It is not a variance of true strength around the prior, so it is the wrong number for the gain.
2. **What separates the classes is the prior's level, not its spread.**
   - No-history robots end the season 0.26–0.32 population sd further above their prior than returning robots (mean d +1.00 against +0.74, and +0.88 against +0.56). This matches 12.3's finding that rookies start under-predicted.
   - Shrinkage cannot fix a biased centre. Learning faster only moves toward it sooner, which is why the effect shows on the 0–5-match slice and then reverses later in events (quals 26+).
   - The level is `rookieZ`. Part 12.4 found the 2024–25 Brier flat from −0.8 to −0.5, and Part 8 found no gain from moving it. It has been measured twice and is not reopened here.
3. **The contextual model already discounts low-sample ratings** through its experience and uncertainty inputs. Much of what a faster early gain could buy is already priced into the probability.

## For the record (no engine change proposed)

If a later corpus does pass the gate, the change is small: in `RatingBook.fold`, use `gainN = n − 2.25` for robots with `priorZ(t).known === false` (ρ 1.5). It would be a new `RatingParams` field, for example `rookieGainHeadStart: 2.25`, defaulting to 0. On this corpus it fails, so nothing changes.

## Caveats

- 2025–26 is reused data. 2023–24 is a cold start in this snapshot, so every robot is "no history" there, and the first rolled windows (October 2024 to January 2025) are mostly that season. That is why live is picked first.
- The moments check uses end-of-season ratings. Those carry estimation noise and season growth, which are the same for both classes to first order but not exactly.
- Rolling selection switches between fixed-setting replays. With one switch in 22 months, that hardly matters here.
