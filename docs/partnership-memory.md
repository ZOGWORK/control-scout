# Partnership memory (engine 2.2)

When two robots in a lineup have really played together, or against each other, the
prediction says so. For example: "1234 and 5678 have played 6 matches together (5–1);
best 212 at NJ Championship (2024–25)". This page says how the history is built, what we
tested, and why 2.2 shows it as a reason without moving the odds.

## The pair table

Code: `packages/predict-engine/src/partnership.ts`. Fit and evaluation:
`scripts/partnership-fit.ts`.

- **Source.** Every rated match from 2019–20 on (official in-person events; scrimmages,
  remote and hybrid events are left out, as in the ratings).
- **One scale for every game.** Before each match, a rating book that has seen only
  earlier matches gives each alliance an expected non-penalty score. The alliance's
  residual is standardized by the model's score noise:
  z = (actual − expected) / σ, clipped to ±4. A DECODE point is never compared with a
  CENTERSTAGE point; only how far a result ran from expectations is.
- **Per pair:**
  - Together: matches, W–L–T, the best final score together and where, and Σz.
  - Against: meetings, the lower number's W–L–T, and Σ of the margin residual
    (z_red − z_blue)/√2 from that side.
- **Shrinkage.** effect = Σ w·z / (Σ w + k), with w = decay^(seasons ago). With k = 4,
  two matches together at +1σ give an effect of 0.33. Ten matches give 0.71.
- **Pruning** (applied at each season's end and when serializing):
  - same-alliance pairs with fewer than 2 matches together are dropped;
  - opponent pairs with fewer than 3 meetings are dropped;
  - pairs last seen more than 6 seasons ago are dropped;
  - the shipped table keeps only pairs whose teams both played in the newest season or
    the one before.

  Predictions ignore exactly the dropped pairs, so pruning changes no answer.

## Held-out test

Walk-forward, the same protocol as the backtest ledger. Before each 2v2 non-tied match
from 2023–24 on, we take the served engine's prediction (2.1.1, from a book that has seen
only earlier matches) and the pair inputs (from every earlier match back to 2019–20).

    logit P' = logit P + βT · (effect(red pair) − effect(blue pair)) + βA · Σ effect(red i vs blue j)

| Step | Data | What was chosen |
|---|---|---|
| Fit β | 2023–24 (27,861 matches) | βT, βA for each (decay, k) |
| Select | 2024–25 (33,017) | decay ∈ {0, 0.25, 0.5, 1} × k ∈ {1 … 64} by log loss |
| Refit β | 2023–24 + 2024–25 | decay 1, k 4 → βT 0.223, βA 0.122 |
| **Held out** | **2025–26 (36,572 matches, 1,219 events)** | nothing |

2025–26 played no part in any partnership choice. The served 2.1 model it is compared
against is described in `prediction-engine-2.1-report.md`.

**Held-out result (95% intervals from 1,000 event-level bootstrap resamples):**

| | Served engine | + partnership | Change |
|---|---|---|---|
| Brier | 0.16911 | 0.16919 | **+0.000083 [+0.00002, +0.00016]** (worse) |
| Log loss | 0.50742 | 0.50757 | +0.000155 [−0.000002, +0.00036] |
| Accuracy | 74.83% | 74.78% | −0.05 pp [−0.09, +0.01] |

On the 25,202 held-out matches with any pair history, Brier went from 0.16779 to 0.16791.

On the select block, the best blend improved log loss by only 0.00024. Shrinkage
strength is weakly identified: once β rescales, every k from 4 to 64 ties within 0.00001.
The likely reason is that the ratings already absorb a pair's shared results. Within a
season, both robots' ratings learned from every match they played together, so the
leftover pair effect is mostly noise. Across seasons, robots are rebuilt.

**Decision.** 2.2 ships **reasons only**: `betaTogether = betaAgainst = 0`, and no served
number changes. The full backtest ledger replayed under 2.2.0 matches 2.1.1 bit for bit on
all 109,002 replayed matches from 2023–24 to 2025–26. `k = 4` (fitted) and
`decay = 0.5` only rank and word the fact. The fitted decay (1) tied 0.5 on the select
block; 0.5 favours recent seasons in what is shown.

**Coverage.** 69% of held-out matches have some pair history, and 21% have two robots on
the same alliance that played together before.

## Where it shows

- **Control Scout.** Upcoming match details (event pages), the match report, and the
  Predict lab show one line below the factors. The offline lite pack ships the table
  (`partnerships`), so offline calls carry the same line. The table only appears with the
  season it was built through, so a call never reads pairs from later matches.
- **Control Point.** Predict → Matches shows the line under upcoming matches, from the
  same engine (`ForecastMatch.history`). The region offline pack carries the pairs between
  its teams.

## Server notes

The seasons before the forecaster's window are the "prefix": legacy seasons plus
2023–24 for the current window. They are built once into kv
(`partnership:prefix:<season>`, with the whole PartnershipBook state). The key covers
every season's sync stamp, so a resynced season rebuilds the prefix. The stats job builds
it before the forecasters rebuild. A forecaster that rebuilds while the prefix is missing
goes ahead with its window's pairs only, never waiting; the next rebuild has the full
history.
