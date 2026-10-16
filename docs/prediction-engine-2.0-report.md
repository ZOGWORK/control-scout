# Prediction Engine 2.0: test, evaluation and deployment report

Shared FTC prediction engine `@control-scout/predict-engine` **1.1.0 → 2.0.0**,
integrated into Control Scout and Control Point. Implements the frozen model and
repairs from the FTC prediction validation package (16 Oct 2026). This report is
the deliverable the package's implementation brief asks for. Section 9 holds the
deployment record and is updated after each release step.

**Bottom line.** On a chronological replay of the whole 2025–26 season, which the
model never trained on (37,414 matches, 1,219 events), Engine 2.0 picks the
winner **74.65%** of the time against **72.68%** for 1.1.0. That is **+1.98
percentage points**, a **2.7% relative** gain, and **7.2% fewer wrong picks**
(event-block bootstrap 95% interval +1.62 to +2.32 pp). Brier improves from
0.17894 to 0.16842 and log loss from 0.5375 to 0.5102.

Not everything improved:
- 10-bin calibration error worsens from 1.02% to 1.26%. Engine 2.0 is
  slightly *under*-confident between 50% and 90%.
- Two late-season months lost accuracy.
- Advancement forecasts change only through the rule repairs, by about ±0.0003
  Brier, and their calibration error rises.

These are historical replays from finalized data, not live results.

## 1. What changed and why

| Stage | Change | Kind | Changes numbers? |
|---|---|---|---|
| A | **Contextual win probability** (`contextual.ts`). A frozen 17-input residual logistic model on the raw Gaussian P(win), with its own final calibration (slope 0.9414911747184092, intercept 0.004591262950340726). The full-precision coefficients from `frozen-model.json` ship as `FITTED_MODEL.contextual`, id `ctx-rel-2026-10-16-1a36820c`. | Validated model | Match win odds |
| B | **Reliability state** in `RatingBook`. Per team and season, EMAs of the alliance's standardized residual (α 0.2, clip ±4), squared residual (α 0.1, clip 25), and failure proxy (α 0.1; expected NP ≥ 40 and actual < 50% of it). Learned in `update()` from the expectation held before the result; reset at `startSeason`; carried by `clone`, `toData` and `fromData` (`stateVersion` 1). | Model input (part of A) | Via A |
| C | **Symmetric population baseline.** Both alliances update it together, and the first match seeds it with their mean. | Correctness | Priors, slightly |
| D | **Recorded bonus RPs kept as facts** in live forecasts, through `ScoreSplitInput.bonusRp` or the `Forecaster.recordedBonus` app hook. Unreported flags are sampled per run; seasons without a fitted bonus model draw from the event's own recorded results. | Correctness | Live-stage ranks and advancement |
| E | **Official rules.** Advancement tiebreak order (Section 4 Table 4-2, 2025+). BIOBUZZ qualification sort: RS, non-foul points, TIPS, auto (Section 13 Table 13-1). Compass earns no points (A211 Table 6-1). | Correctness | Event and advancement odds |

Preserved unchanged: rating gains, growth, noise, score means and ranges, the
event simulator's score-based outcome generation, and the pick and award models.

Not implemented: the rest of the research backlog was out of scope by the
brief's instruction (lower growth, failure clipping, uncertainty attribution,
online outcome correction, trees, covariance ratings).

The event simulator does **not** use the contextual probability. Its winners
come from its sampled scores, so simulated winners and scores always agree, and
event odds do not inherit the match-level gain.

## 2. Rules verified against official sources

These were read from the FIRST BIOBUZZ manual PDFs on 16 Oct 2026:
- Section 4 Advancement V1, Table 4-2.
- Section 13 Tournament V1, Table 13-1 and T601.
- Section 10 Game Details TU05, Tables 10-2 and 10-3.
- Section 6 Awards TU04, A211, A213 and A215.

