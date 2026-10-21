// Reliability index (#2): how dependable a robot has been, as a 0–100 estimate
// with its parts visible. Shared by the server (server/stats/reliability.ts
// stores it), the offline reader (packs) and the pages, so the rule is written
// once. A stated rule, not a fitted one.
//
// Parts, from public match data (qualification matches; a playoff alliance of
// three always sits one robot out, so playoffs never count as no-shows):
//   no-shows      listed for a played match but not on the field;
//   DQs           disqualified in a played match;
//   near-zero     estimated: the alliance's non-penalty score minus the
//                 partner's event OPR came to at most NEAR_ZERO_SHARE of an
//                 average robot's share at that event. An estimate, not proof:
//                 a robot on defense or a partner carrying the alliance looks
//                 the same;
//   swing         spread (sd) of that estimated contribution, in units of the
//                 event's average robot share;
//   penalties     penalty points the alliance gave away, per robot on the
//                 field, relative to the season's field average;
//   predictability the swing of the engine's live-call misses (report cards),
//                 relative to the field.
// Every part is pulled toward the season's field value as if the team had
// RELIABILITY_PRIOR more matches at it, so three clean matches don't read as
// perfect. Then
//   index = 100 − Σ weight × part      (clamped to 0..100)
// with the weights in RELIABILITY_WEIGHTS.

/** Prior weight (matches) pulling every part toward the season's field value. */
export const RELIABILITY_PRIOR = 10;
/** A match is near-zero when the estimated contribution is at most this share of an average robot's. */
export const NEAR_ZERO_SHARE = 0.1;
/** Caps, so one huge part can't stand for the whole index. */
export const SWING_CAP = 1.5, RATIO_CAP = 2;

export const RELIABILITY_WEIGHTS = {
  noShow: 150,
  dq: 100,
  nearZero: 50,
  swing: 20,
  penalties: 10,
  predictability: 10,
  /** Workspace-blended version only: share of the workspace's match entries marked broken / disabled / no-show. */
  workspace: 100,
} as const;

/** Stored per team (and the field), already shrunk. */
export interface ReliabilityParts {
  noShowRate: number;
  dqRate: number;
  nearZeroRate: number;
  /** sd of the estimated contribution ÷ the event's average robot share. */
  swing: number;
  /** Penalty points given per robot ÷ the field's. 1 = average. */
  penaltyRatio: number;
  /** Live-call miss spread ÷ the field's (1 when there are no live calls: the field). */
  predictabilityRatio: number;
}

export interface Reliability {
  /** 0–100, higher = more dependable. Public match data only. */
  index: number;
  /** Qualification matches the team was listed for (the sample size). */
  matches: number;
  noShows: number;
  dqs: number;
  nearZero: number;
  /** In the latest RECENT matches listed: no-shows and near-zero matches. */
  recent: { matches: number; noShows: number; nearZero: number };
  parts: ReliabilityParts;
  /** The season's field average index, for comparison. */
  fieldIndex: number | null;
}

/** GET /api/reliability?season=&teams=: public, match data only (never any workspace's notes). */
export interface ReliabilityResponse { season: number; fieldIndex: number | null; teams: { team: number; reliability: Reliability | null }[] }

/** How many of the latest matches "recent" covers. */
export const RECENT = 10;

/**
 * A ratio part's share of its weight: nothing at half the field's level or below, half at the field's level,
 * all of it at RATIO_CAP × the field's. So a clean team isn't marked down for being merely average elsewhere.
 */
export const excess = (ratio: number) => Math.max(0, Math.min(RATIO_CAP - 0.5, ratio - 0.5));

export function reliabilityIndex(p: ReliabilityParts, workspaceRate?: number): number {
  const w = RELIABILITY_WEIGHTS;
  const loss = w.noShow * p.noShowRate + w.dq * p.dqRate + w.nearZero * p.nearZeroRate
    + w.swing * Math.min(SWING_CAP, p.swing) + w.penalties * excess(p.penaltyRatio) + w.predictability * excess(p.predictabilityRatio)
    + (workspaceRate != null ? w.workspace * workspaceRate : 0);
  return Math.max(0, Math.min(100, Math.round(100 - loss)));
}

/** x over n observations pulled toward f with a prior worth k observations. */
export const shrinkTo = (x: number | null, n: number, f: number, k = RELIABILITY_PRIOR) => (x == null || n <= 0 ? f : (n * x + k * f) / (n + k));

/** Stored row (team_reliability) → Reliability. */
export function reliabilityFromRow(r: Record<string, unknown>, fieldIndex: number | null): Reliability {
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    index: n("idx"), matches: n("matches"), noShows: n("no_shows"), dqs: n("dqs"), nearZero: n("near_zero"),
    recent: { matches: n("recent_matches"), noShows: n("recent_no_shows"), nearZero: n("recent_near_zero") },
    parts: { noShowRate: n("no_show_rate"), dqRate: n("dq_rate"), nearZeroRate: n("near_zero_rate"), swing: n("swing"), penaltyRatio: n("penalty_ratio"), predictabilityRatio: n("predictability_ratio") },
    fieldIndex,
  };
}

// ---------------------------------------------------------------------------
// Workspace notes (members of that workspace only)
// ---------------------------------------------------------------------------

/** Words that mark a robot as broken, disabled, dead or absent. */
export const FAILURE_LABEL = /\b(broke|broken|break(s|ing)? down|disabled|dead|died|no[- ]?show|did ?n[o']t (show|move|run)|disconnect(ed)?|tipped)\b/i;

/** A negation before the failure words ("Never disabled", "Not tipped", "Was not a no-show", "Didn't break down"). */
const NEGATED = /\b(never|not|no|without|didn'?t|did not|isn'?t|is not|wasn'?t|was not|non)\b/i;

/**
 * Whether a yes/no field, answered yes, marks a failure: the built-in "Broke down / disabled" (id "broke"), or a
 * workspace's own field whose label names a failure with no negation before it. Scout templates carry no explicit
 * failure marker, so the label is all there is; "Never disabled" or "Not tipped" answered yes is good news, not a
 * failure. ("No-show" itself names the failure: the "no" there is part of the word, not a negation of it.)
 */
export function isFailureField(f: { id: string; label: string; type: string }): boolean {
  if (f.type !== "toggle") return false;
  if (f.id === "broke") return true;
  const m = FAILURE_LABEL.exec(f.label);
  return !!m && !NEGATED.test(f.label.slice(0, m.index));
}

/** One workspace's match entries on a team: how many, and how many were marked as a failure. */
export interface ReliabilityNotes { matchEntries: number; flagged: number }

/** The blended index a workspace's members see: the public parts plus the share of their own entries marked a failure (shrunk toward 0 failures). */
export function blendedIndex(r: Reliability, notes: ReliabilityNotes): number {
  const rate = shrinkTo(notes.matchEntries ? notes.flagged / notes.matchEntries : null, notes.matchEntries, 0);
  return reliabilityIndex(r.parts, rate);
}

/** "84" with a word for how it compares. */
export function reliabilityWord(index: number, field: number | null): string {
  if (field == null) return "";
  const d = index - field;
  return d >= 8 ? "steadier than most" : d <= -8 ? "less steady than most" : "about average";
}
