# Demo account

`/demo` opens a shared, read-only account that shows Control Scout the way a team uses all of it. Anyone can open it.
It needs no email and no code.

## What's in it

The seed is in `server/demo/demo.ts` (`seedDemo`). It is rebuilt from the current database when it is older than
`DEMO_FRESH_MS` (6 hours). The first visit ever waits for the first seed. Later visits open at once, and a stale seed
is redone in the background in one transaction.

- **Event:** the newest finished event of the latest season with enough played qualification matches.
- **My team:** the event's top team by OPR.
- **Followed teams and events:** the next four teams, plus the event and the next one in its region.
- **Shortlist:** eight teams in pick order. Five have notes built from their real record and OPR, and three have colours.
- **Saved predictions:** three real engine calls on pairings from the event.
- **Personal scouting:** three pit entries and two match entries.
- **Team workspace "Demo Robotics (sample workspace)":** five scouts, with one scout per robot slot for up to 30 qualification matches and pit entries for up to 24 teams.
  - Answers follow each season's built-in template.
  - Values are scaled by each team's real OPR, so stronger teams scout stronger.
  - It also has comments, a 12-team pick list with notes, pit and match assignments, and an activity feed.
- **Inbox:** items made with the same words as real ones (`src/shared/inbox.ts`).
- **Videos:** real feed cards for the demo's teams, in Saved, Watch later and History, plus two notes at a moment in a video.

The FTC data is real: teams, events, matches, ratings, predictions and videos. Only what a person would have typed is
sample content: scouting answers, notes and comments. A banner on every page (`DemoNotice` in `Shell.tsx`) and the
`/demo` page both say so.

## Read-only

- `demoReadOnly()` sits in front of every `/api` router. It refuses any change from the demo session with 405
  `demo_read_only`, except signing out, signing into a real account, telemetry and reports (`DEMO_ALLOWED` in
  `src/shared/demo.ts`).
- 405 is used because no client code reacts to it. A 403 reads as "removed from the workspace" and a 423 as "workspace
  deleted".
- The app also stops those requests before they are sent (`apiFetch`) and shows one toast, so the server guard is only
  the backstop.

## Control Point

- The demo workspace and its sample accounts never reach Control Point.
- The account ids are `DEMO_ACCOUNT_ID` = 2,100,000,000 to +9, far above any real one.
- `controlPointInfo`, `refreshAccount`, `workspaceMembership`, `listWorkspaceMembers`, `getAccount` and
  `fetchAccountAvatar` all answer for them from `server/demo/demo.ts`.

## The visitor's own data

Entering the demo is handled like any account switch in `src/lib/personal.tsx`:

1. The device's data is stashed, along with whose it was (`cs-demo-return`). This includes a signed-out device's
   anonymous data, which is stashed and never merged into the demo.
2. Leaving the demo restores it. Leaving means signing out, or signing straight into a real account.
3. The demo's copy and its workspace keys are dropped.

A signed-in visitor is signed out first. Their data stays on their account.