| Research claim | Status |
|---|---|
| Advancement ties use judged-award points first | **Confirmed.** Order: total, judged award, playoff, alliance selection, qualification points, average qualification non-foul points, average auto, best and second-best qualification non-foul score, random. Applied for 2025+. The research cites the DECODE TU32 manual for 2025; that archived manual was not re-read here. |
| BIOBUZZ qualification tiebreaks are incomplete | **Confirmed.** RS, then average match points minus fouls, average TIPS, average AUTO, random. TIPS are not in either app's data, so they count as equal for everyone (documented). |
| Compass earns 12 points | **Confirmed defect.** Compass is an individual award and is absent from Table 6-1. Now 0. |
| BIOBUZZ has no fitted bonus model | **Confirmed.** Bonus RPs: SWARM (leave + park ≥ 16 at ordinary events), POLLINATOR 1 (≥ 4 TIPS), POLLINATOR 2 (≥ 7 TIPS). Regional, World and Premier thresholds are TBA or event-specific. No 2026 matches are in the data, so no model is fitted. The event-empirical fallback (D) is used instead and labelled. |
| Disqualified team contributes 0 to sort criteria (T601) | **Not implemented.** The live payload has no per-team DQ flag. Listed in section 10. |

## 3. Data, cohorts and information cutoffs

- **Snapshot:** `data/snapshot.db.br` at Control Scout `7d9bb7a`.
  - Git blob `91acf1ee9e793f94c8fdc43ad018c27120f0d622`, identical to the current `main` blob.
  - SQLite SHA-256 `3590b5b0…bcc17c2`.
  - Export content SHA-256 `961803a0…7c9a6a7f89`, which matches the package audit.
- **Eligible matches:** 2023: 28,306; 2024: 33,974; **2025: 37,414** (32,289 qualification, 5,125 playoff, 274 ties); 2026: 0.
  - Exclusions follow the engine's in-person event policy: remote, hybrid, scrimmage, off-season and similar events are dropped, as are empty or duplicate lineups.
  - DQs, surrogates and 589 non-two-robot alliances stay in.
- **Contextual model windows** (from the package; nothing was refitted):
  - fit: 2023 plus 2024 before 1 Jan 2025
  - select: 1 Jan–28 Feb 2025
  - calibrate: 1 Mar–31 May 2025
  - frozen at 2026-10-16T18:19:38Z
  - test: 2025–26 season, 27 Oct 2025 – 26 Jul 2026
- **Forecast horizon:** each match is predicted from every earlier result.
  - Inside a timestamp group, all predictions come before any result of the group is learned.
  - This is a finalized-data replay, not ingestion-time availability. The research's 180-second result-delay sensitivity (+1.98 pp) was not re-run.
- **Tie policy:**
  - Accuracy is over non-ties, with exactly-50% predictions scored as half credit. There were no exact-50% predictions, so legacy accuracy (which drops them) is identical.
  - Ties count as y = 0.5 in Brier and log loss.
- **Independence caveat:** 2025–26 was already examined by the 1.x authors, and its outcomes have now been read twice: by the research, and here for reproduction. It is a held-out season for *this* model, not untouched data. No parameter was tuned on it in this work.

## 4. Reproduction of the frozen evidence (before any production change)

Command, from a scratch copy of the package:
`PYTHONUTF8=1 CODEX_PRIMARY_RUNTIME_PYTHON=<venv python> bash research/validation/verify_frozen.sh`

Environment for that run: Windows 11, Node 24.21.0, Python 3.14.7, NumPy 2.5.4,
SciPy 1.18.1, scikit-learn 1.9.1. The package was produced on Linux with Node
24.19, Python 3.12, NumPy 2.3.5 and SciPy 1.17.0.

| Check | Result |
|---|---|
| Champion (1.1.0) ledger | **Bit-identical** (max difference 0) |
| Frozen primary and 6 other models | Max probability difference ≤ 3.3e-16 (floating point) |
| Metrics | Champion 72.6764% / Brier 0.1789403, primary 74.6500% / 0.1684172, exactly as published |
| Bootstrap | +1.974 pp, 95% interval [+1.623, +2.319]; week clusters [+1.555, +2.365] |
| Package tests | 10/10 experiment tests and 34/34 original engine tests pass through the research adapter (not native) |
| JS/Python inference parity | max 4.44e-16 on 10,000 cases |
| Observed-RP audit | 48.52% of 64,578 qualification alliance results have a wrong bonus-RP total under the old threshold guess |

The CSV hash differs from the package's because of the last bit of some float
values. The values themselves agree to ≤ 3.3e-16. The first run failed on
Windows text decoding (cp1252); `PYTHONUTF8=1` fixed it, with no code change.

Log: `packages/predict-engine/validation/results/frozen-reproduction.log`.

## 5. Production engine vs the frozen reference

