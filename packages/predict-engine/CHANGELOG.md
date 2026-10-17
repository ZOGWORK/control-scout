# Changelog

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
