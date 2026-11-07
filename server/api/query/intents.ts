// What a query asks for, from the symbols it holds (docs/search-pipeline.md, "Intent"): one table, read in any word
// order. A rule names the symbols it needs (`all`) and the ones it takes in when they're there (`opt`), and how many
// teams it's about. The rule that explains the most of the query wins; a symbol no rule explains leaves the query to
// search's older readers, never to a guess. A new way to ask is a new phrase in ./lexicon.ts or a rule here.

/** The answer kinds the executor (./execute.ts) knows. Team intents are the stat answers' own ids
 *  (server/api/answers/read.ts IntentId); the rest are the pipeline's. */
export type PipelineIntent =
  // One team.
  | "highest-score" | "lowest-score" | "biggest-win" | "biggest-loss" | "closest-match" | "first-match" | "recent-match" | "last-matches"
  | "best-finish" | "worst-finish" | "average-rank" | "first-event" | "last-event" | "best-opr-event" | "best-season" | "first-season"
  | "wins-count" | "losses" | "ties-count" | "record" | "win-percent" | "average-score" | "median-score" | "average-margin" | "total-points"
  | "total-matches" | "total-events" | "seasons-count" | "current-streak" | "longest-streak" | "highest-auto" | "highest-teleop" | "highest-endgame"
  | "most-penalties" | "penalties" | "score-range" | "score-consistency" | "awards" | "total-awards" | "results" | "event-rank" | "event-opr"
  | "best-partner" | "partners" | "opponents" | "team-opr" | "team-rating" | "team-predict" | "playoff-matches" | "qual-matches"
  | "match-lookup" | "avg-penalties" | "inspire-awards" | "finalist-finishes" | "lost-to-most" | "season-matches"
  // Two teams.
  | "head-to-head" | "shared-matches" | "two-predict" | "opr-vs" | "rating-vs" | "compare" | "h2h-wins" | "awards-vs"
  // No team.
  | "top-matches" | "leaderboard"
  // A scope's standout matches, or one team's (./highlights.ts).
  | "highlights"
  // No team: the teams with a name said as words (server/api/answers/teamsNamed.ts), and a town's teams counted.
  | "teams-named" | "count-teams"
  // A team's number over a season, event by event (the readers' trend cards).
  | "rating-trend" | "opr-trend"
  // Four teams, two on each alliance: a match's call ("predict a b vs c d").
  | "alliance-predict"
  // No team: matches found by a measure (./matchFind.ts).
  | "low-matches" | "close-matches" | "lopsided-matches" | "penalty-matches" | "upset-matches" | "comeback-matches";

export interface IntentRule {
  id: PipelineIntent;
  /** Teams named: 0, 1 or 2; 4 is two alliances of two, either side of a "vs". */
  teams: 0 | 1 | 2 | 4;
  /** Symbols the rule needs ("agg:max", "metric:score", "predict"). */
  all: string[];
  /** Symbols it takes in when present. */
  opt?: string[];
  /** The query must name an event or a state championship ("12345 rank at nj states"). */
  event?: boolean;
  /** The query must name no event. */
  noEvent?: boolean;
  /** A count asked for ("top 5", "last 10 matches"). */
  n?: boolean;
  /** A match's number given ("match 12", "q12"). */
  matchNo?: boolean;
  /** The query must give no match's number: "did a team win match 2" is that match, never its wins. */
  noMatchNo?: boolean;
}

const SCORE_LIKE = ["metric:score", "thing:match", "thing:event"];
/** A win or a loss, as a filter on a team's matches. */
const OUTCOMES = ["metric:win", "metric:loss", "outcome:W", "outcome:L"];
/** The season numbers a leaderboard ranks teams by. */
const BOARD_METRICS = ["metric:opr", "metric:rating", "metric:winrate", "metric:auto", "metric:teleop", "metric:endgame", "metric:reliability"];
/** What a leaderboard takes in: its stats, a record beside them (every row shows it), "by". */
// Penalties only beside "team" ("which team fouls the least"): the most penalties alone are the matches with the most.
const BOARD_OPT = ["thing:team", ...BOARD_METRICS, "metric:penalty", "per:match", "metric:record", "metric:win", "prep:by", "list"];
const R = (id: PipelineIntent, teams: 0 | 1 | 2 | 4, all: string[], opt: string[] = [], more: Partial<IntentRule> = {}): IntentRule => ({ id, teams, all, opt, ...more });

