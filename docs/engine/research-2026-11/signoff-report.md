# Engine research program (Nov 2026): sign-off report

For Sushil's sign-off, like Part 11. It covers the research brief and the follow-up prompt of 2026-11-03.
Every number below links to the note that produced it. **No number, no claim.**

**Bottom line:**
- **Nothing that changes a prediction shipped.** All 7 research topics and the MLP were tested against the live
  engine on the same matches. Every candidate tied or lost on the gate, so the old behaviour stays.
- **What shipped is new or clearer information, with predictions bit-identical:**
  - engine 3.4.0's Swing consistency stat in both apps;
  - the pick helper;
  - margin error on the report card;
  - quals/playoffs labels;
  - the hand-check fixes;
  - the docs.
- **One decision is waiting on you** (section 6): three changes cut margin error in both seasons and leave
  win probabilities exactly the same. The gate as written needs a Brier gain, so none of them shipped.

## 1. Local main checkout: deletions are local-only

Checked with `git ls-tree` after `git fetch` on 2026-11-03:

| | `packages/predict-engine/` files | `bot/` files |
|---|---|---|
| origin/main (f69a7936 at the time) | 86 | 15 |
| local HEAD (86e8a4ad) | 86 | 15 |
| on disk in `C:\Users\mksus\StudioProjects\control-scout` | 0 (empty folder) | folder missing |

- Git still tracks every file. Only the working folder lost them, most likely the 10-20 junction-cleanup hazard again.
- Nothing was touched, restored or committed there. All work ran in fresh worktrees from origin/main.

## 2. Protocol, the same for every comparison

- **Walk-forward, rolling origins** (Part 9 / 12.5):
  - each month from Oct 2024 to Jul 2026 is scored by models fitted only on the 365 days before it;
  - predictions are pre-match only, on decisive matches at rated events;
  - runs used a copy of the decompressed `data/snapshot.db.br` (2026-10-14).
- **Seasons:** 2024–25 is the tuning season. 2025–26 (DECODE) is judged and labelled *reused*, because it has
  been examined before.
- **Same matches for both sides:** the champion's rows are the live engine's served calls
  (`engine-slices --rows`), joined by match key, so champion and challenger score the identical matches.
- **Intervals:** event-bootstrap 95% (2,000 draws).
- **Gate (item 12):** a candidate ships only if Brier improves with the interval excluding zero, with no
  regression in accuracy or margin MAE, in either season. Brier decides first, accuracy second, margin error third.
- **Champion = live engine 3.3.0**, as you set in October. On decisive matches:

| Season | Brier | Accuracy | Margin MAE |
|---|---|---|---|
| 2024–25 | 0.1578 | 76.54% | 38.85 |
| 2025–26 (DECODE) | 0.1681 | 74.79% | 37.48 |

- **Small differences between notes:** each note's own champion row set differs slightly, for example 33,017
  vs 32,974 matches in 2024–25, from its decisive and origin filters. That moves the champion by at most
  0.0002 Brier and 0.15 MAE.
  - Within each note, champion and challenger always score the identical rows.
  - Every Δ below is taken within one note, so these differences don't affect any comparison.
- **The prompt's 72.7% / 0.179** is the pre-2.0 legacy model.
  - It still reproduces at 72.66% / 0.1791 (R1, R2).
  - The live engine already beats it on DECODE by about 2.1 accuracy points and 0.012 Brier on decisive matches (R1: 74.78% / 0.1683 vs 72.63% / 0.1803).
- **Stretch target (~78% / 0.155) is not reached.**
  - R7 shows calibration can add at most about 6e-4 Brier.
  - Reaching 0.155 needs about 16% more resolution, which has to come from new information about robots, not
    from better math on the same alliance totals.

## 3. Old vs improved, per item

Δ is the improved version minus the old one. Brier is ×10⁻⁴ (negative is better), accuracy in points, margin
MAE in game points (negative is better).

### Shipped (no prediction number changed)

