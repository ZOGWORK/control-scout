# R5: margin-of-victory Elo (measured; no engine change)

**Verdict: nothing ships. Engine 3.3.0 stays as it is.**
- **Alone**, MOV-Elo is far behind the live engine. Brier is 0.029 worse and accuracy about 5.5 points lower in both seasons, and every slice regresses.
- **As an extra input next to the live engine** (the hybrids), no form beats the engine on Brier, with the interval excluding zero, in both seasons.
- **The margin is the real finding.** The 538 margin multiplier makes Elo itself much better than plain win/loss Elo (−0.005 Brier, +1 point accuracy). But next to the engine, plain Elo adds as much as MOV-Elo does: the margin information is already in the engine.

Files:
- Script: `scripts/research/r5-mov-elo.ts`, which uses `scripts/research/component-rows.ts` and `lib.ts`.
- Output: `r5-mov-elo.json`.

## Method note

**FiveThirtyEight's Elo (NFL / NBA)** updates a rating by K × M × (result − expected).

The margin multiplier:

M = ln(|MOV| + 1) × 2.2 / (0.001 × Δ_winner + 2.2)

- The log damps blowouts.
- The second factor is the **autocorrelation correction**. Favourites win by more, so an uncorrected MOV-Elo keeps inflating them. The correction shrinks the update when the winner was already the favourite and grows it after an upset.
- Expected result = 1 / (1 + 10^(−Δ/400)).
- Ratings regress toward the mean between seasons.

**Adapted to FTC's 2-robot alliances:**
- Alliance rating = R_a + R_b, and Δ = red − blue.
- The alliance's update is split equally between the partners: each robot moves ±K_t/2 × M × (y − P).
- The K schedule K_t = max(K0/3, K0 / (1 + n_t/n0)) was offered in the grid. Constant K won.
- Playoffs count half, as in the engine.
- Scrimmages are predicted but never rated, ties update with M = 1, and 3-robot lineups are skipped.

**Two multipliers were tried:**
- `538`: the raw formula.
- `538norm`: the margin in units of a running mean |margin|, M = ln(10 × |MOV| / A + 1). This keeps one K across seasons whose scores differ in size.

**Margin prediction:** margin = β × Δ, with β fitted by least squares through the origin on the prior 365 days.

**Calibration:** a slope-only stretch σ(a × logit P), fitted on the prior 365 days.

**What MOV-Elo could add beyond the engine.** Engine 3.3 is already a points-based (EPA-style) rating. It learns each robot's auto, TeleOp, endgame and foul contribution from every match's per-phase score residuals, so it already learns from margins, and per phase. MOV-Elo can only add three things:
1. **Opponent-relative learning.** The engine judges each alliance's own score against its own expectation. It never learns "this robot beats strong opponents", for example through defence or interference. Elo's update depends on the result against the opponent.
2. **A bounded update.** ln(MOV) caps what one blowout teaches. The engine's update is linear in the residual, with fouls already damped by 0.15× and reliability states pricing collapses.
3. **A different error.** As an ensemble member it is diverse, if weak.

All three are tested below. If they mattered, the hybrid would beat the engine, and MOV-Elo would add more than plain Elo.

## Protocol

Identical to R3 and to every challenger and the champion:
- **Corpus:** the pinned snapshot (data 2026-10-14), seasons 2023–2025, in the slices harness's order and exclusions.
- **Rows:** rated events, pre-match state, decisive matches only.
- **Rolling origins:** monthly, October 2024 to July 2026 (19 scored months). Every fit uses the prior 365 days only.
- **Tuning:** Elo settings were picked on 2024–25 by rolled Brier over a grid of 1,440 settings: multiplier, K0, n0, carry-over ρ ∈ {0.3, 0.5, 0.7, 0.9}, newcomer offset ∈ {0, −100, −200} and the autocorrelation constant c ∈ {0, 0.0005, 0.001, 0.0025, 0.005}.
- **Seasons:** 2025–26 (DECODE) is judged once and labelled **reused**.
- **Intervals:** paired event-bootstrap 95% intervals.
- **Gate:** the R3 gate. Brier better with the interval excluding zero; accuracy and margin MAE not worse beyond noise; 50–80% calibration error no worse; no slice regression, on the same slices as `engine-slices.ts --challenger` (volatility and probability band included).

