# Maintenance + self-audit report

The return file for `control-scout-maintenance-self-audit-brief.md` (section N3). Written 2026-11-01.

Everything below can be checked against the repository (PR numbers, final-head SHAs, Greptile summaries) and the live
site. Where a claim rests on a measurement, the measurement is given; where something could not be checked, it is in
the Unverified list (section 6), not in the table as a pass.

## 1. Scope and method

- **Sections and PRs.** One PR per brief section, in order: A, B, C, D, E, F, G, H, I, J, M, then this report. Each PR
  bumped the version to main + 1, added a CHANGELOG / What's new entry with its PR number, carried before/after
  screenshots, reached Greptile 5/5 with 0 unresolved threads on its final head, was merged by the builder, and was
  checked live (`/api/health` `release` = the merge commit) with a verification comment and a screenshot on the PR.
- **Viewports.** Desktop 1440×900 and phone 390×844 (touch, `isMobile`) in headless Chromium (Playwright) for every
  screenshot and measurement. A touch tablet width was used for one check (records row height, G1). The
  in-app browser pane was never used.
- **Signed out.** Every section's checks ran signed out against the live site or a local production build.
- **Signed in.** Only for the final console sweep, on a local production build with a local test account (a test user
  and session written to the local `.data` database; no real account, nothing sent anywhere). Signed-in flows on the
  live site were not exercised (no test account there): see section 6.
