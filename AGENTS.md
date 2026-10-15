# AGENTS.md

How to work in this repo (humans and coding agents alike). FTC Control Scout:
free FTC scouting + predictions for every team. Sister app of Control Point;
both run the shared engine in `packages/predict-engine`.

## Workflow

1. **Every change goes through a pull request.** Branch from `main`, push, and open the PR against `Control-Point-FTC/control-scout`. Never push to `main` directly.
2. **Greptile review to 5/5.** Trigger with a `@greptile review` comment, fix every finding, reply on and resolve each thread, push, and re-trigger. Merge only when the latest Greptile review is on the PR's **current head commit**, scores **5/5**, and **0 threads are unresolved**.
3. **Tests and types before pushing.** `npm run lint` (tsc) and `npm test` (vitest). A bug fix comes with a test that fails on `main` and passes on the branch.
4. **Engine changes are special.** Anything under `packages/predict-engine/` that can change a number needs: a version bump (semver), a `CHANGELOG.md` entry, a held-out backtest showing it is at least as good (`npm run stats -- --backtest`, compare the track record), and a matching Control Point PR that updates its vendored tarball — both apps always run the same engine version. A refactor must stay bit-identical (`npm run equivalence`).

## Screenshots and verification

5. **Frontend changes ship with screenshots, captured before the PR opens.** If the diff changes anything a user sees (pages, components, styles, copy), the PR body embeds at least one screenshot of the rendered change inline — before/after when the change is visual. A link out, a screenshot of code, or a promise to demo later does not satisfy this. A PR with no user-visible change writes "No user-visible change." in the template's Screenshots section rather than deleting it, so the reviewer sees the claim and can disagree.
6. **Capture with `npm run shots`, never a new script.** It starts the app on its own ports (5199/3199, so it can't hit another dev server), shoots at 2× scale, waits until data has loaded (network idle, no skeletons, fonts ready, animations settled), unrolls the scrolling shell for full-page shots, and writes PNGs **outside the repository**:
   ```bash
   npm run shots -- --both /teams/18360 "/events/2025/AUSYQ1?tab=odds"
   ```
   Flags: `--mobile` (390×844), `--both` (desktop 1440×900 + mobile), `--light`, `--viewport` (no full page), `--search "<text>"` (open the ⌘K palette and type), `--pointer` (mouse resting mid-page: hover states, ambient light), `--motion` (animations on), `--video <seconds>` (a .webm with the pointer moving — for motion changes), `--storage <file.json>` (localStorage to seed first, e.g. a populated shortlist), `--out <dir>`. It prints ready-made `--attach` arguments. Attach with the GitHub CLI (2.101 or newer; `gh --version`): `gh pr create --attach 'file.png#alt text'` or, after opening, `gh pr comment <n> --attach …`. `gh` cannot set alt text on a video attachment, so describe what a `.webm` shows in the PR text next to it. Never commit screenshots.
7. **Verify after deploying.** Once a deploy finishes, check the change on the live site and post a verification comment on the PR with a screenshot. Say plainly what couldn't be checked and why.

### Self-audit

Before calling a milestone done, run [docs/self-audit.md](docs/self-audit.md) using `npm run audit`, which sweeps every route at desktop and mobile size: console, overflow, labels, and loading/API-down states. Then run `npm run audit:flows`, which clicks through every feature, including the offline venue check on the production build (`npm run build` first). Log findings in `AUDIT.md`. Both tools reuse servers already running on 5199/3199, so stop stale ones after editing server code.

**Performance budgets.** `npm run audit:perf` builds the app and runs `scripts/perf.ts --budgets`. It fails if the home page takes over 3 s to become interactive (warm, throttled 4G), if home data exceeds 100 KB or the home page downloads the charts chunk, if a hot API route's warm p95 exceeds 300 ms, or if cold start takes over 20 s. CI (`.github/workflows/ci.yml`) runs the same check on every pull request, so a change that blows a budget fails its PR. `npm run perf -- --base <url>` measures a deployed site the same way (no cold start).

## Product rules (non-negotiable)

8. **No mock data anywhere a user can see.** Real data end to end, or the page says what's missing and why (e.g. "no schedule published yet").
9. **Predictions never present a guess as a fact.** Every prediction surface shows its confidence tier; probabilities never render as a flat 0% or 100% unless the outcome is already decided. Live (logged before the match) and backtest numbers are never blended.
10. **No video hosting, ever.** Recordings stay in the device's IndexedDB; only YouTube links sync.
11. **No login for browsing, search or predictions.** Accounts only sync personal data.
12. **Licenses:** FTC Scout is GPL-3.0 — reimplement its math, never copy its code. Repos without a LICENSE file are ideas only.

## Code conventions

13. **Migrations** are numbered entries in `server/db.ts` (`MIGRATIONS`), applied once each in a transaction. Never edit a migration that has shipped; add a new one.
14. **Season-specific game knowledge lives in one place:** `server/data/seasons.ts` (score breakdown → engine components). Everything else is season-blind.
15. **Shared types** between server and web live in `src/shared/`. The server may import from `src/shared`; the web app never imports from `server/`.
16. **Design language is Control Point's.** Tokens in `src/index.css`, components in `src/components/ui` (ported from Control Point's ui-kit). Vendored Arc UI pieces live in `src/components/arc` (add more with `node scripts/arc-add.mjs <name>`), themed via `arc-theme.css`. Secondary buttons must look like buttons.
17. **Secrets** only in `.env` (gitignored) and read only in `server/env.ts`. Never log them.
18. **Line endings:** LF (see `.gitattributes`). No spaces in file names.

## Useful commands

```bash
npm run dev            # API :3000 + web :5173
npm run sync           # FIRST (primary) / FTC Scout (fallback) → SQLite
npm run stats          # OPR, ratings, ledger, search index
npm run packs          # offline packs + /packs/latest.json
npm run shots -- …     # PR screenshots (see rule 6)
npm run equivalence    # engine == Control Point's, bit for bit
```