This replays the *built* 2.0.0 package (`dist/`) through the research protocol
on the same cohort, using `validation/replay-engine.mjs` and
`validation/evaluate_engine.py`.

| Configuration | vs research ledger | Winner pick disagreements |
|---|---|---|
| 2.0 with `populationUpdate: "sequential"`, no contextual model | **bit-identical to 1.1.0 champion** (max 0) | 0 |
| 2.0 with sequential population plus contextual (= frozen primary) | max 4.4e-16 | 0 |

This proves the shipped code is the validated model. A first build was wrong: it
fed the *calibrated* rather than the raw probability into the model (mean error
0.0099, ECE 0.0204). This parity check caught it, and a test now pins it.

## 6. Before and after metrics (2025–26 replay, identical 37,414 matches)

| Metric | 1.1.0 | Population repair only (C) | Contextual only (A+B) | **2.0.0 shipped (A–E)** |
|---|---|---|---|---|
| Winner accuracy (non-ties, n = 37,140) | 72.676% | 72.676% | 74.650% | **74.653%** |
| Change, percentage points [95%] | — | 0.000 [−0.019, +0.019] | +1.974 [+1.623, +2.319] | **+1.976 [+1.624, +2.320]** |
| Relative accuracy change / wrong picks | — | 0 | +2.72% / −7.22% | **+2.72% / −7.23%** |
| Brier | 0.178940 | 0.178944 | 0.168417 | **0.168421** |
| Brier change [95%] | — | +0.000004 [−0.000008, +0.000017] | −0.010523 | **−0.010519 [−0.011542, −0.009547]** |
| Log loss | 0.53749 | 0.53750 | 0.51018 | **0.51020** |
| 10-bin ECE | **1.023%** | 1.039% | 1.250% | **1.263% (worse)** |
| Score MAE (points) | 27.874 | 27.864 | 27.874 | 27.864 |
| Score bias (actual − predicted) | −1.748 | −1.790 | −1.748 | −1.790 |
| 80% range coverage | 82.02% | 82.05% | 82.02% | 82.05% |
| Week-cluster 95% (accuracy) | — | — | [+1.555, +2.365] | [+1.556, +2.369] |

D and E do not touch match odds. Their measured effect is in section 7.

### Calibration

The 2.0 reliability table, as mean predicted vs observed red-win rate per bin:

| Bin | 0.0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 |
|---|---|---|---|---|---|---|---|---|---|---|
| Predicted | 0.052 | 0.150 | 0.251 | 0.350 | 0.449 | 0.549 | 0.650 | 0.750 | 0.849 | 0.949 |
| Observed | 0.055 | 0.143 | 0.235 | 0.350 | 0.446 | 0.567 | 0.666 | 0.778 | 0.876 | 0.950 |

From 50% to 90% the model is **under-confident by 1.6–2.8 points**. Brier and
log loss still improve, but the calibration error is worse than 1.1.0's. It was
deliberately **not** recalibrated on 2025–26, which would turn the holdout into
training data. Prospective monitoring is in place (section 8).

### Subgroups (2.0 minus 1.1.0)

| Group | Matches | Accuracy change (pp) | Brier change |
|---|---|---|---|
| Qualification | 32,289 | +2.12 | −0.0108 |
| Playoff | 5,125 | +1.10 | −0.0087 |
| A robot with no prior match | 2,866 | +1.76 | −0.0077 |
| Minimum experience 1–3 | 7,943 | +2.91 | −0.0149 |
| Minimum experience 4–9 | 11,513 | +2.34 | −0.0123 |
| Every robot ≥ 10 matches | 15,092 | +1.25 | −0.0074 |
| Baseline 40–60% | 8,837 | +5.67 | −0.0142 |
| Baseline favourite ≥ 80% | 12,335 | +0.22 | −0.0059 |
| **May 2026** | 810 | **−0.99** | −0.0031 |
| **July 2026** | 234 | **−1.71** | **+0.0017** |
| **Region CMPZ2** (championship) | 948 | **−0.32** | −0.0006 |

Every other month and every region with 500 or more matches improved. No
month or region fallback was added, because that would be tuning on the holdout.

### Control Scout's native backtest

`packages/predict-engine/validation/scout-backtest.mts` runs `server/stats/job.ts backtest()`:
- sequential per-match prediction, the production protocol
- 2v2 lineups only
- on a copy of the pinned DB

It is compared with the 1.x ledger shipped in that DB, on identical keys:

