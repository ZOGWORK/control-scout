# Gate: 2.8.0 recalibration vs engine 2.7.0 (rolling origins)

Engine improvement program, Part 9. The candidate is one final step after the 2.1 contextual model
and its calibration: P(red) = sigmoid(slope · logit(p)), with no intercept. It can't change which side
is favoured, so winner accuracy is unchanged by construction. It has no alliance-colour term.

**Protocol (forward-only).**
- At each month start from October 2024 to June 2026, the slope is fitted on the 730 days of
  replayed 2.7.0 calls before that month, then scored on that month.
- Changes are candidate minus 2.7.0. The 95% intervals come from resampling whole events.
- 2025–26 has been examined before (2.0, round 2, 2.1), so it is labelled reused. The rolled scores
  themselves are still forward-only: no fit saw the month it is scored on.
- Reproduce with `npx tsx scripts/part9/slope-check.ts <rows>`, where the rows come from
  `npm run slices -- --rows <rows>` on the 2.7.0 engine (snapshot 2026-10-14).

| Season | Matches | Δ Brier ×10⁴ [95%] | Δ log loss ×10⁴ [95%] | Δ accuracy | 50–80% calibration error |
|---|---|---|---|---|---|
| 2024–25 | 33,228 | −0.69 [−1.60, +0.24] | +0.15 [−3.42, +3.89] | 0 | 1.34 → 0.69 pts |
| 2025–26 (reused) | 36,615 | **−1.87 [−2.61, −1.15]** | **−5.34 [−7.95, −2.75]** | 0 | 1.63 → 0.98 pts |

**Verdict: ships.**
- Brier and calibration improve in both seasons. The improvement is significant on 2025–26.
- Nothing gets worse beyond noise.
- The shipped slope is 1.0577, refitted on the 730 days to the end of the snapshot
  (`docs/engine/fits/recalibration-2.8.0.json`).

**Rejected in the same step** (`scripts/part9/recalibration.ts`, `refit-weights.ts`, `slope-check.ts`):

| Candidate | Result | Why rejected |
|---|---|---|
| Per-slice cells (match type × data density), shrunk to the global mapping | 2025–26 −2.64 [−3.54, −1.74], about 0.5 better than one global mapping | Costs 2024–25 accuracy −0.13 pp [−0.22, −0.05]. Adding the event-phase cell made it worse. |
| An intercept as well | 2025–26 −2.15 | A colour term, which the brief allows only as a measured tag (12.8). The slope alone captures almost all of the gain. |
| Refitting the 22 contextual weights on newer data | 2025–26 −0.89 [−1.89, +0.09]; 2024–25 worse | No forward gain. Three small weights flip sign (D1, D7, D12). The frozen weights stay. |
