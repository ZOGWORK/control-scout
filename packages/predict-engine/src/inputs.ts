// Predict — the event shape the Forecaster reads.
//
// Structural types only: each app passes its own event payload (Control
// Point's FtcEventFull, Control Scout's EventFull), and anything carrying at
// least these fields fits. Kept deliberately small so the engine never
// depends on either app's data layer.

/** One alliance's score split. Nulls mean "not reported". */
export interface ScoreSplitInput {
  total: number | null;
  totalNp?: number | null;
  auto?: number | null;
  teleop?: number | null;
  endgame?: number | null;
  penaltiesCommitted?: number | null;
  /**
   * Recorded bonus ranking points (2025+; BIOBUZZ's swarm / pollinator 1 /
   * pollinator 2 use the same three slots). Null or missing = not reported:
   * the forecast then samples them instead of treating a guess as a fact.
   */
  bonusRp?: BonusFlags | null;
  /** BIOBUZZ (2026+): HIVE TIPs this alliance scored (auto + TeleOp), the second
   *  qualification sort criterion. Null or missing = not reported. */
  tips?: number | null;
}

/** A season's three bonus ranking points, in the engine's season-blind slots. */
export interface BonusFlags { movement: boolean; goal: boolean; pattern: boolean }

export interface AllianceInput {
  /** `dq`: disqualified in this match (T601: in a qualification match the team alone
   *  earns 0 ranking points and 0 for every sort criterion; its partner is unaffected). */
  teams: { number: number; surrogate?: boolean; dq?: boolean }[];
  score: ScoreSplitInput | null;
}

export interface MatchInput {
  /** `level:series:number` — must match MatchRecord keys folded into ratings. */
  key: string;
  label: string;
  level: "qual" | "playoff";
  series: number | null;
  number: number;
  /** ISO start time (actual, else scheduled). */
  time: string | null;
  played: boolean;
  red: AllianceInput;
  blue: AllianceInput;
}

export interface FieldEntryInput {
  teamNumber: number;
  /** Official quals rank, once published. */
  rank: number | null;
}

export interface AllianceSelectionInput {
  number: number;
  captain: number | null;
  picks: number[];
}

/** Everything about a live or finished event the Forecaster needs. */
export interface EventInput {
  season: number;
  code: string;
  type: string | null;
  /** YYYY-MM-DD */
  start: string | null;
  /** YYYY-MM-DD, the event's last day (apps use it to tell open events from finished ones). */
  end?: string | null;
  field: FieldEntryInput[];
  matches: MatchInput[];
  alliances: AllianceSelectionInput[];
}

/** FIRST advancement for an event (from /{season}/advancement/{code}). */
export interface FirstAdvancement {
  /** Where teams advance to (event code or a label), when published. */
  advancesTo: string | null;
  /** Number of advancement slots. */
  slots: number;
  /** Per-team outcome: FIRST = advanced from here, ALREADY_ADVANCING = qualified earlier, INELIGIBLE. */
  rows: { team: number; status: string; declined: boolean }[];
}
