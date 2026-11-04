# FTC One Search: the layered query path

FTC One Search used to read a query only through phrase templates. Word order, one extra word, or conversational
scaffolding was enough to lose a clear question: "4215 opr rn" returned only the team. This page describes the
redundant layers that read such queries now. Each layer is a deterministic rule or word list. No model or AI step
sits anywhere in the path.

Code:
- `server/api/searchLayers.ts`: the layers.
- `server/api/searchCatalog.ts`: the word lists, reviewed data.
- `server/api/searchLayers.sets.ts`: the paraphrase sets.
- `server/api/searchLayers.test.ts`: the tests.

## 1. The layers, in order

The first layer that gives a direct answer wins, and the answer appears once.

| Layer | What it does | Where |
|---|---|---|
| 0 Normalization | Takes the leading `#` off a team number (`#4215 opr`). Nothing else changes for Layer 1. The word layers fold case, accents and punctuation, read `4215's` as 4215, and keep a season (`2024-25`, `2024 – 25`) as one word. | `normalizeQuery`, `tokens` |
| 1 Templates | The existing readers, unchanged (`searchAnswer.ts` `readerAnswer`). Every template that passed still passes. | `readerAnswer` |
| 1L Long form | A long, conversational question said the short way the readers know, then Layer 1 again (see "Long form" below). It runs when Layer 1 has no stat or card for the query, and its answer counts only when it is one. | `searchLongForm.ts` `longForm` |
| 2 Keywords | The query read as a set of words. It finds the team (a number, a full name, or a unique start of a name such as "hypnotic"), one intent from the catalog, and the scope (season, place, event), in any order. It hands that intent's canonical phrasing to its answer. A team intent the catalog doesn't list ("longest win streak of 4215") uses the team-first phrasing instead: the team, then the other words in typed order, with filler and scaffolding left out. | `extract`, `teamFirst` |
| 3 Paraphrases | `PARAPHRASES` says a phrasing the catalog's way ("from where" → "from", "trophies" → "awards"), then Layers 1 and 2 run again. | `paraphrase` |
| 4 Filler | `FILLER` words are taken out, never inside a team's full name, then Layers 1 and 2 run again. | `stripFiller` |
| 5 Weak signals | A team plus one word that can mean only one intent ("4215 based" → location). A word that could mean two intents is named, never guessed. | `WEAK_SIGNALS` |
| 6 Fallback | The existing answer: the team page with what wasn't answered, or the recovery state. When two intents fit equally, the line names both. | |

Three rules run alongside the order:
- **A filler word never decides an answer.** A query Layer 1 answered is also read without its filler. If that reading answers differently and directly, the filler-free reading wins. For example, "what is opr please" read "please" as the team Please Don't Explode; it now gets the OPR definition.
- **A definition beats a name search** (brief section 10). "what does opr mean" read "mean" as the start of Mean Green Irish Machine; it now gets the OPR definition.
- **A leaderboard, count or winners question with every word read beats an answer about a team the query never named in full.** "opr leaders texas" read "leaders" as Newgen Leaders, and "top win rate" read "top" as Top Shelf BGS; both now get the leaderboard. This also covers a place typed without "in" ("highest opr california").
- **A forbidden word Layer 1 read past is named.** "4215 today opr" still gets the OPR card, and the line adds `"today" isn't part of this answer`.

### Long form

`longForm` (`server/api/searchLongForm.ts`) takes a question's wrapper off and says what it asks as the 260-query list's short form. Fixed rules, first match wins:
- Openers and closers go: "can you tell me", "i want to know", "show me", "please", "for me", "right now", a trailing "?". "4215's" is 4215, and "the team 4215" is 4215.
- Whole-question rules map the phrasing to its intent: "when was the last time 4215 went worlds" → `4215 worlds appearances`, "who did 4215 play with the most" → `4215 most common alliance partner`, "is 4215 better than 6980 at auto" → `4215 versus 6980 who is better at auto`, "what is the highest score 4215 has ever gotten" → `4215 highest score ever`, "what is the opr of team 4215" → `4215 opr`.
- Whatever follows the matched part stays: a season ("last season", "2024-25"), a place, an event's name. It still scopes the answer.
- A short query is never changed (`longForm` returns null).

The layers run once per top-level search: `searchAnswer` calls `layeredAnswer`, and every search made inside it is
Layer 1 only (`opts.inner`). A phrasing that two layers reach is read once (a per-search memo).