**Champion:** live engine 3.3.0.
- 2024–25: Brier 0.1579, accuracy 76.53%, margin MAE 38.84.
- 2025–26: Brier 0.1681, accuracy 74.79%, margin MAE 37.48.
- The prompt's 72.7% / 0.179 is the pre-2.0 legacy engine and is context only.

Chosen settings (all have constant K):

| Variant | K0 | ρ | c | Newcomers start at |
|---|---|---|---|---|
| Plain Elo | 128 | 0.7 | – | 1300 |
| 538 | 32 | 0.5 | 0.001 | 1400 |
| 538norm | 64 | 0.5 | 0.001 | 1400 |

Edges of the grid:
- The two MOV-Elo variants sit inside the grid on every setting. That holds for K0, ρ, c (which has 0 and 0.0005 below it) and the offset (−200 was tested).
- Plain Elo, the win/loss reference, picked the lowest offset tested (−200). An earlier run with offsets of 0 and −100 only differed from it by 0.0001–0.0004 Brier. Plain Elo is a reference, not a candidate.

## Results

### Standalone, against the live engine

| Model | Season | Brier | Accuracy | Margin MAE | Δ Brier ×10⁴ [95%] | Δ accuracy, pts [95%] | Δ margin MAE [95%] |
|---|---|---|---|---|---|---|---|
| Plain Elo (win/loss) | 2024–25 | 0.1934 | 69.94% | 47.45 | +354.7 [+337.2, +373.1] | −6.59 [−7.10, −6.08] | +8.60 [+8.14, +9.06] |
| | 2025–26 (reused) | 0.2021 | 68.44% | 44.82 | +339.9 [+323.6, +356.6] | −6.36 [−6.84, −5.89] | +7.34 [+6.98, +7.71] |
| MOV-Elo (538) | 2024–25 | 0.1876 | 71.18% | 45.89 | +297.1 [+281.2, +313.7] | −5.35 [−5.82, −4.87] | +7.05 [+6.60, +7.47] |
| | 2025–26 (reused) | 0.1975 | 69.26% | 43.62 | +293.2 [+278.2, +308.4] | −5.54 [−6.00, −5.07] | +6.14 [+5.83, +6.46] |
| MOV-Elo (538norm) | 2024–25 | 0.1862 | 71.46% | 45.57 | +283.3 [+267.4, +299.7] | −5.07 [−5.53, −4.60] | +6.73 [+6.29, +7.14] |
| | 2025–26 (reused) | 0.1967 | 69.31% | 43.52 | +285.6 [+270.6, +300.4] | −5.48 [−5.93, −5.04] | +6.04 [+5.73, +6.36] |

Every MOV-Elo variant regresses in every slice. The margin is worth about 0.005 Brier and 1 point of accuracy inside Elo, but Elo on alliance totals stays far behind a per-phase points rating.

### Hybrids, against the live engine

H0 is the control: the champion restretched by its own rolling slope (H1 with γ = 0). It separates "the Elo term helps" from "a fresh calibration helps":
- 2024–25: −0.01 [−0.30, +0.29].
- 2025–26: **+0.48 [+0.26, +0.72]**, worse. The shipped stretch beats a rolling one.

**H1: P = σ(a × logit p_champion + γ × Elo log-odds)**, fitted on the prior 365 days. γ comes out at about 0.05–0.07 on the Elo log-odds, and a at about 1.0.

| Elo input | Season | Δ Brier vs champion ×10⁴ [95%] | Δ accuracy, pts [95%] | Δ Brier vs H0 [95%] | Slice regressions | Gate |
|---|---|---|---|---|---|---|
| Plain | 2024–25 | −0.29 [−1.04, +0.45] | −0.04 [−0.13, +0.06] | −0.28 [−0.97, +0.42] | none | fail |
| | 2025–26 | −0.23 [−0.99, +0.50] | −0.01 [−0.11, +0.09] | −0.70 [−1.43, −0.00] | none | fail |
| 538 | 2024–25 | −0.21 [−0.92, +0.48] | −0.04 [−0.13, +0.05] | −0.20 [−0.83, +0.45] | none | fail |
| | 2025–26 | −0.27 [−1.00, +0.44] | −0.05 [−0.15, +0.05] | −0.74 [−1.43, −0.08] | none | fail |
| 538norm | 2024–25 | −0.21 [−0.86, +0.44] | −0.04 [−0.12, +0.05] | −0.20 [−0.80, +0.38] | none | fail |
| | 2025–26 | −0.30 [−1.06, +0.42] | −0.04 [−0.14, +0.05] | −0.78 [−1.48, −0.11] | none | fail |

