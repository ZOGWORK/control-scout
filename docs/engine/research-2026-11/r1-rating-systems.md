# R1: rating systems beyond Elo (Massey, TrueSkill, Glicko-2)

**Verdict: nothing ships.** No challenger and no hybrid passes the item-12 gate against the live engine (3.3.0). The engine is unchanged.
- **On their own, all three lose by a wide margin on both seasons.** Brier is worse by +0.018 to +0.038, accuracy by 3 to 7 points, and margin MAE by 4 to 9 points.
- **As an extra input to the contextual model (hybrids), each helps a little.** Each one cuts Brier on 2025–26 (reused) with an interval that excludes zero. None does so on 2024–25 (tuning), where every interval includes zero.
- **The low-sample slice (robots with 0–5 matches) gains nothing on the tuning season.** Extra uncertainty is the claimed advantage of TrueSkill and Glicko-2, and it doesn't show up on the slice where it should matter most.

Files:
- Scripts: `scripts/research/r1-raters.ts` (the three raters, with unit tests in `r1-raters.test.ts`) and `scripts/research/r1-rating-systems.ts` (the replay and walk-forward scoring).
- Output: `r1-rating-systems-2026-11-03.json`.
- Corpus: the pinned snapshot (data version 2026-10-14), run on a copy.

## Protocol

The protocol is the same for every challenger and for the champion.
- **Same matches.** Each challenger replays the backtest corpus (`scripts/slices/corpus.ts`) with the engine's own loader, exclusions and match order. It predicts every match from earlier matches only, and updates only on rated events.
  - Champion rows come from `engine-slices --seasons 2023,2024,2025 --rows`. The served probability and the served expected margin (red − blue) are used as they are.
  - Every model is scored on the identical match keys.
- **Rolling origins, as in Part 9 and 12.5.** Each month from Oct 2024 to Jun 2026 is predicted with mappings fitted only on the 365 days before it. That gives 18 months with enough data; Aug–Sep 2025 are empty.
  - The fitted mappings are a challenger's Platt slope, its margin slope where it has no native margin, and the hybrid weights.
- **Which matches are scored:** rated events, pre-match predictions, decisive matches only (ties left out). That is 32,974 matches in 2024–25 and 36,345 in 2025–26.
- **Seasons.** 2024–25 is the tuning season: each method's small hyperparameter grid was chosen on its 2024–25 Brier and on nothing else. 2025–26 (DECODE) is **reused**: it was examined in earlier parts of the program, so it is reported, not proof.
- **Intervals:** deltas are model minus champion, with 95% intervals from resampling whole events (2,000 draws). Negative Brier, log loss and MAE mean the model is better.

**Context (same matches).** The reference baseline in the prompt (72.7% / 0.179) is the pre-2.0 legacy model, not the champion. The harness reproduces it: legacy on all 36,842 rated 2025–26 matches scores 72.66% / 0.1791.

| Decisive matches | Live engine 3.3.0 (champion): Brier / acc / margin MAE | Legacy (pre-2.0): Brier / acc / margin MAE |
|---|---|---|
| 2024–25 (tuning), 32,974 | 0.1579 / 76.53% / 38.84 | 0.1629 / 75.84% / 39.38 |
| 2025–26 (reused), 36,345 | 0.1683 / 74.78% / 37.35 | 0.1803 / 72.63% / 39.35 |

The judgement is against the live engine. The WPI paper's 84.08% is not a target here: it comes from a random split, a different competition and different seasons.

## The methods

All three use only what the FIRST API publishes: alliance totals and the per-phase breakdown (auto, TeleOp, endgame, penalty points committed). There is no per-robot data.

**The shared assumption.** Every method models a 2-robot alliance's strength as the **sum** of its robots' ratings, the same assumption the engine's EPA ratings make. That is how alliance-level results identify team-level ratings. It relies on qualification partners being randomised. Playoff alliances are fixed, so in playoffs the partner effects are confounded.

**Season carry-over.** Every method carries ratings into the new season with a factor ρ and resets or inflates its uncertainty. The engine's carry-over uses a factor of 0.7.

