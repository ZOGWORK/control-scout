import { describe, expect, it } from "vitest";
import { aggregateConsensus, emptyConsensus, type ConsensusEntry } from "./consensus";
import type { ScoutField } from "./scoutTemplate";

const rating = (id: string, label: string, max = 5): ScoutField => ({ id, label, type: "rating", phase: "overall", max });
const e = (updatedAt: number, fields: ScoutField[], data: Record<string, unknown>, author = 1): ConsensusEntry =>
  ({ team: 7, kind: "match", authorAccountId: author, updatedAt, data, fields });

describe("aggregateConsensus", () => {
  it("no entries: the empty consensus", () => {
    expect(aggregateConsensus(7, [])).toEqual(emptyConsensus(7));
  });

  it("skips unrated (0) ratings, text answers, wrong types and choices that aren't options", () => {
    const fields: ScoutField[] = [rating("speed", "Speed"), { id: "notes", label: "Notes", type: "text", phase: "overall" },
      { id: "end", label: "End", type: "choice", phase: "endgame", options: ["A", "B"] }, { id: "n", label: "N", type: "counter", phase: "teleop", max: 9 }];
    const c = aggregateConsensus(7, [
      e(1, fields, { speed: 0, notes: "fast", end: "C", n: "3" }),
      e(2, fields, { speed: 3, notes: "slow", end: "A", n: 4 }),
    ]);
    expect(c.ratings).toEqual([{ kind: "match", id: "speed", label: "Speed", type: "rating", avg: 3, max: 5, n: 1 }]);
    expect(c.counters).toEqual([{ kind: "match", id: "n", label: "N", type: "counter", avg: 4, n: 1 }]);
    expect(c.tags).toEqual([{ label: "End: A", count: 1 }]);
    expect(JSON.stringify(c)).not.toContain("fast");
  });

  it("labels and scales come from the newest entry with the field, even one that left it unanswered", () => {
    const c = aggregateConsensus(7, [
      e(1, [rating("speed", "Speed")], { speed: 5 }),
      e(2, [rating("speed", "Top speed", 3)], {}),
    ]);
    expect(c.ratings).toEqual([{ kind: "match", id: "speed", label: "Top speed", type: "rating", avg: 3, max: 3, n: 1 }]);
    expect(c.strengths).toEqual([{ label: "Top speed", count: 1 }]);
  });

  it("keeps the top N of each list, ties in newest-first order", () => {
    const fields: ScoutField[] = ["a", "b", "c"].map((id) => ({ id, label: id.toUpperCase(), type: "toggle", phase: "teleop" }));
    const c = aggregateConsensus(7, [e(1, fields, { a: true, b: true, c: true }), e(2, fields, { c: true })], 2);
    expect(c.tags).toEqual([{ label: "C", count: 2 }, { label: "A", count: 1 }]);
  });

  it("counts distinct scouts and the newest update", () => {
    const c = aggregateConsensus(7, [e(5, [], {}, 1), e(9, [], {}, 2), e(7, [], {}, 1)]);
    expect(c).toMatchObject({ entries: 3, scouts: 2, lastUpdated: 9 });
  });
});
