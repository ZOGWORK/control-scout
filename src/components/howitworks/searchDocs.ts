// What the FTC One Search page (and the hub's summary of it) says about search, as data. Every step and
// family here is checked against the code it describes (server/api/searchAnswer.ts answerFor, in that
// order), and every example query was run on the live site when the page was written: change one only after
// running it again.

/** The steps answerFor takes, in order; the first that fits answers. */
export const SEARCH_STEPS: { title: string; body: string; example: string; detail: string }[] = [
  {
    title: "Tidy the words",
    body: "Punctuation goes, spaces fold, case and accents are ignored.",
    example: "Meets this weekend!",
    detail: "Punctuation is dropped and spaces are folded; a query is read up to 160 characters, cut at a whole word. Case and accents are ignored, except for two-letter state codes that are also English words: \"OR\" is Oregon, \"or\" is just a word.",
  },
  {
    title: "Read it in any order",
    body: "Each word fills a slot: the team, what to find, the place, the time, the kind of event or match.",
    example: "closest match in Romania last month",
    detail: "The same slots in any order give the same question: \"Romania last month closest match\" reads the same. A word list says what each word can mean (\"blowout\" and \"most lopsided\" are the same measure), and a time is read against today (\"last month\" is the calendar month before this one). When every word has a job, the question is answered from the stored records with every filter applied, and the card names each filter. A word with no job sends the question on to the next steps, never guessed.",
  },
  {
    title: "Widen in a stated order",
    body: "Nothing in the time asked? It widens one step at a time, and says so on the card.",
    example: "highest score in California this week",
    detail: "A window with nothing in it widens in a fixed order: this week, then its season, then the season before. A place or leaderboard question with no season named reads the current season, and when it has nothing yet, the season before (\"No 2026–27 matches yet in California; showing 2025–26\"). Every other filter is kept as asked. A year you typed is never widened.",
  },
  {
    title: "Answer the question",
    body: "Fixed question shapes, tried in a fixed order: records, counts, leaders, winners, rules.",
    example: "4215 highest score in worlds",
    detail: "Questions the slots don't cover go to fixed question shapes, after a few phrasings are turned into one form (\"compare A and B\" becomes \"A vs B\"; \"who won worlds 2025\" is the 2024–25 championship). A team's own records come first, then explainers (\"what is OPR\"), counts, team facts (\"4215 school\"), team lists, events in a month, Worlds, leaderboards, predictions and advancement, award winners, rules and season high scores. Each answer is computed from the match and event records.",
  },
  {
    title: "Find the team, event or match",
    body: "A number, a name, an event code, or event words with a place and a time.",
    example: "hypnotic robotics",
    detail: "A bare number (\"4215\", \"team 4215\", \"#4215\") is that team. Two to four teams with \"vs\" open a comparison. A kind of event with a place and a time (\"meets this weekend\") lists those events. Otherwise names are matched word by word: a typo of one letter is forgiven in words of 4 to 7 letters and two in longer ones, and a name typed without spaces still matches. A weaker match is labelled \"Did you mean …?\".",
  },
  {
    title: "Say so when nothing fits",
    body: "No answer? It says what's missing and shows the closest real results.",
    example: "asdf",
    detail: "When nothing answers, the page says so in one sentence, shows the closest real teams and events as full cards (never as the answer), offers searches that do answer about them, and links to browse every team and event. A number that isn't a team gets the same honest page, never another team.",
  },
];

/** The kinds of answers it gives, each query run on the live site before it was listed (the PR that adds one says
 *  what it returned and when). `what` is the kind of answer it returns. */
