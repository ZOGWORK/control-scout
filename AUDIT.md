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