/** Every rule. Order breaks a tie between rules that explain the same symbols. */
export const INTENTS: IntentRule[] = [
  // One team: the best or worst of its matches.
  R("highest-score", 1, ["agg:max", "metric:score"], ["thing:match", "thing:event"]),
  R("lowest-score", 1, ["agg:min", "metric:score"], ["thing:match", "thing:event"]),
  R("biggest-win", 1, ["agg:max", "metric:win"], ["metric:margin", "thing:match", "outcome:W"]),
  R("biggest-win", 1, ["agg:max", "metric:margin"], ["outcome:W", "thing:match"]),
  R("biggest-loss", 1, ["agg:max", "metric:loss"], ["metric:margin", "thing:match", "outcome:L"]),
  R("closest-match", 1, ["agg:closest"], ["thing:match", "metric:win", "metric:loss", "metric:margin", "metric:score", "outcome:W", "outcome:L"]),
  R("closest-match", 1, ["agg:min", "metric:margin"], ["thing:match", "metric:win", "metric:loss", "outcome:W", "outcome:L"]),
  R("highest-auto", 1, ["agg:max", "metric:auto"], SCORE_LIKE),
  R("highest-teleop", 1, ["agg:max", "metric:teleop"], SCORE_LIKE),
  R("highest-endgame", 1, ["agg:max", "metric:endgame"], SCORE_LIKE),
  R("most-penalties", 1, ["agg:max", "metric:penalty"], SCORE_LIKE),
  // A win or a loss said with them is a filter: "first win", "when did they last lose a match", "last 5 losses".
  R("first-match", 1, ["agg:first", "thing:match"], ["agg:max", ...OUTCOMES]),
  R("last-matches", 1, ["agg:last", "thing:match"], ["metric:score", ...OUTCOMES], { n: true }),
  R("recent-match", 1, ["agg:last", "thing:match"], ["metric:score", ...OUTCOMES]),
  R("first-match", 1, ["agg:first", "metric:win"], ["thing:match", "per:match"]),
  R("first-match", 1, ["agg:first", "metric:loss"], ["thing:match", "per:match"]),
  R("last-matches", 1, ["agg:last", "metric:win"], ["thing:match", "per:match"], { n: true }),
  R("last-matches", 1, ["agg:last", "metric:loss"], ["thing:match", "per:match"], { n: true }),
  R("recent-match", 1, ["agg:last", "metric:win"], ["thing:match", "per:match"]),
  R("recent-match", 1, ["agg:last", "metric:loss"], ["thing:match", "per:match"]),
  // Playing, said as a verb ("when did they last play", "the first time they played a match"): its last or first match.
  R("recent-match", 1, ["agg:last", "vs"], ["thing:match", "per:match"], { noMatchNo: true }),
  R("first-match", 1, ["agg:first", "vs"], ["thing:match", "per:match"], { noMatchNo: true }),
  // "Latest" alone beside a team ("12345 latest"): its most recent match.
  R("recent-match", 1, ["agg:last"], [], { noEvent: true, noMatchNo: true }),
  // Its events and seasons.
  R("best-finish", 1, ["agg:max", "metric:rank"], ["thing:event"], { noEvent: true }),
  R("worst-finish", 1, ["agg:min", "metric:rank"], ["thing:event"], { noEvent: true }),
  R("average-rank", 1, ["agg:mean", "metric:rank"], ["thing:event"], { noEvent: true }),
  R("first-event", 1, ["agg:first", "thing:event"], [], { noEvent: true }),
  R("last-event", 1, ["agg:last", "thing:event"], [], { noEvent: true }),
  R("best-opr-event", 1, ["agg:max", "metric:opr", "thing:event"], [], { noEvent: true }),
  R("best-season", 1, ["agg:max", "thing:season"], [], { noEvent: true }),
  R("first-season", 1, ["agg:first", "thing:season"], [], { noEvent: true }),
  // Counts, means and records over its matches.
  R("wins-count", 1, ["agg:count", "metric:win"], ["thing:match"]),
  // "Did 12345 ever win a match": its wins, none said as none.
  R("wins-count", 1, ["metric:win", "thing:match"], [], { noMatchNo: true }),
  R("losses", 1, ["metric:loss"], ["agg:count", "thing:match"]),
  R("ties-count", 1, ["metric:tie"], ["agg:count", "thing:match"]),
  R("record", 1, ["metric:record"], ["metric:win", "metric:loss", "metric:tie", "thing:match", "per:event"]),
  // "Wins vs losses", "wins and losses": the record, as said.
  R("record", 1, ["metric:win", "metric:loss"], ["vs", "and", "compare", "metric:tie", "thing:match", "per:event"]),
  R("win-percent", 1, ["metric:winrate"], ["thing:match"]),
  R("average-score", 1, ["agg:mean", "metric:score"], ["thing:match", "per:match"]),
  R("average-score", 1, ["metric:score", "per:match"], ["thing:match"]),
  R("median-score", 1, ["agg:median", "metric:score"], ["thing:match"]),
  R("average-margin", 1, ["agg:mean", "metric:margin"], ["outcome:W", "outcome:L", "metric:win", "thing:match"]),
  R("total-points", 1, ["agg:sum", "metric:score"], ["thing:match"]),
  R("total-matches", 1, ["agg:count", "thing:match"], ["agg:sum"]),
  // "Total" alone counts things too ("12345 total matches", "total events", "total awards").
  R("total-matches", 1, ["agg:sum", "thing:match"], []),
  R("total-events", 1, ["agg:count", "thing:event"], ["agg:sum"], { noEvent: true }),
  R("total-events", 1, ["agg:sum", "thing:event"], [], { noEvent: true }),
  R("seasons-count", 1, ["agg:count", "thing:season"], [], { noEvent: true }),
  R("longest-streak", 1, ["agg:max", "metric:streak"], OUTCOMES),
  R("current-streak", 1, ["metric:streak"], ["agg:last", "metric:win", "metric:loss", "outcome:W", "outcome:L"]),
  R("avg-penalties", 1, ["agg:mean", "metric:penalty"], ["thing:match"]),
  // Its card is per event: "penalties trend", "getting better or worse at penalties" read it too.
  R("penalties", 1, ["metric:penalty"], ["thing:match", "per:match", "per:event", "per:rate", "agg:mean", "agg:count", "agg:sum", "trend", "prep:at"]),
  R("score-range", 1, ["metric:range"], ["metric:score"]),
  R("score-consistency", 1, ["metric:consistency"], ["metric:score"]),
  R("playoff-matches", 1, ["level:playoff", "thing:match"], ["list"], { noEvent: true }),
  R("qual-matches", 1, ["level:qual", "thing:match"], ["list"], { noEvent: true }),
  // Awards.
  R("total-awards", 1, ["agg:count", "metric:award"], ["agg:sum", "metric:win", "list"]),
  R("total-awards", 1, ["agg:sum", "metric:award"], ["metric:win", "list"]),
  R("awards", 1, ["metric:award"], ["list", "agg:first", "agg:last", "metric:win"]),
  // At one event.
  R("match-lookup", 1, ["thing:match"], ["metric:score", "metric:record", "metric:win", "metric:loss"], { event: true, matchNo: true }),
  R("results", 1, ["thing:match"], ["list", "metric:score", "metric:record"], { event: true }),
  R("event-rank", 1, ["metric:rank"], [], { event: true }),
  R("event-opr", 1, ["metric:opr"], [], { event: true }),
  // A state championship or Worlds alone ("12345 states", "12345 at worlds"): the team's results there.
  R("results", 1, ["states"], ["list"]),
  R("results", 1, ["worlds"], ["list"]),
  // Its matches, no measure asked ("12345 matches in 2025-26"): every one in the scope. After the rules above (a tie goes to the first), so a
  // measure, an outcome, a match type or an event said ("12345 matches at states") still picks its own answer.
  R("season-matches", 1, ["thing:match"], ["list"], { noEvent: true, noMatchNo: true }),
  // Partners and opponents.
  R("best-partner", 1, ["agg:max", "metric:partner"], ["thing:team"]),
  R("partners", 1, ["metric:partner"], ["list", "thing:team"]),
  R("opponents", 1, ["metric:opponent"], ["list", "thing:team"]),
  // "Who did 12345 lose to the most": the opponents that beat it, most often first.
  // A count ("how many teams has it lost to") is a different answer: left unexplained.
  R("lost-to-most", 1, ["metric:opponent", "outcome:L"], ["agg:max", "thing:team", "thing:match", "per:match", "list"]),
  // The team's own numbers: its OPR, its rating, its forecast.
  // How the rating or OPR moved, event by event: "trend", "going up or down", "at each event".
  R("rating-trend", 1, ["metric:rating", "trend"], ["per:event", "thing:event", "list", "agg:last"], { noEvent: true }),
  R("rating-trend", 1, ["metric:rating", "per:event"], ["thing:event", "list", "agg:last"], { noEvent: true }),
  R("opr-trend", 1, ["metric:opr", "trend"], ["per:event", "thing:event", "list", "agg:last"], { noEvent: true }),
  R("opr-trend", 1, ["metric:opr", "per:event"], ["thing:event", "list", "agg:last"], { noEvent: true }),
  R("team-opr", 1, ["metric:opr"], ["agg:last"], { noEvent: true }),
  R("team-rating", 1, ["metric:rating"], ["agg:last"], { noEvent: true }),
  R("team-predict", 1, ["predict"], ["metric:win", "metric:record", "metric:score", "metric:rank", "thing:event", "thing:match", "agg:next", "metric:playoffs", "review", "agg:last", "advance"]),
  // Two alliances of two: a match's call. "Vs" between them is enough, with no other word.
  R("alliance-predict", 4, ["vs"], ["predict", "and", "compare", "metric:win", "metric:score", "metric:margin", "thing:match", "per:match"]),
  // Two teams.
  R("two-predict", 2, ["predict"], ["vs", "and", "compare", "metric:win", "metric:score", "metric:margin", "thing:match"]),
  // Either alliance: "on the same alliance" (partners only) isn't a filter the shared list takes, so it stays unexplained.
  R("shared-matches", 2, ["together"], ["vs", "and", "thing:match", "list"]),
  R("shared-matches", 2, ["and", "thing:match"], ["list"]),
  R("head-to-head", 2, ["vs", "thing:match"], ["list", "metric:record"]),
  R("h2h-wins", 2, ["vs", "metric:win"], ["agg:count", "thing:match"]),
  // "12345 and 67890 awards" is each team's own list (search's AND list); a versus or a comparison is the side by side.
  R("opr-vs", 2, ["metric:opr", "vs"], ["compare"]),
  R("opr-vs", 2, ["metric:opr", "compare"], []),
  R("rating-vs", 2, ["metric:rating", "vs"], ["compare"]),
  R("rating-vs", 2, ["metric:rating", "compare"], []),
  R("awards-vs", 2, ["metric:award", "vs"], ["compare", "agg:max", "agg:count", "metric:win"]),
  R("awards-vs", 2, ["metric:award", "compare"], ["agg:max", "agg:count", "metric:win"]),
  R("compare", 2, ["compare"], ["vs", "and"]),
  R("compare", 2, ["vs"], []),
  // No team: the best matches anywhere, and ranked lists of teams.
  R("top-matches", 0, ["agg:max", "metric:score"], ["thing:match", "per:match", "nopen"]),
  R("top-matches", 0, ["agg:max", "thing:match"], ["metric:score", "nopen"]),
  // Matches by a measure ("and" is "with": "the match with the most penalty points").
  R("low-matches", 0, ["agg:min", "metric:score"], ["thing:match", "nopen", "and"]),
  R("close-matches", 0, ["agg:closest"], ["thing:match", "metric:score", "metric:margin", "metric:win", "metric:loss", "outcome:W", "outcome:L", "and"]),
  R("close-matches", 0, ["agg:min", "metric:margin"], ["thing:match", "metric:win", "metric:loss", "metric:score", "outcome:W", "outcome:L", "and"]),
  R("lopsided-matches", 0, ["agg:max", "metric:margin"], ["thing:match", "metric:win", "metric:score", "outcome:W", "and"]),
  R("penalty-matches", 0, ["agg:max", "metric:penalty"], ["thing:match", "metric:score", "and"]),
  R("upset-matches", 0, ["metric:upset"], ["agg:max", "thing:match", "metric:win", "metric:margin", "metric:score", "and"]),
  R("comeback-matches", 0, ["metric:comeback"], ["agg:max", "thing:match", "metric:win", "and"]),
  ...["agg:max", "agg:min"].flatMap((agg) => [
    R("leaderboard", 0, [agg, "thing:team"], BOARD_OPT),
    // A team stat asked about everyone, with no "team": "who has the highest auto OPR in NJ".
    ...BOARD_METRICS.map((m) => R("leaderboard", 0, [agg, m], BOARD_OPT)),
  ]),
  // Standout matches: a scope's ("worlds highlights", "new jersey highlights 2024-25"), or one team's ("<team> best
  // matches at worlds"); its match videos ("jackson division recap", "watch <team>") are its highlights too.
  ...([0, 1] as const).flatMap((n) => [
    R("highlights", n, ["highlights"], ["videos", "thing:match", "list", "agg:max"], { noMatchNo: true }),
    R("highlights", n, ["videos"], ["thing:match", "thing:event", "list", "agg:max", "agg:last"], { noMatchNo: true }),
  ]),
  // The teams with a name, counted and listed: "how many teams named …", "teams called …".
  R("teams-named", 0, ["named"], ["agg:count", "thing:team", "list"]),
  R("count-teams", 0, ["agg:count", "thing:team"], ["list"], { noEvent: true }),
  // Teams with no losses, the most wins first.
  // "and" is "with": "teams with a perfect record".
  R("leaderboard", 0, ["undefeated"], [...BOARD_OPT, "agg:max", "agg:min", "metric:loss", "and"]),
];

