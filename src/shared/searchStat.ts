// A stat answer on /search (server/api/answers/): one question about a team's records ("4215 highest score in worlds",
// "4215 worlds record", "4215 average score this season"), answered from the stored matches, events and awards, as
// blocks the page draws (src/components/search/page/StatAnswer.tsx). Data only: the server never sends a picture.
// Every answer says what it counted (`definition`) and from which records (`source`), and nothing found is said
// plainly (`none`), never filled in with another team's or another season's numbers.

/** The implementation family an intent belongs to (the brief's eight; server/api/answers/families). */
export type StatFamily = "stat" | "trend" | "superlative" | "aggregate" | "event" | "two-team" | "leaderboard" | "awards";

/** A link inside an answer: a site path. */
export interface StatLink { label: string; href: string }

/** One match a team played, as an answer lists it. */
export interface StatMatchRow {
  /** "Q45", "Final 2" */
  label: string;
  href: string;
  event: StatLink;
  /** "2024–25" */
  season: string;
  /** YYYY-MM-DD (the match's own time, else its event's first day) */
  date: string | null;
  alliance: "red" | "blue";
  /** The team's alliance's score and the other's (with penalties, as the result was decided). */
  own: number;
  opp: number;
  /** The alliance's score without penalties, when it's what the answer ranks by. */
  ownNp?: number | null;
  result: "W" | "L" | "T";
  /** `ranked`, the period an answer ranks by (`phases` holds its points). */
  ranked?: "auto" | "teleop" | "endgame";
  partners?: StatLink[];
  opponents?: StatLink[];
  /** The other alliance's score without penalties. */
  oppNp?: number | null;
  /** The event's type as FIRST lists it ("Qualifier", "FIRSTChampionship"): its Events-card colour. */
  type?: string | null;
  /** The alliance's points by period (without penalties), as reported: TeleOp with the endgame where FIRST counts it
   *  so (`teleopWithEndgame`); only Auto for a totals-only match. `pen`, the penalty points it gave away. */
  phases?: { auto: number | null; teleop?: number | null; endgame?: number | null; pen?: number | null; teleopWithEndgame?: boolean } | null;
  /** Its place in a ranked list (1 is the top score). */
  rank?: number;
  /** The team the row is about (not in `partners`): the first chip on its alliance. Each row its own (a list of
   *  matches across several teams). */
  self?: StatLink;
}

/** One team on a leaderboard. `value` is the asked stat (as `display` shows it); `parts`, an OPR's split. */
export interface LeaderboardRow {
  rank: number;
  team: StatLink;
  location: string | null;
  record: string;
  opr: number | null;
  value: number | null;
  display: string;
  /** `pen`: penalty points given away a match (the season's lowest), beside the phases. */
  parts?: { auto: number | null; teleop: number | null; endgame: number | null; pen?: number | null } | null;
}

/** A season OPR (np, without penalties) or one of its phases, as the team page keys them. */
export type OprPhase = "np" | "auto" | "teleop" | "endgame";

/** Wins, losses and ties. */
export type StatRecord = { wins: number; losses: number; ties: number };

