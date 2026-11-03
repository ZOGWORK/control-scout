# DECODE (2025–26) skill schema

Research brief item 4. This writes down how the DECODE score sheet maps onto the engine's categories. It is a description of what ships in engine 3.3.0. **Nothing in the engine changes here.**

## The categories

The engine has no skill list of its own, separate from its ratings. Its categories are the rating components in `packages/predict-engine/src/types.ts` (`COMPONENTS`), plus three bonus RP slots:

| Category | Engine name | What it is | Sign |
|---|---|---|---|
| Auto | `auto` | Points scored in the autonomous period | + |
| TeleOp | `teleop` | Driver-controlled points, **without** the endgame | + |
| Endgame | `endgame` | The season's end-of-match points (DECODE: base return) | + |
| Penalties committed | `pen` | Foul points this alliance gives away, which the opponent is credited with | − (counted against the side that commits them) |
| Bonus RP slots | `bonusRp.movement`, `.goal`, `.pattern` | The season's three bonus ranking points, as yes/no per alliance | n/a (ranking points, not score) |

The set is the same for every season. Only the mapping changes, and it lives in one place, `server/data/seasons.ts` (`splitFirstScore`; AGENTS.md rule 14). FTC Scout imports use the same mapping in `server/sources/ftcScout.ts` `split` and in the engine's `scoutData.ts`. That keeps the categories fixed through the season, so ratings, leaderboards, trends and predictions compare across events.

**There is no defense category.** No recorded field measures defense. FIRST and FTC Scout report only what each alliance scored and the fouls it committed. Part 7 of the engine program found that no defense rating exists, and that a defense term has to wait for one (`docs/engine/README.md`, "Parts measured and closed without a build"). The brief says not to invent stats the data can't support, so the schema has no defense slot. The paper's seven-category schema (low, high, technical, auto, endgame, fouls, defense) is FRC-specific. Its low/high/technical split has no DECODE equivalent in the alliance totals the engine reads.

## Every DECODE scoring element, mapped to one category

These are the per-alliance fields of a DECODE score breakdown. The names are FTC Scout's `MatchScores2025Alliance`, checked against that API's schema and against real matches on 2026-11-03 (FIRST Championship qualifier `AECMP`). FIRST's `/scores` breakdown carries the same elements. Of FIRST's fields, Control Scout reads only `autoPoints`, `teleopPoints`, `teleopBasePoints`, `foulPointsCommitted`, `movementRP`, `goalRP` and `patternRP`.

| Element (game) | Breakdown field(s) | Period | Category |
|---|---|---|---|
| LEAVE (robot leaves the launch line) | `autoLeavePoints` (per robot: `autoLeave1`, `autoLeave2`) | Auto | **Auto** |
| ARTIFACTS classified (scored into the goal, onto the ramp) | `autoArtifactClassifiedPoints` | Auto | **Auto** |
| ARTIFACTS overflow (scored beyond the ramp) | `autoArtifactOverflowPoints` | Auto | **Auto** |
| PATTERN (ramp artifacts matching the MOTIF) | `autoPatternPoints` | Auto | **Auto** |
| ARTIFACTS classified | `dcArtifactClassifiedPoints` | TeleOp | **TeleOp** |
| ARTIFACTS overflow | `dcArtifactOverflowPoints` | TeleOp | **TeleOp** |
| PATTERN | `dcPatternPoints` | TeleOp | **TeleOp** |
| DEPOT artifacts | `dcDepotPoints` | TeleOp | **TeleOp** |
| BASE return, partial or full, plus the both-robots bonus | `dcBasePoints` (= `dcBase1` + `dcBase2` + `dcBaseBonus`; FIRST: `teleopBasePoints`) | End of TeleOp | **Endgame** |
| Minor and major fouls | `minorsCommitted`, `majorsCommitted` → `penaltyPointsCommitted` (FIRST: `foulPointsCommitted`) | Whole match | **Penalties committed** |
| Fouls by the opponent | `penaltyPointsByOpp` | Whole match | not a category: it is the opponent's `pen`, so it is never counted twice |
| Movement RP | `movementRp` (FIRST: `movementRP`) | n/a | **Bonus slot `movement`** |
| Goal RP | `goalRp` (FIRST: `goalRP`) | n/a | **Bonus slot `goal`** |
| Pattern RP | `patternRp` (FIRST: `patternRP`) | n/a | **Bonus slot `pattern`** |
| Classifier state (ramp contents, colour by slot) | `autoClassifierState`, `dcClassifierState` | n/a | not scored on its own; it is how the pattern points above are worked out |

