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
