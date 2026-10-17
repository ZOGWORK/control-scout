# Prediction Engine 2.1: round-2 experiments, correctness fixes and release report

## Correction (17 Oct 2026): what the evidence supports

An independent review found two flaws in how this round's validation was described. Both are correct.

1. **The decision-block comparison was not forward-only.** Each candidate's final two-number calibration was fitted on March–May 2025 outcomes, then applied to the January–February 2025 block it was judged on. That makes the select-block figures (+0.22 points, Brier 0.15358 → 0.15313) a development comparison that used later information. This concerns the measurement, not the deployed engine, which never sees future results when it predicts.
2. **2025–26 influenced selection.** The protocol let a candidate be vetoed on 2025–26 results, and one was (the complementary-model probability blend). 2025–26 is therefore reused data that took part in choices, not a passive check. The earlier summary sentence "a candidate's choice never depended on later games" was wrong.

**Clean re-evaluation** (`validation/round2/clean_eval.py`, results in `round2/results/clean-eval.json`). Both feature sets (2.0's 17 inputs, 2.1's 22) were refitted from scratch at every monthly origin from January 2025. Coefficients come from data before origin − 56 days and the final calibration from the 56 days before the origin. Each model is scored on the following month. No fitted quantity sees an outcome at or after the scored month.

| Segment | Matches | Accuracy 2.0 → 2.1 (change [95%]) | Brier 2.0 → 2.1 (change [95%]) | ECE 2.0 → 2.1 |
|---|---|---|---|---|
| 2024–25 season, Jan–Jul 2025 | 20,011 | 76.70% → 76.87% (+0.17 [−0.02, +0.37]) | 0.15646 → 0.15589 (**−0.00057 [−0.00087, −0.00028]**) | 1.11% → 1.00% |
| 2025–26 season (**reused**) | 37,414 | 74.66% → 74.73% (+0.06 [−0.08, +0.22]) | 0.16894 → 0.16846 (**−0.00048 [−0.00068, −0.00028]**) | 1.23% → 1.30% |

The deployed artifacts, scored only on the 988 matches after everything they saw (season 2024 from June 2025, never used for any decision): 75.33% → 76.14% (+0.81 [+0.10, +1.61]); Brier −0.00075 [−0.00206, +0.00035]; ECE 4.11% → 3.59%. This block is too small to settle the question.

**What this supports:**
- 2.1's **probabilities are better** than 2.0's under a clean forward test: Brier improves in both seasons and log loss improves.
- **A winner-accuracy gain is not established**: both intervals include zero.
- **The calibration penalty reported below was largely an artifact** of where calibration was fitted. With calibration fitted just before each block, ECE is about the same as 2.0's.

2.1 stays deployed: its probabilities are better and no clean measure is worse. Its accuracy claim is withdrawn. Engine 2.1.1 logs 2.0's prediction next to 2.1's on every live match, from the same ratings at the same moment, in both apps. Future results will then compare the two models on identical matches and information.

The original text below is kept for the record. Where it conflicts with this correction, this correction applies.

**What this round established (original wording; corrected above).** Only one candidate demonstrably beats Engine 2.0: the in-event form, momentum and collapse-recency inputs. They ship as Engine 2.1 (`@control-scout/predict-engine` 2.1.0). The gain is small. On the decision block it is **+0.22 percentage points** (95% interval +0.01 to +0.42) with Brier 0.15358 → 0.15313. On the secondary 2025–26 replay it is **+0.19 points** (+0.05 to +0.33) with Brier 0.16842 → 0.16804. Calibration error got worse again: 1.26% → 1.67% on 2025–26.

Nothing tried in the score or event-simulation track met the decision rule. That includes the experiments aimed at advancement predictions. Advancement and rank forecasts are therefore unchanged by 2.1 (identical to four decimals).

This round also closes several correctness gaps:
- per-team disqualification (T601);
- the DECODE sort order;
- BIOBUZZ TIPS storage and tiebreaks;
- a broken FTC Scout BIOBUZZ query;
- shipped offline packs that were still 1.1.0;
- ledger provenance.

Nothing here is a prospective result, and nothing supports promising 80%.

## 1. Release verification of 2.0 (step 1)

