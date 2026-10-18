# Control Scout homepage remodel: research and implementation brief

**Decision:** implement the approved **FTC Observatory** direction for the public desktop homepage, with the **Field desk** ordering on phones. Keep the product name Control Scout; “observatory” describes this page's experience, not a rename.

**Owner handoff:** Claude should implement this brief on `codex/homepage-observatory-handoff`, continuing the existing draft PR against `Control-Point-FTC/control-scout:main`.

**Requested start:** the user will give the prompt to their own Claude session, and starting immediately is allowed. Begin when the user provides the prompt; do not wait for midnight or launch a separate scheduled session. There is no completion deadline or task-imposed runtime limit. Continue implementation, verification, and review for as long as needed to satisfy the acceptance criteria. Report genuine external blockers honestly.

**Status of this commit:** design research and implementation instructions only. No production UI, API, analytics, engine behavior, or deployment changes are included. The accompanying PR contains rendered concept screenshots, captured outside the repository with `npm run shots`. The implementation task remains open until the acceptance criteria below pass.

## 1. What the user approved

The user wants a substantial homepage redesign, a world view showing FTC's global reach, and public Control Scout usage statistics. They like the richness of the supplied Robolyst reference and the directness of the supplied FTC Scout reference, while wanting a distinct Control Scout identity. The user selected **Observatory** in the interactive design comparison and then requested a PR, this research/implementation file, and a Claude prompt.

The central idea is **global awareness that leads to a scouting decision**. A globe gives the page a recognizable silhouette; search, a scout's own team, event discovery, and accountable predictions make it useful. Visitor analytics is a separate, secondary section.

Build one responsive production homepage. Do not ship the design preview's variant carousel, annotation controls, sample search, modal explanations of unfinished features, or preview navigation rail.

## 2. Research: evidence, interpretation, and limits

### Visual reference comparison

These observations are based on the three screenshots supplied in the design conversation. They are design interpretations, not a feature audit, usability study, performance comparison, or review of competitor source code.

| Reference | Observable strengths | Implication for Control Scout |
| --- | --- | --- |
| Current Control Scout home | Recognizable yellow/graphite family; prominent search; prediction and event entry points; personal team access | Keep those functions and the established design tokens. Improve hierarchy and make the page feel like a working scouting tool. |
| Robolyst screenshot | A strong geographic centerpiece; visible competition information and product usage totals | Adopt the idea of useful global context, with a different composition: editorial/search area beside an instrument-like atlas, followed by personal and prediction information. |
| FTC Scout screenshot | Clear event list and immediately readable competition facts | Retain concise lists and direct actions alongside the richer visual experience. |

Distinctiveness should come from the combination of a restrained competition atlas, a personal next action, and a public prediction record that includes failures. A globe by itself is not a unique product identity.

### Repository findings

Inspected against main commit `a7e9fff` during this handoff. Re-check interfaces after any later rebase.