- **Console.** Each section's live check recorded console errors/warnings on the pages it touched. The final sweep
  (section 4 of this file's evidence, below) opened 23 routes at both viewports, scrolled each to the bottom, and
  recorded console errors, warnings, page errors and the site's own 4xx/5xx responses:
  - signed out, live site (release `f53bf23e`): **0** on 22 of 23 routes; the unknown-team 404 page logs the
    browser's "Failed to load resource: 404" line twice (see Blocked B9);
  - signed in, local production build of section M: **0** on 22 of 23 routes, the same two lines on the 404 page.
- **Data.** The local database has no records statistics, so records and some team/event checks ran on a local
  production build whose `/api/*` GET requests were proxied to the live API (read-only; anything but GET refused).
  Each PR says when its after-screenshots were taken this way.
- **Forced states** (section E):
  - *loading*: Chrome DevTools-protocol throttling to 4G on cold loads (team, event, home, events, records), filmstrip
    frames checked for a flash, CLS measured with a `layout-shift` PerformanceObserver;
  - *empty*: real empty cases on live data (an upcoming meet with no schedule, a team with no results this season, an
    empty shortlist / compare / followed teams, a search with no matches);
  - *error*: Playwright `route.abort()` on every `/api/*` request after the page had loaded (the server cut off
    mid-visit), on 14 pages at both viewports, then the route restored and Try again pressed; plus
    `navigator.onLine = false` for the device-offline message.

## 2. Per-item table

Outcome: **Fixed** (changed, with before/after evidence), **Verified** (checked, already right), **Partly fixed**,
**Not changed** (with the reason). Evidence: the PR (screenshots and full notes are in its description; the live
check is its last comment) or the measurement given.

### A. Theme and colour — #384

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| A1 | Fixed | One-off hex colours (video red ×6, a violet, raw `red-500` for live ×5, scrollbar hexes) became tokens. Left on purpose: the always-dark pit display and the overlay on video frames, brand marks, shadows, Scout rebuild files (0b). | #384 table + screenshots |
| A2 | Verified | Gold marks primary buttons, the active nav/chip, key numbers and links only. | #384 screenshots |
| A3 | Fixed | axe: winning red score on its tint 4.49:1 (dark), bracket loser chip 2.78–3.48:1 (light). Now ≥ 4.5:1 via `--color-red-alliance-ink` and a neutral loser chip (chosen over raising opacity, which fails again on the other theme). | axe before/after in #384 |
| A4 | Fixed | Light-theme focus ring was 1.6:1 on white. `--color-ring` on light is now `#6b4100` (≥ 3:1); 22 ad-hoc ring uses routed through the token. | #384 |
| A5 | Verified | Every Button variant has hover, active and disabled styles. | #384 |
| A6 | Fixed | My team's event cards used grey badges for Live/Upcoming/Finished; now the shared `EventStatusChip`. | #384 |
| A7 | Fixed | Compare's OPR-by-event lines were colour-only; now four dash patterns plus a legend. | #384 |
| A8 | Fixed | Visited running-text links now a step quieter (all `:visited` allows). | #384 |
| A9 | Fixed | Scrollbars from tokens, Firefox included. | #384 |
| A10 | Fixed | The odd status badge (A6) was the drift found. | #384 |

### B. Typography — #385

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| B1 | Fixed | Stray sizes (9px, 10.5px, 11.5px) moved onto the scale. | #385 |
| B2 | Fixed | One H1 per route; one skipped level (h1 → h3 on a prediction) fixed. | axe in #385 |
| B3 | Fixed | A base rule makes every table use tabular figures. | #385 |
| B4 | Verified | The percentile rank leads the team hero, OPR/Rating/Record next. | #385 screenshots |
| B5 | Verified | Metadata sits one or two steps below body. | #385 |
| B6 | Fixed | 17 truncated names gained the full name on hover; a wrapping "Sponsors (2)" label fixed on phone. | #385 |
| B7 | Verified | Default leading per size; no cramped blocks found. | #385 |
| B8 | Verified | 0 px horizontal overflow on 18 routes at 390px. | #385 |
| B9 | Verified | `npm run audit` labels check: 0 findings, both viewports. | #385 |
| B10 | Verified | One number format per kind (OPR one decimal, counts localised, W-L-T). | #385 |

### C. Density and spacing — #387

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| C1 | Verified (one change tried and declined) | Moving the event "At a glance" card below the title made the header ~105px taller, so the side-by-side layout stays. | #387 measurement |
| C2 | Fixed | `/search` was a centred column 221px in; now on the page gutter like every page. | #387 |
| C3 | Verified | Cards use consistent padding pairs. | #387 |
| C4 | Verified | Section spacing from the shared `Section`. | #387 |
| C5 | Fixed | H1 offset 33/14px on every route after the C2 fix (was 221/18 on `/search`). | #387 |
| C6 | Verified | Filter bars wrap inside a sheet at 390px. | #387 |
| C7 | Verified | 0 overlapping sticky/fixed pairs on 6 pages × 2 widths × 3 depths. | #387 |
| C8 | Verified here; Records rows fixed in G1 | | #387, #392 |
| C9 | Verified | Dialog and sheet padding match; close-button tap area fixed in F5. | #387 |
| C10 | Verified | Footer sits at the foot of short pages. | #387 |

### D. Detail level — #388

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| D1 | Fixed | Four folded cards gained a summary hint ("· 4 robots", "· 12", "· 9 commands", "· the season's rules, offline"). | #388 |
| D2 | Fixed | OPR, Rating and an event's Top OPR gained one-line definitions (native `title`, like their neighbours, rather than a new component). | #388 |
| D3 | Verified | Ranks, ratings and hit rates carry their sample size. | #388 |
| D4 | Verified | See E4. | #388, #389 |
| D5 | Fixed | The team page's OPR section now says "Stats updated … ago" (current season only; not on offline copies). | #388 |
| D6 | Verified | No repeated headings or duplicate descriptions found. | #388 |
| D7 | Verified | No thin surface needed new data (none added). | #388 |
| D8 | Verified | Secondary detail already folded. | #388 |
| D9 | Verified | Team and event pages share one detail default. | #388 |
| D10 | Fixed | 7 stamps in the browser's bare date format now use the app's ("Oct 31, 2026"). | #388 |

### E. Loading, empty and error states — #389

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| E1 | Fixed | Records' placeholder was shorter than the table: live CLS 0.061 / 0.052 / 0.076 → 0.0056 / 0.0063 / 0.0018. | #389 |
| E2 | Verified | 14 pages with the API cut: content or a full error block, never a bare header. | #389 |
| E3 | Verified | Cold loads (full speed and 4G): no flash frame, CLS 0. | #389 |
| E4 | Verified | Six real empty cases each say what's missing and offer the next step. | #389 |
| E5 | Fixed | The search results page had no retry; it now has Try again. Records' "Loading…" hides on error. | #389 |
| E6 | Fixed | A failing server was called "You're offline"; now "Can't reach the server" unless the device is offline. | #389 |
| E7 | Verified | 4G cold loads: skeleton then content. | #389 |
| E8 | Fixed | A failed pit photo shows "Photo not available"; a failed stream thumbnail hides. | #389 |

### F. Navigation and interaction — #391

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| F1 | Verified (audit flow updated) | Enter opens the results page; ArrowDown + Enter opens the team. The click-through audit expected the old behaviour and was updated. | #391 |
| F2 | Verified | Five query kinds each give labelled sections and "See all results". | #391 |
| F3 | Verified | `#events`, `#opr`, `#awards`, `#matches` scroll to and open their sections. | #391 |
| F4 | Fixed | No keyboard trap on 13 pages; every stop visibly changes. Ctrl K / "/" then Escape now returns focus to where it was. | #391, live comment |
| F5 | Partly fixed | Controls with a 44px tap area on a 390px touch screen: 117 → 414 of 1,241 (live). 578 widened areas, 0 that steal a neighbour's tap. The rest are in Blocked B1. | #391 |
| F6 | Fixed | A match call's detail and a confidence badge open on a tap (`TapTooltip`); sort arrows show on touch screens. | #391 |
| F7 | Verified | Back returns to the previous page. | #391 |
| F8 | Verified | `aria-current` on the active section, 12 pages. | #391 |

### G. Records and tables — #392

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| G1 | Fixed (records density applied here, as the brief allows when its own PR hasn't landed) | Desktop rows 61 → 33px; first screen 6 → 12 rows; sideways overflow 760 → 632px. Phone unchanged (47px rows); touch tablets keep 45px rows. | #392 |
| G2 | Verified | Last column 1px inside the table on all four views. | #392 |
| G3 | Verified | Sort desc then asc, in order, `aria-sort` set. | #392 |
| G4 | Verified | One floating header, nothing covered. | #392 |
| G5 | Verified | Select all ticks up to Compare's cap of 4 and says so. | #392 |
| G6 | Fixed | The Team column's truncated names gained a hover title. | #392 |
| G7 | Verified (live) | 107 rows on screen = 107 rows in the CSV, same order. | #392 |
| G8 | Verified | Scroll frames p50/p95/max 17ms, no long tasks. | #392 |

### H. Team, event and match pages — #393

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| H1 | Verified | Percentile 48/42px leads; OPR, Rating, Record, Reliability 24/21px; season switcher in the hero. | #393 |
| H2 | Verified | One season toggle + "Earlier"; every kicker names its season. | #393 |
| H3 | Fixed | Phone event names cut to one line with the name only on hover; now up to two lines (`line-clamp-2`). | #393, live |
| H4 | Fixed | An award's event was only in a hover tooltip; now a muted second line on the chip. | #393, live |
| H5 | Fixed | Trend chart axes had no titles; now "Event, oldest to newest" and "Points"/"Percent". | #393, live |
| H6 | Partly fixed | Control Point link underlined with a touch tap area; every Button shows the pointer cursor. "Mark as my team" has no confirmation toast: behaviour, Blocked B4. | #393 |
| H7 | Verified | Live event: red LIVE panel under the title. | #393 |
| H8 | Fixed (dots) | Three live-dot styles → one shared `LiveDot` in four places. The status chip's icon and the pit display's TV palette are kept; "Live"/"LIVE" wording left (Blocked B5). | #393 |
| H9 | Verified | Scores 30/26px bold, "Red won"; alliance contrast 5.14–8.80:1. | #393 |
| H10 | Verified | Stream button and recording facade; no stream → no empty box. | #393 |

### I. SEO, meta and accessibility — #394

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| I1 | Fixed | Home description 182 → 158 characters; `/settings` (noindex) 23 → 58. Others in range. | #394, live |
| I2 | Verified | No image without alt; logo `alt=""` + `aria-hidden`. | #394 |
| I3 | Verified | Old methodology URLs 301 to `/methodology`. | #394 |
| I4 | Fixed (unlinked + explained, not hidden) | Match records linked Off-Season Demo Teams to a 404. The API now names them per row (`noPage`, same name rule as everywhere); they show as plain numbers with a tap/hover note. Kept rather than hidden: the matches were real. | #394, live (5 rows on page 1 of 2025) |
| I5 | Verified | 26,022 sitemap URLs; 300 sampled, all 200. | #394 |
| I6 | Verified | `/teams/999997` → HTTP 404 with a clear message. | #394 |

### J. Settings and other surfaces — #395

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| J1 | Verified | Theme, compact and text size apply at once and persist across navigation and reload. | #395 |
| J2 | Fixed | "Lite pack on this device" → "Offline predictions on this device"; "Prediction engine" → "Prediction model version". | #395, live |
| J3 | Fixed | Season packs show the pack version, a "This season" chip, and the full SHA-256 on a tap; the lite pack line gives size and season span. | #395, live |
| J4 | Verified | Footer links all 200; version shown. | #395 |
| J5 | Verified | What's new: grouped, scrolls inside, focus trapped, Esc returns focus. | #395 |
| J6 | Code reading only | Sign-out path read in `personal.tsx`; not exercised signed in on live (section 6). | #395 |

### M. Optimization — #396

| ID | Outcome | Justification | Evidence |
|---|---|---|---|
| M1 | Measured | Baselines in section 3. | below |
| M2 | Verified | 17 keystrokes at 60 ms → 1 request; stale answers dropped by sequence number. | section 3 |
| M3 | Verified | A repeat query within a minute comes from the browser cache (0 B, 2 ms). Rule: `max-age=60, stale-while-revalidate=300` + ETag. | section 3 |
| M4 | Verified | Server caps hits at 12 (dropdown) and 25 (results page). | `server/api/search.ts`, `src/shared/search.ts` |
| M5 | Measured, not changed | Natural-language questions: 450–600 ms every time vs ~80 ms for a number. The time is in search's question/answer route; changing it is search routing (0b, M14). Blocked B6. | section 3 |
| M6 | Verified | Below-the-fold team sections load on open; the charts library is a separate lazily loaded chunk. | `dist/assets/charts-*.js`, not in `index.html` |
| M7 | Fixed | The only image on each page, a 96×96 PNG shown at 28px: 14,048 → 1,924 B per cold load (home, team, event). | section 3, #396 |
| M8 | Verified, no change | Each font file fetched once per page; the first paint's `font-display: block` faces are deliberate (no reflow) and reuse the same files. CLS 0–0.009. | section 3 |
| M9 | Verified | Records scrolling: 17 ms frames, no long tasks (G8). | #392 |
| M10 | Verified | No duplicate requests on team and event page loads. | section 3 |
| M11 | Verified | No long tasks while `/predict` and an event's odds tab load; the local estimate runs in a Web Worker. | section 3 |
| M12 | Measured, nothing removed | No dead code or dependency could be proved unused in this pass. | section 3 |
| M13 | Measured | Slowest calls listed in section 3; none needs an index or migration. | section 3 |
| M14 | Respected | No change to results, ranking, predictions, cadence or content anywhere in the pass. | all PRs |

### N. Process

| ID | Outcome | Evidence |
|---|---|---|
| N1 | Done: no questions asked; owner decisions are in section 5 with recommendations. | this file |
| N2 | Done: every row above says what and why; numbers for every optimization. | sections 2–3 |
| N3 | Done: this file, in its own PR. | section 4 |
| N4 | Done with listed gaps: every item has an outcome; what is left is in sections 5 and 6. | sections 5–6 |

## 3. Optimization numbers

Live site, headless Chromium, before section M unless stated. Search times include ~55 ms round trip.

| Measure | Before | After |
|---|---|---|
| Search p50 / p95, 10 runs each: team number "4215" | 64 / 212 ms | not changed (M14) |
| team name "Hypnotic Robotics" | 84 / 3,606 ms (cold first run) | not changed |
| versus "4215 vs 18360" | 66 / 87 ms | not changed |
| natural question "who won worlds" | 630 / 1,613 ms | not changed (Blocked B6) |
| all queries | p50 80 ms, p95 641 ms | not changed |
| Page load, median of 3 cold (TTFB / FCP / LCP ms): home desktop / phone | 129/216/336 · 86/176/176 | — |
| team 4215 desktop / phone | 194/368/368 · 205/416/416 | — |
| event USNJCMP desktop / phone | 152/372/372 · 256/536/736 | — |
| CLS, Records (`/teams`, `/matches`) desktop / 4G desktop / 4G phone (E1) | 0.061 / 0.052 / 0.076 | 0.0056 / 0.0063 / 0.0018 |
| Image bytes per cold page load (home, team, event), M7 | 14,048 B (`/logo.png`) | 1,924 B (`/logo-56.webp`) |
| Font requests per page (home, team, event), M8 | 3 (one per file) | 3 |
| Search requests while typing 17 characters at 60 ms/key, M2 | 1 | — |
| Repeat identical query within a minute, M3 | 0 B, 2 ms (browser cache) | — |
| Long tasks on `/predict` and an event's odds tab, M11 | none | — |
| Records scroll frames p50/p95/max, M9 | 17 / 17 / 17 ms | same |
| Production JS, M12 | 115 files, 3,374 KB raw, 1,093 KB gzip (section M build) | M changes no JS weight |
| Slowest API calls, server time median/max ms, M13 | public-usage 57/113, meta 55/146, predict/accuracy 53/65, home/overview 53/151, events range 51/108, auth/me 48/69, flags 42/126 | — |

## 4. PR list

All merged by the builder; Greptile 5/5 with 0 unresolved threads on the final head listed.

| PR | Section | Version | CHANGELOG entry (summary line) | Final head | Greptile |
|---|---|---|---|---|---|
| [#384](https://github.com/ZOGWORK/control-scout/pull/384) | A theme | 1.8.5 | Colours mean one thing each, read clearly in light mode, and the keyboard focus ring shows on white. | `f4a18159` | 5/5 |
| [#385](https://github.com/ZOGWORK/control-scout/pull/385) | B typography | 1.8.6 | Long names show in full when you point at them, table numbers line up, and headings follow one order. | `9db80def` | 5/5 |
| [#387](https://github.com/ZOGWORK/control-scout/pull/387) | C spacing | 1.8.7 | The search results page lines up with every other page. | `d14ddf25` | 5/5 |
| [#388](https://github.com/ZOGWORK/control-scout/pull/388) | D detail | 1.9.1 | Folded cards say what's inside, a team's OPR says how fresh it is, and dates read the same everywhere. | `bfb5cbfd` | 5/5 |
| [#389](https://github.com/ZOGWORK/control-scout/pull/389) | E states | 1.9.2 | Records no longer jumps while it loads, a server that doesn't answer is no longer called "you're offline", and a failed search can be tried again. | `f01f0e79` | 5/5 |
| [#391](https://github.com/ZOGWORK/control-scout/pull/391) | F navigation | 1.9.3 | Easier to tap on a phone: buttons, links and chips get a full fingertip of room, and a match's call opens its detail on a tap. | `3b9fb625` | 5/5 |
| [#392](https://github.com/ZOGWORK/control-scout/pull/392) | G tables | 1.9.4 | Records on a laptop shows twice the rows before you scroll. | `0be92b75` | 5/5 |
| [#393](https://github.com/ZOGWORK/control-scout/pull/393) | H pages | 1.9.5 | Team pages say more without a mouse: award events, full event names, chart axes. | `c1cfd335` | 5/5 |
| [#394](https://github.com/ZOGWORK/control-scout/pull/394) | I SEO / a11y | 1.9.6 | Search results get a shorter home page summary, and demo teams stop linking to nothing. | `4073e39a` | 5/5 |
| [#395](https://github.com/ZOGWORK/control-scout/pull/395) | J settings | 1.9.7 | Settings and Download say what they mean, and every saved season shows its version. | `57edd972` | 5/5 |
| [#396](https://github.com/ZOGWORK/control-scout/pull/396) | M optimization | 1.9.8 | Every page loads a lighter logo: 1.6 KB instead of 14 KB, looking the same. | `287c65a8` | 5/5 |
| [#397](https://github.com/ZOGWORK/control-scout/pull/397) | This report | 1.9.9 | The maintenance pass is written up: what changed, why, and how it was checked. | its own final head (a file can't name the commit that contains it): see the PR | see the PR |

Versions 1.8.8–1.9.0 belong to other work merged during the pass (the Scout rebuild); each section took the next free
number when it merged.

## 5. Blocked / Needs-owner

| # | Item | Why it is blocked | Recommendation |
|---|---|---|---|
| B1 | F5: remaining small tap targets — alliance team chips in match rows (32px), tabs and season pickers inside sideways-scrolling strips (38/32px), the confidence icon in a match row (18px), country shapes on the home map, the header (~42px tall at the edge). | A 44px area would overlap the neighbouring control (chips, icon) or be clipped by the strip; making room means taller rows (~25% longer match lists) or a different layout. | Accept for chips and the icon (they open the same page/detail as the row); give the strips' tabs 44px height in the next layout pass. |
| B2 | Search number prefixes: `/api/search?q=163` returns nothing, so the click-through audit's "16 → tracked team" step fails. | Search ranking/routing is out of scope (0b). | Decide whether partial team numbers should match; if yes, a search-track change, then restore the audit step. |
| B3 | I4 choice. | Owner may prefer hiding placeholder matches. | Keep as shipped (unlinked + note): the matches were real and their partners' records depend on them. |
| B4 | H6: "Mark as my team" gives no confirmation toast, unlike Track and Shortlist. | A behaviour change, not polish. | Add the same toast as Track. |
| B5 | H8: "Live" (status chip) vs "LIVE" (stream badge, live panel heading). | Copy choice. | Use "Live" in chips and "LIVE" only for the panel heading. |
| B6 | M5: natural-language search questions take 450–600 ms every time (numbers ~80 ms). | The time is in search's question/answer route; changing it is search routing (0b, M14). | Profile `searchQuestions`/answer route on the search track; cache question answers per data version. |
| B7 | J6 / signed-in click-through on live. | No live test account in this pass. | Run `npm run audit:flows` signed in with a test account once. |
| B8 | Records density PR. | The brief's separate density build had not landed, so G1 applied desktop density here. | If that build lands later, reconcile with `RecordsTable` cell classes from #392. |
| B9 | Unknown team page (`/teams/999997`): the browser logs "Failed to load resource: 404" twice. | The server already renders the 404 page; the app then asks `/api/teams/999997` again (and once more), and the browser logs every 4xx. Avoiding it means the first-paint page data carrying a "not found" answer, a change to the API cache, beyond a polish pass. | Seed a not-found answer in the page data (`src/lib/pageData.ts`) so the app skips the request on a server-rendered 404. |

## 6. Unverified

- **Signed-in on the live site.** Signed-in pages were swept only on a local production build with a local test
  account (console clean except B9). Sign-out (J6) was checked by reading the code only.
- **Bing / Google flags clearing** (I1–I5 follow-up): needs the owner's webmaster accounts.
- **Real phones.** All phone checks are Chromium's mobile emulation at 390px; no physical iOS/Android device.
- **The live dot (H8) on a live event.** No event was live while H was checked; covered by tests and code reading.
- **A failing pit photo (E8) and a failing stream thumbnail on live.** Covered by the fallbacks added in #389 and
  their checks there; not seen failing on live.
- **Offline (venue) flow on live.** Passed the click-through audit (`audit:flows`) locally; not repeated on live.
- **M12 "before" bundle size.** Measured on the section M build only; section M changes no JS, so no before/after is
  claimed.

## Final checklist

- [x] Every item above has an outcome in MAINTENANCE-REPORT.md.
- [x] Every change has a justification and every skip has a reason.
- [x] Every optimization has before/after numbers (M7 and E1 changed; the rest measured as-is, M5 blocked).
- [x] Screenshots exist at 1440×900 and 390px for every changed surface (in each PR's description).
- [ ] Console is clean across the full click-through, signed-out and signed-in — clean on 22 of 23 routes both ways;
      the 404 page's two browser lines are B9; signed-in on live is unverified (section 6).
- [x] No new features, routes, schema changes, engine changes, or AI additions shipped in this pass.
- [x] MAINTENANCE-REPORT.md is written and ready for Sushil to hand to Bruno.
