# Changelog

What changed in Control Scout, newest first. The prediction engine has its own
changelog in `packages/predict-engine/CHANGELOG.md`.

## 1.5.0 — 2026-10-16

Scouting becomes a shared team workspace, plus a production-readiness and speed pass.

### Team workspaces (with Control Point)

- **Workspaces from Control Point.** Sign in with "Continue with Control Point" and your Control Point workspaces show up in Scout. Control Point decides who belongs and who is an admin; Scout follows it. (Control Point #252, #103)
- **Spaces on the Scout page.** Switch between **Personal** and each workspace. Workspace members open their first workspace by default. Personal entries are never moved or merged. (#110)
- **Live, like messaging.** Entries a teammate adds, edits or deletes appear on everyone's screen in about a second, without a refresh. Each entry shows who wrote it and when ("Priya · 2m ago"). If the live connection drops, the page checks every 15 seconds instead, and a refresh button next to the space switcher forces an update. (#107, #122)
- **Permissions.** Members add entries and edit any entry; they delete only their own. Admins can delete any entry. The server enforces this. (#108)
- **"My team" / "My teams".** The YOURS row opens your workspace. With several workspaces it reads "My teams" and opens a picker. Your followed team stays one tap away. (#111)
- **Workspace templates.** Admins add custom fields to the match and pit forms, per season. Entries made under an older form still display correctly. (#111)
- **Workspace settings.** Settings has separate Personal and Workspace sections. Admins set the workspace's default season and event; members see them read-only. Your theme, density and notifications stay yours. (#114)
- **Members.** Settings › Workspace › Members lists everyone in the workspace. Admins can remove someone there, and the removal also happens in Control Point. Someone removed in Control Point loses Scout access within about a minute. The last admin can't be removed, and removal never deletes anyone's account or personal data. (Control Point #256, #116, #122)
- **Assignments.** Admins assign teams at an event to members. Members see "My assignments" with live progress and mark them done. "Assigned to …" badges show on entry cards. (#120)
- **Shared pick list.** One ordered pick list per workspace and season. Any member can add, remove, drag to reorder and leave a shared note, and changes show up live. Each pick shows OPR and world rank. You can copy your personal shortlist in. (#121)
- **Activity feed.** A per-workspace history of entries, edits, deletes, template and settings changes, photos, assignments, pick list changes and members joining or leaving. Kept 90 days. (#113)
- **Notifications.** A bell at the top right with an unread badge. It covers assignments, edits to your entries, comments, template changes, membership and pick list changes. Read state syncs across your devices, and each type can be switched off in Settings. (#115)
- **Comments.** Every workspace entry has a live comment thread. You can edit or delete your own comments; admins can delete any. The entry's author is notified. (#119)
- **Version history.** Each shared entry keeps its last 20 versions with who changed what. If someone else's edit overwrites yours, you see "Your edit was overwritten by …" with a field-by-field diff, and you can restore your version. (#118)
- **Search and filters.** Filter the entry feed by team, event, author, match or kind, search the notes, and sort by newest, team or match order. Filters are part of the page link. (#117)
- **CSV export.** Download a workspace's entries, or just the filtered ones, as a spreadsheet. The columns match your workspace's form, and the file opens cleanly in Google Sheets. (#112)
- **Photos.** Add up to 6 photos to a workspace entry. They're shrunk on the phone before upload and their location data is removed. Photos expire 2 days after their event ends, while the entry text stays. Storage has hard limits so it never grows into paid usage. (#109)
- **Offline.** Entries saved offline in a workspace sync when you reconnect, including when you open the app while offline. If you lose access before they sync, they move to Personal so nothing is lost. (#110, #122)
- **Deleted workspaces.** If a workspace is deleted in Control Point, or is left with no admin, its Scout space turns read-only with a banner, and everything in it can still be read and exported. If the workspace comes back, writing works again on its own. (#123)

### Owner tools

- **Owner portal** at `/owner`, visible only to the site owner. It covers usage, prediction health, on/off switches for live updates, workspace scouting, error reporting, offline packs and photos, the feedback inbox, error reports, data jobs, photo storage, orphaned workspaces, and an audit log of every owner action. (#106, #109, #123)
- **Error reporting.** When something breaks, the app offers "Something broke — report it?". Reports are stripped of personal information and filed as GitHub issues, and repeats are counted instead of duplicated. There's also a "Report a bug" option in Settings. (#102)

### Site and pages

- A branded 404 page, and real "not found" responses for unknown pages, teams and events. (#86)
- New Privacy policy, Terms of use and Contact pages, plus a site footer. (#82, #85, #92)
- A cookie consent banner. Anonymous page counts are taken only after "Allow", with no cookies and no third parties. (#81, #88)
- "Predict a match" and "Browse events" buttons on the home page. (#80)
- A sticky action bar on phones for team and event pages. (#84)
- Clear error messages on every form. (#95)
- Phones at 390 px: nothing clipped or unreachable. (#87)
- Colourful stat tiles on the team page and My team, a "Season so far" summary, and My team opens on the latest season the team played. (#98, #99)
- Smoother Shortlist drag that stays inside the table. (#90)
- Odds show plain percentages, and low ranks read "Bottom 10%" instead of "Top 91%". (#79, #101)

### Speed and reliability

- Pages paint before the app's code runs, and each page's code is preloaded. On phones, home's speed score went from 73 to 87 and the team page's from 50 to 75. (#93, #91)
- First visits no longer download the 1.6 MB offline pack, which saves about 1.6 MB per new visitor. (#83)
- The Events list loads in batches, and its search box no longer drops letters. (#94)
- CSV exports start downloading immediately. (#89)
- Deploys no longer cause brief "502" errors. (#97)

### Fixes

- When FIRST hasn't published a full score breakdown yet (usually briefly during live events), foul points for 2023 and later seasons are now credited to the right alliance. (#100)
- The public data snapshot can never include contact messages, usage stats or any private table. (#105)