/** Symbols that are slots, never what is asked: always taken in. */
export const SLOT_SYMBOLS = /^(?:level|finals|alliance|worlds|states|award|prep|filler)(?::|$)/;

export interface IntentPick { rule: IntentRule; unexplained: string[] }

/** The rule for these symbols, `teams` teams named and an event named or not, or null. */
export function pickIntent(symbols: Set<string>, teams: number, opts: { event: boolean; n: boolean; matchNo?: boolean }): IntentPick | null {
  const atEvent = opts.event || symbols.has("states");
  const asked = [...symbols].filter((s) => !SLOT_SYMBOLS.test(s) || s === "level:playoff" || s === "level:qual");
  let best: { rule: IntentRule; score: number; unexplained: string[] } | null = null;
  for (const rule of INTENTS) {
    if (rule.teams === 4 ? teams !== 4 : rule.teams !== Math.min(teams, 2) || teams > 2) continue;
    if (rule.event && !atEvent) continue;
    if (rule.noEvent && opts.event) continue;
    if (rule.noMatchNo && opts.matchNo) continue;
    if (rule.n && !opts.n) continue;
    // A match's number is only a match lookup's, and a match lookup needs one.
    if (!!rule.matchNo !== !!opts.matchNo && (rule.matchNo || rule.event)) continue;
    if (!rule.all.every((s) => symbols.has(s))) continue;
    const took = new Set([...rule.all, ...(rule.opt ?? [])]);
    // A match type is a scope for every rule but the match-type lists themselves.
    // A match type is a scope for every rule but the match-type lists themselves.
    const unexplained = asked.filter((s) => !took.has(s) && !/^level:/.test(s));
    const score = rule.all.length * 2 + (rule.opt ?? []).filter((s) => symbols.has(s)).length - unexplained.length * 3 + (rule.n ? 1 : 0) + (rule.matchNo ? 1 : 0);
    if (!best || score > best.score) best = { rule, score, unexplained };
  }
  return best ? { rule: best.rule, unexplained: best.unexplained } : null;
}
