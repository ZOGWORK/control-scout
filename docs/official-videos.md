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
  day, and the watcher, which needs a broadcast date, sends such uploads to the owner,
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
  League G for League G's meets in Carson, 7419 Tech Support, which streamed NorCal East Bay Meet 1 of 2026 from its
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
2. It's a live broadcast whose start, at the venue, falls inside the event's dates in Scout. An upload has no
   broadcast date, so it can't prove its day, and is left out. The checked list makes one exception, by hand: an
   upload whose title names its date (FIRST Nevada's "2026-01-10 FTC League Meet # 4S - Southern Nevada") and, where
   a venue holds several meets that day, its session (FIRST MOKS's "FTC Meet @ Belton 8AM (2026-11-7)" is "Belton
   Meet @ 8 AM"), an upload of a one-day event its title names, or an upload of an event that played every match on
   one day (Scout's match times say which; FTC Louisiana's two-day qualifiers play on the Saturday).
3. Its title names the event: a distinctive word of the event's name or city (the league, the venue, "Mockingbird"),
   or the event's designators (an NTX league letter, a meet number, a UIL class, a stage). An event named by an
   acronym ("APOC") also fits a title spelling it out in words in a row ("Asia Pacific Open Championship"); a common
   one ("FTC") never counts. A state or region name alone counts only for that region's one championship on that date.
4. Where the event has divisions, the title names the division ("COANDĂ", "Franklin", "Black"), and a division video
   never goes to another division or to the parent event. A parent event gets only a video that names no division
   (Romania's Finals & awards stream).
5. Where the title names a day, the days follow the broadcast dates in order (an event listed with a setup day first
   has its "Day 1" on its second date; that offset must be the same, or keep increasing, across the event's videos).
   Where the title names a weekday or a date, it must be the broadcast's.
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
   the event's FIRST link already plays, is still left out.

Per-match clips are never mapped from a title outside FIRST's own per-match videos (the Championship's are already
FIRST's match videos, `matches.video`). A recording never hides FIRST's per-match video or a verified contributor's
link: it's the fallback, the clip of the match inside the day's broadcast.

## How it plays

`server/videos/officialVideos.ts` writes the list into `official_videos` (migration 83) once per video, at boot. The
recording path (`server/videos/recordings.ts`) treats each kept recording as one day of the event's broadcast: an event
without FIRST's link gets its first day as its video; every other day joins it, in broadcast order, and the event
page's Watch section shows a button per day ("Friday", "Saturday", "Sunday · Awards"). Each match links to its second
in its own day's video when YouTube's timing for that video holds (the same checks as FIRST's links).

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
  - it fits exactly one event of the channel's region on its broadcast date at the venue;
  - the title agrees on the division, designators, date, weekday and day number. Taken one at a time, a title's
    "Day N" must be the event's own day N;
  - the event has no video for that day yet (a second video of a day is kept only when both name their parts, such
    as "Matches" and "Awards"), and none whose day isn't known yet. Another programme's stream at the same venue (FIRST
    Global, a drone or simulator contest) is set aside, and "Meeting" or "Sports Day 2026" no longer reads as a meet or a
    day number.

  A video the event already plays for that day, or one that is already some event's video (FIRST's link, a short
  link, a channel broadcast, the owner's stream), is logged as a **duplicate** and never added or queued.

  Anything short of that goes **to review**, with the reason and the event it fits best. Titles that aren't
  competition streams (webinars, kickoffs, FRC, …) are **set aside**, and so is a video under 45 minutes that fits no
  event (an upload, a program call, a team's reel): it can't be a day's recording, and the owner can still add it as a
  highlight from the set-aside list. A title naming the region itself ("FTC Iowa …") makes all its events that day
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
  half-hourly check runs it again. The checks start 17.5 minutes after boot, midway between the sync's 5-minute ticks.