## 2. The intent catalog

### 2a. What the keyword layer reads (`INTENTS`)

<!-- gen:catalog -->

| Intent | Family | Keywords (any one) | Team | Scope | Canonical form | Precedence |
|---|---|---|---|---|---|---|
| location | team facts | from, location, located, hometown, come from, comes from | required | none | `4215 location` | loses to school |
| school | team facts | school, high school, organization | required | none | `4215 school` | beats location |
| sponsors | team facts | sponsor, sponsors, sponsored | required | none | `4215 sponsors` | none needed |
| rookie-year | team facts | rookie year, rookie, founded | required | none | `4215 rookie year` | none needed |
| website | team facts | website, web site, site, url | required | none | `4215 website` | none needed |
| opr | team stats | opr, oprs | required | season | `4215 opr` | beats rank |
| rating | team stats | rating, prediction rating, predicted rating, prediction, predicted | required | season | `4215 prediction rating` | loses to next-match, loses to report-card, beats rank |
| record | record | record, wins, losses, win loss, w l, wins and losses | required | season, event | `4215 record at new jersey championship` | beats matches, loses to worlds, loses to win-rate |
| win-rate | record | win rate, win percentage | required | none | `4215 win rate` | beats record |
| rank | record | rank, ranking, ranked, standing | required | place | `4215 rank` | loses to league-rank, loses to opr, loses to rating |
| matches | matches | matches, match, games, schedule, fixtures | required | event | `4215 matches at new jersey championship` | loses to next-match, loses to last-match, loses to high-score, loses to record |
| high-score | matches | highest score, high score, best score, top score, highest scores | required | none | `4215 highest score` | beats matches |
| next-match | next and last | next match, next game, upcoming match | required | none | `4215 next match` | beats matches, beats rating |
| next-event | next and last | next event, upcoming event, next competition | required | none | `4215 next event` | beats events |
| last-event | next and last | last event, most recent event, latest event, previous event | required | none | `4215 last event` | beats events |
| last-match | next and last | last match, last game, most recent match, latest match, previous match | required | none | `4215 last match` | beats matches |
| awards | awards | awards, award | required | season, event | `4215 awards at new jersey championship` | beats events |
| events | events | events, event | required | season, place | built from the term or default | loses to next-event, loses to last-event, loses to worlds, loses to states, loses to awards |
| worlds | worlds and states | worlds, world championship, first championship | required | none | `4215 worlds` | beats record, beats events |
| states | worlds and states | states, state championship, state championships | required | none | `4215 states` | beats events |
| reliability | team stats | reliability, reliable | required | none | `4215 reliability` | none needed |
| league-rank | team stats | league rank, league standing, league ranking | required | none | `4215 league rank` | beats rank |
| report-card | team stats | report card | required | none | `4215 report card` | beats rating |
| versus | versus | vs, versus, v, compare, head to head, better than | optional | none | `4215 vs 6980` | none needed |
| leaderboard | leaderboards | top, best, highest, most, leaders, leaderboard, strongest | forbidden | place | `top opr` | none needed |
| count | counts | how many, number of, count | forbidden | place, season | `how many teams` | none needed |
| winners | winners | won, winner, winners, champion, champions, who won | forbidden | event, season | `who won new jersey championship` | none needed |
| meaning | meanings | define, definition, meaning, means, mean | forbidden | none | built from the term or default | none needed |

Weak signals (Layer 5):

| Weak word | Intents it can mean |
|---|---|
| where | location |
| based | location |
| city | location |
| played | matches |
| won | awards |
| win | awards, next-match (named, never guessed) |
| good | opr |
| strong | opr |
| stats | opr, record (named, never guessed) |

Paraphrases (Layer 3, `PARAPHRASES`), each tested:

| Typed | Read as |
|---|---|
| from where | from |
| where from | from |
| where are they from | from |
| where is it from | from |
| what city | location |
| what town | location |
| what state | location |
| based in | location |
| what school | school |
| which school | school |
| who sponsors | sponsors |
| when did start | rookie year |
| first season | rookie year |
| start year | rookie year |
| offensive power rating | opr |
| tele op | teleop |
| driver controlled | teleop |
| end game | endgame |
| autonomous | auto |
| how many wins | wins |
| win loss record | record |
| games played | matches |
| matches played | matches |
| upcoming game | next match |
| next competition | next event |
| next tournament | next event |
| upcoming competition | next event |
| most recent competition | last event |
| last competition | last event |
| last tournament | last event |
| trophies | awards |
| awards won | awards |
| competitions | events |
| tournaments | events |
| world championships | worlds |
| state champs | states |
| who would win | who wins |
| who will win | who wins |
| leader board | leaderboard |
| highest scoring teams | top opr |
| highest scoring team | top opr |
| top scoring teams | top opr |
| top scoring team | top opr |
| opr leaders | top opr |
| what does mean | meaning |