| Existing source | Finding | Implementation consequence |
| --- | --- | --- |
| [Home.tsx](../../src/pages/Home.tsx) | Home already wires search, personal next match, events, prediction entry points, track record, and offline tools | Recompose these capabilities; retain their behavior and error handling. |
| [Search.tsx](../../src/components/layout/Search.tsx), [SearchBox.tsx](../../src/components/search/SearchBox.tsx) | Shared page search, command palette, keyboard behavior, and result routing already exist | Use the existing search components and routing. Never port the preview's limited search dataset. |
| [index.css](../../src/index.css), [ui components](../../src/components/ui) | Control Point family tokens, local fonts, graphite/volt colors, light theme, and button conventions exist | Use these tokens and components rather than importing the preview's independent styling system. |
| [Shell.tsx](../../src/components/layout/Shell.tsx) | The app already has global navigation and a scrolling shell | Keep the working application shell. The concept's slim rail illustrates reduced visual weight, not a request to remove existing destinations. |
| [analytics.ts](../../server/analytics.ts) | Opt-in page views and session-start counts are stored in daily aggregates; the summary endpoint is protected by `STATS_TOKEN` | Build a separate, explicitly allowlisted public aggregate endpoint. Preserve the protected owner endpoint. |
| [analytics.tsx](../../src/lib/analytics.tsx), [shared analytics](../../src/shared/analytics.ts) | Sessions use a tab-scoped `sessionStorage` flag; routes are normalized to patterns | Label them “sessions started,” not unique people. Do not add identities or route-specific team browsing telemetry. |
| [db.ts](../../server/db.ts) | Team directory locations contain city/state/country strings; the inspected tables do not provide verified latitude/longitude for every team | Country aggregation is the initial geographic representation. Exact team pins require a separate sourced location pipeline. |
| [accuracy.ts](../../server/api/accuracy.ts) | Live and replay evidence, denominator rules, headline thresholds, and cached track records already exist | Render the existing contract. Do not create a competing accuracy formula or combine live/replay samples. |
| [shared API](../../src/shared/api.ts), [app routes](../../server/app.ts) | Public metadata, events, team profiles, and team match routes exist | Extend shared types for new home/public usage contracts, keeping web imports out of `server/`. |
| [predict-engine package](../../packages/predict-engine/package.json) | Main uses engine 2.1.1 at inspection time | Read the current version dynamically. The design snapshot predates this engine; its displayed statistics are not a production baseline. |
| [CI](../../.github/workflows/ci.yml), [audit runbook](../self-audit.md) | Required performance and full-product verification already exist | Treat those checks as release gates rather than replacing them with a homepage-only screenshot. |

### Prototype evidence and its boundary

The approved interactive study was checked at desktop, 1024px, 736px, 390px, and 320px widths, including light appearance and reduced-motion rendering. Country selection, globe/atlas switching, team search, event details, and live/replay evidence switching were exercised. Those checks found no horizontal overflow or script errors in the final study.

The study uses a local October 13, 2026 dataset. For example, it showed 14,609 season team listings, 1,342 listed events, and 198 recorded match scores. Its historical winner accuracy was calculated from the old local replay ledger. These are dated design-study observations, not constants, current production claims, or evidence about the current engine. Fetch production values and labels from the real API.

The study deliberately leaves public usage totals unavailable. It is not a production React implementation, a complete directory search, a live event monitor, or a connected analytics dashboard.

## 3. Information architecture and desktop layout

Preserve the existing shell and its navigation. Inside its content area, use this order:

1. **Editorial hero and search beside the competition atlas.**
2. **Season coverage strip:** season team listings, listed events, recorded match scores.
3. **Your team / next action**, conditional on the actual personal state.
4. **On the calendar** beside the **public prediction record**.
5. **Control Scout, in use:** public aggregate usage.
6. A quiet footer with methodology, data freshness, and offline access through the app's existing destinations.

### Hero

Use a left-aligned headline, not another large centered logo. The brand remains in the app chrome. Initial copy:

> The whole field. In your corner.

Supporting copy:

> Find your team. Follow the competition. Make your next call with the full picture.

Place the existing full search directly beneath this copy. Keep the full team's-number/name, event, and match search behavior even if the visible placeholder is shorter. The field must paint immediately and accept typing while the atlas loads.

The primary button is **Predict a match**, routing to `/predict`. The secondary button is **Find an event**, routing to `/events`. Both must be above the fold at ordinary laptop and phone sizes. Preserve command/control-K, the page search ref, keyboard selection, and meaningful first-run tour anchors.

At approximately 1024px and above, aim for a 45/55 split between the editorial area and atlas, using the actual content width after the sidebar. Give search enough space before increasing the globe size. The atlas should feel integrated into the page, with a quiet local toolbar rather than a large nested dashboard frame.

### Season coverage strip

Use one thin, three-column strip instead of three large floating cards. Numerals use tabular figures and the display typeface; labels explain the denominator:

- “Team listings this season,” not “active teams” unless activity is explicitly defined and queried.
- “Events on the calendar,” not “events happening now.”
- “Match scores recorded,” scoped to the selected season.

Read the season and freshness from metadata. Show an actual source timestamp rather than a client-only “just updated” claim. Scope counts consistently when the season changes.

### Personal section

Use `usePersonal()` and the current `MyTeamNext` behavior. Team 4215 in the study came from the user's screenshot; it must never be a hardcoded default for visitors.