**What was skipped.** The few rated matches that list a different number of robots (under 1%) are skipped by the challengers. The champion uses them.

### Massey (least squares on margins)

**How it works.**
- Find the ratings r that minimise Σ (margin − (r₁ + r₂ − r₃ − r₄))² + λ Σ (r − prior)².
- That is ridge least squares on every rated match before the prediction.
  - The prior is the robot's carried rating: last season's rating in SDs, × ρ, rescaled to this season's score level. A robot with no history starts at 0, the average.
  - The ridge term also pins the free constant, since margins only identify differences.

**How it is solved, causally.**
- The normal equations are kept per robot.
- At the first match of each UTC day they are solved by Jacobi-preconditioned conjugate gradients, warm-started from the last solution, to 0.01 points.
- After each match, the four robots get three Gauss–Seidel passes.

**Outputs.**
- **Margin:** native, in points (expected margin = r₁ + r₂ − r₃ − r₄).
- **Probability:** σ(a·z).
  - z is the expected margin divided by √(s²·(1 + Σ 1/(nᵢ + λ))).
  - s² is the season's running game-noise variance.
  - The Σ term is each robot's rating variance under the Bayesian reading of the ridge.

**Per-phase variant.** The same normal equations are solved for four margins: auto, TeleOp, endgame, and penalty points gained. These four add up exactly to the total margin, so their summed prediction is the total Massey's. The only new information is how much weight each phase gets, so the variant fits one logistic weight per phase.

**Data needed:** alliance totals and the phase breakdown. **Fit to 2-robot alliances:** natural, since the alliance is a row of the design matrix with two +1s and two −1s.

**Tuning:** λ ∈ {2, 4, 8}, ρ ∈ {0.4, 0.7}. Chosen: λ 4, ρ 0.7.

### TrueSkill (Bayesian skill, two teams of two)

**How it works.**
- Each robot has a Gaussian skill N(μ, σ²).
- An alliance's performance is the sum of its two robots' performances, each with noise β.
- After a match, a moment-matching update (win, loss or draw) moves μ and shrinks σ. Each robot's share of the update is proportional to its σ².
- Before every match, σ² grows by τ².

**The adaptation for 2-robot alliances** is TrueSkill's own team model, with teams of two.
- P(red wins) = Φ((μ_R − μ_B)/c), with c² = Σσ² + 4β². The probability is then mapped with σ(a·z) on z = (μ_R − μ_B)/c.
- The draw margin is set from a 1% tie rate.

**What it can't give: a margin.** TrueSkill learns from win/loss only, so it has no margin of its own. Its margin is *derived*: the skill difference × the season's running RMS margin, with a slope fitted on the rolling window. That counts against it.

**Data needed:** the winner only, which throws away the score.

**Tuning:** β/σ₀ ∈ {0.5, 1, 2}, τ/σ₀ ∈ {0.01, 0.03, 0.1}, ρ ∈ {0.4, 0.7}. Chosen: β 1, τ 0.1, ρ 0.7.

### Glicko-2 (rating, deviation, volatility)

**How it works.**
- Each robot has three numbers: a rating μ, a deviation φ (how unsure the rating is) and a volatility σ (how erratic the robot is).
- Each match is one rating period: φ inflates by σ, then the Glicko-2 update applies, with Glickman's Illinois iteration for the volatility.

**The adaptation for 2-robot alliances.** Glicko-2 is defined for one-on-one games, so each robot's opponent is a *composite*: the two opponents' sum minus the partner. Its rating is μ_opp1 + μ_opp2 − μ_partner, and its deviation² is the sum of the three deviations².
- This makes the expected score equal to the alliance-sum model's.
- All four robots are updated simultaneously from their pre-match values.

**Outputs.**
- **Probability:** z = g(φ_total)·(μ_R − μ_B), where φ_total² is the sum of all four φ², mapped with σ(a·z).
- **Margin:** derived, as for TrueSkill, since it learns from win/loss only.

**Data needed:** the winner only.

