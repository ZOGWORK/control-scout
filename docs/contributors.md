# Match video contributors

People who record FTC matches themselves can add the YouTube link to a match. Who sees it depends on who
added it. This page grows with the feature; each part names the code that holds it.

## Usernames and the actual name

Every account gets a **username** (`users.username`, migration 81, `src/shared/username.ts`):

- 3–20 letters, numbers or underscores, starting with a letter. Unique ignoring case
  (`users_username` index): "Partv08" and "partv08" are one username.
- Reserved, never taken: `controlscout`, `scout`, `official`, `admin`, `support`, `system`,
  `moderator`, `owner`, `gardenstatearchive`.
- Changes at most once in 30 days (`username_changed_at`). A change frees the old name at once. A
  change of letter case only keeps its date.
- A taken name gets two or three free suggestions in the same format: the team number first
  (`partv08_4215`), then small numbers (`partv08_2`). Offered, never assigned.
- It's a Scout-only handle. Control Point's shared account store has no username, and none is sent
  there.

The username is **never shown on a video**, a match, an event or a team page. The credit on a video
is the account's **actual name**, `users.display_name` (max 60 characters, Settings › Account):
"Video by Parthiv". The owner console shows username, actual name and email together, which is how
two people with the same first name are told apart.

Every change to either is written to the owner audit log with the account as the actor
(`account.username`, `account.name`; `server/auth/username.ts`). The owner console reads a
contributor's name history from there.

### Introducing usernames (existing accounts)

Accounts made before usernames have none, and often no name either. The rollout is an introduction,
not a lockout (`src/components/AccountSetup.tsx`):

- Once per sign-in, an account with no username sees "Introducing usernames". It asks for the actual
  name (pre-filled when there is one), then a username. "Browse first" closes it, and nothing is
  blocked.
- After that, Home (only Home) shows the same words as a banner until it is dismissed. Both come back
  at the next sign-in. "Once per sign-in" is keyed by a mark of the session (`/api/auth/me` `session`,
  `sessionMark()`), never the session id.
- A brand-new account (made in the last 15 minutes) sees "Finish signing up" instead, with the same
  two fields.
- The only hard gate is a contributing action: adding a video, claiming an invite, applying to be
  verified, liking or reporting. Each calls `useAccountSetup().ensure()`, which opens the prompt and
  refuses the action until both are set.

**There is no deadline.** No date exists after which an account without a username stops working, and
viewing never needs an account at all. The username is for contributors, not viewers. If most
accounts still have none later, that's a copy problem to fix, not a lockout to add.

### API

- `GET /api/me/username/check?u=<name>&team=<n>`: `{ ok: true }`, or `{ ok: false, reason, error,
  suggestions }` (`format`, `reserved`, `taken`, `tooSoon` with `retryAfter`).
- `PUT /api/me/username {username, team?}`: sets it (409 taken, 429 too soon, 400 format/reserved).
- `PATCH /api/me {displayName}`: the actual name (logged when it changes).
- `/api/auth/me` sends `username`, `usernameChangedAt`, `usernameNextChange` and `session`.