With a selected team, show the real number, name, location, and next meaningful action. If a fresh unplayed match exists, show its label, event, time, win odds, and visible confidence tier. Reuse the existing stale-match safeguards. If no schedule exists, say “No match schedule published yet” or the existing equivalent and link to `/my-team`.

Without a selected team, offer **Find your team** without forcing sign-in. Preserve local-only personalization and the existing signed-in landing/redirect behavior unless a separate product decision changes it. Verify explicit navigation to `/` still works for signed-in scouts.

### Events

Show a compact list of three to six real upcoming/in-progress events with date, name, city/state/country, and a useful link. Reuse the event list's status logic and event-local timing; a calendar date alone does not prove an event is live.

Keep scheduled, live, completed, and unknown states distinct. A “live” marker requires evidence from the existing live event system. “On the calendar” is the safe fallback heading. If there are no events in the chosen window, show the exact window and a browse-events action instead of substitute fixtures.

### Prediction record

This should be a distinctive, prominent part of the page. Suggested heading: **Odds that answer for themselves.** Use the current `/api/predict/accuracy` response and existing winner-accuracy rules, thresholds, and engine metadata.

Always show evidence type, season/date range, sample size, and the meaning of the displayed denominator. Live calls and season replays are separate choices. Do not show replay evidence under a live badge or imply a historical headline is current-engine prospective accuracy. When live data is absent or below an established headline threshold, explain that state using the contract's semantics.

Where a correct/missed bar is shown, calculate both segments from the same decisive-call denominator. Do not multiply the response's all-scored `n` by an accuracy whose denominator excludes ties/50:50 predictions. If the existing contract does not provide the needed denominator or missed count, either extend it with a tested, equivalent aggregation or omit the segmented bar. The percentage/sample block alone is acceptable.

Link to `/methodology#accuracy` for the complete record. Specific future match predictions must retain visible confidence tiers, and undecided probabilities must follow the app's non-0/non-100 formatting rules.

## 4. The competition atlas

### Initial scope

Start with real **team listings aggregated by country** for the selected season. This works with the current data and is honest about geographic precision. The selected country shows its name, total listings, and an action that opens a real country-filtered team/event result view. If existing directory routes cannot accept a country filter, implement and test an appropriate filter or result list; do not create a dead “Explore” action.

The map represents FTC coverage. It must never imply that it shows visitor locations or people currently using Control Scout.

### Appearance

Use published geographic boundaries, a dark graphite ocean, subdued land, fine neutral graticules, and a restrained volt highlight for the selection. Keep small structural lines quiet. The eye should still find search first.

Use **Globe** and **Atlas** projection controls with the same selected country and data. An orthographic projection provides the globe; a flat projection provides a stable alternative. The country selector is a complete keyboard/touch alternative to pointer rotation and small polygons. Small territories and unmatched entries must remain available in a textual list even if a low-resolution geometry cannot display them.

Avoid giving the decorative geographic silhouette quantitative meaning it does not support. If country fill encodes a numeric value, provide the scale/legend and an accurate textual total. A selected-country highlight with neutral other countries is also acceptable and simpler.

### Data aggregation and reconciliation

Count season membership from `team_seasons`, joined to the team directory. A team number counts once per season. Avoid joining directly across all event appearances and double-counting the same team.

Keep reported directory country labels and a tested normalization layer for boundary joins. Handle aliases such as USA/United States, Türkiye/Turkey, and eSwatini/Eswatini without dropping or duplicating teams. Treat null, independent, and unmapped country values explicitly. The season total must reconcile with mapped plus unmapped/unknown categories; a missing shape is not a missing team.

Do not scatter random dots within country shapes, place team pins at country centroids, infer exact robot locations from city names, or fabricate connection arcs. If later adding verified team-city or event coordinates, label their precision, cluster them, and retain source/provenance and missing-coordinate behavior. That later pipeline is outside the initial remodel scope.

### Interaction and motion

Desktop pointer drag may rotate the globe. Selection through the country selector must work without drag. On phones, keep ordinary vertical page scrolling available over the map; use the selector and flat atlas as reliable alternatives. No essential interaction may depend on hover.

