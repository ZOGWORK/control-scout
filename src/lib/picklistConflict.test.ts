// What stands between a kept pick list change and sending it again (picklistConflict.ts).
import { describe, expect, it } from "vitest";
import { applied, conflictOf, describeConflict, diffLists, rebase } from "./picklistConflict";

describe("kept pick list change conflicts", () => {
  it("nothing changed: no conflict", () => {
    expect(conflictOf({ op: "move", team: 3, beforeTeam: 1 }, [1, 2, 3], [1, 2, 3])).toBeNull();
    expect(conflictOf({ op: "remove", team: 2 }, [1, 2, 3], [1, 2, 3])).toBeNull();
    // The change's own effect (it landed after all, or another of mine did) isn't someone else's change.
    expect(conflictOf({ op: "remove", team: 2 }, [1, 2, 3], [1, 3])).toBeNull();
    expect(conflictOf({ op: "remove", team: 2 }, [1, 2, 3, 4], [1, 3], [4])).toBeNull();
  });

  it("the moved team is gone: it can't apply", () => {
    const c = conflictOf({ op: "move", team: 3, beforeTeam: 1 }, [1, 2, 3], [1, 2]);
    expect(c).toEqual({ kind: "gone", team: 3 });
    expect(describeConflict(c!)).toMatch(/3 is no longer on the pick list/);
  });

  it("the anchor team was deleted: rebased beside the nearest team still there, the way the member meant it", () => {
    // Moved 4 up to just before 2 (meant: 1 4 2 3); 2 was removed since: before 3.
    const c = conflictOf({ op: "move", team: 4, beforeTeam: 2 }, [1, 2, 3, 4], [1, 3, 4]);
    expect(c).toEqual({ kind: "anchor", anchor: 2, rebased: { op: "move", team: 4, beforeTeam: 3 } });
    expect(describeConflict(c!)).toBe("2, which it was placed next to, was removed. Applied now, it goes just before 3.");
    // Moved 1 down to just after 3 (meant: 2 3 1 4); 3 removed: before 4.
    expect(rebase({ op: "move", team: 1, beforeTeam: null, afterTeam: 3 }, [1, 2, 3, 4], [1, 2, 4])).toEqual({ op: "move", team: 1, beforeTeam: 4 });
    // Nothing below it is left: just after the nearest above.
    expect(rebase({ op: "move", team: 1, beforeTeam: null, afterTeam: 3 }, [1, 2, 3], [1, 2])).toEqual({ op: "move", team: 1, beforeTeam: null, afterTeam: 2 });
    // Nothing else at all: the end.
    expect(rebase({ op: "move", team: 1, beforeTeam: 2 }, [2, 1], [1])).toEqual({ op: "move", team: 1, beforeTeam: null });
    // An Undo (restore) keeps its flag.
    expect(conflictOf({ op: "add", team: 9, beforeTeam: 2, restore: true }, [1, 2, 3], [1, 3])).toEqual({ kind: "anchor", anchor: 2, rebased: { op: "add", team: 9, beforeTeam: 3, restore: true } });
  });

  it("someone changed the list since: what was added, removed and moved, leaving out the member's own teams", () => {
    const c = conflictOf({ op: "move", team: 6, beforeTeam: 1 }, [1, 2, 3, 4, 5, 6], [4, 1, 2, 3, 5, 6, 8]);
    expect(c).toEqual({ kind: "changed", added: [8], removed: [], moved: [4] });
    expect(describeConflict(c!)).toBe("The list changed since you made this: 1 team added (8), 1 team moved (4).");
    expect(diffLists([1, 2, 3, 4, 5, 6], [6, 5, 4], [])).toMatchObject({ added: [], removed: [1, 2, 3] });
    expect(diffLists([1, 2, 3, 4, 5, 6], [6, 5, 4], []).moved).toHaveLength(2); // two of the three moved, whichever two
    expect(describeConflict({ kind: "changed", added: [1, 2, 3, 4, 5], removed: [], moved: [] })).toMatch(/5 teams added \(1, 2, 3 and 2 more\)/);
  });

  it("applies a change to an order the way the server would", () => {
    expect(applied([1, 2, 3], { op: "move", team: 3, beforeTeam: 1 })).toEqual([3, 1, 2]);
    expect(applied([1, 2, 3], { op: "move", team: 9, beforeTeam: 1 })).toEqual([1, 2, 3]);
    expect(applied([1, 2], { op: "import", teams: [2, 7] })).toEqual([1, 2, 7]);
  });
});