| Item | What shipped | Old vs new evidence | Call |
|---|---|---|---|
| 6 Swing, engine 3.4.0 | Consistency stat, one engine function used by both apps | Slice replay `--explain-against` 3.3.0: 109,002 matches, rowsSha256 identical, Brier unchanged (0.1741 / 0.1570 / 0.1672). `npm run equivalence`: 71,204 matches and 30,516 predictions bit-identical. Old vs new reliability job: 0 differences over 96,515 rows. Same numbers in Control Point on Edison 2025 (19066 ±0.38, 14631 ±0.42, 11329 ±0.49, 17861 ±0.50, 10084 ±0.43). | **Shipped**: Δ 0 / 0 / 0 |
| 9 Pick helper | Radar-area partner suggestions (Scout) | Presentation only. Reads stored ratings, engine untouched. | **Shipped** |
| 3 gap: margin error | Margin MAE on the track record | Display only. 2025–26 replay 39.3 pts vs 51.9 for "always a tie"; 2026–27 live 25.7 vs 27.5 (1,274 calls). | **Shipped** |
| 7 gap: quals/playoffs labels | One line on every prediction surface | Copy tied to engine values by a test. | **Shipped** |
| 8 gap: hand-check | 3 numbers fixed | Display only. | **Shipped** |
| 10 gap: precompute F1 | Pre-event ratings cached per start day | Each caller gets a copy, numbers unchanged (test). | **Shipped** |
| 4, 5 docs | Schema, extraction | `dist/` byte-identical to Control Point's 3.3.0 tarball. | **Shipped** |
| 2 gap: Platt vs isotonic | Already done in Part 12.5 | Re-run on decisive matches in R7 (below). | No change |

### Tested and not shipped (old behaviour kept)

| Item | Best candidate | 2024–25 Δ Brier [95%] | 2025–26 Δ Brier [95%] | Why it failed the gate | Note |
|---|---|---|---|---|---|
| R1 Massey | per phase | +219 [+204, +235] | +180 [+167, +192] | Far worse; acc −3.8 / −3.0, MAE +4.9 / +3.9 | [r1](r1-rating-systems.md) |
| R1 TrueSkill | β 1, τ 0.1 | +373 [+355, +392] | +341 [+324, +357] | Win/loss only; acc −7.1 / −6.3 | [r1](r1-rating-systems.md) |
| R1 Glicko-2 | φ₀ 1, τ 0.2 | +381 [+363, +400] | +346 [+329, +363] | acc −7.4 / −6.5 | [r1](r1-rating-systems.md) |
| R1 hybrid | engine + Massey | −0.5 [−1.8, +0.8] | −2.5 [−3.8, −1.3] | No gain on the tuning season | [r1](r1-rating-systems.md) |
| R1 hybrid | engine + TrueSkill / Glicko-2 | −0.9 [−1.9, +0.1] / −0.9 [−1.8, +0.1] | −1.4 [−2.5, −0.2] / −1.3 [−2.5, −0.3] | Tuning interval spans 0; Glicko playoff acc −0.30 | [r1](r1-rating-systems.md) |
| R2 shrinkage | empirical-Bayes rookie head start (ρ 1.5) | −0.61 [−1.19, −0.05] | −0.24 [−1.11, +0.64] | DECODE interval spans 0; quals 26+ +2.69 worse | [r2](r2-shrinkage.md) |
| R3 reweighting | D1–D3 coefficients | −0.38 [−0.75, −0.02] | −0.34 [−1.09, +0.35] | 2024–25 calibration worse; DECODE acc −0.08 [−0.17, −0.01] | [r3](r3-component-importance.md) |
| R4 decay | per-week half-life 8 on the live floor | −0.52 [−1.64, +0.54] | −0.14 [−0.86, +0.62] | Ties; live already sits at the sweet spot | [r4](r4-recency.md) |
| R5 MOV-Elo | scale-normalized | +283 [+267, +300] | +286 [+271, +300] | Far worse in every slice | [r5](r5-mov-elo.md) |
| R5 hybrid H2 | MOV-Elo as a 23rd input | −0.30 [−2.17, +1.51] | −2.19 [−4.30, −0.19] | Tuning spans 0; slices regress; needs the rejected 22-weight refit | [r5](r5-mov-elo.md) |
| R6 playoff model | slope + seed term | +1.77 | −3.75 [−6.44, −0.94] | Helps DECODE only; seed term costs 2024–25 acc −0.3 | [r6](r6-playoffs.md) |
| R6 playoff model | full refit on playoff rows | +6.90 | −3.54 [−12.8, +5.5] | Underpowered | [r6](r6-playoffs.md) |
| R7 isotonic | vs Platt, decisive matches | +0.84 [+0.07, +1.62] | −0.12 [−1.04, +0.82] | Worse on tuning, tie on DECODE | [r7](r7-calibration.md) |
| 11 MLP | engine ratings, small net (best) | +68.5 [+59.8, +77.9] | +36.1 [+30.7, +41.2] | acc −0.98 / −0.46, MAE +1.46 / +0.45 | [mlp](mlp-baseline.md) |
| 11 MLP | paper's features and network | +426 [+404, +448] | +365 [+345, +385] | acc −7.0 / −6.2, MAE +7.7 / +5.8 | [mlp](mlp-baseline.md) |

## 4. Research notes (R1–R7, item 11)