export type StatBlock =
  /** Big numbers side by side ("312 points", "14 wins"). Items with a `phase` are a team's season OPR and its parts, drawn
   *  as the team page's OPR tiles (its colours, its rank line and bar from `rank` and `of`; a match's phase points have no
   *  rank: `sub` is the line and `pc`, 0 to 100, the bar). */
  | { kind: "kpis"; items: { label: string; value: string; sub?: string; href?: string; tone?: "accent" | "good" | "bad"; phase?: OprPhase; rank?: number | null; of?: number | null; pc?: number }[] }
  /** A win-loss-tie record as a bar. */
  | { kind: "record"; title?: string; wins: number; losses: number; ties: number;
      /** The same matches as qualifications and playoffs (only when the matches hold both). */
      split?: { quals: StatRecord; playoffs: StatRecord } }
  /** Matches, best first or newest first as `title` says. */
  | { kind: "matches"; title: string; rows: StatMatchRow[]; more?: string }
  /** Rows of named columns; a row may link (its first cell is the link text). A row about one event may carry its
   *  `type` (FIRST's event type, "Qualifier"): its name then gets the Events cards' type colour. */
  | { kind: "table"; title: string; columns: { key: string; label: string; num?: boolean }[]; rows: { cells: Record<string, string | number | null>; href?: string; strong?: boolean; type?: string | null;
      /** The event the row's match was at, linked from its event cell (a match row's link is the match). */
      eventHref?: string;
      /** A match row's two alliances, as team chips in their alliance colours, and which won (the official result,
       *  penalties included; null on a tie). */
      teams?: { red: StatLink[]; blue: StatLink[] }; winner?: "red" | "blue" | null }[]; more?: string }
  /** A value over time (events or seasons, oldest first): drawn as a line. */
  | { kind: "series"; title: string; unit?: string; points: { x: string; y: number | null; href?: string; note?: string }[] }
  /** Values as horizontal bars (phase split, two teams side by side). */
  | { kind: "bars"; title: string; groups: { label: string; items: { label: string; value: number | null; tone?: "a" | "b" | "c" | "d" }[] }[]; unit?: string }
  /** Teams ranked by one season number: each row's bar is the asked stat scaled to #1, with an OPR's auto, TeleOp and
   *  endgame split stacked in it. `note`: the season, how many teams are ranked and by what. */
  | { kind: "leaderboard"; title: string; stat: { id: string; label: string; unit?: string }; note: string; rows: LeaderboardRow[]; more?: StatLink;
      /** The season's TeleOp OPR includes the endgame, as FIRST reports it (server/data/seasons.ts, teleopAsReported). */
      teleopWithEndgame?: boolean;
      /** The lowest first: drawn in the list's own order, never re-sorted highest first. */
      lowest?: boolean }
  /** Two or more teams compared (server/api/answers/compareBlock.ts): a row per metric, Total first and then by the
   *  gap, each on its own scale from zero. `scale`: what each row's max is, for the footnote ("100", "the 2025–26 high, rounded up"). */
  | { kind: "compare"; title: string; teams: StatLink[]; rows: CompareRow[]; scale?: string }
  /** Buttons to pages (a championship's divisions). */
  | { kind: "links"; title: string; items: (StatLink & { sub?: string })[]; none?: string }
  /** Related questions, each run as a search. */
  | { kind: "related"; title: string; queries: string[] }
  /** A chance on a 0–100% scale (the search results guide, §8 "Prediction"): the number, a bar split at it from 0, the
   *  call's score with its range when there is one, and the card's one action (Open in Predict). */
  | { kind: "chance"; label: string; p: number; who: string; note?: string; action?: StatLink };

/** One metric in a comparison (server/api/answers/compareBlock.ts). */
export interface CompareRow {
  label: string;
  /** Each team's value as it reads, in the block's team order. */
  values: string[];
  /** The better team's index; null on a tie, a missing value or a stat with no better side. */
  best: number | null;
  /** How far ahead the better one is ("+42.7", "Even"). */
  gap?: string;
  /** The gap as a number (the rows' sort key). */
  diff?: number;
  /** The row's scale, from zero (the season's highest, rounded up): drawn as paired bars to `nums`, "max" printed.
   *  Absent: a row of values only. */
  max?: number;
  nums?: (number | null)[];
  /** On a tie for the lead: the teams level at the top, by index. */
  tied?: number[];
  /** Why a row with a scale has no bars ("below zero: no bars"). */
  note?: string;
}

export interface StatAnswer {
  family: StatFamily;
  /** The intent's own name ("highest-score", "worlds-record"): counted, never shown. */
  intent: string;
  /** "Highest score at Worlds" */
  title: string;
  /** The page's own heading, when the card's `title` only complements it (a winning-alliance answer's page names the
   *  event and season; its card, what it holds). Absent: the page heading is built around `title`. */
  heading?: string;
  team?: { number: number; name: string | null };
  /** Every team the answer is about, when it's more than `team` (a two-team answer's both sides, `team` first). */
  teams?: { number: number; name: string | null }[];
  /** What the answer covers, as chips ("FIRST Championship events", "All seasons"). */
  scope: string[];
  /** The one number the question asks for, read first. */
  /** `type`: the headline is one event, of FIRST's event type (null when FIRST lists none): drawn with its type chip. */
  /** `teams` and `alliance`: the headline is one alliance's score, its teams drawn as chips in its colour. */
  headline?: { value: string; label: string; sub?: string; href?: string; type?: string | null; teams?: StatLink[]; alliance?: "red" | "blue" };
  blocks: StatBlock[];
  /** The rule applied, in words ("Highest score: the alliance's points without penalties, …"). */
  definition: string;
  /** Where the numbers come from ("312 matches at 41 events, 2019–20 to 2025–26"). */
  source: string;
  /** Nothing found for what was asked, said plainly. */
  none?: string;
  /** A small "View more detail" link to a page set to the same list (the Teams page's filters). */
  more?: StatLink;
}
