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
  - A missing or older row makes Scout ask Control Point once, then look again.
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

- The server stamps authorship: `author_*` is set by the first write, and
  `editor_*` by every accepted write. Author fields sent by the client are
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
| `POST /api/me/scout/sync` | `{ workspaceId?: string \| null, entries }`, at most 200 | `{ results: [{ uuid, ok, error?, entry? }] }`. Without a `workspaceId` (or with `null`) the entries go to the personal set, exactly as before. With one, they go to that workspace (`403` for non-members), and `entry` is the stored copy for the device to adopt. An entry whose own `workspaceId` names a different space is refused (`"wrong space"`). |
| `GET /api/scout/sync?workspaceId=…&since=…` | `since`: a `cursor` from the last pull, `0` the first time | `{ entries, cursor, more }`: the entries written after `since` in write order, tombstones included, 500 at most. If `more` is true, pull again from `cursor`. |

## Not in scope (yet)

- Signing out of Control Point doesn't end Scout sessions (Scout sessions last
  30 days). Revocation callbacks can come later.
- Deleting an account in one app doesn't delete it in the other.
- Being signed in on one site doesn't silently sign you in on the other. It's
  one click: "Continue with Control Point".
