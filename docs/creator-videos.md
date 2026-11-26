# Creator videos (FUN Robotics Network first)

`server/videos/creatorVideos.ts` reads the public videos of the creator channels the owner watches
(`creator_channels`, migration 114) and tags the FTC teams in them. Nobody confirms a tag: the owner can only take a
wrong one off (Owner › Creator videos), and a removed tag is never derived again (`video_tag_removals`).

## Intake (every 4 hours, on the official watcher's 30-minute checks)

1. The channel's playlists (`playlists.list`, 1 unit per 50). A playlist is read again (`playlistItems`) only when its
   etag changed, so its members are known without re-reading the whole channel.
2. Its uploads list (`playlistItems` on the `UU…` list, 1 unit per 50, newest first). The first read goes to the
   oldest upload; after that, reading stops at the first page holding a stored video.
3. New videos' facts (`videos.list`, 1 unit per 50): kept only when public, playable and embeddable.
4. The 30-day refresh (YouTube's terms): anything last read 26 days ago or more is read again; a video deleted, made
   private, blocked everywhere or no longer embeddable is dropped with its tags.
5. Every stored video's series, program, season and tags derived again (only changes are written).

Never `search`. Every write is under the shared writer lease (`withDataLock`). Each run's units and counts go in
`creator_runs`. At most 900 units a run; FUN's backfill takes a few hundred.

## What a video is (`server/videos/creatorTags.ts`)

- **Series**, from the channel's own playlists, else the title: Behind the Bot (`behind-the-bot`; not Behind the
  Bumpers, FRC's), Pits & Parts, Top 25, FUNalysis.
- **Program**: the title's (FTC, FRC, VEX; more than one, or drones and combat robots, is `unknown`), else the series
  playlist's, the other playlists', then the description's.
- **Season**: the season whose game the title or description names, else the one its date falls in (September on).

## Tags (FTC videos only)

| Rule | Example | Needs |
|---|---|---|
| `cue` | `#12345`, `Team 12345`, `FTC 12345` | the team exists and played or registered within a season of the video's |
| `bare-name` | `21229 Quality Control` | the team's own name right beside the number (either side) |
| `name` | a title part `Spartans` | exactly one active team with that whole name |

Never a tag: a VEX number (`24118E`, `11V`), a year or ranking after a cue (`FTC 2026`, `#1`), a score, a count or a
bare number without its name. Each rule is prefixed with where it was found (`title:` or `description:`).

## Where it shows

- `featuredFor(team)`: videos whose **title** names the team (a description's passing mention is a tag, not a
  feature). In `TeamProfile.featured`, so the team page paints it on first load.
- The badge "Featured on Behind the Bot" in the team page header (v8 and classic), playing the episode in the app.
- The Featured in section on the team page.
- `featuredTeamSet()` (`GET /api/featured-teams`): the chip on team rows in search, event team lists and rankings.
- `creatorVideosFor({ teams, series, since, limit })`: the Videos tab's creator rows.

Tests: `creatorTags.test.ts` runs the tagger on 206 real FUN videos (`__fixtures__/funVideos.json`, its public feeds)
with zero tags on FRC, VEX and drone videos; `creatorVideos.test.ts` runs the intake against a fake YouTube.
