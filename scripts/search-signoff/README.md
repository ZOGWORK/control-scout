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

It also measures layout shift (CLS, scored as Chrome does). Unlike `run.ts`, it runs against a local production server that it starts itself from the build (`npm run build` first), unless `--base <url>` names another server. Every request it makes carries `X-CS-Test: 1`. CI runs it on the pages in `cls.json` with `--cls scripts/search-signoff/cls.json --max-cls 0.1`, and it fails when a page view shifts more than 0.1, or more than its own ceiling in `cls.json`. Those ceilings are for the pages over 0.1 today: each one is today's number plus a margin. The phone view has its own default of 0.3 (`views` in `cls.json`): phone readings in CI moved between 0.0 and 0.13 from one run to the next, and the audit measured 0.24–0.26 live, so 0.1 can't hold on phone until U1 lands. A page over its ceiling is loaded up to twice more and the lowest reading kept. Lower a ceiling as that page's layout is fixed, and remove it once the page is under 0.1; lower the phone default to 0.1 when U1 lands.

```bash
npm run search:followups
```

This checks People also ask and Related searches in-process against the shipped snapshot, with no server. For set C and a few team, place and event searches, it checks that each follow-up names a team, event or place the search typed or its answer card is about, and that it answers when tapped (a card, never a sorry, a fallback or names only, as `failureOf` judges). It prints both rates and every offender, and CI fails it under the floors in the script (`GATE`).

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
