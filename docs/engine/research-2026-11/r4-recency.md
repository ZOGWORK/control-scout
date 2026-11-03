# R4: recency and decay (measured; no change)

**Verdict: no build.** The live engine (3.3.0) already sits at the sweet spot of the decay curve.
- Its gain floor (`kMin` 0.33) keeps a robot's past results with a weight half-life of 3.8 matches.
- The curve's minimum is at a steady-state result-weight half-life of 3.9–4.4 matches, in both seasons.
- No decay variant passes the gate, whether fixed or chosen by rolling origins.
- Both endpoints are clearly worse:
  - "whole season" costs +10.7 / +6.3 ×10⁻⁴ Brier;
  - "last event only" (season prior plus the previous event's learning) costs +93.8 / +91.0 ×10⁻⁴.
- Script: `scripts/research/r4-recency.ts` (shared harness: `scripts/research/lib.ts`).
- Output: `r4-recency-2026-11-03.json`, with every variant, season, slice and rolled month.

## Research note: time-weighted ratings, form against class

- **Exponential time weighting.** Dixon & Coles (1997, *Applied Statistics*) weight each past match by exp(−ξ·age) in the likelihood. They pick ξ by out-of-sample predictive performance, not in-sample fit. The method here is the same: a family of decay rates, judged walk-forward.
- **Constant gain is exponential forgetting.** Muth (1960, *JASA*) showed that exponential smoothing is the optimal forecast when the true level follows a random walk observed with noise. At steady state the Kalman gain is a constant, and a constant gain is a fixed per-observation half-life. So an Elo or EPA rating with a gain floor already down-weights old matches exponentially. The open question is only how fast.
- **Time-based uncertainty.** Glicko (Glickman 1999, *Applied Statistics*) does not discount the rating itself. It widens the rating deviation with time away (c² per period), so the next results move the rating more. This is a per-week decay of evidence, not of level.
- **Between-season regression.** FiveThirtyEight-style Elo pulls ratings part of the way back to the mean between seasons. This is the coarsest possible decay.
- **Form against class.** In football, Hvattum & Arntzen (2010, *IJF*) found that a well-tuned rating beats covariates built from recent results ("form"). Recent results are mostly noise around a stable level. The usual finding is that form helps only as a small, quickly fading correction on top of class, which is the shape of the engine's 2.9 event-local form.

## What the engine already does (and where)

| Mechanism | Where | What it is in decay terms |
|---|---|---|
| Gain `max(kMin, k0 / (1 + n/n0))` | `rating.ts` `fold` | Up to about 10 matches, the gain falls like 1/n: roughly every match this season counts the same ("whole season"). After that the floor holds the gain at 0.33: **exponential per-match forgetting**. A robot's own result enters through its ½ share of the alliance miss, so at the floor its weight decays by (1 − ½·0.33) per later match: a **result-weight half-life of 3.84 matches**. In this note's evidence-count terms (below), the floor is W* = n0·(k0/kMin − 1) = 9.70, an evidence half-life h of 6.37. Part 12.4 swept `kMin` and found it at its peak (±0.05 costs +0.6 to +0.8 ×10⁻⁴). |
| Season carry-over ρ1 0.7, ρ2 0.2 | `priorZ` | Between-season decay of last season's z (Part 8, 2.7). |
| Season growth | `growth()` | Raises the level with weeks since the last match. It is a drift term, not a weighting. |
| Rebuild handling (`rebuildGapWeeks`, `rebuildN`) | `fold`, `breakWeeks` | A gain bump after a break, which is a step-shaped per-week decay. It is off. 2.1 rejected it and it was re-tested and rejected again on 3.2 (`part12/rebuild-gain.md`). |
| Event-local form (2.9) | `eventOffset` | "Form" on top of "class": λ × the mean miss at the current event × κ/(n+κ), gone at the next event. |

This test therefore asks two things. Does a different forgetting curve beat the floor's 3.8-match result-weight half-life? Does a continuous per-week decay beat the rejected step (rebuild)?

## Method

**Patched books.** Every variant is the live engine, unchanged except for the update gain:
- event form, regional priors, carry-over, overlap, the contextual model and its recalibration are all live;
- the engine already reads the gain experience `gainN ?? n`, so the script sets `gainN` to a discounted evidence count W just before each update;
- `packages/predict-engine` is not edited.

**h is a half-life of the evidence count W, not of a result's weight.** W sets the gain through k0 / (1 + W/n0), and a robot's result enters its rating through its ½ share of the alliance miss. So at steady state an old result's weight decays by (1 − ½·k*) per later match, where k* = k0 / (1 + W*/n0) and W* = 1 / (1 − 2^(−1/h)). The curve below gives both:
- h, the setting;
- the **result-weight half-life** ln ½ / ln(1 − ½·k*), the quantity the brief asks about.

**The variants:**
- **per match, kMin 0:** W ← W·2^(−1/h) + 1 after each match, with h ∈ {2, 3, 4, 5, 6.4, 8, 12, 20, 40}. Here the decay alone sets the floor.
- **whole season (endpoint):** no decay and kMin 0, so the gain is about 1/n all season.
- **per week:** W ← W·2^(−weeks since the team's last match / h) at each update, with h ∈ {0.5, 1, 2, 4, 8, 16} weeks. Run twice: with the live floor, and with kMin 0 (pure time weighting).
- **last event only (endpoint):**
  - Before a robot's first match at a new event, its rating is rebuilt as: its season prior × the season growth applied so far, plus what it learned at its previous event (end of that event minus its start there).
  - Earlier events are forgotten, and W counts only matches at the current event. Live floor.
- **gain reset at each new event:** W back to 0 at a robot's first match of each new event.
  - Earlier events stay in the rating; only the next updates move it faster.
  - It is a continuous "rebuild" bump, run with the live floor and with kMin 0.
- **context only:** live without event form (`eventLambda*` 0), to show what the form layer is worth.

**Protocol (identical for every model):**
- Walk-forward replay of the backtest corpus (`scripts/slices/corpus.ts`): 2023–24 as warm-up (cold start), then 2024–25 (tuning) and 2025–26 (**reused**).
- The served call (`predictMatch` + contextual model), pre-match only, at rated events, on 2-robot alliances.
- **Decisive matches only**: ties are left out of every metric. That gives 33,017 matches for 2024–25 and 36,572 for 2025–26.
- Metrics: Brier (primary), winner accuracy, and margin MAE (|expected red − blue margin − actual margin|, points).
- Δ = variant − live, on identical matches, with 95% intervals from 2,000 bootstraps over whole events.

**Rolling origins** (Part 9 / 12.5): for each month from October 2024 to July 2026, pick the family member with the lowest Brier over the previous 365 days and use its calls for that month.

**Gate:**
- Δ Brier's interval lies below zero;
- neither accuracy's nor margin MAE's interval lies entirely on the worse side;
- both of the above hold on both seasons.

**Reproduction check:**
- With ties counted as 0.5, this replay's champion scores Brier 0.16723 on 2025–26, which is the stored 3.3.0 slice report exactly.
- Engine 1.x reproduces 72.66% / 0.1791. That is the prompt's "72.7% / 0.179": a pre-2.0 baseline, reported here for context only.

Live 3.3.0 on decisive matches:

| Season | Brier | Accuracy | Margin MAE |
|---|---|---|---|
| 2024–25 | 0.1578 | 76.54% | 38.85 |
| 2025–26 | 0.1681 | 74.79% | 37.48 |

## The decay curve

Brier change against live, ×10⁻⁴ (negative is better), per-match family (kMin 0):

| Evidence half-life h | Result-weight half-life | 2024–25 Δ Brier [95%] | quals 1–10 | 0–5 matches | Δ acc pp | Δ margin MAE | 2025–26 Δ Brier [95%] | quals 1–10 | 0–5 matches | Δ acc pp | Δ margin MAE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 2.50 | +6.42 [+2.99, +9.98] | +8.33 | +4.25 | −0.21 | −0.011 | +7.65 [+4.48, +10.42] | +7.34 | +4.13 | −0.30 | +0.172 |
| 3 | 2.81 | +3.03 [+0.46, +5.70] | +4.71 | +2.45 | −0.11 | −0.064 | +4.34 [+2.02, +6.45] | +4.76 | +2.62 | −0.19 | +0.087 |
| 4 | 3.11 | +1.29 [−0.69, +3.32] | +2.67 | +1.40 | −0.05 | −0.079 | +2.45 [+0.72, +4.05] | +3.19 | +1.72 | −0.09 | +0.038 |
| 5 | 3.42 | +0.31 [−1.25, +1.85] | +1.26 | +0.55 | −0.04 | −0.074 | +1.32 [+0.06, +2.50] | +2.00 | +1.15 | −0.04 | +0.013 |
| **6.4** (≈ live floor, 3.84) | **3.85** | **−0.14 [−1.24, +0.94]** | +0.02 | −0.15 | +0.02 | −0.050 | +0.51 [−0.30, +1.31] | +1.07 | +0.55 | −0.01 | +0.002 |
| **8** | **4.35** | +0.04 [−0.90, +0.91] | −0.78 | −0.55 | −0.02 | −0.013 | **+0.18 [−0.52, +0.90]** | +0.33 | +0.15 | −0.01 | +0.004 |
| 12 | 5.58 | +1.25 [+0.00, +2.44] | −1.49 | −0.97 | −0.05 | +0.080 | +0.49 [−0.63, +1.67] | −0.18 | −0.17 | −0.03 | +0.030 |
| 20 | 8.04 | +3.55 [+1.46, +5.54] | −1.81 | −1.05 | −0.13 | +0.211 | +1.69 [−0.15, +3.59] | −0.51 | −0.41 | −0.02 | +0.083 |
| 40 | 14.2 | +6.55 [+3.65, +9.46] | −1.60 | −0.89 | −0.19 | +0.370 | +3.44 [+0.91, +6.05] | −0.51 | −0.49 | −0.08 | +0.158 |
| ∞: **whole season** | ∞ (gain ~1/n) | +10.69 [+6.77, +14.68] | −1.08 | −0.39 | −0.28 | +0.588 | +6.33 [+2.99, +9.84] | −0.03 | −0.41 | −0.12 | +0.275 |

```mermaid
xychart-beta
  title "Δ Brier ×10⁻⁴ vs live by result-weight half-life in matches (first line 2024–25, second 2025–26; 0 = live)"
  x-axis ["2.5", "2.8", "3.1", "3.4", "3.85", "4.35", "5.6", "8.0", "14.2", "season"]
  y-axis "Δ Brier ×10⁻⁴" -2 --> 12
  line [6.42, 3.03, 1.29, 0.31, -0.14, 0.04, 1.25, 3.55, 6.55, 10.69]
  line [7.65, 4.34, 2.45, 1.32, 0.51, 0.18, 0.49, 1.69, 3.44, 6.33]
```

**Sweet spot: a result-weight half-life of about 3.9–4.4 matches** (evidence half-life h 6.4–8), in both seasons. The live floor is already there: 3.84, or h 6.37. Read across the columns, the curve shows the form-against-class trade-off:
- **Short half-lives** (result weight 2.5–3.4) chase noise. They are worst early in events (quals 1–10 +2 to +8) and cost accuracy.
- **Long half-lives** (result weight 5.6 matches up to whole season) help the first matches a little (quals 1–10 and 0–5 matches −0.4 to −1.8, because a new robot's early results are not forgotten), but they go stale later in the season. Overall Brier, accuracy and margin MAE all get worse.

**Per week, and the endpoints** (Δ Brier ×10⁻⁴ [95%]):

| Variant | 2024–25 | 2025–26 |
|---|---|---|
| Per-week half-life 0.5 / 1 / 2 weeks, live floor | +11.68 / +8.11 / +3.24 [−0.17, +6.61] | +10.93 / +8.16 / +3.85 [+1.03, +6.60] |
| Per-week half-life 4 weeks, live floor | +0.08 [−2.01, +2.14] | +0.58 [−1.10, +2.18] |
| Per-week half-life 8 weeks, live floor | −0.52 [−1.64, +0.54] (acc +0.02, MAE −0.070) | −0.14 [−0.86, +0.62] (acc −0.03, MAE −0.020) |
| Per-week half-life 16 weeks, live floor | −0.19 [−0.66, +0.27] | +0.12 [−0.23, +0.46] |
| Per-week half-life 4 / 8 / 16 weeks, kMin 0 | +0.54 / +1.36 / +4.26 | +1.06 / +0.39 / +1.87 |
| **Last event only** (season prior + previous event's learning), live floor | +93.83 [+81.93, +106.53]; acc −1.48 pp, MAE +2.56; quals 1–10 +159.9, robots with 16+ matches +142.0 | +90.96 [+79.90, +101.68]; acc −1.61 pp, MAE +2.07; quals 1–10 +157.5, 16+ matches +143.9 |
| Gain reset at each new event (earlier events kept), live floor | +13.75 [+9.02, +18.86] | +12.38 [+8.06, +16.42] |
| Gain reset at each new event (earlier events kept), kMin 0 | +13.76 [+9.02, +18.87] | +12.41 [+8.07, +16.44] |
| Live **without event form** (context) | +2.17 [+1.20, +3.18]; quals 1–10 +2.54, 0–5 matches +3.09 | +2.49 [+1.65, +3.43]; quals 1–10 +3.76, 0–5 matches +3.64 |

- **Per-week decay on top of the live floor is neutral at 8–16 weeks and harmful below 4.** It is a smooth version of the rebuild bump. Like that bump (`part12/rebuild-gain.md`), it finds nothing beyond noise.
- **"Last event only" is by far the worst variant tested** (+91 to +94 ×10⁻⁴). Rebuilding a robot from its season prior and its previous event alone throws away the class its earlier events established.
  - The loss is largest at the start of each event (quals 1–10 +158 to +160), where the forgotten history is all there is.
  - It is also large for experienced robots (16+ matches: +142 to +144).
- **Resetting only the gain at each new event**, with earlier events kept, costs +12 to +14. Faster learning at every new meet is the rebuild idea `part12/rebuild-gain.md` already rejected, and this confirms it.
- **Event form, the engine's "form" layer, is worth 2.2–2.5 ×10⁻⁴** overall and 2.5–3.8 on the weakest slices. Form adds to class as a fading correction; replacing class with recent form loses.

## Rolling origins and the gate

Each family's member was re-chosen every month on the 365 days before it. Challenger minus live:

| Family | 2024–25 Δ Brier [95%] | Δ acc pp [95%] | Δ MAE [95%] | 2025–26 Δ Brier [95%] | Δ acc pp [95%] | Δ MAE [95%] | Monthly picks | Gate |
|---|---|---|---|---|---|---|---|---|
| Per-match (kMin 0) | +0.97 [−0.09, +1.97] | −0.06 [−0.16, +0.04] | +0.039 [+0.012, +0.065] | +0.38 [−0.47, +1.25] | −0.02 [−0.11, +0.08] | +0.000 [−0.017, +0.017] | h 12 (Oct–Dec 2024), 20 (Jan 2025), 12 (Feb), 8 (Mar), 6.4 (Apr 2025–Feb 2026), 8 (Mar–Jul 2026) | fail |
| Per-week, live floor | −0.17 [−1.03, +0.69] | −0.02 [−0.10, +0.06] | −0.045 [−0.070, −0.022] | +0.00 [−0.66, +0.69] | −0.04 [−0.12, +0.04] | −0.013 [−0.025, −0.001] | 16 weeks (Oct 2024–Jan 2025), 8 (Feb 2025–Feb 2026), live (Mar–Apr 2026), 8 (May), live (Jun–Jul) | fail |
| Per-week (kMin 0) | +1.42 [−0.45, +3.31] | −0.04 [−0.17, +0.09] | −0.017 [−0.072, +0.035] | +0.23 [−1.40, +1.92] | −0.05 [−0.18, +0.08] | −0.029 [−0.063, +0.007] | 8 weeks (Oct 2024–Mar 2025), 4 (Apr 2025–Apr 2026), 8 (May–Jul 2026) | fail |
| All recency variants + live | +0.68 [−0.90, +2.22] | −0.05 [−0.18, +0.08] | −0.018 [−0.060, +0.023] | +0.00 [−0.66, +0.69] | −0.04 [−0.12, +0.04] | −0.013 [−0.025, −0.001] | per-week kMin 0, 8 weeks (Oct 2024–Feb 2025), then as the per-week/floor row from Mar 2025 | fail |

The fixed picks, the best member of each family on 2024–25 judged on both seasons, fail too:
- per match, 6.4: −0.14 [−1.24, +0.94] and +0.51 [−0.30, +1.31];
- per week with the floor, 8 weeks: −0.52 [−1.64, +0.54] and −0.14 [−0.86, +0.62].

Weakest slices under the rolled per-week/floor family:
- quals 1–10: −0.74 [−1.67, +0.16] and −0.07 [−1.12, +0.97];
- 0–5 matches: −0.51 [−1.36, +0.32] and +0.18 [−0.56, +0.96].

The one consistent signal is a slightly lower margin MAE with an 8-week per-week decay on the floor: −0.045 and −0.013 points rolled, both beyond noise. It is a few hundredths of a point, and Brier does not move, so it is recorded, not built.

## Answer to the brief

- **How fast should old matches stop counting?** A robot's own past result should keep half its weight after about 4 more matches (3.9–4.4). That is what the live gain floor already does (3.84).
- **Last event against whole season:** neither.
  - A whole-season (equal-weight) rating is +6 to +11 ×10⁻⁴ worse.
  - A last-event-only rating is +91 to +94 worse.
  - Restarting the gain at each event, with earlier events kept, is +12 to +14 worse.
- **Does any decay beat the current gain schedule plus event form?** No. The best variants are ties within ±0.5 ×10⁻⁴, and all fail the gate.

## Caveats

- 2025–26 is reused data. 2023–24 is a cold start in this snapshot, so the first rolled months' windows are mostly a season with no carry-over.
- Rolling selection switches between fixed-setting replays. A live engine that changed its half-life mid-season would carry a slightly different rating state. The picks switch 2–5 times in 22 months, almost always between neighbouring settings (h 6.4 and 8, or 8 weeks and live), so the difference is small.
- The last-event-only endpoint rebuilds the rating from the season prior grown by the growth factors applied so far. Its regional lift and event form are left as live. It is an endpoint, so the size of its loss matters more than its exact construction.
- Per-match decay counts playoff matches like quals. Playoff updates already carry `playoffWeight` 0.5 in the gain itself.