export const SEARCH_FAMILIES: { title: string; q: string; what: string }[] = [
  { title: "A team", q: "4215", what: "That team's page" },
  { title: "A match", q: "USNJCMPPKWY Q12", what: "That match, by event code and number" },
  { title: "Two teams side by side", q: "4215 vs 6980", what: "Compare, with a prediction" },
  { title: "Head to head", q: "4215 vs 6980 head to head", what: "A head-to-head answer for the two teams" },
  { title: "A team's OPR", q: "4215 opr", what: "OPR for the season" },
  { title: "Phase splits", q: "4215 auto opr", what: "Auto OPR for the season" },
  { title: "Average score", q: "4215 average score", what: "The season's average alliance score" },
  { title: "Prediction rating", q: "4215 rating", what: "The team's prediction rating for the season" },
  { title: "Advancement odds", q: "4215 advancement", what: "The team's advancement odds" },
  { title: "A team's records", q: "4215 highest score in worlds", what: "The match, event, season and date" },
  { title: "Who won", q: "who won worlds last year", what: "Winning alliances" },
  { title: "Counts", q: "how many teams in NJ", what: "A number, with the list" },
  { title: "Leaderboards", q: "top teams in New Jersey", what: "A ranked table" },
  { title: "Team lists", q: "undefeated teams", what: "Every team that fits" },
  { title: "Teams in a place", q: "teams in Oradell", what: "By town, state or country" },
  { title: "Events by place and time", q: "meets this weekend", what: "Events, soonest first" },
  { title: "An event's tabs", q: "nj states rankings", what: "Opens that tab" },
  { title: "High scores", q: "highest score this season", what: "The top matches" },
  { title: "Team history", q: "when did hypnotic go to worlds", what: "Every appearance, newest first" },
  { title: "What a word means", q: "what is OPR", what: "A short explainer" },
  { title: "Several teams at once", q: "4215 vs 6980 vs 7149 opr", what: "Up to four teams on one stat" },
  { title: "A rule", q: "what is a minor foul", what: "The game manual's rule and its penalty" },
  { title: "Won Worlds?", q: "did 4215 win worlds", what: "Yes or no, with the best finish" },
  { title: "Match videos", q: "4215 videos at worlds", what: "Every match with video, to play here" },
];

/** "Ask in plain words": newer kinds of question, grouped by what they show. Each query was run on the live site
 *  (/api/search?answer=1) and came back with an answer card before it was listed. The lines say what kind of answer
 *  comes back, never its numbers or teams, since those change. */
export const SEARCH_SHOWCASE: { title: string; items: { q: string; what: string }[] }[] = [
  { title: "Leaderboards and counts", items: [
    { q: "team with the most matches 2025-26", what: "The team that played the most matches in a season" },
    { q: "top 10 teams in michigan by opr 2025-26", what: "A ranked table for one state and season, as long as you ask for" },
    { q: "lowest opr rookies in new jersey", what: "The bottom of a board, not just the top: rookie teams, lowest OPR first" },
    { q: "highest scoring matches in new jersey on march 15 2026", what: "The top-scoring matches on one day, in one state" },
  ] },
  { title: "Winners and awards", items: [
    { q: "who won nj turnpike division this year", what: "One division's winning alliance, with its final matches" },
    { q: "nj states winner", what: "“States” means the state championship: its winners and each division's" },
    { q: "East Bergen conference inspire award winner", what: "Who won one award at one event" },
  ] },
  { title: "One team, in plain words", items: [
    { q: "is 7149's rating rising or falling in 2025-26", what: "The prediction rating after each event, so you can see which way it went" },
    { q: "4215 teleop opr by event 2025-26", what: "One part of OPR, at each event of the season" },
    { q: "7149 events in june", what: "A team's events in one month" },
    { q: "what is my 4215 upcoming event", what: "The next event the team is listed for, once FIRST has posted it" },
    { q: "is 23268 a rookie team", what: "The team's rookie season and how many seasons it has played" },
    { q: "4215 at worlds", what: "The team's matches at the FIRST Championship" },
  ] },
  { title: "Comparisons and explanations", items: [
    { q: "4215 vs 6980 opr", what: "Two teams' OPR side by side" },
    { q: "explain 4215 opr in 2024/25", what: "A team's OPR in a past season, with what OPR means" },
    { q: "difference between auto and teleop", what: "A short explainer of a match's periods" },
  ] },
];

/** "Harder questions": the kinds that take more than one slot of each, or a filter, or two questions at once. Each
 *  query was run on the live site (/api/search?answer=1) and came back with a full answer card before it was listed. */
