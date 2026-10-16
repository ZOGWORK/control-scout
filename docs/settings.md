# Settings: three tiers

Control Scout keeps settings in three places. Each one has a single owner, and
the precedence rules below decide which one wins.

| Tier | What | Where it lives | Who writes | Synced |
| --- | --- | --- | --- | --- |
| 1. Personal | `PERSONAL_KEYS`: `myTeam`, `tracked`, `bookmarks`, `settings` (theme, density, ambient, notifications), `videoLinks`, `predictionHistory`, `shortlistNotes` | localStorage `cs-personal:<key>` as a `Stamped` value (`{value, updatedAt}`); the account's copy on the server | The person | Yes, per account, last write wins |
| 2. Workspace | The scout template, the defaults for new entries, the entry policy | The workspace mirror row's `settings` JSON (`workspaces.settings`) | Workspace admins (role from Control Point) | Shared by every member |
| 3. Device-only | The active scout space, the shortlist's list or grid view, the queue of entries waiting to sync | localStorage only | The device | Never |

## Tier 1: Personal

This tier is unchanged by Task 6 (`src/lib/personal.tsx`, `src/shared/personal.ts`):

- localStorage `cs-personal:*` is the device's cache.
- Every value is validated by `cleanValue`, on the client and on the server.
- The newest write wins.
- The first sign-in on a device merges that device's anonymous data into the account.

There is no migration: an existing `cs-personal:settings` blob is read as it
is, isn't rewritten on load, and syncs byte for byte
(`src/lib/settingsTiers.test.tsx`).

**Notification inbox switches** (Task 14, [inbox.md](inbox.md)) live in
`settings.notify`, beside the match alerts: `inboxAssignments`, `inboxEdits`,
`inboxTemplate` (template and workspace settings changes), `inboxMembership`,
`inboxPicklist`, `inboxComments` and `inboxOwnerAlerts` (owners only). They're
optional and a missing key means on, so an older `notify` value still syncs
byte for byte. `cleanValue` keeps only known `notify` keys with boolean values.
They're shown in Settings › Personal › Notifications. The server reads them from
the account's synced copy when it makes an inbox item, so a switched-off kind
makes no item at all.

## Tier 2: Workspace

Stored on the workspace's mirror row, as sibling keys in one JSON object:

```jsonc
{
  "scoutTemplate": { "2025": { "version": 3, "match": [...], "pit": null, "updatedAt": "…", "updatedBy": "Coach" } },
  "defaults":      { "season": 2025, "eventCode": "USNYQ1", "updatedAt": "…", "updatedBy": "Coach" },
  "entryPolicy":   { "create": "members", "edit": "members", "delete": "author-or-admin" }
}
```

- **`scoutTemplate`** is the Task 5 template (`server/scout/templates.ts`, and
  "Workspace templates" in [shared-accounts.md](shared-accounts.md)). It has
  its own route.
- **`defaults`** sets where a new entry starts in the workspace's scout space.
  `season` (2000 to 2100, or null) is the season the Scout page opens on in
  that space when the URL has no `?season=`. `eventCode` (FIRST's shape,
  upper-cased, or null) fills in the Event field of a new entry in that
  season, or in any season when `season` is null. A member can still pick any
  season or event. Personal never uses them.
- **`entryPolicy`** is fixed for now (`ENTRY_POLICY`): members create entries
  and edit anyone's live entry; an entry's author or an admin deletes it.
  It's written explicitly on every settings save, so a later change can read
  it without a migration. The server still enforces Task 3's rules in
  `server/scout/entries.ts` (`mayWrite`), and what's stored can't widen
  them. A `PUT` that sends a different policy has it dropped and reported.

**Versioning.** `workspaces.settings_version` goes up by one on every admin
change, whether to a template or to the settings. Each write is guarded by the
version it read (`UPDATE … WHERE settings_version = ?`), and template and
settings saves for a workspace share one queue (`settingsLock`), so they never
overwrite each other. Saving what's already there changes nothing.

**Validation** works field by field, in the `cleanValue` spirit
(`cleanSettingsPatch` in `src/shared/workspaceSettings.ts`):

- A usable field is taken.
- A bad field is dropped and listed in `dropped`, and the rest are kept.
- Unknown fields are dropped.
- Personal settings (`theme`, `density`, `ambient`, `notify`) are always dropped.

### API

`GET /api/scout/workspaces/:id/settings` is open to any member. It returns
`{settings: {workspaceId, settingsVersion, defaults, entryPolicy, updatedAt, updatedBy}}`.

- If no settings were ever saved, it returns version 0, no defaults and the
  fixed policy. Reading never creates the mirror row.
- The response is `Cache-Control: private, no-cache`, with an ETag of the
  settings version, so an unchanged refetch is a 304.

`PUT /api/scout/workspaces/:id/settings` takes `{defaults?: {season?, eventCode?}, baseVersion}`.

