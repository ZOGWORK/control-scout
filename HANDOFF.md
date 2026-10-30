# HANDOFF — feature push, 2026-10-30

Repo: ZOGWORK/control-scout (base `main`, which was at d61386d when this started). Each feature runs in its own Claude
session/worktree and ends in its own PR. The rules every session follows: AGENTS.md; Greptile 5/5 with zero unresolved
threads, then merge yourself (merging main auto-deploys); app version = main + 1 at merge; migrations take the next free
number at merge; engine changes ship to Scout AND Control Point (ZOGWORK/control-point) on the same version, merged together;
commit and push after every small step; no Claude attribution in git; screenshots only via `npm run shots` or headless
Playwright, never the in-app browser pane.

**Honest status as of writing:** NOTHING below is merged. Every session started 2026-10-30 ~16:00–16:15 ET and was still
running. None had reported back. As of 16:25 ET, the only open PRs were #350 (partnership) and #351 (commons 1/3). Weekly usage was at 96%. Check each branch on GitHub for an open PR before
resuming. Only features Sushil has pasted so far are listed. His list said 67 remain; the rest haven't been sent, so they
aren't here.

**Owner-portal toggles (Sushil, 2026-10-30): every feature below must sit behind its own switch on the portal's Features tab.**
- Use the existing system: register the key in `src/shared/flags.ts` (`FLAGS` + `FLAG_META` + `FEATURE_OFF_MESSAGE`), then gate with
  `requireFeature` / `isEnabledFor` on the server and `GET /api/flags` in the app. Each PR adds a test that the flag off hides it,
  plus a screenshot of the new toggle.