export const SEARCH_COMPLEX: { title: string; body: string; items: { q: string; what: string }[] }[] = [
  { title: "Compare two to four teams", body: "Any stat, side by side, in one season.", items: [
    { q: "4215 vs 6980 vs 7149 opr", what: "Three teams' OPR in one table" },
  ] },
  { title: "Season ranges", body: "From a year on, or between two, answered season by season.", items: [
    { q: "4215 opr since 2023", what: "The team's OPR rank in each season since 2023–24" },
    { q: "4215 opr 2022 to 2024", what: "The same, for 2022–23 to 2024–25" },
  ] },
  { title: "Leave some out", body: "“Not”, “no” and “didn't” take teams or matches off the list.", items: [
    { q: "top teams in new jersey not rookies", what: "A state's board without its rookie teams" },
    { q: "highest scoring matches in new jersey with no penalties", what: "Top matches where neither side gave up a penalty" },
    { q: "teams that didn't make worlds in new jersey", what: "A state's teams that weren't at the FIRST Championship" },
  ] },
  { title: "Two places", body: "Side by side, together, or teams from one place at another's events.", items: [
    { q: "texas vs michigan opr", what: "Two states' average OPR, side by side" },
    { q: "top teams in california and washington", what: "One board across both states" },
    { q: "louisiana teams at texas events", what: "Teams from one state, at the other's events" },
  ] },
  { title: "Two questions in one", body: "Joined with “and”, each part gets its own answer card.", items: [
    { q: "4215 opr and 6980 record", what: "One team's OPR, another team's record" },
    { q: "4215 awards and highest score in new jersey", what: "A team's awards, then its best score in one state" },
  ] },
  { title: "Matches and match boards", body: "One match by event and number, or a place's best, worst and closest.", items: [
    { q: "USNJCMPPKWY Q12", what: "That match, by event code and number" },
    { q: "closest matches in michigan", what: "A state's tightest finishes" },
    { q: "lowest scoring matches in texas", what: "The bottom of a state's board" },
  ] },
  { title: "Rules, when and where", body: "The game manual, an event's dates, a team's home.", items: [
    { q: "what is a minor foul", what: "The rule from the game manual, with its penalty" },
    { q: "when is the michigan state championship 2026", what: "The event's dates and place" },
    { q: "where is 7149 from", what: "The team's town, state and FIRST region" },
  ] },
  { title: "Yes or no", body: "A straight answer first, then what it's based on.", items: [
    { q: "did 4215 win worlds", what: "No or yes, with the team's best finish at Worlds" },
  ] },
];

/** "Video search": matches with video, by team, event, place or season. Each run on the live site with a list of
 *  matches with video before it was listed. */
export const SEARCH_VIDEO: { q: string; what: string }[] = [
  { q: "4215 videos at worlds", what: "Every match a team played at Worlds that has video" },
  { q: "7149 highlights 2025-26", what: "A team's standout matches of one season" },
  { q: "nj states videos", what: "Match videos from a state championship" },
  { q: "highlights in michigan 2025-26", what: "A state's best, closest and biggest matches, with video" },
  { q: "worlds 2025 videos", what: "Match videos from one FIRST Championship" },
];

/** Worked readings for the "how a query is read" figure: each word and what it was read as. */
export type Role = "team" | "stat" | "scope" | "place" | "time" | "kind" | "filler" | "versus" | "filter" | "and";
export const READINGS: { q: string; words: { w: string; role: Role }[]; result: string }[] = [
  { q: "4215 highest score in worlds", words: [{ w: "4215", role: "team" }, { w: "highest score", role: "stat" }, { w: "in", role: "filler" }, { w: "worlds", role: "scope" }], result: "One team's best alliance score at the FIRST Championship" },
  { q: "upcoming meets in New Jersey", words: [{ w: "upcoming", role: "time" }, { w: "meets", role: "kind" }, { w: "in", role: "filler" }, { w: "New Jersey", role: "place" }], result: "A list of events, soonest first" },
  { q: "4215 vs 6980", words: [{ w: "4215", role: "team" }, { w: "vs", role: "versus" }, { w: "6980", role: "team" }], result: "Compare, never counted as a team" },
  { q: "4215 opr since 2023", words: [{ w: "4215", role: "team" }, { w: "opr", role: "stat" }, { w: "since 2023", role: "time" }], result: "OPR rank in each season, 2023–24 on" },
  { q: "texas vs michigan opr", words: [{ w: "texas", role: "place" }, { w: "vs", role: "versus" }, { w: "michigan", role: "place" }, { w: "opr", role: "stat" }], result: "Two states side by side: average OPR" },
  { q: "top teams in new jersey not rookies", words: [{ w: "top teams", role: "stat" }, { w: "in", role: "filler" }, { w: "new jersey", role: "place" }, { w: "not rookies", role: "filter" }], result: "A state's board, rookie teams left out" },
  { q: "4215 opr and 6980 record", words: [{ w: "4215", role: "team" }, { w: "opr", role: "stat" }, { w: "and", role: "and" }, { w: "6980", role: "team" }, { w: "record", role: "stat" }], result: "Two questions, two answer cards" },
  { q: "how many teams in OR", words: [{ w: "how many", role: "stat" }, { w: "teams", role: "kind" }, { w: "in", role: "filler" }, { w: "OR", role: "place" }], result: "A count: \"OR\" in capitals is Oregon" },
];
