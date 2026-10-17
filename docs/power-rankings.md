# Power rankings: publishing a week

A weekly top 25 of FTC teams with a short written take on each. A week comes from one of two places:

- **Automatically, every Friday** (the default): the site publishes the week itself, with blurbs
  written by Bruno, Control Point's AI. See [Automatic weeks](#automatic-weeks).
- **By hand**: a markdown file in `content/power-rankings/`, added in a pull request. A file for a
  week replaces the automatic one. See [Step by step](#step-by-step).

Either way, the week is live at:

- `https://controlscout.org/power-rankings`: the latest week, plus the archive of every past week
- `https://controlscout.org/power-rankings/2026-w42`: that week's own shareable URL

The site adds each team's live rating, world rank (counted the same way as `/rankings`), OPR and
record, and works out its movement (▲ / ▼ / – / New) from the previous week's file. Each week
also links to the world rankings for that week. You only write the words.

## Automatic weeks

Every **Friday at 00:00 New York time** (America/New_York, so 04:00 UTC in daylight time and 05:00 UTC
in standard time), the server publishes that week's top 25. Nothing to do; it needs only the Control
Point settings Scout already has for shared accounts (`CONTROL_POINT_INTERNAL_URL`,
`CONTROL_POINT_INTERNAL_KEY`) and Control Point's own Gemini or Anthropic key.

1. **The facts.** The top 25 of the **live** world ranking at that moment (the list `/rankings`
   shows), each team with its rating, OPR, season record and last event (its rank there and its
   awards). Movement is counted against the **previous published power-rankings week** of the season,
   hand-written or automatic. The rating change is counted against that week too, when it was an
   automatic week; a hand-written one records no ratings.
2. **Bruno writes.** Scout sends these facts to Control Point (`POST /internal/bruno/power-rankings`),
   and Bruno answers with an intro and one blurb per team. He's told to write like a friendly FTC
   commentator, to use only the facts given, and never to mention other sites.
3. **The fact check.** Every blurb is checked before it's published (below). Any blurb that fails is
   replaced by a data-only line built from the numbers. If Control Point can't be reached, isn't set
   up, or answers with something unusable, **every** blurb uses that line and the week still goes out.
   A week is never skipped for want of Bruno.
4. **Stored.** The week, who wrote each blurb (Bruno, the template, or the owner), and a frozen copy
   of the facts are kept in `power_rankings_generated`, so the week can be regenerated from the same
   facts later.

The week's id is the ISO week of the Friday (`2026-w43`), and its page says "Published Friday, Oct 23".
A week with Bruno's blurbs says "Blurbs written by Bruno, Control Point's AI, from this week's data".
Template blurbs are never credited to Bruno: next to his they're marked "Data summary", and a week
with none of his says "Published automatically from this week's data".

**Catch-up and no double publishing.** The server checks every 5 minutes. If it was down at midnight,
it publishes on its first check afterwards, for as long as that Friday's ISO week lasts (until Monday
00:00 New York time; after that the week is left for the next Friday). Each season and week is published
once: a run claims the week first, so a second check, a second server, or a restart mid-run never
publishes it twice. A run that died part-way is taken over after 15 minutes.

### How the fact check works

`server/powerRankings/factCheck.ts`. A blurb passes only if all of these hold:

- **Every number is that team's own:** its team number, rank, previous rank, places moved, rating,
  rating change, OPR, wins, losses, ties and matches, and any number in its name, last event or result
  there. Small formatting differences are fine: rounding (118 for 118.4), a sign (+12), `#3`, `3rd`.
  The season, the week number and "top 25" are fine anywhere. "Top 10" is fine when the team is in it.
- **A record is the team's record:** "9-1" or "9-1-0" must be its season record (so "won 120-95" fails).
- **Number words count:** two to twenty, and second to tenth ("one" and "first" are too common to judge).
- So **another team's number fails**, in the packet or not, and so does any number Bruno made up.
- **At most 60 words.**
- **No other scouting or stats site, and no web address.**

The intro is checked the same way, except that any team's numbers (and the publish date) are fine in
it. It has a 100-word limit. A failing intro is replaced by a data-only one.

### Overriding a week by hand

Write a markdown file for the same week as below (`content/power-rankings/2026-w43.md`). Once its
`published` date comes, the site shows the file instead of the automatic week, everywhere (the page,
the archive, the sitemap). If the file is merged **before** Friday, nothing is generated for that week
at all. Movement works across both kinds: a hand-written week compares with the automatic week before
it, and the other way round.

### Owner controls

In the owner portal (`/owner?panel=powerRankings`), **Power rankings** lists every automatic week, with
who wrote each blurb and why any of Bruno's failed the fact check. You can:

- **Edit** the intro or any blurb. The edit is live at once and is credited to you, not Bruno.
- **Regenerate**: Bruno writes the week again from its frozen facts, fact-checked again. Your edits
  are replaced. If Bruno can't be reached, nothing changes.
- **Hide** a week from the pages, archive and sitemap, or **show** it again. Nothing is deleted.
- **Publish now**: publish this week right away instead of waiting for Friday. Friday then skips it.

Each action asks for confirmation first and is written to the audit log. The **Automatic power
rankings** switch (Switches panel) stops new weeks from being generated. Weeks already out stay up;
hide them one by one if needed.

