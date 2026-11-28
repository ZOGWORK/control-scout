# Video recommendations

One engine picks what every video list shows each person: **Clips** (short videos, `server/api/cycles.ts`; first called Cycles) and the
long-form **Videos** feed (`server/api/videosFeed.ts`). The engine is `server/videos/recommend.ts` (pure, tested in
`recommend.test.ts`); its reads are `server/videos/signals.ts`.

## What it learns from

Every thing a person does with a video is a signal:

| Signal | Weight | From |
| --- | --- | --- |
| Share | +3 | `video_shares` |
| Like, Save, Show more like this | +2.5 | `video_likes`, `video_library`, `video_watch.more` |
| Emoji reaction | +2 | `video_reactions` |
| Played through again (a Cycle) | +1.4 | `video_watch.loops` |
| Finished | +1 | `video_watch.completed` |
| Part watched | −0.4 to +0.8 by how much | `video_watch.watched_s` |
| A Cycle left in under 3 s | −0.6 | `video_watch.watched_s` |
| Not interested | −4 | `video_watch.hidden` |

A signal fades by half every 21 days and counts 1.5 times while it's from the scroll in progress, so Clips adapts
within one session (each page of six is ranked again).

## How it ranks

1. **Taste.** Each signal goes to the video's facets: `team:<n>` (split across its teams), `creator:<id>`,
   `series:<s>`, `kind:<k>`, `format:short|long`, `event:<e>`. A facet's lean is `tanh(sum / 3)`, between −1 and 1.
   Finish three Quality Control videos and `team:21229` leans about 0.76. The person's own teams (on the team, My team,
   followed, shortlisted, scouted) lean them in before they've watched anything.
2. **Co-engagement.** "People who loved this also loved that": cosine similarity over everyone's loves of the last 90
   days, shrunk while few people share a pair, top 30 neighbours per video, summed over the person's recent loves.
3. **Star power.** A team featured on Behind the Bot more than once lifts its videos a little for everyone
   (`1 + 0.1 × log2(episodes)`).
4. **Quality.** Likes, reactions, shares and finishes over views, with a prior of 20 views at the average rate.
5. **Explore.** A Thompson draw from Beta(1 + loves, 1 + skips) for the video's series and creator: one the person
   hasn't tried still wins a slot now and then; one they keep skipping draws low.
6. **Novelty.** Seen ones sink (skipped most, finished less, loved ones may come back).
7. **Diversify.** Maximal marginal relevance: each next pick pays for being like the last four (a shared team counts
   most), so no list runs one team.

The long-form feed keeps its own pools, freshness and mix (`videosFeed.rank.ts`) and multiplies its score by the
engine's taste, co-engagement, star power and quality (`engineLift`).

## Adding a source

The engine never reads a source's own fields: a video is a `RecItem` (`key`, `kind`, `format`, `creator`, `series`,
`teams`, `event`, `at`, `durationS`). To add videos from somewhere new (a team's own account, another platform), map
them to `RecItem`s with a `creator` id of their own (`ig:<handle>`, `yt:<channel>`), give them a feed key, and add them
to the pool. Likes, reactions, shares, Save and the engine all work on the key.