**H2: the contextual model refitted with the Elo log-odds as a 23rd input** (research learner, prior 365 days, slope recalibration).

| Elo input | Season | Δ Brier vs champion ×10⁴ [95%] | Δ accuracy, pts [95%] | Δ Brier vs the same refit without Elo [95%] | Gate vs champion |
|---|---|---|---|---|---|
| None (refit 22 only) | 2024–25 | +0.54 [−1.13, +2.21] | −0.17 [−0.30, −0.05] | – | fail |
| | 2025–26 | −1.34 [−3.29, +0.53] | −0.04 [−0.21, +0.11] | – | fail |
| Plain | 2024–25 | −0.41 [−2.30, +1.36] | −0.08 [−0.24, +0.07] | **−0.95 [−1.70, −0.28]** | fail (first event, volatility not measured) |
| | 2025–26 | **−2.10 [−4.27, −0.09]** | −0.04 [−0.20, +0.12] | −0.75 [−1.73, +0.24] | pass |
| 538 | 2024–25 | −0.30 [−2.17, +1.51] | −0.08 [−0.23, +0.07] | **−0.84 [−1.54, −0.18]** | fail (first event, volatility not measured) |
| | 2025–26 | **−2.19 [−4.30, −0.19]** | −0.05 [−0.22, +0.11] | −0.85 [−1.80, +0.07] | pass |
| 538norm | 2024–25 | −0.23 [−2.11, +1.56] | −0.09 [−0.24, +0.05] | **−0.77 [−1.42, −0.16]** | fail (first event, volatility not measured) |
| | 2025–26 | **−2.16 [−4.26, −0.13]** | −0.05 [−0.21, +0.11] | −0.82 [−1.77, +0.10] | pass |

**Margin hybrid**, alongside H1: margin = b1 × engine margin + b2 × Δ. It improves margin MAE in both seasons:
- 538: 2024–25 −0.12 [−0.17, −0.06], 2025–26 −0.08 [−0.13, −0.03].
- Plain Elo does the same: −0.11 and −0.08.

The fit shrinks the engine's margin (b1 ≈ 0.90) and adds a small Elo term.

## Verdicts

1. **MOV-Elo standalone: rejected.** It is about 0.029 Brier and 5.5 points of accuracy behind, in both seasons.
2. **H1 (MOV-Elo log-odds next to the champion): rejected.**
   - Neither season's interval excludes zero against the champion.
   - Against a fair recalibrated control it helps 2025–26 only.
3. **H2 (MOV-Elo as a 23rd contextual input): rejected.**
   - Against the champion it wins on 2025–26 only. On 2024–25 the interval spans zero and the first-event and volatility-not-measured slices regress.
   - Against its own refit it wins on 2024–25 only.
   - It also inherits the 22-weight refit Part 9 rejected (three sign flips; here D1 flips again).
4. **The margin multiplier adds nothing the engine lacks.** In every hybrid, plain win/loss Elo adds about as much as MOV-Elo. What the hybrids pick up is the opponent-relative signal, not the margin: the engine already learns from margins, per phase. That signal is small (≤ 1×10⁻⁴ Brier) and not stable across seasons.
5. **Margin hybrid: not shippable on its own.** It gains about 0.1 points of margin MAE, but the gate's primary metric is Brier, and the matching probability hybrid fails. It also mostly shrinks the engine's margin by about 10%, which the score model's own spread fit could be asked to do directly. A score-model question for a later gate, like R3's foul note.

**Follow-up.** An opponent-relative term ("beats strong opponents") is the one thing Elo measures and the engine doesn't. It is worth a targeted test at the 2026–27 rollover, when a fully unseen season exists. As a plain Elo input it does not clear the gate today.