## Step by step

1. **Branch from main.**
   `git switch main && git pull && git switch -c power-rankings/2026-w43`
2. **Scaffold the week.** This writes `content/power-rankings/<this ISO week>.md` with the world
   rankings' top 25 already filled in. It uses the newest weekly snapshot (the list `/rankings?week=…`
   shows), or the live ranking with `--live` or when the season has no snapshot yet:
   ```bash
   npm run power-rankings:new
   # or pick the week, season and publish date yourself:
   npm run power-rankings:new -- --week 2026-w43 --season 2025 --published 2026-10-26
   ```
   It needs a database with ratings (`.data/scout.db`, or `DATABASE_URL`). `--stdout` prints the
   file instead of writing it, and `--force` replaces a file that already exists.
3. **Write it.** Replace the intro's `TODO` and every blurb's `TODO` line. The `TODO` lines show
   each team's rating, OPR and record, for reference. Reorder the entries however you like: move
   the heading and its blurb together, then renumber so the list goes 1 to 25. You can swap teams
   in or out, too.
4. **Check it.**
   ```bash
   npm run power-rankings:check
   ```
   This lists every problem at once, with line numbers. With a database, it also checks that every
   team exists and warns about any team with no matches this season. `npm test` runs the same
   format check, so CI fails on a broken file.
5. **Preview it (optional).** Run `npm run dev` and open `http://localhost:5173/power-rankings/2026-w43`.
6. **Open a pull request** with just the new file, then merge and deploy as usual. The week shows
   from its `published` date (UTC). A file with a future date stays hidden until then, so you
   can merge ahead of time.

To fix a typo in a published week, edit its file and ship it the same way. The URL stays the same.

## The file

```markdown
---
title: Power rankings, week 43
season: 2025
week: 2026-w43
published: 2026-10-26
intro: |
  One or two short paragraphs. Markdown works: **bold**, *italics*, [links](/teams/4215).
---

## 1. 4215 Hypnotic Robotics
Two or three sentences on the team's week.

## 2. 18360 {+3}
…
```

A full template is in [power-rankings-template.md](power-rankings-template.md).

**Front-matter** (between the two `---` lines):

| Key | What | Rules |
| --- | --- | --- |
| `title` | The page title | Up to 120 characters |
| `season` | The FTC season's first year (2025 for 2025–26) | Its numbers are the ones shown |
| `week` | The ISO week, e.g. `2026-w43` | Must match the file name, `2026-w43.md` |
| `published` | `YYYY-MM-DD` | The week is hidden before this date (UTC) |
| `intro` | Markdown, usually a `\|` block of indented lines | Up to 1,500 characters |

**Entries:** exactly 25 entries. Each one starts with a heading `## <rank>. <team number>`, and
its blurb is everything up to the next heading.

- Ranks go 1 to 25 in order. Each team appears only once.
- Anything after the team number is ignored, so add the team's name to make the file easier to read.
- Blurbs are markdown, up to 700 characters, and can't be empty or still say `TODO`.
- **Movement** is worked out from the previous published week of the same season. For a season's
  first week only, you can set it yourself at the end of the heading: `{+3}`, `{-2}`, `{=}` or
  `{new}`. Otherwise it's left blank.

**Markdown:** paragraphs, `**bold**`, `*italics*`, lists and links all work. Links can go to
`https://…`, `mailto:` or a page on this site (`/teams/4215`). Raw HTML shows as plain text, and
images show as their alt text.

## Sample weeks

`content/power-rankings-sample/` holds two weeks marked `sample: true` with "SAMPLE" in their
titles. They exist for development, tests and screenshots, and are **never** shown on the live
site:

- The server only reads them with `POWER_RANKINGS_SAMPLE=1`, and ignores that setting in
  production (`NODE_ENV=production`).
- They're left out of the Docker image (`.dockerignore`).
- A `sample: true` file in `content/power-rankings/` is rejected.

To see them locally, run `POWER_RANKINGS_SAMPLE=1 npm run dev`.

## How it works

- `server/powerRankings/format.ts`: parsing, validation, movement and the scaffold
- `server/powerRankings/markdown.ts`: markdown to safe HTML, on the server only (`marked`, with raw
  HTML escaped and link targets allow-listed)
- `server/powerRankings/store.ts`: reads the directory again whenever a file changes, adds live
  stats, serves `GET /api/power-rankings` and `GET /api/power-rankings/:week`
- `server/seoMeta.ts` and `server/powerRankings/static.ts`: each page's title, description, Open
  Graph and JSON-LD (Article plus ItemList). The full list is in the first HTML response, so
  crawlers and link previews see the content without running the app. An unknown week returns
  HTTP 404.
- `server/sitemap.ts`: `/power-rankings` and every published week, dated by `published`
- `src/pages/PowerRankingsPage.tsx`: the page
- `server/powerRankings/auto.ts`: the automatic weeks (the packet, Bruno, the Friday run); `schedule.ts`
  (Friday 00:00 New York time), `factCheck.ts` (the check and the templates), `generated.ts` (the stored
  weeks, merged in by `store.ts`), `ownerRoutes.ts` (the owner panel's API)