**Tuning:** φ₀ ∈ {0.5, 1, 2}, τ ∈ {0.2, 0.5}, ρ ∈ {0.4, 0.7}. Chosen: φ₀ 1, τ 0.2, ρ 0.7.

### Hybrids (labelled as hybrids)

The hybrid is the contextual model's output with the challenger as an extra input. It is fitted on the same rolling windows: p = σ(w₁·L + w₂·z + w₃·L·u).
- L is the champion's logit and z the challenger's strength difference.
- u is the challenger's uncertainty share: the part of the prediction's variance that comes from rating uncertainty, from 0 (all known) to 1.
- The margin is a least-squares blend of the champion's and the challenger's margins.

**The refit control.** Refitting anything on rolling windows also recalibrates, so each hybrid is also compared with the champion with only its own slopes refitted on the same windows (one for probability, one for margin). The hybrid's gain over that control is the part that comes from the challenger.

## Results

### On their own (challenger − champion)

Brier and log loss are ×10⁻⁴; accuracy is in points; MAE is in points of margin.

| Method | Season | Brier | Δ Brier [95%] | Δ log loss [95%] | Δ acc [95%] | Δ margin MAE [95%] |
|---|---|---|---|---|---|---|
| Massey | 2024–25 | 0.1815 | +236.3 [+220.4, +252.0] | +613.0 [+571.6, +653.4] | −4.07 [−4.53, −3.62] | +4.90 [+4.54, +5.26] |
| Massey | 2025–26 | 0.1940 | +256.9 [+241.9, +271.5] | +637.4 [+599.0, +673.0] | −4.85 [−5.29, −4.40] | +3.87 [+3.63, +4.12] |
| Massey per phase | 2024–25 | 0.1798 | +219.1 [+204.2, +234.8] | +576.7 [+536.4, +617.6] | −3.80 [−4.24, −3.36] | +4.90 (same margin) |
| Massey per phase | 2025–26 | 0.1862 | +179.7 [+167.3, +192.4] | +458.3 [+428.3, +490.5] | −2.99 [−3.41, −2.59] | +3.87 (same margin) |
| TrueSkill | 2024–25 | 0.1952 | +373.2 [+354.6, +391.7] | +939.6 [+892.0, +984.4] | −7.14 [−7.67, −6.61] | +8.72 [+8.24, +9.17] (derived) |
| TrueSkill | 2025–26 | 0.2023 | +340.5 [+323.8, +357.1] | +838.6 [+798.3, +879.5] | −6.29 [−6.80, −5.80] | +6.64 [+6.30, +7.02] (derived) |
| Glicko-2 | 2024–25 | 0.1960 | +381.1 [+362.6, +399.6] | +959.8 [+912.3, +1004.1] | −7.39 [−7.91, −6.85] | +8.97 [+8.49, +9.45] (derived) |
| Glicko-2 | 2025–26 | 0.2028 | +345.7 [+328.7, +362.6] | +850.7 [+810.0, +891.4] | −6.46 [−6.96, −5.99] | +6.80 [+6.44, +7.19] (derived) |

Low-sample slice (robots with 0–5 rated matches, the fewest on the field; 14,057 / 15,230 matches) and early-event slice (quals 1–10; 10,822 / 11,481), Δ Brier ×10⁻⁴:

| Method | 0–5 matches, 2024–25 | 0–5 matches, 2025–26 | Quals 1–10, 2024–25 | Quals 1–10, 2025–26 |
|---|---|---|---|---|
| Massey | +276.0 [+251.0, +299.6] | +270.6 [+246.6, +294.2] | +169.0 [+143.0, +193.8] | +206.1 [+181.7, +230.1] |
| Massey per phase | +254.1 [+229.5, +277.6] | +204.9 [+184.1, +224.2] | +154.9 [+129.0, +179.7] | +141.9 [+121.3, +162.8] |
| TrueSkill | +413.7 [+385.1, +440.7] | +345.7 [+319.5, +369.2] | +268.8 [+236.2, +299.0] | +274.1 [+246.9, +302.1] |
| Glicko-2 | +416.8 [+387.9, +444.6] | +346.7 [+320.7, +370.1] | +274.6 [+242.7, +304.3] | +274.1 [+246.9, +301.8] |

