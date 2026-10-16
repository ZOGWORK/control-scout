# Shared accounts: Control Point × Control Scout

One account works on both apps. Sushil's decision (2026-10-13): **one shared
user store, owned by Control Point**; Control Scout reads and writes it through
an internal API on Control Point.

## Why this shape

- The apps live on different domains (tryctrlpoint.org, controlscout.org), so
  they can't share a session cookie.
- Control Point has no account entity today. An "account" there is an email
  plus one `members` row per team workspace, and signing up always means joining
  or creating a team. Scout users usually have no Control Point team, so Scout
  must never create `members` rows, prove passwords, or write `verified_emails`.
- So the shared store is a new, small `accounts` table in Control Point, keyed by
  lower-cased email. Its id is the person's account id in both apps. Control
  Point's existing tables are untouched. A Control Point workspace and a Scout
  account with the same email are, by definition, the same account.

## Control Point side (owner of the store)

### `accounts` table (new migration)

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | the shared account id |
| `email` | TEXT NOT NULL UNIQUE | lower-cased, trimmed |
| `display_name` | TEXT | optional |
| `verified_by` | TEXT NOT NULL | first proof seen: `control-point`, `scout-email-code`, `google` |
| `created_at` | TEXT NOT NULL | ISO |
| `last_seen_at` | TEXT | ISO, touched on resolve/hand-off |

`scout_handoff_codes(code_hash TEXT PK, account_id INTEGER NOT NULL, state TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT)`.
The code is sha256-hashed, with a 2-minute TTL, and is single use.

### Internal API: `/internal/*`

- Mounted **before** the `/api` CSRF middleware (like `/api/csp-report`), JSON in/out.
- Auth: header `X-Internal-Key` must equal `CONTROL_SCOUT_INTERNAL_KEY` (env,
  at least 32 characters), compared in constant time. If the env var is unset,
  every `/internal/*` route returns 404. Wrong or missing key → 401.
- Not rate-limited by IP (calls come from 127.0.0.1); keyed limits are fine.