| Season | Rows | 1.x accuracy → 2.0 | Brier |
|---|---|---|---|
| **2025–26 (held out)** | 36,842 | 72.66% → **74.64% (+1.97 pp)** | 0.17907 → **0.16852** |
| 2024–25 (*in-sample*: fit, select, calibrate) | 33,271 | 75.84% → 76.24% (+0.40) | 0.16193 → 0.15825 |
| 2023–24 (*in-sample*: fit) | 28,075 | 72.15% → 72.82% (+0.67) | 0.17956 → 0.17470 |

The 2023 and 2024 rows are not evidence of improvement: the model was fitted
on them.

## 7. Ranking points, ranks and advancement

### Bonus-RP facts

Recorded flags now replace the score-threshold guess. That guess got the
bonus-RP total wrong for **48.52%** of played qualification alliance results
(31,332 of 64,578, reproduced). This is an input-correctness fix. The effect
on future rank and advancement accuracy is **not measured**: no
live-stage-at-time-of-forecast replay exists.

### Event backtest

Control Point `scripts/predict/backtest-events.mts`, 2025–26, 1,000 runs per
event, against the real FIRST advancement lists. Pre-event 10,900 team-events;
after quals 10,905; after selection 10,861.

| Stage, awards = real (isolates the engine) | 1.1.0 Brier / ECE | 2.0 rules, 1.1.0 population | **2.0 shipped** |
|---|---|---|---|
| Pre-event | 0.1061 / 0.0226 | 0.1057 / 0.0229 | **0.1057 / 0.0225** |
| After quals | 0.0632 / 0.0072 | 0.0626 / 0.0086 | **0.0626 / 0.0088** |
| After selection | 0.0359 / 0.0083 | 0.0348 / 0.0079 | **0.0348 / 0.0078** |

| Stage, awards = model (realistic) | 1.1.0 Brier / log loss / ECE | **2.0 shipped** |
|---|---|---|
| Pre-event | 0.1287 / 0.4061 / 0.0159 | 0.1286 / 0.4060 / **0.0166** |
| After quals | 0.0855 / 0.2870 / 0.0123 | 0.0853 / **0.2872** / **0.0141** |
| After selection | 0.0639 / 0.2357 / 0.0103 | 0.0636 / 0.2327 / **0.0113** |
| Rank MAE / 80% coverage | 5.13 / 86.1% | 5.13 / 86.1% |
| Partner scenarios (alliance wins), Brier | 0.0719 | 0.0719 |

- **Brier:** advancement Brier improves slightly at every stage. The gain is
  almost entirely from the rule repairs (column 3 vs 2).
- **Calibration:** calibration error worsens after quals and after selection
  in the realistic mode, and log loss after quals is marginally worse.
- **2024–25:** unchanged (it uses the fixed 2024 order). Brier is identical,
  with ECE ±0.0006.
- **Interpretation:** the official-rule fixes are correctness changes. They
  are not claimed as accuracy improvements.
- **Baseline check:** 1.1.0's partner numbers reproduce `model.json` exactly
  (0.0719 / 0.0855).

### Not measured

- live-stage (mid-event) rank and advancement accuracy
- BIOBUZZ (2026) anything: there are no matches yet
- the event-empirical bonus fallback
- TIPS tiebreaks

## 8. Tests and checks actually run

| Check | Command | Result |
|---|---|---|
| Engine unit and regression tests (native vitest) | `npx vitest run packages/predict-engine` | **68 passed**, 0 failed: 34 existing plus 34 new |
| Control Scout full suite | `npx vitest run` | **1,496 passed, 3 skipped**, 0 failed after merging current `main` (149 files); 1,422 / 3 skipped before the merge |
| Control Scout type check | `npm run lint` | clean (before and after merging `main`) |
| Control Scout integration tests | `npx vitest run server/predict/engine.test.ts` | 6 passed, including contextual explain with level and recorded bonus |
| Control Point type check | `npm run lint` | clean |
| Control Point predict, offline and monitor set | `npx vitest run server/__tests__/predict*.test.ts server/__tests__/offlineForecast.test.ts …` | **87 passed**; with new tests 18/18 in predictEngine |
| Control Point full suite | `npx vitest run` | 2,495 passed, **2 failed**: googleCalendarSync, SQLITE_BUSY while backtests loaded the machine. That file **passes 13/13** on rerun. Unrelated to the engine. |
| Cross-app equivalence | `npm run equivalence -- <control-point worktree>` | **EQUIVALENT.** 32 tarball files byte-identical; 99,503 matches replayed; 42,645 predictions (legacy, contextual qual, contextual playoff) bit-identical; rating books with reliability state identical; event simulations identical |
| Frozen-model parity | `node validation/replay-engine.mjs …` | see section 5 |
| Native held-out backtest | `scout-backtest.mts` + `compare_ledgers.py` | see section 6 |
| Event held-out backtest | `backtest-events.mts --season 2025/2024` | see section 7 |
| Screenshots | `npm run shots` | Methodology and Lab Notes, after (local) and before (production) |