- It is for admins only (`requireWorkspaceAdmin`). A member gets 403 and
  someone signed out gets 401.
- The body must be JSON (CSRF), otherwise the answer is 415.
- `baseVersion` is required (400 without it). It is the `settingsVersion`
  the admin edited. If anything was saved since, including a template, the
  answer is a 409 that carries the current settings.
- A field left out of `defaults` is kept, and `null` clears it.
- The answer is `{changed, settings, dropped}`.
- The first save creates the mirror row.

Both routes answer 503 while workspace scouting is switched off in the owner
portal.

**Live.** A change publishes `event: settings` (`{settingsVersion}`, with no
`id`) on the workspace's stream (`server/scout/stream.ts`).

- The device keeps the last copy it saw in `cs-scout-wss:<workspace>`
  (`src/lib/workspaceSettings.ts`), so forms open with the defaults offline too.
- It refetches when the notice is newer than that copy. It does the same when
  a template notice carries a newer `settingsVersion`.
- It also refetches whenever a new-entry form opens, which costs a 304 when
  nothing changed.
- Without the stream, the next open or load brings the change.

**Activity.** Each change (not a no-op) is logged in the workspace's activity feed as
`settings.changed` (subject `settings`; details `{settingsVersion, changed, defaults}`), so members
see who changed the defaults and to what.

## Tier 3: Device-only

These keys never leave the device (`DEVICE_ONLY_KEYS`):

| Key | What |
| --- | --- |
| `cs-scout-space` | The scout space last shown here (`src/lib/scoutSpace.ts`) |
| `cs-shortlist-view` | The shortlist's list or grid view (`src/lib/shortlist.ts`) |
| `cs-scout-dirty`, `cs-scout-ws-dirty:<workspace>` | Entries waiting to sync |
| `cs-account-cache` | The signed-in account as `/api/auth/me` last answered (`src/lib/personal.tsx`). When the app opens offline it stands in for the account, so the scout space (and where new entries go) is the workspace it was. Removed on sign-out or when `/me` says signed out; used only for the device's own account |
| `cs-scout-lost:<workspace>` | Edits this device lost to a newer one from someone else, kept so they can be compared and restored (`src/lib/lostEdits.ts`; at most 30 per workspace, 30 days). A restore sends the entry, as any edit; the list itself never leaves the device |
| `cs-tour` | The first-run tour was finished or skipped on this device (`src/lib/tour.ts`): `{v, outcome: "done" \| "skipped", at, step}`. It never shows again here. See "First-run tour" below |
| `cs-tour-demo` | `"1"` lets a browser driven by automation see the tour (`npm run shots -- --tour`); real visitors never have it |
| `cs-install` | The add-to-home-screen nudge on this device (`src/lib/installNudge.ts`): `{v, lastShown: "YYYY-MM-DD", dismissed?, installed?}`. See "Add-to-home-screen nudge" below |
| `cs-install-demo` | `"1"` lets a browser driven by automation see the nudge (`npm run shots -- --install`); real visitors never have it |

The queue's entries go up as entries (that is the queue's job). The queue key
itself, the space and the view are never sent: not in a personal sync
(`PUT /api/me/state/:key`), not in the first sign-in merge
(`POST /api/me/migrate`), and not in a scout push. The test is in
`src/lib/settingsTiers.test.tsx`.

### Audit: everything Control Scout stores on the device

| Key | Tier | Leaves the device? |
| --- | --- | --- |
| `cs-personal:<key>` | 1 (cache) | Yes: the personal sync |
| `cs-personal-pending-v2`, `cs-personal-owner`, `cs-stash:<account>` | sync bookkeeping | No |
| `cs-scout:<uuid>`, `cs-scout-ws:<workspace>:<uuid>` | entries | Yes: as entries |
| `cs-scout-dirty`, `cs-scout-ws-dirty:<workspace>` | 3 | No (their entries do) |
| `cs-scout-lost:<workspace>` | 3 | No (a restore sends the entry) |
| `cs-scout-ws-cursor:<workspace>` | sync bookkeeping | Only as the pull's `since=` cursor |
| `cs-scout-tpl:<ws>:<season>`, `cs-scout-tplv:<ws>:<season>:<v>`, `cs-scout-wss:<ws>` | 2 (cache) | No |
| `cs-scout-space`, `cs-shortlist-view`, `cs-account-cache`, `cs-tour`, `cs-tour-demo`, `cs-install`, `cs-install-demo` | 3 | No |
| `cs-sidebar`, `cs-records-cols:<table>`, `cs-saved-filters:v1` | local UI state | No |
| `cs-consent`, `cs-alerts-sent`, `cs-offline-seasons`, `cs-pack-meta`, `cs-seen` | device state | No |
| sessionStorage `cs-session`, `cs-stats-session`, `cs-landed` | this tab only | `cs-stats-session` only as the analytics "new session" bit (no ID) |

### First-run tour: device-only on purpose

