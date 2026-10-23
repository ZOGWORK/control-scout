# Engine improvement program: reports

This is the measurement trail for the Prediction Engine program that ends in Engine 3.0. Every engine change is judged against these reports.

## Slice report (Part 1)

`slices/engine-<version>-<corpus>.{md,json}` reports accuracy, Brier score, log loss and calibration per slice. Each is a full chronological replay of the pinned corpus: every match is predicted from earlier results only, in the backtest ledger's order and with its exclusions (`server/stats/job.ts` `backtest`).

Three models are replayed side by side on identical matches:
- **champion**: the live engine.
- **v2.0**: the frozen Engine 2.0 model on the same ratings, i.e. the live shadow.
- **legacy**: Engine 1.x, the historical baseline.

The legacy run must reproduce the published 72.7% / Brier 0.179 on 2025–26. If it doesn't, the harness is wrong, not history. The report states the result of this check.

Regenerate on a **copy** of the pinned snapshot (the script runs migrations):

```bash
node -e "require('fs').writeFileSync('snap.db', require('zlib').brotliDecompressSync(require('fs').readFileSync('data/snapshot.db.br')))"
```

```bash
DATABASE_URL=file:snap.db npm run slices -- --seasons 2023,2024,2025
```

Options:
- `--live` also slices the live ledger (scored `kind = 'live'` calls) by the same data tags.
- `--rows <file.json.gz>` keeps the per-match rows for further analysis.
- `--out <dir>` writes the report somewhere other than `docs/engine/slices/`.

`meta.rowsSha256` in the JSON fingerprints every model's predictions. Two runs on the same corpus must give the same hashes (the determinism check).

**Where the slices come from:** match tags (event phase, experience, rated matches, density, volatility, event size and type) are computed once per match, from the state before it, and shared by all models. The probability and margin bands follow each model's own call. The report's "Definitions" section gives every cut point.

**What the first report found (engine 2.6.0, snapshot 2026-10-14, champion on 2025–26 rated events):**
- **Most excess error comes from thin data.**
  - Matches where the four robots have few rated matches between them: 29.5% of matches, 33.0% of Brier.
  - The first ten qualification matches of an event: 31.5% of matches, 34.3% of Brier.
  - Robots with 0–5 rated matches this season.
- **Late-event matches are not a weak slice.** Qualification match 26+ beats the average, so the within-event layer's premise (stale data late in the day) doesn't show in Brier.
- **The model is under-confident almost everywhere.** Favourites win 1.5 to 2.8 points more often than stated across the 50–90% bands. Surprise (ties left out) is negative in every data slice except world-championship matches (943), where favourites win 74.0% against a stated 75.0%.
- **These are not weak slices:** rookies (about average), playoffs (better than quals) and high-volatility robots (about average).

## Gates (Part 2)

`gates/gate-<name>-<corpus>.{md,json}` holds each engine change judged against the live engine. The challenger is replayed next to the champion on the same matches:

```bash
DATABASE_URL=file:snap.db npm run slices -- --seasons 2023,2024,2025 --challenger '{"name":"<name>","rating":{...}}'
# after model.json already carries the release, replay the previous one as the champion (writes the gate only):
#   --champion '{"rating":{...previous settings...}}'
```

The gate reports challenger minus champion overall and per slice (Brier, log loss, accuracy), with 95% intervals from resampling whole events. It also reports calibration error in the 50–80% bands, and lists every slice whose Brier interval lies entirely above zero (a regression).

A change ships only if all of these hold:
- Brier improves on the tuning season.
- No slice regresses beyond noise.
- Calibration in the 50–80% bands is no worse.

2025–26 is reported as **reused** data. The live ledger, which records the engine version with each call, is the prospective test.

| Version | Change | 2024–25 (tuning) Δ Brier | 2025–26 (reused) Δ Brier | Gate |
|---|---|---|---|---|
| 2.7.0 | Priors: regional starting points (κ 20, learned from returning teams), carry-over ρ1 0.7 | −3.3×10⁻⁴ [−4.5, −2.1] | −2.4×10⁻⁴ [−3.5, −1.3] | [gate](gates/gate-2.7.0-priors-snapshot-2026-10-14.md) |
| 2.8.0 | Recalibration: log-odds × 1.0577, no intercept (rolling origins, forward-only) | −0.7×10⁻⁴ [−1.6, +0.2] | −1.9×10⁻⁴ [−2.6, −1.2] | [gate](gates/gate-2.8.0-recalibration.md) |
| 2.9.0 | Event-local form: auto 0.4 / TeleOp 0.2 of a robot's mean miss at the event, fading κ/(n+κ), κ 1 | −1.5×10⁻⁴ [−2.5, −0.4] | −1.8×10⁻⁴ [−2.7, −0.9] | [gate](gates/gate-2.9.0-event-form-snapshot-2026-10-14.md) |
| 2.10.0 | Fouls learn at 0.15× the scoring gain (score MAE 27.67 → 26.57 on 2025–26; Brier neutral) | −0.2×10⁻⁴ [−0.5, +0.2] | −0.7×10⁻⁴ [−1.9, +0.5] | [gate](gates/gate-2.10.0-fouls-snapshot-2026-10-14.md) |
| 2.11.0 | Alliance overlap in quals: −0.25 × weaker partner's auto, −0.15 × TeleOp | −2.1×10⁻⁴ [−3.5, −0.6] | −2.4×10⁻⁴ [−3.7, −1.1] | [gate](gates/gate-2.11.0-overlap-snapshot-2026-10-14.md) |

**Parts measured and closed without a build:**
- **Part 4, failure mixture and per-team variance** (`scripts/part4/failure-research.ts`):
  - Favourites with fragile robots already win at their stated rate (within about 2 points). The 2.1 model's failure and variance inputs price this.
  - 80% score ranges cover 80–85% for fragile alliances. Their misses fall above the range more than below it, so a downward failure mixture would be the wrong shape.
- **Part 7, playoffs:**
  - Playoffs are predicted better than quals (Part 1 report), with the same under-confidence, which 2.8 addressed.
  - A playoff calibration slice has no gap to close.
  - A defence term waits for a real defence rating.

The 2.8.0 slope was fitted on 2024–26 calls (`fits/recalibration-2.8.0.json`), so the 2.8.0 slice report is in-sample for it on those seasons. Its forward evidence is the rolling-origin gate.

## Part 8 research (priors)

`scripts/part8/priors-research.ts` measures the season-start priors. `scripts/part8/tune-priors.ts` grids prior settings and compares them pairwise.

What the measurements showed:
- **Carry-over by phase:** last season predicts this season's endgame about half as well as auto and TeleOp (slopes about 0.3 against 0.65). Even so, giving endgame less carry-over made every slice worse, so it stays at 1.
- **No-history teams vs teams with history:** in early matches, robots with no history beat the prior by about 2 points per robot, and robots with history miss by about 2. Moving the rookie z or the uncertainties doesn't help: the existing settings sit on a plateau.
- **Region:** the per-region bias of newcomers holds from season to season (r = 0.75). This is the signal 2.7 uses.
