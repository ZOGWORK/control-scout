# Changelog

## 2.7.0 — 2026-10-22 · Priors: regional starts

Engine improvement program, Part 8 (priors). The slice report (`docs/engine/slices`) found the most
excess error in thin-data matches: robots at their first event of the season, the first ten
qualification matches of an event, robots with five or fewer rated matches. This release changes
where a team new to the season starts. Nothing else moves.
- **Regional prior offsets** (`RatingParams.regionKappa`, `regionFreezeN`; `MatchRecord.region`).
  Each region keeps, per phase, the summed lift of its returning teams this season: their rating
  after `regionFreezeN` (3) rated matches minus the prior they were given. A team new to the season
  starts from its prior plus its region's lift so far, divided by (teams measured + `regionKappa`).
  The region is that of the event where the team first plays: `MatchContext.region` when it is
  predicted before any result (`RatingBook.withRegion`; `predictMatch` and `explainMatch` apply it,
  and `Forecaster` passes `regionOf(event)` for forecasts, match odds and partner what-ifs), and
  `MatchRecord.region` when its first result is folded in, judged against that same starting point.
  Only returning teams teach it, so a season where no team has history is unchanged. Off when `regionKappa` is 0 (the default);
  `FITTED_MODEL.rating.regionKappa` is 20. State: `RatingBookData.regions` (lifts and the returning
  teams not yet measured), kept by `clone`, `toData` (subsets keep every region's lift) and
  `fromData`; a book without it starts with no lifts. `RatingBook.regionOffset(region)` returns the
  offset a newcomer would get now.
- **Carry-over** `rho1` 0.6 → 0.7 (last season's z-score).
- `parseScoutEventRecord` and `Forecaster`'s live fold set `MatchRecord.region` (the event's region),
  so both apps' books learn the same offsets from the same results.
- `RatingParams.carryAuto` / `carryTeleop` / `carryEndgame` (per-phase carry-over shares, default 1)
  exist but stay at 1: lowering endgame carry-over, which the season-to-season fits suggested,
  made every slice worse.

**Evidence** (Control Scout snapshot 2026-10-14, paired replay against 2.6.0 on identical matches,
`scripts/engine-slices.ts --challenger`, 95% intervals from resampling whole events; report in
`docs/engine/gates/gate-2.7.0-priors-snapshot-2026-10-14.md`):

| Season | Matches | Brier change ×10⁴ | First-event robots | Thin data | Accuracy | 50–80% calibration error |
|---|---|---|---|---|---|---|
| 2023–24 (cold start: no history) | 28,075 | 0 (bit-identical) | 0 | 0 | same | same |
| 2024–25 (tuning) | 33,271 | −3.29 [−4.50, −2.06] | −6.12 [−8.69, −3.48] | −6.85 [−10.43, −3.48] | +0.08 pp | 1.45 → 1.32 pts |
| 2025–26 (reused) | 36,842 | −2.37 [−3.47, −1.29] | −4.70 [−7.15, −2.41] | −3.62 [−6.83, −0.53] | −0.01 pp | 1.95 → 1.64 pts |

- Log loss improves in both seasons, and no slice's Brier gets worse beyond noise.
- The settings sit on a flat region (κ 10–40 give the same numbers within noise), chosen on 2024–25. The research and tuning scripts are `scripts/part8/`.
- Accuracy doesn't move: this is a probability-quality change, not a winner-calling one.
- 2025–26 has been examined before (2.0, round 2, 2.1), so it isn't independent proof. The live
  ledger, which now records 2.7 calls, is the prospective test.

## 2.6.0 — 2026-10-21 · Event simulator follow-ups

Simulator only: every match prediction (win probability, scores, ranges, factors, tiers, bonus odds)
is bit-identical to 2.5.0. Event simulations (advancement odds, partner what-ifs, projections) move.
- **Per-team score variance in `simulateEvent`.** `SimInput.variance` (per robot: the variance
  factor and matches played, as `teamScoreVariance` reads them) and `SimInput.band`. With them, each
  simulated alliance score's game noise is `gameVariance(mean, consistency, fewest matches, noise,
  band, context)`: the game-noise part of the 2.2 score ranges (scale, per-team consistency,
  small-sample and playoff factors), now exported from `matchModel.ts` and shared by both. Rating
  uncertainty is still drawn once per run per robot, so it isn't counted twice. Without `variance`
  the simulator draws σ = a + b·mean exactly as before. `Forecaster` fills both from its book and
  `model.band`.
- **No hindsight in bonus draws.** `Forecaster` simulations take the bonus model from
  `bonusModel(season)` instead of the shipped `model.bonus`, so a forecaster that overrides it for
  a past moment with `bonusModelBefore` (Control Scout's "Before the event" and its projections'
  pre-event baseline) draws bonus RPs only from a fit on qualification results played strictly
  before the event start, with no shipped-fit fallback. When that is null, a pre-event simulation
  earns no bonus RPs and adds an assumption saying so. An app that serves its own season fit
  (both apps do) now simulates with the same curve its match cards show; the default `bonusModel`
  is still the shipped fit.
- **`Forecast.bonusDraws`** (`BonusDraws`): how the forecast's simulation drew bonus RPs:
  `"model"`, `"event"` (this event's recorded results), `"none"`, or null when they don't matter
  (no bonus RPs that season, or quals over). Apps drive any "bonus RPs aren't modelled" flag from
  it instead of from which shipped fits exist.

**Evidence** (Control Scout snapshot, 2025–26):
- Midpoint replay (`npm run projections:replay`, 40 finished events, 2,000 sims, ratings frozen at
  the start plus the first half): actual final ranks inside the projected P10–P90 band
  941 / 1,098 = 85.7% on 2.5.0, 949 (86.4%) with the bonus fix only, **951 (86.6%)** with both.
  Mean band width 12.14 → 12.28 ranks, mean |actual − median| 3.59 → 3.60.
- Test fixture (4 championships, 10,000 sims): 128 / 156 (82.1%) on 2.5.0, 134 with the bonus fix
  only, **133 / 156 (85.3%)** with both.
- Timing, 10,000 sims through the projections core (median of 5, interleaved): 36-team events
  1.8–3.5 s with per-team variance against 2.1–4.6 s without, the 48-team BRCMP 3.6 s against
  3.3 s: within machine noise, far under the 10 s budget.
- Held-out backtest (`npm run stats -- --backtest`, same snapshot copy for 2.5.0 and 2.6.0): all
  109,182 replayed match calls are bit-identical in every column but engine_version (p_red, means,
  tier, factors, ranges, shadow, bonus, history). Only the records' pre-event advancement odds move.
  Their Brier against who actually advanced: 2023–24 0.13302 → 0.13299, 2024–25 0.13385 → 0.13356,
  2025–26 0.12916 → 0.12919 (log loss 0.40782 → 0.40780); all three seasons 0.13174 → 0.13165.

## 2.5.0 — 2026-10-21 · Reasons

Reasons only: no probability, score, range, factor or tier changes (every number is bit-identical to 2.4.0).
- `ExplainOptions.recent(team)` takes a robot's recent record as the app measured it
  (`RecentRecord`: latest matches, no-shows, near-zero matches). Control Scout feeds it from its
  reliability index (public match data only).
- `MatchExplanation.reasons`: notable sentences beyond the factors, by `REASON_RULE`:
  2+ no-shows in the window ("Team 1234 was a no-show in 2 of its last 10 matches"), else
  3+ near-zero matches, worded as an estimate (defense or a partner's carry looks the same).
  Empty without `recent`, or when nothing is notable.
- `recentReasons(teams, recent)`: the same sentences for a lineup on their own, for apps that build their
  own match rows (Control Point's forecast matches) and want the reasons without an explanation.


## 2.4.0 — 2026-10-21 · Partnership memory

**No served number changes** (the numeric blend is off: see "Evidence"). New:
- `partnership` module: a pair table of real results from 2019–20 on. For two robots on the
  same alliance it keeps matches, W–L–T, and the best final score together in their latest
  season together (scores of different games never compare) and where. For two
  opponents it keeps the meetings and the record. Each alliance result is turned into a
  standardized residual against a rating book that has seen only earlier matches, so
  seasons with different games share one scale. A pair's effect is shrunk toward zero
  (Σ w·z / (Σ w + k)) and older seasons are down-weighted (decay^seasons ago).
  - `PartnershipBook` accumulates the table walk-forward and carries its own rating book.
    It serializes with `toState`/`fromState` (resume after the finished seasons) and
    `toData` (the compact, pruned table for offline packs).
  - `PartnershipTable` reads that data. It holds pairs with at least `minMatches` (2
    together) or `minMeetings` (3 against), seen within `maxSeasonsAgo` (6); predictions
    ignore every other pair. The book keeps a weak pair through the next season, so a
    later meeting counts every match, and forgets it after a whole season idle. `toData({ keepWeak })`
    keeps those weak pairs for a table that folds in fresh results (the server's).
  - `partnershipFact` gives the strongest fact for a lineup in words, for example
    "1234 and 5678 have played 6 matches together (5–1); best 212 at NJ Championship (2024–25)".
- `explainMatch(..., { partnership })` returns `partnership` (the fact, or null).
  `predictMatch(..., { partnership })` applies `partnershipShift`, which is 0 under
  `PARTNERSHIP_PARAMS` (β = 0).
- `Forecaster.partnerships(season)` is a hook apps override. When it returns a table,
  `ForecastMatch.history` carries the fact for unplayed matches. The event's fresh results (the
  ones the forecaster folds into its ratings) are folded in too, through `PartnershipOverlay`, so a
  rematch shows its record as of now. `EventInput.name` (optional) names that event when a fresh
  result becomes a pair's best.

**Evidence (walk-forward, Control Scout `scripts/partnership-fit.ts`, report in
`docs/partnership-memory.md`).** Pairs from 2019–20 on; predictions from 2023–24. β was
fitted on 2023–24, (decay, k) chosen on 2024–25 by log loss, and β refitted on both.
On held-out 2025–26 (36,572 non-tied 2v2 matches, 1,219 events, never used for any
choice), the blend made the odds slightly worse:
- Brier 0.16911 → 0.16916 (+0.000058, 95% event-bootstrap interval [+0.000004, +0.000127]);
- log loss 0.50742 → 0.50750;
- accuracy 74.83% → 74.77%.

2.2 therefore ships the history as a reason only (`betaTogether = betaAgainst = 0`). The
selected shrinkage was k = 64 with decay 1, but k is not identified: once β rescales, k from
4 to 64 tie within 0.00001 on the select block. The shipped k = 4 and decay 0.5 only rank
and word the fact. In the walk-forward, 64.5% of held-out matches have some pair history
and 24.6% have a same-alliance pair.

## 2.3.0 — 2026-10-21 · Bonus ranking point odds per match

**New output; no existing number changes.** Win probabilities, scores, ranges, factors,
confidence and event simulations are bit-identical to 2.2.0 (the new code only runs when a
caller passes `ExplainOptions.bonus`, or adds `ForecastMatch.bonus` beside the existing
fields). Replayed 2023–24 to 2026–27 with 2.2.0 and 2.3.0, all 109,182 calls match exactly:
win probability, shadow probability, expected scores, tier and score ranges.

- `bonus.ts`: `bonusProbability(coef, mean, sd)` is the event simulator's bonus draw
  (logistic of the alliance's non-penalty score, score ~ Normal floored at 0) integrated
  exactly instead of sampled; `allianceBonusOdds` adds the season's win RPs
  (`winRankingPoints`, as `rankingPoints` counts them) for expected ranking points.
- `fitBonusModel(samples)`: per-bonus logistic regression on non-penalty score (the form of
  `FITTED_MODEL.bonus`), Newton's method with one pseudo-success/failure and a unit ridge on
  the standardised slope, so a bonus every alliance (or none) earns stays finite.
- `recentBonusModel` / `seasonBonusModel`: fit to the season's latest `BONUS_WINDOW` (2,000)
  qualification alliances once there are `BONUS_MIN_SAMPLES` (200); before that, the shipped
  fit if the season has one. Bonus difficulty drifts through a season.
- `explainMatch(..., { bonus: { season, model } })` returns `bonus: { A, B, confidence,
  source, samples }`: per-alliance odds and expected RPs, with the match's tier capped by
  `BONUS_CONFIDENCE_RULE` (provisional under 600 alliances, at most moderate under 2,000).
- `Forecaster.bonusModel(season)` (apps override it with their stored season results; the
  default uses the shipped fit) and `ForecastMatch.bonus` (`MatchBonusSummary`): every
  unplayed 2-against-2 qualification match of an event forecast carries its bonus odds,
  expected RPs and tier, so each app's match list shares the one implementation.
- `bonusModelBefore(matches, beforeMs)`: the bonus model as it stood at a past moment (only
  qualification results before it, never the shipped whole-season fit). A forecast of a
  past moment ("before the event") overrides `bonusModel` with it, so its bonus odds carry no
  hindsight.
- `BonusHistory`: a season's results in time order, answering "the model as it stood at t"
  with one rule (only matches that started strictly before t; a same-time result wasn't
  known yet). `bonusModelBefore` and walk-forward replays both use it.
- **Evidence (2025–26 season replay, walk-forward: each call fitted only on earlier
  results; 212,496 alliance-bonus calls on 35,416 qualification matches).** Brier per bonus
  call: latest-2,000 window **0.1448**; every alliance so far 0.1597; the shipped
  whole-season `FITTED_MODEL.bonus["2025"]` 0.1781; always saying each bonus's realised
  rate (hindsight) 0.1680. Integrating over the score spread beat the point estimate
  (0.1597 vs 0.1653 on the all-so-far fit). Not yet measured live.
## 2.2.0 — 2026-10-21 · Score ranges

**Score ranges (changes numbers: the ranges only).** Win probabilities and expected scores
are bit-identical to 2.1.1; only the stated range around each expected score changes.
- Each alliance's range now comes from its own predictive distribution,
  Normal(mean, bandSd²), with
  `bandSd² = (a + b·mean)² · scale · consistency^power · (1 + smallSample / (n + 1)) · [playoff] + rating · Σ rating uncertainty`.
  `consistency` is the alliance's average **per-team variance factor**: each robot's EMA
  of squared standardized residuals, already kept in the reliability state (1 = as variable
  as the model assumes). `n` is the fewest matches any of its robots has played this
  season, so ranges widen for small samples and for erratic robots.
- New `FITTED_MODEL.band` / `DEFAULT_BAND`: level 0.8, scale 1.1, consistencyPower 0.3,
  smallSample 0.7, playoff 0.6, rating 0.75. Fitted on 2024–25 by the 80% interval
  score (a proper scoring rule for ranges), tested on 2025–26.
- New API for consumers that sample scores (e.g. a Monte Carlo simulator):
  `allianceScoreDistribution(book, own, opp, noise, band, context)` →
  `{ mean, sd, gameVar, ratingVar, consistency, minMatches }`; `teamScoreVariance(book, team)`;
  `scoreBand(mean, sd, level)`; `zFor(level)`. `AlliancePrediction.band`,
  `ForecastMatch.redBand`/`blueBand`, `MatchExplanation.scoreBandA/B` and
  `scorePlusMinusA/B` ("118 ± 14"), `TeamStrength.consistency`. `PredictOptions.band` /
  `ExplainOptions.band` override the band; `AlliancePrediction.sd` (behind the win
  probability) is unchanged.
- **Evidence (walk-forward replay, 2025–26 held out, 82,532 alliance scores):**
  - 80% interval score 147.91 → 145.95 (lower is better); also better on 2023–24
    (122.02 → 121.20);
  - coverage 80.8% → 82.4% overall, and far more even across groups: robots with no
    prior match this season 69.4% → 79.9%, erratic alliances (variance factor ≥ 1.3)
    74.4% → 79.8%, playoffs 86.6% → 78.4%;
  - mean width 94.4 → 96.9 points;
  - win accuracy, Brier and log loss unchanged (identical probabilities).

## 2.1.1 — 2026-10-17

No served number changes. This release adds side-by-side evidence:
- `PredictOptions.shadow` and `ExplainOptions.shadow` evaluate a second contextual
  model on the same book, lineup and context, and return it as
  `pShadow`/`shadowModelId` (`explainMatch(...).shadow`).
- The Forecaster logs the served model's fallback as the shadow:
  `ForecastMatch.pShadow`/`shadowModelId`, which is 2.0 under 2.1.
- Apps store both probabilities with every pre-match call. Future live results can then
  compare versions on identical matches and identical information, instead of comparing
  different versions on different matches.
- The 2.1 validation claims are corrected in Control Scout's
  `docs/prediction-engine-2.1-report.md` (clean forward re-evaluation).

## 2.1.0 — 2026-10-17 · Prediction Engine 2.1

From the round-2 experiments (protocol registered before any candidate was scored;
report in Control Scout `docs/prediction-engine-2.1-report.md`).

**Win probability (changes numbers).**
- The contextual model gains five inputs from a richer per-robot state:
  - in-event form: clipped residuals summed at the current event, shrunk by n + 2;
  - L × log(1 + fewest matches any robot has played at this event);
  - momentum: a fast residual EMA (α 0.5) minus the slow bias proxy;
  - whether each robot's last alliance collapsed;
  - matches since the last collapse.
- All 22 coefficients were refitted with the research learner on the same blocks
  as 2.0 (fit: 2023 plus 2024 before 2025; select: Jan–Feb 2025; calibrate:
  Mar–May 2025), on 2.0's symmetric-population ratings. The parameter set is
  `ctx-rel-form-2026-10-17-1fdd2958`.
- `MatchContext.event` (the match's event code) feeds in-event form. A generic
  what-if has none, so it reads no in-event form.
- **Fallback:** the frozen 2.0 model ships as `FITTED_MODEL.contextual.fallback`.
  Books carrying 2.0 state (`stateVersion` 1) predict with it rather than with the
  legacy probability. Results carry `modelId`, `probabilityModelId` and
  `ForecastMatch.modelId`.
- **Evidence (historical replay, not live). Superseded:** these figures are a development
  comparison. The select block was judged after calibrating on later (Mar–May 2025) outcomes,
  and 2025–26 results were used to veto candidates. A forward-only re-evaluation (2.1.1
  report correction) finds better Brier in both seasons (−0.00057 and −0.00048, intervals
  below 0), an accuracy change of +0.17 / +0.06 pp with intervals including 0, and
  calibration about equal to 2.0's.
  - select: +0.22 pp accuracy [+0.01, +0.42], Brier 0.15358 → 0.15313;
  - 2025–26 (secondary, already examined): +0.19 pp [+0.05, +0.33], Brier
    0.16842 → 0.16804, log loss 0.5102 → 0.5093;
  - 10-bin calibration error **worsens**: 1.01% → 1.16% (select) and
    1.26% → 1.67% (2025–26).
  - The built package reproduces the evaluated model to 4.4e-16 on every 2025–26 match.

**State.** Reliability state version 2 adds `fast`, `lastFail`, `sinceFail`,
`eventCode`, `eventSum` and `eventN`. Versions 1 and 2 load; anything else is
treated as legacy.

**Official rules (correctness).**
- Per-team disqualification (T601): `AllianceInput.teams[].dq`. In a played
  qualification match, a disqualified team scores 0 ranking points and 0 for every
  sort criterion; the match still counts and its partner is unaffected.
- DECODE (2025) qualification sort (Table 13-1, archived TU32): average non-foul
  points, then average BASE points (the 2025 endgame), then average AUTO.
- BIOBUZZ TIPS: `ScoreSplitInput.tips` feeds the second Table 13-1 criterion.
  Unreported TIPS count 0.
- FTC Scout 2026 query and parser: they asked DECODE fields of
  `MatchScores2026Alliance`. They now request park points (the endgame),
  swarm / pollinator 1 / pollinator 2 RPs and tips.

## 2.0.0 — 2026-10-16 · Prediction Engine 2.0

Validated in the FTC prediction validation package (frozen 16 Oct 2026) and
reproduced from this package's own build (see "Evidence" below).

**Win probability (changes numbers).**
- New `contextual` module: a frozen residual logistic model (17 inputs) on
  top of the score model's *raw* Gaussian win probability, with its own final
  calibration. Inputs: auto / endgame / penalty balance, partner spread,
  experience, days since each robot's last match, rating uncertainty,
  qualification vs playoff, and three reliability proxies per robot.
  Coefficients fitted on 2023–24 + 2024–25, selected on Jan–Feb 2025,
  calibrated on Mar–May 2025, frozen before 2025–26 was evaluated.
  `FITTED_MODEL.contextual` holds the full-precision parameters (id
  `ctx-rel-2026-10-16-1a36820c`). Score means, ranges, ratings, gains,
  growth and noise are unchanged.
- `predictMatch(…, cal, { context, contextual })` and
  `explainMatch(…, { context, contextual })` use it; results say which model
  produced the odds (`model` / `probabilityModel`: `contextual` | `legacy`).
  Without `contextual`, or with a book that has no reliability state, the
  1.1.0 Platt-calibrated probability is returned. `context.level` defaults to
  `"qual"` (the documented what-if default). The Forecaster passes each
  scheduled match's level; `Forecaster.match(season, red, blue, ctx)`.
- The event simulator still generates outcomes from sampled scores: it does
  not use the new probability, so event, rank and advancement odds do not
  inherit the match-level gain (and simulated winners always agree with
  simulated scores).

**Reliability state (new serialized state).**
- `RatingBook` keeps, per team and season, EMAs of the alliance's
  standardized residual (bias), squared residual (variability) and
  "scored under half of an expected ≥40 points" (failure proxy), learned in
  `update()` from the expectation held *before* the result. Reset at
  `startSeason`; copied by `clone()`; written by `toData()` as
  `reliability` + `stateVersion: 1`. These are alliance-level proxies, not
  observed robot failures.
- Legacy data (`fromData` without `stateVersion: 1`) sets
  `reliabilityReady = false`: predictions fall back to the 1.1.0 probability
  instead of inventing a history, and such a book never writes partial state.
  Rebuild the ratings (replay the seasons) to get 2.0 odds.

**Population baseline (correctness, changes numbers slightly).**
- Both alliances of a match now update the population baseline together
  (`populationUpdate: "symmetric"`, the default); the season's first match
  seeds it with their mean. Before, which alliance was listed first changed
  every newcomer's prior (a colour swap moved it from ~97 to ~27 points).
  `"sequential"` reproduces 1.1.0 exactly.

**Recorded bonus RPs (correctness).**
- `ScoreSplitInput.bonusRp` and `Forecaster.recordedBonus()` (app hook)
  carry recorded bonus ranking points into live forecasts. Played matches
  keep them as facts; the old score-threshold guess is gone. Unreported
  flags are sampled every simulation run from the season's bonus model;
  seasons with no fitted model (BIOBUZZ so far) draw unplayed alliances'
  bonus RPs from the event's own recorded results (`SimInput.bonusSamples`).
  Assumptions say which applies.

**Official rules (correctness; checked against the BIOBUZZ manuals).**
- Advancement order on equal points (Section 4, Table 4-2; 2025+): judged
  award points, playoff points, alliance selection points, qualification
  points, average qualification non-foul points, average auto points, best
  and second-best qualification non-foul score, then random — no longer
  qualification rank. (`compareAdvancement`.)
- BIOBUZZ qualification ranking (Section 13, Table 13-1): ranking score,
  average non-foul points, average TIPS, average auto points, random. TIPS
  aren't in the data yet, so they count as equal for everyone.
- Compass is an individual award: no advancement points (A211, Table 6-1).
- `rankingPoints` accepts a bonus-RP count as well as flags (`bonusCount`).

**Evidence (historical replay, not a live result).** 2025–26 season,
37,414 matches / 1,219 events, chronological replay from finalized results,
same matches and tie rules for both engines. 1.1.0 → 2.0.0: winner accuracy
72.68% → 74.65% on 37,140 non-ties (+1.98 points, event-bootstrap 95%
+1.62 to +2.32), Brier 0.17894 → 0.16842, log loss 0.5375 → 0.5102, score
MAE 27.874 → 27.864, 80% range coverage 82.02% → 82.05%. 10-bin calibration
error *worsened* 1.02% → 1.26%; May 2026 (−0.99 points, 810 matches) and
July 2026 (−1.71 points, 234 matches) lost accuracy. This package's
contextual path reproduces the frozen research ledger to 4.4e-16 (0
disagreeing winner picks); with `populationUpdate: "sequential"` and no
contextual model it reproduces 1.1.0 exactly.

### Also in this release

- `scoutEventQuery` works for 2019–2022: 2020/2021 query FTC Scout's
  `*Trad`/`*Remote` types (and omit `penaltyPointsByOpp`, which those seasons
  don't have). Queries for 2023+ are unchanged, character for character.

## 1.1.0 — 2026-10-13

- **Playoff lineups:** a selected alliance with three teams (a second pick)
  now fields its two strongest robots in each simulated playoff match,
  instead of scoring all three. Only two robots play; counting three made
  such alliances near-certain winners (an even final came out 92/8). All
  members still share the alliance's place for advancement. Changes odds
  only for events whose alliances are already selected with three teams.

## 1.0.0 — 2026-10-12

- Extracted from Control Point (`server/predict/*`), bit-identical: replaying
  2023–2025 (99,503 matches) gives the same ratings, match odds and event
  simulations as Control Point's in-repo engine.
- `inputs.ts`: the engine's own structural event types (`EventInput`,
  `FirstAdvancement`) replace imports from Control Point's app types.
- New (additive): `explainMatch` — win %, predicted scores + 80% ranges,
  top-3 factors, confidence tier. `RatingBook.baseline()` read accessor.
- `FITTED_MODEL` exported as a module (browser-bundle friendly), generated
  from `model.json`.