Precedence pairs not in the brief, each with the example that forced it:
- next-match over matches ("4215 next match"), next-event over events ("4215 next event"), and the same for last-match and last-event.
- next-match over rating ("4215 predicted score next match").
- high-score over matches ("4215 highest score").
- league-rank over rank ("4215 league rank").
- report-card over rating ("4215 prediction report card").
- record over matches ("4215 match record").
- worlds over record ("4215 worlds record" is the Worlds record).
- win-rate over record ("4215 win rate").
- worlds over events and states over events ("4215 worlds events").
- awards over events ("4215 event awards").
- school over location ("which school is 4215 from": "from" is the question's word there).
- opr over rank and rating over rank ("4215 opr rank").

**"based"** is a weak signal: location only when a team is present and no strong keyword is.
**OPR and rating** are separate intents. "opr" never means the prediction rating; "rating", "prediction" and "predicted" never mean OPR. When both are typed and Layer 1 misses the query, the line names both.

### 2b. Every intent the existing readers answer (Layer 1)

Inventoried from the code. Grouped by reader, with the second path each one has now.

| Reader | Intents | Second path |
|---|---|---|
| `searchCoverage.ts` `teamFactAnswer` | location, school, sponsors, rookie year, website | Layer 2 catalog |
| `answers/families/facts.ts` | OPR and each phase's, prediction rating, report card, next match (predicted score), events by season and by place, OPR vs an average, reliability, league rank, schedule | Layer 2 catalog (OPR vs an average and schedule: team-first) |
| `answers/families/matches.ts` | highest and lowest score, biggest win and loss, closest match, first and most recent match, wins count, record with a scope, average score and margin, total points and matches, current and longest streak, last N matches, playoff appearances, blowouts, red/blue record | Layer 2 team-first, catalog for record and most recent match |
| `answers/families/eventScope.ts` | results, rank, OPR and a match at one event | Layer 2 team-first (event words kept in order) |
| `answers/families/events.ts` | best and worst finish, first and last event, best-OPR event, total events, average rank, best season, most improved season, first season, seasons played | Layer 2 team-first, catalog for last event |
| `answers/families/awards.ts` | event wins, Inspire awards, finalist finishes, total awards, award split, awards with a scope | Layer 2 catalog (awards, award by name), team-first |
| `answers/families/twoTeam.ts` | head to head, OPR/rating/win chance/record side by side, opponents, partners, never played | Layer 2 versus; team-first for one team's opponents and partners |
| `answers/families/trends.ts` | OPR history, win rate, average score by event, ranking points, penalties, OPR and record by season | Layer 2 catalog (win rate), team-first |
| `answers/families/winners.ts`, `searchAsks.ts` (award, event won) | winning alliance at an event or Worlds, an award's winner at an event | Layer 2 winners |
| `answers/read.ts` `readLeaderboard`, `searchAsks.ts` (leaderboard, stat) | top N by a stat in a place, best rookie, most improved | Layer 2 leaderboard (by stat and place); rookie and improved: Layer 1, Layer 4 |
| `answers/families/topMatches.ts` | highest-scoring matches of a season, place or event | Layer 1, Layer 4 (no team, no catalog stat: see section 10) |
| `searchCoverage.ts` `explainAnswer` | what a term, game or the rules are | Layer 2 meaning |
| `searchCoverage.ts` `countAnswer` | how many teams or events in a place | Layer 2 count |
| `searchCoverage.ts` `teamListAnswer`, `placeTeamsAnswer`, `monthAnswer`, `worldsAnswer`, `eventPageAnswer` | teams in a place, undefeated, best win rate, average OPR, events in a month, Worlds events, an event's tab or match | Layer 1, Layer 4 (no team: see section 10) |
| `searchCoverage.ts` `rewriteQuery` | every rewrite (compare, partners, penalties, best match, world rank, …) | the rewritten form's own second path |
| `searchQuestions.ts` | Worlds, states, event wins, awards, next event, next match as questions | Layer 2 catalog (worlds, states, awards, next match, next event) |
| `searchHighScores.ts` | a season's or a team's best scores | Layer 2 catalog (high-score) |
| `searchRules.ts` | a rule by number, a penalty, a rules question | Layer 1, Layer 4 (rules text: see section 10) |
| `searchAsks.ts` predictions | will a team win its next match, who wins a pair, who will win an event, will a team advance | Layer 2 versus ("who wins"); the rest Layer 1, Layer 4 |
| `searchEventQuery.ts`, `searchEvents.ts` | a set of events by place, time or year | Layer 1, Layer 4 |
| `searchCompare.ts` | two to four teams side by side | Layer 2 versus |
| `searchIntents.ts` | season, region, ranking, a view that doesn't exist yet | Layer 1, Layer 4 |
| `searchAnswer.ts` | a team number, a name, page words, word-by-word closest | Layer 1 |

Not classified as one intent: the name search, which is whatever names match, and `intentAnswer`'s joined kinds
(season-region-ranking-…), which are combinations.

## 3. Layer coverage

Each row is a paraphrase set. Layer 1 is proved by the canonical form with the keyword layers off. The keyword
layers are proved by every member with Layer 1 off (`setLayersForTest`, a test-only switch that throws outside
Vitest, and is never read from a request or a setting). A ✓ under Layers 2–5 means that layer answered at least one
member with Layer 1 off. "Members" is from the live-data run on the local database; the test suite runs the same
sets on its fixture.

<!-- gen:coverage -->

| Intent | Layer 1 templates | Layer 2 keywords | Layer 3 paraphrase | Layer 4 filler | Layer 5 weak | Members (all same answer, live data) |
|---|---|---|---|---|---|---|
| location | ✓ | ✓ |  |  |  | 13/13 |
| school | ✓ | ✓ |  |  |  | 6/6 |
| sponsors | ✓ | ✓ |  |  |  | 5/5 |
| rookie-year | ✓ | ✓ |  |  |  | 4/4 |
| opr | ✓ | ✓ |  |  |  | 14/14 |
| opr (season) | ✓ | ✓ |  |  |  | 7/7 |
| opr (phase) | ✓ | ✓ |  |  |  | 5/5 |
| rating | ✓ | ✓ |  |  |  | 4/4 |
| record | ✓ | ✓ |  |  |  | 4/4 |
| record (season) | ✓ | ✓ |  |  |  | 4/4 |
| matches | ✓ | ✓ |  |  |  | 4/4 |
| awards | ✓ | ✓ | ✓ |  |  | 5/5 |
| awards (by name) | ✓ | ✓ |  |  |  | 2/2 |
| events (season) | ✓ | ✓ |  |  |  | 6/6 |
| events (place) | ✓ | ✓ |  |  |  | 3/3 |
| next match | ✓ | ✓ |  |  |  | 3/3 |
| next event | ✓ | ✓ |  |  |  | 3/3 |
| last event | ✓ | ✓ |  |  |  | 3/3 |
| worlds | ✓ | ✓ |  |  |  | 3/3 |
| winners (event) | ✓ | ✓ |  |  |  | 2/2 |
| winners (award) | ✓ | ✓ |  |  |  | 1/1 |
| leaderboard (stat and place) | ✓ | ✓ |  |  |  | 5/5 |
| leaderboard (place, no "in") | ✓ | ✓ | ✓ |  |  | 8/8 |
| leaderboard (phase) | ✓ | ✓ |  |  |  | 3/3 |
| count | ✓ | ✓ |  |  |  | 2/2 |
| meaning | ✓ | ✓ |  |  |  | 4/4 |
| team-first (biggest win) | ✓ | ✓ |  |  |  | 3/3 |
| team-first (highest score at an event) | ✓ | ✓ |  |  |  | 2/2 |
| versus | ✓ | ✓ |  |  |  | 5/5 |

## 4. Filler, scaffolding and forbidden words

**Filler, allowlist only** (`FILLER`). Each word was tested in front, middle and end positions of a passing query
from every family, and the answer didn't change. None of them can name a team, intent, place, season, event, award
or stat:

| Words | Why they're filler |
|---|---|
| rn, right now, currently, at the moment, at this moment | "Right now" with no date or season: every answer is already the latest season's or today's. |
| please, pls, plz, just, really, basically, actually, quick, kindly | Politeness and softeners; no team, place or stat is said with them. `plz` is an extension: the same word as `pls`. |
| hey, hi, hello | Greetings, only beside a team and an intent: a greeting alone is no query and is never rewritten. |

A filler word inside a team's full name stays: "just in time opr" keeps "just" when Just In Time is a team. That is
checked against every stored name.

**Scaffolding** (`SCAFFOLD`) is read by the keyword layer around the team, the intent and the scope, never by plain
stripping and never inside a team's full name. It covers:
- question words (what is, how, does, tell me, show me, give me)
- the brief's conversational words (what was, was, were, called, named, this team, the team, team called)
- connectors (of, in, for, at, the)

"Year" right after a game's name is dropped once the game maps to its season: "decode year" reads as 2025–26, and
the line says "2025-26". **"Like" is never dropped**, which is stricter than the brief allows: "teams like 4215" asks
for similarity, which isn't supported, so it falls back honestly.

**Forbidden** (`FORBIDDEN`), never dropped and never ignored:
- not, never, no, without, except, excluding
- vs, versus, or, and, than, better, worse
- before, after, next, last, this, yesterday, today, tomorrow, this week, this month, this weekend

Team numbers, names, places, events, awards, games and stat words are never in any list. Every forbidden word is
tested in "4215 `<word>` opr". Each one either stops the OPR card (team fallback, with the word in the line) or, when
Layer 1 reads past it ("today", "this week"), gets the line `"<word>" isn't part of this answer`.

## 5. Paraphrase sets

Every member must return the canonical form's answer: the same card, stat, number, team and section.

<!-- gen:sets -->

- **location** (`4215 location`): question: "where is 4215 from"; reversed: "4215 from where"; reversed: "4215 where from"; question: "where does 4215 come from"; statement: "4215 located"; name: "hypnotic robotics location"; of: "location of 4215"; filler: "please 4215 location"; filler: "4215 please location"; filler: "4215 location please"; slang: "4215 location rn"; long: "hey where is the team called hypnotic robotics located right now please"; statement: "4215 hometown"
- **school** (`4215 school`): question: "what school is 4215"; of: "school of 4215"; filler: "4215 school please"; reversed: "school 4215"; name: "hypnotic robotics school"; long: "what is the school of this team called hypnotic robotics right now"
- **sponsors** (`4215 sponsors`): question: "who sponsors 4215"; of: "sponsors of 4215"; filler: "4215 sponsors pls"; reversed: "sponsors 4215"; name: "hypnotic robotics sponsors"
- **rookie-year** (`4215 rookie year`): of: "rookie year of 4215"; reversed: "rookie year 4215"; filler: "4215 rookie year please"; long: "what is the rookie year of the team called hypnotic robotics please"
- **opr** (`4215 opr`): of: "what is the opr of 4215"; question: "what is 4215 opr"; question: "show me 4215 opr"; reversed: "opr 4215"; filler: "rn 4215 opr"; filler: "4215 rn opr"; filler: "4215 opr rn"; slang: "4215 opr right now"; filler: "what is 4215 opr right now"; filler: "what is the opr of 4215 rn"; name: "hypnotic robotics opr"; filler: "currently 4215 opr"; filler: "4215 opr at the moment"; long: "what is the opr of the team called hypnotic robotics right now please"
- **opr (season)** (`4215 opr decode`): long: "what was the opr of this team called hypnotic robotics in the decode year"; name: "hypnotic robotics opr decode"; scope: "decode 4215 opr"; scope: "4215 decode opr"; scope: "4215 opr 2025-26"; scope: "2025-26 opr 4215"; filler: "4215 opr decode please"
- **opr (phase)** (`4215 auto opr`): of: "auto opr of 4215"; reversed: "auto opr 4215"; statement: "4215 auto"; filler: "4215 auto opr rn"; question: "what is 4215 auto opr"
- **rating** (`4215 prediction rating`): of: "prediction rating of 4215"; reversed: "prediction rating 4215"; filler: "4215 prediction rating please"; long: "what is the prediction rating for the team called hypnotic robotics right now"
- **record** (`4215 record`): reversed: "record 4215"; of: "record of 4215"; filler: "4215 record please"; name: "hypnotic robotics record"
- **record (season)** (`4215 record 2024-25`): scope: "2024-25 4215 record"; scope: "4215 2024-25 record"; of: "record of 4215 in 2024-25"; filler: "4215 record 2024-25 please"
- **matches** (`4215 matches`): reversed: "matches 4215"; of: "matches of 4215"; filler: "4215 matches please"; question: "show me 4215 matches"
- **awards** (`4215 awards`): reversed: "awards 4215"; of: "awards of 4215"; filler: "4215 awards please"; statement: "4215 trophies"; name: "hypnotic robotics awards"
- **awards (by name)** (`4215 inspire award`): reversed: "inspire award 4215"; filler: "4215 inspire award please"
- **events (season)** (`4215 events in 2025-26`): scope: "2025-26 4215 events"; reversed: "events 2025-26 4215"; scope: "4215 2025-26 events"; of: "events of 4215 in 2025-26"; filler: "4215 events in 2025-26 please"; statement: "4215 competitions 2025-26"
- **events (place)** (`4215 events in new jersey`): scope: "new jersey 4215 events"; scope: "4215 new jersey events"; filler: "4215 events in new jersey please"
- **next match** (`4215 next match`): of: "next match of 4215"; reversed: "next match 4215"; filler: "4215 next match please"
- **next event** (`4215 next event`): of: "next event of 4215"; reversed: "next event 4215"; filler: "4215 next event please"
- **last event** (`4215 last event`): reversed: "last event 4215"; filler: "4215 last event please"; statement: "4215 most recent event"
- **worlds** (`4215 worlds`): reversed: "worlds 4215"; filler: "4215 worlds please"; name: "hypnotic robotics worlds"
- **winners (event)** (`who won new jersey championship`): filler: "who won new jersey championship please"; statement: "new jersey championship winners"
- **winners (award)** (`who won inspire at new jersey championship`): filler: "who won inspire at new jersey championship please"
- **leaderboard (stat and place)** (`top opr in new jersey`): scope: "best opr nj"; scope: "nj best opr"; filler: "top opr in new jersey please"; scope: "new jersey top opr"; statement: "highest opr in nj"
- **leaderboard (place, no "in")** (`top opr in texas`): scope: "highest opr texas"; scope: "texas highest opr"; statement: "opr leaders texas"; statement: "opr leaders in texas"; statement: "highest scoring team texas"; statement: "highest scoring team in texas"; scope: "top opr texas"; filler: "opr leaders texas please"
- **leaderboard (phase)** (`top auto opr`): filler: "top auto opr please"; statement: "best auto opr"; slang: "best auto rn"
- **count** (`how many teams in new jersey`): filler: "how many teams in nj please"; statement: "number of teams in new jersey"
- **meaning** (`what is opr`): statement: "define opr"; reversed: "opr meaning"; filler: "what is opr please"; question: "what does opr mean"
- **team-first (biggest win)** (`4215 biggest win`): of: "biggest win of 4215"; filler: "biggest win of hypnotic robotics please"; question: "what is 4215 biggest win rn"
- **team-first (highest score at an event)** (`4215 highest score at new jersey championship`): reversed: "highest score at new jersey championship for 4215"; filler: "4215 highest score at new jersey championship please"
- **versus** (`4215 vs 6980`): filler: "4215 vs 6980 please"; statement: "compare 4215 and 6980"; statement: "4215 versus 6980"; question: "is 4215 better than 6980"; name: "hypnotic robotics vs bad wolf"

## 6. Scope

- **Position.** Season, place and event words are found wherever they are. Tested in the "scope" members and in "scope is found before, after or between the team and the intent".
- **Season.** A season label (`2024-25`), a game's name (`decode`, with "year", "season" or "game" after it), "this/last season" and a bare year are all handed to the answer as typed. The answer maps them by its existing rules, so no year is mapped two ways:
  - A bare year is its season for a team's stats (2025 is 2025–26).
  - A bare year is the year the event was held for winners and Worlds (2025 is April 2025, the 2024–25 season).
  - "Last season" and "last year" are the latest finished season (the owner's rule).
- **A year as the team.** A bare year with nothing else naming a team is the team's number ("2024 reliability"), as in `readTeamFact`. When something else names the team, the year is the season ("2025 4215 events").
- **Place.** A state's name or code, a province or a country (`regionOf`). The line says the resolved place when it differs from what was typed ("nj" → "New Jersey").
- **Event.** A run of words with an event word in it (championship, qualifier, league, meet, division, …), or one after "at". A place next to it is part of its name ("new jersey championship").
- **Defaults when no scope is given.** Each intent's existing default applies, and the answer's title says it (for example "OPR in 2025–26"). The one new default: a team's events with no season name the team's latest season with an event. The line says `read as "4215 events in 2026-27"`.
- **Every filter typed stays in the phrasing handed on**: place and season together for events, event and season together for record and awards. A weak word's intent is checked the same way, so "4215 based 2024-25" isn't the current listing.
- **Scope an intent can't take blocks it**, rather than being dropped: "4215 location 2024-25" isn't read as the location.

## 7. Precedence and ambiguity

The brief's precedence, in order: two teams, event scope, award winners, specific stat, definition, pages.
- Two teams found means versus, whatever stat word is beside them ("4215 opr vs 6980").
- Pages never come from the word layers.
- A name next to a typed number is a second team only when the query joins them (vs, and, or, &).

**Ambiguous pairs found in testing, and what happens:**

| Query | Candidates | Outcome |
|---|---|---|
| 4215 awards location | awards, location | Team page; line: `read as 4215 with awards or location: say which`. Reported as ambiguous. |
| 4215 sponsors school | sponsors, school | Not ambiguous: both are facts from FIRST's listing, so both are answered, each on its own line (teamFactAnswer). |
| 4215 stats | opr, record (weak word) | Layer 1 already answers it (the team's OPR section), so it never reaches the line. |
| 4215 win | awards, next-match (weak word) | Layer 1 answers it with the team. |
| 4215 opr rating | opr, rating | Layer 1 answers it (the prediction rating). Kept: a later layer never overrides an earlier direct answer. |

The ambiguity line is given only when every word was read and one team was found. A query with unread words is not
two clear readings.

## 8. The reading line

An answer reached by a later layer keeps its own label (the page's heading), and the phrasing it read goes in
`understood.showing`, which /search shows as a quiet line under the heading: `Showing: 4215 opr 2025-26`.
- The heading never quotes a rewritten query.
- A rewrite or a dropped word never adds a word to the meaning of the query.
- Layer 6 says plainly that the question isn't answered directly yet and never quotes it: `Hypnotic Robotics (4215) · This isn't answered directly yet`. Under it, `suggest` holds two or three questions search answers about the team, built from its records (a Worlds trip, an award, a season of matches), the ones nearest what was asked first. Failed-search reporting (Track B) reads the same outcome, so the line and the issue agree.

## 9. Outcome for failed-search reporting (Track B)

`searchOutcome(answer)` returns, for a top-level `searchAnswer()` call:
- `typed`
- `normalized`: lowercased, the `#` and filler taken off. This is the aggregation key.
- `layers`: the layers tried.
- `won`: the layer that answered, or null for Layer 6.
- `result`: `answered`, `no-match`, `team-fallback`, `weak`, `name-search-only`, `empty` or `ambiguous`.
- `team`, `intents`, `scope`, `filler`.

It is synchronous and read from a WeakMap keyed by the answer object, so nothing is added to the response JSON. A
copy of the answer has no outcome, and neither does an inner or `intents: false` search. Reporting calls it after the
answer is built; nothing in the layers writes, logs or calls GitHub.

## 10. What this work doesn't do, and why

- **Intents with no team and no catalog word** have Layer 1 and Layer 4 only: the Layer 1 rerun on the filler-free query. Their phrasings are free text with no fixed keyword: rules questions, sets of events, a season's best matches, teams in a place. The brief asks for two independent layers per intent. For these, the second path is the filler retry, not a keyword reading. Adding a keyword reading for each means new catalog rows, not phrasing work.
- **The keyword layer hands a canonical phrasing to the intent's existing answer.** It doesn't call each family's internals. "Layer 1 off" therefore means the typed query is never matched against a template; the keyword layer finds team, intent and scope itself. Each canonical phrasing is pinned by the coverage test, so a template change that breaks one fails CI.
- **Case is folded only for the word layers.** Layer 1 still reads the typed case, because state codes like "IN", "OR" and "ME" read differently by case. That was a doubt case under Layer 0's rule.
- **Found while testing, not fixed here** (other features' readers):
  - "4215 no opr" reads as team 9215 (Team Talos). It now says `"no" isn't part of this answer`.
  - "what is teleop" and "what is endgame" have no definition.
  - "how many teams 2024-25" is read as names.
  - The long-form query takes 4–7 s locally. Almost all of that is Layer 1's existing word-by-word search before it gives up; the layers add about 20 ms.
