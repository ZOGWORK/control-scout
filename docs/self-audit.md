# Control Scout — Self-Audit Runbook

**Run this yourself, automatically, after Phase 7 is feature-complete and before you declare the build done.** Nobody will tell you to start. When the build is done, you run this. When this is clean, you're done.

## 0. Setup

- Boot from a **clean state** (fresh container / new clone) following only the README. If the README is wrong or incomplete, fix the README first — that counts as an audit finding.
- Test at **two viewports**: desktop 1440×900 and mobile 390×844. Screenshot every page at both.
- Keep the browser devtools console open for the entire run. Any error or warning is a finding.

## 1. Functionality sweep — every route, for real

Go through each route and actually use it. Not "it renders" — click everything.

- **`/`** — global search finds teams, events, matches. Try a typo ("X Drvie"). Try a team number. Keyboard navigation works. Tracked teams rank higher.
- **`/teams/:number`** — OPR breakdown cards, trends chart with metric switcher, season switcher, event history, awards, recent matches. Bookmark / mark-as-my-team / track / compare buttons do what they say. "Manage this team in Control Point" link present.
- **`/events/:id`** — schedule, live/upcoming results, rankings, playoff bracket.
- **`/predict`** — alliance builder (any teams, both sides), real upcoming matches list. Every prediction shows win %, predicted score, top 3 factors, confidence tier. Advancement simulator works for ANY team + ANY event (chance to advance, captain/picked/win/finalist %, likely quals rank).
- **`/methodology#accuracy`** (old `/predict/accuracy` redirects here) — track record renders with real logged predictions, reliability stats, Brier score.
- **`/compare`** — head-to-head for arbitrary teams.
- **`/shortlist`,&#32;`/my-team`** — signed-in: syncs. Signed-out: local-only fallback works, and migrates on sign-in.
- **`/download`** — packs listed with version, size, sha256, season coverage; `/packs/latest.json` valid.
- **`/settings`** — all 8 sections work; theme/density changes apply immediately.
- **Scout** — create, edit, and delete match + pit entries; works offline-first; export/import JSON/CSV round-trips.
- **Video** — record in-app: verify in the network tab that **nothing uploads** (local device only). YouTube link embeds and plays.

## 2. The three states, everywhere

Every page must handle all three, verified by forcing them:

- **Loading** — throttle the network; skeletons/spinners, no layout jump.
- **Empty** — a team with no matches this season, an event with no data yet, a fresh account with no shortlist. Helpful empty states, never blank screens.
- **Error** — kill the API/backend mid-session. Every page shows a proper error state with a retry path. Nothing white-screens, nothing spins forever.

## 3. Data & prediction integrity

- **No mock data** anywhere a user can see. If something can't load real data, it says so explicitly.
- Predictions **never present guesses as facts** — confidence tier on every prediction surface, no exceptions.
- Hand-verify one prediction against a real completed match: do the factors make sense? Is the winner plausible?
- Shared package check: the Control Point swap PR passes its test suite and produces **zero visible UI changes**.

## 4. UI/UX audit — the check

For every page, both viewports, look at your screenshots and ask:

- What is the ONE thing this screen must deliver — is it the biggest, most obvious thing? If not, fix the layout.
- **Hierarchy = usage**: Home, Events, Prediction Lab dominate; secondary items recede. Nothing important is buried.
- Every interactive element responds (hover/tap states). **Buttons look like buttons.** Nothing clickable feels dead.
- Empty dark space audit: decorative voids get filled with information or wayfinding, or removed.
- Moat features are unavoidable: can a new user find the track record, the what-if lab, and offline packs without being told?
- Mobile 390px: no horizontal scroll, bottom-nav-style navigation works, forms are thumb-usable, nothing depends on hover.
- Family resemblance: dark graphite + volt, Control Point's design language — but FTC Scout's information density.
- **Screenshot test**: would a user share this page? If not, it's not done.
- Accessibility basics: labels on inputs, focus states, keyboard navigation, readable contrast.

## 5. Robustness

- **API down drill**: with the backend unreachable, the whole app degrades gracefully (error states, cached data where available).
- **Performance**: page loads feel instant; predictions compute without UI-thread jank (no synchronous Monte Carlo on the main thread).
- **Console clean**: zero errors, zero warnings across the full click-through.

## 6. Fix loop

- Log every finding as you go (keep `AUDIT.md` in the repo, or repo issues).
- Fix it, then **re-run the exact check that failed** — a fix isn't done until its check passes.
- Repeat until the entire checklist above passes **in one clean run**.

## 7. Sign-off

- All green in a single clean pass → write `AUDIT-REPORT.md`: what you checked, what you found, what you fixed.
- Anything you genuinely could not verify (needs a production API key, a real phone, etc.) → list it explicitly as **blocked/unverified**. Never fake it, never skip it silently.