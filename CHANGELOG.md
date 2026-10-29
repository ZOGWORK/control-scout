# Changelog

What changed in Control Scout, newest first. The prediction engine has its own
changelog in `packages/predict-engine/CHANGELOG.md`.

Each release opens with a `### Highlights` block: 3 to 5 short lines a visitor
would notice, each starting with a `[tag]` that picks its icon (home, predict,
teams, scout, offline, speed, live, report, alerts, rankings, share, workspace,
picklist, history, fixes). What's new shows them first; the groups below are
the full release notes, one click away.

Releases count 1.1, 1.2, 1.3 …, the last number being the step inside one:
after 1.3.7 comes 1.3.8, then 1.3.9, then 1.4.0. No number goes past one digit.
(Releases before 1.3.7 were renumbered from the old 1.5.0 … 1.37.0; the old
fix releases 1.8.1, 1.16.1–2 and 1.19.1–2 are now 1.0.8.1, 1.1.6.1–2 and
1.1.9.1–2.)

## 1.4.4 — 2026-10-29

The owner console's Data & sync section shows when each season last synced and lists data-quality checks for triage, and a new Packs & offline section shows the offline pack manifest file by file.

### Highlights
- [report] When each season last synced, at a glance
- [report] Data-quality flags to triage, never auto-fixed
- [offline] The offline pack manifest with every file's size and SHA-256
- [fixes] Re-sync and rebuild ask first; nothing here deletes a pack

