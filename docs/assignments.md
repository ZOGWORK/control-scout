# Scouting assignments

At an event, a workspace admin decides who scouts which team. Every member sees the
list, so two people don't end up scouting the same team without knowing it.

- Server: `server/scout/assignments.ts` (table `workspace_assignments`, migration 18)
- App: `src/lib/assignments.ts`, `src/components/scout/Assignments.tsx`; the Scout page's
  **Assignments** view (`/scout?space=<workspace>&view=assignments`)
- Shared types: `src/shared/assignments.ts`

## Who can do what

Roles come from Control Point. Scout has no roles of its own, and the server enforces
every rule below.

| Action | Who |
| --- | --- |
| See the workspace's assignments (and the badges) | every member |
| Create (one or many) | admins |
| Mark done | the assignee, or an admin |
| Reopen a done one | admins only |
| Delete | admins only |

Every route returns 401 when signed out and 503 while workspace scouting is paused (the
owner portal's `workspaceScouting` switch). It returns 400 for a bad id and 403 for
someone who isn't a member, or isn't an admin on an admin-only route.

## Creating

`POST /api/scout/workspaces/:id/assignments` with
`{ season, eventCode, teams: number[], assigneeAccountIds: number[] }` creates one
assignment for every team × assignee pair, up to 200 at once. So "teams 1234 and 5678
to Priya" and "team 1234 to Priya and Sam" are both one request.

- **Teams** come from the event's team list in the synced event data (`event_teams`).
  An event without a team list yet can't be assigned.
- **Assignees** come from Scout's membership cache (`workspace_members`), so only
  members who have signed in to Scout appear. The Assign sheet says this.
- **Duplicates warn, they don't block.** A team that ends up with more than one scout
  at the event comes back in `duplicates` (`[{ team, assignees: [{ accountId, name }] }]`),
  and the sheet shows the warning before you submit too. Assigning the same member the
  same team at the same event again creates nothing; that pair comes back in `existing`.
- The answer is `201 { created, existing, duplicates }`.

## Reading, done, reopen, delete

- `GET …/assignments?season=&event=&assignee=me|<accountId>` returns `{ assignments }`.
  Each assignment carries `progress`: the assignee's entries for that team at that
  event (same season, not deleted). On the device, progress is whichever is higher: the
  server's count, or the entries this device holds, including the scout's own unsynced
  ones. That way the count moves the moment they save.
- `GET …/assignments/options?season=&event=` (admins) returns `{ members, teams }` for
  the Assign sheet.
- `PATCH …/assignments/:id` with `{ status: "done" | "open" }` returns
  `{ assignment, changed }`. Setting the status it already has changes nothing.
- `DELETE …/assignments/:id` (admins) returns `{ deleted: id }`.

## Live, feed, inbox

- Every change goes out on the workspace's stream as `event: assignment`, with no id,
  like `activity`. Its data is `{ action: "created" | "updated" | "deleted", assignments }`.
  The list, the badges and the cards apply it at once. When the stream reconnects, or
  every 30 s while polling, the app fetches the list again.
- The activity feed logs `assignment.created` (one line per assignee per request, naming
  all their teams), `assignment.completed`, `assignment.reopened` and
  `assignment.deleted`. The subject is `assignment:<id>`.
- The inbox notifies the assignee about each of these unless they did it themselves.
  So an admin who marks your assignment done or reopens it notifies you, but marking
  your own done doesn't.

## Badges

An entry card shows **Assigned to <name>** (or "you") when its team is assigned at the
entry's event in that season. The Assign sheet's team rows show the same badge. The
Assignments button counts your open assignments.