- Keys: `factorSheet` (#2), `bracketOdds` (#3), `rulesReference` (#4), `scoutingCommons` (#5, workspace-scoped), `scoutingAlliances`
  (#6, workspace-scoped), `scheduleDifficulty` (#7), `seasonRoadMap` (#8), `venueLightMode` (#9), `eventBundle` (#10).
- #1 needs none: it changes nothing users see.
- Sent to every session at ~16:35 ET; delivery was queued, not confirmed read. A feature isn't done until its toggle exists.
- On a `flags.ts` merge conflict, keep every key.

---

## 1. Partnership memory (predictions)
- **What:** blend real past alliance results (together/against) into the Lab's odds, with the fact as a reason.
- **Status:** PR open, [#350](https://github.com/ZOGWORK/control-scout/pull/350); Greptile not yet run.
  - Branch `claude/partnership-memory-predictions-3e1adb`, commit c8ff3350.
- **Done:**
  - Already live since engine 2.4 (#231, #236): the "played together / against" fact shows in the Lab, match pages, offline
    and Control Point, as a reason only.
  - New this session: `scripts/partnership-refit.ts` re-tests the odds blend against engine 3.2 with a rolling origin. The
    result is in `docs/partnership-memory.md` ("Second look").
- **Decision made:** the blend FAILS the ship rule.
  - 2024–25 Δ Brier −1.06e-4; 2025–26 +0.82e-4, significantly worse; pooled ≈ 0.
  - The engine stays reasons-only (β = 0). No engine change, nothing for Control Point.
- **Left:**
  - (a) Get the PR (docs + script only, label `no-changelog`) through Greptile 5/5 and merge.
  - (b) LATER: rerun the script once 2026–27 has a few thousand rated matches. The same rule applies; ship only if it passes.
  - The local DB lacked 2019–22. Get a full snapshot if the rerun is borderline.
- **Depends on:** nothing.

## 2. Full "why" factor sheet
- **What:** expand the top-3 reasons into a full factor sheet (form, momentum, schedule, phase splits, head-to-head) with each
  factor's weight in the call. Shown behind an expander in the Lab and Know-your-match. Stored with live ledger calls, so
  post-match review shows which factors were right.
- **Status:** in progress (session "why-sheet", branch `claude/why-factor-sheet-a9b202`). No PR yet. Pushed as of 16:25 ET: 84879f9b engine 3.3.0 adds a full factor sheet to every explanation, numbers unchanged; 5d820333 stores it with live ledger calls (migration 58) and serves it on the match page, Know-your-match, the Lab and offline, with a 3.3.0 slice report bit-identical to 3.2.0.
- **Decisions:**
  - Add `factorSheet` to `MatchExplanation`. Keep `factors` (top 3) unchanged and derived from the same numbers, with a test
    that they never disagree.
  - Served odds and scores stay bit-identical (prove it with replay).
  - Partnership counts as weight 0.
  - Engine minor bump plus a matching Control Point PR.
- **Left:** screenshots, open the PR, Greptile 5/5, the matching Control Point PR (vendored 3.3.0 tarball + CP surfaces), and merge both together. Migration 58 may clash at merge: take the next free number.
- **Depends on:** nothing. Schedule difficulty (#7) could later feed its "schedule" factor.

## 3. Playoff bracket predictor
- **What:** on the event's Playoffs tab, series-by-series calls, championship odds per alliance and a "danger match" line,
  updating live between rounds.
- **Status:** in progress (session "bracket-predictor", branch `claude/bracket-predictor-938035`). No PR yet. Pushed: 140fdb02 model (format from the posted bracket, series calls, championship odds by Monte Carlo); 7a864c75 bracket odds on the event detail, cached per posted result, plus a walk-forward replay script. **Left:** run the replay and write up the numbers, the UI on the Playoffs tab, screenshots, PR, Greptile, merge.
- **Decisions:**
  - Reuse `src/shared/projectionCore.ts`'s sim and bracket; no new model.
  - Model the bracket from posted data; unknown formats get series calls only.
  - Clean states for "alliances not posted".
  - Measured with a walk-forward replay of past playoffs, numbers in the PR and `docs/`.
  - Prefer app code; if the engine changes, a CP PR is required.
- **Depends on:** nothing.

## 4. Question-box quick reference
- **What:** a searchable game-manual summary plus Q&A rulings, cached offline, for drivers in the question box.
- **Status:** in progress (session "question-box", branch `claude/question-box-reference-172454`). Nothing pushed as of 16:25 ET (probably still sourcing content).
- **Decisions:**
  - Static per-season content in the repo, stamped with the manual revision.
  - Summaries with section numbers, never the official text.
  - Rulings labelled "unofficial guidance".
  - Client-side search, in the offline/lite pack.
  - Unconfirmed rules are left out.
- **Depends on:** nothing. **Needed by #10** (event-day bundle).

## 5. Public scouting commons
- **What:** opt-in per-event pool. Workspaces publish pit entries (never match entries by default), readable by signed-in
  users at that event, with credit.
- **Status:** in progress (session "scouting-commons"). Split into 3 PRs. **PR 1/3 open: [#351](https://github.com/ZOGWORK/control-scout/pull/351)**, branch `claude/commons-api` (9e5ff14c per-event switch, workspace opt-in, per-entry share, signed-in read with consensus layer; c805eb10 commons tables kept out of the public snapshot). **Left:** #351 Greptile + merge; PR 2/3 UI + consensus layer on pages; PR 3/3 moderation (report/takedown, mute, owner portal).
- **Decisions:**
  - Per-entry publish flag behind a workspace opt-in (default off); commons table keyed by event + team.
  - A separate, labelled consensus layer; own data always outranks commons.
  - Photos keep the existing caps and expiry.
  - Report/takedown, per-workspace mute, owner-portal moderation.
  - An owner switch enables it per event (not global).
  - Timestamps shown prominently.
  - May be split into several PRs.
- **Depends on:** nothing. It conflicts with #6 on consensus/permission code: whichever merges second rebases.

## 6. Scouting alliances
- **What:** two workspaces link for one event: shared assignments and entries, one consensus, then split afterwards.
- **Status:** in progress (session "scouting-alliances", branch `claude/scouting-alliances-d46a10`). No PR yet. Pushed: c85fd4f5, the server side (invite/accept link for one event; shared reads of entries, assignments, coverage and the partner's pick list; one consensus over the union; copies at the end when both agreed). **Left:** UI, permission tests, screenshots, PR, Greptile, merge; rebase on commons #351 if that merges first.
- **Decisions:**
  - Invite + accept link record scoped to one event.
  - Consensus runs over the union.
  - Pick lists stay per workspace, with a "view partner's" toggle.
  - Authors keep edit rights; partner admins don't.
  - The link expires when the event ends. Each side keeps its own entries, plus a copy of the shared ones if both consented.
  - Coverage view shows each side's contribution.
  - Permission tests for every cross-workspace read/write.
- **Depends on:** nothing. Rebase against #5.

## 7. Schedule difficulty rating
- **What:** each team's qual-schedule strength against the field ("3rd-hardest schedule here") on the event and team pages.
  Recomputed mid-event on remaining matches. Included in offline packs.
- **Status:** in progress (session "schedule-difficulty", branch `claude/schedule-difficulty-1e2158`). No PR yet. Pushed: ad465307, the shared computation and a past-season evaluation. **Left:** API field, event + team page UI, offline pack stat, docs, screenshots, PR, Greptile, merge.
- **Decisions:**
  - Opponents' average engine rating minus partners', normalised across the field.
  - Reuse the engine's priors.
  - Explained in one plain line.
  - Exposed as a reusable function plus an API field (for "matches that matter" and the disagreement feed later).
  - Measured against the qual-rank vs rating-rank gap.
- **Depends on:** nothing. Feeds #2 (later) and future §6.3 / §1.9 features.

## 8. Season road map
- **What:** on the team page, the team's events in order, with advancement state and what's needed at the next event to
  reach championship.
- **Status:** in progress (session "season-road-map", branch `claude/season-road-map-91434c`). Nothing pushed as of 16:25 ET.
- **Decisions:**
  - Per-region advancement rules as curated, repo-stored, per-season config, each labelled with its source.
  - NEVER compute a "needed" number for a region that isn't encoded; those get the neutral "results so far + what's next" view.
  - At least NJ plus a few big regions.
- **Depends on:** nothing. Its team-page change must stay self-contained (#7 also edits team pages).

## 9. Ultra-light venue mode
- **What:** a text-first, no-image, server-rendered version of the event, team, match and pick-list pages for one-bar
  connections. Payloads in the low tens of KB. Auto-suggested when loads time out.
- **Status:** in progress (session "venue-light-mode", branch `claude/venue-light-mode-9f7f49`). Nothing pushed as of 16:25 ET.
- **Decisions:**
  - A rendering mode, not a second app.
  - Triggers: `?lite=1`, a manual toggle, and a conservative auto-suggest.
  - A one-tap "Full version" link on every light page.
  - Pick list keeps workspace auth.
  - Offline packs still take over when there's no signal at all.
- **Depends on:** nothing.

## 10. Event-day bundle + frozen match-day snapshots (one feature)
- **What:** one tap downloads an event's bundle: the event slice of the data pack, frozen static-HTML snapshots of the pick
  list and the user's Know-your-match reports, the rules reference, and a venue card. It has a manifest, a size label and a
  freshness stamp everywhere.
- **Status:** in progress (session "event-bundle", branch `claude/event-day-bundle-31fe4e`). Nothing pushed as of 16:25 ET.
- **Decisions:**
  - Event slice, not the season.
  - One bundle per event on the device, prunable.
  - Snapshots readable with zero JS fetches, with a "Snapshot from HH:MM, may be stale" banner.
  - Live data takes over when it loads; packs only take over with no signal.
  - If #4 isn't merged yet, ship with a pluggable rules section and add it in a follow-up PR.
  - Minimal venue card from existing data if none exists.
- **Depends on:** #4 (rules reference) for the full version; builds on the existing pack system.

---

## Resume order
1. **Check each session first.** Open each linked session or branch above, see what is pushed or merged, and update the
   statuses here. Don't restart a feature whose branch already has work; continue it.
2. Merge #350 (#1, docs only) and #351 (commons 1/3) once they reach Greptile 5/5.
3. Finish and merge the independent ones as they reach 5/5, smallest first: #4 → #7 → #3 → #9 → #8.
4. #2 with its Control Point PR (merged together).
5. #5, then #6 (the second one rebases on the first's consensus/permission changes).
6. #10 last: add the rules reference to the bundle once #4 is on main.
7. Then the features from Sushil's list that haven't been pasted yet.
8. Later, once 2026–27 has data: rerun `scripts/partnership-refit.ts` (#1b).

## Blocked / need from Sushil
- **Nothing hard-blocked.** Decisions that are his to overrule:
  - **#1 Partnership:** the brief asked for the history to move the odds, but the data says it makes 2025–26 worse, so it
    stays a reason only. Say if you want it shipped anyway (not recommended).
  - **#5 Commons:** which events to switch on first, and who moderates (default: owner portal, owner only).
  - **#8 Road map:** which regions matter most to encode first (default: NJ + a few large ones).
- **The rest of the 67 features:** paste them, or point to the file in Downloads they come from.
