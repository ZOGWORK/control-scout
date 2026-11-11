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

## Who sees a video: three tiers

A link's tier is worked out when it is read (`tierOf`, `server/videos/contributors.ts`), never stored:

| Tier | Who sees it | When |
|---|---|---|
| **Public** | everyone, signed in or not | the contributor is verified now |
| **Team only** | people on the link's team | the contributor isn't verified (or the owner made it team only) |
| **Only you** | the person who added it | owner's choice, or a revoked contributor who isn't on the link's team |

"On a team" means a **Control Point workspace** for that team (`controlPointInfo`) or a row on the
owner's **roster** (`team_members`), cached for 60 s (`server/videos/membership.ts`). The self-set
"My team" on Scout never counts: anyone can type any number there.

A team-only link only hides the video on Control Scout. It stays an ordinary YouTube link, and anyone
who has the link itself can still watch it there. The add form says so.

## Which video a match plays

One function, `pickMatchVideo` (`src/shared/contributors.ts`), used by the match page, the event
page's rows and clips gallery, and search, so they never disagree. First that exists:

1. a contributor link the owner set to play before FIRST's video (`over_first`);
2. FIRST's own match video (`matches.video`);
3. the contributor link this viewer may see (public before team; the owner's "Pick for this match"
   wins among several);
4. the match's place in the event's livestream recording.

A link that is only the viewer's own sits after the recording. A device's own saved links stay in the
match's Video section as before.

Contributor videos are personal answers: `/api/videos/*` is `no-store`, and the search answer adds
them per viewer (`answerVideo(full, now, viewer)`) and is sent `private, no-store` when it carries
one. A shared cache never holds one person's team videos.

## Adding a link

From a played match's page (`MatchContributorPanel`). Verified: "Add a Link — public, for everyone".
On a team, not verified: "Share with your team". Each shows "Will show as: Video by <name>" first.
Checks (`server/videos/linkChecks.ts`, `addVideo`):

- YouTube only; a private or deleted video is refused. If YouTube doesn't answer, the link is saved
  and the contributor is told it couldn't be checked.
- Longer than 10 minutes: asks for the match's start time (or "Publish anyway"). Each link is one
  match; nothing is split.
- The same video already on another match of the event: asks before using it twice.
- 20 links a day per account, 5 a day on one match (counted inside the insert).

The person who added it can edit or remove it from its three-dot menu. Removing takes its likes too.

## Likes and reports

A heart with a count is the only social action. No comments, no dislikes. Liking needs an account
with a username. Anyone signed in can **Report** from the three-dot menu: wrong match, wrong event,
not a match video, poor quality, noisy audio, other (20 reports a day per account, one open report
per person per link). Nothing happens to a link on reports alone, at any count: only the owner removes
or hides one.

## Getting verified

Two ways in, one queue:

- **Invite link** (`/verify-video?token=…`): made by the owner for an account's email. Single use,
  14 days, and only its SHA-256 hash is stored, so the link is shown once. The first account to claim
  it wins (a different email than intended is flagged for the owner). One tap sends the request, and
  any application waiting is withdrawn.
- **Get Verified** (`/get-verified`): team number and name, role, events, YouTube channel, one sample
  match video, who recorded the videos, why (20+ characters), anything else, and all five agreements
  ticked by hand. Each field's own error comes back. Three applications in 30 days at most.

While it waits: "Review Pending — check back within 1 or 2 business days", with nothing to edit (an
application can be withdrawn). Approval makes the person's team links public (the count is in the
audit log) and sends an inbox notice. Rejection may share a reason and starts a 7-day wait before
applying again. Revoking drops their links to their team, or to only them when they aren't on the
link's team; nothing is deleted, and verifying again restores them.

## Owner console › Video contributors

`/owner?panel=contributors` (`src/components/owner/ContributorsPanel.tsx`,
`server/videos/ownerRoutes.ts`). Its sidebar entry counts requests and reported links.

- **Requests**: invite claims and applications together, oldest first, each labelled, with the
  sample video, the channel check's honest result ("Couldn't check" when YouTube didn't answer) and
  the account's earlier applications. Approve, or Reject with a reason to share and a private note.
- **Add a contributor**: approve an existing account directly, or make an invite link.
- **Reports**: grouped by link, most-reported first, then oldest; 5+ flagged. Each reporter's
  dismissed reports show, so a false-report pattern is visible.
- **Contributors**: verified, revoked and rejected people, with every actual name they've used.
- **Links**: hide / show again, make team only, only them, publish, pick for this match, play before
  FIRST's video, check on YouTube, remove.
- **Invites** and the **Team roster**.

Every action is in the audit log. The owner alerts `video-verification` and `video-reports` open
while a queue has something in it and close when it's empty.

## Notices

Inbox category **Your match videos** (`videoContributions`, toggle in Settings): approval, rejection,
revocation, and a link the owner removed or hid.

## The event page

A coverage line ("Every match has video", "Partially recorded — 12 of 48 matches have video", or
"No recording for this event — stats only."), counted for this viewer. "Watch Clips" shows only when
there's at least one clip (first among the header buttons once the event is over), and scrolls to the
clips gallery: every played match with a video, filtered All / Qualifications / Playoffs.

## Profiles

`/contributors/<username>`: the actual name, the badge when verified now, teams, and the videos this
viewer may see. The likes total counts only those. An unknown username is the page not found.
Profiles are never indexed. The username appears only in this address: the API sends the `profile`
link, not the username.
