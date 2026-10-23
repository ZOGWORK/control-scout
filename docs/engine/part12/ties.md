# Part 12.6: tie-aware outcomes (measured; shipped as engine 3.1.0)

**Verdict: shipped, as a correctness fix.** Win probabilities and scores are identical to 3.0.0. Only ranking-point odds and event simulations change.
- Script: `scripts/part12/ties-research.ts`.
- Output: `ties-2026-10-23.json`.

## The brief's claim

The binary model "silently misallocates" a tie's probability mass:
- A tie pays RP to both alliances.
- The Monte Carlo simulation never produces one.

The fix is three-way outcomes, but only where ties change downstream math, and it is "not an accuracy improvement".

## What was wrong (3.0.0)

- **Simulated quals never tied.** `sim.ts` draws continuous scores, so the RPs a tie pays (1 + 1) were always paid as a win and a loss instead (3 + 0 in 2025–26, 2 + 0 before).
  - That changes how RPs spread across teams.
  - From 2025 on, it also changes the total RP in play.
- **Expected RPs left ties out.** `bonus.ts` documented this: "the Gaussian model gives a tie no mass".
  - It stated winRP × p, where p, the served win probability, already counts a tie as half a win.

## Measured

Qualification matches, 2-robot alliances, rated events. Predictions are the served ones (`predictMatch` with the contextual model); the margin is final-score red − blue, Normal(mean difference, √(sd_red² + sd_blue²)).

| Season | Quals | Ties | Tie rate | Season-only width |
|---|---|---|---|---|
| 2019–20 | 13,421 | 190 | 1.42% | 1.358 |
| 2021–22 | 12,146 | 95 | 0.78% | 1.275 |
| 2022–23 | 21,716 | 157 | 0.72% | 1.052 |
| 2023–24 | 25,106 | 196 | 0.78% | 1.050 |
| 2024–25 | 28,885 | 221 | 0.77% | 1.233 |
| 2025–26 | 31,725 | 236 | 0.74% | 1.096 |

**One width, fitted on 2021–22 to 2024–25: w = 1.135 points.** P(tie) = w · the margin's density at 0.

Stated against observed tie rate (%) by closeness quintile, from least to most even, using that one width:

| Season | Q1 | Q2 | Q3 | Q4 | Q5 (most even) |
|---|---|---|---|---|---|
| 2022–23 | 0.26 / 0.30 | 0.57 / 0.48 | 0.79 / 0.74 | 0.99 / 0.83 | 1.29 / 1.27 |
| 2023–24 | 0.25 / 0.38 | 0.61 / 0.42 | 0.87 / 0.68 | 1.10 / 0.94 | 1.39 / 1.49 |
| 2024–25 | 0.15 / 0.28 | 0.44 / 0.40 | 0.69 / 0.61 | 0.95 / 0.90 | 1.30 / 1.64 |
| 2025–26 | 0.27 / 0.19 | 0.58 / 0.46 | 0.80 / 0.79 | 0.98 / 0.96 | 1.22 / 1.32 |

(The JSON's season keys are start years: 2019, 2021–2025. 2020–21 is left out, with 564 matches. Quintiles for 2021–22 are in the JSON.) The one width tracks the closeness gradient in every season. 2019–20 ties about twice as often; that game scored in coarser units.

**Win-and-tie RPs per alliance in 2025–26** (3 for a win, 1 for a tie; before 2025–26 a win paid 2, the same as two ties, so only the split changes):

| | Stated, 3.0.0 | Stated, 3.1.0 | Earned |
|---|---|---|---|
| All quals | 1.5000 | 1.4962 | 1.4963 |
| Most even fifth | 1.5000 | 1.4939 | 1.4934 |

## What changed (3.1.0)

- **`TIE_RULE.width = 1.135`.**
  - `tieProbability(margin, p)` = w · φ(mean/sd)/sd, capped at 2·min(p, 1 − p) so that P(win) and P(loss) never go negative.
- **Expected RPs:**
  - winRP · (p − P(tie)/2) + tieRP · P(tie) + bonus.
  - `MatchBonusOdds.pTie` carries the tie chance to the app, and the live RP view uses it.
  - Calls already in the ledger don't store it, so their RPs leave ties out. The difference is at most about 0.01 RP, and the screen shows one decimal.
- **Simulator:** a simulated qual whose final scores land within w/2 of each other is a tie (`SimInput.tieWidth`, set by the forecaster). Played matches keep their real results.
- **Headline win% is unchanged.** It is still "win, with a tie counted half", which is how every accuracy figure scores it. How it works now says so.

## Monte Carlo check (Part 11 delta re-run)

`npm run projections:replay -- 2025 --events 40 --runs 2000`: 40 finished 2025–26 events, cut at their midpoint, 2,000 simulations each. The input comes from the engine's own forecaster, so ties are on.

| | 3.0.0 | 3.1.0 |
|---|---|---|
| Final ranks inside the midpoint P10–P90 band | 958 / 1,098 (87.2%) | 958 / 1,098 (87.2%) |
| Mean P10–P90 width | 12.27 ranks | 12.25 ranks |
| Mean \|actual − median\| | 3.58 ranks | 3.58 ranks |

Ties leave the simulator's acceptance unchanged.

## Effect, stated honestly

This is small. One match in about 130 ties.
- Per call, expected RPs move by at most about 0.006 RP.
- In simulations, the standings of teams in close matches now get the 1 + 1 split real ties pay, instead of an arbitrary winner.
- No accuracy figure changes, and none is claimed.
