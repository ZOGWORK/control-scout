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

## One pass at a time, never stuck

The server reads YouTube's facts in one pass every 5 minutes (`backfillVideoMeta`), one pass at a time. On 13 Nov a
pass on the live server stopped part way (at 20:05 UTC, with 78 recordings still due) on a read that never settled,
and held every later pass off for nearly two hours, until a restart: no recording was read in that time, live
broadcasts included. A pass that began more than 30 minutes ago no longer holds the next one: that one logs
"recordings: the pass begun … never finished; starting anew" and reads what's due. A stuck pass that ends late
leaves the newer one be.

## The events list and the event page

- `seasonVideoKinds`: "clips" when at least one played match gets a clip, "recording" for a recording with none.
- The event page's coverage line counts the matches with a clip ([contributors.md](contributors.md)).
