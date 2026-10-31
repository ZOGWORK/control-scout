# Partnership memory (engine 2.4)

When two robots in a lineup have really played together, or against each other, the
prediction says so. For example: "1234 and 5678 have played 6 matches together (5–1);
best 212 at NJ Championship (2024–25)". This page says how the history is built, what we
tested, and why 2.4 shows it as a reason without moving the odds.

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
  - Together: matches, W–L–T, the best final score together in their latest season
    together (scores of different games never compare) and where, and Σz.
  - Against: meetings, the lower number's W–L–T, and Σ of the margin residual
    (z_red − z_blue)/√2 from that side.
- **Shrinkage.** effect = Σ w·z / (Σ w + k), with w = decay^(seasons ago). With k = 4,
  two matches together at +1σ give an effect of 0.33. Ten matches give 0.71.
- **What is shown and shipped:** same-alliance pairs with at least 2 matches together,
  opponent pairs with at least 3 meetings, last seen within 6 seasons, whose teams both
  played in the newest season or the one before. Predictions ignore every other pair, so
  leaving them out of the table changes no answer.
- **What is remembered:** a weak pair (under those counts) is kept through the next
  season, so meeting again then counts every match. It is forgotten only after a whole
  season without reaching the count. Keeping every single meeting since 2019 would make
  the state about ten times larger.

## Held-out test

Walk-forward, the same protocol as the backtest ledger. Before each 2v2 non-tied match
from 2023–24 on, we take the served engine's prediction (2.1.1, from a book that has seen
only earlier matches) and the pair inputs (from every earlier match back to 2019–20).

    logit P' = logit P + βT · (effect(red pair) − effect(blue pair)) + βA · Σ effect(red i vs blue j)

| Step | Data | What was chosen |
|---|---|---|
| Fit β | 2023–24 (27,861 matches) | βT, βA for each (decay, k) |
| Select | 2024–25 (33,017) | decay ∈ {0, 0.25, 0.5, 1} × k ∈ {1 … 64} by log loss |
| Refit β | 2023–24 + 2024–25 | decay 1, k 64 → βT 1.557, βA 0.822 |
| **Held out** | **2025–26 (36,572 matches, 1,219 events)** | nothing |

2025–26 played no part in any partnership choice. The served 2.1 model it is compared
against is described in `prediction-engine-2.1-report.md`.

**Held-out result (95% intervals from 1,000 event-level bootstrap resamples):**

| | Served engine | + partnership | Change |
|---|---|---|---|
| Brier | 0.16911 | 0.16916 | **+0.000058 [+0.000004, +0.000127]** (worse) |
| Log loss | 0.50742 | 0.50750 | +0.000078 [−0.000051, +0.000256] |
| Accuracy | 74.83% | 74.77% | −0.055 pp [−0.097, 0.000] |

On the 23,575 held-out matches with any pair history, Brier went from 0.16642 to 0.16651.

