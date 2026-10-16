// The pick list's operations (Task 11): what each does, and that concurrent reorders merge the same way
// whichever arrives first, because operations name teams rather than positions.
import { describe, expect, it } from "vitest";
import { applyPickOp, cleanPickOp, isPickList, MAX_PICKS, moveOpFor, type Pick, type PickOp } from "./picklist";
import { newer, withPending } from "../lib/sharedPicklist";

const me = { accountId: 1, name: "Priya" };
const list = (...teams: number[]): Pick[] => teams.map((team, i) => ({ team, rank: i + 1, addedBy: me, addedAt: 1, note: "", noteBy: null, noteUpdatedAt: null }));
const teams = (r: ReturnType<typeof applyPickOp>) => (r.ok ? r.picks.map((p) => p.team) : r.reason);
const run = (start: Pick[], ops: PickOp[]) => ops.reduce((l, op) => { const r = applyPickOp(l, op, me, 2); return r.ok ? r.picks : l; }, start).map((p) => p.team);

describe("applyPickOp", () => {
  it("adds at the end or before a team (the end when that team is gone); adding a listed team changes nothing", () => {
    expect(teams(applyPickOp(list(1, 2), { op: "add", team: 3 }, me, 5))).toEqual([1, 2, 3]);
    expect(teams(applyPickOp(list(1, 2), { op: "add", team: 3, beforeTeam: 2 }, me, 5))).toEqual([1, 3, 2]);
    expect(teams(applyPickOp(list(1, 2), { op: "add", team: 3, beforeTeam: 9 }, me, 5))).toEqual([1, 2, 3]);
    const same = applyPickOp(list(1, 2), { op: "add", team: 2 }, me, 5);
    expect(same).toMatchObject({ ok: true, changed: false });
    const r = applyPickOp(list(1), { op: "add", team: 2 }, me, 5);
    expect(r.ok && r.picks[1]).toEqual({ team: 2, rank: 2, addedBy: me, addedAt: 5, note: "", noteBy: null, noteUpdatedAt: null });
    expect(applyPickOp(list(...Array.from({ length: MAX_PICKS }, (_, i) => i + 1)), { op: "add", team: 999 }, me, 5)).toEqual({ ok: false, reason: "full" });
  });

  it("removes (gone already: no change) and renumbers", () => {
    const r = applyPickOp(list(1, 2, 3), { op: "remove", team: 2 }, me, 5);
    expect(r.ok && r.picks.map((p) => [p.team, p.rank])).toEqual([[1, 1], [3, 2]]);
    expect(applyPickOp(list(1), { op: "remove", team: 2 }, me, 5)).toMatchObject({ ok: true, changed: false });
  });

  it("moves before a team or to the end; a team or anchor that's gone is 'missing'", () => {
    expect(teams(applyPickOp(list(1, 2, 3, 4), { op: "move", team: 4, beforeTeam: 2 }, me, 5))).toEqual([1, 4, 2, 3]);
    expect(teams(applyPickOp(list(1, 2, 3, 4), { op: "move", team: 1, beforeTeam: null }, me, 5))).toEqual([2, 3, 4, 1]);
    expect(applyPickOp(list(1, 2), { op: "move", team: 1, beforeTeam: 2 }, me, 5)).toMatchObject({ ok: true, changed: false });
    expect(applyPickOp(list(1, 2), { op: "move", team: 3, beforeTeam: 1 }, me, 5)).toEqual({ ok: false, reason: "missing" });
    expect(applyPickOp(list(1, 2), { op: "move", team: 1, beforeTeam: 3 }, me, 5)).toEqual({ ok: false, reason: "missing" });
  });

  it("notes: last write wins, stamped with its writer and time", () => {
    const a = applyPickOp(list(1), { op: "note", team: 1, note: "fast" }, me, 5);
    const b = a.ok ? applyPickOp(a.picks, { op: "note", team: 1, note: "slow" }, { accountId: 2, name: "Marcus" }, 9) : a;
    expect(b.ok && b.picks[0]).toMatchObject({ note: "slow", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: 9 });
    expect(applyPickOp(list(1), { op: "note", team: 2, note: "x" }, me, 5)).toEqual({ ok: false, reason: "missing" });
  });

  it("copies a shortlist in: new teams at the end, in its order, up to the cap", () => {
    const r = applyPickOp(list(2), { op: "import", teams: [3, 2, 1] }, me, 5);
    expect(r).toMatchObject({ ok: true, changed: true, added: [3, 1] });
    expect(teams(r)).toEqual([2, 3, 1]);
  });

  it("moves after a team (dragged down) too", () => {
    expect(teams(applyPickOp(list(1, 2, 3, 4), { op: "move", team: 1, beforeTeam: null, afterTeam: 3 }, me, 5))).toEqual([2, 3, 1, 4]);
    expect(applyPickOp(list(1, 2), { op: "move", team: 1, beforeTeam: null, afterTeam: 9 }, me, 5)).toEqual({ ok: false, reason: "missing" });
  });

  it("a drag becomes a move anchored to the last team it passed", () => {
    expect(moveOpFor([1, 2, 3, 4, 5], [5, 1, 2, 3, 4], 5)).toEqual({ op: "move", team: 5, beforeTeam: 1 });
    expect(moveOpFor([1, 2, 3, 4, 5], [1, 3, 4, 2, 5], 2)).toEqual({ op: "move", team: 2, beforeTeam: null, afterTeam: 4 });
    expect(moveOpFor([1, 2, 3], [2, 3, 1], 1)).toEqual({ op: "move", team: 1, beforeTeam: null, afterTeam: 3 });
    expect(moveOpFor([1, 2, 3], [1, 3, 2], 3)).toEqual({ op: "move", team: 3, beforeTeam: 2 });
  });

  it("concurrent reorders merge deterministically: the same list whichever arrives first", () => {
    const start = list(1, 2, 3, 4, 5);
    // Member A drags 5 to the top while member B drags 2 below 4, both from the same list.
    const a = moveOpFor([1, 2, 3, 4, 5], [5, 1, 2, 3, 4], 5);
    const b = moveOpFor([1, 2, 3, 4, 5], [1, 3, 4, 2, 5], 2);
    expect(run(start, [a, b])).toEqual([5, 1, 3, 4, 2]);
    expect(run(start, [b, a])).toEqual([5, 1, 3, 4, 2]);
    // One drags 3 to the bottom while another drags 4 to the top.
    const c = moveOpFor([1, 2, 3, 4, 5], [1, 2, 4, 5, 3], 3), d = moveOpFor([1, 2, 3, 4, 5], [4, 1, 2, 3, 5], 4);
    expect(run(start, [c, d])).toEqual([4, 1, 2, 5, 3]);
    expect(run(start, [d, c])).toEqual([4, 1, 2, 5, 3]);
    // Whatever the mix, every device that applies the same operations in the same order ends on the same list.
    const ops: PickOp[] = [a, b, c, d, { op: "remove", team: 1 }, { op: "move", team: 2, beforeTeam: 1 }, { op: "add", team: 6, beforeTeam: 4 }];
    expect(run(start, ops)).toEqual(run(list(1, 2, 3, 4, 5), ops));
    expect(run(start, ops)).toEqual([5, 3, 6, 4, 2]); // the move naming removed team 1 changes nothing
  });
});

