# Match clips in event recordings

An event's recording is one YouTube video per day (or one for the whole event): FIRST's livestream link, a short link
it redirects to, a channel's broadcasts on the event's dates, an organiser's official recording
([official-videos.md](official-videos.md)), or the owner's stream. A match's clip is the second its match starts at in
that video, minus a 20 s lead-in (`CLIP_LEAD_S`). `withClips` (`server/videos/recordings.ts`) gives every surface the
same clips: the event page, a match's page, search's highlights and the events list's "Match clips".

## Where a match sits: the broadcast's clock

YouTube gives a recorded broadcast's start, end and length (the Data API with `YOUTUBE_API_KEY`, else the watch page;
kept in `video_meta`). FIRST gives each played match's real start (its time with seconds). A match then sits at its start
minus the broadcast's start, **if the video's seconds still follow the clock** (`timingTrusted`,
`src/shared/recording.ts`):

- **Whole**: the video is within 3 min of its broadcast's start-to-end time.
- **Cut at the end only**: a stream left running after the event, its archive ending soon after the last match.
- **A little short** (15 min or less, `GAP_SLACK_MAX_S`): the gap can't be placed, so each clip starts early by all of
  it (`gapSlack`). A clip that would then open on the match before gets none (`clearOfPrevious`).
- **More than 15 min short**: the video's chapters can vouch for the clock (`chaptersConfirm`). The chapters that name
  a match ("Match 5", "Qualification match 12", "Match 16 analysis") must sit near their matches and not jump. They
  vouch up to the match before the first jump.

A video longer than its stated gap could have lost time anywhere: over lunch (a stream stopped and started again), at
the start, at the end. Without chapters that line up, its matches get no clip from the clock.

## Reading chapters

YouTube's Data API doesn't give chapters, so the server reads them from the watch page for any video more than 15 min
short of its broadcast (`cutShort`, `due`): once a day until it has some, then weekly while it has none. YouTube
answers a server in a data centre with a "Sign in to confirm you're not a bot" page. That page still carries the
video's chapters (the same list a visitor gets), so they're read from it (`parseWatchPage`).

Generated chapters can be wrong. Terra Division 2026's playoff chapters sit 13 min apart where its matches were
6–8 min apart. Chapters therefore only ever confirm the clock; they never place a match on their own.

### A start cut off the video

Some recordings lose their start: the stream ran for hours before play began, and the archive kept only the part with
matches. Every match is then the same distance from its chapter: the time cut off. The clock and the chapters agree
on that shift, so each match goes at its clock time less it (`chaptersConfirm` returns `{ to, shift }`; `clipSecond`
applies it). It takes both signals, never chapters alone, and it's strict, because a wrong clip is worse than none:

- The shift is the chapters' median distance from their matches, capped at the time the video is missing.
- Every chapter-named match must agree with it (within the chapters' drift). If one sits at its own clock time, the
  video began with its broadcast and lost time later. That's a gap, not a cut, and gets none (Qualifier Hasselt 2026).
- The cut must be all the time missing (within 3 min). With time still unaccounted for, a drop-out can hide between
  chapters and put a match on the one before it, so none.
- A match that began before the cut gets no clip (it's not in the video), never one at the video's start in its place.
- With no time left for a gap, the last few matches are trusted too (the usual tail rule is for a late gap).

Checked against the live database (1,008 events with a recording, 34,822 played matches): 75 more clips in 3 events,
none lost or moved anywhere else. All 75 were checked on the video, a frame 30 s into each clip: the overlay names
that match every time.

- APOC 2026 (AUSYOS) Saturday part 1, `fBZOzjZr-60`: its broadcast ran 7 h 23 min and the video is 3 h 5 min, with
  its first 4 h 17 min cut off. It had no clips at all. Now Q11 to Q31 all have one (shift 15,445 s), each opening
  about 27 s before its match, the teams on screen FIRST's.
- Baltic 2025-01-18 (USIABALM6) Q1 to Q30, and Tasman 2024-11-23 (USIATASM3) Q1 to Q24.

A first, looser version (any agreeing median) placed 261 more in 11 events. Frames showed wrong ones: Qualifier
Hasselt Q5 on Q1, Northern Qualifier Q6 on Q5, FiT-North I&S Q31 in Q30. Those videos lost time after play began,
so they wait for frame timings (docs/frame-timings.md).

## One pass at a time, never stuck

The server reads YouTube's facts in one pass every 5 minutes (`backfillVideoMeta`), one pass at a time. On 13 Nov a
pass on the live server stopped part way (at 20:05 UTC, with 78 recordings still due) on a read that never settled,
and held every later pass off for nearly two hours, until a restart: no recording was read in that time, live
broadcasts included. A pass that began more than 30 minutes ago no longer holds the next one: that one logs
"recordings: the pass begun … never finished; starting anew" and reads what's due. A stuck pass that wakes up late
saves nothing of what it read (it may be older than what the newer pass saved) and leaves the newer one be.

## The events list and the event page

- `seasonVideoKinds`: "clips" when at least one played match gets a clip, "recording" for a recording with none.
- The event page's coverage line counts the matches with a clip ([contributors.md](contributors.md)).

## Search: View clip

A search answer about one match ("barker greybacks best auto in decode", "11148 highest score in decode") carries
that match's clip (`answerVideo`, `server/api/answers/video.ts`). Under People also ask (the side column on a wide
screen, right after it on a phone), a "Watch this match" box with a **View clip** button plays it in the app's video
dialog (`AnswerClip`, `src/components/search/page/AnswerVideo.tsx`).

- It plays the match's own clip, whole: FIRST's video of it from its start, a contributor's video, or the match's
  second in the event's recording less the 20 s lead-in. Never a new cut of one phase: a best Auto answer shows the
  whole match, Auto included.
- Only the headline's match (`video.mainRow` equal to the stat's headline link). No clip of it: no box, never another
  match's clip and never an event's stream from its start in its place.
- No box on a page of match videos (highlights): each tile already plays its own.
- "highlights" or "video" with a one-match question ("<team> best auto highlights") asks to watch that match, so it
  gets the same answer (`WATCH` in `server/api/query/intents.ts`). "<team> highlights" alone stays the team's
  highlights page.
