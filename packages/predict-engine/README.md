# @control-scout/predict-engine

**Prediction Engine 3.0.** The FTC prediction engine shared by **Control Scout** and **Control Point**.
One package, one version, both apps — predictions can never be better in one
app than the other.

Pure TypeScript: no network, no Node APIs. The same module runs on the server
and in the browser (offline predictions from a stats pack).

## What's inside

| Module | What it does |
|---|---|
| `rating` | `RatingBook`: per-team, per-component (auto / TeleOp / endgame / penalties) contribution ratings, updated after every match with a gain that shrinks with experience; cross-season priors via z-scores; (2.7) regional prior offsets learned from returning teams; season growth. |
| `matchModel` | `predictMatch`: alliance score ~ Normal(mean, σ²) with fitted noise σ = a + b·mean plus rating uncertainty; raw P(win) = Φ(Δ/σ). 2.2: each alliance also gets a stated 80% score range from its own predictive distribution (`allianceScoreDistribution`, `teamScoreVariance`, `scoreBand`), which widens for small samples and for robots whose results swing (per-team variance factor) and never feeds the win probability. |
| `contextual` | The engine's win probability: a frozen logistic correction of the raw P(win) from match context and per-robot reliability and form state (2.1: 22 inputs; the 2.0 17-input model is its fallback for books with 2.0 state), with its own calibration. Falls back to the Platt-calibrated raw P(win) when a book has no reliability state. |
| `explain` | `explainMatch`: win %, predicted scores with 80% ranges, top-3 factors (an exact split of the margin), confidence tier, and (2.4) the strongest partnership fact. |
| `partnership` | Partnership memory (2.4): a pair table of real results together and against, from 2019–20 on (season-free standardized residuals, shrunk toward zero), its compact serialized form for offline packs, and the fact shown with a prediction. Reasons only in 2.4: `PARTNERSHIP_PARAMS` has β = 0, so it never moves the odds. |
| `sim` + `rules` | Monte Carlo of a whole event: quals with real RP/tiebreak rules, alliance selection (fitted pick model), double-elimination playoffs, advancement points / order. |
| `forecast` | `Forecaster`: everything an app needs to forecast an event from ratings + live event data (apps subclass it to supply data). |
| `awards` | Judged-award model (conditional logit on award history + robot strength). |
| `calibration`, `metrics` | Platt scaling; Brier, log loss, accuracy, reliability tables, ECE. |
| `scoutData` | Parser from FTC Scout `eventByCode` responses to season-generic `EventRecord`s. |
| `model` | `FITTED_MODEL`: the fitted parameters and their back-test accuracy. |

## Versioning

Semver. Any change to numbers is at least a minor bump and must beat the
previous version on a held-out back-test (`npm run stats -- --backtest` in
Control Scout). 1.0.0 is a bit-identical extraction of Control Point's
engine; 2.0.0 adds the contextual win probability and a new serialized
per-team state (`RatingBookData.reliability`, `stateVersion` 1).

Releasing: bump `package.json` and `ENGINE_VERSION`, add a CHANGELOG entry,
`npm run build -w @control-scout/predict-engine`, `npm pack` in this folder,
and vendor the tarball into Control Point in the same release
(`npm run equivalence` checks the two are byte-identical).