Start static. Short selection transitions may honor the existing animation setting and `prefers-reduced-motion`. If an optional idle rotation or auto-updating display is introduced, provide persistent pause/control behavior and disable nonessential motion under reduced motion. Do not add perpetual blinking, a scroll hijack, simulated activity pulses, or counters that advance on a timer without a server result.

### Technical approach

Prefer a small `d3-geo`/TopoJSON implementation over a new Three.js/WebGL scene for the first release. D3 documents both the [orthographic globe projection](https://d3js.org/d3-geo/azimuthal#geoOrthographic) and [Natural Earth flat projection](https://d3js.org/d3-geo/cylindrical#geoNaturalEarth1). This is an implementation recommendation, not a measured comparison of rendering libraries.

Resolve dependency licenses and types in the implementation PR. Bundle vetted, versioned geometry through the app's normal asset pipeline; do not rely on live third-party CDN scripts or map services for first paint. Natural Earth's own map data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/); verify the separate licenses of any packaging, conversion, and rendering libraries. Record the exact boundary source/version and explain low-resolution omissions.

Load atlas code and geometry separately from critical search/hero content. Reserve its aspect ratio to avoid layout shift. A static fallback plus country list must remain useful if JavaScript, geometry loading, or graphics rendering fails. Use `ResizeObserver` and element-relative dimensions, not an assumed viewport width.

## 5. Public usage: what can truthfully be shown

Use three parallel parts below the scouting content:

| Label | Definition | Required context |
| --- | --- | --- |
| Page views | Recorded opt-in page loads in the displayed interval | Date range, UTC-day convention, update time, opt-in coverage |
| Sessions started | Recorded tab-session starts, following the existing collector | A visit/session is not a unique person; blocked storage may undercount starts |
| Daily activity | Daily recorded page-view totals in the same interval | Axis/date labels, real observations, no invented interpolation across unavailable data |

The current implementation does **not** measure unique visitors, concurrent users, total people reached, user geographic locations, or predictions requested. Do not publish those metrics without a separate, justified measurement design. Avoid changing the collector or consent policy merely to make the homepage look busy.

Preserve consent, bot filtering, DNT/GPC handling, normalized route patterns, and no identity storage. Clearly label the panel as **opt-in activity** so the counts are not presented as all site traffic.

### Proposed public endpoint

The following is a proposed contract, not an existing endpoint:

```ts
type PublicUsage = {
  status: 'available' | 'unavailable';
  from: string; // YYYY-MM-DD, UTC
  to: string;   // YYYY-MM-DD, UTC; explicitly note if today is partial
  generatedAt: string;
  measuredThrough: string | null; // cutoff the returned aggregate represents
  coverage: 'opt-in';
  totals: { pageViews: number; sessionStarts: number } | null;
  daily: { day: string; pageViews: number; sessionStarts: number }[];
};
// GET /api/public-usage -- new, fixed bounded reporting window
```

Only return these aggregate fields. Do not expose the owner-only `StatsSummary` wholesale: it includes route, referrer, screen, and language breakdowns that the public panel does not need. Do not remove authorization from `/api/stats/summary`, place `STATS_TOKEN` in the client, or make a client proxy that sends it.

Use a bounded 30-day window and cache the result server-side. A short shared cache around 60 seconds is a starting recommendation, subject to actual performance checks. Use a manual refresh or the app's existing refresh conventions; a daily aggregate panel does not need second-by-second polling. Show “Updated …” rather than “people online.”

An unavailable feed must return `totals: null` and render an explanation/retry or a quiet unavailable state. Zero is valid only when the reporting feed is known to be published/available and the measured value is actually zero. Do not convert a missing table, disabled publishing, empty demo database, or failed request into a fabricated zero-usage claim. Retained stale totals must be visibly dated as stale.

The implementation must choose and test an explicit publication-availability signal so an empty local snapshot cannot masquerade as an authoritative production feed. If adding configuration, read it in `server/env.ts` and follow the repo's configuration conventions. New persisted schema changes require a new migration, never an edit to shipped migrations.

## 6. Data loading and suggested code boundaries

These names are suggestions for a small implementation, not required renames of existing architecture:

