# Shared pick list

Each workspace has one shared pick list per season: FTC team numbers in pick order that
every member sees and edits. It is separate from each member's personal Shortlist, which
stays private and unchanged. The list opens from the workspace's scout space with the
**Pick list** button (`/scout?space=<workspace>&view=picklist`).

- Server: `server/scout/picklist.ts`. Shared rules: `src/shared/picklist.ts`. Device:
  `src/lib/sharedPicklist.ts`. View: `src/components/scout/SharedPicklist.tsx`.
- The rows are the Shortlist's own (`src/components/shortlist/PickRows.tsx`, `useReorder`,
  `TeamDetail`, `NoteField`). Inline OPR, world rank and record come from the same
  `/api/shortlist?teams=&season=` request the Shortlist uses.

## API

All routes need a signed-in account linked to Control Point that is a member of the
workspace. Otherwise the answer is 401 when signed out, 403 for a non-member, and 503 while
workspace scouting is paused in the owner portal. Writes must be JSON (CSRF).

| Request | Body | Answer |
| --- | --- | --- |
| `GET /api/scout/workspaces/:id/picklist?season=` | | `{ list: { workspaceId, season, version, picks } }` |
| `POST /api/scout/workspaces/:id/picklist` | `{ season, op: "add", team, beforeTeam?, restore? }` (`restore`: Undo of a remove) | `{ changed, list }` |
| | `{ season, op: "remove", team }` | |
| | `{ season, op: "move", team, beforeTeam }` (`null`: to the end), or `{ season, op: "move", team, afterTeam }` | |
| | `{ season, op: "note", team, note }` (`""` clears it) | |
| | `{ season, op: "import", teams }` (copy from my shortlist) | |

A pick is `{ team, rank, addedBy, addedAt, note, noteBy, noteUpdatedAt }`. The server sets
`addedBy` and `noteBy` (`{ accountId, name }`) and the times (ms). It never takes them from
the client. An unknown team is a 400. A list holds at most 100 teams; a full list is a 409.

## Ordering when several members edit at once

The server applies operations one at a time per workspace, in the order they arrive. After
each one it numbers the list 1..n and bumps its version.

Operations name teams, never positions. A team dragged up goes "just before the team it now
sits above" (`beforeTeam`, or `null` for the end). A team dragged down goes "just after the
team it now sits below" (`afterTeam`). Either way it is anchored to the last team it passed.
The move is worked out from the list as it was when the drag started, so a change that
arrives mid-drag doesn't redirect it. So when two members reorder at the same moment, both moves apply in arrival
order and neither is bounced. Every device that applies the same operations in the same
order gets the same list, so the merge is deterministic.

The version check is on what an operation names. If its team, or the team it goes before,
was removed meanwhile, the operation means nothing any more. The server answers 409 with
the current list, and the device says so and fetches the list again. Adding a team that is
already on the list, or removing one that is gone, changes nothing and is not an error.

On the device, a change shows at once. The view applies it on top of the server's list with
the same function the server uses, then sends it. Changes go up one at a time, in order. A
newer list from the server (by version), whether in an answer or from the stream, replaces
the one shown.

## Notes

Each pick has one note shared with the whole workspace. Last write wins, in arrival order.
The row shows who added the team and who last wrote the note, and when. A note field that
is focused but untouched follows a teammate's change, and leaving it writes nothing, so it
never puts back the text it showed before.

Removing a team keeps its row (`removed_at`). **Undo** sends `add` with `restore: true`,
which brings the pick back as it was: who added it, its note and who wrote that. Adding the
team again any other way starts it afresh.

## Live updates, activity and the inbox

- After every change the server publishes the whole list on the workspace's stream as
  `event: picklist` (no `id:`, like `activity`). Open pick list views replace their list
  when the version is newer. They also refetch when the stream reconnects, and every 30 s
  while the app is polling instead.
- The activity feed logs `picklist.added`, `picklist.removed`, `picklist.moved` and
  `picklist.noted` (subject `picklist:<season>`, details `{ season, team, ... }`). Moves, and
  note edits, by the same member within 5 minutes coalesce into one item that lists the
  teams touched (`details.teams`, `details.edits`), the same way entry edits do.
- Every `picklist.*` item reaches the other members' inboxes, at most one unread line per
  workspace. Tapping it opens the pick list in its season.

## Storage

Migration 19 adds `workspace_picklist` (one row per team: rank, who added it and when, the
note and who last wrote it and when, and `removed_at` while it's off the list) and `workspace_picklist_versions` (the version per
workspace and season). Both are private tables and never ship in the public snapshot.
