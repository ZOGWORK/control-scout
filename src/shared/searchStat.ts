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
  partners?: StatLink[];
  opponents?: StatLink[];
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

export type StatBlock =
  /** Big numbers side by side ("312 points", "14 wins"). */
  | { kind: "kpis"; items: { label: string; value: string; sub?: string; href?: string; tone?: "accent" | "good" | "bad" }[] }
  /** A win-loss-tie record as a bar. */
  | { kind: "record"; title?: string; wins: number; losses: number; ties: number }
  /** Matches, best first or newest first as `title` says. */
  | { kind: "matches"; title: string; rows: StatMatchRow[]; more?: string }
  /** Rows of named columns; a row may link (its first cell is the link text). */
  | { kind: "table"; title: string; columns: { key: string; label: string; num?: boolean }[]; rows: { cells: Record<string, string | number | null>; href?: string; strong?: boolean }[]; more?: string }
  /** A value over time (events or seasons, oldest first): drawn as a line. */
  | { kind: "series"; title: string; unit?: string; points: { x: string; y: number | null; href?: string; note?: string }[] }
  /** Values as horizontal bars (phase split, two teams side by side). */
  | { kind: "bars"; title: string; groups: { label: string; items: { label: string; value: number | null; tone?: "a" | "b" | "c" | "d" }[] }[]; unit?: string }
  /** Teams ranked by one season number: each row's bar is the asked stat scaled to #1, with an OPR's auto, TeleOp and
   *  endgame split stacked in it. `note`: the season, how many teams are ranked and by what. */
  | { kind: "leaderboard"; title: string; stat: { id: string; label: string; unit?: string }; note: string; rows: LeaderboardRow[]; more?: StatLink;
      /** The season's TeleOp OPR includes the endgame, as FIRST reports it (server/data/seasons.ts, teleopAsReported). */
      teleopWithEndgame?: boolean }
  /** Buttons to pages (a championship's divisions). */
  | { kind: "links"; title: string; items: (StatLink & { sub?: string })[]; none?: string }
  /** Related questions, each run as a search. */
  | { kind: "related"; title: string; queries: string[] };

export interface StatAnswer {
  family: StatFamily;
  /** The intent's own name ("highest-score", "worlds-record"): counted, never shown. */
  intent: string;
  /** "Highest score at Worlds" */
  title: string;
  team?: { number: number; name: string | null };
  /** What the answer covers, as chips ("FIRST Championship events", "All seasons"). */
  scope: string[];
  /** The one number the question asks for, read first. */
  headline?: { value: string; label: string; sub?: string; href?: string };
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
