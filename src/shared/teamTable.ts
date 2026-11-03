// A search answer that lists teams ("teams in California", "top 10 teams by OPR in NJ", "undefeated teams"), as one
// table: a row per team with its season OPR, the OPR's phases, the penalties it gives away and its record. Every
// number is a stored season number (team_season_stats, the ones each team page shows): the server reads them in the
// same query that lists the teams, and the page only sorts the rows it was sent (src/components/search/TeamTable.tsx).

import type { LeaderboardRow } from "./searchStat";

/** One team in the table. `rank`: its place in the list as asked (the server's order). */
export interface TeamTableRow {
  rank: number;
  team: number;
  name: string | null;
  /** "Oradell, NJ" */
  location: string | null;
  href: string;
  /** Season OPR without penalties: the team's best event. */
  opr: number | null;
  /** Each phase's own best that season (maybe at different events), so they don't add up to `opr`. */
  auto: number | null;
  /** Driver-controlled (TeleOp) points, the endgame left out. */
  dc: number | null;
  endgame: number | null;
  /** Penalty points given away a match: the team's lowest at any event that season. */
  pen: number | null;
  wins: number;
  losses: number;
  ties: number;
  /** The list's own number when it isn't ranked by OPR ("100% wins", "top 40% → top 12%"). */
  asked?: { value: number | null; display: string };
}

export type TeamSortKey = "rank" | "opr" | "auto" | "dc" | "endgame" | "pen" | "record" | "asked";

export interface TeamTable {
  /** What the list is ranked by, its sort when it opens. "rank": as listed (the asked number's order). */
  by: Exclude<TeamSortKey, "record">;
  /** The list's own column ("Win rate"), when the rows carry `asked`. */
  asked?: { label: string };
  rows: TeamTableRow[];
}

/** The columns' one-line definitions (header titles, the legend and the first paint's table). */
export const TEAM_COLUMNS: { key: Exclude<TeamSortKey, "rank" | "asked">; label: string; def: string }[] = [
  { key: "opr", label: "OPR", def: "Points added to the alliance's score, penalties left out (the team's best event)" },
  { key: "auto", label: "Auto", def: "Autonomous OPR: the team's best at any event that season" },
  { key: "dc", label: "DC", def: "Driver-controlled (TeleOp) OPR, endgame left out: its best that season" },
  { key: "endgame", label: "Endgame", def: "Endgame OPR: the team's best at any event that season" },
  { key: "pen", label: "Pen", def: "Penalty points given away a match: its lowest at any event (lower is better)" },
  { key: "record", label: "W-L-T", def: "The season's wins, losses and ties; sorted by win share (a tie counts half)" },
];

/** The honest note under the phase columns: each is its own best, so they never add up to the OPR. */
export const PHASE_NOTE = "Auto, DC and Endgame are each the team's own best that season, maybe from different events, so they don't add up to the OPR. The phase bar compares phases between teams, not shares of the OPR.";

/** A key's first-click direction: bigger is better, except penalties given away. */
export const firstDir = (key: TeamSortKey): "asc" | "desc" => (key === "rank" || key === "pen" ? "asc" : "desc");

const share = (r: TeamTableRow) => { const n = r.wins + r.losses + r.ties; return n ? (r.wins + 0.5 * r.ties) / n : -1; };
const valueOf = (r: TeamTableRow, key: TeamSortKey): number | null =>
  key === "rank" ? r.rank : key === "record" ? share(r) : key === "asked" ? r.asked?.value ?? null : r[key];

/** The rows sorted by one column (a missing number always last), ties kept in the list's own order. */
export function sortTeamRows(rows: readonly TeamTableRow[], key: TeamSortKey, dir: "asc" | "desc" = firstDir(key)): TeamTableRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = valueOf(a, key), y = valueOf(b, key);
    if (x == null || y == null) return x == null && y == null ? a.rank - b.rank : x == null ? 1 : -1;
    if (x !== y) return sign * (x - y);
    if (key === "record" && a.wins !== b.wins) return b.wins - a.wins;
    return a.rank - b.rank;
  });
}

/** Whether any row has a phase number (an older season's or a remote event's may have none). */
export const hasPhases = (rows: readonly TeamTableRow[]) => rows.some((r) => r.auto != null || r.dc != null || r.endgame != null || r.pen != null);

const RECORD = /^(\d+)-(\d+)-(\d+)$/;
const TEAM_IN_HREF = /^\/teams\/(\d+)/;

/** A stat leaderboard's rows (server/api/answers/families/leaderboard.ts) as the same table. */
export function teamTableOfLeaderboard(statId: string, statLabel: string, rows: readonly LeaderboardRow[]): TeamTable {
  const by: TeamTable["by"] = ({ opr: "opr", auto: "auto", teleop: "dc", endgame: "endgame" } as Record<string, TeamTable["by"]>)[statId] ?? "rank";
  return {
    by,
    ...(by === "rank" ? { asked: { label: statLabel } } : {}),
    rows: rows.map((r) => {
      const rec = RECORD.exec(r.record);
      const number = Number(TEAM_IN_HREF.exec(r.team.href)?.[1] ?? r.team.label.split(" ")[0]);
      return {
        rank: r.rank, team: number, name: r.team.label.replace(/^\d+\s*/, "") || null, location: r.location, href: r.team.href,
        opr: r.opr, auto: r.parts?.auto ?? null, dc: r.parts?.teleop ?? null, endgame: r.parts?.endgame ?? null, pen: r.parts?.pen ?? null,
        wins: rec ? Number(rec[1]) : 0, losses: rec ? Number(rec[2]) : 0, ties: rec ? Number(rec[3]) : 0,
        ...(by === "rank" ? { asked: { value: r.value, display: r.display } } : {}),
      };
    }),
  };
}