**The uncertainty advantage doesn't appear.** TrueSkill and Glicko-2 lose *more* on the 0–5-match slice than overall in 2024–25. A per-robot σ cannot recover what the engine already gets from regional priors, carry-over and per-phase scoring rates.

### Hybrids (hybrid − live engine)

| Hybrid | Season | Δ Brier [95%] | Δ log loss [95%] | Δ acc [95%] | Δ margin MAE [95%] | Δ Brier vs refit control [95%] |
|---|---|---|---|---|---|---|
| + Massey | 2024–25 | −0.5 [−1.8, +0.8] | −1.1 [−4.8, +2.6] | −0.00 [−0.12, +0.10] | −0.11 [−0.17, −0.06] | −0.5 [−1.8, +0.8] |
| + Massey | 2025–26 | **−2.5 [−3.8, −1.3]** | −6.0 [−9.2, −2.9] | −0.07 [−0.18, +0.04] | −0.10 [−0.15, −0.04] | −3.0 [−4.3, −1.8] |
| + TrueSkill | 2024–25 | −0.9 [−1.9, +0.1] | −2.6 [−5.3, +0.4] | −0.00 [−0.11, +0.10] | −0.11 [−0.16, −0.05] | −0.9 [−1.8, +0.1] |
| + TrueSkill | 2025–26 | **−1.4 [−2.5, −0.2]** | −3.6 [−6.7, −0.7] | −0.01 [−0.12, +0.11] | −0.08 [−0.13, −0.03] | −1.8 [−3.0, −0.7] |
| + Glicko-2 | 2024–25 | −0.9 [−1.8, +0.1] | −2.4 [−5.0, +0.4] | −0.04 [−0.15, +0.06] | −0.11 [−0.16, −0.05] | −0.9 [−1.8, +0.0] |
| + Glicko-2 | 2025–26 | **−1.3 [−2.5, −0.3]** | −3.5 [−6.4, −0.7] | +0.01 [−0.11, +0.13] | −0.08 [−0.13, −0.03] | −1.8 [−3.0, −0.7] |

Hybrid slices, Δ Brier ×10⁻⁴ vs the live engine:

| Hybrid | 0–5 matches, 2024–25 | 0–5 matches, 2025–26 | Quals 1–10, 2024–25 | Quals 1–10, 2025–26 | Playoffs Δ acc, 2024–25 |
|---|---|---|---|---|---|
| + Massey | −0.4 [−2.4, +1.6] | −3.0 [−4.7, −1.2] | −1.8 [−3.9, +0.4] | −3.6 [−5.5, −1.6] | −0.30 [−0.63, +0.05] |
| + TrueSkill | −0.3 [−1.8, +1.1] | −1.8 [−3.6, −0.0] | −2.0 [−3.7, −0.1] | −2.9 [−5.0, −0.8] | −0.25 [−0.55, +0.02] |
| + Glicko-2 | −0.5 [−1.8, +0.9] | −1.8 [−3.5, −0.1] | −1.9 [−3.6, −0.2] | −3.1 [−5.1, −1.0] | **−0.30 [−0.57, −0.05]** |

**The margin gain isn't the challengers'.** Every hybrid's margin MAE gain (about −0.1 points) is the champion's own margin slope:
- The refit control alone gets −0.12 [−0.17, −0.06] in 2024–25 and −0.07 [−0.12, −0.02] in 2025–26.
- Against that control, the hybrids' MAE changes are between −0.02 and +0.01.

**Weights.** In the hybrids the challenger's z weight stays small (Massey about 0.17–0.20, TrueSkill 0.11–0.16, Glicko-2 0.06–0.09). In later windows the uncertainty interaction L·u grows to 0.4–0.8: the model wants bolder calls where the challenger is unsure. That pattern would fit the champion being under-confident early in a season, the same direction as the R2 shrinkage question. It isn't stable enough to ship, and it moves across windows.

