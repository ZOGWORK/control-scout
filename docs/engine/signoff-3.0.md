# Prediction Engine 3.0 — sign-off report (Part 11)

Date: 2026-10-23. Engine: 2.11.0 numbers, declared **3.0.0**. Corpus: the pinned snapshot (data
version 2026-10-14), plus 2019–20 to 2022–23 synced from FIRST's Events API into a local copy (FTC
Scout fallback for 250 events). Every number below comes from a stored artifact in this folder:
- `docs/engine/signoff/` holds the full 2019–2025 replay and the paired comparison with 2.6.
- `docs/engine/slices/` and `docs/engine/gates/` hold each release.

## The three-sentence version

Engine 3.0 rates each robot more like the robot it is today. It accounts for:
- its region and its form at the current event;
- how little fouls repeat;
- how two similar robots get in each other's way.

On every past match since 2019–20, replayed in order, its stated chances are closer to what happened than 2.6's in six of seven seasons (the seventh, the mostly-remote 2020–21, is noise), and its calibration error halves. It picks about as many winners as before: the gain is in how much to trust each call, most of all early in seasons and events.

## 1. Global: 2.6.0 (the program's starting champion) → 3.0, on identical matches

Paired replay of the full corpus. The final engine is the challenger. The champion is 2.6.0 exactly: its replay reproduces the stored 2.6.0 report's prediction hash bit for bit. Intervals come from resampling whole events.

| Season | Matches | Accuracy, final | Brier, final | Δ Brier vs 2.6 ×10⁴ [95%] | Δ accuracy | 50–80% calibration error |
|---|---|---|---|---|---|---|
| 2019–20 | 15,391 | 69.23% | 0.1937 | **−7.87 [−10.03, −5.74]** | +0.06 pp | 2.81 → 2.19 pts |
| 2020–21 (mostly remote) | 564 | 73.69% | 0.1658 | +1.97 [−10.46, +14.88] | 0 | 7.99 → 6.22 |
| 2021–22 | 13,239 | 71.73% | 0.1830 | −2.77 [−5.61, +0.11] | −0.03 | 1.40 → 0.60 |
| 2022–23 | 24,226 | 74.67% | 0.1688 | **−3.18 [−5.17, −1.17]** | −0.05 | 1.59 → 0.69 |
| 2023–24 | 28,075 | 73.86% | 0.1708 | **−3.73 [−5.92, −1.57]** | +0.18 | 0.74 → 0.27 |
| 2024–25 | 33,271 | 76.53% | 0.1570 | **−6.45 [−8.49, −4.38]** | +0.16 | 1.44 → 0.76 |
| 2025–26 | 36,842 | 74.79% | 0.1672 | **−9.31 [−11.60, −7.19]** | −0.04 | 1.97 → 0.89 |

**Log loss:**
- 2024–25: −15.1 [−21.0, −8.8] ×10⁻⁴.
- 2025–26: −24.0 [−30.1, −18.1] ×10⁻⁴.

**The slices the program targeted** (Δ Brier ×10⁻⁴, 2024–25 / 2025–26):

| Slice | 2024–25 | 2025–26 |
|---|---|---|
| Robots at their first event | −11.9 | −12.9 |
| Thin data | −13.3 | −11.1 |
| Quals 1–10 | −6.8 | −14.7 |
| Playoffs | −1.8 | −8.5 |

**Historical baseline (Engine 1.x)** on 2025–26, replayed with frozen settings: 72.71% / Brier 0.1791. It still reproduces the published 72.7% / 0.179. Against it, 3.0 is +2.08 points of winner accuracy and −0.0119 Brier.

## 2. Slices and calibration (final engine)

The full slice report for every season, with every slice and its movement against 2.6, is in:
- `signoff/engine-2.11.0-snapshot-2026-10-14.md` (final engine);
- `signoff/gate-3.0-vs-2.6-snapshot-2026-10-14.md` (paired, every slice and season).

**Slices that got worse beyond noise:**
- One: the 60–70% band in 2020–21, on very few matches, flagged low-n.
- None in any other season.
- Earlier gates flagged two exceptions in 2023–24, which was a cold start in those replays. On this full corpus, where 2023–24 carries history from 2019–23, neither is flagged.

