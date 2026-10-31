# Scouting commons

An opt-in, per-event shared pool of **pit** scouting. A workspace can share pit entries with every signed-in
Scout user at that event, credited to the workspace. Match scouting always stays inside the workspace.

Code: `server/scout/commons.ts` (server), `src/shared/commons.ts` (types shared with the app), `src/lib/commons.ts` and
`src/components/CommonsSection.tsx` (the app), `src/components/owner/CommonsPanel.tsx` (the console). Migrations 58-59.

## The owner's toggle, above everything

`scoutingCommons` is a feature toggle (Owner console › Features), with per-workspace overrides like workspace
scouting. Off globally, every commons route answers 403 `feature_disabled` and the app hides the commons, whatever
each event's switch says. Off for one workspace, its shares are hidden and it can't share or opt in. Nothing is deleted
either way. The console's own commons routes are never gated.

## Three switches, all off by default

An entry is in the commons only while all three are on:

| Switch | Who | Where | Stored in |
|---|---|---|---|
| The event | the owner | owner console (`PUT /api/owner/commons/events/:season/:code`) | `commons_events` |
| The workspace | its admins | workspace Settings (`PUT /api/scout/workspaces/:id/commons`) | `commons_workspaces` |
| The entry | its author, or a workspace admin | the pit entry (`PUT /api/scout/workspaces/:id/commons/entries/:uuid`) | `commons_entries` |

- **Per event, not global.** The owner opens the commons one event at a time, so the moderation load stays
  reviewable. Closing an event hides everything shared there at once (nothing is deleted; reopening shows it again).
- **Opting out withdraws everything** the workspace shared. Opting back in republishes nothing by itself: each
  entry is shared again on purpose.
- **Sharing is refused** for a match entry, a pit entry with no event, an event the commons isn't open at, and a
  workspace that hasn't opted in. Each refusal has a `code` and a plain sentence (`COMMONS_REFUSAL`).
- Workspace scouting switched off for a workspace (the owner's per-workspace `workspaceScouting` override) hides its
  shares too.

## What a reader gets

`GET /api/scout/commons?season=&team=[&event=]`, any signed-in account (`401` signed out; never cached by a shared
cache). "At that event" means the event the entry was scouted at: the read is per team, across every event of the
season the commons is open at, or one event when `event` is given.

- **Entries**, newest scouted first, each with the source workspace's **name** (never a person's), the event, the
  answers read with the fields of the template the entry was made with, the notes, the photos, `scoutedAt` (when the
  entry was last edited: how old the pit claim is) and `publishedAt`.
- **The layer**: the entries rolled up exactly like a workspace's consensus (`aggregateConsensus`), pit fields only.
  Each source workspace counts as one scout, so `scouts` is how many workspaces shared.
- **The reader's own workspaces are left out** (`ownHidden` counts them): they read those as their own scouting,
  which always comes first on their pages. The commons is a separate, labelled layer below it.

Entries are read live from `workspace_scout_entries`: an edit shows at once, a deleted entry drops out, and the
commons' event + team key follows an edited entry (the entry write hook, `onEntriesWritten`). An entry edited to
another team or event moves with it; to a closed event, it's hidden.

## Photos

Commons photos are the workspace's own entry photos (`entry_photos`): the same per-entry cap, storage soft cap and
expiry (2 days after the event, docs/r2-photos.md). A reader opens one through `GET /api/scout/commons/photos/:id`,
which answers a short-lived signed URL only while the photo's entry is in the commons (`404` otherwise, `410`
expired). Off with the rest of photos (R2 not configured, or the `photos` switch off).

## Moderation

In Owner console › Moderation › Scouting commons:

- **Reports.** Any signed-in reader reports a shared entry (`POST /api/scout/commons/reports {entryId, reason, note}`).
  The reason is one of wrong, outdated, inappropriate or other. A reader can have one open report per entry and
  at most 20 reports a day (the cap is checked in the insert itself). Reporters are never shown to the workspace or the
  owner, and deleting an account deletes its reports and mutes. The queue groups reports by entry, most reported first,
  each with the entry as it is now: its answers, notes and photos (`GET /api/owner/commons/photos/:id`). A workspace
  hidden by the owner's switches takes no reports.
- **Take down / restore.** A takedown sets the share to `removed` with a reason: it's hidden at once, its open reports
  close as "removed", and the workspace can't share it again. The entry's share switch says why. Restoring shares it
  again as it was. **Dismiss** closes an entry's reports and leaves it shared. Takedowns list newest first, 50 at a
  time (`GET /api/owner/commons/removed?before=&entryId=` for older ones).
- **Suspend a workspace.** Everything it shared is hidden and it can't share, until lifted. Its own scouting is untouched,
  and its members can still unshare entries (so lifting the suspension doesn't bring back what they withdrew).
- **Mute (readers).** `PUT /api/scout/commons/mutes/:sourceId {muted}` hides a source workspace's shares for that reader
  only. Workspaces muted that share on the team are listed under its entries with an Unmute button.

Every owner action is in the audit log (`commons.entry.remove|restore`, `commons.reports.dismiss`,
`commons.workspace.suspend|unsuspend`, `commons.event.open|close`). The console's Moderation section shows a badge
with the number of reported entries waiting.
