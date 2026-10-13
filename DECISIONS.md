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

## Control Point PR — merged

- **[#242](https://github.com/Control-Point-FTC/control-point/pull/242) merged at 2026-10-12 ~21:45 ET** (merge commit `7c623441`) after
  every gate passed: Greptile 5/5 on the head commit with 0 unresolved
  threads, `npm run lint` + `npm run build` clean, all prediction tests
  green, and two equivalence proofs (99,503-match replay; PredictEngine
  booted from the live store → byte-identical output).
- **Not done by me — please check in the morning:** Control Point's
  AGENTS.md rule 3 asks to confirm the "Deploy to Oracle VM" run for the
  merge commit. My `gh run list` call was blocked by this session's
  permission policy, so I did not poll CI. Check
  `gh run list --repo Control-Point-FTC/control-point --workflow deploy.yml`
  for head SHA `7c623441…`, then the Predict page on tryctrlpoint.org.
- Full vitest runs on Windows showed a few unrelated files timing out under
  load (a different set each run); each passes alone. Pre-existing flakiness,
  not caused by the swap.
- The swap was done in a separate git worktree off `origin/main`; your local
  Control Point checkout was not touched (it is still 8+ commits behind
  origin — `git pull` when convenient).

## Data

- **FIRST is validated against FTC Scout before trusting it**: re-fetching
  seeded events (2023 BRPAQ, 2024 BRBHQ + BRCMP, 2025 AUSYQ1) from FIRST gave
  **zero** differences in any score component, lineup or award. Two
  normalisations were needed and are applied in `server/sources/first.ts`:
  (1) a two-alliance best-of-3 final is series 0 (FIRST says series 1,
  "Finals N") — the engine's bracket code expects series 0; (2) at some
  2026 scrimmages FIRST flags every robot `onField: false`, so an alliance
  with nobody on the field is read as "everyone listed played". Where FIRST
  and FTC Scout disagree on quals rank (FTC Scout recomputes ranks and lists
  no-shows), FIRST's official rank wins.
- **FIRST's `published` flag is not a visibility flag** (1,300 of 1,302
  2026 events are `false`), so every listed event is kept.
- **Match times**: FIRST reports event-local times with no zone; they are
  read as UTC everywhere (only ordering/gaps matter to the engine), so
  ratings don't depend on the server's time zone.
- **OPR = ridge-regularised, non-negative least squares, λ fitted = 0.5.**
  Shrinks toward the event's average per-robot contribution (not zero),
  constrained ≥ 0, quals only, surrogate/DQ alliance rows dropped.
  `scripts/fit-opr-lambda.ts`: held-out RMSE of next-matches' alliance np,
  λ grid {0…8}; λ=0.5 best on both 2024 (34.79 vs 36.08 unregularised) and
  2025 (26.43 vs 27.66). Alternative: plain OPR (what FTC Scout shows) —
  measurably worse and can go negative.

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

## Offline packs — measured, not estimated

- **Actual sizes (2026-10-13 build):** lite pack **1.65 MB** gzipped (5.0 MB
  raw: rating books for 4 seasons + 22,346 team names) — well under the
  10 MB budget. Full packs are **per season**, not one monolith: 2023
  24.6 MB, 2024 28.5 MB, 2025 36.9 MB, 2026 2.4 MB (so far) — **92.5 MB
  total**, vs the handoff's 250–350 MB estimate. They're SQLite files with
  indexes; they compress further but are served raw so they open directly.
  Build time ≈ 60 s for everything.
- Offline predictions use the lite pack's rating books with the same
  `explainMatch` as the server. The pack is verified against the manifest's
  SHA-256 before it's kept.

## Process (Sushil asked mid-build, 2026-10-12 ~22:30 ET)

- **Every Control Scout change now goes through a PR + Greptile to 5/5**,
  with screenshots for UI changes, captured before the PR opens. Written
  down in `AGENTS.md` (modelled on Control Point's) and the PR template.
- **The first PR contains the whole codebase.** Until then I'd committed to
  `main` directly. To get a reviewable diff from the start of the repo, I
  moved all work to `feat/control-scout-mvp` and reset `main` to the
  README-only first commit (`68d03a2`), then opened the PR. Nothing was lost
  (every commit is on the branch); merging the PR restores `main`.
- **`npm run shots` is the one capture tool.** The rule text referenced
  `bun run shots`, which exists in another repo, not here — so I built the
  equivalent once (Playwright: 2× scale, real waits, dedicated ports
  5199/3199, writes outside the repo, prints `--attach` args). Lesson
  learned while building it: port 5173 was taken by a Control Point dev
  server, and a generic health check happily screenshotted the wrong app —
  the tool now checks it's talking to Control Scout.
- **Notifications** are in-tab only (Notification API while the site is
  open); there's no background web push yet — said so on the settings page
  rather than promising more.
- **Typo-tolerant search** (Sushil's addition): next PR after the MVP —
  trigram/edit-distance fuzzy team names, number-prefix matching,
  search-as-you-type.
