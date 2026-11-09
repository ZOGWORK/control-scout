# Changelog

What changed in Control Scout, newest first. The prediction engine has its own
changelog in `packages/predict-engine/CHANGELOG.md`.

Each release opens with a `### Highlights` block: 3 to 5 short lines a visitor
would notice, each starting with a `[tag]` that picks its icon (home, predict,
teams, scout, offline, speed, live, report, alerts, rankings, share, workspace,
picklist, history, fixes, appearance). What's new shows them first; the groups below are
the full release notes, one click away.

Releases count 1.1, 1.2, 1.3 …, the last number being the step inside one:
after 1.3.7 comes 1.3.8, then 1.3.9, then 1.4.0. No number goes past one digit.
(Releases before 1.3.7 were renumbered from the old 1.5.0 … 1.37.0; the old
fix releases 1.8.1, 1.16.1–2 and 1.19.1–2 are now 1.0.8.1, 1.1.6.1–2 and
1.1.9.1–2.)

## 4.5.0 — 2026-11-08

Search answers an event's average match score, and puts two events side by side.

### Highlights
- [rankings] "Average match score at" an event answers, with and without penalties
- [rankings] Two events' average scores side by side, the higher one highlighted
- [fixes] "NJ Championship" finds the New Jersey Championship

### Search
- **Event average match score.** "Average match score at <event>" gives the mean alliance score over its played matches (divisions included), with and without penalties, its highest score and match count; "… versus <event>" shows two events side by side and which averages more; a state's code ("NJ Championship") is that state's championship. (#1125)

## 4.4.9 — 2026-11-08

Boards over every season: the team that has played the most seasons, the oldest teams still active, and the most matches, events or wins ever.

### Highlights
- [rankings] "Which team has played the most seasons" answers
- [rankings] "Oldest team still active in New Jersey" by rookie year
- [rankings] "Most wins ever" counts every season

### Search
- **Career boards.** "Ever", "of all time" or "in history" said with the team with the most matches, events or wins counts every season on record, not one. "The most seasons" (from FIRST's rookie year to the team's latest season with a match) and "the oldest team still active" (a match in either of the two latest seasons, the earliest rookie year first) are boards of their own, in a place or worldwide. A rookie year before FTC's first season is a directory slip and never counted. (#1111)

## 4.4.8 — 2026-11-08

Two events named side by side ("<event> vs <event>") are compared as events rather than read as two teams: how strong each field was, its best OPR, its high score and how many teams played.

### Highlights
- [rankings] "Ohio Championship vs Texas Championship" compares the events
- [rankings] Each event's field strength, top OPR, high score and teams
- [fixes] Two events named with "vs" are no longer read as two teams

### Search
- **Events side by side.** "<event> vs <event>" (2 to 4 events, each named with a word only an event's name has: championship, qualifier, league meet, tournament…) answers with the events side by side: field strength (the average OPR of the teams that played, its divisions' too), top OPR and its team, high score without penalties, and the number of teams. A state's code in a name is spelled out ("NJ Championship" is New Jersey's), each event is its newest season with a played match unless a season is named, and events from different seasons are marked as different games, with neither called stronger. A team on any side keeps the teams' Compare. (#1158)

## 4.4.7 — 2026-11-08

A climb in rank: the teams that went from one OPR rank or below to the top of another, from one season to the next.

### Highlights
- [rankings] "Teams that climbed from rank 1000+ to top 100"
- [rankings] Worldwide OPR rank, the season before to this one
- [rankings] In a place too: "which NJ teams rose from rank 500"

### Search
- **A climb in rank.** "Teams that improved from rank 1000+ to the top 100 in one season", "which NJ teams climbed from rank 500 to the top 50" and the like read as the most improved board, kept to the teams ranked at or below the first number worldwide by OPR the season before and at or above the second this season. A fall ("from rank 10 to rank 100") is never read as a climb. The most improved table shows each climb as one column of ranks ("#6283 → #77"), so it fits a phone, and People also ask never names a place the card answered without. (#1121)

## 4.4.6 — 2026-11-08

Compare asked for one team opens Compare with it, and suggests its closest rivals.

### Highlights
- [teams] "Compare" and one team opens Compare with that team in it
- [teams] Its closest-rated rivals nearby, each one tap to compare
- [fixes] A season named carries into each suggested comparison

### Search
- **Compare one team.** "Compare" and a single team (by number or name) opens Compare with that team in it, ready for more, and suggests the two or three teams rated closest to it in its state (else its country) as comparisons that each answer. (#1120)

## 4.4.5 — 2026-11-08

Steady boards: the most stable OPR from event to event, and the teams strongest in every phase, in a place or worldwide.

### Highlights
- [rankings] "Which team has the most stable OPR" answers
- [rankings] The smallest swing in OPR over 3+ events
- [rankings] "Most consistent across all phases" by the weakest phase

### Search
- **Steady boards.** "Which team has the most stable OPR, least ups and downs" ranks teams by the smallest swing in their event OPRs in the season (the standard deviation as a share of their average, teams with an OPR at 3 or more events). "Which NJ team is most consistent across all phases" ranks by each team's weakest phase OPR rank worldwide (auto, teleop and endgame; auto and teleop where teleop includes endgame), so a team strong in one phase alone doesn't lead. Counted at some events only, or on a day, is left to search. (#1124)

## 4.4.4 — 2026-11-08

OPR gained within a season: the teams whose OPR grew the most from their first event to their last, in a place or worldwide.

### Highlights
- [rankings] "Most improved teams in NJ by OPR gain" answers
- [rankings] First event's OPR to the last's, 2+ events
- [rankings] "Which team improved its OPR the most" reads

### Search
- **OPR gained.** "Most improved teams by OPR gain", "which team improved its OPR the most between its first and last event" and "gained the most OPR across the season" rank teams by their OPR at their last event of the season less their OPR at their first, by date (without penalties, as the team page shows them), teams with an OPR at 2 or more events, in a place or worldwide. "Most improved" alone stays the climb in standing from the season before. (#1116)

## 4.4.3 — 2026-11-08

"How many" before a list of teams counts it, and two years or seasons side by side compare: "how many NJ teams went to worlds in 2024, versus 2025".

### Highlights
- [rankings] "How many NJ teams went to worlds in 2024" counts them
- [rankings] Two years side by side: "2024 versus 2025"
- [rankings] Each year's list sits under its count

### Search
- **A list counted, in one season or two.** "How many", "number of" or "count" before a list of teams (a place, Worlds, an award won, an OPR threshold) answers with the list, its length the headline. Two years or seasons after it ("in 2024 versus 2025", "2025-26 vs 2024-25") read the same list once with each: both counts side by side, the change, and each season's own list under it. A Worlds year is the championship held that year, so 2024 is the 2023–24 season, said on the card. A card comparing two seasons offers no one season to pick. (#1094)

## 4.4.2 — 2026-11-08

The team with the most matches, wins or events can be asked for a few days ("which team played the most matches this week"), and said "by any team … top 5".

### Highlights
- [rankings] "Most matches played this week" counts the week's matches
- [rankings] No matches yet this week shows the latest week, said
- [rankings] "Most matches played by any team, top 5" reads

### Search
- **Count boards in a window, said any way.** "This week", "last week", "this month", "today" said with the team with the most matches, wins or events counts that team's played matches in those days from the match rows (a match by its own date, else its event's first day), its record there beside it; awards have no date and get no window board. With none in the window yet, the latest seven days with a match are shown, said on the card. "Most matches played by any team …, top 5" is the same board, the count asked; "worldwide" adds nothing. (#1098)

## 4.4.1 — 2026-11-08

A question about "my" or "our" team ("what is my 4215 next event", "our 6980 record") is answered for that team.

### Highlights
- [fixes] "what is my <team> upcoming event" shows its next event
- [fixes] "our team <number> record" reads as that team's record
- [fixes] An intent word typed wrong after "my <team>" still answers

### Search
- **Whose team it is.** "my" or "our" before a team's number says whose team it is, never part of what's asked, so a long question about it reads the way the same question about the team does. (#1123)

## 4.4.0 — 2026-11-08

A number written with thousands separators ("1,000", "12,500") is read as one number, never as a team.

### Highlights
- [fixes] "opr over 1,000" reads one thousand, never team 1
- [fixes] "12,500 points" is one number, with no stray "500"
- [fixes] Commas between team numbers still list each team

### Search
- **Thousands separators.** A number written with thousands separators is one number everywhere search reads it (the query cleaner, the parser, the layers and name matching), never a team and a leftover "000". A name written that way ("1,000 Lakes") is found either way; the search index is rebuilt once for it. Commas between team numbers ("1, 12 and 4215") and in dates stay as they were. (#1157)

## 4.3.9 — 2026-11-08

A team is found by the part of its name that is its own: without "Team" or "Robotics" around it, with its words typed apart, or with its last word made plural. A name two teams share reads as the one that played most recently, as the question reader already does.

### Highlights
- [teams] Find a team without "Team" or "Robotics" in its name
- [teams] A name typed with a space inside it still finds the team
- [fixes] Facts like a rookie year answer for a name two teams share
- [fixes] "<name> stuff, like everything" lists the team

### Search
- **A team called by its name's own part.** The query parser, the word layer and the last-stop name reader read a team from its name without the words that only say it is a team, from its name typed with a space inside a word, or with its last word made plural, when no team's whole name is the words. A team that has not played yet, named so, is the answer rather than a closest match. A name several teams share is read as the one that played most recently, when only one did. "Stuff", "everything", "like" and "info" after a name are not part of it. (#1105)

## 4.3.8 — 2026-11-08

Search reads its own words when they are typed wrong, run together or short: a letter added inside a word, six letters jumbled, two words typed as one, and, when nothing else answers, a word one slip from a question word. A place typed right after a name several teams share picks the team.

### Highlights
- [fixes] Question words with a letter jumbled or added still answer
- [fixes] Two words typed as one are read apart, with a Did you mean
- [fixes] A place after a shared team name picks which team you meant
- [fixes] A team name with "latest" after it shows its newest match

### Search
- **Intent words typed wrong.** Every word the query parser reads is a word spelling knows; a letter added inside a word is corrected rather than read as an ending; six-letter words jumbled (and a common word of the data's, like a division's name) are corrected; between two as close, the fewer plain edits wins; two of search's own words typed as one are split; and a query that finds nothing tries a name's word or a three-letter word as the question word it is one slip from, kept only when that reading answers. Each shows "Did you mean". A team's name followed by a place picks the team in that place without narrowing its matches to the place, and "latest" beside a team is its most recent match. (#1076)

## 4.3.7 — 2026-11-08

"cham" said for a championship ("who won inspire in nj cham") finds that place's newest championship.

### Highlights
- [fixes] "nj cham" is New Jersey's championship, its newest one
- [fixes] "who won inspire in nj cham this year" names this season's
- [fixes] "cham" after a place works like "champ" and "champs"

### Search
- **"cham" is "champ" cut short.** A place's "cham" is its newest championship, as "champ" and "champs" are, never an older event whose name has the word. (#1122)

## 4.3.6 — 2026-11-08

More plain searches answered: a team's highlights by part of its name, events said the way people say them, and a team's losses by a set margin.

### Highlights
- [fixes] "Hypnotic highlights" finds the team from part of its name
- [fixes] "ultraviolet nj highlights" picks the team in that state
- [fixes] "Jackson division finals" opens the division's playoffs
- [fixes] "Which match did <team> lose by 1 point" lists those losses

### Search
- **A team's highlights by part of its name, or with its place.** "hypnotic highlights", "revAmped highlights" and "ultraviolet nj highlights" are that team's highlights. The words left over are looked up the way a team's stats look them up, and each has to start a word of the team's name. When teams share a name, the place said picks the one from there. (#1197)
- **Now and yesterday.** "nj meets now" is today's events, as "right now" already was. "nj events yesterday" is yesterday's, and reads the same as "events in nj that finished yesterday".
- **A season said any way.** "how many teams in nj 2025-2026", "… decode year" and "…, centerstage" read the same as "… 2025-26": the years written long, or the season's game, are that season.
- **A team's matches at its latest meet.** "6980 matches at recent meet" and "6980 matches at their most recent meet" are its results at its latest event, never an event with those words in its name.
- **A kind of event a place or name has none of.** "meets in Massachusetts" lists Massachusetts' events of every kind and says it has no meets. "bergen qualifier" lists the events named Bergen and says none is a qualifier.
- **A division by its name and a game.** "edison centerstage" is the Edison Division in 2023–24. "jackson division finals" and "parkway division rankings" open that division's tab, the way a match number already did. A division named with a season it wasn't held in ("jackson division finals in centerstage") says so, with that season's divisions and the season it was held.
- **Worlds' divisions.** "worlds division highlights" is every division at Worlds. "what division was <team> in at worlds" is the team's Worlds divisions, never its latest event with "division" in its name.
- **Lost or won by N points.** "which match did <team> lose by 1 point" and "did <team> win by 10 points" list the matches decided by exactly that many points, newest first, and say so when there are none.

## 4.3.5 — 2026-11-08

A finished meet whose stream was a short link plays its recording on the page again.

### Highlights
- [live] A short-link stream (ftcwa.live/…) plays on the page after the meet
- [fixes] Watch on a match starts the page's player at that match, not YouTube
- [live] Only the meet's own broadcast is kept, checked against its dates

### Fixes
- **Short stream links after the meet.** A region's short link (ftcwa.live/…) was only followed on the meet's own dates, so a meet whose day passed before it was followed kept no video: Watch livestream and each match's Watch opened YouTube instead of playing on the page. For two weeks after a meet with no video, its link is followed again, and the video it leads to is kept only when YouTube says that broadcast started on the meet's own dates (a link already pointing at a later meet gives nothing). (#1210)

## 4.3.4 — 2026-11-08

One team swapped for another on an alliance answers with what the swap does.

### Highlights
- [predict] "Swap <team> for <team>" shows the two teams side by side
- [predict] "Replace", "trade" and "if I swap … in a match with" too
- [predict] The card says who goes out, who comes in, and the partner

### Search
- **A team swapped for another.** "If I swap <team> for <team> in a match with <team>", "replace … with … beside …", "trade … for …": on an alliance the predicted score moves by the gap in the two teams' ratings, so the answer is their call side by side, labelled with who goes out, who comes in and the partner. Any verb of swapping ("switch", "sub", "substitute"), "what would happen if …", who is asking ("we", "you") and "next to" for beside read the same; "in" said with the first team ("sub in <team> for <team>") brings it in. Every season asked is left to search, as the call is one season's. (#1115)

## 4.3.3 — 2026-11-08

Who a team should pick at an event is a question search answers, with Scout's pick helper on that event's teams: the partner that fills the team's gaps first.

### Highlights
- [picklist] "Who should <team> pick at <event>" ranks the event's teams
- [picklist] "Teams that complement <team>'s weak endgame" shows endgame
- [picklist] After selection, the suggestions beside who was picked

### Search
- **Who to pick.** "Who should <team> pick at <event>", "best second pick for <team> at worlds", "which alliance partner would be best for <team> at <event>" and "teams that complement <team>'s weak endgame" are the pick helper's suggestions at that event (its Worlds or state championship division; none named, the team's next event, else its latest), the partner covering the most of its radar first. A stat named gets its own column; once selection is over, the suggestions as it opened sit beside the partners actually picked. (#1093)

## 4.3.2 — 2026-11-08

Search ranks a place's cities by their teams, lists the events over a size, and reads a town said with its state or country.

### Highlights
- [rankings] "Which city in Romania has the most teams" ranks its cities
- [fixes] "Events in Texas with more than 40 teams" lists them
- [fixes] "Teams in Springfield IL" is that Springfield, not every one
- [fixes] "4215 RP" shows last season while this one has none yet

### Search
- **Cities by teams.** "Which city in Romania has the most FTC teams", "cities with the most teams in Texas" and "top 5 cities in Ontario by teams" rank a state's, a country's or the world's home cities by how many of their teams played in the newest season there, with every team the directory lists beside; each city opens its own team list.
- **Events over a size.** "Events in Texas this season with more than 40 teams" (or "over", "at least", "40+") counts the events with that many teams on their lists and lists the biggest of them.
- **A town and its state.** "Teams in Springfield IL", "teams in Springfield Missouri" and "teams in Bucharest Romania" list that town's teams only; a town abroad is named with its country.
- **Asked another way.** "Where is this team 4215" shows where the team is from, "hypnotic robotics winner" and "4215 titles" list the events it won, and "how many NJ teams went to worlds in 2024" lists them with their count. A number of teams ("more than 40 teams") is never read as a team's number. "Rookie teams at the NJ championship" ranks the event's teams in their first season, and "which teams should I scout at NJ states" lists the ones worth watching. "Rookie year of calamari" (a fact before the team, its name without "Team") and "which team in New Jersey has the most awards, ever" answer, "4215 matches with more than 200 points" counts them, and "lose by 1 point" no longer reads team 1.
- **The latest season with a value.** A team's ranking points (or another per-event number) with no season said reads the latest season that has one, and says so, while this season's rankings aren't posted yet. (#1181)

## 4.3.1 — 2026-11-08

Each team's colour key on a side-by-side card is a full-size tap target on a phone, even for a short team number.

### Highlights
- [fixes] A short team number's colour key is easy to tap on a phone
- [fixes] Side-by-side cards keep their keys the same size
- [fixes] Nothing changes on a wider screen

### Search
- **Team keys, easy to tap.** The colour key above a side-by-side card's bars ("207", "8902") is at least 44px wide on a phone as well as 44px tall, so a two- or three-digit team number isn't a narrow target; from tablet width up it sizes to its text as before. (#1176)

## 4.3.0 — 2026-11-08

A search answer's season can be switched in place: the season chip at the top right of the card lists the seasons there's data for, and picking one shows the same answer for that season.

### Highlights
- [history] Switch a search answer to another season from its chip
- [history] Only seasons with data for that team are listed
- [share] The picked season stays in the link

### Search
- **A season picker on every answer.** The season chip at the top right of an answer card ("2026–27" beside Full team page, or above a season's list) opens the seasons the answer's team has data for, or every season for a list, newest first with the game's name. Picking one asks the same search about that season, whether the season was the default or typed ("<team> DECODE highlights" can still switch to 2024–25), while the last answer stays on screen dimmed. The pick is in the address (`?in=2024`), so reload, Back and shared links keep it, and People also ask follows it: two teams' OPR and record questions now say the season too. (#1173)

## 4.2.9 — 2026-11-08

Topic words are read as the topic, not as a team that happens to share the name, and a misspelled "highlights" or "videos" is corrected.

### Highlights
- [fixes] "NJ states alliances" shows the championship's alliances
- [fixes] "Most Inspire Awards" lists the teams that won it most
- [fixes] A team's highlights or videos open even with the word misspelled
- [fixes] "4215 average OPR", "4215 RP" and "who has 4215 played with" answer
- [rankings] "Top teams this week" ranks the teams that played this week

### Search
- **Topic words stay topics.** A phrase made only of topic words ("alliances", "inspire awards", "event results") reads as a team only when it is that team's whole name, so "nj states alliances" (or "alliance selection", "alliance captains") opens the championship's Playoffs tab and "most inspire awards" ranks the teams by Inspire Awards won, worldwide or in a region; "inspire" is no longer pluralized into a team name, and a misspelling of "highlights" or "videos" is corrected to that word.
- **Plain team asks.** "Average OPR" is the OPR (already a per-match average), "RP" is ranking points, and "who has 4215 played with" (or "teamed up with") lists the alliance partners. A name several teams share puts the team that has played the most matches first, so "ultraviolet record" is the record of the Ultraviolet people mean most often.
- **Said another way.** "The most points any team scored in a single match" and "the top 3 matches of all time, by total score" are the highest-scoring matches; "…, in order, with scores" at the end of a match list, and "on this site", are read past.
- **Top teams this week.** "Top teams this week", "best teams in NJ last weekend": the teams that played at an event held then, ranked by their OPR at those events, with their record there.
- **Biggest events.** "Which event had the most teams in California this season", "largest qualifiers in Texas" and "biggest event" rank a place's events by the teams on their lists, an event's divisions counted together; "highest auto matches" lists the matches with the most auto points; "biggest event ever" looks across every season, and "top 3 matches" lists three.
- **A school's teams.** "How many teams at Clearview Regional High School" lists the teams FIRST lists at that school, as "teams in <town>" does for a town. (#1180)

## 4.2.8 — 2026-11-08

Search answers who is ranked just above and just below a team. "Who is ranked just above and just below 4215 worldwide in 2025-26" shows its world OPR rank, with the teams on either side of it.

### Highlights
- [rankings] A team's world OPR rank lists the teams just above and below
- [rankings] "Who is ranked just above <team>" shows its neighbors
- [rankings] "Teams ranked near <team>" works for a season or a place too

### Search
- **The teams around a team's rank.** "Who is (ranked) (just, right, directly) above / below / ahead of / behind <team> (worldwide, in the world rankings)" and "teams ranked near (around, close to) <team>" read as the team's OPR rank, keeping a season ("in 2025-26", "last season") or a place ("in new jersey"). The world OPR rank answer now lists the two teams above and below it on the season's world OPR list, as a place's rank already listed its own. "At worlds" isn't read as a rank question. (#1110)

## 4.2.7 — 2026-11-08

Three more basic searches answer what was asked: a country is never read as a town, a name spelled exactly as typed comes first, and "<team> vs <team> record" is their record against each other.

### Highlights
- [teams] "Teams in <country>" lists that country's teams
- [teams] The team spelled as you typed comes first
- [teams] "<team> vs <team> record" gives their head to head

### Search
- **A country is never a town.** "Teams in Romania", "best team in Canada" list that country's teams. Before, a team that gives its country as its home city made the answer that one team. (#1178)
- **The spelling typed, first.** When two teams' names score the same ("RoboRebels" and "Robo Rebels"), the one spelled exactly as typed comes first in the results.
- **"<team> vs <team> record".** Their record against each other, as "<team> record against <team>" gives. Each team's own season record is still "<team> and <team> record".

## 4.2.6 — 2026-11-08

Basic team searches answer what was asked: "<team> rank" gives its world rank, a team's latest event asked for its ranking leads with the rank, a league's standing counts the whole league, and a name two teams share works beside the number.

### Highlights
- [rankings] "<team> rank" answers with the team's world rank
- [rankings] "Latest event ranking" answers with the rank there
- [rankings] A league standing is out of the whole league
- [teams] A team's name and number together are one team

### Search
- **A team's rank, asked plainly.** "<team> rank", "<team> ranking", "<team> standing" and "where does <team> rank" answer with its world rank by OPR and by prediction rating, as "<team> rank worldwide" does, instead of only the team's link. A place, an event, a league or a stat named still goes to that answer.
- **Rank at an event, asked.** "<team> latest event ranking", "last event rank", "first event standing" lead with the team's qualification rank there instead of its OPR. A league meet has no rank of its own (its rank is the league's running standing), so the answer is the latest ranked event, and it says which meet it skipped and why. (#1175)
- **League standing out of the league.** "<team> league rank" counts every team ranked in that league's meets this season up to that meet's date, not only the teams at that meet, so a standing is never larger than its count.
- **A shared name with its number.** When several teams share a name, typing one of their numbers beside it ("<name> <number> highlights") is that one team, in either order, instead of two teams and no answer.

## 4.2.5 — 2026-11-08

Two teams are read with the stat asked first ("who has the higher OPR, A or B"), a forecast asked as a question ("will A beat B") and penalties side by side.

### Highlights
- [fixes] "Who has the higher OPR, 4215 or 7149" compares their OPRs
- [fixes] "Will 4215 beat 7149" shows the predicted winner
- [fixes] "Who has better penalties, 207 or 8902" compares fouls given
- [fixes] Three teams compared "on auto, teleop and endgame" get the card

### Search
- **Two teams, the stat asked first.** "Who has the higher OPR, rating or reliability, A or B", "who scored more, A or B", "will A beat B" and "predicted winner A vs B" each read as the two teams' answer; a new penalties side by side compares the penalty points each team gives away a match, fewer being better; three teams compared with the phases named are the compare card. (#1088)

## 4.2.4 — 2026-11-08

Matches asked for in order ("highest scoring first"), "what happened last weekend" and finished events each get their answer.

### Highlights
- [fixes] "Matches from yesterday, highest scoring first" lists the top scores
- [fixes] "What happened last weekend" shows that weekend's highlights
- [fixes] "Finished events" lists events that are over

### Search
- **Order, said in words.** "Highest scoring first", "top first", "lowest first" read as the sort they ask for, never as a team's first match; "what happened" with a time or a place and no team reads as that scope's highlights; matches in a time window with no measure said ("matches from yesterday") list that window's best first; finished, completed and ended events are past events. (#1073)

## 4.2.3 — 2026-11-08

An event's best teams are headed once: the page heading is the card's own title, such as "Best teams at New Jersey Championship by OPR there".

### Highlights
- [rankings] An event's best teams say their title once
- [rankings] The heading says what they're ranked by
- [rankings] The same on phones and desktop

### Search
- **An event's board, headed once.** "Best teams at <event>", "<place> teams at Worlds" and the like take their card's title, less the season, as the page heading, and the card no longer repeats it underneath. (#1169)

## 4.2.2 — 2026-11-08

A team's highlights read the time asked: "theseus highlights dec" and "<team> highlights in february 2026" answer, and a month with nothing played falls back to the season.

### Highlights
- [fixes] "<team> highlights in February 2026" shows that month's
- [fixes] "Theseus highlights dec" reads "dec" as December
- [teams] A month with nothing played shows the season instead

### Search
- **Highlights in a month.** A team's highlights with a time said ("in february 2026", "this week", "dec") are its standout matches played then, titled with the time ("Highlights in February 2026, 2025–26"). With nothing played then, a time said against today relaxes to its season, then the one before, as every answer with a window does, and says so on the card; a month typed with its year stays that month. A month's short form alone ("dec", "nov") is a month as the query's last word; "mar" and "may" stay words. (#1168)

## 4.2.1 — 2026-11-08

The best teams at one event, Worlds or a state's championship are a leaderboard of the teams there: "east bergen conference best teams", "top teams at nj states".

### Highlights
- [rankings] "Best teams at <event>" ranks the teams there
- [rankings] By OPR at the event once it's played
- [rankings] Before it's played, by the OPR each team brings
- [rankings] "NJ teams at Worlds" lists the teams from a place

### Search
- **The best teams at an event.** An event named, Worlds or a state's championship beside "best teams" or "top teams" is the board of the teams on its list (its divisions' too). Once played, it ranks them by each team's OPR there with its record there; before, by the season OPR each team brings (else the season before's), said on the card. No season said reads the latest held with teams listed, a newer one with none yet named on the card. A count ("top 5 teams at …") and a year ("worlds 2025") are read; another stat is left to search. "Teams at" an event or Worlds lists the teams there too, and a place said with Worlds or an event named keeps the teams from there ("nj teams at worlds"). "Should I watch" asks for the best, and a state with only a championship word after it is its state championship ("nj champs"). (#1102)

## 4.2.0 — 2026-11-08

A team's record against the world's top teams by a number is answered. "Whats 14450's record against teams ranked top 10 worldwide" shows its matches against an alliance with a top-10 team, beside the rest.

### Highlights
- [teams] "<team> record vs top 10" counts opponents in the world's top 10
- [teams] Any cut works: "against the top 25 teams in the world"
- [teams] "Against top teams" alone still means the season's top tenth

### Search
- **Against the top N.** "Against (teams ranked in) the top N (worldwide, in the world)" and "vs top N" read as the against-top-teams answer with N as the cut: matches where the other alliance had a team ranked in the world's top N by prediction rating that season, side by side with the others. Its title and definition say the cut. Before, the number was taken as a second team and the question fell to a Compare. (#1107)

## 4.1.9 — 2026-11-08

A team's chance of making Worlds or states, asked any way, answers with its advancement chance.

### Highlights
- [predict] "Chance of making worlds" shows the advancement chance
- [predict] "Reaching", "getting to" and "qualifying for" read the same
- [predict] "Next year" starts at the team's next event

### Search
- **Reaching Worlds or states.** "<team> chance of making worlds", "odds of reaching worlds", "chances of getting to states next season" and "qualifying for worlds as it stands" are the stored projection's advancement chance at the team's next event, as "chance to advance to worlds" is. A forecast made at Worlds itself ("advance at worlds") keeps its own answer. (#1113)

## 4.1.8 — 2026-11-08

One question, one season: "best in New Jersey right now" and "best teams in New Jersey" now show the same season, whichever way they're asked.

### Highlights
- [rankings] "Right now" and "best teams in <place>" agree on the season
- [rankings] The current season once anyone is ranked in it
- [rankings] Until then the season before, said on the card

### Search
- **The same season, however it's asked.** Asked with no season, the search box's top-teams and stat cards and their full pages read the current season, then the season before while nobody is ranked in it yet, as the rest of search does. Before, some phrasings showed the last completed season while others showed the current one. (#1166)

## 4.1.7 — 2026-11-08

A team whose name has dotted initials is found typed without the dots: "ice robotics highlights" answers for 11329 I.C.E. Robotics.

### Highlights
- [fixes] "Ice robotics highlights" finds I.C.E. Robotics
- [teams] Names with dotted initials match typed without dots
- [fixes] "Ice robotics" lists I.C.E. Robotics first
- [fixes] A stray short word at the end no longer blocks the answer

### Search
- **Dotted initials.** A team name's initials written with dots ("I.C.E.", "M.E.D.I.C.S.") also read as the word they spell, in the question reader and the search index alike, so the name typed without dots finds the team, its possessive dropped or not, and a near miss of it too. One-dot abbreviations ("St.", "Mr.") and numbers ("2.0") are unchanged. A query that finds nothing and ends in a stray word of up to four letters no word search or the data knows ("theseus highlights decd") is read without it, offered as "did you mean". (#1163)

## 4.1.6 — 2026-11-08

"My" and "our" in a search mean your team: "what is my next event" answers for My team, or asks you to pick one. A team's schedule in a state said short ("Hypnotic Robotics mass schedule") shows its matches there.

### Highlights
- [fixes] "What is my next event" answers for My team
- [teams] With no My team set, search asks you to pick one
- [fixes] "<team> schedule" shows matches still to play, then played
- [fixes] "Mass" and "Cali" read as Massachusetts and California

### Search
- **My and our.** A search saying "my" or "our" with no team named ("what is my next event", "how did our team do") answers for My team on this device; with none set, it answers with a link to pick one rather than "no team matched". A team named after "my" ("my 4215 next event") is the one asked about. A team's "schedule" (or "match schedule") is its matches: those scheduled and still to play (at events not yet over, in the place asked) first, then the ones played, whose record counts the played ones only; and a region's other names ("Mass", "Cali") read as that region. (#1154)

## 4.1.5 — 2026-11-08

A match two teams haven't played, supposed in words, answers with its forecast.

### Highlights
- [predict] "If <team> played <team>" shows the match prediction
- [predict] "What if", "suppose" and "imagine" read the same way
- [predict] A day to come is called on the ratings used, said so

### Search
- **A supposed meeting.** "If <team> played <team>", "what if … faced …", "suppose … against …": the two teams' match call. A day still to come ("tomorrow", "next week") is called on the latest ratings both teams share, the card naming their season; a day gone by isn't read this way. (#1108)

## 4.1.4 — 2026-11-08

A place said before the team word keeps a count's board: "which Texas teams have the most awards" ranks awards won, not the prediction rating.

### Highlights
- [rankings] "<Place> teams with the most awards" answers with awards
- [rankings] Matches played and events attended said this way too
- [rankings] "Have played", "have won" and "have attended" read as said

### Search
- **The most of a count, the place first.** "Which Texas teams have the most awards", "Ohio teams with the most events" and "the Georgia team with most matches" give that count's board, the same as "which team in Texas has the most awards", where before they gave the prediction rating's. "Have played" and "have attended" read as played and attended, and "won the most matches" stays the wins board. (#1161)

## 4.1.3 — 2026-11-08

One word of a named team's own event's name now reads as that event.

### Highlights
- [predict] "<team> prediction for <one word>" finds that team's event
- [predict] The latest such event, or the one in the season named
- [predict] The card says which event the one word was read as

### Search
- **One word of a team's own event.** With a team named, one word of the name of an event it was listed at ("<team> last prediction for <word>") reads as its latest such event, or the one in the season named, and the card says so. With no team, or a kind of event's word ("qualifiers"), nothing changes. (#1106)

## 4.1.2 — 2026-11-08

A place's award winners are answered: a state's, a country's or a town's teams and the awards they won, the most, the rarest, and whether any won at Worlds or made its finals.

### Highlights
- [fixes] "Michigan Inspire winners" lists that state's winners
- [fixes] A country's teams ranked by Inspire Awards won
- [fixes] "did any NJ team win Inspire at worlds" says yes or no
- [fixes] "rarest award a NJ team won this season" names the award

### Search
- **A place's award winners.** The teams from a state, a country (or its people's word) or a town, and the awards they won, newest first or by a stat ("by auto"): the most won, the rarest one (given fewest times anywhere that season), two awards won at one event, and yes or no at Worlds, for an award or for reaching its finals or playoffs. At Worlds, "last year" is the latest Championship that has finished. (#1100)


## 4.1.1 — 2026-11-08

Asking whether one team will beat another gets the match's call, and asking what happens if you change an alliance points you to the part of Predict that does it.

### Highlights
- [predict] "Will 4215 beat 7149" predicts their match
- [predict] "If I change the alliance" opens Custom matchup
- [predict] "Best partner if I change the alliance" says how to try each

### Search
- **"Will A beat B."** "Will", "would" or "going to" with a win word ("beat", "defeat", "win against") between two teams is the call for a match between them.
- **A lineup changed, supposed.** "If (what if, suppose) I change, switch or swap the alliance, teams or partners", with no team named, is Predict's Custom matchup; asked with "who is the best partner", it says how to try each partner there. (#1153)

## 4.1.0 — 2026-11-08

In the installed app on a phone, pull down from the top of any page to reload it. A round reload icon slides down under the top bar as you pull, turns yellow once letting go will reload, and spins while the page reloads.

### Highlights
- [appearance] Pull down from the top to reload, in the installed app on phones
- [appearance] A reload icon follows the pull and turns yellow when ready
- [appearance] Phone browser tabs keep their own pull-to-refresh

### Phone app
- **Pull to reload.** The installed app (added to the home screen) has no reload button, so pulling down from the very top of a page now reloads it: the whole page, so the data, a new release and the offline copy all come fresh. It only starts at the top of the page, with one finger, on a downward drag; a sideways swipe, a scroll, a list with its own scrollbar, a drag handle (reordering picks), or an open dialog or sheet are left alone, and letting go early does nothing. A phone's browser tab keeps its own pull-to-refresh, and desktop gets none. Under reduced motion the icon doesn't turn or spin. (#1159)

## 4.0.9 — 2026-11-08

A team's record, wins and scores in the finals only are answered, and a match told by its margin is the team's biggest loss or win. "Whats 9848's record in finals matches only" shows the record in its finals matches, and "the score of that one match where 4215 lost by a lot" shows its biggest loss.

### Highlights
- [teams] "<team> record in the finals" counts its finals matches only
- [teams] Finals follow each bracket: grand final and replay since 2024
- [teams] "The match where <team> lost by a lot" shows its biggest loss

### Search
- **The finals, by bracket.** "In the finals", "finals record" and "finals matches only" filter a team's own match rows (record, win rate, scores, margins, streaks) to its events' finals: a classic bracket's final (series 0), and since 2024–25 a double-elimination bracket's grand final and its if-needed replay, read from the event's alliance count and posted series. A state's finals stay its state championship, "make the finals" stays its own question, and a number from season rows (OPR, rank) isn't filtered. Before, the finals were read only by the match finder, and a team's question about them went unanswered.
- **A match by its margin.** "The match where <team> lost (won) by a lot / by the most / so badly" reads as that team's biggest loss (win), whose card names the match and its score. (#1103)

## 4.0.8 — 2026-11-07

"The best in New Jersey" with no "teams" word, and short words for now, read as the region's top teams this season.

### Highlights
- [rankings] "Best in <state>" with no "teams" word answers
- [rankings] "rn", "atm" and "at the moment" read as this season
- [rankings] Same card as "best teams in <state>"

### Search
- **The best in a place.** "Best in New Jersey", "top 5 in Texas" and "the strongest in Ontario" give that region's top teams this season, the same card as "best teams in New Jersey". Only a region counts after "in", so "best in show" stays a name search. "rn", "atm" and "at the moment" read as this season, like "right now". (#1156)

## 4.0.7 — 2026-11-07

A place's top team can stand in for a team number in a two-team question: "who would win between the top NJ team and the top Romania team" answers for those two teams, and says which they are.

### Highlights
- [predict] "Top NJ team vs top Romania team" predicts those two teams
- [predict] The answer says which team each "top team" was read as
- [predict] "Who would win in a match between A and B" gets the call

### Search
- **A place's top team, as one of two.** "The top / best / strongest <place> team" or "… team in <place>" is that place's first team on its prediction-rating board, as "top teams in <place>" ranks them, read into the two-team question; the question line says which team each phrase was.
- **"Between."** "Who would win in a match between A and B" is the match's call, and "matches between A and B" their shared matches. (#1097)

## 4.0.6 — 2026-11-07

Search answers a team's own listing asked as a yes-or-no question. "Is 23786 MakEMinds a rookie team or old" shows the team's rookie year, "is delta force actually from romania or what" shows where it's from, and "does 23268 have any sponsors listed on their team page" shows its sponsors, instead of the bare team card.

### Highlights
- [teams] "Is <team> a rookie team or old" shows its rookie year
- [teams] "Is <team> from <place>" shows where the team is from
- [teams] "Does <team> have sponsors" shows the team's sponsors

### Search
- **Listing questions, yes or no.** A question about a team's rookie season, home or listed sponsors, school or website, typed as "is …" or "does … have …", reads as that fact's own question, so its card answers with the year, place or names. A place question needs "from", "based in" or "located in", so "is 4215 in the finals" stays a results question. (#1095)

## 4.0.5 — 2026-11-07

A team's Worlds questions asked in plain words get their answers: "number of times <team> went to worlds", "<team> world championship matches 2025-26", and "what division was <team> in at worlds, and what was their rank there".

### Highlights
- [fixes] "Number of times 4215 went to worlds" shows its appearances
- [fixes] "7149 world championship matches 2025-26" shows the matches
- [fixes] "What division was 9848 in at worlds" shows divisions, ranks

### Search
- **Worlds in plain words.** "World championship" (and "world champs") is read as one name, Worlds, so "<team> world championship matches <season>" is its matches there rather than an event called "championship". "Number of times <team> went (or has gone) to worlds" reads as its Worlds appearances, and "what division was <team> in at worlds, and what was their rank (record) there" as its Worlds divisions, each with its rank and record. (#1087)

## 4.0.4 — 2026-11-07

People also ask and Related searches stay on what you searched: an FTC word is never read as a town, and only the team your search is about gets its highlights.

### Highlights
- [fixes] "What is an alliance" no longer asks about Alliance, Nebraska
- [fixes] Highlights and related searches only for the team you searched
- [fixes] "High Point" and other two-word places still get their questions

### Search
- **Follow-ups use only what the search named.** A place or event typed as one FTC word on its own ("alliance", "auto") is the word, so no follow-up question names it; names of two or more words ("High Point") still are. Highlights and team searches beside an answer are for the team the search is about, never a team that only a suggested question's answer named; a search about no team shows neither. (#1137)

## 4.0.3 — 2026-11-07

A team's own events asked in plain words get their answer: its last or first event and how it did there, its events in a country such as Romania, how many it played, and "what is my <team> event".

### Highlights
- [fixes] "Last event 21229 played, and how did they do" shows it
- [fixes] "What events did 24033 play in Romania" lists them
- [fixes] "What is my 4215 upcoming event" shows its next event
- [teams] "4215 events in March" lists that month's events

### Search
- **A team's events in plain words.** "What was the last (or first) event <team> played, and how did they do" reads as its results at that event; "what was <team>'s first event this season, and what was their OPR (rank, record) there" as that number there; "what events did <team> play in <place>" and "how many events did <team> play in <season>, and which was their best" as its events list (each with its rank); "what is my <team> (upcoming) event" as its next event. "In (date) order" lists a place's events oldest first, and "how many … played" counts the events the team played (surrogate-only and remote ones too), never the upcoming ones. A team's events in a whole country ("in Romania") are every state or province of it, matched by the country's code, and "this year" with a place is the default season.
- **A month and the best finish.** "<team> events in March" (or "during june 2026", "did <team> play at any event in June") lists the season's events with a day in that month: the year's season when it's said, else the default season, so the month has happened. A month on any other answer is left to search rather than dropped. A season's events list names its best finish ("Best finish #3 at …"), and "<team> events and best finish in <season>" reads as that list. (#1084)

## 4.0.2 — 2026-11-07

Questions about Predict itself get a straight answer and the right part of Predict: a match of your own, picking predictions out, a team's predictions, and a day's calls.

### Highlights
- [predict] "Win chance for teams I pick" opens Custom matchup
- [predict] "Can I filter predictions" says how: by team or event
- [predict] "Predictions for tomorrow's matches" lists that day's events

### Search
- **Predict, asked about.** A lineup of your own ("teams I pick", "does it update if I change the alliance", "a match that hasn't happened yet") is Custom matchup; filtering or sorting predictions is Scheduled matches, by team or event, not by date; "<team> prediction settings" is that team's matches in Predict.
- **A day's predictions.** "Predictions for today's / tomorrow's matches" lists that day's events, each one's matches in Predict, or says no event has matches then. (#1086)

## 4.0.1 — 2026-11-07

The rookie leaderboard lists from the bottom when asked, with the stat said before "rookies" or after the place: "lowest opr rookies in new jersey", "worst rookie teams in texas by auto opr".

### Highlights
- [rankings] "Lowest opr rookies in New Jersey" lists them
- [rankings] Rookie lists read a stat said before or after
- [rankings] The lowest-first rookie list links its Teams view

### Search
- **Rookies from the bottom.** "Lowest", "worst" or "weakest" before the rookies lists them lowest first, ranked from the top as every lowest-first board is, and titled so ("Lowest rookie teams in New Jersey by OPR"). The stat can be said before "rookies" ("lowest opr rookies") or after the place ("in texas by auto opr"); two stats at once are no one board. (#1085)

## 4.0.0 — 2026-11-07

A list of teams with filters is answered however the filters are said: "Houston teams, OPR 90+", "teams in Romania with at least 30 matches and a win rate over 70 percent", "teams with OPR over 120 who did not make worlds".

### Highlights
- [rankings] "Oradell teams, OPR over 100" lists those teams
- [rankings] Several filters at once, match counts too
- [rankings] "Did not make worlds" and rookie teams filter a list
- [rankings] "Top 3 Texas Inspire teams" lists Inspire winners

### Search
- **Team lists, filters said any way.** A threshold needs no "with" ("Oradell teams, OPR over 100"), a stat with a bare number is at least it ("OPR 90", "OPR 90+"), "percent" is a unit, and a count of matches or wins is a filter ("at least 30 matches", "that played 20+ matches"). Every threshold said is applied and named on the card; "a leaderboard for teams …", "list them all" and "worldwide" read too. Worlds made, or not made ("did not make worlds"), rookies ("started as a rookie this year") and an award named before the teams ("Texas Inspire teams") are filters of their own. (#1075)

## 3.9.9 — 2026-11-07

A word's explainer that comes with a team's numbers sits inside the same card, so the answer reads as one card.

### Highlights
- [fixes] "How is OPR calculated, with 4215": one card, numbers then meaning
- [fixes] A team's stat and what it means are no longer two cards
- [fixes] The explainer's title isn't repeated under the page's heading

### Search
- **One answer card.** When a team's stat answer comes with a word's explainer ("what does ranking score mean, for 14450 at …", "why did 4215's rating go down even though they won"), the explainer's lines are drawn inside the stat's card, after its numbers, in the definition card's own look. (#1129)

## 3.9.8 — 2026-11-07

The LIVE panel shows nothing about matches until the day's first score is out, then times every match from the field.

### Highlights
- [live] Before the first score: just "Waiting for Q1's score"
- [live] After it, your next match and countdown appear on their own
- [fixes] Schedules posted as 1:35 AM read as 1:35 PM

### Live
- **Nothing until the first score.** Before the day's first match is scored, the LIVE panel names no match, time or lineup (it read as if that match were on now), only "Waiting for Q1's score"; the phone's chip says "Waiting for Q1". Once the score is out, your next match and its countdown show up by themselves, timed from the field's real pace.
- **Schedules with a wrong clock.** When the field runs hours off the posted times (a mistyped schedule), the countdown keeps the schedule's gaps and drops its clock, and doesn't claim the event runs "12 hours behind".

### Fixes
- **12-hour slips in FIRST's schedule.** A posted start before 6 AM is read as the afternoon (the P1-5 PM Northeast League Meet was posted from 1:35 AM). (#1128)

## 3.9.7 — 2026-11-07

Questions about what a word means are answered however they're framed, two words at once, or with a team's own numbers.

### Highlights
- [fixes] "teleop explained" says what auto, TeleOp and endgame are
- [fixes] "difference between OPR and rating" shows both, side by side
- [fixes] "how is OPR calculated, with 4215" shows its numbers too
- [fixes] "what is the game this season" names the season's game

### Search
- **What a word means, asked any way.** Framing such as "explained", "in plain words" or "for a beginner" is set aside; "the difference between" two words gives each one's lines; a word asked for one team ("what does ranking score mean, for 14450 at …", "why did 4215's rating go down even though they won") gives that team's own stat with the word's explainer under it; and "the game this season" or "last season" names that season's game. (#1065)

## 3.9.6 — 2026-11-07

How right the engine's predictions were is a question search answers: a team's most unpredictable matches, the calls that missed by more than a number of points, and the season's most accurate predictions.

### Highlights
- [predict] "Most unpredictable match" lists where predictions missed
- [predict] "Wrong by more than 50 points" keeps only those matches
- [predict] "Most accurate prediction this season" finds the closest calls

### Search
- **Predictions against results.** A match's miss is how far the saved call's margin (live, else its replay) was from the final one, penalties included, as the accuracy page measures it. "<team>'s most unpredictable match", "where the prediction was most wrong" and "biggest prediction misses in <place>" rank furthest off first; "most accurate prediction" ranks closest first.
- **A floor in points.** "More than 50 points", "over 100 pts" is a number of points, never a team, and keeps only the misses over it. (#1077)

## 3.9.5 — 2026-11-07

A team's TeleOp, Auto or Endgame OPR and its reliability can be asked as a trend, event by event, and "how has <team> changed from last season" shows its OPR change.

### Highlights
- [fixes] "Is 14450's teleop improving" shows TeleOp OPR by event
- [fixes] "7149 reliability trend, event by event" shows each event
- [fixes] "How has 17713 changed from last season" shows its OPR change

### Search
- **Phase and reliability trends.** "<team> teleop trend", "is <team>'s auto improving", "<team> endgame over time" and "<team> reliability by event" each answer with that number at every event of the season, rising or falling against the event before, read from the rows the team page shows (a phase's OPR, the reliability index per event). "How has <team> changed (or improved) from last season to this season", "since last season" and "between two seasons" read as its OPR change. (#1074)

## 3.9.4 — 2026-11-07

A team's quality asked in plain words gets its season's OPR, rank and record: "is 23268 actually that good or just hype", "can u tell me if bad wolf is good, be honest" and "whats up with ultraviolet, are they cracked" no longer end on the bare team card or no match.

### Highlights
- [fixes] "Is 23268 actually that good or just hype" shows its numbers
- [fixes] "Can u tell me if bad wolf is good" shows OPR, rank, record
- [fixes] "Did hypnotic robotics choke at states" shows its states results

### Search
- **Plain-language team questions.** "Is <team> actually that good", "can you tell me if <team> is good", "whats up with <team>, are they cracked" and "how good is <team> really" read as "how good is <team>", the season said kept; "did <team> choke (or flop, or do well) at <event>" reads as how it did there; "show me <team> in 2023, if they played then" is that season. Asides such as "or just hype", "or nah", "be honest" and "like in plain numbers" are left out. (#1057)

## 3.9.3 — 2026-11-07

An event's award asked with its season, a short name or a place ("… inspire 2025-26", "in nj cham this year", "who got 2nd place …") is answered.

### Highlights
- [fixes] "<event> inspire 2025-26" names that season's award
- [fixes] "who won inspire in nj cham this year" finds the event
- [fixes] "who got 2nd place Inspire at …" lists that place first
- [fixes] "… inspire last year" is the season before this one

### Search
- **An event's award, any season, any place.** A season said anywhere in an award ask (a game, "2025-26", "last year") is the event's season, never its name, and "2nd place" puts that place first, said in the answer. (#1071)


## 3.9.2 — 2026-11-07

The live countdown waits for the day's first result, then runs on the field's real pace.

### Highlights
- [live] No countdown until the day's first match has a score
- [live] Then the timer follows the field: late or early, never behind
- [live] Shows which match should be on the field now

### Live
- **No timer off the posted plan.** Before the day's first match has a result, the LIVE panel, the phone's countdown chip and the pit display show what's up next and its scheduled time, with no countdown: events rarely start on time.
- **Calibrated on real starts.** Once results come in, the next match is due one cycle after the latest match really started, and everything after it moves by the same amount up to the next break (lunch absorbs a late start). It uses the shorter of the posted cycle and the one the field is really running, and a match with no score yet can't have started more than 8 minutes ago, so the timer errs early, never late. Breaks come from the posted schedule: each match now keeps its posted start beside its real one. The panel says how far behind or ahead the field runs and which match should be on the field now. (#1109)

## 3.9.1 — 2026-11-07

A team's next event asked about as a forecast, and "will <team> win <event>", answer with the engine's own projection for that event.

### Highlights
- [predict] "<team> next event prediction" shows its chance to win it
- [predict] "Will <team> win <event>" shows the forecast there
- [predict] "Will <team> win states" and "win worlds" read their own event

### Search
- **Next event, said as a forecast.** "Next event prediction", "next meet forecast" and "prediction for their next event" read as the stored projection for the team's next event, led by its chance to win it.
- **"Will" with a win and an event.** "Will <team> win <event>", "… win states" and "… win worlds" are the forecast at that event; "will" with no event or no win ("will <team> advance", "when will <team> play next") keeps its own answer. (#1072)

## 3.9.0 — 2026-11-07

On an event day before the schedule is out, the LIVE box says it's waiting for the schedule. It no longer says your teams are done, and it names only your teams that are at the event.

### Highlights
- [live] Before the schedule: "Waiting for the schedule", never "done for now"
- [live] Only your teams at this event are named
- [live] A team the posted schedule leaves out isn't called done

### Live
- **LIVE box without a schedule.** With no matches posted, the box's title is "Waiting for the schedule". Your tracked or assigned teams at the event are listed as "Your teams here: …", and their countdown starts when the schedule is out. If none of them is at the event, there's no team line. "Your teams are done for now" and "No more scheduled matches for …" now need a posted schedule, and they name only teams that are in it. A team at the event that the posted schedule leaves out reads "Not in the posted schedule". Every event works the same way: the teams named are the event's own list or its schedule. The event stays Live on its day: FIRST shows it as in progress, and live mode keeps the page checking for the schedule. (#1089)

## 3.8.9 — 2026-11-07

A league meet's page lists the teams FIRST lists for that meet, not every team in its league. The day before a meet, FIRST's rankings for it are the league's running standing, and Control Scout had been taking them as the meet's team list (P1-5 AM Northeast League Meet: 33 teams shown, FIRST lists 13).

### Highlights
- [fixes] League meets list only the teams FIRST lists for that meet
- [fixes] Past league meets keep only the teams that played there
- [teams] A team's page no longer shows its league's other meets as its own

### Data
- **Event teams from FIRST's participant list.** Every FIRST fetch of an event also reads its team list (`/teams?eventCode=`), and that list decides who is at the event; rankings only add each team's standing, and scheduled teams always count. A list FIRST files for both sessions of an AM/PM pair stays the pair's (shown for both sessions, as before), never one session's teams. A league meet whose list FIRST hasn't published shows no teams from its league's standing, and one whose list can't be read falls back to FTC Scout, like any failed FIRST read. Each fetch replaces the stored list whole, and FIRST's own list replaces the stored registrations too, so a list FIRST emptied stays empty.
- **Stored league meets repaired.** Migration 74 drops the teams stored at a league meet that weren't scheduled there (about 19,000 rows over 2023–24 to 2025–26; remote meets, which never have matches, are left alone); an upcoming meet's list comes back from FIRST on its next fetch, with FIRST's registrations standing in until then. (#1041)

## 3.8.8 — 2026-11-07

A trend asked as a choice ("is its rating rising or falling", "getting better or worse at penalties") answers with the trend, and penalties asked as a trend show each event.

### Highlights
- [fixes] "Is the rating rising or falling" shows the rating trend
- [fixes] "Getting better or worse at penalties" shows each event
- [fixes] "Better or worse than" another team stays a comparison

### Search
- **Trends asked as a choice.** "Rising or falling", "getting better or worse" and "improving or flat" read as a trend; a team's penalties asked as a trend give the per-event figure. (#1043)

## 3.8.7 — 2026-11-07

Asked for the team with the most matches, events or awards, search answers with that count's leaderboard, its leader first: "which team in New Jersey has the most awards", "most matches played in Ohio".

### Highlights
- [rankings] "Which team has the most awards in NJ" ranks by awards won
- [rankings] "Most matches played" ranks teams, not scores
- [rankings] Events played is a leaderboard of its own too

### Search
- **Leaderboards by a count.** Matches played, events played and awards won are leaderboard stats, their leader "the team with the most". "Which team has the most awards", "team that played the most matches" and "top 5 teams by matches played" read as these boards, never the highest-scoring matches or the rating board. (#1040)

## 3.8.6 — 2026-11-07

A question ending with what it is not asking ("…, not just one number", "in 2024-25, not this season") is answered for what it is asking.

### Highlights
- [fixes] "…, not just one number" no longer stops an answer
- [fixes] "in 2024-25, not this season" reads 2024-25
- [fixes] "teams in Ohio, not rookies" keeps its filter

### Search
- **What isn't asked, left out.** A comma clause "not just …", "not only …" or "not" and a season goes, and the rest of the question is answered; any other "not" clause is a filter and stays. (#1031)

## 3.8.5 — 2026-11-07

Two teams are read in more ways: "have 4215 and 207 played each other", "the OPR gap between 7149 and 23268", "is 4215 better than 7149 at endgame" and "if 4215 played 7149, who would win" each get their side-by-side answer.

### Highlights
- [fixes] "Have 4215 and 207 played each other" shows their meetings
- [fixes] "OPR gap between 7149 and 23268" shows both OPRs
- [fixes] "Is 4215 better than 7149 at endgame" compares endgame

### Search
- **Two teams, more ways to ask.** Played each other (or faced, met, one another), the OPR or rating gap between two teams, better or worse than another team at a phase, and "if A played B, who would win" or "predict A vs B" each read as the two teams' answer. (#1030)

## 3.8.4 — 2026-11-07

The search sign-off grader counts a season's matches as a record answer: "17670 matches this season" answers with its W-L-T record and every match, dated.

### Highlights
- [report] Search sign-off grades a season's matches as a record
- [report] Set C: 48 pass, 2 invalid-OK, 0 fail on the saved run
- [report] No change to search itself: the grader only

### Tools
- **Sign-off grader.** The `record` kind in `scripts/search-signoff/grade.ts` also accepts a season's matches (`aggregate:season-matches`), whose headline is the W-L-T record; `grade.test.ts` covers it. (#1027)

## 3.8.3 — 2026-11-07

A card whose title only adds its own chips to the page heading no longer says it twice: "Top 10 teams by OPR in Romania" is read once.

### Highlights
- [fixes] A top-teams answer no longer repeats the page heading
- [fixes] The season stays on the card as its own chip
- [fixes] A title that says more than the heading still shows

### Search
- **One heading.** An answer card whose title is the page's heading plus its own chips ("Top 10 teams by OPR in Romania · 2025–26" with a 2025–26 chip) is for screen readers only, so the page reads its heading once. (#1026)

## 3.8.2 — 2026-11-07

Every button and link in a search answer is big enough to tap on a phone, and a list of top teams keeps each team's name readable.

### Highlights
- [fixes] Every tap target in a search answer is at least 44px each way
- [fixes] Top-teams lists on phones show each team's full name
- [fixes] A team's record moves into its row's details on narrow screens

### Search
- **Tap targets.** Team chips, match links, sort headers, event links, chart points, the compare headline and "Open in Predict" are all at least 44px wide and tall on phones and touch screens. One shared rule covers them, so new controls get it too.
- **Top teams on phones.** A list ranked by a number of its own (prediction rating, win rate) shows that number and the OPR on a phone. The record moves into the row's details, so each team's name has the room to be read. (#1025)

## 3.8.1 — 2026-11-07

A slip in a team's name that starts with "Team" or "The" is corrected out loud: "team sealth record" is Team Stealth's record, with "Did you mean team stealth record".

### Highlights
- [fixes] "team sealth record" says "Did you mean team stealth record"
- [fixes] "team 14471" is always team 14471, never a name like it
- [fixes] The right spelling of a name gets no correction note

### Search
- **Did you mean, for names starting with Team or The.** A name read back with its "team" or "the" and corrected says the correction for the whole question; a team's number after "team" stays that team. (#1029)

## 3.8.0 — 2026-11-06

After an update, the site answers from a warmed-up server: no more minutes of slow pages while a new version settles in.

### Highlights
- [speed] No slow minutes after an update
- [speed] The server warms search before it answers
- [speed] The first data refresh waits until visitors are served

### Speed
- **Warm before answering.** A new server builds search's index (rebuilt once when the code that builds it changed), its names, spelling and typo index, and the track record before it takes requests, for at most 20 seconds (well under the proxy's 60). Ratings build in the background. Each step's time is logged, then the total.
- **The first refresh later.** The first data refresh after a restart runs at 10 minutes instead of 1, and the regular schedule waits for it, so a stats run and search rebuild no longer land on a just-updated server's first minutes.
- **Live means warm.** An update counts as live once the new server says it's ready and warm. (#1024)

## 3.7.9 — 2026-11-06

On the related searches page, the team group is titled with its team: "About 4215 Hypnotic Robotics".

### Highlights
- [home] Related searches name the team they're about
- [home] Popular searches name the season's leading team
- [fixes] A group about two teams keeps its plain title

### Search
- **The team, named.** The related searches page titles its team group with the team's number and name, the popular searches too (the team they're about), whenever every search in it is about that one team; a group about two teams ("4215 vs 6980") keeps "About this team". (#1023)

## 3.7.8 — 2026-11-06

A team's full name is read however it's punctuated: "UK 488 - The King's School- Barrel Botz record" is that team's record, and "team sealth record" finds Team Stealth.

### Highlights
- [fixes] A team named with dashes or a possessive is read in full
- [fixes] A name starting with "Team" or "The" keeps that word
- [fixes] A slip in such a name still finds the right team

### Search
- **Names with their own punctuation.** A dash on its own or ending a word is punctuation, and a possessive in a team's name ("King's") matches however it's typed, so a name typed in full reads the team, with its number or without.
- **Names starting with Team or The.** A question's own words ("team", "the") are put back when, with them, the words are a team's name or one slip from it: "team sealth record" is Team Stealth's record. (#1028)

## 3.7.7 — 2026-11-06

An event's initials typed in lower case are said in capitals in the questions that follow a search: "mti recap" offers "Who won MTI?", not "Who won Mti?".

### Highlights
- [fixes] "Who won MTI?" in capitals, however "mti" was typed
- [fixes] Related searches say an event's initials the same way
- [fixes] A full event name typed in lower case is still title case

### Search
- **Initials in capitals.** People also ask and related searches say an event named by its initials ("mti", "fr") in capitals; a name typed in full and in lower case is still put in title case. (#1022)

## 3.7.6 — 2026-11-06

A page of a search's related searches, grouped by what they're about, each with its answer's line: /related-searches.

### Highlights
- [home] "See all related searches" opens a page of them, grouped
- [home] Each related search shows its answer's number
- [home] With no search, the season's popular starting points

### Search
- **Related searches page.** `/related-searches?q=…` lists every search that follows from one: about the team, top teams, events, awards, predictions and more, a group only with two or more. Each is a link to the live search with one line from its answer. Only searches with a direct answer are listed.
- **Popular searches.** With no query, or one nothing follows from, the page lists the season's starting points the same way, and search itself is always one tap away. The page is drawn whole by the server and is in the sitemap. (#1017)

## 3.7.5 — 2026-11-06

A place's name beside "states" or "championship" is that place's championship: "romania states results" is the Romania Championship's results, never a team with Romania in its name.

### Highlights
- [fixes] "Romania states results" opens the Romania Championship
- [fixes] A country beside "states" is its championship, not a team
- [teams] A team named just a country is still found by that name

### Search
- **A place beside states or championship.** A country, state or province named beside "states" or "championship" ("romania states", "canada states results", "germany states results") reads as that place's championship, never as a team whose name has the place in it. A team's number, or a team's whole name when it is just a country's name, still reads the team. (#1016)

## 3.7.4 — 2026-11-06

On a wide screen, a search's answer sits on the left and its follow-ups beside it: the team's highlights, People also ask and Related searches.

### Highlights
- [home] Related searches: short searches about the same team, event or place
- [home] On a wide screen, the follow-ups sit beside the answer
- [home] A team's highlights, one tap from its answer
- [fixes] Every related search lands on a direct answer

### Search
- **Related searches.** Up to eight short searches ("4215 win rate", "best teleop opr") about what People also ask didn't cover, one chip each, one per line on a phone. Each is run as a search first, and only one with a direct answer is shown; none repeats a question or the search itself.
- **Beside the answer.** On a desktop the answer takes the left column and the follow-ups the right: the team's highlights, People also ask and Related searches. Phones keep one column, the related searches at the end.
- **A leaderboard's neighbours.** "Best auto OPR" offers the same teams by TeleOp, Endgame, OPR and rating; a search about no team ("upcoming events", "who won <event>") goes on to the team its answers are about.
- **A count as its page shows it.** A follow-up about a list of events ("What events are this week?") says as many events as the page it opens lists, never the larger total behind it. (#1009)

## 3.7.3 — 2026-11-06

An event can be searched by its initials: "MTI highlights" finds the Multinational Tech Invitational, and an event held only in past seasons is read in its latest one.

### Highlights
- [fixes] "MTI highlights" finds the Multinational Tech Invitational
- [fixes] A past event named alone shows its latest season, not an empty one
- [fixes] An off-season event's own highlights and match videos

### Search
- **Events by their initials.** Each event is found by its initials, the first letters of its name's main words ("MTI" for Multinational Tech Invitational, skipping "of", "the" and "and"), and by a short form its name gives in brackets. A name typed in full still comes first, a team named the same is the team's, and when several events share the initials the latest one held is chosen (then the one with the most teams) and named in the answer.
- **A past event, no season said.** An event named with no season, held only in past seasons, is read in its latest season ("Multinational Tech Invitational highlights" is its 2025–26 highlights), for highlights, recaps, winners and results.
- **An off-season event's highlights.** Highlights and match videos of an off-season event named are its own matches; one with no video says "No recording for this event — stats only." (#1006)

## 3.7.2 — 2026-11-06

A word typed in the plural, or with a slip in it, is the same question as the word itself: "4215 upcoming events" and "4215 upcoming evntd" answer like "4215 upcoming event".

### Highlights
- [fixes] "Upcoming events" and "upcoming event" give the same answer
- [fixes] A slip in a search word is corrected and answered ("evntd")
- [teams] A team's upcoming events are all listed, the next first
- [live] "Events happening rn", "tmrw" and "this wknd" read as the words in full

### Search
- **One question in either number.** A search word typed in the plural or the singular ("events", "oprs", "ratings", "predictions", "wins", "seasons") is the same question. A query that reads nothing in the number typed is read again in the other one, and keeps the answer only when that reading answers more. A word naming an event ("states", "worlds", "championship") keeps its number, and a team's or an event's name is never changed.
- **Slips in search words.** A search word (an intent word, never a name) typed with one slip onto a neighbouring key besides one other edit ("evntd" for "events") is corrected, with "Did you mean". Swapped letters ("raitngs") and plurals of search words ("rakns" for "ranks") are corrected too. Place names are known words, so "Texas" is never "teams".
- **A team's upcoming events.** "12345 upcoming events" lists every upcoming event the team is registered for, the next first, titled "Upcoming events" when there are several.
- **Short forms.** Informal short forms are read as the words in full before anything else: "rn" and "atm" (right now), "tdy" (today), "tmrw" (tomorrow), "yday" (yesterday), "wknd" (weekend), "nxt wk" (next week), "lst wk" (last week), "szn" (season), "ur" and "u". Only a standalone word is read so, never a word of a team's or an event's name, and the query stays as typed.
- **"States" for any place.** "<place> states" is that place's championship for every question ("nyc states highlights", "romania states results"), even where the championship isn't named a state championship. (#973)

## 3.7.1 — 2026-11-06

Under a search's answer, "People also ask": the next questions search answers directly, each opening to its answer's line and a link that runs it.

### Highlights
- [home] "People also ask" under a search's answer
- [home] Each question opens to its answer, numbers included
- [fixes] Only questions search answers directly are asked

### Search
- **People also ask.** Under the answer, up to six questions about the same team, event, place or season ("What is its record?", "Who won the Think Award there?"), closed until tapped. Each opens to one line from that question's own answer and "See the full answer", which runs it as a search.
- **Never a dead end.** Every question is run as a search before it's shown, and only one with a direct answer is asked: never one that would say sorry, guess or list names. The questions come from what the search read, never from a list of teams or events. (#1002)

## 3.7.0 — 2026-11-06

"Who won <event> this year" is this season's event again, or the latest one held with a result, never an older one whose name fits the words better.

### Highlights
- [fixes] "Who won nj turnpike division this year" is this season's again
- [fixes] With no season said, the latest event held with a result answers
- [fixes] An older season answers only when it's asked for

### Search
- **The season asked, then the latest held.** "Who won <event> this year" (or "this season") is that season's event; before it's held, the latest season whose event has a result (a played playoff match or a posted award), said so. With no season said, the latest event held with a result answers. An older season answers only when it's asked for ("2022-23"), never because its name fits the words better. (#1007)

## 3.6.9 — 2026-11-06

"Who won <event>" leads with the playoff champions, for a division too, where FIRST posts no awards of its own.

### Highlights
- [fixes] "Who won" a division shows its playoff champions, never "no results"
- [teams] The champions are team chips in the colour they played the final in
- [fixes] "This year" before the event is held shows last season's, said so
- [fixes] "<Event> inspire award winner", in any word order, names the winner

### Search
- **Who won an event.** "Who won", "winner of", "champions of" and "who took" an event lead with its playoff champions, the alliance that won its final, as team chips in the colour they played it in, the same champions as its Playoffs tab. A division's awards are posted on its championship, so its answer lists the championship's awards below; "no results yet" is said only when there's neither a playoff result nor an award.
- **A championship and its divisions.** A championship's answer leads with its finals' champions, then each division's winners and its Inspire Award.
- **"This year" before it's held.** "Who won <event> this year" before this season's event is decided (or set up) says so, then shows its latest finished season's winners, labelled.
- **An event's award, asked any way round.** "East Bergen conference inspire award winner", "inspire winner at …", "who got inspire at …" and "<event> inspire" all name the award's winner, for every judged award, Judges' Choice and Dean's List. A recurring event shows its latest one with the award given, its season said, and a newer one not held yet said too.
- **Suggestions that answer.** "Sorry, I can't answer that yet" offers a search only after running it and finding an answer.
- **No empty space on phones.** The space under "How FTC One Search works" on a results page is kept only while the Compare bar is up. (#928)

## 3.6.8 — 2026-11-06

The Playoffs tab draws a double-elimination bracket as a real bracket: upper and lower lanes, rounds left to right, lines to each winner's next match, the finals on the right.

### Highlights
- [predict] Double-elimination brackets draw as a real bracket with lines
- [predict] Each match shows its alliances' team numbers and scores
- [predict] The grand final and if-needed final sit on the right

### Playoffs
- **A real bracket.** The upper bracket sits over the lower bracket, each round in its own column, and a line runs from every match to the one its winner plays next. The grand final and the if-needed final sit together on the right. 4-, 6- and 8-alliance brackets all draw this way; on a phone the bracket scrolls sideways.
- **Scores on the rows.** Each match shows the two alliances with their team numbers and their own score, the winner with a trophy; an open match shows its favourite and confidence. (#972)

## 3.6.7 — 2026-11-06

Every search answer is in colour now: a how-many answer's number in bold amber, definitions and rules in sky, "nothing found" and "can't answer" in slate, each with a filled icon chip and a thick bar.

### Highlights
- [appearance] "How many teams in Canada" shows its number big, in bold amber
- [appearance] Definitions, rules and "did you mean" read in sky blue
- [appearance] "Nothing found" and "Sorry" notes get a slate bar and chip
- [appearance] A season's top score, a winning alliance and a win chance lead in colour

### Search
- **No grey answer cards.** The count and general answer card ("578 teams registered in Canada in 2026–27") had a grey icon and grey words: each line is now a card of its own colour, its icon a filled chip, a thick bar down its left, and a count's number big in amber. Definitions ("what is OPR") and the rules card are sky; a team's next event or match, its listing facts and where it's from are in the team's colour; the season-at-a-glance tiles stay plain with each number in its own colour (OPR yellow, prediction rating purple, a record's wins green and losses red, events blue); award lines in their award's colour; record and stat pills on the team hue.
- **Two new colours in the one palette.** Count (amber, the owner's mock) and Reference (sky) join the search palette. Yellow stays ranking points' alone; amber and yellow, sky and team A's blue never share a card.
- **Headlines in colour.** A card about no team leads in its meaning's colour (a winning alliance in orange, a season's "190 points" in amber); a two-team headline that names one ("7149 favoured", "7149 leads 2-1") in that team's colour; a win chance's number and bar in the team's colour.
- **Nothing found, sorry and no match.** "No upcoming match is scheduled", "Sorry — I can't answer that yet" and "Search has no answer" are slate with a filled chip and a thick bar; "Did you mean" is a sky note.
- **A new kind can't ship grey.** The answer card audit now draws every card kind and every block kind the API has, and fails a card with no colour anywhere, or a grey line icon or line text. (#959)

## 3.6.6 — 2026-11-06

More ways of asking for a place's top teams find the leaderboard: "Romania leaderboard", "highest rated teams", "by rating, not OPR".

### Highlights
- [rankings] "Romania leaderboard" lists a country's top teams
- [rankings] "Highest rated teams in …" ranks by prediction rating
- [rankings] "By rating, not OPR" ranks by rating alone
- [rankings] "Top 10 … with their records" keeps the record column

### Search
- **A country's leaderboard.** "Romania leaderboard 2025-26" lists the country's top teams by OPR. A state's leaderboard ("New Jersey leaderboard by record") is unchanged.
- **Highest rated.** "Highest rated teams in …" and "top rated" rank by the prediction rating.
- **A stat not to go by.** "Top 5 teams in Romania by rating, not OPR" ranks by the rating alone; "not" drops only a stat, so "matches 12345 did not win" keeps its win.
- **Records beside.** "Top 10 teams in New Jersey by OPR, with their records" is the OPR list, whose rows always show the record.
- **Points in a match.** "Most points in a match in Texas" is the highest-scoring match there. (#865)

## 3.6.5 — 2026-11-06

Penalty questions about teams ("which team fouls the least in New Jersey") answer with the teams' numbers, never the rules card.

### Highlights
- [rankings] "Which team fouls the least in New Jersey" ranks teams by penalties
- [rankings] "Gives away the most penalty points" lists teams, most first
- [teams] A team's penalty points at an event, in total, when asked so
- [fixes] Rules questions still open the rules quick reference

### Search
- **Teams ranked by penalties.** "Which team fouls the least in New Jersey", "which NJ team gives away the most penalty points per match": the teams of the place ranked by penalties a match (penalty points given away), the prediction rating's estimate for the robot alone that the team page shows, most or fewest first. One team asked for is titled "with the most", never "best". The match with the most penalty points ("most penalties in NJ") stays the match finder's.
- **Never the rules card for a team.** A penalty question naming a team, or asking which team in a place, is a stats question: it no longer opens the Rules quick reference. "Penalty for pinning" and every other rules question still do.
- **Totals at an event.** "How many penalty points did 12345 give away at an event, total" leads with the total there, the per-match figure under it. "Give away", "gives away" and "fouled" read as penalties.
- **Team names in ranked lists.** On a phone, a long team name cut to two lines no longer shows a third line over the town under it. (#853)

## 3.6.4 — 2026-11-06

A question search can't answer yet now says "Sorry — I can't answer that yet", shows what it understood, and offers searches that do answer.

### Highlights
- [fixes] A question search can't answer yet says sorry, plainly
- [fixes] It shows what it understood: the team, place, event or name
- [fixes] Tap a suggested search that does answer about them

### Search
- **Sorry, with what was read.** A question about a team that search can't answer yet ("what is <team>'s favorite color") now has the heading "Sorry — I can't answer that yet", a line saying what it read, and up to four searches about the same team, place, event or name that do answer, one tap each. A search that reads nothing real (a team that doesn't exist) keeps the plain no-match page, and the dropdown is unchanged. (#877)

## 3.6.3 — 2026-11-06

"12345 at worlds" answers with the team's results there, as "12345 states" does for its state championship.

### Highlights
- [teams] "12345 at worlds" shows the team's Worlds results
- [teams] A team with no Worlds matches is told so plainly
- [teams] "Has 12345 been to worlds" still counts its trips there

### Search
- **A team at Worlds.** A team and Worlds alone ("12345 at worlds", "12345 worlds", "show me 12345 at worlds 2025-26") answer with the team's results at the FIRST Championship: its record, its division and its matches, as a team and its state championship already did. A team with no Worlds matches is told it has none on record, never an empty page. A measure named with it ("worlds record", "opr at worlds") is still that measure.
- **Whether a team went.** "Has 12345 been to worlds", "went to", "made it to", "qualified for" and "appearances" stay the question of its trips there, answered by its Worlds appearances, never its results. (#852)

## 3.6.2 — 2026-11-06

"What events are happening right now?" and "number of teams in …" are answered however they're asked.

### Highlights
- [live] "Events happening now", "going on now" or "live" lists today's events
- [live] "Events taking place this week" lists this week's events
- [teams] "Number of teams in …" and "total number of teams" count like "how many"

### Search
- **Events and time words, said more ways.** "Happening now", "going on now", "on right now", "live now", "live" and "currently" read as today; "taking place", "being held", "running" and "scheduled" are read as part of an events question, never as a name. "Number of", "count of", "total number of" and "what's the total" count like "how many". (#876)

## 3.6.1 — 2026-11-06

A team's rating or OPR trend, asked any way, shows the trend card.

### Highlights
- [teams] "Is the rating going up or down" shows the rating after each event
- [teams] "OPR at each event", "event by event", "over the season" read alike
- [teams] The trend's season is the one you name, else the team's latest

### Search
- **Trends, said any way.** A team's prediction rating or OPR asked as a trend ("12345 rating going up or down lately in 2025-26", "is 12345's rating improving", "rating after each event", "12345 opr at each event", "opr event by event in 2024-25", "opr trend over the season") answers with the trend card already used for "rating trend" and "opr history": the number after each event, rising or falling, in the season named (else the team's latest). The trend words are one entry in the search lexicon; the plain "12345 opr" stays the plain number. (#851)

## 3.6.0 — 2026-11-06

More ways to ask who, what and where get the same answer: who beat a team, a team's region or school asked first, its Worlds division, its best match ever.

### Highlights
- [teams] "Who beat …?" lists the teams that beat them
- [teams] "What region is … in?" and "what school is … from?" answer the fact
- [teams] "What Worlds division was … in?" answers the division
- [teams] "…'s best match ever" shows its highest score of all time

### Search
- **Who, what, where and the best, said more ways.** "Who beat <team>", "who has beaten" and "who eliminated" give the teams that beat it; "what region / school / city is <team> in" answers the fact asked first; "what Worlds division was <team> in" answers the division; "<team>'s best match ever" or "of all time" gives its highest score ever (and "worst" its lowest). (#874)

## 3.5.9 — 2026-11-06

A Scout form closed while it waits for its workspace's template no longer leaves a timer running behind it.

### Highlights
- [scout] Closing a Scout form while its template loads leaves nothing running
- [scout] A template asked for again restarts its wait, never stacking timers
- [fixes] A test that failed now and then on CI is steady again

### Scout
- **The template wait is cleared.** A new-entry form waits up to 6 seconds for a workspace template it has never seen, then opens with the built-in fields. That timer is now cleared when the form closes, and a second fetch replaces the first's timer instead of adding one. Before, a closed form's timer still fired, which on CI showed as an occasional "window is not defined" error after the Scout templates tests. (#869)

## 3.5.8 — 2026-11-06

"Has a team ever …?" is answered yes or no first, in a big coloured word, with the card that proves it underneath.

### Highlights
- [teams] "Has … ever been to Worlds?" answers Yes or No first
- [teams] "Did … ever beat …?" says yes or no, with their meetings underneath
- [teams] "Did … play at <event>?" says yes or no, with the events
- [teams] "Has … ever won Inspire?" says yes or no above the awards

### Search
- **Yes or no, said every way.** "Has <team> ever …", "did <team> ever …", "was <team> at …" and "did <team> make it to …" are read as one yes-or-no question about Worlds, a state championship, an event in a season, a kind of event, an award, an event won, or beating or losing to another team. The answer is the word Yes (green) or No (slate), with a sentence saying it, above the card that answered the question before, unchanged; when nothing answered it, the card is the evidence: the meetings, the awards or the events played. Only official events count. A no is an answer, never the no-match page. (#873)

## 3.5.7 — 2026-11-06

A team's wins and losses by event, side by side.

### Highlights
- [teams] "Wins vs losses by event" shows each event's wins and losses
- [teams] "Record by event" and "per event" read the same
- [fixes] "Wins vs losses" is a team's record, never a match against another team

### Search
- **Wins and losses by event.** "12345 wins vs losses by event in 2025-26", "12345 record by event", "wins and losses per event" answer with the team's record card and a row for each event (its wins and losses, ties when there are any, and its season when the answer spans several), oldest first, each linked to the event. "Wins vs losses" said without an event split is the record alone. Before, "vs" there was read as a second team. (#850)

## 3.5.6 — 2026-11-06

"When did a team last play?" is answered however it's asked: the last, the first and the next time, and when it started.

### Highlights
- [teams] "When was the last time … played" shows that team's most recent match
- [teams] "When did … first play" shows its first match
- [teams] "When does … play next" shows its next match, or says there's none yet
- [teams] "What year did … start" shows its rookie year

### Search
- **When, said every way.** "When was the last time <team> played", "when did <team> last play", "<team>'s most recent match" and "<team> last played when" give the most recent match card; "the first time", "first ever" and "very first" give the first match; "the next time <team> plays" and "when will <team> play again" give the next match, saying plainly when none is scheduled. "When did <team> begin competing", "join FTC" or "get started", and "which season was <team> founded", give the rookie year. (#872)

## 3.5.5 — 2026-11-06

A team's forecast at Worlds or states is for its own division there.

### Highlights
- [predict] "Advancement odds at worlds" shows the team's own Worlds division
- [predict] "At states" means the team's own state championship
- [predict] An event still to come shows the chance to advance when you ask for it

### Search
- **Forecast at a team's Worlds or states.** "23268 advancement odds at worlds in 2025-26", "chance to advance at worlds", "odds 23268 advances at worlds 2026" and "prediction at states" answer with the prediction-vs-result card for the team's own division at that season's Worlds (or its own state championship): the event the team is listed at, never another one. Advancement wording ("advance", "advancement", "make the finals", "go through") is one entry in the search lexicon, taken only by forecasts. For an event still to come, an advancement question shows the chance to advance rather than the chance to win. (#839)

## 3.5.4 — 2026-11-06

Long questions are read whole.

### Highlights
- [fixes] A full question up to 160 characters is read to its last word
- [fixes] A season at the end of a long question is no longer cut off
- [fixes] Past the limit, the query is cut at a whole word

### Search
- **Long questions read whole.** Search read only the first 80 characters, cut inside a word, so a long question lost its end: "… or was it way off in 2025-26" became "… in 2025-2", and the season (or the event, or the last team) went missing. A question is now read up to 160 characters; past that it's cut at the last whole word, never inside one. The names list reads the same length. (#838)

## 3.5.3 — 2026-11-06

"12345 vs 67890", with no event, answers with both teams' season numbers side by side, however it's asked.

### Highlights
- [teams] "12345 vs 67890" puts both teams' season numbers side by side
- [teams] "Who is better, 12345 or 67890" gives the same side-by-side card
- [teams] Two teams at Worlds use the latest Worlds either one went to
- [teams] A team never at Worlds is told so, with the other's results

### Search
- **Two teams side by side.** "12345 vs 67890", "12345 versus 67890", "compare 12345 and 67890", "who is better, 12345 or 67890": the season's numbers of both teams in one card (OPR and its phases, the prediction rating, ranks and records), with Compare's own page first among the links. The numbers are printed once: the head-to-head panel that used to repeat them under it is left out when the card shows them. "12345 or 67890" alone is still a search for either team, and a name two teams share still asks which one.
- **At Worlds or states with no season said.** Two teams compared at Worlds when neither went this season use the newest Worlds either went to. One that has never been there is told so plainly, with the other team's own results linked. (#875)

## 3.5.2 — 2026-11-06

Two teams compared at an event show each team's numbers there.

### Highlights
- [teams] "12345 vs 67890 at an event" compares the two teams' numbers there
- [teams] OPR, rank and record at the event, side by side
- [fixes] When only one of them was there, the card says which

### Search
- **Two teams at an event, side by side.** A comparison with an event named ("7149 vs 23268 at nj championship 2025-26", their Worlds, their states) answers with each team's row there: OPR at the event and by phase, qualification rank and record (a championship's division and finals as one), the leader as the headline. When only one of them played it, or each played a different event the words name, the card says so and offers each team's own results. A comparison with no event keeps Compare's card. (#825)

## 3.5.1 — 2026-11-06

A team's matches in a season are an answer of their own: the record, quals and playoffs apart, then every match.

### Highlights
- [fixes] A team's matches in a season are listed, newest first
- [fixes] The record on top, with quals and playoffs apart
- [fixes] A season with no matches says so for that season

### Search
- **A team's matches in a season.** "17670 matches in 2026-27", "show me gearview matches 2025-26" or a team's number and "matches" answer with the team's record in that season (its latest, when none is named), quals and playoffs apart, and every match below it, newest first. Before, only the team's card came back. A place or a window said narrows it ("gearview matches in New Jersey in 2024-25"). Matches at Worlds or at a state championship stay that event's results card, with its division, rank and OPR. A season with no matches says so for that season, never another season's matches. (#813)

## 3.5.0 — 2026-11-06

Search predicts a full match: two alliances of two.

### Highlights
- [predict] "Predict 12345 23456 vs 34567 45678" gives the match's call
- [predict] Win chance, predicted score and margin for each alliance
- [predict] "Custom matchup" and "who wins" phrasings read the same

### Search
- **Two alliances of two.** Four teams with "vs" between the pairs ("predict 12345 23456 vs 34567 45678", "12345 and 23456 vs 34567 and 45678 who wins", "custom matchup …", by number or name) answer with the engine's call for that qualification match, as Predict makes it: each alliance's win chance, predicted score and margin, the confidence, each team's rating, and Predict opened on the same lineup. The season is the one named, else the latest every team has a rating in. Before, the card compared only the first team of each side. (#834)

## 3.4.9 — 2026-11-06

A forecast asked against what happened answers with the event's forecast card.

### Highlights
- [predict] "Was the prediction right" at an event shows prediction and result
- [predict] "Before and after", "vs actual" and "last prediction" all read the same
- [fixes] These questions no longer stop at the team card

### Search
- **Prediction against the result, any wording.** A team's forecast at an event held up against what happened ("4215 predicted rank at nj championship vs actual rank", "show me 4215's predictions before and after east bergen", "4215 last prediction for east bergen", "did the prediction for 4215 at east bergen get it right, or was it way off") answers with the forecast card for that event, which already shows the prediction beside the result. The words that hold a forecast up against the result are one entry in the search lexicon, and only the forecast takes them. (#828)

## 3.4.8 — 2026-11-06

A question that names its season and also says "this season" is answered for the season it named.

### Highlights
- [fixes] "This season in 2025-26" answers for 2025–26 instead of nothing
- [fixes] The card names the season the question named
- [fixes] Works in any word order, for any team, place or match question

### Search
- **"This season" beside a season named.** A question that names a season and also says "this season" ("biggest upset in NJ this season in 2025-26", "this season 4215 record in 2025-26") had the extra words left over, so nothing answered it. Now the season named stands, the card says it, and the words saying it again are read with it. "Last season" next to a named season is a second season (a comparison), so it is never read as the same one. (#811)

## 3.4.7 — 2026-11-06

Search lists events by status, then by date: what's live now first, then what's coming day by day, then what's over.

### Highlights
- [fixes] Live events first, under a solid rose header
- [fixes] Upcoming events, cyan, grouped by day this week, then by week
- [fixes] Finished events come last, newest first, under a lime header
- [fixes] Every heading and tab counts the events under it

### Search
- **Status, then date.** A search's events sit in sections: Live now (by start), Upcoming (soonest first: Today, Tomorrow or the weekday for this week, then "Week of …"), and Finished (newest first, sectioned the same way). Each heading says how many events are under it, and an event split in divisions sits whole in its section as its tree. Nothing names an event, a date or a type: any list works.
- **Counts that match.** The Upcoming tab counts the events to come and says its live ones apart ("Upcoming 23 · 2 live"), as its sections do; All is the three together (#805).

## 3.4.6 — 2026-11-06

"How many teams are called …" counts every team with that name and lists them, however it's asked.

### Highlights
- [teams] "How many teams named …" counts and lists every team with that name
- [teams] Asked as "called", "with the name" or "go by", it's the same answer
- [teams] Add a place or a season to count only those teams
- [teams] "How many teams from" a town lists that town's teams

### Search
- **Teams by name, counted.** "How many teams named …", "teams called …", "number of teams with the name …" read the words after "named" as a name, never as the one team that has it, and answer with the count and every team with that whole name, by number, with where each is from and its last season played; the count is always the list. A place ("… from NJ") or a season ("… in 2025-26") narrows it and is said on the card. No team with the name says so, with the names the words nearly spell or are part of and Browse all teams, never the no-match page.
- **A town's teams counted.** "How many teams from" or "in" a town answers with the town's list of teams, its length the count. A state's or a country's count is unchanged. (#804)

## 3.4.5 — 2026-11-06

A video page for any event, division or team: every match's video, the event's stream and a filter.

### Highlights
- [history] "Jackson division recap" lists every match with a video, ready to play
- [history] Each event's full stream sits beside its matches
- [history] Filter a video page by qualifications or playoffs
- [history] Highlights now list every match's video after the standouts

### Search
- **A video page.** "Recap", "replay", "videos", "watch", "stream" or "VOD" with an event, a division, Worlds, a place, a season or a team ("jackson division recap", "watch worlds", "4215 videos at worlds") lists every match with a video in the events' order: its label, both alliances' teams and the score in their colours, a tap playing it in the app's video dialog; each event's full stream first; a qualifications/playoffs filter; the first 24, then "Show all". The card plays the latest playoff match (a team's latest playoff win). A scope of more than 200 matches lists its playoffs and says so. Nothing with a video: one line and a link to the event or the team. (#827)
- **Highlights, then every match.** A highlights answer ("worlds highlights jackson division", "<team> highlights at worlds") keeps its standout matches first and lists every match's video and the stream under them.

## 3.4.4 — 2026-11-06

A count question about a team's name is no longer answered with that team's highlights.

### Highlights
- [fixes] "How many teams named …" no longer shows one team's highlights
- [fixes] A team searched alone still opens with its highlights
- [fixes] A team name with a filler word still gets its highlights

### Search
- **Highlights only for the team alone.** A search read as one team and more words it couldn't answer ("how many teams named bad wolf", read as "6980 how many") no longer gets that team's highlights as its answer; a team's number or name alone, with a season or the word "team", still does. (#812)

## 3.4.3 — 2026-11-06

Search answers are in bold colour: every award, scoring phase and team has its own colour, the same on every card.

### Highlights
- [appearance] Inspire, alliance and judged awards each in their own colour
- [appearance] Auto blue, TeleOp green, Endgame purple, penalties red on every card
- [appearance] Thick coloured bars, filled chips, coloured numbers, no grey

### Search
- **One palette.** Every search answer uses one set of colours, one per meaning, never shared. Auto is blue, TeleOp green, Endgame purple, penalties red and ranking points yellow. Inspire is magenta, Winning Alliance orange, Finalist Alliance pink, judged awards teal and performance awards indigo. Live, Upcoming and Finished each have one too. Anything without a meaning of its own (a team's numbers, bars, lines and ranks) takes the team's colour.
- **Bolder.** Tiles get a thick left bar in their colour and a filled icon, and their number is in the colour too. Award rows and chips are filled, phase tiles in match boxes are solid, and the event awards podium is in the award's colour. The leaderboard's phase columns and section headings are coloured, and each highlights video tile's reason is a filled chip with a matching edge (Best Auto in Auto's blue, the rest in the team's colour). Every text and fill clears 4.5:1 in every theme.
- **Checked on every card.** Each card type is tested so that nothing outside the palette is used, no two meanings share a colour, and no bar, line, tile, pill or chip is left grey. (#794)

## 3.4.2 — 2026-11-06

Highlights as a grid of match videos; a team's card plays the team's own match.

### Highlights
- [history] Highlights are a grid of match videos, each labelled with its reason
- [history] A team's card plays one of its own matches, not the event's start
- [history] An event with no recording still lists its matches, stats only

### Search
- **Highlights as a video grid.** A highlights answer (a team's or a scope's) is a grid of tiles, one per match, its reason ("Best score", "Closest win") as the tile's label over the match's video and its match box; a tap plays it in the app's video dialog, one video at a time. A match's own video shows its picture; a second in the event's recording shows its time, never the recording's picture (whatever was on the field then). A match with no clip keeps its tile with "No video"; when none has a video, one line says "No recording for this event — stats only." (#803)
- **A team's card plays the team's match.** An answer about a team ("gearview opr at worlds", a team's highlights) plays its own listed match, else its best-scoring match at the event with a clip; the event's recording from its start is the fallback only when none has one.

## 3.4.1 — 2026-11-06

A championship's divisions branch off it as a tree, coloured by status, with each fact said once and yellow kept for the control you picked.

### Highlights
- [fixes] Divisions branch off their championship, stacked on phones
- [appearance] Status in colour: red Live, blue Upcoming, green Finished
- [fixes] Place, venue, dates and type said once, on the championship
- [fixes] Each division shows its team count, and the championship shows the total

### Search
- **A tree.** An event split in divisions shows the event on the left (on a phone, on top), with a status-coloured trophy badge as the tree's root: its name, season and game, dates (from its first division's start to its finals' end), place, venue, type, status and how many teams in all. Its divisions branch off one line on the right (on a phone, stacked and indented under it), each a node on the line, with the finals last and tinted, where the divisions meet. A division is its name, how many teams it has, its own pages (Matches, Rankings, Teams, Playoffs) and its status only when it differs. The newest finished season and any upcoming or live one start open; older ones open with a tap and still count.
- **Colour that means something.** Status is the colour: a solid chip, the block's thick bar and the connecting line, red for Live, blue for Upcoming, green for Finished, each at AA contrast. Yellow is only the time tab you picked: event cards drop the yellow type bar, label and "View event" cue (the card is already its link), and the page's heading and links are plain.
- **No season tabs.** Events that share a name across seasons are a card each, and the season filter picks one (#796).

## 3.4.0 — 2026-11-06

"Highlights" answers for any event, division, region, season or team, with each match's video.

### Highlights
- [history] "Worlds highlights jackson division" shows that division's best matches
- [history] "gearview highlights at worlds": a team's best matches at one event
- [history] Recap, replay, videos, watch and best matches read as highlights
- [history] A team that wasn't at the event is told so, with its own events

### Search
- **Highlights over any scope.** "Highlights" (or "recap", "replay", "videos", "clips", "watch", "stream", "VOD", "best matches", "top moments") with an event and its divisions, one division, Worlds, a state championship, a place, a kind of event, a match type, a window or a season lists that scope's best score, biggest margin, latest playoff match, best Auto, closest finish and biggest upset, each match once with its reason and its video; the best one plays on the card. With no season said it reads the latest season with matches there and says so once ("No 2026–27 matches yet at Worlds; showing 2025–26"); a calendar year with an event is the one held that year. The event's dates and place are its chips. (#795)
- **A team's highlights at an event.** A team by number or name with "highlights" and an event, Worlds or a state championship ("gearview highlights at worlds", "best matches 4215 at worlds") lists its standout matches there only, never padded from other events, the event said once in the title. A team with no played match there gets a card saying so, with its own events of the season, never the closest results.

## 3.3.9 — 2026-11-06

A championship split in divisions is one result a season, with its divisions under it, and every count on the page matches the cards shown.

### Highlights
- [fixes] A championship's divisions are listed under it, one block a season
- [fixes] Every FIRST Championship season is listed, not the newest 25 events
- [fixes] "first championship in 2025" shows the championship held in 2025
- [fixes] Picking a season or Upcoming/Past changes the heading to match

### Search
- **Divisions under their event.** Any event split in divisions (the FIRST Championship, New Jersey's, Romania's, any other) is one block a season: the event's name, season with its game ("2025–26 DECODE season"), dates, place, venue and status once, a link to the Events list on that season and event, then each division and the finals. The grouping comes from each division's own event code in the data, never a name (#790).
- **One count.** The page lists 25 results with an event and its divisions counted as one, so "first championship" lists all 28 of its events where it listed 25 and said "28 in all". A list still longer than a page says how many of all are listed ("the newest 24 of 30 listed"), the same number the tabs and the events heading show.
- **Year and filters together.** A year named with "in" ("first championship in 2025") is the championship held that year, the 2024–25 season's. A season picked from the list, or Upcoming or Past, rewrites the heading for what's left ("FIRST Championship (Worlds) events, 2024–25"), and stays in the address.

## 3.3.8 — 2026-11-05

Cards about one team are in that team's colour again, scoring phases take the team page's colours, and team numbers in match boxes no longer spill out of their chips.

### Highlights
- [appearance] One team's numbers, bars and chart are in its colour
- [appearance] A Worlds card's latest trip and division-rank line in colour
- [appearance] Auto blue, TeleOp green, Endgame purple, penalties red, as on team pages
- [fixes] 4- and 5-digit team numbers fit inside their chips in match boxes

### Search
- **One team's colour.** A card about one team (its Worlds or states trips, how good it is, its record, OPR, highlights and facts) draws its headline number, tiles, bars, division-rank line and dots, latest trip, game names, award chips and pills in team A's colour, the colour that team has when search compares it. The latest trip's dot is larger and filled. Cards about two or three teams keep a colour per team, and cards about no team stay neutral. No gold, at most three colours, and every number clears 4.5:1 in every theme. (#789)
- **Phase colours.** Match boxes, OPR tiles and phase values show each scoring phase in the team page's colour: Auto blue, TeleOp green, Endgame purple, penalties red, and total and ranking points yellow.
- **Team chips fit.** A match box's team chip never gets narrower than its number, so a 4- or 5-digit team stays inside its border, and only the name is shortened. The phase tiles sit beside the scores only when the box itself is wide enough (two boxes side by side are narrow); otherwise they go underneath.

## 3.3.7 — 2026-11-05

Long search questions answer faster: a word looked up once is remembered for the rest of the answer.

### Highlights
- [speed] Long questions answer up to 7 times faster
- [speed] "Top NJ team vs top Romania team" answers in under a second
- [speed] Award-filtered team lists read each team's awards directly

### Search
- **A word looked up once.** One answer asks for the same team or word many times (each reader and layer asks again), and a word that finds nothing used to scan every name each time. Search now remembers each lookup for a minute, until the search index is rebuilt. Of the 19 held-out questions that took over a second, 11 now take under one, and the slowest went from 6.8 s to 2.0 s, with every answer unchanged. (#779)
- **Award lists by index.** A list of teams that won an award reads each team's own awards, never every award that season for each team.

## 3.3.6 — 2026-11-05

Every kind of search answer is checked on a 390 px phone: nothing runs off the screen, and every link and button is big enough to tap.

### Highlights
- [appearance] Match names in search answers are easier to tap on a phone
- [appearance] A line chart's points are bigger tap targets
- [appearance] Video buttons and the search list are full 44 px taps on phones

### Search
- **Checked at 390 px.** A new check (`npm run phone-proof`) opens one search for every kind of answer card on a 390 × 844 phone and fails on sideways scrolling, anything past the screen's edge, a link or button under 24 × 24 px, two that overlap, a team number cut off, or more than one main button; it saves a phone shot of each.
- **Bigger taps.** A match's name in a match box ("Q1", "M2") is at least 44 px wide on a phone; a line chart's points are 24 px; the leaderboard's "#" sort is 24 px wide; and the video's "Open on YouTube", each match's play button and the search list's rows are 44 px on a phone (they were 44 px only where the text size is 16 px) (#778).

## 3.3.5 — 2026-11-05

Prediction questions answer in the card, with the chance on a 0–100% bar, and a search nothing answers shows the closest real results.

### Highlights
- [predict] "Predicted chances of a team at an event" gets an answer
- [predict] The win chance is a 0–100% bar, with Open in Predict
- [fixes] No answer shows the closest teams and events as full cards
- [fixes] How FTC One Search works describes the search as it is now

### Search
- **Prediction answers.** A team's prediction at a named event leads with its chance (the next match's, else the average over the matches played, else the event's) as a number and a bar on a 0–100% scale. The next match shows its predicted score with its ranges, only when the season has a rated match. Open in Predict is the card's one action, and expected wins print once. (#776)
- **No answer.** One sentence says what's missing; the closest teams and events follow as full cards, with searches that answer about them.
- **How it works.** The search page's explainer covers reading a question in any order, the season rule, widening in a stated order and worked-out measures.

## 3.3.4 — 2026-11-05

A match question with a time that had to be widened no longer says the time was left out.

### Highlights
- [fixes] "Top match in Ohio this week" keeps "this week" read
- [fixes] A widened time is named once, in the card's chip
- [fixes] Every other word left out is still said to be

### Search
- **Widened time, read.** When a match question's week or month has nothing yet and the card widens it, the chip ("Relaxed: this week → 2025–26") counts as naming the time, so the heading no longer adds that the time isn't part of the answer. (#777)

## 3.3.3 — 2026-11-05

Search answers sit in one readable column, the page footer stays at the bottom of the screen, and each page has one main button.

### Highlights
- [appearance] Search answers in one column, easy to read across
- [appearance] A short search page's footer sits at the bottom, not mid-page
- [appearance] One main button per page; other actions are plain links

### Search
- **One column.** Search results and answers sit in a centred column at most 720px wide on a wide screen (a side panel, when a question has one, beside it), so a card's numbers and their labels stay a short glance apart instead of stretching across the whole window.
- **The footer at the bottom.** A search page with one short answer grows to fill the screen, so the footer sits at the bottom of the window as on every other page, never floating under the card.
- **One main action.** "Full team page" on an answer and "Awards page for …" under an event's awards are underlined text links (as is a compare card's "View comparison"), so a comparison's "Open in Predict" is the only button on the page (#775).

## 3.3.2 — 2026-11-05

Questions about a team's wins and losses answer with the matches asked for: the last loss, the first win, the longest losing streak, the teams it lost to.

### Highlights
- [fixes] "When did a team last lose a match" shows that loss
- [fixes] "Longest losing streak" counts losses, not wins
- [fixes] "Who did they lose to the most" lists the teams that beat them
- [fixes] "Where is a team based out of" and "how old is it" answer

### Search
- **Wins and losses as a filter.** A team's first, most recent and last few matches, and its longest streak, read a win or a loss said with them, and the card's title says which. (#774)
- **Lost to.** "Lose to", "lost to" and "beaten by" list the opponents that beat the team, most often first. "Most often" is how often, never the best partner.
- **Team facts.** "Based out of" reads as where a team is from and "how old" as its rookie year; "if any" never stops an answer.

## 3.3.1 — 2026-11-05

Search answers say each fact once: the number you asked for, its context, then what's new, with how it's counted one tap away.

### Highlights
- [appearance] Each answer states its number once, with one rank or percentile
- [appearance] A record's win rate and season aren't repeated in tiles below it
- [appearance] Matches at one event name the event once, not in every box
- [rankings] "Best auto in NJ" on a phone shows each team's Auto, not its OPR

### Search
- **Each fact once.** A single number's answer keeps a rank or a percentile beside it, never both, and drops a tile that repeats the headline (an OPR answer's Total OPR tile; a record's win rate tile and its "win rate" line again under the bar; a Season tile when the season is already shown). A list of matches all at one event names the event once over the list, each box keeping its date.
- **How it's counted, one tap away.** Every answer's method is behind an info button beside one footnote line, as on comparisons, instead of a paragraph in the card.
- **A ranking shows what it ranks by.** A list of teams ranked by Auto, TeleOp or Endgame shows that column on a phone instead of the total OPR.
- **"No 2026–27 matches yet" said once.** When no season is named and the current one has nothing yet, the note saying the season before is shown appears once, beside the answer, instead of in the page heading and the method as well.
- **No highlights for an unanswered question.** A question about a team that search can't answer yet ("will 4215 win the NJ championship") says so with its suggested searches, without the team's highlights under it (#772).

## 3.3.0 — 2026-11-05

Lists of teams answer however they're asked: the lowest first, a town, a whole country, undefeated teams.

### Highlights
- [rankings] "Who has the highest auto OPR in NJ" lists the teams
- [rankings] "Worst teleop OPR in Romania" lists the lowest first
- [rankings] "Best team in Cluj-Napoca, Romania" lists that town's teams
- [rankings] "Any team with a perfect record" lists undefeated teams

### Search
- **Leaderboards said any way.** A list of teams by a season stat reads with or without "team", lowest first ("worst", "lowest", "sorted lowest to highest"), for a whole country, a town with its state or country after it, a country by its people's word ("Romanian teams"), a count at the end ("top 3") and undefeated teams. A lowest-first list keeps each team's place counted from the top and opens the Teams page sorted the same way. "Just curious", "only" and other asides are never read as a team's name. (#773)

## 3.2.9 — 2026-11-05

Search finds matches by what made them stand out: the closest, the most lopsided, the biggest upset or comeback.

### Highlights
- [fixes] "Closest match in Romania last month" answers with the match
- [fixes] "Biggest upset in New Jersey" and "best comeback in Michigan" work
- [fixes] Filter by quals, playoffs, finals or league meets in any match question
- [fixes] No season said reads this season, or says it's showing last season

### Search
- **Match finder.** Questions about matches with no team named ("lowest scoring match in Texas last week", "most lopsided match in Ohio", "match with the most penalty points in New Jersey", "closest finals match in California last year", "highest scoring match at a league meet") are answered with the match and every filter on the card. One match asked for is the headline, with the next few in a table under it. Matches asked for ("closest matches") are one ranked table. Each match is printed once. Upsets and comebacks are worked out by a rule printed on the card under "How this is counted". An upset is only a favourite's loss, and the finals include a double-elimination bracket's grand final. (#769)
- **Season.** A question about a place or everyone with no season said reads the current season (the highest score too), and when that has none of what was asked yet it shows last season and says so. "Last season" is the one before the current one.
- **Everywhere.** "In the world", "worldwide" and "globally" mean every place, never the FIRST Championship.

## 3.2.8 — 2026-11-05

The site looks as it did yesterday, and the owner has a dog theme to switch on whenever they like.

### Highlights
- [appearance] Page colours back as they were: graphite, white, soft grey and black
- [appearance] No pink background or drawn dogs and bones
- [appearance] Compared teams in sky blue, orange and green again
- [appearance] A dog theme the owner can turn on: a yellow tint and a real dog photo

### Appearance
- **As before.** The pink page and sidebar in every theme, the drawn dogs and bones across the page, and the pink browser bar are gone: Light is white again, Dim soft grey, Dark graphite and Midnight black. (#771)
- **Team colours.** Compared teams on search answers are sky blue, orange and green again, as the results guide's colour-blind-safe set.
- **Dog theme.** A new switch in the owner console's Features tab, off until the owner turns it on: every theme's page and sidebar tinted yellow, with a real dog photo faintly across the background. Cards, text and answer colours stay as they are.

## 3.2.7 — 2026-11-05

Searching a team's number or name now shows its highlights: its standout matches of the season, each with its video when one exists.

### Highlights
- [teams] A team search shows its best matches of the season
- [teams] Each highlight says why it's there: best score, biggest win, playoffs
- [teams] Highlights with a match video play right on the answer

### Search
- **A team's highlights.** A search for one team alone ("4215", or its name) opens the results page, which answers with its standout matches of its latest season with matches (or the season the search names, "4215 2024-25"): its best score (points without penalties), biggest win, latest playoff win, best Auto and closest win, each match listed once under the first reason it meets, with a label saying which. Only matches its robot played in count, and points are never compared across seasons. Each match box links to the match, and the answer's video plays the best score's clip when the match has one, with each other highlight's clip one tap away. A team with no match on record still opens its team page straight away (#770).

## 3.2.6 — 2026-11-05

Every search answer card now passes the results guide's checks: colour means team, bars match their numbers, and every number is readable in every theme.

### Highlights
- [appearance] Award podiums, Worlds trips and team facts in neutral ink
- [appearance] Every bar on an answer is exactly as long as its number
- [appearance] Red alliance numbers readable on Dim's lighter card
- [fixes] Links on answers are underlined text, gold only on hover

### Search
- **One check for every card.** A test now draws each kind of search answer (comparisons, top matches and match boxes, a single match, leaderboards, a record, stat tiles, event results, trends, phase bars, a prediction at an event, a relaxed time window, a match video, event awards, team facts, Worlds trips and their summary, "how good is" a team) and holds each to the results guide: every bar as long as its number from zero (within 5%), hue for teams only and red and blue only for alliances, no gold on data, at most three hues, nothing said twice, no parser or debug text, and every piece of text at 4.5:1 in Light, Dim, Dark and Midnight.
- **Neutral where it isn't a team.** An award's podium is told by its steps, icons and places, not green, blue and orange. A Worlds trip's rank, record, OPR and awards are plain pills, its marked trip a solid label, and the summary's numbers, rank line and win-rate ring neutral ink. A team's location tile drops its blue. A trend line is no longer gold. A team card's season tiles (OPR, rating, record, events) are neutral too, an award's podium teams aren't listed again under it ("Other awards at this event"), and on a card about one team its own chip in a match box is its number alone, since the card's header already names it.
- **Honest bars.** The leaderboard's OPR bar was 0.5rem short of its number; it now sits in its own track at exactly OPR over the best. A record's split bar uses the unrounded win share.
- **Readable alliances.** On Dim, red alliance numbers take rose 400 (rose 500 fell to 3.8:1 on a match box's tint), and a losing alliance's score in the combined table is muted grey instead of faded red or blue. (#759)

## 3.2.5 — 2026-11-05

The whole site is pink now, with dog doodles drawn across the background.

### Highlights
- [appearance] A pink page in every theme, pale or deep
- [appearance] Dog doodles (faces, paw prints, bones) across the background
- [appearance] The browser bar and the first paint match the new pink

### Appearance
- **Pink background.** The page colour behind everything is pink for everyone, in every theme: #fdedf6 on Light, #3d1a2e on Dim, #2b0f20 on Dark and #1a0612 on Midnight. Cards, text and buttons keep their colours, and text and the keyboard focus ring keep their contrast on the new pages (the light pink is the palest that keeps the focus ring at 3:1).
- **Dogs.** A tile of outline dog doodles in pink repeats behind the page. It's decorative only (hidden from screen readers, never in the way of a tap) and sits under every card.
- **Matching chrome.** The phone's browser bar colour, the installed app's colours and the page's first paint before the app loads all use the same pinks, so nothing flashes grey or white first. (#761)

## 3.2.4 — 2026-11-05

Home's search chips wrap onto rows instead of sliding sideways, a chip is shown whole or not at all, and none is misspelled.

### Highlights
- [home] Search chips wrap onto rows: nothing slides sideways
- [home] Every chip shows whole, never cut off mid-word
- [home] Desktops show all six chips every hour; phones the most that fit
- [fixes] No more misspelled example searches among the chips

### Home
- **Chips on rows.** The hour's six chips under Home's search wrap onto rows of a fixed height: three from a small tablet up, two on a phone. Each chip is measured once, and the most that fit whole are packed onto the rows, a leaderboard and a sentence or filtered search kept first; one that doesn't fit is left out, never cut off, and the "Try" hint walks only through the chips showing. Nothing scrolls sideways, and the list is the same height every hour, so the change on the hour never moves the page. On a touch screen each chip's tap area is 44px, with the rows far enough apart that two never overlap. (#735)
- **All six on a desktop.** Each hour's six are picked to fit a desktop's three rows whole, even in the narrow column beside the globe, so a desktop never leaves one out.
- **Spelled right.** The three chips that showed off "Did you mean" with a misspelled team name are gone, and that kind of chip with them: shown as a thing to try, a typo read as ours. Spelling correction still works behind the scenes, and a real typo still gets its "Did you mean" line. `npm run suggestions:check` now also fails a chip whose query or label search would correct, against the stored team, event and place names, or that spells a named team otherwise than the team's own name.

## 3.2.3 — 2026-11-05

Search reads a question as its parts in any word order (team, event, place, time, what's asked) and answers from the data, the same card for every phrasing.

### Highlights
- [report] Search reads a question's parts in any word order
- [report] One table of synonyms and filler, not one list per answer
- [report] Times like "this week" and "last month" are read against today
- [teams] Any word order, any filler: one question gets one answer card
- [fixes] A future year says it has no events yet, never the latest season

### Search
- **The question as parts.** A new reader (`server/api/query/`) splits a question into its parts: teams, event, place, time, match type, side, Worlds or states, award, highest or lowest, a count, a match number and what's asked. It reads them in any word order and skips filler. Every word has to be explained, and a question with a word left over is left to today's search. Nothing is guessed. A complete reading is answered first, ahead of today's readers.
- **One word list.** Every synonym, filler phrase and measure word sits in one table ("worlds" is the FIRST Championship, "opr" the offensive power rating, "record" W-L-T), and what's asked is picked by one rule table.
- **Time and place.** "This week", "last week", "this weekend", "last month", "in March", "on Mar 15, 2026", "2024-25", a game's name, "last season" and "ever" each become a date range or a season, read against today. Teams, towns, regions and countries come from the data, and a name several teams share is picked by Compare's rules or left unread. (#736)
- **Answered from the parts.** A complete reading runs as one structured question over the stored matches, events and awards. "12345 highest score", "highest score 12345", "what is the best score for 12345" and "score highest 12345 rn" read the same and show the same card, for any team, and the card lists what was read. "This week" filters matches by their date and says "This week".
- **Places and years.** A state, a province, a country ("in Romania") or a region code filters events by where they were held; a team's question with no place keeps the team's own events, and no place is ever read as New Jersey. A year is that season; one with no events on record yet ("12345 record 2027") says so, with the latest season as a question to ask.
- **One highest-scoring match.** "The highest-scoring match" lists that one match with both alliances, their teams, the event and the date; "matches", "scores" or "top 5" lists several. (#743)
- **Widened in a stated order.** When a date window ("this week", "last weekend", "in March") has nothing in it, a team's question or a highest-scoring-match question widens it to the seasons its dates touch (newest first), then to the season before, one step at a time. The card's first chip says what changed ("Relaxed: this week → 2025–26"), its heading says it was relaxed, and its counting note lists each step tried. A place, an event, a team or a year named is never widened. (#749)
- **Predictions before and after.** A prediction question that names an event ("predicted chances of 12345 east bergen conference") shows, for that event, what the engine predicted before each match beside what happened. That means the win chance and predicted score next to the result, whether the call was right, and expected wins against actual wins, with the stored pre-event projection when there is one. Calls come from the log made before each match. Where a match wasn't logged live, the card uses the walk-forward replay and says so; the two are never mixed on one card. With no year it's the latest event of that name the team is listed at; a team not listed there is told so, and no other event is shown instead. Open in Predict opens on the team at that event, or on the two teams for a matchup. (#752)
- **Checked on every change.** A new search eval asks about teams drawn at random from the latest season in many phrasings (every word search knows for "highest", "score" and the rest, the team by number or name, in any order, with or without "what is"), checks each card against the match tables, and fails any answer slower than a second. It runs on every pull request. `npm run search:heldout` asks 533 questions people wrote for search and that it was never built from, and sorts each answer into a pattern with the pass rate per set.
- **What the checks found.** A team name of seven words or more was never read whole, so its questions took the slow path (2.7 s, now about 30 ms). "Mean scoring for …" showed what "mean" means instead of the average. A name already looked up isn't searched for again as an event. A team's name one letter off is that team, with a "Did you mean", only when no other team's name is as close, and a name that starts with a colour ("Blue …") is read whole rather than as the blue alliance. A name written partly in another script no longer leaves a stray letter behind. (#753)
- **Failed searches by pattern.** A failed search is filed under what search read (the intent, which parts were filled, what was left unexplained), with every team, number and place left out. Every query that fails the same way adds to that one entry and its examples, where before each query had its own. (#760)
- **Missed words.** Each pattern counts the words its queries left unread and lists them, the most frequent first: the word at the top is usually a phrase search should learn. Entries filed per query before this release are left as they are. (#760)
- **Parts of a region.** A direction before a region ("north jersey", "northern california", "western new york") is read as that whole region, since parts aren't on record, and the answer says so. A place named that way by itself ("North Carolina", "West Virginia", "Northern Ireland"), a town on record ("East Brunswick") or an event's name ("North Texas Championship") stays itself. This replaces a rule written only for New Jersey and works in every kind of question. (#768)
- **"Not" help from the data.** When "not" is followed by a word that isn't a team, the example leaves out a team that team has really played against, not a fixed number. (#768)

## 3.2.2 — 2026-11-05

Search plays the video the site has for what you asked: a match's clip, or the event's stream, in the answer.

### Highlights
- [live] "USMACMP Q12" plays that match from its second in the stream
- [live] An event's results, winners or awards play the event's stream
- [live] Top matches and match lists: a play button on each clip
- [speed] The player loads only when tapped; search stays as fast

### Search
- **The match asked about, in the answer.** An answer about one match ("USMACMP Q12", "the highest scoring match in decode", "highest score at massachusetts championship") plays FIRST's own video of it, else the event's recording from that match's second, else the event's stream from its start: the same videos the event page plays. Nothing plays until it's tapped: the card shows the video's picture and a play button, and the player loads on the tap.
- **An event's stream.** An event's results, rank, winning alliance and awards, and an event searched by name, play its live stream or recording in the card. An event with no video shows nothing about it.
- **Play buttons in lists.** Top-scoring matches and a team's matches at an event give each match with a clip a small play button; it plays in the app's video player over the search page, so search stays where it was.
- **One read for all of it.** An answer's video is read once for the whole answer, whatever its number of rows, from the stored match times and the kept recording lists, which now keep answering while they refresh. Event-local match times convert about ten times faster. (#725)

## 3.2.1 — 2026-11-05

Search answer cards follow the search results guide: comparisons say the result once, bars start at zero, and colour means team.

### Highlights
- [appearance] One headline per comparison: who leads and by how much
- [appearance] Paired bars from zero, each row on its own season scale
- [appearance] Colour means team only: violet and orange bars
- [appearance] No phase, podium or win colours on answer data
- [fixes] No "read as" text; team names printed once per card

### Search
- **Comparison cards.** Two- and three-team answers (OPR, rating, phase, record, reliability, awards, compare) are one card: the teams named once in the title, one headline with the result and the gap, one context line (ranks, records, the phase that decided it), then a row per metric. Each row has a bar per team from zero to the row's own maximum, printed as "max N", and the gap on the right. The Total comes first, then the rest by the size of the gap, five rows at most. A row's maximum is the season's highest, rounded up, so the same number draws the same bar on every card that season. The team header strip, the second season pill and the stat tiles are gone; the method sits behind an info button, and "Open in Predict" is the one button.
- **Team colours.** Teams are violet and orange (the app's own chart colours; teal for a third team), apart under every colour vision and each at least 4.5:1 against the card in Light, Dim, Dark and Midnight. They are used only on bars and swatches. A winner is bold with its "+N", not coloured.
- **No hue on other data.** Phases, ranks, podium places, records, results, event types and stat tiles are neutral on every answer card. Red and blue stay only where they mark an alliance. OPR and combined-score bars are neutral and start at zero.
- **Matches as boxes.** Every list of matches is a grid of match boxes: the place in the list, the match and its event, the red alliance over the blue with their teams and scores (the winner marked, the loser muted) and the listed alliance's points by phase.
- **Less meta text.** Boolean queries no longer add "read as" to their label, and an unclear query asks "awards or location? Say which". (#709)

## 3.2.0 — 2026-11-05

Search answers misspelled questions about four times faster, and filtered team lists in well under a second.

### Highlights
- [speed] A misspelled search answers about four times faster
- [speed] Filtered team lists answer in under a second, not a minute
- [speed] A search asked again within a minute answers at once
- [fixes] A page's first slow search tries once more before saying so

### Search
- **Typos, faster.** Search's in-memory typo scan scores each distinct name word once per word typed (about a third of the work), skips the spelling distance for words whose letters are already too different, and reuses its working rows. Spelling correction skips the same words. Every score is the same number as before. (#716)
- **Repeated reads kept.** The search index's reads and the event lists a search reads are kept until the data or the index changes, so the readings of one search (and a correction's second reading) share them. A whole answer is kept for a minute.
- **Places.** "Events at River Dell High School" and "events in Oradell" work out each venue's spelling once, and each time zone's date format once, instead of once per event per search.
- **Measured.** `scripts/search-bench.ts` asks a running server 365 queries (the 260 list, the complex queries, misspellings) and checks every answer against an earlier run's.
- **Filtered lists.** "NJ teams that won Inspire" and "teams that went to Worlds" looked up each team's awards and events the slow way: 30 to 100 seconds a list, holding up every other request meanwhile. A new index (migration 72) and a reordered lookup make them a few tens of milliseconds.
- **Slow searches.** A page's first search that runs out of time now tries once more before showing "Search is slow", as every other search already did.

## 3.1.9 — 2026-11-05

Home's search chips change every hour, six at a time from a pool that shows each kind of answer search gives.

### Highlights
- [home] Six new search chips every hour, the same for everyone
- [home] Chips for OPR, records, Worlds, awards, winners and more
- [home] Questions in a sentence and searches with several filters
- [home] The box's "Try" hint walks through the hour's chips

### Home
- **Suggestions that rotate.** The six chips under Home's search are picked each UTC hour from about 70 queries: team facts, OPR by phase, prediction rating, records with quals and playoffs apart, matches at an event or Worlds, awards, Worlds trips, two and three teams compared, leaderboards, event winners, next events, a misspelt name, questions in a sentence and searches joining several filters. Never two of one kind, always a leaderboard and a sentence or filtered search, and no team twice. A long query shows a short label and runs in full. The pick is worked out from the clock, so nothing extra loads and a cached page still changes on the hour.
- **Every chip answers.** `npm run suggestions:check` asks the live search for each query and fails on any that gives no answer card, or one that says nothing was found. (#705)
- **Taps and room.** On a touch screen each chip's tap area is 44px tall, with the chip drawn the same size as before. Where the search column is too narrow for three rows to hold any six (a phone, or beside the globe), the chips are one row that scrolls sideways, so the hourly change never moves the page.

## 3.1.8 — 2026-11-05

Search reads a season's best scores by its game, without penalties or by period, and common words never name a team.

### Highlights
- [rankings] "Highest score in decode without penalties": the season's best
- [rankings] "Highest auto score in centerstage", each period's best
- [fixes] Words like "without", "team" and "best" never name a team alone

### Search
- **A season's best, by its game.** "What was the highest score in decode without penalties" is DECODE's (2025–26) best alliance score with penalties taken off: the match, its event, both alliances, the score with and without penalties and its auto, teleop and endgame points in their phase colours. Each season's game name, in any spelling ("center stage", "into the deep"), is read from the season list, and a place narrows it ("highest score in nj in into the deep").
- **One period's best.** "Highest auto score in centerstage", "top teleop scores in decode", "highest endgame score in nj in into the deep": the season's best alliance scores in that period, and both alliances' combined, the period marked on each match.
- **Common words name no team.** A question whose leftover words are only common ones ("without", "team", "best", "the", "robotics", …) names no team, however many team names hold them ("T.W.C.A. (Team Without a Cool Acronym)" for "without"). Beside a word of a name's own ("team without a cool acronym", "sparks") they still find it, and a name typed whole is still found. (#712)

## 3.1.7 — 2026-11-05

Search answers the failed searches filed since 3.1.4: an event named without "at", numbers typed against words, typos, bare numbers and sorts said in plain words.

### Highlights
- [teams] "What rank did 4215 get in the east bergen conference"
- [rankings] "Teleop ranked", "best auto sorted lowest to highest"
- [fixes] Run-together, jumbled and cut-off words are read as meant
- [fixes] A number with no team shows the closest team numbers
- [teams] A team that skipped an event: the reason, and its real events

### Search
- **An event named beside the team.** An event's rank, OPR and results, and the forecasts, read the event wherever the query names it ("what rank did 4215 conference", "predicted chances of 4215 east bergen conference"), as one of the team's own events; "conference" alone is the team's conference tournament. Words that name none of its events leave the question as it was. (#694)
- **Typed together, misspelled, cut off.** A team number typed against the next word is two words. A long word with its letters jumbled reaches search's own word, a word missing a letter is the word meant, and "east bergen conference winner" is the event's winning alliance. A query cut off mid-word is read without it (a Worlds trip question cut off at its last word is still the Worlds one), offered as a correction.
- **Numbers with no team.** A single digit or a number no team has ("676767") shows the closest real team numbers, as "238" did, never an empty page; a placeholder entry's number says it has no page.
- **Sorts in plain words.** "Best team sorted by auto", "teleop ranked", "sorted lowest to highest" (the bottom of the list, each team's place counted from the top) and "best auto and endgame" (the two OPRs added) are the phase-OPR leaderboards. "What is the bet" and "what is the best time" offer "what is the best team".
- **A rating change with no team.** "Predicted changes" says a change is one team's and asks it of the season's top-rated teams; "4215 predicted change" is its rating change.
- **An event a team didn't play.** The card says why, from the records: a team from another state or country, else the kinds of events it played that season (or none, with its latest season's), and links each of those events' pages.
- **Worlds trips name their game.** "Last went to Worlds in 2023–24 · CENTERSTAGE, Edison Division": the headline, each trip and the streak and best-rank notes say the season's game. The trip asked about is marked, and ranks, records, OPRs, awards and the summary numbers take the team page's colours.

## 3.1.6 — 2026-11-05

The home track record leads with today's engine: 74.8% of 2025–26 winners called right.

### Highlights
- [home] The track record's big number is engine 3.5's month-by-month test
- [home] 27,354 correct and 9,218 missed on 2025–26 matches with a winner
- [home] The site's full-season replay (73.8%) is named right below it

### Changes
- **Today's engine on the home page.** The track record's "Last season" tab (was "Season replay") shows engine 3.5 on the month-by-month test from How it works › Accuracy: 74.8% on 2025–26, 27,354 of 36,572 matches with a winner at rated events. The line below names the site's own replay of every match in order (73.8% on 41,405 decisive calls) and says the two use different match lists. "This season so far" is unchanged. (#720)

## 3.1.5 — 2026-11-04

How it works shows today's engine on the month-by-month test, instead of the engine 1.x figure.

### Highlights
- [report] How it works shows engine 3.5's accuracy and Brier per season
- [report] The 72.7% figure is now labelled as the first engine 1.x test
- [predict] Margin error shows engine 3.5's drop next to the old engine

### Changes
- **Today's engine.** How it works › Accuracy opens its engine results with a table of engine 3.5 on the rolling monthly test: 76.5% called right, Brier 0.1578 and margin error 38.64 points on 2024–25; 74.8%, 0.1681 and 37.26 on 2025–26. The margin column shows 3.5's smaller error next to the previous one.
- **Engine 1.x test, named.** The 72.7% headline, its baselines (Figure 8) and the learning curve come from the engine's first held-out test; they now say engine 1.x. Its 82% range coverage is engine 2.2's ranges result and says so. The ledger's season replay (73.8% on 2025–26) is unchanged: 3.5 moved no win chance. (#673)

## 3.1.4 — 2026-11-04

Search answers questions that join filters or ask two things at once, each filter it read named on the card and applied.

### Highlights
- [rankings] Team lists by place, award, Worlds and OPR, filters joined
- [teams] Losses by under 10, partners with OPR over 80, wins vs top 10
- [teams] Best event by rank, worst by OPR, OPR without the worst event
- [teams] "Awards and record", "where is Bad Wolf from and their record"
- [fixes] "When they lose" is never read as a team called Lost or Loose

### Search
- **Team lists with filters.** A place (a state, or a home city), an award won that season, Worlds in a season ("went to worlds in 2025" is the 2024–25 championship) and an OPR, rating, win-rate or reliability threshold combine, sorted by the stat asked and cut to the top N. The list is the leaderboard, with where each team won the award or its Worlds division, rank and OPR. With nothing over a threshold, the card says how many teams were checked and the closest one. (#667)
- **One team, filtered.** Wins or losses by a margin, partners or opponents at an event (a championship's division and finals together) with an OPR there over a number, wins over a world top-N team (by rating, with the OPR count beside it), average score in wins against losses, and OPR at the first or last event of two seasons.
- **Events picked and averaged.** Best event by rank and worst by OPR in one season, and the stored per-event OPRs averaged with the worst (or best) event left out, beside the stored season OPR. Nothing is recomputed.
- **Two answers on one card.** "Awards and record" (or OPR), and "where is … from and what is their record", which also finds a team by its name. Three or four teams' reliability side by side names the most reliable.
- **Fixes.** A compare side made only of words like "when they lose" no longer matches a team's name by spelling.

## 3.1.3 — 2026-11-04

Search answers about one event work for every team, not only the teams it was first checked with.

### Highlights
- [teams] "NJ championship" reads the division the team played
- [teams] A division and the finals it reached count as one event
- [fixes] A team that didn't play an event is told so, not left blank
- [fixes] Teams numbered like a year (20205) are found again
- [teams] "States", Worlds, venues and two teams at one event answer

### Search
- **The team's own event.** "23268 matches at NJ championship" found two of Ultraviolet's events alike (the Turnpike Division and the finals) and showed an empty page; 4215 only played Parkway, so it never hit this. A championship named now takes in the division the team played and the finals it reached, read as one ("New Jersey Championship (Turnpike Division and finals)"), with the division's rank and OPR. Events of one name it played (an AM and a PM meet) are read together, and one match number at each is listed rather than picked. A division named outright is that division alone. (#665)
- **Events a team didn't play.** "10809 record at NJ championship" says Crow Force didn't play at New Jersey Championship in 2025–26, naming the event checked, and lists the same question for the events it did play, instead of an empty page.
- **Places.** A team from elsewhere asked its place on New Jersey's lists is told it's from its own state, with that state's question, not that it's short of matches.
- **Worlds rating.** An off-season event after Worlds isn't rated, so "rating at worlds" now shows the rating a team finished Worlds on instead of "isn't stored".
- **States.** "4215 matches at states in 2024" reads the team's own state championship that season (a year picks the season), lists every match, and links its other state championships; "states opr", "states rank" and "states wins and losses" answer directly. A team with none on record is told so.
- **Worlds, kinds of event, last and first.** "worlds Ross" reads that Worlds division; "league meets this season", "at their last event" and "at their first event" read the team's own events. Won, lost and playoff filters apply at that event, and an event with more than one row gets an "Each event" table.
- **Two teams at one event or venue.** "4215 and 6980 matches at river dell" finds the venue under any spelling it was stored with and lists their matches there; if one team wasn't there, it says so and names the event it played.
- **Reused event codes.** "east bergen conference winning alliance" reads the East Bergen event, not the South Essex event that used the same code a season before. The distinctive words in a name decide; words like "league" or "conference" only break ties, and the latest season with that event wins.
- **Team numbers.** A typed number is a typo only of a number as long: team 20205 no longer matches the year 2025, nor 20265 an event named "… 2026 Bishkek", so "when did 20265 start in FTC" finds the team.

## 3.1.2 — 2026-11-04

Search reads long, conversational questions and answers them like their short form.

### Highlights
- [teams] Ask in your own words: "when was the last time 4215 went worlds"
- [teams] The answer keeps its own heading; the short form is a quiet line
- [fixes] A question search can't answer offers ones it can, for that team

### Search
- **Long questions.** Search takes the question's wrapper off ("can you tell me", "what was", "how many times has", "please", "?") and reads what's left as the short form it already answers. Spoken fillers such as "like" or "basically" go too. "When was the last time 4215 went worlds" gives Worlds appearances, "is 4215 better than 6980 at auto" the Auto side by side, "who did 4215 play with the most this season" the most frequent partner. Season and place words still scope the answer. It is fixed rules, no AI. (#655)
- **Showing line.** An answer read from a rewritten query keeps its own heading. The words it read go on a quiet "Showing: …" line under the heading, never in it.
- **The first or last time.** "When was the first time enforcers went to worlds" (by number or name, Worlds or states, "worldes" corrected) gives the appearances card headlined with that trip: "First went to Worlds in 2023–24 (Franklin)".
- **Team numbers typed wrong.** "42-5" or "421" isn't a team: search offers "Did you mean: 4215" and the nearest real team numbers, the most recently active first, instead of "No team, event or match matched".
- **Team fallback.** A team found with a question search can't answer says so plainly. The query is never quoted back. Two or three questions it does answer follow, built from the team's records: Worlds appearances only for a team that went, its season's record and OPR.

## 3.1.1 — 2026-11-04

Each tab on an event page has its own small icon, so the one you want is easy to spot.

### Highlights
- [appearance] Every event page tab now has its own icon
- [rankings] Rankings is a podium, Awards a medal, Playoffs a bracket
- [teams] Matches is the field, Teams two robots, Odds a die

### Appearance
- **Tab icons.** Matches (the field split into two halves), Rankings (a podium), Insights (a rising chart), Teams (two robot heads), Playoffs (a bracket), Awards (a medal) and Odds (a die) each draw an original icon before the label, in the tab's text colour, on desktop and phone. The labels are unchanged, so screen readers read the same names. (#675)

## 3.1.0 — 2026-11-04

Search answers look like the team page all the way down: an award at an event is a podium with every award the event gave, a record splits qualifications from playoffs, and no name is cut off.

### Highlights
- [rankings] Who won an award at an event: a podium, 1st in the centre
- [rankings] Every award the event gave, and its Awards tab, one tap away
- [teams] Records split qualifications and playoffs, each with its rate
- [teams] Where a team is from is drawn as a place, city to country
- [fixes] Event names in match lists and OPR by event are never cut off

### Search
- **Award podium.** "who won inspire at East Bergen League Tournament 2026" draws the asked award's 1st, 2nd and 3rd places as a podium, 1st in the centre and highest, each team's number big with its name and the award's name as FIRST gives it, each linked to the team's season. Under it, every award the event gave, in the event page's order, and a button to the event's Awards tab. "who won nj states" lists all the event's awards the same way, with no podium. Colours are the team page's tile tones (green, blue, orange), never gold.
- **One answer, said once.** When search answers a question directly (an answer card or a stat answer, not a guess), Bruno AI is not asked, so his card never repeats the answer beside it. He still answers questions search only lists results for, and his card says "Bruno AI from Control Point".
- **Records.** A record over both qualifications and playoffs ("4215 states record") shows each apart under the win-loss bar: W-L-T, win rate and matches, with its own bar.
- **Place card.** "where is 4215 from" draws the place over a map-style grid with a pin, the place big, and its city, state and country as FIRST lists them.
- **Leaderboards.** The top three's rank badges are coloured (green, blue, orange).
- **No truncation.** Match rows' event names and partners, and OPR by event's names, wrap instead of being cut off with "…"; the cut-off names under the OPR line are gone (the list under it has every name). Table values such as W-L-T stay on one line on phones. (#648)
## 3.0.9 — 2026-11-04

Three fixes to the two-team and forecast answers from 3.0.7's last review.

### Highlights
- [predict] A forecast "this season" is labelled with the current season
- [teams] Partner OPR at a named event uses that event's season
- [teams] Compare names no leader when no team has an OPR

### Fixes
- **Forecast labels.** "4215 advancement chances this season" for a team with no match yet this season showed the current forecast under last season's heading and team link; both now name the current season, also when the question names an event ("at Northeast League Meet this season"). (#628)
- **Partner OPR at an event.** "Partner with the highest combined OPR at" an event asked for a season although the event names one; it now reads that event's season, the meetings still that event's only.
- **Compare with no OPR.** When none of the compared teams has an OPR (counted matches that were all no-shows), the card shows the table and names no leader, instead of the first team under "Highest OPR: –".

## 3.0.8 — 2026-11-04

Search fixes spelling: a mistyped team name, stat word, event word or place shows "Did you mean: …", which you can tap, and the best match for it.

### Highlights
- [teams] A team name typed with a slip still reaches the team
- [teams] Search shows "Did you mean: …" and runs it on a tap
- [fixes] Stat words typed with a slip (record, awards) still answer
- [fixes] Two names equally close are both shown, never guessed

### Search
- **Spelling correction.** Every word of four letters or more is checked against a vocabulary built from the stored data (team names, schools, event names and venues, cities and regions) and search's own words (OPR, record, awards, Worlds, Inspire, playoffs, qualifiers, the game names, the question words). A word that isn't in it and is one letter off (two in long words) is corrected: in a team's name, a stat word, an event word or a place. Numbers, event codes, words typed in capitals, words of three letters or fewer, any word of a team's name and plain forms of known words ("winning", "placed") are never changed. No AI is involved.
- **The better answer wins.** Search reads the query as typed and as corrected, and keeps the corrected answer only when it is better (a direct answer, results that match, or more results naming the corrected words). It is labelled "Did you mean: …. Showing results for that, not …"; the corrected query is a link that runs it. When the query as typed found as much, its results stay and the fix is only offered.
- **No guessing.** A word two names fit equally ("molt": Volt Bots, Bolt Bots) is left as typed and both teams are listed. The name matcher no longer labels one of two equally close names as "Did you mean". (#584)

## 3.0.7 — 2026-11-04

Search answers questions about two or three teams, a team's partners and opponents, and predictions, each in one card from the stored numbers.

### Highlights
- [predict] "4215 vs 6980 prediction": win chance, score and margin
- [teams] Compare two or three teams in one card: OPR, rating, record
- [teams] Partners and opponents: lists, best and worst, win rates
- [predict] Next-event chances come from the event's stored forecast

### Search
- **Predictions.** "4215 vs 6980 prediction", "who wins", "predicted score against", "expected margin against" and "win probability against" give the engine's call for one team on each alliance, the same numbers Predict shows for that lineup: who is favoured, the win chance, the predicted score and margin, and both teams' ratings. Nothing is worked out for the search: it uses the ratings the site already holds. (#567)
- **Next event.** "4215 chance to win an event", "advancement chances", "chance to advance to worlds", "predicted to make playoffs" and "predicted wins at their next event" read the event's stored forecast. Before one is published, the card names the event and says so; no number is guessed.
- **Two and three teams.** "4215 vs 6980 compare" and "4215 6980 33950 compare" show OPR, OPR rank, the phases, rating and record for the season in one card. "Who is better at auto / teleop / endgame", "who has higher reliability" and "who has won more awards" name the winner from the team pages' numbers. "4215 wins against 6980" counts the meetings; "matches together" is the same list as "shared matches"; "match against 6980 at worlds" says when there is none.
- **Partners and opponents.** Worst partner, partners and opponents (this season or at Worlds), teams beaten or lost to most often, the partner with the highest combined OPR, the highest-OPR opponent, win rate with partners and opponents' win rate, and a pick suggestion drawn from past partnerships. With no season named, the latest completed season (2025–26).

## 3.0.6 — 2026-11-04

Search reads a query with no season as the latest completed season (2025–26 for now, said on every card), and "last season" as the one before it.

### Highlights
- [rankings] Leaderboards show the latest completed season
- [teams] "Last season" now means the season before the latest one
- [rankings] Leaderboards by reliability and record, and a town's best
- [teams] Ask how a team's OPR or rating changed and see both numbers

### Search
- **The season a query means.** With no season named, search reads the latest completed season: the newest one whose FIRST Championship has finished in the stored events (2025–26 until the 2026–27 Championship is over), never a fixed year. "This season" is that season too and "last season" the one before it (2024–25). Every leaderboard, team fact and team stat says which season it shows and why. A team with no matches in that season falls back to its own latest season, said so. (#574)
- **More leaderboards.** "Top 5 teams by reliability in New Jersey" ranks by the team page's reliability index; "New Jersey leaderboard by record" (or by rating, or by any stat) lists a place's top 25; "best team in New Jersey by OPR" leads with that place's #1; "best team in Oradell" ranks a town's teams by OPR.
- **How a number changed.** "How much did 4215's OPR improve from last season to this season" shows both seasons' OPR, the difference and each season's world standing. "How much did 4215's rating change this season" shows the rating in the earliest and the last weekly Rankings snapshot kept for the season, the change and the weeks between, with the team page's live rating beside them.
- **A place's events by season.** "Events this season in New Jersey" and "events last season in New Jersey" list that state's events for the season, not a team called Event Horizon. "Upcoming events this weekend" lists this weekend's events.

## 3.0.5 — 2026-11-04

Search answers a team's OPR and prediction rating the ways people ask: its rank worldwide or in a state, its best and worst events, Worlds, its trend and its rating's ± spread.

### Highlights
- [teams] Rating answers lead with the rating, its ± and world rank
- [rankings] "4215 opr rank in New Jersey" gives its place in New Jersey
- [teams] Best and worst event OPR, OPR at Worlds, OPR trend
- [fixes] "Auto OPR versus TeleOp OPR" compares one team's own phases

### Search
- **Rating card.** "4215 rating" leads with the rating and its ± (98 ± 3.2) and its world rank (#525 worldwide), formatted as the team page's rating tile, then its parts.
- **Ranks and places.** "opr rank worldwide", "rank worldwide" (OPR and rating), "percentile worldwide by opr" and "is 4215 in the top 10 percent" answer from the team page's world rank. "opr rank in New Jersey", "rating in New Jersey", "rank in New Jersey" and "place on the New Jersey leaderboard" give the place on that state's own list: the Teams list filtered to it by OPR, or Rankings filtered to it by rating.
- **Events and Worlds.** "highest opr ever", "lowest opr", "opr at their best/worst event", "average opr across events this season" and "opr at worlds" (its division named) answer from the team's stored event OPRs. "rating at worlds" is the season rating it finished Worlds on; "best prediction rating ever" names the season and its last event.
- **Trends and spread.** "opr trend over seasons" shows this season event by event and each season's standing; "rating trend" reads the weekly Rankings snapshot after each event; "prediction rating uncertainty" and "prediction confidence" give the ± and the matches rated; "penalty opr" gives the penalty points given away per match.
- **Fixes.** "6980 auto opr versus teleop opr" compared 6980 with team 24357 Teleop Tigers; it now sets 6980's own Auto against its TeleOp. "4215 opr compared to the average team" read "the" as an event; it is now the world average over the teams the team page's rank counts, stated on the card. (#558)

## 3.0.4 — 2026-11-04

Every search answer is now one card in the team page's look, with the
team up top, big numbers and its season at a glance, and no gold boxes.

### Highlights
- [teams] A search answer shows its team like the team page does
- [teams] Short answers add the team's season tiles and events
- [appearance] No gold boxes or pills in search answers
- [appearance] Auto, TeleOp and Endgame use the team page colours
- [fixes] The Bruno AI card says "Bruno AI from Control Point"

### Search
- **One card system.** A fact ("where is 4215 from"), a records card (Worlds trips, awards, next event, high scores, a rule) and a stat answer are drawn in one card in the My Teams card's treatment: the team's number big and bold, its name, home, school and rookie year, the season it's about and a Full team page button, then the answer's title and what it covers. A two-team answer shows both teams side by side. The card's title is left to screen readers when the page heading already says it.
- **Short answers fill the page.** A one-line answer adds the team's season at a glance (the team page's OPR, prediction rating, record and events tiles) and that season's events with rank and record, all from the team page's own data, so the footer no longer sits under a two-line card. A fact card that carries the season of its numbers and the rest of the team's card (region, reliability) uses that season and shows those facts too.
- **Big bold values.** Facts and stat numbers are team page tiles: the value big and bold, its name above, a note under, each in a team page colour.
- **No gold.** Answer cards, headline bands, scope chips, related-question pills, the Compare card, event and trip badges, the query badge and the team table's rank badges and OPR bar are no longer gold; the yellow-bordered box is gone.
- **Phase colours.** Auto, TeleOp and Endgame bars and table columns use the team page's phase colours (sky, emerald, violet), with a thin bar in that colour.
- **Compare.** The Compare card shows both teams' numbers big and bold with no gold box or button; the head-to-head adds the prediction rating and states its season once, and phones show it under the Compare. No team cards repeat the two sides.
- **Bruno AI credit.** The Bruno AI card is headed "Bruno AI from Control Point". (#566)

## 3.0.3 — 2026-11-04

Search answers a team's name, region and profile directly, and
explains how search, predictions and Worlds qualification work.

### Highlights
- [teams] "4215 team profile" gives the team page's numbers in one card
- [teams] Ask a team's name, region, city and state, or school name
- [teams] A number then its name ("6980 bad wolf city") finds the team
- [fixes] Explainers for search, predictions and Worlds qualification

### Search
- **Team profile.** "4215 team profile summary", "4215 scouting profile" and "4215 team page summary" give one card: name, city, region, rookie year and the season's record, OPR (with its world rank), rating ± its uncertainty and reliability, read from the same stored rows as the team page (#562). With no season named it's the latest completed season (2025–26 now), or the team's latest season with matches.
- **More team facts.** "what is team 4215 called", "what is the name of team 4215", "4215 region", "4215 city and state" and "4215 organization name" are answered directly. A team number followed by that team's own name ("17670 raider robotics location") is that team.
- **Fuller fact cards.** Every fact answer also carries where the team is from, its region and that season's numbers (card.support), so the card can show the whole team. A school FIRST doesn't list is still said so, now with the team's city.
- **How it works.** "how does FTC One Search work", "how are predictions made" and "how does worlds qualification work" get short explainers from the site's own pages and the stored 2026–27 Competition Manual rules; the rating and reliability explainers say more. "what does 4215's reliability score mean" gives the team's reliability.
## 3.0.2 — 2026-11-04

Search answers a team's events, awards and Worlds history more exactly: one award by name, the newest or first award, the events it ranked 1st at, its Worlds divisions and its matches at a given Worlds.

### Highlights
- [teams] Ask for one award, like "4215 Design award", and get only it
- [history] "Most recent award" and "first award ever" name the event
- [history] Events ranked 1st, and the best or worst event by rank
- [history] Worlds divisions, wins at Worlds and a Worlds year's matches
- [fixes] "decode championship winning alliance" means Worlds again

### Search
- **One award.** "4215 Design award", "… Judges Choice award", "… winning alliance awards" list only that award (2nd and 3rd places as such), or say plainly that none was found in any season on record. Award words never become part of the team's name.
- **Newest and first.** "4215 latest Inspire award", "4215 most recent award" and "4215 first award ever" lead with the award, its event, season and date, and list every award the team won at that event.
- **Awards at a region's events.** "4215 awards at New Jersey events" keeps only awards from events in that region, and says so.
- **Events ranked 1st.** "events 4215 won outright" and "events 4215 placed first in" list the events where the team ranked #1 after qualifications, each labelled as a placement. Winning Alliance and Inspire wins stay in "event wins". League meets are left out (their stored rank is the league's running standing).
- **Best and worst event.** "4215 best event ever" and "… worst event ever" go by rank first and then the record there. Event tables now show a W-L-T column, counted the way the team page's event list counts it (playoffs included).
- **Worlds.** "4215 worlds divisions", "championship divisions 4215 played in" and "4215 championship appearances count" give one row per Worlds the team went to (its division, season, rank and record) and the count. "4215 worlds wins" is the match-win count. "4215 matches at worlds in 2025" reads the year as when the championship was held (2024–25), and lists the matches or says there were none, naming the seasons it did play.
- **Event schedule.** "4215 event schedule this season" lists the season's events newest first, with dates, ranks and records.
- **Winners.** "winning alliance at 4215's last event" answers for the team's latest event played, its division when it played in one. A bare "championship" ("decode championship winning alliance", "who won the ftc championship in 2025") is the FIRST Championship, never a state event with that word in its name.
- **Event codes.** "USNJNEM6 event" opens that event's card from its record (dates, venue, place, status), like typing the code alone. (#580)

## 3.0.1 — 2026-11-04

Search answers more about a team's matches: records in quals or playoffs and by place, score spread, best phases, penalties, form and how it does against top or rookie teams.

### Highlights
- [teams] Search answers win rate, ties, score range, median and spread
- [teams] Best Auto, TeleOp and Endgame match, in the team page colours
- [teams] Penalty points a match, rate, per event, at Worlds or playoffs
- [teams] Record vs top-rated or rookie teams, and early vs late season
- [fixes] Quals and playoffs records and averages say so in the title

### Search
- **Records by scope.** "Playoff record this season", "quals record", "record in quals" and "average score in playoffs" read the match type and say it in the title ("Record in quals in 2025–26"); with no season named they are the latest season's. "Record at New Jersey events" and "record at out-of-state events" read a place of events (outside the team's own state for the second). "Average score at worlds" is every Worlds the team went to unless a season is named. (#575)
- **Scores at their official value.** A team's highest, lowest and average score lead with the official score, penalties included, as its match list and its "avg alliance score" show it, the score without penalties beside it. The highest and lowest are still picked by the alliance's own points, so a score made by the other alliance's fouls never becomes the record: it's shown beside it, said so ("302: 102 of its own, 200 from fouls"). "Best match", "high score", "highest alliance score" and "highest scoring match this season" all name that same match.
- **New answers.** Win rate leads with wins out of matches (26 of 32, 81%); ties; score range, median and consistency (the middle half and the spread in points, never a made-up percent); scores over a number with the count; the match with the highest Auto, TeleOp or Endgame (its phases as the team page's coloured tiles) or the most penalty points given away; penalty points per match, the penalty rate, per event, at Worlds or in playoffs, with the robot's own share from its rating; the easiest opponent by rating; the record against top-rated (the season's top 10% by rating) or rookie opponents; early season against late season; the last 5 matches with their scores and trend; and the OPR trend with the season's rating beside it.
- **Groups are never teams.** "Against top teams", "rookie teams" and "early season" are read as groups of matches, never as a team named "Top Hat" or "Rookie".

## 3.0.0 — 2026-11-04

Searches people tried that found nothing now answer: a match by its event's code, an event's match by the event's name, a leaderboard by a game, and the season's events.

### Highlights
- [fixes] "usnjcmp q1" finds Q1 in each division of the championship
- [fixes] "jackson division q12" finds that match at Worlds
- [teams] "Best auto in decode" lists that season's top Auto OPR
- [fixes] "Events" lists this season's events, not a team's name
- [fixes] "4215 matches at worlds" finds the last Worlds they went to

### Search
- **Failed searches answered.** Each was filed by the failed-search reporter (#536):
  - A match by its event's code with no year is from the newest season with matches ("usnjcmp q1", not next season's unplayed event). An event split in divisions has its qualification matches in each division, so "USNJCMP Q1" lists both divisions' Q1, and a division's finals are its event's ("usnjcmppkwy f1" is the New Jersey Championship's F1).
  - A match at an event named by its own name ("jackson division q12", "worlds jackson division q12", "jackson divison q12") is that match.
  - A leaderboard by a game or a season ("best auto in decode", "best scoring auto in decode", "top auto opr decode", "best auto opr in 2025-26") is that season's, never a team named "We are the best".
  - "Events", "events this season" and "meets" list the season's events, never the team Event Horizon.
  - A team's matches at Worlds with no season ("4215 matches at worlds", "… in worlds") are from the last Worlds it went to.
  - A game's name typed with a slip next to an event, and a question opened with filler ("so like what was 4215 last game"), are read as meant.

## 2.9.9 — 2026-11-04

Search answers that already name a team no longer repeat it in a team card below, and every search section label reads in sentence case.

### Highlights
- [teams] Answers about a team show it once, with one profile link
- [teams] Search section labels read in sentence case, not capitals
- [fixes] Search chips, pills and links are 44px tall on touch screens
- [fixes] A short search answer keeps the footer right under it

### Search
- **One card per team.** A fact, stat, Compare or head-to-head answer that names its team or teams no longer lists them again in a Teams card under it. One small "View scouting profile" row sits under the answer instead; a fact answer's row keeps the team's season badges (record, OPR, OPR rank) its card used to show. (#524)
- **Sentence-case labels.** Section labels and pills on the results page and in the search box ("Teams", "Top 10 by OPR", "Meetings, newest first", "You may also want to know") are no longer forced into capitals. Game names keep FIRST's own capitals.
- **Touch-size targets.** On phones and touch screens the time filter, season and type pickers, Clear filters, suggestion pills, link chips, example chips, season tabs, the table's row chevron and the "View scouting profile" links are at least 44px tall. Desktop with a mouse keeps today's compact sizes.
- **Footer follows the answer.** On the search page a short answer no longer leaves the footer pinned to the bottom of a mostly empty screen.

## 2.9.8 — 2026-11-04

A team's OPR in search now looks like, and reads the same numbers as,
its team page.

### Highlights
- [teams] Search's OPR card uses the team page's coloured OPR tiles
- [teams] No yellow band behind the OPR in search's answer
- [fixes] Search's OPR card reads the team page's own season numbers

### Search
- **The OPR answer is the team page's card.** "4215 opr" (and every one-team OPR or phase OPR question) shows Total OPR, Autonomous, TeleOp and Endgame as the team page's tiles: the same names, icons, colours, rank line ("OPR #612 of 8,308 with an OPR · top 8%") and rank bar, from one shared list both pages draw. The value in each tile is in its phase's colour. The yellow band behind the big OPR number is gone, and the card has the team page's plain border and header; the season chip, the rank and the chart stay.
- **One reader for both.** The card's numbers come from the same function the team page reads its season numbers with, formatted the same way (73 rather than 73.0), so the two can't drift. Nothing is worked out during a search. (#532)

## 2.9.7 — 2026-11-04

Predicted scores sit a little closer together: margins ran about 5% wide, so engine 3.5.0 calibrates them. Win chances are exactly what they were.

### Highlights
- [predict] Predicted margins are 5% tighter, closer to real ones
- [predict] The Lab writes the calibration out step by step
- [report] How it works explains the margin calibration (0.95)

### Predictions
- **Engine 3.5.0: margin calibration.** Replayed, the real margin came out about 0.95 of the predicted one, so both predicted scores now move toward their middle until the margin is 0.95 of the rating gap. The total is the same and each 80% range keeps its width, recentred. Margin error falls by about 0.1 point in both seasons tested (2024–25 −0.107 [−0.147, −0.064], 2025–26 −0.095 [−0.124, −0.066]), alliance score error a little too, and ranges hold as many real scores as before. Win chances, tie chances, bonus RP odds, event simulations and the factor sheet are bit-identical to 3.4.0 on every replayed match (docs/engine/gates/gate-3.5.0-margin-scale-snapshot-2026-10-14.md). (#534)
- **Lab.** Under the ratings table, each alliance's sum is labelled "before calibration" and a second pair of lines writes the calibration out ("113.4 + 0.95 × 7.4 = 120.4 · shown 120"). The factors note says they split the rating gap, and that the margin is 0.95 of it.
- **How it works.** The match section has one sentence on the calibration and its value, the factors section says the phases split the rating gap, and the settings table lists "Margin calibration (3.5) × 0.95".

## 2.9.6 — 2026-11-04

FTC One Search answers read more cleanly: names, rates, captions and headings follow one set of wording rules.

### Highlights
- [fixes] "Hypnotic Robotics'" for a name ending in s, in every answer
- [fixes] Rates say "per match", and every chart has one plain caption
- [fixes] One 1st-place spelling, and no "Worlds finals finals" pill
- [teams] Fact titles read "Where Hypnotic Robotics (4215) is from"
- [fixes] A card's heading no longer repeats the page heading

### Search
- **Wording fixes from the v2.8.9 search display audit.** One possessive rule everywhere ("Hypnotic Robotics'", "Bad Wolf's"). Rates read "per match" as Compare has them ("8.4 per match", "points per match"). Charts end with one sentence ("Ranges from 52.4 to 101.6 across 5 values."). "1st-place" is the adjective ("1st-place finishes", "1st-place Inspire") and "1st place" the noun; the Worlds events pill no longer says "Worlds finals finals". A team fact's page title is sentence case with the team named once, in bold ("Where **Hypnotic Robotics (4215)** is from", "Sponsors and school for …"), never "Team 4215 — Where They're From". The head-to-head card is headed "Their meetings and partnerships" and a winning-alliance card "The champions and each division's winners", under page headings that name the teams and event. "This season" before the season in progress has a match now heads the page with the season it answers ("Average score in 2025–26"), the reason in the note. No number changes. (#525)

## 2.9.5 — 2026-11-04

FTC One Search answers "4215 record" and "4215 awards" with full cards, and a team's sponsors, school and hometown read as one team card.

### Highlights
- [teams] "4215 record" shows the season's record, win rate and rank
- [teams] "4215 awards" lists every award, grouped by season
- [teams] Sponsors, school and hometown answers read as one team card
- [fixes] An Inspire Award is never listed as a 1st place

### Search
- **"4215 record" answers.** A plain record question gave no answer card, only the team and a Team records link. It now reads the team's latest season with matches: the W-L-T, the win-loss bar, the win rate, the season and the team's world rank by win rate (its place on the season's "top teams by win rate" list: wins over matches played, teams with 3 or more matches, shown when that list holds the same record). The numbers are the team page's: 4215 is 26-6-0 in 2025–26.
- **"4215 awards" and "awards 4215 has won" answer.** Both gave only the team. They now list every award with its event and date, a table per season, newest first. 1st place (Winning Alliance) and the Inspire Award stay two separate awards; 2nd and 3rd place Inspire are labelled as such.
- **Listing facts as one team card.** "4215 sponsors", "4215 sponsors and school" and "where is 4215 from" were a thin box of links. They're now one card under the team's name: every sponsor its own bold row, the school and the hometown a bold value with its name small under it, then related questions. Values are shown exactly as FIRST's listing stores them; some school names are already cut short there (4215's is stored as "River Dell Regional High Sch"), and they're never cut further. (#522)

## 2.9.4 — 2026-11-04

How it works shows what the November engine research tried, and why none of it changed a prediction.

### Highlights
- [predict] Eight new lab notes: every idea tested on the engine in November
- [predict] Each with its numbers against the current engine, on the same matches
- [predict] Links to the full research note behind every card

### Predictions
- **November research in the lab notes.** How it works › Lab notes adds eight cards: three other rating systems (Massey, TrueSkill, Glicko-2), margin-of-victory Elo, a stronger pull toward the average for new robots, forgetting old matches faster or slower, reweighting the match phases, a separate playoff model, how much calibration can still gain, and a neural network. Each says in a line what was tried and why it didn't ship, and its Details give the Brier change on both seasons with the 95% range, next to a link to the full note in docs/engine/research-2026-11. Predictions are unchanged. (#535)

## 2.9.3 — 2026-11-03

Searches that used to give a confident wrong answer now give the right one, or say plainly what search can't do.

### Highlights
- [teams] "How many teams 2023" counts that season's teams
- [teams] "Compare 4215 6980 16461" compares all three teams
- [teams] "Top OPR last season" lists last season's leaders
- [fixes] "How is OPR calculated" explains OPR, not a team
- [fixes] "Teams near me" asks for a place, never reads "me" as Maine

### Search
- **Wrong answers fixed.** A 92-query check against the real data found searches that answered with the wrong thing, usually a team whose name shared a word. Each now answers what was asked (#513):
  - A count of a named season ("how many teams 2023", "… in 2024-25", "… last season") is that season's count, not teams named "Spark team".
  - "How is OPR calculated" is the OPR explanation, not the team CALculated Risk.
  - "Teams near me" and "events near me" say where you are isn't known and suggest adding a place, instead of reading "me" as Maine or listing names with "event" in them.
  - "Lowest OPR in New Jersey" and "worst teams" say search lists teams from the top, and link the full ranking.
  - An event's best score without "at" ("highest score new jersey championship", "nj states highest score") is that event's. "NJ states" is New Jersey's championship, never a workshop with NJ in its name, and "worlds" is the FIRST Championship, never a Pre Worlds scrimmage.
  - Three or four teams compared ("compare 4215 6980 16461", "compare 4215, 6980 and 16461") open Compare with every team, none dropped.
  - A leaderboard with a season ("top opr last season", "best auto opr in texas 2024-25") is that season's, never the team Top Shelf BGS.
  - A rookie list without "in" ("rookie teams new jersey", "nj rookie teams") is the place's rookie list.
  - An event named with a game ("nj states decode", "worlds edison division centerstage", "nj states highest score decode") is that game's season, where it said "No matches found".
  - A count of events in a bare year ("how many events in 2026") is the events held that calendar year, from either season; a season written as one ("2025-26") is that season.
  - "Lowest OPR in NJ" links the Teams table sorted by that stat, lowest first.

## 2.9.2 — 2026-11-03

How FTC One Search works says plainly what the search does, for people and
for search engines.

### Highlights
- [home] FTC One Search page opens with what you can search and how
- [home] 20 example searches, each checked on the live site
- [home] "How FTC One Search works" link on Home and on search results

### Search
- **A clearer FTC One Search page.** /how-it-works/search now opens with what FTC One Search is, then five plain sections: what you can search, how to use it, example searches, what makes it unique and where to go next. The step-by-step walkthrough follows as before. The title, headings and opening paragraphs are in the page's first response, so search engines read them without running the app (#531).
- **Example searches you can trust.** Every example on the page was run on the live site before it was listed, with the kind of answer it returns: a team, a match, a comparison, OPR and its phase splits, average score, prediction rating, advancement odds, records, counts, leaderboards and more.
- **Answers that don't drift.** A question with a misspelt team name always answers about the same team. Before, the team it picked could follow what other people had clicked; now clicks only reorder the list of results, never the team an answer is about.
- **Found from more places.** Home's footer and the bottom of every search results page link to How FTC One Search works.

## 2.9.1 — 2026-11-03

Event searches count one way everywhere, open on the time asked for, and
show venues in full.

### Highlights
- [fixes] Place link names both counts: "24 meets · 42 events"
- [fixes] "upcoming meets in New Jersey" opens on the Upcoming tab
- [fixes] Venue names in full, no trailing comma or cut-off

### Search
- **One count for an event search.** The place link ("All events in New Jersey") said "42 this season" while the events heading and the All tab said 24. It now names both and what each is: the set asked for, counted exactly as the list and the tabs count it, then every event in the place this season ("24 meets · 42 events this season"; "22 upcoming meets · …" for the upcoming query). When there are more than the page lists, it says so: "24 of 26 meets listed · 42 events this season". A bare "New Jersey" says "42 events this season", counted the same way (volunteer sign-ups left out, as every event list leaves them out). Which events match is unchanged.
- **The time tab follows the query.** "upcoming meets in New Jersey" opens on Upcoming, highlighted; "past meets …" on Past. Picking another tab writes it to the address (`when=all`), so a reload or a shared link opens where you left it, and Clear filters goes back to the query's own tab. A fallback that dropped the time asked for ("no past meets there, showing the upcoming ones") opens on All, so its events show.
- **Venues in full.** FIRST stores some venues with a trailing comma ("Columbia High School,", "P.A.L. of Atlantic County & EHT,"); the event card now ends the name at it, and a long venue wraps onto a second line instead of being cut with an ellipsis. (#521)

## 2.9.0 — 2026-11-03

An event's Rankings tab has the Swing column now, in the full stats table.

### Highlights
- [rankings] Swing in the event Rankings table, with its formula alongside
- [rankings] Swing can be added to the team and season record tables
- [fixes] Fewer than 5 counted matches leaves the Swing cell empty

### Rankings
- **Swing in every rankings table.** The event Rankings tab's full table (the one the stats cycle builds) had no Swing column; only its fallback did. Swing is now a stat of the records tables, shown by default on event rankings and pickable for team-event and team-season records, with the same "±0.42" display, lower-is-better sorting and a one-line formula in the notes above the table. Below 5 counted matches the cell is empty, as elsewhere. (#506)

## 2.8.9 — 2026-11-03

FTC One Search understands "and", "or" and "not" between teams, and quotes around an exact name: "4215 and 6980" lists the matches both teams played in.

### Highlights
- [teams] "4215 and 6980" lists every match the two teams shared
- [teams] "4215 or 6980" and "4215 not 6980" filter the match list
- [teams] "4215 and 6980 opr" shows both teams' OPR side by side
- [teams] Quotes find an exact name: "Raider Robotics"

### Search
- **Boolean operators.** `and` (or `&`), `or` (or `|`) and `not` (or `-` before a term) between teams, read like a web search: NOT first, then AND, then OR, no parentheses. What's asked still decides the answer: on its own or with "matches" it's the match list (both teams on the field, on either alliance, newest first, how many as partners and as opponents); with a stat it's the stat side by side (`4215 and 6980 opr`; any other stat, such as `4215 and 6980 record`, in the team table with each team's season OPR, phases, penalties and record). Two teams with no match in common are told so, with each team's own match count and a link to the "or" list. A team name with "and" or "not" in it ("Nuts and Bolts", "Batteries Not Included") stays a name, and `vs`, "compare" and "have … played each other" keep their own answers. Details in docs/search-boolean.md. (#497)
- **Exact phrases.** A name in double quotes finds the teams named exactly that first, then names holding the words together, never names with the words apart.

## 2.8.8 — 2026-11-03

Every event opens now, whatever its code looks like, and the policy, help and record pages arrive with their words in place.

### Highlights
- [fixes] Every event opens, whatever its code looks like
- [fixes] An event code in any case opens the same page
- [speed] Privacy, terms, rules and contact pages arrive in full
- [speed] Team and match records arrive with their top rows

### Events
- **Every event opens.** Older seasons' events whose codes FIRST wrote in mixed case or with punctuation, spaces or Cyrillic letters (2019INMeet10, NL'HKO, laredomeet 2, 63693260770.2649, about 260 of them, mostly 2019–20) were "Event not found". They open now, from any link, at any spelling of the code, and each has one address with the code in capitals, its light version too. (#491)

### Pages
- **Words before the app.** Privacy, terms, contact, donate and the rules quick reference arrive with their whole text, and the team and match record tables with the first 100 rows they open on, before the app has loaded. Search engines read them as visitors do, and the sitemap lists them again (the rules reference only while it is switched on).

## 2.8.7 — 2026-11-03

Swing, Control Scout's consistency stat, has its own column wherever teams are compared: how far a robot's estimated points move from match to match. The formula sits next to it, and Control Point shows the same number for the same matches.

### Highlights
- [rankings] A Swing column in event and world rankings: lower is steadier
- [teams] Compare has a Swing row, best (steadiest) marked
- [report] A one-line formula under each table, the full one on How it works
- [fixes] Fewer than 5 counted matches shows "—" and says why

### Teams
- **Swing (consistency).** sd of (alliance non-penalty score − the partner's event OPR) ÷ the event's average robot share, over qualification matches, pulled toward the season's field as if 10 more matches. It's the same number as the reliability index's swing part, now computed by the prediction engine (3.4.0) so both apps use one function (#499). Event rankings show the team's swing at that event, the world ranking and Compare its season swing. Below 5 counted matches the cell reads "—", and its tooltip gives the reason.
- **How it works.** A new "Swing" section works the formula step by step, so it can be checked by hand.
- **Engine 3.4.0.** Predictions are unchanged: the replay of every predicted match since 2023–24 serves exactly what 3.3.0 did.

## 2.8.6 — 2026-11-03

A team's name with a place ("robo rebels nj") now finds the teams by that name, and says so plainly when none is there.

### Highlights
- [teams] "Robo rebels nj" lists every Robo Rebels when none is in NJ
- [teams] A name and a state find that state's team by that name
- [fixes] No more "No matches found" for a real team name and a place

### Search
- **A name and a place.** A team's whole name followed by a place ("robo rebels nj", "bad wolf new jersey") lists the teams by that name in that place, or, when none is there, says "No team named Robo Rebels in New Jersey" and lists every team by the name. Every team sharing the name is checked against its stored state and country, accents and case folded as search reads names, never a capped list. (#504)

## 2.8.5 — 2026-11-03

Predictions show more of their working. The track record adds margin error, every prediction says in one line what it learns from and what changes in playoffs, and a few numbers now come with the sum behind them. No prediction changed.

### Highlights
- [report] Track record shows margin error next to accuracy and Brier
- [predict] Each prediction says what it learns from, and what playoffs change
- [predict] The Lab writes each predicted score out from the robots' ratings
- [predict] Best-of-3 series show the one-game chance behind them

### Predictions
- **Margin error.** The track record's ledger now shows how many points the predicted margin (red's predicted score minus blue's) missed by on average, against always guessing a tie, with qualifiers and playoffs apart. Live calls and the season replay stay separate, as always. (#488)
- **Quals and playoffs, stated.** The match drawer, Know your match, the Lab, the factor sheet, projections, advancement odds, simulated rankings and the bracket each carry one short line: ratings learn from every played match, a playoff result counts half, and in playoffs partners add up in full, ranges are tighter and there are no bonus RPs. A new "Quals and playoffs" section on How it works has the details.
- **Numbers you can check.** The match drawer and the Lab show the predicted margin ("Red by 12 (118 − 106)"). The Lab's ratings table adds each robot's penalties and writes each predicted score out: robots' ratings, minus the overlap cut, plus the other side's penalties. A best-of-3 series shows the one-game chance it comes from.

## 2.8.4 — 2026-11-03

Scout has a pick helper. Choose your team at an event and it suggests the partners that fill your alliance's gaps, each on a radar of auto, TeleOp, endgame and fouls over your own, with what it adds.

### Highlights
- [scout] Pick helper: partners that fill your alliance's gaps
- [scout] A radar per partner over yours, with the share it covers
- [scout] Each card says what it raises and what it costs
- [scout] Open it from Scout or an event's Playoffs tab

### Scout
- **Pick helper.** A new Scout section (Scout → Pick helper, no account needed). Pick your team at an event, or your alliance if it's posted; the top 5 free partners are the ones whose alliance covers the most of a four-axis radar (Auto, TeleOp, Endgame, Few fouls), so a team strong where you're weak can beat a higher-rated one. Add a partner to plan a 3-team alliance's second pick, mark teams taken as alliance selection goes, and "Show the numbers" lists every rating used. Each axis is the alliance's total ÷ the best 2 (or 3) teams at the event added up; area is ½·sin(2π/4)·Σ rᵢ·rᵢ₊₁ (full method on How it works). It reads the engine ratings the stats runs already store; nothing is rated on request.
- **Event page.** The Playoffs tab links to the pick helper for that event. (#492)

## 2.8.3 — 2026-11-03

A search that lists teams answers as one table: rank, team, OPR and its phases, penalties and record, with bars to compare at a glance.

### Highlights
- [teams] Team lists in search are one sortable table, OPR first
- [teams] Bars for OPR and each phase, top three marked
- [teams] On a phone, tap a row for its Auto, TeleOp, Endgame and Pen

### Search
- **List answers as a table.** "teams in california", "best teams in new jersey", a country's best, undefeated teams, win rate, most improved, best rookies and the stat leaderboards share one table: rank, team, OPR, Auto, DC (TeleOp from 2024–25, when it includes the endgame), Endgame, Pen and W-L-T. It opens best OPR first, and the OPR, phase and record headers re-sort it. Each row has a bar for its OPR and a bar for its phases (scaled to the largest phase total, since phases don't add up to the OPR); a phase below zero is labelled, not drawn. On a phone, rank, team, OPR and record stay in view and the phases open under the row. Every number is the team's stored season stats, the same ones its page shows; the page's first paint carries the table as plain HTML. (#498)

## 2.8.2 — 2026-11-03

Two searches the failed-search log caught now answer: when a team last played, and several of a team's listing facts at once.

### Highlights
- [teams] "When did hypnotic last play" opens their most recent match
- [teams] "4215 sponsors school" answers both, each on its own line
- [fixes] Headings keep "and" and "or" lower case

### Search
- **Fixes from the failed-search log.** "when did X last play" (or "play last", "last compete") reads as the team's most recent match. Several listing facts at once ("4215 sponsors school", "4215 rookie year, website") are each answered on their own line, in the order asked, with a team's whole name tried before any fact word is read off it. "last" is no longer called a word left out of a most-recent-match answer, and headings keep joining words small ("Sponsors and School or Organization"). (#496)

## 2.8.1 — 2026-11-03

Failed searches are filed the way search itself read them: search's own verdict decides whether a query failed and how, and one failing question lands on one issue however it was phrased.

### Highlights
- [report] A failed search is filed as search itself judged it
- [report] One failing question, one issue, however it was typed
- [fixes] An issue's Reproduce link opens the search exactly as typed

### Search
- **Failed-search reports follow search's own reading.** Search's layered reader now decides whether a query failed: an answer is never filed, a question two ways at once is filed as ambiguous with both readings named, and a team page shown for a question nobody asked of it ("4215 zzz") is an answer, not a failure. Issues aggregate under search's own key of the redacted query, so "4215 OPR rn?" and "4215 opr right now" are one issue. The Reproduce link in an issue now opens the latest query as typed rather than its shortened key, which could answer. Details in docs/failed-search-reporting.md. (#495)

## 2.8.0 — 2026-11-03

How a team's rating is read from alliance scores is now stated where the rating is shown, and "Before the event" odds load faster.

### Highlights
- [predict] Ratings say what they assume: random qualification partners
- [predict] Playoff matches count half, because playoff partners are fixed
- [speed] "Before the event" odds for a second team at an event load faster

### Predictions
- **What a rating assumes.** FTC only records alliance scores. The engine splits each alliance's miss equally between its robots, which separates a team from its partners only because qualification partners are drawn at random. Playoff alliances are fixed, so a playoff match moves a rating half as much. The How it works page (new "What this assumes" part), team pages and the world rankings now say so in one line. The numbers don't change. (#486)
- **Faster "Before the event" views.** The ratings as they stood the day before an event are now worked out once per day for the current data, and shared by every team's odds and partner scenarios at that event and by every event starting that day. Before, each team's view replayed the season again. Same numbers.

### Engine research notes
- New notes in `docs/engine/research-2026-11/`: the DECODE score sheet mapped onto the engine's categories (no defense category, because no recorded data supports one), how per-team ratings come from alliance scores, and a check of every prediction endpoint for ratings computed inside a request.
## 2.7.9 — 2026-11-03

FTC One Search reads a question by its words when its phrasing doesn't match: any word order, extra words like "rn" or "please", and long conversational questions all get the same answer as the short form, with a line saying how it was read.

### Highlights
- [teams] "4215 from where" and "4215 where from" show where they're from
- [teams] "4215 opr rn" gets the OPR card; filler words never change it
- [teams] Long questions get the short form's answer, read back to you
- [rankings] "highest opr california" works without "in", as with it

### Search
- **Word order, filler and long questions.** A question the readers miss is read again as a set of words: the team (number or name), what's asked, and any season, place or event, in any order. Filler ("rn", "please", "right now") and question words around them are left out, never inside a team's own name. "What was the OPR of this team called Hypnotic Robotics in the DECODE year" now answers as "4215 opr decode". The answer says how it was read ("read as …, leaving out …"). Two things that fit equally are named, never guessed, and a word like "not" or "today" is never silently dropped. A definition beats a team name ("what does opr mean"), and a leaderboard asked with a place but no "in" ("highest opr california", "opr leaders texas") is the leaderboard, not a guess at a team. Details in docs/search-layers.md. (#479)

## 2.7.8 — 2026-11-03

Search engines now get only the team and event pages that have something on them, and every address in the sitemap opens a real page.

### Highlights
- [fixes] Empty team and event pages wait for data before being indexed
- [fixes] Every address in the sitemap opens a real page
- [speed] Event list and world rankings arrive with their lists

### Search engines
- **Empty pages wait.** A team that has never played, won an award or entered an event of this season, and an event with no teams and no matches, still opens as usual but asks search engines not to index it, and leaves the sitemap. The day its first data arrives, it's indexed and listed again on its own. (#480)
- **Every sitemap address opens.** Older events whose codes the site can't open (mixed case or punctuation, mostly 2019–20) are no longer listed. Pages the app draws from a heading alone (the team and match tables, Predict, Download, Rules, Privacy, Terms, Contact, Donate) stay findable from their links but aren't offered in the sitemap.
- **Lists in the first HTML.** The event list shows this season's latest events, and the world rankings their teams, before the app has loaded.

### Teams
- **Opens on a season with results.** A team listed on this season's league roster for a meet it never played opened on an empty 2026–27, even with years of results. It now opens on its latest season with results, as other teams do; the season switcher still has 2026–27.

## 2.7.7 — 2026-11-03

Searches that find no answer are now logged, so they can be fixed. Each one becomes a GitHub issue on the public repository: the query (with emails, phone numbers and keys taken out) and how search read it, nothing about who searched. Search itself works exactly as before.

### Highlights
- [report] Searches that find no answer are logged, so they can be fixed
- [report] Only the words searched are kept; never who searched
- [speed] Logging happens after your answer, so search stays as fast
- [report] Emails, phone numbers and keys are removed before logging

### Search
- **Failed searches logged.** A search with no match, or one that lands on a team page without answering what was asked ("4215 opr rn"), is counted and filed as a GitHub issue labelled failed-search, one issue per query however often it fails. The issue holds the query, how it was read and a link to try it again. It's a list to work through: nothing fixes or closes an issue automatically, and a query that fails again after its fix reopens the same issue. (#478)
- **Privacy.** The repository is public, so an issue holds the query text and the outcome only. No IP address, account or device is kept, and emails, phone numbers and keys in a query are replaced before anything is stored.
- **No slower.** Search answers first. The logging is in-memory bookkeeping (about 24 µs a search), written out in batches every minute and sent to GitHub every 10 minutes at most. If GitHub is down, search carries on and the counts catch up later.
- **Error reports.** In-app error reports point at the repository's new home (ZOGWORK/control-scout), which GitHub's issue search needs to find a report's existing issue.

## 2.7.6 — 2026-11-03

A search about one team's fact names the team once in its heading, and a word after an apostrophe stays lower case.

### Highlights
- [teams] "Where is 6980 from" names the team once in its heading
- [teams] "Where They're From", not "Where They'Re From"
- [teams] The line under it no longer repeats the heading

### Search
- **Headings.** A team fact ("where is 6980 from", "4215 school") is titled "Team 6980 — Where They're From": the team once, no capital after an apostrophe, and the line under it left out when it only repeats the heading, in the first paint as in the app. "Average winning margin" is titled as asked, not as the plain average margin. (#477)

## 2.7.5 — 2026-11-03

Bruno's card on a search shows up only once he has answered, so it never appears and then vanishes.

### Highlights
- [teams] Bruno's card shows only once his answer is ready
- [teams] No card at all when he has nothing to add
- [teams] A question with a summary keeps it while he writes

### Search
- **Bruno's answer.** The card no longer opens while Bruno is still writing and then disappears when he has nothing to add or his answer is withdrawn: it appears once, with his finished answer, and never otherwise. A question with a summary shows the plain summary while he writes, then his card around it. (#476)

## 2.7.4 — 2026-11-03

FTC One Search answers more of the questions people actually ask about one team, and reads a few it used to get wrong.

### Highlights
- [teams] Average margin and total points per team, each season apart
- [teams] "Have 4215 and 6980 played?" opens their head to head
- [teams] Penalties, partners, best match and world rank all answer
- [teams] "This season" says so when the season has no matches yet

### Search
- **New answers.** Average margin (or winning or losing margin, over wins or losses only) and total points, with the latest season up front and every season listed apart, never pooled. (#475)
- **Read right.** Head-to-head questions ("has 4215 played 6980", "did 4215 ever face 6980") open the Compare, not another team; "at nj states", penalties, no-shows, best and worst match, best event, partners, opponents, events this season, world rank, region rank, next-match odds and awards at an event each get the answer they ask for, with a note when it is read a certain way.
- **Smaller fixes.** Motivate and Dean's List count as awards; "past events in michigan" lists events, not a team named for pasta; "nj states matches" opens the Matches tab; a "this season" answer with no matches yet in the season in progress says it fell back to the latest season.

## 2.7.3 — 2026-11-03

Home's search box speaks for itself: the label and heading above it are gone, so the field and its examples lead.

### Highlights
- [home] Home's search box stands on its own, no heading above it
- [home] The field keeps its label and its rotating examples
- [home] The first paint matches, so nothing jumps as the page loads

### Home
- **Search box.** The "FTC One Search" tag, the "Type whatever you want" heading and the line under it are gone from Home's search block; the field's own label and placeholder say what it does, and the example chips stay. The page's first paint draws it the same way. (#474)

## 2.7.2 — 2026-11-03

FTC One Search has its own page explaining what you can search for and how each query is answered. In the menu, How it works now opens to its two pages: Predictions and FTC One Search.

### Highlights
- [home] A new page on FTC One Search: what to type and how it's read
- [home] Six steps, 16 kinds of answers, each one a real query to try
- [home] How it works in the menu opens to Predictions and FTC One Search
- [home] What search can't do yet, stated plainly

### How it works
- **FTC One Search.** /how-it-works/search explains the six steps every query goes through, in order; how places, times, kinds of events, comparisons and names are read; the kinds of answers, each a query you can run; how the results page is laid out; what happens when nothing matches; that no AI decides what you meant (the Bruno AI summary is a separate extra); and its limits. (#473)
- **In the menu.** How it works opens to its two pages, Predictions and FTC One Search, and stays open on either. The prediction page is unchanged, at /methodology.

## 2.7.1 — 2026-11-03

FTC One Search answers a team's numbers one by one: OPR and each phase with the world rank, the prediction rating, the engine's report card, its events in a season or a state, its OPR against an average, reliability, schedule difficulty and league standing.

### Highlights
- [teams] "4215 OPR": the season OPR, each phase and the world rank
- [teams] "4215 prediction rating" with its spread, phases and world rank
- [teams] "4215 OPR vs New Jersey average", the world's or an event's
- [teams] Reliability, schedule difficulty and league standing in one search

### Search
- **OPR and its phases.** "4215 OPR", "4215 auto OPR", "4215 teleop OPR", "4215 endgame OPR": the season number with the team's world rank and share, every phase beside it, and for OPR a line over the season's events. Each phase is its own best that season, so the phases don't add up to the OPR. (#471)
- **The engine on a team.** "4215 prediction rating" (its ± spread, phases, penalty points given away and matches rated, ranked as on Rankings), "4215 prediction report card" (the live calls on its matches, right and wrong, by event) and "4215 predicted score next match" (the logged prediction once a schedule is posted).
- **Events.** "4215 events in 2025-26" lists that season's events with rank, record and OPR; "4215 events in New Jersey" lists every event in that state, each season apart.
- **Against an average.** "4215 OPR vs world average", "4215 OPR vs New Jersey average", "4215 OPR vs New Jersey Championship average": the team's OPR against the average of that season's teams there (or its division's field at an event), with its place among them. Never across seasons.
- **Reliability, schedule, league.** "4215 reliability", "4215 schedule difficulty" and "4215 league rank" read what the team page shows.

## 2.7.0 — 2026-11-03

FTC One Search lists a season's highest-scoring matches: the top alliance scores and the top combined scores, worldwide, in a state or at one event, with every team, the event, the date and a link to each match.

### Highlights
- [history] "Highest scoring games in decode": the season's top 10 scores
- [history] Top combined scores, both alliances added together
- [history] In a state or at one event: "highest scoring matches in NJ"
- [history] "Highest scoring match ever": each season's best, one row a season

### Search
- **A season's top scores.** "Highest scoring games in decode", "top scores this season", "highest combined scores", "highest scoring matches in MA", "highest scoring matches at the New Jersey Championship": the season's 10 highest alliance scores as bars, then each match with both alliances' teams, the event, the date and a link, and the 10 highest combined scores. A score is the alliance's own points without penalties, as the season records count them (in 2020–21 and 2021–22, before its own penalties). Official events only. An event's divisions count with it. (#468)
- **Ever.** "Highest scoring match ever" lists each season's best apart, since each season is a different game: never one all-time record. A state or an event named stays that state or event in every season.
- The search box keeps its own high-score card; the full lists are on the search page.

## 2.6.9 — 2026-11-03

FTC One Search names a season's champions: "who won worlds", "decode winner", "who won nj states", each with the finals, every division's winners, the Inspire Award and other seasons one tap away.

### Highlights
- [history] "Who won worlds": the winning alliance with its finals
- [history] "Who won nj states": each division's winners and the Inspire Award
- [history] "This year" or "last year" picks the season; others are a tap away
- [history] A championship not played yet says so and shows the latest one

### Search
- **Who won.** "Who won worlds", "decode winner", "into the deep champions", "who won worlds last year": the season's FIRST Championship winning alliance, with the final matches and each division's winners. A game's name picks its season, "this year" is the current season and "last year" or no season is the latest championship that has finished. A championship not played yet says so, with the latest finished one below. (#467)
- **A place's championship.** "Who won nj states": that state's championship, each division apart, with its Inspire Award and links to the same answer for other seasons. A year on its own is when the event was held ("who won 2025 nj states" is 2024–25).
- **Winning alliance.** The alliance that won the event's final match, with its whole roster from alliance selection; with no final stored, the event's published Winning Alliance award. A Leadership Award is never counted as a winner.

## 2.6.8 — 2026-11-03

FTC One Search answers how a team changed: OPR, win rate, alliance score, penalties and ranking points event by event, and its standing and record season by season.

### Highlights
- [history] "4215 OPR history": OPR at each event this season, rising or falling
- [history] "4215 OPR by season": the team's worldwide standing each season
- [history] Win rate, penalties and ranking points by event
- [history] "4215 record by season": wins, losses and ties each season

### Search
- **Event by event.** "4215 OPR history", "4215 win rate", "4215 average penalties", "4215 average alliance score by event", "4215 ranking points": a line over the team's events in one season (the one named, else its latest), with the values and whether it is rising, falling or steady against the event before. Lower penalties count as better. Links switch to other seasons, since every season is a different game.
- **Season by season.** "4215 OPR by season" shows the team's OPR rank each season and the share of ranked teams it was ahead of, never the OPR in points across seasons. "4215 record by season" shows wins, losses and ties each season with the win rate as a line.
- **Penalty totals.** "4215 total penalties in 2025-26": the penalty points the team's alliances gave away that season, in all and per match, by event. (#462)

## 2.6.7 — 2026-11-03

FTC One Search's venue lines keep the spelling you typed.

### Highlights
- [fixes] "Meets at Riverdale High School" keeps the name you typed
- [fixes] A venue line never swaps in a similar school's spelling
- [history] Typo spellings still find the venue's meets, as before

### Search
- **Venue lines keep your spelling.** A venue's line takes its name from the venues found as typed. "Meets at riverdale high school" reads "Meets at Riverdale High School", no longer "River Dell High School" (New Jersey's more common spelling). A typo with nothing found as typed ("river dell hs") still reads the venue's own spelling. (#470)

## 2.6.6 — 2026-11-03

Typing "help" into FTC One Search shows what it can answer, with a query to try for each.

### Highlights
- [fixes] "Help" shows what FTC One Search answers, never "no exact match"
- [fixes] Each kind of question has a query to try, one tap away
- [fixes] A team named "Helpers" is still found by its name

### Search
- **Help.** "Help", "how do I search", "what can I search for" and "examples" answer with what the box reads: a team, two teams, events by place and time, leaders and records, who won, and what a word means. Each comes with an example query that opens its answer. Before, "help" said there was no exact match and listed teams with "Hel" in their names. (#469)

## 2.6.5 — 2026-11-03

FTC One Search keeps a venue's meets to that venue, and "who won" leaves the Leadership Award out.

### Highlights
- [fixes] "Meets at River Dell" no longer lists Riverdale High School, IL
- [fixes] "Who won" lists the winning alliance, never Leadership winners
- [history] Misspelt venues still count, in the venue's own state

### Search
- **A venue stays in its own state.** A spelling a letter or two off now counts only in a state where the venue is found as typed. New Jersey's "River Dale High School" is still River Dell's meet, and Riverdale High School in Port Byron, Illinois, is no longer listed.
- **Who won.** FIRST stores the Leadership Award at the 2025–26 Championship as a "Winner" row. "Who won" now leaves it out, so the card lists only the winning alliance and the Inspire Award. (#466)

## 2.6.4 — 2026-11-03

FTC One Search compares a team's championship trips by division rank, and its filters never leave you at a dead end.

### Highlights
- [teams] A team's Worlds or state trips chart division rank, best on top
- [teams] The trip stats show the win rate there instead of a peak OPR
- [teams] On a phone, each season's chip shows its rank, never an OPR
- [fixes] Search filters show counts, and an empty one offers the other tab

### Search
- **Rank, not OPR, across seasons.** Each season is a different game with its own scoring, so an OPR from 2021–22 can't be set against one from 2025–26. The chart over a team's Worlds or state trips now plots its division rank each season, #1 at the top; each point still names its division, rank, record and OPR, and selecting it still jumps to that season's card. The stats above it drop "Peak OPR" for the win rate across those trips ("Win rate at Worlds 67.3%, 33–16–0 in quals"), counted from the same records, beside the best division rank. On a phone each season's chip leads with its rank (its division when it has none).
- **Filters that say what they hold.** The time tabs show how many events each holds ("All 5 · Upcoming 2 · Past 3"), so an empty one is plain before you pick it. A filter that leaves nothing says what's empty ("No past events in these results.") and offers each choice that isn't, one tap away ("Show 2 upcoming", "Show 3 in every season"), beside Clear filters. The season menu still shows whenever the results span seasons. Results and their order are unchanged. (#459)

## 2.6.3 — 2026-11-03

FTC One Search answers far more ways of asking: comparisons, winners, team facts, counts, months, glossary words and new leaderboards, where many used to end on "no results".

### Highlights
- [history] "Who won worlds last year" and "decode champions" name the winners
- [rankings] New lists: highest win rate, most improved, undefeated, rookies
- [teams] "4215 school" and "4215 rookie year" answer from the team's record
- [fixes] "Compare 4215 and 6980", "is 4215 good" and more phrasings work

### Search
- **Said another way.** Phrasings the readers missed are said the way they read them: "compare A and B", "is A better than B", "which is better A or B", "who would win A or B" and "4215, 6980" compare the two teams; "is 4215 good" is "how good is 4215"; "predict 4215 next games" is its next match; "4215 worlds" and "bad wolf states" are its Worlds and states history; "4215 inspire" and "has 4215 won an event" are its awards; "4215 losses" is its record; "4215 decode" is its DECODE season. Scope words that add nothing ("in the world", "in FTC", "right now") are dropped. "Teams near Oradell" reads as "in Oradell", and the line says so, since no distances are on record.
- **Who won.** "Who won worlds", "worlds winners", "who won worlds last year", "decode champions" (that season's FIRST Championship), "franklin division winners", "nj states winners" and "inspire award winners nj" name the winning alliance and the Inspire Award from the event's results. Worlds answers its finals, never a division's.
- **New leaderboards.** The highest win rate (a tie counts half), the most improved (the biggest rise in OPR standing from one season to the next, never raw OPR across seasons), undefeated teams, the best rookies, rookie, oldest and newest teams, a country's best teams, a place's average OPR, a place's top scores, and a place's teams at Worlds. Each takes a place: "most improved in Texas".
- **Team facts.** A team's school, home town, rookie year, website and sponsors, from its own record.
- **Counts, months and Worlds.** "How many teams in Canada", "how many league meets this season", "events in January", "events today" and "tomorrow", "worlds this year", "worlds 2026" and "state championships" each get their own answer.
- **An event's tab or match.** "NJ states rankings", "worlds playoffs" and "match 12 at nj states" open that tab or match; at an event with divisions, a match number shows each division's.
- **What a word means.** OPR, the rating, reliability, ranking points, advancement, prediction accuracy, alliances, league meets, qualifiers, the Inspire Award, FTC itself and each season's game (DECODE, INTO THE DEEP …) are explained, with the page that explains more. "FTC rules" and "game manual" open Rules.
- **Never a dead end.** A query with a team number in it that nothing else reads opens that team, saying what wasn't answered. A team named with "robotics", "team" or a state after it finds the team. Out of 332 test queries, only unknown team numbers and gibberish still end on "no results". (#465)

## 2.6.2 — 2026-11-03

FTC One Search answers ranked lists as a chart: the top teams in the world or any state by rating, OPR, auto, TeleOp, endgame or win rate, the best rookie teams, the most improved teams, and every team in a city.

### Highlights
- [rankings] "Top teams in the world": the top 10, each with a bar against the leader
- [rankings] OPR lists name each team's best auto, TeleOp and endgame under its bar
- [rankings] "Top 10 teams by OPR in NJ" links to the same list on the Teams page
- [rankings] Best rookie teams and most improved teams in any state
- [teams] "Teams in Oradell" lists every team from that city

### Search
- **Ranked lists as a chart.** "Top teams in the world", "best auto team", "top 10 teams by OPR in NJ", "top 5 win rate teams in Texas": the top 10 by default (up to 25 when asked), ranked by one season number (prediction rating as on Rankings, OPR, auto, TeleOp or endgame OPR, win rate, wins or average score), in one state or province or worldwide. On a computer each team is a row (rank, team, location, W-L-T, OPR and the number asked for, highlighted) with a bar scaled to the #1 team. On an OPR list each team's best auto, TeleOp and endgame that season are named under its bar. On a phone each team is a compact row with its bar under the name. A note says the season, how many teams are ranked and by what (for example "2025–26 · 193 ranked teams in New Jersey · by OPR"). "View more detail" opens the list on the Teams page (OPR lists, which count qualification matches only) or Rankings (rating lists). A team is ranked once it has played 3 matches that season, as on Rankings. The search box links to the full answer.
- **Rookies and the most improved.** "Best rookie team in New Jersey" ranks teams whose rookie year is that season. "Most improved team in New Jersey" ranks the biggest climbs in worldwide OPR standing from the season before. OPR in points isn't compared across seasons, since every game is different.
- **A city's teams.** "Teams in Oradell" lists every team from that city, the newest season played first, with that season's OPR. A city no team lists is left to the usual search. (#458)

## 2.6.1 — 2026-11-03

FTC One Search answers questions about two teams: every match they played against each other, their OPR and ratings side by side, who has the better record, and a team's toughest opponents and best partners.

### Highlights
- [teams] "4215 vs 6980 head to head": every meeting and the record
- [teams] "4215 OPR vs 6980": both teams' OPR by phase, side by side
- [teams] "Who has a better record, 4215 or 6980" gives a verdict
- [teams] Toughest opponent, best partner, teams never played

### Search
- **Head to head.** "4215 vs 6980 head to head" or "has 4215 ever played 6980" lists the matches the two teams played on opposite alliances, newest first, with the record between them and how often they were partners. Two teams that never met say so. It takes the same scopes as other answers: Worlds, a season, playoffs or quals.
- **Side by side.** "4215 OPR vs 6980" and "4215 rating vs 6980" show both teams' stored season numbers by game phase (the season named, else the latest season both played). "Who has a better record, 4215 or 6980" compares their season win rates. "4215 win chance vs 6980" says which team is stronger and links to Predict, since every match is two alliances.
- **Opponents and partners.** A team's most played and toughest opponent (best record against it, met 3 times or more), its most frequent and best partner (best record together, 3 matches or more), and the teams from its state it never played that season. (#457)

## 2.6.0 — 2026-11-03

FTC One Search answers questions about one event, a team's awards and who won: a team's results at an event, its event wins, and the winning alliance of an event or of Worlds.

### Highlights
- [teams] "Has 4215 ever won an event": 1st places and Inspire Awards
- [teams] "ftc decode winning alliance": Worlds champions and each division
- [teams] A team's results, rank and OPR at one event, or one match there
- [teams] Worlds answers end with that season's Worlds events

### Search
- **One team at one event.** "4215 results at New Jersey Championship", "rank at", "OPR at" and "score in match 12 at" answer from the event the team played (its division, when the event has divisions): the record and matches, its rank of the teams there, its OPR by phase, or that one match. An event the team never attended is left to the usual search.
- **Awards.** Event wins count 1st-place finishes (the winning alliance) and Inspire Awards, each labelled, so "won an event" says which; a 2nd or 3rd place Inspire is listed apart, never as a win. Also Inspire Award counts, finalist finishes, all awards and the judged/performance split, for any season, Worlds or one event.
- **Winning alliances.** An event's winning alliance is the alliance that won its final match (the final series, which a classic bracket stores as series 0, never a semifinal), with its whole roster from alliance selection; the published award is used only when no final is stored. A season's championship ("ftc decode winning alliance") shows the champions, decided by the finals between the division winners, and each division's winners; a division not played yet says so.
- **Worlds follow-ups.** A Worlds answer ends with that season's Worlds events as buttons and related questions, all from the data. (#455)

## 2.5.9 — 2026-11-03

A slow search no longer looks like being offline, and searches that match nothing answer five times faster.

### Highlights
- [fixes] A slow search says "Search is slow", never "Offline"
- [speed] Searches that match nothing answer in about a second, not five
- [fixes] A slow or failed search is tried once more by itself

### Search
- **Slow is not offline.** While your browser is online and the server answers everything else, a search that takes more than 4 seconds keeps waiting for the server instead of switching to saved data and the Offline badge. It gets up to 10 seconds, one more try, and then says "Search is slow right now. Try again." with a Try again button. With no network at all, saved data still answers as before.
- **Faster no-match searches.** Queries that match nothing (like "highest scoring games in decode") took 5–6 seconds on the server, comparing every name's words letter by letter. The scan now skips names missing any word typed and stops comparing as soon as a word is past its allowed typos: about 1 second, with the same results. (#463)

## 2.5.8 — 2026-11-03

FTC One Search answers questions about a team's matches: its best score at Worlds, its Worlds record, its average this season and more, each worked out from the match records with the matches shown.

### Highlights
- [teams] "4215 highest score in worlds": the score, match, division and date
- [teams] "4215 worlds record" counts Worlds matches only
- [teams] Average score, streaks, last 5 matches, biggest win and more
- [teams] Every answer says how it was counted and which records it comes from

### Search
- **Stat answers.** A question about one team's matches, events or seasons gets its answer at the top of the results: the number asked for, then the matches, a win-loss bar, tables by season and charts. It works for any team and any of these scopes: Worlds ("at worlds"), state championships ("at states"), a season ("2024-25", "this season", a game's name like "into the deep"), every season ("ever"), playoffs or quals, and red or blue. Questions it answers: highest and lowest score, which event it scored highest at, biggest win and loss, closest match, first and most recent match, match wins, record, record by alliance colour, matches played, average score, current and longest win streak, last N matches, blowout wins, losses, playoff and qualification matches, playoff appearances, best and worst event finish, first and most recent event, best OPR event, events played, average event rank, seasons played, first season, best season and most improved season.
- **How each is counted, said with it.** A highest score is the alliance's own points without penalties (the score with penalties beside it), in matches the team was on the field for, at official events, as in the season records. Records, margins and streaks use the official result and the site's one record rule. "This season" is the team's latest season with matches, and the answer names it. Worlds means FIRST Championship events: its divisions and finals. Nothing found says so ("No Worlds matches found for Bad Wolf (6980)."), never another team's numbers.
- **Never one number across seasons.** Each season is a different game that scores on its own scale, so seasons are compared by OPR standing (rank among that season's teams) and record, never by raw OPR or scores: the best and most improved seasons use standing, an average over several seasons is listed season by season, and with no season named a best or lowest score, a biggest win or loss and a best OPR event are the latest season's, with every season's own listed below.
- **The dropdown stays quick.** It shows what the question was read as and the team; the answer's tables and charts are worked out on the results page after Enter. (#453)

## 2.5.7 — 2026-11-03

FTC One Search finds every meet held at a venue, past seasons too, and its lines say what you typed.

### Highlights
- [history] "Meets at River Dell High School" lists every season's meets there
- [fixes] Venues match loosely: "HS", "Regional" and small misspellings
- [fixes] Search lines repeat your words: "Meets in New Jersey"
- [rankings] "Best teleop in the world" and "best auto in NJ" show the leaders

### Search
- **A venue spans every season.** "Meets in River Dell High School" with no year lists its meets from every season in date order (upcoming first, then past, most recent first), so the Past filter has the past ones to show. "Past meets at …" lists only those.
- **Venues match loosely.** Punctuation, "HS" or "H.S." for "High School", "Regional", and a letter or two off are the same venue. A city counts when the place typed is that city ("meets in Oradell").
- **Honest fallbacks.** With nothing to show, a time word goes before the venue: "No past meets at Dumont High School in the data — showing meets at Dumont High School instead".
- **Lines say what you typed.** "Meets in New Jersey" (no longer "League meets"), "League meets in New Jersey" when you type "league", "Tournaments in New Jersey", and "NJ states" reads "State championships in New Jersey". Kinds that share no type are each named ("Meets and tournaments").
- **Stat leaders, any scope.** "Best teleop in the world", "highest OPR this season", "most wins of all time" and "best driver controlled worldwide" show that stat's leaderboard, the same as "best teleop"; "best auto in NJ" or "best auto in New Jersey" shows New Jersey's. "Top", "strongest", "greatest" and "number one" read as "best"; "autonomous" as auto; "driver" or "driver controlled" as teleop. (#461)

## 2.5.6 — 2026-11-03

Searching never waits where you typed: Enter opens the results page straight away, and a loading screen shows while the results arrive.

### Highlights
- [speed] Enter in any search box opens the results page straight away
- [speed] A loading screen shows the shape of the results while they arrive
- [speed] A new search from the results page clears the old results at once

### Search
- **Enter never waits.** Pressing Enter or the magnifier in a search box (Home, the top bar, the results page) used to wait with a spinner until the answer came back. Now it opens the results page at once. A team number, a team's whole name or an event code still goes to that team or event: from the box when its answer is already in, or from the results page as soon as its answer arrives, replacing itself so Back returns to where you typed. (#464)
- **A loading screen while results arrive.** The results page shows grey shapes of what's coming: the title, a grid of result cards and, on a computer, the panel on the right. They shimmer gently and stay still if your device asks for reduced motion. A line reads "Searching teams, events and matches…" and your search stays in the search bar. A new search run from the results page replaces the old results with it straight away, so they never look current.
- **No blank page first.** Clicking into a search box starts loading the results page, so Enter goes straight to its loading screen.

## 2.5.5 — 2026-11-03

Home's headline is smaller, so the FTC One Search block and all its example chips sit above the fold.

### Highlights
- [home] The headline fits in two lines, with no gap under it
- [home] The whole search block, chips included, shows without scrolling
- [speed] The first paint's headline matches the page, so nothing jumps on load

### Home
- **A smaller headline.** It never grows past its column, so even the longest hourly line keeps to two lines, and the space that used to sit under shorter lines is gone. Its words and colours are unchanged. The search block ends about 160 px higher on a laptop screen, and it is fully visible without scrolling on phones, tablets and desktop windows from 390×844 to 1440×900. The globe beside it doesn't move. The page's first paint sizes its headline the same way, so it doesn't shrink when the app takes over. (#460)

## 2.5.4 — 2026-11-03

FTC One Search answers "who won NJ states": the winning alliance and the Inspire Award, from the event's results.

### Highlights
- [history] "Who won NJ states" names the winning alliance and Inspire winner
- [history] It answers the newest finished championship, its season named
- [fixes] "TX states" lists state championships, not the FIRST Championship

### Search
- **Who won an event.** "Who won NJ states", "who won the New Jersey Championship", "winners of 2024-25 NJ states", misspelled or not, answer the newest finished championship of that place (or the event named, its newest finished season). The answer shows the winning alliance as FIRST records it (each division's, at a championship with divisions) and the Inspire Award winner, and opens the event on its playoffs. "Won" is never read as a name word. An event with no results recorded says so plainly. "Who won Inspire at …" still lists that award's winners.
- **"States" is a state's own championship.** "TX states" lists Texas's state and regional championships, never the FIRST Championship held in Houston, and its line reads "State championships in Texas". "NJ states events" now reads as state championships too, not as all events. (#456)

## 2.5.3 — 2026-11-03

Match timestamps for recordings that YouTube cut short: a match's Watch button now shows up on more events.

### Highlights
- [live] More events get a Watch button on their matches
- [live] A recording YouTube cut short is checked against its own chapters
- [live] The DECODE Preview Event in Texas now has Watch on 47 of 50 matches

### Event page
- **Recordings that YouTube cut short.** When a stream is left running for hours after the event, YouTube keeps only part of it, and the video then looks shorter than the broadcast. Before, matches got no Watch button unless the cut fell within 15 minutes of the last match, because a gap in the middle would put every later match on the wrong spot. Now the recording's own chapters (YouTube's "Match five" and so on) are read as well. When matches sit by their chapters, the clock still holds and they get their Watch. A real gap moves every later match away from its chapter for good, so Watch stops at the match before it. The DECODE Preview Event (Texas, Oct 18) goes from no Watch buttons to 47 of 50. (#449)

## 2.5.2 — 2026-11-03

Match videos play in the app: a match's video button no longer sends you off to YouTube.

### Highlights
- [live] A match's video button plays that match right on the page
- [live] On an event page it plays in the event's player, prediction on top
- [live] Anywhere else it opens in a video window, without leaving the page

### Event page
- **Match videos play in the app.** FIRST's own video of a match (the play button on a match row and in its details) and a match's Watch (its moment in the event's recording) now play inside Control Scout. On an event page with a recording, they play in that player, with the model's call for the match over the video, and a Back to the recording button. On other pages, such as a team's matches, they open in a video window. Ctrl-click or middle-click still opens YouTube in a new tab. (#445)

## 2.5.1 — 2026-11-03

FTC One Search keeps Bruno AI's overview on every question, and titles a plain name search by what it found.

### Highlights
- [teams] Bruno AI answers "how good is" a team again, above its standing
- [fixes] A plain name search is titled by what it found, never your words
- [teams] Bruno AI knows who won each event listed, for "who won nj states"

### Search
- **Bruno AI on every question.** Before FTC One Search, Bruno AI wrote a short overview for every question; "how good is simply complex" had lost it when the standing summary arrived. He's back: his overview sits above the standing (on a phone, the numbers first and his writing under "Show AI Analysis"). The record cards and summaries sit beside him and never replace him, and a test now lists every kind of question the page answers (championship trips, states, a team's standing, awards, next match, comparisons, rules, high scores, leaderboards, event awards, and a plain question answered by name matches) so none can lose him again.
- **Who won.** Bruno AI is now told who won each event in the results (its winning alliance and Inspire Award), so "who won nj states" gets an answer from the records instead of nothing.
- **No echo in the title.** When search reads no meaning into the words and lists names that match them ("who won nj states"), the title says what it found ("Matching events", "Matching teams and events") instead of repeating the words, and no badge repeats them either. With nothing found the title is just "No matches found" (the words are in the search bar above). A title for a question it understood is unchanged. (#454)

## 2.5.0 — 2026-11-03

FTC One Search on a phone: pick two teams to compare from the results, and preview a head-to-head without leaving them.

### Highlights
- [teams] VS Compare on a team result picks it for a Compare bar
- [teams] The Compare bar sits above the tab bar and opens the comparison
- [teams] A comparison result opens its head-to-head in a panel over the results

### Search
- **Pick two, compare.** On a phone, VS Compare on a team result picks it for comparing. Picked teams dock in a bar right above the tab bar; "Compare (2) →" opens them side by side (in the season the results are about, when they name one), and with only one picked, "Compare (1) →" opens Compare to add the other. A third pick replaces the first, and × drops a team. The picks belong to that search: a new search starts with none.
- **Head-to-head without leaving.** Tapping a comparison result ("Hypnotic Robotics vs Ultraviolet") opens a panel from the bottom with both teams' record, OPR and OPR rank, and View full comparison → at the end. Close it and the results are just as you left them. Results and their order are unchanged. (#446)

## 2.4.9 — 2026-11-03

FTC One Search: "Top teams in NJ" and "Highest OPR" join the example searches.

### Highlights
- [home] New example search: "Top teams in NJ" opens New Jersey's leaderboard
- [home] New example search: "Highest OPR" lists this season's top OPRs
- [home] Examples cover places, comparisons, questions, records and leaderboards

### Search
- **Example searches.** Now that search answers leaderboards, the examples include two: "Top teams in NJ" (New Jersey's rankings) and "Highest OPR" (this season's highest OPRs, without penalties). They replace "Highest score this season" and "Upcoming meets in Texas", so the set is "Meets in New Jersey", "6980 vs 16461", "When did 7149 go to Worlds", "18061 record", "Top teams in NJ" and "Highest OPR". Each was checked against live search and returns real results. On Home, "Top teams in NJ" carries a Rankings tag. (#452)

## 2.4.8 — 2026-11-03

FTC One Search reads a misspelled place, and "states" as a state's championship, across every season.

### Highlights
- [fixes] A misspelled state with "states" finds its championships
- [history] A state's championships list every season, newest first
- [fixes] "NJ states" means the state championship, never "stats"

### Search
- **A misspelled place is that place.** When the query names a kind of event, a near miss of a state's or province's full name is read as that place, and the line above the results says what was typed. It allows one letter off per word and two in all, and only when exactly one place is that close. A code is never guessed, and it is never a did-you-mean to an event's name.
- **"States" is the state championship.** "NJ states", "NJ state champs", "New Jersey champs" and "New Jersey state championship" all read as New Jersey's championship.
- **Every season, newest first.** A championship asked for with no year, season or time lists that place's championships from every season in the data, newest season first, so this season's (upcoming or finished) is on top. Seasons in between with none on record are named ("none on record for 2021–22"). Divisions are listed with their championship. When there are more than a page holds, the newest come first, the line says how many there are in all, and a link opens the full list on Events. A year or a season ("2024-25 NJ states") still scopes it to that one. (#450)
- **Rules: whole words for short ones.** A short word in a rules question matches only itself or its endings: "pinning" finds the pinning rule (G421), no longer a rule that mentions pinch points.

## 2.4.7 — 2026-11-03

Teams: a link can name a state, so it opens on exactly the teams a search answer ranked.

### Highlights
- [teams] A Teams link can name a state, like New Jersey teams only
- [share] A filtered Teams page survives refresh, back and sharing
- [teams] One chip, "Teams from New Jersey, United States", clears the place

### Teams
- **A state in the link.** `/teams?country=US&state=NJ` lists the teams whose home is New Jersey. It's the same place search answers use, so the "View more detail" link under a leaderboard opens on the same teams, in the same order, with the same numbers. FIRST's region codes can't always do this (Kansas teams sit in Missouri's region, California has four). The season, view, sort, region and filter in the link already worked, so a pre-filtered page such as New Jersey sorted by auto OPR for 2025–26 survives a refresh, the back button and a share. The place shows as one chip, "Teams from New Jersey, United States", and removing it clears both the country and the state. Switching between Team-events and Team seasons keeps it. (#451)

## 2.4.6 — 2026-11-03

Compare: the season picker sits with the team controls.

### Highlights
- [fixes] On Compare, the season picker sits right under Quick add
- [fixes] The "no results yet" note names the season once
- [fixes] Phones stack the same order: teams, Quick add, then season

### Compare
- **Season picker moved.** The season buttons (2026–27, 2025–26, 2024–25, 2023–24, Earlier) now sit directly below the Quick add row, lined up on the left with the team search, instead of at the top right beside the title. Top to bottom: the team search and count, Quick add, the season, then the note and the comparison. Phones stack the same order. The seasons on offer and what picking one does are unchanged.
- **Season note.** When there are no results yet in the current season, the note reads "No 2026–27 results yet, so this compares 2025–26, the latest season any of these teams has results in." It used to print the season twice. (#447)

## 2.4.5 — 2026-11-03

FTC One Search answers "when" questions latest first, with the year at the front of each card.

### Highlights
- [teams] A team's Worlds or state trips list the latest season first
- [teams] Each trip's card starts with its season in bold, then the division
- [fixes] The empty search page no longer shows example searches
- [teams] A game-rule answer shows a book icon instead of the trophy

### Search
- **Latest first.** "When did 23268 go to Worlds" lists 2025–26 before 2024–25, and so on back. The OPR chart above still reads left to right, oldest to newest, and selecting a season still jumps to its card. On a phone the season chips run latest first too.
- **The year leads.** Each trip's card starts with its season in bold ("2025–26 · Lovelace Division"); the season chip that repeated it is gone.
- **No example row on an empty page.** When nothing matches, the page explains what search covers, what it understood and links to browse events and teams; the example searches stay in the search box's dropdown.
- **A book for rules.** An answer from the game manual ("can robots descore…") has a book icon; answers from records keep the trophy. Results and their order are unchanged. (#448)

## 2.4.4 — 2026-11-03

Home's search box says what it can do: type whatever you want.

### Highlights
- [home] FTC One Search on Home: a bigger, glowing box for any search
- [home] Example searches cycle in the box, each marked with its kind
- [home] Tap any example under the box to run it

### Site
- **FTC One Search on Home.** Home's search block is now the hero of its column: a taller field with a soft volt glow that brightens when you type, under "Type whatever you want" and the line "Search teams, events, matches, predictions, and records." The placeholder cycles through the search's own example searches every few seconds, the same list the empty search box offers. It holds still while the field has focus and never moves with reduced motion on, when the glow is static too. The examples are also chips under the box, one tap each to their results (and kept in your recent searches); on a phone they scroll sideways in one row. With the field empty and focused, the dropdown shows your recent searches. The placeholder is never searched for itself. The results dropdown stays the box's own width, so the globe beside it never moves. The rest of Home is unchanged. (#426)

## 2.4.3 — 2026-11-03

FTC One Search answers more questions: who's on top in a state, who leads a stat, who won an award, and what Predict says.

### Highlights
- [rankings] "What is the best FTC team right now" shows the world's top five
- [rankings] "Top teams in New Jersey" shows its top five; team rows show OPR
- [rankings] "Highest OPR", "best auto team" and "most wins" list the leaders
- [predict] "Will 4215 win their next match?" opens Predict on its matches
- [history] "Who won Inspire at …" names the winners from the event's results

### Search
- **The best team, worldwide.** "What is the best FTC team right now", "best team", "who is the best FTC team" and "top FTC teams" show the season's top five from the world rankings, titled "Top teams · 2025–26", and link the full ranking. "FTC", "right now", "currently" and "in the world" are read as filler, never as names.
- **Questions don't list stray matches.** A question that matches nothing says what it read and offers the browse links. It no longer lists teams or towns that only share one of its words ("Best", "The Best Friends").
- **Leaderboards by place.** "Top teams in New Jersey", "NJ rankings" and "best team in NJ" show the region's top five from the live rankings, each with its place in the region and in the world. They also link the region's full ranking.
- **Stat leaders.** "Highest OPR", "best auto team", "best teleop", "best endgame" and "who has the most wins" list the season's top five by that number (OPR without penalties, or its auto, teleop or endgame part; wins with losses as the tie-break), optionally for a region ("highest OPR in NJ"). Only teams with 3 or more matches count. No other stat is ever inferred.
- **Predictions and advancement.** "Will 4215 win their next match" shows its next match and opens Predict on its matches. "4215 vs 6980 who wins" shows the Compare and opens Predict with both teams filled in. "Who will win New Jersey Championship" opens the event's odds. "Will 4215 advance to states" and "what does 4215 need to advance" open the advancement simulator for the team.
- **Event awards.** "Who won Inspire at New Jersey Championship" (and Think, Innovate, Design, Reach, Sustain, Connect, Control, Compass, Judges' Choice) lists the winners from the event's results. For an event that hasn't happened yet, it shows the latest season that gave the award, with that season named.
- **Team questions.** "When does 4215 play next" shows its next match, or says plainly that none is scheduled yet. "How are predictions calculated" puts the methodology page first in Pages.
- **Numbers on team rows.** Every team row the search sends carries its newest season's OPR (without penalties, as on the team page), its record and its OPR rank. A number the data doesn't have is left out. (#440)

## 2.4.2 — 2026-11-03

FTC One Search answers rules questions from the Rules quick reference, never with team names.

### Highlights
- [fixes] "Can robots descore…?" asks the rules, not teams named "Can"
- [teams] "Penalty for hoarding" and "G402" show the rule, linked to /rules
- [history] An older game's piece links that season's official manual

### Search
- **Rules questions go to the rules.** A rule number ("G402", "rule 10.5.1"), a query starting with "penalty", "foul" or "rule", or a question with a rule word (descore, pin, foul, inspection, control, hoard, …) is answered from the season's Rules quick reference (the same data as /rules, the `rulesReference` setting). A rule is listed only when every word asked is in it. Each rule shows its number, summary and penalty, linked to its entry on /rules. When no rule matches, the answer says so and never guesses. No team is ever listed for a rules question. "Can Control" on its own is still a team.
- **Older games.** A piece or field part from a past game ("sample", "specimen": INTO THE DEEP; "pixel": CENTERSTAGE; "cone": POWERPLAY, …) makes the question that season's. The answer names the game and links FIRST's official manual for that season, plus its events. It never answers with this season's rules. The list of manuals is in `src/shared/rules/pastManuals.ts` (FIRST's archive, links checked 2026-11-02). (#437)

## 2.4.1 — 2026-11-03

FTC One Search compares teams as a Compare, never as a team, and says which team a shared name means.

### Highlights
- [teams] "4215 vs 6980" is a Compare of its own, above the teams
- [teams] A Compare names each team's number and place
- [fixes] "Ultraviolet vs Hypnotic history": extra words keep the versus
- [fixes] A name several teams share is picked by fixed rules, or asked

### Search
- **Compare is its own kind.** A versus query ("4215 vs 6980", "hypnotic vs bad wolf", "ultraviolet vs hypnotic history") answers with one Compare row that opens /compare with both teams. It has its own group above Teams and is never counted as a team. Each side is named with its number and place ("Hypnotic Robotics (4215) · Oradell, NJ").
- **Trailing words don't break it.** "history", "record", "stats" and other words after the second team are read as what to compare, not as part of the name.
- **Shared names, picked the same way every time.** When several teams share a name, the pick goes in this order: your own team, then a team that has played, then the one that played most recently, then the one in the same state as the other team. If they are still tied, each candidate gets its own Compare row and the line above asks which one you meant. The pick is never a guess. The answer records which rule chose each team. (#436)

## 2.4.0 — 2026-11-03

FTC One Search on a phone: shortlist a team or see its matches straight from the results, with a tap or a swipe.

### Highlights
- [teams] Swipe a team result right to add it to your Shortlist
- [teams] Swipe it left to see its latest matches without leaving search
- [teams] Both are also buttons on the card: Shortlist and Matches

### Search
- **Shortlist from the results.** On a phone each team result has a Shortlist button, the same list as the team page's; swipe the card right for the same. Swipe again or tap Shortlisted to take it off. There's no separate compare tray: the Shortlist is where teams you're considering go.
- **Matches at a glance.** Tap Matches, or swipe the card left, for the team's latest ten played matches this season in a panel from the bottom: win, loss or tie, the match, the event and the score, each opening the match. Close it and you're back on the same results. Results and their order are unchanged. (#444)

## 2.3.9 — 2026-11-03

FTC One Search: a team number, a team's name or an event code takes you straight to its page.

### Highlights
- [fixes] Searching "6980" opens Bad Wolf's team page, not a results page
- [fixes] A team's full name, like "Bad Wolf", goes straight to the team
- [fixes] An event code, like "USNJNEM2", goes straight to the event

### Search
- **Straight to the page.** Enter (or the magnifier) on a search that names exactly one thing opens its page directly: a team number ("6980", "team 6980", "ftc 6980"), one team's whole name ("Bad Wolf", "simply complex") or an event code ("USNJNEM2"). Back returns to the page you searched from, and the search is still kept in your recent searches. Everything else still opens the full results page: questions, places, "vs", topics like "6980 record", part of a name, and names shared by more than one team (there are two teams called "Ultraviolet"). The choice is made from search's own answer, the same one the dropdown shows. Pressing Enter before the dropdown has loaded asks for that answer straight away and goes as soon as it arrives.
- **Example search.** The versus example is now "6980 vs 16461": both teams have this season's record and OPR, so the head-to-head shows numbers on both sides. (#443)

## 2.3.8 — 2026-11-03

FTC One Search on a phone: the search stays at the top as you scroll, the numbers come first, and every result is easy to tap.

### Highlights
- [teams] On a phone, your search stays in a bar at the top, with an × to clear it
- [teams] Stats sit in one row you swipe; each season is a tap-to-jump chip
- [teams] Bruno AI's written answer folds behind "Show AI Analysis" on a phone
- [teams] Team results have a VS Compare button; event links are big enough to tap

### Search
- **The search at the top.** On a phone the search page shows your search in a bar that stays under the top bar while you scroll, and slims down once you do. Tap it to change the search; tap × to clear it. The title reads "Results: …" without the big heading.
- **Numbers first.** A summary's stats are one row of blocks you swipe sideways, three to a screen. A team's championship trips are a line of chips ("2022–23: #3"), every season shown, each jumping to that trip's card.
- **AI analysis folded.** When Bruno AI answers, his writing is behind "Show AI Analysis" on a phone, so the results stay near the top. On a wider screen it shows as before.
- **Made for thumbs.** A whole team card is one tap target, with a VS Compare button that starts a comparison with that team. An event card's quick links are full-size buttons. Results and their order are unchanged. (#442)

## 2.3.7 — 2026-11-02

FTC One Search: the example searches show the range of what you can ask, across different teams.

### Highlights
- [home] Example searches use different teams, and some use none at all
- [home] New examples: "Highest score this season", "Upcoming meets in Texas"
- [home] Every example was checked to return real results

### Search
- **Example searches.** The examples in the empty search box no longer repeat one team. Each is a different kind of search with a different team, or none, written as a sentence: "Meets in New Jersey", "11115 vs 16461", "When did 7149 go to Worlds", "18061 record", "Highest score this season" and "Upcoming meets in Texas". Every one was checked against live search and returns real results. (#441)

## 2.3.6 — 2026-11-02

FTC One Search says each thing once at the top of its results: the title, then a badge only when it adds something.

### Highlights
- [fixes] The badge under a search's title is left out when it only repeats it
- [fixes] A misspelt name shows its "did you mean" once, not twice
- [fixes] A comparison's badge no longer repeats both team names

### Search
- **No repeated badge.** The badge under the title says how a search was read. When that reading is already the title ("League meets in New Jersey", or two teams side by side), the badge is left out, so the top of the page says it once. Badges that add something, like a team's name under its Worlds trips, stay.
- **Did you mean, once.** For a misspelt name, the title reads "Closest names to" what was typed, and the suggestion appears once, on its own line above the results. Results and their order are unchanged. (#439)

## 2.3.5 — 2026-11-02

FTC One Search: the search dropdown groups what it found, Comparisons first, and says what it understood.

### Highlights
- [home] "4215 vs 6980" shows a Compare shortcut above the teams in the dropdown
- [home] The dropdown says what it understood: "League meets in New Jersey"
- [home] Event rows in the dropdown show their dates and place
- [fixes] Teams that only share a word with your search are listed apart

### Search
- **Comparisons first.** A versus search ("4215 vs 6980", "ultraviolet vs hypnotic") puts the comparison in its own Comparisons group at the top of the dropdown, with a side-by-side icon, both teams by name and number, and a Compare button. It is no longer listed (or counted) as one of the teams.
- **What it understood.** Above the results, the dropdown names what search read your query as ("Understood: Upcoming league meets in New Jersey"), the same words the results page uses. A spelling correction still says "Did you mean …?" instead.
- **Teams, events, pages.** Team rows have the team badge icon, and show the team's season OPR when the server sends it. Event rows show the season, the dates ("Nov 7, 2026") and the place in place of the event code and a raw date, with Live while an event is on. A set of events counts the whole set ("Events 14 of 26"), so the dropdown and the results page agree. Site pages stay in their own Pages group below.
- **Exact matches apart.** When some teams only share a word with your search, they're listed under "Other teams matching “…”", below the exact match, as on the results page.
- **Example searches.** "meets in New Jersey" joins the example searches in the empty box. (#438)

## 2.3.4 — 2026-11-02

FTC One Search understands places, venues, dates and years: "upcoming meets in New Jersey" lists exactly those, soonest first.

### Highlights
- [fixes] "Upcoming meets in New Jersey" lists the next ones, soonest first
- [fixes] Search names what it understood, never one event's name
- [fixes] "Meets at River Dell High School" finds the meets held there
- [fixes] "2024 Houston Championship" finds 2024's, never this season's
- [fixes] Nothing at that venue? Search says so and shows the state's meets

### Search
- **Places, venues and cities.** A kind of event ("meets", "championships", "events") with a place is read as that set of events: a state by name or code ("New Jersey", "NJ"), a city ("meets in Oradell") or a venue ("meets in New Jersey at River Dell High School"), filtered on each event's own stored state, city and venue. Event venues are now searchable words too, so "River Dell" finds the meets held there.
- **Dates.** "upcoming" is from today on, "past" is before today, "this weekend" is the coming Saturday and Sunday (on a Sunday, the weekend under way), "next weekend" the one after, and "this week", "next week", "this month" and "next month" likewise. "when is the next meet in New Jersey" reads as upcoming. Time words are never matched against names.
- **Years.** "2024" means events held in 2024 (the 2024 Houston championship is part of the 2023–24 season); "2023-24" means that season; no year means the current season. A year with no matching event says so, with other years' events listed as closest matches, and is never swapped for the current season's.
- **Order.** A set of events is listed by date, never by relevance: upcoming events soonest first, then past ones most recent first. The two groups never mix.
- **What was understood.** Every answer says what search understood ("League meets in New Jersey", "Upcoming league meets in New Jersey at River Dell High School"), shown where /search said "Showing:". It never names a single event for a set of events.
- **Honest fallbacks.** A venue or time with no events falls back to the closest real set and says so: "No league meets in New Jersey at Nonexistent High School — showing league meets in New Jersey instead".
- **Corrections only for typos.** "Did you mean" is kept for a near miss to a name. Words found only in a school, city or venue are results, marked as such, and a query whose words only match one at a time lists them as closest matches instead of an answer.
- **One reading everywhere.** The header box and /search work the answer out the same way on the same full list; the box shows the first rows of the page's list, in the same order. "New Jersey" and "NJ" both list the state's events link, then its events, then its teams. (#434)

## 2.3.3 — 2026-11-02

FTC One Search shows a team's numbers once: when the summary has them, the team's card below doesn't repeat them.

### Highlights
- [fixes] "How good is" a team shows its record, OPR and rank once, in the summary
- [fixes] The team's card below keeps its name, place and profile link
- [fixes] Other teams in the results keep their own numbers

### Search
- **Each number once.** For a question like "how good is Simply Complex", the summary holds the team's record, world OPR rank and OPR; the team's card under it now shows its name, place and View scouting profile only, where before it repeated those numbers. Results and their order are unchanged. (#435)

## 2.3.2 — 2026-11-02

FTC One Search on a wide screen: results on the left, one panel on the right, and no clock or weather on the search page.

### Highlights
- [teams] On a wide screen, results fill the left and one panel sits on the right
- [teams] The right panel is a team-vs-team record, or a question's summary
- [teams] The search page hides the clock and weather; other pages keep them

### Search
- **Results left, one panel right.** On a desktop the results take about two thirds of the width. The right third holds at most one panel, picked by the search: a versus search shows the two teams' record against each other; a question shows its summary (timeline, stats or standing) with links to the team's pages. When both apply, the versus record keeps the column and the summary goes below the results. On a phone it's one column with the summary first. Results and their order are unchanged.
- **No clock or weather on search.** The top bar's clock and weather are hidden on the search page only, to leave room for the search; every other page still shows them. (#433)

## 2.3.1 — 2026-11-02

FTC One Search reads what you type the way you meant it: plurals, little words and questions no longer throw it off.

### Highlights
- [fixes] "Meets in New Jersey" finds the same meets as "meet in New Jersey"
- [fixes] "How good is Simply Complex" shows that team, not every "good" one
- [fixes] Teams read "18061 | Simply Complex": the number once, the name once
- [fixes] Questions like "Can robots descore…" no longer list teams named "Can"

### Search
- **Plurals read as their singular.** meets, events, matches, teams, tournaments, championships, qualifiers, scrimmages, leagues, divisions, competitions, premiers and kickoffs are read as the singular before any name is matched, so each pair finds exactly the same results. (Before, a word was matched as a prefix, and "meets" can never be the start of "meet": "Meets in New Jersey" found nothing.)
- **Little words don't have to match.** in, at, on, the, a, an, for, of and this are left out when other words name the team or event, so "meet at New Jersey" and "meet in New Jersey" find the same meets.
- **A question's opening is the question.** "how good is", "how strong is", "how is", "what is the rank of", "what's the record of", "where is", "tell me about", "show me" and the rest of the list in `src/shared/searchQuery.ts` are read as the question, never as part of a name: "how good is simply complex" searches "simply complex" and shows its season's OPR, rank and record. Only the opening goes, so "how good is Good Enough" is Good Enough, and "good teams" (no opening) still searches for "good".
- **Time words and a question's own words never name a team.** "upcoming", "this weekend" and the like (and "past", "recent", "latest" next to a word like "meets") are never matched against names, so "upcoming meets" can't turn into the team Oncoming Storm. In a question ("Can robots…?"), words like can, will and does aren't searched for either; "Can Control" on its own is still a team's name.
- **Team titles once each.** Every team in search reads "number | name" (`18061 | Simply Complex`), with a number FIRST stores inside the name ("Simply Complex 18061") shown only once, in the header box, on /search, in the address bar's search and offline. (#427)

## 2.3.0 — 2026-11-02

FTC One Search's answers read at a glance: a timeline and stats for a team's championship trips, a team's standing for "how good is", and shorter event cards.

### Highlights
- [teams] "When did a team go to Worlds" shows a timeline of its OPR by season
- [teams] Stats counted from the records: trips, streak, best rank, peak OPR
- [teams] "How good is" a team shows its record, world rank, standing and win rate
- [teams] Event results use short titles, badges, stat pills and quick links
- [teams] An event held in several seasons gets a tab for each season

### Search
- **Championship timeline.** A question about a team's Worlds or state championship trips shows its OPR across the seasons; point at a season for its division, rank, record and OPR, and select it to jump to that trip's card below.
- **Stats counted from the records.** Total trips, the longest back-to-back streak, the best division rank, the peak OPR and the most frequent division, each counted from the trips listed (left out when there's nothing to count, never shown as zero). When Bruno AI answers, his sentence stays and these stand in for his bullet list.
- **How good is a team.** The season record, world OPR rank, OPR, a standing tier (top 5% Elite, 15% Excellent, 35% Strong, 60% Solid, else Developing; rank over ranked teams, one decimal) and a win rate (a tie counts as half a win), each shown once.
- **Shorter event cards.** A championship division is titled by its own name ("Franklin Division") with the championship, place and season as badges; rank, record and OPR as pills; status, teams registered and quick links to the event's teams, matches, rankings and playoffs where it has them.
- **Season tabs and team cards.** An event held in several seasons is one card with a tab per season. Team cards read "18061 | Simply Complex" with their season numbers and a View scouting profile link. Results and their order are unchanged. (#432)

## 2.2.9 — 2026-11-02

FTC One Search's results page says what it found once: a clean title, one line for how it read your search, and the search itself in the top bar.

### Highlights
- [teams] Search results are titled by what was found, not the words you typed
- [teams] One badge says how your search was read, instead of two lines
- [teams] Refine a search in the top bar; no second search box on the page

### Search
- **One title, one badge.** The results page (/search) no longer repeats your search three times. Its title names what was found (a team and what was asked, a comparison, or the server's reading such as "Events in New Jersey"), never the words as typed; one badge below says how the search was read ("ENFORCERS (7149) · Worlds appearances"). A correction ("Did you mean …") still says so on its own line. A small "FTC One Search" label sits above the title.
- **Refine from the top bar.** The page's own search box is gone; the top bar holds your search on /search, so change it there and press Enter. Results, their order and the cards are unchanged. (#431)

## 2.2.8 — 2026-11-02

FTC One Search's results page reads at a glance: events as cards, a Compare of its own, filters, and no dead ends.

### Highlights
- [teams] Search results show events as cards, date and status up front
- [teams] Filter search results by upcoming or past, season and event type
- [teams] A "team vs team" search gets its own Compare card and a preview
- [teams] Team results show their record, OPR and OPR rank
- [fixes] A search that finds nothing says what it understood and what to try

### Search
- **Event cards.** On the full results page (/search) each event is a card like the Events list's: Upcoming, Live, Started (begun, end date not known) or Finished, its season, the date in bold and the place. The header's dropdown stays a compact list.
- **Filters on the page.** Upcoming / Past / All, a season and an event type (only the seasons and types the results hold) narrow the results without leaving /search. They live in the address, so a refresh, Back or a shared link keeps them, and Clear filters brings back exactly the unfiltered results in the same order.
- **Compare is not a team.** A "ultraviolet vs hypnotic" search shows the Compare as its own card above the teams, with a swap icon, both teams by name, number and place, and a View comparison button; the Teams count no longer includes it. On a desktop a head-to-head preview sits beside the results (season record, OPR and OPR rank for both sides) with a link to the full comparison.
- **Team cards.** Each team result carries its season record, OPR and world OPR rank as small badges, only where the data has them; early in a season, before a team has played, they show last season's, labelled with it.
- **Exact and word matches apart.** When some teams only share a word with the search, they're listed under "Other teams" below the top match instead of mixed in with it.
- **No dead ends.** When nothing matches, the page says so in its title (never "Here's what we found" above an empty page), says what search covers and what the query was read as, lists the closest matches labelled as such, and links to browse events and teams plus a few searches to try.
- **Cleaner cards.** Result cards no longer print the web address they open; the whole card is one link, with its destination as a "View …" label. The magnifier in the page's search box now runs the search. (#429)

## 2.2.7 — 2026-11-02

FTC One Search: the search you ran stays in the top bar.

### Highlights
- [home] On the results page, your search stays in the top bar's search box
- [home] Change a word there and press Enter to refine it
- [fixes] Opening the results page no longer empties the search box

### Search
- **Your search stays in the top bar.** On the full results page (/search) the top bar's box shows the query you ran, follows it when it changes, and is where you refine it: edit it and press Enter (or the magnifier) for the new results. Until you edit it, it doesn't search again, since the results are already on the page. On every other page the box starts empty, as before. (#430)

## 2.2.6 — 2026-11-02

FTC One Search: recent searches, example searches, and a clearly labelled "did you mean".

### Highlights
- [home] Your recent searches show when you click into an empty search box
- [home] Example searches in the box show what else you can ask
- [fixes] A spelling correction now says "Did you mean …?" with what you typed

### Search
- **Recent searches.** The top-bar search and the not-found page's search remember what you searched for, on this device only: click into the empty box and your last few searches are there, one tap to run one again, with Clear to remove them all. They're never sent anywhere (Settings › Clear all local data removes them too). Pickers, like Predict's team box, don't record anything.
- **Example searches.** The same empty box offers example searches that run straight away: "4215 vs 6980", "when did 4215 go to worlds", "will 4215 win their next match" and "4215 record".
- **"Did you mean" is labelled.** When search corrects a query, the line above the results reads "Did you mean “…”? Showing results for that, not “what you typed”.", so a correction is never mistaken for what you asked. (#428)

## 2.2.5 — 2026-11-02

FTC One Search: the magnifier searches, and the list stays clear of a phone's keyboard.

### Highlights
- [fixes] Tapping the magnifier in a search box runs the search, just like Enter
- [fixes] On a phone the results list now ends above the keyboard
- [fixes] Typing fast never leaves an older search's results looking current

### Search
- **The magnifier searches.** In every search box (Home, the top bar, Predict's picker, Events, the not-found page) the magnifier icon is now a button: tapping it opens the full results page for what's typed, exactly like Enter or the keyboard's Search key, and the keyboard closes so the results show. In a box that picks something (Predict's team picker) it opens the top result, as Enter does. On an empty box it just puts the cursor in the field. Clear (×) and the top bar's phone search button work as before.
- **Results clear the phone keyboard.** While the on-screen keyboard is up, the results list is only as tall as the space between the box and the keyboard (and its accessory bar), so every row can be reached by scrolling the list. The rows look the same.
- **The list always answers what's typed.** A new test types fast ("Meets", then "Meets in New Jersey", then more) and checks that an older query's results are never shown as current: while the newer one is on its way the older list stays dimmed and marked as updating, then is replaced. (#425)

## 2.2.4 — 2026-11-02

A supporters page thanks the people who chip in.

### Highlights
- [home] A new Supporters page thanks everyone who sponsors Control Scout
- [home] Sponsors choose on GitHub to be named or anonymous
- [home] No amounts are ever shown

### Site
- **Supporters page.** /supporters lists the people who sponsor Control Scout on GitHub, as each chose there: public sponsors by their GitHub name and the month they started, private ones as one anonymous count. No amounts or tiers are read or shown. The list comes from GitHub Sponsors and is kept in memory for up to an hour, never stored; until the server has its GitHub token the page says it isn't set up. Linked from /donate, kept out of search engines. The privacy policy has a new Donations section. (#423)

## 2.2.3 — 2026-11-02

A quiet way to chip in, for anyone who wants to.

### Highlights
- [home] A new Donate page explains how to support the site's running costs
- [home] Control Scout stays free: a donation unlocks nothing
- [home] Paying happens on GitHub Sponsors; Control Scout never sees card details

### Site
- **Donate page.** /donate says plainly that Control Scout is free and stays free, that donations only help pay for the domain, hosting and email, that they are not tax-deductible (it is run by an individual developer), and that they unlock no features, perks or priority help. Its one button opens GitHub Sponsors in a new tab, where GitHub and Stripe take the payment; nothing about a donation reaches Control Scout. Linked from the site footer and the foot of Home, nowhere else; /support goes to the same page. (#422)

## 2.2.2 — 2026-11-02

Team and event pages show up seconds sooner on slow venue Wi-Fi.

### Highlights
- [speed] On slow venue Wi-Fi, team and event pages show seconds sooner
- [speed] The page still paints once, in its own fonts, with nothing jumping
- [speed] The rest of the app downloads after the page is up, not alongside it

### Speed
- **Team and event pages no longer wait on the whole stylesheet.** The page the server draws now carries just the styles its own markup uses, inline, and waits only for its text fonts. The app's full stylesheet and its code start downloading once those fonts are here, instead of sharing a slow connection with them. On a 400 kbps line (phone CPU, cold cache) a team page went from 5.4 s to 3.7 s before anything showed in a local production build; the page still paints once, with no layout shift. (#424)

## 2.2.1 — 2026-11-02

Scout's event picker is the Events list, with a Scout button on every card.

### Highlights
- [scout] Pick the event from the Events page's list, with all its filters
- [scout] Every card has its own Scout button; the card still opens the event
- [scout] Your teams' events and the ones you track sit on top as quick picks

### Scout
- **The event picker matches the Events page.** Until an event is picked (and after Change event), Scout shows the Events page's filter bar and its cards by week, any event of the season, past ones too. Each card keeps its link to the event and gets a Scout button under it, which picks the event; the event picked now has a gold ring and Keep scouting. A card says when your team competes there and, once this space has entries there, how many pits and matches are scouted. Above the filters: your teams' upcoming events and the events you track, each one tap from scouting it. The filters stay on the picker (Scout's own address keeps the entry list's), and the season picker switches Scout's season. (#421)

## 2.2.0 — 2026-11-02

You can stop scouting an event.

### Highlights
- [scout] Stop scouting, beside Change event, leaves the event you're scouting
- [scout] Your entries stay, and Undo picks the event back up
- [scout] An open pit entry or typed-in match asks before you leave

### Scout
- **Stop scouting.** The event bar on Scout had only Change event, so there was no way to leave an event without picking another. Stop scouting, next to it, ends this device's session at the event and opens Entries; everything scouted there stays (saved or waiting to sync). The toast's Undo goes back to the same event, watching what you were. A pit entry or a match being typed in on Event day asks first, as Change event does; a match typed in from Entries stays open and still saves at the event it was typed at. On a phone the two buttons sit side by side. Also fixed: with no event picked, Entries showed the sync chip twice. (#420)

## 2.1.9 — 2026-11-02

Five built-in themes, picked in Settings.

### Highlights
- [appearance] New themes: Dim (soft dark grey) and Midnight (true black)
- [appearance] Light, Dark and System are still there, and Dark stays the default
- [appearance] Choose one in Settings → Appearance; nothing else asks you
- [appearance] Every page, chart and the home globe is drawn for each theme

### Appearance
- **Themes.** Settings → Appearance → Theme now lists Light, Dim, Dark, Midnight and System as cards, each with a small preview in its own colours. Choosing one applies at once with no reload, is saved on the device and to your account when you're signed in, and is in place before the page first paints (no flash of another theme). System follows your device's light or dark setting, live. Only colours change: surfaces, text, lines and component colours. The yellow accent, the logo and the layout are the same in every theme.
- **The theme is chosen in Settings only.** The sun and moon button in the top bar is gone, so the app never offers or asks for a theme anywhere else. (#417)

## 2.1.8 — 2026-11-01

A league meet's Teams tab shows what happened at the meet.

### Highlights
- [fixes] A league meet's Teams tab lists that meet's teams and records
- [fixes] The odds tab's "Rank now" at a meet is the meet's rank and record
- [fixes] A league record that doesn't add up is no longer shown

### Events
- **League meets show the meet's own record.** At a league meet FIRST publishes the league's running standing, whose W-L-T counts only each team's best matches: 2025 USNJNOM3 showed Hypnotic Robotics and Bad Wolf both 10-0-0 after 16 matches, when they went 5-1-0 and 2-4-0 at the meet. The Teams tab now lists the teams that played at the meet, with the meet's own rank and record (the Rankings tab already used them), and the odds tab's "Rank now" does the same. Anywhere a league event's W-L-T doesn't add up to the matches played, it is left out rather than shown. Other events are unchanged. (#418)

## 2.1.7 — 2026-11-01

Long lists scroll smoothly on phones.

### Highlights
- [speed] A big event's match list scrolls smoothly, even on a mid-range phone
- [speed] So do long standings tables and a busy team's season
- [speed] Find in page and printing still see every row

### Speed
- **Long lists render only what's on screen.** Match lists (an event's schedule, a team's season), an event's standings and its records tables, once past 60 rows, now draw the rows in view plus a few either side; spacers keep the page its full height, so the scrollbar and Back to where you were behave as before. Short lists are unchanged. Find in page (Ctrl/⌘+F) and printing still get every row, keyboard focus is never dropped, and screen readers still hear the table's full row count. (#416)

## 2.1.6 — 2026-11-01

Bruno's answer on Search shows up as he writes it.

### Highlights
- [speed] Bruno's answer on Search appears word by word, not after a wait
- [speed] Same answer as before, checked the same way before it shows
- [fixes] A dropped connection mid-answer still ends with his answer, once

### Search
- **Bruno's answer streams in.** A question on /search used to show a placeholder until Bruno had written his whole answer; now his sentence and points appear as he writes them and end at exactly the answer he gave before. Every part is checked against the records before it shows (a number still being written waits for its last digit), and a part with a number the records don't have is taken back. If the stream breaks, the page keeps what it showed and fetches the answer the old way, once. Same model call, prompt and cache. (#415)

## 2.1.5 — 2026-11-01

Taps that change something show at once on slow venue Wi-Fi.

### Highlights
- [speed] Assignment Done and Reopen show at once, before the server answers
- [speed] The commons share switch and email digest switch move at once
- [fixes] If the server says no, it goes back and says "Didn't save"

### Speed
- **Changes show before the round trip.** Done and Reopen on an assignment, sharing a pit entry in the scouting commons, and the email digest switch now change on screen the moment you tap, then save in the background and take the server's answer when it comes. If it doesn't save, the screen goes back to what the server has and tells you "Didn't save" and why. Taps on the same thing go to the server in order, and only the newest decides what shows. Scouting entries, your lists, the pick list and notifications already worked this way. Deletes and owner or admin actions still wait for the server. (#413)
## 2.1.4 — 2026-11-01

Real-user speed: the owner can see how fast pages load for real visitors.

### Highlights
- [speed] Real page-load speed, measured on visitors' own devices
- [speed] Only if you allowed usage statistics, never anything that identifies you
- [speed] Measured after the page has loaded, so it never slows it down

### Speed
- **Real-user speed.** Visitors who allowed anonymous usage statistics now also send how fast each page loaded for them (largest paint, response to taps, layout shift, first input delay, server response time) to Control Scout's own server, with the same page path and screen-size group as a page view and nothing else. The measuring code loads after the page has finished loading, so it never slows the page it measures. The owner portal's Usage tab shows them by page next to the API route timings. The privacy page says so. (#412)

## 2.1.3 — 2026-11-01

A lighter install: one unused library gone, and the brand images are WebP.

### Highlights
- [speed] The 404 page's brand mark is a smaller WebP image
- [offline] The offline copy stores the WebP brand images, a little smaller
- [speed] One unused library removed from the app

### Speed
- **Brand images as WebP.** The bare mark (404 page) and the wordmark are now WebP like the rest of the app's images: 19 KB → 14.5 KB and 14 KB → 12.7 KB. The PNG mark stays for the share-card renderer. (#411)
- **One unused library removed.** The command-menu package was left over from the old search box; nothing used it.

## 2.1.2 — 2026-11-01

The Download page says how offline updates work now.

### Highlights
- [offline] The Download page says saved seasons update by themselves
- [offline] On Wi-Fi only, unless you allow mobile data
- [offline] Ask me is still there if you'd rather be asked

### Offline
- **Download page wording.** Its "Updates" note said you were asked once per release; since 2.1.1 saved seasons update by themselves (on Wi-Fi only unless you allow mobile data), and you're only asked if you choose Ask me. (#410)

## 2.1.1 — 2026-11-01

Offline data updates itself on Wi-Fi: no more pop-ups asking you to update it.

### Highlights
- [offline] Saved seasons update by themselves, without asking
- [offline] On mobile data or Data Saver they wait quietly for Wi-Fi
- [offline] Prefer to be asked? Pick "Ask me" in Settings › Offline data

### Offline
- **Updates without asking.** "Download automatically" is now the default for saved seasons' updates, so a newer release downloads in the background instead of showing a pop-up and a notification. Where the browser doesn't say whether it's on Wi-Fi (Safari and every iPhone), it counts as Wi-Fi rather than asking. Known mobile data with "Wi-Fi only", or Data Saver on, waits quietly until the connection allows it. Anyone who chose "Ask me" is still asked. (#409)

## 2.1.0 — 2026-11-01

The row under your pointer in the Teams tables lights up, so one team's numbers are easy to follow.

### Highlights
- [teams] The row you point at glows yellow across the whole table
- [teams] An accent bar marks the row at its left edge, team name column included
- [rankings] Easier to read one team's stats across a wide table

### Tables
- **Row hover.** In the Teams tables (team-events, team seasons, matches) the hovered row gets a clear accent tint instead of a faint grey, and the sticky first column lights up with it (it used to stay dark), with a 3px accent bar at its left edge. Mouse and trackpad only; touch screens are unchanged. (#407)

## 2.0.9 — 2026-11-01

Tables export to Excel in colour, like they look on the site.

### Highlights
- [rankings] Export Excel: every records table downloads as a coloured spreadsheet
- [rankings] Best fifth of the rows in green, worst in red
- [rankings] Each column's header keeps its colour; dates read as dates

### Records tables
- Next to Export CSV, Export Excel downloads the same rows and columns as an .xlsx: each header in its stat's colour (violet totals, sky auto, orange driver-controlled, rose penalties, gold for Control Scout's own), a frozen header and team column, and a filter on every column
- On team tables every number is banded from bold green (best fifth of the exported rows) to bold red (worst fifth), flipped for lower-is-better stats such as rank, penalties and schedule difficulty; match tables colour each score by its alliance
- Event start dates are real dates (no more `#######` in a narrow column) and percentages show as percentages. The CSV is unchanged for scripts (#408)

## 2.0.8 — 2026-11-01

Event pages on phones: bigger tabs that only scroll sideways, a tidier odds box, and no "none yet" lines.

### Highlights
- [home] Event tabs on phones are bigger and only slide sideways
- [home] No scrollbar drawn over the tabs, and no sliding past the ends
- [predict] "Odds for team" box matches the other search boxes
- [home] At a glance hides empty lines and buttons that lead nowhere

### Event page
- **Tabs on phones.** Every tab is a full 44px button. The strip scrolls sideways only (the tabs' touch areas no longer give it room to move up and down), stops at its ends instead of bouncing past them, and no longer draws its scrollbar across the tabs; the faded edge shows there are more. Same tabs component everywhere it's used.
- **Text boxes.** On touch screens a box's hint text is the page's own size (typed text stays 16px so iPhones don't zoom in), so an empty box no longer looks a size bigger than everything around it. The Odds tab's team box now reads "Team number or name" with a search icon, like the other search boxes, and fills the row on phones.
- **At a glance.** A started event with nothing decided yet no longer says "No decided matches with predictions here yet", and "See the match predictions" only shows once there's a schedule to predict. (#404)

## 2.0.7 — 2026-11-01

Matches link to their moment in the event's video again when the stream was left running after the event.

### Highlights
- [live] Match timestamps show for streams cut at the event's end
- [live] Each match jumps to its own moment in the recording
- [live] A video with a real gap mid-event still shows no timestamps

### Live
- **Trimmed recordings get timestamps.** A stream left running for hours after an event, then cut where the event ended, made its video much shorter than its broadcast. That looked the same as a stream that dropped out mid-event, so every match lost its timestamp (Salk League Meet: 10 h 26 min broadcast, 5 h 10 min video). The event's matches now tell the two apart. When the video ends within 15 minutes of the last match's start, and the stream ran on afterwards for longer than all the matches took, the missing time is all after the event and every match keeps its second, on the event page and on each match's own page. A video that loses time during the event still gets no timestamps, so no match lands on the wrong one (#406).

## 2.0.6 — 2026-11-01

On a phone, the Filters button stands out and opening it no longer pops up the keyboard.

### Highlights
- [home] The Filters button on phone lists is the bright yellow one
- [home] Opening Filters shows the filters, not the keyboard
- [fixes] Tap the search box when you want to type
- [fixes] Typing a place in Filters no longer jumps the sheet back to its top

### Navigation
- **Filters on phones.** On Events, Teams, Matches, Rankings and Records the Filters button is the filled accent button and always says "Filters", with the count of filters on beside it. The sheet opens with focus on itself rather than its search box, so the phone keyboard stays down until you tap the box. On Events, the place search inside the sheet keeps one height while you type, so the sheet no longer scrolls back to its top with each letter. (#402)

## 2.0.5 — 2026-11-01

Every finished event on /events shows it is done, even when no matches were posted.

### Highlights
- [fixes] Every finished event card has a full green bar
- [fixes] Events with no results posted say Done instead of no bar or 0/12
- [fixes] Finished events with some results missing still fill their bar

### Fixes
- **Finished bar on every event card.** A finished event with no results posted showed no bar (most scrimmages) or an empty one (0/12), so it didn't read as done next to the others. It now gets a full green bar marked Done. (#398)

## 2.0.4 — 2026-11-01

Search answers "world record score bio buzz" and "4215 high score".

### Highlights
- [rankings] Ask for a season's record score, by game name or season
- [teams] Ask for a team's highest scores, with the alliance it played on
- [fixes] Before a season's first official match, scrimmage bests show

### Search
- "World record score bio buzz", "highest score in 2025-26", "4215 high score" and "hypnotic best score in decode" get a card with the 5 best match scores: without penalties, official events only, each linking to its match with its alliance and the score with penalties (#401)
- A game's name is read with any spacing ("bio buzz", "BIOBUZZ", "into the deep"); with no season named, the latest one played
- With no official match played yet in that season, the card says there's no record yet and lists the best scrimmage scores instead

## 2.0.3 — 2026-11-01

Search waits for you to stop typing, and Enter works the first time.

### Highlights
- [speed] Search waits a second after your last letter before it looks
- [speed] A newer search cancels the older one still on its way
- [fixes] Enter searches at once and closes the phone keyboard

### Search
- Results are asked for once typing pauses for a second, not after every letter, and a request for an older query is cancelled when a newer one starts (#400)
- Enter on the search page runs the search straight away instead of waiting out the pause, and closes the phone keyboard so the results show. Its key reads "Search"
- In a box that picks a team or event, Enter before the results are in opens the top one when they arrive, so one press is enough

## 2.0.2 — 2026-11-01

Compare's brief is spaced out and easier to scan.

### Highlights
- [teams] The brief is grouped: sample and overall, by phase, form and meetings
- [teams] Topics get their own column on wide screens
- [teams] Key numbers in the brief are in bold
- [teams] Source links sit on a quieter line under each sentence

### Compare
- The brief on /compare groups its sentences under three small headings, with a divider and room between each one; the topic (Sample size, Overall, Auto …) is a label column at 640px and up and a heading above the sentence on phones
- Gaps, OPRs, match and event counts and records are bold in each sentence; team numbers, seasons and dates stay plain. The sentences, sources and Copy brief text are unchanged (#405)

## 2.0.1 — 2026-11-01

Compare's head-to-head names each event instead of showing its code.

### Highlights
- [teams] Head-to-head matches on Compare are grouped under the event's name
- [teams] The brief names the event in its head-to-head links too
- [fixes] An event no compared team lists still falls back to its code

### Compare
- The head-to-head list on /compare groups matches under each event's name (from the compared teams' seasons), still linking to the event; it showed codes like USNJNOM5 before
- The brief's head-to-head sources name the match and its event ("Q25 at P1-4 PM Northern League Meet") instead of "USNJNOM5 Q25" (#403)

## 2.0.0 — 2026-11-01

Search answers are easier to read: spaced out, with bullet points.

### Highlights
- [fixes] Bruno AI answers in a sentence, then a bullet per record
- [fixes] Worlds and states rows are divided, each result its own bullet
- [fixes] The "how many times" count shows as a badge in the card title

### Search
- Bruno AI's answer on /search is one sentence, then a short bullet line for each record behind it; every number in the bullets is checked against the records like the sentence (#399)
- The Worlds and states cards on /search put a line between events: the name, then when and where, then rank, record, OPR and awards as bullets. The search dropdown keeps each event to two lines

## 1.9.9 — 2026-11-01

The maintenance pass is written up: what changed, why, and how it was checked.

### Highlights
- [fixes] MAINTENANCE-REPORT.md lists every item of the maintenance pass
- [fixes] Each item says what changed or why not, with its evidence
- [speed] Before and after numbers for every speed check

### Docs
- **Maintenance report.** `MAINTENANCE-REPORT.md`: scope and method, an outcome for every item (A1–N4), speed numbers, the PR list with Greptile scores, what needs an owner decision, and what could not be verified. No app change. (#397)

## 1.9.8 — 2026-11-01

Every page loads a lighter logo: 1.6 KB instead of 14 KB, looking the same.

### Highlights
- [speed] The logo on every page is 88% smaller and looks the same
- [offline] The smaller logo is the one saved for offline use
- [speed] Fonts, search and team pages checked: no wasted downloads found

### Speed
- **Logo.** The app and its first paint showed a 96×96 PNG (14 KB) at 28 px. They now show a 56×56 WebP (1.6 KB): sharp on 2× screens, made from the same artwork by `scripts/favicons.ts`, and precached for offline use instead of the PNG. Emails keep the PNG. (#396)
- **Checked, nothing to change.** Each font file is fetched once per page (the first paint's own font rules reuse the same files); search waits 200 ms after typing and drops stale answers; team and event pages make no duplicate requests.

## 1.9.7 — 2026-11-01

Settings and Download say what they mean, and every saved season shows its version.

### Highlights
- [offline] Each season on Download shows its pack version and which is this season
- [offline] Tap a season's SHA-256 to see the whole hash, on a phone too
- [offline] The offline-ready line says the pack's size and the seasons it covers
- [fixes] Settings names offline predictions and the prediction model plainly

### Settings and Download
- **Settings.** "Lite pack on this device" is now "Offline predictions on this device", and "Prediction engine" is "Prediction model version". (#395)
- **Season packs.** Each season row shows the pack's version beside its release date, and the season in progress carries a "This season" chip.
- **Checking a download.** The SHA-256 shown cut short is now a button: a tap (or hover) shows the full hash. Before, the full hash was only in a hover title.
- **Lite pack.** "Offline predictions are ready" also says the pack's size and its seasons (for example 2023–24 to 2026–27).

## 1.9.6 — 2026-11-01

Search results get a shorter home page summary, and demo teams stop linking to nothing.

### Highlights
- [fixes] Off-season demo teams in match records show without a dead link
- [home] The home page's search summary fits in one search result
- [fixes] The settings page has a fuller description for browsers

### Search engines and accessibility
- **Placeholder teams.** Match records listed "Off-Season Demo Team" entries (99999 and the like) as links to a team page that doesn't exist. They now show as plain numbers with a hover note, on the cards and in the table, the same as event pages. (#394)
- **Descriptions.** The home page's description is 158 characters (was 182, cut off in results) and says the same things. The settings page's (not indexed) is 58 characters, up from 23.
- **Checked, nothing to change.** No image lacks alt text; the old methodology links redirect (301) to /methodology; 300 sitemap pages all answer 200; an unknown team number gives a 404 page that says so.

## 1.9.5 — 2026-11-01

Team pages say more without a mouse: award events, full event names, chart axes.

### Highlights
- [teams] Each award names the event it was won at, right on the chip
- [teams] Long event names wrap to two lines on a phone instead of cutting off
- [teams] The trend chart labels its axes: events oldest to newest, and points
- [live] One red live dot everywhere an event is on now

### Team and event pages
- **Awards.** The event an award was won at shows as a muted second line on its chip, so it reads on a phone (before, it was only in a hover tooltip). (#393)
- **Season Road Map.** An event's name takes up to two lines on a phone before it is cut short; laptops keep one line with the full name on hover.
- **Trends.** The chart's axes are labelled: "Event, oldest to newest" along the bottom and "Points" (or "Percent" for win rate) up the side.
- **Live markers.** The live panel, an event's results line, the Events cards and the tracked-events strip now use one shared red dot with a soft ping (none with reduced motion), instead of three styles.
- **Small fixes.** "Manage this team in Control Point" is underlined and has a 44px tap area on touch screens, and every button shows the pointer cursor on hover.

## 1.9.4 — 2026-11-01

Records on a laptop shows twice the rows before you scroll.

### Highlights
- [rankings] Records shows 12 rows in the first screen of a laptop, up from 6
- [rankings] An event's name and date share one line in the table
- [rankings] More stat columns fit before the table scrolls sideways
- [fixes] A cut-off team name shows in full on hover

### Records and tables
- **Denser on a laptop.** Cells lose their extra padding and an event's name and date sit on one line, so rows go from 61px to 33px tall at 1440×900: 12 rows in the first screen instead of 6, and the table needs about 130px less sideways scrolling. Every column, filter, sort, Select all, Statistics, Filters, preset chip and Export CSV is still there. Phones keep their own sizes (measured the same before and after at 390px), and a touch tablet keeps 44px rows so a tap never ticks the next team.
- **Small fixes.** A team name cut short in the Team column now shows in full on hover, like event names, and a disabled Export CSV (no rows) keeps its icon beside its label.
- **Checked, unchanged.** The last column is fully visible once the table is scrolled to its end; a column header sorts and a second press reverses it; the header follows you down a long table without covering rows; Select all ticks the first 4 (Compare's cap) and says so; a filtered, sorted export holds the same rows in the same order as the screen; scrolling a long table keeps 60 frames a second with no long tasks (#392).

## 1.9.3 — 2026-11-01

Easier to tap on a phone: buttons, links and chips get a full fingertip of room, and a match's call opens its detail on a tap.

### Highlights
- [fixes] Buttons, tabs and icons are easier to tap on a phone
- [predict] Tap a match's call ("Picked Red 58%") to see why
- [fixes] Escape out of search puts you back where you were
- [rankings] Sortable columns show their arrows on a touch screen

### Navigation and interaction
- **Tap areas.** On a touch screen, buttons, tabs, segmented controls, the header icons, footer links, a match row's label and report button, sort headers, team numbers and the compare boxes in tables now take a tap 44px around them, without changing how anything looks or where it sits. Where two controls sit close together (the phone's menu and search buttons, a match's call and its confidence icon, Select all and its sort arrow), the buttons get real room instead, so no tap ever lands on the neighbour (checked by hit-testing every widened area on fourteen pages: none takes a neighbour's tap). Measured on a phone-sized screen: controls with a 44px tap area went from 117 of 1,241 (9%) to 345 of 1,021 (34%; the local data has fewer rows).
- **Tap to see the detail.** A match's call ("Picked Red 58%") and a confidence badge opened their detail only on a mouse hover, so a phone could never show it. A tap now opens it; a tap elsewhere closes it.
- **Sort arrows on touch.** Records and rankings columns showed their sort arrows only on hover; a touch screen now shows them faintly.
- **Escape from search.** Ctrl K (or /) then Escape left the keyboard focus nowhere; it now returns to where you were, from the top-bar field, the phone's search button and a page's own search box.
- **Checked, unchanged.** Enter in the header search opens the full results page and the arrow keys pick one result; deep links like a team's #opr open and expand the section; Back returns to the page before; the current section is marked in the menu on every page; Tab reaches every control on thirteen pages with a visible focus ring and no trap (#391).

## 1.9.2 — 2026-11-01

Records no longer jumps while it loads, a server that doesn't answer is no longer called "you're offline", and a failed search can be tried again.

### Highlights
- [speed] Records keeps its height while loading, so nothing jumps
- [scout] A pit photo that can't load shows "Photo not available"
- [fixes] Server down but you're online? Pages now say the server didn't answer
- [fixes] A search that fails shows a Try again button

### Loading, empty and error states
- **Records loading.** The loading placeholder is now at least a screen tall, like the 50-row table that replaces it, so the footer no longer shows and then drops when the rows arrive.
- **Honest errors.** With the device online but the server not answering, pages said "You're offline". They now say "Can't reach the server" and keep the Try again button; "You're offline" is kept for a device with no network.
- **Search retry.** The search results page showed "Can't reach the server right now" with no way out but retyping; it now has a Try again button that repeats the same search.
- **Broken images.** Pit photos in the scouting commons and the stream thumbnail on an event's watch card hide the browser's broken-image icon: the photo shows a "Photo not available" tile and the stream keeps its play button on the card's own background.
- **Checked, unchanged.** Cold loads of a team and an event page (no flash, no layout shift, at full speed and on a slow 4G line), empty pages (a meet with no schedule, a team with no results this season, no followed teams, an empty shortlist, a search with no matches), fourteen pages with the server cut off mid-visit at both widths (every one shows an error with Try again, or keeps working from data on the device), and the offline venue mode (#389).

## 1.9.1 — 2026-11-01

Folded cards say what's inside, a team's OPR says how fresh it is, and dates read the same everywhere.

### Highlights
- [teams] A team's OPR section says when the stats were last updated
- [teams] Point at OPR, Rating or Top OPR to read what it means
- [predict] Folded cards show a count: 4 robots, 12 matches, 9 commands
- [fixes] Released and "as of" dates read Oct 31, 2026, like event dates

### Detail
- **Stats as of.** The Offensive power rating section ends with "Stats updated 2 h ago" (when the stats were last rebuilt), so an old OPR never reads as live.
- **Terms explained.** The team hero's OPR and Rating labels, and an event's Top OPR, carry a one-line definition on hover or long-press, like Record and Reliability already did.
- **Folded cards advertise themselves.** The robots' ratings under a prediction (with how many robots), a team's earlier matches on Predict (with how many), the bot's command list and an event bundle's rules each say what's inside before you open them.
- **One date format.** Seven stamps (pack release dates, offline "results as of", saved predictions, scouting data) used the browser's 10/31/2026; they now read Oct 31, 2026 like every event date (#388).

## 1.9.0 — 2026-11-01

Entries is one list you can scan, and the pick list keeps your assignments and the latest activity in view.

### Highlights
- [scout] Entries is one list: team, match, event, who and when on each row
- [offline] Each entry says where it stands: Synced, Waiting or On this device
- [picklist] Your assignments and the latest activity sit right under the pick list

### Scout
- **Entries as one list.** The cards are now rows in one filtered list: the team, the match (or Pit), the event, who saved it and when, a line of its answers and its notes, with Edit, history and Delete on the right. On a phone each row is two short lines. Filters, sorting, Recordings and Export CSV are where they were.
- **Sync state on every entry.** Each row says whether that entry has synced, is waiting (offline, or paused by the owner), needs attention, or lives on this device only (Personal without an account).
- **Pick list & planning.** Under the shared pick list: your open assignments with Scout on each, the workspace's latest activity, and the scouting alliance when it's on, each linking to its full view (#386).

## 1.8.9 — 2026-11-01

The pit and match forms are rebuilt: pick the team by name, see where you are in the queue, and always know whether your entry has synced.

### Highlights
- [scout] Pit scouting walks the queue: Pit 8 of 18, then the next team
- [scout] Pick a team by number or name, confirmed by name before you save
- [offline] Save says Saved, Saving…, Queued offline or Sync failed · Retry
- [scout] Match scouting counts each robot's taps and the alliance total

### Scout
- **Pit form.** Opens from the pit queue with "Pit X of Y" and a progress bar, the team's rank, record and OPR beside it, and the rest of the queue next to it on a wide screen (under it on a phone). Saving moves on to the next team in line.
- **One form for a match typed in by hand** (no schedule, a practice match, an assignment's team) and for any entry opened from Entries. The event is never typed any more: a new entry is at the event you picked (or your workspace's default event); an opened entry keeps its own. Team, event and, for a match, which match are required, with the reason shown right at the field.
- **Fields fit their answers.** New field types for templates: Number + unit (the robot's weight in lb) and Yes / no + detail (yes asks "what, and how reliably?"). The built-in pit questions use them; their ids and labels are unchanged.
- **Match form.** On a wide screen the robots you watch sit side by side with one timer; a strip on top counts each robot's taps and each alliance's total (taps only, no points).
- **Save bar.** Stuck to the bottom of the screen on every form, saying where saving stands from the page's real sync state and how many entries wait to sync.
- **Export.** The CSV keeps every column it had, in the same order; each Yes / no + detail question adds a "(details)" column right after its own (#383).

## 1.8.8 — 2026-11-01

Scout is rebuilt around event day: pick your event once, then see what's left to scout, matches and pits side by side.

### Highlights
- [scout] Pick your event once: it stays as the header until you change it
- [scout] Event day shows the match queue and pit queue side by side
- [scout] Progress at a glance: next match, matches and pits done, entries today
- [scout] Sections named for the job: Event day, Entries, Pick list & planning

### Scout
- **One event picker.** With no event picked, the picker is the page: events on today first, then the ones your teams are at, then the rest by date, with a search by name, city or code. Each card says whether your teams compete there, how many pits and matches this space has scouted there, and has one button, Scout this event. The old "Pick an event" button in the top corner is gone.
- **The event stays picked.** Its name, dates, place, match and team counts are the page's header, with the sync state and Change event beside them.
- **Event day.** What you watch (one team, one alliance or all four) is a strip you can change any time, not a setup screen. Under it: the next match, matches scouted, pit scouting and entries today, then the match queue (next match marked, one tap to scout it) and the pit queue (to do and done, the next team first in line), side by side on a wide screen and stacked on a phone. Your own teams at the event show with their rank and next match.
- **Sections.** Scout and Data are now Event day, Entries (the entry list, recordings and Export CSV) and Pick list & planning (the pick list, assignments, alliance, activity and, for admins, the template). Personal has the first two. Old links (?tab=match, ?tab=matches, ?tab=data, ?view=…) open the section they meant (#380).

## 1.8.7 — 2026-11-01

The search results page lines up with every other page.

### Highlights
- [home] Search results start at the same left edge as every other page
- [home] The results column is a little wider on a laptop
- [fixes] Spacing checked across sixteen pages: one gutter, no overlaps

### Spacing
- **Search results page.** It was the one page centred in its own column, its title 190px in from where every other page starts. It now starts at the page's gutter (33px on a laptop, 14px on a phone, measured) and the column is one step wider.
- **Checked, unchanged.** Page side padding on sixteen pages at 1440 and 390 wide, sticky bars on six long pages at three scroll depths (no two bars overlap), filter bars and sheets at phone width, and the footer at the foot of short pages (#387).

## 1.8.6 — 2026-11-01

Long names show in full when you point at them, table numbers line up, and headings follow one order.

### Highlights
- [teams] Cut-off team and event names show their full name on hover
- [rankings] Numbers in every table line up in their columns
- [teams] A team's Sponsors label no longer breaks onto two lines on a phone
- [predict] A prediction's "Why" heading sits in the page's heading order

### Typography
- **Full names on hover.** Seventeen places that cut a long team or event name short (event history, the Last event row, Compare, Records, Home, advancement odds, the event roster and more) now carry the full name as a tooltip.
- **Tabular figures in every table.** Columns of OPR, ranks and scores line up even where a cell didn't ask for it.
- **Headings.** "Why: the top 3 factors" under a prediction was an h3 straight after the page's h1 (axe heading-order); it is an h2 now, same look.
- **One type scale.** The few odd sizes left (9px rank labels, 10.5px and 11.5px on How it works) moved onto the scale's 10px, 11px and 12px steps (#385).
- **Sponsors.** The label keeps to one line; the sponsor names truncate beside it instead.
- **Playoff alliance chips.** Alliance 1 (amber) and 7 (orange) chips were just under 4.5:1 on light (4.48 and 4.45); their text takes the next deeper shade, and a test now checks all eight in both themes.

## 1.8.5 — 2026-11-01

Colours mean one thing each, read clearly in light mode, and the keyboard focus ring shows on white.

### Highlights
- [fixes] The keyboard focus ring is a deep amber on light, easy to see on white
- [live] Live, Upcoming and Finished look the same on every event card
- [fixes] Red scores, recordings and losing playoff alliances pass contrast checks
- [teams] Compare's event-by-event lines each have their own dash and a legend

### Theme and colour
- **Focus ring.** On light the ring was the gold accent, under 2:1 on white; it is now a deep amber that keeps 3:1 at the rings' strength. Dark is unchanged.
- **One status look.** My team's event cards used grey Upcoming/Finished badges while the Events page used blue and green chips; both now use the same chips. The live stream marker and Live standings use the danger red token instead of a raw red.
- **Video red is a token.** Has a recording, Clips, a match's Watch chip and the play button share one video red, deeper on light so small text reads at 4.5:1.
- **Contrast.** A winning red alliance's score on its tint (4.4:1 on dark) and a series loser's faded chip in the bracket (2.8–3.5:1 on light) now pass 4.5:1. Eliminated alliances and skipped series show a dashed outline instead of fading.
- **Charts and links.** Compare's trend lines are solid, dashed, dotted and dash-dot with a legend, so they read without colour. Links in running text you've opened before (gold links, Power rankings' notes, How it works and the legal pages) read a step quieter. Scrollbars use the theme's colours in Firefox too (#384).

## 1.8.4 — 2026-11-01

Search answers more questions, and a question on the results page gets a short written answer from Bruno AI.

### Highlights
- [teams] Bruno AI answers questions on the search page from our own records
- [teams] "How many times did 4215 go to states" lists each one, with a count
- [teams] Worlds and states answers show the OPR at each event

### Search
- **Bruno AI answers questions on /search.** A search that reads as a question ("how many times did 4215 go to states", "when did 23268 go to worlds and what was their opr then") gets 1 to 3 sentences from Bruno AI above the results. He writes only from the records search found for it (the answer card's events with dates, ranks, records and OPRs, the top results, the team's latest season), sent to Control Point's new `/internal/bruno/search-answer`. Any answer naming a number that isn't in those records is dropped, so a made-up stat never shows. A name or a number alone never asks him. It's asked after the results are on screen, so they never wait on it, and each question is cached for 6 hours. The answer is labelled as his and points to the records below it. Owner toggle: **Bruno answers on /search** (`brunoAnswers`, on). Off, unconfigured, slow or failing: no box, and search is unchanged. (#381)
- **State championships.** "How many times did 4215 go to states", "did bad wolf make states in 2025" and "… state championship" questions list each region championship the team played (its division, rank, record, OPR and awards), with the count in the card's header. None found, or none in the year asked, is said plainly with the closest real records.
- **OPR at each event.** Worlds and state championship lines now include the team's OPR there.

## 1.8.3 — 2026-11-01

What's new stays in view at the foot of the sidebar, and Settings has one place.

### Highlights
- [home] What's new sits right above Sign in, always in view
- [home] Settings is the gear beside Sign in, no longer a second row under More
- [home] The phone's menu puts What's new just above your account too

### Navigation
- **What's new** moved out of the folded More group to the foot of the sidebar, beside the fold button and right above Sign in, so a new release's dot shows without opening More. On the icon rail and in the phone's menu it sits just above the account controls too.
- **Settings** is the gear beside Sign in (or your name) only; the duplicate Settings row under More is gone. (#382)

## 1.8.2 — 2026-11-01

A scouting alliance can now link more than two teams at a meet.

### Highlights
- [scout] Link three, four or more teams for shared scouting at one meet
- [scout] One invite code or link lets every team join; each team is listed
- [scout] Coverage shows one card per team, each in its own colour
- [scout] Any team can leave; the team that started it can remove one

### Scouting alliances
- **Any number of teams.** The team that starts an alliance gets an invite code and a link (Copy link). Any team's admin joins with either, until the code runs out (7 days, or the event's end) or the starter makes a new one. Up to 8 teams. The same rules hold for every team in it: everyone reads everyone's entries and assignments at that event and shares one consensus, nobody joins another team, each team's entries stay editable only in its own workspace, and it ends by itself after the event.
- **Each team listed, in its colour.** The alliance card lists every team (you, and who started it). Coverage has one card per team in that team's colour, and the per-team bars split by team. The pick list toggle has a View button for each other team.
- **Leaving and removing.** Any team's admin can leave: the others carry on while at least two are left, and the team that leaves keeps a copy of the others' entries (and they of its), if both agreed. The team that started it can remove a team (it keeps no copies, and can't come back with the same code) or end it for everyone. If the starter leaves, the team that joined next takes over.
- **Copies.** When it ends, each two teams that both ticked "keep a copy" get each other's entries; a team that didn't tick it neither gives nor gets copies.
- Existing two-team links carry over unchanged (migration 68) (#379).

## 1.8.1 — 2026-11-01

Add teams to your shortlist right from the Shortlist page.

### Highlights
- [picklist] Type a team number or name on the Shortlist and press Add team
- [picklist] Suggestions appear as you type; teams already listed show Added
- [picklist] An empty Shortlist offers the same box to make your first pick

### Shortlist
- **Add team.** A search box beside Order picks and CSV suggests teams as you type (the site's own team search). Pick one, or type an exact number and press Enter or Add team, and it joins the end of your list: synced to your account when signed in, saved on this device when not. A team already on the list shows as Added and is never added twice. It works with the keyboard (arrow keys, Enter, Escape) and at phone width, and the empty Shortlist offers it too (#378).

## 1.8.0 — 2026-11-01

The owner portal's Slowest routes shows routes that are really slow, not live connections left open for hours.

### Highlights
- [fixes] Slowest routes no longer lists live streams that stayed open for hours
- [speed] Live streams count how long they took to open, like any request
- [workspace] Workspace live streams now show in Busiest routes too

### Owner portal
- **Live streams are timed to the moment they open.** The notification inbox, advancement odds and workspace live streams stay open as long as their page does, so timing them until they closed put hours-long "latencies" at the top of Slowest routes. They now count how long they took to open. Errors are unchanged: a reader leaving was never one, and a stream refused before it opens (as when live updates are switched off) still is. The workspace stream, left out before, is counted the same way. Stream rows counted the old way are cleared once, so the last 14 days aren't skewed by them. (#377)

## 1.7.9 — 2026-11-01

Every search result shows where it goes, and a link to a team's OPR or ranking opens right on it.

### Highlights
- [teams] Search results show their address: controlscout.org/teams/4215#opr
- [teams] Links to a team's OPR, ranking or difficulty open that part, unfolded
- [teams] Team pages name the team, its record and OPR for search engines
- [rankings] Event pages list their standings before the app has even loaded

### Search
- **Where a result goes.** Under each result, in the dropdown and on the results page, its full address: "controlscout.org/teams/4215#opr", "controlscout.org/compare?teams=4215,6980".
- **Deep links.** A stat search opens the team page at its own part: #opr (Offensive power rating), #ranking and #history (the season road map: ranks, records, ranking scores), #schedule-difficulty, #awards and #matches. A folded section opens when its link lands on it. No new addresses: every link is a page that already existed.

### Team and event pages
- **Titles.** Team pages are titled "4215 Hypnotic Robotics | FTC Team Stats, OPR & Rankings | Control Scout", with a description from the team's real record, OPR and OPR rank.
- **Event standings in the page itself.** An event page's first load lists its standings (rank, team, record, ranking score and OPR, each team a link), so a visitor or a search engine reads them before the app starts.

### Behind the scenes
- The results page asks search engines not to list it ("noindex, follow"): its links still lead them to the team and event pages. robots.txt now lets crawlers read it; /api stays out.
- The sitemap lists a team only once it has played at an event (a team that has only signed up has no numbers yet), and no longer lists Compare, which is empty until teams are picked (#376).

## 1.7.8 — 2026-10-31

Press Enter for every result, and ask search a question: when a team went to Worlds, what it won, when it plays next.

### Highlights
- [teams] Enter opens "Here's what we found": every result for your search
- [history] "when did hypnotic go to worlds" answers from its event history
- [teams] "what events did hypnotic win", "has bad wolf won anything" answered
- [teams] Names typed without spaces still find the team
- [speed] The home globe holds still while you type, so typing stays smooth

### Search
- **Enter goes to the full results.** With nothing highlighted, Enter opens /search for what you typed; the arrow keys or the pointer pick a row, and Enter opens that row. Every list ends with "See all results for …", which goes to the same page, and a search that finds nothing shows a hint and that row, never "Nothing matches" alone.
- **Here's what we found.** The results page says what the search was read as ("Showing: Hypnotic Robotics (4215) vs Bad Wolf (6980) — Compare"), puts a question's answer at the top, then teams, events, matches and pages. Its address is the search, so Back and sharing work.
- **Questions.** "when did hypnotic robotics go to worlds" lists the team's FIRST Championship appearances (division, rank, record, awards); a year or team with none says so plainly and shows the closest real results (its other trips, or its state championship). "what events did hypnotic win", "has bad wolf won anything", and "when is hypnotic's next event" or "next match" answer from the stored events, awards and schedule; nothing is made up when none is published.
- **Names.** Words typed together match a name's words side by side; "hypnotics" still finds Hypnotic Robotics. "hypnotic vs bad wolf awards" opens Compare on its events and awards. A name that only matches a team that never played (a test sign-up) counts as not found, so versus never opens a Compare with it.
- **Typing.** The last results stay on screen, dimmed, while the next ones load, instead of the list emptying at every key.

### Home
- The globe stops turning while a search box has focus: each turn redrew every country, which slowed typing on phones (#374).

## 1.7.7 — 2026-10-31

Team and event pages open as the finished page: no half-loaded screen, no sections jumping in.

### Highlights
- [speed] Team and event pages open whole, straight from a search result
- [speed] No more flash of plain text, then grey blocks, then the page
- [speed] Nothing jumps as the page loads, and text never changes font

### Loading
- **The first paint is the page.** A team page's first response from the server now carries the page itself, drawn by the same component the app uses: the header, At a glance (rank, OPR, rating, record), OPR by phase, the Season Road Map, awards and the season's matches. An event page's carries its header, rankings, matches and result changes. Before, the first paint was a short text summary, which the app then replaced with grey loading blocks while it asked for the data, and then with the page: three different screens in the first second (ten seconds on a slow phone connection).
- **The app picks up where the page is.** The answers the page was drawn from come with it, so the app starts from them: no loading state, and no second request for the team, its matches, the event or the site's season list. The season picker no longer grows from one season to four once that list arrives.
- **Styled from the first frame.** These pages wait for the stylesheet and the app's fonts before they paint, so text never shows in a stand-in font and then reflows. The app's code downloads meanwhile, at low priority.
- **Search engines see the page.** The same HTML is what crawlers read: the full team or event page, not a header-only summary.
- On a phone, the bottom tab bar of the first paint stays on top of the page (#375).

## 1.7.6 — 2026-10-31

Setting up Scout takes fewer taps and no hunting for the next step.

### Highlights

- [scout] Two tabs, Scout and Data: the match list lives inside Scout
- [scout] One event picker: search on top, today's events under it
- [scout] Picking an event folds the list and moves you to the next step
- [scout] Start scouting stays in reach at the bottom of the screen

### Scout

- **Scout and Data.** Match and Matches were one job split in two, so they are one Scout tab now. It opens on the match to scout, as Match did; "All matches" shows the event's match list in its place (wide screens still show it beside the match) and tapping a match goes back to scouting it. Old links to the Matches tab open the list. (#373)
- **One event picker.** "Where are you scouting?" is a search box with a short list under it (today's events first, then your team's, then the next ones; Show more for the rest), instead of a list and a separate "Search all events" box.
- **Moved on after a pick.** Picking an event folds the list to one "Scouting at … · Change" row and brings what you're watching into view (no glide if you asked for reduced motion). A suggested or running event starts folded.
- **Start in reach.** Once an event is picked, Start scouting is pinned at the bottom of the screen (above the tab bar on phones), bigger, and says what it will start ("Red alliance at …").

## 1.7.5 — 2026-10-31

The event-day bundle page now opens on the schedule, with plain times and nothing to decode.

### Highlights
- [offline] An event's bundle opens on its schedule: every match, or one team's
- [offline] Pick a team right on the page to see just its matches
- [offline] Times read 7:23 PM, with a short zone (PT) next to them
- [picklist] The pick list shows its top teams, or stays out of the way when empty

### Event-day bundle
- **Schedule first.** Below the event name: when the data was saved (one line), Open the event and Rankings, then the schedule from the bundle. With no team set it lists every match; a team picker (the event's own teams, works offline) narrows it to one team's matches, the next one marked. No more empty "Your matches" card asking you to pick a team.
- **12-hour times.** "Saved 7:23 PM", match times "11:58 AM", and frozen match reports and pick lists say their time the same way. The raw zone name ("America/Los_Angeles") is gone; a short "Times in PT" sits by the times instead.
- **Pick list, plainly.** "Your team's pick list", whose it is, how many teams and when it was saved, with the top five listed. An empty list, or none, shows no card.
- **Rules reference closed.** The game rules reference is a closed section at the bottom and only loads when opened.
- **Every match opens.** Each row opens Know your match. With no signal, a match whose report isn't saved in the bundle offers the match on the event page, which answers from the bundle.
- **Less to read.** The separate Event card and the long stale-data notice are gone; an old snapshot says "check live data first" in the same line (#372).

## 1.7.4 — 2026-10-31

Scout once for all your teams: an admin of several team workspaces has every entry they save kept in each of them.

### Highlights
- [workspace] Admin of several teams? Each entry you save goes to all of them
- [scout] After Save, a line names every team it goes to
- [workspace] Edit it in any of those teams and the others follow

### Scouting
- **Saved in every team you run.** When you're an admin of more than one team workspace, each match or pit entry you save in one of them is also saved in the others, every time. Each team gets its own copy, made by you, in its history and activity feed, and its members can edit it like any of their entries. It happens on the server when the entry syncs, so an entry saved with no signal is copied once it goes up.
- **Edits follow, deletes don't.** Changing your entry, in any of those teams, changes it in the others too. A teammate's change stays in their own team. Deleting it in one team leaves the others' copies alone, and a copy a team deleted stays deleted.
- **Each team's own questions.** Answers go to the questions the other team asks with the same field; anything it doesn't ask, or that doesn't fit its version of the question, is left out there. Notes are copied as they are; photos stay with the entry they were added to.
- **Only where you're an admin.** Entries saved in Personal, in a team where you're a member, or that a teammate made, stay where they are. A team whose scouting is paused or that's read-only gets nothing. (#371)

## 1.7.3 — 2026-10-31

The Scout page's Data tab is sorted into a few large cards instead of one long list, so it's clear where to look.

### Highlights
- [scout] Data tab: big cards in three groups, your data first
- [scout] Each card says one live count, like entries this season
- [scout] Nothing scouted yet? The card says so, with a Start scouting button

### Scout
- **Grouped cards.** The Data tab's nine rows are now three groups. "Your data" holds Entries, Pit scouting and Match recordings; "Team planning" (workspaces only) holds Pick list, Assignments and Scouting alliance. Entries and Pick list are the wide cards, first in their group. On a phone the wide card fills the row and the others sit two to a row.
- **One fact per card.** Each card shows a count it already has: entries in the season, pit progress at the session's event (or robots written up), videos on this device, and assignments open for you.
- **Empty says what to do.** A card with nothing in it yet says how to start rather than showing 0, and the empty Entries card has a Start scouting button that opens the Match tab. A read-only workspace shows no button.
- **Manage, kept quiet.** Activity, Template (admins) and Export CSV are plain buttons at the bottom. Export CSV still carries the entry list's filters. Every view the old list opened is still there (#370).

## 1.7.2 — 2026-10-31

Watch livestream plays on the event page again for events whose stream is a short link, such as Washington's ftcwa.live links.

### Highlights
- [live] Watch livestream plays on the page for short stream links too
- [live] Live predictions sit beside those streams, like any other
- [live] Each league meet keeps its own broadcast, even on a shared link

### Live
- **Short links followed.** Some regions give FIRST a short link for their stream (ftcwa.live/bardeen) that redirects to the meet's YouTube broadcast. The event page only recognised direct YouTube links, so Watch livestream opened YouTube in a new tab. The server now follows those links on the event's own dates (at the venue) and keeps the video they lead to. The page then plays it in Watch live with the live predictions beside it, and matches get their place in the recording. Each link is checked again every 15 minutes while it leads to a video, in case the broadcast restarts; a check that fails keeps the video found before. Only redirects are followed, never a page's content, and only to public addresses (#369).
- **Each meet keeps its own video.** A league reuses one short link for every meet, pointing it at the new broadcast each time. The video is kept per event, so last month's meet still plays last month's broadcast, and a meet the next day never takes the one before's broadcast while the link still points at it.

## 1.7.1 — 2026-10-31

Closed sections on team pages now show there's more inside.

### Highlights

- [teams] Closed team sections are cards with a line on what's inside
- [teams] A "Show details" button that turns to "Hide" once open
- [teams] Each card has a faint gradient in its own colours

### Team pages

- A closed section shows its one-line summary and a pill button in its own colours (green to orange for Reliability, yellow, blue and purple for the report card, blue to red for Schedule difficulty) instead of a small grey "Show" at the edge of the row. Screen readers hear the section name as the button and the summary as its description. (#368)

## 1.7.0 — 2026-10-31

Search reads the whole question: compare teams, ask about a season or a state, and it says plainly what it can't answer yet.

### Highlights
- [teams] "hypnotic vs bad wolf" opens Compare, now with awards side by side
- [rankings] "4215 ranking last season in New Jersey" shows its place there
- [teams] Typos get a "Showing results for" line; nothing found offers a way on
- [teams] Asks for something not tracked yet? Search says so, never guesses
- [speed] Results update as you type; arrow keys, Enter and Escape all work

### Search
- **One answer everywhere.** The search box, the /search page and the address-bar search give the same answer from one place on the server. A team number ("4215", "team 4215", "#4215") is that team alone; a number with no team says so.
- **Versus.** "hypnotic versus bad wolf" (or vs, against; up to four teams) opens Compare for those teams. A side that names no team never gives a half-empty Compare: you get the teams found and a note.
- **Seasons, states and rankings.** "4215 ranking at last year's DECODE season, state of New Jersey" opens 4215's 2025–26 page and New Jersey's 2025–26 rankings, with its place there (#8 of 193). Game names, "last season" and "this season" are read as seasons.
- **What isn't there yet.** Asking for something Control Scout doesn't track (a reputation score, robot specs, team members, budgets, social media) shows the closest real result and a plain note on what's missing. Nothing is made up: there is no reputation score, so none is shown.
- **Never a dead end.** A typo shows "Showing results for …"; a query that matches nothing says what was understood, lists the closest matches and links to every team and event. Site pages a word names ("records", "rules") are listed below the results.
- **More questions.** "hypnotic opr" lists every event's OPR; "hypnotic opr at East Bergen" opens the event on the team; "… at this event" lets you pick the event instead of guessing; "hypnotic schedule difficulty" opens that section with the team's numbers; "hypnotic 2025-26" opens that season.
- **Typing.** Results follow as you type, an older answer never replaces a newer one, Escape closes the list and keeps your place, and Enter opens the highlighted result.

### Compare
- **Events and awards.** Each team's events (rank and OPR at each) and awards for the season, side by side.

### Behind the scenes
- Search can learn which results people open for a query (aggregate counts per season, nothing about who), only to re-order what it already found. An exact match always stays first.
- Search counts the kinds of question people ask (for example "[team] robot specs"), with no query text, to show what to build next. The owner console reads the list.
- Bruno AI can suggest a better reading of a query that found nothing. It's off until the owner turns it on, and it never supplies a number (#367).

## 1.6.9 — 2026-10-31

Search understands what you're asking about a team or event: "hypnotic awards" or "4215 ranking points" finds the team and answers with its numbers.

### Highlights
- [teams] Ask search about a team: "4215 awards", "hypnotic opr"
- [teams] The top team answers with its own numbers right in the results
- [teams] Results open on what you asked about: awards, events, odds
- [fixes] Misspelled stat words still find the answer

### Search
- **Ask about something.** Add a topic to a team or event: awards, matches, ranking points, OPR, record, stats, rankings, odds or playoffs ("hypnotic awards", "4215 ranking points", "new jersey championship odds"). Before, any extra word made the search come back empty.
- **Numbers in the answer.** The top team shows the numbers asked about, from its newest season: ranking score and rank at its latest event, OPR and OPR rank, record and win rate, awards and the latest one, matches and average score. A number that isn't stored is left out, never estimated.
- **Opens in the right place.** A team opens at its awards, season road map or matches; an event opens on that tab (rankings, awards, odds, playoffs, matches).
- **Typos.** A misspelled topic word is forgiven when the query would otherwise find nothing, and words like "team" no longer stop a search ("violet fusion team").
- The same answers in the search box at the top and on the address-bar search page. A plain name, number or match query ("AUSYQ1 Q12") works exactly as before, and a team whose own name has the word ("Match Point") still comes first (#366).

## 1.6.8 — 2026-10-31

Search Control Scout straight from the browser's address bar: type controlscout.org, press Tab, then a team number or name.

### Highlights
- [home] Search Control Scout from the address bar in Chrome and Edge
- [home] A search results page: teams, events and matches for any query
- [home] Results show on first load, signed in or not

### Address-bar search
- **Press Tab to search.** After one visit, typing controlscout.org in Chrome or Edge's address bar offers "Search Control Scout"; press Tab and type a team number, team name, event or match. Firefox can add Control Scout as a search engine from the same description (`/opensearch.xml`).
- **A results page.** The search lands on `/search?q=…`, which lists the same teams, events and matches as the search box at the top, grouped the same way, with a field to change the query. The results are in the page's first load, so they show straight away, signed in or not.
- The search box at the top works exactly as before (#364).

## 1.6.7 — 2026-10-31

Team pages open faster: Reliability, the prediction report card and schedule difficulty start closed and load when opened, and the event list is now titled Season Road Map.

### Highlights
- [speed] Team pages load less up front: three detail sections open on a tap
- [teams] Reliability, report card and schedule difficulty start closed
- [teams] One event list, titled Season Road Map, newest first

### Team pages
- **Closed until opened.** Reliability, the prediction report card and schedule difficulty each start as a single header with a chevron and "Show". Tap or click it (or press Enter or Space) to open it, and again to close it. A link to `#reliability`, `#report-card` or `#schedule-difficulty` opens that section.
- **Loaded when opened.** The report card and schedule difficulty are asked for the first time a section opens, with a loading placeholder until they arrive. They stay loaded after that, so closing and reopening doesn't ask again. The team's own answer no longer carries them, so the page's first load does less work. Every number is the same as before.
- **One event list.** The separate road map section is gone: it showed the same events as the event history in the other order. The event history keeps its place, cards and matches, newest first, under the heading Season Road Map (#365).

## 1.6.6 — 2026-10-31

A played match's score breakdown now compares red and blue at a glance, and every bonus RP has its own icon.

### Highlights
- [live] Match breakdowns: red and blue bars side by side on one scale
- [live] Who won each phase, and by how much, on every row
- [live] Bonus RPs with their own icons, marked earned or missed

### Match breakdown
- **One glance per row.** Auto, TeleOp, endgame, no-penalty points, fouls and the total each show red's bar above blue's, on the same baseline and scale, with both scores beside them. A chip names the leader and the gap ("Red +33", or "Even"); for fouls it says who gave away more.
- **Icons with labels.** Each row has its own icon next to its name, and so does each part of FIRST's full score sheet (leave, park, hive, flower, garden, major and minor fouls).
- **Bonus RPs.** Swarm, Pollinator 1 and Pollinator 2 (and last season's Movement, Goal and Pattern) each have their own original icon. Earned or missed is shown three ways: a solid or dashed outline, a ✓ or ✗ mark, and the word, so it reads without colour.
- Display only: every score, OPR, RP and prediction is the same as before, and the margin line still closes the breakdown (#363).

## 1.6.5 — 2026-10-31

Team pages now show a season road map: every event in date order, how the team is advancing, and what its next stop takes.

### Highlights
- [teams] A season road map on team pages: every event and its advancement
- [teams] NJ, Michigan and Iowa teams see a points target for their next stop
- [teams] FIRST's official advancement points earned at each event

### Season road map
- **Every event, in order.** Each event the team is on, registered events included, with its rank, record, awards, alliance and FIRST's advancement result (advanced, didn't take a slot, still to come) (#360).
- **What's needed next.** Where Control Scout has encoded the region's 2026–27 rules (New Jersey, Michigan, Iowa), a panel names the next stop and what last season's last team in scored there. It also lists which finishes reach that on their own and, for league teams, how many meet matches count toward the league tournament. Every encoded ruleset shows its sources and season.
- **Official points.** FIRST's own advancement points for each event, split into awards, playoffs, alliance and qualification, beside the lowest total that took a slot.
- **Other regions.** Results so far and what's next, with no points target until the region's rules are encoded.

## 1.6.4 — 2026-10-31

One tap before you leave for the venue saves the whole event on your phone: the schedule, rankings, your match reports and your pick list, each saying what time it's from (#361).

### Highlights
- [offline] Event-day bundle: one small download per event, its size on the button
- [report] Your matches' Know your match reports, frozen for when there's no signal
- [picklist] Your pick list too, clearly marked "Snapshot from 07:12, may be stale"
- [offline] No signal? The event page answers from it; live wins again

### Event-day bundle
- **One tap, one download.** The Download page builds a bundle for your event (your team's events and the ones you track are offered; every upcoming event page has an Event-day bundle button): the event's teams, schedule, rankings and predictions, the event teams' ratings so predictions still run on the phone, a Know your match report for each of your team's matches, your workspace's pick list (members only), the season's question-box rules reference and a venue card with the address and dates. A typical event is 15 to 35 KB (#361).
- **Honest about its age.** Everything from a bundle says what time its data is from and how old it is, and past two hours it tells you to check the live version first. The snapshots print their time inside too.
- **Live first.** A bundle is only used with no signal (or no answer in 4 seconds); the moment the server answers, the live page takes over, as with saved seasons.
- **Kept tidy.** One bundle per event on the device. The Download page shows each one's data time, offers Update and Update all when newer data is out, and removes finished events' bundles in one tap.
- **Owner switch.** The owner console's Features tab has an Event-day bundles toggle; off (or with offline packs paused) the builder hides and new bundles are refused, while bundles already on a phone keep working.

## 1.6.3 — 2026-10-31

Every event's rankings get a Schedule column: how strong each team's opponents and partners are next to the rest of the field.

### Highlights
- [rankings] A Schedule column in every event's rankings: how hard each draw is
- [teams] Team pages show how hard their draw is at each event
- [rankings] Model vs field folds into one line until you open it
- [offline] Saved season packs carry it too

### Schedule difficulty
- **A Schedule column in the rankings.** Each team's opponents' average rating over the field's, minus its partners', next to its record: red for a hard draw, green for a kind one. Tap a value for it in words, for example "3rd-hardest of 24. Opponents average +38 over the field's, partners −12." Sort and filter on it like any column; "Sched. left", "Opp. vs field" and "Partners vs field" are in the column picker.
- **Before and during the event.** Before the first match it covers the whole schedule. Once quals are under way, the live standings add "Sched. left" for the matches still to play. Team pages show the team's draw at each event.
- **Every team rated.** Teams with no result yet this season start from last season's rating, as everywhere else on the site.
- **It matters.** Across the 2023–2025 seasons, a schedule one step harder than average cost a team about 2 places in the final ranking against its rating (docs/schedule-difficulty.md) (#357).
- **Offline and for other features.** Season packs carry it as a team stat, and the event and team API answers include it.
- **Tidier Rankings tab.** Model vs field starts folded to one line with its count of gaps; tap it to open. On a phone, the standings table shows team numbers only, and a tap on a number gives the name and a link to the team page.
- **An owner switch.** The owner console's Features tab has a Schedule difficulty toggle: off hides it on event and team pages and leaves it out of the event and team answers.

## 1.6.2 — 2026-10-31

Two teams can now scout one event together: link workspaces, share the scouting, and split again when it ends.

### Highlights
- [workspace] Scouting alliances: share your scouting with another team for one meet
- [scout] Both teams see each other's entries and share one consensus
- [picklist] Pick lists stay your own, with a switch to view your partner's
- [workspace] Coverage shows what each side added, side by side

### Scouting alliances
- **Invite and accept.** A workspace admin picks an event and gets a one-time code; the other team's admin enters it to link. It's a link for that meet only: nobody joins the other team. Either admin can unlink at any time. Find it under Scout, Data, Scouting alliance (#353).
- **One event, shared.** While linked, every member of both workspaces sees both sides' entries and assignments at that event, and one consensus built from all of them. Nothing from other events is shared.
- **Your entries stay yours.** Each entry stays in its own workspace and only that workspace can edit it; the partner's admins can't change or delete it.
- **Coverage.** Each side's entries, teams, matches and scouts, with a per-team split. A side that hasn't added anything shows zeros rather than disappearing.
- **When the event ends** the link ends by itself. Each workspace keeps its own entries, and if both admins ticked "keep a copy" when linking, each also keeps a copy of the other side's entries.

## 1.6.1 — 2026-10-31

A light version of the pages you open at a venue, for when the signal is down to one bar.

### Highlights
- [speed] Light, text-only event, team, match and pick list pages
- [speed] Offered by itself when a page crawls, and from every page's footer
- [speed] One tap back to the full version, always

### Light version
- **Text first.** `/lite/…` pages are plain server-rendered HTML: no images, no charts (tables instead), no scripts, the device's own fonts. An event's rankings and whole schedule, a team's next matches, latest results and events, a match's lineup, score sheet and call, and your workspace's pick list (read-only, members only, as in the full app) (#358).
- **Getting there.** "Light version" in the footer of those pages; add `?lite=1` to any of their addresses; while the app's code is still loading after 10 seconds the first paint offers it; and when a page's data hasn't arrived after 8 seconds, or three requests fail within a minute while you're online, a small card asks. "Not now" keeps it away for the rest of the visit.
- **Never stuck.** Every light page has a Full version button at the top right. With no signal at all, the offline pack still takes over as before (a light page's address opens its full page from the saved app).
- **Same numbers.** Both versions format numbers, dates and win odds with the same helpers, and predictions keep their confidence words.
- **Owner switch.** The owner console's Features tab can turn the light version off; its addresses then open the full pages.

## 1.6.0 — 2026-10-31

Every prediction now opens up into its full why: each factor behind the call, with how much of it that factor carries.

### Highlights
- [predict] A full why breakdown under every prediction, with each factor's share
- [predict] Form, momentum, reliability and more, next to the game phases
- [report] After a match, see which factors pointed to the winner

### Predictions
- **Full why breakdown.** Below the top 3 reasons in the Lab, on the match page and in Know your match, an expander lists every factor behind the call with its share: the four game phases (auto, TeleOp, endgame, penalties), then what else the win model weighs (form, momentum, reliability, partner balance, experience and rest, and how sure the data is). The shares add up to 100%.
- **At a glance.** A red-vs-blue bar shows how much of the call leans each way. Every factor has its own icon, and on a wide screen the breakdown spans the whole result, with the game phases beside the rest.
- **Reasons that don't move the odds** are listed at 0%: these robots' history together or against each other, and schedule strength (ratings already account for every partner and opponent faced).
- **Post-match review.** Each call logged before a match now keeps its breakdown. Once the match is played, every factor that leaned one way says whether it pointed to the winner, with how much of the call those factors carried.
- Works offline too: a prediction made on your device from the lite pack shows the same breakdown.
- Engine 3.3.0: the breakdown only. Win odds and scores are unchanged (#355).

## 1.5.9 — 2026-10-31

My teams cards fold away: tap a team's number and name to hide the rest of its card.

### Highlights

- [teams] Tap a team on My teams to fold its card down to the header
- [teams] Folded teams stay folded on this device, each one separately
- [speed] A folded team skips loading its matches until you open it

### Teams

- My teams: each team's number and name is now a button that folds its card to the header (number, name, workspace, season, Full team page) and opens it again, with a chevron that turns; remembered per team on this device (#362)

## 1.5.8 — 2026-10-31

The Playoffs tab now predicts the bracket: a call for every series, each alliance's odds of winning the event, and the match most likely to knock it out.

### Highlights
- [predict] Championship odds for every alliance once alliances are posted
- [predict] Every playoff series shows its favourite and how likely it is to win
- [predict] A danger match per alliance: the series it's most likely to lose
- [live] The odds update after every playoff result

### Playoffs
- **Bracket predictor.** Each series card names the favourite and its chance, with the series score for best-of-3s. A series whose alliances aren't known yet shows who's likely to fill each side. Each alliance shows its odds of winning the event and reaching the final, and its danger match. Every number comes from the engine's own playoff-match predictions, run through the event's real bracket and the results posted so far (#356).
- **Any format.** 2-alliance finals, 2023–24 semifinals and finals, and 4-, 6- and 8-alliance double-elimination brackets, read from what the event posted. For a format we can't map, each series still gets its own call.
- **Measured.** Replayed on 10,598 past playoff series with only what was known before each one, the favourite won 77.9% (the higher seed: 71.7%), Brier 0.151, and the championship odds come out calibrated (docs/bracket-predictor.md).
- **Clean states.** Before alliance selection, the tab says so. With alliances posted but no playoff schedule yet, a banner says the odds come from the alliances alone.

## 1.5.7 — 2026-10-31

A rules quick reference for the question box: the most-cited BIOBUZZ rules and Q&A rulings, searchable with no signal.

### Highlights
- [offline] Rules quick reference: search BIOBUZZ rules, even offline
- [live] Penalties at a glance: minor, major and card for each rule
- [report] Q&A rulings summarised next to the rules they answer

### Rules quick reference
- **New page: Rules.** In the menu under More, and a Rules button on every BIOBUZZ event page. The owner can switch it off (Features › Rules quick reference). It summarises 79 of the most-cited rules in our own words, grouped by manual section: fouls and cards, pre-match, AUTO, scoring elements, robot and opponent contact, humans, robot construction, and the question box itself.
- **Search that works offline.** Type a rule number (G421, g 421, G-421) or a word (pin, opponent nectar, question box); it runs in the browser over the copy built into the app, so it answers at a venue with no signal.
- **Q&A rulings, labelled unofficial guidance.** 23 answered Q&A questions, summarised, each linked from the rules it is about.
- **Stamped and honest.** The page names the manual revision and date it follows and says plainly that these are unofficial summaries, with links to the official manual and Q&A (#354).

## 1.5.6 — 2026-10-30

Something wrong in the scouting commons? Report it, or mute a workspace you don't want to see.

### Highlights
- [scout] Report a shared pit entry from its menu on a team page
- [scout] Mute a workspace's shares, just for you, and unmute any time
- [workspace] Taken-down entries and suspensions are explained in the entry itself

### Scouting commons
- **Report.** Every shared entry has a menu with "Report this entry": pick what's wrong (wrong about the robot, out of date, inappropriate, something else) and add a note. The workspace isn't told who reported it (#359).
- **Mute.** "Mute" hides a workspace's shares for you alone. Muted workspaces are listed under the entries, each with an Unmute button.
- **Reviewed by Control Scout.** Reported entries can be taken down. A taken-down entry says so on its share switch, with the reason, and can't be shared again unless it's restored. A whole workspace can be suspended from the commons too; its own scouting is never touched.

## 1.5.5 — 2026-10-30

Workspaces can now share pit scouting with everyone at an event, in the new scouting commons.

### Highlights
- [scout] Share a pit entry in the scouting commons, one entry at a time
- [teams] Team pages show other teams' shared pit scouting, under your own
- [scout] Every shared pit claim says when it was scouted, coloured by age
- [workspace] Off until a workspace admin joins, and only at events where it's open

### Scouting commons
- **Join, then share.** A workspace admin joins the commons in Settings → Workspace. Nothing is shared by joining: each pit entry gets its own "Share in the scouting commons" switch, for its author or an admin. Match scouting is never shared, and leaving the commons withdraws everything (#352).
- **Credited to the workspace.** Shared entries show the workspace's name, never a scout's.
- **On the team page.** Signed in, a team's page shows the pit scouting other workspaces shared, with photos, in a "Scouting commons" section below your own workspace's take. Its averages and most-reported answers count each workspace once.
- **How old is that claim?** Each shared entry leads with when it was scouted: green the same day, amber after a day, red after two days or when it's from before the event, since robots get rebuilt overnight.
- **One event at a time.** The commons opens event by event, so it starts small, and the owner can switch the whole commons off (or off for one workspace) from the console's Features tab.

## 1.5.4 — 2026-10-30

Turning on the email digest now sends a short welcome email, so you know what's coming.

### Highlights
- [alerts] A welcome email when you turn on the email digest
- [alerts] It lists the teams the digest will follow
- [alerts] One click to unsubscribe, from the very first email

### Email digest
- **A welcome, once.** The first time you turn on the email digest, a welcome email explains what each digest holds, that it comes a few times a week and only when there's news about your teams, and which teams it will follow. Turning it off and on again doesn't send another (#349).
- **Not following anyone yet?** The welcome says so and links to picking your team, so the first digest has something in it.

## 1.5.3 — 2026-10-29

The email digest now comes a few times a week instead of once, each one covering just the days since the last.

### Highlights
- [alerts] The email digest comes a few times a week, not once
- [alerts] Each one covers only what happened since the last
- [alerts] Never at night, and never two days in a row in a week

### Email digest
- **A few times a week.** The digest now goes out three times a week, at different times, never two days in a row in the same week, and never at night. It still only comes when there's something to report about your teams.
- **Just what's new.** Each email covers the days since the one before, so results and prediction calls are never repeated. An event coming up won't make an email by itself unless it starts before the next one would arrive (#348).
- Renamed from "Weekly digest" to "Email digest" in Settings, on the unsubscribe page and in the email itself. Your on or off choice carries over.

## 1.5.2 — 2026-10-29

The Events page stops jumping while it loads.

### Highlights
- [speed] The Events page no longer jumps as it loads, on phones and computers
- [speed] On a day with no coin flips, the page doesn't save room for them
- [fixes] No more security-policy warning in the browser console

### Speed
- **Events holds still.** On a day with no coin flips, the page used to save room for them while it loaded, then take that room away, pulling the filters and the list up the screen. The page now knows from its first load whether today has any. On a phone, the footer used to sit in view until the list arrived, then get pushed down; the loading placeholder now fills the screen, so nothing visible moves. Layout shift on /events (a measure of how much the page jumps; under 0.1 is good) fell from 0.44 to 0.01 on a throttled phone and from 0.15 to under 0.01 on a computer. (#346)

### Fixes
- **Security policy.** A photo-storage setting that wasn't a valid Cloudflare address was being written into the page's security policy, which browsers reported as an error. An account ID or endpoint that isn't valid is now ignored.

## 1.5.1 — 2026-10-29

The home track record is two replays again, with the big yellow number.

### Highlights
- [home] Track record: last season's replay and this season's so far, as two tabs
- [home] The big number is back, in yellow
- [home] Live calls stay on Methodology, labelled as live

### Home
- **Two replays, one big number.** The track record card goes back to its tab row and single big figure (now yellow): "Season replay" opens on the last full season's replay, and "This season so far" shows the season in progress's own replay. The live figure blended across engine versions is off the home card; every live call stays on Methodology. (#344)

## 1.5.0 — 2026-10-29

The home page's headline now changes every 10 minutes instead of every hour.

### Highlights
- [home] A new home headline every 10 minutes
- [home] Still the same line for everyone at the same time
- [home] The owner console says the new timing too

### Home
- **Every 10 minutes.** The headline moves to the next line on the clock's :00, :10, :20 and so on, the same line for everyone at the same time, with the same short fade and no jump in the page. The owner console's Home headline section says so too. (#345)

## 1.4.9 — 2026-10-29

The owner console lists its sections down the side, the way Settings does.

### Highlights
- [report] Owner console sections down the side, grouped like Settings
- [report] What's waiting counted beside each section
- [report] A scrolling row of chips on phones and tablets

### Owner console
- **Sections down the side.** Overview, Data & sync, Packs & offline, Predictions & ledger, Rankings & content, Features, Moderation, Feedback & errors, Analytics, Accounts, Photo storage and Audit log sit in a list on the left, grouped (Health, Data, Product, People & trust, Record), with what's waiting counted beside each. On phones and tablets they're a row of chips that keeps the open one in view, as in Settings. (#343)

## 1.4.8 — 2026-10-29

The owner can switch seven features off and back on from the console, for everyone or (workspace scouting) for one workspace, without anything being deleted.

### Highlights
- [report] Seven feature toggles in the owner console, with their scope
- [workspace] Workspace scouting can be paused for just one workspace
- [scout] A paused workspace keeps your entries here until it's back
- [fixes] A switched-off feature says so calmly, links included

### Feature toggles
- **Seven toggles.** Live predictions, advancement odds, power rankings publishing, coin flips, offline pack auto-updates, the Discord bot and workspace scouting, each a colourful card with its state and scope. The other switches (live updates, error reports, photos, push, automatic and daily power rankings, the weekly digest) sit below as kill switches.
- **Asks before it flips.** Turning a toggle on or off for everyone opens a confirmation that says exactly what turns off and that nothing is deleted. A workspace's own setting (on, off, or follow the global switch) applies at once, with a note.
- **The server enforces it.** While a feature is off, every route behind it refuses reads and writes with `403 feature_disabled` (never cached), and its live channels refuse to open: predictions, share cards, event odds and their live stream, coin flips, published power rankings (and publishing them, by hand or on schedule), offline pack files, the Discord bot's commands and posts, and every shared workspace read and write. Team and event pages, the track record and the owner console itself are never behind a toggle.
- **Off is never "removed".** A workspace paused by the owner answers the app with `feature_disabled`, which the app shows as "Paused by the owner": queued entries, pick list changes and comments stay on the device and go up once it's back, and nothing is ever moved to Personal.
- **Friendly when off.** Predict, an event's Odds tab, Home's coin flips and the Power rankings page say the feature is switched off for now, links straight to them included.
- **Every flip in the audit log.** Global and per-workspace changes record the old and new value ("on → off", "off → follows global"). (#340)

## 1.4.7 — 2026-10-29

The owner console now shows the engine in production with live and replay side by side, and lets the owner write the home page's headline lines.

### Highlights
- [home] Write, reorder and switch off the home headline's lines
- [predict] The engine in production, live against replay, shadow read-only
- [predict] Calibration by confidence tier in the owner console
- [rankings] The current power-rankings week and its dates at a glance

### Owner console
- **Home headline editor.** Rankings & content has the lines the home page's headline goes through, one an hour: add a line (a plain part and a coloured part) with a preview drawn like the home page, edit it, move it up or down, switch it off, or delete it; start from the built-in lines, or go back to them. Lines are kept on the server, so everyone sees the same line in the same hour, and every page's first paint carries them, so the hero still never moves. With no line switched on, or the database out of reach, the built-in lines show. Every change is in the audit log with its old and new words.
- **Engine in production.** Predictions & ledger opens on the champion engine version, the probability model serving live calls and the shadow model scored beside it, and the public headline. Each season shows live calls and the replay side by side (never added together), live calls by the engine version that made them, and the served model against the shadow model on the same calls. All read-only: the console never changes the engine or promotes a shadow model.
- **Simulation settings, as values.** How many simulations sit behind event projections, advancement forecasts, simulated rankings and the on-device estimate.
- **Calibration by confidence tier.** The ledger groups its calls by the tier each one shows publicly, with how sure the favourite was against how often it won.
- **Power rankings at a glance.** The current week, when it was published and last updated, and when the next one goes out. Regenerate still asks first, and now says plainly that Bruno writes from the week's frozen snapshot, the same facts its stat lines show; if the daily check updates the week while Bruno writes, the regeneration is refused rather than mixing the two. Edits, hides and regenerations record what they replaced in the audit log.
- **What's new, managed from CHANGELOG.md.** The releases with their dates, highlights and PRs, a check of what the newest entry still needs, and the four steps to publish one. (#339)

## 1.4.6 — 2026-10-29

The owner console gains a Moderation tab, triage for bug reports and data corrections, notes on error reports, and an Analytics tab that decides whether the home page shows how much Control Scout is used.

### Highlights
- [report] Rate limits and scraper traffic counted per network range, not address
- [report] Bug reports, data fixes and ideas get accepted, rejected or marked fixed
- [report] Error reports show their GitHub issue's state and take your own notes
- [report] Page views, sessions, prediction calls and the ledger in one tab
- [home] The home page's "in use" section shows only when the owner chooses

### Owner console
- **Moderation.** Requests answered 429, calls from crawlers and scripts, and minutes where one range sent over 600 requests are counted per UTC day and network range (IPv4 /16, IPv6 /32). An address is cut down to its range before it's counted; no full address, user agent or account is kept, and days older than 90 are dropped.
- **Triage, in the one inbox.** Bug reports, data corrections and feature ideas from the contact form are accepted, rejected or marked fixed (and can be taken back), from the Moderation tab's queue or the feedback inbox. Fixed and rejected messages move to Resolved. An accepted data correction says how it's fixed: from FIRST through a re-sync, with a button to Data & sync. Match records are never edited by hand.
- **Error reports.** Each shows its GitHub issue with the issue's state (open, closed, not planned), and takes a note of your own, kept on the server and never sent to GitHub.
- **Analytics.** Page views and sessions (from visitors who opted in), prediction calls by route, and the prediction ledger's live calls logged and scored, all time and in the period, beside the existing request and latency numbers.
- **"In use" on the home page.** A console switch, behind a confirmation, publishes or hides the home page's page views and sessions; until it's used, the server setting decides as before.
- Every triage decision, note and publish choice is in the audit log with its old and new value. (#338)

## 1.4.5 — 2026-10-29

On a phone, the example-match dots on How it works are full-size touch targets again.

### Highlights
- [fixes] How it works: the example-match dots are 44px touch targets on a phone
- [fixes] Their size no longer shrinks with the phone's smaller text base
- [fixes] Desktop keeps its 24px dots, side by side with no overlap

### Fixes
- **Example-match dots, phone size.** The four dots under How it works' example match are 44px touch targets on a phone, as intended. Since phones moved to a smaller text base they had shrunk to about 38px; their size is now fixed in pixels, so text size doesn't change it. Desktop keeps 24px targets. (#341)

## 1.4.4 — 2026-10-29

The owner console's Data & sync section shows when each season last synced and lists data-quality checks for triage, and a new Packs & offline section shows the offline pack manifest file by file.

### Highlights
- [report] When each season last synced, at a glance
- [report] Data-quality flags to triage, never auto-fixed
- [offline] The offline pack manifest with every file's size and SHA-256
- [fixes] Re-sync and rebuild ask first; nothing here deletes a pack

### Owner console
- **Data & sync.** When data last synced, stats were rebuilt, live results ran and packs were built; then every season's last sync, whether it completed, when FIRST's team list was last read, events with results out of all events (and how many came from the fallback source), played matches and what the last run fetched and failed. Re-sync and Clear caches sit below, each behind its confirmation.
- **Data-quality flags, for triage only.** Five read-only checks, each with a count and its first rows linked: events the last sync couldn't fetch, events that ended over two days ago with no played match, season records whose wins, losses and ties don't add up to the match count, season totals smaller than their events' qualification matches, and sitemap URLs the app would answer with its not-found page. Nothing on this screen changes match data; wrong results come in right with a re-sync. "Check again" runs them now (they're otherwise kept five minutes).
- **Packs & offline.** A new tab with the manifest (version, built, data as of, engine), the releases kept on the server, and every file with its season, kind, size and full SHA-256 (wrapping on a phone, with a copy button); a file the manifest lists but the disk lacks is marked. Rebuild asks first. There is no delete: packs saved on devices stay until each device updates them. (#337)

## 1.4.3 — 2026-10-29

The owner console is now organised the way it's run: health first, then data, predictions, rankings, features, feedback and analytics, with an audit log that records every change's old and new value and can't be edited.

### Highlights
- [report] The owner console opens on the site's health at a glance
- [report] Every switch flip and data action is logged with its old and new value
- [report] The audit log can't be edited or deleted, not even from the console
- [fixes] The console shows counts, never your devices or workspace members' names

### Owner console
- **One click away.** The owner's own sidebar has an Owner console button right above their name (an icon in the collapsed rail); nobody else ever sees it. It replaces the Owner row in the menu.
- **One tab per job.** Overview, Data & sync, Predictions & ledger, Rankings & content, Features, Feedback & errors, Analytics, Accounts, Photo storage and Audit log. Links to the old tabs (`?panel=users`, `?panel=flags` …) open the section that holds them now.
- **Health first.** Overview opens on whether the site is up, when data last synced (amber once it's more than six hours old), the engine version in production, the live ledger's headline, the offline pack manifest's date and version, and the error reports and server errors of the last day and week.
- **An audit log that keeps its word.** Every switch flip, inbox move and stream change records the value it replaced and the value it set, shown as "on → off". The database refuses to delete a row or rewrite one; the only thing a row ever takes later is a data job's result.
- **403 for everyone else.** Every owner route, read or write, known or not, answers 403 to anyone who isn't a signed-in owner, before any handler runs.
- **Less personal data on screen.** An account shows how many devices are signed in, not which browsers; a read-only workspace shows how many members and admins can read it, not their names. (#335)

## 1.4.2 — 2026-10-29

Launch fixes: every team's event rows now add up to its season record, old power-rankings weeks stay as they were written, and the labels say exactly what each number is.

### Highlights
- [teams] Event rows count every match and add up to the season record
- [rankings] Past power-rankings weeks keep their original numbers
- [predict] Live and replay track records side by side, each labelled
- [fixes] One address for How it works, and no more dead team links
- [teams] Clearer ranks, odds and empty columns on team and event pages

### Teams
- **Rows that add up.** Each event on a team page now shows the team's record over every match there, playoffs included, with the quals record underneath when it differs. League meets show the meet's own record and rank instead of the league's running total, which made many teams look undefeated (one winless team showed 10-0-0). Rows for events a team never played are gone, scrimmages with matches show their record, and the season record counts qualification no-shows the way FIRST does. A tooltip says what each record counts, surrogate matches excluded. (#332)
- **Labelled ranks.** OPR and rating ranks say which list they come from and out of how many teams. A team with no results yet this season says it's showing last season, with a link to switch. (#333)

### Power rankings
- **Archives stay put.** A week's stats, order and names are saved with its write-ups when it goes out, so an old week never drifts as ratings move. The page says when its stats are from, a week is tagged by the season its dates fall in, and write-ups say "week 43", never "2026-w43". (#325)

### Predict and track record
- **Side by side.** On the home page, the season replay and the logged-live figure sit side by side at the same size. The live figure says it covers all engine versions, with the current engine's figure underneath. (#333)
- **Two odds, explained.** On an event page, the Rankings column and the Odds tab say how many simulations each ran and when, and why the two can differ. (#333)
- **How it works.** It has one address now (the old /predict/accuracy and /predict/how-it-works links forward to it), its track record shows when it was last updated, and its match and simulation counts each say what they count. (#327)

### Events
- League meets show "#1 at this meet" to match their rankings table, and say how many of the league's teams played there. Blank prediction columns and scrimmages explain themselves, and venue lines no longer show a double comma. Compare says when it switched to the last season the teams played. (#333)

### Fixes
- Team pages exist only for real teams: FIRST's demo and test registrations and its stand-in numbers for unnumbered teams are left out of rankings, search and the sitemap, and /records forwards to /teams. (#329)
- Security headers on every page (HSTS, frame and permissions policies, a content security policy in report mode). (#328)

## 1.4.1 — 2026-10-29

The weekly digest just says it comes once a week, without naming a day or time.

### Highlights
- [alerts] The weekly digest says "once a week" in Settings
- [alerts] Turning it on says the first one comes within a week
- [alerts] The digest's description no longer names a send day

### Weekly digest
- **No fixed time in the copy.** Settings, the switch's confirmation and the description say the digest comes once a week, instead of naming a day or time. The email itself is unchanged. (#334)

## 1.4.0 — 2026-10-29

The home page's track record now shows how this season is going too, and its big number is in the accent yellow.

### Highlights
- [home] This season's replay so far, on the home track record
- [predict] The track record's big number in yellow, like the ledger
- [home] Live calls and replays still shown apart, each labelled

### Home
- **This season so far.** Under the track record's big number, a box shows this season's own season replay (for example "Season replay · 2026–27 BIOBUZZ so far: 68.4% of 1,065 decided matches called right"). It shows on both tabs, labelled as a replay and never mixed into the live number, and it's left out when that replay is already the big number. (#331)
- **Yellow numbers.** The track record's percentage is in the accent yellow, the same as the ledger on How it works.

## 1.3.9 — 2026-10-28

The home page's headline changes every hour, one of thirteen lines about what Control Scout does.

### Highlights
- [home] A new headline on the home page every hour
- [home] Thirteen lines take turns, the same one for everyone
- [home] The page never jumps when the line changes

### Home
- **Thirteen headlines, one an hour.** From "Know the match before it starts." to "The field, figured out.", they take turns on the hour, the same line for everyone at the same time. An open page changes on the hour with a short fade (no motion with reduced motion turned on), and the hero keeps its height, so nothing below it moves. There is still one heading, and screen readers aren't told about the change. (#330)

## 1.3.8 — 2026-10-28

A weekly email for the weeks you don't open the app, a Scout page that sets the event once and goes match by match, a simpler Predict in three modes, and match videos with the model's call on screen.

### Highlights
- [alerts] A weekly digest email, opt-in in Settings
- [scout] Scout sets the event once, then goes match by match
- [predict] Predict in three modes: Advancement, Scheduled and Custom matchup
- [live] Each match has a Watch button, and the model's call shows on the video
- [teams] Upcoming events list their registered teams before any match is played

### Weekly digest
- **One email a week.** Turn it on in Settings › Notifications › Email. It covers the teams you follow (your team and tracked teams), and only comes when there's something to report: no results, no calls, nothing coming up means no email.
- **Your teams' week.** Each event a followed team played last week, linked: the record, the seed, how playoffs went, and OPR against the team's previous event, with both numbers. Two events in one weekend show as two rows, never one merged record.
- **Prediction check-in.** How many of our pre-match calls on your teams' matches were right that week and all season, counted exactly as the public track record counts them. A bad week says so.
- **Coming up and power rankings.** Your teams' events in the next two weeks with a countdown (and whether a schedule is out yet), and where your teams moved in that week's power rankings.
- **Easy to leave.** Every email has a one-click unsubscribe link that works without signing in, and mail apps show their own Unsubscribe button. No tracking pixels, no tracked links. A hard bounce turns the digest off by itself (#324).

### Scout
- **Set the event once.** Scouting starts by asking where you are (today's events first, then your team's) and what you watch: one robot, one alliance or all four. After that the Scout page opens on the match where scouting picks up, from the event's schedule, which stays on the phone for venues with no Wi-Fi (#289, #297, #308).
- **A whole match per save.** The teams you watch are tabs, the form shows one phase at a time with big tap targets, and the match timer moves from Auto to TeleOp to Endgame by itself. "Save Q14 · 2 teams → Q15" saves an entry for each team and moves on. A draft survives a locked or reloaded phone, and "Undo last tap" takes back the last tap (#294, #299, #300).
- **Quick mode for all four teams.** One short row per team (the main TeleOp count, the endgame, a few yes/no taps) for when you watch the whole match (#305).
- **Matches and Data tabs.** Matches lists every match at the event as done, partly done, skipped or now; tap one to open it. Data holds what the old toolbar did: entries with filters and CSV export, pick list, activity, assignments, pit scouting, recordings and the template (#293, #298, #308).
- **Assignments by slot and match range.** A captain can give "Priya: Red 1, Q1–Q30" or "Marcus: Blue alliance, Q15 on". Your assignment fills in the setup screen, and every match shows who has the other teams and whether they're done (#306, #309).

### Predict
- **Three modes, one compact header.** Predict opens on Advancement, with Scheduled and Custom matchup beside it as tabs, and the mode's controls start right under them. Old links still open the right mode with their picks (#287, #292, #307, #311, #314).
- **Advancement picks an event by search.** The event comes first, in a search with suggestions (your team's events when a team is set), and the team is optional. An event from another season moves to that season and says so, keeping the team (#290, #296, #304).
- **Scheduled is scheduled matches.** Pick a team or event to see its upcoming matches; advancement odds are one link away in Advancement. This week's events are a day-by-day list with a search and a Filters button (#288, #295, #302).
- **Custom matchup swaps from the result.** Swap sides re-predicts the same four teams with the alliances swapped, no retyping, and the ratings table folds away so the odds and reasons lead (#303).
- **Tracked events as quick picks.** Events you track show as one-tap picks in Advancement and Scheduled (#312).
- **Predict Lab.** Once a team is chosen, only the events it's registered at are listed, city and state search works, Field rows open in place, and switching teams no longer freezes the page (#277, #278).

### Events and matches
- **Recordings, at the right second.** An event's YouTube recording plays on its page, and each played match gets a **Watch** button that jumps the player to that match. A video filter on Events finds events with recordings. One watch button, not two, and a Close video button (#268, #270, #272).
- **The model's call on the video.** While a recording plays, a card on the player follows it: the next match's teams and the model's odds, then the result with "Called it" or "Upset". It can be switched off or moved to the top or bottom (#276).
- **Team names in match rows.** Every match row shows team names under the numbers, and tapping a team opens a small card with its place at the event, record and season OPR, without leaving the page (#281, #319).
- **The full score sheet.** A match's details show the score as FIRST reports it: Auto and TeleOp broken into their parts, plus foul counts (#282).
- **League meets ranked on their own matches.** A meet's Rankings tab and its Model vs field card now use the meet's own qualification matches, not the league's running standing, so every team gets a rank. Event tables colour the numbers by where a team stands (#283, #284, #286).
- **Simulated rankings before quals.** Before any qualification match, the Rankings tab can simulate the event: each team's likely rank and its odds of finishing first, top 4 and top 8, with a clear "Highly uncertain" note (#271).
- **Match list in schedule order.** Matches read Q1, Q2, Q3 even when they start out of order. The next match is enlarged in place during a live event, and the row under the mouse stays enlarged while you scroll (#261, #262).
- **Currently tracking.** The Events page lists the events you track, live first. Today's coin flips hides on a day with none (#275, #315).
- **Events search on a phone.** The Events tab has its own search for events and places at the top (#266).
- **Clearer buttons and labels.** Buttons, tabs and filters on event pages look tappable, and status and type look like labels (#269). The venue line opens in Google Maps (#276).

### Registered teams
- **Upcoming events show who's coming.** An event used to show 0 teams until rankings were posted. It now lists the teams registered with FIRST about a week ahead ("17 teams registered"), for every region, and shows the event's address (#322).
- **New Jersey, even earlier.** Until FIRST publishes a New Jersey event, its page shows FTC New Jersey's registered teams and event details (host, address, times, format), clearly marked provisional; FIRST's data replaces it once it's out (#321).
- **No team in the wrong session.** At an AM/PM event each team shows only in its own session, and waitlisted teams are kept apart from the teams list (#323).

### Navigation
- **Seven pages in view, the rest under More.** The sidebar shows Home, Events, Teams, Rankings, Predict, My team and Scout; everything else sits under More. It fits a laptop screen, folds to an icon rail under 1280 px, and spaces out on taller screens (#291, #301, #316).
- **Your account in the sidebar.** Signed in, the sidebar's footer shows your name, sync status, Settings and Sign out; signed out, a Sign in button. The top bar no longer has the account menu (#313).

### Teams and track record
- **Confidence in plain words.** The three confidence levels now read **Rough guess**, **Fair** and **Solid** everywhere (#285).
- **Top N%, always.** A team's OPR share reads "Top 94%" rather than "Bottom 7%" (#265).
- **Season replay is the headline.** The home track record leads with the last full season's replay (2025–26 DECODE), and the new season's live number says it's still calibrating (#274, #318).

### Fixes
- On iPhone the app could say "You're offline" while online; it now asks the network instead of trusting the phone's flag (#260).
- Tapping a search result on a phone opens it instead of just closing the list (#264).
- The sign-in email shows the real logo, and its code copies as one number (#263).
- The site is back much faster after an update: a restart takes about 2 seconds instead of over 30 (#279).
- The home atlas's country total is in the display gold in light mode (#259).

## 1.3.7 — 2026-10-23

Saved offline seasons keep themselves current: you're asked when an update is out, or it downloads by itself.

### Highlights
- [offline] Saved seasons check for updates in the background
- [offline] One "Update now?" per release, in a pop-up and your notifications
- [offline] Choose: ask me, or download automatically
- [offline] Choose: Wi-Fi only, or Wi-Fi and mobile data

### Offline
- **Updates find you.** A saved season used to need a visit to the Download page to see that a newer release was out. The app now checks in the background (soon after it opens, when you come back to the tab, and every hour) and asks once per release: "Offline data for 2025–26 has an update (41.9 MB). Update now?" Yes downloads it and swaps it in; Later waits for the next release. Signed in, it also sits at the top of your notifications until you answer.
- **Or skip the question.** The Download page and Settings › Offline data have "When updates are out: Ask me / Download automatically" and "Download updates on: Wi-Fi only / Wi-Fi and mobile data". Both sync with your account. The small offline-predictions pack follows the network setting too.
- **No guessing about Wi-Fi.** Only some browsers tell a site whether it's on Wi-Fi (Chrome on Android does; Safari, iPhone and desktop Chrome don't). Where the browser doesn't say, Wi-Fi only means you're asked first instead of a silent download, and the Download page says so. Data Saver on always asks first (#257).
- As before, every download is checked against its published SHA-256, and a failed or partial one never replaces the saved copy.

## 1.3.6 — 2026-10-23

Power rankings stay current all week: the top 25 is checked against the latest results every day.

### Highlights
- [rankings] Power rankings are checked every day, not just Fridays
- [rankings] The page says when a week was last updated
- [rankings] Only blurbs for teams that moved are rewritten

### Power rankings
- **Checked every day.** The current week's top 25 is compared with the latest data every day at midnight New York time. If nothing changed, the week stays exactly as it was and only its date moves ("Published Friday, Oct 23 · Updated Sunday, Oct 25"). If something did, the changed entries are updated, and Bruno rewrites only the blurbs of teams whose place changed; the rest stay word for word. Past weeks and hand-written weeks never change. The owner portal lists each day's check and can switch the refresh off (#255).

## 1.3.5 — 2026-10-23

Team pages tell search engines exactly who the team is, so a search for a team's number and name finds its page.

### Highlights
- [teams] Team pages are titled with number and name: "4215 Hypnotic Robotics"
- [teams] Team pages name the town, rookie year, record and events at once
- [fixes] Search engines see each team page as fresh when the team has played

### Teams
- **Found by number and name.** A team page's title now leads with what people search for: "4215 Hypnotic Robotics — FTC team stats, OPR & predictions · Control Scout", and its main heading is the number and name together (it looks the same as before). Its description is built from the team's own data: town, rookie year, latest season's record and OPR rank.
- **Readable before the app loads.** The first response for a team page carries a short summary and its most recent events as links, so search engines and slow connections read who the team is without running any script. The app takes over as before.
- **Clearer to search engines.** Each team page describes itself as the team's profile page, with the team's own website and its FIRST page listed as the same team, and a Home › Teams › team trail. A link with ?season= still names the one team address as its canonical.
- **Fresh in the sitemap.** A team's last-changed date in the sitemap is now the last day it played (or a later correction to those results), instead of the date of the last data sync, which was the same for every team. (#256)

## 1.3.4 — 2026-10-23

The Predict Lab opens on advancement odds, bigger and easier to use, and its season switch works again.

### Highlights
- [predict] Predict Lab: advancement first, with a larger team box and event list
- [fixes] The Lab's season switch changes the season again
- [home] Click a country on the globe; the atlas opens on your team's country
- [report] The ledger says when the season under way is early and still moving

### Predict Lab
- **Advancement first.** The Lab opens on Advancement; a custom matchup of any four teams is the second tab. Larger heading and tabs, a big team box, a search box and a taller event list showing each event's type and city. (#258)
- **Season switch fixed.** Choosing another season in Advancement did nothing: the season and the cleared event were written to the address one after the other, and the second write put the old season back. Both now go in one write.
- **Outlook before 2025–26.** Advancement points started in 2025–26, so earlier events no longer show a breakdown of zeros; they say why there's none. Once alliances are set, Captain and Picked read Yes or No.

### Home
- **Click a country on the globe** to see its totals. A mouse press used to be taken for the start of a drag, so clicks didn't reach the country; now a press only turns the globe once it moves.
- **Opens on your country.** Signed in, the atlas opens on your home team's country (your Control Point team, else the team you follow); signed out, the United States. Choosing another country only changes what's shown, never your default.
- **Explore** is the app's own dropdown instead of the browser's.

### How it works
- **Early-season note.** While the season under way has fewer than 3,000 decided matches, the ledger says its figures are early and still moving (most robots have played little, so calls lean on last season), with where last season ended for comparison.

## 1.3.3 — 2026-10-23

Small fixes: Compare lets you pick the team the others are measured against, and match videos can be added from your camera app.

### Highlights
- [teams] Compare: drag teams into order; the first is the baseline, tinted yellow
- [scout] Add a match video you filmed with your camera app, or any video file
- [live] Today's coin flips moved from Home to the Events page
- [fixes] Check again shows it's checking; event names in match lists are larger

### Compare
- **Reorder the teams.** Drag a team's grip (mouse or touch) onto another column, or use the arrow keys on it. The first team is the baseline the others are measured against: its column is tinted light yellow and tagged Baseline. Reordering doesn't load the comparison again, and head to head follows the baseline: its matches with or against the others, from its side. Dragging near the table's edge on a phone scrolls it. (#254)

### Scouting
- **Add a video you filmed.** A match's Video box now has Choose a video next to Start camera: pick a video from this device (or film one with the phone's camera app); MOV, MP4, WebM and other common formats, downloaded again with their own extension. It's kept on this device like an in-app recording, never uploaded. Browsers that can't record in the page still offer it. The box says what it holds (record, add a file or a YouTube link), and Settings no longer points at a camera icon that isn't there.

### Home and events
- **Today's coin flips are on the Events page,** above the event list (current season), instead of on Home.

### Fixes
- **Check again** (statistics catching up) spins and reads Checking… until the fresh answer is in.
- **Event names** heading a match list are a size up, no longer smaller than the match numbers.
- **Power rankings:** "Control Point" in the Bruno note links to Control Point.
- **Scouting report button** on each match row is a soft solid gold, so it stands out.
- **"OPR at this time"** replaces "OPR here" next to a team's OPR at an event (match details, the pre-match report, the model-vs-field list).
- **Shortlist:** the list view drops the Reliab. column to make room; reliability still shows in the grid view and on Compare.

## 1.3.2 — 2026-10-23

Score ranges are tighter and honest again: about 8 in 10 real scores land inside the stated 80% range.

### Highlights
- [predict] Predicted score ranges are about 10 points narrower
- [predict] 80% ranges hold about 80% of real scores again
- [rankings] Event simulations spread scores to match

### Predictions
- **Tighter score ranges.** Every predicted score comes with an 80% range. Since this week's engine changes made expected scores more accurate, those ranges had grown too cautious: they held about 85% of real scores instead of 80%. Their width is now refitted on 2024–25 matches; replayed over 2025–26, 81.4% of real scores land inside, and the ranges are about 10 points narrower. Playoff ranges stay as wide as before: that one setting was chosen after looking at 2025–26 playoffs, so the 2025–26 figure isn't a fully independent check. Event simulations draw scores with the same spread, and still put 87% of teams' real final ranks inside their projected range. Win odds are unchanged. Prediction engine 3.2.0 (#253).

## 1.3.1 — 2026-10-23

Ties count: expected ranking points and event simulations now give a tie's RP to both alliances.

### Highlights
- [predict] Expected ranking points count the chance of a tie
- [rankings] Event simulations let close matches tie, 1 RP each
- [report] How it works explains ties; win odds unchanged

### Predictions
- **Ties count.** About one qualification match in 130 ends in a tie, which pays 1 ranking point to both alliances. Until now the engine gave a tie no chance: expected ranking points counted a tie as half a win, and simulated events never tied, so a tie's points always went to one side. A tie's chance is now priced from how close the match is expected to be (highest in an even match, about 1–1.5%). Win odds and predicted scores are exactly as before; ranking points and simulated standings are now right in close matches. Measured on every season since 2019–20 (docs/engine/part12/ties.md). Prediction engine 3.1.0 (#251).

## 1.3.0 — 2026-10-23

How it works records four second-wave engine tests, all measured and turned down.

### Highlights
- [report] Lab notes: why a blend of three models didn't ship
- [report] Lab notes: no extra growth curve needed for young teams
- [report] Lab notes: a tuning sweep and a calibration test, both kept as is
- [predict] Predictions unchanged: the engine stays 3.0.0

### How it works
- New lab note: a win/loss skill rating and a margin model blended with the engine. On the one fully held-out season the blend was slightly worse, later gains were within noise, and accuracy didn't change, so the engine stays a single model (docs/engine/part12/ensemble.md) (#249).
- New lab note: a growth curve for rookies and second-year teams. Their misses drift the same way as veterans' as matches pile up, so there is nothing to add; a small late-season over-rating in every band is noted for the tuning pass (docs/engine/part12/growth.md).
- New lab note: a tuning pass over all 15 rating settings. Twelve were already on a plateau; moving the other three helped one season's playoffs and hurt thin-data predictions in the two later seasons, so nothing changed (docs/engine/part12/tuning.md).
- New lab note: a free-form (isotonic) final calibration. Not clearly closer in the 55–85% bands and slightly worse on Brier, so the one-number stretch stays (docs/engine/part12/isotonic.md).

## 1.2.9 — 2026-10-23

How it works arrives complete in the page itself, for search engines and slow connections.

### Highlights
- [report] How it works sends its full text with the page, not after the app loads
- [speed] Readable at once on a slow connection, before any script runs
- [fixes] One main heading on How it works, as search engines expect

### How it works
- **The whole page in the first response.** /methodology is built ahead of time from the same page component the app shows: every section's text, the version history, the limits and the settings now arrive in the HTML itself, so search engines read all of it without running JavaScript, and a slow connection can read it before the app loads. The app takes over as before once it starts, with the interactive figures. Its address, anchors (such as /methodology#accuracy), title and description are unchanged, it stays in the sitemap, and it has a single main heading. (#247)

## 1.2.8 — 2026-10-23

Prediction Engine 3.0: today's improvements, re-checked on every season since 2019–20.

### Highlights
- [predict] Engine 3.0: regional starts, today's form, overlap, slow fouls
- [report] Re-checked on every season since 2019–20, truer in six of seven
- [report] How it works and the version history name engine 3.0

### Predictions
- **Prediction Engine 3.0.** The engine changes shipped today (regional starting points, a bolder final calibration, form at the current event, slow-learning foul ratings and alliance overlap) were replayed together on every match since 2019–20, against the engine from before them. Stated chances came closer to what happened in six of the seven seasons; the seventh is the mostly-remote 2020–21 season with only a few hundred matches, where it was within noise. The gap between stated and actual win rates in the 50–80% range narrowed in every season and roughly halved in five of the seven. Winner-calling is about the same: the gain is in how far to trust each call. Win odds are the same as 2.11; this version marks the full check. The sign-off report is in the repository (docs/engine/signoff-3.0.md). Prediction engine 3.0.0. (#246)

## 1.2.7 — 2026-10-23

How it works gains a version history and says plainly where predictions are weakest.

### Highlights
- [report] How it works lists every engine version in one line each
- [report] Limits name the measured weak spot: thin data early in events
- [report] Lab notes add what the 2.7–2.11 engine work tried and rejected

### How it works
- **Version history.** A new "Versions" section lists every prediction engine release, newest first, with its date and one plain line on what changed. A test keeps it in step with the engine's own changelog, so a release can't ship without its line.
- **Measured limits.** "What the predictions can't know" now opens with the weakest spot the latest slice report found: matches where the robots have played little this season, and the first ten qualification matches of an event, carry a third of all prediction error. Every figure comes from the stored report, and a test checks each one against it. Two new limits: no defense rating for playoffs, and alliance overlap measured on the last two games.
- **Lab notes** add the 2.7–2.11 results (what shipped and by how much) and four ideas that were tried and rejected, with their numbers. (#245)
- The page names the engine version it describes from the running engine, so it no longer says "2.1".

## 1.2.6 — 2026-10-23

Two robots good at the same thing don't simply add up.

### Highlights
- [predict] Alliances of two robots strong at the same thing score a bit less
- [predict] Biggest change in auto, where two robots share one plan
- [predict] Playoff alliances stay as they are: partners are picked to complement

### Predictions
- **Ratings add; alliances don't quite.** Two robots both strong in auto, or both strong in TeleOp, get in each other's way. Measured on real alliances, they scored less together than their ratings added up to, most of all in auto. In a qualification match, an alliance now loses 25% of the weaker partner's auto and 15% of its TeleOp. Endgame showed no such effect, and playoff alliances are left as they are. On replayed matches, win odds improved in every season tested, most at the start of events, and predicted scores moved closer to the real ones. How it works explains it next to how expected scores are built. Prediction engine 2.11.0. (#244)

## 1.2.5 — 2026-10-23

Expected scores stop over-charging teams for fouls.

### Highlights
- [predict] Expected scores count fouls more realistically
- [predict] Foul-prone teams no longer predicted to gift huge penalty totals
- [report] Predicted scores closer to the real ones in 2025–26

### Predictions
- **Fouls learn slowly.** A team that gave away a lot of penalty points last week usually gives away far fewer this week: fouls are mostly luck and officiating. A robot's penalty rating now learns at 15% of the speed its scoring does, so it stays near the season average until a pattern really holds. The most foul-prone alliances had been predicted to give away about half again as many points as they did. On replayed matches, expected scores moved closer to the real ones (2025–26: average miss 27.7 → 26.6 points), and win odds are unchanged within noise. How it works explains it next to how expected scores are built. Prediction engine 2.10.0. (#243)

## 1.2.4 — 2026-10-23

Predictions watch today's matches too.

### Highlights
- [predict] A robot beating its rating today leans its next odds at that event
- [predict] Biggest help in a robot's first few matches at an event
- [predict] "Why" names a robot playing well above or below its usual level

### Predictions
- **Today's robot.** At an event, a robot that has been beating (or missing) what its rating expected leans its predictions for the rest of that event the same way: by 40% of its average miss there in auto and 20% in TeleOp, fading as it plays more matches there and capped so one wild match can't run away with it. Its rating itself is unchanged, and the lean resets at its next event. On identical replayed matches against the previous engine, the Brier score improved in both seasons tested (2024–25 by 0.00015, 2025–26 by 0.00018), about twice that for robots at their first event, with no slice worse. When the lean is notable, the match's "Why" says "Team 1234 is playing about 9 points above its usual level at this event". How it works explains it under "Five more things a rating knows". Prediction engine 2.9.0. (#242)

## 1.2.3 — 2026-10-23

Win chances say what they mean a little more exactly.

### Highlights
- [predict] Favourites' chances are a touch bolder, because they were a touch timid
- [report] Stated chances match how often favourites win more closely
- [predict] Never changes who's favoured, and nothing about alliance colour

### Predictions
- **A final stretch of the odds.** The engine was slightly too cautious: across the last two seasons, favourites it gave 70–80% won about two points more often than that. Every win probability is now stretched a little away from 50% (log-odds × 1.058). Checked month by month on matches after each fit, the gap between stated and actual win rates in the 50–80% range roughly halved in both seasons tested, and the Brier score improved. It can't change which side is favoured, so winner-calling is unchanged. How it works explains it under "A final calibration touch". Prediction engine 2.8.0. (#241)

## 1.2.2 — 2026-10-22

Sharper odds for teams at their first event of the season.

### Highlights
- [predict] First-event odds use how a region's teams are doing this season
- [predict] Last season counts a little more in a team's starting point
- [report] Stated chances land closer to how often favourites win

### Predictions
- **Regional starting points.** A team new to the season now starts from its usual point (last season's standing, or the rookie start) plus how far that region's returning teams have beaten or missed their own starting points so far this season, after their first three matches. The adjustment is shrunk heavily, so one or two surprising teams barely move it. On identical replayed matches against the previous engine, the Brier score (lower is better) improved in both seasons tested: 2024–25 by 0.00033 and 2025–26 by 0.00024, about twice that for robots at their first event. No slice got worse beyond noise, and the gap between stated and actual win rates in the 50–80% range narrowed. Winner-calling accuracy is unchanged. The How it works page explains it under "Four more things a rating knows". Prediction engine 2.7.0.
- **Last season counts a little more.** A returning team's starting point now carries 70% of last season's standing (it was 60%).

### Engine program
- **Error report by slice.** `npm run slices` replays every 2023–2026 match through the engine and reports accuracy, Brier and calibration by event phase, experience, data density, volatility and event type. `--challenger` compares an engine change against the live engine on the same matches, with intervals from resampling whole events. Reports are in `docs/engine/`. (#239)

## 1.2.1 — 2026-10-21

Projections even with no signal: a local estimate simulated on your device.

### Highlights
- [offline] Event projections with no signal, simulated on your device
- [predict] Labelled "Local estimate" with the real count, one tier lower
- [speed] Runs in the background with progress; never freezes the page

### Offline
- **Local estimate of an event's projections.** When the stored 10,000-simulation projection can't be had (no signal and your saved season doesn't carry one, or none has been made yet) and the season is saved for offline use, the Odds tab simulates the rest of the event on your device instead: 1,500 runs of the same engine, built with the same steps and the same seed the server uses for those results, in a background worker with a progress bar. It stops after 2 seconds of work on a slow phone and says how many runs it managed. It's labelled "Local estimate · 1,500 simulations on this device" wherever it shows, sits one confidence tier below the server's projection, never shows movement against the server's pre-event projection, and gives way to the stored projection as soon as that can be read. Each results state is simulated once per device and kept, so opening the event again doesn't run it again. On four replayed championships, its median ranks were within one place of the server's 10,000-run projection for every team. (#238)

## 1.2.0 — 2026-10-21

Event simulations spread erratic robots wider and no longer peek at later results.

### Highlights
- [predict] Erratic or new robots spread wider in event simulations
- [history] "Before the event" bonus RPs learn from earlier results only
- [live] Live projections use the same per-robot spread as score ranges

### Predictions
- **Per-robot spread in the event simulator.** Every simulated match score now gets match-to-match noise sized for its alliance the way the score ranges already were: wider when a robot's results swing more than the model expects, or when it has played only a few matches this season. It reaches the advancement odds, the partner what-ifs and the live projections. On 40 finished 2025–26 events cut at their midpoint, 86.6% of teams finished inside their projected 10th–90th percentile rank band (85.7% before). Prediction engine 2.6.0. (#237)
- **No hindsight before the event.** A "Before the event" simulation, and the pre-event projection that live projections compare against, now draws bonus ranking points from a bonus model fitted only on qualification results played before the event started. It used the curve fitted on the whole season. With too few earlier results it simulates no bonus RPs and says so. Live simulations use the same season curve as the match cards' bonus odds, and the note that bonus RPs aren't modelled now shows exactly when a simulation drew none.

## 1.1.9.2 — 2026-10-21

Partnership history on last season's predictions too.

### Highlights
- [predict] "Played 24 matches together" now shows on 2025–26 calls as well
- [history] Counted only through that season's end, never a later match
- [predict] On 2024–25 events and lab calls as well; the odds don't change

### Predictions
- **Partnership memory on earlier seasons.** A prediction for an earlier season (the Predict lab or an event of 2025–26 or 2024–25) now shows the same pair history line as this season's calls. It reads the pairs as they stood at that season's end, the way that season's ratings are its end-of-season ratings, so a later match never counts. Still a reason only: no odds, score or range changes, and no engine change. (#236)

## 1.1.9.1 — 2026-10-21

Report cards stay up to date for every season, not just the current one.

### Highlights
- [report] Report cards for past seasons catch up when a late result is scored
- [report] Live calls only, as always: the replay never counts
- [speed] Unchanged seasons are skipped: a quick check, not a rebuild

### Predictions
- **Report cards for every season.** A season's predictability report cards are rebuilt whenever its scored live calls change, after every stats run and every live result, whichever season the call belongs to. Before, only the current season was rebuilt between full recomputes, so a past season could show cards that missed its last scored calls. Seasons whose calls haven't changed are skipped after a quick check. A season is still rebuilt when one of its events turns final, or stops being final because a sync added a match or moved its dates. Live calls only, as always. (#235)

## 1.1.9 — 2026-10-21

Pick on reliability, not just peak scoring: a dependability estimate next to OPR.

### Highlights
- [picklist] Reliability next to OPR on pick lists, Compare and team pages
- [teams] Its parts in plain view: no-shows, DQs, near-zero matches, swing
- [workspace] Workspace members also see it with their own scouts' notes
- [predict] Predictions mention recent no-shows when they matter

### Teams and picks
- **Reliability index.** A 0–100 estimate of how dependable a robot has been, from qualification match results only. It counts no-shows, disqualifications, near-zero matches (the alliance scored about what the partner's OPR alone would), how much its estimated contribution swings, the penalties it gives away and how predictable its matches have been (from the report cards). A near-zero match isn't proof of a dead robot: defense or a partner carrying the alliance looks the same, and the page says so. Every part is pulled toward the season average as if the team had 10 more matches, and the sample size is always shown. It's on team pages, in Compare, on your shortlist and your workspace's pick list, in pre-match reports and in offline packs. How it works lists the rule. (#234)
- **With your workspace's notes.** Members of a scouting workspace whose match entries mark a robot broken, disabled or a no-show also see a second number that folds those notes in, clearly marked. Only that workspace's members see it: never other users, the public API, shared caches, page previews or offline packs.

### Predictions
- **Reasons beyond the factors.** A prediction now mentions a robot with 2 or more no-shows (or 3 or more near-zero matches) in its last 10, under the top factors, on saved and fresh calls alike. Words only: no odds, score or range changes. Prediction engine 2.5.0.

## 1.1.8 — 2026-10-21

Predictions now say when the robots have met before.

### Highlights
- [predict] "Played 24 matches together (16–8)" right under the factors
- [predict] Head-to-head records too: "9617 leads 13546 10–3 in 13 earlier meetings"
- [history] History back to 2019–20; recent partnerships offline too
- [predict] A reason only: on a season it had never seen, it didn't help the odds

### Predictions
- **Partnership memory.** When two robots in a match have played together or against each other, the prediction shows the strongest real fact under the top 3 factors: in match details, the match report and the Predict lab. Every result since 2019–20 is compared with what both teams' ratings expected at the time, so seasons with different games compare fairly. Pairs with only a few matches are pulled hard toward "no effect". We tested blending the history into the win odds: fitted on 2023–24 and checked on all of 2025–26, it made them slightly worse, so it doesn't change any number. The methodology page explains it, and `docs/partnership-memory.md` has the full test. (#231)

### Offline
- The offline pack carries a small cut of the history: same-alliance pairs with 3+ matches together this season or last (about 140 KB more). Head-to-head records and older pairs show online only.

## 1.1.7 — 2026-10-21

Bonus ranking point odds next to every qualification win %.

### Highlights
- [predict] Each alliance's chance at every bonus RP, next to the win odds
- [predict] Expected ranking points from the match, red and blue
- [report] On match pages, pre-match reports and the match lab
- [history] Bonus calls are logged and scored like win calls

### Predictions
- **Bonus ranking points per match.** A qualification match of 2025–26 or 2026–27 now shows, under its win odds, the chance each alliance earns each of the season's bonus RPs (Movement, Goal and Pattern; Swarm, Pollinator 1 and Pollinator 2) and the ranking points each side can expect from the match (3 × win chance + bonus chances), with its own confidence tier. It's the same math the event simulator uses, from prediction engine 2.3. On match pages (opened from any match list), the pre-match report and the match lab, online and offline from a pack saved after this release. Once a match is played, the call sits next to the bonuses actually earned.
- **A bonus curve that keeps up with the season.** The chance of each bonus at a given score is fitted to the season's latest 2,000 recorded qualification alliances (from 200 on; provisional below 600, at most moderate below 2,000). On the 2025–26 replay that scored a Brier of 0.147 per bonus call, against 0.178 for the whole-season curve the engine shipped with.
- **Scored in the track record.** Bonus calls are written to the ledger with each pre-match call and scored by Brier per bonus, live and season replay kept apart. The replay fits the bonus model only on results before each match. See How it works › Bonus ranking points. (#228)

## 1.1.6.2 — 2026-10-21

Today's coin flips: the closest calls at every event on today, on the home page.

### Highlights
- [home] Today's coin flips: the matches the model calls 45% to 55%
- [predict] Every event that's on today, at its own venue's date
- [history] Played ones stay, with the result beside the call made before

### Home
- **Today's coin flips.** A new section on the home page gathers the matches on today's schedules, across every event that's on today at its venue, where the model gives either side between 45% and 55%. Those still to play come first, soonest first, each with both alliances, the odds on a close-up scale, the time at the venue, how long until it starts and its confidence tier; the closest call is marked. Played ones follow with their score and the call made before the match. Calls on thin data (a robot with fewer than 3 matches this season) are left out, and an empty day says why. Each opens its match page. Refreshed after every sync and live result, and every few minutes; an open home page keeps up by itself. (#226)

## 1.1.6.1 — 2026-10-21

Smooth scrolling across the site: jumps within a page glide there instead of cutting.

### Highlights
- [speed] Contents links, "see the odds" and match jumps glide to their spot
- [speed] Opening a page, or going back, still lands instantly where it should
- [speed] Reduce motion on your device and every jump stays instant

### Scrolling
- **Smooth jumps.** Every jump within a page now glides: contents and section links (How it works, Privacy, Terms, FAQ topics), the skip link, buttons that take you to a part of the page (an event's odds, live panel or stream, a linked match), the search palette bringing the page's search field into view, and the selected tab or chip in a sideways row. Scrolling with a wheel, trackpad or finger is unchanged: it stays the browser's own. (#233)
- **Pages still open instantly.** A new page starts at the top, and back or forward returns to exactly where you were, without sliding there from the old position. Dragging a pick to the screen's edge scrolls the page as before.
- **Reduced motion.** With reduce motion turned on in your device's settings, every jump is instant.
- **Sideways rows.** Swiping to the end of a sideways row (tabs, chips, a wide table) no longer turns into the back gesture, and scouting photo strips settle on a photo.

## 1.1.6 — 2026-10-21

Live projections: every live or upcoming event simulated 10,000 times, again after each new result.

### Highlights
- [predict] Projections: each team's likely final rank, with the range it lands in
- [live] Updated a few seconds after new results land, without reloading the page
- [predict] Playoff and advancement odds that move as the event unfolds
- [history] Once it's over: final seeds against the ranges they were projected in

### Predictions
- **Projections on the event page.** The Odds tab opens with a projection of the rest of the event: each team's median final quals rank with its 80% range (10th–90th percentile) as a whisker, today's rank, how far it has moved since the projection made before the first match, its chance to play in the playoffs (captain or picked) and its chance to advance, labelled "performance-based — awards can also advance teams". Sortable, your team and tracked teams pinned to the top, and headed with how many simulations it ran and after which match. Once the event is over it becomes "Final results vs projections": each team's actual seed against the range it was last projected in while quals were still open, and how many landed inside.
- **Simulated in the background, never on a visit.** A server job re-runs an event a few seconds after new results land (a burst of results is one run), stores the result, and tells open pages over a live connection; pages only read what's stored. The same results always give the same numbers. A very large event that would take over 10 seconds runs 5,000 simulations instead, and says so.
- **One advancement number.** The projection's odds are now the advancement odds everywhere they show: the event's rankings table and the records tables, the advancement simulator's team list and headline (with its award-inclusive figure alongside), the shortlist, and saved offline packs. Events never projected keep the forecast made the day before they started. (#229)
- **Checked on real events.** Replaying 40 finished 2025–26 events from their midpoint, about 86% of teams finished inside their projected 80% range (How it works → Live projections).

## 1.1.5 — 2026-10-21

How predictable each team has been, from the engine's own live calls.

### Highlights
- [teams] A prediction report card on team pages: how often calls were right
- [teams] How far its alliances landed from the predicted score
- [teams] Live calls only, with sample size, raw numbers and a warning

### Teams
- **Prediction report card.** Team pages show how the engine's pre-match calls on that team's matches turned out this season: the share called right, points vs prediction per robot (the alliance's miss split evenly between its robots) and the swing of those misses, with the field average beside each. Finished events get a row each, with how many calls had a predicted score and the raw numbers. Only calls logged before each match count, never the replayed history. Few calls say little, so every number is pulled toward the field average as if the team had 10 more calls, and the card says so. How it works explains the rules. (#232)

## 1.1.4 — 2026-10-21

Predicted scores come with a range now, and the range is scored in public.

### Highlights
- [predict] Every predicted score reads like 118 ±14: an 80% range
- [predict] Ranges widen for robots with few matches or up-and-down results
- [history] How it works shows how often real scores land inside the range

### Predictions
- **Score ranges.** Every predicted score now comes with its 80% range, written 118 ±14 (hover or tap for the range itself and what it means: about 8 in 10 real scores land inside). It's on match rows, match details, match reports, the Predict lab, the live panel, Watch live and the pit display, and offline from your saved pack. A range is wider when a robot has played only a few matches this season or its results swing from match to match, and narrower in playoffs. Prediction engine 2.2.0; win odds are unchanged.
- **Ranges are on the record.** Every call is logged with the range it stated, and How it works scores them like the win calls: the share of real scores inside the range, which way the misses went, the average width and each confidence tier. Calls made before this release stated no range and none is added afterwards. (#230)

## 1.1.3 — 2026-10-21

Model vs field: where the model's ratings and the seeding disagree most at an event.

### Highlights
- [rankings] Model vs field: teams the model rates well above or below their seed
- [predict] Every call with its numbers: rating, matches, OPR, record and confidence
- [rankings] Before quals, against each team's seed at its last event

### Events
- **Model vs field.** An event's Rankings tab now opens with the biggest gaps between the model's rating order and the official seeding: "the model rates them #3 of 28; they're seeded 18th". Each call shows the rating and its uncertainty, how far it is from the team the model places at that seed, the matches behind it, OPR, record, ranking points and a confidence tier, with the model's track record linked under it. Before qualification matches, ratings from earlier events are compared with each team's seed at its last event (and the label says so); a finished event uses the ratings as they stood at its last match. Small fields, ratings on few matches, and gaps the model can't tell from its own uncertainty are left out, and the section says why when nothing shows.

## 1.1.2 — 2026-10-21

Follow your team in Discord for the whole event, not just its matches.

### Highlights
- [alerts] The evening before an event: who's there and your team's season
- [alerts] Your schedule, with win odds for every match, the moment it's out
- [alerts] A recap at the end of each day: record, rank and live calls right

### Discord
- **More from /follow.** Besides the post before each match and its result, a followed team's channel now gets: the evening before the team's event (from 4 pm at the venue), where and when, how many teams, the team's season OPR and world rank, and the strongest teams there; the team's qualification schedule once FIRST posts it, each match with its time at the venue, side, partner and win odds; and, at the end of each event day, the team's rank and record there, its matches that day, and how many of its live calls were right. Each team gets its own schedule and recap post. (#224)

## 1.1.1 — 2026-10-21

A pit display for the TV in your pit.

### Highlights
- [live] Pit display: the whole event on the pit TV, no sign-in needed
- [predict] Up next with win odds, a countdown and the current rankings
- [teams] Your tracked teams in gold when you're signed in

### Events
- **Pit display.** A "Pit display" button on every event page opens a fullscreen screen for a pit TV or laptop: the event and the venue's clock, the match up now (or the last result, with whether the call was right), the next three matches with their win odds, a countdown to the next one (left out when the event runs behind, rather than showing a wrong time), the top 8 and a QR code to the event page. It updates by itself, shows "Reconnecting…" if the connection drops, keeps the screen awake where the browser allows it, and fits 1920×1080 and 1366×768 with no scrolling. Signed in, your tracked teams show in gold and your next match is pinned. (#218)

## 1.1.0 — 2026-10-21

Watch an event's stream with the model calling every match beside it.

### Highlights
- [live] Watch live: the event's stream with live predictions beside it
- [predict] See each call, then whether it was right, the moment a match ends
- [live] A LIVE dot on events you can watch right now

### Events
- **Watch live.** When an event has a stream, its page gets a "Watch live" button and a section above the matches: the YouTube stream (it loads only when you press play, from YouTube's privacy-enhanced player) and, beside it, the match the model is calling now, with its win odds, predicted score and confidence. The moment a match finishes it shows the result and whether the call was right, then moves to the next one, with the three after it below. After the event the stream stays as the recording. On phones the stream comes first and the calls below it. (#219)
- **LIVE dot.** Events that are on now and have a stream show a red LIVE dot in the events list.
- **Owner portal › Streams.** The owner sets an event's stream from a YouTube link (watch, youtu.be or /live/ links); anything else is refused with the reason, and nothing is saved.

## 1.0.9 — 2026-10-21

Control Scout comes to your team's Discord server.

### Highlights
- [share] A Control Scout bot for your team's Discord server
- [predict] /predict: win odds for any qual match, and how played calls turned out
- [teams] /team, /event and /rankings answer right in the chat
- [alerts] Follow your team: a post before each match, and its result

### Discord
- **The Control Scout bot.** Add it to your team's server and anyone there can ask `/team` (record, OPR, world ranking, next event), `/predict` (win odds as bars, predicted score and confidence for a qualification match; once it's played, the final score, what was predicted and whether the call was right), `/event` (status, progress, top 5 by OPR, the winning alliance) and `/rankings` (the world top 10 with movement). Every answer links back to the page it came from, and the numbers are the site's own. Event names and codes autocomplete. The invite link is in the FAQ and footer. (#216)
- **Match alerts in your server.** Someone who can manage the server types `/follow team:18360` in a channel, and the bot posts there 15 minutes before each of that team's matches (lineups, win odds, predicted score) and again with the result and whether the call was right. `/unfollow` stops it, `/following` lists a server's teams (up to 10), and `/help` lists every command. My teams and My team have an "Add to a Discord server" button with the `/follow` command ready to copy.

## 1.0.8.1 — 2026-10-20

More of each page on a phone screen: match lists, tabs and the bottom bar take less room.

### Highlights
- [live] Phone match lists show both alliances side by side
- [speed] A slimmer bottom bar on phones, so more of each page shows
- [rankings] Page tabs and toggles take less room on phones

### Phones
- **Match lists.** On a phone 390 px wide or more, the red and blue alliances of each match sit side by side, facing each other with the scores in the middle (as on a laptop), instead of stacked. About five matches fit on screen instead of three and a half. The narrowest phones (320 px) keep them stacked. Event Matches tabs and team pages both get this. (#221)
- **Bottom bar.** 52 px tall instead of 60, and everything that sits above it (sticky buttons, the cookie and install notes) follows one shared height.
- **Tabs and toggles.** Page tabs (an event's Matches / Rankings / Insights…) and segment toggles (All / Quals / Playoffs) are tighter on phones, so more tabs show before the row scrolls.

## 1.0.8 — 2026-10-20

Phones fit more on screen, get a menu button at the top left, and a bottom bar you pick yourself.

### Highlights
- [home] Phones: the menu sits top left, with the logo in the middle
- [scout] Scout takes the bottom-right tab on phones, where More was
- [home] Pick your phone's bottom tabs in Settings › Appearance
- [rankings] Phones fit more on screen, with a text size you can change
- [fixes] iPhones no longer zoom in when you tap into a text box

### Phones
- **A menu button, top left.** The sidebar-style button at the left of the top bar opens the menu with every page (what the More tab used to open). Search sits beside it as an icon, the logo is centred, and the theme switch, notifications and your account stay on the right; it all fits a 320 px screen. Desktop is unchanged. (#220)
- **Scout in the tab bar.** The bottom bar is Home, Events, Predict, My team and Scout by default.
- **Your own tab bar.** Settings › Appearance › Phone tab bar: turn pages on or off (2 to 5), move them left or right, see a preview, or reset to the default. The choice is kept on this device; every page is always in the menu too.
- **More on screen.** Phones draw everything a step smaller (14 px text instead of 16), with tighter padding, gaps and buttons, so there's less scrolling and nothing is hidden or reworded. Desktop looks the same.
- **Text size.** Settings › Appearance › Text size: Smaller, Default, Larger or Largest. Text, boxes and buttons scale together, and the choice is kept on this device, so a phone and a laptop can differ.
- **Tables on phones.** Records tables (an event's Rankings and Insights, the Records page) show the team number only in a narrow first column, and a tap on it shows the team's name with a link to its page. Tighter cells fit about four stat columns on a 390 px phone instead of less than one.
- **No more zooming in on a field.** Text boxes use 16 px text on touch screens, so iPhones stop zooming the page in (and leaving it zoomed) when the keyboard opens. Pinch-zoom still works.

## 1.0.7 — 2026-10-18

A new home page, sharper predictions, and Scout pages that are faster to read and quicker to act on.

### Highlights
- [home] A new home page with a globe of this season's teams
- [predict] Prediction Engine 2.1 weighs form, momentum and match context
- [predict] Predict, rebuilt around the Lab and the latest live calls
- [teams] A My teams page, team colours and an easier Compare
- [offline] Download every season at once, and smoother scrolling

### Home
- **A new home page.** The headline "The whole field. In your corner." sits beside a globe of where this season's teams are from, with search and Predict / Find an event right at the top. Below are the season's totals (team listings, events, match scores), your team's next match, what's on the calendar, the public prediction record (live calls and season replays kept apart) and Control Scout's own opt-in usage. The globe turns slowly, with a pause button, and stays still for reduced motion. (#151, #157)
- **Teams by country.** Pick a country on the globe or from the list to see its team count, then open its teams with `/teams?country=`. Every team is counted once, including teams with no country listed. (#154)

### Predictions
- **Prediction Engine 2.0 and 2.1.** Win odds that account for match context, in-event form and momentum, plus fixes for official rules and bonus ranking points. Both engines' live calls are kept side by side so they can be compared fairly. (#136, #138, #140)
- **Predict, rebuilt.** The Lab (any four teams, any event) is a card you can't miss. A matchup starts from any team, and earlier seasons' calls are a click away. The header's right side now shows the latest live calls and how each one turned out. (#153, #155, #160)
- **Power rankings publish themselves** every Friday, with blurbs written by Bruno. (#145)

### Pages
- **My teams** has its own page, with your teams and their stats. (#150)
- **Compare:** a search that stays put, your teams one click away, and stats and charts on one screen. (#152)
- **Team colours.** Give each shortlisted team a colour; the shortlist and Compare use it. (#161)
- **Records tables** have a scrollbar above the table, and each column's numbers in its header's colour. (#159)
- **Team pages** open on the team's own numbers; your workspace's scouting take now comes last, after Matches. (#158)
- **Event pages:** the At a glance card shows the event's stats, and the LIVE panel puts Watch livestream and Track next to Know your match. (#143, #144)
- **Match rows:** the call has its own column, on two tidy lines, with the match report as an icon button. (#141)
- Motion on the new pages, like the rest of the app. (#156)

### Scouting
- **Assign teams by event name.** Type an event's name, city or code and pick it from that season's events. No code needed. (#162)

### Offline
- **Download all and Update all.** The Download page lists seasons in one place, with updates first, then saved, then not saved, and saves them one at a time. (#163)
- Offline packs only take over when there's no signal. (#142)

### Speed and scrolling
- The first paint no longer waits for the app; the privacy banner comes in the first HTML, page changes are prefetched, and event details are cached. (#146)
- Back and forward return to where you were, scrolling is lighter, and match rows don't light up while the page scrolls. (#147, #148)

## 1.0.6 — 2026-10-16

Shared scouting turns into match-day intelligence, and Scout becomes the app teams keep open at events.

### Highlights
- [live] Live mode counts down to your team's next match
- [report] Know your match: a pre-match report for every match
- [alerts] Push notifications before your tracked teams play
- [rankings] World rankings and weekly power rankings
- [share] Matchup cards to share in Discord and group chats

### Event day
- **Live mode.** While an event is running, its page shows a big LIVE state and counts down to the next match for your team, your assigned teams or your tracked teams, with the lineups and our call. Scores and rankings refresh on their own every 30 seconds, and the page goes back to normal when the event ends. (#128)
- **Know your match.** Every match has a pre-match report at `/events/…/match/…`, one tap from any match row or the LIVE panel. For all four robots it shows the call, OPR with its auto/TeleOp/endgame split, ranks, watch flags (your team, assigned, pick list, tracked, high penalties, inconsistent, rising) and your workspace's scouting consensus. With no scouting it falls back to OPR only, so it's never empty. (#131)
- **Push notifications.** Signed-in users can turn on notifications per device. You get one 15 minutes before a tracked team's match, another when an upset finishes at an event you follow, and another when a followed event starts. Each type can be switched off, and nothing arrives after its match has started. (#134)

### Scouting intelligence
- **Your team's take.** Team and Compare pages show your workspace's consensus: average ratings, strengths and weaknesses, most-noted answers, entry count and scouts. Only members of that workspace can see it. (#126)

### Rankings and sharing
- **World rankings** at `/rankings`. Every team is ranked by rating, with ↑/↓ movement since last week and Rising/Falling/Steady labels. You can filter by country, state or "My region", and pick past weeks, which are filled in back to the start of last season. (#129)
- **Power rankings** at `/power-rankings`. Each week's top 25 has written blurbs and gets its own shareable page, with an archive of past weeks. Each week is one markdown file, and a scaffold command pre-fills the top 25. (#133)
- **Share cards.** Matchups can be shared as branded images, e.g. "Our model gives 4215 a 73% win chance vs 33950", in wide and square sizes. Use the phone's share sheet or download the image, and Predict links show the card when posted in Discord. (#130)

### First visit
- **A short welcome tour** points first-time visitors to search, tracking a team and predictions. It's skippable, shows once and never to bots. (#127)
- **Add to home screen.** A gentle nudge appears at most once a day, and never again once dismissed or installed. On iPhone it shows a Share → Add to Home Screen hint instead. (#132)

### Reliability
- Uptime checker code (a Cloudflare Worker that alerts Discord when the site goes down). It's in the repo but not switched on. (#125)
- Live event pages no longer re-download unchanged data every 30 seconds. (#128)

## 1.0.5 — 2026-10-16

Scouting becomes a shared team workspace, plus a production-readiness and speed pass.

### Highlights
- [workspace] Team workspaces from Control Point, live like messaging
- [picklist] A shared pick list, assignments and comments
- [history] Version history, so an overwritten edit can be restored
- [offline] Entries saved offline sync when you reconnect
- [speed] Faster pages, clearer errors and a proper 404 page

### Team workspaces (with Control Point)

- **Workspaces from Control Point.** Sign in with "Continue with Control Point" and your Control Point workspaces show up in Scout. Control Point decides who belongs and who is an admin; Scout follows it. (Control Point #252, #103)
- **Spaces on the Scout page.** Switch between **Personal** and each workspace. Workspace members open their first workspace by default. Personal entries are never moved or merged. (#110)
- **Live, like messaging.** Entries a teammate adds, edits or deletes appear on everyone's screen in about a second, without a refresh. Each entry shows who wrote it and when ("Priya · 2m ago"). If the live connection drops, the page checks every 15 seconds instead, and a refresh button next to the space switcher forces an update. (#107, #122)
- **Permissions.** Members add entries and edit any entry; they delete only their own. Admins can delete any entry. The server enforces this. (#108)
- **"My team" / "My teams".** The YOURS row opens your workspace. With several workspaces it reads "My teams" and opens a picker. Your followed team stays one tap away. (#111)
- **Workspace templates.** Admins add custom fields to the match and pit forms, per season. Entries made under an older form still display correctly. (#111)
- **Workspace settings.** Settings has separate Personal and Workspace sections. Admins set the workspace's default season and event; members see them read-only. Your theme, density and notifications stay yours. (#114)
- **Members.** Settings › Workspace › Members lists everyone in the workspace. Admins can remove someone there, and the removal also happens in Control Point. Someone removed in Control Point loses Scout access within about a minute. The last admin can't be removed, and removal never deletes anyone's account or personal data. (Control Point #256, #116, #122)
- **Assignments.** Admins assign teams at an event to members. Members see "My assignments" with live progress and mark them done. "Assigned to …" badges show on entry cards. (#120)
- **Shared pick list.** One ordered pick list per workspace and season. Any member can add, remove, drag to reorder and leave a shared note, and changes show up live. Each pick shows OPR and world rank. You can copy your personal shortlist in. (#121)
- **Activity feed.** A per-workspace history of entries, edits, deletes, template and settings changes, photos, assignments, pick list changes and members joining or leaving. Kept 90 days. (#113)
- **Notifications.** A bell at the top right with an unread badge. It covers assignments, edits to your entries, comments, template changes, membership and pick list changes. Read state syncs across your devices, and each type can be switched off in Settings. (#115)
- **Comments.** Every workspace entry has a live comment thread. You can edit or delete your own comments; admins can delete any. The entry's author is notified. (#119)
- **Version history.** Each shared entry keeps its last 20 versions with who changed what. If someone else's edit overwrites yours, you see "Your edit was overwritten by …" with a field-by-field diff, and you can restore your version. (#118)
- **Search and filters.** Filter the entry feed by team, event, author, match or kind, search the notes, and sort by newest, team or match order. Filters are part of the page link. (#117)
- **CSV export.** Download a workspace's entries, or just the filtered ones, as a spreadsheet. The columns match your workspace's form, and the file opens cleanly in Google Sheets. (#112)
- **Photos.** Add up to 6 photos to a workspace entry. They're shrunk on the phone before upload and their location data is removed. Photos expire 2 days after their event ends, while the entry text stays. Storage has hard limits so it never grows into paid usage. (#109)
- **Offline.** Entries saved offline in a workspace sync when you reconnect, including when you open the app while offline. If you lose access before they sync, they move to Personal so nothing is lost. (#110, #122)
- **Deleted workspaces.** If a workspace is deleted in Control Point, or is left with no admin, its Scout space turns read-only with a banner, and everything in it can still be read and exported. If the workspace comes back, writing works again on its own. (#123)

### Owner tools

- **Owner portal** at `/owner`, visible only to the site owner. It covers usage, prediction health, on/off switches for live updates, workspace scouting, error reporting, offline packs and photos, the feedback inbox, error reports, data jobs, photo storage, orphaned workspaces, and an audit log of every owner action. (#106, #109, #123)
- **Error reporting.** When something breaks, the app offers "Something broke — report it?". Reports are stripped of personal information and filed as GitHub issues, and repeats are counted instead of duplicated. There's also a "Report a bug" option in Settings. (#102)

### Site and pages

- A branded 404 page, and real "not found" responses for unknown pages, teams and events. (#86)
- New Privacy policy, Terms of use and Contact pages, plus a site footer. (#82, #85, #92)
- A cookie consent banner. Anonymous page counts are taken only after "Allow", with no cookies and no third parties. (#81, #88)
- "Predict a match" and "Browse events" buttons on the home page. (#80)
- A sticky action bar on phones for team and event pages. (#84)
- Clear error messages on every form. (#95)
- Phones at 390 px: nothing clipped or unreachable. (#87)
- Colourful stat tiles on the team page and My team, a "Season so far" summary, and My team opens on the latest season the team played. (#98, #99)
- Smoother Shortlist drag that stays inside the table. (#90)
- Odds show plain percentages, and low ranks read "Bottom 10%" instead of "Top 91%". (#79, #101)

### Speed and reliability

- Pages paint before the app's code runs, and each page's code is preloaded. On phones, home's speed score went from 73 to 87 and the team page's from 50 to 75. (#93, #91)
- First visits no longer download the 1.6 MB offline pack, which saves about 1.6 MB per new visitor. (#83)
- The Events list loads in batches, and its search box no longer drops letters. (#94)
- CSV exports start downloading immediately. (#89)
- Deploys no longer cause brief "502" errors. (#97)

### Fixes

- When FIRST hasn't published a full score breakdown yet (usually briefly during live events), foul points for 2023 and later seasons are now credited to the right alliance. (#100)
- The public data snapshot can never include contact messages, usage stats or any private table. (#105)
