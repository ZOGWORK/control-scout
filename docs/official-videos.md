# Official event videos

Scout plays an event's recording from the organiser's own YouTube channel when FIRST's event page doesn't link one,
or links only one day of it. No video is hosted, downloaded or re-encoded: only YouTube ids are kept, and every video
plays through the same YouTube embed as FIRST's own links.

## What counts as official

A channel is official for an event when it is one of:

- the FIRST partner organisation for the country or region (Nație Prin Educație for Romania, NY Excelsior FIRST,
  FIRST in Texas, FIRST Chesapeake, FTC Iowa, FIRST Nevada, MT Robotics Alliance for Montana, BCA Activities for
  North Dakota's "Dakota FTC", …). FIRST Nevada posts each meet as an upload a few days later, its title starting
  with the meet's date ("2026-01-10 FTC League Meet # 4S - Southern Nevada"): the checked list takes that date as the
  day, and the watcher, which needs a broadcast date, sends such uploads to the owner. FIRST Indiana Robotics streams
  its events on Twitch and uploads each a few days later, its title naming the event and its date ("2026 FTC Greenwood
  QT (02.21.26) - Part 1"): the checked list takes them the same way (2020-21 to 2025-26, 25 uploads, checked
  2026-11-15), leaving out its two-day "State Championship Day 1/Day 2" uploads (the FRC championship; FTC's is one
  day) and its FRC off-season events (Boiler Bot Battle, Monster Match),
- the event's own organiser or league (NTX FTC for FiT-North, GEARS for the Michiana Premier Event, NorCal FIRST
  Tech Challenge for Northern California's events (watched for those named "NorCal …", as every one is from 2026-27;
  older ones were checked by hand), …),
- the event's own streamer: the channel that carries the event's broadcast with FIRST's official overlay (match
  label, teams, scores and rankings on screen). Westwood Robotics (FRC 2583, Austin) streams FiT-Central's GEMS
  league (Diamond and Emerald) and its Austin events. Its overlays-only test stream and the 2023 "Round Rock Gems"
  titles (the events are listed in Austin) are left out,
- the event's own streamer, where FIRST's event pages or the host name it: Stars of the Galaxy (FTC 12099) for the
  Central Ohio league in Columbus, and the FIRST Alumni Network Grand Valley for the West Michigan league at GVSU in
  Grand Rapids (watched for those events only; FANGV's Robot in 3 Days streams are FRC and never used), FTC SoCal
  League G for League G's meets in Carson, SoCal FTC's own live channel (@FIRSTsocalftclive, a channel of its own,
  watched separately from @Socalftc) for its inter-league tournaments ("ILT #6" is Scout's "SoCal FTC Qualifier 6")
  and the Los Angeles championship at Monrovia, 7419 Tech Support, which streamed NorCal East Bay Meet 1 of 2026 from its
  own school (linked once, not watched), and in Oregon Overcharged (FTC 12599) for the Rose City League and Leo RHS
  Robotics (Roseburg HS) for the SOAR League, whose streams FIRST's own Oregon event pages link (each watched for its
  own league only),
- the region's delivery partner or its event streamer in Rhode Island (Rhode Island FTC), Ontario (FTC Ontario),
  Long Island (FIRST Long Island) and New York City (NYC FIRST, the channel FIRST's 2021-22 NYC pages link, under its
  current handle). Town of Penfield Television is watched for upstate NY Excelsior events only: its videos are
  edited uploads of days NY Excelsior FIRST's own recordings already cover, so none is linked. A title whose own
  date or number disagrees with the broadcast is left out,
- or the channel FIRST's event page names as the livestream (FIRST HQ's "FIRST Tech Challenge" channel carries the
  2026 Championship's division broadcasts, and FIRST's own event pages link its Day 4 videos).

Any other team's channel (one that isn't the event's own streamer), a spectator's upload, a re-upload or a local TV
broadcast is never used, even of the same event.
`server/data/officialVideos.json` lists the channels each kept video came from.