**Weakest slices, still.** For 2025–26 the top three by excess Brier are unchanged in kind:

| Slice | Share of matches | Share of error |
|---|---|---|
| Thin data | 29.5% | 32.9% |
| Quals 1–10 | 31.5% | 34.2% |
| Robots with 0–5 rated matches | 41.8% | 44.1% |

They are smaller than at 2.6, but early-season, early-event data is still where prediction is hardest.

**Calibration, final engine, 2025–26** (stated → won):

| Band | Matches | Stated | Won |
|---|---|---|---|
| 50–60% | 8,141 | 55.0% | 55.5% |
| 60–70% | 7,862 | 65.0% | 65.5% |
| 70–80% | 7,234 | 75.0% | 76.7% |
| 80–90% | 6,951 | 85.0% | 86.0% |
| 90–100% | 6,654 | 94.9% | 94.7% |

## 3. The other Part 11 checks

| Check | Result |
|---|---|
| Determinism | Two full replays of 2019–2025 give identical prediction hashes for every model (`meta.rowsSha256`). |
| Monte Carlo acceptance (midpoint replay, 40 finished 2025–26 events, 2,000 sims each, final engine) | 958 / 1,098 team finishes inside the projected P10–P90 rank band (**87.2%**, target ≥ 80%). 2.5 had 85.7%, 2.6 86.6%. Mean band 12.27 ranks; median miss 3.58 ranks; 295 ms per event. |
| Equivalence with Control Point | Byte-identical tarball and bit-identical outputs on 71,204 replayed matches at every release 2.7–2.11 and at 3.0.0. |
| Performance (this laptop; the VM is slower, but the ratio holds) | `explainMatch` median 20.2 µs per call (2.6 settings: 15.7 µs). Full 2025–26 replay with predictions 1.5 s (0.97 s). Full 2019–2025 replay with four models side by side: 17 s. The live API's per-route budget is 300 ms. |

## 4. What 3.0 is

| Version | Part | Change |
|---|---|---|
| 2.7.0 | 8 | Regional starting points (κ 20, from returning teams); last season counts 0.7. |
| 2.8.0 | 9 | Final stretch of the win probability: log-odds × 1.0577, no intercept. |
| 2.9.0 | 3 | Event-local form: auto 0.4 / TeleOp 0.2 of a robot's mean miss at the event, fading. |
| 2.10.0 | 6 | Foul ratings learn at 0.15× the scoring gain. |
| 2.11.0 | 5 | Alliance overlap in quals: 0.25 × the weaker partner's auto, 0.15 × its TeleOp. |

**Measured and closed without a build:**
- Part 4: dead-robot mixture. Fragile robots were already priced right.
- Part 7: playoff calibration. There was no gap; a defense term waits for a defense rating.

**Rejected inside parts:**
- per-phase carry-over;
- refitting the 22 contextual weights;
- per-slice calibration;
- an intercept (colour term);
- a growing event-form weight.

Each is recorded in the engine CHANGELOG and How it works › Lab notes.

## 5. Caveats, stated plainly

- **2025–26 is reused data.** It was examined for 2.0, round 2 and 2.1. The 2019–23 seasons are new evidence for every release here: none was used to choose a setting. The live ledger (each call records its engine version) is the prospective test from now on.
- **The 2019–22 data in this report comes from a local sync of FIRST's API, not the production database.** The sync fetched 4,336 of the 4,584 events FIRST lists for those seasons (250 of them through the FTC Scout fallback); it skipped the rest, as production's sync does. The engine also drops remote and hybrid events, so 2020–21 (mostly remote) has only 564 rated, predicted matches.
- **Settings and game changes.** Alliance overlap and event form were tuned on the last two games. A new game can differ; 2025–26's auto overlap was more than twice 2024–25's.
- **No event simulations for 2019–22.** The simulator's ranking, playoff and advancement rules are built and checked for 2024–26 only. The Monte Carlo acceptance check stays on 2025–26.
- **Production keeps rating from 2023–24.** It does not rate 2019–22. Rating them would not change 2026–27 predictions, because carry-over reaches two seasons back.
