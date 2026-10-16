# Notification inbox

The bell at the top right of the header (`src/components/layout/InboxBell.tsx`) collects
what happened in your workspaces that concerns you. Owners also get the server's owner
alerts there. The bell is in the header only, never in the sidebar, the phone tab bar or
the More sheet, and it's hidden when you're signed out. The unread badge and read state
are kept on the server, so they're the same on every device.

## Where items come from

### Workspace activity

Every item the activity feed logs (`server/scout/activityLog.ts`, `publishLogged`) is
handed to `queueInboxFanOut` (`server/inbox/inbox.ts`) right after its write commits. The
fan-out finds the accounts the item concerns and drops the actor. Then it drops anyone
who switched that kind off, and writes one row per remaining account.

| Activity type | Category (switch) | Who gets it | Opens |
| --- | --- | --- | --- |
| `assignment.*` | assignments | `details.assigneeAccountId` (or each of `details.assigneeAccountIds`) | the Assignments view (`/scout?space=…&season=…&view=assignments`); `assignment.deleted` opens the activity view |
| `entry.edited`, `entry.deleted`, `entry.restored`, `photo.added`, `photo.removed` | edits | the entry's author (`workspace_scout_entries.author_account_id`) | the entry (`?entry=<uuid>`); a deleted one opens the activity view |
| `comment.created` (or `comment.added`) | comments | the entry's author | the entry |
| `template.changed`, `settings.changed` | template | every cached member of the workspace (`workspace_members`) | admins: the template editor, or Settings › Workspace for settings; members: the activity view |
| `member.joined`, `member.left` | membership | the member it's about (`details.accountId`) | the workspace's space, or Personal after leaving |
| `picklist.*` | picklist | every cached member of the workspace | the activity view (Task 11 can point it at the pick list in `inboxLink`) |

`settings.changed` (Task 6: the defaults for new entries) is grouped with template changes
under one switch. Both are an admin changing how everyone in the workspace scouts.

**Never yourself.** An account is never notified about its own action. The activity's
`actor.accountId` is removed from the recipients.

**Coalescing.** A coalesced edit (`details.firstId`) replaces the recipient's item for the
edits it stands for, so three quick edits make one unread item ("3 edits"). Pick list
changes come in bursts: a workspace has at most one unread pick list item per account,
and it's always the latest one.

### What later tasks must emit

Log with `logActivity(workspaceId, actor, type, subject, details)`. Nothing else is
needed: the fan-out reads these fields.

- **Task 10 (assignments):** `assignment.created`, subject `assignment:<id>`, details
  `{ assigneeAccountId, team, season, eventCode?, matchLabel?, kind? }`. Use
  `assigneeAccountIds: number[]` for several assignees. Other `assignment.*` types
  (for example `assignment.completed`) notify the assignee in the same way, unless the
  assignee is the actor. Task 10 emits `assignment.created` once per assignee per request
  (several teams at once: `details.teams` and `details.assignmentIds`, `team` = the first),
  plus `assignment.completed`, `assignment.reopened` and `assignment.deleted`. See
  [assignments.md](assignments.md).
- **Task 11 (pick list):** `picklist.changed` (any `picklist.*`), subject
  `picklist:<season>`, details `{ season }`.
- **Task 15 (comments):** `comment.created`, subject `entry:<uuid>`, details
  `{ uuid, season, team, kind, eventCode, matchLabel, commentId, excerpt }`. `excerpt` is
  the first characters of the comment. The entry's author is looked up from `uuid`.

### Owner alerts

`server/portal/alerts.ts` hands open alerts over (see also
[r2-photos.md](r2-photos.md)). `deliverOwnerAlerts` reads the open alerts where
`inbox_item_id IS NULL` and writes one item for each owner account (`OWNER_EMAILS`) that
has the switch on. It then sets `inbox_item_id` to the first item's id, or to 0 when every
owner has the switch off. A unique index on `(user_id, source_alert_id)` means each alert
notifies each owner once, however often the hand-off runs.

