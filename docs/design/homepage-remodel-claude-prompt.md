# Claude prompt: implement the FTC Observatory homepage

You are implementing the approved Control Scout homepage remodel in `Control-Point-FTC/control-scout`.

The user has approved the **Observatory** design direction and asked you to implement it **tonight, Saturday, October 17, 2026, targeting 11:59 p.m. America/New_York (EDT)**. Start work now when this prompt is given to you. The target is not permission to skip verification or claim unfinished work is done; report precise remaining work if time runs out.

## Start from the handoff

1. Read `AGENTS.md` and `CLAUDE.md` first.
2. Fetch origin and locate the existing draft PR for branch `codex/homepage-observatory-handoff` against `main` in `Control-Point-FTC/control-scout`. Continue that branch/PR rather than creating a competing implementation PR. Use an isolated worktree if the current checkout contains unrelated work. Do not overwrite someone else's changes or push to main.
3. Read `docs/design/homepage-remodel.md` in full. It contains the approved composition, repository findings, actual versus proposed API boundaries, privacy requirements, edge cases, and acceptance checklist.
4. Open the PR's attached desktop/mobile concept screenshots. The approved public desktop layout is **Observatory**. The **Field desk** reference supplies mobile/task-first ordering; it is not a second shipped theme or a variant picker for users.

If you need to find the PR from the terminal:

```bash
gh pr list --repo Control-Point-FTC/control-scout --head codex/homepage-observatory-handoff --state open
```

The current PR initially contains research and instructions only. Your task is to implement the product, not to polish the plan and stop. Keep going through integration, testing, screenshots, and review until the result is concretely reviewable.

## Build this experience

Preserve Control Scout's working shell, Control Point family tokens, local fonts, navigation destinations, light theme, existing full search, personal state, and no-login browsing/predictions.

On desktop, compose:

1. A left-aligned editorial/search hero beside a competition globe, with headline **“The whole field. In your corner.”** and supporting copy **“Find your team. Follow the competition. Make your next call with the full picture.”**
2. The existing real team/event/match search and keyboard behavior, followed by **Predict a match** and **Find an event**, visible without waiting for the atlas.
3. One compact strip of season-scoped team listings, listed events, and recorded match-score counts, with real freshness metadata.
4. A conditional real personal-team/next-match action. Team 4215 is the user's reference team, not a hardcoded visitor default. Preserve current next-match staleness handling, confidence tiers, local-only use, and signed-in landing behavior.
5. A concise real event schedule beside a prominent public prediction record. Keep scheduled versus live versus completed status truthful.
6. A lower **“Control Scout, in use.”** section showing opt-in page views, session starts, and a real daily trend, or a clearly explained unavailable state.

On mobile, order the content as search/actions, season strip, personal team, events, compact atlas, prediction record, usage. Keep search and both main actions easy to reach. The globe must not delay access to the actual scouting task.

The world view must use real season team totals aggregated by reported country, with a globe/flat-atlas switch, country selector, selected-country count, and a genuine path to filtered results. Use published boundaries and a small lazy geographic renderer. Give keyboard/touch users a country list equivalent. Reconcile unknown/unmapped countries and aliases with the global total. Do not pretend that country centroids are precise team locations, add random dots/arcs, or show visitor geography.

Use the existing `src/components/ui` pieces and `src/index.css` tokens. The concept's temporary rail, sample search, preview dialogs, carousel, and host-only controls must not enter production. Integrate into the existing app; do not paste an exported HTML mockup over the route.

## Data and integrity constraints