The sums hold in the data. For example, red in AECMP qualification match 1:
- Auto: 3 + 6 + 0 + 2 = 11 = `autoPoints`.
- TeleOp: 15 + 72 + 0 + 4 + 0 = 91 = `dcPoints`.
- Fouls: 2 minors gave away 10.

So the engine's split from FIRST's totals (`server/data/seasons.ts`, season 2025) is:

```
auto    = autoPoints                              (leave + artifacts + pattern, auto)
endgame = teleopBasePoints                        (base return + bonus)
teleop  = teleopPoints − teleopBasePoints         (artifacts + pattern + depot, TeleOp)
pen     = foulPointsCommitted
np      = auto + teleop + endgame
bonus   = { movement: movementRP, goal: goalRP, pattern: patternRP }
```

Each element lands in exactly one category. Pattern points appear in both auto and TeleOp only because the game scores a pattern in each period. Each period's pattern points go to that period's category.

## Every stat the engine consumes, traced to one category

| Engine input (`MatchRecord` / `AllianceResult`) | Category | Used by |
|---|---|---|
| `auto` | Auto | Rating update, OPR auto, event form, overlap |
| `teleop` | TeleOp | Rating update, OPR TeleOp, event form, overlap |
| `endgame` | Endgame | Rating update, OPR endgame, event form |
| `penCommitted` | Penalties committed | Rating update (at `penGain` 0.15), OPR penalties, predicted final score |
| `np` | Sum of auto + TeleOp + endgame | Reliability residuals, bonus RP model (P(bonus) = logistic(c0 + c1 · np)) |
| `total` | np + the opponent's `pen` | Win/loss/tie for ranking points; not a rating input |
| `bonusRp.movement / .goal / .pattern` | Bonus slots | Bonus RP model fit, simulated ranking points |
| `teams`, `surrogates`, `level`, `time`, `region`, `eventCode` | n/a (match context, not skill) | Who gets the update, playoff weight, growth, regional priors, event form |

Everything derived from these is a function of the four components and the bonus slots:
- the contextual win model's features (phase gaps, lopsidedness, experience, uncertainty, the track-record signals);
- reliability (no-shows, near-zero matches, swing);
- report cards;
- the factor sheet.

No other score field enters the engine.

## Candidate DECODE-specific splits (not adopted)

The breakdown would support finer categories than the engine uses. They are listed here as candidates only. Each one would need a gate run like every earlier engine change (`docs/engine/README.md`, Gates).

1. **Artifacts vs pattern.** The per-alliance fields exist at the source in both periods: classified + overflow (+ depot) vs pattern. Control Scout **does not store them for 2025–26**. `matches.red_detail` / `blue_detail` hold a score sheet only for seasons listed in `SHEETS` (`server/data/seasons.ts`), and only BIOBUZZ (2026) is listed. Trying this split needs:
   - a 2025 entry in `SHEETS`, after checking FIRST's own sub-field names against a live `/scores` response;
   - a re-sync of the season to fill the details;
   - a research run asking whether separate artifact and pattern ratings predict better than their sum.

   A team's pattern skill and artifact skill may well be one skill (accuracy and sorting go together). Only the gate can say.
2. **Per-robot leave and base.** DECODE records leave and base return per robot station (`autoLeave1/2`, `dcBase1/2`), not only per alliance. That is the one place this game gives per-robot data. Mapped to teams by station, it could rate a robot's endgame directly instead of splitting the alliance's base points equally. It would need the station-to-team mapping from the sync, and it is small: leave and base are a few points of a 100+ point score.

Neither split is in this PR, and the set stays fixed for the rest of the season. Changing the categories mid-season would break comparability across events, which is the point of a fixed schema.