Each note has its method, full tables and verdict; JSON outputs and scripts sit next to it.

- **R1 rating systems** ([r1-rating-systems.md](r1-rating-systems.md)):
  - Massey, TrueSkill and Glicko-2 were adapted to 2-robot alliances, with the scripts tested against published
    worked examples.
  - The uncertainty these systems carry did not help teams with 0–5 matches; they lost even more there.
- **R2 shrinkage** ([r2-shrinkage.md](r2-shrinkage.md)):
  - The engine already pulls thin-data teams toward the average in six places.
  - The method-of-moments check shows new robots spread around their priors about as much as returning robots
    (variance ratio 1.05–1.06), so a stronger prior has little to fix.
- **R3 component importance** ([r3-component-importance.md](r3-component-importance.md)):
  - Ranked by the cost of removing each group and refitting, on DECODE:
    1. TeleOp: +125
    2. Auto: +51
    3. Reliability: +5.2
    4. Partner balance: +4.8
    5. Experience: +4.4
    6. Form: +3.6
    7. Endgame: +3.2
    8. Data certainty: +1.7
    9. Match context: +0.7
    10. Fouls: +0.1
  - Correlation alone misleads: partner spread correlates r = 0.32 with results but costs a tenth of what auto does.
- **R4 recency** ([r4-recency.md](r4-recency.md)):
  - The live gain floor gives a past result half its weight after 3.84 matches. The sweet spot is 3.9–4.4 in both seasons.
  - Every other option is worse:
    - whole season: +10.7 / +6.3;
    - last event only: +94 / +92;
    - gain reset at each event: +13.8 / +12.4.
  - Removing event form costs +2.2 / +2.5, so it earns its place.
- **R5 MOV-Elo** ([r5-mov-elo.md](r5-mov-elo.md)):
  - The engine already learns from margins, per phase.
  - In the hybrids, plain win/loss Elo adds about as much as MOV-Elo. The only extra signal is how a team does
    against strong opponents, and it is ≤1e-4 and not stable across seasons.
- **R6 playoffs** ([r6-playoffs.md](r6-playoffs.md)):
  - Playoffs look easier mainly because of the seed: red is the higher seed and wins 68–72% of playoff matches.
  - Against that seed-aware baseline the engine is less sharp in playoffs: skill 0.28 vs 0.32 in quals on DECODE.
  - A separate playoff model does not beat the quals model on both seasons.
- **R7 calibration** ([r7-calibration.md](r7-calibration.md)): Murphy decomposition of the live engine on DECODE:

| BS | REL (debiased) | RES | UNC |
|---|---|---|---|
| 0.1681 | 1.9e-4 (1.0e-4) | 0.0810 | 0.2492 |

  - The best monotone recalibration, fitted in sample, gives a floor of 0.1676. So calibration is worth at most
    about 6e-4 Brier.
  - UNC is the no-skill reference, not a floor that can be measured.
- **Item 11 MLP** ([mlp-baseline.md](mlp-baseline.md)):
  - The paper's network overfits: 79% accuracy on its training window against 69% on the next month.
  - Seed spread (sd ≈ 0.0001–0.001 Brier) is far smaller than the gap to the engine.
  - A forward-only rebuild of the engine's final calibration moves the engine by ≤0.5e-4, so the verdict holds.
  - **No ship plan is needed.**

The docs items are [decode-skill-schema.md](decode-skill-schema.md), [team-extraction.md](team-extraction.md),
[precompute-check.md](precompute-check.md) and [hand-check.md](hand-check.md).

## 5. PRs

Every PR below is merged, with Greptile 5/5 on its final head and 0 unresolved threads. Merging to main
auto-deploys. CI passed on each PR head, and on the main push for every merge except #506, whose main run was
still going when this was written (its PR head passed).

| PR | What | Head | Merge | Release |
|---|---|---|---|---|
| ZOGWORK/control-scout#486 | Items 4, 5, 10 docs; F1 precompute cache | 66d03f65 | ce63650d | Scout 2.8.0 |
| ZOGWORK/control-scout#488 | Margin error, quals/playoffs labels, hand-check | ccfffc00 | b05de35f | Scout 2.8.5 |
| ZOGWORK/control-scout#492 | Pick helper (item 9) | e51452cc | 6d68fb2b | Scout 2.8.4 |
| ZOGWORK/control-scout#499 | Engine 3.4.0: Swing | ee62f9fd | e8d74009 | Scout 2.8.7, engine 3.4.0 |
| ZOGWORK/control-point#349 | Engine 3.4.0 vendored, Swing in Analyze | 8361c046 | 33b6c5e7 | engine 3.4.0 |
| ZOGWORK/control-scout#506 | Swing in the event Rankings records table | d4c68a51 | 79e774be | Scout 2.9.0 |
| ZOGWORK/control-scout#484 | R6 + R7 notes and scripts | fbb24737 | d0f5c3eb | — |
| ZOGWORK/control-scout#485 | R2 + R4 notes and scripts | 2502f20f | 9b93d298 | — |
| ZOGWORK/control-scout#493 | R3 + R5 notes and scripts; `--features` harness fix | 8ff298fd | 4f021945 | — |
| ZOGWORK/control-scout#494 | R1 notes and scripts | 1221f180 | 4ca8188c | — |
| ZOGWORK/control-scout#505 | Item 11 MLP notes and scripts | fee35b63 | 92fbaa71 | — |

