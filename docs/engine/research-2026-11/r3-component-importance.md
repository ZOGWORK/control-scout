# R3: component feature importance (measured; no engine change)

**Verdict: nothing ships. Engine 3.3.0 stays as it is.**
- The ranking is clear: TeleOp first by a wide margin, then auto, then endgame. Expected fouls add nothing to predicting the winner.
- The live engine already weights them close to how a free refit does. The one consistent difference is that auto is slightly under-weighted.
- The reweighting candidate that follows from that (R3a: change three contextual coefficients) passes the gate on 2024–25. On 2025–26 it fails: the Brier interval crosses zero and accuracy drops 0.08 points, an interval entirely below zero.

Files:
- Scripts: `scripts/research/component-rows.ts`, `scripts/research/r3-component-importance.ts`, `scripts/research/lib.ts`.
- Output: `r3-component-importance.json` (every number below, with the per-origin fits).

## Method note: feature importance in team-sport prediction

Three standard ways to ask "which inputs matter":

| Method | What it measures | Weak spot |
|---|---|---|
| **Standardized coefficients** (logistic regression on inputs scaled to unit SD) | The weight the fitted model gives one SD of each input, holding the others fixed | Correlated inputs split the credit between them, and the split can be unstable. A large weight is not a large forecasting gain. |
| **Permutation importance** (Breiman 2001; "model reliance", Fisher, Rudin & Dominici 2019) | How much the fitted model's held-out score worsens when one input is shuffled across matches, with no refit | Shuffling a correlated input makes impossible rows. It also overstates inputs the model leans on even when a substitute exists (Strobl et al. 2008; Hooker, Mentch & Zhou 2021). |
| **Drop-column / ablation with refit** (leave-one-covariate-out, Lei et al. 2018) | How much the held-out score worsens when the model is refitted without the input | Costs one refit per input. This is the closest of the three to "what does the input buy us". |

In team sports this is mostly done with regressions of the result on box-score components. Basketball's "four factors" weights were found this way. In FRC and FTC the usual split is by match phase: auto, TeleOp and endgame point contributions (EPA- or OPR-style).

The common finding is that the components with the most points and the least noise carry the forecast. Raw correlation with winning is a poor guide, because components are correlated with each other. Here, every measurement is forward-only and paired against the live engine on the same matches. The cost of removing a component is reported in Brier, with event-bootstrap intervals, not as a correlation.

## Protocol

Every challenger and the champion use the same protocol:
- **Corpus:** the pinned snapshot (data version 2026-10-14), seasons 2023–2025, replayed by the slices harness's loader, order and exclusions.
- **Rows:** rated events, pre-match state only, **decisive matches only** (ties left out of every fit and score).
- **Rolling origins:** monthly, October 2024 to July 2026. 19 months have at least 50 matches.
- **Fitting:** anything fitted is fitted on the 365 days before the origin and scored on that month.
- **Seasons:** 2024–25 is the tuning season. 2025–26 (DECODE) is judged and labelled **reused**.
- **Intervals:** paired, resampling whole events (2,000 draws).

**Champion:** the live engine 3.3.0, exactly as served.
- It is recomputed from its own inputs (max |Δp| = 0 against the served call).
- On these rows: 2024–25 Brier 0.1579, accuracy 76.53%, margin MAE 38.8. 2025–26 Brier 0.1681, accuracy 74.79%, margin MAE 37.5.
- The prompt's 72.7% / 0.179 is the pre-2.0 legacy engine and is shown for context only.
- The champion's contextual weights saw 2023–24 and early 2024–25, and its final stretch saw 2024–26. That favours the champion on both seasons, the same caveat as the Part 9 and 12 gates.

**Components.** The engine's expected margin splits exactly into four phase gaps, red minus blue, overlap included: auto + TeleOp + endgame + fouls (the fouls each side is expected to give away). The largest decomposition error is 0.003 points.

Each phase enters the win probability twice:
- through L, the logit of Φ(margin / S);
- for auto, endgame and fouls, through its own contextual input (D1, D2, D3).

The other contextual inputs are grouped as the brief names them:

| Group | Inputs |
|---|---|
| Form | D18, D20 |
| Reliability | D13–D17, D21, D22 |
| Partner balance | D4 |
| Experience | D5, D6 |
| Data certainty | D7, D9, D10, D11, D19 |
| Match context | D8 playoff, D12 total strength |

**Harness fix found on the way.** `engine-slices.ts --features` read the contextual inputs under the region hint but not the event hint. Since 2.9, the event hint carries a robot's form at the event. The stored inputs therefore differed from the served ones on 85% of rows (up to 0.027 in probability). The flag now reads them under both hints. The R3 rows come from `component-rows.ts`, which records the inputs exactly as served. Part 9's refit predates 2.9 and is unaffected.

## Results: ranked components

Brier cost of removing each group, ×10⁻⁴, with the 95% interval. Positive means removing it hurts. Three measurements on the live engine:
- **Drop + refit:** the contextual model refitted without the group, compared with the same refit with it.
- **Zero-out:** the group set to its neutral value, no refit.
- **Permutation:** the group shuffled within the month, 3 repeats, no refit.

| Rank | Group | Drop + refit, 2024–25 | Drop + refit, 2025–26 (reused) | Zero-out, 2025–26 | Permutation, 2025–26 | Margin MAE cost, 2025–26 (pts) |
|---|---|---|---|---|---|---|
| 1 | **TeleOp** | **+186.9 [173.3, 200.5]** | **+125.1 [113.9, 135.8]** | +265.1 | +706.3 | +6.80 |
| 2 | **Auto** | +24.8 [20.1, 29.4] | **+51.2 [44.8, 57.9]** | +70.4 | +167.1 | +1.79 |
| 3 | **Endgame** | +25.2 [20.2, 29.9] | +3.2 [0.9, 5.7] | +5.4 | +11.5 | 0.00 |
| 4 | Reliability | +3.6 [1.8, 5.5] | +5.2 [3.4, 7.1] | +1.6 | +5.1 | – |
| 5 | Partner balance | +3.5 [2.1, 5.1] | +4.8 [3.2, 6.4] | +7.5 | +15.9 | – |
| 6 | Experience | +3.9 [1.7, 6.3] | +4.4 [2.5, 6.5] | +6.1 | +10.7 | – |
| 7 | Form | +2.7 [0.8, 4.5] | +3.6 [2.1, 5.1] | +11.7 | +20.4 | – |
| 8 | Data certainty | +4.9 [2.8, 6.9] | +1.7 [−0.2, 3.6] | +5.5 | +8.0 | – |
| 9 | Match context | +0.3 [−0.1, 0.8] | +0.7 [0.1, 1.4] | +0.9 | +0.9 | – |
| 10 | **Fouls** | −0.1 [−0.3, +0.1] | +0.1 [−0.6, +0.8] | +0.1 | +0.5 | **−0.13** (better without) |

Ranked by the drop-and-refit cost on 2025–26.

What the table says:
- **TeleOp is most of the forecast.**
  - Losing it costs 0.0125 Brier and 2.2 points of accuracy, even after a refit.
  - It is also the biggest single term in the margin.
- **DECODE's auto matters about twice as much as INTO THE DEEP's** (+51 against +25). Its endgame matters far less (+3 against +25). That fits the game: DECODE's base return is a small share of the score.
- **Expected fouls carry no win information in either season.**
  - Every interval contains zero.
  - Dropping expected fouls improves the 2025–26 margin MAE by 0.13 points [0.08, 0.18]. A follow-up is noted below.
- **The contextual extras are each worth +2 to +5 after a refit.** Together they are the 2.x model's gain over the raw score model.
- **Correlation would mislead.**
  - Partner spread (D4) correlates with the result about as strongly as auto does (r = 0.32 against 0.49, 2025–26). Its refit cost is a tenth of auto's.
  - Without a refit, permutation and zero-out roughly double the costs. The extras overlap, and a refit lets one stand in for another.

## Results: weights

**How the live engine weights a point.** This is each phase's weight on the final log-odds per unit of expected gap / S, relative to TeleOp. It folds L and the D1–D3 coefficients through the calibration (average 2025–26 row).