The hand-off runs when an alert is first raised, and every 6 hours from the scheduler. The
scheduler run covers an alert raised before any owner account existed. Resolving an alert
marks its items read. The storage alert opens `/owner?panel=storage`.

## Per-kind switches

These are Tier 1 personal settings in `settings.notify` (`src/shared/inbox.ts`
`INBOX_TOGGLE`): `inboxAssignments`, `inboxEdits`, `inboxTemplate`, `inboxMembership`,
`inboxPicklist`, `inboxComments` and `inboxOwnerAlerts`. They appear in
Settings › Personal › Notifications. Each key is optional, and a missing key means on, so
a `notify` value saved before these switches existed keeps the same bytes. `cleanValue`
keeps only known `notify` keys with boolean values, on the client and on the server.

**The switches are checked at fan-out time.** The server reads the recipient's synced
settings (`user_state`, key `settings`) when it would make the item. A kind that is
switched off makes no item at all. Switching it back on doesn't bring back skipped items.
A device that never signed in has no synced settings, so every kind is on for it.

## Storage

The table is `inbox_items`, from migration 17:

```
id, user_id, at, workspace_id, workspace_name, category, type, subject,
actor_account_id, actor_name, title, body, link, read_at, source_activity_id, source_alert_id
```

- `user_id` is the Scout account (`users.id`). Sessions and synced settings belong to that
  account, and owners are recognised by its email. A Control Point account maps to it
  through `identities`.
- `workspace_id` is Control Point's workspace id. It is NULL for owner alerts.
- `title`, `body` and `link` are written when the item is made (`inboxText` and
  `inboxLink`), so every device shows the same words.
- `source_activity_id` and `source_alert_id` are each unique per account.

Items are kept for 90 days. `pruneInbox` runs from the scheduler every 6 hours and stops
when `CS_NO_SCHEDULER` is set. The table is in `PRIVATE_TABLES`, so it's never part of a
snapshot. Deleting an account deletes its items.

## API

All routes are signed-in only (401 otherwise), `no-store`. Writes accept JSON only (CSRF
protection, as for `/api/me`).

- `GET /api/inbox?before=<id>&limit=30` returns `{ items, more, unread }`, newest first.
- `GET /api/inbox/unread-count` returns `{ unread }`.
- `POST /api/inbox/read` takes `{ ids: [...] }` or `{ all: true, upTo?: <newest id seen> }`
  and returns `{ unread }`. It only touches the caller's own items. With `upTo`, an item
  that arrived after the reader last looked stays unread.
- `GET /api/inbox/stream` is a server-sent event stream (see below).

## Live updates

The app uses a lightweight per-account SSE stream. The workspace stream
(`/api/scout/stream`) is per workspace and only open while a scout space is on screen, so
it can't carry an inbox that spans every workspace and must work on every page.

- **`GET /api/inbox/stream`** sends `event: inbox` with `data {"unread": n, "latest": id}`.
  It sends one event on connect, then another whenever an item arrives or read state
  changes on any device.
- It sends a `: ping` every 25 s and checks the session every 5 minutes.
- Limits: 8 streams per account and 2000 per server. Each open stream counts in the owner
  portal's live connections as `inbox-stream`.
- With the owner's `realtime` switch off, the stream answers 503.
- nginx gives the path its own unbuffered location (`deploy/oracle-vm-setup.sh`).

The client side is `src/lib/inbox.ts`, `followInbox`:

- If the stream fails, it reconnects after 2 s, then 5 s, then 15 s.
- After that, or on a 503, or when EventSource isn't available, it polls
  `GET /api/inbox/unread-count` every 45 s while the tab is visible. It tries the stream
  again every 2 minutes.
- It fetches the count again on window focus.
- It closes the stream once the tab has been hidden for a minute.
- The list is fetched when the panel opens, and again on every count change while it's
  loaded.

Each stream instance keeps its listeners in its own process. One server process runs the
app, like the workspace stream (`server/scout/bus.ts`).