| Area | Suggested responsibility |
| --- | --- |
| `src/pages/Home.tsx` | Compose the responsive page and preserve page search/personal landing behavior |
| `src/components/home/CompetitionAtlas.tsx` | Lazy geographic rendering, projection/selection controls, textual fallback |
| `src/components/home/SeasonCoverage.tsx` | Season-scoped counts and source freshness |
| `src/components/home/PublicUsage.tsx` | Aggregate totals, real daily trend, definitions and unavailable states |
| Existing personal/events/track-record sections | Reuse or extract existing behavior while changing composition |
| `server/api/home.ts` | New cached season/country overview aggregation if no equivalent exists |
| `server/analytics.ts` or a dedicated public analytics module | New allowlisted public usage aggregation and publication state |
| `src/shared/api.ts` or a focused file under `src/shared/` | Shared public contracts |
| `src/index.css` / established UI components | Family tokens and reusable styling only where necessary |

A new `GET /api/home/overview?season=...` can provide season coverage and country totals if the existing API cannot do so economically. This endpoint does not exist yet. Define its scope, validation, cache key, source time, and no-data behavior in shared types and tests. Do not download the full team directory or all match records simply to count them in the browser.

Keep personal information out of shared public caches. Request a personal next-match block only when a real local/synced team is selected. Cache country/season aggregates by data version and season. Reuse the existing cached track-record endpoint rather than recalculating historical predictions on every home request.

Review the homepage's existing boot/SEO shell and shared `HOME_TAGLINE` when changing hero content. Initial markup, accessible headings, metadata, loaded React content, and the first-run tour should remain coherent. A failed atlas should not gate the rest of the page.

## 7. Responsive design, appearance, and accessibility

**Desktop:** the approved Observatory hero leads, followed by season strip and personal bar, then events and prediction record side by side. Use 24–32px section gaps, restrained 8–16px radii, and fine separators. Let the atlas be the visual anchor without making the page's useful actions small.

**Tablet:** size against the content container, not just viewport media queries. Stack when the sidebar leaves insufficient space; do not squeeze two unreadable columns into a nominal tablet breakpoint.

**Phone:** use Field desk ordering: headline, search/actions, season strip, personal next action, events, compact atlas, prediction record, usage. Keep search and both primary entry points visible early. The world view should be a purposeful compact section, not a full-screen obstacle before the scout's team.

Use the existing Inter/Space Grotesk/mono families, graphite surfaces, volt accent, and light-mode token equivalents. The concept's font sizes and spacing are reference values; production contrast, labels, and real text wrapping take priority. Body copy should remain comfortably readable rather than reproducing the study's densest small captions.

Native inputs/buttons/links need visible labels, normal focus indication, keyboard access, and meaningful accessible names. Touch targets should be approximately 44px. Keep a country selector/list equivalent to graphical selection, and do not announce every drag frame with `aria-live`. Preserve the native page scroll on touch devices.

W3C explains the need to control qualifying automatic motion and updates in [Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide), and how user-triggered nonessential motion can be disabled in [Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html). The latter is a Level AAA criterion; honoring reduced motion here is an explicit design requirement, not a claim that the whole product has achieved an accessibility conformance level.

## 8. Performance and failure states

Existing enforced budgets remain unchanged:

- Warm home interactive time under 3 seconds on throttled 4G.
- Home data under 100 KB and no charts chunk downloaded by home.
- Hot API route warm p95 under 300 ms.
- Cold start under 20 seconds.

Use the actual performance tool to measure the implementation. These are constraints, not results already achieved by this design brief. Avoid importing Recharts for a single daily usage trend; a small accessible SVG or a simple textual trend is enough. Import only the geography functionality required for the atlas.

Every remote block must have loading, populated, empty/unavailable, stale, and error behavior where applicable. Reserve space during loading. Keep search and existing navigation usable if home aggregates, usage, or map assets fail. A stale feed must not retain a green live indicator. Real events lacking schedules or scores should state exactly what is missing.

## 9. Implementation sequence

