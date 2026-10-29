# Self-audit log

Running [docs/self-audit.md](docs/self-audit.md) after the build met spec
(PRs #1–#5 merged, 2026-10-13). Every finding is logged here as it is found,
then fixed and re-checked with the exact check that failed. Final sign-off is
in [AUDIT-REPORT.md](AUDIT-REPORT.md).

## Tooling built for the audit

* `npm run audit` (scripts/audit.ts): every route at desktop 1440×900 and
  mobile 390×844 on the real servers. It records console errors and warnings,
  page errors, failed requests, horizontal overflow, controls with no
  accessible name, blank pages and mock-looking text. It also forces the
  loading state (API delayed 4 s) and an API-down state (every /api call
  refused). Screenshots of every route at both sizes are saved for the visual
  review.
* `npm run audit:flows` (scripts/audit-flows.ts): click-throughs in a real
  browser. Covers search, the team-page buttons, the prediction lab, the
  advancement simulator, settings, scouting (create, edit, delete, offline,
  export and import), video (fake camera, upload watch), the offline venue
  scenario on the production build, and pack checksums.
* `server/auth/auth.test.ts`: accounts over HTTP on an in-memory database.
* Server start-up moved to `scripts/lib/servers.ts`, shared by shots and audit.

## Findings

| # | Area (§) | Finding | Fix | Re-check |
|---|---|---|---|---|
| A1 | Setup (§0) | README left out `npm run packs`, the hosting runbooks and the PR/audit/db tools, and didn't say what works without FIRST credentials. My first draft of the fix then wrongly claimed events load on demand without FIRST. | README: packs step, Tools table, Hosting section, and an accurate credentials note: sync needs FIRST to list events, and falls back to FTC Scout per event. | Fresh clone, README steps only: install; lint; tests; build; `sync --season 2026 --limit 15`; `stats`; boot. `/api/health` ok, and "X Drvie" finds 16321 X Drive. ✅ |
| A2 | Console (§5) | 48 × Motion "You have Reduced Motion enabled…". Investigated: it is Motion's **development-only** notice that it *is* honouring reduced motion (motion-dom `warnOnce(shouldReduceMotion !== true)`), stripped from production builds. Not a defect. | Made the intent explicit: `<MotionConfig reducedMotion="user">` app-wide. The sweep ignores that one dev-only notice. | Sweep: 0 console findings. ✅ |
| A3 | Error states (§2) | `/teams/99999999` said "Couldn't load this" and offered **Try again**, which can never work for an impossible number. The 400 also logged a console error. | The team page checks 1–999999 before asking the API: "There's no team 99999999", plus a **Search teams** button. `ErrorState` no longer offers a retry for 400 or 404. | Sweep `/teams/*`: 0 findings; screenshot reviewed. ✅ |
| M1 | Mobile (§4) | An upcoming event opens on its **Odds** tab, which sat off-screen in the 5-tab bar at 390 px (only a yellow sliver showed). | Shared `TabsTrigger` scrolls the selected tab into view when the list scrolls sideways (every tab bar benefits). | Mobile screenshot of `/events/2026/USALATQ`: Odds is fully visible. ✅ |
| M2 | Mobile (§4) | The season switcher overflowed its card at 390 px ("2023–24" clipped). | `SeasonToggle`: tighter items on phones; scrolls instead of overflowing. | Mobile screenshots of Prediction lab and Shortlist. ✅ |
| M3 | Mobile (§4) | Home search placeholder cut off mid-word ("typos are fi…"). | Shorter phone copy. The first try ("Team, event or match… typos are fine") still truncated in the PR screenshot, so it's now "Teams, events, matches…". | Mobile screenshot: fits. ✅ |
| M4 | Mobile (§4) | `/predict?mode=advancement`: the page was 542 px wide at 390 px (long event names stretched the grid). | `min-w-0` / `minmax(0,1fr)` on the picker grid so names truncate. | Sweep route: 0 findings (was `h-overflow main 542 > 390`). ✅ |
| U1 | UI (§4) | Compare opened on the current season, where most teams have no results yet: empty cards and empty charts. | `/api/compare` without `?season` picks the latest season any of the teams has results in (like the team page), and the switcher shows it. | Screenshot: 18360 vs 24089 opens on 2025–26 with OPR cards, charts and 5 head-to-heads. ✅ |
| U2 | UI (§4) | Empty-space audit: the event header's right half was an empty gradient on desktop. | "At a glance" panel from real data: % of decided matches called right here, who won, #1 seed, top OPR, advancement slots. Upcoming events get a "Who advances? See the odds" button. | Desktop and mobile screenshots of a finished and an upcoming event. ✅ |
| U3 | UI (§4) | First visits to My team and Shortlist were mostly empty dark space. | My team: what the dashboard will show, in four tiles beside the picker. Shortlist: **Find a team** and **Browse events** buttons. Scout: says it works with no signal. | Desktop and mobile screenshots. ✅ |
| U4 | UI (§4) | **No season switcher showed which season was selected**, on any page. Cause: `TooltipTrigger asChild` sat on the toggle item, and Radix Tooltip's `data-state="closed"` overwrote the item's `data-state="on"`. | The tooltip now wraps the label inside the item. Checked every other `TooltipTrigger asChild`: all wrap plain buttons or links. | Crop of Compare: 2025–26 visibly selected. ✅ |
| P1 | Integrity (§3) | **Confidence tier was hover-only on match rows** (event, team and My team lists) and missing on Home's "Next" card. That breaks both "tier on every prediction surface" and "nothing depends on hover". | `TierMark`: a compact, always-visible tier (icon + word, colored per tier) in every match row and on Home. The upset alert names the tier. | Screenshot: "✓ Called · provisional · backtest" under each prediction. ✅ |
| S1 | Search (§1) | **Tracked teams didn't rank higher**: no boost existed. For number searches the server returns only 15, so a client re-sort couldn't fix it. | The client sends my team, tracked and shortlisted teams/events as `prefer`. The server ranks them right after an exact-number match, and gives them +0.1 in text ranking (wins near-ties, never beats a clearly better match). | Unit test (new) plus flow: after tracking 16321, "16" gives team 16 (exact), then 16321. ✅ |
| F1 | Accounts (§1) | **No tests covered sign-in or sync at all.** | `server/auth/auth.test.ts` over HTTP: email code; 5-try limit; single-use codes; newer-wins sync; first-sign-in merge (newer account value kept, shortlists united); private scouting sync; logout. | 7/7 pass. ✅ |
| O1 | Offline (§1, §5) | **No service worker.** Opening or reloading the app with no signal loaded nothing, so the lite pack the Download page promises for venues was unreachable unless a tab happened to stay open. | `public/sw.js` plus a build step listing every built file and font in `sw-precache.json` (versioned). It precaches at install. Assets and fonts are cache-first; pages are network-first with the cached shell as fallback. `/api` and `/packs` are never cached. Registered in production only, and served no-cache. | Flow on the production build: lite pack saved, then offline. Reload opens the app; an unvisited page (/methodology) opens from the precache; a match prediction runs from the lite pack, labelled offline, with a tier. ✅ |
| O2 | Offline (§5) | While offline the app still fired requests that could only fail: console `ERR_INTERNET_DISCONNECTED` from `apiFetch` and the pack-manifest check. | `apiFetch` and `fetchManifest` answer "You're offline" at once when `navigator.onLine === false`, with the same error the failed fetch gave. | Scouting flow offline: console clean. ✅ |
| A4 | Error states (§2) | A valid but unknown team (`/teams/999997`) ended at "Not found" with no way forward. The sweep flagged it as near-blank. (Found once the audit route stopped pointing at 99999, which is a real FIRST demo team.) | Every not-found or invalid error state (`ErrorState`, 400/404) now offers **Search teams and events**. | Sweep `/teams/*`: 0 findings. ✅ |
| T1 | Tooling | Twice, flows ran against stale dev servers left on the tool ports (3199/5199) by an earlier run; the tools reuse a running server. Root cause: `audit:flows` calls `process.exit()` right after `stopServers()`, whose `taskkill` was started asynchronously and never ran. | `stopServers()` (and the venue flow's production server) now kill with `spawnSync`, so the kill finishes before exit. | Ports checked empty after a full flows run. ✅ |
| D1 | Error states (§2) | Found once the stricter state checks (R8) also slowed and refused `/packs`: with the server unreachable, Download said "No packs yet — Failed to fetch". That message is wrong (packs exist), shows a raw browser error, has no retry, and ignores a pack already saved on the device. | `ManifestError` tells "none published" apart from "unreachable". Download then shows "Couldn't check for packs", a **Try again** button, and "Already on this device: lite pack …, offline predictions use it". | Sweep `/download` (slow + down): 0 findings. ✅ |

### Code review of this PR (Greptile round 1: 2/5, 8 findings), fixed in the audit

| # | Finding | Fix | Re-check |
|---|---|---|---|
| R1 | The service worker never updated: `sw.js` was byte-identical across builds, so browsers never reinstalled it. | The build emits `sw.js` from `src/sw.template.js` with this build's version (time + content hash) and file list embedded, so every release changes its bytes. Assets fetched but not precached are cached too. | New flow on the production build: build A, then rebuild B → new worker installs and a new cache appears. ✅ |
| R2 | `skipWaiting` + deleting old caches broke tabs still running the old build (lazy chunks gone). | The two newest release caches are kept; lookups search every kept cache. | Same flow: the previous release's cache survives the upgrade, and the app opens offline after it. ✅ |
| R3 | The event header's accuracy blended live and backtest calls (and so did the Matches tab line). | `callRecord()` keeps them apart, with one named line each: "calls made before the match" vs "matches, backtest (replayed from earlier data)". | Screenshot. ✅ |
| R4 | My U4 fix moved the season tooltip to a span, so keyboard users lost it. | Toggles now style selection from `aria-checked`/`aria-pressed` (which Radix sets and Tooltip can't overwrite), so the tooltip goes back on the focusable button. | Screenshot: selected season visible. ✅ |
| R5 | The typo fallback search ignored `prefer`. | Same +0.1 bonus on the fallback path; new test with two equally good "Drive" teams. | Tests. ✅ |
| R6 | `prefer` dropped valid event codes containing `-`/`_` or longer than 20 characters. | Same rule as event routes: `[A-Z0-9_-]{2,24}`. | Lint/tests. ✅ |
| R7 | `npm run audit` exited 0 even with findings. | Exit code 1 when there are findings. | ✅ |
| R8 | The state checks passed any page with 40 characters of static text. | Every route declares `noApi` if it works without the server. Data pages must show a loading indicator when slow and an error message when down. `/packs` is slowed and refused too. | Found D1. ✅ |
| R9 | (Round 2, 5/5 with one thread) The upgrade check counted caches before build B finished installing, so a failed upgrade could pass. Root cause, found while fixing: Playwright's `waitForFunction` with an **async** predicate gets a Promise back, which is always truthy, so it never waited at all. | The check follows B's worker through its real `statechange` events: it must reach `activated` (`redundant` = failed install). Then every file B's `sw.js` lists must be in B's cache. | Flow: "installing → installed → activating → activated, all 46 files" in B's cache. ✅ |

Not defects (checked and recorded):

* Team **99999** exists: FIRST's own "Off-Season Demo Team" (real data, not mock).
* Search "16" lists team **16** first: an exact number match is meant to win.
* A `blob:` request "fails" when a local video preview is hidden: the browser
  stops loading a local object URL. No network, no console error.
* Hand-verified prediction (§3), Brisbane South Q1 (11505 + 26085 vs
  18187 + 17556), two calls:
  * **The ledger's call before the match** (backtest from earlier data only,
    tier provisional): blue 76%. Blue won 106–58.
  * **Today's ratings** (tier moderate): red 72%, 108–80. The factors are red's
    TeleOp +14 and auto +10, led by 26085, and 11505's endgame at 1.7× average.
    That fits the event OPRs: red 29 + 29 vs blue 12 + 21.

  So the early call was right, the season's data now reads the pairing the
  other way, and the low tier on the early call said exactly that.
* Performance (§5), production build: every page has its data in 150–330 ms.
  The first request after a server boot takes ~3 s while ratings warm. The
  Monte Carlo runs on the server, never on the UI thread.

## Homepage remodel: the observatory (2026-10-18, #151 on #154)

Re-ran `npm run audit` (every route, desktop and mobile, loading and API-down states) and `npm run audit:flows` (all 12 click-throughs, production build included) on the new home, then fixed and re-checked each finding. Also checked headless at 320, 390, 768, 1024 and 1280 px (no horizontal overflow), in light appearance, and with reduced motion.

| # | Area (§) | Finding | Fix | Re-check |
|---|---|---|---|---|
| H1 | Accessibility (§4) | 10 × `unnamed-control` on `/`: the atlas's country-list buttons sit in a closed disclosure, so their text reads as empty. | Each button is named "Canada: 564 team listings". | Sweep: 0 findings on `/`. ✅ |
| H2 | Tooling (§1) | The audit's first search on a fresh dev server timed out: Vite found the atlas's lazily imported d3-geo/topojson only mid-visit and reloaded the page. | `optimizeDeps.include` pre-bundles them. | Full sweep from fresh servers: search ✓ at both sizes, 0 findings. ✅ |
| H3 | Performance (§5) | `slow`: home "ready after 9.9 s" once, as the first route on a cold dev server (Vite transforms on demand). Warm loads settle in ~1.5 s on the dev server. | None needed for the page. The production numbers are the budget: `npm run audit:perf` puts warm home interactive at 375 ms and home data at 39.5 KB. | Sweep re-run: no `slow`. Perf: all budgets met. ✅ |
| H4 | Tooling (§1) | Flow "Settings" failed: it expected a "Delivery" group in Notifications, which main's Settings page no longer has (it went when web push shipped; this PR doesn't touch Settings). | The flow expects the section's current heading, "What to alert me about". | 12/12 flows. ✅ |
| H6 | Tooling (§1) | After main was merged in, flow "Search" failed 3 of 4 runs: "16" searched as "6". On the team page Ctrl+K opens the top-bar field, which takes focus one frame later, and Playwright typed the "1" before that. | The flow waits until the field has focus before typing. | 4/4 alone, then 12/12 flows. ✅ |
| H5 | Offline (§5) | Flow "Service worker upgrade" failed in 2 of 4 runs: `/api/flags` was requested while offline (`ERR_INTERNET_DISCONNECTED` in the console). Unlike `apiFetch` (O2), the flags client (unchanged from main) didn't check `navigator.onLine`, so it depended on timing. | `refreshFlags` doesn't ask while offline; regression test `src/lib/flags.test.ts`. | 12/12 flows after a rebuild. ✅ |

Integrity checks for the new home (§3):

* Every number comes from the API, or the page says what's missing: season coverage and country totals (`/api/home/overview`), the calendar (`/api/events`), the record (`/api/predict/accuracy`) and opt-in usage (`/api/public-usage`). Unpublished usage shows "aren't published yet", never 0.
* Live calls and season replays sit on separate tabs, each naming its season. The correct/missed bar uses `decided − upsets` and `upsets` from the same `decided` count.
* Your team's next match keeps the stale-slot rule and shows its confidence tier. No team is shown to a visitor who hasn't picked one.
* "Live" on the calendar needs results coming in. An event that's on today without results says so.
* The atlas counts each team once per season by the country it reports. The list reconciles drawn + too-small-to-draw + no-country = every listing.

## Independent audit V4 (2026-10-20): fixes

The V4 audit (full target fa49a59 / #208, with closing checks on #209 and #210) confirmed five defects that still needed fixing. V4-A11Y-002, the stat-tile names, had already been fixed by #209. The owner chose fixes only for now: four PRs, each merged at Greptile 5/5 on its head. The phone enhancements (audit items 5–11) are deferred.

| Finding | PR | Merge | Live |
|---|---|---|---|
| V4-RUNTIME-001 (P1) motion download failure left pages transparent | #215 | ac73944 | ✅ |
| V4-PRIVATE-001 (P2) damaged kept pick-list change crashed Scout | #212 | 2cd0e4b | ✅ |
| V4-PRIVATE-002 (P2) failed inbox writes rolled back silently | #214 | 501ac9c | ✅ (signed-in inbox verified locally only) |
| V4-A11Y-001 (P3) h1 → h3 heading skips | #214 | 501ac9c | ✅ |
| V4-A11Y-003 (P2) light-mode small gold text unreadable | #213 | 4910ed6 | ✅ |

**Owner decision (2026-10-20), V4-A11Y-003.** Light-mode gold `#eab308` stays for fills, bars and strokes, and for **large** display text: the profile and My team percentile ("Top 8%", 48px, 1.86:1) and Home's headline. The owner accepts that large text below the 3:1 large-text minimum. It is deliberate, not an oversight, and the rendered regression pins it (`text-accent-display`). Small gold text must reach 4.5:1 on its real background.

Once all four were merged, the combined main got another sweep: `npm run a11y -- --only AUBRQ2 --rules color-contrast` found 0 nodes on the overview, Teams, Playoffs and Awards tabs, desktop and phone, dark and light. PR C's earlier light-mode chip warning was from before #213 landed.

### V4-RUNTIME-001 (P1): failed motion-feature download left the next page transparent

| | |
|---|---|
| **Finding** | Aborting only `assets/motionFeatures-*.js` (production build, service workers blocked) made Home → Events render at effective opacity 0 inside a visible shell, in both reduce and no-preference, with an unhandled rejected dynamic import. Cause: the `LazyMotion` loader had no catch, and an `m` element that mounts without the features keeps its first drawn (`initial`) state, so the Shell route wrapper stayed at `opacity: 0`. |
| **Fix** | PR #215 (`fix/v4-motion-fallback`). `src/lib/motionSupport.ts` owns the download: once per page load, never rejects, and the failure is handled without the page-level reload prompt (chunkError/RouteErrorBoundary unchanged for page chunks). `src/components/motion.tsx` wraps `m` so that until the features arrive, elements mount at rest (`initial={false}`). All `m` imports go through it (guarded by a unit test). `MotionFeatures` replaces the lazy `LazyMotion` in main.tsx. After a failure the page load stays static; there is no retry, because Chromium caches a failed dynamic import. |
| **Re-check** | New prod flow "Animation download fails: pages still show, static, no reload prompt" (`npm run build && npm run audit:flows -- --only "Animation download"`). It covers fail, late-fail-then-repaired and slow × reduce/no-preference: Home → Events → Rankings has heading-chain and main-chain opacity ≥ 0.99. When the download fails it also checks a settings section switch and the top-bar sign-in panel. It asserts no pageerror, unhandledrejection, reload or reload prompt. As a control, a failed EventsPage chunk still offers "Reload Control Scout". **Main: ✗** (`fail/no-preference Home → Events: opacity main 1.00, heading 0.00`). **Branch: ✓** 7/7. Settings, Top-bar sign-in and Venue flows ✓; lint ✓; `npm test` ✓ (2495). Shots before/after (desktop + mobile, fault proxy) are in the PR. |
| **Status** | Merged as ac73944 (head 4ae3fd6, Greptile 5/5, 0 unresolved, CI `check` passed). Live: health release = ac7394457235246712d90bde5a880615c58b0bbd. Headless check on controlscout.org with motionFeatures aborted: Home → Events heading opacity 1.00 at desktop and mobile in both motion settings, 0 rejections, no reload prompt. Control Point: not affected (it uses the full `motion` component with no LazyMotion or lazy features). |
| **Limits** | Animation stays off for the rest of a failed page load. Without the features, an element whose `animate` target changes after mount keeps its mount state (visible, but it doesn't move). Tested in Chromium only. |

### V4-PRIVATE-001 (P2): a damaged kept pick-list change crashed Scout on Retry. FIXED (PR #212)

**Finding.** A kept order change in IndexedDB (`control-scout-picklist` / `ops`) with base `[101, {legacy: "malformed team object"}, 104]` got through the shallow read check (`Array.isArray(base)`). Retry on "Move 104" diffed the damaged order. The object then reached the conflict chips as a React child, and the Scout page error boundary took over.

**Fix.**
- `src/lib/picklistOps.ts` now checks each record in full when reading it (`isKeptPickOp`):
  - the op as the server takes it (`cleanPickOp`), with well-typed optional fields
  - every base and copied team a team number, each once, with no empty slots, at most 100
  - `isPickOpId`, a sane `at` (positive, at most 14 days ahead), and the `baseVersion`, `state`, `tab`, `message` and `uncertain` types
- `readKeptOps` returns `{ ops, damaged }`. Damaged records carry only their key, their scope and a readable op, which is used only for the label. They are never applied, compared or sent, and never dropped silently.
- The pick list notice and the recoverable view list each one with the line "This saved change is damaged and can't be applied…" and only **Discard this change**. That deletes the one record by its key, and only for its own account. If the delete fails, the row stays and says so.
- The conflict chips and `describeConflict` render numbers only.
- Unchanged: expiry, account scoping, valid row shapes, lost-ack `?ops=` reconcile, and the storage-unavailable fallback.

**Re-check.**
- New unit and flow tests (vitest + fake-indexeddb) cover:
  - the exact row
  - malformed base members, including a sparse array
  - invalid op and other fields
  - an old row holding only its key
  - valid older shapes loading untouched
  - a lost-ack change reconciling once and a lost-answer Retry applied once next to a damaged row
  - Retry not crashing, and Discard removing only that row
  - the recoverable view
  - another account's damaged row staying hidden
  - a failed discard
- Against main's sources: 50 failed / 19 passed, reproducing `Objects are not valid as a React child (found: object with keys {legacy})`. On the branch: all pass. `npm run lint` and `npm test` are clean.
- Headless Playwright screenshots (local dev, desktop and 390-wide mobile) show the isolated row, and that discarding it leaves the valid change.
- Control Point has no shared pick-list durable-op code, so it isn't affected.

### V4-PRIVATE-002 (P2): a refused follow-up change rolled back silently. Fixed in #214
- **Finding:** In the Notifications panel, a `POST /api/inbox/follow-up` that came back 503 put the flag back with no text and no announcement. Mark read, Mark unread and Mark all read had the same silent rollback (`send()` swallowed the error and refetched).
- **Fix:** `useInbox` tracks, for each row and field, the newest change and the last value the server confirmed. When a write fails, the row goes back to that confirmed value (badge and counts too). The row gets a `role="alert"` ("Couldn't save the follow-up flag. Nothing changed.", plus remove/read/unread variants) with a Retry that sends the same change once. If an older write fails after a newer change was made, nothing is touched. Focus stays on the toggle and returns to it after Retry, in the phone sheet too. In the Follow up view the row stays (`keep=`). Failures are per account: cleared on an account switch and never retried there. Mark all read shows one alert, and its Retry resends the same `upTo`.
- **Re-check:** 10 new vitest cases (6 hook, 4 component). All fail on main and pass on the branch. A headless Playwright run against the local API with a signed-in local test account and an injected 503 (phone and desktop) showed the alert in the row, `aria-pressed=false`, and focus on the flag. Retry then sent exactly one more identical POST (200) and left the flag pressed, no alert, focus on the flag. The live signed-in check is blocked: it needs real credentials.

### V4-A11Y-001 (P3): headings skipped from h1 to h3. Fixed in #214
- **Finding:** axe `heading-order` failed on phone `/matches?season=2025` (summary card h3) and on `/events/2025/AUBRQ2?tab=playoffs` (bracket h3). The audit's supplement also flagged `?tab=awards` (Advancement h3).
- **Fix:** A visually hidden `<h2>` named after the visible tab ("Matches", "Playoffs", "Awards") now sits above those sections, as the event Matches tab already does. The h3 elements keep their tags and classes, and nothing moves on screen (before/after screenshots in the PR). #209's tile names are untouched. `scripts/a11y.ts` now sweeps both tabs.
- **Re-check:** axe `heading-order` is clean on all three routes, phone and desktop (main: violation on 5 of 6). `npm run a11y -- --best-practice` shows no heading-order on the event tabs. 3 new vitest heading-skip tests fail on main and pass on the branch. Live re-check on controlscout.org (release 501ac9c): axe `heading-order` is clean on all three routes, phone and desktop.

### V4-A11Y-003: light-mode small gold text unreadable (P2), FIXED in #213 (merge 4910ed6, live)

**Finding.** After #210, all light-mode gold text was the accent `#eab308`. Measured on /compare?teams=18360,24089&season=2025: best values (14px/500 on the 8% accent tint, composited #fdf9eb) 1.82:1; chosen season chip (#f2e7c6) 1.55:1; the "18360 in these matches" label (white) 1.92:1; the followed team's number in match rows (13px bold on alliance tints #f4d9bf / #e1dfd6 / #f1ebd8) 1.41 / 1.44 / 1.61:1. How it works also had 11px gold labels and a chip at 1.91:1.

**Owner decision (2026-10-20).** Keep #eab308 for fills/bars/strokes and for LARGE text (profile "Top 8%", 48px, 1.86:1, accepted under 3:1). Change only small gold text to a darker gold reaching at least 4.5:1 on its real background.

**Fix.** Light `--color-accent-text` #eab308 → #875200 (deep amber). New `--color-accent-display` (the accent in both themes) for large display text only: profile + My team percentile, Home headline. How it works: `--hiw-gold-text` for its small labels, the chip and SVG chart labels. Fills and dark mode unchanged.

**Re-check.**
- Rendered regression `npm run audit:flows -- --only "Light-mode gold"` (desktop + 390x844, composited backgrounds): FAILS on main (best values 1.82, season 1.55, labels 1.41–1.92), PASSES on the branch (lowest small gold 4.78:1).
- axe `npm run a11y -- --rules color-contrast`: light-mode violations on the affected routes dropped to 4 nodes, all the owner-exception 48px percentile. Dark 0.
- Live (controlscout.org, 4910ed6, headless): best values #875200 on #fdf9eb **6.16:1**; season #875200 on #f2e7c6 **5.26:1**; "Top 8%" still rgb(234,179,8) at 48px.
- Unit: textTones.test.ts now limits the exception to `text-accent-display` and measures `text-accent-text` on the accent's 8–25% tints in both themes.
- Control Point: not affected (light `--color-accent-text` is #816204, 5.7:1 on white). No mirror PR.

### Also from the owner during this run: Predict's Lab buttons (#211, ff26c97, live)

"Predict a matchup" was the glowing primary button next to a secondary "Odds at an event", which made one of two equal choices look recommended. Both are now the same secondary button. A regression in `PredictPage.team.test.tsx` fails on main and passes on the branch.

## Launch re-audit, signed in (2026-10-29, on 1.4.2)

`npm run audit` and `npm run audit:flows` on main (f2bb28a6), then the signed-in flows with local test accounts only: a local copy of the database, sessions made the way the tests make them, and a local stand-in for Control Point's internal API (one workspace: an admin, a member, a non-member). No account was made on the live site.

| # | Area (§) | Finding | Fix | Re-check |
|---|---|---|---|---|
| L1 | Mobile (§4) | Flow "Methodology example pips" failed: the phone targets were 38.5 px, not 44 (`size-11` is 2.75rem, and phones use a 14px base). | Phone size in px (`size-[44px]`), separate PR. | Flow: phone 44×44 ×4, desktop 24×24 ×4. ✅ |
| L2 | Tooling (§1) | Flow "Scouting" timed out: since the Scout redesign the entry list (New entry, Delete entry) lives under Data → Entries, not on `/scout`'s first tab. | The flow opens `/scout?tab=data&view=entries`. | 1/1. ✅ |
| L3 | Tooling (§1) | Flow "Match details" failed on `/OPR here/`: the lineup label is now "OPR at this time" (dcc4ebe5). | The flow expects the current label. | 1/1. ✅ |
| L4 | Performance (§5) | Sweep: `/scout` desktop "ready after 6.1 s", the first Scout visit on a cold dev server (as H3). | None: dev-server transform time. | `npm run audit:perf`: all budgets met. ✅ |

Signed-in flows (desktop and 390 px, both roles): workspace entries, comments, shared pick list and its notes, assignments and their notifications, template edits reaching members' forms, the offline queue and its sync, consensus and the match report's workspace half, shortlist/My team/tracked merge on first sign-in, every Settings section, the weekly digest switch, the inbox, and the owner page (and its 404 for a non-owner). Privacy: signed out and as a non-member, every workspace endpoint (15 reads, the stream, 2 writes) is refused, and no note, comment, pick-list note, member name or blended number appears in any public API, page, share card or browser response; the public match report is identical for a member and a visitor.