Live at the time of writing:
- controlscout.org `/api/health`: engine 3.4.0, release 79e774be.
- tryctrlpoint.org `/api/health`: engine 3.4.0.

## 6. Decision for you: margin-only changes

Three findings cut margin error in both seasons and leave every win probability exactly the same. The gate
needs a Brier gain, so none shipped.

| Finding | Source | Δ margin MAE, 2024–25 | Δ margin MAE, 2025–26 |
|---|---|---|---|
| Scale the served expected margin by about 0.92 (it is about 7% too wide; slope 0.90–0.94 on every window) | R1, R6 | −0.12 [−0.17, −0.06] | −0.07 [−0.12, −0.02] |
| Leave expected fouls out of the score model | R3 | — | −0.13 [−0.18, −0.08] |
| Add an Elo term to the predicted margin | R5 | −0.12 | −0.08 (both significant) |

- If you allow "margin MAE improves beyond noise in both seasons, with win probabilities bit-identical" as a
  ship rule for score-only changes, the first one is the simplest: one fitted constant.
- It would ship as engine 3.5.0 in both apps, through its own head-to-head gate.

## 7. Open follow-ups (not built)

- **Retest at the 2026–27 rollover,** when an unseen season exists:
  - the R6 playoff seed term;
  - the R3 auto reweighting;
  - the opponent-relative term;
  - the Platt slope refit (already on the rollover list).
- **Precompute:**
  - F1: store pre-event ratings in a job, so no request replays.
  - F2: compute finished events' model-vs-field in the stats job.
  - F3: switch simulated rankings to `liveForecaster`.
- **Hand-check:** 5 numbers are fixable later, for example a stored call's per-robot strengths (needs a ledger
  migration). See [hand-check.md](hand-check.md).
- **Docs:** move the random-partners note into `rating.ts`'s header at the next engine release. Today it would
  break the byte-for-byte equivalence with Control Point's tarball.
- **Data:** store 2025 score sheets to test the artifacts-vs-pattern split and the per-robot base candidate.
- **Pick helper:** the 60 s refresh hasn't been seen during a real alliance selection. A 3-team alliance counts
  all three robots; the methodology states this.
- **Control Point Analyze's Swing column** wasn't checked live, because it needs a signed-in account.

## 8. Live-check guide

All on https://controlscout.org unless stated.

| What | Where | Try | What you should see |
|---|---|---|---|
| Quals/playoffs labels | Any DECODE match drawer, e.g. on `/events/2025/FTCCMP1EDIS` (a qual match, then a playoff match); also `/predict` Lab | Open a qual match, then a playoff match | A different one-line basis for each, with a "How" link to `/methodology#quals-playoffs` |
| Report card | `/methodology#accuracy` | 2025–26 and the current season | Margin error next to accuracy and Brier, labelled "season replay" or "live calls" (25.7 vs 27.5 live at writing) |
| Formula hand-check | Match drawer; `/predict` Lab | Any match; the Lab with 4 teams | "Red by 12 (118 − 106)" style margin. In the Lab, open the robots' ratings: the Pen column and each score written out from its parts |
| Pick helper | `/scout?tab=picks`, or the event's Playoffs tab → "Pick helper" | Australia Championship (AUCMP), team 15215, posted alliances off | 15215 alone 15%; top pick 26000 at 52%; 18360 (4th rated) ranked above 11148 (3rd), which is the gap-filling effect |
| Swing | `/events/2025/FTCCMP1EDIS` → Rankings; world rankings; `/compare`; `/methodology#swing` | Team 19066 | Swing ±0.38 with its one-line formula |
| Swing in Control Point | tryctrlpoint.org → Analyze (signed in) | FTCCMP1EDIS | Swing column matching Scout (19066 ±0.38) |
| Assumption note | `/methodology#rating-assumption`; team page rating explainer | Any team | The random-partners assumption and the playoff limitation in plain words |