1. Read `AGENTS.md`, this brief, and the PR screenshots. Fetch main; preserve unrelated working changes. Continue the handoff branch in an isolated worktree if needed.
2. Inspect the current search, shell, boot content, personal redirect, live status, and accuracy interfaces. Identify any change since the inspected commit before editing.
3. Implement/test the season/country aggregation and the allowlisted public usage response, including unavailable and true-zero semantics. Keep prediction math untouched.
4. Build the responsive Observatory composition using existing search, UI tokens, events, personal state, prediction record, and actual routes. Implement phone ordering from the start.
5. Add the lazy globe/atlas and accessible country list, with real aggregation, source attribution, missing-location reconciliation, and fallback behavior.
6. Add the public usage section with real totals/trend or an honest unavailable state. Verify privacy boundaries and date labels.
7. Run focused checks while building, then the required full checks below. Capture the production implementation's before/after screenshots before marking its PR ready.
8. Update the existing PR title/body around the actual implementation. Request Greptile on the final head, address/reply/resolve findings, and repeat until 5/5 with zero unresolved threads.
9. Leave the PR reviewable with an exact status. Do not claim implementation, review, merge, deploy, or live verification happened without evidence. This handoff does not instruct an automatic merge or deployment.

The initial scope includes the complete responsive home, country-level atlas, existing scouting links, track-record integrity, and public aggregate usage or a justified unavailable state. Defer precise-location pipelines, animated visitor geography, new prediction math, site-wide navigation replacement, and a full theme redesign.

## 10. Acceptance criteria and verification

The implementation is complete only when these checks are satisfied or a specific external blocker is plainly recorded:

- [ ] Observatory is recognizable on desktop; phone ordering puts search, the scout's team, and events before the atlas.
- [ ] No mock counts, team defaults, event fixtures, fabricated map locations, artificial counter increments, or false live badges appear.
- [ ] Team/event/match search, typo matching, keyboard operation, and command/control-K still route correctly.
- [ ] A selected country changes the real total and has an accessible path to relevant results. Country aliases and unknown/unmapped teams reconcile with the season total.
- [ ] Globe/atlas state is consistent; keyboard and touch users can access the same essential information without dragging or hover.
- [ ] Country overview validation, cache invalidation/data versioning, empty data, season isolation, and duplicate prevention have meaningful tests.
- [ ] Public usage returns only allowlisted aggregates; the owner endpoint remains protected; opt-out/bot/privacy behavior still passes.
- [ ] Unavailable public metrics render as unavailable, while authoritative measured zeroes render as zero. Date boundaries, partial-day labels, and stale/error behavior are tested.
- [ ] Personal next-match safeguards, guest/local-only use, confidence tiers, and actual team links work without new login requirements.
- [ ] Live and replay evidence remain separate. Any correct/missed bar uses a tested consistent denominator; current engine/season labeling comes from the API.
- [ ] Desktop 1440x900 and mobile 390x844 screenshots show the real rendered implementation; inspect 320px, intermediate content widths, light appearance, and reduced motion too.
- [ ] All atlas/usage/API-down states preserve useful navigation and search. No console errors, horizontal overflow, focus traps, or unlabeled controls remain.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `npm run audit:perf` pass on the implementation branch.
- [ ] Run `npm run audit` and `npm run audit:flows` per [the self-audit runbook](../self-audit.md); record findings in `AUDIT.md`, fix and recheck them. Stop stale audit servers after server edits.
- [ ] Capture screenshots only with `npm run shots`, outside the repo, then embed them inline in the PR using `gh --attach`. Include before/after views and a motion video if motion is introduced.
- [ ] Latest Greptile review applies to the current PR head, scores 5/5, and has zero unresolved review threads. Prior approvals of the brief do not approve later implementation commits.
- [ ] If a deployment is separately authorized and performed, verify the actual live change and post a PR comment with a live screenshot. State anything that could not be checked.

For the present documentation-only PR, tests validate the unchanged application baseline and the brief itself is reviewed as documentation. The production implementation, audit, deployment, and their acceptance boxes are intentionally not claimed complete.

## 11. Handoff instructions

Use [the accompanying Claude prompt](./homepage-remodel-claude-prompt.md) to start the work in Claude. The repository had CI, deploy, and uptime workflows at inspection time, and no Claude implementation workflow. Opening a draft PR does not itself start a Claude session or schedule execution.

The screenshots on the PR are the visual handoff. Source paths in this brief are repository-relative so the brief remains useful on another machine. If the preview is opened separately, treat its frozen data and local interactions only as design references; implement through the real app's React components and APIs.