describe("cleanPickOp", () => {
  it("accepts each operation and refuses bad ones", () => {
    expect(cleanPickOp({ op: "add", team: 18360 })).toEqual({ op: "add", team: 18360, beforeTeam: null });
    expect(cleanPickOp({ op: "move", team: 1, beforeTeam: null })).toEqual({ op: "move", team: 1, beforeTeam: null });
    expect(cleanPickOp({ op: "move", team: 1, afterTeam: 2 })).toEqual({ op: "move", team: 1, beforeTeam: null, afterTeam: 2 });
    expect(cleanPickOp({ op: "note", team: 1, note: `  ${"x".repeat(600)} ` })).toMatchObject({ note: "x".repeat(500) });
    expect(cleanPickOp({ op: "import", teams: [1, 1, 2] })).toEqual({ op: "import", teams: [1, 2] });
    for (const bad of [{ op: "add", team: "1" }, { op: "move", team: 1 }, { op: "move", team: 1, beforeTeam: 1 }, { op: "move", team: 1, beforeTeam: 2, afterTeam: 3 }, { op: "move", team: 1, afterTeam: 1 }, { op: "note", team: 1 }, { op: "import", teams: [] }, { op: "x", team: 1 }, null]) {
      expect(cleanPickOp(bad)).toHaveProperty("error");
    }
  });
});

describe("on the device", () => {
  const pl = (version: number, ...t: number[]) => ({ workspaceId: "w", season: 2025, version, picks: list(...t) });
  it("shows changes still on their way on top of the server's list", () => {
    expect(withPending(pl(1, 1, 2, 3), [{ op: "move", team: 3, beforeTeam: 1 }, { op: "remove", team: 2 }, { op: "move", team: 9, beforeTeam: null }], me).picks.map((p) => p.team)).toEqual([3, 1]);
  });
  it("keeps the newest version; another season or workspace replaces it", () => {
    expect(newer(pl(3, 1), pl(2, 2)).version).toBe(3);
    expect(newer(pl(3, 1), pl(4, 2)).version).toBe(4);
    expect(newer(pl(3, 1), { ...pl(1, 2), season: 2024 }).season).toBe(2024);
  });
  it("isPickList", () => {
    expect(isPickList(pl(1, 1))).toBe(true);
    expect(isPickList({ ...pl(1, 1), picks: [{ team: "x" }] })).toBe(false);
  });
});
