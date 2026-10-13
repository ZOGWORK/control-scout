# Decisions log

Every judgment call made during the overnight build (2026-10-12 → 13), for
morning review. Format: **what I chose** — why — the alternative.

## Agreed before the run (with Sushil)

- FIRST Events API is primary (his credentials, in `.env` only); FTC Scout is fallback.
- Repo `Control-Point-FTC/control-scout`, **private**, GPL-3.0.
- Control Point prediction PR: merge overnight only if Greptile 5/5 + CI green.
- Homepage: search first → events this week → track-record strip → quick links.
- Sign-in: email codes via Resend, live; sender `Control Scout <verify@tryctrlpoint.org>` (the only verified Resend domain). Google sign-in built but dormant until keys exist.
- Track record: **Live** (predictions logged before the match) and **Backtest** (walk-forward replay of past seasons) shown separately, never blended.
- No deploy overnight. A tested deploy script + runbook for `/opt/control-scout` on the Oracle VM is left for the morning.

## Engine

- **The package is a verbatim extraction first (v1.0.0), improvements second.**
  Control Point's engine turned out to be far more advanced than the
  handoff implied (EPA-style component ratings, fitted score noise, Platt
  calibration, full event Monte Carlo with real brackets and advancement
  rules, backtest: 72.7% match accuracy / Brier 0.179 on 37k 2025–26
  matches). Several of the research report's 13 improvements are already in
  it (#1 fitted win mapping, #6 closed-form match odds, #8 live ledger,
  #10 cross-season priors, #11 surrogate/unplayed hygiene). So v1.0.0 is
  bit-identical to Control Point (proved on 99,503 real matches by
  `scripts/engine-equivalence.ts`), and every later change must beat it on a
  held-out backtest before it ships. Alternative: rewrite from the report's
  OPR sketch — rejected, it would be a downgrade.
- **New in 1.0.0 (additive only): `explainMatch`** — the handoff's output
  contract (win %, predicted scores, top-3 factors, confidence tier) built on
  the existing `predictMatch`, so Control Point's numbers are untouched.
  Factors are an exact decomposition of the predicted margin by component.
- **Confidence tiers are a stated rule, not a fitted value**: provisional if
  any robot has < 3 matches this season (or the season hasn't started);
  confident if every robot has ≥ 8 and rating uncertainty is < 15% of
  outcome variance; otherwise moderate. Labelled as a rule on the methodology
  page; the ledger reports accuracy per tier so it can be tuned with evidence.
- **Control Point consumes the engine as a vendored, pinned tarball**
  (`vendor/control-scout-predict-engine-<version>.tgz`, `file:` dependency).
  Both repos are private, so a git/registry dependency would need a new CI
  secret; the tarball ships through Control Point's existing deploy (its
  workflow already runs `npm install` on the VM when the lockfile changes),
  and the lockfile's integrity hash proves both apps run the same bytes.

## Data

- **History is seeded from Control Point's local FTC Scout cache** (2022–2025
  raw `eventByCode` responses, real data) so pages work immediately; the
  FIRST sync then backfills/overrides as primary. The current season
  (2026–27) has 1,302 events listed by FIRST but none with played
  qualification matches as of 2026-10-12 — current-season pages will be
  thin until events run. That is the real state, not a gap.
- **Seasons covered:** 2023 (CENTERSTAGE), 2024 (INTO THE DEEP), 2025
  (DECODE), 2026 (current). 2022 data is in the cache but not shipped (out of
  the agreed four).

## Product calls made overnight

- **Match video recorder is new code, not a port**: Control Point has no
  recorder (verified: no MediaRecorder anywhere in its history). Built fresh:
  recordings stay in the device's IndexedDB, never uploaded; YouTube links
  are the only "hosted" option.
