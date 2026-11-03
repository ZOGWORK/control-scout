# Hand-check: can a reader reproduce every prediction number?

Research brief item 8 (Nov 2026): "every number a prediction surface shows carries its formula or its inputs,
visible on or next to the number." This walks every number the prediction surfaces show and asks one
question: from what is on the page (or one tap away: a tooltip, the factor sheet, a "How" link), can a reader
work the number out?

Verdicts:

- **pass**: the inputs and the formula are on or next to the number, and the arithmetic is doable by hand.
- **fixed**: it failed before this change; this PR (#PR) put the missing inputs or formula next to it.
- **open**: not reproducible by hand from the page. Either the number is a simulation or a fitted model with
  many inputs (it can be reproduced exactly with the published engine, `packages/predict-engine`, and its
  `model.json`, but not with a pencil), or the inputs it needs aren't stored. Listed as follow-ups below; none
  of them is a small change.

No engine number changed. Engine 3.3.0 throughout.

## The table

| # | Number | Where it shows | Formula / inputs shown | Verdict |
|---|---|---|---|---|
| 1 | Win probability | Match drawer, Lab, Know your match, match rows, live panel, pit display | Factor sheet: every factor's share of the call (game phases split the margin exactly; win-model inputs grouped). Methodology #matches: two score curves → probability, Engine 2.0 correction (22 inputs), Platt-style recalibration slope. Calibration line: how often calls at that level came true. | **open**: the shares explain the call, but turning them into the exact % needs the 22 fitted coefficients (model.json). Reproducible with the engine, not by hand. |
| 2 | Predicted score (alliance) | Lab | **New:** "Predicted score = robots' Adds − overlap + the other side's Pen", written out per alliance with its numbers (`(72.4 + 51.0) − 6.1 + (2.0 + 1.5) = 119`), and a Pen column in the ratings table. The overlap loss now comes with the answer (`overlapRed/overlapBlue`). | **fixed** |
| 3 | Predicted score (alliance) | Match drawer, Know your match (a stored call) | The score only. The robots' ratings at the time of the call aren't stored with it; today's ratings (team pages) have moved on. | **open**: needs the call's per-robot strengths stored in the ledger. |
| 4 | Predicted margin | Match drawer, Lab | **New:** "Red by 12 (118 − 106)" next to the scores. The factor sheet's game phases split the same margin exactly. | **fixed** (was implicit: two scores, no margin) |
| 5 | Score range (±, 80%) | Every predicted score | Tooltip: the range's bounds and what 80% means. Methodology #ranges and #matches: σ = a + b·expected, widened by rating uncertainty, small sample, per-team consistency, playoff factor. Lab shows each robot's rating ± and match count. | **open**: the per-team consistency factor and the band scale aren't shown next to the range. Reproducible with the engine. |
| 6 | Confidence tier | Every prediction (badge) | Badge reason names the rule's input ("least-known robot has 4 matches"); the rule (`CONFIDENCE_RULE`) is on the methodology page. | **pass** |
| 7 | Rating (points a robot adds, ±) | Team page, Lab ratings table, team card | Tooltip defines it; methodology #rating has the update rule with the gain curve, carry-over and uncertainty. | **open** by nature: an online rating folds in every match in order. The gain and the update are shown with a worked example (methodology), but no reader replays a season by hand. |
| 8 | Phase factors ("auto is worth about 14 more points") | Why list, factor sheet | Each is a difference of the robots' phase ratings (less overlap in quals); the Lab table shows Auto/Tele/End per robot. | **pass** (Lab); match drawer as #3 |
| 9 | Factor shares (%) | Factor sheet | Each factor's share of the call's log-odds; shares add to 100%. | **open**: the per-input log-odds aren't shown, only their shares (same as #1). |
| 10 | Bonus RP chances | Match drawer, Lab, Know your match | From each alliance's likely score this season (footnote); model on methodology #bonus. | **open**: the bonus model's curve isn't shown next to the chance. |
| 11 | Expected RP | Bonus card | Footnote: 3 × win chance + 1 × tie chance + each bonus chance. | **open**: the tie chance isn't shown (and stored calls don't keep it), so the sum can't be checked. Follow-up below. |
| 12 | Projected rank (median, 80% range) | Event odds: Projections | Column tooltip: median and 10th–90th percentile of N simulations; run count and time in the header. | **open** by nature (Monte Carlo, seeded: the same engine and results give the same numbers). |
| 13 | Playoff / advance odds | Projections, Advancement, Rankings tab column | Share of N simulations; advancement points breakdown (quals, alliance, playoffs, awards averages) shown in Advancement. | **open** by nature (simulation). |
| 14 | Simulated rankings (before quals) | Rankings tab | Average rank and 80% range over N simulations. | **open** by nature (simulation). |
| 15 | Series call | Playoffs tab | **New:** "Best of 3, from 62% each game" under a best-of-N series: the series chance follows from the one-game playoff call (p²(3 − 2p) at 0–0). A single-match series is the game chance itself. | **fixed** |
| 16 | Championship / reaches-final odds, danger match | Playoffs tab | Share of bracket simulations over the posted bracket; measured accuracy line under it. | **open** by nature (simulation over the series calls). |
| 17 | Model vs field gaps | Rankings tab | Footnote states every threshold (min matches, min gap, z × combined uncertainty). | **pass** |
| 18 | Reliability index | Team page, Compare, pick lists | Parts shown (no-shows, DQs, near-zero, swing, penalties, predictability); weights and shrinkage on methodology #reliability. | **pass** |
| 19 | Report card (called right, vs prediction, swing) | Team page | Raw and shrunk values side by side, prior size stated; formula on methodology #report-cards. | **pass** |
| 20 | Track record: accuracy, Brier, skill, log loss | Methodology #accuracy, home | Definitions and the coin-flip baselines next to each; live and replay apart. | **pass** |
| 21 | Track record: margin error | Methodology #accuracy | **New** (brief item 3): mean \|predicted margin − real margin\|, with the always-0 baseline and qualifiers/playoffs apart, labelled live or replay. | **pass** (new number) |
| 22 | Calibration line ("calls near 63% came true 65%") | Under each call | Names its source (live calls or replay) and the count. | **pass** |
| 23 | Range coverage | Methodology #ranges | Share inside, below, above, mean width, by tier. | **pass** |

