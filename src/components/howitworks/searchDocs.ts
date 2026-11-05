// What the FTC One Search page (and the hub's summary of it) says about search, as data. Every step and
// family here is checked against the code it describes (server/api/searchAnswer.ts answerFor, in that
// order), and every example query was run on the live site when the page was written: change one only after
// running it again.

/** The steps answerFor takes, in order; the first that fits answers. */
export const SEARCH_STEPS: { title: string; body: string; example: string; detail: string }[] = [
  {
    title: "Tidy the words",
    body: "Punctuation goes, spaces fold, a few common plurals turn singular.",
    example: "Meets this weekend!",
    detail: "Punctuation is dropped and spaces are folded; the query is cut at 80 characters. A fixed list of plurals (meets, events, matches, teams, championships, qualifiers and a few more) is turned singular, because names are matched by the start of each word. Case and accents are ignored, except for two-letter state codes that are also English words: \"OR\" is Oregon, \"or\" is just a word.",
  },
  {
    title: "Reword common phrasings",
    body: "A few ways of asking are turned into the one form the next steps know.",
    example: "compare 4215 and 6980",
    detail: "\"compare A and B\", \"is A better than B\" and two bare team numbers become \"A vs B\". \"teams near X\" becomes \"teams in X\" (there are no distances). A year on a Worlds question becomes its season: \"who won worlds 2025\" is the 2024–25 championship. The result keeps the words you typed in its label and notes what it changed.",
  },
  {
    title: "Answer the question",
    body: "Fixed question shapes, tried in a fixed order: records, counts, leaders, winners, rules.",
    example: "4215 highest score in worlds",
    detail: "A team's own records first (highest score, biggest win, streaks), then explainers (\"what is OPR\"), counts (\"how many teams in NJ\"), team facts (\"4215 school\"), team lists (\"undefeated teams\"), teams in a place, events in a month, Worlds, an event's tabs and matches, leaderboards and stat leaders, predictions and advancement, award winners, rules, season high scores and team questions (\"when did hypnotic go to worlds\"). Each answer is computed from the match and event records.",
  },
  {
    title: "Find the events",
    body: "Event words plus a place and a time become a list of events.",
    example: "meets this weekend",
    detail: "A kind of event (meet, qualifier, championship, scrimmage…), a place (a state or province by name or code, a city or a venue) and a time (today, tomorrow, this or next weekend, week or month, upcoming, past, a month, a year or a season) together pick a set of events. Upcoming events come soonest first, past ones most recent first.",
  },
  {
    title: "Find the team, event or match",
    body: "A number, a name, an event code or two teams to compare.",
    example: "hypnotic robotics",
    detail: "A bare number (\"4215\", \"team 4215\", \"#4215\") is that team. Two to four teams with \"vs\" open a comparison. Otherwise names are matched word by word: a typo of one letter is forgiven in words of 4 to 7 letters and two in longer ones, and a name typed without spaces still matches. A weaker match is labelled \"Did you mean …?\".",
  },
  {
    title: "Say so when nothing fits",
    body: "No exact match? It says so and shows the closest, labelled.",
    example: "asdf",
    detail: "When nothing matches every word, the page says \"Nothing matched … exactly\" and lists up to ten closest matches, each with the words it did match, under \"Closest matches (not an exact match)\". A number that isn't a team gets the same honest page, never another team. It never shows a closest match as if it were the answer.",
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
];

/** Worked readings for the "how a query is read" figure: each word and what it was read as. */
export type Role = "team" | "stat" | "scope" | "place" | "time" | "kind" | "filler" | "versus";
export const READINGS: { q: string; words: { w: string; role: Role }[]; result: string }[] = [
  { q: "4215 highest score in worlds", words: [{ w: "4215", role: "team" }, { w: "highest score", role: "stat" }, { w: "in", role: "filler" }, { w: "worlds", role: "scope" }], result: "One team's best alliance score at the FIRST Championship" },
  { q: "upcoming meets in New Jersey", words: [{ w: "upcoming", role: "time" }, { w: "meets", role: "kind" }, { w: "in", role: "filler" }, { w: "New Jersey", role: "place" }], result: "A list of events, soonest first" },
  { q: "4215 vs 6980", words: [{ w: "4215", role: "team" }, { w: "vs", role: "versus" }, { w: "6980", role: "team" }], result: "Compare, never counted as a team" },
  { q: "how many teams in OR", words: [{ w: "how many", role: "stat" }, { w: "teams", role: "kind" }, { w: "in", role: "filler" }, { w: "OR", role: "place" }], result: "A count: \"OR\" in capitals is Oregon" },
];