On the select block, the best blend improved log loss by only 0.00018. Shrinkage
strength is not identified: once β rescales, every k from 4 to 64 ties within 0.00001
(the grid's largest k won by 0.00001).
The likely reason is that the ratings already absorb a pair's shared results. Within a
season, both robots' ratings learned from every match they played together, so the
leftover pair effect is mostly noise. Across seasons, robots are rebuilt.

**Decision.** 2.4 ships **reasons only**: `betaTogether = betaAgainst = 0`, and no served
number changes. The full backtest ledger replayed under 2.4.0 matches 2.3.0's bit for bit on
all 109,182 replayed matches, 2023–24 to 2026–27. That covers every served column: win %,
predicted scores, score ranges, bonus odds, tiers and factors. With β = 0, k and
decay only rank and word the fact. We use `k = 4`, which ties the fitted 64 on the select
block but keeps "above/below what their ratings expected" for pairs with a real sample,
and `decay = 0.5` (0.5 and 1 differ by 0.00002), which favours recent seasons in what is
shown.

### Second look under engine 3.2 (2026-10-30)

Since 2.4 the served engine has learned alliance overlap (2.11), event-local form (2.9) and regional
priors, any of which could absorb a pair effect or leave a cleaner one. `scripts/partnership-refit.ts`
asks again against today's champion, replayed exactly as `scripts/engine-slices.ts` replays it.

- **Protocol, rolling origin.** For each test season, (decay, k) is chosen and β fitted only on the
  seasons before it, on the same grid as 2.4. The 2.4 β was not reused.
- **Ship rule, fixed before running.** The pooled Δ Brier interval must lie below 0, and no test season
  may get worse.

| Test season | Trained on | Chosen | Served Brier | + pairs | Δ Brier [95%, event bootstrap] |
|---|---|---|---|---|---|
| 2024–25 (33,017) | 2023–24 | decay 0, k 1, βT 0.14, βA 0.10 | 0.15782 | 0.15771 | −1.06e-4 [−2.00e-4, −0.38e-4] |
| 2025–26 (36,572) | 2023–24, 2024–25 | decay 0.25, k 4, βT 0.42, βA 0.15 | 0.16814 | 0.16823 | **+0.82e-4 [+0.21e-4, +1.42e-4]** |
| Pooled (69,589) | | | | | −0.07e-4 [−0.22e-4, +0.26e-4] |

**Result: the rule fails, and 3.2 stays reasons-only** (β = 0, no served number changes).
- 2024–25 improved, but on 2025–26, with the choice made on the two seasons before it, the blend is
  significantly worse, just as it was against 2.1.1.
- The chosen settings are unstable: decay 0 vs 0.25, and β moves by a factor of 3 from one fold to the
  next. That is what a fitted noise term looks like.
- The pair signal the ratings don't already carry does not hold up out of sample.

Limits of this run:
- The database it ran on held 2023–24 onward only, so pair history before 2023–24 was missing.
  - The pair inputs, and so the fitted β and the chosen (decay, k), would differ with it. A fold that
    can see those seasons could choose differently.
  - The low decays chosen here (0 and 0.25) suggest old history counts for little. They don't bound how
    much the result could move.
  - So this run alone doesn't settle the question. It agrees with the 2.4 test, which did have
    2019–20 on and failed the same way. Rerun on a complete snapshot before any decision to ship;
    the script now refuses to run when a training season is missing.
- 2026–27 had no rated 2v2 matches in that database yet, so it was skipped. It is the one season no
  engine choice has seen. Rerun the script once 2026–27 has a few thousand rated matches; the same rule
  applies.

**Coverage.** 64.5% of held-out matches have some pair history, and 24.6% have two
robots on the same alliance that played together before.

## Where it shows

- **Control Scout.** Upcoming match details (event pages), the match report, and the
  Predict lab show one line below the factors. A call reads the table of its own season, so it
  never reads pairs from later matches: the current season's table is kept up to date, and
  each earlier season of the forecaster's window (a 2025–26 call while 2026–27 is current)
  has its own table, snapshotted at that season's end while the window replays, just as
  that season's ratings are its end-of-season ratings. Each snapshot keeps the pairs of teams
  rated that season or the one before; for the window's oldest season the season before isn't
  replayed, so its teams come from the database, and the snapshot matches what a forecaster
  anchored on that season builds. A season before the window gets its
  own forecaster, whose table ends with it. An earlier season that can still receive results
  (not yet frozen by the sync) keeps its weak pairs, so a fresh result at one of its events
  still counts a pair's one stored match; a frozen season leaves them out (about 3.5x fewer
  rows). A live call logged
  before its match stores the line with it (`predictions.history`, migration 40), so the
  logged call keeps the line it was shown with. The logged odds never depend on it.
- **Offline (Control Scout lite pack).** Phones download the lite pack at venues, and the
  history is a reason only, so the pack carries a small cut (`src/shared/litePairs.ts`):
  same-alliance pairs that played together at least 3 times this season or last. Each is
  pre-computed (record, best score and where, effect and ranking weight as of the pack's
  season) and delta-coded. The cut is 12,487 pairs, 142 KB gzipped; the full table would be
  961 KB. The lite pack goes from 2.86 MB without history to 3.00 MB.

  Offline loses head-to-head records, pairs with only 2 matches together, and pairs last
  together before last season. On real lineups (2025–26 matches asked as 2026–27 what-ifs)
  the server shows a fact on 83% of them and the device on 53%; 39% are word for word the
  same. Elsewhere the device shows its best kept fact, or none.
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