| | Auto | TeleOp | Endgame | Fouls |
|---|---|---|---|---|
| Live engine 3.3.0 | 0.95 | 1 | 0.81 | 0.05 |
| Per-component logistic, 2024–25 fits (mean of origins) | 1.05 | 1 | 0.86 | −0.01 |
| Per-component logistic, 2025–26 fits (mean of origins) | **1.28** | 1 | 0.83 | 0.19 |

**Standardized coefficients of the per-component logistic model**, 2025–26 origins (log-odds per SD of the input). Phase gaps are divided by S, and there is no L, so the phases stand on their own.

| Input | Weight | Input | Weight |
|---|---|---|---|
| TeleOp gap | **1.054** | D4 partner spread | 0.114 |
| Auto gap | **0.568** | D14 variance | 0.057 |
| D18 in-event form | 0.183 | D13 bias | −0.052 |
| D5 experience | 0.181 | D6 days since last | −0.042 |
| Endgame gap | 0.178 | D20 momentum | 0.035 |
| Fouls gap | 0.026 | D7 uncertainty | 0.018 |

The 2024–25 fits are in the JSON.

**This simple model alone** comes close to the live engine but loses:
- 2024–25: Brier 0.1591 (+12.0×10⁻⁴ [+8.4, +15.4]), accuracy −0.16 pts.
- 2025–26: Brier 0.1687 (+5.6×10⁻⁴ [+2.4, +8.7]), accuracy −0.05 pts.

Its own drop-column and permutation rankings match the table above.

**Stability.** The free 22-weight refit flips D1 (auto) from −0.030 to about +0.10 at every recent origin, the same flip Part 9 reported. On these rows the full refit is neutral against the champion:
- 2024–25: +0.5 [−1.1, +2.2].
- 2025–26: −1.3 [−3.3, +0.5].

## The reweighting candidates, through the gate

Both candidates add refitted phase weights to the champion's log-odds. They are fitted on the prior 365 days of champion calls, mirrored, with no intercept. Win probability only, so the margin is unchanged by construction.

**R3a: Δ on D1–D3.** This is a pure `model.json` coefficient change.

| Season | n | Δ Brier ×10⁴ [95%] | Δ accuracy, pts [95%] | Δ margin MAE | 50–80% calibration error | Slice regressions | Gate |
|---|---|---|---|---|---|---|---|
| 2024–25 (tuning) | 32,974 | **−0.38 [−0.75, −0.02]** | −0.00 [−0.06, +0.05] | 0 | 0.73 → 0.77 pts | none | pass |
| 2025–26 (reused) | 36,572 | −0.34 [−1.09, +0.35] | **−0.08 [−0.17, −0.01]** | 0 | 1.04 → 0.67 pts | none | **fail** |

**R3b: Δ on all four phase gaps / S.** This needs one new TeleOp input.

| Season | n | Δ Brier ×10⁴ [95%] | Δ accuracy, pts [95%] | 50–80% calibration error | Slice regressions | Gate |
|---|---|---|---|---|---|---|
| 2024–25 | 32,974 | +0.04 [−0.65, +0.72] | −0.05 [−0.12, +0.02] | 0.73 → 0.54 | first event, thin data | fail |
| 2025–26 (reused) | 36,572 | −0.74 [−1.88, +0.37] | −0.07 [−0.19, +0.05] | 1.04 → 0.93 | none | fail |

**Why R3a does not ship.**
- Its Brier gain is under 0.4×10⁻⁴, about a fiftieth of the 2.8–2.11 releases.
- On DECODE its interval includes zero, and it costs accuracy beyond noise.
- The value it would ship, fitted on the last 365 days: D1 −0.030 → +0.081, D2 −0.107 → −0.144, D3 −0.290 → −0.236.

The direction (auto worth slightly more) is consistent across every origin, the free refit and Part 9's flip. It is worth re-testing at the 2026–27 rollover with a fully unseen season. On today's data it is not an improvement.

## Follow-ups (not built)

- **Fouls in the expected score.** Expected fouls add nothing to the win call. Dropping them from the expected margin cuts the 2025–26 margin MAE by 0.13 points [0.08, 0.18]. This is a score-model question (the 2.10 foul gain, 0.15×). It needs a gate on margin and score MAE and both seasons before it can be called. R3 only flags it.
- **Auto weight at the 2026–27 rollover:** re-run R3a when a fully unseen season exists.