## Gate (item 12)

A challenger wins only if it beats the live engine on Brier, with intervals excluding zero, and doesn't regress accuracy or margin MAE on either season.

| Candidate | Brier: 2024–25 / 2025–26 | Accuracy | Margin MAE | Call |
|---|---|---|---|---|
| Massey | worse / worse | worse | worse | **No ship** |
| Massey per phase | worse / worse | worse | worse | **No ship** |
| TrueSkill | worse / worse | worse | worse (derived only) | **No ship** |
| Glicko-2 | worse / worse | worse | worse (derived only) | **No ship** |
| Hybrid + Massey | includes 0 / better | neutral | better (from the slope refit) | **No ship**: the tuning season isn't better beyond noise |
| Hybrid + TrueSkill | includes 0 (by 0.1) / better | neutral | better (from the slope refit) | **No ship**: the tuning season isn't better beyond noise |
| Hybrid + Glicko-2 | includes 0 (by 0.1) / better | neutral overall; playoff accuracy −0.30 [−0.57, −0.05] in 2024–25 | better (from the slope refit) | **No ship**: tuning Brier, plus a playoff accuracy regression |

**The program's rule.** The 2025–26 gains (−1.3 to −2.5 ×10⁻⁴) are on the reused season. The program has always required the tuning season to improve beyond noise, and none does. Massey's hybrid is the strongest on 2025–26, and it is the weakest on 2024–25.

## Why the classical systems lose

- **TrueSkill and Glicko-2 learn from win/loss only.** FTC scores run to hundreds of points with several scoring phases, and the margin carries most of the information. Throwing it away costs about 7 points of accuracy. Their uncertainty bookkeeping doesn't buy it back.
- **Massey uses margins, but only one number per robot.** The engine has more:
  - per-phase scoring rates rather than a margin;
  - score-level-dependent noise;
  - regional priors and carry-over learned from returning teams;
  - in-event form, partner overlap and a contextual model.

  Massey's per-phase reweighting closes about 30% of the gap on 2025–26 and leaves the rest.
- **Per-phase weights (for R3).** In Massey's per-phase fit, the logistic weights per SD of the total margin come out as follows. Auto points count about 1.2 times TeleOp points, and penalty points gained count about a sixteenth of a TeleOp point:

  | Phase | Weight |
  |---|---|
  | Auto | ≈ 2.3 |
  | TeleOp | ≈ 1.95 |
  | Endgame | ≈ 1.8 |
  | Penalty points gained | ≈ 0.12 |

## Side finding (not an R1 change; for the main session)

On rolling windows, the least-squares slope of the realised margin on the champion's expected margin (red − blue) is **0.90–0.94** at every origin (`context.championRefitSlopes` in the JSON). The engine's margins are therefore about 7% too wide.
- Shrinking them by that rolling slope cuts margin MAE by 0.12 [0.06, 0.17] points in 2024–25 and 0.07 [0.02, 0.12] in 2025–26.
- Win probabilities are unchanged.
- This bears on the margin-error item and on R5. It is reported, not shipped: it would be an engine change with its own gate.

The rolling probability slope on the served champion stays between 0.99 and 1.04, consistent with Part 12.5.

## Reproduce

On a copy of the snapshot:

```bash
node -e "require('fs').writeFileSync('snap.db', require('zlib').brotliDecompressSync(require('fs').readFileSync('data/snapshot.db.br')))"
DATABASE_URL=file:snap.db npx tsx scripts/engine-slices.ts --seasons 2023,2024,2025 --out <scratch> --rows champion-rows.json.gz
DATABASE_URL=file:snap.db npx tsx scripts/research/r1-rating-systems.ts champion-rows.json.gz --out docs/engine/research-2026-11/r1-rating-systems-2026-11-03.json
```

**Runtime:** the full grid takes about 25 minutes. Most of it is Massey, about 3.5 minutes per setting.

**What the champion run checks:** it reproduces the legacy baseline (72.66% / 0.1791, pass). Its row hash for the champion is `65b44316…`, recorded in the slice report it writes.
