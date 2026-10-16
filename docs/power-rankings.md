# Power rankings: publishing a week

A weekly top 25 of FTC teams with a short written take on each. Each week is one markdown file
in `content/power-rankings/`. Publishing means adding that file in a pull request; once it's
merged and deployed, the week is live at:

- `https://controlscout.org/power-rankings`: the latest week, plus the archive of every past week
- `https://controlscout.org/power-rankings/2026-w42`: that week's own shareable URL

The site adds each team's live rating, world rank, OPR and record, and works out its movement
(▲ / ▼ / – / New) from the previous week's file. You only write the words.

## Step by step

1. **Branch from main.**
   `git switch main && git pull && git switch -c power-rankings/2026-w43`
2. **Scaffold the week.** This writes `content/power-rankings/<this ISO week>.md` with the current
   top 25 by rating already filled in:
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