**New regression tests:**
- golden parity cases (60) and full-precision parameters
- raw-not-calibrated input
- red/blue symmetry
- finite extremes
- scores unchanged
- level used, with the `qual` default
- empty-lineup fallback
- reliability EMA, clipping, and post-prediction learning
- per-season reset
- `clone` independence
- `toData`/`fromData` and subsets
- legacy-pack fallback, and no partial state written back
- unknown `stateVersion`
- colour-swap baseline invariance, and the sequential replay mode
- Compass 0
- Table 13-1 and Table 4-2 ordering
- award-first advancement in the simulator
- recorded flags decide ranks
- unreported flags sampled
- event-empirical bonus draws
- Forecaster keeps payload flags, uses the stored-record fallback, and labels unknowns
- Control Point offline round trip and legacy fallback
- monitor engine labels
- Control Point recorded bonus

The bonus-sampling test caught a real bug: a bonus count of 0 was resampled
because 0 is falsy.

**Skipped or unrun:**
- Control Scout `npm run audit`, `audit:flows` and `audit:perf`. CI runs the perf budgets on the PR.
- Production offline-pack build (runs on the server after deploy, see section 9).
- The research's 180 s result-delay replay.
- Control Point `backtest-matches.mts`: it computes P(win) with its own inline 1.x formula, so it cannot measure the contextual layer. The harness in `validation/` replaces it for this purpose.

**Runtime and resources:**
- A full 4-season replay with reliability state takes about 1.5–2.3 s, vs about 1.1–1.5 s before.
- The native ledger rebuild for 4 seasons takes 38 s.
- Inference is pure arithmetic (research benchmark: 0.6 µs per call).
- The lite pack grows by one `{bias, variance, failure}` triple per team.
- No new dependencies.

## 9. Integration, state migration, rollback and deployment

**Both apps** consume the identical engine:
- Control Scout uses its npm workspace.
- Control Point uses `vendor/control-scout-predict-engine-2.0.0.tgz` (sha512 `WbKXg6C0…cSZi6Wg==`).
- `npm run equivalence` proves byte and number identity.

**Context everywhere:**
- Every scheduled-match call passes its level: Control Scout match views, the live and backtest ledgers, offline readers, sync-lag; the Forecaster's per-match odds in both apps.
- Generic what-ifs default to `qual`, as documented:
  - Control Scout `/api/predict/match?level=`, share cards, link previews
  - Control Point `/api/predict/match?level=`
  - The API returns `probabilityModel`.

**State and migration:**
- Ratings are never persisted in either app. Both rebuild them from stored results on start and after syncs, so a deploy recomputes all reliability state from season start.
- **Offline packs:** the format stays 1, because the new fields are additive.
  - A pack built by 1.x has no `stateVersion`, so a 2.0 device uses the legacy probability for it.
  - Control Scout rebuilds packs as soon as `packs.engineVersion` differs.
  - Control Point builds packs per request.
- **Ledgers:**
  - Control Scout rewrites the backtest ledger and every season's stats once when the engine version changes.
  - Live calls carry `engine_version`; the track record adds `liveByEngine`.
  - Control Point's live snapshots now record `engine` per call and stage, and scoring adds `matchesByEngine`. Older calls count as 1.1.0.
  - Versions are never pooled in these new splits. The existing headline still pools.

**Rollback:**
- Revert the two PRs, which restores engine 1.1.0 and the 1.1.0 tarball, and redeploy.
- Ratings rebuild on start. 2.0 packs load on 1.x devices, because extra fields are ignored.
- Control Scout's ledger and stats recompute again on the version change.
- `populationUpdate: "sequential"` and omitting `contextual` reproduce 1.1.0 numbers inside 2.0 if a partial rollback is needed.

