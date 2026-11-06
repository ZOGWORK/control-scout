# FTC One Search live sign-off

The sign-off brief's own test, run by us against the live site, signed out. It asks every question, grades each answer and writes the tables the report needs. The questions live in `sets/`, and the code never branches on one of them.

| File | What it holds |
| --- | --- |
| `sets/A.json` | Set A, the 200 unique questions, each with the answer kind it expects (`expect`) |
| `sets/B.json` | Set B, the 61 complex questions plus P1–P23, with the Nov 4 result beside each (`nov4`, `nov4Note`) |
| `sets/C.json` | Set C, the 50 core questions (100% required) |
| `sets/D.json` | Set D, the natural-question families: one intent said 5+ ways |
| `sets/paraphrase.json` | held-out rewordings, in no other list (`sets.test.ts` checks), each compared with the listed question it rewords (`anchor`): same card, same number |
| `sets/anyteam.json` | one intent for two teams that both meet its requirement |

## Run it

```bash
npx tsx scripts/search-signoff/run.ts
```

This runs every set against controlscout.org. It writes `report.md` and `results.jsonl` to the OS temp directory, or to `--out <dir>`. `--sets C,D` runs only those sets, `--base <url>` points it at another server, and `--regrade <results.jsonl>` grades a saved run again offline: its saved answers, number checks and release, with nothing fetched.

```bash
npx tsx scripts/search-signoff/visual.ts --sets C
```

This opens each question's results page in headless Chromium, at desktop 1280 and phone 390 (the way `npm run shots` works, never an in-app browser). It checks that there's no sideways scroll, that tap targets are at least 44px, that there's one answer card, no duplicate header, no TEAMS card repeating the answered team, no yellow band or yellow-bordered box, no debug text, and a 640–720px column on desktop. It saves a PNG of each page. `--sample 10` takes the first 10 questions of each family from every set.

```bash
npx tsx scripts/search-signoff/literals.ts
```

This greps every search reader (`server/api/search*.ts`, `src/shared/search*.ts`), the parser, the answers and the search UI (not tests, test-only phrase lists or comments) for every team number, team name, event, division and place the sets use. Year literals are listed separately.

```bash
k6 run scripts/search-signoff/k6-staircase.js
```

This is the load staircase: 25, 50, then 100 virtual users. Add `-e CACHE=cold` to make every request miss the 60 s answer cache, and report both runs. The targets are p95 under 2 s at 25 and 50, p95 under 3 s at 100 with at least 15 requests a second, and 0% failed.

## How an answer is graded (`grade.ts`)

An answer passes when all of these hold:

- It is an answer card, not a fallback, a team card alone, a names list or a compare card with no numbers.
- It is the kind the question asks for (`expect`, matched against the answer's family, intent and title). A side-by-side needs its numbers.
- It has no "read as", "say which" or "isn't answered directly" text.
- It states every season, place and time window the question typed, each one ("2024 versus 2025" needs both). A window passes when the card says the window's words or names a date inside it.
- Its headline number matches the live team page at test time (`crosscheck.ts`): a whole season's OPR, rating and record, and a team's record at the events the card links. A filtered number (playoffs, a month) is left to the grade.
- In the any-team pairs, the answer is for the team asked about, in that team's own region.

An `invalid` question (something that never happened) passes only with a clear no-matches card. `sorry` (an intent not built yet) passes only with the "Sorry — I can't answer that yet" state.
