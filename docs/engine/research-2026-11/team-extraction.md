# Per-team skill from alliance scores

Research brief item 5. This explains how engine 3.3.0 gets a per-team number when FTC only records alliance scores. It also compares that method with the paper's, and states the method's assumption and its playoff limitation. **No engine number changes here.**

## What the engine does (verified in code)

The code is `packages/predict-engine/src/rating.ts`, `RatingBook.fold`, and its settings are in `packages/predict-engine/src/model.json` → `rating`. The method is EPA-style: each team carries an expected contribution, in game points, for each category in the [DECODE schema](decode-skill-schema.md): auto, TeleOp without endgame, endgame, and penalties committed.

For every played match, in time order (rated events only, scrimmages and off-season events excluded):

1. **Expectation before the match.** An alliance's expected score in each category is the sum of its robots' ratings. In a qualification match, a 2-robot alliance then loses overlap × the weaker partner's rating in that phase (engine 2.11: auto 0.25, TeleOp 0.15, endgame 0). Both alliances are judged against the ratings as they stood before the match.
2. **Error, split equally.** For each category, the alliance's error is actual − expected. Each robot on the field gets the same share, 1 / (robots on the alliance). Surrogates count, because they played.
3. **Shrinking gain.** Each robot moves by k × its share, where
   - k = max(kMin, k0 / (1 + n / n0)), with k0 0.65, n0 10 and kMin 0.33;
   - n is the team's rated matches this season, capped after a long break (the rebuild rule).

   Penalties committed learn at 0.15 × k (`penGain`, engine 2.10): fouls are far less persistent than scoring. Ratings never go below 0.
4. **Playoffs down-weighted.** A playoff result moves ratings by k × `playoffWeight` (0.5).

Other layers sit around this core:
- carry-over from earlier seasons as z-scores (ρ1 0.7, ρ2 0.2);
- a fitted rookie prior;
- regional offsets (2.7);
- season growth;
- the uncertainty that shrinks with each match;
- event-local form (2.9). This is a temporary lean at the current event. The permanent rating doesn't change.

The methodology page (`/methodology#rating`) describes them all.

The headline per-team number shown in the app is the **rating**: auto + TeleOp + endgame, with ± one standard deviation of its uncertainty. OPR is shown next to it for reference. OPR is plain least squares over an event's qualification matches (`server/stats/opr.ts`) and does not drive predictions.

## The paper's method, and how this differs

The paper (Galbiati et al., WPI, 2023, FRC 2017–2019) estimates a team's skill in each category as the **mean of its alliances' scores** over every match it played. Each category is normalized against its maximum, and fouls and defense are inverted. The engine does not do this, and the brief's "adopt it if the engine doesn't already extract per-team skill" condition doesn't apply: the engine already does.

There are two differences:
- **The engine judges a result against the alliance's expectation, not on its own.** A team that keeps drawing strong partners has a high mean alliance score whether or not it contributed. In the engine, a strong partner raises the expectation, so the team only gains if the alliance beats it.
- **The engine's numbers stay in game points per robot,** not a normalized 0–1 scale. They add up into a predicted score and margin.

The paper's 84.08% accuracy comes from a different competition (FRC, 3-robot alliances), different seasons and a random 85/15 split, not a walk-forward one. It is **not** a target for this engine or a comparison with it, and nothing here claims either method is more accurate. The engine's own accuracy is measured walk-forward (`docs/engine/README.md`, `docs/engine/signoff-3.0.md`).

## The assumption: randomized partners

Splitting an alliance's error equally only separates a team from its partners because **qualification partners are drawn at random and change every match.** Across a season, a team is the one constant in its alliances. Its partners' errors average out, and its own share shows through. With few matches the split is noisy, which is what the uncertainty and the shrinking gain account for. The slice report finds that thin data is the engine's largest source of error.

## The playoff limitation

Playoff alliances are **fixed**: the same robots play together every match. A playoff result can't tell the partners apart, and the equal split there just hands each robot the same share of a shared outcome. The engine does not use a separate per-team method for playoffs. It limits how much playoffs can move a rating:

- **`playoffWeight` 0.5.** A playoff match moves a rating half as much as a qualification match.
- **The overlap term is quals-only.** Playoff partners are picked to complement each other, and applying the overlap there made 2024–25 playoffs worse (engine 2.11 gate).
- **The playoff level is a feature of the contextual win model** (Engine 2.0+), and playoffs get their own score-range width (`band.playoff`).

Playoffs are not a weak slice: they are predicted better than quals (Part 1 slice report, Part 7). Even so, the per-team rating should be read mainly as a qualification-match estimate.

## Where this is stated

- `packages/predict-engine/README.md`, the `rating` row. This is the package's own documentation. The assumption is not in `rating.ts`'s header comment, because comments are kept in the built `dist/`. The equivalence check's first gate (`npm run equivalence`) compares those bytes with Control Point's vendored 3.3.0 tarball, so even a comment-only change would break that gate until the engine's next release re-vendors Control Point.
- The methodology page, `/methodology#rating-assumption`.
- One line next to the rating on team pages and on the world rankings page.
