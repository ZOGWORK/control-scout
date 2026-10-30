# Scouting alliances

Two workspaces link for one event. While linked they share a union of entries and assignments and one
consensus; when the event ends they split again.

- Server: `server/scout/alliances.ts` (table `scout_alliances`, migration 58), tests in `alliances.test.ts`.
- Shared types: `src/shared/alliances.ts`.
- Consensus over the union: `consensusForScope` in `server/scout/consensus.ts`.

## Linking: both sides consent

| Step | Who | What happens |
|---|---|---|
| Invite | an admin of workspace A | Picks an event of the season that has dates and isn't over, and says whether to keep copies at the end. Gets a one-time code (`XXXXX-XXXXX`, shown once; only its sha256 is stored). The code works for 7 days or until the event ends. |
| Accept | an admin of workspace B (not A) | Enters the code and says whether to keep copies. The link is active. |
| End | an admin of either side | A pending invite is cancelled. An active link ends now ("unlinked"). |

A workspace has at most one pending or active link per event. After a link ends it can link again.

## Permissions: "linked for event X"

Every route first checks membership of the workspace in the URL exactly as other workspace reads do
(`workspaceAccess`: 401 signed out, 403 not a member, 403 `feature_disabled` while scouting is off). Then:

| Route (`/api/scout/workspaces/:workspaceId/…`) | Who | Notes |
|---|---|---|
| `GET alliances` | any member | This workspace's links: live first, then the last ended ones. `canManage` for admins. |
| `POST alliances` `{season, eventCode, keepCopies}` | admin | 201 `{alliance, code}`; 404 unknown event; 400 no dates or over; 409 already linked at the event. |
| `POST alliances/accept` `{code, keepCopies}` | admin | 404 unknown, used or expired code; 400 the workspace's own invite; 409 already linked at the event. |
| `POST alliances/:id/end` | admin of either side | 404 not this workspace's link; 409 already ended. |
| `GET alliances/:id/shared` | any member of either side | Both sides' live entries and assignments at the event, each tagged `you` or `partner`, and coverage. |
| `GET alliances/:id/consensus?teams=` | any member of either side | One consensus over both sides' entries at the event. Both sides get the same answer. |
| `GET alliances/:id/picklist` | any member of either side | The partner's pick list, read-only. Only the teams at the event when the event has a team list. |

The shared reads need an active link that includes the workspace in the URL: 404 if it isn't part of the link,
410 `alliance_ended` once the link is pending or over, 403 `feature_disabled` while the partner has scouting
switched off. They only ever read the link's season and event.

Nothing here writes. Entries, assignments and pick lists stay in their own workspace and keep their usual rules:
authors keep edit rights over their entries, and a partner's admin gets no edit rights because they aren't a
member of the other workspace (`/api/me/scout/sync` and the pick list answer them 403 as before).

## When the link ends

The link ends once the event's last day is over everywhere (`allianceEndsAt`: a day and a half after that date
starts in UTC), or when an admin unlinks. Ending is settled lazily by every alliance route and hourly by the
sweep in `server/index.ts`.

- Each workspace keeps its own entries.
- If both sides agreed to keep copies when they linked, each workspace also gets a copy of the other side's live
  entries at the event: new entries in its own workspace (id `al<link>-<hash>`, so a retry never doubles them)
  with the original author, answers and notes, version 1 in their history, published to its live streams. They
  are that workspace's entries from then on. Photos stay with the original. An entry made with the other
  workspace's own template reads with the built-in fields, as consensus would read it.
- A copy that failed part way is retried by the next sweep.

## Coverage

Coverage shows each side's contribution: entries (match and pit), teams, matches and scouts, and per team how many
entries each side made. A side that contributes nothing shows zeros. It is shown, never enforced: both sides read
everything either way.