Counts: **pass 9** (6, 8, 17, 18, 19, 20, 21, 22, 23), **fixed 3** (2, 4, 15), **open 11** (1, 3, 5, 7, 9,
10, 11, 12, 13, 14, 16). Of the open ones, 6 are open by nature (a seeded simulation or an online rating:
reproducible with the engine, never by hand), and 5 are fixable with more shown or stored inputs (follow-ups).

## What each prediction surface now says about quals and playoffs (brief item 7)

Every fact below was checked in code before it was written (src/shared/predictionBasis.ts lists where):

- Ratings learn from every played match of a rated event, quals and playoffs (server/stats/load.ts
  `toEventRecord`); a playoff result updates them at `playoffWeight` = 0.5 (packages/predict-engine/src/rating.ts).
- The alliance overlap cut (2.11) is for 2-robot qualification alliances only (`allianceOverlap`; sim.ts).
- Playoff score ranges multiply the game-noise variance by `band.playoff` = 0.72 (matchModel.ts).
- The win model has a playoff input (contextual D8).
- Bonus RP odds are for qualification matches only and fitted on qualification alliances (bonus.ts).
- Simulations draw each robot's strength once per run, never updated inside the run; simulated playoffs use
  the playoff settings; a 3-robot alliance fields its two strongest.

| Surface | Line |
|---|---|
| Match drawer (event, team, predict lists), Know your match, Lab, factor sheet | Quals: "Learned from every played match, quals and playoffs; a playoff result counts half." Playoffs: "Playoff call: the same ratings (a playoff result counts half), but partners add up in full, the score range is tighter and there are no bonus RPs." |
| Projections, Advancement, Simulated rankings | "Simulated from current ratings, learned from quals and playoffs (a playoff result counts half). Simulated playoffs add partners up in full and draw tighter scores." |
| Bracket odds | "Each series uses the playoff call: the same ratings (a playoff result counts half), partners added up in full." |

Each ends with a "How" link to the new methodology section, /methodology#quals-playoffs. Phone tables
(match rows, projections table) are unchanged: the line sits under the call or in the card's footer.

Not given their own line: the live panel, Watch live, the pit display and video predictions. They are tight,
glanceable surfaces; each links to the match, whose drawer carries the line.

## Open follow-ups

1. **Store each call's robot strengths** (np, pen, phases, overlap) in the ledger, so a stored call's
   predicted score can be written out like the Lab's (#3). Needs a migration and the Control Point ledger to
   match; not small.
2. **Show the tie chance** on the bonus card and store it with each call (`pTie`), so expected RP adds up by
   hand (#11). A ledger column plus the bonus view; small-to-medium.
3. **Exact log-odds in the factor sheet**: each win-model input's value × coefficient, and the logistic +
   recalibration step, so the % can be reproduced (#1, #9). A presentation change on top of the engine's
   existing sheet, but a dense one; needs a design that stays low-reading.
4. **Score range parts**: show the σ parts (game noise, rating uncertainty, consistency, small sample, playoff
   factor) next to a range in the Lab (#5). The engine returns `gameVar`/`ratingVar`; the view doesn't carry them.
5. **Bonus model curve** next to each bonus chance (#10).
