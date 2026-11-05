# Search pipeline: understand the query, then query the data

FTC One Search answers a question by parsing it into slots and running one structured query over the stored data. It
does not match the question against a list of phrasings. One pipeline covers every team, event, place, stat and time
window, with no branch for any one query.

```
query ─▶ parse (server/api/query/parse.ts) ─▶ slots ─▶ execute (server/api/query/execute.ts, PR 2) ─▶ answer card
           │  names    (./names.ts: teams, towns, regions, countries, from the data)
           │  lexicon  (./lexicon.ts: synonyms, filler, aggregations, metrics: data only)
           │  time     (./time.ts: every phrase to a date range, relative to today)
           └  intent   (./intents.ts: one table of rules over the symbols read)
```

## Slots

| Slot | Read from | Example |
|---|---|---|
| teams | a number the data holds, or a team's whole name (`names.ts`); a shared name is picked by Compare's rules (your team, played, newest season, the place named, the other team's region) | "4215", "bad wolf", "ultraviolet in nj" |
| event | a run of words that names a stored event (`context.ts` `isEvent`, search's own index) | "east bergen conference", "nj championship" |
| place | a region, a country or a town the data holds | "in California", "Romania", "from Oradell" |
| time | a date, a window, a season, a game, a month, "ever" (`time.ts`) | "this week", "on Mar 15, 2026", "2024-25", "in march" |
| level, alliance | match type and side | "in playoffs", "on red" |
| worlds, states | the FIRST Championship, a region's championship | "at worlds", "nj states" |
| award | the award by the words people use | "inspire", "judges choice" |
| agg, n | highest, lowest, average, total, count, first, last, closest, next; "top 5" | "best", "how many", "last 10" |
| intent | the rule in `intents.ts` that explains the most symbols | highest-score, shared-matches, top-matches |

A parse is **complete** only when every word is explained (a slot, a lexicon phrase or filler) and one intent explains
every symbol. Until every intent runs on the pipeline, an incomplete parse goes on to search's older readers
(`server/api/searchAnswer.ts`). It is never a guess.

## Rules

- No team number, team name, event name, division, place or stat value appears in `server/api/query/` except in tests.
  Names come from the data. Words come from `lexicon.ts`, so a new way of saying something is one more phrase there.
- Time is relative to today. "This week" is this Monday to Sunday. A bare year is the season that starts in it. A
  future year with no events gets its own card and never falls back to the latest season.
- A team-specific question uses that team's own region ("24033 states" is Romania's championship), unless the query
  names another place or event.
- Numbers come only from the stored data, through the existing family answers (`server/api/answers/families/*`).

## Audit (2026-11-04, before the pipeline)

The pre-pipeline search is a chain of about 20 readers in `answerFor` (`server/api/searchAnswer.ts`), each a list of
regular expressions:

| Reader | File | Kind |
|---|---|---|
| rewrites (`rewriteQuery`) | searchCoverage.ts | per-phrasing rewrites to another reader's phrasing |
| explain, near me, bottom, count, team fact, team list, place teams, month, worlds, event code, event page | searchCoverage.ts | one reader per question shape |
| compound, top matches, leaderboard, change, OPR/rating, team set, two team, stat question, team fact | answers/read.ts, compound.ts, families/* | regex intent tables (`RULES`, `TWO_TEAM`) read in a fixed order, plus scope words |
| asks | searchAsks.ts | regex readers for view questions |
| rules, high scores, questions, conversation, event set, region, named-in-place | searchRules.ts, searchHighScores.ts, searchQuestions.ts, searchQuery.ts, searchEventQuery.ts | one reader each |
| intents, versus, full-text search | searchIntents.ts, searchCompare.ts, search.ts | fallbacks |
| layers 2–6 (keywords, paraphrases, filler, weak signals) | searchLayers.ts, searchCatalog.ts, searchLongForm.ts | word-bag rereading of a missed query |

Already generic, and reused by the pipeline:

- the scope clauses (`answers/clauses.ts`) and every family answer and card (`answers/families/*`)
- the stored team, event, match and award data and the search index (`search.ts`)
- regions and countries (`src/shared/regions.ts`, `countries.ts`), time windows (`searchEventQuery.ts timeWindow`)
- spelling and Did you mean (`spelling.ts`), shared-name rules (`searchCompare.ts`)

Per-query or template-shaped, to be replaced:

- `TWO_TEAM` in read.ts: about 35 regular expressions, one per phrasing of a two-team question ("^(.+?) (?:vs|and|with)
  (.+?) (?:matches|match|games?) (?:together|in common|shared)$"). Word order is fixed by each template.
- `RULES` in read.ts: about 100 intent regexes. Each one spells out its own synonyms ("highest|best|top|max|biggest|most"),
  and the reading order matters: rule 152 must come after 151.
- `rewriteQuery` in searchCoverage.ts: per-phrasing rewrites ("compare 4215 and 6980" → "4215 vs 6980").
- Per-reader `FRAME`/`FILLER` lists: filler is defined five times (read.ts, topMatches.ts, searchCatalog.ts,
  searchLongForm.ts, searchQuery.ts).
- Season defaulting is spread across readers. "4215 record 2027" silently answered 2025–26.

Hard-coded names in search code, from a grep of `server/api` and `src/shared` with tests excluded and comments
stripped:

| Hit | Where | Kind | Plan |
|---|---|---|---|
| "north/south/central jersey" → New Jersey | searchCoverage.ts:240 | a place special case | done (3.2.4): any direction and region is that region, said so (`regionPartOf`), in the pipeline and the readers |
| "houston" as Worlds | read.ts:130, :236; searchQuestions.ts:35; compound.ts:107 | a synonym written into regexes | now one row in lexicon.ts |
| "6980" in the not-operator help | searchBoolean.ts:432, :441 | example copy | done (3.2.4): the team's most-played opponent, from its matches |
| "4215 awards", "nj states", "Edison", … | searchCoverage.ts:391–404, :504–505, :749 | example copy on help cards | kept: queries for a visitor to try, not reading code |
| 4215, New Jersey Championship, USNJCMP | searchExperiment.ts:113 | the AI experiment's prompt examples | kept: word for word as Control Point sends it, behind its flag |
| 4215, 6980, hypnotic robotics, new jersey | searchLayers.sets.ts | a hand-written paraphrase list (tests only) | superseded by the generated harness |
| state names and codes | regions.ts | data table | fine (data) |

No parser branch names a team, event, division or place. Since 3.2.4 the comments' examples in `server/api` use
made-up numbers too, so the brief's grep (4215, 6980, Parkway, Turnpike) finds only the help card's queries to try
and the AI prompt above; `server/api/query/hardcode.test.ts` keeps the pipeline itself at none. The hard-coding is in templates (fixed phrasings), in
per-reader synonym lists and in example copy.

## Eval

`npm run search:eval` (`scripts/search-eval.ts`, CI job `search-eval`) asks search questions it has never seen and
checks every card against the tables.

- **Questions come from data, not a list.** `server/api/query/eval/generate.ts` takes each question as lexicon symbols
  (`agg:max` + `metric:score`) and says it with every phrase the lexicon has for them, the team said several ways
  (number, name, "team N", both, possessive), a frame ("what is", "show me", "?") and the team before or after the
  words. Teams are drawn at random from the latest season's (a different sample each day; `--seed` repeats one).
- **Truth comes from the tables.** `server/api/query/eval/truth.ts` reads the record, the highest, lowest and average
  score from `matches` and `match_teams` by the cards' own stated rules, never through search's code.
- **Checks:** every paraphrase gives the same card for the right team; its number is the data's; a year typed is that
  season and a future year says it has no events; no place typed puts no place on the card; a place and a window are
  stated, or the window relaxed and said; a matchup gives the winner, scores and odds with Predict open on the two
  teams; a name with a letter dropped still reaches the team; every answer is back in under 1 s warm (p50 and p95 are
  printed beside it).
- `server/api/query/hardcode.test.ts` runs the brief's grep on every change: no team, event or place in the
  pipeline's code. `server/api/query/eval/generate.test.ts` checks every paraphrase the generator can make reads as
  its question.

What its first runs found and fixed: team names longer than six words were never read whole (a seven-word name fell
to the slow legacy chain at 2.7 s, now 30 ms); "mean" in "mean scoring for …" let a definition card replace the
average; the event check searched again for every repeat of a name (now remembered per index, and skipped for words
that start like no event's).

## Match finder

`server/api/query/matchFind.ts`: matches found by a measure, no team named. The place, the time, the match type
(qualification, playoff, finals) and the kind of event ("at a league meet", "qualifiers") are filters; the measure is
the order. Each measure is one rule, printed on the card under "How this is counted":

| Measure | Said as | Rule |
|---|---|---|
| highest / lowest | "lowest scoring match", "highest scoring quals match" | the match's higher alliance score without penalties |
| closest | "closest", "tightest", "smallest margin" | the difference in final scores, penalties in; a tie is closest |
| most lopsided | "most lopsided", "blowout", "biggest score gap" | the same difference, largest first |
| most penalties | "most penalty points" | both alliances' final scores less their points without penalties |
| biggest upset | "upset", "underdog won" | the losing alliance's predicted chance before the match (the call saved live, else its replay); with no call saved, the larger summed season rating that lost |
| biggest comeback | "comeback", "came back" | won by the alliance behind after auto, furthest behind first |

No season said (or "this season") reads the season today is in; when it has no matches yet it reads the season
before and says so: "No 2026–27 matches yet in California; showing 2025–26". A window ("this week") relaxes as
everywhere else; a year said is never relaxed. "In the world", "worldwide" and "globally" mean every place.

## Leaderboards

The pipeline's leaderboard (`execute.ts`, over `answers/families/leaderboard.ts`) reads a list of teams however it's
said: with or without "team" ("who has the highest auto OPR in NJ"), the highest or the lowest first ("worst teleop
OPR in Romania"), a whole country, a town with its region after it ("best team in Cluj-Napoca, Romania, by OPR",
"Oradell, NJ"), a country by its people's word ("Romanian teams", `src/shared/countries.ts`), a count at the end
("…, top 3") and undefeated ("a perfect record", "no losses": no losses that season, the most wins first). "Auto OPR"
is the auto phase's OPR, and a record beside another stat is the column every row already shows. Asides ("just
curious", "only", "da") are filler and never a team's name. No season said follows the same rule as the match finder:
the current season once a team is ranked in it, else the one before, said ("No 2026–27 ranked teams yet in Romania;
showing 2025–26").

## Held-out sets

`npm run search:heldout` (`scripts/search-heldout.ts`) asks the questions people wrote for search and that search was
never built from: the 200 unique queries, the 260-query list and the complex queries (`scripts/search-heldout.json`,
533 in all, the invalid and excluded ones left out). They hold no expected numbers: the answer is judged by what it
shows, and its numbers are the data's. Each is sorted into a pattern, never fixed one by one:

- **pass**: a card (or an events list) that answers it, every place and time typed stated on it
- **fallback only**, **team card only**, **names only**: no answer, only a list or a team to open
- **not answered**: the card says it isn't answered directly yet
- **place not stated**, **time not stated**: a filter typed that the card doesn't show (or shows relaxed)
- **words not read**: the pipeline answered with a word it didn't read, or a reader said it left one out

It prints the pass rate per set and per pattern, each failing question with its card, and the slowest answer; with
`--out` it writes one line per question (the intent read, the filters, the place and time resolved, whether the card
states them). A pattern is fixed in the pipeline (a phrase in the lexicon, a rule, a family), and every set and the
generated eval run again.

What its first run found and fixed, besides the patterns: one answer looked the same words up 29 times (each reader
and layer asking again, and each miss scanning every name), now remembered per index version; and the Worlds and
award filters on a list scanned the season's every event entry for each team (45 s and 36 s), now read by team.

## Failure patterns

Failed-search reporting (`server/searchFailures.ts`, `docs/failed-search-reporting.md`) files a failure under its
pattern, not its query: `server/api/query/pattern.ts` parses it and keeps the intent read, the slots filled (team,
teams, place, event, window, count…), the symbols left unexplained and how many words weren't read. Names, numbers
and places never appear in it, so every team's "… opr scorecard" is one issue. The unread words are counted under
the pattern (`search_failures.missed`, migration 72) and listed on the issue, the most frequent first: the word most
often missed is the synonym to add. One issue per pattern replaces one issue per query.

## Plan (one PR per group)

1. **Slot parser, intent and synonym tables, time and place resolution** (`server/api/query/`), with tests that read
   one intent in any word order and with any filler, for any team. Not yet wired in.
2. **Executor**: complete parses run first, as structured questions over the existing families (no rereading of text),
   with the slots on the card; the window clause, place by country or town, and the no-event-yet card.
3. **Relaxation**: when the exact filters return nothing, relax them in a stated order (time window → its season → the
   season before; event → season; place kept). The card says what was relaxed.
4. **Prediction and matchup**: a team at a named event, before and after side by side; two teams' winner, scores and
   odds; Open in Predict pre-filled.
5. **Evaluation harness**: `scripts/search-eval.ts` generates unseen paraphrases from the data model (random teams,
   events, places and windows; shuffled order, filler, synonyms) and checks each answer against the team page, event
   page and match rows, with a latency check. Runs in CI on the shipped snapshot. See "Eval" above.
6. **Aggregated failure patterns**: failed searches are counted by intent, missed word and relaxed filter, and
   reviewed weekly. This replaces the per-query "Failed search" issues.
7. **Delete the old per-query branches** the harness shows are covered.

AI stays optional. If it is ever added, it maps a phrasing to slots only, behind a flag that is off by default, and
deterministic parsing stays the source of every number.