**Deployment record (16 Oct 2026, UTC):**

| | Control Scout | Control Point |
|---|---|---|
| PR | [#136](https://github.com/Control-Point-FTC/control-scout/pull/136): Greptile 5/5 on head `388a1ec`, 0 unresolved threads, CI green | [#274](https://github.com/Control-Point-FTC/control-point/pull/274): Greptile 5/5 on head `00c32f9d`, 0 unresolved threads |
| Merge commit | `3b47215323552c962728ef3f46245e22db701326` | `2b3f0bdf258f5cbe231e40213096a31d32e157a9` |
| Deploy run | "Deploy to Oracle VM" 38977937368: success (CI 38977937331 green) | "Deploy to Oracle VM" 38977972718: success; Verify step matched bundle `index-trFkljOv.js` |
| Running engine | `controlscout.org/api/health` → `engine 2.0.0`, release `3b47215`; Render backup also `2.0.0` | `tryctrlpoint.org/api/health` → `engine 2.0.0` |
| Contextual model live | `/api/predict/match` → `probabilityModel: contextual`. The same lineup gives 19.2% (qual) and 13.2% (playoff) with identical predicted scores. `level=bogus` returns 400. | Not exercised: `/api/predict/*` needs sign-in (AGENTS rules 8–9) |
| Offline packs | Rebuilt by the first post-deploy cycle (22:56): manifest `2026-10-16.2`, `engineVersion 2.0.0`; lite pack books carry `stateVersion 1` with reliability state for 6,445 / 7,257 / 7,812 teams (2023–2025) | Built per request by the new server |
| Ledgers | Backtest ledger rewritten on 2.0. Production 2025 rows equal this report's local 2.0 replay bit for bit (for example USTXHOCMP playoff 2-1: 0.9092465727497665). | Live snapshots now label each call with the engine version |

Two review rounds before merge fixed:
- a partial-stats-run upgrade marker;
- a fair draw for advancement ties;
- a strict byte check;
- the bonus-assumption copy;
- offline bonus flags;
- per-version live scoring;
- linear scoring.

After those fixes, the final engine's 2025 event backtests were identical to the numbers in section 7.

## 10. Remaining issues and next experiments

1. **Prospective evidence.** Every number here is historical. The per-version live ledgers in both apps are the first real test; compare 2.0 live Brier and accuracy on its own calls only.
2. **Calibration.** 2.0 is under-confident from 50% to 90%. Refit the final two-number calibration on *new* data (early 2026–27 live calls, or a later season) and compare on a later block.
3. **BIOBUZZ bonus model.**
   - Fit swarm (leave + park) and nested pollinator (one sampled TIPS count for both thresholds) from 2026–27 results once they exist.
   - Read event-specific thresholds (Regional, World, Premier).
   - Validate the event-empirical fallback.
4. **TIPS in the data.** Neither source mapping carries TIPS, so the second BIOBUZZ tiebreak is treated as tied.
5. **DQ handling (T601).** A disqualified team's match should count 0 for that team only; the live payload has no per-team DQ.
6. **Unpublished schedules, the Gaussian zero clamp, Monte Carlo error at 600 runs, and the red-intercept question.** These are confirmed by the research's diagnostics but are design experiments, not part of this release.
7. **The live stage.** Build a replay of mid-event forecasts with as-of-then inputs to measure the bonus-fact repair's effect on rank and advancement.
8. **The research backlog** (Sections 3–13). It stays a backlog; any new candidate needs a new held-out block, not 2025–26.

## Reproducing

From the Control Scout root, after `npm run build -w @control-scout/predict-engine`:

```bash
node packages/predict-engine/validation/replay-engine.mjs packages/predict-engine/dist <package>/research/validation/data/events.json.gz <out>
python -I packages/predict-engine/validation/evaluate_engine.py <out> <package>/research/validation/heldout-predictions.csv.gz <out>/eval.json
DATABASE_URL=file:<copy-of-snapshot.db> npx tsx packages/predict-engine/validation/scout-backtest.mts
python -I packages/predict-engine/validation/compare_ledgers.py <pinned snapshot.db> <copy-of-snapshot.db> <out>/ledger.json
npm run equivalence -- <path-to-control-point>
```

Here `events.json.gz` comes from the validation package's `export_data.py`
(section 4). Results from this run are in
`packages/predict-engine/validation/results/`.
