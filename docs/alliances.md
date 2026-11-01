# Scouting alliances

Any number of teams' workspaces link for one meet. While linked they share a union of entries and assignments and
one consensus; when the event ends they split again. It's a Scout-only link for that event: nobody joins another
team's workspace and nothing changes in Control Point.

- Server: `server/scout/alliances.ts` (tables `scout_alliances` and `scout_alliance_members`, migrations 61 and 68),
  tests in `alliances.test.ts`.
- Shared types: `src/shared/alliances.ts`.
- Consensus over the union: `consensusForScope` in `server/scout/consensus.ts`.

## Joining: every team consents

| Step | Who | What happens |
|---|---|---|
| Start | an admin of workspace A | Picks an event of the season that has dates and isn't over, and says whether to keep copies at the end. A is the alliance's creator. Gets an invite code (`XXXXX-XXXXX`, shown once; only its sha256 is stored) and a link (`/scout?view=alliance&join=CODE`) that fills the code in. The code works for 7 days or until the event ends. |
| Join | an admin of any other workspace | Enters the code (or opens the link) and says whether to keep copies. It's in, and the alliance is active. The same code works for every team until it expires or is replaced. At most 8 workspaces (`MAX_ALLIANCE_MEMBERS`). |
| New code | the creator's admin | A fresh code; the old one stops working. |
| Leave | an admin of any member | It's out. The rest carry on while at least two are left; otherwise the alliance ends ("unlinked"). If the creator leaves, the workspace that joined next becomes the creator (and makes its own code). |
| Remove | the creator's admin | Another member is out, as if it had left, but it keeps no copies of the others' entries and can't join again with a code of this alliance. |
| End | the creator's admin | A pending alliance (nobody joined yet) is cancelled. An active one ends now for everyone ("unlinked"). |

A workspace is in at most one pending or active alliance per event. After it ends (or the workspace leaves) it can
link again.

## Permissions: "linked for event X"

Every route first checks membership of the workspace in the URL exactly as other workspace reads do
(`workspaceAccess`: 401 signed out, 403 not a member, 403 `feature_disabled` while scouting is off). Then:

| Route (`/api/scout/workspaces/:workspaceId/…`) | Who | Notes |
|---|---|---|
| `GET alliances` | any member | Every alliance this workspace is or was in: live first, then the last ended or left ones. Each lists its members now. `canManage` for admins. |
| `POST alliances` `{season, eventCode, keepCopies}` | admin | 201 `{alliance, code}`; 404 unknown event; 400 no dates or over; 409 already in one at the event. |
| `POST alliances/accept` `{code, keepCopies}` | admin | 404 unknown, replaced or expired code; 400 already in this alliance; 403 removed from it; 409 in another at the event, or full. |
| `POST alliances/:id/invite` | the creator's admin | 200 `{alliance, code}`; 403 not the creator; 409 full or ended. |
| `POST alliances/:id/leave` | admin of any member | 409 already out or ended. |
| `POST alliances/:id/members/:memberId/remove` | the creator's admin | 400 itself; 404 not in it; 403 not the creator. |
| `POST alliances/:id/end` | the creator's admin | 404 never in it; 403 not the creator; 409 already ended. |
| `GET alliances/:id/shared` | any member of a member workspace | Every member's live entries (each with its answers labelled by its own workspace's template, and its `workspaceId`) and assignments at the event, and coverage: one card per member. Each observation once: a copy kept from an earlier link of an entry from another member is skipped. |
| `GET alliances/:id/consensus?teams=` | any member of a member workspace | One consensus over every member's entries at the event, each observation once. Every member gets the same answer. |
| `GET alliances/:id/picklist?workspace=` | any member of a member workspace | Another member's pick list, read-only: only teams on the event's team list. With no team list yet, no picks (`teamsKnown: false`). |

The shared reads need the workspace in the URL to be in an active alliance: 404 if it was never in it, 410
`alliance_ended` once it's pending, over, or the workspace left or was removed. A member whose scouting or
alliances the owner switched off is left out of every read; with no other member left to read, 403
`feature_disabled`. They only ever read the alliance's season and event.

Nothing here writes. Entries, assignments and pick lists stay in their own workspace and keep their usual rules:
authors keep edit rights over their entries, and another member's admin gets no edit rights because they aren't a
member of that workspace (`/api/me/scout/sync` and the pick list answer them 403 as before).

## When it ends

The alliance ends once the event's last day is over everywhere (`allianceEndsAt`: a day and a half after that date
starts in UTC), when the creator ends it, or when fewer than two members are left. For one workspace it also ends
when it leaves or is removed. Ending is settled lazily by every alliance route and hourly by the sweep in
`server/index.ts`.

- Each workspace keeps its own entries.
- Copies go between every two workspaces that both agreed to keep copies when they joined: each gets a copy of the
  other's live entries at the event as they were at that moment. When the alliance ends that is every two members
  still in it; when a member leaves, it and each member still in. A removed member gets none (the others still
  keep its entries). They are saved in the same write that ends it (`scout_alliance_copy_queue`, with `from_ws`),
  so nothing scouted after the end is ever copied. Each copy is a new entry in the receiving workspace with the
  original author, answers and notes, version 1 in its history, published to its live streams. It is that
  workspace's entry from then on. Photos stay with the original. An entry made with the other workspace's own
  template reads with the built-in fields, as consensus would read it.
- Every copy records the entry it first came from (`scout_alliance_copies`). Its id derives from that origin
  (`cp-<hash>`), so a workspace holds at most one copy of any entry. An entry that came from the receiving
  workspace in the first place is never sent back. If the same workspaces link again, the shared reads and
  consensus count each original once and skip the copy beside it. Two workspaces holding copies of the same
  third workspace's entry count it once too. A copy whose original was deleted since is read.
- A copy that failed part way is retried by the next sweep, from the saved queue only. Copies also wait while the
  owner has paused workspace scouting or alliances for the sending or receiving workspace.

## Coverage

Coverage shows each member's contribution, one card each in its own colour (this workspace always in the accent):
entries (match and pit), teams, matches and scouts, and per team how many entries each member made. A member that
contributes nothing shows zeros. It is shown, never enforced: every member reads everything either way.

## Carrying over (migration 68)

Two-team links from before became alliances with two members: the inviter (its creator, joined when it invited) and,
once accepted, the invitee (joined when it accepted). The `invitee_*` columns are no longer read. An ended link where
both sides kept copies has `copies_wanted = 1`.

## The owner's switch

`scoutingAlliances` in `src/shared/flags.ts`: a feature toggle in Owner console › Features, with per-workspace
overrides. Off for a workspace means:
- Every alliance route of that workspace answers 403 `feature_disabled`.
- Nobody can join an alliance through its code.
- Nothing is read across to or from it.
- Copies to or from it wait until it's back on.
- The Scout page hides the Scouting alliance row and the pick list's other-team toggle.

Alliances are kept, and still end with their event.