- Every visible value comes from the actual app data or has an honest loading/empty/error/stale/unavailable state. Never carry the October 13 prototype's counts, team sample, engine version, or historical percentage into production as constants.
- Inspect and reuse current server contracts. New `/api/home/overview` and `/api/public-usage` routes in the brief are proposals, not existing endpoints you can assume work.
- The current collector measures opt-in page views and tab-session starts. These are not unique people, online users, or all site traffic. Keep those distinctions visible in labels and date definitions.
- Create a separate allowlisted public aggregate response if needed. Do not make `/api/stats/summary` public, leak `STATS_TOKEN`, or expose route/referrer/screen/language breakdowns to fill the public panel. Preserve consent, DNT/GPC, bot filtering, and the no-identity model.
- Distinguish an authoritative measured zero from an unpublished or unavailable reporting feed. Establish and test publication availability instead of treating an empty development database as production zero.
- Use the existing cached `/api/predict/accuracy` semantics. Keep logged-live calls and historical replay results separate, showing their season/range, evidence type, sample, and current API metadata. If drawing correct/missed segments, obtain the decisive-call denominator rather than deriving counts from an incompatible all-scored sample.
- Any particular upcoming-match prediction must show its confidence tier and use the app's bounded probability display. Do not alter prediction math, retrain models, or change `packages/predict-engine/` for this UI work.
- Shared web/server types belong under `src/shared/`. Web code must not import server modules. Secrets/configuration are read through `server/env.ts`. Any necessary persisted schema change gets a new numbered migration.

## Performance, accessibility, and failure handling

Search and navigation must paint and work before atlas loading completes. Lazy-load the map renderer/geometry, reserve its layout space, and provide a useful static/text alternative on failure. Do not load full directories/match histories to calculate browser-side totals or recompute historical predictions per request. Cache public aggregate responses with clear data timestamps and correct season/data-version invalidation.

Use a static initial globe. Honor reduced motion and the app's motion preference; provide persistent pause control if introducing optional automatic animation. Do not hijack touch scrolling or make essential information hover-only. Keep focus visible, inputs labeled, touch targets usable, and text readable in both appearances. Verify 320px through desktop widths and intermediate widths inside the existing sidebar shell.

Keep the existing budgets: warm home interactive under 3 seconds on throttled 4G, home data under 100 KB, no home charts chunk, hot API warm p95 under 300 ms, and cold start under 20 seconds. Measure with the actual repository tooling rather than asserting the budgets will pass.

## Implement and prove it

Write meaningful API/component regression tests for new behavior and real failure boundaries: season aggregation/deduplication/country aliases/unmapped values, public response allowlisting, unavailable versus true-zero usage, date ranges/staleness, existing full search and personal-next-match behavior, and live/replay/denominator integrity. Follow the repo's requirement that bug fixes include a regression test that fails without the fix.

Run the required checks on the final implementation:

```bash
npm run lint
npm test
npm run build
npm run audit:perf
npm run audit
npm run audit:flows
```

Follow `docs/self-audit.md`, including real feature click-throughs and loading/API-down/offline states. Log findings in `AUDIT.md`, fix them, and recheck failures. Stop stale audit servers after server edits; use the documented port overrides when needed. Do not weaken tests, performance thresholds, or audit coverage to reach the deadline.

Capture before/after desktop and mobile screenshots with the existing `npm run shots` tool, outside the repository. Attach and embed them inline in the PR before marking the implementation ready; use a motion video if animation changes. Do not commit screenshot files. The handoff's concept images are design references, not evidence that your final implementation rendered correctly.

Update the existing PR title/body to describe the actual final change and actual validation. Trigger `@greptile review`, address each actionable finding, reply on and resolve addressed threads, push, and re-trigger as needed. The final review must be on the current head commit, score 5/5, and have zero unresolved threads. A review of the documentation-only handoff does not satisfy review of your implementation.

Leave a clear implementation report with what changed, screenshots, tests/audits, review status, and any blocked/unverified items. This prompt requests a reviewable implementation PR; it does not request an automatic merge or deployment. If a deployment is separately authorized, verify the live result and post the required screenshot comment.

## Definition of done

The PR implements the approved responsive homepage with a real country atlas, existing complete search/scouting navigation, honest prediction evidence, public aggregate usage or a justified unavailable state, complete required checks, and current-head Greptile 5/5 with no unresolved threads.

Do not stop at another proposal, a screenshot-only page, a static mockup, an unconnected interface, or a promise to continue later. If there is a genuine external blocker or the target passes before completion, report the exact state and remaining work without presenting the remodel as finished.
