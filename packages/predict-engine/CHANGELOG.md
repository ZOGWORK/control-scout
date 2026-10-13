# Changelog

## 1.0.0 — 2026-10-12

- Extracted from Control Point (`server/predict/*`), bit-identical: replaying
  2023–2025 (99,503 matches) gives the same ratings, match odds and event
  simulations as Control Point's in-repo engine.
- `inputs.ts`: the engine's own structural event types (`EventInput`,
  `FirstAdvancement`) replace imports from Control Point's app types.
- New (additive): `explainMatch` — win %, predicted scores + 80% ranges,
  top-3 factors, confidence tier. `RatingBook.baseline()` read accessor.
- `FITTED_MODEL` exported as a module (browser-bundle friendly), generated
  from `model.json`.
