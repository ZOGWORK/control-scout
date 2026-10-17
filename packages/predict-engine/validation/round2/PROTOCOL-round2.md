# Round-2 experiment protocol (registered before any candidate was scored)

Registered 2026-10-17 (UTC), after the error analysis (error-analysis.json) and
before fitting or scoring any candidate below.

## Baselines
- **2.0 shipped:** the frozen contextual model on symmetric-population ratings (what is live).
- **2.0 refit:** the same 17 inputs refitted by the identical research learner on the
  same train block. It is the like-for-like reference for every candidate that adds inputs.
  The pipeline reproduces the frozen coefficients to 4.8e-16 on sequential ratings.

## Blocks (chronological; no random splits)
- train: season 2023, plus season 2024 before 2025-01-01 (42,226 matches)
- select: season 2024, 2025-01-01 to 2025-02-28 (15,870). **The decision block.**
- calibrate: season 2024, 2025-03-01 to 2025-05-31 (3,196). Final two-number calibration only.
- audit: season 2024, June 2025 onwards (988). Reported, not used to decide.
- test2025: season 2025–26 (37,414). **Secondary and diagnostic only.** It has already been
  examined twice, so it is not independent proof, and no choice may be reversed because of it.

## Decision rule for a match-probability candidate
It "beats 2.0" only if all of these hold:
1. On **select**, Brier versus 2.0 refit improves with an event-bootstrap 95% interval
   entirely below 0.
2. Log loss improves on select.
3. On test2025 it does not worsen Brier or accuracy beyond noise (the 95% interval may not
   lie entirely above 0 for the Brier change). A failure here vetoes; a pass is not proof.

Feature groups are tested individually and then combined. Only groups that pass alone enter
the combination. One combination per track and one all-tracks combination; no further search.

## Score and event candidates
- **Score-mean recalibration** (actual = a + b·predicted, fitted on train): judged on select
  score MAE, bias and 80% coverage. Win odds are unaffected.
- **Event-simulator alignment and correlated bonus outcomes:** judged on the event backtest of
  the 2024–25 season (advancement Brier and log loss, Control Point backtest-events). For
  bonus outcomes, judged on the later 80% of 2025–26 qualification alliance results (the only
  bonus season; labelled diagnostic).
- **Complementary model** (event-local covariance ratings from the research): probability and
  score-mean blends; the weight is chosen on select only.

Everything rejected is kept in the rejected-experiment log, with its numbers.
