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
- the event's own organiser or league (NTX FTC for FiT-North, GEARS for the Michiana Premier Event, …),
- or the channel FIRST's event page names as the livestream (FIRST HQ's "FIRST Tech Challenge" channel carries the
  2026 Championship's division broadcasts, and FIRST's own event pages link its Day 4 videos).

A team's channel, a spectator's upload, a re-upload or a local TV broadcast is never used, even of the same event.
`server/data/officialVideos.json` lists the channels each kept video came from.

Regional streamers from the owner's audited list (2026-11-14), each read through the YouTube Data API's uploads list
and checked by hand: FIRST in Missouri (the Missouri/Kansas partner: St. Louis, Southeast and Southwest leagues, the
championship) and FIRST MOKS (Kansas City, one video per meet session).

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
   Meet @ 8 AM"), or an upload of an event that played every match on one day (Scout's match times say which).
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
   eliminations, "Matches 1–5" and "Matches 6–14"), or, in the checked list only, when they are one day's broadcast
   restarted on the same channel: the second starts at most 30 minutes after the first ends, they don't overlap, and
   the rows say "Part 1" and "Part 2" in broadcast order (Montana's 2023 State: Part 1 ended 23:13:53Z, Part 2 began
   23:15:48Z).

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
  titles to count as evidence) and, optionally, a pattern for titles that name the region itself. Only videos
  published after a channel started being watched are read; the older ones went through the checked list. The
  owner adds, edits or removes channels in Owner › Official videos, and a removed channel is never seeded back.
- **Each new video, once** (`official_watch`): it gets matched with the list's rules (`server/videos/officialMatch.ts`).
  A recording is **added** (`official_videos`, source `watcher`) only when all of these hold:
  - it is a finished live broadcast of at least 45 minutes, public and embeddable, and not blocked in 50 or more countries;
  - it fits exactly one event of the channel's region on its broadcast date at the venue;
  - the title agrees on the division, designators, date, weekday and day number. Taken one at a time, a title's
    "Day N" must be the event's own day N;
  - the event has no video for that day yet, and none whose day isn't known yet.

  A video the event already plays for that day, or one that is already some event's video (FIRST's link, a short
  link, a channel broadcast, the owner's stream), is logged as a **duplicate** and never added or queued.

  Anything short of that goes **to review**, with the reason and the event it fits best. Titles that aren't
  competition streams (webinars, kickoffs, FRC, …) are **set aside**. A video still live, or still to come, is read
  again after it ends.
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
