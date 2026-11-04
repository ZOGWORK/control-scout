# Research item 11: an MLP baseline against engine 3.3.0 (comparison only)

**Verdict: the engine stays.** No MLP variant beats engine 3.3.0 on walk-forward Brier, in either season. The best one, built on the engine's own pre-match ratings, is still worse on every metric, and every interval excludes zero against it. Nothing changes in `packages/predict-engine`.
- **Correction (Greptile on #505):** the engine-ratings variant was rerun after a fix. Its ratings are now read under the event as well as the region, exactly as `predictMatch` reads them. That moved its numbers by a few ×10⁻⁴; the other variants don't use ratings.
- Script: `scripts/research/mlp_baseline.py` (with `scripts/research/mlp-export.ts`).
- Output: `mlp-baseline-2026-11-03.json`.

## Measured

Each row is MLP minus engine on identical matches: decisive matches at rated events, every month from October 2024 to July 2026. 2024–25 has 32,974 matches and 2025–26 has 36,572.
- Brier and log loss are ×10⁻⁴; accuracy is in points; margin MAE is in game points.
- **Negative Brier, log loss or MAE, and positive accuracy, would favour the MLP.**
- The intervals are 95% event bootstraps. The rows show seed 0; seed spread is in the next table.

| Variant / config | Season | Engine Brier | MLP Brier | Δ Brier [95%] | Engine acc | MLP acc | Δ acc [95%] | Δ log loss [95%] | Engine MAE | MLP MAE | Δ MAE [95%] |
|---|---|---|---|---|---|---|---|---|---|---|---|
| paper / paper config | 2024–25 (tuning) | 0.1579 | 0.2005 | +426.2 [+403.9, +447.7] | 76.53% | 69.55% | −6.98 [−7.49, −6.46] | +1198.8 [+1136.4, +1258.2] | 38.84 | 46.53 | +7.68 [+7.22, +8.13] |
| paper / paper config | 2025–26 (reused) | 0.1681 | 0.2047 | +365.3 [+345.2, +385.2] | 74.79% | 68.55% | −6.24 [−6.74, −5.73] | +983.3 [+931.9, +1035.4] | 37.48 | 43.29 | +5.82 [+5.44, +6.19] |
| paper / grid pick (32, 16), α 1e-2 | 2024–25 (tuning) | 0.1579 | 0.1840 | +260.8 [+245.2, +276.8] | 76.53% | 72.12% | −4.41 [−4.85, −3.96] | +687.8 [+647.9, +728.4] | 38.84 | 45.00 | +6.16 [+5.75, +6.57] |
| paper / grid pick (32, 16), α 1e-2 | 2025–26 (reused) | 0.1681 | 0.1894 | +212.4 [+196.9, +226.4] | 74.79% | 71.05% | −3.74 [−4.17, −3.31] | +541.3 [+502.4, +576.7] | 37.48 | 41.87 | +4.39 [+4.08, +4.71] |
| paper+n / grid pick (32, 16), α 1e-2 | 2024–25 (tuning) | 0.1579 | 0.1797 | +217.5 [+203.0, +231.7] | 76.53% | 72.39% | −4.14 [−4.56, −3.70] | +565.8 [+529.2, +601.9] | 38.84 | 43.41 | +4.57 [+4.20, +4.94] |
| paper+n / grid pick (32, 16), α 1e-2 | 2025–26 (reused) | 0.1681 | 0.1851 | +169.1 [+155.0, +182.3] | 74.79% | 71.52% | −3.27 [−3.69, −2.85] | +421.3 [+386.7, +454.6] | 37.48 | 41.11 | +3.64 [+3.34, +3.93] |
| engine-ratings / paper config | 2024–25 (tuning) | 0.1579 | 0.1796 | +216.5 [+200.7, +233.3] | 76.53% | 73.28% | −3.25 [−3.67, −2.85] | +691.2 [+643.7, +740.7] | 38.84 | 41.68 | +2.83 [+2.56, +3.08] |
| engine-ratings / paper config | 2025–26 (reused) | 0.1681 | 0.1844 | +162.2 [+150.4, +174.3] | 74.79% | 72.26% | −2.53 [−2.90, −2.21] | +484.4 [+449.1, +521.0] | 37.48 | 38.94 | +1.46 [+1.24, +1.69] |
| engine-ratings / grid pick (32, 16), α 1e-2 | 2024–25 (tuning) | 0.1579 | 0.1648 | +68.5 [+59.8, +77.9] | 76.53% | 75.55% | −0.98 [−1.31, −0.68] | +195.2 [+171.5, +220.2] | 38.84 | 40.31 | +1.46 [+1.24, +1.68] |
| engine-ratings / grid pick (32, 16), α 1e-2 | 2025–26 (reused) | 0.1681 | 0.1718 | +36.1 [+30.7, +41.2] | 74.79% | 74.34% | −0.46 [−0.69, −0.24] | +99.9 [+84.9, +114.3] | 37.48 | 37.93 | +0.45 [+0.33, +0.57] |

On qualification matches alone the picture is the same. For example, the engine-ratings grid pick on 2025–26 quals is +36.6 [+30.3, +42.6], and the paper config is +364.2 [+343.5, +385.6]. Every run's quals-only numbers are in the JSON.

### Seeds, and the train vs test gap

- Brier is shown as mean ± sd over seeds.
- **Train** is each origin's in-window fit scored on its own training matches. **Test** is the month after. Both are averaged over that season's origins, weighted by test matches.

| Variant / config | Season | Seeds | MLP Brier | Δ Brier range (×10⁻⁴) | Train / test Brier | Train / test accuracy | Train / test MAE |
|---|---|---|---|---|---|---|---|
| paper / paper config | 2024–25 | 3 | 0.2017 ± 0.0012 | +426.2 to +449.2 | 0.1424 / 0.2017 | 79.1% / 69.4% | 34.75 / 46.51 |
| paper / paper config | 2025–26 | 3 | 0.2058 ± 0.0010 | +365.3 to +385.2 | 0.1462 / 0.2058 | 78.5% / 68.4% | 39.02 / 43.45 |
| engine-ratings / paper config | 2024–25 | 1 | 0.1796 | +216.5 | 0.1276 / 0.1796 | 81.6% / 73.3% | 32.00 / 41.68 |
| engine-ratings / paper config | 2025–26 | 1 | 0.1844 | +162.2 | 0.1299 / 0.1844 | 81.2% / 72.3% | 35.14 / 38.94 |
| paper / grid pick | 2024–25 | 5 | 0.1839 ± 0.0001 | +258.7 to +260.8 | 0.1863 / 0.1839 | 71.4% / 72.0% | 39.11 / 44.95 |
| paper / grid pick | 2025–26 | 5 | 0.1893 ± 0.0001 | +209.2 to +212.4 | 0.1855 / 0.1893 | 71.7% / 71.1% | 43.42 / 41.92 |
| paper+n / grid pick | 2024–25 | 5 | 0.1796 ± 0.0001 | +216.3 to +217.8 | 0.1809 / 0.1796 | 72.0% / 72.5% | 37.96 / 43.39 |
| paper+n / grid pick | 2025–26 | 5 | 0.1850 ± 0.0001 | +167.7 to +169.2 | 0.1809 / 0.1850 | 72.2% / 71.5% | 42.31 / 40.92 |
| engine-ratings / grid pick | 2024–25 | 5 | 0.1648 ± 0.0001 | +68.4 to +69.7 | 0.1684 / 0.1648 | 74.5% / 75.6% | 35.45 / 40.32 |
| engine-ratings / grid pick | 2025–26 | 5 | 0.1717 ± 0.0001 | +34.2 to +38.0 | 0.1661 / 0.1717 | 75.3% / 74.3% | 39.00 / 37.93 |

- **Seed variance is far smaller than the gap to the engine.** The paper config's Brier moves by about 0.001 between seeds; the small nets move by about 0.0001.
- **The paper's config overfits here, as its own numbers suggested** (93.48% train against 84.08% test there):
  - On the paper features it scores 79% on its training window and 69% on the month after.
  - On engine-ratings it scores 81–82% in the window and 72–73% after.
  - The small nets the grid picked show almost no gap. Their test accuracy is often above train, because a month late in a season is easier than the mixed-season window it was fitted on.

### Grid (2024–25 Brier, seed 0)

| Variant | (16) α 1e-4 | (16) α 1e-2 | (16) α 1 | (32, 16) α 1e-4 | (32, 16) α 1e-2 | (32, 16) α 1 | Paper (50×4) α 1e-4 |
|---|---|---|---|---|---|---|---|
| paper | 0.1841 | 0.1842 | 0.1855 | 0.1843 | **0.1840** | 0.1852 | 0.2005 |
| paper+n | 0.1797 | 0.1797 | 0.1814 | 0.1798 | **0.1797** | 0.1810 | not run |
| engine-ratings | 0.1648 | 0.1649 | 0.1661 | 0.1648 | **0.1648** | 0.1658 | 0.1796 |

## Reading it

- **The decision rule is not close to met.** The MLP wins only if it beats the engine on walk-forward Brier, with the interval excluding zero in its favour, and loses nothing on accuracy or margin MAE.
  - Every fully measured run (the paper config, and each variant's grid pick) is worse on Brier in both seasons, on every seed, with intervals well above zero. Every one is also worse on accuracy, log loss and margin MAE.
  - The other grid cells were measured on the tuning season only (classifier, seed 0, Brier). None of them came within 0.006 Brier of the engine there, and the grid table shows each one. Their 2025–26 numbers, intervals and margin errors were not measured.
- **The paper's features are the main loss.**
  - A season-to-date mean of alliance scores has no prior for a robot's first matches, no carry-over from last season, and no adjustment for who its partners were.
  - The engine has all three. On the tuning season the paper features cost about 0.026 Brier even with the best small net.
  - Adding the match counts (paper+n) recovers about a sixth of that.
- **The MLP head adds nothing on top of the engine's own inputs.**
  - Fed the engine's pre-match per-phase ratings, the best net still trails by +68.5×10⁻⁴ on the tuning season and +36.1×10⁻⁴ on 2025–26 (seed 0).
  - The engine turns the same ratings into a calibrated probability through its noise model, uncertainty, reliability and contextual terms. A generic classifier fitted on 365 days does not find more than that.
- **The served engine is partly in-sample on both seasons. A forward-only rebuild shows this is worth almost nothing.**
  - The engine's contextual coefficients were fitted on 2023–24 plus 2024–25 before 2025-01-01, and its rating settings were tuned on 2024–25.
  - Its final stretch (slope 1.057692) was fitted on rated matches from 2024-07-26 to 2026-07-26, which covers both scored seasons.
  - The MLP, by contrast, is refitted every month on strictly earlier data.
  - `scripts/research/engine_forward_check.py` rebuilds a forward-only stretch. It takes the engine's probability before the stretch (`--champion '{"rating":{},"recalibration":false}'`) and refits the slope on each rolling origin, as Part 12.5 did. The fitted slopes range from 1.04 to 1.10. Output: `engine-forward-check-2026-11-03.json`.
  - Served minus forward-only Brier (×10⁻⁴): +0.01 [−0.30, +0.31] on 2024–25 and −0.48 [−0.71, −0.25] on 2025–26.
  - So the stretch's in-sample advantage is at most about 0.7×10⁻⁴. The smallest MLP deficit is +34.2×10⁻⁴ (the best seed on 2025–26; seed 0's interval starts at +30.7), so the verdict stands against a forward-only engine too.
  - On 2025–26 that forward-only engine is out-of-sample for the coefficients and the settings as well. Only 2024–25 keeps the coefficient and settings caveat.
- **The paper's 84.08% has no bearing here.** It is a different competition, three-robot alliances, and a random split that lets the model train on matches after the ones it predicts.

## Not pursued

- **Wider grids around the 4×50 net.** Its alpha, early stopping and learning-rate neighbours were not searched: each fit takes about 11 minutes. Its gap to the small nets (about 0.016 Brier on both feature sets) is in the wrong direction for a deeper search to close a 0.007–0.026 deficit.
- **An MLP as a stacker over the engine's own probability.** That would be a calibration challenger, not the paper's baseline. Part 12.5 already found the calibration family right.

## The question

The research brief's primary source (Galbiati et al., WPI, 2023) predicts FRC match winners with a scikit-learn multilayer perceptron on per-alliance skill-category features. Item 11 asks whether that kind of model beats the shipped engine **on the walk-forward protocol the engine is judged on**, not on a random split.

The paper's 84.08% test accuracy is mentioned here only as a reference: it comes from a different competition (FRC, 3-robot alliances, 2017–2019) and a random 85/15 split. It is not a target and is not compared with any number below.

## Method

**Protocol** (the Part 9 / Part 12.5 rolling origins, as in `docs/engine/part12/isotonic.md`):
- Each month from October 2024 to July 2026 is scored by a model fitted on the 365 days before it. A month is skipped if it has fewer than 50 test matches or fewer than 2,000 training matches.
- Only decisive matches (no ties) at rated events are trained on or scored. Every prediction is pre-match.
- **2024–25 is the tuning season**: the grid is chosen on it. **2025–26 is reused**: it was already examined for earlier engine work, so it is reported, not proof.
- **Engine numbers** are engine 3.3.0's served pre-match calls: `engine-slices --rows` on a copy of `data/snapshot.db.br` (snapshot 2026-10-14, seasons 2023–2025). Both models are scored on the same matches, joined by match key.
- **Intervals** come from event bootstraps (2,000 draws; whole events resampled; ratios of sums), as `pairedMetrics` computes them. Every Δ is MLP minus engine, so a negative Brier, log loss or MAE means the MLP is better, and a positive accuracy means the MLP is better.

**Features** (strictly pre-match; matches that share a start time are featurised before any of them is folded in). There are three variants, each labelled below:
- **paper** (8 features), the paper's construction mapped onto FTC's phases:
  - For each robot and each category (auto, TeleOp, endgame, fouls), take the mean of its alliances' scores over its earlier qualification matches this season, at rated events. Fouls are the penalty points the alliance gave away.
  - Normalise per season against the season-to-date maximum alliance score in that category. Fouls are inverted (1 − x).
  - Alliance value = mean of its two robots. That gives 4 categories × 2 alliances.
  - A robot with no earlier qualification match takes the season-to-date mean.
- **paper+n** (10 features): paper, plus each alliance's fewest earlier qualification matches (log1p). This lets the net discount thin data.
- **engine-ratings** (8 features): the engine's own pre-match per-phase ratings (auto, TeleOp, endgame, penalties), summed per alliance and divided by the season-to-date mean alliance score in that phase. They are read from a champion `RatingBook` replayed exactly as `engine-slices` replays it.

**Models:**
- `MLPClassifier` (win) and `MLPRegressor` (margin = red total − blue total), with a `StandardScaler` in front of each.
- **Paper config:** hidden (50, 50, 50, 50), tanh, adam, alpha 1e-4, constant learning rate, max_iter 200.
- **Grid** (tuning season only, seed 0): hidden (16) and (32, 16), each with alpha 1e-4, 1e-2 and 1, plus the paper config itself.
  - The paper net takes about 11 minutes per fit on this machine, so its alpha and early-stopping neighbours were not searched.
  - Early stopping was dropped after a probe stopped a 16-unit net at 14 epochs, badly under-fitted.
- **Colour symmetry:** every model trains on each match and its mirror (red and blue swapped). It predicts p = (f(red, blue) + 1 − f(blue, red)) / 2, and margin likewise, as the engine does.
- **Seeds:** the paper config ran on 3 seeds with the paper features and on seed 0 with engine-ratings (compute budget); each variant's grid pick ran on 5 seeds. A seed fixes sklearn's initialisation and batch order.

## Reproduce

```bash
node -e "require('fs').writeFileSync('snap.db', require('zlib').brotliDecompressSync(require('fs').readFileSync('data/snapshot.db.br')))"
cp snap.db snap2.db
DATABASE_URL=file:snap.db npm run slices -- --seasons 2023,2024,2025 --out <tmp> --rows engine-rows.json.gz
DATABASE_URL=file:snap2.db npx tsx scripts/research/mlp-export.ts --out matches.json.gz
python -m venv <venv> && <venv>/Scripts/python -m pip install -r scripts/research/requirements.txt
<venv>/Scripts/python scripts/research/mlp_baseline.py --matches matches.json.gz --engine-rows engine-rows.json.gz --out docs/engine/research-2026-11/mlp-baseline-2026-11-03.json --jobs 15
```

- Scripts: `scripts/research/mlp-export.ts` and `scripts/research/mlp_baseline.py`. The versions are pinned in `scripts/research/requirements.txt` (Python 3.14).
- Output: `mlp-baseline-2026-11-03.json`, which holds every seed, every origin and the grid.