| Check | Result |
|---|---|
| Control Scout full suite (`npx vitest run`, `npm run lint`) on main `bd7bf92` | 1,497 passed, 3 skipped, 0 failed; lint clean |
| Control Point full suite on main `2b3f0bdf` (fresh worktree) | 2,501 / 2,501 passed; lint clean |
| Offline venue flow (`npm run audit:flows -- --only "Venue"`, production build) | 1/1 passed: lite pack saved on a return visit, offline reload, precache, offline match prediction |
| Legacy-pack fallback in a real browser (headless Chromium, the app's IndexedDB and `offlineExplain`) | 1.1.0 pack → `legacy` (0.93940, same in qual and playoff); production 2.0 pack → `contextual` (0.89988 qual, 0.94637 playoff) |
| Control Point contextual model through the app | Local server (confirmed local database file, throwaway local account): `/api/predict/status` reports engine 2.0.0 and model `ctx-rel-2026-10-16-1a36820c`; `/api/predict/match` → contextual; playoff changes the odds with identical means; invalid level → 400; offline pack has `stateVersion` 1 and bonus flags |
| Same input, same number in both apps | Control Scout production vs Control Point on Control Point's data: 0.89988 vs 0.89977. The gap was traced to the two apps' rating data (Control Point's copy synced 5 Oct). Running each app's own book through either engine reproduces its own number exactly. |
| **Issue found** | Control Scout's shipped `data/packs` (used by hosts with `CS_PACKS=off`) was still a 1.1.0 pack. It is regenerated on 2.1 in this release. |

## 2. FTC rule handling (step 2)

| Gap | Finding | Done |
|---|---|---|
| **Per-team DQ (T601)** | `match_teams.dq` is populated from FIRST `/matches` and FTC Scout and is reliable. Zeroing a DQ'd match reproduces FIRST's official ranking score for 144/144 2026 team-events, versus 1/4 of the DQ cases without it. Control Point's live payload also carries `dq`. | Engine: a DQ'd team scores 0 RP and 0 for every sort criterion in that qualification match, and its partner is unaffected. Wired through both apps. |
| **TIPS** | FIRST `ScoreDetailAllianceModel_2026` has `autoHiveTips` and `teleopHiveTips`; FTC Scout `MatchScores2026Alliance` has `tips`. TIPS can't be derived from points. | Control Scout stores `red_tips`/`blue_tips` (migration 26) and passes them to the engine's Table 13-1 tiebreak. Control Point's live payload has no TIPS; there they count as equal (labelled). |
| **FTC Scout BIOBUZZ query (bug)** | The engine asked `MatchScores2026Alliance` for DECODE fields (`dcBasePoints movementRp …`). The FTC Scout fallback therefore could not work for any 2026 event, and endgame and bonus flags were wrong. | Fixed: it now requests park (the endgame), swarm / pollinator RPs and tips. Tests added. |
| **DECODE (2025) rules** | The archived TU32 manual's Table 4-2 is identical to BIOBUZZ's, so the 2.0 advancement order is right for 2025. Its Table 13-1 adds average **BASE** points, then AUTO, after non-foul points. | 2025 sort: non-foul, then BASE (the 2025 endgame), then AUTO. |
| **Event-specific bonus thresholds** | BIOBUZZ ordinary events use SWARM 16 points, POLLINATOR 1 = 4 TIPS, POLLINATOR 2 = 7 TIPS. Regional and FIRST Championship thresholds are still **TBA** as of TU05 (15 Oct 2026); Premier events set their own; no API field exposes them. | **Not supportable yet.** The engine has no action-level bonus model that thresholds would feed. Played matches use the official RP flags, which already reflect each event's thresholds. |

## 3. Ledger: can a future improvement be measured? (step 3)

| Requirement | Control Scout | Control Point |
|---|---|---|
| The prediction is preserved as made | Yes. `INSERT OR IGNORE`, first write wins. | Yes. First write wins per match and stage. |
| Timestamp | `predicted_at`, `match_time` | `at` |
| Engine version | `engine_version` | `engine` (2.0+) |
| **Model version (new)** | `model_id`: the contextual parameter-set id or `legacy` | `model` per match call |
| **Information available (new)** | `data_version` (the data snapshot the ratings came from) and `ratings_through` (start time of the latest result the ratings had learned) | Implied by `at` (ratings rebuild from stored results); not recorded separately |
| Results by engine version | `/api/predict/accuracy` `liveByEngine`; How it works now lists per-version live results when a season has more than one version | `matchesByEngine`; headline and drift use the running version only |

**Remaining limit:** neither app records *which* results a call had seen beyond these markers. That would need an ingestion log of when each result arrived. A faithful "operational" replay (actual data latency) still needs that log.

## 4. What still causes wrong predictions (step 4)

These are diagnostics on 2.0's own predictions (`round2/error_analysis.py`), with no fitting. Select is the January–February 2025 block, not used for fitting; 2025–26 is diagnostic only.

| Group (2025–26) | Share of matches | Share of Brier error | Accuracy |
|---|---|---|---|
| Close (favorite at 50–60%) | 23.2% | 33.5% | 56.1% |
| Lean (60–80%) | 41.7% | 49.2% | 71.4% |
| Strong (80–95%) | 27.1% | 16.1% | 88.7% |
| Heavy (95%+) | 8.0% | 1.2% | 97.4% |
| A robot with no prior match | 7.7% | 9.3% | 66.7% |
| A robot's first match at this event | 17.0% | 19.0% | 70.8% |
| Gap over 28 days | 5.5% | 5.9% | 73.4% |
| Playoffs | 13.7% | 12.8% | 76.8% |

Findings:
- **Close and lean matches are most of the error.** They hold 75–83% of the Brier, and much of it is irreducible with alliance-total data.
- **Strong-favorite upsets are mostly underdog surges, not breakdowns.** About 9.4% of strong favorites lose. In 2025–26, 53% of those upsets had the underdog score more than 1.5× its prediction. Only 23% had the favorite collapse below half its prediction (the base collapse rate among all strong favorites is 3.7%). Under-rated or improving robots matter more than failures.
- **The score model regresses toward the middle too little.** The strongest quintile is over-predicted by 5–9 points and the weakest under-predicted by 3–4.
- **Missing information is the next weakness.** New robots, first matches at an event and long gaps are the weakest groups. Within-event form had the largest leftover correlation with 2.0's error (0.064 select, 0.046 2025–26).

## 5. Experiments (step 5)

**Protocol.** `validation/round2/PROTOCOL-round2.md`, SHA-256 `4f9ce7f8…`, was written after the diagnostics and before any candidate was scored.

- **Blocks:**
  - train: 2023 plus 2024 before 2025;
  - select: January–February 2025, **the decision block**;
  - calibrate: March–May 2025;
  - audit: June 2025 onwards;
  - 2025–26: **secondary**, may only veto.
- **Pass rule:** select Brier vs a like-for-like 2.0 refit improves with an event-bootstrap 95% interval below 0, log loss improves, and there is no 2025–26 veto (Brier interval entirely above 0).
- **Pipeline check:** it reproduces the frozen 2.0 coefficients to 4.8e-16.

### Match probability

All rows are compared with the 2.0 refit through the identical learner and blocks. The 2.0 refit equals shipped 2.0 to within 0.0001 Brier.

| Candidate | Select ΔBrier [95%] | Select Δacc | 2025–26 ΔBrier [95%] | 2025–26 Δacc | Verdict |
|---|---|---|---|---|---|
| **A** in-event form | −0.00039 [−0.00070, −0.00005] | +0.14 | −0.00037 [−0.00053, −0.00020] | +0.17 | pass |
| **A** momentum | −0.00011 [−0.00021, −0.00001] | +0.03 | −0.00010 | +0.08 | pass |
| **A** collapse recency | −0.00012 [−0.00022, −0.00002] | +0.01 | −0.00006 | +0.01 | pass |
| A long-gap signal | +0.00002 [−0.00003, +0.00006] | +0.03 | −0.00002 | +0.01 | reject |
| A last-match surprise | −0.00002 [−0.00003, 0.00000] | +0.02 | −0.00002 | +0.02 | reject |
| A rating break handling (gap ≥4 weeks: +200 variance per week, faster gain) | −0.00015 [−0.00044, +0.00012] | +0.06 | −0.00014 | 0.00 | reject |
| A extra uncertainty after a gap only | +0.00012 [−0.00011, +0.00034] | −0.03 | −0.00002 | +0.05 | reject |
| B autonomous / endgame compatibility | −0.00004 [−0.00009, −0.00000] | +0.01 | −0.00001 [−0.00004, +0.00002] | −0.01 | pass on select; not replicated |
| B role complement | −0.00005 [−0.00009, −0.00001] | −0.01 | −0.00002 [−0.00006, +0.00001] | +0.04 | pass on select; not replicated |
| B congestion | +0.00004 | −0.04 | **+0.00012 [+0.00009, +0.00015]** | +0.02 | reject (worse) |
| B defense proxy | −0.00000 | −0.01 | −0.00001 | +0.01 | reject |
| B partner familiarity | +0.00002 | −0.07 | +0.00001 | −0.02 | reject |
| **A combined (ships as 2.1)** | **−0.00045 [−0.00076, −0.00011]** | **+0.22** | **−0.00039 [−0.00056, −0.00021]** | **+0.20** | **pass** |
| B combined | −0.00006 [−0.00011, −0.00001] | +0.07 | −0.00003 [−0.00007, +0.00001] | 0.00 | pass, not shipped (gain under 0.0001; not replicated) |
| A + B combined | −0.00051 [−0.00084, −0.00018] | +0.16 | −0.00041 [−0.00059, −0.00023] | +0.20 | pass, not shipped (B adds about 0.00005 for more state) |

**Multiplicity caveat:** twelve groups were screened. The individual A passes are near the boundary. **Correction:** 2025–26 *was* used for choices (vetoes), and the select-block numbers used a calibration fitted on later data. See the correction at the top for the clean forward evaluation.

### Score and event simulation

| Candidate | Evidence | Verdict |
|---|---|---|
| Score-mean recalibration (actual = 7.72 + 0.933 × predicted, fitted on train) | Score MAE: select 28.73 → 28.88, 2025–26 27.86 → 27.96 | reject (worse) |
| Complementary model: event-local covariance ratings, score blend (weight 0.6, chosen on select) | MAE: select 28.73 → 28.16, 2025–26 27.86 → 27.24. Bias: select −0.2 → +3.5, 2025–26 −1.8 → +1.0. Coverage +1 point. | **promising, not shipped.** It needs a per-event covariance filter in production and an event-level test; the bias shift on select is large. |
| Complementary model, probability blend (weight 0.3) | Select Brier −0.00059 [−0.00097, −0.00018]; **2025–26 +0.00047 [+0.00015, +0.00079]** | reject (veto) |
| **Simulator: probability-matched scores** (each simulated match's gap carries the contextual model's log-odds correction at the simulator's own horizon) | 2024–25 (decision), real awards: pre-event Brier 0.0749 → 0.0742 but calibration error 0.85% → 1.03%; after selection 0.0452 → 0.0455; rank MAE 5.21 → 5.27; rank coverage 82.7% → 87.4%. 2025–26: after selection 0.0348 → 0.0330 (real awards), 0.0636 → 0.0624 (modeled). | reject (mixed on the decision season, worse ranks). **Best lead for advancement**, with a variance-preserving alignment. |
| Correlated bonus outcomes (joint 8-pattern model vs independent flags), later 80% of 2025–26 | Pattern log-likelihood −1.548 → −1.480; count log-likelihood −1.252 → −0.999. Most of the gain is in the marginals: the independent fit predicts three bonuses 13% of the time against 3.4% observed. | led to the next row |
| **Online bonus model** (refit weekly on earlier results; the only bonus season is 2025–26, diagnostic) | Count log-likelihood −1.252 (static) → −0.953 (online joint); MAE 0.609 → 0.546 RPs per alliance. Event backtest: pre-event advancement Brier 0.1057 → 0.1060, rank MAE 5.14 → 5.15. | reject for events (no rank or advancement gain). **Lead for BIOBUZZ**, which has no bonus model; the cause is drift in bonus rates within the season (DECODE goal RP 1.6% → 12.9%). |
| Probability-matched scores + online bonus | 2025–26: pre-event calibration error 1.66% → 3.06%, rank MAE 5.13 → 5.25 | reject |

**Why the match gain doesn't reach advancement.** After quals, official ranks fix most of the outcome, and advancement depends on alliance selection, awards and the bracket. Before the event, the simulator's draws of team strength and its rank model dominate. Better per-match odds move few advancement decisions. The simulator alignment that did move later-stage odds also widened ranks and hurt pre-event calibration.

## 6. Engine 2.1: what ships and its evidence

| Metric (identical matches) | 2.0 | 2.1 |
|---|---|---|
| Select (Jan–Feb 2025, decision): accuracy | 77.12% | **77.34%** (+0.22 [+0.01, +0.42]) |
| Select: Brier / log loss / ECE | 0.15358 / 0.47069 / 1.01% | 0.15313 / 0.46880 / **1.16%** |
| 2025–26 (secondary): accuracy | 74.65% | **74.85%** (+0.19 [+0.05, +0.33]) |
| 2025–26: Brier / log loss / ECE | 0.16842 / 0.51020 / 1.26% | 0.16804 / 0.50928 / **1.67%** |
| Control Scout native ledger, 2025–26 (41,743 rows incl. scrimmage events) | 73.61% / 0.17351 | 73.79% / 0.17314 |
| Score MAE, bias, intervals | unchanged | unchanged |
| Event, rank and advancement backtests, 2024–25 and 2025–26 | — | identical to four decimals |

- **Built-package parity:** the built 2.1 package reproduces the evaluated model on every 2025–26 match to 4.4e-16, with 60 golden cases pinned in the tests.
- **State:**
  - version 2 adds form fields;
  - version-1 (2.0) state predicts with the frozen 2.0 model as fallback, never the legacy one;
  - no state at all falls back to legacy.
- **Context:** in-event form needs the match's event code (`MatchContext.event`), which every scheduled-match call site passes. Generic what-ifs have none, by design.
- **Event outputs:** 2.1 doesn't change event outputs; the simulator stays score-driven. The new DQ and DECODE rules change standings only where DQs or exact ties occur. Control Point's event backtest feeds neither, so their effect is **not measured** there.

## 7. Tests (2.1 branch)

| Check | Result |
|---|---|
| Engine (`npx vitest run packages/predict-engine`) | **76 passed.** New: 2.1 golden parity (60 cases), 2.0 fallback parity, form-state behavior, event-scoped form, DQ (T601), TIPS tiebreak, DECODE keys, forecaster DQ and TIPS plumbing, model ids. |
| Control Scout full suite | **1,510 passed, 3 skipped**, 0 failed. New: BIOBUZZ score mapping from both sources and the FTC Scout 2026 query and parser. |
| Control Scout lint | clean |
| Control Point predict, offline and monitor set | **91 passed**; lint clean |
| Experiment reproducibility | `packages/predict-engine/validation/round2/` holds every script, the protocol and every results file |

## 8. Release

| | Control Scout | Control Point |
|---|---|---|
| PR | [#138](https://github.com/Control-Point-FTC/control-scout/pull/138): Greptile 5/5 on head `a929b66` after one fix (the harness now pins the frozen 2.0 baseline), 0 unresolved threads, CI green | [#275](https://github.com/Control-Point-FTC/control-point/pull/275): Greptile 5/5 on head `0076485`, 0 threads |
| Merge commit | `49195e365f2f494b515e7e7c4137c4df7de453e7` | `f72221c753fb9345273e14d4863ce02cb1e3862a` |
| Deploy run | "Deploy to Oracle VM" 38989340199: success | "Deploy to Oracle VM" 38989343742: success |
| Running engine | `controlscout.org/api/health` → `2.1.0`, release `49195e3`; Render backup also `2.1.0` | `tryctrlpoint.org/api/health` → `2.1.0` |
| Live check | `/api/predict/match` → contextual 2.1 (same lineup: 2.0 gave 19.2%, 2.1 gives 16.5%; playoff 13.6%; identical predicted scores) | Sign-in only; equivalence proved byte-identical before merge |
| Offline packs | Rebuilt by the first post-deploy cycle: `engineVersion 2.1.0`, state version 2 in every lite-pack book | Built per request |
| TIPS | Stored for matches synced from now on. The ten 2026 events already in the database have none until re-fetched; they're finished and use official ranks. | Not in the live payload; counts as equal |

**Rollback:** revert #138 and #275 and redeploy. Server ratings rebuild on start, and the ledger and stats recompute on the version change. Migration 26 only adds nullable columns, so it's harmless to keep.

Offline packs need one extra step. Engine 2.0 accepts reliability state only at version 1, so on a rolled-back 2.0 device a saved 2.1 pack (state version 2) loads *without* state and predicts with the **legacy** probability, not 2.0's. Rebuild packs on the restored server (Control Scout rebuilds them automatically when the manifest's engine version differs); devices then pick up the new manifest version on their next sync. Control Point builds packs per request; a device's saved pack refreshes when its user downloads again.

## 9. Remaining issues and the most useful next experiments

1. **Prospective evidence.** Since engine 2.1.1, every live call stores both 2.1's and 2.0's probability, from the same ratings at the same moment (Control Scout `predictions.p_red_shadow`; Control Point `pShadow` in live snapshots). `/api/predict/accuracy` reports them paired (`liveShadow`), and Control Point scores them paired too (`shadow`). That is the only clean, independent test left; 2025–26 is used up.
2. **Calibration** has worsened twice (1.02% → 1.26% → 1.67%), with Brier and log loss still better. Refit the final two-number calibration on early 2026–27 live calls, then judge it on a later block.
3. **Advancement.** The simulator-alignment lead (later-stage Brier gains on 2025–26) needs a version that keeps rank and pre-event dispersion. One option: align only playoff matches.
4. **BIOBUZZ bonus RPs.** An online joint model learned from the season's own results is ready as a candidate. It needs 2026–27 results to judge, plus event-specific thresholds (Championship TBA) and an action-level model (TIPS counts, swarm points) once data exists.
5. **Complementary score model.** The event-local covariance ratings cut score MAE by about 0.6 points; they need a production-feasible version and an event-level test.
6. **Ingestion log** for a true operational replay of data latency.
7. **Alliance interactions** were weak with alliance totals only. Robot-level scouting data is the precondition for testing compatibility and defense properly.