Regional streamers from the owner's audited list (2026-11-14), each read through the YouTube Data API's uploads list
and checked by hand: FIRST in Missouri (the Missouri/Kansas partner: St. Louis, Southeast and Southwest leagues, the
championship), FIRST MOKS (Kansas City, one video per meet session), Tulsa Robotics Center (eastern Oklahoma's
leagues, its scrimmages, the state championship), SeaCow Robotics (its Mountain Home, Benton and Bentonville
qualifiers) and Shiloh Saints (the Arkansas Championship), both already played from FIRST's channel links, and FTC
Louisiana (every Louisiana event, uploaded after it was streamed elsewhere; only its championship title counts as
naming the region, so a qualifier stream needs its city).

From the same list, CircuitRunners Robotics (FTC 1002, a team channel that is the event's own streamer) streams
Georgia's Marietta-Wheeler league and its Northwest League Tournament (that day is in two broadcasts, named Part 1 and
Part 2 in broadcast order), and Microchips & Queso its own Queso Bowl in Texas (FTC 23350, the event's host). Sharpe
Pursuits' one FTC stream, the 2026 North Carolina Championship, is FIRST's own link for that event, and the channel
(an event company) isn't watched.

The owner's audited channel list (2026-11-14) adds four FIRST delivery partners: USTEM Foundation (Kazakhstan),
Robotique FIRST France, Associazione Artù APS (Italy) and the Fikret Yüksel Foundation (Türkiye). It also adds The
PRC Channel, the school channel that streamed Thailand's 2025 championship. That's its only event so far, so it's the
weakest entry on the watchlist, and the owner can remove it if no second event follows. The second Italy channel
(@ftc-italy) is not added: it has only webinars so far.

## How a video is matched to an event

A video is kept only when all of these hold (`server/data/officialVideos.json` was built this way, with the two
exceptions rules 2 and 7 name for the checked list only, and the auto-watcher uses the same rules):

1. It's on an official channel, it exists, it's public, it can be embedded, and YouTube doesn't block it in most
   countries.
2. It's a live broadcast whose start, at the venue, falls inside the event's dates in Scout: FIRST's listed dates,
   widened to every day the event played a match (`server/videos/eventDays.ts`; FIRST lists KZCMP 2022 as 23 to 25
   Feb 2023, and it played its last qualifications and its playoffs on the 26th). An upload has no
   broadcast date, so it can't prove its day, and is left out. The checked list makes one exception, by hand: an
   upload whose title names its date (FIRST Nevada's "2026-01-10 FTC League Meet # 4S - Southern Nevada") and, where
   a venue holds several meets that day, its session (FIRST MOKS's "FTC Meet @ Belton 8AM (2026-11-7)" is "Belton
   Meet @ 8 AM"), an upload of a one-day event its title names, or an upload of an event that played every match on
   one day (Scout's match times say which; FTC Louisiana's two-day qualifiers play on the Saturday).
3. Its title names the event: a distinctive word of the event's name or city (the league, the venue, "Mockingbird"),
   or the event's designators (an NTX league letter, a meet number, a qualifier or ILT number, a UIL class, a stage). An event named by an
   acronym ("APOC") also fits a title spelling it out in words in a row ("Asia Pacific Open Championship"); a common
   one ("FTC") never counts. A state or region name alone counts only for that region's one championship on that date.
4. Where the event has divisions, the title names the division ("COANDĂ", "Franklin", "Black"), and a division video
   never goes to another division or to the parent event. A parent event gets only a video that names no division
   (Romania's Finals & awards stream).
5. Where the title names a day, the days follow the broadcast dates in order (an event listed with a setup day first
   has its "Day 1" on its second date; that offset must be the same, or keep increasing, across the event's videos).
   Where the title names a weekday or a date, it must be the broadcast's. The one exception: a live broadcast whose
   title's date is a slip, up to 31 days either side of the broadcast (a day, a week or a month off: NYC FIRST's
   "Championships 2/3/24" streamed on 3/3, NTX's "Meet #3 (2025.01.11)" streamed on 01-18), when the event the title
   names by its own words or number doesn't run on the title's date at all. The broadcast's date is YouTube's record;
   the title's is typed. More than 31 days off (a year off, say), an upload, or an event that also runs on the
   title's date (a re-stream of its other day) stays for the owner.
6. The title fits exactly one Scout event. Two events that fit equally (two league meets that day, AM and PM halves of
   one meet) mean the video is left out.
7. The event doesn't already play a video for that day: FIRST's link, a short link's video, a channel's broadcasts, or
   the owner's stream. A day with two videos is kept only when the titles name the parts (the awards ceremony, the
   eliminations, "Matches 1–5" and "Matches 6–14"). The one exception, in the checked list only (the watcher never
   does it): a broadcast restarted on the same channel that day, with identical titles, where the second broadcast
   starts after the first one ends. Both are kept as Part 1 and Part 2 in broadcast order (NYC FIRST's 2025-26
   Qualifiers 6 and 11 and Super Qualifier 2, its 2024-25 Super Qualifier 1 and its 2023-24 Qualifier 3; NorCal's
   2021-22 Santa Clara QT; 7419's East Bay Meet 1 of 2026). Titles that differ count only when both name the same
   event and the second starts at most 30 minutes after the first ends (Montana's 2023 State, "MT FTC Championship
   2023" to 23:13:53Z, then "MT FTC State 2023" from 23:15:48Z). A second broadcast that overlaps the first, or one
   the event's FIRST link already plays, is still left out. A day whose video the event already plays without a part
   (FIRST's link, or the watcher's add) and a second video of it naming one ("matches only") gets the part from the
   list: Chicago Robotics Invitational 2026 has a "Matches" video and a "Full stream" each day, Sunday's full stream
   being FIRST's own link.

Per-match clips are never mapped from a title outside FIRST's own per-match videos (the Championship's are already
FIRST's match videos, `matches.video`). A recording never hides FIRST's per-match video or a verified contributor's
link: it's the fallback, the clip of the match inside the day's broadcast.

## How it plays

`server/videos/officialVideos.ts` writes the list into `official_videos` (migration 83) once per video, at boot. The
recording path (`server/videos/recordings.ts`) treats each kept recording as one day of the event's broadcast: an event
without FIRST's link gets its first day as its video; every other day joins it, in broadcast order, and the event
page's Watch section shows a button per day ("Friday", "Saturday", "Sunday · Awards"). Each match links to its second
in its own day's video when YouTube's timing for that video holds (the same checks as FIRST's links).

When FIRST's link is a channel's page (`server/videos/channelStreams.ts`) and two events that day give the same one
(West Michigan's Meet 5 and Meet 6, both "@firstalumninetworkgrandvalley/streams"), a broadcast whose title names one
of them by its designator ("Meet 6") is that event's only. A title naming neither stays with both.

FIRST's link (or the video its short link led to) is the event's video only when YouTube's broadcast date fits the
event, a day either side at the venue (`linkAiredOff`, `server/videos/officialVideos.ts`). One broadcast on another
date is another event's stream or a test: 2024's USORSOM3 (2025-01-11) was given USORSOM2's stream of 2024-12-14.
It isn't played for that event, and the channel audit doesn't count it as that event's record, so the video is decided
like any other upload; the event plays its kept recording if it has one. Owner › Official videos lists each such link
under "FIRST links not used", with why (nothing to do: FIRST's data, not a decision). A link whose broadcast start
isn't known yet (an upload, facts not read) is kept. Measured on a copy of the live database (2026-11-16): 6 of 480
links, among 413 with a known start; a championship's link to one of its divisions' streams that day fits and is kept.

A removed row (`removed_at`) is never written again, so taking a video out sticks.

## Highlights

In the events list, a parent event shows the best video of its divisions ("Match clips" over "Video"): FIRST links each
division's stream, so a parent is rarely filmed itself, but its divisions are what a visitor filtering for video wants
(`seasonVideoKinds`, `server/videos/recordings.ts`). It still has no player of its own.

A highlight (`kind = 'highlight'`) is a short reel from the same official channels. It's shown on the event page as a
highlight only: never as a match's video and never as the event's recording. The event page's "Highlight videos"
section (`src/components/HighlightVideos.tsx`) labels each one and plays it in the app's video dialog
(`playInDialog`, `src/lib/streamSeek.ts`), never in the Watch section's player, even when the event has a recording.

## The auto-watcher

`server/videos/officialWatch.ts` reads each watched channel every 6 hours with the YouTube Data API. It reads only
the channel's own uploads list (`playlistItems` on its `UU…` playlist, then `videos` for the new ones). It **never
searches YouTube**. It needs `YOUTUBE_API_KEY`, and without one it doesn't run. The scheduler checks every 30
minutes and starts a run only when the last one is 6 hours old, so a deploy doesn't add runs.

- **Watchlist** (`official_channels`, migration 84): seeded once each from `server/data/officialChannels.ts` with the
  channels the checked list came from. Each channel has a region rule (`country=Romania`, `state=VA,MD,DC`,
  `country=USA;type=Premier,OffSeason`, `state=IN;name=michiana|gears`), the region's own words (too common in its
  titles to count as evidence) and, optionally, a pattern for titles that name the region itself. Each run reads a
  channel's uploads back to the earlier of the date it started being watched and 180 days ago (`LOOKBACK_MS`), up to
  10 pages of 50. A stream is listed when it's scheduled, often weeks before it airs, so a cut at the watch date alone
  skipped every stream scheduled before it, for good, once it aired (the 2026-11-13 audit found 55: FTC Iowa's league
  meets, Pennsylvania's championship, Arizona's qualifiers). A video already read, or already an official video, isn't
  read again. The owner adds, edits or removes channels in Owner › Official videos, and a removed channel is never seeded back. A seeded
  channel's title pattern follows that file on the next start (added, narrowed or dropped), unless the owner has
  saved or removed that channel (their row stands).
- **Each new video, once** (`official_watch`): it gets matched with the list's rules (`server/videos/officialMatch.ts`).
  A recording is **added** (`official_videos`, source `watcher`) only when all of these hold:
  - it is a finished live broadcast of at least 45 minutes, public and embeddable, and not blocked in 50 or more countries;
    or a full-length upload dated by its title (one date: "January 17, 2026", "1/17/26", "12_17_23", "Tournament
    12/13" read against when it went up), or, with no date in its title, one that went up within 14 days of a one-day
    event whose whole name its title says and that joins no two names ("Meet 1 & Tournament");
  - it fits exactly one event of the channel's region on its broadcast date at the venue (an upload: that date);
  - the title agrees on the division, designators, date, weekday and day number. Taken one at a time, a title's
    "Day N" must be the event's own day N: its Nth day from its first, or the Nth day it played a match (RONR4LT
    2023 is listed 7 to 9 March 2024 and played on the 9th and 10th, so its "DAY 2" is the 10th). A title naming two meets or qualifiers ("Meet #3 / Meet #4") is two events;
  - the event has no video for that day yet (a second video of a day is kept only when both name their parts, such
    as "Matches" and "Awards"), and none whose day isn't known yet. Another programme's stream at the same venue (FIRST
    Global, a drone or simulator contest) is set aside, and "Meeting" or "Sports Day 2026" no longer reads as a meet or a
    day number.

  A video the event already plays for that day, or one that is already some event's video (FIRST's link, a short
  link, a channel broadcast, the owner's stream), is logged as a **duplicate** and never added or queued.

  Anything short of that goes **to review**, with the reason and the event it fits best, unless the rules settle it
  from the same facts. These are **set aside**, each with its reason, and never wait on the owner:
  - a title that isn't a competition stream: webinars, kickoffs, coach calls and Coaches Corners, program calls,
    meetings (a council, a committee, a legislature), keynotes and conference sessions, Robot in 30 Hours and robot
    reveals, recaps, ranking and prediction shows, gaming-league streams, FRC (by name or by its games: REBUILT,
    REEFSCAPE, CRESCENDO, …), FLL, FGC, VEX, drones, simulators (UrSim, xRC);
  - a team's robot video: "Snapshot", "Reveal" or "Robot showcase" beside a team number (3 to 5 digits, not a year)
    in a title that names no event ("Compact Differential Swerve Drive | 23334 Axiom | FTC BIOBUZZ Snapshot"). The
    title settles it, so it needs no facts;
  - a video under 45 minutes, whatever event it fits: a clip or highlight, never a day's recording (the owner can
    still add it as a highlight from the set-aside list);
  - a video that doesn't play here: private, unlisted, embedding off, or blocked in 50 or more countries;
  - a broadcast with no Scout event in the channel's region that day or a day either side (one a day off, such as a
    stream scheduled the day before Scout's date, goes to review);
  - one field's stream ("Field 2") or one named division's ("Flowers Division") of an event Scout keeps as one event:
    its divisions or fields played at once, so a clip would open on whichever covered its time.

  Parts are read from the title too: Awards, Finals, Playoffs, Eliminations, Morning, Afternoon, Before and After
  lunch, "Matches 1–13". "Qualification & Playoff matches" is the whole day's matches, not a part. A title naming the region itself ("FTC Iowa …") makes all its events that day
  plausible, so when the title also names one event by its own word or designator ("Iris", "Waterloo", "Meet #1" and
  not "Meet #1a"), the events it fits by the region's name alone drop out. Two events sharing a word ("CTX GEMS
  Diamond League Meet 2" and "… Emerald …") are told apart the same way: an event whose name has a word the title
  doesn't say ("Emerald"), while the title says a word of the other's name ("Diamond"), drops out when the event left
  outscores it. A title naming two events (a joint meet) stays in review.

  Every video read ends in exactly one state, its reason in `official_watch.why`: **added** (every check passed),
  **pending** (the owner's review), or **set aside**, **duplicate** or **rejected**. The only videos not written yet are
  ones still live or still to come (read again every run until they end) and ones YouTube returns no facts for yet
  (read again next run).
- **After a recording is added** (by the watcher, or by the owner's approval), every `onRecordingAdded` listener
  (`server/videos/officialWatch.ts`) gets each event, day, part and video, once per run. It's the hook for
  follow-up work. Clip coverage (`checkClipCoverage`, `server/videos/coverageCheck.ts`) is checked by the 5-minute
  recordings pass once the new video's facts are read (and after a watcher run that added one), not inside the add or
  the owner's approval: the clips need those facts first. A failing listener is logged and never undoes the add.
  Each event left with a gap is triaged by the server (`server/videos/coverageTriage.ts`): Actionable (a match left out
  by the clock alone: an early start, or a time before or after the broadcast, the cut start, the video's end, what its
  chapters confirm, every recording; or no reason found, or no list), No timing, Early start / unsafe (only once the
  video's frames show the match starting while the one before is still on: `earlyStart` in
  `server/data/frameTimings.ts`), or Old season (applied when read, from the current season, so it follows the September rollover). Only Actionable
  events are Owner › Clip coverage's "To review"; a reviewed event opens again only when its missing list changes to an
  actionable one, never on a deploy or refreshed facts alone. Bulk Reviewed (a category, "all non-actionable", or a
  season: its non-actionable events unless "Include Actionable" is ticked) asks first with the count and is audited
  (`clipCoverage.bulkReviewed`).
  The stream is the truth, not the clock: a match left out by the clock alone is said as what its video showed, read off
  its frames (`CoverageMatch.video`): "Not yet checked against the video", "Checked in the video (date): no start found
  for it", "seen at h:mm:ss, not yet confirmed", with the video's own timestamps of the matches around it. The clock's
  reading is kept apart (`CoverageMatch.clock`) and is never a reason on its own.
  Zero-error brief (2026-11-15), journey 5 and the coverage half of 7: "To review" holds only matches checked against
  the video itself (its frames read), each saying what was checked there and what was missing. A match left out by the
  clock alone whose video isn't read yet is a pending check, "Not yet checked against the video", with its own count in
  any season; it's never in To review, never marked reviewed (one or bulk), and moves on once its frames are read. Each
  check pass logs events checked, fully clipped, matches clipped and missing, and the missing by what their video check
  found; the console shows the last pass (kv `clip-coverage:last-pass`). Every missing match the frames saw in the video
  (`video.seenAt`) is a finding in the console, with its video, second, event and why, whatever its review; so is every
  clock-placed clip pulled because its first frame showed another match (`clipCheckFindings`, server/data/clipChecks.ts),
  with the frame checks' totals beside the last pass. A finding stays until a pass clears it (its clip placed, or a
  re-read shows the match isn't there); there's no Reviewed for it. The pending checks read as work in progress: after
  each pass, the matches still waiting for their video check across every stored event (`CoveragePass.pending`) are
  counted, with the pass before's count (`pendingBefore`), and the console says how many fewer.
- **The owner's queue** (Owner › Official videos, with an "N to review" badge on the console's menu), oldest first. Each
  row shows the title, channel, video id, published and broadcast times, length, the best-guess event and why it
  wasn't added:
  - Approve a video as a day's recording (season, event code, day at the venue, and optionally a part of the day) or
    as a highlight. The server checks the event exists, the day falls within it and the day isn't already taken.
  - Reject a video.
  - Remove any official video from its event.
  - Every action is in the audit log (`officialVideo.approve`, `.reject`, `.remove`, `.runNow`,
    `officialChannel.add`, `.edit`, `.remove`).

  An added, approved, rejected, duplicate or set-aside video is never proposed again.
- **Runs** (`official_watch_runs`): each run logs its API units, channels read, new videos, adds, queued videos and the
  error that stopped it, if any, and the duplicates it logged. A run uses at most 1,500 units (YouTube allows 10,000 a day, and the timing backfill
  shares them) and stops when YouTube says the quota is spent. A channel's own error is kept on its row. The panel
  shows the last run, the units used today, the next run and a Run now button. Run now refuses within 10 minutes of
  the last run. Every write of the watcher's takes the data writer lease (`server/data/lock.ts`), the same one the sync
  and the live lane share; YouTube's reads happen outside it. When the sync holds it for 3 minutes or more the run
  doesn't start, or stops as "database busy", and that run doesn't count toward the 6-hour wait, so the next
  half-hourly check runs it again. The checks start 7.5 minutes after boot, midway between the sync's 5-minute ticks and
  before the startup sync. Every deploy restarts the server and starts the wait over, so the first check comes early:
  at 17.5 minutes, a morning of deploys every 10 to 15 minutes (17 Nov) kept a run due at 10:27 from ever starting.

## The channel audit

`server/videos/officialAudit.ts` runs after every watcher run (scheduled, or Run now). It compares each watched
channel's whole uploads list, video by video, with Scout's records. It reads only the channel's uploads list
(`playlistItems` on its `UU…` playlist, `snippet,contentDetails` for the titles, then `videos` for the facts). It
**never searches YouTube**.

- **What it reads.** Each upload is stored once in `official_audit_videos` (migration 91).
  - Every run reads each channel's newest page, and keeps reading only while a page is all new.
  - Each channel's whole list is read once a week, the channel read longest ago first. A video no longer on the list
    at a full read is marked gone (`gone_at`).
  - Facts are read once per video, and only for one that may be a competition and that Scout has no record of. The
    watcher's own adds have their facts read every run. A facts call that fails (a 5xx, a timeout) is tried once
    more in the same run; if it fails again, or answers a 4xx (which a second try wouldn't change), its 50 videos are
    read next run.
- **Quota.** About 1 unit per channel a run (63 units), plus 1 per 50 new uploads that need facts. The weekly full
  reads add about 700 units a week: 34,447 uploads on 63 channels, measured 2026-11-15. That comes to under 600 units
  a day. An audit uses at most 800 units (`AUDIT_MAX_UNITS`), and what it doesn't reach waits for the next run.
- **What Scout has for each upload** (`record`): the checked list, the watcher's add, the owner's add, FIRST's event
  link, the event's short stream link, the channel's broadcasts, or the owner's stream (each of these plays on an
  event); or the watcher's row (in review, set aside, a duplicate, rejected), or removed by the owner.
- **An upload Scout has nothing for.** The watcher's rules run on it (`matchVideo`), with its best-guess event and what
  that guess rests on (`bestGuess`: among the region's competitions from 21 days before its date to the day after,
  the one whose name, city and designators the title shares most, nearest the date on a tie). Then it is one of:
  - **Set aside, with the reason.** The title says it isn't a competition ("the title says "FRC""), or the title names
    no competition. A short upload can't be a day's recording. A private or deleted video gives no facts. One the
    channel has made unlisted since it was listed is off its public list, which is all the watcher reads: set aside,
    not a miss.
  - **Not read by the watcher yet.** It's in the watcher's window but went up or ended after the watcher's last run,
    or it's live. The watcher's next run reads it.
  - **Added by the audit.** Every check of the watcher's passes and its event's day and part are free (`settle`): the
    audit adds it as the watcher would (`record`, `decided_by` "channel audit", counted in the run's `added`), and from
    the next run checks it with the watcher's own adds. An upload qualifies only when the watcher's upload rules date
    it (above).
  - **A watcher miss.** It's in the window, older than the watcher's last run, and the watcher has no row for it. It
    counts in the run's `missed`. One that passes every check is added (above); any other becomes a finding at once,
    and if a watcher run after that still has no row for it, it goes to the review queue with why.
  - **Set aside by the audit.** It's older than the window, but it can't fill a day Scout has no video for. That's
    a broadcast on a day with no Scout event in the region, an upload with no event to put it on, or one whose event
    (its own, or its best guess) already plays a video for each of its days (`everyDayPlays`). The reason says which.
  - **A finding.** It's older than the window and may be a recording Scout lacks: a "review" verdict whose event has
    a day with no video. It shows in
    Owner › Official videos with its verdict, why and best guess. The owner sends it to review (`officialVideo.auditQueue`)
    or says why it isn't a recording (`officialVideo.auditDismiss`, reason required), and it's never opened again.
- **The review queue and the watcher's set-aside rows, decided again every run** with today's rules: a rule learned
  since decides what it can. One in review that the rules now set aside leaves the queue (`official_watch` ignored or
  duplicate, `decided_by` "channel audit", its why starting "set aside by the channel audit"); one in review or set
  aside that now passes every check is added. Whatever still needs a judgement stays in review. A title that isn't a
  competition's decides it without facts being read. Two videos that pass every check for one event's day and part in
  the same audit (a live broadcast and its upload, an early stream beside the main one) are both left in review.
- **The watcher's own adds**, checked every run (`official_audit_adds`). Each is checked for these:
  - it's still on its event, public, embeddable, and blocked in fewer than 50 countries;
  - its title is an FTC competition stream's;
  - it was broadcast on the day it's on, at the venue, and that day is one of the event's;
  - the rules still pick only that event;
  - no second video plays that day unless both name their parts.

  A wrong add is listed with what's wrong. One that the watcher's title rules set aside today (a rule tightened since,
  such as drone or FRC streams) is taken off its event by the audit, as the watcher would have left it. It's logged as
  `officialVideo.remove` by "channel audit" and still counts as a wrong add. The owner removes any other wrong add.
- **The link check** (`server/videos/linkCheck.ts`, before each of the watcher's 30-minute checks). Every recording
  linked by the checked list or the watcher is checked again against YouTube's facts (`video_meta`) and its title on
  its channel today (`official_audit_videos`). It's taken off its event when:
  - it never aired: YouTube's facts, read after a day past the event's last day, still list it as live or to come
    with no start (facts read before then prove nothing);
  - its title now names one meet number and the event's name another ("Meet #1a" counts as meet 1; a title naming
    two meets is no call).

  A channel can reuse a scheduled stream for a later meet: FIRST in Missouri's `qM3qo5rrmyc` was listed for
  Camdenton Meet #1 (2026 USMOKSSWM1) while still to come, never aired that day, and became its "Southwest League
  Meet #2 … November 21" stream. It's logged as `officialVideo.remove` by "link check". A video taken off is freed:
  its link row goes, and it's set aside in the watcher's list (decided by "link check"). The channel audit decides
  that list again each run, so once it airs as the meet it names it's added there, or the owner approves it. The
  checked list's seed never writes it back. The owner's links and links
  from evidence are decisions on what the video shows, and stay.
- **Best guesses in review.** Every video in review or set aside whose verdict names no event gets a best guess
  (`official_watch.guess_why`). New rows get it when the watcher reads them; older rows get it at the next audit.
- **Runs** (`official_audit_runs`): units, channels read and read in full, uploads, those with a Scout record, set
  aside, open findings, watcher misses, queued, and the adds checked and wrong. Each channel's counts are in
  `official_audit_channels`: uploads, with a record, without one, playing on an event (every season, and 2026-27
  alone), and open findings.
- **Owner › Official videos › Channel audit** shows the last audit and its error, the uploads with a Scout record,
  the watcher misses, and the watcher's own adds over its last 10 runs and its last 100 videos read (added, wrong, not
  checked yet). It also lists the wrong adds, the findings, each channel's counts and the set-aside reasons.

## Decisions from evidence

What the rules can't decide is decided by checking each video, not by the owner (`server/data/videoDecisions.ts`,
applied by `server/videos/videoDecisions.ts` once a process after the checked list). Before an entry is written, the
question is whether the watcher could have decided it from the same evidence; if so, the rule is taught instead, and
the entry is left out. Each entry says what the rules say on their own (`rulesSay`): the cases left need the video
itself (frames: an overlay naming the event, an FRC field, one field of two), its description (the date of an
undated upload), or which Scout event a title means when the names differ. 134 entries are left (78 link, 7 reject,
49 set aside), of the 395 videos decided on 2026-11-16; the rules decide the other 261 the same way.

Taught to the rules from those decisions (each a group of 5 or more decided one way, and checked to add nothing a
decision turned down): an NTX league pair's tournament ("C&N-League Tournament" is Scout's "C&N Tournament"); one meet
over two same-day meets told apart only by a letter or AM and PM (two events in one video); an undated upload of a
multi-day event, a ceremony alone or one division's stream (which day, or which division, can't be told); a title
naming no event when every event that day was played remotely (2020-21: no matches played together); "FTC Events" for a
date (that day's several events in one video); and a broadcast whose title's date is a slip (rule 5).
Each entry is one video: **link** (to an event, its venue-local day, and a part only when the video's own title names
one), **reject** (not FTC: FRC, FLL, FGC, a simulator, a meeting, a webinar, with which) or **set aside** (FTC, but not
a day's recording Scout can play: a clip, unplayable here, a second copy of a day that already plays, two events or
two simultaneous divisions in one video, no Scout event to put it on), with its reason and one line of evidence: the
title and description, the broadcast date against the event's days, the length, and frames read from the video
where those leave it open (the FTC Live overlay names the event and match).

- It lands as an owner's decision would: `official_watch` approved or rejected, `decided_by` "evidence", its why
  saying the decision and what was checked; a link in `official_videos` with source "evidence". An audit finding gets
  its queue row from the audit's facts, and the finding is settled (a link is a record; anything else is dismissed
  with the reason). Owner › Official videos shows each as "Decided from evidence", with its why.
- A decision never overrides one already made (the owner's, the watcher's). A link is written only on a free day of
  its event, or one held by a video YouTube no longer plays that it names in `replaces` (a stream deleted and
  uploaded again), which comes off the event. One whose event isn't in the database is logged and left.
- Two videos of one day only when both titles name their parts, and never two simultaneous streams (two divisions
  or two fields) on one event without divisions: a match would open on whichever covers its time, often the wrong one.
- A video YouTube no longer plays holds no day for the watcher or the audit either (`eventVideosByDay` `gone`): a new
  broadcast of that day is added, and the dead one comes off.
