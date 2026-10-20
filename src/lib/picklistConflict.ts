// What stands between a kept pick list order change (picklistOps.ts) and sending it again: the list as the member
// saw it (base) against the list as it is now. Pure functions; sharedPicklist.ts decides what to do with them.
//
// - gone: the team it moves is no longer on the list. It can't mean anything now: the member discards it.
// - anchor: the team it was placed next to was removed. Applied anyway, it goes next to the nearest team that was
//   beside it then and is still there (rebased), the way the member saw it.
// - changed: someone changed the list since (teams added, removed or moved that this member's kept changes don't
//   name). Shown, so the member decides: apply theirs on top of the list as it is now, or discard.
import { applyPickOp, type Pick } from "../shared/picklist";
import type { OrderOp } from "./picklistOps";

export interface ListDiff { added: number[]; removed: number[]; moved: number[] }
export type PickConflict =
  | { kind: "gone"; team: number }
  | { kind: "anchor"; anchor: number; rebased: OrderOp }
  | ({ kind: "changed" } & ListDiff);

/** The teams a change names (its team, its anchor, or the teams it copies). */
export function teamsOf(op: OrderOp): number[] {
  switch (op.op) {
    case "import": return op.teams;
    case "remove": return [op.team];
    case "add": return op.beforeTeam != null ? [op.team, op.beforeTeam] : [op.team];
    case "move": { const a = op.afterTeam ?? op.beforeTeam; return a != null ? [op.team, a] : [op.team]; }
  }
}

const picksOf = (teams: readonly number[]): Pick[] => teams.map((team, i) => ({ team, rank: i + 1, addedBy: { accountId: null, name: "" }, addedAt: 0, note: "", noteBy: null, noteUpdatedAt: null }));

/** The order a change leaves `teams` in (unchanged when it can't apply). */
export function applied(teams: readonly number[], op: OrderOp): number[] {
  const r = applyPickOp(picksOf(teams), op, { accountId: null, name: "" }, 0);
  return r.ok ? r.picks.map((p) => p.team) : [...teams];
}

/** Teams in both lists whose order among each other changed (the fewest that explain it: not on the longest common run). */
function movedBetween(before: readonly number[], after: readonly number[]): number[] {
  const pos = new Map(after.map((t, i) => [t, i]));
  const common = before.filter((t) => pos.has(t));
  const seq = common.map((t) => pos.get(t)!);
  // Longest increasing subsequence of `seq` (patience sorting), as indexes into common.
  const tails: number[] = [], prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (seq[tails[mid]] < seq[i]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(common[i]);
  return common.filter((t) => !keep.has(t));
}

/** What changed from `before` to `after`, leaving out `ignore` (teams the member's own kept changes name). */
export function diffLists(before: readonly number[], after: readonly number[], ignore: Iterable<number> = []): ListDiff {
  const skip = new Set(ignore);
  const b = before.filter((t) => !skip.has(t)), a = after.filter((t) => !skip.has(t));
  const inB = new Set(b), inA = new Set(a);
  return { added: a.filter((t) => !inB.has(t)), removed: b.filter((t) => !inA.has(t)), moved: movedBetween(b, a) };
}

export const isEmptyDiff = (d: ListDiff) => !d.added.length && !d.removed.length && !d.moved.length;

/**
 * Where a change placed beside a team that's gone goes instead: beside the nearest team that was next to it in the
 * order the member meant (base with the change applied) and is still on the list. Below it when there's one, else
 * above it, else the end.
 */
export function rebase(op: OrderOp, base: readonly number[], current: readonly number[]): OrderOp {
  if (op.op !== "move" && op.op !== "add") return op;
  const meant = applied(base, op);
  const now = new Set(current);
  const i = meant.indexOf(op.team);
  const below = meant.slice(i + 1).find((t) => now.has(t) && t !== op.team);
  const above = [...meant.slice(0, Math.max(0, i))].reverse().find((t) => now.has(t) && t !== op.team);
  if (op.op === "add") return { op: "add", team: op.team, beforeTeam: below ?? null, ...(op.restore ? { restore: true } : {}) };
  if (below != null) return { op: "move", team: op.team, beforeTeam: below };
  if (above != null) return { op: "move", team: op.team, beforeTeam: null, afterTeam: above };
  return { op: "move", team: op.team, beforeTeam: null };
}

/**
 * What stops this change from going as it is (null: nothing). `base`: the order the member saw just before it;
 * `current`: the order now; `mine`: teams this member's kept changes for the list name (not someone else's change).
 */
export function conflictOf(op: OrderOp, base: readonly number[], current: readonly number[], mine: Iterable<number> = []): PickConflict | null {
  const now = new Set(current);
  if (op.op === "move" && !now.has(op.team)) return { kind: "gone", team: op.team };
  const anchor = op.op === "move" ? op.afterTeam ?? op.beforeTeam : op.op === "add" ? op.beforeTeam : null;
  // An add of a team already there changes nothing: no anchor to worry about.
  if (anchor != null && !now.has(anchor) && !(op.op === "add" && now.has(op.team))) return { kind: "anchor", anchor, rebased: rebase(op, base, current) };
  const d = diffLists(base, current, [...mine, ...teamsOf(op)]);
  return isEmptyDiff(d) ? null : { kind: "changed", ...d };
}

const list = (teams: number[]) => (teams.length <= 4 ? teams.join(", ") : `${teams.slice(0, 3).join(", ")} and ${teams.length - 3} more`);

/** The conflict, for a person (one sentence; the notice offers what to do). */
export function describeConflict(c: PickConflict): string {
  switch (c.kind) {
    case "gone": return `${c.team} is no longer on the pick list, so this move can't apply.`;
    case "anchor": {
      const r = c.rebased;
      const where = r.op === "move" && r.afterTeam != null ? `just after ${r.afterTeam}`
        : (r.op === "move" || r.op === "add") && r.beforeTeam != null ? `just before ${r.beforeTeam}` : "at the end";
      return `${c.anchor}, which it was placed next to, was removed. Applied now, it goes ${where}.`;
    }
    case "changed": {
      // Team numbers only: anything else (damaged storage) never reaches the sentence.
      const teams = (t: readonly unknown[]) => t.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
      c = { ...c, added: teams(c.added), removed: teams(c.removed), moved: teams(c.moved) };
      const parts = [
        c.added.length ? `${c.added.length === 1 ? "1 team" : `${c.added.length} teams`} added (${list(c.added)})` : "",
        c.removed.length ? `${c.removed.length === 1 ? "1 team" : `${c.removed.length} teams`} removed (${list(c.removed)})` : "",
        c.moved.length ? `${c.moved.length === 1 ? "1 team" : `${c.moved.length} teams`} moved (${list(c.moved)})` : "",
      ].filter(Boolean);
      return `The list changed since you made this: ${parts.join(", ")}.`;
    }
  }
}
