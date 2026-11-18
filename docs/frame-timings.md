# Match starts read off a recording's frames

Most event recordings place each match from YouTube's facts alone: the broadcast's start plus the match's real start
(FIRST's actual start time) gives the second the match sits at in the video (`withClips`, `server/videos/recordings.ts`).
That only works when the video kept every second of its broadcast. Two kinds of recording don't:

- **Cut short or gapped**: the stream stopped over lunch, the tail or the start was trimmed, so the video is shorter
  than its broadcast and the clock no longer lines up after the gap.
- **Uploads**: a video uploaded after the event has no broadcast start at all.

For these the video itself says where each match is. Nearly every FTC stream carries FTC Live's overlay, which names the
match ("Qualification 21 of 36", "Playoff Match 7") and runs its timer.

## How it works

`scripts/video-frames.ts` plays a recording in a headless browser (YouTube's privacy-enhanced embed), seeks to a
point, and reads two things with tesseract.js:

1. **The overlay's match**: `overlayLabel` turns "Qualification 21 of 36" into Q21, "Finals Match 2" into F2, and
   "Playoff Match 10" or a bare "Match 10" (2025's playoff overlay) into M10. 2019–2023's best-of-3 semifinals
   ("Semifinal 1 Match 2") are named by series and number (M1-2), the event's match of that series and number only:
   its M1 is "Semifinal 1 Match 1", its M2 "Semifinal 2 Match 1" (`sameMatch`).
   Where the whole frame names nothing, the bar's row is read on its own: along the bottom, then FTC Live's whole bar
   moved to the top edge (FIRST Nevada, USNVCMP 2024), whose timer is then read first in its own place under that row.
2. **The timer**, in one of three places: the bar along the bottom (FTC Live's default), a box over the field under
   a bar across the top (FTC Ontario), or the bar along the top (FIRST in Texas). FTC Live's overlay from 2019 to 2022
   shows it as bare seconds ("30", "112": `secondsPlain`), in a box over the scores (SKYSTONE, FREIGHT FRENZY) or
   under POWERPLAY's centre graphic; for those seasons those places are read first, then POWERPLAY's bar flipped to
   the top of the frame (Arizona's 2022 championship), its box at the same crop mirrored (`flippedClip`). A timer's two
   readings come from one crop, and the crop whose clock last ran is read first for the rest of the video (`cropOrder`).
   Past those places, and first after a label read off a top bar, the timer is read in its own box: the light box
   between the two alliances' scores in the bar found in the frame, cut to the digits' rows alone (`timerDigits`), so
   neither the icon under them nor a field monitor's copy of the box off to one side is read (USNVCMP 2023's top bar,
   whose fixed crop caught the digits' lower half and the robot icon: placements ~20 s late).
   Each counts Auto down from 0:30,
   then 8 s to pick up the controllers ("0:05" under a hand), then TeleOp from 2:00. Some bottom bars instead
   count the whole match down from 2:30: Auto reads 2:30 to 2:00 there, so a bottom-bar reading above 2:00 is that
   bar's Auto (2:30 less the reading is the time since the start), and a reading of 2:00 or less is TeleOp on either kind. A reading of 0:30 or less is
   Auto or the end of TeleOp, so it's read again 45 s on: still the same match with well over 30 s left means Auto.
   A reading of 8 s or less (the switch, or TeleOp's last seconds) is never used. Taking an Auto "0:20" for TeleOp's
   would put a match 2 minutes early, the mistake a frame-by-frame check of Western Edge Sand's Q53 caught.

   YouTube's auto-captions sit right over the bottom bar's timer, so the player's caption layer is hidden before
   any frame is read.

   `elapsed` turns a reading into seconds since the match started, counting the 8 s switch between Auto and TeleOp.
   A timer has to be seen running (two reads 1.5 s apart), so a frame of a match not started yet, or one standing on
   its final score, isn't read as a start.

A video can lose time but never gain it, so "video second minus real start" only ever falls from match to match. Two
matches the same distance apart (within 6 s) hold every match between them at that distance too. So the script reads
the first and last match a video holds, and the middle of any stretch whose ends disagree: a video with one gap takes
about 2 log n reads. `judge` then keeps the longest run of reads that never rise (dropping misreads such as a replay
or an overlay left on the previous match) and fills each stretch between two reads that agree. Once the reads place
the video, a match whose read judge dropped is looked for again where its neighbours put it, and the matches after
the last read are looked for in turn (`lookAgain`): the last match is first looked for before anything places the
video, so one missed then would stay missing (USCHSBAQ3 2023's F2, 16 minutes after F1 past a field timeout).

A match FIRST gives no real start for has no clock to place it by: a schedule's whole minute (2019's qualifications),
or no time at all (results posted with none, as the Chicago Robotics Invitational's are). The video is walked a frame
every few minutes and each such match is placed only where its own frames show it running; nothing is filled between
them. A match with no time may be in any of the event's videos, and comes after the timed ones in its label's order
(`labelRank`: qualifications by number, then playoffs, a best-of-three's games turn about, then finals). The server
orders the frame starts the same way (`inOrder`): a start out of that order is left out, never served.

## Two signals, never one

No match is placed on one signal alone.

On a stream an event's divisions share (one feed cutting between fields, as Romania's championship does), every read
also checks whose division the overlay names: a sibling division's overlay is never this event's match, and a start
stands only when one of its reads showed this division's own name (`divisionOf`, `overlayDivision`).

1. **Each read is checked before and after its start.** A read gives a match and its start. Later in TeleOp the
   overlay must name the same match and its timer give the same start, within 6 s; 25 s before the start, that match
   mustn't be running yet. A read that fails either is dropped. This catches a wrong match number on screen for a few
   seconds, a replay, or a digit read wrong. The later read is tried 70, 80, 95, 110, 125 and 140 s in until one shows
   the overlay: a frame that reads nothing (the player still buffering after a long seek, a camera cutaway without the
   overlay, as Romania's championship does mid-match) says nothing either way.
2. **The clock is the anchor, the frames must agree with it.** `judge` keeps the longest run of reads that never rise
   (as above), then groups them into stretches that agree on how far the video sits from the clock:
   - a stretch of two or more reads places its reads (**high** confidence) and every match between them (**medium**:
     filled, not read);
   - a stretch of one read is still a confirmed read (step 1: its overlay and timer agree at two points, and the match
     wasn't running 25 s before), so the video places it where its frames show it (high), however far that is from
     FIRST's schedule: the stream is the truth (owner, 2026-11-15). No read is ever flagged for how far it sits from
     FIRST's times (owner, 2026-11-16): what keeps a wrong one out is read off the frames (two timer reads that agree,
     the match not running 25 s before, an opening that names it, the division's own name on a shared stream).
3. **Plausible or review.** Placed starts must be inside the video, in match order, and at least 2:32 apart (a
   match's 2:38 less a read's 6 s slack).
   Any that aren't go to review. Where a start lands inside the previous match's play, both read off the video, the
   later one is also written to `earlyStart` (its start and when the previous match's play ends): the only early start
   that keeps a match from a clip.
4. **Missing, with the reason.** Every other match of the video gets a reason: its read disagreed with the matches
   around it, its frames didn't confirm a start, it sits in a gap whose two sides disagree (the stream may have been
   off), no frame of the video could be read, or no read near it.

A gap in one stretch doesn't stop the day: the next read that agrees with another starts a new stretch.

## Every clip opens on its match

A placed start isn't a clip until its opening is checked (`checkOpenings`): the overlay 20, 12, 5, 2 or 0 s before the
start must name that match (and, on a shared stream, not a sibling division's). The first that does is where the clip
opens (`opens`); the server starts the clip there (`frameOpen`). A 20, 12 or 5 s lead whose frame a second earlier
names another match sits on the overlay's switch to this one, where a paused seek can land either side (USMOKSCMP
2023 Q9 at 4004 s read Q9 once and Q8 once): it's passed over for the next lead in (`onSwitch`). The 2 and 0 s leads
are for a results or bracket card that
stays up until the match's own overlay comes on (CAONMIQ 2025 M7, USIAWESTLT M3). One whose opening frame shows another
match goes to review; one whose overlay can't be read there is missing with "overlay could not be read at its clip's
start". A row with `opens` plays only the starts in it. `--verify` checks the openings of rows read before this, without
reading their starts again. Where nothing before the start names the match (an upload cut from the last match's results straight into this one's first second), it is tried 2 and then 4 s after the start, and the clip opens there, a few seconds into its match, rather than not at all.

An opening is read paused at its second, so the frame read is the one the clip opens on. A playing read lands about a
second later by the time it's taken: LTCMP 2024 Q20, asked 8948, read 8948.9 with "Qualification 20 of 40" already in,
while 8948 itself is a sponsor slate (the paused read gives 8951). Timer reads still play: the clock has to run.

A busy frame (crowd, robots, game pieces) can throw tesseract's page layout off and lose the bottom bar's line with it:
USARBEQ 2024 Q8 at 7097 s reads as a jumble whole, though "Qualification 8 of 23" is plain on screen. So an opening
whose whole frame names nothing has the match's half of the bar's top row read on its own (`labelRow`): the whole row
can lose it too, to the logo and event name beside it (USCHSGAQ1 2024 M1, its half "Playoff Match 1"). On a shared
stream the whole row must also name this division. Placement reads fall back on the row the same way: on CENTERSTAGE's
(2023) streams nearly every frame of play loses the bar's line in a whole-frame read (NLBNM1 at 3300 s reads a jumble,
its row alone "Qualification 4 of 23"), so those videos read nothing at all before. A row-named read is held to the same
checks as any other: its timer seen running, the same match and start 70 s on, not running 25 s before.

With `--live`, a clip the live site already plays that a read leaves out (one read of it out of order, a gap the reads
around it disagree on: FPEWESEA 2025 Q97–Q100) goes back to its live second for its opening check, like any start: its
overlay there keeps it, another match's pulls it, nothing read leaves it unconfirmed. Only a frame pulls a live clip.

What a frame names (`overlayLabel`): "Qualification N of M", "Finals Match N", or one "Match N". A card naming several
names none, except the match its "Up Next" header names; a match a team "advances to" is a later one, never the one on
screen; a bracket (three different M-numbers in its boxes) names none, its "advances to" line cut off or not; a replay
("M6-2") is named by its match alone ("M6").

A clip already live is never dropped on a frame that names nothing: `--verify`, and a re-read with `--live <main's
frameTimings.ts>`, keep such a start in `unconfirmed` (it plays at the usual lead-in) until a later read confirms or
pulls it. Only an opening that names another match pulls a live clip. A new placement whose opening names nothing is
never placed.

A recording can be cut mid-match (a stream restarted): a later read then gives an earlier start than the true one. The
reader marks such a read "lost" and keeps it only where a read of Auto 12–20 s on agrees; the read after a cut
("gained") has its other side checked in turn. Opening a video and closing a player are bounded (90 s, 15 s): a frozen
page fails that video with the reason, and the next run reads it again.

Only `starts` become clips. `review` (with the start found and why) and `missing` (with why) are written per video for
the owner's review list; review starts are never shown as clips, and nothing is dropped without a reason.
`earlyStart` (`{ label: { t, previousEnds } }`) marks a match the frames show starting while the one before is still on:
only those are "Early start / unsafe" in Owner › Clip coverage. A row's existence is what marks its video as checked
against the frames; a match in none of `starts`, `review`, `missing` or `earlyStart` reads "no start found for it".

A video where three matches in a row give no read, and nothing has been read yet, counts as one without the overlay
and is left, after one more go in a fresh player (a player that never showed the stream looks the same). A frame read
that hangs over 2 minutes fails its video with that reason. Any video gets a budget of 8 reads per match (60 at
least; a stream cut mid-match spends extra confirming reads), confirmations included: a confirmation spends up to seven of them (70 to 140 s in until one agrees, then
one 25 s before the start).

## Where the timings live

`server/data/frameTimings/<season>.ts`, one file a season (the season of the row's event; `server/data/frameTimings.ts`
reads them all and holds the logic): one row per recording and event, `starts` mapping each match label to the second its
timer starts in the video; `medium` the placed matches filled rather than read; `review` and `missing` as above
(`frameReview`, `frameMissing`, `frameConfidence` read them). The server checks it before the clock model: a framed match gets its clip at that second
less the usual lead-in. An event with any framed played match counts as having clips in the events list, and so does
its parent championship.

A framed clip stops at `frameClipEnd` (`src/shared/recording.ts`): the timer's start plus 2:40 of play and 50 s for
the overlay's final score to settle (33 to 43 s after the buzzer on APOC 2026's frames), cut at the next framed
match's start in the same video but never before its own play is over, and never past the video's end.

## Running it

YouTube refuses data-centre addresses (the "confirm you're not a bot" wall), so run it on a computer that can play
YouTube, against a copy of the live database:

It reads text with tesseract.js, which isn't one of the app's dependencies (the server never needs it). Install it
once outside the repository and point the script at it:

```bash
npm install --prefix ~/frame-ocr tesseract.js
export TESSERACT_JS=file://$HOME/frame-ocr/node_modules/tesseract.js/src/index.js
```

The installed Google Chrome plays the video, else Playwright's Chromium (`npx playwright install chromium`). Chromium has no H.264, and YouTube serves some older uploads only in it (2021 NLCMP, USMSBILT): without Chrome those stay black and read nothing. The run's first line says which one it used.

```bash
DATABASE_URL=file:/path/to/copy.db npx tsx scripts/video-frames.ts --season 2025
```

- `--codes A,B`: only these events.
- `--all`: every recording, not only those with a match the server can't place now.
- `--check`: recordings the server already places, to compare frames against the clock (prints the median offset).
- `--dry`: print, don't write.
- `--lanes 3`: how many events are read at once.

It writes the `--season`'s own file, `server/data/frameTimings/<season>.ts`, and no other, after each event, so a run
cut short keeps what it read, and readers of different seasons never touch the same file. Commit the file through a
PR like any other change. A season with no file yet needs one (an empty copy of another season's) and its import in
`server/data/frameTimings.ts`.

## Checked against the clock

On GATOR (USOHSHOS, a full recording the server already places from the clock), frames land 9 to 14 s after the
clock (median 10 s): YouTube's live delay. That's within the 20 s lead-in each clip starts with. On FTC Ontario's
layout (Sudbury, Bolton), frames land 6 to 8 s after the clock where the video kept its broadcast whole.

A scoring clock kept in UTC: FIRST's actual starts are the venue's local time, but a few events' clocks kept UTC
(2021 USIAJOM2, 2025 FPECCN: every start after its broadcast ends as local time). When the local reading puts none of an
event's actual starts inside any of its broadcasts and the UTC reading puts every one inside them, the reader uses
UTC (`clockReading`) and says so in the run and its report. Each start is still confirmed by its frames, so a wrong
guess places nothing. Of every 2019–2025 event with a recording, those two are the only ones it changes.

## Clock clips checked by their first frame

Owner decision (2026-11-15, "New clips + verify old"): a new clip is only placed once the overlay at its first frame
names its match. The clips already placed from YouTube's facts (the clock, about 27,000) stay live while a background
sweep reads the overlay at each one's first frame, recorded in `server/data/clipChecks.ts`:

- **ok**: the first frame names the match. The clip stays.
- **pulled**: the first frame names a different match. The clip is never served (`clipPulled`, checked in
  `withClips`), and it's a finding on the owner console (`clipCheckFindings`) with the clip's start and what it showed.
- **unconfirmed**: the first frame names nothing (blank, a transition, a cutaway). The clip stays and is read again on
  the next sweep. A frame that shows nothing is never a reason to pull.
- **noOverlay**: no frame of the video showed a readable overlay (older seasons' layouts). Its clips can't be checked
  by frame; they're counted and never pulled.

The sweep runs season by season, newest first, and each data PR reports its measured counts (`clipCheckTotals`).

## Not covered

- A video whose owner turned off embedding (USIANON's) can't be played in the reader.

- A recording whose overlay is hidden or missing (a camera-only stream) gives no reads, and its matches stay unplaced.
- A video that doesn't hold the matches at all (FRCMP's linked video is 2:31 long; FPEISTRDIV's starts after the last
  match) has nothing to read. Those need the right recording linked.
