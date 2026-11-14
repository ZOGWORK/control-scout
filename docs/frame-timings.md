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

1. **The overlay's match**: `overlayLabel` turns "Qualification 21 of 36" into Q21 and "Playoff Match 10" into M10.
2. **The timer**, in one of three places: the bar along the bottom (FTC Live's default), a box over the field under
   a bar across the top (FTC Ontario), or the bar along the top (FIRST in Texas). Each counts Auto down from 0:30,
   then 8 s to pick up the controllers ("0:05" under a hand), then TeleOp from 2:00. A reading of 0:30 or less is
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
about 2 log n reads. `placed` then keeps the longest run of reads that never rise (dropping misreads such as a replay
or an overlay left on the previous match) and fills each stretch between two reads that agree.

## Two signals, never one

No match is placed on one signal alone.

1. **Each read is checked before and after its start.** A read gives a match and its start. 70 s later (TeleOp) the
   overlay must name the same match and its timer give the same start, within 6 s; 25 s before the start, that match
   mustn't be running yet. A read that fails either is dropped. This catches a wrong match number on screen for a few
   seconds, a replay, or a digit read wrong.
2. **The clock is the anchor, the frames must agree with it.** `judge` keeps the longest run of reads that never rise
   (as above), then groups them into stretches that agree on how far the video sits from the clock:
   - a stretch of two or more reads places its reads (**high** confidence) and every match between them (**medium**:
     filled, not read);
   - a stretch of one read is placed only when the broadcast's own clock (YouTube's start, where the video kept it)
     agrees with it (high). Otherwise it is one signal only, and goes to **review**.
3. **Plausible or review.** Placed starts must be inside the video, in match order, and at least a match (2:38) apart.
   Any that aren't go to review.
4. **Missing, with the reason.** Every other match of the video gets a reason: its read disagreed with the matches
   around it, its frames didn't confirm a start, it sits in a gap whose two sides disagree (the stream may have been
   off), no frame of the video could be read, or no read near it.

A gap in one stretch doesn't stop the day: the next read that agrees with another starts a new stretch.

Only `starts` become clips. `review` (with the start found and why) and `missing` (with why) are written per video for
the owner's review list; review starts are never shown as clips, and nothing is dropped without a reason.

A video where three matches in a row give no read, and nothing has been read yet, counts as one without the overlay
and is left. Any video gets at most 4 reads per match (40 at least), plus two to confirm each read.

## Where the timings live

`server/data/frameTimings.ts`: one row per recording and event, `starts` mapping each match label to the second its
timer starts in the video; `medium` the placed matches filled rather than read; `review` and `missing` as above
(`frameReview`, `frameMissing`, `frameConfidence` read them). The server checks it before the clock model: a framed match gets its clip at that second
less the usual lead-in. An event with any framed played match counts as having clips in the events list, and so does
its parent championship.

## Running it

YouTube refuses data-centre addresses (the "confirm you're not a bot" wall), so run it on a computer that can play
YouTube, against a copy of the live database:

```bash
DATABASE_URL=file:/path/to/copy.db npx tsx scripts/video-frames.ts --season 2025
```

- `--codes A,B`: only these events.
- `--all`: every recording, not only those with a match the server can't place now.
- `--check`: recordings the server already places, to compare frames against the clock (prints the median offset).
- `--dry`: print, don't write.
- `--lanes 3`: how many events are read at once.

It writes `server/data/frameTimings.ts` after each event, so a run cut short keeps what it read. Commit the file
through a PR like any other change.

## Checked against the clock

On GATOR (USOHSHOS, a full recording the server already places from the clock), frames land 9 to 14 s after the
clock (median 10 s): YouTube's live delay. That's within the 20 s lead-in each clip starts with. On FTC Ontario's
layout (Sudbury, Bolton), frames land 6 to 8 s after the clock where the video kept its broadcast whole.

## Not covered

- A recording whose overlay is hidden or missing (a camera-only stream) gives no reads, and its matches stay unplaced.
- A video that doesn't hold the matches at all (FRCMP's linked video is 2:31 long; FPEISTRDIV's starts after the last
  match) has nothing to read. Those need the right recording linked.
