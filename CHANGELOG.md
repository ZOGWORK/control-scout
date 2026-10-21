# Changelog

What changed in Control Scout, newest first. The prediction engine has its own
changelog in `packages/predict-engine/CHANGELOG.md`.

Each release opens with a `### Highlights` block: 3 to 5 short lines a visitor
would notice, each starting with a `[tag]` that picks its icon (home, predict,
teams, scout, offline, speed, live, report, alerts, rankings, share, workspace,
picklist, history, fixes). What's new shows them first; the groups below are
the full release notes, one click away.

## 1.18.0 — 2026-10-21

Bonus ranking point odds next to every qualification win %.

### Highlights
- [predict] Each alliance's chance at every bonus RP, next to the win odds
- [predict] Expected ranking points from the match, red and blue
- [report] On match pages, pre-match reports and the match lab
- [history] Bonus calls are logged and scored like win calls

### Predictions
- **Bonus ranking points per match.** A qualification match of 2025–26 or 2026–27 now shows, under its win odds, the chance each alliance earns each of the season's bonus RPs (Movement, Goal and Pattern; Swarm, Pollinator 1 and Pollinator 2) and the ranking points each side can expect from the match (3 × win chance + bonus chances), with its own confidence tier. It's the same math the event simulator uses, from prediction engine 2.3. On match pages (opened from any match list), the pre-match report and the match lab, online and offline from a pack saved after this release. Once a match is played, the call sits next to the bonuses actually earned.
- **A bonus curve that keeps up with the season.** The chance of each bonus at a given score is fitted to the season's latest 2,000 recorded qualification alliances (from 200 on; provisional below 600, at most moderate below 2,000). On the 2025–26 replay that scored a Brier of 0.147 per bonus call, against 0.178 for the whole-season curve the engine shipped with.
- **Scored in the track record.** Bonus calls are written to the ledger with each pre-match call and scored by Brier per bonus, live and season replay kept apart. The replay fits the bonus model only on results before each match. See How it works › Bonus ranking points. (#228)

## 1.15.0 — 2026-10-21

How predictable each team has been, from the engine's own live calls.

### Highlights
- [teams] A prediction report card on team pages: how often calls were right
- [teams] How far its alliances landed from the predicted score
- [teams] Live calls only, with sample size, raw numbers and a warning

### Teams
- **Prediction report card.** Team pages show how the engine's pre-match calls on that team's matches turned out this season: the share called right, points vs prediction per robot (the alliance's miss split evenly between its robots) and the swing of those misses, with the field average beside each. Finished events get a row each, with how many calls had a predicted score and the raw numbers. Only calls logged before each match count, never the replayed history. Few calls say little, so every number is pulled toward the field average as if the team had 10 more calls, and the card says so. How it works explains the rules. (#232)

## 1.14.0 — 2026-10-21

Predicted scores come with a range now, and the range is scored in public.

### Highlights
- [predict] Every predicted score reads like 118 ±14: an 80% range
- [predict] Ranges widen for robots with few matches or up-and-down results
- [history] How it works shows how often real scores land inside the range

### Predictions
- **Score ranges.** Every predicted score now comes with its 80% range, written 118 ±14 (hover or tap for the range itself and what it means: about 8 in 10 real scores land inside). It's on match rows, match details, match reports, the Predict lab, the live panel, Watch live and the pit display, and offline from your saved pack. A range is wider when a robot has played only a few matches this season or its results swing from match to match, and narrower in playoffs. Prediction engine 2.2.0; win odds are unchanged.
- **Ranges are on the record.** Every call is logged with the range it stated, and How it works scores them like the win calls: the share of real scores inside the range, which way the misses went, the average width and each confidence tier. Calls made before this release stated no range and none is added afterwards. (#230)

## 1.13.0 — 2026-10-21

Model vs field: where the model's ratings and the seeding disagree most at an event.

### Highlights
- [rankings] Model vs field: teams the model rates well above or below their seed
- [predict] Every call with its numbers: rating, matches, OPR, record and confidence
- [rankings] Before quals, against each team's seed at its last event

### Events
- **Model vs field.** An event's Rankings tab now opens with the biggest gaps between the model's rating order and the official seeding: "the model rates them #3 of 28; they're seeded 18th". Each call shows the rating and its uncertainty, how far it is from the team the model places at that seed, the matches behind it, OPR, record, ranking points and a confidence tier, with the model's track record linked under it. Before qualification matches, ratings from earlier events are compared with each team's seed at its last event (and the label says so); a finished event uses the ratings as they stood at its last match. Small fields, ratings on few matches, and gaps the model can't tell from its own uncertainty are left out, and the section says why when nothing shows.

## 1.12.0 — 2026-10-21

Follow your team in Discord for the whole event, not just its matches.

### Highlights
- [alerts] The evening before an event: who's there and your team's season
- [alerts] Your schedule, with win odds for every match, the moment it's out
- [alerts] A recap at the end of each day: record, rank and live calls right

### Discord
- **More from /follow.** Besides the post before each match and its result, a followed team's channel now gets: the evening before the team's event (from 4 pm at the venue), where and when, how many teams, the team's season OPR and world rank, and the strongest teams there; the team's qualification schedule once FIRST posts it, each match with its time at the venue, side, partner and win odds; and, at the end of each event day, the team's rank and record there, its matches that day, and how many of its live calls were right. Each team gets its own schedule and recap post. (#224)

## 1.11.0 — 2026-10-21

A pit display for the TV in your pit.

### Highlights
- [live] Pit display: the whole event on the pit TV, no sign-in needed
- [predict] Up next with win odds, a countdown and the current rankings
- [teams] Your tracked teams in gold when you're signed in

### Events
- **Pit display.** A "Pit display" button on every event page opens a fullscreen screen for a pit TV or laptop: the event and the venue's clock, the match up now (or the last result, with whether the call was right), the next three matches with their win odds, a countdown to the next one (left out when the event runs behind, rather than showing a wrong time), the top 8 and a QR code to the event page. It updates by itself, shows "Reconnecting…" if the connection drops, keeps the screen awake where the browser allows it, and fits 1920×1080 and 1366×768 with no scrolling. Signed in, your tracked teams show in gold and your next match is pinned. (#218)

## 1.10.0 — 2026-10-21

Watch an event's stream with the model calling every match beside it.

### Highlights
- [live] Watch live: the event's stream with live predictions beside it
- [predict] See each call, then whether it was right, the moment a match ends
- [live] A LIVE dot on events you can watch right now

### Events
- **Watch live.** When an event has a stream, its page gets a "Watch live" button and a section above the matches: the YouTube stream (it loads only when you press play, from YouTube's privacy-enhanced player) and, beside it, the match the model is calling now, with its win odds, predicted score and confidence. The moment a match finishes it shows the result and whether the call was right, then moves to the next one, with the three after it below. After the event the stream stays as the recording. On phones the stream comes first and the calls below it. (#219)
- **LIVE dot.** Events that are on now and have a stream show a red LIVE dot in the events list.
- **Owner portal › Streams.** The owner sets an event's stream from a YouTube link (watch, youtu.be or /live/ links); anything else is refused with the reason, and nothing is saved.

## 1.9.0 — 2026-10-21

Control Scout comes to your team's Discord server.

### Highlights
- [share] A Control Scout bot for your team's Discord server
- [predict] /predict: win odds for any qual match, and how played calls turned out
- [teams] /team, /event and /rankings answer right in the chat
- [alerts] Follow your team: a post before each match, and its result

### Discord
- **The Control Scout bot.** Add it to your team's server and anyone there can ask `/team` (record, OPR, world ranking, next event), `/predict` (win odds as bars, predicted score and confidence for a qualification match; once it's played, the final score, what was predicted and whether the call was right), `/event` (status, progress, top 5 by OPR, the winning alliance) and `/rankings` (the world top 10 with movement). Every answer links back to the page it came from, and the numbers are the site's own. Event names and codes autocomplete. The invite link is in the FAQ and footer. (#216)
- **Match alerts in your server.** Someone who can manage the server types `/follow team:18360` in a channel, and the bot posts there 15 minutes before each of that team's matches (lineups, win odds, predicted score) and again with the result and whether the call was right. `/unfollow` stops it, `/following` lists a server's teams (up to 10), and `/help` lists every command. My teams and My team have an "Add to a Discord server" button with the `/follow` command ready to copy.

## 1.8.1 — 2026-10-20

More of each page on a phone screen: match lists, tabs and the bottom bar take less room.

### Highlights
- [live] Phone match lists show both alliances side by side
- [speed] A slimmer bottom bar on phones, so more of each page shows
- [rankings] Page tabs and toggles take less room on phones

### Phones
- **Match lists.** On a phone 390 px wide or more, the red and blue alliances of each match sit side by side, facing each other with the scores in the middle (as on a laptop), instead of stacked. About five matches fit on screen instead of three and a half. The narrowest phones (320 px) keep them stacked. Event Matches tabs and team pages both get this. (#221)
- **Bottom bar.** 52 px tall instead of 60, and everything that sits above it (sticky buttons, the cookie and install notes) follows one shared height.
- **Tabs and toggles.** Page tabs (an event's Matches / Rankings / Insights…) and segment toggles (All / Quals / Playoffs) are tighter on phones, so more tabs show before the row scrolls.

## 1.8.0 — 2026-10-20

Phones fit more on screen, get a menu button at the top left, and a bottom bar you pick yourself.

### Highlights
- [home] Phones: the menu sits top left, with the logo in the middle
- [scout] Scout takes the bottom-right tab on phones, where More was
- [home] Pick your phone's bottom tabs in Settings › Appearance
- [rankings] Phones fit more on screen, with a text size you can change
- [fixes] iPhones no longer zoom in when you tap into a text box

### Phones
- **A menu button, top left.** The sidebar-style button at the left of the top bar opens the menu with every page (what the More tab used to open). Search sits beside it as an icon, the logo is centred, and the theme switch, notifications and your account stay on the right; it all fits a 320 px screen. Desktop is unchanged. (#220)
- **Scout in the tab bar.** The bottom bar is Home, Events, Predict, My team and Scout by default.
- **Your own tab bar.** Settings › Appearance › Phone tab bar: turn pages on or off (2 to 5), move them left or right, see a preview, or reset to the default. The choice is kept on this device; every page is always in the menu too.
- **More on screen.** Phones draw everything a step smaller (14 px text instead of 16), with tighter padding, gaps and buttons, so there's less scrolling and nothing is hidden or reworded. Desktop looks the same.
- **Text size.** Settings › Appearance › Text size: Smaller, Default, Larger or Largest. Text, boxes and buttons scale together, and the choice is kept on this device, so a phone and a laptop can differ.
- **Tables on phones.** Records tables (an event's Rankings and Insights, the Records page) show the team number only in a narrow first column, and a tap on it shows the team's name with a link to its page. Tighter cells fit about four stat columns on a 390 px phone instead of less than one.
- **No more zooming in on a field.** Text boxes use 16 px text on touch screens, so iPhones stop zooming the page in (and leaving it zoomed) when the keyboard opens. Pinch-zoom still works.

## 1.7.0 — 2026-10-18

A new home page, sharper predictions, and Scout pages that are faster to read and quicker to act on.

### Highlights
- [home] A new home page with a globe of this season's teams
- [predict] Prediction Engine 2.1 weighs form, momentum and match context
- [predict] Predict, rebuilt around the Lab and the latest live calls
- [teams] A My teams page, team colours and an easier Compare
- [offline] Download every season at once, and smoother scrolling

### Home
- **A new home page.** The headline "The whole field. In your corner." sits beside a globe of where this season's teams are from, with search and Predict / Find an event right at the top. Below are the season's totals (team listings, events, match scores), your team's next match, what's on the calendar, the public prediction record (live calls and season replays kept apart) and Control Scout's own opt-in usage. The globe turns slowly, with a pause button, and stays still for reduced motion. (#151, #157)
- **Teams by country.** Pick a country on the globe or from the list to see its team count, then open its teams with `/teams?country=`. Every team is counted once, including teams with no country listed. (#154)

### Predictions
- **Prediction Engine 2.0 and 2.1.** Win odds that account for match context, in-event form and momentum, plus fixes for official rules and bonus ranking points. Both engines' live calls are kept side by side so they can be compared fairly. (#136, #138, #140)
- **Predict, rebuilt.** The Lab (any four teams, any event) is a card you can't miss. A matchup starts from any team, and earlier seasons' calls are a click away. The header's right side now shows the latest live calls and how each one turned out. (#153, #155, #160)
- **Power rankings publish themselves** every Friday, with blurbs written by Bruno. (#145)

### Pages
- **My teams** has its own page, with your teams and their stats. (#150)
- **Compare:** a search that stays put, your teams one click away, and stats and charts on one screen. (#152)
- **Team colours.** Give each shortlisted team a colour; the shortlist and Compare use it. (#161)
- **Records tables** have a scrollbar above the table, and each column's numbers in its header's colour. (#159)
- **Team pages** open on the team's own numbers; your workspace's scouting take now comes last, after Matches. (#158)
- **Event pages:** the At a glance card shows the event's stats, and the LIVE panel puts Watch livestream and Track next to Know your match. (#143, #144)
- **Match rows:** the call has its own column, on two tidy lines, with the match report as an icon button. (#141)
- Motion on the new pages, like the rest of the app. (#156)

### Scouting
- **Assign teams by event name.** Type an event's name, city or code and pick it from that season's events. No code needed. (#162)

### Offline
- **Download all and Update all.** The Download page lists seasons in one place, with updates first, then saved, then not saved, and saves them one at a time. (#163)
- Offline packs only take over when there's no signal. (#142)

### Speed and scrolling
- The first paint no longer waits for the app; the privacy banner comes in the first HTML, page changes are prefetched, and event details are cached. (#146)
- Back and forward return to where you were, scrolling is lighter, and match rows don't light up while the page scrolls. (#147, #148)

## 1.6.0 — 2026-10-16

Shared scouting turns into match-day intelligence, and Scout becomes the app teams keep open at events.

### Highlights
- [live] Live mode counts down to your team's next match
- [report] Know your match: a pre-match report for every match
- [alerts] Push notifications before your tracked teams play
- [rankings] World rankings and weekly power rankings
- [share] Matchup cards to share in Discord and group chats

### Event day
- **Live mode.** While an event is running, its page shows a big LIVE state and counts down to the next match for your team, your assigned teams or your tracked teams, with the lineups and our call. Scores and rankings refresh on their own every 30 seconds, and the page goes back to normal when the event ends. (#128)
- **Know your match.** Every match has a pre-match report at `/events/…/match/…`, one tap from any match row or the LIVE panel. For all four robots it shows the call, OPR with its auto/TeleOp/endgame split, ranks, watch flags (your team, assigned, pick list, tracked, high penalties, inconsistent, rising) and your workspace's scouting consensus. With no scouting it falls back to OPR only, so it's never empty. (#131)
- **Push notifications.** Signed-in users can turn on notifications per device. You get one 15 minutes before a tracked team's match, another when an upset finishes at an event you follow, and another when a followed event starts. Each type can be switched off, and nothing arrives after its match has started. (#134)

### Scouting intelligence
- **Your team's take.** Team and Compare pages show your workspace's consensus: average ratings, strengths and weaknesses, most-noted answers, entry count and scouts. Only members of that workspace can see it. (#126)

### Rankings and sharing
- **World rankings** at `/rankings`. Every team is ranked by rating, with ↑/↓ movement since last week and Rising/Falling/Steady labels. You can filter by country, state or "My region", and pick past weeks, which are filled in back to the start of last season. (#129)
- **Power rankings** at `/power-rankings`. Each week's top 25 has written blurbs and gets its own shareable page, with an archive of past weeks. Each week is one markdown file, and a scaffold command pre-fills the top 25. (#133)
- **Share cards.** Matchups can be shared as branded images, e.g. "Our model gives 4215 a 73% win chance vs 33950", in wide and square sizes. Use the phone's share sheet or download the image, and Predict links show the card when posted in Discord. (#130)

### First visit
- **A short welcome tour** points first-time visitors to search, tracking a team and predictions. It's skippable, shows once and never to bots. (#127)
- **Add to home screen.** A gentle nudge appears at most once a day, and never again once dismissed or installed. On iPhone it shows a Share → Add to Home Screen hint instead. (#132)

### Reliability
- Uptime checker code (a Cloudflare Worker that alerts Discord when the site goes down). It's in the repo but not switched on. (#125)
- Live event pages no longer re-download unchanged data every 30 seconds. (#128)

## 1.5.0 — 2026-10-16

Scouting becomes a shared team workspace, plus a production-readiness and speed pass.

### Highlights
- [workspace] Team workspaces from Control Point, live like messaging
- [picklist] A shared pick list, assignments and comments
- [history] Version history, so an overwritten edit can be restored
- [offline] Entries saved offline sync when you reconnect
- [speed] Faster pages, clearer errors and a proper 404 page

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