### Owner console
- **Data & sync.** When data last synced, stats were rebuilt, live results ran and packs were built; then every season's last sync, whether it completed, when FIRST's team list was last read, events with results out of all events (and how many came from the fallback source), played matches and what the last run fetched and failed. Re-sync and Clear caches sit below, each behind its confirmation.
- **Data-quality flags, for triage only.** Five read-only checks, each with a count and its first rows linked: events the last sync couldn't fetch, events that ended over two days ago with no played match, season records whose wins, losses and ties don't add up to the match count, season totals smaller than their events' qualification matches, and sitemap URLs the app would answer with its not-found page. Nothing on this screen changes match data; wrong results come in right with a re-sync. "Check again" runs them now (they're otherwise kept five minutes).
- **Packs & offline.** A new tab with the manifest (version, built, data as of, engine), the releases kept on the server, and every file with its season, kind, size and full SHA-256 (wrapping on a phone, with a copy button); a file the manifest lists but the disk lacks is marked. Rebuild asks first. There is no delete: packs saved on devices stay until each device updates them. (#337)

## 1.4.3 — 2026-10-29

The owner console is now organised the way it's run: health first, then data, predictions, rankings, features, feedback and analytics, with an audit log that records every change's old and new value and can't be edited.

### Highlights
- [report] The owner console opens on the site's health at a glance
- [report] Every switch flip and data action is logged with its old and new value
- [report] The audit log can't be edited or deleted, not even from the console
- [fixes] The console shows counts, never your devices or workspace members' names

### Owner console
- **One click away.** The owner's own sidebar has an Owner console button right above their name (an icon in the collapsed rail); nobody else ever sees it. It replaces the Owner row in the menu.
- **One tab per job.** Overview, Data & sync, Predictions & ledger, Rankings & content, Features, Feedback & errors, Analytics, Accounts, Photo storage and Audit log. Links to the old tabs (`?panel=users`, `?panel=flags` …) open the section that holds them now.
- **Health first.** Overview opens on whether the site is up, when data last synced (amber once it's more than six hours old), the engine version in production, the live ledger's headline, the offline pack manifest's date and version, and the error reports and server errors of the last day and week.
- **An audit log that keeps its word.** Every switch flip, inbox move and stream change records the value it replaced and the value it set, shown as "on → off". The database refuses to delete a row or rewrite one; the only thing a row ever takes later is a data job's result.
- **403 for everyone else.** Every owner route, read or write, known or not, answers 403 to anyone who isn't a signed-in owner, before any handler runs.
- **Less personal data on screen.** An account shows how many devices are signed in, not which browsers; a read-only workspace shows how many members and admins can read it, not their names. (#335)

## 1.4.2 — 2026-10-29

Launch fixes: every team's event rows now add up to its season record, old power-rankings weeks stay as they were written, and the labels say exactly what each number is.

### Highlights
- [teams] Event rows count every match and add up to the season record
- [rankings] Past power-rankings weeks keep their original numbers
- [predict] Live and replay track records side by side, each labelled
- [fixes] One address for How it works, and no more dead team links
- [teams] Clearer ranks, odds and empty columns on team and event pages

### Teams
- **Rows that add up.** Each event on a team page now shows the team's record over every match there, playoffs included, with the quals record underneath when it differs. League meets show the meet's own record and rank instead of the league's running total, which made many teams look undefeated (one winless team showed 10-0-0). Rows for events a team never played are gone, scrimmages with matches show their record, and the season record counts qualification no-shows the way FIRST does. A tooltip says what each record counts, surrogate matches excluded. (#332)
- **Labelled ranks.** OPR and rating ranks say which list they come from and out of how many teams. A team with no results yet this season says it's showing last season, with a link to switch. (#333)

### Power rankings
- **Archives stay put.** A week's stats, order and names are saved with its write-ups when it goes out, so an old week never drifts as ratings move. The page says when its stats are from, a week is tagged by the season its dates fall in, and write-ups say "week 43", never "2026-w43". (#325)

### Predict and track record
- **Side by side.** On the home page, the season replay and the logged-live figure sit side by side at the same size. The live figure says it covers all engine versions, with the current engine's figure underneath. (#333)
- **Two odds, explained.** On an event page, the Rankings column and the Odds tab say how many simulations each ran and when, and why the two can differ. (#333)
- **How it works.** It has one address now (the old /predict/accuracy and /predict/how-it-works links forward to it), its track record shows when it was last updated, and its match and simulation counts each say what they count. (#327)

### Events
- League meets show "#1 at this meet" to match their rankings table, and say how many of the league's teams played there. Blank prediction columns and scrimmages explain themselves, and venue lines no longer show a double comma. Compare says when it switched to the last season the teams played. (#333)

### Fixes
- Team pages exist only for real teams: FIRST's demo and test registrations and its stand-in numbers for unnumbered teams are left out of rankings, search and the sitemap, and /records forwards to /teams. (#329)
- Security headers on every page (HSTS, frame and permissions policies, a content security policy in report mode). (#328)

## 1.4.1 — 2026-10-29

The weekly digest just says it comes once a week, without naming a day or time.

### Highlights
- [alerts] The weekly digest says "once a week" in Settings
- [alerts] Turning it on says the first one comes within a week
- [alerts] The digest's description no longer names a send day

### Weekly digest
- **No fixed time in the copy.** Settings, the switch's confirmation and the description say the digest comes once a week, instead of naming a day or time. The email itself is unchanged. (#334)

## 1.4.0 — 2026-10-29

The home page's track record now shows how this season is going too, and its big number is in the accent yellow.

### Highlights
- [home] This season's replay so far, on the home track record
- [predict] The track record's big number in yellow, like the ledger
- [home] Live calls and replays still shown apart, each labelled

### Home
- **This season so far.** Under the track record's big number, a box shows this season's own season replay (for example "Season replay · 2026–27 BIOBUZZ so far: 68.4% of 1,065 decided matches called right"). It shows on both tabs, labelled as a replay and never mixed into the live number, and it's left out when that replay is already the big number. (#331)
- **Yellow numbers.** The track record's percentage is in the accent yellow, the same as the ledger on How it works.

## 1.3.9 — 2026-10-28

The home page's headline changes every hour, one of thirteen lines about what Control Scout does.

### Highlights
- [home] A new headline on the home page every hour
- [home] Thirteen lines take turns, the same one for everyone
- [home] The page never jumps when the line changes

### Home
- **Thirteen headlines, one an hour.** From "Know the match before it starts." to "The field, figured out.", they take turns on the hour, the same line for everyone at the same time. An open page changes on the hour with a short fade (no motion with reduced motion turned on), and the hero keeps its height, so nothing below it moves. There is still one heading, and screen readers aren't told about the change. (#330)

## 1.3.8 — 2026-10-28

A weekly email for the weeks you don't open the app, a Scout page that sets the event once and goes match by match, a simpler Predict in three modes, and match videos with the model's call on screen.

### Highlights
- [alerts] A weekly digest email, opt-in in Settings
- [scout] Scout sets the event once, then goes match by match
- [predict] Predict in three modes: Advancement, Scheduled and Custom matchup
- [live] Each match has a Watch button, and the model's call shows on the video
- [teams] Upcoming events list their registered teams before any match is played

### Weekly digest
- **One email a week.** Turn it on in Settings › Notifications › Email. It covers the teams you follow (your team and tracked teams), and only comes when there's something to report: no results, no calls, nothing coming up means no email.
- **Your teams' week.** Each event a followed team played last week, linked: the record, the seed, how playoffs went, and OPR against the team's previous event, with both numbers. Two events in one weekend show as two rows, never one merged record.
- **Prediction check-in.** How many of our pre-match calls on your teams' matches were right that week and all season, counted exactly as the public track record counts them. A bad week says so.
- **Coming up and power rankings.** Your teams' events in the next two weeks with a countdown (and whether a schedule is out yet), and where your teams moved in that week's power rankings.
- **Easy to leave.** Every email has a one-click unsubscribe link that works without signing in, and mail apps show their own Unsubscribe button. No tracking pixels, no tracked links. A hard bounce turns the digest off by itself (#324).

### Scout
- **Set the event once.** Scouting starts by asking where you are (today's events first, then your team's) and what you watch: one robot, one alliance or all four. After that the Scout page opens on the match where scouting picks up, from the event's schedule, which stays on the phone for venues with no Wi-Fi (#289, #297, #308).
- **A whole match per save.** The teams you watch are tabs, the form shows one phase at a time with big tap targets, and the match timer moves from Auto to TeleOp to Endgame by itself. "Save Q14 · 2 teams → Q15" saves an entry for each team and moves on. A draft survives a locked or reloaded phone, and "Undo last tap" takes back the last tap (#294, #299, #300).
- **Quick mode for all four teams.** One short row per team (the main TeleOp count, the endgame, a few yes/no taps) for when you watch the whole match (#305).
- **Matches and Data tabs.** Matches lists every match at the event as done, partly done, skipped or now; tap one to open it. Data holds what the old toolbar did: entries with filters and CSV export, pick list, activity, assignments, pit scouting, recordings and the template (#293, #298, #308).
- **Assignments by slot and match range.** A captain can give "Priya: Red 1, Q1–Q30" or "Marcus: Blue alliance, Q15 on". Your assignment fills in the setup screen, and every match shows who has the other teams and whether they're done (#306, #309).

### Predict
- **Three modes, one compact header.** Predict opens on Advancement, with Scheduled and Custom matchup beside it as tabs, and the mode's controls start right under them. Old links still open the right mode with their picks (#287, #292, #307, #311, #314).
- **Advancement picks an event by search.** The event comes first, in a search with suggestions (your team's events when a team is set), and the team is optional. An event from another season moves to that season and says so, keeping the team (#290, #296, #304).
- **Scheduled is scheduled matches.** Pick a team or event to see its upcoming matches; advancement odds are one link away in Advancement. This week's events are a day-by-day list with a search and a Filters button (#288, #295, #302).
- **Custom matchup swaps from the result.** Swap sides re-predicts the same four teams with the alliances swapped, no retyping, and the ratings table folds away so the odds and reasons lead (#303).
- **Tracked events as quick picks.** Events you track show as one-tap picks in Advancement and Scheduled (#312).
- **Predict Lab.** Once a team is chosen, only the events it's registered at are listed, city and state search works, Field rows open in place, and switching teams no longer freezes the page (#277, #278).

### Events and matches
- **Recordings, at the right second.** An event's YouTube recording plays on its page, and each played match gets a **Watch** button that jumps the player to that match. A video filter on Events finds events with recordings. One watch button, not two, and a Close video button (#268, #270, #272).
- **The model's call on the video.** While a recording plays, a card on the player follows it: the next match's teams and the model's odds, then the result with "Called it" or "Upset". It can be switched off or moved to the top or bottom (#276).
- **Team names in match rows.** Every match row shows team names under the numbers, and tapping a team opens a small card with its place at the event, record and season OPR, without leaving the page (#281, #319).
- **The full score sheet.** A match's details show the score as FIRST reports it: Auto and TeleOp broken into their parts, plus foul counts (#282).
- **League meets ranked on their own matches.** A meet's Rankings tab and its Model vs field card now use the meet's own qualification matches, not the league's running standing, so every team gets a rank. Event tables colour the numbers by where a team stands (#283, #284, #286).
- **Simulated rankings before quals.** Before any qualification match, the Rankings tab can simulate the event: each team's likely rank and its odds of finishing first, top 4 and top 8, with a clear "Highly uncertain" note (#271).
- **Match list in schedule order.** Matches read Q1, Q2, Q3 even when they start out of order. The next match is enlarged in place during a live event, and the row under the mouse stays enlarged while you scroll (#261, #262).
- **Currently tracking.** The Events page lists the events you track, live first. Today's coin flips hides on a day with none (#275, #315).
- **Events search on a phone.** The Events tab has its own search for events and places at the top (#266).
- **Clearer buttons and labels.** Buttons, tabs and filters on event pages look tappable, and status and type look like labels (#269). The venue line opens in Google Maps (#276).

### Registered teams
- **Upcoming events show who's coming.** An event used to show 0 teams until rankings were posted. It now lists the teams registered with FIRST about a week ahead ("17 teams registered"), for every region, and shows the event's address (#322).
- **New Jersey, even earlier.** Until FIRST publishes a New Jersey event, its page shows FTC New Jersey's registered teams and event details (host, address, times, format), clearly marked provisional; FIRST's data replaces it once it's out (#321).
- **No team in the wrong session.** At an AM/PM event each team shows only in its own session, and waitlisted teams are kept apart from the teams list (#323).

### Navigation
- **Seven pages in view, the rest under More.** The sidebar shows Home, Events, Teams, Rankings, Predict, My team and Scout; everything else sits under More. It fits a laptop screen, folds to an icon rail under 1280 px, and spaces out on taller screens (#291, #301, #316).
- **Your account in the sidebar.** Signed in, the sidebar's footer shows your name, sync status, Settings and Sign out; signed out, a Sign in button. The top bar no longer has the account menu (#313).

### Teams and track record
- **Confidence in plain words.** The three confidence levels now read **Rough guess**, **Fair** and **Solid** everywhere (#285).
- **Top N%, always.** A team's OPR share reads "Top 94%" rather than "Bottom 7%" (#265).
- **Season replay is the headline.** The home track record leads with the last full season's replay (2025–26 DECODE), and the new season's live number says it's still calibrating (#274, #318).

### Fixes
- On iPhone the app could say "You're offline" while online; it now asks the network instead of trusting the phone's flag (#260).
- Tapping a search result on a phone opens it instead of just closing the list (#264).
- The sign-in email shows the real logo, and its code copies as one number (#263).
- The site is back much faster after an update: a restart takes about 2 seconds instead of over 30 (#279).
- The home atlas's country total is in the display gold in light mode (#259).

## 1.3.7 — 2026-10-23

Saved offline seasons keep themselves current: you're asked when an update is out, or it downloads by itself.

### Highlights
- [offline] Saved seasons check for updates in the background
- [offline] One "Update now?" per release, in a pop-up and your notifications
- [offline] Choose: ask me, or download automatically
- [offline] Choose: Wi-Fi only, or Wi-Fi and mobile data

### Offline
- **Updates find you.** A saved season used to need a visit to the Download page to see that a newer release was out. The app now checks in the background (soon after it opens, when you come back to the tab, and every hour) and asks once per release: "Offline data for 2025–26 has an update (41.9 MB). Update now?" Yes downloads it and swaps it in; Later waits for the next release. Signed in, it also sits at the top of your notifications until you answer.
- **Or skip the question.** The Download page and Settings › Offline data have "When updates are out: Ask me / Download automatically" and "Download updates on: Wi-Fi only / Wi-Fi and mobile data". Both sync with your account. The small offline-predictions pack follows the network setting too.
- **No guessing about Wi-Fi.** Only some browsers tell a site whether it's on Wi-Fi (Chrome on Android does; Safari, iPhone and desktop Chrome don't). Where the browser doesn't say, Wi-Fi only means you're asked first instead of a silent download, and the Download page says so. Data Saver on always asks first (#257).
- As before, every download is checked against its published SHA-256, and a failed or partial one never replaces the saved copy.

## 1.3.6 — 2026-10-23

Power rankings stay current all week: the top 25 is checked against the latest results every day.

### Highlights
- [rankings] Power rankings are checked every day, not just Fridays
- [rankings] The page says when a week was last updated
- [rankings] Only blurbs for teams that moved are rewritten

### Power rankings
- **Checked every day.** The current week's top 25 is compared with the latest data every day at midnight New York time. If nothing changed, the week stays exactly as it was and only its date moves ("Published Friday, Oct 23 · Updated Sunday, Oct 25"). If something did, the changed entries are updated, and Bruno rewrites only the blurbs of teams whose place changed; the rest stay word for word. Past weeks and hand-written weeks never change. The owner portal lists each day's check and can switch the refresh off (#255).

## 1.3.5 — 2026-10-23

Team pages tell search engines exactly who the team is, so a search for a team's number and name finds its page.

### Highlights
- [teams] Team pages are titled with number and name: "4215 Hypnotic Robotics"
- [teams] Team pages name the town, rookie year, record and events at once
- [fixes] Search engines see each team page as fresh when the team has played

### Teams
- **Found by number and name.** A team page's title now leads with what people search for: "4215 Hypnotic Robotics — FTC team stats, OPR & predictions · Control Scout", and its main heading is the number and name together (it looks the same as before). Its description is built from the team's own data: town, rookie year, latest season's record and OPR rank.
- **Readable before the app loads.** The first response for a team page carries a short summary and its most recent events as links, so search engines and slow connections read who the team is without running any script. The app takes over as before.
- **Clearer to search engines.** Each team page describes itself as the team's profile page, with the team's own website and its FIRST page listed as the same team, and a Home › Teams › team trail. A link with ?season= still names the one team address as its canonical.
- **Fresh in the sitemap.** A team's last-changed date in the sitemap is now the last day it played (or a later correction to those results), instead of the date of the last data sync, which was the same for every team. (#256)

## 1.3.4 — 2026-10-23

The Predict Lab opens on advancement odds, bigger and easier to use, and its season switch works again.

### Highlights
- [predict] Predict Lab: advancement first, with a larger team box and event list
- [fixes] The Lab's season switch changes the season again
- [home] Click a country on the globe; the atlas opens on your team's country
- [report] The ledger says when the season under way is early and still moving

### Predict Lab
- **Advancement first.** The Lab opens on Advancement; a custom matchup of any four teams is the second tab. Larger heading and tabs, a big team box, a search box and a taller event list showing each event's type and city. (#258)
- **Season switch fixed.** Choosing another season in Advancement did nothing: the season and the cleared event were written to the address one after the other, and the second write put the old season back. Both now go in one write.
- **Outlook before 2025–26.** Advancement points started in 2025–26, so earlier events no longer show a breakdown of zeros; they say why there's none. Once alliances are set, Captain and Picked read Yes or No.

### Home
- **Click a country on the globe** to see its totals. A mouse press used to be taken for the start of a drag, so clicks didn't reach the country; now a press only turns the globe once it moves.
- **Opens on your country.** Signed in, the atlas opens on your home team's country (your Control Point team, else the team you follow); signed out, the United States. Choosing another country only changes what's shown, never your default.
- **Explore** is the app's own dropdown instead of the browser's.

### How it works
- **Early-season note.** While the season under way has fewer than 3,000 decided matches, the ledger says its figures are early and still moving (most robots have played little, so calls lean on last season), with where last season ended for comparison.

## 1.3.3 — 2026-10-23

Small fixes: Compare lets you pick the team the others are measured against, and match videos can be added from your camera app.

### Highlights
- [teams] Compare: drag teams into order; the first is the baseline, tinted yellow
- [scout] Add a match video you filmed with your camera app, or any video file
- [live] Today's coin flips moved from Home to the Events page
- [fixes] Check again shows it's checking; event names in match lists are larger

### Compare
- **Reorder the teams.** Drag a team's grip (mouse or touch) onto another column, or use the arrow keys on it. The first team is the baseline the others are measured against: its column is tinted light yellow and tagged Baseline. Reordering doesn't load the comparison again, and head to head follows the baseline: its matches with or against the others, from its side. Dragging near the table's edge on a phone scrolls it. (#254)

### Scouting
- **Add a video you filmed.** A match's Video box now has Choose a video next to Start camera: pick a video from this device (or film one with the phone's camera app); MOV, MP4, WebM and other common formats, downloaded again with their own extension. It's kept on this device like an in-app recording, never uploaded. Browsers that can't record in the page still offer it. The box says what it holds (record, add a file or a YouTube link), and Settings no longer points at a camera icon that isn't there.

### Home and events
- **Today's coin flips are on the Events page,** above the event list (current season), instead of on Home.

### Fixes
- **Check again** (statistics catching up) spins and reads Checking… until the fresh answer is in.
- **Event names** heading a match list are a size up, no longer smaller than the match numbers.
- **Power rankings:** "Control Point" in the Bruno note links to Control Point.
- **Scouting report button** on each match row is a soft solid gold, so it stands out.
- **"OPR at this time"** replaces "OPR here" next to a team's OPR at an event (match details, the pre-match report, the model-vs-field list).
- **Shortlist:** the list view drops the Reliab. column to make room; reliability still shows in the grid view and on Compare.

## 1.3.2 — 2026-10-23

Score ranges are tighter and honest again: about 8 in 10 real scores land inside the stated 80% range.

### Highlights
- [predict] Predicted score ranges are about 10 points narrower
- [predict] 80% ranges hold about 80% of real scores again
- [rankings] Event simulations spread scores to match

### Predictions
- **Tighter score ranges.** Every predicted score comes with an 80% range. Since this week's engine changes made expected scores more accurate, those ranges had grown too cautious: they held about 85% of real scores instead of 80%. Their width is now refitted on 2024–25 matches; replayed over 2025–26, 81.4% of real scores land inside, and the ranges are about 10 points narrower. Playoff ranges stay as wide as before: that one setting was chosen after looking at 2025–26 playoffs, so the 2025–26 figure isn't a fully independent check. Event simulations draw scores with the same spread, and still put 87% of teams' real final ranks inside their projected range. Win odds are unchanged. Prediction engine 3.2.0 (#253).

## 1.3.1 — 2026-10-23

Ties count: expected ranking points and event simulations now give a tie's RP to both alliances.

### Highlights
- [predict] Expected ranking points count the chance of a tie
- [rankings] Event simulations let close matches tie, 1 RP each
- [report] How it works explains ties; win odds unchanged

### Predictions
- **Ties count.** About one qualification match in 130 ends in a tie, which pays 1 ranking point to both alliances. Until now the engine gave a tie no chance: expected ranking points counted a tie as half a win, and simulated events never tied, so a tie's points always went to one side. A tie's chance is now priced from how close the match is expected to be (highest in an even match, about 1–1.5%). Win odds and predicted scores are exactly as before; ranking points and simulated standings are now right in close matches. Measured on every season since 2019–20 (docs/engine/part12/ties.md). Prediction engine 3.1.0 (#251).

## 1.3.0 — 2026-10-23

How it works records four second-wave engine tests, all measured and turned down.

### Highlights
- [report] Lab notes: why a blend of three models didn't ship
- [report] Lab notes: no extra growth curve needed for young teams
- [report] Lab notes: a tuning sweep and a calibration test, both kept as is
- [predict] Predictions unchanged: the engine stays 3.0.0

### How it works
- New lab note: a win/loss skill rating and a margin model blended with the engine. On the one fully held-out season the blend was slightly worse, later gains were within noise, and accuracy didn't change, so the engine stays a single model (docs/engine/part12/ensemble.md) (#249).
- New lab note: a growth curve for rookies and second-year teams. Their misses drift the same way as veterans' as matches pile up, so there is nothing to add; a small late-season over-rating in every band is noted for the tuning pass (docs/engine/part12/growth.md).
- New lab note: a tuning pass over all 15 rating settings. Twelve were already on a plateau; moving the other three helped one season's playoffs and hurt thin-data predictions in the two later seasons, so nothing changed (docs/engine/part12/tuning.md).
- New lab note: a free-form (isotonic) final calibration. Not clearly closer in the 55–85% bands and slightly worse on Brier, so the one-number stretch stays (docs/engine/part12/isotonic.md).

## 1.2.9 — 2026-10-23

How it works arrives complete in the page itself, for search engines and slow connections.

### Highlights
- [report] How it works sends its full text with the page, not after the app loads
- [speed] Readable at once on a slow connection, before any script runs
- [fixes] One main heading on How it works, as search engines expect

### How it works
- **The whole page in the first response.** /methodology is built ahead of time from the same page component the app shows: every section's text, the version history, the limits and the settings now arrive in the HTML itself, so search engines read all of it without running JavaScript, and a slow connection can read it before the app loads. The app takes over as before once it starts, with the interactive figures. Its address, anchors (such as /methodology#accuracy), title and description are unchanged, it stays in the sitemap, and it has a single main heading. (#247)

## 1.2.8 — 2026-10-23

Prediction Engine 3.0: today's improvements, re-checked on every season since 2019–20.

### Highlights
- [predict] Engine 3.0: regional starts, today's form, overlap, slow fouls
- [report] Re-checked on every season since 2019–20, truer in six of seven
- [report] How it works and the version history name engine 3.0

### Predictions
- **Prediction Engine 3.0.** The engine changes shipped today (regional starting points, a bolder final calibration, form at the current event, slow-learning foul ratings and alliance overlap) were replayed together on every match since 2019–20, against the engine from before them. Stated chances came closer to what happened in six of the seven seasons; the seventh is the mostly-remote 2020–21 season with only a few hundred matches, where it was within noise. The gap between stated and actual win rates in the 50–80% range narrowed in every season and roughly halved in five of the seven. Winner-calling is about the same: the gain is in how far to trust each call. Win odds are the same as 2.11; this version marks the full check. The sign-off report is in the repository (docs/engine/signoff-3.0.md). Prediction engine 3.0.0. (#246)

## 1.2.7 — 2026-10-23

How it works gains a version history and says plainly where predictions are weakest.

### Highlights
- [report] How it works lists every engine version in one line each
- [report] Limits name the measured weak spot: thin data early in events
- [report] Lab notes add what the 2.7–2.11 engine work tried and rejected

### How it works
- **Version history.** A new "Versions" section lists every prediction engine release, newest first, with its date and one plain line on what changed. A test keeps it in step with the engine's own changelog, so a release can't ship without its line.
- **Measured limits.** "What the predictions can't know" now opens with the weakest spot the latest slice report found: matches where the robots have played little this season, and the first ten qualification matches of an event, carry a third of all prediction error. Every figure comes from the stored report, and a test checks each one against it. Two new limits: no defense rating for playoffs, and alliance overlap measured on the last two games.
- **Lab notes** add the 2.7–2.11 results (what shipped and by how much) and four ideas that were tried and rejected, with their numbers. (#245)
- The page names the engine version it describes from the running engine, so it no longer says "2.1".

## 1.2.6 — 2026-10-23

Two robots good at the same thing don't simply add up.

### Highlights
- [predict] Alliances of two robots strong at the same thing score a bit less
- [predict] Biggest change in auto, where two robots share one plan
- [predict] Playoff alliances stay as they are: partners are picked to complement

### Predictions
- **Ratings add; alliances don't quite.** Two robots both strong in auto, or both strong in TeleOp, get in each other's way. Measured on real alliances, they scored less together than their ratings added up to, most of all in auto. In a qualification match, an alliance now loses 25% of the weaker partner's auto and 15% of its TeleOp. Endgame showed no such effect, and playoff alliances are left as they are. On replayed matches, win odds improved in every season tested, most at the start of events, and predicted scores moved closer to the real ones. How it works explains it next to how expected scores are built. Prediction engine 2.11.0. (#244)

## 1.2.5 — 2026-10-23

Expected scores stop over-charging teams for fouls.

### Highlights
- [predict] Expected scores count fouls more realistically
- [predict] Foul-prone teams no longer predicted to gift huge penalty totals
- [report] Predicted scores closer to the real ones in 2025–26

### Predictions
- **Fouls learn slowly.** A team that gave away a lot of penalty points last week usually gives away far fewer this week: fouls are mostly luck and officiating. A robot's penalty rating now learns at 15% of the speed its scoring does, so it stays near the season average until a pattern really holds. The most foul-prone alliances had been predicted to give away about half again as many points as they did. On replayed matches, expected scores moved closer to the real ones (2025–26: average miss 27.7 → 26.6 points), and win odds are unchanged within noise. How it works explains it next to how expected scores are built. Prediction engine 2.10.0. (#243)

## 1.2.4 — 2026-10-23

Predictions watch today's matches too.

### Highlights
- [predict] A robot beating its rating today leans its next odds at that event
- [predict] Biggest help in a robot's first few matches at an event
- [predict] "Why" names a robot playing well above or below its usual level

### Predictions
- **Today's robot.** At an event, a robot that has been beating (or missing) what its rating expected leans its predictions for the rest of that event the same way: by 40% of its average miss there in auto and 20% in TeleOp, fading as it plays more matches there and capped so one wild match can't run away with it. Its rating itself is unchanged, and the lean resets at its next event. On identical replayed matches against the previous engine, the Brier score improved in both seasons tested (2024–25 by 0.00015, 2025–26 by 0.00018), about twice that for robots at their first event, with no slice worse. When the lean is notable, the match's "Why" says "Team 1234 is playing about 9 points above its usual level at this event". How it works explains it under "Five more things a rating knows". Prediction engine 2.9.0. (#242)

## 1.2.3 — 2026-10-23

Win chances say what they mean a little more exactly.

### Highlights
- [predict] Favourites' chances are a touch bolder, because they were a touch timid
- [report] Stated chances match how often favourites win more closely
- [predict] Never changes who's favoured, and nothing about alliance colour

### Predictions
- **A final stretch of the odds.** The engine was slightly too cautious: across the last two seasons, favourites it gave 70–80% won about two points more often than that. Every win probability is now stretched a little away from 50% (log-odds × 1.058). Checked month by month on matches after each fit, the gap between stated and actual win rates in the 50–80% range roughly halved in both seasons tested, and the Brier score improved. It can't change which side is favoured, so winner-calling is unchanged. How it works explains it under "A final calibration touch". Prediction engine 2.8.0. (#241)

## 1.2.2 — 2026-10-22

Sharper odds for teams at their first event of the season.

### Highlights
- [predict] First-event odds use how a region's teams are doing this season
- [predict] Last season counts a little more in a team's starting point
- [report] Stated chances land closer to how often favourites win

### Predictions
- **Regional starting points.** A team new to the season now starts from its usual point (last season's standing, or the rookie start) plus how far that region's returning teams have beaten or missed their own starting points so far this season, after their first three matches. The adjustment is shrunk heavily, so one or two surprising teams barely move it. On identical replayed matches against the previous engine, the Brier score (lower is better) improved in both seasons tested: 2024–25 by 0.00033 and 2025–26 by 0.00024, about twice that for robots at their first event. No slice got worse beyond noise, and the gap between stated and actual win rates in the 50–80% range narrowed. Winner-calling accuracy is unchanged. The How it works page explains it under "Four more things a rating knows". Prediction engine 2.7.0.
- **Last season counts a little more.** A returning team's starting point now carries 70% of last season's standing (it was 60%).

### Engine program
- **Error report by slice.** `npm run slices` replays every 2023–2026 match through the engine and reports accuracy, Brier and calibration by event phase, experience, data density, volatility and event type. `--challenger` compares an engine change against the live engine on the same matches, with intervals from resampling whole events. Reports are in `docs/engine/`. (#239)

## 1.2.1 — 2026-10-21

Projections even with no signal: a local estimate simulated on your device.

### Highlights
- [offline] Event projections with no signal, simulated on your device
- [predict] Labelled "Local estimate" with the real count, one tier lower
- [speed] Runs in the background with progress; never freezes the page

### Offline
- **Local estimate of an event's projections.** When the stored 10,000-simulation projection can't be had (no signal and your saved season doesn't carry one, or none has been made yet) and the season is saved for offline use, the Odds tab simulates the rest of the event on your device instead: 1,500 runs of the same engine, built with the same steps and the same seed the server uses for those results, in a background worker with a progress bar. It stops after 2 seconds of work on a slow phone and says how many runs it managed. It's labelled "Local estimate · 1,500 simulations on this device" wherever it shows, sits one confidence tier below the server's projection, never shows movement against the server's pre-event projection, and gives way to the stored projection as soon as that can be read. Each results state is simulated once per device and kept, so opening the event again doesn't run it again. On four replayed championships, its median ranks were within one place of the server's 10,000-run projection for every team. (#238)

## 1.2.0 — 2026-10-21

Event simulations spread erratic robots wider and no longer peek at later results.

### Highlights
- [predict] Erratic or new robots spread wider in event simulations
- [history] "Before the event" bonus RPs learn from earlier results only
- [live] Live projections use the same per-robot spread as score ranges

### Predictions
- **Per-robot spread in the event simulator.** Every simulated match score now gets match-to-match noise sized for its alliance the way the score ranges already were: wider when a robot's results swing more than the model expects, or when it has played only a few matches this season. It reaches the advancement odds, the partner what-ifs and the live projections. On 40 finished 2025–26 events cut at their midpoint, 86.6% of teams finished inside their projected 10th–90th percentile rank band (85.7% before). Prediction engine 2.6.0. (#237)
- **No hindsight before the event.** A "Before the event" simulation, and the pre-event projection that live projections compare against, now draws bonus ranking points from a bonus model fitted only on qualification results played before the event started. It used the curve fitted on the whole season. With too few earlier results it simulates no bonus RPs and says so. Live simulations use the same season curve as the match cards' bonus odds, and the note that bonus RPs aren't modelled now shows exactly when a simulation drew none.

## 1.1.9.2 — 2026-10-21

Partnership history on last season's predictions too.

### Highlights
- [predict] "Played 24 matches together" now shows on 2025–26 calls as well
- [history] Counted only through that season's end, never a later match
- [predict] On 2024–25 events and lab calls as well; the odds don't change

### Predictions
- **Partnership memory on earlier seasons.** A prediction for an earlier season (the Predict lab or an event of 2025–26 or 2024–25) now shows the same pair history line as this season's calls. It reads the pairs as they stood at that season's end, the way that season's ratings are its end-of-season ratings, so a later match never counts. Still a reason only: no odds, score or range changes, and no engine change. (#236)

## 1.1.9.1 — 2026-10-21

Report cards stay up to date for every season, not just the current one.

### Highlights
- [report] Report cards for past seasons catch up when a late result is scored
- [report] Live calls only, as always: the replay never counts
- [speed] Unchanged seasons are skipped: a quick check, not a rebuild

### Predictions
- **Report cards for every season.** A season's predictability report cards are rebuilt whenever its scored live calls change, after every stats run and every live result, whichever season the call belongs to. Before, only the current season was rebuilt between full recomputes, so a past season could show cards that missed its last scored calls. Seasons whose calls haven't changed are skipped after a quick check. A season is still rebuilt when one of its events turns final, or stops being final because a sync added a match or moved its dates. Live calls only, as always. (#235)

## 1.1.9 — 2026-10-21

Pick on reliability, not just peak scoring: a dependability estimate next to OPR.

### Highlights
- [picklist] Reliability next to OPR on pick lists, Compare and team pages
- [teams] Its parts in plain view: no-shows, DQs, near-zero matches, swing
- [workspace] Workspace members also see it with their own scouts' notes
- [predict] Predictions mention recent no-shows when they matter

### Teams and picks
- **Reliability index.** A 0–100 estimate of how dependable a robot has been, from qualification match results only. It counts no-shows, disqualifications, near-zero matches (the alliance scored about what the partner's OPR alone would), how much its estimated contribution swings, the penalties it gives away and how predictable its matches have been (from the report cards). A near-zero match isn't proof of a dead robot: defense or a partner carrying the alliance looks the same, and the page says so. Every part is pulled toward the season average as if the team had 10 more matches, and the sample size is always shown. It's on team pages, in Compare, on your shortlist and your workspace's pick list, in pre-match reports and in offline packs. How it works lists the rule. (#234)
- **With your workspace's notes.** Members of a scouting workspace whose match entries mark a robot broken, disabled or a no-show also see a second number that folds those notes in, clearly marked. Only that workspace's members see it: never other users, the public API, shared caches, page previews or offline packs.

### Predictions
- **Reasons beyond the factors.** A prediction now mentions a robot with 2 or more no-shows (or 3 or more near-zero matches) in its last 10, under the top factors, on saved and fresh calls alike. Words only: no odds, score or range changes. Prediction engine 2.5.0.

## 1.1.8 — 2026-10-21

Predictions now say when the robots have met before.

### Highlights
- [predict] "Played 24 matches together (16–8)" right under the factors
- [predict] Head-to-head records too: "9617 leads 13546 10–3 in 13 earlier meetings"
- [history] History back to 2019–20; recent partnerships offline too
- [predict] A reason only: on a season it had never seen, it didn't help the odds

### Predictions
- **Partnership memory.** When two robots in a match have played together or against each other, the prediction shows the strongest real fact under the top 3 factors: in match details, the match report and the Predict lab. Every result since 2019–20 is compared with what both teams' ratings expected at the time, so seasons with different games compare fairly. Pairs with only a few matches are pulled hard toward "no effect". We tested blending the history into the win odds: fitted on 2023–24 and checked on all of 2025–26, it made them slightly worse, so it doesn't change any number. The methodology page explains it, and `docs/partnership-memory.md` has the full test. (#231)

### Offline
- The offline pack carries a small cut of the history: same-alliance pairs with 3+ matches together this season or last (about 140 KB more). Head-to-head records and older pairs show online only.

## 1.1.7 — 2026-10-21

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

## 1.1.6.2 — 2026-10-21

Today's coin flips: the closest calls at every event on today, on the home page.

### Highlights
- [home] Today's coin flips: the matches the model calls 45% to 55%
- [predict] Every event that's on today, at its own venue's date
- [history] Played ones stay, with the result beside the call made before

### Home
- **Today's coin flips.** A new section on the home page gathers the matches on today's schedules, across every event that's on today at its venue, where the model gives either side between 45% and 55%. Those still to play come first, soonest first, each with both alliances, the odds on a close-up scale, the time at the venue, how long until it starts and its confidence tier; the closest call is marked. Played ones follow with their score and the call made before the match. Calls on thin data (a robot with fewer than 3 matches this season) are left out, and an empty day says why. Each opens its match page. Refreshed after every sync and live result, and every few minutes; an open home page keeps up by itself. (#226)

## 1.1.6.1 — 2026-10-21

Smooth scrolling across the site: jumps within a page glide there instead of cutting.

### Highlights
- [speed] Contents links, "see the odds" and match jumps glide to their spot
- [speed] Opening a page, or going back, still lands instantly where it should
- [speed] Reduce motion on your device and every jump stays instant

### Scrolling
- **Smooth jumps.** Every jump within a page now glides: contents and section links (How it works, Privacy, Terms, FAQ topics), the skip link, buttons that take you to a part of the page (an event's odds, live panel or stream, a linked match), the search palette bringing the page's search field into view, and the selected tab or chip in a sideways row. Scrolling with a wheel, trackpad or finger is unchanged: it stays the browser's own. (#233)
- **Pages still open instantly.** A new page starts at the top, and back or forward returns to exactly where you were, without sliding there from the old position. Dragging a pick to the screen's edge scrolls the page as before.
- **Reduced motion.** With reduce motion turned on in your device's settings, every jump is instant.
- **Sideways rows.** Swiping to the end of a sideways row (tabs, chips, a wide table) no longer turns into the back gesture, and scouting photo strips settle on a photo.

## 1.1.6 — 2026-10-21

Live projections: every live or upcoming event simulated 10,000 times, again after each new result.

### Highlights
- [predict] Projections: each team's likely final rank, with the range it lands in
- [live] Updated a few seconds after new results land, without reloading the page
- [predict] Playoff and advancement odds that move as the event unfolds
- [history] Once it's over: final seeds against the ranges they were projected in

### Predictions
- **Projections on the event page.** The Odds tab opens with a projection of the rest of the event: each team's median final quals rank with its 80% range (10th–90th percentile) as a whisker, today's rank, how far it has moved since the projection made before the first match, its chance to play in the playoffs (captain or picked) and its chance to advance, labelled "performance-based — awards can also advance teams". Sortable, your team and tracked teams pinned to the top, and headed with how many simulations it ran and after which match. Once the event is over it becomes "Final results vs projections": each team's actual seed against the range it was last projected in while quals were still open, and how many landed inside.
- **Simulated in the background, never on a visit.** A server job re-runs an event a few seconds after new results land (a burst of results is one run), stores the result, and tells open pages over a live connection; pages only read what's stored. The same results always give the same numbers. A very large event that would take over 10 seconds runs 5,000 simulations instead, and says so.
- **One advancement number.** The projection's odds are now the advancement odds everywhere they show: the event's rankings table and the records tables, the advancement simulator's team list and headline (with its award-inclusive figure alongside), the shortlist, and saved offline packs. Events never projected keep the forecast made the day before they started. (#229)
- **Checked on real events.** Replaying 40 finished 2025–26 events from their midpoint, about 86% of teams finished inside their projected 80% range (How it works → Live projections).

## 1.1.5 — 2026-10-21

How predictable each team has been, from the engine's own live calls.

### Highlights
- [teams] A prediction report card on team pages: how often calls were right
- [teams] How far its alliances landed from the predicted score
- [teams] Live calls only, with sample size, raw numbers and a warning

### Teams
- **Prediction report card.** Team pages show how the engine's pre-match calls on that team's matches turned out this season: the share called right, points vs prediction per robot (the alliance's miss split evenly between its robots) and the swing of those misses, with the field average beside each. Finished events get a row each, with how many calls had a predicted score and the raw numbers. Only calls logged before each match count, never the replayed history. Few calls say little, so every number is pulled toward the field average as if the team had 10 more calls, and the card says so. How it works explains the rules. (#232)

## 1.1.4 — 2026-10-21

Predicted scores come with a range now, and the range is scored in public.

### Highlights
- [predict] Every predicted score reads like 118 ±14: an 80% range
- [predict] Ranges widen for robots with few matches or up-and-down results
- [history] How it works shows how often real scores land inside the range

### Predictions
- **Score ranges.** Every predicted score now comes with its 80% range, written 118 ±14 (hover or tap for the range itself and what it means: about 8 in 10 real scores land inside). It's on match rows, match details, match reports, the Predict lab, the live panel, Watch live and the pit display, and offline from your saved pack. A range is wider when a robot has played only a few matches this season or its results swing from match to match, and narrower in playoffs. Prediction engine 2.2.0; win odds are unchanged.
- **Ranges are on the record.** Every call is logged with the range it stated, and How it works scores them like the win calls: the share of real scores inside the range, which way the misses went, the average width and each confidence tier. Calls made before this release stated no range and none is added afterwards. (#230)

## 1.1.3 — 2026-10-21

Model vs field: where the model's ratings and the seeding disagree most at an event.

### Highlights
- [rankings] Model vs field: teams the model rates well above or below their seed
- [predict] Every call with its numbers: rating, matches, OPR, record and confidence
- [rankings] Before quals, against each team's seed at its last event

### Events
- **Model vs field.** An event's Rankings tab now opens with the biggest gaps between the model's rating order and the official seeding: "the model rates them #3 of 28; they're seeded 18th". Each call shows the rating and its uncertainty, how far it is from the team the model places at that seed, the matches behind it, OPR, record, ranking points and a confidence tier, with the model's track record linked under it. Before qualification matches, ratings from earlier events are compared with each team's seed at its last event (and the label says so); a finished event uses the ratings as they stood at its last match. Small fields, ratings on few matches, and gaps the model can't tell from its own uncertainty are left out, and the section says why when nothing shows.

## 1.1.2 — 2026-10-21

Follow your team in Discord for the whole event, not just its matches.

### Highlights
- [alerts] The evening before an event: who's there and your team's season
- [alerts] Your schedule, with win odds for every match, the moment it's out
- [alerts] A recap at the end of each day: record, rank and live calls right

### Discord
- **More from /follow.** Besides the post before each match and its result, a followed team's channel now gets: the evening before the team's event (from 4 pm at the venue), where and when, how many teams, the team's season OPR and world rank, and the strongest teams there; the team's qualification schedule once FIRST posts it, each match with its time at the venue, side, partner and win odds; and, at the end of each event day, the team's rank and record there, its matches that day, and how many of its live calls were right. Each team gets its own schedule and recap post. (#224)

## 1.1.1 — 2026-10-21

A pit display for the TV in your pit.

### Highlights
- [live] Pit display: the whole event on the pit TV, no sign-in needed
- [predict] Up next with win odds, a countdown and the current rankings
- [teams] Your tracked teams in gold when you're signed in

### Events
- **Pit display.** A "Pit display" button on every event page opens a fullscreen screen for a pit TV or laptop: the event and the venue's clock, the match up now (or the last result, with whether the call was right), the next three matches with their win odds, a countdown to the next one (left out when the event runs behind, rather than showing a wrong time), the top 8 and a QR code to the event page. It updates by itself, shows "Reconnecting…" if the connection drops, keeps the screen awake where the browser allows it, and fits 1920×1080 and 1366×768 with no scrolling. Signed in, your tracked teams show in gold and your next match is pinned. (#218)

## 1.1.0 — 2026-10-21

Watch an event's stream with the model calling every match beside it.

### Highlights
- [live] Watch live: the event's stream with live predictions beside it
- [predict] See each call, then whether it was right, the moment a match ends
- [live] A LIVE dot on events you can watch right now

### Events
- **Watch live.** When an event has a stream, its page gets a "Watch live" button and a section above the matches: the YouTube stream (it loads only when you press play, from YouTube's privacy-enhanced player) and, beside it, the match the model is calling now, with its win odds, predicted score and confidence. The moment a match finishes it shows the result and whether the call was right, then moves to the next one, with the three after it below. After the event the stream stays as the recording. On phones the stream comes first and the calls below it. (#219)
- **LIVE dot.** Events that are on now and have a stream show a red LIVE dot in the events list.
- **Owner portal › Streams.** The owner sets an event's stream from a YouTube link (watch, youtu.be or /live/ links); anything else is refused with the reason, and nothing is saved.

## 1.0.9 — 2026-10-21

Control Scout comes to your team's Discord server.

### Highlights
- [share] A Control Scout bot for your team's Discord server
- [predict] /predict: win odds for any qual match, and how played calls turned out
- [teams] /team, /event and /rankings answer right in the chat
- [alerts] Follow your team: a post before each match, and its result

### Discord
- **The Control Scout bot.** Add it to your team's server and anyone there can ask `/team` (record, OPR, world ranking, next event), `/predict` (win odds as bars, predicted score and confidence for a qualification match; once it's played, the final score, what was predicted and whether the call was right), `/event` (status, progress, top 5 by OPR, the winning alliance) and `/rankings` (the world top 10 with movement). Every answer links back to the page it came from, and the numbers are the site's own. Event names and codes autocomplete. The invite link is in the FAQ and footer. (#216)
- **Match alerts in your server.** Someone who can manage the server types `/follow team:18360` in a channel, and the bot posts there 15 minutes before each of that team's matches (lineups, win odds, predicted score) and again with the result and whether the call was right. `/unfollow` stops it, `/following` lists a server's teams (up to 10), and `/help` lists every command. My teams and My team have an "Add to a Discord server" button with the `/follow` command ready to copy.

## 1.0.8.1 — 2026-10-20

More of each page on a phone screen: match lists, tabs and the bottom bar take less room.

### Highlights
- [live] Phone match lists show both alliances side by side
- [speed] A slimmer bottom bar on phones, so more of each page shows
- [rankings] Page tabs and toggles take less room on phones

### Phones
- **Match lists.** On a phone 390 px wide or more, the red and blue alliances of each match sit side by side, facing each other with the scores in the middle (as on a laptop), instead of stacked. About five matches fit on screen instead of three and a half. The narrowest phones (320 px) keep them stacked. Event Matches tabs and team pages both get this. (#221)
- **Bottom bar.** 52 px tall instead of 60, and everything that sits above it (sticky buttons, the cookie and install notes) follows one shared height.
- **Tabs and toggles.** Page tabs (an event's Matches / Rankings / Insights…) and segment toggles (All / Quals / Playoffs) are tighter on phones, so more tabs show before the row scrolls.

## 1.0.8 — 2026-10-20

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

## 1.0.7 — 2026-10-18

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

## 1.0.6 — 2026-10-16

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

## 1.0.5 — 2026-10-16

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