Whether the tour was finished or skipped is kept per device, not in Tier 1.
Syncing it would only matter for someone signed in on a second device who
hasn't seen the tour there, and that person has already used the app: they
have a team of their own, tracked teams or events, a shortlist, or a Control
Point workspace, which do sync. The tour never shows to anyone with any of
those (`knowsTheApp` in `src/lib/tour.ts`), so a synced flag would add a
personal key, its server validation and a merge rule for no visible change.
The worst case is a signed-in person with none of those seeing the four-step
tour once more on a new device.

### Add-to-home-screen nudge

A small card (`src/components/layout/InstallNudge.tsx`) offering to put the
app on the home screen: "One tap from the stands", and straight to your team
when you have one set. It sells speed, never offline use. The rules:

- **When the browser offers an install.** Chrome, Edge and Samsung Internet
  fire `beforeinstallprompt`; it's caught from page start (`preventDefault`,
  so the browser's own mini-infobar stays away) and "Add to home screen"
  calls its `prompt()`. Firefox and desktop Safari never offer one: nothing
  shows there.
- **iOS Safari** has no install offer, so it gets a hint instead: "Tap Share,
  then Add to Home Screen", under the same rules. Safari can't tell a page it
  was added, so "Got it" ends the hint for good, like "No thanks". Other iOS
  browsers (Chrome, Firefox, in-app browsers) get nothing: their menus differ.
- **First app open, then at most once per calendar day** (local time). Showing
  it writes the day (`lastShown`), so reloads, other tabs and ignoring it
  never bring it back the same day; the next day it may show again.
- **Ignoring isn't a dismissal.** Leaving the page it's on (or closing the
  tab) hides it, and it can come back the next day.
- **Dismissed is forever:** "No thanks", the ×, Esc in the card, or "Cancel"
  in the browser's own install dialog (`dismissed`).
- **Never once installed:** running from the home screen (`display-mode`
  standalone, fullscreen, minimal-ui or window-controls-overlay, or iOS's
  `navigator.standalone`), the `appinstalled` event or an accepted install
  dialog (`installed`), or `navigator.getInstalledRelatedApps()` finding it
  (the manifest's `related_applications` names the app on controlscout.org).
- **The tour goes first.** It shares the first-run slot (`src/lib/firstRun.ts`).
  On a page where the tour may still open (not finished or skipped here, not
  an automated browser, not someone who knows the app, a tour page) the nudge
  stays away; on the page where the tour (or any other first-run surface)
  held the slot it waits for the next page or visit. So on a first visit the
  tour comes first and the nudge follows on a later page. "First app open"
  is therefore the first page view where the browser offers an install and
  the tour isn't due.
- **Never in front of anything:** after the privacy choice, once the page is
  idle (then 2.5 s), and not while typing or while a dialog or menu is open.
  On phones it sits above the tab bar, and above the sticky action bar on
  pages that have one; from md up, bottom left. The error-report prompt is at
  the top and the bell is in the top bar, so they never meet.
- **Never to bots** or browsers driven by automation (the tour's
  `isAutomated`). `npm run shots -- --install` opts a shot in: it sets
  `cs-install-demo` and hands the page a stand-in install offer, since an
  automated Chromium never makes a real one.

Device-only, like the tour: an install is per device, and a "No thanks" on a
laptop says nothing about a phone.

## Precedence

There is no ambiguity about which tier wins:

1. **Inside a workspace's scout space, Tier 2 governs shared behaviour:** the
   template that new entries use and the defaults they start from.
2. **Tier 1 governs the individual's view everywhere:** theme, density, the
   animated background and notifications stay personal, inside a workspace too.
3. **Tier 3 is local UI state** and is never shared.

This is enforced in code as well as stated here:

- `cleanSettingsPatch` drops `theme`, `density`, `ambient` and `notify` from
  any workspace write, so they're never stored.
- `scoutSpaceSettings()` always returns the personal view, whatever a
  workspace object carries.
- The theme and density are applied from `usePersonal().state.settings`
  only.

The tests are in `src/lib/settingsTiers.test.tsx` and `server/scout/settings.test.ts`.

## Settings page

Settings has a **Personal** group (Profile through Account & privacy) and a
**Workspace** group.

- The Workspace section is shown only to members of a Control Point
  workspace, and only while workspace scouting is on. A member of several
  workspaces gets a selector, which starts on the scout space last used.
- **Membership:** your role, and members and roles, which are "Only workspace
  admins can change this — managed in Control Point". Task 9's Members list
  goes in this group (`Membership` in
  `src/components/settings/WorkspaceSection.tsx`).
- **Defaults for new entries:** the default season and event. They're
  editable by admins; members see them disabled, with "Only workspace admins
  can change these."
- **Scout template:** a summary of the current season's version. Admins get
  a link to the editor in the scout space
  (`/scout?space=<id>&season=<s>&view=template`), which is also one tap away
  from the Scout page.
- **Entry policy:** a read-only summary.