| route | body | result |
|---|---|---|
| `POST /internal/accounts/resolve` | `{ email, verifiedBy: "scout-email-code" \| "google", displayName? }` | upsert by email, then `200 { account }` |
| `GET /internal/accounts/:id` | | `200 { account }` or `404` |
| `POST /internal/handoff/redeem` | `{ code, state }` | `200 { account }`, or `400 { error }` if the code is invalid, expired, used, or doesn't match the state. The code is marked used. |
| `GET /internal/workspaces/:workspaceId/members` | | `200 { workspace: { id, name }, members: [{ accountId, name, role }] }`: everyone with an active `members` row, one entry per email, admins first. `accountId` is the shared account for that email, or `null` if they've never used Scout. `400 { error: "invalid_workspace" }`, `404 { error: "not_found" }` (no such team). |
| `POST /internal/workspaces/:workspaceId/members/remove` | `{ accountId, actorAccountId }` | `200 { ok: true }`. Both ids resolve to emails, then to active `members` rows on that team. `400 { error: "invalid_input" }`, `403 { error: "not_admin" }` (the actor isn't an admin there), `404 { error: "not_member" }` (the target has no active row there), `409 { error: "last_admin" }`. Removal is Control Point's own soft remove (the one behind an admin's `DELETE /api/members/:id`): `is_active = 0`, roles, sessions and sticky notes dropped, history kept. Removing yourself is allowed unless you're the last admin. |

An older Control Point answers both members routes with a bare `404 { error: "Not found" }`
(any unknown `/internal` path); the routes' own 404s carry a code, so Scout can tell them apart.

```ts
account = {
  id: number,
  email: string,
  displayName: string | null,
  createdAt: string,
  controlPoint: { member: boolean, teams: { teamNumber: number | null, name: string }[], shortlist?: number[] },
  workspaces: { id: string, name: string, role: "admin" | "member" }[]
}
```

`controlPoint.member` and `teams` come from the active `members` rows with this
email. That is read-only: it lets Scout say "you're also on team X in
Control Point".

`workspaces` lists the Control Point workspaces (teams) the account belongs
to, one per active `members` row, and is what Scout's shared scout spaces are
built on:

- `id` is `String(teams.id)`. It stays the same across renames. Scout treats it
  as opaque: any 1 to 64 characters of `[A-Za-z0-9_-]`.
- `name` is the workspace's current name, which can change.
- `role` is `admin` if the member's `account_type` is `admin`, or if they hold a
  role on that workspace with the `"*"` or `"manage_members"` permission.
  Anyone else is a `member`.
- A deactivated member's workspace drops out of the list. Roles are read fresh
  on every call.
- The field is additive. An older Control Point deploy doesn't send it, so Scout
  reads a missing or malformed list as `[]`. Malformed items are dropped one at
  a time, never the whole list. Scout then stays personal-only.

### Public hand-off: `GET /api/auth/scout/start?state=…`

- `state` is opaque, 16–128 characters of `[A-Za-z0-9_-]`.
- If the visitor has a valid `cp_session`: ensure an `accounts` row for the
  session's email (`verified_by = control-point` when new), issue a hand-off
  code, then `302` to
  `${CONTROL_SCOUT_URL}/api/auth/control-point/callback?code=…&state=…`.
  It only ever redirects to the exact origin in `CONTROL_SCOUT_URL`, never to an
  address taken from the request.
- If not signed in: send the visitor through Control Point's normal sign-in,
  then back to this same URL.
- Control Point account creation is unchanged: someone who signs up on Control
  Point with an email that already has an `accounts` row gets that account's id
  (it's keyed by email). That's the "auto-merge" in the Control Point → Scout
  direction.

## Control Scout side

- Env (`server/env.ts`):
  - `CONTROL_POINT_INTERNAL_URL`: `http://127.0.0.1:3000` on the VM.
  - `CONTROL_POINT_PUBLIC_URL`: `https://tryctrlpoint.org`.
  - `CONTROL_POINT_INTERNAL_KEY`: the same secret as Control Point's `CONTROL_SCOUT_INTERNAL_KEY`.

  With any of them unset, the feature is off: the provider is hidden, and email
  and Google sign-in work exactly as before. Render, the rollback host, runs
  like this, because it can't reach Control Point's loopback port.
- Every Scout sign-in (email code, Google) calls `resolve` with a 3 s timeout
  and links `identities(provider = 'control-point', subject = String(account.id))`.
  A failure never blocks sign-in; the link is retried on the next request.
- **Continue with Control Point:**
  1. `GET /api/auth/control-point/start` sets the `cs_cp_state` cookie
     (`path=/api/auth/control-point`, 10 min) and redirects to Control Point's
     `/api/auth/scout/start?state=…`.
  2. Control Point sends the visitor back to `/callback`.
  3. Scout checks the state against the cookie, redeems the code server to
     server, then runs `userForIdentity('control-point', id, email)` and starts
     a Scout session.
- Scout's `users` table stays as the local profile, and personal data stays keyed
  by Scout's user id. The shared id lives in `identities`. Two Scout users that
  turn out to share one Control Point account are merged by email, as
  `userForIdentity` already does.

### Workspaces and the membership cache

Control Point decides who belongs to which workspace. Scout only mirrors that
and never creates, edits or removes `members` rows.

- Every fetch of the account goes through `server/auth/controlPoint.ts`, the
  one place Scout calls Control Point's internal API: sign-in (`resolve`), the
  hand-off (`redeem`), `/api/auth/me` and the re-checks below. Each fetch
  rewrites that account's rows in `workspace_members(account_id,
  cp_workspace_id, workspace_name, role, updated_at)`: rows are added or
  updated, and workspaces that are no longer listed are deleted. An account
  Control Point no longer knows (`404`) is left with no rows.
- `/api/auth/me` serves the account from a 10-minute in-memory cache, so it
  asks Control Point at most every 10 minutes per account. It returns the list
  as `user.controlPoint.workspaces`. A plain `/me` writes nothing except this
  membership cache. Opening Scout creates no workspace or entry rows.
- **Every workspace read and write** (`POST /api/me/scout/sync` with a
  `workspaceId`, `GET /api/scout/sync`) needs the signed-in user's linked
  account to be a member of that workspace:
  - A cached row younger than 10 minutes is trusted as it is.
  - A missing or older row makes Scout ask Control Point once and decide from
    its answer, not from the cache, so a failed cache write can never keep a
    removed member in.
    These re-checks are at most one per account at a time, and at most one
    every 5 seconds.
  - Still not a member: `403`. Not linked to Control Point, or Control Point
    not configured: also `403`.
  - Control Point unreachable: a stale row still counts, so a team scouting at
    a venue isn't cut off. A missing row is still a `403`.
- The `workspaces` mirror row (`cp_workspace_id` unique, `name`, `settings`
  JSON and `settings_version` for workspace settings) is created by the
  workspace's first entry. When a refresh sees a rename, it updates the name
  on an existing row. It never creates one.
- Personal scouting doesn't depend on any of this. With no Control Point
  settings, no `workspaces` field, or Control Point down, Scout works exactly
  as before, and sign-in is never blocked.

### Workspace scout entries

Personal entries stay in `scout_entries`, keyed by the Scout user, unchanged.
Shared entries live in `workspace_scout_entries`, keyed by `(workspace_id,
uuid)`:

- The server stamps authorship: `author_*` is set by the first write and
  never changes after that, and `editor_*` is set by every accepted write. Author fields sent by the client are
  ignored. The name is the user's display name, or the part of their email
  before the `@` if they haven't set one.
- Last write wins, on the server too. A write only replaces the stored row if
  its `updatedAt` is newer. Deletes are tombstones (`deleted: true`).
- Each accepted write gets the next `seq`, the workspace's server-side write
  order. Pulls page by `seq` rather than by `updatedAt`, which is the
  writer's clock. That way an entry synced late with an old timestamp is still
  picked up, and entries with equal timestamps keep a stable order.

| route | body / query | result |
|---|---|---|
| `POST /api/me/scout/sync` | `{ workspaceId?: string \| null, entries }`, at most 200 | `{ results: [{ uuid, ok, error?, entry? }] }`. Without a `workspaceId` (or with `null`) the entries go to the personal set, exactly as before. With one, they go to that workspace (`403` for non-members), and `entry` is the stored copy for the device to adopt. An entry whose own `workspaceId` names a different space is refused (`"wrong space"`). A write the permissions below don't allow comes back as `{ uuid, ok: false, error: "forbidden", entry }`, with `entry` the server's current copy. The push as a whole is still `200`. |
| `GET /api/scout/sync?workspaceId=…&since=…` | `since`: a `cursor` from the last pull, `0` the first time | `{ entries, cursor, more }`: the entries written after `since` in write order, tombstones included, 500 at most. If `more` is true, pull again from `cursor`. |

### Workspace permissions

Roles come from Control Point and nowhere else: `admin` is a `members` row
with `account_type = 'admin'`, or a role with the `"*"` or `"manage_members"`
permission. Everyone else in the workspace is a `member`. Scout has no roles of
its own and no invite screen; roles are changed in Control Point. Removing a
member can also start in Scout (below), but Control Point does it.

### Workspace members (Settings → Workspace → Members)

Control Point's `members` table is the source of truth; Scout mirrors it and
never forks it. Server code: `server/scout/members.ts`; Control Point calls in
`server/auth/controlPoint.ts`.

- **List.** `GET /api/scout/workspaces/:id/members` (any member) returns
  everyone from Control Point's members route: name, role, and `you`. People
  who've never used Scout have no account id and can't be removed from Scout
  (they're managed in Control Point). If Control Point can't list them
  (unreachable, or an older deploy), Scout lists the members it knows from its
  cache ("Members who use Control Scout").
- **Remove.** `POST /api/scout/workspaces/:id/members/remove` `{ accountId }`.
  Scout checks the caller is an admin (`requireWorkspaceAdmin`: a member gets
  403 without Control Point being asked), then calls Control Point's remove
  route with the caller's account id as the actor. Control Point checks the
  admin again and keeps the last admin (409, shown in the confirm dialog). On
  success Scout at once drops the person's `workspace_members` row and forgets
  their cached account, logs `member.left` in the feed with the admin as actor
  (`details.origin: "control-scout"`, `details.self` when they left), ends
  their open streams there with `membership_revoked`, and records
  `workspace.member_removed` in the owner audit. Errors: 400 bad id, 403, 404
  (already gone; the cache catches up), 409, 501 (older Control Point), 502
  `unconfirmed` (unreachable or timed out: it may have happened, so Scout
  re-checks the account in the background).
- **Races.** While Scout's removal is in flight, a refresh that already sees it
  drops the row but leaves the record to the removal, so it's logged and
  audited once, with the admin as actor; if Scout's call then fails or goes
  unanswered, what the refresh saw is recorded as Control Point's. An account
  answer asked for before Scout dropped a membership can't put the row back;
  one asked for after it can (someone re-added at once counts).
- **Older Control Point.** Without the members routes the list comes from
  Scout's cache and the Remove buttons are off with "Removing members needs
  the latest Control Point". Nothing else changes.
- **Removed in Control Point.** The next membership refresh (sign-in, `/me`
  with a cold cache, or any read or write once the cached row is older than 10
  minutes) drops the row, logs `member.left` (actor Control Point), records the
  audit row (`origin: "control-point"`), and ends the person's streams there.
  The app re-reads `/api/auth/me` every 5 minutes while visible and when it
  comes back to the front, and a refused poll (403) counts like
  `membership_revoked`, so the page leaves the workspace for Personal with
  "You were removed from <workspace>".
- **What removal never does.** It ends workspace access only. The person's
  Scout account, personal data and personal entries are untouched, and their
  workspace entries stay with their authorship.

| | member | admin |
|---|---|---|
| Read the workspace's entries (pull, live stream) | yes | yes |
| Create an entry | yes | yes |
| Edit any entry that isn't deleted | yes | yes |
| Delete an entry they created | yes | yes |
| Delete someone else's entry | **no** (`forbidden`) | yes |
| Edit (bring back) an entry that has been deleted | only one they created | yes |
| Workspace templates and settings (Tasks 5 and 6) | no (`403`) | yes |

- **The server enforces this.** The check is part of the upsert's `WHERE`
  clause, in the same statement as the write, so no other write can land
  between the check and the write. `mayWrite` in `server/scout/entries.ts` is
  the same rule in TypeScript.
- **A refused write** is never stored, never gets a `seq` and is never
  published to the live streams. Its result is `ok: false, error:
  "forbidden"` with the server's copy, and the app puts that copy back on the
  device. A refused delete shows "Only the author or a workspace admin can
  delete this entry." A refused edit of an entry that was deleted meanwhile
  shows that it was deleted by its author or an admin.
- **Bringing back a deleted entry.** Saving a non-deleted version over a
  tombstone counts as a delete in reverse, so it follows the same rule: only
  the entry's author or an admin can do it. This stops a member's offline edit
  from undoing an admin's delete.
- **An entry the server has never seen** is always accepted, tombstone
  included: an entry created and deleted on a device before it synced belongs
  to whoever sent it.
- **Authorship never changes.** `author_account_id` is set when the row is
  created and no later write touches it. That is what "own entry" means.
- **Last write wins first.** A write older than the stored row loses as
  before (`ok: true` with the newer copy). `forbidden` only appears for a
  write that was newer and was still refused.
- **Role changes** take effect from the next membership refresh: sign-in, the
  hand-off, `/api/auth/me` (which asks Control Point at most every 10
  minutes), or a write once the cached row is more than 10
  minutes old.
- **Admin-only routes** (templates and settings, Tasks 5 and 6) use
  `requireWorkspaceAdmin()` from `server/scout/entries.ts`. It's Express
  middleware that reads the workspace id from the route parameter, the query
  or the body. It returns `401` if signed out, `503` while workspace scouting is paused in the owner portal, `400` for a bad id, and `403`
  for a non-member or a member who isn't an admin. Otherwise it puts the
  membership on `res.locals.membership`. `workspaceAdminAccess(user,
  workspaceId)` is the same check without Express.
- **The app** shows the Delete button on a workspace entry only to its author
  (or on an entry that hasn't synced yet, which is yours) and to admins. It
  matches `authorAccountId` against `user.controlPoint.accountId` from
  `/api/auth/me`, and reads the role from `user.controlPoint.workspaces`.
  Hiding the button is a convenience; the server is what enforces the rule.
  Personal entries are unchanged.

### Scout spaces (the Scout page)

The Scout page shows one space at a time: **Personal** (your own entries,
exactly as before workspaces) or one shared space per workspace in
`user.controlPoint.workspaces`. The switcher at the top lists Personal first,
then each workspace with its role ("admin") and, for the spaces not on screen,
how many entries wait to sync there. Up to four workspaces it is a segmented
control that scrolls sideways on a phone; with more it is a dropdown. Nothing
migrates or merges between spaces: the switcher only changes which entries you
see and where a new entry is saved. The logic is in `src/lib/scoutSpace.ts`.

Which space opens (`resolveScoutSpace`):

1. Signed out, workspace scouting paused (the `workspaceScouting` flag), or
   Control Point's answer unknown (`controlPoint` null because it couldn't be
   reached, or an older server without `workspaces`): Personal only, and no
   switcher.
2. Otherwise the URL wins: `/scout?space=<workspace id>` or
   `/scout?space=personal`.
3. Then the space remembered on this device: localStorage `cs-scout-space`,
   `{ id, name, account }`, which is never synced. A space remembered for another
   account that signed in on this device is ignored.
4. Then the account's first workspace, or Personal if it has none.

A workspace from steps 2 or 3 that the account no longer belongs to is
skipped, and a notice says so. The page then writes the space it shows back
to the URL (replacing the history entry) and to `cs-scout-space`. Choosing a
space in the switcher adds a history entry.

Losing access to the workspace on screen switches the page to Personal with
"You were removed from <workspace>". That happens when its live stream ends
with `membership_revoked`, when a poll is refused (403), or when the account's
workspace list changes and leaves it out.

Entries queued while offline go up when the connection returns in every
space, not just the one on screen. `ScoutQueueSync` (mounted once in
`main.tsx`) pushes each queue at sign-in, on `online`, and every 30 s while
any entries wait. It covers Personal and the account's workspaces, and only
while workspace scouting is on. Pushes to one space never overlap:
`syncScouting` waits for the previous push to that space.

### "My team" / "My teams" (the YOURS row)

The YOURS row in the sidebar, the phone's tab bar and its More menu is the
workspace entry point (`src/lib/yoursRow.ts`). It counts Control Point
workspaces, never FTC team numbers:

| Workspaces | Label | Tap |
| --- | --- | --- |
| none, signed out, paused, or Control Point's answer unknown | My team | `/my-team`, the followed-team dashboard (as before) |
| exactly one | My team | that workspace's scout space (`/scout?space=<id>`) |
| more than one | My teams | a picker: each workspace with its role and pending count; a popover on desktop, a bottom sheet on phones |

The followed-team dashboard stays at `/my-team`. For workspace users it is
linked from the picker ("My followed team"), from the team page of your
followed team, and from Settings › My team & tracking.

### Workspace templates

A workspace admin can change the fields their members fill in, per season,
for match and pit entries (Scout page › the workspace's space › **Template**,
admins only). They can add, edit, reorder and remove fields using the
built-in field types (`counter`, `toggle`, `choice`, `rating`, `text`) and
phases (match: auto, TeleOp, endgame, overall; pit: pit). Personal always uses
the built-in defaults. A workspace that hasn't customised a kind uses the
built-in default for it too.

Storage (migration 15, `server/scout/templates.ts`):

- **Current template:** `workspaces.settings` (JSON) holds it under
  `scoutTemplate.<season>`:
  `{ version, match: Field[] | null, pit: Field[] | null, updatedAt, updatedBy }`.
  `null` means the built-in default. Other keys of `settings` are left as they
  are: Task 6's `defaults` and `entryPolicy` sit beside it ([settings.md](settings.md)).
- **Versions:** every admin change bumps that season's `version` (1, 2, …) and
  the row's `settings_version`, which counts every change to the workspace's
  settings. Saving what's already there changes nothing.
- **History:** each version is also written to `workspace_template_versions`
  (`workspace_id, season, version, match, pit, created_at, created_by_*`).
  Rows are never changed or deleted.
- **Entries:** each entry records `templateId`
  (`ws:<workspace>:<season>:<kind>`, or a built-in id such as `match-2025`)
  and `templateVersion` (0 for built-in), in
  `workspace_scout_entries.template_id` / `template_version`. Old entries
  render, and are edited, with the fields of the version they were made with.
  The device fetches that version once and keeps it. Entries from before
  templates have neither field and read with the built-in default.

API (all members read; only admins write, roles from Control Point):

- `GET /api/scout/workspaces/:id/template?season=YYYY` returns the current
  template (version 0 with `match`/`pit` null when never customised). The
  response is `Cache-Control: private, no-cache` with an ETag of the season's
  version and the settings version, so an unchanged refetch is a 304.
  `&version=n` returns one version from the history; versions never change,
  and an unknown version is a 404. Reading never creates the mirror row.
- `PUT /api/scout/workspaces/:id/template` takes
  `{ season, match?, pit?, baseVersion? }`. It goes through
  `requireWorkspaceAdmin` and must be JSON (CSRF), and the first save creates
  the mirror row.
  - A kind left out is kept; `null` resets it to the built-in default.
  - Fields are validated one by one (`src/shared/scoutTemplate.ts`): numbers
    are clamped, unknown properties dropped, and bad fields dropped and listed
    in `dropped`. The rest is kept.
  - A non-empty list with no usable field at all is a 400.
  - A `baseVersion` other than the current version (another admin saved
    first) is a 409 that carries the current template.

Live: a save publishes `event: template` (`{season, version, settingsVersion}`,
no `id`, so the cursor doesn't move) on the workspace's stream. Open forms
and editors refetch. Without the stream, a member gets the new template the
next time the form opens. The current template is also kept on the device
(`cs-scout-tpl:<workspace>:<season>`), so the form works offline with the
last one seen.

### Exporting entries (CSV)

Any member can download a workspace's entries for a season as CSV (Scout
page › the workspace's space › **Export CSV**). Non-members get a 403,
signed-out users a 401, and a pause of workspace scouting a 503.
`server/scout/export.ts` builds the file; it is rate-limited per IP to 30 a
minute.

`GET /api/scout/workspaces/:id/export.csv?season=YYYY[&filters]`

- **Filters** (`src/shared/scoutExport.ts`) are applied by the server. The
  page passes the filters it shows (today `season` and `team`), never a list
  of entries. `season` is required. The other filters are optional: `team`,
  `event`, `kind` (`match` | `pit`), `author` (Control Point account id),
  `match` (label) and `q` (free text).
  - A list filter is comma-separated or repeated. An entry matches if it
    matches any value of that list and every filter given.
  - Event codes and match labels match in any case.
  - `q`: every word must appear in the team number, event, match, notes,
    author, last editor or a field's answer (decoded values; toggles read
    as `true` / `false`). Matching ignores case for any language
    (Unicode-aware), so it runs on each row as it's read, not in SQL.
  - A bad value is a 400.
  - Deleted entries are never exported.
- **Columns:** Entry ID, Team, Event, Match, Kind, Author, Updated at (ISO
  8601, UTC), Notes. Then one column per field of the workspace's **current**
  template for the season: match fields, then pit fields, or only one kind's
  with `kind=`. A kind the workspace hasn't customised uses the built-in
  default. The last column is **Other fields**.
  - Headers are the field labels. A label both kinds use becomes
    `Match: <label>` / `Pit: <label>`. A header that still repeats (two
    fields of one kind with one label, or a label equal to a fixed column)
    gets ` [<field id>]`.
  - Answers: toggles are `TRUE`/`FALSE`, and numbers and text are as entered.
- **Older template versions:** an entry's answers are placed by **field id**
  onto the current template's columns, whatever version it was made with, so
  a relabelled field keeps its column. An answer whose field the current
  template no longer has goes into **Other fields**, a JSON object keyed by
  field id (e.g. `{"arm":false}`), so nothing is lost silently. An entry
  shows answers only under its own kind's columns.
- **Format:** UTF-8 with a BOM (so Excel reads it as UTF-8), RFC 4180 (CRLF,
  quoted when a cell has a comma, quote or line break, quotes doubled).
  - Formula guard: a text cell starting with `=`, `+`, `-`, `@`, a tab or a
    CR gets a leading `'`. Numbers are left alone.
  - File name: `scout-<workspace slug>-<season>.csv`.
  - The response is `Cache-Control: no-store`.
- **Streaming:** this uses the same writer as the records CSV export. The
  header row goes out before any entry is read. Then one query fixes which
  entries go in, in which order (newest edit first). The rows are read 500
  at a time and each chunk is flushed before the next read, so a big
  workspace never sits in memory. Request metrics time the download to its
  first byte, so a long download doesn't show up as a slow route.

### Workspace activity feed

Every workspace's scout space has an **Activity** view (`/scout?view=activity`)
that every member can see. It lists who did what, newest first, grouped by
day. Server code: `server/scout/activityLog.ts`. Table: `workspace_activity`
(migration 16, private).

- **Logged now.** These are logged after the change commits, and only when
  something actually changed:
  - `entry.added`, `entry.edited`, `entry.deleted`, `entry.restored`. Nothing
    is logged for a refused write (a member deleting someone else's entry), an
    older version that lost to a newer one, a resend, an edit that changes
    nothing, or a tombstone for an entry nobody else ever saw.
  - `template.changed`, with the season, version and kinds. A save that
    changes nothing isn't logged.
  - `photo.added` and `photo.removed`. Expiry by the nightly job isn't logged.
  - `member.joined` and `member.left`. These come from the membership refresh
    when an account's set of workspaces changes, and are written in the same
    transaction as the cache write. The actor is "Control Point", because Scout
    doesn't know who added or removed someone there. They're logged only for
    workspaces that already have a scout space. A removal made in Scout's
    settings is `member.left` too, with the admin as actor and
    `details.origin: "control-scout"` (`details.self` when they left).
- **Later tasks.** They call
  `logActivity(workspaceId, actor, type, subject, details, opts?)` with their
  own `type` strings (`assignment.created`, `picklist.changed`,
  `comment.added`, ...). New kinds need no schema change. The app shows an
  unknown type generically.
- **Edit coalescing.** Suppose the same person edits the same entry again
  within 5 minutes of their last edit, and nothing else was logged about that
  entry in between. Then the earlier "edited" item is replaced by a new one at
  the top. The new item carries `edits` (how many edits it stands for),
  `firstId`, `firstAt`, and the union of the changed fields. A reader drops any
  item of the same type, subject and actor whose id is between `firstId` and
  the new one.
- **API.** `GET /api/scout/workspaces/:id/activity?before=<id>&limit=50`
  returns `{ items, more }`, newest first. It's for members only: 401 when
  signed out, 403 for non-members, 503 while workspace scouting is paused.
- **Live.** Every new item is sent on the workspace's stream as
  `event: activity`, with no `id`. The app fetches the newest page again on
  each reconnect, and every 30 s while it's polling.
- **Retention.** Items are kept for 90 days. The scheduler prunes older ones
  every 6 hours (not when `CS_NO_SCHEDULER` is set), and the API never lists
  them.

## Not in scope (yet)

- Signing out of Control Point doesn't end Scout sessions (Scout sessions last
  30 days). Revocation callbacks can come later.
- Deleting an account in one app doesn't delete it in the other.
- Being signed in on one site doesn't silently sign you in on the other. It's
  one click: "Continue with Control Point".
