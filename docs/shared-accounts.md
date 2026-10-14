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
  controlPoint: { member: boolean, teams: { teamNumber: number | null, name: string }[] }
}
```

`controlPoint.member` and `teams` come from the active `members` rows with this
email. That is read-only: it lets Scout say "you're also on team X in
Control Point".

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

## Not in scope (yet)

- Signing out of Control Point doesn't end Scout sessions (Scout sessions last
  30 days). Revocation callbacks can come later.
- Deleting an account in one app doesn't delete it in the other.
- Being signed in on one site doesn't silently sign you in on the other. It's
  one click: "Continue with Control Point".
