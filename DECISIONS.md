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
- **OPR = plain least squares, identical to FTC Scout / FTC Events (2026-10-14, Sushil).**
  Teams compare our OPR with FTC Scout's, so a different number reads as a
  bug, whatever its statistical merit. Every played qual, every listed team
  (surrogates, DQs, no-shows included), TeleOp as FIRST reports it (endgame
  included from 2024). Verified identical to FTC Scout for every team at four
  events across 2023–2025. OPR doesn't drive predictions; the rating does.
  Superseded:
- **(was) OPR = ridge-regularised, non-negative least squares, λ fitted = 0.5.**
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

## Search (PR #2)

- **Typo tolerance uses SQLite's FTS5 trigram tokenizer for candidates, and
  edit distance (Damerau–Levenshtein) to rank them.** Trigrams reach "X Drive"
  from "X Drvie"; the edit distance decides what counts as close. Edits
  allowed per word: 0 up to 3 letters, 1 up to 7, 2 from 8 (two edits on a
  6-letter word turned "garden" into "warren" — a false hit we saw and pinned
  in a test). Every query word must match something.
- **Team numbers prefix-match as you type** via integer ranges on the
  primary key (16 → 16, 160–169, 1600–1699 …), current-season teams first,
  exact number on top. Sub-millisecond.
- UI: no new chrome — the same ⌘K box simply finds more. Results appear
  as you type (140 ms debounce); typical queries answer in 10–30 ms.

## UI pass (PR #3) — applying the UI brief

- **Team page's one job: "is this team good?" in 5 seconds.** The hero was
  ~60% decorative void. It's now two columns: who (name, place, season,
  actions) and *At a glance* (Top N% worldwide by OPR, OPR, rating ± sd,
  record, last event + rank, next event → odds). The answer is the biggest
  thing on the screen.
