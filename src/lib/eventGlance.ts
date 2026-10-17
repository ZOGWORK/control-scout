// The event page's "At a glance" card: event stats computed from the event detail the page already
// has (no extra request). Pure, so every stat is tested without a browser (eventGlance.test.ts).
//
// Each stat is null (or an empty list) when it doesn't apply, and the card hides it: no "—" filler.
//   - Scoring stats count played matches with both scores; a remote event (one team per match, no
//     opponent) has no margins, closest match or upsets.
//   - Calls: live (logged before the match) and backtest (replayed) are never blended (AGENTS.md rule 9).
//   - Category leaders come from this event's OPR, so they appear once matches have been played.
//   - Before an event starts: the strongest teams by rating and the field's average season OPR.
import type { EventDetail, MatchView } from "../shared/api";
import { nextMatch } from "./liveMode";

export type Phase = "upcoming" | "quals" | "playoffs" | "done";
export interface TeamRef { team: number; name: string | null }
export interface TeamValue extends TeamRef { value: number }
export interface MatchRef { key: string; label: string }

export interface CallRecord { kind: "live" | "backtest"; n: number; right: number }

export interface GlanceStats {
  phase: Phase;
  teams: number;
  /** Matches played / scheduled; null when no schedule yet. */
  progress: { played: number; total: number } | null;
  /** Average alliance score (total, penalties in), over played matches. */
  avgScore: number | null;
  high: (MatchRef & { score: number; alliance: "red" | "blue"; teams: number[] }) | null;
  /** Average winning margin over decided matches. */
  avgMargin: number | null;
  closest: (MatchRef & { margin: number }) | null;
  /** Penalty points given away per match (both alliances). */
  avgPenalty: number | null;
  record: CallRecord[];
  /** Favourites that lost, in the headline kind of call (live first). */
  upsets: { kind: "live" | "backtest"; n: number; of: number; biggest: (MatchRef & { pFav: number }) | null } | null;
  leaders: { auto: TeamValue | null; teleop: TeamValue | null; endgame: TeamValue | null };
  /** Live only: the next match to be played (by schedule order). */
  next: (MatchRef & { startsAt: string | null; time: string | null }) | null;
  /** Finished only. */
  ended: string | null;
  winners: { alliance: number | null; teams: number[] } | null;
  inspire: TeamRef | null;
  /** Upcoming with a field: the strongest teams by prediction rating, and the field's average season OPR. */
  strongest: TeamValue[];
  avgSeasonOpr: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ref = (m: MatchView): MatchRef => ({ key: m.key, label: m.label });
const hasTeams = (a: MatchView["red"]) => a.teams.length > 0;
/** Played with both alliances on the field and scored (not a remote match). */
const headToHead = (m: MatchView) => m.played && !!m.red.score && !!m.blue.score && hasTeams(m.red) && hasTeams(m.blue);

/** How the predictions did here, live calls and backtest replays kept apart
 *  (decided matches only; live first when there are any). */
export function callRecord(matches: MatchView[]): CallRecord[] {
  const decided = matches.filter((m) => m.played && m.prediction && m.red.score && m.blue.score && m.red.score.total !== m.blue.score.total);
  return (["live", "backtest"] as const).map((kind) => {
    const xs = decided.filter((m) => m.prediction!.kind === kind);
    return { kind, n: xs.length, right: xs.filter((m) => (m.prediction!.pRed > 0.5) === (m.red.score!.total > m.blue.score!.total)).length };
  }).filter((x) => x.n > 0);
}

export function phaseOf(d: Pick<EventDetail, "event" | "matches">): Phase {
  const { status } = d.event;
  if (status === "finished") return "done";
  const ms = d.matches;
  if (!ms.length) return "upcoming"; // no schedule yet, even on the day
  if (ms.every((m) => m.played)) return "done";
  const quals = ms.filter((m) => m.level === "qual");
  // Playoffs: one has been played, or every qualification match has.
  if (ms.some((m) => m.level === "playoff" && m.played) || (quals.length > 0 && quals.every((m) => m.played) && ms.some((m) => m.level === "playoff"))) return "playoffs";
  return status === "upcoming" && !ms.some((m) => m.played) ? "upcoming" : "quals";
}

function leader(d: EventDetail, k: "auto" | "teleop" | "endgame"): TeamValue | null {
  let best: TeamValue | null = null;
  for (const f of d.field) {
    const v = f.opr[k];
    if (v != null && Number.isFinite(v) && (!best || v > best.value)) best = { team: f.team, name: f.name, value: v };
  }
  return best;
}

/** The winning teams, captain first when their alliance is known (any not on it, e.g. a backup, after). */
function inAllianceOrder(teams: number[], a: EventDetail["alliances"][number] | undefined): number[] {
  const order = a ? [a.captain, a.pick1, a.pick2, a.backup].filter((t): t is number => t != null && teams.includes(t)) : [];
  return [...order, ...teams.filter((t) => !order.includes(t))];
}

export function glanceStats(d: EventDetail): GlanceStats {
  const e = d.event;
  const played = d.matches.filter((m) => m.played);
  const h2h = e.remote ? [] : played.filter(headToHead);

  // Every scored alliance with teams on it (a remote match has one).
  const alliances = played.flatMap((m) => (["red", "blue"] as const)
    .filter((c) => m[c].score && hasTeams(m[c]) && (e.remote || headToHead(m)))
    .map((c) => ({ m, c, score: m[c].score! })));
  let high: GlanceStats["high"] = null;
  for (const a of alliances) {
    if (!high || a.score.total > high.score) high = { ...ref(a.m), score: a.score.total, alliance: a.c, teams: a.m[a.c].teams.map((t) => t.number) };
  }

  const decided = h2h.filter((m) => m.red.score!.total !== m.blue.score!.total);
  let closest: GlanceStats["closest"] = null;
  for (const m of h2h) {
    const margin = Math.abs(m.red.score!.total - m.blue.score!.total);
    if (!closest || margin < closest.margin) closest = { ...ref(m), margin };
  }

  const record = callRecord(e.remote ? [] : d.matches);
  let upsets: GlanceStats["upsets"] = null;
  if (record.length) {
    const kind = record[0].kind;
    const lost = h2h.filter((m) => m.prediction?.kind === kind && m.red.score!.total !== m.blue.score!.total
      && (m.prediction.pRed > 0.5) !== (m.red.score!.total > m.blue.score!.total));
    let biggest: NonNullable<GlanceStats["upsets"]>["biggest"] = null;
    for (const m of lost) {
      const pFav = Math.max(m.prediction!.pRed, 1 - m.prediction!.pRed);
      if (!biggest || pFav > biggest.pFav) biggest = { ...ref(m), pFav };
    }
    upsets = { kind, n: lost.length, of: record[0].n, biggest };
  }

  const live = e.status === "live";
  const nm = live ? nextMatch(d.matches, null) : null;

  const finished = e.status === "finished";
  const winTeams = finished ? d.awards.filter((a) => a.type === "Winner").map((a) => a.team) : [];
  const winAlliance = winTeams.length ? d.alliances.find((a) => [a.captain, a.pick1, a.pick2].some((t) => t != null && winTeams.includes(t))) : undefined;
  const insp = finished ? d.awards.find((a) => a.type === "Inspire" && a.placement === 1) : undefined;

  const upcoming = e.status === "upcoming" && !played.length;
  const strongest = upcoming
    ? d.field.filter((f) => f.rating).map((f) => ({ team: f.team, name: f.name, value: f.rating!.np })).sort((a, b) => b.value - a.value || a.team - b.team).slice(0, 3)
    : [];
  const seasonOprs = upcoming ? d.field.map((f) => f.seasonOpr).filter((x): x is number => x != null && Number.isFinite(x)) : [];

  return {
    phase: phaseOf(d),
    teams: d.field.length || e.teams,
    progress: d.matches.length ? { played: played.length, total: d.matches.length } : null,
    avgScore: mean(alliances.map((a) => a.score.total)),
    high,
    avgMargin: mean(decided.map((m) => Math.abs(m.red.score!.total - m.blue.score!.total))),
    closest,
    avgPenalty: h2h.length ? mean(h2h.map((m) => m.red.score!.pen + m.blue.score!.pen)) : null,
    record,
    upsets,
    leaders: { auto: leader(d, "auto"), teleop: leader(d, "teleop"), endgame: leader(d, "endgame") },
    next: nm ? { ...ref(nm), startsAt: nm.startsAt, time: nm.time } : null,
    ended: finished ? (e.end ?? e.start) : null,
    winners: winTeams.length ? { alliance: winAlliance?.number ?? null, teams: inAllianceOrder(winTeams, winAlliance) } : null,
    inspire: insp ? { team: insp.team, name: d.field.find((f) => f.team === insp.team)?.name ?? null } : null,
    strongest,
    // Half the field at least, or it isn't the field's average.
    avgSeasonOpr: seasonOprs.length && seasonOprs.length * 2 >= d.field.length ? mean(seasonOprs) : null,
  };
}