- **Moat surfaced where the user already is.** Every prediction (lab result
  card, every match row's tooltip) now says how calls at that probability
  have actually turned out — "When we say about 63%, the favourite wins 65%
  of the time — 4,433 matches" — linking to the track record. Team pages
  carry "Predict a match with <team>" (pre-fills the lab) and "Odds to
  advance" for the next event.
- **Hierarchy = usage on Home.** Search, then two large core-loop tiles
  (Who wins? → lab; Events), then This week and the Track record side by
  side on wide screens (no scroll needed to see the moat), then the quieter
  tools. With a team set, Home shows *its next match with odds* — the
  event-day "who wins our next match?" in one tap.
- **Nothing clickable feels dead.** One `.lift` hover (rise + volt edge
  glow, off under reduced motion) on every clickable card.
- **Screenshot test.** The lab's result card carries a brand footer
  (logo · FTC Control Scout · season · engine version); team pages get a
  Share button (copies the link).
- Search placeholder now says "typos are fine" — the capability is only
  useful if people know to lean on it.

## Ambient background (PR #4) — Sushil's request

- **Always on, no toggle needed**: Control Point's line grid, alive — lines
  drift one cell every 48 s, soft volt glows breathe at the top corners
  (9 s), and a light follows the pointer. Tuned "noticeable at rest, never
  competing": line alpha 0.075 (dark) / 0.07 (light), fading out toward the
  bottom of the screen via a mask, glow 0.16 dark / 0.22 light in volt
  (a grey glow looked like a smudge in light mode).
- **Cheap**: three layers behind the content, animated only with
  transform/opacity (composited — no repaint per frame); the pointer light
  moves with one rAF-throttled transform. Phones get no hover light.
- **Respectful**: `prefers-reduced-motion` → a still grid (no drift, no
  breathing, no pointer light). Settings → Appearance → "Animated
  background" switch (on by default) does the same for anyone who wants it.
- The grid moved off `.m-canvas` (which keeps only the top accent glow) onto
  a fixed layer under the scrolling `<main>`.
- `npm run shots` gained `--pointer`, `--motion` and `--video <s>` so motion
  changes can be shown in PRs (video = .webm with a scripted pointer).

## Self-audit (2026-10-13)

- **Service worker, hand-written, production only.** The "venue with no signal" promise needs the app itself to open offline, not just the lite pack. A 50-line worker plus a build step that lists every built file beats a PWA plugin dependency. Pages are network-first (fresh data when there's signal), and hashed assets and fonts are cache-first. `/api` and `/packs` are never cached by the worker: live data stays live, and offline predictions come from the lite pack in IndexedDB.
- **Tier always visible, never hover-only.** Dense lists get `TierMark` (icon + word) rather than the full badge. The rule "tier on every prediction surface" wins over row density.
- **Your teams rank first in search, after exact numbers.** My team, tracked and shortlisted teams/events are sent as `prefer`. They come right after an exact number match and get a small text-score bonus (+0.1), so they win near-ties but never beat a clearly better match.
- **Compare defaults to the latest season with results**, like the team page, because an empty current season made the page look broken.
- **Impossible team numbers never hit the API**, and 400/404 errors never offer "Try again".

- **Ship a public data snapshot with the app (2026-10-13).** The live site had no data because Turso and its secrets weren't connected, so every page and search was empty. FTC data is public, so `data/snapshot.db.br` (~33 MB, brotli) ships in the repo. A server booting with an empty local database restores it first. It's skipped once a remote database is configured, and private tables are always emptied when the snapshot is built. Trade-off: a 33 MB binary in git per refresh. Refresh rarely, and once Turso is connected the snapshot is only a fallback.

## Incidents, 2026-10-13 (Render free plan)

### 1. 12:10–12:25 pm EDT (16:10–16:25 UTC): site unreachable

**What users saw.** Connection timeouts on every URL, the home page included. No HTTP response at all.

**Root cause.** The event loop was blocked waiting on the network, not crashed:
1. At 15:30 UTC the service was pointed at Turso (`DATABASE_URL=libsql://…`). From 16:05 UTC (#12) it ran as a Turso **embedded replica**: reads are local, but **every write goes to the remote primary, and the libsql driver waits for each one synchronously on the main thread.**
2. FIRST credentials had just been added, so the startup data cycle did real work. It synced 10 events, then ran the stats job (OPR, ratings, prediction ledger, search rebuild), which writes thousands of rows.
3. Each of those writes was a blocking network round trip. While they ran, the server couldn't answer anything.

**Evidence.**
- Logs show `sync (startup)` at 16:08:12, `2026: 1338 events listed` at 16:10:59 and `stats for 145 teams` at 16:14:08, then nothing (no `search:` or `stats done`).
- Render reported "No open HTTP ports detected" from 16:08 to 16:16.
- CPU sat around 0.01 of 0.15 throughout (waiting on I/O, not computing), with memory stable at about 250 MB. No OOM and no failed deploy.

**Resolution.** At 16:25 UTC `DATABASE_URL` was removed (back to the local data file, where writes are instant). The new instance was ready at 16:27:04.

### 2. 12:55–1:03 pm EDT (16:55–17:03 UTC): restart loop

**Root cause.** #13 moved the data cycle into a worker thread so pages would keep answering. A worker is a **second V8 heap**. It ran alongside the server's rating book (~116 MB) and the 164 MB SQLite file inside a **512 MiB** container. Render killed it for memory (`server_failed`, `oomKilled: 512Mi`) at 16:55:37, 16:59:17 and 17:03:37. Each instance booted, started the cycle, got killed, and restarted.

**Resolution.** Reverted in #15 (merged immediately) and live at 17:04. No OOM since.

### Rules so this doesn't happen again
- **No synchronous remote writes on the request thread.** A remote database (Turso, even as a replica) is only for small, rare writes such as accounts. Bulk FTC data is written to a local file.
- **Memory budget:** on a 512 MB host, don't add a second isolate (worker) next to the rating book. Measure peak RSS for the full boot plus data cycle before merging anything that changes background work, and leave at least 25% headroom.
- **Verify a deploy by Render's own events,** not just `/api/health`: check for `server_failed` (OOM kills) for 10 minutes after a deploy that changes boot or background work.
- **The free plan is the wrong host for this app.** 0.15 CPU and 512 MB can't run the data cycle without freezing pages. The Oracle VM next to Control Point is the target (tasks 7–9).

## Hosting: Oracle VM primary, Render as rollback (2026-10-13)

- **Production moved to the Oracle VM:** https://controlscout.org, plus
  `www.controlscout.org` and `scout.tryctrlpoint.org`, on one certificate.
  It's the same VM as Control Point but its own user, port (3100), service and
  nginx site. Why: Render free (0.15 CPU, 512 MB, ephemeral disk, sleeps when
  idle) can't cold-start under ~20 s or keep the full events list under 300 ms
  (`docs/perf-report.md`). The VM restarts to ready in 8.7 s, and every hot
  route has a p95 at or under 70 ms.
- **Render stays as the rollback host (Sushil's call)** and gets every update.
  It rebuilds from main on its own. The deploy workflow (#23) checks that its
  `/api/health` reports that commit (or a newer one), and `/api/health` reports
  the running commit on both hosts (also #23). Render keeps the in-process data
  cycle and doesn't build packs (it serves the shipped ones); the VM runs the cycle in a child process
  (`DATA_CYCLE=child`), which needs more memory than Render has.
